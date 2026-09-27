import { describe, expect, it } from 'vitest';
import { Landform, type Terrain } from '../core/types';
import { cellAt, makeGridSpec } from '../core/grid';
import { angleDiffDeg, DEG, RAD } from '../core/units';
import {
  buildTerrain,
  directionalSlopeDeg,
  downValleyAzimuth,
  hessianAt,
  reliefStats,
  slidingMinMax,
  terrainDerived,
  upslopeAzimuth,
  valleyAxisAzimuth,
  windShelter,
  compassPoint,
  aspectName,
} from './analysis';
import { cone, corrugated, ewGorge, ewRidge, mesa, nsValley, plane, randomHills, saddleRidge, surface, testGrid } from './testing/synthetic';
import { demoAvailable, loadDemoDem } from './testing/demoDem';

const build = (g: ReturnType<typeof testGrid>, z: Float32Array): Terrain => buildTerrain(g, z, 'synthetic');

/** Count cells of a landform class inside an optional predicate on (x, y). */
function classesAt(t: Terrain, pts: [number, number][]): Landform[] {
  return pts.map(([x, y]) => t.landform[cellAt(t.grid, x, y)]! as Landform);
}

describe('buildTerrain – gradients, slope and aspect (Horn 1981)', () => {
  const g = testGrid(3000, 30);

  it('plane rising to the north faces south (aspect 180) with exact slope, including edge cells', () => {
    const grade = Math.tan(20 / RAD);
    const t = build(g, plane(g, 0, grade));
    for (const k of [0, g.nx - 1, (g.ny >> 1) * g.nx + (g.nx >> 1), g.nx * g.ny - 1, g.nx * (g.ny - 1)]) {
      expect(t.slopeDeg[k]).toBeCloseTo(20, 3);
      expect(t.aspectDeg[k]).toBeCloseTo(180, 3);
      expect(t.dzdy[k]).toBeCloseTo(grade, 5);
      expect(t.dzdx[k]).toBeCloseTo(0, 6);
      // Odd-reflection padding keeps the plane planar at the edges: no spurious TPI / curvature.
      expect(Math.abs(t.tpi[k]!)).toBeLessThan(0.05);
      expect(Math.abs(t.curvature[k]!)).toBeLessThan(1e-6);
    }
  });

  it('aspect for planes in other orientations', () => {
    const cases: [number, number, number][] = [
      [0.2, 0, 270], // rises east → faces west
      [-0.2, 0, 90], // rises west → faces east
      [0, -0.2, 0], // rises south → faces north
      [0.1, 0.1, 225], // rises north-east → faces south-west
      [-0.1, 0.1, 135],
    ];
    const k = (g.ny >> 1) * g.nx + (g.nx >> 1);
    for (const [gx, gy, asp] of cases) {
      const t = build(g, plane(g, gx, gy));
      expect(Math.abs(angleDiffDeg(t.aspectDeg[k]!, asp))).toBeLessThan(1e-3);
      expect(t.slopeDeg[k]).toBeCloseTo(Math.atan(Math.hypot(gx, gy)) * RAD, 3);
    }
  });

  it('flat ground has slope 0, NaN aspect and is Flat', () => {
    const t = build(g, plane(g, 0, 0));
    expect(t.slopeDeg.every((s) => s === 0)).toBe(true);
    expect(t.aspectDeg.every((a) => Number.isNaN(a))).toBe(true);
    expect(t.landform.every((l) => l === Landform.Flat)).toBe(true);
    expect(t.minElevation).toBe(500);
    expect(t.maxElevation).toBe(500);
  });

  it('aspect is NaN below 0.5° and defined above', () => {
    const t1 = build(g, plane(g, 0, Math.tan(0.4 / RAD)));
    const t2 = build(g, plane(g, 0, Math.tan(0.6 / RAD)));
    expect(Number.isNaN(t1.aspectDeg[100])).toBe(true);
    expect(t2.aspectDeg[100]).toBeCloseTo(180, 3);
  });

  it('cone: constant slope, aspect points radially outward', () => {
    const H = 400;
    const R = 1200;
    const t = build(g, cone(g, H, R));
    const expected = Math.atan(H / R) * RAD;
    for (let a = 0; a < 360; a += 45) {
      const k = cellAt(g, 600 * Math.sin(a / RAD), 600 * Math.cos(a / RAD));
      // Exact radial direction of the actual cell centre.
      const ci = k % g.nx;
      const cj = Math.floor(k / g.nx);
      const radial = (Math.atan2(g.x0 + ci * g.cellSize, g.y0 + cj * g.cellSize) * RAD + 360) % 360;
      expect(t.slopeDeg[k]).toBeCloseTo(expected, 1);
      expect(Math.abs(angleDiffDeg(t.aspectDeg[k]!, radial))).toBeLessThan(0.5);
      expect(Math.abs(angleDiffDeg(t.aspectDeg[k]!, a))).toBeLessThan(3);
      expect(Math.abs(angleDiffDeg(upslopeAzimuth(t, k), radial + 180))).toBeLessThan(0.5);
    }
    // The apex is a Peak, the flanks are not.
    expect(t.landform[cellAt(g, 0, 0)]).toBe(Landform.Peak);
    expect(t.landform[cellAt(g, 700, 0)]).not.toBe(Landform.Peak);
  });

  it('Horn gradient is exact for quadratic surfaces at interior cells', () => {
    const t = build(g, surface(g, (x, y) => 500 + 1e-4 * x * x + 2e-4 * x * y - 5e-5 * y * y + 0.1 * x));
    const k = cellAt(g, 300, -450);
    const x = g.x0 + (k % g.nx) * g.cellSize;
    const y = g.y0 + Math.floor(k / g.nx) * g.cellSize;
    expect(t.dzdx[k]).toBeCloseTo(2e-4 * x + 2e-4 * y + 0.1, 4);
    expect(t.dzdy[k]).toBeCloseTo(2e-4 * x - 1e-4 * y, 4);
  });

  it('rejects mismatched arrays and cleans no-data values', () => {
    expect(() => buildTerrain(g, new Float32Array(10), 'x')).toThrow();
    const z = plane(g, 0.1, 0);
    z[500] = NaN;
    const t = build(g, z);
    expect(Number.isFinite(t.elevation[500])).toBe(true);
    expect(Number.isFinite(t.minElevation) && Number.isFinite(t.maxElevation)).toBe(true);
    const all = build(g, new Float32Array(g.nx * g.ny).fill(NaN));
    expect(all.elevation.every((v) => v === 0)).toBe(true);
  });

  it('regression: a no-data hole is filled from the surrounding terrain, not the domain mean (no false pit or cliffs)', () => {
    // A 1000 m plateau in the north half, a 400 m valley floor in the south half (domain mean ≈ 700 m), with an
    // 8 × 8-cell hole on the plateau. Filling with the mean made a 300 m pit ringed by "Cliff" and "Gully" cells.
    const z = surface(g, (_x, y) => (y > -600 ? 1000 : 400));
    const hole: number[] = [];
    const c = cellAt(g, 600, 600);
    for (let dj = -4; dj < 4; dj++) for (let di = -4; di < 4; di++) hole.push(c + dj * g.nx + di);
    for (const k of hole) z[k] = NaN;
    const t = build(g, z);
    for (const k of hole) expect(t.elevation[k]).toBeCloseTo(1000, 3);
    for (let dj = -7; dj < 7; dj++) {
      for (let di = -7; di < 7; di++) {
        const k = c + dj * g.nx + di;
        expect(t.slopeDeg[k]).toBeLessThan(0.01);
        expect(t.landform[k]).not.toBe(Landform.Cliff);
        expect(t.landform[k]).not.toBe(Landform.Gully);
      }
    }
    // A hole in a plane is filled with the plane (harmonic interpolation is exact for linear surfaces).
    const p = plane(g, 0.1, -0.05);
    const ref = Float32Array.from(p);
    for (const k of hole) p[k] = NaN;
    const tp = build(g, p);
    for (const k of hole) expect(Math.abs(tp.elevation[k]! - ref[k]!)).toBeLessThan(0.05);
    // The input array is not modified (a cleaned copy is made).
    expect(Number.isNaN(p[hole[0]!])).toBe(true);
  });

  it('regression: aspect is stored in [0, 360) even when it rounds to 360 in float32', () => {
    // Faces north with a tiny westward tilt: the double azimuth 359.9999999976° rounds to 360 in a Float32Array.
    const g5 = makeGridSpec({ lat: -33.7, lon: 150.3 }, 150, 30);
    const z = surface(g5, (_x, y) => -0.2 * y);
    const kc = 2 * g5.nx + 2;
    z[kc + 1] = 1e-9; // east neighbour of the centre, on the y = 0 row
    const t = build(g5, z);
    expect(t.aspectDeg[kc]).toBeGreaterThanOrEqual(0);
    expect(t.aspectDeg[kc]).toBeLessThan(360);
    expect(Math.abs(angleDiffDeg(t.aspectDeg[kc]!, 0))).toBeLessThan(1e-3);
    for (let k = 0; k < t.aspectDeg.length; k++) if (!Number.isNaN(t.aspectDeg[k])) expect(t.aspectDeg[k]).toBeLessThan(360);
    // Helpers wrap the same way (a gradient that rounds to exactly 360 in double precision).
    t.dzdx[kc] = -1e-18;
    t.dzdy[kc] = 0.2;
    const up = upslopeAzimuth(t, kc);
    expect(up).toBeGreaterThanOrEqual(0);
    expect(up).toBeLessThan(360);
  });

  it('non-square grids (nx ≠ ny) keep the row-major, j = 0 south convention', () => {
    const gr = { nx: 150, ny: 90, cellSize: 30, x0: -2235, y0: -1335, origin: { lat: -33.7, lon: 150.3 } };
    const t = build(gr, plane(gr, 0.1, -0.2)); // rises west and south → faces ENE-ish: azimuth of (−0.1, 0.2)
    const expected = (Math.atan2(-0.1, 0.2) * RAD + 360) % 360;
    for (const k of [0, gr.nx - 1, 45 * gr.nx + 70, gr.nx * gr.ny - 1]) {
      expect(Math.abs(angleDiffDeg(t.aspectDeg[k]!, expected))).toBeLessThan(1e-3);
      expect(Math.abs(t.tpi[k]!)).toBeLessThan(0.05);
    }
    // A bump in the north-east corner shows up in the north-east of the arrays.
    // (1515, 795) is the centre of cell (125, 71).
    const b = build(gr, surface(gr, (x, y) => 500 + 200 * Math.exp(-((x - 1515) ** 2 + (y - 795) ** 2) / (2 * 300 ** 2))));
    const top = cellAt(gr, 1515, 795);
    expect(top).toBe(71 * gr.nx + 125);
    expect(b.elevation[top]).toBeCloseTo(700, 0);
    expect(b.landform[top]).toBe(Landform.Peak);
    expect(Math.abs(angleDiffDeg(b.aspectDeg[cellAt(gr, 1515, 495)]!, 180))).toBeLessThan(0.1); // south flank faces south
    expect(Math.abs(angleDiffDeg(b.aspectDeg[cellAt(gr, 1815, 795)]!, 90))).toBeLessThan(0.1); // east flank faces east
  });

  it('tiny grids do not crash and give finite fields', () => {
    for (const [nx, ny] of [
      [2, 2],
      [3, 5],
      [7, 2],
    ] as const) {
      const gt = { nx, ny, cellSize: 30, x0: 0, y0: 0, origin: { lat: -33.7, lon: 150.3 } };
      const t = build(gt, surface(gt, (x, y) => 500 + 0.1 * x + 0.05 * y));
      for (const f of [t.slopeDeg, t.dzdx, t.dzdy, t.tpi, t.curvature]) expect(f.every((v) => Number.isFinite(v))).toBe(true);
      expect(t.slopeDeg[0]).toBeCloseTo(Math.atan(Math.hypot(0.1, 0.05)) * RAD, 3);
      expect(Number.isFinite(reliefStats(t).meanTRI)).toBe(true);
    }
  });
});

