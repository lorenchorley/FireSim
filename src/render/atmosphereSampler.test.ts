/**
 * Sampler v2 (plan section 7.2): both layouts, the guards, the allocation contract, and the oracle, which is the engine's
 * own `sample()` (the arithmetic the sampler repeats). The tests that need a real Atmosphere build a small one on a
 * synthetic ridge; the published view itself is checked against the engine in atmosphere/airView.oracle.test.ts.
 */
import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { Atmosphere } from '../atmosphere/atmosphere';
import { buildAtmosGrid, type AtmosGrid } from '../atmosphere/grid';
import { analyticTerrain, featuresDouble, fuelDouble, hour, seriesOf } from '../atmosphere/testUtils';
import { sampleBilinear } from '../core/grid';
import { Rng } from '../core/rng';
import type { AtmosphereView, Terrain, WeatherHour } from '../core/types';
import { AtmosphereSampler } from './atmosphereSampler';

const AMBIENT: WeatherHour = { time: 0, temperature: 30, relativeHumidity: 20, windSpeed10: 5, windDir10: 270 };

// ─────────────────────────────────────────────────────────────────────────────
// A terrain-following view with analytic fields, on a real atmosphere grid over a ridge
// ─────────────────────────────────────────────────────────────────────────────

const ridge = analyticTerrain(6000, 100, (x) => 600 + 700 * Math.exp(-((x / 700) ** 2)));
const AG: AtmosGrid = buildAtmosGrid(ridge, undefined, undefined, 'standard', 6000);

/** Every field is linear in ζ and in x, y, so the blend of the four columns has a closed form (below). */
const F = {
  u: { a: 4, b: 0.012, c: 0.0008, d: -0.0003 },
  v: { a: -2, b: -0.004, c: 0.0002, d: 0.0006 },
  w: { a: 0.3, b: 0.0015, c: -0.0001, d: 0.0002 },
  th: { a: 1, b: -0.002, c: 0.0004, d: 0.0001 },
  sm: { a: 5, b: 0.01, c: 0.0005, d: 0.0003 },
};
type FieldCoef = (typeof F)['u'];

function tfView(extra: Partial<AtmosphereView> = {}): AtmosphereView {
  const g = AG;
  const n = g.plane * g.nz;
  const make = (f: FieldCoef): Float32Array => {
    const a = new Float32Array(n);
    for (let k = 0; k < g.nz; k++) {
      for (let c = 0; c < g.plane; c++) {
        const x = g.grid.x0 + (c % g.nx) * g.dx;
        const y = g.grid.y0 + Math.floor(c / g.nx) * g.dx;
        a[k * g.plane + c] = f.a + f.b * g.zetaC[k]! + f.c * x + f.d * y;
      }
    }
    return a;
  };
  return {
    grid: g.grid,
    nz: g.nz,
    levels: Float32Array.from(g.zetaC),
    terrainHeight: Float32Array.from({ length: g.plane }, (_, c) => g.zs[c]! - g.zMin),
    layout: 'terrain-following',
    kind: 'prognostic',
    topM: g.Hp,
    baseM: g.zMin,
    time: 1234,
    surfaceU: new Float32Array(g.plane).fill(3),
    surfaceV: new Float32Array(g.plane).fill(-1),
    u: make(F.u),
    v: make(F.v),
    w: make(F.w),
    thetaAnomaly: make(F.th),
    smoke: make(F.sm),
    ...extra,
  };
}

