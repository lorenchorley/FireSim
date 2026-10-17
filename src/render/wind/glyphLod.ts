/**
 * Level of detail and visible ground of the wind glyphs (0.5.0, stage E1). Pure: no Three.js, no DOM.
 *
 * The level follows how many screen pixels one model cell covers at the middle of the screen (`cellPx`): under 4 px nothing is
 * drawn, then straight arrows, denser straight arrows, curved flow lines, longer flow lines. Crossing an edge needs 15 % more
 * (going up) or 15 % less (going down) so a pinch that hovers on an edge does not flicker. The seeds sit on a world lattice
 * whose spacing is a power of two of metres, so panning never moves a seed and zooming changes the spacing in steps.
 */
import type { Box, GlyphLevel, LodPlan } from './glyphTypes';

/** Upper edges (model cell in screen px) of levels L0 to L3; L4 is everything above the last. */
export const LEVEL_EDGES = [4, 12, 32, 90] as const;
/** Going up needs `edge x 1.15`, going down needs less than `lower edge / 1.15`. */
export const LOD_HYSTERESIS = 1.15;
/** The lattice exponent changes only when the exact exponent is more than 0.5 + 0.15 octave from the kept one. */
export const SPACING_EXP_HYSTERESIS = 0.15;

interface LevelSpec {
  spacingPx: number;
  curved: boolean;
  jitter: number;
  pxPerMs: number;
  minPx: number;
  maxPx: number;
}

/** What each level draws (the table of plan 9.2 as the design contract tunes it; to be judged on a phone). */
const LEVEL_SPECS: readonly LevelSpec[] = [
  { spacingPx: 0, curved: false, jitter: 0, pxPerMs: 0, minPx: 0, maxPx: 0 }, // L0: nothing
  { spacingPx: 56, curved: false, jitter: 0, pxPerMs: 4, minPx: 8, maxPx: 45 }, // L1: straight arrows
  { spacingPx: 40, curved: false, jitter: 0, pxPerMs: 4, minPx: 8, maxPx: 32 }, // L2: straight arrows, denser
  { spacingPx: 36, curved: true, jitter: 0.3, pxPerMs: 4, minPx: 28, maxPx: 56 }, // L3: curved flow lines
  { spacingPx: 56, curved: true, jitter: 0.3, pxPerMs: 6, minPx: 90, maxPx: 140 }, // L4: long flow lines
];

/** Metres one CSS pixel covers across the view at `distanceM` from the camera: `2 d tan(fov / 2) / cssH`. */
export function metresPerPixelAt(distanceM: number, fovDeg: number, cssH: number): number {
  return (2 * distanceM * Math.tan((fovDeg * Math.PI) / 360)) / cssH;
}

/** Screen pixels one model cell of `cellM` metres covers at `distanceM` from the camera. */
export function cellPxAt(cellM: number, distanceM: number, fovDeg: number, cssH: number): number {
  return cellM / metresPerPixelAt(distanceM, fovDeg, cssH);
}

function rawLevel(cellPx: number): GlyphLevel {
  if (!(cellPx >= LEVEL_EDGES[0])) return 0;
  if (cellPx < LEVEL_EDGES[1]) return 1;
  if (cellPx < LEVEL_EDGES[2]) return 2;
  if (cellPx < LEVEL_EDGES[3]) return 3;
  return 4;
}

/**
 * The plan for one frame. `prev` (the plan kept from the last call, or null) gives the hysteresis: up when
 * `cellPx >= edge x 1.15`, down when `cellPx < lowerEdge / 1.15`, one edge at a time so a fast pinch can cross several. With
 * `prev` null the level is the raw one. `mppCentre` (metres per pixel at the middle of the screen) sets the lattice spacing:
 * `spacingExp = round(log2(spacingPx x mppCentre))`, kept while the exact value is within 0.65 octave of `prev.spacingExp`.
 * `out` (optional) is filled and returned instead of a new object; it may be `prev` itself.
 */
