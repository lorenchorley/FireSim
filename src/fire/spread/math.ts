/**
 * Pure, allocation-free building blocks of the level-set spread (spec docs/research/00-synthesis.md §7.2–§7.10,
 * §8.10 N_c). Every function here is scalar and unit-tested against the spec vectors (§14 "fire/spread" row).
 *
 * Conventions: azimuths clockwise from north (deg at the API, radians inside), unit vectors (east, north), rates in
 * m/h where the spec prints m/h (the hybrid head and ellipse speeds work in any consistent rate unit), slopes in
 * degrees positive uphill. The terrain gradient (g_x, g_y) = (∂z/∂x, ∂z/∂y) is used instead of (θ, ψ_up) so that
 * directional slopes are exact: θ_d(ψ) = atan(∇z·û(ψ)) (spec §0.2). Flat cells pass g = 0.
 */
import { smoothstep } from '../../core/units';
import { CP, G } from '../../core/physics';
import { slopeFactor } from '../models/common';
import { SPREAD_PARAMS } from './params';

export { slopeFactor };

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Azimuth (deg, [0, 360)) of a vector (east, north). */
export const azimuthOf = (x: number, y: number): number => {
  const a = Math.atan2(x, y) * RAD;
  return a < 0 ? a + 360 : a;
};

/** Unsigned angle between two azimuths (deg, [0, 180]). */
export const angleBetweenDeg = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
};

// ─────────────────────────────────────────────────────────────────────────────
// §7.3 Hybrid wind–slope head
// ─────────────────────────────────────────────────────────────────────────────

/** Output of {@link hybridHead} (rates in the unit of r0/rw). */
export interface HybridOut {
  /** Head direction ê (unit east, north) and its azimuth e (deg). */
  ex: number;
  ey: number;
  e: number;
  /** Directional slope along e, θ_e (deg). */
  thetaE: number;
  /** |v⃗| = |s⃗ + w⃗|. */
  vMag: number;
  rMult: number;
  rAdd: number;
  /** Blend weight b = smoothstep(30°, 60°, d). */
  blend: number;
  /** d = angle(ψ_w, ψ_up) (deg, 0 on flat). */
  d: number;
  rHyb: number;
}

export const createHybridOut = (): HybridOut => ({ ex: 0, ey: 1, e: 0, thetaE: 0, vMag: 0, rMult: 0, rAdd: 0, blend: 0, d: 0, rHyb: 0 });

const HY = SPREAD_PARAMS.hybrid;

/**
 * Hybrid head of spec §7.3 (D3, D44): `s⃗ = (SF(θ) − 1)·R0·û_up`, `w⃗ = (R_w − R0)·û_w`, `e = azimuth(s⃗ + w⃗)`,
 * `R_mult = R_w·SF(θ_e)`, `R_add = R0 + |v⃗|`, `R_hyb = (1 − b)R_mult + b·R_add` and the Kataburn bound
 * `R_hyb ≤ R_w·SF(θ_e)` when θ_e < 0.
 * @param gx,gy terrain gradient (m/m); pass 0, 0 on flat cells (aspect NaN → s⃗ = 0, θ_e = 0)
 * @param wx,wy unit vector the wind blows TOWARDS; pass 0, 0 when calm (ψ_w := 0, i.e. north)
 */
export function hybridHead(r0: number, rw: number, gx: number, gy: number, wx: number, wy: number, out: HybridOut): HybridOut {
  const tanT = Math.sqrt(gx * gx + gy * gy);
  const flat = !(tanT > 0);
  const upX = flat ? 0 : gx / tanT;
  const upY = flat ? 0 : gy / tanT;
  if (!(wx * wx + wy * wy > 0)) {
    wx = 0;
    wy = 1; // ψ_w := 0 when calm
  }
  const sMag = flat ? 0 : (slopeFactor(Math.atan(tanT) * RAD) - 1) * r0;
  const wMag = rw - r0;
  const vx = sMag * upX + wMag * wx;
  const vy = sMag * upY + wMag * wy;
  const vm = Math.sqrt(vx * vx + vy * vy);
  let ex: number;
  let ey: number;
  if (vm > HY.vecEps) {
    ex = vx / vm;
    ey = vy / vm;
  } else if (flat) {
    ex = wx;
    ey = wy;
  } else {
    ex = upX;
    ey = upY;
  }
  out.ex = ex;
  out.ey = ey;
  out.e = azimuthOf(ex, ey);
  out.vMag = vm;
  out.d = flat ? 0 : Math.acos(Math.max(-1, Math.min(1, wx * upX + wy * upY))) * RAD;
  out.blend = smoothstep(HY.blendLoDeg, HY.blendHiDeg, out.d);
  out.rAdd = r0 + vm;
  finishHybrid(rw, gx, gy, out);
  return out;
}

