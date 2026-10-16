/**
 * What the Air slices tool does to the app's stores (workstream D): the glue between the pure model (sliceToolModel.ts) and the
 * two stores and the scene it writes to. No DOM and no timers, so it is unit-tested with real stores and a fake scene
 * (sliceToolActions.test.ts). sliceTool.ts builds the buttons and calls these; simScreen.ts reads the same state for the map marks.
 *
 * The tool talks to the scene only through `view.setLayers` (the line, the field), `view.slice()` (what is drawn and which presets
 * can be tapped) and `ctx.pickCrosshair()`. Order of a write: the tool state first, then the layer store, then the scene, so
 * anything the scene calls back with (`onSlice`) already finds the stores up to date.
 */
import type { GridSpec } from '../../../core/grid';
import type { SceneViewApi } from '../../../render/api';
import type { LayerState } from '../../../render/layers';
import type { SliceFieldId, SlicePoint, SlicePresetId, SliceProbePos, SliceRecordingStatus, SliceUpdate } from '../../../render/slice/types';
import type { Store } from '../../store';
import type { UiState } from './context';
import {
  CLEAR_SAY,
  backStep,
  cancelPlacing,
  choosePreset,
  controlsView,
  effectiveField,
  fieldWrite,
  hasStoredLine,
  initialSliceToolState,
  keepLine,
  lineFacts,
  ownLine,
  placeHere,
  placeVerdict,
  presetStatuses,
  probeAfterLineChange,
  reopened,
  startPlacing,
  swapEnds,
  userFixOf,
  withProbe,
  withShowCells,
  type ControlsView,
  type CrossSection,
  type LineFacts,
  type PlaceVerdict,
  type SliceEnd,
  type ToolStep,
} from './sliceToolModel';
import type { SliceToolState } from './sliceTypes';

export interface SliceToolHost {
  ui: Store<UiState>;
  layers: Store<LayerState>;
  view: Pick<SceneViewApi, 'setLayers' | 'slice' | 'sliceRecording'>;
  /** The model area's grid (the air's own when a picture exists, else the terrain's), or null. */
  grid(): GridSpec | null;
  /** The ground point under the screen crosshair (`SimContext.pickCrosshair`), or null over the sky. */
  crosshair(): SlicePoint | null;
  /** The phone's position (Setup GPS fix), local metres. */
  user: SlicePoint | null;
  /** There is a fire at the shown time (what "Me to fire" needs before the scene has a slice to say so). */
  hasFire(): boolean;
  announce(msg: string): void;
}

export interface PlaceOutcome {
  verdict: PlaceVerdict;
  /** A line was written to the layers (not only a draft end kept). */
  wrote: boolean;
  /** The line is the first one the tool made (the panel takes the keyboard focus). */
  firstLine: boolean;
}

export interface SliceToolActions {
  state(): SliceToolState;
  update(): SliceUpdate | null;
  facts(): LineFacts;
  /** The model of the buttons and the quiet line right now. */
  controls(switching3d?: boolean): ControlsView;
  /** The tool opened: its state exists, a placement under way is dropped, and the section shows again when the tool holds a line. */
  open(): void;
  /** The tool closed: nothing is being placed any more (the line, the draft, the probe and the switches stay). */
  close(): void;
  startPlacing(end: SliceEnd): void;
  cancelPlacing(): void;
  /** "Place A/B here": the tapped candidate, else the crosshair's point. */
  placeHere(): PlaceOutcome;
  swap(): void;
  /** "Keep this line": the live preset in force becomes the fixed line it is now, so it can be recorded (nothing for any other line). */
  keep(): void;
  /** "Clear recording": the recorder drops what it holds and records again from the next picture. */
  clearRecording(): void;
  /** The recorder's state now (the scene's own answer, not the last update's), or null where there is no recorder. */
  recording(): SliceRecordingStatus | null;
  preset(id: SlicePresetId): void;
  setField(field: SliceFieldId): void;
  setProbe(pos: SliceProbePos | null): void;
  setShowCells(on: boolean): void;
  /** The effective chip (the scene's, else the stored one, else Speed). */
  field(): SliceFieldId;
}

