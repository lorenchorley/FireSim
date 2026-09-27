/**
 * Vesta Mk2 dry/wet eucalypt forest model (spec docs/research/00-synthesis.md §6.2; D5–D7, D11, D21, D44).
 *
 * UNVERIFIED primary (Cruz et al. 2021 user guide / 2022 IJWF): every coefficient is from one code lineage (PyroXL
 * `Vesta2.bas`, PyroPy2 `spread_model_vesta2.py`) and sits in `FIRE_MODEL_PARAMS.mk2`. FireSim choices:
 *  - FL = surface + near-surface load, *not* × FA (D6); FA multiplies the moisture effect FME = φM·FA (D8).
 *  - R1 slope term × clamp(u − 2, 0, 1) (D21) removes the ×2–3.5 jump at u = 2 km/h.
 *  - P3 gate R2 < 300 m/h (D11); coded phase mixing by default, normalised as a switch (D7).
 *  - R0 ≡ 30·FME m/h and R_w = max(ROS_mix, R0) (D44).
 * Flat ground only: slope is applied by the caller (object API: × SF(θ); fire/spread: §7.3–7.4).
 */
import { logistic } from '../../core/physics';
import { FIRE_MODEL_PARAMS } from './params';

const M = FIRE_MODEL_PARAMS.mk2;
const PHI_C0 = M.phiM.c[0];
const PHI_C1 = M.phiM.c[1];
const PHI_C2 = M.phiM.c[2];
const PHI_C3 = M.phiM.c[3];
const PHI_C4 = M.phiM.c[4];

/** Result of one Mk2 evaluation (all rates m/h, flat ground). Reused by callers: allocate once. */
export interface Mk2Out {
  r1: number;
  r2: number;
  r3: number;
  p2: number;
  p3: number;
  /** Moisture × availability effect FME = φM·FA. */
  fme: number;
  /** φM alone. */
  phiM: number;
  /** Mixed phase rate before the R0 floor. */
  rosMix: number;
  /** No-wind rate R0 = 30·FME. */
  r0: number;
  /** Head rate R_w = max(rosMix, r0). */
  rw: number;
  /** 1 surface, 2 surface + elevated, 3 crown. */
  phase: number;
}

export const createMk2Out = (): Mk2Out => ({ r1: 0, r2: 0, r3: 0, p2: 0, p3: 0, fme: 0, phiM: 0, rosMix: 0, r0: 0, rw: 0, phase: 1 });

/** Mk2 moisture function φM (M in %): 1 (M ≤ 4.1), 0 (M > 24), quartic in between [UNVERIFIED]. */
export function mk2PhiM(m: number): number {
  if (m <= M.phiM.mLow) return 1;
  if (m > M.phiM.mHigh) return 0;
  const v = PHI_C0 + m * (PHI_C1 + m * (PHI_C2 + m * (PHI_C3 + m * PHI_C4)));
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Understorey height H_u = max(0.05, −0.1 + 0.06·FHS_el + 0.48·H_el) (m) ("Cruz 2021 eq 1") [UNVERIFIED]. */
export function understoreyHeight(fhsEl: number, hElM: number): number {
  const h = M.hu.a + M.hu.bFhsEl * fhsEl + M.hu.cHel * hElM;
  return h > M.hu.huMin ? h : M.hu.huMin;
}

/**
 * Evaluate Vesta Mk2 on flat ground (allocation-free).
 * @param u10 10 m open wind (km/h)
 * @param mPct dead fine fuel moisture (%)
 * @param fa fuel availability FA (0–1)
 * @param fl surface + near-surface fine fuel load (t/ha)
 * @param hu understorey height H_u (m)
 * @param wrf wind reduction factor (u = U10/WRF)
 * @param normalised phase mixing: false = coded (default, D7), true = normalised
 */
export function vestaMk2Core(u10: number, mPct: number, fa: number, fl: number, hu: number, wrf: number, normalised: boolean, out: Mk2Out): void {
  const phiM = mk2PhiM(mPct);
  const fme = phiM * fa;
  const u = u10 > 0 ? u10 / wrf : 0;
  const u10p = u10 > 0 ? u10 : 0;
  const fl10 = fl > 0 ? fl / 10 : 0;
  // Phase 1 (surface): coded form 1000·(0.03 + 0.05024·(u − 1)^0.92628·(FL/10)^0.79928)·FME for u > 2, with the D21 ramp.
  let r1 = M.r1.a;
  if (u > 1 && fl10 > 0) {
    let ramp = (u - M.r1Ramp.start) / M.r1Ramp.width;
    ramp = ramp < 0 ? 0 : ramp > 1 ? 1 : ramp;
    if (ramp > 0) r1 += ramp * M.r1.b * Math.pow(u - 1, M.r1.eU) * Math.pow(fl10, M.r1.eFl);
  }
  r1 *= 1000 * fme;
  // Phase 2 (surface + elevated).
  const r2 = u > 0 && fl10 > 0 ? 1000 * M.r2.a * Math.pow(u, M.r2.eU) * Math.pow(fl10, M.r2.eFl) * Math.pow(hu, M.r2.eHu) * fme : 0;
  // Phase 3 (crown).
  const r3 = u10p > 0 ? 1000 * M.r3.a * Math.pow(u10p, M.r3.eU) * fme : 0;
  const p2 = fl < M.p2.flMin ? 0 : logistic(M.p2.c0 + M.p2.cU * u + M.p2.cFme * fme + M.p2.cFl * fl);
  const p3 = r2 < M.p3.gateMh ? 0 : logistic(M.p3.c0 + M.p3.cU10 * u10p + M.p3.cFme * fme);
  let mix: number;
  if (normalised) mix = r1 * (1 - p2) + p2 * ((1 - p3) * r2 + p3 * r3);
  else if (p2 < 0.5) mix = r1 * (1 - p2) + r2 * p2;
  else mix = r1 * (1 - p2) + r2 * p2 * (1 - p3) + r3 * p3;
  const r0 = M.r0PerFme * fme;
  out.r1 = r1;
  out.r2 = r2;
  out.r3 = r3;
  out.p2 = p2;
  out.p3 = p3;
  out.fme = fme;
  out.phiM = phiM;
  out.rosMix = mix;
  out.r0 = r0;
  out.rw = mix > r0 ? mix : r0;
  out.phase = p2 < 0.5 ? 1 : p3 < 0.5 ? 2 : 3;
}

/** Mk2 data range (spec §6.2): 5 ≤ U10 ≤ 70 km/h, 4 ≤ M ≤ 20 %, WRF ∈ [3, 5]. */
export function mk2InRange(u10: number, mPct: number, wrf: number): boolean {
  const v = M.valid;
  return u10 >= v.u10Min && u10 <= v.u10Max && mPct >= v.mMin && mPct <= v.mMax && wrf >= v.wrfMin && wrf <= v.wrfMax;
}
