/**
 * Terrain for a scenario (spec §11.6 "terrain", §0.2 grid identity).
 *
 * The 10 m DEM (bundled NSW 5 m LiDAR resampled to 10 m, an area pack, or Terrarium tiles) is the high-resolution
 * surface `ScenarioData.terrainHiRes` (render, atmosphere). The fire grid (20 or 30 m) is its b×b block average
 * (b = fireCell / 10); `buildTerrain` derives slope, aspect, TPI, curvature and landforms on the fire grid, and the
 * 10 m sub-cells give `slopeP90Deg` (90th percentile of the b² sub-cell slopes) and `cliffFraction` (share of
 * sub-cells steeper than 60°), which capture cliffs the block-averaged slope smooths away.
 * The loaders fall back: demo LiDAR → area pack → Terrarium (bundled / pack / cache / network) → synthetic (warning).
 */
import { makeGridSpec, type GridSpec } from '../core/grid';
import type { LatLon, Terrain } from '../core/types';
import { RAD } from '../core/units';
import {
  loadDemoElevation,
  loadElevation,
  findAreaPacks,
  loadAreaPackItem,
  syntheticElevation,
  syntheticSource,
  DEMO_SITES,
  type DatasetLedger,
  type DemoRasterMeta,
  type ElevationResult,
  type KV,
  type TraceOptions,
} from '../data';
import { mapGrids, resampleMapped } from '../data/canopy';
import { buildTerrain } from '../terrain';
import { MESSAGES } from './messages';
import { SCENARIO_PARAMS } from './params';

export interface HiResDem {
  grid: GridSpec;
  elevation: Float32Array;
  source: string;
}

/** Slope (deg) of a DEM by central differences (one-sided at the edges). */
export function slopeDegOf(g: GridSpec, z: Float32Array, out = new Float32Array(g.nx * g.ny)): Float32Array {
  const { nx, ny, cellSize: h } = g;
  for (let j = 0; j < ny; j++) {
    const jd = j > 0 ? j - 1 : j;
    const ju = j < ny - 1 ? j + 1 : j;
    const dyInv = 1 / (h * (ju - jd));
    for (let i = 0; i < nx; i++) {
      const il = i > 0 ? i - 1 : i;
      const ir = i < nx - 1 ? i + 1 : i;
      const dx = (z[j * nx + ir]! - z[j * nx + il]!) / (h * (ir - il));
      const dy = (z[ju * nx + i]! - z[jd * nx + i]!) * dyInv;
      out[j * nx + i] = Math.atan(Math.sqrt(dx * dx + dy * dy)) * RAD;
    }
  }
  return out;
}

/** Block factor b = fireCell / hiResCell (throws unless an integer ≥ 1). */
export function blockFactor(hiCell: number, fireCell: number): number {
  const b = Math.round(fireCell / hiCell);
  if (b < 1 || Math.abs(b * hiCell - fireCell) > 1e-6) throw new RangeError(`Fire cell ${fireCell} m is not a multiple of the ${hiCell} m DEM cell`);
  return b;
}

/**
 * Fire-grid terrain from the 10 m DEM: b×b block average, `buildTerrain`, and `slopeP90Deg` / `cliffFraction` from the
 * sub-cells. The fire grid is makeGridSpec(origin, nx_hi·cell_hi, fireCell) (cell centres coincide with block centres).
 */
export function fireTerrainFromHiRes(hi: HiResDem, fireCell: number): Terrain {
  const P = SCENARIO_PARAMS;
  const src = hi.grid;
  const b = blockFactor(src.cellSize, fireCell);
  const nx = Math.floor(src.nx / b);
  const ny = Math.floor(src.ny / b);
  if (nx < 2 || ny < 2) throw new RangeError('fireTerrainFromHiRes: domain too small');
  const grid: GridSpec = {
    nx,
    ny,
    cellSize: fireCell,
    x0: src.x0 + ((b - 1) * src.cellSize) / 2,
    y0: src.y0 + ((b - 1) * src.cellSize) / 2,
    origin: { ...src.origin },
  };
  const n = nx * ny;
  const z = new Float32Array(n);
  const p90 = new Float32Array(n);
  const cliff = new Float32Array(n);
  const s10 = slopeDegOf(src, hi.elevation);
  const bb = b * b;
  const vals = new Float32Array(bb);
  const inv = 1 / bb;
  const pos = P.slopePercentile * (bb - 1);
  const pLo = Math.floor(pos);
  const pHi = Math.min(bb - 1, pLo + 1);
  const pw = pos - pLo;
  const cliffDeg = P.cliffSlopeDeg;
  const e = hi.elevation;
  const snx = src.nx;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      let c = 0;
      let nc = 0;
      for (let bj = 0; bj < b; bj++) {
        const row = (j * b + bj) * snx + i * b;
        for (let bi = 0; bi < b; bi++) {
          const kk = row + bi;
          s += e[kk]!;
          const sl = s10[kk]!;
          if (sl > cliffDeg) nc++;
          // Insertion sort into vals[0..c].
          let q = c++;
          while (q > 0 && vals[q - 1]! > sl) {
            vals[q] = vals[q - 1]!;
            q--;
          }
          vals[q] = sl;
        }
      }
      const k = j * nx + i;
      z[k] = s * inv;
      p90[k] = vals[pLo]! + (vals[pHi]! - vals[pLo]!) * pw;
      cliff[k] = nc * inv;
    }
  }
  const t = buildTerrain(grid, z, `${hi.source} (block-averaged ${b}×${b} to ${fireCell} m)`);
  t.slopeP90Deg = p90;
  t.cliffFraction = cliff;
  return t;
}

