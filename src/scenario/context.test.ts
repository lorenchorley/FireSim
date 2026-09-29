/**
 * Places context in the scenario builder: the loader order (bundled demo site → area pack → cache → live → stale /
 * partial → none), the warnings, cancellation, the area-pack round trip, and the build integration (a 'places' step,
 * `ScenarioData.context`, the live query running in parallel with the rest of the build, offline fallbacks).
 * The live NSW services are replaced by a fake that replays the recorded Blackheath responses (data/nswContextTesting).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryKV, DEMO_SITES, listAreaPacks, loadAreaPack, resetHttpConfig, saveAreaPack, setDefaultCache, setHttpConfig, type KV } from '../data';
import { buildContextFile, CONTEXT_QUERY_IDS, type ContextFeatures } from '../data/nswContextCore';
import { contextCacheKey, contextQueryBBox } from '../data/nswContext';
import { BLACKHEATH, fakeNswServer, recordedFeatures, type FakeNswOptions } from '../data/nswContextTesting';
import { ATTRIBUTIONS } from '../ui/content';
import { downloadAreaPack } from './areaPack';
import { buildScenario } from './build';
import { CONTEXT_PACK_ITEM, contextForPack, isContextFile, loadContext, type ContextRequest } from './context';
import { MESSAGES } from './messages';
import { WEATHER_PRESETS } from './presets';
import type { BuildProgress } from './request';

const KAT = { lat: -33.715, lon: 150.285 };
const FAR = { lat: -34.9, lon: 149.9 }; // no demo site within reach
const NOW = Date.UTC(2026, 8, 29, 3, 0);
const DAY = 86_400_000;

afterEach(() => {
  resetHttpConfig();
  setDefaultCache(null);
});

interface Net {
  kv: KV;
  calls: ReturnType<typeof fakeNswServer>['calls'];
}
/** Fake NSW services + a fresh memory cache; every other URL fails like a network error. */
function net(o: FakeNswOptions = {}): Net {
  const nsw = fakeNswServer(o);
  const kv = createMemoryKV();
  setDefaultCache(kv);
  setHttpConfig({ fetch: nsw.fetch, platform: 'node', retryDelayMs: 1 });
  return { kv, calls: nsw.calls };
}

const features = (): ContextFeatures => Object.fromEntries(CONTEXT_QUERY_IDS.map((id) => [id, recordedFeatures(id)]));
const BH_EXTENT = 3000;
const bhBBox = contextQueryBBox(BLACKHEATH, BH_EXTENT);
const bhKey = contextCacheKey(bhBBox);
/** A context file for the Blackheath box; `id` tells which source a result came from. */
const blackheathFile = (id: string) => buildContextFile({ id, bbox: bhBBox, fetched: '2026-09-20', features: features() });
const bhReq = (over: Partial<ContextRequest> = {}): ContextRequest => ({ centre: BLACKHEATH, extent: BH_EXTENT, online: true, now: NOW, ...over });

