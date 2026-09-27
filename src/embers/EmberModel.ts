/**
 * EmberModel — Lagrangian firebrands and spot fires (spec docs/research/00-synthesis.md §9, normative; evidence doc 06
 * §4; contracts §2.2 `LandingInfo`, `SpotProvenance`, `EmberStats`, §2.4 `EmberModel`; coupling order §12.2 step 8;
 * checkpoints §12.4; determinism §12.5; budgets §9.7 / §13).
 *
 * Design (§9.1): stratified, weighted super-particles in a structure of arrays (≤ maxEmbers active). Each particle
 * carries x, y, z (ASL), OU velocity fluctuations u′ v′ w′, age, v_t0, τ_f, τ_b, weight W (real brands represented,
 * may be < 1), class, state, source cell, emission time and max height. RNG: the stream-0 `Rng` handed in by sim
 * (copied into a local mulberry32 state at every public call, written back at the end — same sequence, so sim can
 * checkpoint either). The wind is frozen per atmosphere step (the callbacks sample the current step).
 *
 * Clock: `emit(…, dt, time, …)` and `step(dt, …)` work on the fire clock — `time` is seconds from scenario start, the
 * same clock as `FireField.arrivalTime`. `emit` integrates emission exactly over [time, time + dt] (§12.2 step 8 runs
 * after the fire step), `step` advances every particle to time + dt (a particle born inside the window moves only
 * for the part of the window after its birth).
 *
 * Emission (§9.2, D52): every burning cell (t − tArr < 3τ_f) of a `spotting` type emits
 *   N_k = E0·3^(BH−2)·(I/1000)·e·g·VLS·Δx·Δx/max(R, 0.01) real brands in total, released ∝ e^{−(t−tArr)/τ_f} and
 *   integrated exactly per step, so the emission per metre of front, E0·3^(BH−2)·(I/1000)·e·g, does not depend on R,
 *   τ_f, Δx or the front orientation. Cells are tracked from the `burning` list (front cells) and their 8 neighbours,
 *   with per-cell "emitted until" times, so no emission is lost when the list only holds front cells.
 *   Class split by bark (E1 stringy / E2 ribbon with BH ≥ 3 / E3 crown leaves / E4 twigs / E5 heavy), shares
 *   renormalised per cell. Super-particles per class N ~ Poisson(ΔN_c/W_c), W_c = max(1e-3, n̄_c·τ̄_c/(π_c·0.8·max)).
 *
 * Transport (§9.3): resolved wind from `wind()`, sub-grid plume w_sg (3-D tiers, `PlumeField`, resolved updraft
 * subtracted), OU turbulence from `turb()` = [z_i, w*, u*] (surface layer / CBL / stable / in-plume, crossing
 * trajectories, ½∂σ_w²/∂z drift), mass loss m/m0 = 1 − age/τ_b, v_t = max(f·v_t0, v_t0·(m/m0)^n)·√(ρ_ref/ρ). The fall
 * over each sub-step is the exact integral of v_t, so burnout-limited fall heights are exact (§9.7 vectors). Fast tier:
 * loft to z_L = z_p·√ξ (Briggs plume top) along the tilted plume axis, then fall through the wind profile.
 * Mountain hooks (§9.4, P1): lee eddy (s_sep ≥ 0.5, z < 0.3·relief → blend toward 0.3·U_ridge upslope), VLS emission
 * ×2.5 with crest-height launch and α_p 0.4, ridgeDrop and source class in the provenance.
 *
 * Landing (§9.5): exclusion zone (short-range spotting), P_ig(T_f, M)·S_state·R_fuel·(m/m0)^0.25, pile synergy,
 * P_spot = 1 − e^{−W·p}, ignition after U(5, 30) s (flaming) / U(60, 600) s (glowing) delays via `onIgnite`, holdovers
 * (2 % of glowing landings in heavy fuel, hazard (1/3600 s⁻¹)·clamp((10 − M)/5, 0, 1), ≤ 24 h). Overlays: landing
 * density ΣW/m² and expected ignitions ΣW·p, decayed with τ = 10 min.
 *
 * Deviations from the spec text (reasons in the final report and in `params.ts`):
 *  1. E4 has no 0.3·v_t0 floor (n = 1, Albini): with the floor the §9.7 vector z_b = v_t0·τ_b/2 → Ū·τ_b cannot hold.
 *  2. τ̄_c in W_c is the measured mean slot residence of the class (EMA, prior = proposal mean τ_b, floored), not the
 *     median τ_b: with importance-sampled lifetimes and early landings the median gives populations 0.02–2.3× the
 *     budget; §9.7 asks for 0.8·maxEmbers ± 10 %. n̄_c is a bias-corrected EMA (no ×10 start-up overshoot).
 *  3. Fast-tier loft cap uses the decay scale L = 0.5·z_p (C_w·F_L^{1/3}·e^{−z/L} ≤ v_t) instead of z_d = 200 m, which
 *     would cap every brand below ≈ 100–300 m and make fast-tier spotting several times shorter than the Mk5 / AFDRS
 *     targets (V9); the rise follows the tilted plume axis at the source slip speed (spec gives no rise kinematics).
 *  4. Resolved-updraft subtraction uses max(0, w_resolved) (a resolved downdraft does not enlarge w_sg).
 */
import { BurnState, FuelFlag, Landform } from '../core/types';
import type {
  EmberParticles,
  EmberStats,
  FireAux,
  FireField,
  FuelMap,
  LandingInfo,
  QualityTier,
  SpotProvenance,
  Terrain,
  WeatherHour,
} from '../core/types';
import type { Rng } from '../core/rng';
import { RHO_REF, airDensity, pressureIsa } from '../core/physics';
import { DEG, windToUV } from '../core/units';
import { slidingMinMax } from '../terrain';
import {
  CLS_FLAKE,
  CLS_LEAF,
  CLS_RIBBON,
  CLS_TWIG,
  EMBER_CLASSES,
  N_CLASSES,
  emberParams,
  type DeepPartial,
  type EmberParams,
} from './params';
import { briggsPlumeRise, fallIntegral, ignitionProbability, lineBuoyancyFlux, powN } from './physics';
import { PlumeField, PlumeSources, type WindFn } from './plume';
import { FastRng, NORMAL_TABLE, NORMAL_TABLE_SIZE, medianTauB, proposalMeanTauB, sampleClass, type EmberDraw } from './sampling';
import { DecayRaster, RollingWindow, WIN } from './stats';
import { catalogueCellFuel, catalogueReceptivity, hasRibbonBark, hasStringybark, type EmberCellFuel } from './fuelInfo';

export type TurbFn = (x: number, y: number, zAGL: number, out: Float32Array) => void;
export type LandingFn = (x: number, y: number) => LandingInfo;
export type IgniteFn = (x: number, y: number, travel: number, prov: SpotProvenance) => void;
export type SourceClass = SpotProvenance['sourceClass'];

/** Constructor options: the spec's `{ maxEmbers, tier }` plus optional extensions. */
export interface EmberModelOptions {
  maxEmbers: number;
  tier: QualityTier;
  /** Parameter overrides (developer panel, tests). */
  params?: DeepPartial<EmberParams>;
  /** Atmosphere horizontal cell size Δx_a (m); default from the §12.6 tier table. */
  atmosCellSize?: number;
  /** First atmosphere level thickness Δζ₁ (m) for the Δt_e bound; tier default 30 (high 25). */
  atmosDz1?: number;
  /** 'auto': fast tier → Briggs loft, 3-D tiers → sub-grid plume. 'none' disables both (resolved wind only). */
  loft?: 'auto' | 'briggs' | 'plume' | 'none';
  /** Per-cell fuel resolver (sim may pass `(k) => fuelParamsAt(fuel, k)`); default: catalogue lookup. */
  cellFuel?: (k: number) => EmberCellFuel;
  /** Debug / test hook called for every landing inside the domain. */
  onLanding?: (ev: EmberLandingEvent) => void;
}

/** Slowly varying context sim may refresh each step (all optional; defaults in brackets). */
export interface EmberEnvironment {
  /** Ambient weather: 10 m wind, `windProfile`, `pressureLevels` (profile aloft / domain exit), temperature. */
  weather?: WeatherHour;
  /** U_ridge per fire cell (m/s, NaN where no crest; D42) for the lee eddy. */
  uRidge?: Float32Array;
  /** Ridge-to-valley relief per fire cell (m) [local max − min within 600 m]. */
  relief?: Float32Array;
  /** s_sep per fire cell (overrides `aux.sep` of the last emit). */
  sep?: Float32Array;
  /** Upwind crest of cell k (TerrainFeatures.crest) for the VLS crest-height launch [local upwind march]. */
  crest?: (k: number, windFromDeg: number) => { zCrest: number } | null;
  /** Brunt–Väisälä N² (s⁻²) for Briggs [1e-4]. */
  nSquared?: number;
  /** Plume top override (m AGL): atmosphere diagnostics or the user's "observed column height". */
  plumeTopAGL?: number;
  /** Above this height (m AGL) the ambient profile replaces `wind()` (model top) [∞]. */
  modelTopAGL?: number;
  /** Mountain hooks on/off [true]. */
  mountainPhenomena?: boolean;
  /** Constant air density (kg/m³) instead of ISA + lapse from `temperatureC`. */
  airDensity?: number;
  /** Near-surface air temperature (°C) [weather.temperature ?? 25]. */
  temperatureC?: number;
  /** Dead fuel moisture (%) and fuel temperature (°C) assumed beyond the domain edge [8 %, 35 °C]. */
  ambientMoisture?: number;
  ambientFuelTempC?: number;
}

export interface EmberLandingEvent {
  x: number;
  y: number;
  cell: number;
  emberClass: SpotProvenance['emberClass'];
  weight: number;
  /** Per-brand ignition probability after synergy (0 when discarded / short range). */
  p: number;
  pSpot: number;
  travel: number;
  flightTime: number;
  maxHeightAGL: number;
  state: 'flaming' | 'glowing' | 'reflamed';
  outcome: 'discarded' | 'shortRange' | 'attempt';
  scheduled: boolean;
  holdover: boolean;
  moisture: number;
  sourceCell: number;
  leeEddy: boolean;
  ridgeDrop: number;
  sourceClass: SourceClass;
}

/** `EmberStats` plus diagnostics for the explain cards and the developer panel. */
export interface EmberStatsExt extends EmberStats {
  /** Share of ignition-capable brands (10 min) carried beyond the domain edge (embers-exit card). */
  exitShare10min: number;
  /** Real brands emitted per second (bias-corrected 300 s EMA, all classes). */
  emissionRate: number;
  /** Current class weights W_c and populations (particles). */
  classWeights: number[];
  classPopulation: number[];
  /** Diagnosed plume top (m AGL; Briggs or override) and fire power (W, 120 s EMA) of the burning cells. */
  plumeTopAGL: number;
  firePowerW: number;
  holdovers: number;
  pendingIgnitions: number;
  burntOutInFlight: number;
  dropped: number;
  /** Cumulative expected real brands emitted per class (exact ΣΔN_c, before Poisson sampling). */
  emittedBrands: number[];
}

interface PendingIgnition {
  due: number;
  x: number;
  y: number;
  travel: number;
  prov: SpotProvenance;
}

