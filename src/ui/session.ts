/**
 * SimSession: glue between the SimController (worker), the SceneViewApi and the UI panels.
 *
 * Time model
 *  - headTime: time of the newest snapshot received (end of the computed range).
 *  - viewTime: the displayed simulation clock. While playing it advances at `speed` simulated seconds per wall
 *    second (never past headTime — if the worker is slower the clock waits: "computing…"); with speed = Infinity
 *    ("as fast as possible") it follows headTime (and replays history at {@link MAX_REPLAY_SPEED}).
 *  - The worker is asked to compute a bounded look-ahead beyond viewTime (see {@link runTarget}) so pausing,
 *    editing or rewinding wastes little work.
 *  - Any time up to headTime can be shown at once and exactly (SnapshotStore rebuilds the fire front for that time).
 *    A time beyond headTime is a FAST-FORWARD (see {@link SimSession.seek}): the engine runs at full speed to the
 *    target, the view follows each newest snapshot and stops exactly at the target.
 *  - An ignition or edit made while viewing the past first calls controller.rewind(viewTime) and drops later results
 *    and insights. Edits, ignitions and what-ifs cancel a fast-forward in progress.
 *  - Insights are revealed when the clock passes their time (also during a fast-forward, in order), so future cards
 *    never leak ahead of the view.
 *  - Only the user (pause, the timeline, menus), the end of the scenario, or the app going to the background stops
 *    playback: nothing else in here pauses it (a worker error does, since there is nothing to play).
 */
import type { CellExplanation, Ignition, Insight, ScenarioData, ScenarioEdit, SimSnapshot, SimStats, SpotFire } from '../core/types';
import type { SceneViewApi } from '../render/api';
import type { SimController } from '../sim/protocol';
import { groupInsights } from './insightGroups';
import { SnapshotStore } from './snapshotStore';
import { Emitter, Store } from './store';

export interface WhatIfOptions {
  coupling: number;
  embers: boolean;
  mountainPhenomena: boolean;
}

export interface CompareInfo {
  label: string;
  /** Simulation time the what-if run starts from. */
  since: number;
  /** Baseline (previous run) stats after `since`, for comparison. */
  baseline: { time: number; burntAreaHa: number; perimeterKm: number; maxIntensity: number; spotFires: number }[];
}

export interface SessionState {
  viewTime: number;
  headTime: number;
  playing: boolean;
  /** Simulated seconds per wall-clock second; Infinity = as fast as possible. */
  speed: number;
  /** Worker is running. */
  computing: boolean;
  /** Worker throughput (simulated s per wall s). */
  workerSpeed: number;
  snapshot: SimSnapshot | null;
  /** The user scrubbed back to review earlier results (cleared by edits, or by playing on to the newest time). */
  reviewing: boolean;
  /**
   * A timeline jump beyond the newest computed time is in progress: the engine is computing at full speed to this
   * simulation time (s) and the view follows; null when idle. `playing` is false meanwhile (the clock does not run).
   * See {@link SimSession.seek}.
   */
  seekTarget: number | null;
  /** Progress of that jump, 0–1: (min(head, target) − seekFrom) / (target − seekFrom), 0 when idle. */
  seekProgress: number;
  /** Display step (s): how often the engine produces a new picture. Mirrors Settings.timeStep. */
  timeStep: number;
  /** Solver step limit (s); 0 = automatic. Mirrors Settings.solverStep. */
  solverStep: number;
  /** All insights received (chronological), including ones not yet revealed. */
  insights: Insight[];
  forecastInsights: Insight[];
  ignitions: Ignition[];
  edits: { edit: ScenarioEdit; time: number }[];
  options: WhatIfOptions;
  compare: CompareInfo | null;
  error: string | null;
}

export interface SessionEvents {
  /** An insight became visible because the clock passed its time (counted by the dock's badge; never shown as a pop-up). */
  reveal: (insight: Insight) => void;
  ended: () => void;
}

export const SPEEDS: readonly number[] = [1, 10, 60, 120, 300, 600, Infinity];

/** Fastest the view clock replays already computed history at speed = Infinity (simulated s per wall s). */
export const MAX_REPLAY_SPEED = 10800;

