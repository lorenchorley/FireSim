/**
 * The request ledger: one per scenario build, it records every request the data layer makes (network, stored copy,
 * area pack, bundled file) under a TAG (the id of the data set it was for) so the builder can report real sizes, request
 * counts and timings per data set (core/datasets.ts).
 *
 * How it is wired
 *  - `data/http.ts`: `fetchJson/fetchBinary/fetchText/httpRequest` take optional `{ tag, ledger }` in their options. With no
 *    ledger nothing changes and nothing is measured. With one, the request's bytes on the wire (Content-Length when the
 *    browser exposes it, else the body length), the decoded body length, status, time and retries are recorded.
 *  - `data/cache.ts`: `cachedFetch` records a stored-copy hit (with its size and the time it was stored), and
 *    `loadAreaPackItem` records a pack read.
 *  - `data/assets.ts`: `loadAsset` records a bundled file (its byte length).
 *
 * Guarantees
 *  - It NEVER throws: every method swallows its own errors (a broken ledger must not break a build).
 *  - It never keeps a URL with a query string, fragment, credentials or a token-looking path segment: only host and path.
 *  - It is O(1) per request and bounded: the last `maxEntries` requests are kept, the totals are exact regardless.
 */

export type LedgerSource = 'network' | 'cache' | 'stale' | 'pack' | 'bundled';

/** Options a caller adds to a request (or an asset/pack read) to have it recorded. */
export interface TraceOptions {
  /** Data set id the request is for ('terrain', 'vegetation-svtm' ...). */
  tag?: string;
  ledger?: DatasetLedger;
  /** Free text kept on the entry ("model best_match", "page 2"): plain words only, never a URL. */
  note?: string;
}

export interface LedgerEntry {
  seq: number;
  tag: string;
  host: string;
  /** Path without query string. */
  path: string;
  method: 'GET' | 'POST';
  /** HTTP status; 0 = no response (offline, timeout, abort); 200 for stored copies and bundled files. */
  status: number;
  ok: boolean;
  source: LedgerSource;
  /** Bytes on the wire (Content-Length if known, else the body length); for stored copies, bundled files and packs the stored size. */
  bytes: number;
  /** Decoded body length (UTF-8 bytes of a text body, byte length of a binary one). */
  bodyBytes: number;
  /** Time the request took (ms). */
  durationMs: number;
  /** Retries after a transient failure. */
  retries: number;
  /** Start time (epoch ms). */
  at: number;
  /** For stored copies: when the copy was stored. */
  cachedAt?: number;
  note?: string;
  /** Failure kind ('http', 'network', 'timeout', 'aborted', 'parse'). */
  error?: string;
}

/** What a caller records; missing fields get sensible defaults. */
export interface LedgerInput {
  tag: string;
  /** Full URL (query and fragment are dropped) - or give `host` and `path`. */
  url?: string;
  host?: string;
  path?: string;
  method?: 'GET' | 'POST';
  status?: number;
  source?: LedgerSource;
  bytes?: number;
  bodyBytes?: number;
  durationMs?: number;
  retries?: number;
  at?: number;
  cachedAt?: number;
  note?: string;
  error?: string;
}

export interface LedgerTotals {
  requests: number;
  failures: number;
  /** All bytes obtained (network + stored + pack + bundled). */
  bytes: number;
  bodyBytes: number;
  networkBytes: number;
  /** Stored copies (cache hits, including stale ones). */
  cacheBytes: number;
  packBytes: number;
  bundledBytes: number;
  /** Requests by source. */
  bySource: Record<LedgerSource, number>;
  retries: number;
  /** Sum of the request durations (overlapping requests add up). */
  sumMs: number;
  /** First request start to last request end. */
  wallMs: number;
  firstAt: number;
  lastEndAt: number;
  /** Oldest / newest time a stored copy was stored (0 = none). */
  oldestCachedAt: number;
  newestCachedAt: number;
  /** Time of the newest successful network response start (0 = none). */
  newestNetworkAt: number;
  /** Bytes this build wrote to the app's storage for the tag (cache entries). */
  storedBytes: number;
}

export interface LedgerEndpoint {
  host: string;
  /** Path with long numbers replaced by {n} (tiles, quadkeys), so many tiles make one line. */
  path: string;
  requests: number;
  bytes: number;
}

const zeroTotals = (): LedgerTotals => ({
  requests: 0,
  failures: 0,
  bytes: 0,
  bodyBytes: 0,
  networkBytes: 0,
  cacheBytes: 0,
  packBytes: 0,
  bundledBytes: 0,
  bySource: { network: 0, cache: 0, stale: 0, pack: 0, bundled: 0 },
  retries: 0,
  sumMs: 0,
  wallMs: 0,
  firstAt: 0,
  lastEndAt: 0,
  oldestCachedAt: 0,
  newestCachedAt: 0,
  newestNetworkAt: 0,
  storedBytes: 0,
});

