/**
 * HTTP access for data providers that works in all three places FireSim runs:
 *
 *  1. **Capacitor native (iOS / Android)**: requests go through the native HTTP stack (`CapacitorHttp`), which is not
 *     subject to CORS. `window.fetch` is also patched by Capacitor when `CapacitorHttp.enabled` is set in
 *     capacitor.config.ts, but the patched fetch mangles binary bodies on some platforms, so this module calls the
 *     plugin directly and asks for base64 (`responseType: 'arraybuffer'`) for binary payloads.
 *     NOTE: inside a Web Worker on device there is no native bridge and fetch is NOT patched; data loading should run on
 *     the main thread (the scenario builder does this), or the worker must be told the platform via
 *     {@link setHttpConfig} and accept that non-CORS services will fail there.
 *  2. **Browser (Vite dev server / preview / PWA)**: CORS-enabled services (Open-Meteo, AWS Terrain Tiles, NSW
 *     Environment ArcGIS, NSW RFS feeds — all verified live, doc 08b) are called directly; the one service without CORS
 *     headers (the Meta canopy-height bucket) is routed through the dev-server proxy at `/proxy/<service>` (see
 *     vite.config.ts), or a deployment proxy configured with `setHttpConfig({ proxyBase })`.
 *  3. **Node (Vitest, scripts)**: direct absolute URLs through the global fetch (set `NODE_USE_ENV_PROXY=1` to use an
 *     HTTPS proxy).
 *
 * All requests have a timeout, honour an optional AbortSignal and are retried once on transient failures
 * (network errors, timeouts, HTTP 408/429/5xx). Failures surface as a typed {@link HttpError}.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { endpointOf, type DatasetLedger } from './ledger';

// ─────────────────────────────────────────────────────────────────────────────
// Services and URL routing
// ─────────────────────────────────────────────────────────────────────────────

export type ServiceId = 'openmeteo' | 'openmeteo-archive' | 'nswenv' | 'nswspatial' | 'rfs' | 'terrarium' | 'chm' | 'generic';

interface ServiceInfo {
  /** Absolute base URL (no trailing slash). */
  base: string;
  /** True when the service sends `Access-Control-Allow-Origin: *`, so browsers may call it directly. */
  cors: boolean;
}

/** Known upstream services. `generic` is handled separately (the "path" is already an absolute URL). */
export const SERVICES: Readonly<Record<Exclude<ServiceId, 'generic'>, ServiceInfo>> = {
  openmeteo: { base: 'https://api.open-meteo.com', cors: true },
  'openmeteo-archive': { base: 'https://archive-api.open-meteo.com', cors: true },
  // NSW Environment ArcGIS (NPWS fire history, SVTM) and NSW RFS feeds: live checks on 2026-09-27 found
  // `Access-Control-Allow-Origin: *` on both (docs/research/08b-live-endpoint-verification.md §3, §4, §8), so browsers
  // (dev server, preview, installed PWA) call them directly; the dev proxy is only needed for the canopy bucket.
  nswenv: { base: 'https://mapprod3.environment.nsw.gov.au', cors: true },
  rfs: { base: 'https://www.rfs.nsw.gov.au', cors: true },
  // NSW Spatial Services ArcGIS portal (roads, fire trails, addresses, place and suburb names; data/nswContext.ts).
  // Verified live on 2026-09-29: GET and POST answer with `Access-Control-Allow-Origin` (the request's origin), and the
  // pre-flight OPTIONS of a form POST succeeds, so browsers call it directly. NSW Planning's land zoning is on `nswenv`.
  nswspatial: { base: 'https://portal.spatial.nsw.gov.au', cors: true },
  // AWS Open Data Terrain Tiles: S3 bucket with a permissive CORS policy (verified: ACAO * on GET).
  terrarium: { base: 'https://s3.amazonaws.com/elevation-tiles-prod', cors: true },
  // Meta/WRI canopy height COGs: the bucket has no CORS policy (pre-flight returns 403), so browsers need the proxy.
  chm: { base: 'https://dataforgood-fb-data.s3.amazonaws.com', cors: false },
};

