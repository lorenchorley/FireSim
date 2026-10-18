/**
 * What the Air slices tool writes to the app (sliceToolActions.ts), with the real stores and a fake scene: the line goes into
 * `LayerState.crossSection` (a and b together, preset null, Speed first, an explicit undefined for what a preset clears), into the
 * scene through `setLayers`, the tool's own state into `UiState.slice`, in an order that lets the scene call back safely.
 */
import { describe, expect, it } from 'vitest';
import type { GridSpec } from '../../../core/grid';
import type { SceneViewApi } from '../../../render/api';
import { DEFAULT_LAYERS, type LayerState } from '../../../render/layers';
import type { ResolvedSlice, SlicePoint, SlicePresetId, SlicePresetStatus, SliceRecordingStatus, SliceUpdate } from '../../../render/slice/types';
import { Store } from '../../store';
import { DEFAULT_UI, type UiState } from './context';
import { backFromAirTool, createSliceToolActions, watchLineForProbe, type SliceToolHost } from './sliceToolActions';
import { CLEAR_SAY, KEEP_SAY, OFF_CLEARED_SAY, OFF_SAY } from './sliceToolModel';

const GRID: GridSpec = { nx: 61, ny: 61, cellSize: 100, x0: -3000, y0: -3000, origin: { lat: -33.7, lon: 150.3 } };

interface Rig {
  host: SliceToolHost;
  ui: Store<UiState>;
  layers: Store<LayerState>;
  calls: string[];
  said: string[];
  /** The point the crosshair is over (null: the sky). */
  cross: { at: SlicePoint | null };
  /** What the scene's slice() returns. */
  scene: { update: (Partial<Omit<SliceUpdate, 'resolved'>> & { resolved?: Partial<ResolvedSlice> }) | null };
  /** The fake time-lapse recorder behind `view.sliceRecording` (null: a scene without one, the 2-D map). `clears` counts its `clear()` calls. */
  recorder: { status: SliceRecordingStatus; clears: number } | null;
}

const recStatus = (o: Partial<SliceRecordingStatus> = {}): SliceRecordingStatus => ({ state: 'off', offFor: null, count: 0, from: null, to: null, spacingS: 0, bytes: 0, budgetBytes: 6e6, dropped: null, ...o });

function rig(opts: { user?: SlicePoint | null; fire?: boolean; layers?: Partial<LayerState>; recorder?: boolean } = {}): Rig {
  const ui = new Store<UiState>({ ...DEFAULT_UI, wind: { ...DEFAULT_UI.wind }, tool: 'air', panelOpen: true });
  const layers = new Store<LayerState>({ ...DEFAULT_LAYERS, crossSection: { ...DEFAULT_LAYERS.crossSection }, ...opts.layers });
  const calls: string[] = [];
  const said: string[] = [];
  const cross: Rig['cross'] = { at: [0, 0] };
  const scene: Rig['scene'] = { update: null };
  const recorder: Rig['recorder'] = opts.recorder === false ? null : { status: recStatus(), clears: 0 };
  const view: Pick<SceneViewApi, 'setLayers' | 'slice' | 'sliceRecording'> = {
    setLayers(p) {
      // The scene calls back inside setLayers: the stores must already hold the new section by then.
      calls.push(`view ${JSON.stringify(p.crossSection)} store=${JSON.stringify(layers.get().crossSection.a ?? null)}`);
      // The recorder's own rule (R-core, SliceTimeLapse.follow): a fixed line is recorded from the next picture, a live preset is not. Only what the tool shows afterwards is tested here.
      if (recorder && p.crossSection) {
        const fixed = !p.crossSection.preset && !!p.crossSection.a && !!p.crossSection.b;
        recorder.status = fixed ? recStatus({ state: 'waiting' }) : recStatus({ state: 'off', offFor: p.crossSection.preset ? 'preset' : null });
      }
    },
    ...(recorder
      ? {
          sliceRecording: {
            record: () => undefined,
            truncateAfter: () => undefined,
            clear() {
              recorder.clears++;
              recorder.status = recStatus({ state: 'waiting', dropped: 'cleared' });
            },
            status: () => recorder.status,
          },
        }
      : {}),
    slice: () => (scene.update ? ({ field: 'speed', presets: allOk(), fields: {}, data: null, ...scene.update, resolved: { line: null, source: 'endpoints', preset: null, issue: null, notes: [], minLengthM: 300, ...scene.update.resolved } } as unknown as SliceUpdate) : null),
  };
  const host: SliceToolHost = { ui, layers, view, grid: () => GRID, crosshair: () => cross.at, user: opts.user === undefined ? [200, 200] : opts.user, hasFire: () => opts.fire ?? true, announce: (m) => said.push(m) };
  return { host, ui, layers, calls, said, cross, scene, recorder };
}

