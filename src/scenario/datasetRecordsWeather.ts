/**
 * Data-set records for the weather side of a scenario: the weather series ('weather'), its upper-air profile
 * ('upper-air') and the rainfall history behind the drought indices ('drought-history'). Built from what the weather step
 * reported (weatherSources.ts `WeatherDetail`, `DroughtInfo`), the request ledger and the finished series.
 *
 * Wording about the forecast model: Open-Meteo's `models=best_match` is "the best forecast for any given location
 * worldwide" (Open-Meteo documentation, read 2026-09-29) and combines "the best suitable weather models"; the response does
 * not say which model answered, so the records say exactly that and never name a model that was not asked for. The
 * Bureau of Meteorology's ACCESS-G is listed by Open-Meteo but the app does not request it (its Open-Meteo feed returned no
 * data when tested, docs/research/08b), so it is not claimed anywhere.
 */
import { formatAge, formatBytes, formatPercent, type DatasetOrigin, type DatasetRecord, type DatasetStat, WEATHER_STALE_HOURS } from '../core/datasets';
import type { LatLon, WeatherSeries } from '../core/types';
import type { BundleManifest, DatasetLedger } from '../data';
import { droughtStats, num, stat, textStat, weatherStats } from './datasetStats';
import { MESSAGES } from './messages';
import { SCENARIO_PARAMS } from './params';
import { ATTRIBUTION, LICENCES, PROVIDERS, day, endpoint, endpointsOf, extentOf, skeleton, sizesOf, sumTotals, vintageFor } from './recordKit';
import type { DroughtResult, ResolvedWeather } from './weatherSources';
import { DROUGHT_TAG, UPPER_AIR_TAG, WEATHER_TAG } from './weatherSources';

export interface WeatherInputs {
  ledger: DatasetLedger;
  bundle: BundleManifest | null;
  now: number;
  centre: LatLon;
  extentM: number;
  online: boolean;
  weather: ResolvedWeather;
  drought: DroughtResult;
  series: WeatherSeries;
  startTime: number;
  durationS: number;
  terrainMedianElevation: number;
  timings: Partial<Record<'weather' | 'drought', number>>;
  warnings: { weather: string[]; drought: string[] };
  /** Whether the request asked for a past date (24 h staleness rule) or a forecast (6 h). */
  isPast: boolean;
}

/** Plain-English name of the model that answered, worded so that nothing unverifiable is claimed. */
export function modelWording(model: string | undefined): { short: string; long: string } {
  switch (model) {
    case 'best_match':
      return {
        short: "Open-Meteo 'best match'",
        long: "Open-Meteo's automatic 'best match': the best available model for the location, chosen by Open-Meteo (its documentation says it combines the best suitable weather models). The response does not say which model supplied which hours.",
      };
    case 'ecmwf_ifs':
      return { short: 'ECMWF IFS', long: 'The European Centre for Medium-Range Weather Forecasts IFS model (about 9 km), through Open-Meteo.' };
    case 'era5':
      return { short: 'ERA5 reanalysis', long: 'ERA5, the Copernicus / ECMWF reanalysis (about 25 km): a past-weather reconstruction that blends a model with observations, through Open-Meteo.' };
    default:
      return { short: 'Open-Meteo', long: 'Open-Meteo, which serves forecasts from national weather services.' };
  }
}

const OM_SOURCE = endpoint('api.open-meteo.com', '/v1/forecast', 'forecast, past_days up to 92');

/** Bytes of the pressure-level variables in a shared download: their share of the variables received. */
export function upperAirShare(w: ResolvedWeather): number {
  const d = w.detail;
  if (!d.upperAir.sameResponse || d.upperAir.source !== 'model' || !d.variablesPresent) return 0;
  const levelVars = d.upperAir.levels * 5;
  return Math.min(0.9, Math.max(0, levelVars / d.variablesPresent));
}

