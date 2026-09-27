/**
 * Terrain module: derived terrain fields (slope, aspect, TPI, curvature, landforms), solar geometry,
 * insolation with terrain shading and sky-view factor, and hillshading. See docs/ARCHITECTURE.md (terrain/).
 */
export {
  buildTerrain,
  terrainDerived,
  directionalSlopeDeg,
  upslopeAzimuth,
  hessianAt,
  valleyAxisAzimuth,
  downValleyAzimuth,
  reliefStats,
  slidingMinMax,
  windShelter,
  compassPoint,
  aspectName,
  LANDFORM_NAMES,
  DEFAULT_LANDFORM_THRESHOLDS,
  FLAT_SLOPE_DEG,
  TPI_RADIUS_M,
  TPI_SMALL_RADIUS_M,
  CURVATURE_SMOOTH_RADIUS_M,
  CRITICAL_POINT_SMOOTH_RADIUS_M,
  RELATIVE_POSITION_RADIUS_M,
} from './analysis';
export type { BuildTerrainOptions, LandformThresholds, TerrainDerived, HessianInfo, ReliefStats, ReliefClass } from './analysis';
export {
  solarPosition,
  sunTimes,
  airMass,
  extraterrestrial,
  clearSkyGhiHaurwitz,
  clearSkyIrradiance,
  cloudAttenuation,
  erbsDecomposition,
  horizontalIrradiance,
  castShadows,
  skyViewFactor,
  insolation,
  dailyInsolation,
  SOLAR_CONSTANT,
} from './solar';
export type { SolarPosition, SunTimes, Irradiance, InsolationOptions, InsolationResult, DailyInsolation } from './solar';
export { hillshade, multiHillshade } from './hillshade';
export type { MultiHillshadeOptions } from './hillshade';
