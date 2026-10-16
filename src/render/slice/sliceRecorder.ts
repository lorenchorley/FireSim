/**
 * The time-lapse recorder of one Air slice line (pure; 0.4.1, plan 8.6 and decision D7). It keeps the slice of a hand-placed line as
 * tiny integer samples (core/sliceRecording.ts: 48.7 kB a sample on a 90 x 54 lattice of the 3-D air, 29.3 kB on the diagnosed wind) at the
 * times the simulation made a picture, and gives the side view the air of the time shown instead of the older air a composed picture
 * carries. It holds no snapshot, never reads one back and never changes anything it is given: the simulation cannot depend on it.
 *
 * What it keeps. One EPOCH: the line (its key to 0.1 m) and the lattice it is sampled on, with the parts that never change from one
 * sample to the next (`valid`, `ground`, `modelGround`, the height axis), made once from the first sample. A sample whose lattice differs
 * (the high tier has a finer model grid) starts a new epoch. Then a list of samples in ascending time, each tagged with its `kind`, its
 * own time and the time of the air it was made from.
 *
 * Time order. The simulation can re-run from an earlier time (an edit, a what-if, a tier switch, a rewind): `arrive(t)` is called for
 * every snapshot and drops every sample at or after `t` first, exactly as `SnapshotStore.push` does for the history; `truncateAfter`
 * is the session's cut at the five places it cuts the history.
 *
 * Thinning, uniform. A fixed number of bytes holds a fixed number of samples, so when a sample would go over the budget every second
 * sample goes and the gap that `arrive` asks for between samples doubles (`spacingS`). The first and the newest sample always stay;
 * the stored times are always a subset of the arrival times. The newest sample takes the place of the last one kept when it is the
 * one that would have gone, so no two samples are ever closer than the gap (contract 2.4 added the newest after the last kept one,
 * which leaves a closer pair that a later thinning then keeps in the middle of the list). The dropped arrays go to a free list for the
 * next sample of their size, so a steady stream allocates no arrays.
 */
import { packField, packSmoke, SLICE_RECORDER_MAX_BYTES, SLICE_SAMPLE_FIXED_BYTES, unpackField, unpackSmoke, type RecordedKind } from '../../core/sliceRecording';
import type { SectionLine } from '../atmosphereSampler';
import { SLICE_FIELD_IDS, type RecordingDrop, type SliceData, type SliceFieldId, type SliceKind, type SlicePoint, type SliceRecordingReader, type SliceRecordingStatus } from './types';

/** The key of a line: both ends to 0.1 m. The same key keeps a recording, another one drops it. */
export function sliceLineKey(line: { a: SlicePoint; b: SlicePoint }): string {
  return `${Math.round(line.a[0] * 10)},${Math.round(line.a[1] * 10)};${Math.round(line.b[0] * 10)},${Math.round(line.b[1] * 10)}`;
}

/** A picture older than the air of the sample by at most this (s) is as good as the sample: the live air wins a tie. */
const NEWER_THAN_PICTURE_S = 0.5;
/** Two arrivals are `gap` apart when they are at least this near to it (s): float noise in times that are sums of steps. */
const GAP_TOLERANCE_S = 1e-6;
/** A lattice is the same one when its height axis agrees to this (m) and its model ground to `MODEL_GROUND_TOLERANCE_M`. */
const AXIS_TOLERANCE_M = 0.01;
const MODEL_GROUND_TOLERANCE_M = 0.5;
/** Bytes of the epoch's own bookkeeping (its object and the line), on top of its arrays. */
const EPOCH_FIXED_BYTES = 192;

interface Sample {
  time: number;
  /** `AtmosphereView.time` of the air the sample was made from; NaN when the view did not say. */
  airTime: number;
  kind: RecordedKind;
  hasTheta: boolean;
  hasSmoke: boolean;
  /** along, across, up, then theta and smoke where the air has them: `columns x rows` integers each. */
  q: Int16Array;
  /** The quantum of along, across, up and theta. */
  scale: Float32Array;
  bytes: number;
}

