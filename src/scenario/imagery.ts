/**
 * Which aerial photo (if any) the scene will drape over the terrain, and what it is, for the 'imagery' data set record.
 *
 * The photo itself is loaded and cropped by the UI (ui/imagery.ts `loadScenarioImagery`, main thread, display only); this
 * module answers the same question WITHOUT decoding: the demo site is chosen by the same rule (the named site first,
 * then any demo site), the crop by the same test (the photo must cover the whole domain, one pixel of slack), so the
 * record describes the photo the view really shows. src/scenario/imagery.test.ts checks the two agree.
 */
import type { GridSpec } from '../core/grid';
import { bundleFile, DEMO_EXTENT_M, DEMO_SITES, imageryWindow, loadAsset, loadBundleManifest, loadDemoImageryInfo, type DemoRasterMeta, type TraceOptions } from '../data';
import type { LayerContext } from './layers';

export interface ImageryInfo {
  siteId: string;
  meta: DemoRasterMeta;
  /** File sizes (bytes) of imagery.jpg and imagery.json. */
  jpgBytes: number;
  jsonBytes: number;
  /** Pixel rectangle of the site image that covers the scenario domain. */
  crop: { sx: number; sy: number; sw: number; sh: number };
  /** Pixels of the crop as drawn (capped at 2048 on the long side, as the UI does). */
  drawnPx: { w: number; h: number };
  /** ISO capture date of the bundle, when known. */
  capturedOn?: string;
  serviceCopyright?: string;
}

/** The crop rule of ui/imagery.ts `imageryCrop`: the photo must cover the grid's cell-edge bounds. */
export function imageryCropFor(meta: Pick<DemoRasterMeta, 'cellSize' | 'n' | 'centre' | 'extent'>, grid: GridSpec): { sx: number; sy: number; sw: number; sh: number } | null {
  const w = imageryWindow(meta as DemoRasterMeta, grid);
  const n = meta.n || Math.round(meta.extent / meta.cellSize);
  const tol = 1;
  if (w.sx < -tol || w.sy < -tol || w.sx + w.sw > n + tol || w.sy + w.sh > n + tol) return null;
  return w;
}

/** Cap of the drawn photo (px, long side), as in ui/imagery.ts. */
export const IMAGERY_MAX_PX = 2048;

/**
 * The photo that covers `grid`, or null (a place away from the demo sites has none). Reads imagery.json (a few hundred
 * bytes) and takes the photo's size from the bundle manifest, or reads the file when there is no manifest.
 */
export async function describeImagery(grid: GridSpec, ctx: Pick<LayerContext, 'demoSiteId' | 'signal' | 'ledger'>): Promise<ImageryInfo | null> {
  // Sites whose bundled square cannot even touch the domain are not asked (their imagery.json would be read for nothing:
  // eight file reads on every build away from the demo sites). The crop test below still decides for the others.
  const halfX = (grid.nx * grid.cellSize) / 2;
  const halfY = (grid.ny * grid.cellSize) / 2;
  const kLat = 111_195;
  const kLon = kLat * Math.cos((grid.origin.lat * Math.PI) / 180);
  const near = (id: string): boolean => {
    const c = DEMO_SITES.find((s) => s.id === id)?.centre;
    if (!c) return true; // unknown site: let the crop test decide
    const dx = Math.abs((c.lon - grid.origin.lon) * kLon);
    const dy = Math.abs((c.lat - grid.origin.lat) * kLat);
    return dx <= halfX + DEMO_EXTENT_M / 2 + 1000 && dy <= halfY + DEMO_EXTENT_M / 2 + 1000;
  };
  const ids = [ctx.demoSiteId, ...DEMO_SITES.map((s) => s.id)].filter((v, i, a): v is string => !!v && a.indexOf(v) === i && (v === ctx.demoSiteId || near(v)));
  const trace: TraceOptions | undefined = ctx.ledger ? { tag: 'imagery', ledger: ctx.ledger } : undefined;
  const manifest = await loadBundleManifest(ctx.signal);
  for (const id of ids) {
    const info = await loadDemoImageryInfo(id, ctx.signal, trace).catch(() => null);
    if (!info) continue;
    const crop = imageryCropFor(info.meta, grid);
    if (!crop) continue;
    const f = bundleFile(manifest, id, 'imagery.jpg');
    const j = bundleFile(manifest, id, 'imagery.json');
    let jpgBytes = f?.bytes;
    if (jpgBytes === undefined) jpgBytes = (await loadAsset(`demo/${id}/imagery.jpg`, ctx.signal).catch(() => null))?.byteLength ?? 0;
    const scale = Math.min(1, IMAGERY_MAX_PX / Math.max(crop.sw, crop.sh));
    const meta = info.meta as DemoRasterMeta & { serviceCopyright?: string };
    return {
      siteId: id,
      meta: info.meta,
      jpgBytes,
      jsonBytes: j?.bytes ?? 0,
      crop,
      drawnPx: { w: Math.max(64, Math.round(crop.sw * scale)), h: Math.max(64, Math.round(crop.sh * scale)) },
      ...(info.meta.capturedOn ?? f?.capturedOn ? { capturedOn: (info.meta.capturedOn ?? f?.capturedOn)! } : {}),
      ...(meta.serviceCopyright ? { serviceCopyright: meta.serviceCopyright } : {}),
    };
  }
  return null;
}
