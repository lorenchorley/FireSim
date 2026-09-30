/**
 * Regressions from the independent data-set truth audit (2026-09-30): each figure of the records is checked against a
 * ground truth measured WITHOUT the app's ledger or record helpers (file sizes on disk, an independent typed-array walk
 * of the built scenario and of the copy the worker receives, the replay files), plus the loader and labelling fixes
 * the audit made:
 *  - memory: the fire-history record measures the scenario's fire-record index (it used to repeat four fuel arrays
 *    already counted under the fuel map), so the record total equals the scenario's real memory, main + worker;
 *  - working memory: the worker's copy leaves out the places context (sim/client.ts withoutContext) and the engine's
 *    two fuel copies are measured from the scenario's fuel map (the per-cell model under-read a built map by 10 %);
 *  - the bundle record counts every demo file read (the aerial photo too) and every file (terrain tiles one by one);
 *  - "as published" resolutions are the providers' (5 m DEM, zoom-15 photo tiles), not the bundled copies';
 *  - a single bundled file keeps its real name on the endpoint list (no '{n}' in 'grose-2019-12-19.json');
 *  - offline, a stored full forecast wins over a stored pressure-level-only answer, whose levels are merged in;
 *  - the daily archive (no model asked) is not called ERA5.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { datasetIssues, findDataset, type DatasetRecord } from '../core/datasets';
import type { ScenarioData } from '../core/types';
import { withoutContext } from '../sim/client';
import { DatasetLedger } from '../data';
import { buildScenario } from './build';
import { originOf } from './datasetRecords';
import { forecastUrl, levelFallbackUrl, type OpenMeteoResponse } from './openMeteo';
import { WEATHER_PRESETS } from './presets';
import { BLACKHEATH, fakeNswServer } from '../data/nswContextTesting';
import { fixture, KATOOMBA_NOW, KATOOMBA_NOW_ROUTES, withFakeNetwork, type FakeRoute } from './testing';
import { omCacheKey, resolveWeather } from './weatherSources';

const KAT = { lat: -33.715, lon: 150.285 };
const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));

/** Independent typed-array walk: each ArrayBuffer counted once. */
function arrayBytes(root: unknown): number {
  const seen = new Set<unknown>();
  const visited = new Set<unknown>();
  const stack: unknown[] = [root];
  let n = 0;
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object') continue;
    if (ArrayBuffer.isView(v)) {
      if (!seen.has(v.buffer)) (seen.add(v.buffer), (n += v.buffer.byteLength));
      continue;
    }
    if (visited.has(v)) continue;
    visited.add(v);
    for (const x of Array.isArray(v) ? v : Object.values(v)) stack.push(x);
  }
  return n;
}

const rec = (s: ScenarioData, id: string): DatasetRecord => {
  const r = findDataset(s.datasets, id);
  if (!r) throw new Error(`no record '${id}'`);
  return r;
};
const fileSize = (rel: string): number => statSync(`${PUBLIC}${rel}`).size;
const dirFiles = (rel: string): string[] => readdirSync(`${PUBLIC}${rel}`, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => `${d.parentPath ?? (d as { path?: string }).path}/${d.name}`);

async function offline(req: Parameters<typeof buildScenario>[0], setup?: (kv: ReturnType<typeof withFakeNetwork>['kv']) => Promise<void>): Promise<ScenarioData> {
  const n = withFakeNetwork([]);
  try {
    await setup?.(n.kv);
    const s = await buildScenario(req);
    expect(n.calls).toEqual([]);
    return s;
  } finally {
    n.restore();
  }
}

