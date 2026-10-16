/**
 * Compact, exact history of simulation snapshots for the time scrubber ("jump to any time").
 *
 * A snapshot can be several MB (a 300 × 300 fire grid is ~2 MB, plus moisture, overlay rasters and the atmosphere
 * view), and with a display step of 10–60 s a long run produces thousands of them. Keeping them whole is impossible
 * and thinning them uniformly would make the finer step pointless, so the history is split by what changes:
 *
 *  - FIRE. arrivalTime, ros, intensity, flameHeight, spreadDir, driver and phase are per-cell values fixed at
 *    ignition. The fire field at any earlier time t is therefore rebuilt from the NEWEST fire arrays: a cell whose
 *    arrival is later than t is unburnt again (arrival +Infinity); the other arrays are shared by reference (consumers
 *    read them only where the arrival is finite). The burn state (Burning until the cell burns out, then BurntOut) is
 *    derived from one Float32 per cell, the burn-out time, which the store notes when it first sees a cell burnt out
 *    (the midpoint of the step it happened in; {@link FLAME_BAND_S} when there is no earlier snapshot to bracket it),
 *    so at every snapshot time the state equals the true one. Older snapshots keep NO fire arrays, so scrubbing shows
 *    the exact front at ANY time, independent of the snapshot cadence, at the cost of two scratch buffers. After a
 *    rewind the worker re-simulates deterministically from a checkpoint, and the new newest arrays are authoritative
 *    for earlier times too (the edit applies from the rewind time on).
 *  - KEYFRAMES (default every 300 s, or the display step if larger): moisture, overlay rasters and the atmosphere
 *    view. The composed snapshot for a time uses the nearest keyframe at or before it.
 *  - EVERY STEP keeps a light frame: time, stats and the number of spot fires (the spot fires themselves live in one
 *    append-only log shared by all frames); embers (up to 64 KB each) are kept per step too, but thinned first.
 *  - WIND VOLUMES. The fast tier's diagnosed 3-D wind (u, v, w; 12 bytes per cell, 486 kB at 45 x 45 x 20) is not kept in the
 *    keyframes: a keyframe holds the rest of the air view and the volume goes to a list of its own, packed to 16-bit integers
 *    (airPack.ts: 6 bytes per cell, within 0.0005 m/s of the exact wind at 30 m/s). The list has its own share of the budget, so
 *    a volume never costs a picture, and is thinned on its own. A picture takes the newest saved volume at or before its time,
 *    stamped with that volume's own time, so the slice footer says how much older than the picture the air is.
 *    The newest snapshot and the views of the 3-D tiers are kept exact.
 *
 * Memory. The total is kept under `maxBytes`: when a list is over its share, older history is thinned first (an entry
 * survives when it is at least age / R after the previous kept one, R shrinking until it fits), so recent history
 * stays fine. The first entry of every list and the newest snapshot are never dropped.
 *
 * Views. {@link SnapshotStore.at} returns a full {@link SimSnapshot}:
 *  - the real newest snapshot when t is at or after its time;
 *  - otherwise a composition of the keyframe, the light frame and the reconstructed fire for time t. With a
 *    `quantum` (used while playing; {@link SnapshotStore.atOrBefore} uses min(display step, 30 s)) t is rounded down
 *    to it, and the SAME object is returned for every call in the same quantum, so the caller only updates the view
 *    when something changed. Composition alternates between two fire buffers: a composed snapshot stays valid until
 *    the second next composition (SceneView.update copies what it needs synchronously; it keeps the fire only for
 *    later derived reads, never past the next update). Only one caller (the session) should compose.
 *
 * A snapshot at or before existing ones (the worker re-simulated after a rewind) invalidates them, as do
 * {@link truncateAfter} / {@link truncateFrom}.
 */