// ─────────────────────────────────────────────────────────────────────────────
// URL hygiene
// ─────────────────────────────────────────────────────────────────────────────

/** A path segment that looks like a secret: 24+ chars of a token alphabet containing digits, or 32+ hex/base64 chars. */
const TOKENISH = /^(?=.*\d)[A-Za-z0-9_-]{24,}$|^[A-Fa-f0-9]{32,}$/;

/**
 * Host and path of a URL with everything that could hold a secret removed: query, fragment, credentials, and path
 * segments that look like tokens ('…'). A relative URL gets host ''. Never throws.
 */
export function endpointOf(url: string): { host: string; path: string } {
  try {
    let rest = String(url).trim();
    let host = '';
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)(.*)$/i.exec(rest);
    if (m) {
      host = (m[1] ?? '').replace(/^.*@/, '').toLowerCase();
      rest = m[2] ?? '';
    }
    rest = rest.split('#')[0]!.split('?')[0]!;
    if (!rest.startsWith('/')) rest = `/${rest}`;
    const path = rest
      .split('/')
      .map((seg) => (TOKENISH.test(seg) ? '…' : seg))
      .join('/');
    return { host, path };
  } catch {
    return { host: '', path: '' };
  }
}

/** Path with runs of 3+ digits replaced by {n} ('/terrarium/13/7515/4911.png' -> '/terrarium/13/{n}/{n}.png'). */
export const pathPattern = (path: string): string => path.replace(/\d{3,}/g, '{n}');

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);

// ─────────────────────────────────────────────────────────────────────────────
// The ledger
// ─────────────────────────────────────────────────────────────────────────────

export interface LedgerOptions {
  /** Entries kept (default 4000); totals are exact beyond it. */
  maxEntries?: number;
  /** Clock (epoch ms), injectable for tests. */
  clock?: () => number;
}

export class DatasetLedger {
  private readonly max: number;
  private readonly clock: () => number;
  private list: LedgerEntry[] = [];
  private seq = 0;
  private readonly agg = new Map<string, LedgerTotals>();
  private readonly ends = new Map<string, Map<string, LedgerEndpoint>>();
  /** Errors swallowed (a test can assert the ledger never lost data silently). */
  swallowed = 0;

  constructor(opts: LedgerOptions = {}) {
    this.max = Math.max(1, opts.maxEntries ?? 4000);
    this.clock = opts.clock ?? Date.now;
  }

  /** Current time (epoch ms) of the ledger's clock. */
  now(): number {
    try {
      return this.clock();
    } catch {
      return Date.now();
    }
  }

  /** Record one request. Never throws. */
  record(input: LedgerInput): void {
    try {
      const ep = input.host !== undefined || input.path !== undefined ? { host: input.host ?? '', path: (input.path ?? '').split('?')[0]!.split('#')[0]! } : endpointOf(input.url ?? '');
      const source: LedgerSource = input.source ?? 'network';
      const status = Math.round(num(input.status, source === 'network' ? 0 : 200));
      const at = num(input.at, this.now());
      const entry: LedgerEntry = {
        seq: ++this.seq,
        tag: String(input.tag || 'other'),
        host: ep.host,
        path: ep.path,
        method: input.method === 'POST' ? 'POST' : 'GET',
        status,
        ok: source !== 'network' ? true : status >= 200 && status < 300,
        source,
        bytes: Math.round(num(input.bytes, num(input.bodyBytes))),
        bodyBytes: Math.round(num(input.bodyBytes, num(input.bytes))),
        durationMs: Math.round(num(input.durationMs) * 10) / 10,
        retries: Math.round(num(input.retries)),
        at,
      };
      if (input.cachedAt !== undefined && Number.isFinite(input.cachedAt)) entry.cachedAt = input.cachedAt;
      if (input.note) entry.note = String(input.note).slice(0, 120);
      if (input.error) entry.error = String(input.error).slice(0, 40);
      if (entry.error) entry.ok = false;
      this.list.push(entry);
      if (this.list.length > this.max) this.list.splice(0, this.list.length - this.max);
      this.add(entry);
    } catch {
      this.swallowed++;
    }
  }

