/**
 * Mock implementations of the modules the UI depends on, for development, screenshots and e2e tests (`?mock=1`),
 * and as fallbacks when a real module fails to load (see modules.ts):
 *  - {@link MockSimController} (SimController): synthetic but plausible fire growth, embers, spot fires, insights
 *    of several kinds including Danger, and "Why here?" explanations;
 *  - {@link MockSceneView} (SceneViewApi): a 2-D top-down hillshade/imagery map with the fire and overlays;
 *  - {@link mockBuildScenario}: real bundled terrain (src/data loadElevation + src/terrain buildTerrain) with
 *    fabricated fuel and weather.
 */
export { MockSimController } from './mockSim';
export { MockSceneView } from './mockScene';
export { mockBuildScenario, mockWeather, fabricateFuel, type BuildScenarioFn } from './mockScenario';