import { airHas, airKind } from '../core/airView';
import { packedWindBytes, packWind, unpackWind, type PackedWind } from '../core/airPack';
import { BurnState, type AtmosphereView, type EmberParticles, type FireField, type SimSnapshot, type SimStats, type SpotFire } from '../core/types';

/** Burning band (s) after a cell's arrival when its burn-out cannot be bracketed (the renderer's uBurnBand in terrainLayer.ts). */
export const FLAME_BAND_S = 420;

/** Cap (s) of the composition quantum: pictures for playback are at most this far apart in time. */
export const MAX_QUANTUM_S = 30;

export interface SnapshotStoreOptions {
  /** Memory budget (bytes). Default 150 MB. */
  maxBytes?: number;
  /** Display step (s): the spacing of the snapshots the worker produces (also see {@link SnapshotStore.setStep}). Default 60 s. */
  minInterval?: number;
  /** Simulated seconds between keyframes (raised to the display step). Default 300 s. */
  keyInterval?: number;
}

/** Retained bytes of a light frame (stats object, bookkeeping). */
const FRAME_BYTES = 1024;
const SPOT_BYTES = 96;
const EPS = 1e-6;

interface Frame {
  time: number;
  stats: SimStats;
  spotCount: number;
  bytes: number;
}

interface Keyframe {
  time: number;
  moisture: Float32Array;
  atmosphere: AtmosphereView | undefined;
  layers: Record<string, Float32Array> | undefined;
  bytes: number;
}

interface EmberFrame {
  time: number;
  embers: EmberParticles;
  bytes: number;
}

/** The packed diagnosed wind of the picture at `time` (`airTime`: the air view's own stamp, when it had one). */
interface WindFrame {
  time: number;
  airTime: number | undefined;
  wind: PackedWind;
  bytes: number;
}

interface FireBuffer {
  arrival: Float32Array;
  burnState: Uint8Array;
}

/** Share of the budget left after the newest snapshot: keyframes, embers, light frames and the spot log. */
const SHARE = { keys: 0.72, embers: 0.2, frames: 0.08 } as const;
/**
 * The same shares while the history holds wind volumes. The keyframes and the light frames keep their shares exactly (a volume
 * never takes a picture's room); the volumes take theirs from the embers, which are thinned first anyway. 4 % of the room is 7 to
 * 10 volumes at 48 to 64 MiB: with the thinning by age, the oldest picture of a 6 h run has air 2 to 4 h older (the slice footer says).
 */
const SHARE_WIND = { keys: 0.72, wind: 0.04, embers: 0.16, frames: 0.08 } as const;

/** The wind arrays of a keyframe's air view when its volume is kept in the wind list. */
const NO_WIND = new Float32Array(0);

export class SnapshotStore {
  private frames: Frame[] = [];
  private keys: Keyframe[] = [];
  private embs: EmberFrame[] = [];
  private winds: WindFrame[] = [];
  private keyBytes = 0;
  private embBytes = 0;
  private windBytes = 0;
  /** The budget has been reached once: from then on the wind list is held to its share at every step (see `enforceBudget`). */
  private pressed = false;
  /** The volume last restored for a picture (Float32, 12 bytes per cell), so scrubbing inside one stretch of air restores it once. */
  private windCache: { src: PackedWind; u: Float32Array; v: Float32Array; w: Float32Array } | null = null;
  /** The real newest snapshot (null after a truncation until the next push). */
  private head: SimSnapshot | null = null;
  private headBytes = 0;
  /** The newest snapshot's engine info (SimSnapshot.engine), kept through truncations: composed pictures carry it. */
  private engine: SimSnapshot['engine'];
  /** Where the fire is rebuilt from: the newest snapshot's fire, or the stale one of a truncated head. */
  private fireSrc: FireField | null = null;
  private fireSrcBytes = 0;
  /** Per fire cell: the time it burnt out (Infinity while it was still burning in the newest snapshot). */
  private burnEnd: Float32Array | null = null;
  private readonly spotLog: SpotFire[] = [];
  private readonly bufs: [FireBuffer | null, FireBuffer | null] = [null, null];
  private nextBuf = 0;
  private gen = 0;
  private cache: { gen: number; t: number; q: number; snap: SimSnapshot } | null = null;
  private step: number;
  private keyEvery: number;
  private keyBase: number;
  /**
   * History was just cut (a rewind: an edit, a what-if, an atmosphere tier change): the next snapshot to be demoted
   * becomes a keyframe whatever the spacing, so the moisture, layers and atmosphere shown for the times just re-run come
   * from the new run and not from a keyframe of the old one that is up to a whole key interval earlier.
   */
  private keyDue = false;
  /** How many times older history was actually thinned to stay inside the budget (0 until the budget is first reached). */
  private thinned = 0;
  readonly maxBytes: number;

