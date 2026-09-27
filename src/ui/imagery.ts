/**
 * Aerial imagery for the terrain texture. The demo sites bundle NSW Spatial Services imagery at 8 m
 * (public/demo/<site>/imagery.jpg + imagery.json) on a 9 km square centred on the site, row 0 = north, with cell
 * (col, row) centred at x = −E/2 + (col + 0.5)·cell, y = E/2 − (row + 0.5)·cell in the site's local frame.
 *
 * {@link loadScenarioImagery} crops (and if needed shifts) that image to exactly cover a scenario's terrain grid, as
 * SceneViewApi expects ("image covering the scenario domain exactly; row 0 = north"). src/data has no imagery
 * loader yet, so it lives here.
 */
import { LocalProjection, type LatLon } from '../core/geo';
import type { GridSpec } from '../core/grid';
import { DEMO_SITES, loadAssetJson, resolveAssetBase } from '../data';
import type { SceneImagery } from '../render/api';

interface ImageryMeta {
  id: string;
  cellSize: number;
  n: number;
  centre: LatLon;
  extent: number;
  attribution?: string;
  source?: string;
}

/** Pixel rectangle (in the site image) covering a grid's cell-edge bounds, or null if not fully covered. */
export function imageryCrop(meta: Pick<ImageryMeta, 'cellSize' | 'n' | 'centre' | 'extent'>, grid: GridSpec): { sx: number; sy: number; sw: number; sh: number } | null {
  const proj = new LocalProjection(meta.centre);
  const [ox, oy] = proj.toLocal(grid.origin);
  const half = meta.extent / 2;
  const xMin = ox + grid.x0 - grid.cellSize / 2;
  const xMax = ox + grid.x0 + (grid.nx - 0.5) * grid.cellSize;
  const yMin = oy + grid.y0 - grid.cellSize / 2;
  const yMax = oy + grid.y0 + (grid.ny - 0.5) * grid.cellSize;
  const tol = meta.cellSize;
  if (xMin < -half - tol || xMax > half + tol || yMin < -half - tol || yMax > half + tol) return null;
  const px = (x: number): number => (x + half) / meta.cellSize;
  const py = (y: number): number => (half - y) / meta.cellSize;
  return { sx: px(xMin), sy: py(yMax), sw: px(xMax) - px(xMin), sh: py(yMin) - py(yMax) };
}

function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    img.src = url;
  });
}

/** URL of a demo site's bundled imagery (for thumbnails). */
export function demoImageryUrl(siteId: string): string {
  return new URL(`demo/${siteId}/imagery.jpg`, resolveAssetBase()).href;
}

/**
 * Imagery covering the grid, from the named demo site or any demo site whose bundled square contains the domain.
 * Resolves null when none covers it (e.g. a location away from the demo sites).
 */
export async function loadScenarioImagery(grid: GridSpec, demoSiteId?: string, signal?: AbortSignal): Promise<SceneImagery | null> {
  const ids = [demoSiteId, ...DEMO_SITES.map((s) => s.id)].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);
  for (const id of ids) {
    const meta = await loadAssetJson<ImageryMeta>(`demo/${id}/imagery.json`, signal).catch(() => null);
    if (!meta) continue;
    const crop = imageryCrop(meta, grid);
    if (!crop) continue;
    try {
      const img = await loadImage(demoImageryUrl(id), signal);
      // Native resolution of the crop (8 m pixels), capped at 2048 px for mobile GPUs; aspect follows the grid.
      const scale = Math.min(1, 2048 / Math.max(crop.sw, crop.sh));
      const w = Math.max(64, Math.round(crop.sw * scale));
      const hgt = Math.max(64, Math.round(crop.sh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = hgt;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, hgt);
      return { image: canvas, attribution: meta.attribution ?? '© Spatial Services NSW (CC BY 4.0)' };
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn('[FireSim] imagery load failed', e);
    }
  }
  return null;
}
