/**
 * Weather sources by mode, the Open-Meteo fallbacks, caching / rate limiting and the daily history (spec §11.1,
 * §5.7–5.8 "katoomba now" vectors: archive only 58.2 / 8.23; archive + forecast gap-fill 64.6 / 8.47).
 * The network is a fake fetch serving the bundled live fixtures.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WeatherSeries } from '../core/types';
import { MESSAGES } from './messages';
import { weatherAt as weatherAtT } from './weather';
import { parseOpenMeteoDaily, parseOpenMeteoHourly, type OpenMeteoResponse } from './openMeteo';
import { fixture, KATOOMBA_NOW, KATOOMBA_NOW_ROUTES, withFakeNetwork, type FakeRoute } from './testing';
import { dailyHistory, droughtFromDaily, forecastPastDaysFor, livePlan, rainTodayBefore, resolveDrought, resolveWeather, type WeatherContext } from './weatherSources';
import { beltKitReading } from './beltKit';
import { pressureIsa } from '../core/physics';
import { psychrometerRh } from './beltKit';

const KAT = { lat: -33.715, lon: 150.285 };
const H = 3.6e6;
let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function net(routes: FakeRoute[]) {
  const n = withFakeNetwork(routes);
  restore = n.restore;
  return n;
}

const ctx = (o: Partial<WeatherContext> = {}): WeatherContext => ({
  centre: KAT,
  siteId: 'katoomba',
  online: true,
  now: KATOOMBA_NOW,
  duration: 4 * 3600,
  medianElevation: 745,
  centreElevation: 950,
  rateLimitBackoffMs: 1,
  ...o,
});

/** The forecast fixture without its pressure-level variables. */
function stripLevels(j: OpenMeteoResponse): OpenMeteoResponse {
  const hourly = Object.fromEntries(Object.entries(j.hourly!).filter(([k]) => !k.endsWith('hPa')));
  return { ...j, hourly };
}

describe('request plan by mode and date (§11.1, D34)', () => {
  const now = KATOOMBA_NOW;
  it('now / forecast → forecast API best_match then ecmwf_ifs, levels from ecmwf_ifs025 then gfs_seamless', () => {
    const p = livePlan(KAT, now, 4 * 3600, now, false);
    expect(p.surface.map((s) => s[0])).toEqual(['best_match', 'ecmwf_ifs']);
    expect(p.levels.map((s) => s[0])).toEqual(['ecmwf_ifs025', 'gfs_seamless']);
    expect(p.surface[0]![1]).toContain('api.open-meteo.com/v1/forecast');
    const f = livePlan(KAT, now + 12 * 86.4e6, 6 * 3600, now, false);
    expect(f.surface[0]![1]).toContain('forecast_days=14');
  });
  it('past within 92 days → forecast API with past_days; 2016+ → historical ecmwf_ifs; before 2016 → ERA5', () => {
    const recent = livePlan(KAT, now - 30 * 86.4e6, 4 * 3600, now, true);
    const p0 = livePlan(KAT, now, 4 * 3600, now, false);
    // 30 days back at 02:00Z: data from 00:00Z 37 days ago reach t0 − 7 d (§5.6 spin-up).
    expect(recent.surface[0]![1]).toMatch(/api\.open-meteo\.com.*past_days=37/);
    expect(p0.surface[0]![1]).toContain('past_days=7'); // spec §11.1: now / forecast use past_days=7
    // 88 days back the 7-day spin-up is older than 92 days: historical-forecast API.
    expect(livePlan(KAT, now - 88 * 86.4e6, 4 * 3600, now, true).surface[0]![1]).toContain('historical-forecast-api');
    expect(livePlan(KAT, now - 85 * 86.4e6, 4 * 3600, now, true).surface[0]![1]).toContain('past_days=92');
    const y2019 = livePlan(KAT, Date.UTC(2019, 11, 19), 4 * 3600, now, true);
    expect(y2019.surface[0]![1]).toMatch(/historical-forecast-api.*models=ecmwf_ifs.*start_date=2019-12-12/);
    expect(y2019.surface.map((x) => x[0])).toEqual(['ecmwf_ifs', 'best_match', 'era5']);
    expect(y2019.surface[2]![1]).toMatch(/archive-api.*models=era5/);
    const y2013 = livePlan(KAT, Date.UTC(2013, 9, 16), 4 * 3600, now, true);
    expect(y2013.surface).toHaveLength(1);
    expect(y2013.surface[0]![1]).toMatch(/archive-api.*models=era5/);
    expect(y2013.levels).toHaveLength(0);
  });
});

