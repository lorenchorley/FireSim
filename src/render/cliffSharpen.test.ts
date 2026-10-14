import { describe, expect, it } from 'vitest';
import type { GridSpec } from '../core/grid';
import { CLIFF_SHARPEN_DEFAULTS, cliffSharpen, despikeGrid, hornSlopeDeg, hornTan2 } from './cliffSharpen';
import { hornGradient, slopeFromGradient } from './fields';
import { countSpikes, drainageMask, flatGrid, iou, maxOf, terrainOf } from './testing/cliffs';

const TAN = (deg: number): number => Math.tan((deg * Math.PI) / 180);

/** A plateau at `top` m, a face of `deg` degrees dropping `drop` m with rounded shoulders, and the foot, along x (cells of 10 m from x = 200). */
function roundedRamp(g: GridSpec, deg: number, drop: number, top: number): Float32Array {
  const run = drop / TAN(deg);
  return terrainOf(g, (i) => {
    const t = Math.min(1, Math.max(0, (i * 10 - 200) / run));
    // half straight ramp, half smoothstep: the same end heights with the shoulders rounded
    return top - 0.45 * drop * t - 0.55 * drop * (t * t * (3 - 2 * t));
  });
}

/** Rugged terrain (steep in places) with 2 % single-cell spikes of up to 60 m, from a fixed seed. */
function ruggedWithSpikes(g: GridSpec): Float32Array {
  let s = 12345;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return terrainOf(g, (i, j) => 400 + 90 * Math.sin(i / 9) * Math.cos(j / 11) + (rnd() < 0.02 ? (rnd() - 0.5) * 120 : 0) + 2 * rnd());
}

