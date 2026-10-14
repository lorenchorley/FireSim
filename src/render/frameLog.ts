/**
 * Frame statistics for the "Simulation debug statistics" screen (workstream A, §5.3 "Display"): a ring of the last 120 frame
 * intervals plus ten one-second bins (frames drawn and their time), kept by {@link FrameMeter}. Pure and allocation-free after
 * construction: `add` is O(1) per frame; `summary` (once a second, from the screen) sorts a scratch copy of the ring.
 * Nothing here touches the adaptive pixel ratio or any result.
 */

/** Frame intervals kept. */
export const FRAME_RING = 120;
/** One-second bins behind the "last 10 s" frame rate. */
const BINS = 10;
/** Intervals above this (ms) are not frames of a running loop but a pause (an app in the background): left out of the ring. */
export const STALL_MAX_MS = 2000;
/** Slow-frame thresholds (ms). 34, not 33: the playback cap draws every second 60 Hz refresh, 33.3 ms, and that is a normal frame. */
export const SLOW_MS = 34;
export const VERY_SLOW_MS = 100;

export interface FrameSummary {
  /** Frames per second over the last 10 s of drawing (frames drawn / time they took); null before the first. */
  fps10: number | null;
  meanMs: number | null;
  p95Ms: number | null;
  /** Intervals in the ring above {@link SLOW_MS} and {@link VERY_SLOW_MS}, and how many the ring holds. */
  over33: number;
  over100: number;
  frames: number;
}

export class FrameLog {
  private readonly ring = new Float32Array(FRAME_RING);
  private readonly scratch = new Float32Array(FRAME_RING);
  private n = 0;
  private head = 0;
  private readonly binSec = new Float64Array(BINS).fill(-1);
  private readonly binN = new Float64Array(BINS);
  private readonly binMs = new Float64Array(BINS);
  private lastSec = -1;

  /** One drawn frame: `dtMs` since the previous drawn frame, `nowMs` the frame's time. */
  add(dtMs: number, nowMs: number): void {
    if (!(dtMs > 0) || dtMs > STALL_MAX_MS) return;
    this.ring[this.head] = dtMs;
    this.head = (this.head + 1) % FRAME_RING;
    if (this.n < FRAME_RING) this.n++;
    const sec = Math.floor(nowMs / 1000);
    const i = sec % BINS;
    if (this.binSec[i] !== sec) {
      this.binSec[i] = sec;
      this.binN[i] = 0;
      this.binMs[i] = 0;
    }
    this.binN[i]! += 1;
    this.binMs[i]! += dtMs;
    this.lastSec = sec;
  }

  summary(): FrameSummary {
    const n = this.n;
    if (n === 0) return { fps10: null, meanMs: null, p95Ms: null, over33: 0, over100: 0, frames: 0 };
    let sum = 0;
    let over33 = 0;
    let over100 = 0;
    for (let k = 0; k < n; k++) {
      const v = this.ring[k]!;
      this.scratch[k] = v;
      sum += v;
      if (v > SLOW_MS) over33++;
      if (v > VERY_SLOW_MS) over100++;
    }
    const sorted = this.scratch.subarray(0, n).sort();
    let frames10 = 0;
    let ms10 = 0;
    for (let i = 0; i < BINS; i++) {
      if (this.binSec[i]! >= 0 && this.lastSec - this.binSec[i]! < BINS) {
        frames10 += this.binN[i]!;
        ms10 += this.binMs[i]!;
      }
    }
    return {
      fps10: ms10 > 0 ? (1000 * frames10) / ms10 : null,
      meanMs: sum / n,
      p95Ms: sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)]!,
      over33,
      over100,
      frames: n,
    };
  }
}
