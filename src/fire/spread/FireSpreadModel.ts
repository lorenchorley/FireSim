/**
 * FireSpreadModel — level-set fire spread with mountain phenomena and spread-driver attribution
 * (spec docs/research/00-synthesis.md §7, signature §2.4; coupling order §12.2).
 *
 * Per atmosphere step the sim calls `prepare(env)` then `step(Δt_a, env)`:
 *  - **prepare** (§7.1, §7.3–§7.9): for the *prepared cells* (unburnt band cells with 0 < φ ≤ 4Δx) evaluate the flat
 *    head kernel (`headRosKernel`, reused while |ΔU10| ≤ 2 % and M/FA unchanged), the hybrid wind–slope head with the
 *    Kataburn bound (§7.3), gully steering (§7.7), the attachment amplifier A/E/G (§7.6), build-up (§7.8), the three
 *    ellipse speeds with the forest 15 km/h cap (§7.4), the VLS lateral rate in active zones (§7.9) and sub-cell break
 *    draws (§7.4), and hand the offset-ellipse coefficients to the level-set core.
 *  - **step** (§7.2): Heun sub-steps at the corrected CFL bound in {@link LevelSetCore}; each arrival records the
 *    arrival-normal ROS, intensity, flame height, spread direction, phase, the §6.12 factor decomposition and the
 *    §7.12 driver; then the heat release (§7.5), burn state, front, normals, head and N_c (§8.10) are updated.
 *  - **refreshMoistureCache** (every 600 s): copy M and FA (the kernel is re-evaluated only where they changed).
 *  - **refreshMasks** (every 60 s and on a 22.5° sector change): crest cache, lee separation `aux.sep`, VLS score
 *    and 4-connected zones (§7.9), frontDist.
 *  - **minuteTasks** (every 60 s): junction boosts (§7.10, pyrogenic off), rolling debris (§7.11), frontDist.
 *
 * Contract interpretations: `env.time` = seconds from the scenario start (as FireField.arrivalTime); when it is a
 * plausible value (finite, |t| < 1e11) it is adopted at the start of prepare/step/refreshMasks (minuteTasks: only a
 * later time, since §12.2 runs them before t += Δt_a), otherwise the model's own Float64 clock (advanced by step) is
 * used. The domain wind direction for the crest sector and the lee alignment is `env.weather.windDir10` (the
 * grid-point wind, as atmosphere/ uses for U_ridge). `aux.front` lists the level-set front (arrived cells with a
 * burnable unburnt 4-neighbour) with per-cell outward normals `frontNormalX/Y`; `aux.headIndex` is a cell index;
 * `frontCells()` (ember emitters) are Burning cells with an Unburnt 4-neighbour (§7.5); rates in CellEvaluation are
 * m/s; with no fire lit yet, `evaluateCell` describes a developed fire (build 1).
 *
 * Deviations (all switchable in SPREAD_PARAMS; see the final report): the burnt-side extension of the level set
 * (levelSet.ts); VLS activation also counts upwind cells that burnt within 30 min and zone cells touching the burnt
 * area (`vls.recentS`, `vls.activateOnContact`); a cell entering the prepared set takes the maximum E of all its
 * 8-neighbours; `s_res` uses U_fireInd, which already carries c_f·m_f (m_f is not in SpreadEnvironment).
 *
 * Determinism: fixed iteration orders (sorted band, list order), all randomness from the fire RNG stream (VLS
 * periods, breach draws, debris), no wall clock. `checkpoint()`/`restore()` round-trip bitwise.
 */
import { cellAt, type GridSpec } from '../../core/grid';
import { HEAT_YIELD_KJ_PER_KG, RHO_REF } from '../../core/physics';
import type { Rng } from '../../core/rng';
import type { CellEvaluation, FireAux, SpreadEnvironment, TerrainFeatures } from '../../core/simTypes';
import {
  BurnState, FuelFlag, FuelType, SpreadDriver, type CellFuelParams, type FireField, type FuelMap, type Ignition, type SimOptions, type SpreadFactors, type Terrain,
} from '../../core/types';
import { ignitionProbability } from '../../fuel/moisture/fuelPhysics';
import { makeCellFuelParams } from '../../fuel/fuelMap';
import {
  createHeadKernelOut, createIntensityOut, createReferenceFactorsOut, headRosKernel, intensityKernel, lengthToBreadth, referenceFactors, type HeadKernelOut,
  type IntensityOut, type ReferenceFactorsOut,
} from '../models';
import { attributeDriver, createAttributionInput, type AttributionInput } from './attribution';
import { TERRAIN_FEATURE_PARAMS } from '../terrainFeatures';
import { FAM_NONE, FAM_PINE, FAM_VESTA2, FuelCache } from './fuelCache';
import { DistanceTransform, distToPolyline, labelComponents4, polylineLength, signedDistToPolygon } from './geometry';
import { LevelSetCore } from './levelSet';
import {
  alignmentWeight, amplifierGain, attachmentScore, azimuthOf, breachProbability, buildFraction, byramConvectiveNumber, createEllipseSpeedsOut,
  createHybridOut, ellipseSpeeds, finishHybrid, gullySteer, hybridHead, junctionBoost, leeAlignment, leeSeparation, lineIgnitionOrigin, logisticS, offsetEllipseSpeed,
  relaxEngagement, vlsLateralRate, vlsScore, type EllipseSpeedsOut, type HybridOut,
} from './math';
import { resolveSpreadParams, type SpreadParams, type SpreadParamsOverride } from './params';
import { StateRegistry, type PackedState } from './stateRegistry';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** pFlags bits. */
const FLAG_CAPPED = 1;
const FLAG_ERUPTIVE = 2;

/** Scratch of one cell preparation (see computeCell). */
interface Prep {
  zero: boolean;
  fresh: boolean;
  uKmh: number;
  m: number;
  fa: number;
  r0: number;
  rw: number;
  phase: number;
  valid: number;
  cfb: number;
  rs: number;
  hyb: HybridOut;
  ell: EllipseSpeedsOut;
  a: number;
  e: number;
  g: number;
  build: number;
  origin: number;
  eruptive: boolean;
  vlsR: number;
  fws: number;
}

/** Scratch of the §6.12 factor decomposition (base in m/s). */
interface FactorScratch {
  base: number;
  wind: number;
  fuel: number;
  moisture: number;
  slope: number;
  terrain: number;
}

/** A rolling-debris trajectory kept for render/explain (spec §7.11). */
export interface DebrisTrajectory {
  /** x, y pairs (local m) from the source cell to the stop cell. */
  path: Float32Array;
  /** Sim time (s) the item started rolling. */
  t: number;
}

/** A debris ignition applied by the model (the sim may add it to its spot-fire list, spec §7.11). */
export interface DebrisIgnition {
  x: number;
  y: number;
  time: number;
  sourceCell: number;
  /** Travel distance along the path (m). */
  travel: number;
  /** Provenance class of spot fires from rolling debris (spec §7.11). */
  emberClass: 'heavy';
}

/** A sub-cell fire-break draw (spec §7.4); `breached` raises the `fuel-break-breached` card. */
export interface BreachEvent {
  cell: number;
  time: number;
  probability: number;
  breached: boolean;
}

interface PendingDebris {
  time: number;
  x: number;
  y: number;
  source: number;
  travel: number;
}

/** Checkpoint payload (typed-array copies; structured-clone safe). */
export interface FireSpreadCheckpoint {
  version: 1;
  t: number;
  stamp: number;
  subCount: number;
  band: Int32Array;
  cells: PackedState;
  active: Int32Array;
  front: Int32Array;
  burnFront: Int32Array;
  junList: Int32Array;
  zones: { count: number; active: Uint8Array; tAct: Float64Array; tp: Float64Array; last: Float64Array };
  pendingIgn: Int32Array;
  pendingDrv: Int32Array;
  pendingDebris: PendingDebris[];
  debris: { path: Float32Array; t: number }[];
  rng: number;
  scalars: {
    firstOrigin: number; lastMinuteT: number; frontDistT: number; heatT0: number; heatT1: number; firePower: number; headIndex: number;
    leftDomain: boolean; mCacheSet: boolean; masksOn: boolean; prepared: boolean;
  };
}

export class FireSpreadModel {
  readonly field: FireField;
  private readonly P: SpreadParams;
  private readonly terrain: Terrain;
  private readonly fuel: FuelMap;
  private readonly features: TerrainFeatures;
  private readonly opts: SimOptions;
  private readonly rng: Rng;
  private readonly grid: GridSpec;
  private readonly nx: number;
  private readonly ny: number;
  private readonly n: number;
  private readonly h: number;
  private readonly ls: LevelSetCore;
  private readonly fc: FuelCache;
  private readonly reg = new StateRegistry();

  private t = 0;
  private env: SpreadEnvironment | null = null;
  private prepared = false;
  private subT = 0;
  private firstOrigin = Infinity;

  // ── static per cell ────────────────────────────────────────────────────────
  private readonly gX: Float32Array;
  private readonly gY: Float32Array;
  private readonly upX: Float32Array;
  private readonly upY: Float32Array;
  private readonly slope: Float32Array;
  /** Flammable (not NonFuel/Water/cliff); 0 → BurnState.NonFlammable. */
  private readonly flammable: Uint8Array;
  /** Flammable and enough fine fuel to spread. */
  private readonly canBurn: Uint8Array;
  private readonly treesNear: Uint8Array;
  private readonly breakW: Float32Array;
  private readonly descent: Int32Array;
  private readonly steep: Int32Array;
  private readonly steepCount: number;
  private readonly cD: Float32Array;
  private readonly cZ: Float32Array;
  private readonly cRel: Float32Array;
  private readonly cK: Int32Array;
  private crestSector = -1;

  // ── kernel cache (per prepared cell) ─────────────────────────────────────
  private readonly kU: Float32Array;
  private readonly kM: Float32Array;
  private readonly kFA: Float32Array;
  private readonly kR0: Float32Array;
  private readonly kRw: Float32Array;
  private readonly kCfb: Float32Array;
  private readonly kRs: Float32Array;
  private readonly kPhase: Uint8Array;
  private readonly kValid: Uint8Array;

  // ── prepared-cell state ─────────────────────────────────────────────────
  private readonly pThetaE: Float32Array;
  private readonly pRHyb: Float32Array;
  private readonly pA: Float32Array;
  private readonly pE: Float32Array;
  private readonly pG: Float32Array;
  private readonly pLb: Float32Array;
  private readonly pRH: Float32Array;
  private readonly pRB: Float32Array;
  private readonly pRF: Float32Array;
  private readonly pFws: Float32Array;
  private readonly pFlags: Uint8Array;
  private readonly tPrep: Float64Array;
  private readonly origin: Float64Array;
  private readonly originEst: Float64Array;

