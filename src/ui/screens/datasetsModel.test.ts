/**
 * The Data sets screen's view model on the real inventories of tests/fixtures/datasets (a bundled demo site offline, a
 * live build away from the demo sites, an offline build with every substitute, the Setup plan of the live build) and on
 * a cancelled build (nothing, or only part of the records). Expected numbers are computed from the fixtures' own totals
 * with the same formatters, never typed in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount, formatPercent, type DatasetRecord, type DatasetSummary } from '../../core/datasets';
import { FuelType } from '../../core/types';
import { overlayColour, overlayScale } from '../../render/legends';
import type { StorageReport } from '../../data/storage';
import { heatPreviewData } from './datasetViz';
import {
  availableFilters,
  capturedDates,
  clean,
  coverageWords,
  distributionModel,
  evidenceModel,
  fallbackNotes,
  filterRecords,
  formatAgo,
  formatIsoDay,
  freshness,
  glossary,
  listModel,
  memoryGroups,
  modelFacts,
  originClassOf,
  originMix,
  partFacts,
  reproduceText,
  resolutionText,
  rowModel,
  showTargets,
  sizeFacts,
  sortRecords,
  sourceFacts,
  spaceFacts,
  statFacts,
  statusCountsLine,
  storageModel,
  summaryHeader,
  timeFacts,
  type FilterId,
  type SortId,
} from './datasetsModel';

const DIR = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'datasets');
const load = (name: string): { datasets: DatasetRecord[]; summary?: DatasetSummary } => JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
const bundled = load('katoomba-bundled');
const live = load('live-nondemo');
const offline = load('offline-synthetic');
const plan = load('live-nondemo.plan');
const TZ = 'Australia/Sydney';

/** Every string reachable from a value (deep). */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}
const BAD = /(^|[^A-Za-z])(NaN|undefined|Infinity|null)([^A-Za-z]|$)/;

/** Everything the screen would show for a set of records. */
function everything(records: DatasetRecord[], summary: DatasetSummary | null | undefined, now: number): unknown {
  const lists = (['all', 'terrain', 'vegetation', 'weather', 'places', 'derived', 'yours'] as FilterId[]).flatMap((f) => (['kind', 'size', 'name', 'origin'] as SortId[]).map((s) => listModel(records, f, s)));
  return {
    header: summaryHeader(records, summary, { storedOnPhoneBytes: 1234 }),
    mix: originMix(records, summary),
    counts: statusCountsLine(records),
    fresh: freshness(records, summary, now, TZ),
    fallbacks: fallbackNotes(records, summary),
    model: modelFacts(summary),
    recipe: reproduceText(summary),
    filters: availableFilters(records),
    lists,
    details: records.map((r) => ({
      source: sourceFacts(r),
      time: timeFacts(r, now, TZ),
      space: spaceFacts(r),
      size: sizeFacts(r),
      stats: statFacts(r),
      dist: distributionModel(r),
      trust: evidenceModel(r),
      parts: partFacts(r),
      show: showTargets(r),
      res: resolutionText(r),
    })),
    memory: memoryGroups(summary?.workingMemory),
    how: glossary(summary?.model.cellSizeM),
  };
}

describe('datasetsModel: never a broken value', () => {
  const cases: [string, DatasetRecord[], DatasetSummary | null | undefined][] = [
    ['bundled Katoomba', bundled.datasets, bundled.summary],
    ['live Bilpin', live.datasets, live.summary],
    ['offline substitutes', offline.datasets, offline.summary],
    ['Setup plan', plan.datasets, null],
    ['cancelled build: nothing', [], null],
    // A build cancelled half way: some records, no summary, and a record whose optional fields are missing.
    [
      'cancelled build: partial',
      [
        live.datasets[0]!,
        { ...live.datasets[2]!, extent: undefined, crs: undefined, native: undefined, model: undefined, distribution: undefined, stats: [], parts: undefined, vintage: { retrievedAt: 0, retrievedBasis: 'unknown' } } as DatasetRecord,
      ],
      null,
    ],
  ];
  for (const [name, rs, sum] of cases) {
    it(`${name}: no "undefined", "NaN", "Infinity" or "null" in any text`, () => {
      const all = strings(everything(rs, sum, (sum?.builtAt ?? Date.UTC(2026, 8, 30)) + 3 * 3.6e6));
      expect(all.length).toBeGreaterThan(0);
      expect(all.filter((s) => BAD.test(s))).toEqual([]);
    });
  }
  it('clean() drops broken values and keeps real ones', () => {
    expect([clean(undefined), clean(null), clean(Number.NaN), clean(Infinity), clean('undefined'), clean(' NaN '), clean(0), clean(' 12 m ')]).toEqual(['', '', '', '', '', '', '0', '12 m']);
  });
});

