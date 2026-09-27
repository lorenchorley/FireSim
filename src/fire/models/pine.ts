/**
 * Pine plantation model (spec §6.7, P1) [V FBI-TG §3.3.8 structure; single stand stage instead of the 6-stage
 * ensemble, H]. Surface fire by Vesta Mk2 with pine fuel and the wet-forest availability; crown involvement by a
 * crown-fraction-burnt ramp between the Van Wagner initiation intensity and the Cruz et al. (2005) active rate.
 * ```
 * surface  = Vesta Mk2 (FL = s + ns, H_u, WRF = wrf, FA = FA_wet(C1(KBDI, wrf)·DF))
 * FH_surf  = Vesta FH(R_surf, H_el) ;  w_surf = FA·(min(s, 10) + ns) + (FH_surf > 1 m ? FA·el : 0) ;  I_surf = 0.5167·w_surf·R_surf
 * FMC = 150 − 5·DF ;  I_crit = (0.01·CBH·(460 + 25.9·FMC))^1.5
 * W_s = U10·ln(0.36h/0.13h)/ln((10 + 0.36h)/0.13h) ;  R_active = 661.26·W_s^0.8966·ρ_c^0.1901·e^{−0.1714·M}
 * CFB = clamp((I_surf − I_crit)/(2·I_crit), 0, 1) ;  ROS = R_surf + CFB·max(0, R_active − R_surf)
 * FH  = FH_surf + CFB·(h − FH_surf) ;  w = w_surf + CFB·FA·canopy ;  I = 0.5167·w·ROS
 * ```
 */
import { BYRAM, flameHeightVesta, powPos } from './common';
import { FIRE_MODEL_PARAMS } from './params';
import { createMk2Out, vestaMk2Core, type Mk2Out } from './vestaMk2';

const PP = FIRE_MODEL_PARAMS.pine;
const LN_036_013 = Math.log(0.36 / 0.13);
const RHO_TERM = powPos(PP.rhoC, 0.1901);

/** Pine litter moisture (%) `4.3426 + 0.1188RH − 0.0211T` [V FBI-TG eq 3.81]. */
export const pineLitterMoisture = (rh: number, tC: number): number => 4.3426 + 0.1188 * rh - 0.0211 * tC;

/** Foliar moisture content (%) FMC = 150 − 5·DF [V FBI-TG]. */
export const pineFoliarMoisture = (df: number): number => 150 - 5 * df;

/** Van Wagner crown initiation intensity (kW/m) for canopy base height `cbh` (m) and foliar moisture `fmc` (%). */
export const pineCriticalIntensity = (cbh: number, fmc: number): number => {
  const x = 0.01 * cbh * (460 + PP.vanWagnerC * fmc);
  return x > 0 ? x * Math.sqrt(x) : 0;
};

/** Wind at stand height h (km/h) from the 10 m open wind [V FBI-TG eq 3.82]. */
export function pineStandWind(u10: number, hStand: number): number {
  const h = hStand > PP.hMin ? hStand : PP.hMin;
  return (u10 * LN_036_013) / Math.log((10 + 0.36 * h) / (0.13 * h));
}

/** Active crown fire ROS (m/h) [V FBI-TG eq 3.86; K Cruz et al. 2005]. */
export const pineActiveCrownRos = (wsKmh: number, mPct: number): number =>
  wsKmh > 0 ? 661.26 * RHO_TERM * Math.exp(0.8966 * Math.log(wsKmh) - 0.1714 * mPct) : 0;

export interface PineOut {
  /** Surface (Mk2) head ROS (m/h, after the R0 floor). */
  rSurf: number;
  fhSurf: number;
  wSurf: number;
  iSurf: number;
  iCrit: number;
  standWind: number;
  rActive: number;
  /** Crown fraction burnt (0–1). */
  cfb: number;
  /** Head ROS (m/h, flat). */
  ros: number;
  flameHeight: number;
  /** Intensity fuel (t/ha). */
  w: number;
  intensity: number;
  /** Surface Mk2 terms. */
  mk2: Mk2Out;
}

export const createPineOut = (): PineOut => ({
  rSurf: 0, fhSurf: 0, wSurf: 0, iSurf: 0, iCrit: 0, standWind: 0, rActive: 0, cfb: 0, ros: 0, flameHeight: 0, w: 0, intensity: 0,
  mk2: createMk2Out(),
});

/** Surface intensity fuel w_surf (t/ha) with the PyroXL flame-height gating of the elevated layer (spec §6.7). */
export function pineSurfaceFuel(s: number, ns: number, el: number, fa: number, fhSurf: number): number {
  return fa * ((s < 10 ? s : 10) + ns) + (fhSurf > 1 ? fa * el : 0);
}

/** Crown fraction burnt from the surface intensity and the critical intensity (single stand stage, [H]). */
export function pineCfb(iSurf: number, iCrit: number): number {
  if (!(iCrit > 0)) return 0;
  const c = (iSurf - iCrit) / (PP.cfbSpan * iCrit);
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

/**
 * Evaluate the pine model on flat ground (allocation-free with a reused `out`).
 * @param hu understorey height for the Mk2 surface fire (m); hEl elevated fuel height (m); hStand stand height H_o,eff (m)
 */
export function pineCore(
  u10: number, mPct: number, fa: number, s: number, ns: number, el: number, canopy: number, hu: number, hEl: number,
  hStand: number, wrf: number, df: number, normalised: boolean, out: PineOut,
): void {
  const mk = out.mk2;
  vestaMk2Core(u10, mPct, fa, s + ns, hu, wrf, normalised, mk, false);
  const rSurf = mk.rw;
  const fhSurf = flameHeightVesta(rSurf, hEl);
  const wSurf = pineSurfaceFuel(s, ns, el, fa, fhSurf);
  const iSurf = BYRAM * wSurf * rSurf;
  const iCrit = pineCriticalIntensity(PP.cbh, pineFoliarMoisture(df));
  const ws = pineStandWind(u10 > 0 ? u10 : 0, hStand);
  const rActive = pineActiveCrownRos(ws, mPct);
  const cfb = pineCfb(iSurf, iCrit);
  const ros = rSurf + cfb * (rActive > rSurf ? rActive - rSurf : 0);
  const h = hStand > PP.hMin ? hStand : PP.hMin;
  const w = wSurf + cfb * fa * canopy;
  out.rSurf = rSurf;
  out.fhSurf = fhSurf;
  out.wSurf = wSurf;
  out.iSurf = iSurf;
  out.iCrit = iCrit;
  out.standWind = ws;
  out.rActive = rActive;
  out.cfb = cfb;
  out.ros = ros;
  out.flameHeight = fhSurf + cfb * (h > fhSurf ? h - fhSurf : 0);
  out.w = w;
  out.intensity = BYRAM * w * ros;
}
