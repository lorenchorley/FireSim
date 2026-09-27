/**
 * Tunable constants of the fuel module (spec docs/research/00-synthesis.md §4, §0.1).
 *
 * Every [H] (FireSim heuristic / design choice) and UNVERIFIED number used by fuel/ lives here, with its source tag,
 * so it can be reviewed and tuned in one place (the spec forbids inlining them). Verified [V] constants and published
 * look-up tables stay hard-coded next to the code that uses them (catalogue.ts, hazard.ts).
 *
 * `FuelParams` is the shape `buildFuelMap({ params })` accepts as a partial override (spec §4.7 `FuelParams`).
 */

export interface FuelParams {
  // ── Fire history (§4.4) ────────────────────────────────────────────────────────────────────────────────────
  /** Days added to StartDate when EndDate is null [H §4.4]. */
  endDateDefaultDays: number;
  /** A dated fire is "active at t0" while startDate ≤ d0 ≤ endDate + this many days [§4.4]. */
  activeGraceDays: number;
  /**
   * Two records of the same kind whose burn times fall within this many days in one cell are one event [H]:
   * NPWS publishes some burns twice (identical names/dates, e.g. "UPPE_Sheep Trig_HR", "Burbie Trail North HR"),
   * and a second prescribed-burn patchiness step at zero interval would wrongly remove 84 % instead of 60 %.
   */
  recordDedupeDays: number;
  /** Window (years) of `fireCount30` [§4.4]. */
  fireCountWindowYears: number;
  /** Which TFI minimum counts as "burnt too often" in `fireCountTfi` [H: SFAZ minimum = the lowest published]. */
  tfiThreshold: 'minSfaz' | 'minLmz';
  /** Interval (years) used for classes whose TFI is 'avoid' (rainforest, alpine) [H]. */
  tfiAvoidYears: number;
  /** TFI minimum (years) used by rasteriseFireHistory before the vegetation class is known [H: DSF shrubby SFAZ]. */
  tfiDefaultMinYears: number;

  // ── Accumulation (§4.5) ────────────────────────────────────────────────────────────────────────────────────
  /** Prescribed-burn patchiness p (share of the cell burnt) [H, UNVERIFIED Penman 2007, D16, §16 item 6]. */
  patchiness: number;
  /** Post-fire regime blend weight for unknown severity [H, UNVERIFIED §16 item 6]. */
  postFireWeightUnknownSeverity: number;
  /** Post-fire regime blend weight when FESM severity ≥ high / ≤ moderate is supplied [§4.5]. */
  postFireWeightHighSeverity: number;
  postFireWeightLowSeverity: number;
  /** Post-fire regime applies while tsfMin ≤ tsf ≤ tsfMax years after a wildfire [H doc 05 §5.2]. */
  postFireTsfMin: number;
  postFireTsfMax: number;
  /** ACT "2020_" LUT pattern [V values doc 05 §2.3, H use]. */
  postFireNsMult: number;
  postFireElMult: number;
  postFireKNsEl: number;
  postFireKSurfaceMult: number;
  postFireKBark: number;
  /** WRF reduction of the post-fire (open-canopy) state before blending, and its floor [§4.5]. */
  postFireWrfDelta: number;
  postFireWrfMin: number;
  /** H_el ← H_el·(1 + factor·w) [H §4.5]. */
  postFireElHeightFactor: number;
  /** Synthetic "burnt τ years ago" record of a setTimeSinceFire edit: prescribed burn with this p [H §4.8]. */
  editBurnPatchiness: number;

  // ── buildFuelMap (§4.7) ────────────────────────────────────────────────────────────────────────────────────
  /** H_o,eff = max(CHM p90, factor·type H_o) [H: Meta CHM reads low in tall eucalypt forest, §4.1 note 4]. */
  hOEffTypeFactor: number;
  /** WRF − ridgeDelta on exposed ridges (Ridge/Peak/Spur and CHM p90 < ridgeChmMaxM) [H doc 03 §3.14]. */
  wrfRidgeDelta: number;
  wrfRidgeChmMaxM: number;
  /** WRF − lowCoverDelta for vesta2 cells with canopy cover < lowCoverThreshold [H]. */
  wrfLowCoverDelta: number;
  wrfLowCoverThreshold: number;
  wrfMin: number;
  wrfMax: number;
  /** Monthly grass curing C_month (%), January first [H §4.7]. */
  curingMonthly: readonly number[];
  /** −highElevDelta points of curing above highElevM [H]. */
  curingHighElevM: number;
  curingHighElevDelta: number;
  /** + dfSlope·(DF − dfRef) points [H]. */
  curingDfSlope: number;
  curingDfRef: number;
  curingMin: number;
  curingMax: number;
  /** UnderWoodland = heath family with CHM p90 ≥ chmMinM and cover ≥ coverMin [H §4.7]. */
  underWoodlandChmMinM: number;
  underWoodlandCoverMin: number;
  /** Cliff flag if cliffFraction ≥ this [§4.7]. */
  cliffFlagFraction: number;
  /** HeavyFuel if FHS_s ≥ fhsS or barkHazard ≥ bark [§4.7]. */
  heavyFuelFhsS: number;
  heavyFuelBarkHazard: number;
  /** CHM-derived LAI = LAI_type·clamp(c/c_type, 0, max) [H §5.4 "LAI = LAI_type·c/c_type"; the cap is FireSim's]. */
  laiCoverRatioMax: number;
  /** §5.9 topographic blend: w = smoothstep(0, tpiEdgeM, tpiSmall)·a_w, a_w peaks at aspect aspectPeakDeg [H]. */
  faBlendTpiEdgeM: number;
  faBlendAspectPeakDeg: number;
  /** Clamp of the per-cell moisture offset (percentage points) [§4.8]. */
  moistureOffsetMin: number;
  moistureOffsetMax: number;

