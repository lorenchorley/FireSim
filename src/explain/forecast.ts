/**
 * Forecast analysis of the weather series (spec §10.3): wind changes (circular-mean windows, merged < 2 h apart),
 * the afternoon peak (hour of minimum AFDRS forest M_A, LMST from lonDeg), deep drought, pyroconvection risk from
 * the pressure levels (C-Haines [V Mills & McCaw 2010] with the hourly FFDI), the S13 hot-dry-windy variant, the
 * morning inversion break for night starts (the §5.2a t_break, run with core/physics `stableNight`), and the P1
 * foehn / mountain-wave notes from the profile.
 *
 * Pure functions of the series (plus a small terrain summary for the mountain-wave note); the engine caches the
 * analysis per series object.
 */
import { dewPointC, initialStableNight, lmstHour, localDate, stableNight, theta as potentialTemperature, G } from '../core/physics';
import type { Insight, InsightKind, InsightSeverity, PressureLevelData, WeatherHour, WeatherSeries } from '../core/types';
import { angleDiffDeg, windToUV, wrapDeg } from '../core/units';
import { solarPosition, sunTimes } from '../terrain';
import { afdrsMoisture, ffdi } from './deps';
import { EXPLAIN_PARAMS } from './params';
import { CARD_TEXT, clock, type Candidate } from './text';
import { angDist } from './util';

const P = EXPLAIN_PARAMS;
const H = 3.6e6;

export interface WindChange {
  /** unix ms of the change (first sample closer to the post-change direction). */
  time: number;
  /** Stamp hour of maximum |Δdir| (unix ms). */
  hour: number;
  fromDir: number;
  toDir: number;
  /** |Δdir| (deg). */
  shift: number;
  preSpeed: number;
  /** m/s */
  postSpeed: number;
}

export interface AfternoonPeak {
  date: string;
  /** unix ms of the hour of minimum forest M_A. */
  time: number;
  ma: number;
  lmst: number;
}

export interface CHainesResult {
  ch: number;
  ca: number;
  cb: number;
  /** True when 850 hPa is below the grid-point surface and the 2 m values were used (spec §8.10). */
  surfaceSubstituted: boolean;
}

/** Circular-mean direction (unit vectors) and mean speed of the samples with time in [t0, t1]. */
export function windowWind(hours: readonly WeatherHour[], t0: number, t1: number): { dir: number; speed: number; n: number } {
  let sx = 0;
  let sy = 0;
  let sp = 0;
  let n = 0;
  for (const h of hours) {
    if (h.time < t0 || h.time > t1) continue;
    const r = (h.windDir10 * Math.PI) / 180;
    sx += Math.sin(r);
    sy += Math.cos(r);
    sp += h.windSpeed10;
    n++;
  }
  if (n === 0) return { dir: NaN, speed: NaN, n: 0 };
  const dir = sx * sx + sy * sy > 1e-9 * n * n ? wrapDeg((Math.atan2(sx, sy) * 180) / Math.PI) : NaN;
  return { dir, speed: sp / n, n };
}

/**
 * Wind changes in [startMs, endMs] (spec §10.3): for each stamp hour h, the circular-mean direction and mean speed
 * over [h − 1 h, h] vs [h + 1 h, h + 2 h]; a change at the hour of maximum |Δdir| when Δdir ≥ 45° and the post-change
 * U10 ≥ 15 km/h; changes < 2 h apart are merged (the larger shift wins). The change time is refined to the first
 * sample in [h − 1 h, h + 2 h] whose direction is closer to the post-change direction (a documented refinement: a
 * sharp change at t_c gives equal |Δdir| at h = t_c − 1 h and t_c).
 */
