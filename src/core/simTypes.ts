/**
 * Shared simulation-state types (spec docs/research/00-synthesis.md §2.2), used by fire/, atmosphere/, embers/,
 * explain/ and sim/. Kept separate from types.ts to avoid import cycles; re-exported from types.ts.
 */
import type { TerrainDerived, InsolationResult } from '../terrain';
import type {
  AtmosphereView,
  FireField,
  FuelFamily,
  FuelMap,
  FuelType,
  GridSpec,
  QualityTier,
  SpotFire,
  SpreadDriver,
  SpreadFactors,
  Terrain,
  WeatherHour,
  WeatherSeries,
} from './types';

export type { TerrainDerived, InsolationResult };

/** Producer: fire/terrainFeatures.ts computeTerrainFeatures(). */
export interface TerrainFeatures {
  /** D8 upslope area (m²) after priority-flood depression filling. */
  flowAcc: Float32Array;
  /** flowAcc ≥ 5 ha. */
  drainage: Uint8Array;
  /** Spec §7.6 trench score T (0–1). */
  trench: Float32Array;
  /** Up-gully azimuth (deg) on drainage cells and their side walls, NaN elsewhere. */
  gullyAxis: Float32Array;
  /** Per trench cell: index of the lowest cell of its connected T ≥ 0.3 segment, −1 elsewhere. */
  gullyBase: Int32Array;
  saddle: Uint8Array;
  ridge: Uint8Array;
  cliff: Uint8Array;
  /** Valley-floor width ≤ 200 m with both walls ≥ 15° within 300 m. */
  narrowValley: Uint8Array;
  /** Slope (deg) of the DEM averaged to 30 m (VLS calibration scale). */
  slope30: Float32Array;
  /** m: z_k − z at the end of the D8 steepest-descent path (anabatic Δz, spec §8.6). */
  valleyDrop: Float32Array;
  /** m: rise to the local crest along the steepest-ascent path (katabatic Δz, spec §8.6). */
  crestRise: Float32Array;
  /** m: along-path distance from that crest (katabatic L). */
  crestDist: Float32Array;
  /** Upwind crest for a cell and wind direction (spec §7.9), or null. */
  crest(k: number, windFromDeg: number): { d: number; zCrest: number; relief: number; kCrest: number } | null;
}

export interface StableNightInput {
  /** unix ms */
  time: number;
  sunElevation: number;
  hoursSinceSunrise: number;
  /** Grid-point 10 m wind (m/s). */
  u10: number;
  cloudPct: number;
  rain24: number;
  /** s, from the 3-D heat deficit */
  breakEta?: number | null;
}

export interface StableNightState {
  dTheta: number;
  dThetaAtSunrise: number;
  tSunrise: number | null;
  dThetaMax: number;
  hInv: number;
  /** 0–1 */
  gate: number;
  /** unix ms */
  tBreak: number | null;
  /** clamp(dTheta / 3 K, 0, 1) */
  sn: number;
}

export interface MoistureContext {
  time: number;
  lmstHour: number;
  month: number;
  sunElevation: number;
  cloudFrac: number;
  /** |U_bg10|, open-equivalent, fire grid. */
  u10: Float32Array;
  /** °C at z + 2 m, from the atmosphere when spun up. */
  airT?: Float32Array;
  burnt: Uint8Array;
  kbdi: number;
  df: number;
  night: StableNightState;
}

export interface FireWindContext {
  /** s_sep, fire grid */
  sep: Float32Array;
  /** m */
  frontDist: Float32Array;
  firePowerW: number;
  plumeTopAGL: number;
  slopeFlowOn: boolean;
  time: number;
}

