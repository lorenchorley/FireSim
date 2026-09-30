/**
 * What the app keeps on the device, for the Data sets / storage screen: the bundled demo data shipped inside the app
 * (sizes from public/demo/provenance.json), the stored copies of downloads in IndexedDB (by kind and by place, with
 * their dates), the saved area packs (with their items), and the browser's own usage estimate when it gives one.
 *
 * The clear functions ({@link clearCacheKind}, {@link removeAreaPack}, bundled as {@link storage}) are for the UI to call
 * AFTER the user confirms; nothing in the app calls them automatically. Clearing a kind of stored copy never touches
 * area packs, and deleting a pack never touches the stored copies. Bundled files cannot be removed (they are part of
 * the app).
 *
 * Doc 08 §5.5: show per-pack size, a delete button, and warn above 500 MB ({@link STORAGE_WARN_BYTES}).
 */
import type { LatLon } from '../core/geo';
import { formatBytes } from '../core/datasets';
import { loadBundleManifest, type BundleManifest } from './bundleManifest';
import { deleteAreaPack, listAreaPacks, openCache, storedBytes, storedAt, type AreaPackMeta, type KV, type KVSize } from './cache';
import { DEMO_SITES } from './demoSites';

/** Kinds of stored copies, by cache-key prefix. */
export type StorageKind = 'terrain-tiles' | 'weather' | 'map-layers' | 'places' | 'canopy' | 'rainfall' | 'other';

export const STORAGE_KINDS: Readonly<Record<StorageKind, { title: string; prefixes: readonly string[]; what: string }>> = Object.freeze({
  'terrain-tiles': { title: 'Terrain tiles', prefixes: ['terrarium/'], what: 'Elevation tiles (AWS Terrain Tiles) downloaded for places away from the demo sites.' },
  weather: { title: 'Weather downloads', prefixes: ['openmeteo/'], what: 'Forecasts and past weather from Open-Meteo, kept so a place can be run again offline.' },
  'map-layers': { title: 'Vegetation and fire history', prefixes: ['arcgis/'], what: 'Vegetation map and fire history pages from the NSW services.' },
  places: { title: 'Roads, homes and place names', prefixes: ['context/'], what: 'Roads, fire trails, homes, zones and names from the NSW services.' },
  canopy: { title: 'Tree canopy', prefixes: ['canopy/'], what: 'Canopy heights read from the Meta and WRI maps.' },
  rainfall: { title: 'Usual yearly rainfall', prefixes: ['annualRainfall/'], what: 'Ten-year rainfall averages (a number per place).' },
  other: { title: 'Other', prefixes: [], what: 'Anything else the app stored.' },
});

/** Above this total the storage screen warns (docs/research/08 §5.5). */
export const STORAGE_WARN_BYTES = 500e6;

const PACK_PREFIX = 'pack/';

export interface StoragePlace {
  /** Label: the nearest demo site's name, else 'lat, lon'. */
  label: string;
  centre?: LatLon;
  bytes: number;
  entries: number;
}

export interface StorageGroup {
  kind: StorageKind;
  title: string;
  what: string;
  bytes: number;
  entries: number;
  /** Epoch ms of the oldest and newest stored entry (when the entries say). */
  oldest?: number;
  newest?: number;
  /** Bytes by place (weather, map layers, places; biggest first). */
  places: StoragePlace[];
}

export interface StoragePack {
  id: string;
  name: string;
  centre: LatLon;
  extentM: number;
  createdAt: number;
  bytes: number;
  items: { name: string; bytes?: number }[];
}

export interface StorageReport {
  /** Files shipped inside the app (cannot be removed). */
  bundled: { totalBytes: number; sites: { id: string; name: string; bytes: number; capturedOn?: string }[]; replaysBytes: number; available: boolean };
  /** Stored copies of downloads (IndexedDB), by kind. */
  caches: StorageGroup[];
  cacheBytes: number;
  packs: StoragePack[];
  packBytes: number;
  /** Stored copies + packs: what the app has added to the device. */
  onDeviceBytes: number;
  /** navigator.storage.estimate() when the browser gives it (the app's whole origin, including the app's own cache). */
  browserEstimate?: { usageBytes: number; quotaBytes: number };
  /** Plain-English notes ("Stored data use 612 MB: consider deleting old area packs."). */
  warnings: string[];
  /** How the sizes were measured. */
  notes: string[];
}

