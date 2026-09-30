/**
 * The data-set contract's pure helpers: formatting (base-10 bytes like Android), sorting and grouping, the summary
 * totals, staleness, credits, the typed-array footprint, the validator, and the JSON / CSV / text exports.
 */
import { describe, expect, it } from 'vitest';
import {
  ageHours,
  compareDatasets,
  creditLines,
  datasetIssues,
  datasetsToCsv,
  datasetsToJson,
  datasetsToText,
  formatAge,
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  groupByRole,
  imageryCredit,
  resummarise,
  sortDatasets,
  stableStringify,
  summariseDatasets,
  typedArrayFootprint,
  upsertDataset,
  weatherStaleness,
  type DatasetRecord,
  type SummaryInput,
} from './datasets';

const rec = (o: Partial<DatasetRecord> & Pick<DatasetRecord, 'id' | 'role'>): DatasetRecord => ({
  title: o.id,
  what: 'What it is.',
  why: 'Why it is used.',
  provider: { name: 'Provider' },
  licence: { name: 'CC BY 4.0' },
  attribution: `© ${o.id}`,
  endpoints: [],
  sourceServices: [],
  format: 'JSON',
  kind: 'raster',
  status: 'used',
  origin: 'live',
  vintage: { retrievedAt: Date.UTC(2026, 8, 29), retrievedBasis: 'this-build' },
  coverage: { fraction: 1 },
  sizes: { transferredBytes: 1000, networkBytes: 1000, cachedBytes: 0, requests: 1 },
  stats: [],
  evidence: { level: 'measured', note: 'n' },
  warnings: [],
  limitations: [],
  ...o,
});

const INPUT: SummaryInput = {
  scenarioId: 's',
  scenarioName: 'S, "quoted"',
  seed: 3,
  builtAt: Date.UTC(2026, 8, 30, 1),
  buildDurationMs: 1234,
  model: { nx: 200, ny: 200, cells: 40000, cellSizeM: 30, extentM: 6000, durationS: 14400, startTime: 0 },
  warnings: ['a', 'a', 'b'],
  reproduce: { scenarioId: 's', seed: 3, centre: { lat: -33.5, lon: 150.4 }, bbox: [150.37, -33.55, 150.43, -33.49], extentM: 6000, cellSizeM: 30, startTime: 0, durationS: 14400, weatherMode: 'now', online: true },
};

describe('formatting', () => {
  it('bytes are base-10 with one decimal, like the Android storage screen', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1.0 KB');
    expect(formatBytes(1449)).toBe('1.4 KB');
    expect(formatBytes(999_949)).toBe('999.9 KB');
    expect(formatBytes(999_999)).toBe('1.0 MB');
    expect(formatBytes(1_411_059)).toBe('1.4 MB');
    expect(formatBytes(3.2e9)).toBe('3.2 GB');
    for (const bad of [NaN, -5, Infinity, undefined, null]) expect(formatBytes(bad as number)).toBe('0 B');
  });
  it('counts, percentages, durations and ages', () => {
    expect(formatCount(7368)).toBe('7\u2009368');
    expect(formatCount(NaN)).toBe('0');
    expect(formatPercent(0)).toBe('0 %');
    expect(formatPercent(0.0004)).toBe('<0.1 %');
    expect(formatPercent(0.034)).toBe('3.4 %');
    expect(formatPercent(0.834)).toBe('83 %');
    expect(formatDuration(230)).toBe('230 ms');
    expect(formatDuration(1400)).toBe('1.4 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(formatAge(0.4)).toBe('24 min old');
    expect(formatAge(7)).toBe('7 h old');
    expect(formatAge(72)).toBe('3 days old');
    expect(ageHours(0, 3.6e6 * 2)).toBe(2);
  });
});