/** The closed form of a field at (x, y, zAsl): a + b · Σ wq ζq + c x + d y, ζq clamped to the first and last level centre. */
function closedForm(f: FieldCoef, x: number, y: number, zAsl: number): number {
  const g = AG;
  const fx = Math.min(Math.max((x - g.grid.x0) / g.dx, 0), g.nx - 1);
  const fy = Math.min(Math.max((y - g.grid.y0) / g.dx, 0), g.ny - 1);
  const i0 = Math.min(Math.floor(fx), g.nx - 2);
  const j0 = Math.min(Math.floor(fy), g.ny - 2);
  const tx = fx - i0;
  const ty = fy - j0;
  let zsum = 0;
  for (let q = 0; q < 4; q++) {
    const c = (j0 + (q >> 1)) * g.nx + i0 + (q & 1);
    const wq = (q & 1 ? tx : 1 - tx) * (q >> 1 ? ty : 1 - ty);
    const zeta = (zAsl - g.zs[c]!) / g.J[c]!;
    zsum += wq * Math.min(Math.max(zeta, g.zetaC[0]!), g.zetaC[g.nz - 1]!);
  }
  const xc = Math.min(Math.max(x, g.grid.x0), g.grid.x0 + (g.nx - 1) * g.dx);
  const yc = Math.min(Math.max(y, g.grid.y0), g.grid.y0 + (g.ny - 1) * g.dx);
  return f.a + f.b * zsum + f.c * xc + f.d * yc;
}

function points(n: number, seed: number): Array<[number, number, number]> {
  const rng = new Rng(seed);
  const g = AG;
  const out: Array<[number, number, number]> = [];
  for (let q = 0; q < n; q++) {
    const x = g.grid.x0 + rng.range(0.2, g.nx - 1.2) * g.dx;
    const y = g.grid.y0 + rng.range(0.2, g.ny - 1.2) * g.dx;
    const ground = sampleBilinear(g.grid, Float32Array.from({ length: g.plane }, (_, c) => g.zs[c]!), x, y);
    out.push([x, y, ground + rng.range(0, 1800)]);
  }
  return out;
}

