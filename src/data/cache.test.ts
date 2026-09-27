import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  areaPackCovers,
  cachedFetch,
  cachedFetchBinary,
  cachedFetchJson,
  clearCache,
  createIndexedDbKV,
  createMemoryKV,
  deleteAreaPack,
  findAreaPacks,
  listAreaPacks,
  loadAreaPack,
  loadAreaPackItem,
  openCache,
  saveAreaPack,
  setDefaultCache,
  type KV,
} from './cache';
import { HttpError, resetHttpConfig, setHttpConfig } from './http';

afterEach(() => {
  resetHttpConfig();
  vi.unstubAllGlobals();
  setDefaultCache(null);
});

/**
 * Minimal asynchronous IndexedDB fake: enough of open / upgrade / transaction / get / put / delete / getAllKeys for
 * the KV implementation, with structured-clone storage and completion events like the real thing.
 */
function installFakeIndexedDB(opts: { failOpen?: boolean } = {}) {
  const dbs = new Map<string, Map<string, Map<string, unknown>>>();
  type Handler = (() => void) | null;
  class Req<T> {
    result!: T;
    error: unknown = null;
    onsuccess: Handler = null;
    onerror: Handler = null;
    onupgradeneeded: Handler = null;
    onblocked: Handler = null;
  }
  const later = (fn: () => void) => setTimeout(fn, 0);
  const makeTx = (stores: Map<string, Map<string, unknown>>, name: string, mode: string) => {
    const data = stores.get(name);
    if (!data) throw new Error(`NotFoundError: ${name}`);
    const tx = { oncomplete: null as Handler, onerror: null as Handler, onabort: null as Handler, error: null as unknown, objectStore: () => store };
    let pending = 0;
    const op = <T>(fn: () => T) => {
      const r = new Req<T>();
      pending++;
      later(() => {
        r.result = fn();
        r.onsuccess?.();
        if (--pending === 0) later(() => tx.oncomplete?.());
      });
      return r;
    };
    const store = {
      get: (k: string) => op(() => structuredClone(data.get(k))),
      put: (v: unknown, k: string) =>
        op(() => {
          if (mode !== 'readwrite') throw new Error('ReadOnlyError');
          data.set(k, structuredClone(v));
          return k;
        }),
      delete: (k: string) => op(() => void data.delete(k)),
      getAllKeys: (range?: { lower: string; upper: string }) =>
        op(() => [...data.keys()].filter((k) => !range || (k >= range.lower && k <= range.upper)).sort()),
    };
    return tx;
  };
  const indexedDB = {
    open(name: string) {
      const req = new Req<unknown>();
      later(() => {
        if (opts.failOpen) {
          req.error = new Error('InvalidStateError');
          req.onerror?.();
          return;
        }
        let stores = dbs.get(name);
        const created = !stores;
        if (!stores) dbs.set(name, (stores = new Map()));
        const s = stores;
        req.result = {
          objectStoreNames: { contains: (n: string) => s.has(n) },
          createObjectStore: (n: string) => s.set(n, new Map()),
          transaction: (n: string, mode: string) => makeTx(s, n, mode),
          close() {},
          onversionchange: null,
        };
        if (created) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  vi.stubGlobal('indexedDB', indexedDB);
  vi.stubGlobal('IDBKeyRange', { bound: (lower: string, upper: string) => ({ lower, upper }) });
  return dbs;
}

/** Common KV behaviour, run against both backends. */
async function exerciseKV(kv: KV) {
  expect(await kv.get('missing')).toBeUndefined();
  await kv.put('b/2', { n: 2 });
  await kv.put('a/1', new Float32Array([1.5, 2.5]));
  await kv.put('b/1', new Uint8Array([7]).buffer);
  expect(await kv.get('b/2')).toEqual({ n: 2 });
  const f = await kv.get<Float32Array>('a/1');
  expect(f).toBeInstanceOf(Float32Array);
  expect([...f!]).toEqual([1.5, 2.5]);
  const ab = await kv.get<ArrayBuffer>('b/1');
  expect(ab).toBeInstanceOf(ArrayBuffer);
  expect(new Uint8Array(ab!)[0]).toBe(7);
  // Stored values are copies: mutating what we got back does not change the store.
  f![0] = 99;
  expect((await kv.get<Float32Array>('a/1'))![0]).toBe(1.5);
  expect(await kv.keys()).toEqual(['a/1', 'b/1', 'b/2']);
  expect(await kv.keys('b/')).toEqual(['b/1', 'b/2']);
  await kv.del('b/1');
  await kv.del('never-existed');
  expect(await kv.keys('b/')).toEqual(['b/2']);
  await kv.put('b/2', 'overwritten');
  expect(await kv.get('b/2')).toBe('overwritten');
}

describe('KV stores', () => {
  it('memory KV', async () => {
    await exerciseKV(createMemoryKV());
  });

  it('IndexedDB KV (fake IndexedDB) persists across instances of the same database', async () => {
    const dbs = installFakeIndexedDB();
    const kv = createIndexedDbKV('test-db', 'kv');
    await exerciseKV(kv);
    expect(dbs.get('test-db')?.get('kv')?.size).toBe(2);
    const again = createIndexedDbKV('test-db', 'kv');
    expect(await again.get('b/2')).toBe('overwritten');
  });

  it('IndexedDB KV degrades to memory when the database cannot be opened', async () => {
    installFakeIndexedDB({ failOpen: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = createIndexedDbKV('broken', 'kv');
    await exerciseKV(kv);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('openCache returns one shared instance (memory in Node, IndexedDB when available)', async () => {
    const a = openCache();
    expect(openCache()).toBe(a);
    await a.put('shared', 1);
    expect(await openCache().get('shared')).toBe(1);
    setDefaultCache(null);
    installFakeIndexedDB();
    const idb = openCache();
    expect(idb).not.toBe(a);
    await idb.put('k', 'v');
    expect(await openCache().get('k')).toBe('v');
  });

  it('clearCache removes a prefix', async () => {
    const kv = createMemoryKV();
    await kv.put('t/1', 1);
    await kv.put('t/2', 2);
    await kv.put('u/1', 3);
    expect(await clearCache('t/', kv)).toBe(2);
    expect(await kv.keys()).toEqual(['u/1']);
  });
});

describe('area packs', () => {
  const centre = { lat: -33.715, lon: 150.285 };
  const makePack = (id: string, createdAt: number, extent = 6000) => ({
    id,
    name: `Pack ${id}`,
    centre,
    extent,
    createdAt,
    items: {
      elevation: new Float32Array([100, 200, 300]),
      'terrarium/13/7515/4911': new Uint8Array([137, 80, 78, 71]).buffer,
      weather: { hours: [{ time: 0, temperature: 30 }] },
    },
  });

  it('saves, lists (newest first), loads and deletes packs', async () => {
    const kv = createMemoryKV();
    const meta = await saveAreaPack(makePack('p1', 1000), kv);
    expect(meta.itemNames).toEqual(['elevation', 'terrarium/13/7515/4911', 'weather']);
    expect(meta.bytes).toBeGreaterThanOrEqual(12 + 4);
    await saveAreaPack(makePack('p2', 2000), kv);
    expect((await listAreaPacks(kv)).map((p) => p.id)).toEqual(['p2', 'p1']);

    const p1 = await loadAreaPack('p1', kv);
    expect(p1?.name).toBe('Pack p1');
    expect([...(p1!.items.elevation as Float32Array)]).toEqual([100, 200, 300]);
    expect(new Uint8Array(p1!.items['terrarium/13/7515/4911'] as ArrayBuffer)[1]).toBe(80);
    expect((p1!.items.weather as { hours: unknown[] }).hours).toHaveLength(1);
    expect(await loadAreaPackItem('p1', 'weather', kv)).toEqual({ hours: [{ time: 0, temperature: 30 }] });

    expect(await deleteAreaPack('p1', kv)).toBe(true);
    expect(await deleteAreaPack('p1', kv)).toBe(false);
    expect(await loadAreaPack('p1', kv)).toBeUndefined();
    expect((await kv.keys()).some((k) => k.includes('/p1/') || k.endsWith('/p1'))).toBe(false);
    expect((await listAreaPacks(kv)).map((p) => p.id)).toEqual(['p2']);
  });

  it('re-saving a pack replaces its items', async () => {
    const kv = createMemoryKV();
    await saveAreaPack(makePack('p', 1), kv);
    await saveAreaPack({ ...makePack('p', 2), items: { only: { x: 1 } } }, kv);
    const p = await loadAreaPack('p', kv);
    expect(Object.keys(p!.items)).toEqual(['only']);
    expect(await kv.keys('pack/item/p/')).toEqual(['pack/item/p/only']);
  });

  it('sizes items with shared or cyclic references without recursing forever', async () => {
    // Structured clone (and so IndexedDB) supports cycles; the size estimate used to overflow the stack on them.
    const node: { name: string; self?: unknown; data: Float32Array } = { name: 'n', data: new Float32Array(1000) };
    node.self = node;
    const meta = await saveAreaPack({ ...makePack('cyc', 1), items: { graph: node, again: { a: node.data, b: node.data } } }, createMemoryKV());
    expect(meta.bytes).toBeGreaterThanOrEqual(4000);
    expect(meta.bytes).toBeLessThan(9000);
  });

  it('rejects ids that would break the key layout', async () => {
    await expect(saveAreaPack(makePack('a/b', 1), createMemoryKV())).rejects.toThrow(/Invalid area pack id/);
  });

  it('works on the IndexedDB backend', async () => {
    installFakeIndexedDB();
    const kv = createIndexedDbKV('packs', 'kv');
    await saveAreaPack(makePack('idb', 5), kv);
    const p = await loadAreaPack('idb', kv);
    expect([...(p!.items.elevation as Float32Array)]).toEqual([100, 200, 300]);
  });

  it('finds packs covering an area, smallest first', async () => {
    const kv = createMemoryKV();
    await saveAreaPack(makePack('big', 1, 20000), kv);
    await saveAreaPack(makePack('small', 2, 6000), kv);
    expect((await findAreaPacks(centre, 4000, kv)).map((p) => p.id)).toEqual(['small', 'big']);
    // 2 km east: a 4 km square reaches 4 km east of centre, outside the 6 km pack (3 km half-width).
    const east = { lat: centre.lat, lon: centre.lon + 2000 / (111195 * Math.cos((centre.lat * Math.PI) / 180)) };
    expect((await findAreaPacks(east, 4000, kv)).map((p) => p.id)).toEqual(['big']);
    expect(areaPackCovers({ centre, extent: 6000 }, centre, 6000)).toBe(true);
    expect(areaPackCovers({ centre, extent: 6000 }, centre, 6001)).toBe(false);
  });
});

describe('read-through cached fetch', () => {
  const tileBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

  function countingFetch(respond: () => Response | Error) {
    let n = 0;
    const fn = (async () => {
      n++;
      const r = respond();
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as typeof fetch;
    return { fn, count: () => n };
  }

  it('binary: cache-first — second call does not touch the network', async () => {
    const kv = createMemoryKV();
    const f = countingFetch(() => new Response(tileBytes));
    setHttpConfig({ fetch: f.fn });
    const a = await cachedFetchBinary('https://example.org/t.png', 'tile/1', { kv });
    const b = await cachedFetchBinary('https://example.org/t.png', 'tile/1', { kv });
    expect([...new Uint8Array(a)]).toEqual([...tileBytes]);
    expect([...new Uint8Array(b)]).toEqual([...tileBytes]);
    expect(f.count()).toBe(1);
  });

  it('binary: refetches when the cached copy is older than maxAgeMs', async () => {
    const kv = createMemoryKV();
    const f = countingFetch(() => new Response(tileBytes));
    setHttpConfig({ fetch: f.fn });
    await cachedFetchBinary('https://example.org/t.png', 'tile/2', { kv });
    const r = await cachedFetch('https://example.org/t.png', 'tile/2', async () => new ArrayBuffer(1), { kv, maxAgeMs: -1 });
    expect(r.from).toBe('network');
    expect(r.data.byteLength).toBe(1);
  });

  it('JSON: network-first, falls back to the cached copy when offline', async () => {
    const kv = createMemoryKV();
    let online = true;
    let version = 1;
    const f = countingFetch(() => (online ? new Response(JSON.stringify({ version: version++ })) : new TypeError('fetch failed')));
    setHttpConfig({ fetch: f.fn, retryDelayMs: 1 });
    expect(await cachedFetchJson('https://example.org/w.json', 'w', { kv })).toEqual({ version: 1 });
    expect(await cachedFetchJson('https://example.org/w.json', 'w', { kv })).toEqual({ version: 2 });
    online = false;
    const r = await cachedFetch('https://example.org/w.json', 'w', (u, o) => import('./http').then((m) => m.fetchJson(u, o)), { kv }, 'network-first');
    expect(r).toMatchObject({ data: { version: 2 }, from: 'stale' });
    expect(await cachedFetchJson('https://example.org/w.json', 'w', { kv })).toEqual({ version: 2 });
  });

  it('throws the HttpError when offline with nothing cached', async () => {
    const f = countingFetch(() => new TypeError('fetch failed'));
    setHttpConfig({ fetch: f.fn, retryDelayMs: 1 });
    const err = await cachedFetchBinary('https://example.org/x', 'none', { kv: createMemoryKV() }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.offline).toBe(true);
  });

  it('an abort is not masked by a stale cached value', async () => {
    const kv = createMemoryKV();
    await kv.put('k', { t: 0, url: 'u', v: { cached: true } });
    const ctrl = new AbortController();
    ctrl.abort();
    const err = (await cachedFetchJson('https://example.org/x', 'k', { kv, signal: ctrl.signal }).catch((e) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.kind).toBe('aborted');
  });

  it('a failing cache write does not fail the request', async () => {
    const broken: KV = { ...createMemoryKV(), put: async () => Promise.reject(new Error('QuotaExceededError')) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setHttpConfig({ fetch: countingFetch(() => new Response(tileBytes)).fn });
    const r = await cachedFetchBinary('https://example.org/t.png', 'x', { kv: broken });
    expect(r.byteLength).toBe(tileBytes.length);
    warn.mockRestore();
  });
});
