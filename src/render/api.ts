/** Public interface of the 3-D view, so the UI can be built and tested independently of the Three.js implementation. */
import type { ContextLayers } from '../core/places';
import type { GridSpec } from '../core/grid';
import type { FuelMap, Ignition, Insight, SimSnapshot, SpotFire, Terrain } from '../core/types';
import type { LayerState } from './layers';
import type { LegendSpec } from './legends';

export interface SceneImagery {
  /** Image covering the scenario domain exactly; row 0 = north. */
  image: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  attribution: string;
}

/**
 * The camera as numbers (read-only; for tests and the debug handle). The 3-D view orbits a target on the ground: `target` is
 * that point in local metres, `distance` the camera's distance from it, `azimuthDeg` the compass bearing (clockwise from north)
 * of the camera as seen from the target and `polarDeg` its angle from straight above (0 = plan view). `headingDeg` is where
 * the camera looks (compass degrees; in the plan view the screen's up direction). At eye level the target is a point 1 m in
 * front of the eye, so azimuth and polar describe the look direction. The 2-D map is always top-down and north up.
 */
export interface CameraState {
  target: [number, number];
  distance: number;
  azimuthDeg: number;
  polarDeg: number;
  headingDeg: number;
  mode: 'orbit' | 'top' | 'ground';
}

export interface SceneViewApi {
  /**
   * Build the terrain, vegetation and static layers for a new scenario. `hiRes` (ScenarioData.terrainHiRes, the 10 m
   * DEM the fire grid was block-averaged from) makes the terrain mesh finer than the fire grid: cliffs and gullies are
   * drawn at the mesh budget (≈ 15 m for 6 km) instead of 30 m.
   */
  setScenario(
    terrain: Terrain,
    fuel: FuelMap,
    opts?: { imagery?: SceneImagery | null; hiRes?: { grid: GridSpec; elevation: Float32Array } | null; context?: ContextLayers | null },
  ): void;
  /**
   * Scenario start (unix ms): the sun, shadows and sky follow the simulation clock exactly from the first frame
   * (without it the view derives the start from the snapshots' hourly weather record). Call after setScenario.
   */
  setStartTime?(unixMs: number): void;
  /** Update fuel-dependent visuals after a fuel edit. */
  refreshFuel(fuel: FuelMap): void;
  /** Show a simulation snapshot (the view interpolates flames/embers/wind animation between snapshots). */
  update(snapshot: SimSnapshot): void;
  setLayers(layers: Partial<LayerState>): void;
  /** Fly to a side-on view of the vertical cross-section (LayerState.crossSection); the 2-D map has none. */
  viewSection?(animate?: boolean): void;
  /** Ignitions / spot fires the user has marked (drawn as markers). */
  setIgnitions(ignitions: Ignition[], spots: SpotFire[]): void;
  setInsights(insights: Insight[]): void;
  /**
   * Roads, fire trails, homes, zones and place names for the scenario (local metres about the scenario origin), or null.
   * Shown according to LayerState.{roads, fireTrails, homes, zones, placeNames}; also feeds the 'homeDensity' and
   * 'roadAccess' heat maps. May be called before or after setScenario; `setScenario(…, { context })` does the same in one
   * call. The geometry is built in small slices over the next frames (a few milliseconds each).
   */
  setContext(context: ContextLayers | null): void;
  /** Highlight one insight location (pulsing ring) and optionally fly to it. */
  focusInsight(insight: Insight | null, fly?: boolean): void;
  /** Local (x, y) metres of the terrain point under a screen position, or null. */
  pickGround(clientX: number, clientY: number): [number, number] | null;
  /** Project a local ground point to client (screen) coordinates, or null if off-screen. */
  projectToScreen(x: number, y: number): [number, number] | null;
  flyTo(x: number, y: number, distance?: number): void;
  /** Camera presets. 'ground' = eye level at the user's position looking at the fire. */
  setViewMode(mode: 'orbit' | 'top' | 'ground'): void;
  setUserLocation(x: number, y: number, headingDeg?: number | null): void;
  /**
   * Screen areas (CSS px from each edge of the view) covered by UI panels: the view centres fly-to targets and the
   * orbit pivot in the rest, so they are not hidden behind an open panel.
   */
  setViewInsets(insets: { top?: number; right?: number; bottom?: number; left?: number }): void;
  /** Zoom in (factor < 1) or out (> 1) towards the view centre (no-op at eye level). */
  zoomBy(factor: number): void;
  /** Compass heading the camera looks towards (deg clockwise from north; 0 = north up in the top view). */
  readonly heading: number;
  /** Turn the view to face a compass heading (e.g. 0 = north up), keeping the target, distance and tilt. */
  setHeading(deg: number): void;
  /** The camera as numbers (target, distance, azimuth, tilt, heading, mode); cheap and read-only. */
  cameraState(): CameraState;
  /** A flick of the map is still gliding on after the finger lifted: a touch now only stops it (it is not a map tap). */
  readonly gliding: boolean;
  /** Temporary brush outline while the user paints fuel edits (null to hide). */
  setBrushPreview(p: { x: number; y: number; radius: number; colour: string } | null): void;
  /** Temporarily disable camera gestures (e.g. while drawing a fire line). */
  setInteractionEnabled(enabled: boolean): void;
  /**
   * Colour code of the 3-D canopy while the 'coded' canopy style is shown (title, unit, stops; the same ramps as the heat
   * map of the same data), else null. The 2-D map has no canopy.
   */
  canopyLegend?(): LegendSpec | null;
  /**
   * Map type 'Plain': draw the ground as neutral grey relief instead of the vegetation colours whenever the aerial photo is
   * not shown (a solo heat map uses the same plain ground). A view setting, not a LayerState key; kept across scenarios.
   */
  setPlainGround?(on: boolean): void;
  /** Map type 'Plain' is on. */
  readonly plainGround?: boolean;
  /** An aerial photo was given for this scenario (so the 'Aerial photo' map type can be shown). */
  readonly hasImagery?: boolean;
  /** The render quality tier in use (the UI keeps the trees' wind sway off by default on 'low'). */
  readonly renderQuality?: 'low' | 'medium' | 'high';
  /** Render statistics for the performance HUD. */
  stats(): { fps: number; drawCalls: number; triangles: number };
  /**
   * A full-screen screen is open over the view (Settings, Data sets, How this simulation works): stop drawing frames until
   * it is uncovered, so a reading screen does not run the GPU for pixels nobody sees. Snapshots and the camera keep their
   * state; the first frame after uncovering shows the latest. Optional: the 2-D mock has nothing to save.
   */
  setCovered?(covered: boolean): void;
  resize(): void;
  dispose(): void;
}