const allOk = (): Record<SlicePresetId, SlicePresetStatus> => ({ along: { ok: true }, across: { ok: true }, slope: { ok: true }, me: { ok: true } });
const line = (a: SlicePoint, b: SlicePoint): ResolvedSlice['line'] => ({ a, b, dir: [(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])], length: Math.hypot(b[0] - a[0], b[1] - a[1]) });

describe('opening and closing', () => {
  it('makes the tool\'s state the first time it opens, and leaves the layers alone', () => {
    const r = rig();
    expect(r.ui.get().slice).toBeUndefined();
    const before = r.layers.get().crossSection;
    createSliceToolActions(r.host).open();
    expect(r.ui.get().slice).toMatchObject({ tab: 'side', placing: null, candidate: null, showCells: false });
    expect(r.layers.get().crossSection).toBe(before);
    expect(r.calls).toEqual([]);
  });

  it('opens again with the placement dropped but the draft, probe and switches kept', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.open();
    t.startPlacing('a');
    t.placeHere(); // A goes to the draft
    t.setShowCells(true);
    t.startPlacing('b');
    t.close();
    expect(r.ui.get().slice).toMatchObject({ placing: null, candidate: null, showCells: true, draft: { a: [0, 0], b: null } });
    t.open();
    expect(r.ui.get().slice!.draft.a).toEqual([0, 0]);
  });

  it('shows the section again when the tool holds a line that the Layers panel switched off', () => {
    const r = rig({ layers: { crossSection: { ...DEFAULT_LAYERS.crossSection, enabled: false, a: [0, 0], b: [0, 1000], preset: null, field: 'speed' } } });
    createSliceToolActions(r.host).open();
    expect(r.layers.get().crossSection).toMatchObject({ enabled: true, a: [0, 0], b: [0, 1000] });
    expect(r.calls).toHaveLength(1);
  });

  it('does not switch the section on by itself when there is no line of the tool\'s', () => {
    const r = rig();
    createSliceToolActions(r.host).open();
    expect(r.layers.get().crossSection.enabled).toBe(false);
  });
});

