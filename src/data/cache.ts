/**
 * Offline storage for FireSim.
 *
 * - {@link openCache} returns a small async key/value store backed by IndexedDB (database 'firesim', object store
 *   'kv') when IndexedDB exists (browser main thread, Web Workers, Capacitor WebView), otherwise an in-memory Map
 *   (Node / Vitest, or when IndexedDB refuses to open, e.g. some private-browsing modes). Values must be
 *   structured-cloneable: plain objects, arrays, ArrayBuffers and typed arrays are all fine.
 * - **Area packs** bundle everything needed to rebuild a scenario for an area (tiles, rasters, weather, fire history…)
 *   so it can be used on a fire ground without mobile coverage.
 * - {@link cachedFetchBinary} / {@link cachedFetchJson} are read-through wrappers over the HTTP layer that fall back to
 *   the cached copy when the network is unavailable (offline-first).
 */
import type { LatLon } from '../core/geo';
import { fetchBinary, fetchJson, HttpError, type RequestOptions, type ResponseInfo } from './http';
import { endpointOf, traceRead, type TraceOptions } from './ledger';

// ─────────────────────────────────────────────────────────────────────────────
// Key/value store
// ─────────────────────────────────────────────────────────────────────────────

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  /** Keys (sorted) that start with `prefix` (all keys when omitted). */
  keys(prefix?: string): Promise<string[]>;
  /**
   * Approximate stored size of every entry whose key starts with `prefix` (see {@link storedBytes}). Optional: a store
   * without it is sized by reading each entry (storage report, data/storage.ts).
   */
  sizes?(prefix?: string): Promise<KVSize[]>;
}

/** One entry of {@link KV.sizes}: its key, approximate stored bytes and, for cached-fetch records, when it was stored. */
export interface KVSize {
  key: string;
  bytes: number;
  /** Epoch ms the entry was stored (cached-fetch records `{ t, url, v }`, area-pack metadata `createdAt`). */
  t?: number;
}

/** When an entry was stored, if it says (cached-fetch record `t`, area-pack meta `createdAt`). */
export function storedAt(v: unknown): number | undefined {
  if (!v || typeof v !== 'object' || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return undefined;
  const r = v as { t?: unknown; createdAt?: unknown };
  if (typeof r.t === 'number' && Number.isFinite(r.t)) return r.t;
  if (typeof r.createdAt === 'number' && Number.isFinite(r.createdAt)) return r.createdAt;
  return undefined;
}

const sizeEntry = (key: string, v: unknown): KVSize => {
  const t = storedAt(v);
  return t !== undefined ? { key, bytes: storedBytes(v), t } : { key, bytes: storedBytes(v) };
};

export const CACHE_DB_NAME = 'firesim';
export const CACHE_STORE_NAME = 'kv';

let defaultKV: KV | null = null;

/**
 * The shared application cache. Repeated calls return the same instance, so the in-memory fallback is shared too.
 */
export function openCache(): KV {
  if (!defaultKV) defaultKV = hasIndexedDB() ? createIndexedDbKV(CACHE_DB_NAME, CACHE_STORE_NAME) : createMemoryKV();
  return defaultKV;
}

/** Replace the shared cache (e.g. with a Capacitor Filesystem-backed store, or a fresh memory store in tests). */
export function setDefaultCache(kv: KV | null): void {
  defaultKV = kv;
}

function hasIndexedDB(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null && typeof indexedDB.open === 'function';
  } catch {
    return false; // accessing indexedDB can throw in sandboxed iframes
  }
}

/** Copy a value the way IndexedDB would, so callers cannot mutate what is stored. */
function cloneValue<T>(v: T): T {
  if (v === undefined || v === null || typeof v !== 'object') return v;
  if (typeof structuredClone === 'function') return structuredClone(v);
  if (v instanceof ArrayBuffer) return v.slice(0) as T;
  return v; // very old runtimes: store by reference
}

/** In-memory KV with IndexedDB-like copy semantics. */
export function createMemoryKV(): KV {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return map.has(key) ? cloneValue(map.get(key) as T) : undefined;
    },
    async put(key, value) {
      map.set(key, cloneValue(value));
    },
    async del(key) {
      map.delete(key);
    },
    async keys(prefix = '') {
      const out: string[] = [];
      for (const k of map.keys()) if (k.startsWith(prefix)) out.push(k);
      return out.sort();
    },
    async sizes(prefix = '') {
      const out: KVSize[] = [];
      for (const [k, v] of map) if (k.startsWith(prefix)) out.push(sizeEntry(k, v));
      return out.sort((a, b) => (a.key < b.key ? -1 : 1));
    },
  };
}

/**
 * IndexedDB-backed KV. If the database cannot be opened, it silently degrades to an in-memory store (and logs once),
 * so callers never need to handle storage being unavailable.
 */
