/** Fire-grid terrain from the 10 m DEM (spec §11.6): block averaging, slopeP90Deg and cliffFraction; DEM fallbacks. */
import { afterEach, describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { RAD } from '../core/units';
import { withFakeNetwork } from './testing';
import { blockFactor, demoSitesNear, elevationAtLocal, fireTerrainFromHiRes, loadHiResDem, medianOf, slopeDegOf } from './terrain';

const O = { lat: -33.7, lon: 150.3 };
let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe('block averaging to the fire grid', () => {
  it('a plane: exact block means, slope = p90 = plane slope, no cliffs; grids aligned with makeGridSpec', () => {
    const g = makeGridSpec(O, 3000, 10);
    const z = new Float32Array(g.nx * g.ny);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = 500 + 0.2 * (g.x0 + i * 10) + 0.1 * (g.y0 + j * 10);
    for (const cell of [20, 30]) {
      const t = fireTerrainFromHiRes({ grid: g, elevation: z, source: 'plane' }, cell);
      const ref = makeGridSpec(O, 3000, cell);
      expect([t.grid.nx, t.grid.ny, t.grid.x0, t.grid.y0]).toEqual([ref.nx, ref.ny, ref.x0, ref.y0]);
      const want = Math.atan(Math.hypot(0.2, 0.1)) * RAD;
      const k = (t.grid.ny >> 1) * t.grid.nx + (t.grid.nx >> 1);
      expect(t.elevation[k]).toBeCloseTo(500 + 0.2 * (t.grid.x0 + (t.grid.nx >> 1) * cell) + 0.1 * (t.grid.y0 + (t.grid.ny >> 1) * cell), 2);
      expect(t.slopeDeg[k]).toBeCloseTo(want, 3);
      expect(t.slopeP90Deg![k]).toBeCloseTo(want, 3);
      expect(t.cliffFraction![k]).toBe(0);
    }
  });
  it('a 20 m-wide 75° cliff band: cliffFraction and slopeP90 flag it where the 30 m mean slope smooths it', () => {
    const g = makeGridSpec(O, 3000, 10);
    const z = new Float32Array(g.nx * g.ny);
    const rise = Math.tan((75 * Math.PI) / 180) * 10; // per 10 m cell
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const c = i - 150;
        z[j * g.nx + i] = 600 + (c <= 0 ? 0 : c >= 2 ? 2 * rise : c * rise);
      }
    }
    const t = fireTerrainFromHiRes({ grid: g, elevation: z, source: 'cliff' }, 30);
    let maxCliff = 0;
    let maxP90 = 0;
    for (let k = 0; k < t.cliffFraction!.length; k++) {
      maxCliff = Math.max(maxCliff, t.cliffFraction![k]!);
      maxP90 = Math.max(maxP90, t.slopeP90Deg![k]!);
    }
    expect(maxCliff).toBeGreaterThanOrEqual(1 / 3 - 1e-6);
    expect(maxP90).toBeGreaterThan(60);
    expect(t.cliffFraction!.filter((v) => v > 0).length).toBeLessThan(0.05 * t.cliffFraction!.length);
  });
  it('rejects a fire cell that is not a multiple of the DEM cell', () => {
    expect(() => blockFactor(10, 25)).toThrow();
    expect(blockFactor(10, 30)).toBe(3);
  });
  it('slope of a 45° ramp; median; bilinear elevation lookup', () => {
    const g = makeGridSpec(O, 200, 10);
    const z = new Float32Array(g.nx * g.ny);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = 10 * i;
    expect(slopeDegOf(g, z)[5 * g.nx + 5]).toBeCloseTo(45, 6);
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    const t = fireTerrainFromHiRes({ grid: g, elevation: z, source: 'ramp' }, 20);
    expect(elevationAtLocal(t, 0, 0)).toBeCloseTo(95, 3);
  });
});

describe('DEM fallback chain', () => {
  it('demo sites near a centre (named site first)', () => {
    expect(demoSitesNear({ lat: -33.715, lon: 150.285 })).toEqual(['katoomba']);
    expect(demoSitesNear({ lat: -33.715, lon: 150.285 }, 'grose')[0]).toBe('grose');
    expect(demoSitesNear({ lat: -30, lon: 140 })).toEqual([]);
  });
  it('Katoomba: bundled LiDAR, no network', async () => {
    const n = withFakeNetwork([]);
    restore = n.restore;
    const r = await loadHiResDem({ centre: { lat: -33.715, lon: 150.285 }, extent: 6000, online: false, kv: n.kv });
    expect(r.origin).toBe('lidar');
    expect(r.siteId).toBe('katoomba');
    expect(r.dem.grid.nx).toBe(600);
    expect(n.calls).toHaveLength(0);
  });
  it('online with the tile service unreachable → synthetic terrain with the warning', async () => {
    const n = withFakeNetwork([]);
    restore = n.restore;
    const r = await loadHiResDem({ centre: { lat: -30.5, lon: 151.6 }, extent: 3000, online: true, kv: n.kv });
    expect(r.origin).toBe('synthetic');
    expect(r.warnings[0]).toMatch(/SYNTHETIC TERRAIN/);
    expect(n.calls.some((u) => u.includes('elevation-tiles-prod'))).toBe(true);
  });
});
