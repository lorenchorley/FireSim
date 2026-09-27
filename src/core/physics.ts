/**
 * Shared physical constants and helpers (spec docs/research/00-synthesis.md §0.3). One saturation vapour pressure
 * formula (Bolton 1980) is used app-wide. `stableNight()` (spec §5.2a, owner: fuel/moisture) advances the domain
 * cold-pool state shared by moisture, atmosphere, the fast-tier winds and the night cards (D49).
 */
import { clamp, smoothstep } from './units';
import type { StableNightInput, StableNightState } from './simTypes';

export const G = 9.81;
export const CP = 1005;
export const RD = 287.0;
export const KAPPA_VK = 0.4;
export const SIGMA_SB = 5.67e-8;
export const LV = 2.5e6;
export const RCP = 0.2857;
/** AFDRS default heat yield (kJ/kg) [V doc 03 §3.1]. */
export const HEAT_YIELD_KJ_PER_KG = 18600;
/** Reference air density (kg/m³) for ember terminal velocities (spec §9). */
export const RHO_REF = 1.1;

/** Saturation vapour pressure (hPa) over water, Bolton (1980). */
export const esat = (tC: number): number => 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
/** Relative humidity (%) from temperature and dew point (°C). */
export const rhFromTd = (tC: number, tdC: number): number => clamp((100 * esat(tdC)) / esat(tC), 0, 100);
/** Dew point (°C) from temperature (°C) and RH (%): exact inverse of esat. */
export function dewPointC(tC: number, rh: number): number {
  const g = Math.log(((clamp(rh, 0.1, 100) / 100) * esat(tC)) / 6.112);
  return (243.5 * g) / (17.67 - g);
}
/** ISA pressure (hPa) at altitude z (m). */
export const pressureIsa = (zM: number): number => 1013.25 * (1 - 2.25577e-5 * zM) ** 5.25588;
/** Exner function Π = (p/1000)^(R/cp). */
export const exner = (pHpa: number): number => (pHpa / 1000) ** RCP;
/** Potential temperature (K). */
export const theta = (tC: number, pHpa: number): number => (tC + 273.15) / exner(pHpa);
/** Dry-air density (kg/m³). */
export const airDensity = (tC: number, pHpa: number): number => (pHpa * 100) / (RD * (tC + 273.15));
export const logistic = (g: number): number => 1 / (1 + Math.exp(-g));
/** Vapour pressure deficit (kPa). */
export const vpdKpa = (tC: number, rh: number): number => Math.max(0, esat(tC) * (1 - rh / 100)) / 10;
/** Local mean solar time (hours 0–24) at longitude lonDeg for unix ms. */
export const lmstHour = (ms: number, lonDeg: number): number => (((ms / 3.6e6 + lonDeg / 15) % 24) + 24) % 24;

/**
 * Local calendar date 'yyyy-mm-dd' for NSW data (spec §0.2): the UTC calendar date of ms + 12 h. This maps both
 * NPWS date conventions (00:00Z = that date; 13:00Z/14:00Z = local midnight of the next date) to the intended date.
 */
export function localDate(ms: number): string {
  return new Date(ms + 12 * 3.6e6).toISOString().slice(0, 10);
}

