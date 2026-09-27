/**
 * Background profile, stratification and κ (spec §8.2; D30, D34, D46).
 *
 * For one weather stamp: the grid-point wind profile u_prof(z AGL), the environmental potential temperature
 * θ_env(z ASL), humidity for the plume diagnostics, the Froude number of the relief layer and the κ(z) factor that
 * maps model wind at z_ref back to the forecast's 10 m open-equivalent scale.
 */
import { G, pressureIsa, theta as thetaOf, exner, dewPointC, esat } from '../core/physics';
import type { WeatherHour, WeatherSeries } from '../core/types';
import { clamp, windToUV } from '../core/units';
import { solarPosition } from '../terrain';
import { ATMOS_PARAMS } from './params';

export type UpperAirSource = 'model' | 'preset' | 'synthetic' | 'none';

export interface BackgroundProfile {
  time: number;
  /** Grid-point elevation z_gp (m ASL) = series.sourceElevation (fallback: domain z_min). */
  zgp: number;
  source: UpperAirSource;
  /** True when the upper air was synthesised (§8.2 item 2). */
  synthetic: boolean;
  sunElevation: number;
  /** Wind samples (AGL m, u, v m/s), ascending; interpolation coordinate s(z) (ln z below 500 m, linear above). */
  wz: Float64Array;
  ws: Float64Array;
  wu: Float64Array;
  wv: Float64Array;
  /** 10 m wind (u, v). */
  u10: number;
  v10: number;
  /** Raw θ samples (ASL m, K), ascending (diagnostics, N²); `thd` is the non-decreasing copy used by the dynamics. */
  tz: Float64Array;
  th: Float64Array;
  thd: Float64Array;
  /** Mixing ratio samples (kg/kg) at the same heights as tz. */
  qv: Float64Array;
  /** Surface pressure at z_gp (hPa). */
  pSfc: number;
  /** 2 m temperature and dew point (°C). */
  t2: number;
  td2: number;
  /** Mixed-layer depth used (m AGL) for similarity turbulence. */
  mixedLayer: number;
  /** Relief-layer stability N² (s⁻², raw) and Froude number (§8.3). */
  nSquared: number;
  froude: number;
  /** Speed used in Fr (profile speed at z_min + relief). */
  froudeU: number;
}

/** Hybrid vertical coordinate: ln z below 500 m, continued linearly (C¹) above. */
function sCoord(z: number): number {
  const zt = ATMOS_PARAMS.lnInterpTopAGL;
  const zz = Math.max(z, 1e-3);
  return zz < zt ? Math.log(zz) : Math.log(zt) + (zz - zt) / zt;
}

const mixingRatio = (tdC: number, pHpa: number): number => {
  const e = esat(tdC);
  return (0.622 * e) / Math.max(1, pHpa - e);
};

/** Pressure (hPa) at height z (m ASL) from the surface pressure at z_gp, ISA-shaped. */
export function pressureAt(p: BackgroundProfile, z: number): number {
  return p.pSfc * (pressureIsa(z) / pressureIsa(p.zgp));
}

/**
 * Build the background profile of one stamp.
 * @param zDomainMin  fallback for z_gp when the series has no sourceElevation
 * @param reliefBase  z_min and relief (m) of the atmosphere terrain for the Froude number
 */
