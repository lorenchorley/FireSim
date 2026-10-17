/**
 * Air Slice, side view: the interface between the tool and the panel (workstream D, plan §8.1, §8.3, §8.5).
 *
 * THIS FILE IS A CONTRACT (types and doc comments only; no behaviour). Two lanes meet here and must not wait for each other:
 *   slicetool   src/ui/screens/sim/sliceTool.ts, sliceToolModel.ts (pure), the Tools-dock entry, the crosshair, the controls
 *               (Set A, Set B, Swap, Presets), the map marks, the registration in simScreen.ts and context.ts. It owns the
 *               tool's state (`SliceToolState`), writes the line into `LayerState.crossSection` (`a`, `b`, `preset`, `field`:
 *               render/layers.ts) and hands the panel what it should show.
 *   slicepanel  src/ui/screens/sim/slicePanel.ts and the files it imports (`slicePanelModel.ts` pure, `sliceDraw.ts`), and
 *               src/styles/slice.css. It owns everything drawn in the panel: the canvas (field raster, ground, model ground,
 *               axes, streaks, probe), the field chips, the legend, the readout, the model-cells switch, the footer, the
 *               keyboard and the screen-reader text. It never touches layers, the scene, the session or the map.
 * The slice itself (`SliceUpdate`, `SliceData`, the probe maths) comes from render/slice/types.ts; the scene publishes it
 * (`SceneViewApi.slice`, `onSlice`: render/api.ts) and the tool passes it on with `setData`.
 *
 * How they fit together
 *   - The tool panel (lane slicetool) is a `panelShell`-style section in `.panel-host`: header "Air slice" with Close, then the
 *     body. It is in the entry chunk and small. On opening it starts `import('./slicePanel')`: the panel, `flow2d`, `probe` and
 *     `niceTicks` load as one chunk (plan D10), and `src/styles/slice.css` is imported by slicePanel.ts so its CSS goes with
 *     it. Until the chunk arrives the body shows a one-line "Loading" row; a failed load shows one line and a Retry button,
 *     never a toast.
 *   - The tool builds the CONTROLS element (placement buttons, presets, the quiet notice line, the fast-tier callout if it
 *     wants one) and passes it in `SlicePanelOptions.controls`; the panel places it and lays everything out (portrait: canvas,
 *     the reading of a probe, chips, legend, controls, the notes of the chips that are off with the 3-D button, switch, footer;
 *     with such notes (the fast tier) the legend comes after them so the controls stay near the chips on a small phone; short
 *     landscape: the canvas and the footer pinned, the reading, chips and controls scrolling between). So the buttons' logic and
 *     words are the tool's, and their place is the panel's.
 *   - The tool subscribes to `view.onSlice` and calls `panel.setData(update)`; the panel never asks the scene.
 *   - A tap on a chip calls `onField`; the tool writes `crossSection.field` (so the curtain follows) and calls `setField`
 *     back if the layers change it from elsewhere (the Layers panel has the same chips). The panel keeps no field of its own.
 *   - A probe press or key calls `onProbe(pos)`; the tool stores it in `SliceToolState.probe` and draws the pin on the map at
 *     `a + dir · s` (`SliceProbePos`). The panel draws the probe and its readout itself from `SliceData` (`probeAt`).
 *
 * The Map view tab (workstream E, 0.5.0) is built by the tool itself, not by the panel: `SliceToolState.tab` says which of the two is
 * shown, the tool swaps the panel's element for the map body (the wind arrows and flow lines' switch and Wind height chips, the same
 * controls as the Layers panel, and "Turn off the slice") and tells the panel it is not active while it is out of the document.
 *
 * ToolId: the tool adds `'air'` to `ToolId` (context.ts), its label "Air slices" and entry to `TOOLS` (simScreen.ts), a
 * factory entry `air: createAirPanel` to the factory map, and "air tool and placing" to the crosshair condition. It is not added
 * here because a ToolId without its factory would not compile.
 */
import type { SliceFieldId, SliceKind, SlicePoint, SliceProbePos, SliceSpeedUnit, SliceUpdate } from '../../../render/slice/types';
import type { ExternalLegend } from '../../legends';

// ─────────────────────────────────────────────────────────────────────────────
// The tool's state (lane slicetool only; the panel never reads it)
// ─────────────────────────────────────────────────────────────────────────────

/** The tool's tabs: the side view of the air, and the map with the wind arrows and flow lines and their Wind height (workstream E, 0.5.0). */
export type SliceToolTab = 'side' | 'map';

/** Which end the crosshair, or the next tap on the map, is placing: A, B, or neither. */
export type SlicePlacing = 'a' | 'b' | null;

/**
 * The Air slices tool's own state (plan §8.2: "not render state"). Lives in `UiState.slice` (context.ts), so the map marks
 * in simScreen.ts can read it; it is NOT persisted and is initialised by the tool the first time it opens
 * (`UiState.slice` is undefined until then). Position of the line is not here: it is `LayerState.crossSection`, because the
 * curtain draws it too.
 *
 * Rules the state machine keeps (tested in sliceToolModel.test.ts):
 *   - `LayerState.crossSection.a` and `.b` are written TOGETHER or not at all. While one end exists and the other does not
 *     (first placement), the placed end waits in `draft`, and the map marks read it from there.
 *   - Re-placing one end of a line that exists (a hand-placed one or a preset's) writes both ends (the other taken from
 *     `SliceUpdate.resolved.line`) and `preset: null`. Swap does the same.
 *   - A tap on the map while `placing` is set puts the tapped point in `candidate`; "Place A here" / "Place B here" confirms
 *     the candidate when there is one and the crosshair's point when there is not (the two-step confirm for wet screens and gloves).
 */
