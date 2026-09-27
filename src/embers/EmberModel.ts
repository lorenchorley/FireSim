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
 *  2. τ̄_c in W_c is the measured mean slot residence of the class (EMA, prior = proposal mean τ_b), not the median
 *     τ_b: with importance-sampled lifetimes and early landings the median gives populations 0.02–2.3× the budget;
 *     §9.7 asks for 0.8·maxEmbers ± 10 %. The equal allocation π_c is applied by water-filling: a class whose W_c sits
 *     at its floor (1e-3, or a throughput cap of π_0·B/60 s particles per second that stops quick-landing classes
 *     from spawning thousands of particles per step) gives its unused share to the others. n̄_c is a bias-corrected
 *     EMA (no ×10 start-up overshoot), and W_c uses max(n̄_c, this step's rate) so a burst of cells igniting together
 *     (a grid-aligned front) cannot spawn a multiple of the budget before the EMA catches up.
 *  3. Fast-tier loft cap uses the decay scale L = 0.5·z_p (C_w·F_L^{1/3}·e^{−z/L} ≤ v_t) instead of z_d = 200 m, which
 *     would cap every brand below ≈ 100–300 m and make fast-tier spotting several times shorter than the Mk5 / AFDRS
 *     targets (V9); the rise follows the tilted plume axis at the source slip speed (spec gives no rise kinematics).
 *  4. Domain exit: brands that would burn out before reaching the ground beyond the edge are counted in `leftDomain`
 *     but not in the beyond-edge histogram (the spec's t = min(z/v_t, τ_b − age) would count them as if they landed);
 *     the fall time is the exact burning fall (v_t decreasing with mass), not z/v_t at the exit speed.
 *  5. Budget full: after the glowing E3/E4 (oldest first, §9.2) the newborn is refused rather than dropping glowing
 *     long-range brands in flight (dropping the oldest biased the far tail by −25 % in tests); its weight is carried
 *     to the next particle of its class, so the emitted brand count stays unbiased.
 *  6. Holdovers form only from glowing landings that did not start an immediate spot (the cell of an immediate spot
 *     burns, which cancels a holdover there); a holdover record carries E[N | N ≥ 1] smouldering brands of the
 *     super-particle (N ~ Poisson(0.02·W)) and converts with N × the per-brand hazard.
 *
 * Performance (§9.7, §13): the transport loop inlines the ground, density LUT, OU noise and the burning-fall integral
 * (carried as r^{n+1}), ≈ 150–180 ns per particle sub-step on one x86 core with CBL turbulence; the whole model with
 * ≈ 3200 embers is ≈ 1.1–1.9 ms per atmosphere step on x86 (≈ 2.5–5 ms on a phone). The 1-D quantities that vary on
 * km scales (turbulence scales z_i, w*, u*) are sampled once per particle per atmosphere step.
 *
 * Checkpoints hold every piece of model state (particles, emitters, weights and residence estimates, pile windows,
 * pending ignitions, holdovers, stats windows, overlays, RNG) plus the scalar environment; the per-cell rasters of
 * `setEnvironment` (uRidge, relief, sep) and the crest resolver belong to sim/fire and are not copied.
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
import { briggsPlumeRise, fallTime, ignitionProbability, lineBuoyancyFlux } from './physics';
import { PlumeField, PlumeSources, type WindFn } from './plume';
import { FastRng, NORMAL_TABLE, medianTauB, proposalMeanTauB, sampleClass, type EmberDraw } from './sampling';
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
  /** Cumulative particle sub-steps Δt_e (performance diagnostics). */
  particleSteps: number;
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
  /** Time up to which the conversion hazard has been integrated (s). */
  tCheck: number;
  /** Expected smouldering real brands in the record, E[N | N ≥ 1] with N ~ Poisson(0.02·W). */
  n: number;
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
  /** Exponent code (0: n = 1, 1: n = 1/2, 2: n = 1/4, 3: other) and the floor ratio r_c = floor^{1/n} per class. */
  private readonly clsNCode = new Uint8Array(N_CLASSES);
  private readonly clsRc = new Float64Array(N_CLASSES);
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
  /** Weight of refused newborns carried to the next particle of the class (budget full). */
  private readonly wCarry = new Float64Array(N_CLASSES);
  /** This step's class emission rate (brands/s), for the pulse guard of W_c. */
  private readonly rateNow = new Float64Array(N_CLASSES);
  private readonly lifeS = new Float64Array(N_CLASSES);
  private readonly lifeN = new Float64Array(N_CLASSES);
  private readonly lifePrior = new Float64Array(N_CLASSES);
  private readonly lifeFloor = new Float64Array(N_CLASSES);
  private readonly wTmpRate = new Float64Array(N_CLASSES);
  private readonly wTmpLife = new Float64Array(N_CLASSES);
  private readonly wTmpLow = new Float64Array(N_CLASSES);
  private readonly wTmpFree = new Uint8Array(N_CLASSES);
  private readonly classPop = new Int32Array(N_CLASSES);
  private readonly emitted = new Float64Array(N_CLASSES);
  private readonly classSum = new Float64Array(N_CLASSES);
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
  private readonly nya: number;
  /** Per-step cache of the turbulence scales per atmosphere column ([z_i, w*, u*] × columns) and its step stamps. */
  private readonly turbCache: Float32Array;
  private readonly turbStamp: Uint32Array;
  private stepId = 0;
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
  /** Pile synergy per fire cell: start time of the current 60 s window and real brands landed in it. */
  private readonly pileT0: Float64Array;
  private readonly pileN: Float32Array;
  private pending: PendingIgnition[] = [];
  private holdovers: Holdover[] = [];
  private lastHoldoverCheck = -Infinity;
  private readonly win: RollingWindow;
  private readonly ovLanding: DecayRaster;
  private readonly ovIgnition: DecayRaster;
  private leftDomain = 0;
  private burntOut = 0;
  private dropped = 0;
  /** Cumulative particle sub-steps (performance diagnostics, §9.7 budget per particle-step). */
  private subSteps = 0;
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
    this.pileT0 = new Float64Array(this.nCells).fill(-Infinity);
    this.pileN = new Float32Array(this.nCells);
    this.nxa = Math.ceil((this.xMax - this.xMin) / this.dxa) + 1;
    const nya = Math.ceil((this.yMax - this.yMin) / this.dxa) + 1;
    this.nya = nya;
    this.colIndex = new Int32Array(this.nxa * nya).fill(-1);
    this.turbCache = new Float32Array(3 * this.nxa * nya);
    this.turbStamp = new Uint32Array(this.nxa * nya);
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
      this.clsNCode[c] = cp.n === 1 ? 0 : cp.n === 0.5 ? 1 : cp.n === 0.25 ? 2 : 3;
      this.clsRc[c] = cp.vtFloor > 0 ? Math.pow(cp.vtFloor, 1 / cp.n) : 0;
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
    const classSum = this.classSum;
    classSum.fill(0);
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
    // 3. Class weights W_c = max(wMin, n̄_c·τ̄_c/(π_c·0.8·maxEmbers)), n̄_c bias-corrected EMA over 300 s (§9.2).
    if (dt > 0) {
      const beta = Math.exp(-dt / P.weights.rateTau);
      this.rateNorm = this.rateNorm * beta + (1 - beta);
      for (let c = 0; c < N_CLASSES; c++) {
        this.rateNow[c] = classSum[c]! / dt;
        this.rateM[c] = this.rateM[c]! * beta + this.rateNow[c]! * (1 - beta);
      }
      this.updateWeights();
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
    this.stepId = (this.stepId + 1) >>> 0 || 1; // new turbulence-cache generation (0 = never sampled)
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
      particleSteps: this.subSteps,
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
    this.initParticle(i, c, p.x, p.y, p.z, this.ground(p.x, p.y), p.vt0, p.tauF ?? Math.min(p.tauB, this.params.classes[c]!.tauF.median), p.tauB, p.weight ?? 1, t,
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
      wCarry: this.wCarry.slice(),
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
      pile: this.pileCheckpoint(),
      pending: this.pending.map((p) => ({ ...p, prov: cloneProv(p.prov) })),
      holdovers: this.holdovers.map((h) => ({ ...h, prov: cloneProv(h.prov) })),
      lastHoldoverCheck: this.lastHoldoverCheck,
      win: this.win.checkpoint(),
      ovLanding: this.ovLanding.checkpoint(),
      ovIgnition: this.ovIgnition.checkpoint(),
      leftDomain: this.leftDomain,
      burntOut: this.burntOut,
      dropped: this.dropped,
      subSteps: this.subSteps,
      env: scalarEnv(this.env),
    };
  }

  restore(cIn: unknown): void {
    const s = cIn as {
      time: number; rng: number; maxEmbers: number; count: number; arrays: ParticleArrays; cellState: Uint8Array;
      act: { n: number; cell: Int32Array; until: Float64Array; tArr: Float64Array; tau: Float32Array; amp: Float32Array;
        mask: Uint8Array; fl13: Float32Array; heat: Float32Array; fh: Float32Array; ho: Float32Array; i: Float32Array };
      rateM: Float64Array; rateNorm: number; emitted: Float64Array; wC: Float64Array; wCarry: Float64Array; lifeS: Float64Array; lifeN: Float64Array; firePowerW: number;
      powerM: number; powerNorm: number;
      heatCx: number; heatCy: number; plumeTop: number; windToDeg: number;
      sources: { n: number; x: Float64Array; y: Float64Array; z0: Float64Array; w0: Float64Array; alpha: Float64Array };
      pile: { idx: Int32Array; t0: Float64Array; n: Float32Array }; pending: PendingIgnition[]; holdovers: Holdover[]; lastHoldoverCheck: number;
      win: ReturnType<RollingWindow['checkpoint']>; ovLanding: ReturnType<DecayRaster['checkpoint']>;
      ovIgnition: ReturnType<DecayRaster['checkpoint']>; leftDomain: number; burntOut: number; dropped: number;
      subSteps: number; env?: EmberEnvironment;
    };
    this.time = s.time;
    this.turbStamp.fill(0); // invalidate the per-step turbulence cache
    this.stepId = 0;
    this.rng.state = s.rng;
    this.r.s = s.rng >>> 0;
    this.r.spare = NaN;
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
    this.wCarry.set(s.wCarry);
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
    this.pileT0.fill(-Infinity);
    this.pileN.fill(0);
    for (let q = 0; q < s.pile.idx.length; q++) {
      this.pileT0[s.pile.idx[q]!] = s.pile.t0[q]!;
      this.pileN[s.pile.idx[q]!] = s.pile.n[q]!;
    }
    this.pending = s.pending.map((p) => ({ ...p, prov: cloneProv(p.prov) }));
    this.holdovers = s.holdovers.map((h) => ({ ...h, prov: cloneProv(h.prov) }));
    this.lastHoldoverCheck = s.lastHoldoverCheck;
    this.win.restore(s.win);
    this.ovLanding.restore(s.ovLanding);
    this.ovIgnition.restore(s.ovIgnition);
    this.leftDomain = s.leftDomain;
    this.burntOut = s.burntOut;
    this.dropped = s.dropped;
    this.subSteps = s.subSteps;
    // Scalar environment (weather profile, N², plume top, density, hooks); the per-cell rasters (uRidge, relief, sep)
    // and the crest resolver belong to sim/fire and stay as currently set.
    if (s.env) this.setEnvironment(s.env);
  }

  /** Sparse copy of the live pile-synergy windows (t − t0 ≤ window). */
  private pileCheckpoint(): { idx: Int32Array; t0: Float64Array; n: Float32Array } {
    const wnd = this.params.ignition.pileWindow;
    const idx: number[] = [];
    for (let k = 0; k < this.nCells; k++) if (this.time - this.pileT0[k]! <= wnd) idx.push(k);
    const t0 = new Float64Array(idx.length);
    const n = new Float32Array(idx.length);
    idx.forEach((k, q) => {
      t0[q] = this.pileT0[k]!;
      n[q] = this.pileN[k]!;
    });
    return { idx: Int32Array.from(idx), t0, n };
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
    // NaN-safe reads: a non-finite intensity, ROS, flame height or bark hazard emits nothing (never NaN rates).
    const iRaw = fire.intensity[k]!;
    const intensity = iRaw > 0 && iRaw < Infinity ? iRaw : 0;
    const rRaw = fire.ros[k]!;
    const ros = rRaw > E.rosFloor ? rRaw : E.rosFloor;
    const fhRaw = fire.flameHeight[k]!;
    const fh = fhRaw > 0 ? fhRaw : 0;
    const bhRaw = fuel.barkHazard[k]!;
    const bh = bhRaw === bhRaw ? bhRaw : 0;
    const h = this.h;
    let amp = 0;
    let mask = 0;
    if (cf.spotting && intensity > 0) {
      const e = (fh - 1) / (E.hBark - 1);
      const g = (intensity - E.onsetI0) / (E.onsetI1 - E.onsetI0);
      const ee = e > 0 ? (e < 1 ? e : 1) : 0;
      const gg = g > 0 ? (g < 1 ? g : 1) : 0;
      amp = E.e0 * E.densityScale * Math.pow(E.barkBase, bh - E.barkRef) * (intensity / 1000) * ee * gg * h * (h / ros);
      if (!(amp > 0 && amp < Infinity)) amp = 0;
      if (hasStringybark(cf, E.mixedIsStringy)) mask |= 1 << CLS_FLAKE;
      if (bh >= E.ribbonMinBh && hasRibbonBark(cf, E.mixedIsRibbon)) mask |= 1 << CLS_RIBBON;
      if (cf.hOEff > 0 && fh > E.leafFhFrac * cf.hOEff) mask |= 1 << CLS_LEAF;
      mask |= (1 << CLS_TWIG) | (1 << 4);
    }
    this.ensureActive(this.nAct + 1);
    const a = this.nAct++;
    this.aCell[a] = k;
    // Emission starts at max(tArr, window start): a cell first seen after it ignited (embers switched on mid-run, a
    // gap in the burning list) does not dump its past emission into the current window.
    this.aUntil[a] = tArr > this.time ? tArr : this.time;
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

  /** τ̄_c: measured mean slot residence of class c (EMA with the proposal-mean prior; deviation 2). */
  private lifeEstimate(c: number): number {
    const n0 = this.params.weights.lifePriorCount;
    return (this.lifeS[c]! + n0 * this.lifePrior[c]!) / (this.lifeN[c]! + n0);
  }

  /**
   * W_c = max(W_low,c, n̄_c·τ̄_c/(π_c·B)), B = 0.8·maxEmbers (§9.2) with the equal allocation π_c = 1/(number of
   * classes with n̄_c > 0) applied by water-filling: a class whose weight sits at its floor W_low,c (the spec's 1e-3,
   * or the throughput cap n̄_c·τ_min,c/(π_0·B) that keeps quick-landing classes from spawning more than π_0·B/τ_min,c
   * particles per second) cannot use its share, and the unused budget is split equally among the other classes, so the
   * class populations sum to B in steady emission (§9.7) [deviation 2]. Classes that never emitted keep W_c.
   */
  private updateWeights(): void {
    const Pw = this.params.weights;
    const budget = Pw.budgetFraction * this.maxEmbers;
    const nbar = this.wTmpRate;
    const life = this.wTmpLife;
    const low = this.wTmpLow;
    const free = this.wTmpFree;
    let present = 0;
    for (let c = 0; c < N_CLASSES; c++) {
      // n̄_c (300 s EMA), or this step's rate when larger: a burst (a grid-aligned front ignites whole rows at once)
      // must not spawn a multiple of the budget before the EMA catches up.
      const nb = this.rateNorm > 0 ? this.rateM[c]! / this.rateNorm : 0;
      nbar[c] = nb > this.rateNow[c]! ? nb : this.rateNow[c]!;
      if (nbar[c]! > 0) present++;
    }
    if (present === 0) return;
    const pi0 = 1 / present;
    for (let c = 0; c < N_CLASSES; c++) {
      free[c] = nbar[c]! > 0 ? 1 : 0;
      if (!free[c]) continue;
      life[c] = this.lifeEstimate(c);
      const thr = (nbar[c]! * this.lifeFloor[c]!) / (pi0 * budget);
      low[c] = thr > Pw.wMin ? thr : Pw.wMin;
    }
    let rest = budget;
    let nFree = present;
    for (let it = 0; it < N_CLASSES && nFree > 0; it++) {
      const share = rest / nFree;
      let changed = false;
      for (let c = 0; c < N_CLASSES; c++) {
        if (!free[c]) continue;
        const w = (nbar[c]! * life[c]!) / share;
        if (!(w > low[c]!)) {
          // constrained: weight at its floor, population n̄·τ̄/W_low (< share)
          this.wC[c] = low[c]!;
          rest -= (nbar[c]! * life[c]!) / low[c]!;
          free[c] = 0;
          nFree--;
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (nFree > 0) {
      const share = Math.max(rest, 0) / nFree;
      for (let c = 0; c < N_CLASSES; c++) {
        if (!free[c]) continue;
        const w = share > 0 ? (nbar[c]! * life[c]!) / share : low[c]!;
        this.wC[c] = w > low[c]! ? w : low[c]!;
      }
    }
  }

  /** Create one particle of class c from active emitter a, born at tBirth. */
  private spawn(a: number, c: number, tBirth: number): void {
    const i = this.acquireSlot();
    if (i < 0) {
      this.wCarry[c]! += this.wC[c]!;
      return;
    }
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
    const wNew = (this.wC[c]! + this.wCarry[c]!) * d.weight;
    this.wCarry[c] = 0;
    this.initParticle(i, c, x, y, zg + hl, zg, d.vt0, d.tauF, d.tauB, wNew, tBirth, k, this.ncField ? this.ncField[k]! : 0,
      this.aFL13[a]!);
    this.srcClass[i] = this.sourceClassCode(k);
    if (this.loftMode === 'briggs') this.state[i] = ST_NEEDLOFT;
  }

  private initParticle(i: number, c: number, x: number, y: number, z: number, zg: number, vt0: number, tauF: number, tauB: number, w: number, tBirth: number,
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
    this.maxH[i] = Math.max(0, z - zg);
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

  /**
   * A free slot, or −1. When the budget is full the oldest glowing E3/E4 is dropped first (§9.2). When none is left the
   * newborn is refused instead of dropping long-range brands in flight (which would bias the far tail); the caller
   * carries its weight to the next particle of the class (`wCarry`), so the emitted brand count stays unbiased.
   */
  private acquireSlot(): number {
    if (this.count < this.maxEmbers) return this.count++;
    if (!this.victims) this.victims = this.buildVictims();
    const v = this.victims.pop();
    this.dropped++;
    if (v === undefined) return -1;
    this.recordResidence(v, this.time);
    return v;
  }

  /** Glowing E3/E4 particles, youngest … oldest (pop() takes the oldest). */
  private buildVictims(): number[] {
    const pri: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.age[i]! < this.flameEnd[i]!) continue; // flaming: keep
      const c = this.cls[i]!;
      if (c === CLS_LEAF || c === CLS_TWIG) pri.push(i);
    }
    pri.sort((a, b) => this.age[a]! - this.age[b]! || b - a);
    return pri;
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
   * Fast-tier rise phase of particle i over [tc, tc + rem]: kinematic along the tilted plume axis until the release
   * age `riseT`. Returns the time consumed, or −1 when the particle is gone (burnt out / left the domain; `goneAt` set).
   * When the particle is still rising at the end of the window the whole `rem` is consumed.
   */
  private riseStep(i: number, rem: number, tc: number, wind: WindFn): number {
    const rt = this.riseT[i]!;
    const sx = this.srcX[i]!;
    const sy = this.srcY[i]!;
    const sz = this.zLaunch[i]!;
    const tauB = this.tauB[i]!;
    let age = this.age[i]!;
    const zgs = this.ground(sx, sy);
    if (age + rem < rt) {
      age += rem;
      const f = age / rt;
      this.px[i] = sx + (this.rx[i]! - sx) * f;
      this.py[i] = sy + (this.ry[i]! - sy) * f;
      this.pz[i] = sz + (this.rz[i]! - sz) * f;
      this.age[i] = age;
      const hh = this.pz[i]! - zgs;
      if (hh > this.maxH[i]!) this.maxH[i] = hh;
      if (age >= tauB) {
        this.burntOut++;
        this.goneAt = tc + rem;
        return -1;
      }
      return rem;
    }
    const dr = rt - age;
    age = rt;
    const x = this.rx[i]!;
    const y = this.ry[i]!;
    const z = this.rz[i]!;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.age[i] = age;
    this.state[i] = this.state[i]! & ~ST_RISING;
    const hh = z - zgs;
    if (hh > this.maxH[i]!) this.maxH[i] = hh;
    if (age >= tauB) {
      this.burntOut++;
      this.goneAt = tc + dr;
      return -1;
    }
    if (x < this.xMin || x > this.xMax || y < this.yMin || y > this.yMax) {
      this.exitDomain(i, x, y, hh, tc + dr, wind);
      this.goneAt = tc + dr;
      return -1;
    }
    return dr;
  }

  /**
   * Advance particle i from max(t0, birth) to t1. Returns true when the particle is gone (landed, burnt out, left).
   *
   * The hot loop (§9.7 budget ≤ 300 ns per particle-step on a phone): locals only, no allocation, no calls except the
   * wind callback and the plume lookup. Inlined here: the bilinear ground, the density LUT, the mulberry32 draws of the
   * OU noise (index = top 12 bits of the 32-bit output, identical to ⌊u·4096⌋), and the exact burning-fall integral
   * carried as r^{n+1} with r = 1 − age/τ_b (v_t/v_t0 = r^n = r^{n+1}/r above the floor), so each sub-step costs one
   * power (a square root for n = 1/2, two for 1/4, none for 1).
   */
  private advance(i: number, t0: number, t1: number, wind: WindFn, turb: TurbFn, landing: LandingFn): boolean {
    const tb = this.tBirth[i]!;
    let tc = tb > t0 ? tb : t0;
    let rem = t1 - tc;
    if (!(rem > 0)) return false;
    if (this.state[i]! & ST_NEEDLOFT) this.loft(i, wind);
    if (this.state[i]! & ST_RISING) {
      const used = this.riseStep(i, rem, tc, wind);
      if (used < 0) return true;
      rem -= used;
      tc += used;
      if (!(rem > 1e-9)) return false;
    }
    const P = this.params;
    const T = P.transport;
    const TB = P.turbulence;
    const c = this.cls[i]!;
    const tauB = this.tauB[i]!;
    const invTau = 1 / tauB;
    const vt0 = this.vt0[i]!;
    const nCode = this.clsNCode[c]!;
    const n = this.clsN[c]!;
    const fl = this.clsFloor[c]!;
    const tauN1 = tauB / (n + 1);
    const ac = tauB * (1 - this.clsRc[c]!); // age where the v_t floor starts
    const rpc = fl * this.clsRc[c]!; // r^{n+1} at the floor age
    let age = this.age[i]!;
    let x = this.px[i]!;
    let y = this.py[i]!;
    let z = this.pz[i]!;
    let st = this.state[i]!;
    let up = this.up[i]!;
    let vp = this.vp[i]!;
    let wp = this.wp[i]!;
    let flameEnd = this.flameEnd[i]!;
    let maxH = this.maxH[i]!;
    let sumU = this.sumU[i]!;
    let sumV = this.sumV[i]!;
    const reflame = this.clsReflame[c]!;
    const reflameDur = P.ignition.reflameDuration;
    // r^{n+1} at the current age (carried between sub-steps).
    let r = 1 - age * invTau;
    if (r < 0) r = 0;
    let rp = nCode === 0 ? r * r : nCode === 1 ? r * Math.sqrt(r) : nCode === 2 ? r * Math.sqrt(Math.sqrt(r)) : Math.pow(r, n + 1);
    // Grid, bounds, density LUT.
    const elev = this.terrain.elevation;
    const gnx = this.nx;
    const gny = this.ny;
    const gx0 = this.gx0;
    const gy0 = this.gy0;
    const h = this.h;
    const invH = 1 / h;
    const fxMax = gnx - 1;
    const fyMax = gny - 1;
    const xMin = this.xMin;
    const xMax = this.xMax;
    const yMin = this.yMin;
    const yMax = this.yMax;
    const densLut = this.densLut;
    const densLo = this.densLo;
    const invDensDz = 1 / this.densDz;
    const densTop = densLut.length - 1;
    let zg = this.ground(x, y);
    // Turbulence scales (z_i, w*, u*): column quantities, sampled once per atmosphere column and step at the column
    // centre (the atmosphere's sampleTurb is itself a nearest-column lookup) and shared by all particles in it.
    const out = this.wOut;
    const tc3 = this.turbColumn(x, y, turb);
    const tcache = this.turbCache;
    const zi = tcache[tc3]!;
    const ws = tcache[tc3 + 1]!;
    const us = tcache[tc3 + 2]!;
    const sqrtCblA = Math.sqrt(TB.cblA);
    const sigFree = TB.sigmaFree;
    const tMin = TB.tMin;
    const tMax = TB.tMax;
    const beta = TB.beta;
    const sep = this.mountainOn ? this.sepField : null;
    const plume = this.plume;
    const plumeOn = plume.active;
    const dxa = this.dxa;
    const dz1 = this.dz1;
    // Above the model top the ambient profile replaces the callback (only when a profile has been set).
    const modelTop = this.profH.length > 0 ? this.modelTop : Infinity;
    const cfl = T.cfl;
    const dtMin = T.dtMin;
    const dtMax = T.dtMax;
    const dzGrowth = T.dzGrowth;
    const landEps = T.landEps;
    const zd = T.zd;
    const nt = NORMAL_TABLE;
    const rr = this.r;
    let rs = rr.s; // mulberry32 state (written back before every exit)
    let u = 0;
    let v = 0;
    while (rem > 1e-9) {
      this.subSteps++;
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
      if (sep !== null) {
        const ci = ((x - gx0) * invH + 0.5) | 0;
        const cj = ((y - gy0) * invH + 0.5) | 0;
        if (ci >= 0 && cj >= 0 && ci < gnx && cj < gny) {
          const s = sep[cj * gnx + ci]!;
          if (s >= P.mountain.sepMin) {
            const eddy = this.leeEddy(cj * gnx + ci, s, x, y, zagl, u, v, wind);
            if (eddy) {
              u = out[0]!;
              v = out[1]!;
              st |= ST_EDDY;
            }
          }
        }
      }
      // Sub-grid plume (3-D tiers): w_sg ← max(0, w_sg − w_resolved), w += w_sg, i.e. w = max(w_resolved, w_sg).
      let wsg = 0;
      let alpha = 0;
      if (plumeOn) {
        wsg = plume.sample(x, y, z);
        if (wsg > 0) {
          alpha = plume.lastAlpha;
          if (wsg > w) w = wsg;
        }
      }
      // Terminal velocity now (Δt_e bound, crossing trajectories): v_t0·max(floor, r^n)·√(ρ_ref/ρ).
      let q = ((z - densLo) * invDensDz + 0.5) | 0;
      if (q < 0) q = 0;
      else if (q > densTop) q = densTop;
      const dens = densLut[q]!;
      let vf = r > 0 ? rp / r : 0;
      if (vf < fl) vf = fl;
      const vtNow = vt0 * dens * vf;
      // Sub-step Δt_e = clamp(0.4·min(Δz_local/|w_rel|, Δx_a/|u_h|), 0.5, 5) s.
      let wrel = w + wp - vtNow;
      if (wrel < 0) wrel = -wrel;
      const uh = Math.sqrt(u * u + v * v);
      const dzl = zagl * dzGrowth > dz1 ? zagl * dzGrowth : dz1;
      const b1 = wrel > 1e-6 ? dzl / wrel : 1e9;
      const b2 = uh > 1e-6 ? dxa / uh : 1e9;
      let dte = cfl * (b1 < b2 ? b1 : b2);
      if (dte < dtMin) dte = dtMin;
      if (dte > dtMax) dte = dtMax;
      if (dte > rem) dte = rem;
      const left = tauB - age;
      if (dte > left) dte = left;
      if (!(dte > 0)) {
        rr.s = rs;
        this.burntOut++;
        this.goneAt = tc;
        return true;
      }
      // Turbulence σ and Lagrangian time scales (§9.3).
      let su = 0;
      let sv = 0;
      let sw = 0;
      let th = tMax;
      let tw = tMax;
      let dsw2 = 0;
      const zz = zagl > 1 ? zagl : 1;
      if (zi > 0) {
        if (zz < TB.slFrac * zi) {
          su = TB.slSigmaU * us;
          sv = TB.slSigmaV * us;
          sw = TB.slSigmaW * us;
          if (sw > 0) {
            tw = (0.5 * zz) / sw;
            tw = tw < tMin ? tMin : tw > tMax ? tMax : tw;
          }
          th = tw;
        } else if (zz < zi) {
          if (ws > 0) {
            const zr = zz / zi;
            const qq = 1 - 0.8 * zr;
            const cb = Math.cbrt(zr);
            sw = ws * sqrtCblA * cb * qq;
            su = TB.cblH * ws;
            sv = su;
            th = (TB.cblT * zi) / su;
            th = th < tMin ? tMin : th > 10 * tMax ? 10 * tMax : th;
            if (sw > 0) {
              tw = (TB.cblT * zi) / sw;
              tw = tw < tMin ? tMin : tw > 10 * tMax ? 10 * tMax : tw;
            }
            dsw2 = ((TB.cblA * ws * ws) / zi) * (((2 / 3) * (qq * qq)) / cb - 1.6 * cb * cb * qq);
          } else {
            const f = Math.pow(1 - zz / zi, TB.stableExp);
            su = TB.slSigmaU * us * f;
            sv = TB.slSigmaV * us * f;
            sw = TB.slSigmaW * us * f;
            if (sw > 0) {
              tw = (0.5 * TB.slFrac * zi) / sw;
              tw = tw < tMin ? tMin : tw > tMax ? tMax : tw;
            }
            th = tw;
            const s0 = TB.slSigmaW * us;
            dsw2 = -((2 * TB.stableExp * s0 * s0) / zi) * Math.pow(1 - zz / zi, 2 * TB.stableExp - 1);
          }
          if (su < sigFree) su = sigFree;
          if (sv < sigFree) sv = sigFree;
          if (sw < sigFree) sw = sigFree;
        } else {
          su = sigFree;
          sv = sigFree;
          sw = sigFree;
          th = TB.tFree;
          tw = TB.tFree;
        }
      }
      if (wsg > 0) {
        // In plume: σ_w = α_p·w_plume with w_plume the plume updraft at the particle (sub-grid or resolved).
        const spw = alpha * w;
        if (spw > sw) {
          sw = spw;
          tw = (0.5 * zz) / sw;
          tw = tw < tMin ? tMin : tw > tMax ? tMax : tw;
          dsw2 = (-2 * spw * spw) / zd;
        }
      }
      // OU update (exact), crossing trajectories T_eff = T/√(1 + (β·v_t/σ)²), well-mixed drift ½∂σ_w²/∂z.
      if (su > 0) {
        const rv = (beta * vtNow) / su;
        const e = Math.exp((-dte * Math.sqrt(1 + rv * rv)) / th);
        const sq = Math.sqrt(1 - e * e);
        rs = (rs + 0x6d2b79f5) >>> 0;
        let t = Math.imul(rs ^ (rs >>> 15), rs | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        up = up * e + su * sq * nt[((t ^ (t >>> 14)) >>> 0) >>> 20]!;
        rs = (rs + 0x6d2b79f5) >>> 0;
        t = Math.imul(rs ^ (rs >>> 15), rs | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        vp = vp * e + sv * sq * nt[((t ^ (t >>> 14)) >>> 0) >>> 20]!;
      } else if (up !== 0 || vp !== 0) {
        const e = Math.exp(-dte / th);
        up *= e;
        vp *= e;
      }
      if (sw > 0) {
        const rv = (beta * vtNow) / sw;
        const e = Math.exp((-dte * Math.sqrt(1 + rv * rv)) / tw);
        rs = (rs + 0x6d2b79f5) >>> 0;
        let t = Math.imul(rs ^ (rs >>> 15), rs | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        wp = wp * e + sw * Math.sqrt(1 - e * e) * nt[((t ^ (t >>> 14)) >>> 0) >>> 20]! + 0.5 * dsw2 * dte;
      } else if (wp !== 0) wp *= Math.exp(-dte / tw);
      // Exact burning fall over [age, age + dte]: ∫ v_t0·max(floor, (1 − a/τ)^n)·dens da.
      const a1 = age + dte;
      let r1 = 1 - a1 * invTau;
      if (r1 < 0) r1 = 0;
      const rp1 = nCode === 0 ? r1 * r1 : nCode === 1 ? r1 * Math.sqrt(r1) : nCode === 2 ? r1 * Math.sqrt(Math.sqrt(r1)) : Math.pow(r1, n + 1);
      let fi: number;
      if (a1 <= ac) fi = tauN1 * (rp - rp1);
      else if (age >= ac) fi = fl * dte;
      else fi = tauN1 * (rp - rpc) + fl * (a1 - ac);
      const fall = vt0 * dens * fi;
      r = r1;
      rp = rp1;
      // Move: horizontal with the frozen wind + fluctuation, vertical with the burning fall.
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
      age = a1;
      rem -= dte;
      const tPrev = tc;
      tc += dte;
      // Glowing E1 re-flames with hazard λ (1 − e^{−λΔt} ≈ λΔt(1 − λΔt/2), relative error < (λΔt)²/6 ≤ 1e-4).
      if (reflame > 0 && age >= flameEnd) {
        const lt = reflame * dte;
        rs = (rs + 0x6d2b79f5) >>> 0;
        let t = Math.imul(rs ^ (rs >>> 15), rs | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        if (((t ^ (t >>> 14)) >>> 0) / 4294967296 < lt * (1 - 0.5 * lt)) {
          flameEnd = age + reflameDur;
          st |= ST_REFLAMED;
        }
      }
      // Non-finite state (a NaN wind sample): the particle is lost, never rendered or landed.
      if (!(x === x && y === y && z === z)) {
        rr.s = rs;
        this.burntOut++;
        this.goneAt = tc;
        return true;
      }
      // Left the domain → analytic continuation.
      if (x < xMin || x > xMax || y < yMin || y > yMax) {
        rr.s = rs;
        this.storeState(i, x, y, z, up, vp, wp, age, flameEnd, maxH, sumU, sumV, st);
        this.exitDomain(i, x, y, zPrev - zgPrev, tc, wind);
        this.goneAt = tc;
        return true;
      }
      // Ground under the new position (bilinear on the fire grid, clamped at the edges).
      {
        let fx = (x - gx0) * invH;
        let fy = (y - gy0) * invH;
        if (fx < 0) fx = 0;
        else if (fx > fxMax) fx = fxMax;
        if (fy < 0) fy = 0;
        else if (fy > fyMax) fy = fyMax;
        let gi = fx | 0;
        let gj = fy | 0;
        if (gi > gnx - 2) gi = gnx - 2;
        if (gj > gny - 2) gj = gny - 2;
        const tx = fx - gi;
        const ty = fy - gj;
        const gk = gj * gnx + gi;
        const e00 = elev[gk]!;
        const e10 = elev[gk + 1]!;
        const e01 = elev[gk + gnx]!;
        const e11 = elev[gk + gnx + 1]!;
        zg = (e00 + (e10 - e00) * tx) * (1 - ty) + (e01 + (e11 - e01) * tx) * ty;
      }
      if (z <= zg + landEps) {
        rr.s = rs;
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
        rr.s = rs;
        this.burntOut++;
        this.goneAt = tc;
        return true;
      }
    }
    rr.s = rs;
    this.storeState(i, x, y, z, up, vp, wp, age, flameEnd, maxH, sumU, sumV, st);
    return false;
  }

  /** Offset into `turbCache` of the column holding (x, y), sampling `turb` there once per step. */
  private turbColumn(x: number, y: number, turb: TurbFn): number {
    let ci = ((x - this.xMin) / this.dxa) | 0;
    let cj = ((y - this.yMin) / this.dxa) | 0;
    if (ci < 0) ci = 0;
    else if (ci >= this.nxa) ci = this.nxa - 1;
    if (cj < 0) cj = 0;
    else if (cj >= this.nya) cj = this.nya - 1;
    const col = cj * this.nxa + ci;
    if (this.turbStamp[col] !== this.stepId) {
      this.turbStamp[col] = this.stepId;
      const t = this.tOut;
      turb(this.xMin + (ci + 0.5) * this.dxa, this.yMin + (cj + 0.5) * this.dxa, 10, t);
      this.turbCache[3 * col] = t[0]!;
      this.turbCache[3 * col + 1] = t[1]!;
      this.turbCache[3 * col + 2] = t[2]!;
    }
    return 3 * col;
  }

  /**
   * Lee eddy wind (§9.4) on separated cell k (s_sep = s ≥ 0.5): below eddyDepth·relief AGL, the horizontal wind is
   * blended toward eddyFraction·U_ridge along the upslope direction with weight s. Writes (u, v) to `wOut`; returns
   * false (and leaves `wOut` untouched) when the particle is above the eddy or the cell is flat.
   */
  private leeEddy(k: number, s: number, x: number, y: number, zagl: number, u: number, v: number, wind: WindFn): boolean {
    const M = this.params.mountain;
    const relief = this.reliefAt(k);
    const asp = this.terrain.aspectDeg[k]!;
    if (!(zagl < M.eddyDepth * relief) || asp !== asp) return false;
    const uRidge = this.env.uRidge;
    let ur = uRidge ? uRidge[k]! : NaN;
    const out = this.wOut;
    if (!(ur === ur)) {
      wind(x, y, relief, out);
      ur = Math.hypot(out[0]!, out[1]!);
    }
    const a = asp * DEG;
    out[0] = (1 - s) * u - s * M.eddyFraction * ur * Math.sin(a);
    out[1] = (1 - s) * v - s * M.eddyFraction * ur * Math.cos(a);
    return true;
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

  /**
   * Domain exit (§9.3 analytic continuation): the remaining burning fall from the exit height takes t (exact inverse of
   * the fall integral; brands that burn out first are not histogrammed, deviation 4); beyond-edge distance Ū·t with Ū
   * the mean ambient profile speed over the fall column (or the frozen wind at mid-column at the edge when no profile
   * is set); histogram weighted by W·P_ig(ambient M, T_f); `leftDomain += 1`.
   */
  private exitDomain(i: number, x: number, y: number, zagl: number, t: number, wind: WindFn): void {
    const P = this.params;
    this.leftDomain++;
    const W = this.W[i]!;
    this.win.add(t, WIN.exits, W);
    const c = this.cls[i]!;
    const age = this.age[i]!;
    const h = zagl > 0 ? zagl : 0;
    const dens = this.densAt(this.pz[i]!);
    const tFall = fallTime(this.tauB[i]!, this.clsN[c]!, this.clsFloor[c]!, age, h / (this.vt0[i]! * dens));
    if (!(tFall < Infinity)) return; // burns out before landing
    let ubar: number;
    if (this.profH.length > 0) ubar = this.profileMean(h);
    else {
      const xe = x < this.xMin ? this.xMin : x > this.xMax ? this.xMax : x;
      const ye = y < this.yMin ? this.yMin : y > this.yMax ? this.yMax : y;
      wind(xe, ye, 0.5 * h, this.tOut);
      ubar = Math.hypot(this.tOut[0]!, this.tOut[1]!);
    }
    const d = ubar * tFall;
    const flaming = age + tFall < this.flameEnd[i]!;
    const pig = ignitionProbability(this.env.ambientFuelTempC ?? P.ignition.ambientFuelTemp, this.env.ambientMoisture ?? P.ignition.ambientMoisture);
    // S_state: flaming 1; glowing 0.3·clamp(bedWind/2) with the assumed ambient bed wind beyond the edge [H].
    const s = flaming ? 1 : P.ignition.glowFactor * clamp01(P.ignition.ambientBedWind / P.ignition.bedWindRef);
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
        if (t - this.pileT0[k]! > IG.pileWindow) {
          this.pileT0[k] = t;
          this.pileN[k] = 0;
        }
        const pn = (this.pileN[k] = this.pileN[k]! + W);
        if (pn >= IG.pileMin) p *= 1 + IG.pileGain * Math.min(pn - 1, IG.pileMaxN);
        if (p > IG.pMax) p = IG.pMax;
        if (p >= IG.capableP) {
          this.win.add(t, WIN.capable, W);
          this.win.max(t, travel);
        }
        if (p > 0) this.ovIgnition.add(k, W * p, t);
        pSpot = 1 - Math.exp(-W * p);
        if (pSpot > 0 && this.r.next() < pSpot) {
          const dl = flaming ? IG.delayFlaming : IG.delayGlowing;
          const due = t + this.r.range(dl[0], dl[1]);
          const prov = this.provenance(i, zgl, k, stateName, info.moisture, p, travel);
          this.schedule({ due, x: xl, y: yl, travel, prov });
          scheduled = true;
        } else if (!flaming) {
          // Holdover (§9.5): 2 % of the glowing brands that did not start a fire now smoulder in heavy fuel (a brand
          // whose cell ignites now needs no holdover: the cell burns and a holdover there would be cancelled).
          const heavy = info.surfaceHazard >= IG.holdoverFhs || ((this.fuel.flags ? this.fuel.flags[k]! : 0) & FuelFlag.HeavyFuel) !== 0;
          const lam = IG.holdoverShare * W;
          const pHold = 1 - Math.exp(-lam);
          if (heavy && this.r.next() < pHold) {
            hold = true;
            const prov = this.provenance(i, zgl, k, 'holdover', info.moisture, p, travel);
            if (this.holdovers.length >= IG.maxHoldovers) this.holdovers.shift();
            this.holdovers.push({ x: xl, y: yl, tLand: t, tCheck: t, n: lam / pHold, prov });
          }
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
    // Holdovers: smoulder ≤ 24 h, convert with hazard (1/3600 s⁻¹)·clamp((10 − M)/5, 0, 1).
    const IG = this.params.ignition;
    if (this.holdovers.length === 0) {
      this.lastHoldoverCheck = t1;
      return;
    }
    if (t1 - this.lastHoldoverCheck < IG.holdoverCheck) return;
    this.lastHoldoverCheck = t1;
    const keep: Holdover[] = [];
    for (const hv of this.holdovers) {
      if (t1 - hv.tLand > IG.holdoverMaxAge) continue;
      const info = landing(hv.x, hv.y);
      if (!info.burnable || info.burnt) continue;
      // Hazard integrated since this holdover's last check (the moisture of the check holds over the interval).
      const dtc = t1 - hv.tCheck;
      hv.tCheck = t1;
      const hz = (1 / IG.holdoverTime) * clamp01((IG.holdoverM0 - info.moisture) / IG.holdoverDm);
      const pc = 1 - Math.exp(-hz * hv.n * dtc);
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
    this.r.spare = NaN; // the cached Box–Muller partner never outlives a public call (determinism across checkpoints)
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

/** The environment without per-cell rasters and functions (checkpoint content; structured-clone safe). */
function scalarEnv(e: EmberEnvironment): EmberEnvironment {
  const { uRidge: _u, relief: _r, sep: _s, crest: _c, ...rest } = e;
  return rest.weather ? { ...rest, weather: structuredClone(rest.weather) } : rest;
}

function cloneProv(p: SpotProvenance): SpotProvenance {
  return { ...p, meanWindAloft: [p.meanWindAloft[0], p.meanWindAloft[1]] };
}
