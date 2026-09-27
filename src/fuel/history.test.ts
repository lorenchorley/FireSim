import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LocalProjection } from '../core/geo';
import { cellAt, makeGridSpec } from '../core/grid';
import { localDate } from '../core/physics';
import { FireHistoryKind, type FireHistoryRecord } from '../core/types';
import { TEST_ORIGIN } from '../terrain/testing/synthetic';
import {
  addDays,
  aestTime,
  countShortIntervals,
  inclusionAt,
  parseFireHistory,
  parseFireHistoryWithMeta,
  rasteriseFireHistory,
  seasonMid,
  selectFires,
} from './history';
import { YEAR_MS } from './params';

const DEMO = fileURLToPath(new URL('../../public/demo/', import.meta.url));
const loadFire = (site: string): unknown => JSON.parse(readFileSync(`${DEMO}${site}/fire-history.geojson`, 'utf8'));

describe('local dates (spec §0.2)', () => {
  it('localDate maps both NPWS conventions to the intended date', () => {
    expect(localDate(Date.parse('2019-10-25T13:00:00Z'))).toBe('2019-10-26');
    expect(localDate(Date.parse('2013-01-12T00:00:00Z'))).toBe('2013-01-12');
    expect(localDate(Date.parse('2026-04-30T00:00:00Z'))).toBe('2026-04-30');
  });
  it('AEST helpers', () => {
    expect(new Date(aestTime('2026-05-04', 12)).toISOString()).toBe('2026-05-04T02:00:00.000Z');
    expect(new Date(aestTime('2019-10-26', 0)).toISOString()).toBe('2019-10-25T14:00:00.000Z');
    expect(addDays('2013-01-12', 3)).toBe('2013-01-15');
    expect(addDays('2020-02-28', 2)).toBe('2020-03-01');
    expect(new Date(seasonMid(1964)).toISOString()).toBe('1965-01-01T02:00:00.000Z');
  });
});

const feature = (props: Record<string, unknown>, coords: unknown = [[[150, -33], [150.01, -33], [150.01, -33.01], [150, -33]]], type = 'Polygon'): unknown => ({
  type: 'Feature',
  properties: props,
  geometry: coords === null ? null : { type, coordinates: coords },
});
const fc = (...features: unknown[]): unknown => ({ type: 'FeatureCollection', features });

