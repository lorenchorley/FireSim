/**
 * What one session is expected to need in memory, worked out from the scenario a page sends (0.9.0 contract 4.2, item 3). The engine's
 * worker thread asks it when an `init` has been decoded and before the simulation is built: a scenario that does not fit in
 * `--max-session-mib` is refused with the engine error {@link TOO_BIG_MESSAGE} and nothing is allocated for it.
 *
 * The figure is the repository's own memory model of the engine (src/scenario/memoryModel.ts: bytes per fire cell, per column of the 3-D
 * air, per ember, for the checkpoints and the ring of them, measured from real `Simulation` allocations and checked against
 * `Simulation.memoryReport()` by its test), for the heaviest tier (a page can raise the tier after the start), with the ring of
 * checkpoints full, times {@link MODEL_MARGIN}, plus the scenario twice (the frame as it arrived and the arrays decoded from it, which
 * are alive together while it is decoded). It is an estimate that is meant to be above the truth, not a meter: it is made from what the
 * scenario says (the size of the message, the fire grid, the extent, the ember budget), once, at the start.
 */
import type { ScenarioData } from '../src/core/types';
import { atmosphereGrid, ENGINE_BYTES, RING_CHECKPOINT_GROWTH_BYTES } from '../src/scenario/memoryModel';
import { SIM_PARAMS } from '../src/sim/params';

/**
 * How far above the model the estimate is. The model is within a few per cent of a real session at 30 m and 20 m (lane H's runs, desktop/README.md,
 * "What it costs"), and below the plan's runs at 10 m (plan section 15e: a peak of 1.2 GB for 6 km and 1.9 GB over 9 km, whole processes with
 * their garbage after hours of a growing fire): 1.7 and 1.3 times what the model says for those grids plus the scenario twice. 2 puts the
 * estimate above all of them (sessionEstimate.test.ts).
 */
export const MODEL_MARGIN = 2;

/** What a scenario says about its size. All of these are claims of the page: a number that is not a positive finite one counts as 0. */
export interface SessionSize {
  /** Bytes of the message that carried the scenario. */
  frameBytes: number;
  /** Fire cells: the larger of the terrain grid and the fuel grid (the engine's arrays follow the grid, not the length of the message). */
  fireCells: number;
  /** Side of the domain (m): the air grid follows it (the claim, not the arrays: a short message cannot ask for a big air). */
  extentM: number;
  /** The ember budget (at least the tier default). */
  maxEmbers: number;
}

const count = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
const cellsOf = (grid: unknown): number => {
  const g = (grid ?? {}) as { nx?: unknown; ny?: unknown };
  return count(g.nx) * count(g.ny);
};

/** The size a decoded `init` scenario claims (never throws: whatever is not a scenario counts as nothing, and the engine will say what is wrong with it). */
export function sizeOfScenario(frameBytes: number, scenario: unknown): SessionSize {
  const s = (typeof scenario === 'object' && scenario !== null ? scenario : {}) as Partial<ScenarioData>;
  const claimed = count((s.options as { maxEmbers?: unknown } | undefined)?.maxEmbers);
  return {
    frameBytes: count(frameBytes),
    fireCells: Math.max(cellsOf(s.terrain?.grid), cellsOf(s.fuel?.grid)),
    extentM: count(s.extent),
    maxEmbers: Math.max(SIM_PARAMS.maxEmbersByTier.high, Math.floor(claimed)),
  };
}

/** Bytes a session with this size is expected to need at most (see the file header). */
export function estimateSessionBytes(size: SessionSize): number {
  const E = ENGINE_BYTES.high;
  const atm = atmosphereGrid(size.extentM, 'high');
  const part = (c: { perCell: number; perColumn: number; perEmber: number; fixed: number }): number => c.perCell * size.fireCells + c.perColumn * atm.columns + c.perEmber * size.maxEmbers + c.fixed;
  const engine = part(E.fire) + part(E.explain) + part(E.moisture) + part(E.fuel) + part(E.rasters) + part(E.atmosphere) + part(E.embers);
  const cp0 = part(E.checkpoint);
  const ring = Math.min(SIM_PARAMS.checkpointMaxBytes, SIM_PARAMS.checkpointRing * (cp0 + RING_CHECKPOINT_GROWTH_BYTES));
  return Math.round(MODEL_MARGIN * (engine + cp0 + ring) + 2 * size.frameBytes);
}

export interface SessionVerdict {
  ok: boolean;
  /** The estimate (bytes). */
  estimate: number;
  /** What was allowed (bytes). */
  limit: number;
}

/** Whether a scenario of this message size fits in `limitBytes` (no limit, or Infinity: always). */
export function checkSession(frameBytes: number, scenario: unknown, limitBytes: number | undefined): SessionVerdict {
  const estimate = estimateSessionBytes(sizeOfScenario(frameBytes, scenario));
  const limit = limitBytes ?? Infinity;
  return { ok: estimate <= limit, estimate, limit };
}
