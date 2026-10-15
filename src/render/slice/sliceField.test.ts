/**
 * `sampleSlice` on terrain-following views with analytic fields: a uniform field is constant, a linear shear is exact, the
 * validity mask, the sign conventions on a rotated line (and their inverse), units, the row-mean temperature, reuse of the
 * arrays, the height axis and the lattice size, the two ground lines, and the model's own cells along the line. The oracle
 * against the real engine is in sliceField.oracle.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../../core/grid';
import { cellHeightAsl } from '../../core/airView';
import { AtmosphereSampler, type SectionLine } from '../atmosphereSampler';
import { sampleSlice } from './sliceField';
import { makeAirView } from './testing';
import { SLICE_FIELD_IDS, type SliceData } from './types';

const ORIGIN = { lat: -33.7, lon: 150.3 };
/** 31 x 31 columns of 200 m: a 6 km model centred on the origin, rectangle +-3000. */
const GRID = makeGridSpec(ORIGIN, 31 * 200, 200);

/** The 10 m DEM and the model's smoothed ground differ: a ridge along y with a 30 m crag the model does not see. */
const ridgeModel = (x: number): number => 500 + 600 * Math.exp(-((x / 700) ** 2));
const ridgeDem = (x: number, y: number): number => ridgeModel(x) + 30 * Math.exp(-(((x - 700) ** 2 + (y - 300) ** 2) / 60 ** 2));
const terrain = { heightAt: ridgeDem };

function line(a: [number, number], b: [number, number]): SectionLine {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { a, b, dir: [(b[0] - a[0]) / length, (b[1] - a[1]) / length], length };
}
const sampler = (v: ReturnType<typeof makeAirView>): AtmosphereSampler => new AtmosphereSampler(v, 0, null);
const sample = (s: AtmosphereSampler, l: SectionLine, extra: object = {}, out?: SliceData | null): SliceData => sampleSlice(s, terrain, { line: l, shownTime: 900, ...extra }, out)!;

/** z (m ASL) of row r. */
const zOf = (d: SliceData, r: number): number => (r === d.rows - 1 ? d.zMax : d.zMin + (r * (d.zMax - d.zMin)) / (d.rows - 1));

const ridgeView = (f: Partial<Parameters<typeof makeAirView>[0]> = {}) => makeAirView({ grid: GRID, groundAt: (x) => ridgeModel(x), baseM: 500, topM: 3000, ...f });