/** Look-ahead the worker should compute to, given the view time and playback speed (pure). */
export function runTarget(viewTime: number, speed: number, duration: number, interval: number): number {
  if (!Number.isFinite(speed)) return duration;
  const ahead = Math.max(3 * interval, speed * 30, 1800);
  return Math.min(duration, viewTime + ahead);
}

/** Rounding (simulated s) of the picture shown while playing at `speed`: about six pictures per wall second, at least 1 s apart (pure). */
export function playQuantum(speed: number): number {
  return Math.max(1, (Number.isFinite(speed) ? speed : MAX_REPLAY_SPEED) / 6);
}

/** Advance the view clock by a wall-clock step (pure). */
export function advanceClock(viewTime: number, headTime: number, speed: number, dtWall: number, duration: number): number {
  if (!Number.isFinite(speed)) {
    // As fast as possible: at the newest result, follow it; behind it (after a jump back), replay very fast.
    if (viewTime >= headTime) return Math.min(Math.max(viewTime, headTime), duration);
    return Math.min(duration, headTime, viewTime + MAX_REPLAY_SPEED * dtWall);
  }
  if (viewTime >= headTime) return viewTime; // waiting for the worker (never jump backwards)
  return Math.min(duration, headTime, viewTime + speed * dtWall);
}

export class SimSession {
  readonly state: Store<SessionState>;
  readonly events = new Emitter<SessionEvents>();
  readonly snapshots: SnapshotStore;
  readonly scenario: ScenarioData;
  private readonly unsubs: (() => void)[] = [];
  private raf = 0;
  private lastFrame = 0;
  private requestedUntil = 0;
  private lastRunCall = -Infinity;
  private revealedUpTo = -Infinity;
  private revealed = new Set<string>();
  private disposed = false;
  /** Whether the timeline drag in progress began while playing (see beginScrub). */
  private scrubResume = false;
  /** Fast-forward in progress: where the view was when it began (progress base), whether to play on landing, and whether the worker has reported running since. */
  private seekFrom = 0;
  private seekResume = false;
  private seekSawRunning = false;
  /** Counts pause() calls, so a pause made by a reveal listener during a jump's landing is not undone. */
  private pauses = 0;
  /** Time of a removed ignition whose 'rewound' reply is pending (results after it are stale). */
  private rewindFloor: number | null = null;
  /** What was last pushed to the view (see syncView). */
  private shownInsightKey = '';
  private shownIgnitions: readonly Ignition[] | null = null;
  private shownIgnitionCount = -1;
  private keyInsights: readonly Insight[] | null = null;
  private keyForecast: readonly Insight[] | null = null;
  private keyGeneration = 0;

  constructor(
    scenario: ScenarioData,
    readonly controller: SimController,
    readonly view: SceneViewApi,
    opts: { maxBytes?: number } = {},
  ) {
    this.scenario = scenario;
    this.snapshots = new SnapshotStore({ minInterval: scenario.options.snapshotInterval, maxBytes: opts.maxBytes ?? defaultSnapshotBudget() });
    this.state = new Store<SessionState>({
      viewTime: 0,
      headTime: 0,
      playing: false,
      speed: 60,
      computing: false,
      workerSpeed: 0,
      snapshot: null,
      reviewing: false,
      seekTarget: null,
      seekProgress: 0,
      timeStep: scenario.options.snapshotInterval,
      solverStep: scenario.options.maxStepS ?? 0,
      insights: [],
      forecastInsights: [],
      ignitions: [...scenario.ignitions],
      edits: scenario.edits.map((edit) => ({ edit, time: 0 })),
      options: { coupling: scenario.options.coupling, embers: scenario.options.embers, mountainPhenomena: scenario.options.mountainPhenomena },
      compare: null,
      error: null,
    });
    this.unsubs.push(
      controller.on('snapshot', (s) => this.onSnapshot(s)),
      controller.on('status', (st) => this.onStatus(st.running, st.speed, st.until)),
      controller.on('error', (message) => this.onError(message)),
      controller.on('ready', (ins) => this.state.set({ forecastInsights: ins })),
      controller.on('rewound', (t) => this.onRewound(t)),
    );
  }

  /** Initialise the worker with the scenario. Resolves with the forecast insights. */
  async start(): Promise<Insight[]> {
    const forecast = await this.controller.init(this.scenario);
    if (!this.disposed) this.state.set({ forecastInsights: forecast });
    this.syncView();
    return forecast;
  }

