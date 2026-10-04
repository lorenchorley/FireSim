/**
 * Vegetation / fire-history / canopy layers (spec §11.6 chains; doc 08b §3–4 query patterns): live ArcGIS queries
 * (paged, cached), bundled demo data, partial coverage and the offline fallbacks.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { arcgisQuery, demoCoverage, domainBBox, fetchSvtm, loadCanopyLayer, loadFireHistoryLayer, loadVegetationLayer, type LayerContext } from './layers';
import { MESSAGES } from './messages';
import { withFakeNetwork } from './testing';

const root = fileURLToPath(new URL('../../', import.meta.url));
const demoJson = (site: string, name: string): { type: string; features: unknown[] } => JSON.parse(readFileSync(`${root}public/demo/${site}/${name}`, 'utf8'));
let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

/** Serve a FeatureCollection page by page like ArcGIS (resultOffset / resultRecordCount). */
const paged = (fc: { features: unknown[] }) => (url: string) => {
  const q = new URL(url).searchParams;
  const off = Number(q.get('resultOffset'));
  const n = Number(q.get('resultRecordCount'));
  const features = fc.features.slice(off, off + n);
  return { type: 'FeatureCollection', features, ...(off + n < fc.features.length ? { exceededTransferLimit: true } : {}) };
};

const FAR = { lat: -34.9, lon: 149.9 }; // no demo site

describe('ArcGIS query format (doc 08b §3–4)', () => {
  it('envelope in lon/lat, EPSG:4326 in and out, geojson, ordered paging', () => {
    const b = domainBBox({ lat: -33.715, lon: 150.285 }, 9000, 300);
    expect(b[0]).toBeLessThan(150.285);
    expect(b[2]).toBeGreaterThan(150.285);
    expect(b[1]).toBeLessThan(-33.715);
    expect((b[3] - b[1]) * 111195).toBeCloseTo(9600, -1);
    const q = arcgisQuery(b, 'OBJECTID,PCTID', 0.0002, 5, 2000);
    expect(q).toContain('geometryType=esriGeometryEnvelope&inSR=4326');
    expect(q).toContain('outSR=4326');
    expect(q).toContain('maxAllowableOffset=0.0002');
    expect(q).toContain('resultOffset=2000&resultRecordCount=1000&f=geojson');
    expect(q).toContain('orderByFields=OBJECTID');
  });
  it('demo coverage: full inside the 9 km square, partial when overlapping', () => {
    expect(demoCoverage({ centre: { lat: -33.715, lon: 150.285 }, extent: 9000 }).full).toEqual(['katoomba']);
    const p = demoCoverage({ centre: { lat: -33.715, lon: 150.33 }, extent: 9000 });
    expect(p.full).toEqual([]);
    expect(p.partial).toContain('katoomba');
    expect(demoCoverage({ centre: FAR, extent: 6000 })).toEqual({ full: [], partial: [] });
  });
});

