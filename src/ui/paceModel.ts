/**
 * The pace tracker (workstream B of docs/plans/air-slice-wind-detail-honest-speed.md, §6.3): is the simulation keeping up
 * with the playback speed the viewer asked for? Pure, no DOM and no clock of its own: the session feeds it one frame per
 * animation frame (the clock position, the newest result, the speed asked for, and what the engine reports) and publishes
 * what it returns as `SessionState.pace`.
 *
 * It only ever looks. It never changes the tier, the display step, the solver step or any option (plan §4, rule 2), and
 * nothing it holds can reach a result (rule 1). Everything it publishes is a measurement on this phone.
 *
 * Three levels (see paceTypes.ts), with hysteresis so a signal does not flicker:
 *  - `waiting`: the clock was held at the newest result for 15 % or more of the last 10 s, for 6 s in a row. Leaves when
 *    that share stays under 5 % for 20 s.
 *  - `behind` (an early warning, before any stall): the worker computes slower than 90 % of the speed asked for and is
 *    busy 90 % of the time or more, for 10 s. Leaves when it computes at 97 % or more, or is busy under 70 %, for 10 s.
 *  - `ok` otherwise (nothing shows).
 * A worker that is ahead goes idle, and idle is not lag: `behind` needs a busy worker, `waiting` needs a held clock.
 *
 * Whatever makes the numbers meaningless drops the window and waits 15 s before judging again: seeking, pausing, the app
 * being hidden (5 s after it returns), the 3-D spin-up, replaying history, a change of speed or tier, the newest result
 * moving backward (a rewind or an edit) and a gap in the frames. Max speed asks for nothing, so it publishes no pace.
 */
import type { PaceInfo, PaceLevel } from './paceTypes';

/** The numbers of §6.3 in one place (tuned in spike S1: nothing here is a guess about a phone). */
export const PACE = {
  /** The clock was "held at the newest result" when it was within this many simulated seconds of it (the `advanceClock` condition). */
  headEpsS: 1,
  /** Length of one bin (ms) and how many are kept: 30 s of history. */
  binMs: 1000,
  binCount: 30,
  /** The window of the shares and speeds (s). */
  recentS: 10,
  /** The least wall time (s) the window must hold before a share or a speed is read from it. */
  minShareWallS: 1,
  minSpeedWallS: 9,
  /** `waiting`: enter at this share of the window, held this long (s); leave under the other share, held the other time. */
  waitingEnterShare: 0.15,
  waitingEnterHoldS: 6,
  waitingLeaveShare: 0.05,
  waitingLeaveHoldS: 20,
  /** `behind`: enter below this fraction of the speed asked for with the worker at least this busy, held this long (s). */
  behindEnterCapacity: 0.9,
  behindEnterDuty: 0.9,
  behindEnterHoldS: 10,
  /** `behind`: leave at this fraction of the speed asked for, or with the worker this idle (below), held this long (s). */
  behindLeaveCapacity: 0.97,
  behindLeaveDuty: 0.7,
  behindLeaveHoldS: 10,
  /** Wait this long (s) after a play, a seek, a speed change or a re-run before judging; 5 s after the app returns. */
  graceS: 15,
  hiddenGraceS: 5,
  /** A frame this long after the last one (ms) is a gap: the page was suspended or the main thread was stuck, and the window is dropped. */
  gapMs: 2000,
  /** The animation loop never advances the clock by more than this per frame (s); the tracker counts the same. */
  maxFrameS: 0.25,
  /** The newest result must be beyond this time (s) before anything is judged: before it, the engine is still spinning up. */
  minHeadS: 1,
  /** Announce (polite live region) on entering `waiting`, and then at most this often (s). */
  announceEveryS: 120,
} as const;

/** The accessible name of the button on the timeline, and what a screen reader hears (once) when the simulation starts to hold playback back. */
export const PACE_BUTTON_LABEL = 'Simulation is running slower than your playback speed. Show details.';
export const PACE_ANNOUNCEMENT = 'Simulation is running slower than your playback speed.';

