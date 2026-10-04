# FireSim architecture

FireSim is an on-site **education** tool for beginner bush firefighters working in the mountains of NSW.
It builds a 3‑D model of the user's surroundings, pulls weather for now / a past date / the forecast (or a preset, a
historic fire day, belt-kit readings), lets the user mark where fire is, and runs a **coupled 3‑D atmosphere + fire
spread + ember** simulation in a Web Worker. It then explains *why* the fire behaves as it does.

> FireSim is a training aid. It is not an operational prediction tool. Always follow the directions of the
> Incident Controller and NSW RFS procedures.

The normative model specification is [`research/00-synthesis.md`](research/00-synthesis.md) (the "spec"; § numbers
below refer to it). Its §2 contract changes are implemented in `src/core/`; where the code deviates, the deviation is
recorded in the module's top-of-file notes and summarised below.

## Stack

| Concern | Choice | Why |
|---|---|---|
| App shell | **Capacitor 8** (Android + iOS) around a Vite 8 + TypeScript 5.9 web app | One codebase; WebGL2 and module Web Workers in the system WebView; native HTTP (CapacitorHttp) bypasses CORS on government data services; testable in Chromium with Playwright |
| 3‑D | **Three.js** (WebGL2), on-demand rendering | Instancing for tens of thousands of trees, runs in mobile WebViews |
| Compute | one **Web Worker** running plain TypeScript kernels on typed arrays | Keeps the UI responsive; deterministic; unit-tested in Node (Vitest) |
| Data | Open‑Meteo (its automatic ‘best match’, ECMWF IFS, GFS upper-air fallback, ERA5; BOM ACCESS‑G is not requested); NSW Spatial Services 5 m elevation model (derived from stereo imagery, not LiDAR) + imagery (demo sites); AWS Terrain Tiles (SRTM); Meta/WRI canopy height; NSW NPWS fire history; NSW SVTM vegetation; NSW RFS feeds | Free, no API keys, Australian coverage |
| Offline | Bundled demo sites (`public/demo/`) and historic weather (`public/replays/`), user-downloaded **area packs** and a response cache in IndexedDB | Mountain fire grounds often have no mobile coverage |

## Source layout

```
src/
  main.ts        entry: settings/theme, loadServices (real modules or ?mock=1), App
  core/          contracts (types.ts, simTypes.ts, datasets.ts = data-set provenance), grid, geo (LocalProjection),
                 units, rng, shared physics
  data/          assets (bundled files in browser / Node), http, cache + area-pack storage, terrain tiles
                 (Terrarium), canopy, demo rasters (DEM, imagery window, GeoJSON), demo sites, synthetic terrain,
                 ledger.ts (request ledger), storage.ts (storage report), bundleManifest.ts (public/demo/provenance.json)
  terrain/       derived fields (slope, aspect, curvature, TPI, landforms), solar position, insolation + shadows,
                 sky-view factor, hillshade (analysis.ts, solar.ts, hillshade.ts)
  fuel/          catalogue, SVTM mapping, inference, fire history, accumulation, hazard/load, fuel map, edits
  fuel/moisture/ dead fine fuel moisture model, stable night / cold pool, air T/RH, AFDRS moisture, drought
                 (KBDI, DF), availability, ignition probability
  fire/models/   Vesta Mk2 / 2012, CSIRO grassland, heath, pine, McArthur, kernels, shape, spotting, FBI
  fire/terrainFeatures.ts  gully axes / trench, ridges, saddles, lee exposure (on the fire grid, from the 10 m DEM)
  fire/spread/   FireSpreadModel (level set, head vector, three-speed ellipse, mountain phenomena, attribution)
  atmosphere/    createAtmosphere → Atmosphere (3-D) or DiagnosticWind (fast): background, solver, surface
                 heating, fire heat, plume, fire wind
  embers/        EmberModel: emission, lofting, transport, burnout, landing, spot ignition, overlays
  explain/       InsightEngine, rule registry, card texts, forecast cards, explainCell ("Why here?"), safety
  scenario/      buildScenario pipeline, Open-Meteo, weather sources, presets, replays, belt kit, layers, area packs,
                 live feeds (RFS incidents, fire danger, hotspots; not used by the UI yet), data-set records
                 (datasetAssembly, datasetRecords*, datasetStats, recordKit, imagery), estimate.ts (planned data),
                 memoryModel.ts (working memory)
  sim/           Simulation (coupling loop), records, stats, SimHost, worker.ts, SimClient / LocalSimController,
                 protocol, validation/ (§15 scenarios), testing/ (scenario builders, hashes)
  render/        SceneView (Three.js) + layers: terrain, vegetation (species-shaped canopy), places (roads, trails, homes,
                 zones, names), flames, embers, smoke, wind, cross-section, icons, sky, camera rig, heightfield picking,
                 legends, palette, layerCatalog.ts (the one description of every layer), demo imagery
  ui/            App shell + back stack (app.ts, backStack.ts), screens (notice, setup, building, settings, datasets,
                 modelCard, sim/*), session, stores, widgets + primitives (typed builders of the design system), mocks
  styles/        design system (tokens, base, components, overlays, data: flat Maps-style look, light / night / high-contrast)
                 + screen CSS (screens, sim, transport, layers, datasets, modelcard); see docs/DESIGN.md
e2e/             Playwright specs (app.spec.ts real engine end to end, sim.spec.ts, ui.spec.ts mock, layers, datasets,
                 model-card, integration, android)
docs/research/   literature reviews 01–10, 08b; 00-synthesis.md is the model specification
docs/screenshots/ produced by the e2e specs and scripts/app-screenshots.mjs (design/ = the style guide and the screens)
public/demo/     bundled terrain / canopy / imagery / vegetation / fire history of the 8 demo sites
public/replays/  bundled hourly + 365-day daily weather of the 7 historic fire days
```

## Data flow

```
 Setup (ui/setupModel.buildRequest) ──ScenarioRequest──► scenario/buildScenario(req, onProgress, signal)
     terrain (bundled 5 m model → area pack → Terrarium → synthetic) · canopy · SVTM · NPWS history · weather · drought · fuel
     every read recorded on a per-build DatasetLedger (data/ledger.ts) → DatasetRecord[] + DatasetSummary
                                                   │ ScenarioData (fire-grid Terrain + 10 m terrainHiRes, FuelMap,
                                                   ▼   WeatherSeries, options, warnings, datasets, datasetSummary)
 ui/SimSession ──init──► SimClient ──postMessage──► sim/worker.ts → SimHost → Simulation
     ▲   │                                              │ ready (forecast cards), t0 snapshot, 3-D spin-up
     │   └─ run / pause / ignite / edit / removeEdit / removeIgnition / rewind / setOption / setQuality / explain
     │                                              ▼
     └── snapshot (transferable buffers) · status · rewound · explain · error
 ui/SnapshotStore (compact exact history) ──► render/SceneView.update(snapshot) (interpolates between snapshots)
```

`ui/modules.ts` resolves the implementations: `buildScenario` (src/scenario), `SimClient` (src/sim, Web Worker) and
`SceneView` (src/render) are loaded lazily with `import.meta.glob` (separate chunks). `?mock=1` uses the mocks
(`ui/mockScenario.ts`, `ui/mockSim.ts`, `ui/mockScene.ts` — a 2-D map); a module that fails to load, or a
`SceneView` that throws (no WebGL2), falls back to its mock with a warning and a visible "Demo engine" / "2-D map"
banner.

