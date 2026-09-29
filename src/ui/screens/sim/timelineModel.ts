/**
 * Pure maths of the transport controls (no DOM): the timeline slider (pixel ⇄ time, snapping, drag with fine
 * control, keyboard steps, adaptive hour ticks, the fast-forward bar), the time popover (typed clock time → simulation
 * time, previous / next card) and which clock format to show. Unit-tested in timelineModel.test.ts.
 */
import { zonedDate, zonedTime } from '../../format';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Shift+arrow / PageUp / PageDown jump by this much (s). */
export const BIG_STEP_S = 600;

// ───────────────────────────── pixel ⇄ time ─────────────────────────────

/** Position along the scenario, 0–1. */
export function timeToFraction(t: number, duration: number): number {
  return duration > 0 ? clamp(t / duration, 0, 1) : 0;
}

/** Simulation time (s) under a pointer at x (px), for a track that starts at `left` and is `width` px wide. Clamped to [0, duration]. */
export function pxToTime(x: number, left: number, width: number, duration: number): number {
  if (!(width > 0)) return 0;
  return clamp(((x - left) / width) * duration, 0, duration);
}

/** The inverse: x (px, from the left edge of the track) of a simulation time. */
export function timeToPx(t: number, width: number, duration: number): number {
  return timeToFraction(t, duration) * width;
}

/** Round t to the nearest multiple of `snapS` (the end of the scenario stays reachable exactly). */
export function snapTime(t: number, snapS: number, duration: number): number {
  const c = clamp(t, 0, duration);
  if (!(snapS > 0)) return c;
  const r = Math.round(c / snapS) * snapS;
  return clamp(duration - r < snapS / 2 ? duration : r, 0, duration);
}

/** Snap grid (s) of a timeline drag: one display step, at most a minute, finer (at most 10 s) under fine control. */
export function snapFor(displayStepS: number, factor = 1): number {
  const base = clamp(displayStepS, 1, 60);
  return factor < 1 ? Math.min(base, 10) : base;
}

// ───────────────────────────── dragging ─────────────────────────────

/**
 * Vertical distance (px) between where the drag started and the pointer → how much slower the thumb moves than the
 * finger: 1 on the track, then ½, ¼ and 1/10 the further the finger is moved away from it (fine control).
 */
export function fineFactor(dyPx: number): number {
  const d = Math.abs(dyPx);
  if (d < 44) return 1;
  if (d < 90) return 0.5;
  if (d < 150) return 0.25;
  return 0.1;
}

export interface DragState {
  /** Pointer x and thumb time at the moment the current speed factor began. */
  anchorX: number;
  anchorT: number;
  factor: number;
  /** Time under the thumb now. */
  t: number;
}

/** A drag (or tap) begins with the pointer at x: the thumb goes to that time. */
export function dragStart(x: number, left: number, width: number, duration: number, snapS: number): DragState {
  const t = snapTime(pxToTime(x, left, width, duration), snapS, duration);
  return { anchorX: x, anchorT: t, factor: 1, t };
}

/**
 * The pointer moved to x with `dy` px of vertical distance from where it went down. Changing the factor re-anchors so
 * the thumb never jumps; at factor 1 the thumb stays under the finger.
 */
export function dragMove(st: DragState, x: number, dy: number, width: number, duration: number, displayStepS: number): DragState {
  const factor = fineFactor(dy);
  let { anchorX, anchorT } = st;
  if (factor !== st.factor) {
    anchorX = x;
    anchorT = st.t;
  }
  const raw = anchorT + ((x - anchorX) / (width > 0 ? width : 1)) * duration * factor;
  const t = snapTime(raw, snapFor(displayStepS, factor), duration);
  return { anchorX, anchorT, factor, t };
}

// ───────────────────────────── keyboard and buttons ─────────────────────────────

/**
 * Where a key on the focused timeline goes from `from`: arrows ± one display step, Shift+arrows or PageUp / PageDown
 * ± 10 min, Home / End the ends. null for other keys.
 */
export function keyboardTarget(key: string, shift: boolean, from: number, stepS: number, duration: number): number | null {
  let t: number;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      t = from + (shift ? BIG_STEP_S : stepS);
      break;
    case 'ArrowLeft':
    case 'ArrowDown':
      t = from - (shift ? BIG_STEP_S : stepS);
      break;
    case 'PageUp':
      t = from + BIG_STEP_S;
      break;
    case 'PageDown':
      t = from - BIG_STEP_S;
      break;
    case 'Home':
      t = 0;
      break;
    case 'End':
      t = duration;
      break;
    default:
      return null;
  }
  return clamp(t, 0, duration);
}

/** Step (s) of the n-th repeat while a ‹ / › button is held: it speeds up so a long scenario can be crossed. */
export function repeatStepS(baseS: number, repeat: number): number {
  const mult = repeat < 8 ? 1 : repeat < 20 ? 5 : 20;
  return Math.min(3600, baseS * mult);
}

// ───────────────────────────── ticks ─────────────────────────────

/** Candidate spacings (s) of clock ticks; every one divides the next or a day. */
const TICK_INTERVALS = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

export interface TickPlan {
  /** Spacing (s) of labelled ticks. */
  labelS: number;
  /** Spacing (s) of the small unlabelled ticks, or null when they would be closer than 6 px. */
  minorS: number | null;
}

/** The densest labelling whose labels are at least `minLabelPx` apart on a track `widthPx` wide. */
export function tickPlan(durationS: number, widthPx: number, minLabelPx = 56): TickPlan {
  const per = (s: number): number => (durationS > 0 ? (s / durationS) * widthPx : Infinity);
  let li = TICK_INTERVALS.findIndex((s) => per(s) >= minLabelPx);
  if (li < 0) li = TICK_INTERVALS.length - 1;
  const labelS = TICK_INTERVALS[li]!;
  let minorS: number | null = null;
  for (let i = li - 1; i >= 0; i--) {
    const m = TICK_INTERVALS[i]!;
    if (labelS % m === 0) {
      minorS = per(m) >= 6 ? m : null;
      break;
    }
  }
  return { labelS, minorS };
}