export interface AtmosDiagnostics {
  spunUp: boolean;
  synthetic: boolean;
  upperAirSource: 'model' | 'preset' | 'synthetic' | 'none';
  inversion: { present: boolean; dTheta: number; topASL: number; mixedLayerTopAGL: number; breakEta: number | null };
  cHaines: number | null;
  pft: number | null;
  frH: number;
  nSquared: number;
  plumeTopASL: number;
  plumeLclASL: number;
  firePowerMW: number;
  maxUpdraft: number;
  uRidgeMedian: number;
  /** m_f, fire grid */
  fireInfluence: Float32Array;
  /** Q_h W/m², fire grid */
  heatFlux: Float32Array;
  /** S_top m/s, fire grid */
  slopeFlow: Float32Array;
  /** κ(z_ref) of spec §8.8 */
  kappa: number;
}

/** Implemented by Atmosphere (3-D) and DiagnosticWind (fast tier). */
export interface AtmosphereLike {
  /** Bracketing series stamps; u_bg solved and cached per stamp. */
  setAmbient(a: WeatherHour, b: WeatherHour): void;
  /** unix ms: interpolation weight between the stamps. */
  setTime(t: number): void;
  setSurfaceHeating(sun: InsolationResult, w: WeatherHour, kbdi: number, night: StableNightState): void;
  addFireHeat(fireGrid: GridSpec, heatKwM2: Float32Array, crownShare: Float32Array): void;
  step(dt: number): void;
  maxStableDt(): number;
  /** out = [u, v, w] (m/s) */
  sample(x: number, y: number, zAGL: number, out: Float32Array): void;
  /** out = [z_i, w*, u*] */
  sampleTurb(x: number, y: number, zAGL: number, out: Float32Array): void;
  surfaceWindForFire(
    fireGrid: GridSpec,
    outU: Float32Array,
    outV: Float32Array,
    outBgU: Float32Array,
    outBgV: Float32Array,
    outIndU: Float32Array,
    outIndV: Float32Array,
    outRidge: Float32Array,
    ctx: FireWindContext,
  ): void;
  /** T (°C) at z_cell + 2 m, ρ (kg/m³) on the fire grid. */
  airAt(fireGrid: GridSpec, outT: Float32Array, outRho: Float32Array): void;
  /** Flat levels (spec §8.1 / §2.2 AtmosphereView note). */
  view(): AtmosphereView;
  diagnostics(): AtmosDiagnostics;
  readonly spunUp: boolean;
  checkpoint(): unknown;
  restore(c: unknown): void;
}

/** Built by sim/ each atmosphere step. */
export interface SpreadEnvironment {
  /** U_fire, 10 m open-equivalent (m/s), fire grid. */
  windU: Float32Array;
  windV: Float32Array;
  /** U_bg10 (no fire terms). */
  windBgU: Float32Array;
  windBgV: Float32Array;
  /** U_fireInd = c_f·m_f·(U_dyn10 − U_bg10) or c_p·∇ψ (fast tier). */
  fireIndU: Float32Array;
  fireIndV: Float32Array;
  /** Per cell (m/s), NaN where crest(k) is null (D42). */
  uRidge: Float32Array;
  moisture: Float32Array;
  availability: Float32Array;
  fuelTempC: Float32Array;
  /** For N_c. */
  airT: Float32Array;
  airRho: Float32Array;
  droughtFactor: number;
  kbdi: number;
  weather: WeatherHour;
  time: number;
  sunElevation: number;
  lmstHour: number;
  cloudFrac: number;
  mountainPhenomena: boolean;
  pyrogenicOn: boolean;
  coupling: number;
}

export interface FireAux {
  vls: Float32Array;
  vlsActive: Uint8Array;
  sep: Float32Array;
  /** A·E */
  attach: Float32Array;
  junction: Float32Array;
  build: Float32Array;
  heatFlux: Float32Array;
  frontDist: Float32Array;
  /** N_c per front cell, 0 elsewhere. */
  nc: Float32Array;
  /** Pine crown fraction burned. */
  cfb: Float32Array;
  direction: Float32Array;
  debris: { path: Float32Array; t: number }[];
  front: Int32Array;
  frontNormalX: Float32Array;
  frontNormalY: Float32Array;
  headIndex: number;
  leftDomain: boolean;
}

