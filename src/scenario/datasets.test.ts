/**
 * The data-set inventory of complete headless builds (P6): the bundled Katoomba demo, an online-style build for a
 * non-demo place on a fake network (Blackheath: terrain tiles, SVTM, NPWS, Open-Meteo and the NSW context services
 * all faked with real recorded bodies), the same place again from the stored copies seven hours later (stale weather),
 * and a synthetic offline build away from the demo sites. Checks each loader's record against what the fake served
 * (bytes, requests, origins, dates), the summary totals, the exports and the truthfulness fixes (fuel sources, the
 * attribution list).
 *
 * With WRITE_FIXTURES=1 it (re)writes tests/fixtures/datasets/katoomba-bundled.json and offline-synthetic.json, the UI
 * builders' mock data (the live one is written by datasets.live.test.ts).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  creditLines,
  datasetIssues,
  datasetsToCsv,
  datasetsToJson,
  datasetsToText,
  findDataset,
  imageryCredit,
  sortDatasets,
  type DatasetRecord,
} from '../core/datasets';
import type { ScenarioData } from '../core/types';
import { makeGridSpec } from '../core/grid';
import { saveAreaPack, syntheticElevation } from '../data';
import { BLACKHEATH, fakeNswServer } from '../data/nswContextTesting';
import { ATTRIBUTIONS } from '../ui/content';
import { buildScenario } from './build';
import { day, dayUtc } from './recordKit';
import { WEATHER_PRESETS } from './presets';
import type { ScenarioRequest } from './request';
import { fixture, KATOOMBA_NOW, KATOOMBA_NOW_ROUTES, withFakeNetwork, type FakeRoute } from './testing';

const KAT = { lat: -33.715, lon: 150.285 };
const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const OUT = fileURLToPath(new URL('../../tests/fixtures/datasets/', import.meta.url));
const rec = (s: ScenarioData, id: string): DatasetRecord => {
  const r = findDataset(s.datasets, id);
  if (!r) throw new Error(`no record '${id}' (have ${s.datasets?.map((x) => x.id).join(', ')})`);
  return r;
};

/** Everything a record set must satisfy, whatever the scenario. */
function checkInventory(s: ScenarioData): void {
  const ds = s.datasets!;
  const sum = s.datasetSummary!;
  expect(ds.length).toBeGreaterThanOrEqual(14);
  expect(datasetIssues(ds)).toEqual([]);
  expect(ds.map((r) => r.id)).toEqual(sortDatasets(ds).map((r) => r.id));
  for (const id of ['terrain', 'imagery', 'vegetation-svtm', 'canopy-height', 'fire-history', 'fuel-derived', 'weather', 'upper-air', 'drought-history', 'roads', 'fire-trails', 'homes', 'zones', 'place-names', 'user-edits']) rec(s, id);
  // Totals are the sums of the records.
  expect(sum.totals.count).toBe(ds.length);
  expect(sum.totals.transferredBytes).toBe(ds.reduce((a, r) => a + r.sizes.transferredBytes, 0));
  expect(sum.totals.networkBytes).toBe(ds.reduce((a, r) => a + r.sizes.networkBytes, 0));
  expect(sum.totals.requests).toBe(ds.reduce((a, r) => a + r.sizes.requests, 0));
  const shares = Object.values(sum.totals.cellShareByOrigin).reduce((a, v) => a + v!, 0);
  expect(shares).toBeCloseTo(1, 4);
  // The model's real grid.
  expect(sum.model).toMatchObject({ nx: s.terrain.grid.nx, ny: s.terrain.grid.ny, cellSizeM: s.terrain.grid.cellSize, extentM: s.extent });
  expect(sum.reproduce).toMatchObject({ scenarioId: s.id, seed: s.options.seed, cellSizeM: s.terrain.grid.cellSize });
  expect(sum.workingMemory!.cells).toBe(s.terrain.grid.nx * s.terrain.grid.ny);
  expect(sum.workingMemory!.totalBytes).toBeGreaterThan(0);
  // Every substitute is explained in the summary.
  for (const r of ds) if (r.status === 'fallback' || r.status === 'unavailable' || r.status === 'partial') expect(sum.fallbacks.map((f) => f.id)).toContain(r.id);
  // Exports: stable, complete, no undefined/NaN text.
  const json = datasetsToJson(ds, sum);
  expect(datasetsToJson(ds, sum)).toBe(json);
  expect(JSON.parse(json).datasets).toHaveLength(ds.length);
  const csv = datasetsToCsv(ds);
  const lines = csv.trimEnd().split('\r\n');
  expect(lines).toHaveLength(ds.length + 1);
  const txt = datasetsToText(ds, sum);
  for (const t of [json, csv, datasetsToCsv(ds, { stats: true }), txt]) expect(t).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b/);
  for (const r of ds) expect(txt).toContain(r.title);
  // Plain JSON: structured-clone safe, no typed arrays.
  expect(JSON.stringify(ds)).toBe(JSON.stringify(JSON.parse(JSON.stringify(ds))));
  // Every credit line the scenario shows is in Settings → Data and licences.
  const shown = ATTRIBUTIONS.map((a) => `${a.name} ${a.use} ${a.licence} ${a.attribution ?? ''}`).join('\n');
  for (const line of creditLines(ds)) expect(shown, line).toContain(line);
}

