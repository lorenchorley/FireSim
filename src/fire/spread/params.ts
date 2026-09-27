/**
 * Tunable parameters of the level-set fire spread (spec docs/research/00-synthesis.md §7, §0.1).
 *
 * Every [H] (FireSim heuristic / design choice) and UNVERIFIED value used by `src/fire/spread` lives here with its
 * source tag (spec §16 item 12 lists the mountain parameterisations as [H]). Verified [V] numerics (WRF level-set
 * scheme, ROS cap) and derived [D] constants are also collected here so the solver has a single configuration point,
 * but they are marked as such and are not meant to be tuned.
 */
import { FIRE_MODEL_PARAMS } from '../models/params';

export const SPREAD_PARAMS = {
  /** Level-set numerics (spec §7.2, D1). */
  levelSet: {
    /** Viscosity ν applied to concave parts only: `ν·R·Δx·min(0, ∇²φ)` [D1, review measurement]. */
    nu: 0.2,
    /** CFL safety factor in `Δt_f = safety / max_band[R((|n_x| + 2ν)/Δx + (|n_y| + 2ν)/Δy)]` [D1]. */
    cflSafety: 0.9,
    /** Guard: a sub-step longer than `guard × bound` is rejected (spec §7.2 asserts Δt_f ≤ 1.0001·bound). */
    cflGuard: 1.0001,
    /** Global numeric ROS cap (m/s) [V WRF `ros_max`]. */
    rosMaxMs: 6,
    /** Narrow band half-width (cells): |φ| ≤ bandCells·Δx is evolved [V WRF-style narrow band, spec §7.2]. */
    bandCells: 8,
    /** φ outside the band = ±farCells·Δx [spec §7.2]. */
    farCells: 9,
    /** Prepared cells: unburnt band cells with 0 < φ ≤ prepareCells·Δx (spec §7.1). */
    prepareCells: 4,
    /** Lazy preparation inside sub-steps when the smallest 4-neighbour φ is ≤ this many cells [H numerics]. */
    lazyPrepareCells: 4,
    /** Reinitialise every this many sub-steps (spec §7.2). */
    reinitEvery: 10,
    /**
     * Burnt-side extension [H numerics, deviation from the plain §7.2 scheme]: a cell that the front reached evolves as
     * φ_t = −R_arrival (φ = −R·(t − t_arr)), is excluded from the CFL maximum and is not re-distanced. Plain level-set
     * evolution flattens φ inside narrow heads and young fires (at a local minimum the upwind |∇φ| is 0 and the
     * distance to the flanks is shorter than to the tip), and the first-order upwind step then lags the head: LB 3.84
     * at Δx 30 m runs at 0.93 of R_H after 30 min and a point ignition reaches only 0.64 of the analytic head
     * (level-set tests). With the extension the burnt side keeps unit slope along every arrival normal.
     */
    burntExtension: true,
    /** At reinitialisation the extension is kept at most this many cells deeper than the true distance [H numerics]. */
    burntExtensionMaxExtraCells: 2,
    /** Fast-sweeping iterations (each = 4 orderings) (spec §7.2). */
    sweepIterations: 2,
    /** Ignition radius floor r_ign = max(radius, ignitionRadiusCells·Δx) (spec §7.2). */
    ignitionRadiusCells: 0.75,
    /** Central-difference |∇φ| below which the normal falls back to the head direction ê (spec §7.2). */
    normalEps: 1e-6,
  },

  /** Kernel cache (spec §7.1): R_w is recomputed only where |ΔU10| exceeds this fraction (or M/FA changed) [spec]. */
  rwReuseRelTol: 0.02,

  /** Hybrid wind–slope head (spec §7.3) [H doc 01 §4.2; D3, D44]. */
  hybrid: {
    /** Blend b = smoothstep(blendLoDeg, blendHiDeg, angle(ψ_w, ψ_up)) between multiplicative and additive forms [H]. */
    blendLoDeg: 30,
    blendHiDeg: 60,
    /** |v⃗| (m/h) below which the head falls back to upslope / wind direction (spec §7.3). */
    vecEps: 1e-6,
    /** |U| (m/s) below which the wind direction is taken as 0 (calm; spec §7.3). */
    calmEps: 1e-6,
  },

  /** Forest head cap (D4): R_H ≤ 15 km/h for vesta2/pine after all multipliers [H doc 01 §4.3]. */
  forestCapMh: FIRE_MODEL_PARAMS.forestCapMh,

  /** Attachment / eruptive amplifier (spec §7.6, P1, mountainPhenomena) [H doc 01 §4.3; D4, D33; UNVERIFIED]. */
  attachment: {
    /** S(θ_e; centre, width) = 1/(1 + exp(−4(θ_e − centre)/width)) [H, D33]. */
    thetaCentreDeg: 22,
    thetaWidthDeg: 6,
    /** A uses max(T, trenchFloor) (open slopes still attach) [H]. */
    trenchFloor: 0.4,
    /** Wind alignment: 1 if d ≤ alignFullDeg or U10 < alignWindKmh; alignLowWeight if d ≥ alignHalfDeg; linear between [H]. */
    alignFullDeg: 60,
    alignHalfDeg: 120,
    alignWindKmh: 10,
    alignLowWeight: 0.5,
    /** Engagement relaxation time τ_e (s) [H]. */
    tauE: 180,
    /** s_res = clamp(U_fireInd·û_up / sResWindMs, 0, 1) (resolved indraft replaces the amplifier) [H]. */
    sResWindMs: 3,
    /** G_max (user range 1.5–4) [H]. */
    gMax: 2.5,
    gMaxMin: 1.5,
    gMaxMax: 4,
    /** A·E above which the regime is "eruptive: model indicative" (validated = false, build α doubled) [H]. */
    eruptiveAE: 0.3,
  },

  /** Gully-axis steering (spec §7.7, P1) [H doc 01 §4.2 item 6]. Applied with mountainPhenomena. */
  gully: {
    minTrench: 0.5,
    minAlongSlopeDeg: 15,
    /** Steering fraction w = clamp((α − minAlongSlopeDeg)/spanDeg, 0, 1). */
    spanDeg: 15,
    /** Only when angle(e, gullyAxis) ≤ this. */
    maxAngleDeg: 90,
  },

  /** Acceleration / build-up (spec §7.8) [K FBP α; H use]. */
  build: {
    /** α (1/min) [K verify: Forestry Canada FBP (1992) point-ignition acceleration 0.115]. */
    alphaPerMin: 0.115,
    /** build = max(minBuild, 1 − e^(−α·age_min)) [H]. */
    minBuild: 0.1,
    /** α multiplier where A·E > eruptiveAE [H]. */
    eruptiveAlphaFactor: 2,
    /** Line ignitions start at b₀ = min(lineMaxB0, L/lineRefLengthM) [H]. */
    lineRefLengthM: 500,
    lineMaxB0: 0.9,
  },

  /** Vorticity-driven lateral spread (spec §7.9, P1, mountainPhenomena) [doc 02 §4.5 corrected, D22–D25; UNVERIFIED]. */
  vls: {
    /** S_slope = smoothstep(lo, hi, slope30) — edges assume a ~30 m DEM (UNVERIFIED calibration). */
    slopeLoDeg: 18,
    slopeHiDeg: 28,
    /** S_aspect = smoothstep(cos 45°, cos 25°, lee). */
    aspectLoDeg: 45,
    aspectHiDeg: 25,
    /** S_wind = smoothstep(3.5, 6.5 m/s, U_ridge) (D22, D42). */
    windLoMs: 3.5,
    windHiMs: 6.5,
    /** S_ridge: crest within this distance (m) and the cell in the upper `ridgeUpperFraction` of the lee slope. */
    ridgeMaxDistM: 300,
    ridgeUpperFraction: 1 / 3,
    /** S_fuel = smoothstep(wet, dry, M): 1 at ≤ 8 %, 0 at ≥ 12 %. */
    fuelDryPct: 8,
    fuelWetPct: 12,
    /** Zone cells: VLS ≥ zoneMin (4-connected). */
    zoneMin: 0.5,
    /** Activation: max intensity of burning cells within upwindM upwind ≥ activationKwm (D22). */
    activationKwm: 4000,
    upwindM: 300,
    /** Lateral cells either side of the upwind march. */
    upwindLateralCells: 1,
    /** Stays active while the trigger holds, plus holdS. */
    holdS: 600,
    /**
     * Deviation [H]: upwind cells count while burning *or* within this long after their arrival (s). The spec's
     * "burning" (t − t_arr < 3τ_f ≈ 2 min) is shorter than the time the lee-eddy backing fire needs to enter a zone
     * that starts a cell or two below a (30 m-smoothed) crest, so the crossing head itself cannot activate it: on the
     * V10 ridge (28° lee, 40 km/h, Δx 30 m) the spec rule (recentS 0, activateOnContact false) first activates the
     * zone 28 min after the crest crossing (from later intense flank burning), these defaults 13 s after it. 0 = spec.
     */
    recentS: 1800,
    /** Deviation [H]: the zone also counts as reached when an unburnt zone cell touches the burnt area. false = spec. */
    activateOnContact: true,
    /** R̄ = (rateBaseKmh + rateSpanKmh·v) km/h, v = clamp((VLS − 0.5)/0.5, 0, 1) (D23). */
    rateBaseKmh: 0.4,
    rateSpanKmh: 2.4,
    /** Pulse amplitude and period range T_p ~ U(min, max) (D23). */
    pulseAmplitude: 0.8,
    periodMinS: 600,
    periodMaxS: 900,
  },

  /** Lee separation weight s_sep for the fire wind (spec §7.9, D24, D25, D42) [H]. */
  sep: {
    slopeLoDeg: 15,
    slopeHiDeg: 25,
    /** smoothstep(cos 60°, cos 30°, lee). */
    leeLoDeg: 60,
    leeHiDeg: 30,
    /** smoothstep(4.2, 6.9 m/s, U_ridge) (0.5 at 20 km/h, D42). */
    windLoMs: 4.2,
    windHiMs: 6.9,
    /** Crest distance d ≤ min(reliefFactor·relief, maxDistM). */
    reliefFactor: 5,
    maxDistM: 1000,
    /** Lee-eddy reversed wind fraction of U_ridge, upslope (D25) — applied by atmosphere/ in surfaceWindForFire. */
    eddyFraction: 0.3,
  },

  /** Junction boost (spec §7.10, P1) [K geometry, H boost; doc 01 §4.5]. */
  junction: {
    /** Candidates: unburnt band cells with 0 < φ ≤ candidateCells·Δx. */
    candidateCells: 2,
    /** Front cells within searchCells·Δx. */
    searchCells: 3,
    /** Two outward normals differing by ≥ this (deg) make a junction (θ₀ = 180 − Δψ ≤ 60°). */
    minNormalDiffDeg: 120,
    /** junction = 1 + boostFraction·(min(1/sin(θ₀/2), geomCap) − 1) [H: half the geometric factor]. */
    boostFraction: 0.5,
    geomCap: 6,
    /** Decay toward 1 with τ (s). */
    tauS: 300,
  },

  /** Rolling debris (spec §7.11, P1) [H doc 01 §4.6]. Applied with mountainPhenomena. */
  debris: {
    minSlopeDeg: 25,
    minBarkHazard: 3,
    /** λ = lambdaPerMin·S(θ; sCentreDeg, sWidthDeg)·(HeavyFuel ? 1 : nonHeavyFactor) per minute. */
    lambdaPerMin: 0.02,
    sCentreDeg: 30,
    sWidthDeg: 4,
    nonHeavyFactor: 0.5,
    /** Per stepM of travel stop with p = stopBase + stopFhsGain·clamp(FHS_el/4, 0, 1); always where slope < stopSlopeDeg. */
    stepM: 10,
    stopBase: 0.05,
    stopFhsGain: 0.3,
    stopSlopeDeg: 15,
    /** Ignition delay U(min, max) (s). */
    delayMinS: 30,
    delayMaxS: 300,
    /** Trajectories kept for render/explain (s). */
    keepS: 600,
    /** Safety limit on path length (cells). */
    maxPathCells: 400,
  },

  /** Sub-cell fire-break breach (spec §7.4) [V formula Wilson 1988 as in AFDRS-RP, 3 of 4 checks]. */
  breach: {
    c0: 1.36,
    cI: 0.00036,
    /** b = bTrees if any cell within treeRadiusM has canopyCover ≥ treeCover, else bOpen. */
    bTrees: 0.38,
    bOpen: 0.99,
    treeCover: 0.3,
    treeRadiusM: 20,
    /** A holding break stays a barrier this long, then re-draws (s) [H]. */
    holdS: 1800,
  },

  /** Heat release and burn state (spec §7.5, D27). */
  heat: {
    /** q = 0 once t − tArr > cutoffTau·τ_f (loss e^−7 = 0.09 %) [D]. */
    cutoffTau: 7,
    /** Burning while t − tArr < burningTau·τ_f, then BurntOut [H]. */
    burningTau: 3,
    /** τ_f floor (s) for cells without a residence time [H numerics]. */
    minTauS: 1,
  },

  /** Byram convective number N_c (spec §8.10) [K Byram 1959]. */
  nc: {
    cap: 100,
    /** Denominator floor on (U·ê − R) (m/s). */
    minRelWindMs: 0.5,
  },

  /** Spread-driver attribution thresholds (spec §7.12) [H]. */
  attribution: {
    vlsShare: 0.3,
    junction: 1.3,
    eruptive: 1.3,
    backingDirection: 0.3,
    fireWindShare: 0.3,
    /** max ℓ < ln(noneFactor) → None. */
    noneFactor: 1.2,
    /** Wind and slope both ≥ pairShare·max → WindAndSlope. */
    pairShare: 0.4,
    /** DryFuel only when the moisture factor ≥ this. */
    dryFuelMin: 1.5,
  },

  /** validated = false (spec §6.12): head slope outside [minDeg, maxDeg] or any [H] multiplier > multiplierMax. */
  validation: {
    headSlopeMaxDeg: FIRE_MODEL_PARAMS.slope.validMaxDeg,
    headSlopeMinDeg: FIRE_MODEL_PARAMS.slope.validMinDeg,
    multiplierMax: FIRE_MODEL_PARAMS.multiplierValidMax,
  },

  /** Cliff cells (TerrainFeatures.cliff) are NonFlammable barriers (spec §7.5 "NonFuel/Water/cliff") [H]. */
  cliffNonFlammable: true,
} as const;