  // ── Vegetation mapping and inference (§4.2, §4.3) ──────────────────────────────────────────────────────────
  /** Freshwater Wetlands without a class match: class 34 below this elevation, else 35 [H §4.2]. */
  freshwaterWetlandSplitM: number;
  /** Inference rule thresholds [H §4.3, calibrated on the demo "Not classified" statistics]. */
  inferCliffFraction: number;
  inferCliffSlopeDeg: number;
  inferCoverOpen: number;
  inferCoverForest: number;
  inferHeightShrubM: number;
  inferHeightTreeM: number;
  inferHeightWetForestM: number;
  inferAlpineTreelineM: number;
  inferAlpineHeathM: number;
  inferWetGullyMaxSlopeDeg: number;
}

export const FUEL_PARAMS: Readonly<FuelParams> = Object.freeze({
  endDateDefaultDays: 3,
  activeGraceDays: 1,
  recordDedupeDays: 1,
  fireCountWindowYears: 30,
  tfiThreshold: 'minSfaz',
  tfiAvoidYears: 50,
  tfiDefaultMinYears: 7,

  patchiness: 0.6,
  postFireWeightUnknownSeverity: 0.5,
  postFireWeightHighSeverity: 1,
  postFireWeightLowSeverity: 0,
  postFireTsfMin: 1,
  postFireTsfMax: 15,
  postFireNsMult: 4,
  postFireElMult: 2.5,
  postFireKNsEl: 0.45,
  postFireKSurfaceMult: 0.67,
  postFireKBark: 0.02,
  postFireWrfDelta: 1,
  postFireWrfMin: 1.5,
  postFireElHeightFactor: 0.25,
  editBurnPatchiness: 1,

  hOEffTypeFactor: 0.8,
  wrfRidgeDelta: 0.5,
  wrfRidgeChmMaxM: 12,
  wrfLowCoverDelta: 1,
  wrfLowCoverThreshold: 0.3,
  wrfMin: 1.5,
  wrfMax: 6,
  curingMonthly: Object.freeze([90, 95, 90, 80, 70, 55, 45, 45, 50, 60, 75, 85]),
  curingHighElevM: 1400,
  curingHighElevDelta: 15,
  curingDfSlope: 3,
  curingDfRef: 5,
  curingMin: 20,
  curingMax: 100,
  underWoodlandChmMinM: 8,
  underWoodlandCoverMin: 0.1,
  cliffFlagFraction: 0.3,
  heavyFuelFhsS: 3.5,
  heavyFuelBarkHazard: 3,
  laiCoverRatioMax: 1.5,
  faBlendTpiEdgeM: 30,
  faBlendAspectPeakDeg: 315,
  moistureOffsetMin: -10,
  moistureOffsetMax: 40,

  freshwaterWetlandSplitM: 1200,
  inferCliffFraction: 0.5,
  inferCliffSlopeDeg: 55,
  inferCoverOpen: 0.15,
  inferCoverForest: 0.4,
  inferHeightShrubM: 3,
  inferHeightTreeM: 6,
  inferHeightWetForestM: 15,
  inferAlpineTreelineM: 1500,
  inferAlpineHeathM: 1850,
  inferWetGullyMaxSlopeDeg: 30,
});

/** FUEL_PARAMS with a partial override applied (no mutation). */
export function resolveFuelParams(p?: Partial<FuelParams> | null): FuelParams {
  return p ? { ...FUEL_PARAMS, ...p } : { ...FUEL_PARAMS };
}

/** Milliseconds in a Julian year (spec §4.5 `YEAR = 365.25·86400·1000`). */
export const YEAR_MS = 365.25 * 86400 * 1000;
export const DAY_MS = 86400 * 1000;
