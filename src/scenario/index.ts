/**
 * scenario/ — weather sources, presets, replays, belt kit and the scenario build pipeline
 * (spec docs/research/00-synthesis.md §11; entry point §2.3: `buildScenario(req, onProgress, signal)`).
 * All [H]/UNVERIFIED parameters are in {@link SCENARIO_PARAMS}; user-visible warnings in {@link MESSAGES}.
 */
export type { WeatherMode, ScenarioRequest, BuildProgress } from './request';
export { buildScenario, resolveRequest, resolveOptions, scenarioWarnings, BuildCancelledError, type ResolvedRequest } from './build';
export { SCENARIO_PARAMS, demoAnnualRainfall, type ScenarioParams, type BeltExposure } from './params';
export { MESSAGES } from './messages';

// Weather: Open-Meteo requests / parsing, interpolation.
export {
  OM_SURFACE_VARS,
  OM_LEVEL_VARS,
  OM_HOURLY_VARS,
  OM_ERA5_VARS,
  OM_DAILY_VARS,
  OM_LEVELS,
  SURFACE_MODELS,
  LEVEL_MODELS,
  forecastUrl,
  historicalForecastUrl,
  archiveHourlyUrl,
  archiveDailyUrl,
  levelFallbackUrl,
  parseOpenMeteoHourly,
  parseOpenMeteoDaily,
  parseOmTime,
  mergePressureLevels,
  dailyFromHourly,
  annualRainfallFromDaily,
  stampClearness,
  clearSkyGhi,
  fillGaps,
  WeatherParseError,
  type OpenMeteoResponse,
  type ParseHourlyOptions,
  type ParseHourlyResult,
} from './openMeteo';
export { weatherAt, ghiAt, clearnessAt, stampIndex, seriesSpan, seriesCovers, trimSeries, rainBetween, insertStamp } from './weather';
export {
  resolveWeather,
  resolveDrought,
  applyDrought,
  dailyHistory,
  annualRainfall,
  droughtFromDaily,
  rainTodayBefore,
  livePlan,
  forecastPastDaysFor,
  omFetch,
  omCacheKey,
  OfflineError,
  type WeatherContext,
  type ResolvedWeather,
  type DailyHistory,
  type DroughtResult,
} from './weatherSources';

// Presets, replays, belt kit.
export {
  WEATHER_PRESETS,
  PRESET_IDS,
  isPresetId,
  presetDiurnal,
  presetStateAt,
  presetUpperAir,
  changeBlend,
  type PresetId,
  type PresetSite,
  type WeatherPreset,
  type WeatherPresetDef,
  type PresetChange,
  type RatingName,
} from './presets';
export { REPLAYS, replayInfo, loadReplay, replayDefaultStart, clampReplayStart, replayAssetPaths, type ReplayInfo, type LoadedReplay } from './replays';
export {
  psychrometerRh,
  kitWindTo10m,
  beltKitReading,
  beltKitSeries,
  manualSeriesFromReadings,
  normaliseManualSeries,
  manualDrought,
  applyBeltKitToForecast,
  beltOffsetWeight,
  beltLapseRate,
  kbdiFromDf,
  type BeltKitInput,
  type BeltKitReading,
  type ManualReading,
  type ManualSeriesOptions,
} from './beltKit';

// Terrain and layers.
export { fireTerrainFromHiRes, loadHiResDem, slopeDegOf, blockFactor, medianOf, elevationAtLocal, demoSitesNear, type HiResDem, type HiResResult, type HiResRequest, type TerrainOrigin } from './terrain';
export {
  loadCanopyLayer,
  loadVegetationLayer,
  loadFireHistoryLayer,
  fetchSvtm,
  fetchNpwsFireHistory,
  fetchArcGisFeatures,
  arcgisQuery,
  domainBBox,
  demoCoverage,
  canopyOnGrid,
  SVTM_QUERY_PATH,
  NPWS_FIRE_QUERY_PATH,
  type LayerContext,
  type LayerOrigin,
  type VectorLayer,
  type CanopyLayer,
  type PackCanopy,
} from './layers';

// Places context: roads, fire trails, homes, residential zones, place names (bundled → area pack → cache → live NSW services).
export { loadContext, resolveContextFile, contextForPack, isContextFile, CONTEXT_PACK_ITEM, type ContextRequest, type ContextResult, type ContextOrigin } from './context';

// Offline area packs and live context feeds.
export { downloadAreaPack, type AreaPackRequest, type AreaPackResult, type AreaPackProgress, type PackDaily } from './areaPack';
export {
  parseMajorIncidents,
  parseRfsPubDate,
  parseRfsDescription,
  incidentsNear,
  incidentRingsLocal,
  parseFdrToban,
  districtFor,
  officialRatingChip,
  parseHotspots,
  hotspotsUrl,
  fetchMajorIncidents,
  fetchFdrToban,
  fetchHotspots,
  loadLiveContext,
  DEMO_SITE_COUNCILS,
  DEA_WFS,
  type FireDangerDistrict,
  type Hotspot,
  type LiveContext,
} from './feeds';
export { zoneOffsetMs, civilDate, civilToUtc, lmstToUtc, lmstDate, lmstMidnight, addDaysIso, daysBetweenIso } from './time';
