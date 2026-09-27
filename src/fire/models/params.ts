/**
 * Tunable parameters of the point fire-behaviour models (spec docs/research/00-synthesis.md §6, §0.1).
 *
 * Every [H] (FireSim heuristic / design choice) and UNVERIFIED value used by `src/fire/models` lives here, with its
 * source tag. Verified [V] regression coefficients of published models are hard-coded next to their equations.
 * The Vesta Mk2 coefficients are UNVERIFIED as a whole (single code lineage PyroXL/PyroPy2, primary Cruz et al.
 * 2021/2022 not read; spec §16 item 1), so the complete coefficient set sits here as data.
 *
 * Runtime switches (Mk2 mixing, heath model, eaten-out low-wind form, FBI table variant) are in
 * {@link FireModelOptions}; their defaults come from this object.
 */

export const FIRE_MODEL_PARAMS = {
  /** Vesta Mk2 (spec §6.2) — UNVERIFIED primary, coefficients as coded in PyroXL `Vesta2.bas` / PyroPy2 (doc 03 §3.5). */
  mk2: {
    /** Understorey height H_u = max(huMin, a + b·FHS_el + c·H_el) ("Cruz 2021 eq 1") [UNVERIFIED]; floor [H]. */
    hu: { a: -0.1, bFhsEl: 0.06, cHel: 0.48, huMin: 0.05 },
    /** Moisture function φM: 1 below mLow, 0 above mHigh, quartic in between [UNVERIFIED]. */
    phiM: { mLow: 4.1, mHigh: 24, c: [0.9082, 0.1206, -0.03106, 0.001853, -0.00003467] as const },
    /** Phase-1 rate R1 = 1000·(a + ramp·b·(u − 1)^e1·(FL/10)^e2)·FME (m/h) [UNVERIFIED]. */
    r1: { a: 0.03, b: 0.05024, eU: 0.92628, eFl: 0.79928 },
    /** D21 [H]: R1 slope term × clamp((u − rampStart)/rampWidth, 0, 1) (reproduces the coded R1 for u ≥ 3 and u ≤ 2). */
    r1Ramp: { start: 2, width: 1 },
    /** Phase-2 rate R2 = 1000·a·u^eU·(FL/10)^eFl·H_u^eHu·FME [UNVERIFIED]. */
    r2: { a: 0.19591, eU: 0.8257, eFl: 0.4672, eHu: 0.495 },
    /** Phase-3 rate R3 = 1000·a·U10^eU·FME [UNVERIFIED]. */
    r3: { a: 0.05235, eU: 1.19128 },
    /** P2 = FL < flMin ? 0 : logistic(c0 + cU·u + cFme·FME + cFl·FL) [UNVERIFIED]. */
    p2: { flMin: 1, c0: -23.9315, cU: 1.7033, cFme: 12.0822, cFl: 0.95236 },
    /** P3 = R2 < gateMh ? 0 : logistic(c0 + cU10·U10 + cFme·FME); gate in m/h (D11) [UNVERIFIED]. */
    p3: { gateMh: 300, c0: -32.3074, cU10: 0.2951, cFme: 26.8734 },
    /** D44 [H]: no-wind rate R0 ≡ r0PerFme·FME (m/h), also the floor of the head rate R_w. */
    r0PerFme: 30,
    /** Data range for `validated` (spec §6.2): U10 km/h, M %, WRF [UNVERIFIED ranges of the Mk2 data set]. */
    valid: { u10Min: 5, u10Max: 70, mMin: 4, mMax: 20, wrfMin: 3, wrfMax: 5 },
  },

  /** Fuel availability (spec §5.9; functions from fuel/moisture). The wet-forest C1 domain is W ∈ [3, 5] (FBI-TG). */
  availability: {
    /** KBDI assumed by the object API for wet forest / pine when the input gives none [H]. */
    defaultKbdi: 100,
  },

  /** Minimum fine fuel (t/ha) below which a family does not spread at all [H]: a fresh burn scar stops a fire. */
  minFineLoad: { vesta2: 1.0, pine: 1.0, grass: 0.3, heath: 1.0 },

  /** CSIRO grassland (spec §6.5). The Spark continuous eaten-out form below 5 km/h is UNVERIFIED (D13). */
  grass: {
    /** Eaten-out grass below 5 km/h: Spark `0.027 + 0.1045U` (default) or FBI-TG `0.054 + 0.209U`. */
    eatenOutLowWind: 'spark' as 'spark' | 'fbitg',
    /** Grass state from the grass load L = s + ns (t/ha) [V FBI-TG]. */
    naturalMinLoad: 6,
    grazedMinLoad: 3,
    /** Default WAF of GrassyWoodland by overstorey cover (0.5 below coverSplit, else 0.3) [V AFDRS-RP Table 4.7.2]. */
    woodlandWafOpen: 0.5,
    woodlandWafClosed: 0.3,
    woodlandCoverSplit: 0.3,
    /** Curing below which the model is not validated (spec §6.12). */
    curingMin: 20,
    /** Stated application range of the moisture function (doc 03 §3.7), used for `validated`. */
    mMin: 2,
    mMax: 24,
  },

  /** Heath / shrubland (spec §6.6). Refit coefficients: PyroXL `AFDRS_heath.bas`, published source UNVERIFIED (D12). */
  heath: {
    model: 'refit2024' as 'refit2024' | 'v1',
    refit: {
      si: { c0: 2.57903, cU2: 0.175609, cH: 0.752449, cHU2: 0.149167, cM: -0.430727 },
      ros: { c0: 3.34696, cSqrtU2: 0.588662, cLogit: -0.788551, cLnH: 0.414993 },
    },
    /** 10 m → 2 m wind factor, open heath / under woodland [V FBI-TG]. */
    wafOpen: 0.667,
    wafUnderWoodland: 0.35,
    /** Numerical guards [H]: H_el floor (m) and the moisture fraction range inside ln(m/(1 − m)). */
    hMin: 0.1,
    mFracMin: 0.01,
    mFracMax: 0.6,
    /** "Model spread" note when the two heath forms differ by more than this fraction [H]. */
    spreadNoteFraction: 0.25,
    /** Data range for `validated` [H]. */
    mMin: 4,
    mMax: 20,
    u10Max: 70,
  },

  /** Pine (spec §6.7): FBI-TG §3.3.8 structure [V], single stand stage instead of the 6-stage ensemble [H]. */
  pine: {
    /** Canopy base height (m) default [H]. */
    cbh: 8,
    /** Canopy bulk density ρ_c (kg/m³) [H: mature-stage value of the FBI-TG ensemble]. */
    rhoC: 0.15,
    /** CFB = clamp((I_surf − I_crit)/(cfbSpan·I_crit), 0, 1) [H]. */
    cfbSpan: 2,
    /** Van Wagner coefficient in I_crit = (0.01·CBH·(460 + c·FMC))^1.5 [K Van Wagner 1977: 25.9]. */
    vanWagnerC: 25.9,
    /** Drought factor assumed by the kernel when the caller does not pass one (FMC = 150 − 5·DF) [H]. */
    defaultDroughtFactor: 10,
    /** Stand height floor (m) for the stand-height wind [H]. */
    hMin: 2,
  },

  /** Slope factor and caps (D2–D4). */
  slope: {
    /** Upslope SF = min(sfMax, 2^(θ/10)); 16 ≙ 40° (D4) [H]. */
    sfMax: 16,
    /** `validated = false` beyond these directional head slopes (deg) (D4, spec §6.12) [H]. */
    validMaxDeg: 20,
    validMinDeg: -30,
  },

  /** Forest head cap (D4): R_H ≤ 15 km/h in vesta2/pine after all multipliers [H doc 01 §4.3]. */
  forestCapMh: 15000,

  /** Length-to-breadth ramps (D21) [H]: LB = 1 + (f(U) − 1)·clamp((U − start)/width, 0, 1) below 5 km/h. */
  lb: { rampStart: 2, rampWidth: 3 },

  /** Spotting envelope (spec §6.10, D29) [A doc 06 §3.6 / H]. */
  spotting: {
    /** Below this ROS (m/h) the distance is the short-range value. */
    rosMin: 150,
    /** Short-range spotting distance (m). */
    shortRange: 50,
    /** ROS (m/h) from which the raw fit is used (monotone above). */
    rosFit: 1000,
    /** Numerical floors [H]: U10 (km/h) and FHS_s inside the fit (it divides by both). */
    u10Min: 5,
    fhsMin: 0.5,
  },

  /** FBI (spec §6.11): anchor FBI 200 at this metric value above the last breakpoint [V FBI-TG]. */
  fbi: { topMetric: 90000, topFbi: 200 },

  /** AFDRS-parity FBI path (D41): curing assumed for grass types when the caller gives none [H]. */
  afdrs: {
    defaultCuring: 100,
    /** Eaten-out grass below 5 km/h in the parity path: the FBI-TG eq 3.11 form (AFDRS operational parity) [H]. */
    eatenOutFbitg: true,
  },

  /** Validation flag for mountain multipliers (spec §6.12): any [H] multiplier > this makes `validated` false. */
  multiplierValidMax: 1.3,
} as const;

