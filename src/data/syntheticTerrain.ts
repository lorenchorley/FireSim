/**
 * Deterministic synthetic terrain resembling the dissected sandstone country of the NSW ranges, for tests, demos and
 * as a fallback when no elevation data is available.
 *
 * All shapes are defined in local metres around the grid origin, so the same terrain is produced at any cell size
 * (a 60 m grid is a sub-sample of a 30 m grid of the same area). Randomness comes from seeded, hash-based value noise.
 *
 *  - 'escarpment': Blue Mountains style. A sandstone plateau at ~1000 m to the EAST ends in a ~250 m cliff line
 *     (70°+) above a steep talus slope that falls to a dissected valley floor (~450–550 m) to the WEST, like
 *     Narrow Neck / the Megalong Valley. Narrow gullies (chimneys) cut back into the plateau from the cliff line.
 *  - 'gorge': a deep, gently meandering E–W gorge (Grose Valley style): plateau ~950 m, floor ~400 m, with a
 *     sandstone cliff band at the rim, a south-facing north wall and a north-facing south wall, and side canyons.
 *  - 'ridges': parallel N–S ridges and V-shaped valleys (~1.5 km spacing, up to ~260 m relief) whose crest heights
 *     undulate, forming saddles between knolls.
 */
import type { GridSpec } from '../core/grid';
import { smoothstep } from '../core/units';

export type SyntheticTerrainKind = 'escarpment' | 'gorge' | 'ridges';

/** Integer hash → [0, 1). */
function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 2-D value noise in [-1, 1] with quintic interpolation; lattice spacing 1. */
export function valueNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const top = a + (b - a) * u;
  const bot = c + (d - c) * u;
  return (top + (bot - top) * v) * 2 - 1;
}

