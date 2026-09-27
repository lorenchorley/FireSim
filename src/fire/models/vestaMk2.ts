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
import { FIRE_MODEL_PARAMS } from './params';

const M = FIRE_MODEL_PARAMS.mk2;
const PHI_C0 = M.phiM.c[0];
const PHI_C1 = M.phiM.c[1];
const PHI_C2 = M.phiM.c[2];
const PHI_C3 = M.phiM.c[3];
const PHI_C4 = M.phiM.c[4];
// Hoisted coefficients (hot loop).
const R1A = M.r1.a, R1B = M.r1.b, R1_EU = M.r1.eU, R1_EFL = M.r1.eFl, R1_START = M.r1Ramp.start, R1_WIDTH = M.r1Ramp.width;
const R2A = M.r2.a, R2_EU = M.r2.eU, R2_EFL = M.r2.eFl, R2_EHU = M.r2.eHu;
const R3A = M.r3.a, R3_EU = M.r3.eU;
const P2_FLMIN = M.p2.flMin, P2_C0 = M.p2.c0, P2_CU = M.p2.cU, P2_CFME = M.p2.cFme, P2_CFL = M.p2.cFl;
const P3_GATE = M.p3.gateMh, P3_C0 = M.p3.c0, P3_CU10 = M.p3.cU10, P3_CFME = M.p3.cFme;
const R0_PER_FME = M.r0PerFme;

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

/** logistic(g) with exact saturation beyond |g| > 36 (where 1/(1 + e^−g) is 1 or 0 to double precision). */
const sat = (g: number): number => (g > 36 ? 1 : g < -36 ? 0 : 1 / (1 + Math.exp(-g)));

/**
 * Evaluate Vesta Mk2 on flat ground from precomputed logarithms (allocation-free; the hot-loop entry).
 * Powers are exp(a·ln x) with shared logarithms (Math.pow ≈ 57 ns in V8, exp or log ≈ 10–20 ns).
 * @param lnFl ln(FL/10) (−∞ for FL = 0); @param lnHu ln(H_u); @param lnWrf ln(WRF)
 * @param fast skip terms without weight (R1 when 1 − P2 < 1e-9, R3 when unused); skipped terms are NaN
 */
export function vestaMk2Eval(
  u10: number, mPct: number, fa: number, fl: number, lnFl: number, lnHu: number, wrf: number, lnWrf: number, normalised: boolean,
  out: Mk2Out, fast: boolean,
): void {
  const phiM = mk2PhiM(mPct);
  const fme = phiM * fa;
  const u = u10 > 0 ? u10 / wrf : 0;
  const lnU = u > 0 ? Math.log(u) : -Infinity;
  const p2 = fl < P2_FLMIN ? 0 : sat(P2_C0 + P2_CU * u + P2_CFME * fme + P2_CFL * fl);
  // Phase 1 (surface): coded 1000·(0.03 + 0.05024·(u − 1)^0.92628·(FL/10)^0.79928)·FME for u > 2, with the D21 ramp.
  // Fast path: skip R1 when its weight 1 − P2 < 1e-9 (its contribution is then < 1e-6 m/h).
  const w1 = 1 - p2;
  const skipR1 = fast && w1 < 1e-9;
  let r1: number;
  if (skipR1) r1 = NaN;
  else {
    r1 = R1A;
    if (u > 1 && fl > 0) {
      let ramp = (u - R1_START) / R1_WIDTH;
      ramp = ramp < 0 ? 0 : ramp > 1 ? 1 : ramp;
      if (ramp > 0) r1 += ramp * R1B * Math.exp(R1_EU * Math.log(u - 1) + R1_EFL * lnFl);
    }
    r1 *= 1000 * fme;
  }
  // Phase 2 (surface + elevated).
  const r2 = u > 0 && fl > 0 && fme > 0 ? 1000 * R2A * fme * Math.exp(R2_EU * lnU + R2_EFL * lnFl + R2_EHU * lnHu) : 0;
  const p3 = r2 < P3_GATE ? 0 : sat(P3_C0 + P3_CU10 * u10 + P3_CFME * fme);
  // Phase 3 (crown): U10^1.19128 with ln U10 = ln u + ln WRF.
  const r3 = !fast || (p3 > 0 && (normalised || p2 >= 0.5)) ? (u > 0 && fme > 0 ? 1000 * R3A * fme * Math.exp(R3_EU * (lnU + lnWrf)) : 0) : NaN;
  const t1 = skipR1 ? 0 : r1 * w1;
  let mix: number;
  if (normalised) mix = t1 + p2 * (p3 > 0 ? (1 - p3) * r2 + p3 * r3 : r2);
  else if (p2 < 0.5) mix = t1 + r2 * p2;
  else mix = t1 + r2 * p2 * (1 - p3) + (p3 > 0 ? r3 * p3 : 0);
  const r0 = R0_PER_FME * fme;
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

/**
 * Evaluate Vesta Mk2 on flat ground (allocation-free).
 * @param u10 10 m open wind (km/h)
 * @param mPct dead fine fuel moisture (%)
 * @param fa fuel availability FA (0–1)
 * @param fl surface + near-surface fine fuel load (t/ha)
 * @param hu understorey height H_u (m)
 * @param wrf wind reduction factor (u = U10/WRF)
 * @param normalised phase mixing: false = coded (default, D7), true = normalised
 * @param allTerms false: skip terms with zero mixing weight (kernel fast path; skipped `r1`/`r3` are NaN)
 */
export function vestaMk2Core(
  u10: number, mPct: number, fa: number, fl: number, hu: number, wrf: number, normalised: boolean, out: Mk2Out, allTerms = true,
): void {
  const w = wrf > 0 ? wrf : 1; // guard: a non-positive WRF would make u infinite
  vestaMk2Eval(u10 > 0 ? u10 : 0, mPct, fa, fl, fl > 0 ? Math.log(fl / 10) : -Infinity, Math.log(hu > 0 ? hu : M.hu.huMin), w, Math.log(w), normalised, out, !allTerms);
}

/** Mk2 data range (spec §6.2): 5 ≤ U10 ≤ 70 km/h, 4 ≤ M ≤ 20 %, WRF ∈ [3, 5]. */
export function mk2InRange(u10: number, mPct: number, wrf: number): boolean {
  const v = M.valid;
  return u10 >= v.u10Min && u10 <= v.u10Max && mPct >= v.mMin && mPct <= v.mMax && wrf >= v.wrfMin && wrf <= v.wrfMax;
}
