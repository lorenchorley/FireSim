/**
 * embers/ — Lagrangian firebrands and spot fires (spec docs/research/00-synthesis.md §9).
 *
 * Entry point: `EmberModel` (§2.4 signature). Pure physics helpers (terminal velocities, Albini burnout, Briggs plume
 * rise, Schroeder P_ig, emission per unit front length) are exported for explain/ cards and the developer panel.
 */
export { EmberModel } from './EmberModel';
export type {
  EmberModelOptions,
  EmberEnvironment,
  EmberLandingEvent,
  EmberStatsExt,
  EmberInjection,
  TurbFn,
  LandingFn,
  IgniteFn,
  SourceClass,
} from './EmberModel';
export type { WindFn } from './plume';
export type { EmberCellFuel } from './fuelInfo';
export { EMBER_PARAMS, EMBER_CLASSES, emberParams } from './params';
export type { EmberParams, EmberClassParams, DeepPartial } from './params';
export {
  terminalVelocityPlate,
  terminalVelocityCylinder,
  albiniBurnoutTime,
  albiniFallHeight,
  burnoutFallCoefficient,
  fallIntegral,
  fallTime,
  lineBuoyancyFlux,
  convectiveNumber,
  briggsPlumeRise,
  ignitionProbability,
  barkEngagement,
  onsetRamp,
  emissionPerUnitLength,
} from './physics';
export type { BriggsRise } from './physics';
