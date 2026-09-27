# FireSim architecture

FireSim is an on-site **education** tool for beginner bush firefighters working in the mountains of NSW.
It builds a 3‑D model of the user's surroundings, pulls weather for now / a past date / the forecast, lets the user mark
where fire is, and runs a **coupled 3‑D atmosphere + fire spread + ember** simulation in a background worker.
It then explains *why* the fire behaves as it does.

> FireSim is a training aid. It is not an operational prediction tool. Always follow the directions of the
> Incident Controller and NSW RFS procedures.

## Stack

| Concern | Choice | Why |
|---|---|---|
| App shell | **Capacitor 8** (iOS + Android) around a Vite + TypeScript web app; also runs as a PWA | One codebase; WebGL/WebGPU and Web Workers in the system WebView; native HTTP bypasses CORS on government data services; testable in Chromium with Playwright |
| 3‑D | **Three.js** (WebGL2) | Mature, instancing for tens of thousands of trees, runs in mobile WebViews |
| Compute | **Web Worker** running pure TypeScript numerical kernels on typed arrays | Keeps the UI at 60 fps; deterministic; unit‑testable in Node (Vitest); a WebGPU path can be added behind the same interfaces |
| Data | Open‑Meteo (BOM ACCESS‑G, ECMWF, GFS) weather: forecast, `past_days`, archive; AWS Terrain Tiles (SRTM 1″) elevation; Meta/WRI 1 m canopy height; NSW NPWS Fire History; NSW SVTM vegetation; NSW RFS incidents feed | Free, no API keys, Australian coverage |
| Offline | Bundled demo sites (terrain + canopy) plus user‑downloaded **area packs** in IndexedDB | Mountain fire grounds often have no mobile coverage |

## Source layout

```
src/
  core/        shared types (types.ts), grids, geo projection, units, seeded RNG   ← contracts; do not change casually
  data/        providers: http (native/proxy), cache & area packs, terrain tiles, canopy, weather (Open-Meteo, presets,
               belt-weather-kit), fire history (NPWS), vegetation (SVTM), incidents (RFS), demo sites
  terrain/     derived terrain fields (slope, aspect, TPI, curvature, landforms), solar geometry, insolation & terrain shading
  fuel/        fuel-type catalogue, vegetation inference, fire-history → fuel accumulation, fuel edits,
               dead-fuel moisture model (aspect/shade aware), drought (KBDI, Drought Factor)
  fire/        point fire-behaviour models (Vesta Mk2, CSIRO grass, heath, McArthur FFDI, AFDRS rating),
               level-set spread solver with directional slope, mountain phenomena (VLS, eruptive/chimney)
  atmosphere/  3-D Boussinesq terrain-following/masked solver, ambient profile from weather, surface & fire heating, smoke
  embers/      Lagrangian firebrands: generation, lofting, transport, burnout, landing ignition → spot fires
  explain/     phenomenon detectors → Insight cards; per-cell "why here?" explanation; insight text library
  sim/         Simulation orchestrator (couples all modules), Web Worker entry, main-thread SimClient, checkpoints
  scenario/    builds ScenarioData from a location (fetch/derive all layers with progress & fallbacks)
  render/      Three.js scene: terrain mesh, instanced vegetation, fire front & flames, smoke/plume, wind particles,
               embers, overlays (arrival isochrones, ROS, moisture, fuel, time-since-fire), picking
  ui/          app shell, screens & panels (location, weather, fire marking, edit brushes, timeline, insights, layers)
  main.ts      entry
docs/research/ literature review (00-synthesis.md is the model specification)
public/demo/   bundled terrain/canopy for NSW demo sites
```

## Data flow

```
 location ──► scenario/build ──► data providers ──► terrain/ + fuel/ ──► ScenarioData ──postMessage──► sim worker
                                                                                                     │
   ui ◄── SimClient ◄── SimSnapshot (fire field, moisture, atmosphere view, embers, insights) ◄──────┘
   │                                                                                                  ▲
   └── edits (fuel brush, wind override, new/spot fire) ── SimClient.applyEdit / ignite ──────────────┘
 render/ draws terrain + fuel once, then each snapshot (interpolating between snapshots for smooth playback)
```

