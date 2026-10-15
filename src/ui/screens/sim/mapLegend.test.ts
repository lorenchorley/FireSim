/** The legend card on the map follows what the air slice is coloured by (the chip chosen, or the one the air allows). */
import { describe, expect, it } from 'vitest';
import type { AtmosphereView } from '../../../core/types';
import { DEFAULT_LAYERS, type LayerState } from '../../../render/layers';
import { crossSectionLegend, sliceLegend } from '../../../render/legends';
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
    expect(currentMapLegend(ctxFor(lite('prognostic', true), {}), 0)!.title).toBe('Warmer or cooler than the area at that height');
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
