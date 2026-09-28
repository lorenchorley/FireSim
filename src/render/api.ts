/** Public interface of the 3-D view, so the UI can be built and tested independently of the Three.js implementation. */
import type { GridSpec } from '../core/grid';
import type { FuelMap, Ignition, Insight, SimSnapshot, SpotFire, Terrain } from '../core/types';
import type { LayerState } from './layers';

export interface SceneImagery {
  /** Image covering the scenario domain exactly; row 0 = north. */
  image: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  attribution: string;
}

export interface SceneViewApi {
  /**
   * Build the terrain, vegetation and static layers for a new scenario. `hiRes` (ScenarioData.terrainHiRes, the 10 m
   * DEM the fire grid was block-averaged from) makes the terrain mesh finer than the fire grid: cliffs and gullies are
   * drawn at the mesh budget (≈ 15 m for 6 km) instead of 30 m.
   */
  setScenario(terrain: Terrain, fuel: FuelMap, opts?: { imagery?: SceneImagery | null; hiRes?: { grid: GridSpec; elevation: Float32Array } | null }): void;
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
  /** Temporary brush outline while the user paints fuel edits (null to hide). */
  setBrushPreview(p: { x: number; y: number; radius: number; colour: string } | null): void;
  /** Temporarily disable camera gestures (e.g. while drawing a fire line). */
  setInteractionEnabled(enabled: boolean): void;
  /** Render statistics for the performance HUD. */
  stats(): { fps: number; drawCalls: number; triangles: number };
  resize(): void;
  dispose(): void;
}