/** Recompute θ_e, R_mult and R_hyb (with the Kataburn bound) for the current ê of `out` (used after gully steering). */
export function finishHybrid(rw: number, gx: number, gy: number, out: HybridOut): void {
  const thetaE = Math.atan(gx * out.ex + gy * out.ey) * RAD;
  out.thetaE = thetaE;
  const sfE = slopeFactor(thetaE);
  out.rMult = rw * sfE;
  let r = (1 - out.blend) * out.rMult + out.blend * out.rAdd;
  if (thetaE < 0 && r > out.rMult) r = out.rMult;
  out.rHyb = r;
}

/** Convenience form of {@link hybridHead} with slope θ (deg), upslope azimuth ψ_up and wind-to azimuth ψ_w (tests, explain). */
export function hybridHeadDeg(r0: number, rw: number, slopeDeg: number, upAzDeg: number, windToDeg: number | null, out: HybridOut = createHybridOut()): HybridOut {
  const t = Number.isNaN(upAzDeg) ? 0 : Math.tan(slopeDeg * DEG);
  const gx = t * Math.sin(upAzDeg * DEG);
  const gy = t * Math.cos(upAzDeg * DEG);
  const wx = windToDeg === null ? 0 : Math.sin(windToDeg * DEG);
  const wy = windToDeg === null ? 0 : Math.cos(windToDeg * DEG);
  return hybridHead(r0, rw, Number.isNaN(upAzDeg) ? 0 : gx, Number.isNaN(upAzDeg) ? 0 : gy, wx, wy, out);
}

// ─────────────────────────────────────────────────────────────────────────────
// §7.7 Gully-axis steering
// ─────────────────────────────────────────────────────────────────────────────

const GP = SPREAD_PARAMS.gully;

/**
 * Rotate ê toward the up-gully axis (spec §7.7) where T ≥ 0.5, α ≥ 15° and angle(e, axis) ≤ 90°, by the fraction
 * `w = clamp((α − 15°)/15°, 0, 1)` along the shortest arc. Returns the fraction applied (0 = unchanged) and updates
 * out.ex/ey/e in place (the caller then calls {@link finishHybrid}).
 * @param alphaDeg directional slope along the gully axis (deg)
 */
export function gullySteer(out: HybridOut, trench: number, axisDeg: number, alphaDeg: number): number {
  if (!(trench >= GP.minTrench) || !(alphaDeg >= GP.minAlongSlopeDeg) || Number.isNaN(axisDeg)) return 0;
  let diff = ((axisDeg - out.e + 540) % 360) - 180; // signed shortest arc from e to the axis
  if (Math.abs(diff) > GP.maxAngleDeg) return 0;
  const w = Math.min(1, (alphaDeg - GP.minAlongSlopeDeg) / GP.spanDeg);
  if (!(w > 0)) return 0;
  diff *= w;
  const e = out.e + diff;
  out.e = e < 0 ? e + 360 : e >= 360 ? e - 360 : e;
  out.ex = Math.sin(out.e * DEG);
  out.ey = Math.cos(out.e * DEG);
  return w;
}

// ─────────────────────────────────────────────────────────────────────────────
// §7.4 Convex three-speed ellipse
// ─────────────────────────────────────────────────────────────────────────────

/** Output of {@link ellipseSpeeds} (rates in the unit of the inputs). */
export interface EllipseSpeedsOut {
  lb: number;
  /** LB after the build-up shrink, LB_b = 1 + (LB − 1)·b. */
  lbB: number;
  cb: number;
  h: number;
  rH: number;
  rB: number;
  rF: number;
  /** True when the forest 15 km/h cap limited R_H. */
  capped: boolean;
}