interface Holdover {
  x: number;
  y: number;
  tLand: number;
  prov: SpotProvenance;
}

const ST_REFLAMED = 1;
const ST_EDDY = 2;
const ST_NEEDLOFT = 4;
const ST_RISING = 8;
const ST_INJECTED = 16;

const SOURCE_CLASSES: readonly SourceClass[] = ['ridge', 'windward', 'leeward', 'valley'];
const E3 = 1 - Math.exp(-3);

/** Fields of one particle for `injectParticle` (tests, "observed spot" back-tracking). */
export interface EmberInjection {
  x: number;
  y: number;
  /** m ASL */
  z: number;
  emberClass: SpotProvenance['emberClass'];
  vt0: number;
  tauB: number;
  tauF?: number;
  weight?: number;
  time?: number;
  sourceCell?: number;
}

type F32 = Float32Array;

export class EmberModel {
  readonly params: EmberParams;
  readonly tier: QualityTier;
  private maxEmbers: number;
  private readonly terrain: Terrain;
  private fuel: FuelMap;
  private readonly rng: Rng;
  private readonly r: FastRng;
  private readonly nCells: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly h: number;
  private readonly gx0: number;
  private readonly gy0: number;
  private readonly xMin: number;
  private readonly xMax: number;
  private readonly yMin: number;
  private readonly yMax: number;
  private readonly dxa: number;
  private readonly dz1: number;
  private readonly loftMode: 'briggs' | 'plume' | 'none';
  private readonly cellFuelFn: ((k: number) => EmberCellFuel) | null;
  private readonly onLanding: ((ev: EmberLandingEvent) => void) | null;

  // ── particles (structure of arrays) ──
  private count = 0;
  private cap = 0;
  private px!: F32;
  private py!: F32;
  private pz!: F32;
  private up!: F32;
  private vp!: F32;
  private wp!: F32;
  private age!: F32;
  private vt0!: F32;
  private tauB!: F32;
  private flameEnd!: F32;
  private W!: F32;
  private zLaunch!: F32;
  private maxH!: F32;
  private sumU!: F32;
  private sumV!: F32;
  private cn!: F32;
  private srcX!: F32;
  private srcY!: F32;
  private rx!: F32;
  private ry!: F32;
  private rz!: F32;
  private riseT!: F32;
  private fl13!: F32;
  private tBirth!: Float64Array;
  private cls!: Uint8Array;
  private state!: Uint8Array;
  private srcClass!: Uint8Array;
  private srcCell!: Int32Array;

  // ── per-class constants (hot loop) ──
  private readonly clsN = new Float64Array(N_CLASSES);
  private readonly clsFloor = new Float64Array(N_CLASSES);
  private readonly clsReflame = new Float64Array(N_CLASSES);
  private readonly shareTable = new Float64Array(32 * N_CLASSES);

  // ── emission state ──
  private readonly cellState: Uint8Array; // 0 unseen, 1 active emitter, 2 done
  private nAct = 0;
  private aCell: Int32Array = new Int32Array(256);
  private aUntil: Float64Array = new Float64Array(256);
  private aTArr: Float64Array = new Float64Array(256);
  private aTau: Float32Array = new Float32Array(256);
  private aAmp: Float32Array = new Float32Array(256);
  private aMask: Uint8Array = new Uint8Array(256);
  private aFL13: Float32Array = new Float32Array(256);
  private aHeat: Float32Array = new Float32Array(256);
  private aFH: Float32Array = new Float32Array(256);
  private aHO: Float32Array = new Float32Array(256);
  private aI: Float32Array = new Float32Array(256);
  private scratchN: Float64Array = new Float64Array(256 * N_CLASSES);
  private scratchT0: Float64Array = new Float64Array(256);
  private scratchT1: Float64Array = new Float64Array(256);
  private readonly rateM = new Float64Array(N_CLASSES);
  private rateNorm = 0;
  private readonly wC = new Float64Array(N_CLASSES).fill(1);
  private readonly lifeS = new Float64Array(N_CLASSES);
  private readonly lifeN = new Float64Array(N_CLASSES);
  private readonly lifePrior = new Float64Array(N_CLASSES);
  private readonly lifeFloor = new Float64Array(N_CLASSES);
  private readonly classPop = new Int32Array(N_CLASSES);
  private readonly emitted = new Float64Array(N_CLASSES);
  private firePowerW = 0;
  private powerM = 0;
  private powerNorm = 0;
  private heatCx = 0;
  private heatCy = 0;
  private plumeTop = 0;
  private windToDeg = 90;
  private readonly colIndex: Int32Array;
  private readonly usedCols: number[] = [];
  private readonly nxa: number;
  private readonly sources = new PlumeSources();
  private readonly plume: PlumeField;
  private sepField: Float32Array | null = null;
  private vlsActive: Uint8Array | null = null;
  private ncField: Float32Array | null = null;

  // ── environment ──
  private env: EmberEnvironment = {};
  private densLo = 0;
  private densDz = 50;
  private densLut: Float64Array = new Float64Array(1).fill(1);
  private profH: Float64Array = new Float64Array(0);
  private profU: Float64Array = new Float64Array(0);
  private profV: Float64Array = new Float64Array(0);
  private reliefField: Float32Array | null = null;
  private mountainOn = true;
  private modelTop = Infinity;
  private zRef: number;

  // ── landing / ignition state ──
  private pile = new Map<number, { t0: number; n: number }>();
  private pending: PendingIgnition[] = [];
  private holdovers: Holdover[] = [];
  private lastHoldoverCheck = -Infinity;
  private readonly win: RollingWindow;
  private readonly ovLanding: DecayRaster;
  private readonly ovIgnition: DecayRaster;
  private leftDomain = 0;
  private burntOut = 0;
  private dropped = 0;
  private time = 0;
  /** Simulation time at which the particle `advance` just removed left (landing / burnout / exit). */
  private goneAt = 0;

  // ── scratch ──
  private readonly wOut = new Float32Array(3);
  private readonly tOut = new Float32Array(3);
  private readonly draw: EmberDraw = { vt0: 0, tauF: 0, tauB: 0, weight: 1 };
  private readonly cf: EmberCellFuel = { spotting: false, barkClass: 'none', tauF: 30, receptivity: 0, hOEff: 0, family: 'none', flags: 0 };
  private victims: number[] | null = null;

