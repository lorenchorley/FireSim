/**
 * LIVE places context anywhere in NSW: roads and tracks, RFS-classified fire trails, home address points, residential
 * and built-up land-use zones, and place / suburb names, queried from the official ArcGIS REST services
 * (NSW Spatial Services portal and NSW Planning, CC BY 4.0, CORS enabled) and returned as {@link ContextLayers} in
 * local metres. The bundled demo sites carry the same data pre-fetched (`contextLayers.ts`); this is the counterpart for
 * every other place, used by scenario/context.ts when the user is online and no bundled file, area pack or fresh cache
 * entry covers the domain.
 *
 * How a query works (same as scripts/fetch-demo-context.mjs; both import `nswContextCore.ts`, so a given envelope gives
 * a byte-identical file):
 *   1. per layer, one `returnIdsOnly` POST for the envelope of the domain + 400 m margin;
 *   2. the object ids in chunks (`CONTEXT_QUERIES[..].chunk`) as POST `objectIds=…` requests with server-side
 *      generalisation (`maxAllowableOffset`, `geometryPrecision=5`);
 *   3. classify and pack as the version-1 file (`buildContextFile`) and project with `decodeContext`.
 * The six layers run concurrently (at most `concurrency` requests in flight); transient failures (network, timeout,
 * HTTP 408 / 429 / 5xx, ArcGIS error bodies) are retried with exponential back-off. A layer that keeps failing is left
 * out and reported in `failed` (the others are still returned); only when EVERY layer fails does the query throw.
 * Requests go through data/http.ts (browser fetch, or CapacitorHttp on device), so `signal` cancels them all.
 */
import type { LatLon } from '../core/geo';
import type { ContextLayers } from '../core/places';
import { decodeContext, type ContextFileV1 } from './contextLayers';
import { HttpError, fetchJson, serviceUrl } from './http';
import {
  CONTEXT_MARGIN_M,
  CONTEXT_QUERIES,
  CONTEXT_QUERY_IDS,
  buildContextFile,
  contextBBox,
  featuresQueryForm,
  idsQueryForm,
  sourceOfQuery,
  type BBox,
  type ContextFeatures,
  type ContextQueryId,
  type EsriFeature,
} from './nswContextCore';

export { CONTEXT_MARGIN_M, type BBox, type ContextQueryId };

/** Grid (degrees, ~500 m) the query envelope is rounded OUTWARD to, so nearby requests share one cache entry. */
export const CONTEXT_BBOX_GRID_DEG = 0.005;

/** Plain-English names of the queried layers (progress messages, warnings). */
export const CONTEXT_QUERY_LABELS: Readonly<Record<ContextQueryId, string>> = {
  roads: 'roads and tracks',
  fireTrails: 'fire trails',
  homes: 'homes',
  zones: 'residential zones',
  places: 'place names',
  suburbs: 'suburb names',
};

export interface NswContextOptions {
  /** Progress 0-1 with a plain-English message; called after every completed request. */
  onProgress?: (fraction: number, message: string) => void;
  signal?: AbortSignal;
  /** Clock (unix ms) for the `fetched` date of the file. */
  now?: number;
  /** Retries of a transient failure per request (default 3). */
  retries?: number;
  /** First back-off delay (ms); doubles each retry (default 1500). */
  retryDelayMs?: number;
  /** Requests in flight at once (default 4). */
  concurrency?: number;
  /** Timeout of one request (ms, default 30 000). */
  timeoutMs?: number;
}

export interface NswContextFileResult {
  file: ContextFileV1;
  /** Layers that could not be read even after retries (their part of the file is empty). */
  failed: ContextQueryId[];
}

/**
 * Envelope to query for a domain: the square of side `extent` around `centre` plus `marginM`, rounded OUTWARD to
 * {@link CONTEXT_BBOX_GRID_DEG} so the cached result covers every request that maps to the same key.
 */
export function contextQueryBBox(centre: LatLon, extent: number, marginM: number = CONTEXT_MARGIN_M): BBox {
  const b = contextBBox(centre.lat, centre.lon, extent, marginM);
  const g = CONTEXT_BBOX_GRID_DEG;
  const r = (v: number): number => +v.toFixed(6);
  return [r(Math.floor(b[0] / g) * g), r(Math.floor(b[1] / g) * g), r(Math.ceil(b[2] / g) * g), r(Math.ceil(b[3] / g) * g)];
}

/** Cache key of an envelope (the rounded query envelope, so it is stable for nearby requests). */
export const contextCacheKey = (bbox: BBox): string => `context/v1/${bbox.map((v) => v.toFixed(3)).join(',')}`;

// ─────────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────────

interface ArcGisBody {
  error?: { code?: number; message?: string; details?: string[] };
  objectIds?: number[] | null;
  features?: EsriFeature[];
}

/** An error the service reported inside a 200 response. */
class ArcGisError extends Error {
  override readonly name = 'ArcGisError';
  readonly code: number;
  constructor(url: string, code: number, message: string) {
    super(`${url}: ${code} ${message}`);
    this.code = code;
  }
  /** Authentication / not-found errors do not get better with time; overload and server errors do. */
  get transient(): boolean {
    return ![401, 403, 404, 498, 499].includes(this.code);
  }
}

