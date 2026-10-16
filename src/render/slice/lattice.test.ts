/**
 * The lattice reads shared by the probe and the streaks: weights that sum to one, the validity mask kept out of the blend,
 * clamping, and the nearest-cell test of a streak. And the curtain's arrows for a recorded slice (0.4.1): the in-plane wind read from
 * the lattice agrees with what the sampler gives at the same point, and the upper-level reference for reverse flow.
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../../core/grid';
import { AtmosphereSampler, type SectionLine } from '../atmosphereSampler';
import { inValidAir, latticeInPlaneWind, LatticeStencil, upperAlongMean } from './lattice';
import { sampleSlice } from './sliceField';
import { makeAirView, makeSliceData } from './testing';

const P = (s: number, z: number): Float64Array => Float64Array.of(s, z);

describe('LatticeStencil', () => {
  const d = makeSliceData({ columns: 11, rows: 6, a: [0, 0], b: [1000, 0], zMin: 0, zMax: 500, ground: () => -100, wind: (s, z) => [s / 100 + z / 100, 0, 0] });
  const st = new LatticeStencil();

  it('on a lattice point the weight is all on that point; between four points it is bilinear', () => {
    st.locate(d, P(300, 200)); // column 3, row 2
    expect(st.k00).toBe(2 * 11 + 3);
    expect(st.w00).toBeCloseTo(1, 12);
    expect(st.w10 + st.w01 + st.w11).toBeCloseTo(0, 12);
    st.locate(d, P(350, 250)); // half way in both
    for (const w of [st.w00, st.w10, st.w01, st.w11]) expect(w).toBeCloseTo(0.25, 12);
    expect(st.k10 - st.k00).toBe(1);
    expect(st.k01 - st.k00).toBe(11);
    expect(st.coverage).toBeCloseTo(1, 12);
  });

  it('reads a linear field exactly, and clamps a point outside the slice to its edge', () => {
    st.locate(d, P(412, 137));
    expect(st.value(d.values.along)).toBeCloseTo(4.12 + 1.37, 5);
    st.locate(d, P(-50, -50));
    expect(st.value(d.values.along)).toBeCloseTo(0, 6);
    st.locate(d, P(5000, 9000));
    expect(st.value(d.values.along)).toBeCloseTo(10 + 5, 5);
  });

  it('leaves the cells that are not valid out of the blend and renormalises, and reports the share that was valid', () => {
    const g = makeSliceData({ columns: 11, rows: 6, a: [0, 0], b: [1000, 0], zMin: 0, zMax: 500, ground: () => 250, wind: () => [7, 0, 0] });
    // The model's ground is at 250: rows at 0, 100, 200 are invalid, 300 up are valid. A point between rows 200 and 300:
    st.locate(g, P(500, 250));
    expect(st.coverage).toBeCloseTo(0.5, 12);
    expect(st.w00 + st.w10 + st.w01 + st.w11).toBeCloseTo(1, 12);
    expect(st.value(g.values.along)).toBeCloseTo(7, 6); // not 3.5
    // All four corners under the ground: nothing to blend.
    st.locate(g, P(500, 150));
    expect(st.coverage).toBe(0);
    expect(st.value(g.values.along)).toBe(0);
  });
});

describe('inValidAir', () => {
  const d = makeSliceData({ columns: 11, rows: 6, a: [0, 0], b: [1000, 0], zMin: 0, zMax: 500, ground: () => 250 });
  it('is true over the ground inside the slice, false under it, over the top of the axis and off either end', () => {
    expect(inValidAir(d, P(500, 400))).toBe(true);
    expect(inValidAir(d, P(500, 100))).toBe(false);
    expect(inValidAir(d, P(500, 501))).toBe(false);
    expect(inValidAir(d, P(-1, 400))).toBe(false);
    expect(inValidAir(d, P(1001, 400))).toBe(false);
    expect(inValidAir(d, P(0, 500))).toBe(true);
    expect(inValidAir(d, P(1000, 300))).toBe(true);
    expect(inValidAir(d, P(NaN, 300))).toBe(false);
  });

  it('is false in air the model has but the 10 m ground covers (the model\'s own ground is lower), following the drawn ground line between columns', () => {
    const g = makeSliceData({ columns: 11, rows: 6, a: [0, 0], b: [1000, 0], zMin: 0, zMax: 500, ground: (s) => s / 2, modelGround: (s) => s / 2 - 100 });
    expect(g.valid[2 * 11 + 5], 'the lattice point at 200 m above column 5 is valid in the model').toBe(1);
    expect(inValidAir(g, P(500, 200))).toBe(false); // under the 250 m ground at 500 m
    expect(inValidAir(g, P(500, 240))).toBe(false);
    expect(inValidAir(g, P(500, 260))).toBe(true); // above the 250 m ground, nearest lattice point (the 300 m row) valid
    expect(inValidAir(g, P(550, 290))).toBe(true); // ground 275 here (between columns 5 and 6)
    expect(inValidAir(g, P(550, 270))).toBe(false);
  });
});

describe('latticeInPlaneWind: the arrows of a recorded slice', () => {
  const GRID = makeGridSpec({ lat: -33.7, lon: 150.3 }, 31 * 200, 200); // +-3000 m, 200 m cells
  const ridge = (x: number): number => 500 + 400 * Math.exp(-((x / 700) ** 2));
  // A wind that is linear in x, y and height, with a turn: the bilinear lattice and the sampler's trilinear air agree everywhere inside the air.
  const u = (x: number, y: number, z: number): number => 6 + x / 1000 + z / 800 - y / 2000;
  const v = (_x: number, y: number, z: number): number => -2 + y / 1500 + z / 1600;
  const w = (x: number, _y: number, z: number): number => 0.5 + x / 4000 - z / 3000;
  const sampler = new AtmosphereSampler(makeAirView({ grid: GRID, groundAt: ridge, baseM: 500, topM: 3000, u, v, w }), 0, null);
  const length = Math.hypot(4400, 1800);
  const line: SectionLine = { a: [-2200, -900], b: [2200, 900], dir: [4400 / length, 1800 / length], length };
  const d = sampleSlice(sampler, { heightAt: (x) => ridge(x) }, { line, shownTime: 0, columns: 45, rows: 40 })!;
  const st = new LatticeStencil();
  const at = new Float64Array(2);
  const out = new Float32Array(2);
  const tmp = new Float32Array(3);
  /** What the live curtain computes at a point: the sampler's wind projected on the line, and w. */
  function live(s: number, z: number): [number, number] {
    const x = line.a[0] + line.dir[0] * s;
    const y = line.a[1] + line.dir[1] * s;
    sampler.wind(x, y, z, Math.max(0, z - ridge(x)), tmp);
    return [tmp[0]! * line.dir[0] + tmp[1]! * line.dir[1], tmp[2]!];
  }

  it('equals the sampler at every lattice node that holds air, within the float error of the lattice', () => {
    let nodes = 0;
    for (let r = 0; r < d.rows; r++) {
      for (let c = 0; c < d.columns; c++) {
        if (!d.valid[r * d.columns + c]) continue;
        const s = (c / (d.columns - 1)) * d.line.length;
        const z = r === d.rows - 1 ? d.zMax : d.zMin + (r * (d.zMax - d.zMin)) / (d.rows - 1);
        at[0] = s;
        at[1] = z;
        expect(latticeInPlaneWind(d, st, at, out)).toBe(true);
        const [along, up] = live(s, z);
        expect(out[0]).toBeCloseTo(along, 3);
        expect(out[1]).toBeCloseTo(up, 3);
        nodes++;
      }
    }
    expect(nodes, 'the slice holds air').toBeGreaterThan(1000);
  });

  it('equals the sampler between the lattice nodes too, at the heights the arrows use (30 to 2200 m above the ground)', () => {
    let read = 0;
    let worst = 0;
    let worstAgl = 0;
    let worstHigh = 0;
    for (let m = 0; m < 15; m++) {
      const s = ((m + 0.5) / 15) * d.line.length;
      const x = line.a[0] + line.dir[0] * s;
      for (const agl of [30, 150, 400, 800, 1400, 2200]) {
        const z = ridge(x) + agl;
        if (z > Math.min(d.topAsl - 50, d.zMax)) break;
        at[0] = s;
        at[1] = z;
        if (!latticeInPlaneWind(d, st, at, out)) continue; // a point the model's own ground covers: no arrow
        const [along, up] = live(s, z);
        const err = Math.max(Math.abs(out[0]! - along), Math.abs(out[1]! - up));
        if (err > worst) {
          worst = err;
          worstAgl = agl;
        }
        if (agl >= 150) worstHigh = Math.max(worstHigh, err);
        read++;
      }
    }
    expect(read, 'most of the arrows are inside the model air').toBeGreaterThan(50);
    // Between nodes the lattice is linear in the plane, so the air is reproduced to float error; 30 m above the ground the validity weights hold the
    // value of the cells above flat instead of extending the slope below them (under 1 % of a 4 to 8 m/s wind: far under an arrow's length step).
    expect(worstHigh, 'from 150 m above the ground').toBeLessThan(0.002);
    expect(worst, `worst at ${worstAgl} m above the ground`).toBeLessThan(0.05);
  });

  it('is not pulled towards the zeros of the cells under the model ground', () => {
    const g = makeSliceData({ columns: 11, rows: 6, a: [0, 0], b: [1000, 0], zMin: 0, zMax: 500, ground: () => 250, wind: () => [7, 0, 1] });
    at[0] = 500;
    at[1] = 270; // 20 m above the model ground: the row below it is invalid and holds zeros
    expect(latticeInPlaneWind(g, st, at, out)).toBe(true);
    expect(out[0]).toBeCloseTo(7, 5);
    expect(out[1]).toBeCloseTo(1, 5);
  });

  it('says false, and leaves `out` alone, in the ground, above the top of the air and where the point is not a number', () => {
    const g = makeSliceData({ columns: 11, rows: 6, a: [0, 0], b: [1000, 0], zMin: 0, zMax: 500, ground: () => 250, topAsl: 400 });
    out[0] = 111;
    out[1] = 222;
    for (const [s, z] of [[500, 100], [500, 480], [500, NaN]] as const) {
      at[0] = s;
      at[1] = z;
      expect(latticeInPlaneWind(g, st, at, out), `s ${s}, z ${z}`).toBe(false);
    }
    expect([out[0], out[1]]).toEqual([111, 222]);
  });
});

