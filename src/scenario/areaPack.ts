/**
 * Area packs for offline field use (spec §11.6 fallback chains "area pack"; data/cache.ts storage).
 *
 * `downloadAreaPack(req)` fetches everything a later offline build of the area needs and stores it as one pack:
 *   - `dem10`: the 10 m DEM of the pack square (bundled LiDAR when a demo site covers it, else Terrarium tiles),
 *   - `terrarium/<z>/<x>/<y>`: the Terrarium tiles used (terrainTiles.ts reads these item names directly),
 *   - `canopy`: canopy height / cover on a 20 m grid (bundled raster, or the remote CHM for areas ≤ 3 km),
 *   - `vegetation`, `fireHistory`: SVTM and NPWS GeoJSON of the square (+ margin),
 *   - `weather`: the latest Open-Meteo forecast response (7 past + 16 forecast days),
 *   - `daily`: the 365-day daily history and the annual rainfall (KBDI / DF offline).
 * Each layer is optional: a layer that cannot be fetched is skipped with a warning.
 */
import { makeGridSpec, type GridSpec } from '../core/grid';
import type { DailyWeather, LatLon } from '../core/types';
import {
  elevationTilesFor,
  loadCanopy,
  loadElevation,
  openCache,
  saveAreaPack,
  type AreaPackItem,
  type AreaPackMeta,
  type KV,
} from '../data';
import { fetchNpwsFireHistory, fetchSvtm, loadFireHistoryLayer, loadVegetationLayer, type LayerContext, type PackCanopy } from './layers';
import { forecastUrl, parseOpenMeteoHourly } from './openMeteo';
import { SCENARIO_PARAMS } from './params';
import { annualRainfall, dailyHistory, omFetch, type WeatherContext } from './weatherSources';

export interface AreaPackRequest {
  /** Pack id (default derived from the name); no '/'. */
  id?: string;
  name: string;
  centre: LatLon;
  /** Side of the square (m). */
  extent: number;
  demoSiteId?: string;
  /** Include weather (forecast + daily history), default true. */
  weather?: boolean;
  /** Storage (default: the shared cache). */
  kv?: KV;
  /** Clock override (tests). */
  now?: number;
}

export interface AreaPackProgress {
  fraction: number;
  message: string;
}

/** The daily item of a pack. */
export interface PackDaily {
  daily: DailyWeather[];
  annualRainfall?: number;
  fetchedAt: number;
}

export interface AreaPackResult {
  meta: AreaPackMeta;
  warnings: string[];
}

const packId = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `pack-${Date.now()}`;

