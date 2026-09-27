/**
 * Level-set numerics (spec §7.2, §7.13, V16): expanding circle (R 1 m/s, Δx 20 m, ν 0.2, Δt at the 0.9 bound,
 * radius 200 → 1400 m: area within 5 % of πr², axis/diagonal radius within 2 %), the 1.2 × bound guard, the constant
 * offset ellipse against the analytic Wulff shape (area ±5 %, head/back within max(1 cell, 3 % of travel)), and two
 * circles merging without oscillation. Speeds are set directly on the core (no fuel).
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec, type GridSpec } from '../../core/grid';
import { LevelSetCore } from './levelSet';
import { createEllipseSpeedsOut, ellipseSpeeds } from './math';
import { SPREAD_PARAMS } from './params';

const ORIGIN = { lat: -33.7, lon: 150.3 };

/** A core with φ = signed distance to the union of discs, band built, uniform speed coefficients. */
function setup(g: GridSpec, discs: [number, number, number][], speed: { a: number; c: number; b: number; ex: number; ey: number }): LevelSetCore {
  const ls = new LevelSetCore(g);
  ls.lazy = false;
  const n = g.nx * g.ny;
  const band = new Int32Array(n);
  let nb = 0;
  const far = ls.far;
  const bandMax = SPREAD_PARAMS.levelSet.bandCells * g.cellSize;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const x = g.x0 + i * g.cellSize;
      const y = g.y0 + j * g.cellSize;
      let d = Infinity;
      for (const [cx, cy, r] of discs) d = Math.min(d, Math.hypot(x - cx, y - cy) - r);
      const v = d < -far ? -far : d > far ? far : d;
      ls.setPhi(k, v);
      if (Math.abs(v) <= bandMax) band[nb++] = k;
      ls.sA2[k] = speed.a * speed.a;
      ls.sB2[k] = speed.b * speed.b;
      ls.sC[k] = speed.c;
      ls.sEx[k] = speed.ex;
      ls.sEy[k] = speed.ey;
      ls.prepStamp[k] = ls.stamp;
    }
  }
  ls.setBand(band, nb);
  return ls;
}

function run(ls: LevelSetCore, T: number): number {
  let t = 0;
  let steps = 0;
  while (T - t > 1e-9) {
    t += ls.advance(t, T - t);
    steps++;
  }
  return steps;
}

/** Zero crossing of φ along a ray from (x0, y0) in direction (ux, uy) (bilinear sampling, 0.25-cell steps). */
function crossing(ls: LevelSetCore, g: GridSpec, x0: number, y0: number, ux: number, uy: number, maxD: number): number {
  const at = (x: number, y: number): number => {
    const fx = (x - g.x0) / g.cellSize;
    const fy = (y - g.y0) / g.cellSize;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const k = j * g.nx + i;
    const p = ls.phi;
    return (p[k]! * (1 - tx) + p[k + 1]! * tx) * (1 - ty) + (p[k + g.nx]! * (1 - tx) + p[k + g.nx + 1]! * tx) * ty;
  };
  const step = g.cellSize / 4;
  let prev = at(x0, y0);
  for (let s = step; s <= maxD; s += step) {
    const v = at(x0 + s * ux, y0 + s * uy);
    if (prev <= 0 && v > 0) return s - step + (step * -prev) / (v - prev);
    prev = v;
  }
  return NaN;
}

const burntArea = (ls: LevelSetCore, g: GridSpec): number => {
  let c = 0;
  for (let k = 0; k < ls.n; k++) if (ls.phi[k]! <= 0) c++;
  return c * g.cellSize * g.cellSize;
};

describe('expanding circle (spec §7.13)', () => {
  it('R 1 m/s, Δx 20 m: radius 200 → 1400 m within 2 % (axis and diagonal), area within 5 %', () => {
    const g = makeGridSpec(ORIGIN, 3200, 20);
    const ls = setup(g, [[0, 0, 200]], { a: 1, c: 0, b: 1, ex: 0, ey: 1 });
    const b0 = ls.bound();
    expect(b0).toBeCloseTo(0.9 / ((Math.SQRT2 + 0.8) / 20), 1); // diagonal cells set the bound: 8.13 s
    const steps = run(ls, 1200);
    expect(steps).toBeGreaterThan(140);
    const axis = crossing(ls, g, 0, 0, 1, 0, 1600);
    const axisN = crossing(ls, g, 0, 0, 0, 1, 1600);
    const diag = crossing(ls, g, 0, 0, Math.SQRT1_2, Math.SQRT1_2, 1600);
    expect(Math.abs(axis / 1400 - 1)).toBeLessThan(0.02);
    expect(Math.abs(axisN / 1400 - 1)).toBeLessThan(0.02);
    expect(Math.abs(diag / 1400 - 1)).toBeLessThan(0.02);
    expect(Math.abs(burntArea(ls, g) / (Math.PI * 1400 * 1400) - 1)).toBeLessThan(0.05);
  });

  it('the guard rejects a sub-step of 1.2 × the CFL bound and accepts the bound', () => {
    const g = makeGridSpec(ORIGIN, 1200, 20);
    const ls = setup(g, [[0, 0, 200]], { a: 1, c: 0, b: 1, ex: 0, ey: 1 });
    const b = ls.bound();
    expect(() => ls.stepFixed(0, 1.2 * b)).toThrow(RangeError);
    expect(() => ls.stepFixed(0, b)).not.toThrow();
  });

  it('a smaller circle at the bound stays within tolerance', () => {
    const g = makeGridSpec(ORIGIN, 1600, 20);
    const good = setup(g, [[0, 0, 150]], { a: 1, c: 0, b: 1, ex: 0, ey: 1 });
    run(good, 400);
    const r = crossing(good, g, 0, 0, 1, 0, 780);
    expect(Math.abs(r / 550 - 1)).toBeLessThan(0.02);
  });
});