describe('sorting, grouping, updating', () => {
  const rs = [rec({ id: 'roads', role: 'context', sizes: { transferredBytes: 5, networkBytes: 5, cachedBytes: 0, requests: 1 } }), rec({ id: 'terrain', role: 'terrain' }), rec({ id: 'weather', role: 'weather', status: 'fallback', fallbackReason: 'offline' }), rec({ id: 'zz-new', role: 'context' })];
  it('canonical order: role, then the known id order, unknown ids last', () => {
    expect(sortDatasets(rs).map((r) => r.id)).toEqual(['terrain', 'weather', 'roads', 'zz-new']);
    expect(sortDatasets(rs, 'size')[0]!.id).not.toBe('roads');
    expect(sortDatasets(rs, 'status')[0]!.id).toBe('weather');
    expect([...rs].sort(compareDatasets).map((r) => r.id)).toEqual(['terrain', 'weather', 'roads', 'zz-new']);
    expect(rs.map((r) => r.id)).toEqual(['roads', 'terrain', 'weather', 'zz-new']); // not mutated
  });
  it('groups by role with totals', () => {
    const g = groupByRole(rs);
    expect(g.map((x) => x.role)).toEqual(['terrain', 'weather', 'context']);
    expect(g[2]!.transferredBytes).toBe(1005);
    expect(g[2]!.title).toBe('Roads, homes and places');
  });
  it('upsert replaces by id and the summary re-totals', () => {
    const s = summariseDatasets(rs, INPUT);
    const next = upsertDataset(rs, rec({ id: 'roads', role: 'context', sizes: { transferredBytes: 50, networkBytes: 50, cachedBytes: 0, requests: 2 } }));
    expect(next).toHaveLength(4);
    const s2 = resummarise(s, next);
    expect(s2.totals.transferredBytes).toBe(s.totals.transferredBytes + 45);
    expect(s2.scenarioName).toBe(s.scenarioName);
  });
});

describe('summary', () => {
  it('totals, statuses, fallbacks, de-duplicated warnings and the share of cells by origin', () => {
    const rs = [
      rec({ id: 'terrain', role: 'terrain', origin: 'bundled', sizes: { transferredBytes: 100, networkBytes: 0, cachedBytes: 0, requests: 2, memoryBytes: 10 } }),
      rec({ id: 'vegetation-svtm', role: 'vegetation', status: 'partial', origin: 'bundled', coverage: { fraction: 0.8, filledBy: 'inferred', filledOrigin: 'derived' } }),
      rec({ id: 'canopy-height', role: 'canopy', status: 'fallback', origin: 'none', fallbackReason: 'none here', coverage: { fraction: 0, filledOrigin: 'derived' } }),
      rec({ id: 'fire-history', role: 'fireHistory', origin: 'live' }),
      rec({ id: 'weather', role: 'weather', origin: 'cache', vintage: { retrievedAt: 1, retrievedBasis: 'stored-copy', stale: true, ageHoursAtBuild: 9, staleAfterHours: 6 } }),
    ];
    const s = summariseDatasets(rs, INPUT);
    expect(s.totals.count).toBe(5);
    expect(s.totals.byStatus).toMatchObject({ used: 3, partial: 1, fallback: 1 });
    expect(s.totals.transferredBytes).toBe(100 + 4 * 1000);
    expect(s.totals.memoryBytes).toBe(10);
    const share = s.totals.cellShareByOrigin;
    expect(Object.values(share).reduce((a, v) => a + v!, 0)).toBeCloseTo(1, 6);
    expect(share.bundled).toBeCloseTo((1 + 0.8) / 4, 6);
    expect(share.derived).toBeCloseTo((0.2 + 1) / 4, 6);
    expect(s.fallbacks.map((f) => f.id)).toEqual(['vegetation-svtm', 'canopy-height', 'weather']);
    expect(s.fallbacks[2]!.reason).toMatch(/9 h old/);
    expect(s.warnings).toEqual(['a', 'b']);
  });
});

describe('staleness and credits', () => {
  it('6 h for a forecast, 24 h for a past day; presets never go stale', () => {
    const now = Date.UTC(2026, 8, 30, 12);
    const w = rec({ id: 'weather', role: 'weather', origin: 'cache', vintage: { retrievedAt: now - 7 * 3.6e6, retrievedBasis: 'stored-copy' } });
    expect(weatherStaleness(w, now, 'forecast')).toMatchObject({ stale: true, thresholdHours: 6 });
    expect(weatherStaleness(w, now, 'forecast').message).toMatch(/7 h old: check it against your belt weather kit/);
    expect(weatherStaleness(w, now, 'past').stale).toBe(false);
    expect(weatherStaleness({ ...w, origin: 'preset' }, now, 'forecast').stale).toBe(false);
  });
  it('credit lines only for real data, once each; the imagery credit carries its capture text', () => {
    const rs = [
      rec({ id: 'terrain', role: 'terrain', attribution: '© A' }),
      rec({ id: 'roads', role: 'context', attribution: '© A' }),
      rec({ id: 'weather', role: 'weather', origin: 'preset', attribution: 'FireSim' }),
      rec({ id: 'bundled-site', role: 'bundle', origin: 'bundled', attribution: 'FireSim' }),
      rec({ id: 'imagery', role: 'imagery', origin: 'bundled', attribution: '© NSW', vintage: { retrievedAt: 1, retrievedBasis: 'bundle-capture', captureSummary: 'a mosaic of several capture dates' } }),
    ];
    expect(creditLines(rs)).toEqual(['© A', '© NSW']);
    expect(creditLines(rs, ['imagery'])).toEqual(['© NSW']);
    expect(imageryCredit(rs)).toBe('Aerial photo © NSW; a mosaic of several capture dates');
    expect(imageryCredit([rec({ id: 'imagery', role: 'imagery', status: 'unavailable', origin: 'none' })])).toBe('');
  });
});

