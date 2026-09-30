/**
 * The Setup, Building and Settings screens' pure parts: the detail chips and hint name the grid the builder really makes
 * (every area x detail x performance mode, against scenario/build.ts resolveRequest), the duration chips, the "Data for
 * this run" rows and totals from planned records (the recorded live Bilpin plan and a bundled demo site offline), the
 * Building screen's rows from the ledger's progress and from a built inventory, and the performance hint.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATASET_IDS, formatBytes, type DatasetRecord } from '../core/datasets';
import { DatasetLedger, loadBundleManifest } from '../data';
import { buildScenario, resolveRequest } from '../scenario/build';
import type { BuildProgress } from '../scenario/request';
import { planScenarioData } from '../scenario/estimate';
import type { BuildDatasetProgress } from '../scenario/request';
import { WEATHER_PRESETS as SCENARIO_PRESETS } from '../scenario/presets';
import { arrivalOf, BUILD_STEPS, DATASET_TITLES, datasetIcon, datasetStep, datasetTitle } from './labels';
import { ICON_ALIASES, ICON_NAMES } from './icons';
import { performanceProfile } from './settings';
import { buildRequest, builtRow, defaultSetup, detailCell, detailChoices, detailHint, durationChoices, DURATION_CHOICES_H, planRow, planSummary, restoreSetup, shortProvider } from './setupModel';

const NOW = Date.UTC(2026, 8, 30, 2);
const fixture = (name: string): { datasets: DatasetRecord[] } => JSON.parse(readFileSync(join(__dirname, '..', '..', 'tests', 'fixtures', 'datasets', name), 'utf8'));

describe('detail options name the grid that is built', () => {
  it('chips, hint and cell = resolveRequest(buildRequest()) for every area, detail and performance mode', () => {
    for (const perf of ['auto', 'battery', 'quality'] as const) {
      const tier = performanceProfile(perf).tier;
      for (const extentKm of [3, 6, 9] as const) {
        const chips = detailChoices(extentKm, tier);
        for (const detail of ['fast', 'normal', 'detailed'] as const) {
          const s = { ...defaultSetup(NOW), where: 'demo' as const, demoSiteId: 'katoomba', detail, extentKm };
          const req = buildRequest(s, perf, NOW);
          const rr = resolveRequest(req);
          const c = detailCell(extentKm, detail, tier);
          const why = `${detail} ${extentKm} km ${perf}`;
          expect(c.cellM, why).toBe(rr.fireCellSize);
          expect(c.n, why).toBe(Math.round(rr.extent / rr.fireCellSize));
          expect(c.twoD, why).toBe(req.options?.tier === 'fast');
          expect(detailHint(extentKm, detail, tier).startsWith(`${rr.fireCellSize} m cells`), why).toBe(true);
          const label = chips.find((x) => x.value === detail)!.label;
          expect(label, why).toContain(`${rr.fireCellSize} m`);
          expect(label.includes('2-D'), why).toBe(req.options?.tier === 'fast');
        }
      }
    }
  });

  it('Normal at 6 km says 20 m with the Detail (quality) mode and 30 m with Balanced — the old hint said 30 m for both', () => {
    expect(detailCell(6, 'normal', performanceProfile('quality').tier).cellM).toBe(20);
    expect(detailCell(6, 'normal', performanceProfile('auto').tier).cellM).toBe(30);
    expect(detailCell(9, 'detailed', 'auto')).toMatchObject({ cellM: 30, coarsened: true });
    expect(detailChoices(3, 'auto').map((c) => c.label)).toEqual(['Fast · 30 m 2-D', 'Normal · 30 m', 'Detailed · 20 m']);
  });
});

describe('duration chips', () => {
  it('offer the usual choices plus a saved value that is not one of them', () => {
    expect(durationChoices(6)).toEqual([...DURATION_CHOICES_H]);
    expect(durationChoices(4)).toEqual([1, 2, 3, 4, 6, 9, 12]);
    expect(restoreSetup({ durationH: 4 }, NOW).durationH).toBe(4);
    expect(durationChoices(Number.NaN)).toEqual([...DURATION_CHOICES_H]);
  });
});

describe('Data for this run (planned records)', () => {
  it('the live Bilpin plan: live chips, ≈ network sizes, the total download and "works offline: no"', () => {
    const recs = fixture('live-nondemo.plan.json').datasets;
    const rows = recs.map((r) => planRow(r, true));
    const terrain = rows.find((r) => r.id === 'terrain')!;
    expect(terrain.badge).toEqual({ kind: 'origin', origin: 'live', label: 'Live' });
    expect(terrain.size).toBe(`≈ ${formatBytes(recs.find((r) => r.id === 'terrain')!.plan!.networkBytes)}`);
    expect(terrain.provider).toBe('Mapzen Terrain Tiles on AWS Open Data');
    const canopy = rows.find((r) => r.id === 'canopy-height')!;
    expect(canopy.badge).toMatchObject({ kind: 'origin', origin: 'synthetic' });
    expect(canopy.note).toBeTruthy();
    expect(rows.find((r) => r.id === 'imagery')!.badge).toMatchObject({ kind: 'badge', label: 'Not available here' });
    expect(rows.find((r) => r.id === 'fuel-derived')!.badge).toMatchObject({ kind: 'badge', label: 'Worked out' });
    const sum = planSummary(recs, true);
    const net = recs.reduce((s, r) => s + (r.plan?.networkBytes ?? 0), 0);
    expect(net).toBeGreaterThan(0);
    expect(sum.download).toBe(`≈ ${formatBytes(net)} to download`);
    expect(sum.offline).toBe('Works offline: no');
    expect(sum.offlineOk).toBe(false);
    expect(sum.warnings.join(' ')).toMatch(/Needs a signal for ground height/);
    expect(sum.warnings.join(' ')).toContain('roads, homes and place names');
    expect(sum.warnings.join(' ')).not.toContain('fire trails'); // the places layers are named once
  });

  it('a demo site offline: bundled chips with exact sizes, nothing to download, works offline', async () => {
    const m = await loadBundleManifest();
    expect(m).not.toBeNull();
    const s = { ...defaultSetup(NOW), where: 'demo' as const, demoSiteId: 'katoomba', online: false };
    const recs = planScenarioData(buildRequest(s, 'auto', NOW), { manifest: m, packs: [], cachedKeys: new Set(), storedWeather: false });
    const rows = recs.map((r) => planRow(r, false));
    const terrain = rows.find((r) => r.id === 'terrain')!;
    expect(terrain.badge).toEqual({ kind: 'origin', origin: 'bundled', label: 'Bundled' });
    const f = m!.sites.katoomba!.files;
    expect(terrain.size).toBe(formatBytes(f['dem5m.png']!.bytes + f['dem5m.json']!.bytes)); // exact: no ≈
    expect(rows.find((r) => r.id === 'weather')!.badge).toMatchObject({ origin: 'synthetic', label: 'Designed' });
    expect(rows.some((r) => r.badge.label === 'Not available offline')).toBe(false);
    const sum = planSummary(recs, false);
    expect(sum.download).toBe('Nothing to download');
    expect(sum.offline).toBe('Works offline: yes');
    expect(sum.warnings).toEqual([]);
  });

  it('a place away from the demo sites with no signal: "Not available offline" and what stands in', async () => {
    const m = await loadBundleManifest();
    const s = { ...defaultSetup(NOW), where: 'manual' as const, manualText: '-33.52, 150.42', online: false, weather: 'now' as const };
    const recs = planScenarioData(buildRequest(s, 'auto', NOW), { manifest: m, packs: [], cachedKeys: new Set(), storedWeather: false });
    const rows = recs.map((r) => planRow(r, false));
    const offline = rows.filter((r) => r.badge.label === 'Not available offline').map((r) => r.id);
    expect(offline).toEqual(expect.arrayContaining(['terrain', 'vegetation-svtm', 'fire-history', 'roads']));
    expect(offline).not.toContain('imagery'); // not available at this place whatever the signal
    expect(rows.find((r) => r.id === 'terrain')!.note).toMatch(/made-up terrain/);
    const sum = planSummary(recs, false);
    expect(sum.download).toBe('Nothing to download');
    expect(sum.offline).toBe('Offline, with estimates');
    expect(sum.offlineOk).toBe(false);
    expect(sum.warnings[0]).toMatch(/^Offline: no data for ground height, .*roads, homes and place names; the app uses estimates instead/);
  });

  it('provider names drop the parenthetical part', () => {
    expect(shortProvider('NSW Spatial Services (Department of Customer Service)')).toBe('NSW Spatial Services');
    expect(shortProvider('Open-Meteo')).toBe('Open-Meteo');
  });
});

describe('Building screen rows', () => {
  it('ledger progress: dominant origin by bytes, "up to" when the wire size was not reported, failures', () => {
    const l = new DatasetLedger({ clock: () => 1000 });
    l.record({ tag: 'terrain', source: 'bundled', host: 'bundled', path: '/demo/katoomba/dem5m.png', bytes: 1_400_000 });
    l.record({ tag: 'weather', url: 'https://api.open-meteo.com/v1/forecast?x=1', status: 200, bytes: 77_000, bodyBytes: 77_000, wireUnknown: true });
    l.record({ tag: 'vegetation-svtm', source: 'cache', host: 'cache', path: '/arcgis/x', bytes: 900_000, cachedAt: 500 });
    l.record({ tag: 'fire-history', url: 'https://x.gov.au/q', status: 0, error: 'network' });
    const progress: BuildDatasetProgress[] = l.tags().map((id) => {
      const t = l.totals(id);
      return { id, requests: t.requests, failures: t.failures, bytes: t.bytes, networkBytes: t.networkBytes, networkUnmeasuredBytes: t.networkUnmeasuredBytes, cacheBytes: t.cacheBytes, packBytes: t.packBytes, bundledBytes: t.bundledBytes };
    });
    const a = Object.fromEntries(progress.map((p) => [p.id, arrivalOf(p, formatBytes)]));
    expect(a['terrain']).toMatchObject({ origin: 'bundled', size: '1.4 MB', title: 'Ground height', failed: false });
    expect(a['weather']).toMatchObject({ origin: 'live', size: 'up to 77.0 KB' });
    expect(a['vegetation-svtm']).toMatchObject({ origin: 'saved', size: '900.0 KB' });
    expect(a['fire-history']).toMatchObject({ failed: true, size: '' });
  });

  it('a built inventory: measured sizes and origins, each data set under its build step', () => {
    const recs = fixture('katoomba-bundled.json').datasets;
    const steps = new Set(BUILD_STEPS.map((s) => s.step));
    for (const r of recs) {
      const b = builtRow(r);
      expect(steps.has(datasetStep(r.id, r.role)), r.id).toBe(true);
      if (r.origin === 'bundled' && r.sizes.transferredBytes > 0) expect(b.badge, r.id).toEqual({ kind: 'origin', origin: 'bundled', label: 'Bundled' });
      if (r.sizes.transferredBytes > 0) expect(b.size.endsWith(formatBytes(r.sizes.transferredBytes)), r.id).toBe(true);
    }
    const live = fixture('live-nondemo.json').datasets;
    const t = live.find((r) => r.id === 'terrain')!;
    expect(builtRow(t).badge).toMatchObject({ origin: 'live' });
    expect(datasetStep('upper-air')).toBe('weather');
    expect(datasetStep('imagery')).toBe('terrain');
    expect(datasetStep('context-file')).toBe('places');
  });

  it('every known data set has a title, an icon that exists and a step', () => {
    const icons = new Set<string>([...ICON_NAMES, ...Object.keys(ICON_ALIASES)]);
    const drawn = (n: string): boolean => icons.has(n);
    for (const id of DATASET_IDS) {
      expect(DATASET_TITLES[id], id).toBeTruthy();
      expect(drawn(datasetIcon(id)), id).toBe(true);
      expect(BUILD_STEPS.some((s) => s.step === datasetStep(id)), id).toBe(true);
    }
    expect(datasetTitle('some-new-thing')).toBe('Some new thing');
  });
});

describe('the build reports the data sets as they arrive (BuildProgress.datasets from the ledger)', () => {
  it('Katoomba offline: rows appear step by step, bundled, sizes only grow, and end at the inventory totals', async () => {
    const events: BuildProgress[] = [];
    const start = SCENARIO_PRESETS['hot-nw-sw-change'].canonicalStart(150.285, 2026);
    const s = await buildScenario(
      { centre: { lat: -33.715, lon: 150.285 }, extent: 6000, demoSiteId: 'katoomba', weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start }, duration: 3600, online: false },
      (p) => events.push(p),
    );
    const withData = events.filter((e) => e.datasets?.length);
    expect(withData.length).toBeGreaterThan(3);
    // Terrain has arrived before the vegetation step starts; the ids appear in first-read order and never disappear.
    const firstVeg = events.findIndex((e) => e.step === 'vegetation');
    expect(events[firstVeg]!.datasets!.some((d) => d.id === 'terrain')).toBe(true);
    let prev = new Map<string, number>();
    for (const e of withData) {
      const now = new Map(e.datasets!.map((d) => [d.id, d.bytes]));
      for (const [id, b] of prev) expect(now.get(id) ?? -1, id).toBeGreaterThanOrEqual(b);
      prev = now;
    }
    const last = withData[withData.length - 1]!.datasets!;
    for (const d of last) expect(arrivalOf(d, formatBytes).origin, d.id).toBe('bundled');
    const terrainBytes = last.find((d) => d.id === 'terrain')!.bytes;
    expect(terrainBytes).toBe(s.datasets!.find((r) => r.id === 'terrain')!.sizes.transferredBytes);
  });
});
