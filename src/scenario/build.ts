/**
 * `buildScenario(req, onProgress, signal)` — the scenario build pipeline (spec §11.6, §2.3 entry point).
 *
 * Order (BuildProgress.step): terrain → canopy → vegetation → fire history → weather → drought → fuel → places → done
 * (fuel needs DF, KBDI and the month for curing and the class-34 offset; the moisture spin-up runs in the worker).
 * The places context (roads, fire trails, homes, residential zones, place names; context.ts) is started FIRST and runs
 * in parallel with everything else (bundled: a few ms; live: a few seconds of network), then collected in the 'places'
 * step; it is aborted when the build is cancelled or fails.
 *  - terrain: 10 m DEM (bundled LiDAR → area pack → Terrarium tiles → synthetic with a warning) = `terrainHiRes`,
 *    block-averaged to the fire grid (3×3 at 30 m, 2×2 at 20 m), `buildTerrain`, slopeP90Deg / cliffFraction.
 *  - places (context.ts): bundled demo site → area pack → cache → live NSW services → warning; never fails the build.
 *  - canopy, vegetation (SVTM → fuel/ rasteriseVegetation, else inference), fire history (NPWS → fuel/
 *    parseFireHistory + rasteriseFireHistory → fuelHistory, activeFires), weather (§11.1–11.5), drought (§5.7–5.8),
 *    fuel (fuel/ buildFuelMap), options (§12.6: 20 m only when High was requested and the extent is ≤ 6 km).
 * Offline, every layer falls back to bundled / area-pack / cached / inferred data with a warning; the build only
 * fails for an invalid request or when cancelled.
 */
import { DEFAULT_SIM_OPTIONS, type LatLon, type ScenarioData, type SimOptions, type Terrain } from '../core/types';
import { localDate } from '../core/physics';
import { clamp } from '../core/units';
import { DatasetLedger, DEMO_SITES, findAreaPacks, loadBundleManifest, openCache, type KV } from '../data';
import { CLASS_INFER } from '../fuel/catalogue';
import { buildFuelMap } from '../fuel/fuelMap';
import { emptyHistory, parseFireHistoryWithMeta, rasteriseFireHistory, type HistoryRaster } from '../fuel/history';
import { parseVegetation, rasteriseVegetation } from '../fuel/svtm';
import { terrainDerived } from '../terrain';
import { beltKitReading, type BeltKitReading } from './beltKit';
import { loadContext } from './context';
import { assembleDatasets } from './datasetAssembly';
import { describeImagery } from './imagery';
import { loadCanopyLayer, loadFireHistoryLayer, loadVegetationLayer, type LayerContext } from './layers';
import { MESSAGES } from './messages';
import { workingMemoryForScenario } from './memoryModel';
import { builtFireCell, SCENARIO_PARAMS } from './params';
import { replayInfo } from './replays';
import type { BuildDatasetProgress, BuildProgress, ScenarioRequest } from './request';
import { elevationAtLocal, fireTerrainFromHiRes, loadHiResDem, medianOf } from './terrain';
import { applyDrought, resolveDrought, resolveWeather, type WeatherContext } from './weatherSources';

export class BuildCancelledError extends Error {
  override readonly name = 'AbortError';
  constructor() {
    super('Build cancelled');
  }
}

/** Resolved geometry and options of a request (pure; exported for the UI and tests). */
export interface ResolvedRequest {
  centre: LatLon;
  extent: number;
  fireCellSize: number;
  demoSiteId?: string;
  duration: number;
  name: string;
  warnings: string[];
}

/**
 * Normalise a request (§11.4, §11.6): a replay runs at its demo site; replays and offline demo runs clamp the extent to
 * the bundled 9 km; the extent is clamped to 3–12 km and snapped to a multiple of the fire cell; the fire cell is 20 m
 * only when High detail was requested and the extent is ≤ 6 km, else 30 m.
 */
