/**
 * Replays (spec §11.4) and their drought (§5.7–§5.8 fixture vectors, two KBDI passes with the demo table R):
 * gospers 125.4 / 10.0, grose 118.6 / 9.88, kanangra 76.1 / 8.86, budawangs 118.9 / 9.89, thredbo 63.9 / 8.45,
 * katoomba-2013 74.9 / 8.83, warrumbungles 145.9 / 10.0 (±3 mm / ±0.3).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lmstHour } from '../core/physics';
import { REPLAYS as UI_REPLAYS } from '../ui/content';
import { DEMO_SITES } from '../data';
import { clampReplayStart, loadReplay, REPLAYS, replayDefaultStart } from './replays';
import { droughtFromDaily, rainTodayBefore } from './weatherSources';
import { demoAnnualRainfall } from './params';
import { REPLAY_IDS } from './testing';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('replay catalogue', () => {
  it('ids are <site>-<date>, sites are demo sites, and match the UI list', () => {
    expect(REPLAYS.map((r) => r.id).sort()).toEqual([...REPLAY_IDS].sort());
    expect(UI_REPLAYS.map((r) => r.id).sort()).toEqual(REPLAYS.map((r) => r.id).sort());
    for (const r of REPLAYS) {
      expect(r.id).toBe(`${r.site}-${r.date}`);
      expect(DEMO_SITES.some((s) => s.id === r.site)).toBe(true);
      expect(r.name.length).toBeGreaterThan(5);
      expect(r.story.length).toBeGreaterThan(20);
    }
  });
  it('public/replays/ holds byte-identical copies of the fixtures (offline app data)', () => {
    for (const id of REPLAY_IDS) {
      for (const suffix of ['', '-daily365']) {
        const a = readFileSync(`${root}tests/fixtures/live/replay-${id}${suffix}.json`);
        const b = readFileSync(`${root}public/replays/${id}${suffix}.json`);
        expect(b.equals(a), `${id}${suffix}`).toBe(true);
      }
    }
  });
});

const VECTORS: Record<string, [number, number]> = {
  'gospers-2019-12-19': [125.4, 10.0],
  'grose-2019-12-19': [118.6, 9.88],
  'kanangra-2019-12-17': [76.1, 8.86],
  'budawangs-2019-12-30': [118.9, 9.89],
  'thredbo-2020-01-02': [63.9, 8.45],
  'katoomba-2013-10-16': [74.9, 8.83],
  'warrumbungles-2013-01-12': [145.9, 10.0],
};

describe.each(REPLAY_IDS)('replay %s', (id) => {
  it('loads offline, starts at 10:00 LMST on the date, drought matches the spec vectors', async () => {
    const r = await loadReplay(id);
    expect(r.info.id).toBe(id);
    expect(r.series.kind).toBe('historical');
    expect(r.series.upperAirSource).toBe('synthetic');
    expect(r.daily).toHaveLength(365);
    expect(r.daily[r.daily.length - 1]!.date < r.info.date).toBe(true);
    expect(lmstHour(r.defaultStart, r.series.location.lon)).toBeCloseTo(10, 1);
    expect(new Date(r.defaultStart + 10 * 3.6e6).toISOString().slice(0, 10)).toBe(r.info.date);
    expect(r.series.hours[0]!.time).toBeLessThanOrEqual(r.defaultStart);
    const R = demoAnnualRainfall(r.info.site)!;
    const d = droughtFromDaily(r.daily, R, rainTodayBefore(r.series, r.defaultStart));
    const [kbdi, df] = VECTORS[id]!;
    expect(Math.abs(d.kbdi - kbdi)).toBeLessThanOrEqual(3);
    expect(Math.abs(d.df - df)).toBeLessThanOrEqual(0.3);
    expect(d.rainLast20).toHaveLength(20);
    expect(d.annualRainfall).toBe(R);
  });
});

describe('replay start', () => {
  it('a user-moved start is kept inside the file with ≥ 4 h of weather after it', async () => {
    const r = await loadReplay('gospers-2019-12-19');
    const last = r.series.hours[r.series.hours.length - 1]!.time;
    expect(clampReplayStart(r.series, r.defaultStart + 3.6e6)).toEqual({ start: r.defaultStart + 3.6e6, moved: false });
    const late = clampReplayStart(r.series, last);
    expect(late.moved).toBe(true);
    expect(late.start).toBe(last - 4 * 3.6e6);
    const early = clampReplayStart(r.series, r.series.hours[0]!.time - 1e7);
    expect(early.start).toBe(r.series.hours[0]!.time);
  });
  it('default start is minute-rounded 10:00 LMST', () => {
    expect(replayDefaultStart({ date: '2019-12-19' }, 150)).toBe(Date.UTC(2019, 11, 19, 0, 0));
  });
  it('unknown replay id throws', async () => {
    await expect(loadReplay('nowhere-2020-01-01')).rejects.toThrow(/Unknown replay/);
  });
});