/** Literal types of an `as const` object widened to their primitives (so overrides may take any value). */
type Widen<T> = T extends number ? number : T extends boolean ? boolean : T extends string ? string : T extends object ? { readonly [K in keyof T]: Widen<T[K]> } : T;

/** Shape of {@link SPREAD_PARAMS} with widened value types (what the model and the math functions accept). */
export type SpreadParams = Widen<typeof SPREAD_PARAMS>;

/**
 * One-level-deep partial override of {@link SPREAD_PARAMS} (constructor option; tests and the G_max user setting).
 * Every value is honoured: the model passes its resolved groups to the math functions of `math.ts` and `attribution.ts`.
 */
export type SpreadParamsOverride = { [K in keyof SpreadParams]?: SpreadParams[K] extends object ? Partial<SpreadParams[K]> : SpreadParams[K] };

/** Merge an override into a copy of the defaults (one level deep, which is all the object has). */
export function resolveSpreadParams(o?: SpreadParamsOverride): SpreadParams {
  if (!o) return SPREAD_PARAMS;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SPREAD_PARAMS) as (keyof SpreadParams)[]) {
    const d = SPREAD_PARAMS[key];
    const v = o[key];
    out[key] = v === undefined ? d : typeof d === 'object' && d !== null ? { ...(d as object), ...(v as object) } : v;
  }
  const a = out['attachment'] as { gMax: number; gMaxMin: number; gMaxMax: number };
  if (!(a.gMax >= a.gMaxMin && a.gMax <= a.gMaxMax)) a.gMax = Math.min(a.gMaxMax, Math.max(a.gMaxMin, Number.isFinite(a.gMax) ? a.gMax : SPREAD_PARAMS.attachment.gMax));
  return out as unknown as SpreadParams;
}
