/**
 * fuel/ — fuel-type catalogue, SVTM vegetation mapping, vegetation inference, NPWS fire history, fuel accumulation,
 * hazard ↔ load conversions, the fire-grid fuel map and fuel edits (spec docs/research/00-synthesis.md §4).
 * The dead-fuel moisture and drought code lives in fuel/moisture (separate module).
 */
export { FUEL_PARAMS, resolveFuelParams, YEAR_MS, DAY_MS, type FuelParams } from './params';
export {
  FUEL_TYPES,
  FUEL_CLASSES,
  FUEL_CLASS_COUNT,
  CLASS_INFER,
  resolveClass,
  genericClassOf,
  fuelColour,
  tfiMinYears,
  type ResolvedFuelClass,
} from './catalogue';
export {
  OFHAG_RATINGS,
  fhsFromRating,
  loadFromFhs,
  fhsFromLoad,
  barkHazardFromLoad,
  loadFromLitterDepthMm,
  ratingFromFhs,
  type HazardLayer,
  type OfhagRating,
} from './hazard';
export { svtmToClass, parseVegetation, rasteriseVegetation, SVTM_SOURCE, type VegetationRaster } from './svtm';
export { inferFuelTypes, inferCell, southernAspect, type CanopyInput } from './infer';
export {
  parseFireHistory,
  parseFireHistoryWithMeta,
  rasteriseFireHistory,
  selectFires,
  inclusionAt,
  burnTime,
  aestTime,
  addDays,
  seasonMid,
  countShortIntervals,
  emptyHistory,
  FIRE_KIND_USER_BURN,
  type HistoryRaster,
  type ParsedFireHistory,
  type InclusionStatus,
  type IncludedFires,
  type RasteriseHistoryOptions,
} from './history';
export {
  olson,
  evolve,
  accumulate,
  postFireEligible,
  postFireWeight,
  makeCellHistory,
  loadCellHistory,
  syntheticCellHistory,
  makeFuelState,
  type CellHistory,
  type FuelState,
} from './accumulation';
export {
  buildFuelMap,
  fuelParamsAt,
  fuelParamsInto,
  makeCellFuelParams,
  fuelSummary,
  cloneFuelMap,
  faBlendWeight,
  grassStateFromLoad,
  curingFor,
  canopyHeightEffFor,
  classMoistureOffset,
  CTX_CHM_VALID,
  CTX_RIDGE,
  CTX_HIGH_ELEV,
  CTX_CLIFF,
  CTX_INFERRED,
  CTX_MINORITY_WET,
  type BuildFuelArgs,
  type FuelBuildContext,
  type FuelMapExt,
} from './fuelMap';
export { applyFuelEdit, cellsInBrush, brushContains } from './edits';
export { buildDemoFuel, type DemoFuel, type DemoFuelOptions } from './demo';
export { ScanlineRasteriser, projectRings, pointInRings, cellCentreLattice, subPointLattice, type Lattice, type LocalRings } from './polygon';