  private add(e: LedgerEntry): void {
    for (const key of [e.tag, '*']) {
      let t = this.agg.get(key);
      if (!t) this.agg.set(key, (t = zeroTotals()));
      t.requests++;
      if (!e.ok) t.failures++;
      // A failed request delivered nothing usable: its bytes are not "obtained".
      if (e.ok) {
        t.bytes += e.bytes;
        t.bodyBytes += e.bodyBytes;
        if (e.source === 'network') t.networkBytes += e.bytes;
        else if (e.source === 'cache' || e.source === 'stale') t.cacheBytes += e.bytes;
        else if (e.source === 'pack') t.packBytes += e.bytes;
        else t.bundledBytes += e.bytes;
      } else if (e.source === 'network') {
        t.networkBytes += e.bytes; // a rejected response still crossed the network
      }
      t.bySource[e.source]++;
      t.retries += e.retries;
      t.sumMs += e.durationMs;
      const end = e.at + e.durationMs;
      t.firstAt = t.firstAt ? Math.min(t.firstAt, e.at) : e.at;
      t.lastEndAt = Math.max(t.lastEndAt, end);
      t.wallMs = t.lastEndAt - t.firstAt;
      if (e.cachedAt) {
        t.oldestCachedAt = t.oldestCachedAt ? Math.min(t.oldestCachedAt, e.cachedAt) : e.cachedAt;
        t.newestCachedAt = Math.max(t.newestCachedAt, e.cachedAt);
      }
      if (e.source === 'network' && e.ok) t.newestNetworkAt = Math.max(t.newestNetworkAt, e.at);
    }
    let m = this.ends.get(e.tag);
    if (!m) this.ends.set(e.tag, (m = new Map()));
    const k = `${e.host}${pathPattern(e.path)}`;
    let ep = m.get(k);
    if (!ep) {
      if (m.size >= 40) return; // bounded: a pathological caller cannot grow it
      m.set(k, (ep = { host: e.host, path: pathPattern(e.path), requests: 0, bytes: 0 }));
    }
    ep.requests++;
    if (e.ok) ep.bytes += e.bytes;
  }

  /** Totals of one tag, or of everything when omitted. A tag with no requests gives all zeros. */
  totals(tag?: string): LedgerTotals {
    try {
      const t = this.agg.get(tag ?? '*');
      return t ? { ...t, bySource: { ...t.bySource } } : zeroTotals();
    } catch {
      return zeroTotals();
    }
  }

  /** Note that this build stored `bytes` in the app's storage (a cache entry) for `tag`. Never throws. */
  stored(tag: string, bytes: number): void {
    try {
      if (!(bytes > 0)) return;
      for (const key of [tag || 'other', '*']) {
        let t = this.agg.get(key);
        if (!t) this.agg.set(key, (t = zeroTotals()));
        t.storedBytes += Math.round(bytes);
      }
    } catch {
      this.swallowed++;
    }
  }

  /** Distinct services/files a tag used, biggest first. */
  endpoints(tag: string): LedgerEndpoint[] {
    try {
      return [...(this.ends.get(tag)?.values() ?? [])].map((e) => ({ ...e })).sort((a, b) => b.bytes - a.bytes || a.host.localeCompare(b.host) || a.path.localeCompare(b.path));
    } catch {
      return [];
    }
  }

  /** The kept requests (newest last), of one tag or all. */
  entries(tag?: string): readonly LedgerEntry[] {
    try {
      return tag === undefined ? this.list.slice() : this.list.filter((e) => e.tag === tag);
    } catch {
      return [];
    }
  }

  /** Tags seen, in first-seen order. */
  tags(): string[] {
    try {
      return [...this.agg.keys()].filter((k) => k !== '*');
    } catch {
      return [];
    }
  }

  /** Forget everything. */
  clear(): void {
    this.list = [];
    this.agg.clear();
    this.ends.clear();
    this.seq = 0;
  }
}

/**
 * Record a stored/bundled/pack read on an optional trace in one line; safe when the trace is missing.
 * (`bytes` is the stored size; a stored copy passes `cachedAt`).
 */
export function traceRead(trace: TraceOptions | undefined, source: Exclude<LedgerSource, 'network'>, where: { url?: string; host?: string; path?: string }, bytes: number, extra: { cachedAt?: number; durationMs?: number; at?: number } = {}): void {
  try {
    if (!trace?.ledger) return;
    trace.ledger.record({ tag: trace.tag ?? 'other', ...where, source, bytes, bodyBytes: bytes, ...(trace.note ? { note: trace.note } : {}), ...extra });
  } catch {
    /* never throws */
  }
}

/** Trace options merged from a base and an override (the override wins). */
export function withTrace(base: TraceOptions | undefined, over: Partial<TraceOptions>): TraceOptions {
  return { ...(base ?? {}), ...over };
}

/** The request-option fields of a trace ({ tag, ledger, note }), for spreading into a RequestOptions / CachedFetchOptions. */
export const traceFields = (t: TraceOptions | undefined): { tag?: string; ledger?: DatasetLedger; note?: string } => ({
  ...(t?.tag ? { tag: t.tag } : {}),
  ...(t?.ledger ? { ledger: t.ledger } : {}),
  ...(t?.note ? { note: t.note } : {}),
});
