/**
 * Test-only reader of the bundled Open-Meteo fixtures (tests/fixtures/live/*.json) into a WeatherSeries. A minimal
 * local stand-in for scenario/'s parser (spec §11.2), so the explain tests do not depend on that module: times are
 * the response's local ISO stamps shifted by `utc_offset_seconds`; pressure levels are read when present.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PressureLevelData, WeatherHour, WeatherSeries } from '../../core/types';

interface OpenMeteoJson {
  latitude: number;
  longitude: number;
  elevation: number;
  utc_offset_seconds: number;
  timezone: string;
  hourly: Record<string, (number | null)[]> & { time: string[] };
}

const LEVELS = [925, 850, 700, 500] as const;

export function readOpenMeteoFixture(name: string, upperAirSource?: WeatherSeries['upperAirSource']): WeatherSeries {
  const path = join(process.cwd(), 'tests', 'fixtures', 'live', name);
  const d = JSON.parse(readFileSync(path, 'utf8')) as OpenMeteoJson;
  const h = d.hourly;
  const num = (key: string, i: number): number | undefined => {
    const v = h[key]?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const hours: WeatherHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const t = Date.parse(`${h.time[i]}:00Z`) - d.utc_offset_seconds * 1000;
    const levels: PressureLevelData[] = [];
    for (const p of LEVELS) {
      const T = num(`temperature_${p}hPa`, i);
      const rh = num(`relative_humidity_${p}hPa`, i);
      const ws = num(`wind_speed_${p}hPa`, i);
      const wd = num(`wind_direction_${p}hPa`, i);
      const z = num(`geopotential_height_${p}hPa`, i);
      if (T === undefined || rh === undefined || ws === undefined || wd === undefined || z === undefined) continue;
      levels.push({ hPa: p, height: z, temperature: T, relativeHumidity: rh, windSpeed: ws, windDir: wd });
    }
    const w: WeatherHour = {
      time: t,
      temperature: num('temperature_2m', i) ?? NaN,
      relativeHumidity: num('relative_humidity_2m', i) ?? NaN,
      windSpeed10: num('wind_speed_10m', i) ?? 0,
      windDir10: num('wind_direction_10m', i) ?? 0,
      cloudCover: num('cloud_cover', i) ?? 0,
      precipitation: num('precipitation', i) ?? 0,
    };
    const dp = num('dew_point_2m', i);
    if (dp !== undefined) w.dewPoint = dp;
    if (levels.length) w.pressureLevels = levels;
    if (Number.isFinite(w.temperature) && Number.isFinite(w.relativeHumidity)) hours.push(w);
  }
  const s: WeatherSeries = {
    kind: 'fixture',
    source: `Open-Meteo fixture ${name}`,
    location: { lat: d.latitude, lon: d.longitude },
    sourceElevation: d.elevation,
    timezone: d.timezone || 'Australia/Sydney',
    hours,
  };
  const src = upperAirSource ?? (hours.some((x) => x.pressureLevels) ? 'model' : undefined);
  if (src) s.upperAirSource = src;
  return s;
}