describe('cliffSharpen', () => {
  it('makes a 70 degree ramp with rounded shoulders steeper and keeps its end heights', () => {
    const g = flatGrid(60, 40);
    const z = roundedRamp(g, 70, 100, 100);
    const r = cliffSharpen(g, z).elevation;
    const before = maxOf(hornSlopeDeg(g, z));
    expect(maxOf(hornSlopeDeg(g, r))).toBeGreaterThan(before + 2);
    // the plateau cells and the foot cells are where they were
    for (const i of [5, 6, 54, 55]) expect(r[20 * g.nx + i]).toBe(z[20 * g.nx + i]);
    // and nothing moved beyond the plateau and foot heights
    expect(Math.max(...r)).toBeLessThanOrEqual(Math.max(...z));
    expect(Math.min(...r)).toBeGreaterThanOrEqual(Math.min(...z));
  });

  it('leaves a straight ramp (away from the edge) and all ground under 48 degrees untouched, bit for bit', () => {
    const g = flatGrid(80, 80);
    const plane = terrainOf(g, (i, j) => 500 - 25 * i + 7 * j); // a 68 degree plane, slightly oblique
    const gentle = terrainOf(g, (i, j) => 300 + 18 * Math.sin(i / 9) + 12 * Math.cos(j / 7) - 3 * i);
    const rp = cliffSharpen(g, plane).elevation;
    for (let j = 5; j < g.ny - 5; j++) for (let i = 5; i < g.nx - 5; i++) expect(rp[j * g.nx + i]).toBe(plane[j * g.nx + i]);
    expect(maxOf(hornSlopeDeg(g, gentle))).toBeLessThan(48);
    const rg = cliffSharpen(g, gentle);
    expect(rg.elevation.every((v, k) => v === gentle[k])).toBe(true);
    expect(rg.stats.moved).toBe(0);
    expect(rg.stats.weighted).toBe(0);
  });

  it('returns an exact copy when nothing is steep, even where a lone spike stands in the data (the drawing equals the data)', () => {
    const g = flatGrid(40, 40);
    const z = terrainOf(g, (i, j) => 100 + 0.5 * i + (i === 20 && j === 20 ? 14 : 0));
    expect(maxOf(hornSlopeDeg(g, z))).toBeLessThan(48);
    const r = cliffSharpen(g, z);
    expect(r.elevation.every((v, k) => v === z[k])).toBe(true);
    expect(r.elevation).not.toBe(z);
  });

  it('never changes the terrain it is given', () => {
    const g = flatGrid(100, 100);
    const z = ruggedWithSpikes(g);
    const copy = Float32Array.from(z);
    cliffSharpen(g, z);
    expect(z.every((v, k) => v === copy[k])).toBe(true);
  });

  it('keeps a 15 m V-gully a slot: the floor cells are unchanged and its drainage is kept', () => {
    const g = flatGrid(120, 120);
    // a gully with 60 degree walls up to a plateau 120 m above its floor, falling 10 degrees towards the south
    const z = terrainOf(g, (i, j) => 200 + 1.8 * j + Math.min(Math.abs(i - 60) * 10 * TAN(60), 120));
    const r = cliffSharpen(g, z).elevation;
    for (let j = 4; j < g.ny - 4; j++) expect(Math.abs(r[j * g.nx + 60]! - z[j * g.nx + 60]!)).toBeLessThan(1e-3);
    const before = drainageMask(g, z, 10000);
    const after = drainageMask(g, r, 10000);
    expect(before.reduce((s, v) => s + v, 0)).toBeGreaterThan(50);
    expect(iou(before, after)).toBeGreaterThanOrEqual(0.85);
    // and a gully 15 m deep and 30 m wide between 70 degree faces keeps its floor too
    const slot = terrainOf(g, (i, j) => 300 + 1.5 * j + Math.min(Math.abs(i - 60) * 10 * TAN(70), 15) + (Math.abs(i - 60) > 3 ? 80 : 0));
    const rs = cliffSharpen(g, slot).elevation;
    for (let j = 4; j < g.ny - 4; j++) expect(Math.abs(rs[j * g.nx + 60]! - slot[j * g.nx + 60]!)).toBeLessThan(1e-3);
  });

  it('leaves no tower or pit of 10 m or more, and is deterministic', () => {
    const g = flatGrid(120, 120);
    const z = ruggedWithSpikes(g);
    expect(countSpikes(g, z, 10).towers + countSpikes(g, z, 10).pits).toBeGreaterThan(10); // the test terrain has them
    const a = cliffSharpen(g, z);
    const b = cliffSharpen(g, z);
    expect(a.elevation.every((v, k) => v === b.elevation[k])).toBe(true);
    expect(countSpikes(g, a.elevation, 10)).toEqual({ towers: 0, pits: 0 });
    expect(a.stats.despiked).toBeGreaterThan(0);
    expect(a.stats.despiked).toBe(b.stats.despiked);
  });

  it('never touches the outer ring of cells', () => {
    const g = flatGrid(100, 100);
    const z = ruggedWithSpikes(g);
    const a = cliffSharpen(g, z).elevation;
    for (let i = 0; i < g.nx; i++) {
      expect(a[i]).toBe(z[i]);
      expect(a[(g.ny - 1) * g.nx + i]).toBe(z[(g.ny - 1) * g.nx + i]);
    }
    for (let j = 0; j < g.ny; j++) {
      expect(a[j * g.nx]).toBe(z[j * g.nx]);
      expect(a[j * g.nx + g.nx - 1]).toBe(z[j * g.nx + g.nx - 1]);
    }
  });

  it('bounds every move by the range of the 7 x 7 neighbourhood of the data, plus the 2 m despike margin', () => {
    const g = flatGrid(100, 100);
    const z = ruggedWithSpikes(g);
    const a = cliffSharpen(g, z).elevation;
    for (let j = 3; j < g.ny - 3; j++)
      for (let i = 3; i < g.nx - 3; i++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let dj = -3; dj <= 3; dj++)
          for (let di = -3; di <= 3; di++) {
            const v = z[(j + dj) * g.nx + i + di]!;
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        expect(a[j * g.nx + i]).toBeGreaterThanOrEqual(lo - CLIFF_SHARPEN_DEFAULTS.despikeMargin - 1e-3);
        expect(a[j * g.nx + i]).toBeLessThanOrEqual(hi + CLIFF_SHARPEN_DEFAULTS.despikeMargin + 1e-3);
      }
  });

  it('makes no new NaN when the data has cells with no height, and a NaN cell never moves', () => {
    const g = flatGrid(100, 100);
    const z = ruggedWithSpikes(g);
    z[50 * g.nx + 50] = NaN;
    z[30 * g.nx + 40] = NaN;
    z[0] = NaN;
    const r = cliffSharpen(g, z);
    let fresh = 0;
    for (let k = 0; k < r.elevation.length; k++) {
      if (Number.isNaN(z[k]!)) expect(Number.isNaN(r.elevation[k]!)).toBe(true);
      else if (Number.isNaN(r.elevation[k]!)) fresh++;
    }
    expect(fresh).toBe(0);
    expect(Number.isFinite(r.stats.movedMaxM)).toBe(true);
  });

  it('reports what it moved, and a weaker strength moves less (the S5 fallback)', () => {
    const g = flatGrid(60, 40);
    const z = roundedRamp(g, 70, 100, 100);
    const full = cliffSharpen(g, z);
    const weak = cliffSharpen(g, z, { strength: 0.6 });
    let moved = 0;
    for (let k = 0; k < z.length; k++) if (Math.abs(full.elevation[k]! - z[k]!) >= 0.5) moved++;
    expect(full.stats.moved).toBe(moved);
    expect(full.stats.moved).toBeGreaterThan(0);
    expect(full.stats.weighted).toBeGreaterThanOrEqual(full.stats.moved);
    expect(full.stats.movedMeanM).toBeGreaterThan(0);
    expect(full.stats.ms.total).toBeGreaterThanOrEqual(0);
    expect(maxOf(hornSlopeDeg(g, weak.elevation))).toBeLessThan(maxOf(hornSlopeDeg(g, full.elevation)));
    expect(maxOf(hornSlopeDeg(g, weak.elevation))).toBeGreaterThan(maxOf(hornSlopeDeg(g, z)));
  });

  it('copes with tiny grids', () => {
    for (const [nx, ny] of [[1, 1], [2, 5], [3, 3]] as const) {
      const g = flatGrid(nx, ny);
      const z = terrainOf(g, (i, j) => 10 * i + j);
      expect(cliffSharpen(g, z).elevation).toEqual(z);
    }
  });

  it('is fast: a 900 x 900 terrain with steep faces in well under a second (a generous guard; about 30 ms on a quiet machine)', () => {
    const g = flatGrid(900, 900);
    // ridges and faces everywhere: 5 % of the cells steep
    const z = terrainOf(g, (i, j) => 600 + 140 * Math.sin(i / 40) * Math.cos(j / 55) + (Math.sin(i / 7) > 0.97 ? 60 : 0));
    const t0 = performance.now();
    const r = cliffSharpen(g, z);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.stats.weighted).toBeGreaterThan(1000);
  });
});

