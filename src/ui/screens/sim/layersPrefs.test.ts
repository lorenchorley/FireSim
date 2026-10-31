/**
 * Remembered layer choices (layersPrefs.ts): only the user's own choices are stored and restored, damaged records are
 * cleaned, the device defaults (battery mode and low-quality renderers keep the trees still), a remembered heat map comes
 * back only where it can be shown, and the sim-screen hook applies them to the layer store and the view.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AvailabilityContext } from '../../../render/layerCatalog';
import { DEFAULT_LAYERS, type LayerState } from '../../../render/layers';
import { Store } from '../../store';
import { getPref } from '../../prefs';
import type { NightLook } from '../../../render/api';
import {
  LAYER_PREFS_KEY,
  LAYER_PREFS_VERSION,
  forgetLayerPrefs,
  layerDefaults,
  loadLayerPrefs,
  rememberLayerChoice,
  resetLayerPrefsCache,
  restoreLayerPrefs,
  restorePatch,
  sanitizeLayerPrefs,
} from './layersPrefs';

const ALL: AvailabilityContext = { hasFire: true, has3dAtmosphere: true, hasContext: true, hasGrass: true, hasCanopyData: true, hasImagery: true, hasHomes: true, hasRoads: true };

beforeEach(async () => {
  resetLayerPrefsCache();
  await forgetLayerPrefs();
  resetLayerPrefsCache();
});

describe('sanitise', () => {
  it('keeps well-formed choices and drops everything else', () => {
    const p = sanitizeLayerPrefs({
      v: 1,
      layers: { roads: false, homes: 'yes', overlay: 'slope', wind: 'gale', canopyStyle: 'coded', canopyCode: 'bark', overlayOpacity: 7, isochroneMinutes: 17, verticalExaggeration: 2, crossSection: { enabled: true }, legend: false },
      plainGround: true,
      groups: { Places: true, x: 'no' },
    });
    expect(p.layers).toEqual({ roads: false, overlay: 'slope', canopyStyle: 'coded', canopyCode: 'bark', overlayOpacity: 1, verticalExaggeration: 2 });
    expect(p.plainGround).toBe(true);
    expect(p.groups).toEqual({ Places: true });
    expect(sanitizeLayerPrefs(null).layers).toEqual({});
    expect(sanitizeLayerPrefs({ v: 99, layers: { roads: false } }).layers).toEqual({});
    expect(sanitizeLayerPrefs({ v: 1, layers: { overlay: 'nope' } }).layers).toEqual({});
  });
});

describe('device defaults', () => {
  it('battery mode: no smoke, no canopy, no sway; a low-quality renderer keeps the trees still; otherwise they sway', () => {
    const bat = layerDefaults({ performance: 'battery', hasImagery: true });
    expect([bat.smoke, bat.vegetation, bat.windSway]).toEqual([false, false, false]);
    expect(layerDefaults({ performance: 'auto', renderQuality: 'low', hasImagery: true }).windSway).toBe(false);
    const auto = layerDefaults({ performance: 'auto', renderQuality: 'medium', hasImagery: false });
    expect([auto.smoke, auto.vegetation, auto.windSway, auto.imagery]).toEqual([true, true, true, false]);
    expect(auto.crossSection).not.toBe(DEFAULT_LAYERS.crossSection);
  });
});

describe('restore patch', () => {
  it('a remembered heat map comes back only where it can be shown; the photo only where there is one', () => {
    const prefs = sanitizeLayerPrefs({ v: 1, layers: { overlay: 'arrival', imagery: true, roads: false } });
    expect(restorePatch(prefs, { availability: { ...ALL, hasFire: false }, hasImagery: false })).toEqual({ roads: false });
    expect(restorePatch(prefs, { availability: ALL, hasImagery: true })).toEqual({ overlay: 'arrival', imagery: true, roads: false });
    const homes = sanitizeLayerPrefs({ v: 1, layers: { overlay: 'homeDensity' } });
    expect(restorePatch(homes, { availability: { ...ALL, hasContext: false, hasHomes: false }, hasImagery: true })).toEqual({});
    expect(restorePatch(sanitizeLayerPrefs({ v: 1, layers: { overlay: 'none' } }), { availability: ALL, hasImagery: true })).toEqual({ overlay: 'none' });
  });
});

describe('storage', () => {
  it('merges choices, remembers the map type and the open groups, and forgets on reset', async () => {
    await rememberLayerChoice({ layers: { roads: false } });
    await rememberLayerChoice({ layers: { homes: true, crossSection: { enabled: true, azimuth: 0, centre: [0, 0] } } as Partial<LayerState> });
    await rememberLayerChoice({ plainGround: true, groups: { Places: true } });
    resetLayerPrefsCache();
    const p = await loadLayerPrefs();
    expect(p.layers).toEqual({ roads: false, homes: true });
    expect(p.plainGround).toBe(true);
    expect(p.groups).toEqual({ Places: true });
    expect(await getPref(LAYER_PREFS_KEY, null)).not.toBeNull();
    await forgetLayerPrefs();
    resetLayerPrefsCache();
    expect((await loadLayerPrefs()).layers).toEqual({});
  });

  it('the sim-screen hook applies the defaults and the remembered choices to the store and the view (never pausing)', async () => {
    await rememberLayerChoice({ layers: { roads: false, canopyStyle: 'simple', overlay: 'slope' }, plainGround: true });
    resetLayerPrefsCache();
    const layers = new Store<LayerState>({ ...DEFAULT_LAYERS, crossSection: { ...DEFAULT_LAYERS.crossSection } });
    const applied: Partial<LayerState>[] = [];
    let plain: boolean | null = null;
    const view = { setLayers: (p: Partial<LayerState>) => applied.push(p), setPlainGround: (on: boolean) => (plain = on), hasImagery: true, renderQuality: 'low' as const };
    let paused = false;
    const ctx = {
      view,
      scenario: { fuel: { type: new Uint8Array(4), sources: [] }, context: null, datasets: [] },
      layers,
      settings: new Store({ performance: 'auto' }),
      session: { state: new Store({ snapshot: null, ignitions: [] }), pause: () => (paused = true) },
    };
    const off = restoreLayerPrefs(ctx as never);
    await loadLayerPrefs();
    await new Promise((r) => setTimeout(r, 0));
    off();
    expect(layers.get().roads).toBe(false);
    expect(layers.get().canopyStyle).toBe('simple');
    expect(layers.get().overlay).toBe('slope');
    expect(layers.get().windSway).toBe(false); // low-quality renderer default
    expect(applied.length).toBe(1);
    expect(applied[0]).toMatchObject({ roads: false, canopyStyle: 'simple', overlay: 'slope', windSway: false });
    expect(plain).toBe(true);
    expect(paused).toBe(false);
  });
});

describe('night lighting (a view setting, remembered with the map type)', () => {
  it('sanitise keeps a valid look, drops a damaged one, stays at version 1 and ignores unknown keys', () => {
    expect(LAYER_PREFS_VERSION).toBe(1);
    for (const look of ['realistic', 'brighter', 'daylight']) expect(sanitizeLayerPrefs({ v: 1, layers: {}, nightLook: look }).nightLook).toBe(look);
    for (const bad of ['dusk', 'Daylight', '', 3, null, true, {}, ['daylight']]) expect(sanitizeLayerPrefs({ v: 1, layers: { roads: false }, nightLook: bad })).toEqual({ v: 1, layers: { roads: false } });
    // An old record has no look (nothing remembered: Realistic), a record of another version is dropped as a whole, and keys
    // this version does not know are ignored rather than carried along.
    expect(sanitizeLayerPrefs({ v: 1, layers: {} }).nightLook).toBeUndefined();
    expect(sanitizeLayerPrefs({ v: 2, layers: {}, nightLook: 'daylight' })).toEqual({ v: 1, layers: {} });
    expect(sanitizeLayerPrefs({ v: 1, layers: {}, nightLook: 'brighter', nightColour: 'blue', extra: { a: 1 } })).toEqual({ v: 1, layers: {}, nightLook: 'brighter' });
    // A look is not a LayerState key: it is not taken from `layers`.
    expect(sanitizeLayerPrefs({ v: 1, layers: { nightLook: 'daylight' } })).toEqual({ v: 1, layers: {} });
  });

  it('is remembered next to the other choices, replaced by the next choice, kept when others change, and forgotten on reset', async () => {
    await rememberLayerChoice({ nightLook: 'daylight' });
    await rememberLayerChoice({ layers: { roads: false }, plainGround: true });
    resetLayerPrefsCache();
    let p = await loadLayerPrefs();
    expect(p.nightLook).toBe('daylight');
    expect(p.layers).toEqual({ roads: false });
    expect(p.plainGround).toBe(true);
    expect((await getPref<{ nightLook?: string } | null>(LAYER_PREFS_KEY, null))?.nightLook).toBe('daylight');
    await rememberLayerChoice({ nightLook: 'realistic' }); // choosing today's look again is a choice too
    resetLayerPrefsCache();
    p = await loadLayerPrefs();
    expect(p.nightLook).toBe('realistic');
    await forgetLayerPrefs();
    resetLayerPrefsCache();
    expect((await loadLayerPrefs()).nightLook).toBeUndefined();
  });

  const hookCtx = (view: object): never =>
    ({
      view,
      scenario: { fuel: { type: new Uint8Array(4), sources: [] }, context: null, datasets: [] },
      layers: new Store<LayerState>({ ...DEFAULT_LAYERS, crossSection: { ...DEFAULT_LAYERS.crossSection } }),
      settings: new Store({ performance: 'auto' }),
      session: { state: new Store({ snapshot: null, ignitions: [] }) },
    }) as never;
  const runHook = async (view: object): Promise<void> => {
    const off = restoreLayerPrefs(hookCtx(view));
    await loadLayerPrefs();
    await new Promise((r) => setTimeout(r, 0));
    off();
  };

  it('the sim-screen hook gives the remembered look to the view, and does nothing when none was chosen or the view has no night', async () => {
    await rememberLayerChoice({ nightLook: 'brighter' });
    resetLayerPrefsCache();
    const looks: NightLook[] = [];
    await runHook({ setLayers: () => undefined, setNightLook: (l: NightLook) => looks.push(l), hasImagery: true });
    expect(looks).toEqual(['brighter']);
    resetLayerPrefsCache();
    await runHook({ setLayers: () => undefined, hasImagery: true }); // the 2-D map: no method, no error

    await forgetLayerPrefs();
    resetLayerPrefsCache();
    looks.length = 0;
    await runHook({ setLayers: () => undefined, setNightLook: (l: NightLook) => looks.push(l), hasImagery: true });
    expect(looks).toEqual([]); // nothing remembered: the view keeps its own default
  });
});

describe('wind arrows and flow lines (0.5.0: the switch and its height are remembered like the streaks)', () => {
  it('sanitise keeps the switch as a boolean and the height as Ground or one of the five heights, and drops everything else', () => {
    expect(sanitizeLayerPrefs({ v: 1, layers: { windGlyphs: true, windHeight: 300 } }).layers).toEqual({ windGlyphs: true, windHeight: 300 });
    expect(sanitizeLayerPrefs({ v: 1, layers: { windGlyphs: false, windHeight: 'fire' } }).layers).toEqual({ windGlyphs: false, windHeight: 'fire' });
    for (const h of [50, 100, 300, 1000, 2000]) expect(sanitizeLayerPrefs({ v: 1, layers: { windHeight: h } }).layers).toEqual({ windHeight: h });
    expect(sanitizeLayerPrefs({ v: 1, layers: { windHeight: 'felt' } }).layers).toEqual({ windHeight: 'felt' }); // What the fire feels (0.7.0), and a saved 'fire' (10 m) is still kept above
    // 10 m is not a choice (the sampler clamps below its first level), and a chip's string value is not what is stored.
    for (const bad of [10, 0, -50, 150, 1e9, NaN, Infinity, '50', '300', 'Fire', 'ground', '', null, true, {}, [100]]) expect(sanitizeLayerPrefs({ v: 1, layers: { windHeight: bad } }).layers, String(bad)).toEqual({});
    for (const bad of ['on', 'yes', 1, 0, null, {}]) expect(sanitizeLayerPrefs({ v: 1, layers: { windGlyphs: bad } }).layers, String(bad)).toEqual({});
  });

  it('is additive: the version stays 1, so nobody’s remembered layers are wiped, and an old record simply has neither key', () => {
    expect(LAYER_PREFS_VERSION).toBe(1);
    expect(sanitizeLayerPrefs({ v: 1, layers: { roads: false, wind: 'volume' } }).layers).toEqual({ roads: false, wind: 'volume' });
    expect(sanitizeLayerPrefs({ v: 1, layers: { roads: false, windGlyphs: true } }).layers).toEqual({ roads: false, windGlyphs: true });
  });

  it('round trips through the store and back (numbers stay numbers), and Reset forgets them', async () => {
    await rememberLayerChoice({ layers: { windGlyphs: true } });
    await rememberLayerChoice({ layers: { windHeight: 1000 } });
    await rememberLayerChoice({ layers: { roads: false } });
    resetLayerPrefsCache();
    expect((await loadLayerPrefs()).layers).toEqual({ windGlyphs: true, windHeight: 1000, roads: false });
    const stored = await getPref<{ layers: Record<string, unknown> } | null>(LAYER_PREFS_KEY, null);
    expect(stored?.layers.windHeight).toBe(1000);
    await rememberLayerChoice({ layers: { windHeight: 'fire', windGlyphs: false } }); // choosing the defaults again is a choice too
    resetLayerPrefsCache();
    expect((await loadLayerPrefs()).layers).toMatchObject({ windGlyphs: false, windHeight: 'fire' });
    await forgetLayerPrefs();
    resetLayerPrefsCache();
    expect((await loadLayerPrefs()).layers).toEqual({});
  });

  it('the sim-screen hook puts the remembered switch and height on the store and the view, and leaves the defaults alone when nothing was chosen', async () => {
    await rememberLayerChoice({ layers: { windGlyphs: true, windHeight: 100 } });
    resetLayerPrefsCache();
    const layers = new Store<LayerState>({ ...DEFAULT_LAYERS, crossSection: { ...DEFAULT_LAYERS.crossSection } });
    const applied: Partial<LayerState>[] = [];
    const ctx = {
      view: { setLayers: (p: Partial<LayerState>) => applied.push(p), hasImagery: true, renderQuality: 'medium' as const },
      scenario: { fuel: { type: new Uint8Array(4), sources: [] }, context: null, datasets: [] },
      layers,
      settings: new Store({ performance: 'auto' }),
      session: { state: new Store({ snapshot: null, ignitions: [] }) },
    };
    const off = restoreLayerPrefs(ctx as never);
    await loadLayerPrefs();
    await new Promise((r) => setTimeout(r, 0));
    off();
    expect([layers.get().windGlyphs, layers.get().windHeight]).toEqual([true, 100]);
    expect(applied[0]).toMatchObject({ windGlyphs: true, windHeight: 100 });
    await forgetLayerPrefs();
    resetLayerPrefsCache();
    const fresh = new Store<LayerState>({ ...DEFAULT_LAYERS, crossSection: { ...DEFAULT_LAYERS.crossSection } });
    const off2 = restoreLayerPrefs({ ...ctx, layers: fresh } as never);
    await loadLayerPrefs();
    await new Promise((r) => setTimeout(r, 0));
    off2();
    expect([fresh.get().windGlyphs, fresh.get().windHeight]).toEqual([false, 'felt']); // (the default is What the fire feels since 0.7.0)
  });
});