describe('parseFireHistory (spec §4.4)', () => {
  it('decodes kind, season, dates and the label', () => {
    const recs = parseFireHistory(
      fc(
        feature({ FireType: 1, FireYear: 196465, Label: '1964-65 Wildfire', StartDate: -160704000000, EndDate: null, FireName: 'Warragamba', AreaHa: 21.1 }),
        feature({ FireType: 2, FireYear: 2004, Label: null, StartDate: null, EndDate: null }),
        feature({ FireType: 7, FireYear: 199900, StartDate: Date.parse('2000-01-10T13:00:00Z'), EndDate: Date.parse('2000-01-12T13:00:00Z'), Intensity: 9999 }),
      ),
    );
    expect(recs).toHaveLength(3);
    const [a, b, c] = recs as [FireHistoryRecord, FireHistoryRecord, FireHistoryRecord];
    expect(a.kind).toBe(FireHistoryKind.Wildfire);
    expect(a.season).toBe(1964);
    expect(a.datesKnown).toBe(true);
    expect(a.startDate).toBe(localDate(-160704000000));
    expect(a.endDate).toBe(addDays(a.startDate!, 3)); // EndDate null → start + 3 d [H]
    expect(a.endTime).toBe(aestTime(a.endDate!, 12));
    expect(a.startTime).toBe(aestTime(a.startDate!, 0));
    expect(a.name).toBe('Warragamba');
    expect(a.areaHa).toBeCloseTo(21.1, 6);
    expect(b.kind).toBe(FireHistoryKind.PrescribedBurn);
    expect(b.season).toBe(2004); // the one row that carries a plain year
    expect(b.datesKnown).toBe(false);
    expect(b.startTime).toBe(seasonMid(2004));
    expect(b.endTime).toBe(seasonMid(2004));
    expect(b.label).toBe('2004-05 Prescribed Burn');
    expect(c.kind).toBe(FireHistoryKind.Unknown);
    expect(c.season).toBe(1999);
    expect(c.startDate).toBe('2000-01-11');
    expect(c.endDate).toBe('2000-01-13');
    expect(c.label).toBe('1999-00 Fire');
  });

  it('MultiPolygon → one record per part; skips null geometry and rings with < 4 points', () => {
    const part = [[[150, -33], [150.01, -33], [150.01, -33.01], [150, -33]]];
    const bad = [[[150, -33], [150.01, -33], [150, -33]]];
    const out = parseFireHistoryWithMeta(
      fc(
        feature({ FireType: 1, FireYear: 201920, VerDate: 1788739200000 }, [part, part, bad], 'MultiPolygon'),
        feature({ FireType: 1, FireYear: 201920 }, null),
        feature({ FireType: 1, FireYear: 201920 }, [[[150, -33], [150.01, -33], [150.01, -33.01], [150, -33]], [[150, -33], [150.001, -33], [150, -33]]]),
      ),
    );
    expect(out.records).toHaveLength(3);
    expect(out.records[2]!.rings).toHaveLength(1); // the 3-point hole is dropped
    expect(out.skipped).toBe(1);
    expect(out.verDate).toBe(1788739200000);
    expect(parseFireHistory(null)).toEqual([]);
  });

  it('data check: Gospers Mountain 2019-10-25T13:00Z → 2019-10-26; Wambelong → 2013-01-12; Ngula Bulgarabang HR → 2026-04-30', () => {
    const find = (site: string, name: string): FireHistoryRecord => parseFireHistory(loadFire(site)).find((r) => r.name === name)!;
    expect(find('gospers', 'Gospers Mountain').startDate).toBe('2019-10-26');
    expect(find('gospers', 'Gospers Mountain').endDate).toBe('2020-02-10');
    expect(find('warrumbungles', 'Wambelong WNP').startDate).toBe('2013-01-12');
    expect(find('warrumbungles', 'Wambelong WNP').endDate).toBe('2013-01-15');
    const n = find('katoomba', 'Ngula Bulgarabang HR');
    expect(n.startDate).toBe('2026-04-30');
    expect(n.endDate).toBe('2026-05-04');
    expect(n.kind).toBe(FireHistoryKind.PrescribedBurn);
  });

  it('data anomalies: an end date before the start is clamped; an EndDate without StartDate gives the burn time', () => {
    const recs = parseFireHistory(loadFire('katoomba'));
    const lyre = recs.find((r) => r.name === 'Lyrebird Dell Stage 2')!; // NPWS: 2005-03-16 → 2005-03-05
    expect(lyre.startDate).toBe('2005-03-16');
    expect(lyre.endDate).toBe('2005-03-16');
    expect(lyre.endTime!).toBeGreaterThan(lyre.startTime);
    expect(inclusionAt(lyre, Date.parse('2005-03-16T03:00:00Z'))).toBe('active'); // burning on its start date
    const undated = recs.find((r) => r.season === 2001 && r.datesKnown === false && r.endDate === '2001-09-26')!;
    expect(undated).toBeDefined();
    expect(undated.endTime).toBe(aestTime('2001-09-26', 12));
    expect(inclusionAt(undated, Date.parse('2026-09-27T00:00:00Z'))).toBe('included');
    expect(inclusionAt(undated, Date.parse('2001-12-01T00:00:00Z'))).toBe('undatedCurrentSeason');
  });
});