/** What every sample of one line on one lattice shares. */
interface Epoch {
  columns: number;
  rows: number;
  zMin: number;
  zMax: number;
  topAsl: number;
  cellSizeM: number;
  line: SectionLine;
  valid: Uint8Array;
  ground: Float32Array;
  modelGround: Float32Array;
  bytes: number;
}

function sameLattice(e: Epoch, d: SliceData): boolean {
  if (e.columns !== d.columns || e.rows !== d.rows) return false;
  if (Math.abs(e.zMin - d.zMin) > AXIS_TOLERANCE_M || Math.abs(e.zMax - d.zMax) > AXIS_TOLERANCE_M || Math.abs(e.topAsl - d.topAsl) > AXIS_TOLERANCE_M) return false;
  if (Math.abs(e.cellSizeM - d.cellSizeM) > AXIS_TOLERANCE_M) return false;
  for (let c = 0; c < e.columns; c++) if (Math.abs(e.modelGround[c]! - d.modelGround[c]!) > MODEL_GROUND_TOLERANCE_M) return false;
  return true;
}

function makeEpoch(d: SliceData): Epoch {
  const valid = d.valid.slice(0, d.columns * d.rows);
  const ground = d.ground.slice(0, d.columns);
  const modelGround = d.modelGround.slice(0, d.columns);
  const l = d.line;
  return {
    columns: d.columns,
    rows: d.rows,
    zMin: d.zMin,
    zMax: d.zMax,
    topAsl: d.topAsl,
    cellSizeM: d.cellSizeM,
    line: { a: [l.a[0], l.a[1]], b: [l.b[0], l.b[1]], dir: [l.dir[0], l.dir[1]], length: l.length },
    valid,
    ground,
    modelGround,
    bytes: valid.byteLength + ground.byteLength + modelGround.byteLength + EPOCH_FIXED_BYTES,
  };
}

/** A `SliceData` of this lattice with nothing in it yet (the shape `sampleSlice` makes, so that it can refill one this made). */
function allocSliceData(e: Epoch): SliceData {
  const n = e.columns * e.rows;
  const values = {} as Record<SliceFieldId, Float32Array>;
  for (const id of SLICE_FIELD_IDS) values[id] = new Float32Array(n);
  return {
    seq: 0,
    kind: 'prognostic',
    line: e.line,
    columns: e.columns,
    rows: e.rows,
    zMin: e.zMin,
    zMax: e.zMax,
    topAsl: e.topAsl,
    values,
    valid: new Uint8Array(n),
    ground: new Float32Array(e.columns),
    modelGround: new Float32Array(e.columns),
    has: { wind: true, theta: false, smoke: false },
    cellSizeM: e.cellSizeM,
    cells: null,
    airTime: null,
    shownTime: 0,
  };
}

export class SliceRecorder implements SliceRecordingReader {
  private budget: number;
  private lineKey: string | null = null;
  private offFor: 'preset' | 'chord' | null = null;
  private epoch: Epoch | null = null;
  private samples: Sample[] = [];
  private sampleBytes = 0;
  /** The least spacing (s) `arrive` accepts between two samples: 0 until the first thinning, then doubled by each. */
  private gap = 0;
  private dropped: RecordingDrop | null = null;
  /** Arrays of dropped samples by length, for the next sample of that size. Held to what the budget leaves room for. */
  private free = new Map<number, Int16Array[]>();
  private freeBytes = 0;

  constructor(opts: { budgetBytes?: number } = {}) {
    this.budget = opts.budgetBytes ?? SLICE_RECORDER_MAX_BYTES;
  }

  /** Bytes held now: the samples and the epoch (not the free list, which only refills what the budget already allows). */
  get bytes(): number {
    return this.epoch ? this.epoch.bytes + this.sampleBytes : 0;
  }

  get count(): number {
    return this.samples.length;
  }