export function buildProfile(
  w: WeatherHour,
  series: WeatherSeries,
  zDomainMin: number,
  relief: number,
): BackgroundProfile {
  const P = ATMOS_PARAMS;
  const zgp = series.sourceElevation ?? zDomainMin;
  const sun = solarPosition(w.time, series.location.lat, series.location.lon).elevation;
  const levels = (w.pressureLevels ?? []).filter(
    (l) => Number.isFinite(l.height) && Number.isFinite(l.temperature) && l.height - zgp >= P.dropLevelsBelowAGL,
  );
  const declared = series.upperAirSource;
  const hasLevels = levels.length > 0 && (declared === 'model' || declared === 'preset' || (declared === undefined && levels.length >= 3));
  const source: UpperAirSource = hasLevels ? (declared ?? 'model') : declared === 'synthetic' ? 'synthetic' : declared === undefined ? 'none' : 'synthetic';
  const synthetic = !hasLevels;

  // ── wind samples ──
  const samples: [number, number, number][] = [];
  const [u10, v10] = windToUV(Math.max(0, w.windSpeed10), w.windDir10);
  samples.push([10, u10, v10]);
  for (const p of w.windProfile ?? []) {
    if (!Number.isFinite(p.speed) || !Number.isFinite(p.dir) || !(p.heightAGL > 10)) continue;
    const [u, v] = windToUV(p.speed, p.dir);
    samples.push([p.heightAGL, u, v]);
  }
  if (hasLevels) {
    for (const l of levels) {
      if (!Number.isFinite(l.windSpeed) || !Number.isFinite(l.windDir)) continue;
      const [u, v] = windToUV(l.windSpeed, l.windDir);
      samples.push([l.height - zgp, u, v]);
    }
  }
  samples.sort((a, b) => a[0] - b[0]);
  const dedup: [number, number, number][] = [];
  for (const s of samples) if (!dedup.length || s[0] - dedup[dedup.length - 1]![0] > 1) dedup.push(s);
  // Synthetic upper air: extend with the power law up to synthTopAGL (§8.2 item 2).
  if (synthetic) {
    const top = dedup[dedup.length - 1]!;
    if (top[0] < P.synthTopAGL) {
      const f = (P.synthTopAGL / top[0]) ** P.synthExponent;
      // Intermediate samples keep the power-law shape under the s-coordinate interpolation.
      for (const z of [200, 350, 500, 700, P.synthTopAGL]) {
        if (z <= top[0]) continue;
        const g = z === P.synthTopAGL ? f : (z / top[0]) ** P.synthExponent;
        dedup.push([z, top[1] * g, top[2] * g]);
      }
    }
  }
  const nw = dedup.length;
  const wz = new Float64Array(nw);
  const wsC = new Float64Array(nw);
  const wu = new Float64Array(nw);
  const wv = new Float64Array(nw);
  for (let q = 0; q < nw; q++) {
    wz[q] = dedup[q]![0];
    wsC[q] = sCoord(dedup[q]![0]);
    wu[q] = dedup[q]![1];
    wv[q] = dedup[q]![2];
  }

  // ── θ and humidity samples ──
  const pSfc = w.surfacePressure && w.surfacePressure > 300 ? w.surfacePressure : pressureIsa(zgp);
  const t2 = w.temperature;
  const td2 = w.dewPoint ?? dewPointC(w.temperature, w.relativeHumidity);
  const th2 = thetaOf(t2, pSfc);
  const q2 = mixingRatio(td2, pSfc);
  const blh = w.boundaryLayerHeight && w.boundaryLayerHeight > 0 ? w.boundaryLayerHeight : P.defaultMixedLayer;
  const day = sun > P.daySunDeg;
  const tSamples: [number, number, number][] = [];
  const lapse = P.synthLapseKPerKm / 1000;
  if (hasLevels) {
    tSamples.push([zgp + 2, th2, q2]);
    for (const l of levels) {
      const td = l.dewPoint ?? dewPointC(l.temperature, clamp(l.relativeHumidity, 1, 100));
      tSamples.push([l.height, thetaOf(l.temperature, l.hPa), mixingRatio(td, l.hPa)]);
    }
    tSamples.sort((a, b) => a[0] - b[0]);
  } else {
    const zMix = day ? blh : 0;
    const qAbove = (z: number): number => {
      const pz = pSfc * (pressureIsa(z) / pressureIsa(zgp));
      const T = (th2 + lapse * Math.max(0, z - zgp - zMix)) * exner(pz) - 273.15;
      return (0.622 * (P.synthRhAbove / 100) * esat(T)) / Math.max(1, pz - esat(T));
    };
    if (day) {
      tSamples.push([zgp - 3000, th2, q2]);
      tSamples.push([zgp + 2, th2, q2]);
      tSamples.push([zgp + zMix, th2, q2]);
      tSamples.push([zgp + zMix + 1, th2 + lapse, qAbove(zgp + zMix + 1)]);
      tSamples.push([zgp + 16000, th2 + lapse * (16000 - zMix), qAbove(zgp + 16000)]);
    } else {
      tSamples.push([zgp - 3000, th2 - lapse * 3002, q2]);
      tSamples.push([zgp + 2, th2, q2]);
      tSamples.push([zgp + 16000, th2 + lapse * 15998, qAbove(zgp + 16000)]);
    }
  }
  // Extensions below/above the model samples (gradients clamped to stable, non-superadiabatic values).
  if (hasLevels) {
    const lo = tSamples[0]!;
    const lo2 = tSamples[1] ?? [lo[0] + 1000, lo[1] + 3.3, lo[2]];
    const gLo = clamp((lo2[1] - lo[1]) / (lo2[0] - lo[0]), 0, P.profileGradMax);
    tSamples.unshift([lo[0] - 3000, lo[1] - gLo * 3000, lo[2]]);
    const hi = tSamples[tSamples.length - 1]!;
    const hi2 = tSamples[tSamples.length - 2]!;
    const gHi = clamp((hi[1] - hi2[1]) / (hi[0] - hi2[0]), lapse, P.profileGradMax);
    tSamples.push([Math.max(hi[0] + 1000, zgp + 16000), hi[1] + gHi * (Math.max(hi[0] + 1000, zgp + 16000) - hi[0]), hi[2] * P.topHumidityFactor]);
  }
  const nt = tSamples.length;
  const tz = new Float64Array(nt);
  const th = new Float64Array(nt);
  const thd = new Float64Array(nt);
  const qv = new Float64Array(nt);
  for (let q = 0; q < nt; q++) {
    tz[q] = tSamples[q]![0];
    th[q] = tSamples[q]![1];
    qv[q] = tSamples[q]![2];
  }
  // Non-decreasing copy (a superadiabatic 2 m value is mixed into the layer above).
  thd[nt - 1] = th[nt - 1]!;
  for (let q = nt - 2; q >= 0; q--) thd[q] = Math.min(th[q]!, thd[q + 1]!);

  const prof: BackgroundProfile = {
    time: w.time,
    zgp,
    source,
    synthetic,
    sunElevation: sun,
    wz,
    ws: wsC,
    wu,
    wv,
    u10,
    v10,
    tz,
    th,
    thd,
    qv,
    pSfc,
    t2,
    td2,
    mixedLayer: day ? blh : P.nightZi,
    nSquared: 0,
    froude: Infinity,
    froudeU: 0,
  };
  // ── relief-layer stability and Froude number (§8.3) ──
  const zLo = zDomainMin;
  const h = Math.max(relief, 1);
  const thLo = thetaRaw(prof, zLo);
  const thHi = thetaRaw(prof, zLo + h);
  const n2 = (G / (0.5 * (thLo + thHi))) * ((thHi - thLo) / h);
  const out = new Float64Array(2);
  profileWind(prof, Math.max(10, zLo + h - zgp), out);
  const U = Math.hypot(out[0]!, out[1]!);
  prof.nSquared = n2;
  prof.froudeU = U;
  prof.froude = U / (Math.sqrt(Math.max(n2, P.n2Floor)) * h);
  return prof;
}

