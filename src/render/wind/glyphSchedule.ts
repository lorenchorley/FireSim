/**
 * The pure decisions of the wind glyph layer (0.5.0, stage E1): what made the drawn picture out of date, whether it may be
 * rebuilt now, how many segments the frame still has room for, and the log of slice times the statistics read. No Three.js and
 * no DOM, so the rules are tested in node with a fake clock; `windGlyphLayer.ts` applies them inside the frame loop.
 */
import { boxContains, SPACING_EXP_HYSTERESIS } from './glyphLod';
import { poseChange, REBUILD_MIN_GAP_MS, type PoseSig, type RebuildReason } from './glyphPose';
import { DETAIL_GEOMETRY, FRAME_TRIANGLE_LIMIT, type Box, type GlyphLevel, type LodPlan, type WindHeight } from './glyphTypes';

/** What a drawn picture was made from. The pose is the one at the start of its build, not of the frame it was swapped in. */
export interface BuiltPicture {
  /** Which data it read (one per snapshot or scenario) and the height it showed. */
  dataSerial: number;
  height: WindHeight;
  level: GlyphLevel;
  spacingExp: number;
  pose: PoseSig;
  /** The projection's own numbers (fov and the two view-offset terms): a panel opening shifts the picture without moving the camera. */
  proj: Float64Array;
  /** The ground the picture covers, with its margin. */
  box: Box;
}

/** The same facts for the frame being drawn now. */
export interface PictureNow {
  dataSerial: number;
  height: WindHeight;
  level: GlyphLevel;
  spacingExp: number;
  pose: PoseSig;
  proj: ArrayLike<number>;
  distanceM: number;
}

/**
 * Why the drawn picture is out of date, or null while it is good enough. The first fact that differs wins: no picture yet,
 * new data, another height, another level of detail or lattice, then the pose (`poseChange`, always against the BUILT picture
 * and never against the last frame, so a slow drift adds up), then the projection, then the visible ground leaving the built box.
 * `visible` is asked last and only when nothing else decided: it is the dearest question.
 */
export function rebuildReason(built: BuiltPicture | null, now: PictureNow, visible: () => Box | null): RebuildReason | null {
  if (!built) return 'first';
  if (built.dataSerial !== now.dataSerial) return 'snapshot';
  if (built.height !== now.height) return 'height';
  if (built.level !== now.level) return 'level';
  if (built.spacingExp !== now.spacingExp) return 'lattice';
  const moved = poseChange(built.pose, now.pose, now.distanceM);
  if (moved) return moved;
  for (let i = 0; i < now.proj.length; i++) if (built.proj[i] !== now.proj[i]) return 'resized';
  const box = visible();
  return box && !boxContains(built.box, box) ? 'left-box' : null;
}

/**
 * Whether a rebuild may start now: at most one per `REBUILD_MIN_GAP_MS` counted from the last swap, so a camera in motion costs
 * four rebuilds a second at most, while the first picture and a settled frame (screenshots, tests) are never held back. Anything
 * after a long rest is immediate because the gap has long passed.
 */
export function mayRebuild(reason: RebuildReason, nowMs: number, lastSwapMs: number, settle: boolean): boolean {
  return reason === 'first' || settle || nowMs - lastSwapMs >= REBUILD_MIN_GAP_MS;
}

/**
 * Segments a batch may hold so that the frame stays inside `FRAME_TRIANGLE_LIMIT`. `trianglesPerSegment` is 4 for the glyph pair (a
 * quad in the halo batch and one in the colour batch) and 2 for the detailed streaks (one batch); the rest of the frame is what the
 * last frame drew minus our own share of it (`ownSegments` of the same kind).
 */
export function segmentCap(tierSegments: number, framesTriangles: number, ownSegments: number, trianglesPerSegment = 4): number {
  const others = Math.max(0, framesTriangles - trianglesPerSegment * ownSegments);
  return Math.max(0, Math.min(tierSegments, Math.floor((FRAME_TRIANGLE_LIMIT - others) / trianglesPerSegment)));
}

/**
 * Put the numbers of the detailed streaks (`DETAIL_GEOMETRY`) into a plan that `planLod` made at the most detailed level, and return the
 * lattice exponent they give. The level, the pixels a cell covers and the 15 % hysteresis stay as `planLod` decided them; what changes is
 * what the level draws: curved lines of 90 to 220 px on a lattice of about 40 px. The exponent is worked out as `planLod` does it for a
 * curved level (`ceil(log2(spacingPx x mppCentre))`, kept inside the narrow band `SPACING_EXP_HYSTERESIS` around an edge), against
 * `prevExp`, the exponent this function gave last time at this level (null on arriving at it): the zoom alone decides the lattice.
 */
export function detailPlan(plan: LodPlan, mppCentre: number, prevExp: number | null): number {
  let exp = 0;
  if (mppCentre > 0 && Number.isFinite(mppCentre)) {
    const t = Math.log2(DETAIL_GEOMETRY.spacingPx * mppCentre);
    exp = Math.ceil(t);
    if (prevExp !== null && t > prevExp - 1 - SPACING_EXP_HYSTERESIS && t <= prevExp + SPACING_EXP_HYSTERESIS) exp = prevExp;
  }
  plan.spacingPx = DETAIL_GEOMETRY.spacingPx;
  plan.spacingExp = exp;
  plan.spacingM = 2 ** exp;
  plan.curved = true;
  plan.jitter = DETAIL_GEOMETRY.jitter;
  plan.lengthPx.min = DETAIL_GEOMETRY.minPx;
  plan.lengthPx.max = DETAIL_GEOMETRY.maxPx;
  plan.lengthPx.pxPerMs = DETAIL_GEOMETRY.pxPerMs;
  return exp;
}

/** The times of the last 64 slices of rebuild work, and the slices and work of the last whole rebuild ("rebuild 3.1 ms (p95 slice 4.2 ms)"). */
export class SliceLog {
  private readonly ring = new Float64Array(64);
  private readonly sorted = new Float64Array(64);
  private n = 0;
  private at = 0;
  private slices = 0;
  private ms = 0;
  /** Slices and work (ms) of the last finished rebuild. */
  slicesLast = 0;
  lastMs = 0;

  /** One slice of the rebuild in progress took `ms`. */
  push(ms: number): void {
    this.ring[this.at] = ms;
    this.at = (this.at + 1) % 64;
    if (this.n < 64) this.n++;
    this.slices++;
    this.ms += ms;
  }

  /** The rebuild in progress is finished: its slices become the last rebuild. */
  finish(): void {
    this.slicesLast = this.slices;
    this.lastMs = this.ms;
    this.slices = 0;
    this.ms = 0;
  }

  /** The rebuild in progress was thrown away (its slices stay in the ring: the work was done). */
  abandon(): void {
    this.slices = 0;
    this.ms = 0;
  }

  /** Nearest-rank 95th percentile of the ring. */
  p95(): number {
    if (this.n === 0) return 0;
    const s = this.sorted.subarray(0, this.n);
    s.set(this.ring.subarray(0, this.n));
    s.sort();
    return s[Math.max(0, Math.ceil(0.95 * this.n) - 1)]!;
  }

  max(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) if (this.ring[i]! > m) m = this.ring[i]!;
    return m;
  }
}
