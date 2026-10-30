/**
 * The idle stop (0.7.0, item E3; docs/plans/0.7.0/D-CONTRACT-070-detail-looks.md section 2.3): after `IDLE_STOP_MS` without activity (a touch, a
 * camera move, a time or layer change) the view holds still and stops drawing, and any activity wakes it. Pure: no DOM, no Three.js, a clock that
 * is given. C0 STUB (lane E-B): the types and the one-line documented members, inert: it never idles, so nothing changes until the lane builds it.
 */

/** A minute (ms) without activity before the view holds still. */
export const IDLE_STOP_MS = 60_000;

export class IdleClock {
  /** Idle after this many ms without a poke; 0 or `Infinity` = never. */
  limitMs: number;

  constructor(limitMs: number) {
    this.limitMs = limitMs;
  }

  /** Activity at `nowMs`; true when this poke ended an idle stop (the caller then wakes the view). Stub: never. */
  poke(_nowMs: number): boolean {
    return false;
  }

  /** Whether the view is stopped at `nowMs`. Stub: never. */
  idle(_nowMs: number): boolean {
    return false;
  }

  setLimit(ms: number): void {
    this.limitMs = ms;
  }
}

/** The idle limit from a raw option (the test seam `window.__firesimIdleStopMs`): a finite number of ms, else `IDLE_STOP_MS`. Stub: the default. */
export function idleStopLimit(_raw: unknown): number {
  return IDLE_STOP_MS;
}
