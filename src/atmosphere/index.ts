/**
 * atmosphere/ — background wind, 3-D solver, thermal flows and the wind for the fire (spec
 * docs/research/00-synthesis.md §8; tiers §12.6; budgets §13).
 *
 *   Atmosphere      standard/high tiers: dry Boussinesq on a terrain-following MAC grid (§8.1, §8.4, §8.5), surface
 *                   heating (§8.6), fire heat (§8.7), fire wind with κ, m_f and c_f (§8.8), diagnostics (§8.10).
 *   DiagnosticWind  fast tier: mass-consistent u_bg per stamp, night decoupling, slope flows, lee separation,
 *                   pyrogenic potential (§8.9).
 * Both implement AtmosphereLike (src/core/simTypes.ts) with the spec §2.4 constructor
 *   (terrain, hiRes, fuel, features, tier, extent, series, rng[, opts]).
 *
 * Contract change requests (implemented here as local adapters; see FireWindContextExt / AtmosphereOptions):
 *  1. FireWindContext.coupling?: number — c_f (SimOptions.coupling) for §8.8. Until then sim/ calls
 *     `setCoupling(c_f)` (or passes it in the extended context); default 1.
 *  2. FireWindContext.headMask?: Uint8Array, headDirX/Y?: Float32Array — head cells and head direction ê for the
 *     §8.8 pyrogenic head correction (fast tier). Fallback: the component opposing the background wind is removed.
 *  3. AtmosphereLike.setWindEdits?(edits, scenarioStartMs) — user wind edits (§8.3/§11.5) re-solve u_bg; today an
 *     extra method on both classes.
 *  4. AtmosDiagnostics.cHainesSurfaceSubstituted?: boolean — §8.10 "flag it" when 850 hPa lies below the grid-point
 *     surface and the 2 m values were used (exposed today as `cHainesSurface` on both classes).
 */
import type { Rng } from '../core/rng';
import type { AtmosphereLike, TerrainFeatures } from '../core/simTypes';
import type { FuelMap, GridSpec, QualityTier, Terrain, WeatherSeries } from '../core/types';
import { Atmosphere } from './atmosphere';
import type { AtmosphereOptions } from './base';
import { DiagnosticWind } from './diagnosticWind';

export { Atmosphere } from './atmosphere';
export { DiagnosticWind } from './diagnosticWind';
export type { AtmosphereOptions, FireWindContextExt } from './base';
export { ATMOS_PARAMS, ATMOS_TIERS, type AtmosParams, type AtmosTierSettings } from './params';
export { buildAtmosGrid, atmosCellSize, stretchRatio, canopyDrag, levelFrac, type AtmosGrid, type AtmosGridOptions } from './grid';
export {
  buildProfile,
  profileWind,
  kappaTable,
  kappaLookup,
  logLawKappa,
  alphaVRatio,
  thetaEnv,
  thetaRaw,
  tempAt,
  pressureAt,
  nSquaredBetween,
  type BackgroundProfile,
  type KappaTable,
  type UpperAirSource,
} from './profile';
export { netRadiation, sensibleHeatFlux, anabaticSpeed, katabaticSpeed, expLayerFraction, crownLayerFraction } from './surface';
export { cHaines, briggsRise, buoyancyFlux, byramNc, plumeColumn, pyroFirepowerThreshold, type PlumeResult } from './plume';
export { EllipticSolver, allLateralActive, type BoundaryMasks, type SolveResult } from './solver';
export { MassConsistentSolver, resolveWindEdits, type BgWind, type ResolvedWindEdit } from './massConsistent';
export { PyrogenicPotential } from './pyrogenic';
export { interpolateHour } from './weatherInterp';

/** Build the atmosphere of a tier (§12.2: fast → DiagnosticWind, standard/high → Atmosphere). */
export function createAtmosphere(
  terrain: Terrain,
  hiRes: { grid: GridSpec; elevation: Float32Array } | undefined,
  fuel: FuelMap,
  features: TerrainFeatures,
  tier: QualityTier,
  extent: number,
  series: WeatherSeries,
  rng: Rng,
  opts: AtmosphereOptions = {},
): AtmosphereLike & (Atmosphere | DiagnosticWind) {
  return tier === 'fast'
    ? new DiagnosticWind(terrain, hiRes, fuel, features, tier, extent, series, rng, opts)
    : new Atmosphere(terrain, hiRes, fuel, features, tier, extent, series, rng, opts);
}