export interface TimeTick {
  /** Simulation time (s). */
  t: number;
  /** Labelled (and taller) tick. */
  major: boolean;
}

/**
 * Clock-aligned ticks over the scenario: multiples of the plan's spacing in LOCAL time (`utcOffsetS` = local minus UTC
 * at the start). A tick at a multiple of the label spacing is major.
 */
export function timeTicks(o: { startMs: number; durationS: number; utcOffsetS: number; widthPx: number; minLabelPx?: number }): { ticks: TimeTick[]; plan: TickPlan } {
  const plan = tickPlan(o.durationS, o.widthPx, o.minLabelPx);
  const step = plan.minorS ?? plan.labelS;
  const local0 = Math.round(o.startMs / 1000) + o.utcOffsetS;
  const ticks: TimeTick[] = [];
  for (let k = Math.ceil(local0 / step); ; k++) {
    const t = k * step - local0;
    if (t > o.durationS + 1e-6) break;
    if (t < -1e-6) continue;
    ticks.push({ t: Math.max(0, t), major: (k * step) % plan.labelS === 0 });
  }
  return { ticks, plan };
}

/** Whether the start / end of the scenario get their own clock label (no other label within `minGapPx` of that end). */
export function edgeLabels(majorXs: readonly number[], widthPx: number, minGapPx = 56): { start: boolean; end: boolean } {
  return { start: !majorXs.some((x) => x < minGapPx), end: !majorXs.some((x) => x > widthPx - minGapPx) };
}

/**
 * The marks for revealed cards, at most one per `bucketPx` of track (the more severe wins): a long run has dozens of
 * cards and a mark for each would be a solid bar. Position is the bucket's first card, as a fraction of the track.
 */
export function cardMarks(cards: readonly { time: number; severity: string }[], durationS: number, widthPx: number, bucketPx = 5): { frac: number; severity: 'danger' | 'watch' }[] {
  const per = new Map<number, { frac: number; severity: 'danger' | 'watch' }>();
  for (const c of cards) {
    if (c.severity !== 'danger' && c.severity !== 'watch') continue;
    const frac = timeToFraction(c.time, durationS);
    const bucket = Math.floor((frac * Math.max(1, widthPx)) / bucketPx);
    const cur = per.get(bucket);
    if (!cur) per.set(bucket, { frac, severity: c.severity });
    else if (cur.severity === 'watch' && c.severity === 'danger') cur.severity = 'danger';
  }
  return [...per.values()].sort((a, b) => a.frac - b.frac);
}

/** Seconds ahead of UTC of a zone at an instant, from its offset in hours (see format.tzOffsetHours). */
export const offsetSeconds = (offsetHours: number): number => Math.round(offsetHours * 3600);

// ───────────────────────────── fast-forward bar ─────────────────────────────

/** Where the reached part of a fast-forward ends (s): `from` + progress of the way to `target`. */
export function seekReached(from: number, target: number, progress: number): number {
  return from + (target - from) * clamp(progress, 0, 1);
}

/** Whole-percent text of a fast-forward's progress, 0–100. */
export function seekPercent(progress: number): number {
  return Math.round(clamp(progress, 0, 1) * 100);
}

// ───────────────────────────── time popover ─────────────────────────────

/** "14:35" / "14:35:07" (what a time input holds) → seconds after local midnight, or null. */
export function parseTimeOfDay(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] === undefined ? 0 : Number(m[3]);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return hh * 3600 + mm * 60 + ss;
}

/**
 * The simulation time (s) at which the local wall clock in `tz` reads `secondsOfDay`, within [0, durationS]; when a long
 * scenario passes that time of day more than once, the one closest to `nearS`. null when the scenario never shows it.
 */
export function clockToSimTime(secondsOfDay: number, startMs: number, tz: string, durationS: number, nearS = 0): number | null {
  const date0 = zonedDate(startMs, tz);
  const [y, mo, d] = date0.split('-').map(Number) as [number, number, number];
  const hh = Math.floor(secondsOfDay / 3600);
  const mm = Math.floor((secondsOfDay % 3600) / 60);
  const ss = secondsOfDay % 60;
  let best: number | null = null;
  for (let day = 0; day <= Math.ceil(durationS / 86400) + 1; day++) {
    const date = new Date(Date.UTC(y, mo - 1, d + day)).toISOString().slice(0, 10);
    const t = (zonedTime(date, hh, mm, tz) + ss * 1000 - startMs) / 1000;
    if (t < -0.5 || t > durationS + 0.5) continue;
    if (best === null || Math.abs(t - nearS) < Math.abs(best - nearS)) best = clamp(t, 0, durationS);
  }
  return best;
}

/** The nearest card (any severity above 'info') strictly before / after the view time; its time, or null. */
export function nearestCardTime(cards: readonly { time: number; severity: string }[], from: number, dir: -1 | 1): number | null {
  let best: number | null = null;
  for (const c of cards) {
    if (c.severity === 'info') continue;
    if (dir < 0 ? c.time < from - 1 : c.time > from + 1) {
      if (best === null || (dir < 0 ? c.time > best : c.time < best)) best = c.time;
    }
  }
  return best;
}

/** The clock shows seconds when the display step is finer than a minute or playback is slow enough to see them. */
export function clockShowsSeconds(displayStepS: number, speed: number): boolean {
  return displayStepS < 60 || speed <= 30;
}
