/**
 * The pace tracker (paceModel.ts) driven by a fake clock and a small model of the engine: a worker that computes at a
 * given speed while it is below its look-ahead target and idles at it, and the real clock rule (`advanceClock`) that holds
 * the view at the newest result. Every frame is 50 ms of wall time.
 */
import { describe, expect, it } from 'vitest';
import type { PaceInfo, PaceLevel } from './paceTypes';
import { createPaceTracker, forcedPace, PACE, type PaceFrame, shouldAnnounce } from './paceModel';
import { advanceClock, runTarget } from './session';

const FRAME_MS = 50;
const DURATION = 6 * 3600;

/** A session in miniature: the worker computes ahead to `runTarget`, the clock follows `advanceClock`, the tracker watches. */
class Rig {
  readonly tracker = createPaceTracker();
  now = 100_000;
  view = 3600;
  head: number;
  speed: number;
  /** The worker's computing speed while busy (simulated s per wall s). */
  capacity: number;
  playing: boolean;
  seeking = false;
  hidden = false;
  spinUp = false;
  reviewing = false;
  tier = 'standard';
  reruns = 0;
  /** `null`: the tracker counts the busy time itself. */
  duty: number | null = null;
  /** The engine's own capacity reading; `undefined`: the true capacity. */
  reported: number | null | undefined = undefined;
  info: PaceInfo | null = null;
  /** Every distinct level seen, in order (null = nothing published). */
  levels: (PaceLevel | null)[] = [];
  frames: PaceFrame[] = [];

  constructor(o: { speed?: number; capacity?: number; lead?: number; playing?: boolean }) {
    this.head = this.view + (o.lead ?? 0);
    this.speed = o.speed ?? 60;
    this.capacity = o.capacity ?? 200;
    this.playing = o.playing ?? true;
  }

  /** One frame (50 ms of wall time). */
  tick(): void {
    const dt = FRAME_MS / 1000;
    this.now += FRAME_MS;
    const target = runTarget(this.view, this.speed, DURATION, 60);
    const busy = this.playing && this.head < target - 1e-6;
    if (busy) this.head = Math.min(target, this.head + this.capacity * dt);
    if (this.playing && !this.seeking) this.view = advanceClock(this.view, this.head, this.speed, dt, DURATION);
    const f: PaceFrame = Object.freeze({
      nowMs: this.now,
      playing: this.playing,
      seeking: this.seeking,
      hidden: this.hidden,
      viewTime: this.view,
      headTime: this.head,
      duration: DURATION,
      speed: this.speed,
      spinUp: this.spinUp,
      reviewing: this.reviewing,
      tier: this.tier,
      reruns: this.reruns,
      capacity: this.reported === undefined ? this.capacity : this.reported,
      duty: this.duty,
      computing: busy,
    });
    this.frames.push(f);
    this.info = this.tracker.frame(f);
    const lv = this.info?.level ?? null;
    if (this.levels[this.levels.length - 1] !== lv) this.levels.push(lv);
  }

  /** Run `seconds` of wall time. */
  run(seconds: number): void {
    const n = Math.round((seconds * 1000) / FRAME_MS);
    for (let i = 0; i < n; i++) this.tick();
  }

  /** Run until the level is `level` (or `limitS` passes); returns the wall seconds it took. */
  until(level: PaceLevel | null, limitS: number): number {
    const t0 = this.now;
    while (this.now - t0 < limitS * 1000 && this.levelNow() !== level) this.tick();
    return (this.now - t0) / 1000;
  }

  levelNow(): PaceLevel | null {
    return this.info?.level ?? null;
  }

  /** The lead is used up and the worker produces nothing for `seconds`: the clock is held at the newest result. */
  stall(seconds: number): void {
    const was = this.capacity;
    this.view = this.head;
    this.capacity = 0.0001;
    this.run(seconds);
    this.capacity = was;
  }
}

const rig = (o: ConstructorParameters<typeof Rig>[0] = {}): Rig => new Rig(o);