const kindOfKey = (key: string): StorageKind => {
  for (const [k, v] of Object.entries(STORAGE_KINDS) as [StorageKind, (typeof STORAGE_KINDS)[StorageKind]][]) if (v.prefixes.some((p) => key.startsWith(p))) return k;
  return 'other';
};

/** A place a cache key refers to (lat/lon query, a bbox, or a 'lat,lon' segment), or null. */
export function placeOfKey(key: string): LatLon | null {
  try {
    const q = /latitude=(-?\d+(?:\.\d+)?)[^&]*&longitude=(-?\d+(?:\.\d+)?)/.exec(key);
    if (q) return { lat: Number(q[1]), lon: Number(q[2]) };
    const bbox = /(-?\d{2,3}\.\d+),(-?\d{1,2}\.\d+),(-?\d{2,3}\.\d+),(-?\d{1,2}\.\d+)/.exec(key);
    if (bbox) {
      const [w, s, e, n] = bbox.slice(1, 5).map(Number) as [number, number, number, number];
      if (Math.abs(w) > 90) return { lat: Math.round(((s + n) / 2) * 1e6) / 1e6, lon: Math.round(((w + e) / 2) * 1e6) / 1e6 };
    }
    const ll = /(-?\d{1,2}\.\d+),(-?\d{2,3}\.\d+)/.exec(key);
    if (ll) return { lat: Number(ll[1]), lon: Number(ll[2]) };
  } catch {
    /* no place */
  }
  return null;
}

/** 'Katoomba – Narrow Neck …' when within 10 km of a demo site's centre, else '-33.52, 150.42'. */
export function placeLabel(p: LatLon): string {
  let best: { name: string; d: number } | null = null;
  for (const s of DEMO_SITES) {
    const dy = (p.lat - s.centre.lat) * 111.2;
    const dx = (p.lon - s.centre.lon) * 111.2 * Math.cos((s.centre.lat * Math.PI) / 180);
    const d = Math.hypot(dx, dy);
    if (d < 10 && (!best || d < best.d)) best = { name: s.name, d };
  }
  return best ? best.name : `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`;
}

async function sizesOf(kv: KV, prefix: string): Promise<KVSize[]> {
  if (kv.sizes) return kv.sizes(prefix);
  const out: KVSize[] = [];
  for (const key of await kv.keys(prefix)) {
    const v = await kv.get(key);
    const t = storedAt(v);
    out.push(t !== undefined ? { key, bytes: storedBytes(v), t } : { key, bytes: storedBytes(v) });
  }
  return out;
}

/**
 * The storage report. Reads every stored entry's size (IndexedDB cursor; a few ms per hundred entries). Never throws:
 * a store that cannot be read reports nothing for it and says so in `notes`.
 */
