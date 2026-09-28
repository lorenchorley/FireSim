/**
 * Simulation — the orchestrator that owns and couples every physics module (spec docs/research/00-synthesis.md §12,
 * cadences §3, contracts §2.2/§2.4). Runs synchronously (Web Worker via host.ts/worker.ts, or in Node for tests).
 *
 * Lifecycle
 *   new Simulation(scenario)  → terrain features, fuel (+ edits at t ≤ 0), stable-night and moisture spin-up, fire model,
 *                              atmosphere of the build tier (auto → standard), explain engine, forecast insights and a
 *                              t0 snapshot (u_bg wind, moisture, no 3-D volume) are available at once.
 *   spinUp(deadline)         → 3-D tiers: 900 s of atmosphere steps with the t0 ambient, surface heating and the cold
 *                              pool; tier 'auto' times the first 20 steps and may switch to the fast tier (§12.6).
 *                              Then the permanent t0 checkpoint is taken. Returns true when finished.
 *   advance(until, deadline) → whole atmosphere steps while t < until (never clipped to `until`, so the step sequence
 *                              does not depend on how the run is chunked); snapshots every snapshotInterval,
 *                              checkpoints every 1800 s (ring of 8 + t0).
 *
 * One atmosphere step (normative order §12.2 — never reorder, the determinism test depends on it):
 *   1  due records (ignitions, edits, removals, options, quality) in (time, seq) order; ember spot ignitions
 *   2  stamp pair → atm.setAmbient; atm.setTime; w = weatherAt(t); stableNight(night, …, Δt) → atm.setNightState
 *   3  every 600 s (and t0): insolation → atm.setSurfaceHeating, moisture.update, fire.refreshMoistureCache
 *   4  every 60 s or on a 22.5° wind-sector change: fire.refreshMasks (previous step's U_ridge);
 *      atm.surfaceWindForFire (κ-scaled U_bg10, U_fire with c_f and m_f, U_ridge, slope flows, lee blend); atm.airAt
 *   5–6 fire.prepare(env); fire.step(Δt_a, env)
 *   7  coupling > 0: atm.addFireHeat(heat of the PREVIOUS step); atm.step(Δt_a)
 *   8  embers.emit + embers.step(atm.sample, atm.sampleTurb, landing, onIgnite) (spots applied in step 1 next step)
 *   9  every 60 s: fire.minuteTasks; atm.diagnostics; explain.update(view)
 *  10  t += Δt_a; snapshot / checkpoint cadences
 * Δt_a = min(atm.maxStableDt(), 12 s) (fast tier: 10 s), clipped so t lands on every 60 s boundary.
 *
 * Determinism (§12.5): independent Rng streams (embers seed, fire seed+1, explain seed+2, atmosphere seed+3), no
 * wall clock in physics (wall time only for the auto-tune decision at init and the performance monitor), Float64
 * time. Rewind (§12.4) restores the latest checkpoint ≤ target and re-runs the same records.
 *
 * Deviations / interpretations (see the sim/ report): records at a time < now trigger a rewind to that time; option
 * records later than a rewind target are moved to the target (the UI's "what-if from the view time"); a removed edit
 * stays active before its removal time; fuel edits do not change the atmosphere's canopy drag / albedo (static at
 * construction); explain(x, y, time) evaluates at min(time, now) with the current environment.
 */
import { Rng } from '../core/rng';
import { lmstHour, stableNight } from '../core/physics';
import { cellAt } from '../core/grid';
import { wrapDeg } from '../core/units';
import {
  BurnState,
  DEFAULT_SIM_OPTIONS,
  FuelType,
  SpreadDriver,
  type AtmosDiagnostics,
  type CellExplanation,
  type CellFuelParams,
  type EmberStats,
  type FireWindContext,
  type FuelHistoryCompact,
  type FuelMap,
  type Ignition,
  type Insight,
  type InsolationResult,
  type LandingInfo,
  type QualityTier,
  type ScenarioData,
  type ScenarioEdit,
  type SimOptions,
  type SimSnapshot,
  type SimStateView,
  type SimStats,
  type SpotFire,
  type SpotProvenance,
  type SpreadEnvironment,
  type StableNightState,
  type Terrain,
  type TerrainDerived,
  type TerrainFeatures,
  type WeatherHour,
  type WindEdit,
} from '../core/types';
import { insolation, solarPosition, terrainDerived } from '../terrain';
import { computeTerrainFeatures } from '../fire/terrainFeatures';
import { FireSpreadModel } from '../fire/spread';
import { afdrsFbi, ffdi } from '../fire/models';
import { applyFuelEdit, cellsInBrush, cloneFuelMap, fuelParamsInto, makeCellFuelParams } from '../fuel';
import { ensureFuelArrays, type FuelMapExt } from '../fuel/fuelMap';
import { MoistureModel, droughtState, spinUpStableNight, stableNightInputAt, rainBefore } from '../fuel/moisture';
import { createAtmosphere, type Atmosphere, type DiagnosticWind, type FireWindContextExt } from '../atmosphere';
import { EmberModel, type EmberLandingEvent } from '../embers';
import { InsightEngine } from '../explain';
import { ghiAt, stampIndex, weatherAt } from '../scenario/weather';
import { SIM_PARAMS } from './params';
import { activeEdits, fuelSequence, recordOrder, sameSequence, type RecordBody, type SimRecord } from './records';
import { dominantFuelType, fireStats, frontRosAt, frontRosBlocks, moistureMean } from './stats';
import type { SimOptionKey } from './protocol';

type Atmos = Atmosphere | DiagnosticWind;

export interface SimulationHooks {
  /** A snapshot (arrays are fresh copies the receiver may keep or transfer). */
  snapshot?: (s: SimSnapshot) => void;
  /** The simulation rewound: results after `time` are stale. */
  rewound?: (time: number) => void;
}

export interface SimulationOptions {
  /** Overrides `scenario.options.tier`. */
  tier?: 'auto' | QualityTier;
  hooks?: SimulationHooks;
  /** Wall clock (ms) for the performance monitor and the auto-tune decision; default performance.now. */
  clock?: () => number;
  /** Skip the 3-D spin-up (tests of the loop only). */
  skipSpinUp?: boolean;
  /** Test-only hooks (spec §15 validation set-ups); never set by the app. */
  testHooks?: SimulationTestHooks;
}

/**
 * Test-only hooks of the §15 validation scenarios.
 *   moisture(M, FA, t): the "moisture hook" — called after the moisture spin-up and after every moisture update,
 *     before the fire's moisture cache is refreshed; may overwrite the dead fine fuel moisture (%) and the fuel
 *     availability fields in place (e.g. a constant M = 8 %).
 *   surfaceHeating: false → "surface heating off": the atmosphere never receives surface heating (no sensible heat
 *     flux, no anabatic/katabatic slope flows); moisture still sees the sun.
 *   emberLanding(ev): every ember landing inside the domain.
 */
export interface SimulationTestHooks {
  moisture?: (moisture: Float32Array, availability: Float32Array, t: number) => void;
  surfaceHeating?: boolean;
  /** Every ember landing inside the domain (EmberModel `onLanding`; V9 landing-distance statistics). */
  emberLanding?: (ev: EmberLandingEvent) => void;
}

/** Wall time per module (ms, cumulative) and counters of the performance monitor (§13 breakdown). */
export interface SimPerf {
  steps: number;
  simSeconds: number;
  wallMs: number;
  modules: Record<string, number>;
  init: Record<string, number>;
  tier: QualityTier;
  autoTune: { stepMs: number; predictedS: number; budgetS: number; chosen: QualityTier } | null;
}

interface PendingSpot {
  x: number;
  y: number;
  travel: number;
  prov: SpotProvenance;
}

interface SimOpts {
  coupling: number;
  embers: boolean;
  mountainPhenomena: boolean;
  /** maxEmbers set by the user (setOption / scenario), null = tier default. */
  maxEmbersUser: number | null;
}

interface Checkpoint {
  time: number;
  /** Typed-array bytes held (memory cap of the ring). */
  bytes: number;
  tier: QualityTier;
  fire: unknown;
  moisture: unknown;
  atm: unknown;
  embers: unknown;
  explain: unknown;
  night: StableNightState;
  lastNightMs: number;
  stampIdx: number;
  nextSolar: number;
  nextMask: number;
  nextMinute: number;
  nextSnapshot: number;
  nextCheckpoint: number;
  lastSector: number;
  nextWind: number;
  windDirty: boolean;
  lastSunMs: number;
  lastSolarT: number;
  opts: SimOpts;
  applied: number[];
  spots: SpotFire[];
  pendingSpots: PendingSpot[];
  nextSpotId: number;
  pendingInsights: Insight[];
  plumeTopAGL: number;
  moistureDirty: boolean;
  /**
   * Sim-level rasters that carry across a step boundary: U_ridge (refreshMasks uses the previous step's), |U_bg10| (the
   * moisture u10 of the next 600 s update), the 2 m air T (3-D tiers: moisture), the previous step's heat and crown
   * share (fixed one-step lag, sparse) and the front-ROS blocks. Everything else is recomputed in step 4 before use.
   */
  arrays: { uRidge: Float32Array; u10: Float32Array; airT: Float32Array | null; heatIdx: Int32Array; heatVal: Float32Array; crownVal: Float32Array; frontRos: Float32Array };
}

const EPS = 1e-6;
const cloneProv = (p: SpotProvenance): SpotProvenance => ({ ...p, meanWindAloft: [p.meanWindAloft[0], p.meanWindAloft[1]] });
const cloneSpot = (s: SpotFire): SpotFire => ({ ...s });

