/**
 * fire/spread — level-set fire spread, mountain phenomena and spread-driver attribution
 * (spec docs/research/00-synthesis.md §7; module signature §2.4).
 *
 * {@link FireSpreadModel} is the sim-facing class; {@link LevelSetCore} the numerics (§7.2); the pure functions of
 * `math.ts` implement §7.3–§7.10 and are exported for explain/ and tests; every [H]/UNVERIFIED parameter is in
 * {@link SPREAD_PARAMS}.
 */
export { FireSpreadModel, type FireSpreadCheckpoint, type DebrisTrajectory, type DebrisIgnition, type BreachEvent } from './FireSpreadModel';
export { LevelSetCore, type LevelSetHooks } from './levelSet';
export { SPREAD_PARAMS, resolveSpreadParams, type SpreadParams, type SpreadParamsOverride } from './params';
export { attributeDriver, createAttributionInput, type AttributionInput } from './attribution';
export {
  slopeFactor, hybridHead, hybridHeadDeg, finishHybrid, createHybridOut, gullySteer, ellipseSpeeds, createEllipseSpeedsOut, offsetEllipseSpeed, cflBoundDt,
  logisticS, alignmentWeight, attachmentScore, amplifierGain, relaxEngagement, buildFraction, lineIgnitionOrigin, leeAlignment, vlsScore, leeSeparation,
  vlsLateralRate, junctionGeometric, junctionBoost, breachProbability, byramConvectiveNumber, azimuthOf, angleBetweenDeg,
  type HybridOut, type EllipseSpeedsOut,
} from './math';
export { DistanceTransform, labelComponents4, distToPolyline, signedDistToPolygon, pointInPolygon, polylineLength } from './geometry';
