/**
 * Test-only helpers for the moisture module (not imported by application code): uniform fuel maps, diurnal preset
 * series (spec §11.3 shape), and a minimal sim/-style driver of `MoistureModel.update` (spec §12.2 step 3).
 */
import type { FuelMap, FuelType, Terrain, WeatherHour, WeatherSeries } from '../../core/types';
import type { MoistureContext, StableNightState } from '../../core/simTypes';
import { lmstHour } from '../../core/physics';
import { insolation, solarPosition } from '../../terrain';
import type { MoistureModel } from './model';
import { integrateStableNight } from './night';
import { seriesWeatherAt } from './weather';

const H = 3.6e6;

/** Unix ms of a local-mean-solar-time clock reading. */
export const lmstMs = (y: number, month1: number, d: number, hour: number, lon = 150.3): number => Date.UTC(y, month1 - 1, d) - (lon / 15) * H + hour * H;

/** A FuelMap of one fuel type with optional canopy cover (mandatory arrays only, plus optional extras). */
export function uniformFuel(terrain: Terrain, type: FuelType | ((k: number) => FuelType), cover?: number | ((k: number) => number)): FuelMap {
  const n = terrain.elevation.length;
  const f = (): Float32Array => new Float32Array(n);
  const fuel: FuelMap = {
    grid: terrain.grid,
    type: new Uint8Array(n),
    surfaceHazard: f(),
    nearSurfaceHazard: f(),
    nearSurfaceHeight: f(),
    elevatedHazard: f(),
    elevatedHeight: f(),
    barkHazard: f(),
    surfaceLoad: f(),
    nearSurfaceLoad: f(),
    elevatedLoad: f(),
    barkLoad: f(),
    canopyHeight: f(),
    canopyCover: f().fill(NaN),
    curing: f(),
    timeSinceFire: f().fill(NaN),
    lastFireKind: new Uint8Array(n),
    sources: ['test'],
    moistureOffset: f(),
  };
  for (let k = 0; k < n; k++) {
    fuel.type[k] = typeof type === 'function' ? type(k) : type;
    if (cover !== undefined) fuel.canopyCover[k] = typeof cover === 'function' ? cover(k) : cover;
  }
  return fuel;
}

export interface PresetShape {
  tMin: number;
  tMax: number;
  td: number;
  uDay: number;
  uNight: number;
  cloud: number;
  dir: number;
  /** Rain (mm) by stamp time (the hour ending at that stamp). */
  rain?: (t: number) => number;
  /** Override RH (%) instead of the constant dew point. */
  rh?: number;
}

/** Hourly diurnal preset series (spec §11.3: D(h) shape by LMST hour, T_d constant, wind U_n → U_d). */
export function diurnalSeries(startMs: number, hours: number, o: PresetShape, loc = { lat: -33.715, lon: 150.3 }, sourceElevation?: number, nightTemplate?: { dThetaMax: number; hInv: number }): WeatherSeries {
  const hs: WeatherHour[] = [];
  for (let i = 0; i <= hours; i++) {
    const t = startMs + i * H;
    const h = lmstHour(t, loc.lon);
    const D = h >= 6 && h <= 15 ? 0.5 - 0.5 * Math.cos((Math.PI * (h - 6)) / 9) : 0.5 + 0.5 * Math.cos((Math.PI * ((((h - 15) % 24) + 24) % 24)) / 15);
    const T = o.tMin + (o.tMax - o.tMin) * D;
    const es = (x: number): number => 6.112 * Math.exp((17.67 * x) / (x + 243.5));
    const rh = o.rh ?? Math.min(100, (100 * es(o.td)) / es(T));
    const td = o.rh !== undefined ? undefined : o.td;
    hs.push({
      time: t,
      temperature: T,
      relativeHumidity: rh,
      dewPoint: td,
      windSpeed10: o.uNight + (o.uDay - o.uNight) * D,
      windDir10: o.dir,
      cloudCover: o.cloud,
      precipitation: o.rain ? o.rain(t) : 0,
    });
  }
  return { kind: 'preset', source: 'test', location: loc, timezone: 'Australia/Sydney', hours: hs, sourceElevation, nightTemplate };
}