describe('datasetsModel: summary header (DS1)', () => {
  it('a live build: downloaded, in memory and stored come from the totals', () => {
    const t = live.summary!.totals;
    const h = summaryHeader(live.datasets, live.summary);
    expect(h.mode).toBe('built');
    const byId = Object.fromEntries(h.stats.map((s) => [s.id, `${s.prefix ? `${s.prefix} ` : ''}${s.value} ${s.unit}`.trim()]));
    expect(byId.count).toBe(String(live.datasets.length));
    expect(byId.downloaded).toBe(formatBytes(t.networkBytes));
    expect(byId.memory).toBe(formatBytes(t.memoryBytes));
    expect(byId.stored).toBe(formatBytes(t.storedBytes));
    expect(h.sentence).toBe(`${live.datasets.length} data sets · ${formatBytes(t.networkBytes)} downloaded · ${formatBytes(t.memoryBytes)} in memory · ${formatBytes(t.storedBytes)} newly saved on this phone`);
    // The services compressed their answers: the uncompressed total is named.
    expect(h.notes.join(' ')).toContain(formatBytes(t.networkDecodedBytes!));
  });

  it('a bundled demo site: nothing downloaded, the number says what was read from the app', () => {
    const t = bundled.summary!.totals;
    expect(t.networkBytes).toBe(0);
    const h = summaryHeader(bundled.datasets, bundled.summary);
    const d = h.stats.find((s) => s.id === 'downloaded')!;
    expect(`${d.value} ${d.unit}`).toBe(formatBytes(t.transferredBytes - t.cachedBytes));
    expect(d.caption).toBe('from the app, nothing downloaded');
    expect(h.sentence).toContain('0 B downloaded');
  });

  it('a download whose compressed size the phone did not report is "up to"', () => {
    const rs = live.datasets.map((r) => (r.id === 'vegetation-svtm' ? { ...r, sizes: { ...r.sizes, networkUnmeasuredBytes: r.sizes.networkBytes } } : r));
    const h = summaryHeader(rs, null);
    expect(h.stats.find((s) => s.id === 'downloaded')!.prefix).toBe('up to');
    expect(h.sentence).toMatch(/· up to [0-9.]+ [KMG]?B downloaded/);
    const row = rowModel(rs.find((r) => r.id === 'vegetation-svtm')!, 1);
    expect(row.size).toBe(`up to ${formatBytes(rs.find((r) => r.id === 'vegetation-svtm')!.sizes.transferredBytes)}`);
    expect(sizeFacts(rs.find((r) => r.id === 'vegetation-svtm')!).facts.find((f) => f.key === 'Over the network')!.value).toMatch(/^up to /);
  });

  it('a plan: ≈ download, what is already on the phone, and the basis note', () => {
    const h = summaryHeader(plan.datasets, null);
    expect(h.mode).toBe('planned');
    const net = plan.datasets.reduce((a, r) => a + r.plan!.networkBytes, 0);
    const d = h.stats.find((s) => s.id === 'downloaded')!;
    expect(d.prefix).toBe('≈');
    expect(`${d.value} ${d.unit}`).toBe(formatBytes(net));
    expect(h.notes[0]).toMatch(/estimates of the uncompressed answers/);
  });

  it('nothing built and no plan: what is stored on the phone', () => {
    const h = summaryHeader([], null, { storedOnPhoneBytes: 5_300_000 });
    expect(h.mode).toBe('empty');
    expect(h.sentence).toContain(formatBytes(5_300_000));
  });
});