  get duration(): number {
    return this.scenario.duration;
  }

  /**
   * True unless the user is reviewing earlier results. (While playing, the view is normally a little behind the head
   * because the worker computes ahead; that is still "live".)
   */
  isLive(s: Readonly<SessionState> = this.state.get()): boolean {
    return !s.reviewing;
  }

  // ───────────────────────────── playback ─────────────────────────────

  /** Start (or resume) playback from the view time. During a fast-forward it means "and play on when you get there". */
  play(): void {
    const s = this.state.get();
    if (s.seekTarget !== null) {
      this.seekResume = true;
      return;
    }
    if (s.viewTime >= this.duration - 1) return;
    this.state.set({ playing: true });
    this.ensureRunning(true);
    this.startLoop();
  }

  /**
   * Stop playback (the user's pause; also the end of the scenario and the app going to the background). A fast-forward
   * in progress is cancelled: the view stays where it is.
   */
  pause(): void {
    this.pauses++;
    if (this.state.get().seekTarget !== null) this.clearSeek();
    this.state.set({ playing: false });
    this.controller.pause();
    this.requestedUntil = this.state.get().headTime;
    this.stopLoop();
    // The clock can be ahead of the results while it waits for the engine (after an edit or a re-run dropped them):
    // stopped, it shows the newest computed time, so the clock and the picture agree and nothing beyond the computed
    // range is ever displayed.
    const s = this.state.get();
    if (s.snapshot && s.viewTime > s.headTime + 1e-6) {
      this.state.set({ viewTime: s.headTime, reviewing: false });
      this.syncView();
    }
  }

  /** Play / pause; while a fast-forward runs it cancels it (the button shows Pause meanwhile). */
  toggle(): void {
    const s = this.state.get();
    if (s.playing || s.seekTarget !== null) this.pause();
    else this.play();
  }

  /** Any positive speed (simulated s per wall s, e.g. 0.5, 45, 3600) or Infinity = as fast as possible. */
  setSpeed(speed: number): void {
    if (!(speed > 0)) return;
    this.state.set({ speed });
    if (this.state.get().playing) this.ensureRunning(true);
  }

  // ───────────────────────────── timeline ─────────────────────────────

  /**
   * Jump to simulation time t ∈ [0, duration] (clamped). One-shot form of beginScrub / endScrub, for buttons and typed
   * times.
   *  - t ≤ newest computed time: the view shows t immediately and exactly (the history rebuilds the fire front for
   *    that very time, see SnapshotStore).
   *  - t > newest computed time: FAST-FORWARD. `seekTarget = t`, `playing` is false, the engine computes at full speed
   *    (controller.run(t)), the view follows each newest snapshot (never beyond the target or what is computed;
   *    `seekProgress` = (min(head, t) − seekFrom) / (t − seekFrom)) and stops exactly at t. Then playback continues at
   *    the same speed if `opts.resume` (default: whether it was playing when the jump began, or a fast-forward that
   *    was to play on), else the view stays paused at t. Insight cards are revealed in order on the way.
   *  - A new seek retargets a jump in progress. `pause()`, `cancelSeek()`, an edit, an ignition or a what-if ends it,
   *    staying where the view is; so does a worker error or the worker going idle before the target.
   */
  seek(t: number, opts: { resume?: boolean } = {}): void {
    if (this.disposed || !Number.isFinite(t)) return;
    const s = this.state.get();
    const target = Math.max(0, Math.min(this.duration, t));
    const seeking = s.seekTarget !== null;
    const resume = opts.resume ?? (s.playing || (seeking && this.seekResume));
    if (target <= s.headTime + 1e-6) {
      if (seeking) this.clearSeek();
      this.state.set({ viewTime: target, reviewing: target < s.headTime - 1 });
      const pauses = this.pauses;
      this.syncView();
      if (this.pauses !== pauses) return; // a reveal listener paused (pause on Danger): respect it
      if (resume && target < this.duration - 1) {
        if (this.state.get().playing) this.ensureRunning(true);
        else this.play();
      } else {
        if (s.playing || seeking) this.pause();
        if (resume) this.events.emit('ended');
      }
      return;
    }
    this.startSeek(target, resume);
  }

