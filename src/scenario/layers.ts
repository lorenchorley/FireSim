/**
 * Canopy, vegetation (SVTM) and fire-history (NPWS) layers for a scenario, with the §11.6 fallback chains:
 *
 * | layer        | chain                                                                                   |
 * |--------------|-----------------------------------------------------------------------------------------|
 * | canopy       | demo raster → area pack → remote CHM COGs (online, extent ≤ 3 km) → none (type defaults)  |
 * | vegetation   | demo GeoJSON / area pack / network SVTM layer 3 (D35) → inference (fuel/ §4.3)            |
 * | fire history | demo GeoJSON / area pack / network NPWS query → none (steady-state fuel, D40)             |
 *
 * Network queries use the verified ArcGIS REST patterns of doc 08b §3–4 (paged by 1000, geojson, EPSG:4326) through
 * the data/ HTTP layer (proxy routing for the non-CORS NSW services in browsers) and are cached (network-first), so a
 * second build of the same area works offline.
 */
import type { GridSpec, LatLon } from '../core/types';
import { LocalProjection } from '../core/geo';
import {
  cachedFetchJson,
  findAreaPacks,
  loadAreaPackItem,
  loadCanopy,
  loadDemoFireHistoryGeoJson,
  loadDemoVegetationGeoJson,
  serviceUrl,
  isHttpError,
  type CanopyResult,
  type GeoJsonFeatureCollection,
  type KV,
} from '../data';
import { mapGrids, resampleMapped } from '../data/canopy';
import { DEMO_SITES } from '../data/demoSites';
import { MESSAGES } from './messages';
import { SCENARIO_PARAMS } from './params';

export type LayerOrigin = 'demo' | 'pack' | 'network' | 'cache' | 'none';

export interface LayerContext {
  centre: LatLon;
  extent: number;
  demoSiteId?: string;
  online: boolean;
  signal?: AbortSignal;
  kv?: KV;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────

/** WGS84 bounding box (west, south, east, north) of the domain square plus a margin (m). */
export function domainBBox(centre: LatLon, extent: number, marginM: number = SCENARIO_PARAMS.queryMarginM): [number, number, number, number] {
  const p = new LocalProjection(centre);
  const h = extent / 2 + marginM;
  const sw = p.toLatLon(-h, -h);
  const ne = p.toLatLon(h, h);
  return [sw.lon, sw.lat, ne.lon, ne.lat];
}

/** True when the square (centre, extent) lies inside the square (c2, e2) (flat-earth, domain-sized squares). */
export function squareInside(centre: LatLon, extent: number, c2: LatLon, e2: number): boolean {
  const dy = Math.abs(centre.lat - c2.lat) * 111195;
  const dx = Math.abs(centre.lon - c2.lon) * 111195 * Math.cos((c2.lat * Math.PI) / 180);
  const slack = e2 / 2 - extent / 2;
  return dx <= slack + 1 && dy <= slack + 1;
}

/** True when two squares overlap. */
export function squaresOverlap(a: LatLon, ea: number, b: LatLon, eb: number): boolean {
  const reach = (ea + eb) / 2;
  const dy = Math.abs(a.lat - b.lat) * 111195;
  const dx = Math.abs(a.lon - b.lon) * 111195 * Math.cos((b.lat * Math.PI) / 180);
  return dx < reach && dy < reach;
}

/** Demo sites whose bundled square covers (`full`) or overlaps the domain (the named site first). */
export function demoCoverage(ctx: Pick<LayerContext, 'centre' | 'extent' | 'demoSiteId'>): { full: string[]; partial: string[] } {
  const E = SCENARIO_PARAMS.demoExtentM;
  const full: string[] = [];
  const partial: string[] = [];
  const sites = [...DEMO_SITES].sort((a, b) => (a.id === ctx.demoSiteId ? -1 : b.id === ctx.demoSiteId ? 1 : 0));
  for (const s of sites) {
    if (squareInside(ctx.centre, ctx.extent, s.centre, E)) full.push(s.id);
    else if (squaresOverlap(ctx.centre, ctx.extent, s.centre, E)) partial.push(s.id);
  }
  return { full, partial };
}

const aborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Build cancelled', 'AbortError');
};

// ─────────────────────────────────────────────────────────────────────────────
// ArcGIS REST queries (doc 08b §3–4)
// ─────────────────────────────────────────────────────────────────────────────

export const SVTM_QUERY_PATH = '/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer/3/query';
export const NPWS_FIRE_QUERY_PATH = '/arcgis/rest/services/Fire/NPWS_Fire_History/MapServer/0/query';

