/**
 * The idle stop (0.7.0, item E3; docs/plans/0.7.0/D-CONTRACT-070-detail-looks.md section 2.3): after `IDLE_STOP_MS` without activity (a touch, a
 * camera move, a time or layer change) the view holds still and stops drawing, and any activity wakes it. Pure: no DOM, no Three.js, a clock that
 * is given (the times are the page's `performance.now()` in ms). `SceneView` owns one and decides what counts as activity; this only counts.
 */

/** A minute (ms) without activity before the view holds still. */
export const IDLE_STOP_MS = 60_000;

export class IdleClock {
  /** Idle after this many ms without a poke; 0 or `Infinity` (or anything that is not a positive number) = never. */
  limitMs: number;
  /** The time of the last activity; NaN until the first poke or the first look (an unpoked clock starts counting when it is first asked). */
  private last = NaN;

  constructor(limitMs: number) {
    this.limitMs = limitMs;
  }

  /** Activity at `nowMs`; true when this poke ended an idle stop (the caller then wakes the view). */
  poke(nowMs: number): boolean {
    const was = this.idle(nowMs);
    this.last = nowMs;
    return was;
  }

  /**
   * Whether the view is stopped at `nowMs`: the limit has passed since the last poke. A clock that has gone backwards is never idle, and a limit
   * that is 0, not finite or not a number is "never".
   */
  idle(nowMs: number): boolean {
    if (!(this.limitMs > 0) || this.limitMs === Infinity) return false;
    if (Number.isNaN(this.last)) this.last = nowMs;
    return nowMs - this.last >= this.limitMs;
  }

  setLimit(ms: number): void {
    this.limitMs = ms;
  }
}

/**
 * The idle limit from a raw option (the test seam `window.__firesimIdleStopMs`, or `SceneViewOptions.idleStopMs`): a number of ms or a numeric
 * string, 0 or `Infinity` for "never"; anything else (absent, negative, NaN, text) is `IDLE_STOP_MS`.
 */
export function idleStopLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return n >= 0 ? n : IDLE_STOP_MS; // (NaN is not >= 0)
}