  /** A drag on the timeline begins: remember whether it was playing and pause. Pair with {@link scrub} and {@link endScrub}. */
  beginScrub(): void {
    const s = this.state.get();
    this.scrubResume = s.playing || (s.seekTarget !== null && this.seekResume);
    if (s.playing || s.seekTarget !== null) this.pause();
  }

  /** Dragging: preview time t (never starts the engine; shows at most the newest computed time). */
  scrub(t: number): void {
    const s = this.state.get();
    const vt = Math.max(0, Math.min(s.headTime, t));
    this.state.set({ viewTime: vt, reviewing: vt < s.headTime - 1 });
    this.syncView();
  }

  /** The drag ends at t: commit with {@link seek}, resuming playback if it was playing when the drag began. */
  endScrub(t: number): void {
    const resume = this.scrubResume;
    this.scrubResume = false;
    this.seek(t, { resume });
  }

  /** Stop a fast-forward in progress and stay where the view is (paused). No-op when idle. */
  cancelSeek(): void {
    if (this.state.get().seekTarget !== null) this.pause();
  }

  /** Move the view by dt seconds (negative = back), e.g. the ±1 min / ±1 h buttons. Keeps playing if it was playing. */
  stepBy(dt: number): void {
    this.seek(this.state.get().viewTime + dt);
  }

  /** Change the display step (s) now: applies to results computed from here on (no re-run). */
  setTimeStep(seconds: number): void {
    if (!(seconds > 0)) return;
    this.state.set({ timeStep: seconds });
    this.snapshots.setStep(seconds);
    this.controller.setOption('snapshotInterval', seconds);
  }

  /**
   * Change the solver step limit (s, 0 = automatic). It changes the trajectory, so the engine re-runs from the view
   * time like other what-ifs: later results are dropped here and streamed again ('rewound'). A fast-forward ends.
   */
  setSolverStep(seconds: number): void {
    if (!(seconds >= 0)) return;
    this.cancelSeek();
    this.state.set({ solverStep: seconds });
    this.controller.setOption('maxStepS', seconds);
    this.rerunFromView();
  }

  // ── fast-forward internals ──

  private startSeek(target: number, resume: boolean): void {
    const s = this.state.get();
    if (s.playing) {
      // The clock does not run during a jump: the view follows the engine.
      this.stopLoop();
      this.state.set({ playing: false });
    }
    this.seekFrom = s.viewTime;
    this.seekResume = resume;
    this.seekSawRunning = false;
    this.state.set({ seekTarget: target, seekProgress: 0, reviewing: false });
    this.requestedUntil = target;
    this.lastRunCall = performance.now();
    this.controller.run(target);
    this.followSeek();
  }

  /** Move the view to the newest result (never past the target) and land when the target is computed. */
  private followSeek(): void {
    const s = this.state.get();
    const target = s.seekTarget;
    if (target === null) return;
    if (s.headTime >= target - 1e-6) {
      this.finishSeek(target);
      return;
    }
    const span = Math.max(1e-6, target - this.seekFrom);
    const reached = Math.min(s.headTime, target);
    this.state.set({ viewTime: Math.max(s.viewTime, reached), seekProgress: Math.max(0, Math.min(1, (reached - this.seekFrom) / span)) });
    this.syncView();
  }

  private finishSeek(target: number): void {
    const resume = this.seekResume;
    this.clearSeek();
    this.state.set({ viewTime: target, reviewing: false });
    const pauses = this.pauses;
    this.syncView();
    if (this.pauses !== pauses) return; // a reveal listener paused (pause on Danger): respect it
    const atEnd = target >= this.duration - 1;
    if (resume && !atEnd) {
      this.play();
    } else {
      this.requestedUntil = this.state.get().headTime;
      if (resume) this.events.emit('ended');
    }
  }

  /** Forget the jump (state only). */
  private clearSeek(): void {
    this.seekSawRunning = false;
    this.state.set({ seekTarget: null, seekProgress: 0 });
  }

  /** The worker stopped (or failed) before the target was computed: stay at the newest result. */
  private abortSeek(): void {
    if (this.state.get().seekTarget === null) return;
    this.clearSeek();
    this.requestedUntil = this.state.get().headTime;
    this.state.set({ viewTime: Math.min(this.state.get().viewTime, this.state.get().headTime) });
    this.syncView();
  }