### Coupling loop inside the worker (per atmosphere step Δt_a ≈ 5–20 s)

1. `weatherAt(t)` → ambient profile (wind, potential temperature, humidity) → `atmosphere.setAmbient`.
2. Solar geometry → insolation on each slope (terrain shading) → surface sensible heat flux (drives anabatic/katabatic flows)
   and fuel temperature.
3. `moisture.update` (hourly or every 10 min): dead fine fuel moisture per cell from T, RH, rain, insolation, canopy, aspect.
4. Fire heat release (kW/m²) from burning cells → `atmosphere.addFireHeat`.
5. `atmosphere.step(Δt_a)` → 3‑D wind, temperature, smoke.
6. Surface 10 m wind (ambient + terrain + fire-induced, × coupling factor) is interpolated to the fire grid.
7. `fire.step` is sub-stepped (CFL Δt_f ≤ 0.5·Δx/ROS_max): elliptical normal speed from the point model, directional slope
   factor, and mountain-phenomena multipliers. Per-cell factor decomposition is recorded for explanations.
8. `embers.emit` from burning cells (intensity, bark hazard) → `embers.step` in the 3‑D wind → landing → ignition
   probability (fuel moisture, fuel type) → spot fires via `fire.igniteAt`.
9. `insights.update` runs detectors (every ~60 s sim) → new Insight cards.
10. Every `snapshotInterval` a SimSnapshot is posted (copies; transferables).

## Module contracts

The shared data types are in `src/core/types.ts`. Each module exports the following (TypeScript signatures are normative).

### data/
```ts
// http.ts — fetch that works on device (CapacitorHttp, CORS-free), in the browser (dev proxy for non-CORS services) and in Node tests
export type ServiceId = 'openmeteo' | 'openmeteo-archive' | 'nswenv' | 'rfs' | 'terrarium' | 'chm' | 'generic';
export function serviceUrl(service: ServiceId, pathAndQuery: string): string;
export function fetchJson<T>(url: string, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T>;
export function fetchBinary(url: string, opts?: { timeoutMs?: number; signal?: AbortSignal; headers?: Record<string, string> }): Promise<ArrayBuffer>;
// cache.ts — IndexedDB key/value with an in-memory fallback (Node), used for area packs
export interface KV { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void>; del(key: string): Promise<void>; keys(prefix?: string): Promise<string[]> }
export function openCache(): KV;
// terrainTiles.ts
export function loadElevation(req: { centre: LatLon; extent: number; cellSize: number; demoSiteId?: string; signal?: AbortSignal }):
  Promise<{ grid: GridSpec; elevation: Float32Array; source: string }>;
export function decodeTerrarium(png: Uint8Array): { width: number; height: number; elevation: Float32Array };
export function syntheticElevation(grid: GridSpec, kind?: 'escarpment' | 'gorge' | 'ridges'): Float32Array;
// canopy.ts
export function loadCanopy(grid: GridSpec, opts: { demoSiteId?: string; allowRemote?: boolean; signal?: AbortSignal }):
  Promise<{ height: Float32Array; cover: Float32Array; source: string } | null>;
// weather.ts
export function loadWeather(req: { location: LatLon; start: number; hours: number; mode: 'now' | 'past' | 'forecast'; model?: string; signal?: AbortSignal }): Promise<WeatherSeries>;
export function weatherAt(series: WeatherSeries, time: number): WeatherHour;           // linear interpolation, wind as vectors
export const WEATHER_PRESETS: { id: string; name: string; description: string; build(start: number, hours: number, location: LatLon): WeatherSeries }[];
export function beltKitReading(r: { dryBulb: number; wetBulb: number; windKmh: number; windDir: number; time: number; pressureHpa?: number }): WeatherHour;
export function relativeHumidityFromWetBulb(dry: number, wet: number, pressureHpa?: number): number;
// fireHistory.ts / vegetation.ts / incidents.ts
export function loadFireHistory(bbox: BBox, opts?: { signal?: AbortSignal }): Promise<FireHistoryRecord[]>;
export function loadVegetation(bbox: BBox, opts?: { signal?: AbortSignal }): Promise<VegetationRecord[]>;
export function loadIncidents(bbox: BBox, opts?: { signal?: AbortSignal }): Promise<Incident[]>;
```