describe('sampler v2, terrain-following layout', () => {
  const view = tfView();
  const s = new AtmosphereSampler(view, 0, AMBIENT);

  it('reproduces fields that are linear in ζ, x and y exactly (closed form), from the ground to the top', () => {
    const pos = new Float64Array(4);
    const out = new Float32Array(5);
    let worst = 0;
    for (const [x, y, z] of points(400, 11)) {
      pos[0] = x;
      pos[1] = y;
      pos[2] = z;
      s.fieldsP(pos, out);
      const want = [closedForm(F.u, x, y, z), closedForm(F.v, x, y, z), closedForm(F.w, x, y, z), closedForm(F.th, x, y, z), closedForm(F.sm, x, y, z)];
      for (let k = 0; k < 5; k++) worst = Math.max(worst, Math.abs(out[k]! - want[k]!));
    }
    expect(worst).toBeLessThan(2e-4);
  });

  it('gives the same answer through windP, fieldsP, wind, theta, smoke and sample3', () => {
    const pos = new Float64Array(4);
    const a = new Float32Array(5);
    const b = new Float32Array(3);
    const c = [0, 0, 0];
    for (const [x, y, z] of points(60, 12)) {
      pos[0] = x;
      pos[1] = y;
      pos[2] = z;
      s.fieldsP(pos, a);
      s.windP(pos, b);
      s.wind(x, y, z, 100, c);
      for (let k = 0; k < 3; k++) {
        expect(b[k]).toBe(a[k]);
        expect(c[k]).toBeCloseTo(a[k]!, 4); // wind() writes to a number[]: no float32 rounding
      }
      expect(s.theta(x, y, z)).toBeCloseTo(a[3]!, 5);
      expect(s.smoke(x, y, z)).toBeCloseTo(a[4]!, 5);
      expect(s.sample3(view.u, x, y, z)).toBeCloseTo(a[0]!, 5);
    }
  });

  it('takes the first level below its centre and the top level above the top, never zero and never NaN', () => {
    const x = AG.grid.x0 + 20.3 * AG.dx;
    const y = AG.grid.y0 + 22.6 * AG.dx;
    const ground = (() => {
      const c = 22 * AG.nx + 20;
      return AG.zs[c]!;
    })();
    const lowest = closedForm(F.u, x, y, ground + 0.001);
    const out = [0, 0, 0];
    for (const dz of [-50, -1, 0, 0.5, 1]) {
      s.wind(x, y, ground + dz, 1, out);
      expect(out[0]).toBeCloseTo(lowest, 2); // all of these are below level 0 (about 15 m up): its value
      expect(out[0]).not.toBe(0);
    }
    s.wind(x, y, AG.zMin + AG.Hp + 5000, 5000, out);
    expect(Number.isFinite(out[0]!)).toBe(true);
    expect(out[0]).toBeCloseTo(closedForm(F.u, x, y, AG.zMin + AG.Hp + 5000), 2);
  });

  it('clamps points outside the grid to the edge column', () => {
    const out = [0, 0, 0];
    const o2 = [0, 0, 0];
    s.wind(AG.grid.x0 - 5000, AG.grid.y0 + 3 * AG.dx, 900, 50, out);
    s.wind(AG.grid.x0, AG.grid.y0 + 3 * AG.dx, 900, 50, o2);
    expect(out[0]).toBeCloseTo(o2[0]!, 5);
    s.wind(AG.grid.x0 + 1e6, AG.grid.y0 + 1e6, 900, 50, out);
    s.wind(AG.grid.x0 + (AG.nx - 1) * AG.dx, AG.grid.y0 + (AG.ny - 1) * AG.dx, 900, 50, o2);
    expect(out[1]).toBeCloseTo(o2[1]!, 5);
  });

  it('is a function of its position only: interleaved lookups do not leak scratch state', () => {
    const ps = points(20, 13);
    const run = (order: number[]): Float32Array[] => {
      const res: Float32Array[] = new Array(ps.length);
      const pos = new Float64Array(4);
      for (const i of order) {
        const o = new Float32Array(5);
        [pos[0], pos[1], pos[2]] = ps[i]!;
        s.fieldsP(pos, o);
        res[i] = o;
      }
      return res;
    };
    const fwd = run(ps.map((_, i) => i));
    const back = run(ps.map((_, i) => ps.length - 1 - i));
    for (let i = 0; i < ps.length; i++) expect(Buffer.from(fwd[i]!.buffer).equals(Buffer.from(back[i]!.buffer))).toBe(true);
  });

  it('knows its datum, top, kind, layout and air time, and the model ground', () => {
    expect(s.base).toBe(AG.zMin);
    expect(s.top).toBeCloseTo(AG.zMin + AG.Hp, 6);
    expect(s.kind).toBe('prognostic');
    expect(s.layout).toBe('terrain-following');
    expect(s.airTime).toBe(1234);
    // The view's own datum wins over the caller's estimate.
    expect(new AtmosphereSampler(view, 123, AMBIENT).base).toBe(AG.zMin);
    // The model's ground under the ridge crest is the smoothed terrain, in m ASL.
    const c = 22 * AG.nx + 22;
    const x = AG.grid.x0 + 22 * AG.dx;
    const y = AG.grid.y0 + 22 * AG.dx;
    expect(s.modelGroundAt(x, y)).toBeCloseTo(AG.zs[c]!, 3);
    expect(s.modelGroundAt(x + 0.5 * AG.dx, y)).toBeCloseTo(0.5 * (AG.zs[c]! + AG.zs[c + 1]!), 3);
  });

  it('keeps its pre-existing lookups: surfaceWind and sample2 stay bilinear', () => {
    const o = [0, 0];
    s.surfaceWind(AG.grid.x0 + 7.4 * AG.dx, AG.grid.y0 + 9.1 * AG.dx, o);
    expect(o[0]).toBeCloseTo(3, 6);
    expect(o[1]).toBeCloseTo(-1, 6);
  });
});

