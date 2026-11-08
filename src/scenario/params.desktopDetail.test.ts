/**
 * The builder's side of the Desktop detail (0.9.0, D35): `builtFireCell` with no level is exactly 0.8.0's rule (the table below was written from the
 * 0.8.0 code before the level existed), a level sets its own cell at any extent the builder takes for it, and a request with a level and an area
 * beyond what 15e measured is refused rather than coarsened (nothing is lowered silently).
 */
import { describe, expect, it } from 'vitest';
import type { ScenarioRequest } from './request';
import { resolveOptions, resolveRequest } from './build';
import { builtFireCell, SCENARIO_PARAMS } from './params';

const KAT = { lat: -33.7, lon: 150.3 };
const base: ScenarioRequest = { centre: KAT, extent: 6000, weather: { kind: 'now' }, duration: 14400, online: true };

describe('builtFireCell with no level is 0.8.0\'s rule', () => {
  // [extent m, requested cell, tier, expected cell, coarsened]: the cases of 0.8.0's own tests and the edges of its rule.
  const table: [number, number | undefined, string | undefined, number, boolean][] = [
    [6000, undefined, undefined, 30, false],
    [6000, 30, 'auto', 30, false],
    [6000, 20, undefined, 20, false],
    [6000, undefined, 'high', 20, false],
    [9000, 20, undefined, 30, true],
    [9000, undefined, 'high', 30, true],
    [3000, 20, 'fast', 20, false],
    [6001, 20, undefined, 30, true],
    [6000, 40, undefined, 30, false],
    [12000, undefined, 'standard', 30, false],
  ];
  for (const [extent, requested, tier, cellM, coarsened] of table)
    it(`${extent} m, asked ${requested ?? 'nothing'}, tier ${tier ?? 'none'}: ${cellM} m${coarsened ? ' (coarsened)' : ''}`, () => {
      expect(builtFireCell(extent, requested, tier)).toEqual({ cellM, coarsened });
      expect(builtFireCell(extent, requested, tier, undefined)).toEqual({ cellM, coarsened });
    });
});

describe('a level sets its own cell', () => {
  it('20 m and 10 m at every area, with every tier and every requested cell, never coarsened', () => {
    for (const extent of [3000, 6000, 9000, 12000])
      for (const tier of [undefined, 'fast', 'standard', 'high'])
        for (const requested of [undefined, 20, 30, 40]) {
          expect(builtFireCell(extent, requested, tier, 'finer')).toEqual({ cellM: 20, coarsened: false });
          expect(builtFireCell(extent, requested, tier, 'finest')).toEqual({ cellM: 10, coarsened: false });
        }
  });

  it('both are whole multiples of the 10 m ground model, so the builder needs no new elevation grid', () => {
    for (const cell of Object.values(SCENARIO_PARAMS.desktopDetailCellM)) {
      expect(cell % SCENARIO_PARAMS.hiResCellM).toBe(0);
      for (const extent of [3000, 6000, 9000]) expect(extent % cell).toBe(0);
    }
  });
});

describe('resolveRequest with a level', () => {
  it('builds the level\'s cell with no warning, at the areas Setup offers, and keeps the extent', () => {
    for (const [level, cell] of [['finer', 20], ['finest', 10]] as const)
      for (const extent of [3000, 6000, 9000]) {
        const r = resolveRequest({ ...base, extent, options: { desktopDetail: level, fireCellSize: cell } });
        expect(r.fireCellSize).toBe(cell);
        expect(r.extent).toBe(extent);
        expect(r.warnings).toEqual([]);
      }
  });

  it('refuses an area beyond the 9 km that 15e measured, instead of coarsening the grid and keeping the label', () => {
    expect(SCENARIO_PARAMS.desktopDetailMaxExtentM).toBe(9000);
    expect(() => resolveRequest({ ...base, extent: 9001, options: { desktopDetail: 'finest' } })).toThrow(/9 km or less/);
    expect(() => resolveRequest({ ...base, extent: 12000, options: { desktopDetail: 'finer' } })).toThrow(RangeError);
    // Without a level the 12 km area is still the builder's own business, as in 0.8.0.
    expect(resolveRequest({ ...base, extent: 12000 }).extent).toBe(12000);
  });

  it('is the same request with the same answer when no level is given', () => {
    const r = resolveRequest({ ...base, extent: 9000, options: { fireCellSize: 20 } });
    expect(r.fireCellSize).toBe(30);
    expect(r.warnings).toHaveLength(1);
  });
});

describe('resolveOptions carries the record', () => {
  it('desktopDetail and the level\'s embers reach the scenario\'s options; with no level there is no such key', () => {
    const o = resolveOptions({ ...base, options: { desktopDetail: 'finest', maxEmbers: 8000, fireCellSize: 10 } }, 6000, 10);
    expect(o).toMatchObject({ desktopDetail: 'finest', maxEmbers: 8000, fireCellSize: 10, tier: 'auto' });
    const plain = resolveOptions(base, 6000, 30);
    expect('desktopDetail' in plain).toBe(false);
    expect(plain.maxEmbers).toBe(4000);
  });
});