/** Fractal (fBm) value noise in roughly [-1, 1]. `wavelength` in metres is that of the first octave. */
export function fbm(x: number, y: number, wavelength: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1 / wavelength;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(x * f + o * 17.31, y * f - o * 11.17, seed + o * 101);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Ridged fBm in [0, 1]: sharp crests (spurs) and rounded troughs — good for dissected valley floors. */
function ridged(x: number, y: number, wavelength: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1 / wavelength;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(valueNoise2(x * f + o * 5.7, y * f + o * 3.1, seed + o * 57));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Distance (m) below a gully mouth over which the carving fades in, so the surface stays continuous there. */
const GULLY_FADE = 120;
/** Gradient of the gully floor continued below its mouth (gentler than the slopes it runs onto, so it daylights). */
const GULLY_BELOW_MOUTH_GRADIENT = 0.15;

/**
 * Carve jittered gullies into the surface height `z`.
 *
 * Gullies are spaced `spacing` m apart along the `along` coordinate (one per interval, jittered), have their mouth at
 * `into = 0` and cut back to a head at `into ≈ len` (random per gully, around `length`). Along each axis the gully floor
 * follows a concave-up longitudinal profile from `zMouth` to `zHead` (steepest near the head, like a real creek); it
 * continues gently downhill below the mouth and keeps rising beyond the head, where it soon exceeds the surface.
 * The surface is only ever LOWERED towards that floor, weighted by a Gaussian cross-profile and a fade-in below the
 * mouth, so the result is continuous everywhere (no steps at the mouth or the head) and the axis descends
 * monotonically to the mouth instead of ending in a pit.
 */
function carveGullies(
  z: number,
  along: number,
  into: number,
  spacing: number,
  width: number,
  length: number,
  seed: number,
  zMouth: number,
  zHead: number,
): number {
  if (into <= -GULLY_FADE) return z;
  const cell = Math.floor(along / spacing);
  const fade = into >= 0 ? 1 : smoothstep(-GULLY_FADE, 0, into);
  let out = z;
  for (let c = cell - 1; c <= cell + 1; c++) {
    const centre = (c + 0.2 + 0.6 * hash2(c, 7, seed)) * spacing;
    const len = length * (0.5 + 0.8 * hash2(c, 13, seed));
    const w = width * (0.7 + 0.6 * hash2(c, 19, seed));
    // Gullies wiggle a little as they cut back.
    const axis = centre + 0.35 * w * Math.sin(into / (0.3 * len + 1) + c);
    const across = (along - axis) / w;
    if (across > 4 || across < -4) continue; // exp(-16) ≈ 1e-7: negligible
    const t = into / len;
    const floor = t >= 0 ? zMouth + (zHead - zMouth) * t ** 1.3 : zMouth + GULLY_BELOW_MOUTH_GRADIENT * into;
    if (floor >= out) continue;
    out -= (out - floor) * Math.exp(-across * across) * fade;
  }
  return out;
}

function escarpment(x: number, y: number, seed: number): number {
  // Sinuous cliff line roughly N–S, 300 m west of the origin, with headlands and bays.
  const edgeX = -300 + 450 * fbm(0, y, 3000, 3, seed + 1);
  const d = x - edgeX; // metres east of the cliff edge (+ on the plateau)
  // Plateau: ~1000 m, gently undulating, very slightly rising to the east.
  const plateau = 1000 + 12 * fbm(x, y, 1500, 3, seed + 2) + 0.004 * d;
  // Cliff (250 m over ~70 m) then a concave talus / slope down to the valley floor.
  const cliffDrop = 250 * smoothstep(0, -70, d);
  const below = d < -70 ? -d - 70 : 0;
  const slopeDrop = 260 * (1 - Math.exp(-below / 700));
  // Dissected valley floor: ridged noise makes spurs and creek lines, strongest far from the cliff.
  const valleyMask = smoothstep(-300, -1500, d);
  const dissection = valleyMask * (70 * ridged(x, y, 1400, 4, seed + 3) - 35) + 15 * fbm(x, y, 600, 3, seed + 4) * (1 - valleyMask);
  const z = plateau - cliffDrop - slopeDrop + dissection;
  // Gullies (chimneys) cutting back into the plateau from the cliff line: narrow V-shaped ravines whose floor runs
  // from the talus below the cliff (mouth 150 m out from the rim, a little below the undisturbed slope there) up
  // through a deep notch in the cliff line to the plateau surface at the gully head.
  const mouthD = -150;
  const zMouth = plateau - 250 - 260 * (1 - Math.exp(-(-mouthD - 70) / 700)) - 8;
  return carveGullies(z, y, d - mouthD, 850, 90, 900, seed + 5, zMouth, plateau);
}

function gorge(x: number, y: number, seed: number): number {
  // Gorge axis meanders around y = 0; the floor falls gently eastward (downstream).
  const axisY = 220 * Math.sin((2 * Math.PI * x) / 4200 + 0.7) + 120 * fbm(x, 0, 2500, 2, seed + 11);
  const s = Math.abs(y - axisY); // distance from the creek line
  const plateau = 950 + 15 * fbm(x, y, 1500, 3, seed + 12);
  const floor = 410 - 0.008 * x + 6 * fbm(x, y, 400, 2, seed + 13);
  const depth = plateau - floor;
  // Cross profile: creek flat (60 m), steep slopes (~35°) up to the cliff band, then a ~65° sandstone cliff to the rim.
  const lower = 0.72 * depth; // talus / slope section
  const cliff = depth - lower; // cliff band at the top
  const slopeEnd = 60 + lower / Math.tan((35 * Math.PI) / 180);
  const cliffEnd = slopeEnd + cliff / Math.tan((65 * Math.PI) / 180);
  let z: number;
  if (s <= 60) z = floor;
  else if (s <= slopeEnd) {
    const t = (s - 60) / (slopeEnd - 60);
    z = floor + lower * (0.3 * t + 0.7 * t * t); // concave foot, steepening upward
  } else if (s <= cliffEnd) z = floor + lower + cliff * smoothstep(slopeEnd, cliffEnd, s);
  else z = plateau;
  // Ridge-and-gully texture on the walls (spurs and side gullies running down-slope), tapered smoothly in from the
  // creek flat and out onto the plateau so it does not leave steps along the gorge.
  const wall = smoothstep(60, 150, s) * (1 - smoothstep(cliffEnd + 60, cliffEnd + 260, s));
  z += wall * 25 * fbm(x, s, 500, 3, seed + 14);
  // Side canyons entering from the north and south: mouth half-way up the wall, cut back through the cliff band into
  // the plateau. (The side switch at the creek line is harmless: carving has faded out long before s = 0.)
  const side = y > axisY ? 1 : -1;
  const sMouth = 0.5 * cliffEnd;
  const tm = (sMouth - 60) / (slopeEnd - 60);
  const zMouth = floor + lower * (0.3 * tm + 0.7 * tm * tm) - 5;
  return carveGullies(z, x + side * 400, s - sMouth, 1300, 120, 1400, seed + (side > 0 ? 15 : 16), zMouth, plateau);
}

function ridges(x: number, y: number, seed: number): number {
  const wavelength = 1500;
  // Ridge lines run roughly N–S with gentle meanders.
  const xm = x + 150 * Math.sin((2 * Math.PI * y) / 3200) + 80 * fbm(0, y, 2000, 2, seed + 21);
  const phase = (2 * Math.PI * xm) / wavelength;
  const r = 0.5 + 0.5 * Math.cos(phase); // 1 on crests, 0 in valleys
  // Crest height undulates along each ridge → saddles between knolls. Each ridge has its own phase.
  const ridgeIndex = Math.round(xm / wavelength);
  const along = (2 * Math.PI * y) / 2600 + 6.283 * hash2(ridgeIndex, 3, seed);
  const crestAmp = 260 * (0.62 + 0.38 * Math.cos(along)) + 20 * fbm(xm, y, 900, 2, seed + 22);
  // Sharpen crests and V the valleys: r^1.4 makes crests narrow; fine noise adds spurs and gullies.
  const base = 620 + 30 * fbm(x, y, 5000, 2, seed + 23);
  return base + crestAmp * r ** 1.4 + 18 * fbm(x, y, 350, 3, seed + 24) * (0.3 + r);
}

/**
 * Plausible NSW-like test terrain on `grid` (elevation in m ASL, row-major, j = 0 south). Deterministic for a seed.
 */
export function syntheticElevation(grid: GridSpec, kind: SyntheticTerrainKind = 'escarpment', seed = 1): Float32Array {
  const { nx, ny, cellSize, x0, y0 } = grid;
  const out = new Float32Array(nx * ny);
  const f = kind === 'gorge' ? gorge : kind === 'ridges' ? ridges : escarpment;
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * cellSize;
    const row = j * nx;
    for (let i = 0; i < nx; i++) out[row + i] = f(x0 + i * cellSize, y, seed);
  }
  return out;
}

/** Provenance string for synthetic terrain. */
export const syntheticSource = (kind: SyntheticTerrainKind): string => `Synthetic ${kind} terrain (procedural, not a real place)`;
