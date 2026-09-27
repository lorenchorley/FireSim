/**
 * Weather by mode and drought for a scenario (spec §11.1–§11.5, §5.7–§5.8, D34).
 *
 * | mode            | source                                                                                          |
 * |-----------------|-------------------------------------------------------------------------------------------------|
 * | now / forecast  | forecast API best_match (→ ecmwf_ifs), past_days 7; pressure levels from ecmwf_ifs025 → gfs_seamless if null |
 * | past ≥ now−92 d | forecast API with past_days up to 92                                                            |
 * | past ≥ 2016     | historical-forecast API ecmwf_ifs                                                               |
 * | past < 2016     | ERA5 archive (10 m + 100 m wind, no pressure levels)                                            |
 * | replay          | bundled public/replays/<id>.json + -daily365.json (offline)                                     |
 * | preset          | WEATHER_PRESETS generator at z_s = domain median (offline)                                      |
 * | manual          | readings / belt kit (offline)                                                                   |
 *
 * Every response is cached (KV, key by URL); on HTTP 429 the request backs off 60 s up to 3 times, then the cached
 * (stale) copy is used. Offline, a cached response covering [t0 − 24 h, t0 + duration] is used; failing that the
 * builder falls back to a preset (SCENARIO_PARAMS.offlineWeatherFallbackPreset, deviation from the spec's error).
 * Drought: KBDI (two passes, fuel/moisture) and DF from the 365-day daily history (archive + forecast gap-fill),
 * annual rainfall from the 10-year archive mean → demo table → 1.25 × the last 365 days.
 */
import type { DailyWeather, LatLon, WeatherSeries, WindEdit } from '../core/types';
import { cachedFetch, fetchJson, findAreaPacks, isHttpError, loadAreaPackItem, openCache, type CacheOrigin, type KV } from '../data';
import { droughtFactor, kbdiSeries } from '../fuel/moisture/drought';
import { applyBeltKitToForecast, normaliseManualSeries, type BeltKitReading } from './beltKit';
import { MESSAGES } from './messages';
import {
  LEVEL_MODELS,
  SURFACE_MODELS,
  OM_LEVEL_VARS,
  annualRainfallFromDaily,
  archiveDailyUrl,
  archiveHourlyUrl,
  dailyFromHourly,
  forecastUrl,
  historicalForecastUrl,
  mergePressureLevels,
  parseOpenMeteoDaily,
  parseOpenMeteoHourly,
  type OpenMeteoResponse,
} from './openMeteo';
import { SCENARIO_PARAMS, demoAnnualRainfall } from './params';
import { WEATHER_PRESETS, isPresetId } from './presets';
import { clampReplayStart, loadReplay, type ReplayInfo } from './replays';
import type { WeatherMode } from './request';
import { addDaysIso, civilDate, civilToUtc, daysBetweenIso } from './time';
import { rainBetween, seriesCovers, seriesSpan, trimSeries } from './weather';

const H = 3.6e6;
const DAY = 86.4e6;

export interface WeatherContext {
  /** Domain centre (request location). */
  centre: LatLon;
  /** Demo site (annual-rainfall table), if any. */
  siteId?: string;
  online: boolean;
  signal?: AbortSignal;
  kv?: KV;
  /** Clock (unix ms), injectable for tests. */
  now: number;
  /** Simulated duration (s). */
  duration: number;
  /** Domain median elevation z_s (preset reference, D46). */
  medianElevation: number;
  /** Elevation at the domain centre (manual readings' site). */
  centreElevation: number;
  /** Domain relief (max − min elevation, m): the D43 lapse rate of the belt-kit offset (§5.2, §11.5). */
  relief?: number;
  /** Belt-kit readings to blend into a forecast (§11.5). */
  beltKit?: BeltKitReading[];
  /** Status messages (rate-limit waits). */
  onStatus?: (message: string) => void;
  /** Override of the 429 back-off (ms), tests. */
  rateLimitBackoffMs?: number;
}