describe('directional helpers', () => {
  const g = testGrid(2000, 20);
  const t = build(g, plane(g, 0, Math.tan(20 / RAD)));
  const k = cellAt(g, 0, 0);

  it('directionalSlopeDeg: + uphill, − downhill, 0 across', () => {
    expect(directionalSlopeDeg(t, k, 0)).toBeCloseTo(20, 4);
    expect(directionalSlopeDeg(t, k, 180)).toBeCloseTo(-20, 4);
    expect(directionalSlopeDeg(t, k, 90)).toBeCloseTo(0, 4);
    expect(directionalSlopeDeg(t, k, 45)).toBeCloseTo(Math.atan(Math.tan(20 / RAD) * Math.SQRT1_2) * RAD, 4);
  });

  it('upslopeAzimuth is opposite the aspect, NaN on flat ground', () => {
    expect(upslopeAzimuth(t, k)).toBeCloseTo(0, 4);
    const flat = build(g, plane(g, 0, 0));
    expect(Number.isNaN(upslopeAzimuth(flat, k))).toBe(true);
  });
});

describe('curvature, TPI and valley axes', () => {
  const g = testGrid(4000, 30);

  it('N–S valley draining south: concave, negative TPI, axis 0°, drains towards 180°', () => {
    const t = build(g, nsValley(g, 4e-4, 0.2));
    const k = cellAt(g, 0, 0);
    expect(t.curvature[k]).toBeLessThan(-5e-4); // ∇²z = 8e-4
    expect(t.curvature[k]).toBeCloseTo(-8e-4, 5);
    expect(t.tpi[k]).toBeLessThan(-5);
    expect(t.landform[k]).toBe(Landform.Gully); // slope ≈ 11°
    const ax = valleyAxisAzimuth(t, k);
    expect(Math.min(ax, 180 - ax)).toBeLessThan(1);
    expect(Math.abs(angleDiffDeg(downValleyAzimuth(t, k), 180))).toBeLessThan(1);
    const hs = hessianAt(t, k);
    expect(hs.lambdaMax).toBeCloseTo(8e-4, 5);
    expect(Math.abs(hs.lambdaMin)).toBeLessThan(1e-5);
    expect(hs.acrossValleyAzimuth).toBeCloseTo(90, 1);
    // An oblique valley (axis NE–SW).
    const rot = surface(g, (x, y) => {
      const c = Math.SQRT1_2;
      const across = x * c - y * c;
      const along = x * c + y * c;
      return 500 + 4e-4 * across * across + 0.15 * along;
    });
    const tr = build(g, rot);
    expect(Math.abs(angleDiffDeg(valleyAxisAzimuth(tr, k), 45))).toBeLessThan(1);
    expect(Math.abs(angleDiffDeg(downValleyAzimuth(tr, k), 225))).toBeLessThan(1);
  });

  it('V-shaped gully (planar walls, as asked for in docs/research/01 §4.1): convergent curvature at the axis only', () => {
    // 20° walls meeting at x = 0, the thalweg falling 8.5° towards the south.
    const wall = Math.tan(20 * DEG);
    const t = build(g, surface(g, (x, y) => 500 + wall * Math.abs(x) + 0.15 * y));
    const axis = cellAt(g, 0, 0);
    const d = terrainDerived(t);
    expect(t.curvature[axis]).toBeLessThan(-1e-3);
    expect(d.planCurvature[axis]).toBeLessThan(-1e-3); // convergent across the slope
    expect(t.landform[axis]).toBe(Landform.Gully);
    expect(Math.abs(angleDiffDeg(downValleyAzimuth(t, axis), 180))).toBeLessThan(2);
    // On the planar walls, well outside the ≈ 100 m smoothing footprint, the surface is not curved.
    for (const x of [-450, 450]) {
      const k = cellAt(g, x, 0);
      expect(Math.abs(t.curvature[k]!)).toBeLessThan(1e-5);
      expect(t.landform[k]).not.toBe(Landform.Gully);
      expect(t.aspectDeg[k]).toBeCloseTo((Math.atan2(-Math.sign(x) * wall, -0.15) * RAD + 360) % 360, 2);
    }
  });

  it('valley axis is undefined on a ridge or a plane', () => {
    const k = cellAt(g, 0, 0);
    expect(Number.isNaN(valleyAxisAzimuth(build(g, plane(g, 0.1, 0.1)), k))).toBe(true);
    expect(Number.isNaN(valleyAxisAzimuth(build(g, nsValley(g, -4e-4, 0.2)), k))).toBe(true);
  });

  it('TPI and curvature are positive on crests and negative in troughs', () => {
    const t = build(g, corrugated(g, 100, 1200));
    const crest = cellAt(g, 0, 0);
    const trough = cellAt(g, 600, 0);
    expect(t.tpi[crest]).toBeGreaterThan(20);
    expect(t.tpi[trough]).toBeLessThan(-20);
    expect(t.curvature[crest]).toBeGreaterThan(1e-3);
    expect(t.curvature[trough]).toBeLessThan(-1e-3);
    const d = terrainDerived(t);
    expect(d.tpiSmall[crest]).toBeGreaterThan(0);
    expect(d.tpiSmall[trough]).toBeLessThan(0);
  });
});

