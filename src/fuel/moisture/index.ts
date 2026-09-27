/**
 * fuel/moisture — dead fine fuel moisture, drought (KBDI, DF), fuel availability and ignition probability
 * (spec docs/research/00-synthesis.md §5). The stable-night state `stableNight()` itself lives in core/physics.ts.
 */
export { MoistureModel, type MoistureBreakdown, type MoistureCheckpoint } from './model';
export { MOISTURE_PARAMS, moistureParams, type MoistureParams } from './params';
export {
  afdrsMoisture,
  afdrsMoistureCode,
  forestPeriod,
  forestMoisture,
  wetForestMoisture,
  heathMc1,
  rainMemoryMc2,
  grassMoisture,
  pineMoisture,
  isAfdrsNight,
  isSummerHalf,
  familyCode,
  familyName,
  MFam,
} from './afdrs';
export {
  vanWagnerEd,
  vanWagnerEw,
  vanWagnerRate,
  referenceRate,
  timeLagRatio,
  relaxMoisture,
  beamTransmittance,
  diffuseTransmittance,
  longwaveCooling,
  litterWind,
  fuelTemperature,
  fuelHumidity,
  columnEmc,
  droughtDamping,
  gullyOffsetBase,
  gullyKbdiFade,
  interceptionCapacity,
  dryingClockRate,
  rainMemory,
  dewStore,
  dewTerm,
  ignitionProbability,
  type ColumnInput,
} from './fuelPhysics';
export { lapseRate, cellAir, coldPoolTerm, isThermalBelt, type AirForcing } from './air';
export {
  kbdiIncrement,
  kbdiPass,
  kbdiSeries,
  droughtXLimit,
  droughtFactorFromX,
  rainRecencyX,
  droughtFactor,
  droughtFactorNoble,
  kbdiFromDf,
  droughtState,
  KBDI_MAX,
  type DroughtState,
} from './drought';
export {
  fuelAvailabilityMk2,
  wetForestC1,
  fuelAvailabilityWet,
  wetForestValidated,
  faBlendWeight,
  cellAvailability,
  afdrsAvailability,
  AVAILABILITY_PARAMS,
} from './availability';
export { spinUpStableNight, integrateStableNight, stableNightInputAt, hoursSinceSunrise } from './night';
export { seriesWeatherAt, clearnessAt, rainBefore } from './weather';
export { localMoistureCellParams, MOISTURE_TYPE_DEFAULTS, type MoistureCellParams, type MoistureCellResolver } from './cellParams';