describe('placing A and B', () => {
  it('Set A, Place A, Set B, Place B: four presses write the line once, both ends together', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.open();
    t.startPlacing('a');
    expect(r.ui.get().slice!.placing).toBe('a');
    r.cross.at = [-500, 0];
    expect(t.placeHere()).toMatchObject({ verdict: { ok: true }, wrote: false, firstLine: false });
    expect(r.layers.get().crossSection.a).toBeUndefined(); // a lone end is never stored
    expect(r.calls).toEqual([]);
    t.startPlacing('b');
    r.cross.at = [1500, 0];
    expect(t.placeHere()).toMatchObject({ verdict: { ok: true }, wrote: true, firstLine: true });
    expect(r.layers.get().crossSection).toMatchObject({ enabled: true, a: [-500, 0], b: [1500, 0], preset: null, field: 'speed' });
    expect(r.calls).toHaveLength(1);
    expect(r.ui.get().slice).toMatchObject({ placing: null, candidate: null, draft: { a: null, b: null }, probe: null });
    expect(r.said.at(-1)).toBe('Line placed. The side view shows it.');
  });

  it('writes the stores before it calls the scene, so a callback from the scene finds the new section', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.startPlacing('a');
    t.placeHere();
    t.startPlacing('b');
    r.cross.at = [1000, 0];
    t.placeHere();
    expect(r.calls[0]).toContain('store=[0,0]');
  });

  it('a map tap sets the candidate and Place uses it instead of the crosshair', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.startPlacing('a');
    r.ui.set({ slice: { ...r.ui.get().slice!, candidate: [700, 800] } });
    r.cross.at = [-2000, -2000];
    t.placeHere();
    expect(r.ui.get().slice!.draft.a).toEqual([700, 800]);
  });

  it('the crosshair over the sky or outside the model area places nothing and the placement stays open', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.startPlacing('a');
    r.cross.at = null;
    expect(t.placeHere().verdict).toEqual({ ok: false, why: 'no-ground' });
    r.cross.at = [9000, 0];
    expect(t.placeHere().verdict).toEqual({ ok: false, why: 'outside' });
    expect(r.ui.get().slice!.placing).toBe('a');
    expect(r.ui.get().slice!.draft).toEqual({ a: null, b: null });
    expect(r.said).toHaveLength(1); // only the "Placing the start" line
  });

  it('moving one end of the line the scene resolved writes both ends', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    r.scene.update = { resolved: { line: line([0, 0], [0, 1000]), source: 'endpoints' } };
    t.startPlacing('a');
    r.cross.at = [600, 100];
    expect(t.placeHere()).toMatchObject({ wrote: true, firstLine: false });
    expect(r.layers.get().crossSection).toMatchObject({ a: [600, 100], b: [0, 1000], preset: null });
  });

  it('Cancel drops the placement; Back does the same and says it handled the press', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.startPlacing('b');
    t.cancelPlacing();
    expect(r.ui.get().slice!.placing).toBeNull();
    t.startPlacing('b');
    expect(backFromAirTool(r.ui)).toBe(true);
    expect(r.ui.get().slice!.placing).toBeNull();
    expect(backFromAirTool(r.ui)).toBe(false); // the next press closes the tool
  });

  it('Back only handles a placement of the Air tool while its panel is open', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.startPlacing('a');
    r.ui.set({ tool: 'fire' });
    expect(backFromAirTool(r.ui)).toBe(false);
    r.ui.set({ tool: 'air', panelOpen: false });
    expect(backFromAirTool(r.ui)).toBe(false);
  });
});

