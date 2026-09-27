/**
 * Memory-capped store of simulation snapshots for the time scrubber ("replay the last few hours").
 *
 * Snapshots arrive every few simulated minutes and can be several MB each (a 300 × 300 fire grid is ~2.4 MB, plus
 * the atmosphere view). The store keeps them in time order and
 *  - keeps at most one snapshot per `stride` bucket of simulated time (initially `minInterval`), plus the newest one
 *    (the "head") — so a stream of snapshots every minute is stored every 5 minutes;
 *  - invalidates everything at or after a new snapshot's time (after a rewind the worker re-simulates, so older
 *    "future" snapshots are stale);
 *  - when over `maxBytes`, either drops the oldest ('ring') or thins the history evenly ('thin': the stride doubles
 *    and only the first snapshot of each wider bucket is kept), so a long run can still be scrubbed end to end at a
 *    coarser, uniform step. The first snapshot and the head are always kept.
 */
import type { SimSnapshot } from '../core/types';

export type EvictionMode = 'ring' | 'thin';

export interface SnapshotStoreOptions {
  /** Memory budget (bytes). Default 150 MB. */
  maxBytes?: number;
  /** Minimum simulated seconds between stored snapshots (the latest is always kept). Default 300 s. */
  minInterval?: number;
  mode?: EvictionMode;
  /** Size estimator (default {@link estimateSnapshotBytes}). */
  sizeOf?: (s: SimSnapshot) => number;
}

interface Entry {
  snap: SimSnapshot;
  bytes: number;
}

export class SnapshotStore {
  private entries: Entry[] = [];
  private bytes = 0;
  /** Current bucket width (s); doubles in 'thin' mode when the budget is exceeded. */
  private stride: number;
  readonly maxBytes: number;
  readonly minInterval: number;
  readonly mode: EvictionMode;
  private readonly sizeOf: (s: SimSnapshot) => number;

  constructor(opts: SnapshotStoreOptions = {}) {
    this.maxBytes = opts.maxBytes ?? 150 * 1024 * 1024;
    this.minInterval = Math.max(1e-6, opts.minInterval ?? 300);
    this.mode = opts.mode ?? 'thin';
    this.sizeOf = opts.sizeOf ?? estimateSnapshotBytes;
    this.stride = this.minInterval;
  }

  get size(): number {
    return this.entries.length;
  }

  get totalBytes(): number {
    return this.bytes;
  }

  /** Current spacing (s) of the retained history. */
  get spacing(): number {
    return this.stride;
  }

  /** Times of the stored snapshots (ascending). */
  times(): number[] {
    return this.entries.map((e) => e.snap.time);
  }

  /** Earliest and latest stored time, or null if empty. */
  range(): { start: number; end: number } | null {
    if (this.entries.length === 0) return null;
    return { start: this.entries[0]!.snap.time, end: this.entries[this.entries.length - 1]!.snap.time };
  }

  latest(): SimSnapshot | null {
    return this.entries.length ? this.entries[this.entries.length - 1]!.snap : null;
  }

  /** Add a snapshot. Returns true if it was stored. */
  push(snap: SimSnapshot): boolean {
    if (!Number.isFinite(snap.time)) return false;
    // A snapshot at or before existing ones invalidates them (re-simulation after a rewind).
    this.truncateFrom(snap.time);
    // The previous head only stays if it is the first snapshot of its bucket.
    const n = this.entries.length;
    if (n >= 2) {
      const prev = this.entries[n - 1]!;
      if (this.bucket(prev.snap.time) === this.bucket(this.entries[n - 2]!.snap.time)) {
        this.entries.pop();
        this.bytes -= prev.bytes;
      }
    }
    const bytes = this.sizeOf(snap);
    this.entries.push({ snap, bytes });
    this.bytes += bytes;
    this.evict();
    return true;
  }