describe('datasetsModel: origin mix, freshness, substitutes, model (DS1)', () => {
  it('the mix is the share of the model cells by origin, adding up to 100 %', () => {
    const m = originMix(bundled.datasets, bundled.summary);
    expect(m.basis).toBe('cells');
    const cells = bundled.summary!.totals.cellShareByOrigin;
    expect(m.parts.map((p) => p.cls)).toEqual(['bundled', 'synthetic']);
    expect(m.parts[0]!.share).toBeCloseTo(cells.bundled!, 6);
    expect(m.parts[1]!.share).toBeCloseTo(cells.derived!, 6); // filled in by inference = estimated
    expect(m.parts.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1, 6);
    expect(m.label).toContain(formatPercent(cells.bundled!));
  });

  it('a plan mixes the data sets by their likely origin', () => {
    const m = originMix(plan.datasets, null);
    expect(m.basis).toBe('datasets');
    expect(m.parts.find((p) => p.cls === 'live')).toBeTruthy();
  });

  it('origin words map to the five classes', () => {
    expect(['live', 'cache', 'area-pack', 'bundled', 'synthetic', 'preset', 'derived', 'user', 'none'].map((o) => originClassOf(o as never))).toEqual(['live', 'saved', 'saved', 'bundled', 'synthetic', 'synthetic', 'synthetic', 'user', null]);
  });

  it('freshness: newest and oldest capture dates with their data sets, the weather age, the build time', () => {
    const f = freshness(bundled.datasets, bundled.summary, bundled.summary!.builtAt, TZ);
    expect(f.lines[0]).toMatch(/^Newest data captured 29 Sep 2026 \(Roads and tracks\); oldest 2016 \(Tree canopy height\)\.$/);
    expect(f.lines.some((l) => /^Weather: a day designed by the app/.test(l))).toBe(true);
    const w = live.datasets.find((r) => r.id === 'weather')!;
    const g = freshness(live.datasets, live.summary, w.vintage.retrievedAt + 3 * 3.6e6, TZ);
    expect(g.lines.find((l) => l.startsWith('Weather'))).toMatch(/^Weather downloaded 3 h ago \(/);
    expect(g.weatherStale).toBe(false);
    const stale = freshness(live.datasets, live.summary, w.vintage.retrievedAt + 30 * 3.6e6, TZ);
    expect(stale.weatherStale).toBe(true);
    expect(stale.lines.find((l) => l.startsWith('Weather'))).toContain('check it against your belt weather kit');
  });

  it('freshness: the days a weather series COVERS are not capture dates (no "oldest 27 Sep (Weather forecast)")', () => {
    const w = JSON.parse(JSON.stringify(live.datasets.find((r) => r.id === 'weather'))) as DatasetRecord;
    w.vintage.capturedOn = '2026-09-27/2026-10-05'; // what the builder records for a live forecast: the days it covers
    const recs = live.datasets.map((r) => (r.id === 'weather' ? w : r));
    for (const line of freshness(recs, live.summary, w.vintage.retrievedAt, TZ).lines) expect(line).not.toMatch(/Weather forecast|2026-09-27|27 Sep 2026 \(Weather/);
    // A bundled historic day is described by its own day and the day the copy was made, not as "captured" on the copy date.
    const r = JSON.parse(JSON.stringify(w)) as DatasetRecord;
    r.origin = 'bundled';
    r.vintage = { retrievedAt: Date.UTC(2026, 8, 27), retrievedBasis: 'bundle-capture', capturedOn: '2019-12-19' };
    const line = freshness(recs.map((x) => (x.id === 'weather' ? r : x)), live.summary, Date.now(), TZ).lines.find((l) => l.startsWith('Weather'))!;
    expect(line).toBe('Weather: the weather model’s values for 19 Dec 2019, bundled with the app (copied from the weather service on 27 Sep 2026).');
  });

  it('the model facts follow the ENGINE once it reports: the fast tier is never described as the 3-D air (the summary only knows what was asked for)', () => {
    const fast = {
      tier: 'fast' as const,
      tierCause: 'auto-tune' as const,
      tierReason: 'Auto: the first 20 3-D steps took 78.7 ms each on this device, so the whole 6.0 h run was predicted to take 238 s against a budget of 120 s: too slow, so the fast tier (no time-stepped 3-D air flow) was chosen.',
      atmosphere: { kind: 'diagnostic' as const, nx: 45, ny: 45, nz: 20, dxM: 133.3, dzFirstM: 30, topM: 3000, stretch: 1.1, currentStepS: 10, meanStepMs: 5, spunUp: false, upperAir: 'preset' as const, viewDecimated: false },
    };
    const f = modelFacts(bundled.summary, fast);
    const tier = f.find((x) => x.key === 'Detail tier')!;
    expect(tier.value).toBe('Fast: a 2-D wind shaped by the ground (no 3-D air movement) (chosen by Auto after timing this phone)');
    expect(tier.note).toBe(fast.tierReason);
    expect(JSON.stringify(f)).not.toMatch(/starts on Standard/);
    const grid = f.find((x) => x.key === 'Wind grid')!;
    expect(grid.value).toBe('45 x 45 columns of 133 m, 20 levels');
    expect(grid.note).toMatch(/uses only the wind at the surface/);
    expect(f.find((x) => x.key === 'Atmosphere grid')).toBeUndefined();
    // On the 3-D air, the grid is the air the engine steps, and a tier asked for says so.
    const air = modelFacts(bundled.summary, { ...fast, tier: 'standard', tierCause: 'requested', tierReason: 'Asked for when the run started: the standard 3-D atmosphere.', atmosphere: { ...fast.atmosphere, kind: '3d' } });
    expect(air.find((x) => x.key === 'Detail tier')!.value).toBe('Standard: 3-D atmosphere (asked for when the run started)');
    expect(air.find((x) => x.key === 'Atmosphere grid')!.value).toBe('45 x 45 columns of 133 m, 20 levels up from the ground');
    // Before the engine reports, Auto is described as what it is: a decision still to come.
    expect(modelFacts(bundled.summary, null).find((x) => x.key === 'Detail tier')!.value).toMatch(/^Auto: starts on Standard/);
  });

  it('coverage: only obtained data are "Real data"; designed, typed and worked-out data sets are named for what they are', () => {
    expect(coverageWords({ origin: 'bundled', coverage: { fraction: 1 } })).toEqual({ label: 'Real data cover', suffix: '' });
    expect(coverageWords({ origin: 'live', coverage: { fraction: 0.4 } }).label).toBe('Real data cover');
    expect(coverageWords({ origin: 'synthetic', coverage: { fraction: 0 } }).label).toBe('Real data cover'); // made-up ground: 0 % real
    expect(coverageWords({ origin: 'preset', coverage: { fraction: 1 } })).toEqual({ label: 'Covers', suffix: ' (made up by the app, not real data)' });
    expect(coverageWords({ origin: 'user', coverage: { fraction: 1 } }).label).toBe('Covers');
    expect(coverageWords({ origin: 'derived', coverage: { fraction: 1 } }).label).toBe('Covers');
    const preset = bundled.datasets.find((r) => r.id === 'weather')!;
    const facts = spaceFacts(preset);
    expect(facts.find((x) => x.key === 'Real data cover')).toBeUndefined();
    expect(facts.find((x) => x.key === 'Covers')!.value).toMatch(/100 % of the model area \(made up by the app, not real data\)$/);
    expect(spaceFacts(bundled.datasets.find((r) => r.id === 'terrain')!).find((x) => x.key === 'Real data cover')!.value).toMatch(/^100 % of the model area$/);
  });

  it('substitutes come with their reasons, in the summary order', () => {
    const fb = fallbackNotes(live.datasets, live.summary);
    expect(fb.map((f) => f.id)).toEqual(live.summary!.fallbacks.map((f) => f.id));
    expect(fb.find((f) => f.id === 'drought-history')!.reason).toMatch(/HTTP 429/);
    // Without a summary (a plan), the records' own reasons.
    expect(fallbackNotes(plan.datasets).every((f) => f.reason.length > 0)).toBe(true);
  });

  it('the model facts read the grid from the summary', () => {
    const m = bundled.summary!.model;
    const f = modelFacts(bundled.summary);
    expect(f.find((x) => x.key === 'Fire grid')!.value).toBe(`${m.nx} x ${m.ny} cells of ${m.cellSizeM} m (${formatCount(m.nx * m.ny).replace(/\u2009/g, '\u202f')} cells)`);
    expect(f.find((x) => x.key === 'Area')!.value).toContain(`${m.extentM / 1000} km x ${m.extentM / 1000} km`);
    expect(f.find((x) => x.key === 'Atmosphere grid')!.value).toBe(`${m.atmosCellM} m cells, ${m.atmosLevels} levels up from the ground`);
    expect(f.find((x) => x.key === 'Detail tier')!.value).toMatch(/^Auto: starts on Standard/);
    expect(reproduceText(bundled.summary)).toContain(`FireSim scenario ${bundled.summary!.scenarioId}`);
    expect(reproduceText(bundled.summary)).toContain(`Seed: ${bundled.summary!.seed}`);
  });
});

describe('datasetsModel: list (DS2)', () => {
  it('filters: only the ones with data sets, with counts', () => {
    const f = availableFilters(live.datasets);
    expect(f[0]).toMatchObject({ id: 'all', count: live.datasets.length });
    expect(f.find((x) => x.id === 'places')!.count).toBe(5);
    expect(filterRecords(live.datasets, 'yours').map((r) => r.id)).toEqual(['user-edits']);
    expect(filterRecords(live.datasets, 'terrain').map((r) => r.id).sort()).toEqual(['imagery', 'terrain']);
    expect(filterRecords(live.datasets, 'derived').map((r) => r.id)).toContain('fuel-derived');
  });

  it('sorts: size biggest first, name A-Z, origin live first and not-used last', () => {
    const bySize = sortRecords(live.datasets, 'size');
    for (let i = 1; i < bySize.length; i++) expect(bySize[i - 1]!.sizes.transferredBytes).toBeGreaterThanOrEqual(bySize[i]!.sizes.transferredBytes);
    const byName = sortRecords(live.datasets, 'name').map((r) => r.title);
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b, 'en')));
    const byOrigin = sortRecords(live.datasets, 'origin');
    expect(byOrigin[0]!.origin).toBe('live');
    expect(byOrigin[byOrigin.length - 1]!.origin).toBe('none');
  });

  it('kind order groups rows under the role titles', () => {
    const l = listModel(bundled.datasets, 'all', 'kind');
    expect(l[0]!.title).toBe('Ground shape');
    expect(l.flatMap((s) => s.rows).length).toBe(bundled.datasets.length);
    expect(listModel(bundled.datasets, 'all', 'size')).toHaveLength(1);
  });

  it('a row: origin, status, sizes, resolution, spark bar and the bar against the largest', () => {
    const max = Math.max(...live.datasets.map((r) => r.sizes.transferredBytes));
    const t = rowModel(live.datasets.find((r) => r.id === 'terrain')!, max);
    const rec = live.datasets.find((r) => r.id === 'terrain')!;
    expect(t.origin).toEqual({ cls: 'live', label: 'Live' });
    expect(t.status).toBeNull();
    expect(t.size).toBe(formatBytes(rec.sizes.transferredBytes));
    expect(t.memory).toBe(formatBytes(rec.sizes.memoryBytes!));
    expect(t.fraction).toBeCloseTo(rec.sizes.transferredBytes / max, 6);
    expect(t.spark?.length).toBe(rec.distribution!.values.length);
    expect(t.resolution).toMatch(/ m → 30 m$/);
    expect(t.label).toContain('Ground height');
  });

  it('data that were not used say so, with the reason', () => {
    const img = rowModel(live.datasets.find((r) => r.id === 'imagery')!, 1);
    expect(img.status).toMatchObject({ label: 'Not used', notUsed: true });
    expect(img.reason).toMatch(/bundled only for the (eight )?demo sites/); // the recorded live build (tests/fixtures/datasets) was made when there were eight; the app's own words no longer count them
    const canopy = rowModel(live.datasets.find((r) => r.id === 'canopy-height')!, 1);
    expect(canopy.status).toMatchObject({ label: 'Substitute used', tone: 'watch' });
    expect(canopy.reason.length).toBeGreaterThan(10);
  });

  it('planned rows are "≈" estimates with the likely origin', () => {
    const t = rowModel(plan.datasets.find((r) => r.id === 'terrain')!, 1);
    expect(t.size).toBe(`≈ ${formatBytes(plan.datasets.find((r) => r.id === 'terrain')!.plan!.networkBytes)}`);
    expect(t.estimate).toBe(true);
    expect(t.origin?.cls).toBe('live');
    expect(t.spark).toBeNull();
  });
});

