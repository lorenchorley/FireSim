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
export { placeVegetation, VegGroup, MAX_VEG_INSTANCES, type VegInstances, type PlacementOptions } from './vegetationPlacement';
export type { ViewMode } from './cameraRig';