export function createIndexedDbKV(dbName = CACHE_DB_NAME, storeName = CACHE_STORE_NAME): KV {
  let fallback: KV | null = null;
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  const open = (): Promise<IDBDatabase | null> => {
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase | null>((resolve) => {
        let req: IDBOpenDBRequest;
        try {
          req = indexedDB.open(dbName, 1);
        } catch (e) {
          console.warn('[cache] IndexedDB unavailable, using memory cache:', e);
          return resolve(null);
        }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        req.onsuccess = () => {
          const db = req.result;
          // Another tab upgrading the schema: close so it can proceed; we reopen lazily.
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => {
          console.warn('[cache] IndexedDB open failed, using memory cache:', req.error);
          resolve(null);
        };
        req.onblocked = () => console.warn('[cache] IndexedDB open blocked by another connection');
      });
    }
    return dbPromise;
  };

  const withStore = async <R>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<R>, mem: (kv: KV) => Promise<R>): Promise<R> => {
    const db = await open();
    if (!db) return mem((fallback ??= createMemoryKV()));
    return new Promise<R>((resolve, reject) => {
      let result: R;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(storeName, mode);
      } catch (e) {
        return reject(e);
      }
      const r = fn(tx.objectStore(storeName));
      r.onsuccess = () => (result = r.result);
      // Resolve on transaction completion so writes are durable when the promise settles.
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? r.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  };

  return {
    get<T>(key: string) {
      return withStore<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>, (kv) => kv.get<T>(key));
    },
    async put(key, value) {
      await withStore('readwrite', (s) => s.put(value, key), (kv) => kv.put(key, value).then(() => key as IDBValidKey));
    },
    async del(key) {
      await withStore<undefined>('readwrite', (s) => s.delete(key), (kv) => kv.del(key).then(() => undefined));
    },
    async keys(prefix = '') {
      const ks = await withStore<IDBValidKey[]>(
        'readonly',
        (s) => (prefix && typeof IDBKeyRange !== 'undefined' ? s.getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿')) : s.getAllKeys()),
        (kv) => kv.keys(prefix),
      );
      const out: string[] = [];
      for (const k of ks) if (typeof k === 'string' && k.startsWith(prefix)) out.push(k);
      return out.sort();
    },
    async sizes(prefix = '') {
      const db = await open();
      if (!db) return (fallback ??= createMemoryKV()).sizes!(prefix);
      return new Promise<KVSize[]>((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(storeName, 'readonly');
        } catch (e) {
          return reject(e);
        }
        const out: KVSize[] = [];
        const range = prefix && typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.bound(prefix, prefix + '￿') : undefined;
        const cur = tx.objectStore(storeName).openCursor(range);
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return;
          if (typeof c.key === 'string' && c.key.startsWith(prefix)) out.push(sizeEntry(c.key, c.value));
          c.continue();
        };
        tx.oncomplete = () => resolve(out.sort((a, b) => (a.key < b.key ? -1 : 1)));
        tx.onerror = () => reject(tx.error ?? cur.error);
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      });
    },
  };
}

