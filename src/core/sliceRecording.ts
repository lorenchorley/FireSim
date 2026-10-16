/**
 * Packing and the byte model of the time-lapse recorder of an Air slice line (pure; 0.4.1, plan 8.6 and decision D7).
 *
 * The recorder keeps the slice of ONE hand-placed line at the times the simulation produced a picture, so the side view can
 * replay how the air changed since the line was placed (render/slice/sliceRecorder.ts). A sample is the slice's lattice as signed
 * 16-bit integers: along, across and up (the wind, 6 bytes a lattice point) and, on the 3-D air, theta and smoke (4 more). The speed
 * is not stored: `hypot(along, across)` is exactly the horizontal speed, because along and across are the wind turned by a unit vector.
 *
 * Error bounds, as in core/airPack.ts (the same `q = round(f / s)`, `s = max|f| / 32767`, whose per-field bound is
 * {@link sliceFieldErrorBound}): along, across, up and theta come back within `0.502 s`, which is 0.00046 m/s for a wind of 30 m/s
 * and 0.0003 K for an anomaly of 20 K. The speed derived from two of them is off by at most `hypot` of their two bounds (0.00065 m/s at
 * 30 m/s). Smoke spans four decades on the legend's log ramp, so a linear code would put its 1e-4 end on three steps: it is a log code
 * (`1 + round((log10 s + 6) / 9 x 32766)`, 0 below 1e-6), within a relative 3.3e-4 for 1e-6 <= s <= 1e3 (above that it is clamped to
 * 1e3; below 1e-6 it reads back as 0, an absolute error under 1e-6). A value that is not finite is stored as 0.
 *
 * Only the three budget functions are used by the entry chunk (scenario/memoryModel.ts); the rest is the render chunk's.
 */
import { WIND_PACK_ERROR_PER_SCALE, WIND_PACK_LEVELS } from './airPack';

/** The two kinds of air a slice can show (render/slice/types.ts `SliceKind`). */
export type RecordedKind = 'prognostic' | 'diagnosed';

/** The most the recorder keeps (12 MiB); the share of the history below it is {@link sliceRecorderBudgetBytes}. */
export const SLICE_RECORDER_MAX_BYTES = 12 * 1048576;

/** The recorder's budget is this fraction of the history's (6 MiB on the 48 MiB of the weakest phone); it comes on top of the history, not out of it. */
export const SLICE_RECORDER_HISTORY_SHARE = 1 / 8;

/** Bytes of the bookkeeping around a sample (the object, its scales, its times) that {@link sliceSampleBytes} adds to the integers, as `WIND_PACK_FIXED_BYTES` does for a packed volume. */
export const SLICE_SAMPLE_FIXED_BYTES = 96;

/** Fields a sample holds: the wind (along, across, up), and on the 3-D air theta and smoke as well. */
export const SLICE_WIND_FIELDS = 3;
export const SLICE_AIR_FIELDS = 5;

/** The recorder's budget (bytes) for a history of `historyBytes`: an eighth of it, at most 12 MiB. */
export function sliceRecorderBudgetBytes(historyBytes: number): number {
  const h = Number.isFinite(historyBytes) && historyBytes > 0 ? historyBytes : 0;
  return Math.min(SLICE_RECORDER_MAX_BYTES, Math.round(h * SLICE_RECORDER_HISTORY_SHARE));
}

/** Integers of a sample per lattice point: 5 on the 3-D air, 3 on the diagnosed wind. */
export const sliceFieldsOf = (kind: RecordedKind): number => (kind === 'prognostic' ? SLICE_AIR_FIELDS : SLICE_WIND_FIELDS);

/** Bytes of one recorded sample of `points` lattice points (the integers and a small fixed part): 48,696 at 90 x 54 on the 3-D air, 29,256 on the diagnosed wind. */
export function sliceSampleBytes(points: number, kind: RecordedKind): number {
  return points * sliceFieldsOf(kind) * 2 + SLICE_SAMPLE_FIXED_BYTES;
}

