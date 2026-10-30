/** Public interface of the 3-D view, so the UI can be built and tested independently of the Three.js implementation. */
import type { ContextLayers } from '../core/places';
import type { GridSpec } from '../core/grid';
import type { FuelMap, Ignition, Insight, SimSnapshot, SpotFire, Terrain } from '../core/types';
import type { LayerState, OverlayKind } from './layers';
import type { LegendSpec } from './legends';
import type { SliceRecordingApi, SliceUpdate } from './slice/types';
import type { DetailMotion, WindHeight } from './wind/glyphTypes';

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

/**
 * Night lighting of the map (workstream F of docs/plans/air-slice-wind-detail-honest-speed.md, §9b): 'realistic' follows the
 * clock (today's look); 'brighter' and 'daylight' light the ground, trees and roads after dark from a fixed north-west sun.
 */
export type NightLook = 'realistic' | 'brighter' | 'daylight';

/**
 * The 3-D picture quality tier in use and what it sets (workstream G, §9c). A read-only fact for the "Simulation debug
 * statistics" screen. The view knows how the tier was chosen (an option or a guess), not why the option was given: the UI
 * says "set by you" or "asked for by the Detail profile" from the settings.
 */
export interface QualityInfo {
  tier: 'low' | 'medium' | 'high';
  /** 'option': `createSceneView(container, { quality })` was given; 'guess': guessed from this phone's cores and memory. */
  source: 'option' | 'guess';
  /** What the guess is on this phone (the same as `tier` when `source` is 'guess'), and the numbers it used; null when the browser does not say. */
  guess: 'low' | 'medium' | 'high';
  cores: number | null;
  memoryGb: number | null;
  /** What the tier sets. */
  terrainSamples: number;
  treeBudget: number;
  canopyTriangles: number;
  pixelRatioCap: number;
  flameSites: number;
  smokePuffs: number;
  treeSwayDefault: boolean;
}

/**
 * Frame and draw statistics of the view (workstream A, §5.3 "Display"), from a ring of the last ~120 frame times that the
 * render loop already measures. Null fields have no data yet. While a full-screen screen covers the view nothing is drawn,
 * so these are the last seconds before it opened (`lastDrawAgeS` says how old).
 */
export interface FrameStatsInfo {
  /** Frames per second over the last 10 s of drawing. */
  fps10: number | null;
  frameMeanMs: number | null;
  frameP95Ms: number | null;
  /** Frames in the ring that took more than 34 ms (the field keeps its name: 34, not 33, because playback is capped at 30 fps and a capped frame takes 33.3 ms) and more than 100 ms, and how many frames the ring holds. */
  over33: number;
  over100: number;
  frames: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  /** Pixel ratio in use, its cap for this tier, how many times the adaptive ratio has lowered it, and the canvas size in device pixels. */
  pixelRatio: number;
  pixelRatioCap: number;
  dprDrops: number;
  canvasW: number;
  canvasH: number;
  /** Seconds since a frame was last drawn; null before the first. */
  lastDrawAgeS: number | null;
}

/**
 * What the wind glyphs (render/wind, 0.5.0) are doing now. `idle` says why nothing is drawn (`off` = the switch is off, or only
 * the Wind streaks are on and the zoom is short of the most detailed level, so nothing is built; `eye-level` = the eye-level
 * camera, `no-wind` = no air picture yet, `budget` = the rest of the frame already uses every triangle a frame may have, so the
 * glyphs trimmed themselves to nothing; the detailed streaks of level 4 are not trimmed to the frame and never say it). `level` is
 * the zoom's level whenever the layer plans (the glyph switch or the Wind streaks are on, not at eye level, not under `budget`),
 * even when only the Wind streaks are on; the counts are those of the picture drawn.
 * At the most detailed level (4) the picture is the detailed streaks (0.6.0): `count` is their lines, `segments` all the segments drawn
 * (the glyph pair has 4 triangles a segment, the detailed streaks 2) and `detailSegments` the share of them that are streaks.
 */
export interface WindGlyphStats {
  /** Drawn now. */
  active: boolean;
  idle: 'off' | 'eye-level' | 'no-wind' | 'budget' | null;
  level: 0 | 1 | 2 | 3 | 4;
  count: number;
  segments: number;
  /** Screen pixels one model cell covers at the middle of the screen, and the model cell in metres. */
  cellPx: number;
  cellM: number;
  rebuilds: number;
  lastMs: number;
  sliceP95Ms: number;
  sliceMaxMs: number;
  slicesLast: number;
  /**
   * The detailed streaks of the most detailed level (0.6.0): not drawn (or trimmed to nothing), drawn and moving, drawn standing still (reduced motion),
   * or paused after a minute without a touch (0.7.0), and how many segments they hold.
   */
  detail: DetailMotion;
  detailSegments: number;
  /** 0.7.0 (F5): the arrows and flow lines switch is on. */
  glyphs: boolean;
  /** 0.7.0 (F5): the Wind streaks switch wants the detailed streaks at the most detailed level. */
  streaks: boolean;
  /** 0.7.0 (F5, F4): reduced motion is on (the streaks stand still). */
  reduced: boolean;
  /** 0.7.0 (E4): the longest `tick()` of the layer (ms) since the last read of the statistics; 0 until measured. */
  tickMaxMs: number;
  /** 0.7.0 (item B): the data cell in metres (60 for What the fire feels; absent: the model cell, `cellM`). */
  dataCellM?: number;
  /** 0.7.0 (item B): which raster the picture reads: the 10 m surface wind, the fire-felt wind, or a height raster (absent: not known). */
  source?: 'surface' | 'felt' | 'height';
}

