/**
 * Bundled high-resolution layers for the NSW demo sites, fetched from live services by the fixtures helper
 * (see docs/research/08b-live-endpoint-verification.md):
 *
 *  - `demo/<id>/dem5m.png` + `.json` — NSW Spatial Services 5 m elevation model (NSW_5M_Elevation service), bilinear-resampled
 *    to a 10 m local grid, Terrarium RGB. The service calls it "5 metre post spacing elevation derived from stereo
 *    imagery" (not LiDAR); it is finer than SRTM's 30 m. © Spatial Services NSW (CC BY 4.0).
 *  - `demo/<id>/imagery.jpg` + `.json` — NSW aerial imagery on an 8 m local grid. © Spatial Services NSW (CC BY 4.0).
 *  - `demo/<id>/fire-history.geojson` — NPWS Fire History polygons (FireType 1 = wildfire, 2 = prescribed burn).
 *  - `demo/<id>/vegetation.geojson` — NSW State Vegetation Type Map (vegForm, vegClass, PCTName).
 *
 * All rasters: square of side `extent` centred on the site, row 0 = north, cell (col,row) centre at
 * x = -extent/2 + (col+0.5)·cell, y = extent/2 - (row+0.5)·cell (the same as makeGridSpec(centre, extent, cell)).
 */
import { decode, hasPngSignature } from 'fast-png';
import { LocalProjection, type LatLon } from '../core/geo';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { loadAsset, loadAssetJson, resolveAssetBase } from './assets';
import { mapGrids, resampleMapped } from './canopy';
import type { TraceOptions } from './ledger';

export interface DemoRasterMeta {
  id: string;
  cellSize: number;
  n: number;
  centre: LatLon;
  extent: number;
  source: string;
  attribution: string;
  encoding?: string;
  minElevation?: number;
  maxElevation?: number;
  /** ISO date the bundle was captured from the service (added by scripts/stamp-demo-provenance.mjs and the fetch scripts). */
  capturedOn?: string;
  /** Cells of the source raster that had no data (0 at all bundled sites). */
  nodataCount?: number;
}

/**
 * Source text of the bundled elevation model. The NSW_5M_Elevation service describes itself as "5 metre post spacing
 * elevation derived from stereo imagery" (service metadata read 2026-09-29, see docs/research/08b section 3.5), so it
 * is NOT called LiDAR or bare earth here: under tall forest a stereo-imagery surface can follow the treetops.
 */
export const DEM5M_SOURCE = 'NSW Spatial Services 5 m elevation model (NSW_5M_Elevation, © Spatial Services NSW, CC BY 4.0)';
/** @deprecated the old name (the model is not LiDAR); use {@link DEM5M_SOURCE}. */
export const LIDAR_DEM_SOURCE = DEM5M_SOURCE;

/** Grid of a bundled raster from its metadata (matches the published cell-centre convention). */
export function demoRasterGrid(meta: DemoRasterMeta): GridSpec {
  return makeGridSpec(meta.centre, meta.extent, meta.cellSize);
}

/** Decode the bundled LiDAR DTM of a demo site on its own 10 m grid (j = 0 south), or null if the site has none. */
export async function loadDemoDem(
  siteId: string,
  signal?: AbortSignal,
  trace?: TraceOptions,
): Promise<{ grid: GridSpec; elevation: Float32Array; meta: DemoRasterMeta; bytes: { png: number; json: number } } | null> {
  const metaBytes = await loadAsset(`demo/${siteId}/dem5m.json`, signal, trace);
  const meta = metaBytes ? parseJsonBytes<DemoRasterMeta>(metaBytes) : null;
  if (!meta || !meta.cellSize || !meta.n || !meta.centre) return null;
  const png = await loadAsset(`demo/${siteId}/dem5m.png`, signal, trace);
  if (!png || !hasPngSignature(png)) return null;
  const img = decode(png);
  const ch = img.channels;
  if (img.depth !== 8 || ch < 3) throw new Error(`dem5m.png for '${siteId}': expected 8-bit RGB, got ${ch}×${img.depth}-bit`);
  const grid = demoRasterGrid(meta);
  if (grid.nx !== img.width || grid.ny !== img.height) throw new Error(`dem5m.png for '${siteId}': ${img.width}×${img.height} does not match metadata n=${meta.n}`);
  const elevation = new Float32Array(grid.nx * grid.ny);
  const d = img.data;
  for (let r = 0; r < grid.ny; r++) {
    const j = grid.ny - 1 - r;
    for (let i = 0; i < grid.nx; i++) {
      const o = (r * grid.nx + i) * ch;
      elevation[j * grid.nx + i] = d[o]! * 256 + d[o + 1]! + d[o + 2]! / 256 - 32768;
    }
  }
  return { grid, elevation, meta, bytes: { png: png.byteLength, json: metaBytes!.byteLength } };
}