describe('Keep this line and Clear recording (0.4.1)', () => {
  const presetScene = (r: Rig): void => {
    r.layers.set({ crossSection: { ...DEFAULT_LAYERS.crossSection, enabled: true, preset: 'along', field: 'speed' } });
    r.recorder!.status = recStatus({ state: 'off', offFor: 'preset' });
    r.scene.update = { resolved: { line: line([-1500, 200], [1500, -200]), source: 'preset', preset: 'along' }, recording: r.recorder!.status };
  };

  it('Keep this line is offered for a live preset only, with the Clear button hidden while nothing is recorded', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    expect(t.controls()).toMatchObject({ keep: false, clear: false });
    presetScene(r);
    expect(t.controls()).toMatchObject({ keep: true, clear: false });
    r.scene.update = { resolved: { line: line([0, 0], [0, 1000]), source: 'endpoints', preset: null } };
    expect(t.controls().keep).toBe(false);
    r.scene.update = { resolved: { line: line([0, 0], [0, 1000]), source: 'centre', preset: null } };
    expect(t.controls().keep).toBe(false); // the Layers chord is not the tool's line
  });

  it('writes both ends of the preset line, preset null, clears the probe and says so; the scene then waits for the next picture', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    presetScene(r);
    t.setProbe({ s: 400, z: 900 });
    t.keep();
    expect(r.layers.get().crossSection).toMatchObject({ enabled: true, a: [-1500, 200], b: [1500, -200], preset: null, field: 'speed' });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toContain('"a":[-1500,200]');
    expect(r.calls[0]).toContain('store=[-1500,200]'); // the stores were written before the scene was told
    expect(r.ui.get().slice!.probe).toBeNull();
    expect(r.said.at(-1)).toBe(KEEP_SAY);
    expect(r.recorder!.status.state).toBe('waiting'); // (the fake recorder's rule: a fixed line is recorded from the next picture)
    // what the tool shows now: the line is fixed (no Keep), nothing is recorded yet (no Clear)
    r.scene.update = { resolved: { line: line([-1500, 200], [1500, -200]), source: 'endpoints', preset: null }, recording: r.recorder!.status };
    expect(t.controls()).toMatchObject({ keep: false, clear: false });
  });

  it('Keep this line does nothing for a fixed line or without a line: no write, no scene call, no announcement', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.keep();
    r.scene.update = { resolved: { line: line([0, 0], [0, 1000]), source: 'endpoints' } };
    t.keep();
    expect(r.calls).toEqual([]);
    expect(r.said).toEqual([]);
    expect(r.layers.get().crossSection.enabled).toBe(false);
  });

  it('Clear recording is offered while the recorder holds a picture, from the recorder\'s own state and not the last update\'s copy of it', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    r.scene.update = { resolved: { line: line([0, 0], [0, 1000]), source: 'endpoints' }, recording: recStatus({ state: 'recording', count: 8, from: 600, to: 900 }) };
    expect(t.controls().clear).toBe(false); // the recorder says nothing is held (the update is a snapshot old)
    r.recorder!.status = recStatus({ state: 'recording', count: 8, from: 600, to: 900 });
    expect(t.controls().clear).toBe(true);
    expect(t.recording()).toBe(r.recorder!.status);
  });

  it('falls back to the update\'s copy of the state where the scene does not give the recorder itself', () => {
    const r = rig({ recorder: false });
    const t = createSliceToolActions(r.host);
    r.scene.update = { resolved: { line: line([0, 0], [0, 1000]), source: 'endpoints' }, recording: recStatus({ state: 'recording', count: 3, from: 0, to: 60 }) };
    expect(t.recording()?.count).toBe(3);
    expect(t.controls().clear).toBe(true);
    r.scene.update = { resolved: { line: line([0, 0], [0, 1000]), source: 'endpoints' } };
    expect(t.recording()).toBeNull();
    expect(t.controls().clear).toBe(false);
  });

  it('Clear recording calls the recorder once, says so, and the button is gone afterwards', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    r.scene.update = { resolved: { line: line([0, 0], [0, 1000]), source: 'endpoints' } };
    r.recorder!.status = recStatus({ state: 'recording', count: 12, from: 600, to: 1500 });
    expect(t.controls().clear).toBe(true);
    t.clearRecording();
    expect(r.recorder!.clears).toBe(1);
    expect(r.said).toEqual([CLEAR_SAY]);
    expect(t.controls().clear).toBe(false);
    expect(r.calls).toEqual([]); // the line is not touched
    expect(r.recorder!.status).toMatchObject({ state: 'waiting', dropped: 'cleared' });
  });

  it('Clear recording on a scene without a recorder does nothing and says nothing', () => {
    const r = rig({ recorder: false });
    createSliceToolActions(r.host).clearRecording();
    expect(r.said).toEqual([]);
  });
});