/** The error bound (in the field's unit) of a field packed with `scale`: half a quantum plus the rounding of the Float32 it is read back into. */
export function sliceFieldErrorBound(scale: number): number {
  return scale * WIND_PACK_ERROR_PER_SCALE;
}

/**
 * Pack the first `n` values of `src` into `dst[offset ..]` as `round(f / s)` and return the scale `s` (a Float32, so the number
 * stored with a sample is the number used to read it back; 0 for a field that is zero everywhere). Every one of the `n` slots is
 * written, so `dst` may be an array that held an older sample. Values that are not finite are stored as 0 and do not take part in the scale.
 */
export function packField(src: ArrayLike<number>, n: number, dst: Int16Array, offset: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(src[i]!);
    if (a > m && a !== Infinity) m = a; // NaN never compares greater
  }
  const s = Math.fround(m / WIND_PACK_LEVELS);
  const inv = 1 / s;
  if (!(m > 0) || !(s > 0) || !Number.isFinite(inv)) {
    dst.fill(0, offset, offset + n); // all zero, or so small that its quantum is not a Float32
    return 0;
  }
  for (let i = 0; i < n; i++) {
    const x = src[i]!;
    dst[offset + i] = Math.abs(x) <= m ? Math.round(x * inv) : 0; // NaN and the infinities fail the test
  }
  return s;
}

/** `out[i] = q[offset + i] x scale` for the first `n` values. */
export function unpackField(q: Int16Array, offset: number, n: number, scale: number, out: Float32Array): void {
  for (let i = 0; i < n; i++) out[i] = q[offset + i]! * scale;
}

/** Smoke below this reads back as 0; above `SMOKE_CODE_CEIL` it is clamped (concentration in the model's own units: the legend's ramp spans 1e-4 to 1). */
export const SMOKE_CODE_FLOOR = 1e-6;
export const SMOKE_CODE_CEIL = 1e3;
/** Codes 1 to 32767 span the nine decades from the floor to the ceiling. */
const SMOKE_CODE_TOP = 32767;
const SMOKE_DECADES = 9;
const SMOKE_STEPS = SMOKE_CODE_TOP - 1;
/** The most a smoke value in the code's range comes back off by, relative: half a step is 1.37e-4 of a decade, 3.16e-4, plus the Float32 it is read into. */
export const SMOKE_CODE_MAX_RELATIVE_ERROR = 3.3e-4;

let smokeTable: Float32Array | null = null;
/** The value of every code, made once (128 kB): reading a sample is a table lookup per point, not a power. */
function smokeValues(): Float32Array {
  if (smokeTable) return smokeTable;
  const t = new Float32Array(SMOKE_CODE_TOP + 1);
  for (let q = 1; q <= SMOKE_CODE_TOP; q++) t[q] = 10 ** (((q - 1) / SMOKE_STEPS) * SMOKE_DECADES - 6);
  smokeTable = t;
  return t;
}

/** The log code of one smoke value: 0 below the floor (and for anything that is not a finite number), 1 to 32767 from the floor to the ceiling. */
export function smokeCode(s: number): number {
  if (!(s >= SMOKE_CODE_FLOOR) || s === Infinity) return 0;
  if (s >= SMOKE_CODE_CEIL) return SMOKE_CODE_TOP;
  return 1 + Math.round(((Math.log10(s) + 6) / SMOKE_DECADES) * SMOKE_STEPS);
}

/** Pack the first `n` smoke values into `dst[offset ..]` as log codes (every slot is written). */
export function packSmoke(src: ArrayLike<number>, n: number, dst: Int16Array, offset: number): void {
  for (let i = 0; i < n; i++) dst[offset + i] = smokeCode(src[i]!);
}

/** The smoke of the first `n` log codes of `q[offset ..]`. */
export function unpackSmoke(q: Int16Array, offset: number, n: number, out: Float32Array): void {
  const t = smokeValues();
  for (let i = 0; i < n; i++) {
    const c = q[offset + i]!;
    out[i] = c > 0 ? t[c]! : 0;
  }
}