export interface SliceToolState {
  tab: SliceToolTab;
  placing: SlicePlacing;
  /** A point set by a map tap and not yet confirmed; null: "Place here" uses the crosshair. */
  candidate: SlicePoint | null;
  /** One end placed before the other exists. */
  draft: { a: SlicePoint | null; b: SlicePoint | null };
  /** Where the probe is (slice coordinates), or null. Cleared when the line changes. */
  probe: SliceProbePos | null;
  /** The panel's "Show model cells" switch (the panel does the drawing; the tool keeps the switch so it survives closing and re-opening). Default false. */
  showCells: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// The panel (lane slicepanel)
// ─────────────────────────────────────────────────────────────────────────────

/** What the tool gives `createSlicePanel`, and the events the panel sends up. All callbacks are called synchronously from the panel's own event handlers. */
export interface SlicePanelOptions {
  /** The controls (placement buttons, presets, notice line), built and wired by the tool. Placed by the panel between the legend and the footer. */
  controls: HTMLElement;
  /** Simulation seconds to unix ms (`SimContext.absTime`) and the scenario's time zone, for "air from 14:05". */
  absTime(t: number): number;
  tz: string;
  /** The speed unit of the settings; changes arrive through `setUnits`. */
  units: SliceSpeedUnit;
  /** Starting values (the tool keeps them across closing and re-opening). */
  field: SliceFieldId;
  showCells: boolean;
  probe: SliceProbePos | null;
  /** `LayerState.verticalExaggeration` (1 to 3); changes arrive through `setExaggeration`. */
  exaggeration: number;
  /** The legend of a chip: `ctx.sceneLegends?.slice?.(field, kind)`. Absent or null: the panel draws no legend. */
  legend?(field: SliceFieldId, kind: SliceKind): ExternalLegend | null;
  /** Screen-reader announcement (`SimContext.announce`), polite; for rare events only, never per update. */
  announce(msg: string): void;

  // ── events up ──
  /** A chip was chosen (only ever one the update says is available). */
  onField(field: SliceFieldId): void;
  /** The probe was placed or moved (press, drag, arrow keys), or cleared (null: Escape, or tap-away). */
  onProbe(pos: SliceProbePos | null): void;
  /** "Show model cells" was switched. */
  onShowCells(on: boolean): void;
  /** The "Use the 3-D atmosphere" button of a disabled chip (`SliceFieldStatus.action === 'use-3d'`) was pressed. */
  onUse3d(): void;
}

/** What `createSlicePanel` returns. The panel draws only what it is given; every method is cheap to call repeatedly with the same value. */
export interface SlicePanelController {
  /** The panel's root element (the tool appends it to its body). */
  readonly el: HTMLElement;
  /**
   * The latest slice, or null (no line yet, the section is off, or the air holds no 3-D wind: the panel shows its empty
   * state and says which). Called at most about four times a second. `update.data` is refilled in place by the next
   * update: the panel reads it while drawing and keeps no copy beyond what it needs for the probe (it keeps the reference).
   */
  setData(update: SliceUpdate | null): void;
  /** The probe position, from the tool (restoring it, clearing it when the line changed); null removes the probe. */
  setProbe(pos: SliceProbePos | null): void;
  /** The chosen chip, when the layers changed it elsewhere. */
  setField(field: SliceFieldId): void;
  setShowCells(on: boolean): void;
  setUnits(units: SliceSpeedUnit): void;
  setExaggeration(vex: number): void;
  /** The panel is on screen (true) or covered / the tool is closing / the page is hidden (false): the streak loop runs only while active. */
  setActive(active: boolean): void;
  /** Move keyboard focus to the canvas (after the first line is placed). */
  focus(): void;
  /**
   * Move focus to the recording's status line, which scrolls it into view (0.4.1): the button that was pressed, Keep this line or Clear recording, is put away,
   * and the answer is further down the panel. False when there is no status line to go to.
   */
  focusRecording(): boolean;
  /** Remove listeners, the streak loop and the observers; the tool removes `el`. */
  destroy(): void;
}

/**
 * The default-chunk entry file of the panel: `src/ui/screens/sim/slicePanel.ts` exports exactly
 *
 *   export function createSlicePanel(options: SlicePanelOptions): SlicePanelController
 *
 * and nothing else is imported by the tool (the tool only ever does `import('./slicePanel')`, typed as this).
 */
export interface SlicePanelModule {
  createSlicePanel(options: SlicePanelOptions): SlicePanelController;
}

/** The loader the tool uses; its tests pass a fake one. */
export type SlicePanelLoader = () => Promise<SlicePanelModule>;

// ─────────────────────────────────────────────────────────────────────────────
// The tool panel factory (lane slicetool)
// ─────────────────────────────────────────────────────────────────────────────

/*
 * `src/ui/screens/sim/sliceTool.ts` exports
 *
 *   export function createAirPanel(ctx: SimContext, onClose: () => void, loadPanel?: SlicePanelLoader): { el: HTMLElement; destroy(): void }
 *
 * the same shape as the other tool panels (`createWindPanel` …), registered as `air: createAirPanel` in simScreen.ts.
 * `loadPanel` defaults to `() => import('./slicePanel')`.
 */

/** The label of the button on a disabled chip (`SliceFieldStatus.action === 'use-3d'`), the same words as the Layers panel's button. */
export const SLICE_USE_3D_LABEL = 'Use the 3-D atmosphere';
