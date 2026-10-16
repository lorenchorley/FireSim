/**
 * The packing and the byte model of the Air slice time-lapse recorder (0.4.1): each field comes back within the bound the header of
 * sliceRecording.ts gives, smoke within its relative bound, the bytes a sample holds are what the byte model says, and the budget and the
 * capacity are the numbers of the design (a 90 x 54 lattice holds 258 samples of the 3-D air in 12 MiB, 430 of the diagnosed wind).
 */
import { describe, expect, it } from 'vitest';
import { WIND_PACK_ERROR_PER_SCALE } from './airPack';
import {
  packField,
  packSmoke,
  SLICE_AIR_FIELDS,
  SLICE_RECORDER_MAX_BYTES,
  SLICE_SAMPLE_FIXED_BYTES,
  SLICE_WIND_FIELDS,
  sliceFieldErrorBound,
  sliceFieldsOf,
  sliceRecorderBudgetBytes,
  sliceSampleBytes,
  SMOKE_CODE_CEIL,
  SMOKE_CODE_FLOOR,
  SMOKE_CODE_MAX_RELATIVE_ERROR,
  smokeCode,
  unpackField,
  unpackSmoke,
} from './sliceRecording';

const MiB = 1048576;

/** A small seeded generator (mulberry32): the fields below are the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function field(n: number, amplitude: number, seed: number): Float32Array {
  const r = rng(seed);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = (r() * 2 - 1) * amplitude;
  return f;
}

function roundTrip(src: Float32Array, junk = 0): { out: Float32Array; scale: number; q: Int16Array } {
  const n = src.length;
  const q = new Int16Array(n + 8).fill(junk); // an array that held an older sample, with room on both sides
  const scale = packField(src, n, q, 4);
  const out = new Float32Array(n);
  unpackField(q, 4, n, scale, out);
  return { out, scale, q };
}

describe('packField and unpackField', () => {
  for (const [name, amplitude] of [
    ['a wind of 30 m/s', 30],
    ['a vertical wind of 6 m/s', 6],
    ['a temperature anomaly of 20 K', 20],
    ['a field of 0.002 (a calm night)', 0.002],
    ['a field of 5000', 5000],
  ] as const) {
    it(`${name} comes back within half a quantum plus the Float32 it is read into (0.502 s)`, () => {
      const src = field(4860, amplitude, 7);
      const { out, scale } = roundTrip(src);
      const bound = sliceFieldErrorBound(scale);
      expect(scale).toBeGreaterThan(0);
      expect(bound).toBeCloseTo(scale * (0.5 + 32767 * 2 ** -24), 12);
      expect(bound).toBeCloseTo(scale * WIND_PACK_ERROR_PER_SCALE, 12);
      let worst = 0;
      for (let i = 0; i < src.length; i++) worst = Math.max(worst, Math.abs(out[i]! - src[i]!));
      expect(worst).toBeLessThanOrEqual(bound);
      // The test can fail: the integers really are coarser than the field (a quantum is max / 32767), so errors are not all zero.
      expect(worst).toBeGreaterThan(0.2 * scale);
      // and the quantum is the largest value over 32767, as airPack.ts says
      const largest = Math.max(...Array.from(src, Math.abs));
      expect(Math.abs(scale * 32767 - largest)).toBeLessThanOrEqual(largest * 1e-6);
    });
  }

  it('the figures of the header: 0.00046 m/s at 30 m/s, 0.0003 K at 20 K', () => {
    const wind = roundTrip(field(2000, 30, 1));
    expect(sliceFieldErrorBound(wind.scale)).toBeLessThan(0.00047);
    expect(sliceFieldErrorBound(wind.scale)).toBeGreaterThan(0.00045);
    const theta = roundTrip(field(2000, 20, 2));
    expect(sliceFieldErrorBound(theta.scale)).toBeLessThan(0.0004);
    expect(sliceFieldErrorBound(theta.scale)).toBeGreaterThan(0.0003);
  });

  it('the extremes are exact to the quantum and an all-zero field has scale 0 and zeros', () => {
    const src = Float32Array.from([30, -30, 0, 15, -7.5]);
    const { out, scale, q } = roundTrip(src);
    expect(q[4]).toBe(32767);
    expect(q[5]).toBe(-32767);
    expect(q[6]).toBe(0);
    expect(Math.abs(out[0]! - 30)).toBeLessThanOrEqual(sliceFieldErrorBound(scale));
    const zero = roundTrip(new Float32Array(50), 123);
    expect(zero.scale).toBe(0);
    expect(Array.from(zero.q.subarray(4, 54)).every((x) => x === 0)).toBe(true);
    expect(Array.from(zero.out).every((x) => x === 0)).toBe(true);
  });

  it('a value that is not finite is stored as 0 and does not take part in the scale', () => {
    const src = Float32Array.from([1, NaN, -2, Infinity, -Infinity, 0.5]);
    const { out, scale } = roundTrip(src);
    expect(scale).toBeCloseTo(2 / 32767, 12); // 2 is the largest finite magnitude
    expect(out[1]).toBe(0);
    expect(out[3]).toBe(0);
    expect(out[4]).toBe(0);
    expect(out[0]).toBeCloseTo(1, 4);
    expect(out[2]).toBeCloseTo(-2, 4);
    const allBad = roundTrip(Float32Array.from([NaN, Infinity, -Infinity]), 9);
    expect(allBad.scale).toBe(0);
    expect(Array.from(allBad.out)).toEqual([0, 0, 0]);
  });

  it('writes every slot it was asked for and nothing next to them (the array of an older sample is reused)', () => {
    const src = field(100, 12, 3);
    const { q } = roundTrip(src, 31000);
    expect(q[0]).toBe(31000);
    expect(q[3]).toBe(31000);
    expect(q[104]).toBe(31000);
    expect(q[107]).toBe(31000);
    for (let i = 4; i < 104; i++) expect(Math.abs(q[i]!)).toBeLessThanOrEqual(32767);
    const changed = Array.from(q.subarray(4, 104)).filter((x) => x === 31000).length;
    expect(changed).toBeLessThan(3); // the stale 31000s are gone (a coincidence of a real value is allowed, a leftover run is not)
  });

  it('a field too small for a Float32 quantum is stored as zeros rather than as garbage', () => {
    const { scale, out } = roundTrip(Float32Array.from([1e-42, -1e-42]));
    expect(scale).toBe(0);
    expect(Array.from(out)).toEqual([0, 0]);
  });
});

describe('smoke: a log code', () => {
  const codeBack = (s: number): number => {
    const q = new Int16Array(1);
    packSmoke([s], 1, q, 0);
    const out = new Float32Array(1);
    unpackSmoke(q, 0, 1, out);
    return out[0]!;
  };

  it('comes back within a relative 3.3e-4 from 1e-6 to 1e3, over the whole range', () => {
    expect(SMOKE_CODE_MAX_RELATIVE_ERROR).toBe(3.3e-4);
    let worst = 0;
    const n = 30000;
    for (let i = 0; i <= n; i++) {
      const s = 10 ** (-6 + (9 * i) / n);
      const back = codeBack(s);
      worst = Math.max(worst, Math.abs(back - s) / s);
    }
    expect(worst).toBeLessThanOrEqual(SMOKE_CODE_MAX_RELATIVE_ERROR);
    expect(worst).toBeGreaterThan(2.5e-4); // it is a code, not a copy: the worst case is near half a step (3.16e-4)
  });

  it('keeps the legend’s four decades (1e-4 to 1) on thousands of codes, where a linear Int16 would give the 1e-4 end three', () => {
    expect(smokeCode(1) - smokeCode(1e-4)).toBeGreaterThan(10000);
    const linearStepsAt1e4 = 1e-4 / (1 / 32767);
    expect(linearStepsAt1e4).toBeLessThan(4);
    // a 1 % change anywhere on the ramp is many codes
    expect(smokeCode(1.01e-4) - smokeCode(1e-4)).toBeGreaterThan(12);
  });

  it('0 stays 0 and so does everything below the floor, negative and not finite', () => {
    for (const s of [0, -0, 9.99e-7, 1e-12, -1, -1e-9, NaN, Infinity, -Infinity]) expect(codeBack(s), String(s)).toBe(0);
    expect(smokeCode(0)).toBe(0);
    expect(SMOKE_CODE_FLOOR).toBe(1e-6);
    expect(codeBack(SMOKE_CODE_FLOOR)).toBeCloseTo(1e-6, 12);
    expect(codeBack(1.0001e-6)).toBeGreaterThan(0.99e-6);
  });

  it('above the ceiling it is clamped to 1e3', () => {
    expect(SMOKE_CODE_CEIL).toBe(1e3);
    expect(Math.abs(codeBack(5e4) - 1e3) / 1e3).toBeLessThanOrEqual(SMOKE_CODE_MAX_RELATIVE_ERROR);
    expect(smokeCode(1e3)).toBe(32767);
    expect(smokeCode(5e4)).toBe(32767);
  });

  it('codes rise with the value, so the order of two concentrations is kept', () => {
    let prev = 0;
    for (let i = 0; i < 2000; i++) {
      const c = smokeCode(10 ** (-6 + (9 * i) / 2000));
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it('writes every slot (the array of an older sample is reused) and never a code that does not exist', () => {
    const q = new Int16Array(10).fill(-1);
    packSmoke([1e-3, 0, 5, NaN], 4, q, 2);
    expect(q[0]).toBe(-1);
    expect(q[6]).toBe(-1);
    expect(q[3]).toBe(0);
    expect(q[5]).toBe(0);
    expect(q[2]).toBeGreaterThan(0);
    for (const c of q.subarray(2, 6)) expect(c).toBeGreaterThanOrEqual(0);
  });
});

describe('the byte model', () => {
  it('a sample holds its integers and 96 bytes: 48,696 at 90 x 54 on the 3-D air, 29,256 on the diagnosed wind, 107,616 and 64,608 at 192 x 56', () => {
    expect(SLICE_SAMPLE_FIXED_BYTES).toBe(96);
    expect(sliceFieldsOf('prognostic')).toBe(SLICE_AIR_FIELDS);
    expect(sliceFieldsOf('diagnosed')).toBe(SLICE_WIND_FIELDS);
    expect(sliceSampleBytes(90 * 54, 'prognostic')).toBe(48696);
    expect(sliceSampleBytes(90 * 54, 'diagnosed')).toBe(29256);
    expect(sliceSampleBytes(192 * 56, 'prognostic')).toBe(107616);
    expect(sliceSampleBytes(192 * 56, 'diagnosed')).toBe(64608);
    expect(sliceSampleBytes(48 * 48, 'prognostic')).toBe(23136);
    expect(sliceSampleBytes(120 * 54, 'prognostic')).toBe(64896);
  });

  it('equals q.byteLength + 96 for the integers the packers fill', () => {
    for (const kind of ['prognostic', 'diagnosed'] as const) {
      const points = 90 * 54;
      const q = new Int16Array(points * sliceFieldsOf(kind));
      packField(field(points, 20, 1), points, q, 0);
      packField(field(points, 20, 2), points, q, points);
      packField(field(points, 5, 3), points, q, 2 * points);
      if (kind === 'prognostic') {
        packField(field(points, 8, 4), points, q, 3 * points);
        packSmoke(field(points, 1, 5).map(Math.abs), points, q, 4 * points);
      }
      expect(sliceSampleBytes(points, kind)).toBe(q.byteLength + SLICE_SAMPLE_FIXED_BYTES);
    }
  });

  it('the budget is an eighth of the history, at most 12 MiB: 6, 7.7, 12 and 12 MiB at 48, 61.4, 96 and 160 MiB', () => {
    expect(SLICE_RECORDER_MAX_BYTES).toBe(12 * MiB);
    expect(sliceRecorderBudgetBytes(48 * MiB)).toBe(6 * MiB);
    expect(sliceRecorderBudgetBytes(61.44 * MiB) / MiB).toBeCloseTo(7.68, 2);
    expect(sliceRecorderBudgetBytes(96 * MiB)).toBe(12 * MiB);
    expect(sliceRecorderBudgetBytes(160 * MiB)).toBe(12 * MiB);
    expect(sliceRecorderBudgetBytes(1e12)).toBe(12 * MiB);
    // never negative, never NaN
    for (const bad of [0, -5, NaN, -Infinity]) expect(sliceRecorderBudgetBytes(bad)).toBe(0);
    expect(sliceRecorderBudgetBytes(Infinity)).toBe(0); // not a number of bytes: nothing is recorded rather than 12 MiB on a guess
  });

  it('capacity: 258 samples of the 3-D air and 430 of the diagnosed wind in 12 MiB at 90 x 54; 129 and 215 in the 6 MiB of a small phone', () => {
    const cap = (bytes: number, columns: number, rows: number, kind: 'prognostic' | 'diagnosed'): number => Math.floor(bytes / sliceSampleBytes(columns * rows, kind));
    expect(cap(12 * MiB, 90, 54, 'prognostic')).toBe(258);
    expect(cap(12 * MiB, 90, 54, 'diagnosed')).toBe(430);
    expect(cap(6 * MiB, 90, 54, 'prognostic')).toBe(129);
    expect(cap(6 * MiB, 90, 54, 'diagnosed')).toBe(215);
    expect(cap(12 * MiB, 120, 54, 'prognostic')).toBe(193);
    expect(cap(12 * MiB, 120, 54, 'diagnosed')).toBe(322);
    expect(cap(12 * MiB, 192, 56, 'prognostic')).toBe(116);
    expect(cap(12 * MiB, 192, 56, 'diagnosed')).toBe(194);
    expect(cap(12 * MiB, 48, 48, 'prognostic')).toBe(543);
    expect(cap(12 * MiB, 48, 48, 'diagnosed')).toBe(903);
  });
});
