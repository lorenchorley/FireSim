/**
 * The 3-D wind of a diagnosed air view, packed for the history of the time scrubber (pure; fix F1 of the 0.4.0 plan).
 *
 * The fast tier publishes its diagnosed wind (u, v, w on 45 x 45 x 20 native levels) in every air view: 12 bytes per cell, 486 kB, more
 * than half again on a 0.3.0 fast keyframe (825 kB). The history keeps its OLDER pictures in a cheaper copy: each of u, v and w as
 * signed 16-bit integers with its own scale, 6 bytes per cell (243 kB). The live view and the engine are never touched; only what the
 * store keeps for pictures that are no longer the newest is packed, and what it hands back for them is a plain Float32 view the
 * sampler reads like any other.
 *
 * Error bound (the curtain, the slice and the wind speed map read these views when the user scrubs back). A field is stored as
 * `q = round(f / s)` with `s = max|f| / 32767` over its finite values, and read back as `q · s`. So the stored value is within half a
 * quantum of the exact one, `s / 2 = max|f| / 65534`, plus the rounding of the Float32 it is read back into (at most `max|f| · 2⁻²⁴`):
 * {@link windPackErrorBound} gives `s · (0.5 + 32767 · 2⁻²⁴)`, about `0.502 s`, per field. For a field whose largest wind is 30 m/s
 * that is 0.00046 m/s, and 0.0001 m/s for a w of 6 m/s. A sampled value is a convex mix of stored values (bilinear in the plane,
 * linear in the level), so it is off by at most the same. A value that is not finite is stored as 0 (the engine never publishes one);
 * it does not take part in the scale.
 */

/** Largest stored integer: the quantum of a field is its largest wind divided by this. */
export const WIND_PACK_LEVELS = 32767;

/** Stored bytes per value (a signed 16-bit integer) against the 4 of the live view. */
export const WIND_PACK_BYTES_PER_VALUE = 2;

/** Bytes of the bookkeeping around a packed volume (the object, its scales) that {@link packedWindBytes} adds to the integers. */
export const WIND_PACK_FIXED_BYTES = 64;

/** The error bound per quantum: half a quantum, plus the rounding of the Float32 the value is read back into (see the header). */
export const WIND_PACK_ERROR_PER_SCALE = 0.5 + WIND_PACK_LEVELS * 2 ** -24;

export interface PackedWind {
  /** Values per field (nx · ny · nz of the view it was made from). */
  count: number;
  /** The quantum (m/s) of u, v and w: a stored integer q stands for `q · scale`. 0 for a field that is zero everywhere. */
  scale: readonly [number, number, number];
  /** u, then v, then w: `3 · count` integers, each field in the view's own order (k = (z · ny + j) · nx + i). */
  q: Int16Array;
}

/**
 * Pack the three wind arrays of a view (equal lengths), or null when they are empty or differ in length (a view without a wind).
 */
export function packWind(u: Float32Array, v: Float32Array, w: Float32Array): PackedWind | null {
  const n = u.length;
  if (n === 0 || v.length !== n || w.length !== n) return null;
  const q = new Int16Array(3 * n);
  const scale: [number, number, number] = [0, 0, 0];
  const fields = [u, v, w];
  for (let c = 0; c < 3; c++) {
    const f = fields[c]!;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(f[i]!);
      if (a > m && a !== Infinity) m = a; // NaN never compares greater
    }
    if (!(m > 0)) continue; // all zero (or none finite): the integers stay 0
    const s = m / WIND_PACK_LEVELS;
    const inv = 1 / s;
    scale[c] = s;
    const o = c * n;
    for (let i = 0; i < n; i++) {
      const x = f[i]!;
      q[o + i] = Math.abs(x) <= m ? Math.round(x * inv) : 0; // NaN and ±Infinity fail the test and are stored as 0
    }
  }
  return { count: n, scale, q };
}

/** The wind of a packed volume as Float32 arrays of their own: what the sampler reads. */
export function unpackWind(p: PackedWind): { u: Float32Array; v: Float32Array; w: Float32Array } {
  const n = p.count;
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as const;
  for (let c = 0; c < 3; c++) {
    const f = out[c];
    const s = p.scale[c]!;
    const o = c * n;
    for (let i = 0; i < n; i++) f[i] = p.q[o + i]! * s;
  }
  return { u: out[0], v: out[1], w: out[2] };
}

/** Bytes a packed volume holds (the integers and a small fixed part). */
export function packedWindBytes(p: PackedWind): number {
  return p.q.byteLength + WIND_PACK_FIXED_BYTES;
}

/** The most (m/s) a restored u, v and w can differ from the exact ones, and so can any value the sampler reads from them. */
export function windPackErrorBound(p: PackedWind): [number, number, number] {
  return [p.scale[0] * WIND_PACK_ERROR_PER_SCALE, p.scale[1] * WIND_PACK_ERROR_PER_SCALE, p.scale[2] * WIND_PACK_ERROR_PER_SCALE];
}