describe('now mode (network fake)', () => {
  it('best_match forecast with model upper air, trimmed to the spin-up window', async () => {
    const n = net(KATOOMBA_NOW_ROUTES());
    const w = await resolveWeather({ kind: 'now' }, ctx({ kv: n.kv }));
    expect(w.origin).toBe('network');
    expect(w.t0).toBe(KATOOMBA_NOW);
    expect(w.series.upperAirSource).toBe('model');
    expect(w.series.sourceElevation).toBe(715);
    expect(w.series.hours[0]!.time).toBeLessThanOrEqual(w.t0 - 168 * H);
    expect(w.maxDuration).toBeGreaterThan(4 * 3600);
    expect(w.warnings).toEqual([]);
    expect(n.calls.some((u) => u.includes('bom_access'))).toBe(false);
  });

  it('katoomba now drought: archive + forecast past_days gap-fill → KBDI 64.6, DF 8.47 (±3 / ±0.3)', async () => {
    const n = net(KATOOMBA_NOW_ROUTES());
    const c = ctx({ kv: n.kv });
    const w = await resolveWeather({ kind: 'now' }, c);
    const d = await resolveDrought(w, c);
    expect(d.daily).toHaveLength(365);
    expect(d.daily[d.daily.length - 1]!.date).toBe('2026-09-26');
    expect(d.daily[0]!.date).toBe('2025-09-27');
    expect(Math.abs(d.kbdi - 64.6)).toBeLessThanOrEqual(3);
    expect(Math.abs(d.df - 8.47)).toBeLessThanOrEqual(0.3);
    expect(d.annualRainfall).toBe(1400); // 10-year archive unavailable → demo table
    expect(d.warnings).toContain(MESSAGES.dailyGapFilled(5));
  });

  it('katoomba archive only (to 2026-09-21): KBDI 58.2, DF 8.23', () => {
    const daily = parseOpenMeteoDaily(fixture('openmeteo-archive-katoomba-365d.json'));
    const d = droughtFromDaily(daily, 1400, 0);
    expect(Math.abs(d.kbdi - 58.2)).toBeLessThanOrEqual(3);
    expect(Math.abs(d.df - 8.23)).toBeLessThanOrEqual(0.3);
  });

  it('a best_match response without required fields falls back to ecmwf_ifs (warning)', async () => {
    const n = net([
      { match: ['models=best_match'], body: fixture('openmeteo-forecast-katoomba-access.json') },
      { match: ['api.open-meteo.com/v1/forecast', 'models=ecmwf_ifs&'], body: fixture('openmeteo-forecast-katoomba.json') },
    ]);
    const w = await resolveWeather({ kind: 'now' }, ctx({ kv: n.kv }));
    expect(w.warnings).toContain(MESSAGES.weatherModelFallback('ecmwf_ifs'));
    expect(w.series.source).toContain('ecmwf_ifs');
  });

  it('null pressure levels are re-requested from ecmwf_ifs025 and merged', async () => {
    const full = fixture<OpenMeteoResponse>('openmeteo-forecast-katoomba.json');
    const n = net([
      { match: ['models=best_match'], body: stripLevels(full) },
      { match: ['models=ecmwf_ifs025'], body: full },
    ]);
    const w = await resolveWeather({ kind: 'now' }, ctx({ kv: n.kv }));
    expect(w.series.upperAirSource).toBe('model');
    expect(w.warnings).toContain(MESSAGES.pressureLevelFallback('ecmwf_ifs025'));
    expect(w.series.hours[10]!.pressureLevels).toHaveLength(4);
    const lvUrl = n.calls.find((u) => u.includes('ecmwf_ifs025'))!;
    expect(lvUrl).toContain('geopotential_height_850hPa');
  });

  it('no levels anywhere → synthetic upper air warning', async () => {
    const n = net([{ match: ['models=best_match'], body: stripLevels(fixture('openmeteo-forecast-katoomba.json')) }]);
    const w = await resolveWeather({ kind: 'now' }, ctx({ kv: n.kv }));
    expect(w.series.upperAirSource).toBe('synthetic');
    expect(w.warnings).toContain(MESSAGES.syntheticUpperAir);
  });

  it('HTTP 429: backs off up to 3 times, then serves the stale cached copy', async () => {
    const n = net(KATOOMBA_NOW_ROUTES());
    await resolveWeather({ kind: 'now' }, ctx({ kv: n.kv }));
    restore!();
    const n2 = withFakeNetwork([{ match: ['open-meteo'], status: 429 }]);
    restore = n2.restore;
    const status: string[] = [];
    const w = await resolveWeather({ kind: 'now' }, ctx({ kv: n.kv, onStatus: (m) => status.push(m) }));
    expect(status.filter((s) => s.includes('rate limit')).length).toBeGreaterThanOrEqual(3);
    expect(w.origin).toBe('stale');
    expect(w.series.hours.length).toBeGreaterThan(100);
  });
});

