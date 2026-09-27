/**
 * Allocation-free hot-loop API of the point models (spec §6.1 kernel API; used by fire/spread every prepare).
 *
 * `headRosKernel(p, u10kmh, mPct, fa, out)` writes the **flat** head rate (m/h) of the cell's family into a reusable
 * {@link HeadKernelOut}: `rw` is the head ROS after the `max(·, r0)` floor (all families: `rw ≥ r0`), `r0` the no-wind
 * rate (Mk2: 30·FME, D44). fire/spread applies slope, hybrid head, ellipse and caps (§7.3–§7.4).
 * `intensityKernel` gives the §6.9 intensity fuel, Byram intensity and flame height for any (arrival-normal) ROS.
 *
 * Model switches come from {@link getFireModelOptions} (module-level: the kernel signature is fixed).
 */
import type { CellFuelParams } from '../../core/types';
import { BYRAM, flameHeightGrass, flameHeightShrub, flameHeightVesta, wetC1OutOfDomain } from './common';
import { grassPhiC, grassPhiM, grassRos } from './grass';
import { heathRos, heathWaf } from './heath';
import { FIRE_MODEL_PARAMS, getFireModelOptions } from './params';
import { createPineOut, pineCfb, pineCore, pineCriticalIntensity, pineFoliarMoisture, pineSurfaceFuel } from './pine';
import { createMk2Out, understoreyHeight, vestaMk2Eval } from './vestaMk2';

/** Kernel output (spec §6.1), extended with pine crown terms and invalidity reasons. Rates in m/h, flat ground. */
export interface HeadKernelOut {
  /** No-wind, no-slope rate R0 (m/h). */
  r0: number;
  /** Flat head rate R_w = max(model rate, R0) (m/h). */
  rw: number;
  /** Mk2 phase probabilities (0 for non-Mk2 families). */
  p2: number;
  p3: number;
  /** Mk2 phase 1–3 for the vesta2 family; 0 for pine (see `cfb`), grass, heath and none (spec §7.12). */
  phase: number;
  /** Moisture × availability effect: vesta2/pine φM·FA; grass φM·φC; heath 1 (not separable); none 0. */
  fme: number;
  /** Availability used (vesta2/pine: the `fa` argument; grass/heath: 1). */
  fa: number;
  /** 1 inside the model's data range, 0 outside (spec §6.2, §6.12). */
  valid: number;
  /** Bit set of {@link KernelInvalid} reasons (0 when valid). */
  invalid: number;
  /** Pine crown fraction burnt at the head (0 elsewhere). */
  cfb: number;
  /** Pine surface (Mk2) head rate (m/h); equals rw for other families. */
  rSurf: number;
}

/** Reasons for `valid = 0` (bit flags in {@link HeadKernelOut.invalid}). */
export const KernelInvalid = {
  Wind: 1,
  Moisture: 2,
  Wrf: 4,
  Curing: 8,
} as const;

export const createHeadKernelOut = (): HeadKernelOut => ({ r0: 0, rw: 0, p2: 0, p3: 0, phase: 0, fme: 0, fa: 0, valid: 1, invalid: 0, cfb: 0, rSurf: 0 });

const MK2 = createMk2Out();
const PINE = createPineOut();
const MIN_LOAD = FIRE_MODEL_PARAMS.minFineLoad;
const MV = FIRE_MODEL_PARAMS.mk2.valid;
const GP = FIRE_MODEL_PARAMS.grass;
const HP = FIRE_MODEL_PARAMS.heath;
const PINE_DF = FIRE_MODEL_PARAMS.pine.defaultDroughtFactor;

function zero(out: HeadKernelOut, fa: number): void {
  out.r0 = 0;
  out.rw = 0;
  out.p2 = 0;
  out.p3 = 0;
  out.phase = 0;
  out.fme = 0;
  out.fa = fa;
  out.valid = 1;
  out.invalid = 0;
  out.cfb = 0;
  out.rSurf = 0;
}

function mk2Invalid(u10: number, mPct: number, wrf: number, wet: boolean): number {
  let r = 0;
  if (u10 < MV.u10Min || u10 > MV.u10Max) r |= KernelInvalid.Wind;
  if (mPct < MV.mMin || mPct > MV.mMax) r |= KernelInvalid.Moisture;
  if (wrf < MV.wrfMin || wrf > MV.wrfMax || (wet && wetC1OutOfDomain(wrf))) r |= KernelInvalid.Wrf;
  return r;
}