describe('audit: Katoomba bundled build against ground truth', async () => {
  const start = WEATHER_PRESETS['hot-nw-sw-change'].canonicalStart(KAT.lon, 2026);
  const s = await offline({ centre: KAT, extent: 9000, demoSiteId: 'katoomba', weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start }, duration: 4 * 3600, online: false });

  it('record memory adds up to the scenario held twice (main + worker copy without the places)', () => {
    const main = arrayBytes(s);
    const worker = arrayBytes(structuredClone(withoutContext(s)));
    expect(worker).toBeLessThan(main); // the places are not sent
    expect(s.datasetSummary!.totals.memoryBytes).toBe(main + worker);
    expect(rec(s, 'fire-history').sizes.memoryBytes).toBe(2 * arrayBytes(s.fuelHistory));
    expect(rec(s, 'fuel-derived').sizes.memoryBytes).toBe(2 * arrayBytes(s.fuel));
    expect(rec(s, 'terrain').sizes.memoryBytes).toBe(2 * (arrayBytes(s.terrain) + arrayBytes(s.terrainHiRes)));
    expect(rec(s, 'place-names').sizes.memoryBytes).toBeUndefined(); // plain objects: not measured, not "0 B"
  });

  it('working memory: the worker copy and the fuel copies are the measured bytes', () => {
    const wm = s.datasetSummary!.workingMemory!;
    const item = (id: string): number => wm.items.find((x) => x.id === id)!.bytes;
    expect(item('scenario-main')).toBe(arrayBytes(s));
    expect(item('scenario-worker')).toBe(arrayBytes(structuredClone(withoutContext(s))));
    expect(item('fuel')).toBe(2 * arrayBytes(s.fuel));
    expect(wm.totalBytes).toBe(wm.mainBytes + wm.workerBytes + wm.gpuBytes);
  });

  it('bytes read equal the files on disk; the bundle record counts them all', () => {
    const files = ['dem5m.png', 'dem5m.json', 'imagery.jpg', 'imagery.json', 'vegetation.geojson', 'canopy.png', 'canopy.json', 'fire-history.geojson', 'context.json'];
    const read = files.reduce((a, f) => a + fileSize(`demo/katoomba/${f}`), 0);
    expect(s.datasetSummary!.totals.transferredBytes).toBe(read);
    const b = rec(s, 'bundled-site');
    const stat = (label: string): string => b.stats.find((x) => x.label === label)!.value;
    const all = dirFiles('demo/katoomba');
    expect(stat('Files')).toBe(String(all.length));
    expect(stat('Whole bundle for the site')).toBe(`${(all.reduce((a, f) => a + statSync(f).size, 0) / 1e6).toFixed(1)} MB`);
    expect(stat('Read for this scenario')).toBe(`${(read / 1e6).toFixed(1)} MB`);
  });

  it('"as published" is the provider’s resolution, not the bundled copy’s', () => {
    const t = rec(s, 'terrain');
    expect(t.native).toMatchObject({ resolutionM: 5 });
    expect(t.native?.width).toBeUndefined();
    const im = rec(s, 'imagery');
    // Zoom-15 Web Mercator pixels at -33.7°: 40 075 016.7 m x cos(lat) / 2^23.
    expect(im.native?.resolutionM).toBeCloseTo((40_075_016.686 * Math.cos((KAT.lat * Math.PI) / 180)) / 2 ** 23, 1);
    expect(im.model?.resolutionM).toBe(8);
  });

  it('the grids and the weather in the records are the scenario’s own', () => {
    const g = s.terrain.grid;
    expect(rec(s, 'terrain').model).toMatchObject({ width: g.nx, height: g.ny, resolutionM: g.cellSize });
    expect(rec(s, 'weather').native?.records).toBe(s.weather.hours.length);
    expect(datasetIssues(s.datasets!)).toEqual([]);
  });
});

describe('audit: replay and far-away builds', () => {
  it('a replay names its bundled weather files exactly and counts them', async () => {
    const s = await offline({ centre: { lat: 0, lon: 0 }, extent: 9000, weather: { kind: 'replay', replayId: 'grose-2019-12-19' }, duration: 4 * 3600, online: false });
    expect(rec(s, 'weather').endpoints).toEqual([{ host: 'bundled', path: '/replays/grose-2019-12-19.json', requests: 1 }]);
    expect(rec(s, 'weather').sizes.transferredBytes).toBe(fileSize('replays/grose-2019-12-19.json'));
    expect(rec(s, 'drought-history').sizes.transferredBytes).toBe(fileSize('replays/grose-2019-12-19-daily365.json'));
    expect(rec(s, 'drought-history').native?.records).toBe(s.weather.daily!.length);
    // The daily archive file was fetched without naming a model: it is not claimed to be ERA5.
    expect(JSON.stringify(rec(s, 'drought-history'))).not.toMatch(/ERA5 reanalysis daily|Grid point of the ERA5/);
    expect(rec(s, 'fire-history').sizes.memoryBytes).toBe(2 * arrayBytes(s.fuelHistory));
  });

  it('away from the demo sites no bundled photo metadata is read', async () => {
    const start = WEATHER_PRESETS['hot-nw-sw-change'].canonicalStart(149, 2026);
    const s = await offline({ centre: { lat: -32.5, lon: 149 }, extent: 6000, weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start }, duration: 3 * 3600, online: false });
    expect(rec(s, 'imagery').sizes).toMatchObject({ requests: 0, transferredBytes: 0 });
    expect(s.datasetSummary!.totals.requests).toBe(0);
    expect(s.datasetSummary!.totals.memoryBytes).toBe(arrayBytes(s) + arrayBytes(structuredClone(withoutContext(s))));
  });
});

