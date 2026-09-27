/**
 * The one card registry (spec §10.1–§10.2, D33): `INSIGHT_RULES: Record<InsightKind, InsightRule>` — a detector,
 * text template (with safety line, source, confidence badge and "Show me" layers), persistence and cool-down for
 * every InsightKind of src/core/types.ts.
 */
import type { InsightKind } from '../core/types';
import { FIRE_RULES } from './rules/fire';
import { GENERAL_RULES } from './rules/general';
import { TERRAIN_RULES } from './rules/terrain';
import type { InsightRule } from './rules/types';
import { WEATHER_RULES } from './rules/weather';

/** Every InsightKind, in the order of the contract union (also the engine's deterministic rule order). */
export const INSIGHT_KINDS: readonly InsightKind[] = Object.freeze([
  'upslope-run',
  'downslope-backing',
  'gully-chimney',
  'eruptive-slope',
  'ridge-crest',
  'lee-slope-eddy',
  'vorticity-lateral-spread',
  'saddle-channelling',
  'valley-channelling',
  'ridge-speed-up',
  'spotting',
  'spot-fire',
  'mass-spotting',
  'junction-zone',
  'wind-change',
  'dead-man-zone',
  'plume-dominated',
  'pyroconvection-risk',
  'fire-induced-wind',
  'anabatic-wind',
  'katabatic-wind',
  'thermal-belt',
  'inversion-break',
  'aspect-dry-fuel',
  'moist-gully',
  'heavy-fuel',
  'recent-burn',
  'crown-fire',
  'high-drought',
  'night-slowdown',
  'afternoon-peak',
  'fuel-break-breached',
  'rolling-debris',
  'general',
] as const);

function buildRegistry(): Record<InsightKind, InsightRule> {
  const all = [...TERRAIN_RULES, ...FIRE_RULES, ...WEATHER_RULES, ...GENERAL_RULES];
  const reg = {} as Record<InsightKind, InsightRule>;
  for (const r of all) {
    if (reg[r.kind]) throw new Error(`duplicate insight rule ${r.kind}`);
    reg[r.kind] = r;
  }
  for (const k of INSIGHT_KINDS) if (!reg[k]) throw new Error(`missing insight rule ${k}`);
  return Object.freeze(reg) as Record<InsightKind, InsightRule>;
}

export const INSIGHT_RULES: Record<InsightKind, InsightRule> = buildRegistry();

/** Rules in registry order. */
export const RULE_LIST: readonly InsightRule[] = INSIGHT_KINDS.map((k) => INSIGHT_RULES[k]);