describe('steady playback', () => {
  it('stays ok when the worker is much faster than playback, and says nothing for the first 15 s', () => {
    const r = rig({ speed: 60, capacity: 200 });
    r.run(PACE.graceS - 1);
    expect(r.info).toBeNull();
    r.run(120);
    expect(r.info?.level).toBe('ok');
    expect(r.levels.filter((l) => l !== null && l !== 'ok')).toEqual([]);
    expect(r.info!.wanted).toBe(60);
    expect(r.info!.waitingShare).toBe(0);
    // The clock moved at the speed asked for, and the worker kept far ahead.
    expect(r.info!.achieved).toBeGreaterThan(59);
    expect(r.info!.achieved).toBeLessThanOrEqual(60.01);
    expect(r.info!.aheadS).toBeGreaterThan(1000);
    expect(r.info!.bufferS).toBeCloseTo(r.info!.aheadS / 60, 6);
  });

  it('reads the achieved speed only after about 10 s of play', () => {
    const r = rig();
    r.run(PACE.graceS + 5);
    expect(r.info?.level).toBe('ok');
    expect(r.info!.achieved).toBeNull();
    r.run(6);
    expect(r.info!.achieved).not.toBeNull();
  });

  it('stays ok when the worker only just keeps up (computing at 100 % of the speed asked for)', () => {
    const r = rig({ speed: 60, capacity: 60, lead: 1800 });
    r.run(90);
    expect(r.info?.level).toBe('ok');
    expect(r.levels.filter((l) => l === 'behind' || l === 'waiting')).toEqual([]);
  });

  it('stays ok while the worker is behind in speed but mostly idle (nothing to compute: not lag)', () => {
    // Capacity under 90 % of the speed asked for, but the worker is ahead by half an hour and idles most of the time.
    const r = rig({ speed: 60, capacity: 50, lead: 1800 });
    r.reported = 50;
    r.duty = 0.3;
    r.run(60);
    expect(r.info?.level).toBe('ok');
    expect(r.info!.capacity).toBe(50);
    expect(r.levels.filter((l) => l === 'behind' || l === 'waiting')).toEqual([]);
  });
});