describe('sampleSlice: what it makes', () => {
  const view = ridgeView({ u: () => 4, v: () => -3, w: () => 0.5, theta: () => 2, smoke: () => 1 });
  const s = sampler(view);
  const l = line([-2500, -1000], [2000, 1500]);
  const d = sample(s, l);

  it('fills the lattice of the conventions: columns, rows, the height axis, kind, air time, model grid, shown time', () => {
    // 5148 m at 100 m (half a 200 m cell): 51.5 -> 52 columns, within 48 to 192.
    expect(d.columns).toBe(Math.round(l.length / 100));
    expect(d.rows).toBeGreaterThanOrEqual(48);
    expect(d.rows).toBeLessThanOrEqual(56);
    expect(d.values.speed.length).toBe(d.columns * d.rows);
    expect(d.valid.length).toBe(d.columns * d.rows);
    expect(d.ground.length).toBe(d.columns);
    expect(d.modelGround.length).toBe(d.columns);
    expect(d.kind).toBe('prognostic');
    expect(d.line).toBe(l);
    expect(d.cellSizeM).toBe(200);
    expect(d.airTime).toBe(600);
    expect(d.shownTime).toBe(900);
    expect(d.seq).toBe(1);
    expect(d.has).toEqual({ wind: true, theta: true, smoke: true });
    expect(d.topAsl).toBeCloseTo(3500, 6); // base 500 + model top 3000
    expect(Object.keys(d.values).sort()).toEqual([...SLICE_FIELD_IDS].sort());
  });

  it('puts the lowest row 50 m under the lowest ground on the line and the top at the highest ground plus 2000 m (or the model top)', () => {
    const lo = Math.min(...Array.from(d.ground));
    const hi = Math.max(...Array.from(d.ground));
    expect(d.zMin).toBeCloseTo(lo - 50, 3);
    expect(d.zMax).toBeCloseTo(Math.min(hi + 2000, d.topAsl), 3);
    // A tall ridge reaches the model top on this domain: 1100 + 30 + 2000 > 3500.
    const high = sample(sampler(ridgeView({ u: () => 1, v: () => 0, w: () => 0 })), line([-2000, 0], [2000, 0]));
    expect(high.zMax).toBeCloseTo(Math.min(Math.max(...Array.from(high.ground)) + 2000, 3500), 3);
    expect(high.zMax).toBeLessThanOrEqual(high.topAsl);
  });

  it('a uniform field is constant: speed, up, smoke, and the temperature anomaly is exactly zero (the row mean comes off)', () => {
    let seen = 0;
    for (let k = 0; k < d.valid.length; k++) {
      if (!d.valid[k]) continue;
      seen++;
      expect(d.values.speed[k]).toBeCloseTo(5, 5);
      expect(d.values.up[k]).toBeCloseTo(0.5, 6);
      expect(d.values.smoke[k]).toBeCloseTo(1, 6);
      expect(d.values.theta[k]).toBeCloseTo(0, 6);
      // along and across are the wind (4, -3) on this line: dir = (4500, 2500)/length
      const dx = l.dir[0];
      const dy = l.dir[1];
      expect(d.values.along[k]).toBeCloseTo(4 * dx - 3 * dy, 5);
      expect(d.values.across[k]).toBeCloseTo(4 * dy + 3 * dx, 5);
    }
    expect(seen).toBeGreaterThan(d.valid.length / 2);
  });

  it('records the 10 m ground (the terrain) and the model’s own ground under each column', () => {
    for (const c of [0, 7, 25, d.columns - 1]) {
      const sm = (c / (d.columns - 1)) * l.length;
      const x = l.a[0] + l.dir[0] * sm;
      const y = l.a[1] + l.dir[1] * sm;
      expect(d.ground[c]).toBeCloseTo(ridgeDem(x, y), 3);
      // The model's ground is the view's own (bilinear between its 200 m columns), here the smooth ridge.
      expect(Math.abs(d.modelGround[c]! - ridgeModel(x))).toBeLessThan(25);
      expect(d.modelGround[c]).toBeCloseTo(s.modelGroundAt(x, y), 3);
    }
  });
});

describe('sampleSlice: validity', () => {
  it('a cell is valid exactly when it is at or above the model’s own ground and at or below the model top; the others hold zeros in every field', () => {
    const v = ridgeView({ u: () => 5, v: () => 1, w: () => 1, theta: (x) => x / 1000, smoke: () => 2 });
    const d = sample(sampler(v), line([-2800, 0], [2800, 0]));
    let valid = 0;
    let invalid = 0;
    for (let r = 0; r < d.rows; r++) {
      for (let c = 0; c < d.columns; c++) {
        const k = r * d.columns + c;
        const z = zOf(d, r);
        const want = z >= d.modelGround[c]! && z <= d.topAsl;
        expect(d.valid[k], `r${r} c${c}`).toBe(want ? 1 : 0);
        if (want) valid++;
        else {
          invalid++;
          for (const id of SLICE_FIELD_IDS) expect(d.values[id][k], `${id} r${r} c${c}`).toBe(0);
        }
      }
    }
    expect(valid).toBeGreaterThan(500);
    expect(invalid).toBeGreaterThan(100); // the ridge puts 100+ cells under the model's ground
    // The ridge crest column has more invalid cells than the foot.
    const mid = Math.floor(d.columns / 2);
    const count = (c: number): number => Array.from({ length: d.rows }, (_, r) => d.valid[r * d.columns + c]!).filter((x) => x === 0).length;
    expect(count(mid)).toBeGreaterThan(count(1));
    // The top row lies at the top of the axis and is valid (it never exceeds the model top).
    for (let c = 0; c < d.columns; c++) expect(d.valid[(d.rows - 1) * d.columns + c]).toBe(1);
  });

  it('with a model top low enough to cap the axis, the last row is exactly the top and still valid', () => {
    const v = makeAirView({ grid: GRID, groundAt: () => 500, baseM: 500, topM: 1500, u: () => 3, v: () => 0, w: () => 0 });
    const d = sample(sampler(v), line([-1000, 0], [1000, 0]));
    expect(d.topAsl).toBeCloseTo(2000, 6);
    expect(d.zMax).toBe(d.topAsl);
    expect(Array.from(d.valid.subarray((d.rows - 1) * d.columns)).every((x) => x === 1)).toBe(true);
  });
});