describe('bundled demo sites', () => {
  it('Katoomba: the bundled file, no network, a warm load in under 50 ms', async () => {
    const n = net();
    const req: ContextRequest = { centre: KAT, extent: 9000, online: false, demoSiteId: 'katoomba', kv: n.kv };
    const first = await loadContext(req);
    expect(first.origin).toBe('bundled');
    expect(first.warnings).toEqual([]);
    expect(first.context!.origin).toBe('bundled');
    expect(first.context!.roads.length).toBeGreaterThan(1500);
    expect(first.context!.homes.length / 2).toBeGreaterThan(5000);
    expect(isContextFile(first.file)).toBe(true);
    const times: number[] = [];
    for (let i = 0; i < 4; i++) {
      const t = performance.now();
      await loadContext(req);
      times.push(performance.now() - t);
    }
    expect(Math.min(...times)).toBeLessThan(50);
    expect(n.calls).toHaveLength(0);
  });

  it('every demo site, online or not, is served from its bundle without asking the network', async () => {
    const n = net();
    for (const s of DEMO_SITES) {
      for (const online of [false, true]) {
        const r = await loadContext({ centre: s.centre, extent: 9000, online, kv: n.kv, demoSiteId: s.id });
        expect(r.origin, s.id).toBe('bundled');
        expect(r.context!.roads.length, s.id).toBeGreaterThan(0);
        expect(r.warnings, s.id).toEqual([]);
      }
    }
    expect(n.calls).toHaveLength(0);
  });

  it('the bundle beats an area pack and a fresh cache entry', async () => {
    const n = net();
    const pack = blackheathFile('pack');
    await saveAreaPack({ id: 'kat', name: 'kat', centre: KAT, extent: 9000, createdAt: NOW, items: { [CONTEXT_PACK_ITEM]: pack } }, n.kv);
    const r = await loadContext({ centre: KAT, extent: 6000, online: true, kv: n.kv, now: NOW });
    expect(r.origin).toBe('bundled');
    expect(r.file!.id).toBe('katoomba');
  });

  it('the projection origin is the scenario origin (not the demo site centre)', async () => {
    net();
    const off = { lat: KAT.lat + 0.01, lon: KAT.lon + 0.01 };
    const a = await loadContext({ centre: KAT, extent: 3000, online: false });
    const b = await loadContext({ centre: off, extent: 3000, online: false });
    expect(b.context!.projectionOrigin).toEqual(off);
    // The same road is ~1.1 km further south and ~0.9 km further west in the shifted frame.
    const name = 'Megalong Road';
    const ra = a.context!.roads.find((r) => r.name === name)!;
    const rb = b.context!.roads.find((r) => r.name === name)!;
    expect(ra.xy[0]! - rb.xy[0]!).toBeGreaterThan(800);
    expect(ra.xy[1]! - rb.xy[1]!).toBeGreaterThan(1000);
  });
});

describe('order: area pack → fresh cache → live', () => {
  it('an area pack that covers the domain wins over the cache and the network', async () => {
    const n = net();
    await saveAreaPack({ id: 'bh', name: 'Blackheath', centre: BLACKHEATH, extent: 6000, createdAt: NOW, items: { [CONTEXT_PACK_ITEM]: blackheathFile('pack') } }, n.kv);
    await n.kv.put(bhKey, { t: NOW, file: blackheathFile('cache') });
    const r = await loadContext(bhReq({ kv: n.kv }));
    expect(r.origin).toBe('area-pack');
    expect(r.context!.origin).toBe('area-pack');
    expect(r.file!.id).toBe('pack');
    expect(r.warnings).toEqual([]);
    expect(n.calls).toHaveLength(0);
  });

  it('a pack without a context item (saved before this feature) is skipped', async () => {
    const n = net();
    await saveAreaPack({ id: 'old', name: 'Old', centre: BLACKHEATH, extent: 6000, createdAt: NOW, items: { dem10: { any: 1 } } }, n.kv);
    const r = await loadContext(bhReq({ kv: n.kv }));
    expect(r.origin).toBe('live');
  });

  it('a pack that does not cover the domain is not used', async () => {
    const n = net();
    await saveAreaPack({ id: 'small', name: 'Small', centre: BLACKHEATH, extent: 3000, createdAt: NOW, items: { [CONTEXT_PACK_ITEM]: blackheathFile('pack') } }, n.kv);
    const r = await loadContext(bhReq({ kv: n.kv, extent: 6000 }));
    expect(r.origin).toBe('live');
  });

  it('a cache entry up to 7 days old is used without asking the services', async () => {
    const n = net();
    await n.kv.put(bhKey, { t: NOW - 7 * DAY, file: blackheathFile('cache') });
    const r = await loadContext(bhReq({ kv: n.kv }));
    expect(r.origin).toBe('cache');
    expect(r.context!.origin).toBe('cache');
    expect(r.file!.id).toBe('cache');
    expect(r.warnings).toEqual([]);
    expect(n.calls).toHaveLength(0);
  });

  it('an older entry is refreshed from the services when online (and replaced)', async () => {
    const n = net();
    await n.kv.put(bhKey, { t: NOW - 7 * DAY - 1, file: blackheathFile('cache') });
    const r = await loadContext(bhReq({ kv: n.kv }));
    expect(r.origin).toBe('live');
    expect(r.file!.id).toBe('live');
    expect(n.calls.length).toBeGreaterThan(6);
    expect((await n.kv.get<{ t: number; file: { id: string } }>(bhKey))!.t).toBe(NOW);
  });

  it('a live result is cached: the next load, even offline, is served from the cache', async () => {
    const n = net();
    const first = await loadContext(bhReq({ kv: n.kv }));
    expect(first.origin).toBe('live');
    expect(first.context!.origin).toBe('live');
    expect(first.context!.roads).toHaveLength(379);
    expect(first.context!.homes.length / 2).toBe(1603);
    expect(first.warnings).toEqual([]);
    const before = n.calls.length;
    const second = await loadContext(bhReq({ kv: n.kv, online: false, now: NOW + 3 * DAY }));
    expect(second.origin).toBe('cache');
    expect(second.context!.roads).toHaveLength(379);
    expect(n.calls.length).toBe(before);
    // A slightly different centre falls in the same ~500 m cell of the cache key.
    const third = await loadContext(bhReq({ kv: n.kv, online: false, centre: { lat: BLACKHEATH.lat + 0.0002, lon: BLACKHEATH.lon - 0.00003 } }));
    expect(third.origin).toBe('cache');
  });

  it('a malformed cache entry is ignored', async () => {
    const n = net();
    await n.kv.put(bhKey, { t: NOW, file: { version: 2, roads: [] } });
    const r = await loadContext(bhReq({ kv: n.kv }));
    expect(r.origin).toBe('live');
  });

  it('keeps at most 10 cache entries, dropping the oldest', async () => {
    const n = net();
    for (let i = 0; i < 12; i++) await n.kv.put(`context/v1/old-${String(i).padStart(2, '0')}`, { t: NOW - (30 - i) * DAY, file: blackheathFile(`old${i}`) });
    await loadContext(bhReq({ kv: n.kv }));
    const keys = await n.kv.keys('context/v1/');
    expect(keys).toHaveLength(10);
    expect(keys).toContain(bhKey);
    expect(keys).not.toContain('context/v1/old-00');
    expect(keys).toContain('context/v1/old-11');
  });
});