describe('datasetsModel: detail (DS3)', () => {
  const terrain = bundled.datasets.find((r) => r.id === 'terrain')!;

  it('sizes: the parts by source add up to what was obtained; bars for obtained, unpacked, memory', () => {
    const s = sizeFacts(terrain);
    const bundledPart = s.facts.find((f) => f.key === 'From files bundled with the app');
    expect(bundledPart?.value).toBe(formatBytes(terrain.sizes.transferredBytes));
    expect(s.bars.map((b) => b.label)).toEqual(['Obtained', 'Unpacked', 'In memory']);
    const v = live.datasets.find((r) => r.id === 'vegetation-svtm')!;
    const sv = sizeFacts(v);
    expect(sv.facts.find((f) => f.key === 'Over the network')!.note).toContain(`${formatBytes(v.sizes.networkDecodedBytes!)} once uncompressed`);
    expect(sv.bars.find((b) => b.label === 'Uncompressed')!.text).toBe(formatBytes(v.sizes.networkDecodedBytes!));
  });

  it('planned sizes give the range and the basis', () => {
    const p = plan.datasets.find((r) => r.id === 'vegetation-svtm')!;
    const s = sizeFacts(p);
    expect(s.facts.find((f) => f.key === 'Planned download')!.note).toContain(`${formatBytes(p.plan!.lowBytes)} to ${formatBytes(p.plan!.highBytes)}`);
    expect(s.facts.find((f) => f.key === 'How it was estimated')!.value).toBe(p.plan!.basis);
  });

  it('space: corners, area, coverage and resolution as published and in the model', () => {
    const f = spaceFacts(terrain);
    const e = terrain.extent!;
    expect(f.find((x) => x.key === 'North-west corner')!.value).toBe(`${Math.abs(e.north).toFixed(4)}° S, ${e.west.toFixed(4)}° E`);
    expect(f.find((x) => x.key === 'Area')!.value).toBe(`${e.areaKm2} km²`);
    expect(f.find((x) => x.key === 'In the model')!.value).toMatch(/^30 m cells, 300 x 300; Finer cells averaged|^30 m cells, 300 x 300; finer cells averaged/);
    const veg = spaceFacts(bundled.datasets.find((r) => r.id === 'vegetation-svtm')!);
    expect(veg.find((x) => x.key === 'Real data cover')!.value).toContain('vegetation inferred from terrain and canopy');
  });

  it('time: capture date, when this copy was obtained, version', () => {
    const c = timeFacts(bundled.datasets.find((r) => r.id === 'canopy-height')!, Date.UTC(2026, 8, 30), TZ);
    expect(c.find((x) => x.key === 'Captured')!.value).toBe('2016');
    expect(c.find((x) => x.key === 'This copy obtained')!.value).toMatch(/^\d{1,2} [A-Z][a-z]{2} 2026 \(when the copy bundled with the app was made\)$/);
    const w = live.datasets.find((r) => r.id === 'weather')!;
    expect(timeFacts(w, w.vintage.retrievedAt + 2 * 3.6e6, TZ).find((x) => x.key === 'This copy obtained')!.value).toMatch(/2 h ago$/);
  });

  it('time: a weather series is dated by the days it covers, never "Captured" (19 Dec 2019 is not when it was copied)', () => {
    const w = live.datasets.find((r) => r.id === 'weather')!;
    const f = timeFacts(w, w.vintage.retrievedAt, TZ);
    expect(f.some((x) => x.key === 'Captured' || x.key === 'About the capture date')).toBe(false);
    expect(f.find((x) => x.key === 'Days covered')?.value).toBeTruthy();
    expect(f.find((x) => x.key === 'About these days')?.value).toMatch(/covers/);
    // The captured-on label of a map layer is unchanged.
    expect(timeFacts(bundled.datasets.find((r) => r.id === 'canopy-height')!, Date.UTC(2026, 8, 30), TZ).some((x) => x.key === 'Captured')).toBe(true);
  });

  it('header: the "saved" number is what THIS build saved (0 B when it only read stored copies), and says so', () => {
    const second = { ...live.summary!, totals: { ...live.summary!.totals, networkBytes: 0, networkUnmeasuredBytes: 0, storedBytes: 0 } };
    const h = summaryHeader(live.datasets, second);
    expect(h.stats.find((x) => x.id === 'stored')!.caption).toBe('newly saved on this phone');
    expect(h.sentence).toMatch(/0 B newly saved on this phone$/);
  });

  it('statistics exactly as recorded, hints as notes', () => {
    const s = statFacts(terrain);
    expect(s.map((x) => x.value)).toEqual(terrain.stats.map((x) => x.value));
    expect(s.find((x) => x.key === 'Steep slope (90th percentile)')!.note).toBe(terrain.stats.find((x) => x.label === 'Steep slope (90th percentile)')!.hint);
  });

  it('distribution: histogram with its axis, categories largest first', () => {
    const d = distributionModel(terrain)!;
    expect(d.kind).toBe('histogram');
    expect(d.bars).toHaveLength(terrain.distribution!.values.length);
    expect(Math.max(...d.bars.map((b) => b.height))).toBe(1);
    expect(d.axis!.lo).toBe(`${Math.round(terrain.distribution!.edges![0]!)} m`);
    const v = distributionModel(bundled.datasets.find((r) => r.id === 'vegetation-svtm')!)!;
    expect(v.kind).toBe('categorical');
    for (let i = 1; i < v.bars.length; i++) expect(v.bars[i - 1]!.share).toBeGreaterThanOrEqual(v.bars[i]!.share);
  });

  it('trust: the level word, its gloss and the spec reference', () => {
    const e = evidenceModel(terrain)!;
    expect(e).toMatchObject({ level: 'measured', title: 'Measured', tone: 'ok', specRef: terrain.evidence.specRef });
    expect(evidenceModel(bundled.datasets.find((r) => r.id === 'weather')!)!.tone).toBe('watch');
  });

  it('source: provider, licence, services with host and path', () => {
    const s = sourceFacts(terrain);
    expect(s.find((x) => x.key === 'Provider')!.value).toBe(terrain.provider.name);
    expect(s.find((x) => x.key === 'Original service')!.value).toContain('maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer');
  });

  it('show on map: heat map, scene layer or both, from the layer catalog; nothing for data that were not used', () => {
    expect(showTargets(terrain)).toEqual([expect.objectContaining({ kind: 'heat', label: 'Show on map', target: { overlay: 'elevation' } })]);
    const roads = showTargets(bundled.datasets.find((r) => r.id === 'roads')!);
    expect(roads.map((t) => t.target)).toEqual([{ sceneKey: 'roads' }, { overlay: 'roadAccess' }]);
    expect(roads[1]!.label).toBe('Show as heat map');
    expect(showTargets(live.datasets.find((r) => r.id === 'imagery')!)).toEqual([]);
    // Availability comes from the catalog: no 3-D wind yet, no heat map of it.
    const w = showTargets(bundled.datasets.find((r) => r.id === 'weather')!, { hasFire: false, has3dAtmosphere: false, hasContext: true, hasGrass: false, hasCanopyData: true, hasImagery: true });
    expect(w.find((t) => t.kind === 'heat')!.ok).toBe(false);
    expect(w.find((t) => t.kind === 'heat')!.reason).toMatch(/3-D atmosphere/);
  });
});