  constructor(terrain: Terrain /* fire grid */, fuel: FuelMap, opts: EmberModelOptions, rng: Rng) {
    this.params = emberParams(opts.params);
    this.tier = opts.tier;
    this.maxEmbers = Math.max(1, Math.floor(opts.maxEmbers));
    this.terrain = terrain;
    this.fuel = fuel;
    this.rng = rng;
    this.r = new FastRng(rng.state);
    const g = terrain.grid;
    this.nx = g.nx;
    this.ny = g.ny;
    this.h = g.cellSize;
    this.gx0 = g.x0;
    this.gy0 = g.y0;
    this.nCells = g.nx * g.ny;
    this.xMin = g.x0 - g.cellSize / 2;
    this.xMax = g.x0 + (g.nx - 0.5) * g.cellSize;
    this.yMin = g.y0 - g.cellSize / 2;
    this.yMax = g.y0 + (g.ny - 0.5) * g.cellSize;
    const extent = Math.max(g.nx, g.ny) * g.cellSize;
    const clampA = (v: number): number => Math.min(270, Math.max(100, v));
    this.dxa = opts.atmosCellSize ?? (opts.tier === 'high' ? clampA(extent / 60) : clampA(extent / 45));
    this.dz1 = opts.atmosDz1 ?? (opts.tier === 'high' ? 25 : 30);
    const loft = opts.loft ?? 'auto';
    this.loftMode = loft === 'auto' ? (opts.tier === 'fast' ? 'briggs' : 'plume') : loft;
    this.cellFuelFn = opts.cellFuel ?? null;
    this.onLanding = opts.onLanding ?? null;
    this.cellState = new Uint8Array(this.nCells);
    this.nxa = Math.ceil((this.xMax - this.xMin) / this.dxa) + 1;
    const nya = Math.ceil((this.yMax - this.yMin) / this.dxa) + 1;
    this.colIndex = new Int32Array(this.nxa * nya).fill(-1);
    this.plume = new PlumeField(this.params.transport);
    const P = this.params;
    this.win = new RollingWindow(P.stats.binSeconds, P.stats.bins, P.stats.edgeBins);
    this.ovLanding = new DecayRaster(this.nCells, P.stats.overlayTau);
    this.ovIgnition = new DecayRaster(this.nCells, P.stats.overlayTau);
    let zs = 0;
    for (let k = 0; k < this.nCells; k++) zs += terrain.elevation[k]!;
    this.zRef = zs / this.nCells;
    for (let c = 0; c < N_CLASSES; c++) {
      const cp = P.classes[c]!;
      this.clsN[c] = cp.n;
      this.clsFloor[c] = cp.vtFloor;
      this.clsReflame[c] = cp.reflameRate;
      this.lifePrior[c] = proposalMeanTauB(cp, P);
      this.lifeFloor[c] = Math.max(P.weights.lifeFloorFrac * medianTauB(cp, P), P.weights.lifeFloorAbs);
    }
    for (let m = 0; m < 32; m++) {
      let s = 0;
      for (let c = 0; c < N_CLASSES; c++) if (m & (1 << c)) s += P.classes[c]!.share;
      for (let c = 0; c < N_CLASSES; c++) this.shareTable[m * N_CLASSES + c] = m & (1 << c) && s > 0 ? P.classes[c]!.share / s : 0;
    }
    this.allocParticles(this.maxEmbers);
    this.rebuildDensity();
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Public API (spec §2.4)
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════

  /** Update slowly varying context (weather, U_ridge, relief, N², plume top, density, mountain hooks). */
  setEnvironment(env: EmberEnvironment): void {
    const prev = this.env;
    this.env = { ...prev, ...env };
    const e = this.env;
    this.mountainOn = e.mountainPhenomena ?? true;
    this.modelTop = e.modelTopAGL ?? Infinity;
    if (env.relief) this.reliefField = env.relief;
    if (env.weather || env.temperatureC !== undefined || env.airDensity !== undefined) this.rebuildDensity();
    if (env.weather) {
      this.rebuildProfile(env.weather);
      if (this.nAct === 0) this.windToDeg = (env.weather.windDir10 + 180) % 360;
    }
  }

  /** Change the particle budget (`setOption('maxEmbers')`); keeps the oldest particles if it shrinks. */
  setMaxEmbers(n: number): void {
    const m = Math.max(1, Math.floor(n));
    if (m === this.maxEmbers) return;
    const keep = Math.min(this.count, m);
    this.maxEmbers = m;
    const old = this.snapshotArrays(keep);
    this.allocParticles(m);
    this.loadArrays(old, keep);
  }

  /**
   * Emit firebrands from burning cells over [time, time + dt] (s from scenario start). `burning` = front (or burning)
   * cells; cells are tracked until t − tArr ≥ 3τ_f. `aux` supplies vlsActive (×2.5, crest launch), sep (lee eddy) and
   * nc (provenance).
   */
  emit(fire: FireField, fuel: FuelMap, burning: Int32Array, dt: number, time: number, aux: FireAux): void {
    this.syncIn();
    this.fuel = fuel;
    this.time = time;
    this.vlsActive = aux.vlsActive ?? null;
    this.sepField = this.env.sep ?? aux.sep ?? null;
    this.ncField = aux.nc ?? null;
    const P = this.params;
    const E = P.emission;
    const tEnd = time + dt;
    const nx = this.nx;
    const ny = this.ny;
    // 1. Track newly burning cells (front list + 8-neighbours, so interior cells are not missed).
    for (let q = 0; q < burning.length; q++) {
      const k = burning[q]!;
      this.addCell(k, fire, fuel, tEnd);
      const i = k % nx;
      const j = (k - i) / nx;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= nx || (di === 0 && dj === 0)) continue;
          this.addCell(jj * nx + ii, fire, fuel, tEnd);
        }
      }
    }
    // 2. Exact emission integrals per cell and class over the window.
    const nAct = this.nAct;
    if (this.scratchN.length < nAct * N_CLASSES) {
      this.scratchN = new Float64Array(Math.ceil(nAct * 1.5) * N_CLASSES);
      this.scratchT0 = new Float64Array(Math.ceil(nAct * 1.5));
      this.scratchT1 = new Float64Array(Math.ceil(nAct * 1.5));
    }
    const sN = this.scratchN;
    const classSum = [0, 0, 0, 0, 0];
    let heat = 0;
    let hx = 0;
    let hy = 0;
    const vls = this.vlsActive;
    const plumeOn = this.loftMode === 'plume';
    const cw = P.transport.cw;
    for (const c of this.usedCols) this.colIndex[c] = -1;
    this.usedCols.length = 0;
    this.sources.clear();
    for (let a = 0; a < nAct; a++) {
      const tArr = this.aTArr[a]!;
      const tau = this.aTau[a]!;
      const t0 = Math.max(this.aUntil[a]!, tArr);
      const tFin = tArr + E.flamingWindow * tau;
      const t1 = Math.min(tEnd, tFin);
      this.scratchT0[a] = t0;
      this.scratchT1[a] = t1;
      for (let c = 0; c < N_CLASSES; c++) sN[a * N_CLASSES + c] = 0;
      if (!(t1 > t0)) continue;
      const frac = (Math.exp(-(t0 - tArr) / tau) - Math.exp(-(t1 - tArr) / tau)) / E3;
      const k = this.aCell[a]!;
      const amp = this.aAmp[a]!;
      if (amp > 0) {
        const m = this.aMask[a]!;
        const boost = vls && vls[k] ? E.vlsBoost : 1;
        for (let c = 0; c < N_CLASSES; c++) {
          const sh = this.shareTable[m * N_CLASSES + c]!;
          if (sh === 0) continue;
          const dN = amp * sh * frac * (c <= CLS_TWIG ? boost : 1);
          sN[a * N_CLASSES + c] = dN;
          classSum[c]! += dN;
        }
      }
      const hk = this.aHeat[a]! * frac; // kJ released in the window
      heat += hk;
      const cx = this.gx0 + (k % nx) * this.h;
      const cy = this.gy0 + Math.floor(k / nx) * this.h;
      hx += hk * cx;
      hy += hk * cy;
      if (plumeOn && this.aFL13[a]! > 0) {
        const col = Math.floor((cx - this.xMin) / this.dxa) + Math.floor((cy - this.yMin) / this.dxa) * this.nxa;
        const w0 = cw * this.aFL13[a]!;
        const alpha = vls && vls[k] ? P.transport.alphaPVls : P.transport.alphaP;
        const s = this.colIndex[col]!;
        if (s < 0) {
          this.colIndex[col] = this.sources.push(cx, cy, this.terrain.elevation[k]!, w0, alpha);
          this.usedCols.push(col);
        } else if (w0 > this.sources.w0[s]!) {
          this.sources.x[s] = cx;
          this.sources.y[s] = cy;
          this.sources.z0[s] = this.terrain.elevation[k]!;
          this.sources.w0[s] = w0;
          this.sources.alpha[s] = alpha;
        } else if (alpha > this.sources.alpha[s]!) this.sources.alpha[s] = alpha;
      }
      this.aUntil[a] = t1;
    }
    for (let c = 0; c < N_CLASSES; c++) this.emitted[c]! += classSum[c]!;
    if (dt > 0) {
      // Fire power of the emitting cells, bias-corrected EMA (plume input; Briggs).
      const bp = Math.exp(-dt / P.loft.powerTau);
      this.powerM = this.powerM * bp + ((heat * 1000) / dt) * (1 - bp);
      this.powerNorm = this.powerNorm * bp + (1 - bp);
      this.firePowerW = this.powerM / this.powerNorm;
    }
    if (heat > 0) {
      this.heatCx = hx / heat;
      this.heatCy = hy / heat;
    }
    // 3. Class weights W_c = max(wMin, n̄_c·τ̄_c/(π_c·0.8·maxEmbers)), n̄_c bias-corrected EMA over 300 s.
    if (dt > 0) {
      const beta = Math.exp(-dt / P.weights.rateTau);
      this.rateNorm = this.rateNorm * beta + (1 - beta);
      let present = 0;
      for (let c = 0; c < N_CLASSES; c++) {
        this.rateM[c] = this.rateM[c]! * beta + (classSum[c]! / dt) * (1 - beta);
        if (this.rateM[c]! > 0) present++;
      }
      const budget = P.weights.budgetFraction * this.maxEmbers;
      for (let c = 0; c < N_CLASSES; c++) {
        const nbar = this.rateNorm > 0 ? this.rateM[c]! / this.rateNorm : 0;
        if (nbar > 0) {
          const pi = 1 / present;
          this.wC[c] = Math.max(P.weights.wMin, (nbar * this.lifeEstimate(c)) / (pi * budget));
        }
      }
    }
    // 4. Super-particles.
    this.victims = null;
    for (let a = 0; a < nAct; a++) {
      const t0 = this.scratchT0[a]!;
      const t1 = this.scratchT1[a]!;
      if (!(t1 > t0)) continue;
      for (let c = 0; c < N_CLASSES; c++) {
        const dN = sN[a * N_CLASSES + c]!;
        if (!(dN > 0)) continue;
        const np = this.r.poisson(dN / this.wC[c]!);
        for (let q = 0; q < np; q++) this.spawn(a, c, t0 + (t1 - t0) * this.r.next());
      }
    }
    this.victims = null;
    // 5. Retire burnt-out emitters.
    let a = 0;
    while (a < this.nAct) {
      if (this.aTArr[a]! + E.flamingWindow * this.aTau[a]! <= tEnd) {
        this.cellState[this.aCell[a]!] = 2;
        this.removeActive(a);
      } else a++;
    }
    this.syncOut();
  }

  /**
   * Advance every particle to time + dt through the frozen wind; land, burn out, leave the domain; fire due
   * ignitions and holdover conversions through `onIgnite`.
   */
  step(dt: number, wind: WindFn, turb: TurbFn, landing: LandingFn, onIgnite: IgniteFn): void {
    this.syncIn();
    const t0 = this.time;
    const t1 = t0 + dt;
    const P = this.params;
    // Fire-scale ambient: wind direction at the fire, Briggs plume top, sub-grid plume field.
    if (this.firePowerW > 0) {
      wind(this.heatCx, this.heatCy, 10, this.wOut);
      const u = this.wOut[0]!;
      const v = this.wOut[1]!;
      if (u * u + v * v > 0.01) this.windToDeg = ((Math.atan2(u, v) / DEG) % 360 + 360) % 360;
    }
    this.plumeTop = this.diagnosePlumeTop(wind);
    if (this.loftMode === 'plume') this.plume.build(this.sources, this.dxa, wind);
    else this.plume.active = false;
    this.victims = null;
    // Decay the residence estimates.
    const bl = Math.exp(-dt / P.weights.lifeTau);
    for (let c = 0; c < N_CLASSES; c++) {
      this.lifeS[c]! *= bl;
      this.lifeN[c]! *= bl;
    }
    let i = 0;
    while (i < this.count) {
      if (this.advance(i, t0, t1, wind, turb, landing)) this.removeAt(i, this.goneAt);
      else i++;
    }
    this.processIgnitions(t1, landing, onIgnite);
    this.time = t1;
    this.win.advance(t1);
    this.syncOut();
  }

  /** Packed [x, y, z ASL, temperature fraction] per particle (render contract `EmberParticles`). */
  particles(): EmberParticles {
    const n = this.count;
    const data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      data[i * 4] = this.px[i]!;
      data[i * 4 + 1] = this.py[i]!;
      data[i * 4 + 2] = this.pz[i]!;
      const flaming = this.age[i]! < this.flameEnd[i]!;
      data[i * 4 + 3] = flaming ? 1 : 0.2 + 0.6 * Math.max(0, 1 - this.age[i]! / this.tauB[i]!);
    }
    return { count: n, data };
  }

  stats(): EmberStatsExt {
    const w = this.win;
    w.advance(this.time);
    const landings = w.total(WIN.landings);
    const capable = w.total(WIN.capable);
    const exitAlive = w.total(WIN.exitAlive);
    const hist = w.histTotal(new Float32Array(this.params.stats.edgeBins));
    for (let c = 0; c < N_CLASSES; c++) this.classPop[c] = 0;
    for (let q = 0; q < this.count; q++) this.classPop[this.cls[q]!]!++;
    let rate = 0;
    for (let c = 0; c < N_CLASSES; c++) rate += this.rateNorm > 0 ? this.rateM[c]! / this.rateNorm : 0;
    return {
      active: this.count,
      leftDomain: this.leftDomain,
      landings10min: landings,
      ignitions10min: w.total(WIN.ignitions),
      shortRange10min: w.total(WIN.shortRange),
      maxIgnitableDistance10min: w.maxTotal(),
      beyondEdgeHistogram: hist,
      ignitionCapableShare: landings > 0 ? capable / landings : 0,
      exitShare10min: exitAlive + capable > 0 ? exitAlive / (exitAlive + capable) : 0,
      emissionRate: rate,
      classWeights: Array.from(this.wC),
      classPopulation: Array.from(this.classPop),
      plumeTopAGL: this.plumeTop,
      firePowerW: this.firePowerW,
      holdovers: this.holdovers.length,
      pendingIgnitions: this.pending.length,
      burntOutInFlight: this.burntOut,
      dropped: this.dropped,
      emittedBrands: Array.from(this.emitted),
    };
  }

  /** Landing density ΣW/m² and expected ignitions ΣW·p (fire grid, decayed τ = 10 min; live buffers). */
  overlays(): { landing: Float32Array; ignitions: Float32Array } {
    return { landing: this.ovLanding.at(this.time), ignitions: this.ovIgnition.at(this.time) };
  }

  /** Add one particle directly (tests; back-tracking an observed spot). Not lofted; no emission bookkeeping. */
  injectParticle(p: EmberInjection): boolean {
    const c = EMBER_CLASSES.indexOf(p.emberClass);
    if (c < 0) return false;
    const i = this.acquireSlot();
    if (i < 0) return false;
    const t = p.time ?? this.time;
    this.initParticle(i, c, p.x, p.y, p.z, p.vt0, p.tauF ?? Math.min(p.tauB, this.params.classes[c]!.tauF.median), p.tauB, p.weight ?? 1, t,
      p.sourceCell ?? this.cellIndex(p.x, p.y), 0, 1);
    this.state[i] = ST_INJECTED;
    return true;
  }

  /** Current simulation time of the model (s from scenario start). */
  get clock(): number {
    return this.time;
  }

  checkpoint(): unknown {
    const n = this.count;
    return {
      v: 1,
      time: this.time,
      rng: this.rng.state,
      maxEmbers: this.maxEmbers,
      count: n,
      arrays: this.snapshotArrays(n),
      cellState: this.cellState.slice(),
      act: {
        n: this.nAct,
        cell: this.aCell.slice(0, this.nAct),
        until: this.aUntil.slice(0, this.nAct),
        tArr: this.aTArr.slice(0, this.nAct),
        tau: this.aTau.slice(0, this.nAct),
        amp: this.aAmp.slice(0, this.nAct),
        mask: this.aMask.slice(0, this.nAct),
        fl13: this.aFL13.slice(0, this.nAct),
        heat: this.aHeat.slice(0, this.nAct),
        fh: this.aFH.slice(0, this.nAct),
        ho: this.aHO.slice(0, this.nAct),
        i: this.aI.slice(0, this.nAct),
      },
      rateM: this.rateM.slice(),
      rateNorm: this.rateNorm,
      emitted: this.emitted.slice(),
      wC: this.wC.slice(),
      lifeS: this.lifeS.slice(),
      lifeN: this.lifeN.slice(),
      firePowerW: this.firePowerW,
      powerM: this.powerM,
      powerNorm: this.powerNorm,
      heatCx: this.heatCx,
      heatCy: this.heatCy,
      plumeTop: this.plumeTop,
      windToDeg: this.windToDeg,
      sources: {
        n: this.sources.n,
        x: this.sources.x.slice(0, this.sources.n),
        y: this.sources.y.slice(0, this.sources.n),
        z0: this.sources.z0.slice(0, this.sources.n),
        w0: this.sources.w0.slice(0, this.sources.n),
        alpha: this.sources.alpha.slice(0, this.sources.n),
      },
      pile: Array.from(this.pile.entries()).map(([k, v]) => [k, v.t0, v.n]),
      pending: this.pending.map((p) => ({ ...p, prov: cloneProv(p.prov) })),
      holdovers: this.holdovers.map((h) => ({ ...h, prov: cloneProv(h.prov) })),
      lastHoldoverCheck: this.lastHoldoverCheck,
      win: this.win.checkpoint(),
      ovLanding: this.ovLanding.checkpoint(),
      ovIgnition: this.ovIgnition.checkpoint(),
      leftDomain: this.leftDomain,
      burntOut: this.burntOut,
      dropped: this.dropped,
    };
  }

  restore(cIn: unknown): void {
    const s = cIn as {
      time: number; rng: number; maxEmbers: number; count: number; arrays: ParticleArrays; cellState: Uint8Array;
      act: { n: number; cell: Int32Array; until: Float64Array; tArr: Float64Array; tau: Float32Array; amp: Float32Array;
        mask: Uint8Array; fl13: Float32Array; heat: Float32Array; fh: Float32Array; ho: Float32Array; i: Float32Array };
      rateM: Float64Array; rateNorm: number; emitted: Float64Array; wC: Float64Array; lifeS: Float64Array; lifeN: Float64Array; firePowerW: number;
      powerM: number; powerNorm: number;
      heatCx: number; heatCy: number; plumeTop: number; windToDeg: number;
      sources: { n: number; x: Float64Array; y: Float64Array; z0: Float64Array; w0: Float64Array; alpha: Float64Array };
      pile: [number, number, number][]; pending: PendingIgnition[]; holdovers: Holdover[]; lastHoldoverCheck: number;
      win: ReturnType<RollingWindow['checkpoint']>; ovLanding: ReturnType<DecayRaster['checkpoint']>;
      ovIgnition: ReturnType<DecayRaster['checkpoint']>; leftDomain: number; burntOut: number; dropped: number;
    };
    this.time = s.time;
    this.rng.state = s.rng;
    this.r.s = s.rng >>> 0;
    if (s.maxEmbers !== this.maxEmbers) {
      this.maxEmbers = s.maxEmbers;
      this.allocParticles(s.maxEmbers);
    }
    this.loadArrays(s.arrays, s.count);
    this.cellState.set(s.cellState);
    this.nAct = 0;
    this.ensureActive(s.act.n);
    this.nAct = s.act.n;
    this.aCell.set(s.act.cell);
    this.aUntil.set(s.act.until);
    this.aTArr.set(s.act.tArr);
    this.aTau.set(s.act.tau);
    this.aAmp.set(s.act.amp);
    this.aMask.set(s.act.mask);
    this.aFL13.set(s.act.fl13);
    this.aHeat.set(s.act.heat);
    this.aFH.set(s.act.fh);
    this.aHO.set(s.act.ho);
    this.aI.set(s.act.i);
    this.rateM.set(s.rateM);
    this.rateNorm = s.rateNorm;
    this.emitted.set(s.emitted);
    this.wC.set(s.wC);
    this.lifeS.set(s.lifeS);
    this.lifeN.set(s.lifeN);
    this.firePowerW = s.firePowerW;
    this.powerM = s.powerM;
    this.powerNorm = s.powerNorm;
    this.heatCx = s.heatCx;
    this.heatCy = s.heatCy;
    this.plumeTop = s.plumeTop;
    this.windToDeg = s.windToDeg;
    for (const col of this.usedCols) this.colIndex[col] = -1;
    this.usedCols.length = 0;
    this.sources.clear();
    for (let q = 0; q < s.sources.n; q++) {
      const cx = s.sources.x[q]!;
      const cy = s.sources.y[q]!;
      const col = Math.floor((cx - this.xMin) / this.dxa) + Math.floor((cy - this.yMin) / this.dxa) * this.nxa;
      this.colIndex[col] = this.sources.push(cx, cy, s.sources.z0[q]!, s.sources.w0[q]!, s.sources.alpha[q]!);
      this.usedCols.push(col);
    }
    this.pile = new Map(s.pile.map(([k, t0, n]) => [k, { t0, n }]));
    this.pending = s.pending.map((p) => ({ ...p, prov: cloneProv(p.prov) }));
    this.holdovers = s.holdovers.map((h) => ({ ...h, prov: cloneProv(h.prov) }));
    this.lastHoldoverCheck = s.lastHoldoverCheck;
    this.win.restore(s.win);
    this.ovLanding.restore(s.ovLanding);
    this.ovIgnition.restore(s.ovIgnition);
    this.leftDomain = s.leftDomain;
    this.burntOut = s.burntOut;
    this.dropped = s.dropped;
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Emission internals
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════

  private cellFuel(k: number): EmberCellFuel {
    return this.cellFuelFn ? this.cellFuelFn(k) : catalogueCellFuel(this.fuel, k, this.cf);
  }

  /** Start tracking cell k if it has ignited by tEnd (emission, heat and plume source). */
  private addCell(k: number, fire: FireField, fuel: FuelMap, tEnd: number): void {
    if (this.cellState[k] !== 0) return;
    const tArr = fire.arrivalTime[k]!;
    if (!(tArr <= tEnd)) return;
    if (fire.burnState[k] === BurnState.NonFlammable) {
      this.cellState[k] = 2;
      return;
    }
    const E = this.params.emission;
    const cf = this.cellFuel(k);
    const intensity = fire.intensity[k]!;
    const ros = Math.max(fire.ros[k]!, E.rosFloor);
    const fh = fire.flameHeight[k]!;
    const bh = fuel.barkHazard[k]!;
    const h = this.h;
    let amp = 0;
    let mask = 0;
    if (cf.spotting && intensity > 0) {
      const e = (fh - 1) / (E.hBark - 1);
      const g = (intensity - E.onsetI0) / (E.onsetI1 - E.onsetI0);
      const ee = e < 0 ? 0 : e > 1 ? 1 : e;
      const gg = g < 0 ? 0 : g > 1 ? 1 : g;
      amp = E.e0 * E.densityScale * Math.pow(E.barkBase, bh - E.barkRef) * (intensity / 1000) * ee * gg * h * (h / ros);
      if (hasStringybark(cf, E.mixedIsStringy)) mask |= 1 << CLS_FLAKE;
      if (bh >= E.ribbonMinBh && hasRibbonBark(cf, E.mixedIsRibbon)) mask |= 1 << CLS_RIBBON;
      if (cf.hOEff > 0 && fh > E.leafFhFrac * cf.hOEff) mask |= 1 << CLS_LEAF;
      mask |= (1 << CLS_TWIG) | (1 << 4);
    }
    this.ensureActive(this.nAct + 1);
    const a = this.nAct++;
    this.aCell[a] = k;
    this.aUntil[a] = tArr;
    this.aTArr[a] = tArr;
    this.aTau[a] = cf.tauF > 0 ? cf.tauF : 30;
    this.aAmp[a] = amp;
    this.aMask[a] = mask;
    const T = (this.env.temperatureC ?? this.env.weather?.temperature ?? 25) + 273.15;
    this.aFL13[a] = intensity > 0 ? Math.cbrt(lineBuoyancyFlux(intensity, this.rhoAt(this.terrain.elevation[k]!), T, this.params.transport.chi)) : 0;
    this.aHeat[a] = intensity > 0 ? (intensity / ros) * h * h : 0;
    this.aFH[a] = fh;
    this.aHO[a] = cf.hOEff;
    this.aI[a] = intensity;
    this.cellState[k] = 1;
  }

  private ensureActive(n: number): void {
    if (n <= this.aCell.length) return;
    const cap = Math.max(n, this.aCell.length * 2);
    const gi = (a: Int32Array): Int32Array => {
      const b = new Int32Array(cap);
      b.set(a);
      return b;
    };
    const gf = (a: Float32Array): Float32Array => {
      const b = new Float32Array(cap);
      b.set(a);
      return b;
    };
    const gd = (a: Float64Array): Float64Array => {
      const b = new Float64Array(cap);
      b.set(a);
      return b;
    };
    const gu = (a: Uint8Array): Uint8Array => {
      const b = new Uint8Array(cap);
      b.set(a);
      return b;
    };
    this.aCell = gi(this.aCell);
    this.aUntil = gd(this.aUntil);
    this.aTArr = gd(this.aTArr);
    this.aTau = gf(this.aTau);
    this.aAmp = gf(this.aAmp);
    this.aMask = gu(this.aMask);
    this.aFL13 = gf(this.aFL13);
    this.aHeat = gf(this.aHeat);
    this.aFH = gf(this.aFH);
    this.aHO = gf(this.aHO);
    this.aI = gf(this.aI);
  }

  private removeActive(a: number): void {
    const l = --this.nAct;
    if (a === l) return;
    this.aCell[a] = this.aCell[l]!;
    this.aUntil[a] = this.aUntil[l]!;
    this.aTArr[a] = this.aTArr[l]!;
    this.aTau[a] = this.aTau[l]!;
    this.aAmp[a] = this.aAmp[l]!;
    this.aMask[a] = this.aMask[l]!;
    this.aFL13[a] = this.aFL13[l]!;
    this.aHeat[a] = this.aHeat[l]!;
    this.aFH[a] = this.aFH[l]!;
    this.aHO[a] = this.aHO[l]!;
    this.aI[a] = this.aI[l]!;
  }

  /** τ̄_c: measured mean slot residence (EMA with the proposal-mean prior), floored (deviation 2). */
  private lifeEstimate(c: number): number {
    const n0 = this.params.weights.lifePriorCount;
    const est = (this.lifeS[c]! + n0 * this.lifePrior[c]!) / (this.lifeN[c]! + n0);
    return est > this.lifeFloor[c]! ? est : this.lifeFloor[c]!;
  }

  /** Create one particle of class c from active emitter a, born at tBirth. */
  private spawn(a: number, c: number, tBirth: number): void {
    const i = this.acquireSlot();
    if (i < 0) return;
    const P = this.params;
    const E = P.emission;
    const cp = P.classes[c]!;
    const d = sampleClass(cp, this.r, this.draw, P);
    const k = this.aCell[a]!;
    const ci = k % this.nx;
    const cj = (k - ci) / this.nx;
    const x = this.gx0 + (ci + this.r.next() - 0.5) * this.h;
    const y = this.gy0 + (cj + this.r.next() - 0.5) * this.h;
    const zg = this.ground(x, y);
    const fh = this.aFH[a]!;
    const ho = this.aHO[a]!;
    let hl: number;
    switch (cp.launch) {
      case 'bark':
        hl = this.r.range(0.3, 1) * Math.min(fh, E.hBark);
        break;
      case 'ribbon':
        if ((ho > 0 && fh > E.leafFhFrac * ho) || this.aI[a]! > E.ribbonCrownI) {
          const top = ho > 0 ? ho : Math.min(fh, E.hBark);
          hl = this.r.range(E.crownBaseFrac * top, top);
        } else hl = this.r.range(0.3, 1) * Math.min(fh, E.hBark);
        break;
      case 'canopy':
        hl = ho;
        break;
      case 'flame':
        hl = this.r.range(0.5, 1) * fh;
        break;
      default:
        hl = E.heavyLaunch;
    }
    // VLS injection: launch at crest height (E1–E4).
    if (c <= CLS_TWIG && this.vlsActive && this.vlsActive[k]) {
      const zc = this.crestHeight(k);
      if (zc > zg + hl) hl = zc - zg;
    }
    if (!(hl > 0.1)) hl = 0.1;
    this.initParticle(i, c, x, y, zg + hl, d.vt0, d.tauF, d.tauB, this.wC[c]! * d.weight, tBirth, k, this.ncField ? this.ncField[k]! : 0,
      this.aFL13[a]!);
    this.srcClass[i] = this.sourceClassCode(k);
    if (this.loftMode === 'briggs') this.state[i] = ST_NEEDLOFT;
  }

  private initParticle(i: number, c: number, x: number, y: number, z: number, vt0: number, tauF: number, tauB: number, w: number, tBirth: number,
    k: number, cn: number, fl13: number): void {
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.up[i] = 0;
    this.vp[i] = 0;
    this.wp[i] = 0;
    this.age[i] = 0;
    this.vt0[i] = vt0;
    this.tauB[i] = tauB;
    this.flameEnd[i] = tauF;
    this.W[i] = w;
    this.zLaunch[i] = z;
    this.maxH[i] = Math.max(0, z - this.ground(x, y));
    this.sumU[i] = 0;
    this.sumV[i] = 0;
    this.cn[i] = cn;
    this.srcX[i] = x;
    this.srcY[i] = y;
    this.rx[i] = x;
    this.ry[i] = y;
    this.rz[i] = z;
    this.riseT[i] = 0;
    this.fl13[i] = fl13;
    this.tBirth[i] = tBirth;
    this.cls[i] = c;
    this.state[i] = 0;
    this.srcClass[i] = 1;
    this.srcCell[i] = k;
  }

  /** A free slot, or −1. When the budget is full drop the oldest glowing E3/E4, then the oldest glowing (§9.2). */
  private acquireSlot(): number {
    if (this.count < this.maxEmbers) return this.count++;
    if (!this.victims) this.victims = this.buildVictims();
    const v = this.victims.pop();
    if (v === undefined) {
      this.dropped++;
      return -1;
    }
    this.recordResidence(v, this.time);
    this.dropped++;
    return v;
  }

  private buildVictims(): number[] {
    const pri: number[] = [];
    const sec: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.age[i]! < this.flameEnd[i]!) continue; // flaming: keep
      const c = this.cls[i]!;
      (c === CLS_LEAF || c === CLS_TWIG ? pri : sec).push(i);
    }
    const byAge = (a: number, b: number): number => this.age[a]! - this.age[b]! || b - a;
    pri.sort(byAge);
    sec.sort(byAge);
    // pop() takes from the end: order = sec (youngest … oldest) then pri (youngest … oldest)
    return sec.concat(pri);
  }

  /** Crest height upwind of cell k (m ASL) for the VLS launch. */
  private crestHeight(k: number): number {
    const from = (this.windToDeg + 180) % 360;
    const c = this.env.crest ? this.env.crest(k, from) : null;
    if (c) return c.zCrest;
    const [ux, uy] = [Math.sin(from * DEG), Math.cos(from * DEG)];
    const x0 = this.gx0 + (k % this.nx) * this.h;
    const y0 = this.gy0 + Math.floor(k / this.nx) * this.h;
    let zmax = this.terrain.elevation[k]!;
    const steps = Math.ceil(this.params.mountain.crestSearch / this.h);
    for (let s = 1; s <= steps; s++) {
      const x = x0 + ux * s * this.h;
      const y = y0 + uy * s * this.h;
      if (x < this.xMin || x > this.xMax || y < this.yMin || y > this.yMax) break;
      const z = this.ground(x, y);
      if (z > zmax) zmax = z;
    }
    return zmax;
  }

  /** BehavePlus-style location class of source cell k (0 ridge, 1 windward, 2 leeward, 3 valley). */
  private sourceClassCode(k: number): number {
    const t = this.terrain;
    const M = this.params.mountain;
    const lf = t.landform[k]!;
    const tpi = t.tpi[k]!;
    if (lf === Landform.Ridge || lf === Landform.Peak || lf === Landform.Spur || tpi >= M.tpiRidge) return 0;
    if (lf === Landform.ValleyFloor || lf === Landform.Gully || tpi <= M.tpiValley) return 3;
    const asp = t.aspectDeg[k]!;
    if (asp !== asp) return 1;
    return Math.cos((asp - this.windToDeg) * DEG) > 0 ? 2 : 1;
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Transport internals
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════

  /** Briggs plume top (m AGL) of the current fire power, or the override (fast-tier loft, stats). */
  private diagnosePlumeTop(wind: WindFn): number {
    const L = this.params.loft;
    const over = this.env.plumeTopAGL;
    if (over !== undefined && over > 0) return over;
    if (!(this.firePowerW > 0)) return 0;
    const n2 = this.env.nSquared;
    const n = Math.sqrt(Math.max(n2 !== undefined ? n2 : L.nDefault * L.nDefault, 1e-6));
    const T = (this.env.temperatureC ?? this.env.weather?.temperature ?? 25) + 273.15;
    const zf = this.ground(this.heatCx, this.heatCy);
    const rho = this.rhoAt(zf);
    const q = this.params.transport.chi * this.firePowerW;
    let zp = this.plumeTop > 0 ? this.plumeTop : 800;
    for (let it = 0; it < 3; it++) {
      wind(this.heatCx, this.heatCy, Math.max(10, L.uHeightFrac * zp), this.wOut);
      const u = Math.hypot(this.wOut[0]!, this.wOut[1]!);
      zp = briggsPlumeRise(q, u, n, rho, T).rise;
    }
    return Math.min(L.zpMax, Math.max(L.zpMin, zp));
  }

  /** Fast-tier loft of a newborn: z_L = z_p·√ξ capped where C_w·F_L^{1/3}·e^{−z/L} ≤ v_t; rise along the tilted axis. */
  private loft(i: number, wind: WindFn): void {
    const P = this.params;
    this.state[i] = this.state[i]! & ~ST_NEEDLOFT;
    const zp = this.plumeTop;
    const wc = P.transport.cw * this.fl13[i]!;
    const x = this.px[i]!;
    const y = this.py[i]!;
    const zg = this.ground(x, y);
    const h0 = this.pz[i]! - zg;
    const vt = this.vt0[i]! * this.densAt(this.pz[i]!);
    if (!(zp > h0) || !(wc > vt)) return;
    const Ls = P.loft.capDecay > 0 ? P.loft.capDecay * zp : P.transport.zd;
    let zL = zp * Math.sqrt(this.r.next());
    const zcap = Ls * Math.log(wc / vt);
    if (zL > zcap) zL = zcap;
    if (!(zL > h0 + 1)) return;
    // Rise inside the plume column at the source slip speed (C_w·F_L^{1/3} − v_t, floored); the brand stays on the
    // tilted plume axis, whose horizontal offset at height Δz is (U/(C_w·F_L^{1/3}))·Δz (§9.3 axis formula).
    const wr = Math.max(wc - vt, P.loft.riseFloor * wc);
    const tRise = (zL - h0) / wr;
    wind(x, y, 0.5 * (h0 + zL), this.wOut);
    const u = this.wOut[0]!;
    const v = this.wOut[1]!;
    const tilt = (zL - h0) / wc;
    this.rx[i] = x + u * tilt;
    this.ry[i] = y + v * tilt;
    this.rz[i] = zg + zL;
    this.riseT[i] = this.age[i]! + tRise;
    this.sumU[i]! += u * tilt;
    this.sumV[i]! += v * tilt;
    this.state[i] = this.state[i]! | ST_RISING;
  }

  /**
   * Advance particle i from max(t0, birth) to t1. Returns true when the particle is gone (landed, burnt out, left).
   * The hot loop: locals only, no allocation.
   */
  private advance(i: number, t0: number, t1: number, wind: WindFn, turb: TurbFn, landing: LandingFn): boolean {
    const P = this.params;
    const T = P.transport;
    const TB = P.turbulence;
    const tb = this.tBirth[i]!;
    let tc = tb > t0 ? tb : t0;
    let rem = t1 - tc;
    if (!(rem > 0)) return false;
    if (this.state[i]! & ST_NEEDLOFT) this.loft(i, wind);
    const c = this.cls[i]!;
    const tauB = this.tauB[i]!;
    const vt0 = this.vt0[i]!;
    const n = this.clsN[c]!;
    const fl = this.clsFloor[c]!;
    let age = this.age[i]!;
    let x = this.px[i]!;
    let y = this.py[i]!;
    let z = this.pz[i]!;
    let st = this.state[i]!;
    // Rising inside the fast-tier plume: kinematic along the tilted axis until release.
    if (st & ST_RISING) {
      const rt = this.riseT[i]!;
      const sx = this.srcX[i]!;
      const sy = this.srcY[i]!;
      const sz = this.zLaunch[i]!;
      if (age + rem < rt) {
        age += rem;
        const f = age / rt;
        this.px[i] = sx + (this.rx[i]! - sx) * f;
        this.py[i] = sy + (this.ry[i]! - sy) * f;
        this.pz[i] = sz + (this.rz[i]! - sz) * f;
        this.age[i] = age;
        const hh = this.pz[i]! - this.ground(sx, sy);
        if (hh > this.maxH[i]!) this.maxH[i] = hh;
        if (age >= tauB) {
          this.burntOut++;
          this.goneAt = t1;
          return true;
        }
        return false;
      }
      const dr = rt - age;
      rem -= dr;
      tc += dr;
      age = rt;
      x = this.rx[i]!;
      y = this.ry[i]!;
      z = this.rz[i]!;
      st &= ~ST_RISING;
      const hh = z - this.ground(sx, sy);
      if (hh > this.maxH[i]!) this.maxH[i] = hh;
      if (age >= tauB) {
        this.burntOut++;
        this.goneAt = tc;
        return true;
      }
      if (x < this.xMin || x > this.xMax || y < this.yMin || y > this.yMax) {
        this.age[i] = age;
        this.pz[i] = z;
        this.exitDomain(i, z - this.ground(sx, sy), 0, 0, tc);
        this.goneAt = tc;
        return true;
      }
    }
    let up = this.up[i]!;
    let vp = this.vp[i]!;
    let wp = this.wp[i]!;
    let flameEnd = this.flameEnd[i]!;
    let maxH = this.maxH[i]!;
    let sumU = this.sumU[i]!;
    let sumV = this.sumV[i]!;
    const reflame = this.clsReflame[c]!;
    let zg = this.ground(x, y);
    // Turbulence scales once per atmosphere step (they vary on km scales).
    const out = this.wOut;
    const tOut = this.tOut;
    turb(x, y, Math.max(1, z - zg), tOut);
    const zi = tOut[0]!;
    const ws = tOut[1]!;
    const us = tOut[2]!;
    const sep = this.mountainOn ? this.sepField : null;
    const uRidge = this.env.uRidge ?? null;
    const plume = this.plume;
    const plumeOn = plume.active;
    const dxa = this.dxa;
    const dz1 = this.dz1;
    const nx = this.nx;
    const h = this.h;
    const gx0 = this.gx0;
    const gy0 = this.gy0;
    const modelTop = this.modelTop;
    const rr = this.r;
    let u = 0;
    let v = 0;
    while (rem > 1e-9) {
      const zagl = z - zg;
      // Resolved wind (or the ambient profile above the model top).
      let w: number;
      if (zagl > modelTop) {
        this.profileAt(zagl, out);
        u = out[0]!;
        v = out[1]!;
        w = 0;
      } else {
        wind(x, y, zagl > 0 ? zagl : 0, out);
        u = out[0]!;
        v = out[1]!;
        w = out[2]!;
      }
      // Lee eddy (§9.4): below 0.3·relief on separated cells, blend toward 0.3·U_ridge upslope.
      if (sep) {
        const ci = Math.round((x - gx0) / h);
        const cj = Math.round((y - gy0) / h);
        if (ci >= 0 && cj >= 0 && ci < nx && cj < this.ny) {
          const k = cj * nx + ci;
          const s = sep[k]!;
          if (s >= P.mountain.sepMin) {
            const relief = this.reliefAt(k);
            const asp = this.terrain.aspectDeg[k]!;
            if (zagl < P.mountain.eddyDepth * relief && asp === asp) {
              let ur = uRidge ? uRidge[k]! : NaN;
              if (!(ur === ur)) {
                wind(x, y, relief, out);
                ur = Math.hypot(out[0]!, out[1]!);
              }
              const a = asp * DEG;
              const tu = -P.mountain.eddyFraction * ur * Math.sin(a);
              const tv = -P.mountain.eddyFraction * ur * Math.cos(a);
              u = (1 - s) * u + s * tu;
              v = (1 - s) * v + s * tv;
              st |= ST_EDDY;
            }
          }
        }
      }
      // Sub-grid plume (3-D tiers), minus the resolved updraft.
      let wsg = 0;
      let alpha = 0;
      if (plumeOn) {
        wsg = plume.sample(x, y, z);
        if (wsg > 0) {
          alpha = plume.lastAlpha;
          const add = wsg - (w > 0 ? w : 0);
          if (add > 0) w += add;
        }
      }
      // Terminal velocity now (for Δt_e) with the density factor.
      const dens = this.densAt(z);
      const mr = 1 - age / tauB;
      let vf = powN(mr, n);
      if (vf < fl) vf = fl;
      const vtNow = vt0 * dens * vf;
      // Sub-step Δt_e.
      const wrel = Math.abs(w + wp - vtNow);
      const uh = Math.sqrt(u * u + v * v);
      const dzl = zagl * T.dzGrowth > dz1 ? zagl * T.dzGrowth : dz1;
      let dte = T.cfl * Math.min(wrel > 1e-6 ? dzl / wrel : 1e9, uh > 1e-6 ? dxa / uh : 1e9);
      if (dte < T.dtMin) dte = T.dtMin;
      if (dte > T.dtMax) dte = T.dtMax;
      if (dte > rem) dte = rem;
      const left = tauB - age;
      if (dte > left) dte = left;
      if (!(dte > 0)) {
        this.burntOut++;
        this.goneAt = tc;
        return true;
      }
      // Turbulence σ and Lagrangian time scales (§9.3).
      let su = 0;
      let sv = 0;
      let sw = 0;
      let th = TB.tMax;
      let tw = TB.tMax;
      let dsw2 = 0;
      const zz = zagl > 1 ? zagl : 1;
      if (zi > 0) {
        if (zz < TB.slFrac * zi) {
          su = TB.slSigmaU * us;
          sv = TB.slSigmaV * us;
          sw = TB.slSigmaW * us;
          tw = sw > 0 ? clampT((0.5 * zz) / sw, TB.tMin, TB.tMax) : TB.tMax;
          th = tw;
        } else if (zz < zi) {
          if (ws > 0) {
            const zr = zz / zi;
            const q = 1 - 0.8 * zr;
            const cb = Math.cbrt(zr);
            sw = ws * Math.sqrt(TB.cblA) * cb * q;
            su = TB.cblH * ws;
            sv = su;
            th = clampT((TB.cblT * zi) / su, TB.tMin, 10 * TB.tMax);
            tw = sw > 0 ? clampT((TB.cblT * zi) / sw, TB.tMin, 10 * TB.tMax) : TB.tMax;
            dsw2 = ((TB.cblA * ws * ws) / zi) * ((2 / 3) * (q * q) / cb - 1.6 * cb * cb * q);
          } else {
            const f = Math.pow(1 - zz / zi, TB.stableExp);
            su = TB.slSigmaU * us * f;
            sv = TB.slSigmaV * us * f;
            sw = TB.slSigmaW * us * f;
            tw = sw > 0 ? clampT((0.5 * TB.slFrac * zi) / sw, TB.tMin, TB.tMax) : TB.tMax;
            th = tw;
            const s0 = TB.slSigmaW * us;
            dsw2 = -((2 * TB.stableExp * s0 * s0) / zi) * Math.pow(1 - zz / zi, 2 * TB.stableExp - 1);
          }
          if (su < TB.sigmaFree) su = TB.sigmaFree;
          if (sv < TB.sigmaFree) sv = TB.sigmaFree;
          if (sw < TB.sigmaFree) sw = TB.sigmaFree;
        } else {
          su = TB.sigmaFree;
          sv = TB.sigmaFree;
          sw = TB.sigmaFree;
          th = TB.tFree;
          tw = TB.tFree;
        }
      }
      if (wsg > 0) {
        const spw = alpha * wsg;
        if (spw > sw) {
          sw = spw;
          tw = clampT((0.5 * zz) / sw, TB.tMin, TB.tMax);
          dsw2 = (-2 * spw * spw) / T.zd;
        }
      }
      // OU update (exact), crossing trajectories, well-mixed drift.
      if (su > 0) {
        const rv = (TB.beta * vtNow) / su;
        const te = th / Math.sqrt(1 + rv * rv);
        const e = Math.exp(-dte / te);
        const sq = Math.sqrt(1 - e * e);
        up = up * e + su * sq * NORMAL_TABLE[(rr.next() * NORMAL_TABLE_SIZE) | 0]!;
        vp = vp * e + sv * sq * NORMAL_TABLE[(rr.next() * NORMAL_TABLE_SIZE) | 0]!;
      } else if (up !== 0 || vp !== 0) {
        up *= Math.exp(-dte / th);
        vp *= Math.exp(-dte / th);
      }
      if (sw > 0) {
        const rv = (TB.beta * vtNow) / sw;
        const te = tw / Math.sqrt(1 + rv * rv);
        const e = Math.exp(-dte / te);
        wp = wp * e + sw * Math.sqrt(1 - e * e) * NORMAL_TABLE[(rr.next() * NORMAL_TABLE_SIZE) | 0]! + 0.5 * dsw2 * dte;
      } else if (wp !== 0) wp *= Math.exp(-dte / tw);
      // Move: horizontal with the frozen wind + fluctuation, vertical with the exact burning fall integral.
      const fall = vt0 * dens * fallIntegral(tauB, n, fl, age, age + dte);
      const xPrev = x;
      const yPrev = y;
      const zPrev = z;
      const zgPrev = zg;
      const ut = u + up;
      const vt = v + vp;
      x += ut * dte;
      y += vt * dte;
      z += (w + wp) * dte - fall;
      sumU += ut * dte;
      sumV += vt * dte;
      age += dte;
      rem -= dte;
      const tPrev = tc;
      tc += dte;
      // Glowing E1 re-flames (hazard λ_rf).
      if (reflame > 0 && age >= flameEnd && rr.next() < 1 - Math.exp(-reflame * dte)) {
        flameEnd = age + P.ignition.reflameDuration;
        st |= ST_REFLAMED;
      }
      // Left the domain → analytic continuation.
      if (x < this.xMin || x > this.xMax || y < this.yMin || y > this.yMax) {
        this.storeState(i, x, y, z, up, vp, wp, age, flameEnd, maxH, sumU, sumV, st);
        this.exitDomain(i, zPrev - zgPrev, ut, vt, tc);
        this.goneAt = tc;
        return true;
      }
      zg = this.ground(x, y);
      if (z <= zg + T.landEps) {
        const hp = zPrev - zgPrev;
        const hn = z - zg;
        const f = hp - hn > 1e-9 ? Math.min(1, Math.max(0, hp / (hp - hn))) : 1;
        const xl = xPrev + (x - xPrev) * f;
        const yl = yPrev + (y - yPrev) * f;
        const zgl = this.ground(xl, yl);
        const ageL = age - dte * (1 - f);
        this.storeState(i, xl, yl, zgl, up, vp, wp, ageL, flameEnd, maxH, sumU - ut * dte * (1 - f), sumV - vt * dte * (1 - f), st);
        this.goneAt = tPrev + dte * f;
        this.land(i, xl, yl, zgl, u, v, this.goneAt, landing);
        return true;
      }
      const hn = z - zg;
      if (hn > maxH) maxH = hn;
      if (age >= tauB - 1e-9) {
        this.burntOut++;
        this.goneAt = tc;
        return true;
      }
    }
    this.storeState(i, x, y, z, up, vp, wp, age, flameEnd, maxH, sumU, sumV, st);
    return false;
  }

  private storeState(i: number, x: number, y: number, z: number, up: number, vp: number, wp: number, age: number, flameEnd: number,
    maxH: number, sumU: number, sumV: number, st: number): void {
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.up[i] = up;
    this.vp[i] = vp;
    this.wp[i] = wp;
    this.age[i] = age;
    this.flameEnd[i] = flameEnd;
    this.maxH[i] = maxH;
    this.sumU[i] = sumU;
    this.sumV[i] = sumV;
    this.state[i] = st;
  }

  /** Domain exit (§9.3): remaining flight t = min(z/v_t, τ_b − age), beyond-edge distance Ū·t, histogram W·P_ig. */
  private exitDomain(i: number, zagl: number, ut: number, vt: number, t: number): void {
    const P = this.params;
    this.leftDomain++;
    const W = this.W[i]!;
    this.win.add(t, WIN.exits, W);
    const c = this.cls[i]!;
    const age = this.age[i]!;
    const tauB = this.tauB[i]!;
    const mr = 1 - age / tauB;
    let vf = powN(mr, this.clsN[c]!);
    if (vf < this.clsFloor[c]!) vf = this.clsFloor[c]!;
    const vtNow = Math.max(0.1, this.vt0[i]! * this.densAt(this.pz[i]!) * vf);
    const h = zagl > 0 ? zagl : 0;
    const tFall = h / vtNow;
    if (tFall > tauB - age) return; // burns out before landing
    let ubar: number;
    if (this.profH.length > 0) ubar = this.profileMean(h);
    else ubar = P.transport.exitWindFrac * Math.hypot(ut, vt);
    const d = ubar * tFall;
    const flaming = age + tFall < this.flameEnd[i]!;
    const pig = ignitionProbability(this.env.ambientFuelTempC ?? P.ignition.ambientFuelTemp, this.env.ambientMoisture ?? P.ignition.ambientMoisture);
    const s = flaming ? 1 : P.ignition.glowFactor * 0.5;
    const bin = Math.min(P.stats.edgeBins - 1, Math.floor(d / P.stats.edgeBinM));
    this.win.addHist(t, bin, W * pig);
    this.win.add(t, WIN.exitExpected, W * pig);
    if (pig * s >= P.ignition.capableP) this.win.add(t, WIN.exitAlive, W);
  }

  /** Landing (§9.5): exclusion zone, P_ig·S·R_fuel·(m/m0)^0.25, pile synergy, P_spot, delays, holdovers. */
  private land(i: number, xl: number, yl: number, zgl: number, uAir: number, vAir: number, t: number, landing: LandingFn): void {
    const P = this.params;
    const IG = P.ignition;
    const k = this.cellIndex(xl, yl);
    const W = this.W[i]!;
    const c = this.cls[i]!;
    const age = this.age[i]!;
    const tauB = this.tauB[i]!;
    const flaming = age < this.flameEnd[i]!;
    const st = this.state[i]!;
    const stateName: 'flaming' | 'glowing' | 'reflamed' = flaming ? (st & ST_REFLAMED ? 'reflamed' : 'flaming') : 'glowing';
    const travel = Math.hypot(xl - this.srcX[i]!, yl - this.srcY[i]!);
    this.win.add(t, WIN.landings, W);
    if (k >= 0) this.ovLanding.add(k, W / (this.h * this.h), t);
    const info = landing(xl, yl);
    let outcome: EmberLandingEvent['outcome'] = 'discarded';
    let p = 0;
    let pSpot = 0;
    let scheduled = false;
    let hold = false;
    if (info.burnable && !info.burnt && k >= 0) {
      // Exclusion zone: short-range spotting is already inside the empirical ROS.
      const dex = Math.max(IG.exclusionCells * this.h, info.rosLocal * IG.exclusionTime);
      let downwind = true;
      if (info.distToFront < dex) {
        let wx = uAir;
        let wy = vAir;
        if (wx * wx + wy * wy < 0.01) {
          wx = Math.sin(this.windToDeg * DEG);
          wy = Math.cos(this.windToDeg * DEG);
        }
        const fx = info.frontDirX;
        const fy = info.frontDirY;
        downwind = fx === 0 && fy === 0 ? true : fx * wx + fy * wy > 0;
      }
      if (info.distToFront < dex && downwind) {
        outcome = 'shortRange';
        this.win.add(t, WIN.shortRange, W);
      } else {
        outcome = 'attempt';
        const sState = flaming ? 1 : IG.glowFactor * clamp01(info.bedWindMs / IG.bedWindRef);
        let fam = 0;
        switch (info.family) {
          case 'vesta2':
          case 'pine':
            fam = Math.min(1, info.surfaceHazard / 2);
            break;
          case 'heath':
            fam = Math.min(1, info.nearSurfaceHazard / 2);
            break;
          case 'grass':
            fam = clamp01(info.curing / 100);
            break;
          default:
            fam = 0;
        }
        const rec = this.cellFuelFn ? this.cellFuelFn(k).receptivity : catalogueReceptivity(this.fuel, k);
        const m = Math.max(0, 1 - age / tauB);
        p = ignitionProbability(info.fuelTempC, info.moisture) * sState * rec * fam * Math.sqrt(Math.sqrt(m));
        // Pile synergy: ≥ 3 real brands in one cell within 60 s.
        let pe = this.pile.get(k);
        if (!pe || t - pe.t0 > IG.pileWindow) {
          pe = { t0: t, n: 0 };
          this.pile.set(k, pe);
        }
        pe.n += W;
        if (pe.n >= IG.pileMin) p *= 1 + IG.pileGain * Math.min(pe.n - 1, IG.pileMaxN);
        if (p > IG.pMax) p = IG.pMax;
        if (p >= IG.capableP) {
          this.win.add(t, WIN.capable, W);
          this.win.max(t, travel);
        }
        if (p > 0) this.ovIgnition.add(k, W * p, t);
        pSpot = 1 - Math.exp(-W * p);
        const heavy = info.surfaceHazard >= IG.holdoverFhs || ((this.fuel.flags ? this.fuel.flags[k]! : 0) & FuelFlag.HeavyFuel) !== 0;
        if (!flaming && heavy && this.r.next() < 1 - Math.exp(-IG.holdoverShare * W)) {
          hold = true;
          const prov = this.provenance(i, zgl, k, 'holdover', info.moisture, p, travel);
          if (this.holdovers.length >= IG.maxHoldovers) this.holdovers.shift();
          this.holdovers.push({ x: xl, y: yl, tLand: t, prov });
        }
        if (pSpot > 0 && this.r.next() < pSpot) {
          const dl = flaming ? IG.delayFlaming : IG.delayGlowing;
          const due = t + this.r.range(dl[0], dl[1]);
          const prov = this.provenance(i, zgl, k, stateName, info.moisture, p, travel);
          this.schedule({ due, x: xl, y: yl, travel, prov });
          scheduled = true;
        }
      }
    }
    if (this.onLanding) {
      this.onLanding({
        x: xl, y: yl, cell: k, emberClass: EMBER_CLASSES[c]!, weight: W, p, pSpot, travel, flightTime: age,
        maxHeightAGL: this.maxH[i]!, state: stateName, outcome, scheduled, holdover: hold, moisture: info.moisture,
        sourceCell: this.srcCell[i]!, leeEddy: (st & ST_EDDY) !== 0, ridgeDrop: this.zLaunch[i]! - zgl,
        sourceClass: SOURCE_CLASSES[this.srcClass[i]!]!,
      });
    }
  }

  private provenance(i: number, zgl: number, k: number, landingState: SpotProvenance['landingState'],
    moisture: number, p: number, travel: number): SpotProvenance {
    const age = this.age[i]!;
    const ft = age > 0 ? age : 1;
    return {
      sourceCell: this.srcCell[i]!,
      emberClass: EMBER_CLASSES[this.cls[i]!]!,
      emitTime: this.tBirth[i]!,
      maxHeightAGL: this.maxH[i]!,
      flightTime: age,
      distance: travel,
      meanWindAloft: [this.sumU[i]! / ft, this.sumV[i]! / ft],
      landingState,
      landingMoisture: moisture,
      pIgnite: p,
      landingSlope: this.terrain.slopeDeg[k]!,
      landingAspect: this.terrain.aspectDeg[k]!,
      leeEddy: (this.state[i]! & ST_EDDY) !== 0,
      ridgeDrop: this.zLaunch[i]! - zgl,
      convectiveNumber: this.cn[i]!,
      sourceClass: SOURCE_CLASSES[this.srcClass[i]!]!,
    };
  }

  private schedule(p: PendingIgnition): void {
    const q = this.pending;
    let j = q.length;
    while (j > 0 && q[j - 1]!.due > p.due) j--;
    q.splice(j, 0, p);
  }

  /** Fire due ignitions (in due-time order) and holdover conversions up to t1. */
  private processIgnitions(t1: number, landing: LandingFn, onIgnite: IgniteFn): void {
    const q = this.pending;
    let n = 0;
    while (n < q.length && q[n]!.due <= t1) n++;
    if (n > 0) {
      const due = q.splice(0, n);
      for (const p of due) {
        const info = landing(p.x, p.y);
        if (!info.burnable || info.burnt) continue;
        this.win.add(p.due, WIN.ignitions, 1);
        onIgnite(p.x, p.y, p.travel, p.prov);
      }
    }
    // Prune the pile-synergy windows.
    if (this.pile.size > 0) {
      const wnd = this.params.ignition.pileWindow;
      for (const [k, v] of this.pile) if (t1 - v.t0 > wnd) this.pile.delete(k);
    }
    // Holdovers: smoulder ≤ 24 h, convert with hazard (1/3600 s⁻¹)·clamp((10 − M)/5, 0, 1).
    const IG = this.params.ignition;
    if (this.holdovers.length === 0) {
      this.lastHoldoverCheck = t1;
      return;
    }
    if (t1 - this.lastHoldoverCheck < IG.holdoverCheck) return;
    const dtc = Math.min(t1 - this.lastHoldoverCheck, 3600);
    this.lastHoldoverCheck = t1;
    const keep: Holdover[] = [];
    for (const hv of this.holdovers) {
      if (t1 - hv.tLand > IG.holdoverMaxAge) continue;
      const info = landing(hv.x, hv.y);
      if (!info.burnable || info.burnt) continue;
      const hz = (1 / IG.holdoverTime) * clamp01((IG.holdoverM0 - info.moisture) / IG.holdoverDm);
      const pc = 1 - Math.exp(-hz * dtc);
      if (pc > 0 && this.r.next() < pc) {
        const prov = { ...hv.prov, landingMoisture: info.moisture, pIgnite: pc };
        this.win.add(t1, WIN.ignitions, 1);
        onIgnite(hv.x, hv.y, prov.distance, prov);
      } else keep.push(hv);
    }
    this.holdovers = keep;
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Environment helpers
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════

  /** Bilinear ground elevation (m ASL) on the fire grid, clamped at the edges. */
  private ground(x: number, y: number): number {
    const nx = this.nx;
    const ny = this.ny;
    let fx = (x - this.gx0) / this.h;
    let fy = (y - this.gy0) / this.h;
    if (fx < 0) fx = 0;
    else if (fx > nx - 1) fx = nx - 1;
    if (fy < 0) fy = 0;
    else if (fy > ny - 1) fy = ny - 1;
    let i = fx | 0;
    let j = fy | 0;
    if (i > nx - 2) i = nx - 2;
    if (j > ny - 2) j = ny - 2;
    const tx = fx - i;
    const ty = fy - j;
    const e = this.terrain.elevation;
    const k = j * nx + i;
    const a = e[k]!;
    const b = e[k + 1]!;
    const c = e[k + nx]!;
    const d = e[k + nx + 1]!;
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }

  private cellIndex(x: number, y: number): number {
    const i = Math.round((x - this.gx0) / this.h);
    const j = Math.round((y - this.gy0) / this.h);
    return i >= 0 && j >= 0 && i < this.nx && j < this.ny ? j * this.nx + i : -1;
  }

  private reliefAt(k: number): number {
    if (!this.reliefField) {
      const r = Math.max(1, Math.round(this.params.mountain.reliefRadius / this.h));
      const mm = slidingMinMax(this.terrain.grid, this.terrain.elevation, r);
      const rel = new Float32Array(this.nCells);
      for (let q = 0; q < this.nCells; q++) rel[q] = mm.max[q]! - mm.min[q]!;
      this.reliefField = rel;
    }
    return this.reliefField[k]!;
  }

  /** ρ_air (kg/m³) at z ASL (ISA pressure, surface T with a 6.5 K/km lapse) or the constant override. */
  private rhoAt(z: number): number {
    if (this.env.airDensity !== undefined) return this.env.airDensity;
    const t0 = this.env.temperatureC ?? this.env.weather?.temperature ?? 25;
    return airDensity(t0 - 0.0065 * (z - this.zRef), pressureIsa(z));
  }

  private rebuildDensity(): void {
    this.densLo = this.terrain.minElevation - 500;
    const hi = this.terrain.maxElevation + 15000;
    const n = Math.ceil((hi - this.densLo) / this.densDz) + 1;
    this.densLut = new Float64Array(n);
    for (let q = 0; q < n; q++) this.densLut[q] = Math.sqrt(RHO_REF / this.rhoAt(this.densLo + q * this.densDz));
  }

  /** √(ρ_ref/ρ_air) at z ASL. */
  private densAt(z: number): number {
    let q = Math.round((z - this.densLo) / this.densDz);
    const lut = this.densLut;
    if (q < 0) q = 0;
    else if (q >= lut.length) q = lut.length - 1;
    return lut[q]!;
  }

  /** Ambient profile (u, v by height AGL) from the 10 m wind, windProfile and pressure levels above ground. */
  private rebuildProfile(w: WeatherHour): void {
    const pts: [number, number, number][] = [];
    const [u10, v10] = windToUV(w.windSpeed10, w.windDir10);
    pts.push([10, u10, v10]);
    for (const p of w.windProfile ?? []) {
      const [u, v] = windToUV(p.speed, p.dir);
      if (p.heightAGL > 10) pts.push([p.heightAGL, u, v]);
    }
    for (const p of w.pressureLevels ?? []) {
      const hAgl = p.height - this.zRef;
      if (!(hAgl > 50)) continue; // drop sub-surface levels
      const [u, v] = windToUV(p.windSpeed, p.windDir);
      pts.push([hAgl, u, v]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    const hs: number[] = [];
    const us: number[] = [];
    const vs: number[] = [];
    for (const [hh, u, v] of pts) {
      if (hs.length && hh - hs[hs.length - 1]! < 1) continue;
      hs.push(hh);
      us.push(u);
      vs.push(v);
    }
    this.profH = Float64Array.from(hs);
    this.profU = Float64Array.from(us);
    this.profV = Float64Array.from(vs);
  }

  private profileAt(zagl: number, out: Float32Array): void {
    const H = this.profH;
    const n = H.length;
    if (n === 0) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      return;
    }
    if (zagl <= H[0]!) {
      out[0] = this.profU[0]!;
      out[1] = this.profV[0]!;
    } else if (zagl >= H[n - 1]!) {
      out[0] = this.profU[n - 1]!;
      out[1] = this.profV[n - 1]!;
    } else {
      let j = 1;
      while (H[j]! < zagl) j++;
      const f = (zagl - H[j - 1]!) / (H[j]! - H[j - 1]!);
      out[0] = this.profU[j - 1]! + (this.profU[j]! - this.profU[j - 1]!) * f;
      out[1] = this.profV[j - 1]! + (this.profV[j]! - this.profV[j - 1]!) * f;
    }
    out[2] = 0;
  }

  /** Mean horizontal ambient speed over [0, z] AGL (16-point midpoint rule). */
  private profileMean(z: number): number {
    if (!(z > 0)) {
      this.profileAt(1, this.tOut);
      return Math.hypot(this.tOut[0]!, this.tOut[1]!);
    }
    let su = 0;
    let sv = 0;
    for (let q = 0; q < 16; q++) {
      this.profileAt(((q + 0.5) / 16) * z, this.tOut);
      su += this.tOut[0]!;
      sv += this.tOut[1]!;
    }
    return Math.hypot(su / 16, sv / 16);
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Particle storage
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════

  private allocParticles(cap: number): void {
    this.cap = cap;
    this.px = new Float32Array(cap);
    this.py = new Float32Array(cap);
    this.pz = new Float32Array(cap);
    this.up = new Float32Array(cap);
    this.vp = new Float32Array(cap);
    this.wp = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.vt0 = new Float32Array(cap);
    this.tauB = new Float32Array(cap);
    this.flameEnd = new Float32Array(cap);
    this.W = new Float32Array(cap);
    this.zLaunch = new Float32Array(cap);
    this.maxH = new Float32Array(cap);
    this.sumU = new Float32Array(cap);
    this.sumV = new Float32Array(cap);
    this.cn = new Float32Array(cap);
    this.srcX = new Float32Array(cap);
    this.srcY = new Float32Array(cap);
    this.rx = new Float32Array(cap);
    this.ry = new Float32Array(cap);
    this.rz = new Float32Array(cap);
    this.riseT = new Float32Array(cap);
    this.fl13 = new Float32Array(cap);
    this.tBirth = new Float64Array(cap);
    this.cls = new Uint8Array(cap);
    this.state = new Uint8Array(cap);
    this.srcClass = new Uint8Array(cap);
    this.srcCell = new Int32Array(cap);
    this.count = 0;
  }

  private snapshotArrays(n: number): ParticleArrays {
    const f = (a: F32): F32 => a.slice(0, n);
    return {
      px: f(this.px), py: f(this.py), pz: f(this.pz), up: f(this.up), vp: f(this.vp), wp: f(this.wp), age: f(this.age),
      vt0: f(this.vt0), tauB: f(this.tauB), flameEnd: f(this.flameEnd), W: f(this.W), zLaunch: f(this.zLaunch),
      maxH: f(this.maxH), sumU: f(this.sumU), sumV: f(this.sumV), cn: f(this.cn), srcX: f(this.srcX), srcY: f(this.srcY),
      rx: f(this.rx), ry: f(this.ry), rz: f(this.rz), riseT: f(this.riseT), fl13: f(this.fl13),
      tBirth: this.tBirth.slice(0, n), cls: this.cls.slice(0, n), state: this.state.slice(0, n),
      srcClass: this.srcClass.slice(0, n), srcCell: this.srcCell.slice(0, n),
    };
  }

  private loadArrays(a: ParticleArrays, n: number): void {
    const m = Math.min(n, this.cap);
    const s = <T extends F32 | Float64Array | Uint8Array | Int32Array>(dst: T, src: T): void => {
      dst.set(src.subarray(0, m) as never);
    };
    s(this.px, a.px); s(this.py, a.py); s(this.pz, a.pz); s(this.up, a.up); s(this.vp, a.vp); s(this.wp, a.wp);
    s(this.age, a.age); s(this.vt0, a.vt0); s(this.tauB, a.tauB); s(this.flameEnd, a.flameEnd); s(this.W, a.W);
    s(this.zLaunch, a.zLaunch); s(this.maxH, a.maxH); s(this.sumU, a.sumU); s(this.sumV, a.sumV); s(this.cn, a.cn);
    s(this.srcX, a.srcX); s(this.srcY, a.srcY); s(this.rx, a.rx); s(this.ry, a.ry); s(this.rz, a.rz);
    s(this.riseT, a.riseT); s(this.fl13, a.fl13); s(this.tBirth, a.tBirth); s(this.cls, a.cls); s(this.state, a.state);
    s(this.srcClass, a.srcClass); s(this.srcCell, a.srcCell);
    this.count = m;
  }

  /** Swap-remove particle i (the last particle moves into slot i), recording its residence up to time t. */
  private removeAt(i: number, t: number): void {
    this.recordResidence(i, t);
    const l = --this.count;
    if (i === l) return;
    this.px[i] = this.px[l]!;
    this.py[i] = this.py[l]!;
    this.pz[i] = this.pz[l]!;
    this.up[i] = this.up[l]!;
    this.vp[i] = this.vp[l]!;
    this.wp[i] = this.wp[l]!;
    this.age[i] = this.age[l]!;
    this.vt0[i] = this.vt0[l]!;
    this.tauB[i] = this.tauB[l]!;
    this.flameEnd[i] = this.flameEnd[l]!;
    this.W[i] = this.W[l]!;
    this.zLaunch[i] = this.zLaunch[l]!;
    this.maxH[i] = this.maxH[l]!;
    this.sumU[i] = this.sumU[l]!;
    this.sumV[i] = this.sumV[l]!;
    this.cn[i] = this.cn[l]!;
    this.srcX[i] = this.srcX[l]!;
    this.srcY[i] = this.srcY[l]!;
    this.rx[i] = this.rx[l]!;
    this.ry[i] = this.ry[l]!;
    this.rz[i] = this.rz[l]!;
    this.riseT[i] = this.riseT[l]!;
    this.fl13[i] = this.fl13[l]!;
    this.tBirth[i] = this.tBirth[l]!;
    this.cls[i] = this.cls[l]!;
    this.state[i] = this.state[l]!;
    this.srcClass[i] = this.srcClass[l]!;
    this.srcCell[i] = this.srcCell[l]!;
  }

  /** Residence bookkeeping for τ̄_c (slot occupancy from birth to landing / burnout / exit / drop). */
  private recordResidence(i: number, t: number): void {
    if (this.state[i]! & ST_INJECTED) return;
    const c = this.cls[i]!;
    this.lifeS[c]! += Math.max(0, t - this.tBirth[i]!);
    this.lifeN[c]! += 1;
  }

  private syncIn(): void {
    this.r.s = this.rng.state >>> 0;
  }

  private syncOut(): void {
    this.rng.state = this.r.s;
  }
}

interface ParticleArrays {
  px: F32; py: F32; pz: F32; up: F32; vp: F32; wp: F32; age: F32; vt0: F32; tauB: F32; flameEnd: F32; W: F32; zLaunch: F32;
  maxH: F32; sumU: F32; sumV: F32; cn: F32; srcX: F32; srcY: F32; rx: F32; ry: F32; rz: F32; riseT: F32; fl13: F32;
  tBirth: Float64Array; cls: Uint8Array; state: Uint8Array; srcClass: Uint8Array; srcCell: Int32Array;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampT = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function cloneProv(p: SpotProvenance): SpotProvenance {
  return { ...p, meanWindAloft: [p.meanWindAloft[0], p.meanWindAloft[1]] };
}