/** Where the code is running, which decides how URLs are routed and which transport is used. */
export type HttpPlatform = 'native' | 'browser' | 'node';

export interface HttpConfig {
  /**
   * Prefix put in front of `/proxy/<service>` for non-CORS services in the browser. Default '' (same origin, i.e. the
   * Vite dev/preview server). A deployed PWA can point this at its own reverse proxy, e.g. 'https://proxy.example.org'.
   */
  proxyBase: string;
  /** Always use direct absolute URLs, even in the browser (e.g. a browser with CORS disabled, or an extension). */
  forceDirect: boolean;
  /** Override platform detection (e.g. a Web Worker told by the main thread that it runs on a native device). */
  platform?: HttpPlatform;
  /** Default timeout (ms) for JSON / text requests. */
  timeoutMs: number;
  /** Default timeout (ms) for binary requests (tiles, rasters). */
  binaryTimeoutMs: number;
  /** Delay (ms) before the single retry of a transient failure. */
  retryDelayMs: number;
  /** Injectable fetch (tests). Defaults to the global fetch at call time. */
  fetch?: typeof fetch;
  /** Injectable native request (tests). Defaults to `CapacitorHttp.request`. */
  nativeRequest?: (options: HttpOptions) => Promise<HttpResponse>;
}

const DEFAULT_CONFIG: HttpConfig = {
  proxyBase: '',
  forceDirect: false,
  timeoutMs: 20_000,
  binaryTimeoutMs: 30_000,
  retryDelayMs: 500,
};

let config: HttpConfig = { ...DEFAULT_CONFIG };

/** Merge settings into the global HTTP configuration. */
export function setHttpConfig(patch: Partial<HttpConfig>): void {
  config = { ...config, ...patch };
  if (config.proxyBase.endsWith('/')) config.proxyBase = config.proxyBase.replace(/\/+$/, '');
}

/** Restore the default configuration (tests). */
export function resetHttpConfig(): void {
  config = { ...DEFAULT_CONFIG };
}

export function getHttpConfig(): Readonly<HttpConfig> {
  return config;
}

/** Detect the runtime. Honors `setHttpConfig({ platform })`. */
export function detectPlatform(): HttpPlatform {
  if (config.platform) return config.platform;
  try {
    if (Capacitor.isNativePlatform()) return 'native';
  } catch {
    /* Capacitor global unavailable: not native */
  }
  const g = globalThis as { window?: unknown; document?: unknown; WorkerGlobalScope?: unknown; process?: { versions?: { node?: string } } };
  if (typeof g.window !== 'undefined' && typeof g.document !== 'undefined') return 'browser';
  if (typeof g.WorkerGlobalScope !== 'undefined') return 'browser';
  if (g.process?.versions?.node) return 'node';
  return 'browser';
}

/**
 * Build the URL to call for a service endpoint on the current platform.
 * @param pathAndQuery path (with query) relative to the service root, e.g. '/v1/forecast?latitude=…'. For
 *   `generic` it must be an absolute URL, which is returned unchanged.
 */
export function serviceUrl(service: ServiceId, pathAndQuery: string): string {
  if (service === 'generic') return pathAndQuery;
  const info = SERVICES[service];
  if (!info) throw new Error(`Unknown service '${service as string}'`);
  const path = pathAndQuery.startsWith('/') || pathAndQuery === '' ? pathAndQuery : `/${pathAndQuery}`;
  if (useProxy(info)) return `${config.proxyBase}/proxy/${service}${path}`;
  return info.base + path;
}

function useProxy(info: ServiceInfo): boolean {
  return !info.cors && !config.forceDirect && detectPlatform() === 'browser';
}

