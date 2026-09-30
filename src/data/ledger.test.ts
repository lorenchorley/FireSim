/**
 * The request ledger (data/ledger.ts) and its wiring into the HTTP, cache, asset and area-pack layers:
 * bytes on the wire, stored-copy hits with their age, bundled file sizes, retries, no secrets in what is kept, and a
 * ledger that can never throw or change what a request returns.
 */
import { readFileSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAsset, loadAssetJson } from './assets';
import { cachedFetch, cachedFetchBinary, cachedFetchJson, createMemoryKV, loadAreaPackItem, saveAreaPack, storedBytes } from './cache';
import { fetchBinary, fetchJson, fetchText, httpRequest, resetHttpConfig, setHttpConfig } from './http';
import { DatasetLedger, endpointOf, pathPattern, traceRead } from './ledger';

afterEach(() => resetHttpConfig());

function scriptedFetch(steps: (Response | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    if (step instanceof Error) throw step;
    return step.clone();
  }) as typeof fetch;
  return { fn, calls };
}
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('endpointOf: host and path only, no secrets', () => {
  it('drops the query, fragment and credentials', () => {
    expect(endpointOf('https://user:pw@api.example.org/v1/forecast?apikey=SECRET&latitude=1#x')).toEqual({ host: 'api.example.org', path: '/v1/forecast' });
    expect(endpointOf('HTTPS://Portal.Spatial.NSW.gov.au/server/rest/services/x/FeatureServer/5/query?token=abc')).toEqual({ host: 'portal.spatial.nsw.gov.au', path: '/server/rest/services/x/FeatureServer/5/query' });
  });
  it('redacts path segments that look like tokens', () => {
    const t = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8';
    expect(endpointOf(`https://x.org/v1/${t}/data`).path).toBe('/v1/…/data');
    expect(endpointOf('https://x.org/elevation-tiles-prod/terrarium/13/7515/4911.png').path).toBe('/elevation-tiles-prod/terrarium/13/7515/4911.png');
  });
  it('handles relative and broken input without throwing', () => {
    expect(endpointOf('/proxy/chm/a.tif?x=1')).toEqual({ host: '', path: '/proxy/chm/a.tif' });
    expect(() => endpointOf(undefined as unknown as string)).not.toThrow();
    expect(endpointOf('')).toEqual({ host: '', path: '/' });
  });
  it('groups tiles into one endpoint pattern', () => {
    expect(pathPattern('/terrarium/13/7515/4911.png')).toBe('/terrarium/13/{n}/{n}.png');
    expect(pathPattern('/v1/forecast')).toBe('/v1/forecast');
  });
});