describe('live SVTM / NPWS (fake network)', () => {
  it('pages SVTM layer 3 (3147 features → 4 pages), then serves the cached copy offline', async () => {
    const veg = demoJson('katoomba', 'vegetation.geojson');
    const n = withFakeNetwork([{ match: ['VIS/SVTM_NSW_Extant_PCT/MapServer/3/query', 'outFields=OBJECTID,PCTID,PCTName,vegClass,vegForm'], handler: paged(veg) }]);
    restore = n.restore;
    const ctx: LayerContext = { centre: FAR, extent: 6000, online: true, kv: n.kv };
    const g = await fetchSvtm(ctx);
    expect(g.features).toHaveLength(veg.features.length);
    expect(n.calls).toHaveLength(4);
    expect(n.calls[0]).toMatch(/^https:\/\/mapprod3\.environment\.nsw\.gov\.au\/arcgis\/rest\/services\/VIS\/SVTM_NSW_Extant_PCT\/MapServer\/3\/query\?/);
    const layer = await loadVegetationLayer(ctx);
    expect(layer.origin).toBe('network');
    expect(layer.geojson!.features.length).toBe(veg.features.length);
    // Offline network failure after a successful fetch → the cache answers (network-first).
    restore();
    const off = withFakeNetwork([]);
    restore = off.restore;
    const again = await loadVegetationLayer({ ...ctx, kv: n.kv });
    expect(again.geojson!.features.length).toBe(veg.features.length);
  });
  it('NPWS fire history query and the failure fallback', async () => {
    const fh = demoJson('katoomba', 'fire-history.geojson');
    const n = withFakeNetwork([{ match: ['Fire/NPWS_Fire_History/MapServer/0/query', 'outFields=*', 'maxAllowableOffset=0.00005'], handler: paged(fh) }]);
    restore = n.restore;
    const r = await loadFireHistoryLayer({ centre: FAR, extent: 6000, online: true, kv: n.kv });
    expect(r.origin).toBe('network');
    expect(r.geojson!.features).toHaveLength(fh.features.length);
    restore();
    const off = withFakeNetwork([]);
    restore = off.restore;
    const none = await loadFireHistoryLayer({ centre: FAR, extent: 6000, online: true, kv: off.kv });
    expect(none.origin).toBe('none');
    expect(none.warnings).toContain(MESSAGES.networkFailed('Fire history (NPWS)'));
  });
});

describe('an area where the service answered "nothing mapped here"', () => {
  it('fire history: the stored empty answer is a stored copy offline, as the live one was data (not "could not be read")', async () => {
    const n = withFakeNetwork([{ match: ['Fire/NPWS_Fire_History/MapServer/0/query'], handler: () => ({ type: 'FeatureCollection', features: [] }) }]);
    restore = n.restore;
    const ctx: LayerContext = { centre: FAR, extent: 6000, online: true, kv: n.kv };
    const live = await loadFireHistoryLayer(ctx);
    expect(live.origin).toBe('network');
    expect(live.geojson!.features).toHaveLength(0);
    restore();
    const off = withFakeNetwork([]);
    restore = off.restore;
    const again = await loadFireHistoryLayer({ ...ctx, online: false, kv: n.kv });
    expect(again.origin).toBe('cache');
    expect(again.geojson!.features).toHaveLength(0);
    expect(again.info.storedAt).toBeGreaterThan(0);
    expect(off.calls).toHaveLength(0);
    // Nothing was ever stored for another area: that is the unavailable case.
    const other = await loadFireHistoryLayer({ centre: { lat: -35.5, lon: 148.5 }, extent: 6000, online: false, kv: n.kv });
    expect(other.origin).toBe('none');
  });
});

describe('bundled and offline layers', () => {
  it('a demo site: bundled vegetation, history and canopy without network', async () => {
    const n = withFakeNetwork([]);
    restore = n.restore;
    const ctx: LayerContext = { centre: { lat: -33.62, lon: 150.33 }, extent: 6000, online: true, kv: n.kv, demoSiteId: 'grose' };
    const v = await loadVegetationLayer(ctx);
    expect(v.origin).toBe('demo');
    expect(v.source).toMatch(/grose/);
    const c = await loadCanopyLayer(makeGridSpec(ctx.centre, 6000, 30), ctx);
    expect(c.origin).toBe('demo');
    expect(c.canopy!.coverage).toBeGreaterThan(0.99);
    expect(n.calls).toHaveLength(0);
  });
  it('offline far from any data: nothing, canopy type defaults', async () => {
    const n = withFakeNetwork([]);
    restore = n.restore;
    const ctx: LayerContext = { centre: FAR, extent: 3000, online: false, kv: n.kv };
    expect((await loadVegetationLayer(ctx)).origin).toBe('none');
    const c = await loadCanopyLayer(makeGridSpec(FAR, 3000, 30), ctx);
    expect(c.canopy).toBeNull();
    expect(c.warnings).toContain(MESSAGES.canopyUnavailable);
    expect(n.calls).toHaveLength(0);
  });
});