/**
 * Route an absolute URL of a known service through {@link serviceUrl} (e.g. a URL copied from documentation, or one
 * built by a library). Unknown hosts and relative URLs are returned unchanged.
 */
export function routeUrl(url: string): string {
  for (const id of Object.keys(SERVICES) as (keyof typeof SERVICES)[]) {
    const base = SERVICES[id].base;
    if (url === base || url.startsWith(base + '/') || url.startsWith(base + '?')) return serviceUrl(id, url.slice(base.length));
  }
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export type HttpErrorKind = 'http' | 'network' | 'timeout' | 'aborted' | 'parse';

/** A failed request. `status` is the HTTP status, or 0 when no response was received. */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly kind: HttpErrorKind;
  readonly status: number;
  readonly url: string;
  constructor(kind: HttpErrorKind, url: string, message: string, status = 0, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.kind = kind;
    this.status = status;
    this.url = url;
  }
  /** Worth retrying: connection problems, timeouts, rate limiting, server errors. */
  get transient(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true;
    if (this.kind === 'http') return this.status === 408 || this.status === 429 || this.status >= 500;
    return false;
  }
  /** No response at all (offline, DNS failure, blocked, timed out) — callers should fall back to cached / bundled data. */
  get offline(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}

export const isHttpError = (e: unknown): e is HttpError => e instanceof HttpError;

// ─────────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────────

export interface RequestOptions {
  /** Timeout for the whole request including reading the body (ms); 0 or Infinity disables it. */
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Number of retries after a transient failure (default 1). */
  retries?: number;
  /** Rewrite absolute URLs of known services for the current platform (default true). */
  route?: boolean;
  /**
   * POST these fields as `application/x-www-form-urlencoded` instead of a GET (the ArcGIS REST `query` with a long
   * list of object ids does not fit in a URL). A "simple" CORS request, so browsers send no pre-flight. On device the
   * plugin encodes the object; the response is read the same way as for a GET.
   */
  form?: Record<string, string>;
  /**
   * Data set id this request is for. With `ledger`, the request is recorded (host + path, status, bytes on the wire,
   * decoded bytes, time, retries; never the query string). Without a ledger nothing is measured and nothing changes.
   */
  tag?: string;
  ledger?: DatasetLedger;
  /** Plain words kept on the ledger entry ("model best_match", "page 2"). */
  note?: string;
  /** Called once with the measurements of a successful request (the cache layer uses it to store the size). Never throws into the request. */
  onResponse?: (info: ResponseInfo) => void;
}

/** What {@link RequestOptions.onResponse} receives. */
export interface ResponseInfo {
  status: number;
  /** Bytes on the wire when known (Content-Length or resource timing), else the decoded body length (`wireKnown` false). */
  bytes: number;
  /** False when the wire size was not reported and `bytes` is the decoded length (an upper bound for a compressed answer). */
  wireKnown: boolean;
  /** Decoded body length. */
  bodyBytes: number;
  durationMs: number;
  retries: number;
}

/** Filled by the transport with what it saw (only requested when a ledger or callback wants it). */
interface Probe {
  status: number;
  /** Body bytes on the wire: Content-Length when the response exposed it, else the resource-timing encoded size (-1 = unknown). */
  wire: number;
  body: number;
}

const newProbe = (): Probe => ({ status: 0, wire: -1, body: 0 });

/** Resource-timing entries kept before they are cleared (browsers buffer 250 by default; nothing else in the app reads them). */
const TIMING_KEEP = 200;
/** Timing entries already matched to a response (a URL can be asked for several times: POST queries, retries, parallel pages). */
const usedTimings = new WeakSet<object>();

/**
 * Bytes of a response body ON THE WIRE (compressed) from its Resource Timing entry, for a response that sent no
 * Content-Length (a compressed, chunked answer). Browsers report it for same-origin responses (the dev-server proxy) and
 * for services that send Timing-Allow-Origin; Node's fetch always does; the native plugin never does. Only an entry of
 * THIS response is taken: same URL, started at or after the request, decoded size equal to the body read, not matched
 * before (the same query URL is often asked several times, e.g. the ArcGIS POST queries). -1 when none (the caller then
 * counts the decoded size and marks it unmeasured). Never throws.
 */
function wireFromTiming(url: string, startedAt: number, bodyBytes: number): number {
  try {
    const perf = (globalThis as { performance?: Performance }).performance;
    if (!perf || typeof perf.getEntriesByName !== 'function') return -1;
    let abs = url;
    try {
      abs = new URL(url, (globalThis as { location?: { href?: string } }).location?.href).href;
    } catch {
      /* keep the URL as given */
    }
    const list = perf.getEntriesByName(abs, 'resource') as PerformanceResourceTiming[];
    let n = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i]!;
      if (usedTimings.has(e) || e.startTime < startedAt - 1 || e.decodedBodySize !== bodyBytes) continue;
      if (typeof e.encodedBodySize === 'number' && Number.isFinite(e.encodedBodySize) && e.encodedBodySize > 0) {
        usedTimings.add(e);
        n = e.encodedBodySize;
      }
      break;
    }
    if (typeof perf.getEntriesByType === 'function' && typeof perf.clearResourceTimings === 'function' && perf.getEntriesByType('resource').length > TIMING_KEEP) perf.clearResourceTimings();
    return n;
  } catch {
    return -1;
  }
}