describe('offline', () => {
  it('uses a cached response covering [t0 − 24 h, t0] and reports its age', async () => {
    const n = net(KATOOMBA_NOW_ROUTES());
    await resolveWeather({ kind: 'now' }, ctx({ kv: n.kv }));
    const w = await resolveWeather({ kind: 'now' }, ctx({ kv: n.kv, online: false, now: KATOOMBA_NOW + 20 * H }));
    expect(w.origin).toBe('cache');
    expect(w.warnings.some((x) => x.startsWith('Offline: using weather stored'))).toBe(true);
    expect(w.t0).toBe(KATOOMBA_NOW + 20 * H);
  });
  it('nothing stored → the fallback preset with the spec message (never fails)', async () => {
    const n = net([]);
    const w = await resolveWeather({ kind: 'forecast', start: KATOOMBA_NOW + 5 * H }, ctx({ kv: n.kv, online: false }));
    expect(w.origin).toBe('fallback');
    expect(w.series.kind).toBe('preset');
    expect(w.t0).toBe(KATOOMBA_NOW + 5 * H);
    expect(w.warnings.some((x) => x.includes('choose a preset, manual entry or a replay'))).toBe(true);
    expect(n.calls).toHaveLength(0);
  });
  it('offline daily history with nothing stored → drought defaults', async () => {
    const n = net([]);
    const c = ctx({ kv: n.kv, online: false });
    const w = await resolveWeather({ kind: 'now' }, c);
    const d = await resolveDrought(w, c);
    expect(d.kbdi).toBe(120); // the fallback preset's own drought
    const hist = await dailyHistory(KAT, KATOOMBA_NOW, c);
    expect(hist.daily).toEqual([]);
    const dd = droughtFromDaily([], undefined, 0);
    expect([dd.df, dd.kbdi]).toEqual([7, 60]);
    expect(dd.warnings).toContain(MESSAGES.droughtDefaults);
  });
});

describe('past mode', () => {
  it('2019: historical-forecast ecmwf_ifs, synthetic upper air (all-null levels), level fallbacks tried', async () => {
    const replay = fixture<OpenMeteoResponse>('replay-gospers-2019-12-19.json');
    // The fixture starts at the date; serve it for the historical request (its spin-up is short → warning).
    const n = net([{ match: ['historical-forecast-api', 'models=ecmwf_ifs&'], body: replay }]);
    const t0 = Date.UTC(2019, 11, 19, 3);
    const w = await resolveWeather({ kind: 'past', start: t0 }, ctx({ kv: n.kv, centre: { lat: -32.98, lon: 150.6 }, siteId: 'gospers' }));
    expect(w.series.kind).toBe('historical');
    expect(w.series.upperAirSource).toBe('synthetic');
    expect(w.warnings).toContain(MESSAGES.syntheticUpperAir);
    expect(w.warnings.some((x) => x.startsWith('Only'))).toBe(true);
    expect(n.calls.some((u) => u.includes('ecmwf_ifs025'))).toBe(true);
  });
});