  // ── arrival records ─────────────────────────────────────────────────────
  private readonly fBase: Float32Array;
  private readonly fWind: Float32Array;
  private readonly fFuel: Float32Array;
  private readonly fMoist: Float32Array;
  private readonly fSlope: Float32Array;
  private readonly fTerrain: Float32Array;
  private readonly fShare: Float32Array;
  private readonly cValid: Uint8Array;
  private readonly wC: Float32Array;
  private readonly crownFrac: Float32Array;
  private readonly heat: Float32Array;
  private readonly crownOut: Float32Array;

  // ── masks / aux ─────────────────────────────────────────────────────────
  private readonly vls: Float32Array;
  private readonly vlsActive: Uint8Array;
  private readonly sep: Float32Array;
  private readonly vlsZone: Int32Array;
  private readonly attach: Float32Array;
  private readonly buildArr: Float32Array;
  private readonly frontDist: Float32Array;
  private readonly nc: Float32Array;
  private readonly cfb: Float32Array;
  private readonly direction: Float32Array;
  private readonly frontNX: Float32Array;
  private readonly frontNY: Float32Array;
  private readonly isFront: Uint8Array;
  private readonly breachState: Uint8Array;
  private readonly breachUntil: Float64Array;
  private readonly mCache: Float32Array;
  private readonly faCache: Float32Array;
  private mCacheSet = false;
  private masksOn = false;

  // ── lists ───────────────────────────────────────────────────────────────
  private readonly active: Int32Array;
  private activeCount = 0;
  private readonly frontBuf: Int32Array;
  private frontCount = 0;
  private readonly burnFrontBuf: Int32Array;
  private burnFrontCount = 0;
  private readonly junList: Int32Array;
  private junCount = 0;
  private readonly inJun: Uint8Array;
  private zoneCount = 0;
  private zActive = new Uint8Array(16);
  private zTAct = new Float64Array(16);
  private zTp = new Float64Array(16);
  private zLast = new Float64Array(16);
  private zSat = new Uint8Array(16);
  private readonly zoneOld: Int32Array;
  private readonly labelStack: Int32Array;
  private pendingIgn: number[] = [];
  private pendingDrv: number[] = [];
  private pendingDebris: PendingDebris[] = [];
  private debrisList: DebrisTrajectory[] = [];
  private debrisOut: DebrisIgnition[] = [];
  private breachOut: BreachEvent[] = [];
  private readonly dtf: DistanceTransform;

  // ── scalars ─────────────────────────────────────────────────────────────
  private lastMinuteT = NaN;
  private frontDistT = NaN;
  private heatT0 = 0;
  private heatT1 = 0;
  private firePower = 0;
  private headIndex = -1;
  private leftDomain = false;
  private readonly auxObj: FireAux;

  // ── scratch ─────────────────────────────────────────────────────────────
  private readonly pScratch: CellFuelParams = makeCellFuelParams();
  private readonly K: HeadKernelOut = createHeadKernelOut();
  private readonly IO: IntensityOut = createIntensityOut();
  private readonly RF: ReferenceFactorsOut = createReferenceFactorsOut();
  private readonly att: AttributionInput = createAttributionInput();
  private readonly FX: FactorScratch = { base: 0, wind: 1, fuel: 1, moisture: 1, slope: 1, terrain: 1 };
  private readonly prep: Prep = FireSpreadModel.makePrep();
  private readonly prepEval: Prep = FireSpreadModel.makePrep();

  private static makePrep(): Prep {
    return {
      zero: true, fresh: false, uKmh: 0, m: 0, fa: 0, r0: 0, rw: 0, phase: 0, valid: 1, cfb: 0, rs: 1, hyb: createHybridOut(), ell: createEllipseSpeedsOut(),
      a: 0, e: 0, g: 1, build: 0.1, origin: 0, eruptive: false, vlsR: 0, fws: 0,
    };
  }