/** Median of a field (copy + sort; NaN-free input assumed). */
export function medianOf(f: ArrayLike<number>): number {
  const a = Float32Array.from(f as ArrayLike<number>);
  a.sort();
  const n = a.length;
  if (!n) return NaN;
  return n % 2 ? a[(n - 1) >> 1]! : 0.5 * (a[n / 2 - 1]! + a[n / 2]!);
}

/** Bilinear elevation of the fire grid at local (x, y) (m). */
export function elevationAtLocal(t: Terrain, x: number, y: number): number {
  const g = t.grid;
  const fx = Math.min(g.nx - 1, Math.max(0, (x - g.x0) / g.cellSize));
  const fy = Math.min(g.ny - 1, Math.max(0, (y - g.y0) / g.cellSize));
  const i0 = Math.min(Math.floor(fx), g.nx - 2);
  const j0 = Math.min(Math.floor(fy), g.ny - 2);
  const tx = fx - i0;
  const ty = fy - j0;
  const k = j0 * g.nx + i0;
  const z = t.elevation;
  return (z[k]! * (1 - tx) + z[k + 1]! * tx) * (1 - ty) + (z[k + g.nx]! * (1 - tx) + z[k + g.nx + 1]! * tx) * ty;
}

export type TerrainOrigin = 'lidar' | 'pack' | 'tiles' | 'synthetic';

/** Data set id the terrain loaders report under. */
export const TERRAIN_TAG = 'terrain';

/** What the loader learnt about where the elevations came from (for the 'terrain' data set record). */
export interface TerrainInfo {
  /** Bundled LiDAR: the raster's own metadata (capture date, elevation range, service text) and file sizes. */
  lidar?: { meta: DemoRasterMeta; pngBytes: number; jsonBytes: number };
  /** Terrarium tiles: zoom, tile count, where they came from. */
  tiles?: Pick<ElevationResult, 'zoom' | 'tiles' | 'seaOrNoDataCells' | 'origins' | 'sites' | 'packs' | 'oldestCachedAt' | 'degradedFrom'>;
  /** Area pack that supplied the 10 m DEM. */
  packName?: string;
  /** Source text stored with the pack's DEM. */
  packSource?: string;
  /** Kind of synthetic terrain. */
  syntheticKind?: string;
  /** Why the chain fell through to synthetic terrain. */
  syntheticReason?: string;
  /** Wall time of the whole chain (ms). */
  durationMs: number;
  /** Sources tried before the one used ('bundled LiDAR does not cover this area', ...). */
  skipped: string[];
}

export interface HiResResult {
  dem: HiResDem;
  origin: TerrainOrigin;
  warnings: string[];
  /** Demo site whose LiDAR was used. */
  siteId?: string;
  info: TerrainInfo;
}

export interface HiResRequest {
  centre: LatLon;
  extent: number;
  demoSiteId?: string;
  online: boolean;
  signal?: AbortSignal;
  kv?: KV;
  onProgress?: (fraction: number, message: string) => void;
  /** Records every read on the build's request ledger under the tag 'terrain'. */
  ledger?: DatasetLedger;
}

/** Demo sites whose 9 km square contains the domain centre (the named one first). */
export function demoSitesNear(centre: LatLon, preferred?: string): string[] {
  const out = preferred ? [preferred] : [];
  const half = SCENARIO_PARAMS.demoExtentM / 2;
  for (const s of DEMO_SITES) {
    if (s.id === preferred) continue;
    const dy = Math.abs(centre.lat - s.centre.lat) * 111195;
    const dx = Math.abs(centre.lon - s.centre.lon) * 111195 * Math.cos((s.centre.lat * Math.PI) / 180);
    if (dx < half && dy < half) out.push(s.id);
  }
  return out;
}