function mk2ToOut(out: HeadKernelOut, fa: number, u10: number, mPct: number, wrf: number, wet: boolean): void {
  out.r0 = MK2.r0;
  out.rw = MK2.rw;
  out.p2 = MK2.p2;
  out.p3 = MK2.p3;
  out.phase = MK2.phase;
  out.fme = MK2.fme;
  out.fa = fa;
  out.invalid = mk2Invalid(u10, mPct, wrf, wet);
  out.valid = out.invalid === 0 ? 1 : 0;
  out.cfb = 0;
  out.rSurf = MK2.rw;
}

/**
 * Flat head rate of spread of one cell (allocation-free).
 * @param p cell fuel parameters (family decides the model)
 * @param u10kmh 10 m open-equivalent wind (km/h) along the head
 * @param mPct dead fine fuel moisture (%)
 * @param fa fuel availability (vesta2 and pine; ignored by grass and heath)
 * @param out reusable output
 * @param df drought factor (pine only: foliar moisture FMC = 150 − 5·DF); default FIRE_MODEL_PARAMS.pine.defaultDroughtFactor
 */
export function headRosKernel(p: CellFuelParams, u10kmh: number, mPct: number, fa: number, out: HeadKernelOut, df?: number): void {
  const u10 = u10kmh > 0 ? u10kmh : 0;
  const opts = getFireModelOptions();
  switch (p.family) {
    case 'vesta2': {
      const fl = p.surfaceLoad + p.nearSurfaceLoad;
      if (!(fl >= MIN_LOAD.vesta2)) return zero(out, fa);
      const wrf = p.wrf > 0 ? p.wrf : 1;
      vestaMk2Eval(u10, mPct, fa, fl, Math.log(fl / 10), Math.log(understoreyHeight(p.fhsEl, p.hEl)), wrf, Math.log(wrf),
        opts.mk2Mixing === 'normalised', MK2, true);
      mk2ToOut(out, fa, u10, mPct, p.wrf, p.moistureFamily === 'wetForest');
      return;
    }
    case 'pine': {
      const fl = p.surfaceLoad + p.nearSurfaceLoad;
      if (!(fl >= MIN_LOAD.pine)) return zero(out, fa);
      pineCore(u10, mPct, fa, p.surfaceLoad, p.nearSurfaceLoad, p.elevatedLoad, p.canopyLoad, understoreyHeight(p.fhsEl, p.hEl), p.hEl,
        p.hOEff > 0 ? p.hOEff : p.hO, p.wrf, df ?? PINE_DF, opts.mk2Mixing === 'normalised', PINE);
      const mk = PINE.mk2;
      out.r0 = mk.r0;
      out.rw = PINE.ros > mk.r0 ? PINE.ros : mk.r0;
      out.p2 = mk.p2;
      out.p3 = mk.p3;
      out.phase = 0; // spec §7.12: the Mk2 phase is reported for the vesta2 family only (pine crowning is `cfb`)
      out.fme = mk.fme;
      out.fa = fa;
      out.invalid = mk2Invalid(u10, mPct, p.wrf, true);
      out.valid = out.invalid === 0 ? 1 : 0;
      out.cfb = PINE.cfb;
      out.rSurf = PINE.rSurf;
      return;
    }
    case 'grass': {
      if (!(p.surfaceLoad + p.nearSurfaceLoad >= MIN_LOAD.grass)) return zero(out, 1);
      const fbitg = opts.eatenOutLowWind === 'fbitg';
      const ros = grassRos(u10, mPct, p.curing, p.grassState, p.grassWaf, fbitg);
      const r0 = grassRos(0, mPct, p.curing, p.grassState, p.grassWaf, fbitg);
      out.r0 = r0;
      out.rw = ros > r0 ? ros : r0;
      out.p2 = 0;
      out.p3 = 0;
      out.phase = 0;
      out.fme = grassPhiM(mPct, u10) * grassPhiC(p.curing);
      out.fa = 1;
      let inv = 0;
      if (p.curing < GP.curingMin) inv |= KernelInvalid.Curing;
      if (mPct < GP.mMin || mPct > GP.mMax) inv |= KernelInvalid.Moisture;
      out.invalid = inv;
      out.valid = inv === 0 ? 1 : 0;
      out.cfb = 0;
      out.rSurf = out.rw;
      return;
    }
    case 'heath': {
      if (!(p.surfaceLoad + p.nearSurfaceLoad + p.elevatedLoad >= MIN_LOAD.heath)) return zero(out, 1);
      const v1 = opts.heathModel === 'v1';
      const waf = heathWaf(p.underWoodland);
      const ros = heathRos(u10, mPct, p.hEl, waf, v1);
      const r0 = heathRos(0, mPct, p.hEl, waf, v1);
      out.r0 = r0;
      out.rw = ros > r0 ? ros : r0;
      out.p2 = 0;
      out.p3 = 0;
      out.phase = 0;
      out.fme = 1;
      out.fa = 1;
      let inv = 0;
      if (mPct < HP.mMin || mPct > HP.mMax) inv |= KernelInvalid.Moisture;
      if (u10 > HP.u10Max) inv |= KernelInvalid.Wind;
      out.invalid = inv;
      out.valid = inv === 0 ? 1 : 0;
      out.cfb = 0;
      out.rSurf = out.rw;
      return;
    }
    default:
      return zero(out, 0);
  }
}