/** Fill in the wire size from resource timing when no Content-Length was given (the entry can land a task after the body). */
async function settleWire(probe: Probe | undefined, url: string, startedAt: number): Promise<void> {
  if (!probe || probe.wire >= 0 || probe.body <= 0) return;
  let n = wireFromTiming(url, startedAt, probe.body);
  if (n < 0) {
    await new Promise((r) => setTimeout(r, 0));
    n = wireFromTiming(url, startedAt, probe.body);
  }
  if (n >= 0) probe.wire = n;
}
const clockMs = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/** UTF-8 length of a string. */
function utf8Length(s: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (i++, 4) : 3;
  }
  return n;
}

function contentLength(h: { get?(k: string): string | null } | Record<string, string> | undefined): number {
  try {
    const v = typeof (h as { get?: unknown })?.get === 'function' ? (h as { get(k: string): string | null }).get('content-length') : (h as Record<string, string> | undefined)?.['content-length'];
    const n = v === null || v === undefined ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : -1;
  } catch {
    return -1;
  }
}

type BodyKind = 'binary' | 'text' | 'json';

/** A response returned without status checking (see {@link httpRequest}). Header names are lower-case. */
export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  data: ArrayBuffer;
  url: string;
}

/** GET a JSON document. */
export async function fetchJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  return (await request(url, 'json', opts)) as T;
}

/** GET a binary resource. */
export async function fetchBinary(url: string, opts: RequestOptions = {}): Promise<ArrayBuffer> {
  return (await request(url, 'binary', { ...opts, timeoutMs: opts.timeoutMs ?? config.binaryTimeoutMs })) as ArrayBuffer;
}

/** GET a text resource. */
export async function fetchText(url: string, opts: RequestOptions = {}): Promise<string> {
  return (await request(url, 'text', opts)) as string;
}

/**
 * Single GET that resolves for ANY HTTP status (no retry, no status check) and returns the body as bytes plus the
 * response headers. Used by range-request clients (GeoTIFF). Throws {@link HttpError} only for network failure,
 * timeout or abort.
 */