export const createEllipseSpeedsOut = (): EllipseSpeedsOut => ({ lb: 1, lbB: 1, cb: 1, h: 1, rH: 0, rB: 0, rF: 0, capped: false });

/**
 * The three speeds of spec §7.4:
 * `R_H = R_hyb·G·b` (vesta2/pine: ≤ 15 km/h), `R_B = min(R_H, max(cb·R_w, R0)·SF(−θ_e)·b)`,
 * `R_F = h·R_w·½[SF(θ(e + 90°)) + SF(θ(e − 90°))]·b`, with cb, h of LB_b = 1 + (LB − 1)·b.
 * @param lb length-to-breadth ratio from the wind along the head axis (§6.8)
 * @param thetaSideDeg directional slope along e + 90° (the e − 90° slope is its negative)
 * @param capMh forest head cap in the rate unit (Infinity for grass/heath)
 */
export function ellipseSpeeds(
  rHyb: number, gain: number, build: number, rw: number, r0: number, thetaEDeg: number, thetaSideDeg: number, lb: number, capMh: number,
  out: EllipseSpeedsOut,
): EllipseSpeedsOut {
  const l = lb > 1 ? lb : 1;
  const lbB = 1 + (l - 1) * build;
  const cc = Math.sqrt(1 - 1 / (lbB * lbB));
  const cb = (1 - cc) / (1 + cc);
  const f = (1 + cb) / 2;
  const h = f / lbB;
  let rH = rHyb * gain * build;
  let capped = false;
  if (rH > capMh) {
    rH = capMh;
    capped = true;
  }
  const back = (cb * rw > r0 ? cb * rw : r0) * slopeFactor(-thetaEDeg) * build;
  out.lb = l;
  out.lbB = lbB;
  out.cb = cb;
  out.h = h;
  out.rH = rH;
  out.rB = back < rH ? back : rH;
  out.rF = h * rw * 0.5 * (slopeFactor(thetaSideDeg) + slopeFactor(-thetaSideDeg)) * build;
  out.capped = capped;
  return out;
}

/**
 * Support function of the offset ellipse with semi-axes a (along ê), b_F (across) and centre offset c (spec §7.4):
 * `R = c·cos ψ + √(a²cos²ψ + b_F²sin²ψ)`; R(0) = R_H, R(180°) = R_B, R(90°) = R_F for a = (R_H + R_B)/2, c = (R_H − R_B)/2.
 */