describe('the worker cannot keep up', () => {
  it('a drop in capacity gives behind first (10 s after the grace), then waiting once the buffer is used up', () => {
    const r = rig({ speed: 60, capacity: 200, lead: 1800 });
    r.run(40);
    expect(r.levels).toEqual([null, 'ok']);
    r.capacity = 38;
    const toBehind = r.until('behind', 60);
    expect(toBehind).toBeLessThan(15);
    expect(r.info!.capacity).toBe(38);
    expect(r.info!.duty).toBeGreaterThanOrEqual(0.9);
    expect(r.info!.waitingShare).toBe(0);
    // The buffer drains at (60 - 38) simulated s per wall s; 'behind' was early, nothing was held yet.
    expect(r.info!.aheadS).toBeGreaterThan(900);
    r.until('waiting', 200);
    expect(r.levels.slice(-3)).toEqual(['ok', 'behind', 'waiting']);
    expect(r.info!.waitingShare).toBeGreaterThan(PACE.waitingEnterShare);
    expect(r.info!.capacity).toBe(38);
    // Held at the newest result: the lead is gone and the clock moves at the worker's pace.
    r.run(15);
    expect(r.info!.aheadS).toBeLessThan(60);
    expect(r.info!.achieved).toBeGreaterThan(30);
    expect(r.info!.achieved).toBeLessThan(45);
  });

  it('a worker that is far too slow from the start gives waiting about 20 s after Play, never before the grace', () => {
    const r = rig({ speed: 600, capacity: 40, lead: 0 });
    const t = r.until('waiting', 120);
    expect(t).toBeGreaterThan(PACE.graceS);
    expect(t).toBeLessThan(PACE.graceS + PACE.waitingEnterHoldS + 4);
    expect(r.info!.waitingShare).toBeGreaterThan(0.5);
    expect(r.info!.wanted).toBe(600);
    expect(r.info!.capacity).toBe(40);
  });

  it('a clamp that is a tenth of the time (under 15 %) never gives waiting', () => {
    // Held 1 s in every 10 s: a share of about 10 %.
    const r = rig({ speed: 60, capacity: 200, lead: 1800 });
    r.run(PACE.graceS + 2);
    for (let i = 0; i < 8; i++) {
      r.run(9);
      r.stall(1);
    }
    expect(r.info).not.toBeNull();
    expect(r.info!.waitingShare).toBeGreaterThan(0.05);
    expect(r.info!.waitingShare).toBeLessThan(PACE.waitingEnterShare);
    expect(r.levels.filter((l) => l === 'waiting')).toEqual([]);
  });

  it('does not count the end of the run as waiting (the newest result is the end)', () => {
    const r = rig({ speed: 60, capacity: 5000, lead: 0 });
    r.view = DURATION - 1200;
    r.head = DURATION - 1200;
    // The worker finishes the run at once; the clock reaches the end 20 s later and sits there (the session would stop it).
    r.run(20 + 25);
    expect(r.view).toBe(DURATION);
    expect(r.info?.level).toBe('ok');
    expect(r.info!.waitingShare).toBe(0);
  });

  it('falls back to its own count of the busy time when the engine reports no duty', () => {
    const r = rig({ speed: 60, capacity: 38, lead: 0 });
    r.duty = null;
    r.until('waiting', 120);
    expect(r.info!.duty).toBeGreaterThan(0.9);
    r.duty = 0.5;
    r.run(1);
    expect(r.info!.duty).toBe(0.5);
  });

  it('uses the capacity it is given: without one it cannot say behind, but still says waiting', () => {
    const r = rig({ speed: 600, capacity: 40, lead: 0 });
    r.reported = null;
    r.until('waiting', 120);
    expect(r.levels).not.toContain('behind');
    expect(r.info!.capacity).toBeNull();
  });
});

