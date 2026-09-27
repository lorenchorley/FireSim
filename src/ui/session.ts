/**
 * SimSession: glue between the SimController (worker), the SceneViewApi and the UI panels.
 *
 * Time model
 *  - headTime: time of the newest snapshot received (end of the computed range).
 *  - viewTime: the displayed simulation clock. While playing it advances at `speed` simulated seconds per wall
 *    second (never past headTime — if the worker is slower the clock waits: "computing…"); with speed = Infinity
 *    ("as fast as possible") it follows headTime.
 *  - The worker is asked to compute a bounded look-ahead beyond viewTime (see {@link runTarget}) so pausing,
 *    editing or rewinding wastes little work.
 *  - Scrubbing back shows stored snapshots (SnapshotStore, memory-capped). An ignition or edit made while viewing
 *    the past first calls controller.rewind(viewTime) and drops later results and insights.
 *  - Insights are revealed when the clock passes their time, so future cards never leak ahead of the view.
 */
import type { CellExplanation, Ignition, Insight, ScenarioData, ScenarioEdit, SimSnapshot, SimStats, SpotFire } from '../core/types';
import type { SceneViewApi } from '../render/api';
import type { SimController } from '../sim/protocol';
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
  /** The user scrubbed back to review earlier results (cleared by "Live", edits, or catching up with the head). */
  reviewing: boolean;
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
  /** An insight became visible because the clock passed its time (for toasts). */
  reveal: (insight: Insight) => void;
  ended: () => void;
}

export const SPEEDS: readonly number[] = [1, 10, 60, 120, 300, 600, Infinity];

/** Look-ahead the worker should compute to, given the view time and playback speed (pure). */
export function runTarget(viewTime: number, speed: number, duration: number, interval: number): number {
  if (!Number.isFinite(speed)) return duration;
  const ahead = Math.max(3 * interval, speed * 30, 1800);
  return Math.min(duration, viewTime + ahead);
}

/** Advance the view clock by a wall-clock step (pure). */
export function advanceClock(viewTime: number, headTime: number, speed: number, dtWall: number, duration: number): number {
  if (!Number.isFinite(speed)) return Math.min(Math.max(viewTime, headTime), duration);
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
    this.snapshots = new SnapshotStore({ minInterval: Math.max(60, scenario.options.snapshotInterval), maxBytes: opts.maxBytes ?? defaultSnapshotBudget() });
    this.state = new Store<SessionState>({
      viewTime: 0,
      headTime: 0,
      playing: false,
      speed: 60,
      computing: false,
      workerSpeed: 0,
      snapshot: null,
      reviewing: false,
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
      controller.on('status', (st) => this.state.set({ computing: st.running, workerSpeed: st.speed })),
      controller.on('error', (message) => this.state.set({ error: message, computing: false })),
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

  play(): void {
    const s = this.state.get();
    if (s.viewTime >= this.duration - 1) return;
    this.state.set({ playing: true });
    this.ensureRunning(true);
    this.startLoop();
  }

  pause(): void {
    this.state.set({ playing: false });
    this.controller.pause();
    this.requestedUntil = this.state.get().headTime;
    this.stopLoop();
  }

  toggle(): void {
    if (this.state.get().playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    this.state.set({ speed });
    if (this.state.get().playing) this.ensureRunning(true);
  }

  /** Show time t (clamped to the computed range); pauses playback. */
  seek(t: number): void {
    const s = this.state.get();
    if (s.playing) this.pause();
    const vt = Math.max(0, Math.min(s.headTime, t));
    this.state.set({ viewTime: vt, reviewing: vt < s.headTime - 1 });
    this.syncView();
  }

  /** Jump to the newest computed time and resume playback. */
  goLive(): void {
    this.state.set({ viewTime: this.state.get().headTime, reviewing: false });
    this.syncView();
    this.play();
  }

  // ───────────────────────────── edits ─────────────────────────────

  /** Rewind the worker to the view time if the view is in the past; returns the time edits apply from. */
  private prepareEditAt(): number {
    const s = this.state.get();
    const t = s.viewTime;
    if (t < s.headTime - 1e-3) {
      this.controller.rewind(t);
      this.snapshots.truncateAfter(t);
      this.state.set({
        headTime: this.snapshots.latest()?.time ?? t,
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
      headTime: this.snapshots.latest()?.time ?? since,
      insights: before.insights.filter((i) => i.time <= since),
      compare: baseline.length ? { label, since, baseline } : null,
    });
    this.afterEdit();
    this.play();
  }

  /**
   * Explain a point at the view time. The SimController contract has no time argument yet (requested); the view time
   * is passed as an extra argument, which implementations that support it use and others ignore.
   */
  explain(x: number, y: number): Promise<CellExplanation> {
    const explainAt = this.controller.explain as (x: number, y: number, time?: number) => Promise<CellExplanation>;
    return explainAt.call(this.controller, x, y, this.state.get().viewTime);
  }

  private afterEdit(): void {
    this.syncView();
    if (this.state.get().playing) this.ensureRunning(true);
  }

  // ───────────────────────────── worker I/O ─────────────────────────────

  private ensureRunning(force = false): void {
    const s = this.state.get();
    const target = runTarget(s.viewTime, s.speed, this.duration, this.scenario.options.snapshotInterval);
    if (target <= s.headTime && !force) return;
    const now = performance.now();
    // Re-issue a run if the look-ahead moved on, or if the worker looks idle short of the target — but not every
    // frame while its 'status' reply is still in flight.
    const stalled = !s.computing && s.headTime < target && now - this.lastRunCall > 1000;
    if (force || target > this.requestedUntil + this.scenario.options.snapshotInterval || stalled) {
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
    const keep = Math.max(time, s.viewTime);
    if (s.headTime <= keep && s.insights.every((i) => i.time <= keep)) return;
    this.snapshots.truncateAfter(keep);
    this.requestedUntil = Math.min(this.requestedUntil, time);
    this.state.set({ headTime: this.snapshots.latest()?.time ?? time, insights: s.insights.filter((i) => i.time <= keep) });
    this.syncView();
    if (s.playing) this.ensureRunning(true);
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
    if (s.playing && !Number.isFinite(s.speed)) patch.viewTime = Math.max(s.viewTime, snap.time);
    this.state.set(patch);
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
    const snap = this.snapshots.atOrBefore(s.viewTime);
    if (snap && snap !== s.snapshot) {
      this.view.update(snap);
      this.state.set({ snapshot: snap });
    }
    const cur = this.state.get();
    const vt = cur.viewTime;
    const insightKey = this.visibleInsightKey(cur);
    if (insightKey !== this.shownInsightKey) {
      this.shownInsightKey = insightKey;
      this.view.setInsights(this.visibleInsights(cur));
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
