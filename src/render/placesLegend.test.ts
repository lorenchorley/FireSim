import { describe, expect, it } from 'vitest';
import { EMPTY_CONTEXT, type ContextLayers } from '../core/places';
import { placesLegend } from './placesLegend';

const origin = { lat: -33.7, lon: 150.3 };

describe('placesLegend', () => {
  it('explains the fire trail in plain English with a white halo', () => {
    const g = placesLegend({ fireTrails: true });
    expect(g).toHaveLength(1);
    expect(g[0]!.entries[0]).toMatchObject({ label: 'Fire trail (RFS classified)', swatch: 'dashed', outline: '#ffffff' });
  });

  it('lists only what is on, in a stable order', () => {
    expect(placesLegend({})).toEqual([]);
    const all = placesLegend({ roads: true, fireTrails: true, homes: true, zones: true, placeNames: true });
    expect(all.map((g) => g.layer)).toEqual(['roads', 'fireTrails', 'homes', 'zones', 'placeNames']);
    expect(all[0]!.entries.map((e) => e.swatch)).toEqual(['line', 'line', 'dashed', 'dotted']);
    expect(all[3]!.entries).toHaveLength(7);
  });

  it('shows only the kinds present in the scenario', () => {
    const ctx: ContextLayers = {
      ...EMPTY_CONTEXT(origin),
      roads: [{ cls: 'local', surface: 1, xy: new Float32Array(4), lengthM: 1 }],
      zones: [{ code: 'R2', kind: 'residential', name: 'x', rings: [] }],
      homes: Float32Array.from([1, 2]),
    };
    const g = placesLegend({ roads: true, fireTrails: true, homes: true, zones: true, placeNames: true }, ctx);
    expect(g.map((x) => x.layer)).toEqual(['roads', 'homes', 'zones']);
    expect(g[0]!.entries.map((e) => e.label)).toEqual(['Street or local road']);
    expect(g[2]!.entries.map((e) => e.label)).toEqual(['Residential (houses)']);
  });
});