describe('hysteresis', () => {
  /** A run that has just entered waiting at speed 60 against a worker computing 38. */
  function waiting(): Rig {
    const r = rig({ speed: 60, capacity: 38, lead: 0 });
    r.until('waiting', 120);
    return r;
  }

  it('waiting stays while the worker recovers for less than 20 s', () => {
    const r = waiting();
    r.capacity = 400; // fast enough now: the lead builds, no more clamping
    r.run(10 + PACE.waitingLeaveHoldS - 5); // the old clamps leave the 10 s window, then 15 s under 5 %
    expect(r.info!.level).toBe('waiting');
    expect(r.info!.waitingShare).toBeLessThan(PACE.waitingLeaveShare);
  });

  it('waiting leaves after the share stays under 5 % for 20 s', () => {
    const r = waiting();
    r.capacity = 400;
    r.run(10 + PACE.waitingLeaveHoldS + 3);
    expect(r.info!.level).toBe('ok');
  });

  it('a relapse during the 20 s starts the count again', () => {
    const r = waiting();
    r.capacity = 400;
    r.run(10 + 15);
    expect(r.info!.level).toBe('waiting');
    // The worker stalls for a couple of seconds: the share goes over 5 % again.
    r.stall(2);
    r.run(10 + 15);
    expect(r.info!.level).toBe('waiting');
    r.run(10);
    expect(r.info!.level).toBe('ok');
  });

  it('behind leaves only when capacity is at 97 % of the speed asked for or the worker is under 70 % busy, for 10 s', () => {
    const r = rig({ speed: 60, capacity: 38, lead: 1800 });
    r.until('behind', 60);
    // Between 90 % and 97 %: neither enters nor leaves.
    r.capacity = 56;
    r.run(30);
    expect(r.info!.level).toBe('behind');
    // At or above 97 %: leaves after 10 s, not before.
    r.capacity = 60;
    r.run(PACE.behindLeaveHoldS - 2);
    expect(r.info!.level).toBe('behind');
    r.run(4);
    expect(r.info!.level).toBe('ok');
  });

  it('behind also leaves when the worker is idle for 10 s', () => {
    const r = rig({ speed: 60, capacity: 38, lead: 1800 });
    r.until('behind', 60);
    r.duty = 0.5;
    r.run(PACE.behindLeaveHoldS - 2);
    expect(r.info!.level).toBe('behind');
    r.run(4);
    expect(r.info!.level).toBe('ok');
  });

  it('a dip that lasts under 10 s does not give behind', () => {
    const r = rig({ speed: 60, capacity: 200, lead: 1800 });
    r.run(30);
    r.capacity = 38;
    r.run(7);
    r.capacity = 200;
    r.run(40);
    expect(r.info?.level).toBe('ok');
    expect(r.levels.filter((l) => l === 'behind')).toEqual([]);
  });

  it('a change of speed while waiting drops the signal; the new speed is judged afresh after the wait', () => {
    const r = rig({ speed: 60, capacity: 38, lead: 0 });
    r.until('waiting', 120);
    r.speed = 30;
    r.run(1);
    expect(r.info).toBeNull();
    // At 30x the worker (38) keeps up: ok once the wait is over.
    r.run(PACE.graceS + 25);
    expect(r.info?.level).toBe('ok');
    expect(r.info!.wanted).toBe(30);
  });

  it('going back from waiting lands on behind while the worker still reads slow and busy', () => {
    const r = rig({ speed: 60, capacity: 400, lead: 0 });
    // The engine's own reading stays low and its duty high (a stale average), while the clock is no longer held.
    r.reported = 38;
    r.duty = 0.97;
    r.stall(1);
    // Waiting first (the clock is held), then a worker that has really caught up leaves it after 20 s: behind remains.
    r.capacity = 0.0001;
    r.view = r.head;
    r.until('waiting', 120);
    r.capacity = 400;
    r.run(10 + PACE.waitingLeaveHoldS + 3);
    expect(r.info?.level).toBe('behind');
  });

  it('records when the level last changed', () => {
    const r = rig({ speed: 60, capacity: 38, lead: 0 });
    r.until('waiting', 120);
    const at = r.info!.sinceMs;
    expect(at).toBeLessThanOrEqual(r.now);
    expect(at).toBeGreaterThan(r.now - 3000);
    r.run(5);
    expect(r.info!.sinceMs).toBe(at);
  });

  it('the shares and speeds are a trailing window of about 10 s: an old clamp leaves it', () => {
    const r = rig({ speed: 60, capacity: 200, lead: 1800 });
    r.run(30);
    r.stall(3); // 3 s with no results
    expect(r.info!.waitingShare).toBeGreaterThan(0.2);
    r.run(12);
    expect(r.info!.waitingShare).toBe(0);
  });
});

