/** The legend card on the map follows what the air slice is coloured by (the chip chosen, or the one the air allows). */
import { describe, expect, it } from 'vitest';
import type { AtmosphereView } from '../../../core/types';
import { DEFAULT_LAYERS, type LayerState } from '../../../render/layers';
import { crossSectionLegend, sliceLegend, windGlyphLegend, windLegend } from '../../../render/legends';
import { currentMapLegend } from './mapLegend';

const lite = (kind: 'prognostic' | 'diagnosed' | 'surface', withThetaAndSmoke: boolean): AtmosphereView => {
  const n = kind === 'surface' ? 0 : 3 * 3 * 2;
  const f = (len: number): Float32Array => new Float32Array(len);
  return { grid: { nx: 3, ny: 3, x0: 0, y0: 0, cellSize: 100 }, nz: kind === 'surface' ? 0 : 2, kind, u: f(n), v: f(n), w: f(n), thetaAnomaly: f(withThetaAndSmoke ? n : 0), smoke: f(withThetaAndSmoke ? n : 0) } as unknown as AtmosphereView;
};

function ctxFor(air: AtmosphereView | null, crossSection: Partial<LayerState['crossSection']>, withSlice = true): Parameters<typeof currentMapLegend>[0] {
  const layers: LayerState = { ...DEFAULT_LAYERS, wind: 'off', crossSection: { ...DEFAULT_LAYERS.crossSection, enabled: true, ...crossSection } };
  return {
    layers: { get: () => layers },
    legendProvider: null,
    sceneLegends: { crossSection: crossSectionLegend, wind: () => ({ title: 'wind', units: '', kind: 'continuous', entries: [] }), ...(withSlice ? { slice: sliceLegend } : {}) },
    scenario: { terrain: { minElevation: 0, maxElevation: 1 } },
    session: { state: { get: () => ({ snapshot: air ? { atmosphere: air } : null }) } },
    view: {},
  } as unknown as Parameters<typeof currentMapLegend>[0];
}

describe('the map legend of the air slice', () => {
  it('shows the chip chosen on the 3-D atmosphere', () => {
    expect(currentMapLegend(ctxFor(lite('prognostic', true), { field: 'along' }), 0)!.title).toBe('Wind along the line');
    expect(currentMapLegend(ctxFor(lite('prognostic', true), { field: 'up' }), 0)!.title).toBe('Air going up or down');
  });

  it('with no chip chosen it is the original colouring: temperature on the 3-D atmosphere, wind speed on the fast model', () => {
    expect(currentMapLegend(ctxFor(lite('prognostic', true), {}), 0)!.title).toBe('Warmer or cooler than the average of the slice at that height');
    expect(currentMapLegend(ctxFor(lite('diagnosed', false), {}), 0)!.title).toBe('Wind speed');
  });

  it('a chip the fast model cannot give falls back to wind speed, as the curtain does', () => {
    expect(currentMapLegend(ctxFor(lite('diagnosed', false), { field: 'theta' }), 0)!.title).toBe('Wind speed');
    expect(currentMapLegend(ctxFor(lite('diagnosed', false), { field: 'smoke' }), 0)!.title).toBe('Wind speed');
    expect(currentMapLegend(ctxFor(lite('diagnosed', false), { field: 'across' }), 0)!.title).toBe('Wind across the line');
  });

  it('says what the fast model is, in the legend note', () => {
    const l = currentMapLegend(ctxFor(lite('diagnosed', false), { field: 'speed' }), 0)!;
    expect(l.about).toContain('Diagnosed wind: terrain effects only');
  });

  it('keeps the original temperature legend before the first picture of the air, and when the scene has no slice legend', () => {
    expect(currentMapLegend(ctxFor(null, { field: 'along' }), 0)!.title).toBe(crossSectionLegend().title);
    expect(currentMapLegend(ctxFor(lite('prognostic', true), { field: 'along' }, false), 0)!.title).toBe(crossSectionLegend().title);
  });

  it('shows nothing for the section when it is off', () => {
    expect(currentMapLegend(ctxFor(lite('prognostic', true), { enabled: false }), 0)).toBeNull();
  });
});