describe('Turn off the slice (0.5.0)', () => {
  const HAND: LayerState['crossSection'] = { ...DEFAULT_LAYERS.crossSection, enabled: true, a: [-1500, 200], b: [1500, -200], preset: null, field: 'up', azimuth: 40, centre: [12, 34] };
  const OFF_STATE = { enabled: false, azimuth: 40, centre: [12, 34], field: 'up', a: undefined, b: undefined, preset: null };
  const handScene = (r: Rig): void => {
    r.layers.set({ crossSection: { ...HAND } });
    r.scene.update = { resolved: { line: line([-1500, 200], [1500, -200]), source: 'endpoints', preset: null } };
  };

  it('writes the layers store, then the scene, once each; resets the tool state; announces once', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.open();
    handScene(r);
    t.setProbe({ s: 400, z: 900 });
    const stored: number[] = [];
    r.layers.subscribe(() => stored.push(r.calls.length), ['crossSection']);
    expect(t.controls().off).toBe(true);
    t.turnOff();
    expect(r.layers.get().crossSection).toStrictEqual(OFF_STATE);
    expect(stored).toEqual([0]); // the store was written before the scene was told
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toContain('"enabled":false');
    expect(r.calls[0]).toContain('store=null'); // (the scene found the store already without the line)
    expect(r.ui.get().slice).toMatchObject({ placing: null, candidate: null, draft: { a: null, b: null }, probe: null });
    expect(r.said).toEqual([OFF_SAY]);
    expect(OFF_SAY).toBe('Slice turned off.');
  });

  it('with a recording the announcement says it was cleared, and the recorder is told by the scene (the layers write), not by a second call', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.open();
    handScene(r);
    r.recorder!.status = recStatus({ state: 'recording', count: 12, from: 600, to: 1500 });
    expect(t.controls()).toMatchObject({ off: true, clear: true });
    t.turnOff();
    expect(r.said).toEqual([OFF_CLEARED_SAY]);
    expect(r.recorder!.clears).toBe(0); // clear() is the other button's: switching the section off is what drops the recording
    expect(r.recorder!.status).toMatchObject({ count: 0, state: 'off' });
    r.scene.update = null; // the scene says null for a slice that is off
    expect(t.controls()).toMatchObject({ off: false, clear: false, keep: false });
  });

  it('the tool opened again does not switch the slice back on: the stored line went with it', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.open();
    handScene(r);
    t.turnOff();
    t.close();
    t.open();
    expect(r.layers.get().crossSection).toStrictEqual(OFF_STATE);
    expect(r.calls).toHaveLength(1); // only the turning off ever reached the scene
    // (contrast: a section the Layers panel only switched off, with its line stored, does come back when the tool opens)
    const r2 = rig({ layers: { crossSection: { ...HAND, enabled: false } } });
    createSliceToolActions(r2.host).open();
    expect(r2.layers.get().crossSection.enabled).toBe(true);
  });

  it('the probe watcher stays quiet: the probe was cleared with the line, so the tool state is written once', () => {
    const r = rig();
    const off = watchLineForProbe(r.ui, r.layers);
    const t = createSliceToolActions(r.host);
    t.open();
    handScene(r);
    t.setProbe({ s: 400, z: 900 });
    let writes = 0;
    r.ui.subscribe(() => writes++, ['slice']);
    t.turnOff();
    expect(writes).toBe(1);
    expect(r.ui.get().slice!.probe).toBeNull();
    off();
  });

  it('takes a preset, the Layers chord, a line with a draft end over it and a section only switched off in Layers with its line stored', () => {
    const preset = rig();
    const tp = createSliceToolActions(preset.host);
    tp.open();
    tp.preset('along');
    expect(tp.controls().off).toBe(true);
    tp.turnOff();
    expect(preset.layers.get().crossSection).toMatchObject({ enabled: false, preset: null, a: undefined, b: undefined });
    expect(tp.controls().off).toBe(false);

    const chord = rig({ layers: { crossSection: { ...DEFAULT_LAYERS.crossSection, enabled: true, azimuth: 90, centre: [5, 6] } } });
    chord.scene.update = { resolved: { line: line([0, -2000], [0, 2000]), source: 'centre', preset: null } };
    const tc = createSliceToolActions(chord.host);
    expect(tc.controls().off).toBe(true);
    tc.turnOff();
    expect(chord.layers.get().crossSection).toMatchObject({ enabled: false, azimuth: 90, centre: [5, 6] });

    // A draft end alone is not a slice: no button until there is a line (the sheet does not grow between "Place A here" and "Set end (B)").
    const draft = rig();
    const td = createSliceToolActions(draft.host);
    td.open();
    td.startPlacing('a');
    td.placeHere(); // A goes to the draft
    expect(td.controls()).toMatchObject({ placing: null, off: false });
    expect(draft.ui.get().slice!.draft.a).not.toBeNull();
    handScene(draft); // ... B placed: the line is there, and so is the button
    expect(td.controls().off).toBe(true);
    td.turnOff();
    expect(draft.ui.get().slice!.draft).toEqual({ a: null, b: null });
    expect(td.controls().off).toBe(false);

    const layersOff = rig({ layers: { crossSection: { ...HAND, enabled: false } } });
    const tl = createSliceToolActions(layersOff.host);
    expect(tl.controls().off).toBe(true);
    tl.turnOff();
    expect(layersOff.layers.get().crossSection).toStrictEqual(OFF_STATE);
  });

  it('is not offered with nothing to turn off, nor while a placement is under way', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.open();
    expect(t.controls().off).toBe(false);
    handScene(r);
    expect(t.controls().off).toBe(true);
    t.startPlacing('b');
    expect(t.controls().off).toBe(false);
    t.cancelPlacing();
    expect(t.controls().off).toBe(true);
  });

  it('a scene without a recorder (the 2-D map has no tool, but a test view may) still turns off, with the shorter sentence', () => {
    const r = rig({ recorder: false });
    const t = createSliceToolActions(r.host);
    t.open();
    handScene(r);
    t.turnOff();
    expect(r.said).toEqual([OFF_SAY]);
  });
});