describe('landform classification', () => {
  const g = testGrid(6000, 30);

  it('level ridges and valleys: Ridge on crests, ValleyFloor in troughs, slopes in between', () => {
    // λ = 1200 m, amplitude 100 m → flanks up to 27.6°.
    const t = build(g, corrugated(g, 100, 1200));
    const ys = [-1500, -500, 0, 700, 1400];
    for (const c of classesAt(t, ys.map((y) => [0, y]))) expect(c).toBe(Landform.Ridge);
    for (const c of classesAt(t, ys.map((y) => [600, y]))) expect(c).toBe(Landform.ValleyFloor);
    for (const c of classesAt(t, ys.map((y) => [300, y]))) expect([Landform.MidSlope, Landform.UpperSlope, Landform.LowerSlope]).toContain(c);
    // Upper slope near the crest, lower slope near the trough.
    for (const c of classesAt(t, ys.map((y) => [150, y]))) expect([Landform.UpperSlope, Landform.Ridge, Landform.Spur]).toContain(c);
    for (const c of classesAt(t, ys.map((y) => [480, y]))) expect([Landform.LowerSlope, Landform.ValleyFloor, Landform.Gully]).toContain(c);
  });

  it('sloping ridges and valleys: Spurs on crests, Gullies in troughs', () => {
    // Same corrugation on a 14° regional slope rising north: crests become spurs, troughs gullies.
    const t = build(g, corrugated(g, 100, 1200, 0.25));
    const ys = [-1500, -500, 0, 700, 1400];
    for (const c of classesAt(t, ys.map((y) => [0, y]))) expect(c).toBe(Landform.Spur);
    for (const c of classesAt(t, ys.map((y) => [600, y]))) expect(c).toBe(Landform.Gully);
  });

  it('saddle between two summits: Saddle at the pass, Peaks at the summits', () => {
    const t = build(g, saddleRidge(g));
    expect(t.landform[cellAt(g, 0, 0)]).toBe(Landform.Saddle);
    expect(t.landform[cellAt(g, 30, -30)]).toBe(Landform.Saddle);
    expect(t.landform[cellAt(g, 1000, 0)]).toBe(Landform.Peak);
    expect(t.landform[cellAt(g, -1000, 0)]).toBe(Landform.Peak);
    // The ridge line between the pass and the summits is Ridge (or part of the saddle / peak zones).
    expect([Landform.Ridge, Landform.Saddle, Landform.Peak]).toContain(t.landform[cellAt(g, 500, 0)]);
    // Flanks well away from the crest are not saddles or peaks.
    let bad = 0;
    for (let k = 0; k < t.landform.length; k++) {
      const y = g.y0 + Math.floor(k / g.nx) * g.cellSize;
      if (Math.abs(y) > 500 && (t.landform[k] === Landform.Saddle || t.landform[k] === Landform.Peak)) bad++;
    }
    expect(bad).toBe(0);
    // The saddle is valley-like along the ridge: its trough axis is E–W.
    const ax = valleyAxisAzimuth(t, cellAt(g, 0, 0));
    expect(Number.isNaN(ax) || Math.abs(ax - 90) < 5).toBe(true);
  });

  it('cliffs: slopes over 45° are Cliff', () => {
    const t = build(g, surface(g, (x) => 500 + 300 / (1 + Math.exp(-x / 60)))); // max slope ≈ 51°
    expect(t.landform[cellAt(g, 0, 0)]).toBe(Landform.Cliff);
    expect(t.landform[cellAt(g, 1500, 0)]).not.toBe(Landform.Cliff);
    const m = build(g, mesa(g, 600, 150));
    expect(m.landform[cellAt(g, 300, 0)]).toBe(Landform.Cliff);
  });

  it('a uniform plane has no ridges, valleys, gullies or spurs', () => {
    const t = build(g, plane(g, 0.05, 0.2));
    const allowed = new Set([Landform.UpperSlope, Landform.MidSlope, Landform.LowerSlope]);
    for (let k = 0; k < t.landform.length; k++) expect(allowed.has(t.landform[k]!)).toBe(true);
  });

  it('thresholds can be overridden', () => {
    const t = buildTerrain(g, corrugated(g, 100, 1200), 'x', { thresholds: { cliffSlopeDeg: 20 } });
    expect(t.landform[cellAt(g, 300, 0)]).toBe(Landform.Cliff);
    expect(terrainDerived(t).thresholds.cliffSlopeDeg).toBe(20);
  });

  it('builds a 200×200 grid in < 200 ms', () => {
    const gg = testGrid(6000, 30);
    expect(gg.nx).toBe(200);
    const z = randomHills(gg, 7);
    buildTerrain(gg, z, 'warm-up');
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      buildTerrain(gg, z, 'perf');
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(200);
  });
});