export async function httpRequest(url: string, opts: RequestOptions = {}): Promise<RawResponse> {
  const target = opts.route === false ? url : routeUrl(url);
  const measure = wantsMeasure(opts);
  const probe = measure ? newProbe() : undefined;
  const t0 = measure ? clockMs() : 0;
  const at = opts.ledger ? opts.ledger.now() : 0;
  try {
    const r = (await attempt(target, 'binary', { ...opts, timeoutMs: opts.timeoutMs ?? config.binaryTimeoutMs }, true, probe)) as RawResponse;
    if (measure) finishMeasure(opts, url, opts.form ? 'POST' : 'GET', probe!, at, clockMs() - t0, 0, undefined, r.status);
    return r;
  } catch (e) {
    if (measure) finishMeasure(opts, url, opts.form ? 'POST' : 'GET', probe!, at, clockMs() - t0, 0, e);
    throw e;
  }
}

const wantsMeasure = (opts: RequestOptions): boolean => !!opts.ledger || !!opts.onResponse;

/** Record a finished request on the ledger and tell `onResponse`; never throws. */
function finishMeasure(opts: RequestOptions, url: string, method: 'GET' | 'POST', probe: Probe, at: number, durationMs: number, retries: number, error?: unknown, statusOverride?: number): void {
  try {
    const status = statusOverride ?? (error instanceof HttpError ? error.status : probe.status);
    const body = probe.body;
    const wireKnown = probe.wire >= 0 || body === 0;
    const wire = probe.wire >= 0 ? probe.wire : body;
    if (!error && opts.onResponse) {
      try {
        opts.onResponse({ status, bytes: wire, wireKnown, bodyBytes: body, durationMs, retries });
      } catch {
        /* a callback must not break the request */
      }
    }
    if (!opts.ledger) return;
    const ep = ledgerEndpoint(url);
    opts.ledger.record({
      tag: opts.tag ?? 'other',
      host: ep.host,
      path: ep.path,
      method,
      status,
      source: 'network',
      bytes: wire,
      bodyBytes: body,
      durationMs,
      retries,
      at,
      ...(wireKnown ? {} : { wireUnknown: true }),
      ...(opts.note ? { note: opts.note } : {}),
      ...(error ? { error: error instanceof HttpError ? error.kind : 'network' } : {}),
    });
  } catch {
    /* never throws */
  }
}

/** Host and path of the UPSTREAM service for a (possibly proxied) URL. */
function ledgerEndpoint(url: string): { host: string; path: string } {
  const ep = endpointOf(url);
  const m = /^\/proxy\/([a-z0-9-]+)(\/.*)?$/.exec(ep.path);
  if (m && m[1] && m[1] in SERVICES) {
    const base = endpointOf(SERVICES[m[1] as keyof typeof SERVICES].base);
    return { host: base.host, path: `${base.path === '/' ? '' : base.path}${m[2] ?? ''}` };
  }
  if (!ep.host) {
    // A relative or same-origin URL: keep the path; the host is the app's own.
    return { host: '', path: ep.path };
  }
  return ep;
}

async function request(url: string, kind: BodyKind, opts: RequestOptions): Promise<unknown> {
  const target = opts.route === false ? url : routeUrl(url);
  const retries = Math.max(0, opts.retries ?? 1);
  const measure = wantsMeasure(opts);
  // Every attempt is recorded as its own request (a retried HTTP 429 or timeout is a request that was made); the
  // successful or final one carries the number of retries before it.
  for (let n = 0; ; n++) {
    const probe = measure ? newProbe() : undefined;
    const t0 = measure ? clockMs() : 0;
    const at = opts.ledger ? opts.ledger.now() : 0;
    try {
      const out = await attempt(target, kind, opts, false, probe);
      if (measure) finishMeasure(opts, url, opts.form ? 'POST' : 'GET', probe!, at, clockMs() - t0, n);
      return out;
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError('network', target, String(e), 0, e);
      const final = n >= retries || !err.transient || !!opts.signal?.aborted;
      if (measure) finishMeasure(opts, url, opts.form ? 'POST' : 'GET', probe!, at, clockMs() - t0, final ? n : 0, err);
      if (final) throw err;
      await delay(config.retryDelayMs * (n + 1), opts.signal, target);
    }
  }
}

