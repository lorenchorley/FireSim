/**
 * The engine's always-on timing statistics (workstream A and B of docs/plans/air-slice-wind-detail-honest-speed.md, §5.3
 * and §5.4): the aggregates and small fixed rings behind `EngineInfo.perf` (core/simTypes.ts `EnginePerfInfo`). Pure
 * (no DOM, no clock of its own): Simulation feeds it the wall times it already measures for the performance monitor
 * (the laps of `stepOnce`, the whole step) and asks for a report when it makes a snapshot. Nothing here is read by the
 * physics, so no result can depend on it (snapshot hashes skip `engine`).
 *
 * Cost classes (plan §5.3): C counters, R running aggregates and H rings of at most 128 numbers. There is no loop over
 * cells, no allocation in the per-step feed (typed arrays made once; the report builds its small result object), and no
 * per-step log. Retained size: about 11 KB (`retainedBytes()`, pinned under 16 KB in the test).
 *
 * What the numbers mean (the final choices; the contract only names them):
 *  - Busy time is the wall time spent INSIDE whole coupled steps (`stepOnce`: records, fire, air, embers, detectors, the
 *    picture made and posted, the checkpoint), summed. It leaves out the host's yields between chunks, messages such as
 *    "Why here?" and the 3-D spin-up at the start; the re-spin of a tier change runs inside a step (its record lap, so
 *    'other') and is counted, because it is work the worker did.
 *  - Speeds are simulated seconds per busy second: idle time never lowers them, so a worker that is ahead of the viewer is
 *    not "slow". `s10` and `s60` cover the whole 1-second bins of the last 10 and 60 wall seconds up to the report, and
 *    are null under 100 ms of busy time. `mean` is the whole tier (the same number as `EngineRunInfo.simSecondsPerWallSecond`).
 *    `best10` and `worst10` are TUMBLING windows of 10 s of busy time each (a window closes when 10 s of computing have
 *    been added), so they are exact and cost one add per step. `history` holds one speed per 30 s of busy time, oldest
 *    first, at most 20 and only filled samples (a run with under 30 s of computing has none).
 *  - Duty is busy time over wall time of the same window, the step in progress at the report included, so a worker that is
 *    flat out reads 1 and one that waits for the viewer reads near 0. The window starts at the first step of the tier
 *    when that was less than 10 s (60 s) ago; null until 100 ms have passed.
 *  - Per-module `ms` and `share` are since the tier started; `share10` is the last 10 s. The module mapping is below.
 *  - A tier is the atmosphere in use: `startTier()` clears everything that is "since the tier started" (speeds, steps,
 *    modules, quality) and keeps the run's own counters (re-runs, events), because a 3-D speed and a fast-tier speed do
 *    not belong on one line.
 */
import type { EnginePerfInfo, PerfEvent, PerfEventKind, PerfModuleId, PerfModuleShare } from '../core/types';

/** The module ids in report order (the same order as `EnginePerfInfo.modules`). */
export const PERF_MODULE_IDS: readonly PerfModuleId[] = ['air', 'fire', 'coupling', 'embers', 'moisture', 'detectors', 'picture', 'checkpoints', 'other'];
const M = PERF_MODULE_IDS.length;
const OTHER = M - 1;

/**
 * The mapping of the laps of `Simulation.stepOnce` (`perfMods`) onto the module ids people see:
 *  air          atmosphere (the 3-D step; in the fast tier the diagnosed wind's bookkeeping, which is small)
 *  fire         firePrepare, fireStep (the level-set sub-steps), fireMasks, fireMinute (junctions, debris)
 *  coupling     surfaceWind (the wind for the fire; its `airAt` call is NESTED inside this lap and is not added again),
 *               fireHeat (the heat deposit into the air)
 *  embers       embers (emission and flight)
 *  moisture     solarMoisture (insolation, surface heating, litter moisture)
 *  detectors    diagnostics (atmosphere diagnostics), explain (the insight cards)
 *  picture      snapshot (building the picture and posting it)
 *  checkpoints  checkpoint
 *  other        records, stamps, weatherNight, any lap name not listed, and whatever part of the whole step no lap covers
 * `airAt` is not in the table on purpose: Simulation adds it to `perfMods` on its own and never calls `addLap` for it.
 */