describe('sampler v2, the views that hold less than a full 3-D volume', () => {
  const empty = new Float32Array(0);

  it('a diagnosed view (wind only): temperature and smoke read 0 instead of NaN, the wind is real', () => {
    const view = tfView({ kind: 'diagnosed', thetaAnomaly: empty, smoke: empty });
    const s = new AtmosphereSampler(view, 0, AMBIENT);
    expect(s.kind).toBe('diagnosed');
    expect([s.hasWind, s.hasTheta, s.hasSmoke]).toEqual([true, false, false]);
    const [x, y, z] = points(1, 3)[0]!;
    expect(s.theta(x, y, z)).toBe(0);
    expect(s.smoke(x, y, z)).toBe(0);
    expect(s.sample3(empty, x, y, z)).toBe(0);
    const out = new Float32Array(5);
    s.fieldsP(Float64Array.of(x, y, z, 50), out);
    expect(out[0]).toBeCloseTo(closedForm(F.u, x, y, z), 3);
    expect(out[3]).toBe(0);
    expect(out[4]).toBe(0);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });

  it('a surface-only view (nz 0): the wind is the ambient profile, the 3-D fields read 0, the surface wind is the view’s', () => {
    const view: AtmosphereView = { ...tfView(), nz: 0, levels: empty, u: empty, v: empty, w: empty, thetaAnomaly: empty, smoke: empty, layout: undefined, kind: undefined, topM: undefined };
    const s = new AtmosphereSampler(view, 0, AMBIENT);
    expect(s.kind).toBe('surface');
    expect(s.hasWind).toBe(false);
    const o = [9, 9, 9];
    s.wind(0, 0, 900, 10, o);
    expect(o[0]).toBeCloseTo(5, 5); // a westerly of 5 m/s blows towards the east; 10 m above ground is the reference height
    expect(o[2]).toBe(0);
    const out = new Float32Array(5);
    s.windP(Float64Array.of(0, 0, 900, 10), out);
    expect(out[0]).toBeCloseTo(5, 5);
    expect(s.theta(0, 0, 900)).toBe(0);
    const sw = [0, 0];
    s.surfaceWind(0, 0, sw);
    expect(sw[0]).toBeCloseTo(3, 6);
  });

  it('no view at all: the ambient wind and the datum, as before', () => {
    const s = new AtmosphereSampler(null, 250, AMBIENT);
    expect(s.base).toBe(250);
    expect(s.top).toBe(3250);
    expect(s.kind).toBe('none');
    expect(s.airTime).toBeNull();
    expect(s.modelGroundAt(0, 0)).toBe(250);
    const o = [0, 0, 0];
    s.wind(0, 0, 400, 10, o);
    expect(o[0]).toBeCloseTo(5, 5);
  });

  it('a view with too short an array is not trusted for that field', () => {
    const view = tfView({ w: new Float32Array(AG.plane * AG.nz - 1) });
    const s = new AtmosphereSampler(view, 0, AMBIENT);
    expect(s.hasWind).toBe(false);
    const o = [0, 0, 0];
    s.wind(0, 0, 900, 100, o);
    expect(Number.isFinite(o[0]! + o[1]! + o[2]!)).toBe(true);
    expect(s.hasTheta).toBe(true);
  });

  it('a terrain-following view without its terrain heights is not sampled as if it were flat', () => {
    const view = tfView({ terrainHeight: new Float32Array(3) });
    const s = new AtmosphereSampler(view, 0, AMBIENT);
    expect(s.hasWind).toBe(false);
  });

  it('a one-level view blends without reading past its array', () => {
    const g = AG;
    const one = (f: number): Float32Array => new Float32Array(g.plane).fill(f);
    const view: AtmosphereView = { ...tfView(), nz: 1, levels: Float32Array.of(20), u: one(2), v: one(3), w: one(0.5), thetaAnomaly: one(1), smoke: one(0) };
    const s = new AtmosphereSampler(view, 0, AMBIENT);
    const out = new Float32Array(5);
    for (const z of [g.zMin - 50, g.zMin + 20, g.zMin + 2000]) {
      s.fieldsP(Float64Array.of(g.grid.x0 + 11.5 * g.dx, g.grid.y0 + 14.2 * g.dx, z), out);
      expect([out[0], out[1], out[2], out[3], out[4]]).toEqual([2, 3, 0.5, 1, 0]);
    }
  });
});