/** u_prof(z AGL) of the grid-point column → out[0..1]. */
export function profileWind(p: BackgroundProfile, zAgl: number, out: Float64Array | Float32Array): void {
  const n = p.wz.length;
  const z0 = ATMOS_PARAMS.openZ0;
  if (zAgl <= p.wz[0]!) {
    // Log law below the 10 m sample.
    const f = zAgl <= z0 ? 0 : Math.log(zAgl / z0) / Math.log(p.wz[0]! / z0);
    out[0] = p.wu[0]! * f;
    out[1] = p.wv[0]! * f;
    return;
  }
  if (zAgl >= p.wz[n - 1]!) {
    out[0] = p.wu[n - 1]!;
    out[1] = p.wv[n - 1]!;
    return;
  }
  let q = 0;
  while (q < n - 2 && p.wz[q + 1]! < zAgl) q++;
  const t = (sCoord(zAgl) - p.ws[q]!) / (p.ws[q + 1]! - p.ws[q]!);
  out[0] = p.wu[q]! + (p.wu[q + 1]! - p.wu[q]!) * t;
  out[1] = p.wv[q]! + (p.wv[q + 1]! - p.wv[q]!) * t;
}

function interpT(z: Float64Array, v: Float64Array, x: number): number {
  const n = z.length;
  if (x <= z[0]!) return v[0]!;
  if (x >= z[n - 1]!) return v[n - 1]!;
  let q = 0;
  while (q < n - 2 && z[q + 1]! < x) q++;
  return v[q]! + ((v[q + 1]! - v[q]!) * (x - z[q]!)) / (z[q + 1]! - z[q]!);
}

/** Raw θ_env(z ASL) (diagnostics). */
export const thetaRaw = (p: BackgroundProfile, zAsl: number): number => interpT(p.tz, p.th, zAsl);
/** Non-decreasing θ_env(z ASL) for the 3-D dynamics. */
export const thetaEnv = (p: BackgroundProfile, zAsl: number): number => interpT(p.tz, p.thd, zAsl);
/** Mixing ratio (kg/kg) at z ASL. */
export const mixingRatioAt = (p: BackgroundProfile, zAsl: number): number => interpT(p.tz, p.qv, zAsl);