/** Download and store an area pack (see module doc). Rejects only when cancelled or when nothing could be stored. */
export async function downloadAreaPack(req: AreaPackRequest, onProgress?: (p: AreaPackProgress) => void, signal?: AbortSignal): Promise<AreaPackResult> {
  const P = SCENARIO_PARAMS;
  const kv = req.kv ?? openCache();
  const now = req.now ?? Date.now();
  const items: Record<string, AreaPackItem> = {};
  const warnings: string[] = [];
  const report = (fraction: number, message: string): void => onProgress?.({ fraction, message });
  const check = (): void => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
  };
  const ctx: LayerContext = { centre: req.centre, extent: req.extent, online: true, kv, ...(req.demoSiteId ? { demoSiteId: req.demoSiteId } : {}), ...(signal ? { signal } : {}) };

  // Terrain: the 10 m DEM (and the Terrarium tiles it came from).
  report(0.02, 'Terrain…');
  try {
    const r = await loadElevation({
      centre: req.centre,
      extent: req.extent,
      cellSize: P.hiResCellM,
      cache: kv,
      signal,
      ...(req.demoSiteId ? { demoSiteId: req.demoSiteId } : {}),
      onProgress: (d, t) => report(0.02 + (0.3 * d) / Math.max(1, t), `Terrain tiles ${d}/${t}`),
    });
    items['dem10'] = { grid: r.grid, elevation: r.elevation, source: r.source };
    if (r.tiles > 0) {
      for (const t of elevationTilesFor({ centre: req.centre, extent: req.extent, cellSize: P.hiResCellM, zoom: r.zoom })) {
        const rec = await kv.get<{ v?: ArrayBuffer }>(t.key).catch(() => undefined);
        if (rec?.v) items[t.key] = rec.v;
      }
    }
  } catch (e) {
    check();
    warnings.push(`Terrain not stored: ${e instanceof Error ? e.message : String(e)}`);
  }
  check();

  // Canopy on a 20 m grid.
  report(0.35, 'Canopy…');
  const g20: GridSpec = makeGridSpec(req.centre, req.extent, P.packCanopyCellM);
  const canopy = await loadCanopy(g20, { ...(req.demoSiteId ? { demoSiteId: req.demoSiteId } : {}), allowRemote: req.extent <= P.remoteCanopyMaxExtentM, cache: kv, ...(signal ? { signal } : {}) }).catch(() => null);
  check();
  if (canopy) items['canopy'] = { grid: g20, height: canopy.height, meanHeight: canopy.meanHeight, cover: canopy.cover, valid: canopy.valid, source: canopy.source } satisfies PackCanopy;
  else warnings.push('Canopy not stored (not available for this area).');

  // Vegetation and fire history (bundled when a demo site covers the square, else live).
  // A layer served from an existing pack (re-download / refresh of the same area) is re-queried live so the new pack
  // is current, and kept from the old pack when the query fails: a refreshed pack never loses a layer.
  report(0.5, 'Vegetation map…');
  const veg = await loadVegetationLayer(ctx).catch(() => null);
  check();
  if (veg?.geojson && veg.origin !== 'pack') items['vegetation'] = veg.geojson;
  else {
    const g = await fetchSvtm(ctx).catch(() => null);
    check();
    if (g) items['vegetation'] = g;
    else if (veg?.geojson) items['vegetation'] = veg.geojson;
    else warnings.push('Vegetation map not stored.');
  }
  report(0.65, 'Fire history…');
  const fh = await loadFireHistoryLayer(ctx).catch(() => null);
  check();
  if (fh?.geojson && fh.origin !== 'pack') items['fireHistory'] = fh.geojson;
  else {
    const g = await fetchNpwsFireHistory(ctx).catch(() => null);
    check();
    if (g) items['fireHistory'] = g;
    else if (fh?.geojson) items['fireHistory'] = fh.geojson;
    else warnings.push('Fire history not stored.');
  }

  // Weather: the latest forecast (16 days) and the daily history.
  if (req.weather !== false) {
    report(0.8, 'Weather forecast…');
    const wctx: WeatherContext = { centre: req.centre, online: true, kv, now, duration: 0, medianElevation: 0, centreElevation: 0, ...(signal ? { signal } : {}), ...(req.demoSiteId ? { siteId: req.demoSiteId } : {}) };
    try {
      const r = await omFetch(forecastUrl(req.centre, { pastDays: P.forecastPastDays, forecastDays: P.maxForecastDays }), wctx);
      const pr = parseOpenMeteoHourly(r.data);
      if (pr.missingRequired.length === 0) items['weather'] = r.data as unknown as AreaPackItem;
      else warnings.push('Weather forecast incomplete: not stored.');
      const parsed = pr.series;
      report(0.9, 'Rainfall history…');
      const hist = await dailyHistory(req.centre, now, wctx, parsed);
      const rain = await annualRainfall(req.centre, req.demoSiteId, now, wctx);
      if (hist.daily.length) items['daily'] = { daily: hist.daily, fetchedAt: now, ...(rain.mm !== undefined ? { annualRainfall: rain.mm } : {}) } satisfies PackDaily;
    } catch (e) {
      check();
      warnings.push(`Weather not stored: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  check();
  if (Object.keys(items).length === 0) throw new Error('Area pack: nothing could be downloaded (offline?)');
  report(0.97, 'Saving…');
  const meta = await saveAreaPack({ id: req.id ?? packId(req.name), name: req.name, centre: { ...req.centre }, extent: req.extent, createdAt: now, items }, kv);
  report(1, 'Area pack saved');
  return { meta, warnings };
}