  private onStatus(running: boolean, speed: number, until?: number): void {
    if (this.disposed) return;
    this.state.set({ computing: running, workerSpeed: speed });
    const s = this.state.get();
    if (s.seekTarget === null) return;
    // Reports of the worker's earlier runs (the echo of a pause, a look-ahead) can still be in flight when a jump
    // starts: only those of a run heading for this target count, and only a 'not running' after a 'running'.
    if (until !== undefined && Math.abs(until - Math.min(s.seekTarget, this.duration)) > 1e-6) return;
    if (running) this.seekSawRunning = true;
    // The run stopped short of the target (paused elsewhere, replay interrupted): stay at the newest result.
    else if (this.seekSawRunning && s.headTime < s.seekTarget - 1e-6) this.abortSeek();
  }

  private onError(message: string): void {
    if (this.disposed) return;
    this.state.set({ error: message, computing: false });
    this.abortSeek();
    if (this.state.get().playing) {
      this.state.set({ playing: false });
      this.stopLoop();
    }
  }

  // ───────────────────────────── edits ─────────────────────────────

  /** Rewind the worker to the view time if the view is in the past; returns the time edits apply from. */
  private prepareEditAt(): number {
    this.cancelSeek(); // an edit ends a fast-forward in progress: it applies at the view time
    const s = this.state.get();
    const t = s.viewTime;
    if (t < s.headTime - 1e-3) {
      this.controller.rewind(t);
      this.snapshots.truncateAfter(t);
      this.state.set({
        headTime: this.snapshots.headTime() ?? t,
        insights: s.insights.filter((i) => i.time <= t),
      });
      this.requestedUntil = t;
    }
    // An edit makes the view time the new present.
    if (this.state.get().reviewing) this.state.set({ reviewing: false });
    return t;
  }

  ignite(ign: Omit<Ignition, 'time'>): Ignition {
    const t = this.prepareEditAt();
    const full: Ignition = { ...ign, time: t };
    this.controller.ignite(full);
    this.state.set((s) => ({ ignitions: [...s.ignitions, full] }));
    this.afterEdit();
    return full;
  }

  edit(edit: ScenarioEdit): void {
    const t = this.prepareEditAt();
    const e = edit.kind === 'wind' ? { ...edit, time: t } : edit;
    this.controller.edit(e, t);
    this.state.set((s) => ({ edits: [...s.edits.filter((x) => x.edit.id !== e.id), { edit: e, time: t }] }));
    this.afterEdit();
  }

  removeEdit(id: string): void {
    const t = this.prepareEditAt();
    void t;
    this.controller.removeEdit(id);
    this.state.set((s) => ({ edits: s.edits.filter((x) => x.edit.id !== id) }));
    this.afterEdit();
  }

  /** What-if: change coupling / embers / mountain phenomena and re-run from the view time. */
  rerunWith(options: WhatIfOptions, label: string): void {
    this.cancelSeek();
    const before = this.state.get();
    const since = before.viewTime;
    const baseline = this.snapshots
      .all()
      .filter((sn) => sn.time > since)
      .map((sn) => pickStats(sn.stats));
    this.controller.setOption('coupling', options.coupling);
    this.controller.setOption('embers', options.embers);
    this.controller.setOption('mountainPhenomena', options.mountainPhenomena);
    // Always rewind, even at the head, so the new options apply from exactly `since`.
    this.controller.rewind(since);
    this.snapshots.truncateAfter(since);
    this.requestedUntil = since;
    this.state.set({
      options,
      reviewing: false,
      headTime: this.snapshots.headTime() ?? since,
      insights: before.insights.filter((i) => i.time <= since),
      compare: baseline.length ? { label, since, baseline } : null,
    });
    this.afterEdit();
    this.play();
  }

  /**
   * Re-run from the view time (options already sent): the worker rewinds there, so every later result is dropped here
   * and streamed again; the view time stays where it is. Keeps playing if it was playing.
   */
  private rerunFromView(): void {
    const s = this.state.get();
    const since = s.viewTime;
    this.controller.rewind(since);
    this.snapshots.truncateAfter(since);
    this.requestedUntil = since;
    this.state.set({
      reviewing: false,
      headTime: this.snapshots.headTime() ?? since,
      insights: s.insights.filter((i) => i.time <= since),
    });
    this.afterEdit();
  }