  constructor(opts: SnapshotStoreOptions = {}) {
    this.maxBytes = opts.maxBytes ?? 150 * 1024 * 1024;
    this.step = Math.max(1e-3, opts.minInterval ?? 60);
    this.keyBase = Math.max(1e-3, opts.keyInterval ?? 300);
    this.keyEvery = Math.max(this.keyBase, this.step);
  }

  // ───────────────────────────── inspection ─────────────────────────────

  /** Number of retained steps (light frames, one per snapshot the worker produced, thinned when old and over budget). */
  get size(): number {
    return this.frames.length;
  }

  /** Number of retained full pictures (keyframes). */
  get keyframeCount(): number {
    return this.keys.length;
  }

  /** Bytes held (the newest snapshot, keyframes, wind volumes, embers, light frames, the spot log and the scratch buffers). */
  get totalBytes(): number {
    return this.headBytes + this.fireSrcBytes + this.keyBytes + this.windBytes + this.embBytes + this.frames.length * FRAME_BYTES + this.spotLog.length * SPOT_BYTES + this.bufBytes() + (this.burnEnd?.byteLength ?? 0);
  }

  /** Bytes of the newest snapshot and of the keyframes (the debug statistics show them next to the total). */
  get newestBytes(): number {
    return this.headBytes;
  }

  /** Bytes of the keyframes with the wind volumes they carry. */
  get keyframeBytes(): number {
    return this.keyBytes + this.windBytes;
  }

  /** Number of retained wind volumes (the fast tier's diagnosed 3-D wind of older pictures; none for the 3-D tiers, which keep their air in the keyframes). */
  get windFrameCount(): number {
    return this.winds.length;
  }

  /** Times (ascending) of the retained wind volumes. */
  windFrameTimes(): number[] {
    return this.winds.map((w) => w.time);
  }

  /** How many times older history was thinned because the budget was reached (the "history memory is full" event reads it; a sparse early history is not thinning). */
  get thinnedCount(): number {
    return this.thinned;
  }

  /** Mean spacing (s) of the retained steps: the display step until old history has been thinned. */
  get spacing(): number {
    const n = this.frames.length;
    return n > 1 ? (this.frames[n - 1]!.time - this.frames[0]!.time) / (n - 1) : this.step;
  }

  /** Mean spacing (s) of the retained keyframes. */
  get keyframeSpacing(): number {
    const n = this.keys.length;
    return n > 1 ? (this.keys[n - 1]!.time - this.keys[0]!.time) / (n - 1) : this.keyEvery;
  }

  /** The display step (s) the store expects. */
  get displayStep(): number {
    return this.step;
  }

  /** Times (ascending) of the retained steps. */
  times(): number[] {
    return this.frames.map((f) => f.time);
  }

  /** Times (ascending) of the retained keyframes. */
  keyframeTimes(): number[] {
    return this.keys.map((k) => k.time);
  }

  /** Earliest and latest retained time, or null if empty. */
  range(): { start: number; end: number } | null {
    const n = this.frames.length;
    return n ? { start: this.frames[0]!.time, end: this.frames[n - 1]!.time } : null;
  }

