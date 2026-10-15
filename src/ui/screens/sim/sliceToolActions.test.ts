/**
 * What the Air slices tool writes to the app (sliceToolActions.ts), with the real stores and a fake scene: the line goes into
 * `LayerState.crossSection` (a and b together, preset null, Speed first, an explicit undefined for what a preset clears), into the
 * scene through `setLayers`, the tool's own state into `UiState.slice`, in an order that lets the scene call back safely.
 */
import { describe, expect, it } from 'vitest';
import type { GridSpec } from '../../../core/grid';
import type { SceneViewApi } from '../../../render/api';
import { DEFAULT_LAYERS, type LayerState } from '../../../render/layers';
import type { ResolvedSlice, SlicePoint, SlicePresetId, SlicePresetStatus, SliceUpdate } from '../../../render/slice/types';
import { Store } from '../../store';
import { DEFAULT_UI, type UiState } from './context';
import { backFromAirTool, createSliceToolActions, type SliceToolHost } from './sliceToolActions';

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
  scene: { update: Partial<SliceUpdate> & { resolved?: Partial<ResolvedSlice> } | null };
}

function rig(opts: { user?: SlicePoint | null; layers?: Partial<LayerState> } = {}): Rig {
  const ui = new Store<UiState>({ ...DEFAULT_UI, wind: { ...DEFAULT_UI.wind }, tool: 'air', panelOpen: true });
  const layers = new Store<LayerState>({ ...DEFAULT_LAYERS, crossSection: { ...DEFAULT_LAYERS.crossSection }, ...opts.layers });
  const calls: string[] = [];
  const said: string[] = [];
  const cross: Rig['cross'] = { at: [0, 0] };
  const scene: Rig['scene'] = { update: null };
  const view: Pick<SceneViewApi, 'setLayers' | 'slice'> = {
    setLayers(p) {
      // The scene calls back inside setLayers: the stores must already hold the new section by then.
      calls.push(`view ${JSON.stringify(p.crossSection)} store=${JSON.stringify(layers.get().crossSection.a ?? null)}`);
    },
    slice: () => (scene.update ? ({ field: 'speed', presets: allOk(), fields: {}, data: null, ...scene.update, resolved: { line: null, source: 'endpoints', preset: null, issue: null, notes: [], minLengthM: 300, ...scene.update.resolved } } as unknown as SliceUpdate) : null),
  };
  const host: SliceToolHost = { ui, layers, view, grid: () => GRID, crosshair: () => cross.at, user: opts.user === undefined ? [200, 200] : opts.user, announce: (m) => said.push(m) };
  return { host, ui, layers, calls, said, cross, scene };
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

  it('Me to fire works with a fix inside the model area', () => {
    const r = rig({ user: [100, 100] });
    createSliceToolActions(r.host).preset('me');
    expect(r.layers.get().crossSection.preset).toBe('me');
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