describe('typed-array footprint', () => {
  it('counts each buffer once, follows maps and arrays, and honours skip', () => {
    const shared = new Float32Array(100);
    const view = new Uint8Array(shared.buffer, 0, 10);
    const inner = { a: new Float64Array(10) };
    const root = { x: shared, y: view, z: [inner, inner], m: new Map([['k', new Int32Array(5)]]), s: 'text', n: 5 };
    const r = typedArrayFootprint(root);
    expect(r.bytes).toBe(400 + 80 + 20);
    expect(r.buffers).toBe(3);
    expect(r.byKey).toEqual({ x: 400, z: 80, m: 20 });
    expect(typedArrayFootprint(root, { skip: [inner] }).bytes).toBe(420);
    const cyc: Record<string, unknown> = { a: new Uint8Array(3) };
    cyc['self'] = cyc;
    expect(typedArrayFootprint(cyc).bytes).toBe(3);
  });
});

describe('validator and exports', () => {
  const rs = [
    rec({ id: 'terrain', role: 'terrain', stats: [{ label: 'Relief, "high"', value: '827 m', raw: 827, unit: 'm' }], warnings: ['w1'], limitations: ['l1'] }),
    rec({ id: 'weather', role: 'weather', status: 'fallback', origin: 'preset', fallbackReason: 'offline, no stored forecast', endpoints: [{ host: 'api.open-meteo.com', path: '/v1/forecast' }] }),
  ];
  const s = summariseDatasets(rs, INPUT);
  it('a sound record set has no issues; broken ones are named', () => {
    expect(datasetIssues(rs)).toEqual([]);
    const bad = [rec({ id: 'x', role: 'terrain', status: 'fallback', sizes: { transferredBytes: 1.5, networkBytes: 0, cachedBytes: 0, requests: -1 }, endpoints: [{ host: 'h', path: '/q?key=1' }], what: 'NaN metres' }), rec({ id: 'x', role: 'terrain' })];
    const issues = datasetIssues(bad).join('\n');
    for (const m of ['duplicate id', 'sizes.transferredBytes', 'sizes.requests', 'fallback without a reason', 'endpoint with a query', "contains 'NaN'"]) expect(issues).toContain(m);
  });
  it('JSON is stable, sorted and round-trips', () => {
    const a = datasetsToJson(rs, s);
    expect(datasetsToJson([...rs].reverse(), s)).toBe(a);
    const back = JSON.parse(a);
    expect(back.schema).toBe(1);
    expect(back.datasets.map((r: DatasetRecord) => r.id)).toEqual(['terrain', 'weather']);
    expect(stableStringify({ b: 1, a: [NaN, undefined, new Float32Array([1])] }, 0)).toBe('{"a":[null,null,[1]],"b":1}');
  });
  it('CSV is RFC 4180 (quotes, CRLF), one row per data set, or one per stat', () => {
    const csv = datasetsToCsv(rs);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(4); // header, 2 rows, trailing empty
    expect(lines[0]!.split(',').length).toBe(30);
    expect(csv).toContain('api.open-meteo.com/v1/forecast');
    const st = datasetsToCsv(rs, { stats: true });
    expect(st).toContain('"Relief, ""high"""');
    expect(csv + st).not.toMatch(/undefined|NaN/);
  });
  it('plain text names every data set, its status, size and reasons', () => {
    const t = datasetsToText(rs, s);
    expect(t).toMatch(/^FireSim data sets: S, "quoted"/);
    expect(t).toContain('Not real data, or only partly:');
    expect(t).toContain('Why a substitute: offline, no stored forecast');
    expect(t).toContain('Size: 1.0 KB in all');
    expect(t).toContain('! w1');
    expect(t).not.toMatch(/undefined|NaN/);
    expect(datasetsToText([], null)).toBe('\n');
  });
});