export function resolveRequest(req: ScenarioRequest): ResolvedRequest {
  const P = SCENARIO_PARAMS;
  const warnings: string[] = [];
  let centre = { lat: req.centre.lat, lon: req.centre.lon };
  let demoSiteId = req.demoSiteId;
  let name = req.name;
  if (req.weather.kind === 'replay') {
    const info = replayInfo(req.weather.replayId);
    const site = info ? DEMO_SITES.find((s) => s.id === info.site) : undefined;
    if (!info || !site) throw new Error(`Unknown replay '${req.weather.replayId}'`);
    centre = { ...site.centre };
    demoSiteId = site.id;
    name ??= info.name;
  }
  if (!Number.isFinite(centre.lat) || !Number.isFinite(centre.lon) || Math.abs(centre.lat) > 90) throw new RangeError('Scenario centre is not a valid location');
  let extent = Number.isFinite(req.extent) && req.extent > 0 ? req.extent : demoSiteId ? P.demoExtentM : 6000;
  extent = clamp(extent, P.minExtentM, P.maxExtentM);
  if (demoSiteId && (req.weather.kind === 'replay' || !req.online) && extent > P.demoExtentM) {
    extent = P.demoExtentM;
    warnings.push(MESSAGES.extentClamped(P.demoExtentM / 1000, req.weather.kind === 'replay' ? 'replays use the bundled 9 km demo area' : 'offline: bundled 9 km demo area'));
  }
  const cell = builtFireCell(extent, req.options?.fireCellSize, req.options?.tier);
  const fireCellSize = cell.cellM;
  if (cell.coarsened) warnings.push(MESSAGES.cellCoarsened(P.fireCellM));
  extent = Math.round(extent / fireCellSize) * fireCellSize;
  const duration = Number.isFinite(req.duration) && req.duration > 0 ? req.duration : P.defaultDurationS;
  const site = demoSiteId ? DEMO_SITES.find((s) => s.id === demoSiteId) : undefined;
  name ??= site?.name ?? `${centre.lat.toFixed(3)}, ${centre.lon.toFixed(3)}`;
  const out: ResolvedRequest = { centre, extent, fireCellSize, duration, name, warnings };
  if (demoSiteId) out.demoSiteId = demoSiteId;
  return out;
}

/** Simulation options for the built grids (§12.6 tier defaults unless the request sets them). */
export function resolveOptions(req: ScenarioRequest, extent: number, fireCellSize: number): SimOptions {
  const given = req.options ?? {};
  const o: SimOptions = { ...DEFAULT_SIM_OPTIONS, ...given, fireCellSize };
  const tier = o.tier ?? 'auto';
  o.tier = tier;
  if (given.atmosCellSize === undefined) o.atmosCellSize = Math.round(clamp(extent / (tier === 'high' ? 60 : 45), 100, 270));
  if (given.atmosLevels === undefined) o.atmosLevels = tier === 'high' ? 24 : 20;
  if (given.atmosDz1 === undefined) o.atmosDz1 = tier === 'high' ? 25 : 30;
  if (given.maxEmbers === undefined) o.maxEmbers = tier === 'fast' ? 2000 : 4000;
  return o;
}

/**
 * Build a {@link ScenarioData} for a request. `onProgress` receives each step with the warnings so far; `signal`
 * cancels (rejects with an AbortError). Never fails for missing data: each fallback adds a warning.
 */
export async function buildScenario(req: ScenarioRequest, onProgress: (p: BuildProgress) => void = () => {}, signal?: AbortSignal): Promise<ScenarioData> {
  // The places query runs in the background under its own signal: it stops with the caller's, and also when the build
  // fails or finishes, so no request is left running.
  const background = new AbortController();
  const stop = (): void => background.abort(signal?.reason ?? new BuildCancelledError());
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
  try {
    return await runBuild(req, onProgress, signal, background.signal);
  } finally {
    signal?.removeEventListener('abort', stop);
    background.abort(new BuildCancelledError());
  }
}

