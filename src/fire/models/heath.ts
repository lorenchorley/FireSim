/**
 * Heath / shrubland (spec §6.6; D12).
 *
 * Default: AFDRS 2024 refit as coded in PyroXL `AFDRS_heath.bas` (published source UNVERIFIED; coefficients in
 * `FIRE_MODEL_PARAMS.heath.refit`). Selectable: FBI-TG v1.0 (Anderson et al. 2015 + Cruz et al. 2010 damping) [V].
 * ```
 * waf = underWoodland ? 0.35 : 0.667 ;  U2 = waf·U10 ;  m = M/100 ;  H = H_el (m)
 * refit: SI  = logistic(2.57903 + 0.175609·U2 + 0.752449·H + 0.149167·H·U2 − 0.430727·M)
 *        ROS = SI·exp(3.34696 + 0.588662·√U2 − 0.788551·ln(m/(1 − m)) + 0.414993·ln H)       (m/h)
 * v1.0:  ROS = 5.6715·(waf·U10)^0.9102·H^0.227·e^{−0.0762M}·60 · logistic(16.57 + 1.188·U10 − 2.705·M)
 * ```
 */
import { logistic } from '../../core/physics';
import { FIRE_MODEL_PARAMS } from './params';

const H = FIRE_MODEL_PARAMS.heath;
const SI = H.refit.si;
const RF = H.refit.ros;

/** 10 m → 2 m wind factor for heath (0.35 under an overstorey, 0.667 open) [V FBI-TG]. */
export const heathWaf = (underWoodland: boolean): number => (underWoodland ? H.wafUnderWoodland : H.wafOpen);

/** Spread likelihood SI of the 2024 refit (0–1). */
export function heathRefitSI(u10: number, mPct: number, hEl: number, waf: number): number {
  const u2 = waf * (u10 > 0 ? u10 : 0);
  const h = hEl > H.hMin ? hEl : H.hMin;
  return logistic(SI.c0 + SI.cU2 * u2 + SI.cH * h + SI.cHU2 * h * u2 + SI.cM * mPct);
}

/** AFDRS 2024 refit heath ROS (m/h, flat). */
export function heathRefitRos(u10: number, mPct: number, hEl: number, waf: number): number {
  const u2 = waf * (u10 > 0 ? u10 : 0);
  const h = hEl > H.hMin ? hEl : H.hMin;
  let m = mPct / 100;
  m = m < H.mFracMin ? H.mFracMin : m > H.mFracMax ? H.mFracMax : m;
  const si = logistic(SI.c0 + SI.cU2 * u2 + SI.cH * h + SI.cHU2 * h * u2 + SI.cM * mPct);
  return si * Math.exp(RF.c0 + RF.cSqrtU2 * Math.sqrt(u2) + RF.cLogit * Math.log(m / (1 - m)) + RF.cLnH * Math.log(h));
}

/** FBI-TG v1.0 damping factor logistic(16.57 + 1.188·U10 − 2.705·M) [V]. */
export const heathV1Damping = (u10: number, mPct: number): number => logistic(16.57 + 1.188 * u10 - 2.705 * mPct);

/** FBI-TG v1.0 heath ROS (m/h, flat) [V FBI-TG eq 3.73–3.80]. Zero in calm air (the model has no calm term). */
export function heathV1Ros(u10: number, mPct: number, hEl: number, waf: number): number {
  const u = u10 > 0 ? u10 : 0;
  if (u === 0) return 0;
  const h = hEl > H.hMin ? hEl : H.hMin;
  return 5.6715 * Math.pow(waf * u, 0.9102) * Math.pow(h, 0.227) * Math.exp(-0.0762 * mPct) * 60 * heathV1Damping(u, mPct);
}

/** Heath ROS with the selected model (m/h, flat). */
export const heathRos = (u10: number, mPct: number, hEl: number, waf: number, v1: boolean): number =>
  v1 ? heathV1Ros(u10, mPct, hEl, waf) : heathRefitRos(u10, mPct, hEl, waf);
