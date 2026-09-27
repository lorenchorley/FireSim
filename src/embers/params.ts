/**
 * Ember (firebrand) model parameters — spec docs/research/00-synthesis.md §9 (normative), doc 06 §4 (evidence).
 *
 * Every FireSim heuristic ([H]) or UNVERIFIED value of the ember module lives here, as §0.1 requires, with its source
 * tag. Verified ([V]) and derived ([D]) constants that the spec hard-codes are also collected here (read-only) so the
 * developer panel can show them next to the tunable ones. Spec §16 item 11 lists the ember uncertainties: E0 has no
 * Australian calibration (spot counts are relative), the glowing multiplier, pile synergy, holdover rates, class
 * lifetimes and σ_ln are [A/H]; outputs that depend on them are labelled "model estimate".
 */
import type { EmberClass } from '../core/simTypes';

/** Class order used by every per-class array of the module (index = E-number − 1). */
export const EMBER_CLASSES: readonly EmberClass[] = Object.freeze(['flake', 'ribbon', 'leaf', 'twig', 'heavy']);
export const N_CLASSES = 5;
export const CLS_FLAKE = 0;
export const CLS_RIBBON = 1;
export const CLS_LEAF = 2;
export const CLS_TWIG = 3;
export const CLS_HEAVY = 4;

/** How a class chooses its launch height (§9.1 table). */
export type LaunchRule = 'bark' | 'ribbon' | 'canopy' | 'flame' | 'ground';

/** Per-class constants (§9.1 table). */
export interface EmberClassParams {
  /** Share of the cell's brands when the class is present; renormalised per cell over the classes present. */
  share: number;
  /** Terminal velocity at ρ_ref: 'lognormal' uses median/σ_ln with [min, max] truncation; 'uniform' uses [min, max]. */
  vt0: { kind: 'lognormal' | 'uniform'; median: number; sigmaLn: number; min: number; max: number };
  /** Flaming time τ_f (s): lognormal median / σ_ln (σ_ln 0 = fixed). */
  tauF: { median: number; sigmaLn: number };
  /**
   * Burnout time τ_b (s). 'lognormal' (median, σ_ln); 'ribbonMixture' (see `ribbonTauB`); 'fixed' (value);
   * 'albini' (τ_b = albiniK·v_t0, [D Albini, §9.6]).
   */
  tauB: { kind: 'lognormal' | 'ribbonMixture' | 'fixed' | 'albini'; median: number; sigmaLn: number };
  /** Importance-sampling proposal for τ_b (heavier tail, §9.1 [standard MC]); null = sample the nature distribution. */
  /** lognormal: p1 = median, p2 = σ_ln; logUniform: p1 = min, p2 = max (s). Proposal = (1 − mix)·nature + mix·component. */
  proposal: null | { mix: number; kind: 'lognormal' | 'logUniform'; p1: number; p2: number };
  launch: LaunchRule;
  /** Fall-speed exponent n in v_t = v_t0·(m/m0)^n (§9.1): 1/2 plates, 1/4 cylinders, 1 Albini twig. */
  n: number;
  /**
   * Floor of v_t as a fraction of v_t0 (§9.3: 0.3). E4 uses 0: with n = 1 the floor would make the E4 fall height
   * 0.545·v_t0·τ_b instead of Albini's z_b = v_t0·τ_b/2 that §9.6/§9.7 require [D; deviation, see EmberModel.ts header].
   */
  vtFloor: number;
  /** Re-flame hazard while glowing (s⁻¹): E1 0.005 [A doc 06 eq 8], others 0. */
  reflameRate: number;
}