export function weatherRecord(i: WeatherInputs): DatasetRecord {
  const { weather: w, series, ledger } = i;
  const d = w.detail;
  const t = sumTotals(ledger, [WEATHER_TAG]);
  const share = upperAirShare(w);
  const ws = weatherStats(series, i.startTime, i.durationS, { terrainMedianElevation: i.terrainMedianElevation });
  const stats: DatasetStat[] = [...ws.stats];
  const limitations: string[] = [];
  const warnings = [...i.warnings.weather];
  const mountain = series.sourceElevation !== undefined ? `The forecast point sits at ${num(series.sourceElevation)} m while the terrain here has a median of ${num(i.terrainMedianElevation)} m; ` : '';
  const common = {
    id: 'weather',
    role: 'weather' as const,
    title: 'Weather',
    why: 'Sets wind, temperature and humidity for the whole run: they drive fuel moisture, fire spread and the mountain wind model. Hourly values are interpolated to the simulation steps.',
    layer: { overlay: 'windSpeed', layerId: 'wind' },
    extent: extentOf(i.centre, i.extentM),
    format: 'JSON (hourly series)',
    kind: 'timeseries' as const,
  };
  const tOfSeries = series.hours.length ? { from: series.hours[0]!.time, to: series.hours[series.hours.length - 1]!.time } : null;

  // ── explicit / fallback presets ──
  if (d.presetId) {
    const fallback = w.origin === 'fallback';
    return skeleton({
      ...common,
      what: `A designed weather day ('${d.presetName ?? d.presetId}') generated by the app; it is not a forecast or an observation.`,
      provider: PROVIDERS.app,
      licence: LICENCES.app,
      attribution: ATTRIBUTION.app,
      status: fallback ? 'fallback' : 'used',
      origin: 'preset',
      originDetail: `Preset '${d.presetName ?? d.presetId}'`,
      ...(fallback ? { fallbackReason: d.fallbackReason ?? 'No usable forecast was available.' } : {}),
      vintage: { retrievedAt: i.now, retrievedBasis: 'generated' },
      crs: { native: 'A single point (no grid)', toModel: 'One series applied over the whole model area at the domain median height.' },
      coverage: { fraction: 1, note: 'One designed series applies everywhere.' },
      native: { records: series.hours.length, note: 'Hourly stamps plus extra stamps around the wind change.' },
      model: { records: series.hours.length, resampling: 'generated', note: 'Interpolated in time to the simulation steps.' },
      sizes: sizesOf(t, { records: series.hours.length, durationMs: i.timings.weather }),
      stats,
      evidence: { level: 'synthetic', note: "A designed scenario based on typical NSW fire-weather days ('hot NW wind then a southwesterly change'); values are chosen by FireSim, not measured.", specRef: 'docs/research/00-synthesis.md §11.3' },
      warnings,
      limitations: [
        'Not a forecast: it shows how fire behaves in this kind of weather, not what the weather will do at this place.',
        ...(fallback ? ['A live forecast was requested but could not be used, so this preset stands in.'] : []),
      ],
      endpoints: [],
    });
  }

  // ── user-entered ──
  if (d.mode === 'manual') {
    const belt = series.kind === 'belt-kit';
    return skeleton({
      ...common,
      title: belt ? 'Weather (belt kit readings)' : 'Weather (entered by you)',
      what: belt ? 'Temperature, humidity and wind from readings you took with a belt weather kit.' : 'Temperature, humidity and wind you typed in.',
      provider: PROVIDERS.user,
      licence: LICENCES.user,
      attribution: 'Entered by the user',
      status: 'user',
      origin: 'user',
      vintage: { retrievedAt: i.now, retrievedBasis: 'generated' },
      crs: { native: 'A single point', toModel: 'One series applied over the whole model area; the height difference to the domain centre is corrected.' },
      coverage: { fraction: 1, note: 'Your readings apply everywhere.' },
      native: { records: series.hours.length },
      model: { records: series.hours.length, resampling: 'interpolate-in-time' },
      sizes: sizesOf(t, { records: series.hours.length, durationMs: i.timings.weather }),
      stats,
      evidence: { level: belt ? 'measured' : 'assumed', note: belt ? 'Your own readings, converted by the app (psychrometer humidity, kit wind of about 2 m raised to 10 m).' : 'Values you chose.', specRef: 'docs/research/00-synthesis.md §11.5' },
      warnings,
      limitations: ['Only as good as the readings: one place and time, applied to the whole area and held or blended over the run.', 'There is no upper-air data for typed or kit weather.'],
    });
  }

  // ── replay ──
  if (d.mode === 'replay' && d.replay) {
    const info = d.replay;
    const m = modelWording(info.model);
    const file = d.replay.files?.hourly;
    const fileName = file ? file.path.replace(/^.*\//, '') : `${info.id}.json`;
    const cap = i.bundle?.replays.files[fileName]?.capturedOn;
    return skeleton({
      ...common,
      title: 'Weather (historic fire day)',
      what: `Hourly weather for ${info.name} (${info.date}) from Open-Meteo's historical data, bundled with the app.`,
      provider: PROVIDERS.openMeteo,
      licence: LICENCES.openMeteo,
      attribution: ATTRIBUTION.openMeteo,
      status: 'used',
      origin: 'bundled',
      originDetail: `Bundled replay '${info.id}': ${m.short}`,
      vintage: vintageFor('bundled', t, i.now, {
        capturedOn: info.date,
        capturedNote: `Weather of ${info.date}. ${info.model === 'era5' ? 'ERA5 reanalysis' : 'ECMWF IFS historical forecast (the first hours of each forecast run)'}, downloaded by the developers.`,
        bundleCapturedOn: cap,
      }),
      crs: { native: 'Grid point of a global model (latitude and longitude of the nearest point)', toModel: 'A single series applied over the whole model area, corrected for the height difference (lapse rate) and interpolated in time.' },
      coverage: { fraction: 1, note: 'One point series applies everywhere.' },
      native: { records: series.hours.length, note: info.model === 'era5' ? 'ERA5: about 25 km grid, 18 hourly variables.' : 'ECMWF IFS: about 9 km grid, 42 hourly variables requested (no pressure levels for these dates).' },
      model: { records: series.hours.length, resampling: 'interpolate-in-time' },
      sizes: sizesOf(t, { records: series.hours.length, durationMs: i.timings.weather }),
      endpoints: endpointsOf(ledger, [WEATHER_TAG]),
      sourceServices: [info.model === 'era5' ? endpoint('archive-api.open-meteo.com', '/v1/archive', 'ERA5') : endpoint('historical-forecast-api.open-meteo.com', '/v1/forecast', 'ECMWF IFS')],
      stats,
      evidence: { level: 'modelled', note: `${m.long} Not measurements at your site.`, specRef: 'docs/research/00-synthesis.md §11.4' },
      warnings,
      limitations: [
        `${mountain}a global model with a coarse grid smooths mountains: wind and humidity in gullies and on ridges can differ a lot.`,
        'Historic files have no usable upper-air data, so a synthetic temperature profile is used.',
      ],
      parts: file ? [{ label: fileName, bytes: file.bytes, origin: 'bundled' }] : [],
    });
  }

  // ── live or stored Open-Meteo series ──
  const origin: DatasetOrigin = w.origin === 'network' ? 'live' : w.origin === 'pack' ? 'area-pack' : 'cache';
  const historical = d.liveKind === 'historical';
  const m = modelWording(d.model);
  const ageH = Math.max(0, (i.now - d.fetchedAt) / 3.6e6);
  const limitH = i.isPast || historical ? WEATHER_STALE_HOURS.past : WEATHER_STALE_HOURS.forecast;
  const stale = origin !== 'live' && ageH > limitH;
  if (stale) warnings.push(`Weather stored ${formatAge(ageH).replace(' old', '')} ago is older than ${limitH} h: check it against your belt weather kit.`);
  stats.push(textStat('Model', m.short, m.long), textStat(origin === 'live' ? 'Downloaded' : 'Stored copy downloaded', `${day(d.fetchedAt)} (${formatAge(ageH)})`));
  if (d.triedModels.length > 1) stats.push(textStat('Models asked', d.triedModels.join(', then ')));
  if (d.variablesPresent) stats.push(stat('Hourly variables in the answer', d.variablesPresent, '', 0, `${d.variablesRequested ?? '?'} asked for; empty ones are dropped.`));
  limitations.push(
    `${mountain}a forecast model cell (about 9 to 25 km wide) sees a smoothed mountain, so wind and humidity in gullies and on ridges can differ a lot from the series. Temperature is corrected for height; wind is not.`,
    'No station observations are used: check the series against a belt weather kit reading.',
  );
  if (historical) limitations.push('Past weather comes from stitched forecast runs or the ERA5 reanalysis, not from observations at your site.');
  else limitations.push('A forecast is one possible future; it changes with each model run and is only as good as the run it came from. The model run time is not reported in the response, so the app shows when it downloaded the data.');
  const base = sizesOf(t, { records: series.hours.length, durationMs: i.timings.weather });
  const upperBytes = Math.round(base.transferredBytes * share);
  const sizes = { ...base, transferredBytes: base.transferredBytes - upperBytes, networkBytes: Math.max(0, base.networkBytes - Math.round(base.networkBytes * share)), cachedBytes: Math.max(0, base.cachedBytes - Math.round(base.cachedBytes * share)), ...(base.storedOnDeviceBytes ? { storedOnDeviceBytes: Math.round(base.storedOnDeviceBytes * (1 - share)) } : {}) };
  return skeleton({
    ...common,
    title: historical ? 'Weather (past date)' : 'Weather forecast',
    what: historical
      ? `Hourly past weather (temperature, humidity, wind, cloud, rain) for the point nearest the site, from Open-Meteo's ${d.model === 'era5' ? 'ERA5 reanalysis' : 'historical forecast archive'}.`
      : `An hourly forecast (temperature, humidity, wind, cloud, rain) for the point nearest the site, from Open-Meteo${d.model === 'best_match' ? "'s automatic best-match model selection" : ''}.`,
    provider: PROVIDERS.openMeteo,
    licence: LICENCES.openMeteo,
    attribution: ATTRIBUTION.openMeteo,
    status: stale ? 'partial' : 'used',
    origin,
    originDetail: `${m.short}${origin === 'live' ? '' : origin === 'area-pack' ? ` (area pack '${d.packName ?? ''}')` : ' (stored copy)'}`,
    ...(stale ? { fallbackReason: `The weather is ${formatAge(ageH).replace(' old', '')} old (older than ${limitH} h).` } : {}),
    vintage: {
      retrievedAt: d.fetchedAt,
      retrievedBasis: origin === 'live' ? 'this-build' : 'stored-copy',
      ...(tOfSeries ? { capturedOn: `${day(tOfSeries.from)}/${day(tOfSeries.to)}` } : {}),
      capturedNote: historical ? 'The dates the series covers.' : 'The dates the series covers; the forecast run behind it is not reported by the service.',
    },
    crs: { native: 'Grid point of a global model (latitude and longitude of the nearest point)', toModel: 'A single series applied over the whole model area, corrected for the height difference (lapse rate) and interpolated in time to the simulation steps.' },
    coverage: { fraction: 1, note: 'One point series is applied over the whole area.' },
    native: { records: series.hours.length, channels: ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'wind at 80/120/180 m', 'cloud_cover', 'radiation', 'precipitation', 'boundary_layer_height', 'cape', 'surface_pressure'], note: `Grid cells of about 9 to 25 km depending on the model; ${series.hours.length} hourly stamps kept (a week before the start, the run and 3 h after).` },
    model: { records: series.hours.length, resampling: 'interpolate-in-time', note: `Height correction of ${num(series.sourceElevation !== undefined ? series.sourceElevation - i.terrainMedianElevation : 0)} m applied to temperature.` },
    sizes,
    endpoints: endpointsOf(ledger, [WEATHER_TAG]),
    sourceServices: [d.api ? endpoint(d.api.host, d.api.path, historical ? 'past weather' : 'forecast') : OM_SOURCE],
    stats,
    evidence: {
      level: 'modelled',
      note: historical ? 'A reconstruction of past weather by weather models (not measurements at your site).' : 'A numerical weather forecast for a 9 to 25 km grid cell, not an observation.',
      specRef: 'docs/research/08-data-sources-apis.md §3.1, §3.2, §5.5',
    },
    warnings,
    limitations,
    ...(share > 0 ? { parts: [{ label: `Upper-air (pressure level) variables: ${formatBytes(upperBytes)} of the same download are counted under 'Upper air'`, bytes: upperBytes }] } : {}),
  });
}

