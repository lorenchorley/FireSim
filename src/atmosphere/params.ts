/**
 * Tunable parameters of the atmosphere module (spec docs/research/00-synthesis.md §8, §12.6, §16).
 *
 * §0.1 rule: every [H] (FireSim heuristic) and UNVERIFIED value lives here, never inline. [V]/[K]/[D] constants that
 * the spec hard-codes are kept here too when they are shared between files, with their tag. Each entry cites the
 * spec section (and the research doc where the spec does).
 */
import { FuelType, type QualityTier } from '../core/types';

/** Per-tier grid and solver settings (spec §12.6 table; §8.1). */
export interface AtmosTierSettings {
  /** N_tier: Δx_a = clamp(extent / N_tier, 100 m, 270 m) (§8.1). */
  nTier: number;
  /** Number of terrain-following levels. */
  levels: number;
  /** First-level thickness Δζ₁ (m). */
  dz1: number;
  /** Multigrid V-cycles per dynamics step (§8.4 step 7). */
  vCycles: number;
}

export const ATMOS_TIERS: Record<QualityTier, AtmosTierSettings> = {
  // The fast tier has no 3-D dynamics; its mass-consistent u_bg uses the standard-tier grid (§8.9).
  fast: { nTier: 45, levels: 20, dz1: 30, vCycles: 1 },
  standard: { nTier: 45, levels: 20, dz1: 30, vCycles: 1 },
  high: { nTier: 60, levels: 24, dz1: 25, vCycles: 2 },
};