describe('derived fields, relief and helpers', () => {
  it('terrainDerived survives a structured clone (worker transfer)', () => {
    const g = testGrid(2000, 20);
    const t = build(g, corrugated(g, 50, 800));
    const clone = structuredClone(t);
    const d0 = terrainDerived(t);
    const d1 = terrainDerived(clone);
    expect(d1).not.toBe(d0);
    expect(Array.from(d1.tpiSmall.slice(0, 50))).toEqual(Array.from(d0.tpiSmall.slice(0, 50)));
    expect(terrainDerived(clone)).toBe(d1); // cached after the first rebuild
  });

  it('slidingMinMax matches brute force', () => {
    const g = makeGridSpec({ lat: 0, lon: 0 }, 37 * 10, 10);
    const f = randomHills(g, 3, 10, 50);
    const r = 4;
    const { min, max } = slidingMinMax(g, f, r);
    for (let j = 0; j < g.ny; j += 3) {
      for (let i = 0; i < g.nx; i += 2) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let jj = Math.max(0, j - r); jj <= Math.min(g.ny - 1, j + r); jj++) {
          for (let ii = Math.max(0, i - r); ii <= Math.min(g.nx - 1, i + r); ii++) {
            const v = f[jj * g.nx + ii]!;
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
        expect(min[j * g.nx + i]).toBe(lo);
        expect(max[j * g.nx + i]).toBe(hi);
      }
    }
  });

  it('windShelter (Winstral Sx): lee slopes sheltered, windward slopes and crests exposed', () => {
    const g = testGrid(4000, 30);
    const t = build(g, ewRidge(g, 300, 400));
    const sx = windShelter(t, 0); // northerly wind: north flank windward, south flank lee
    expect(sx[cellAt(g, 0, 400)]).toBeLessThan(-10); // windward: ground upwind is lower
    expect(sx[cellAt(g, 0, -300)]).toBeGreaterThan(10); // lee: the crest upwind is higher
    expect(Math.abs(sx[cellAt(g, 0, 1900)]!)).toBeLessThan(1); // far from the ridge, nearly flat
    // Reversing the wind swaps the roles.
    const sxs = windShelter(t, 180);
    expect(sxs[cellAt(g, 0, 400)]).toBeGreaterThan(10);
    expect(sxs[cellAt(g, 0, -300)]).toBeLessThan(-10);
    // On a plane the upwind angle is just the slope along the wind.
    const p = build(g, plane(g, 0, Math.tan(15 / RAD)));
    expect(windShelter(p, 0)[cellAt(g, 0, 0)]).toBeCloseTo(15, 3);
    expect(windShelter(p, 180)[cellAt(g, 0, 0)]).toBeCloseTo(-15, 3);
  });

  it('heightAboveValley is the height above the lowest ground nearby (cold-air pool / thermal belt)', () => {
    const g = testGrid(4000, 20);
    const t = build(g, ewGorge(g, 400, 150));
    const d = terrainDerived(t);
    expect(d.heightAboveValley[cellAt(g, 0, 0)]).toBeCloseTo(0, 3);
    expect(d.heightAboveValley[cellAt(g, 0, 900)]).toBeCloseTo(400, -1);
    expect(d.localRelief[cellAt(g, 0, 300)]).toBeCloseTo(400, -1);
  });

  it('compass and aspect names', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(135)).toBe('SE');
    expect(compassPoint(-90)).toBe('W');
    expect(compassPoint(NaN)).toBe('');
    expect(aspectName(315)).toBe('north-west-facing');
    expect(aspectName(NaN)).toBe('flat');
  });

  it('reliefStats: flat vs mountainous', () => {
    const g = testGrid(4000, 30);
    const flat = reliefStats(build(g, plane(g, 0.001, 0)));
    expect(flat.reliefClass).toBe('flat');
    expect(flat.fractionSteep20).toBe(0);
    const mtn = reliefStats(build(g, corrugated(g, 200, 1500, 0.1)));
    expect(mtn.reliefClass).toBe('mountainous');
    expect(mtn.relief).toBeGreaterThan(400);
    expect(mtn.fractionSteep20).toBeGreaterThan(0.2);
    expect(mtn.landformFractions.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(mtn.meanTRI).toBeGreaterThan(5);
  });
});