### terrain/
```ts
export function buildTerrain(grid: GridSpec, elevation: Float32Array, source: string): Terrain;
export function solarPosition(timeMs: number, lat: number, lon: number): { azimuth: number; elevation: number }; // degrees
export function insolation(terrain: Terrain, timeMs: number, opts: { ghi?: number; cloudCover?: number }):
  { total: Float32Array; direct: Float32Array; shaded: Uint8Array; sunAzimuth: number; sunElevation: number }; // W/m² on the slope
export function hillshade(terrain: Terrain, azimuth?: number, elevation?: number): Float32Array; // 0–1
```

### fuel/
```ts
export const FUEL_TYPES: Record<FuelType, FuelTypeInfo>;                 // defaults per type (hazard scores, heights, loads, bark, Olson k, colour)
export function inferFuelTypes(terrain: Terrain, canopy?: { height: Float32Array; cover: Float32Array } | null): Uint8Array;
export function rasteriseVegetation(grid: GridSpec, recs: VegetationRecord[]): Uint8Array;     // 255 = no data
export function rasteriseFireHistory(grid: GridSpec, recs: FireHistoryRecord[], now: number): { timeSinceFire: Float32Array; lastFireKind: Uint8Array; fireCount: Uint8Array };
export function buildFuelMap(args: { terrain: Terrain; types: Uint8Array; history?: ReturnType<typeof rasteriseFireHistory>; canopy?: {...} | null; now: number }): FuelMap;
export function applyFuelEdit(fuel: FuelMap, edit: FuelEdit): number;   // returns cells changed
export class MoistureModel {                                            // dead fine fuel moisture (%) per cell
  constructor(terrain: Terrain, fuel: FuelMap);
  initialise(series: WeatherSeries, time: number): void;               // spin up from preceding hours (rain, dew, drying)
  update(w: WeatherHour, sun: ReturnType<typeof insolation>, dtSeconds: number): void;
  readonly field: Float32Array;
}
export function kbdi(daily: DailyWeather[], annualRainfall: number, initial?: number): number;
export function droughtFactor(kbdi: number, daysSinceRain: number, lastRainMm: number): number;
```

### fire/
```ts
export function fireBehaviour(input: FireBehaviourInput): FireBehaviourOutput;      // dispatches by fuel type
export function vestaMk2(input: FireBehaviourInput): FireBehaviourOutput;
export function grassland(input: FireBehaviourInput): FireBehaviourOutput;
export function heath(input: FireBehaviourInput): FireBehaviourOutput;
export function ffdi(T: number, RH: number, windKmh: number, DF: number): number;
export function fireDangerRating(ffdiOrFbi: number): { rating: string; colour: string };
export function slopeFactor(slopeDegAlongSpread: number): number;                   // >1 upslope, <1 downslope
export interface SpreadEnvironment {
  windU: Float32Array; windV: Float32Array;            // 10 m open-equivalent wind on the fire grid (m/s)
  moisture: Float32Array;                              // dead fuel moisture (%) on the fire grid
  droughtFactor: number; weather: WeatherHour; time: number;
}
export class FireSpreadModel {
  constructor(terrain: Terrain, fuel: FuelMap, opts: SimOptions);
  ignite(ign: Ignition): void;
  igniteAt(x: number, y: number, time: number, driver?: SpreadDriver): boolean;
  step(dt: number, env: SpreadEnvironment): void;
  maxStableDt(): number;
  readonly field: FireField;
  heatRelease(): Float32Array;                         // current sensible heat flux kW/m² per fire cell
  frontCells(): Int32Array;                            // indices of currently burning cells
  factorsAt(k: number): SpreadFactors;                 // decomposition at arrival
  checkpoint(): unknown; restore(c: unknown): void;
}
```

### atmosphere/
```ts
export class Atmosphere {
  constructor(terrain: Terrain, opts: { cellSize: number; levels: number; top: number });
  setAmbient(w: WeatherHour): void;                    // inflow/boundary profile + stratification
  setSurfaceHeating(sun: ReturnType<typeof insolation>, w: WeatherHour): void;
  addFireHeat(fireGrid: GridSpec, heat: Float32Array): void;   // kW/m² on the fire grid
  step(dt: number): void;
  maxStableDt(): number;
  sample(x: number, y: number, zAGL: number, out: Float32Array): void;  // out = [u, v, w]
  surfaceWind(grid: GridSpec, outU: Float32Array, outV: Float32Array, heightAGL?: number): void;
  view(): AtmosphereView;
  checkpoint(): unknown; restore(c: unknown): void;
}
```

