/**
 * Ember statistics and overlay rasters (spec §9.5 overlays, §2.2 `EmberStats`, §10.2 spotting / embers-exit cards).
 *
 * - `RollingWindow`: 10 × 60 s bins of weighted counters and maxima, so "last 10 min" quantities are exact to one
 *   bin and deterministic (keyed by simulation time, never wall-clock).
 * - `DecayRaster`: fire-grid raster decayed with τ = 10 min. Decay is applied lazily per cell (value and last-update
 *   time), so a deposit costs one `exp` and a snapshot read costs one pass over the grid.
 */

/** Indices of the per-bin scalar counters. */
export const WIN = Object.freeze({
  /** ΣW of all landings inside the domain. */
  landings: 0,
  /** Number of spot ignitions (onIgnite calls). */
  ignitions: 1,
  /** ΣW of landings inside the exclusion zone (short-range spotting). */
  shortRange: 2,
  /** ΣW of ignition-capable landings (p ≥ 0.05). */
  capable: 3,
  /** ΣW of all brands leaving the domain. */
  exits: 4,
  /** ΣW of brands leaving the domain that land alive and ignition-capable under the ambient moisture. */
  exitAlive: 5,
  /** ΣW·P_ig(ambient M) of brands leaving the domain that land alive. */
  exitExpected: 6,
  count: 7,
})

export class RollingWindow {
  readonly sums: Float64Array;
  readonly maxDist: Float64Array;
  readonly hist: Float64Array;
  private curBin = -1;

  constructor(
    readonly binSeconds: number,
    readonly bins: number,
    readonly histBins: number,
  ) {
    this.sums = new Float64Array(bins * WIN.count);
    this.maxDist = new Float64Array(bins);
    this.hist = new Float64Array(bins * histBins);
  }

  /** Move the window forward to simulation time t (s), clearing bins that fell out of it. Never moves back. */
  advance(t: number): void {
    const b = Math.floor(t / this.binSeconds);
    if (this.curBin < 0 || b - this.curBin >= this.bins) {
      if (this.curBin >= 0) {
        this.sums.fill(0);
        this.maxDist.fill(0);
        this.hist.fill(0);
      }
      this.curBin = b;
      return;
    }
    while (this.curBin < b) {
      this.curBin++;
      this.clearSlot(this.slot(this.curBin));
    }
  }

  /** Slot of time t (advancing the window when t is newer), or −1 when t is older than the window. */
  private slotFor(t: number): number {
    const b = Math.floor(t / this.binSeconds);
    if (this.curBin < 0 || b > this.curBin) this.advance(t);
    if (this.curBin - b >= this.bins) return -1;
    return this.slot(b);
  }

  private slot(b: number): number {
    return ((b % this.bins) + this.bins) % this.bins;
  }

  private clearSlot(s: number): void {
    this.sums.fill(0, s * WIN.count, (s + 1) * WIN.count);
    this.maxDist[s] = 0;
    this.hist.fill(0, s * this.histBins, (s + 1) * this.histBins);
  }

  add(t: number, field: number, v: number): void {
    const s = this.slotFor(t);
    if (s < 0) return;
    this.sums[s * WIN.count + field]! += v;
  }

  max(t: number, d: number): void {
    const s = this.slotFor(t);
    if (s < 0) return;
    if (d > this.maxDist[s]!) this.maxDist[s] = d;
  }

  addHist(t: number, bin: number, v: number): void {
    const s = this.slotFor(t);
    if (s < 0) return;
    this.hist[s * this.histBins + bin]! += v;
  }

  total(field: number): number {
    let a = 0;
    for (let s = 0; s < this.bins; s++) a += this.sums[s * WIN.count + field]!;
    return a;
  }

  maxTotal(): number {
    let a = 0;
    for (let s = 0; s < this.bins; s++) if (this.maxDist[s]! > a) a = this.maxDist[s]!;
    return a;
  }

  histTotal(out: Float32Array): Float32Array {
    out.fill(0);
    for (let s = 0; s < this.bins; s++) for (let b = 0; b < this.histBins; b++) out[b]! += this.hist[s * this.histBins + b]!;
    return out;
  }

  checkpoint(): { cur: number; sums: Float64Array; maxDist: Float64Array; hist: Float64Array } {
    return { cur: this.curBin, sums: this.sums.slice(), maxDist: this.maxDist.slice(), hist: this.hist.slice() };
  }

  restore(c: { cur: number; sums: Float64Array; maxDist: Float64Array; hist: Float64Array }): void {
    this.curBin = c.cur;
    this.sums.set(c.sums);
    this.maxDist.set(c.maxDist);
    this.hist.set(c.hist);
  }
}

/** Fire-grid raster with exponential decay τ applied lazily per cell. */
export class DecayRaster {
  readonly value: Float32Array;
  private readonly last: Float64Array;

  constructor(
    n: number,
    readonly tau: number,
  ) {
    this.value = new Float32Array(n);
    this.last = new Float64Array(n);
  }

  add(k: number, v: number, t: number): void {
    const dt = t - this.last[k]!;
    const old = this.value[k]!;
    this.value[k] = (old !== 0 && dt > 0 ? old * Math.exp(-dt / this.tau) : old) + v;
    this.last[k] = t;
  }

  /** Decay every cell to time t and return the raster (live buffer). */
  at(t: number): Float32Array {
    const v = this.value;
    const l = this.last;
    for (let k = 0; k < v.length; k++) {
      const x = v[k]!;
      if (x !== 0) {
        const dt = t - l[k]!;
        if (dt > 0) {
          const y = x * Math.exp(-dt / this.tau);
          v[k] = y < 1e-12 ? 0 : y;
        }
      }
      l[k] = t;
    }
    return v;
  }

  /** Sparse checkpoint (indices, values, times of non-zero cells). */
  checkpoint(): { idx: Int32Array; val: Float32Array; last: Float64Array } {
    let n = 0;
    for (let k = 0; k < this.value.length; k++) if (this.value[k] !== 0) n++;
    const idx = new Int32Array(n);
    const val = new Float32Array(n);
    const last = new Float64Array(n);
    let j = 0;
    for (let k = 0; k < this.value.length; k++) {
      if (this.value[k] !== 0) {
        idx[j] = k;
        val[j] = this.value[k]!;
        last[j] = this.last[k]!;
        j++;
      }
    }
    return { idx, val, last };
  }

  restore(c: { idx: Int32Array; val: Float32Array; last: Float64Array }): void {
    this.value.fill(0);
    this.last.fill(0);
    for (let j = 0; j < c.idx.length; j++) {
      this.value[c.idx[j]!] = c.val[j]!;
      this.last[c.idx[j]!] = c.last[j]!;
    }
  }
}