  get budgetBytes(): number {
    return this.budget;
  }

  /**
   * The line to record (null: none, and `offFor` says why when a line is shown but cannot be recorded). The same key keeps the samples;
   * another key, or null, drops them (`dropped: 'line'`, only when there was something to drop).
   */
  setLine(key: string | null, offFor: 'preset' | 'chord' | null = null): void {
    if (key !== this.lineKey) {
      const had = this.samples.length > 0;
      this.drop('line');
      if (!had) this.dropped = null; // nothing was lost: this line has no earlier recording to speak of
      this.lineKey = key;
    }
    this.offFor = key === null ? offFor : null;
  }

  /** A new budget (the session says how much room the history has): thins at once when the recording is over it. */
  setBudget(bytes: number): void {
    this.budget = Math.max(0, bytes);
    this.fit();
  }

  /**
   * A snapshot at `t` arrives. Drops every sample at or after `t` (time order, as `SnapshotStore.push` does), then says whether a
   * sample is wanted: the first one, or one at least `gap` after the newest.
   */
  arrive(t: number): boolean {
    if (!Number.isFinite(t)) return false;
    this.truncateFrom(t);
    if (this.lineKey === null) return false;
    const n = this.samples.length;
    return n === 0 || t - this.samples[n - 1]!.time >= this.gap - GAP_TOLERANCE_S;
  }

  /**
   * Pack `d` (a slice sampled from the line that is recorded) as the sample at `t` and thin while the recording is over its budget.
   * Does not keep `d`. A lattice other than the epoch's starts a new epoch (`dropped: 'model'`). Without a line, or when not even one
   * sample would fit the budget, nothing is stored.
   */
  store(d: SliceData, t: number): void {
    if (this.lineKey === null || !Number.isFinite(t)) return;
    this.truncateFrom(t); // this sample is the newest, whatever was asked of `arrive`
    if (this.epoch && !sameLattice(this.epoch, d)) this.drop('model');
    const n = d.columns * d.rows;
    const hasTheta = d.has.theta;
    const hasSmoke = d.has.smoke;
    const fields = 3 + (hasTheta ? 1 : 0) + (hasSmoke ? 1 : 0);
    const epoch = this.epoch ?? makeEpoch(d);
    const bytes = n * fields * 2 + SLICE_SAMPLE_FIXED_BYTES;
    if (this.samples.length === 0 && epoch.bytes + bytes > this.budget) return; // not even one sample fits
    this.epoch = epoch;

    const q = this.take(n * fields);
    const scale = new Float32Array(4);
    const v = d.values;
    scale[0] = packField(v.along, n, q, 0);
    scale[1] = packField(v.across, n, q, n);
    scale[2] = packField(v.up, n, q, 2 * n);
    let o = 3 * n;
    if (hasTheta) {
      scale[3] = packField(v.theta, n, q, o);
      o += n;
    }
    if (hasSmoke) packSmoke(v.smoke, n, q, o);
    this.samples.push({ time: t, airTime: d.airTime ?? NaN, kind: d.kind, hasTheta, hasSmoke, q, scale, bytes });
    this.sampleBytes += bytes;
    this.fit();
  }