describe('sampleSlice: linear fields are exact', () => {
  // Linear in x, y and height ASL: the sampler reproduces them exactly between the levels, over a ridge (terrain-following levels).
  const fu = (x: number, y: number, z: number): number => 3 + 0.004 * (z - 500) + 0.0008 * x - 0.0003 * y;
  const fv = (x: number, y: number, z: number): number => -1 + 0.002 * (z - 500) - 0.0004 * x + 0.0006 * y;
  const fw = (x: number, _y: number, z: number): number => 0.2 + 0.0005 * (z - 500) + 0.0002 * x;
  const view = ridgeView({ u: fu, v: fv, w: fw, theta: (x, _y, z) => 1 + 0.003 * (z - 500) + 0.0007 * x, smoke: (_x, y, z) => 4 - 0.001 * (z - 500) + 0.0002 * y });
  const s = sampler(view);
  const nodeG = view.grid;

  /**
   * True where all four stencil columns of the point have the point between their first and last level centre: there, and only
   * there, the interpolation in height is linear and the closed form holds (below the first centre a column takes level 0).
   */
  function linearHere(d: SliceData, c: number, z: number): boolean {
    const sm = (c / (d.columns - 1)) * d.line.length;
    const fx = (d.line.a[0] + d.line.dir[0] * sm - nodeG.x0) / nodeG.cellSize;
    const fy = (d.line.a[1] + d.line.dir[1] * sm - nodeG.y0) / nodeG.cellSize;
    for (const [i, j] of [[Math.floor(fx), Math.floor(fy)], [Math.floor(fx) + 1, Math.floor(fy)], [Math.floor(fx), Math.floor(fy) + 1], [Math.floor(fx) + 1, Math.floor(fy) + 1]] as const) {
      const h0 = view.terrainHeight[Math.min(nodeG.ny - 1, j) * nodeG.nx + Math.min(nodeG.nx - 1, i)]!;
      const zeta = (z - 500 - h0) / (1 - h0 / 3000);
      if (zeta < view.levels[0]! + 1 || zeta > view.levels[view.nz - 1]! - 1) return false;
    }
    return true;
  }

  for (const [name, a, b] of [
    ['due east', [-2500, 100], [2500, 100]],
    ['rotated 37 degrees', [-1800, -2000], [1900, 400]],
    ['against the grid, due south-west', [2600, 2400], [-2200, -1900]],
  ] as Array<[string, [number, number], [number, number]]>) {
    it(`${name}: along, across, up, speed, smoke match the analytic field at every cell clear of the first and last level`, () => {
      const l = line(a, b);
      const d = sample(s, l);
      let checked = 0;
      let worst = 0;
      for (let r = 0; r < d.rows; r++) {
        const z = zOf(d, r);
        for (let c = 0; c < d.columns; c++) {
          const k = r * d.columns + c;
          if (!d.valid[k] || !linearHere(d, c, z)) continue;
          const sm = (c / (d.columns - 1)) * l.length;
          const x = l.a[0] + l.dir[0] * sm;
          const y = l.a[1] + l.dir[1] * sm;
          const u = fu(x, y, z);
          const v = fv(x, y, z);
          const e = [
            [d.values.along[k]!, u * l.dir[0] + v * l.dir[1]],
            [d.values.across[k]!, u * l.dir[1] - v * l.dir[0]],
            [d.values.speed[k]!, Math.hypot(u, v)],
            [d.values.up[k]!, fw(x, y, z)],
            [d.values.smoke[k]!, 4 - 0.001 * (z - 500) + 0.0002 * y],
          ] as const;
          for (const [got, want] of e) worst = Math.max(worst, Math.abs(got - want));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(1000);
      expect(worst).toBeLessThan(5e-4);
    });
  }

  it('the temperature is the linear field minus the row mean of the valid cells', () => {
    const l = line([-2500, 100], [2500, 100]);
    const d = sample(s, l);
    for (let r = 0; r < d.rows; r++) {
      const z = zOf(d, r);
      let sum = 0;
      let n = 0;
      const raw: number[] = [];
      for (let c = 0; c < d.columns; c++) {
        raw.push(NaN);
        if (!d.valid[r * d.columns + c]) continue;
        const x = l.a[0] + l.dir[0] * ((c / (d.columns - 1)) * l.length);
        const t = 1 + 0.003 * (z - 500) + 0.0007 * x;
        raw[c] = t;
        sum += d.values.theta[r * d.columns + c]!;
        n++;
      }
      if (n === 0) continue;
      // Row mean of the stored anomaly is zero ...
      expect(Math.abs(sum / n), `row ${r}`).toBeLessThan(2e-4);
      // ... and differences within the row are the raw field's (only valid cells clear of the first and last level are linear).
      const cs = [...raw.keys()].filter((c) => d.valid[r * d.columns + c] && z > d.modelGround[c]! + 120 && z < d.topAsl - 300);
      for (let q = 1; q < cs.length; q++) {
        const c0 = cs[0]!;
        const c1 = cs[q]!;
        expect(d.values.theta[r * d.columns + c1]! - d.values.theta[r * d.columns + c0]!).toBeCloseTo(raw[c1]! - raw[c0]!, 3);
      }
    }
  });
});

describe('sampleSlice: the sign conventions on a rotated line', () => {
  const wind = { u: 5, v: 2, w: 0.7 };
  const view = ridgeView({ u: () => wind.u, v: () => wind.v, w: () => wind.w, theta: null, smoke: null, kind: 'diagnosed' });
  const s = sampler(view);

  it('along is positive for air moving from A towards B, across positive towards the RIGHT of A to B, and the inverse rebuilds the wind', () => {
    // 30 degrees apart, from due north through the back azimuths: every orientation.
    for (let az = 0; az < 360; az += 30) {
      const a = (az * Math.PI) / 180;
      const dir: [number, number] = [Math.sin(a), Math.cos(a)];
      const l = line([-dir[0] * 1800, -dir[1] * 1800], [dir[0] * 1800, dir[1] * 1800]);
      const d = sample(s, l);
      const along = wind.u * dir[0] + wind.v * dir[1];
      const across = wind.u * dir[1] - wind.v * dir[0];
      const k = Math.floor(d.rows * 0.6) * d.columns + 20;
      expect(d.valid[k]).toBe(1);
      expect(d.values.along[k], `az ${az}`).toBeCloseTo(along, 5);
      expect(d.values.across[k], `az ${az}`).toBeCloseTo(across, 5);
      // The inverse of the conventions: u = along dx + across dy, v = along dy - across dx.
      expect(d.values.along[k]! * dir[0] + d.values.across[k]! * dir[1]).toBeCloseTo(wind.u, 5);
      expect(d.values.along[k]! * dir[1] - d.values.across[k]! * dir[0]).toBeCloseTo(wind.v, 5);
      expect(d.values.speed[k]).toBeCloseTo(Math.hypot(wind.u, wind.v), 5);
      expect(d.values.up[k]).toBeCloseTo(0.7, 6);
    }
  });

  it('a line due north with an easterly-blowing wind (u > 0) has across = +u and along = v; due east it is along = u, across = -v', () => {
    const north = sample(s, line([0, -2000], [0, 2000]));
    const k = Math.floor(north.rows * 0.6) * north.columns + 10;
    expect(north.values.across[k]).toBeCloseTo(wind.u, 6);
    expect(north.values.along[k]).toBeCloseTo(wind.v, 6);
    const east = sample(s, line([-2000, 0], [2000, 0]));
    expect(east.values.along[k]).toBeCloseTo(wind.u, 6);
    expect(east.values.across[k]).toBeCloseTo(-wind.v, 6);
  });

  it('swapping A and B negates along and across and leaves speed and up alone (mirror columns agree)', () => {
    const f = sample(s, line([-2200, -800], [1700, 1900]));
    const r = sample(s, line([1700, 1900], [-2200, -800]));
    expect(r.columns).toBe(f.columns);
    expect(r.rows).toBe(f.rows);
    for (let row = 0; row < f.rows; row++) {
      for (let c = 0; c < f.columns; c++) {
        const k = row * f.columns + c;
        const m = row * f.columns + (f.columns - 1 - c);
        expect(r.valid[m]).toBe(f.valid[k]);
        expect(r.values.along[m]).toBeCloseTo(-f.values.along[k]!, 5);
        expect(r.values.across[m]).toBeCloseTo(-f.values.across[k]!, 5);
        expect(r.values.speed[m]).toBeCloseTo(f.values.speed[k]!, 5);
        expect(r.values.up[m]).toBeCloseTo(f.values.up[k]!, 5);
      }
    }
  });

  it('units: speed, along, across and up are m/s (not km/h), and up is positive for rising air', () => {
    const d = sample(s, line([-1500, 0], [1500, 0]));
    const k = Math.floor(d.rows * 0.5) * d.columns + 5;
    expect(d.values.speed[k]).toBeCloseTo(Math.hypot(5, 2), 5); // 5.39 m/s, not 19.4
    expect(d.values.up[k]).toBeGreaterThan(0);
  });
});

describe('sampleSlice: what the air does not hold', () => {
  it('a diagnosed view has no temperature or smoke: has says so, the arrays are all zero, the kind is diagnosed', () => {
    const v = ridgeView({ u: () => 5, v: () => 0, w: () => 0, theta: null, smoke: null, kind: 'diagnosed' });
    const d = sample(sampler(v), line([-1500, 0], [1500, 0]));
    expect(d.kind).toBe('diagnosed');
    expect(d.has).toEqual({ wind: true, theta: false, smoke: false });
    expect(d.values.theta.every((x) => x === 0)).toBe(true);
    expect(d.values.smoke.every((x) => x === 0)).toBe(true);
    expect(d.values.speed.some((x) => x > 4.9)).toBe(true);
  });

  it('returns null when the air holds no 3-D wind (surface-only view, no view), and when the line has no length', () => {
    const empty = new Float32Array(0);
    const surface = { ...ridgeView(), nz: 0, levels: empty, u: empty, v: empty, w: empty, thetaAnomaly: empty, smoke: empty, layout: undefined, kind: undefined, topM: undefined };
    const l = line([-1500, 0], [1500, 0]);
    expect(sampleSlice(new AtmosphereSampler(surface, 0, null), terrain, { line: l, shownTime: 0 })).toBeNull();
    expect(sampleSlice(new AtmosphereSampler(null, 0, null), terrain, { line: l, shownTime: 0 })).toBeNull();
    const none = { a: [0, 0], b: [0, 0], dir: [1, 0], length: 0 } as SectionLine;
    expect(sampleSlice(sampler(ridgeView({ u: () => 1 })), terrain, { line: none, shownTime: 0 })).toBeNull();
  });

  it('a model whose top is below the ground gives no slice', () => {
    const v = makeAirView({ grid: GRID, groundAt: () => 500, baseM: 500, topM: 3000, u: () => 1 });
    const low = { heightAt: () => 4000 };
    expect(sampleSlice(sampler(v), low, { line: line([-1000, 0], [1000, 0]), shownTime: 0 })).toBeNull();
  });
});

describe('sampleSlice: lattice size and reuse', () => {
  const v = ridgeView({ u: (x) => 2 + x / 1000, v: () => 0, w: () => 0, theta: (x) => x / 500, smoke: () => 1 });
  const s = sampler(v);

  it('columns are one per half model cell of the line, clamped to 48 to 192; rows 48 to 56; the spec can override both', () => {
    expect(sample(s, line([-2000, 0], [-1600, 0])).columns).toBe(48); // 400 m / 100 m = 4 -> 48
    expect(sample(s, line([-3000, 0], [3000, 0])).columns).toBe(60); // 6 km / 100 m
    expect(sample(makeSampler(100), line([-3000, 0], [3000, 0])).columns).toBe(120); // 6 km / 50 m
    const big = makeSampler(40);
    expect(sample(big, line([-3000, 0], [3000, 0])).columns).toBe(192);
    const d = sample(s, line([-3000, 0], [3000, 0]));
    expect(d.rows).toBeGreaterThanOrEqual(48);
    expect(d.rows).toBeLessThanOrEqual(56);
    const o = sample(s, line([-3000, 0], [3000, 0]), { columns: 90, rows: 50 });
    expect([o.columns, o.rows]).toEqual([90, 50]);
    function makeSampler(cell: number): AtmosphereSampler {
      return sampler(makeAirView({ grid: makeGridSpec(ORIGIN, 6200, cell), groundAt: (x) => ridgeModel(x), u: () => 1, v: () => 0, w: () => 0 }));
    }
  });

  it('refills an `out` of the same lattice size in place: same object, same arrays, seq up by one, new air in them', () => {
    const l = line([-2500, 0], [2500, 0]);
    const first = sample(s, l);
    const arrays = [first.values.speed, first.values.theta, first.valid, first.ground, first.cells?.values.speed];
    const seq = first.seq;
    const v2 = ridgeView({ u: (x) => 7 + x / 1000, v: () => 0, w: () => 0, theta: (x) => -x / 500, smoke: () => 3 });
    const second = sample(sampler(v2), l, {}, first);
    expect(second).toBe(first);
    expect(second.seq).toBe(seq + 1);
    expect([second.values.speed, second.values.theta, second.valid, second.ground, second.cells?.values.speed]).toEqual(arrays);
    expect(second.values.speed[Math.floor(second.rows * 0.6) * second.columns + 10]).toBeGreaterThan(5); // the new air
    expect(sample(s, l, {}, second).seq).toBe(seq + 2);
  });

  it('a different lattice size is a new object, and keeps counting the seq', () => {
    const a = sample(s, line([-2500, 0], [2500, 0]));
    const b = sample(s, line([-1000, 0], [1000, 0]), {}, a);
    expect(b).not.toBe(a);
    expect(b.seq).toBe(a.seq + 1);
    expect(b.columns).not.toBe(a.columns);
    // The old object is untouched.
    expect(a.columns).toBe(50);
  });

  it('a moved line of the same size refills the same object with the new line, ground and air', () => {
    const a = sample(s, line([-2500, -500], [2500, -500]));
    const g0 = a.ground.slice();
    const b = sample(s, line([-2500, 500], [2500, 500]), {}, a);
    expect(b).toBe(a);
    expect(b.line.a[1]).toBe(500);
    // The DEM crag at (700, 300) is close to y = 500: the ground under the middle of this line differs from the other line's.
    expect(Array.from(b.ground)).not.toEqual(Array.from(g0));
  });

  it('the returned object does not depend on the scratch: two slices interleaved give the same numbers as one at a time', () => {
    const l1 = line([-2500, 0], [2500, 0]);
    const l2 = line([0, -2000], [1000, 2500]);
    const a1 = sample(s, l1);
    const b1 = sample(s, l2);
    const a2 = sample(s, l1);
    const b2 = sample(s, l2);
    for (const id of SLICE_FIELD_IDS) {
      expect(Array.from(a2.values[id])).toEqual(Array.from(a1.values[id]));
      expect(Array.from(b2.values[id])).toEqual(Array.from(b1.values[id]));
    }
  });
});

describe('sampleSlice: the model’s own cells along the line', () => {
  const v = ridgeView({
    u: (x, _y, z) => 1 + 0.001 * x + 0.002 * (z - 500),
    v: (_x, y) => 0.5 - 0.0005 * y,
    w: (x) => 0.0003 * x,
    theta: (x, _y, z) => 0.002 * x + 0.001 * (z - 500),
    smoke: (_x, y) => 2 + y / 1000,
  });
  const s = sampler(v);
  const g = v.grid;
  const nz = v.nz;
  const plane = g.nx * g.ny;

  /** The cells a line crosses, by walking it in 0.25 m steps and noting where the nearest node changes: an independent reference. */
  function walk(l: SectionLine): { column: number[]; edges: number[] } {
    const column: number[] = [];
    const edges: number[] = [0];
    const step = 0.25;
    for (let t = 0; t <= l.length + 1e-9; t += step) {
      const i = Math.min(g.nx - 1, Math.max(0, Math.round((l.a[0] + l.dir[0] * t - g.x0) / g.cellSize)));
      const j = Math.min(g.ny - 1, Math.max(0, Math.round((l.a[1] + l.dir[1] * t - g.y0) / g.cellSize)));
      const col = j * g.nx + i;
      if (column.length === 0 || column[column.length - 1] !== col) {
        if (column.length > 0) edges.push(t - step / 2);
        column.push(col);
      }
    }
    edges.push(l.length);
    return { column, edges };
  }

  const lines: Array<[string, SectionLine]> = [
    ['along a row of nodes, from a cell centre', line([-1000, 0], [1510, 0])],
    ['north to south down a column of nodes', line([400, 2490], [400, -1890])],
    ['a diagonal through the half-cell corners', line([-1450, -1450], [1420, 1420])],
    ['oblique', line([-2750, 1890], [2310, -2600])],
    ['edge to edge across the model', line([-3000, -3000], [3000, 3000])],
    ['short, inside one cell and the next', line([10, 10], [330, 90])],
  ];

  for (const [name, l] of lines) {
    it(`${name}: the crossed columns and the boundaries between them match a walk along the line`, () => {
      const d = sample(s, l);
      const c = d.cells!;
      const ref = walk(l);
      expect(Array.from(c.column)).toEqual(ref.column);
      expect(c.count).toBe(ref.column.length);
      expect(c.edges.length).toBe(c.count + 1);
      expect(c.edges[0]).toBe(0);
      expect(c.edges[c.count]).toBeCloseTo(l.length, 3);
      for (let i = 0; i <= c.count; i++) expect(Math.abs(c.edges[i]! - ref.edges[i]!), `edge ${i}`).toBeLessThan(0.3);
      for (let i = 1; i <= c.count; i++) expect(c.edges[i]!).toBeGreaterThan(c.edges[i - 1]!);
      expect(c.levels).toBe(nz);
    });
  }

  it('along a row of nodes the cells are the row’s columns in order, one 200 m cell each (the first starts at the line)', () => {
    const c = sample(s, line([-1000, 0], [1510, 0])).cells!;
    expect(Array.from(c.column)).toEqual(Array.from({ length: 14 }, (_, i) => 15 * g.nx + 10 + i));
    expect(Array.from(c.edges.subarray(0, 4))).toEqual([0, 100, 300, 500]);
  });

  it('level boundaries: first is the model’s ground in that column, last the model top, rising, with the level centre in the middle of each layer', () => {
    const d = sample(s, line([-2750, 1890], [2310, -2600]));
    const c = d.cells!;
    const faces = nz + 1;
    for (let q = 0; q < c.count; q++) {
      const col = c.column[q]!;
      const x = g.x0 + (col % g.nx) * g.cellSize;
      const y = g.y0 + Math.floor(col / g.nx) * g.cellSize;
      expect(c.zEdges[q * faces]!).toBeCloseTo(s.modelGroundAt(x, y), 2);
      expect(c.zEdges[q * faces + nz]!).toBeCloseTo(s.top, 2);
      for (let l = 0; l < nz; l++) {
        const lo = c.zEdges[q * faces + l]!;
        const hi = c.zEdges[q * faces + l + 1]!;
        expect(hi, `column ${q} level ${l}`).toBeGreaterThan(lo);
        expect((lo + hi) / 2).toBeCloseTo(cellHeightAsl(v, col, l), 1);
      }
    }
    // The boundaries follow the terrain: the same level sits at different heights in a crest column and a foot column.
    const heights = Array.from({ length: c.count }, (_, q) => c.zEdges[q * faces + 3]!);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(200);
  });

  it('values are the model’s own cell values, not interpolated; the temperature has the level mean over the crossed cells removed', () => {
    const l = line([-2750, 1890], [2310, -2600]);
    const d = sample(s, l);
    const c = d.cells!;
    const dx = l.dir[0];
    const dy = l.dir[1];
    const thetaMean: number[] = [];
    for (let lev = 0; lev < nz; lev++) {
      let sum = 0;
      for (let q = 0; q < c.count; q++) sum += v.thetaAnomaly[lev * plane + c.column[q]!]!;
      thetaMean.push(sum / c.count);
    }
    for (let q = 0; q < c.count; q++) {
      for (let lev = 0; lev < nz; lev++) {
        const src = lev * plane + c.column[q]!;
        const k = q * nz + lev;
        const u = v.u[src]!;
        const vv = v.v[src]!;
        expect(c.values.speed[k]).toBeCloseTo(Math.hypot(u, vv), 4);
        expect(c.values.along[k]).toBeCloseTo(u * dx + vv * dy, 4);
        expect(c.values.across[k]).toBeCloseTo(u * dy - vv * dx, 4);
        expect(c.values.up[k]).toBe(v.w[src]);
        expect(c.values.smoke[k]).toBe(v.smoke[src]);
        expect(c.values.theta[k]).toBeCloseTo(v.thetaAnomaly[src]! - thetaMean[lev]!, 4);
      }
    }
  });

  it('a diagnosed view has cells too, with no temperature or smoke', () => {
    const dv = ridgeView({ u: () => 4, v: () => 1, w: () => 0, theta: null, smoke: null, kind: 'diagnosed' });
    const c = sample(sampler(dv), line([-1500, 0], [1500, 0])).cells!;
    expect(c.count).toBeGreaterThan(10);
    expect(c.values.theta.every((x) => x === 0) && c.values.smoke.every((x) => x === 0)).toBe(true);
    expect(c.values.speed.every((x) => Math.abs(x - Math.hypot(4, 1)) < 1e-5)).toBe(true);
  });

  it('reuses the cell arrays when the line crosses the same cells, and builds new ones when it does not', () => {
    const l = line([-2000, 100], [2000, 100]);
    const first = sample(s, l);
    const cells = first.cells!;
    const speed = cells.values.speed;
    const second = sample(s, l, {}, first);
    expect(second.cells).toBe(cells);
    expect(second.cells!.values.speed).toBe(speed);
    const moved = sample(s, line([-2000, 100], [1200, 2100]), {}, second);
    expect(moved.cells).not.toBe(cells);
  });

  it('levels that are not the engine’s still give rising boundaries from the ground to the top', () => {
    const odd = { ...ridgeView({ u: () => 1, v: () => 0, w: () => 0 }) };
    odd.levels = Float32Array.from({ length: odd.nz }, (_, k) => (k === 0 ? 40 : 40 * 1.5 ** k)); // not the centres of layers
    const d = sample(sampler(odd), line([-1500, 0], [1500, 0]));
    const c = d.cells!;
    const faces = odd.nz + 1;
    for (let q = 0; q < c.count; q++) {
      for (let l = 0; l < odd.nz; l++) expect(c.zEdges[q * faces + l + 1]!).toBeGreaterThan(c.zEdges[q * faces + l]!);
    }
  });

  it('a flat-layout view gives rising level boundaries too', () => {
    const flat = ridgeView({ u: () => 1, v: () => 0, w: () => 0 });
    const lv = Float32Array.from([50, 150, 300, 600, 1000]);
    const n = g.nx * g.ny * lv.length;
    const view = { ...flat, layout: undefined, kind: undefined, topM: undefined, nz: lv.length, levels: lv, terrainHeight: new Float32Array(g.nx * g.ny), u: new Float32Array(n).fill(1), v: new Float32Array(n), w: new Float32Array(n), thetaAnomaly: new Float32Array(n), smoke: new Float32Array(n) };
    const c = sample(new AtmosphereSampler(view, 400, null), line([-1500, 0], [1500, 0])).cells!;
    for (let q = 0; q < c.count; q++) for (let l = 0; l < lv.length; l++) expect(c.zEdges[q * (lv.length + 1) + l + 1]!).toBeGreaterThan(c.zEdges[q * (lv.length + 1) + l]!);
  });
});