describe('sampler v2, flat layout (views made before the terrain-following layout existed)', () => {
  const flatView = (): AtmosphereView => {
    const g = AG;
    const nz = 5;
    const levels = Float32Array.from([50, 150, 300, 600, 1000]);
    const f = (fn: (i: number, z: number) => number): Float32Array => {
      const a = new Float32Array(g.plane * nz);
      for (let z = 0; z < nz; z++) for (let c = 0; c < g.plane; c++) a[z * g.plane + c] = fn(c % g.nx, z);
      return a;
    };
    return { grid: g.grid, nz, levels, terrainHeight: new Float32Array(g.plane), surfaceU: new Float32Array(g.plane), surfaceV: new Float32Array(g.plane), u: f((i) => i), v: f(() => 0), w: f((_i, z) => z), thetaAnomaly: f(() => 2), smoke: f(() => 1) };
  };

  it('interpolates in height above the datum, shared by all four columns, and clamps at both ends', () => {
    const s = new AtmosphereSampler(flatView(), 200, AMBIENT);
    expect(s.layout).toBe('flat');
    expect(s.kind).toBe('prognostic');
    const x = AG.grid.x0 + 10.5 * AG.dx;
    const y = AG.grid.y0 + 5 * AG.dx;
    const o = [0, 0, 0];
    s.wind(x, y, 200 + 225, 225, o); // halfway between levels 1 and 2
    expect(o[0]).toBeCloseTo(10.5, 4);
    expect(o[2]).toBeCloseTo(1.5, 4);
    s.wind(x, y, 200, 1, o);
    expect(o[2]).toBeCloseTo(0, 6);
    s.wind(x, y, 200 + 5000, 1, o);
    expect(o[2]).toBeCloseTo(4, 6);
    expect(s.theta(x, y, 200 + 400)).toBeCloseTo(2, 6);
    expect(s.top).toBeCloseTo(200 + 1000 + 200, 6); // last level plus half the last gap
  });

  it('agrees with the terrain-following path where the two describe the same air (flat levels, no terrain)', () => {
    // A terrain-following view over level ground (h0 = 0, J = 1) is the flat view: same numbers, same answers.
    const flat = flatView();
    const tf: AtmosphereView = { ...flat, layout: 'terrain-following', topM: 3000, baseM: 200 };
    const a = new AtmosphereSampler(flat, 200, AMBIENT);
    const b = new AtmosphereSampler(tf, 0, AMBIENT);
    const p = Float64Array.of(0, 0, 0, 0);
    const oa = new Float32Array(5);
    const ob = new Float32Array(5);
    const rng = new Rng(5);
    for (let q = 0; q < 200; q++) {
      p[0] = AG.grid.x0 + rng.range(0, AG.nx - 1) * AG.dx;
      p[1] = AG.grid.y0 + rng.range(0, AG.ny - 1) * AG.dx;
      p[2] = 200 + rng.range(-20, 1300);
      a.fieldsP(p, oa);
      b.fieldsP(p, ob);
      for (let k = 0; k < 5; k++) expect(oa[k]).toBeCloseTo(ob[k]!, 5);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The allocation contract (spike S3: a call with double arguments and a boxed result is 48 bytes)
// ─────────────────────────────────────────────────────────────────────────────

let gcFn: (() => void) | null = null;
function gc(): void {
  if (!gcFn) {
    v8.setFlagsFromString('--expose-gc');
    gcFn = vm.runInNewContext('gc') as () => void;
  }
  gcFn();
}

describe('sampler v2, allocation', () => {
  it('windP and fieldsP allocate nothing in steady state (median heap growth of 2000-call windows under 2 bytes per call)', () => {
    const view = tfView();
    const s = new AtmosphereSampler(view, 0, AMBIENT);
    const pts = points(256, 21);
    const pos = new Float64Array(4);
    const out = new Float32Array(5);
    // The loops a glyph or slice builder would write: positions through the scratch array, no result object.
    const loopW = (n: number): number => {
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const p = pts[i & 255]!;
        pos[0] = p[0];
        pos[1] = p[1];
        pos[2] = p[2];
        s.windP(pos, out);
        acc += out[0]!;
      }
      return acc;
    };
    const loopF = (n: number): number => {
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const p = pts[i & 255]!;
        pos[0] = p[0];
        pos[1] = p[1];
        pos[2] = p[2];
        s.fieldsP(pos, out);
        acc += out[4]!;
      }
      return acc;
    };
    for (const [name, loop] of [['windP', loopW], ['fieldsP', loopF]] as const) {
      // Warm up so that V8 has optimised the loop (unoptimised code boxes every double it computes). On a busy machine the
      // optimising compile can take a while to land, so the measurement is repeated, with more warm-up between, for up to 4 s:
      // code that allocates never gets under the limit, whatever it is given.
      let sink = 0;
      for (let r = 0; r < 60; r++) sink += loop(5000);
      const WINDOW = 2000;
      let median = Infinity;
      const started = Date.now();
      do {
        gc();
        gc();
        const d: number[] = [];
        for (let r = 0; r < 41; r++) {
          const a0 = process.memoryUsage().heapUsed;
          sink += loop(WINDOW);
          const a1 = process.memoryUsage().heapUsed;
          d.push(a1 - a0);
        }
        d.sort((p, q) => p - q);
        median = d[d.length >> 1]!;
        if (median / WINDOW >= 2) for (let r = 0; r < 40; r++) sink += loop(5000);
      } while (median / WINDOW >= 2 && Date.now() - started < 4000);
      // The speed of the same loop, for the log (not asserted: a shared machine). Spike S3 measured 143 ns for its hand-inlined u, v sampler.
      const t0 = performance.now();
      sink += loop(300_000);
      const ns = ((performance.now() - t0) * 1e6) / 300_000;
      process.stderr.write(`[sampler perf] ${name}: ${ns.toFixed(0)} ns per call, ${(median / WINDOW).toFixed(2)} bytes per call (median of 41 windows of ${WINDOW})\n`);
      expect(Number.isFinite(sink), name).toBe(true);
      // A boxed call would add at least 48 bytes x 2000 = 96 kB to every window; reading the heap twice adds a few hundred bytes.
      expect(median / WINDOW, `${name}: bytes per call`).toBeLessThan(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The oracle: the engine's own sample() on a real Atmosphere
// ─────────────────────────────────────────────────────────────────────────────

const HOURS: WeatherHour[] = [0, 1].map((q) => hour(Date.UTC(2025, 0, 5, q), 8, 270));

function realAtmosphere(terrain: Terrain, spinS: number): Atmosphere {
  const a = new Atmosphere(terrain, undefined, fuelDouble(terrain.grid), featuresDouble(terrain), 'standard', 6000, seriesOf(HOURS, { sourceElevation: 600 }), new Rng(3));
  a.setAmbient(HOURS[0]!, HOURS[1]!);
  a.setTime(HOURS[0]!.time);
  let t = 0;
  while (t < spinS) {
    const dt = Math.min(a.maxStableDt(), spinS - t);
    a.step(dt);
    t += dt;
  }
  return a;
}

/** The engine's native arrays as a terrain-following view (what Atmosphere.view() publishes since the layout change). */
function nativeView(a: Atmosphere): AtmosphereView {
  const g = a.grid;
  const s = a.state;
  return {
    grid: g.grid,
    nz: g.nz,
    levels: Float32Array.from(g.zetaC),
    terrainHeight: Float32Array.from({ length: g.plane }, (_, c) => g.zs[c]! - g.zMin),
    layout: 'terrain-following',
    kind: 'prognostic',
    topM: g.Hp,
    baseM: g.zMin,
    surfaceU: new Float32Array(g.plane),
    surfaceV: new Float32Array(g.plane),
    u: s.uc.slice(),
    v: s.vc.slice(),
    w: s.wc.slice(),
    thetaAnomaly: s.theta.slice(),
    smoke: s.smoke.slice(),
  };
}

describe('sampler v2 against the engine’s own sample() (a real Atmosphere over a 700 m ridge)', () => {
  const ridgeTerrain = analyticTerrain(6000, 40, (x) => 500 + 700 * Math.exp(-((x / 600) ** 2)));
  const atm = realAtmosphere(ridgeTerrain, 150);
  const view = nativeView(atm);
  const s = new AtmosphereSampler(view, 0, AMBIENT);
  const tg = ridgeTerrain.grid;

  /** Random points over the whole domain, with heights above the ground that stress the bottom of the column. */
  function oraclePoints(n: number): Array<{ x: number; y: number; agl: number }> {
    const rng = new Rng(77);
    const heights = [0, 0.5, 2, 5, 10, 30, 60, 100, 250, 600, 1200, 2000];
    return Array.from({ length: n }, (_, q) => ({
      x: tg.x0 + rng.range(0.05, 0.95) * (tg.nx - 1) * tg.cellSize,
      y: tg.y0 + rng.range(0.05, 0.95) * (tg.ny - 1) * tg.cellSize,
      agl: heights[q % heights.length]!,
    }));
  }

  it('equals atm.sample at 1200 random points from the ground up to 2000 m, to 1e-3 m/s', () => {
    const out = new Float32Array(3);
    const got = new Float32Array(3);
    const pos = new Float64Array(4);
    let worst = 0;
    let nonzero = 0;
    for (const p of oraclePoints(1200)) {
      atm.sample(p.x, p.y, p.agl, out);
      pos[0] = p.x;
      pos[1] = p.y;
      pos[2] = sampleBilinear(tg, ridgeTerrain.elevation, p.x, p.y) + p.agl;
      s.windP(pos, got);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(got[k]! - out[k]!));
      if (Math.hypot(out[0]!, out[1]!) > 0.5) nonzero++;
    }
    expect(worst).toBeLessThan(1e-3);
    // The comparison is not between two zero fields.
    expect(nonzero).toBeGreaterThan(1000);
  });

  it('is exact near the ground too (0 to 5 m above it, where a flat resample is worst), over the ridge crest', () => {
    const out = new Float32Array(3);
    const got = new Float32Array(3);
    let worst = 0;
    for (let q = 0; q < 200; q++) {
      const x = -120 + 1.2 * q;
      const y = 300 - 2.5 * q;
      for (const agl of [0, 1, 3, 5]) {
        atm.sample(x, y, agl, out);
        s.windP(Float64Array.of(x, y, sampleBilinear(tg, ridgeTerrain.elevation, x, y) + agl), got);
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(got[k]! - out[k]!));
      }
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('theta and smoke of the sampler are the engine’s own centre arrays at the level centres', () => {
    const g = atm.grid;
    const st = atm.state;
    for (const c of [g.nx * 20 + 22, g.nx * 25 + 10, g.nx * 5 + 40]) {
      for (const k of [0, 3, 9, 15]) {
        const x = g.grid.x0 + (c % g.nx) * g.dx;
        const y = g.grid.y0 + Math.floor(c / g.nx) * g.dx;
        // The height of level k in column c, from the grid's own metric: z = z_s + ζ J. The other three stencil columns have
        // weight 0 at a column centre, so the sample is exactly that cell.
        const z = g.zs[c]! + g.zetaC[k]! * g.J[c]!;
        expect(s.theta(x, y, z)).toBeCloseTo(st.theta[k * g.plane + c]!, 4);
        expect(s.smoke(x, y, z)).toBeCloseTo(st.smoke[k * g.plane + c]!, 4);
      }
    }
  });

  it('the published native view has no zero cells; the old flat resample had them under the ridge', () => {
    let zeros = 0;
    for (let k = 0; k < view.u.length; k++) if (view.u[k] === 0 && view.v[k] === 0) zeros++;
    expect(zeros).toBe(0);
    const flat = legacyFlatView(atm);
    let flatZeros = 0;
    for (let k = 0; k < flat.u.length; k++) if (flat.u[k] === 0 && flat.v[k] === 0) flatZeros++;
    expect(flatZeros).toBeGreaterThan(100);
  });

  it('regression: at 30 m above a 700 m ridge the old flat view reads far too low across the ridge, the new one is exact', () => {
    const flat = new AtmosphereSampler(legacyFlatView(atm), ridgeTerrain.elevation.reduce((m, e) => Math.min(m, e), Infinity), AMBIENT);
    const out = new Float32Array(3);
    const got = new Float32Array(3);
    const old = [0, 0, 0];
    let worstNew = 0;
    let worstOld = 0; // the most negative relative error of the flat view
    let meanOld = 0;
    let n = 0;
    for (let q = 0; q < 400; q++) {
      const x = -1500 + 7.5 * q; // across the ridge (it runs north to south), 30 m above the ground
      const ground = sampleBilinear(tg, ridgeTerrain.elevation, x, 0);
      atm.sample(x, 0, 30, out);
      const sp = Math.hypot(out[0]!, out[1]!);
      s.windP(Float64Array.of(x, 0, ground + 30), got);
      flat.wind(x, 0, ground + 30, 30, old);
      worstNew = Math.max(worstNew, Math.abs(Math.hypot(got[0]!, got[1]!) - sp) / sp);
      const rel = (Math.hypot(old[0]!, old[1]!) - sp) / sp;
      worstOld = Math.min(worstOld, rel);
      meanOld += Math.abs(rel);
      n++;
    }
    expect(worstNew).toBeLessThan(1e-3);
    expect(worstOld).toBeLessThan(-0.9); // measured -96.4 % on this ridge (re-measured by the 0.4.0 verifier; docs said 97.6): the flat view blends in the zeros under the ground
    expect(meanOld / n).toBeGreaterThan(0.25); // measured 32.9 %
  });
});

/**
 * The flat view Atmosphere.view() made before the terrain-following layout: native fields resampled onto flat levels of
 * equal height above the lowest terrain, zero below the terrain (kept here only to show what the new layout fixes).
 */
function legacyFlatView(a: Atmosphere): AtmosphereView {
  const g = a.grid;
  const { nz, plane } = g;
  const st = a.state;
  const mk = (): Float32Array => new Float32Array(plane * nz);
  const u = mk();
  const v = mk();
  const w = mk();
  const terrainHeight = new Float32Array(plane);
  for (let c = 0; c < plane; c++) {
    const h0 = g.zs[c]! - g.zMin;
    terrainHeight[c] = h0;
    const J = g.J[c]!;
    for (let l = 0; l < nz; l++) {
      const zeta = (g.zetaC[l]! - h0) / J;
      if (zeta < 0) continue;
      let kf = 0;
      if (zeta > g.zetaC[0]!) {
        if (zeta >= g.zetaC[nz - 1]!) kf = nz - 1;
        else {
          let lo = 0;
          while (lo < nz - 2 && g.zetaC[lo + 1]! <= zeta) lo++;
          kf = lo + (zeta - g.zetaC[lo]!) / (g.zetaC[lo + 1]! - g.zetaC[lo]!);
        }
      }
      const k0 = Math.min(Math.floor(kf), nz - 2);
      const t = kf - k0;
      const o = k0 * plane + c;
      const d = l * plane + c;
      u[d] = st.uc[o]! + (st.uc[o + plane]! - st.uc[o]!) * t;
      v[d] = st.vc[o]! + (st.vc[o + plane]! - st.vc[o]!) * t;
      w[d] = st.wc[o]! + (st.wc[o + plane]! - st.wc[o]!) * t;
    }
  }
  return { grid: g.grid, nz, levels: Float32Array.from(g.zetaC), terrainHeight, surfaceU: new Float32Array(plane), surfaceV: new Float32Array(plane), u, v, w, thetaAnomaly: mk(), smoke: mk() };
}
