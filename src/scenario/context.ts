/**
 * Places context for a scenario: roads and tracks, RFS fire trails, home address points, residential / built-up zones
 * and place names (core/places.ts `ContextLayers`), with the offline-first chain
 *
 *   1. the bundled demo site that covers the whole domain            (public/demo/<site>/context.json, works offline)
 *   2. an area pack that covers the domain                             (item 'context', saved in Setup with signal)
 *   3. the cache, when fresh (≤ 7 days)                               (key = query envelope rounded outward to ~500 m)
 *   4. a live query of the NSW services, when online                  (data/nswContext.ts; the result is cached)
 *   5. a stale cache entry / the part of a demo site that overlaps    (with a warning)
 *   6. nothing                                                        (with a warning that names the remedy)
 *
 * It NEVER throws for missing data: every failure becomes a warning (MESSAGES.context*). It rejects only when the
 * caller's `signal` aborts. Data licence: CC BY 4.0, © Spatial Services NSW and © State of NSW and Department of
 * Planning, Housing and Infrastructure (the attribution strings travel in `ContextLayers.sources`).
 */
import { localDay } from '../core/datasets';
import type { ContextLayers } from '../core/places';
import {
  contextCacheKey,
  contextQueryBBox,
  decodeContext,
  demoSiteCovering,
  fetchNswContextFile,
  findAreaPacks,
  NswContextUnavailableError,
  loadAreaPackItem,
  loadAssetJson,
  openCache,
  CONTEXT_QUERY_LABELS,
  traceRead,
  type ContextFileV1,
  type ContextQueryId,
  type KV,
  type TraceOptions,
} from '../data';
import { demoCoverage, type LayerContext } from './layers';
import { MESSAGES } from './messages';
import { SCENARIO_PARAMS } from './params';

export interface ContextRequest extends LayerContext {
  /** Clock (unix ms): the age of cache entries and the `fetched` date of a live query (tests). */
  now?: number;
  /** Progress 0-1 with a message while a live query runs. */
  onProgress?: (fraction: number, message: string) => void;
  /** Override SCENARIO_PARAMS.contextLiveTimeoutMs. */
  liveTimeoutMs?: number;
}

export type ContextOrigin = ContextLayers['origin'];

/** What the loader learnt about where the context came from (for the roads / trails / homes / zones / place-names records). */
export interface ContextInfo {
  /** Bundled demo site (origin 'bundled'). */
  siteId?: string;
  /** Area pack name (origin 'area-pack'). */
  packName?: string;
  /** Epoch ms a stored live result was downloaded (origin 'cache'). */
  cachedAt?: number;
  /** True when a bundled file covers only part of the area. */
  partial?: boolean;
  /** Layers a live query could not read or finish. */
  failed?: ContextQueryId[];
  timedOut?: boolean;
  /** Wall time of the whole chain (ms). */
  durationMs: number;
  /** Size (bytes) of the whole version-1 file when it was read as a file (bundled, area pack, stored copy); absent for a live query. */
  fileBytes?: number;
}

export interface ContextResult {
  /** The layers in local metres about the request centre, or null when no source had any. */
  context: ContextLayers | null;
  origin: ContextOrigin | 'none';
  /** Plain-English, non-fatal problems (also for a partial result). */
  warnings: string[];
  /** The origin-independent version-1 file the layers were decoded from (what an area pack stores). */
  file: ContextFileV1 | null;
  info: ContextInfo;
}

/** Ledger tag of the shared context file (bundled / pack / stored); its bytes are shared by the five context data sets. */
export const CONTEXT_FILE_TAG = 'context-file';

/** What is cached under {@link contextCacheKey}. */
interface ContextCacheRecord {
  /** Unix ms when the live query ran. */
  t: number;
  file: ContextFileV1;
  /** Size of the file as JSON (bytes): what the storage report counts for this entry (data/cache.ts storedBytes), the same figure the build's records state. */
  n?: number;
}

/** Area-pack item name of the context file. */
export const CONTEXT_PACK_ITEM = 'context';

const DAY_MS = 86_400_000;
/** Cache entries kept (the oldest are dropped): each is 30-300 KB. */
const CACHE_ENTRIES = 10;

const abortReason = (signal?: AbortSignal): unknown => signal?.reason ?? new DOMException('Build cancelled', 'AbortError');
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

/** True for a well-formed version-1 file (cheap structural check; the content came from storage or a bundle). */
export function isContextFile(f: unknown): f is ContextFileV1 {
  const x = f as Partial<ContextFileV1> | null | undefined;
  return !!x && x.version === 1 && Array.isArray(x.roads) && Array.isArray(x.fireTrails) && Array.isArray(x.zones) && Array.isArray(x.homes) && Array.isArray(x.places) && Array.isArray(x.sources);
}

