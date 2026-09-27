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
  /** Crest / lee-separation sector width (deg), as fire/ and atmosphere/ use it. */
  sectorDeg: 22.5,
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
  /** Head cells for N_c: front cells with aux.direction ≥ this. */
  headDirection: 0.8,
  // ── snapshots ──
  /** Maximum cells (nx·ny·nz) of the atmosphere view in a snapshot; larger views are decimated horizontally ×2. */
  atmosViewMaxCells: 150000,
  // ── worker (§12.1) ──
  /** Wall-time budget of one run chunk (ms) before yielding to the message queue. */
  chunkMs: 40,
  /** Minimum wall time (ms) between 'status' progress messages while running. */
  statusIntervalMs: 250,
});

export type SimParams = typeof SIM_PARAMS;
