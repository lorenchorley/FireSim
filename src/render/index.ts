/**
 * Render module (Three.js 3-D scene). The UI programs against {@link SceneViewApi} (api.ts) and {@link LayerState}
 * (layers.ts); {@link SceneView} is the implementation. Legends for the overlays come from {@link legendFor}.
 */
export type { SceneViewApi, SceneImagery } from './api';
export { DEFAULT_LAYERS, type LayerState, type OverlayKind } from './layers';
export { SceneView, type SceneViewOptions, type RenderQuality } from './SceneView';
export {
  legendFor,
  crossSectionLegend,
  windLegend,
  overlayScale,
  overlayColour,
  formatDuration,
  niceArrivalMax,
  NO_DATA,
  NOT_BURNT,
  type LegendSpec,
  type LegendEntry,
  type LegendKind,
  type LegendContext,
  type OverlayScale,
} from './legends';
export * as palette from './palette';
export { HeightField, type RayHit } from './heightfield';
export { localToWorld, worldToLocal, gridTransform, gridBounds, sunDirectionWorld } from './coords';
export { loadDemoImagery, type DemoImageryOptions } from './demoAssets';
export { skyLighting, type SkyLighting } from './sky';
export { placeVegetation, PlacementJob, VegGroup, VEG_GROUP_LABELS, MAX_VEG_INSTANCES, type VegInstances, type PlacementOptions } from './vegetationPlacement';
// The 3-D canopy: styles, colour coding (legend + scale of the 'coded' style), bark rules, sway, budgets (see canopyStyle.ts).
export {
  barkKindOf,
  canopyCodeLegend,
  canopyCodeScale,
  canopyCodeOverlay,
  swayParams,
  CANOPY_STYLES,
  CANOPY_CODES,
  type CanopyStyle,
  type CanopyCode,
  type BarkKind,
  type CanopyCodeScale,
} from './canopyStyle';
export { CANOPY_BUDGETS, type CanopyBudget, type VegetationStats } from './vegetationLayer';
export type { ViewMode } from './cameraRig';
export { contextFieldValues, CONTEXT_NO_DATA, type ContextFieldKind } from './contextFields';
export { placesLegend, type PlacesLegendGroup, type PlacesLegendEntry, type PlacesLayerId, type PlacesSwatch } from './placesLegend';
export {
  LAYER_GROUPS,
  LAYER_GROUP_BLURBS,
  LAYER_CATALOG,
  DIMENSION_HELP,
  SCENE_LAYER_KEYS,
  LAYER_SETTING_KEYS,
  HEAT_OVERLAY_KINDS,
  OVERLAY_KINDS,
  layerById,
  layersInGroup,
  layerForOverlay,
  layerForSceneKey,
  sceneLayerOn,
  sceneLayerPatch,
  availabilityContext,
  fuelHasGrass,
  type LayerGroup,
  type LayerInfo,
  type LayerDimension,
  type LayerScenario,
  type SceneLayerKey,
  type HeatInfo,
  type Availability,
  type AvailabilityContext,
} from './layerCatalog';
export { niceElevationRange } from './legends';
