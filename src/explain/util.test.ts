/**
 * Detector helpers (spec §10.1): angle arithmetic, soft-AND ratios (score ≥ 1 ⇔ all thresholds met), the per-tile
 * top-K accumulator ("≥ K cells" = K-th largest score), 500 m tile keys, the spatial hash (vs brute force), the
 * chamfer distance transform, Wilson breach vectors (§7.4) and the lee-of-divide test (§10.2 foehn).
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { standaloneContext } from './context';
import { wilsonBreach } from './rules/fire';
import { attachmentScore } from './rules/terrain';
import { TestWorld } from './testing/simState';
import { distanceTransform, leeOfDivide } from './statics';
import { CellHash, CircularMean, TileTopK, Tiles, angDist, angLe, ge, le, medianFinite, softAnd, stepCell } from './util';

const g = makeGridSpec({ lat: -33.7, lon: 150.3 }, 3000, 30);

describe('angles and soft ratios', () => {
  it('angDist is the smallest angle, NaN-propagating', () => {
    expect(angDist(350, 10)).toBe(20);
    expect(angDist(10, 350)).toBe(20);
    expect(angDist(0, 180)).toBe(180);
    expect(angDist(NaN, 3)).toBeNaN();
  });
  it('ratios are ≥ 1 exactly when the threshold holds, capped at 2, 0 for NaN', () => {
    expect(ge(10, 10)).toBe(1);
    expect(ge(9.9, 10)).toBeLessThan(1);
    expect(ge(100, 10)).toBe(2);
    expect(ge(NaN, 10)).toBe(0);
    expect(le(10, 10)).toBe(1);
    expect(le(11, 10)).toBeLessThan(1);
    expect(le(-5, 10)).toBe(2);
    expect(le(NaN, 10)).toBe(0);
    expect(angLe(45, 45)).toBe(1);
    expect(angLe(50, 45)).toBeLessThan(1);
    expect(angLe(NaN, 45)).toBe(0);
    expect(softAnd(1.5, 1.2, 0.9)).toBe(0.9);
  });
  it('circular mean across north; negligible resultant → NaN', () => {
    const m = new CircularMean();
    m.add(350);
    m.add(10);
    expect(Math.min(m.mean(), 360 - m.mean())).toBeLessThan(1e-9);
    m.reset();
    m.add(0);
    m.add(180);
    expect(m.mean()).toBeNaN();
  });
  it('medianFinite ignores non-finite values', () => {
    expect(medianFinite([3, NaN, 1, Infinity, 2])).toBe(2);
    expect(medianFinite([4, 1, 3, 2])).toBe(2.5);
    expect(medianFinite([NaN])).toBeNaN();
  });
});

describe('tiles and top-K', () => {
  it('500 m tile keys kind:tileX:tileY from the south-west corner (j = 0 south)', () => {
    const T = new Tiles(g, 500);
    expect(T.tnx).toBe(Math.ceil(g.nx / (500 / 30)));
    expect(T.key('upslope-run', T.ofCell(0))).toBe('upslope-run:0:0');
    const ne = (g.ny - 1) * g.nx + g.nx - 1;
    expect(T.key('x', T.ofCell(ne))).toBe(`x:${T.tnx - 1}:${T.tny - 1}`);
    expect(T.ofPoint(-1e6, -1e6)).toBe(0);
  });
  it('the tile score is the K-th largest cell score (≥ K cells satisfy ⇔ score ≥ 1)', () => {
    const T = new Tiles(g, 500);
    const acc = new TileTopK(T, 32);
    acc.reset(5);
    for (const v of [1.2, 0.5, 1.8, 1.1, 1.0, 0.9]) acc.add(0, v);
    const t = T.ofCell(0);
    expect(acc.score(t)).toBeCloseTo(0.9, 6);
    acc.add(0, 1.05);
    expect(acc.score(t)).toBeCloseTo(1.0, 6);
    expect(acc.value(t, 0)).toBeCloseTo(1.8, 6);
    acc.reset(3);
    expect(acc.touchedCount).toBe(0);
    acc.add(0, 2);
    expect(acc.score(t)).toBe(0); // fewer than K cells
    acc.reset(40); // clamped to maxK
    for (let a = 0; a < 40; a++) acc.add(0, 1 + a / 100);
    expect(acc.size(t)).toBe(32);
  });
});

describe('spatial hash and distance transform', () => {
  it('ring-ordered nearest equals brute force (random sets, radii, queries outside the grid)', () => {
    const h = new CellHash(g, 250);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 20; trial++) {
      const n = 1 + Math.floor(rnd() * 200);
      const cells = new Int32Array(n);
      for (let a = 0; a < n; a++) cells[a] = Math.floor(rnd() * g.nx * g.ny);
      h.build(cells, n);
      for (let q = 0; q < 200; q++) {
        const x = (rnd() - 0.5) * 4000;
        const y = (rnd() - 0.5) * 4000;
        const r = rnd() * 3000;
        const k = h.nearest(x, y, r);
        let bd = Infinity;
        for (let a = 0; a < n; a++) {
          const c = cells[a]!;
          bd = Math.min(bd, Math.hypot(g.x0 + (c % g.nx) * 30 - x, g.y0 + Math.floor(c / g.nx) * 30 - y));
        }
        if (bd > r) expect(k).toBe(-1);
        else expect(h.lastDist).toBeCloseTo(bd, 6);
      }
    }
  });
  it('chamfer distance transform within 8 % of Euclidean, with the nearest source', () => {
    const src = new Uint8Array(g.nx * g.ny);
    const c = ((g.ny / 2) | 0) * g.nx + ((g.nx / 2) | 0);
    src[c] = 1;
    const d = new Float32Array(g.nx * g.ny);
    const near = new Int32Array(g.nx * g.ny);
    distanceTransform(g, src, d, near);
    for (let k = 0; k < d.length; k += 97) {
      const e = Math.hypot((k % g.nx) - (c % g.nx), Math.floor(k / g.nx) - Math.floor(c / g.nx)) * 30;
      expect(d[k]!).toBeGreaterThanOrEqual(e - 1e-3);
      expect(d[k]!).toBeLessThanOrEqual(e * 1.083 + 1e-3);
      expect(near[k]).toBe(c);
    }
  });
  it('stepCell moves along an azimuth and returns −1 outside', () => {
    const k0 = ((g.ny / 2) | 0) * g.nx + ((g.nx / 2) | 0);
    expect(stepCell(g, k0, 0, 300)).toBe(k0 + 10 * g.nx);
    expect(stepCell(g, k0, 90, 300)).toBe(k0 + 10);
    expect(stepCell(g, k0, 180, 1e6)).toBe(-1);
  });
});

describe('Wilson breach and lee of the divide', () => {
  it.each([
    [2000, 3, false, 0.291],
    [2000, 5, false, 0.054],
    [5000, 10, true, 0.345],
    [5000, 3, true, 0.883],
    [10000, 3, true, 0.979],
  ])('Wilson (I %d kW/m, W %d m, trees %s) → %d (spec §7.4 vectors)', (I, W, trees, p) => {
    expect(wilsonBreach(I, W, trees)).toBeCloseTo(p, 3);
  });
  it('demo flags and the coarse divide line', () => {
    expect(leeOfDivide(-33.715, 150.285)).toBe(true); // Katoomba
    expect(leeOfDivide(-31.28, 149.0)).toBe(false); // Warrumbungles (demo flag false)
    expect(leeOfDivide(-33.87, 151.21)).toBe(true); // Sydney, east of the line
    expect(leeOfDivide(-34.3, 146.0)).toBe(false); // Riverina, west
    expect(leeOfDivide(-27.5, 153.0)).toBe(true); // north of the line's first point, east
  });
});

describe('attachment score A (spec §7.6 vectors, D33)', () => {
  it.each([
    [15, 0, 0.004],
    [20, 0.5, 0.104],
    [22, 1, 0.5],
    [25, 1, 0.881],
    [28, 1, 0.982],
    [30, 0.2, 0.398],
    [35, 1, 1.0],
  ])('A(θ %d°, T %d) = %d with W_align 1', (deg, T, A) => {
    const w = new TestWorld({ elevation: (_x, y) => 600 + Math.tan((deg * Math.PI) / 180) * y, windSpeed: 5 / 3.6, windDir: 90 });
    w.features.trench.fill(T);
    w.igniteDisc(0, -1500, 100);
    const ctx = standaloneContext(w.view);
    expect(attachmentScore(ctx, w.cell(0, 0), 0)).toBeCloseTo(A, 3);
  });
  it('W_align = 0.5 when the ≥ 10 km/h wind blows ≥ 120° off the spread', () => {
    const w = new TestWorld({ elevation: (_x, y) => 600 + Math.tan((28 * Math.PI) / 180) * y, windSpeed: 20 / 3.6, windDir: 0 });
    w.features.trench.fill(1);
    w.igniteDisc(0, -1500, 100);
    const ctx = standaloneContext(w.view);
    expect(attachmentScore(ctx, w.cell(0, 0), 0)).toBeCloseTo(0.982 * 0.5, 3);
  });
});