export async function storageReport(o: { kv?: KV; manifest?: BundleManifest | null; estimate?: () => Promise<{ usage?: number; quota?: number }> } = {}): Promise<StorageReport> {
  const kv = o.kv ?? openCache();
  // Measured 2026-09-30 in Chromium: 5.35 MB of stored values took 3.30 MB by the browser's estimate (IndexedDB
  // compresses what it stores), so the two figures are not expected to agree.
  const notes: string[] = ['Stored sizes are the bytes of each stored value (downloads uncompressed, as received; packs as saved). The browser compresses and adds its own overhead, so its estimate of the space used can be smaller or larger.'];
  const warnings: string[] = [];
  const manifest = o.manifest !== undefined ? o.manifest : await loadBundleManifest().catch(() => null);
  const bundled: StorageReport['bundled'] = { totalBytes: 0, sites: [], replaysBytes: 0, available: !!manifest };
  if (manifest) {
    bundled.totalBytes = manifest.totalBytes;
    bundled.replaysBytes = manifest.replays.totalBytes;
    for (const [id, site] of Object.entries(manifest.sites)) {
      const dates = Object.values(site.files).map((f) => f.capturedOn).filter((d): d is string => !!d).sort();
      bundled.sites.push({ id, name: DEMO_SITES.find((s) => s.id === id)?.name ?? id, bytes: site.totalBytes, ...(dates.length ? { capturedOn: dates[dates.length - 1]! } : {}) });
    }
    bundled.sites.sort((a, b) => b.bytes - a.bytes);
  } else notes.push('The bundled-data manifest is missing, so the size of the demo data is not shown.');

  // ── stored copies ──
  let all: KVSize[] = [];
  try {
    all = await sizesOf(kv, '');
  } catch {
    notes.push('The app’s storage could not be read.');
  }
  const groups = new Map<StorageKind, StorageGroup>();
  const places = new Map<StorageKind, Map<string, StoragePlace>>();
  for (const e of all) {
    if (e.key.startsWith(PACK_PREFIX)) continue;
    const kind = kindOfKey(e.key);
    let g = groups.get(kind);
    if (!g) groups.set(kind, (g = { kind, title: STORAGE_KINDS[kind].title, what: STORAGE_KINDS[kind].what, bytes: 0, entries: 0, places: [] }));
    g.bytes += e.bytes;
    g.entries++;
    if (e.t !== undefined) {
      g.oldest = g.oldest === undefined ? e.t : Math.min(g.oldest, e.t);
      g.newest = g.newest === undefined ? e.t : Math.max(g.newest, e.t);
    }
    if (kind === 'terrain-tiles' || kind === 'other') continue;
    const p = placeOfKey(e.key);
    const label = p ? placeLabel(p) : 'Unknown place';
    let m = places.get(kind);
    if (!m) places.set(kind, (m = new Map()));
    let pl = m.get(label);
    if (!pl) m.set(label, (pl = { label, ...(p ? { centre: p } : {}), bytes: 0, entries: 0 }));
    pl.bytes += e.bytes;
    pl.entries++;
  }
  for (const [kind, m] of places) groups.get(kind)!.places = [...m.values()].sort((a, b) => b.bytes - a.bytes);
  const order = Object.keys(STORAGE_KINDS) as StorageKind[];
  const caches = [...groups.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const cacheBytes = caches.reduce((a, g) => a + g.bytes, 0);

  // ── area packs ──
  let metas: AreaPackMeta[] = [];
  try {
    metas = await listAreaPacks(kv);
  } catch {
    notes.push('The saved area packs could not be listed.');
  }
  const packItemBytes = new Map<string, number>();
  for (const e of all) if (e.key.startsWith('pack/item/')) packItemBytes.set(e.key, e.bytes);
  const packs: StoragePack[] = metas.map((m) => {
    const items = m.itemNames.map((name) => {
      const b = m.itemBytes?.[name] ?? packItemBytes.get(`pack/item/${m.id}/${name}`);
      return b !== undefined ? { name, bytes: b } : { name };
    });
    const measured = m.itemNames.reduce((a, n) => a + (packItemBytes.get(`pack/item/${m.id}/${n}`) ?? 0), 0);
    return { id: m.id, name: m.name, centre: { ...m.centre }, extentM: m.extent, createdAt: m.createdAt, bytes: measured || m.bytes, items };
  });
  const packBytes = packs.reduce((a, p) => a + p.bytes, 0);
  const onDeviceBytes = cacheBytes + packBytes;
  if (onDeviceBytes > STORAGE_WARN_BYTES) warnings.push(`Stored data use ${formatBytes(onDeviceBytes)}: consider deleting area packs or stored copies you no longer need.`);

  const out: StorageReport = { bundled, caches, cacheBytes, packs, packBytes, onDeviceBytes, warnings, notes };
  try {
    const est = o.estimate ?? (globalThis.navigator as { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } } | undefined)?.storage?.estimate?.bind((globalThis.navigator as { storage?: unknown }).storage);
    if (est) {
      const r = await est();
      if (typeof r.usage === 'number' && typeof r.quota === 'number') out.browserEstimate = { usageBytes: r.usage, quotaBytes: r.quota };
    }
  } catch {
    /* not available */
  }
  return out;
}

/**
 * Delete every stored copy of one kind (after the user confirms). Area packs are never touched. Returns the entries
 * removed and their bytes.
 */
export async function clearCacheKind(kind: StorageKind, kv: KV = openCache()): Promise<{ removed: number; bytes: number }> {
  const all = await sizesOf(kv, '');
  let removed = 0;
  let bytes = 0;
  for (const e of all) {
    if (e.key.startsWith(PACK_PREFIX) || kindOfKey(e.key) !== kind) continue;
    await kv.del(e.key);
    removed++;
    bytes += e.bytes;
  }
  return { removed, bytes };
}

/** Delete one saved area pack (after the user confirms); the stored copies stay. True when it existed. */
export const removeAreaPack = (id: string, kv: KV = openCache()): Promise<boolean> => deleteAreaPack(id, kv);

/** The storage API the screen uses: `storage.report()`, `storage.clearCache(kind)`, `storage.deleteAreaPack(id)`. */
export const storage = Object.freeze({ report: storageReport, clearCache: clearCacheKind, deleteAreaPack: removeAreaPack });
