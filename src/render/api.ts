/** Public interface of the 3-D view, so the UI can be built and tested independently of the Three.js implementation. */
import type { FuelMap, Ignition, Insight, SimSnapshot, SpotFire, Terrain } from '../core/types';
import type { LayerState } from './layers';

export interface SceneImagery {
  /** Image covering the scenario domain exactly; row 0 = north. */
  image: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  attribution: string;
}

export interface SceneViewApi {
  /** Build the terrain, vegetation and static layers for a new scenario. */
  setScenario(terrain: Terrain, fuel: FuelMap, opts?: { imagery?: SceneImagery | null }): void;
  /** Update fuel-dependent visuals after a fuel edit. */
  refreshFuel(fuel: FuelMap): void;
  /** Show a simulation snapshot (the view interpolates flames/embers/wind animation between snapshots). */
  update(snapshot: SimSnapshot): void;
  setLayers(layers: Partial<LayerState>): void;
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
  /** Temporary brush outline while the user paints fuel edits (null to hide). */
  setBrushPreview(p: { x: number; y: number; radius: number; colour: string } | null): void;
  /** Temporarily disable camera gestures (e.g. while drawing a fire line). */
  setInteractionEnabled(enabled: boolean): void;
  /** Render statistics for the performance HUD. */
  stats(): { fps: number; drawCalls: number; triangles: number };
  resize(): void;
  dispose(): void;
}