describe('inclusion at t0 (spec §4.4)', () => {
  const at = (date: string): number => Date.parse(`${date}T03:00:00Z`); // early afternoon local
  const cases: [site: string, replay: string, name: string][] = [
    ['gospers', '2019-12-19', 'Gospers Mountain'],
    ['grose', '2019-12-19', 'Gospers Mountain'],
    ['kanangra', '2019-12-17', 'Green Wattle Creek'],
    ['budawangs', '2019-12-30', 'Currowan 2'],
    ['thredbo', '2020-01-02', 'Pilot Lookout'],
    ['warrumbungles', '2013-01-12', 'Wambelong WNP'],
  ];
  for (const [site, replay, name] of cases) {
    it(`${name} is active (excluded from fuel) at the ${site} ${replay} replay`, () => {
      const recs = parseFireHistory(loadFire(site));
      const sel = selectFires(recs, at(replay));
      expect(sel.activeFires.some((r) => r.name === name)).toBe(true);
      expect(sel.included.some((r) => r.name === name)).toBe(false);
      expect(sel.warnings.some((w) => w.includes(name))).toBe(true);
      // Nothing that starts after the replay date is included.
      for (const r of sel.included) if (r.startDate) expect(r.startDate <= replay).toBe(true);
    });
  }

  it('Katoomba "now" (2026-09-27) includes Ngula Bulgarabang HR with tsf 0.40 ± 0.01 yr', () => {
    const t0 = Date.parse('2026-09-27T00:00:00Z');
    const recs = parseFireHistory(loadFire('katoomba'));
    const sel = selectFires(recs, t0);
    const r = sel.included.find((x) => x.name === 'Ngula Bulgarabang HR')!;
    expect(r).toBeDefined();
    expect((t0 - r.endTime!) / YEAR_MS).toBeCloseTo(0.4, 2);
    expect(sel.activeFires).toHaveLength(0);
    // Sorted by burn time.
    for (let q = 1; q < sel.included.length; q++) expect(sel.included[q]!.endTime!).toBeGreaterThanOrEqual(sel.included[q - 1]!.endTime!);
  });

  it('undated fires: current season excluded with a warning, future excluded, past included', () => {
    const rec = (season: number): FireHistoryRecord => ({ kind: FireHistoryKind.Wildfire, label: `${season} fire`, startTime: seasonMid(season), endTime: seasonMid(season), rings: [], season, datesKnown: false });
    const t0 = Date.parse('2026-09-27T00:00:00Z'); // season 2026
    expect(inclusionAt(rec(2026), t0)).toBe('undatedCurrentSeason');
    expect(inclusionAt(rec(2027), t0)).toBe('future');
    expect(inclusionAt(rec(2025), t0)).toBe('included');
    const sel = selectFires([rec(2026), rec(2025)], t0);
    expect(sel.included).toHaveLength(1);
    expect(sel.warnings[0]).toMatch(/Undated fire in the current season/);
  });

  it('dated fires: future, active through endDate + 1 d, then included', () => {
    const r: FireHistoryRecord = {
      kind: FireHistoryKind.PrescribedBurn, label: 'x', startTime: aestTime('2026-04-30', 0), endTime: aestTime('2026-05-04', 12),
      rings: [], datesKnown: true, startDate: '2026-04-30', endDate: '2026-05-04', season: 2025,
    };
    expect(inclusionAt(r, Date.parse('2026-04-28T03:00:00Z'))).toBe('future');
    expect(inclusionAt(r, Date.parse('2026-04-30T03:00:00Z'))).toBe('active');
    expect(inclusionAt(r, Date.parse('2026-05-05T03:00:00Z'))).toBe('active');
    expect(inclusionAt(r, Date.parse('2026-05-06T03:00:00Z'))).toBe('included');
  });
});