/** Tunable ember parameters. */
export interface EmberParams {
  emission: {
    /** E0 (s⁻¹ m⁻¹ (MW/m)⁻¹) [H, UNVERIFIED; range 1e-7…1e-4] — calibrated to 5–50 spots/km/h on the reference day. */
    e0: number;
    /** User "ember density" slider (multiplies E0) [H doc 06 §4.10]. */
    densityScale: number;
    /** B(BH) = barkBase^(BH − barkRef) [V ×3 per score 2→3 (Vesta); A extrapolation]. */
    barkBase: number;
    barkRef: number;
    /** Loose-bark height h_bark (m) of e_k = clamp((FH − 1)/(h_bark − 1), 0, 1) [A doc 06 §4.2]. */
    hBark: number;
    /** Onset ramp g(I) = clamp((I − i0)/(i1 − i0), 0, 1) (kW/m) [A anchored to V "spotting commences 500–2000 kW/m"]. */
    onsetI0: number;
    onsetI1: number;
    /** Emission multiplier of E1–E4 in an active VLS zone [H doc 06 §4.5: 2–3]. */
    vlsBoost: number;
    /** E2 requires barkHazard ≥ this [V AFDRS long-range flag BH ≥ 3]. */
    ribbonMinBh: number;
    /** Treat barkClass 'mixed' as containing both stringybark and ribbon species [H]. */
    mixedIsStringy: boolean;
    mixedIsRibbon: boolean;
    /** Floor on R_k in the Δx²/R_k share (m/s) [§9.2]. */
    rosFloor: number;
    /** Cells emit while t − tArr < flamingWindow·τ_f [§9.2, §7.5]. */
    flamingWindow: number;
    /** E3 leaves only when FH > leafFhFrac·H_o,eff; E2 crown launch when FH > this or I > ribbonCrownI [§9.1]. */
    leafFhFrac: number;
    ribbonCrownI: number;
    /** Crown base as a fraction of H_o,eff for the E2 crown launch [H: spec gives no crown base]. */
    crownBaseFrac: number;
    /** E5 heavy launch height (m) [§9.1]. */
    heavyLaunch: number;
  };
  weights: {
    /** Share of maxEmbers the class populations aim for [§9.2: 0.8]. */
    budgetFraction: number;
    /** Minimum super-particle weight [§9.2: 1e-3]. */
    wMin: number;
    /** Time constant of the class emission-rate EMA n̄_c (s) [§9.2: 300]; bias-corrected (see EmberModel.ts header). */
    rateTau: number;
    /**
     * τ̄_c: the spec uses the class median τ_b; FireSim tracks the mean slot residence of removed particles (EMA with
     * this time constant, s) so populations meet the budget whatever the landing/burnout mix [H; deviation].
     */
    lifeTau: number;
    /** Pseudo-count of the τ̄_c prior (the proposal mean τ_b) in the residence EMA [H]. */
    lifePriorCount: number;
    /** τ̄_c floor = max(lifeFloorFrac·median τ_b, lifeFloorAbs): bounds particle throughput of quick-landing classes [H]. */
    lifeFloorFrac: number;
    lifeFloorAbs: number;
  };
  transport: {
    /** Δt_e = clamp(cfl·min(Δz_local/|w_rel|, Δx_a/|u_h|), dtMin, dtMax) [§9.3]. */
    cfl: number;
    dtMin: number;
    dtMax: number;
    /** Δz_local = max(dz1, dzGrowth·z_AGL) (stretched atmosphere levels) [H]. */
    dzGrowth: number;
    /** Sub-grid plume w_sg = C_w·F_L^{1/3}·exp(−(z − z0)/z_d)·φ [§9.3, A doc 06 eq 11]. */
    cw: number;
    zd: number;
    /** χ_c convective fraction for the plume flux and Briggs [D27]. */
    chi: number;
    /** In-plume turbulence σ_w = α_p·w_plume (α_p 0.25; 0.4 in active VLS zones) [A doc 06 §3.8/§4.5]. */
    alphaP: number;
    alphaPVls: number;
    /** Plume field: vertical level spacing (m), vertical extent (× z_d) [numerical]. */
    plumeDz: number;
    plumeDepthZd: number;
    /** Landing tolerance above the ground (m) [numerical: Float32 round-off at burnout-limited landings]. */
    landEps: number;
    /** Mean wind over the fall column relative to the current wind when no ambient profile is set [H]. */
    exitWindFrac: number;
  };
  turbulence: {
    /** Surface layer z < slFrac·z_i: σ_u,v,w = slSigma·u* [K Panofsky & Dutton 1984], T = clamp(0.5z/σ_w, tMin, tMax). */
    slFrac: number;
    slSigmaU: number;
    slSigmaV: number;
    slSigmaW: number;
    tMin: number;
    tMax: number;
    /** Daytime CBL: σ_w² = cblA·w*²(z/z_i)^{2/3}(1 − 0.8z/z_i)², σ_u = σ_v = cblH·w*, T = cblT·z_i/σ [K Lenschow 1980, Hanna 1982]. */
    cblA: number;
    cblH: number;
    cblT: number;
    /** Free-troposphere / residual σ (m/s) and T (s) above z_i or when all scalings vanish [H]. */
    sigmaFree: number;
    tFree: number;
    /** Stable (w* = 0) layer above the surface layer: surface σ × (1 − z/z_i)^stableExp [H, Nieuwstadt-type]. */
    stableExp: number;
    /** Crossing-trajectories β in T_eff = T/√(1 + (β·v_t/σ)²) [K Csanady 1963]. */
    beta: number;
  };
  loft: {
    /**
     * Fast tier: z_L = z_p·√ξ capped where C_w·F_L^{1/3}·exp(−z/L) ≤ v_t with L = capDecay·z_p (the plume updraft
     * falls to e^{−1/capDecay} of its source value at the plume top: 14 % for 0.5). The spec's L = z_d = 200 m would cap
     * every brand below ≈ 100–300 m (deviation, see EmberModel.ts header) [H]. 0 = use z_d as written.
     */
    capDecay: number;
    /** Rise speed floor as a fraction of C_w·F_L^{1/3} (keeps rise times finite near the cap) [H]. */
    riseFloor: number;
    /** Default N (s⁻¹) for Briggs when the atmosphere gives none [H: N = 0.01 ≈ 0.3 K/100 m]. */
    nDefault: number;
    /** Briggs plume top clamp (m AGL) [H]. */
    zpMin: number;
    zpMax: number;
    /** Wind height (fraction of z_p) at which U for Briggs is sampled [H]. */
    uHeightFrac: number;
    /** Time constant (s) of the fire-power EMA fed to Briggs (cells ignite in pulses of Δx/R; the plume integrates) [H]. */
    powerTau: number;
  };
  ignition: {
    /** d_ex = max(exclusionCells·Δx_f, rosLocal·exclusionTime) [A doc 06 §4.6]. */
    exclusionCells: number;
    exclusionTime: number;
    /** Glowing S_state = glowFactor·clamp(bedWind/bedWindRef, 0, 1) [A; range 0.1–0.5]. */
    glowFactor: number;
    bedWindRef: number;
    /** p ∝ (m/m0)^massExp [A]. */
    massExp: number;
    /** Pile synergy: ≥ pileMin real brands in a cell within pileWindow s → p·(1 + pileGain·min(n − 1, pileMaxN)) ≤ pMax [A]. */
    pileMin: number;
    pileWindow: number;
    pileGain: number;
    pileMaxN: number;
    pMax: number;
    /** Ignition delays (s) [A]. */
    delayFlaming: [number, number];
    delayGlowing: [number, number];
    /** Holdovers: share of glowing landings on cells with FHS_s ≥ holdoverFhs or HeavyFuel [A]. */
    holdoverShare: number;
    holdoverFhs: number;
    holdoverMaxAge: number;
    /** Conversion hazard (1/holdoverTime)·clamp((holdoverM0 − M)/holdoverDm, 0, 1) [A]. */
    holdoverTime: number;
    holdoverM0: number;
    holdoverDm: number;
    holdoverCheck: number;
    maxHoldovers: number;
    /** "Ignition-capable" landing: p ≥ this [§10.2 spotting card]. */
    capableP: number;
    /** Re-flamed E1 stays flaming for this long (s) before glowing again [H]. */
    reflameDuration: number;
    /** Ambient fuel moisture (%) and fuel temperature (°C) for beyond-edge brands when not set [H]. */
    ambientMoisture: number;
    ambientFuelTemp: number;
  };
  mountain: {
    /** Lee eddy on cells with s_sep ≥ sepMin, below eddyDepth·relief, toward eddyFraction·U_ridge upslope [§9.4, D25]. */
    sepMin: number;
    eddyDepth: number;
    eddyFraction: number;
    /** Fallback relief: local max − min within this radius (m) when sim gives none [H]. */
    reliefRadius: number;
    /** Fallback crest search for VLS crest launch: upwind march (m, step) [§7.9 analogue, H]. */
    crestSearch: number;
    /** Source class thresholds: TPI (m) for ridge / valley [H, BehavePlus location classes]. */
    tpiRidge: number;
    tpiValley: number;
  };
  stats: {
    /** Overlay decay τ (s) [§9.5: 10 min]; stats window bins (s) × count. */
    overlayTau: number;
    binSeconds: number;
    bins: number;
    /** Beyond-edge histogram: bin width (m) and count (to 30 km) [§2.2]. */
    edgeBinM: number;
    edgeBins: number;
  };
  classes: EmberClassParams[];
  /** E2 τ_b nature mixture [V morphology means 251/122/429 s (Hall 2015); σ_r, tail weight/range H]. */
  ribbonTauB: { means: number[]; sigmaLn: number; tailWeight: number; tailMin: number; tailMax: number };
  /** Albini τ_b = albiniK·v_t0 [D §9.6: 4C_d/(πKg) = 24.3 s per m/s]. */
  albiniK: number;
}

