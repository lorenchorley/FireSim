/**
 * Public API of the data providers (see docs/ARCHITECTURE.md → data/).
 * Weather, fire history, vegetation and incident providers are added alongside these modules.
 */
export {
  SERVICES,
  serviceUrl,
  routeUrl,
  fetchJson,
  fetchBinary,
  fetchText,
  httpRequest,
  HttpError,
  isHttpError,
  setHttpConfig,
  resetHttpConfig,
  getHttpConfig,
  detectPlatform,
  base64ToBytes,
  toArrayBuffer,
  type ServiceId,
  type HttpPlatform,
  type HttpConfig,
  type HttpErrorKind,
  type RequestOptions,
  type RawResponse,
} from './http';

export {
  openCache,
  setDefaultCache,
  createMemoryKV,
  createIndexedDbKV,
  clearCache,
  saveAreaPack,
  listAreaPacks,
  loadAreaPack,
  loadAreaPackItem,
  deleteAreaPack,
  findAreaPacks,
  areaPackCovers,
  cachedFetch,
  cachedFetchBinary,
  cachedFetchJson,
  CACHE_DB_NAME,
  CACHE_STORE_NAME,
  type KV,
  type AreaPack,
  type AreaPackItem,
  type AreaPackMeta,
  type CachedFetchOptions,
  type CachedResult,
  type CacheOrigin,
} from './cache';

export { loadAsset, loadAssetJson, setAssetLoader, setAssetBase, resolveAssetBase, setNodePublicDir, type AssetLoader } from './assets';

export {
  decodeTerrarium,
  encodeTerrariumPixels,
  loadElevation,
  elevationTilesFor,
  terrariumTileUrl,
  terrariumTileKey,
  defaultElevationZoom,
  clearDemoManifestCache,
  ElevationUnavailableError,
  syntheticElevation,
  syntheticSource,
  TERRARIUM_SOURCE,
  TERRARIUM_TILE_SIZE,
  TERRARIUM_MAX_ZOOM,
  type DecodedTerrarium,
  type ElevationRequest,
  type ElevationResult,
  type SyntheticTerrainKind,
} from './terrainTiles';

export {
  loadCanopy,
  loadBundledCanopyRaster,
  loadRemoteCanopy,
  remoteCanopyCacheKey,
  quadkey,
  CHM_SOURCE,
  MAX_REMOTE_CANOPY_EXTENT,
  CANOPY_COVER_THRESHOLD,
  type CanopyResult,
  type CanopyOptions,
} from './canopy';

export { DEMO_SITES, DEMO_EXTENT_M, DEMO_TILE_ZOOM, type DemoSite } from './demoSites';
export {
  LIDAR_DEM_SOURCE,
  demoRasterGrid,
  loadDemoDem,
  loadDemoElevation,
  rasterCovers,
  loadDemoImageryInfo,
  loadDemoImageryBytes,
  imageryWindow,
  loadDemoFireHistoryGeoJson,
  loadDemoVegetationGeoJson,
  type DemoRasterMeta,
  type GeoJsonFeatureCollection,
  type NpwsFireProps,
  type SvtmProps,
} from './demoRasters';

export {
  decodeContext,
  decodeLine,
  demoSiteCovering,
  loadBundledContext,
  roadLengthByClass,
  type ContextFileV1,
} from './contextLayers';

export {
  fetchNswContext,
  fetchNswContextFile,
  NswContextUnavailableError,
  contextQueryBBox,
  contextCacheKey,
  CONTEXT_QUERY_LABELS,
  CONTEXT_BBOX_GRID_DEG,
  CONTEXT_MARGIN_M,
  type NswContextOptions,
  type NswContextFileResult,
  type ContextQueryId,
  type BBox,
} from './nswContext';
export { buildContextFile, CONTEXT_QUERIES, CONTEXT_QUERY_IDS, zoneKind, roadClassOf, surfaceOf, roadName, titleCase, placeKindOf, type EsriFeature, type ContextFeatures } from './nswContextCore';