  /** Time and stats of every retained step, ascending (the what-if baseline, the weather chart's observations). */
  all(): { time: number; stats: SimStats }[] {
    return this.frames.map((f) => ({ time: f.time, stats: f.stats }));
  }

  /** Time of the newest retained step, or null if empty (cheap: composes nothing). */
  headTime(): number | null {
    const n = this.frames.length;
    return n ? this.frames[n - 1]!.time : null;
  }

  /**
   * The newest snapshot (the real one, or a composition for the last retained time after a truncation — which uses one
   * of the two rotating buffers: use {@link headTime} when only the time is needed).
   */
  latest(): SimSnapshot | null {
    const n = this.frames.length;
    if (!n) return null;
    return this.head ?? this.compose(this.frames[n - 1]!.time, 0);
  }

  /** The display step changed (the worker produces snapshots at the new spacing from now on). */
  setStep(seconds: number): void {
    if (!(seconds > 0)) return;
    this.step = seconds;
    this.keyEvery = Math.max(this.keyBase, seconds);
    this.cache = null;
  }

  // ───────────────────────────── writing ─────────────────────────────

  /** Add a snapshot. A snapshot at or before existing ones invalidates them (re-simulation after a rewind). */
  push(snap: SimSnapshot): boolean {
    if (!Number.isFinite(snap.time)) return false;
    this.truncateFrom(snap.time);
    if (this.head) this.demote(this.head);
    this.head = snap;
    if (snap.engine) this.engine = snap.engine;
    this.headBytes = estimateSnapshotBytes(snap);
    this.trackBurnOut(snap.fire, snap.time, this.frames.length ? this.frames[this.frames.length - 1]!.time : NaN);
    this.fireSrc = snap.fire ?? null;
    this.fireSrcBytes = 0;
    this.syncSpots(snap.spotFires ?? []);
    this.frames.push({ time: snap.time, stats: snap.stats, spotCount: snap.spotFires?.length ?? 0, bytes: FRAME_BYTES });
    this.enforceBudget();
    return true;
  }

  /** Drop everything after time t (the newest retained step becomes t or earlier). */
  truncateAfter(t: number): void {
    this.dropWhile((time) => time > t);
  }

  /** Drop everything at or after time t. */
  truncateFrom(t: number): void {
    this.dropWhile((time) => time >= t);
  }

  clear(): void {
    this.frames = [];
    this.keys = [];
    this.embs = [];
    this.winds = [];
    this.keyBytes = 0;
    this.embBytes = 0;
    this.windBytes = 0;
    this.pressed = false;
    this.windCache = null;
    this.head = null;
    this.engine = undefined;
    this.headBytes = 0;
    this.fireSrc = null;
    this.fireSrcBytes = 0;
    this.spotLog.length = 0;
    this.burnEnd = null;
    this.bufs[0] = this.bufs[1] = null;
    this.thinned = 0;
    this.cache = null;
    this.gen++;
  }

  // ───────────────────────────── reading ─────────────────────────────

  /**
   * The picture for time t, or null if empty. t at or after the newest time gives the newest snapshot; before the first
   * step gives the first. `quantum` (s, default 0 = the exact time) rounds t down to a multiple of it and returns the
   * same object for every call in the same quantum (see the class comment).
   */
  at(t: number, quantum = 0): SimSnapshot | null {
    const n = this.frames.length;
    if (n === 0) return null;
    const last = this.frames[n - 1]!.time;
    if (t >= last - EPS) return this.latest();
    return this.compose(Math.max(this.frames[0]!.time, t), quantum > 0 ? quantum : 0);
  }

  /** {@link at} with the time rounded down to the default quantum, min(display step, 30 s). */
  atOrBefore(t: number): SimSnapshot | null {
    return this.at(t, this.quantum);
  }