/** The 10 m DEM of the domain with the §11.6 fallback chain (never throws unless aborted / synthetic disabled). */
export async function loadHiResDem(req: HiResRequest): Promise<HiResResult> {
  const P = SCENARIO_PARAMS;
  const grid = makeGridSpec(req.centre, req.extent, P.hiResCellM);
  const warnings: string[] = [];
  const skipped: string[] = [];
  const clock = (): number => (req.ledger ? req.ledger.now() : Date.now());
  const t0 = clock();
  const trace: TraceOptions | undefined = req.ledger ? { tag: TERRAIN_TAG, ledger: req.ledger } : undefined;
  const aborted = (): void => {
    if (req.signal?.aborted) throw req.signal.reason ?? new DOMException('Build cancelled', 'AbortError');
  };
  // 1. Bundled LiDAR (demo sites; works offline).
  const sites = demoSitesNear(req.centre, req.demoSiteId);
  req.onProgress?.(0.1, 'Reading bundled LiDAR terrain…');
  const lidar = await loadDemoElevation(grid, sites, req.signal, trace).catch(() => null);
  aborted();
  if (lidar) {
    return {
      dem: { grid, elevation: lidar.elevation, source: lidar.source },
      origin: 'lidar',
      warnings,
      siteId: lidar.siteId,
      info: { lidar: { meta: lidar.meta, pngBytes: lidar.bytes.png, jsonBytes: lidar.bytes.json }, durationMs: clock() - t0, skipped },
    };
  }
  skipped.push(sites.length ? 'bundled LiDAR does not cover the whole area' : 'no bundled LiDAR here');
  // 2. Area pack with a stored 10 m DEM.
  const kv = req.kv;
  try {
    for (const m of await findAreaPacks(req.centre, req.extent, kv)) {
      if (!m.itemNames.includes('dem10')) continue;
      const item = await loadAreaPackItem<HiResDem>(m.id, 'dem10', kv, trace);
      if (!item?.grid || !(item.elevation instanceof Float32Array)) continue;
      const elevation = resampleMapped(item.grid, item.elevation, grid, mapGrids(item.grid, grid));
      warnings.push(MESSAGES.terrainFromPack(m.name));
      return {
        dem: { grid, elevation, source: `${item.source} (area pack '${m.name}')` },
        origin: 'pack',
        warnings,
        info: { packName: m.name, packSource: item.source, durationMs: clock() - t0, skipped },
      };
    }
  } catch {
    /* pack store unavailable: continue */
  }
  aborted();
  skipped.push('no saved area pack with terrain');
  // 3. Terrarium tiles: bundled, area-pack tiles, cache, then the network when online.
  req.onProgress?.(0.3, req.online ? 'Downloading terrain tiles…' : 'Reading stored terrain tiles…');
  let tileError: unknown;
  try {
    const r = await loadElevation({
      centre: req.centre,
      extent: req.extent,
      cellSize: P.hiResCellM,
      lidar: false,
      offline: !req.online,
      signal: req.signal,
      ...(req.demoSiteId ? { demoSiteId: req.demoSiteId } : {}),
      ...(kv ? { cache: kv } : {}),
      ...(trace ? { trace } : {}),
      onProgress: (d, t) => req.onProgress?.(0.3 + (0.6 * d) / Math.max(1, t), `Terrain tiles ${d}/${t}`),
    });
    const { zoom, tiles, seaOrNoDataCells, origins, sites: tileSites, packs, oldestCachedAt, degradedFrom } = r;
    return {
      dem: { grid, elevation: r.elevation, source: r.source },
      origin: 'tiles',
      warnings,
      info: {
        tiles: { zoom, tiles, seaOrNoDataCells, ...(origins ? { origins } : {}), ...(tileSites ? { sites: tileSites } : {}), ...(packs ? { packs } : {}), ...(oldestCachedAt !== undefined ? { oldestCachedAt } : {}), ...(degradedFrom !== undefined ? { degradedFrom } : {}) },
        durationMs: clock() - t0,
        skipped,
      },
    };
  } catch (e) {
    aborted();
    tileError = e;
    if (!P.syntheticTerrainFallback) throw e;
  }
  // 4. Synthetic terrain (never for a silent real-site answer: warned prominently).
  warnings.push(MESSAGES.syntheticTerrain);
  const kind = P.syntheticTerrainKind;
  skipped.push(req.online ? 'terrain tiles could not be downloaded' : 'no stored terrain tiles');
  return {
    dem: { grid, elevation: syntheticElevation(grid, kind, 1), source: syntheticSource(kind) },
    origin: 'synthetic',
    warnings,
    info: {
      syntheticKind: kind,
      syntheticReason: tileError instanceof Error ? tileError.message : 'no elevation source',
      durationMs: clock() - t0,
      skipped,
    },
  };
}