export function offsetEllipseSpeed(rH: number, rB: number, rF: number, cosPsi: number): number {
  const a = 0.5 * (rH + rB);
  const c = 0.5 * (rH - rB);
  const c2 = cosPsi * cosPsi;
  return c * cosPsi + Math.sqrt(a * a * c2 + rF * rF * (1 - c2 > 0 ? 1 - c2 : 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// §7.2 CFL bound
// ─────────────────────────────────────────────────────────────────────────────

/** `Δt_f = safety / [R·((|n_x| + 2ν)/Δx + (|n_y| + 2ν)/Δy)]` (s; ∞ for R = 0) (D1). */
export function cflBoundDt(rMs: number, nx: number, ny: number, dx: number, nu: number = SPREAD_PARAMS.levelSet.nu, safety: number = SPREAD_PARAMS.levelSet.cflSafety, dy: number = dx): number {
  const c = rMs * ((Math.abs(nx) + 2 * nu) / dx + (Math.abs(ny) + 2 * nu) / dy);
  return c > 0 ? safety / c : Infinity;
}

// ─────────────────────────────────────────────────────────────────────────────
// §7.6 Attachment / eruptive amplifier
// ─────────────────────────────────────────────────────────────────────────────

const AP = SPREAD_PARAMS.attachment;

/** `S(x; c, w) = 1/(1 + exp(−4(x − c)/w))`. */
export const logisticS = (x: number, c: number, w: number): number => 1 / (1 + Math.exp((-4 * (x - c)) / w));

/** W_align (spec §7.6): 1 if d ≤ 60° or U10 < 10 km/h; 0.5 if d ≥ 120° (and U10 ≥ 10); linear between. */
export function alignmentWeight(dDeg: number, u10Kmh: number): number {
  if (u10Kmh < AP.alignWindKmh || !(dDeg > AP.alignFullDeg)) return 1;
  const t = Math.min(1, (dDeg - AP.alignFullDeg) / (AP.alignHalfDeg - AP.alignFullDeg));
  return 1 - (1 - AP.alignLowWeight) * t;
}

/** `A = S(θ_e; 22°, 6°)·max(T, 0.4)·W_align` (spec §7.6). */
export const attachmentScore = (thetaEDeg: number, trench: number, wAlign: number): number =>
  logisticS(thetaEDeg, AP.thetaCentreDeg, AP.thetaWidthDeg) * (trench > AP.trenchFloor ? trench : AP.trenchFloor) * wAlign;

/** `G = 1 + (G_max − 1)·A·E·(1 − s_res)` (spec §7.6). */
export const amplifierGain = (a: number, e: number, sRes: number, gMax: number = AP.gMax): number => 1 + (gMax - 1) * a * e * (1 - sRes);

/** Exact exponential relaxation of the engagement E toward A over dt (τ_e = 180 s). */
export const relaxEngagement = (e: number, a: number, dt: number, tau: number = AP.tauE): number => (dt > 0 ? a + (e - a) * Math.exp(-dt / tau) : e);

// ─────────────────────────────────────────────────────────────────────────────
// §7.8 Build-up
// ─────────────────────────────────────────────────────────────────────────────

const BP = SPREAD_PARAMS.build;

/** `build = max(0.1, 1 − e^(−α·age_min))`, α = 0.115 /min (× 2 in the eruptive regime) (spec §7.8). */
export function buildFraction(ageS: number, eruptive = false): number {
  const alpha = BP.alphaPerMin * (eruptive ? BP.eruptiveAlphaFactor : 1);
  const b = ageS > 0 ? 1 - Math.exp((-alpha * ageS) / 60) : 0;
  return b > BP.minBuild ? b : BP.minBuild;
}

/** Origin of a line ignition of length L: `t_ign + 60·ln(1 − b₀)/α`, b₀ = min(0.9, L/500 m) (spec §7.8). */
export function lineIgnitionOrigin(tIgn: number, lengthM: number): number {
  const b0 = Math.min(BP.lineMaxB0, Math.max(0, lengthM) / BP.lineRefLengthM);
  return b0 > 0 ? tIgn + (60 * Math.log(1 - b0)) / BP.alphaPerMin : tIgn;
}

// ─────────────────────────────────────────────────────────────────────────────
// §7.9 VLS score and lee separation
// ─────────────────────────────────────────────────────────────────────────────

const VP = SPREAD_PARAMS.vls;
const SP = SPREAD_PARAMS.sep;
const COS_VLS_LO = Math.cos(VP.aspectLoDeg * DEG);
const COS_VLS_HI = Math.cos(VP.aspectHiDeg * DEG);
const COS_SEP_LO = Math.cos(SP.leeLoDeg * DEG);
const COS_SEP_HI = Math.cos(SP.leeHiDeg * DEG);

/** Lee alignment `lee = isNaN(aspect) ? 0 : cos(aspect − windTo)` (spec §7.9). */
export const leeAlignment = (aspectDeg: number, windToDeg: number): number => (Number.isNaN(aspectDeg) ? 0 : Math.cos((aspectDeg - windToDeg) * DEG));

/**
 * VLS score (spec §7.9): `S_slope·S_aspect·S_wind·S_ridge·S_fuel` with smoothstep(18°, 28°, slope30),
 * smoothstep(cos 45°, cos 25°, lee), smoothstep(3.5, 6.5 m/s, U_ridge), S_ridge ∈ {0, 1}, smoothstep(12 %, 8 %, M).
 * NaN U_ridge (no crest) → 0.
 */
export function vlsScore(slope30Deg: number, lee: number, uRidgeMs: number, sRidge: number, mPct: number): number {
  if (!(sRidge > 0) || !(uRidgeMs === uRidgeMs)) return 0;
  return (
    smoothstep(VP.slopeLoDeg, VP.slopeHiDeg, slope30Deg) *
    smoothstep(COS_VLS_LO, COS_VLS_HI, lee) *
    smoothstep(VP.windLoMs, VP.windHiMs, uRidgeMs) *
    sRidge *
    smoothstep(VP.fuelWetPct, VP.fuelDryPct, mPct)
  );
}

/**
 * Lee separation weight (spec §7.9): `smoothstep(15°, 25°, slope30)·smoothstep(cos 60°, cos 30°, lee)·
 * smoothstep(4.2, 6.9 m/s, U_ridge)·[d ≤ min(5·relief, 1000 m)]` (the bracket is `crestOk`).
 */
export function leeSeparation(slope30Deg: number, lee: number, uRidgeMs: number, crestOk: boolean): number {
  if (!crestOk || !(uRidgeMs === uRidgeMs)) return 0;
  return smoothstep(SP.slopeLoDeg, SP.slopeHiDeg, slope30Deg) * smoothstep(COS_SEP_LO, COS_SEP_HI, lee) * smoothstep(SP.windLoMs, SP.windHiMs, uRidgeMs);
}

/** VLS lateral rate (m/s): `R̄·[1 + 0.8·sin(2π(t − t_act)/T_p)]`, R̄ = (0.4 + 2.4v) km/h, v = clamp((VLS − 0.5)/0.5, 0, 1). */
export function vlsLateralRate(vls: number, sinceActS: number, periodS: number): number {
  let v = (vls - 0.5) / 0.5;
  v = v < 0 ? 0 : v > 1 ? 1 : v;
  const mean = (VP.rateBaseKmh + VP.rateSpanKmh * v) / 3.6;
  return mean * (1 + VP.pulseAmplitude * Math.sin((2 * Math.PI * sinceActS) / periodS));
}

// ─────────────────────────────────────────────────────────────────────────────
// §7.10 Junctions, §7.4 breach, §8.10 N_c
// ─────────────────────────────────────────────────────────────────────────────

const JP = SPREAD_PARAMS.junction;

/** Geometric closing factor `1/sin(θ₀/2)` of a V with included angle θ₀ (deg). */
export const junctionGeometric = (theta0Deg: number): number => 1 / Math.sin((theta0Deg * DEG) / 2);

/** Junction boost `1 + 0.5·(min(1/sin(θ₀/2), 6) − 1)` (spec §7.10). θ₀ = 180° − Δψ of the two outward normals. */
export function junctionBoost(theta0Deg: number): number {
  const g = theta0Deg > 0 ? junctionGeometric(theta0Deg) : Infinity;
  return 1 + JP.boostFraction * ((g < JP.geomCap ? g : JP.geomCap) - 1);
}

const BR = SPREAD_PARAMS.breach;

/** Wilson breach probability `P = z/(1 + z)`, `z = exp(1.36 + 0.00036·I − b·W)`, b = 0.38 with trees else 0.99 (spec §7.4). */
export function breachProbability(intensityKwm: number, widthM: number, trees: boolean): number {
  const z = Math.exp(BR.c0 + BR.cI * intensityKwm - (trees ? BR.bTrees : BR.bOpen) * widthM);
  return z / (1 + z);
}

const NP = SPREAD_PARAMS.nc;

/**
 * Byram convective number (spec §8.10): `N_c = min(100, 2gI/(ρ c_p T·max(U·ê − R, 0.5 m/s)³))`, I in W/m, T in K.
 * @param intensityKwm fireline intensity (kW/m)
 * @param uAlongMs wind component along the spread direction (m/s)
 * @param rosMs spread rate (m/s)
 * @param tempC air temperature (°C)
 */
export function byramConvectiveNumber(intensityKwm: number, uAlongMs: number, rosMs: number, rho: number, tempC: number): number {
  if (!(intensityKwm > 0)) return 0;
  let rel = uAlongMs - rosMs;
  if (!(rel > NP.minRelWindMs)) rel = NP.minRelWindMs;
  const nc = (2 * G * intensityKwm * 1000) / (rho * CP * (tempC + 273.15) * rel * rel * rel);
  return nc < NP.cap ? nc : NP.cap;
}
