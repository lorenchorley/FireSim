/**
 * Elevation from AWS Terrain Tiles (Mapzen "Terrarium" PNG encoding; SRTM 1″ ≈ 30 m over Australia).
 *
 * Each 256 × 256 Web-Mercator tile stores elevation as RGB: h = R·256 + G + B/256 − 32768 (m).
 * {@link loadElevation} works out which tiles cover the requested square, obtains each from
 *   1. the tiles bundled with the app for the NSW demo sites (`public/demo/<id>/terrarium/<z>/<x>/<y>.png`),
 *   2. user-downloaded area packs overlapping the area (items named `terrarium/<z>/<x>/<y>`, see cache.ts),
 *   3. the offline cache (IndexedDB),
 *   4. the network (validated as a PNG, then cached),
 * mosaics them and samples the local grid by bilinear interpolation in Mercator pixel space. A source whose bytes do
 * not decode falls through to the next one. If the default zoom for fine cells (14) cannot be obtained — typically
 * offline at a demo site, whose tiles are bundled at zoom 13 only — it falls back to zoom 13.
 */
import { decode, hasPngSignature, convertIndexedToRgb } from 'fast-png';
import { LocalProjection, lonLatToTileFrac, type LatLon, type TileXYZ } from '../core/geo';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { DEMO_EXTENT_M, DEMO_SITES, DEMO_TILE_ZOOM } from './demoSites';
import { loadAssetJson, loadAsset } from './assets';
import { cachedFetch, listAreaPacks, loadAreaPackItem, openCache, type KV, type CacheOrigin } from './cache';
import { fetchBinary, HttpError, serviceUrl, type RequestOptions } from './http';
import { traceFields, type TraceOptions } from './ledger';

import { loadDemoElevation } from './demoRasters';
export { syntheticElevation, syntheticSource, type SyntheticTerrainKind } from './syntheticTerrain';

export const TERRARIUM_TILE_SIZE = 256;
/** Highest zoom published by AWS Terrain Tiles for Terrarium PNGs. */
export const TERRARIUM_MAX_ZOOM = 15;
export const TERRARIUM_SOURCE = 'AWS Terrain Tiles (Terrarium, SRTM 1″ ≈ 30 m)';

/** Upper bound on tiles per request (≈ 26 MB of mosaic), a guard against accidental huge requests. */
const MAX_TILES = 100;
/** Elevations below this are treated as no-data / deep ocean and set to 0 m. */
const NODATA_BELOW = -100;

// ─────────────────────────────────────────────────────────────────────────────
// Decoding
// ─────────────────────────────────────────────────────────────────────────────

export interface DecodedTerrarium {
  width: number;
  height: number;
  /** Elevation (m), row-major with row 0 = NORTH (image order). */
  elevation: Float32Array;
  /** Pixels that were no-data (< −100 m) and were set to `opts.noData`. */
  noData?: number;
}

/**
 * Decode a Terrarium PNG to elevations. Values below −100 m (the no-data sentinel −32768, or deep ocean) become
 * `opts.noData` (default 0). Accepts RGB, RGBA and palette PNGs (8-bit).
 */
export function decodeTerrarium(png: Uint8Array, opts: { noData?: number } = {}): DecodedTerrarium {
  const fill = opts.noData ?? 0;
  if (!hasPngSignature(png)) throw new Error('decodeTerrarium: not a PNG');
  const img = decode(png);
  let data = img.data;
  let channels = img.channels;
  if (img.palette) {
    data = convertIndexedToRgb(img);
    channels = img.palette[0]?.length ?? 3;
  }
  if (img.depth !== 8 && !img.palette) throw new Error(`decodeTerrarium: unsupported bit depth ${img.depth}`);
  if (channels < 3) throw new Error(`decodeTerrarium: expected RGB(A), got ${channels} channel(s)`);
  const n = img.width * img.height;
  const elevation = new Float32Array(n);
  let noData = 0;
  for (let p = 0, o = 0; p < n; p++, o += channels) {
    const h = data[o]! * 256 + data[o + 1]! + data[o + 2]! / 256 - 32768;
    if (h < NODATA_BELOW) {
      elevation[p] = fill;
      noData++;
    } else elevation[p] = h;
  }
  return { width: img.width, height: img.height, elevation, noData };
}