describe('datasetsModel: memory, storage, glossary (DS4, DS6)', () => {
  it('working memory groups add up to the total', () => {
    const wm = live.summary!.workingMemory!;
    const m = memoryGroups(wm);
    expect(m.totalBytes).toBe(wm.totalBytes);
    expect(m.groups.reduce((a, g) => a + g.bytes, 0)).toBe(wm.mainBytes + wm.workerBytes + wm.gpuBytes);
    expect(m.groups.map((g) => g.where)).toEqual(['main', 'worker', 'gpu']);
    for (const g of m.groups) for (let i = 1; i < g.items.length; i++) expect(g.items[i - 1]!.bytes).toBeGreaterThanOrEqual(g.items[i]!.bytes);
    expect(memoryGroups(undefined).groups).toEqual([]);
  });

  it('storage rows with sizes, dates, bars and the quota', () => {
    const rep: StorageReport = {
      bundled: { totalBytes: 30_600_000, sites: [{ id: 'katoomba', name: 'Katoomba', bytes: 4_400_000, capturedOn: '2026-09-29' }], replaysBytes: 204_000, available: true },
      caches: [{ kind: 'weather', title: 'Weather downloads', what: 'x', bytes: 80_000, entries: 2, oldest: Date.UTC(2026, 8, 28), newest: Date.UTC(2026, 8, 30), places: [{ label: 'Bilpin', bytes: 80_000, entries: 2 }] }],
      cacheBytes: 80_000,
      packs: [{ id: 'p1', name: 'Home', centre: { lat: -33.52, lon: 150.42 }, extentM: 6000, createdAt: Date.UTC(2026, 8, 29), bytes: 12_000_000, items: [{ name: 'terrain', bytes: 1 }] }],
      packBytes: 12_000_000,
      onDeviceBytes: 12_080_000,
      browserEstimate: { usageBytes: 3_300_000, quotaBytes: 1_000_000_000 },
      warnings: [],
      notes: ['n'],
    };
    const s = storageModel(rep, TZ);
    expect(s.headline).toBe(`${formatBytes(30_600_000)} bundled with the app · ${formatBytes(80_000)} of stored copies · 1 saved area (${formatBytes(12_000_000)})`);
    expect(s.bundled.sites[0]).toMatchObject({ size: formatBytes(4_400_000), captured: '29 Sep 2026' });
    expect(s.caches[0]!.places).toBe(`Place: Bilpin (${formatBytes(80_000)})`);
    expect(s.caches[0]!.dates).toMatch(/^stored \d+ Sep 2026 to \d+ Sep 2026$/);
    expect(s.packs[0]).toMatchObject({ name: 'Home', size: formatBytes(12_000_000), items: '1 item' });
    expect(s.packs[0]!.fraction).toBe(1);
    expect(s.quota!.text).toBe(`${formatBytes(3_300_000)} of ${formatBytes(1_000_000_000)} (${formatPercent(0.0033)})`);
  });

  it('the glossary names the five origin words and the model cell when known', () => {
    const g = glossary(30);
    expect(g.origins.map((x) => x.term)).toEqual(['Live', 'Saved on device', 'Bundled with the app', 'Estimated or synthetic', 'Your edits']);
    expect(g.resolution[1]!.text).toContain('30 m');
    expect(glossary().resolution[1]!.text).not.toContain('undefined');
  });
});