/**
 * Drive `model.update` every `dtS` from `from` to `to` like sim/ (§12.2 step 3): weatherAt, stable-night state,
 * insolation (clear sky × cloud), MoistureContext. `night` is advanced in place. Calls `onStep` after each update.
 */
export function runModel(
  model: MoistureModel,
  terrain: Terrain,
  series: WeatherSeries,
  night: StableNightState,
  from: number,
  to: number,
  drought: { kbdi: number; df: number },
  dtS = 600,
  onStep?: (t: number) => void,
  burnt?: Uint8Array,
): void {
  if (!(dtS > 0)) throw new Error('runModel: dtS must be > 0');
  const n = terrain.elevation.length;
  const u10 = new Float32Array(n);
  const noBurn = burnt ?? new Uint8Array(n);
  const { lat, lon } = series.location;
  for (let t = from + dtS * 1000; t <= to + 1; t += dtS * 1000) {
    integrateStableNight(night, series, t - dtS * 1000, t, Math.min(600, dtS));
    const w = seriesWeatherAt(series, t);
    u10.fill(w.windSpeed10);
    const sunPos = solarPosition(t, lat, lon);
    const sun = insolation(terrain, t, { cloudCover: w.cloudCover, location: { lat, lon } });
    const ctx: MoistureContext = {
      time: t,
      lmstHour: lmstHour(t, lon),
      month: new Date(t + (lon / 15) * H).getUTCMonth() + 1,
      sunElevation: sunPos.elevation,
      cloudFrac: (w.cloudCover ?? 0) / 100,
      u10,
      burnt: noBurn,
      kbdi: drought.kbdi,
      df: drought.df,
      night,
    };
    model.update(w, sun, dtS, ctx);
    onStep?.(t);
  }
}

/** Mean of `a` over the cells where `sel(k)` holds (NaN if none). */
export function meanWhere(a: ArrayLike<number>, sel: (k: number) => boolean): { mean: number; n: number } {
  let s = 0;
  let n = 0;
  for (let k = 0; k < a.length; k++) {
    if (!sel(k)) continue;
    s += a[k]!;
    n++;
  }
  return { mean: n ? s / n : NaN, n };
}

/** Minimal Open-Meteo hourly → WeatherSeries adapter for fixtures (test double of scenario/'s §11.2 parser). */
export function parseOpenMeteoHourly(json: unknown, kind: WeatherSeries['kind'] = 'fixture'): WeatherSeries {
  const j = json as {
    latitude: number;
    longitude: number;
    elevation: number;
    utc_offset_seconds: number;
    hourly: Record<string, (number | null)[]> & { time: string[] };
  };
  const h = j.hourly;
  const val = (name: string, i: number): number | undefined => {
    const v = h[name]?.[i];
    return v === null || v === undefined ? undefined : v;
  };
  const hours: WeatherHour[] = h.time.map((ts, i) => ({
    time: Date.parse(`${ts}:00Z`) - j.utc_offset_seconds * 1000,
    temperature: val('temperature_2m', i)!,
    relativeHumidity: val('relative_humidity_2m', i)!,
    dewPoint: val('dew_point_2m', i),
    windSpeed10: val('wind_speed_10m', i)!,
    windDir10: val('wind_direction_10m', i)!,
    cloudCover: val('cloud_cover', i),
    precipitation: val('precipitation', i) ?? 0,
    shortwaveRadiation: val('shortwave_radiation', i),
    boundaryLayerHeight: val('boundary_layer_height', i),
    surfacePressure: val('surface_pressure', i),
  }));
  return { kind, source: 'fixture', location: { lat: j.latitude, lon: j.longitude }, timezone: 'Australia/Sydney', hours, sourceElevation: j.elevation };
}