describe('rasteriseFireHistory (spec §4.4)', () => {
  const grid = makeGridSpec(TEST_ORIGIN, 3000, 30);
  const proj = new LocalProjection(grid.origin);
  const square = (x0: number, y0: number, x1: number, y1: number): [number, number][][] => [
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => {
      const ll = proj.toLatLon(x!, y!);
      return [ll.lon, ll.lat] as [number, number];
    }),
  ];
  const t0 = Date.parse('2026-09-27T00:00:00Z');
  const dated = (kind: FireHistoryKind, start: string, end: string, rings: [number, number][][], name = 'f'): FireHistoryRecord => ({
    kind, label: name, name, rings, startTime: aestTime(start, 0), endTime: aestTime(end, 12), datesKnown: true, startDate: start, endDate: end, season: 0,
  });

  it('builds the per-cell history: tsf, last kind, counts and the compact list sorted by t_b', () => {
    const big = square(-1000, -1000, 1000, 1000);
    const small = square(-200, -200, 200, 200);
    const recs = [
      dated(FireHistoryKind.PrescribedBurn, '2024-05-01', '2024-05-03', small, 'pb2024'),
      dated(FireHistoryKind.Wildfire, '2000-01-01', '2000-01-10', big, 'wf2000'),
      dated(FireHistoryKind.Wildfire, '2019-12-01', '2020-01-20', big, 'wf2019'),
      dated(FireHistoryKind.Wildfire, '2026-09-26', '2026-09-30', small, 'active'),
    ];
    const h = rasteriseFireHistory(grid, recs, t0);
    expect(h.included.map((r) => r.name)).toEqual(['wf2000', 'wf2019', 'pb2024']);
    expect(h.activeFires.map((r) => r.name)).toEqual(['active']);
    const kc = cellAt(grid, 0, 0);
    const ke = cellAt(grid, 600, 0);
    const ko = cellAt(grid, 1400, 1400);
    expect(h.timeSinceFire[kc]).toBeCloseTo((t0 - aestTime('2024-05-03', 12)) / YEAR_MS, 5);
    expect(h.lastFireKind[kc]).toBe(FireHistoryKind.PrescribedBurn);
    expect(h.timeSinceFire[ke]).toBeCloseTo((t0 - aestTime('2020-01-20', 12)) / YEAR_MS, 5);
    expect(h.lastFireKind[ke]).toBe(FireHistoryKind.Wildfire);
    expect(Number.isNaN(h.timeSinceFire[ko]!)).toBe(true);
    expect(h.fireCount30[kc]).toBe(3);
    expect(h.fireCount30[ke]).toBe(2);
    // Generic TFI minimum 7 yr: 2020 → 2024 is 4.3 yr (short); 2000 → 2020 is not.
    expect(h.fireCountTfi[kc]).toBe(1);
    expect(h.fireCountTfi[ke]).toBe(0);
    const c = h.compact;
    expect(c.recStart).toHaveLength(grid.nx * grid.ny + 1);
    expect(c.recStart[kc + 1]! - c.recStart[kc]!).toBe(3);
    const tbs = [...c.recIndex.subarray(c.recStart[kc]!, c.recStart[kc + 1]!)].map((r) => c.tb[r]!);
    expect(tbs).toEqual([...tbs].sort((a, b) => a - b));
    expect(countShortIntervals(c, kc, 30)).toBe(2);
  });

  it('a 1 km × 1 km burn on a 30 m grid covers 1111 ± 67 cells', () => {
    const h = rasteriseFireHistory(grid, [dated(FireHistoryKind.Wildfire, '2019-12-01', '2020-01-20', square(-500, -500, 500, 500))], t0);
    let n = 0;
    for (const v of h.timeSinceFire) if (v === v) n++;
    expect(Math.abs(n - 1111)).toBeLessThanOrEqual(67);
  });

  it('rasterises the Grose history (67 parts, ≈ 380 000 cell records) quickly', async () => {
    const { loadDemoFireTerrain } = await import('./testing/demoTerrain');
    const terrain = (await loadDemoFireTerrain('grose', 30))!;
    const recs = parseFireHistory(loadFire('grose'));
    rasteriseFireHistory(terrain.grid, recs, t0);
    const t = performance.now();
    const h = rasteriseFireHistory(terrain.grid, recs, t0);
    expect(performance.now() - t).toBeLessThan(200);
    expect(h.compact.recIndex.length).toBeGreaterThan(200000);
  });

  it('merges duplicate NPWS rows (same kind, same dates) in a cell', () => {
    const sq = square(-300, -300, 300, 300);
    const recs = [dated(FireHistoryKind.PrescribedBurn, '2016-05-06', '2016-06-06', sq, 'a'), dated(FireHistoryKind.PrescribedBurn, '2016-05-06', '2016-06-06', sq, 'b')];
    const h = rasteriseFireHistory(grid, recs, t0);
    const k = cellAt(grid, 0, 0);
    expect(h.compact.recStart[k + 1]! - h.compact.recStart[k]!).toBe(1);
    expect(h.fireCount30[k]).toBe(1);
  });

  it('warns when no fire record is included', () => {
    const h = rasteriseFireHistory(grid, [], t0);
    expect(h.warnings.join(' ')).toMatch(/No fire record/);
    expect(h.timeSinceFire.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('Katoomba cells inside Ngula Bulgarabang HR read tsf 0.40 yr', async () => {
    const { loadDemoFireTerrain } = await import('./testing/demoTerrain');
    const terrain = (await loadDemoFireTerrain('katoomba', 30))!;
    const parsed = parseFireHistoryWithMeta(loadFire('katoomba'));
    const h = rasteriseFireHistory(terrain.grid, parsed.records, t0, { verDate: parsed.verDate });
    expect(h.source).toBe('NPWS Fire History current to 2026-09-07');
    const idx = h.included.findIndex((r) => r.name === 'Ngula Bulgarabang HR');
    let cells = 0;
    for (let k = 0; k < terrain.elevation.length; k++) {
      const a = h.compact.recStart[k]!;
      const b = h.compact.recStart[k + 1]!;
      if (b > a && h.compact.recIndex[b - 1] === idx) {
        cells++;
        expect(h.timeSinceFire[k]).toBeCloseTo(0.4, 2);
        expect(h.lastFireKind[k]).toBe(FireHistoryKind.PrescribedBurn);
      }
    }
    // 15 ha ≈ 167 cells of 0.09 ha.
    expect(cells).toBeGreaterThan(100);
    expect(cells).toBeLessThan(250);
  });
});