/** Query string of an envelope query (geojson, EPSG:4326, ordered by OBJECTID, one page). */
export function arcgisQuery(bbox: [number, number, number, number], outFields: string, maxOffset: number, precision: number, offset: number): string {
  const g = bbox.map((v) => v.toFixed(6)).join(',');
  return (
    `?geometry=${g}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&where=1%3D1` +
    `&outFields=${outFields}&returnGeometry=true&outSR=4326&maxAllowableOffset=${maxOffset}&geometryPrecision=${precision}` +
    `&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${SCENARIO_PARAMS.arcgisPageSize}&f=geojson`
  );
}

interface ArcGeoJson extends GeoJsonFeatureCollection {
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
  error?: { message?: string };
}

/** Page through an ArcGIS geojson query and merge the features. Throws on network failure (callers fall back). */
export async function fetchArcGisFeatures(
  path: string,
  bbox: [number, number, number, number],
  o: { outFields: string; maxOffset: number; precision: number; maxPages: number; signal?: AbortSignal; kv?: KV },
): Promise<GeoJsonFeatureCollection> {
  const features: GeoJsonFeatureCollection['features'] = [];
  for (let page = 0; page < o.maxPages; page++) {
    const url = serviceUrl('nswenv', path + arcgisQuery(bbox, o.outFields, o.maxOffset, o.precision, page * SCENARIO_PARAMS.arcgisPageSize));
    const j = await cachedFetchJson<ArcGeoJson>(url, `arcgis/${path}/${bbox.join(',')}/${page}`, { signal: o.signal, ...(o.kv ? { kv: o.kv } : {}) });
    if (j?.error) throw new Error(`ArcGIS query failed: ${j.error.message ?? 'error'}`);
    const f = Array.isArray(j?.features) ? j.features : [];
    features.push(...f);
    const more = j.exceededTransferLimit || j.properties?.exceededTransferLimit || f.length >= SCENARIO_PARAMS.arcgisPageSize;
    if (!more) break;
  }
  return { type: 'FeatureCollection', features };
}

export const fetchSvtm = (ctx: LayerContext): Promise<GeoJsonFeatureCollection> =>
  fetchArcGisFeatures(SVTM_QUERY_PATH, domainBBox(ctx.centre, ctx.extent), {
    outFields: 'OBJECTID,PCTID,PCTName,vegClass,vegForm',
    maxOffset: SCENARIO_PARAMS.svtmMaxAllowableOffset,
    precision: SCENARIO_PARAMS.svtmGeometryPrecision,
    maxPages: SCENARIO_PARAMS.svtmMaxPages,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    ...(ctx.kv ? { kv: ctx.kv } : {}),
  });

export const fetchNpwsFireHistory = (ctx: LayerContext): Promise<GeoJsonFeatureCollection> =>
  fetchArcGisFeatures(NPWS_FIRE_QUERY_PATH, domainBBox(ctx.centre, ctx.extent), {
    outFields: '*',
    maxOffset: SCENARIO_PARAMS.fireHistoryMaxAllowableOffset,
    precision: SCENARIO_PARAMS.fireHistoryGeometryPrecision,
    maxPages: SCENARIO_PARAMS.fireHistoryMaxPages,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    ...(ctx.kv ? { kv: ctx.kv } : {}),
  });

// ─────────────────────────────────────────────────────────────────────────────
// Vector layers (vegetation, fire history)
// ─────────────────────────────────────────────────────────────────────────────

export interface VectorLayer {
  geojson: GeoJsonFeatureCollection | null;
  origin: LayerOrigin;
  source: string;
  /** True when the data cover only part of the domain. */
  partial: boolean;
  warnings: string[];
}

async function packItem<T>(ctx: LayerContext, name: string): Promise<{ v: T; pack: string } | null> {
  try {
    for (const m of await findAreaPacks(ctx.centre, ctx.extent, ctx.kv)) {
      if (!m.itemNames.includes(name)) continue;
      const v = await loadAreaPackItem<T>(m.id, name, ctx.kv);
      if (v !== undefined) return { v, pack: m.name };
    }
  } catch {
    /* no pack store */
  }
  return null;
}

async function vectorLayer(
  ctx: LayerContext,
  item: 'vegetation' | 'fireHistory',
  demo: (site: string, s?: AbortSignal) => Promise<GeoJsonFeatureCollection | null>,
  net: (ctx: LayerContext) => Promise<GeoJsonFeatureCollection>,
  label: string,
): Promise<VectorLayer> {
  const warnings: string[] = [];
  const cov = demoCoverage(ctx);
  for (const site of cov.full) {
    const g = await demo(site, ctx.signal).catch(() => null);
    aborted(ctx.signal);
    if (g) return { geojson: g, origin: 'demo', source: `${label}: bundled demo '${site}'`, partial: false, warnings };
  }
  const pk = await packItem<GeoJsonFeatureCollection>(ctx, item);
  if (pk?.v && Array.isArray(pk.v.features)) return { geojson: pk.v, origin: 'pack', source: `${label}: area pack '${pk.pack}'`, partial: false, warnings };
  if (ctx.online) {
    try {
      const g = await net(ctx);
      return { geojson: g, origin: 'network', source: `${label}: live query`, partial: false, warnings };
    } catch (e) {
      aborted(ctx.signal);
      if (isHttpError(e) && e.kind === 'aborted') throw e;
      warnings.push(MESSAGES.networkFailed(label));
    }
  }
  // Offline or failed: a demo bundle that only partly covers the domain is better than nothing.
  for (const site of cov.partial) {
    const g = await demo(site, ctx.signal).catch(() => null);
    if (g) return { geojson: g, origin: 'demo', source: `${label}: bundled demo '${site}' (part of the area)`, partial: true, warnings };
  }
  return { geojson: null, origin: 'none', source: `${label}: unavailable`, partial: false, warnings };
}

