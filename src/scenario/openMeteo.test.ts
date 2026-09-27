/**
 * Open-Meteo requests and parsing (spec §11.1–§11.2, D34, D48): every bundled fixture parses; times, units, nulls,
 * pressure levels, wind profile, clearness stamping, daily aggregation and the URL contracts.
 */
import { describe, expect, it } from 'vitest';
import { clearSkyGhi, dailyFromHourly, fillGaps, forecastUrl, historicalForecastUrl, archiveDailyUrl, archiveHourlyUrl, mergePressureLevels, OM_HOURLY_VARS, parseOmTime, parseOpenMeteoDaily, parseOpenMeteoHourly, type OpenMeteoResponse } from './openMeteo';
import { fixture, REPLAY_IDS } from './testing';

const KAT = { lat: -33.715, lon: 150.285 };

describe('URL builders (§11.1, D34)', () => {
  it('forecast: best_match, UTC, m/s, 42 hourly variables, 7 past + 7 forecast days, never ACCESS-G', () => {
    const u = forecastUrl(KAT);
    expect(OM_HOURLY_VARS).toHaveLength(42);
    expect(u).toContain('models=best_match');
    expect(u).toContain('timezone=UTC');
    expect(u).toContain('wind_speed_unit=ms');
    expect(u).toContain('past_days=7');
    expect(u).toContain('forecast_days=7');
    expect(u).toContain('geopotential_height_500hPa');
    expect(u).not.toContain('bom_access');
    expect(u.split('hourly=')[1]!.split(',')).toHaveLength(42);
  });
  it('clamps past_days ≤ 92 and forecast_days ≤ 16', () => {
    const u = forecastUrl(KAT, { pastDays: 200, forecastDays: 40 });
    expect(u).toContain('past_days=92');
    expect(u).toContain('forecast_days=16');
  });
  it('historical forecast (ecmwf_ifs), ERA5 hourly (100 m wind) and daily archive (Australia/Sydney)', () => {
    expect(historicalForecastUrl(KAT, '2019-12-12', '2019-12-20')).toMatch(/historical-forecast-api\.open-meteo\.com.*models=ecmwf_ifs.*start_date=2019-12-12&end_date=2019-12-20/);
    const era = archiveHourlyUrl(KAT, '2013-10-09', '2013-10-17');
    expect(era).toContain('models=era5');
    expect(era).toContain('wind_speed_100m');
    expect(era).not.toContain('850hPa');
    const d = archiveDailyUrl(KAT, '2025-09-27', '2026-09-26');
    expect(d).toContain('daily=precipitation_sum,temperature_2m_max,temperature_2m_min');
    expect(d).toContain('timezone=Australia%2FSydney');
  });
});

describe('time and gap helpers', () => {
  it('ISO local times minus utc_offset_seconds; unixtime seconds', () => {
    expect(parseOmTime('2026-09-20T00:00', 36000)).toBe(Date.UTC(2026, 8, 19, 14));
    expect(parseOmTime('2019-12-19T10:00', 36000)).toBe(Date.UTC(2019, 11, 19, 0));
    expect(parseOmTime(1_700_000_000, 0)).toBe(1_700_000_000_000);
    expect(Number.isNaN(parseOmTime(null, 0))).toBe(true);
  });
  it('fills gaps ≤ 3 h linearly (angles by the shortest arc), leaves longer gaps', () => {
    const t = Array.from({ length: 12 }, (_, i) => i * 3.6e6);
    const v = Float64Array.from([0, NaN, NaN, NaN, 4, NaN, NaN, NaN, NaN, 9, 10, 11]);
    const r = fillGaps(t, v, 3 * 3.6e6);
    expect([...v.slice(0, 5)]).toEqual([0, 1, 2, 3, 4]);
    expect(Number.isNaN(v[5]!)).toBe(true);
    expect(r.longestGapMs).toBe(4 * 3.6e6);
    const a = Float64Array.from([350, NaN, 10]);
    fillGaps([0, 1, 2], a, 10, true);
    expect(a[1]).toBeCloseTo(0, 9);
  });
});

