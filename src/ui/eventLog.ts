/**
 * The "Recent events" of the Simulation debug statistics screen (workstream A, §5.3) and the long-task counter of its Display
 * group. These must be collecting before the screen is first opened, so this file is part of the entry chunk and stays small:
 * a ring of the last 40 events, the slow-run episodes derived from `SessionState.pace` (level changes and the slowest ratio),
 * the engine's own events (`EngineInfo.perf.events`, de-duplicated by `seq`), the app going to the background and coming
 * back, and the first time the history was thinned. The screen and the text export live in the lazy chunk
 * (debugStats.ts, screens/debugStats.ts).
 *
 * Events never carry a coordinate, a place name or an identifier. Nothing here changes a result: it only reads state.
 */
import type { PaceInfo, PaceLevel } from './paceTypes';
import type { SimSession } from './session';

export type EventKind = 'run' | 'tier' | 'slow' | 'app' | 'rewind' | 'restore' | 'long-steps' | 'history';

export interface LogEvent {
  /** Wall clock (ms since the epoch) and the run clock (simulated seconds; null when none applies). */
  wallMs: number;
  runS: number | null;
  kind: EventKind;
  text: string;
}

/** A span of wall time in words: "5 s", "2 min 10 s", "1 h 3 min". */
export function waited(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

export class EventLog {
  private readonly ring: LogEvent[] = [];
  /** Wall clock (ms since the epoch) when the current run began; null before the first run. */
  runStartMs: number | null = null;

  constructor(
    readonly capacity = 40,
    readonly now: () => number = Date.now,
  ) {}

  add(kind: EventKind, text: string, runS: number | null = null, wallMs: number = this.now()): void {
    this.ring.push({ wallMs, runS, kind, text });
    if (this.ring.length > this.capacity) this.ring.shift();
  }

  /** The events, oldest first. */
  list(): readonly LogEvent[] {
    return this.ring;
  }

  /** A new run: forget the last one's events. */
  begin(): void {
    this.ring.length = 0;
    this.runStartMs = this.now();
  }
}

export const eventLog = new EventLog();

/**
 * Turns the pace levels (`SessionState.pace`) into slow-run episodes: one event when playback falls behind, one when it starts
 * to wait or stops waiting while still behind, and one when it is back, with how long it lasted and the slowest speed seen
 * against the speed asked for.
 */
export class PaceWatch {
  private level: PaceLevel = 'ok';
  private t0 = 0;
  private worst = Infinity;

  constructor(private readonly log: EventLog) {}

  observe(pace: PaceInfo | null, runS: number): void {
    const level = pace?.level ?? 'ok';
    const was = this.level;
    if (level === 'ok' && was === 'ok') return;
    if (was === 'ok') {
      this.t0 = this.log.now();
      this.worst = Infinity;
    }
    // The slowest ratio is what playback achieved against what was asked for; the sentences name what the worker computes.
    const played = pace ? (pace.achieved ?? pace.capacity) : null;
    if (pace && level !== 'ok' && played !== null && pace.wanted > 0) this.worst = Math.min(this.worst, played / pace.wanted);
    if (level === was) return;
    this.level = level;
    const computing = pace ? (pace.capacity ?? pace.achieved) : null;
    const asked = pace ? `${Math.round(pace.wanted)}x` : '';
    const now = computing !== null ? `about ${Math.round(computing)}x` : 'slower';
    if (level === 'ok') {
      const worst = Number.isFinite(this.worst) ? ` Slowest: about ${Math.round(100 * Math.min(1, this.worst))} % of the speed asked for.` : '';
      const after = waited(this.log.now() - this.t0);
      this.log.add('slow', pace ? `Back at the speed asked for after ${after}.${worst}` : `The slow spell ended after ${after} (playback was paused, jumped or changed speed).${worst}`, runS);
    } else if (was === 'ok') {
      this.log.add('slow', level === 'waiting' ? `Playback is waiting for the simulation: computing ${now}, asked for ${asked}.` : `The simulation is falling behind: computing ${now}, asked for ${asked}.`, runS);
    } else {
      this.log.add('slow', level === 'waiting' ? 'Playback is now waiting for the simulation.' : 'Playback is no longer waiting, but the simulation is still behind.', runS);
    }
  }
}

/**
 * Watch one run: reset the log, then record slow-run episodes, the engine's events, going to the background and coming back,
 * and the first thinning of the history. Returns the stop function.
 */
export function watchRun(session: Pick<SimSession, 'state' | 'snapshots'>, log: EventLog = eventLog): () => void {
  log.begin();
  log.add('run', 'Run started.', 0);
  const pace = new PaceWatch(log);
  let lastSeq = 0;
  let thinned = false;
  let hiddenAt = 0;
  const offPace = session.state.subscribe((s) => pace.observe(s.pace, s.viewTime), ['pace']);
  const offSnap = session.state.subscribe((s) => {
    for (const e of s.snapshot?.engine?.perf?.events ?? []) {
      if (e.seq <= lastSeq) continue;
      lastSeq = e.seq;
      log.add(e.kind, e.text, e.simS, e.wallMs);
    }
    const st = session.snapshots;
    if (!thinned && st.spacing > 1.5 * st.displayStep) {
      thinned = true;
      log.add('history', `The history memory is full: older pictures are now about ${Math.round(st.spacing)} s apart.`, s.viewTime);
    }
  }, ['snapshot']);
  const onVisibility = (): void => {
    const t = session.state.get().viewTime;
    if (document.hidden) {
      hiddenAt = log.now();
      log.add('app', 'The app went to the background.', t);
    } else if (hiddenAt) {
      log.add('app', `The app came back after ${waited(log.now() - hiddenAt)} in the background.`, t);
      hiddenAt = 0;
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    offPace();
    offSnap();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** The main thread's long tasks (50 ms or more) of the last minute, from `PerformanceObserver('longtask')` where the browser has it. */
export class LongTasks {
  private readonly at = new Float64Array(128);
  private readonly ms = new Float64Array(128);
  private n = 0;
  private head = 0;
  /** The browser reports long tasks (the observer started); false means "not available", not "none". */
  supported = false;

  add(startMs: number, durationMs: number): void {
    this.at[this.head] = startMs;
    this.ms[this.head] = durationMs;
    this.head = (this.head + 1) % this.at.length;
    if (this.n < this.at.length) this.n++;
  }

  /** The tasks that started in the `windowMs` before `nowMs` (the ring holds the last 128, so a very busy minute reads as at least that many). */
  recent(nowMs: number, windowMs = 60_000): { count: number; totalMs: number; maxMs: number } {
    let count = 0;
    let totalMs = 0;
    let maxMs = 0;
    for (let i = 0; i < this.n; i++) {
      if (nowMs - this.at[i]! > windowMs) continue;
      count++;
      totalMs += this.ms[i]!;
      maxMs = Math.max(maxMs, this.ms[i]!);
    }
    return { count, totalMs, maxMs };
  }
}

export const longTasks = new LongTasks();

/** Start collecting long tasks (once); a browser without the API leaves `supported` false. */
export function watchLongTasks(into: LongTasks = longTasks): void {
  if (into.supported || typeof PerformanceObserver === 'undefined') return;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) into.add(e.startTime, e.duration);
    }).observe({ type: 'longtask' });
    into.supported = true;
  } catch {
    /* the browser does not report long tasks */
  }
}