describe('what is never judged', () => {
  /** A run that is clearly waiting, then `disturb()` happens; returns the rig after the signal went. */
  function lagging(speed = 600): Rig {
    const r = rig({ speed, capacity: 40, lead: 0 });
    r.until('waiting', 120);
    return r;
  }

  it('seeking: nothing is published while a jump computes, and the wait starts when it ends', () => {
    const r = lagging();
    r.seeking = true;
    r.run(1);
    expect(r.info).toBeNull();
    r.run(60); // however long it takes
    expect(r.info).toBeNull();
    r.seeking = false;
    const t0 = r.now;
    r.run(PACE.graceS - 1);
    expect(r.info).toBeNull();
    r.until('waiting', 120);
    // The wait, then the share has to build up and be held: not before.
    expect((r.now - t0) / 1000).toBeGreaterThan(PACE.graceS + PACE.waitingEnterHoldS);
  });

  it('paused: nothing is published, and after Play the wait is 15 s', () => {
    const r = lagging();
    r.playing = false;
    r.run(2);
    expect(r.info).toBeNull();
    r.run(120);
    r.playing = true;
    r.run(PACE.graceS - 1);
    expect(r.info).toBeNull();
    // The worker is still behind: the signal comes back, after the wait and the hold.
    r.until('waiting', 60);
    expect(r.levelNow()).toBe('waiting');
  });

  it('the app hidden: nothing is published, and the wait after it returns is 5 s, not 15', () => {
    const r = lagging();
    r.hidden = true;
    r.run(3);
    expect(r.info).toBeNull();
    r.hidden = false;
    r.run(PACE.hiddenGraceS - 1);
    expect(r.info).toBeNull();
    r.run(2);
    expect(r.info).not.toBeNull();
    expect(r.info!.level).toBe('ok');
  });

  it('a gap in the frames (the page was suspended) drops the window and waits 5 s', () => {
    const r = lagging();
    r.now += PACE.gapMs + 1000;
    r.run(1);
    expect(r.info).toBeNull();
    r.run(PACE.hiddenGraceS + 1);
    expect(r.info?.level).toBe('ok');
  });

  it('the 3-D spin-up and the auto-tune decision (no results beyond the start yet)', () => {
    const r = rig({ speed: 600, capacity: 40, lead: 0 });
    r.spinUp = true;
    r.run(60);
    expect(r.info).toBeNull();
    // The head at 0 looks like lag to the clock: still nothing, whether or not the engine says it is spinning up.
    r.spinUp = false;
    r.view = 0;
    r.head = 0;
    r.capacity = 0;
    r.run(2);
    expect(r.info).toBeNull();
    // Results arrive: the wait starts then, not before.
    r.head = 600;
    r.capacity = 40;
    r.run(PACE.graceS - 1);
    expect(r.info).toBeNull();
    r.run(2);
    expect(r.info?.level).toBe('ok');
  });

  it('a tier switch: the engine re-spins and everything is dropped; the wait is 15 s', () => {
    const r = lagging();
    r.tier = 'fast';
    r.run(1);
    expect(r.info).toBeNull();
    r.run(PACE.graceS - 2);
    expect(r.info).toBeNull();
    // The new tier is also slower than the clock: the signal comes back honestly, after the wait.
    r.until('waiting', 60);
    expect(r.levelNow()).toBe('waiting');
  });

  it('a re-run from an earlier time (an edit, a restore) drops the window', () => {
    const r = lagging();
    r.reruns += 1;
    r.run(1);
    expect(r.info).toBeNull();
  });

  it('replaying history: the clock is not limited by the worker, so nothing is judged', () => {
    const r = lagging();
    r.reviewing = true;
    r.run(30);
    expect(r.info).toBeNull();
    r.reviewing = false;
    r.run(PACE.graceS - 1);
    expect(r.info).toBeNull();
  });

  it('the newest result moving backward (a rewind or an edit) drops the window', () => {
    const r = lagging();
    r.head -= 900;
    r.view = Math.min(r.view, r.head);
    r.run(0.1);
    expect(r.info).toBeNull();
    r.run(PACE.graceS - 1);
    expect(r.info).toBeNull();
  });

  it('a small step back of the newest result (under a second) is jitter, not a rewind', () => {
    const r = rig({ speed: 60, capacity: 200, lead: 1800 });
    r.run(PACE.graceS + 3);
    expect(r.info?.level).toBe('ok');
    r.head -= 0.5;
    r.run(0.1);
    expect(r.info?.level).toBe('ok');
  });

  it('a change of speed mid-window drops the window: the old numbers are about another speed', () => {
    const r = lagging(600);
    r.speed = 60;
    r.run(0.1);
    expect(r.info).toBeNull();
    r.run(PACE.graceS - 1);
    expect(r.info).toBeNull();
  });

  it('Max speed asks for nothing: no pace at all', () => {
    const r = rig({ speed: Infinity, capacity: 40, lead: 0 });
    r.run(120);
    expect(r.info).toBeNull();
    expect(r.levels).toEqual([null]);
  });

  it('exclude() drops the window for an edit or a re-run and starts the 15 s wait', () => {
    const r = lagging();
    r.tracker.exclude('edit', r.now);
    expect(r.tracker.info).toBeNull();
    r.run(PACE.graceS - 1);
    expect(r.info).toBeNull();
    r.run(2);
    expect(r.info?.level).toBe('ok');
  });
});

