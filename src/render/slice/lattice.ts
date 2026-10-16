/**
 * Reading a sampled slice between its lattice points (pure; shared by the probe and the flow streaks). A point (s, z) of the
 * slice sits in a cell of four lattice points; the bilinear weights are multiplied by the validity mask and renormalised, so a
 * point just above the model's ground is not pulled towards the zeros an invalid cell holds (the same near-ground bias the
 * terrain-following view exists to remove). The stencil is a reused object, and the point to look up is passed in a Float64Array
 * [s, z] rather than as two numbers, which V8 would box (16 bytes each) unless it inlined the call (spike S3, the sampler's
 * `windP`): a lookup allocates nothing.
 */
import type { SliceData } from './types';

export class LatticeStencil {
  /** Indices (r · columns + c) of the four lattice points: (c, r), (c + 1, r), (c, r + 1), (c + 1, r + 1). */
  k00 = 0;
  k10 = 0;
  k01 = 0;
  k11 = 0;
  /** Their weights: bilinear, times validity, renormalised to sum to 1 (all 0 when `coverage` is 0). */
  w00 = 0;
  w10 = 0;
  w01 = 0;
  w11 = 0;
  /** The share of the bilinear weight that fell on valid cells: 1 inside the model's air, 0 when no corner is valid. */
  coverage = 0;

  /** Find the stencil of the point p = [s, z]: s metres from A, z metres ASL, clamped into the slice. */
  locate(d: SliceData, p: Float64Array): void {
    const s = p[0]!;
    const z = p[1]!;
    const cols = d.columns;
    const rows = d.rows;
    const length = d.line.length;
    let fc = length > 0 ? (s / length) * (cols - 1) : 0;
    let fr = d.zMax > d.zMin ? ((z - d.zMin) / (d.zMax - d.zMin)) * (rows - 1) : 0;
    fc = fc < 0 ? 0 : fc > cols - 1 ? cols - 1 : fc;
    fr = fr < 0 ? 0 : fr > rows - 1 ? rows - 1 : fr;
    const c0 = Math.min(fc | 0, Math.max(0, cols - 2));
    const r0 = Math.min(fr | 0, Math.max(0, rows - 2));
    const c1 = Math.min(c0 + 1, cols - 1);
    const r1 = Math.min(r0 + 1, rows - 1);
    const tx = fc - c0;
    const ty = fr - r0;
    const k00 = r0 * cols + c0;
    const k10 = r0 * cols + c1;
    const k01 = r1 * cols + c0;
    const k11 = r1 * cols + c1;
    this.k00 = k00;
    this.k10 = k10;
    this.k01 = k01;
    this.k11 = k11;
    const v = d.valid;
    const a = (1 - tx) * (1 - ty) * v[k00]!;
    const b = tx * (1 - ty) * v[k10]!;
    const c = (1 - tx) * ty * v[k01]!;
    const e = tx * ty * v[k11]!;
    const sum = a + b + c + e;
    this.coverage = sum;
    const inv = sum > 1e-12 ? 1 / sum : 0;
    this.w00 = a * inv;
    this.w10 = b * inv;
    this.w01 = c * inv;
    this.w11 = e * inv;
  }

  /** The weighted value of one lattice field at the located point. */
  value(f: Float32Array): number {
    return this.w00 * f[this.k00]! + this.w10 * f[this.k10]! + this.w01 * f[this.k01]! + this.w11 * f[this.k11]!;
  }
}

/** Below this share of valid air under a point (see `LatticeStencil.coverage`) the point counts as outside the model's air: nothing to read. */
const IN_AIR_COVERAGE = 0.5;

/**
 * The wind in the slice's plane at p = [s, z], read from the lattice: `out` = [along the line, up] in m/s. This is what the curtain's
 * arrows show for a RECORDED slice (the air of the picture on screen is not the air the recording holds, so arrows from the sampler would
 * disagree with the colours). Validity-weighted like every lattice read, so 30 m above the ground is not pulled towards the zeros below
 * it. False, with `out` untouched, where the point is not in the model's air (less than half of its cell is valid).
 */
export function latticeInPlaneWind(d: SliceData, st: LatticeStencil, p: Float64Array, out: Float32Array): boolean {
  st.locate(d, p);
  if (!(st.coverage >= IN_AIR_COVERAGE)) return false; // (a point that is not a number has no coverage)
  out[0] = st.value(d.values.along);
  out[1] = st.value(d.values.up);
  return true;
}

/**
 * The mean wind along the line (m/s) at the highest valid cell of `n` evenly spaced columns, 0 when no column has air: the reference
 * direction of the upper-level wind that decides which arrows are reverse flow. The lattice's top row is 2 km above the highest ground
 * or the model top, which is where the live curtain reads (300 m under the top).
 */
export function upperAlongMean(d: SliceData, n: number): number {
  let sum = 0;
  let found = 0;
  for (let m = 0; m < n; m++) {
    const c = Math.round(((m + 0.5) / n) * (d.columns - 1));
    for (let r = d.rows - 1; r >= 0; r--) {
      const k = r * d.columns + c;
      if (d.valid[k] === 1) {
        sum += d.values.along[k]!;
        found++;
        break;
      }
    }
  }
  return found > 0 ? sum / found : 0;
}

/**
 * True when the point p = [s, z] lies inside the slice, its nearest lattice point is valid air and it is above the 10 m ground
 * under it (the line the filled ground is drawn with). This is the test a streak uses to know it has left the air (the ground,
 * the model's top, either end of the line). The second condition matters where the model's own ground is lower than the 10 m
 * ground (a crag or cliff the model smooths away): that air is valid in the model but the panel draws solid ground over it.
 */
export function inValidAir(d: SliceData, p: Float64Array): boolean {
  const s = p[0]!;
  const z = p[1]!;
  const length = d.line.length;
  if (!(s >= 0 && s <= length && z >= d.zMin && z <= d.zMax)) return false;
  const fc = length > 0 ? (s / length) * (d.columns - 1) : 0;
  const c = Math.round(fc);
  const r = d.zMax > d.zMin ? Math.round(((z - d.zMin) / (d.zMax - d.zMin)) * (d.rows - 1)) : 0;
  if (d.valid[r * d.columns + c] !== 1) return false;
  const c0 = Math.max(0, Math.min(Math.floor(fc), d.columns - 2));
  const c1 = Math.min(c0 + 1, d.columns - 1);
  return z >= d.ground[c0]! + (d.ground[c1]! - d.ground[c0]!) * (fc - c0);
}
