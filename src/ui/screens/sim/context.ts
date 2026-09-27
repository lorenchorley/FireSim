/** Shared state and services for the components of the simulation screen. */
import type { CellExplanation, Ignition, ScenarioData } from '../../../core/types';
import type { SceneViewApi } from '../../../render/api';
import type { LayerState } from '../../../render/layers';
import type { SimSession } from '../../session';
import type { Settings } from '../../settings';
import type { Store } from '../../store';
import type { Pt } from '../../brushGeometry';
import type { LegendProvider } from '../../legends';

export type ToolId = 'why' | 'fire' | 'fuel' | 'wind' | 'layers' | 'whatif';
export type SheetDetent = 'peek' | 'half' | 'full';
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
}

export interface UiState {
  tool: ToolId;
  /** The tool's bottom panel is showing (the sheet is hidden while it is). */
  panelOpen: boolean;
  sheet: SheetDetent;
  tab: SheetTab;
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
  /** Absolute time (unix ms) of a simulation time. */
  absTime(t: number): number;
  /** Renderer legends (preferred when present). */
  legendProvider: LegendProvider | null;
  /** Non-fatal warnings from building the scenario (shown with the data sources). */
  buildWarnings: string[];
}

export const DEFAULT_UI: UiState = {
  tool: 'why',
  panelOpen: false,
  sheet: 'peek',
  tab: 'insights',
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
