/**
 * Flow streaks in the plane of a slice (pure; plan 8.5): particles that drift through the stored along-line wind and the
 * vertical motion so rotors, lee eddies and the fire's indraft visibly move, and the static arrow lattice the panel draws
 * instead under reduced motion. Particles live in slice coordinates (`s` metres from A, `z` metres ASL), are advected by
 * bilinear lookups on the lattice (the stored arrays, no resampling; the validity mask keeps the zeros under the ground out of
 * the blend) and use a seeded generator, never Math.random, so a seed gives the same streaks every time.
 *
 * The vertical part of the motion is multiplied by `exaggeration`, the on-screen ratio of the vertical to the horizontal scale
 * of the picture, so a streak points the way the picture shows the flow, whatever the height axis is stretched to.
 */
import { inValidAir, LatticeStencil } from './lattice';
import type { SliceData } from './types';

export interface FlowParticles {
  count: number;
  /** Where each particle is now: metres from A along the line, and metres ASL. */
  s: Float32Array;
  z: Float32Array;
  /** Where it was one step ago, so a streak is drawn from there to here. A particle that was just (re-)seeded has ps = s and pz = z. */
  ps: Float32Array;
  pz: Float32Array;
  /** Seconds of the panel's clock since the particle was (re-)seeded. */
  age: Float32Array;
  /** The generator state (32 bits); it moves with every random draw, so the same seed and the same calls give the same streaks. */
  seed: number;
}

export interface FlowOptions {
  /** On-screen ratio of vertical to horizontal scale (1 when the picture is true to scale); the vertical motion is multiplied by it. */
  exaggeration: number;
  /** Seconds of air time that pass per second of the panel's clock. */
  timeScale: number;
  /** A particle older than this (seconds of the panel's clock) is re-seeded. */
  maxAgeS: number;
}

/** Seeded particles start with ages spread over this many seconds, so they do not all expire in the same frame. */
const SEED_AGE_SPREAD_S = 4;
/** Random tries to find valid air before the scan over the whole lattice. */
const PLACE_TRIES = 24;

const stencil = new LatticeStencil();
const vel = new Float64Array(2);

