/**
 * Belt weather kit and manual weather entry (spec §11.5, D38, D39).
 *
 * - Psychrometer (D38, KNMI form, doc 04 §3.10): e = e_s(T_w) − 6.53e-4·(1 + 9.44e-4·T_w)·p·(T − T_w),
 *   RH = 100·e/e_s(T), Bolton e_s, p = station pressure (default ISA at the site elevation).
 * - Kit wind at ~2 m → 10 m open wind (D39, FBI-TG Table 3.4): × 1.25 open, × 1.67 woodland, × 2.4 forest.
 * - Manual series: readings interpolated linearly between their times (wind as u/v, via weatherAt), the nearest
 *   reading held before the first and after the last; a single reading is held for the whole run (no diurnal shape).
 *   Cloud defaults to the user's cloud entry, else 0 %; sourceElevation = the reading's site elevation; no upper air.
 * - Drought for manual entry: DF only → KBDI = kbdiFromDf(DF) (no recent rain); KBDI only → DF at x_lim; neither →
 *   DF 7 / KBDI 60 with a warning.
 * - Belt-kit readings in a forecast run: a domain offset on T and T_d (reading − lapse-corrected forecast at the
 *   reading's elevation, Γ of D43 as in fuel/moisture) that is full at the reading and decays linearly to 0 over 3 h,
 *   plus a WindEdit of radius 1 km at the reading location.
 */
import type { LatLon, WeatherHour, WeatherSeries, WeatherSourceKind, WindEdit } from '../core/types';
import { LocalProjection } from '../core/geo';
import { dewPointC, esat, pressureIsa, rhFromTd } from '../core/physics';
import { clamp, wrapDeg } from '../core/units';
import { droughtFactorFromX, droughtXLimit, kbdiFromDf } from '../fuel/moisture/drought';
import { MESSAGES } from './messages';
import { SCENARIO_PARAMS, type BeltExposure } from './params';
import { solarPosition } from '../terrain';
import { lapseRate } from '../fuel/moisture/air';
import { insertStamp, weatherAt } from './weather';

const H = 3.6e6;

export { kbdiFromDf };

// ─────────────────────────────────────────────────────────────────────────────
// Psychrometer and wind height
// ─────────────────────────────────────────────────────────────────────────────

/** Relative humidity (%) from dry and wet bulb (°C) at station pressure (hPa) (D38). NaN if T_w > T + 0.05. */
export function psychrometerRh(dryC: number, wetC: number, pressureHpa: number): number {
  if (!Number.isFinite(dryC) || !Number.isFinite(wetC) || wetC > dryC + 0.05) return NaN;
  const P = SCENARIO_PARAMS;
  const A = P.psychroA * (1 + P.psychroB * wetC);
  const e = esat(wetC) - A * pressureHpa * (dryC - wetC);
  return clamp((100 * e) / esat(dryC), 0, 100);
}

/** 10 m open wind (m/s) from a belt-kit reading at ~2 m (km/h) for the exposure of the reading (D39). */
export function kitWindTo10m(windKmh: number, exposure: BeltExposure = 'open'): number {
  return (Math.max(0, windKmh) / 3.6) * SCENARIO_PARAMS.beltWindRatio[exposure];
}

export interface BeltKitInput {
  dryBulb: number;
  wetBulb: number;
  /** Kit (hand-held, ~2 m) wind speed (km/h). */
  windKmh: number;
  /** Wind direction FROM (deg). */
  windDir: number;
  /** Unix ms of the reading. */
  time: number;
  /** Station pressure (hPa); default ISA at `elevation`. */
  pressureHpa?: number;
  /** Exposure of the wind reading (default 'open'). */
  exposure?: BeltExposure;
  /** Elevation of the reading (m ASL), for the pressure and the lapse correction. */
  elevation?: number;
  /** Where the reading was taken (default: the domain centre). */
  location?: LatLon;
  /** Cloud cover the user sees (%), optional. */
  cloudCover?: number;
}

/** A belt-kit reading converted to model quantities. */
export interface BeltKitReading {
  time: number;
  temperature: number;
  relativeHumidity: number;
  dewPoint: number;
  windSpeed10: number;
  windDir10: number;
  pressureHpa: number;
  exposure: BeltExposure;
  elevation?: number;
  location?: LatLon;
  cloudCover?: number;
}

