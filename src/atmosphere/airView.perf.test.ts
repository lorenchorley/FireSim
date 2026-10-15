/**
 * What publishing the air costs (plan 7.3 and 7.6): view() per tier on the Katoomba domains, and what one keyframe of it
 * weighs. Logged like the other `[atmos perf]` lines; the assertions are generous (a shared machine), the numbers are the
 * point. The plan estimated about 0.5 ms for the fast tier's three blended arrays and +486 kB per keyframe at 45 x 45 columns.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { AtmosphereView, WeatherHour } from '../core/types';
import { insolation } from '../terrain';
import { Atmosphere } from './atmosphere';
import { DiagnosticWind } from './diagnosticWind';
import { featuresDouble, fuelDouble, hour, katoombaTerrain, nightState, seriesOf } from './testUtils';

const log = (s: string): void => {
  process.stderr.write(`[atmos perf] ${s}\n`);
};

const viewBytes = (v: AtmosphereView): number => [v.levels, v.terrainHeight, v.surfaceU, v.surfaceV, v.u, v.v, v.w, v.thetaAnomaly, v.smoke].reduce((a, f) => a + f.byteLength, 0);

/** Median wall ms of `f` over `n` calls after a warm-up. */
function medianMs(f: () => void, n: number): number {
  for (let i = 0; i < 5; i++) f();
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    f();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return t[n >> 1]!;
}

describe('view() cost per tier (Katoomba)', () => {
  for (const [extent, tier] of [
    [6000, 'standard'],
    [9000, 'high'],
    [9000, 'fast'],
  ] as const) {
    it(`${extent / 1000} km ${tier}: ms per view() and the bytes it publishes`, { timeout: 180_000 }, async () => {
      const { terrain, hiRes } = await katoombaTerrain(extent, 30);
      const hrs: WeatherHour[] = [0, 1, 2].map((q) => hour(Date.UTC(2025, 9, 15, 2 + q), 10, 300 + 5 * q));
      const s = seriesOf(hrs, { sourceElevation: 715 });
      const common = [terrain, hiRes, fuelDouble(terrain.grid), featuresDouble(terrain)] as const;
      const a = tier === 'fast' ? new DiagnosticWind(...common, 'fast', extent, s, new Rng(3)) : new Atmosphere(...common, tier, extent, s, new Rng(3));
      a.setAmbient(hrs[0]!, hrs[1]!);
      a.setTime(hrs[0]!.time + 600e3);
      a.setSurfaceHeating(insolation(terrain, hrs[0]!.time), hrs[0]!, 60, nightState(0));
      for (let q = 0; q < 10; q++) a.step(10);
      const ms = medianMs(() => a.view(), 25);
      const v = a.view();
      const g = a.grid;
      const kind = v.kind;
      const perColumn = viewBytes(v) / g.plane;
      log(`Katoomba ${extent / 1000} km ${tier} ${g.nx}x${g.ny}x${g.nz}: view() ${ms.toFixed(2)} ms (${kind}, ${(viewBytes(v) / 1024).toFixed(0)} kB, ${perColumn.toFixed(0)} B per column)`);
      expect(v.nz).toBe(g.nz);
      expect(kind).toBe(tier === 'fast' ? 'diagnosed' : 'prognostic');
      // Fast: u, v, w (12 B per level) + terrain height and surface u, v (12 B) per column; 3-D: five fields (20 B per level).
      const expected = g.plane * (12 + g.nz * (tier === 'fast' ? 12 : 20)) + g.nz * 4;
      expect(viewBytes(v)).toBe(expected);
      expect(ms).toBeLessThan(tier === 'fast' ? 25 : 60); // 2-3 times the figure measured on the build machine
    });
  }
});