describe('upperAlongMean: the reference of the reverse-flow arrows', () => {
  it('is the along-line wind of the highest valid cell, whatever is below it', () => {
    const d = makeSliceData({ columns: 21, rows: 12, a: [0, 0], b: [3000, 0], zMin: 0, zMax: 2000, wind: (_s, z) => [z > 1000 ? 5 : -3, 0, 0] });
    expect(upperAlongMean(d, 15)).toBeCloseTo(5, 6);
  });

  it('skips cells above the model top and the columns with no air, and is 0 when nothing is valid', () => {
    const topped = makeSliceData({ columns: 21, rows: 12, a: [0, 0], b: [3000, 0], zMin: 0, zMax: 2000, topAsl: 1500, wind: (_s, z) => [z > 1600 ? 9 : z > 1000 ? 4 : -3, 0, 0] });
    expect(upperAlongMean(topped, 15), 'rows above 1500 m are outside the model').toBeCloseTo(4, 6);
    const buried = makeSliceData({ columns: 21, rows: 12, a: [0, 0], b: [3000, 0], zMin: 0, zMax: 2000, ground: () => 5000 });
    expect(upperAlongMean(buried, 15)).toBe(0);
  });

  it('follows the sign of a wind that blows towards A', () => {
    const d = makeSliceData({ columns: 21, rows: 12, a: [0, 0], b: [3000, 0], wind: () => [-6, 0, 0] });
    expect(upperAlongMean(d, 15)).toBeCloseTo(-6, 6);
  });
});
