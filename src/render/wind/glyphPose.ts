/**
 * When the wind glyphs must be rebuilt because the camera moved (0.5.0, stage E1). Pure and allocation-free: the layer keeps two
 * preallocated pose signatures, the pose of the picture that was BUILT and the pose now, and asks `poseChange` once per frame.
 * The comparison is always against the built picture, never against the previous frame, so a slow drag adds up until it crosses
 * a threshold and a stopped camera never triggers anything.
 */

/** At most one rebuild per this many ms, counted from the last swap (the first build and a new snapshot or height after a long idle are immediate). */
export const REBUILD_MIN_GAP_MS = 250;
/** The eye moved: more than `max(POSE_MOVE_MIN_M, POSE_MOVE_FRAC x distance)` metres. */
export const POSE_MOVE_MIN_M = 12;
export const POSE_MOVE_FRAC = 0.1;
/** Zoomed: the distance to the target changed by more than 10 %. */
export const POSE_ZOOM_FRAC = 0.1;
/** Turned: the camera's orientation changed by more than 10 degrees (the test is `|q . q'| < cos(5 deg)`, no trigonometry per frame). */
export const POSE_TURN_COS_HALF = Math.cos((5 * Math.PI) / 180);

/** Where each value of a `PoseSig` lives. World axes: x east, y up, z south. */
export const POSE = { eye: 0, target: 3, quat: 5, cssW: 9, cssH: 10, vex: 11, size: 12 } as const;

/** `[eye x, y, z, target x, target z, quaternion x, y, z, w, cssW, cssH, vex]` in a preallocated `Float64Array(12)`. */
export type PoseSig = Float64Array;
export const createPoseSig = (): PoseSig => new Float64Array(POSE.size);

export type RebuildReason = 'first' | 'snapshot' | 'height' | 'level' | 'lattice' | 'density' | 'moved' | 'turned' | 'zoomed' | 'resized' | 'left-box' | 'exaggeration' | 'room';

/**
 * Compares the pose of the BUILT picture with now. `distanceM` is the distance from the eye to the target now. Returns the first
 * reason that applies, or null to keep the picture:
 *   resized      the canvas size in CSS pixels changed
 *   exaggeration the vertical exaggeration changed
 *   turned       the orientation changed by more than 10 degrees
 *   zoomed       the distance to the target changed by more than 10 %
 *   moved        the eye moved by more than max(12 m, 10 % of the distance)
 * The pose holds the target's x and z but not its height, so the built distance is taken to the target's height now (the target
 * rides on the ground, which changes slowly under a pan). No allocation.
 */
export function poseChange(built: PoseSig, now: PoseSig, distanceM: number): 'moved' | 'turned' | 'zoomed' | 'resized' | 'exaggeration' | null {
  if (built[POSE.cssW] !== now[POSE.cssW] || built[POSE.cssH] !== now[POSE.cssH]) return 'resized';
  if (built[POSE.vex] !== now[POSE.vex]) return 'exaggeration';
  const q = POSE.quat;
  const dot = built[q]! * now[q]! + built[q + 1]! * now[q + 1]! + built[q + 2]! * now[q + 2]! + built[q + 3]! * now[q + 3]!;
  if (Math.abs(dot) < POSE_TURN_COS_HALF) return 'turned';
  // Height of the target now: the eye plus the distance along the camera's forward direction (THREE: the camera looks down -z).
  const qx = now[q]!;
  const qy = now[q + 1]!;
  const qz = now[q + 2]!;
  const qw = now[q + 3]!;
  const forwardY = 2 * (qw * qx - qy * qz);
  const targetY = now[POSE.eye + 1]! + distanceM * forwardY;
  const bx = built[POSE.eye]! - built[POSE.target]!;
  const by = built[POSE.eye + 1]! - targetY;
  const bz = built[POSE.eye + 2]! - built[POSE.target + 1]!;
  const builtDistance = Math.sqrt(bx * bx + by * by + bz * bz);
  if (builtDistance > 1e-6 && distanceM > 0) {
    const ratio = distanceM / builtDistance;
    if (ratio > 1 + POSE_ZOOM_FRAC || ratio < 1 / (1 + POSE_ZOOM_FRAC)) return 'zoomed';
  }
  const mx = now[POSE.eye]! - built[POSE.eye]!;
  const my = now[POSE.eye + 1]! - built[POSE.eye + 1]!;
  const mz = now[POSE.eye + 2]! - built[POSE.eye + 2]!;
  const limit = Math.max(POSE_MOVE_MIN_M, POSE_MOVE_FRAC * distanceM);
  if (mx * mx + my * my + mz * mz > limit * limit) return 'moved';
  return null;
}
