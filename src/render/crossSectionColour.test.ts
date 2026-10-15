/** The curtain's colours from the sampled slice: the same scale as the panel and the legends, transparent outside the model, smoke only where the air has it. */
import { describe, expect, it } from 'vitest';
import { CURTAIN_ALPHA_BASE, CURTAIN_ALPHA_STRONG, colourSlice, curtainAlpha } from './crossSectionColour';
import { ALONG_RAMP, THETA_RAMP, WIND_RAMP, sampleRamp, sliceFieldScale } from './palette';
import { SLICE_FIELD_IDS, type SliceData, type SliceFieldId } from './slice/types';

type Lattice = Pick<SliceData, 'columns' | 'rows' | 'values' | 'valid' | 'has'>;

/** A lattice whose every field is a function of (column, row); all cells valid unless `valid` says otherwise. */
function lattice(M: number, N: number, f: Partial<Record<SliceFieldId, (c: number, r: number) => number>>, valid?: (c: number, r: number) => boolean, has = { wind: true, theta: true, smoke: true }): Lattice {
  const values = {} as Record<SliceFieldId, Float32Array>;
  for (const id of SLICE_FIELD_IDS) {
    values[id] = new Float32Array(M * N);
    const g = f[id];
    if (g) for (let r = 0; r < N; r++) for (let c = 0; c < M; c++) values[id][r * M + c] = g(c, r);
  }
  const ok = new Uint8Array(M * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < M; c++) ok[r * M + c] = !valid || valid(c, r) ? 1 : 0;
  return { columns: M, rows: N, values, valid: ok, has };
}

const px = (out: Uint8Array, M: number, c: number, r: number): [number, number, number, number] => {
  const k = (r * M + c) * 4;
  return [out[k]!, out[k + 1]!, out[k + 2]!, out[k + 3]!];
};
const rgb255 = (v: number, field: SliceFieldId): [number, number, number] => {
  const c = sampleRamp(sliceFieldScale(field).ramp, v);
  return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
};

describe('curtainAlpha', () => {
  it('keeps the old temperature rule: 0.58 at neutral, solid from 1.5 K, and smoke thickens a cell up to 30 %', () => {
    expect(curtainAlpha('theta', 0)).toBeCloseTo(0.58, 9);
    expect(curtainAlpha('theta', 0.75)).toBeCloseTo(0.58 + 0.4 * 0.5, 9);
    expect(curtainAlpha('theta', -1.5)).toBeCloseTo(0.98, 9);
    expect(curtainAlpha('theta', 12)).toBeCloseTo(0.98, 9);
    expect(curtainAlpha('theta', 0, 0.3)).toBeCloseTo(0.58 + 0.4 * 0.3, 9);
    expect(CURTAIN_ALPHA_BASE + CURTAIN_ALPHA_STRONG).toBeCloseTo(0.98, 9);
  });

  it('is more opaque the stronger the value, for every chip, and never above 1', () => {
    for (const id of SLICE_FIELD_IDS) {
      let prev = 0;
      for (const x of [0, 0.1, 0.5, 1, 3, 10, 30]) {
        const a = curtainAlpha(id, x);
        expect(a, `${id} ${x}`).toBeGreaterThanOrEqual(prev);
        expect(a).toBeLessThanOrEqual(1);
        prev = a;
      }
      expect(curtainAlpha(id, -3), id).toBe(curtainAlpha(id, 3));
    }
  });
});

