/**
 * explain/ — insight detectors, insight cards and the "Why here?" cell explanation (spec
 * docs/research/00-synthesis.md §10; signatures §2.4).
 *
 * - `InsightEngine` (engine.ts): detector cadence, 500 m tile keys, per-key state machine, cool-downs, de-dup,
 *   severity ranking; `update`, `explainAt`, `forecastInsights`, `layers` (DMZ), `checkpoint`/`restore`.
 * - `INSIGHT_RULES` (registry.ts): one rule per InsightKind (detector + text + safety + source + badge + layers).
 * - Text library (text.ts): plain Australian English cards, every safety line ends with {@link DOCTRINE}.
 * - Forecast analysis (forecast.ts, §10.3), cell explanation (explainCell.ts, §10.4), safety overlays (safety.ts,
 *   §10.5: DMZ, refuge rule, Tobler).
 * - All [H]/UNVERIFIED thresholds: `EXPLAIN_PARAMS` (params.ts).
 *
 * Contract interpretations (see context.ts): SimStateView.time = seconds from the scenario start; aux.front = cell
 * indices; aux.frontNormalX/Y per cell or per front entry; aux.headIndex = cell index.
 */
export { InsightEngine, type InsightEngineOptions, type EngineCheckpoint } from './engine';
export { INSIGHT_RULES, INSIGHT_KINDS, RULE_LIST } from './registry';
export type { InsightRule } from './rules/types';
export type { Candidate, CardText } from './text';
export { CARD_TEXT, DOCTRINE, STEEP_NOTE, SUBGRID_NOTE, GENERAL_SUBS } from './text';
export { EXPLAIN_PARAMS, LEE_OF_DIVIDE, DIVIDE_LINE } from './params';
export {
  analyseSeries,
  buildForecastInsights,
  detectWindChanges,
  afternoonPeaks,
  cHaines,
  predictInversion,
  froudeFromLevels,
  foehnAloft,
  weatherAtMs,
  type WindChange,
  type AfternoonPeak,
  type ForecastAnalysis,
  type ForecastTerrain,
} from './forecast';
export { explainCell, factorShares, localFuelSummary, moistureReason, type ExplainOptions } from './explainCell';
export { toblerKmh, walkingSpeedKmh, refugeCheck, DmzComputer, type DmzRosFn, type DmzSpeeds, type DmzResult, type RefugeCheck } from './safety';
export { StaticMaps, distanceTransform, leeOfDivide } from './statics';
export { CycleContext, freshMemory, standaloneContext, type EngineMemory } from './context';
export { wilsonBreach } from './rules/fire';