const isAbort = (e: unknown, signal?: AbortSignal): boolean => (e instanceof HttpError && e.kind === 'aborted') || (signal?.aborted ?? false);
const isTransient = (e: unknown): boolean => (e instanceof HttpError ? e.transient : e instanceof ArcGisError ? e.transient : true);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const abortError = (signal?: AbortSignal): unknown => signal?.reason ?? new DOMException('Cancelled', 'AbortError');

/** Runs at most `n` tasks at once. */
function limiter(n: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = (): void => {
    if (active >= n) return;
    const go = queue.shift();
    if (go) {
      active++;
      go();
    }
  };
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
}

/**
 * Query the NSW services for an envelope and return the version-1 context file (see contextLayers.ts). Throws only
 * when cancelled or when every layer failed; otherwise `failed` lists the layers that are missing from the file.
 * @param id  file id (default 'live')
 */
export async function fetchNswContextFile(bbox: BBox, opts: NswContextOptions & { id?: string } = {}): Promise<NswContextFileResult> {
  const { signal } = opts;
  const retries = opts.retries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const run = limiter(Math.max(1, opts.concurrency ?? 4));
  let done = 0;
  let total = CONTEXT_QUERY_IDS.length * 2; // one id query and (at least) one feature request per layer, refined below
  let shown = 0;
  const tick = (what: string): void => {
    done++;
    shown = Math.max(shown, Math.min(0.99, done / total));
    opts.onProgress?.(shown, `Roads, homes and place names: ${what} (${done}/${total})`);
  };

  /** One POST with back-off retries; ArcGIS reports many failures as HTTP 200 with an `error` body. */
  const post = async (id: ContextQueryId, form: Record<string, string>): Promise<ArcGisBody> => {
    const q = CONTEXT_QUERIES[id];
    const url = serviceUrl(q.service, `${q.path}/query`);
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError(signal);
      try {
        const body = await run(() => fetchJson<ArcGisBody>(url, { form, retries: 0, timeoutMs, ...(signal ? { signal } : {}) }));
        if (body.error) throw new ArcGisError(url, body.error.code ?? 500, body.error.message ?? 'error');
        return body;
      } catch (e) {
        if (isAbort(e, signal)) throw abortError(signal);
        if (attempt >= retries || !isTransient(e)) throw e;
        await sleep(retryDelayMs * 2 ** attempt, signal);
      }
    }
  };

  const queryLayer = async (id: ContextQueryId): Promise<EsriFeature[]> => {
    const q = CONTEXT_QUERIES[id];
    const ids = (await post(id, idsQueryForm(q, bbox))).objectIds ?? [];
    tick(CONTEXT_QUERY_LABELS[id]);
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += q.chunk) chunks.push(ids.slice(i, i + q.chunk));
    total += chunks.length - 1; // the estimate assumed one feature request
    const parts = await Promise.all(
      chunks.map(async (chunk) => {
        const body = await post(id, featuresQueryForm(q, chunk));
        tick(CONTEXT_QUERY_LABELS[id]);
        return body.features ?? [];
      }),
    );
    return parts.flat();
  };

  const features: ContextFeatures = {};
  const failed: ContextQueryId[] = [];
  let lastError: unknown;
  await Promise.all(
    CONTEXT_QUERY_IDS.map(async (id) => {
      try {
        features[id] = await queryLayer(id);
      } catch (e) {
        if (isAbort(e, signal)) throw abortError(signal);
        failed.push(id);
        lastError = e;
      }
    }),
  );
  if (signal?.aborted) throw abortError(signal);
  if (failed.length === CONTEXT_QUERY_IDS.length) {
    throw new Error(`NSW place services unavailable: ${lastError instanceof Error ? lastError.message : String(lastError)}`, { cause: lastError });
  }
  failed.sort((a, b) => CONTEXT_QUERY_IDS.indexOf(a) - CONTEXT_QUERY_IDS.indexOf(b));
  const fetched = new Date(opts.now ?? Date.now()).toISOString().slice(0, 10);
  const file = buildContextFile({ id: opts.id ?? 'live', bbox, fetched, features });
  // Do not credit a source whose layer is missing (places and suburbs are one source: it stays if either was read).
  const read = new Set(CONTEXT_QUERY_IDS.filter((q) => !failed.includes(q)).map(sourceOfQuery));
  file.sources = file.sources.filter((src) => read.has(src.id));
  opts.onProgress?.(1, 'Roads, homes and place names ready');
  return { file, failed };
}

/**
 * Roads, fire trails, homes, zones and place names around a scenario, from the live NSW services, in local metres
 * about `centre` (the scenario origin). Layers that could not be read are empty; throws only when cancelled or when the
 * services could not be reached at all. Use {@link fetchNswContextFile} to learn which layers failed or to cache the
 * origin-independent file.
 */
export async function fetchNswContext(o: { centre: LatLon; extent: number } & NswContextOptions): Promise<ContextLayers> {
  const { file } = await fetchNswContextFile(contextQueryBBox(o.centre, o.extent), o);
  return decodeContext(file, o.centre, 'live');
}