function writeFixture(name: string, s: ScenarioData): void {
  if (!process.env.WRITE_FIXTURES) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}${name}`, datasetsToJson(s.datasets!, s.datasetSummary));
}

afterEach(() => void 0);

describe('Katoomba, bundled demo site, offline', () => {
  let s: ScenarioData;
  beforeAll(async () => {
    const n = withFakeNetwork([]);
    try {
      const start = WEATHER_PRESETS['hot-nw-sw-change'].canonicalStart(KAT.lon, 2026);
      s = await buildScenario({ centre: KAT, extent: 9000, demoSiteId: 'katoomba', weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start }, duration: 4 * 3600, online: false });
      expect(n.calls).toEqual([]);
    } finally {
      n.restore();
    }
  }, 120_000);

  it('a complete, consistent inventory', () => {
    checkInventory(s);
    writeFixture('katoomba-bundled.json', s);
  });

  it('bundled files with their real sizes and capture dates; nothing over the network', () => {
    const t = rec(s, 'terrain');
    const png = readFileSync(`${PUBLIC}demo/katoomba/dem5m.png`).byteLength;
    const json = readFileSync(`${PUBLIC}demo/katoomba/dem5m.json`).byteLength;
    expect(t).toMatchObject({ origin: 'bundled', status: 'used', originDetail: "Bundled demo site 'katoomba'" });
    expect(t.sizes.transferredBytes).toBe(png + json);
    expect(t.sizes.networkBytes).toBe(0);
    expect(t.vintage).toMatchObject({ retrievedBasis: 'bundle-capture' });
    expect(new Date(t.vintage.retrievedAt).toISOString().slice(0, 10)).toMatch(/^2026-09-2\d$/);
    expect(t.native?.resolutionM).toBe(5);
    expect(t.model).toMatchObject({ resolutionM: 30, width: 300, height: 300, resampling: 'block-average' });
    expect(t.stats.find((x) => x.label === 'Relief (highest minus lowest)')!.raw).toBeGreaterThan(700);
    expect(s.datasetSummary!.totals.networkBytes).toBe(0);
    const bundle = rec(s, 'bundled-site');
    expect(bundle.stats.find((x) => /Whole bundle/.test(x.label))!.value).toMatch(/MB/);
  });

  it('imagery carries its credit and capture text; vegetation is partly inferred; fire history current to its VerDate', () => {
    const im = rec(s, 'imagery');
    expect(im.origin).toBe('bundled');
    expect(im.attribution).toMatch(/Spatial Services/);
    expect(im.vintage.captureSummary).toMatch(/several capture dates/);
    expect(imageryCredit(s.datasets)).toMatch(/^Aerial photo © State of New South Wales.*mosaic of several capture dates/);
    const v = rec(s, 'vegetation-svtm');
    expect(v.status).toBe('partial');
    expect(v.coverage.fraction).toBeGreaterThan(0.7);
    expect(v.coverage.fraction).toBeLessThan(1);
    expect(v.vintage.versionNote).toMatch(/not read from the service/);
    const fh = rec(s, 'fire-history');
    expect(fh.vintage.currentTo).toBe('2026-09-07');
    expect(fh.distribution?.values.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    expect(rec(s, 'weather')).toMatchObject({ origin: 'preset', status: 'used' });
    expect(rec(s, 'upper-air').what).toMatch(/850, 700 and 500 hPa/);
    expect(rec(s, 'roads').stats.find((x) => x.label === 'Total length')!.raw).toBeGreaterThan(100);
    expect(rec(s, 'user-edits').status).toBe('skipped');
  });
});

describe('a non-demo place online (fake network), then its stored copies offline', () => {
  const tileBytes = readdirSync(`${PUBLIC}demo/katoomba/terrarium/13/7514`).map((f) => new Uint8Array(readFileSync(`${PUBLIC}demo/katoomba/terrarium/13/7514/${f}`)));
  const veg = fixtureFile('demo/katoomba/vegetation.geojson');
  const fire = fixtureFile('demo/katoomba/fire-history.geojson');
  const served = new Map<string, number>();
  const page = (body: { features: unknown[] }) => (url: string) => {
    const off = Number(/resultOffset=(\d+)/.exec(url)?.[1] ?? 0);
    const out = { type: 'FeatureCollection', features: body.features.slice(off, off + 1000) };
    served.set(url, JSON.stringify(out).length);
    return out;
  };
  const routes = (): FakeRoute[] => [
    { match: ['elevation-tiles-prod/terrarium/14/'], bytes: (url) => tileBytes[Number(/\/(\d+)\.png/.exec(url)![1]) % tileBytes.length]! },
    { match: ['SVTM_NSW_Extant_PCT/MapServer/3/query'], handler: page(veg) },
    { match: ['NPWS_Fire_History/MapServer/0/query'], handler: page(fire) },
    ...KATOOMBA_NOW_ROUTES(),
    { match: ['archive-api.open-meteo.com/v1/archive', 'daily='], body: fixture('openmeteo-archive-katoomba-365d.json') },
  ];
  const req: ScenarioRequest = { name: 'Blackheath (fake network)', centre: BLACKHEATH, extent: 4500, weather: { kind: 'now' }, duration: 4 * 3600, online: true, now: KATOOMBA_NOW };
  let live: ScenarioData;
  let stored: ScenarioData;
  let tileCalls = 0;
  beforeAll(async () => {
    const nsw = fakeNswServer();
    const n = withFakeNetwork(routes(), nsw.fetch);
    // The cache stamps its copies with the clock (Date.now), and the recorded forecast covers days around KATOOMBA_NOW:
    // the clock is set to that moment for the live build so the test does not depend on the day it is run.
    vi.useFakeTimers({ toFake: ['Date'], now: KATOOMBA_NOW });
    try {
      live = await buildScenario(req);
      tileCalls = n.calls.filter((u) => u.includes('terrarium/14/')).length;
      // Seven hours later, no signal: everything from the stored copies; the forecast is now stale (> 6 h).
      vi.setSystemTime(KATOOMBA_NOW + 7 * 3600e3);
      stored = await buildScenario({ ...req, online: false, now: KATOOMBA_NOW + 7 * 3600e3 });
    } finally {
      vi.useRealTimers();
      n.restore();
    }
  }, 180_000);

  it('complete inventories for both builds', () => {
    checkInventory(live);
    checkInventory(stored);
  });

  it('terrain: live tiles, bytes and requests exactly as served, stored on the device', () => {
    const t = rec(live, 'terrain');
    expect(t.origin).toBe('live');
    // Tile downloads, plus small bundled reads (the demo-tile manifests of nearby sites) under the same data set.
    expect(t.sizes.tiles).toBe(tileCalls);
    expect(t.endpoints.find((e) => e.host === 's3.amazonaws.com')!.requests).toBe(tileCalls);
    expect(t.sizes.requests).toBeGreaterThanOrEqual(tileCalls);
    expect(t.sizes.networkBytes).toBeGreaterThan(tileCalls * 20_000);
    expect(t.sizes.storedOnDeviceBytes).toBe(t.sizes.networkBytes);
    expect(t.endpoints[0]).toMatchObject({ host: 's3.amazonaws.com', path: '/elevation-tiles-prod/terrarium/14/{n}/{n}.png' });
    expect(t.vintage.retrievedBasis).toBe('this-build');
    // The SRTM heights are about 30 m apart; the 8 m pixel pitch of the zoom-14 tiles and the 10 m grid of the view are not their resolution.
    expect(t.native?.resolutionM).toBe(30);
    expect(t.native?.note).toMatch(/interpolated from them: finer pixels, no extra detail/);
    expect(t.model?.note).toMatch(/interpolated from 30 m satellite heights/);
    const again = rec(stored, 'terrain');
    expect(again.origin).toBe('cache');
    expect(again.sizes.networkBytes).toBe(0);
    expect(again.sizes.cachedBytes).toBeGreaterThan(0);
    expect(again.vintage.retrievedBasis).toBe('stored-copy');
  });

  it('vegetation and fire history: live ArcGIS pages, the served bytes, then the stored copy', () => {
    const v = rec(live, 'vegetation-svtm');
    expect(v.origin).toBe('live');
    const vegServed = [...served.entries()].filter(([u]) => u.includes('SVTM')).reduce((a, [, b]) => a + b, 0);
    expect(v.sizes.networkBytes).toBe(vegServed);
    expect(v.sizes.requests).toBe([...served.keys()].filter((u) => u.includes('SVTM')).length);
    expect(v.endpoints[0]!.host).toBe('mapprod3.environment.nsw.gov.au');
    expect(rec(live, 'fire-history').origin).toBe('live');
    expect(rec(stored, 'vegetation-svtm').origin).toBe('cache');
    expect(rec(stored, 'fire-history').origin).toBe('cache');
  });

  it('weather: live forecast with its download time, model wording and the 6 h staleness rule', () => {
    const w = rec(live, 'weather');
    expect(w.origin).toBe('live');
    expect(w.vintage).toMatchObject({ retrievedBasis: 'this-build', staleAfterHours: 6 });
    expect(w.vintage.stale).toBeUndefined();
    expect(w.endpoints.map((e) => `${e.host}${e.path}`)).toContain('api.open-meteo.com/v1/forecast');
    expect(w.stats.find((x) => x.label === 'Model')!.value).toBe("Open-Meteo 'best match'");
    // The download date agrees with the times the screens show (New South Wales time), not the UTC date.
    expect(w.stats.find((x) => x.label === 'Downloaded')!.value).toMatch(new RegExp(`^${day(w.vintage.retrievedAt)} \\(`));
    expect(JSON.stringify(w)).not.toMatch(/ACCESS-G/);
    expect(rec(live, 'upper-air').origin).toBe('live');
    expect(rec(live, 'drought-history').origin).toBe('live');
    const old = rec(stored, 'weather');
    expect(old.origin).toBe('cache');
    expect(old.vintage.stale).toBe(true);
    expect(old.vintage.ageHoursAtBuild).toBeGreaterThanOrEqual(7);
    expect(old.warnings.join(' ')).toMatch(/older than 6 h/);
    expect(stored.datasetSummary!.fallbacks.map((f) => f.id)).toContain('weather');
  });

  it('places: live NSW services, no query string or token in any endpoint', () => {
    const roads = rec(live, 'roads');
    expect(roads.origin).toBe('live');
    expect(roads.sizes.networkBytes).toBeGreaterThan(0);
    for (const r of [...live.datasets!, ...stored.datasets!]) for (const e of [...r.endpoints, ...r.sourceServices]) expect(`${e.host}${e.path}`).not.toMatch(/[?&=#]|token|key=/i);
    expect(live.datasetSummary!.totals.storedBytes).toBeGreaterThan(0);
  });
});

describe('a 4 km area inside the 9 km demo square: the places figures are for the model area, and the fuel map says what it is made of', () => {
  let s: ScenarioData;
  beforeAll(async () => {
    const n = withFakeNetwork([]);
    try {
      const start = WEATHER_PRESETS['hot-nw-sw-change'].canonicalStart(KAT.lon, 2026);
      s = await buildScenario({ centre: KAT, extent: 4000, demoSiteId: 'katoomba', weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start }, duration: 2 * 3600, online: false });
    } finally {
      n.restore();
    }
  }, 120_000);

  it('roads, trails, homes, zones and names: counted and measured inside the 4 km square, with the loaded file as published', () => {
    const file = JSON.parse(readFileSync(`${PUBLIC}demo/katoomba/context.json`, 'utf8')) as { roads: unknown[]; homes: number[]; zones: unknown[]; places: unknown[] };
    const roads = rec(s, 'roads');
    const inside = Number(roads.stats.find((x) => x.label === 'Road and track segments')!.raw);
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(file.roads.length);
    expect(roads.native?.features).toBe(file.roads.length); // as loaded: the whole file
    expect(roads.model?.features).toBe(inside);
    expect(roads.coverage.fraction).toBe(1);
    const homes = rec(s, 'homes');
    expect(Number(homes.stats.find((x) => x.label === 'Home address points')!.raw)).toBeLessThan(file.homes.length / 2);
    // Zoned land cannot exceed the model area (16 km²); in the 9.8 km file there is more than 70 km².
    const zoned = Number(rec(s, 'zones').stats.find((x) => x.label === 'Total area')!.raw);
    expect(zoned).toBeGreaterThan(0);
    expect(zoned).toBeLessThanOrEqual(16);
  });

  it('the fuel map names its inputs honestly: a designed drought is not "real data"', () => {
    const fuel = rec(s, 'fuel-derived');
    const note = (label: string): string | undefined => fuel.parts!.find((p) => p.label === label)?.note;
    expect(note('Ground height')).toBe('real data');
    expect(note('Rainfall history and drought')).toBe('designed by the app, not real data');
    expect(fuel.coverage.note).toMatch(/Every cell has a value/);
  });
});

describe('record dates are New South Wales days', () => {
  it('06:12 on 5 October (AEDT) is the 5th, though it is still the 4th in UTC', () => {
    const ms = Date.UTC(2026, 9, 4, 19, 12);
    expect(day(ms)).toBe('2026-10-05');
    expect(dayUtc(ms)).toBe('2026-10-04');
    expect(day(Date.UTC(2026, 5, 30, 14, 30))).toBe('2026-07-01'); // AEST (UTC+10) in winter
    expect(day(0)).toBe('');
  });
});

describe('a saved area pack, offline', () => {
  it('the pack is reported with its size and contents; its items are the origins of the data sets', async () => {
    const n = withFakeNetwork([]);
    try {
      const centre = { lat: -35.2, lon: 148.8 };
      const g10 = makeGridSpec(centre, 7000, 10);
      const fc = fixture<{ latitude: number; longitude: number }>('openmeteo-forecast-katoomba.json');
      const { parseOpenMeteoDaily } = await import('./openMeteo');
      await saveAreaPack(
        {
          id: 'snowy',
          name: 'Snowy camp',
          centre,
          extent: 7000,
          createdAt: KATOOMBA_NOW - 3.6e6,
          items: {
            dem10: { grid: g10, elevation: syntheticElevation(g10, 'ridges', 3), source: 'AWS Terrain Tiles (Terrarium, SRTM 1″ ≈ 30 m), zoom 14, 20 tiles: 20 downloaded' },
            weather: { ...fc, latitude: centre.lat, longitude: centre.lon },
            daily: { daily: parseOpenMeteoDaily(fixture('openmeteo-archive-katoomba-365d.json')), annualRainfall: 900, fetchedAt: KATOOMBA_NOW },
          },
        },
        n.kv,
      );
      const s = await buildScenario({ centre, extent: 6000, weather: { kind: 'now' }, duration: 4 * 3600, online: false, now: KATOOMBA_NOW });
      checkInventory(s);
      expect(rec(s, 'terrain')).toMatchObject({ origin: 'area-pack', originDetail: "Area pack 'Snowy camp'" });
      expect(rec(s, 'terrain').sizes.cachedBytes).toBeGreaterThan(1_000_000);
      expect(rec(s, 'weather').origin).toBe('area-pack');
      expect(rec(s, 'drought-history').origin).toBe('area-pack');
      const p = rec(s, 'area-pack');
      expect(p).toMatchObject({ role: 'pack', origin: 'area-pack', status: 'used' });
      expect(p.parts!.map((x) => x.label)).toEqual(expect.arrayContaining(['Snowy camp: ground height (10 m)', 'Snowy camp: weather forecast', 'Snowy camp: rainfall history']));
      expect(p.sizes.storedOnDeviceBytes).toBeGreaterThan(1_000_000);
      expect(p.stats.find((x) => x.label === "Pack 'Snowy camp' holds")!.value).toMatch(/ground height/);
    } finally {
      n.restore();
    }
  }, 120_000);
});

describe('away from the demo sites, offline: every substitute says so', () => {
  let s: ScenarioData;
  beforeAll(async () => {
    const n = withFakeNetwork([]);
    try {
      s = await buildScenario({ name: 'Somewhere offline', centre: { lat: -34.4, lon: 150.0 }, extent: 6000, weather: { kind: 'now' }, duration: 3 * 3600, online: false, now: KATOOMBA_NOW });
    } finally {
      n.restore();
    }
  }, 120_000);

  it('a complete inventory of substitutes', () => {
    checkInventory(s);
    writeFixture('offline-synthetic.json', s);
    expect(rec(s, 'terrain')).toMatchObject({ status: 'fallback', origin: 'synthetic' });
    expect(rec(s, 'terrain').fallbackReason).toBeTruthy();
    expect(rec(s, 'vegetation-svtm').status).toBe('fallback');
    expect(rec(s, 'fire-history').status).toBe('unavailable');
    expect(rec(s, 'weather')).toMatchObject({ status: 'fallback', origin: 'preset' });
    expect(rec(s, 'imagery').status).toBe('unavailable');
    expect(rec(s, 'roads').status).toBe('unavailable');
    expect(s.datasetSummary!.totals.networkBytes).toBe(0);
    expect(s.datasetSummary!.totals.cellShareByOrigin.synthetic).toBeGreaterThan(0);
    expect(creditLines(s.datasets)).toEqual([]);
  });

  it('the fuel sources never claim a fire history that is not there (survey item 8)', () => {
    expect(s.fuel.sources.join(' | ')).not.toMatch(/NPWS Fire History(?! \(|: unavailable)/);
    expect(s.fuel.sources).toContain('No fire history: steady-state fuel assumed');
  });
});

function fixtureFile(p: string): { features: unknown[] } {
  return JSON.parse(readFileSync(`${PUBLIC}${p}`, 'utf8')) as { features: unknown[] };
}

describe('the committed fixtures (mock data of the UI builders)', () => {
  for (const name of ['katoomba-bundled', 'live-nondemo', 'offline-synthetic']) {
    it(`${name}.json is a sound, complete inventory`, () => {
      const d = JSON.parse(readFileSync(`${OUT}${name}.json`, 'utf8')) as { schema: number; summary: ScenarioData['datasetSummary']; datasets: DatasetRecord[] };
      expect(d.schema).toBe(1);
      expect(datasetIssues(d.datasets)).toEqual([]);
      expect(d.summary!.totals.count).toBe(d.datasets.length);
      expect(d.summary!.workingMemory!.items.length).toBeGreaterThan(8);
      for (const id of ['terrain', 'weather', 'fuel-derived', 'roads']) expect(findDataset(d.datasets, id), id).toBeDefined();
    });
  }
  it('live-nondemo.plan.json holds the planned records of the same request', () => {
    const d = JSON.parse(readFileSync(`${OUT}live-nondemo.plan.json`, 'utf8')) as { datasets: DatasetRecord[] };
    expect(d.datasets.every((r) => r.plan && r.sizes.estimate)).toBe(true);
  });
});