/** Encode elevations as a Terrarium RGB PNG pixel buffer (inverse of the decoder; used by tests and area-pack tools). */
export function encodeTerrariumPixels(elevation: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(elevation.length * 3);
  for (let p = 0; p < elevation.length; p++) {
    // 24-bit fixed point with 1/256 m resolution: R·65536 + G·256 + B = (h + 32768)·256.
    const q = Math.max(0, Math.min(0xffffff, Math.round((elevation[p]! + 32768) * 256)));
    out[p * 3] = q >>> 16;
    out[p * 3 + 1] = (q >>> 8) & 0xff;
    out[p * 3 + 2] = q & 0xff;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile planning
// ─────────────────────────────────────────────────────────────────────────────

export interface ElevationRequest {
  centre: LatLon;
  /** Side of the square domain (m). */
  extent: number;
  cellSize: number;
  /** Bundled demo site to use first (sites overlapping the area are also searched automatically). */
  demoSiteId?: string;
  /**
   * Tile zoom (default 13 for cells ≥ 20 m, else 14; max 15). With the default, a zoom-14 request whose tiles cannot
   * all be obtained falls back to zoom 13 (bundled / previously cached); an explicit zoom never falls back.
   */
  zoom?: number;
  signal?: AbortSignal;
  /** Cache to read/write tiles and look up area packs in (default: the shared cache; null disables both). */
  cache?: KV | null;
  /** Skip the network (only bundled + cached tiles). */
  offline?: boolean;
  onProgress?: (done: number, total: number) => void;
  /** Use a bundled LiDAR DTM when one covers the domain (default true). */
  lidar?: boolean;
  /** Record every tile read (bundled, area pack, stored copy, download) on a request ledger (data/ledger.ts). */
  trace?: TraceOptions;
}

export interface ElevationResult {
  grid: GridSpec;
  /** Elevation (m ASL) per grid cell, row-major, j = 0 south. */
  elevation: Float32Array;
  source: string;
  zoom: number;
  tiles: number;
  /** Cells whose value was no-data or below sea level and were set to 0 m. */
  seaOrNoDataCells: number;
  /** Tiles by where they came from ('stale' = a stored copy used because the download failed). */
  origins?: Record<TileOrigin, number>;
  /** Bundled demo sites and saved area packs that supplied tiles. */
  sites?: string[];
  packs?: string[];
  /** Oldest time (epoch ms) a stored tile copy was downloaded, when any came from the cache. */
  oldestCachedAt?: number;
  /** True when zoom 14 was wanted but the coarser bundled zoom 13 was used. */
  degradedFrom?: number;
}

/** Default Terrarium zoom for a grid resolution. */
export const defaultElevationZoom = (cellSize: number): number => (cellSize >= 20 ? 13 : 14);

export function terrariumTileUrl(z: number, x: number, y: number): string {
  return serviceUrl('terrarium', `/terrarium/${z}/${x}/${y}.png`);
}

/** Cache key for a tile (also the item name used in area packs). */
export const terrariumTileKey = (t: TileXYZ): string => `terrarium/${t.z}/${t.x}/${t.y}`;

/**
 * Sampling plan: per-column and per-row Mercator pixel coordinates (pixel-centre convention, relative to the mosaic)
 * and the tile range that covers them. The local projection is equirectangular, so longitude depends only on the
 * column and latitude only on the row: the plan is separable and costs O(nx + ny).
 */
interface SamplePlan {
  z: number;
  tx0: number;
  ty0: number;
  tilesX: number;
  tilesY: number;
  /** Fractional mosaic pixel coordinate of each column / row (0 = centre of the mosaic's first pixel). */
  u: Float64Array;
  v: Float64Array;
}

function planSampling(grid: GridSpec, z: number): SamplePlan {
  const proj = new LocalProjection(grid.origin);
  const S = TERRARIUM_TILE_SIZE;
  const worldPx = S * 2 ** z;
  const u = new Float64Array(grid.nx);
  const v = new Float64Array(grid.ny);
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < grid.nx; i++) {
    const ll = proj.toLatLon(grid.x0 + i * grid.cellSize, 0);
    u[i] = lonLatToTileFrac(grid.origin.lat, ll.lon, z)[0] * S - 0.5;
    if (u[i]! < uMin) uMin = u[i]!;
    if (u[i]! > uMax) uMax = u[i]!;
  }
  for (let j = 0; j < grid.ny; j++) {
    const ll = proj.toLatLon(0, grid.y0 + j * grid.cellSize);
    v[j] = lonLatToTileFrac(ll.lat, grid.origin.lon, z)[1] * S - 0.5;
    if (v[j]! < vMin) vMin = v[j]!;
    if (v[j]! > vMax) vMax = v[j]!;
  }
  // Pixels needed: floor(min) .. floor(max) + 1 (bilinear neighbours).
  const clampPx = (p: number): number => Math.max(0, Math.min(worldPx - 1, p));
  const tx0 = Math.floor(clampPx(Math.floor(uMin)) / S);
  const tx1 = Math.floor(clampPx(Math.floor(uMax) + 1) / S);
  const ty0 = Math.floor(clampPx(Math.floor(vMin)) / S);
  const ty1 = Math.floor(clampPx(Math.floor(vMax) + 1) / S);
  for (let i = 0; i < grid.nx; i++) u[i] = u[i]! - tx0 * S;
  for (let j = 0; j < grid.ny; j++) v[j] = v[j]! - ty0 * S;
  return { z, tx0, ty0, tilesX: tx1 - tx0 + 1, tilesY: ty1 - ty0 + 1, u, v };
}

function resolveZoom(cellSize: number, zoom?: number): number {
  const z = Math.round(zoom ?? defaultElevationZoom(cellSize));
  return Math.max(0, Math.min(TERRARIUM_MAX_ZOOM, z));
}

/** Tiles needed for a request (e.g. to prefetch them into the cache or an area pack before going offline). */
export function elevationTilesFor(req: Pick<ElevationRequest, 'centre' | 'extent' | 'cellSize' | 'zoom'>): (TileXYZ & { url: string; key: string })[] {
  const grid = makeGridSpec(req.centre, req.extent, req.cellSize);
  const plan = planSampling(grid, resolveZoom(req.cellSize, req.zoom));
  const out: (TileXYZ & { url: string; key: string })[] = [];
  for (let ty = 0; ty < plan.tilesY; ty++)
    for (let tx = 0; tx < plan.tilesX; tx++) {
      const t = { z: plan.z, x: plan.tx0 + tx, y: plan.ty0 + ty };
      out.push({ ...t, url: terrariumTileUrl(t.z, t.x, t.y), key: terrariumTileKey(t) });
    }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundled demo tiles
// ─────────────────────────────────────────────────────────────────────────────

interface DemoManifest {
  id: string;
  zoom: number;
  tiles: [number, number][];
  source?: string;
}

const manifestCache = new Map<string, Promise<Set<string> | null>>();

/** Set of "z/x/y" tiles bundled for a demo site (memoised), or null if the site has no manifest. */
function demoTileSet(siteId: string, signal?: AbortSignal, trace?: TraceOptions): Promise<Set<string> | null> {
  let p = manifestCache.get(siteId);
  if (!p) {
    p = loadAssetJson<DemoManifest>(`demo/${siteId}/manifest.json`, signal, trace).then((m) =>
      m && Array.isArray(m.tiles) ? new Set(m.tiles.map(([x, y]) => `${m.zoom}/${x}/${y}`)) : null,
    );
    // Do not memoise failures caused by an abort.
    p.catch(() => manifestCache.delete(siteId));
    manifestCache.set(siteId, p);
  }
  return p;
}

/** Forget memoised demo manifests (tests, or after installing a different asset loader). */
export function clearDemoManifestCache(): void {
  manifestCache.clear();
}

/** True when two squares (centre, side in m) overlap. Flat-earth approximation, fine for domain-sized squares. */
function squaresOverlap(a: LatLon, sideA: number, b: LatLon, sideB: number): boolean {
  const reach = (sideA + sideB) / 2;
  const dy = Math.abs(a.lat - b.lat) * 111195;
  const dx = Math.abs(a.lon - b.lon) * 111195 * Math.cos((b.lat * Math.PI) / 180);
  return dx < reach && dy < reach;
}

/** Demo sites whose bundled square overlaps the requested square (the named site first). */
function candidateDemoSites(centre: LatLon, extent: number, preferred?: string): string[] {
  const out: string[] = preferred ? [preferred] : [];
  for (const s of DEMO_SITES) if (s.id !== preferred && squaresOverlap(s.centre, DEMO_EXTENT_M, centre, extent)) out.push(s.id);
  return out;
}

async function loadDemoTile(sites: string[], t: TileXYZ, signal?: AbortSignal, trace?: TraceOptions): Promise<{ bytes: Uint8Array; site: string } | null> {
  const key = `${t.z}/${t.x}/${t.y}`;
  for (const site of sites) {
    const set = await demoTileSet(site, signal, trace);
    if (set && !set.has(key)) continue; // manifest says it is not bundled: skip the request
    const bytes = await loadAsset(`demo/${site}/terrarium/${key}.png`, signal, trace);
    if (bytes && hasPngSignature(bytes)) return { bytes, site };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Area packs
// ─────────────────────────────────────────────────────────────────────────────

interface PackRef {
  id: string;
  name: string;
  /** Terrarium item names stored in the pack. */
  tiles: Set<string>;
}

/** Area packs overlapping the request that contain Terrarium tiles (newest first). Never throws. */
async function tilePacks(kv: KV, centre: LatLon, extent: number): Promise<PackRef[]> {
  try {
    const out: PackRef[] = [];
    for (const m of await listAreaPacks(kv)) {
      if (!squaresOverlap(m.centre, m.extent, centre, extent)) continue;
      const tiles = new Set(m.itemNames.filter((n) => n.startsWith('terrarium/')));
      if (tiles.size) out.push({ id: m.id, name: m.name, tiles });
    }
    return out;
  } catch {
    return [];
  }
}

/** Bytes of a pack item stored as an ArrayBuffer, a typed array, or a cache record `{ v }` copied into the pack. */
function itemBytes(v: unknown): Uint8Array | null {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer as ArrayBuffer, v.byteOffset, v.byteLength);
  if (v && typeof v === 'object' && 'v' in v) return itemBytes((v as { v: unknown }).v);
  return null;
}

async function loadPackTile(kv: KV, packs: PackRef[], key: string, trace?: TraceOptions): Promise<{ bytes: Uint8Array; pack: string } | null> {
  for (const p of packs) {
    if (!p.tiles.has(key)) continue;
    const bytes = itemBytes(await loadAreaPackItem<unknown>(p.id, key, kv, trace).catch(() => undefined));
    if (bytes && hasPngSignature(bytes)) return { bytes, pack: p.name };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when some tiles could not be obtained from any source. */
export class ElevationUnavailableError extends Error {
  override readonly name = 'ElevationUnavailableError';
  constructor(
    readonly missing: TileXYZ[],
    readonly causes: unknown[],
  ) {
    super(`Elevation unavailable for ${missing.length} tile(s): ${missing.map((t) => `${t.z}/${t.x}/${t.y}`).join(', ')}`);
  }
}

export type TileOrigin = 'bundled' | 'pack' | CacheOrigin;

/**
 * Load elevation for a square around `centre` on a local grid (makeGridSpec(centre, extent, cellSize)).
 * Throws {@link ElevationUnavailableError} if tiles are missing (e.g. offline with nothing cached): callers can fall
 * back to {@link syntheticElevation}.
 */
export async function loadElevation(req: ElevationRequest): Promise<ElevationResult> {
  // Prefer a bundled 5 m LiDAR bare-earth DTM when one covers the whole domain (demo sites, works offline).
  if (req.signal?.aborted) throw req.signal.reason ?? new DOMException('Aborted', 'AbortError');
  if (req.lidar !== false) {
    const grid = makeGridSpec(req.centre, req.extent, req.cellSize);
    const hit = await loadDemoElevation(grid, candidateDemoSites(req.centre, req.extent, req.demoSiteId), req.signal, req.trace);
    if (hit) return { grid, elevation: hit.elevation, source: hit.source, zoom: 0, tiles: 0, seaOrNoDataCells: 0 };
  }
  const z = resolveZoom(req.cellSize, req.zoom);
  try {
    return await loadElevationAtZoom(req, z);
  } catch (e) {
    // Bundled demo tiles, and tiles cached by earlier ≥ 20 m runs, exist at DEMO_TILE_ZOOM only. When the finer default
    // zoom for small cells cannot be obtained (typically offline on a fire ground) use them rather than fail: the
    // source data is SRTM 1″ (≈ 30 m) either way.
    if (!(e instanceof ElevationUnavailableError) || req.zoom !== undefined || z <= DEMO_TILE_ZOOM || req.signal?.aborted) throw e;
    try {
      const r = await loadElevationAtZoom(req, DEMO_TILE_ZOOM);
      return { ...r, source: `${r.source} (zoom ${z} unavailable)`, degradedFrom: z };
    } catch (e2) {
      if (req.signal?.aborted) throw e2;
      throw e;
    }
  }
}

async function loadElevationAtZoom(req: ElevationRequest, z: number): Promise<ElevationResult> {
  const grid = makeGridSpec(req.centre, req.extent, req.cellSize);
  const plan = planSampling(grid, z);
  if (plan.tilesX * plan.tilesY > MAX_TILES) {
    throw new RangeError(`loadElevation: ${plan.tilesX * plan.tilesY} tiles needed at zoom ${z} (max ${MAX_TILES}); use a larger cell size or lower zoom`);
  }
  const S = TERRARIUM_TILE_SIZE;
  const mw = plan.tilesX * S;
  const mh = plan.tilesY * S;
  const mosaic = new Float32Array(mw * mh);
  const sites = candidateDemoSites(req.centre, req.extent, req.demoSiteId);
  const kv = req.cache === null ? null : (req.cache ?? openCache());

  const tiles: TileXYZ[] = [];
  for (let ty = 0; ty < plan.tilesY; ty++) for (let tx = 0; tx < plan.tilesX; tx++) tiles.push({ z, x: plan.tx0 + tx, y: plan.ty0 + ty });

  const packs = kv ? await tilePacks(kv, req.centre, req.extent) : [];
  const origins: Record<TileOrigin, number> = { bundled: 0, pack: 0, cache: 0, network: 0, stale: 0 };
  const usedSites = new Set<string>();
  const usedPacks = new Set<string>();
  let oldestCached: number | undefined;
  const missing: TileXYZ[] = [];
  const causes: unknown[] = [];
  let done = 0;

  const getTile = async (t: TileXYZ): Promise<void> => {
    const key = terrariumTileKey(t);
    /** Decode into the mosaic; false (and the cause recorded) if the bytes are not a valid Terrarium tile. */
    const place = (bytes: Uint8Array): boolean => {
      try {
        // No-data stays NaN in the mosaic so the sampler can interpolate around it (or set it to sea level).
        blit(decodeTerrarium(bytes, { noData: NaN }), mosaic, mw, (t.x - plan.tx0) * S, (t.y - plan.ty0) * S);
        return true;
      } catch (e) {
        causes.push(e);
        return false;
      }
    };
    let ok = false;
    // 1. Bundled with the app.
    const demo = await loadDemoTile(sites, t, req.signal, req.trace);
    if (demo && place(demo.bytes)) {
      ok = true;
      origins.bundled++;
      usedSites.add(demo.site);
    }
    // 2. Area packs downloaded for offline use.
    if (!ok && kv && packs.length) {
      const hit = await loadPackTile(kv, packs, key, req.trace);
      if (hit && place(hit.bytes)) {
        ok = true;
        origins.pack++;
        usedPacks.add(hit.pack);
      }
    }
    // 3./4. Cache, then network.
    if (!ok) {
      try {
        const url = terrariumTileUrl(t.z, t.x, t.y);
        if (kv) {
          for (let pass = 0; pass < 2 && !ok; pass++) {
            const r = await cachedFetch(url, key, req.offline ? offlineFetch : fetchTilePng, { kv, signal: req.signal, ...traceFields(req.trace) }, 'cache-first');
            if (place(new Uint8Array(r.data))) {
              ok = true;
              origins[r.from]++;
              if (r.from !== 'network') oldestCached = oldestCached === undefined ? r.fetchedAt : Math.min(oldestCached, r.fetchedAt);
            } else {
              if (r.from === 'network') break; // a fresh download that does not decode: give up on this tile
              // A corrupt cached copy would otherwise be served forever (cache-first): drop it and try the network.
              await kv.del(key).catch(() => undefined);
              if (req.offline) break;
            }
          }
        } else if (!req.offline && place(new Uint8Array(await fetchTilePng(url, { signal: req.signal, ...traceFields(req.trace) })))) {
          ok = true;
          origins.network++;
        }
      } catch (e) {
        if (req.signal?.aborted) throw e;
        causes.push(e);
      }
    }
    if (!ok) missing.push(t);
    req.onProgress?.(++done, tiles.length);
  };

  await runLimited(tiles, 6, getTile);
  if (req.signal?.aborted) throw req.signal.reason ?? new Error('aborted');
  if (missing.length) throw new ElevationUnavailableError(missing, causes);

  const { elevation, clamped } = sampleMosaic(grid, plan, mosaic, mw, mh);
  const parts: string[] = [];
  if (origins.bundled) parts.push(`${origins.bundled} bundled${usedSites.size ? ` (${[...usedSites].join(', ')})` : ''}`);
  if (origins.pack) parts.push(`${origins.pack} from area pack${usedPacks.size > 1 ? 's' : ''} ${[...usedPacks].map((n) => `'${n}'`).join(', ')}`);
  if (origins.cache) parts.push(`${origins.cache} cached`);
  if (origins.stale) parts.push(`${origins.stale} cached (stale)`);
  if (origins.network) parts.push(`${origins.network} downloaded`);
  const source = `${TERRARIUM_SOURCE}, zoom ${z}, ${tiles.length} tile${tiles.length === 1 ? '' : 's'}: ${parts.join(', ')}`;
  return {
    grid,
    elevation,
    source,
    zoom: z,
    tiles: tiles.length,
    seaOrNoDataCells: clamped,
    origins,
    sites: [...usedSites],
    packs: [...usedPacks],
    ...(oldestCached !== undefined ? { oldestCachedAt: oldestCached } : {}),
  };
}

const offlineFetch = async (): Promise<ArrayBuffer> => {
  throw new Error('offline: tile not cached');
};

/** Download a tile, rejecting anything that is not a PNG (e.g. an HTML error page) so it is never cached. */
async function fetchTilePng(url: string, opts: RequestOptions): Promise<ArrayBuffer> {
  const buf = await fetchBinary(url, opts);
  if (!hasPngSignature(new Uint8Array(buf))) throw new HttpError('parse', url, `Not a PNG tile: ${url}`, 200);
  return buf;
}

/** Copy a decoded 256² tile into the mosaic at pixel offset (ox, oy). */
function blit(tile: DecodedTerrarium, mosaic: Float32Array, mw: number, ox: number, oy: number): void {
  const { width, height, elevation } = tile;
  if (width !== TERRARIUM_TILE_SIZE || height !== TERRARIUM_TILE_SIZE) throw new Error(`Unexpected tile size ${width}×${height}`);
  for (let r = 0; r < height; r++) mosaic.set(elevation.subarray(r * width, (r + 1) * width), (oy + r) * mw + ox);
}

/** Bilinear sample of the mosaic at every grid cell (separable pixel coordinates). */
function sampleMosaic(grid: GridSpec, plan: SamplePlan, mosaic: Float32Array, mw: number, mh: number): { elevation: Float32Array; clamped: number } {
  const { nx, ny } = grid;
  const out = new Float32Array(nx * ny);
  // Per-column integer offsets and weights, computed once.
  const c0 = new Int32Array(nx);
  const wx = new Float32Array(nx);
  for (let i = 0; i < nx; i++) {
    const u = Math.max(0, Math.min(mw - 1.000001, plan.u[i]!));
    c0[i] = Math.floor(u);
    wx[i] = u - c0[i]!;
  }
  let clamped = 0;
  for (let j = 0; j < ny; j++) {
    const v = Math.max(0, Math.min(mh - 1.000001, plan.v[j]!));
    const r0 = Math.floor(v);
    const wy = v - r0;
    const top = r0 * mw;
    const bot = top + mw;
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      const c = c0[i]!;
      const tx = wx[i]!;
      const a = mosaic[top + c]!;
      const b = mosaic[top + c + 1]!;
      const d = mosaic[bot + c]!;
      const e = mosaic[bot + c + 1]!;
      let h = (a + (b - a) * tx) * (1 - wy) + (d + (e - d) * tx) * wy;
      if (!(h >= 0)) {
        // NaN: at least one neighbour is no-data. Interpolate from the valid ones only, so an isolated void does not
        // punch a hole to sea level into a mountain.
        if (h !== h) h = bilinearValid(a, b, d, e, tx, wy);
        // Sea (negative bathymetry) or no data at all: the fire and wind models need a real surface → sea level.
        if (!(h >= 0)) {
          h = 0;
          clamped++;
        }
      }
      out[row + i] = h;
    }
  }
  return { elevation: out, clamped };
}

/**
 * Bilinear interpolation over the non-NaN corners only (a, b = upper row; c, d = lower row), renormalising the weights.
 * Falls back to the plain mean of the valid corners when their weights vanish; NaN when all four are no-data.
 */
function bilinearValid(a: number, b: number, c: number, d: number, tx: number, ty: number): number {
  const wa = (1 - tx) * (1 - ty);
  const wb = tx * (1 - ty);
  const wc = (1 - tx) * ty;
  const wd = tx * ty;
  let s = 0;
  let w = 0;
  let sum = 0;
  let n = 0;
  if (a === a) (s += a * wa), (w += wa), (sum += a), n++;
  if (b === b) (s += b * wb), (w += wb), (sum += b), n++;
  if (c === c) (s += c * wc), (w += wc), (sum += c), n++;
  if (d === d) (s += d * wd), (w += wd), (sum += d), n++;
  return w > 1e-6 ? s / w : n ? sum / n : NaN;
}

/** Run `fn` over items with at most `limit` in flight. */
async function runLimited<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
