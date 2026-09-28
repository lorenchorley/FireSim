/**
 * Aerial imagery for the terrain texture. The demo sites bundle NSW Spatial Services imagery at 8 m
 * (public/demo/<site>/imagery.jpg + imagery.json) on a 9 km square centred on the site, row 0 = north.
 *
 * src/data locates it (loadDemoImageryInfo) and computes the pixel window of a scenario grid (imageryWindow);
 * {@link loadScenarioImagery} picks the named demo site or any demo site whose bundled square contains the domain (a
 * GPS / typed location next to a demo site), crops the window and hands the view a canvas covering exactly the
 * scenario domain, as SceneViewApi expects. The crop is capped at 2048 px for mobile GPUs.
 */
import type { GridSpec } from '../core/grid';
import { DEMO_SITES, imageryWindow, loadDemoImageryInfo, resolveAssetBase, type DemoRasterMeta } from '../data';
import type { SceneImagery } from '../render/api';

/** Pixel rectangle (in the site image) covering a grid's cell-edge bounds, or null if the image does not cover it. */
export function imageryCrop(meta: Pick<DemoRasterMeta, 'cellSize' | 'n' | 'centre' | 'extent'>, grid: GridSpec): { sx: number; sy: number; sw: number; sh: number } | null {
  const w = imageryWindow(meta as DemoRasterMeta, grid);
  const n = meta.n || Math.round(meta.extent / meta.cellSize);
  const tol = 1; // one image pixel of slack for projection round-off
  if (w.sx < -tol || w.sy < -tol || w.sx + w.sw > n + tol || w.sy + w.sh > n + tol) return null;
  return w;
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
    const info = await loadDemoImageryInfo(id, signal).catch(() => null);
    if (!info) continue;
    const crop = imageryCrop(info.meta, grid);
    if (!crop) continue;
    try {
      const img = await loadImage(new URL(info.url, location.href).href, signal);
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
      return { image: canvas, attribution: info.meta.attribution || '© Spatial Services NSW (CC BY 4.0)' };
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn('[FireSim] imagery load failed', e);
    }
  }
  return null;
}