export const PERF_LAP_MODULE: Readonly<Record<string, number>> = {
  atmosphere: 0,
  firePrepare: 1,
  fireStep: 1,
  fireMasks: 1,
  fireMinute: 1,
  surfaceWind: 2,
  fireHeat: 2,
  embers: 3,
  solarMoisture: 4,
  diagnostics: 5,
  explain: 5,
  snapshot: 6,
  checkpoint: 7,
  records: OTHER,
  stamps: OTHER,
  weatherNight: OTHER,
};

/** The module index of a lap name (unknown names are 'other'). */
export function lapModuleIndex(name: string): number {
  const i = PERF_LAP_MODULE[name];
  return i === undefined ? OTHER : i;
}

/** What limited an air step (`noteAirStep`): the order of `EnginePerfInfo.quality.limitedBy`. */
export const AIR_LIMIT = { cflH: 0, cflV: 1, cap: 2, user: 3 } as const;

const BINS = 64; // 1-second bins: the 60 s window, the current second and some slack
const CH = 2 + M; // channels per bin: busy ms, simulated s, then one per module (ms)
const RING = 128;
const HISTORY = 20;
const WINDOW_BUSY_MS = 10_000;
const SAMPLE_BUSY_MS = 30_000;
const MIN_BUSY_MS = 100;
const LONG_STEP_MS = 250;
const SLOW_STEP_MS = 100;
const BURST_STEPS = 5;
const BURST_GAP_MS = 10_000;
/** Events kept for the next snapshot (the contract says at most 8; the oldest are dropped). */
export const MAX_PERF_EVENTS = 8;
const MAX_EVENT_TEXT = 120;
/**
 * The serialised events of one snapshot stay under this many characters (every other field, full, takes about 1.2 KB of
 * the 2 KB): the oldest queued events go first and the rest wait for the next snapshot. A line of the engine's own is
 * 60 to 90 characters of text plus about 75 of keys and numbers, so four or five go at once.
 */
const EVENT_BUDGET = 750;
const EVENT_OVERHEAD = 80;

const rnd = (v: number, d: number): number | null => {
  if (!Number.isFinite(v)) return null;
  const k = d === 0 ? 1 : d === 1 ? 10 : d === 2 ? 100 : 1000;
  const r = Math.round(v * k) / k;
  return r === 0 ? 0 : r; // no -0 in the structured clone
};

export interface PerfReportInput {
  /** Wall clock (ms, the engine's clock) now. */
  nowMs: number;
  /** Wall clock (ms) when the step in progress started, NaN when the report is not made inside a step. */
  stepStartMs: number;
  /** Wall seconds the 3-D spin-up at the start took (timing steps included), 0 when none ran. */
  spinUpWallS: number;
  /** Burning cells now, from the snapshot's stats. */
  burningCells: number;
}

export class PerfStats {
  // ── since the tier started ──
  private steps = 0;
  private simS = 0;
  private busyMs = 0;
  private firstStartMs = NaN;
  private nowS = NaN;
  private minS = Infinity;
  private maxS = 0;
  private over100 = 0;
  private over250 = 0;
  private readonly modMs = new Float64Array(M);
  /** The laps of the step in progress (cleared by `endStep`). */
  private readonly lap = new Float64Array(M);
  private readonly ring = new Float32Array(RING);
  private readonly sorted = new Float32Array(RING);
  private ringN = 0;
  private ringHead = 0;
  /** 1-second bins keyed by `floor(wall ms / 1000)`: [busy ms, simulated s, module ms × 9]. */
  private readonly bins = new Float64Array(BINS * CH);
  private readonly binId = new Float64Array(BINS).fill(-1);
  private readonly w10 = new Float64Array(CH);
  private readonly w60 = new Float64Array(CH);
  private tumbleBusy = 0;
  private tumbleSim = 0;
  private best10 = NaN;
  private worst10 = NaN;
  private sampleBusy = 0;
  private sampleSim = 0;
  private readonly history = new Float64Array(HISTORY);
  private historyN = 0;
  private airSteps = 0;
  private readonly limits = new Float64Array(4);
  private maxWindH = NaN;
  private maxWindV = NaN;
  private cycles = 0;
  private subSteps = 0;
  private burstN = 0;
  private burstMax = 0;
  private burstLastMs = -Infinity;
  private burstTold = false;
  // ── the run ──
  private rewinds = 0;
  private recomputedS = 0;
  private tierSwitches = 0;
  private restores = 0;
  private seq = 0;
  private events: PerfEvent[] = [];