/** One attempt, via the native plugin or fetch. When `raw`, returns a {@link RawResponse} regardless of status. */
async function attempt(url: string, kind: BodyKind, opts: RequestOptions, raw: boolean, probe?: Probe): Promise<unknown> {
  if (opts.signal?.aborted) throw new HttpError('aborted', url, `Request aborted: ${url}`);
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
  return detectPlatform() === 'native'
    ? nativeAttempt(url, kind, opts.headers, timeoutMs, opts.signal, raw, opts.form, probe)
    : fetchAttempt(url, kind, opts.headers, timeoutMs, opts.signal, raw, opts.form, probe);
}

const FORM_TYPE = 'application/x-www-form-urlencoded';

async function fetchAttempt(
  url: string,
  kind: BodyKind,
  headers: Record<string, string> | undefined,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  raw: boolean,
  form?: Record<string, string>,
  probe?: Probe,
): Promise<unknown> {
  const doFetch = config.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new HttpError('network', url, 'fetch is not available in this environment');
  // Resource-timing clock at the start (for matching this response's timing entry, see wireFromTiming).
  const startedAt = probe && typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
  // Combine the caller's signal with our timeout (AbortSignal.any is missing on older Android WebViews).
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = startTimer(timeoutMs, () => {
    timedOut = true;
    ctrl.abort();
  });
  const onAbort = (): void => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = form
      ? await doFetch(url, { method: 'POST', headers: { ...headers, 'content-type': FORM_TYPE }, body: new URLSearchParams(form).toString(), signal: ctrl.signal })
      : await doFetch(url, { method: 'GET', headers, signal: ctrl.signal });
    if (probe) {
      probe.status = res.status;
      probe.wire = contentLength(res.headers);
    }
    if (raw) {
      const data = await res.arrayBuffer();
      const h: Record<string, string> = {};
      res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
      if (probe) probe.body = data.byteLength;
      await settleWire(probe, url, startedAt);
      return { status: res.status, headers: h, data, url } satisfies RawResponse;
    }
    if (!res.ok) {
      // Drain the body so the connection can be reused; ignore failures.
      const text = await res.text().catch(() => '');
      if (probe) probe.body = utf8Length(text);
      throw new HttpError('http', url, `HTTP ${res.status} ${res.statusText || ''} for ${url}${text ? `: ${text.slice(0, 200)}` : ''}`.trim(), res.status);
    }
    if (kind === 'binary') {
      const buf = await res.arrayBuffer();
      if (probe) probe.body = buf.byteLength;
      await settleWire(probe, url, startedAt);
      return buf;
    }
    const text = await res.text();
    if (probe) probe.body = utf8Length(text);
    await settleWire(probe, url, startedAt);
    return kind === 'json' ? parseJson(text, url) : text;
  } catch (e) {
    throw classify(e, url, timedOut, signal, timeoutMs);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function nativeAttempt(
  url: string,
  kind: BodyKind,
  headers: Record<string, string> | undefined,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  raw: boolean,
  form?: Record<string, string>,
  probe?: Probe,
): Promise<unknown> {
  const req = config.nativeRequest ?? ((o: HttpOptions) => CapacitorHttp.request(o));
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  // The native call cannot be cancelled; we stop waiting for it on timeout / abort.
  const guard = new Promise<never>((_, reject) => {
    timer = startTimer(timeoutMs, () => {
      timedOut = true;
      reject(new HttpError('timeout', url, `Timed out after ${timeoutMs} ms: ${url}`));
    });
    onAbort = () => reject(new HttpError('aborted', url, `Request aborted: ${url}`));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const res = await Promise.race([
      req({
        url,
        method: form ? 'POST' : 'GET',
        headers: form ? { ...headers, 'content-type': FORM_TYPE } : (headers ?? {}),
        ...(form ? { data: form } : {}),
        responseType: kind === 'binary' ? 'arraybuffer' : kind === 'json' ? 'json' : 'text',
        ...(hasTimeout(timeoutMs) ? { connectTimeout: timeoutMs, readTimeout: timeoutMs } : {}),
      }),
      guard,
    ]);
    const h: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers ?? {})) h[k.toLowerCase()] = String(v);
    const ok = res.status >= 200 && res.status < 300;
    if (probe) {
      probe.status = res.status;
      probe.wire = contentLength(h);
    }
    if (raw) {
      const data = toArrayBuffer(res.data);
      if (probe) probe.body = data.byteLength;
      return { status: res.status, headers: h, data, url } satisfies RawResponse;
    }
    if (!ok) {
      const body = typeof res.data === 'string' ? res.data : safeStringify(res.data);
      if (probe) probe.body = utf8Length(body);
      throw new HttpError('http', url, `HTTP ${res.status} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`, res.status);
    }
    if (kind === 'binary') {
      const buf = toArrayBuffer(res.data);
      if (probe) probe.body = buf.byteLength;
      return buf;
    }
    // The plugin may already have parsed a JSON body: measure the text it stands for.
    if (probe) probe.body = utf8Length(typeof res.data === 'string' ? res.data : safeStringify(res.data));
    if (kind === 'json') return typeof res.data === 'string' ? parseJson(res.data, url) : res.data;
    return typeof res.data === 'string' ? res.data : safeStringify(res.data);
  } catch (e) {
    throw classify(e, url, timedOut, signal, timeoutMs);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

/** Largest delay setTimeout accepts; longer (or Infinity) overflows to an immediate timeout in browsers and Node. */
const MAX_TIMER_MS = 2_147_483_647;
/** A timeout of 0, a negative value, NaN or Infinity means "no timeout". */
const hasTimeout = (ms: number): boolean => ms > 0 && ms < MAX_TIMER_MS;

function startTimer(ms: number, fn: () => void): ReturnType<typeof setTimeout> | undefined {
  return hasTimeout(ms) ? setTimeout(fn, ms) : undefined;
}

function classify(e: unknown, url: string, timedOut: boolean, signal: AbortSignal | undefined, timeoutMs: number): HttpError {
  if (e instanceof HttpError) return e;
  if (timedOut) return new HttpError('timeout', url, `Timed out after ${timeoutMs} ms: ${url}`, 0, e);
  if (signal?.aborted) return new HttpError('aborted', url, `Request aborted: ${url}`, 0, e);
  const msg = e instanceof Error ? e.message : String(e);
  return new HttpError('network', url, `Network error for ${url}: ${msg}`, 0, e);
}

function parseJson(text: string, url: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new HttpError('parse', url, `Invalid JSON from ${url}: ${text.slice(0, 120)}`, 200, e);
  }
}

function safeStringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function delay(ms: number, signal: AbortSignal | undefined, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new HttpError('aborted', url, `Request aborted: ${url}`));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new HttpError('aborted', url, `Request aborted: ${url}`));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Binary helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise whatever the native plugin returned for a binary body (base64 string, ArrayBuffer, view) to an ArrayBuffer. */
export function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
  }
  if (typeof data === 'string') return base64ToBytes(data).buffer as ArrayBuffer;
  if (data === undefined || data === null) return new ArrayBuffer(0);
  // A JSON body parsed by the plugin: re-serialise as UTF-8.
  return new TextEncoder().encode(safeStringify(data)).buffer as ArrayBuffer;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const t = new Uint8Array(256).fill(255);
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62; // base64url
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

/** Decode standard or URL-safe base64 (whitespace and an optional `data:…;base64,` prefix are ignored). */
export function base64ToBytes(b64: string): Uint8Array {
  const comma = b64.startsWith('data:') ? b64.indexOf(',') : -1;
  const s = comma >= 0 ? b64.slice(comma + 1) : b64;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4) + 3);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64_LOOKUP[s.charCodeAt(i) & 255]!;
    if (v === 255) continue; // padding, whitespace
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.slice(0, o);
}