export function createSliceToolActions(host: SliceToolHost): SliceToolActions {
  const { ui, layers, view } = host;
  const state = (): SliceToolState => ui.get().slice ?? initialSliceToolState();
  const update = (): SliceUpdate | null => view.slice?.() ?? null;
  const cs = (): CrossSection => layers.get().crossSection;
  const facts = (): LineFacts => lineFacts(update()?.resolved, cs(), host.grid());
  /** Asked of the recorder itself: the last update's copy of its state is up to a snapshot old, and a button must follow what was just pressed. */
  const recording = (): SliceRecordingStatus | null => view.sliceRecording?.status() ?? update()?.recording ?? null;

  /** The scene's statuses when it has a slice; else what the tool can see (the fire is looked for only then: it is a scan of the fire). */
  const presetsNow = (grid: GridSpec | null): ReturnType<typeof presetStatuses> => {
    const live = update()?.presets;
    return live ?? presetStatuses(null, userFixOf(host.user, grid), host.hasFire());
  };

  const writeLayers = (next: CrossSection): void => {
    layers.set({ crossSection: next });
    view.setLayers({ crossSection: next });
  };
  const apply = (step: ToolStep): void => {
    if (step.state !== ui.get().slice) ui.set({ slice: step.state });
    if (step.crossSection) writeLayers(step.crossSection);
    if (step.say) host.announce(step.say);
  };

  return {
    state,
    update,
    facts,
    field: () => effectiveField(update(), cs()),
    controls(switching3d = false) {
      const s = state();
      const f = facts();
      const grid = host.grid();
      const end = s.placing;
      const verdict = end ? placeVerdict(end, s.candidate ?? host.crosshair(), s, f, grid) : null;
      return controlsView({ state: s, facts: f, presets: presetsNow(grid), fix: userFixOf(host.user, grid), verdict, switching3d, recording: recording() });
    },
    open() {
      const cur = ui.get().slice;
      const next = cur ? reopened(cur) : initialSliceToolState();
      if (next !== cur) ui.set({ slice: next });
      const c = cs();
      if (!c.enabled && hasStoredLine(c)) writeLayers({ ...c, enabled: true });
    },
    close() {
      const cur = ui.get().slice;
      if (cur && reopened(cur) !== cur) ui.set({ slice: reopened(cur) });
    },
    startPlacing: (end) => apply(startPlacing(state(), end)),
    cancelPlacing: () => apply(cancelPlacing(state())),
    placeHere() {
      const s = state();
      const f = facts();
      const { step, verdict } = placeHere(s, s.candidate ?? host.crosshair(), cs(), f, host.grid());
      apply(step);
      return { verdict, wrote: !!step.crossSection, firstLine: !!step.crossSection && !ownLine(f) };
    },
    swap: () => apply(swapEnds(state(), cs(), facts())),
    keep: () => apply(keepLine(state(), cs(), facts())),
    clearRecording() {
      if (!view.sliceRecording) return;
      view.sliceRecording.clear();
      host.announce(CLEAR_SAY);
    },
    recording,
    preset(id) {
      apply(choosePreset(state(), cs(), id, presetsNow(host.grid())[id]));
    },
    setField(field) {
      const next = fieldWrite(cs(), field);
      if (next) writeLayers(next);
    },
    setProbe(pos) {
      const next = withProbe(state(), pos);
      if (next !== ui.get().slice) ui.set({ slice: next });
    },
    setShowCells(on) {
      const next = withShowCells(state(), on);
      if (next !== ui.get().slice) ui.set({ slice: next });
    },
  };
}

/**
 * The line changed from outside the tool (the Layers compass, "Centre on the fire", "Show me"): the probe was placed on the old line, so it is
 * cleared, whether the tool is open or not. Subscribed for the life of the sim screen; returns the unsubscribe.
 */
export function watchLineForProbe(ui: Store<UiState>, layers: Store<LayerState>): () => void {
  return layers.subscribe((next, prev) => {
    const cur = ui.get().slice;
    const s = probeAfterLineChange(cur, prev.crossSection, next.crossSection);
    if (s !== cur) ui.set({ slice: s });
  }, ['crossSection']);
}

/** Android Back and Escape: a placement under way is dropped first (the tool stays open); false when there was nothing of the tool's to undo. */
export function backFromAirTool(ui: Store<UiState>): boolean {
  const u = ui.get();
  const step = u.tool === 'air' && u.panelOpen ? backStep(u.slice) : null;
  if (!step) return false;
  ui.set({ slice: step.state });
  return true;
}
