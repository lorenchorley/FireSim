/** Shared state and services for the components of the simulation screen. */
import { airKind } from '../../../core/airView';
import type { AtmosphereView, CellExplanation, Ignition, ScenarioData } from '../../../core/types';
import type { MapMarker, SceneViewApi } from '../../../render/api';
import type { LayerState } from '../../../render/layers';
import type { SimSession } from '../../session';
import type { Settings } from '../../settings';
import type { Store } from '../../store';
import type { Pt } from '../../brushGeometry';
import type { LegendProvider } from '../../legends';

export type ToolId = 'why' | 'fire' | 'fuel' | 'wind' | 'layers' | 'whatif';
/** Bottom dock: 'closed' = only the navigation row (the default), then three heights of open sheet. */
export type SheetDetent = 'closed' | 'peek' | 'half' | 'full';
/** The floating menus over the map (the Tools speed dial and the View list); at most one is open. */
export type MenuId = 'tools' | 'view';
export type SheetTab = 'insights' | 'weather' | 'stats' | 'help';

/** Something the user is placing on the map but has not confirmed yet. */
export type Pending =
  | { kind: 'point'; at: Pt }
  | { kind: 'line'; points: Pt[] }
  | { kind: 'brush'; points: Pt[]; radius: number }
  | null;

export interface WhyState {
  x: number;
  y: number;
  /** Simulation time (s) the explanation describes. */
  time: number;
  loading: boolean;
  explanation: CellExplanation | null;
  error?: string;
  /** The map icon the question is about (the point is then the icon's own spot); null or absent for a tap on the ground. */
  marker?: MapMarker | null;
}

export interface UiState {
  tool: ToolId;
  /** The tool's bottom panel is showing (the sheet is hidden while it is). */
  panelOpen: boolean;
  sheet: SheetDetent;
  tab: SheetTab;
  /** The open floating menu (tools / view), or null when both are collapsed. */
  menu: MenuId | null;
  why: WhyState | null;
  pending: Pending;
  /** Finger-drawing mode for lines / fuel painting (camera gestures disabled). */
  drawing: boolean;
  fireOrigin: Ignition['origin'];
  fireInput: 'point' | 'line';
  firePointRadius: number;
  fuelPreset: string;
  brushRadius: number;
  wind: { dir: number; kmh: number; radius: number };
  viewMode: 'orbit' | 'top' | 'ground';
}

export interface SimContext {
  scenario: ScenarioData;
  session: SimSession;
  view: SceneViewApi;
  layers: Store<LayerState>;
  settings: Store<Settings>;
  ui: Store<UiState>;
  tz: string;
  /** The element that hosts the scene (for crosshair picking). */
  mapEl: HTMLElement;
  /** User position in local metres, if known. */
  user: [number, number] | null;
  /** Screen-reader announcement. */
  announce(msg: string): void;
  /** Pick the ground under the screen crosshair (centre of the visible map). */
  pickCrosshair(): [number, number] | null;
  /** Open the setup screen / settings. */
  exit(): void;
  openSettings(): void;
  showNotice(): void;
  /** Open the Data sets screen, optionally at one data set (absent when the app does not offer it). The run keeps going. */
  openDatasets?: (datasetId?: string) => void;
  /** Open "How this simulation works" (absent when the app does not offer it). The run keeps going. */
  openModelCard?: () => void;
  /** Open "Simulation debug statistics" (absent when the app does not offer it). The run keeps going. */
  openDebugStats?: () => void;
  /** Absolute time (unix ms) of a simulation time. */
  absTime(t: number): number;
  /** Renderer legends (preferred when present). */
  legendProvider: LegendProvider | null;
  /** Renderer legends of the cross-section and the wind particles (null with the 2-D map). */
  sceneLegends: import('../../modules').SceneLegends | null;
  /** Non-fatal warnings from building the scenario (shown with the data sources). */
  buildWarnings: string[];
}

export const DEFAULT_UI: UiState = {
  tool: 'why',
  panelOpen: false,
  sheet: 'closed',
  tab: 'insights',
  menu: null,
  why: null,
  pending: null,
  drawing: false,
  fireOrigin: 'observed',
  fireInput: 'point',
  firePointRadius: 40,
  fuelPreset: 'litter',
  brushRadius: 100,
  wind: { dir: 225, kmh: 25, radius: 500 },
  viewMode: 'orbit',
};

/**
 * True when the snapshot carries the time-stepped 3-D atmosphere (standard / high tier): wind, temperature and smoke, so a
 * plume volume, cross-section temperature and smoke, and through-the-plume wind particles. The fast tier's view holds only
 * the diagnosed wind (`hasAirWind` in core/airView.ts): no plume, temperature or smoke. Asked of the view itself (`airKind`), not of the engine
 * report, because a picture composed from history carries the newest engine info (snapshotStore.ts).
 */
export function has3dAtmosphere(snap: { atmosphere?: Pick<AtmosphereView, 'nz' | 'kind'> | null } | null | undefined): boolean {
  return airKind(snap?.atmosphere) === 'prognostic';
}
