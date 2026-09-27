/**
 * Frame-rate measurement and adaptive resolution (pure logic; the view applies the pixel ratio).
 *
 * Mobile GPUs are fill-rate bound, so the cheapest lever is the device pixel ratio (doc 09 §8.1: DPR 3 → 2 cuts the
 * pixels by 56 %). The controller lowers the DPR in steps when the measured frame rate stays below the floor and
 * raises it again after a sustained period of headroom. Only frames rendered back-to-back are measured, so an idle
 * (render-on-demand) scene does not look "slow".
 */

export interface AdaptiveDprOptions {
  /** Highest DPR used (default min(devicePixelRatio, 2)). */
  maxDpr: number;
  /** Lowest DPR (default 1). */
  minDpr?: number;
  /** Lower the DPR when the fps stays below this (default 30). */
  lowFps?: number;
  /** Raise it again when the fps stays above this (default 52). */
  highFps?: number;
  /** DPR step (default 0.25). */
  step?: number;
  /** Seconds of sustained low / high fps before acting (default 1.5 / 5). */
  downAfter?: number;
  upAfter?: number;
}

export class FrameMeter {
  private readonly ring = new Float64Array(60);
  private n = 0;
  private head = 0;
  private sum = 0;
  private last = -1;
  /** Frames further apart than this (ms) are treated as a pause, not a slow frame. */
  gapMs = 250;

  /** Record a rendered frame at time `now` (ms). Returns the frame interval (ms) or 0 after a gap. */
  tick(now: number): number {
    const dt = this.last < 0 ? 0 : now - this.last;
    this.last = now;
    if (dt <= 0 || dt > this.gapMs) return 0;
    // Ring buffer with a running sum: no allocation or O(n) work per frame.
    if (this.n === this.ring.length) this.sum -= this.ring[this.head]!;
    else this.n++;
    this.ring[this.head] = dt;
    this.sum += dt;
    this.head = (this.head + 1) % this.ring.length;
    return dt;
  }

  /** Mean fps over the last ≤ 60 measured frames (0 if none). */
  get fps(): number {
    return this.n === 0 || this.sum <= 0 ? 0 : (1000 * this.n) / this.sum;
  }

  reset(): void {
    this.clearHistory();
    this.last = -1;
  }

  /** Forget the measured intervals but keep the frame chain (e.g. when the frame-rate cap changes). */
  clearHistory(): void {
    this.n = 0;
    this.head = 0;
    this.sum = 0;
  }
}

export class AdaptiveDpr {
  readonly maxDpr: number;
  readonly minDpr: number;
  private readonly lowFps: number;
  private readonly highFps: number;
  private readonly step: number;
  private readonly downAfter: number;
  private readonly upAfter: number;
  private lowFor = 0;
  private highFor = 0;
  dpr: number;

  constructor(o: AdaptiveDprOptions) {
    this.maxDpr = o.maxDpr;
    this.minDpr = Math.min(o.minDpr ?? 1, o.maxDpr);
    this.lowFps = o.lowFps ?? 30;
    this.highFps = o.highFps ?? 52;
    this.step = o.step ?? 0.25;
    this.downAfter = o.downAfter ?? 1.5;
    this.upAfter = o.upAfter ?? 5;
    this.dpr = o.maxDpr;
  }

  /**
   * Feed one measured frame: `dtMs` is the frame interval and `fps` the smoothed frame rate. Returns the new DPR when
   * it changed, otherwise null.
   *
   * `capFps` is the frame-rate cap in force (e.g. 30 during playback, doc 09 §3.4). A capped loop can never exceed the
   * cap, so the thresholds are taken relative to it: "slow" means clearly below the cap (< 80 % of it), and
   * "headroom" means holding the cap for twice as long as usual. Without this, a 30 fps cap sits exactly on the
   * default 30 fps floor and every hiccup would lower the resolution, which could then never recover.
   */
  sample(dtMs: number, fps: number, capFps = Infinity): number | null {
    if (dtMs <= 0 || fps <= 0) return null;
    const dt = dtMs / 1000;
    const capped = Number.isFinite(capFps) && capFps < this.highFps / 0.97;
    const low = capped ? Math.min(this.lowFps, 0.8 * capFps) : this.lowFps;
    const high = capped ? 0.97 * capFps : this.highFps;
    const upAfter = capped ? this.upAfter * 2 : this.upAfter;
    if (fps < low) {
      this.lowFor += dt;
      this.highFor = 0;
    } else if (fps > high) {
      this.highFor += dt;
      this.lowFor = 0;
    } else {
      this.lowFor = 0;
      this.highFor = 0;
    }
    if (this.lowFor >= this.downAfter && this.dpr > this.minDpr) {
      this.dpr = Math.max(this.minDpr, +(this.dpr - this.step).toFixed(2));
      this.lowFor = 0;
      return this.dpr;
    }
    if (this.highFor >= upAfter && this.dpr < this.maxDpr) {
      this.dpr = Math.min(this.maxDpr, +(this.dpr + this.step).toFixed(2));
      this.highFor = 0;
      return this.dpr;
    }
    return null;
  }

  /** Jump straight to the minimum (e.g. thermal pressure, low-power mode). */
  forceMin(): number {
    this.dpr = this.minDpr;
    this.lowFor = 0;
    this.highFor = 0;
    return this.dpr;
  }
}
