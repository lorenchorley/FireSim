/**
 * Integration with the real fire/terrainFeatures.ts (when present) over the Katoomba DEM: both tiers produce finite
 * fire winds, ridge winds, slope flows and diagnostics with the production TerrainFeatures (crest search, valleyDrop,
 * crestRise/crestDist). Skipped if the module is not available.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { TerrainFeatures } from '../core/simTypes';
import { insolation, terrainDerived } from '../terrain';
import { Atmosphere } from './atmosphere';
import { DiagnosticWind } from './diagnosticWind';
import { ctxFor, fireWinds, fuelDouble, hour, katoombaTerrain, nightState, runFor, seriesOf } from './testUtils';

async function realFeatures(): Promise<((...a: never[]) => TerrainFeatures) | null> {
  try {
    const m = (await import('../fire/terrainFeatures')) as { computeTerrainFeatures?: (...a: never[]) => TerrainFeatures };
    return m.computeTerrainFeatures ?? null;
  } catch {
    return null;
  }
}

describe('integration with the production TerrainFeatures', () => {
  it('Katoomba 6 km, afternoon westerly: finite winds, ridge wind, anabatic top-up and diagnostics in both tiers', async () => {
    const compute = await realFeatures();
    if (!compute) return;
    const { terrain, hiRes } = await katoombaTerrain(6000, 30);
    const features = (compute as unknown as (t: typeof terrain, d: ReturnType<typeof terrainDerived>, h: typeof hiRes) => TerrainFeatures)(terrain, terrainDerived(terrain), hiRes);
    const t0 = Date.UTC(2025, 9, 15, 3); // 14:00 local
    const hrs = [0, 1].map((q) => hour(t0 + q * 3600e3, 6, 280, { temperature: 28 }));
    const s = seriesOf(hrs, { sourceElevation: 715 });
    const n = terrain.grid.nx * terrain.grid.ny;
    for (const tier of ['fast', 'standard'] as const) {
      const a =
        tier === 'fast'
          ? new DiagnosticWind(terrain, hiRes, fuelDouble(terrain.grid), features, tier, 6000, s, new Rng(2))
          : new Atmosphere(terrain, hiRes, fuelDouble(terrain.grid), features, tier, 6000, s, new Rng(2));
      a.setAmbient(hrs[0]!, hrs[1]!);
      a.setTime(t0);
      a.setSurfaceHeating(insolation(terrain, t0), hrs[0]!, 80, nightState(0));
      if (tier === 'standard') runFor(a, 600);
      const r = fireWinds(a, terrain, ctxFor(terrain));
      let bad = 0;
      let ridgeFinite = 0;
      for (let k = 0; k < n; k++) {
        if (!Number.isFinite(r.u[k]!) || !Number.isFinite(r.v[k]!) || !Number.isFinite(r.bu[k]!)) bad++;
        if (Number.isFinite(r.ridge[k]!)) ridgeFinite++;
      }
      expect(bad).toBe(0);
      expect(ridgeFinite).toBeGreaterThan(0);
      const d = a.diagnostics();
      expect(d.uRidgeMedian).toBeGreaterThan(1);
      expect(Number.isFinite(d.frH)).toBe(true);
      let sf = 0;
      for (let k = 0; k < n; k++) sf = Math.max(sf, d.slopeFlow[k]!);
      expect(sf).toBeGreaterThan(0);
      expect(sf).toBeLessThanOrEqual(3);
      const T = new Float32Array(n);
      const R = new Float32Array(n);
      a.airAt(terrain.grid, T, R);
      for (let k = 0; k < n; k += 97) {
        expect(T[k]!).toBeGreaterThan(10);
        expect(T[k]!).toBeLessThan(45);
      }
    }
  }, 120000);
});