  /**
   * The slice of `line` at `shownTime` from the recording, refilled into `out` when it has this lattice, else null. Answers only for
   * the line that is recorded and for samples of `kind`: the newest sample at or before `shownTime`, and only when it is newer than the
   * air the picture itself carries (`pictureAirTime`, by more than half a second), so the real newest picture stays live and exact.
   */
  read(line: SectionLine, shownTime: number, kind: SliceKind, pictureAirTime: number | null, out: SliceData | null): SliceData | null {
    const e = this.epoch;
    const list = this.samples;
    if (!e || this.lineKey === null || list.length === 0 || !Number.isFinite(shownTime)) return null;
    // The newest sample at or before the time shown.
    let lo = 0;
    let hi = list.length - 1;
    if (list[0]!.time > shownTime + GAP_TOLERANCE_S) return null; // before the first sample
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (list[mid]!.time <= shownTime + GAP_TOLERANCE_S) lo = mid;
      else hi = mid - 1;
    }
    const s = list[lo]!;
    if (s.kind !== kind) return null;
    if (!(s.time > (pictureAirTime ?? -Infinity) + NEWER_THAN_PICTURE_S)) return null;
    if (sliceLineKey(line) !== this.lineKey) return null;
    return this.fill(e, s, line, shownTime, out);
  }

  /** The times (s) of the samples held, ascending: what the recording covers, for the words of the status and for tests. */
  sampleTimes(): number[] {
    return this.samples.map((s) => s.time);
  }

  /** Keep the samples at or before `t`. */
  truncateAfter(t: number): void {
    this.cut((time) => time > t);
  }

  /** Drop the samples at or after `t`. */
  truncateFrom(t: number): void {
    this.cut((time) => time >= t);
  }

  /** Drop every sample: the person's Clear recording (`why` 'cleared'), or a silent reset (null). The line stays. */
  clear(why: RecordingDrop | null = 'cleared'): void {
    this.drop(why);
    this.free.clear();
    this.freeBytes = 0;
  }

  /** Forget everything, line included, without a word: the slice was switched off or the scenario changed. */
  reset(): void {
    this.clear(null);
    this.lineKey = null;
    this.offFor = null;
    this.dropped = null;
  }

  status(): SliceRecordingStatus {
    const n = this.samples.length;
    return {
      state: this.lineKey === null ? 'off' : n === 0 ? 'waiting' : 'recording',
      offFor: this.offFor,
      count: n,
      from: n ? this.samples[0]!.time : null,
      to: n ? this.samples[n - 1]!.time : null,
      spacingS: this.gap,
      bytes: this.bytes,
      budgetBytes: this.budget,
      dropped: this.dropped,
    };
  }

  // ───────────────────────────── internals ─────────────────────────────

  /** Drop the newest samples while `stale(time)`; a recording with none left has no epoch and starts again at every sample. */
  private cut(stale: (time: number) => boolean): void {
    const list = this.samples;
    while (list.length && stale(list[list.length - 1]!.time)) this.release(list.pop()!);
    if (list.length === 0) {
      this.epoch = null;
      this.gap = 0;
    }
  }

  /** Drop all samples (and the free list: another line or lattice is another size) with the reason the status gives (`null`: none, and the earlier reason goes too). */
  private drop(why: RecordingDrop | null): void {
    const had = this.samples.length > 0;
    this.samples.length = 0;
    this.sampleBytes = 0;
    this.epoch = null;
    this.gap = 0;
    this.free.clear();
    this.freeBytes = 0;
    if (why === null) this.dropped = null;
    else if (had) this.dropped = why;
  }

  /** A sample leaves the list: its bytes go and its array waits for the next one, if the budget has room for it as well. */
  private release(s: Sample): void {
    this.sampleBytes -= s.bytes;
    const room = this.budget - this.bytes - this.freeBytes;
    if (s.q.byteLength > room) return;
    let list = this.free.get(s.q.length);
    if (!list) this.free.set(s.q.length, (list = []));
    list.push(s.q);
    this.freeBytes += s.q.byteLength;
  }

  private take(length: number): Int16Array {
    const q = this.free.get(length)?.pop();
    if (!q) return new Int16Array(length);
    this.freeBytes -= q.byteLength;
    return q;
  }

  /** Thin while over the budget. */
  private fit(): void {
    while (this.bytes > this.budget && this.samples.length > 0) {
      if (this.samples.length === 1) this.drop(null); // a budget under one sample holds nothing
      else this.thin();
    }
  }

  /**
   * Every second sample goes (position 0, the first, stays) and the gap doubles. The newest stays too: when it would have gone it takes
   * the place of the last one kept, so every two samples are at least the new gap apart. With two samples left the first goes (a budget
   * under two samples keeps the newest).
   */
  private thin(): void {
    const list = this.samples;
    const n = list.length;
    let g = this.gap;
    if (!(g > 0)) {
      // The first thinning: the gap is twice the TYPICAL (median) spacing the arrivals made. The least spacing would let one picture a few
      // seconds after another (the run-end picture of a pause) set it far under the real spacing, and the status would say "about every 20 s"
      // of a recording whose pictures are 2 min apart, for as long as it lasts: every later thinning doubles the gap and the real spacing alike.
      const spacing: number[] = [];
      for (let i = 1; i < n; i++) spacing.push(list[i]!.time - list[i - 1]!.time);
      spacing.sort((a, b) => a - b);
      g = spacing[spacing.length >> 1]!;
    }
    this.gap = 2 * g;
    if (n === 2) {
      this.release(list.shift()!);
      return;
    }
    const newestOdd = n % 2 === 0; // the newest sits at an odd position
    let w = 0;
    for (let i = 0; i < n; i++) {
      const s = list[i]!;
      if (i === n - 1 && newestOdd) list[w++] = s;
      else if (i === n - 2 && newestOdd) this.release(s);
      else if (i % 2 === 1) this.release(s);
      else list[w++] = s;
    }
    list.length = w;
    this.spread();
  }

  /**
   * Arrivals that were not evenly spaced leave pairs closer than the new gap after the halving (a picture a few seconds after another).
   * The later of such a pair goes, or the earlier one when the later is the newest, so every two samples stay at least the gap apart.
   */
  private spread(): void {
    const list = this.samples;
    const need = this.gap - GAP_TOLERANCE_S;
    let w = 1; // the first stays
    for (let i = 1; i < list.length; i++) {
      const s = list[i]!;
      if (s.time - list[w - 1]!.time >= need) list[w++] = s;
      else if (i < list.length - 1) this.release(s);
      else if (w > 1) {
        this.release(list[w - 1]!); // the newest takes the place of the last one kept
        list[w - 1] = s;
      } else list[w++] = s; // only the first and the newest are left: both stay
    }
    list.length = w;
  }

  /** Make `out` (or a new one of the epoch's lattice) the slice of sample `s`. */
  private fill(e: Epoch, s: Sample, line: SectionLine, shownTime: number, out: SliceData | null): SliceData {
    const n = e.columns * e.rows;
    const d = out && out.columns === e.columns && out.rows === e.rows ? out : allocSliceData(e);
    d.seq = (out?.seq ?? 0) + 1;
    d.kind = s.kind;
    d.recordedAt = s.time;
    d.line = line;
    d.zMin = e.zMin;
    d.zMax = e.zMax;
    d.topAsl = e.topAsl;
    d.cellSizeM = e.cellSizeM;
    d.has.wind = true;
    d.has.theta = s.hasTheta;
    d.has.smoke = s.hasSmoke;
    d.cells = null; // the model's own cells are not recorded
    d.airTime = Number.isNaN(s.airTime) ? null : s.airTime;
    d.shownTime = shownTime;
    d.valid.set(e.valid);
    d.ground.set(e.ground);
    d.modelGround.set(e.modelGround);
    const v = d.values;
    unpackField(s.q, 0, n, s.scale[0]!, v.along);
    unpackField(s.q, n, n, s.scale[1]!, v.across);
    unpackField(s.q, 2 * n, n, s.scale[2]!, v.up);
    const along = v.along;
    const across = v.across;
    const speed = v.speed;
    for (let i = 0; i < n; i++) speed[i] = Math.sqrt(along[i]! * along[i]! + across[i]! * across[i]!);
    let o = 3 * n;
    if (s.hasTheta) {
      unpackField(s.q, o, n, s.scale[3]!, v.theta);
      o += n;
    } else v.theta.fill(0);
    if (s.hasSmoke) unpackSmoke(s.q, o, n, v.smoke);
    else v.smoke.fill(0);
    return d;
  }
}