export function planLod(cellPx: number, mppCentre: number, prev: Pick<LodPlan, 'level' | 'spacingExp'> | null, out?: LodPlan): LodPlan {
  let level: number;
  if (!(cellPx > 0)) level = 0;
  else if (!prev) level = rawLevel(cellPx);
  else {
    level = prev.level;
    while (level < 4 && cellPx >= LEVEL_EDGES[level]! * LOD_HYSTERESIS) level++;
    while (level > 0 && cellPx < LEVEL_EDGES[level - 1]! / LOD_HYSTERESIS) level--;
  }
  const spec = LEVEL_SPECS[level]!;
  let exp = 0;
  if (level > 0 && mppCentre > 0 && Number.isFinite(mppCentre)) {
    const exact = Math.log2(spec.spacingPx * mppCentre);
    exp = Math.round(exact);
    if (prev && prev.level > 0 && Math.abs(exact - prev.spacingExp) <= 0.5 + SPACING_EXP_HYSTERESIS) exp = prev.spacingExp;
  }
  const plan: LodPlan = out ?? { level: 0, cellPx: 0, spacingPx: 0, spacingExp: 0, spacingM: 0, curved: false, jitter: 0, lengthPx: { min: 0, max: 0, pxPerMs: 0 } };
  plan.level = level as GlyphLevel;
  plan.cellPx = cellPx;
  plan.spacingPx = spec.spacingPx;
  plan.spacingExp = exp;
  plan.spacingM = level > 0 ? 2 ** exp : 0;
  plan.curved = spec.curved;
  plan.jitter = spec.jitter;
  plan.lengthPx.min = spec.minPx;
  plan.lengthPx.max = spec.maxPx;
  plan.lengthPx.pxPerMs = spec.pxPerMs;
  plan.mppCentre = mppCentre;
  return plan;
}

// NDC (x, y) of the eight rays: the four corners, then the four edge midpoints.
const NDC = new Float64Array([-1, -1, 1, -1, 1, 1, -1, 1, 0, -1, 1, 0, 0, 1, -1, 0]);

/**
 * The local-metre box of the ground the camera can see, for the build and for the "is the picture still big enough" test.
 * `unproject` is `camera.matrixWorld x camera.projectionMatrixInverse` (16 numbers, column-major, THREE's `elements`), `eye`
 * the camera position in WORLD axes (x east, y up, z south: local y = -z). Eight NDC rays (4 corners, 4 edge midpoints) are
 * intersected with the plane `y = planeY`: pass the LOWEST terrain, so a ray that meets higher ground on the way stops inside
 * the box. A ray at or above the horizon, and any hit farther than `maxRangeM` horizontally, stops at `maxRangeM`. The box is
 * grown by `margin` of its size on each side and clipped to `bounds`; null when nothing of the ground is in view.
 * `out` (optional) is filled and returned: the per-frame "built box still covers the view" test then allocates nothing.
 */
export function visibleBox(
  unproject: ArrayLike<number>,
  eye: ArrayLike<number>,
  planeY: number,
  bounds: Box,
  maxRangeM: number,
  margin = 0.25,
  out?: Box,
): Box | null {
  const m = unproject;
  const ex = eye[0]!;
  const ey = eye[1]!;
  const ez = eye[2]!;
  if (!(ey > planeY) || !(maxRangeM > 0)) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let down = false; // some ray meets the ground: otherwise nothing of it is in view
  for (let k = 0; k < 16; k += 2) {
    const nx = NDC[k]!;
    const ny = NDC[k + 1]!;
    // The point of the ray on the far plane (NDC z = 1), in homogeneous world coordinates.
    const pw = m[3]! * nx + m[7]! * ny + m[11]! + m[15]!;
    if (!(Math.abs(pw) > 1e-12)) continue;
    const dx = (m[0]! * nx + m[4]! * ny + m[8]! + m[12]!) / pw - ex;
    const dy = (m[1]! * nx + m[5]! * ny + m[9]! + m[13]!) / pw - ey;
    const dz = (m[2]! * nx + m[6]! * ny + m[10]! + m[14]!) / pw - ez;
    const h = Math.sqrt(dx * dx + dz * dz);
    let t: number;
    if (dy < -1e-9) {
      down = true;
      t = (planeY - ey) / dy;
      if (t * h > maxRangeM) t = maxRangeM / h;
    } else if (h > 1e-12) t = maxRangeM / h;
    else continue; // straight up: no ground in this ray
    const hx = ex + t * dx;
    const hy = -(ez + t * dz);
    if (hx < x0) x0 = hx;
    if (hx > x1) x1 = hx;
    if (hy < y0) y0 = hy;
    if (hy > y1) y1 = hy;
  }
  if (!down || !(x1 >= x0) || !(y1 >= y0)) return null;
  const gx = (x1 - x0) * margin;
  const gy = (y1 - y0) * margin;
  x0 = Math.max(x0 - gx, bounds.x0);
  x1 = Math.min(x1 + gx, bounds.x1);
  y0 = Math.max(y0 - gy, bounds.y0);
  y1 = Math.min(y1 + gy, bounds.y1);
  if (x0 > x1 || y0 > y1) return null;
  const box = out ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  box.x0 = x0;
  box.y0 = y0;
  box.x1 = x1;
  box.y1 = y1;
  return box;
}

/** True when `inner` lies inside `outer` (edges included). */
export const boxContains = (outer: Box, inner: Box): boolean => outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 && outer.y1 >= inner.y1;