  /** `epochNow` stamps events with the wall clock (ms since the epoch); tests pass a fake. */
  constructor(private readonly epochNow: () => number = Date.now) {}

  /** The atmosphere was (re)built: everything "since the tier started" begins again. The run's counters and events stay. */
  startTier(): void {
    this.steps = 0;
    this.simS = 0;
    this.busyMs = 0;
    this.firstStartMs = NaN;
    this.nowS = NaN;
    this.minS = Infinity;
    this.maxS = 0;
    this.over100 = 0;
    this.over250 = 0;
    this.modMs.fill(0);
    this.lap.fill(0);
    this.ringN = 0;
    this.ringHead = 0;
    this.bins.fill(0);
    this.binId.fill(-1);
    this.tumbleBusy = 0;
    this.tumbleSim = 0;
    this.best10 = NaN;
    this.worst10 = NaN;
    this.sampleBusy = 0;
    this.sampleSim = 0;
    this.historyN = 0;
    this.airSteps = 0;
    this.limits.fill(0);
    this.maxWindH = NaN;
    this.maxWindV = NaN;
    this.cycles = 0;
    this.subSteps = 0;
    this.burstN = 0;
    this.burstTold = false;
  }

  /** One lap of the step in progress: `ms` of wall time that belongs to the module of lap `name`. */
  addLap(name: string, ms: number): void {
    this.lap[lapModuleIndex(name)]! += ms;
  }

  /** An air step of a 3-D tier was taken: what limited its length (`AIR_LIMIT`), the wind maxima and the projection cycles. */
  noteAirStep(limit: number, windH: number, windV: number, projectionCycles: number): void {
    this.airSteps++;
    if (limit >= 0 && limit < 4) this.limits[limit]!++;
    if (!(windH <= this.maxWindH)) this.maxWindH = windH;
    if (!(windV <= this.maxWindV)) this.maxWindV = windV;
    this.cycles += projectionCycles;
  }

  /** The level-set sub-steps the fire took in the step in progress. */
  noteFireSubSteps(n: number): void {
    this.subSteps += n;
  }

  /** Simulated seconds of the step that were already computed once before (a re-run). */
  noteRecomputed(seconds: number): void {
    this.recomputedS += seconds;
  }

  /**
   * A whole coupled step is done: it ran from wall `startMs` to `endMs`, advanced `dtS` simulated seconds, and finished
   * at simulation time `simT`. Allocation-free except in the rare long-step burst event.
   */
  endStep(startMs: number, endMs: number, dtS: number, simT: number): void {
    const wall = endMs > startMs ? endMs - startMs : 0;
    if (this.steps === 0 || !Number.isFinite(this.firstStartMs)) this.firstStartMs = startMs;
    this.steps++;
    this.simS += dtS;
    this.busyMs += wall;
    this.nowS = dtS;
    if (dtS < this.minS) this.minS = dtS;
    if (dtS > this.maxS) this.maxS = dtS;
    this.ring[this.ringHead] = wall;
    this.ringHead = (this.ringHead + 1) % RING;
    if (this.ringN < RING) this.ringN++;
    if (wall > SLOW_STEP_MS) this.over100++;
    if (wall > LONG_STEP_MS) {
      this.over250++;
      this.noteLongStep(wall, endMs, simT);
    }
    // The part of the whole step no lap covers (and any rounding) is 'other'; a lap total over the step is not made negative.
    let laps = 0;
    for (let m = 0; m < M; m++) laps += this.lap[m]!;
    if (wall > laps) this.lap[OTHER]! += wall - laps;
    const id = Math.floor(endMs / 1000);
    const slot = ((id % BINS) + BINS) % BINS;
    const o = slot * CH;
    if (this.binId[slot] !== id) {
      this.bins.fill(0, o, o + CH);
      this.binId[slot] = id;
    }
    this.bins[o]! += wall;
    this.bins[o + 1]! += dtS;
    for (let m = 0; m < M; m++) {
      const v = this.lap[m]!;
      this.modMs[m]! += v;
      this.bins[o + 2 + m]! += v;
      this.lap[m] = 0;
    }
    // Tumbling windows of busy time: the best and worst 10 s, and the 20-sample history (one per 30 s).
    this.tumbleBusy += wall;
    this.tumbleSim += dtS;
    if (this.tumbleBusy >= WINDOW_BUSY_MS) {
      const s = this.tumbleSim / (this.tumbleBusy / 1000);
      if (!(s <= this.best10)) this.best10 = s;
      if (!(s >= this.worst10)) this.worst10 = s;
      this.tumbleBusy = 0;
      this.tumbleSim = 0;
    }
    this.sampleBusy += wall;
    this.sampleSim += dtS;
    if (this.sampleBusy >= SAMPLE_BUSY_MS) {
      const s = this.sampleSim / (this.sampleBusy / 1000);
      if (this.historyN === HISTORY) {
        this.history.copyWithin(0, 1);
        this.history[HISTORY - 1] = s;
      } else this.history[this.historyN++] = s;
      this.sampleBusy = 0;
      this.sampleSim = 0;
    }
  }

