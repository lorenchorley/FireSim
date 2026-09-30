/**
 * Assembles the data-set records of a finished build (core/datasets.ts) from what each step reported.
 *
 * `assembleDatasets` is pure given its inputs (the ledger has already counted the bytes); scenario/build.ts calls it once
 * at the end of a build. The record builders live in datasetRecords.ts (map data), datasetRecordsWeather.ts and
 * datasetRecordsPlaces.ts (places, fuel, your input, bundle).
 */
import { resummarise, sortDatasets, summariseDatasets, upsertDataset, type DatasetRecord, type DatasetSummary, type WorkingMemory } from '../core/datasets';
import type { FireHistoryRecord, FuelMap, Ignition, ScenarioData, ScenarioEdit, SimOptions, Terrain, WeatherSeries } from '../core/types';
import type { AreaPackMeta, BundleManifest, DatasetLedger } from '../data';
import type { ParsedFireHistory } from '../fuel/history';
import type { ContextResult } from './context';
import { canopyRecord, fireHistoryRecord, imageryRecord, terrainRecord, vegetationRecord, type MapInputs } from './datasetRecords';
import { droughtRecord, upperAirRecord, weatherRecord, type WeatherInputs } from './datasetRecordsWeather';
import { bundleRecord, fuelRecord, packRecord, placesRecords, userEditsRecord } from './datasetRecordsPlaces';
import type { ImageryInfo } from './imagery';
import type { CanopyLayer, VectorLayer } from './layers';
import type { ResolvedRequest } from './build';
import type { ScenarioRequest } from './request';
import { extentOf } from './recordKit';
import type { HiResResult } from './terrain';
import type { DroughtResult, ResolvedWeather } from './weatherSources';

export interface AssembleInputs {
  ledger: DatasetLedger;
  bundle: BundleManifest | null;
  /** The build's clock (unix ms). */
  now: number;
  /** Wall clock (unix ms) at the start and end of the build. */
  startedAt: number;
  builtAt: number;
  request: ScenarioRequest;
  rr: ResolvedRequest;
  options: SimOptions;
  scenarioId: string;
  scenarioName: string;
  startTime: number;
  durationS: number;
  terrain: Terrain;
  hiRes: { grid: { nx: number; ny: number; cellSize: number }; elevation: Float32Array };
  hi: HiResResult;
  localRelief?: Float32Array;
  terrainMedianElevation: number;
  imagery: ImageryInfo | null;
  canopy: CanopyLayer;
  veg: VectorLayer;
  vegPolygons: number;
  fh: VectorLayer;
  parsedHistory: ParsedFireHistory | null;
  includedFires: readonly FireHistoryRecord[];
  activeFires: readonly FireHistoryRecord[];
  /** The scenario's per-cell fire-record index (ScenarioData.fuelHistory), measured for the fire-history memory. */
  fuelHistory?: object;
  fuel: FuelMap;
  weather: ResolvedWeather;
  drought: DroughtResult;
  series: WeatherSeries;
  places: ContextResult;
  edits: readonly ScenarioEdit[];
  ignitions: readonly Ignition[];
  beltReadings: number;
  timings: Partial<Record<'terrain' | 'imagery' | 'canopy' | 'vegetation' | 'fireHistory' | 'weather' | 'drought' | 'fuel' | 'places', number>>;
  warnings: { terrain: string[]; canopy: string[]; vegetation: string[]; fireHistory: string[]; weather: string[]; drought: string[] };
  /** Every build warning, once. */
  allWarnings: readonly string[];
  workingMemory?: WorkingMemory;
  /** Area packs covering the domain (their metadata), for the 'area-pack' record. */
  packs?: readonly AreaPackMeta[];
}

export interface AssembledDatasets {
  datasets: DatasetRecord[];
  summary: DatasetSummary;
}

