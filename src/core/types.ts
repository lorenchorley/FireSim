/**
 * Shared data contracts for FireSim.
 *
 * Every module (data providers, terrain, fuel, moisture, fire spread, atmosphere, embers, insight engine,
 * renderer, UI) communicates through these types. All arrays are row-major over a {@link GridSpec}
 * (k = j*nx + i, i east, j north). Units follow src/core/units.ts: SI, degrees at API boundaries,
 * compass azimuths clockwise from north, wind direction = direction the wind blows FROM.
 */
import type { LatLon } from './geo';
import type { GridSpec } from './grid';

export type { LatLon } from './geo';
export type { GridSpec } from './grid';

// ─────────────────────────────────────────────────────────────────────────────
// Terrain
// ─────────────────────────────────────────────────────────────────────────────

/** Coarse landform classes derived from slope, curvature and topographic position. */
export enum Landform {
  Flat = 0,
  Ridge = 1,
  Spur = 2,
  UpperSlope = 3,
  MidSlope = 4,
  LowerSlope = 5,
  Gully = 6,
  ValleyFloor = 7,
  Saddle = 8,
  Peak = 9,
  Cliff = 10,
}

export interface Terrain {
  grid: GridSpec;
  /** Elevation above sea level (m). */
  elevation: Float32Array;
  /** Slope angle (degrees, 0 = flat). */
  slopeDeg: Float32Array;
  /** Aspect: compass azimuth the slope FACES, i.e. the downhill direction (degrees). NaN where flat. */
  aspectDeg: Float32Array;
  /** Surface gradient dz/dx (east) and dz/dy (north), dimensionless (m/m). */
  dzdx: Float32Array;
  dzdy: Float32Array;
  /** Topographic position index (m): elevation minus the mean elevation within ~300 m. + = ridge/upper, − = gully/valley. */
  tpi: Float32Array;
  /** Plan curvature proxy (1/m): + convex (spurs, ridges), − concave (gullies, draws, chutes). */
  curvature: Float32Array;
  landform: Uint8Array;
  minElevation: number;
  maxElevation: number;
  /** Human-readable provenance, e.g. "AWS Terrain Tiles (SRTM 1″)". */
  source: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weather
// ─────────────────────────────────────────────────────────────────────────────

export interface WindAtHeight {
  /** Height above ground (m). */
  heightAGL: number;
  /** m/s */
  speed: number;
  /** degrees, direction FROM */
  dir: number;
}

export interface PressureLevelData {
  hPa: number;
  /** Geopotential height (m above sea level). */
  height: number;
  /** °C */
  temperature: number;
  /** % */
  relativeHumidity: number;
  /** °C (optional; derived from T and RH if absent) */
  dewPoint?: number;
  /** m/s */
  windSpeed: number;
  /** degrees FROM */
  windDir: number;
}

/** One hour (or instant) of weather at the scenario location. */
export interface WeatherHour {
  /** Unix epoch milliseconds (UTC). */
  time: number;
  /** Air temperature at 2 m (°C). */
  temperature: number;
  /** Relative humidity at 2 m (%). */
  relativeHumidity: number;
  /** Dew point at 2 m (°C). */
  dewPoint?: number;
  /** Mean wind speed at 10 m in the open (m/s). */
  windSpeed10: number;
  /** Wind direction at 10 m (degrees FROM). */
  windDir10: number;
  /** Gust speed at 10 m (m/s). */
  windGust10?: number;
  /** Winds higher in the boundary layer (e.g. 80, 120, 180 m). */
  windProfile?: WindAtHeight[];
  /** Upper-air data (e.g. 925, 850, 700, 500 hPa) for stability, C-Haines and the atmosphere model's initial state. */
  pressureLevels?: PressureLevelData[];
  /** Total cloud cover (%). */
  cloudCover?: number;
  /** Global horizontal shortwave radiation (W/m²). */
  shortwaveRadiation?: number;
  /** Precipitation during the preceding hour (mm). */
  precipitation?: number;
  /** Mixing / boundary-layer height (m AGL). */
  boundaryLayerHeight?: number;
  /** Convective available potential energy (J/kg). */
  cape?: number;
  /** Surface pressure (hPa). */
  surfacePressure?: number;
}

export interface DailyWeather {
  /** Local date, ISO yyyy-mm-dd. */
  date: string;
  /** mm */
  rain: number;
  /** °C */
  tMax: number;
  tMin?: number;
}

export type WeatherSourceKind = 'forecast' | 'observed' | 'historical' | 'manual' | 'preset' | 'belt-kit' | 'fixture';

export interface WeatherSeries {
  kind: WeatherSourceKind;
  /** Provenance for display, e.g. "Open-Meteo BOM ACCESS-G". */
  source: string;
  location: LatLon;
  /** Elevation of the weather model grid point / station (m) — used for lapse-rate adjustment. */
  sourceElevation?: number;
  /** IANA time zone, normally Australia/Sydney. */
  timezone: string;
  /** Hourly (or finer) records, ascending by time. */
  hours: WeatherHour[];
  /** Daily history before the scenario start (rain, max temp) for drought indices. */
  daily?: DailyWeather[];
  /** Pre-computed or user-entered drought indices. */
  kbdi?: number;
  droughtFactor?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vegetation / fuel
// ─────────────────────────────────────────────────────────────────────────────

/** Fuel types relevant to the NSW ranges (aligned with AFDRS fuel-model families). */
export enum FuelType {
  NonFuel = 0, // bare rock, cliff, road, cleared ground
  Water = 1,
  Grassland = 2,
  GrassyWoodland = 3,
  DryForestShrubby = 4, // dry sclerophyll forest, shrubby understorey (Blue Mountains sandstone ridges)
  DryForestGrassy = 5,
  WetForest = 6, // wet sclerophyll / tall open forest
  Rainforest = 7,
  Heath = 8, // sandstone heath / shrubland / mallee-heath
  AlpineHeathGrass = 9,
  SnowGumWoodland = 10,
  PinePlantation = 11,
  Urban = 12,
}

export const FUEL_TYPE_COUNT = 13;

/** Where a fire record came from. */
export enum FireHistoryKind {
  Unknown = 0,
  Wildfire = 1,
  PrescribedBurn = 2, // hazard reduction / back burn / ecological burn
}

/**
 * Spatial fuel description. Hazard scores follow the Victorian/NSW Overall Fuel Hazard Assessment Guide
 * (Hines et al. 2010) as continuous numbers 0–4 (0 none, 1 low, 2 moderate, 3 high, 4 very high/extreme)
 * because they are the direct inputs of the Vesta Mk2 dry-forest model.
 */
export interface FuelMap {
  grid: GridSpec;
  type: Uint8Array;
  /** Surface (litter) fuel hazard score 0–4. */
  surfaceHazard: Float32Array;
  /** Near-surface fuel hazard score 0–4. */
  nearSurfaceHazard: Float32Array;
  /** Near-surface fuel height (m). */
  nearSurfaceHeight: Float32Array;
  /** Elevated (shrub/understorey) fuel hazard score 0–4. */
  elevatedHazard: Float32Array;
  /** Elevated fuel height (m). */
  elevatedHeight: Float32Array;
  /** Bark hazard score 0–4 (stringybark/ribbon bark high, smooth gum low). */
  barkHazard: Float32Array;
  /** Fine fuel loads by layer (t/ha). */
  surfaceLoad: Float32Array;
  nearSurfaceLoad: Float32Array;
  elevatedLoad: Float32Array;
  barkLoad: Float32Array;
  /** Canopy (overstorey) top height (m) and cover fraction 0–1. */
  canopyHeight: Float32Array;
  canopyCover: Float32Array;
  /** Grass curing (%), for grass and grassy fuel types. */
  curing: Float32Array;
  /** Years since the last recorded fire (NaN = no record). */
  timeSinceFire: Float32Array;
  lastFireKind: Uint8Array;
  /** Provenance notes for display. */
  sources: string[];
}

/** A mapped fire-history polygon (wildfire or prescribed burn / back burn). */
export interface FireHistoryRecord {
  kind: FireHistoryKind;
  label: string;
  /** Unix ms of the start of the fire (or the season start if only a season is known). */
  startTime: number;
  /** Rings of [lon, lat] (GeoJSON order); first ring outer. */
  rings: [number, number][][];
}

/** A current incident from the NSW RFS feed. */
export interface Incident {
  id: string;
  title: string;
  /** e.g. "Advice", "Watch and Act", "Emergency Warning", "Not Applicable". */
  alertLevel: string;
  status: string;
  /** Hectares, if known. */
  sizeHa?: number;
  /** Unix ms of the last update. */
  updated: number;
  location: LatLon;
  /** Mapped fire area rings ([lon, lat]) if published. */
  rings?: [number, number][][];
  description?: string;
}

/** A vegetation polygon from a vegetation map (e.g. NSW SVTM Keith formation). */
export interface VegetationRecord {
  formation: string;
  className?: string;
  fuelType: FuelType;
  rings: [number, number][][];
}

// ─────────────────────────────────────────────────────────────────────────────
// Fire behaviour (point model)
// ─────────────────────────────────────────────────────────────────────────────

/** Inputs to a flat-ground rate-of-spread model at one location and time. */
export interface FireBehaviourInput {
  fuelType: FuelType;
  surfaceHazard: number;
  nearSurfaceHazard: number;
  nearSurfaceHeight: number;
  elevatedHazard: number;
  elevatedHeight: number;
  barkHazard: number;
  /** Total fine fuel load available (t/ha). */
  fineFuelLoad: number;
  /** Dead fine fuel moisture content (% oven-dry weight). */
  deadFuelMoisture: number;
  /** 10 m open wind speed (m/s). */
  windSpeed10: number;
  /** Drought factor 0–10. */
  droughtFactor: number;
  /** Grass curing %. */
  curing: number;
  /** Air temperature °C and RH % (some models use them directly). */
  temperature: number;
  relativeHumidity: number;
  canopyCover: number;
  canopyHeight: number;
}

/** Multiplicative decomposition of a spread rate, used to explain *why* it is fast or slow. */
export interface SpreadFactors {
  /** Spread rate with no wind and no slope for this fuel and moisture (m/s). */
  base: number;
  /** Multiplier from wind (≥ 1 at the head). */
  wind: number;
  /** Multiplier from dead fuel moisture relative to a reference dry fuel (≤ 1 when moist). */
  moisture: number;
  /** Multiplier from fuel structure / load relative to the fuel type's reference. */
  fuel: number;
  /** Multiplier from slope in the spread direction (> 1 upslope, < 1 downslope). */
  slope: number;
  /** Multiplier from special terrain phenomena (eruptive/chimney, VLS lateral spread, ridge-top). */
  terrain: number;
}

export interface FireBehaviourOutput {
  /** Head fire rate of spread on flat ground (m/s). */
  rosHead: number;
  /** Back and flank rates of spread on flat ground (m/s). */
  rosBack: number;
  rosFlank: number;
  /** Length-to-breadth ratio of the fire ellipse. */
  lengthBreadth: number;
  /** Fuel consumed in the flaming front (t/ha). */
  fuelConsumed: number;
  /** Byram fireline intensity at the head (kW/m). */
  intensity: number;
  /** Flame height (m). */
  flameHeight: number;
  /** Vesta Mk2 phase: 1 surface, 2 surface + elevated, 3 crown; 0 for non-forest models. */
  phase: number;
  /** Spotting potential (maximum likely spotting distance in m). */
  spottingDistance: number;
  factors: SpreadFactors;
  /** Which fire model was used. */
  model: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario, ignitions and user edits
// ─────────────────────────────────────────────────────────────────────────────

export interface Ignition {
  id: string;
  kind: 'point' | 'line' | 'area';
  /** Vertices in local metres [x, y]. For 'point' a single vertex. */
  points: [number, number][];
  /** Simulation time (s from scenario start) at which the fire is present. */
  time: number;
  /** Radius for point ignitions (m). */
  radius?: number;
  /** 'observed' = user marked it; 'spot' = spot fire the user saw ahead of the front. */
  origin: 'observed' | 'spot' | 'backburn';
}

export type BrushShape = { kind: 'circle'; x: number; y: number; radius: number } | { kind: 'polygon'; points: [number, number][] };

/** A fuel edit ("more leaf litter here", "denser understorey", "this is a road"). */
export interface FuelEdit {
  kind: 'fuel';
  id: string;
  shape: BrushShape;
  /** Additive change to hazard scores (clamped 0–4). */
  surfaceHazardDelta?: number;
  nearSurfaceHazardDelta?: number;
  elevatedHazardDelta?: number;
  barkHazardDelta?: number;
  /** Override elevated fuel height (m). */
  elevatedHeight?: number;
  /** Replace the fuel type (e.g. NonFuel for a road / fire trail / rock shelf). */
  setType?: FuelType;
  /** Mark as recently burnt (e.g. a completed back burn): years since fire. */
  setTimeSinceFire?: number;
  /** Add to the dead fuel moisture (percentage points), e.g. a wet gully the model missed. */
  moistureDelta?: number;
}

/** A local wind observation the user wants the simulation to honour (e.g. "wind here is from the SW"). */
export interface WindEdit {
  kind: 'wind';
  id: string;
  x: number;
  y: number;
  /** Radius of influence (m). */
  radius: number;
  speed: number;
  dir: number;
  /** Simulation time from which it applies (s). */
  time: number;
}

export type ScenarioEdit = FuelEdit | WindEdit;

export interface SimOptions {
  /** Random seed for embers/turbulence. */
  seed: number;
  /** Fire grid cell size (m). */
  fireCellSize: number;
  /** Atmosphere horizontal cell size (m) and number of vertical levels. */
  atmosCellSize: number;
  atmosLevels: number;
  /** Height of the atmosphere model top above the lowest terrain (m). */
  atmosTop: number;
  /** 0 = fire does not modify the wind (uncoupled), 1 = full two-way coupling. */
  coupling: number;
  embers: boolean;
  /** Maximum simultaneously tracked embers. */
  maxEmbers: number;
  /** Enable parameterised mountain phenomena (vorticity-driven lateral spread, eruptive slope/chimney fire). */
  mountainPhenomena: boolean;
  /** Simulated seconds between snapshots sent to the UI. */
  snapshotInterval: number;
}

export const DEFAULT_SIM_OPTIONS: SimOptions = {
  seed: 1,
  fireCellSize: 30,
  atmosCellSize: 150,
  atmosLevels: 24,
  atmosTop: 3000,
  coupling: 1,
  embers: true,
  maxEmbers: 4000,
  mountainPhenomena: true,
  snapshotInterval: 300,
};

/** Everything the simulation worker needs. Serialisable via structured clone (typed arrays are transferred). */
export interface ScenarioData {
  id: string;
  name: string;
  origin: LatLon;
  /** Side length of the square domain (m). */
  extent: number;
  terrain: Terrain;
  fuel: FuelMap;
  weather: WeatherSeries;
  /** Scenario start (unix ms). */
  startTime: number;
  /** Simulated duration (s). */
  duration: number;
  ignitions: Ignition[];
  edits: ScenarioEdit[];
  options: SimOptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation state & outputs
// ─────────────────────────────────────────────────────────────────────────────

export enum BurnState {
  Unburnt = 0,
  Burning = 1,
  BurntOut = 2,
  NonFlammable = 3,
}

/** Dominant reason a cell burnt the way it did (for colouring and explanations). */
export enum SpreadDriver {
  None = 0,
  Wind = 1,
  Slope = 2,
  WindAndSlope = 3,
  Fuel = 4,
  DryFuel = 5,
  Spotting = 6,
  LateralVorticity = 7, // VLS on a lee slope
  Eruptive = 8, // steep slope / chimney / canyon eruptive behaviour
  FireInducedWind = 9,
  Backing = 10, // backing / flanking, slow
  Junction = 11,
}

/** Per-cell fire outputs on the fire grid. */
export interface FireField {
  grid: GridSpec;
  /** Time the fire arrived (s from scenario start); +Infinity if not yet burnt. */
  arrivalTime: Float32Array;
  burnState: Uint8Array;
  /** Local spread rate normal to the front when the cell ignited (m/s). */
  ros: Float32Array;
  /** Fireline intensity at arrival (kW/m). */
  intensity: Float32Array;
  /** Flame height at arrival (m). */
  flameHeight: Float32Array;
  /** Direction the front was moving when it arrived (azimuth, degrees). */
  spreadDir: Float32Array;
  driver: Uint8Array;
  /** Vesta phase at arrival (0–3). */
  phase: Uint8Array;
}

export interface EmberParticles {
  count: number;
  /** Packed [x, y, z(m ASL), temperatureFraction 0–1] per ember. */
  data: Float32Array;
}

export interface SpotFire {
  id: number;
  x: number;
  y: number;
  time: number;
  /** Distance from the nearest main-front burning cell when it ignited (m). */
  distance: number;
  /** Distance travelled by the firebrand (m). */
  travel: number;
}

/** Near-surface and volume atmosphere fields for display. */
export interface AtmosphereView {
  /** 2-D horizontal grid of the atmosphere model. */
  grid: GridSpec;
  nz: number;
  /** Heights of level centres above the lowest terrain point (m). */
  levels: Float32Array;
  /** Height of terrain relative to the lowest terrain (m), on the atmosphere grid. */
  terrainHeight: Float32Array;
  /** 10 m AGL wind components on the atmosphere grid (m/s). */
  surfaceU: Float32Array;
  surfaceV: Float32Array;
  /** 3-D fields (nx*ny*nz, k = (z*ny + j)*nx + i): wind components (m/s) and potential-temperature anomaly (K). */
  u: Float32Array;
  v: Float32Array;
  w: Float32Array;
  thetaAnomaly: Float32Array;
  /** Smoke concentration (arbitrary units) for plume rendering. */
  smoke: Float32Array;
}

export type InsightSeverity = 'info' | 'watch' | 'danger';

export type InsightKind =
  | 'upslope-run'
  | 'downslope-backing'
  | 'gully-chimney'
  | 'eruptive-slope'
  | 'ridge-crest'
  | 'lee-slope-eddy'
  | 'vorticity-lateral-spread'
  | 'saddle-channelling'
  | 'valley-channelling'
  | 'ridge-speed-up'
  | 'spotting'
  | 'spot-fire'
  | 'mass-spotting'
  | 'junction-zone'
  | 'wind-change'
  | 'dead-man-zone'
  | 'plume-dominated'
  | 'pyroconvection-risk'
  | 'fire-induced-wind'
  | 'anabatic-wind'
  | 'katabatic-wind'
  | 'thermal-belt'
  | 'inversion-break'
  | 'aspect-dry-fuel'
  | 'moist-gully'
  | 'heavy-fuel'
  | 'recent-burn'
  | 'crown-fire'
  | 'high-drought'
  | 'night-slowdown'
  | 'afternoon-peak'
  | 'fuel-break-breached'
  | 'rolling-debris'
  | 'general';

export interface InsightFactor {
  label: string;
  value: string;
  /** Effect on the fire, e.g. "×4.0 spread", "+2 km/h". */
  effect?: string;
}

/** An explanation event shown to the user ("why is it doing that?"). */
export interface Insight {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  /** Simulation time (s from start). */
  time: number;
  /** Location (local m) the insight refers to. */
  x: number;
  y: number;
  title: string;
  /** Plain-language explanation of the mechanism. */
  body: string;
  /** Safety takeaway for firefighters. */
  safety?: string;
  factors: InsightFactor[];
  /** Short literature reference. */
  source?: string;
}

/** Full explanation of what is happening at one location ("Why here?" panel). */
export interface CellExplanation {
  x: number;
  y: number;
  elevation: number;
  slopeDeg: number;
  aspectDeg: number;
  landform: Landform;
  fuelType: FuelType;
  fuelSummary: string;
  deadFuelMoisture: number;
  timeSinceFire: number;
  windSpeed10: number;
  windDir10: number;
  arrivalTime: number;
  ros: number;
  intensity: number;
  flameHeight: number;
  driver: SpreadDriver;
  factors: SpreadFactors;
  narrative: string[];
}

export interface SimStats {
  time: number;
  burntAreaHa: number;
  burningCells: number;
  perimeterKm: number;
  maxRos: number;
  maxIntensity: number;
  /** Current head fire spread direction (azimuth) and rate (m/s). */
  headDir: number;
  headRos: number;
  activeEmbers: number;
  spotFires: number;
  /** Embers that left the domain (potential long-range spotting beyond the model). */
  embersLeftDomain: number;
  /** Byram convective number of the most intense part of the fire. */
  convectiveNumber: number;
  /** Ambient conditions at the scenario location now. */
  weather: WeatherHour;
  deadFuelMoistureMean: number;
  ffdi: number;
  fireDangerRating: string;
  /** Wall-clock milliseconds spent per simulated minute (performance monitor). */
  msPerSimMinute: number;
}

/** Periodic output from the simulation worker. Arrays are copies the UI may keep. */
export interface SimSnapshot {
  time: number;
  fire: FireField;
  moisture: Float32Array;
  atmosphere?: AtmosphereView;
  embers: EmberParticles;
  spotFires: SpotFire[];
  stats: SimStats;
  /** Insights generated since the previous snapshot. */
  insights: Insight[];
}