/** Intensity terms of one cell at a given ROS (spec §6.9). */
export interface IntensityOut {
  /** Consumed fine fuel w (t/ha) — the `fuelConsumed` of the contract. */
  w: number;
  /** Byram intensity (kW/m). */
  intensity: number;
  /** Flame height (m). */
  flameHeight: number;
  /** Share of w from the canopy term (vesta2 0.5·FA·canopy, pine CFB·FA·canopy), for crownShare() (§7.5). */
  crownShare: number;
  /** Pine crown fraction burnt at this ROS (0 elsewhere). */
  cfb: number;
}

export const createIntensityOut = (): IntensityOut => ({ w: 0, intensity: 0, flameHeight: 0, crownShare: 0, cfb: 0 });

/**
 * Intensity fuel, Byram intensity and flame height at a rate of spread `rosMh` (m/h; in fire/spread the arrival-normal
 * ROS), with the PyroXL flame-height gating (D28): vesta2 `w = FA·(min(s, 10) + ns)`, `+ FA·el` when FH > 1 m,
 * `+ 0.5·FA·canopy` when FH > 0.66·H_o,eff; grass `w = clamp(s + ns, 1, 6)`; heath `w = s + ns + el` (no FA); pine
 * §6.7 with the crown fraction recomputed from the surface intensity at `rosMh·rSurfFraction` (pass the head kernel's
 * `rSurf/rw`, so the head reproduces §6.7 exactly and flanks, being less intense, crown less). Bark is excluded.
 */
export function intensityKernel(p: CellFuelParams, rosMh: number, fa: number, out: IntensityOut, df?: number, rSurfFraction = 1): void {
  const ros = rosMh > 0 ? rosMh : 0;
  out.cfb = 0;
  out.crownShare = 0;
  switch (p.family) {
    case 'vesta2': {
      const fh = flameHeightVesta(ros, p.hEl);
      let w = fa * ((p.surfaceLoad < 10 ? p.surfaceLoad : 10) + p.nearSurfaceLoad);
      if (fh > 1) w += fa * p.elevatedLoad;
      let crown = 0;
      if (fh > 0.66 * p.hOEff) {
        crown = 0.5 * fa * p.canopyLoad;
        w += crown;
      }
      out.w = w;
      out.intensity = BYRAM * w * ros;
      out.flameHeight = fh;
      out.crownShare = w > 0 ? crown / w : 0;
      return;
    }
    case 'pine': {
      const rs = ros * (rSurfFraction > 0 ? (rSurfFraction < 1 ? rSurfFraction : 1) : 0);
      const fhS = flameHeightVesta(rs, p.hEl);
      const wS = pineSurfaceFuel(p.surfaceLoad, p.nearSurfaceLoad, p.elevatedLoad, fa, fhS);
      const cfb = pineCfb(BYRAM * wS * rs, pineCriticalIntensity(FIRE_MODEL_PARAMS.pine.cbh, pineFoliarMoisture(df ?? PINE_DF)));
      const crown = cfb * fa * p.canopyLoad;
      const h = p.hOEff > 0 ? p.hOEff : p.hO;
      const w = wS + crown;
      out.w = w;
      out.intensity = BYRAM * w * ros;
      out.flameHeight = fhS + cfb * (h - fhS > 0 ? h - fhS : 0);
      out.crownShare = w > 0 ? crown / w : 0;
      out.cfb = cfb;
      return;
    }
    case 'grass': {
      const l = p.surfaceLoad + p.nearSurfaceLoad;
      const w = l < 1 ? 1 : l > 6 ? 6 : l;
      out.w = w;
      out.intensity = BYRAM * w * ros;
      out.flameHeight = flameHeightGrass(ros, p.grassState === 'natural');
      return;
    }
    case 'heath': {
      const w = p.surfaceLoad + p.nearSurfaceLoad + p.elevatedLoad;
      out.w = w;
      out.intensity = BYRAM * w * ros;
      out.flameHeight = flameHeightShrub(out.intensity);
      return;
    }
    default:
      out.w = 0;
      out.intensity = 0;
      out.flameHeight = 0;
  }
}

