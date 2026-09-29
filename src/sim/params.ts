/**
 * Tunable constants of the orchestrator (spec docs/research/00-synthesis.md §3 cadences, §12.1 chunking, §12.4 ring,
 * §12.6 tiers and auto-tune). Every [H] value of sim/ lives here.
 */
import type { QualityTier } from '../core/types';

export const SIM_PARAMS = Object.freeze({
  // ── cadences (simulated seconds, §3) ──
  /** Insolation, surface heating, moisture update, fire moisture cache (and at t0). */
  solarIntervalS: 600,
  /** Fire masks (plus 22.5° wind-sector changes), minute tasks, detectors, atmosphere diagnostics. */
  minuteS: 60,
  /** Checkpoint interval (plus the permanent t0 checkpoint) and ring size (§12.4). */
  checkpointIntervalS: 1800,
  checkpointRing: 8,
  /**
   * Memory cap of the ring (bytes of typed arrays; the t0 checkpoint is not counted) [H]: large fires make a checkpoint
   * 10–15 MB, and §13 allows < 150 MB for the whole worker. When exceeded, the oldest ring entries are dropped (rewinds
   * further back then re-run from an earlier checkpoint or t0).
   */
  checkpointMaxBytes: 80e6,
  /** Crest / lee-separation sector width (deg), as fire/ and atmosphere/ use it. */
  sectorDeg: 22.5,
  /**
   * Fast tier only [H, deviation from the per-step §12.2 step 4]: the DiagnosticWind fire wind depends on the stamp
   * pair (hourly), the pyrogenic potential (re-solved every 60 s), the lee-separation mask (every 60 s) and the
   * stable-night state, so it is recomputed once per this interval (in the step after each pyrogenic solve) and
   * whenever a stamp, wind edit, option, tier or restore changes its inputs. 0 = every step.
   */
  fastWindIntervalS: 60,
  // ── atmosphere step (§12.2) ──
  /** Δt_a upper bound (s) for the 3-D tiers; the fast tier uses its own fixed maxStableDt() (10 s). */
  dtMaxS: 12,
  /** 3-D spin-up before t0 with the t0 ambient (s). */
  spinUpS: 900,
  // ── auto-tune (§12.6) ──
  /** Number of timed standard-tier spin-up steps. */
  autoTuneSteps: 20,
  /** T_pred = overhead · t_step · duration / stepS. */
  autoTuneOverhead: 1.4,
  autoTuneStepS: 10,
  /** budget = max(minBudgetS, budgetS · duration / budgetRefS). */
  autoTuneBudgetS: 120,
  autoTuneBudgetRefS: 6 * 3600,
  autoTuneMinBudgetS: 30,
  // ── embers (§12.6 tier table) ──
  maxEmbersByTier: { fast: 2000, standard: 4000, high: 4000 } as Readonly<Record<QualityTier, number>>,
  /** Block size (fire cells) of the front-ROS raster used for the landing callback's rosLocal (exclusion zone) [H]. */
  frontRosBlock: 8,
  // ── stats (§12.3) ──
  /** Head = the front cell of max arrival ROS among cells that arrived within this window (s) [H]; else all front. */
  headWindowS: 900,
  /** Moisture mean over unburnt burnable cells within this distance of the front (m). */
  moistureMeanRadiusM: 2000,
  /** Convective number smoothing half-width (cells): 5-cell window = ±2. */
  ncHalfWidth: 2,
  /**
   * Ember loft in every tier [H, deviation from §9.3 for the 3-D tiers]: 'briggs' = the fast tier's kinematic loft to
   * z_L = z_p·√ξ along the tilted plume axis, then transport through the tier's wind (3-D: the resolved wind, including
   * the resolved plume). With the spec's sub-grid plume ('auto' → 'plume' in 3-D tiers: w_sg decaying over z_d = 200 m
   * within Δx_a of a straight axis) the resolved updraft at Δx_a 100–270 m (1–7 m/s) could not carry the brands: the
   * coupled V9 set-up (flat, FFDI 25/50/100) gave standard-tier P95 spot distances of 0.2–0.4 × Mk5 S (fast tier
   * 0.6–1.8 ×); with 'briggs' both tiers give 0.7–1.7 ×. 'auto' = the spec.
   */
  emberLoft: 'briggs' as 'auto' | 'briggs',
  /** Head cells for N_c: front cells with aux.direction ≥ this. */
  headDirection: 0.8,
  /**
   * Fast-tier pyrogenic correction (§8.8, D32) [H, deviation]: the cells passed to the atmosphere as "head cells" are
   * the prepared cells whose ellipse speed along the local front normal is ≥ this fraction of R_H, and there u_p keeps
   * only its component along the outward front normal (atmosphere `pyroHeadAlongOnly`). The spec's 0.8 (head only)
   * leaves the fire's own indraft on the shoulders, flanks and back, where the empirical rates (Mk2 ellipse, SF) already
   * contain it: on a calm 30° slope with anabatic wind the narrowed head lost 25 % of its ROS with coupling 1, a calm
   * 20° slope backed 12 % faster, and a V-shaped pocket closed 30 % faster from self-indraft alone. 0 = every prepared
   * cell: a single fire spreads as uncoupled (V1, V22), and u_p still acts where it pushes a front outward (toward
   * another fire: junction pockets, merging spots). The fire-induced wind at burning cells (cards, "Why here?") is
   * unchanged.
   */
  pyroCorrectionMinDirection: 0,
  /**
   * 3-D tiers: head cells of the resolved head correction (atmosphere `resolvedHeadCorrection`) = prepared cells whose
   * ellipse speed along the local front normal is ≥ this fraction of R_H (the spec's head, as `headDirection`), so the
   * resolved indraft still acts on the flanks and back [H].
   */
  resolvedHeadMinDirection: 0.8,
  // ── snapshots ──
  /** Maximum cells (nx·ny·nz) of the atmosphere view in a snapshot; larger views are decimated horizontally ×2. */
  atmosViewMaxCells: 150000,
  /**
   * Cadence (s) of the UI's full pictures ("keyframes": moisture, overlay rasters, atmosphere view). Snapshot coalescing
   * always keeps the first snapshot of every such window; the UI's history keeps a full picture per window and light
   * frames in between (the fire is reconstructed exactly from the newest arrival times).
   */
  keyframeIntervalS: 300,
  /** Coalescing: at most one cadence snapshot per this many wall-clock ms (~25 per second) when the worker runs fast. */
  snapshotMinWallMs: 40,
  // ── worker (§12.1) ──
  /** Wall-time budget of one run chunk (ms) before yielding to the message queue. */
  chunkMs: 40,
  /** Minimum wall time (ms) between 'status' progress messages while running. */
  statusIntervalMs: 250,
});

export type SimParams = typeof SIM_PARAMS;