describe('audit: offline weather from stored copies', () => {
  it('a stored full forecast wins over a later pressure-level-only answer; its levels are merged in', async () => {
    const fc = fixture<OpenMeteoResponse>('openmeteo-forecast-katoomba.json');
    const full: OpenMeteoResponse = { ...fc, hourly: Object.fromEntries(Object.entries(fc.hourly!).filter(([k]) => !k.endsWith('hPa'))) } as OpenMeteoResponse;
    const keep = new Set(['time', 'temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m']);
    const prof: OpenMeteoResponse = { ...fc, hourly: Object.fromEntries(Object.entries(fc.hourly!).filter(([k]) => keep.has(k) || k.endsWith('hPa'))) } as OpenMeteoResponse;
    const uFull = forecastUrl(KAT, { model: 'ecmwf_ifs' });
    const uProf = levelFallbackUrl(KAT, 'ecmwf_ifs025', {});
    const t = KATOOMBA_NOW - 2 * 3.6e6;
    const s = await offline({ centre: KAT, extent: 6000, demoSiteId: 'katoomba', weather: { kind: 'now' }, duration: 3 * 3600, online: false, now: KATOOMBA_NOW }, async (kv) => {
      await kv.put(omCacheKey(uFull), { t, url: uFull, v: full, n: 60_000 });
      await kv.put(omCacheKey(uProf), { t: t + 5, url: uProf, v: prof, n: 40_000 }); // stored last
    });
    const w = rec(s, 'weather');
    expect(w.origin).toBe('cache');
    expect(w.stats.find((x) => x.label === 'Model')!.value).toBe('ECMWF IFS');
    expect(w.sizes).toMatchObject({ transferredBytes: 60_000, cachedBytes: 60_000, networkBytes: 0 });
    expect(s.weather.hours.some((h) => h.cloudCover !== undefined)).toBe(true); // the full forecast, not the 4-variable profile
    expect(s.weather.upperAirSource).toBe('model');
    const u = rec(s, 'upper-air');
    expect(u).toMatchObject({ status: 'used', origin: 'cache' });
    expect(u.originDetail).toMatch(/ecmwf_ifs025.*stored copy/);
    expect(u.sizes).toMatchObject({ transferredBytes: 40_000, cachedBytes: 40_000, networkBytes: 0, requests: 1 });
  });
});