describe('the tracker only looks', () => {
  it('does not change the frames it is given (they are frozen) and returns nothing but a PaceInfo', () => {
    const r = rig({ speed: 600, capacity: 40, lead: 0 });
    r.run(60);
    expect(r.info).not.toBeNull();
    expect(Object.keys(r.info!).sort()).toEqual(['achieved', 'aheadS', 'bufferS', 'capacity', 'duty', 'level', 'sinceMs', 'waitingShare', 'wanted']);
    for (const f of r.frames) expect(Object.isFrozen(f)).toBe(true);
  });

  it('publishes the same object until it has something new to say (no state churn every frame)', () => {
    const r = rig({ speed: 60, capacity: 200, lead: 1800 });
    r.run(30);
    const a = r.info;
    r.tick();
    expect(r.info).toBe(a);
    r.run(1.2);
    expect(r.info).not.toBe(a);
  });

  it('never publishes NaN or Infinity, whatever the engine reports', () => {
    const r = rig({ speed: 60, capacity: 38, lead: 0 });
    const bad = [Number.NaN, Infinity, -5, 0, 1e300, null];
    for (let i = 0; i < 400; i++) {
      r.reported = bad[i % bad.length] as number | null;
      r.duty = i % 3 === 0 ? (bad[(i + 1) % bad.length] as number | null) : null;
      r.tick();
      if (r.info) {
        for (const [k, v] of Object.entries(r.info)) if (typeof v === 'number') expect(Number.isFinite(v), `${k} = ${String(v)}`).toBe(true);
      }
    }
    r.reported = 38;
    r.duty = null;
    r.run(60);
    expect(r.info).not.toBeNull();
    for (const [k, v] of Object.entries(r.info!)) if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
  });

  it('the debug hook publishes a canned level whatever the frames say, and gives control back', () => {
    const r = rig({ speed: 60, capacity: 200, lead: 1800, playing: false });
    expect(r.tracker.force('waiting', 123)).toEqual(forcedPace('waiting', 123));
    r.run(5);
    expect(r.info?.level).toBe('waiting');
    expect(r.info!.wanted).toBe(60);
    r.tracker.force('behind', 5);
    r.run(1);
    expect(r.info?.level).toBe('behind');
    r.tracker.force(null);
    expect(r.tracker.info).toBeNull();
    r.run(1);
    expect(r.info).toBeNull();
  });

  it('every forced level is a complete reading', () => {
    for (const level of ['ok', 'behind', 'waiting'] as const) {
      const p = forcedPace(level, 0);
      expect(p.level).toBe(level);
      for (const [k, v] of Object.entries(p)) if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
    }
  });
});

describe('announcing', () => {
  const MIN = 60_000;
  it('announces once on entering waiting, not for behind, not for leaving, not while it stays', () => {
    expect(shouldAnnounce('ok', 'waiting', null, 0)).toBe(true);
    expect(shouldAnnounce('behind', 'waiting', null, 0)).toBe(true);
    expect(shouldAnnounce(null, 'waiting', null, 0)).toBe(true);
    expect(shouldAnnounce('waiting', 'waiting', null, 0)).toBe(false);
    expect(shouldAnnounce('ok', 'behind', null, 0)).toBe(false);
    expect(shouldAnnounce('waiting', 'ok', null, 0)).toBe(false);
    expect(shouldAnnounce('waiting', null, null, 0)).toBe(false);
  });
  it('at most once every 2 minutes', () => {
    expect(shouldAnnounce('ok', 'waiting', 0, MIN)).toBe(false);
    expect(shouldAnnounce('ok', 'waiting', 0, 2 * MIN - 1)).toBe(false);
    expect(shouldAnnounce('ok', 'waiting', 0, 2 * MIN)).toBe(true);
    expect(shouldAnnounce('ok', 'waiting', 5 * MIN, 5 * MIN + 119_999)).toBe(false);
  });
});