export function upperAirRecord(i: WeatherInputs): DatasetRecord {
  const { weather: w, ledger, series } = i;
  const d = w.detail;
  const u = d.upperAir;
  const t = sumTotals(ledger, [UPPER_AIR_TAG]);
  const share = upperAirShare(w);
  const shared = sumTotals(ledger, [WEATHER_TAG]);
  const sharedBytes = Math.round(shared.bytes * share);
  const common = {
    id: 'upper-air',
    role: 'upperAir' as const,
    title: 'Upper-air profile',
    what: 'Temperature, humidity and wind at 925, 850, 700 and 500 hPa (roughly 0.8 to 5.5 km up).',
    why: 'Sets how stable the air is above the fire, the starting wind above the ridges for the mountain wind model, how high smoke can rise, and the C-Haines index.',
    format: 'JSON (hourly pressure-level variables)',
    kind: 'timeseries' as const,
    extent: extentOf(i.centre, i.extentM),
  };
  if (u.source === 'preset') {
    return skeleton({
      ...common,
      provider: PROVIDERS.app,
      licence: LICENCES.app,
      attribution: ATTRIBUTION.app,
      status: 'used',
      origin: 'preset',
      vintage: { retrievedAt: i.now, retrievedBasis: 'generated' },
      coverage: { fraction: 1 },
      sizes: sizesOf(t, { records: series.hours.length }),
      stats: [stat('Pressure levels', u.levels, '')],
      evidence: { level: 'synthetic', note: 'A designed air mass that goes with the preset (levels at 850, 700 and 500 hPa).' },
      limitations: ['Designed by the app to match the preset, not measured or forecast.'],
    });
  }
  if (u.source === 'model') {
    const live = w.origin === 'network' || !u.sameResponse;
    const origin: DatasetOrigin = u.sameResponse ? (w.origin === 'network' ? 'live' : w.origin === 'pack' ? 'area-pack' : 'cache') : live ? 'live' : 'cache';
    const m = modelWording(u.sameResponse ? d.model : u.model);
    const base = sizesOf(t, { records: series.hours.length });
    return skeleton({
      ...common,
      provider: PROVIDERS.openMeteo,
      licence: LICENCES.openMeteo,
      attribution: ATTRIBUTION.openMeteo,
      status: 'used',
      origin,
      originDetail: u.sameResponse ? `From the same download as the weather (${m.short})` : `A separate request to ${u.model ?? 'a profile model'}`,
      vintage: { retrievedAt: u.sameResponse ? d.fetchedAt : t.newestNetworkAt || i.now, retrievedBasis: origin === 'live' ? 'this-build' : 'stored-copy' },
      crs: { native: 'Grid point of a global model, pressure levels', toModel: 'Heights above sea level converted to heights above the ground at the domain centre; interpolated in time.' },
      coverage: { fraction: 1, note: 'One profile applies over the whole area.' },
      native: { records: series.hours.length, note: `${u.levels} pressure levels x 5 variables (temperature, humidity, wind speed, wind direction, geopotential height).` },
      model: { records: series.hours.length, resampling: 'interpolate-in-time' },
      sizes: u.sameResponse
        ? { ...base, transferredBytes: sharedBytes, networkBytes: w.origin === 'network' ? Math.round(shared.networkBytes * share) : 0, cachedBytes: Math.round(shared.cacheBytes * share), requests: 0, records: series.hours.length }
        : base,
      endpoints: u.sameResponse ? [] : endpointsOf(ledger, [UPPER_AIR_TAG]),
      sourceServices: [endpoint('api.open-meteo.com', '/v1/forecast', u.sameResponse ? 'pressure-level variables of the weather request' : `models=${u.model ?? ''}, pressure levels only`)],
      stats: [
        stat('Pressure levels complete', u.levels, ''),
        textStat('Where it came from', u.sameResponse ? 'The same download as the weather' : `A separate request (${u.model ?? 'profile model'})`),
        ...(u.sameResponse ? [textStat('Size', `about ${formatBytes(sharedBytes)} (${formatPercent(share)} of the weather download, by variables)`, 'The two data sets share one download; the split is by number of variables, so it is an estimate.')] : []),
      ],
      evidence: { level: 'modelled', note: 'Model profile for a 9 to 25 km cell; coarse in the vertical (four levels).', specRef: 'docs/research/08-data-sources-apis.md §5.3' },
      limitations: ['Four levels only, and a model cell much larger than the mountains: a coarse picture of the air above the ridges.', 'Levels below the model’s own ground are ignored.'],
      warnings: w.warnings.filter((x) => x.startsWith('Upper-air')),
    });
  }
  return skeleton({
    ...common,
    provider: PROVIDERS.app,
    licence: LICENCES.app,
    attribution: ATTRIBUTION.app,
    status: 'fallback',
    origin: 'synthetic',
    fallbackReason: MESSAGES.syntheticUpperAir,
    vintage: { retrievedAt: i.now, retrievedBasis: 'generated' },
    coverage: { fraction: 0, filledBy: 'a synthetic temperature profile', filledOrigin: 'synthetic' },
    sizes: sizesOf(t),
    stats: [],
    evidence: { level: 'assumed', note: 'A standard-shaped profile built from the surface weather; nothing was measured or forecast aloft.' },
    limitations: ['C-Haines and the stability insight cards are unavailable without real upper-air data.', 'The wind above the ridges is inferred from the surface wind.'],
  });
}