export interface ResolvedWeather {
  series: WeatherSeries;
  /** Scenario start (unix ms). */
  t0: number;
  /** Largest duration (s) the series supports from t0 (≥ the request when possible). */
  maxDuration: number;
  warnings: string[];
  /** Wind edits from belt-kit readings. */
  edits: WindEdit[];
  /** How the weather was obtained. */
  origin: 'network' | 'cache' | 'stale' | 'pack' | 'bundled' | 'generated' | 'manual' | 'fallback';
  /** Daily history already known (replays). */
  daily?: DailyWeather[];
  /** Replay metadata when mode = replay. */
  replay?: ReplayInfo;
  /** Hourly data before trimming (daily gap-fill). */
  untrimmed?: WeatherSeries;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cached, rate-limit-aware Open-Meteo GET
// ─────────────────────────────────────────────────────────────────────────────

interface CacheRecord<T> {
  t: number;
  url: string;
  v: T;
}

export const omCacheKey = (url: string): string => `openmeteo/${url}`;

export class OfflineError extends Error {
  override readonly name = 'OfflineError';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Build cancelled', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new DOMException('Build cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * GET an Open-Meteo JSON document through the cache: network-first (online) with the 429 back-off of §11.1, cache only
 * (offline). Throws {@link OfflineError} offline with nothing cached.
 */
export async function omFetch(url: string, ctx: Pick<WeatherContext, 'online' | 'signal' | 'kv' | 'onStatus' | 'rateLimitBackoffMs'>): Promise<{ data: OpenMeteoResponse; from: CacheOrigin; fetchedAt: number }> {
  const kv = ctx.kv ?? openCache();
  const key = omCacheKey(url);
  if (!ctx.online) {
    const rec = await kv.get<CacheRecord<OpenMeteoResponse>>(key).catch(() => undefined);
    if (!rec) throw new OfflineError(`offline: not cached: ${url}`);
    return { data: rec.v, from: 'cache', fetchedAt: rec.t };
  }
  const P = SCENARIO_PARAMS;
  const fetcher = async (u: string, opts: { signal?: AbortSignal }): Promise<OpenMeteoResponse> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const j = await fetchJson<OpenMeteoResponse>(u, opts);
        if (j && (j as { error?: boolean }).error) throw new Error(`Open-Meteo: ${(j as { reason?: string }).reason ?? 'error'}`);
        return j;
      } catch (e) {
        if (isHttpError(e) && e.status === 429 && attempt < P.rateLimitRetries && !ctx.signal?.aborted) {
          const wait = ctx.rateLimitBackoffMs ?? P.rateLimitBackoffMs;
          ctx.onStatus?.(MESSAGES.rateLimited(Math.round(wait / 1000)));
          await sleep(wait, ctx.signal);
          continue;
        }
        throw e;
      }
    }
  };
  return cachedFetch<OpenMeteoResponse>(url, key, fetcher, { kv, ...(ctx.signal ? { signal: ctx.signal } : {}), policy: 'network-first' }, 'network-first');
}

// ─────────────────────────────────────────────────────────────────────────────
// Live modes
// ─────────────────────────────────────────────────────────────────────────────

type LiveKind = 'forecast' | 'historical';

interface LivePlan {
  kind: LiveKind;
  /** Surface requests in fallback order: [model, url]. */
  surface: [model: string, url: string, label?: string][];
  /** Pressure-level fallback requests. */
  levels: [string, string][];
  label: string;
}

