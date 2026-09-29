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
| Data | Open‑Meteo (BOM ACCESS‑G, ECMWF, GFS, ERA5); NSW Spatial Services LiDAR DTM + imagery (demo sites); AWS Terrain Tiles (SRTM); Meta/WRI canopy height; NSW NPWS fire history; NSW SVTM vegetation; NSW RFS feeds | Free, no API keys, Australian coverage |
| Offline | Bundled demo sites (`public/demo/`) and historic weather (`public/replays/`), user-downloaded **area packs** and a response cache in IndexedDB | Mountain fire grounds often have no mobile coverage |

## Source layout

```
src/
  main.ts        entry: settings/theme, loadServices (real modules or ?mock=1), App
  core/          contracts (types.ts, simTypes.ts), grid, geo (LocalProjection), units, rng, shared physics
  data/          assets (bundled files in browser / Node), http, cache + area-pack storage, terrain tiles
                 (Terrarium), canopy, demo rasters (DEM, imagery window, GeoJSON), demo sites, synthetic terrain
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
                 live feeds (RFS incidents, fire danger, hotspots)
  sim/           Simulation (coupling loop), records, stats, SimHost, worker.ts, SimClient / LocalSimController,
                 protocol, validation/ (§15 scenarios), testing/ (scenario builders, hashes)
  render/        SceneView (Three.js) + layers: terrain, vegetation, flames, embers, smoke, wind, cross-section,
                 icons, sky, camera rig, heightfield picking, legends, palette, demo imagery
  ui/            App shell, screens (notice, setup, building, sim/*, settings), session, stores, widgets, mocks
  styles/        tokens, base, components, screens, sim CSS (day / night themes)
e2e/             Playwright specs (app.spec.ts real engine end to end, sim.spec.ts, ui.spec.ts mock)
docs/research/   literature reviews 01–10, 08b; 00-synthesis.md is the model specification
docs/screenshots/ produced by e2e/app.spec.ts
public/demo/     bundled terrain / canopy / imagery / vegetation / fire history of the 8 demo sites
public/replays/  bundled hourly + 365-day daily weather of the 7 historic fire days
```

## Data flow

```
 Setup (ui/setupModel.buildRequest) ──ScenarioRequest──► scenario/buildScenario(req, onProgress, signal)
     terrain (bundled LiDAR → area pack → Terrarium → synthetic) · canopy · SVTM · NPWS history · weather · drought · fuel
                                                   │ ScenarioData (fire-grid Terrain + 10 m terrainHiRes, FuelMap,
                                                   ▼   WeatherSeries, options, warnings)
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
never rewinds; the cadence continues from the next multiple) and does not change the physics for steps ≥ 12 s. The
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
* Simulation-screen chrome (`ui/screens/sim`): collapsed by default. Two 56 px round menus over the map (`mapMenu.ts`: tools
  on the handed side, view on the other; the list opens beside the button, at most one open, the open state is
  `UiState.menu`), a slim 46 px dock of four 44 px tabs above the timeline (`sheet.ts`; `UiState.sheet` is `closed | peek |
  half | full`, default `closed`) and a thin error chip under the top bar that appears only if the engine fails. The pure
  rules (menu reducer, dock taps and detent heights, list fitting) are in `layoutModel.ts`; `simScreen.ts` measures the
  covered edges (`layoutInsets`) and gives the camera, the crosshair, the round buttons and the legend the visible map (the legend steps
  aside while a round menu is open). Field-use rules, guarded by `ui/styles.rules.test.ts`: every tap target is at least 44 px (the weather
  line under the top bar is a read-out, not a button), no text is under 14 px (dock tabs 16 px), and behind a full-screen dialog (Settings)
  the stage is `inert`, so keyboard focus never walks into hidden controls.
* Setup catalogues come from `src/scenario` (`WEATHER_PRESETS` / `PRESET_IDS`, `REPLAYS`); a preset starts on its
  canonical day and hour (e.g. 20 Dec 11:00 LMST), rounded to 10 min. Belt-kit readings are sent as
  `ScenarioRequest.beltKit` so the builder applies the psychrometer at the real station pressure and the 2 m → 10 m
  wind conversion.
* Performance mode changes during a run call `SimController.setQuality` ('battery' → fast, 'auto' → standard,
  'quality' → high). A fast-tier run offers "Use the 3-D atmosphere" in the Layers panel where it matters.

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
  a screen-door dither as the camera looks down steeply (top view), around active flames (foliage only; torching crowns
  stay), and near an eye-level camera; a solo heat map hides the canopy (`LayerState.soloHeat`).
  Styles (`LayerState.canopyStyle`): `natural`; `simple` (clean uniform low-poly shapes in one restrained palette,
  cheapest); `coded` (the simple shapes coloured by `canopyCode` = height / cover / bark / understorey with the ramps of the
  matching heat map: `canopyCodeScale(code)` returns the heat map's own LUT once `legendFor` has one, and
  `canopyCodeLegend(code)` (also `SceneView.canopyLegend()`) its legend). `canopy*.ts` and `tree*.ts` are pure (Node-testable);
  `devTrees.html` (dev page) shows every species, level, style and fire response (`window.__trees.showcase / eye / forceLod`).

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
  `e2e/sim.spec.ts` (the real worker), `e2e/ui.spec.ts` (the UI on the mocks).