export function detectWindChanges(series: WeatherSeries, startMs: number, endMs: number): WindChange[] {
  const W = P.windChange;
  const hours = series.hours;
  type Raw = { h: number; shift: number; pre: ReturnType<typeof windowWind>; post: ReturnType<typeof windowWind> };
  const raw: Raw[] = [];
  for (const hr of hours) {
    const h = hr.time;
    if (h < startMs || h > endMs) continue;
    const pre = windowWind(hours, h - H, h);
    const post = windowWind(hours, h + H, h + 2 * H);
    if (!(pre.n > 0 && post.n > 0) || !Number.isFinite(pre.dir) || !Number.isFinite(post.dir)) continue;
    const shift = angDist(post.dir, pre.dir);
    if (shift >= W.minShiftDeg && post.speed * 3.6 >= W.minPostKmh) raw.push({ h, shift, pre, post });
  }
  // Merge runs closer than 2 h: keep the maximum shift; on a plateau of equal maxima take its middle.
  const out: WindChange[] = [];
  let a = 0;
  while (a < raw.length) {
    let b = a;
    while (b + 1 < raw.length && raw[b + 1]!.h - raw[b]!.h < W.mergeS * 1000) b++;
    let best = a;
    for (let c = a; c <= b; c++) if (raw[c]!.shift > raw[best]!.shift + 1e-6) best = c;
    let last = best;
    while (last + 1 <= b && Math.abs(raw[last + 1]!.shift - raw[best]!.shift) < 1e-6) last++;
    const pick = raw[(best + last) >> 1]!;
    // Refine the time.
    let tc = pick.h;
    for (const hr of hours) {
      if (hr.time < pick.h - H || hr.time > pick.h + 2 * H) continue;
      if (angDist(hr.windDir10, pick.post.dir) < angDist(hr.windDir10, pick.pre.dir)) {
        tc = hr.time;
        break;
      }
    }
    out.push({ time: tc, hour: pick.h, fromDir: pick.pre.dir, toDir: pick.post.dir, shift: pick.shift, preSpeed: pick.pre.speed, postSpeed: pick.post.speed });
    a = b + 1;
  }
  return out;
}

/** Local calendar month 1–12 (spec §0.2 localDate). */
const localMonth = (ms: number): number => Number(localDate(ms).slice(5, 7));

/** AFDRS dry-forest M_A at the grid point for one hour (spec §5.3). */
export function forestMa(h: WeatherHour, lonDeg: number): number {
  return afdrsMoisture('forest', h.temperature, h.relativeHumidity, lmstHour(h.time, lonDeg), localMonth(h.time), (h.cloudCover ?? 0) / 100, 0, 999);
}

/** Per local day in [startMs, endMs]: the hour (10–19 LMST) of minimum AFDRS forest M_A (spec §10.3). */
export function afternoonPeaks(series: WeatherSeries, startMs: number, endMs: number, lonDeg: number): AfternoonPeak[] {
  const A = P.afternoon;
  const byDay = new Map<string, AfternoonPeak>();
  for (const h of series.hours) {
    if (h.time < startMs - 12 * H || h.time > endMs + 12 * H) continue;
    const l = lmstHour(h.time, lonDeg);
    if (l < A.searchStart || l > A.searchEnd) continue;
    const ma = forestMa(h, lonDeg);
    const date = localDate(h.time);
    const cur = byDay.get(date);
    if (!cur || ma < cur.ma - 1e-9) byDay.set(date, { date, time: h.time, ma, lmst: l });
  }
  return [...byDay.values()].sort((a, b) => a.time - b.time);
}

/** Level of the given pressure (hPa) or undefined. */
const level = (h: WeatherHour, hPa: number): PressureLevelData | undefined => h.pressureLevels?.find((p) => p.hPa === hPa);

/**
 * Continuous Haines index [V Mills & McCaw 2010] (spec §8.10): CA = 0.5(T850 − T700) − 2;
 * CB = min(30, T850 − Td850)/3 − 1, if CB > 5 then CB = 5 + (CB − 5)/2; CH = CA + CB. When 850 hPa is below the
 * surface (`surfaceElevation`), the 2 m values replace the 850 hPa ones and the result is flagged. Null without levels.
 */
export function cHaines(h: WeatherHour, surfaceElevation?: number): CHainesResult | null {
  const l850 = level(h, 850);
  const l700 = level(h, 700);
  if (!l850 || !l700) return null;
  let t850 = l850.temperature;
  let td850 = l850.dewPoint ?? dewPointC(l850.temperature, l850.relativeHumidity);
  let sub = false;
  if (surfaceElevation !== undefined && Number.isFinite(l850.height) && l850.height < surfaceElevation) {
    t850 = h.temperature;
    td850 = h.dewPoint ?? dewPointC(h.temperature, h.relativeHumidity);
    sub = true;
  }
  const ca = 0.5 * (t850 - l700.temperature) - 2;
  let cb = Math.min(30, t850 - td850) / 3 - 1;
  if (cb > 5) cb = 5 + (cb - 5) / 2;
  return { ch: ca + cb, ca, cb, surfaceSubstituted: sub };
}

/** Rain (mm) in the 24 h ending at ms. */
export function rain24(series: WeatherSeries, ms: number): number {
  let r = 0;
  for (const h of series.hours) if (h.time > ms - 24 * H && h.time <= ms) r += h.precipitation ?? 0;
  return r;
}

