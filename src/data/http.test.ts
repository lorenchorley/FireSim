import { afterEach, describe, expect, it } from 'vitest';
import type { HttpOptions, HttpResponse } from '@capacitor/core';
import {
  base64ToBytes,
  detectPlatform,
  fetchBinary,
  fetchJson,
  fetchText,
  HttpError,
  httpRequest,
  resetHttpConfig,
  routeUrl,
  serviceUrl,
  setHttpConfig,
  toArrayBuffer,
} from './http';

afterEach(() => resetHttpConfig());

/** A fetch stub that replays a list of responses (or errors) and records calls. */
function scriptedFetch(steps: (Response | Error | ((url: string, init?: RequestInit) => Promise<Response>))[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step(url, init);
    return step.clone();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

/** fetch that never resolves until its signal aborts (like a stalled connection). */
const hangingFetch = (async (_: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  })) as typeof fetch;

describe('platform detection and URL routing', () => {
  it('detects Node under Vitest', () => {
    expect(detectPlatform()).toBe('node');
  });

  it('uses direct absolute URLs in Node', () => {
    expect(serviceUrl('openmeteo', '/v1/forecast?latitude=-33.7')).toBe('https://api.open-meteo.com/v1/forecast?latitude=-33.7');
    expect(serviceUrl('openmeteo-archive', '/v1/archive')).toBe('https://archive-api.open-meteo.com/v1/archive');
    expect(serviceUrl('nswenv', '/arcgis/rest/services')).toBe('https://mapprod3.environment.nsw.gov.au/arcgis/rest/services');
    expect(serviceUrl('rfs', 'feeds/majorIncidents.json')).toBe('https://www.rfs.nsw.gov.au/feeds/majorIncidents.json');
    expect(serviceUrl('terrarium', '/terrarium/13/7515/4911.png')).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/7515/4911.png');
    expect(serviceUrl('chm', '/forests/x.tif')).toBe('https://dataforgood-fb-data.s3.amazonaws.com/forests/x.tif');
    expect(serviceUrl('generic', 'https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
  });

  it('routes non-CORS services through the dev proxy in the browser, CORS services direct', () => {
    setHttpConfig({ platform: 'browser' });
    // NSW Environment and RFS send ACAO * (doc 08b): direct in the browser, so an installed PWA works without a proxy.
    expect(serviceUrl('nswenv', '/arcgis/x?f=json')).toBe('https://mapprod3.environment.nsw.gov.au/arcgis/x?f=json');
    expect(serviceUrl('rfs', '/feeds/majorIncidents.json')).toBe('https://www.rfs.nsw.gov.au/feeds/majorIncidents.json');
    expect(serviceUrl('chm', '/forests/a.tif')).toBe('/proxy/chm/forests/a.tif');
    expect(serviceUrl('openmeteo', '/v1/forecast')).toBe('https://api.open-meteo.com/v1/forecast');
    expect(serviceUrl('openmeteo-archive', '/v1/archive')).toBe('https://archive-api.open-meteo.com/v1/archive');
    expect(serviceUrl('terrarium', '/terrarium/1/2/3.png')).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/1/2/3.png');
  });

  it('honours proxyBase (trailing slash stripped) and forceDirect', () => {
    setHttpConfig({ platform: 'browser', proxyBase: 'https://proxy.example.org/' });
    expect(serviceUrl('chm', '/forests/a.tif')).toBe('https://proxy.example.org/proxy/chm/forests/a.tif');
    setHttpConfig({ forceDirect: true });
    expect(serviceUrl('rfs', '/feeds/a.json')).toBe('https://www.rfs.nsw.gov.au/feeds/a.json');
  });

  it('uses direct URLs on native (CapacitorHttp is not subject to CORS)', () => {
    setHttpConfig({ platform: 'native' });
    expect(serviceUrl('nswenv', '/a')).toBe('https://mapprod3.environment.nsw.gov.au/a');
    expect(serviceUrl('chm', '/a')).toBe('https://dataforgood-fb-data.s3.amazonaws.com/a');
  });

  it('routeUrl rewrites absolute URLs of known services only', () => {
    setHttpConfig({ platform: 'browser' });
    expect(routeUrl('https://dataforgood-fb-data.s3.amazonaws.com/forests/a.tif')).toBe('/proxy/chm/forests/a.tif');
    expect(routeUrl('https://www.rfs.nsw.gov.au/feeds/majorIncidents.json')).toBe('https://www.rfs.nsw.gov.au/feeds/majorIncidents.json');
    expect(routeUrl('https://api.open-meteo.com/v1/forecast?x=1')).toBe('https://api.open-meteo.com/v1/forecast?x=1');
    expect(routeUrl('https://example.org/x')).toBe('https://example.org/x');
    expect(routeUrl('/proxy/rfs/x')).toBe('/proxy/rfs/x');
    // A host that merely starts with a service base is not that service.
    expect(routeUrl('https://www.rfs.nsw.gov.au.evil.example/x')).toBe('https://www.rfs.nsw.gov.au.evil.example/x');
  });
});

describe('fetch transport', () => {
  it('fetches JSON, text and binary and passes headers', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const { fn, calls } = scriptedFetch([json({ a: 1 }), new Response('hello'), new Response(bytes)]);
    setHttpConfig({ fetch: fn });
    expect(await fetchJson<{ a: number }>('https://example.org/a.json', { headers: { 'x-test': '1' } })).toEqual({ a: 1 });
    expect(await fetchText('https://example.org/a.txt')).toBe('hello');
    const buf = await fetchBinary('https://example.org/a.bin');
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(buf)]).toEqual([1, 2, 3, 250]);
    expect(new Headers(calls[0]!.init!.headers).get('x-test')).toBe('1');
  });

  it('retries once on a transient 503 and succeeds', async () => {
    const { fn, calls } = scriptedFetch([new Response('busy', { status: 503 }), json({ ok: true })]);
    setHttpConfig({ fetch: fn, retryDelayMs: 1 });
    expect(await fetchJson('https://example.org/x')).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('gives up after one retry with a typed HttpError', async () => {
    const { fn, calls } = scriptedFetch([new Response('busy', { status: 503 })]);
    setHttpConfig({ fetch: fn, retryDelayMs: 1 });
    const err = (await fetchJson('https://example.org/x').catch((e) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.kind).toBe('http');
    expect(err.status).toBe(503);
    expect(err.transient).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('does not retry client errors (404)', async () => {
    const { fn, calls } = scriptedFetch([new Response('nope', { status: 404, statusText: 'Not Found' })]);
    setHttpConfig({ fetch: fn, retryDelayMs: 1 });
    const err = (await fetchBinary('https://example.org/x').catch((e) => e)) as HttpError;
    expect(err.kind).toBe('http');
    expect(err.status).toBe(404);
    expect(err.transient).toBe(false);
    expect(err.message).toContain('404');
    expect(calls).toHaveLength(1);
  });

  it('classifies network failures, retries them, and marks them offline', async () => {
    const { fn, calls } = scriptedFetch([new TypeError('fetch failed')]);
    setHttpConfig({ fetch: fn, retryDelayMs: 1 });
    const err = (await fetchJson('https://example.org/x').catch((e) => e)) as HttpError;
    expect(err.kind).toBe('network');
    expect(err.offline).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('times out a stalled request', async () => {
    setHttpConfig({ fetch: hangingFetch, retryDelayMs: 1 });
    const t0 = Date.now();
    const err = (await fetchJson('https://example.org/slow', { timeoutMs: 30, retries: 0 }).catch((e) => e)) as HttpError;
    expect(err.kind).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('treats timeoutMs Infinity / 0 as "no timeout" instead of an immediate one', async () => {
    // Regression: setTimeout(fn, Infinity) fires at once, so disabling the timeout timed every request out.
    const slow = (async () => {
      await new Promise((r) => setTimeout(r, 30));
      return json({ ok: true });
    }) as typeof fetch;
    setHttpConfig({ fetch: slow, retryDelayMs: 1 });
    expect(await fetchJson('https://example.org/a', { timeoutMs: Infinity, retries: 0 })).toEqual({ ok: true });
    expect(await fetchJson('https://example.org/b', { timeoutMs: 0, retries: 0 })).toEqual({ ok: true });
  });

  it('fetchBinary keeps the binary default timeout when timeoutMs is passed as undefined', async () => {
    setHttpConfig({ fetch: hangingFetch, retryDelayMs: 1, timeoutMs: 5, binaryTimeoutMs: 60 });
    const t0 = Date.now();
    const err = (await fetchBinary('https://example.org/t.png', { timeoutMs: undefined, retries: 0 }).catch((e) => e)) as HttpError;
    expect(err.kind).toBe('timeout');
    expect(err.message).toContain('60 ms');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
  });

  it('stops immediately when the caller aborts, without retrying', async () => {
    let n = 0;
    setHttpConfig({ fetch: ((u: RequestInfo | URL, i?: RequestInit) => (n++, hangingFetch(u, i))) as typeof fetch, retryDelayMs: 1 });
    const ctrl = new AbortController();
    const p = fetchJson('https://example.org/slow', { signal: ctrl.signal, timeoutMs: 10_000 });
    setTimeout(() => ctrl.abort(), 10);
    const err = (await p.catch((e) => e)) as HttpError;
    expect(err.kind).toBe('aborted');
    expect(n).toBe(1);
    // Already-aborted signals fail before any request.
    const err2 = (await fetchJson('https://example.org/x', { signal: ctrl.signal }).catch((e) => e)) as HttpError;
    expect(err2.kind).toBe('aborted');
    expect(n).toBe(1);
  });

  it('reports invalid JSON as a parse error (not retried)', async () => {
    const { fn, calls } = scriptedFetch([new Response('<html>oops</html>')]);
    setHttpConfig({ fetch: fn, retryDelayMs: 1 });
    const err = (await fetchJson('https://example.org/x').catch((e) => e)) as HttpError;
    expect(err.kind).toBe('parse');
    expect(calls).toHaveLength(1);
  });

  it('auto-routes absolute URLs of non-CORS services through the proxy in the browser', async () => {
    const { fn, calls } = scriptedFetch([json([])]);
    setHttpConfig({ fetch: fn, platform: 'browser' });
    await fetchJson('https://dataforgood-fb-data.s3.amazonaws.com/forests/tiles.json');
    expect(calls[0]!.url).toBe('/proxy/chm/forests/tiles.json');
    await fetchJson('https://dataforgood-fb-data.s3.amazonaws.com/forests/tiles.json', { route: false });
    expect(calls[1]!.url).toBe('https://dataforgood-fb-data.s3.amazonaws.com/forests/tiles.json');
  });

  it('httpRequest returns any status with lower-cased headers and no retry', async () => {
    const { fn, calls } = scriptedFetch([
      new Response(new Uint8Array([9, 8]), { status: 206, headers: { 'Content-Range': 'bytes 0-1/100', 'Content-Type': 'binary/octet-stream' } }),
      new Response('x', { status: 500 }),
    ]);
    setHttpConfig({ fetch: fn });
    const r = await httpRequest('https://example.org/cog.tif', { headers: { Range: 'bytes=0-1' } });
    expect(r.status).toBe(206);
    expect(r.headers['content-range']).toBe('bytes 0-1/100');
    expect([...new Uint8Array(r.data)]).toEqual([9, 8]);
    const r2 = await httpRequest('https://example.org/cog.tif');
    expect(r2.status).toBe(500);
    expect(calls).toHaveLength(2);
  });
});

describe('native transport (CapacitorHttp)', () => {
  function nativeStub(responses: (Partial<HttpResponse> | Error)[]) {
    const calls: HttpOptions[] = [];
    const fn = async (o: HttpOptions): Promise<HttpResponse> => {
      calls.push(o);
      const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
      if (r instanceof Error) throw r;
      return { data: r.data, status: r.status ?? 200, headers: r.headers ?? {}, url: o.url };
    };
    return { fn, calls };
  }

  it('decodes base64 binary bodies and requests arraybuffer', async () => {
    const payload = new Uint8Array([0, 1, 2, 3, 254, 255, 128]);
    const { fn, calls } = nativeStub([{ data: Buffer.from(payload).toString('base64') }]);
    setHttpConfig({ platform: 'native', nativeRequest: fn });
    const buf = await fetchBinary('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/1/1/1.png');
    expect([...new Uint8Array(buf)]).toEqual([...payload]);
    expect(calls[0]!.responseType).toBe('arraybuffer');
    expect(calls[0]!.url).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/1/1/1.png');
  });

  it('accepts JSON as parsed object or string', async () => {
    const { fn } = nativeStub([{ data: { a: 1 } }, { data: '{"b":2}' }]);
    setHttpConfig({ platform: 'native', nativeRequest: fn });
    expect(await fetchJson('https://www.rfs.nsw.gov.au/feeds/x.json')).toEqual({ a: 1 });
    expect(await fetchJson('https://www.rfs.nsw.gov.au/feeds/x.json')).toEqual({ b: 2 });
  });

  it('retries a 502 then returns; maps plugin failures to network errors', async () => {
    const { fn, calls } = nativeStub([{ status: 502, data: 'bad gateway' }, { data: 'ok' }]);
    setHttpConfig({ platform: 'native', nativeRequest: fn, retryDelayMs: 1 });
    expect(await fetchText('https://example.org/a')).toBe('ok');
    expect(calls).toHaveLength(2);
    const { fn: failing } = nativeStub([new Error('The Internet connection appears to be offline.')]);
    setHttpConfig({ nativeRequest: failing });
    const err = (await fetchText('https://example.org/a').catch((e) => e)) as HttpError;
    expect(err.kind).toBe('network');
  });

  it('times out when the native call never returns', async () => {
    setHttpConfig({ platform: 'native', nativeRequest: () => new Promise<HttpResponse>(() => {}) });
    const err = (await fetchText('https://example.org/a', { timeoutMs: 20, retries: 0 }).catch((e) => e)) as HttpError;
    expect(err.kind).toBe('timeout');
  });
});

describe('binary helpers', () => {
  it('base64 decoding matches Buffer for random data (standard, url-safe, data: URI)', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 255, 1000]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 73 + 11) & 255;
      const b64 = Buffer.from(bytes).toString('base64');
      expect([...base64ToBytes(b64)]).toEqual([...bytes]);
      expect([...base64ToBytes(Buffer.from(bytes).toString('base64url'))]).toEqual([...bytes]);
      expect([...base64ToBytes(`data:image/png;base64,${b64}`)]).toEqual([...bytes]);
    }
  });

  it('toArrayBuffer handles views, buffers, strings and objects', () => {
    const u = new Uint8Array([5, 6, 7, 8]).subarray(1, 3);
    expect([...new Uint8Array(toArrayBuffer(u))]).toEqual([6, 7]);
    const ab = new ArrayBuffer(2);
    expect(toArrayBuffer(ab)).toBe(ab);
    expect(new TextDecoder().decode(toArrayBuffer({ a: 1 }))).toBe('{"a":1}');
    expect(toArrayBuffer(null).byteLength).toBe(0);
  });
});

describe.skipIf(!process.env.NET)('network (NET=1)', () => {
  it('downloads a real Terrarium tile', async () => {
    const buf = await fetchBinary(serviceUrl('terrarium', '/terrarium/13/7515/4911.png'));
    expect(new Uint8Array(buf).subarray(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47])); // "PNG"
  });
});