export interface CellEvaluation {
  ros: number;
  rH: number;
  rB: number;
  rF: number;
  headDir: number;
  lb: number;
  intensity: number;
  flameHeight: number;
  phase: number;
  factors: SpreadFactors;
  driver: SpreadDriver;
  validated: boolean;
}

export interface LandingInfo {
  moisture: number;
  fuelType: FuelType;
  burnable: boolean;
  burnt: boolean;
  fuelTempC: number;
  surfaceHazard: number;
  nearSurfaceHazard: number;
  family: FuelFamily;
  curing: number;
  /** U10/(2·wrf), the moisture u_f. */
  bedWindMs: number;
  distToFront: number;
  frontDirX: number;
  frontDirY: number;
  /** m/s */
  rosLocal: number;
}

export type EmberClass = 'flake' | 'ribbon' | 'leaf' | 'twig' | 'heavy';

export interface SpotProvenance {
  sourceCell: number;
  emberClass: EmberClass;
  emitTime: number;
  maxHeightAGL: number;
  flightTime: number;
  distance: number;
  meanWindAloft: [number, number];
  landingState: 'flaming' | 'glowing' | 'reflamed' | 'holdover';
  landingMoisture: number;
  pIgnite: number;
  landingSlope: number;
  landingAspect: number;
  leeEddy: boolean;
  ridgeDrop: number;
  convectiveNumber: number;
  sourceClass: 'ridge' | 'windward' | 'leeward' | 'valley';
}

export interface EmberStats {
  active: number;
  leftDomain: number;
  landings10min: number;
  ignitions10min: number;
  shortRange10min: number;
  maxIgnitableDistance10min: number;
  /** 1 km bins to 30 km. */
  beyondEdgeHistogram: Float32Array;
  ignitionCapableShare: number;
}