  /**
   * @param terrain fire-grid terrain (grid === fuel.grid, spec §0.2)
   * @param features `computeTerrainFeatures(terrain, derived)` (crest search, trench, gully axis, slope30, ridge, cliff)
   * @param opts SimOptions (mountainPhenomena is the default when env does not say)
   * @param rng the fire RNG stream (seed + 1, spec §12.5)
   * @param params optional override of {@link SPREAD_PARAMS} (G_max user setting, tests)
   */
  constructor(terrain: Terrain, fuel: FuelMap, features: TerrainFeatures, opts: SimOptions, rng: Rng, params?: SpreadParamsOverride) {
    const g = terrain.grid;
    if (fuel.grid.nx !== g.nx || fuel.grid.ny !== g.ny || Math.abs(fuel.grid.cellSize - g.cellSize) > 1e-9) {
      throw new Error('FireSpreadModel: fuel.grid must equal terrain.grid (spec §0.2 grid identity)');
    }
    this.P = resolveSpreadParams(params);
    this.terrain = terrain;
    this.fuel = fuel;
    this.features = features;
    this.opts = opts;
    this.rng = rng;
    this.grid = g;
    this.nx = g.nx;
    this.ny = g.ny;
    const n = (this.n = g.nx * g.ny);
    const h = (this.h = g.cellSize);
    this.ls = new LevelSetCore(g, this.P.levelSet);
    this.fc = new FuelCache(fuel);
    const reg = this.reg;
    const f32 = (): Float32Array => new Float32Array(n);

    // Static.
    this.gX = f32();
    this.gY = f32();
    this.upX = f32();
    this.upY = f32();
    this.slope = f32();
    this.flammable = new Uint8Array(n);
    this.canBurn = new Uint8Array(n);
    this.treesNear = new Uint8Array(n);
    this.breakW = f32();
    this.descent = new Int32Array(n);
    this.initStatic();
    // Steep cells: the only candidates of VLS / lee separation (slope30 ≥ min edge).
    const minSteep = Math.min(this.P.vls.slopeLoDeg, this.P.sep.slopeLoDeg);
    let ns = 0;
    const s30 = features.slope30;
    for (let k = 0; k < n; k++) if (s30[k]! >= minSteep) ns++;
    this.steep = new Int32Array(ns);
    ns = 0;
    for (let k = 0; k < n; k++) if (s30[k]! >= minSteep) this.steep[ns++] = k;
    this.steepCount = ns;
    this.cD = new Float32Array(ns);
    this.cZ = new Float32Array(ns);
    this.cRel = new Float32Array(ns);
    this.cK = new Int32Array(ns).fill(-1);
    this.zoneOld = new Int32Array(ns);
    this.labelStack = new Int32Array(Math.max(1, ns));

    // Field.
    const burnState = new Uint8Array(n);
    for (let k = 0; k < n; k++) burnState[k] = this.flammable[k] ? BurnState.Unburnt : BurnState.NonFlammable;
    this.field = {
      grid: g,
      arrivalTime: reg.touched('tArr', new Float32Array(n).fill(Infinity), Infinity),
      burnState: reg.full('burnState', burnState),
      ros: reg.touched('ros', f32(), 0),
      intensity: reg.touched('intensity', f32(), 0),
      flameHeight: reg.touched('flameHeight', f32(), 0),
      spreadDir: reg.touched('spreadDir', new Float32Array(n).fill(NaN), NaN),
      driver: reg.touched('driver', new Uint8Array(n), 0),
      phase: reg.touched('phase', new Uint8Array(n), 0),
    };
    // Level-set arrays.
    const ls = this.ls;
    reg.touched('phi', ls.phi, ls.far);
    reg.touched('sA2', ls.sA2, 0);
    reg.touched('sB2', ls.sB2, 0);
    reg.touched('sC', ls.sC, 0);
    reg.touched('sEx', ls.sEx, 0);
    reg.touched('sEy', ls.sEy, 1);
    reg.touched('sVls', ls.sVls, 0);
    reg.touched('sJun', ls.sJun, 1);
    reg.touched('sBurnt', ls.sBurnt, 0);
    reg.touched('prepStamp', ls.prepStamp, 0);
    for (let k = 0; k < n; k++) {
      ls.sTx[k] = this.upY[k]!;
      ls.sTy[k] = -this.upX[k]!;
    }
    // Kernel cache.
    this.kU = reg.touched('kU', new Float32Array(n).fill(NaN), NaN);
    this.kM = reg.touched('kM', new Float32Array(n).fill(NaN), NaN);
    this.kFA = reg.touched('kFA', new Float32Array(n).fill(NaN), NaN);
    this.kR0 = reg.touched('kR0', f32(), 0);
    this.kRw = reg.touched('kRw', f32(), 0);
    this.kCfb = reg.touched('kCfb', f32(), 0);
    this.kRs = reg.touched('kRs', new Float32Array(n).fill(1), 1);
    this.kPhase = reg.touched('kPhase', new Uint8Array(n), 0);
    this.kValid = reg.touched('kValid', new Uint8Array(n).fill(1), 1);
    // Prepared state.
    this.pThetaE = reg.touched('pThetaE', f32(), 0);
    this.pRHyb = reg.touched('pRHyb', f32(), 0);
    this.pA = reg.touched('pA', f32(), 0);
    this.pE = reg.touched('pE', f32(), 0);
    this.pG = reg.touched('pG', new Float32Array(n).fill(1), 1);
    this.pLb = reg.touched('pLb', new Float32Array(n).fill(1), 1);
    this.pRH = reg.touched('pRH', f32(), 0);
    this.pRB = reg.touched('pRB', f32(), 0);
    this.pRF = reg.touched('pRF', f32(), 0);
    this.pFws = reg.touched('pFws', f32(), 0);
    this.pFlags = reg.touched('pFlags', new Uint8Array(n), 0);
    this.tPrep = reg.touched('tPrep', new Float64Array(n), 0);
    this.origin = reg.touched('origin', new Float64Array(n).fill(Infinity), Infinity);
    this.originEst = reg.touched('originEst', new Float64Array(n).fill(Infinity), Infinity);
    // Arrival records.
    this.fBase = reg.touched('fBase', f32(), 0);
    this.fWind = reg.touched('fWind', new Float32Array(n).fill(1), 1);
    this.fFuel = reg.touched('fFuel', new Float32Array(n).fill(1), 1);
    this.fMoist = reg.touched('fMoist', new Float32Array(n).fill(1), 1);
    this.fSlope = reg.touched('fSlope', new Float32Array(n).fill(1), 1);
    this.fTerrain = reg.touched('fTerrain', new Float32Array(n).fill(1), 1);
    this.fShare = reg.touched('fShare', f32(), 0);
    this.cValid = reg.touched('cValid', new Uint8Array(n).fill(1), 1);
    this.wC = reg.touched('wC', f32(), 0);
    this.crownFrac = reg.touched('crownFrac', f32(), 0);
    this.heat = reg.touched('heat', f32(), 0);
    this.crownOut = reg.touched('crownOut', f32(), 0);
    // Masks and aux rasters.
    this.vls = reg.full('vls', f32());
    this.vlsActive = reg.full('vlsActive', new Uint8Array(n));
    this.sep = reg.full('sep', f32());
    this.vlsZone = reg.full('vlsZone', new Int32Array(n));
    this.attach = reg.touched('attach', f32(), 0);
    this.buildArr = reg.touched('build', f32(), 0);
    this.frontDist = reg.full('frontDist', new Float32Array(n).fill(Infinity));
    this.nc = reg.touched('nc', f32(), 0);
    this.cfb = reg.touched('cfb', f32(), 0);
    this.direction = reg.touched('direction', f32(), 0);
    this.frontNX = reg.touched('frontNX', f32(), 0);
    this.frontNY = reg.touched('frontNY', f32(), 0);
    this.isFront = reg.touched('isFront', new Uint8Array(n), 0);
    this.breachState = reg.touched('breachState', new Uint8Array(n), 0);
    this.breachUntil = reg.touched('breachUntil', new Float64Array(n), 0);
    this.mCache = reg.full('mCache', f32());
    this.faCache = reg.full('faCache', f32());
    this.inJun = reg.touched('inJun', new Uint8Array(n), 0);
    // Lists.
    this.active = new Int32Array(n);
    this.frontBuf = new Int32Array(n);
    this.burnFrontBuf = new Int32Array(n);
    this.junList = new Int32Array(n);
    this.dtf = new DistanceTransform(this.nx, this.ny);

    this.auxObj = {
      vls: this.vls, vlsActive: this.vlsActive, sep: this.sep, attach: this.attach, junction: ls.sJun, build: this.buildArr, heatFlux: this.heat,
      frontDist: this.frontDist, nc: this.nc, cfb: this.cfb, direction: this.direction, debris: this.debrisList, front: this.frontBuf.subarray(0, 0),
      frontNormalX: this.frontNX, frontNormalY: this.frontNY, headIndex: -1, leftDomain: false,
    };
    ls.hooks = {
      ensureSpeed: (k: number) => this.prepareCell(k, this.env!, this.subT),
      onArrival: (k: number, tA: number, r: number, nx: number, ny: number) => this.recordArrival(k, tA, r, nx, ny, this.env!, false),
    };
    void h;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Static cache
  // ─────────────────────────────────────────────────────────────────────────

  private initStatic(): void {
    const { terrain, nx, ny, n, h } = this;
    for (let k = 0; k < n; k++) {
      const flat = Number.isNaN(terrain.aspectDeg[k]!);
      const gx = flat ? 0 : terrain.dzdx[k]!;
      const gy = flat ? 0 : terrain.dzdy[k]!;
      const tn = Math.sqrt(gx * gx + gy * gy);
      this.gX[k] = gx;
      this.gY[k] = gy;
      this.upX[k] = tn > 0 ? gx / tn : 0;
      this.upY[k] = tn > 0 ? gy / tn : 0;
      this.slope[k] = Math.atan(tn) * RAD;
    }
    this.refreshStaticFuel(null);
    // Steepest-descent neighbour for rolling debris: the filled-surface D8 receiver when available.
    const recv = (this.features as { receiver?: Int32Array }).receiver;
    if (recv && recv.length === n) this.descent.set(recv);
    else {
      const z = terrain.elevation;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          let best = -1;
          let bestS = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              if (!di && !dj) continue;
              const ii = i + di;
              const jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
              const m = jj * nx + ii;
              const s = (z[k]! - z[m]!) / (h * Math.hypot(di, dj));
              if (s > bestS) {
                bestS = s;
                best = m;
              }
            }
          }
          this.descent[k] = best;
        }
      }
    }
  }

  /** (Re)build the static fuel-dependent flags of the given cells (all when null). */
  private refreshStaticFuel(cells: ArrayLike<number> | null): void {
    const { nx, ny, h } = this;
    const cliff = this.features.cliff;
    const bw = this.fuel.breakWidth;
    const cov = this.fc.cover;
    const P = this.P.breach;
    const r = Math.max(1, Math.ceil(P.treeRadiusM / h));
    const count = cells ? cells.length : this.n;
    for (let a = 0; a < count; a++) {
      const k = cells ? cells[a]! : a;
      const type = this.fc.type[k]!;
      const isCliff = this.P.cliffNonFlammable && cliff[k] === 1;
      const flam = this.fc.family[k] !== FAM_NONE && type !== FuelType.NonFuel && type !== FuelType.Water && !isCliff;
      this.flammable[k] = flam ? 1 : 0;
      this.canBurn[k] = flam && this.fc.spreadable[k] === 1 ? 1 : 0;
      const w = bw ? bw[k]! : 0;
      this.breakW[k] = w > 0 ? w : 0;
      const i = k % nx;
      const j = (k - i) / nx;
      let trees = 0;
      for (let dj = -r; dj <= r && !trees; dj++) {
        for (let di = -r; di <= r; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          if (Math.hypot(di, dj) * h > P.treeRadiusM + 1e-6) continue;
          if (cov[jj * nx + ii]! >= P.treeCover) {
            trees = 1;
            break;
          }
        }
      }
      this.treesNear[k] = trees;
    }
  }

  /**
   * Re-resolve the fuel of edited cells (fuel/ applyFuelEdit changed the map): static cache, burnability and the
   * kernel cache. `cells = null` refreshes every cell.
   */
  refreshFuel(cells: ArrayLike<number> | null = null): void {
    const count = cells ? cells.length : this.n;
    for (let a = 0; a < count; a++) {
      const k = cells ? cells[a]! : a;
      this.fc.refresh(this.fuel, k);
      this.kU[k] = NaN;
      this.kM[k] = NaN;
    }
    this.refreshStaticFuel(cells);
    const bs = this.field.burnState;
    for (let a = 0; a < count; a++) {
      const k = cells ? cells[a]! : a;
      if (this.field.arrivalTime[k]! < Infinity) continue;
      bs[k] = this.flammable[k] ? BurnState.Unburnt : BurnState.NonFlammable;
      if (!this.canBurn[k]) this.zeroSpeed(k);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API (spec §2.4)
  // ─────────────────────────────────────────────────────────────────────────

  /** Current model time (s from scenario start). */
  get time(): number {
    return this.t;
  }

  /** Set the model clock (s from scenario start), e.g. before the first step of a scenario that starts at t ≠ 0. */
  setTime(t: number): void {
    this.t = t;
  }

  /**
   * Apply an ignition (spec §7.2, §7.8): point (radius), line (distance to the polyline) or area (signed distance to
   * the polygon), each lowered by r_ign = max(radius, 0.75Δx). Cells reaching φ ≤ 0 get tArr = origin = ign.time
   * (line/area: origin earlier by the §7.8 build head start); `origin: 'spot'` marks them seeded (driver Spotting).
   */
  ignite(ign: Ignition): void {
    const r = Math.max(ign.radius ?? 0, this.P.levelSet.ignitionRadiusCells * this.h);
    const pts = ign.points;
    if (!pts.length) return;
    let org = ign.time;
    let sd: (x: number, y: number) => number;
    if (ign.kind === 'point' || pts.length === 1) {
      const [px, py] = pts[0]!;
      sd = (x, y) => Math.hypot(x - px, y - py) - r;
    } else if (ign.kind === 'line') {
      sd = (x, y) => distToPolyline(x, y, pts) - r;
      org = lineIgnitionOrigin(ign.time, polylineLength(pts), this.P.build);
    } else {
      sd = (x, y) => signedDistToPolygon(x, y, pts) - r;
      org = lineIgnitionOrigin(ign.time, polylineLength(pts, true), this.P.build);
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    this.igniteGeometry(sd, x0 - r, x1 + r, y0 - r, y1 + r, ign.time, org, ign.origin === 'spot' ? SpreadDriver.Spotting : -1);
  }

  /**
   * Spot-fire ignition at a point (embers, debris; spec §7.13): radius 0.75Δx, driver default Spotting.
   * Returns false when the cell is outside the domain, not burnable or already burnt.
   */
  igniteAt(x: number, y: number, time: number, driver: SpreadDriver = SpreadDriver.Spotting): boolean {
    const k = cellAt(this.grid, x, y);
    if (k < 0 || !this.canBurn[k] || !(this.ls.phi[k]! > 0) || this.field.arrivalTime[k]! < Infinity) return false;
    const r = this.P.levelSet.ignitionRadiusCells * this.h;
    this.igniteGeometry((xx, yy) => Math.hypot(xx - x, yy - y) - r, x - r, x + r, y - r, y + r, time, time, driver);
    return true;
  }

  /**
   * Copy the moisture and availability fields the kernel uses (every 600 s; spec §3, §12.2 step 3). Between calls the
   * kernel keeps using the copied values (the first prepare copies them once if this was never called).
   */
  refreshMoistureCache(env: SpreadEnvironment): void {
    this.mCache.set(env.moisture);
    this.faCache.set(env.availability);
    this.mCacheSet = true;
  }

  /**
   * Masks (spec §7.9, §12.2 step 4): the crest cache of the current 22.5° sector, the lee-separation weight
   * `aux.sep`, the VLS score and its 4-connected zones (activation state carried across relabelling), frontDist.
   */
  refreshMasks(env: SpreadEnvironment): void {
    this.syncClock(env);
    const mountain = this.mountainOn(env);
    if (!mountain) {
      if (this.masksOn) {
        for (let a = 0; a < this.steepCount; a++) {
          const k = this.steep[a]!;
          this.vls[k] = 0;
          this.sep[k] = 0;
          this.vlsZone[k] = 0;
          this.vlsActive[k] = 0;
        }
        this.zoneCount = 0;
        this.masksOn = false;
      }
      this.refreshFrontDist();
      return;
    }
    const from = this.windFrom(env);
    const secW = TERRAIN_FEATURE_PARAMS.crest.sectorDeg;
    const sector = Math.round((((from % 360) + 360) % 360) / secW) % Math.round(360 / secW);
    if (sector !== this.crestSector) {
      this.computeCrests(from);
      this.crestSector = sector;
    }
    const windTo = from + 180;
    const aspect = this.terrain.aspectDeg;
    const z = this.terrain.elevation;
    const s30 = this.features.slope30;
    const M = this.mCacheSet ? this.mCache : env.moisture;
    const VP = this.P.vls;
    const SP = this.P.sep;
    for (let a = 0; a < this.steepCount; a++) {
      const k = this.steep[a]!;
      const has = this.cK[a]! >= 0;
      const lee = leeAlignment(aspect[k]!, windTo);
      const uR = env.uRidge[k]!;
      const d = this.cD[a]!;
      const rel = this.cRel[a]!;
      const sRidge = has && d <= VP.ridgeMaxDistM && this.cZ[a]! - z[k]! <= rel * VP.ridgeUpperFraction ? 1 : 0;
      this.vls[k] = vlsScore(s30[k]!, lee, uR, sRidge, M[k]!, VP);
      const sepOk = has && d <= Math.min(SP.reliefFactor * rel, SP.maxDistM);
      this.sep[k] = leeSeparation(s30[k]!, lee, uR, sepOk, SP);
    }
    this.relabelZones();
    this.masksOn = true;
    this.refreshFrontDist();
  }

  /**
   * Per atmosphere step (spec §12.2 step 5): apply due debris ignitions, record pending ignition cells, update VLS
   * zone activation, then prepare every unburnt band cell with 0 < φ ≤ 4Δx (and never-prepared burnt band cells).
   */
  prepare(env: SpreadEnvironment): void {
    this.syncClock(env);
    this.env = env;
    if (!this.mCacheSet) this.refreshMoistureCache(env);
    const t = this.t;
    this.applyDueDebris(t);
    const ls = this.ls;
    ls.stamp++;
    this.processPendingIgnitions(env, t);
    this.updateVlsActivation(env, t);
    const mountain = this.mountainOn(env);
    const prepH = this.P.levelSet.prepareCells * this.h;
    const band = ls.band;
    const phi = ls.phi;
    for (let a = 0; a < ls.bandCount; a++) {
      const k = band[a]!;
      const z = this.vlsZone[k]!;
      // VLS lateral rate of every band cell in an active zone that can spread now (non-zero ellipse speeds: a cell whose
      // fuel cannot carry fire, e.g. above the moisture of extinction, gets no lateral spread either).
      if (z > 0 && mountain && this.zActive[z] === 1 && this.canBurn[k] === 1 && !this.holding(k, t) && (ls.sA2[k] !== 0 || ls.sB2[k] !== 0)) {
        ls.sVls[k] = this.vlsRateAt(k, z, t);
      } else if (ls.sVls[k] !== 0) ls.sVls[k] = 0;
      const p = phi[k]!;
      // Unburnt cells near the front, and burnt cells the front never reached (ignition cells: their unit-slope
      // extension uses their own speed, which must follow build-up and the wind).
      if ((p > 0 && p <= prepH) || (!(p > 0) && ls.sBurnt[k] === 0 && ls.prepStamp[k] !== ls.stamp)) this.prepareCell(k, env, t);
    }
    this.prepared = true;
  }

  /** Advance the front by dt (s) in CFL-bounded Heun sub-steps (spec §7.2), then heat, burn state and the front. */
  step(dt: number, env: SpreadEnvironment): void {
    this.syncClock(env);
    if (!this.prepared || this.env !== env) this.prepare(env);
    const t0 = this.t;
    const tEnd = t0 + dt;
    const ls = this.ls;
    let t = t0;
    let guard = 0;
    while (tEnd - t > 1e-9 && ls.bandCount > 0) {
      this.subT = t;
      const used = ls.advance(t, tEnd - t);
      if (!(used > 0)) break;
      t += used;
      if (++guard > 1e6) throw new Error('FireSpreadModel.step: sub-step limit');
    }
    this.t = tEnd;
    this.updateHeat(t0, tEnd);
    this.updateFront(env);
    this.prepared = false;
  }

  /**
   * One level-set sub-step of exactly `dtSub` seconds (spec §7.2 guard; tests): throws RangeError when dtSub exceeds
   * 1.0001 × the CFL bound. Does not update heat or the front lists.
   */
  stepFixed(dtSub: number, env: SpreadEnvironment): void {
    this.syncClock(env);
    if (!this.prepared || this.env !== env) this.prepare(env);
    this.subT = this.t;
    this.ls.stepFixed(this.t, dtSub);
    this.t += dtSub;
  }

  /**
   * Every 60 s (spec §12.2 step 9): decay and detect junction boosts (§7.10; only with the pyrogenic potential off),
   * roll debris (§7.11, mountainPhenomena), prune trajectories and refresh frontDist.
   */
  minuteTasks(env: SpreadEnvironment): void {
    this.syncClock(env, true);
    const t = this.t;
    const dt = Number.isFinite(this.lastMinuteT) ? t - this.lastMinuteT : 60;
    this.lastMinuteT = t;
    this.decayJunctions(dt);
    if (env.pyrogenicOn === false) this.detectJunctions();
    if (this.mountainOn(env)) this.rollDebris(env, dt > 0 ? dt : 60, t);
    const keep = this.P.debris.keepS;
    if (this.debrisList.length && this.debrisList[0]!.t < t - keep) {
      const kept = this.debrisList.filter((d) => d.t >= t - keep);
      this.debrisList.length = 0;
      this.debrisList.push(...kept);
    }
    this.refreshFrontDist();
  }

  /** CFL bound (s) of the band at the current φ and speeds; ∞ with no moving cell (spec §7.2). */
  maxStableDt(): number {
    return this.ls.bound();
  }

  aux(): FireAux {
    const a = this.auxObj;
    a.front = this.frontBuf.subarray(0, this.frontCount);
    a.headIndex = this.headIndex;
    a.leftDomain = this.leftDomain;
    a.debris = this.debrisList;
    return a;
  }

  /** Fire age at cell k: t − origin (s), NaN where no fire has reached it. */
  ageAt(k: number): number {
    const o = this.origin[k]!;
    return o < Infinity ? this.t - o : NaN;
  }

  /** Mean heat release of the last step per cell (kW/m²), the exact integral of q over the step / Δt_a (§7.5). */
  heatRelease(): Float32Array {
    return this.heat;
  }

  /** Canopy share of the consumed fuel of heat-releasing cells (0 elsewhere) (§7.5). */
  crownShare(): Float32Array {
    return this.crownOut;
  }

  /** Burning cells with at least one unburnt 4-neighbour (spec §7.5) — the ember emitters. */
  frontCells(): Int32Array {
    return this.burnFrontBuf.subarray(0, this.burnFrontCount);
  }

  /** Fine fuel consumed in the flaming front at cell k (t/ha; the §6.9 intensity fuel at the arrival ROS), 0 if unburnt. */
  fuelConsumed(k: number): number {
    return this.wC[k]!;
  }

  /** Whether cell k's arrival record is inside every model's validated range (spec §6.12; unburnt cells: true). */
  validatedAt(k: number): boolean {
    return this.cValid[k] === 1;
  }

  /** Σ q·Δx²·1000 (W) over the last step. */
  firePowerW(): number {
    return this.firePower;
  }

  /** Debris ignitions applied since the last call (spec §7.11); the sim may list them as spot fires. */
  takeDebrisIgnitions(): DebrisIgnition[] {
    const out = this.debrisOut;
    this.debrisOut = [];
    return out;
  }

  /** Fire-break draws since the last call (spec §7.4; `breached` raises the fuel-break-breached card). */
  takeBreachEvents(): BreachEvent[] {
    const out = this.breachOut;
    this.breachOut = [];
    return out;
  }

  /** SpreadFactors recorded at arrival; for unburnt cells the §7.12 evaluation with the last environment. */
  factorsAt(k: number): SpreadFactors {
    if (this.field.arrivalTime[k]! < Infinity && this.fBase[k]! > 0) {
      return {
        base: this.fBase[k]!, wind: this.fWind[k]!, fuel: this.fFuel[k]!, moisture: this.fMoist[k]!, slope: this.fSlope[k]!,
        terrain: this.fTerrain[k]!, build: this.buildArr[k]!, fireWindShare: this.fShare[k]!, direction: this.direction[k]!,
      };
    }
    if (this.env) return this.evaluateCell(k, this.env).factors;
    return { base: 0, wind: 1, fuel: 1, moisture: 1, slope: 1, terrain: 1, build: 0, fireWindShare: 0, direction: 1 };
  }

  /**
   * The same prepare + normal speed + attribution code with n = ê for any cell (spec §7.12; explain `explainAt`).
   * Side-effect free (no E update, no breach draw, no cache write).
   */
  evaluateCell(k: number, env: SpreadEnvironment): CellEvaluation {
    const s = this.prepEval;
    const t = this.t;
    const zeroFactors: SpreadFactors = { base: 0, wind: 1, fuel: 1, moisture: 1, slope: 1, terrain: 1, build: 0, fireWindShare: 0, direction: 1 };
    if (k < 0 || k >= this.n || !this.computeCell(k, env, t, s)) {
      return { ros: 0, rH: 0, rB: 0, rF: 0, headDir: 0, lb: 1, intensity: 0, flameHeight: 0, phase: 0, factors: zeroFactors, driver: SpreadDriver.None, validated: true };
    }
    const ex = s.hyb.ex;
    const ey = s.hyb.ey;
    const tt = ex * this.ls.sTx[k]! + ey * this.ls.sTy[k]!;
    const vlsTerm = s.vlsR * Math.abs(tt);
    let ros = (s.ell.rH / 3600 + vlsTerm) * this.ls.sJun[k]!;
    if (ros > this.P.levelSet.rosMaxMs) ros = this.P.levelSet.rosMaxMs;
    const p = this.fc.load(k, this.pScratch);
    intensityKernel(p, ros * 3600, s.fa, this.IO, env.droughtFactor, s.rs);
    const f = this.factorsFor(k, ros, 1, s.uKmh, s.m, s.fa, s.rw, s.hyb.rHyb, env.droughtFactor);
    const factors: SpreadFactors = {
      base: f.base, wind: f.wind, fuel: f.fuel, moisture: f.moisture, slope: f.slope, terrain: f.terrain, build: s.build, fireWindShare: s.fws, direction: 1,
    };
    const att = this.att;
    att.seeded = false;
    att.vlsTerm = vlsTerm;
    att.ros = ros;
    att.junction = this.ls.sJun[k]!;
    att.gain = s.g;
    att.direction = 1;
    att.fireWindShare = s.fws;
    att.wind = factors.wind;
    att.slope = factors.slope;
    att.moisture = factors.moisture;
    att.fuel = factors.fuel;
    const rEll = s.ell.rH / 3600;
    return {
      ros, rH: s.ell.rH / 3600, rB: s.ell.rB / 3600, rF: s.ell.rF / 3600, headDir: s.hyb.e, lb: s.ell.lbB, intensity: this.IO.intensity,
      flameHeight: this.IO.flameHeight, phase: s.phase, factors, driver: attributeDriver(att, this.P.attribution),
      validated: this.isValidated(s.valid, s.hyb.thetaE, s.ell.capped, s.g, this.ls.sJun[k]!, rEll > 0 ? vlsTerm / rEll : 0, s.a * s.e),
    };
  }

  checkpoint(): FireSpreadCheckpoint {
    const ls = this.ls;
    const zc = this.zoneCount + 1;
    return {
      version: 1,
      t: this.t,
      stamp: ls.stamp,
      subCount: ls.subCount,
      band: ls.band.slice(0, ls.bandCount),
      cells: this.reg.pack(ls.touched),
      active: this.active.slice(0, this.activeCount),
      front: this.frontBuf.slice(0, this.frontCount),
      burnFront: this.burnFrontBuf.slice(0, this.burnFrontCount),
      junList: this.junList.slice(0, this.junCount),
      zones: { count: this.zoneCount, active: this.zActive.slice(0, zc), tAct: this.zTAct.slice(0, zc), tp: this.zTp.slice(0, zc), last: this.zLast.slice(0, zc) },
      pendingIgn: Int32Array.from(this.pendingIgn),
      pendingDrv: Int32Array.from(this.pendingDrv),
      pendingDebris: this.pendingDebris.map((d) => ({ ...d })),
      debris: this.debrisList.map((d) => ({ path: d.path.slice(), t: d.t })),
      rng: this.rng.state,
      scalars: {
        firstOrigin: this.firstOrigin, lastMinuteT: this.lastMinuteT, frontDistT: this.frontDistT, heatT0: this.heatT0, heatT1: this.heatT1,
        firePower: this.firePower, headIndex: this.headIndex, leftDomain: this.leftDomain, mCacheSet: this.mCacheSet, masksOn: this.masksOn,
        prepared: this.prepared,
      },
    };
  }

  restore(c: unknown): void {
    const s = c as FireSpreadCheckpoint;
    if (!s || s.version !== 1) throw new Error('FireSpreadModel.restore: unknown checkpoint');
    const ls = this.ls;
    this.reg.unpack(s.cells, ls.touched);
    ls.phiS.set(ls.phi);
    ls.inBand.fill(0);
    ls.bandCount = 0;
    ls.setBand(s.band, s.band.length);
    ls.stamp = s.stamp;
    ls.subCount = s.subCount;
    this.t = s.t;
    this.active.set(s.active);
    this.activeCount = s.active.length;
    this.frontBuf.set(s.front);
    this.frontCount = s.front.length;
    this.burnFrontBuf.set(s.burnFront);
    this.burnFrontCount = s.burnFront.length;
    this.junList.set(s.junList);
    this.junCount = s.junList.length;
    const zc = s.zones.count + 1;
    this.ensureZoneCapacity(zc);
    this.zoneCount = s.zones.count;
    this.zActive.set(s.zones.active);
    this.zTAct.set(s.zones.tAct);
    this.zTp.set(s.zones.tp);
    this.zLast.set(s.zones.last);
    this.pendingIgn = Array.from(s.pendingIgn);
    this.pendingDrv = Array.from(s.pendingDrv);
    this.pendingDebris = s.pendingDebris.map((d) => ({ ...d }));
    this.debrisList.length = 0;
    for (const d of s.debris) this.debrisList.push({ path: d.path.slice(), t: d.t });
    this.debrisOut = [];
    this.breachOut = [];
    this.rng.state = s.rng;
    const sc = s.scalars;
    this.firstOrigin = sc.firstOrigin;
    this.lastMinuteT = sc.lastMinuteT;
    this.frontDistT = sc.frontDistT;
    this.heatT0 = sc.heatT0;
    this.heatT1 = sc.heatT1;
    this.firePower = sc.firePower;
    this.headIndex = sc.headIndex;
    this.leftDomain = sc.leftDomain;
    this.mCacheSet = sc.mCacheSet;
    this.masksOn = sc.masksOn;
    this.prepared = sc.prepared;
    this.env = null;
    this.crestSector = -1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals: environment helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Adopt a plausible `env.time` (s from the scenario start) as the model clock. `forwardOnly` (minuteTasks): in the
   * normative §12.2 order the minute tasks run after `step` but before the sim advances t (step 10), so their env still
   * carries the step's start time; the clock must not jump back by Δt_a there.
   */
  private syncClock(env: SpreadEnvironment, forwardOnly = false): void {
    const et = env.time;
    if (typeof et === 'number' && Number.isFinite(et) && Math.abs(et) < 1e11 && et !== this.t && (!forwardOnly || et > this.t)) this.t = et;
  }

  private mountainOn(env: SpreadEnvironment): boolean {
    return env.mountainPhenomena ?? this.opts.mountainPhenomena;
  }

  /** Domain wind direction FROM (deg): the grid-point weather, else the mean background wind. */
  private windFrom(env: SpreadEnvironment): number {
    const w = env.weather?.windDir10;
    if (typeof w === 'number' && Number.isFinite(w)) return w;
    let su = 0;
    let sv = 0;
    for (let k = 0; k < this.n; k += 7) {
      su += env.windBgU[k]!;
      sv += env.windBgV[k]!;
    }
    return azimuthOf(-su, -sv);
  }

  private computeCrests(fromDeg: number): void {
    const f = this.features as TerrainFeatures & { crestInto?: (k: number, w: number, o: { d: number; zCrest: number; relief: number; kCrest: number }) => boolean };
    const tmp = { d: 0, zCrest: 0, relief: 0, kCrest: -1 };
    for (let a = 0; a < this.steepCount; a++) {
      const k = this.steep[a]!;
      let ok: boolean;
      if (f.crestInto) ok = f.crestInto(k, fromDeg, tmp);
      else {
        const c = f.crest(k, fromDeg);
        ok = c !== null;
        if (c) {
          tmp.d = c.d;
          tmp.zCrest = c.zCrest;
          tmp.relief = c.relief;
          tmp.kCrest = c.kCrest;
        }
      }
      this.cK[a] = ok ? tmp.kCrest : -1;
      this.cD[a] = ok ? tmp.d : Infinity;
      this.cZ[a] = ok ? tmp.zCrest : NaN;
      this.cRel[a] = ok ? tmp.relief : NaN;
    }
  }

  private ensureZoneCapacity(c: number): void {
    if (this.zActive.length >= c) return;
    let cap = this.zActive.length;
    while (cap < c) cap *= 2;
    const grow = <T extends Uint8Array | Float64Array>(a: T, Ctor: new (n: number) => T): T => {
      const g = new Ctor(cap);
      g.set(a as never);
      return g;
    };
    this.zActive = grow(this.zActive, Uint8Array);
    this.zTAct = grow(this.zTAct, Float64Array);
    this.zTp = grow(this.zTp, Float64Array);
    this.zLast = grow(this.zLast, Float64Array);
    this.zSat = grow(this.zSat, Uint8Array);
  }

  /** Relabel the VLS ≥ 0.5 zones and carry each old zone's activation to the new zone that contains its cells. */
  private relabelZones(): void {
    const { steep, steepCount, vlsZone, vls } = this;
    for (let a = 0; a < steepCount; a++) {
      const k = steep[a]!;
      this.zoneOld[a] = vlsZone[k]!;
      vlsZone[k] = 0;
    }
    const thr = this.P.vls.zoneMin;
    const count = labelComponents4(this.nx, this.ny, steep, steepCount, (k) => vls[k]! >= thr, vlsZone, this.labelStack);
    const oldA = this.zActive.slice(0, this.zoneCount + 1);
    const oldT = this.zTAct.slice(0, this.zoneCount + 1);
    const oldP = this.zTp.slice(0, this.zoneCount + 1);
    const oldL = this.zLast.slice(0, this.zoneCount + 1);
    this.ensureZoneCapacity(count + 1);
    this.zActive.fill(0, 0, count + 1);
    this.zTAct.fill(0, 0, count + 1);
    this.zTp.fill(0, 0, count + 1);
    this.zLast.fill(0, 0, count + 1);
    for (let a = 0; a < steepCount; a++) {
      const L = vlsZone[steep[a]!]!;
      const Lo = this.zoneOld[a]!;
      if (L === 0 || Lo === 0 || Lo >= oldA.length || oldA[Lo] !== 1) continue;
      if (this.zActive[L] !== 1 || oldT[Lo]! < this.zTAct[L]!) {
        this.zActive[L] = 1;
        this.zTAct[L] = oldT[Lo]!;
        this.zTp[L] = oldP[Lo]!;
        this.zLast[L] = oldL[Lo]!;
      }
    }
    this.zoneCount = count;
    for (let a = 0; a < steepCount; a++) {
      const k = steep[a]!;
      const z = vlsZone[k]!;
      this.vlsActive[k] = z > 0 && this.zActive[z] === 1 ? 1 : 0;
    }
  }

  /**
   * Zone activation (spec §7.9): the fire has reached the zone — a zone cell is burning, or (when
   * `vls.activateOnContact`) an unburnt zone cell touches the burnt area — and within 300 m upwind of that cell (±1 cell
   * laterally) a cell burns, or burnt within the last `vls.recentS`, with an arrival intensity ≥ 4000 kW/m. Active
   * while that holds, plus 10 min; each activation draws its pulse period T_p ~ U(10, 15) min from the fire RNG.
   */
  private updateVlsActivation(env: SpreadEnvironment, t: number): void {
    const count = this.zoneCount;
    if (count === 0) return;
    const mountain = this.mountainOn(env);
    const VP = this.P.vls;
    this.zSat.fill(0, 0, count + 1);
    if (mountain) {
      const from = this.windFrom(env);
      const bs = this.field.burnState;
      const zone = this.vlsZone;
      const check = (q: number): void => {
        const z = zone[q]!;
        if (z === 0 || this.zSat[z] === 1) return;
        if (this.upwindMaxIntensity(q, from, t) >= VP.activationKwm) this.zSat[z] = 1;
      };
      for (let a = 0; a < this.activeCount; a++) {
        const k = this.active[a]!;
        if (bs[k] === BurnState.Burning) check(k);
      }
      if (VP.activateOnContact) {
        const { nx, ny } = this;
        const tA = this.field.arrivalTime;
        for (let a = 0; a < this.frontCount; a++) {
          const k = this.frontBuf[a]!;
          check(k);
          const i = k % nx;
          const j = (k - i) / nx;
          if (i > 0 && tA[k - 1]! === Infinity) check(k - 1);
          if (i < nx - 1 && tA[k + 1]! === Infinity) check(k + 1);
          if (j > 0 && tA[k - nx]! === Infinity) check(k - nx);
          if (j < ny - 1 && tA[k + nx]! === Infinity) check(k + nx);
        }
      }
    }
    let changed = false;
    for (let z = 1; z <= count; z++) {
      if (this.zSat[z] === 1) {
        this.zLast[z] = t;
        if (this.zActive[z] !== 1) {
          this.zActive[z] = 1;
          this.zTAct[z] = t;
          this.zTp[z] = this.rng.range(VP.periodMinS, VP.periodMaxS);
          changed = true;
        }
      } else if (this.zActive[z] === 1 && (!mountain || t - this.zLast[z]! > VP.holdS)) {
        this.zActive[z] = 0;
        changed = true;
      }
    }
    if (changed) {
      for (let a = 0; a < this.steepCount; a++) {
        const k = this.steep[a]!;
        const z = this.vlsZone[k]!;
        this.vlsActive[k] = z > 0 && this.zActive[z] === 1 ? 1 : 0;
      }
    }
  }

  /**
   * Max arrival intensity (kW/m) of the cells within `upwindM` toward the wind from cell k (±1 cell laterally) that are
   * burning or burnt within the last `vls.recentS`.
   */
  private upwindMaxIntensity(k: number, fromDeg: number, t: number): number {
    const { nx, ny, h } = this;
    const i = k % nx;
    const j = (k - i) / nx;
    const ux = Math.sin(fromDeg * DEG);
    const uy = Math.cos(fromDeg * DEG);
    const px = uy;
    const py = -ux;
    const steps = Math.max(1, Math.round(this.P.vls.upwindM / h));
    const lat = this.P.vls.upwindLateralCells;
    const recent = t - this.P.vls.recentS;
    const bs = this.field.burnState;
    const tA = this.field.arrivalTime;
    const I = this.field.intensity;
    let max = 0;
    for (let s = 1; s <= steps; s++) {
      for (let l = -lat; l <= lat; l++) {
        const ii = Math.round(i + s * ux + l * px);
        const jj = Math.round(j + s * uy + l * py);
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const m = jj * nx + ii;
        if (!(tA[m]! <= t)) continue;
        if ((bs[m] === BurnState.Burning || tA[m]! >= recent) && I[m]! > max) max = I[m]!;
      }
    }
    return max;
  }

  private vlsRateAt(k: number, z: number, t: number): number {
    return vlsLateralRate(this.vls[k]!, t - this.zTAct[z]!, this.zTp[z]!, this.P.vls);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals: cell preparation (§7.3–§7.9)
  // ─────────────────────────────────────────────────────────────────────────

  private zeroSpeed(k: number): void {
    const ls = this.ls;
    ls.sA2[k] = 0;
    ls.sB2[k] = 0;
    ls.sC[k] = 0;
    ls.sVls[k] = 0;
    this.pRH[k] = 0;
    this.pRB[k] = 0;
    this.pRF[k] = 0;
    this.pRHyb[k] = 0;
  }

  private holding(k: number, t: number): boolean {
    return this.breachState[k] === 2 && t < this.breachUntil[k]!;
  }

  /**
   * Compute everything §7.3–§7.9 says about cell k at time t into `s` without touching the model state.
   * Returns false (s.zero) when the cell cannot spread now (not burnable, a holding break, or no fuel moisture room).
   */
  private computeCell(k: number, env: SpreadEnvironment, t: number, s: Prep): boolean {
    s.zero = true;
    s.fresh = false;
    if (this.canBurn[k] !== 1 || this.holding(k, t)) return false;
    const P = this.P;
    const u = env.windU[k]!;
    const v = env.windV[k]!;
    const U = Math.sqrt(u * u + v * v);
    const uKmh = 3.6 * U;
    const calm = !(U > P.hybrid.calmEps);
    const wx = calm ? 0 : u / U;
    const wy = calm ? 0 : v / U;
    const M = this.mCacheSet ? this.mCache[k]! : env.moisture[k]!;
    const FA = this.mCacheSet ? this.faCache[k]! : env.availability[k]!;
    // Kernel (reused while |ΔU10| ≤ 2 % and M, FA unchanged).
    const kU = this.kU[k]!;
    if (Math.abs(uKmh - kU) <= P.rwReuseRelTol * kU + 1e-9 && M === this.kM[k] && FA === this.kFA[k]) {
      s.uKmh = kU;
      s.m = M;
      s.fa = FA;
      s.r0 = this.kR0[k]!;
      s.rw = this.kRw[k]!;
      s.phase = this.kPhase[k]!;
      s.valid = this.kValid[k]!;
      s.cfb = this.kCfb[k]!;
      s.rs = this.kRs[k]!;
    } else {
      const p = this.fc.load(k, this.pScratch);
      const K = this.K;
      headRosKernel(p, uKmh, M, FA, K, env.droughtFactor);
      s.fresh = true;
      s.uKmh = uKmh;
      s.m = M;
      s.fa = FA;
      s.r0 = K.r0;
      s.rw = K.rw;
      s.phase = K.phase;
      s.valid = K.valid;
      s.cfb = K.cfb;
      s.rs = K.rw > 0 ? K.rSurf / K.rw : 1;
    }
    s.fws = Math.sqrt(env.fireIndU[k]! * env.fireIndU[k]! + env.fireIndV[k]! * env.fireIndV[k]!) / (U > 0.1 ? U : 0.1);
    if (!(s.rw > 0)) return false;
    const gx = this.gX[k]!;
    const gy = this.gY[k]!;
    // §7.3 hybrid head.
    const hyb = hybridHead(s.r0, s.rw, gx, gy, wx, wy, s.hyb, P.hybrid);
    const mountain = this.mountainOn(env);
    const T = this.features.trench[k]!;
    // §7.7 gully steering.
    if (mountain && T >= P.gully.minTrench) {
      const ax = this.features.gullyAxis[k]!;
      if (ax === ax) {
        const alpha = Math.atan(gx * Math.sin(ax * DEG) + gy * Math.cos(ax * DEG)) * RAD;
        if (gullySteer(hyb, T, ax, alpha, P.gully) > 0) finishHybrid(s.rw, gx, gy, hyb);
      }
    }
    // §7.6 attachment.
    let A = 0;
    let sRes = 0;
    if (mountain) {
      A = attachmentScore(hyb.thetaE, T === T ? T : 0, alignmentWeight(hyb.d, uKmh, P.attachment), P.attachment);
      const ind = (env.fireIndU[k]! * this.upX[k]! + env.fireIndV[k]! * this.upY[k]!) / P.attachment.sResWindMs;
      sRes = ind < 0 ? 0 : ind > 1 ? 1 : ind;
    }
    // A cell entering the prepared set takes the maximum E of its 8-neighbours (burnt or already prepared; §7.6 says
    // "burnt", which on fine grids restarts E from 0 four cells ahead of an attached run and caps it at 1 − e^(−lead/τ_e)).
    const first = this.ls.prepStamp[k] === 0;
    let e0 = this.pE[k]!;
    if (first) e0 = this.maxNbr(k, this.pE);
    const E = first ? relaxEngagement(e0, A, 0) : relaxEngagement(e0, A, t - this.tPrep[k]!, P.attachment.tauE);
    s.a = A;
    s.e = E;
    s.g = mountain ? amplifierGain(A, E, sRes, P.attachment.gMax) : 1;
    s.eruptive = A * E > P.attachment.eruptiveAE;
    // §7.8 build-up.
    const o = this.originEstimate(k, t);
    s.origin = o;
    s.build = buildFraction(t - o, s.eruptive, P.build);
    // §7.4 ellipse speeds.
    const cosW = calm ? 0 : wx * hyb.ex + wy * hyb.ey;
    const uAxis = uKmh * cosW > 0 ? uKmh * cosW : 0;
    const lb = lengthToBreadth(this.fc.familyOf(k), uAxis);
    const thetaSide = Math.atan(gx * hyb.ey - gy * hyb.ex) * RAD;
    const fam = this.fc.family[k]!;
    const cap = fam === FAM_VESTA2 || fam === FAM_PINE ? P.forestCapMh : Infinity;
    ellipseSpeeds(hyb.rHyb, s.g, s.build, s.rw, s.r0, hyb.thetaE, thetaSide, lb, cap, s.ell);
    // §7.9 VLS lateral rate.
    const z = this.vlsZone[k]!;
    s.vlsR = mountain && z > 0 && this.zActive[z] === 1 ? this.vlsRateAt(k, z, t) : 0;
    s.zero = false;
    return true;
  }

  /** Prepare cell k (compute + commit to the model and level-set arrays), including the §7.4 break draw. */
  private prepareCell(k: number, env: SpreadEnvironment, t: number): void {
    const ls = this.ls;
    if (this.breakW[k]! > 0 && this.canBurn[k] === 1) this.breachDraw(k, t);
    const s = this.prep;
    const ok = this.computeCell(k, env, t, s);
    if (s.fresh) {
      this.kU[k] = s.uKmh;
      this.kM[k] = s.m;
      this.kFA[k] = s.fa;
      this.kR0[k] = s.r0;
      this.kRw[k] = s.rw;
      this.kPhase[k] = s.phase;
      this.kValid[k] = s.valid;
      this.kCfb[k] = s.cfb;
      this.kRs[k] = s.rs;
    }
    ls.prepStamp[k] = ls.stamp;
    this.tPrep[k] = t;
    ls.touched[k] = 1;
    if (!ok) {
      this.zeroSpeed(k);
      this.pFws[k] = s.fws;
      return;
    }
    const ell = s.ell;
    const rH = ell.rH / 3600;
    const rB = ell.rB / 3600;
    const a = 0.5 * (rH + rB);
    const c = 0.5 * (rH - rB);
    const bF = ell.rF / 3600;
    ls.sA2[k] = a * a;
    ls.sB2[k] = bF * bF;
    ls.sC[k] = c;
    ls.sEx[k] = s.hyb.ex;
    ls.sEy[k] = s.hyb.ey;
    ls.sVls[k] = s.vlsR;
    this.pThetaE[k] = s.hyb.thetaE;
    this.pRHyb[k] = s.hyb.rHyb;
    this.pA[k] = s.a;
    this.pE[k] = s.e;
    this.pG[k] = s.g;
    this.pLb[k] = ell.lbB;
    this.pRH[k] = ell.rH;
    this.pRB[k] = ell.rB;
    this.pRF[k] = ell.rF;
    this.pFws[k] = s.fws;
    this.pFlags[k] = (ell.capped ? FLAG_CAPPED : 0) | (s.eruptive ? FLAG_ERUPTIVE : 0);
    this.originEst[k] = s.origin;
    this.attach[k] = s.a * s.e;
    this.buildArr[k] = s.build;
  }

  /** Max of `arr` over the 8-neighbours of k (0 when none). */
  private maxNbr(k: number, arr: Float32Array): number {
    const { nx, ny } = this;
    const i = k % nx;
    const j = (k - i) / nx;
    let m = 0;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= ny) continue;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if ((!di && !dj) || ii < 0 || ii >= nx) continue;
        const v = arr[jj * nx + ii]!;
        if (v > m) m = v;
      }
    }
    return m;
  }

  /** Max of `arr` over the burnt (arrived by t) 8-neighbours of k (0 when none). */
  private maxBurntNbr(k: number, arr: Float32Array, t: number): number {
    const { nx, ny } = this;
    const i = k % nx;
    const j = (k - i) / nx;
    const tA = this.field.arrivalTime;
    let m = 0;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= ny) continue;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if ((!di && !dj) || ii < 0 || ii >= nx) continue;
        const q = jj * nx + ii;
        if (tA[q]! <= t && arr[q]! > m) m = arr[q]!;
      }
    }
    return m;
  }

  /** Origin of the fire that will reach k (§7.8): min origin of burnt 8-neighbours, else the propagated estimate. */
  private originEstimate(k: number, t: number): number {
    const { nx, ny } = this;
    const tA = this.field.arrivalTime;
    if (tA[k]! <= t && this.origin[k]! < Infinity) return this.origin[k]!;
    const i = k % nx;
    const j = (k - i) / nx;
    let o = Infinity;
    let est = this.originEst[k]!;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= ny) continue;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if ((!di && !dj) || ii < 0 || ii >= nx) continue;
        const q = jj * nx + ii;
        if (tA[q]! <= t) {
          if (this.origin[q]! < o) o = this.origin[q]!;
        } else if (this.originEst[q]! < est) est = this.originEst[q]!;
      }
    }
    if (o < Infinity) return o;
    if (est < Infinity) return est;
    // No fire has been lit yet (only evaluateCell gets here): describe a developed fire (build 1), not a new ignition.
    return this.firstOrigin < Infinity ? this.firstOrigin : -Infinity;
  }

  /** Wilson breach draw the first time the front reaches a break cell, and again when a 30 min hold expires (§7.4). */
  private breachDraw(k: number, t: number): void {
    const st = this.breachState[k]!;
    if (st === 1 || (st === 2 && t < this.breachUntil[k]!)) return;
    const I = this.maxBurntNbr(k, this.field.intensity, t);
    if (!(I > 0) && !this.hasBurntNbr(k, t)) return;
    const p = breachProbability(I, this.breakW[k]!, this.treesNear[k] === 1, this.P.breach);
    const breached = this.rng.next() < p;
    this.breachState[k] = breached ? 1 : 2;
    if (!breached) this.breachUntil[k] = t + this.P.breach.holdS;
    this.ls.touched[k] = 1;
    this.breachOut.push({ cell: k, time: t, probability: p, breached });
  }

  private hasBurntNbr(k: number, t: number): boolean {
    const { nx, ny } = this;
    const i = k % nx;
    const j = (k - i) / nx;
    const tA = this.field.arrivalTime;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= ny) continue;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if ((!di && !dj) || ii < 0 || ii >= nx) continue;
        if (tA[jj * nx + ii]! <= t) return true;
      }
    }
    return false;
  }

  private isValidated(kernelValid: number, thetaE: number, capped: boolean, g: number, jun: number, vlsRel: number, ae: number): boolean {
    const V = this.P.validation;
    return (
      kernelValid === 1 && thetaE <= V.headSlopeMaxDeg && thetaE >= V.headSlopeMinDeg && !capped && g <= V.multiplierMax && jun <= V.multiplierMax &&
      1 + vlsRel <= V.multiplierMax && ae <= this.P.attachment.eruptiveAE
    );
  }

  /** §6.12 decomposition at a normal speed rMs (m/s) with the direction factor dir, into the reusable `this.FX`. */
  private factorsFor(k: number, rMs: number, dir: number, uKmh: number, m: number, fa: number, rw: number, rHyb: number, df: number): FactorScratch {
    const p = this.fc.load(k, this.pScratch);
    const RF = referenceFactors(p, uKmh, m, fa, this.RF, df);
    const fuel = Number.isFinite(RF.fuel) ? RF.fuel : 1;
    const slope = rw > 0 ? rHyb / rw : 1;
    const denom = RF.base * RF.wind * fuel * RF.moisture * slope * dir;
    const o = this.FX;
    o.base = RF.base;
    o.wind = RF.wind;
    o.fuel = fuel;
    o.moisture = RF.moisture;
    o.slope = slope;
    o.terrain = denom > 0 ? rMs / denom : 1;
    return o;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals: arrivals and ignitions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record the arrival of the front at cell k (spec §7.2 "record factors, driver, phase, ros, intensity, FH,
   * spreadDir"). `ignition` = the cell was set burning by an ignition (origin preset, normal = ê, ros = R_H).
   */
  private recordArrival(k: number, tA: number, r: number, nX: number, nY: number, env: SpreadEnvironment, ignition: boolean, driver = -1): void {
    const f = this.field;
    const ls = this.ls;
    f.arrivalTime[k] = tA;
    f.burnState[k] = BurnState.Burning;
    ls.touched[k] = 1;
    if (!ignition) this.origin[k] = this.originEstimateAtArrival(k, tA);
    f.ros[k] = r;
    f.spreadDir[k] = azimuthOf(nX, nY);
    const ex = ls.sEx[k]!;
    const ey = ls.sEy[k]!;
    const rH = this.pRH[k]!;
    const rEll = rH > 0 ? offsetEllipseSpeed(rH, this.pRB[k]!, this.pRF[k]!, nX * ex + nY * ey) : 0;
    const dir = ignition ? 1 : rH > 0 ? rEll / rH : 1;
    const tt = nX * ls.sTx[k]! + nY * ls.sTy[k]!;
    const vlsTerm = ls.sVls[k]! * (tt < 0 ? -tt : tt);
    const fa = this.kFA[k]!;
    const p = this.fc.load(k, this.pScratch);
    const IO = this.IO;
    intensityKernel(p, r * 3600, fa === fa ? fa : 0, IO, env.droughtFactor, this.kRs[k]!);
    f.intensity[k] = IO.intensity;
    f.flameHeight[k] = IO.flameHeight;
    f.phase[k] = this.kPhase[k]!;
    this.wC[k] = IO.w;
    this.crownFrac[k] = IO.crownShare;
    this.cfb[k] = IO.cfb;
    this.direction[k] = dir;
    // Factor decomposition (§6.12) with the kernel's own U10/M/FA.
    const fx = this.kU[k]! === this.kU[k]! ? this.factorsFor(k, r, dir, this.kU[k]!, this.kM[k]!, fa, this.kRw[k]!, this.pRHyb[k]!, env.droughtFactor) : null;
    if (fx) {
      this.fBase[k] = fx.base;
      this.fWind[k] = fx.wind;
      this.fFuel[k] = fx.fuel;
      this.fMoist[k] = fx.moisture;
      this.fSlope[k] = fx.slope;
      this.fTerrain[k] = fx.terrain;
    }
    const fws = this.pFws[k]!;
    this.fShare[k] = fws;
    // Driver (§7.12).
    if (driver >= 0) f.driver[k] = driver;
    else {
      const att = this.att;
      att.seeded = false;
      att.vlsTerm = vlsTerm;
      att.ros = r;
      att.junction = ls.sJun[k]!;
      att.gain = this.pG[k]!;
      att.direction = dir;
      att.fireWindShare = fws;
      att.wind = fx ? fx.wind : 1;
      att.slope = fx ? fx.slope : 1;
      att.moisture = fx ? fx.moisture : 1;
      att.fuel = fx ? fx.fuel : 1;
      f.driver[k] = attributeDriver(att, this.P.attribution);
    }
    const rEllMs = rEll / 3600;
    this.cValid[k] = this.isValidated(
      this.kValid[k]!, this.pThetaE[k]!, (this.pFlags[k]! & FLAG_CAPPED) !== 0, this.pG[k]!, ls.sJun[k]!, rEllMs > 0 ? vlsTerm / rEllMs : 0, this.attach[k]!,
    ) ? 1 : 0;
    // Bookkeeping: heat list, origin estimates ahead, domain edge.
    this.active[this.activeCount++] = k;
    this.crownOut[k] = IO.crownShare;
    this.propagateOrigin(k);
    const i = k % this.nx;
    const j = (k - i) / this.nx;
    if (i === 0 || j === 0 || i === this.nx - 1 || j === this.ny - 1) this.leftDomain = true;
  }

  private originEstimateAtArrival(k: number, tA: number): number {
    const { nx, ny } = this;
    const i = k % nx;
    const j = (k - i) / nx;
    const tArr = this.field.arrivalTime;
    let o = Infinity;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= ny) continue;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if ((!di && !dj) || ii < 0 || ii >= nx) continue;
        const q = jj * nx + ii;
        if (tArr[q]! <= tA && this.origin[q]! < o) o = this.origin[q]!;
      }
    }
    if (o < Infinity) return o;
    const e = this.originEst[k]!;
    return e < Infinity ? e : this.firstOrigin < Infinity ? this.firstOrigin : tA;
  }

  private propagateOrigin(k: number): void {
    const { nx, ny } = this;
    const i = k % nx;
    const j = (k - i) / nx;
    const o = this.origin[k]!;
    const tArr = this.field.arrivalTime;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= ny) continue;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if ((!di && !dj) || ii < 0 || ii >= nx) continue;
        const q = jj * nx + ii;
        if (tArr[q]! < Infinity) continue;
        if (o < this.originEst[q]!) {
          this.originEst[q] = o;
          this.ls.touched[q] = 1;
        }
      }
    }
  }

  /** Lower φ by a signed-distance function over a window and mark the newly burning cells (pending records). */
  private igniteGeometry(sd: (x: number, y: number) => number, x0: number, x1: number, y0: number, y1: number, time: number, org: number, driver: number): void {
    const { grid, nx, ny, h, ls } = this;
    const pad = this.P.levelSet.farCells * h;
    const i0 = Math.max(0, Math.floor((x0 - pad - grid.x0) / h));
    const i1 = Math.min(nx - 1, Math.ceil((x1 + pad - grid.x0) / h));
    const j0 = Math.max(0, Math.floor((y0 - pad - grid.y0) / h));
    const j1 = Math.min(ny - 1, Math.ceil((y1 + pad - grid.y0) / h));
    const bandMax = this.P.levelSet.bandCells * h;
    const f = this.field;
    for (let j = j0; j <= j1; j++) {
      const y = grid.y0 + j * h;
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        const d = sd(grid.x0 + i * h, y);
        const before = ls.phi[k]!;
        if (this.canBurn[k] === 1 && f.arrivalTime[k]! === Infinity) {
          const p = ls.lowerPhi(k, d);
          if (before > 0 && p <= 0) {
            f.arrivalTime[k] = time;
            f.burnState[k] = BurnState.Burning;
            this.origin[k] = org;
            this.pendingIgn.push(k);
            this.pendingDrv.push(driver);
          } else if (Math.abs(p) <= bandMax && org < this.originEst[k]!) this.originEst[k] = org;
        } else if (before > 0) ls.lowerPhi(k, d > 1e-3 * h ? d : 1e-3 * h);
      }
    }
    ls.commitInserts();
    for (let a = 0; a < this.pendingIgn.length; a++) ls.touched[this.pendingIgn[a]!] = 1;
    if (org < this.firstOrigin) this.firstOrigin = org;
    this.updateFront(this.env);
  }

  /** Record the ignition cells queued by ignite/igniteAt (needs the environment of the step). */
  private processPendingIgnitions(env: SpreadEnvironment, t: number): void {
    const cells = this.pendingIgn;
    if (!cells.length) return;
    const drv = this.pendingDrv;
    this.pendingIgn = [];
    this.pendingDrv = [];
    for (let a = 0; a < cells.length; a++) {
      const k = cells[a]!;
      this.prepareCell(k, env, t);
      const ls = this.ls;
      this.recordArrival(k, this.field.arrivalTime[k]!, this.pRH[k]! / 3600, ls.sEx[k]!, ls.sEy[k]!, env, true, drv[a]!);
    }
    this.updateFront(env);
  }

  private applyDueDebris(t: number): void {
    if (!this.pendingDebris.length) return;
    const keep: PendingDebris[] = [];
    for (const d of this.pendingDebris) {
      if (d.time <= t) {
        if (this.igniteAt(d.x, d.y, d.time, SpreadDriver.Spotting)) this.debrisOut.push({ x: d.x, y: d.y, time: d.time, sourceCell: d.source, travel: d.travel, emberClass: 'heavy' });
      } else keep.push(d);
    }
    this.pendingDebris = keep;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals: after-step bookkeeping (§7.5, §8.10)
  // ─────────────────────────────────────────────────────────────────────────

  /** Heat release over [t0, t1] (exact integral / Δt), burn state, heat list pruning, fire power (§7.5). */
  private updateHeat(t0: number, t1: number): void {
    const HP = this.P.heat;
    const f = this.field;
    const dt = t1 - t0;
    let w = 0;
    let power = 0;
    for (let a = 0; a < this.activeCount; a++) {
      const k = this.active[a]!;
      const tA = f.arrivalTime[k]!;
      const tauRaw = this.fc.tauF[k]!;
      const tau = tauRaw > HP.minTauS ? tauRaw : HP.minTauS;
      const end = tA + HP.cutoffTau * tau;
      const aa = t0 > tA ? t0 : tA;
      const bb = t1 < end ? t1 : end;
      let q = 0;
      if (bb > aa && dt > 0) q = (HEAT_YIELD_KJ_PER_KG * (this.wC[k]! / 10) * (Math.exp(-(aa - tA) / tau) - Math.exp(-(bb - tA) / tau))) / dt;
      this.heat[k] = q;
      power += q;
      f.burnState[k] = t1 - tA < HP.burningTau * tau ? BurnState.Burning : BurnState.BurntOut;
      if (t1 >= end) {
        if (q === 0) {
          this.crownOut[k] = 0;
          continue; // drop: no heat in this step or later
        }
      }
      this.active[w++] = k;
    }
    this.activeCount = w;
    this.heatT0 = t0;
    this.heatT1 = t1;
    this.firePower = power * this.h * this.h * 1000;
  }

  /** Level-set front (arrived cells with a burnable unburnt 4-neighbour), normals, head, N_c and the burning front. */
  private updateFront(env: SpreadEnvironment | null): void {
    const { nx, ny, h, ls } = this;
    const phi = ls.phi;
    const f = this.field;
    for (let a = 0; a < this.frontCount; a++) {
      const k = this.frontBuf[a]!;
      this.isFront[k] = 0;
      this.nc[k] = 0;
    }
    let nf = 0;
    let head = -1;
    let headR = -1;
    const band = ls.band;
    for (let a = 0; a < ls.bandCount; a++) {
      const k = band[a]!;
      const p = phi[k]!;
      if (p > 0 || !(f.arrivalTime[k]! < Infinity)) continue;
      const i = k % nx;
      const j = (k - i) / nx;
      const open =
        (i > 0 && phi[k - 1]! > 0 && this.canBurn[k - 1] === 1) ||
        (i < nx - 1 && phi[k + 1]! > 0 && this.canBurn[k + 1] === 1) ||
        (j > 0 && phi[k - nx]! > 0 && this.canBurn[k - nx] === 1) ||
        (j < ny - 1 && phi[k + nx]! > 0 && this.canBurn[k + nx] === 1);
      if (!open) continue;
      this.frontBuf[nf++] = k;
      this.isFront[k] = 1;
      const pl = i > 0 ? phi[k - 1]! : 2 * p - phi[k + 1]!;
      const pr = i < nx - 1 ? phi[k + 1]! : 2 * p - phi[k - 1]!;
      const pd = j > 0 ? phi[k - nx]! : 2 * p - phi[k + nx]!;
      const pu = j < ny - 1 ? phi[k + nx]! : 2 * p - phi[k - nx]!;
      const cx = pr - pl;
      const cy = pu - pd;
      const cn = Math.sqrt(cx * cx + cy * cy);
      this.frontNX[k] = cn > 0 ? cx / cn : ls.sEx[k]!;
      this.frontNY[k] = cn > 0 ? cy / cn : ls.sEy[k]!;
      if (f.ros[k]! > headR) {
        headR = f.ros[k]!;
        head = k;
      }
      if (env) {
        const sd = f.spreadDir[k]!;
        const ux = sd === sd ? Math.sin(sd * DEG) : this.frontNX[k]!;
        const uy = sd === sd ? Math.cos(sd * DEG) : this.frontNY[k]!;
        const along = env.windU[k]! * ux + env.windV[k]! * uy;
        const rho = env.airRho[k]! > 0 ? env.airRho[k]! : RHO_REF;
        const tc = env.airT[k]! === env.airT[k]! ? env.airT[k]! : 20;
        this.nc[k] = byramConvectiveNumber(f.intensity[k]!, along, f.ros[k]!, rho, tc, this.P.nc);
      }
    }
    this.frontCount = nf;
    this.headIndex = head;
    // Burning cells with an unburnt 4-neighbour (ember emitters, §7.5).
    const bs = f.burnState;
    let nb = 0;
    for (let a = 0; a < this.activeCount; a++) {
      const k = this.active[a]!;
      if (bs[k] !== BurnState.Burning) continue;
      const i = k % nx;
      const j = (k - i) / nx;
      if (
        (i > 0 && bs[k - 1] === BurnState.Unburnt) ||
        (i < nx - 1 && bs[k + 1] === BurnState.Unburnt) ||
        (j > 0 && bs[k - nx] === BurnState.Unburnt) ||
        (j < ny - 1 && bs[k + nx] === BurnState.Unburnt)
      )
        this.burnFrontBuf[nb++] = k;
    }
    this.burnFrontCount = nb;
    void h;
  }

  /** Distance (m) to the nearest burning or front cell (spec §7.13 frontDist; Infinity without fire). */
  private refreshFrontDist(): void {
    if (this.frontDistT === this.t) return;
    this.frontDistT = this.t;
    const bs = this.field.burnState;
    const isF = this.isFront;
    this.dtf.compute((k) => isF[k] === 1 || bs[k] === BurnState.Burning, this.h, this.frontDist);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals: minute tasks (§7.10, §7.11)
  // ─────────────────────────────────────────────────────────────────────────

  private decayJunctions(dt: number): void {
    if (this.junCount === 0) return;
    const jun = this.ls.sJun;
    const f = Math.exp(-dt / this.P.junction.tauS);
    let w = 0;
    for (let a = 0; a < this.junCount; a++) {
      const k = this.junList[a]!;
      const v = 1 + (jun[k]! - 1) * f;
      if (v < 1.0005) {
        jun[k] = 1;
        this.inJun[k] = 0;
      } else {
        jun[k] = v;
        this.junList[w++] = k;
      }
    }
    this.junCount = w;
  }

  /** §7.10: unburnt band cells within 2Δx of the front whose nearby front normals differ by ≥ 120°. */
  private detectJunctions(): void {
    const { nx, ny, h, ls } = this;
    const JP = this.P.junction;
    const phi = ls.phi;
    const band = ls.band;
    const cand = JP.candidateCells * h;
    const r = JP.searchCells;
    const cosMax = Math.cos(JP.minNormalDiffDeg * DEG);
    const bx = new Float32Array((2 * r + 1) * (2 * r + 1));
    const by = new Float32Array(bx.length);
    for (let a = 0; a < ls.bandCount; a++) {
      const k = band[a]!;
      const p = phi[k]!;
      if (!(p > 0) || p > cand || this.canBurn[k] !== 1) continue;
      const i = k % nx;
      const j = (k - i) / nx;
      let m = 0;
      for (let dj = -r; dj <= r; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -r; di <= r; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= nx) continue;
          const q = jj * nx + ii;
          if (this.isFront[q] !== 1) continue;
          const fx = this.frontNX[q]!;
          const fy = this.frontNY[q]!;
          // Only fronts advancing toward the candidate (it lies ahead of them): a convex front's far side does not count.
          if (fx * -di + fy * -dj <= 0) continue;
          bx[m] = fx;
          by[m] = fy;
          m++;
        }
      }
      if (m < 2) continue;
      let minDot = 1;
      for (let u = 0; u < m; u++) {
        for (let v = u + 1; v < m; v++) {
          const d = bx[u]! * bx[v]! + by[u]! * by[v]!;
          if (d < minDot) minDot = d;
        }
      }
      if (minDot > cosMax) continue;
      const dPsi = Math.acos(Math.max(-1, Math.min(1, minDot))) * RAD;
      const theta0 = 180 - dPsi;
      const boost = junctionBoost(theta0, JP);
      if (boost > ls.sJun[k]!) {
        ls.sJun[k] = boost;
        if (this.inJun[k] !== 1) {
          this.inJun[k] = 1;
          this.junList[this.junCount++] = k;
        }
      }
    }
  }

  /**
   * §7.11 rolling debris from burning steep cells with heavy fuel or high bark hazard. Items follow the D8 receivers of
   * the filled surface but stop where the next cell is not lower on the DEM (a pit: the filled surface would route
   * them over its spill point, i.e. uphill).
   */
  private rollDebris(env: SpreadEnvironment, dtS: number, t: number): void {
    const DP = this.P.debris;
    const { nx, h, grid } = this;
    const bs = this.field.burnState;
    const tA = this.field.arrivalTime;
    const M = this.mCacheSet ? this.mCache : env.moisture;
    const zr = this.terrain.elevation;
    for (let a = 0; a < this.activeCount; a++) {
      const k = this.active[a]!;
      if (bs[k] !== BurnState.Burning) continue;
      const th = this.slope[k]!;
      if (th < DP.minSlopeDeg) continue;
      const heavy = (this.fc.flags[k]! & FuelFlag.HeavyFuel) !== 0;
      if (!heavy && !(this.fc.barkHazard[k]! >= DP.minBarkHazard)) continue;
      const lambda = DP.lambdaPerMin * logisticS(th, DP.sCentreDeg, DP.sWidthDeg) * (heavy ? 1 : DP.nonHeavyFactor) * (dtS / 60);
      const nItems = this.rng.poisson(lambda);
      for (let it = 0; it < nItems; it++) {
        const path: number[] = [];
        let cur = k;
        let travel = 0;
        const push = (q: number): void => {
          const i = q % nx;
          path.push(grid.x0 + i * h, grid.y0 + ((q - i) / nx) * h);
        };
        push(cur);
        for (let s = 0; s < DP.maxPathCells; s++) {
          const nxt = this.descent[cur]!;
          // The filled-surface receiver routes pits over their spill point; debris cannot roll uphill (raw DEM).
          if (nxt < 0 || !(zr[nxt]! < zr[cur]!)) break;
          const di = (nxt % nx) - (cur % nx);
          const len = di !== 0 && Math.abs(nxt - cur) !== 1 ? Math.SQRT2 * h : h;
          cur = nxt;
          travel += len;
          push(cur);
          if (this.slope[cur]! < DP.stopSlopeDeg) break;
          const fh = this.fc.fhsEl[cur]! / 4;
          const p = DP.stopBase + DP.stopFhsGain * (fh < 0 ? 0 : fh > 1 ? 1 : fh);
          if (this.rng.next() < 1 - Math.pow(1 - p, len / DP.stepM)) break;
        }
        this.debrisList.push({ path: Float32Array.from(path), t });
        if (cur !== k && tA[cur]! === Infinity && this.canBurn[cur] === 1) {
          const pIg = ignitionProbability(env.fuelTempC[cur]!, M[cur]!) * this.fc.receptivity[cur]!;
          if (this.rng.next() < pIg) {
            const i = cur % nx;
            this.pendingDebris.push({
              time: t + this.rng.range(DP.delayMinS, DP.delayMaxS), x: grid.x0 + i * h, y: grid.y0 + ((cur - i) / nx) * h, source: k, travel,
            });
          }
        }
      }
    }
  }
}