describe('datasetsModel: small formatters', () => {
  it('dates and ages', () => {
    expect([formatIsoDay('2026-09-07'), formatIsoDay('2026-09'), formatIsoDay('2016'), formatIsoDay('2019/2020'), formatIsoDay(undefined)]).toEqual(['7 Sep 2026', 'Sep 2026', '2016', '', '']);
    expect(capturedDates('2013-10-16 to 2014-01-20')).toEqual(['2013-10-16', '2014-01-20']);
    expect(capturedDates('2019/2020')).toEqual(['2019', '2020']);
    const t = Date.UTC(2026, 8, 30, 6);
    expect([formatAgo(t, t + 20e3), formatAgo(t, t + 25 * 6e4), formatAgo(t, t + 3 * 3.6e6), formatAgo(t, t + 4 * 8.64e7), formatAgo(Number.NaN, t)]).toEqual(['just now', '25 min ago', '3 h ago', '4 days ago', '']);
  });
});

describe('datasetViz: heat-map preview in the map colours', () => {
  // A 3 x 2 terrain rising to the north-east, with a fuel map of two types.
  const grid = { nx: 3, ny: 2, cellSize: 30, x0: -30, y0: -15, origin: { lat: -33.7, lon: 150.3 } };
  const elevation = new Float32Array([100, 200, 300, 400, 500, 600]);
  const zeros = (): Float32Array => new Float32Array(6);
  const terrain = { grid, elevation, slopeDeg: zeros(), aspectDeg: new Float32Array(6).fill(Number.NaN), dzdx: zeros(), dzdy: zeros(), tpi: zeros(), curvature: zeros(), landform: new Uint8Array(6), minElevation: 100, maxElevation: 600, source: 'test' };
  const fuel = { grid, type: new Uint8Array([FuelType.DryForestShrubby, FuelType.DryForestShrubby, FuelType.Heath, FuelType.Heath, FuelType.Heath, FuelType.Heath]) } as never;

  it('elevation: the pixels are the heat map colours, north up', () => {
    const d = heatPreviewData('elevation', { terrain: terrain as never, fuel, context: undefined })!;
    expect([d.width, d.height]).toEqual([3, 2]);
    const scale = overlayScale('elevation', { elevationRange: [100, 600] })!;
    // Row 0 of the picture is the northern row of the grid (j = 1): its first cell is elevation 400.
    const c = overlayColour(scale, 400)!;
    const shade = 0.8 + 0.28 * Math.cos(Math.PI / 4); // flat ground under the light hill shade
    expect(d.rgba[0]).toBe(Math.round(Math.min(1, c[0] * shade) * 255));
    expect(d.rgba[3]).toBe(255);
    expect(d.range).toEqual([100, 600]);
    expect(d.legend?.kind).toBe('continuous');
  });

  it('fuel type: the legend lists the classes present with their shares', () => {
    const d = heatPreviewData('fuelType', { terrain: terrain as never, fuel, context: undefined })!;
    expect(d.keys.map((k) => k.share)).toEqual([4 / 6, 2 / 6]);
    expect(d.keys[0]!.label.length).toBeGreaterThan(0);
  });

  it('a map that needs what is not loaded gives no preview', () => {
    expect(heatPreviewData('roadAccess', { terrain: terrain as never, fuel, context: undefined })).toBeNull();
    expect(heatPreviewData('windSpeed', { terrain: terrain as never, fuel, context: undefined }, null)).toBeNull();
    expect(heatPreviewData('none', { terrain: terrain as never, fuel, context: undefined })).toBeNull();
  });
});