/** Convert a belt-kit reading (spec §11.5 `beltKitReading`). Throws for an impossible wet bulb (T_w > T). */
export function beltKitReading(inp: BeltKitInput): BeltKitReading {
  const exposure = inp.exposure ?? 'open';
  const p = inp.pressureHpa ?? pressureIsa(inp.elevation ?? 0);
  const rh = psychrometerRh(inp.dryBulb, inp.wetBulb, p);
  if (!Number.isFinite(rh)) throw new RangeError('Belt kit: the wet bulb must not read warmer than the dry bulb.');
  const out: BeltKitReading = {
    time: inp.time,
    temperature: inp.dryBulb,
    relativeHumidity: rh,
    dewPoint: dewPointC(inp.dryBulb, rh),
    windSpeed10: kitWindTo10m(inp.windKmh, exposure),
    windDir10: wrapDeg(inp.windDir),
    pressureHpa: p,
    exposure,
  };
  if (inp.elevation !== undefined) out.elevation = inp.elevation;
  if (inp.location) out.location = { ...inp.location };
  if (inp.cloudCover !== undefined) out.cloudCover = clamp(inp.cloudCover, 0, 100);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drought for manual entry
// ─────────────────────────────────────────────────────────────────────────────

/** Drought inputs of a manual run (§11.5). */
export function manualDrought(df?: number, kbdi?: number): { df: number; kbdi: number; warnings: string[] } {
  const P = SCENARIO_PARAMS;
  const okDf = df !== undefined && Number.isFinite(df);
  const okK = kbdi !== undefined && Number.isFinite(kbdi);
  if (okDf && okK) return { df: clamp(df!, 0, 10), kbdi: clamp(kbdi!, 0, 203.2), warnings: [] };
  if (okDf) {
    const d = clamp(df!, 0, 10);
    const k = kbdiFromDf(d);
    return { df: d, kbdi: k, warnings: [MESSAGES.kbdiFromDf(d, k)] };
  }
  if (okK) {
    const k = clamp(kbdi!, 0, 203.2);
    return { df: droughtFactorFromX(k, Math.min(1, droughtXLimit(k))), kbdi: k, warnings: [] };
  }
  return { df: P.defaultDf, kbdi: P.defaultKbdi, warnings: [MESSAGES.droughtDefaults] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual series
// ─────────────────────────────────────────────────────────────────────────────

/** One manual / belt-kit reading in model units. */
export interface ManualReading {
  time: number;
  temperature: number;
  relativeHumidity: number;
  windSpeed10: number;
  windDir10: number;
  dewPoint?: number;
  windGust10?: number;
  cloudCover?: number;
}

export interface ManualSeriesOptions {
  location: LatLon;
  /** Elevation of the reading site (m ASL) → sourceElevation. */
  sourceElevation?: number;
  /** Run window: stamps are held out to [from, to] (unix ms). */
  from: number;
  to: number;
  /** The user's cloud chip (%); default 0 with a note. */
  cloudCover?: number;
  droughtFactor?: number;
  kbdi?: number;
  kind?: Extract<WeatherSourceKind, 'manual' | 'belt-kit'>;
  source?: string;
  timezone?: string;
}

/**
 * Build a manual series from readings (§11.5): sorted, one stamp per reading, the first / last reading held out to
 * `from` / `to`. The series has no upper air (synthetic profile) and carries the manual drought inputs.
 */
export function manualSeriesFromReadings(readings: ManualReading[], o: ManualSeriesOptions): { series: WeatherSeries; warnings: string[] } {
  if (!readings.length) throw new RangeError('Manual weather: at least one reading is needed.');
  const warnings: string[] = [];
  const sorted = [...readings].sort((a, b) => a.time - b.time);
  const cloudDefault = o.cloudCover;
  if (cloudDefault === undefined && sorted.every((r) => r.cloudCover === undefined)) warnings.push(MESSAGES.manualNoCloud);
  const hours: WeatherHour[] = [];
  for (const r of sorted) {
    const h = toHour(r, cloudDefault ?? 0);
    if (hours.length && hours[hours.length - 1]!.time === h.time) hours[hours.length - 1] = h;
    else hours.push(h);
  }
  holdEnds(hours, o.from, o.to);
  const series: WeatherSeries = {
    kind: o.kind ?? 'manual',
    source: o.source ?? (o.kind === 'belt-kit' ? 'Belt weather kit readings' : 'Manual entry'),
    location: { ...o.location },
    timezone: o.timezone ?? SCENARIO_PARAMS.timezone,
    hours,
  };
  if (o.sourceElevation !== undefined) series.sourceElevation = o.sourceElevation;
  const d = manualDrought(o.droughtFactor, o.kbdi);
  series.droughtFactor = d.df;
  series.kbdi = d.kbdi;
  series.rainLast20 = new Array<number>(20).fill(0);
  warnings.push(...d.warnings);
  return { series, warnings };
}

function toHour(r: ManualReading, cloud: number): WeatherHour {
  const rh = clamp(r.relativeHumidity, 1, 100);
  const h: WeatherHour = {
    time: r.time,
    temperature: r.temperature,
    relativeHumidity: rh,
    dewPoint: r.dewPoint ?? dewPointC(r.temperature, rh),
    windSpeed10: Math.max(0, r.windSpeed10),
    windDir10: wrapDeg(r.windDir10),
    cloudCover: clamp(r.cloudCover ?? cloud, 0, 100),
    precipitation: 0,
  };
  if (r.windGust10 !== undefined) h.windGust10 = r.windGust10;
  return h;
}

/** Hold the first / last stamp out to `from` / `to` (copies at those times). */
function holdEnds(hours: WeatherHour[], from: number, to: number): void {
  const first = hours[0]!;
  if (Number.isFinite(from) && from < first.time) hours.unshift({ ...first, time: from });
  const last = hours[hours.length - 1]!;
  if (Number.isFinite(to) && to > last.time) hours.push({ ...last, time: to });
}

/**
 * Normalise a user-supplied manual / belt-kit series (e.g. from the UI's form): sorted and de-duplicated stamps,
 * dew point filled, RH clamped, cloud defaulted, ends held out to [from, to], site elevation and drought filled.
 */
export function normaliseManualSeries(
  input: WeatherSeries,
  o: { from: number; to: number; sourceElevation?: number; cloudCover?: number },
): { series: WeatherSeries; warnings: string[] } {
  if (!input.hours.length) throw new RangeError('Manual weather: the series has no readings.');
  const readings: ManualReading[] = input.hours.map((h) => {
    const r: ManualReading = { time: h.time, temperature: h.temperature, relativeHumidity: h.relativeHumidity, windSpeed10: h.windSpeed10, windDir10: h.windDir10 };
    if (h.dewPoint !== undefined) r.dewPoint = h.dewPoint;
    if (h.windGust10 !== undefined) r.windGust10 = h.windGust10;
    if (h.cloudCover !== undefined) r.cloudCover = h.cloudCover;
    return r;
  });
  const kind = input.kind === 'belt-kit' ? 'belt-kit' : 'manual';
  const opts: ManualSeriesOptions = { location: input.location, from: o.from, to: o.to, kind, source: input.source, timezone: input.timezone || SCENARIO_PARAMS.timezone };
  const elev = input.sourceElevation ?? o.sourceElevation;
  if (elev !== undefined) opts.sourceElevation = elev;
  if (o.cloudCover !== undefined) opts.cloudCover = o.cloudCover;
  if (input.droughtFactor !== undefined) opts.droughtFactor = input.droughtFactor;
  if (input.kbdi !== undefined) opts.kbdi = input.kbdi;
  const r = manualSeriesFromReadings(readings, opts);
  if (input.annualRainfall !== undefined) r.series.annualRainfall = input.annualRainfall;
  if (input.nightTemplate) r.series.nightTemplate = { ...input.nightTemplate };
  if (input.warnings?.length) r.warnings.unshift(...input.warnings);
  return r;
}

/** Belt-kit readings → a manual series (the belt-kit mode of §11.5). */
export function beltKitSeries(
  inputs: BeltKitInput[],
  o: Omit<ManualSeriesOptions, 'kind'>,
): { series: WeatherSeries; readings: BeltKitReading[]; warnings: string[] } {
  const readings = inputs.map(beltKitReading);
  const cloud = o.cloudCover ?? readings.find((r) => r.cloudCover !== undefined)?.cloudCover;
  const r = manualSeriesFromReadings(
    readings.map((b) => {
      const m: ManualReading = { time: b.time, temperature: b.temperature, relativeHumidity: b.relativeHumidity, dewPoint: b.dewPoint, windSpeed10: b.windSpeed10, windDir10: b.windDir10 };
      if (b.cloudCover !== undefined) m.cloudCover = b.cloudCover;
      return m;
    }),
    { ...o, ...(cloud !== undefined ? { cloudCover: cloud } : {}), kind: 'belt-kit', sourceElevation: o.sourceElevation ?? readings[0]!.elevation },
  );
  return { ...r, readings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Belt-kit readings in a forecast run
// ─────────────────────────────────────────────────────────────────────────────

/** Weight of a reading's offset at time t: 0 → 1 over [t_r − lead, t_r], then 1 → 0 over [t_r, t_r + 3 h]. */
export function beltOffsetWeight(t: number, tr: number): number {
  const P = SCENARIO_PARAMS;
  const lead = P.beltOffsetLeadH * H;
  const decay = P.beltOffsetDecayH * H;
  if (t <= tr) return lead > 0 ? clamp(1 - (tr - t) / lead, 0, 1) : t === tr ? 1 : 0;
  return clamp(1 - (t - tr) / decay, 0, 1);
}

/**
 * Lapse rate (K/km) that brings the forecast to the reading's elevation: the §5.2 / D43 rate the moisture model uses
 * (6.5 K/km, rising to 9.8 K/km by day when the mixed layer spans the relief) when `relief` is known, else the
 * standard 6.5 K/km. Using the same Γ as fuel/moisture makes the adjusted run reproduce the reading at its elevation.
 */
export function beltLapseRate(series: WeatherSeries, fc: WeatherHour, t: number, relief?: number): number {
  if (relief === undefined || !Number.isFinite(relief)) return SCENARIO_PARAMS.lapseTKPerKm;
  const sun = solarPosition(t, series.location.lat, series.location.lon);
  return lapseRate(sun.elevation, relief, fc.boundaryLayerHeight);
}

/**
 * Apply belt-kit readings to a forecast series (§11.5): per reading, the T and T_d offset against the lapse-corrected
 * forecast at the reading's elevation (Γ of D43 when `ctx.relief` is given, T_d 1.8 K/km as §5.2), blended in by
 * {@link beltOffsetWeight} (stamps are inserted at t_r − lead, t_r and t_r + 3 h with {@link insertStamp}, which keeps
 * the rain totals and the clearness stamping, so the shape is represented exactly), and a WindEdit of radius 1 km at
 * the reading location. Returns a new series (the input is not modified).
 */
export function applyBeltKitToForecast(
  series: WeatherSeries,
  readings: BeltKitReading[],
  ctx: { origin: LatLon; t0: number; siteElevation: number; relief?: number },
): { series: WeatherSeries; edits: WindEdit[]; warnings: string[] } {
  const P = SCENARIO_PARAMS;
  let hours = series.hours.map((h) => ({ ...h }));
  const edits: WindEdit[] = [];
  const warnings: string[] = [];
  const proj = new LocalProjection(ctx.origin);
  const zSrc = series.sourceElevation ?? ctx.siteElevation;
  readings.forEach((r, idx) => {
    const zr = r.elevation ?? ctx.siteElevation;
    const fc = weatherAt({ ...series, hours }, r.time);
    const dz = (zr - zSrc) / 1000;
    const tFc = fc.temperature - beltLapseRate(series, fc, r.time, ctx.relief) * dz;
    const tdFc = (fc.dewPoint ?? dewPointC(fc.temperature, fc.relativeHumidity)) - P.lapseTdKPerKm * dz;
    const dT = r.temperature - tFc;
    const dTd = r.dewPoint - tdFc;
    // Insert the shape stamps (sorted insertion; rain and clearness semantics preserved).
    for (const t of [r.time - P.beltOffsetLeadH * H, r.time, r.time + P.beltOffsetDecayH * H]) {
      if (hours.some((h) => h.time === t)) continue;
      const ins = insertStamp({ ...series, hours }, t);
      if (ins.nextPrecipitation !== undefined) hours[ins.nextIndex] = { ...hours[ins.nextIndex]!, precipitation: ins.nextPrecipitation };
      hours.splice(ins.nextIndex, 0, ins.hour);
    }
    hours = hours.map((h) => {
      const w = beltOffsetWeight(h.time, r.time);
      if (w <= 0) return h;
      const T = h.temperature + dT * w;
      const td = Math.min(T, (h.dewPoint ?? dewPointC(h.temperature, h.relativeHumidity)) + dTd * w);
      return { ...h, temperature: T, dewPoint: td, relativeHumidity: rhFromTd(T, td) };
    });
    warnings.push(MESSAGES.forecastBeltOffset(dT, dTd));
    const [x, y] = r.location ? proj.toLocal(r.location) : [0, 0];
    edits.push({
      kind: 'wind',
      id: `belt-kit-${idx + 1}`,
      x,
      y,
      radius: P.beltWindEditRadiusM,
      speed: r.windSpeed10,
      dir: r.windDir10,
      time: Math.max(0, (r.time - ctx.t0) / 1000),
    });
  });
  return { series: { ...series, hours }, edits, warnings };
}
