/**
 * Planned data (Setup, before any download): origins, exact bundled sizes, tile counts, offline possibility, packs and
 * stored copies, and the estimates against the sizes of real builds (the bundled Katoomba build here, the recorded live
 * Bilpin build in tests/fixtures/datasets/live-nondemo.json).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DatasetRecord } from '../core/datasets';
import { createMemoryKV, elevationTilesFor, loadBundleManifest, saveAreaPack, type BundleManifest } from '../data';
import { buildScenario } from './build';
import { estimateScenarioData, planScenarioData, summarisePlan, TYPICAL } from './estimate';
import { WEATHER_PRESETS } from './presets';
import type { ScenarioRequest } from './request';
import { withFakeNetwork } from './testing';

const KAT = { lat: -33.715, lon: 150.285 };
const BILPIN = { lat: -33.52, lon: 150.42 };
const byId = (rs: readonly DatasetRecord[], id: string): DatasetRecord => {
  const r = rs.find((x) => x.id === id);
  if (!r) throw new Error(`no planned record ${id}`);
  return r;
};
const noFacts = (manifest: BundleManifest | null) => ({ manifest, packs: [], cachedKeys: new Set<string>(), storedWeather: false });

function textOf(rs: readonly DatasetRecord[]): string {
  return JSON.stringify(rs);
}

describe('planScenarioData', () => {
  it('a demo site offline: everything bundled, exact file sizes, no network, works offline', async () => {
    const m = await loadBundleManifest();
    expect(m).not.toBeNull();
    const start = WEATHER_PRESETS['hot-nw-sw-change'].canonicalStart(KAT.lon, 2026);
    const req: ScenarioRequest = { centre: KAT, extent: 9000, demoSiteId: 'katoomba', weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start }, duration: 4 * 3600, online: false };
    const plan = planScenarioData(req, noFacts(m));
    const f = m!.sites.katoomba!.files;
    expect(byId(plan, 'terrain')).toMatchObject({ origin: 'bundled', status: 'used' });
    expect(byId(plan, 'terrain').plan!.lowBytes).toBe(f['dem5m.png']!.bytes + f['dem5m.json']!.bytes);
    expect(byId(plan, 'imagery').plan!.highBytes).toBe(f['imagery.jpg']!.bytes + f['imagery.json']!.bytes);
    expect(byId(plan, 'vegetation-svtm').sizes.transferredBytes).toBe(f['vegetation.geojson']!.bytes);
    expect(byId(plan, 'fire-history').sizes.transferredBytes).toBe(f['fire-history.geojson']!.bytes);
    // The five place layers share context.json: their planned shares add up to the file.
    const ctx = ['roads', 'fire-trails', 'homes', 'zones', 'place-names'].reduce((a, id) => a + byId(plan, id).sizes.transferredBytes, 0);
    expect(Math.abs(ctx - f['context.json']!.bytes)).toBeLessThanOrEqual(5);
    expect(byId(plan, 'weather').origin).toBe('preset');
    const sum = summarisePlan(plan);
    expect(sum.networkMidBytes).toBe(0);
    expect(sum.offlineOk).toBe(true);
    for (const r of plan) {
      expect(r.sizes.estimate).toBe(true);
      expect(r.plan).toBeDefined();
      expect(r.plan!.lowBytes).toBeLessThanOrEqual(r.plan!.highBytes);
    }
    expect(textOf(plan)).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('a non-demo place online: tiles counted exactly, live downloads, not offline', async () => {
    const m = await loadBundleManifest();
    const req: ScenarioRequest = { centre: BILPIN, extent: 6000, weather: { kind: 'now' }, duration: 4 * 3600, online: true };
    const plan = planScenarioData(req, noFacts(m));
    const tiles = elevationTilesFor({ centre: BILPIN, extent: 6000, cellSize: 10 });
    const t = byId(plan, 'terrain');
    expect(t).toMatchObject({ origin: 'live', status: 'used' });
    expect(t.sizes.requests).toBe(tiles.length);
    expect(t.plan!.networkBytes).toBe(tiles.length * TYPICAL.terrariumTile.mid);
    expect(t.plan!.basis).toMatch(new RegExp(`${tiles.length} zoom-14 tiles`));
    expect(byId(plan, 'imagery').status).toBe('unavailable');
    expect(byId(plan, 'canopy-height').status).toBe('fallback'); // 6 km: the remote canopy is only read up to 3 km
    expect(byId(plan, 'upper-air').origin).toBe('live');
    const sum = summarisePlan(plan);
    expect(sum.offlineOk).toBe(false);
    expect(sum.notOffline).toContain('Ground height');
    expect(sum.networkLowBytes).toBeLessThan(sum.networkMidBytes);
    expect(sum.networkMidBytes).toBeLessThan(sum.networkHighBytes);
    expect(textOf(plan)).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('a non-demo place offline with nothing stored: substitutes, never a network byte', async () => {
    const plan = planScenarioData({ centre: BILPIN, extent: 6000, weather: { kind: 'now' }, duration: 3600, online: false }, noFacts(null));
    expect(byId(plan, 'terrain')).toMatchObject({ status: 'fallback', origin: 'synthetic' });
    expect(byId(plan, 'vegetation-svtm').status).toBe('fallback');
    expect(byId(plan, 'fire-history').status).toBe('unavailable');
    expect(byId(plan, 'weather')).toMatchObject({ status: 'fallback', origin: 'preset' });
    expect(summarisePlan(plan).networkMidBytes).toBe(0);
    for (const r of plan) expect(r.plan!.networkBytes).toBe(0);
  });

  it('stored tiles and an area pack are found on the device (estimateScenarioData)', async () => {
    const kv = createMemoryKV();
    const tiles = elevationTilesFor({ centre: BILPIN, extent: 6000, cellSize: 10 });
    for (const t of tiles) await kv.put(t.key, { t: 1, url: t.url, v: new ArrayBuffer(8), n: 8 });
    const req: ScenarioRequest = { centre: BILPIN, extent: 6000, weather: { kind: 'now' }, duration: 3600, online: false };
    let plan = await estimateScenarioData(req, { kv, manifest: null });
    expect(byId(plan, 'terrain')).toMatchObject({ origin: 'cache', status: 'used' });
    expect(byId(plan, 'terrain').plan!.offlineOk).toBe(true);
    await saveAreaPack({ id: 'bilpin', name: 'Bilpin', centre: BILPIN, extent: 9000, createdAt: 5, items: { vegetation: { type: 'FeatureCollection', features: [] }, fireHistory: { type: 'FeatureCollection', features: [] }, dem10: { grid: {}, elevation: new Float32Array(1000) } } }, kv);
    plan = await estimateScenarioData(req, { kv, manifest: null });
    expect(byId(plan, 'terrain')).toMatchObject({ origin: 'area-pack', originDetail: "area pack 'Bilpin'" });
    expect(byId(plan, 'terrain').sizes.transferredBytes).toBeGreaterThanOrEqual(4000);
    expect(byId(plan, 'vegetation-svtm').origin).toBe('area-pack');
    expect(byId(plan, 'fire-history').origin).toBe('area-pack');
    expect(byId(plan, 'area-pack')).toMatchObject({ role: 'pack', title: 'Saved area pack: Bilpin' });
    expect(summarisePlan(plan).networkMidBytes).toBe(0);
  });
});

describe('estimates against real builds', () => {
  it('the bundled Katoomba build reads exactly the planned bundled bytes', async () => {
    const n = withFakeNetwork([]);
    try {
      const start = WEATHER_PRESETS['hot-nw-sw-change'].canonicalStart(KAT.lon, 2026);
      const req: ScenarioRequest = { centre: KAT, extent: 9000, demoSiteId: 'katoomba', weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start }, duration: 4 * 3600, online: false };
      const plan = await estimateScenarioData(req, { kv: n.kv });
      const s = await buildScenario(req);
      for (const id of ['terrain', 'vegetation-svtm', 'fire-history', 'canopy-height']) {
        const real = byId(s.datasets!, id).sizes.transferredBytes;
        const p = byId(plan, id).plan!;
        expect(real, id).toBe(p.highBytes);
      }
      expect(byId(s.datasets!, 'imagery').parts?.[0]?.bytes).toBe(byId(plan, 'imagery').plan!.highBytes - (byId(s.datasets!, 'imagery').parts?.[1]?.bytes ?? 0));
      // The five places layers share one bundled file: the plan splits it the way the built records do (by each layer's JSON), within a byte of rounding.
      for (const id of ['roads', 'fire-trails', 'homes', 'zones', 'place-names']) {
        const real = byId(s.datasets!, id).sizes.transferredBytes;
        expect(Math.abs(real - byId(plan, id).plan!.highBytes), `${id}: built ${real}, planned ${byId(plan, id).plan!.highBytes}`).toBeLessThanOrEqual(1);
        // The same publisher as the built record (zoning is NSW Planning's, not Spatial Services').
        const who = id === 'zones' ? /Planning/ : /Spatial Services/;
        expect(byId(plan, id).provider.name, id).toMatch(who);
        expect(byId(s.datasets!, id).provider.name, id).toMatch(who);
      }
    } finally {
      n.restore();
    }
  });

  it('the recorded live Bilpin build falls inside the planned ranges (factor 2 slack)', async () => {
    const live = JSON.parse(readFileSync(new URL('../../tests/fixtures/datasets/live-nondemo.json', import.meta.url), 'utf8')) as { datasets: DatasetRecord[] };
    const m = await loadBundleManifest();
    const plan = planScenarioData({ centre: BILPIN, extent: 6000, weather: { kind: 'now' }, duration: 4 * 3600, online: true }, noFacts(m));
    let checked = 0;
    for (const r of live.datasets) {
      // Plans are in uncompressed bytes (DatasetPlan.networkBytes): compare with what the answers decompressed to.
      const got = r.sizes.networkDecodedBytes ?? r.sizes.networkBytes;
      if (r.origin !== 'live' || got < 20_000) continue;
      const p = plan.find((x) => x.id === r.id)?.plan;
      expect(p, r.id).toBeDefined();
      expect(got, r.id).toBeGreaterThanOrEqual(p!.lowBytes / 2);
      expect(got, r.id).toBeLessThanOrEqual(p!.highBytes * 2);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });
});