/** Why a stretch of frames does not count. The first group lasts while it is true; the second happens once, and then the wait runs. */
export type PaceExclusion =
  | 'paused'
  | 'seeking'
  | 'hidden'
  | 'max-speed'
  | 'spin-up'
  | 'replay'
  | 'speed'
  | 'tier'
  | 'rewind'
  | 'rerun'
  | 'edit'
  | 'gap';

const WHILE_TRUE: ReadonlySet<PaceExclusion> = new Set(['paused', 'seeking', 'hidden', 'max-speed', 'spin-up', 'replay']);

/** What the session knows at one animation frame, after it moved the clock. */
export interface PaceFrame {
  /** `performance.now()` of the frame (ms). */
  nowMs: number;
  playing: boolean;
  /** A timeline jump beyond the computed range is in progress. */
  seeking: boolean;
  /** The app is in the background. */
  hidden: boolean;
  /** The clock (simulated s) after this frame's move, the newest result, and the length of the run. */
  viewTime: number;
  headTime: number;
  duration: number;
  /** The playback speed asked for (simulated s per wall s); `Infinity` is Max. */
  speed: number;
  /** The engine is still spinning up its 3-D air (or the tier is being decided): there is nothing to wait for yet. */
  spinUp: boolean;
  /** The viewer is replaying earlier results: the clock is not limited by the worker. */
  reviewing: boolean;
  /** The atmosphere tier now, and a count that goes up when the engine re-runs from an earlier time; null when not reported. */
  tier: string | null;
  reruns: number | null;
  /** The worker's computing speed while busy (`EngineInfo.perf.speed.s10`, else the `workerSpeed` average), null if unknown. */
  capacity: number | null;
  /** The worker's share of wall time spent computing over the last 10 s (`EngineInfo.perf.duty.s10`); null: the tracker counts `computing` itself. */
  duty: number | null;
  /** The worker reports that it is computing (the UI's own view of its busy time, used when `duty` is null). */
  computing: boolean;
}

export interface PaceTracker {
  /** Feed one animation frame. Returns what to publish as `SessionState.pace` (the same object until it has something new to say). */
  frame(f: PaceFrame): PaceInfo | null;
  /** Something the frames cannot show invalidated the window (an edit, a re-run): drop it and wait out the grace. */
  exclude(reason: PaceExclusion, nowMs: number): PaceInfo | null;
  /** Debug hook (`?debug` or a dev build): publish a canned level whatever the frames say; `null` gives control back. */
  force(level: PaceLevel | null, nowMs?: number): PaceInfo | null;
  /** What was last returned. */
  readonly info: PaceInfo | null;
}

interface Bin {
  sec: number;
  wall: number;
  moved: number;
  clamped: number;
  busy: number;
}

interface Window {
  wall: number;
  moved: number;
  clamped: number;
  busy: number;
}

/** Positive modulo. */
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** A fixture for the debug hook and for screenshots: a plausible reading of each level (60x asked for, about 38x computed). */
export function forcedPace(level: PaceLevel, nowMs: number): PaceInfo {
  return {
    level,
    wanted: 60,
    achieved: level === 'ok' ? 60 : 38,
    waitingShare: level === 'waiting' ? 0.4 : 0,
    capacity: level === 'ok' ? 90 : 38,
    duty: level === 'ok' ? 0.4 : 0.97,
    aheadS: level === 'waiting' ? 20 : 60,
    bufferS: level === 'waiting' ? 0.3 : 1,
    sinceMs: nowMs,
  };
}

/**
 * The debug hook (`?paceLevel=behind|waiting|ok`): the level to force, or null. It exists only in a dev build or with
 * `?debug` in the address, so it cannot be reached by accident; it lets screenshots and the layout audits show the signal
 * without a phone that is too slow.
 */
export function debugPaceLevel(search: string, dev: boolean): PaceLevel | null {
  const q = new URLSearchParams(search);
  if (!dev && !q.has('debug')) return null;
  const v = q.get('paceLevel');
  return v === 'ok' || v === 'behind' || v === 'waiting' ? v : null;
}

/**
 * Whether a level change should be announced to a screen reader: once on entering `waiting`, and at most once every two
 * minutes however often it comes and goes. `behind` is never announced (it is a faint hint), and neither is leaving.
 */
