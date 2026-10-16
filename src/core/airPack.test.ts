/**
 * The history's packed copy of the diagnosed wind (core/airPack.ts): what it costs, and how far a restored field can be from the
 * exact one. The bound is the one the header states, `max|f| / 65534` plus the rounding of the Float32 read back, checked here
 * against hostile fields as well as smooth ones; the real fast-tier view is checked in sim/airView.sim.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { WIND_PACK_ERROR_PER_SCALE, WIND_PACK_FIXED_BYTES, WIND_PACK_LEVELS, packWind, packedWindBytes, unpackWind, windPackErrorBound } from './airPack';

/** A small deterministic generator (the same fields on every run). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function field(n: number, peak: number, seed: number): Float32Array {
  const r = rng(seed);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = (2 * r() - 1) * peak;
  return f;
}

/** The worst difference (m/s) between a restored field and the exact one. */
const worst = (a: Float32Array, b: Float32Array): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};

describe('packWind and unpackWind', () => {
  it('costs 6 bytes per cell (three 16-bit integers) and a fixed 64: half of the 12 of the live view', () => {
    const n = 45 * 45 * 20;
    const p = packWind(field(n, 12, 1), field(n, 12, 2), field(n, 2, 3))!;
    expect(p.count).toBe(n);
    expect(p.q.length).toBe(3 * n);
    expect(packedWindBytes(p)).toBe(6 * n + WIND_PACK_FIXED_BYTES);
    expect(packedWindBytes(p)).toBeLessThan((12 * n) / 2 + 100);
    expect(6 * n).toBe(243_000); // 45 x 45 x 20: 243 kB against 486 kB
  });

  it('restores every value to within the stated bound, for fields of very different size', () => {
    const n = 4000;
    for (const peak of [0.01, 0.4, 3, 12, 30, 80]) {
      const u = field(n, peak, 11);
      const v = field(n, peak * 0.7, 12);
      const w = field(n, peak * 0.1, 13);
      const p = packWind(u, v, w)!;
      const [bu, bv, bw] = windPackErrorBound(p);
      const r = unpackWind(p);
      expect(worst(r.u, u), `u at ${peak} m/s`).toBeLessThanOrEqual(bu);
      expect(worst(r.v, v), `v at ${peak} m/s`).toBeLessThanOrEqual(bv);
      expect(worst(r.w, w), `w at ${peak} m/s`).toBeLessThanOrEqual(bw);
      // The bound is the one in the header: half a quantum of the largest wind (peak / 65534), not a looser one.
      expect(bu).toBeLessThanOrEqual((peak * 1.0001 * WIND_PACK_ERROR_PER_SCALE) / WIND_PACK_LEVELS);
      expect(bu).toBeLessThan((peak * 1.0001) / 65000);
    }
  });

  it('states the numbers the header gives: 30 m/s is stored to 0.00046 m/s, and the bound is nearly reached by a hostile field', () => {
    const n = 3000;
    // Values that sit half way between two stored integers are the worst case: the error is half a quantum.
    const u = new Float32Array(n);
    const peak = 30;
    const q = peak / WIND_PACK_LEVELS;
    for (let i = 0; i < n; i++) u[i] = i === 0 ? peak : ((i % 4000) + 0.5) * q * (i % 2 ? 1 : -1);
    const p = packWind(u, u, u)!;
    const [bu] = windPackErrorBound(p);
    expect(bu).toBeCloseTo(0.000459, 5);
    const err = worst(unpackWind(p).u, u);
    expect(err).toBeLessThanOrEqual(bu);
    expect(err).toBeGreaterThan(0.9 * 0.5 * q); // the half quantum is really reached: the bound is not slack
  });

  it('gives a field of zeros back as zeros, and a constant field back exactly', () => {
    const n = 100;
    const z = new Float32Array(n);
    const c = new Float32Array(n).fill(-7.25);
    const p = packWind(z, c, z)!;
    expect(p.scale[0]).toBe(0);
    expect(windPackErrorBound(p)[0]).toBe(0);
    const r = unpackWind(p);
    expect(Array.from(r.u).every((x) => x === 0)).toBe(true);
    expect(Array.from(r.v).every((x) => Math.abs(x - -7.25) < 1e-6)).toBe(true);
    expect(Array.from(r.w).every((x) => x === 0)).toBe(true);
  });

  it('keeps the sign and the extremes: the largest wind of a field comes back as itself', () => {
    const u = Float32Array.of(-31.5, 0, 12.25, 31.5);
    const r = unpackWind(packWind(u, u, u)!).u;
    expect(r[0]).toBeCloseTo(-31.5, 5);
    expect(r[3]).toBeCloseTo(31.5, 5);
    expect(r[1]).toBe(0);
    expect(Math.sign(r[2]!)).toBe(1);
  });

  it('stores a value that is not finite as 0 and does not let it set the scale', () => {
    const u = Float32Array.of(5, NaN, Infinity, -Infinity, -5, 2.5);
    const p = packWind(u, u, u)!;
    expect(p.scale[0]).toBeCloseTo(5 / WIND_PACK_LEVELS, 12);
    const r = unpackWind(p).u;
    expect([r[1], r[2], r[3]]).toEqual([0, 0, 0]);
    expect(r[0]).toBeCloseTo(5, 5);
    expect(r[4]).toBeCloseTo(-5, 5);
    expect(r[5]).toBeCloseTo(2.5, 3);
  });

  it('is deterministic, and the restored arrays are the caller’s own (nothing shared with the packed copy)', () => {
    const n = 500;
    const [u, v, w] = [field(n, 9, 21), field(n, 9, 22), field(n, 1, 23)];
    const a = packWind(u, v, w)!;
    const b = packWind(u, v, w)!;
    expect(Buffer.from(a.q.buffer).equals(Buffer.from(b.q.buffer))).toBe(true);
    expect(a.scale).toEqual(b.scale);
    const r1 = unpackWind(a);
    const r2 = unpackWind(a);
    expect(r1.u).not.toBe(r2.u);
    expect(r1.u.buffer).not.toBe(r1.v.buffer);
    expect(r1.u).toEqual(r2.u);
    // The exact fields are not touched.
    expect(u[0]).toBe(field(n, 9, 21)[0]);
  });

  it('is cheap: a 45 x 45 x 20 volume packs once per keyframe and restores once per stretch of air, in milliseconds', () => {
    const n = 45 * 45 * 20;
    const [u, v, w] = [field(n, 12, 31), field(n, 12, 32), field(n, 2, 33)];
    packWind(u, v, w); // warm up
    const runs = 20;
    let t0 = performance.now();
    let p = packWind(u, v, w)!;
    for (let i = 1; i < runs; i++) p = packWind(u, v, w)!;
    const pack = (performance.now() - t0) / runs;
    t0 = performance.now();
    for (let i = 0; i < runs; i++) unpackWind(p);
    const unpack = (performance.now() - t0) / runs;
    // eslint-disable-next-line no-console
    console.log(`[airPack perf] 45 x 45 x 20: pack ${pack.toFixed(2)} ms, unpack ${unpack.toFixed(2)} ms (mean of ${runs}, node)`);
    expect(pack).toBeLessThan(40); // a generous ceiling for a loaded build machine; measured about 2 ms for the pack and under 1 ms for the restore
    expect(unpack).toBeLessThan(40);
  });

  it('refuses a view that holds no wind (empty or ragged arrays)', () => {
    const e = new Float32Array(0);
    expect(packWind(e, e, e)).toBeNull();
    expect(packWind(new Float32Array(4), new Float32Array(4), new Float32Array(3))).toBeNull();
  });
});
