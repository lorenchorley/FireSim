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
import { buildRequest, builtRow, defaultSetup, detailCell, detailChoices, detailHint, durationChoices, DURATION_CHOICES_H, persistable, planRow, planSummary, resolveCentre, restoreSetup, shortProvider, validateSetup, windHint } from './setupModel';

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

describe('the wind the Setup hint names', () => {
  it('Auto (the default) does not promise the 3-D wind: it decides when the run starts, and the fast tier is the usual outcome on a phone', () => {
    const auto = detailCell(6, 'normal', performanceProfile('auto').tier);
    expect(auto).toMatchObject({ twoD: false, windAuto: true });
    expect(windHint(auto)).toBe('a 3-D wind if this phone is fast enough, else a simple 2-D surface wind (decided when the run starts)');
    expect(windHint(detailCell(6, 'normal', undefined))).toBe(windHint(auto));
  });

  it('Saver and the Fast detail are the simple 2-D wind for certain; Best quality is the 3-D wind for certain', () => {
    expect(windHint(detailCell(6, 'normal', performanceProfile('battery').tier))).toBe('simple 2-D surface wind');
    expect(windHint(detailCell(6, 'fast', performanceProfile('auto').tier))).toBe('simple 2-D surface wind');
    const best = detailCell(6, 'normal', performanceProfile('quality').tier);
    expect(best.windAuto).toBe(false);
    expect(windHint(best)).toBe('3-D wind');
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
    const s = { ...defaultSetup(NOW), where: 'manual' as const, manualText: '-33.498, 150.522', online: false, weather: 'now' as const }; // Bilpin village: east of the Mount Tomah site
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

  it('a typed place on the Bilpin ridge lies inside the Mount Tomah site: its data come from the bundle, offline', async () => {
    const m = await loadBundleManifest();
    const s = { ...defaultSetup(NOW), where: 'manual' as const, manualText: '-33.52, 150.42', online: false, weather: 'now' as const };
    const recs = planScenarioData(buildRequest(s, 'auto', NOW), { manifest: m, packs: [], cachedKeys: new Set(), storedWeather: false });
    for (const id of ['terrain', 'vegetation-svtm', 'fire-history', 'roads', 'canopy-height', 'imagery']) {
      expect(recs.find((r) => r.id === id)?.origin, id).toBe('bundled');
    }
    const offline = recs.map((r) => planRow(r, false)).filter((r) => r.badge.label === 'Not available offline').map((r) => r.id);
    expect(offline).not.toContain('terrain');
    expect(offline).not.toContain('vegetation-svtm');
    expect(offline).not.toContain('roads');
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

describe('the pasted place (a Google Maps link or coordinates) in the form', () => {
  const SHARE = 'Mount Tomah Botanic Garden\nhttps://www.google.com/maps/place/Mount+Tomah+Botanic+Garden/@-33.5447,150.4097,17z/data=!4m6!3m5!1s0x6b1292f3c1e5d9e1:0x5017d681632a3b0!8m2!3d-33.5447!4d150.4097';

  it('the centre and the scenario name come from the place: the name of the link, else "Your location"', () => {
    const base = { ...defaultSetup(NOW), where: 'manual' as const };
    expect(resolveCentre({ ...base, manualText: '-33.54470, 150.40970', manualName: 'Mount Tomah Botanic Garden' })).toEqual({ centre: { lat: -33.5447, lon: 150.4097 }, name: 'Mount Tomah Botanic Garden' });
    expect(resolveCentre({ ...base, manualText: '-33.54470, 150.40970' })).toEqual({ centre: { lat: -33.5447, lon: 150.4097 }, name: 'Your location' });
    expect(buildRequest({ ...base, manualText: '-33.54470, 150.40970', manualName: 'Mount Tomah Botanic Garden' }, 'auto', NOW).name).toBe('Mount Tomah Botanic Garden');
  });

  it('every way of typing coordinates (and a link kept in the text) gives a centre', () => {
    const base = { ...defaultSetup(NOW), where: 'manual' as const };
    for (const t of ['-33.7, 150.3', '-33.7,150.3', 'S 33.7 E 150.3', '33.7° S, 150.3° E', "33°42'0\"S 150°18'0\"E", 'geo:-33.7,150.3', SHARE]) {
      const c = resolveCentre({ ...base, manualText: t });
      expect('centre' in c, t).toBe(true);
    }
  });

  it('says what to do when there is no place yet, and why a pasted place was not taken', () => {
    const base = { ...defaultSetup(NOW), where: 'manual' as const };
    expect(validateSetup({ ...base, manualText: '' }, NOW)[0]).toBe('Paste a Google Maps link or enter coordinates such as -33.715, 150.285.');
    expect(validateSetup({ ...base, manualText: 'hello' }, NOW)[0]).toMatch(/coordinates/);
    expect(validateSetup({ ...base, manualText: '95, 150' }, NOW)[0]).toMatch(/Latitude must be between/);
    expect(validateSetup({ ...base, manualText: '-33.7, 150.3' }, NOW)).toEqual([]);
  });

  it('the remembered setup holds coordinates only: a pasted link and its place id never reach storage', () => {
    const s = { ...defaultSetup(NOW), where: 'manual' as const, manualText: SHARE, manualName: 'Mount Tomah Botanic Garden' };
    const p = persistable(s);
    expect(p.manualText).toBe('-33.54470, 150.40970');
    expect(p.manualName).toBe('');
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/google|goo\.gl|0x6b1292f3|Botanic|https?:/i);
  });

  it('coordinates typed by hand are remembered as typed', () => {
    expect(persistable({ ...defaultSetup(NOW), manualText: '-33.70, 149.86' }).manualText).toBe('-33.70, 149.86');
    expect(restoreSetup(JSON.parse(JSON.stringify(persistable({ ...defaultSetup(NOW), manualText: '-33.70, 149.86' }))), NOW).manualText).toBe('-33.70, 149.86');
  });

  it('an older save that kept a link is cleaned when it is restored; junk and a short link are dropped; the name never comes back', () => {
    expect(restoreSetup({ manualText: SHARE, manualName: 'x' }, NOW)).toMatchObject({ manualText: '-33.54470, 150.40970', manualName: '' });
    expect(restoreSetup({ manualText: 'https://maps.app.goo.gl/AbCdEf123' }, NOW).manualText).toBe('');
    expect(restoreSetup({ manualText: 'hello' }, NOW).manualText).toBe('');
    expect(restoreSetup({ manualText: 42 as unknown as string }, NOW).manualText).toBe('');
    expect(restoreSetup(null, NOW)).toMatchObject({ manualText: '', manualName: '' });
  });

  it('"the box" with nothing usable in it comes back as the demo site, not as nothing chosen', () => {
    expect(restoreSetup({ where: 'manual', manualText: 'https://maps.app.goo.gl/AbCdEf123' }, NOW).where).toBe('demo');
    expect(restoreSetup({ where: 'manual', manualText: '' }, NOW).where).toBe('demo');
    expect(restoreSetup({ where: 'manual', manualText: 'hello' }, NOW).where).toBe('demo');
    expect(restoreSetup({ where: 'manual', manualText: '-33.70, 149.86' }, NOW).where).toBe('manual');
  });
});
