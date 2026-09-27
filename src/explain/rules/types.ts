/**
 * Insight rule contract (spec §10.1): one registry entry per InsightKind with its detector, text template,
 * persistence (detector cycles before a card is shown) and cool-down. `detect(s, ctx?)` accepts the engine's shared
 * per-cycle context; called with the view alone it builds a stand-alone context (tests, tools).
 */
import type { InsightKind, InsightSeverity, SimStateView } from '../../core/types';
import { standaloneContext, type CycleContext, type EngineMemory } from '../context';
import { EXPLAIN_PARAMS } from '../params';
import { CARD_TEXT, type Candidate, type CardText } from '../text';

export interface InsightRule {
  kind: InsightKind;
  priority: 'P0' | 'P1' | 'P2';
  /** Cycles with score ≥ 1 before the card is shown (default 2). */
  persistence: number;
  /** Cool-down (s) after the card turns off (default 900). */
  cooldown: number;
  /** [H] kind-level duplicate suppression radius (m); 0 = keys only. */
  dedupRadiusM: number;
  detect(s: SimStateView, ctx?: CycleContext): Candidate[];
  render(c: Candidate): CardText;
  /** Called when a candidate of this rule is shown (daily cards record their day). */
  onShown?(c: Candidate, mem: EngineMemory): void;
}

export type DetectFn = (ctx: CycleContext) => Candidate[];

export const SEV_RANK: Record<InsightSeverity, number> = { info: 0, watch: 1, danger: 2 };

/** Build a rule from a context-based detector. */
export function makeRule(
  kind: InsightKind,
  detect: DetectFn,
  opts: Partial<Pick<InsightRule, 'priority' | 'persistence' | 'cooldown' | 'dedupRadiusM' | 'onShown'>> = {},
): InsightRule {
  const E = EXPLAIN_PARAMS.engine;
  const rule: InsightRule = {
    kind,
    priority: opts.priority ?? 'P0',
    persistence: opts.persistence ?? E.persistence,
    cooldown: opts.cooldown ?? E.cooldownS,
    dedupRadiusM: opts.dedupRadiusM ?? E.dedupRadiusM,
    detect: (s, ctx) => detect(ctx ?? standaloneContext(s)),
    render: (c) => CARD_TEXT[kind](c),
  };
  if (opts.onShown) rule.onShown = opts.onShown;
  return rule;
}

/** Candidate helper. */
export function cand(key: string, x: number, y: number, score: number, severity: InsightSeverity, values: Candidate['values']): Candidate {
  return { key, x, y, score, severity, values };
}

/** Keep, per key, the candidate with the higher severity (then score). */
export function mergeByKey(list: Candidate[]): Candidate[] {
  const m = new Map<string, Candidate>();
  for (const c of list) {
    const o = m.get(c.key);
    if (!o || SEV_RANK[c.severity] > SEV_RANK[o.severity] || (c.severity === o.severity && c.score > o.score)) m.set(c.key, c);
  }
  return [...m.values()];
}