  /** The default composition quantum (s): min(display step, 30 s). */
  get quantum(): number {
    return Math.min(this.step, MAX_QUANTUM_S);
  }

  // ───────────────────────────── internals ─────────────────────────────

  private compose(t: number, quantum: number): SimSnapshot {
    const tq = quantum > 0 ? Math.max(this.frames[0]!.time, Math.floor(t / quantum + 1e-9) * quantum) : t;
    const c = this.cache;
    if (c && c.gen === this.gen && c.t === tq) return c.snap;
    const frame = this.frames[atOrBeforeIndex(this.frames, tq)]!;
    const key = this.keys[atOrBeforeIndex(this.keys, tq)] ?? this.keys[0];
    const head = this.head;
    const emb = nearest(this.embs, tq);
    const snap = {
      time: tq,
      fire: this.rebuildFire(tq),
      moisture: key?.moisture ?? head?.moisture,
      atmosphere: key ? this.airOf(key, tq) : head?.atmosphere,
      embers: emb?.embers ?? head?.embers ?? EMPTY_EMBERS,
      spotFires: this.spotLog.slice(0, frame.spotCount),
      stats: frame.stats,
      insights: [],
      layers: key ? key.layers : head?.layers,
      // The engine info describes the engine NOW (tier, grids, memory), so every picture carries the newest one.
      ...(this.engine ? { engine: this.engine } : {}),
    } as SimSnapshot;
    this.cache = { gen: this.gen, t: tq, q: quantum, snap };
    return snap;
  }

  /**
   * The air view of the picture at time t composed from `key`. A keyframe of the fast tier holds its air view without the wind
   * volume: the picture takes the newest saved volume at or before t, restored to Float32 (within airPack.ts's bound), and the
   * view's `time` becomes that volume's own, so "air from" and the age beyond AIR_STALE_S tell the truth. The surface wind, the
   * terrain, the layout and the datum stay the keyframe's own. With no volume to take (all thinned away, or one of another grid)
   * the view comes back as the keyframe holds it, with no wind (`hasAirWind` says so). Any other view is the keyframe's own, exact.
   */
  private airOf(key: Keyframe, t: number): AtmosphereView | undefined {
    const a = key.atmosphere;
    if (!a || airKind(a) !== 'diagnosed' || a.nz <= 0 || a.u.length > 0) return a;
    const wf = this.winds[atOrBeforeIndex(this.winds, t)];
    if (!wf || wf.time > t + EPS || wf.wind.count !== a.grid.nx * a.grid.ny * a.nz) return a;
    if (this.windCache?.src !== wf.wind) this.windCache = { src: wf.wind, ...unpackWind(wf.wind) };
    const c = this.windCache;
    return { ...a, u: c.u, v: c.v, w: c.w, ...(wf.airTime !== undefined ? { time: wf.airTime } : {}) };
  }

  /**
   * The fire field at time t from the newest arrays (see the class comment). Writes into one of two rotating buffers;
   * the returned field's other arrays are the source's own.
   */
  private rebuildFire(t: number): FireField {
    const src = this.fireSrc as FireField;
    if (!src || !src.arrivalTime || !src.burnState) return src;
    const n = src.arrivalTime.length;
    let buf = this.bufs[this.nextBuf];
    if (!buf || buf.arrival.length !== n) buf = this.bufs[this.nextBuf] = { arrival: new Float32Array(n), burnState: new Uint8Array(n) };
    this.nextBuf ^= 1;
    const A = src.arrivalTime;
    const B = src.burnState;
    const arr = buf.arrival;
    const bs = buf.burnState;
    const end = this.burnEnd;
    for (let k = 0; k < n; k++) {
      const a = A[k]!;
      if (a <= t) {
        arr[k] = a;
        bs[k] = end ? (t < end[k]! ? BurnState.Burning : BurnState.BurntOut) : B[k]!;
      } else {
        arr[k] = Infinity;
        bs[k] = B[k] === BurnState.NonFlammable ? BurnState.NonFlammable : BurnState.Unburnt;
      }
    }
    return { grid: src.grid, arrivalTime: arr, burnState: bs, ros: src.ros, intensity: src.intensity, flameHeight: src.flameHeight, spreadDir: src.spreadDir, driver: src.driver, phase: src.phase };
  }