  /** Latest snapshot with time ≤ t (or the earliest one if t is before all), null if empty. */
  atOrBefore(t: number): SimSnapshot | null {
    const e = this.entries;
    if (e.length === 0) return null;
    if (t < e[0]!.snap.time) return e[0]!.snap;
    let lo = 0;
    let hi = e.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (e[mid]!.snap.time <= t) lo = mid;
      else hi = mid - 1;
    }
    return e[lo]!.snap;
  }

  /** Snapshot nearest to t. */
  nearest(t: number): SimSnapshot | null {
    const a = this.atOrBefore(t);
    if (!a) return null;
    const i = this.entries.findIndex((e) => e.snap === a);
    const b = this.entries[i + 1]?.snap;
    return b && Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a;
  }

  /** Drop every snapshot with time > t. */
  truncateAfter(t: number): void {
    this.dropWhile((s) => s.time > t);
  }

  /** Drop every snapshot with time ≥ t. */
  truncateFrom(t: number): void {
    this.dropWhile((s) => s.time >= t);
  }

  clear(): void {
    this.entries = [];
    this.bytes = 0;
    this.stride = this.minInterval;
  }

  /** All snapshots (ascending); the array is a copy. */
  all(): SimSnapshot[] {
    return this.entries.map((e) => e.snap);
  }

  private bucket(t: number): number {
    const t0 = this.entries.length ? this.entries[0]!.snap.time : 0;
    // Small epsilon so snapshots at exact multiples land in their own bucket despite float noise.
    return Math.floor((t - t0) / this.stride + 1e-9);
  }

  private dropWhile(pred: (s: SimSnapshot) => boolean): void {
    while (this.entries.length && pred(this.entries[this.entries.length - 1]!.snap)) {
      this.bytes -= this.entries.pop()!.bytes;
    }
    if (this.entries.length === 0) this.stride = this.minInterval;
  }

  private evict(): void {
    while (this.bytes > this.maxBytes && this.entries.length > 2) {
      if (this.mode === 'ring') {
        this.bytes -= this.entries.shift()!.bytes;
        continue;
      }
      // Thin: double the stride and keep the first snapshot of each bucket plus the head.
      this.stride *= 2;
      const head = this.entries[this.entries.length - 1]!;
      const kept: Entry[] = [];
      let lastBucket = -1;
      for (let i = 0; i < this.entries.length - 1; i++) {
        const e = this.entries[i]!;
        const b = this.bucket(e.snap.time);
        if (b !== lastBucket) {
          kept.push(e);
          lastBucket = b;
        }
      }
      kept.push(head);
      this.entries = kept;
      this.bytes = kept.reduce((acc, e) => acc + e.bytes, 0);
    }
    // Ring mode (or a budget smaller than two snapshots): drop the oldest until it fits, always keeping the head.
    while (this.bytes > this.maxBytes && this.entries.length > 1) this.bytes -= this.entries.shift()!.bytes;
  }
}

function typedBytes(a: unknown): number {
  return ArrayBuffer.isView(a) ? a.byteLength : 0;
}

/** Approximate retained bytes of a snapshot (typed arrays dominate; objects are counted roughly). */
export function estimateSnapshotBytes(s: SimSnapshot): number {
  let b = 2048;
  const f = s.fire;
  if (f) for (const k of ['arrivalTime', 'burnState', 'ros', 'intensity', 'flameHeight', 'spreadDir', 'driver', 'phase'] as const) b += typedBytes(f[k]);
  b += typedBytes(s.moisture);
  b += typedBytes(s.embers?.data);
  const a = s.atmosphere;
  if (a) for (const k of ['levels', 'terrainHeight', 'surfaceU', 'surfaceV', 'u', 'v', 'w', 'thetaAnomaly', 'smoke'] as const) b += typedBytes(a[k]);
  if (s.layers) for (const v of Object.values(s.layers)) b += typedBytes(v);
  b += (s.spotFires?.length ?? 0) * 64 + (s.insights?.length ?? 0) * 1024;
  return b;
}