  /**
   * Undo a marked ignition (a wrong mark): the worker rewinds to its time and re-runs without it, so every result
   * after that time is dropped here (they are re-computed and streamed again); the view time stays where it is.
   */
  removeIgnition(id: string): void {
    this.cancelSeek();
    const s = this.state.get();
    const ign = s.ignitions.find((i) => i.id === id);
    if (!ign) return;
    this.controller.removeIgnition(id);
    const t = ign.time;
    this.rewindFloor = t;
    if (t < s.headTime) {
      this.snapshots.truncateAfter(t);
      this.requestedUntil = Math.min(this.requestedUntil, t);
    }
    this.state.set((st) => ({
      ignitions: st.ignitions.filter((i) => i.id !== id),
      insights: st.insights.filter((i) => i.time <= t),
      headTime: t < st.headTime ? (this.snapshots.headTime() ?? t) : st.headTime,
      reviewing: false,
    }));
    this.afterEdit();
    // Paused: still re-compute up to the view time, so the picture on screen is right without pressing Play.
    if (!this.state.get().playing && this.state.get().viewTime > this.state.get().headTime) this.controller.run(this.state.get().viewTime);
  }

  /** Explain a point at the view time. */
  explain(x: number, y: number): Promise<CellExplanation> {
    return this.controller.explain(x, y, this.state.get().viewTime);
  }

  private afterEdit(): void {
    this.syncView();
    if (this.state.get().playing) this.ensureRunning(true);
  }

  // ───────────────────────────── worker I/O ─────────────────────────────

  private ensureRunning(force = false): void {
    const s = this.state.get();
    // Never restart the worker once playback stopped (e.g. a Danger card paused it from inside syncView).
    if (!s.playing) return;
    const target = runTarget(s.viewTime, s.speed, this.duration, s.timeStep);
    if (target <= s.headTime && !force) return;
    const now = performance.now();
    // Re-issue a run if the look-ahead moved on, or if the worker looks idle short of the target — but not every
    // frame while its 'status' reply is still in flight.
    const stalled = !s.computing && s.headTime < target && now - this.lastRunCall > 1000;
    if (force || target > this.requestedUntil + Math.max(60, s.timeStep) || stalled) {
      this.requestedUntil = target;
      this.lastRunCall = now;
      this.controller.run(target);
    }
  }

  /**
   * The worker rewound to a checkpoint at `time` (FromWorker 'rewound'; e.g. an edit it had to replay). Results after
   * the displayed time are stale and dropped. Results between the checkpoint and the displayed time are kept: every
   * UI edit applies from the view time, so the replay reproduces them, and dropping them would make visible cards
   * vanish and pop up again (re-emitted duplicates are filtered in onSnapshot).
   */
  private onRewound(time: number): void {
    if (this.disposed) return;
    const s = this.state.get();
    // After removing an ignition everything after its time is stale, even before the view time.
    const floor = this.rewindFloor;
    this.rewindFloor = null;
    const keep = floor !== null && floor <= time + 1e-6 ? time : Math.max(time, s.viewTime);
    if (s.headTime <= keep && s.insights.every((i) => i.time <= keep)) return;
    this.snapshots.truncateAfter(keep);
    this.requestedUntil = Math.min(this.requestedUntil, time);
    this.state.set({ headTime: this.snapshots.headTime() ?? time, insights: s.insights.filter((i) => i.time <= keep) });
    this.syncView();
    if (s.playing) this.ensureRunning(true);
    else if (s.seekTarget !== null) this.followSeek(); // the jump goes on from the earlier result
  }