describe('when the live query does not work', () => {
  it('some layers failing: the rest is used with a plain-English warning, and it is not cached', async () => {
    const n = net({ fail: { zones: { always: 500 } } });
    const r = await loadContext(bhReq({ kv: n.kv }));
    expect(r.origin).toBe('live');
    expect(r.context!.zones).toEqual([]);
    expect(r.context!.roads).toHaveLength(379);
    expect(r.warnings).toEqual([MESSAGES.contextMissing('residential zones')]);
    expect(await n.kv.get(bhKey)).toBeUndefined();
  });

  it('every layer failing, nothing stored: no context and one warning, never an exception', async () => {
    const n = net({ fail: Object.fromEntries(CONTEXT_QUERY_IDS.map((id) => [id, { always: 'network' as const }])) });
    const r = await loadContext(bhReq({ kv: n.kv, centre: FAR }));
    expect(r).toMatchObject({ context: null, origin: 'none', file: null, warnings: [MESSAGES.contextFailed] });
  });

  it('near a demo site, a bundle that only partly covers the domain is used when the services do not answer', async () => {
    const n = net({ fail: Object.fromEntries(CONTEXT_QUERY_IDS.map((id) => [id, { always: 503 as const }])) });
    const r = await loadContext(bhReq({ kv: n.kv })); // Blackheath is at the western edge of the Grose Valley demo site
    expect(r.origin).toBe('bundled');
    expect(r.file!.id).toBe('grose');
    expect(r.warnings).toEqual([MESSAGES.contextPartial]);
  });

  it('a stale cache entry is better than nothing, with the date it was saved', async () => {
    const n = net({ fail: Object.fromEntries(CONTEXT_QUERY_IDS.map((id) => [id, { always: 503 }])) });
    await n.kv.put(bhKey, { t: NOW - 40 * DAY, file: blackheathFile('cache') });
    const r = await loadContext(bhReq({ kv: n.kv }));
    expect(r.origin).toBe('cache');
    expect(r.warnings).toEqual([MESSAGES.contextStale(new Date(NOW - 40 * DAY).toISOString().slice(0, 10))]);
    // Offline the same.
    const off = await loadContext(bhReq({ kv: n.kv, online: false }));
    expect(off.origin).toBe('cache');
    expect(off.warnings).toHaveLength(1);
  });

  it('a slow layer is left out at the time limit; the others are used, the warning names it, and nothing is cached', async () => {
    const n = net({ slow: { zones: 60_000 } });
    const r = await loadContext(bhReq({ kv: n.kv, centre: FAR, liveTimeoutMs: 100 }));
    expect(r.origin).toBe('live');
    expect(r.context!.roads).toHaveLength(379);
    expect(r.context!.zones).toEqual([]);
    expect(r.warnings).toEqual([MESSAGES.contextSlow('residential zones', 0.1)]);
    expect(r.warnings[0]).toMatch(/residential zones.*longer than/);
    expect(await n.kv.keys('context/v1/')).toEqual([]);
  });

  it('a live query that takes too long is given up on, with a warning', async () => {
    const n = net({ hang: true });
    const t = Date.now();
    const r = await loadContext(bhReq({ kv: n.kv, centre: FAR, liveTimeoutMs: 40 }));
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.context).toBeNull();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/took longer than/);
    expect(n.calls.length).toBeGreaterThan(0);
  });
});