const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Surface variables requested with the pressure-level fallbacks (so the parser's required checks pass). */
const REQUIRED_VARS = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m'];

/**
 * past_days needed so the forecast API's data (which start at 00:00 UTC `past_days` days before today, UTC) reach back
 * to t0 − 7 days (the §5.6 spin-up window): 7 for now / forecast starts (spec §11.1 `past_days=7`), more for a recent
 * past start.
 */
export function forecastPastDaysFor(t0: number, now: number): number {
  const P = SCENARIO_PARAMS;
  const sinceUtcMidnight = now - Math.floor(now / DAY) * DAY;
  return P.forecastPastDays + Math.max(0, Math.ceil((now - t0 - sinceUtcMidnight) / DAY));
}

/**
 * The request plan of a live mode (§11.1). A past start uses the forecast API (past_days ≤ 92) while its 7-day
 * spin-up window is inside the last 92 days, else the historical-forecast API (2016+) or the ERA5 archive.
 */
export function livePlan(loc: LatLon, t0: number, durationS: number, now: number, isPast: boolean): LivePlan {
  const P = SCENARIO_PARAMS;
  const end = t0 + durationS * 1000;
  const needPast = forecastPastDaysFor(t0, now);
  const recent = needPast <= P.maxPastDays;
  if (!isPast || recent) {
    const pastDays = Math.min(P.maxPastDays, needPast);
    const forecastDays = Math.min(P.maxForecastDays, Math.max(isPast ? 1 : P.forecastDays, Math.ceil((end - now) / DAY) + 1));
    return {
      kind: 'forecast',
      surface: SURFACE_MODELS.map((m) => [m, forecastUrl(loc, { model: m, pastDays, forecastDays })]),
      levels: LEVEL_MODELS.map((m) => [m, forecastUrl(loc, { model: m, pastDays, forecastDays, vars: [...REQUIRED_VARS, ...OM_LEVEL_VARS] })]),
      label: 'forecast',
    };
  }
  const startDate = utcDate(t0 - P.spinupHours * H);
  const endDate = utcDate(end + DAY);
  if (t0 >= P.historicalForecastFromMs) {
    return {
      kind: 'historical',
      // ERA5 (no upper air) is the last resort when the historical-forecast archive has no usable data (e.g. its
      // early years): first available wins, with the model-fallback warning (§11.6).
      surface: [
        ...(['ecmwf_ifs', 'best_match'] as const).map((m): [string, string] => [m, historicalForecastUrl(loc, startDate, endDate, m)]),
        ['era5', archiveHourlyUrl(loc, startDate, endDate), 'ERA5 reanalysis'],
      ],
      levels: LEVEL_MODELS.map((m) => [m, historicalForecastUrl(loc, startDate, endDate, m, [...REQUIRED_VARS, ...OM_LEVEL_VARS])]),
      label: 'historical forecast',
    };
  }
  return { kind: 'historical', surface: [['era5', archiveHourlyUrl(loc, startDate, endDate)]], levels: [], label: 'ERA5 reanalysis' };
}

/** Parse and validate one response for the window; null when unusable. */
function usable(json: OpenMeteoResponse, kind: LiveKind, source: string, from: number, to: number): WeatherSeries | null {
  try {
    const p = parseOpenMeteoHourly(json, { kind, source });
    if (p.missingRequired.length) return null;
    if (!seriesCovers(p.series, from, to)) return null;
    return p.series;
  } catch {
    return null;
  }
}

/** Search the cache and area packs for a stored hourly response covering [from, to] at the location. */
async function storedWeather(loc: LatLon, from: number, to: number, ctx: WeatherContext): Promise<{ series: WeatherSeries; fetchedAt: number; origin: 'cache' | 'pack' } | null> {
  const kv = ctx.kv ?? openCache();
  const tag = `latitude=${loc.lat.toFixed(3)}&longitude=${loc.lon.toFixed(3)}`;
  let best: { series: WeatherSeries; fetchedAt: number; origin: 'cache' | 'pack' } | null = null;
  try {
    for (const key of await kv.keys('openmeteo/')) {
      if (!key.includes(tag) || !key.includes('&hourly=')) continue;
      const rec = await kv.get<CacheRecord<OpenMeteoResponse>>(key);
      if (!rec) continue;
      const s = usable(rec.v, key.includes('historical') || key.includes('archive') ? 'historical' : 'forecast', `Open-Meteo (stored ${new Date(rec.t).toISOString().slice(0, 16)}Z)`, from, to);
      if (s && (!best || rec.t > best.fetchedAt)) best = { series: s, fetchedAt: rec.t, origin: 'cache' };
    }
  } catch {
    /* no cache */
  }
  if (best) return best;
  try {
    // Weather is point data: any pack whose square contains the domain centre will do.
    for (const m of await findAreaPacks(ctx.centre, 0, kv)) {
      if (!m.itemNames.includes('weather')) continue;
      const w = await loadAreaPackItem<OpenMeteoResponse>(m.id, 'weather', kv);
      if (!w) continue;
      const s = usable(w, 'forecast', `Open-Meteo forecast (area pack '${m.name}')`, from, to);
      if (s) return { series: s, fetchedAt: m.createdAt, origin: 'pack' };
    }
  } catch {
    /* no packs */
  }
  return null;
}

async function liveWeather(t0: number, isPast: boolean, ctx: WeatherContext): Promise<ResolvedWeather | null> {
  const P = SCENARIO_PARAMS;
  const loc = ctx.centre;
  const plan = livePlan(loc, t0, ctx.duration, ctx.now, isPast);
  const warnings: string[] = [];
  const from = t0 - P.minCachedSpinupHours * H;
  const to = t0 + ctx.duration * 1000;
  // Every accepted response must hold at least min(duration, 1 h) of weather after t0 (a shorter tail clamps the
  // duration with a warning, see build.ts); stored responses also need the 24 h spin-up before t0.
  const minTo = t0 + Math.min(ctx.duration * 1000, P.minWeatherAfterStartH * H);
  let series: WeatherSeries | null = null;
  let origin: ResolvedWeather['origin'] = 'network';
  let fetchedAt = ctx.now;
  if (ctx.online) {
    for (let i = 0; i < plan.surface.length && !series; i++) {
      const [model, url, label] = plan.surface[i]!;
      try {
        const r = await omFetch(url, ctx);
        // A fresh response only has to start by t0 (a short spin-up is warned about below); stored ones need 24 h.
        series = usable(r.data, plan.kind, `Open-Meteo ${model} ${label ?? plan.label}`, r.from === 'network' ? t0 : from, minTo);
        if (series) {
          origin = r.from;
          fetchedAt = r.fetchedAt;
          if (i > 0) warnings.push(MESSAGES.weatherModelFallback(model));
        }
      } catch (e) {
        if (ctx.signal?.aborted) throw e;
      }
    }
  }
  if (!series) {
    const st = await storedWeather(loc, from, minTo, ctx);
    if (st) {
      series = st.series;
      origin = st.origin;
      fetchedAt = st.fetchedAt;
    }
  }
  if (!series) return null;
  if (origin !== 'network') warnings.push(MESSAGES.staleWeather(Math.max(0, (ctx.now - fetchedAt) / H)));
  // Pressure levels: re-request from the profile models when the surface model had none (§11.1).
  if (series.upperAirSource !== 'model' && ctx.online) {
    for (const [model, url] of plan.levels) {
      try {
        const r = await omFetch(url, ctx);
        const lv = parseOpenMeteoHourly(r.data, { kind: plan.kind });
        if (lv.levels >= P.minPressureLevels && mergePressureLevels(series, lv.series) > 0) {
          warnings.push(MESSAGES.pressureLevelFallback(model));
          break;
        }
      } catch (e) {
        if (ctx.signal?.aborted) throw e;
      }
    }
  }
  if (series.upperAirSource !== 'model') warnings.push(MESSAGES.syntheticUpperAir);
  const untrimmed = series;
  const span = seriesSpan(series);
  const trimmed = trimSeries(series, t0 - P.spinupHours * H, to + P.tailHours * H);
  const before = (t0 - span.start) / H;
  if (before < P.spinupHours - 1) warnings.push(MESSAGES.shortSpinup(before));
  return { series: trimmed, t0, maxDuration: Math.max(0, (span.end - t0) / 1000), warnings, edits: [], origin, untrimmed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode dispatch
// ─────────────────────────────────────────────────────────────────────────────

const round10min = (ms: number): number => Math.floor(ms / 600_000) * 600_000;

/** Belt-kit readings (already converted by beltKitReading) as manual-series stamps. */
function beltKitHours(readings: BeltKitReading[]): WeatherSeries['hours'] {
  return [...readings]
    .sort((a, b) => a.time - b.time)
    .map((r) => ({
      time: r.time,
      temperature: r.temperature,
      relativeHumidity: r.relativeHumidity,
      dewPoint: r.dewPoint,
      windSpeed10: r.windSpeed10,
      windDir10: r.windDir10,
      ...(r.cloudCover !== undefined ? { cloudCover: r.cloudCover } : {}),
    }));
}

/** Build a preset series for the context. */
function presetWeather(id: string, t0: number, ctx: WeatherContext): ResolvedWeather {
  const preset = isPresetId(id) ? WEATHER_PRESETS[id] : null;
  if (!preset) throw new Error(`Unknown weather preset '${id}'`);
  const rain = demoAnnualRainfall(ctx.siteId);
  const series = preset.build(t0, Math.ceil(ctx.duration / 3600) + 1, {
    location: { ...ctx.centre },
    sourceElevation: ctx.medianElevation,
    ...(rain !== undefined ? { annualRainfall: rain } : {}),
  });
  return { series, t0, maxDuration: Infinity, warnings: [], edits: [], origin: 'generated' };
}

/**
 * Resolve the weather of a request mode (§11.1–§11.5). Never throws for a network problem while
 * `offlineWeatherFallbackPreset` is set: the preset is used with a warning.
 */
export async function resolveWeather(mode: WeatherMode, ctx: WeatherContext): Promise<ResolvedWeather> {
  const P = SCENARIO_PARAMS;
  switch (mode.kind) {
    case 'preset': {
      const t0 = Number.isFinite(mode.start) ? mode.start : round10min(ctx.now);
      return presetWeather(mode.presetId, t0, ctx);
    }
    case 'replay': {
      const rp = await loadReplay(mode.replayId, ctx.signal);
      const warnings: string[] = [];
      let t0 = rp.defaultStart;
      if (mode.start !== undefined && Number.isFinite(mode.start)) {
        const c = clampReplayStart(rp.series, mode.start);
        t0 = c.start;
        if (c.moved) warnings.push(MESSAGES.replayStartClamped);
      }
      warnings.push(MESSAGES.syntheticUpperAir);
      const span = seriesSpan(rp.series);
      return { series: rp.series, t0, maxDuration: (span.end - t0) / 1000, warnings, edits: [], origin: 'bundled', daily: rp.daily, replay: rp.info };
    }
    case 'manual': {
      // Belt-kit readings given with a manual run ARE its readings (psychrometer D38, 2 m → 10 m wind D39); the
      // series then only contributes drought, annual rainfall and the night template.
      const kitHours = ctx.beltKit?.length ? beltKitHours(ctx.beltKit) : null;
      const hs = kitHours ?? [...mode.series.hours].sort((a, b) => a.time - b.time);
      if (!hs.length) throw new Error('Manual weather: no readings');
      const t0 = mode.start ?? (kitHours ? hs[0]!.time : (hs.find((h) => h.time >= hs[0]!.time + H)?.time ?? hs[0]!.time));
      const input: WeatherSeries = kitHours
        ? { ...mode.series, kind: 'belt-kit', source: 'Belt weather kit readings', hours: kitHours, ...(ctx.beltKit![0]!.elevation !== undefined ? { sourceElevation: ctx.beltKit![0]!.elevation } : {}) }
        : { ...mode.series };
      if (input.kbdi === undefined && mode.kbdi !== undefined) input.kbdi = mode.kbdi;
      const r = normaliseManualSeries(input, {
        from: t0 - P.minCachedSpinupHours * H,
        to: t0 + ctx.duration * 1000 + H,
        sourceElevation: ctx.centreElevation,
        ...(mode.cloudCover !== undefined ? { cloudCover: mode.cloudCover } : {}),
      });
      // No upper air in a manual run: synthetic profile, C-Haines unavailable (§11.5, §8.2).
      return { series: r.series, t0, maxDuration: Infinity, warnings: [...r.warnings, MESSAGES.syntheticUpperAir], edits: [], origin: 'manual' };
    }
    case 'now':
    case 'forecast':
    case 'past': {
      const t0 = mode.kind === 'now' ? round10min(ctx.now) : mode.start;
      const live = await liveWeather(t0, mode.kind === 'past', ctx);
      if (live) {
        if (ctx.beltKit?.length && mode.kind !== 'past') {
          const b = applyBeltKitToForecast(live.series, ctx.beltKit, {
            origin: ctx.centre,
            t0,
            siteElevation: ctx.centreElevation,
            ...(ctx.relief !== undefined ? { relief: ctx.relief } : {}),
          });
          live.series = b.series;
          live.edits.push(...b.edits);
          live.warnings.push(...b.warnings);
        }
        return live;
      }
      const fb = P.offlineWeatherFallbackPreset;
      if (!fb) throw new OfflineError(MESSAGES.offlineWeather);
      const r = presetWeather(fb, t0, ctx);
      r.origin = 'fallback';
      const fbName = WEATHER_PRESETS[fb as keyof typeof WEATHER_PRESETS]?.name ?? fb;
      r.warnings.push(ctx.online ? MESSAGES.weatherUnavailableFallback(fbName) : MESSAGES.offlineWeatherFallback(fbName));
      return r;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily history, annual rainfall and drought (§11.1, §5.7, §5.8)
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyHistory {
  daily: DailyWeather[];
  source: string;
  warnings: string[];
}

/**
 * 365 local days ending the day before t0: the ERA5 archive up to its last date, then local-day aggregates of the
 * forecast hourly data (`hourly`, e.g. its past_days) up to yesterday. Missing days are assumed dry (warning).
 */
export async function dailyHistory(loc: LatLon, t0: number, ctx: WeatherContext, hourly?: WeatherSeries): Promise<DailyHistory> {
  const P = SCENARIO_PARAMS;
  const tz = P.timezone;
  const today = civilDate(t0, tz);
  const end = addDaysIso(today, -1);
  const start = addDaysIso(today, -P.historyDays);
  const warnings: string[] = [];
  let archive: DailyWeather[] = [];
  let source = 'none';
  try {
    const r = await omFetch(archiveDailyUrl(loc, start, end), ctx);
    archive = parseOpenMeteoDaily(r.data).filter((d) => d.date >= start && d.date <= end);
    source = `Open-Meteo ERA5 archive (daily${r.from !== 'network' ? ', stored' : ''})`;
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
  }
  if (!archive.length) {
    const pk = await packDaily(ctx);
    if (pk) {
      archive = pk.daily.daily.filter((d) => d.date >= start && d.date <= end);
      if (archive.length) source = `daily history (area pack '${pk.pack}')`;
    }
  }
  const byDate = new Map<string, DailyWeather>();
  for (const d of archive) byDate.set(d.date, d);
  const lastArchive = archive.length ? archive[archive.length - 1]!.date : null;
  // Gap-fill after the archive's last date from the hourly data.
  let filled = 0;
  if (hourly) {
    for (const d of dailyFromHourly(hourly, tz)) {
      if (d.date < start || d.date > end) continue;
      if (lastArchive && d.date <= lastArchive) continue;
      if (!byDate.has(d.date)) {
        byDate.set(d.date, d);
        filled++;
      }
    }
  }
  if (byDate.size === 0) return { daily: [], source: 'none', warnings };
  if (filled) {
    warnings.push(MESSAGES.dailyGapFilled(filled));
    source = source === 'none' ? 'forecast hourly (local-day aggregates)' : `${source} + forecast hourly (gap-fill)`;
  }
  // Assemble the consecutive range from the first known day to yesterday, assuming missing days dry.
  const dates = [...byDate.keys()].sort();
  const first = archive.length ? start : dates[0]!;
  const n = daysBetweenIso(first, end) + 1;
  const daily: DailyWeather[] = [];
  let missing = 0;
  let lastT = byDate.get(dates[0]!)!.tMax;
  for (let i = 0; i < n; i++) {
    const date = addDaysIso(first, i);
    const d = byDate.get(date);
    if (d) {
      daily.push(d);
      lastT = d.tMax;
    } else if (date >= dates[0]!) {
      daily.push({ date, rain: 0, tMax: lastT });
      missing++;
    }
  }
  if (missing) warnings.push(MESSAGES.dailyGapDefaulted(missing));
  if (daily.length < P.historyDays) warnings.push(MESSAGES.kbdiShortHistory(daily.length));
  return { daily, source, warnings };
}

/** The `daily` item of an area pack containing the domain centre (see areaPack.ts). */
async function packDaily(ctx: WeatherContext): Promise<{ daily: { daily: DailyWeather[]; annualRainfall?: number }; pack: string } | null> {
  try {
    for (const m of await findAreaPacks(ctx.centre, 0, ctx.kv)) {
      if (!m.itemNames.includes('daily')) continue;
      const d = await loadAreaPackItem<{ daily: DailyWeather[]; annualRainfall?: number }>(m.id, 'daily', ctx.kv);
      if (d && Array.isArray(d.daily)) return { daily: d, pack: m.name };
    }
  } catch {
    /* no packs */
  }
  return null;
}

/** Annual rainfall (mm): cached 10-year archive mean → demo table → undefined (drought then uses 1.25 × 365 d). */
export async function annualRainfall(loc: LatLon, siteId: string | undefined, t0: number, ctx: WeatherContext): Promise<{ mm?: number; source: string }> {
  const P = SCENARIO_PARAMS;
  const kv = ctx.kv ?? openCache();
  const q = P.annualRainfallKeyDeg;
  const key = `annualRainfall/${(Math.round(loc.lat / q) * q).toFixed(2)},${(Math.round(loc.lon / q) * q).toFixed(2)}`;
  const cached = await kv.get<number>(key).catch(() => undefined);
  if (typeof cached === 'number' && cached > 0) return { mm: cached, source: 'Open-Meteo ERA5 10-year mean (stored)' };
  if (ctx.online) {
    const y = Number(civilDate(t0).slice(0, 4));
    try {
      const r = await omFetch(archiveDailyUrl(loc, `${y - P.annualRainfallYears}-01-01`, `${y - 1}-12-31`), ctx);
      const mm = annualRainfallFromDaily(parseOpenMeteoDaily(r.data));
      if (Number.isFinite(mm) && mm > 0) {
        await kv.put(key, mm).catch(() => undefined);
        return { mm, source: `Open-Meteo ERA5 ${P.annualRainfallYears}-year mean` };
      }
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
    }
  }
  const pk = await packDaily(ctx);
  if (pk?.daily.annualRainfall !== undefined && pk.daily.annualRainfall > 0) return { mm: pk.daily.annualRainfall, source: `area pack '${pk.pack}'` };
  const table = demoAnnualRainfall(siteId);
  if (table !== undefined) return { mm: table, source: 'demo-site table' };
  return { source: 'estimated' };
}

export interface DroughtResult {
  kbdi: number;
  df: number;
  annualRainfall?: number;
  daily: DailyWeather[];
  rainLast20: number[];
  warnings: string[];
  source: string;
}

/** Rain (mm) of t0's local day before t0 (counts as a DF event with N = 0.8, §5.8). */
export function rainTodayBefore(series: WeatherSeries, t0: number): number {
  const d = civilDate(t0);
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  return rainBetween(series, civilToUtc(y, m, dd, 0, 0, 0), t0);
}

/** KBDI / DF from a daily history (§5.7–5.8): two KBDI passes, K of yesterday, DF with today's rain before t0. */
export function droughtFromDaily(daily: DailyWeather[], annualRainfallMm: number | undefined, rainTodayMm: number): DroughtResult {
  const P = SCENARIO_PARAMS;
  const warnings: string[] = [];
  if (!daily.length) {
    warnings.push(MESSAGES.droughtDefaults);
    return { kbdi: P.defaultKbdi, df: P.defaultDf, daily: [], rainLast20: new Array<number>(20).fill(0), warnings, source: 'defaults', ...(annualRainfallMm !== undefined ? { annualRainfall: annualRainfallMm } : {}) };
  }
  let R = annualRainfallMm;
  if (!(R !== undefined && R > 0)) {
    let tot = 0;
    for (const d of daily) tot += d.rain > 0 ? d.rain : 0;
    R = (1.25 * tot * 365) / Math.max(365, daily.length);
    warnings.push(MESSAGES.annualRainfallEstimated(R));
  }
  const ks = kbdiSeries(daily, R);
  const kbdi = ks[ks.length - 1]!;
  const last20 = daily.slice(-20).map((d) => d.rain);
  while (last20.length < 20) last20.unshift(0);
  const df = droughtFactor(kbdi, last20, rainTodayMm > 0 ? rainTodayMm : undefined);
  return { kbdi, df, annualRainfall: R, daily, rainLast20: last20, warnings, source: 'daily history' };
}

/** Write drought results onto a series. */
export function applyDrought(series: WeatherSeries, d: DroughtResult): void {
  series.kbdi = d.kbdi;
  series.droughtFactor = d.df;
  series.rainLast20 = d.rainLast20;
  if (d.daily.length) series.daily = d.daily;
  if (d.annualRainfall !== undefined) series.annualRainfall = d.annualRainfall;
}

/**
 * The drought step of the build (§11.6): presets and manual entries carry their own DF / KBDI; replays use the
 * bundled 365-day file and the demo table; live modes fetch the archive (+ forecast gap-fill) and the annual rainfall.
 */
export async function resolveDrought(w: ResolvedWeather, ctx: WeatherContext): Promise<DroughtResult> {
  const s = w.series;
  if (s.kind === 'preset' || s.kind === 'manual' || s.kind === 'belt-kit') {
    const kbdi = s.kbdi ?? SCENARIO_PARAMS.defaultKbdi;
    const df = s.droughtFactor ?? SCENARIO_PARAMS.defaultDf;
    const out: DroughtResult = { kbdi, df, daily: s.daily ?? [], rainLast20: s.rainLast20 ?? new Array<number>(20).fill(0), warnings: [], source: s.kind };
    const R = s.annualRainfall ?? demoAnnualRainfall(ctx.siteId);
    if (R !== undefined) out.annualRainfall = R;
    if (s.kbdi === undefined || s.droughtFactor === undefined) out.warnings.push(MESSAGES.droughtDefaults);
    return out;
  }
  const rainToday = rainTodayBefore(s, w.t0);
  if (w.daily) {
    const R = demoAnnualRainfall(w.replay?.site ?? ctx.siteId);
    const d = droughtFromDaily(w.daily, R, rainToday);
    if (w.daily.length < SCENARIO_PARAMS.historyDays) d.warnings.push(MESSAGES.kbdiShortHistory(w.daily.length));
    d.source = 'bundled replay history';
    return d;
  }
  const hist = await dailyHistory(ctx.centre, w.t0, ctx, w.untrimmed ?? s);
  const R = await annualRainfall(ctx.centre, ctx.siteId, w.t0, ctx);
  const enough = hist.daily.length >= SCENARIO_PARAMS.minHistoryDays;
  const d = droughtFromDaily(enough ? hist.daily : [], R.mm, rainToday);
  // A short history still gives the moisture spin-up its recent rain (P48, hours since rain; §5.6).
  if (!enough && hist.daily.length) {
    d.daily = hist.daily;
    const last20 = hist.daily.slice(-20).map((x) => x.rain);
    while (last20.length < 20) last20.unshift(0);
    d.rainLast20 = last20;
  }
  d.warnings.unshift(...hist.warnings);
  d.source = `${hist.source}; annual rainfall: ${R.source}`;
  return d;
}