### Coupling loop inside the worker (one atmosphere step Δt_a, spec §12.2, `src/sim/simulation.ts`)

1. Due records (ignitions, fuel/wind edits, removals, options, quality) in (time, insertion) order; ember spot
   ignitions scheduled by the previous step.
2. Weather stamp pair → `atm.setAmbient`; `weatherAt(t)`; stable-night state → `atm.setNightState`.
3. Every 600 s: insolation → `atm.setSurfaceHeating`, `moisture.update`, `fire.refreshMoistureCache`.
4. Every 60 s or on a 22.5° wind-sector change: `fire.refreshMasks`; `atm.surfaceWindForFire` (background, fire
   wind, ridge, slope flows, lee blend); `atm.airAt`.
5–6. `fire.prepare(env)`; `fire.step(Δt_a, env)` (CFL sub-steps).
7. coupling > 0: `atm.addFireHeat` (previous step's heat); `atm.step(Δt_a)`.
8. `embers.emit` + `embers.step(atm.sample, atm.sampleTurb, landing, onIgnite)`.
9. Every 60 s: `fire.minuteTasks`; `atm.diagnostics`; `explain.update(view)`.
10. `t += Δt_a`; snapshots every `snapshotInterval` (the *display step*, default 60 s), checkpoints every 1800 s (ring of 8 + t0).

Δt_a = min(atm.maxStableDt(), 12 s) (fast tier 10 s), further limited by the *solver step* option `maxStepS` (0 =
automatic) and by the display step when that is smaller (never below 1 s); the interval to the next boundary — the next
minute mark or the next display-step mark, so t lands on both — is split into equal steps. With a display step ≥ 60 s
the sequence is the classic one (a 10 s display step means 10 s steps; 30 s means 3 × 10 s).

**Display step vs solver step.** The display step (`Settings.timeStep` → `SimOptions.snapshotInterval`, 10 s … 10 min)
is how often the engine produces a picture. It is applied live (`setOption('snapshotInterval', s)` is not a record and
never rewinds; the cadence continues from the next multiple). It does not change the physics in the fast tier (10 s steps
land on every selectable display step) nor for whole minutes in the 3-D tiers (the classic 5 × 12 s per minute); a display
step of 10 s or 30 s in a 3-D tier splits the interval into other equal steps (3 × 10 s per 30 s), so the run differs from
the 60 s one (measured: `src/sim/cadence.test.ts`; the Settings and time-menu hints say so). The
solver step (`Settings.solverStep` → `maxStepS`: automatic / 5 / 2 / 1 s) caps Δt_a: it changes the trajectory, so it
is a *timed record* like `coupling` (the UI session re-runs from the view time, see below).

**Snapshots on the wire.** Besides the cadence, the host asks the simulation for a *run-end snapshot*
(`Simulation.emitRunEnd()`) when a run completes or is paused: if the newest snapshot the receiver holds is older than
the time reached (a run to a time between two display steps, or a snapshot skipped by coalescing), one is emitted for
exactly that time, so the UI can stop a timeline jump there. It has no side effect on the simulation (the ember
overlay is read with `peekLanding`, without decaying it) — a test chunks a run in many ways and later snapshots stay
bitwise identical (`src/sim/cadence.test.ts`). *Coalescing*: when the worker produces cadence snapshots faster than
~25 per wall second (`SIM_PARAMS.snapshotMinWallMs`, e.g. a 10 s step at maximum speed) it skips the intermediate ones
(keeping their side effects and carrying their insights to the next), except the first of every 300 s window
(`keyframeIntervalS`); `status` reports carry `until`, the target of the current run, so the UI can tell its own run's
reports from stale ones. Reports are throttled (250 ms) except starts and stops, and whenever the worker goes idle the
last report is forced to say `running: false` (a replay that ends inside the throttle window used to leave the UI's
`computing` flag stuck on). A replay nobody asked to run on (an edit or rewind while paused) stops at the logical now
and does not compute on to a stale `until` (`src/sim/host.status.test.ts`).

## Module contracts

The shared types are in `src/core/types.ts` and `src/core/simTypes.ts` (spec §2.1–2.2). The module signatures of
spec §2.4 are normative; the real entry points, with the deviations the builders recorded:

```ts
// data/ (index.ts)
loadElevation(req): Promise<ElevationResult>;  loadCanopy(grid, opts): Promise<CanopyResult | null>;
loadDemoDem(siteId); loadDemoImageryInfo(siteId) → { url, meta };  imageryWindow(meta, grid) → pixel window;
openCache(): KV;  saveAreaPack / listAreaPacks / findAreaPacks / loadAreaPackItem / deleteAreaPack;
resolveAssetBase()  // directory of the document, or the app root from inside the worker (…/assets/…)
// terrain/
buildTerrain(grid, elevation, source, opts?): Terrain;  terrainDerived(terrain): TerrainDerived (cached);
solarPosition(timeMs, lat, lon);  insolation(terrain, timeMs, opts): InsolationResult;  castShadows, skyViewFactor, hillshade
// fuel/  (spec §2.4, plus fuelParamsInto(fuel, k, out) for allocation-free kernels)
buildFuelMap(args): FuelMap;  applyFuelEdit(fuel, edit, base, history, t0): number;  cellsInBrush(grid, shape)
// fuel/moisture
new MoistureModel(terrain, fuel, derived, opts?, resolve?)  // initialise / update / breakdown / checkpoint
// fire/
computeTerrainFeatures(terrain, derived, hiRes?);  new FireSpreadModel(terrain, fuel, features, opts, rng, params?)
// atmosphere/ (tier factory instead of two public constructors)
createAtmosphere(terrain, hiRes, fuel, features, tier, extent, series, rng, …): Atmosphere | DiagnosticWind
//   + setWindEdits(edits, startMs), setCoupling(c), setNightState(night), surfaceWindForFire(…), airAt(…)
// embers/
new EmberModel(terrain, fuel, { maxEmbers, tier, … }, rng)   // emit / step / particles / stats / overlays
// explain/
new InsightEngine(terrain, derived, fuel, features, …)       // update / explainAt / forecastInsights / layers
// scenario/ (entry point spec §2.3)
buildScenario(req: ScenarioRequest, onProgress, signal?): Promise<ScenarioData>;
WEATHER_PRESETS[id].build(start, hours, site) / canonicalStart(lon, year);  REPLAYS;  downloadAreaPack(req, onProgress, signal)
```

### Data sets and provenance (core/datasets.ts, data/ledger.ts, scenario/dataset*.ts)

Every built scenario carries `datasets: DatasetRecord[]` and `datasetSummary: DatasetSummary` (plain JSON, structured-clone
safe). The contract, its vocabulary and the pure helpers are in `src/core/datasets.ts` (re-exported from `core/types.ts`):

```ts
// core/datasets.ts
DatasetRecord { id, role, title, what, why, provider, licence, attribution, endpoints[], sourceServices[], format, kind,
  status: 'used'|'partial'|'fallback'|'unavailable'|'skipped'|'user',
  origin: 'live'|'cache'|'area-pack'|'bundled'|'synthetic'|'preset'|'user'|'derived'|'none', originDetail?, fallbackReason?,
  vintage { capturedOn?, capturedNote?, captureSummary?, retrievedAt, retrievedBasis, version?, versionNote?, currentTo?,
            cacheFreshUntil?, ageHoursAtBuild?, staleAfterHours?, stale? },
  crs?, extent?, coverage { fraction, filledBy?, filledOrigin?, note? }, native?, model? (+ resampling),
  sizes { transferredBytes, networkBytes (on the wire where reported), networkDecodedBytes? (uncompressed, when it
          differs), networkUnmeasuredBytes? (part of networkBytes counted uncompressed: wire size not reported),
          cachedBytes, decodedBytes?, memoryBytes?, requests, tiles?, features?, records?, durationMs?,
          storedOnDeviceBytes?, estimate? },
  stats: DatasetStat[] { label, value (formatted), raw?, unit?, hint? }, distribution?, layer? { overlay?, layerId? },
  evidence { level: 'measured'|'modelled'|'calibrated'|'assumed'|'synthetic', note, specRef? }, warnings[], limitations[],
  parts?, plan? }
DatasetSummary { schema, scenarioId, scenarioName, seed, builtAt, buildDurationMs, model {nx, ny, cells, cellSizeM, extentM,
  hiRes*, atmos*, tier, durationS, startTime}, totals {count, byStatus, transferredBytes, networkBytes, networkDecodedBytes?,
  networkUnmeasuredBytes?, cachedBytes, requests, memoryBytes, storedBytes, cellShareByOrigin}, fallbacks[], warnings[], reproduce {scenarioId, seed, centre, bbox, …},
  workingMemory? }
formatBytes (base 10, 1 decimal, like Android) · formatCount/Percent/Duration/Age · sortDatasets · compareDatasets ·
groupByRole · findDataset · isSubstitute · creditLines · imageryCredit · weatherStaleness (6 h / 24 h) ·
summariseDatasets · resummarise · upsertDataset · datasetIssues (validator) · typedArrayFootprint ·
datasetsToJson (stable) · datasetsToCsv (RFC 4180; per stat with {stats:true}) · datasetsToText
```

* **Ledger** (`data/ledger.ts`): `new DatasetLedger()` per build (scenario/build.ts), passed in `LayerContext` /
  `WeatherContext` / `HiResRequest` / `ContextRequest`. `data/http.ts` requests take optional `{ tag, ledger, note }` and
  record host + path (query, fragment, credentials and token-looking segments dropped), status, bytes on the wire
  (Content-Length; else the Resource Timing `encodedBodySize`, which Node's fetch and same-origin / Timing-Allow-Origin
  browser responses report; else the decoded body length, flagged `wireUnknown` and totalled as `networkUnmeasuredBytes`:
  compressed ArcGIS / Open-Meteo JSON is 4-8x smaller on the wire, and CapacitorHttp and cross-origin browser answers do not
  report it), decoded bytes, time and retries. EVERY attempt is an entry (a retried HTTP 429 or timeout is a request; the
  final one carries the retry count). A single file keeps its real path on the endpoint list; two files of the same
  numeric pattern collapse to it ('/terrarium/14/{n}/{n}.png'). Without a ledger nothing changes. (Open-Meteo HTTP 429:
  a per-minute limit is backed off 60 s x 3 (spec §11.1); its daily limit, "try again tomorrow", is not waited out, and
  the rainfall-history record names it as the reason for its defaults, `omFailure`.) `cachedFetch` records stored-copy hits (size, stored-at) and what it writes; `loadAsset` records
  bundled files; `loadAreaPackItem` records pack reads. It never throws, keeps totals exactly and at most 4 000 entries.
  Tags = data-set ids (`terrain`, `canopy-height`, `vegetation-svtm`, `fire-history`, `weather`, `upper-air`,
  `drought-history`, `imagery`, the context file, ...).
* **Records** are assembled once at the end of the build (`scenario/datasetAssembly.ts assembleDatasets`) from the loaders'
  reports (terrain origin and tile counts, layer origins and sites, weather `detail`, drought `info`, places `info`),
  the ledger and the finished grids: `datasetRecords.ts` (terrain, imagery, vegetation, canopy, fire history),
  `datasetRecordsWeather.ts` (weather, upper air, rainfall history; model wording that claims no unverified model),
  `datasetRecordsPlaces.ts` (roads, fire trails, homes, zones, place names, the derived fuel map, your input, the bundle,
  and `describeStartMoisture` for the worker's first snapshot), statistics in `datasetStats.ts` (pure; each hot loop is a
  small function of its own so the engine optimises it at once: about 2 ms per data set on 300 x 300, the whole inventory
  15-30 ms per Katoomba build, 60-85 ms on the first, cold build). Memory figures: every typed array counted once; the
  grids twice (main thread + the worker's copy), the places context once (sim/client.ts does not send it), the fire-record
  index (`ScenarioData.fuelHistory`) under fire history, the fuel arrays under the fuel map. `withRecord(scenario, record)` adds a later record (start moisture, edits) and re-totals the summary.
  A failure in the inventory is logged and never costs the user the scenario.
* **Planned data** (`scenario/estimate.ts`): `estimateScenarioData(request, {kv?, manifest?})` → planned records with
  `plan { basis, lowBytes, highBytes, likelyOrigin, offlineOk, offlineNote, networkBytes, onDevice }` and
  `sizes.estimate`; `planScenarioData(request, facts)` is the pure core, `summarisePlan(records)` the totals. It reads only
  the bundle manifest, the area-pack index and cache keys; the typical sizes (`TYPICAL`, `CONTEXT_PER_KM2`) carry their
  measurement basis. Planned network bytes are UNCOMPRESSED sizes (an upper bound): compare them with a built record's
  `networkDecodedBytes ?? networkBytes`.
* **Working memory** (`scenario/memoryModel.ts`): `workingMemory(input)` / `workingMemoryForScenario(scenario, opts)` →
  `WorkingMemory { tier, items[] {id, label, where: main|worker|gpu, bytes, perCellBytes?, formula, note?}, totals, notes }`,
  attached to the summary at build time. Engine coefficients (`ENGINE_BYTES`) were measured by walking every typed array of
  real `Simulation`s; `Simulation.memoryReport()` measures a running engine by part and `memoryModel.test.ts` keeps the two
  within 8 % per part and 5 % in total. From a built scenario the worker's scenario copy (without the places context) and
  its two fuel-map copies are measured, not modelled (`workerScenarioArrayBytes`, `fuelMapBytes`). `liveMemory()` reads `performance.memory` or says it is not available.
  The running engine's own measurement reaches the UI as `SimSnapshot.engine.memory` (`EngineInfo`, at most every 30 s of real time, with the
  simulated time it was taken at); the Data sets screen shows it under *Measured now* and sizes the modelled memory for the tier the engine
  reports (`workingMemoryForScenario(…, { tier })`), not for the tier that was asked for ('auto' is modelled as Standard only before the engine reports).
* **Storage** (`data/storage.ts`): `storage.report()` → bundled data (manifest), stored copies by kind and place with dates,
  area packs with item sizes, the browser's estimate, a warning above 500 MB; `storage.clearCache(kind)` and
  `storage.deleteAreaPack(id)` only after the user confirms. `KV.sizes()` returns each entry's size and stored-at time.
* **Bundle manifest**: `public/demo/provenance.json` (`scripts/build-demo-provenance.mjs`, `npm run provenance`): size and
  capture date of every bundled file; `data/bundleManifest.ts` loads it (null when missing: numbers are then left out).
* **Fixtures and mocks**: `tests/fixtures/datasets/{katoomba-bundled,live-nondemo,offline-synthetic}.json` and
  `live-nondemo.plan.json` (the planned records of the live request) (written by
  `WRITE_FIXTURES=1` runs of `scenario/datasets.test.ts` and `scenario/datasets.live.test.ts`); `ui/mockDatasets.ts` gives
  `?mock=1` scenarios an honest inventory (real bundled terrain and canopy, everything fabricated marked `synthetic`).
* **Tests**: `core/datasets.test.ts` (formatting, sorting, summary, exports, validator), `data/ledger.test.ts` (bytes,
  cache hits, no secrets, never throws, cost), `data/storage.test.ts`, `scenario/datasetStats.test.ts`,
  `scenario/estimate.test.ts`, `scenario/memoryModel.test.ts`, `scenario/datasets.test.ts` (Katoomba bundled, a non-demo
  place on a fake network then from its stored copies, offline synthetic).

### sim/

Normative: spec §12 (coupling order §12.2, stats §12.3, checkpoints §12.4, determinism §12.5, tiers §12.6) and the
protocol in `src/sim/protocol.ts` (§2.3, with two additions below).
```ts
// simulation.ts — synchronous orchestrator (worker or Node)
export class Simulation {
  constructor(scenario: ScenarioData, opts?: { tier?: 'auto' | QualityTier; hooks?: { snapshot?(s: SimSnapshot): void;
    rewound?(time: number): void }; clock?: () => number; skipSpinUp?: boolean;
    testHooks?: { moisture?(M, FA, t): void; surfaceHeating?: boolean; emberLanding?(ev): void };   // §15 set-ups only
    minSnapshotWallMs?: number });                        // coalescing (host: 40 ms; default 0 = never skip)
  readonly forecastInsights: Insight[];                   // 'ready' payload (§10.3)
  spinUp(deadlineMs?: number): boolean;                    // 3-D spin-up 900 s + auto-tune; t0 checkpoint when done
  advance(until: number, deadlineMs?: number, shouldStop?: () => boolean): boolean;   // whole Δt_a steps
  ignite(i: Ignition): void; edit(e: ScenarioEdit, time: number): void; removeEdit(id: string): void;   // timed records
  removeIgnition(id: string): boolean;                     // undo a mark: delete its record, rewind to it, re-run
  setOption(key: SimOptionKey, value: number | boolean): void; setQuality(tier: QualityTier): void;
  emitRunEnd(): boolean;                                   // snapshot at exactly the time reached, if the last is older
  rewind(time: number): number;                            // restores the latest checkpoint ≤ time; returns its time
  explain(x: number, y: number, time?: number): CellExplanation;
  snapshot(): SimSnapshot; stats(): SimStats; perf(): SimPerf;
  readonly time: number; readonly tier: QualityTier; readonly isReady: boolean; readonly logicalNow: number;
}
// host.ts — chunked message loop (≤ 40 ms chunks, yields between them) shared by the worker and LocalSimController
export class SimHost { constructor(port: { post(msg: FromWorker, transfer?: Transferable[]): void }, opts?); handle(msg: ToWorker): void; }
// worker.ts — Web Worker entry (MessageChannel yield, transferable snapshot buffers)
// client.ts
export class SimClient implements SimController { constructor(worker?: Worker); }   // in-thread fallback without Worker
export class LocalSimController implements SimController { }                        // same host in the calling thread
```
Every user action (ignition, fuel/wind edit, edit removal, option, quality tier) is a *record* with a simulation time,
applied at the start of the first atmosphere step at or after that time in (time, insertion) order; a record in the
past rewinds to it (posting `rewound`). `rewind(t)` restores the latest checkpoint ≤ t (ring of 8 every 1800 s + the
permanent t0 one), re-runs silently to t and then streams again, so a re-run is bitwise identical.

Protocol additions of the integration (both backwards compatible):
* `explain` carries an optional view `time` (`SimController.explain(x, y, time?)`); arrival state is evaluated at
  min(time, now) — "Why here?" answers for the moment on screen, also when scrubbed back.
* `removeIgnition(id)` (ToWorker `{ type: 'removeIgnition', id }`): removes a marked ignition as if it had never been
  marked. The record is deleted; if it had burnt, the latest checkpoint ≤ its time is restored and the run repeated to
  the user's logical time; `rewound(ignitionTime)` is posted and every snapshot / insight after that time is emitted
  again. The UI session drops its results after that time at once.
* `setOption` keys `snapshotInterval` (display step, live, no rewind) and `maxStepS` (solver step, a timed record);
  `status` carries `until`; a run-end snapshot follows every completed or paused run (see the coupling loop above).

Coupling choices that deviate from the spec text (validation of §15, `src/sim/validation/`; parameters in
`SIM_PARAMS` / `ATMOS_PARAMS`):
* Fast-tier pyrogenic correction (§8.8, D32): the sim passes the fire's prepared cells and their outward front normals
  as the head mask (`FireSpreadModel.headCells`, `pyroCorrectionMinDirection` 0), and u_p keeps only its component
  along the normal there (`pyroHeadAlongOnly`). The empirical rates already contain the fire's own indraft; the
  spec's head-only, wind-direction rule slowed calm/anabatic upslope runs by up to 25 % and sped up backing.
* 3-D tiers: by day the buoyancy excludes the band mean of the surface warming (`buoyancyBandAnomaly`; flat terrain
  kept 2.5× the forecast U10 without it); embers loft kinematically to the Briggs height in every tier
  (`SIM_PARAMS.emberLoft` 'briggs'; the 200 m sub-grid plume gave 0.2–0.4 × Mk5 spotting distances).

`src/sim/validation/*.test.ts` run the §15 scenarios (V1–V22) headless on synthetic terrain and the demo sites; the
long ones run with `SLOW=1`. Criteria the model does not meet yet are `it.fails` tests with the measured values.

### Transparency: what is simulated (sim/engineInfo.ts, ui/modelInfo.ts, ui/screens/modelCard.ts)

The user can open **How this simulation works** (Stats tab, Settings, Setup) to see what is 2-D, what is 3-D, the grids and the
steps of THIS run. Three layers, each checked against the one below:

1. **`EngineInfo`** (`core/simTypes.ts`, re-exported by `core/types.ts`) is an optional, structured-clone-friendly field of every
   `SimSnapshot` (`SimSnapshot.engine`). `Simulation.makeSnapshot()` fills it in `engineInfo()` by READING the modules, never from
   constants of its own: `tier` / `tierRequested` / `tierCause` (`requested | auto-tune | auto-pending | auto-default | changed`) /
   `tierReason` (the sentence, with the auto-tune measurement) / `autoTune`; `atmosphere` (`kind` `'3d'` or `'diagnostic'`, `nx ny nz`,
   `dxM`, `dzFirstM`, `topM` from the atmosphere's own `grid`, the current outer step, the mean step time of the tier in force,
   `spunUp`, the upper-air source, whether the picture's air view was decimated); `fire` (the terrain grid, the level set's last
   CFL sub-step, `rosMaxMs`, the forest head cap, the slope range outside which a head is "not validated"); `embers` (on, active, max,
   the sub-step range, the five classes); `cadence` (display step, solver step and its bounds, moisture, detectors, checkpoints, weather
   stamp spacing and interpolation); `run` (seed, deterministic, simulated s per wall s, steps, checkpoints and their bytes);
   `models` (the empirical spread model per fuel family of the working fuel map, coupling, mountain phenomena, embers, pyrogenic,
   heath model); and `memory` (the parts of `memoryReport()`). It is cheap: a few dozen reads, the fuel-family count once per fuel change
   (`spreadUse` is reset by `afterFuelChange`), and `memoryReport()` at most every `MEMORY_REFRESH_WALL_MS` (30 s) of the injected
   clock. The determinism hash (`sim/testing/hash.ts`) always skips `engine`: it is metadata of this device, not simulation state.
   `MockSimController` reports an `EngineInfo` flagged `mock: true` with zero atmosphere and no tiers.
2. **`describeModel({ scenario, engine, snapshot, settings, request })`** (`ui/modelInfo.ts`, pure, no DOM) returns a `ModelCard`:
   a headline, then seven sections (*At a glance*, *What it can and cannot resolve*, *How sure are we?*, *Data in this run*, *Layers
   and what they show*, *Engine right now*, *Words used*) made of `rows` (one per component, with an `EvidenceLevel`), `facts`,
   `bullets`, `layers` (from `render/layerCatalog.ts`), a glossary and one `action` (open the Data sets screen). `mode` is `live`
   (the engine reported), `planned` (a scenario, no report yet), `preview` (no scenario: planned from the Setup request with the same
   rules the builder and engine apply: `builtFireCell`, `makeGridSpec`, `ATMOS_TIERS`) or `mock`. Every number is read from the engine
   report, the scenario, the settings or a parameter table (`SIM_PARAMS`, `ATMOS_PARAMS`, `SPREAD_PARAMS`, `FIRE_MODEL_PARAMS`,
   `SCENARIO_PARAMS`); the fast tier and the 3-D tiers are worded differently from the tier the engine reports NOW, also after a
   switch mid-run. The two things quoted from documents (the evidence-tag counts of spec §4–§15 and the open issues of §16, and the
   README's validation summary) are re-checked against the files by `modelInfo.test.ts`, which fails when they change.
   `cardToText(card)` is "Copy as text".
3. **`createModelCardScreen`** (`ui/screens/modelCard.ts`) draws it: a full-screen dialog (aria-modal, focus trap) opened by the App on
   top of the running simulation (`App.openModelCard`; Back and Escape close it first; the screen stops its own Escape so the
   forwarded key does not also close the dock underneath). Live values are re-read from the newest snapshot at most once a second and
   patched in place (text nodes; a section is rebuilt only when its structure changes, e.g. after a tier switch); it never opens by
   itself and never calls pause or touches playback.

Tests: `sim/engineInfo.test.ts` (headless runs of both kinds of tier, a switch mid-run, a rewind, a fuel edit, the throttle),
`ui/modelInfo.test.ts` (values follow the scenario, tier wording, fallbacks, text export, quoted facts), `e2e/model-card.spec.ts`
(the real engine in the browser; the numbers on the page equal `window.__firesim`'s; a tier switch changes the wording),
`ui/truthAudit.test.ts` and `e2e/truth.spec.ts` (the static statements of the screens checked against the code and the engine).

### explain/

`explainCell` (spec §10.4) ranks the §6.12 factor decomposition. The fire model's wind and slope factors are those
of the **head fire** (`FireSpreadModel.factorsFor`: slope = hybrid head rate / wind-only head rate), so for a cell on
a flank or at the back the ellipse factor `SpreadFactors.direction` (R(ψ)/R_H) takes part in the ranking and is worded
as the cell's position ("the back of the fire, about 3 % of the head-fire speed"); the slope line then describes the
head fire's slope and names the edge's own slope separately.

### render/

```ts
export interface SceneViewApi {                       // src/render/api.ts — also implemented by ui/mockScene.ts
  setScenario(terrain, fuel, opts?: { imagery?: SceneImagery | null; hiRes?: { grid; elevation } | null }): void;
  setStartTime?(unixMs): void;                         // sun / shadows follow the scenario clock from the first frame
  refreshFuel(fuel): void;  update(snapshot: SimSnapshot): void;  setLayers(l: Partial<LayerState>): void;
  setIgnitions(ignitions, spots): void;  setInsights(insights): void;  focusInsight(insight | null, fly?): void;
  pickGround(clientX, clientY): [x, y] | null;  projectToScreen(x, y): [cx, cy] | null;  flyTo(x, y, distance?): void;
  setViewMode('orbit' | 'top' | 'ground'): void;  setUserLocation(x, y, headingDeg?): void;
  setViewInsets({ top, right, bottom, left }): void;   // covered screen areas: fly-to targets land in the rest
  zoomBy(factor): void;  readonly heading: number;  setHeading(deg): void;   // zoom / compass buttons
  viewSection?(animate?): void;                        // side-on view of the cross-section (3-D view only)
  setBrushPreview(p | null): void;  setInteractionEnabled(on): void;  stats(); resize(); dispose();
}
```
* The terrain mesh is built from `ScenarioData.terrainHiRes` (the 10 m DEM) when present, decimated to the quality
  budget (224 / 320 / 400 samples per side), so cliffs are finer than the 30 m fire grid; fuel, fire and overlays are
  draped from the fire grid.
* View insets use `camera.setViewOffset` with a widened field of view: the canvas keeps its angular size and the
  optical centre moves to the middle of the unobscured area (animated). The UI centres its crosshair there.
* Aerial imagery: `src/data` locates it and computes the window (`loadDemoImageryInfo`, `imageryWindow`); the UI
  (`ui/imagery.ts`) crops it for the domain from the named demo site or any demo site that covers it.
* Snapshot overlays: `SimSnapshot.layers` ('vls', 'attach', 'trench', 'dmz', 'landing') on the fire grid.
* Wind particles use a cool palette (grey-blue → white → cyan → blue → violet) so they never read as fire.
* Legends: `legendFor(overlay)`, `crossSectionLegend()`, `windLegend(mode)`; the UI shows them in the Layers panel
  and as a compact legend on the map.
* **Heat maps and the layer catalog** (layers rework). One heat map at a time (`LayerState.overlay`), any number of scene
  layers on or off independently. Every data layer is also a heat map: ground height, landform, tree height and cover,
  the four fuel hazards (leaf litter, grass and low shrubs, shrubs, bark), shrub height, grass curing, wildfire vs
  prescribed burn, homes per hectare, distance to a road or trail, and wind speed (`fields.ts` `overlayField`, legends in
  `legends.ts`, colours in `palette.ts`). All of them use one colour language, **cool = little, warm = much** (blue →
  teal → green → yellow → orange → red → plum; `HEAT_COLOURS`, `AMOUNT_RAMP`), with the hazard ratings (Low, Moderate,
  High, Very high, Extreme) in the same colours in every hazard layer; `colourVision.ts` simulates protan / deutan /
  tritan vision and `palette.test.ts` fails if a palette becomes ambiguous. `NO_DATA` cells are transparent (or the
  grey "no fire on record"): non-fuel for the hazards, no trees for tree height, not grass for curing, no home nearby.
  The shader LUT path is reused (no new shaders); the legend and the ground colours come from the same ramps.
  `OverlaySources` gained `context` (roads / homes for `homeDensity`, `roadAccess`) and `atmosphere` (`windSpeed`, km/h from
  the 10 m surface winds; a snapshot overlay). The elevation ramp stretches over the site's height range: pass the same
  `LegendContext.elevationRange` to `overlayScale` and `legendFor` (`SceneView.legend()` does; without a range the legend
  only says "lowest … highest").
* `layerCatalog.ts` is the one description of every layer (`LAYER_GROUPS`, `LAYER_CATALOG`): plain title, what it shows,
  why it matters, scene / heat / both, the LayerState key or OverlayKind, `available(ctx)` with a plain reason
  ("Needs a fire: mark one first"), data source and resolution as functions of the scenario, and its dimension. The Layers
  panel and the model card are built from it; `layerCatalog.test.ts` fails when a LayerState key or an OverlayKind is
  added without an entry. `sceneLayerOn` / `sceneLayerPatch` read and write the switches, `availabilityContext(...)`
  builds the availability flags from the fuel map, snapshot and context. `legendGallery.html` (dev page) shows every
  legend chip and catalog row in both themes (`?cvd=deutan` for colour blindness).

### ui/

* `ui/session.ts` (`SimSession`) owns the time model: view time vs the newest computed time, a bounded look-ahead
  (`runTarget`), playback at any speed (a positive number of simulated s per s, or Infinity; `MAX_REPLAY_SPEED` for
  history), edits at the view time (rewinding the worker when the view is in the past), `removeIgnition`, what-if
  re-runs with a baseline, insight reveal as the clock passes them. Nothing but the user, the end of the scenario, the
  app going to the background (and a worker error) stops playback.
* **Jumping to any time** (`seek`, `beginScrub` / `scrub` / `endScrub`, `stepBy`, `cancelSeek`). A time up to the newest
  computed one is shown at once and *exactly* (the history rebuilds the fire front for that very time). A later time is
  a **fast-forward**: `seekTarget` is set, `playing` is false, the engine runs at full speed (`run(target)`), the view
  follows each newest snapshot (`seekProgress` = (min(head, target) − seekFrom) / (target − seekFrom)) and stops
  exactly at the target (the run-end snapshot guarantees a result at or after it, the store gives the picture for the
  exact time); then playback resumes at the same speed if it was playing (or `resume`), else it stays paused. A new
  seek retargets; `pause()`, an edit, an ignition, a what-if, a worker error, or the worker going idle short of the
  target ends it, staying where the view is. Insight cards are revealed once, in order, also on the way, never beyond
  the view. Backgrounding the app pauses a jump too (the UI calls `pause()`), so the engine does not go on computing
  hours in the pocket. The clock can run ahead of the results for a moment (an edit or re-run dropped them and the
  engine is catching up; playback simply waits); `pause()` then shows the newest computed time, so a stopped view
  never shows more than what is computed. `setTimeStep` changes the display step live; `setSolverStep` re-runs from the view time like a what-if.
* **History store** (`ui/snapshotStore.ts`). With a 10–60 s display step a run makes thousands of multi-MB snapshots, so
  it keeps a compact, exact history instead: the *fire* of any earlier time t is rebuilt from the NEWEST fire arrays
  (arrival time, ros, intensity, … are fixed at ignition: a cell arriving after t is unburnt, the rest is shared by
  reference; the burn state comes from one per-cell burn-out time noted when a cell is first seen burnt out), so
  scrubbing shows the exact front at any time whatever the cadence, and after a rewind the re-simulated newest arrays are
  authoritative for earlier times too. Moisture, overlay rasters and the atmosphere view are kept at *keyframes* (every
  300 s, or the display step if larger, plus one at once for the first picture after history was cut — a rewind, an edit,
  an atmosphere tier change — so the re-run's data shows immediately and not the old run's up to 300 s later); every step keeps a light frame (time, stats, spot-fire count into one shared
  log) and its embers. `at(t)` returns the real newest snapshot at or after its time, else a composition (keyframe +
  light frame + rebuilt fire) for exactly t; `at(t, quantum)` rounds t down to a *quantum* and the same object comes
  back within it (`atOrBefore` uses min(display step, 30 s)). While playing the session uses `playQuantum(speed)` =
  speed / 6 s (≥ 1 s: about six pictures per wall second, the renderer interpolates between them), paused or
  scrubbing the exact time, so the view is updated only when something changed. The rebuilt arrays live in two rotating buffers (a composed picture is valid until the second next one;
  `SceneView.update` copies what it needs synchronously). Over budget (48–160 MB), older history is thinned first
  (an entry survives when it is at least age / R after the previous kept one, R shrinking until each list fits its share);
  the first keyframe and the newest snapshot are never dropped. Measured with real Katoomba snapshots (40 k fire cells)
  for 6 h under a 64 MB budget: 56 / 56 / 53 MB at 10 / 30 / 60 s steps (`src/ui/snapshotStore.sim.test.ts`).
* Insight flood control (`ui/insightGroups.ts`): a large fire reports the same phenomenon along its whole edge
  (hundreds of cards in 6 h). The Insights tab and the map show one card / marker per kind (the newest of the most
  severe instances, "seen N times since …"). Nothing pops up over the map: `UnseenTracker` counts the cards revealed since
  the Insights tab was last open (one per kind) for the dock badge, which turns red with one pulse for a Danger card.
  `DangerGate` only serves the opt-in settings: vibration (at most once per kind per simulated hour) and "pause on
  danger" (only the first time a kind is dangerous); both are OFF by default.
* Simulation-screen chrome (`ui/screens/sim`): collapsed by default, in the Google-Maps-for-Android language (docs/DESIGN.md).
  **Top**: a floating pill (`topBar.ts`: main menu, clock with its elapsed / Replay / Computing line, the blue Play button and the
  speed chip) with a row of read-out chips under it (temperature, humidity, wind, fire-danger rating: information, not buttons). The
  main menu is a side sheet (Data sets, How this simulation works, Help and glossary, Safety notice, Settings, New scenario); the time
  and speed controls open as small sheets (`transportKit.ts`, one popover at a time). **Map controls**: a column of round white
  buttons (Layers, View with the current camera mode, Compass) and an extended "Tools" button in the bottom corner whose speed dial
  holds the six tools (`mapMenu.ts`; the open menu is `UiState.menu`, so at most one is open and a map tap, Escape or Back collapses
  it). **Bottom**: Maps-style bottom navigation (Insights with an unseen-cards badge, Weather, Stats, Help) above the timeline strip
  (`sheet.ts`, `scrubber.ts`); a tab opens a rounded bottom sheet with a grab handle (`UiState.sheet` is `closed | peek | half | full`,
  default `closed`). A thin error chip appears under the top bar only if the engine fails; the map's legend card (`mapLegend.ts`) and
  attribution line (`mapCredits.ts`, a button that opens the Data sets screen) sit at the bottom of the visible map. Left-hand mode
  mirrors everything. The column of round buttons sits under the top bar and, where that leaves no room beside the Tools button (a short landscape screen at a large text size) and the top bar only reaches part way across, starts level with the top bar's side instead (`--col-top`, set by `layoutInsets`). The pure rules (menu reducer, what Back closes first, dock taps and detent heights, list fitting) are in
  `layoutModel.ts`; `simScreen.ts` measures the covered edges (`layoutInsets`) and gives the camera, the crosshair, the round buttons
  and the legend the visible map. Field-use rules, guarded by `ui/styles.rules.test.ts`: every tap target is at least 44 px (the
  read-out chips are not buttons), no literal font size is under 14 px (12 px exists only as the caption token), and behind a full-screen screen the stage is `inert`.
* **Layers panel** (`layersPanel.ts`, `layersModel.ts`, `layersPrefs.ts`): built only from `render/layerCatalog.ts`, so a new
  catalog row appears on its own. Map type (aerial photo / terrain colours / plain), Map details (one tile per scene layer: roads, fire
  trails, homes, residential areas, place names, 3-D canopy, shrubs, flames, smoke, embers, wind streaks, insight markers; a greyed
  tile carries the catalog's reason), Heat maps (every data layer that can colour the ground, grouped as the catalog groups them; one at
  a time, tap again to switch off; "Show on its own" hides the photo and the trees; roads, homes and shrubs have both Show and Heat map),
  Trees (natural / simple / coded by height, cover, bark or understorey hazard; sway) and Wind and air. Each row has an (i) with the
  catalog text and a link to the data set behind it on the Data sets screen. The user's choices (only choices, never defaults) are
  saved to the UI preferences (`layersPrefs.ts`, key `layers`) and put back at the start of the next run by `restoreLayerPrefs(ctx)`
  (a remembered heat map only where it can be shown; the trees' wind sway starts off in battery mode and on a low-quality renderer).
  "Why here?" has a *Where you are* part (`placeInfo.ts`, pure): nearest road and fire trail, the zone, homes within 500 m and 1 km,
  the ground, all measured from `ScenarioData.context` and the terrain grid.
* **Places context** (`ScenarioData.context`, `core/places.ts` `ContextLayers`): roads, RFS fire trails, residential and built-up
  zones, homes and place names in local metres. `scenario/context.ts loadContext` takes them from the bundle (demo sites), an area pack,
  the cache or a live query of the NSW services (`data/nswContext.ts`), in that order, and never fails a build. The worker does not
  receive them (the 3-D view and the "Where you are" part use them on the main thread). `render/placesLayer.ts` draws them
  (`SceneView.setContext`, `setLayers({ roads, fireTrails, homes, zones, placeNames })`, `placesLegend()`); the two data heat maps
  `homeDensity` and `roadAccess` come from `render/contextFields.ts`.
* **Full-screen screens and the Back stack** (`app.ts`, `backStack.ts`). Settings, Data sets and How this simulation works are
  *overlays*: the App puts them over the stage, which becomes `inert` (focus and screen readers stay in the screen), and the simulation
  keeps running and rendering underneath: opening one never pauses or changes playback. Closing one returns focus to the control that
  opened it. The Back button (Android hardware Back, the browser's Back, Escape) closes the top-most thing first: a confirmation dialog,
  a data set's page (back to the list), the screen, then the simulation's own menus, popovers, tool panel and sheet, and only then asks
  before leaving the simulation (`BackStack`: one guard entry on the history while anything is closable; on Android `MainActivity`
  maps the hardware Back to `WebView.goBack()` while the WebView has a history entry, which arrives as `popstate`). The App keeps the
  current `ScenarioData` (`this.scenario`) so Settings and Setup can open the Data sets screen outside a run (no scenario: the plan of
  the Setup form from `scenario/estimate.ts`, what is stored on the phone and the bundled data). "Show on map" from a data set closes
  the overlays and applies its layer or heat map (`SimScreen.showLayer`). Entry points: main menu, Stats tab (*Data used*: See all, a row
  = that data set), the Layers panel's (i), the map's attribution line, Settings, Setup (*Data for this run*, a row = that data set's
  planned page) and, for the model card, the main menu, the Stats tab, Settings and Setup.
* **Data sets screen** (`screens/datasets.ts`, `datasetsModel.ts` pure, `datasetViz.ts`): the summary (data sets, downloaded, in
  memory, saved on this phone; the origin mix; substitutes in plain words; the model grid and the recipe to rebuild the run), the list
  (filter chips, sort, one row per data set), a page per data set (what and why, provider and licence with links that are copied and only
  opened after asking, dates, coordinates, resolution as published and in the model, sizes, statistics, the distribution, a heat-map
  preview in the map's own colours, how far to trust it, limitations, Show on map, Copy as text / CSV / JSON), the run's working memory,
  and *On this phone* (bundled, stored copies and saved areas with Delete / Clear, always after a confirmation). Every number is read
  from `ScenarioData.datasets` / `datasetSummary`, `scenario/memoryModel.ts` and `data/storage.ts`; a compressed download whose wire
  size the phone cannot report is shown as "up to ...".
* Setup catalogues come from `src/scenario` (`WEATHER_PRESETS` / `PRESET_IDS`, `REPLAYS`); a preset starts on its
  canonical day and hour (e.g. 20 Dec 11:00 LMST), rounded to 10 min. Belt-kit readings are sent as
  `ScenarioRequest.beltKit` so the builder applies the psychrometer at the real station pressure and the 2 m → 10 m
  wind conversion.
* Performance mode changes during a run call `SimController.setQuality` ('battery' → fast, 'auto' → standard,
  'quality' → high). A fast-tier run offers "Use the 3-D atmosphere" in the Layers panel where it matters.

#### Styles and the design system

The look is a flat, Google-Maps-for-Android-flavoured design language with slightly tighter spacing; the whole contract (tokens,
primitives with markup, density and tap rules, old -> new token map, migration checklist) is in [`docs/DESIGN.md`](DESIGN.md).

* `src/styles/main.css` imports, in order: `tokens.css` (custom properties: colour, type, space, shape, elevation, size, motion; light
  "Maps light", dark "Maps night", and the `data-contrast="high"` overrides), `base.css` (reset, type roles, focus, the amber TRAINING
  strip, reduced motion), `components.css` (buttons, fields, segmented, switch, checkbox, slider, stepper, cards, lists, chips, badges,
  callouts, progress, skeleton), `overlays.css` (app bar, floating top bar, FABs, bottom sheet, dialog, popover, snackbar, bottom
  navigation, tile grid), `data.css` (key-value rows, stats, bars, meters, sparkbars, origin chips, tables, code, legend chips), then
  the screens' own CSS, which only composes the primitives and tokens (`screens.css` Setup / Building / Settings / Notice, `sim.css` and
  `transport.css` the simulation chrome, `layers.css`, `datasets.css`, `modelcard.css`). No screen CSS hard-codes a colour: the map
  marks drawn over imagery are tokens too (`--map-*`, `--mark-*`).
* `<html data-theme="light|dark">` and `<html data-contrast="high">` are set by `ui/settings.ts` (`resolveAppearance` /
  `applyAppearance` / `startThemeSync`, from `Settings.theme` and `Settings.highContrast`) and, before first paint, by the inline script
  in `index.html`. `<meta name="theme-color">` follows the theme (`THEME_CHROME`: the status-bar colour is the amber strip, which also
  documents the navigation-bar colours for the native theme).
* `ui/icons.ts` is the icon set (24 px, 2 px strokes, `currentColor`, kebab-case names plus aliases); `ui/widgets.ts` and
  `ui/primitives.ts` are typed builders for the primitives (`button`, `segmented`, `toggle`, `slider`; `chip`, `fab`, `listRow`, `kv`,
  `stat`, `bar`, `meter`, `sparkbar`, `originChip`, `tile`, `tileGrid`, `bottomNav`, `bottomSheet`, `showSnackbar` ...; `chipChoice`,
  `appBar` and `confirmDialog` were added by the screens phase).
* `ui/styleguide.html` (dev server only, `/src/ui/styleguide.html?theme=dark&contrast=high`) shows every primitive in every state and
  a mock map screen; screenshots are in `docs/screenshots/design/`.
* Guard rails: `ui/styles.rules.test.ts` (tap sizes, no literal font size under 14 px, flat rules: no gradients, no uppercase or heavy weights
  outside the sanctioned places), `ui/tokens.contrast.test.ts` (WCAG contrast of every text and boundary pair in the four modes),
  `scripts/check-contrast.mjs` (`npm run check:contrast`: the curated pairs plus every rule of every stylesheet that sets a text and a
  background colour, in the four modes; run by `ui/contrast.script.test.ts`), `scripts/audit-tap-targets.mjs`,
  `scripts/audit-contrast-dom.mjs`, `scripts/layout-budget.mjs` (free map area per phone size), `ui/icons.test.ts`,
  `ui/primitives.test.ts`, `ui/settings.test.ts`.

## Build and deployment

* `vite.config.ts`: `base: './'` (relative URLs everywhere, so the build runs from any path and inside Capacitor),
  `worker.format: 'es'` (the simulation worker is its own ES-module chunk), code-split sim / render / scenario chunks,
  source maps except in `--mode capacitor` (`npm run build:cap`).
* `public/demo` and `public/replays` are copied to `dist/` and read at run time through `data/assets.ts`
  (`resolveAssetBase` works from the page and from the worker).
* `capacitor.config.ts`: `webDir: 'dist'`, https scheme on Android, CapacitorHttp for CORS-free requests. Steps to
  create and run the native projects are in the README.

* **The 3-D canopy** (`vegetationLayer.ts`, `vegetationPlacement.ts`, `vegetationLod.ts`, `treeModels.ts`, `treeTextures.ts`,
  `treeShaders.ts`, `canopyStyle.ts`). Trees are species-shaped and procedural (no assets; the APK does not grow):
  stringybark (thick dark fibrous trunk), ribbon bark (pale trunk with hanging streamers), smooth gum (pale smooth trunk),
  tall wet-forest gum, rainforest, snow gum, pine in rows, heath mounds, **understorey shrubs at the cell's real
  elevated-fuel height** (more and lusher with a higher hazard, so the ladder fuel is visible), grass tufts (colour follows
  the curing) and a ground decal (contact shadow + leaf-litter tint by surface hazard). The bark of a eucalypt comes from
  `FuelFlag.Stringybark` / `RibbonBark` and the bark hazard (`barkKindOf`): the trunk teaches the ember-source hazard. Tree
  HEIGHTS are the canopy-height data (±14 % natural variation); only distant crowns are drawn a little wider to keep the
  canopy continuous.
  Three levels of detail per species (near ≈ 150–360 triangles of trunk, limbs and 4–7 lobes of alpha-tested leaf-cluster
  cards; mid ≈ 60–100; far = one camera-facing billboard with a procedural silhouette), planned by `planLod` from
  distance / height with hard budgets (≤ 250 k triangles on `high`, 170 k `medium`, 100 k `low`; ≤ 60 k instances),
  nearest first. Placement is a resumable `PlacementJob` pumped 4 ms per frame (`VegetationLayer.pump`), so re-placing
  the forest when the camera settles never blocks a frame; a `renderNow()` finishes it at once (screenshots, tests).
  Fire state stays on the GPU (arrival / aux / glow textures, as before): scorch (copper-brown), torching crowns (flame
  tint), consumed crowns with charred trunks and bare limbs, shrubs and grass consumed; old fires from the fuel map's time
  since fire: charred trunk with green epicormic shoots, thin crowns that thicken over ~5 years. Wind sway
  (`LayerState.windSway`): two uniforms per snapshot (`setWind(u, v)` from the near-surface wind at the view target,
  `swayParams` maps speed to lean / oscillation / flutter), bending grows with height. Readability: instances fade out with
  a screen-door dither as the camera looks down steeply (in a straight-down top view nothing is drawn at all), around active
  flames (foliage only; torching crowns stay), and near an eye-level camera; a solo heat map hides the canopy
  (`LayerState.soloHeat`).
  Styles (`LayerState.canopyStyle`): `natural`; `simple` (clean uniform low-poly shapes in one restrained palette,
  cheapest); `coded` (the simple shapes coloured by `canopyCode` = height / cover / bark / understorey with the ramps of the
  matching heat map: `canopyCodeScale(code)` returns the heat map's own LUT once `legendFor` has one, and
  `canopyCodeLegend(code)` (also `SceneView.canopyLegend()`) its legend). `canopy*.ts` and `tree*.ts` are pure (Node-testable);
  `devTrees.html` (dev page) shows every species, level, style and fire response (`window.__trees.showcase / eye / forceLod`).
  Measured (SwiftShader, 412 × 915, `high`, Katoomba): the canopy costs 528 / 417 / 403 ms per frame at 700 m / 3.5 km / eye
  level against 765 / 789 / 714 ms for the previous layer, and nothing in the top view (previous: 783 ms); triangles in the
  scene fell from 1.66 M to 0.4–0.5 M (the canopy itself 75–206 k), draw calls are 13–19 (were 9–10). The canopy code is
  85 kB minified (+58 kB over the previous layer, 27 kB gzipped); textures are generated at start-up (≈ 1 MB of memory).

## Performance

Measured in headless Chromium, one 2.1 GHz Xeon core, Katoomba 6 km at 30 m, extreme preset, 4 simulated hours:
fast tier ≈ 900 simulated s per wall s, standard (3-D 45 × 45 × 20) ≈ 220 s/s; the first snapshot 1.1–1.2 s after
`init`; the 3-D spin-up (≈ 3 s) runs while the user marks the fire. Snapshots are 1.8 MB (fast) / 2.6 MB (standard)
and transferred, not copied. Snapshot overhead in the worker (Node, same hardware, Katoomba 6 km, hot NW, 20 simulated
minutes, no coalescing): fast tier 40 ms per simulated minute without snapshots, +11.2 / +3.9 / +2.0 / +0.4 ms at
10 / 30 / 60 / 300 s steps (10.1 / 3.4 / 1.7 / 0.3 MB per simulated minute); standard tier 240 ms/min, +22.4 / +7.5 / +3.7 /
+0.7 ms (14.9 / 5.0 / 2.5 / 0.5 MB/min). At maximum speed the fast tier would make 130 pictures per second at a 10 s step;
coalescing to 25/s cuts that overhead to +3.0 ms/min (43 MB per wall second instead of 223). On the main thread no long task (> 50 ms) was observed while playing at maximum speed;
`SceneView.update` takes ≈ 4 ms median, 9 ms p95. Phones are 2–3× slower (spec §13); the spec's auto-tune (§12.6)
therefore usually picks the fast tier on phones. Spec budgets and CI gates: §13 (V20).

## Testing

* `npm test` — Vitest unit tests of every module against published values and physical sanity checks, the §15
  validation scenarios (`src/sim/validation/`, long ones with `SLOW=1`) and the 3-h Katoomba run
  (`src/sim/validation.test.ts`, skip with `FIRESIM_SKIP_SLOW=1`).
* `npx playwright test` — Pixel 7 profile, Chromium with SwiftShader WebGL, against the production build:
  `e2e/app.spec.ts` (the whole app with the real modules end to end, screenshots into `docs/screenshots/`),
  `e2e/sim.spec.ts` (the real worker), `e2e/ui.spec.ts` (the UI on the mocks), `e2e/layers.spec.ts` (the Layers panel, GPU
  object counts), `e2e/datasets.spec.ts` and `e2e/model-card.spec.ts` (the two information screens), `e2e/integration.spec.ts`
  (every entry point, the Back order, focus and inert, the 200 % font scale, high contrast, deletions that ask first, a whole run
  with every screen visited and nothing popping up), `e2e/android.spec.ts` (an emulated Capacitor runtime).
