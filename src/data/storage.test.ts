/**
 * The storage report (bundled data, stored copies by kind and place, area packs) and the clear functions, on memory
 * stores with fake entries.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryKV, saveAreaPack, type KV, type KVSize } from './cache';
import { loadBundleManifest } from './bundleManifest';
import { clearCacheKind, placeLabel, placeOfKey, removeAreaPack, storage, storageReport, STORAGE_WARN_BYTES } from './storage';

const rec = (bytes: number, t: number, url = 'https://example.org/x') => ({ t, url, v: new ArrayBuffer(bytes), n: bytes });

async function filled(): Promise<KV> {
  const kv = createMemoryKV();
  await kv.put('terrarium/14/15040/9800', rec(110_000, 1000));
  await kv.put('terrarium/14/15041/9800', rec(90_000, 3000));
  await kv.put('openmeteo/https://api.open-meteo.com/v1/forecast?latitude=-33.52&longitude=150.42&hourly=x', rec(77_000, 2000));
  await kv.put('openmeteo/https://archive-api.open-meteo.com/v1/archive?latitude=-33.715&longitude=150.285&daily=x', rec(10_000, 2500));
  await kv.put('arcgis//arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer/3/query/150.38,-33.55,150.46,-33.49/0', rec(900_000, 1500));
  await kv.put('context/v1/150.380,-33.555,150.460,-33.485', { t: 1800, url: 'context', v: { roads: [] }, n: 350_000 });
  await kv.put('annualRainfall/-33.50,150.40', 1100);
  await saveAreaPack({ id: 'home', name: 'Home', centre: { lat: -33.52, lon: 150.42 }, extent: 9000, createdAt: 4000, items: { dem10: new Float32Array(250_000), weather: { hours: [] } } }, kv);
  return kv;
}

describe('storageReport', () => {
  it('groups stored copies by kind and place, lists packs with their items, and adds up', async () => {
    const kv = await filled();
    const r = await storageReport({ kv, estimate: async () => ({ usage: 12e6, quota: 1e9 }) });
    const g = (k: string) => r.caches.find((c) => c.kind === k)!;
    expect(g('terrain-tiles')).toMatchObject({ entries: 2, oldest: 1000, newest: 3000 });
    expect(g('terrain-tiles').bytes).toBeGreaterThan(200_000);
    expect(g('weather').entries).toBe(2);
    expect(g('weather').places.map((p) => p.label).sort()).toEqual(['-33.52, 150.42', 'Katoomba – Narrow Neck & Megalong escarpment'].sort());
    expect(g('map-layers').places[0]!.label).toBe('-33.52, 150.42');
    expect(g('places').bytes).toBeGreaterThanOrEqual(350_000);
    expect(g('rainfall').entries).toBe(1);
    expect(r.packs).toHaveLength(1);
    expect(r.packs[0]).toMatchObject({ id: 'home', name: 'Home', createdAt: 4000 });
    expect(r.packs[0]!.items.find((i) => i.name === 'dem10')!.bytes).toBe(1_000_000);
    expect(r.packs[0]!.bytes).toBeGreaterThanOrEqual(1_000_000);
    expect(r.cacheBytes).toBe(r.caches.reduce((a, c) => a + c.bytes, 0));
    expect(r.onDeviceBytes).toBe(r.cacheBytes + r.packBytes);
    // Pack entries are never counted as stored copies.
    expect(r.caches.some((c) => c.kind === 'other')).toBe(false);
    expect(r.browserEstimate).toEqual({ usageBytes: 12e6, quotaBytes: 1e9 });
    expect(r.warnings).toEqual([]);
  });

  it('the bundled data come from the manifest', async () => {
    const m = await loadBundleManifest();
    const r = await storageReport({ kv: createMemoryKV(), manifest: m });
    expect(r.bundled.available).toBe(true);
    expect(r.bundled.sites).toHaveLength(8);
    expect(r.bundled.totalBytes).toBe(m!.totalBytes);
    expect(r.bundled.sites.find((s) => s.id === 'katoomba')!.capturedOn).toMatch(/^2026-09-2\d$/);
    const none = await storageReport({ kv: createMemoryKV(), manifest: null });
    expect(none.bundled.available).toBe(false);
    expect(none.notes.join(' ')).toMatch(/manifest is missing/);
  });

  it('warns above 500 MB, works with a store without sizes(), and never throws on a broken store', async () => {
    const big: KV = {
      ...createMemoryKV(),
      keys: async () => ['terrarium/14/1/1'],
      sizes: async (): Promise<KVSize[]> => [{ key: 'terrarium/14/1/1', bytes: STORAGE_WARN_BYTES + 1 }],
    };
    expect((await storageReport({ kv: big, manifest: null })).warnings[0]).toMatch(/Stored data use 500\.0 MB/);
    const base = await filled();
    const noSizes: KV = { get: base.get, put: base.put, del: base.del, keys: base.keys };
    const r = await storageReport({ kv: noSizes, manifest: null });
    expect(r.caches.find((c) => c.kind === 'terrain-tiles')!.entries).toBe(2);
    const broken: KV = {
      get: async () => {
        throw new Error('x');
      },
      put: async () => {},
      del: async () => {},
      keys: async () => {
        throw new Error('no store');
      },
    };
    const b = await storageReport({ kv: broken, manifest: null });
    expect(b.onDeviceBytes).toBe(0);
    expect(b.notes.join(' ')).toMatch(/could not be read/);
  });
});

describe('clearing (only after the user confirms)', () => {
  it('clearCacheKind removes one kind of stored copy and never an area pack', async () => {
    const kv = await filled();
    const res = await clearCacheKind('weather', kv);
    expect(res.removed).toBe(2);
    expect(res.bytes).toBeGreaterThan(87_000);
    expect(await kv.keys('openmeteo/')).toEqual([]);
    expect((await kv.keys('terrarium/')).length).toBe(2);
    expect((await kv.keys('pack/')).length).toBeGreaterThan(0);
    await storage.clearCache('terrain-tiles', kv);
    expect(await kv.keys('terrarium/')).toEqual([]);
    expect((await storageReport({ kv, manifest: null })).packs).toHaveLength(1);
  });
  it('removeAreaPack deletes the pack and keeps the stored copies', async () => {
    const kv = await filled();
    expect(await removeAreaPack('home', kv)).toBe(true);
    expect(await kv.keys('pack/')).toEqual([]);
    expect((await kv.keys('terrarium/')).length).toBe(2);
    expect(await storage.deleteAreaPack('home', kv)).toBe(false);
  });
});

describe('places of keys', () => {
  it('reads a lat/lon query, a bbox and a lat,lon segment', () => {
    expect(placeOfKey('openmeteo/https://x/v1/forecast?latitude=-33.52&longitude=150.42&a=1')).toEqual({ lat: -33.52, lon: 150.42 });
    expect(placeOfKey('context/v1/150.380,-33.555,150.460,-33.485')).toEqual({ lat: -33.52, lon: 150.42 });
    expect(placeOfKey('annualRainfall/-33.50,150.40')).toEqual({ lat: -33.5, lon: 150.4 });
    expect(placeOfKey('terrarium/14/1/2')).toBeNull();
    expect(placeLabel({ lat: -33.72, lon: 150.29 })).toMatch(/^Katoomba/);
  });
});
