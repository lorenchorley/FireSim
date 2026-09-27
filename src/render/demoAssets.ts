/**
 * Aerial imagery of the bundled demo sites as a {@link SceneImagery} the terrain shader can drape.
 *
 *   public/demo/<site>/imagery.jpg (+ .json)  NSW aerial imagery at 8 m on a 9 km square centred on the site, row 0 north
 *
 * src/data locates the bytes and computes the pixel window of a scenario domain (loadDemoImageryInfo /
 * imageryWindow); this module decodes the JPEG and, when the domain is not the whole bundled square, crops it to the
 * domain's cell-edge extent — SceneImagery must cover the scenario domain exactly. Browser only (createImageBitmap or
 * an <img> + canvas). The bundled LiDAR DEM itself is loaded by src/data loadElevation / loadDemoDem.
 */
import type { GridSpec } from '../core/grid';
import { imageryWindow, loadDemoImageryBytes, loadDemoImageryInfo } from '../data';
import type { SceneImagery } from './api';

export interface DemoImageryOptions {
  /** Scenario grid (any grid of the domain, e.g. terrain.grid): crop the image to its extent. Default: whole image. */
  grid?: GridSpec;
  signal?: AbortSignal;
}

/**
 * Load the bundled aerial imagery of a demo site (null if the site has none). With `grid`, the image is cropped (and
 * padded with transparent black where the domain extends beyond the bundled square) to exactly the grid's extent.
 */
export async function loadDemoImagery(siteId: string, opts: DemoImageryOptions | AbortSignal = {}): Promise<SceneImagery | null> {
  const o: DemoImageryOptions = typeof AbortSignal !== 'undefined' && opts instanceof AbortSignal ? { signal: opts } : (opts as DemoImageryOptions);
  const info = await loadDemoImageryInfo(siteId, o.signal);
  const bytes = await loadDemoImageryBytes(siteId, o.signal);
  if (!bytes) return null;
  const attribution = info?.meta.attribution ?? '© Spatial Services NSW (CC BY 4.0)';
  const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
  const image = await decode(blob);
  if (!o.grid || !info) return { image, attribution };
  const win = imageryWindow(info.meta, o.grid);
  const w = image.width;
  const h = image.height;
  // Whole image (within a quarter pixel): no crop needed.
  if (Math.abs(win.sx) < 0.25 && Math.abs(win.sy) < 0.25 && Math.abs(win.sw - w) < 0.25 && Math.abs(win.sh - h) < 0.25) return { image, attribution };
  return { image: crop(image, win), attribution };
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    // Decoded with row 0 at the top (north); the terrain shader flips v for ImageBitmaps.
    return createImageBitmap(blob, { colorSpaceConversion: 'none' } as ImageBitmapOptions);
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Crop a window (source pixels, may extend beyond the image) into a canvas at the source resolution (≤ 4096 px). */
function crop(image: ImageBitmap | HTMLImageElement, win: { sx: number; sy: number; sw: number; sh: number }): HTMLCanvasElement {
  const scale = Math.min(1, 4096 / Math.max(win.sw, win.sh));
  const cw = Math.max(1, Math.round(win.sw * scale));
  const ch = Math.max(1, Math.round(win.sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  // drawImage with a destination transform handles windows that extend past the image edges.
  g.setTransform(cw / win.sw, 0, 0, ch / win.sh, (-win.sx * cw) / win.sw, (-win.sy * ch) / win.sh);
  g.drawImage(image, 0, 0);
  return canvas;
}