  private onSnapshot(snap: SimSnapshot): void {
    if (this.disposed) return;
    this.snapshots.push(snap);
    const s = this.state.get();
    // After a rewind the worker re-simulates from a checkpoint before the rewind time, so it re-reports insights the
    // UI kept (it only drops those after the rewind time). Skip those by id, and by what they say, in case the
    // worker gives re-generated cards new ids.
    const known = new Set<string>();
    const lastByKey = new Map<string, number>();
    for (const i of s.insights) {
      known.add(i.id).add(insightSignature(i));
      if (i.key) lastByKey.set(i.key, Math.max(lastByKey.get(i.key) ?? -Infinity, i.time));
    }
    const fresh = snap.insights.filter((i) => {
      const sig = insightSignature(i);
      if (known.has(i.id) || known.has(sig)) return false;
      // The engine's detector key is stable across snapshots: the same phenomenon re-reported within its cooldown
      // (15 min in the spec; 30 min allowed here) is the same card. Severity escalations are kept.
      const last = i.key ? lastByKey.get(i.key) : undefined;
      if (last !== undefined && Math.abs(i.time - last) < DUPLICATE_KEY_WINDOW_S && !s.insights.some((o) => o.key === i.key && severityRank(i.severity) > severityRank(o.severity))) return false;
      known.add(i.id).add(sig);
      if (i.key) lastByKey.set(i.key, i.time);
      return true;
    });
    const insights = fresh.length ? [...s.insights, ...fresh].sort((a, b) => a.time - b.time) : s.insights;
    // The newest snapshot is the head (after a rewind the worker re-emits from a checkpoint, so it can move back).
    const patch: Partial<SessionState> = { headTime: snap.time, insights };
    // As fast as possible: the view follows the newest result (unless it is replaying history after a jump back).
    if (s.playing && !Number.isFinite(s.speed) && s.viewTime >= s.headTime - 1e-6) patch.viewTime = Math.max(s.viewTime, snap.time);
    this.state.set(patch);
    if (s.seekTarget !== null) {
      this.followSeek();
      return;
    }
    this.syncView();
    if (s.playing) this.ensureRunning();
  }

  /**
   * Display the snapshot for the view time and reveal insights up to it. Called every animation frame while playing,
   * so the markers are only pushed to the view when the visible set actually changes (SceneView rebuilds its marker
   * buffers and terrain decals on every setInsights / setIgnitions call).
   */
  private syncView(): void {
    const s = this.state.get();
    // While playing, the picture is rounded down to a quantum (about six pictures per wall second: the renderer
    // interpolates between them) so the view is only updated when something changed; paused or scrubbing, it is the
    // exact view time.
    const snap = this.snapshots.at(s.viewTime, s.playing ? playQuantum(s.speed) : 0);
    if (snap && snap !== s.snapshot) {
      this.view.update(snap);
      this.state.set({ snapshot: snap });
    }
    const cur = this.state.get();
    const vt = cur.viewTime;
    const insightKey = this.visibleInsightKey(cur);
    if (insightKey !== this.shownInsightKey) {
      this.shownInsightKey = insightKey;
      this.view.setInsights(this.mapInsights(cur));
    }
    // Simulated spot fires travel with the snapshot (SceneView.update draws them); the `spots` argument is for
    // user-marked SpotFire objects, of which the UI has none (a spot fire the user sees is an Ignition with
    // origin 'spot'), so passing snapshot.spotFires here would draw every spot fire twice.
    let nIgn = 0;
    for (const i of cur.ignitions) if (i.time <= vt + 1) nIgn++;
    if (cur.ignitions !== this.shownIgnitions || nIgn !== this.shownIgnitionCount) {
      this.shownIgnitions = cur.ignitions;
      this.shownIgnitionCount = nIgn;
      this.view.setIgnitions(
        cur.ignitions.filter((i) => i.time <= vt + 1),
        NO_SPOTS,
      );
    }
    // Reveal events only when moving forward past new insights (not when scrubbing back over old ones).
    if (vt > this.revealedUpTo) {
      for (const i of this.state.get().insights) {
        if (i.time <= vt && i.time > this.revealedUpTo - 1 && !this.revealed.has(i.id) && !this.revealed.has(insightSignature(i))) {
          this.revealed.add(i.id).add(insightSignature(i));
          this.events.emit('reveal', i);
        }
      }
      this.revealedUpTo = vt;
    } else if (vt < this.revealedUpTo) this.revealedUpTo = vt;
  }

  /**
   * Cheap, allocation-free identity of {@link visibleInsights}: `insights` is kept sorted by time, so the revealed cards
   * are a prefix of it and the list identity plus the prefix length (plus the forecast list identity) define the set.
   */
  private visibleInsightKey(s: Readonly<SessionState>): string {
    if (s.insights !== this.keyInsights || s.forecastInsights !== this.keyForecast) {
      this.keyInsights = s.insights;
      this.keyForecast = s.forecastInsights;
      this.keyGeneration++;
    }
    let n = 0;
    const vt = s.viewTime;
    while (n < s.insights.length && s.insights[n]!.time <= vt + 1) n++;
    return `${this.keyGeneration}:${n}`;
  }