describe('DatasetLedger', () => {
  it('sums bytes by source and keeps exact totals beyond the entry cap', () => {
    const l = new DatasetLedger({ maxEntries: 3 });
    for (let i = 0; i < 10; i++) l.record({ tag: 'terrain', host: 's3', path: `/terrarium/13/${7000 + i}/4911.png`, status: 200, bytes: 1000, durationMs: 5, at: 1000 + i });
    l.record({ tag: 'terrain', source: 'cache', host: 's3', path: '/terrarium/13/7515/4911.png', bytes: 500, cachedAt: 42 });
    l.record({ tag: 'canopy-height', source: 'bundled', host: 'bundled', path: '/demo/x/canopy.png', bytes: 300 });
    expect(l.entries()).toHaveLength(3);
    const t = l.totals('terrain');
    expect(t).toMatchObject({ requests: 11, bytes: 10_500, networkBytes: 10_000, cacheBytes: 500, oldestCachedAt: 42, failures: 0 });
    expect(t.bySource).toMatchObject({ network: 10, cache: 1 });
    expect(l.totals('canopy-height')).toMatchObject({ requests: 1, bundledBytes: 300, bytes: 300 });
    expect(l.totals()).toMatchObject({ requests: 12, bytes: 10_800 });
    expect(l.totals('nothing')).toMatchObject({ requests: 0, bytes: 0 });
    expect(l.tags()).toEqual(['terrain', 'canopy-height']);
    expect(l.endpoints('terrain')).toEqual([{ host: 's3', path: '/terrarium/13/{n}/{n}.png', requests: 11, bytes: 10_500 }]);
  });

  it('failed requests count as failures and deliver no bytes (a rejected network response still crossed the network)', () => {
    const l = new DatasetLedger();
    l.record({ tag: 'weather', host: 'api.open-meteo.com', path: '/v1/forecast', status: 429, bytes: 86, retries: 1 });
    l.record({ tag: 'weather', host: 'api.open-meteo.com', path: '/v1/forecast', status: 0, error: 'timeout' });
    const t = l.totals('weather');
    expect(t).toMatchObject({ requests: 2, failures: 2, bytes: 0, networkBytes: 86, retries: 1 });
  });

  it('never throws, whatever it is given', () => {
    const l = new DatasetLedger({ clock: () => { throw new Error('clock'); } });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const bad = [undefined, null, {}, { tag: undefined }, { tag: 'x', bytes: NaN, durationMs: -5, status: Infinity, url: 12 }, { tag: 'x', note: circular }, { tag: 'x', at: NaN, host: 5, path: {} }] as unknown[];
    for (const b of bad) expect(() => l.record(b as never)).not.toThrow();
    expect(() => l.totals()).not.toThrow();
    expect(() => l.entries()).not.toThrow();
    expect(() => l.endpoints('x')).not.toThrow();
    expect(() => traceRead(undefined, 'bundled', {}, 5)).not.toThrow();
    expect(() => traceRead({ tag: 'x', ledger: undefined }, 'bundled', {}, 5)).not.toThrow();
    for (const e of l.entries()) {
      expect(Number.isFinite(e.bytes) && Number.isFinite(e.durationMs) && Number.isFinite(e.status)).toBe(true);
    }
  });

  it('keeps no query string, key or token anywhere in what it stores', () => {
    const l = new DatasetLedger();
    l.record({ tag: 't', url: 'https://api.x.org/v1/forecast?apikey=TOPSECRET&token=SECRET2&latitude=-33.7#frag' });
    l.record({ tag: 't', url: 'https://user:hunter2@api.x.org/data?access_token=SECRET3' });
    expect(JSON.stringify(l.entries())).not.toMatch(/SECRET|hunter2|apikey|latitude|access_token/i);
  });

  it('costs next to nothing: 20 000 records (100 times a large build) in well under a second, 2 000 in under 100 ms', () => {
    const l = new DatasetLedger();
    const t0 = performance.now();
    let t2k = 0;
    for (let i = 0; i < 20_000; i++) {
      if (i === 2000) t2k = performance.now() - t0; l.record({ tag: i % 3 ? 'terrain' : 'weather', url: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/${15000 + (i % 97)}/${9800 + (i % 89)}.png`, status: 200, bytes: 40_000, durationMs: 12 });
    }
    const ms = performance.now() - t0;
    expect(t2k).toBeLessThan(100);
    expect(ms).toBeLessThan(1000);
    expect(l.totals().requests).toBe(20_000);
    expect(l.endpoints('terrain')).toHaveLength(1); // tiles fold into one pattern
    expect(l.entries().length).toBe(4000); // bounded
  });
});

describe('HTTP layer wiring', () => {
  it('records bytes on the wire (Content-Length), the decoded length, status and time for a JSON GET', async () => {
    const body = { hello: 'wörld', n: [1, 2, 3] };
    const text = JSON.stringify(body);
    const { fn } = scriptedFetch([json(body, 200, { 'content-length': '123' })]);
    setHttpConfig({ fetch: fn, platform: 'node' });
    const l = new DatasetLedger();
    let info: unknown;
    const r = await fetchJson<typeof body>('https://api.open-meteo.com/v1/forecast?latitude=-33.7&key=SECRET', { tag: 'weather', ledger: l, note: 'model best_match', onResponse: (i) => (info = i) });
    expect(r).toEqual(body);
    const [e] = l.entries();
    expect(e).toMatchObject({ tag: 'weather', host: 'api.open-meteo.com', path: '/v1/forecast', method: 'GET', status: 200, ok: true, source: 'network', bytes: 123, bodyBytes: new TextEncoder().encode(text).length, retries: 0, note: 'model best_match' });
    expect(e!.durationMs).toBeGreaterThanOrEqual(0);
    expect(info).toMatchObject({ status: 200, bytes: 123, bodyBytes: e!.bodyBytes });
    expect(JSON.stringify(l.entries())).not.toContain('SECRET');
  });

  it('falls back to the body length when the response hides Content-Length', async () => {
    const { fn } = scriptedFetch([new Response(new Uint8Array(4096), { status: 200 })]);
    setHttpConfig({ fetch: fn, platform: 'node' });
    const l = new DatasetLedger();
    await fetchBinary('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/7515/4911.png', { tag: 'terrain', ledger: l });
    expect(l.totals('terrain')).toMatchObject({ requests: 1, bytes: 4096, bodyBytes: 4096, networkBytes: 4096 });
  });

  it('counts retries and records the final failure', async () => {
    const { fn, calls } = scriptedFetch([json({ e: 1 }, 503), json({ ok: true }, 200)]);
    setHttpConfig({ fetch: fn, platform: 'node', retryDelayMs: 1 });
    const l = new DatasetLedger();
    await fetchText('https://x.org/a', { tag: 't', ledger: l });
    expect(calls).toHaveLength(2);
    // Every HTTP request made is on the ledger: the retried 503 and the successful retry (which counts one retry).
    expect(l.entries()).toHaveLength(2);
    expect(l.entries()[0]).toMatchObject({ status: 503, retries: 0, ok: false, error: 'http' });
    expect(l.entries()[1]).toMatchObject({ status: 200, retries: 1, ok: true });
    expect(l.totals('t')).toMatchObject({ requests: 2, failures: 1, retries: 1 });

    const l2 = new DatasetLedger();
    const bad = scriptedFetch([json({ e: 1 }, 404)]);
    setHttpConfig({ fetch: bad.fn, platform: 'node', retryDelayMs: 1 });
    await expect(fetchJson('https://x.org/missing', { tag: 't', ledger: l2 })).rejects.toThrow();
    expect(l2.entries()[0]).toMatchObject({ status: 404, ok: false, error: 'http', retries: 0 });
    expect(l2.totals('t')).toMatchObject({ failures: 1, bytes: 0 });
  });

  it('records a network failure with status 0', async () => {
    const { fn } = scriptedFetch([new TypeError('fetch failed')]);
    setHttpConfig({ fetch: fn, platform: 'node', retryDelayMs: 1 });
    const l = new DatasetLedger();
    await expect(fetchJson('https://x.org/a', { tag: 'weather', ledger: l, retries: 0 })).rejects.toThrow();
    expect(l.entries()[0]).toMatchObject({ status: 0, ok: false, error: 'network' });
  });

  it('records a form POST and a raw range request', async () => {
    const { fn } = scriptedFetch([json({ objectIds: [1, 2] }), new Response(new Uint8Array(100), { status: 206, headers: { 'content-length': '100' } })]);
    setHttpConfig({ fetch: fn, platform: 'node' });
    const l = new DatasetLedger();
    await fetchJson('https://portal.spatial.nsw.gov.au/server/rest/services/a/FeatureServer/5/query', { form: { where: '1=1', token: 'SECRET' }, retries: 0, tag: 'roads', ledger: l });
    const r = await httpRequest('https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/chm/0123.tif', { headers: { range: 'bytes=0-99' }, route: false, tag: 'canopy-height', ledger: l });
    expect(r.status).toBe(206);
    expect(l.entries()[0]).toMatchObject({ tag: 'roads', method: 'POST', host: 'portal.spatial.nsw.gov.au' });
    expect(l.entries()[1]).toMatchObject({ tag: 'canopy-height', status: 206, ok: true, bytes: 100 });
    expect(JSON.stringify(l.entries())).not.toContain('SECRET');
  });

  it('reads the size on the native path, from Content-Length or the body', async () => {
    const l = new DatasetLedger();
    setHttpConfig({
      platform: 'native',
      nativeRequest: async (o) => ({ status: 200, url: o.url, headers: { 'Content-Length': '77' }, data: o.responseType === 'json' ? { a: 1 } : 'x' }),
    });
    await fetchJson('https://api.open-meteo.com/v1/forecast', { tag: 'weather', ledger: l });
    expect(l.entries()[0]).toMatchObject({ bytes: 77, bodyBytes: 7 }); // '{"a":1}'
    setHttpConfig({ nativeRequest: async (o) => ({ status: 200, url: o.url, headers: {}, data: 'AAAA' }) }); // base64 of 3 bytes
    const b = await fetchBinary('https://x.org/t.png', { tag: 'terrain', ledger: l });
    expect(b.byteLength).toBe(3);
    expect(l.entries()[1]).toMatchObject({ bytes: 3, bodyBytes: 3 });
  });

  it('a proxied URL is recorded under the upstream host', async () => {
    const { fn } = scriptedFetch([new Response(new Uint8Array(10), { status: 200 })]);
    setHttpConfig({ fetch: fn, platform: 'browser' });
    const l = new DatasetLedger();
    await fetchBinary('/proxy/chm/forests/v1/x/0123.tif', { tag: 'canopy-height', ledger: l, route: false });
    expect(l.entries()[0]).toMatchObject({ host: 'dataforgood-fb-data.s3.amazonaws.com', path: '/forests/v1/x/0123.tif' });
  });

  it('changes nothing without a ledger, and a broken ledger or callback cannot fail a request', async () => {
    const { fn } = scriptedFetch([json({ a: 1 })]);
    setHttpConfig({ fetch: fn, platform: 'node' });
    expect(await fetchJson('https://x.org/a')).toEqual({ a: 1 });
    const ledger = new DatasetLedger();
    ledger.record = () => {
      throw new Error('boom');
    };
    expect(await fetchJson('https://x.org/a', { tag: 't', ledger, onResponse: () => { throw new Error('cb'); } })).toEqual({ a: 1 });
  });
});

describe('cache, asset and area-pack wiring', () => {
  it('records the download, then the stored-copy hit with its size and the time it was stored', async () => {
    const { fn } = scriptedFetch([new Response(new Uint8Array(2048), { status: 200 })]);
    setHttpConfig({ fetch: fn, platform: 'node' });
    const kv = createMemoryKV();
    const l = new DatasetLedger();
    const a = await cachedFetch('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/1/1.png', 'terrarium/13/1/1', (u, o) => fetchBinary(u, o), { kv, tag: 'terrain', ledger: l }, 'cache-first');
    expect(a.from).toBe('network');
    const b = await cachedFetch('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/1/1.png', 'terrarium/13/1/1', (u, o) => fetchBinary(u, o), { kv, tag: 'terrain', ledger: l }, 'cache-first');
    expect(b.from).toBe('cache');
    const es = l.entries('terrain');
    expect(es.map((e) => e.source)).toEqual(['network', 'cache']);
    expect(es[1]).toMatchObject({ bytes: 2048, cachedAt: a.fetchedAt, host: 's3.amazonaws.com' });
    const rec = await kv.get<{ n?: number }>('terrarium/13/1/1');
    expect(rec?.n).toBe(2048);
    const sizes = await kv.sizes!('terrarium/');
    expect(sizes).toEqual([{ key: 'terrarium/13/1/1', bytes: storedBytes(await kv.get('terrarium/13/1/1')), t: a.fetchedAt }]);
    expect(sizes[0]!.bytes).toBeGreaterThanOrEqual(2048);
  });

  it('records a stale copy when the network fails, and JSON sizes come from the body text', async () => {
    const body = { rows: Array.from({ length: 50 }, (_, i) => i) };
    const okFetch = scriptedFetch([json(body)]);
    setHttpConfig({ fetch: okFetch.fn, platform: 'node', retryDelayMs: 1 });
    const kv = createMemoryKV();
    const l = new DatasetLedger();
    await cachedFetchJson('https://api.open-meteo.com/v1/forecast?a=1', 'openmeteo/x', { kv, tag: 'weather', ledger: l });
    const text = JSON.stringify(body);
    expect((await kv.get<{ n: number }>('openmeteo/x'))!.n).toBe(new TextEncoder().encode(text).length);
    setHttpConfig({ fetch: scriptedFetch([new TypeError('offline')]).fn, platform: 'node', retryDelayMs: 1 });
    const r = await cachedFetchJson('https://api.open-meteo.com/v1/forecast?a=1', 'openmeteo/x', { kv, tag: 'weather', ledger: l, retries: 0 });
    expect(r).toEqual(body);
    const last = l.entries('weather').at(-1)!;
    expect(last).toMatchObject({ source: 'stale', bytes: text.length });
    expect(cachedFetchBinary).toBeTypeOf('function');
  });

  it('records a bundled file with its real byte length, and nothing without a trace', async () => {
    const l = new DatasetLedger();
    const path = 'demo/katoomba/manifest.json';
    const bytes = await loadAsset(path, undefined, { tag: 'terrain', ledger: l });
    const size = statSync(new URL(`../../public/${path}`, import.meta.url)).size;
    expect(bytes!.byteLength).toBe(size);
    expect(l.entries()[0]).toMatchObject({ source: 'bundled', host: 'bundled', path: '/demo/katoomba/manifest.json', bytes: size });
    await loadAssetJson('demo/katoomba/manifest.json');
    expect(l.entries()).toHaveLength(1);
    expect(await loadAsset('demo/nowhere/none.json', undefined, { tag: 't', ledger: l })).toBeNull();
    expect(l.entries()).toHaveLength(1); // a missing file is not a read
    expect(readFileSync(new URL(`../../public/${path}`, import.meta.url)).length).toBe(size);
  });

  it('records an area-pack read with the stored size, and packs keep per-item sizes', async () => {
    const kv = createMemoryKV();
    const meta = await saveAreaPack({ id: 'p1', name: 'Home', centre: { lat: -33.7, lon: 150.3 }, extent: 6000, createdAt: 1, items: { dem10: new Float32Array(1000).buffer, note: { a: 'hello' } } }, kv);
    expect(meta.itemBytes!['dem10']).toBe(4000);
    expect(meta.bytes).toBe(Object.values(meta.itemBytes!).reduce((a, b) => a + b, 0));
    const l = new DatasetLedger();
    const v = await loadAreaPackItem<ArrayBuffer>('p1', 'dem10', kv, { tag: 'terrain', ledger: l });
    expect(v!.byteLength).toBe(4000);
    expect(l.entries()[0]).toMatchObject({ source: 'pack', host: 'area-pack', bytes: 4000, tag: 'terrain' });
  });
});

describe('audit regressions: bytes on the wire, every attempt, exact single-file paths', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a compressed answer without Content-Length is counted at its decoded size and flagged unmeasured', async () => {
    const body = JSON.stringify({ features: 'x'.repeat(5000) });
    const { fn } = scriptedFetch([new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } })]);
    setHttpConfig({ fetch: fn, platform: 'node' });
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([]);
    const l = new DatasetLedger();
    await fetchJson('https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer/3/query?f=geojson', { tag: 'vegetation-svtm', ledger: l });
    expect(l.entries()[0]).toMatchObject({ bytes: body.length, bodyBytes: body.length, wireUnknown: true });
    expect(l.totals('vegetation-svtm')).toMatchObject({ networkBytes: body.length, networkBodyBytes: body.length, networkUnmeasuredBytes: body.length });
  });

  it('takes the compressed size from resource timing when the platform reports it', async () => {
    const body = JSON.stringify({ features: 'y'.repeat(8000) });
    const { fn } = scriptedFetch([new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } })]);
    setHttpConfig({ fetch: fn, platform: 'node' });
    const url = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/NPWS_Fire_History/MapServer/0/query?f=geojson';
    // An older entry of the same URL (an earlier request) must not be taken: only one that started with this request
    // and decoded to this body.
    const t0 = performance.now();
    const entries = [
      { encodedBodySize: 99, decodedBodySize: body.length, startTime: t0 - 5000 },
      { encodedBodySize: 77, decodedBodySize: 12, startTime: t0 + 1 },
      { encodedBodySize: 1234, decodedBodySize: body.length, startTime: t0 + 1 },
    ] as PerformanceResourceTiming[];
    const spy = vi.spyOn(performance, 'getEntriesByName').mockImplementation((name: string) => (name === url ? entries : []));
    const l = new DatasetLedger();
    await fetchJson(url, { tag: 'fire-history', ledger: l });
    expect(spy).toHaveBeenCalled();
    const e = l.entries()[0]!;
    expect(e).toMatchObject({ bytes: 1234, bodyBytes: body.length });
    expect(e.wireUnknown).toBeUndefined();
    expect(l.totals('fire-history')).toMatchObject({ networkBytes: 1234, networkBodyBytes: body.length, networkUnmeasuredBytes: 0 });
    // The same URL again: the entry already matched is not reused (no new entry: unmeasured).
    await fetchJson(url, { tag: 'fire-history', ledger: l });
    expect(l.entries()[1]).toMatchObject({ bytes: body.length, wireUnknown: true });
  });

  it('Content-Length wins and is never flagged', async () => {
    const { fn } = scriptedFetch([new Response(new Uint8Array(4096), { status: 200, headers: { 'content-length': '4096' } })]);
    setHttpConfig({ fetch: fn, platform: 'node' });
    const l = new DatasetLedger();
    await fetchBinary('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/1/2.png', { tag: 'terrain', ledger: l });
    expect(l.entries()[0]!.wireUnknown).toBeUndefined();
    expect(l.totals('terrain')).toMatchObject({ networkBytes: 4096, networkUnmeasuredBytes: 0 });
  });

  it('three HTTP 429 answers then success are four requests (each retry is a request)', async () => {
    const tooMany = new Response('{"reason":"Too many"}', { status: 429, headers: { 'content-length': '21' } });
    const { fn, calls } = scriptedFetch([tooMany, tooMany, json({ ok: true })]);
    setHttpConfig({ fetch: fn, platform: 'node', retryDelayMs: 1 });
    const l = new DatasetLedger();
    await expect(fetchJson('https://archive-api.open-meteo.com/v1/archive?a=1', { tag: 'drought-history', ledger: l, retries: 1 })).rejects.toThrow();
    await fetchJson('https://archive-api.open-meteo.com/v1/archive?a=1', { tag: 'drought-history', ledger: l, retries: 1 });
    expect(calls).toHaveLength(3);
    expect(l.totals('drought-history')).toMatchObject({ requests: 3, failures: 2, networkBytes: 21 + 21 + 11 });
  });

  it('a single file keeps its real path; many tiles collapse to one pattern', () => {
    const l = new DatasetLedger();
    l.record({ tag: 'weather', host: 'bundled', path: '/replays/grose-2019-12-19.json', source: 'bundled', bytes: 10 });
    expect(l.endpoints('weather')).toEqual([{ host: 'bundled', path: '/replays/grose-2019-12-19.json', requests: 1, bytes: 10 }]);
    l.record({ tag: 'terrain', host: 's3', path: '/terrarium/14/15042/9821.png', status: 200, bytes: 5 });
    expect(l.endpoints('terrain')[0]!.path).toBe('/terrarium/14/15042/9821.png');
    l.record({ tag: 'terrain', host: 's3', path: '/terrarium/14/15042/9822.png', status: 200, bytes: 5 });
    expect(l.endpoints('terrain')).toEqual([{ host: 's3', path: '/terrarium/14/{n}/{n}.png', requests: 2, bytes: 10 }]);
  });
});
