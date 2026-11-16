/**
 * The scenario construction of export.ts, kept in one module so that the browser worker bundle (harness/solver-worker.entry.ts, card T1.5 d) builds
 * exactly the same `ScenarioData` as the Node exporter does. Pure functions of the scenario definition: no file access, no process, no worker API
 * (the asset loader of `src/data/assets.ts` decides where the demo terrain comes from: `setNodePublicDir` under Node, `setAssetBase` in a browser).
 */
import type { Ignition, ScenarioData } from '../../../src/core/types';
import { resolveOptions } from '../../../src/scenario/build';
import { demoScenario, pointIgnition, withIgnitions } from '../../../src/sim/testing/scenarios';
import type { ScenarioDef } from './scenarios';

export function ignitionOf(d: ScenarioDef): Ignition {
  const g = d.ignition;
  if (g.kind === 'point') return pointIgnition(g.id, g.at[0], g.at[1], g.time, g.radius);
  return { id: g.id, kind: 'line', points: [g.from, g.to], time: g.time, origin: 'observed' };
}

/** The scenario of `d` with the given seed and snapshot cadence (what export.ts builds before any perturbation or noise). */
export async function buildScenarioData(d: ScenarioDef, seed: number, interval: number): Promise<ScenarioData> {
  const tierOnly = d.grid === 'tier-only';
  const base = await demoScenario({ ...(d.site ? { site: d.site } : {}), startCivil: d.startCivil, extent: d.extent, tier: tierOnly ? 'standard' : d.tier, duration: d.duration });
  let extra = {};
  if (tierOnly) {
    // The engine options the builder would resolve for this tier, with the fire cell left at the standard grid's.
    const o = resolveOptions({ options: { tier: d.tier } } as never, d.extent, base.options.fireCellSize);
    extra = { tier: d.tier, atmosCellSize: o.atmosCellSize, atmosLevels: o.atmosLevels, atmosDz1: o.atmosDz1, maxEmbers: o.maxEmbers };
  }
  return withIgnitions(base, [ignitionOf(d)], { snapshotInterval: interval, tier: d.tier, seed, ...extra, ...(d.options ?? {}) });
}