/**
 * 0.7.0 (E1b): what the overlay on the ground is made of now, for the e2e and the verifier to check the numbers (`SceneViewApi.overlayStats`).
 * `source` is where the Wind speed map's values come from (`other` for every other heat map); `height` the Wind height it follows; `nx` x `ny`
 * the raster in cells of `cellM` metres; `minKmh`, `maxKmh` the range of the finite values; `time` the simulation time (s) of the picture, or null.
 */
export interface OverlayStats {
  overlay: OverlayKind;
  source: 'surface' | 'height' | 'felt' | 'other';
  height: WindHeight;
  nx: number;
  ny: number;
  cellM: number;
  minKmh: number;
  maxKmh: number;
  time: number | null;
}

/**
 * What the cliff drawing cost and produced for the current scenario (workstream H, §9d.3 and §9d.6). Producer: the 3-D
 * view; null or absent when the scenario has no 10 m terrain (the mock, synthetic terrain), in which case nothing is
 * sharpened. Times are wall ms on this phone for the one build at scenario load.
 */
export interface TerrainDrawStats {
  /** Share (0–1) of 10 m cells the sharpening moved. */
  sharpenedShare: number | null;
  sharpenMs: number | null;
  maskMs: number | null;
  meshMs: number | null;
  gradientMs: number | null;
  meshVertices: number;
  meshTriangles: number;
  /** Rock detail in the terrain shader: all six effects, four, three, or off (no rock mask). */
  rockDetail: 'high' | 'medium' | 'low' | 'off';
}

/**
 * An icon the map draws and the user can tap (workstream I, §9e). `x`, `y` are the icon's own spot in local metres (a pin's
 * tip, not its picture). `others` is how many more icons were also within reach of the tap. The objects are the ones the
 * view was given (`setIgnitions`, `setInsights`, the snapshot), so the words about an icon come from the data, not from the view.
 * An `ignition` with origin 'spot' is a spot fire the user marked (the map draws it as the spot-fire icon, not a pin);
 * a `spot` is a simulated one, or one given to `setIgnitions` as a SpotFire when `marked` is true. A `home` is one address
 * point (one marker per address); `you` is the phone's position (not drawn at eye level, so not tappable there).
 */
export type MapMarker =
  | { kind: 'you'; x: number; y: number; others: number }
  | { kind: 'ignition'; x: number; y: number; others: number; ignition: Ignition }
  | { kind: 'spot'; x: number; y: number; others: number; spot: SpotFire; marked?: boolean }
  | { kind: 'insight'; x: number; y: number; others: number; insight: Insight }
  | { kind: 'home'; x: number; y: number; others: number };

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
  /**
   * The air slice the scene computes for `LayerState.crossSection` (workstream D, render/slice/types.ts): the effective line, the
   * sampled slice, which presets and chips can be used, and the field it is coloured by. One computation, shared by the 3-D curtain and
   * the side-view panel. Null while the section is off, before the first snapshot, and on the 2-D map (which has no air data;
   * the member is then absent). `data` inside it is refilled in place by the next update: read it, do not keep it.
   */
  slice?(): SliceUpdate | null;
  /** The wind glyphs (0.5.0): what is drawn now and what it cost, for the Layers caption and the debug statistics. Absent on the 2-D map. */
  windGlyphStats?(): WindGlyphStats | null;
  /** The overlay's raster and its range (0.7.0, E1b), or null when no overlay is drawn. Absent on the 2-D map. */
  overlayStats?(): OverlayStats | null;
  /**
   * Called after every new slice (at most every `SLICE_UPDATE_MIN_MS` while the air changes, at once on a line, field or
   * layer edit) and with null when the section is switched off. Returns the unsubscribe function.
   */
  onSlice?(cb: (update: SliceUpdate | null) => void): () => void;
  /** The time-lapse recorder of the pinned line (0.4.1, render/slice/types.ts): the session feeds it every snapshot and cuts it with the history. Absent on the 2-D map. */
  sliceRecording?: SliceRecordingApi;
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
  /**
   * Night lighting of the map (workstream F): applies at once (uniforms only), kept across scenarios. A view setting, not a
   * LayerState key. Absent on the 2-D mock, which has no night.
   */
  setNightLook?(look: NightLook): void;
  readonly nightLook?: NightLook;
  /** The render quality tier in use (the UI keeps the trees' wind sway off by default on 'low'). */
  readonly renderQuality?: 'low' | 'medium' | 'high';
  /** The tier, how it was chosen and what it sets (workstream G); absent on the 2-D mock. */
  readonly qualityInfo?: QualityInfo;
  /** Frame and draw statistics for the debug statistics screen (workstream A); absent on the 2-D mock. */
  frameStats?(): FrameStatsInfo | null;
  /** Cliff drawing statistics for the current scenario (workstream H); null when nothing was sharpened. */
  terrainStats?(): TerrainDrawStats | null;
  /**
   * The icon under a screen position, or null (workstream I): within 22 px of an icon's centre (homes 14 px), nearest wins.
   * Optional so hand-written fakes keep compiling; the ground is picked with `pickGround`.
   */
  pickMarker?(clientX: number, clientY: number): MapMarker | null;
  /** Render statistics for the performance HUD. */
  stats(): { fps: number; drawCalls: number; triangles: number; windGlyphs?: { level: number; count: number } };
  /**
   * A full-screen screen is open over the view (Settings, Data sets, How this simulation works): stop drawing frames until
   * it is uncovered, so a reading screen does not run the GPU for pixels nobody sees. Snapshots and the camera keep their
   * state; the first frame after uncovering shows the latest. Optional: the 2-D mock has nothing to save.
   */
  setCovered?(covered: boolean): void;
  resize(): void;
  dispose(): void;
}
