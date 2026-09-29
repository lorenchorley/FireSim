/**
 * Test helpers of the places context (Node only; not exported from data/index.ts): a fake ArcGIS REST server that
 * replays the REAL responses recorded for a 2 km box in Blackheath (tests/fixtures/nsw-context, see record.sh), so the
 * live-query code runs without network access.
 *
 * The fake answers the two request kinds `nswContext.ts` makes, by POST form body:
 *   - `returnIdsOnly=true`  → the recorded `{ objectIdFieldName, objectIds }`,
 *   - `objectIds=1,2,3`     → the recorded features with those ids (any subset, any order),
 * and can multiply a layer (to exercise chunking), fail requests (HTTP status, ArcGIS error body, network error) and
 * delay responses (to exercise timeouts and cancellation).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTEXT_QUERIES, CONTEXT_QUERY_IDS, contextLayerUrl, type ContextQueryId, type EsriFeature } from './nswContextCore';

const DIR = fileURLToPath(new URL('../../tests/fixtures/nsw-context/', import.meta.url));

/** The envelope the fixtures were recorded for (west, south, east, north). */
export const BLACKHEATH_BBOX: [number, number, number, number] = [150.2738, -33.6437, 150.2954, -33.6257];
/** Centre of that envelope. */
export const BLACKHEATH = { lat: -33.6347, lon: 150.2846 };

/** Object-id field of each recorded layer (the recorder added it to `outFields`). */
const OID_FIELD: Record<ContextQueryId, string> = { roads: 'objectid', fireTrails: 'objectid', homes: 'rid', zones: 'OBJECTID', places: 'objectid', suburbs: 'rid' };

interface Recorded {
  idsBody: { objectIdFieldName?: string; objectIds: number[] };
  features: EsriFeature[];
}

const recorded = new Map<ContextQueryId, Recorded>();
function recording(id: ContextQueryId): Recorded {
  let r = recorded.get(id);
  if (!r) {
    const idsBody = JSON.parse(readFileSync(`${DIR}${id}.ids.json`, 'utf8')) as Recorded['idsBody'];
    const features = (JSON.parse(readFileSync(`${DIR}${id}.features.json`, 'utf8')) as { features: EsriFeature[] }).features;
    r = { idsBody: { ...idsBody, objectIds: idsBody.objectIds ?? [] }, features };
    recorded.set(id, r);
  }
  return r;
}

/** The recorded raw features of a layer (what `buildContextFile` gets). */
export const recordedFeatures = (id: ContextQueryId): EsriFeature[] => recording(id).features;

/** How a request fails. A number is an HTTP status; 'arcgis-500' is a 200 response with an ArcGIS `error` body; 'stall' never answers. */
export type Failure = number | 'arcgis-500' | 'network' | 'stall';

export interface FakeNswOptions {
  /** Serve a layer N times over (features get new object ids), to exercise chunking. Positions repeat, so homes dedupe. */
  multiply?: Partial<Record<ContextQueryId, number>>;
  /** The first requests to a layer fail in this order; later ones succeed. `'always'` keeps failing. */
  fail?: Partial<Record<ContextQueryId, Failure[] | { always: Failure }>>;
  /** Delay every response (ms); aborting the request's signal rejects like a real fetch. */
  latencyMs?: number;
  /** Delay the responses of one layer (ms) on top of `latencyMs` (the zoning server is much slower than the rest). */
  slow?: Partial<Record<ContextQueryId, number>>;
  /** Never answer (until aborted). */
  hang?: boolean;
}

export interface ArcGisCall {
  layer: ContextQueryId;
  kind: 'ids' | 'features';
  /** Object ids requested (features calls). */
  ids: number[];
  form: URLSearchParams;
  method: string;
  contentType: string | null;
  url: string;
}

export interface FakeNswServer {
  fetch: typeof fetch;
  calls: ArcGisCall[];
}

const LAYER_BY_URL = CONTEXT_QUERY_IDS.map((id) => ({ id, url: `${contextLayerUrl(CONTEXT_QUERIES[id])}/query` }));

/** A `fetch` that answers the NSW ArcGIS queries from the recorded fixtures; any other URL fails like a network error. */
export function fakeNswServer(o: FakeNswOptions = {}): FakeNswServer {
  const calls: ArcGisCall[] = [];
  const failures = new Map<ContextQueryId, Failure[] | { always: Failure }>(Object.entries(o.fail ?? {}) as [ContextQueryId, Failure[] | { always: Failure }][]);
  const served = (id: ContextQueryId): { objectIds: number[]; features: Map<number, EsriFeature> } => {
    const r = recording(id);
    const times = Math.max(1, o.multiply?.[id] ?? 1);
    const oid = OID_FIELD[id];
    const byOid = new Map(r.features.map((f) => [f.attributes[oid] as number, f]));
    const objectIds: number[] = [];
    const features = new Map<number, EsriFeature>();
    for (let k = 0; k < times; k++) {
      for (const id0 of r.idsBody.objectIds) {
        const f = byOid.get(id0);
        if (!f) continue; // an id the recording lists but returned no feature for
        const nid = id0 + k * 100_000_000;
        objectIds.push(nid);
        features.set(nid, k === 0 ? f : { ...f, attributes: { ...f.attributes, [oid]: nid } });
      }
    }
    return { objectIds, features };
  };
  const cache = new Map<ContextQueryId, ReturnType<typeof served>>();

  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const layer = LAYER_BY_URL.find((l) => url === l.url)?.id;
    if (!layer) throw new TypeError(`fetch failed (no route): ${url}`);
    const bodyText = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : '';
    const form = new URLSearchParams(bodyText);
    const headers = new Headers(init?.headers);
    const ids = (form.get('objectIds') ?? '').split(',').filter(Boolean).map(Number);
    const call: ArcGisCall = { layer, kind: form.get('returnIdsOnly') === 'true' ? 'ids' : 'features', ids, form, method: init?.method ?? 'GET', contentType: headers.get('content-type'), url };
    calls.push(call);

    const signal = init?.signal ?? undefined;
    await new Promise<void>((resolve, reject) => {
      const stop = new DOMException('aborted', 'AbortError');
      if (signal?.aborted) return reject(stop);
      const t = o.hang ? undefined : (o.latencyMs ?? 0) + (o.slow?.[layer] ?? 0) > 0 ? setTimeout(resolve, (o.latencyMs ?? 0) + (o.slow?.[layer] ?? 0)) : (resolve(), undefined);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(stop);
      });
    });

    const plan = failures.get(layer);
    const fail = plan === undefined ? undefined : Array.isArray(plan) ? plan.shift() : plan.always;
    if (fail === 'network') throw new TypeError('fetch failed');
    if (fail === 'stall') await new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    if (fail === 'arcgis-500') return json({ error: { code: 500, message: 'Error performing query operation', details: [] } });
    if (typeof fail === 'number') return new Response(JSON.stringify({ error: { code: fail, message: 'test failure' } }), { status: fail });

    let s = cache.get(layer);
    if (!s) cache.set(layer, (s = served(layer)));
    if (call.kind === 'ids') return json(s.objectIds.length ? { objectIdFieldName: OID_FIELD[layer], objectIds: s.objectIds } : { objectIdFieldName: OID_FIELD[layer], objectIds: null });
    return json({ features: ids.map((id) => s!.features.get(id)).filter((x): x is EsriFeature => !!x) });
  }) as typeof fetch;
  return { fetch: f, calls };
}

const json = (v: unknown): Response => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