/** Albini burnout constant 4·C_d/(π·K·g) with C_d 1.2, K 0.0064, g 9.81 [V doc 06 eq 7 via FARSITE]. */
export const ALBINI_CD = 1.2;
export const ALBINI_K = 0.0064;

const DEFAULTS: EmberParams = {
  emission: {
    e0: 3e-6,
    densityScale: 1,
    barkBase: 3,
    barkRef: 2,
    hBark: 8,
    onsetI0: 500,
    onsetI1: 2000,
    vlsBoost: 2.5,
    ribbonMinBh: 3,
    mixedIsStringy: true,
    mixedIsRibbon: true,
    rosFloor: 0.01,
    flamingWindow: 3,
    leafFhFrac: 0.66,
    ribbonCrownI: 10000,
    crownBaseFrac: 0.5,
    heavyLaunch: 0.5,
  },
  weights: {
    budgetFraction: 0.8,
    wMin: 1e-3,
    rateTau: 300,
    lifeTau: 900,
    lifePriorCount: 50,
    lifeFloorFrac: 0.1,
    lifeFloorAbs: 20,
  },
  transport: {
    cfl: 0.4,
    dtMin: 0.5,
    dtMax: 5,
    dzGrowth: 0.2,
    cw: 1.5,
    zd: 200,
    chi: 0.85,
    alphaP: 0.25,
    alphaPVls: 0.4,
    plumeDz: 25,
    plumeDepthZd: 5,
    landEps: 0.02,
    exitWindFrac: 0.85,
  },
  turbulence: {
    slFrac: 0.1,
    slSigmaU: 2.4,
    slSigmaV: 1.9,
    slSigmaW: 1.25,
    tMin: 5,
    tMax: 60,
    cblA: 1.8,
    cblH: 0.6,
    cblT: 0.15,
    sigmaFree: 0.25,
    tFree: 60,
    stableExp: 0.75,
    beta: 1,
  },
  loft: {
    capDecay: 0.5,
    riseFloor: 0.25,
    nDefault: 0.01,
    zpMin: 30,
    zpMax: 9000,
    uHeightFrac: 0.5,
    powerTau: 120,
  },
  ignition: {
    exclusionCells: 2,
    exclusionTime: 180,
    glowFactor: 0.3,
    bedWindRef: 2,
    massExp: 0.25,
    pileMin: 3,
    pileWindow: 60,
    pileGain: 0.2,
    pileMaxN: 10,
    pMax: 0.95,
    delayFlaming: [5, 30],
    delayGlowing: [60, 600],
    holdoverShare: 0.02,
    holdoverFhs: 3,
    holdoverMaxAge: 86400,
    holdoverTime: 3600,
    holdoverM0: 10,
    holdoverDm: 5,
    holdoverCheck: 60,
    maxHoldovers: 500,
    capableP: 0.05,
    reflameDuration: 15,
    ambientMoisture: 8,
    ambientFuelTemp: 35,
  },
  mountain: {
    sepMin: 0.5,
    eddyDepth: 0.3,
    eddyFraction: 0.3,
    reliefRadius: 600,
    crestSearch: 600,
    tpiRidge: 15,
    tpiValley: -15,
  },
  stats: {
    overlayTau: 600,
    binSeconds: 60,
    bins: 10,
    edgeBinM: 1000,
    edgeBins: 30,
  },
  classes: [
    // E1 stringybark flake: v_t0 lognormal 4.5/0.15 clip 3–6, τ_f lognormal 30/0.5, τ_b lognormal 150/0.7 [A; σ_ln H]
    {
      share: 0.35,
      vt0: { kind: 'lognormal', median: 4.5, sigmaLn: 0.15, min: 3, max: 6 },
      tauF: { median: 30, sigmaLn: 0.5 },
      tauB: { kind: 'lognormal', median: 150, sigmaLn: 0.7 },
      proposal: { mix: 0.5, kind: 'lognormal', p1: 400, p2: 0.7 }, // [H] defensive mixture, heavier-tail component
      launch: 'bark',
      n: 0.5,
      vtFloor: 0.3,
      reflameRate: 0.005,
    },
    // E2 ribbon strip: v_t0 U(5.2, 5.8) [V], τ_f 60, τ_b mixture 251/122/429 s [V] + tail to 1500 s [A]
    {
      share: 0.3,
      vt0: { kind: 'uniform', median: 5.5, sigmaLn: 0, min: 5.2, max: 5.8 },
      tauF: { median: 60, sigmaLn: 0 },
      tauB: { kind: 'ribbonMixture', median: 0, sigmaLn: 0 },
      proposal: { mix: 0.5, kind: 'logUniform', p1: 100, p2: 1500 }, // [H]
      launch: 'ribbon',
      n: 0.25,
      vtFloor: 0.3,
      reflameRate: 0,
    },
    // E3 leaf: v_t0 U(1.5, 2.5) [D], τ_f 10, τ_b 25, launch H_o,eff
    {
      share: 0.15,
      vt0: { kind: 'uniform', median: 2, sigmaLn: 0, min: 1.5, max: 2.5 },
      tauF: { median: 10, sigmaLn: 0 },
      tauB: { kind: 'fixed', median: 25, sigmaLn: 0 },
      proposal: null,
      launch: 'canopy',
      n: 0.5,
      vtFloor: 0.3,
      reflameRate: 0,
    },
    // E4 twig: v_t0 U(4, 7) [D], τ_f 20, τ_b = 24.3·v_t0 [D Albini], launch U(0.5, 1)·FH, n = 1
    {
      share: 0.15,
      vt0: { kind: 'uniform', median: 5.5, sigmaLn: 0, min: 4, max: 7 },
      tauF: { median: 20, sigmaLn: 0 },
      tauB: { kind: 'albini', median: 0, sigmaLn: 0 },
      proposal: null,
      launch: 'flame',
      n: 1,
      vtFloor: 0,
      reflameRate: 0,
    },
    // E5 heavy: v_t0 U(8, 12), τ_f 60, τ_b 600, launch 0.5 m (hand-off to rolling debris)
    {
      share: 0.05,
      vt0: { kind: 'uniform', median: 10, sigmaLn: 0, min: 8, max: 12 },
      tauF: { median: 60, sigmaLn: 0 },
      tauB: { kind: 'fixed', median: 600, sigmaLn: 0 },
      proposal: null,
      launch: 'ground',
      n: 0.25,
      vtFloor: 0.3,
      reflameRate: 0,
    },
  ],
  ribbonTauB: { means: [251, 122, 429], sigmaLn: 0.35, tailWeight: 0.05, tailMin: 429, tailMax: 1500 },
  albiniK: (4 * ALBINI_CD) / (Math.PI * ALBINI_K * 9.81),
};

/** Default parameters (frozen at the top level; use `emberParams(overrides)` for a tuned copy). */
export const EMBER_PARAMS: Readonly<EmberParams> = Object.freeze(DEFAULTS);

/** Deep-merge partial overrides onto the defaults (arrays replaced wholesale). */
export function emberParams(over?: DeepPartial<EmberParams> | null): EmberParams {
  return merge(EMBER_PARAMS as unknown as Record<string, unknown>, (over ?? {}) as Record<string, unknown>) as unknown as EmberParams;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    const o = over[key];
    if (o === undefined) out[key] = clone(b);
    else if (isPlain(b) && isPlain(o)) out[key] = merge(b as Record<string, unknown>, o as Record<string, unknown>);
    else out[key] = clone(o);
  }
  return out;
}

function isPlain(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => clone(x)) as unknown as T;
  if (isPlain(v)) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = clone(x);
    return o as T;
  }
  return v;
}
