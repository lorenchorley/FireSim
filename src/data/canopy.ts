/**
 * Canopy (overstorey) height and cover from the Meta & WRI global 1 m canopy height map
 * (Tolan et al. 2024, "Very high resolution canopy height maps from RGB imagery", CC BY 4.0).
 *
 * Two sources:
 *  - **Bundled** rasters for the NSW demo sites (`public/demo/<id>/canopy.png` + `canopy.json`, produced by
 *    scripts/fetch-demo-canopy.mjs): 20 m cells, RGB with R = 90th-percentile height (m), G = mean height (m),
 *    B = cover fraction (share of 1 m pixels ≥ 2 m tall) × 255; PNG row 0 = north.
 *  - **Remote** Cloud-Optimised GeoTIFFs on S3 read with HTTP range requests (opt-in with `allowRemote`). The COGs are
 *    stored as 1-row strips, so reading is slow (each row of a ~3 km window is one request); it is limited to areas
 *    of at most 3 km and every 4th-ish row is sampled. Results are cached.
 *
 * Output fields are on the requested grid (row-major, j = 0 south).
 */
import { decode, hasPngSignature } from 'fast-png';
import { BaseClient, BaseResponse, fromCustomClient, type GeoTIFFImage } from 'geotiff';
import { LocalProjection, type LatLon } from '../core/geo';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { DEMO_EXTENT_M, DEMO_SITES } from './demoSites';
import { loadAsset, loadAssetJson } from './assets';
import { openCache, type KV } from './cache';
import { httpRequest, serviceUrl, type RawResponse } from './http';

export const CHM_SOURCE = 'Meta & WRI 1 m canopy height (Tolan et al. 2024, CC BY 4.0)';
/** Largest extent (m) for which the slow remote COG path is attempted. */
export const MAX_REMOTE_CANOPY_EXTENT = 3000;
/** Height (m) above which a 1 m pixel counts as canopy for the cover fraction (same as the bundling script). */
export const CANOPY_COVER_THRESHOLD = 2;

export interface CanopyResult {
  /** 90th-percentile canopy height per cell (m) — the "top height" used by the fuel model. */
  height: Float32Array;
  /** Mean canopy height over the cell including gaps (m). */
  meanHeight: Float32Array;
  /** Fraction of the cell covered by vegetation ≥ 2 m tall (0–1). */
  cover: Float32Array;
  /** 1 where the value was measured, 0 where it was extended from the nearest measured edge. */
  valid: Uint8Array;
  /** Share of cells with measured values (0–1). */
  coverage: number;
  source: string;
}

export interface CanopyOptions {
  demoSiteId?: string;
  /** Allow the slow remote COG path when no bundled raster covers the grid. */
  allowRemote?: boolean;
  signal?: AbortSignal;
  /** Cache for remote results (default shared cache; null disables). */
  cache?: KV | null;
  /** Minimum measured share of cells for a bundled raster to be used (default 0.5). */
  minCoverage?: number;
}

interface CanopyMeta {
  id: string;
  cellSize: number;
  n: number;
  centre: LatLon;
  extent: number;
  source?: string;
}

/**
 * Canopy height and cover on `grid`, from a bundled demo raster when one covers it, otherwise (if `allowRemote`) from
 * the remote COGs. Returns null when nothing is available.
 */
export async function loadCanopy(grid: GridSpec, opts: CanopyOptions = {}): Promise<CanopyResult | null> {
  const minCoverage = opts.minCoverage ?? 0.5;
  for (const id of candidateSites(grid, opts.demoSiteId)) {
    try {
      const r = await loadBundledCanopy(grid, id, opts.signal);
      if (r && r.coverage >= minCoverage) return r;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      console.warn(`[canopy] bundled canopy for '${id}' failed:`, e);
    }
  }
  if (!opts.allowRemote) return null;
  return loadRemoteCanopy(grid, opts);
}