  /** Let go of the restored volume once the saved one it came from is gone (thinned, or cut by a rewind): it would keep both in memory. */
  private forgetStaleWind(): void {
    const c = this.windCache;
    if (c && !this.winds.some((w) => w.wind === c.src)) this.windCache = null;
  }

  private bufBytes(): number {
    let b = 0;
    for (const x of this.bufs) if (x) b += x.arrival.byteLength + x.burnState.byteLength;
    const c = this.windCache;
    if (c) b += c.u.byteLength + c.v.byteLength + c.w.byteLength;
    return b;
  }

  /**
   * Note when cells first appear burnt out: the burn-out time lies in the step (prevT, T], estimated at its midpoint
   * (or at the arrival + flame band when there is no earlier snapshot).
   */
  private trackBurnOut(f: FireField | undefined, T: number, prevT: number): void {
    if (!f || !f.burnState || !f.arrivalTime) return;
    const n = f.burnState.length;
    if (!this.burnEnd || this.burnEnd.length !== n) this.burnEnd = new Float32Array(n).fill(Infinity);
    const end = this.burnEnd;
    const bs = f.burnState;
    const A = f.arrivalTime;
    for (let k = 0; k < n; k++) {
      if (bs[k] !== BurnState.BurntOut || end[k] !== Infinity) continue;
      const a = A[k]!;
      end[k] = Number.isNaN(prevT) ? Math.min(T, a + FLAME_BAND_S) : (Math.max(prevT, a) + T) / 2;
    }
  }

  /** The previous newest snapshot gives up its heavy parts: embers always, a keyframe when one is due. */
  private demote(h: SimSnapshot): void {
    if (h.embers && ArrayBuffer.isView(h.embers.data)) {
      const bytes = h.embers.data.byteLength + 64;
      this.embs.push({ time: h.time, embers: h.embers, bytes });
      this.embBytes += bytes;
    }
    const lastKey = this.keys[this.keys.length - 1];
    if (!lastKey || this.keyDue || h.time - lastKey.time >= this.keyEvery - EPS) {
      this.keyDue = false;
      let atmosphere = h.atmosphere;
      // The fast tier's diagnosed wind volume goes to the wind list, packed; the keyframe keeps the rest of its air view.
      const wind = atmosphere && airKind(atmosphere) === 'diagnosed' && airHas(atmosphere, 'wind') ? packWind(atmosphere.u, atmosphere.v, atmosphere.w) : null;
      if (atmosphere && wind) {
        const bytes = packedWindBytes(wind);
        this.winds.push({ time: h.time, airTime: atmosphere.time, wind, bytes });
        this.windBytes += bytes;
        atmosphere = { ...atmosphere, u: NO_WIND, v: NO_WIND, w: NO_WIND };
      }
      const k: Keyframe = { time: h.time, moisture: h.moisture, atmosphere, layers: h.layers, bytes: 0 };
      k.bytes = keyframeBytes(k);
      this.keys.push(k);
      this.keyBytes += k.bytes;
    }
  }

  /** Append the spot fires of a snapshot to the shared log (the log is a prefix-shared, append-only history). */
  private syncSpots(spots: readonly SpotFire[]): void {
    const log = this.spotLog;
    let i = 0;
    while (i < log.length && i < spots.length && log[i]!.id === spots[i]!.id) i++;
    if (i < log.length) {
      // Diverged (or fewer): frames that counted more than the common prefix keep what is still valid.
      log.length = i;
      for (const f of this.frames) if (f.spotCount > i) f.spotCount = i;
    }
    for (let j = i; j < spots.length; j++) log.push(spots[j]!);
  }

