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
                 units, rng, shared physics, airView.ts (what an AtmosphereView is and holds: kind, layout, flags, air time),
                 airPack.ts (the 16-bit copy of the fast tier's wind volume that the history keeps), sliceRecording.ts (the packing,
                 the byte model and the budget of the Air slice recorder; the entry needs only its budget functions, for the memory
                 model and the model card, and the build makes the file a shared chunk of 0.8 kB gzip)
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
                 heating, fire heat, plume, fire wind; both publish a terrain-following air view (the fast tier's is
                 its diagnosed wind)
  embers/        EmberModel: emission, lofting, transport, burnout, landing, spot ignition, overlays
  explain/       InsightEngine, rule registry, card texts, forecast cards, explainCell ("Why here?"), safety
  scenario/      buildScenario pipeline, Open-Meteo, weather sources, presets, replays, belt kit, layers, area packs,
                 live feeds (RFS incidents, fire danger, hotspots; not used by the UI yet), data-set records
                 (datasetAssembly, datasetRecords*, datasetStats, recordKit, imagery), estimate.ts (planned data),
                 memoryModel.ts (working memory)
  sim/           Simulation (coupling loop), records, stats, perfStats.ts (the engine's timing statistics, EngineInfo.perf),
                 SimHost, worker.ts, SimClient / LocalSimController, protocol, validation/ (§15 scenarios), testing/
                 (scenario builders, hashes)
  render/        SceneView (Three.js) + layers: terrain, vegetation (species-shaped canopy), places (roads, trails, homes,
                 zones, names), flames, embers, smoke, wind, cross-section, icons, sky (+ mapLighting, the night look), camera
                 rig, heightfield picking, legends, palette, layerCatalog.ts (the one description of every layer), demo
                 imagery; pure helpers with no three.js: qualityGuess.ts (the picture-quality guess), markerPick.ts (which icon
                 a tap is on), iconAtlas.ts (the icons' drawing), frameLog.ts (frame statistics); render-only pure helpers
                 for the cliff drawing: cliffDrawing.ts (the pipeline), cliffSharpen.ts, terrainMesh.ts, rockMask.ts;
                 atmosphereSampler.ts (the air sampler, v2), sliceFields.ts (which Air slice chips an air can give, and the
                 words), crossSectionLayer.ts + crossSectionColour.ts (the curtain), slice/ (the Air slice's pure modules, among them
                 the time-lapse recorder: sliceRecorder.ts, and the scene's half sliceTimeLapse.ts)
  ui/            App shell + back stack (app.ts, backStack.ts), screens (notice, setup, building, settings, datasets,
                 modelCard, debugStats, sim/*), session, stores, widgets + primitives (typed builders of the design system),
                 mocks; the speed signal (paceModel.ts, paceSheetModel.ts, paceTypes.ts) and Simulation debug statistics
                 (debugStats.ts, deviceInfo.ts, eventLog.ts, runEvents.ts); the Air slices tool (screens/sim/sliceTool.ts,
                 sliceToolModel.ts, sliceToolActions.ts, sliceToolLoad.ts, sliceTypes.ts: in the entry chunk) and its side-view
                 panel (screens/sim/slicePanel.ts, slicePanelModel.ts, sliceDraw.ts: one lazy chunk); recordingWords.ts (the words of
                 the Air slice recording, shared by the panel's status line and the statistics row)
  styles/        design system (tokens, base, components, overlays, data: flat Maps-style look, light / night / high-contrast)
                 + screen CSS (screens, sim, transport, layers, datasets, modelcard, debugstats; slice.css, imported by the lazy
                 side-view chunk and not by main.css); see docs/DESIGN.md
e2e/             Playwright specs (app.spec.ts real engine end to end, sim.spec.ts, ui.spec.ts mock, layers, datasets,
                 model-card, integration, android; for 0.3.0 debug-stats, pace, night-look, picture-quality, icon-tap, cliffs;
                 for 0.4.0 air-view, air-tool, airslice-panel, air-slice, air-curtain-gpu; for 0.4.1 the recorder tests of air-slice)
docs/research/   literature reviews 01–10, 08b; 00-synthesis.md is the model specification
docs/screenshots/ produced by the e2e specs and scripts/app-screenshots.mjs (design/ = the style guide and the screens)
public/demo/     bundled terrain / canopy / imagery / vegetation / fire history of the 9 demo sites (scripts/fetch-demo-site.mjs <id> builds one)
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
    minSnapshotWallMs?: number;                           // coalescing (host: 40 ms; default 0 = never skip)
    perfStats?: boolean });                               // timing statistics for EngineInfo.perf (default on; false in the cost tests)
  readonly forecastInsights: Insight[];                   // 'ready' payload (§10.3)
  spinUp(deadlineMs?: number): boolean;                    // 3-D spin-up 900 s, its first 30 steps timed for Auto; t0 checkpoint when done
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
   `tierReason` (the sentence, with the auto-tune measurement) / `autoTune` (`stepMs` the median of the steady steps, `predictedS`,
   `budgetS`, `chosen`, `steps`, and from 0.3.0 `warmupSteps` and `warmupMeanMs`); `atmosphere` (`kind` `'3d'` or `'diagnostic'`, `nx ny nz`,
   `dxM`, `dzFirstM`, `topM` from the atmosphere's own `grid`, the current outer step, the mean step time of the tier in force,
   `spunUp`, the upper-air source, whether the picture's air view was decimated); `fire` (the terrain grid, the level set's last
   CFL sub-step, `rosMaxMs`, the forest head cap, the slope range outside which a head is "not validated"); `embers` (on, active, max,
   the sub-step range, the five classes); `cadence` (display step, solver step and its bounds, moisture, detectors, checkpoints, weather
   stamp spacing and interpolation); `run` (seed, deterministic, simulated s per wall s, steps, checkpoints and their bytes);
   `models` (the empirical spread model per fuel family of the working fuel map, coupling, mountain phenomena, embers, pyrogenic,
   heath model); `memory` (the parts of `memoryReport()`); and `perf` (the timing statistics, below). It is cheap: a few dozen reads, the fuel-family count once per fuel change
   (`spreadUse` is reset by `afterFuelChange`), and `memoryReport()` at most every `MEMORY_REFRESH_WALL_MS` (30 s) of the injected
   clock. The determinism hash (`sim/testing/hash.ts`) always skips `engine`: it is metadata of this device, not simulation state.
   `MockSimController` reports an `EngineInfo` flagged `mock: true` with zero atmosphere and no tiers.
2. **`describeModel({ scenario, engine, snapshot, settings, request })`** (`ui/modelInfo.ts`, pure, no DOM) returns a `ModelCard`:
   a headline, then seven sections (*At a glance*, *What it can and cannot resolve*, *How sure are we?*, *Data in this run*, *Layers
   and what they show*, *Speed and memory right now*, *Words used*) made of `rows` (one per component, with an `EvidenceLevel`),
   `facts`, `bullets`, `layers` (from `render/layerCatalog.ts`), a glossary and `action`s (open the Data sets screen; open
   Simulation debug statistics). *Speed and memory right now* is a four-fact live summary (tier and why, computing speed, engine
   memory, this phone) plus that last action: the long list it used to hold is the statistics screen. `mode` is `live`
   (the engine reported), `planned` (a scenario, no report yet), `preview` (no scenario: planned from the Setup request with the same
   rules the builder and engine apply: `builtFireCell`, `makeGridSpec`, `ATMOS_TIERS`) or `mock`. Every number is read from the engine
   report, the scenario, the settings or a parameter table (`SIM_PARAMS`, `ATMOS_PARAMS`, `SPREAD_PARAMS`, `FIRE_MODEL_PARAMS`,
   `SCENARIO_PARAMS`); the fast tier and the 3-D tiers are worded differently from the tier the engine reports NOW, also after a
   switch mid-run. The two things quoted from documents (the evidence-tag counts of spec §4–§15 and the open issues of §16, and the
   README's validation summary) are re-checked against the files by `modelInfo.test.ts`, which fails when they change.
   `cardToText(card)` is "Copy as text".
3. **`createModelCardScreen`** (`ui/screens/modelCard.ts`) draws it: a full-screen dialog (aria-modal, focus trap) opened by the App on
   top of the running simulation (`App.openModelCard`, async: the card and its text are a lazy chunk, loaded on the first open;
   Back and Escape close it first; the screen stops its own Escape so the
   forwarded key does not also close the dock underneath). Live values are re-read from the newest snapshot at most once a second and
   patched in place (text nodes; a section is rebuilt only when its structure changes, e.g. after a tier switch); it never opens by
   itself and never calls pause or touches playback.

Tests: `sim/engineInfo.test.ts` (headless runs of both kinds of tier, a switch mid-run, a rewind, a fuel edit, the throttle),
`ui/modelInfo.test.ts` (values follow the scenario, tier wording, fallbacks, text export, quoted facts), `e2e/model-card.spec.ts`
(the real engine in the browser; the numbers on the page equal `window.__firesim`'s; a tier switch changes the wording),
`ui/truthAudit.test.ts` and `e2e/truth.spec.ts` (the static statements of the screens checked against the code and the engine).

### Speed: statistics, the Auto policy and the honest-speed signal (0.3.0)

Detailed (3-D air) runs may compute slower than playback. The code measures that, says so where the user is looking, and never
reacts on its own: nothing here changes the tier, the display step, the solver step or an option, and the one start-time Auto
decision is the only wall-clock decision in the engine. The plan is `docs/plans/air-slice-wind-detail-honest-speed.md`
(workstreams A and B).

**`EngineInfo.perf`** (`EnginePerfInfo` in `core/simTypes.ts`; producer `sim/perfStats.ts`, class `PerfStats`, pure, no clock of its
own). `Simulation.stepOnce` already timed its laps; it now also feeds them (`addLap`, `endStep`, `noteAirStep`) to `PerfStats`, and
`makeSnapshot` attaches `report()` as `EngineInfo.perf` (the `Simulation` option `perfStats: false` turns it off, for the cost
tests). Fields, each `null` until measured and never NaN: `speed` (simulated s per busy s over the last 10 s and 60 s, the tier's
mean, and the best and worst tumbling 10 s window), `history` (only the filled samples, 0 to 20, one speed per 30 s of computing), `step` (outer step now,
min, mean, max; whole-step wall ms median, 95th percentile and max over the last 128 steps; counts over 100 and 250 ms), `duty` (share
of wall time computing over 10 s and 60 s: a worker flat out reads about 0.97 to 1), `modules` (nine rows: ms per step, share since
the tier started, share over the last 10 s), `quality` (what limited the air step: horizontal CFL, vertical CFL, the tier's cap or
the user's limit; run-max winds, projection corrections, spin-up wall seconds (including the 30 timing steps), fire sub-steps, burning cells), `embers` (always null:
the ember model keeps no honest pair of totals), `reruns` (rewinds, seconds recomputed, tier switches, restores) and `events` (kinds
`tier`, `long-steps`, `rewind`, `restore`; drained by a size budget of about 750 characters per snapshot, oldest first, so four or five
at once, each with an increasing `seq` that the UI de-duplicates by; `SimSession.onEngineEvents` records the events of every snapshot, not
only of the one on screen). `perf` is published only with snapshots, so the "last 10 s" values go stale while the run is idle, and `reruns`
counts atmosphere rebuilds as tier switches (one switch writes three log lines).
Module mapping: the `atmosphere` lap is `air`; `firePrepare`, `fireStep`, `fireMasks` and `fireMinute` are `fire`; `surfaceWind` and
`fireHeat` are `coupling` (`airAt` is nested inside `surfaceWind` and is not added again); `embers`; `solarMoisture` is `moisture`;
`diagnostics` and `explain` are `detectors`; `snapshot` is `picture`; `checkpoint` is `checkpoints`; everything else, and whatever
no lap covers, is `other`. A tier switch clears what is "since the tier started" and keeps the run's own counters. No
`SimController` method was added: the block rides on snapshots. Cost, pinned by `sim/perf.test.ts` and `sim/perfStats.test.ts`:
under 1 % of a step, under 16 KB retained in the worker, under 2 KB serialised, no extra clock reads (the lane's own measurements
were about 5 microseconds per step, 0.24 % of a fast-tier step and 0.02 % of a standard one, about 11 KB retained and at most 1.9 KB
serialised). Results never depend on it: `sim/simulation.test.ts` compares every snapshot hash with the statistics off, on, and on
with a perturbed clock (both kinds of tier, several chunk sizes, a rewind), and `snapshotHash` skips `engine`.

**The Auto policy** (`autoTuneDecision` and `tierReasonText` in `sim/engineInfo.ts`; constants in `SIM_PARAMS`, `sim/params.ts`).
When the requested tier is `auto`, the first `autoTuneSteps` = 30 steps of the 3-D spin-up are timed. The first
`autoTuneWarmupSteps` = 10 (the JIT warm-up) are only reported, as `autoTune.warmupMeanMs`; the decision uses the **median** of steps
11 to 30. `T_pred = autoTuneOverhead x step x duration / autoTuneStepS` (1.4, and 10 s). The budget is
`max(autoTuneMinBudgetS, autoTuneBudgetS x duration / autoTuneBudgetRefS)`, that is `max(60 s, 600 s x duration / 6 h)`. The 3-D air
is kept when `T_pred <= budget`, else the fast tier. For every run of 36 minutes or longer (Setup offers 1 to 12 hours) the cut-off is a
step of 198.4 ms (`600 / 3.024`); only a run under 36 minutes, which Setup does not offer, is held up by the one-minute floor
(`428571 / duration in s` ms, 238 ms at 30 minutes). The one phone measured so far took 41 ms (the mean of its first 20 steps, warm-up included): the old rule (the mean of
the first 20 steps, 120 s for 6 h) predicted 124 s and chose Fast; the new cut-off is 4.8 times that step. The decision is taken
once, in `Simulation.autoTuneDecide`, written to `perf.events` (`autoTuneEventText`) and never revisited: a test in
`engineInfo.test.ts` holds the tier fixed even when the clock turns very slow mid-run, and the tier changes afterwards only by a
record (the performance setting changed mid-run maps Saver to fast, Balanced to standard outright, not to another Auto test, and Detail
to high; or Layers, *Use the 3-D atmosphere*). On the build machine the steady median was 20.9 ms and the warm-up mean 50.7 ms. The reason lines, with the measured numbers in place of the examples: *"Detailed 3-D air: this phone takes about 21 ms
per air step, so this run should compute in about 63 s (about 342 times real time). It can fall behind when you play faster than
that; the timeline will say so."* and *"Fast surface-wind model: the detailed 3-D air would take about 15 min on this phone, longer
than the limit of 10 min for a run like this. Switch in Settings, Performance, or Layers, Use the 3-D atmosphere."*

**Known limitation (not fixed; it predates 0.3.0).** After Build the tier line stays "Auto: ... being timed" (`tierCause`
`auto-pending`, `autoTune` null) until the first snapshot after Play, because the host posts the t0 snapshot before the spin-up that does
the timing; the model card and the statistics cannot show "Detailed, N ms" before Play (about 25 s after Build in a paused run). The fix
needs the host to refresh the engine info after the spin-up (a protocol timing change). `spinUpWallS` includes the 30 timing steps even
when Auto then picks Fast, and after a switch to the 3-D air the headline reads "Everything else 50 %" because the 900 s re-spin runs in
the records lap.

**The pace model and `SessionState.pace`.** `ui/paceModel.ts` (pure, no clock of its own) is a tracker with 1-second bins over 30 s.
`SimSession.trackPace` feeds it one `PaceFrame` per animation frame (the clock, the newest result, the speed asked for, the tier, a
re-run counter, the worker's computing speed `perf.speed.s10` with the `workerSpeed` average as the fallback, and `perf.duty.s10`),
and edits, re-runs, pauses and seeks tell it to drop its window (`exclude`). It publishes `SessionState.pace: PaceInfo | null`
(`ui/paceTypes.ts`: `level` `ok | behind | waiting`, `wanted`, `achieved`, `waitingShare`, `capacity`, `duty`, `aheadS`, `bufferS`,
`sinceMs`), `null` while there is nothing to judge. The numbers are one `PACE` object. `waiting`: the clock held within 1 s of the
newest result for 15 % of the last 10 s, for 6 s in a row (it leaves under 5 % for 20 s). `behind`: the worker computes under 90 % of
the speed asked for and is busy at least 90 % of the time, for 10 s (it leaves at 97 %, or under 70 % busy, for 10 s). There are 15 s
of grace after a play, a seek, a speed change or a re-run (5 s after the app returns). Left out entirely: paused, seeking, the app
hidden, Max speed (no wanted speed), the 3-D spin-up (`tierCause` `auto-pending`), replay of history, a speed or tier change, a
rewind or an edit (the newest result moving backward) and a gap in the frames. `?debug=1&paceLevel=ok|behind|waiting` forces a level
(`SimSession.debugForcePace`, for screenshots and layout audits). `ui/paceSheetModel.ts` (pure) turns `PaceInfo`, the engine's `perf`
and the time left into every sentence of the sheet; a reason is shown only when the numbers support it (air above 40 % of the busy
time on a 3-D tier, fire plus coupling above 40 %, embers above 25 %, speed now under 75 % of the median of the first four history
samples), and "Play at N x" is the nearest preset at or below what the phone achieves (it also stores that speed as the default speed, as
picking it in the speed sheet does). The sheet's *Fire spread* row adds the coupling module to fire spread (the statistics screen
lists them apart). "Use the fast model from here" is the `setQuality` path: it restores the latest checkpoint (one per 1800 s of fire)
and computes again, so its note says "The fire is computed again from the last checkpoint, up to half an hour of fire ago, and comes out
a little different" and not "from this moment on". Pausing stops the worker (`SimSession.pause` calls `controller.pause`), so it does
not let the simulation run ahead (the plan said up to 30 minutes), and the sheet says "Pausing stops the simulation too. Playing slower
is what lets it keep up." The sheet's footnote reads "Measured on this phone, over the last 10 seconds". The button needs the 15 s of
grace and the 6 s (waiting) or 10 s (behind) hold, so it comes about 22 to 27 s after Play and about 33 s when Play is pressed during the
3-D spin-up (measured on the real engine). DOM: `screens/sim/scrubber.ts` makes the 44 px button (test id `pace-btn`, in the strip's
fourth grid column, hidden while a jump computes; `aria-haspopup="dialog"` and `aria-expanded`; the ring and the run are drawn in
`--watch-ink`), the under-rail run and, as a separate visually hidden `role=status` span (`aria-live=polite`, test id `pace-live`), the
line that announces entering `waiting` and at most every 2 minutes. Known, not fixed: Android Back closes the sheet but focus then lands on
the body (the top bar's shared `closeAll(false)`), and so it does after Escape from the statistics screen that "All the numbers" opened.
`screens/sim/topBar.ts` hangs the sheet on its popover group (so the strip is created first and its button handed over), loads
`screens/sim/paceSheet.ts` on the first tap, and does not show the old "Computing" badge while the signal is on.

**Simulation debug statistics.** `ui/debugStats.ts` (pure) turns `{ engine, playback, frames, quality, store, heap, device, events,
errors, build, clock }` into 18 groups of rows (`buildDebugStats`), and `debugStatsToText` writes the Copy text (a header line, the
stable group titles, an end marker). Groups: Summary, Run, Choices, Grids, Speed, Speed history, Step, Worker duty, Where the time
goes, Step quality, Embers, Re-runs, Memory, Display (main thread), Phone: hardware, Phone: software and graphics, What this phone
can do, Recent events. No coordinate, custom place name or identifier is ever written (a bundled site is named by its id, any other
place is "a custom place", error lines are scrubbed). `ui/screens/debugStats.ts` draws it with the model card's collapsible groups
(`.mc-*`), all collapsed, patches values in place once a second, skips while the app is hidden, and never pauses or opens by itself;
the Copy fallback is a selectable box (`debug-stats-fallback`). `ui/deviceInfo.ts` (`deviceInfoNow`, cheap and re-read every second;
`deviceInfoAsync`, once and cached: Client Hints, battery, storage, a graphics probe, refresh rate) reads an injectable environment
so node tests can feed fixtures, and uses web APIs only (no native plugin). `ui/eventLog.ts` is in the entry chunk (a ring of the
last 40 events, and the long-task counter); `ui/runEvents.ts` (its own chunk, about 1.1 kB gzip, loaded when a run starts) fills it
from pace episodes, `perf.events` (by `seq`), the app going to the background and the first thinning of the history.
`render/frameLog.ts` (`FrameLog`: a 120-frame ring and ten 1-second bins; a slow frame is over 34 ms, a very slow one over 100 ms)
is kept by the render loop's `FrameMeter` and read through `SceneViewApi.frameStats?()`; while a full-screen screen covers the view
nothing is drawn, so those numbers are the last seconds before it opened (`lastDrawAgeS`). The slow-frame threshold is 34 ms, not the 33 ms
of the contract, because the 30 fps cap draws 33.3 ms frames (the field is still named `over33`, and the threshold assumes a 60 Hz
panel). The Display group also carries the *Cliff drawing (once per scenario)* row, from
`SceneViewApi.terrainStats?()`. Some rows are honestly empty: embers released and landed read "Not counted by this engine"
(`perf.embers` is always null) and the per-module times of the last 10 seconds are shown as shares only. `App.openDebugStats()` opens it as the
overlay `debug-stats` (one instance; Back and Escape close it; focus returns to the row that opened it) from the main menu row
directly under Settings (`menu-debug-stats`), Settings (`settings-debug-stats`), Setup (`setup-debug-stats`, where the run groups say
"No run yet" and the phone groups are live), the model card, and the pace sheet's "All the numbers". The rows' sub-lines: "Speed, memory
and what this phone can do" in the menu and in Setup, "Speed, memory, what this phone can do; copy as text" in Settings.

### The air view and the Air slice (0.4.0)

Workstream C (the air data foundation) and workstream D (Air slices, the side view) of
`docs/plans/air-slice-wind-detail-honest-speed.md`; what was built and the corrections to that text are in its section 18. The slice only
reads the air: nothing here feeds back into the engine (plan section 4, rule 1), and a test pins that reading a view changes no state.

**The air view.** `SimSnapshot.atmosphere` is an `AtmosphereView` (`core/types.ts`; every question asked of it goes through
`core/airView.ts`, never through `nz`). Besides its old fields it has four optional ones, absent from views made before 0.4.0 (test
fixtures, the dev scenario, the 2-D mock), which then keep their old meaning:

| Field | Meaning | Absent means |
|---|---|---|
| `layout` | `'terrain-following'`: the model's native arrays; `'flat'`: resampled onto flat levels above the lowest ground, zero below the terrain | `'flat'` |
| `kind` | `'prognostic'`: the time-stepped 3-D air (wind, temperature anomaly, smoke); `'diagnosed'`: the fast tier's fitted wind (wind only) | `nz > 0` is `'prognostic'`, else `'surface'` (10 m wind only) |
| `topM`, `baseM` | the model top above the datum (the model's H′, so `J = 1 − h0 / topM`) and the datum's height above sea level (the lowest ground, `zMin`) | `J = 1`; the consumer estimates the datum |
| `time` | the simulation time the air was produced at (stamped by `makeSnapshot`: `{ ...atm.view(), time: this.t }`), so a picture can say "air from 14:05" | no air time ("air time not recorded") |

In the terrain-following layout `levels` are the model's ζ centres, `terrainHeight` is `h0` (above the datum) and `u v w thetaAnomaly
smoke` are copies of the engine's `uc vc wc th sm` (index `level × plane + column`), so level `l` of column `c` is `h0 + ζ_l × J` above the
datum (`cellHeightAsl` for both layouts). `Atmosphere.view()` ships fresh copies of its native arrays, nothing resampled and no zero cell
under a hill (a snapshot's arrays are transferred to the main thread and detach, so every call allocates; the call changes no engine
state). `DiagnosticWind.view()` returns the same layout with `u, v, w = (1 − a) × A.bg + a × B.bg`, the very blend its `sampleBg` uses, on the native
levels (`kind: 'diagnosed'`, `thetaAnomaly` and `smoke` of length 0, the 10 m `surfaceU / surfaceV` as before). `decimateView` (the view is
halved horizontally above `atmosViewMaxCells` = 150,000 cells) now carries layout, kind, top, datum and time over: block means keep the
terrain-following layout consistent because `h0 + ζ (1 − h0 / H′)` is linear in `h0`. `keyframeBytes` in `ui/snapshotStore.ts` counts real
byte lengths, so a history keyframe carries its air and its own time, and "air from" can be said for any time on the scrubber (a picture
composed from an older keyframe says so; on the fast tier the time is that of the saved wind volume, see below).

**What the diagnosed wind is, and is not.** It is `st.bg`, the cached mass-consistent solve of the forecast profile on the model's grid
(`AtmosBase`), one per weather stamp and blended in time between two, with stability weighting and the user's wind edits (an edit reaches
only the stamps at or after its time; a test pins it). It has none of what the fire's own 2-D wind (`windFire`) adds: the κ scaling, the
night-time decoupling, the slope flows, the ridge and lee blend and the fire's indraft, and it has no plume, temperature or smoke. So a
slice or a wind-speed map of the fast tier shows the forecast wind where the terrain bends it, and at night or in a valley the wind
the fire feels can differ a lot; every consumer says "diagnosed" and "terrain effects only". The gap was measured (Katoomba, 6 km, 4,096
cells; the fire's 2-D wind divided by the published 10 m wind): on a windy day or night (7 to 10 m/s) the median is about 1.0 and 8 cells
in 10 lie between 0.81 and 1.10, but on the calm-night preset the fast tier's 10th and 90th percentiles are 0.35 and 1.91 (16.6 % of cells
under half, 20.5 % over one and a half times) and the standard tier has 31.9 % of its cells over one and a half times, so the wind speed
map is not the wind the fire feels on a calm night on either tier (plan 18.4). **Cost:** `view()` took 0.60 ms and 498 kB
on the fast tier (Katoomba 9 km, 45 x 45 x 20), 0.77 ms and 815 kB on the standard tier (6 km) and 1.16 ms and 1,730 kB on the high tier
(9 km, 60 x 60 x 24), in `atmosphere/airView.perf.test.ts` (one run, node, build machine: the `[atmos perf]` lines of the log). The
volume is published on every emitted snapshot, with no option or lazy flag. **Memory:** the diagnosed volume is 12 bytes per cell in every
published view, 474.6 KiB at 45 x 45 x 20 (`keyframeBytesModel`, `scenario/memoryModel.ts`, which the Data sets screen's working memory
uses; the atmosphere row's label for the fast tier is now "the forecast wind fitted to the terrain"). The newest snapshot holds it exactly:
the live view and the engine are untouched. **The history keeps an older picture's copy cheaper** (fix F1 of the 0.4.0 list: with the
volume whole in every keyframe a keyframe was 1,310,636 B against 824,636 B in 0.3.0, and a 1 GB phone kept 33 keyframes of a 6 hour
fast-tier run, 40 min apart at the widest, where 0.3.0 kept 55, 10 min apart). `ui/snapshotStore.ts` moves the volume out of the keyframe
into a list of its own and packs it (`core/airPack.ts`): u, v and w as 16-bit integers with a scale per field, 6 bytes per cell,
237.3 KiB at 45 x 45 x 20. Display only: a restored picture is a plain Float32 view that the sampler reads like any other. **Error
bound:** a field is stored as `round(f / s)` with `s = max|f| / 32767` and read back as `q · s`, so every value is within `max|f| / 65534`
plus the rounding of a Float32 (`s · 0.502` all told, `windPackErrorBound`): 0.00046 m/s for a 30 m/s field, and a sampled wind (a
convex mix of stored values) is off by no more. Measured on the real Katoomba 45 x 45 x 20 view (largest |u|, |v|, |w| 15.0, 14.2, 6.2 m/s):
worst difference 2.3e-4, 2.2e-4, 9.4e-5 m/s, exactly at the bound (`airPack.test.ts`, `airView.sim.test.ts`,
`snapshotStore.fast6h.sim.test.ts`). **Which volume a picture gets:** the newest saved volume at or before its time, with the view's `time`
set to that volume's, so the slice footer's "air from 14:05 (N min before the time shown)" is true; the surface wind, terrain, layout, top
and datum are the keyframe's own. **Budget:** the volumes have a share of their own, 4 % of what is left after the newest snapshot (the
keyframes keep their 72 % and the light frames their 8 %; the embers' share goes from 20 % to 16 %), so a volume never takes a picture's
room. Before the budget is first reached every keyframe keeps its volume (2 GB and up never reach it: 72 volumes, 17.5 MB, for 6 hours);
after that the list is held to its share at every step and thinned by age like the others (a first and a newest volume, finer where the
history is young), which is not counted as thinning the history (no picture goes). 3-D tiers keep their air whole in the keyframes, as
before. Measured with real fast-tier snapshots (Katoomba 6 km, 40,000 fire cells, 45 x 45 x 20, 6 hours, display step 60 s) by
`npx vitest run src/ui/snapshotStore.fast6h.sim.test.ts --reporter=verbose --silent=false`, keyframes (longest gap in minutes) at the 6 hour
instant, "0.3.0" being the same snapshots without the volume, "before" this fix the volume whole in the keyframe:

| History budget (device) | 0.3.0 | before the fix | now | wind volumes kept | history held (MiB): 0.3.0 / before / now |
| --- | --- | --- | --- | --- | --- |
| 48 MiB (0.5 GB) | 35 (40) | 22 (40) | 39 (20) | 7 | 38.8 / 39.2 / 40.2 |
| 61.4 MiB (1 GB) | 55 (10) | 33 (40) | 57 (10) | 9 | 54.5 / 52.9 / 59.1 |
| 64 MiB | 53 (20) | 31 (40) | 55 (10) | 10 | 52.9 / 50.4 / 57.7 |
| 122.9 MiB (2 GB) | 72 (5) | 72 (5) | 72 (5) | 72 | 67.9 / 101.7 / 85.5 |

The count is a sawtooth (it falls when the budget is reached and grows back), so one instant is partly luck: over the last hour of the
run, at one instant every 5 minutes, the mean count is 38.9 / 54.0 / 56.6 against 40.8 / 56.6 / 60.2 in 0.3.0 at 48 / 61.4 / 64 MiB (about
5 % fewer on average, the same lowest count to within 1 and the same longest gap or shorter), the price of the 4 % share. A keyframe with
its volume is 868 kB, 863 kB and 869 kB on average at those budgets (0.3.0: 825 kB) and 1,067,700 B at 2 GB. The air of the oldest picture
of such a run is up to 239 / 119 / 129 min older than the picture at 48 / 61.4 / 64 MiB (the footer says so). A test
(`ui/snapshotStore.air.test.ts`) weighs the live and the kept keyframe, and `memoryModel.test.ts` checks the model's bytes against a real
snapshot's and a real kept keyframe's for each tier, within 3 %.

**Capability flags** (`core/airView.ts`, plus `AvailabilityContext` in `render/layerCatalog.ts`). `airKind(view)`, `airLayout`,
`airHas(view, 'wind' | 'theta' | 'smoke')` (the array really holds a value for every column and level, so an empty array never reaches an
interpolation: a fast-tier `theta()` or `smoke()` used to read NaN), `hasAirWind` and `cellHeightAsl`, `airTime`, `airAgeS` and
`AIR_STALE_S` = 90 s. `has3dAtmosphere` now means *prognostic* (`airKind(view) === 'prognostic'`, asked of the view itself, not of
`EngineInfo.atmosphere.kind`, because a picture composed from history carries the newest engine info), and the new `hasAirWind` means
"a 3-D wind a slice can sample": it gates the Air slice, the wind-speed heat map and the slice chips. The catalog's `crossSection`
entry is available on any picture with a 3-D wind ("Needs the air picture, which the simulation makes once it has started");
Temp and Smoke need `airHas(view, 'theta' | 'smoke')`. The wind streaks "Through the plume" stay selectable on the fast tier and show
an info note ("These streaks follow the fast model's diagnosed wind (terrain effects only), so there is no plume. Use the 3-D
atmosphere to see it."); the plan had said they would be unavailable.

**Sampler v2** (`render/atmosphereSampler.ts`, pure; the one reader of the air view, used by the wind streaks, the smoke, the ember
view, the curtain's arrows and the slice). For the terrain-following layout it does what the engine's own `sample()` does
(`Atmosphere.sampleAt`, `DiagnosticWind.sampleBg`): for each of the four stencil columns it works out `ζ = (zAsl − baseM − h0) / J`,
finds the level by binary search, interpolates linearly in ζ, then blends the four columns bilinearly. Below the first level centre it
takes level 0, like the engine; above the top it takes the top level (the engine switches to its profile wind with w = 0 there; the
oracle stays inside the model, up to 2,000 m above the ground, and a slice never goes above the top). The flat layout keeps its old
path. `windP(pos, out)` and `fieldsP(pos, out)` take the position in a `Float64Array` and write a `Float32Array`: spike S3 found that
a method of doubles is boxed at 48 bytes per call in V8 when called in a long loop. They take about 110 and 260 ns per call and
allocate 0.14 bytes per call (`atmosphereSampler.test.ts` logs it); `wind`, `theta`, `smoke`, `surfaceWind` and `sample3` keep their old
signatures for the layers that call them a few thousand times a frame. Those box their double arguments when V8 does not inline them
(about 60 bytes per call; the code before 0.4.0 did the same), which costs about 11 kB a frame for the standard tier's through-the-plume
streaks as measured by a verifier; `windP` and `fieldsP` are the garbage-free path, but only the slice calls `fieldsP` and nothing in
the app calls `windP` yet, so the streaks, the displayed embers, the curtain's arrows and the tree sway still take the boxed path. The sampler also gives `kind`, `hasWind / hasTheta / hasSmoke`, `airTime`,
`modelGroundAt(x, y)` (the datum plus the view's smoothed `terrainHeight`, which a slice shades as "below the model's ground") and `top`.
**Oracle tests** (the important ones): `atmosphere/airView.oracle.test.ts` runs a real `Atmosphere` and a real `DiagnosticWind` over a
700 m ridge and asserts the sampler on the published view equals the engine's own `sample()` to 1e-3 m/s at 1,200 random points from the
ground to 2,000 m on each tier (the worst difference measured was 1.9e-6 m/s on both), at several points of the stamp blend, that
the view has no zero cell under the ridge, that two calls and calls interleaved with steps give identical bytes, that a restored
checkpoint gives bitwise-identical arrays, and that a wind edit shows in the diagnosed field only from its own time on;
`atmosphere/airView.edges.test.ts` is a second oracle for what the random points do not reach (exactly on column nodes, on and beyond the
edge and corners, on and either side of every level centre, below the first level and above the top, on the steep real Katoomba DEM and a
cliff step, across the fast tier's sub-stamps and a wind edit, a whole `sampleSlice` edge to edge, and empty, short or NaN fields);
`render/atmosphereSampler.test.ts` covers both layouts, the guards, the allocation and a regression (the old flat view read up to 96.4 %
low 30 m above the ground across a 700 m ridge, 32.9 % on average over the crossing; the new view is exact);
`render/atmosphereSampler.alloc.test.ts` holds `windP` and `fieldsP` to no allocation with V8's inlining switched off (a method that
returns a double is boxed unless TurboFan inlines it, and it declines to when the machine is busy or a loop is cold, so the blend
hands its answer back through a scratch array; the default-state measurement in `atmosphereSampler.test.ts` depends on the JIT);
`sim/airView.sim.test.ts` the fields stamped on every snapshot of both tiers, `decimateView`, the transfer list and the rule that the
simulation's results do not depend on the view being read.

**Embers and smoke on the new view.** `smokeLayer.puffsFromAtmosphere` is the one place that read the arrays directly: it now takes
cell heights from `cellHeightAsl` (smoke over the hills sits where the model has it), returns no puffs for a view without a smoke array
and no heat for one without temperature. `SceneView` takes the datum from `view.baseM` and falls back to its old estimate for a view without it.
The other readers go through the sampler (the displayed embers, the wind streaks, the smoke column, the curtain's arrows and the slice),
so on the fast tier the displayed embers and the streaks "Through the plume" now drift with the diagnosed wind; before, the fast tier's view had
no volume and the sampler fell back to the ambient wind with a power-law profile (it still does for a view that holds no wind).

**`src/render/slice`** (pure: no Three.js, no DOM; `types.ts` is the contract and holds every convention):

| Module | What it does |
|---|---|
| `types.ts` | the shared types, `SLICE_FIELDS` (the chips: Speed, Along, Up/down, Across, Temp, Smoke), `SLICE_KIND_LABEL`, constants (`SLICE_UPDATE_MIN_MS` 250, `SLICE_MIN_LENGTH_M` 300, `SLICE_MIN_LENGTH_CELLS` 2, `SLICE_PRESET_HALF_LENGTH_M` 3000), and the conventions below |
| `sliceField.ts` | `sampleSlice(sampler, terrain, spec, out?)`: reads the air on a lattice with `fieldsP`, 48 to 192 columns (one per half model cell of the line) by 48 to 56 rows from 50 m under the lowest ground on the line to the highest ground plus 2,000 m or the model top; fields `speed along across up theta smoke` as `Float32Array`, a validity mask (above the model's own ground, at or below its top), the 10 m ground and the model's ground per column, `kind`, `airTime`, and the model's own cells the line passes through (for "Show model cells"). The arrays are reused from one update to the next |
| `sectionLine.ts` | `sectionFromEndpoints(a, b, grid)` (clip to the model rectangle, minimum length `max(300 m, 2 cells)`, reversal), `resolveSlice(state, ctx)` (the effective line, from a preset, else A and B, else the old centre and azimuth), `slicePresetStatus` (so the tool can disable a preset with its reason). Never throws: a line that cannot be made is `line: null` with an issue code (`too-short`, `outside-model`, `no-user`, `no-fire`, `flat-ground`, `calm`); the words belong to whoever shows them |
| `lattice.ts` | `LatticeStencil`: bilinear reading between lattice points with the validity mask renormalised, so a point just above the model's ground is not pulled towards the zeros an invalid cell holds |
| `flow2d.ts` | the streaks: `createFlow`, `seedFlow`, `stepFlow` (seeded, never `Math.random`; a particle that leaves valid air is re-seeded), `flowArrows` (the still lattice under reduced motion) |
| `probe.ts` | `probeAt` (the air at a point of the slice, with `where`: air, in the ground, below the model's ground, above its top), `moveProbe` (the arrow keys), `probeSentence`, `windFromDeg` |
| `niceTicks.ts` | axis ticks at 1, 2 or 5 times a power of ten (candidate steps compared by their tick count, the winner's list built once, the last eight answers kept and handed back as the same object) |
| `presetWind.ts` | `presetWindFromDeg(air, centre, groundAsl, forecastFromDeg)` and `PRESET_WIND_AGL_M` (30 m): the direction the Along and Across presets follow, from the model's wind at the centre, else the forecast's |
| `sliceUpdater.ts` | `createSliceUpdater`, the shared computation (below) |
| `testing.ts` | fixtures for tests (not imported by application code) |

*Conventions* (unit-tested; the top of `types.ts` is the source): local metres, east and north; heights are metres above sea level, and
"above ground" is always against the 10 m terrain as received, never the model's smoothed ground and never the sharpened cliff drawing.
`dir` is the unit vector from A to B and `s` the distance from A; A is the left end of the panel and the panel never mirrors. `along =
u·dx + v·dy` (positive towards B); `across = u·dy − v·dx` (positive towards the right of someone walking from A to B); `up` is `w`;
`speed` is horizontal. A wind is named by where it comes **from** (`atan2(−u, −v)`), with the hyphenated eight-point word of
`explain/text.ts` ("north-west", not "northwest"). The lattice has column `c` at `s = c / (columns − 1) × length` and row 0 the lowest.
`theta` is not the raw perturbation: it is the potential-temperature anomaly minus the mean of the valid cells of its own row ("warmer or
cooler than the slice's air at that height"), because the raw field carries the night cold pool and the area-wide daytime warming.

*The line* (`LayerState.crossSection`, `render/layers.ts`, nested optional fields so there is no new top-level key and `LAYER_PREFS_VERSION`
is unchanged; nothing is persisted): `a`, `b`, `preset` (`'along' | 'across' | 'slope' | 'me' | null`), `field`. The line is the first
of: a live `preset`, then `a` and `b` both set, else the chord through `centre` along `azimuth` (the old curtain, kept so "Show me" and
the compass rose still work). Whoever writes `centre` or `azimuth` must also write `a: undefined, b: undefined, preset: null`
(`LINE_BY_CENTRE` in `render/sliceFields.ts`), and whoever writes `a` and `b` writes `preset: null`; `SceneView.setLayers` keeps an explicit
`undefined` when it merges the nested object, and `sectionChanged` compares the nested fields one by one because the object is new on every write. Absent `field` keeps the
old curtain colouring (temperature where the air has it, else speed); the tool writes `'speed'` with the first line it places. Presets are
live chords through the fire (the map centre when there is none) of 3 km each way: *along* runs A upwind to B downwind, *across* is the
bearing of the wind towards minus 90 degrees (the wind blows to the right of A to B, so `across` reads positive), *slope* runs A downhill
to B uphill from a Sobel gradient of the 10 m ground over about 2 km (flatter than 2 degrees has none), *me* runs from the phone's Setup
fix to the fire and is not extended. **The wind *along* and *across* follow** is the model's own, at the middle of the chord (the fire, else
the map centre), `PRESET_WIND_AGL_M` = 30 m above the 10 m ground there (`presetWindFromDeg` in `render/slice/presetWind.ts`, which does not
allocate). The forecast's 10 m direction at the shown time is only the fallback, for an air with no 3-D wind or a model wind there under
0.2 m/s (a sheltered pocket does not switch the presets off while the weather has a direction), and a calm forecast too has no direction
(`calm`). The first build used the forecast alone; after a wind edit the two differ (a 14 m/s wind from the east edited in at the fire gives
12.7 m/s from about 95 degrees at 30 m while the forecast still says the weather file's north-westerly), and a line along the forecast is
not one the Along and Across chips mean much for. *Me to fire* is disabled until there is a fire, with the reason "There is no fire to go to
yet" (the tool looks for the fire with the scene's own rule, `fireCentroid`, once for each snapshot, until the scene has a slice to say).

**The shared `SliceUpdater`** (`slice/sliceUpdater.ts`, owned by `SceneView`). `request(inputs, nowMs, immediate)` resolves the line,
samples the air into the same `SliceData` object every time, and checks the four presets; a line, chip or layer edit is computed at
once, a new snapshot at most every 250 ms (a request inside the interval is kept pending and `poll(nowMs)`, called from the frame loop,
releases it). It owns no timer and takes the clock as an argument, so tests use a fake one; `invalidate()` forgets everything (a new
scenario, the section switched off). `SceneView.sliceInputs()` fills `SliceInputs` from what the scene holds: the line state, the model
grid, the **10 m terrain as received** (`HeightField` of the hi-res DEM, not the sharpened mesh the ground is drawn from), the camera
target as the map centre, the fire (`fireCentroid` of the shown snapshot, a scan of the fire grid that is made once for each snapshot and
kept until the next, not at every line edit), the direction the presets follow (`windFromDeg`: `presetWindFromDeg`, the model's wind 30 m
up at the centre the presets use, else the forecast's 10 m direction at the shown time, where a wind under 0.2 m/s is `null`), the phone's
position and the shown time. `applySlice` adds the effective `field` and the state of every chip
(`sliceFieldStatuses`, one object per kind of air), redraws the curtain and calls the listeners of `onSlice`. `viewSection()` flies to the
resolved line, not to `centre` and `azimuth`. A slice update (resolve, four preset checks, sample, cells) took a median of 0.5 to 1.0 ms
and a 95th percentile of up to 1.5 ms in node on the build machine (lattices of 96 x 55 and 129 x 55; `render/slice/slice.perf.test.ts`);
the plan's limit is 8 ms at 4x CPU throttle. That was measured later, in a real browser in software rendering under a 4x throttle: the
compute alone (resolve and sample) took 2.5 ms per edit in one check and a 95th percentile of 7.1 ms on the fast tier and 8.9 ms on the 3-D
tier in another, so it is borderline; the whole update (compute, the panel's redraw and the curtain) took a 95th percentile of 18 ms on the fast tier and
33 ms on the 3-D tier (maximum 41 ms), so the limit is not met for the whole update (plan 18.3, item 18). A fix round then moved the panel's
repaint out of the update (`setData` only notes the slice and the repaint takes the next display frame, once however many slices came in
that frame, and nothing is drawn while the panel is covered) and made `niceTicks` count its candidate steps and keep its last eight answers
(it had built nine tick lists, about 250 us a call, twice for every repaint). Measured on the fast tier with the panel open at a 4x throttle
in software-rendered Chromium (150 line edits, three runs, not a phone): the synchronous update took a median of 4.2 to 4.5 ms and a 95th
percentile of 7.9 to 9.5 ms (before: 10.5 to 11.5 and 17.9 to 20.9), the repaint, now a frame of its own, a median of 3.3 to 4.4 ms and a
95th percentile of 8.4 to 10.4, and update plus repaint a 95th percentile of about 15 to 17 ms (before: 24 to 26). The repaint was moved,
not removed, so the plan's 8 ms is approached and not met for the whole update. The 3-D tier was measured once: 5.9 ms median and 12.6 ms
95th percentile for the synchronous update, against 12.7 and 22.3. The node test (`slice.perf.test.ts`) also logs the allocation: 35 bytes per `sampleSlice` into a
reused `SliceData`, about 6 kB of small result objects per update, a heap that changes by 32 kB over 3,000 updates, 2.6 bytes per
streak step.

**The oracle for slices** (`render/slice/sliceField.oracle.test.ts`): the slice's `along`, `across`, `up` and `speed` equal the engine's own
`sample()` rotated into the line's frame to 3e-6 m/s on lines across, along and oblique to a ridge, on both tiers; the other tests of
`sliceField` cover a uniform field (constant), a linear shear (exact), the validity mask, the sign conventions on a rotated line and their
inverse, units, the model's cells, and the preset geometry from fixtures with every issue.

**The curtain** (`render/crossSectionLayer.ts`, `crossSectionColour.ts`). It no longer samples the air itself: it takes the `SliceData` and
the effective field, uses the slice's own lattice as its texture (one texel per lattice point, row 0 the lowest, so nothing is
resampled in the shader), colours it with `sliceFieldScale(field)` (the same ramp as the panel and the legend), and draws the ground
from the 10 m terrain under each column. Cells outside the model are transparent; strong values are more opaque (wind chips are more
see-through at light winds so the ground behind shows). Its arrows keep reading the sampler (15 columns by six heights, 30 to 2,200 m above
the ground, through the sampler's boxed `wind(x, y, z, agl, out)`, not `windP`); the cyan arrows that mark air blowing against the main wind are drawn on the prognostic air only, and smoke greys the
other chips only where the air has smoke. `render/sliceFields.ts` is the one place that says which chips an air can give and why not (so
the scene, the Layers panel, the map legend and the Air slices panel never disagree): wind chips on any air with a wind, Temp and Smoke on
`airHas` of the field, with the reason in plain words and `action: 'use-3d'` where switching helps. It also holds the two small rules of the
Layers compass, `sectionCompass` and `sameLine` (below). **Colour ramps** (`render/palette.ts`):
a new diverging `ALONG_RAMP` (purple for negative, green for positive, pale at zero, mirror stops with the same luminance, so it reads in
grey), a log `SMOKE_RAMP` (four decades from 0.0001 to 1 of the model's own units, because the smoke of a young plume is about a
thousandth of a big fire's and a linear scale would show nothing), and `sliceFieldScale(field)`, which the curtain, the panel and
`sliceLegend(field, kind)` all read. `palette.test.ts` now also covers `THETA_RAMP` and `UPDRAFT_RAMP` with the Machado colour-vision
tests (they were not covered before); the measured numbers are in `docs/DESIGN.md`.

**The Layers compass** (`ui/screens/sim/layersPanel.ts`, `sectionCompass` in `render/sliceFields.ts`). The stored `LayerState.crossSection.azimuth`
and `centre` are the line's own only while the line follows the centre rule; with a line placed by the tool, or a preset, they are stale,
and the compass first read "Towards N 0" and, when turned, jumped the line to the stored centre (the origin, or the last ignition) instead of
turning it. Now `sectionCompass(cs, line)` gives the bearing and the middle of the line the scene really resolved (`SliceUpdate.resolved.line`:
a preset has no ends in the store; without it the placed A and B, else the stored values), the compass shows that bearing and follows it
when the line moves (a preset's line follows the wind and the fire), turning it writes `azimuth` and `centre` = the line's middle with
`LINE_BY_CENTRE` (so a, b and preset are cleared and the line becomes the longest chord through the middle, out to the model's edges), and
*Centre on the fire* keeps the bearing and writes the fire as the centre. The words in that panel say "slice" (*Colour the slice by*,
*Slice direction*, "Looking at the slice from the side."), and a hint above the compass says what turning it does; the diagnosed-wind note
(`DIAGNOSED_SECTION_NOTE`) still begins "This section shows". `sameLine(a, b)` says whether two states are the same line (azimuth, centre,
A, B, preset): `probeAfterLineChange` clears the tool's probe when the line changes from outside the tool, and `watchLineForProbe` (a
subscription made once by `simScreen.ts`, for the life of the sim screen) applies it to the compass, *Centre on the fire* and *Show me*;
the tool's own writes already clear it with the line.

**The tool** (`ui/screens/sim/sliceTool.ts` and friends, in the entry chunk; `ToolId` gained `'air'`, the Tools list "Air slices" with the
`line` icon). `sliceToolModel.ts` is a pure state machine over `SliceToolState` (`UiState.slice`, created the first time the tool opens;
tab, which end is being placed, a tapped `candidate`, a `draft` end waiting for the other, the probe, the "Show model cells" switch)
and holds every word of the tool; `sliceToolActions.ts` applies a step to the two stores and the scene in a fixed order (tool state, then
layers, then scene, so a callback from the scene finds the stores up to date); `sliceTool.ts` builds the buttons (*Set start (A)*, *Set end
(B)*, *Swap*, *Presets*, then *Place A here* and *Cancel* while placing) and the quiet note line, keeps focus where the person is, and
hands the controls element to the panel. `simScreen.ts` shows the crosshair while the tool is placing, treats a map tap during placing
as a `candidate` (the two-step confirm), draws the marks (`sliceA`, `sliceB`, the line, the probe's pin, re-projected per frame only while
the tool is open and there is something to show), and makes Back drop a placement first (`backFromAirTool`). A and B are written together
or not at all; re-placing one end of an existing line writes both (the other from the resolved line); every line write clears the probe,
the candidate and the draft and switches the section on. The 2-D map has no `slice` member, and the tool says "The side view needs the
3-D view." and loads nothing.

**The panel** (`slicePanel.ts`, `slicePanelModel.ts`, `sliceDraw.ts`; Canvas 2-D). `slicePanelModel.ts` and `sliceDraw.ts` are pure
or drawn against a stub context in tests; `slicePanel.ts` wires them to the elements. Layers drawn: the raster of the lattice (smoothed, or
the model's cells as nearest-neighbour blocks with their native values), the filled 10 m ground and the dashed model ground, axes, the
streaks (about 300 particles, at most 24 frames a second on any display, only while the panel is on screen and the page visible; fewer in a
small plot; a still arrow lattice under `prefersReducedMotion()`), the probe cross, the legend (`options.legend`, the scene's `sliceLegend`),
and the footer (kind · model grid · air from, with "(N min before the time shown)" past 90 s; "recorded air from" where the slice was read from the recording, 0.4.1). **The cap:** `flowTick(clock, tMs)` in
`slicePanelModel.ts` gathers the display's frame times and lets a streak frame through when 1/24 s less half a millisecond has passed, so a
60 Hz display draws 20 a second (every third frame) and 120 and 144 Hz draw 24. The first version's threshold was 1/24 s minus 8 ms, which
let a 144 Hz display draw about 29 a second (found by a verifier); a test runs 12 display rates from 30 to 360 Hz and, with a little
jitter, holds all of them to at most 24 a second. Height is drawn at the true scale times
the existing x1 to 3 *Vertical exaggeration* slider where that fits in the box, otherwise fitted to the box; the tag on the axis says the
ratio really drawn. **Streaks and the exaggeration:** the plan and the contract said to give `stepFlow` the on-screen ratio; the
panel gives it 1, because the ratio is already in the drawing (`yOfZ`), and passing it as well would count it twice and make streaks climb
`ratio` times steeper than the ground they follow (checked in `slicePanelFlow.test.ts`); `flowArrows`, which has no drawing to carry the
ratio, is given it. DOM text (chips, the readout, the footer) is 14 px or more and every control a 44 px target; the canvas carries only
axis labels and the scale tag at the caption size, as the weather chart does, and has a text alternative. The probe is tap or drag
(pointer capture, no touch-hover moves), arrow keys (one lattice step; a quarter of the axis with Shift), Escape clears; the readout is
`probeSentence` in a `.slice-readout` with a 44 px clear button. **Order of the parts** (it matters on a small screen): the picture, the probe's reading, the
chips, the legend and the tool's controls, then the notes of the chips that are off with the *Use the 3-D atmosphere* button first, the
*Show model cells* switch, the scale caption and the footer. While some chip is off (the fast tier) the legend moves behind the notes
(`arrange`), so *Set start* and *Presets* stay near the chips; the 3-D button is then a scroll away, and a tap on a chip that is off scrolls
to its reason and the button. In short landscape (`orientation: landscape` and `max-height: 540px`) the picture (84 px, as wide as the panel)
is pinned at the top and a one-line footer at the bottom, the reading, chips and controls scroll between them (the reading was pinned with the
picture before and covered the window) and the footer is hidden while a reading is shown. The tool scrolls the body back to the picture when the first line is placed
or a preset is chosen (the panel's own focus does not scroll), and in short landscape when a probe is placed, so the reading is right under it. The canvas is as tall as its picture needs (`naturalBoxHeight`, set as `--slice-h`, at most `clamp(180px, 27vh,
230px)`; 128 px while there is no slice), so a long line at true scale leaves no blank band above it. **The repaint:** `setData` only keeps
the slice and asks for the next display frame; the layout, the words, the picture and the probe's reading are redone once per frame
however many slices came in it (`catchUp`), and not at all while the panel is covered (`setActive(false)`: the next `setActive(true)` catches
up). Any call that needs the new picture (a probe move, a chip) catches up first, so the new air is never painted into the old layout.
The panel never touches the scene, the layers or the session: the tool
passes each `SliceUpdate` in with `setData` and takes events out through the option callbacks (`onField`, `onProbe`, `onShowCells`,
`onUse3d`); a chip tap writes `crossSection.field`, so the curtain follows.

**The lazy chunk.** The panel, its drawing, `flow2d`, `probe`, `niceTicks`, the lattice reader and `slice.css` load as one dynamic chunk,
requested only when the Air slices tool first opens (`sliceToolLoad.ts` is the one `import('./slicePanel')`; a test asserts no
request at start-up), with a "Loading the side view" line, and a "The side view could not be loaded." line with *Try again* if it fails
(the controls still work, since the curtain draws without the panel). A failed retry says "The side view could not be loaded. Close and
reopen FireSim to load it." and puts the button away (`loadFailedView(failures)`): a browser remembers a module that failed to load and
fails the same import again, so on the web a second try cannot recover (plan 17.4). The entry chunk holds the tool's shell, its model, the
scene glue and the registration; `slice.css` is 4,024 bytes of source (cap 4,096) and is not imported by `main.css`. Sizes of the chunk, of the entry's
growth and of the chunk the build splits `explain/text.ts` into (`probe.ts` is the only main-thread module that imports it, and the
in-thread engine's chunk holds it too, so the build shares it as a chunk of its own: a size the lane reported as about 12 kB gzip, to be
re-read): 12.1 kB gzip in the release build (*Performance budgets*, below). Budgets in `scripts/check-bundle.mjs` did not change.

**Tests.** Pure, in node: `airView.oracle`, `airView.perf`, `airView.sim`, `atmosphereSampler`, `snapshotStore.air`, `memoryModel` (the
keyframe rows), `core/airView`, `core/airPack` (the 16-bit wind copy and its bound), `snapshotStore.fast6h.sim` (the 6 hour table of the
history at the budgets of weak phones; run on its own, it prints the table), `render/slice/*` (`contract`, `lattice`, `niceTicks`, `flow2d`, `probe`, `sectionLine`, `presetWind`, `sliceField`,
`sliceField.oracle`, `slice.perf`, `sliceUpdater`), `render/sliceFields`, `crossSectionColour`, `crossSectionLayer`, `smokePuffs`, `palette`
and `legends` (the new ramps, colour vision and legends), `layerCatalog`, `ui/screens/sim/slicePanelModel`, `sliceDraw`,
`slicePanelFlow`, `sliceToolModel`, `sliceToolActions`, `mapLegend` and `context`; `ui/content.test.ts` pins the Help and Glossary entries to
the words the code uses. Real app, Playwright: `e2e/air-view.spec.ts`, `air-tool.spec.ts`, `airslice-panel.spec.ts`, `air-slice.spec.ts` (the three together, 5 tests) and `air-curtain-gpu.spec.ts` (no GPU object leaks), plus changes to
`app.spec.ts` (the slice's note and the tier switch) and `robustness.spec.ts`.

### The Air slice recorder (0.4.1)

The time-lapse recorder of a pinned Air slice line (plan section 8.6, decision D7; what was built, and the corrections to the design, are in plan
section 19). It keeps the slice of ONE hand-placed line at the pictures the simulation makes, so the side view can show the air of the time shown
and not the older saved air a composed picture carries (the footer's "N min before the time shown", above). It reads the air and never feeds
back into the simulation: no module of the simulation imports it, and a test hashes every snapshot of a real run on each tier with and without
a recorder in the snapshot hook (equal; `render/slice/sliceTimeLapse.test.ts`).

| File | What it holds | Chunk |
|---|---|---|
| `core/sliceRecording.ts` | the packing (`packField`, `unpackField`; smoke as a log code, `packSmoke`, `unpackSmoke`), the byte model (`sliceSampleBytes`, `SLICE_SAMPLE_FIXED_BYTES` = 96), the error bound (`sliceFieldErrorBound`) and the budget (`sliceRecorderBudgetBytes`, `SLICE_RECORDER_MAX_BYTES` = 12 MiB) | pure; its budget functions are used by `scenario/memoryModel.ts` and `ui/modelInfo.ts`, so the build makes it a shared chunk (0.8 kB gzip) |
| `render/slice/sliceRecorder.ts` | `SliceRecorder` and `sliceLineKey`: the epoch (the line and its lattice, with the parts that never change from sample to sample), the samples, `setLine`, `arrive`, `store`, `read`, `truncateAfter`, `truncateFrom`, `clear`, `reset`, `setBudget`, `status` | pure, the render chunk |
| `render/slice/sliceTimeLapse.ts` | `createSliceTimeLapse(host)`: the scene's half. It is the `SliceRecordingApi` the session uses (`record`, `truncateAfter`, `clear`, `status`, `setHistoryBudget`), the `SliceRecordingReader` the slice updater asks (`read`), and has `follow(resolved)` and `reset()` for the scene only | the render chunk |
| `render/slice/types.ts`, `render/api.ts` | the contract, appended before the lanes began: `SliceRecordingStatus`, `SliceRecordingReader`, `SliceRecordingApi`, `RecordingState`, `RecordingDrop`, `SliceData.recordedAt?`, `SliceInputs.recording?`, `SliceUpdate.recording?`, `SceneViewApi.sliceRecording?`. `setHistoryBudget?` was added to `SliceRecordingApi` while building, as an optional member | types |
| `render/SceneView.ts` | `readonly sliceRecording = createSliceTimeLapse({...})` (the host reads the layer state, the 10 m ground as received and 12 MiB until the session says otherwise), `recording` in `sliceInputs()`, `follow()` and `status()` in `applySlice`, `reset()` in `dropSlice` and `dispose`: about 18 lines | the render chunk |
| `render/slice/sliceUpdater.ts`, `lattice.ts`, `crossSectionLayer.ts` | the read path (below), and the curtain's arrows of a recorded slice read its lattice (`latticeInPlaneWind`, `upperAlongMean`) | `lattice.ts` is a shared chunk of 0.7 kB gzip (the curtain and the panel read it) |
| `ui/session.ts` | `cutHistory(t)`, the feed (`record` after the store has the picture), `clear()` on `dispose`, `setHistoryBudget` at construction | the entry |
| `ui/recordingWords.ts` | every sentence about the recording (spacing, span, drop reasons, "not recorded" reasons, waiting, failed, earlier, no cells), pure, shared by the panel's status line and the statistics row | a small shared chunk |
| `ui/screens/sim/sliceTool*.ts`, `slicePanel.ts`, `slicePanelModel.ts`, `sliceDraw.ts` | *Keep this line* (`keepLine`) and *Clear recording* (`clearRecording`), the status line (`recordingLine`, `focusRecording`), the footer's "recorded air" (`airFromText`, `footerCacheKey`) and the note under *Show model cells* (`cellsNote`) | the tool in the entry, the panel in its lazy chunk |
| `ui/debugStats.ts`, `ui/screens/debugStats.ts`, `ui/modelInfo.ts`, `scenario/memoryModel.ts`, `ui/screens/sim/layersPanel.ts` | the statistics row, the model card's note, the Data sets memory note (no new row, so no total changes), the two Layers sentences | |

*Feeding it.* `SimSession.onSnapshot` calls `view.sliceRecording?.record(snap)` after the store has the picture, for every picture the worker makes: it is
not fed from `SceneView.update`, which sees only the composed, rounded picture on screen. `record` does nothing for a slice that is off
(it resets the recorder), takes the line from the layer state (a live preset or the Layers chord is not recorded: `offFor` says which), resolves
a hand-placed line with `sectionFromEndpoints` on the picture's atmosphere grid (its fire grid when it has none), tags it with `sliceLineKey` (both ends to 0.1 m), asks the
recorder's `arrive(t)` (which first drops every sample at or after `t`, as `SnapshotStore.push` does, and then says whether a sample is wanted:
the first, or one at least the gap after the newest) and, when one is wanted, samples the slice with the existing `sampleSlice` into a reused
scratch slice (the 10 m ground as received, a fresh `AtmosphereSampler` of the picture's air) and `store`s it packed. The whole body is in a
`try`: a failure (a sampler that throws) stops the recording for that line with `state: 'failed'`, logs nothing (the e2e console guard counts every
console message), is never rethrown into `onSnapshot`, and another line tries again. A picture with no 3-D wind yet (the fast tier before it
publishes) stores nothing and fails nothing. `follow(resolved)`, called from `SceneView.applySlice`, applies a change of line at once, even while
paused, when the next picture may be minutes away.

*What an epoch is, and a sample.* The epoch is one line on one lattice: `valid`, the 10 m `ground`, the `modelGround`, the height axis and the cell
size, made once from the first sample (5,772 B at 90 x 54). A sample whose lattice differs (another number of columns or rows; `zMin`, `zMax`, `topAsl` or the cell size
more than 0.01 m off; the model ground more than 0.5 m off in any column) starts a new epoch with `dropped: 'model'`; the standard and the fast tier share one
atmosphere grid (`ATMOS_TIERS`: both `nTier` 45, 20 levels), so a switch between them keeps it, and the High tier (60 cells) does not. A sample is
`Int16Array` `[along | across | up]` and, with the 3-D air, `[theta | smoke]` (`columns x rows` each, row 0 the lowest, the index of `SliceData`), a
`Float32Array(4)` of scales, its time, the air's time and its kind; `bytes` = the integers + 96. Along, across, up and theta are
`q = round(f / s)` with `s = max|f| / 32767` (the `airPack.ts` rule, bound `0.502 s`: 0.00046 m/s at 30 m/s, 0.0003 K at 20 K); the speed is not
stored (`hypot(along, across)`: the pair is the wind turned by a unit vector, so the error is at most the hypot of the two bounds, 0.00065 m/s at 30 m/s);
smoke is `0` below 1e-6, else `1 + round((log10 s + 6) / 9 x 32766)`, a relative error of at most 3.3e-4 up to 1e3 (above it is clamped) where a linear code
would put the 1e-4 end on three steps. A value that is not finite is stored as 0. The model's own cells are not recorded (only *Show model cells* needs them); a recorded slice has `cells = null` and the panel says why. The samples are tagged with their `kind`, so the recording crosses a
tier switch and `read` never mixes the two kinds on screen.

*Sizes.* Computed with the real functions (a throwaway test, and `[recorder bytes]` in `sliceRecorder.perf.test.ts` for the first row):

| Line (lattice) | 3-D air, bytes a sample / fit in 12 MiB / in 6 MiB | Fast tier |
|---|---|---|
| 6 km line on the 133 m grid, 90 x 54 | 48,696 / 258 / 129 | 29,256 / 429 / 214 |
| The longest line on the standard or fast tier, 127 x 56 | 71,216 / 176 / 88 | 42,768 / 294 / 146 |
| The longest on the High tier, 170 x 56 | 95,296 / 131 / 65 | 57,216 / 219 / 109 |
| The shortest, 48 x 48 | 23,136 / 543 / 271 | 13,920 / 903 / 451 |

The design file sized the worst case at 192 x 56 (107,616 B, 116 samples). It cannot occur: a lattice has one column for each half model cell of the line,
the model cell is `clamp(extent / nTier, 100, 270)` m, and the longest line is the model's diagonal, so the columns are at most `2 sqrt(2) nTier`:
127 on the standard and fast tiers and 170 on the High tier, whatever the area (3, 6 or 9 km). The perf test keeps the 192 x 56 case as a harsher bound.

*The one place the history is cut.* The history (`SnapshotStore`) and the recorder keep the same time order:

```ts
/** The one place history is cut: the store and the Air slice recorder keep the same time order. Keeps everything at or before t. */
private cutHistory(t: number): void { this.snapshots.truncateAfter(t); this.view.sliceRecording?.truncateAfter(t); }
```

| Site in `session.ts` | `cutHistory` is given | What it cuts |
|---|---|---|
| `prepareEditAt` (an edit made in the past) | the view time, only when it is before the head | the future of an edit |
| `rerunWith` (a what-if) | the view time | the old run after the what-if starts |
| `rerunFromView` (`setSolverStep`) | the view time | after a solver-step change |
| `removeIgnition` | the ignition's own time, only when it is before the head (it can be well before the view time) | everything after the removed ignition |
| `onRewound` (the worker restored a checkpoint) | the later of the checkpoint and the view time, or the checkpoint alone after `removeIgnition` | stale results; nothing when its early return applies |

A tier switch is not a site: the worker restores a checkpoint, says `rewound` (the last row) and sends every picture after it again, so the first one
re-emitted drops the stale samples by time order (`SnapshotStore.push` to `truncateFrom`, `SliceRecorder.arrive` to `truncateFrom`). A source-audit test
(`session.recorder.test.ts`) holds `session.ts` to exactly one `snapshots.truncate` call, inside `cutHistory`. `session.recorder.sim.test.ts` puts the
recorder behind a real session on the real engine, with the worker's messages delayed, and after each of the operations above (and a tier switch)
the recorder holds the pictures of the history that is left, with the content of that run, to the packing bound.

*The read path* (`SliceUpdater.compute`, the scene passes `recording` in `SliceInputs`). After `resolveSlice` gives a line, the updater asks
`recording.read(line, shownTime, kind, sampler.airTime, held)` (in a `try`: a reader that throws leaves the live slice, which is never lost to the
recorder). `SliceRecorder.read` answers only when `sliceLineKey(line)` is the recorder's key, the newest sample at or before `shownTime` (a binary
search) has the asked kind, and its time is more than 0.5 s newer than the air the picture itself carries (`pictureAirTime`, the sampler's `airTime`);
it refills `held` in place when it has the lattice, with `recordedAt` set, `cells = null`, `kind`, `airTime` and `shownTime`. Anything else is the
0.4.0 path, and after a `sampleSlice` into a reused object the updater clears `recordedAt`, so a live slice never keeps the tag. Hence the real
newest picture of a run (whose air is its own) stays live and exact, and a composed picture whose keyframe air is older takes the recorded air. The
probe, the streaks, the legend and the chips read `SliceData` and need nothing; the curtain's arrows read the sampler for the picture's air, which a
recorded slice does not have, so for `recordedAt` they read the lattice (`LatticeStencil`, validity-weighted, at the same 15 columns by six heights;
they equal the sampler's wind at the lattice nodes to within 1e-3 m/s and within 0.05 m/s between nodes at the heights the arrows use, `lattice.test.ts`) and the reverse-flow reference is the mean along-line wind at the
highest valid cell of each column (`upperAlongMean`).

*Thinning* is uniform and never oldest-first. `store` thins (`fit`) while the recording is over its budget: `thin()` keeps position 0 and every
second sample after it, and the newest; when the newest sits at an odd position it takes the place of the last one kept; with two samples left the
first goes. The gap that `arrive` asks for starts at 0 and, at the first thinning, becomes twice the **median** spacing of the stored pictures (twice
the least let one picture a few seconds after another, the run-end picture of a pause, make the status say "about every 5 s" of pictures 2 minutes
apart, and every later thinning doubled the gap and the spacing alike); every later thinning doubles it. `spread()` then removes the later of any pair the
halving left closer than the gap (the earlier when the later is the newest), so no two samples are ever closer than the gap. The stored times are a subset of the arrival times; the first and the newest always stay; with one sample over the budget
nothing is held. The arrays of dropped samples go to a free list by length and are reused by the next sample of that size (held to what the budget
has room for: `bytes` counts the live samples and the epoch, not the free list), so a steady stream allocates no arrays. Why uniform: the recorder replays how
the air changed since the line was placed, an even spacing gives one number to say, bounds the age of any read by it and is easy to test; the history
already keeps the recent past fine. The price: the newest minutes are no finer than the old ones.

*Budget and memory.* `sliceRecorderBudgetBytes(historyBytes)` = `min(12 MiB, round(historyBytes / 8))`: 6 MiB at the history's 48 MiB floor, 7.7 MiB at
61.4, 12 MiB from 96 MiB (a 1.6 GB phone), on top of the history. The history is not changed (`snapshotStore.ts` has no diff, and a test in
`memoryModel.test.ts` holds the `snapshots` item at 48, 61.44 and 122.88 MiB): scrubbing back keeps the same number of pictures as in 0.4.0. Had the
12 MiB come out of the history instead, the design scout's synthetic replay of the real `SnapshotStore` (a 6 h run at a 60 s step, 40,000 fire
cells; not run again by the docs lane) gave the mean number of keyframes kept over the last hour as 44.5 down to 29.0 on the fast tier at a 48 MiB
history (-35 %) and 28.5 down to 19.5 on the standard tier at 61.4 MiB (-32 %), which is why the recorder has its own budget. The session passes the history's budget on at construction (`setHistoryBudget`, which calls
`SliceRecorder.setBudget` and thins at once if the recording is over). `memoryModel.ts` re-exports `sliceRecorderBudgetBytes`, has
`sliceSampleBytesModel(columns, rows, tier)` and appends ONE note to `notes` ("An Air slices recording adds up to 6.3 MB while a line is recorded; it
is not in the figures above." at the floor; it is never `notes[0]`, which `memoryModel.test.ts` pins), and no item, so no total moves. The statistics
screen's Memory group has the row `slice-recording` ("Air slice recording": Off, Waiting, "N slices, X of Y", Stopped) and the model card's
"This phone" note adds "an Air slices recording adds up to 6.3 MB on top of it"; both use the recorder's own rule, and a test holds the two to the
budget the recorder really keeps. The statistics row counts live samples, and the free list's arrays are not in it (a verifier saw 12.4 MB held while the
row said 6.7 MB; never over the budget).

*What it costs* (node, one run each, `npx vitest run src/render/slice/sliceRecorder.perf.test.ts`): `arrive` + sample + `store` of a picture on a 90 x 54 lattice a
median of 0.95 ms and a 95th percentile of 1.23 ms on the 3-D air (the sampling alone median 0.73 ms), 0.63 and 0.71 ms on the fast tier; a `read` p95 0.065 and
0.036 ms; the store that thins a median of 0.25 ms; the whole `record(snapshot)` path on 96 x 56 a median of 1.00 ms and p95 1.31 ms (the design's limit 1.5);
3,000 arrivals with thinning and a replay among them changed the heap by 70.7 kB (the test allows 256 kB), at 12 MiB (3-D air) and 6 MiB (fast tier). The
192 x 56 case (which cannot occur) is 1.91 and 2.18 ms. In a real browser in software rendering under a 4x CPU throttle at Max speed on a 6 km line (a verifier's
measurement, not repeated by the docs lane) `record()` took a median of 3.8 ms and p95 13.2 ms (maximum 22 ms) on the fast tier, at 14 pictures a second (a mean 6.7 % of the
time, worst second 132 ms), and a median of 4.7 ms and p95 11.1 ms (maximum 29 ms) on the 3-D tier, at 5 a second (2.7 %): the highest load is in the first 20
to 50 seconds after *Keep this line* and it falls as thinning halves the rate at which pictures are stored; a single call can exceed a frame at 60 frames a second;
with the slice off or a preset a call is 0.03 to 0.1 ms and nothing is stored. Nothing was measured on a phone. If frame drops show up, the next step is to sample
in idle time or to cap the pictures stored per wall second.

*Tests.* Pure, in node: `core/sliceRecording` (each field's round trip within `0.502 s`, smoke's relative bound, zero stays zero, non-finite is 0,
the byte model, the budget function at 48, 61.44, 96 and 160 MiB, the capacity row), `render/slice/sliceRecorder` (against a live `sampleSlice` at 90 x 54, every field
to the packing bound with the derived speed within the hypot bound and the flags identical; the read rule: the other key, the other kind, a picture air equal or newer;
`arrive` and `truncateAfter`; thinning over 2,000 arrivals with a mid-run step change, bytes within the budget after every store, spacing at least the gap, the median
gap with a pause's run-end picture; the drops; random arrivals, replays, cuts and budget changes), `sliceRecorder.perf` (above), `sliceTimeLapse` (which lines are
recorded, `follow`, failure inside the recorder, determinism on both tiers on a real run, the standard to fast switch keeping the lattice and the High tier not),
`sliceUpdater` and `lattice` (the read path and the arrows), `ui/recordingWords`, `slicePanelModel`, `sliceToolModel`, `sliceToolActions`, `sliceDraw`, `debugStats`,
`modelInfo`, `memoryModel`, `ui/session.recorder` (the five sites, the source audit, time order, dispose) and `session.recorder.sim` (the real engine behind a real
session). Real app, Playwright: `e2e/air-slice.spec.ts` (two tests, one for each tier: a preset says why it is not recorded, *Keep this line*, the recorder fills,
scrubbed pictures read it back, a time before it does not, *Swap* drops it, *Clear recording* empties it, switching the slice off clears it, a tap audit of the
tool), the determinism test of `e2e/robustness.spec.ts` (run B records), and `e2e/gallery.spec.ts` for picture 36.

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
  setViewMode('orbit' | 'top' | 'ground'): void;  setUserLocation(x, y, headingDeg?): void;  readonly gliding: boolean;   // a flick still glides
  setViewInsets({ top, right, bottom, left }): void;   // covered screen areas: fly-to targets land in the rest
  zoomBy(factor): void;  readonly heading: number;  setHeading(deg): void;   // zoom / compass buttons
  cameraState(): { target: [x, y]; distance; azimuthDeg; polarDeg; headingDeg; mode };   // the camera as numbers (tests, debug)
  viewSection?(animate?): void;                        // side-on view of the cross-section (3-D view only); flies to the resolved line
  slice?(): SliceUpdate | null;                        // the air slice the scene computed for LayerState.crossSection, shared by the curtain and the side-view panel (3-D view only)
  onSlice?(cb: (update: SliceUpdate | null) => void): () => void;   // after every new slice, and with null when the section is switched off; returns the unsubscribe
  sliceRecording?: SliceRecordingApi;                  // the Air slice's time-lapse recorder (0.4.1): record(snap), truncateAfter(t), clear(), status(), setHistoryBudget?(bytes); the session feeds and cuts it, the tool's Clear recording and the statistics screen call clear() and status() (3-D view only)
  setNightLook?(look: 'realistic' | 'brighter' | 'daylight'): void;  readonly nightLook?: NightLook;   // map lighting after dark, uniforms only (3-D view only)
  readonly qualityInfo?: QualityInfo;                  // the picture tier, how it was chosen and what it sets (3-D view only)
  frameStats?(): FrameStatsInfo | null;                // frame rate, slow frames, draw calls, pixel ratio: the debug statistics (3-D view only)
  terrainStats?(): TerrainDrawStats | null;            // what the cliff drawing built for this scenario; null when nothing was sharpened (3-D view only)
  pickMarker?(clientX, clientY): MapMarker | null;     // the icon under a screen position (22 px, homes 14 px), or null; the 2-D map has it too
  setBrushPreview(p | null): void;  setInteractionEnabled(on): void;  stats(); resize(); dispose();
}
// ui/modules.ts: createSceneView(container, opts?: { quality?: 'low' | 'medium' | 'high' }): SceneViewApi   (see Picture quality below)
```
The members marked optional are absent from the 2-D mock (`ui/mockScene.ts`, which has only `pickMarker`) and from hand-written fakes, so the UI
checks for them: the Night lighting row is left out, and the statistics' display group says "Not available", where the view lacks them.
* The terrain mesh is built from `ScenarioData.terrainHiRes` (the 10 m DEM) when present, decimated to the quality
  budget (224 / 320 / 400 samples per side: cells of 40.3 / 28.2 / 22.5 m for a 9 km area), so the ground is finer than the 30 m
  fire grid; fuel, fire and overlays are draped from the fire grid. Since 0.3.0 the mesh is made from a **sharpened copy** of that
  DEM and keeps an edge (`decimateTerrain`), so a cliff is a wall and no longer the blurred ramp it was: under 40 degrees it is
  exactly what `decimateGrid` gave, and a scenario without a 10 m terrain takes the old path unchanged. A face under about 60 m
  high is still a ramp on a 22 or 40 m mesh (the mesh's resolution limit). See *The cliff drawing* below.
* **Camera and gestures** (`cameraRig.ts`, `groundPan.ts`, `panGesture.ts`). Orbit and top view, on a phone:
  **one finger** = displace the view, **two fingers** = turn / tilt (the midpoint's drag) and zoom (the change of their
  spacing) at the same time; eye level is a first-person look-around (one or two fingers turn the view, the eye cannot be
  displaced); the mouse keeps left = pan, right = rotate, middle / wheel = zoom.
  * *The one-finger pan is a grab, not OrbitControls' pan.* `PanGesture` tracks touch / pen pointers with its own listeners
    on the canvas (registered before OrbitControls', capture phase) and `GroundGrab` keeps the ground point that was under the
    finger under it: the ray through the finger is cut with the heightfield (`HeightField.raycast`, ≤ 4 camera–target
    distances; else the horizontal plane through the target; else a view-plane drag at the target distance when the finger is
    above the horizon), and each frame the camera and the target are translated over the ground by the amount that puts
    that ray back through the grabbed point (one ray / plane cut, exact for any tilt, field of view and view inset because
    the NDC position comes from the canvas rect and the camera's own projection). OrbitControls' screen-delta pan moves the
    ground at ~62 % of the finger speed at the default 52° tilt. The pan is applied in `CameraRig.update` (once per frame,
    after OrbitControls' update, before the clamps), so a rotation that is still damping does not pull the ground from under a
    resting finger; `clamp()` still keeps the target inside the domain, and a finger that goes on pushing against the edge
    re-grabs where it is (`PanGesture.settle`, fed with how far the camera really moved), so that turning back is followed at once.
    *Nothing runs away near the horizon* (`PAN.MAX_SPEEDUP`, 5): flat ground through the target covers (sin of the view axis'
    angle to the ground ÷ sin of the ray's)² times as much per pixel as the ground at the target, which is hundreds of
    times at a flat angle (a few pixels of drag would throw the camera across the domain), so a finger ray is steepened to the
    line where that reaches 5× (`GroundGrab.steepen`; at the default 52° tilt that is above the top of the canvas, at 70° it is
    a quarter of the way down, at 80° just under the horizon). A finger that lands above that line drags from it (its offset is
    kept), so there is no dead zone going down, and nothing happens when it goes on up. Far terrain that would still be too
    fast is held nearer (`limitSpeedup`).
  * *The target and the terrain* (`CameraRig.settleTarget`, `SEAT` in `cameraRig.ts`). The orbit target should lie on the ground
    under the middle of the screen (it is the pivot of a rotation and the zoom distance); it is eased onto the terrain, 25 % of
    what is left per frame, in one of two ways. *Translating the whole rig* up or down keeps the distance but shifts the picture
    by the same amount, and while a finger holds the ground at a flat angle that is a feedback loop: the grab moves the camera
    sideways to keep the ground under the finger (1 / tan of the angle at which the finger's ray meets the ground: ×3 to ×10 on
    a mountain side, per metre of height), which changes the ground height under the target, which changes the height again (the
    view flip-flops or runs away: ±40 px per frame at 70° over Katoomba's cliffs; on the 10 m DEM some drags step against the
    previous step from 45°, dozens of times at 70°). Freezing the height while a finger drags and translating the rig after the
    lift only moves that shift to the lift, where it shows as the picture creeping (median 7 to 32 px, 90th percentile 44 to 367
    px, worst 684 px for 100–400 px drags at 30–75° on Katoomba). So from 22.5° polar angle up the camera never moves for
    the terrain: the target *slides along the line of sight* to the camera onto the first surface that line meets (`slideTarget`:
    `HeightField.raycast` from the CAMERA along the line, within the distance limits; at most 4 % of the distance per frame so
    that a cliff crossing the middle of the screen is no pop; a line that meets no terrain leaves the target where it is). The
    surface is looked for from the camera, not from the target: a march over a band of distances around the target found a
    grazing ridge from some distances and the ground behind it from others, so on rugged ground the target swung between the
    two for ever (`update()` never went quiet and the distance oscillated by up to 8 %: one settled view in 60 to 100 at
    60–80°). The picture does not change by a pixel; the orbit distance does. Below 22.5° (near plan: the grab is steep, the loop
    gain small, and a vertical translation hardly shifts the picture) the whole rig follows the terrain, so the map keeps its
    scale. The two are never mixed: where the line of sight grazes a ridge a small vertical move of the rig decides which surface
    the line meets, so a rig that follows the ground under the target while the target slides to the surface the line meets is a
    loop through a discontinuity (a smoothstep mix between 15° and 30° swung slowly to and fro in about one view in 2 500).
    Measured with `cameraRig.relief.measure.test.ts` (Katoomba's
    10 m DEM, 6 places × 8 directions × 100–400 px drags, finger 50 px/s, 1 000 m and 3 000 m from the target): creep after the
    lift 0.0 px at 30–75° (≤ 1.5 px when the target reached the domain edge, 7.9 px in one of the 7 drags at 75°, 1 000 m, whose
    camera had flown into the terrain, which the clearance clamp holds up), no flip-flop at any tilt (in the drags that stayed clear of
    the domain edge and the ground), the camera's path as straight as when holding the height. The price is the scale: the camera keeps its height above the sea, so over a 100–400 px
    slide at 52° the distance changes by −10 % to +20 % (10th to 90th percentile; −17 % to +59 % worst; measured in the real
    app with real multi-touch, 381 drags, creep 0.1 px at worst), 0 % below 22.5° and in the top view. `cameraState().target` is
    therefore the ground under the middle of the screen, which can still settle by metres for about half a second after the
    camera has stopped (tests that ask "did the view move" read the camera).
  * *Inertia.* The finger velocity (smoothed over 50 ms from the translations actually achieved each frame) decays with a
    250 ms time constant after the lift, only if the finger was moving faster than 150 px/s (capped at 3000 px/s, so a flick
    glides at most ~750 px; `PAN` in `groundPan.ts`). The exact integral is used per frame, so the distance does not depend on
    the frame rate. Any new touch, a flight (`goTo`), a mode change, interaction off, disposal, a wheel turn, the domain
    edge or frames that stopped for half a second (a screen covered the map, the page was hidden) ends it; `update()` keeps
    reporting motion while it runs, so the on-demand renderer keeps drawing. A touch that stops a glide is not a map tap
    (`SceneViewApi.gliding`, read by the tap detector of `simScreen.ts` when the finger goes down), and neither is a finger that
    wandered more than 12 px and came back.
  * *Two fingers* are OrbitControls' `TOUCH.DOLLY_ROTATE` (`touches = { ONE: null, TWO: DOLLY_ROTATE }`), which pinches and
    turns in the same update, with no lock and no threshold, zooming towards the midpoint (`zoomToCursor`). `GESTURE` in
    `cameraRig.ts`: `zoomSpeed` 1 (a pinch is exactly 1 : 1: spacing × 2 = distance ÷ 2) and `rotateSpeed` 2/3 (OrbitControls turns
    2π · rotateSpeed per screen height of drag: one full turn per 1.5 heights, 30° per 100 px on an 800 px canvas; the former
    0.6 took 1.67). Measured with real touch: the target of a pure two-finger drag moves ~1.5 px per 80 px dragged (the zoom
    step each finger event triggers leaves a small residue).
  * *Transitions.* One finger → two: the pan ends without glide and OrbitControls takes over (its baselines are the fingers'
    current positions: no jump). Two → one: the finger that is left is re-grabbed where it is (no jump) and OrbitControls
    drops to its idle one-finger state. A third finger and every finger after it are ignored: `PanGesture` stops their pointer
    events before OrbitControls would see them (it would end the two-finger gesture), so the first two carry on. A pen is
    handled like a finger and hidden from OrbitControls (which takes it for a mouse); it is captured on the canvas while it is
    down, because the browser captures a finger by itself but not a pen (a stroke that leaves the canvas would lose its end).
    The state machine is idle → pan → multi
    → pan → idle; cancel (`pointercancel`, `lostpointercapture`), a flight, interaction off (finger drawing) and a mode change
    end a drag (a mode change also ends OrbitControls' own gesture, so a finger that was looking around at eye level does not
    carry on rotating the new view), a stale finger is forgotten when a new first finger arrives (`isPrimary`), a press of a
    pointer that is still tracked starts afresh and a canvas that changes shape under a dragging finger (the phone is turned)
    grabs again where the finger is.
  * `SceneViewApi.cameraState()` returns the camera as numbers (target in local metres, distance, azimuth, tilt, heading,
    mode); `cameraRig.gestures.test.ts` drives the real rig with a fake element, `groundPan.test.ts` tests the maths and
    `e2e/gestures.spec.ts` checks all of it with real multi-touch (CDP `Input.dispatchTouchEvent`).
* View insets use `camera.setViewOffset` with a widened field of view: the canvas keeps its angular size and the
  optical centre moves to the middle of the unobscured area (animated). The UI centres its crosshair there.
* Aerial imagery: `src/data` locates it and computes the window (`loadDemoImageryInfo`, `imageryWindow`); the UI
  (`ui/imagery.ts`) crops it for the domain from the named demo site or any demo site that covers it.
* Snapshot overlays: `SimSnapshot.layers` ('vls', 'attach', 'trench', 'dmz', 'landing') on the fire grid.
* Wind particles use a cool palette (grey-blue → white → cyan → blue → violet) so they never read as fire.
* Legends: `legendFor(overlay)`, `sliceLegend(field, kind)` (`crossSectionLegend()` stays as a wrapper for the dev pages), `windLegend(mode)`; the UI shows them in the Layers panel
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
  the 10 m surface winds of the air view; a snapshot overlay; since 0.4.0 it is available on any picture that carries a 3-D wind, so
  also on the fast tier, where the 10 m wind is the diagnosed fit's). The elevation ramp stretches over the site's height range: pass the same
  `LegendContext.elevationRange` to `overlayScale` and `legendFor` (`SceneView.legend()` does; without a range the legend
  only says "lowest … highest").
* `layerCatalog.ts` is the one description of every layer (`LAYER_GROUPS`, `LAYER_CATALOG`): plain title, what it shows,
  why it matters, scene / heat / both, the LayerState key or OverlayKind, `available(ctx)` with a plain reason
  ("Needs a fire: mark one first"), data source and resolution as functions of the scenario, and its dimension. The Layers
  panel and the model card are built from it; `layerCatalog.test.ts` fails when a LayerState key or an OverlayKind is
  added without an entry. `sceneLayerOn` / `sceneLayerPatch` read and write the switches, `availabilityContext(...)`
  builds the availability flags from the fuel map, snapshot and context. `legendGallery.html` (dev page) shows every
  legend chip and catalog row in both themes (`?cvd=deutan` for colour blindness).
* **Night map lighting** (`render/sky.ts`, `SceneView.applyLighting`). `mapLighting(real, look, realSunDir)` (pure) returns the
  lighting the map is drawn with. With the look Realistic, or the real sun at 8 degrees or more, it is the real lighting itself (the
  same objects, no arithmetic). As the sun sets (from +8 to -2 degrees, a smoothstep) the weight `w = NIGHT_LOOK_MIX[look] x smoothstep`
  (Realistic 0, Brighter 0.3, Daylight 1) blends the real lighting towards that of a fixed sun, north-west (azimuth 315 degrees) and
  30 degrees up (`MAP_SUN`, with no cloud and no smoke, because seeing the ground is the point). The sun direction is weighted by the
  light each sun carries (a sun below the horizon carries none, so at night every look is lit from the fixed sun whatever the real
  azimuth does), the sun's light and the ambient are blended as colour times intensity, and the exposure as it is. `applyLighting`
  writes the result to the shared uniforms the map shaders already read (ground, photo, trees, roads, labels). **The uniforms are
  split:** `uNight` stays the real night (flames, the fire's light on smoke, lit windows, stars, the fog colour); a new `uMapNight`
  (the real night x (1 - w)) serves what dims the map (roads, labels, tree moonlight); `uShadowGain` (1 - w) scales the terrain's
  cast shadows, which keep following the real sun; the sky dome and the smoke body get their own sun, ambient and exposure uniforms
  from the real lighting, so a lit map never paints a sun disc into a night sky. A change of look is uniforms only
  (`SceneViewApi.setNightLook` invalidates the sun key): no rebuild, no pause. It is a view setting like Plain, stored as
  `LayerPrefs.nightLook` (`ui/screens/sim/layersPrefs.ts`; the prefs version stays 1) and reset by "Reset layers". Two things measured on
  the real renderer (software GL, Katoomba): the cast shadows switch off at +0.5 degrees of real sun, a dusk step of 0.9 luma under
  Daylight and 1.1 under Brighter; and Daylight ground just after sunset (-1.5 degrees) is brighter than at +10 degrees (60.2 against 51.8
  on the photo map), by design, because the map sun stays 30 degrees up. The 86-pixel difference the spike saw between frames is page-load
  noise that the unpatched build shows as well (one load in six differed from the others by 82 or 86 pixels; the cause was not found).
* **Picture quality** (`SceneView.ts` `QUALITY`, `render/qualityGuess.ts`, `ui/settings.ts`). Tiers Low / Medium / High set the
  terrain mesh (224 / 320 / 400 samples per side), the tree budget (16,000 / 32,000 / 48,000), the canopy triangle budget (100k /
  170k / 250k), the pixel-ratio cap (1.25 / 1.75 / 2), the flame sites and smoke puffs (2,500 + 800 / 5,000 + 1,500 / 5,000 + 1,500)
  and whether trees sway by default (off on Low); the rock detail of the cliff drawing is trimmed by the same tier (6 / 4 / 3 effects, see
  *The cliff drawing*). `Settings.pictureQuality` is `'auto' | 'low' | 'medium' | 'high'` (default `'auto'`,
  sanitised; `SETTINGS_VERSION` unchanged). `resolveRenderQuality(pictureQuality, performance)` in `settings.ts` is the pure rule: an
  explicit value wins; Auto is High under the Detail profile and otherwise `undefined`, which lets the view guess. `guessQuality` (High
  at 8 or more cores and 6 GB or more, Low at 4 or fewer cores or 3 GB or less, else Medium; a missing value counts as 4 cores and
  4 GB; `navigator.deviceMemory` is a coarse bucket of 0.25, 0.5, 1, 2, 4 or 8 GB, so it is never 6 and the High guess needs the 8 GB
  bucket, which predates 0.3.0) lives in the pure `qualityGuess.ts` and is re-exported by `SceneView.ts`, so the Settings and Data sets screens read it
  without pulling Three.js into the entry chunk. `simScreen.ts` passes the result to `createSceneView(container, { quality })` when
  the view is built, so a change applies to the next model. `describeQuality` (pure, `SceneView.ts`) builds
  `SceneViewApi.qualityInfo` (the tier, whether it was an option or a guess, the cores and memory the guess read, and what the tier
  sets; its `pixelRatioCap` is the tier's cap, not the smaller of the device's ratio and the cap). The adaptive pixel ratio stays on in every tier: it only lowers the resolution while the frame rate stays under 30. The
  build-time memory estimate (`scenario/memoryModel.ts`) stays device-independent (it models Medium); the Data sets screen re-models
  it with the running tier.
* **Tapping an icon** (`render/markerPick.ts`, `render/iconAtlas.ts`, `ui/screens/sim/markerWords.ts`, `SceneView.pickMarker`).
  `refreshMarkers` records, for every icon it draws, the `MapMarker` it stands for, and `pickMarker` hit-tests that same list, plus
  the homes when the Homes layer is on and the home is not hidden behind terrain (`lineOfSightClear`), so what is drawn and what can
  be tapped cannot differ. `markerPick.ts` (pure): a tap hits within `max(half the icon, 22)` px of the icon's centre (homes 14 px); the
  nearest centre wins, ties go you, ignition, spot fire, insight, home; the answer says how many other icons were also hit; a pin's
  centre is half its height above its anchor; projection is not clipped to the screen (an icon half off the edge can still be
  tapped) but leaves out points behind the camera. `iconAtlas.ts` holds the `Icon` enum and the atlas drawing (canvas and palette
  only, no three.js, guarded by a dependency test; `iconLayer.ts` re-exports it) and `iconGlyphUrl`, so the panel shows the map's own
  picture. `markerWords.ts` (pure): `markerRow` (name, detail line, "+N more icons here, zoom in to tell them apart"),
  `tapTarget(tool, marker, ground)` (in the Why tool an icon wins and the question is about its own spot, also when the finger's ray
  misses the ground; the other tools keep the ground) and `markerShownAt` (a time-bound icon is dropped when the clock goes back
  before it). `whyPanel.ts` puts the row first in every state and `WhyState.marker` keeps it through refreshes.
* **The cliff drawing** (0.3.0, plan section 9d, H-look; **display only**). With a 10 m terrain the 3-D view draws steep ground as rock
  walls. The modules are pure, DOM-free and three.js-free, and only the 3-D view's code imports them, so they stay out of the entry
  chunk and the worker (`fields.ts`, which the Data sets screen imports, must not grow, which is why `decimateTerrain` is not next to
  `decimateGrid`): `cliffSharpen.ts` (`cliffSharpen(grid, elevation)` gives a sharpened copy and its stats; `hornTan2`, `hornSlopeDeg`,
  `despikeGrid`; constants in `CLIFF_SHARPEN_DEFAULTS`), `terrainMesh.ts` (`decimateTerrain(grid, elevation, maxN, { loDeg, hiDeg,
  despikeM })`, `MESH_DESPIKE_M`), `rockMask.ts` (`buildRockMask` gives a `RockMask { grid, rgba, stats }`, `rockCopy` its CPU copy of R,
  `sampleRock`) and `cliffDrawing.ts`, the one place that fixes the order. `buildCliffDrawing({ hi, fuel, meshN, tier, source })`:
  1. `cliffSharpen`: a weight `smoothstep(48, 62)` of the 3 x 3 Horn slope, spread to the eight neighbours at 0.6; each weighted cell
     moves towards the nearer of the lowest and highest height within 3 cells (30 m) either way along its own fall line (nothing
     within 0.5 m of the middle, so a straight ramp and a gully floor stay); a despike pulls any cell that stands 10 m or more above or
     below all eight neighbours back to 2 m past them. The outer ring never moves, a window that would leave the grid is cut short, and a
     terrain with no cell over 48 degrees comes back as an exact copy. The input is never modified and the sharpened copy is not kept.
  2. `decimateTerrain`: `decimateGrid`'s blurred value, blended to the unblurred bilinear sample by `smoothstep(40, 55)` of the steepest
     10 m slope in the vertex's footprint (each steep source cell is scattered to the one to four vertices whose footprint holds it,
     which gives the same maxima as scanning every footprint for a fraction of the reads), then a mesh despike (`MESH_DESPIKE_M`: 10 m
     at High and Medium, 18 m at Low, 2 m margin). It returns `decimateGrid`'s result untouched when no decimation is needed.
  3. `lightTerrain(mesh)`: the hillshade, sky-view factor and cast shadows follow the sharpened mesh, and the **mesh's own gradient
     magnitude** at each vertex (`meshSlope`) picks banded rock against the photo: the 10 m slope disagrees with a 22 or 40 m triangle
     by up to a vertex spacing, and the switch would draw the disagreement as spikes along the lip and foot (spike S5).
  4. `hornGradient` of the sharpened 10 m terrain: the shader's normals (the relief, which is real).
  5. `buildRockMask`: R is bare rock from the mesh slope with the tier's band (`MESH_ROCK_BAND_DEG`: 48 to 58, 45 to 55 and 42 to 52
     degrees at High, Medium and Low, because a coarser mesh reads a face gentler and the default 52 to 62 band finds less of it)
     times `1 - cover`, where the canopy cover fades out on walls (`coverOnMesh`: cover x `1 - smoothstep(hi - 2, hi + 8, mesh slope)`;
     the canopy raster is top-down and 20 m, and 53 to 90 % of the sharpened cells over 75 degrees have cover of 0.5 or more); G is scree
     (22 to 40 degrees with rock within 80 m uphill); B is lip pavement (under 15 degrees with rock within 40 m); the scree and pavement
     windows use the 10 m slope of the sharpened terrain, because the mesh's slope would start the pavement a vertex spacing from the
     lip. The mask is RGBA8 at 10 m, and `rockCopy` keeps R as one byte per cell for tree placement.

  **Wiring.** `SceneView.setScenario` runs it when `useHi` (a 10 m terrain that covers the fire grid) and builds
  `new TerrainLayer(rg, terrain, shared, aniso, { gradient, meshSlope, mask, detail })`; without a 10 m terrain nothing is sharpened
  (`terrainStats()` is null) and the old path runs. `HeightField` is built from the sharpened mesh, so picking, the camera clamp, flames,
  smoke bases, places and roads agree with what is drawn; the fire, fuel and photo textures stay on their own coordinates (only heights
  change, so nothing is shifted sideways). Vertical exaggeration multiplies the sharpened heights as before. **Shader:** a vertex
  attribute `aSlope` (the mesh's gradient magnitude; its varying `vSlope` replaces the gradient texture's slope in the photo-against-rock
  switch), a new `uGrad` (the sharpened 10 m gradient as RG16F, `halfRgTexturePair`; `uGradXf` follows its grid), the sampler `uRock`
  (RGBA8, linear, with `uRockXf` and `uRockPlain` = 0.4; the 11th of the 16 fragment texture units) and the defines `CLIFF` and one
  `RD_*` per effect (`cliffDefines(tier)`): `RD_LEDGES`, `RD_OVERHANG` (it needs the ledges' phase), `RD_JOINTS`, `RD_STAINS`, `RD_SCREE`,
  `RD_PAVEMENT`. High has all six, Medium four (no joints, no overhang bands), Low three (ledges, stains, scree). `rockDetail()` runs
  only where R is above 0.25 (G and B above 0.05), fades by `fwidth(vZ)` and `uPixelMetres x vDist` to each effect's own mean so
  nothing shimmers in wide views, and under the Plain map type or a solo heat map (`uPlainBase`) only perturbs the normal, at
  `uRockPlain`. `rock = max(R, step(0.845, albedo.a) x albedo.a)`: the mask replaces the fire-grid slope ramp for rock tint, and bare
  non-fuel keeps its 0.85. A scenario without a 10 m terrain compiles none of this (no `CLIFF`, no `uRock`). **Trees:** `placeVegetation`
  gets `rock`, and a candidate at R of 0.5 or more is drawn again in its cell up to three times and then left out, thinning to none
  between 0.2 and 0.5 (`ROCK_REJECT`, `ROCK_THIN`, `ROCK_REDRAWS`; deterministic, from a hash). **Statistics:** `SceneView.terrainStats()`
  returns `TerrainDrawStats` (share of 10 m cells moved, the build ms of the sharpening, the rock mask, the mesh and the lighting
  gradient, mesh vertices and triangles, the rock-detail tier), shown as the *Cliff drawing (once per scenario)* row of the statistics
  screen's Display group, or "Nothing sharpened in this run (no 10 m terrain)" when it is null (and no row when a view cannot say).
  **Memory:** three rows of the working-memory model when the scenario has a 10 m terrain (`CLIFF_BYTES` in `scenario/memoryModel.ts`):
  `cliff-main` (on the screen thread: the rock copy, 1 B per 10 m cell, and the arrays Three.js keeps behind the gradient texture, the
  mask texture and the mesh's slope attribute so it can restore them after a lost graphics context, 8 B per cell and 4 B per vertex; with a
  note that about 16 B per cell more is held while the scenario is set up and released once the first picture is built),
  `gpu-cliff-light` (the lighting gradient, 4 B per cell, and the mesh's slope, 4 B per vertex) and `gpu-cliff-rock` (the rock mask, 4 B
  per cell). For a 9 km area (810,000 cells, a 400 x 400 mesh) that is 7.93 MB, 3.88 MB and 3.24 MB, and about 13 MB while setting up
  (`memoryModel.test.ts` pins these; a verifier measured +13 MB renderer memory at the peak of `setScenario` at High and +24 MB at Low).

  **Numbers are not touched** (plan section 4, rule 10): the simulation, the slope and elevation overlays, the cards and the Data sets
  statistics read the terrain as received; the one heat map the view computes, Sunlight (insolation), reads `numbersLightT()`, the 10 m
  terrain as received on a `decimateGrid` mesh made on first use. The Data sets Terrain record ends with `TERRAIN_DRAWING_NOTE`
  (`scenario/datasetRecords.ts`): "Cliff faces are drawn steeper than the data so they read as rock walls. Fire, wind and slope numbers
  use the data as received." **The fire model's rule for steep ground is unchanged in 0.3.0** and does not read any of this: a fire
  cell is a wall (`BurnState.NonFlammable`, `cliffNonFlammable`) when its landform is Cliff (a slope over 45 degrees on the 20 or 30 m
  fire grid), or at least 30 % of its 10 m sub-cells are over 60 degrees, or its 90th-percentile sub-cell slope is 60 degrees or more
  (`computeTerrainFeatures`), whether it is rock or forest; fuel inference calls ground over 55 degrees or half sub-cell cliff non-fuel;
  and the ember model has no reference to walls, so embers cross them. Rock in the model (the rock fraction, a wall that means bare
  rock, part-rock cells that slow the fire, vegetated chutes that stay open, the card wording; plan 9d.4, H-sim) is **not in 0.3.0**
  (decision D17) and ships as 0.3.1. The optional contract fields it will use (`Terrain.rockFraction`, `TerrainFeatures.rock` and `chute`)
  are declared, and nothing in 0.3.0 sets or reads them.

  **Measurements and known limits.** The despike also clips real single-vertex summits and pits: on the High mesh a vertex moves by up to
  26.6 m at Katoomba, 22.9 m at Kanangra, 42.5 m at Grose and 12.9 m at Tomah, and each site's highest point stays within about half a
  metre of the data's, as it did with the old mesh. On the four steep sites 3.9 % (Katoomba), 6.1 % (Tomah) and similar shares of the 10 m
  cells move, by 9.5 to 20.9 m on average and up to 54.5 to 122.2 m (the shipped function on the whole bundled terrain). In node on a
  loaded 4-core machine the whole pipeline took 150 to 450 ms for Katoomba and Tomah on the three tiers (each stage 10 to 200 ms); the
  plan's guess for a phone is 2.7 to 5 times that, and no phone has been measured. The ground's triangle count is the mesh's, unchanged
  (318,402 at High, 203,522 at Medium, 99,458 at Low for a 9 km area), and the draw calls do not change (`e2e/cliffs.spec.ts`).

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
  an atmosphere tier change — so the re-run's data shows immediately and not the old run's up to 300 s later); the fast tier's 3-D wind volume is not in
  the keyframe but in a list of its own, packed to 16-bit integers (`core/airPack.ts`, 6 bytes per cell, with a share of the budget of its
  own: see the air-data section); every step keeps a light frame (time, stats, spot-fire count into one shared
  log) and its embers. `at(t)` returns the real newest snapshot at or after its time, else a composition (keyframe +
  light frame + rebuilt fire) for exactly t; `at(t, quantum)` rounds t down to a *quantum* and the same object comes
  back within it (`atOrBefore` uses min(display step, 30 s)). While playing the session uses `playQuantum(speed)` =
  speed / 6 s (≥ 1 s: about six pictures per wall second, the renderer interpolates between them), paused or
  scrubbing the exact time, so the view is updated only when something changed. The rebuilt arrays live in two rotating buffers (a composed picture is valid until the second next one;
  `SceneView.update` copies what it needs synchronously). Over budget (48–160 MB), older history is thinned first
  (an entry survives when it is at least age / R after the previous kept one, R shrinking until each list fits its share);
  the first keyframe and the newest snapshot are never dropped. Measured with real fast-tier Katoomba snapshots (40 k fire cells)
  for 6 h under a 64 MiB budget: 60.2 / 59.8 / 57.7 MiB held, 58 / 56 / 55 keyframes, at 10 / 30 / 60 s steps (`src/ui/snapshotStore.sim.test.ts`;
  with the diagnosed wind whole in every keyframe it was 57.2 / 44.7 / 50.4 MiB and 31 / 26 / 31 keyframes); the budgets of the 0.5, 1 and 2 GB
  classes, and the 0.3.0 comparison, are in the air-data section (`src/ui/snapshotStore.fast6h.sim.test.ts`). Since 0.4.1 the session cuts the history in ONE place,
  `cutHistory(t)` (the five sites that used to call `truncateAfter`), which cuts the Air slice recorder at the same time; the recorder's memory is on top of the
  history's budget and takes nothing from it (*The Air slice recorder*, above).
* Insight flood control (`ui/insightGroups.ts`): a large fire reports the same phenomenon along its whole edge
  (hundreds of cards in 6 h). The Insights tab and the map show one card / marker per kind (the newest of the most
  severe instances, "seen N times since …"). Nothing pops up over the map: `UnseenTracker` counts the cards revealed since
  the Insights tab was last open (one per kind) for the dock badge, which turns red with one pulse for a Danger card.
  `DangerGate` only serves the opt-in settings: vibration (at most once per kind per simulated hour) and "pause on
  danger" (only the first time a kind is dangerous); both are OFF by default.
* Simulation-screen chrome (`ui/screens/sim`): collapsed by default, in the Google-Maps-for-Android language (docs/DESIGN.md).
  **Top**: a floating pill (`topBar.ts`: main menu, clock with its elapsed / Replay / Computing line, the blue Play button and the
  speed chip) with a row of read-out chips under it (temperature, humidity, wind, fire-danger rating: information, not buttons). The
  main menu is a side sheet (Data sets, How this simulation works, Help and glossary, Safety notice, Settings, Simulation debug
  statistics directly under it, New scenario); the time
  and speed controls open as small sheets (`transportKit.ts`, one popover at a time). **Map controls**: a column of round white
  buttons (Layers, View with the current camera mode, Compass) and an extended "Tools" button in the bottom corner whose speed dial
  holds the seven tools (Why here?, Fire, Fuel, Wind, Layers, What if and, from 0.4.0, Air slices; `mapMenu.ts`; the open menu is `UiState.menu`, so at most one is open and a map tap, Escape or Back collapses
  it). **Bottom**: Maps-style bottom navigation (Insights with an unseen-cards badge, Weather, Stats, Help) above the timeline strip
  (`sheet.ts`, `scrubber.ts`; the strip's fourth column holds the speed signal's button while the simulation cannot keep up, see
  *Speed* above); a tab opens a rounded bottom sheet with a grab handle (`UiState.sheet` is `closed | peek | half | full`,
  default `closed`). A thin error chip appears under the top bar only if the engine fails; the map's legend card (`mapLegend.ts`) and
  attribution line (`mapCredits.ts`, a button that opens the Data sets screen) sit at the bottom of the visible map. Left-hand mode
  mirrors everything. The column of round buttons sits under the top bar and, where that leaves no room beside the Tools button (a short landscape screen at a large text size) and the top bar only reaches part way across, starts level with the top bar's side instead (`--col-top`, set by `layoutInsets`). The pure rules (menu reducer, what Back closes first, dock taps and detent heights, list fitting) are in
  `layoutModel.ts`; `simScreen.ts` measures the covered edges (`layoutInsets`) and gives the camera, the crosshair, the round buttons
  and the legend the visible map. Field-use rules, guarded by `ui/styles.rules.test.ts`: every tap target is at least 44 px (the
  read-out chips are not buttons), no literal font size is under 14 px (12 px exists only as the caption token), and behind a full-screen screen the stage is `inert`.
* **Layers panel** (`layersPanel.ts`, `layersModel.ts`, `layersPrefs.ts`): built only from `render/layerCatalog.ts`, so a new
  catalog row appears on its own. Map type (aerial photo / terrain colours / plain, and under the tiles Night lighting: Realistic /
  Brighter / Daylight, `nightLookRow` in `layersModel.ts`, left out where the view has no `setNightLook`), Map details (one tile per scene layer: roads, fire
  trails, homes, residential areas, place names, 3-D canopy, shrubs, flames, smoke, embers, wind streaks, insight markers; a greyed
  tile carries the catalog's reason), Heat maps (every data layer that can colour the ground, grouped as the catalog groups them; one at
  a time, tap again to switch off; "Show on its own" hides the photo and the trees; roads, homes and shrubs have both Show and Heat map),
  Trees (natural / simple / coded by height, cover, bark or understorey hazard; sway) and Wind and air (the wind streaks, the Air slice
  switch with its six field chips and, on the fast tier, the info note about the diagnosed wind with the *Use the 3-D atmosphere* button,
  the compass rose, and the vertical exaggeration). Each row has an (i) with the
  catalog text and a link to the data set behind it on the Data sets screen. The user's choices (only choices, never defaults) are
  saved to the UI preferences (`layersPrefs.ts`, key `layers`) and put back at the start of the next run by `restoreLayerPrefs(ctx)`
  (a remembered heat map only where it can be shown; the remembered night look; the trees' wind sway starts off in battery mode and on a low-quality renderer).
  "Why here?" has a *Where you are* part (`placeInfo.ts`, pure): nearest road and fire trail, the zone, homes within 500 m and 1 km,
  the ground, all measured from `ScenarioData.context` and the terrain grid.
* **Places context** (`ScenarioData.context`, `core/places.ts` `ContextLayers`): roads, RFS fire trails, residential and built-up
  zones, homes and place names in local metres. `scenario/context.ts loadContext` takes them from the bundle (demo sites), an area pack,
  the cache or a live query of the NSW services (`data/nswContext.ts`), in that order, and never fails a build. The worker does not
  receive them (the 3-D view and the "Where you are" part use them on the main thread). `render/placesLayer.ts` draws them
  (`SceneView.setContext`, `setLayers({ roads, fireTrails, homes, zones, placeNames })`, `placesLegend()`); the two data heat maps
  `homeDensity` and `roadAccess` come from `render/contextFields.ts`.
* **Full-screen screens and the Back stack** (`app.ts`, `backStack.ts`). Settings, Data sets, How this simulation works and
  Simulation debug statistics are *overlays*: the App puts them over the stage, which becomes `inert` (focus and screen readers stay in the screen), and the simulation
  keeps running underneath: opening one never pauses or changes playback. The covered 3-D view stops drawing frames
  (`SimScreen.setCovered` → `SceneViewApi.setCovered`, called from `App.updateInert`; snapshots and the camera keep their state and the
  first frame after the screen closes shows the latest), so a reading screen does not run the GPU. Closing one returns focus to the control that
  opened it. The Back button (Android hardware Back, the browser's Back, Escape) closes the top-most thing first: a confirmation dialog,
  a data set's page (back to the list), the screen, then the simulation's own menus, popovers, tool panel and sheet, and only then asks
  before leaving the simulation (`BackStack`: one guard entry on the history while anything is closable; on Android `MainActivity`
  maps the hardware Back to `WebView.goBack()` while the WebView has a history entry, which arrives as `popstate`). The App keeps the
  current `ScenarioData` (`this.scenario`) so Settings and Setup can open the Data sets screen outside a run (no scenario: the plan of
  the Setup form from `scenario/estimate.ts`, what is stored on the phone and the bundled data). "Show on map" from a data set closes
  the overlays and applies its layer or heat map (`SimScreen.showLayer`). Entry points: main menu, Stats tab (*Data used*: See all, a row
  = that data set), the Layers panel's (i), the map's attribution line, Settings, Setup (*Data for this run*, a row = that data set's
  planned page) and, for the model card, the main menu, the Stats tab, Settings and Setup. Simulation debug statistics
  (`App.openDebugStats`, its own lazy chunk, overlay id `debug-stats`) opens from the main menu directly under Settings, Settings, Setup,
  the model card and the speed sheet.
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
  'quality' → high): a change made mid-run asks for the tier outright (Balanced then means the 3-D air, not another Auto timing test;
  Auto's one decision is the start of a run, see *Speed* above). A fast-tier run offers "Use the 3-D atmosphere" in the Layers panel
  where it matters; the speed sheet's "Use the fast model from here" is the same `setQuality` path the other way.

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
`SceneView.update` takes ≈ 4 ms median, 9 ms p95. All of that is one desktop core. Only one phone has been measured so far: on it the
3-D air step took 41 ms (the mean of the first 20 steps, warm-up included). The spec's 2–3× guess (§13) is therefore not used to say
what phones do; the app measures the phone it runs on (the Auto timing at the start, `EngineInfo.perf`, the Simulation debug
statistics screen) and the 0.3.0 Auto policy keeps the detailed 3-D air up to about 198 ms per air step (see *Speed* above). Spec
budgets and CI gates: §13 (V20).

### Performance budgets (phone, battery, APK size)

Measured by the performance review of the screens phase, in headless Chromium with SwiftShader (software WebGL, so absolute frame
times are slow and are only ever compared between builds on the same machine), Katoomba (bundled demo), `low` render quality,
412 x 915, medians of 5 runs unless noted; "4x" = Chrome DevTools CPU throttling 4x as a mid-range phone proxy. Baselines are the two
commits before the screens phase: `6a3d171` (the UI rework, before layers) and `3e01e78` (layers phase 1, before the design system and
the dataset provenance). "Now" is the tree of this document. The four bundle rows (JS, entry, CSS, bundled data) of the "now" column
were remeasured for 0.3.0 on this tree, **with the cliff drawing merged** (`flock /tmp/firesim-heavy.lock npm run build:cap` and then
`npm run check:bundle`, kB of 1024 bytes and `gzip -9`, as the script prints them) (the release build of 0.3.0). The
Layers panel row was corrected to what the night-look verification counted (below). The other rows were measured in the screens phase
and have not been measured again here.

| Measure | 6a3d171 | 3e01e78 | now | Budget / verdict |
| --- | --- | --- | --- | --- |
| JS, all chunks (raw / gzip, kB) | 2237 / 743 | 2421 / 807 | 2729 / 912.5 | gzip <= 1000 (`npm run check:bundle`) |
| Entry chunk `index-*.js` (raw / gzip, kB) | 178 / 63 | 214 / 75 | 462 / 159.7 | gzip <= 195; screens and the layer catalog are in it (the model-card text is a lazy chunk since 0.3.0) |
| CSS (raw / gzip, kB) | 45.0 / 9.7 | 86.4 / 17.0 | 125.3 / 22.4 | raw <= 135, gzip <= 25 |
| Render chunk `render-*.js` (raw / gzip, kB as Vite prints them) | | | 785.3 / 216.9 | no budget of its own; the cliff drawing is about +19 kB raw and +7.5 kB gzip of it (the cliff lane's own before and after builds: 765.8 / 209.4 to 785.0 / 216.9), and the entry about +0.4 kB gzip |
| Bundled data `public/demo` (MB) / whole `dist/` (MB) | 28.4 / 30.8 | 29.0 / 31.6 | 33.1 / 36.0 (nine sites, with Mount Tomah) | demo <= 36 (was 31 before Mount Tomah) |
| HTML pages in the production build | 1 | 1 | 1 | exactly `index.html` (style guide, `render/dev*.html`, legend gallery are dev-server pages, never built) |
| Source maps in `build:cap` (the APK) | 0 | 0 | 0 | 0 |
| Debug APK (`gradlew assembleDebug`, MB) | 27.1 (Sep 28, before the screens phase) | | 27.6 | <= 33 (was 30 before Mount Tomah); holds `index.html` as its only page of ours |
| Start: first paint / Setup interactive (ms) | 68 / 240 | 56 / 259 | 56 / 263 | Setup <= 350 (1x); at 4x 682 / 696 / 766, budget <= 1000 |
| Scenario build to first frame of the sim (ms, 1x) | 2467 | 2581 | 2763 | <= 3500; the places step adds ~55 ms and the data-set inventory ~45 ms |
| Scenario build in Node, Katoomba 9 km bundled (ms) | | 282 | 305 | <= 400 |
| Worker, fast tier, 10 s / 60 s display step (ms wall per simulated minute) | | 46.1 / 33.6 | 44.6 / 38.2 (36.0 vs 34.6 over 60 min) | within 10 % of the baseline |
| Worker, standard tier, 10 s / 60 s display step | | 199 / 152 | 194 / 157 | within 10 % of the baseline |
| `EngineInfo` per snapshot (worker) | | | 4 us, 1.8 kB; a memory measurement of 19 ms at most every 30 wall-seconds | <= 0.1 ms per snapshot |
| `EngineInfo.perf`, the timing statistics (worker) | | | about 5 us per step, about 11 KB retained, at most 1.9 KB serialised (the engine lane's measurements; not repeated here) | < 1 % of step time (0.24 % of a fast-tier step, 0.02 % of a standard one), < 16 KB retained, < 2 KB serialised (`sim/perf.test.ts`, `sim/perfStats.test.ts`) |
| Main thread while playing (6 % of wall at 1x, 8 s) | | 432 ms | 488 ms (22 ms per drawn frame in both) | no long task (> 50 ms) at 1x |
| Frame (low, 3-D view): draw calls / k triangles, all layers off | | 4 / 102 | 4 / 102 | |
| Frame: default layers / all scene layers on | | 15 / 138 | 17 / 161 and 19 / 228 | high (measured 20 / 495): <= 25 draws, <= 550 k triangles |
| Frame: a heat map on its own / over the scene | | 9 / 115 and 15 / 124 | 11 / 139 and 17 / 148 | |
| The cliff drawing, built once per scenario (node, bundled Katoomba and Tomah, three tiers) | | | 150 to 450 ms in all, each stage (sharpen, rock mask, mesh, lighting gradient) 10 to 200 ms, on a loaded 4-core machine (a second run of the same call: 145 to 400 ms); ground triangles and draw calls unchanged | the plan's phone figures (sharpen plus mask at most 400 ms and 150 ms `[est]`) are not measured on a phone |
| The cliff drawing, working memory (9 km area, High) | | | 0.81 MB on the screen thread, 7.1 MB on the graphics side (gradient 3.24, rock mask 3.24, mesh slope 0.64), about 13 MB more while the scenario is set up | three rows of the Data sets memory card, pinned by `scenario/memoryModel.test.ts` |
| Layers panel: DOM nodes when open / open+close CPU at 4x | | 179 / 17 ms | 940 / 43 ms | <= 1000 nodes, <= 60 ms; 940 counted with the Night lighting row (915 without it: the row is 25 nodes, not 12), so the margin is 60; the CPU figure was not repeated with the row |
| A heat map switched on and off at 4x: longest main-thread task | | (the 14 data maps are new) | <= 112 ms (insolation computes once: 68 ms at 1x, then cached) | <= 150 ms at 4x |
| Data sets screen open, longest task at 4x (16 rows / 60 rows) | | | <= 268 ms / 250 ms (60 rows are drawn in slices over frames) | <= 300 ms |
| Model card open, longest task at 4x | | | 146 ms | <= 300 ms |
| After 100 layer toggles and 80 screen / panel opens | | | JS heap 9.8 to 10.5 MB (100 toggles) and 12 MB (the screen cycles); DOM nodes (2790) and listeners (228) unchanged; GPU geometries 12 to 20 and textures 16 to 18 (made on first use, then kept) | no growth per toggle |

Mount Tomah, the ninth demo site (added 2026-10-07), is in the bundled-data row of the "now" column (33.1 MiB measured on the 0.3.0 tree); the other rows were measured before it existed. It adds 4.28 MB to `public/demo` (29.0 to 33.1 MiB; 34.9 MB with the replays) and, deflated, about 2.7 MB to the APK (27.6 to about 30.3 MB; estimated, the APK was not rebuilt).

What 0.3.0 did to the bundle, from the same build (gzip kB of 1000 bytes as Vite prints them): a build-only Vite plugin in `vite.config.ts`
leaves out the GeoTIFF decoders the app never reads (LERC, ZSTD, JPEG, WebP) and pako (inflate goes through `fflate`, now an explicit
dependency), and `npm run check:bundle` fails if any of them comes back; the app's GeoTIFF reader reads Deflate, raw, LZW and PackBits
only. The model card and its text moved out of the entry into a lazy chunk (18.4 kB, loaded on the first open: `App.openModelCard()` is
async, ignores a second tap while the chunk loads and reports a chunk that fails; a failed chunk import cannot be retried on the same
page, because Chromium caches the failure, and the APK's chunks are local). New lazy chunks, as Vite prints them for this tree
(gzip kB of 1000 bytes): Simulation debug statistics 15.2 (about 125 rows of text; the plan guessed 6 to 8), the speed sheet 3.7 and
`runEvents` 1.2. The pace model, the event ring, the icon words and the Night lighting and Picture quality rows are small and live in the
entry; the pure icon hit test (`markerPick`) is a chunk of its own, about 1.0 kB, and not in the entry as the plan had it. As each lane was verified against its own
lane base, the trims save 87.2 kB of all JS (988.0 kB without the stub plugin against 900.8 with it, when they were verified), the model
card frees 24.2 kB of the entry (the plan said 21.2) for 3.0 kB more JS in all, and the statistics lane adds 19.2 kB to all JS (the
plan said 6 to 8 lazy plus 1 of glue); the entry fell 9.8 kB there because the build now splits `content`, `recordKit`, `store` and
`types` out of it, which leaves its own growth at about 3.8 kB, not 1. The cliff drawing is in the render chunk (see the table). Limits of
the trims, found by the verification and not fixed: the `fflate` shim does not check the Adler-32 checksum (pako threw on a bad one),
accepts raw deflate, and returns empty for empty input (geotiff then throws); only `data/canopy.ts` uses geotiff, and only for the
Meta/WRI canopy-height COG (Deflate with predictor 2, checked in research note 08 section 3.8 for one tile only, Katoomba quadkey
311230121; other tiles and any re-encoding by Meta are unverified, and there was no network to check); and `loadCanopyLayer`'s
`.catch(() => null)` reports a COG in an unsupported compression as "the canopy service did not answer". The plan's T3b and T4b trims
were not done.

**What 0.4.0 adds** (the air data foundation and Air slices). The bundle rows are from the release build
(`flock /tmp/firesim-heavy.lock npm run build:cap`, then `npm run check:bundle`, kB of 1024 bytes and `gzip -9` as the script prints them);
the budgets in `scripts/check-bundle.mjs` did not change (entry 195 kB, all JS 1000 kB gzip: the owner chose to reuse the existing budget,
so the panel is a lazy chunk). The other rows were measured in node on the build machine, one run each, from the log lines named.

| Measure | 0.3.0 (table above) | 0.4.0 | Budget / verdict |
| --- | --- | --- | --- |
| JS, all chunks (raw / gzip, kB) | 2729 / 912.5 | 2807 / 943.3 | gzip <= 1000 (`npm run check:bundle`) |
| Entry chunk `index-*.js` (raw / gzip, kB) | 462 / 159.7 | 477.7 / 165.5 (+5.8 gzip: the tool's shell, model and scene glue, and the air view fields) | gzip <= 195 |
| CSS (raw / gzip, kB) | 125.3 / 22.4 | 127.7 / 23.3 | raw <= 135, gzip <= 25; `slice.css` is imported by the lazy chunk, not by `main.css` |
| The Air slices panel chunk (panel, drawing, `flow2d`, `probe`, `niceTicks`, lattice reader, its CSS), gzip kB | none | 10.5 (26.1 raw), plus its CSS 0.9 (2.3 raw) | lazy, no budget of its own; the plan estimated 14 to 18 |
| The chunk the build splits `explain/text.ts` into, gzip kB | none | 12.1 (35.5 raw) | counted in all JS |
| `src/styles/slice.css`, source | none | 4,024 bytes (`wc -c`; it was 3,979 before the slice-UI round) | <= 4,096 bytes (the plan's CSS estimate) |
| Bundled data `public/demo` (MB) / debug APK (MB) | 33.1 / 27.6 | 33.1 / 29.0 (30,360,109 bytes; `sectionLine` chunk 3.7 gzip is also new) | unchanged by this release / no budget |
| `view()` of the air per snapshot (worker): fast / standard / high tier | fast: the 10 m fields only | 0.60 ms, 498 kB / 0.77 ms, 815 kB / 1.16 ms, 1,730 kB (`[atmos perf]`, `airView.perf.test.ts`; the times vary: later runs gave 0.40 / 0.60 / 1.15 ms and 0.43 ms fast, 1.22 ms high) | the plan estimated about 0.5 ms for the fast tier; the test allows 25 / 60 ms |
| History keyframe, fast tier at 45 x 45 x 20 | | +237.3 KiB (6 bytes per cell: 16-bit integers, in a wind list beside the keyframes; the live snapshot holds the 474.6 KiB exactly) | within 0.00046 m/s of the exact wind at 30 m/s |
| History of a 6 h fast-tier run (72 keyframes) | | 2 GB and up: +17.5 MB (72 volumes); 0.5 to 1 GB: about +5 % per keyframe, the volumes held to 4 % of the budget; keyframes and longest gap as in 0.3.0 (the count about 5 % lower on average over the last hour) | the history budget is unchanged: about 6 % of device memory, 48 to 160 MB; `snapshotStore.fast6h.sim.test.ts` |
| Sampler v2 per call: `windP` / `fieldsP` | | 109 / 258 ns, 0.14 bytes (`[sampler perf]`); later runs 100 to 130 / 182 to 260 ns | allocation-free; `atmosphereSampler.test.ts` measures it, and `atmosphereSampler.alloc.test.ts` with inlining off |
| One slice update (resolve, four preset checks, sample, cells) | | median 0.5 to 1.0 ms, p95 up to 1.5 ms, on lattices of 96 x 55 and 129 x 55 (`[slice perf]`, `slice.perf.test.ts`) | plan: p95 <= 8 ms at 4x CPU throttle. Measured later at 4x in a browser: compute alone p95 7.1 ms (fast) / 8.9 ms (3-D), the whole update (compute, panel redraw, curtain) p95 18 / 33 ms, max 41 ms. After the slice-UI round (fast tier, panel open, 150 edits, 4x, software rendering): synchronous update p50 4.2 to 4.5 ms, p95 7.9 to 9.5 ms (was 10.5 to 11.5 and 17.9 to 20.9); the repaint, now a frame of its own, p50 3.3 to 4.4 ms, p95 8.4 to 10.4; both p95 about 15 to 17 ms (was 24 to 26): **the repaint was moved, not removed; approached, not met for the whole update** |
| One streak step (300 particles); the probe with its sentence | | 0.05 ms and 2.6 bytes; 4.7 us and 448 bytes | |
| Heap after 3,000 slice updates | | changed by 31.8 kB | heap-flat |
| Layers panel: DOM nodes when open | 940 | not re-measured | <= 1000; the chip row and its note are built only once the section is switched on |

Not measured: the panel on a phone (frame rate with the streaks, the chunk's load time), the whole
fast-tier snapshot size after the volume (about 0.5 MB more than before from the arrays' sizes), the Layers panel's node count with
the section on. The plan's budget row for D ("14 to 18 kB, lazy") is met with room (10.5 kB gzip plus 0.9 kB of CSS); for C ("about 3 kB, entry")
the entry grew by 5.8 kB gzip in all, which includes the tool's shell, the model and the scene glue, so that row was too small.

**What 0.4.1 adds** (the time-lapse recorder). The bundle rows are from the 0.4.1 release build on the tree of this docs round (`flock /tmp/firesim-heavy.lock npm run
build:cap`, then `npm run check:bundle`; kB of 1024 bytes, `gzip -9`, chunk sizes by a script that reads `dist/assets`); no budget changed (entry 195 kB, all JS 1000 kB
gzip) and no check was weakened. The node rows are from `npx vitest run src/render/slice/sliceRecorder.perf.test.ts`, one run on this machine.

| Measure | 0.4.0 | 0.4.1 | Budget / verdict |
| --- | --- | --- | --- |
| JS, all chunks (raw / gzip, kB) | 2807 / 943.3 | 2823.1 / 949.3 (+6.0 gzip) | gzip <= 1000 (`npm run check:bundle`) |
| Entry chunk `index-*.js` (raw / gzip, kB) | 477.7 / 165.5 | 479.2 / 166.0 (+0.5 gzip; the share of each part of the feature was not measured) | gzip <= 195 |
| CSS (raw / gzip, kB) | 127.7 / 23.3 | 127.7 / 23.3 | raw <= 135, gzip <= 25 |
| `src/styles/slice.css`, source | 4,024 bytes | 4,066 bytes (`wc -c`; the rule for the tool's button rows went from a 2 px to a 4 px margin, with a longer comment) | <= 4,096 bytes: 30 bytes left |
| The Air slices panel chunk, gzip kB | 10.5 (26.1 raw) plus its CSS 0.9 | 10.3 (25.8 raw) plus its CSS 0.9 (2.3 raw) | lazy |
| New small shared chunks, gzip kB (raw) | | `lattice` 0.7 (1.4), `sliceRecording` 0.8 (1.5), `recordingWords` 0.8 (1.5) | counted in all JS; `lattice.ts` is shared because the curtain (render chunk) and the panel both read it |
| The render chunk, gzip kB | | 215.3 (781.2 raw) | |
| The chunk the build splits `explain/text.ts` into, gzip kB | 12.1 (35.5 raw) | 12.1 (35.5 raw) | counted in all JS |
| Recorder, one sample of a 90 x 54 line | | 48,696 B on the 3-D air, 29,256 B on the fast tier; the epoch 5,772 B; 258 / 429 samples in 12 MiB | the budget is an eighth of the history's, at most 12 MiB (6 MiB at the 48 MiB floor), **on top of** the history, which is unchanged |
| Recorder, the longest line (127 x 56; 170 x 56 on the High tier) | | 71,216 B (95,296 B) on the 3-D air, 176 (131) samples in 12 MiB | the design file's 192 x 56 (116 samples) cannot occur |
| `arrive` + sample + `store`, 90 x 54 (node) | | 3-D air: median 0.95 ms, p95 1.23 ms; fast tier: 0.63 and 0.71 ms | the design's p95 <= 1.5 ms |
| `read`, 90 x 54 (node) | | p95 0.065 ms (3-D air), 0.036 ms (fast tier) | <= 0.5 ms |
| The whole `record(snapshot)`, 96 x 56 (node) | | median 1.00 ms, p95 1.31 ms | <= 1.5 ms |
| `record()` in a browser at a 4x throttle, Max speed, software rendering (a verifier's measurement, not repeated here) | | fast tier: median 3.8 ms, p95 13.2 ms, max 22 ms, 14 a second (6.7 % of the time); 3-D: 4.7 / 11.1 / 29 ms, 5 a second (2.7 %) | not a phone; a single call can exceed a 60 frames-a-second frame |
| Heap after 3,000 arrivals, thinning and a replay among them (node) | | changed by 70.7 kB (12 MiB, 3-D air); -14.3 kB (6 MiB, fast tier) | heap-flat (the test allows 256 kB) |
| Snapshot hash with and without a recorder | | equal, both tiers (`sliceTimeLapse.test.ts`) | the recorder never feeds back |

Not measured: any of the recorder on a phone, the cost of the first minute after *Keep this line* on a phone's main thread, and what the Max-speed load does to the frame
rate there (the statistics screen's frame-rate rows, and phone check-list 2, are the way to find out).

Rules that keep the budgets (each has a test, a script or a measurement behind it):

* **Nothing is drawn behind a full-screen screen.** `App.updateInert` tells the sim screen when a Settings / Data sets / model-card
  screen covers it; the 3-D view then skips its frames (`SceneViewApi.setCovered`) while the run carries on. `e2e/integration.spec.ts`
  ("a full-screen screen over the run stops the 3-D view drawing frames") fails if a frame is drawn behind a screen, and if drawing
  does not resume when it closes. (Before, a burning fire kept a hidden view at its 30 fps cap for as long as the screen stayed open.)
* **The view is on demand.** It draws only when the camera moves, data change, or something animates: a fire's flames and spot
  markers, wind streaks, smoke fade, the trees' wind sway (`VegetationLayer.animating`: sway on, canopy visible, near-surface wind
  above 0.5 m/s, trees placed; off by default on the `low` tier and in the top view). Animation alone is capped at 30 fps. Known cost, not
  changed: with a fire burning, or the default wind streaks on, the loop animates even while paused, because the flames flicker.
* **Heavy work is sliced.** The places layer builds in 4 ms slices per frame (about 95 ms in all for Katoomba, of which the residential
  fill raster is two thirds, and 10 MB of GPU memory; it is built even while those layers are off); the forest is placed 4 ms per
  frame; the Data sets list is drawn in chunks; data heat maps are computed on first use and cached.
* **Screens are cheap while open.** The model card and Simulation debug statistics re-read at most once a second (and not while the
  page is hidden); the Data sets memory card every 5 s; the timers end with the screen. The compass reads the camera heading five times a second.
* **The worker does not pay for transparency.** `Simulation.engineInfo` is bookkeeping read once per snapshot; the physics never reads it.
  The timing statistics (`PerfStats`, `EngineInfo.perf`) are fed from clock reads the engine already made (a test checks that a run
  reads the clock as often with them on as off), are counters, running aggregates and small rings only, and are held to under 1 % of a
  step and under 16 KB retained.
* **The Air slice costs nothing while it is off, and little while it is on.** Nothing of the panel loads until the tool is first opened
  (`e2e/air-tool.spec.ts` checks no request at start-up); the scene computes no slice while the section is off (the updater is
  invalidated); one `SliceUpdater` serves the curtain and the panel; the slice reuses its arrays, and a test holds 3,000 updates to
  a flat heap; the panel is repainted once in the next display frame, however many slices came, and not at all while it is covered; the
  streaks run at most 24 frames a second on any display (20 at 60 Hz) and stop while the panel is hidden, the page is in the background or
  the phone is set to reduce motion (still arrows then); the sampler's hot entry points allocate nothing. The time-lapse recorder (0.4.1) is the same while the slice is off or the line is a preset: a call is 0.03 to
  0.1 ms (a verifier, in a browser at a 4x throttle) and nothing is stored; it keeps to its own budget (an eighth of the history's, at most 12 MiB, a free list so a
  steady stream allocates nothing) and a test holds 3,000 arrivals to a flat heap.
* **The APK carries only `dist/`.** `npm run build:cap` (`tsc --noEmit && vite build --mode capacitor`) builds `index.html` as the only
  entry, so dev pages (`src/ui/styleguide.html`, `src/render/dev.html`, `devTrees.html`, `legendGallery.html`) are served by the dev
  server only; `npm run check:bundle` fails the build on a second page, on source maps, or on a JS / CSS / data size over the table.
  `npx cap sync android` copies exactly `dist/` (about 38 MB with the nine demo sites) into `android/app/src/main/assets/public`.

## Testing

* `npm test` — Vitest unit tests of every module against published values and physical sanity checks, the §15
  validation scenarios (`src/sim/validation/`, long ones with `SLOW=1`) and the 3-h Katoomba run
  (`src/sim/validation.test.ts`, skip with `FIRESIM_SKIP_SLOW=1`).
* `npx playwright test` — Pixel 7 profile, Chromium with SwiftShader WebGL, against the production build:
  `e2e/app.spec.ts` (the whole app with the real modules end to end, screenshots into `docs/screenshots/`),
  `e2e/sim.spec.ts` (the real worker), `e2e/ui.spec.ts` (the UI on the mocks), `e2e/layers.spec.ts` (the Layers panel, GPU
  object counts), `e2e/datasets.spec.ts` and `e2e/model-card.spec.ts` (the two information screens), `e2e/integration.spec.ts`
  (every entry point, the Back order, focus and inert, the 200 % font scale, high contrast, deletions that ask first, a whole run
  with every screen visited and nothing popping up), `e2e/android.spec.ts` (an emulated Capacitor runtime), and for 0.3.0
  `e2e/debug-stats.spec.ts` (the statistics screen), `e2e/pace.spec.ts` (the speed signal and its sheet), `e2e/night-look.spec.ts`
  (Night lighting, read from decoded screenshots), `e2e/picture-quality.spec.ts` (the tier a setting gives, and its budgets) and
  `e2e/icon-tap.spec.ts` (tapping an icon) and `e2e/cliffs.spec.ts` (the cliff drawing on Katoomba at High and Low, read from decoded
  frames: steeper drawn ground, higher edge contrast on the cliff pixels (a weak check, a serrated drawing passes it), no near-black or
  all-zero pixel, the same draw calls with and without it, the Terrain card note and the statistics row). The pure modules of 0.3.0 each
  have a node test beside them (`perfStats`, `paceModel`, `paceSheetModel`, `debugStats`, `deviceInfo`, `eventLog`, `runEvents`,
  `frameLog`, `markerPick`, `iconAtlas`, `markerWords`, `mapLighting` and its uniforms, `quality`; for the cliff drawing `cliffSharpen`,
  `terrainMesh`, `rockMask`, `cliffDrawing`, the property tests of `cliffFuzz` on random terrains, `terrainLayer.cliff` (which
  gradient lights the ground, where the rock slope comes from, the defines of each tier, and that a layer without a 10 m terrain is the
  old one), the rock rule of `vegetationPlacement` and `vegetationLayer`, the memory rows of `memoryModel`, and `cliffSites`, which holds
  the built code to the plan's table on the bundled sites: Katoomba always, all four with `SLOW=1`). `content.test.ts` pins that the Help
  and Glossary say what the screens say (the checkpoint wording of the fast-model note, the six, four and three rock effects, and for 0.4.0
  the labels of the Air slices tool, the footer and probe sentences, the 90 second rule and the wind speed map on the fast tier, and for 0.4.1 the Keep this line and
  Clear recording labels, the status line's own sentences, "recorded air from" and the tier grids the recording's survival of a tier switch rests on).
  For 0.4.0 the real-app specs are `e2e/air-view.spec.ts` (the air both engines publish and the layers that read it), `e2e/air-tool.spec.ts`
  (the tool's placement flow, the lazy chunk), `e2e/airslice-panel.spec.ts` (the panel on both tiers, landscape, reduced motion),
  `e2e/air-slice.spec.ts` (7 tests, the last two of them for 0.4.1: the tool, the curtain and the panel together on both tiers, the seams the three lane specs do not
  reach, and the time-lapse recorder on each tier) and `e2e/air-curtain-gpu.spec.ts` (the curtain's GPU objects stay constant over 60 changes); the
  pure modules each have a node test beside them (the list is in *The air view and the Air slice*), including the oracle tests that hold the
  sampler and the slice to the engines' own `sample()`.