interface Found {
  file: ContextFileV1;
  origin: ContextOrigin;
  warnings: string[];
  info: Omit<ContextInfo, 'durationMs'>;
}


/**
 * Find the context file for a domain: see the module doc for the order. `fresh` (area-pack download) asks the services
 * before the pack / cache so the new pack is current, falling back to what is stored when they do not answer.
 */
export async function resolveContextFile(req: ContextRequest, fresh = false): Promise<Found | { file: null; origin: 'none'; warnings: string[]; info: Omit<ContextInfo, 'durationMs'> }> {
  const { signal } = req;
  const kv: KV = req.kv ?? openCache();
  const now = req.now ?? Date.now();
  const warnings: string[] = [];
  const bbox = contextQueryBBox(req.centre, req.extent);
  const key = contextCacheKey(bbox);
  const trace: TraceOptions | undefined = req.ledger ? { tag: CONTEXT_FILE_TAG, ledger: req.ledger } : undefined;
  const found = (file: ContextFileV1, origin: ContextOrigin, info: Omit<ContextInfo, 'durationMs'> = {}): Found => ({ file, origin, warnings, info });
  checkAbort(signal);

  // 1. Bundled demo site.
  const site = demoSiteCovering(req.centre, req.extent);
  if (site) {
    const f = await loadAssetJson<ContextFileV1>(`demo/${site}/context.json`, signal, trace).catch(() => null);
    checkAbort(signal);
    if (isContextFile(f)) return found(f, 'bundled', { siteId: site });
  }

  // 2. Area pack.
  const fromPack = async (): Promise<{ file: ContextFileV1; pack: string } | null> => {
    try {
      for (const m of await findAreaPacks(req.centre, req.extent, kv)) {
        if (!m.itemNames.includes(CONTEXT_PACK_ITEM)) continue;
        const f = await loadAreaPackItem<ContextFileV1>(m.id, CONTEXT_PACK_ITEM, kv, trace);
        if (isContextFile(f)) return { file: f, pack: m.name };
      }
    } catch {
      /* no pack store */
    }
    return null;
  };
  if (!fresh) {
    const f = await fromPack();
    checkAbort(signal);
    if (f) return found(f.file, 'area-pack', { packName: f.pack });
  }

  // 3. Fresh cache.
  const t0 = req.ledger ? req.ledger.now() : 0;
  const cachedRaw = await kv.get<ContextCacheRecord>(key).catch(() => undefined);
  checkAbort(signal);
  const cached = cachedRaw && typeof cachedRaw.t === 'number' && isContextFile(cachedRaw.file) ? cachedRaw : undefined;
  const traceCached = (): void => {
    if (cached) traceRead(trace, 'cache', { host: 'context-cache', path: `/${key}` }, JSON.stringify(cached.file).length, { cachedAt: cached.t, at: t0, durationMs: req.ledger ? req.ledger.now() - t0 : 0 });
  };
  if (!fresh && cached && now - cached.t <= SCENARIO_PARAMS.contextFreshDays * DAY_MS) {
    traceCached();
    return found(cached.file, 'cache', { cachedAt: cached.t });
  }

  // 4. Live query.
  let liveFailure: 'timeout' | 'error' | null = null;
  if (req.online) {
    const live = await liveQuery(req, bbox, now);
    if (live.ok) {
      const { file, failed, timedOut } = live.result;
      if (failed.length) warnings.push(timedOut ? MESSAGES.contextSlow(failedLabels(failed), budgetS(req)) : MESSAGES.contextMissing(failedLabels(failed)));
      else await storeInCache(kv, key, { t: now, file }, (b) => req.ledger?.stored(CONTEXT_FILE_TAG, b)); // a partial result is not cached: the next build asks again
      return found(file, 'live', { failed, timedOut });
    }
    liveFailure = live.failure;
  }

  // 5. Older data is better than none.
  if (cached) {
    warnings.push(MESSAGES.contextStale(localDay(cached.t)));
    traceCached();
    return found(cached.file, 'cache', { cachedAt: cached.t });
  }
  if (fresh) {
    const f = await fromPack();
    checkAbort(signal);
    if (f) return found(f.file, 'area-pack', { packName: f.pack });
  }
  for (const id of demoCoverage(req).partial) {
    const f = await loadAssetJson<ContextFileV1>(`demo/${id}/context.json`, signal, trace).catch(() => null);
    checkAbort(signal);
    if (isContextFile(f)) {
      warnings.push(MESSAGES.contextPartial);
      return found(f, 'bundled', { siteId: id, partial: true });
    }
  }

  // 6. Nothing.
  if (!req.online) warnings.push(MESSAGES.contextOffline);
  else if (liveFailure === 'timeout') warnings.push(MESSAGES.contextTimedOut(budgetS(req)));
  else warnings.push(MESSAGES.contextFailed);
  return { file: null, origin: 'none', warnings, info: liveFailure === 'timeout' ? { timedOut: true } : {} };
}