describe('parse every bundled fixture (§11.2)', () => {
  it('Katoomba best_match forecast: 336 h, all 42 variables, model upper air, 715 m grid point', () => {
    const r = parseOpenMeteoHourly(fixture('openmeteo-forecast-katoomba.json'));
    const s = r.series;
    expect(r.missingRequired).toEqual([]);
    expect(r.present).toHaveLength(42);
    expect(s.hours).toHaveLength(336);
    expect(s.sourceElevation).toBe(715);
    expect(s.location.lat).toBeCloseTo(-33.708, 3);
    expect(s.upperAirSource).toBe('model');
    expect(r.levels).toBe(4);
    expect(s.timezone).toBe('Australia/Sydney');
    // 2026-09-21T12:00 local (+10) excerpt of doc 08b §5: T 25.5, RH 28, Td 5.8, SW 862, T850 15.6, Z500 5785, BLH 1505.
    const h = s.hours.find((x) => x.time === Date.UTC(2026, 8, 21, 2))!;
    expect(h.temperature).toBeCloseTo(25.5, 1);
    expect(h.relativeHumidity).toBeCloseTo(28, 0);
    expect(h.dewPoint).toBeCloseTo(5.8, 1);
    expect(h.shortwaveRadiation).toBeCloseTo(862, 0);
    expect(h.boundaryLayerHeight).toBeCloseTo(1505, 0);
    const l850 = h.pressureLevels!.find((l) => l.hPa === 850)!;
    const l500 = h.pressureLevels!.find((l) => l.hPa === 500)!;
    expect(l850.temperature).toBeCloseTo(15.6, 1);
    expect(l500.height).toBeCloseTo(5785, 0);
    expect(h.pressureLevels!.map((l) => l.hPa)).toEqual([925, 850, 700, 500]);
    expect(h.windProfile!.map((p) => p.heightAGL)).toEqual([80, 120, 180]);
    // Ascending, hourly.
    for (let i = 1; i < s.hours.length; i++) expect(s.hours[i]!.time - s.hours[i - 1]!.time).toBe(3.6e6);
  });

  it('ACCESS-G (all-null, units "undefined") is rejected: required fields missing', () => {
    const r = parseOpenMeteoHourly(fixture('openmeteo-forecast-katoomba-access.json'));
    expect(r.missingRequired.sort()).toEqual(['relative_humidity_2m', 'temperature_2m', 'wind_direction_10m', 'wind_speed_10m']);
    expect(r.series.hours).toHaveLength(0);
  });

  it.each(REPLAY_IDS)('replay %s: hourly parses, synthetic upper air, radiation stamped as clearness', (id) => {
    const json = fixture<OpenMeteoResponse>(`replay-${id}.json`);
    const r = parseOpenMeteoHourly(json, { kind: 'historical' });
    const s = r.series;
    expect(r.missingRequired).toEqual([]);
    expect(s.hours.length).toBeGreaterThanOrEqual(72);
    expect(s.upperAirSource).toBe('synthetic');
    expect(s.hours[0]!.pressureLevels).toBeUndefined();
    expect(s.sourceElevation).toBe(json.elevation);
    const era5 = id.includes('2013');
    const heights = s.hours[0]!.windProfile!.map((p) => p.heightAGL);
    expect(heights).toEqual(era5 ? [100] : [80, 120]); // 180 m all-null in 2019 ecmwf_ifs
    // 2019 ecmwf_ifs: BLH and CAPE all-null → absent; ERA5: BLH present, CAPE null.
    expect(s.hours.every((h) => h.cape === undefined)).toBe(true);
    expect(s.hours.some((h) => h.boundaryLayerHeight !== undefined)).toBe(era5);
    for (const h of s.hours) {
      expect(h.windSpeed10).toBeGreaterThanOrEqual(0);
      expect(h.relativeHumidity).toBeGreaterThanOrEqual(0);
      expect(h.relativeHumidity).toBeLessThanOrEqual(100);
      expect(h.clearness).toBeGreaterThanOrEqual(0);
      expect(h.clearness).toBeLessThanOrEqual(1.2);
    }
  });

  it('gospers 2019-12-19..22 sanity (doc 08b §7): max T 42.5 °C, min RH 11 %, max gust 25.2 m/s', () => {
    const s = parseOpenMeteoHourly(fixture('replay-gospers-2019-12-19.json')).series;
    expect(Math.max(...s.hours.map((h) => h.temperature))).toBeCloseTo(42.5, 1);
    expect(Math.min(...s.hours.map((h) => h.relativeHumidity))).toBeCloseTo(11, 0);
    expect(Math.max(...s.hours.map((h) => h.windGust10 ?? 0))).toBeCloseTo(25.2, 1);
  });

  it.each([...REPLAY_IDS.map((id) => `replay-${id}-daily365.json`), 'openmeteo-archive-katoomba-365d.json'])('daily %s: 365 dated days', (name) => {
    const d = parseOpenMeteoDaily(fixture(name));
    expect(d).toHaveLength(365);
    for (let i = 1; i < d.length; i++) expect(d[i]!.date > d[i - 1]!.date).toBe(true);
    expect(d.every((x) => x.rain >= 0 && Number.isFinite(x.tMax))).toBe(true);
  });

  it('Katoomba 365-day rain total 800.8 mm (doc 08b §6)', () => {
    const d = parseOpenMeteoDaily(fixture('openmeteo-archive-katoomba-365d.json'));
    expect(d.reduce((s, x) => s + x.rain, 0)).toBeCloseTo(800.8, 0);
  });
});