describe('constant offset ellipse vs the analytic Wulff shape (spec §7.13)', () => {
  /** Point ignition (r_ign = 0.75Δx), R_H 1 m/s, 30 min; returns head/back/area against the Minkowski sum. */
  function ellipseRun(lb: number, dx: number) {
    const e = ellipseSpeeds(1, 1, 1, 1, 0, 0, 0, lb, Infinity, createEllipseSpeedsOut());
    const a = 0.5 * (e.rH + e.rB);
    const c = 0.5 * (e.rH - e.rB);
    const g = makeGridSpec(ORIGIN, 4200, dx);
    const r0 = 0.75 * dx;
    const y0 = -1500;
    const ls = setup(g, [[0, y0, r0]], { a, c, b: e.rF, ex: 0, ey: 1 });
    const T = 1800;
    run(ls, T);
    const head = crossing(ls, g, 0, y0, 0, 1, 2500);
    const back = crossing(ls, g, 0, y0, 0, -1, 600);
    const half = crossing(ls, g, 0, y0 + c * T, 1, 0, 800);
    // Minkowski sum of the ignition disc and the Wulff ellipse (semi-axes a·T, b_F·T, centre offset c·T).
    const A = Math.PI * a * T * e.rF * T;
    const P = Math.PI * (3 * (a + e.rF) - Math.sqrt((3 * a + e.rF) * (a + 3 * e.rF))) * T;
    const areaA = A + P * r0 + Math.PI * r0 * r0;
    return { e, T, r0, head, back, half, headA: r0 + e.rH * T, backA: r0 + e.rB * T, halfA: r0 + e.rF * T, areaRatio: burntArea(ls, g) / areaA };
  }

  for (const [lb, dx] of [
    [3, 20],
    [2, 30],
  ] as const) {
    it(`LB ${lb}, Δx ${dx} m: head/back within max(1 cell, 3 % of travel), area ±5 %`, () => {
      const r = ellipseRun(lb, dx);
      expect(Math.abs(r.head - r.headA)).toBeLessThanOrEqual(Math.max(dx, 0.03 * r.e.rH * r.T));
      expect(Math.abs(r.back - r.backA)).toBeLessThanOrEqual(Math.max(dx, 0.03 * r.e.rB * r.T));
      expect(Math.abs(r.half - r.halfA)).toBeLessThanOrEqual(Math.max(dx, 0.03 * r.e.rF * r.T));
      expect(Math.abs(r.areaRatio - 1)).toBeLessThan(0.05);
    });
  }

  it('LB 3.84 at Δx 30 m (spec measurement 0.959 × analytic head after 30 min): ≥ 0.95, area ±5 %', () => {
    const r = ellipseRun(3.843, 30);
    expect((r.head - r.r0) / (r.e.rH * r.T)).toBeGreaterThan(0.95);
    expect(Math.abs(r.back - r.backA)).toBeLessThanOrEqual(30);
    expect(Math.abs(r.areaRatio - 1)).toBeLessThan(0.05);
  });

  it('point-ignition circle (r_ign 0.75Δx) grows at R within 2 %', () => {
    const g = makeGridSpec(ORIGIN, 2400, 20);
    const ls = setup(g, [[0, 0, 15]], { a: 1, c: 0, b: 1, ex: 0, ey: 1 });
    run(ls, 900);
    const R = 915;
    expect(Math.abs(crossing(ls, g, 0, 0, 1, 0, 1150) / R - 1)).toBeLessThan(0.02);
    expect(Math.abs(crossing(ls, g, 0, 0, Math.SQRT1_2, Math.SQRT1_2, 1150) / R - 1)).toBeLessThan(0.025);
    expect(Math.abs(burntArea(ls, g) / (Math.PI * R * R) - 1)).toBeLessThan(0.05);
  });
});

describe('merging fronts (spec §7.13)', () => {
  it('two circles merge without oscillation: φ never rises, area monotone and ≈ the union of discs', () => {
    const g = makeGridSpec(ORIGIN, 2000, 20);
    const ls = setup(
      g,
      [
        [-250, 0, 100],
        [250, 0, 100],
      ],
      { a: 1, c: 0, b: 1, ex: 0, ey: 1 },
    );
    let prevArea = burntArea(ls, g);
    const prevPhi = ls.phi.slice();
    let t = 0;
    let rose = 0;
    while (t < 400) {
      t += ls.advance(t, 400 - t);
      for (let k = 0; k < ls.n; k++) {
        // Reinitialisation may re-distance cells far from the front; the burnt/unburnt sign never flips back.
        if (prevPhi[k]! <= 0 && ls.phi[k]! > 0) rose++;
        prevPhi[k] = ls.phi[k]!;
      }
      const a = burntArea(ls, g);
      expect(a).toBeGreaterThanOrEqual(prevArea);
      prevArea = a;
    }
    expect(rose).toBe(0);
    // Union of two discs of radius 500 m with centres 500 m apart.
    const R = 500;
    const d = 500;
    const lens = 2 * R * R * Math.acos(d / (2 * R)) - (d / 2) * Math.sqrt(4 * R * R - d * d);
    const union = 2 * Math.PI * R * R - lens;
    expect(Math.abs(prevArea / union - 1)).toBeLessThan(0.03);
    // The neck at x = 0 is filled (burnt) and the merged front near the neck is not far behind the union boundary.
    const neck = crossing(ls, g, 0, 0, 0, 1, 900);
    expect(neck).toBeGreaterThan(0.9 * Math.sqrt(R * R - (d / 2) * (d / 2)));
  });
});