  private noteLongStep(wall: number, endMs: number, simT: number): void {
    if (this.burstN === 0 || endMs - this.burstLastMs > BURST_GAP_MS) {
      this.burstN = 0;
      this.burstMax = 0;
      this.burstTold = false;
    }
    this.burstN++;
    this.burstLastMs = endMs;
    if (wall > this.burstMax) this.burstMax = wall;
    if (!this.burstTold && this.burstN >= BURST_STEPS) {
      this.burstTold = true;
      this.event('long-steps', simT, `${this.burstN} steps close together each took over ${LONG_STEP_MS} ms; the slowest took ${Math.round(this.burstMax)} ms.`);
    }
  }

  /** The engine told the receiver that results after some time are out of date (a rewind, an edit, a tier change). */
  noteRewind(): void {
    this.rewinds++;
  }

  /** A checkpoint was restored. */
  noteRestore(): void {
    this.restores++;
  }

  /** The atmosphere was rebuilt for another tier after the start (the Auto decision at the start is not a switch). */
  noteTierSwitch(): void {
    this.tierSwitches++;
  }

  /** Queue an event for the next snapshot: one short plain sentence; the oldest go when more than eight wait. */
  event(kind: PerfEventKind, simS: number, text: string): void {
    this.events.push({
      seq: ++this.seq,
      kind,
      simS: Number.isFinite(simS) ? Math.round(simS) : 0,
      wallMs: Math.round(this.epochNow()),
      text: text.length > MAX_EVENT_TEXT ? `${text.slice(0, MAX_EVENT_TEXT - 1)}…` : text,
    });
    if (this.events.length > MAX_PERF_EVENTS) this.events.shift();
  }

  /** Take the oldest queued events that fit the size budget of one snapshot (always at least one if any waits). */
  drainEvents(): PerfEvent[] {
    const q = this.events;
    let used = 0;
    let n = 0;
    while (n < q.length) {
      const cost = q[n]!.text.length + EVENT_OVERHEAD;
      if (n > 0 && used + cost > EVENT_BUDGET) break;
      used += cost;
      n++;
    }
    return q.splice(0, n);
  }

  /** Bytes the statistics hold (the fixed buffers; the event queue and the scalar fields at their largest). */
  retainedBytes(): number {
    const buffers = [this.modMs, this.lap, this.ring, this.sorted, this.bins, this.binId, this.w10, this.w60, this.history, this.limits];
    const events = MAX_PERF_EVENTS * (MAX_EVENT_TEXT * 2 + 120);
    return buffers.reduce((a, b) => a + b.byteLength, 0) + events + 64 * 8;
  }

  /** Sum the bins of the last 60 and the last 10 whole seconds into `w60` and `w10`. */
  private windows(cur: number): void {
    const { w10, w60, bins, binId } = this;
    w10.fill(0);
    w60.fill(0);
    for (let id = cur - 59; id <= cur; id++) {
      const slot = ((id % BINS) + BINS) % BINS;
      if (binId[slot] !== id) continue;
      const o = slot * CH;
      const recent = id > cur - 10;
      for (let c = 0; c < CH; c++) {
        const v = bins[o + c]!;
        w60[c]! += v;
        if (recent) w10[c]! += v;
      }
    }
  }

  /** Duty over the window that starts at `fromMs` (ms), the step in progress included; null before 100 ms have passed. */
  private duty(busyMs: number, nowMs: number, fromMs: number, stepStartMs: number): number | null {
    if (!Number.isFinite(this.firstStartMs)) return null;
    const start = Math.max(this.firstStartMs, fromMs);
    const wall = nowMs - start;
    if (!(wall >= MIN_BUSY_MS)) return null;
    const running = Number.isFinite(stepStartMs) && nowMs > stepStartMs ? nowMs - Math.max(stepStartMs, start) : 0;
    return rnd(Math.min(1, Math.max(0, (busyMs + running) / wall)), 3);
  }

