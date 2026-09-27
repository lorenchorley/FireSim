/**
 * Test helpers of scenario/ (Node only): the bundled live fixtures (tests/fixtures/live) and an injectable fake
 * `fetch` that serves them by URL pattern, so the network paths of the builder run without network access.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMemoryKV, resetHttpConfig, setDefaultCache, setHttpConfig, type KV } from '../data';

const FIXTURES = fileURLToPath(new URL('../../tests/fixtures/live/', import.meta.url));

/** Parsed JSON fixture from tests/fixtures/live/. */
export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(FIXTURES + name, 'utf8')) as T;
}

/** Raw text fixture. */
export function fixtureText(name: string): string {
  return readFileSync(FIXTURES + name, 'utf8');
}

export const REPLAY_IDS = [
  'katoomba-2013-10-16',
  'grose-2019-12-19',
  'gospers-2019-12-19',
  'kanangra-2019-12-17',
  'budawangs-2019-12-30',
  'thredbo-2020-01-02',
  'warrumbungles-2013-01-12',
] as const;

export interface FakeRoute {
  /** Substring(s) that must all occur in the URL. */
  match: string[];
  /** JSON body, text body, or an HTTP status to fail with. */
  body?: unknown;
  text?: string;
  status?: number;
  /** Computed JSON body (e.g. paged responses). */
  handler?: (url: string) => unknown;
}

export interface FakeFetch {
  fetch: typeof fetch;
  calls: string[];
}

/** A fetch that answers the first matching route (unmatched URLs fail like a network error). */
export function fakeFetch(routes: FakeRoute[]): FakeFetch {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const r = routes.find((x) => x.match.every((m) => url.includes(m)));
    if (!r) throw new TypeError(`fetch failed (no route): ${url}`);
    if (r.status && r.status >= 400) return new Response(JSON.stringify({ error: true, reason: 'test' }), { status: r.status });
    if (r.text !== undefined) return new Response(r.text, { status: 200, headers: { 'content-type': 'text/plain' } });
    if (r.handler) return new Response(JSON.stringify(r.handler(url)), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(r.body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

/** Install a fake fetch and a fresh memory cache; returns a restore function. */
export function withFakeNetwork(routes: FakeRoute[]): { calls: string[]; kv: KV; restore: () => void } {
  const ff = fakeFetch(routes);
  const kv = createMemoryKV();
  setDefaultCache(kv);
  setHttpConfig({ fetch: ff.fetch, platform: 'node', retryDelayMs: 1 });
  return {
    calls: ff.calls,
    kv,
    restore: () => {
      resetHttpConfig();
      setDefaultCache(null);
    },
  };
}

/** Katoomba "now" routes: the best_match forecast fixture and the 365-day archive fixture (fetched 2026-09-27). */
export const KATOOMBA_NOW_ROUTES = (): FakeRoute[] => [
  { match: ['api.open-meteo.com/v1/forecast', 'models=best_match'], body: fixture('openmeteo-forecast-katoomba.json') },
  { match: ['archive-api.open-meteo.com/v1/archive', 'daily=', 'end_date=2026-09-26'], body: fixture('openmeteo-archive-katoomba-365d.json') },
];

/** 2026-09-27 12:00 AEST, the fixtures' fetch day. */
export const KATOOMBA_NOW = Date.UTC(2026, 8, 27, 2, 0);