export type FireModelParams = typeof FIRE_MODEL_PARAMS;

/** Runtime switches of the models (UI "model" menu, comparison views). Defaults from {@link FIRE_MODEL_PARAMS}. */
export interface FireModelOptions {
  /** Vesta Mk2 phase mixing: coded (NSW RFS tools parity, D7) or normalised. */
  mk2Mixing: 'coded' | 'normalised';
  /** Heath model: AFDRS 2024 refit (default, D12) or FBI-TG v1.0 (Anderson 2015 + damping). */
  heathModel: 'refit2024' | 'v1';
  /** Eaten-out grass below 5 km/h: Spark continuous (D13) or FBI-TG. */
  eatenOutLowWind: 'spark' | 'fbitg';
  /** FBI breakpoint tables: FBI-TG v1.0 (default, D14) or PyroXL 2024 variant. */
  fbiTables: 'fbitg' | 'pyroxl2024';
}

export const DEFAULT_FIRE_MODEL_OPTIONS: Readonly<FireModelOptions> = Object.freeze({
  mk2Mixing: 'coded',
  heathModel: FIRE_MODEL_PARAMS.heath.model,
  eatenOutLowWind: FIRE_MODEL_PARAMS.grass.eatenOutLowWind,
  fbiTables: 'fbitg',
});

/** Options used by the allocation-free kernel (module-level: the kernel signature is fixed by spec §6.1). */
const kernelOptions: FireModelOptions = { ...DEFAULT_FIRE_MODEL_OPTIONS };

/** Set the model switches used by {@link headRosKernel} and by the object API when no options are passed. */
export function setFireModelOptions(opts: Partial<FireModelOptions>): void {
  Object.assign(kernelOptions, opts);
}

/** Current model switches (live object; do not mutate — use {@link setFireModelOptions}). */
export function getFireModelOptions(): Readonly<FireModelOptions> {
  return kernelOptions;
}

/** Restore the default switches (tests). */
export function resetFireModelOptions(): void {
  Object.assign(kernelOptions, DEFAULT_FIRE_MODEL_OPTIONS);
}
