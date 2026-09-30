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
  type ResponseInfo,
  type RawResponse,
} from './http';

export {
  DatasetLedger,
  endpointOf,
  pathPattern,
  traceRead,
  traceFields,
  withTrace,
  type LedgerEntry,
  type LedgerInput,
  type LedgerSource,
  type LedgerTotals,
  type LedgerEndpoint,
  type LedgerOptions,
  type TraceOptions,
} from './ledger';

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
  approxBytes,
  storedBytes,
  storedAt,
  CACHE_DB_NAME,
  CACHE_STORE_NAME,
  type KV,
  type KVSize,
  type AreaPack,
  type AreaPackItem,
  type AreaPackMeta,
  type CachedFetchOptions,
  type CachedResult,
  type CacheOrigin,
} from './cache';

export {
  storage,
  storageReport,
  clearCacheKind,
  removeAreaPack,
  placeOfKey,
  placeLabel,
  STORAGE_KINDS,
  STORAGE_WARN_BYTES,
  type StorageKind,
  type StorageReport,
  type StorageGroup,
  type StoragePack,
  type StoragePlace,
} from './storage';
export { loadBundleManifest, clearBundleManifestCache, bundleFile, type BundleManifest, type BundleSite, type BundleFile } from './bundleManifest';
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
  DEM5M_SOURCE,
  LIDAR_DEM_SOURCE,
  demoRasterGrid,
  loadDemoDem,
  loadDemoDemMeta,
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
  CONTEXT_DATASET_ID,
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