/** dθ_env/dz (K/m) of the dynamics profile at z (centred difference over ±dz). */
export function dThetaEnvDz(p: BackgroundProfile, zAsl: number, dz = 10): number {
  return (thetaEnv(p, zAsl + dz) - thetaEnv(p, zAsl - dz)) / (2 * dz);
}

/** Environmental temperature (°C) at z ASL from the raw profile. */
export function tempAt(p: BackgroundProfile, zAsl: number): number {
  return thetaRaw(p, zAsl) * exner(pressureAt(p, zAsl)) - 273.15;
}

/** N² (s⁻², raw) between two heights. */
export function nSquaredBetween(p: BackgroundProfile, z0: number, z1: number): number {
  const a = thetaRaw(p, z0);
  const b = thetaRaw(p, z1);
  return (G / (0.5 * (a + b))) * ((b - a) / (z1 - z0));
}

/** Open log-law ratio ln(10/z₀)/ln(z/z₀) (κ fallback, §8.2 item 5): 0.7831 at 50 m. */
export function logLawKappa(z: number): number {
  const z0 = ATMOS_PARAMS.openZ0;
  return Math.log(10 / z0) / Math.log(Math.max(z, 10) / z0);
}

/** κ(z) tables of one stamp: magnitude (the spec's scalar κ) and the complex factor (re, im) incl. the veer. */
export interface KappaTable {
  mag: Float32Array;
  re: Float32Array;
  im: Float32Array;
}

/**
 * κ lookup for one stamp: κ(z) = |u_prof(10 m)| / max(|û(z)|, 0.5 m/s), where û is the profile as represented by
 * the model levels (linear between the level-centre heights `levelZ` of a J = 1 column), so that a flat domain
 * reproduces the forecast U10 exactly (D30). Fallback: open log law when |û(z)| < 0.5 m/s. Table at 1 m steps.
 * FireSim extension [H]: the complex factor κ_c = U10/û(z) (u + iv algebra) also removes the background veer between
 * z and 10 m, so flat terrain reproduces the forecast 10 m direction as well as its speed; |κ_c| = κ.
 */
export function kappaTable(p: BackgroundProfile, levelZ: Float64Array, zMax = 400): KappaTable {
  const P = ATMOS_PARAMS;
  const mag = new Float32Array(zMax + 1);
  const re = new Float32Array(zMax + 1);
  const im = new Float32Array(zMax + 1);
  const out = new Float64Array(2);
  const lu = new Float64Array(levelZ.length);
  const lv = new Float64Array(levelZ.length);
  for (let k = 0; k < levelZ.length; k++) {
    profileWind(p, levelZ[k]!, out);
    lu[k] = out[0]!;
    lv[k] = out[1]!;
  }
  const s10 = Math.hypot(p.u10, p.v10);
  for (let z = 0; z <= zMax; z++) {
    let u: number;
    let v: number;
    if (z <= levelZ[0]!) {
      u = lu[0]!;
      v = lv[0]!;
    } else {
      let k = 0;
      while (k < levelZ.length - 2 && levelZ[k + 1]! < z) k++;
      const t = clamp((z - levelZ[k]!) / (levelZ[k + 1]! - levelZ[k]!), 0, 1);
      u = lu[k]! + (lu[k + 1]! - lu[k]!) * t;
      v = lv[k]! + (lv[k + 1]! - lv[k]!) * t;
    }
    const sp = Math.hypot(u, v);
    if (sp < P.kappaMinSpeed) {
      mag[z] = logLawKappa(z);
      re[z] = mag[z]!;
      im[z] = 0;
    } else {
      mag[z] = s10 / sp;
      if (s10 >= P.kappaMinSpeed) {
        const d = sp * sp;
        re[z] = (p.u10 * u + p.v10 * v) / d;
        im[z] = (p.v10 * u - p.u10 * v) / d;
      } else {
        re[z] = mag[z]!;
        im[z] = 0;
      }
    }
  }
  return { mag, re, im };
}

/** κ at height z from a table (linear). */
export function kappaLookup(tab: Float32Array, z: number): number {
  const n = tab.length - 1;
  const zc = z < 0 ? 0 : z > n ? n : z;
  const i = Math.min(n - 1, Math.floor(zc));
  const t = zc - i;
  return tab[i]! + (tab[i + 1]! - tab[i]!) * t;
}

/** α_v/α_h from the relief-layer Froude number (§8.3): clamp(1/Fr_h, 1, 10); non-finite → 1. */
export function alphaVRatio(p: BackgroundProfile): number {
  const r = clamp(1 / p.froude, 1, ATMOS_PARAMS.alphaVMaxRatio);
  return Number.isFinite(r) ? r : 1;
}