export interface SimStateView {
  time: number;
  terrain: Terrain;
  derived: TerrainDerived;
  features: TerrainFeatures;
  fuel: FuelMap;
  fire: FireField;
  aux: FireAux;
  moisture: Float32Array;
  moistureAfdrs: Float32Array;
  moistureAnomaly: Float32Array;
  availability: Float32Array;
  windU: Float32Array;
  windV: Float32Array;
  windBgU: Float32Array;
  windBgV: Float32Array;
  fireIndU: Float32Array;
  fireIndV: Float32Array;
  uRidge: Float32Array;
  surfaceHeatFlux: Float32Array;
  /** Sub-grid slope-flow speed S_top (m/s, §8.6) signed along the fall line: + upslope (Q_h ≥ 0), − downslope. */
  slopeFlowS: Float32Array;
  airT: Float32Array;
  airRH: Float32Array;
  weather: WeatherHour;
  series: WeatherSeries;
  droughtFactor: number;
  kbdi: number;
  sunElevation: number;
  lmstHour: number;
  cloudFrac: number;
  night: StableNightState;
  spotFires: SpotFire[];
  emberStats: EmberStats;
  atmosDiag: AtmosDiagnostics;
  atmosphere?: AtmosphereView;
  tier: QualityTier;
  coupling: number;
  factorsAt(k: number): SpreadFactors;
  evaluateCell(k: number): CellEvaluation;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine info (transparency: "How this simulation works")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the engine REALLY runs, reported with every snapshot (`SimSnapshot.engine`, producer: sim/simulation.ts
 * `makeSnapshot` via sim/engineInfo.ts). Every value is read from the running modules (atmosphere grid, fire grid,
 * level-set bound, ember model, SIM_PARAMS cadences, perf counters, `memoryReport()`), never typed in. Small (well
 * under 2 KB) and structured-clone friendly (plain numbers, strings and arrays). Wall-clock values (step times, speed,
 * memory) are measurements on this device; the physics never depends on them (snapshot hashes skip `engine`).
 * The UI's history store carries the newest snapshot's `engine` on its composed pictures, so it always describes the
 * engine NOW, not the moment on screen.
 */
export interface EngineInfo {
  /** True only for the UI's demo engine (ui/mockSim.ts): nothing here then describes a physics simulation. */
  mock?: boolean;
  /** Atmosphere tier in use now. */
  tier: QualityTier;
  /** What was asked for at the start: 'auto' (auto-tune) or an explicit tier (performance setting, 'Fast' detail). */
  tierRequested: 'auto' | QualityTier;
  /**
   * How the tier in use was decided: 'requested' = asked for explicitly at the start; 'auto-tune' = the auto-tune
   * measured this device (spec §12.6); 'auto-pending' = auto, the timing sample is still running (3-D spin-up);
   * 'auto-default' = auto without a timing sample (no spin-up was run); 'changed' = switched during the run
   * (performance setting or "Use the 3-D atmosphere"), recorded at `tierChangedAt`.
   */
  tierCause: 'requested' | 'auto-tune' | 'auto-pending' | 'auto-default' | 'changed';
  /** One plain sentence with the numbers behind the tier (auto-tune timing, or when it was changed). */
  tierReason: string;
  /** The auto-tune measurement (tier 'auto', once its timed steps ran), else null. */
  autoTune: { stepMs: number; predictedS: number; budgetS: number; chosen: QualityTier; steps: number } | null;
  /** Simulation time (s) of the tier change in force, null when the tier is the one of the start. */
  tierChangedAt: number | null;
  atmosphere: EngineAtmosphereInfo;
  fire: EngineFireInfo;
  embers: EngineEmberInfo;
  cadence: EngineCadenceInfo;
  run: EngineRunInfo;
  models: EngineModelsInfo;
  /** Measured typed-array memory of the running engine (worker side), refreshed at most every 30 wall-seconds. */
  memory?: EngineMemoryInfo;
}

export interface EngineAtmosphereInfo {
  /**
   * '3d' = time-stepped 3-D air flow (dry Boussinesq on a terrain-following grid, spec §8.4, standard / high tiers);
   * 'diagnostic' = fast tier: no time-stepped air flow; the forecast wind is fitted to the terrain by a mass-consistent
   * solve on the same kind of grid once per weather stamp (§8.3, §8.9) and the fire uses its 10 m surface field.
   */
  kind: '3d' | 'diagnostic';
  /** Columns east-west and north-south, and terrain-following levels, of the atmosphere grid (0 for the demo engine). */
  nx: number;
  ny: number;
  nz: number;
  /** Horizontal spacing (m). */
  dxM: number;
  /** First-level thickness Δζ₁ (m, over flat ground; thinner over high ground, spec §8.1). */
  dzFirstM: number;
  /** Model top above the lowest ground (m): H′ = max(3000, relief + 2000). */
  topM: number;
  /** Geometric stretch ratio of the level thicknesses. */
  stretch: number;
  /** The last atmosphere step Δt_a (s) (also the fire's and embers' outer step); null before the first step. */
  currentStepS: number | null;
  /** Mean wall-clock ms of the atmosphere module per step on this device (since the tier started); null before. */
  meanStepMs: number | null;
  /** 3-D spin-up finished (the air has settled over the terrain); always false in the diagnostic tier. */
  spunUp: boolean;
  /** Where the upper-air profile came from: a weather model, a designed preset air mass, or synthesis. */
  upperAir: 'model' | 'preset' | 'synthetic' | 'none';
  /** The snapshot's AtmosphereView was halved horizontally to stay small (display only; the solver grid is as above). */
  viewDecimated: boolean;
}

export interface EngineFireInfo {
  /** Fire (level-set) grid: cells east-west, north-south, and the cell size (m). Same grid as fuel and moisture. */
  nx: number;
  ny: number;
  cellM: number;
  /**
   * The level-set sub-step (s) in use: min(CFL bound of the last sub-step, the outer step Δt_a); null when no front
   * is moving (no fire yet, or all burnt out).
   */
  currentSubStepS: number | null;
  /** Numerical cap on any spread rate (m/s, spec §7.2, [V WRF ros_max]). */
  maxSpreadRate: number;
  /** Cap on the forest (Vesta Mk2 and pine) head spread after every multiplier (m/s, spec D4). */
  forestHeadCapMs: number;
  /** Slope range (deg) outside which a head is flagged "not validated" (spec D4, §6.12). */
  validSlopeDeg: [number, number];
}

export interface EngineEmberInfo {
  /** Embers switched on (What if). */
  on: boolean;
  /** Tracked super-particles now and the budget (each may stand for several real firebrands). */
  active: number;
  max: number;
  /** Outer ember step (s) = the atmosphere step (the wind is frozen per step); null before the first step. */
  stepS: number | null;
  /** Adaptive particle sub-step range (s) inside that step (spec §9.3). */
  subStepMinS: number;
  subStepMaxS: number;
  /** Firebrand classes the model tracks. */
  classes: EmberClass[];
}

export interface EngineCadenceInfo {
  /** Display step (s): a picture every this many simulated seconds (Settings.timeStep, live). */
  displayStepS: number;
  /** Solver step limit set by the user (s); 0 = automatic. */
  solverMaxStepS: number;
  /** The tier's own bound on the outer step (s): 12 (3-D, stability-limited) or 10 (fast, fixed). */
  solverBoundS: number;
  /** The shortest outer step the tier's stability rule gives (s): 3 (3-D) or 10 (fast); the user limit may go lower. */
  solverFloorS: number;
  /** Insolation, surface heating and litter moisture update interval (s). */
  moistureUpdateS: number;
  /** Fire masks, detectors (insight cards) and atmosphere diagnostics interval (s). */
  detectorsS: number;
  /** Checkpoint interval (s) and ring size (plus the permanent start checkpoint). */
  checkpointS: number;
  checkpointRing: number;
  /** Median spacing (s) of the weather series stamps and how the engine goes between them. */
  weatherStampS: number;
  weatherInterpolation: 'linear';
}

export interface EngineRunInfo {
  seed: number;
  /** Same scenario + seed + actions give bitwise the same results (spec §12.5, tested); false for the demo engine. */
  deterministic: boolean;
  /** Simulated seconds computed per wall-clock second on this device (recent, this tier); null until measured. */
  simSecondsPerWallSecond: number | null;
  /** Outer steps taken so far (all tiers, re-runs included). */
  steps: number;
  /** Mean wall-clock ms of one whole coupled step (fire, air, embers, detectors) on this device, this tier; null before. */
  meanStepMs: number | null;
  /** Checkpoints held (the start one + the ring) and their bytes: how far back a change can re-run from. */
  checkpoints: number;
  checkpointBytes: number;
  /** 3-D spin-up length (s) before the start (0 in the fast tier). */
  spinUpS: number;
}

/** One empirical spread model in use in this scenario, with the share of burnable cells it serves. */
export interface SpreadModelUse {
  family: FuelFamily;
  /** Model name, e.g. 'Vesta Mk2', 'CSIRO grassland'. */
  model: string;
  /** Burnable fire cells of this family and their share of all burnable cells (0–1). */
  cells: number;
  share: number;
}

export interface EngineModelsInfo {
  /** Spread models by fuel family FOR THIS SCENARIO (families with no cell are left out), most cells first. */
  spread: SpreadModelUse[];
  /** Fire–atmosphere coupling c_f (0 = the fire does not change the wind, 1 = full two-way coupling). */
  coupling: number;
  /** Parameterised mountain effects (eruptive slopes, lee-slope lateral spread, junctions, debris) on. */
  mountainPhenomena: boolean;
  embersOn: boolean;
  /** Fast tier: the fire's own indraft is a 2-D potential-flow estimate on the ground (spec §8.8). */
  pyrogenic: boolean;
  heathModel: 'refit2024' | 'v1';
}

export interface EngineMemoryInfo {
  /** Simulation time (s) of the measurement. */
  measuredAt: number;
  /** Parts as Simulation.memoryReport() names them (scenario, fire, moisture, fuel, atmosphere, embers, explain, checkpoints, rasters). */
  parts: { name: string; bytes: number }[];
  totalBytes: number;
}
