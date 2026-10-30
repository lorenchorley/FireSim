/**
 * Which columns of the 3-D curtain's wind arrows are drawn for the way the curtain is seen (0.7.0, F2; docs/plans/0.7.0/D-CONTRACT-070-wind-small.md 2.2).
 * The arrows stand in 21 columns along the section line, each with a head of a fixed size on the screen. Seen along the line the 21 columns land on
 * one screen column and the heads stack; so the columns are thinned by how much the line is foreshortened, keeping every `stride`-th column, the
 * same ones at each stride. Face-on, from above and at any zoom where the columns are 14 px apart or more nothing is thinned (the 0.6.0 picture).
 * Display only: nothing here reaches the air, the slice or the side view. Pure (no Three, no DOM), unit-tested (curtainArrows.test.ts).
 */

/** Arrow columns along the section line (the layer draws this many). */
export const ARROW_COLUMNS = 21;
/** The least gap (CSS px) between two drawn columns: about the head and a bit of shaft. A tuning number: look at a picture at 360 x 640 before changing it. */
export const ARROW_MIN_SPACING_PX = 14;
/** The most columns skipped between two drawn ones: 21 columns are then 3 (columns 0, 7 and 14). */
export const MAX_STRIDE = 7;
/** A stride changes only when the columns' gap on the screen has moved this far (a share) past the edge that chose it, so a small camera move cannot flip it. */
export const STRIDE_HYSTERESIS = 0.15;

/**
 * How much a line is foreshortened for a camera looking along the unit vector whose scene-axes parts (x east, z south) are `forwardX` and `forwardZ`:
 * the sine of the angle between the way the camera looks across the ground and the line, 1 where it is seen face-on (or from straight above, where there
 * is no across-the-ground way), 0 where the camera looks along it. `dir` is the line's unit direction (east, north). The tilt of the camera does not
 * count: a curtain is a vertical plane, so looking along its line from any height sees it edge on, however much of the line the screen's vertical
 * axis shows (measured on the real layer at 360 x 640: the heads that stand on each other at a 35 degree tilt along the line are what this thins).
 */
export function foreshortening(forwardX: number, forwardZ: number, dir: ArrayLike<number>): number {
  const across = Math.hypot(forwardX, forwardZ);
  if (!(across > 1e-9)) return 1;
  const f = Math.abs(forwardX * dir[1]! + forwardZ * dir[0]!) / across; // the line runs along x and, northward, along -z: the cross product of the two directions
  return f < 1 ? f : 1;
}

/** CSS pixels one metre covers at `depthM` metres along the view axis, for a vertical field of view of `fovDeg` degrees in a view `viewportH` px tall. */
export function pixelsPerMetre(viewportH: number, fovDeg: number, depthM: number): number {
  return viewportH / (2 * Math.tan((fovDeg * Math.PI) / 360) * Math.max(depthM, 1e-6));
}

/** The stride that keeps the drawn columns `ARROW_MIN_SPACING_PX` apart when they are `px` apart now: 1 to `MAX_STRIDE` (a gap of 0 is as far as it goes). */
function strideFor(px: number): number {
  if (!(px > 0)) return MAX_STRIDE;
  return Math.min(MAX_STRIDE, Math.max(1, Math.ceil(ARROW_MIN_SPACING_PX / px - 1e-9)));
}

/**
 * Every how many columns an arrow is drawn: 1 (all of them) to `MAX_STRIDE`. `spacingM` is the gap between columns along the line, `f` the line's
 * foreshortening (`foreshortening`), `pxPerM` the screen scale at the curtain (`pixelsPerMetre`); `last` is the stride in use, kept while it is
 * still right within 15 % of the gap (0 or absent: none yet). A view that cannot be measured (not finite) leaves every column drawn.
 */
export function arrowStride(spacingM: number, f: number, pxPerM: number, last = 0): number {
  const px = spacingM * f * pxPerM;
  if (Number.isNaN(px)) return 1;
  const stride = strideFor(px);
  if (last >= 1 && last <= MAX_STRIDE) {
    // The last stride stays while it lies between what a gap 15 % wider and 15 % narrower would choose.
    if (last >= strideFor(px * (1 + STRIDE_HYSTERESIS)) && last <= strideFor(px / (1 + STRIDE_HYSTERESIS))) return last;
  }
  return stride;
}

/** Whether column `m` (0 first) is drawn at this stride: columns 0, s, 2s ... */
export function columnDrawn(m: number, stride: number): boolean {
  return m % stride === 0;
}