describe('broken storage', () => {
  it('a store that throws on every call does not stop the live query or the build', async () => {
    const nsw = fakeNswServer();
    setHttpConfig({ fetch: nsw.fetch, platform: 'node', retryDelayMs: 1 });
    const boom = async (): Promise<never> => {
      throw new Error('IndexedDB is unavailable');
    };
    const kv: KV = { get: boom, put: boom, del: boom, keys: boom };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const r = await loadContext(bhReq({ kv }));
      expect(r.origin).toBe('live');
      expect(r.context!.roads).toHaveLength(379);
      expect(r.warnings).toEqual([]);
      const off = await loadContext({ centre: FAR, extent: 3000, online: false, kv });
      expect(off.context).toBeNull();
      expect(off.warnings).toEqual([MESSAGES.contextOffline]);
    } finally {
      console.warn = warn;
    }
  });
});

describe('offline', () => {
  it('a place with no stored data: no context and the message that names the remedy', async () => {
    const n = net();
    const r = await loadContext({ centre: FAR, extent: 6000, online: false, kv: n.kv, now: NOW });
    expect(r).toMatchObject({ context: null, origin: 'none', file: null });
    expect(r.warnings).toEqual(['Roads and homes are not available offline for this place — save an area pack in Setup while you have signal']);
    expect(n.calls).toHaveLength(0);
  });

  it('a domain that only partly overlaps a demo site gets that bundle, saying so', async () => {
    const n = net();
    const r = await loadContext({ centre: { lat: KAT.lat, lon: KAT.lon + 0.06 }, extent: 6000, online: false, kv: n.kv });
    expect(r.origin).toBe('bundled');
    expect(r.file!.id).toBe('katoomba');
    expect(r.warnings).toEqual([MESSAGES.contextPartial]);
    // Far from every demo site there is nothing to fall back on.
    expect((await loadContext({ centre: FAR, extent: 6000, online: false, kv: n.kv })).origin).toBe('none');
  });
});