export class Simulation {
  readonly scenario: ScenarioData;
  readonly terrain: Terrain;
  readonly derived: TerrainDerived;
  readonly features: TerrainFeatures;
  readonly fuelBase: FuelMap;
  readonly fuel: FuelMap;
  readonly forecastInsights: Insight[];
  readonly startMs: number;
  readonly duration: number;
  readonly kbdi: number;
  readonly droughtFactor: number;
  /** Warnings collected at init (moisture spin-up notes, drought fallbacks). */
  readonly warnings: string[] = [];

  private readonly n: number;
  private readonly lon: number;
  private readonly history: FuelHistoryCompact;
  private readonly simOptions: SimOptions;
  private readonly hooks: SimulationHooks;
  private readonly testHooks: SimulationTestHooks;
  private readonly heatingOn: boolean;
  private readonly clock: () => number;
  /** Independent streams (§12.5): embers seed, fire seed + 1, explain seed + 2 (reserved), atmosphere seed + 3. */
  readonly rngs: { readonly embers: Rng; readonly fire: Rng; readonly explain: Rng; readonly atmosphere: Rng };
  private readonly rngEmbers: Rng;
  private readonly rngFire: Rng;
  private readonly rngAtm: Rng;
  private readonly moisture: MoistureModel;
  private readonly fire: FireSpreadModel;
  private atm: Atmos;
  private embers: EmberModel;
  private readonly explainEngine: InsightEngine;
  private readonly fbiFuel: FuelType;
  private tierReq: 'auto' | QualityTier;
  private tierNow: QualityTier;
  private opts: SimOpts;

  // ── environment (one object for the whole run: fire.step checks identity) ──
  private readonly env: SpreadEnvironment;
  private readonly windCtx: FireWindContextExt;
  private readonly heatPrev: Float32Array;
  private readonly crownPrev: Float32Array;
  private readonly burntMask: Uint8Array;
  /** Head cells and head directions of the last prepare (fast-tier pyrogenic head correction, §8.8). */
  private readonly headMask: Uint8Array;
  private readonly headDirX: Float32Array;
  private readonly headDirY: Float32Array;
  private readonly u10: Float32Array;
  private u10Valid = false;
  /** Sub-grid slope-flow speed signed along the fall line for the view (+ upslope, Q_h ≥ 0; − downslope, Q_h < 0). */
  private readonly slopeFlowSigned: Float32Array;
  private night: StableNightState;
  private lastNightMs: number;
  private stampIdx = 0;
  private diag: AtmosDiagnostics | null = null;
  private plumeTopAGL = NaN;
  private lastSun: InsolationResult | null = null;
  private lastSunMs = NaN;
  private lastSolarT = NaN;
  private moistureDirty = false;
  private readonly frontRos: Float32Array;
  private readonly frbNx: number;
  private readonly frbNy: number;
  private readonly scratchFuel: CellFuelParams = makeCellFuelParams();
  /** Identity of the wind edits the atmosphere holds. */
  private atmWindKey = '';

  // ── clock and cadences (Float64) ──
  private t = 0;
  private nextSolar = 0;
  private nextMask = 0;
  private nextMinute: number = SIM_PARAMS.minuteS;
  private nextSnapshot: number;
  private nextCheckpoint: number = SIM_PARAMS.checkpointIntervalS;
  private lastSector = -1;
  /** Fast tier: next surface-wind recomputation (s) and the "inputs changed" flag (see SIM_PARAMS.fastWindIntervalS). */
  private nextWind = 0;
  private windDirty = true;

  // ── records, spots, insights ──
  private readonly records = new Map<number, SimRecord>();
  private recordSeq = 0;
  private applied: number[] = [];
  private appliedSet = new Set<number>();
  private spots: SpotFire[] = [];
  private pendingSpots: PendingSpot[] = [];
  private nextSpotId = 1;
  private pendingInsights: Insight[] = [];

  // ── checkpoints / replay ──
  private cp0: Checkpoint | null = null;
  private ring: Checkpoint[] = [];
  private replayTarget = -Infinity;
  private suppressUntil = -Infinity;

  // ── spin-up ──
  private spinDone = 0;
  private spinTotal = 0;
  private spinTimed = 0;
  private spinWall = 0;
  private ready = false;

  // ── performance ──
  private readonly perfMods: Record<string, number> = {};
  private readonly perfInit: Record<string, number> = {};
  private perfSteps = 0;
  private perfSim = 0;
  private perfWall = 0;
  private autoTune: SimPerf['autoTune'] = null;
  private snapWall = 0;
  private snapSim = 0;