describe('preset, replay and manual modes need no network', () => {
  it('preset at z_s = domain median', async () => {
    const n = net([]);
    const w = await resolveWeather({ kind: 'preset', presetId: 'mild-spring-hr', start: Date.UTC(2026, 9, 15, 0) }, ctx({ kv: n.kv }));
    expect(w.series.sourceElevation).toBe(745);
    expect(w.series.annualRainfall).toBe(1400);
    expect(n.calls).toHaveLength(0);
    const d = await resolveDrought(w, ctx({ kv: n.kv }));
    expect([d.df, d.kbdi]).toEqual([8, 60]);
  });
  it('unknown preset throws', async () => {
    await expect(resolveWeather({ kind: 'preset', presetId: 'nope', start: 0 }, ctx())).rejects.toThrow(/Unknown weather preset/);
  });
  it('replay: bundled file, drought from its 365-day history', async () => {
    const n = net([]);
    const c = ctx({ kv: n.kv, centre: { lat: -32.98, lon: 150.6 }, siteId: 'gospers' });
    const w = await resolveWeather({ kind: 'replay', replayId: 'gospers-2019-12-19' }, c);
    expect(w.origin).toBe('bundled');
    const d = await resolveDrought(w, c);
    expect(Math.abs(d.kbdi - 125.4)).toBeLessThanOrEqual(3);
    expect(d.df).toBeCloseTo(10, 1);
    expect(n.calls).toHaveLength(0);
  });
  it('manual: normalised, held back 24 h for the spin-up, DF → KBDI', async () => {
    const series: WeatherSeries = {
      kind: 'manual',
      source: 'Manual entry',
      location: KAT,
      timezone: 'Australia/Sydney',
      hours: [0, 1, 2, 3].map((i) => ({ time: KATOOMBA_NOW + (i - 1) * H, temperature: 34, relativeHumidity: 15, windSpeed10: 8, windDir10: 315 })),
      droughtFactor: 9,
    };
    const w = await resolveWeather({ kind: 'manual', series }, ctx());
    expect(w.t0).toBe(KATOOMBA_NOW);
    expect(w.series.hours[0]!.time).toBe(KATOOMBA_NOW - 24 * H);
    expect(w.series.sourceElevation).toBe(950);
    expect(w.series.kbdi).toBeGreaterThan(60);
    expect(rainTodayBefore(w.series, w.t0)).toBe(0);
    const d = await resolveDrought(w, ctx());
    expect(d.df).toBe(9);
  });
  it('belt-kit readings adjust a forecast and add a WindEdit', async () => {
    const n = net(KATOOMBA_NOW_ROUTES());
    const fc = parseOpenMeteoHourly(fixture('openmeteo-forecast-katoomba.json')).series;
    const w = await resolveWeather(
      { kind: 'now' },
      ctx({ kv: n.kv, beltKit: [{ time: KATOOMBA_NOW, temperature: 40, relativeHumidity: 10, dewPoint: 2, windSpeed10: 9, windDir10: 290, pressureHpa: 900, exposure: 'open', elevation: 950 }] }),
    );
    expect(w.edits).toHaveLength(1);
    expect(w.edits[0]!.radius).toBe(1000);
    const orig = fc.hours.find((h) => h.time === KATOOMBA_NOW)!;
    const adj = w.series.hours.find((h) => h.time === KATOOMBA_NOW)!;
    expect(adj.temperature).toBeGreaterThan(orig.temperature);
    expect(w.warnings.some((x) => x.startsWith('Belt-kit reading applied'))).toBe(true);
  });
});