/** {@link resolveContextFile} that turns any unexpected failure into the "could not be loaded" warning (not an abort). */
async function resolveSafely(req: ContextRequest, fresh = false): ReturnType<typeof resolveContextFile> {
  try {
    return await resolveContextFile(req, fresh);
  } catch (e) {
    checkAbort(req.signal);
    console.warn('[context] places context failed', e);
    return { file: null, origin: 'none', warnings: [MESSAGES.contextFailed], info: {} };
  }
}

/**
 * Load the places context for a scenario domain (see the module doc). Never rejects for missing or malformed data;
 * rejects only with the abort reason when `signal` aborts.
 */
export async function loadContext(req: ContextRequest): Promise<ContextResult> {
  const t0 = req.ledger ? req.ledger.now() : Date.now();
  const took = (): number => (req.ledger ? req.ledger.now() : Date.now()) - t0;
  const r = await resolveSafely(req);
  if (!r.file) return { context: null, origin: 'none', warnings: r.warnings, file: null, info: { ...r.info, durationMs: took() } };
  try {
    const context = decodeContext(r.file, req.centre, r.origin);
    const fileBytes = r.origin === 'live' ? undefined : req.ledger ? (req.ledger.totals(CONTEXT_FILE_TAG).bytes || undefined) : undefined;
    return { context, origin: r.origin, warnings: r.warnings, file: r.file, info: { ...r.info, durationMs: took(), ...(fileBytes ? { fileBytes } : {}) } };
  } catch {
    return { context: null, origin: 'none', warnings: [...r.warnings, MESSAGES.contextFailed], file: null, info: { ...r.info, durationMs: took() } };
  }
}

/**
 * The context file to store in an area pack for the square (centre, extent): the bundled demo file, else a fresh live
 * query (which also refreshes the cache), else what an older pack or the cache already holds. Null with a warning when
 * nothing is available. Rejects only when `signal` aborts.
 */
export async function contextForPack(req: ContextRequest): Promise<{ file: ContextFileV1 | null; warnings: string[] }> {
  const r = await resolveSafely({ ...req, online: true }, true);
  return { file: r.file, warnings: r.warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Live query, cache
// ─────────────────────────────────────────────────────────────────────────────

const failedLabels = (failed: readonly ContextQueryId[]): string => failed.map((f) => CONTEXT_QUERY_LABELS[f]).join(', ');

type Live = { ok: true; result: Awaited<ReturnType<typeof fetchNswContextFile>> } | { ok: false; failure: 'timeout' | 'error' };

/** The live query's time budget in seconds, as shown in warnings. */
const budgetS = (req: ContextRequest): number => (req.liveTimeoutMs ?? SCENARIO_PARAMS.contextLiveTimeoutMs) / 1000;

/** One live query with the caller's abort and the build's time budget (the finished layers are kept at the deadline). */
async function liveQuery(req: ContextRequest, bbox: ReturnType<typeof contextQueryBBox>, now: number): Promise<Live> {
  try {
    const result = await fetchNswContextFile(bbox, {
      now,
      deadlineMs: req.liveTimeoutMs ?? SCENARIO_PARAMS.contextLiveTimeoutMs,
      ...(req.ledger ? { ledger: req.ledger } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
      ...(req.onProgress ? { onProgress: req.onProgress } : {}),
    });
    return { ok: true, result };
  } catch (e) {
    checkAbort(req.signal); // the caller cancelled: propagate
    return { ok: false, failure: e instanceof NswContextUnavailableError && e.timedOut ? 'timeout' : 'error' };
  }
}

async function storeInCache(kv: KV, key: string, rec: ContextCacheRecord, stored?: (bytes: number) => void): Promise<void> {
  try {
    const n = JSON.stringify(rec.file).length;
    await kv.put(key, { ...rec, n });
    stored?.(n);
    const keys = await kv.keys('context/v1/');
    if (keys.length <= CACHE_ENTRIES) return;
    const aged: { key: string; t: number }[] = [];
    for (const k of keys) aged.push({ key: k, t: k === key ? rec.t : ((await kv.get<ContextCacheRecord>(k).catch(() => undefined))?.t ?? 0) });
    aged.sort((a, b) => a.t - b.t);
    for (const old of aged.slice(0, aged.length - CACHE_ENTRIES)) await kv.del(old.key);
  } catch (e) {
    console.warn('[context] cache write failed', e); // the cache is an optimisation
  }
}