  private dropWhile(pred: (time: number) => boolean): void {
    const f = this.frames;
    let changed = false;
    while (f.length && pred(f[f.length - 1]!.time)) {
      f.pop();
      changed = true;
    }
    while (this.keys.length && pred(this.keys[this.keys.length - 1]!.time)) this.keyBytes -= this.keys.pop()!.bytes;
    while (this.winds.length && pred(this.winds[this.winds.length - 1]!.time)) this.windBytes -= this.winds.pop()!.bytes;
    this.forgetStaleWind();
    if (changed) this.keyDue = true;
    while (this.embs.length && pred(this.embs[this.embs.length - 1]!.time)) this.embBytes -= this.embs.pop()!.bytes;
    if (this.head && pred(this.head.time)) {
      // The newest snapshot is gone but its fire arrays stay valid for every time up to the truncation point.
      this.fireSrc = this.head.fire ?? null;
      this.fireSrcBytes = fireBytes(this.head.fire);
      this.head = null;
      this.headBytes = 0;
      changed = true;
    }
    if (f.length === 0) {
      this.keys = [];
      this.embs = [];
      this.winds = [];
      this.keyBytes = 0;
      this.embBytes = 0;
      this.windBytes = 0;
      this.fireSrc = null;
      this.fireSrcBytes = 0;
      this.spotLog.length = 0;
      this.burnEnd = null;
      this.head = null;
      this.headBytes = 0;
    } else if (changed && this.burnEnd) {
      // Cells that burnt out after the last kept step were still burning then.
      const last = f[f.length - 1]!.time;
      const end = this.burnEnd;
      for (let k = 0; k < end.length; k++) if (end[k]! > last) end[k] = Infinity;
    }
    if (changed) {
      this.cache = null;
      this.gen++;
    }
  }

  /** Thin older history while a list is over its share of the budget. */
  private enforceBudget(): void {
    const over = this.totalBytes > this.maxBytes;
    // Until the budget is first reached every volume is kept. After that the wind list is held to its share at every step: left to
    // grow into the room between thinnings, it would shorten the stretch the keyframes can grow into by as much (fewer pictures).
    if (!over && !this.pressed) return;
    this.pressed = true;
    const room = Math.max(0, this.maxBytes - this.headBytes - this.fireSrcBytes - this.bufBytes() - (this.burnEnd?.byteLength ?? 0) - this.spotLog.length * SPOT_BYTES);
    const headT = this.frames[this.frames.length - 1]!.time;
    const share = this.winds.length ? SHARE_WIND : SHARE;
    if (over && this.keyBytes > room * share.keys) {
      const before = this.keys.length;
      this.keys = fit(this.keys, headT, this.keyEvery, room * share.keys);
      this.keyBytes = this.keys.reduce((a, e) => a + e.bytes, 0);
      if (this.keys.length < before) this.thinned++;
    }
    if (this.winds.length && this.windBytes > room * SHARE_WIND.wind) {
      // Thinning volumes is not thinning the history (no picture goes, only how fresh its air is, which the slice footer says),
      // so it does not count. A share smaller than two volumes drops from the old end, as `fit` does for the other lists.
      const cap = room * SHARE_WIND.wind;
      this.winds = fit(this.winds, headT, this.keyEvery, cap);
      let bytes = this.winds.reduce((a, e) => a + e.bytes, 0);
      while (bytes > cap && this.winds.length > 0) bytes -= this.winds.shift()!.bytes;
      this.windBytes = bytes;
      this.forgetStaleWind();
    }
    if (!over) return;
    if (this.embBytes > room * share.embers) {
      const before = this.embs.length;
      this.embs = fit(this.embs, headT, this.step, room * share.embers);
      this.embBytes = this.embs.reduce((a, e) => a + e.bytes, 0);
      if (this.embs.length < before) this.thinned++;
    }
    if (this.frames.length * FRAME_BYTES > room * share.frames) {
      const before = this.frames.length;
      this.frames = fit(this.frames, headT, this.step, room * share.frames);
      if (this.frames.length < before) this.thinned++;
    }
  }
}