/** Linear-in-time weather at ms (vector-mean wind), from the bracketing stamps; null for an empty series. */
export function weatherAtMs(series: WeatherSeries, ms: number): WeatherHour | null {
  const hs = series.hours;
  if (hs.length === 0) return null;
  if (ms <= hs[0]!.time) return hs[0]!;
  if (ms >= hs[hs.length - 1]!.time) return hs[hs.length - 1]!;
  let lo = 0;
  let hi = hs.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (hs[m]!.time <= ms) lo = m;
    else hi = m;
  }
  const a = hs[lo]!;
  const b = hs[hi]!;
  const w = (ms - a.time) / (b.time - a.time || 1);
  const [ua, va] = windToUV(a.windSpeed10, a.windDir10);
  const [ub, vb] = windToUV(b.windSpeed10, b.windDir10);
  const u = ua + (ub - ua) * w;
  const v = va + (vb - va) * w;
  const sp = Math.hypot(u, v);
  const dir = sp > 1e-9 ? wrapDeg((Math.atan2(-u, -v) * 180) / Math.PI) : a.windDir10;
  return {
    time: ms,
    temperature: a.temperature + (b.temperature - a.temperature) * w,
    relativeHumidity: a.relativeHumidity + (b.relativeHumidity - a.relativeHumidity) * w,
    windSpeed10: sp,
    windDir10: dir,
    cloudCover: (a.cloudCover ?? 0) + ((b.cloudCover ?? 0) - (a.cloudCover ?? 0)) * w,
    precipitation: b.precipitation ?? 0,
    ...(a.pressureLevels ? { pressureLevels: w < 0.5 ? a.pressureLevels : (b.pressureLevels ?? a.pressureLevels) } : {}),
  };
}

export interface InversionForecast {
  /** unix ms of the sunrise and the predicted break. */
  sunrise: number;
  tBreak: number;
  dThetaAtSunrise: number;
  wet: boolean;
}

/**
 * Morning inversion expectation (spec §10.3, §5.2a): integrate `stableNight` over the series from startMs − 24 h in
 * ≤ 30 min steps until the first sunrise after startMs; returns the cold-pool strength at sunrise and t_break.
 */
export function predictInversion(series: WeatherSeries, startMs: number, lat: number, lon: number): InversionForecast | null {
  const s = initialStableNight(series.nightTemplate ?? null);
  const step = 30 * 60 * 1000;
  let prevSunrise: number | null = null;
  for (let t = startMs - 24 * H; t <= startMs + 30 * H; t += step) {
    const w = weatherAtMs(series, t);
    if (!w) return null;
    const sun = solarPosition(t, lat, lon).elevation;
    const st = sunTimes(t, lat, lon);
    const hss = Number.isFinite(st.sunrise) ? (t - st.sunrise) / H : 0;
    stableNight(s, { time: t, sunElevation: sun, hoursSinceSunrise: hss, u10: w.windSpeed10, cloudPct: w.cloudCover ?? 0, rain24: rain24(series, t) }, step / 1000);
    if (s.tSunrise !== null && s.tSunrise !== prevSunrise) {
      prevSunrise = s.tSunrise;
      if (s.tSunrise >= startMs - 2 * H && s.tBreak !== null) {
        return { sunrise: s.tSunrise, tBreak: s.tBreak, dThetaAtSunrise: s.dThetaAtSunrise, wet: rain24(series, s.tSunrise) >= P.inversion.wetRain24Mm };
      }
    }
  }
  return null;
}

/** Foehn test on one hour (spec §10.2 general/foehn): 850 or 700 hPa wind from 250–320° at ≥ 15 m/s. */
export function foehnAloft(h: WeatherHour): { dir: number; speed: number } | null {
  const Gp = P.general;
  for (const hp of [850, 700]) {
    const l = level(h, hp);
    if (!l) continue;
    const d = wrapDeg(l.windDir);
    if (d >= Gp.foehnDirFrom && d <= Gp.foehnDirTo && l.windSpeed >= Gp.foehnMinMs) return { dir: d, speed: l.windSpeed };
  }
  return null;
}

/**
 * Hill Froude number Fr_h = U/(N·H) from the 850/700 hPa levels and the relief H (spec §8.10 frH), or NaN.
 * N² = (g/θ̄)·Δθ/Δz between the two levels; U = mean level wind.
 */
