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
import {
  LAYER_PREFS_KEY,
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