  /** The block for `EngineInfo.perf`. Takes the queued events. */
  report(o: PerfReportInput): EnginePerfInfo {
    const cur = Math.floor(o.nowMs / 1000);
    this.windows(cur);
    const { w10, w60 } = this;
    const speedOf = (w: Float64Array): number | null => (w[0]! >= MIN_BUSY_MS ? rnd(w[1]! / (w[0]! / 1000), 1) : null);
    // Step wall times of the last 128 steps: median, 95th percentile and maximum.
    let medianMs: number | null = null;
    let p95Ms: number | null = null;
    let maxMs: number | null = null;
    const n = this.ringN;
    if (n > 0) {
      const s = this.sorted.subarray(0, n);
      s.set(this.ring.subarray(0, n));
      s.sort();
      medianMs = rnd(n % 2 ? s[n >> 1]! : (s[(n >> 1) - 1]! + s[n >> 1]!) / 2, 2);
      p95Ms = rnd(s[Math.min(n - 1, Math.ceil(0.95 * n) - 1)]!, 2);
      maxMs = rnd(s[n - 1]!, 2);
    }
    let modTotal = 0;
    let mod10 = 0;
    for (let m = 0; m < M; m++) {
      modTotal += this.modMs[m]!;
      mod10 += w10[2 + m]!;
    }
    const modules: PerfModuleShare[] = [];
    for (let m = 0; m < M; m++) {
      modules.push({
        id: PERF_MODULE_IDS[m]!,
        ms: this.steps > 0 ? rnd(this.modMs[m]! / this.steps, 2) : null,
        share: modTotal > 0 ? rnd(this.modMs[m]! / modTotal, 3) : null,
        share10: mod10 > 0 ? rnd(w10[2 + m]! / mod10, 3) : null,
      });
    }
    const a = this.airSteps;
    const air = a > 0;
    const history: number[] = [];
    for (let i = 0; i < this.historyN; i++) history.push(rnd(this.history[i]!, 1)!);
    return {
      speed: {
        s10: speedOf(w10),
        s60: speedOf(w60),
        mean: this.busyMs >= MIN_BUSY_MS ? rnd(this.simS / (this.busyMs / 1000), 1) : null,
        best10: rnd(this.best10, 1),
        worst10: rnd(this.worst10, 1),
      },
      history,
      step: {
        nowS: rnd(this.nowS, 2),
        minS: this.steps > 0 ? rnd(this.minS, 2) : null,
        meanS: this.steps > 0 ? rnd(this.simS / this.steps, 2) : null,
        maxS: this.steps > 0 ? rnd(this.maxS, 2) : null,
        medianMs,
        p95Ms,
        maxMs,
        over100: this.over100,
        over250: this.over250,
      },
      duty: {
        s10: this.duty(w10[0]!, o.nowMs, (cur - 9) * 1000, o.stepStartMs),
        s60: this.duty(w60[0]!, o.nowMs, (cur - 59) * 1000, o.stepStartMs),
      },
      modules,
      quality: {
        limitedBy: air ? { cflH: rnd(this.limits[0]! / a, 3)!, cflV: rnd(this.limits[1]! / a, 3)!, cap: rnd(this.limits[2]! / a, 3)!, user: rnd(this.limits[3]! / a, 3)! } : null,
        maxWindH: air ? rnd(this.maxWindH, 1) : null,
        maxWindV: air ? rnd(this.maxWindV, 1) : null,
        projectionCorrections: air ? rnd(this.cycles / a, 2) : null,
        spinUpWallS: rnd(o.spinUpWallS, 2),
        fireSubSteps: this.steps > 0 ? rnd(this.subSteps / this.steps, 2) : null,
        burningCells: rnd(o.burningCells, 0),
      },
      // The ember model counts the brands it emits but keeps no running total of landings (only a 10 minute window), so
      // there is no honest pair to report.
      embers: null,
      reruns: { rewinds: this.rewinds, recomputedS: Math.round(this.recomputedS), tierSwitches: this.tierSwitches, restores: this.restores },
      events: this.drainEvents(),
    };
  }
}