describe('hornTan2 and hornSlopeDeg', () => {
  it('agree with the renderer Horn gradient, edges included', () => {
    const g = flatGrid(40, 30, 12);
    const z = ruggedWithSpikes(g);
    const { dzdx, dzdy } = hornGradient(g, z);
    const t2 = hornTan2(g, z);
    const deg = hornSlopeDeg(g, z);
    for (let k = 0; k < z.length; k++) {
      expect(t2[k]!).toBeCloseTo(dzdx[k]! ** 2 + dzdy[k]! ** 2, 3);
      expect(deg[k]!).toBeCloseTo(slopeFromGradient(dzdx[k]!, dzdy[k]!), 3);
    }
  });
});

describe('despikeGrid', () => {
  it('pulls a tower and a pit back to 2 m past their neighbours and counts them, leaving the outer ring alone', () => {
    const g = flatGrid(20, 20);
    const z = terrainOf(g, () => 100);
    z[10 * g.nx + 10] = 125;
    z[5 * g.nx + 5] = 70;
    z[0] = 400; // on the outer ring: never a candidate
    const fixed = despikeGrid(g, z, 10, 2);
    expect(fixed).toBe(2);
    expect(z[10 * g.nx + 10]).toBe(102);
    expect(z[5 * g.nx + 5]).toBe(98);
    expect(z[0]).toBe(400);
    // a ridge is not a spike: its neighbours along it are as high
    const w = terrainOf(g, (i) => (i === 10 ? 130 : 100));
    expect(despikeGrid(g, w, 10, 2)).toBe(0);
  });
});