export const ATMOS_PARAMS = {
  // ── §8.1 grid, metric, canopy ────────────────────────────────────────────────────────────────────
  /** Horizontal cell-size clamp (m) [D §8.1]. */
  minCellSize: 100,
  maxCellSize: 270,
  /** Model top above z_min (m): H′ = max(atmosTop, relief + reliefMargin) [H §8.1]. */
  atmosTop: 3000,
  reliefMargin: 2000,
  /** Max terrain slope after smoothing (deg). UNVERIFIED rule of thumb for terrain-following stability (doc 07 §7.5). */
  maxSmoothedSlopeDeg: 35,
  /** Safety bound on the 3×3 Gaussian smoothing passes. */
  maxSmoothingPasses: 400,
  /** Davies zone width n_D = max(daviesMinCells, round(daviesFraction·nx)) [H §8.1]. */
  daviesMinCells: 3,
  daviesFraction: 0.1,
  /** Canopy roughness (D51, [K form, H use], §16 item 23): H̄ = mean(canopyHeight·min(1, cover/coverRef)). */
  canopyCoverRef: 0.3,
  z0Frac: 0.1,
  dispFrac: 0.67,
  z0Min: 0.01,
  /** z_eff = max(z₁ − d, zEffZ0Mult·z₀). */
  zEffZ0Mult: 10,
  /** C_D cap. */
  cdMax: 0.03,

  // ── §8.2 background profile ──────────────────────────────────────────────────────────────────────
  /** Interpolate winds linearly in ln z below this height AGL (m), linearly in z above [H §8.2]. */
  lnInterpTopAGL: 500,
  /** Drop pressure levels whose height is below ground + this (m) [§8.2]. */
  dropLevelsBelowAGL: 50,
  /** Synthetic upper air [H §8.2 item 2]: u = u_top·(z/z_top)^exp up to synthTopAGL, constant above. */
  synthExponent: 0.14,
  synthTopAGL: 1000,
  /** Synthetic stratification above the mixed layer and at night (K/km) [H]. */
  synthLapseKPerKm: 3.3,
  /** Default mixed-layer depth when BLH is missing (m AGL) [H]. */
  defaultMixedLayer: 1500,
  /** Sun elevation (deg) above which the synthetic day profile (mixed layer) applies [H]. */
  daySunDeg: 5,
  /** κ denominator floor (m/s) [§8.2 item 5]. */
  kappaMinSpeed: 0.5,
  /** Open-terrain z₀ (m) of the fallback log law ln(10/z₀)/ln(z/z₀) [K]. */
  openZ0: 0.03,
  /** N² floor (s⁻²) wherever N is used [§8.2 item 3]. */
  n2Floor: 1e-6,
  /** Default cold-pool template when the series has none (§5.2a). */
  defaultNightTemplate: { dThetaMax: 5, hInv: 150 },

  // ── §8.3 mass-consistent background wind ─────────────────────────────────────────────────────────
  alphaH: 1,
  /** α_v = α_h·clamp(1/Fr_h, 1, alphaVMaxRatio) [H stability weighting]. */
  alphaVMaxRatio: 10,
  /** First guess: terrain-following below this AGL (m), ASL-matched above firstGuessHigh (m) [doc 07 §7.7]. */
  firstGuessLow: 300,
  firstGuessHigh: 800,
  /** Wind-edit weight fades to 0 at this AGL (m) [H §8.3]. */
  windEditFadeTop: 300,
  /** Extra 10-min stamps when the direction changes by more than this between stamps [H §8.3]. */
  subStampDirDeg: 20,
  subStampS: 600,
  /** Mass-consistent solve: relative residual target and iteration cap (P0, §8.5). */
  mcTol: 1e-6,
  mcMaxIter: 40,
  /** Defect-correction reduction per cycle worse than this → switch to MG-preconditioned Krylov (§8.5). */
  mgSlowRate: 0.3,

  // ── §8.4 dynamics ────────────────────────────────────────────────────────────────────────────────
  /** Δt_a = clamp(courant·min(Δx/|u|max, Δz_min/|w|max), dtMin, dtMax) (s) [H]. */
  courant: 3,
  dtMin: 3,
  dtMax: 12,
  /** θ′ cap (K) [H §8.4 step 4]. */
  thetaCap: 60,
  /** Nudging time scale (s) and taper [H doc 07 §7.10]. */
  nudgeTauS: 2700,
  nudgeDayBase: 0.3,
  nudgeDayRamp0: 50,
  nudgeDayRamp1: 150,
  nudgeNightDepth: 300,
  /** Rayleigh sponge (top z_d m; γ_max on w [V WRF default], weak u, v, θ′ relaxation [H]). */
  spongeDepth: 800,
  spongeGammaW: 0.2,
  spongeRelax: 0.01,
  /** Davies λ(d) = e^{−d/2}/(daviesSteps·Δt) [H doc 07 §7.7]. */
  daviesSteps: 5,
  /** Smagorinsky [V WRF]: c_s, Pr, upper bound K ≤ limit·ℓ²/Δt. */
  smagCs: 0.25,
  prandtl: 1 / 3,
  smagLimit: 0.1,
  /** [H doc 07 §7.3] limit horizontal θ′ diffusion where the ζ-surface slope·Δx exceeds this × Δz. */
  thetaDiffSlopeLimit: 2,
  /** Spin-up duration (s) without fire (§8.4). */
  spinUpS: 900,
  /** Projection relative-residual tolerance (§8.4 step 7) and the extra cycles allowed to reach it. */
  projTol: 1e-3,
  /** Extra V-cycles allowed beyond the tier's count while the predicted max|∇·u|·Δx/|u| > projTol [H]. */
  projExtraCycles: 2,
  /** Max-norm divergence reduction per V-cycle assumed by that prediction (measured ≈ 0.3 on the Katoomba DEM) [H]. */
  projRateEstimate: 0.3,
  /** Extra corrections switch from V-cycles to fine-level smoothing once m_pre ≤ projSmoothMax·projTol [H]. */
  projSmoothMax: 10,
  /** Zebra sweeps of a smoothing correction and its assumed max-norm reduction (measured ≈ 0.25) [H]. */
  projSmoothSweeps: 2,
  projSmoothRate: 0.35,
  /**
   * [H, FireSim] Relaxation time (s) of the horizontal mean of (θ′ − θ′_cold-pool) on 50 m ASL bands toward zero.
   * The forecast θ_env already contains the area-mean diurnal warming/cooling; without this control the injected
   * surface flux would double count it and the domain would drift away from the forecast column (spurious
   * boundary inflow). Horizontal contrasts at a given height (which drive slope and valley winds) are untouched.
   * 0 disables it.
   */
  meanThetaTauS: 1800,
  /**
   * [H, FireSim] Buoyancy from θ′ minus the positive part of the band mean of (θ′ − θ′_cold-pool) (atmosphere.ts step 2;
   * the band means are recomputed before the buoyancy, and bandMeans() runs again for Davies/mean control): the uniform
   * part of the surface warming is the forecast's, and its buoyancy drove spurious domain-scale inflow (flat terrain,
   * 500 W/m²: U10_fire 2.5× the forecast after 2 h). false = b = gθ′/θ_env as written in §8.4.
   */
  buoyancyBandAnomaly: true,
  meanThetaBandM: 50,
  /** Vorticity confinement ε (visual only, never fed to ROS) — 0 by spec. */
  vorticityConfinement: 0,

  // ── §8.6 surface heating and slope flows ─────────────────────────────────────────────────────────
  /** Albedo by fuel type [V WindNinja cellDiurnal: 0.25 grass/brush, 0.10 trees; H for the rest]. */
  albedo: {
    [FuelType.NonFuel]: 0.2,
    [FuelType.Water]: 0.06,
    [FuelType.Grassland]: 0.25,
    [FuelType.GrassyWoodland]: 0.25,
    [FuelType.DryForestShrubby]: 0.1,
    [FuelType.DryForestGrassy]: 0.1,
    [FuelType.WetForest]: 0.1,
    [FuelType.Rainforest]: 0.1,
    [FuelType.Heath]: 0.25,
    [FuelType.AlpineHeathGrass]: 0.25,
    [FuelType.SnowGumWoodland]: 0.1,
    [FuelType.PinePlantation]: 0.1,
    [FuelType.Urban]: 0.2,
  } as Record<FuelType, number>,
  /** Albedo of fuel types missing from the table [H]. */
  albedoDefault: 0.15,
  /** Floor on cos β in the per-horizontal-area column flux Q_h,k/cos β_k (cliff cells) [H]. */
  minCosSlope: 0.2,
  /** Q* = [(1 − A)Q_sw + c1·T⁶ − σT⁴ + c2·N]/(1 + c3) [V cellDiurnal.cpp]. */
  qStarC1: 5.31e-13,
  qStarC2: 60,
  qStarC3: 0.12,
  /** Ground heat fraction c_g [V]. */
  groundHeatFrac: 0.15,
  /** Bowen ratio B = bowenBase + bowenDrought·smoothstep(k0, k1, KBDI) [H §8.6, §16 item 23]. */
  bowenBase: 1,
  bowenDrought: 3,
  bowenKbdi0: 50,
  bowenKbdi1: 150,
  /** Slope flow (C_d + E): upslope 0.2 + 0.2, downslope 1e-4 + 0.01 [V cellDiurnal compute_S]. */
  slopeUpCdE: 0.4,
  slopeDownCdE: 0.0101,
  /** L_e = slopeLeCoef·Δz_d/(C_d + E)_down [V]. */
  slopeLeCoef: 0.05,
  /** S_top cap (m/s) [H]. */
  slopeFlowCap: 3,
  /** Daytime top-up offset (m/s): SF already contains typical anabatic flow [H §16 item 14]. */
  anabaticOffset: 1.5,
  /** Fade of the slope-flow top-up with U_ridge,median (m/s) [H doc 02 §2.3]. */
  slopeFade0: 3,
  slopeFade1: 8,

  // ── §8.7 fire heat ───────────────────────────────────────────────────────────────────────────────
  /** Convective fraction χ_c (D27). */
  chiC: 0.85,
  /** Fire heat e-folding α_g = max(fireAlphaMin, Δz₁) (m) [V WRF]. */
  fireAlphaMin: 50,
  /** Canopy-heat decay above H_o,eff (m). */
  crownDecay: 50,
  /** Canopy-heat injection height when H_o,eff is missing (m) [H]. */
  crownHeightDefault: 20,
  /** Fire heat is deposited up to this height AGL (the e-folding profile is < 1e-17 of Q above it) [D]. */
  fireHeatTopAGL: 3000,
  /** Smoke decay (s) [H]. */
  smokeTauS: 10800,
  /** Smoke source scale (arbitrary units per J/m²) [H, display only]. */
  smokePerJ: 1e-7,

  // ── §8.8 wind for the fire ───────────────────────────────────────────────────────────────────────
  zRefMin: 50,
  zRefCanopyAdd: 20,
  /** m_f = clamp(1 − d_fire/max(2·z_plume, fireMaskMin), 0, 1). */
  fireMaskMin: 500,
  plumeTopDefault: 1000,
  /** Lee-eddy reversed wind fraction of U_ridge in the §7.9 separation blend (D25) [H]. */
  leeEddyFraction: 0.3,
  /** Fast-tier night decoupling U_bg10·[1 − c·sn·(1 − w_night)] [H]. */
  nightDecouple: 0.7,
  /** Pyrogenic potential [H, UNVERIFIED Hilton constant, §16 item 13]. */
  pyroK: 6e-4,
  pyroMax: 5,
  pyroIntervalS: 60,
  /** Plume response time (s): the pyrogenic source is the heat flux smoothed exponentially over it [H, see
   *  DiagnosticWind.addFireHeat; spec §8.8 uses the instantaneous q]. */
  pyroSourceTauS: 300,
  /** Head-correction fallback without a head mask: cells with |U_bg10| above this (m/s) count as head cells [H]. */
  pyroHeadMinWind: 0.1,
  /**
   * With a head mask (FireWindContext headMask/headDirX/headDirY; sim passes the fire's prepared cells and their
   * outward front normal n̂): keep only the component of u_p along the given direction, u_p ← max(0, u_p·n̂)·n̂, instead
   * of the spec's "remove the opposing component" [H, deviation from §8.8 / D32]. The empirical spread rates (Mk2 wind
   * and slope factors, ellipse) already contain the fire's own near-field indraft, which at a narrow head also
   * converges from the sides: a lateral u_p of 0.1–0.2 m/s turned a calm or anabatic upslope head wind by ~60° and
   * switched the §7.3 hybrid rule from R_w·SF(θ) to the additive cross-slope branch. false = the spec rule.
   */
  pyroHeadAlongOnly: true,
  /**
   * 3-D tiers: at the head cells sim passes (FireWindContext headMask/headDirX/headDirY, SIM_PARAMS
   * resolvedHeadMinDirection) remove the component of U_fireInd along the outward front normal, both signs [H,
   * extension of D32 to the resolved fire wind]: the empirical head ROS already contains the near-field indraft and
   * the resolved convergence at Δx_a ≥ 130 m sits downwind of the front (V22 standard tier: +66 % head ROS). false =
   * the spec (U_fire = U_dyn at the front with c_f 1).
   */
  resolvedHeadCorrection: true,

  // ── §8.10 diagnostics ────────────────────────────────────────────────────────────────────────────
  inversionPresentK: 3,
  /** Valley columns: z_s − z_floor,col below this (m) [H]. */
  valleyColumnMaxHav: 50,
  /** 1-D plume (MTT, bent-over) [K MTT; α, β H]. */
  plumeAlpha: 0.1,
  plumeBeta: 0.5,
  plumeDz: 20,
  plumeB0Min: 30,
  plumeW0Min: 1,
  plumeWStop: 0.1,
  plumeCap: 16000,
  /** Reference air density (kg/m³) of the similarity w* and the break-ETA heat deficit [K]. */
  rhoRef: 1.1,
  /** Minimum inversion depth (m) integrated by the break-ETA heat deficit [H]. */
  breakMinDepth: 50,
  /** Parcel-method mixed-layer top: first height where θ exceeds θ(z₁) by this (K) [K]. */
  mixedLayerParcelK: 0.5,
  /** Profile extensions below/above the model levels: dθ/dz clamped to [0 (or the synthetic lapse), max] (K/m);
   *  humidity above the top sample scaled by topHumidityFactor [H]. */
  profileGradMax: 0.01,
  topHumidityFactor: 0.1,
  /** PFT (P2, model/preset upper air only): enabled flag (default off, §0.4) and coefficient [UNVERIFIED, §16]. */
  pftEnabled: false,
  pftCoef: 0.3,
  /** Synthetic humidity above the mixed layer (%) [H §8.10]. */
  synthRhAbove: 30,
  /** Similarity turbulence: z_i by day = BLH ?? 1500 m, 200 m at night [H §8.9]. */
  nightZi: 200,
} as const;

export type AtmosParams = typeof ATMOS_PARAMS;