describe('the Side view and Map view tabs (0.5.0)', () => {
  it('start on the side view, and the tab is kept in the tool\'s state across closing and opening', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.open();
    expect(r.ui.get().slice!.tab).toBe('side');
    t.setTab('map');
    expect(r.ui.get().slice!.tab).toBe('map');
    t.close();
    t.open();
    expect(r.ui.get().slice!.tab).toBe('map');
    t.setTab('side');
    expect(r.ui.get().slice!.tab).toBe('side');
  });

  it('a change of tab while placing cancels the placement (no hidden crosshair) and says so once; the draft stays', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.open();
    t.startPlacing('a');
    t.placeHere();
    t.startPlacing('b');
    r.said.length = 0;
    t.setTab('map');
    expect(r.ui.get().slice).toMatchObject({ tab: 'map', placing: null, candidate: null, draft: { a: [0, 0], b: null } });
    expect(r.said).toEqual(['Placing cancelled.']);
  });

  it('the tab already shown changes nothing and says nothing; a change with nothing placed is quiet', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.open();
    const before = r.ui.get().slice;
    t.setTab('side');
    expect(r.ui.get().slice).toBe(before);
    t.setTab('map');
    expect(r.said).toEqual([]);
    expect(r.calls).toEqual([]); // a tab is the tool's own state: the layers and the scene are not touched
  });
});