/** SVTM vegetation polygons for the domain (raw GeoJSON; fuel/ parses and rasterises them). */
export const loadVegetationLayer = (ctx: LayerContext): Promise<VectorLayer> =>
  vectorLayer(ctx, 'vegetation', loadDemoVegetationGeoJson as (s: string, sig?: AbortSignal) => Promise<GeoJsonFeatureCollection | null>, fetchSvtm, 'Vegetation (NSW SVTM)');

/** NPWS fire-history polygons for the domain (raw GeoJSON). */
export const loadFireHistoryLayer = (ctx: LayerContext): Promise<VectorLayer> =>
  vectorLayer(ctx, 'fireHistory', loadDemoFireHistoryGeoJson as (s: string, sig?: AbortSignal) => Promise<GeoJsonFeatureCollection | null>, fetchNpwsFireHistory, 'Fire history (NPWS)');

// ─────────────────────────────────────────────────────────────────────────────
// Canopy
// ─────────────────────────────────────────────────────────────────────────────

/** A canopy raster stored in an area pack. */
export interface PackCanopy {
  grid: GridSpec;
  height: Float32Array;
  meanHeight: Float32Array;
  cover: Float32Array;
  valid: Uint8Array;
  source: string;
}

/** Resample a stored canopy raster onto `grid` (box-averaged / bilinear; `valid` = inside the stored raster and measured). */
export function canopyOnGrid(src: PackCanopy, grid: GridSpec): CanopyResult {
  const m = mapGrids(src.grid, grid);
  const inside = new Uint8Array(grid.nx * grid.ny);
  const height = resampleMapped(src.grid, src.height, grid, m);
  const meanHeight = resampleMapped(src.grid, src.meanHeight, grid, m);
  const cover = resampleMapped(src.grid, src.cover, grid, m, inside);
  const validF = resampleMapped(src.grid, Float32Array.from(src.valid), grid, m);
  const valid = new Uint8Array(grid.nx * grid.ny);
  let n = 0;
  for (let k = 0; k < valid.length; k++) {
    valid[k] = inside[k]! && validF[k]! >= 0.5 ? 1 : 0;
    n += valid[k]!;
  }
  return { height, meanHeight, cover, valid, coverage: n / valid.length, source: src.source };
}

export interface CanopyLayer {
  canopy: CanopyResult | null;
  origin: LayerOrigin;
  warnings: string[];
}

/** Canopy on the fire grid with the §11.6 chain. */
export async function loadCanopyLayer(grid: GridSpec, ctx: LayerContext): Promise<CanopyLayer> {
  const warnings: string[] = [];
  const cov = demoCoverage(ctx);
  const demoSite = cov.full[0] ?? cov.partial[0];
  const demo = await loadCanopy(grid, { ...(demoSite ? { demoSiteId: demoSite } : {}), allowRemote: false, ...(ctx.signal ? { signal: ctx.signal } : {}) }).catch(() => null);
  aborted(ctx.signal);
  if (demo) {
    if (demo.coverage < 0.999) warnings.push(MESSAGES.canopyPartial);
    return { canopy: demo, origin: 'demo', warnings };
  }
  const pk = await packItem<PackCanopy>(ctx, 'canopy');
  if (pk?.v?.grid && pk.v.height instanceof Float32Array) {
    const c = canopyOnGrid(pk.v, grid);
    return { canopy: { ...c, source: `${c.source} (area pack '${pk.pack}')` }, origin: 'pack', warnings };
  }
  if (ctx.online && ctx.extent <= SCENARIO_PARAMS.remoteCanopyMaxExtentM) {
    const r = await loadCanopy(grid, { allowRemote: true, ...(ctx.signal ? { signal: ctx.signal } : {}), ...(ctx.kv ? { cache: ctx.kv } : {}) }).catch(() => null);
    aborted(ctx.signal);
    if (r) return { canopy: r, origin: 'network', warnings };
  }
  warnings.push(MESSAGES.canopyUnavailable);
  return { canopy: null, origin: 'none', warnings };
}
