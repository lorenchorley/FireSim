/**
 * Replay integration: the Grose Valley demo DTM (30 m fire grid) with the bundled 19 Dec 2019 replay weather and its
 * 365-day daily history (spec §11.4: KBDI/DF from -daily365 with the demo annual-rainfall table; spin-up from the
 * file hours before t0 plus the daily fallback of §5.6).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { FuelType, Landform, type DailyWeather, type Terrain } from '../../core/types';
import { loadElevation } from '../../data';
import { DEMO_SITES } from '../../data/demoSites';
import { buildTerrain, terrainDerived, type TerrainDerived } from '../../terrain';
import { droughtState } from './drought';
import { MoistureModel } from './model';
import { spinUpStableNight } from './night';
import { lmstMs, meanWhere, parseOpenMeteoHourly, uniformFuel } from './testing';

const FIX = fileURLToPath(new URL('../../../tests/fixtures/live/', import.meta.url));
const site = DEMO_SITES.find((s) => s.id === 'grose')!;
let terrain: Terrain;
let derived: TerrainDerived;

beforeAll(async () => {
  const el = await loadElevation({ centre: site.centre, extent: 9000, cellSize: 30, cache: null, offline: true });
  terrain = buildTerrain(el.grid, el.elevation, el.source);
  derived = terrainDerived(terrain);
}, 60000);

describe('Grose replay 2019-12-19', () => {
  it('drought from the daily history (KBDI 118.6, DF 9.88) and a hot, dry, aspect-dependent afternoon field', () => {
    const series = parseOpenMeteoHourly(JSON.parse(readFileSync(FIX + 'replay-grose-2019-12-19.json', 'utf8')));
    const dj = JSON.parse(readFileSync(FIX + 'replay-grose-2019-12-19-daily365.json', 'utf8')) as { daily: { time: string[]; precipitation_sum: number[]; temperature_2m_max: number[] } };
    const daily: DailyWeather[] = dj.daily.time.map((date, i) => ({ date, rain: dj.daily.precipitation_sum[i]!, tMax: dj.daily.temperature_2m_max[i]! }));
    series.daily = daily;
    const dr = droughtState(daily, 1100);
    expect(dr.kbdi).toBeCloseTo(118.6, 0);
    expect(dr.df).toBeCloseTo(9.88, 1);
    const lon = series.location.lon;
    const t0 = lmstMs(2019, 12, 19, 14, lon);
    const m = new MoistureModel(terrain, uniformFuel(terrain, FuelType.DryForestShrubby, 0.6), derived);
    m.initialise(series, t0, { kbdi: dr.kbdi, df: dr.df }, spinUpStableNight(series, t0));
    const all = meanWhere(m.field, () => true);
    expect(all.mean).toBeGreaterThan(2);
    expect(all.mean).toBeLessThan(7); // ~39 °C / 13 % RH: very dry fine fuel
    // Summer afternoon: north and south get similar beam (21 Dec: N 0.91, S 0.82 of flat), the contrast is W/NW vs
    // E/SE (NW 1.12, SE 0.61), and drought damping at DF ≈ 10 halves it. At ~40 °C / 13 % the Van Wagner EMC is
    // also much less sensitive to fuel temperature (≈ −0.14 pp/K vs −0.4 pp/K on the calibration afternoon), so the
    // sunlit side is only slightly drier: "everything is dry" on a catastrophic day.
    const inSector = (a: number, c: number) => Math.abs(((a - c + 540) % 360) - 180) < 30;
    const nw = meanWhere(m.field, (k) => terrain.slopeDeg[k]! > 15 && inSector(terrain.aspectDeg[k]!, 300));
    const se = meanWhere(m.field, (k) => terrain.slopeDeg[k]! > 15 && inSector(terrain.aspectDeg[k]!, 120) && terrain.landform[k] !== Landform.Cliff);
    expect(nw.n).toBeGreaterThan(500);
    expect(se.n).toBeGreaterThan(500);
    expect(se.mean).toBeGreaterThan(nw.mean + 0.05);
    expect(se.mean).toBeLessThan(nw.mean + 1.5);
    // FA at DF 9.88 is near 1 (Mk2 logistic).
    expect(m.availability[1000]).toBeGreaterThan(0.98);
    // Lapse: the plateau (≈ 1000 m) is cooler than the 803 m grid point, the gorge floor warmer.
    const hi = meanWhere(m.airT, (k) => terrain.elevation[k]! > 1000).mean;
    const lo = meanWhere(m.airT, (k) => terrain.elevation[k]! < 600).mean;
    expect(lo).toBeGreaterThan(hi + 3);
  });

  it('short series: rain of the last two days is taken from the daily history (stopped at 18:00) [§5.6]', () => {
    const base = parseOpenMeteoHourly(JSON.parse(readFileSync(FIX + 'replay-grose-2019-12-19.json', 'utf8')));
    const lon = base.location.lon;
    const t0 = lmstMs(2019, 12, 19, 10, lon);
    const dry: DailyWeather[] = [
      { date: '2019-12-17', rain: 0, tMax: 30 },
      { date: '2019-12-18', rain: 0, tMax: 30 },
    ];
    const wet: DailyWeather[] = [
      { date: '2019-12-17', rain: 0, tMax: 30 },
      { date: '2019-12-18', rain: 12, tMax: 30 },
    ];
    const run = (daily: DailyWeather[] | undefined, rainLast20?: number[]) => {
      const m = new MoistureModel(terrain, uniformFuel(terrain, FuelType.DryForestShrubby, 0.6), derived);
      m.initialise({ ...base, daily, rainLast20 }, t0, { kbdi: 100, df: 9 }, spinUpStableNight(base, t0));
      return meanWhere(m.field, () => true).mean;
    };
    const mDry = run(dry);
    const mWet = run(wet);
    // 16 h after 12 mm: R_mem ≈ 67·e^{−0.0858·h_e} with h_e ≈ 16 h → ≈ 17 pp
    expect(mWet - mDry).toBeGreaterThan(8);
    expect(mWet - mDry).toBeLessThan(25);
    const r20 = new Array<number>(20).fill(0);
    r20[19] = 12;
    expect(Math.abs(run(undefined, r20) - mWet)).toBeLessThan(0.05);
  });
});