### embers/
```ts
export class EmberModel {
  constructor(terrain: Terrain, opts: { maxEmbers: number; seed: number });
  emit(fire: FireField, heat: Float32Array, fuel: FuelMap, burning: Int32Array, dt: number, time: number): void;
  step(dt: number, wind: (x: number, y: number, zAGL: number, out: Float32Array) => void,
       landing: (x: number, y: number) => { moisture: number; fuelType: FuelType; burnable: boolean },
       onIgnite: (x: number, y: number, travel: number) => void): void;
  particles(): EmberParticles;
  readonly leftDomain: number;
}
```

### explain/
```ts
export interface SimStateView { time: number; terrain: Terrain; fuel: FuelMap; fire: FireField; moisture: Float32Array;
  windU: Float32Array; windV: Float32Array; weather: WeatherHour; series: WeatherSeries; droughtFactor: number;
  spotFires: SpotFire[]; embersActive: number; convectiveNumber: number; atmosphere?: AtmosphereView;
  factorsAt(k: number): SpreadFactors; }
export class InsightEngine {
  constructor(terrain: Terrain, fuel: FuelMap);
  update(s: SimStateView): Insight[];                  // new insights (deduplicated with cool-downs)
  explainAt(x: number, y: number, s: SimStateView): CellExplanation;
  forecastInsights(series: WeatherSeries, start: number, duration: number): Insight[];  // e.g. coming wind change
}
```

### sim/
```ts
export type ToWorker =
  | { type: 'init'; scenario: ScenarioData }
  | { type: 'run'; until: number } | { type: 'pause' }
  | { type: 'ignite'; ignition: Ignition } | { type: 'edit'; edit: ScenarioEdit }
  | { type: 'explain'; x: number; y: number; reqId: number }
  | { type: 'rewind'; time: number };
export type FromWorker =
  | { type: 'ready' } | { type: 'snapshot'; snapshot: SimSnapshot }
  | { type: 'explain'; reqId: number; explanation: CellExplanation }
  | { type: 'status'; time: number; running: boolean } | { type: 'error'; message: string };
export class Simulation { constructor(s: ScenarioData); advance(until: number, onSnapshot: (s: SimSnapshot) => void, shouldStop?: () => boolean): void; ... }
export class SimClient { constructor(); init(s: ScenarioData): Promise<void>; run(until: number): void; pause(): void; ... on(event, cb) }
```

### render/
```ts
export class SceneView {
  constructor(container: HTMLElement);
  setScenario(terrain: Terrain, fuel: FuelMap, opts?: { imagery?: ImageBitmap | HTMLCanvasElement }): void;
  update(snapshot: SimSnapshot): void;
  setLayers(l: Partial<LayerState>): void;
  pickGround(clientX: number, clientY: number): [number, number] | null;
  flyTo(x: number, y: number, distance?: number): void;
  setUserLocation(x: number, y: number): void;
  dispose(): void;
}
```

## Performance budget (mid-range phone)

* Fire grid: 6 km at 30 m → 200 × 200 cells; level set + CFL sub-steps ≈ 1–3 s per simulated 6 h.
* Atmosphere: ≈ 48 × 48 × 24 cells at 150 m; semi-Lagrangian advection + multigrid/PCG pressure ≈ 10–25 ms per step at Δt ≈ 10 s
  → ≈ 20–50 s per simulated 6 h. It streams progressively, so results appear within seconds.
* Embers: ≤ 4 000 active particles.
* Snapshots every 5 simulated minutes, about 0.3 MB each.

## Testing

* `npm test` runs Vitest unit tests for every numerical module against published values and physical sanity checks.
* `npm run e2e` runs Playwright (Pixel 7 viewport, Chromium with SwiftShader WebGL): it loads a demo site, marks a fire,
  runs the simulation and checks that the fire spreads, insights appear and "Why here?" works.
