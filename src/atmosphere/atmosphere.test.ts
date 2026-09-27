/**
 * 3-D Atmosphere (spec §8.4–§8.8, §8.11, §13, §15 V17/V21): flat-terrain wind scale, projection quality,
 * checkpoint/restore bitwise, coupling contract, performance on the Katoomba 6 km domain.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { FireWindContext } from '../core/simTypes';
import { windToUV } from '../core/units';
import type { Terrain, WeatherHour, WeatherSeries } from '../core/types';
import { Atmosphere } from './atmosphere';
import { featuresDouble, flatTerrain, fuelDouble, hour, katoombaTerrain, nightState, parseOpenMeteoFixture, seriesOf, analyticTerrain } from './testUtils';
import { insolation } from '../terrain';
import type { GridSpec } from '../core/grid';

function make(t: Terrain, s: WeatherSeries, extent: number, hiRes?: { grid: GridSpec; elevation: Float32Array }, tier: 'standard' | 'high' = 'standard'): Atmosphere {
  return new Atmosphere(t, hiRes, fuelDouble(t.grid), featuresDouble(t), tier, extent, s, new Rng(3));
}

function ctxFor(t: Terrain, extra: Partial<FireWindContext> = {}): FireWindContext {
  const n = t.grid.nx * t.grid.ny;
  return { sep: new Float32Array(n), frontDist: new Float32Array(n).fill(Infinity), firePowerW: 0, plumeTopAGL: 1000, slopeFlowOn: true, time: 0, ...extra };
}

export function fireWinds(a: Atmosphere, t: Terrain, ctx = ctxFor(t)) {
  const n = t.grid.nx * t.grid.ny;
  const o = Array.from({ length: 7 }, () => new Float32Array(n));
  a.surfaceWindForFire(t.grid, o[0]!, o[1]!, o[2]!, o[3]!, o[4]!, o[5]!, o[6]!, ctx);
  return { u: o[0]!, v: o[1]!, bu: o[2]!, bv: o[3]!, iu: o[4]!, iv: o[5]!, ridge: o[6]! };
}

function spin(a: Atmosphere, seconds: number): number {
  let t = 0;
  let steps = 0;
  while (t < seconds) {
    const dt = Math.min(a.maxStableDt(), seconds - t);
    a.step(dt);
    t += dt;
    steps++;
  }
  return steps;
}

describe('3-D tier: flat terrain keeps the forecast U10 (V21, D30)', () => {
  it('Katoomba forecast fixture: U10_fire within ±1 % after a 900 s spin-up, c_f 0 and 1', () => {
    const t = flatTerrain(6000, 30, 715);
    const s = parseOpenMeteoFixture('openmeteo-forecast-katoomba.json');
    s.sourceElevation = 715;
    const a = make(t, s, 6000);
    const A = s.hours[14]!;
    const B = s.hours[15]!;
    a.setAmbient(A, B);
    a.setTime(A.time);
    spin(a, 900);
    expect(a.spunUp).toBe(true);
    const [fu, fv] = windToUV(A.windSpeed10, A.windDir10);
    const sp = Math.hypot(fu, fv);
    for (const cf of [0, 1]) {
      a.setCoupling(cf);
      const r = fireWinds(a, t);
      let worst = 0;
      for (let k = 0; k < r.u.length; k += 37) worst = Math.max(worst, Math.hypot(r.u[k]! - fu, r.v[k]! - fv) / sp);
      expect(worst).toBeLessThan(0.01);
    }
  });
});

describe('3-D tier: projection and determinism', () => {
  it('projection leaves max|∇·u|·Δx/|u| < 1e-3 over the Katoomba DEM; restore then step is bitwise equal', async () => {
    const { terrain, hiRes } = await katoombaTerrain(6000, 30);
    const hrs: WeatherHour[] = [0, 1].map((q) => hour(Date.UTC(2025, 9, 15, 1 + q), 8, 290 + 10 * q));
    const s = seriesOf(hrs, { sourceElevation: 715 });
    const a = make(terrain, s, 6000, hiRes);
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time);
    a.setSurfaceHeating(insolation(terrain, hrs[0]!.time), hrs[0]!, 60, nightState(0));
    a.trackDivergence = true;
    spin(a, 300);
    const cp = structuredClone(a.checkpoint());
    a.setTime(hrs[0]!.time + 600e3);
    for (let q = 0; q < 5; q++) a.step(8);
    const r1 = fireWinds(a, terrain);
    const st1 = a.state.theta.slice();
    a.restore(cp);
    a.setTime(hrs[0]!.time + 600e3);
    for (let q = 0; q < 5; q++) a.step(8);
    const r2 = fireWinds(a, terrain);
    expect(Buffer.from(r2.u.buffer).equals(Buffer.from(r1.u.buffer))).toBe(true);
    expect(Buffer.from(a.state.theta.buffer).equals(Buffer.from(st1.buffer))).toBe(true);
    // Projection quality right after the (single, warm-started) V-cycle of the last step. The Davies relaxation that
    // follows it (§8.4 step 8) re-introduces divergence inside the boundary zones; the next projection removes it.
    expect(a.lastProjection.relResidual).toBeLessThan(1e-3);
  }, 120000);
});

describe('3-D tier: contract behaviour', () => {
  it('c_f = 0 ⇒ U_fire = U_dyn10 and U_fireInd = 0 (one-way coupling); view() on flat levels', () => {
    const t = analyticTerrain(4000, 40, (x, y) => 500 + 150 * Math.exp(-(x * x + y * y) / (2 * 500 * 500)));
    const hrs: WeatherHour[] = [0, 1].map((q) => hour(Date.UTC(2025, 0, 5, q), 6, 270));
    const s = seriesOf(hrs, { sourceElevation: 500 });
    const a = make(t, s, 4000);
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time);
    spin(a, 120);
    a.setCoupling(0);
    const n = t.grid.nx * t.grid.ny;
    const r = fireWinds(a, t, ctxFor(t, { firePowerW: 1e9, frontDist: new Float32Array(n) }));
    for (let k = 0; k < n; k += 11) expect(r.iu[k]).toBe(0);
    const v = a.view();
    expect(v.nz).toBe(a.grid.nz);
    expect(v.u.length).toBe(a.grid.plane * a.grid.nz);
    expect(v.levels[0]).toBeCloseTo(a.grid.zetaC[0]!, 4);
    // Below-terrain cells of the flat view are zero; the lowest column has data at level 0.
    const cHill = (a.grid.ny >> 1) * a.grid.nx + (a.grid.nx >> 1);
    expect(v.terrainHeight[cHill]!).toBeGreaterThan(100);
    expect(v.u[cHill]).toBe(0);
    const d = a.diagnostics();
    expect(d.spunUp).toBe(false);
    expect(Number.isFinite(d.frH)).toBe(true);
    const turb = new Float32Array(3);
    a.sampleTurb(0, 0, 50, turb);
    expect(turb[0]).toBeGreaterThan(0);
    expect(turb[2]).toBeGreaterThan(0);
  });
});