  /**
   * Insights marked on the map: the forecast cards plus one marker per kind (the card the Insights tab shows for that
   * kind, see insightGroups), so a large fire's hundreds of reports do not bury the terrain in icons.
   */
  mapInsights(s: Readonly<SessionState> = this.state.get()): Insight[] {
    const vt = s.viewTime;
    const past = s.insights.filter((i) => i.time <= vt + 1);
    return [...s.forecastInsights, ...groupInsights(past).map((g) => g.lead)];
  }

  /** Insights visible at the view time (forecast cards are always visible), newest first. */
  visibleInsights(s: Readonly<SessionState> = this.state.get()): Insight[] {
    const vt = s.viewTime;
    return [...s.forecastInsights, ...s.insights.filter((i) => i.time <= vt + 1)].sort((a, b) => b.time - a.time);
  }

  private startLoop(): void {
    if (this.raf) return;
    this.lastFrame = performance.now();
    const step = (now: number): void => {
      this.raf = 0;
      if (this.disposed) return;
      const s = this.state.get();
      if (!s.playing) return;
      const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      const vt = advanceClock(s.viewTime, s.headTime, s.speed, dt, this.duration);
      if (vt !== s.viewTime) this.state.set({ viewTime: vt, ...(s.reviewing && vt >= s.headTime - 1 ? { reviewing: false } : {}) });
      this.syncView();
      if (!this.state.get().playing) return; // paused while revealing (pause on danger)
      this.ensureRunning();
      if (vt >= this.duration - 1e-6) {
        this.pause();
        this.events.emit('ended');
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    for (const u of this.unsubs) u();
    this.controller.dispose();
    this.snapshots.clear();
    this.events.clear();
  }
}

const NO_SPOTS: SpotFire[] = [];

/** Re-reports of the same detector key within this window are the same card (s). */
const DUPLICATE_KEY_WINDOW_S = 1800;

const severityRank = (s: Insight['severity']): number => (s === 'danger' ? 2 : s === 'watch' ? 1 : 0);

/** Identity of an insight by content: kind, place (100 m) and time (minute). */
export function insightSignature(i: Pick<Insight, 'kind' | 'x' | 'y' | 'time'>): string {
  return `sig:${i.kind}@${Math.round(i.x / 100)},${Math.round(i.y / 100)}@${Math.round(i.time / 60)}`;
}

function pickStats(s: SimStats): CompareInfo['baseline'][number] {
  return { time: s.time, burntAreaHa: s.burntAreaHa, perimeterKm: s.perimeterKm, maxIntensity: s.maxIntensity, spotFires: s.spotFires };
}

/** Baseline value at time t (linear interpolation), or null outside the baseline range. */
export function baselineAt(c: CompareInfo, t: number): CompareInfo['baseline'][number] | null {
  const b = c.baseline;
  if (!b.length || t < b[0]!.time - 1 || t > b[b.length - 1]!.time + 1) return null;
  let i = 0;
  while (i < b.length - 1 && b[i + 1]!.time <= t) i++;
  const a = b[i]!;
  const n = b[i + 1];
  if (!n || n.time === a.time) return a;
  const u = (t - a.time) / (n.time - a.time);
  return {
    time: t,
    burntAreaHa: a.burntAreaHa + (n.burntAreaHa - a.burntAreaHa) * u,
    perimeterKm: a.perimeterKm + (n.perimeterKm - a.perimeterKm) * u,
    maxIntensity: Math.max(a.maxIntensity, n.maxIntensity),
    spotFires: a.spotFires,
  };
}

/**
 * Snapshot memory budget: ~6 % of the reported device memory, 48–160 MB. Mobile WebViews are killed well below the
 * device RAM (iOS WKWebView content processes at roughly 1–1.5 GB on 4 GB phones) and the 3-D view, the worker's
 * checkpoints and the decoded imagery share that, so the replay history must stay modest. `deviceMemory` is absent
 * on Safari (assume 3 GB) and capped at 8 by Chrome.
 */
export function defaultSnapshotBudget(deviceMemoryGb?: number): number {
  const gb = deviceMemoryGb ?? (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory ?? 3;
  return Math.round(Math.min(160, Math.max(48, gb * 1024 * 0.06)) * 1024 * 1024);
}