  constructor(scenario: ScenarioData, o: SimulationOptions = {}) {
    this.clock = o.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.hooks = o.hooks ?? {};
    this.testHooks = o.testHooks ?? {};
    this.heatingOn = this.testHooks.surfaceHeating !== false;
    const c0 = this.clock();
    let c = c0;
    const mark = (name: string): void => {
      const now = this.clock();
      this.perfInit[name] = (this.perfInit[name] ?? 0) + now - c;
      c = now;
    };
    this.scenario = scenario;
    const terrain = (this.terrain = scenario.terrain);
    const g = terrain.grid;
    const fg = scenario.fuel.grid;
    if (fg.nx !== g.nx || fg.ny !== g.ny || Math.abs(fg.cellSize - g.cellSize) > 1e-9 || Math.abs(fg.x0 - g.x0) > 1e-6 || Math.abs(fg.y0 - g.y0) > 1e-6) {
      throw new Error('Simulation: fuel.grid must equal terrain.grid (spec §0.2 grid identity)');
    }
    const n = (this.n = g.nx * g.ny);
    this.startMs = scenario.startTime;
    this.duration = scenario.duration;
    this.lon = g.origin.lon;
    this.simOptions = { ...DEFAULT_SIM_OPTIONS, ...scenario.options };
    const so = this.simOptions;
    this.nextSnapshot = so.snapshotInterval > 0 ? so.snapshotInterval : 300;
    this.opts = {
      coupling: so.coupling,
      embers: so.embers,
      mountainPhenomena: so.mountainPhenomena,
      maxEmbersUser: null,
    };
    this.tierReq = o.tier ?? so.tier ?? 'auto';
    const buildTier: QualityTier = this.tierReq === 'auto' ? 'standard' : this.tierReq;
    this.tierNow = buildTier;
    const tierDefaultEmbers = SIM_PARAMS.maxEmbersByTier[this.tierReq === 'fast' ? 'fast' : 'standard'];
    if (scenario.options.maxEmbers !== undefined && scenario.options.maxEmbers !== tierDefaultEmbers) this.opts.maxEmbersUser = scenario.options.maxEmbers;
    this.rngEmbers = new Rng(so.seed);
    this.rngFire = new Rng(so.seed + 1);
    this.rngAtm = new Rng(so.seed + 3);
    this.rngs = { embers: this.rngEmbers, fire: this.rngFire, explain: new Rng(so.seed + 2), atmosphere: this.rngAtm };

    // ── terrain features ──
    this.derived = terrainDerived(terrain);
    this.features = computeTerrainFeatures(terrain, this.derived, scenario.terrainHiRes);
    mark('terrainFeatures');

    // ── fuel: immutable base + working copy; edits at t ≤ 0 applied now (§12.2 init) ──
    const base = cloneFuelMap(scenario.fuel as FuelMapExt);
    ensureFuelArrays(base);
    this.fuelBase = base;
    this.fuel = cloneFuelMap(base);
    this.history = scenario.fuelHistory ?? { recStart: new Uint32Array(n + 1), recIndex: new Uint32Array(0), tb: new Float64Array(0), kind: new Uint8Array(0) };
    for (const e of scenario.edits) this.addRecord({ kind: 'edit', edit: e }, e.kind === 'wind' ? Math.max(0, e.time) : 0);
    for (const ign of scenario.ignitions) this.addRecord({ kind: 'ignite', ignition: ign }, Math.max(0, ign.time));
    for (const r of [...this.records.values()].sort(recordOrder)) {
      if (r.time > 0 || r.body.kind !== 'edit') continue;
      if (r.body.edit.kind === 'fuel') applyFuelEdit(this.fuel, r.body.edit, this.fuelBase, this.history, this.startMs);
      this.markApplied(r.seq);
    }
    this.fbiFuel = dominantFuelType(this.fuel);
    mark('fuel');

    // ── drought, stable night, moisture spin-up ──
    const series = scenario.weather;
    let kbdi = series.kbdi;
    let df = series.droughtFactor;
    if (!(Number.isFinite(kbdi) && Number.isFinite(df))) {
      const d = droughtState(series.daily, series.annualRainfall);
      kbdi = Number.isFinite(kbdi) ? kbdi : d.kbdi;
      df = Number.isFinite(df) ? df : d.df;
      this.warnings.push(...d.warnings);
    }
    this.kbdi = kbdi!;
    this.droughtFactor = df!;
    this.night = spinUpStableNight(series, this.startMs);
    this.lastNightMs = this.startMs;
    this.moisture = new MoistureModel(terrain, this.fuel, this.derived);
    this.moisture.initialise(series, this.startMs, { kbdi: this.kbdi, df: this.droughtFactor }, this.night);
    this.testHooks.moisture?.(this.moisture.field, this.moisture.availability, 0);
    this.warnings.push(...this.moisture.warnings);
    mark('moistureSpinUp');

    // ── fire ──
    this.fire = new FireSpreadModel(terrain, this.fuel, this.features, so, this.rngFire);
    this.fire.setTime(0);
    mark('fireInit');

    // ── environment arrays ──
    const f32 = (v = 0): Float32Array => new Float32Array(n).fill(v);
    const w0 = weatherAt(series, this.startMs);
    const sun0 = solarPosition(this.startMs, g.origin.lat, g.origin.lon).elevation;
    this.env = {
      windU: f32(), windV: f32(), windBgU: f32(), windBgV: f32(), fireIndU: f32(), fireIndV: f32(), uRidge: f32(NaN),
      moisture: this.moisture.field, availability: this.moisture.availability, fuelTempC: this.moisture.fuelTemp,
      airT: f32(w0.temperature), airRho: f32(1.1),
      droughtFactor: this.droughtFactor, kbdi: this.kbdi, weather: w0, time: 0,
      sunElevation: sun0, lmstHour: lmstHour(this.startMs, this.lon), cloudFrac: clamp01((w0.cloudCover ?? 0) / 100),
      mountainPhenomena: this.opts.mountainPhenomena, pyrogenicOn: false, coupling: this.opts.coupling,
    };
    this.heatPrev = f32();
    this.crownPrev = f32();
    this.burntMask = new Uint8Array(n);
    this.headMask = new Uint8Array(n);
    this.headDirX = f32();
    this.headDirY = f32();
    this.u10 = f32();
    this.slopeFlowSigned = f32();
    const aux = this.fire.aux();
    this.windCtx = { sep: aux.sep, frontDist: aux.frontDist, firePowerW: 0, plumeTopAGL: 1000, slopeFlowOn: this.heatingOn, time: 0, coupling: this.opts.coupling };
    const B = SIM_PARAMS.frontRosBlock;
    this.frbNx = Math.ceil(g.nx / B);
    this.frbNy = Math.ceil(g.ny / B);
    this.frontRos = new Float32Array(this.frbNx * this.frbNy);

    // ── atmosphere of the build tier ──
    this.atm = this.buildAtmosphere(buildTier);
    mark('atmosphereInit');
    this.embers = this.buildEmbers(buildTier);
    this.updatePyrogenic();

    // ── explain engine + forecast cards ──
    this.explainEngine = new InsightEngine(terrain, this.derived, this.fuel, this.features, {
      startTime: this.startMs,
      fbiFuelType: this.fbiFuel,
      moistureBreakdown: (k) => this.moisture.breakdown(k),
    });
    this.forecastInsights = this.explainEngine.forecastInsights(series, this.startMs, this.duration, this.lon);
    mark('explainInit');

    // ── t0 winds (u_bg, κ-scaled) for the t0 snapshot and the moisture u10 ──
    this.fireWinds();
    mark('t0Winds');
    this.spinTotal = this.tierNow === 'fast' || o.skipSpinUp ? 0 : SIM_PARAMS.spinUpS;
    if (this.spinTotal === 0) this.finishSpinUp();
    this.perfInit['total'] = this.clock() - c0;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

  /** Simulation time (s from the scenario start). */
  get time(): number {
    return this.t;
  }

  /** The atmosphere tier in use. */
  get tier(): QualityTier {
    return this.tierNow;
  }

  /** True once the 3-D spin-up (and the auto-tune decision) is done and the t0 checkpoint exists. */
  get isReady(): boolean {
    return this.ready;
  }

  /** Current options (coupling, embers, mountain phenomena, max embers). */
  get options(): Readonly<{ coupling: number; embers: boolean; mountainPhenomena: boolean; maxEmbers: number }> {
    return { coupling: this.opts.coupling, embers: this.opts.embers, mountainPhenomena: this.opts.mountainPhenomena, maxEmbers: this.maxEmbersNow() };
  }

  /** Spot fires so far (copies). */
  get spotFires(): SpotFire[] {
    return this.spots.map(cloneSpot);
  }

  /** Times (s) of the checkpoints currently held (t0 first). */
  get checkpointTimes(): number[] {
    return [...(this.cp0 ? [this.cp0.time] : []), ...this.ring.map((c) => c.time)];
  }

  /** The "now" of the user: the replay target while a rewind is being re-run, else the simulation time. */
  get logicalNow(): number {
    return Math.max(this.t, this.replayTarget);
  }

  /**
   * 3-D spin-up (§12.2 init) in chunks: steps until done or the wall `deadline` (ms, same clock as `clock`) passes.
   * Returns true when finished (then the t0 checkpoint exists).
   */
  spinUp(deadline = Infinity): boolean {
    if (this.ready) return true;
    const P = SIM_PARAMS;
    if (this.spinDone === 0) {
      const sun = this.solarAt(this.startMs);
      this.atm.setNightState(this.night);
      if (this.heatingOn) this.atm.setSurfaceHeating(sun, this.env.weather, this.kbdi, this.night);
    }
    while (this.spinDone < this.spinTotal - EPS) {
      const dt = Math.min(this.atm.maxStableDt(), P.dtMaxS, this.spinTotal - this.spinDone);
      const c0 = this.clock();
      this.atm.step(dt);
      const ms = this.clock() - c0;
      this.addPerf('spinUp', ms, true);
      this.spinDone += dt;
      if (this.tierReq === 'auto' && this.spinTimed < P.autoTuneSteps) {
        this.spinTimed++;
        this.spinWall += ms;
        if (this.spinTimed === P.autoTuneSteps && this.autoTuneDecide()) {
          // Switched to the fast tier: no 3-D spin-up needed.
          this.spinDone = this.spinTotal;
          break;
        }
      }
      if (this.clock() > deadline) break;
    }
    if (this.spinDone >= this.spinTotal - EPS) this.finishSpinUp();
    return this.ready;
  }

  /**
   * Run whole atmosphere steps while t < until (clamped to the duration) or until the wall `deadline` passes / `shouldStop`
   * returns true. Returns true when `until` was reached.
   */
  advance(until: number, deadline = Infinity, shouldStop?: () => boolean): boolean {
    if (!this.ready) {
      if (!this.spinUp(deadline)) return false;
    }
    const target = Math.min(until, this.duration);
    while (this.t < target - EPS) {
      this.stepOnce();
      if (shouldStop?.() || this.clock() > deadline) break;
    }
    return this.t >= target - EPS;
  }

  /** Add an observed fire (spot / backburn); applies at ignition.time (a time in the past rewinds and replays). */
  ignite(ignition: Ignition): void {
    const time = Math.max(0, ignition.time);
    this.addUserRecord({ kind: 'ignite', ignition: { ...ignition, points: ignition.points.map((p) => [p[0], p[1]] as [number, number]) } }, time);
  }

  /** A fuel or wind edit applying from `time` (s). An edit with the id of an earlier one replaces it from `time`. */
  edit(edit: ScenarioEdit, time: number): void {
    this.addUserRecord({ kind: 'edit', edit: structuredCloneSafe(edit) }, Math.max(0, Number.isFinite(time) ? time : this.logicalNow));
  }

  /** Remove an edit from now on (the remaining edits are re-applied in order, §4.8). */
  removeEdit(id: string): void {
    this.addUserRecord({ kind: 'removeEdit', id }, this.logicalNow);
  }

  /**
   * Remove a marked ignition as if it had never been marked (undo a wrong mark): its record is deleted; when it had
   * already burnt, the latest checkpoint ≤ its time is restored and the run is repeated to the current logical time
   * without it. Snapshots and insights after the ignition time are emitted again (the rewound hook reports that time).
   * Returns false for an unknown id.
   */
  removeIgnition(id: string): boolean {
    let t = Infinity;
    let applied = false;
    for (const [seq, r] of [...this.records]) {
      if (r.body.kind !== 'ignite' || r.body.ignition.id !== id) continue;
      t = Math.min(t, r.time);
      if (this.appliedSet.has(seq)) applied = true;
      this.records.delete(seq);
    }
    if (!Number.isFinite(t)) return false;
    if (!this.ready) return true;
    const now = this.logicalNow;
    if (!applied) {
      // Not applied yet. If a replay is under way the results the receiver holds after t were computed with it.
      if (t < now - EPS) {
        this.dropCheckpointsAfter(t);
        this.suppressUntil = Math.min(this.suppressUntil, t);
        this.hooks.rewound?.(t);
      }
      return true;
    }
    const cp = this.checkpointAtOrBefore(t);
    if (!cp) return true;
    const pending = this.suppressUntil > this.t + EPS ? this.suppressUntil : Infinity;
    this.dropCheckpointsAfter(cp.time);
    this.restore(cp);
    this.replayTarget = now > this.t + EPS ? now : -Infinity;
    this.suppressUntil = Math.min(pending, t);
    this.hooks.rewound?.(t);
    return true;
  }

  /** Change an option from the next step (recorded at the current simulation time, §12.6). */
  setOption(key: SimOptionKey, value: number | boolean): void {
    this.addUserRecord({ kind: 'option', key, value }, this.logicalNow);
  }

  /**
   * Change the atmosphere tier (§12.6): restore the latest checkpoint ≤ now, rebuild the atmosphere for the new tier
   * and re-spin it for 900 s at the checkpoint time (a record at that time), then re-run to now. Results after the
   * checkpoint change: the rewound hook reports the checkpoint time and the re-run snapshots are emitted.
   */
  setQuality(tier: QualityTier): void {
    if (!this.ready) {
      // Still spinning up: rebuild for the requested tier and start the spin-up again (no records yet).
      this.tierReq = tier;
      if (tier !== this.tierNow) {
        this.tierNow = tier;
        this.atm = this.buildAtmosphere(tier);
        this.embers = this.buildEmbers(tier);
        this.updatePyrogenic();
        this.fireWinds();
      }
      this.spinDone = 0;
      this.spinTimed = 0;
      this.spinWall = 0;
      this.spinTotal = tier === 'fast' ? 0 : SIM_PARAMS.spinUpS;
      if (this.spinTotal === 0) this.finishSpinUp();
      return;
    }
    if (tier === this.tierNow && this.replayTarget === -Infinity) return;
    const now = this.logicalNow;
    const cp = this.checkpointAtOrBefore(now);
    if (!cp) return;
    this.addRecordRaw({ kind: 'quality', tier }, cp.time);
    this.dropCheckpointsAfter(cp.time);
    this.restore(cp);
    this.replayTarget = now;
    this.suppressUntil = -Infinity;
    this.hooks.rewound?.(cp.time);
  }

  /**
   * Rewind (§12.4): restore the latest checkpoint ≤ time, drop later spots/insights, and mark `time` as the replay
   * target (the caller runs `advance(time)`; snapshots up to `time` are not re-emitted). Option records later than
   * `time` move to `time`. Returns the checkpoint time.
   */
  rewind(time: number): number {
    const target = Math.max(0, Math.min(Number.isFinite(time) ? time : 0, this.duration));
    for (const r of this.records.values()) if (r.body.kind === 'option' && r.time > target) r.time = target;
    if (target >= this.t - EPS || !this.ready) {
      // Nothing after `target` has been computed (e.g. the UI's what-if at the head, or a second rewind during a
      // replay): no restore. The receiver keeps its results up to `target`; the ones up to the earlier suppression
      // point were already sent.
      if (this.replayTarget > target) this.replayTarget = target > this.t + EPS ? target : -Infinity;
      if (this.suppressUntil > target) this.suppressUntil = target;
      this.hooks.rewound?.(target);
      return this.t;
    }
    const cp = this.checkpointAtOrBefore(target);
    if (!cp) return this.t;
    // The receiver holds everything up to the target, except what an unfinished earlier replay has not re-sent yet.
    const pending = this.suppressUntil > this.t + EPS ? this.suppressUntil : Infinity;
    this.dropCheckpointsAfter(cp.time);
    this.restore(cp);
    this.replayTarget = target;
    this.suppressUntil = Math.min(pending, target);
    this.hooks.rewound?.(target);
    return cp.time;
  }

  /** "Why here?" (§10.4) at (x, y); `time` (s) evaluates arrival state at min(time, now). */
  explain(x: number, y: number, time?: number): CellExplanation {
    const tv = time !== undefined && Number.isFinite(time) ? Math.min(Math.max(0, time), this.t) : this.t;
    return this.explainEngine.explainAt(x, y, this.view(tv));
  }

  /** A snapshot of the current state (copies). Includes the pending new insights (and clears them). */
  snapshot(): SimSnapshot {
    return this.makeSnapshot();
  }

  /** Current stats (§12.3). */
  stats(): SimStats {
    return this.makeStats();
  }

  /** Performance monitor: cumulative wall time per module (ms). */
  perf(): SimPerf {
    return { steps: this.perfSteps, simSeconds: this.perfSim, wallMs: this.perfWall, modules: { ...this.perfMods }, init: { ...this.perfInit }, tier: this.tierNow, autoTune: this.autoTune };
  }

  /** Reset the performance counters (e.g. after warm-up). */
  resetPerf(): void {
    for (const k of Object.keys(this.perfMods)) delete this.perfMods[k];
    this.perfSteps = 0;
    this.perfSim = 0;
    this.perfWall = 0;
  }

  /** Approximate bytes held by checkpoints (memory budget, §13). */
  checkpointBytes(): number {
    return (this.cp0?.bytes ?? 0) + this.ring.reduce((a, c) => a + c.bytes, 0);
  }

  /** Read-only state view for tests and the developer panel. */
  stateView(): SimStateView {
    return this.view(this.t);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Records
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

  private addRecordRaw(body: RecordBody, time: number): SimRecord {
    const r: SimRecord = { seq: this.recordSeq++, time, body };
    this.records.set(r.seq, r);
    return r;
  }

  private addRecord(body: RecordBody, time: number): SimRecord {
    return this.addRecordRaw(body, time);
  }

  /** A user record: a time before now rewinds to it; checkpoints after it are dropped. */
  private addUserRecord(body: RecordBody, time: number): void {
    const now = this.logicalNow;
    this.addRecordRaw(body, time);
    if (!this.ready) return;
    this.dropCheckpointsAfter(time);
    if (time < this.t - EPS) {
      this.rewind(time);
    } else if (time < now - EPS) {
      // A replay is running and has not reached the record yet: results after it will differ.
      this.suppressUntil = Math.min(this.suppressUntil, time);
      this.hooks.rewound?.(time);
    }
  }

  private markApplied(seq: number): void {
    this.applied.push(seq);
    this.appliedSet.add(seq);
  }

  /** §12.2 step 1: records with time ≤ t in (time, seq) order. */
  private applyDueRecords(t: number): void {
    let due: SimRecord[] | null = null;
    for (const r of this.records.values()) {
      if (r.time <= t + EPS && !this.appliedSet.has(r.seq)) (due ??= []).push(r);
    }
    if (!due) return;
    due.sort(recordOrder);
    for (const r of due) this.applyRecord(r, t);
  }

  private applyRecord(r: SimRecord, t: number): void {
    const b = r.body;
    const before = b.kind === 'edit' || b.kind === 'removeEdit' ? activeEdits(this.records, this.applied) : null;
    this.markApplied(r.seq);
    switch (b.kind) {
      case 'ignite':
        this.fire.ignite(b.ignition);
        break;
      case 'edit': {
        if (b.edit.kind === 'fuel') {
          const replaces = before!.fuel.some((e) => e.id === b.edit.id);
          if (replaces) this.rebuildFuel(activeEdits(this.records, this.applied).fuel);
          else {
            applyFuelEdit(this.fuel, b.edit, this.fuelBase, this.history, this.startMs);
            this.afterFuelChange(cellsInBrush(this.fuel.grid, b.edit.shape));
          }
        } else this.setWindEdits(activeEdits(this.records, this.applied).wind);
        break;
      }
      case 'removeEdit': {
        const wasFuel = before!.fuel.some((e) => e.id === b.id);
        const wasWind = before!.wind.some((e) => e.id === b.id);
        const after = activeEdits(this.records, this.applied);
        if (wasFuel) this.rebuildFuel(after.fuel);
        if (wasWind) this.setWindEdits(after.wind);
        break;
      }
      case 'option':
        this.applyOption(b.key, b.value);
        break;
      case 'quality':
        this.switchTier(b.tier, t);
        break;
    }
  }

  /** Hand the active wind edits to the atmosphere (re-solves u_bg of the cached stamps) when they changed. */
  private setWindEdits(list: readonly WindEdit[]): void {
    const key = windKey(list);
    if (key === this.atmWindKey) return;
    this.atmWindKey = key;
    this.atm.setWindEdits(list as WindEdit[], this.startMs);
    this.windDirty = true;
  }

  private applyOption(key: SimOptionKey, value: number | boolean): void {
    switch (key) {
      case 'coupling': {
        const c = Math.max(0, Math.min(1.5, Number(value)));
        this.opts.coupling = Number.isFinite(c) ? c : 1;
        this.atm.setCoupling(this.opts.coupling);
        this.updatePyrogenic();
        break;
      }
      case 'embers':
        this.opts.embers = Boolean(value);
        break;
      case 'mountainPhenomena':
        this.opts.mountainPhenomena = Boolean(value);
        this.env.mountainPhenomena = this.opts.mountainPhenomena;
        this.embers.setEnvironment({ mountainPhenomena: this.opts.mountainPhenomena });
        break;
      case 'maxEmbers': {
        const m = Math.floor(Number(value));
        if (m > 0) {
          this.opts.maxEmbersUser = m;
          this.embers.setMaxEmbers(m);
        }
        break;
      }
    }
  }

  private updatePyrogenic(): void {
    this.windDirty = true;
    this.env.coupling = this.opts.coupling;
    this.env.pyrogenicOn = this.tierNow === 'fast' && this.opts.coupling > 0;
    this.windCtx.coupling = this.opts.coupling;
  }

  private maxEmbersNow(): number {
    return this.opts.maxEmbersUser ?? SIM_PARAMS.maxEmbersByTier[this.tierNow];
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Fuel edits
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

  /** Rebuild the working fuel map in place from the base and an ordered edit list (removals / replacements). */
  private rebuildFuel(list: readonly ScenarioEdit[]): void {
    const fresh = cloneFuelMap(this.fuelBase as FuelMapExt);
    for (const e of list) if (e.kind === 'fuel') applyFuelEdit(fresh, e, this.fuelBase, this.history, this.startMs);
    const dst = this.fuel as unknown as Record<string, unknown>;
    const src = fresh as unknown as Record<string, unknown>;
    for (const [key, v] of Object.entries(src)) {
      if (!ArrayBuffer.isView(v)) continue;
      const d = dst[key];
      if (ArrayBuffer.isView(d) && (d as Float32Array).length === (v as Float32Array).length && d.constructor === v.constructor) (d as Float32Array).set(v as Float32Array);
      else dst[key] = v;
    }
    for (const [key, d] of Object.entries(dst)) {
      if (!ArrayBuffer.isView(d) || key in src) continue;
      // Arrays created by earlier edits (e.g. syntheticBurnTime): absent in the base = NaN / 0.
      if (d instanceof Float64Array || d instanceof Float32Array) d.fill(NaN);
      else (d as Uint8Array).fill(0);
    }
    this.afterFuelChange(null);
  }

  private afterFuelChange(cells: Int32Array | null): void {
    if (cells && cells.length === 0) return;
    this.fire.refreshFuel(cells);
    this.moisture.refreshFuel(cells ?? undefined);
    this.explainEngine.refreshFuel();
    this.moistureDirty = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Atmosphere / embers construction and tiers
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

  private buildAtmosphere(tier: QualityTier): Atmos {
    const s = this.scenario;
    const wind = activeEdits(this.records, this.applied).wind;
    this.atmWindKey = windKey(wind);
    const a = createAtmosphere(this.terrain, s.terrainHiRes, this.fuel, this.features, tier, s.extent, s.weather, this.rngAtm, {
      coupling: this.opts.coupling,
      scenarioStartMs: this.startMs,
      windEdits: wind as WindEdit[],
    });
    const hs = s.weather.hours;
    const tMs = this.startMs + this.t * 1000;
    this.stampIdx = Math.max(0, Math.min(stampIndex(hs, tMs), hs.length - 2));
    a.setAmbient(hs[this.stampIdx]!, hs[Math.min(this.stampIdx + 1, hs.length - 1)]!);
    a.setTime(tMs);
    a.setNightState(this.night);
    return a;
  }

  private buildEmbers(tier: QualityTier): EmberModel {
    const onLanding = this.testHooks.emberLanding;
    const m = new EmberModel(this.terrain, this.fuel, { maxEmbers: this.opts.maxEmbersUser ?? SIM_PARAMS.maxEmbersByTier[tier], tier, loft: SIM_PARAMS.emberLoft, ...(onLanding ? { onLanding } : {}) }, this.rngEmbers);
    m.setEnvironment(this.emberEnv());
    return m;
  }

  private emberEnv(): Parameters<EmberModel['setEnvironment']>[0] {
    const w = this.env.weather;
    const f = this.features;
    return {
      weather: w,
      uRidge: this.env.uRidge,
      sep: this.fire.aux().sep,
      crest: (k: number, from: number) => f.crest(k, from),
      mountainPhenomena: this.opts.mountainPhenomena,
      temperatureC: w.temperature,
      // Every scalar is always given: setEnvironment merges with the previous environment, and a key missing here
      // would survive a restore (the checkpoint's environment is merged into the current one).
      nSquared: this.diag && Number.isFinite(this.diag.nSquared) && this.diag.nSquared > 0 ? this.diag.nSquared : 1e-4,
      modelTopAGL: this.tierNow !== 'fast' ? this.simOptions.atmosTop : Infinity,
    };
  }

  /** Auto-tune (§12.6) from the mean wall time of the first 20 standard spin-up steps. Returns true if switched to fast. */
  private autoTuneDecide(): boolean {
    const P = SIM_PARAMS;
    const stepMs = this.spinWall / Math.max(1, this.spinTimed);
    const predictedS = (P.autoTuneOverhead * stepMs * (this.duration / P.autoTuneStepS)) / 1000;
    const budgetS = Math.max(P.autoTuneMinBudgetS, (P.autoTuneBudgetS * this.duration) / P.autoTuneBudgetRefS);
    const chosen: QualityTier = predictedS <= budgetS ? 'standard' : 'fast';
    this.autoTune = { stepMs, predictedS, budgetS, chosen };
    if (chosen === 'fast') {
      this.tierNow = 'fast';
      this.atm = this.buildAtmosphere('fast');
      this.embers = this.buildEmbers('fast');
      this.updatePyrogenic();
      this.fireWinds();
      return true;
    }
    return false;
  }

  private finishSpinUp(): void {
    if (this.ready) return;
    this.ready = true;
    this.cp0 = this.makeCheckpoint();
  }

  /** Record-driven tier change at time t (§12.6): rebuild the atmosphere and embers, re-spin 900 s (3-D tiers). */
  private switchTier(tier: QualityTier, t: number): void {
    if (tier === this.tierNow) return;
    const emberState = this.embers.checkpoint();
    this.tierNow = tier;
    this.atm = this.buildAtmosphere(tier);
    this.embers = this.buildEmbers(tier);
    this.embers.restore(emberState);
    if (this.opts.maxEmbersUser === null) this.embers.setMaxEmbers(SIM_PARAMS.maxEmbersByTier[tier]);
    this.updatePyrogenic();
    if (tier !== 'fast') {
      // The insolation of the last solar update (recomputed identically after a restore, when lastSun is null).
      const sunMs = Number.isFinite(this.lastSunMs) ? this.lastSunMs : this.startMs + t * 1000;
      const sun = this.lastSun ?? this.solarAt(sunMs, false);
      if (this.heatingOn) this.atm.setSurfaceHeating(sun, this.env.weather, this.kbdi, this.night);
      let s = 0;
      while (s < SIM_PARAMS.spinUpS - EPS) {
        const dt = Math.min(this.atm.maxStableDt(), SIM_PARAMS.dtMaxS, SIM_PARAMS.spinUpS - s);
        if (this.opts.coupling > 0) this.atm.addFireHeat(this.terrain.grid, this.heatPrev, this.crownPrev);
        this.atm.step(dt);
        s += dt;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // The coupling loop (§12.2)
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

  private stepOnce(): void {
    const P = SIM_PARAMS;
    const c0 = this.clock();
    let c = c0;
    const lap = (name: string): void => {
      const now = this.clock();
      this.perfMods[name] = (this.perfMods[name] ?? 0) + now - c;
      c = now;
    };
    const t = this.t;
    const tMs = this.startMs + t * 1000;
    const env = this.env;
    const series = this.scenario.weather;
    const grid = this.terrain.grid;

    // 1 records and scheduled spot ignitions
    this.applyDueRecords(t);
    this.applyPendingSpots(t);
    lap('records');

    // 2 stamps, weather, stable night
    const hs = series.hours;
    while (this.stampIdx < hs.length - 2 && tMs >= hs[this.stampIdx + 1]!.time) {
      this.stampIdx++;
      this.atm.setAmbient(hs[this.stampIdx]!, hs[this.stampIdx + 1]!);
      this.windDirty = true;
    }
    this.atm.setTime(tMs);
    lap('stamps');
    const w = weatherAt(series, tMs);
    const sunPos = solarPosition(tMs, grid.origin.lat, grid.origin.lon);
    env.weather = w;
    env.time = t;
    env.sunElevation = sunPos.elevation;
    env.lmstHour = lmstHour(tMs, this.lon);
    env.cloudFrac = clamp01((w.cloudCover ?? 0) / 100);
    const solarDue = t >= this.nextSolar - EPS;
    let breakEta: number | null | undefined;
    if (solarDue && this.tierNow !== 'fast') breakEta = this.atm.diagnostics().inversion.breakEta;
    const ni = stableNightInputAt(series, tMs, rainBefore(series, tMs, 24));
    if (breakEta !== undefined) ni.breakEta = breakEta;
    stableNight(this.night, ni, Math.max(0, (tMs - this.lastNightMs) / 1000));
    this.lastNightMs = tMs;
    this.atm.setNightState(this.night);
    lap('weatherNight');

    // 3 insolation, surface heating, moisture (every 600 s and at t0)
    if (solarDue) {
      const sun = this.solarAt(tMs);
      if (this.heatingOn) this.atm.setSurfaceHeating(sun, w, this.kbdi, this.night);
      const dtM = Number.isFinite(this.lastSolarT) ? t - this.lastSolarT : 0;
      this.moisture.update(w, sun, Math.max(0, dtM), this.moistureCtx(tMs, sunPos.elevation, w));
      this.testHooks.moisture?.(this.moisture.field, this.moisture.availability, t);
      this.fire.refreshMoistureCache(env);
      this.lastSolarT = t;
      this.nextSolar = (Math.floor(t / P.solarIntervalS + EPS) + 1) * P.solarIntervalS;
      this.moistureDirty = false;
    } else if (this.moistureDirty) {
      // Fuel edit (moisture offsets, new fuel): re-diagnose the outputs without advancing the state (Δt = 0).
      const sun = this.lastSun ?? this.solarAt(Number.isFinite(this.lastSunMs) ? this.lastSunMs : tMs, false);
      this.moisture.update(w, sun, 0, this.moistureCtx(tMs, sunPos.elevation, w));
      this.testHooks.moisture?.(this.moisture.field, this.moisture.availability, t);
      this.fire.refreshMoistureCache(env);
      this.moistureDirty = false;
    }
    lap('solarMoisture');

    // 4 masks and the wind for the fire
    const sector = Math.round(wrapDeg(w.windDir10) / P.sectorDeg) % Math.round(360 / P.sectorDeg);
    if (t >= this.nextMask - EPS || sector !== this.lastSector) {
      this.fire.refreshMasks(env);
      this.lastSector = sector;
      if (t >= this.nextMask - EPS) this.nextMask = (Math.floor(t / P.minuteS + EPS) + 1) * P.minuteS;
      lap('fireMasks');
    }
    const fastWind = this.tierNow === 'fast' && P.fastWindIntervalS > 0;
    // Also on every checkpoint boundary: the step after a restore starts there, so both runs recompute it.
    const cpBoundary = Math.abs(t / P.checkpointIntervalS - Math.round(t / P.checkpointIntervalS)) < 1e-9;
    if (!fastWind || this.windDirty || cpBoundary || t >= this.nextWind - EPS) {
      this.fireWinds();
      if (fastWind) {
        // Next: the step after the next pyrogenic solve (which runs in the step starting on an interval boundary).
        this.nextWind = (Math.floor(t / P.fastWindIntervalS + EPS) + 1) * P.fastWindIntervalS + 1e-3;
      }
      this.windDirty = false;
    }
    lap('surfaceWind');

    // Δt_a: the tier bound; the rest of the minute is split into equal steps so t lands on the 60 s boundary.
    const dtMax = this.tierNow === 'fast' ? this.atm.maxStableDt() : Math.min(this.atm.maxStableDt(), P.dtMaxS);
    const boundary = (Math.floor(t / P.minuteS + EPS) + 1) * P.minuteS;
    const rem = boundary - t;
    const nSteps = Math.max(1, Math.ceil(rem / dtMax - 1e-9));
    const dt = nSteps === 1 ? rem : rem / nSteps;
    const tEnd = nSteps === 1 ? boundary : t + dt;

    // 5–6 fire
    this.fire.prepare(env);
    lap('firePrepare');
    this.fire.step(dt, env);
    for (const d of this.fire.takeDebrisIgnitions()) this.addSpot(d.x, d.y, d.time, d.travel, null, d.sourceCell);
    this.fire.takeBreachEvents();
    lap('fireStep');

    // 7 fire heat of the PREVIOUS step, atmosphere step
    if (this.opts.coupling > 0) this.atm.addFireHeat(grid, this.heatPrev, this.crownPrev);
    lap('fireHeat');
    this.atm.step(dt);
    this.heatPrev.set(this.fire.heatRelease());
    this.crownPrev.set(this.fire.crownShare());
    lap('atmosphere');

    // 8 embers
    if (this.opts.embers) {
      const aux = this.fire.aux();
      this.embers.emit(this.fire.field, this.fuel, this.fire.frontCells(), dt, t, aux);
      this.embers.step(dt, this.windFn, this.turbFn, this.landingFn, this.igniteFn);
      lap('embers');
    }

    // 9 minute tasks, diagnostics, detectors
    if (tEnd >= this.nextMinute - EPS) {
      this.fire.minuteTasks(env);
      const aux = this.fire.aux();
      frontRosBlocks(this.fire.field, aux, P.frontRosBlock, this.frontRos, this.frbNx);
      lap('fireMinute');
      this.diag = this.atm.diagnostics();
      this.plumeTopAGL = this.plumeTop();
      this.embers.setEnvironment(this.emberEnv());
      lap('diagnostics');
      const ins = this.explainEngine.update(this.view(tEnd));
      if (ins.length) this.pendingInsights.push(...ins);
      this.nextMinute = (Math.floor(tEnd / P.minuteS + EPS) + 1) * P.minuteS;
      lap('explain');
    }

    // 10 advance the clock; snapshots and checkpoints
    this.t = tEnd;
    this.perfSteps++;
    this.perfSim += dt;
    if (this.replayTarget > -Infinity && this.t >= this.replayTarget - EPS) this.replayTarget = -Infinity;
    if (this.suppressUntil > -Infinity && this.t >= this.suppressUntil - EPS) {
      // The receiver kept the insights up to the suppression horizon (rewind target): do not send them twice.
      const keep = this.suppressUntil;
      if (this.pendingInsights.some((i) => i.time <= keep + EPS)) this.pendingInsights = this.pendingInsights.filter((i) => i.time > keep + EPS);
    }
    const interval = this.simOptions.snapshotInterval > 0 ? this.simOptions.snapshotInterval : 300;
    if (this.t >= this.nextSnapshot - EPS) {
      this.nextSnapshot = (Math.floor(this.t / interval + EPS) + 1) * interval;
      if (this.t <= this.suppressUntil + EPS || !this.hooks.snapshot) {
        // Not emitted (replay of results the receiver kept): keep the side effects of a snapshot (the ember overlay
        // rasters decay lazily when read) so later snapshots stay bitwise identical to an uninterrupted run.
        if (this.opts.embers) this.embers.overlays();
        if (this.t <= this.suppressUntil + EPS) this.pendingInsights = [];
      } else this.hooks.snapshot(this.makeSnapshot());
      lap('snapshot');
    }
    if (this.suppressUntil > -Infinity && this.t > this.suppressUntil + EPS) this.suppressUntil = -Infinity;
    if (this.t >= this.nextCheckpoint - EPS) {
      this.nextCheckpoint = (Math.floor(this.t / P.checkpointIntervalS + EPS) + 1) * P.checkpointIntervalS;
      this.ring.push(this.makeCheckpoint());
      while (this.ring.length > P.checkpointRing) this.ring.shift();
      let bytes = this.ring.reduce((a, c) => a + c.bytes, 0);
      while (this.ring.length > 1 && bytes > P.checkpointMaxBytes) bytes -= this.ring.shift()!.bytes;
      lap('checkpoint');
    }
    this.perfWall += this.clock() - c0;
  }

  /** §12.2 step 4: U_fire, U_bg10, U_fireInd, U_ridge and near-surface T/ρ on the fire grid. */
  private fireWinds(): void {
    const env = this.env;
    const ctx = this.windCtx;
    const aux = this.fire.aux();
    ctx.sep = aux.sep;
    ctx.frontDist = aux.frontDist;
    ctx.firePowerW = this.fire.firePowerW();
    ctx.plumeTopAGL = Number.isFinite(this.plumeTopAGL) && this.plumeTopAGL > 0 ? this.plumeTopAGL : 1000;
    ctx.time = env.time;
    ctx.coupling = this.opts.coupling;
    if (this.opts.coupling > 0) {
      // §8.8 pyrogenic correction on the prepared cells of the last prepare with their local front normal (see
      // SIM_PARAMS.pyroCorrectionMinDirection), not the atmosphere's fallback (ê = background wind direction), which
      // removes nothing in calm air and the wrong component when the head is not downwind (calm or cross-wind slopes).
      // 3-D tiers: the head cells of the resolved head correction (ATMOS_PARAMS.resolvedHeadCorrection).
      const fast = this.tierNow === 'fast';
      this.fire.headCells(this.headMask, this.headDirX, this.headDirY, fast ? SIM_PARAMS.pyroCorrectionMinDirection : SIM_PARAMS.resolvedHeadMinDirection);
      ctx.headMask = this.headMask;
      ctx.headDirX = this.headDirX;
      ctx.headDirY = this.headDirY;
    } else {
      delete ctx.headMask;
      delete ctx.headDirX;
      delete ctx.headDirY;
    }
    const g = this.terrain.grid;
    this.atm.surfaceWindForFire(g, env.windU, env.windV, env.windBgU, env.windBgV, env.fireIndU, env.fireIndV, env.uRidge, ctx as FireWindContext);
    const c1 = this.clock();
    this.atm.airAt(g, env.airT, env.airRho);
    this.u10Valid = false;
    this.perfMods['airAt'] = (this.perfMods['airAt'] ?? 0) + this.clock() - c1;
  }

  /** Plume top (m AGL) for the fire-influence mask: the atmosphere's 1-D plume, else the embers' Briggs height. */
  private plumeTop(): number {
    const d = this.diag;
    if (d && Number.isFinite(d.plumeTopASL) && d.firePowerMW > 0) {
      const aux = this.fire.aux();
      const k = aux.headIndex >= 0 ? aux.headIndex : -1;
      const z0 = k >= 0 ? this.terrain.elevation[k]! : this.terrain.minElevation;
      const top = d.plumeTopASL - z0;
      if (top > 0) return top;
    }
    const e = this.embers.stats().plumeTopAGL;
    return Number.isFinite(e) && e > 0 ? e : NaN;
  }

  private moistureCtx(tMs: number, sunEl: number, w: WeatherHour): Parameters<MoistureModel['update']>[3] {
    const env = this.env;
    const n = this.n;
    const u10 = this.u10Now();
    const tArr = this.fire.field.arrivalTime;
    const bm = this.burntMask;
    const lim = this.t + EPS;
    for (let k = 0; k < n; k++) bm[k] = tArr[k]! <= lim ? 1 : 0;
    const month = new Date(tMs + (this.lon / 15) * 3.6e6).getUTCMonth() + 1;
    const useAirT = this.tierNow !== 'fast' && this.atm.spunUp && this.opts.mountainPhenomena;
    return {
      time: tMs,
      lmstHour: lmstHour(tMs, this.lon),
      month,
      sunElevation: sunEl,
      cloudFrac: clamp01((w.cloudCover ?? 0) / 100),
      u10,
      ...(useAirT ? { airT: env.airT } : {}),
      burnt: bm,
      kbdi: this.kbdi,
      df: this.droughtFactor,
      night: this.night,
    };
  }

  /** |U_bg10| on the fire grid (the moisture u10): from the last surface-wind call, or restored from a checkpoint. */
  private u10Now(): Float32Array {
    if (!this.u10Valid) {
      const env = this.env;
      const u10 = this.u10;
      for (let k = 0; k < this.n; k++) {
        const a = env.windBgU[k]!;
        const b = env.windBgV[k]!;
        u10[k] = Math.sqrt(a * a + b * b);
      }
      this.u10Valid = true;
    }
    return this.u10;
  }

  /** Insolation on the fire grid at tMs (§12.2 step 3, D48: ghi = k_t(t)·GHI_clear(t)). */
  private solarAt(tMs: number, keep = true): InsolationResult {
    const series = this.scenario.weather;
    const w = weatherAt(series, tMs);
    const ghi = ghiAt(series, tMs);
    const sun = insolation(this.terrain, tMs, { ...(ghi !== undefined && Number.isFinite(ghi) ? { ghi } : {}), ...(w.cloudCover !== undefined ? { cloudCover: w.cloudCover } : {}) });
    if (keep) {
      this.lastSun = sun;
      this.lastSunMs = tMs;
    }
    return sun;
  }

  // ── embers callbacks (bound once) ──
  private readonly windFn = (x: number, y: number, z: number, out: Float32Array): void => this.atm.sample(x, y, z, out);
  private readonly turbFn = (x: number, y: number, z: number, out: Float32Array): void => this.atm.sampleTurb(x, y, z, out);
  private readonly igniteFn = (x: number, y: number, travel: number, prov: SpotProvenance): void => {
    this.pendingSpots.push({ x, y, travel, prov: cloneProv(prov) });
  };
  private readonly landingFn = (x: number, y: number): LandingInfo => {
    const g = this.terrain.grid;
    const k = cellAt(g, x, y);
    if (k < 0) {
      return {
        moisture: 100, fuelType: FuelType.NonFuel, burnable: false, burnt: false, fuelTempC: 20, surfaceHazard: 0, nearSurfaceHazard: 0, family: 'none',
        curing: 0, bedWindMs: 0, distToFront: Infinity, frontDirX: 0, frontDirY: 0, rosLocal: 0,
      };
    }
    const p = fuelParamsInto(this.fuel, k, this.scratchFuel);
    const f = this.fire.field;
    const aux = this.fire.aux();
    const fd = aux.frontDist;
    const d = fd[k]!;
    // Unit vector from the nearest front to the landing point: the gradient of the distance map.
    const i = k % g.nx;
    const j = (k - i) / g.nx;
    const dl = i > 0 ? fd[k - 1]! : d;
    const dr = i < g.nx - 1 ? fd[k + 1]! : d;
    const ddn = j > 0 ? fd[k - g.nx]! : d;
    const dup = j < g.ny - 1 ? fd[k + g.nx]! : d;
    let gx = Number.isFinite(dl) && Number.isFinite(dr) ? dr - dl : 0;
    let gy = Number.isFinite(ddn) && Number.isFinite(dup) ? dup - ddn : 0;
    const gn = Math.hypot(gx, gy);
    if (gn > 0) {
      gx /= gn;
      gy /= gn;
    }
    const wrf = p.wrf > 0 ? p.wrf : 1;
    const ub = Math.hypot(this.env.windBgU[k]!, this.env.windBgV[k]!);
    return {
      moisture: this.moisture.field[k]!,
      fuelType: p.type,
      burnable: p.family !== 'none' && f.burnState[k] !== BurnState.NonFlammable,
      burnt: f.arrivalTime[k]! < Infinity,
      fuelTempC: this.moisture.fuelTemp[k]!,
      surfaceHazard: p.fhsS,
      nearSurfaceHazard: p.fhsNs,
      family: p.family,
      curing: p.curing,
      bedWindMs: ub / (2 * wrf),
      distToFront: d,
      frontDirX: gx,
      frontDirY: gy,
      rosLocal: frontRosAt(g, this.frontRos, SIM_PARAMS.frontRosBlock, this.frbNx, this.frbNy, k),
    };
  };

  /** §12.2 step 1: spot ignitions scheduled by the ember model in the previous step. */
  private applyPendingSpots(t: number): void {
    if (!this.pendingSpots.length) return;
    const list = this.pendingSpots;
    this.pendingSpots = [];
    for (const s of list) this.addSpot(s.x, s.y, t, s.travel, s.prov, s.prov.sourceCell);
  }

  /** Ignite a spot fire (ember or debris) and record it with its provenance when the cell caught. */
  private addSpot(x: number, y: number, time: number, travel: number, prov: SpotProvenance | null, sourceCell: number): void {
    const g = this.terrain.grid;
    const k = cellAt(g, x, y);
    const distance = k >= 0 ? this.fire.aux().frontDist[k]! : NaN;
    // Debris ignitions were already applied by the fire model; ember spots are ignited here.
    if (prov && !this.fire.igniteAt(x, y, time, SpreadDriver.Spotting)) return;
    if (!prov && k >= 0 && !(this.fire.field.arrivalTime[k]! < Infinity)) return;
    const si = sourceCell >= 0 && sourceCell < this.n ? sourceCell % g.nx : -1;
    const sj = si >= 0 ? (sourceCell - si) / g.nx : -1;
    const spot: SpotFire = {
      id: this.nextSpotId++,
      x,
      y,
      time,
      distance: Number.isFinite(distance) ? distance : travel,
      travel,
      emberClass: prov ? prov.emberClass : 'heavy',
      ...(si >= 0 ? { sourceX: g.x0 + si * g.cellSize, sourceY: g.y0 + sj * g.cellSize } : {}),
      ...(prov
        ? { maxHeightAGL: prov.maxHeightAGL, flightTime: prov.flightTime, landingMoisture: prov.landingMoisture, pIgnite: prov.pIgnite, leeEddy: prov.leeEddy, ridgeDrop: prov.ridgeDrop }
        : {}),
    };
    this.spots.push(spot);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // View, stats, snapshots
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

  /**
   * `slopeFlowS` of the view: the atmosphere's S_top (a speed, §8.6) signed along the fall line — + upslope
   * (anabatic, Q_h ≥ 0), − downslope (katabatic, Q_h < 0) — so the §10.2 "upslope component of the thermal wind"
   * (resolved U_dyn − U_bg along ψ_up plus slopeFlowS) does not count a shaded slope's drainage flow as upslope.
   */
  private signedSlopeFlow(d: AtmosDiagnostics): Float32Array {
    const sf = d.slopeFlow;
    const qh = d.heatFlux;
    const out = this.slopeFlowSigned;
    if (sf.length !== out.length || qh.length !== out.length) return sf;
    for (let k = 0; k < out.length; k++) out[k] = qh[k]! < 0 ? -sf[k]! : sf[k]!;
    return out;
  }

  private view(time: number): SimStateView {
    const env = this.env;
    const fire = this.fire;
    const d = this.diag ?? this.atm.diagnostics();
    this.diag = d;
    const emberStats: EmberStats = this.embers.stats();
    return {
      time,
      terrain: this.terrain,
      derived: this.derived,
      features: this.features,
      fuel: this.fuel,
      fire: fire.field,
      aux: fire.aux(),
      moisture: this.moisture.field,
      moistureAfdrs: this.moisture.afdrs,
      moistureAnomaly: this.moisture.anomaly,
      availability: this.moisture.availability,
      windU: env.windU,
      windV: env.windV,
      windBgU: env.windBgU,
      windBgV: env.windBgV,
      fireIndU: env.fireIndU,
      fireIndV: env.fireIndV,
      uRidge: env.uRidge,
      surfaceHeatFlux: d.heatFlux,
      slopeFlowS: this.signedSlopeFlow(d),
      airT: env.airT,
      airRH: this.moisture.airRH,
      weather: env.weather,
      series: this.scenario.weather,
      droughtFactor: this.droughtFactor,
      kbdi: this.kbdi,
      sunElevation: env.sunElevation,
      lmstHour: env.lmstHour,
      cloudFrac: env.cloudFrac,
      night: this.night,
      spotFires: this.spots,
      emberStats,
      atmosDiag: d,
      tier: this.tierNow,
      coupling: this.opts.coupling,
      factorsAt: (k: number) => fire.factorsAt(k),
      evaluateCell: (k: number) => fire.evaluateCell(k, env),
    };
  }

  private makeStats(): SimStats {
    const f = this.fire.field;
    const aux = this.fire.aux();
    const fs = fireStats(f, aux, this.t);
    const es = this.embers.stats();
    const w = weatherAt(this.scenario.weather, this.startMs + this.t * 1000);
    const u10kmh = 3.6 * w.windSpeed10;
    let rating = 'No rating';
    try {
      rating = afdrsFbi(this.fbiFuel, w, this.lon, this.droughtFactor, this.kbdi).rating;
    } catch {
      /* keep the default */
    }
    const wallPerMin = this.snapSim > 0 ? (this.snapWall / this.snapSim) * 60 : 0;
    return {
      time: this.t,
      burntAreaHa: fs.burntAreaHa,
      burningCells: fs.burningCells,
      perimeterKm: fs.perimeterKm,
      maxRos: fs.maxRos,
      maxIntensity: fs.maxIntensity,
      headDir: fs.headDir,
      headRos: fs.headRos,
      activeEmbers: this.opts.embers ? es.active : 0,
      spotFires: this.spots.length,
      embersLeftDomain: es.leftDomain,
      convectiveNumber: fs.convectiveNumber,
      weather: w,
      deadFuelMoistureMean: moistureMean(this.moisture.field, f, aux.frontDist, fs.burntCells > 0),
      ffdi: ffdi(w.temperature, w.relativeHumidity, u10kmh, this.droughtFactor),
      fireDangerRating: rating,
      msPerSimMinute: wallPerMin,
    };
  }

  private makeSnapshot(): SimSnapshot {
    const P = SIM_PARAMS;
    // Wall time per simulated minute over the last snapshot interval.
    const wall = this.perfWall;
    const sim = this.perfSim;
    this.snapWall = wall - (this.lastSnapPerf?.wall ?? 0);
    this.snapSim = sim - (this.lastSnapPerf?.sim ?? 0);
    this.lastSnapPerf = { wall, sim };
    const f = this.fire.field;
    const fire = {
      grid: { ...f.grid, origin: { ...f.grid.origin } },
      arrivalTime: f.arrivalTime.slice(),
      burnState: f.burnState.slice(),
      ros: f.ros.slice(),
      intensity: f.intensity.slice(),
      flameHeight: f.flameHeight.slice(),
      spreadDir: f.spreadDir.slice(),
      driver: f.driver.slice(),
      phase: f.phase.slice(),
    };
    const aux = this.fire.aux();
    const layers: Record<string, Float32Array> = {
      vls: aux.vls.slice(),
      attach: aux.attach.slice(),
      trench: this.features.trench.slice(),
      landing: this.opts.embers ? this.embers.overlays().landing.slice() : new Float32Array(this.n),
    };
    const dmz = this.explainEngine.layers()['dmz'];
    if (dmz) layers['dmz'] = dmz.slice();
    let atmosphere = this.atm.view();
    const cells = atmosphere.grid.nx * atmosphere.grid.ny * Math.max(1, atmosphere.nz);
    if (cells > P.atmosViewMaxCells) atmosphere = decimateView(atmosphere);
    const embers = this.opts.embers ? this.embers.particles() : { count: 0, data: new Float32Array(0) };
    const insights = this.pendingInsights;
    this.pendingInsights = [];
    return {
      time: this.t,
      fire,
      moisture: this.moisture.field.slice(),
      atmosphere,
      embers,
      spotFires: this.spots.map(cloneSpot),
      stats: this.makeStats(),
      insights,
      layers,
    };
  }

  private lastSnapPerf: { wall: number; sim: number } | null = null;

  private addPerf(name: string, ms: number, init = false): void {
    const m = init ? this.perfInit : this.perfMods;
    m[name] = (m[name] ?? 0) + ms;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Checkpoints (§12.4)
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

  private makeCheckpoint(): Checkpoint {
    const env = this.env;
    const cp: Checkpoint = {
      time: this.t,
      bytes: 0,
      tier: this.tierNow,
      fire: this.fire.checkpoint(),
      moisture: this.moisture.checkpoint(),
      atm: this.atm.checkpoint(),
      embers: this.embers.checkpoint(),
      explain: this.explainEngine.checkpoint(),
      night: { ...this.night },
      lastNightMs: this.lastNightMs,
      stampIdx: this.stampIdx,
      nextSolar: this.nextSolar,
      nextMask: this.nextMask,
      nextMinute: this.nextMinute,
      nextSnapshot: this.nextSnapshot,
      nextCheckpoint: this.nextCheckpoint,
      lastSector: this.lastSector,
      nextWind: this.nextWind,
      windDirty: this.windDirty,
      lastSunMs: this.lastSunMs,
      lastSolarT: this.lastSolarT,
      opts: { ...this.opts },
      applied: this.applied.slice(),
      spots: this.spots.map(cloneSpot),
      pendingSpots: this.pendingSpots.map((s) => ({ ...s, prov: cloneProv(s.prov) })),
      nextSpotId: this.nextSpotId,
      pendingInsights: this.pendingInsights.slice(),
      plumeTopAGL: this.plumeTopAGL,
      moistureDirty: this.moistureDirty,
      arrays: {
        uRidge: env.uRidge.slice(),
        u10: this.u10Now().slice(),
        airT: this.tierNow !== 'fast' ? env.airT.slice() : null,
        ...sparseHeat(this.heatPrev, this.crownPrev),
        frontRos: this.frontRos.slice(),
      },
    };
    cp.bytes = typedBytes(cp);
    return cp;
  }

  private checkpointAtOrBefore(time: number): Checkpoint | null {
    let best: Checkpoint | null = this.cp0 && this.cp0.time <= time + EPS ? this.cp0 : null;
    for (const c of this.ring) if (c.time <= time + EPS && (!best || c.time > best.time)) best = c;
    return best;
  }

  private dropCheckpointsAfter(time: number): void {
    this.ring = this.ring.filter((c) => c.time <= time + EPS);
  }

  private restore(cp: Checkpoint): void {
    // Records applied at the checkpoint; fuel state from the base + that sequence when it differs.
    const fuelNow = fuelSequence(this.records, this.applied);
    const fuelCp = fuelSequence(this.records, cp.applied);
    this.applied = cp.applied.slice();
    this.appliedSet = new Set(this.applied);
    if (!sameSequence(fuelNow, fuelCp)) this.rebuildFuel(activeEdits(this.records, this.applied).fuel);
    this.opts = { ...cp.opts };
    this.night = { ...cp.night };
    this.t = cp.time;
    // Atmosphere / embers of the checkpoint's tier, wind edits as applied at the checkpoint.
    if (cp.tier !== this.tierNow) {
      this.tierNow = cp.tier;
      this.atm = this.buildAtmosphere(cp.tier);
      this.embers = this.buildEmbers(cp.tier);
    } else this.setWindEdits(activeEdits(this.records, this.applied).wind);
    this.atm.setCoupling(this.opts.coupling);
    this.fire.restore(cp.fire);
    this.moisture.restore(cp.moisture);
    this.atm.restore(cp.atm);
    this.embers.restore(cp.embers);
    this.explainEngine.restore(cp.explain);
    this.lastNightMs = cp.lastNightMs;
    this.stampIdx = cp.stampIdx;
    this.nextSolar = cp.nextSolar;
    this.nextMask = cp.nextMask;
    this.nextMinute = cp.nextMinute;
    this.nextSnapshot = cp.nextSnapshot;
    this.nextCheckpoint = cp.nextCheckpoint;
    this.lastSector = cp.lastSector;
    this.nextWind = cp.nextWind;
    this.lastSolarT = cp.lastSolarT;
    this.lastSunMs = cp.lastSunMs;
    this.lastSun = null;
    this.spots = cp.spots.map(cloneSpot);
    this.pendingSpots = cp.pendingSpots.map((s) => ({ ...s, prov: cloneProv(s.prov) }));
    this.nextSpotId = cp.nextSpotId;
    this.pendingInsights = cp.pendingInsights.slice();
    this.plumeTopAGL = cp.plumeTopAGL;
    this.moistureDirty = cp.moistureDirty;
    const env = this.env;
    const a = cp.arrays;
    env.uRidge.set(a.uRidge);
    this.u10.set(a.u10);
    this.u10Valid = true;
    if (a.airT) env.airT.set(a.airT);
    this.heatPrev.fill(0);
    this.crownPrev.fill(0);
    for (let q = 0; q < a.heatIdx.length; q++) {
      this.heatPrev[a.heatIdx[q]!] = a.heatVal[q]!;
      this.crownPrev[a.heatIdx[q]!] = a.crownVal[q]!;
    }
    this.frontRos.set(a.frontRos);
    env.mountainPhenomena = this.opts.mountainPhenomena;
    env.time = this.t;
    env.weather = weatherAt(this.scenario.weather, this.startMs + this.t * 1000);
    this.updatePyrogenic();
    this.windDirty = cp.windDirty;
    if (this.opts.maxEmbersUser !== null) this.embers.setMaxEmbers(this.opts.maxEmbersUser);
    this.diag = null;
    this.replayTarget = -Infinity;
    this.suppressUntil = -Infinity;
  }
}

/** Bytes of every typed array reachable from a value (checkpoint memory accounting). */
function typedBytes(v: unknown, depth = 0): number {
  if (depth > 8 || v === null || typeof v !== 'object') return 0;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  let b = 0;
  for (const x of Array.isArray(v) ? v : Object.values(v as object)) b += typedBytes(x, depth + 1);
  return b;
}

/** Sparse copy of the previous step's heat release and crown share (non-zero heat cells only). */
function sparseHeat(heat: Float32Array, crown: Float32Array): { heatIdx: Int32Array; heatVal: Float32Array; crownVal: Float32Array } {
  let n = 0;
  for (let k = 0; k < heat.length; k++) if (heat[k] !== 0 || crown[k] !== 0) n++;
  const heatIdx = new Int32Array(n);
  const heatVal = new Float32Array(n);
  const crownVal = new Float32Array(n);
  n = 0;
  for (let k = 0; k < heat.length; k++) {
    if (heat[k] === 0 && crown[k] === 0) continue;
    heatIdx[n] = k;
    heatVal[n] = heat[k]!;
    crownVal[n++] = crown[k]!;
  }
  return { heatIdx, heatVal, crownVal };
}

const windKey = (list: readonly WindEdit[]): string => JSON.stringify(list.map((e) => [e.id, e.x, e.y, e.radius, e.speed, e.dir, e.time]));

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0;
}

function structuredCloneSafe<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v)) as T;
  }
}

/** Halve the horizontal resolution of an atmosphere view (block means of 2 × 2 columns). */
function decimateView(v: SimSnapshot['atmosphere'] & object): NonNullable<SimSnapshot['atmosphere']> {
  const g = v.grid;
  const nx2 = Math.ceil(g.nx / 2);
  const ny2 = Math.ceil(g.ny / 2);
  const nz = v.nz;
  const plane2 = nx2 * ny2;
  const down2 = (f: Float32Array): Float32Array => {
    const out = new Float32Array(plane2);
    for (let j = 0; j < ny2; j++) {
      for (let i = 0; i < nx2; i++) {
        let s = 0;
        let c = 0;
        for (let dj = 0; dj < 2; dj++) {
          for (let di = 0; di < 2; di++) {
            const ii = 2 * i + di;
            const jj = 2 * j + dj;
            if (ii < g.nx && jj < g.ny) {
              s += f[jj * g.nx + ii]!;
              c++;
            }
          }
        }
        out[j * nx2 + i] = c ? s / c : 0;
      }
    }
    return out;
  };
  const down3 = (f: Float32Array): Float32Array => {
    if (f.length === 0 || nz === 0) return f.slice();
    const out = new Float32Array(plane2 * nz);
    const plane = g.nx * g.ny;
    for (let l = 0; l < nz; l++) out.set(down2(f.subarray(l * plane, (l + 1) * plane)), l * plane2);
    return out;
  };
  const grid = { ...g, nx: nx2, ny: ny2, cellSize: g.cellSize * 2, x0: g.x0 + g.cellSize / 2, y0: g.y0 + g.cellSize / 2 };
  return {
    grid,
    nz,
    levels: v.levels.slice(),
    terrainHeight: down2(v.terrainHeight),
    surfaceU: down2(v.surfaceU),
    surfaceV: down2(v.surfaceV),
    u: down3(v.u),
    v: down3(v.v),
    w: down3(v.w),
    thetaAnomaly: down3(v.thetaAnomaly),
    smoke: down3(v.smoke),
  };
}