/** Fire season of a unix ms time: local year − 1 for local months before July (spec §0.2). */
export function season(ms: number): number {
  const d = localDate(ms);
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return m < 7 ? y - 1 : y;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stable-night (cold-pool) state, spec §5.2a [H doc 02 §2.4, doc 01 §4.4; D49]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tunable constants of the stable-night state (spec §5.2a, all [H] and listed in §16 item 8). One domain-level
 * state drives the moisture cold-pool template (§5.2), the atmosphere's cold-pool θ′ and nudging taper (§8.2, §8.4),
 * the fast-tier night decoupling (§8.9) and the night cards (§10.2).
 */
export const STABLE_NIGHT_PARAMS = Object.freeze({
  /** Default cold-pool strength Δθ_max (K) when the series has no `nightTemplate`. */
  dThetaMax: 5,
  /** Default cold-pool depth h_inv (m above the valley floor). */
  hInv: 150,
  /** Growth time scale on a calm clear night (h). */
  tauGrowH: 3,
  /** Decay time scale when wind or cloud mixes the pool out (h). */
  tauDecayH: 1,
  /** Wind gate edges on the grid-point 10 m wind (m/s): g = 1 − smoothstep(lo, hi, U10). */
  windGate: [3, 5] as readonly [number, number],
  /** Cloud gate edges (%): g ×= 1 − smoothstep(lo, hi, cloud). */
  cloudGate: [37.5, 62.5] as readonly [number, number],
  /** Hours after sunrise at which the inversion has broken (linear decay of Δθ_sr to 0). */
  breakHours: 3.5,
  /** Extra hours before the break when the last 24 h brought ≥ `wetRain24Mm` of rain (wet ground heats slowly). */
  breakWetExtraHours: 1.5,
  wetRain24Mm: 2,
  /** Scale (K) of the stable-night strength sn = clamp(Δθ / snScaleK, 0, 1). */
  snScaleK: 3,
  /** A sunrise is new when it is this many hours after the registered one (one per solar day). */
  newSunriseGapH: 12,
});

/** A fresh stable-night state (Δθ = 0) with the series' night template (default { dThetaMax 5 K, hInv 150 m }). */
export function initialStableNight(template?: { dThetaMax: number; hInv: number } | null): StableNightState {
  return {
    dTheta: 0,
    dThetaAtSunrise: 0,
    tSunrise: null,
    dThetaMax: template?.dThetaMax ?? STABLE_NIGHT_PARAMS.dThetaMax,
    hInv: template?.hInv ?? STABLE_NIGHT_PARAMS.hInv,
    gate: 0,
    tBreak: null,
    sn: 0,
  };
}

/** Wind/cloud gate g (0–1) of the stable-night state: 1 on a calm clear night, 0 when windy or overcast. */
export function stableNightGate(u10: number, cloudPct: number): number {
  const P = STABLE_NIGHT_PARAMS;
  const w = Number.isFinite(u10) ? u10 : 0;
  const c = Number.isFinite(cloudPct) ? cloudPct : 0;
  return (1 - smoothstep(P.windGate[0], P.windGate[1], w)) * (1 - smoothstep(P.cloudGate[0], P.cloudGate[1], c));
}

/** Exact night update over dtS seconds: dΔθ/dt = g(Δθ_max − Δθ)/τ_grow − (1 − g)Δθ/τ_decay. */
function nightRelax(s: StableNightState, g: number, dtS: number): void {
  if (!(dtS > 0)) return;
  const P = STABLE_NIGHT_PARAMS;
  const aGrow = g / (P.tauGrowH * 3600);
  const b = aGrow + (1 - g) / (P.tauDecayH * 3600); // > 0 for any g in [0, 1]
  const eq = (aGrow * s.dThetaMax) / b;
  s.dTheta = eq + (s.dTheta - eq) * Math.exp(-b * dtS);
}

/**
 * Advance the domain stable-night (cold-pool) state by `dtS` seconds ENDING at `inp.time` (spec §5.2a). The
 * forcing (`inp`) is taken as constant over the step. The update is exact for any Δt:
 *
 *   g   = (1 − smoothstep(3, 5 m/s, U10_gp))·(1 − smoothstep(37.5, 62.5 %, cloud))
 *   night (h_sun < 0): dΔθ/dt = g·(Δθ_max − Δθ)/3 h − (1 − g)·Δθ/1 h                (exponential solution)
 *   sunrise crossing:  Δθ_sr ← Δθ; t_sr ← sunrise; t_break ← t_sr + 3.5 h (+ 1.5 h if rain24 ≥ 2 mm)
 *   day (h_sun ≥ 0):   Δθ ← min(Δθ_sr·max(0, (t_break − t)/(t_break − t_sr)), Δθ·e^{−(1 − g)Δt/1 h})
 *                      3-D tiers: t_break ← t + breakEta when the atmosphere reports one (§8.10)
 *   sn = clamp(Δθ/3 K, 0, 1)
 *
 * The sunrise is located from `hoursSinceSunrise`; when it falls inside the step the step is split (night part,
 * then day part), so an hourly spin-up and a 10 s atmosphere step give the same trajectory. Δθ is continuous at
 * sunrise and never increases by day.
 */
export function stableNight(s: StableNightState, inp: StableNightInput, dtS: number): void {
  const P = STABLE_NIGHT_PARAMS;
  const g = stableNightGate(inp.u10, inp.cloudPct);
  s.gate = g;
  const dt = dtS > 0 ? dtS : 0;
  const t = inp.time;
  if (!(inp.sunElevation >= 0)) {
    nightRelax(s, g, dt);
  } else {
    const hss = Number.isFinite(inp.hoursSinceSunrise) && inp.hoursSinceSunrise > 0 ? inp.hoursSinceSunrise : 0;
    const tSr = t - hss * 3.6e6;
    let dayDt = dt;
    if (s.tSunrise === null || tSr - s.tSunrise > P.newSunriseGapH * 3.6e6) {
      // Sunrise crossing: integrate the part of the step before sunrise as night, then register the sunrise.
      const pre = Math.min(dt, Math.max(0, dt - hss * 3600));
      nightRelax(s, g, pre);
      dayDt = dt - pre;
      s.dThetaAtSunrise = s.dTheta;
      s.tSunrise = tSr;
      const wet = Number.isFinite(inp.rain24) && inp.rain24 >= P.wetRain24Mm;
      s.tBreak = tSr + (P.breakHours + (wet ? P.breakWetExtraHours : 0)) * 3.6e6;
    }
    if (inp.breakEta !== undefined && inp.breakEta !== null && Number.isFinite(inp.breakEta)) {
      s.tBreak = t + Math.max(0, inp.breakEta) * 1000;
    }
    const tSrReg = s.tSunrise!;
    const tBreak = s.tBreak ?? tSrReg + P.breakHours * 3.6e6;
    const span = tBreak - tSrReg;
    const linear = span > 0 ? s.dThetaAtSunrise * Math.max(0, (tBreak - t) / span) : 0;
    const mixed = s.dTheta * Math.exp((-(1 - g) * dayDt) / (P.tauDecayH * 3600));
    s.dTheta = Math.max(0, Math.min(linear, mixed));
  }
  s.sn = clamp(s.dTheta / P.snScaleK, 0, 1);
}