describe('the map legend of the wind arrows and flow lines (0.5.0)', () => {
  const heat = { overlay: 'slope' } as const;
  const ctxWith = (over: Partial<LayerState>, opts: { glyphs?: boolean; canopy?: boolean; viewMode?: 'orbit' | 'top' | 'ground' } = {}): Parameters<typeof currentMapLegend>[0] => {
    const layers: LayerState = { ...DEFAULT_LAYERS, wind: 'off', crossSection: { ...DEFAULT_LAYERS.crossSection }, ...over };
    return {
      layers: { get: () => layers },
      legendProvider: null,
      sceneLegends: {
        crossSection: crossSectionLegend,
        wind: windLegend,
        slice: sliceLegend,
        ...(opts.glyphs === false ? {} : { windGlyphs: windGlyphLegend }),
      },
      scenario: { terrain: { minElevation: 0, maxElevation: 1 } },
      session: { state: { get: () => ({ snapshot: { atmosphere: lite('prognostic', true) } }) } },
      ui: { get: () => ({ viewMode: opts.viewMode ?? 'orbit' }) },
      view: opts.canopy ? { canopyLegend: () => ({ title: 'Trees coloured by height', units: 'm', kind: 'continuous', entries: [{ value: 0, colour: '#000000', label: '0' }] }) } : {},
    } as unknown as Parameters<typeof currentMapLegend>[0];
  };

  it('says which wind it is: near the ground for Ground, else the height, and the ramp is the wind-speed ramp in km/h', () => {
    expect(currentMapLegend(ctxWith({ windGlyphs: true, windHeight: 'fire' }), 0)!.title).toBe('Wind near the ground');
    expect(currentMapLegend(ctxWith({ windGlyphs: true, windHeight: 100 }), 0)!.title).toBe('Wind at 100 m');
    expect(currentMapLegend(ctxWith({ windGlyphs: true, windHeight: 1000 }), 0)!.title).toBe('Wind at 1 km');
    const l = currentMapLegend(ctxWith({ windGlyphs: true, windHeight: 300 }), 0)!;
    expect(l.kind).toBe('ramp');
    expect(l.kind === 'ramp' && l.unit).toBe('km/h');
    expect(l.kind === 'ramp' && l.stops.map((x) => x.label)).toEqual(windLegend('surface').entries.map((e) => e.label));
  });

  it('shows nothing when the arrows are off, and the streaks’ legend when only they are on', () => {
    expect(currentMapLegend(ctxWith({ windGlyphs: false }), 0)).toBeNull();
    expect(currentMapLegend(ctxWith({ windGlyphs: false, wind: 'surface' }), 0)!.title).toBe(windLegend('surface').title);
  });

  it('comes after the heat map, the coded trees and the slice, and before the streaks', () => {
    const on = { windGlyphs: true, windHeight: 100 as const, wind: 'surface' as const };
    expect(currentMapLegend(ctxWith(on), 0)!.title).toBe('Wind at 100 m'); // glyphs before streaks
    expect(currentMapLegend(ctxWith({ ...on, crossSection: { ...DEFAULT_LAYERS.crossSection, enabled: true, field: 'along' } }), 0)!.title).toBe('Wind along the line');
    expect(currentMapLegend(ctxWith({ ...on, vegetation: true, canopyStyle: 'coded' }, { canopy: true }), 0)!.title).toBe('Trees coloured by height');
    expect(currentMapLegend(ctxWith({ ...on, overlay: heat.overlay }), 0)!.title).not.toBe('Wind at 100 m'); // a heat map beats everything
  });

  it('follows the switch, not the picture: before any air exists it is shown as the streaks’ legend is (the control says "Waiting for the wind picture.")', () => {
    const before = { ...ctxWith({ windGlyphs: true, windHeight: 100 }), session: { state: { get: () => ({ snapshot: null }) } } } as unknown as Parameters<typeof currentMapLegend>[0];
    expect(currentMapLegend(before, 0)!.title).toBe('Wind at 100 m');
    const streaks = { ...ctxWith({ wind: 'surface' }), session: { state: { get: () => ({ snapshot: null }) } } } as unknown as Parameters<typeof currentMapLegend>[0];
    expect(currentMapLegend(streaks, 0)!.title).toBe(windLegend('surface').title);
  });

  it('at eye level nothing is drawn, so there is no card for the arrows there: none, or the streaks’ legend when they are on; the 3-D and top views have it', () => {
    const glyphs = { windGlyphs: true, windHeight: 100 as const };
    expect(currentMapLegend(ctxWith(glyphs, { viewMode: 'ground' }), 0)).toBeNull();
    expect(currentMapLegend(ctxWith({ ...glyphs, wind: 'surface' }, { viewMode: 'ground' }), 0)!.title).toBe(windLegend('surface').title);
    for (const viewMode of ['orbit', 'top'] as const) expect(currentMapLegend(ctxWith(glyphs, { viewMode }), 0)!.title, viewMode).toBe('Wind at 100 m');
    // Only the arrows' card gives way: a heat map, the slice or the coded trees are drawn at eye level as anywhere.
    expect(currentMapLegend(ctxWith({ ...glyphs, overlay: heat.overlay }, { viewMode: 'ground' }), 0)).not.toBeNull();
    expect(currentMapLegend(ctxWith({ ...glyphs, crossSection: { ...DEFAULT_LAYERS.crossSection, enabled: true, field: 'along' } }, { viewMode: 'ground' }), 0)!.title).toBe('Wind along the line');
  });

  it('with a scene that has no glyph legend (an older render module) the streaks’ legend stands, and the 2-D map (no scene legends) shows none', () => {
    expect(currentMapLegend(ctxWith({ windGlyphs: true, wind: 'surface' }, { glyphs: false }), 0)!.title).toBe(windLegend('surface').title);
    expect(currentMapLegend({ ...ctxWith({ windGlyphs: true }), sceneLegends: null }, 0)).toBeNull();
  });
});