describe('presets, Swap, the chip and the switches', () => {
  it('a preset writes the live line, clears a and b explicitly and switches the section on', () => {
    const r = rig({ layers: { crossSection: { ...DEFAULT_LAYERS.crossSection, a: [0, 0], b: [0, 500], field: 'along' } } });
    const t = createSliceToolActions(r.host);
    t.preset('across');
    const cs = r.layers.get().crossSection;
    expect(cs).toMatchObject({ enabled: true, preset: 'across', a: undefined, b: undefined, field: 'along' });
    expect('a' in cs && 'b' in cs).toBe(true);
    expect(r.calls[0]).toContain('"preset":"across"');
    expect(r.said.at(-1)).toBe('Slice across the wind, through the fire.');
  });

  it('Me to fire is refused without a position fix, and so is a preset the scene says cannot be made', () => {
    const r = rig({ user: null });
    const t = createSliceToolActions(r.host);
    t.preset('me');
    expect(r.layers.get().crossSection.preset ?? null).toBeNull();
    expect(r.calls).toEqual([]);
    r.scene.update = { presets: { ...allOk(), slope: { ok: false, issue: 'flat-ground' } } };
    t.preset('slope');
    expect(r.layers.get().crossSection.preset ?? null).toBeNull();
    t.preset('along');
    expect(r.layers.get().crossSection.preset).toBe('along');
  });

  it('Me to fire works with a fix inside the model area and a fire', () => {
    const r = rig({ user: [100, 100] });
    createSliceToolActions(r.host).preset('me');
    expect(r.layers.get().crossSection.preset).toBe('me');
  });

  it('Me to fire is disabled with its reason until there is a fire, also before the scene has a slice to say so (it set the preset and drew nothing)', () => {
    const r = rig({ user: [100, 100], fire: false });
    const t = createSliceToolActions(r.host);
    expect(t.controls().presets.find((p) => p.id === 'me')).toMatchObject({ disabled: true, reason: 'There is no fire to go to yet' });
    t.preset('me');
    expect(r.layers.get().crossSection.preset ?? null).toBeNull();
    expect(r.calls).toEqual([]);
    expect(r.said).toEqual([]);
    // the other presets are not held up by it
    expect(t.controls().presets.filter((p) => !p.disabled).map((p) => p.id)).toEqual(['along', 'across', 'slope']);
    // the scene's own answer wins once it has one
    r.scene.update = { presets: allOk() };
    expect(t.controls().presets.find((p) => p.id === 'me')!.disabled).toBe(false);
  });

  it('with no position AND no fire the reason is the position (the resolver\'s order)', () => {
    const r = rig({ user: null, fire: false });
    expect(createSliceToolActions(r.host).controls().presets.find((p) => p.id === 'me')).toMatchObject({ disabled: true, reason: 'This run has no position for you' });
  });

  it('the controls disable Me to fire with its reason without a fix, and with a fix outside the area', () => {
    for (const [user, reason] of [[null, 'This run has no position for you'], [[9000, 0] as SlicePoint, 'You are outside the model area']] as const) {
      const r = rig({ user });
      const me = createSliceToolActions(r.host).controls().presets.find((p) => p.id === 'me')!;
      expect(me).toMatchObject({ disabled: true, reason });
    }
  });

  it('Swap writes the swapped hand line from the scene\'s resolved line (also for a preset)', () => {
    const r = rig({ layers: { crossSection: { ...DEFAULT_LAYERS.crossSection, enabled: true, preset: 'along', field: 'speed' } } });
    const t = createSliceToolActions(r.host);
    r.scene.update = { resolved: { line: line([-1500, 0], [1500, 0]), source: 'preset', preset: 'along' } };
    t.swap();
    expect(r.layers.get().crossSection).toMatchObject({ a: [1500, 0], b: [-1500, 0], preset: null });
  });

  it('Swap with no line does nothing', () => {
    const r = rig();
    createSliceToolActions(r.host).swap();
    expect(r.calls).toEqual([]);
  });

  it('a chip writes the field and nothing else of the section; the same chip again writes nothing', () => {
    const r = rig({ layers: { crossSection: { ...DEFAULT_LAYERS.crossSection, enabled: true, a: [0, 0], b: [0, 900], field: 'speed' } } });
    const t = createSliceToolActions(r.host);
    t.setField('theta');
    expect(r.layers.get().crossSection).toMatchObject({ enabled: true, a: [0, 0], b: [0, 900], field: 'theta' });
    t.setField('theta');
    expect(r.calls).toHaveLength(1);
  });

  it('the probe is kept in the tool\'s state and cleared when the line changes', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.setProbe({ s: 300, z: 900 });
    expect(r.ui.get().slice!.probe).toEqual({ s: 300, z: 900 });
    t.setProbe(null);
    expect(r.ui.get().slice!.probe).toBeNull();
    t.setProbe({ s: 1, z: 1 });
    t.preset('along');
    expect(r.ui.get().slice!.probe).toBeNull();
  });

  it('the model-cells switch survives closing and opening', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.setShowCells(true);
    t.close();
    t.open();
    expect(r.ui.get().slice!.showCells).toBe(true);
  });

  it('the effective chip is the scene\'s, else the stored one, else Speed', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    expect(t.field()).toBe('speed');
    r.layers.set({ crossSection: { ...r.layers.get().crossSection, field: 'smoke' } });
    expect(t.field()).toBe('smoke');
    r.scene.update = { field: 'speed' };
    expect(t.field()).toBe('speed');
  });
});