describe('audit: a live places query that dies half way', () => {
  it('its requests and bytes stay on the records when the bundled file stands in', async () => {
    const tiles = readdirSync(`${PUBLIC}demo/katoomba/terrarium/13/7514`).map((f) => new Uint8Array(readFileSync(`${PUBLIC}demo/katoomba/terrarium/13/7514/${f}`)));
    const routes: FakeRoute[] = [
      { match: ['elevation-tiles-prod/terrarium/14/'], bytes: (url) => tiles[Number(/\/(\d+)\.png/.exec(url)![1]) % tiles.length]! },
      { match: ['SVTM_NSW_Extant_PCT'], status: 500 },
      { match: ['NPWS_Fire_History'], status: 500 },
      ...KATOOMBA_NOW_ROUTES(),
      { match: ['archive-api.open-meteo.com/v1/archive', 'daily='], body: fixture('openmeteo-archive-katoomba-365d.json') },
    ];
    const nsw = fakeNswServer();
    // The object-id queries answer; every feature query then fails, so each layer's live query fails after real bytes.
    const dying = (async (input: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      if (/objectIds=/.test(body) && !/returnIdsOnly=true/.test(body)) throw new TypeError('Failed to fetch');
      return nsw.fetch(input as string, init);
    }) as typeof fetch;
    const n = withFakeNetwork(routes, dying);
    try {
      const s = await buildScenario({ centre: BLACKHEATH, extent: 4500, weather: { kind: 'now' }, duration: 3 * 3600, online: true, now: KATOOMBA_NOW });
      expect(datasetIssues(s.datasets!)).toEqual([]);
      const ids = nsw.calls.filter((c) => c.kind === 'ids').length;
      expect(ids).toBeGreaterThan(0);
      const places = ['roads', 'fire-trails', 'homes', 'zones', 'place-names'].map((id) => rec(s, id));
      // Every request the places query made is on some record, whatever stood in afterwards.
      expect(places.reduce((a, r) => a + r.sizes.requests, 0)).toBeGreaterThanOrEqual(ids);
      for (const r of places) if (r.origin !== 'live') expect(r.sizes.networkBytes).toBeGreaterThanOrEqual(r.sizes.networkUnmeasuredBytes ?? 0);
      expect(places.map((r) => r.origin)).toContain('bundled'); // the bundled Grose file stood in
    } finally {
      n.restore();
    }
  });
});

describe('audit: Open-Meteo daily limit', () => {
  it('a 429 "Daily API request limit exceeded" is not waited out 3 x 60 s', async () => {
    const daily = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('open-meteo.com')) return new Response('{"reason":"Daily API request limit exceeded. Please try again tomorrow.","error":true}', { status: 429 });
      throw new TypeError(`fetch failed (no route): ${url}`);
    }) as typeof fetch;
    const n = withFakeNetwork([], daily);
    const status: string[] = [];
    try {
      const t0 = Date.now();
      const w = await resolveWeather({ kind: 'now' }, { centre: KAT, online: true, now: KATOOMBA_NOW, duration: 3 * 3600, medianElevation: 745, centreElevation: 950, rateLimitBackoffMs: 60_000, onStatus: (m) => status.push(m) });
      expect(Date.now() - t0).toBeLessThan(20_000);
      expect(status.filter((m) => /rate limit/i.test(m))).toEqual([]);
      expect(w.origin).toBe('fallback');
    } finally {
      n.restore();
    }
  });

  it('the rainfall-history fallback says the archive refused and why', async () => {
    const archiveRefuses = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('archive-api.open-meteo.com')) return new Response('{"reason":"Daily API request limit exceeded. Please try again tomorrow.","error":true}', { status: 429 });
      throw new TypeError(`fetch failed (no route): ${url}`);
    }) as typeof fetch;
    const n = withFakeNetwork([KATOOMBA_NOW_ROUTES()[0]!], archiveRefuses);
    try {
      const s = await buildScenario({ centre: KAT, extent: 6000, demoSiteId: 'katoomba', weather: { kind: 'now' }, duration: 3 * 3600, online: true, now: KATOOMBA_NOW });
      const d = rec(s, 'drought-history');
      expect(d.status).toBe('fallback');
      expect(d.fallbackReason).toMatch(/daily request limit was reached \(HTTP 429\)/);
      expect(s.datasetSummary!.fallbacks.find((f) => f.id === 'drought-history')!.reason).toMatch(/HTTP 429/);
      expect(d.sizes.requests).toBeGreaterThanOrEqual(2); // every refused attempt is on the record
    } finally {
      n.restore();
    }
  });
});

describe('audit: live only when a download succeeded', () => {
  it('a failed request answered from a stale stored copy is a stored copy, not live', () => {
    const l = new DatasetLedger();
    l.record({ tag: 'vegetation-svtm', host: 'mapprod3.environment.nsw.gov.au', path: '/q', status: 500, bytes: 30 });
    l.record({ tag: 'vegetation-svtm', host: 'mapprod3.environment.nsw.gov.au', path: '/q', source: 'stale', bytes: 5000, cachedAt: 1 });
    expect(originOf('network', l, ['vegetation-svtm'])).toBe('cache');
    l.record({ tag: 'vegetation-svtm', host: 'mapprod3.environment.nsw.gov.au', path: '/q2', status: 200, bytes: 5000 });
    expect(originOf('network', l, ['vegetation-svtm'])).toBe('live');
  });
});

void readFileSync;
