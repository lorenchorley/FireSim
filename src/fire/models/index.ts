/**
 * fire/models — point fire behaviour models (spec docs/research/00-synthesis.md §6).
 *
 * Object API (explain/, UI, tests): {@link fireBehaviour} and the forced-model variants; kernel API (fire/spread hot
 * loop, allocation-free): {@link headRosKernel}, {@link intensityKernel}, {@link referenceFactors}; FBI and ratings:
 * {@link afdrsFbi} (AFDRS-parity path, D41), {@link fireDangerRating}; shape, spotting, slope factor and the model
 * building blocks. All [H]/UNVERIFIED parameters are in {@link FIRE_MODEL_PARAMS}.
 */
export { FIRE_MODEL_PARAMS, DEFAULT_FIRE_MODEL_OPTIONS, setFireModelOptions, getFireModelOptions, resetFireModelOptions } from './params';
export type { FireModelParams, FireModelOptions } from './params';
export {
  BYRAM, byramIntensity, powPos, slopeFactor, slopeFactorCapped, fuelAvailabilityMk2, wetForestC1, fuelAvailabilityWet, wetC1OutOfDomain,
  fuelAvailabilityAfdrs, flameHeightVesta, flameHeightShrub, flameHeightGrass, byramFlameLength,
} from './common';
export { vestaMk2Core, vestaMk2Eval, createMk2Out, mk2PhiM, understoreyHeight, mk2InRange, type Mk2Out } from './vestaMk2';
export { vesta2012Ros, vesta2012R0, vesta2012PhiM } from './vesta2012';
export { ffdi, mk5, legacyFfdiRating, type Mk5Result } from './mcarthur';
export { grassRos, grassWindRate, grassPhiM, grassPhiC, grassStateFromLoad } from './grass';
export { heathRos, heathRefitRos, heathRefitSI, heathV1Ros, heathV1Damping, heathWaf } from './heath';
export {
  pineCore, createPineOut, pineLitterMoisture, pineFoliarMoisture, pineCriticalIntensity, pineStandWind, pineActiveCrownRos, pineCfb,
  pineSurfaceFuel, type PineOut,
} from './pine';
export { lbForest, lbGrass, lengthToBreadth, ellipseCoefficients, createEllipseCoeffs, ellipseSupport, ellipseSupportCos, type EllipseCoeffs } from './shape';
export { spottingRaw, spottingEnvelope } from './spotting';
export {
  fbiFromMetric, fbiTableFor, fbiTables, ratingFromFbi, fireDangerRating, afdrsFbi, FBI_TABLES_FBITG, FBI_TABLES_PYROXL_2024,
  type FbiTable, type FbiTableId, type FireDangerRatingName, type AfdrsFbiOptions, type AfdrsFbiResult,
} from './fbi';
export { afdrsMoistureFor, setAfdrsMoistureProvider, type AfdrsMoistureFn } from './afdrsMoisture';
export {
  fuelRow, familyOf, moistureFamilyOf, classOverrides, genericCellParams, cellParamsFromRow, grassWafFor, registerFuelCatalogue,
  type ModelFuelRow, type ModelClassOverrides,
} from './fuelRef';
export {
  headRosKernel, createHeadKernelOut, intensityKernel, createIntensityOut, KernelInvalid, buildKernelCache, refreshKernelCache,
  headRosKernelCached, type HeadKernelOut, type IntensityOut, type KernelCellCache,
} from './kernel';
export { referenceFactors, createReferenceFactorsOut, FACTOR_REF_MOISTURE, FACTOR_REF_AVAILABILITY, type ReferenceFactorsOut } from './factors';
export {
  fireBehaviour, vestaMk2, grassland, heath, pine, heathModelSpread, vesta2012Behaviour, mcArthurMk5Behaviour, cellParamsFromInput,
  availabilityFor, defaultBehaviourInput, vestaFlameHeight,
} from './behaviour';