describe('colourSlice', () => {
  it('colours every cell with the scale of the chip, one texel per lattice point, row 0 first', () => {
    const M = 4;
    const N = 3;
    const l = lattice(M, N, { speed: (c, r) => 2 + c * 3 + r * 7 });
    const out = new Uint8Array(M * N * 4);
    colourSlice(l, 'speed', out);
    for (let r = 0; r < N; r++)
      for (let c = 0; c < M; c++) {
        const v = 2 + c * 3 + r * 7;
        const p = px(out, M, c, r);
        expect(p.slice(0, 3), `${c},${r}`).toEqual(rgb255(v, 'speed'));
        expect(p[3]).toBe(Math.round(curtainAlpha('speed', v) * 255));
      }
    // The wind-speed chip is the wind ramp.
    expect(px(out, M, 0, 0).slice(0, 3)).toEqual([Math.round(sampleRamp(WIND_RAMP, 2)[0] * 255), Math.round(sampleRamp(WIND_RAMP, 2)[1] * 255), Math.round(sampleRamp(WIND_RAMP, 2)[2] * 255)]);
  });

  it('colours along and across with the diverging ramp: purple for one side, pale at 0, green for the other', () => {
    const M = 3;
    const l = lattice(M, 1, { along: (c) => [-20, 0, 20][c]!, across: (c) => [20, 0, -20][c]! });
    const a = new Uint8Array(M * 4);
    colourSlice(l, 'along', a);
    expect(px(a, M, 0, 0).slice(0, 3)).toEqual(rgb255(-20, 'along'));
    expect(px(a, M, 1, 0).slice(0, 3)).toEqual(rgb255(0, 'along'));
    expect(px(a, M, 2, 0).slice(0, 3)).toEqual(rgb255(20, 'along'));
    expect(px(a, M, 0, 0)[1]).toBeLessThan(px(a, M, 0, 0)[0]); // purple
    expect(px(a, M, 2, 0)[1]).toBeGreaterThan(px(a, M, 2, 0)[0]); // green
    expect(px(a, M, 1, 0)[3]).toBe(Math.round(CURTAIN_ALPHA_BASE * 255)); // neutral air is the more transparent
    expect(px(a, M, 2, 0)[3]).toBe(Math.round((CURTAIN_ALPHA_BASE + CURTAIN_ALPHA_STRONG) * 255));
    const b = new Uint8Array(M * 4);
    colourSlice(l, 'across', b);
    expect(px(b, M, 0, 0).slice(0, 3)).toEqual(rgb255(20, 'across'));
    expect(px(b, M, 2, 0).slice(0, 3)).toEqual(rgb255(-20, 'across'));
    expect(ALONG_RAMP).toBe(sliceFieldScale('across').ramp);
  });

  it('colours temperature with the temperature ramp (warm red, cold blue)', () => {
    const l = lattice(3, 1, { theta: (c) => [-4, 0, 6][c]! });
    const out = new Uint8Array(12);
    colourSlice(l, 'theta', out);
    expect(px(out, 3, 0, 0).slice(0, 3)).toEqual(rgb255(-4, 'theta'));
    expect(px(out, 3, 2, 0).slice(0, 3)).toEqual(rgb255(6, 'theta'));
    expect(sampleRamp(THETA_RAMP, 6)[0]).toBeGreaterThan(sampleRamp(THETA_RAMP, 6)[2]);
    expect(px(out, 3, 0, 0)[2]).toBeGreaterThan(px(out, 3, 0, 0)[0]); // blue
    expect(px(out, 3, 2, 0)[0]).toBeGreaterThan(px(out, 3, 2, 0)[2]); // red
  });

  it('leaves the cells outside the model fully transparent, with the colour of the nearest air in their column', () => {
    const M = 2;
    const N = 6;
    // Column 0: rows 0-1 under the ground, 2-4 air, 5 above the top. Column 1: a hole at row 3 between rows 2 and 4.
    const l = lattice(M, N, { speed: (_c, r) => 3 * r }, (c, r) => (c === 0 ? r >= 2 && r <= 4 : r !== 3 && r !== 5 && r !== 0));
    const out = new Uint8Array(M * N * 4);
    colourSlice(l, 'speed', out);
    for (let r = 0; r < N; r++)
      for (let c = 0; c < M; c++) expect(px(out, M, c, r)[3] === 0, `${c},${r}`).toBe(!l.valid[r * M + c]);
    expect(px(out, M, 0, 0).slice(0, 3)).toEqual(px(out, M, 0, 2).slice(0, 3)); // under the ground: the air above
    expect(px(out, M, 0, 1).slice(0, 3)).toEqual(px(out, M, 0, 2).slice(0, 3));
    expect(px(out, M, 0, 5).slice(0, 3)).toEqual(px(out, M, 0, 4).slice(0, 3)); // above the top: the air below
    expect(px(out, M, 1, 3).slice(0, 3)).toEqual(px(out, M, 1, 2).slice(0, 3)); // a hole: the cell below
    expect(px(out, M, 1, 0).slice(0, 3)).toEqual(px(out, M, 1, 1).slice(0, 3));
    expect(px(out, M, 1, 5).slice(0, 3)).toEqual(px(out, M, 1, 4).slice(0, 3));
  });

  it('a column with no air at all is transparent in the neutral colour of the chip', () => {
    const l = lattice(2, 3, { along: () => 10 }, (c) => c === 0);
    const out = new Uint8Array(2 * 3 * 4);
    colourSlice(l, 'along', out);
    for (let r = 0; r < 3; r++) {
      expect(px(out, 2, 1, r)[3]).toBe(0);
      expect(px(out, 2, 1, r).slice(0, 3)).toEqual(rgb255(0, 'along'));
    }
  });

  describe('smoke', () => {
    const smokeAt = (c: number): number => [0, 0.2, 0.5, 1][c]!;
    it('greys the other chips a little where the 3-D atmosphere has smoke, up to 30 % in the thickest, and thickens those cells', () => {
      const l = lattice(4, 1, { speed: () => 10, smoke: smokeAt });
      const out = new Uint8Array(16);
      colourSlice(l, 'speed', out);
      expect(px(out, 4, 0, 0).slice(0, 3)).toEqual(rgb255(10, 'speed')); // no smoke there
      const thick = px(out, 4, 3, 0);
      // The thickest cell takes 30 % of the grey (0.45): the share is capped there.
      const share = 0.3;
      const c = sampleRamp(WIND_RAMP, 10);
      expect(thick.slice(0, 3)).toEqual(c.map((p) => Math.round((p * (1 - share) + 0.45 * share) * 255)));
      expect(thick[3]).toBe(Math.round(curtainAlpha('speed', 10, share) * 255));
      // More smoke, more grey.
      const away = (cc: number): number => px(out, 4, cc, 0).slice(0, 3).reduce((s, p) => s + Math.abs(p - 0.45 * 255), 0);
      expect(away(0)).toBeGreaterThan(away(1));
      expect(away(1)).toBeGreaterThan(away(2));
      expect(away(2)).toBeGreaterThan(away(3));
    });

    it('does nothing where the air has no smoke (the diagnosed wind), even if the array holds numbers', () => {
      const l = lattice(4, 1, { speed: () => 10, smoke: smokeAt }, undefined, { wind: true, theta: false, smoke: false });
      const out = new Uint8Array(16);
      colourSlice(l, 'speed', out);
      for (let c = 0; c < 4; c++) expect(px(out, 4, c, 0).slice(0, 3)).toEqual(rgb255(10, 'speed'));
    });

    it('does not grey the smoke chip itself, which is coloured by the smoke', () => {
      const l = lattice(4, 1, { smoke: smokeAt });
      const out = new Uint8Array(16);
      colourSlice(l, 'smoke', out);
      for (let c = 0; c < 4; c++) expect(px(out, 4, c, 0).slice(0, 3), `${c}`).toEqual(rgb255(smokeAt(c), 'smoke'));
    });

    it('ignores smoke outside the model when it finds the thickest', () => {
      // The only thick smoke is in a cell outside the model: the valid cells are greyed against their own maximum (0.2), not 99.
      const l = lattice(2, 2, { speed: () => 10, smoke: (c, r) => (c === 1 && r === 1 ? 99 : c === 0 && r === 0 ? 0.2 : 0) }, (c, r) => !(c === 1 && r === 1));
      const out = new Uint8Array(16);
      colourSlice(l, 'speed', out);
      expect(px(out, 2, 0, 0)[3]).toBe(Math.round(curtainAlpha('speed', 10, 0.3) * 255));
    });
  });
});