const EMPTY_EMBERS: EmberParticles = { count: 0, data: new Float32Array(0) };

/** Index of the last entry with time ≤ t (0 if t is before all). */
function atOrBeforeIndex(list: readonly { time: number }[], t: number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid]!.time <= t) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** The entry nearest in time to t, or undefined for an empty list. */
function nearest<T extends { time: number }>(list: readonly T[], t: number): T | undefined {
  if (!list.length) return undefined;
  const i = atOrBeforeIndex(list, t);
  const a = list[i]!;
  const b = list[i + 1];
  return b && Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a;
}

/**
 * Thin a time-ordered list: keep the first and last entry and any other that is at least max(base, age / R) after the
 * previously kept one (age = headT − time), with R tightening until the list fits in `cap` bytes (entries carry
 * `bytes`); as a last resort drop from the old end. Returns the same list when it already fits.
 */
function fit<T extends { time: number; bytes: number }>(list: T[], headT: number, base: number, cap: number): T[] {
  const sum = (l: readonly T[]): number => l.reduce((a, e) => a + e.bytes, 0);
  let bytes = sum(list);
  if (bytes <= cap) return list;
  let out = list;
  for (const R of [64, 32, 16, 8, 4, 2, 1, 0.5]) {
    if (out.length <= 2) break;
    const kept: T[] = [out[0]!];
    let lastT = out[0]!.time;
    for (let i = 1; i < out.length - 1; i++) {
      const e = out[i]!;
      if (e.time - lastT >= Math.max(base, (headT - e.time) / R) - EPS) {
        kept.push(e);
        lastT = e.time;
      }
    }
    kept.push(out[out.length - 1]!);
    out = kept;
    bytes = sum(out);
    if (bytes <= cap * 0.9) return out;
  }
  while (bytes > cap && out.length > 2) {
    bytes -= out[1]!.bytes;
    out.splice(1, 1);
  }
  return out;
}

function typedBytes(a: unknown): number {
  return ArrayBuffer.isView(a) ? a.byteLength : 0;
}

function fireBytes(f: FireField | undefined): number {
  let b = 0;
  if (f) for (const k of ['arrivalTime', 'burnState', 'ros', 'intensity', 'flameHeight', 'spreadDir', 'driver', 'phase'] as const) b += typedBytes(f[k]);
  return b;
}

function atmosphereBytes(a: AtmosphereView | undefined): number {
  let b = 0;
  if (a) for (const k of ['levels', 'terrainHeight', 'surfaceU', 'surfaceV', 'u', 'v', 'w', 'thetaAnomaly', 'smoke'] as const) b += typedBytes(a[k]);
  return b;
}

/**
 * Retained bytes of the parts a keyframe holds (moisture, overlay rasters, atmosphere view). Of a live snapshot this counts its air
 * view as it is, the fast tier's diagnosed wind at 12 bytes per cell; a kept keyframe holds that wind packed, in the wind list.
 */
export function keyframeBytes(s: Pick<SimSnapshot, 'moisture' | 'atmosphere' | 'layers'>): number {
  let b = 256 + typedBytes(s.moisture) + atmosphereBytes(s.atmosphere);
  if (s.layers) for (const v of Object.values(s.layers)) b += typedBytes(v);
  return b;
}

/** Approximate retained bytes of a whole snapshot (typed arrays dominate; objects are counted roughly). */
export function estimateSnapshotBytes(s: SimSnapshot): number {
  return 2048 + fireBytes(s.fire) + keyframeBytes(s) + typedBytes(s.embers?.data) + (s.spotFires?.length ?? 0) * 64 + (s.insights?.length ?? 0) * 1024;
}
