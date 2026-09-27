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