describe('the controls while placing', () => {
  it('follow the crosshair: disabled over the sky, enabled over the map', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    t.startPlacing('a');
    r.cross.at = null;
    expect(t.controls()).toMatchObject({ place: { label: 'Place A here', disabled: true }, hint: 'Move the cross over the map' });
    r.cross.at = [100, 100];
    expect(t.controls().place.disabled).toBe(false);
  });

  it('refuse a point closer to the other end than the shortest line, naming the number', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    r.scene.update = { resolved: { line: line([0, 0], [0, 1000]), source: 'endpoints', minLengthM: 266.6 } };
    t.startPlacing('b');
    r.cross.at = [0, 100];
    expect(t.controls()).toMatchObject({ place: { disabled: true }, hint: 'Make the line longer than 300 m' });
  });

  it('report the scene\'s notes and issues when idle', () => {
    const r = rig();
    const t = createSliceToolActions(r.host);
    r.scene.update = { resolved: { line: line([0, 0], [0, 1000]), source: 'preset', preset: 'along', notes: ['no-fire-centred-on-map'] } };
    expect(t.controls().hint).toBe('No fire yet: centred on the map');
    r.scene.update = { resolved: { line: null, source: 'preset', preset: 'slope', issue: 'flat-ground' } };
    expect(t.controls().hint).toBe('The ground here is too flat to have an uphill direction');
  });
});

describe('a probe is cleared when the line changes from outside the tool', () => {
  const probing = (r: Rig): void => {
    const t = createSliceToolActions(r.host);
    t.open();
    t.setProbe({ s: 800, z: 1000 });
    expect(r.ui.get().slice!.probe).not.toBeNull();
  };

  it('the Layers compass (azimuth, centre, a and b put back on the centre rule) takes the probe off, also while the tool is closed', () => {
    const r = rig({ layers: { crossSection: { ...DEFAULT_LAYERS.crossSection, enabled: true, a: [0, 0], b: [0, 1000], preset: null, field: 'speed' } } });
    const off = watchLineForProbe(r.ui, r.layers);
    probing(r);
    r.layers.set({ crossSection: { ...r.layers.get().crossSection, azimuth: 120, centre: [0, 500], a: undefined, b: undefined, preset: null } });
    expect(r.ui.get().slice!.probe).toBeNull();
    off();
  });

  it('"Show me" and a preset chosen in the Layers panel do too; a chip does not', () => {
    const r = rig({ layers: { crossSection: { ...DEFAULT_LAYERS.crossSection, enabled: true, a: [0, 0], b: [0, 1000], preset: null, field: 'speed' } } });
    const off = watchLineForProbe(r.ui, r.layers);
    probing(r);
    r.layers.set({ crossSection: { ...r.layers.get().crossSection, field: 'up' } });
    expect(r.ui.get().slice!.probe, 'a chip leaves the probe where it is').not.toBeNull();
    r.layers.set({ crossSection: { ...r.layers.get().crossSection, enabled: true, azimuth: 33, centre: [5, 5], a: undefined, b: undefined, preset: null, field: 'theta' } });
    expect(r.ui.get().slice!.probe).toBeNull();
    off();
  });

  it('the tool\'s own line writes still clear it (once: the watcher finds nothing left to do), and after unsubscribing the watcher does nothing', () => {
    const r = rig();
    const off = watchLineForProbe(r.ui, r.layers);
    const t = createSliceToolActions(r.host);
    t.open();
    t.preset('along');
    t.setProbe({ s: 100, z: 900 });
    const before = r.ui.get().slice;
    t.preset('across');
    expect(r.ui.get().slice!.probe).toBeNull();
    expect(r.ui.get().slice).not.toBe(before);
    off();
    t.setProbe({ s: 100, z: 900 });
    r.layers.set({ crossSection: { ...r.layers.get().crossSection, azimuth: 1, centre: [1, 1], preset: null } });
    expect(r.ui.get().slice!.probe, 'unsubscribed').not.toBeNull();
  });
});