async function runBuild(req: ScenarioRequest, onProgress: (p: BuildProgress) => void, signal: AbortSignal | undefined, backgroundSignal: AbortSignal): Promise<ScenarioData> {
  const warnings: string[] = [];
  const addWarnings = (ws: readonly string[]): void => {
    for (const w of ws) if (!warnings.includes(w)) warnings.push(w);
  };
  const report = (step: BuildProgress['step'], fraction: number, message: string): void => {
    try {
      onProgress({ step, fraction: clamp(fraction, 0, 1), message, warnings: [...warnings], datasets: datasetProgress(ledger) });
    } catch {
      /* a failing progress callback must not break the build */
    }
  };
  const check = (): void => {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new BuildCancelledError();
  };
  const now = req.now ?? Date.now();
  const kv: KV = openCache();
  // The request ledger counts the bytes, requests and times of every read of this build, per data set (data/ledger.ts).
  const ledger = new DatasetLedger();
  const startedAt = Date.now();
  const timings: Partial<Record<'terrain' | 'imagery' | 'canopy' | 'vegetation' | 'fireHistory' | 'weather' | 'drought' | 'fuel' | 'places', number>> = {};
  let stepStart = ledger.now();
  const lap = (name: keyof typeof timings): void => {
    const t = ledger.now();
    timings[name] = t - stepStart;
    stepStart = t;
  };
  const rr = resolveRequest(req);
  addWarnings(rr.warnings);
  const layerCtx: LayerContext = { centre: rr.centre, extent: rr.extent, online: req.online, kv, ledger, ...(rr.demoSiteId ? { demoSiteId: rr.demoSiteId } : {}), ...(signal ? { signal } : {}) };
  check();

  // ── places (roads, homes, place names): started now, collected after the fuel step ──
  let placesActive = false;
  let placesNote = 'Roads, homes and place names…';
  const placesStart = ledger.now();
  const placesTask = loadContext({
    ...layerCtx,
    signal: backgroundSignal,
    now,
    onProgress: (f, m) => {
      placesNote = m;
      if (placesActive) report('places', 0.9 + 0.08 * f, m);
    },
  });
  placesTask.catch(() => {}); // a cancelled build must not leave an unhandled rejection; the await below re-throws

  // ── terrain ──
  report('terrain', 0.02, 'Loading terrain…');
  stepStart = ledger.now();
  const hi = await loadHiResDem({
    centre: rr.centre,
    extent: rr.extent,
    online: req.online,
    kv,
    ledger,
    ...(rr.demoSiteId ? { demoSiteId: rr.demoSiteId } : {}),
    ...(signal ? { signal } : {}),
    onProgress: (f, m) => report('terrain', 0.02 + 0.1 * f, m),
  });
  check();
  addWarnings(hi.warnings);
  report('terrain', 0.13, 'Analysing slopes, aspects and landforms…');
  const terrain: Terrain = fireTerrainFromHiRes(hi.dem, rr.fireCellSize);
  const derived = terrainDerived(terrain);
  const zMedian = medianOf(terrain.elevation);
  const zCentre = elevationAtLocal(terrain, 0, 0);
  lap('terrain');
  check();

  // ── canopy ──
  report('canopy', 0.2, 'Canopy height…');
  const canopy = await loadCanopyLayer(terrain.grid, layerCtx);
  addWarnings(canopy.warnings);
  lap('canopy');
  check();

  // ── vegetation ──
  report('vegetation', 0.3, 'Vegetation map…');
  const veg = await loadVegetationLayer(layerCtx);
  addWarnings(veg.warnings);
  const n = terrain.grid.nx * terrain.grid.ny;
  let classId: Uint8Array;
  let minorityWet: Uint8Array;
  const vegRecs = veg.geojson ? parseVegetation(veg.geojson) : [];
  if (vegRecs.length) {
    report('vegetation', 0.35, `Mapping ${vegRecs.length} vegetation polygons…`);
    ({ classId, minorityWet } = rasteriseVegetation(terrain.grid, vegRecs, terrain));
    if (veg.partial) addWarnings([MESSAGES.vegetationPartial]);
  } else {
    classId = new Uint8Array(n).fill(CLASS_INFER);
    minorityWet = new Uint8Array(n);
    addWarnings([MESSAGES.vegetationInferred]);
  }
  lap('vegetation');
  check();

  // ── fire history (parsed now, rasterised at the final t0 in the fuel step) ──
  report('fireHistory', 0.45, 'Fire history…');
  const fh = await loadFireHistoryLayer(layerCtx);
  addWarnings(fh.warnings);
  const parsedHistory = fh.geojson ? parseFireHistoryWithMeta(fh.geojson) : null;
  if (!parsedHistory) addWarnings([MESSAGES.fireHistoryUnavailable]);
  else if (fh.partial) addWarnings([MESSAGES.fireHistoryPartial]);
  lap('fireHistory');
  check();

  // ── weather ──
  report('weather', 0.55, 'Weather…');
  // Belt-kit readings (§11.5): the station pressure defaults to ISA at the site (domain centre) elevation. A reading
  // that cannot be converted (wet bulb warmer than the dry bulb) is skipped with a warning, not a failed build.
  let belt: BeltKitReading[] | undefined;
  if (req.beltKit?.length) {
    belt = [];
    for (const b of req.beltKit) {
      try {
        belt.push(beltKitReading({ ...b, elevation: b.elevation ?? zCentre }));
      } catch (e) {
        addWarnings([MESSAGES.beltKitRejected(e instanceof Error ? e.message : String(e))]);
      }
    }
    if (!belt.length) belt = undefined;
  }
  const wctx: WeatherContext = {
    centre: rr.centre,
    online: req.online,
    kv,
    now,
    duration: rr.duration,
    medianElevation: zMedian,
    centreElevation: zCentre,
    relief: terrain.maxElevation - terrain.minElevation,
    ledger,
    onStatus: (m) => report('weather', 0.6, m),
    ...(rr.demoSiteId ? { siteId: rr.demoSiteId } : {}),
    ...(signal ? { signal } : {}),
    ...(belt ? { beltKit: belt } : {}),
  };
  const weather = await resolveWeather(req.weather, wctx);
  addWarnings(weather.warnings);
  lap('weather');
  check();
  const t0 = weather.t0;
  let duration = rr.duration;
  if (weather.maxDuration < duration) {
    duration = Math.max(SCENARIO_PARAMS.minWeatherAfterStartH * 3600, Math.floor(weather.maxDuration / 600) * 600);
    addWarnings([MESSAGES.durationClamped(duration / 3600)]);
  }

  // ── drought ──
  report('drought', 0.7, 'Drought (KBDI, drought factor)…');
  const drought = await resolveDrought(weather, wctx);
  applyDrought(weather.series, drought);
  addWarnings(drought.warnings);
  lap('drought');
  check();

  // ── fuel ──
  report('fuel', 0.8, 'Fuel map…');
  let history: HistoryRaster;
  if (parsedHistory) {
    history = rasteriseFireHistory(terrain.grid, parsedHistory.records, t0, { verDate: parsedHistory.verDate, classId });
  } else history = emptyHistory(terrain.grid);
  addWarnings(history.warnings);
  const sources = [hi.dem.source, veg.source, fh.source, canopy.canopy?.source ?? 'Canopy: type defaults'];
  const fuel = buildFuelMap({
    terrain,
    derived,
    classId,
    minorityWet,
    history,
    canopy: canopy.canopy ? { height: canopy.canopy.height, cover: canopy.canopy.cover, valid: canopy.canopy.valid } : null,
    t0,
    droughtFactor: drought.df,
    kbdi: drought.kbdi,
    month: Number(localDate(t0).slice(5, 7)),
    sources,
  });
  lap('fuel');
  check();

  // ── places ──
  report('places', 0.9, placesNote);
  placesActive = true;
  const places = await placesTask;
  timings.places = ledger.now() - placesStart;
  check();
  addWarnings(places.warnings);

  // ── imagery (display only: which photo the view will show, and what it is) and the bundled-data manifest ──
  const tImagery = ledger.now();
  const imagery = await describeImagery(terrain.grid, layerCtx).catch(() => null);
  timings.imagery = ledger.now() - tImagery;
  const bundle = await loadBundleManifest(signal).catch(() => null);
  const packs = await findAreaPacks(rr.centre, rr.extent, kv).catch(() => []);
  check();

  // ── options, assembly ──
  const options = resolveOptions(req, rr.extent, rr.fireCellSize);
  const series = weather.series;
  // Every build warning (terrain, layers, weather, drought, fuel) travels with the scenario on weather.warnings, the
  // only warning slot of ScenarioData, so a saved or re-opened scenario still explains its fallbacks.
  addWarnings(weather.warnings);
  addWarnings(drought.warnings);
  series.warnings = [...(series.warnings ?? []), ...warnings].filter((w, i, a) => a.indexOf(w) === i);
  const idPlace = rr.demoSiteId ?? `${rr.centre.lat.toFixed(3)},${rr.centre.lon.toFixed(3)}`;
  const scenario: ScenarioData = {
    id: `${idPlace}-${new Date(t0).toISOString().slice(0, 16).replace(/[-:]/g, '')}Z-${req.weather.kind}`,
    name: rr.name,
    origin: { ...rr.centre },
    extent: rr.extent,
    terrain,
    fuel,
    weather: series,
    startTime: t0,
    duration,
    ignitions: [],
    edits: [...weather.edits],
    options,
    terrainHiRes: { grid: hi.dem.grid, elevation: hi.dem.elevation },
    fuelHistory: history.compact,
    activeFires: history.activeFires,
    ...(places.context ? { context: places.context } : {}),
  };
  // ── the data-set inventory: what went into this scenario, with sizes, origins, dates and licences ──
  try {
    const { datasets, summary } = assembleDatasets({
      ledger,
      bundle,
      now,
      startedAt,
      builtAt: Date.now(),
      request: req,
      rr,
      options,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      startTime: t0,
      durationS: duration,
      terrain,
      hiRes: { grid: hi.dem.grid, elevation: hi.dem.elevation },
      hi,
      localRelief: derived.localRelief,
      terrainMedianElevation: zMedian,
      imagery,
      canopy,
      veg,
      vegPolygons: vegRecs.length,
      fh,
      parsedHistory,
      includedFires: history.included,
      activeFires: history.activeFires,
      fuelHistory: history.compact,
      fuel,
      weather,
      drought,
      series,
      places,
      edits: scenario.edits,
      ignitions: scenario.ignitions,
      beltReadings: belt?.length ?? 0,
      timings,
      warnings: { terrain: hi.warnings, canopy: canopy.warnings, vegetation: veg.warnings, fireHistory: [...fh.warnings, ...history.warnings], weather: weather.warnings, drought: drought.warnings },
      allWarnings: series.warnings ?? [],
      // What the run will hold in memory: the scenario measured, the engine modelled from these grids (memoryModel.ts).
      workingMemory: workingMemoryForScenario(scenario, imagery ? { imagery: { width: imagery.drawnPx.w, height: imagery.drawnPx.h } } : {}),
      packs,
    });
    scenario.datasets = datasets;
    scenario.datasetSummary = summary;
  } catch (e) {
    // The inventory is documentation: a bug in it must never cost the user their scenario.
    console.warn('[scenario] data-set inventory failed', e);
  }
  report('done', 1, 'Scenario ready');
  return scenario;
}

/** Warnings a built scenario carries (all build warnings are copied onto `weather.warnings`). */
export const scenarioWarnings = (s: ScenarioData): string[] => s.weather.warnings ?? [];

/** The ledger's per-data-set totals so far, for the progress events (the Building screen lists the data sets as they arrive). */
function datasetProgress(ledger: DatasetLedger): BuildDatasetProgress[] {
  return ledger.tags().map((id) => {
    const t = ledger.totals(id);
    return { id, requests: t.requests, failures: t.failures, bytes: t.bytes, networkBytes: t.networkBytes, networkUnmeasuredBytes: t.networkUnmeasuredBytes, cacheBytes: t.cacheBytes, packBytes: t.packBytes, bundledBytes: t.bundledBytes };
  });
}