describe('units, nulls and levels', () => {
  const base = (hourly: Record<string, (number | null)[]>, units: Record<string, string>): OpenMeteoResponse => ({
    latitude: -33.7,
    longitude: 150.3,
    elevation: 700,
    utc_offset_seconds: 0,
    hourly_units: units,
    hourly: { time: Array.from({ length: hourly['temperature_2m']!.length }, (_, i) => `2026-01-01T${String(i).padStart(2, '0')}:00`) as unknown as (number | null)[], ...hourly },
  });
  it('converts km/h to m/s and keeps m/s', () => {
    const r = parseOpenMeteoHourly(
      base({ temperature_2m: [20, 21], relative_humidity_2m: [50, 50], wind_speed_10m: [36, 18], wind_direction_10m: [90, 90], wind_gusts_10m: [72, 36] }, { temperature_2m: '°C', relative_humidity_2m: '%', wind_speed_10m: 'km/h', wind_direction_10m: '°', wind_gusts_10m: 'km/h' }),
    );
    expect(r.series.hours[0]!.windSpeed10).toBeCloseTo(10, 9);
    expect(r.series.hours[1]!.windGust10).toBeCloseTo(10, 9);
  });
  it('interpolates isolated nulls, reports a required gap > 3 h, trims leading nulls', () => {
    const T = [null, 10, null, 12, 13, 14, 15, 16, 17];
    const good = parseOpenMeteoHourly(base({ temperature_2m: T, relative_humidity_2m: T.map(() => 50), wind_speed_10m: T.map(() => 3), wind_direction_10m: T.map(() => 350) }, {}));
    expect(good.missingRequired).toEqual([]);
    expect(good.series.hours).toHaveLength(8);
    expect(good.series.hours[1]!.temperature).toBeCloseTo(11, 9);
    const W = [3, null, null, null, null, 3, 3, 3, 3];
    const bad = parseOpenMeteoHourly(base({ temperature_2m: T.map(() => 20), relative_humidity_2m: T.map(() => 50), wind_speed_10m: W, wind_direction_10m: T.map(() => 350) }, {}));
    expect(bad.missingRequired).toEqual(['wind_speed_10m']);
  });
  it('fewer than 3 complete pressure levels → synthetic, levels dropped; ≥ 3 → model', () => {
    const n = 3;
    const col = (v: number): number[] => Array(n).fill(v);
    const lv = (p: number): Record<string, number[]> => ({
      [`temperature_${p}hPa`]: col(10),
      [`relative_humidity_${p}hPa`]: col(40),
      [`wind_speed_${p}hPa`]: col(10),
      [`wind_direction_${p}hPa`]: col(270),
      [`geopotential_height_${p}hPa`]: col(1500),
    });
    const sfc = { temperature_2m: col(20), relative_humidity_2m: col(50), wind_speed_10m: col(3), wind_direction_10m: col(270) };
    const two = parseOpenMeteoHourly(base({ ...sfc, ...lv(850), ...lv(700) }, {}));
    expect(two.series.upperAirSource).toBe('synthetic');
    expect(two.series.hours[0]!.pressureLevels).toBeUndefined();
    const three = parseOpenMeteoHourly(base({ ...sfc, ...lv(850), ...lv(700), ...lv(500) }, {}));
    expect(three.series.upperAirSource).toBe('model');
    expect(three.series.hours[0]!.pressureLevels![0]!.dewPoint).toBeLessThan(10);
    // Merging levels into a synthetic series flips it to 'model'.
    const target = parseOpenMeteoHourly(base({ ...sfc }, {})).series;
    expect(mergePressureLevels(target, three.series)).toBe(3);
    expect(target.upperAirSource).toBe('model');
  });
});

describe('clearness k_t (§11.2, D48)', () => {
  const s = parseOpenMeteoHourly(fixture('openmeteo-forecast-katoomba.json')).series;
  it('k_t = GHI_hour / GHI_clear(t − 30 min), clamped to [0, 1.2], copied from daylight at night', () => {
    const lat = s.location.lat;
    const lon = s.location.lon;
    for (const h of s.hours) {
      const clear = clearSkyGhi(h.time - 1.8e6, lat, lon, 715);
      if (clear >= 20) expect(h.clearness).toBeCloseTo(Math.min(1.2, h.shortwaveRadiation! / clear), 6);
      else expect(h.clearness).toBeGreaterThan(0);
    }
  });
  it('a clear noon gives k_t ≈ 0.8–1.1', () => {
    const noon = s.hours.find((h) => h.time === Date.UTC(2026, 8, 21, 2))!; // 12:00 local, 862 W/m²
    expect(noon.clearness).toBeGreaterThan(0.8);
    expect(noon.clearness).toBeLessThan(1.1);
  });
});

describe('dailyFromHourly', () => {
  it('local-day aggregates of the forecast agree with the archive on overlapping days (2026-09-20/21)', () => {
    const s = parseOpenMeteoHourly(fixture('openmeteo-forecast-katoomba.json')).series;
    const fromHourly = dailyFromHourly(s);
    const arch = parseOpenMeteoDaily(fixture('openmeteo-archive-katoomba-365d.json'));
    expect(fromHourly[0]!.date).toBe('2026-09-20');
    for (const date of ['2026-09-20', '2026-09-21']) {
      const a = arch.find((d) => d.date === date)!;
      const b = fromHourly.find((d) => d.date === date)!;
      expect(Math.abs(a.tMax - b.tMax)).toBeLessThan(4); // different models, same day
    }
    expect(fromHourly.every((d) => d.tMin! <= d.tMax)).toBe(true);
  });
});
