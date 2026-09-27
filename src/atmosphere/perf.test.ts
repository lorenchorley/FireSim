/**
 * Performance against the §13 budgets (x86 Node, one worker): standard-tier step 12.5–19 ms on a Xeon core for
 * 45×45×20 (phone 25–56 ms); u_bg solves 50–150 ms per stamp; V20 (Katoomba 9 km, 4 h, standard ≤ 40 s total,
 * fast ≤ 15 s). Reports ms/step for the Katoomba 6 km and 9 km domains (standard), the high tier, the fire-wind
 * coupling calls, and the fast tier. Assertions use 2× the budget to tolerate shared CI machines.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { WeatherHour } from '../core/types';
import { insolation } from '../terrain';
import { Atmosphere } from './atmosphere';
import { DiagnosticWind } from './diagnosticWind';
import { ctxFor, featuresDouble, fireWinds, fuelDouble, hour, katoombaTerrain, nightState, seriesOf } from './testUtils';

const log = (s: string): void => {
  process.stderr.write(`[atmos perf] ${s}\n`);
};

function timeIt(f: () => void, n: number): number {
  const t0 = performance.now();
  for (let q = 0; q < n; q++) f();
  return (performance.now() - t0) / n;
}

describe('§13 performance', () => {
  for (const [extent, tier] of [
    [6000, 'standard'],
    [9000, 'standard'],
    [9000, 'high'],
  ] as const) {
    it(`Katoomba ${extent / 1000} km ${tier}: ms per atmosphere step, fire-wind and airAt calls`, async () => {
      const { terrain, hiRes } = await katoombaTerrain(extent, 30);
      const hrs: WeatherHour[] = [0, 1].map((q) => hour(Date.UTC(2025, 9, 15, 2 + q), 10, 300));
      const s = seriesOf(hrs, { sourceElevation: 715 });
      const t0 = performance.now();
      const a = new Atmosphere(terrain, hiRes, fuelDouble(terrain.grid), featuresDouble(terrain), tier, extent, s, new Rng(3));
      a.setAmbient(hrs[0]!, hrs[1]!);
      a.setTime(hrs[0]!.time);
      const tInit = performance.now() - t0;
      a.setSurfaceHeating(insolation(terrain, hrs[0]!.time), hrs[0]!, 60, nightState(0));
      for (let q = 0; q < 20; q++) a.step(10); // JIT warm-up and spin-up transient
      let cycles = 0;
      const ms = timeIt(() => {
        a.step(10);
        cycles += a.lastProjection.iterations;
      }, 40);
      const ctx = ctxFor(terrain);
      fireWinds(a, terrain, ctx);
      const n = terrain.grid.nx * terrain.grid.ny;
      const o = Array.from({ length: 7 }, () => new Float32Array(n));
      const msWind = timeIt(() => a.surfaceWindForFire(terrain.grid, o[0]!, o[1]!, o[2]!, o[3]!, o[4]!, o[5]!, o[6]!, ctx), 20);
      const msAir = timeIt(() => a.airAt(terrain.grid, o[0]!, o[1]!), 20);
      const g = a.grid;
      const dt = a.maxStableDt();
      const perIter = ms + msWind + msAir;
      log(
        `Katoomba ${extent / 1000} km ${tier} ${g.nx}×${g.ny}×${g.nz} (Δx ${g.dx.toFixed(0)} m): init + u_bg pair ${tInit.toFixed(0)} ms, ` +
          `step ${ms.toFixed(1)} ms (${(cycles / 40).toFixed(2)} projection corrections), surfaceWindForFire ${msWind.toFixed(2)} ms, airAt ${msAir.toFixed(2)} ms; ` +
          `Δt_a ${dt.toFixed(1)} s → 4 h ≈ ${((14400 / Math.min(dt, 12)) * perIter / 1000).toFixed(1)} s of atmosphere work`,
      );
      if (tier === 'standard') expect(ms).toBeLessThan(2 * 19);
      expect(tInit).toBeLessThan(3000);
    }, 180000);
  }

  it('fast tier (Katoomba 9 km): u_bg stamp solves and per-step fire-wind cost', async () => {
    const { terrain, hiRes } = await katoombaTerrain(9000, 30);
    const hrs: WeatherHour[] = [0, 1, 2].map((q) => hour(Date.UTC(2025, 9, 15, 2 + q), 10, 300 + 5 * q));
    const s = seriesOf(hrs, { sourceElevation: 715 });
    const t0 = performance.now();
    const a = new DiagnosticWind(terrain, hiRes, fuelDouble(terrain.grid), featuresDouble(terrain), 'fast', 9000, s, new Rng(3));
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time);
    const tInit = performance.now() - t0;
    const t1 = performance.now();
    a.setAmbient(hrs[1]!, hrs[2]!); // one new stamp (warm-started)
    const tStamp = performance.now() - t1;
    a.setSurfaceHeating(insolation(terrain, hrs[1]!.time), hrs[1]!, 60, nightState(0));
    const ctx = ctxFor(terrain);
    fireWinds(a, terrain, ctx);
    const n = terrain.grid.nx * terrain.grid.ny;
    const o = Array.from({ length: 7 }, () => new Float32Array(n));
    const q = new Float32Array(n);
    q[n >> 1] = 50;
    const msWind = timeIt(() => a.surfaceWindForFire(terrain.grid, o[0]!, o[1]!, o[2]!, o[3]!, o[4]!, o[5]!, o[6]!, ctx), 20);
    const pyro = (a as unknown as { pyro: { solve(q: Float32Array): void } }).pyro;
    pyro.solve(q);
    const tPyro = timeIt(() => pyro.solve(q), 5);
    log(
      `fast tier 9 km: init + 2 stamps ${tInit.toFixed(0)} ms, extra stamp ${tStamp.toFixed(0)} ms, surfaceWindForFire ${msWind.toFixed(2)} ms, ` +
        `pyrogenic solve ${tPyro.toFixed(1)} ms (every 60 s) → 4 h ≈ ${((1440 * msWind + 240 * tPyro) / 1000).toFixed(1)} s`,
    );
    expect(tStamp).toBeLessThan(2 * 150);
  }, 180000);
});