export function froudeFromLevels(h: WeatherHour, relief: number): number {
  const a = level(h, 850);
  const b = level(h, 700);
  if (!a || !b || !(relief > 0)) return NaN;
  const t1 = potentialTemperature(a.temperature, 850);
  const t2 = potentialTemperature(b.temperature, 700);
  const dz = b.height - a.height;
  if (!(dz > 0)) return NaN;
  const n2 = (G / (0.5 * (t1 + t2))) * ((t2 - t1) / dz);
  if (!(n2 > 0)) return Infinity;
  return (0.5 * (a.windSpeed + b.windSpeed)) / (Math.sqrt(n2) * relief);
}

/** Terrain summary the engine passes for the mountain-wave forecast note. */
export interface ForecastTerrain {
  x: number;
  y: number;
  relief: number;
  leeOfDivide: boolean;
  /** Share of ridges facing a wind from `windFrom` and whether lee slopes are steeper than windward ones. */
  ridgeGeometry?: (windFromDeg: number) => { cross: number; leeSteeper: boolean };
}

export interface ForecastAnalysis {
  changes: WindChange[];
  peaks: AfternoonPeak[];
}

/** Changes and peaks over [start − 3 h, start + duration + 3 h] (cached by the engine per series). */
export function analyseSeries(series: WeatherSeries, startMs: number, durationS: number, lonDeg: number): ForecastAnalysis {
  const end = startMs + (durationS + P.forecast.extraHours * 3600) * 1000;
  return { changes: detectWindChanges(series, startMs - 3 * H, end), peaks: afternoonPeaks(series, startMs, end, lonDeg) };
}

function mk(kind: InsightKind, key: string, severity: InsightSeverity, values: Candidate['values'], timeS: number, ft: ForecastTerrain): Insight {
  const c: Candidate = { key, x: ft.x, y: ft.y, score: 1, severity, values };
  const t = CARD_TEXT[kind](c);
  return { id: '', kind, severity, time: Math.max(0, timeS), x: ft.x, y: ft.y, key, ...t };
}

/**
 * Forecast insights (spec §10.3) over [start, start + duration + 3 h]. `timeS` of each insight is the event time in
 * seconds after the scenario start (≥ 0), so the UI can place it on the timeline.
 */