describe.skipIf(!demoAvailable('katoomba'))('real terrain (bundled Blue Mountains demo DEMs)', () => {
  it('Katoomba escarpment: cliffs, gullies, ridges and saddles all present in sensible proportions', () => {
    const { grid, elevation } = loadDemoDem('katoomba', { lat: -33.715, lon: 150.285 }, 6000, 30);
    const t0 = performance.now();
    const t = buildTerrain(grid, elevation, 'demo');
    expect(performance.now() - t0).toBeLessThan(400);
    const r = reliefStats(t);
    expect(r.reliefClass).toBe('mountainous');
    expect(r.relief).toBeGreaterThan(400); // plateau ≈ 1000 m, Megalong/Jamison valleys ≈ 400 m
    const f = r.landformFractions;
    expect(f[Landform.Cliff]).toBeGreaterThan(0.01); // 300 m sandstone cliffs
    expect(f[Landform.Gully]).toBeGreaterThan(0.05);
    expect(f[Landform.Gully]).toBeLessThan(0.3);
    expect(f[Landform.Ridge]! + f[Landform.Spur]!).toBeGreaterThan(0.05);
    expect(f[Landform.Saddle]).toBeGreaterThan(0.002);
    expect(f[Landform.Saddle]).toBeLessThan(0.06);
    expect(f[Landform.Peak]).toBeLessThan(0.06);
    // Cliff cells sit in the steep escarpment band between the plateau and the valleys.
    let cliffRel = 0;
    let nCliff = 0;
    const d = terrainDerived(t);
    for (let k = 0; k < t.landform.length; k++) if (t.landform[k] === Landform.Cliff) (cliffRel += d.relPos[k]!), nCliff++;
    expect(cliffRel / nCliff).toBeGreaterThan(0.3);
    expect(cliffRel / nCliff).toBeLessThan(0.95);
  });

  it('Grose Valley: gully cells are lower in the landscape than ridge cells', () => {
    const { grid, elevation } = loadDemoDem('grose', { lat: -33.62, lon: 150.33 }, 6000, 30);
    const t = buildTerrain(grid, elevation, 'demo');
    const d = terrainDerived(t);
    const meanRel = (lf: Landform): number => {
      let s = 0;
      let c = 0;
      for (let k = 0; k < t.landform.length; k++) if (t.landform[k] === lf) (s += d.relPos[k]!), c++;
      return s / c;
    };
    expect(meanRel(Landform.Ridge)).toBeGreaterThan(meanRel(Landform.Gully) + 0.15);
    expect(meanRel(Landform.UpperSlope)).toBeGreaterThan(meanRel(Landform.LowerSlope));
  });
});