function parseJsonBytes<T>(bytes: Uint8Array): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/** True when every cell centre of `grid` lies inside the raster of `meta` (with half a source cell of tolerance). */
export function rasterCovers(meta: DemoRasterMeta, grid: GridSpec): boolean {
  const src = demoRasterGrid(meta);
  const m = mapGrids(src, grid);
  const lo = -0.5;
  const hiX = src.nx - 0.5;
  const hiY = src.ny - 0.5;
  return m.fi[0]! >= lo && m.fi[grid.nx - 1]! <= hiX && m.fj[0]! >= lo && m.fj[grid.ny - 1]! <= hiY;
}

/**
 * Elevation on `grid` from a demo site's LiDAR DTM (area-averaged or interpolated), or null if no bundled DTM
 * fully covers the grid.
 */
export async function loadDemoElevation(
  grid: GridSpec,
  siteIds: string[],
  signal?: AbortSignal,
  trace?: TraceOptions,
): Promise<{ elevation: Float32Array; source: string; siteId: string; meta: DemoRasterMeta; bytes: { png: number; json: number } } | null> {
  for (const id of siteIds) {
    const dem = await loadDemoDem(id, signal, trace).catch(() => null);
    if (!dem || !rasterCovers(dem.meta, grid)) continue;
    const elevation = resampleMapped(dem.grid, dem.elevation, grid, mapGrids(dem.grid, grid));
    return { elevation, source: `${DEM5M_SOURCE}; bundled demo '${id}' at ${dem.meta.cellSize} m`, siteId: id, meta: dem.meta, bytes: dem.bytes };
  }
  return null;
}

/** Metadata and URL of a demo site's aerial imagery (the image itself is decoded by the renderer), or null. */
export async function loadDemoImageryInfo(siteId: string, signal?: AbortSignal, trace?: TraceOptions): Promise<{ url: string; meta: DemoRasterMeta } | null> {
  const meta = await loadAssetJson<DemoRasterMeta>(`demo/${siteId}/imagery.json`, signal, trace);
  if (!meta || !meta.cellSize || !meta.n) return null;
  return { url: `${resolveAssetBase()}demo/${siteId}/imagery.jpg`, meta };
}

/** Raw JPEG bytes of a demo site's aerial imagery (for area packs / Node), or null. */
export const loadDemoImageryBytes = (siteId: string, signal?: AbortSignal): Promise<Uint8Array | null> =>
  loadAsset(`demo/${siteId}/imagery.jpg`, signal);

/**
 * Pixel window of a bundled image that covers `grid`'s full domain (cell edges, not centres), for cropping with
 * drawImage(img, sx, sy, sw, sh, …). Pixel row 0 is north. Values may extend beyond the image if the grid is larger.
 */
export function imageryWindow(meta: DemoRasterMeta, grid: GridSpec): { sx: number; sy: number; sw: number; sh: number } {
  const src = new LocalProjection(meta.centre);
  const dst = new LocalProjection(grid.origin);
  const h = grid.cellSize / 2;
  const west = dst.toLatLon(grid.x0 - h, 0).lon;
  const east = dst.toLatLon(grid.x0 + (grid.nx - 1) * grid.cellSize + h, 0).lon;
  const south = dst.toLatLon(0, grid.y0 - h).lat;
  const north = dst.toLatLon(0, grid.y0 + (grid.ny - 1) * grid.cellSize + h).lat;
  const half = meta.extent / 2;
  const px = (lon: number): number => (src.toLocal({ lat: meta.centre.lat, lon })[0] + half) / meta.cellSize;
  const py = (lat: number): number => (half - src.toLocal({ lat, lon: meta.centre.lon })[1]) / meta.cellSize;
  const sx = px(west);
  const sy = py(north);
  return { sx, sy, sw: px(east) - sx, sh: py(south) - sy };
}

export interface GeoJsonFeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  /** Bundled SVTM files: the box (west, south, east, north) the polygons were clipped to. */
  clippedTo?: [number, number, number, number];
  /** ISO date the bundle was captured (bundled files written after scripts/stamp-demo-provenance.mjs). */
  capturedOn?: string;
  features: { type: 'Feature'; properties: P; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } | null }[];
}

/** NPWS fire history attributes as published (see 08b §3). */
export interface NpwsFireProps {
  FireType: number | null;
  FireName: string | null;
  FireYear: number | null;
  Label: string | null;
  StartDate: number | null;
  EndDate: number | null;
  AreaHa: number | null;
}

/** NSW SVTM attributes as published (see 08b §4). */
export interface SvtmProps {
  PCTID: number | null;
  PCTName: string | null;
  vegClass: string | null;
  vegForm: string | null;
}

export const loadDemoFireHistoryGeoJson = (siteId: string, signal?: AbortSignal, trace?: TraceOptions): Promise<GeoJsonFeatureCollection<NpwsFireProps> | null> =>
  loadAssetJson(`demo/${siteId}/fire-history.geojson`, signal, trace);

export const loadDemoVegetationGeoJson = (siteId: string, signal?: AbortSignal, trace?: TraceOptions): Promise<GeoJsonFeatureCollection<SvtmProps> | null> =>
  loadAssetJson(`demo/${siteId}/vegetation.geojson`, signal, trace);