/**
 * Optional per-cell cache for the forest fast path (struct of arrays; built once at init and after fuel edits):
 * ln(FL/10), ln H_u and ln WRF, which saves three logarithms per Mk2 evaluation. Other families fall through to
 * {@link headRosKernel}. Results are identical to headRosKernel on the same CellFuelParams.
 */
export interface KernelCellCache {
  readonly params: CellFuelParams[];
  /** 1 = vesta2 fast path available for the cell. */
  readonly fast: Uint8Array;
  readonly fl: Float64Array;
  readonly lnFl: Float64Array;
  readonly lnHu: Float64Array;
  readonly lnWrf: Float64Array;
  readonly wrf: Float64Array;
  /** 1 = wet-forest moisture family (C1 domain check). */
  readonly wet: Uint8Array;
}

/** Build the kernel cache for cells `params` (index = fire-grid cell k). */
export function buildKernelCache(params: CellFuelParams[]): KernelCellCache {
  const n = params.length;
  const c: KernelCellCache = {
    params, fast: new Uint8Array(n), fl: new Float64Array(n), lnFl: new Float64Array(n), lnHu: new Float64Array(n), lnWrf: new Float64Array(n),
    wrf: new Float64Array(n), wet: new Uint8Array(n),
  };
  for (let k = 0; k < n; k++) refreshKernelCache(c, k, params[k]!);
  return c;
}

/** Update one cell of the cache (after a fuel edit replaced its CellFuelParams). */
export function refreshKernelCache(c: KernelCellCache, k: number, p: CellFuelParams): void {
  c.params[k] = p;
  const fl = p.surfaceLoad + p.nearSurfaceLoad;
  const ok = p.family === 'vesta2' && fl >= MIN_LOAD.vesta2 && p.wrf > 0;
  c.fast[k] = ok ? 1 : 0;
  c.fl[k] = fl;
  c.lnFl[k] = ok ? Math.log(fl / 10) : 0;
  c.lnHu[k] = ok ? Math.log(understoreyHeight(p.fhsEl, p.hEl)) : 0;
  c.lnWrf[k] = ok ? Math.log(p.wrf) : 0;
  c.wrf[k] = p.wrf;
  c.wet[k] = p.moistureFamily === 'wetForest' ? 1 : 0;
}

/** {@link headRosKernel} for cell k of a {@link KernelCellCache} (same results, fewer logarithms for forest cells). */
export function headRosKernelCached(c: KernelCellCache, k: number, u10kmh: number, mPct: number, fa: number, out: HeadKernelOut, df?: number): void {
  if (c.fast[k] !== 1) return headRosKernel(c.params[k]!, u10kmh, mPct, fa, out, df);
  const u10 = u10kmh > 0 ? u10kmh : 0;
  const wrf = c.wrf[k]!;
  vestaMk2Eval(u10, mPct, fa, c.fl[k]!, c.lnFl[k]!, c.lnHu[k]!, wrf, c.lnWrf[k]!, getFireModelOptions().mk2Mixing === 'normalised', MK2, true);
  mk2ToOut(out, fa, u10, mPct, wrf, c.wet[k] === 1);
}