export function droughtRecord(i: WeatherInputs): DatasetRecord {
  const { drought: dr, ledger, series } = i;
  const info = dr.info;
  const t = sumTotals(ledger, [DROUGHT_TAG]);
  const ds = droughtStats(series);
  const kind = info?.kind ?? 'defaults';
  const common = {
    id: 'drought-history',
    role: 'weather' as const,
    title: 'Rainfall history and drought',
    what: 'A year of daily rain and maximum temperature before the start, and the usual yearly rainfall, worked into the Keetch-Byram Drought Index and the drought factor.',
    why: 'Sets how dry the deep fuel is at the start: it lowers fuel moisture and raises the fire danger index.',
    format: 'JSON (daily series)',
    kind: 'timeseries' as const,
    extent: extentOf(i.centre, i.extentM),
  };
  const stats = ds.stats;
  if (kind === 'preset' || kind === 'manual') {
    return skeleton({
      ...common,
      provider: kind === 'preset' ? PROVIDERS.app : PROVIDERS.user,
      licence: kind === 'preset' ? LICENCES.app : LICENCES.user,
      attribution: kind === 'preset' ? ATTRIBUTION.app : 'Entered by the user',
      status: kind === 'preset' ? 'used' : 'user',
      origin: kind === 'preset' ? 'preset' : 'user',
      vintage: { retrievedAt: i.now, retrievedBasis: 'generated' },
      coverage: { fraction: 1 },
      sizes: sizesOf(t),
      stats: [...stats, ...(info?.annualRainfallKind === 'demo-table' ? [textStat('Usual yearly rainfall from', 'a table of approximate values kept by the app (not from the Bureau of Meteorology)')] : [])],
      evidence: { level: kind === 'preset' ? 'synthetic' : 'assumed', note: kind === 'preset' ? 'Drought values designed with the preset.' : 'The drought factor you entered (KBDI inferred from it).' },
      warnings: [...i.warnings.drought],
      limitations: ['No rainfall history is used: the drought values are given, not worked out.'],
    });
  }
  if (kind === 'replay') {
    const f = info?.replayFile;
    return skeleton({
      ...common,
      provider: PROVIDERS.openMeteo,
      licence: LICENCES.openMeteo,
      attribution: ATTRIBUTION.openMeteo,
      status: 'used',
      origin: 'bundled',
      originDetail: 'Bundled 365-day rainfall file of the replay',
      vintage: vintageFor('bundled', t, i.now, { capturedNote: 'ERA5 reanalysis daily values for the 365 days before the fire day.', bundleCapturedOn: f ? i.bundle?.replays.files[f.path.replace(/^.*\//, '')]?.capturedOn : undefined }),
      coverage: { fraction: 1 },
      native: { records: info?.dailyDays },
      sizes: sizesOf(t, { records: info?.dailyDays }),
      sourceServices: [endpoint('archive-api.open-meteo.com', '/v1/archive', 'ERA5 daily rain and temperature')],
      endpoints: endpointsOf(ledger, [DROUGHT_TAG]),
      stats: [...stats, textStat('Usual yearly rainfall from', 'a table kept by the app (approximate, not from the Bureau of Meteorology)')],
      evidence: { level: 'modelled', note: 'Reanalysis rainfall (about 25 km) is smooth over mountains; the usual yearly rainfall is a table of approximate values.', specRef: 'docs/research/00-synthesis.md §5.7' },
      warnings: [...i.warnings.drought],
      limitations: ['Reanalysis rain is smoothed over mountains: escarpments can get much more than the series shows.', "The usual yearly rainfall for demo sites is a hand-kept table of approximations of climate averages (marked UNVERIFIED in the spec)."],
      parts: f ? [{ label: f.path.replace(/^.*\//, ''), bytes: f.bytes, origin: 'bundled' }] : [],
    });
  }
  if (kind === 'defaults' || !info) {
    return skeleton({
      ...common,
      provider: PROVIDERS.app,
      licence: LICENCES.app,
      attribution: ATTRIBUTION.app,
      status: 'fallback',
      origin: 'synthetic',
      fallbackReason: `No rainfall history was available, so the defaults are used: drought factor ${SCENARIO_PARAMS.defaultDf}, KBDI ${SCENARIO_PARAMS.defaultKbdi}.`,
      vintage: { retrievedAt: i.now, retrievedBasis: 'generated' },
      coverage: { fraction: 0, filledBy: 'default drought values', filledOrigin: 'synthetic' },
      sizes: sizesOf(t),
      stats,
      evidence: { level: 'assumed', note: 'Moderate default values; the real drought state is unknown.' },
      warnings: [...i.warnings.drought, MESSAGES.droughtDefaults].filter((x, k, a) => a.indexOf(x) === k),
      limitations: ['Enter the local drought factor if you know it: it changes fuel dryness and the danger index.'],
    });
  }
  // live
  const origin: DatasetOrigin = info.packName ? 'area-pack' : info.stored ? 'cache' : 'live';
  const short = (info.dailyDays ?? 0) < SCENARIO_PARAMS.historyDays;
  const filled = (info.gapFilledDays ?? 0) + (info.defaultedDays ?? 0);
  return skeleton({
    ...common,
    provider: PROVIDERS.openMeteo,
    licence: LICENCES.openMeteo,
    attribution: ATTRIBUTION.openMeteo,
    status: short || (info.defaultedDays ?? 0) > 0 ? 'partial' : 'used',
    origin,
    originDetail: dr.source,
    ...(short || filled ? { fallbackReason: `${info.archiveDays ?? 0} of ${info.dailyDays} days come from the archive; ${info.gapFilledDays ?? 0} were filled from the forecast and ${info.defaultedDays ?? 0} assumed dry.` } : {}),
    vintage: {
      retrievedAt: info.fetchedAt ?? t.newestNetworkAt ?? i.now,
      retrievedBasis: origin === 'live' ? 'this-build' : 'stored-copy',
      capturedNote: 'ERA5 reanalysis daily values; the archive lags by about 5 days, so the last days come from the forecast.',
    },
    crs: { native: 'Grid point of the ERA5 reanalysis (about 25 km)', toModel: 'One point series; the drought indices apply over the whole area.' },
    coverage: { fraction: 1, note: 'One point series is applied over the whole area.' },
    native: { records: info.dailyDays, channels: ['precipitation_sum', 'temperature_2m_max', 'temperature_2m_min'] },
    model: { records: info.dailyDays, resampling: 'none', note: 'KBDI is run day by day; the drought factor also uses the last 20 days of rain.' },
    sizes: sizesOf(t, { records: info.dailyDays, durationMs: i.timings.drought }),
    endpoints: endpointsOf(ledger, [DROUGHT_TAG]),
    sourceServices: [endpoint('archive-api.open-meteo.com', '/v1/archive', 'ERA5 daily rain and temperature')],
    stats: [...stats, textStat('Usual yearly rainfall from', info.annualRainfallSource ?? 'n/a')],
    evidence: { level: 'modelled', note: 'ERA5 reanalysis rainfall (about 25 km); KBDI and the drought factor are calculated from it.', specRef: 'docs/research/00-synthesis.md §5.7, §5.8' },
    warnings: [...i.warnings.drought],
    limitations: [
      'Reanalysis rain is smooth over mountains: escarpments can get much more than the series shows, so drought may be overstated in a wet gully.',
      ...(info.annualRainfallKind === 'demo-table' ? ['The usual yearly rainfall comes from a table of approximate values kept by the app.'] : []),
      ...(info.annualRainfallKind === 'estimated' ? ['The usual yearly rainfall is unknown: 1.25 times the last year’s rain is used.'] : []),
    ],
  });
}