/** A mulberry32 draw in [0, 1), advancing `f.seed`. */
function next(f: FlowParticles): number {
  let t = (f.seed = (f.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createFlow(count: number, seed = 1): FlowParticles {
  const n = Math.max(0, Math.floor(count));
  return {
    count: n,
    s: new Float32Array(n),
    z: new Float32Array(n),
    ps: new Float32Array(n),
    pz: new Float32Array(n),
    age: new Float32Array(n),
    seed: (Math.floor(seed) | 0) || 1,
  };
}

/** Put particle `i` somewhere in valid air (random tries, then a scan from a random lattice point); false when the slice holds none. */
function place(f: FlowParticles, i: number, d: SliceData): boolean {
  const length = d.line.length;
  const span = d.zMax - d.zMin;
  for (let q = 0; q < PLACE_TRIES; q++) {
    const s = next(f) * length;
    const z = d.zMin + next(f) * span;
    if (inValidAir(d, s, z)) {
      f.s[i] = s;
      f.z[i] = z;
      f.ps[i] = s;
      f.pz[i] = z;
      return true;
    }
  }
  const n = d.columns * d.rows;
  const start = Math.floor(next(f) * n);
  for (let q = 0; q < n; q++) {
    const k = (start + q) % n;
    if (d.valid[k] === 1) {
      const s = ((k % d.columns) / Math.max(1, d.columns - 1)) * length;
      const z = d.zMin + (Math.floor(k / d.columns) / Math.max(1, d.rows - 1)) * span;
      f.s[i] = s;
      f.z[i] = z;
      f.ps[i] = s;
      f.pz[i] = z;
      return true;
    }
  }
  f.s[i] = 0;
  f.z[i] = d.zMin;
  f.ps[i] = 0;
  f.pz[i] = d.zMin;
  return false;
}

/** Scatter the particles over the valid air of `data`, with ages spread so they expire at different times. */
export function seedFlow(f: FlowParticles, data: SliceData): void {
  for (let i = 0; i < f.count; i++) {
    place(f, i, data);
    f.age[i] = next(f) * SEED_AGE_SPREAD_S;
  }
}

/** The along-line wind and the vertical wind (m/s) at (s, z) into vel[0], vel[1]; false where no valid air surrounds the point. */
function velocityAt(d: SliceData, s: number, z: number): boolean {
  stencil.locate(d, s, z);
  if (stencil.coverage <= 1e-9) return false;
  vel[0] = stencil.value(d.values.along);
  vel[1] = stencil.value(d.values.up);
  return true;
}

/**
 * Advance every particle by `dtS` seconds of the panel's clock, which is `dtS x timeScale` seconds of air time, with a midpoint
 * (second order) step through the stored `along` and `up` (the vertical times `exaggeration`). A particle that ends outside the
 * valid air, or older than `maxAgeS`, is re-seeded at a random place with age 0. A step of zero or less changes nothing.
 */
export function stepFlow(f: FlowParticles, data: SliceData, dtS: number, opts: FlowOptions): void {
  if (!(dtS > 0)) return;
  const dt = dtS * opts.timeScale;
  const ex = opts.exaggeration;
  for (let i = 0; i < f.count; i++) {
    const s0 = f.s[i]!;
    const z0 = f.z[i]!;
    f.ps[i] = s0;
    f.pz[i] = z0;
    f.age[i] = f.age[i]! + dtS;
    let moved = false;
    if (f.age[i]! <= opts.maxAgeS && velocityAt(data, s0, z0)) {
      const u1 = vel[0]!;
      const w1 = vel[1]! * ex;
      let u = u1;
      let w = w1;
      if (velocityAt(data, s0 + 0.5 * dt * u1, z0 + 0.5 * dt * w1)) {
        u = vel[0]!;
        w = vel[1]! * ex;
      }
      const s1 = s0 + dt * u;
      const z1 = z0 + dt * w;
      if (inValidAir(data, s1, z1)) {
        f.s[i] = s1;
        f.z[i] = z1;
        moved = true;
      }
    }
    if (!moved) {
      place(f, i, data);
      f.age[i] = 0;
    }
  }
}

/**
 * The static arrow lattice for reduced motion: an `nCols` by `nRows` grid of points over the slice (the centre of each of the
 * equal divisions of the line and of the height axis), kept where there is valid air. `angle` is the screen angle of the
 * vector (along, up x exaggeration) in radians anticlockwise from +s (towards B), and `speed` is the size of the real vector
 * (along, up) in m/s. The arrays have room for `nCols x nRows` arrows; `count` of them are filled.
 */
export function flowArrows(
  data: SliceData,
  nCols: number,
  nRows: number,
  exaggeration: number,
): { count: number; s: Float32Array; z: Float32Array; angle: Float32Array; speed: Float32Array } {
  const nc = Math.max(0, Math.floor(nCols));
  const nr = Math.max(0, Math.floor(nRows));
  const cap = nc * nr;
  const out = { count: 0, s: new Float32Array(cap), z: new Float32Array(cap), angle: new Float32Array(cap), speed: new Float32Array(cap) };
  const length = data.line.length;
  const span = data.zMax - data.zMin;
  let n = 0;
  for (let r = 0; r < nr; r++) {
    const z = data.zMin + ((r + 0.5) / nr) * span;
    for (let c = 0; c < nc; c++) {
      const s = ((c + 0.5) / nc) * length;
      if (!inValidAir(data, s, z) || !velocityAt(data, s, z)) continue;
      const along = vel[0]!;
      const up = vel[1]!;
      out.s[n] = s;
      out.z[n] = z;
      out.angle[n] = Math.atan2(up * exaggeration, along);
      out.speed[n] = Math.sqrt(along * along + up * up);
      n++;
    }
  }
  out.count = n;
  return out;
}