/** Build all records and the summary for a finished build. */
export function assembleDatasets(a: AssembleInputs): AssembledDatasets {
  const map: MapInputs = {
    ledger: a.ledger,
    bundle: a.bundle,
    now: a.now,
    centre: a.rr.centre,
    extentM: a.rr.extent,
    fireCellM: a.rr.fireCellSize,
    online: a.request.online,
    ...(a.rr.demoSiteId ? { demoSiteId: a.rr.demoSiteId } : {}),
    terrain: a.terrain,
    hiRes: a.hiRes,
    hi: a.hi,
    ...(a.localRelief ? { localRelief: a.localRelief } : {}),
    imagery: a.imagery,
    canopy: a.canopy,
    veg: a.veg,
    vegPolygons: a.vegPolygons,
    fh: a.fh,
    parsedHistory: a.parsedHistory,
    fuel: a.fuel,
    includedFires: a.includedFires,
    activeFires: a.activeFires,
    ...(a.fuelHistory ? { fuelHistory: a.fuelHistory } : {}),
    timings: { terrain: a.timings.terrain, imagery: a.timings.imagery, canopy: a.timings.canopy, vegetation: a.timings.vegetation, fireHistory: a.timings.fireHistory },
    warnings: { terrain: a.warnings.terrain, canopy: a.warnings.canopy, vegetation: a.warnings.vegetation, fireHistory: a.warnings.fireHistory },
  };
  const wx: WeatherInputs = {
    ledger: a.ledger,
    bundle: a.bundle,
    now: a.now,
    centre: a.rr.centre,
    extentM: a.rr.extent,
    online: a.request.online,
    weather: a.weather,
    drought: a.drought,
    series: a.series,
    startTime: a.startTime,
    durationS: a.durationS,
    terrainMedianElevation: a.terrainMedianElevation,
    timings: { weather: a.timings.weather, drought: a.timings.drought },
    warnings: { weather: a.warnings.weather, drought: a.warnings.drought },
    isPast: a.request.weather.kind === 'past',
  };
  const records: DatasetRecord[] = [terrainRecord(map), imageryRecord(map), vegetationRecord(map), canopyRecord(map), fireHistoryRecord(map)];
  records.push(weatherRecord(wx), upperAirRecord(wx), droughtRecord(wx));
  records.push(...placesRecords({ ledger: a.ledger, bundle: a.bundle, now: a.now, centre: a.rr.centre, extentM: a.rr.extent, places: a.places, ...(a.timings.places !== undefined ? { timingMs: a.timings.places } : {}) }));
  records.push(fuelRecord({ now: a.now, centre: a.rr.centre, extentM: a.rr.extent, fuel: a.fuel, inputs: records, ...(a.timings.fuel !== undefined ? { timingMs: a.timings.fuel } : {}) }));
  records.push(userEditsRecord({ now: a.now, edits: a.edits, ignitions: a.ignitions, weatherKind: a.series.kind, beltReadings: a.beltReadings }));
  const sites = [a.hi.siteId, ...(a.hi.info.tiles?.sites ?? []), a.veg.info.siteId, a.fh.info.siteId, a.canopy.canopy?.site, a.imagery?.siteId, a.places.info.siteId].filter((s): s is string => !!s);
  const bundle = bundleRecord({ now: a.now, centre: a.rr.centre, extentM: a.rr.extent, sites, bundle: a.bundle, ledger: a.ledger, ...(a.weather.detail.replay ? { replayId: a.weather.detail.replay.id } : {}), ...(a.imagery ? { extraReadBytes: a.imagery.jpgBytes } : {}) });
  if (bundle) records.push(bundle);
  const usedPacks = [a.hi.info.packName, ...(a.hi.info.tiles?.packs ?? []), a.veg.info.packName, a.fh.info.packName, a.canopy.info.packName, a.weather.detail.packName, a.drought.info?.packName, a.places.info.packName].filter((n): n is string => !!n);
  const pack = usedPacks.length && a.packs?.length ? packRecord({ now: a.now, centre: a.rr.centre, extentM: a.rr.extent, packs: a.packs, used: usedPacks, ledger: a.ledger }) : null;
  if (pack) records.push(pack);
  const datasets = sortDatasets(records);
  const g = a.terrain.grid;
  const ext = extentOf(a.rr.centre, a.rr.extent);
  const wm = a.request.weather;
  const summary = summariseDatasets(datasets, {
    scenarioId: a.scenarioId,
    scenarioName: a.scenarioName,
    seed: a.options.seed,
    builtAt: a.builtAt,
    buildDurationMs: Math.max(0, a.builtAt - a.startedAt),
    model: {
      nx: g.nx,
      ny: g.ny,
      cells: g.nx * g.ny,
      cellSizeM: g.cellSize,
      extentM: a.rr.extent,
      hiResCellM: a.hiRes.grid.cellSize,
      hiResNx: a.hiRes.grid.nx,
      hiResNy: a.hiRes.grid.ny,
      atmosCellM: a.options.atmosCellSize,
      atmosLevels: a.options.atmosLevels,
      ...(a.options.tier ? { tier: a.options.tier } : {}),
      durationS: a.durationS,
      startTime: a.startTime,
    },
    warnings: a.allWarnings,
    reproduce: {
      scenarioId: a.scenarioId,
      seed: a.options.seed,
      centre: { ...a.rr.centre },
      bbox: [ext.west, ext.south, ext.east, ext.north],
      extentM: a.rr.extent,
      cellSizeM: g.cellSize,
      startTime: a.startTime,
      durationS: a.durationS,
      weatherMode: wm.kind === 'preset' ? `preset:${wm.presetId}` : wm.kind === 'replay' ? `replay:${wm.replayId}` : wm.kind,
      ...(a.rr.demoSiteId ? { demoSiteId: a.rr.demoSiteId } : {}),
      online: a.request.online,
    },
    ...(a.workingMemory ? { workingMemory: a.workingMemory } : {}),
  });
  return { datasets, summary };
}

/**
 * The scenario with one data-set record added or replaced and the summary re-totalled (a shallow copy; the grids are
 * shared). For records made after the build: the start-of-run fuel moisture (`describeStartMoisture`, from the first
 * snapshot) or the user's edits (`userEditsRecord`) once the user has edited.
 */
export function withRecord(s: ScenarioData, record: DatasetRecord): ScenarioData {
  const datasets = upsertDataset(s.datasets, record);
  return { ...s, datasets, ...(s.datasetSummary ? { datasetSummary: resummarise(s.datasetSummary, datasets) } : {}) };
}
