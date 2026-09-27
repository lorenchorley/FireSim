/**
 * Surface heating and slope flows (spec §8.6; V WindNinja `cellDiurnal.cpp`; D50) and fire-heat vertical profiles
 * (§8.7; V WRF, D27).
 */
import { CP, G, SIGMA_SB } from '../core/physics';
import { smoothstep } from '../core/units';
import { ATMOS_PARAMS } from './params';

/**
 * Sensible heat flux Q_h (W/m² of slope surface) of one cell:
 *   Q* = [(1 − A)·Q_sw + 5.31e-13·T⁶ − σT⁴ + 60N]/(1 + 0.12);  B = 1 + 3·smoothstep(50, 150, KBDI);
 *   Q_h = B/(1 + B)·Q*·(1 − c_g). Same Q* at night (no Holtslag iteration in v1).
 * @param qsw    shortwave on the slope (insolation().total, W/m²)
 * @param albedo A
 * @param tK     cell air temperature (K)
 * @param cloud  cloud fraction N (0–1)
 */
export function sensibleHeatFlux(qsw: number, albedo: number, tK: number, cloud: number, kbdi: number): number {
  const P = ATMOS_PARAMS;
  const t2 = tK * tK;
  const t4 = t2 * t2;
  const qStar = ((1 - albedo) * qsw + P.qStarC1 * t4 * t2 - SIGMA_SB * t4 + P.qStarC2 * cloud) / (1 + P.qStarC3);
  const B = P.bowenBase + P.bowenDrought * smoothstep(P.bowenKbdi0, P.bowenKbdi1, kbdi);
  return (B / (1 + B)) * qStar * (1 - P.groundHeatFrac);
}

/** Upslope (anabatic) hydraulic flow speed S (m/s): [Q_h·g·Δz_u/((C_d + E)·ρc_pT)]^{1/3} (Q_h > 0). */
export function anabaticSpeed(qh: number, dzUp: number, rho: number, tK: number): number {
  if (!(qh > 0) || !(dzUp > 0)) return 0;
  return Math.cbrt((qh * G * dzUp) / (ATMOS_PARAMS.slopeUpCdE * rho * CP * tK));
}

/**
 * Downslope (katabatic) speed S (m/s), Q_h < 0:
 *   S = [−Q_h·g·L·sin α/(ρc_pT·(C_d + E))]^{1/3}·(1 − e^{−L/L_e})^{1/3},  L_e = 0.05·Δz_d/(C_d + E).
 * @param dzDown rise to the local crest Δz_d (m); L along-path distance from that crest; sinA = min(Δz_d/L, sin slope)
 */
export function katabaticSpeed(qh: number, dzDown: number, L: number, sinA: number, rho: number, tK: number): number {
  if (!(qh < 0) || !(L > 0) || !(dzDown > 0) || !(sinA > 0)) return 0;
  const P = ATMOS_PARAMS;
  const cde = P.slopeDownCdE;
  const Le = (P.slopeLeCoef * dzDown) / cde;
  return Math.cbrt((-qh * G * L * sinA) / (rho * CP * tK * cde)) * Math.cbrt(1 - Math.exp(-L / Le));
}

/** Fraction of an e-folding flux F(z) = Q·e^{−z/α} deposited between z0 and z1 (AGL). */
export function expLayerFraction(z0: number, z1: number, alpha: number): number {
  return Math.exp(-z0 / alpha) - Math.exp(-z1 / alpha);
}

/** Canopy-heat profile F/Q = 1 below H, e^{−(z − H)/decay} above: fraction deposited in [z0, z1]. */
export function crownLayerFraction(z0: number, z1: number, H: number, decay: number = ATMOS_PARAMS.crownDecay): number {
  const F = (z: number): number => (z <= H ? 1 : Math.exp(-(z - H) / decay));
  return F(z0) - F(z1);
}