describe('cancellation', () => {
  it('an already-aborted signal rejects without a request', async () => {
    const n = net();
    const ac = new AbortController();
    ac.abort();
    await expect(loadContext(bhReq({ kv: n.kv, signal: ac.signal }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(n.calls).toHaveLength(0);
  });
  it('aborting during the live query rejects and stops the requests', async () => {
    const n = net({ latencyMs: 25 });
    const ac = new AbortController();
    const p = loadContext(bhReq({ kv: n.kv, signal: ac.signal }));
    await new Promise((r) => setTimeout(r, 40));
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    const after = n.calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(n.calls.length).toBe(after);
    expect(await n.kv.get(bhKey)).toBeUndefined();
  });
});

describe('area packs', () => {
  it('a Katoomba pack stores the bundled context; a pack of an unknown place stores a fresh live query and works offline', async () => {
    const n = net();
    const kat = await downloadAreaPack({ name: 'Katoomba', centre: KAT, extent: 3000, demoSiteId: 'katoomba', weather: false, now: NOW, kv: n.kv });
    expect(kat.meta.itemNames).toContain(CONTEXT_PACK_ITEM);
    expect(kat.warnings.join(' ')).not.toMatch(/Roads/);
    const stored = (await loadAreaPack('katoomba', n.kv))!.items[CONTEXT_PACK_ITEM];
    expect(isContextFile(stored)).toBe(true);

    const progress: number[] = [];
    const bh = await downloadAreaPack({ name: 'Blackheath field pack', centre: BLACKHEATH, extent: BH_EXTENT, weather: false, now: NOW, kv: n.kv }, (p) => progress.push(p.fraction));
    expect(bh.meta.itemNames).toContain(CONTEXT_PACK_ITEM);
    expect(n.calls.length).toBeGreaterThan(6);
    expect((await listAreaPacks(n.kv)).map((p) => p.id).sort()).toEqual(['blackheath-field-pack', 'katoomba']);
    // Offline, later: the pack answers (the response cache is irrelevant), with the same data as the live query.
    await n.kv.del(bhKey);
    const before = n.calls.length;
    const r = await loadContext({ centre: BLACKHEATH, extent: BH_EXTENT - 600, online: false, kv: n.kv, now: NOW + 30 * DAY });
    expect(r.origin).toBe('area-pack');
    expect(r.context!.origin).toBe('area-pack');
    expect(r.context!.roads).toHaveLength(379);
    expect(r.warnings).toEqual([]);
    expect(n.calls.length).toBe(before);
  });

  it('refreshing a pack while the services are down keeps its old context', async () => {
    const n = net();
    await downloadAreaPack({ name: 'Blackheath', centre: BLACKHEATH, extent: BH_EXTENT, weather: false, now: NOW, kv: n.kv });
    await n.kv.del(bhKey);
    // The services go down.
    const down = fakeNswServer({ fail: Object.fromEntries(CONTEXT_QUERY_IDS.map((id) => [id, { always: 503 as const }])) });
    setHttpConfig({ fetch: down.fetch });
    const again = await downloadAreaPack({ name: 'Blackheath', centre: BLACKHEATH, extent: BH_EXTENT, weather: false, now: NOW + DAY, kv: n.kv });
    expect(again.meta.itemNames).toContain(CONTEXT_PACK_ITEM);
    expect(isContextFile((await loadAreaPack('blackheath', n.kv))!.items[CONTEXT_PACK_ITEM])).toBe(true);
  });

  it('contextForPack: no source at all is a warning, not an error', async () => {
    const n = net({ fail: Object.fromEntries(CONTEXT_QUERY_IDS.map((id) => [id, { always: 'network' as const }])) });
    const r = await contextForPack({ centre: FAR, extent: 3000, online: true, kv: n.kv, now: NOW });
    expect(r.file).toBeNull();
    expect(r.warnings).toEqual([MESSAGES.contextFailed]);
  });
});

describe('build integration', () => {
  const preset = (): { kind: 'preset'; presetId: string; start: number } => ({ kind: 'preset', presetId: 'hot-nw-sw-change', start: WEATHER_PRESETS['hot-nw-sw-change'].canonicalStart(KAT.lon, 2026) });

  it('Katoomba offline: ScenarioData.context is the bundle, a places step precedes done, nothing is requested', async () => {
    const n = net();
    const progress: BuildProgress[] = [];
    const s = await buildScenario({ centre: KAT, extent: 9000, demoSiteId: 'katoomba', weather: preset(), duration: 4 * 3600, online: false }, (p) => progress.push(p));
    expect(s.context).toBeDefined();
    expect(s.context!.origin).toBe('bundled');
    expect(s.context!.roads.length).toBeGreaterThan(1500);
    expect(s.context!.projectionOrigin).toEqual(s.origin);
    expect(s.weather.warnings ?? []).not.toContain(MESSAGES.contextOffline);
    const steps = progress.map((p) => p.step).filter((x, i, a) => a.indexOf(x) === i);
    expect(steps.slice(-3)).toEqual(['fuel', 'places', 'done']);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!.fraction).toBeGreaterThanOrEqual(progress[i - 1]!.fraction);
    expect(() => structuredClone(s)).not.toThrow();
    expect(n.calls).toHaveLength(0);
  });

  it('offline away from the demo sites: no context, one warning on the scenario, the build still succeeds', async () => {
    net();
    const progress: BuildProgress[] = [];
    const s = await buildScenario({ centre: FAR, extent: 3000, weather: preset(), duration: 3 * 3600, online: false, now: NOW }, (p) => progress.push(p));
    expect(s.context).toBeUndefined();
    expect(s.weather.warnings).toContain(MESSAGES.contextOffline);
    expect(progress[progress.length - 1]!.warnings).toContain(MESSAGES.contextOffline);
  });

  it('online away from the demo sites: the live query starts with the build (in parallel), and lands in ScenarioData.context', async () => {
    const n = net();
    const callsAtStep = new Map<string, number>();
    const s = await buildScenario({ centre: BLACKHEATH, extent: BH_EXTENT, weather: preset(), duration: 3 * 3600, online: true, now: NOW }, (p) => {
      if (!callsAtStep.has(p.step)) callsAtStep.set(p.step, n.calls.length);
    });
    expect(s.context?.origin).toBe('live');
    expect(s.context!.roads).toHaveLength(379);
    expect(s.context!.sources.map((x) => x.id)).toEqual(['roads', 'fireTrails', 'homes', 'zones', 'places']);
    // Queries were already on the wire while the build was still on its first steps.
    expect(callsAtStep.get('canopy')!).toBeGreaterThan(0);
    expect(n.calls.length).toBeGreaterThan(6);
    expect((s.weather.warnings ?? []).filter((w) => /Roads|map data/.test(w))).toEqual([]);
    // Cached for next time.
    expect(await (await import('../data')).openCache().get(bhKey)).toBeDefined();
  });

  it('online but the place services are down: the build succeeds with a warning', async () => {
    net({ fail: Object.fromEntries(CONTEXT_QUERY_IDS.map((id) => [id, { always: 503 as const }])) });
    const s = await buildScenario({ centre: FAR, extent: BH_EXTENT, weather: preset(), duration: 3 * 3600, online: true, now: NOW });
    expect(s.context).toBeUndefined();
    expect(s.weather.warnings).toContain(MESSAGES.contextFailed);
  });

  it('cancelling the build stops the place queries too', async () => {
    const n = net({ latencyMs: 15 });
    const ac = new AbortController();
    const p = buildScenario({ centre: BLACKHEATH, extent: BH_EXTENT, weather: preset(), duration: 3 * 3600, online: true, now: NOW }, (pr) => {
      if (pr.step === 'canopy') ac.abort();
    }, ac.signal);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    const after = n.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(n.calls.length).toBe(after);
  });
});

describe('attribution', () => {
  it('every attribution string the data carries is shown in Settings → About', async () => {
    const shown = ATTRIBUTIONS.map((a) => `${a.name} ${a.use} ${a.licence}`).join('\n');
    const strings = new Set<string>();
    for (const s of DEMO_SITES) {
      const r = await loadContext({ centre: s.centre, extent: 9000, online: false });
      for (const src of r.context!.sources) {
        strings.add(src.attribution);
        expect(src.licence).toBe('CC BY 4.0');
      }
    }
    expect([...strings].sort()).toEqual(['© Spatial Services NSW', '© State of NSW and Department of Planning, Housing and Infrastructure']);
    for (const a of strings) expect(shown).toContain(a);
    expect(shown).toMatch(/roads and fire trails/i);
    expect(shown).toMatch(/addresses/i);
    expect(shown).toMatch(/place names/i);
    expect(shown).toMatch(/land zoning/i);
    for (const a of ATTRIBUTIONS) expect(a.licence).toMatch(/CC BY 4\.0|public domain|information only/i);
  });
});