export function buildForecastInsights(
  series: WeatherSeries,
  start: number,
  duration: number,
  lonDeg: number,
  ft: ForecastTerrain,
  analysis: ForecastAnalysis = analyseSeries(series, start, duration, lonDeg),
  opts: { afdrsFbi?: (w: WeatherHour) => number } = {},
): Insight[] {
  const out: Insight[] = [];
  const end = start + (duration + P.forecast.extraHours * 3600) * 1000;
  const tz = series.timezone || 'Australia/Sydney';
  const rel = (ms: number): number => (ms - start) / 1000;
  const lat = series.location.lat;
  const inWindow = (h: WeatherHour): boolean => h.time >= start && h.time <= end;

  // Wind changes.
  for (const c of analysis.changes) {
    if (c.time < start || c.time > end) continue;
    out.push(
      mk('wind-change', 'wind-change:domain', 'danger', { fromDir: c.fromDir, toDir: c.toDir, shift: c.shift, postSpeed: c.postSpeed, clock: clock(c.time, tz), inS: rel(c.time) }, rel(c.time), ft),
    );
  }
  // Afternoon peaks.
  for (const p of analysis.peaks) {
    if (p.time < start || p.time > end) continue;
    out.push(mk('afternoon-peak', 'afternoon-peak:domain', 'info', { ma: p.ma, clock: clock(p.time, tz), lmst: p.lmst }, rel(p.time), ft));
  }
  // High drought.
  const df = series.droughtFactor;
  const kbdi = series.kbdi;
  if ((df !== undefined && df >= P.drought.df) || (kbdi !== undefined && kbdi >= P.drought.kbdi)) {
    out.push(mk('high-drought', 'high-drought:domain', 'watch', { df: df ?? NaN, kbdi: kbdi ?? NaN }, 0, ft));
  }
  // Pyroconvection risk and S13, from the hourly records.
  const dfF = df ?? P.forecast.defaultDf;
  const upper = series.upperAirSource;
  let best: { sev: InsightSeverity; ch: number; ffdi: number; t: number } | null = null;
  let maxFfdi = 0;
  let maxFfdiT = start;
  let s13: WeatherHour | null = null;
  let s13Fbi = NaN;
  const A = P.afternoon;
  for (const h of series.hours) {
    if (!inWindow(h)) continue;
    const u10 = h.windSpeed10 * 3.6;
    const F = ffdi(h.temperature, h.relativeHumidity, u10, dfF);
    if (F > maxFfdi) {
      maxFfdi = F;
      maxFfdiT = h.time;
    }
    if (upper === 'model' || upper === 'preset') {
      const c = cHaines(h, series.sourceElevation);
      if (c) {
        const Pp = P.pyro;
        const sev: InsightSeverity | null = c.ch >= Pp.dangerCH && F >= Pp.dangerFfdi ? 'danger' : c.ch >= Pp.watchCH && F >= Pp.watchFfdi ? 'watch' : null;
        if (sev && (!best || (sev === 'danger' && best.sev !== 'danger') || (sev === best.sev && c.ch * F > best.ch * best.ffdi))) best = { sev, ch: c.ch, ffdi: F, t: h.time };
      }
    }
    if (!s13) {
      const d = wrapDeg(h.windDir10);
      const fbi = opts.afdrsFbi ? opts.afdrsFbi(h) : NaN;
      const weatherHot = d >= A.s13DirFrom && d <= A.s13DirTo && u10 >= A.s13MinKmh && h.relativeHumidity <= A.s13MaxRh && h.temperature >= A.s13MinT;
      if (weatherHot || fbi >= A.s13Fbi) {
        s13 = h;
        s13Fbi = fbi;
      }
    }
  }
  if (best) {
    out.push(mk('pyroconvection-risk', 'pyroconvection-risk:domain', best.sev, { cHaines: best.ch, ffdi: best.ffdi }, rel(best.t), ft));
  } else if (upper !== 'model' && upper !== 'preset' && maxFfdi >= P.pyro.watchFfdi) {
    out.push(mk('pyroconvection-risk', 'pyroconvection-risk:domain', 'info', { variant: 'synthetic', ffdi: maxFfdi }, rel(maxFfdiT), ft));
  }
  if (s13) {
    out.push(
      mk('afternoon-peak', 'afternoon-peak:domain', 'watch', { variant: 'S13', dir: s13.windDir10, u10: s13.windSpeed10, t: s13.temperature, rh: s13.relativeHumidity, fbi: s13Fbi }, rel(s13.time), ft),
    );
  }
  // Morning inversion for night starts.
  const lon = lonDeg;
  const sunNow = solarPosition(start, lat, lon).elevation;
  const inv = predictInversion(series, start, lat, lon);
  if (inv && inv.dThetaAtSunrise >= P.inversion.minDTheta && inv.tBreak >= start && inv.tBreak <= end && (sunNow < 0 || start < inv.tBreak)) {
    out.push(mk('inversion-break', 'inversion-break:domain', 'watch', { dTheta: inv.dThetaAtSunrise, clock: clock(inv.tBreak, tz), wet: inv.wet ? 1 : 0 }, rel(inv.tBreak), ft));
  }
  // P1 foehn and mountain-wave notes.
  if (ft.leeOfDivide) {
    for (const h of series.hours) {
      if (!inWindow(h)) continue;
      const fa = foehnAloft(h);
      if (fa) {
        out.push(mk('general', 'general:foehn:domain', 'info', { sub: 'foehn', dirAloft: fa.dir, uAloft: fa.speed }, rel(h.time), ft));
        break;
      }
    }
  }
  if (ft.ridgeGeometry) {
    const Gp = P.general;
    for (const h of series.hours) {
      if (!inWindow(h)) continue;
      const geo = ft.ridgeGeometry(h.windDir10);
      if (geo.cross < Gp.mountainWaveCrossShare) continue;
      const fr = froudeFromLevels(h, ft.relief);
      const waveFr = fr >= Gp.mountainWaveFrLo && fr <= Gp.mountainWaveFrHi && geo.leeSteeper;
      // Night variant proxy (no per-cell state in a forecast): a calm clear surface layer (stable night) under a
      // ridge-level wind ≥ 10 m/s, taken from the 850 hPa level [H].
      const u850 = level(h, 850)?.windSpeed ?? NaN;
      const calmSurface = h.windSpeed10 < 4 && (h.cloudCover ?? 0) < 50;
      const night = solarPosition(h.time, lat, lon).elevation < 0 && calmSurface && u850 >= Gp.mountainWaveURidge;
      if (waveFr || night) {
        const synthetic = upper !== 'model' && upper !== 'preset' ? 1 : 0;
        out.push(mk('general', 'general:mountain-wave:domain', 'info', { sub: 'mountain-wave', frH: fr, cross: geo.cross, synthetic }, rel(h.time), ft));
        break;
      }
    }
  }
  out.forEach((ins, i) => (ins.id = `fc-${i}-${ins.key}`));
  return out;
}

/** Signed smallest difference, re-exported for detectors that need a direction of turn. */
export const turnDeg = (a: number, b: number): number => angleDiffDeg(a, b);