describe('review additions: coverage, fallback messages, belt kit in a manual run', () => {
  it('past_days reaches t0 − 7 d for every start (spin-up window of §5.6)', () => {
    const DAY = 86.4e6;
    for (const now of [Date.UTC(2026, 8, 27, 0, 5), KATOOMBA_NOW, Date.UTC(2026, 8, 27, 23, 50)]) {
      for (const back of [0, 0.3, 1, 5.5, 30, 80]) {
        const t0 = now - back * DAY;
        const p = forecastPastDaysFor(t0, now);
        const dataStart = Math.floor(now / DAY) * DAY - p * DAY;
        expect(dataStart).toBeLessThanOrEqual(t0 - 7 * DAY);
        expect(dataStart).toBeGreaterThan(t0 - 8 * DAY - 1);
      }
      expect(forecastPastDaysFor(now + 3 * DAY, now)).toBe(7);
    }
  });
  it('a stored forecast that ends before t0 + 1 h is not used (fallback preset instead of a held last stamp)', async () => {
    const n = net(KATOOMBA_NOW_ROUTES());
    await resolveWeather({ kind: 'now' }, ctx({ kv: n.kv }));
    const fc = parseOpenMeteoHourly(fixture('openmeteo-forecast-katoomba.json')).series;
    const last = fc.hours[fc.hours.length - 1]!.time;
    const late = await resolveWeather({ kind: 'forecast', start: last - 0.5 * H }, ctx({ kv: n.kv, online: false }));
    expect(late.origin).toBe('fallback');
    const ok = await resolveWeather({ kind: 'forecast', start: last - 2 * H }, ctx({ kv: n.kv, online: false }));
    expect(ok.origin).toBe('cache');
    expect(ok.maxDuration).toBeCloseTo(2 * 3600, 6);
  });
  it('online but no usable model response → the fallback preset with an "unavailable" (not "offline") message', async () => {
    const access = fixture<OpenMeteoResponse>('openmeteo-forecast-katoomba-access.json'); // all-null
    const n = net([{ match: ['api.open-meteo.com/v1/forecast'], body: access }]);
    const w = await resolveWeather({ kind: 'now' }, ctx({ kv: n.kv }));
    expect(w.origin).toBe('fallback');
    expect(w.warnings.some((x) => x.startsWith('No usable forecast from the weather service'))).toBe(true);
    expect(w.warnings.some((x) => x.startsWith('Offline'))).toBe(false);
  });
  it('belt-kit readings in a manual run are its readings: psychrometer at station pressure, kit wind × 1.25 (D38, D39)', async () => {
    const r = beltKitReading({ dryBulb: 32, wetBulb: 19, windKmh: 25, windDir: 315, time: KATOOMBA_NOW, elevation: 950 });
    const series: WeatherSeries = { kind: 'manual', source: 'UI', location: KAT, timezone: 'Australia/Sydney', hours: [], droughtFactor: 8 };
    const w = await resolveWeather({ kind: 'manual', series }, ctx({ beltKit: [r] }));
    expect(w.t0).toBe(KATOOMBA_NOW);
    expect(w.series.kind).toBe('belt-kit');
    const h = weatherAtT(w.series, KATOOMBA_NOW);
    expect(h.windSpeed10).toBeCloseTo((25 / 3.6) * 1.25, 9);
    expect(h.relativeHumidity).toBeCloseTo(psychrometerRh(32, 19, pressureIsa(950)), 9);
    expect(w.series.sourceElevation).toBe(950);
    expect(w.series.droughtFactor).toBe(8);
    expect(w.series.hours[w.series.hours.length - 1]!.time).toBeGreaterThanOrEqual(KATOOMBA_NOW + 4 * H);
  });
});

describe('past mode: ERA5 as the last surface fallback', () => {
  it('historical-forecast unavailable → ERA5 archive with the model-fallback warning', async () => {
    const replay = fixture<OpenMeteoResponse>('replay-gospers-2019-12-19.json');
    const n = net([{ match: ['archive-api.open-meteo.com/v1/archive', 'models=era5', 'hourly='], body: replay }]);
    const t0 = Date.UTC(2019, 11, 19, 3);
    const w = await resolveWeather({ kind: 'past', start: t0 }, ctx({ kv: n.kv, centre: { lat: -32.98, lon: 150.6 }, siteId: 'gospers' }));
    expect(w.origin).toBe('network');
    expect(w.series.source).toMatch(/era5 ERA5 reanalysis/);
    expect(w.warnings).toContain(MESSAGES.weatherModelFallback('era5'));
    expect(w.warnings).toContain(MESSAGES.syntheticUpperAir);
  });
});