/** Delete every key that starts with `prefix`; returns the number removed. */
export async function clearCache(prefix: string, kv: KV = openCache()): Promise<number> {
  const ks = await kv.keys(prefix);
  for (const k of ks) await kv.del(k);
  return ks.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Area packs
// ─────────────────────────────────────────────────────────────────────────────

export type AreaPackItem = ArrayBuffer | ArrayBufferView | object;

export interface AreaPack {
  id: string;
  name: string;
  /** Centre of the covered square. */
  centre: LatLon;
  /** Side length of the covered square (m). */
  extent: number;
  /** Unix ms. */
  createdAt: number;
  /** Named layers, e.g. 'elevation', 'canopy', 'weather', 'fireHistory', 'terrarium/13/7515/4911'. */
  items: Record<string, AreaPackItem>;
}

/** What {@link listAreaPacks} returns: the pack without its (possibly large) items. */
export interface AreaPackMeta {
  id: string;
  name: string;
  centre: LatLon;
  extent: number;
  createdAt: number;
  itemNames: string[];
  /** Approximate stored size in bytes. */
  bytes: number;
  /** Approximate stored size of each item (older packs have none). */
  itemBytes?: Record<string, number>;
}

const PACK_META = 'pack/meta/';
const packItemPrefix = (id: string): string => `pack/item/${id}/`;

/** Rough stored size of a structured-cloneable value. Shared / cyclic references are counted once. */
export function approxBytes(v: unknown, seen: Set<object> = new Set()): number {
  if (typeof v === 'string') return v.length * 2;
  if (!v || typeof v !== 'object') return 8;
  if (seen.has(v)) return 8;
  seen.add(v);
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  let n = 16;
  for (const x of Object.values(v)) n += approxBytes(x, seen);
  return n;
}

/**
 * Approximate bytes a cache entry occupies: a cached-fetch record that knows the size of its body (`n`, written by
 * {@link cachedFetch}) counts that plus a small overhead; anything else is measured by {@link approxBytes}.
 */
export function storedBytes(v: unknown): number {
  if (v && typeof v === 'object' && !ArrayBuffer.isView(v) && !(v instanceof ArrayBuffer)) {
    const r = v as { t?: unknown; n?: unknown; url?: unknown };
    if (typeof r.n === 'number' && Number.isFinite(r.n) && typeof r.t === 'number') return r.n + 64 + (typeof r.url === 'string' ? r.url.length : 0);
  }
  return approxBytes(v);
}

/** Store an area pack, replacing any existing pack with the same id. */
export async function saveAreaPack(pack: AreaPack, kv: KV = openCache()): Promise<AreaPackMeta> {
  if (!pack.id || /[/]/.test(pack.id)) throw new Error(`Invalid area pack id '${pack.id}'`);
  await deleteAreaPack(pack.id, kv);
  const names = Object.keys(pack.items).sort();
  let bytes = 0;
  const itemBytes: Record<string, number> = {};
  for (const name of names) {
    const v = pack.items[name]!;
    const b = approxBytes(v);
    itemBytes[name] = b;
    bytes += b;
    await kv.put(packItemPrefix(pack.id) + name, v);
  }
  const meta: AreaPackMeta = {
    id: pack.id,
    name: pack.name,
    centre: { lat: pack.centre.lat, lon: pack.centre.lon },
    extent: pack.extent,
    createdAt: pack.createdAt,
    itemNames: names,
    bytes,
    itemBytes,
  };
  // Written last: a pack only becomes visible once all its items are stored.
  await kv.put(PACK_META + pack.id, meta);
  return meta;
}

/** All stored packs, newest first. */
export async function listAreaPacks(kv: KV = openCache()): Promise<AreaPackMeta[]> {
  const out: AreaPackMeta[] = [];
  for (const k of await kv.keys(PACK_META)) {
    const m = await kv.get<AreaPackMeta>(k);
    if (m) out.push(m);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Load a pack with all its items, or undefined if it does not exist (or is incomplete). */
export async function loadAreaPack(id: string, kv: KV = openCache()): Promise<AreaPack | undefined> {
  const meta = await kv.get<AreaPackMeta>(PACK_META + id);
  if (!meta) return undefined;
  const items: Record<string, AreaPackItem> = {};
  for (const name of meta.itemNames) {
    const v = await kv.get<AreaPackItem>(packItemPrefix(id) + name);
    if (v === undefined) return undefined;
    items[name] = v;
  }
  return { id: meta.id, name: meta.name, centre: meta.centre, extent: meta.extent, createdAt: meta.createdAt, items };
}

/** Load a single item of a pack. */
export async function loadAreaPackItem<T = AreaPackItem>(id: string, name: string, kv: KV = openCache(), trace?: TraceOptions): Promise<T | undefined> {
  const t0 = trace?.ledger ? trace.ledger.now() : 0;
  const v = await kv.get<T>(packItemPrefix(id) + name);
  if (trace?.ledger && v !== undefined) {
    const ep = endpointOf(`pack://area-pack/${id}/${name}`);
    const meta = await kv.get<AreaPackMeta>(PACK_META + id).catch(() => undefined);
    traceRead(trace, 'pack', { host: 'area-pack', path: ep.path }, meta?.itemBytes?.[name] ?? approxBytes(v), { at: t0, durationMs: trace.ledger.now() - t0, ...(meta?.createdAt ? { cachedAt: meta.createdAt } : {}) });
  }
  return v;
}

/** Delete a pack; returns true if it existed. */
export async function deleteAreaPack(id: string, kv: KV = openCache()): Promise<boolean> {
  const existed = (await kv.get(PACK_META + id)) !== undefined;
  await kv.del(PACK_META + id); // hide it first
  for (const k of await kv.keys(packItemPrefix(id))) await kv.del(k);
  return existed;
}

/**
 * Stored packs whose square fully contains the square of side `extent` centred on `centre`, best fit (smallest) first.
 * Uses a local flat-earth approximation, which is accurate for pack-sized areas.
 */
export async function findAreaPacks(centre: LatLon, extent: number, kv: KV = openCache()): Promise<AreaPackMeta[]> {
  const packs = await listAreaPacks(kv);
  return packs.filter((p) => areaPackCovers(p, centre, extent)).sort((a, b) => a.extent - b.extent);
}

/** True when pack `p` covers the square of side `extent` around `centre`. */
export function areaPackCovers(p: Pick<AreaPackMeta, 'centre' | 'extent'>, centre: LatLon, extent: number): boolean {
  const ky = 111195;
  const kx = ky * Math.cos((p.centre.lat * Math.PI) / 180);
  const dx = Math.abs((centre.lon - p.centre.lon) * kx);
  const dy = Math.abs((centre.lat - p.centre.lat) * ky);
  const slack = p.extent / 2 - extent / 2;
  return dx <= slack + 1e-6 && dy <= slack + 1e-6;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-through fetch
// ─────────────────────────────────────────────────────────────────────────────

export interface CachedFetchOptions extends RequestOptions {
  /**
   * 'cache-first' (default for binary): return a fresh-enough cached value without touching the network; fetch
   *   otherwise. Right for immutable resources such as terrain tiles.
   * 'network-first' (default for JSON): try the network, fall back to the cache when offline. Right for weather,
   *   incidents and other changing data.
   */
  policy?: 'cache-first' | 'network-first';
  /** Maximum age (ms) for a cache-first hit to be used without revalidation. Default: forever. */
  maxAgeMs?: number;
  /** Cache instance (default: the shared cache). */
  kv?: KV;
}

/** Where a cached-fetch value came from. `stale` = the network failed and an older cached copy was returned. */
export type CacheOrigin = 'network' | 'cache' | 'stale';

export interface CachedResult<T> {
  data: T;
  from: CacheOrigin;
  /** Unix ms when the data was fetched from the network. */
  fetchedAt: number;
}

interface CacheRecord<T> {
  t: number;
  url: string;
  v: T;
  /** Bytes of the response body when it was downloaded (absent on records written by older versions). */
  n?: number;
}

/**
 * Generic read-through cached GET; see {@link cachedFetchBinary} and {@link cachedFetchJson}. `tag`/`ledger` in the
 * options record a stored-copy hit (its size and the time it was stored) and, through the HTTP layer, a download.
 */
export async function cachedFetch<T>(
  url: string,
  key: string,
  fetcher: (url: string, opts: RequestOptions) => Promise<T>,
  opts: CachedFetchOptions = {},
  defaultPolicy: 'cache-first' | 'network-first' = 'cache-first',
): Promise<CachedResult<T>> {
  const { policy = defaultPolicy, maxAgeMs = Infinity, kv = openCache(), ...req } = opts;
  const t0 = req.ledger ? req.ledger.now() : 0;
  const cached = await kv.get<CacheRecord<T>>(key).catch(() => undefined);
  const traceHit = (source: 'cache' | 'stale'): void => {
    if (!req.ledger || !cached) return;
    const ep = endpointOf(cached.url || url);
    req.ledger.record({ tag: req.tag ?? 'other', host: ep.host, path: ep.path, source, bytes: cached.n ?? approxBytes(cached.v), bodyBytes: cached.n ?? approxBytes(cached.v), cachedAt: cached.t, at: t0, durationMs: req.ledger.now() - t0, ...(req.note ? { note: req.note } : {}) });
  };
  if (cached && policy === 'cache-first' && Date.now() - cached.t <= maxAgeMs) {
    traceHit('cache');
    return { data: cached.v, from: 'cache', fetchedAt: cached.t };
  }
  let bodyBytes: number | undefined;
  const userOnResponse = req.onResponse;
  const fetchOpts: RequestOptions = {
    ...req,
    onResponse: (info: ResponseInfo) => {
      bodyBytes = info.bodyBytes;
      userOnResponse?.(info);
    },
  };
  try {
    const data = await fetcher(url, fetchOpts);
    const t = Date.now();
    // A failing cache write must not fail the request.
    let written = true;
    await kv.put(key, { t, url, v: data, ...(bodyBytes !== undefined ? { n: bodyBytes } : {}) } satisfies CacheRecord<T>).catch((e) => {
      written = false;
      console.warn('[cache] write failed', key, e);
    });
    if (written && req.ledger) req.ledger.stored(req.tag ?? 'other', bodyBytes ?? 0);
    return { data, from: 'network', fetchedAt: t };
  } catch (e) {
    const aborted = e instanceof HttpError && e.kind === 'aborted';
    if (cached && !aborted) {
      traceHit('stale');
      return { data: cached.v, from: 'stale', fetchedAt: cached.t };
    }
    throw e;
  }
}

/** Binary GET through the cache (cache-first by default). */
export async function cachedFetchBinary(url: string, key: string, opts: CachedFetchOptions = {}): Promise<ArrayBuffer> {
  return (await cachedFetch(url, key, fetchBinary, opts, 'cache-first')).data;
}

/** JSON GET through the cache (network-first by default, cached copy used when offline). */
export async function cachedFetchJson<T>(url: string, key: string, opts: CachedFetchOptions = {}): Promise<T> {
  return (await cachedFetch<T>(url, key, (u, o) => fetchJson<T>(u, o), opts, 'network-first')).data;
}