export function shouldAnnounce(prev: PaceLevel | null, next: PaceLevel | null, lastAnnouncedMs: number | null, nowMs: number): boolean {
  if (next !== 'waiting' || prev === 'waiting') return false;
  return lastAnnouncedMs === null || nowMs - lastAnnouncedMs >= PACE.announceEveryS * 1000;
}

export function createPaceTracker(): PaceTracker {
  const bins: Bin[] = Array.from({ length: PACE.binCount }, () => ({ sec: -1, wall: 0, moved: 0, clamped: 0, busy: 0 }));
  let info: PaceInfo | null = null;
  let forced: PaceLevel | null = null;

  // Per-frame bookkeeping that survives a drop: what the previous frame looked like, to see a change.
  let prev: { nowMs: number; head: number; speed: number; tier: string | null; reruns: number | null } | null = null;
  // The window of observations and the timers of the hysteresis; all cleared by a drop.
  let last: { nowMs: number; view: number } | null = null;
  let level: PaceLevel = 'ok';
  let levelSince = 0;
  let publishedSec = -1;
  let aboveSince: number | null = null;
  let belowSince: number | null = null;
  let behindSince: number | null = null;
  let behindEndSince: number | null = null;
  // Judging starts at `graceUntil`; null = not decided yet (set at the first frame that could be judged, after a `while true` reason).
  let graceUntil: number | null = null;
  let pendingGraceS: number = PACE.graceS;

  const clearWindow = (): void => {
    for (const b of bins) b.sec = -1;
    last = null;
    level = 'ok';
    aboveSince = belowSince = behindSince = behindEndSince = null;
    publishedSec = -1;
  };

  const drop = (reason: PaceExclusion, nowMs: number): PaceInfo | null => {
    clearWindow();
    if (WHILE_TRUE.has(reason)) {
      // The state may last a long time: forget the last frame (the next one is not a "change"), and start the wait when it ends.
      prev = null;
      graceUntil = null;
      pendingGraceS = reason === 'hidden' ? PACE.hiddenGraceS : PACE.graceS;
    } else {
      // A gap in the frames is treated like the app having been hidden: the page was suspended, so the wait is the short one.
      graceUntil = nowMs + (reason === 'gap' ? PACE.hiddenGraceS : PACE.graceS) * 1000;
    }
    info = null;
    return info;
  };

  const binFor = (nowMs: number): Bin => {
    const sec = Math.floor(nowMs / PACE.binMs);
    const b = bins[mod(sec, PACE.binCount)]!;
    if (b.sec !== sec) {
      b.sec = sec;
      b.wall = b.moved = b.clamped = b.busy = 0;
    }
    return b;
  };

  /** Sum of the last `seconds` bins up to `nowMs` (the newest is the one still filling, so the window holds a little under `seconds`). */
  const windowOf = (nowMs: number, seconds: number): Window => {
    const cur = Math.floor(nowMs / PACE.binMs);
    const w: Window = { wall: 0, moved: 0, clamped: 0, busy: 0 };
    for (const b of bins) {
      if (b.sec > cur - seconds && b.sec <= cur) {
        w.wall += b.wall;
        w.moved += b.moved;
        w.clamped += b.clamped;
        w.busy += b.busy;
      }
    }
    return w;
  };

  const held = (since: number | null, nowMs: number, holdS: number): boolean => since !== null && nowMs - since >= holdS * 1000;

  function exclusionOf(f: PaceFrame): PaceExclusion | null {
    if (!f.playing) return 'paused';
    if (f.seeking) return 'seeking';
    if (f.hidden) return 'hidden';
    if (!Number.isFinite(f.speed) || !(f.speed > 0)) return 'max-speed';
    if (f.spinUp || f.headTime < PACE.minHeadS) return 'spin-up';
    if (f.reviewing) return 'replay';
    if (prev) {
      if (f.speed !== prev.speed) return 'speed';
      if (f.tier !== prev.tier) return 'tier';
      if (f.reruns !== prev.reruns) return 'rerun';
      if (f.headTime < prev.head - PACE.headEpsS) return 'rewind';
      if (f.nowMs - prev.nowMs > PACE.gapMs) return 'gap';
    }
    return null;
  }

  function frame(f: PaceFrame): PaceInfo | null {
    if (forced) return info;
    const reason = exclusionOf(f);
    prev = { nowMs: f.nowMs, head: f.headTime, speed: f.speed, tier: f.tier, reruns: f.reruns };
    if (reason) return drop(reason, f.nowMs);
    // Judgeable. The first such frame after a state that lasted starts the wait.
    if (graceUntil === null) graceUntil = f.nowMs + pendingGraceS * 1000;
    if (f.nowMs < graceUntil) return null;

    // ── count this frame ──
    if (last) {
      const dt = Math.min(PACE.maxFrameS, Math.max(0, (f.nowMs - last.nowMs) / 1000));
      if (dt > 0) {
        const b = binFor(f.nowMs);
        b.wall += dt;
        b.moved += Math.max(0, f.viewTime - last.view);
        // Held at the newest result: the clock cannot move, and there is more to compute (at the end of the run it is just the end).
        if (f.viewTime >= f.headTime - PACE.headEpsS && f.headTime < f.duration - PACE.headEpsS) b.clamped += dt;
        if (f.computing) b.busy += dt;
      }
    }
    last = { nowMs: f.nowMs, view: f.viewTime };

    // ── read the window ──
    const w = windowOf(f.nowMs, PACE.recentS);
    const share = w.wall >= PACE.minShareWallS ? w.clamped / w.wall : null;
    const capacity = f.capacity !== null && Number.isFinite(f.capacity) && f.capacity > 0 ? f.capacity : null;
    const duty = f.duty !== null && Number.isFinite(f.duty) ? f.duty : w.wall >= PACE.minShareWallS ? w.busy / w.wall : null;

    // Each timer runs while its condition holds without a break.
    aboveSince = share !== null && share >= PACE.waitingEnterShare ? (aboveSince ?? f.nowMs) : null;
    belowSince = share !== null && share < PACE.waitingLeaveShare ? (belowSince ?? f.nowMs) : null;
    const slow = capacity !== null && duty !== null && capacity < PACE.behindEnterCapacity * f.speed && duty >= PACE.behindEnterDuty;
    behindSince = slow ? (behindSince ?? f.nowMs) : null;
    // No evidence of lag (the engine reports nothing, or it keeps up, or it is mostly idle) counts as the way out.
    const recovered = capacity === null || duty === null || capacity >= PACE.behindLeaveCapacity * f.speed || duty < PACE.behindLeaveDuty;
    behindEndSince = recovered ? (behindEndSince ?? f.nowMs) : null;

    // ── the level ──
    const behindHeld = held(behindSince, f.nowMs, PACE.behindEnterHoldS);
    let next: PaceLevel = level;
    if (level === 'waiting') {
      if (held(belowSince, f.nowMs, PACE.waitingLeaveHoldS)) next = behindHeld ? 'behind' : 'ok';
    } else if (held(aboveSince, f.nowMs, PACE.waitingEnterHoldS)) {
      next = 'waiting';
    } else if (level === 'behind') {
      if (held(behindEndSince, f.nowMs, PACE.behindLeaveHoldS)) next = 'ok';
    } else if (behindHeld) {
      next = 'behind';
    }

    // ── publish: when the level changes, and otherwise about once a second ──
    const sec = Math.floor(f.nowMs / PACE.binMs);
    if (next === level && info && sec === publishedSec) return info;
    if (next !== level || !info) levelSince = f.nowMs;
    level = next;
    publishedSec = sec;
    info = {
      level,
      wanted: f.speed,
      achieved: w.wall >= PACE.minSpeedWallS ? w.moved / w.wall : null,
      waitingShare: w.wall > 0 ? w.clamped / w.wall : 0,
      capacity,
      duty,
      aheadS: Math.max(0, f.headTime - f.viewTime),
      bufferS: Math.max(0, f.headTime - f.viewTime) / f.speed,
      sinceMs: levelSince,
    };
    return info;
  }

  return {
    frame,
    exclude(reason, nowMs) {
      if (forced) return info;
      return drop(reason, nowMs);
    },
    force(next, nowMs = 0) {
      forced = next;
      if (next) {
        clearWindow();
        info = forcedPace(next, nowMs);
      } else {
        info = null;
        graceUntil = null;
        pendingGraceS = PACE.graceS;
      }
      return info;
    },
    get info() {
      return info;
    },
  };
}
