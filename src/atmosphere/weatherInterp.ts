/**
 * Linear interpolation of two weather stamps (spec §8.3 extra 10-min stamps; §11.2 `weatherAt` rules: scalars
 * linear, winds as u/v vectors). Local to atmosphere/ so the module does not depend on scenario/.
 */
import type { PressureLevelData, WeatherHour, WindAtHeight } from '../core/types';
import { lerp, uvToWind, windToUV } from '../core/units';

function lerpOpt(a: number | undefined, b: number | undefined, f: number): number | undefined {
  if (a === undefined || !Number.isFinite(a)) return b;
  if (b === undefined || !Number.isFinite(b)) return a;
  return lerp(a, b, f);
}

function lerpWind(sa: number, da: number, sb: number, db: number, f: number): [number, number] {
  const [ua, va] = windToUV(sa, da);
  const [ub, vb] = windToUV(sb, db);
  return uvToWind(lerp(ua, ub, f), lerp(va, vb, f));
}

/** Weather at fraction f ∈ [0, 1] between stamps a and b. */
export function interpolateHour(a: WeatherHour, b: WeatherHour, f: number): WeatherHour {
  const [s10, d10] = lerpWind(a.windSpeed10, a.windDir10, b.windSpeed10, b.windDir10, f);
  const out: WeatherHour = {
    time: Math.round(lerp(a.time, b.time, f)),
    temperature: lerp(a.temperature, b.temperature, f),
    relativeHumidity: lerp(a.relativeHumidity, b.relativeHumidity, f),
    windSpeed10: s10,
    windDir10: d10,
  };
  const opt = ['dewPoint', 'windGust10', 'cloudCover', 'shortwaveRadiation', 'boundaryLayerHeight', 'cape', 'surfacePressure', 'clearness'] as const;
  for (const key of opt) {
    const v = lerpOpt(a[key], b[key], f);
    if (v !== undefined) out[key] = v;
  }
  if (a.windProfile && b.windProfile) {
    const prof: WindAtHeight[] = [];
    for (const pa of a.windProfile) {
      const pb = b.windProfile.find((q) => q.heightAGL === pa.heightAGL);
      if (!pb) continue;
      const [s, d] = lerpWind(pa.speed, pa.dir, pb.speed, pb.dir, f);
      prof.push({ heightAGL: pa.heightAGL, speed: s, dir: d });
    }
    if (prof.length) out.windProfile = prof;
  } else if (a.windProfile || b.windProfile) out.windProfile = (f < 0.5 ? a.windProfile : b.windProfile) ?? [];
  if (a.pressureLevels && b.pressureLevels) {
    const lv: PressureLevelData[] = [];
    for (const la of a.pressureLevels) {
      const lb = b.pressureLevels.find((q) => q.hPa === la.hPa);
      if (!lb) continue;
      const [s, d] = lerpWind(la.windSpeed, la.windDir, lb.windSpeed, lb.windDir, f);
      const l: PressureLevelData = {
        hPa: la.hPa,
        height: lerp(la.height, lb.height, f),
        temperature: lerp(la.temperature, lb.temperature, f),
        relativeHumidity: lerp(la.relativeHumidity, lb.relativeHumidity, f),
        windSpeed: s,
        windDir: d,
      };
      const td = lerpOpt(la.dewPoint, lb.dewPoint, f);
      if (td !== undefined) l.dewPoint = td;
      lv.push(l);
    }
    if (lv.length) out.pressureLevels = lv;
  } else if (a.pressureLevels || b.pressureLevels) out.pressureLevels = (f < 0.5 ? a.pressureLevels : b.pressureLevels) ?? [];
  return out;
}