/** Demo sites whose bundle overlaps the grid, named site first, then by distance. */
function candidateSites(grid: GridSpec, preferred?: string): string[] {
  const halfX = (grid.nx * grid.cellSize) / 2;
  const halfY = (grid.ny * grid.cellSize) / 2;
  const scored: [string, number][] = [];
  for (const s of DEMO_SITES) {
    if (s.id === preferred) continue;
    const dy = Math.abs(s.centre.lat - grid.origin.lat) * 111195;
    const dx = Math.abs(s.centre.lon - grid.origin.lon) * 111195 * Math.cos((grid.origin.lat * Math.PI) / 180);
    const reach = DEMO_EXTENT_M / 2;
    if (dx < reach + halfX && dy < reach + halfY) scored.push([s.id, Math.hypot(dx, dy)]);
  }
  scored.sort((a, b) => a[1] - b[1]);
  return [...(preferred ? [preferred] : []), ...scored.map((s) => s[0])];
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundled rasters
// ─────────────────────────────────────────────────────────────────────────────

/** The decoded bundled raster for a site on its own grid (j = 0 south), or null if the site has none. */
export async function loadBundledCanopyRaster(
  siteId: string,
  signal?: AbortSignal,
): Promise<{ grid: GridSpec; height: Float32Array; meanHeight: Float32Array; cover: Float32Array; meta: CanopyMeta } | null> {
  const meta = await loadAssetJson<CanopyMeta>(`demo/${siteId}/canopy.json`, signal);
  if (!meta || !meta.cellSize || !meta.n || !meta.centre) return null;
  const png = await loadAsset(`demo/${siteId}/canopy.png`, signal);
  if (!png || !hasPngSignature(png)) return null;
  const img = decode(png);
  const ch = img.channels;
  if (img.depth !== 8 || ch < 3) throw new Error(`canopy.png for '${siteId}': expected 8-bit RGB, got ${ch}×${img.depth}-bit`);
  const grid = makeGridSpec(meta.centre, meta.extent ?? meta.n * meta.cellSize, meta.cellSize);
  if (grid.nx !== img.width || grid.ny !== img.height) {
    // Trust the image size; keep the metadata's cell size and centre.
    const half = ((img.width - 1) * meta.cellSize) / 2;
    const halfY = ((img.height - 1) * meta.cellSize) / 2;
    Object.assign(grid, { nx: img.width, ny: img.height, x0: -half, y0: -halfY });
  }
  const n = grid.nx * grid.ny;
  const height = new Float32Array(n);
  const meanHeight = new Float32Array(n);
  const cover = new Float32Array(n);
  const d = img.data;
  for (let r = 0; r < grid.ny; r++) {
    const j = grid.ny - 1 - r; // PNG row 0 = north
    for (let i = 0; i < grid.nx; i++) {
      const o = (r * grid.nx + i) * ch;
      const k = j * grid.nx + i;
      height[k] = d[o]!;
      meanHeight[k] = d[o + 1]!;
      cover[k] = d[o + 2]! / 255;
    }
  }
  return { grid, height, meanHeight, cover, meta };
}

async function loadBundledCanopy(grid: GridSpec, siteId: string, signal?: AbortSignal): Promise<CanopyResult | null> {
  const raster = await loadBundledCanopyRaster(siteId, signal);
  if (!raster) return null;
  const map = mapGrids(raster.grid, grid);
  const valid = new Uint8Array(grid.nx * grid.ny);
  const height = resampleMapped(raster.grid, raster.height, grid, map);
  const meanHeight = resampleMapped(raster.grid, raster.meanHeight, grid, map);
  const cover = resampleMapped(raster.grid, raster.cover, grid, map, valid);
  let nValid = 0;
  for (let k = 0; k < valid.length; k++) nValid += valid[k]!;
  const coverage = nValid / valid.length;
  const how = Math.abs(raster.grid.cellSize - grid.cellSize) < 1e-6 ? 'at' : `${usesBox(map) ? 'area-averaged' : 'interpolated'} from`;
  const source = `${raster.meta.source ?? CHM_SOURCE}; bundled demo '${siteId}' ${how} ${raster.meta.cellSize} m${coverage < 0.999 ? `, ${Math.round(coverage * 100)}% of area covered` : ''}`;
  return { height, meanHeight, cover, valid, coverage, source };
}

/**
 * Separable mapping from destination cells to fractional source cell coordinates. Both grids use equirectangular
 * local projections, so source x depends only on the destination column and source y only on the row, even when the
 * grids have different origins.
 */
interface GridMap {
  fi: Float64Array;
  fj: Float64Array;
  /** Destination cell size in source cells (for area averaging). */
  scaleX: number;
  scaleY: number;
}

function mapGrids(src: GridSpec, dst: GridSpec): GridMap {
  const dp = new LocalProjection(dst.origin);
  const sp = new LocalProjection(src.origin);
  const fi = new Float64Array(dst.nx);
  const fj = new Float64Array(dst.ny);
  // Snap coordinates within 1e-6 cells of a source cell centre: aligned grids then copy values exactly instead of
  // blending in round-off from the lat/lon round trip.
  const snap = (v: number): number => {
    const r = Math.round(v);
    return Math.abs(v - r) < 1e-6 ? r : v;
  };
  for (let i = 0; i < dst.nx; i++) {
    const ll = dp.toLatLon(dst.x0 + i * dst.cellSize, 0);
    fi[i] = snap((sp.toLocal({ lat: src.origin.lat, lon: ll.lon })[0] - src.x0) / src.cellSize);
  }
  for (let j = 0; j < dst.ny; j++) {
    const ll = dp.toLatLon(0, dst.y0 + j * dst.cellSize);
    fj[j] = snap((sp.toLocal({ lat: ll.lat, lon: src.origin.lon })[1] - src.y0) / src.cellSize);
  }
  const scaleX = dst.nx > 1 ? Math.abs(fi[dst.nx - 1]! - fi[0]!) / (dst.nx - 1) : dst.cellSize / src.cellSize;
  const scaleY = dst.ny > 1 ? Math.abs(fj[dst.ny - 1]! - fj[0]!) / (dst.ny - 1) : dst.cellSize / src.cellSize;
  return { fi, fj, scaleX, scaleY };
}

/** Destination cells larger than this many source cells are area-averaged; smaller ones are interpolated. */
const BOX_THRESHOLD = 1.25;
const usesBox = (m: GridMap): boolean => m.scaleX > BOX_THRESHOLD || m.scaleY > BOX_THRESHOLD;

/**
 * Resample a source field onto the destination via a precomputed mapping: bilinear when the destination is finer or
 * similar, exact box (area) averaging when it is coarser (> 1.25× the source cell). Cells outside the source are
 * extended from the nearest edge; `valid` (if given) is set to 1 for cells whose centre lies inside the source.
 */
function resampleMapped(src: GridSpec, f: Float32Array, dst: GridSpec, m: GridMap, valid?: Uint8Array): Float32Array {
  const { nx: snx, ny: sny } = src;
  const out = new Float32Array(dst.nx * dst.ny);
  if (valid) {
    for (let j = 0; j < dst.ny; j++) {
      const inJ = m.fj[j]! >= -0.5 && m.fj[j]! <= sny - 0.5;
      for (let i = 0; i < dst.nx; i++) valid[j * dst.nx + i] = inJ && m.fi[i]! >= -0.5 && m.fi[i]! <= snx - 0.5 ? 1 : 0;
    }
  }
  if (!usesBox(m)) {
    // Bilinear, clamped to the source edge.
    const i0 = new Int32Array(dst.nx);
    const tx = new Float32Array(dst.nx);
    for (let i = 0; i < dst.nx; i++) {
      const u = Math.max(0, Math.min(snx - 1, m.fi[i]!));
      i0[i] = Math.min(snx - 2, Math.floor(u));
      tx[i] = u - i0[i]!;
    }
    for (let j = 0; j < dst.ny; j++) {
      const v = Math.max(0, Math.min(sny - 1, m.fj[j]!));
      const j0 = Math.min(sny - 2, Math.floor(v));
      const ty = v - j0;
      const r0 = j0 * snx;
      const r1 = r0 + snx;
      const row = j * dst.nx;
      for (let i = 0; i < dst.nx; i++) {
        const a = i0[i]!;
        const t = tx[i]!;
        const top = f[r0 + a]! + (f[r0 + a + 1]! - f[r0 + a]!) * t;
        const bot = f[r1 + a]! + (f[r1 + a + 1]! - f[r1 + a]!) * t;
        out[row + i] = top + (bot - top) * ty;
      }
    }
    return out;
  }
  // Box averaging: separable overlap weights (horizontal pass into tmp[sny × dnx], then vertical).
  const wx = boxWeights(m.fi, m.scaleX, snx);
  const wy = boxWeights(m.fj, m.scaleY, sny);
  const tmp = new Float32Array(sny * dst.nx);
  for (let r = 0; r < sny; r++) {
    const srow = r * snx;
    for (let i = 0; i < dst.nx; i++) {
      let acc = 0;
      for (let q = wx.start[i]!, e = wx.start[i + 1]!; q < e; q++) acc += f[srow + wx.index[q]!]! * wx.weight[q]!;
      tmp[r * dst.nx + i] = acc;
    }
  }
  for (let j = 0; j < dst.ny; j++) {
    const row = j * dst.nx;
    for (let q = wy.start[j]!, e = wy.start[j + 1]!; q < e; q++) {
      const w = wy.weight[q]!;
      const trow = wy.index[q]! * dst.nx;
      for (let i = 0; i < dst.nx; i++) out[row + i] = out[row + i]! + tmp[trow + i]! * w;
    }
  }
  return out;
}

/** CSR-packed normalised overlap weights of each destination footprint [c − s/2, c + s/2] with source cells. */
function boxWeights(centres: Float64Array, s: number, n: number): { start: Int32Array; index: Int32Array; weight: Float32Array } {
  const start = new Int32Array(centres.length + 1);
  const index: number[] = [];
  const weight: number[] = [];
  const half = s / 2;
  for (let d = 0; d < centres.length; d++) {
    start[d] = index.length;
    let a = centres[d]! - half;
    let b = centres[d]! + half;
    // Footprint entirely outside: shift it inside so the edge value is extended.
    if (b < -0.5) [a, b] = [-0.5, -0.5 + s];
    if (a > n - 0.5) [a, b] = [n - 0.5 - s, n - 0.5];
    const c0 = Math.max(0, Math.floor(a + 0.5));
    const c1 = Math.min(n - 1, Math.floor(b + 0.5));
    let total = 0;
    const first = index.length;
    for (let c = c0; c <= c1; c++) {
      const w = Math.min(b, c + 0.5) - Math.max(a, c - 0.5);
      if (w > 0) {
        index.push(c);
        weight.push(w);
        total += w;
      }
    }
    if (total > 0) for (let q = first; q < weight.length; q++) weight[q] = weight[q]! / total;
    else {
      index.push(Math.max(0, Math.min(n - 1, Math.round(centres[d]!))));
      weight.push(1);
    }
  }
  start[centres.length] = index.length;
  return { start, index: Int32Array.from(index), weight: Float32Array.from(weight) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Remote COGs
// ─────────────────────────────────────────────────────────────────────────────

const MERC_R = 6378137;
/** Native pixel size of the CHM tiles (Web-Mercator zoom 17 × 256 px): ≈ 1.194 m. */
const CHM_RES = (2 * Math.PI * MERC_R) / 2 ** 25;
const CHM_PATH = '/forests/v1/alsgedi_global_v6_float/chm/';
const HIST_BINS = 61; // 0..60 m, as in the bundling script

/** Bing-style quadkey of the tile containing a point. */
export function quadkey(lat: number, lon: number, z: number): string {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  let q = '';
  for (let i = z; i > 0; i--) q += String(((x >> (i - 1)) & 1) + (((y >> (i - 1)) & 1) << 1));
  return q;
}

const mercY = (lat: number): number => MERC_R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const mercX = (lon: number): number => (MERC_R * lon * Math.PI) / 180;
const invMercLat = (my: number): number => ((2 * Math.atan(Math.exp(my / MERC_R)) - Math.PI / 2) * 180) / Math.PI;

/** geotiff client that routes range requests through the app's HTTP layer (native / proxy / Node aware). */
class ChmResponse extends BaseResponse {
  constructor(private readonly r: RawResponse) {
    super();
  }
  override get status(): number {
    return this.r.status;
  }
  override getHeader(name: string): string | undefined {
    return this.r.headers[name.toLowerCase()];
  }
  override async getData(): Promise<ArrayBuffer> {
    return this.r.data;
  }
}

class ChmClient extends BaseClient {
  constructor(
    url: string,
    private readonly outerSignal?: AbortSignal,
  ) {
    super(url);
  }
  override async request(options: RequestInit = {}): Promise<BaseResponse> {
    const headers: Record<string, string> = {};
    if (options.headers) new Headers(options.headers).forEach((v, k) => (headers[k] = v));
    const signal = (options.signal ?? undefined) || this.outerSignal;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await httpRequest(this.url, { headers, signal, timeoutMs: 60_000, route: false });
        if (r.status >= 500 && attempt < 1) continue;
        return new ChmResponse(r);
      } catch (e) {
        if (attempt >= 1 || signal?.aborted) throw e;
      }
    }
  }
}

interface RemoteCanopyRecord {
  height: Float32Array;
  meanHeight: Float32Array;
  cover: Float32Array;
  valid: Uint8Array;
  source: string;
}

/** Cache key under which a remote canopy result for exactly this grid is stored. */
export const remoteCanopyCacheKey = (g: GridSpec): string =>
  `canopy/chm/${g.origin.lat.toFixed(5)},${g.origin.lon.toFixed(5)}/${g.nx}x${g.ny}@${g.cellSize}/${g.x0.toFixed(1)},${g.y0.toFixed(1)}`;

/**
 * Read canopy for `grid` from the remote COGs (slow; ≤ 3 km). Returns null on failure or if the area is too large.
 */
export async function loadRemoteCanopy(grid: GridSpec, opts: Pick<CanopyOptions, 'signal' | 'cache'> = {}): Promise<CanopyResult | null> {
  const extentX = grid.nx * grid.cellSize;
  const extentY = grid.ny * grid.cellSize;
  if (Math.max(extentX, extentY) > MAX_REMOTE_CANOPY_EXTENT + 1e-6) {
    console.warn(`[canopy] remote canopy limited to ${MAX_REMOTE_CANOPY_EXTENT / 1000} km areas (requested ${(Math.max(extentX, extentY) / 1000).toFixed(1)} km)`);
    return null;
  }
  const kv = opts.cache === null ? null : (opts.cache ?? openCache());
  const key = remoteCanopyCacheKey(grid);
  if (kv) {
    const hit = await kv.get<RemoteCanopyRecord>(key).catch(() => undefined);
    if (hit) return finish(hit.height, hit.meanHeight, hit.cover, hit.valid, `${hit.source} (cached)`);
  }
  console.warn('[canopy] reading remote canopy COGs: this is slow (1-row strips, one request per sampled row)');
  try {
    const rec = await readRemote(grid, opts.signal);
    if (!rec) return null;
    if (kv) await kv.put(key, rec).catch(() => undefined);
    return finish(rec.height, rec.meanHeight, rec.cover, rec.valid, rec.source);
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    console.warn('[canopy] remote canopy failed:', e);
    return null;
  }
}

function finish(height: Float32Array, meanHeight: Float32Array, cover: Float32Array, valid: Uint8Array, source: string): CanopyResult | null {
  let n = 0;
  for (let k = 0; k < valid.length; k++) n += valid[k]!;
  if (n === 0) return null;
  return { height, meanHeight, cover, valid, coverage: n / valid.length, source };
}

async function readRemote(grid: GridSpec, signal?: AbortSignal): Promise<RemoteCanopyRecord | null> {
  // Aggregate on a working grid no finer than 10 m (memory: histogram of 61 bins per cell), then resample.
  const workCell = Math.max(grid.cellSize, 10);
  const wnx = Math.max(1, Math.round((grid.nx * grid.cellSize) / workCell));
  const wny = Math.max(1, Math.round((grid.ny * grid.cellSize) / workCell));
  const left = grid.x0 - grid.cellSize / 2;
  const bottom = grid.y0 - grid.cellSize / 2;
  const work: GridSpec = { nx: wnx, ny: wny, cellSize: workCell, x0: left + workCell / 2, y0: bottom + workCell / 2, origin: grid.origin };
  const proj = new LocalProjection(grid.origin);
  const sw = proj.toLatLon(left, bottom);
  const ne = proj.toLatLon(left + wnx * workCell, bottom + wny * workCell);

  const nCells = wnx * wny;
  const hist = new Uint16Array(nCells * HIST_BINS);
  const sum = new Float64Array(nCells);
  const cnt = new Uint32Array(nCells);
  const cov = new Uint32Array(nCells);

  const qks = new Set([quadkey(ne.lat, sw.lon, 9), quadkey(ne.lat, ne.lon, 9), quadkey(sw.lat, sw.lon, 9), quadkey(sw.lat, ne.lon, 9)]);
  let read = 0;
  for (const qk of qks) {
    const url = serviceUrl('chm', `${CHM_PATH}${qk}.tif`);
    let img: GeoTIFFImage;
    try {
      const tif = await fromCustomClient(new ChmClient(url, signal), { allowFullFile: false }, signal);
      img = await tif.getImage(0);
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn(`[canopy] CHM tile ${qk} unavailable:`, e);
      continue;
    }
    read += await aggregateTile(img, work, proj, sw, ne, { hist, sum, cnt, cov }, signal);
  }
  if (!read) return null;

  const height = new Float32Array(nCells);
  const meanHeight = new Float32Array(nCells);
  const cover = new Float32Array(nCells);
  const validW = new Uint8Array(nCells);
  for (let k = 0; k < nCells; k++) {
    const c = cnt[k]!;
    if (!c) continue;
    validW[k] = 1;
    const target = c * 0.9;
    let acc = 0;
    let p90 = HIST_BINS - 1;
    for (let h = 0; h < HIST_BINS; h++) {
      acc += hist[k * HIST_BINS + h]!;
      if (acc >= target) {
        p90 = h;
        break;
      }
    }
    height[k] = p90;
    meanHeight[k] = sum[k]! / c;
    cover[k] = cov[k]! / c;
  }
  fillInvalidNearest(work, validW, [height, meanHeight, cover]);

  const source = `${CHM_SOURCE}; remote COG ${[...qks].join(',')}, aggregated at ${workCell} m`;
  if (work.nx === grid.nx && work.ny === grid.ny && Math.abs(work.cellSize - grid.cellSize) < 1e-9) {
    return { height, meanHeight, cover, valid: validW, source };
  }
  const map = mapGrids(work, grid);
  const validF = new Float32Array(nCells);
  for (let k = 0; k < nCells; k++) validF[k] = validW[k]!;
  const vr = resampleMapped(work, validF, grid, map);
  const valid = new Uint8Array(grid.nx * grid.ny);
  for (let k = 0; k < valid.length; k++) valid[k] = vr[k]! >= 0.5 ? 1 : 0;
  return {
    height: resampleMapped(work, height, grid, map),
    meanHeight: resampleMapped(work, meanHeight, grid, map),
    cover: resampleMapped(work, cover, grid, map),
    valid,
    source,
  };
}

interface Accumulators {
  hist: Uint16Array;
  sum: Float64Array;
  cnt: Uint32Array;
  cov: Uint32Array;
}

/** Stream the rows of one COG that fall in the bbox into the per-cell accumulators; returns pixels read. */
async function aggregateTile(
  img: GeoTIFFImage,
  work: GridSpec,
  proj: LocalProjection,
  sw: LatLon,
  ne: LatLon,
  acc: Accumulators,
  signal?: AbortSignal,
): Promise<number> {
  const [minX, minY, maxX, maxY] = img.getBoundingBox();
  const resX = Math.abs(img.getResolution()[0] ?? CHM_RES) || CHM_RES;
  const resY = Math.abs(img.getResolution()[1] ?? CHM_RES) || CHM_RES;
  const mx0 = mercX(sw.lon);
  const mx1 = mercX(ne.lon);
  const my0 = mercY(sw.lat);
  const my1 = mercY(ne.lat);
  const px0 = Math.max(0, Math.floor((Math.max(mx0, minX!) - minX!) / resX));
  const px1 = Math.min(img.getWidth(), Math.ceil((Math.min(mx1, maxX!) - minX!) / resX));
  const py0 = Math.max(0, Math.floor((maxY! - Math.min(my1, maxY!)) / resY));
  const py1 = Math.min(img.getHeight(), Math.ceil((maxY! - Math.max(my0, minY!)) / resY));
  if (px1 <= px0 || py1 <= py0) return 0;
  const w = px1 - px0;

  // Column → work-cell column (-1 outside).
  const colCell = new Int32Array(w);
  const left = work.x0 - work.cellSize / 2;
  const bottom = work.y0 - work.cellSize / 2;
  for (let c = 0; c < w; c++) {
    const lon = ((minX! + (px0 + c + 0.5) * resX) / MERC_R) * (180 / Math.PI);
    const x = proj.toLocal({ lat: work.origin.lat, lon })[0];
    const i = Math.floor((x - left) / work.cellSize);
    colCell[c] = i >= 0 && i < work.nx ? i : -1;
  }

  // 1-row strips: sample every `step`-th row (≈ 4 rows per work cell) to limit requests; blocked layouts: read all.
  const rowsPerBlock = img.getTileHeight() || 1;
  const step = rowsPerBlock === 1 ? Math.max(1, Math.floor(work.cellSize / (4 * resY))) : 1;
  const chunk = rowsPerBlock === 1 ? 1 : Math.max(rowsPerBlock, 64);
  const starts: number[] = [];
  for (let r = py0; r < py1; r += rowsPerBlock === 1 ? step : chunk) starts.push(r);

  let pixels = 0;
  const readRows = async (r: number): Promise<void> => {
    const rEnd = rowsPerBlock === 1 ? r + 1 : Math.min(py1, r + chunk);
    const res = await img.readRasters({ window: [px0, r, px1, rEnd], samples: [0], signal });
    const band = (Array.isArray(res) ? res[0] : res) as ArrayLike<number>;
    for (let yy = r; yy < rEnd; yy++) {
      const lat = invMercLat(maxY! - (yy + 0.5) * resY);
      const y = proj.toLocal({ lat, lon: work.origin.lon })[1];
      const j = Math.floor((y - bottom) / work.cellSize);
      if (j < 0 || j >= work.ny) continue;
      const base = (yy - r) * w;
      const rowK = j * work.nx;
      for (let c = 0; c < w; c++) {
        const i = colCell[c]!;
        if (i < 0) continue;
        const h = band[base + c]!;
        if (!(h >= 0 && h <= 120)) continue; // no-data / implausible
        const k = rowK + i;
        const bin = Math.min(HIST_BINS - 1, Math.round(h));
        const hk = k * HIST_BINS + bin;
        if (acc.hist[hk]! < 65535) acc.hist[hk] = acc.hist[hk]! + 1;
        acc.sum[k] = acc.sum[k]! + h;
        acc.cnt[k] = acc.cnt[k]! + 1;
        if (h >= CANOPY_COVER_THRESHOLD) acc.cov[k] = acc.cov[k]! + 1;
        pixels++;
      }
    }
  };
  // A few concurrent row reads hide request latency.
  let next = 0;
  const lanes = Array.from({ length: Math.min(8, starts.length) }, async () => {
    while (next < starts.length) await readRows(starts[next++]!);
  });
  await Promise.all(lanes);
  return pixels;
}

/** Fill invalid cells of each field from the nearest valid cell (iterative 4-neighbour dilation). */
function fillInvalidNearest(g: GridSpec, valid: Uint8Array, fields: Float32Array[]): void {
  const { nx, ny } = g;
  const known = valid.slice();
  let frontier = true;
  for (let pass = 0; frontier && pass < nx + ny; pass++) {
    frontier = false;
    const next = known.slice();
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (known[k]) continue;
        const nb = i > 0 && known[k - 1] ? k - 1 : i < nx - 1 && known[k + 1] ? k + 1 : j > 0 && known[k - nx] ? k - nx : j < ny - 1 && known[k + nx] ? k + nx : -1;
        if (nb < 0) continue;
        for (const f of fields) f[k] = f[nb]!;
        next[k] = 1;
        frontier = true;
      }
    known.set(next);
  }
}
