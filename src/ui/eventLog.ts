/**
 * The "Recent events" ring of the Simulation debug statistics screen (workstream A, §5.3) and the long-task counter of its
 * Display group. These collect before the screen is first opened, so this file is part of the entry chunk and stays small:
 * the ring of the last 40 events and the long-task observer. What fills the ring (slow-run episodes from `SessionState.pace`,
 * the engine's own events, going to the background, the first thinning of the history) is runEvents.ts, loaded as its own
 * small chunk when a run starts; the screen and the text export are in the lazy chunk of the screen.
 *
 * Events never carry a coordinate, a place name or an identifier. Nothing here changes a result: it only reads state.
 */
export type EventKind = 'run' | 'tier' | 'slow' | 'app' | 'rewind' | 'restore' | 'long-steps' | 'history';

export interface LogEvent {
  /** Wall clock (ms since the epoch) and the run clock (simulated seconds; null when none applies). */
  wallMs: number;
  runS: number | null;
  kind: EventKind;
  text: string;
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
