/**
 * The lattice reads shared by the probe and the streaks: weights that sum to one, the validity mask kept out of the blend,
 * clamping, and the nearest-cell test of a streak.
 */
import { describe, expect, it } from 'vitest';
import { inValidAir, LatticeStencil } from './lattice';
import { makeSliceData } from './testing';

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
