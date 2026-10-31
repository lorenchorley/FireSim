/**
 * What the fire feels (0.7.0) in the Wind detail sheet and its chip: the words name the fire model's own cells (not the air model's), the eddies are
 * still said to be added for looks, and the "cells" limit follows the cell of the data that is drawn.
 */
import { describe, expect, it } from 'vitest';
import type { WindGlyphStats } from '../../../render/api';
import { heightLabel } from './glyphWords';
import { windDetailState, type DetailKind, type DetailLimit, type WindDetailInput, type WindDetailState } from './windDetailState';
import { EDDIES_LINE, MOST_DETAILED_LINE, ZOOM_LINE, windDetailWords } from './windDetailWords';

const state = (level: WindDetailState['level'], kind: DetailKind, limits: DetailLimit[] = []): WindDetailState => ({ visible: true, level, kind, limits, key: 'k' });
const felt = (s: WindDetailState, feltCellM: number | null | undefined = 60): string[] => windDetailWords(s, { heightLabel: heightLabel('felt'), height: 'felt', cellM: 133.33, feltCellM }).lines;
const words = (s: WindDetailState, height: 'fire' | 300): string[] => windDetailWords(s, { heightLabel: heightLabel(height), height, cellM: 133.33 }).lines;

describe('the words', () => {
  it('level 3: the wind the fire feels, in its cells about 60 m wide, and a smooth fit between them once they are wider than 60 px', () => {
    expect(felt(state(3, 'curves', ['zoom', 'cells']))).toEqual([
      'Level 3 of 4: curved flow lines.',
      'The wind the fire feels, in cells about 60 m wide.',
      ZOOM_LINE,
      'The wind the fire model uses is in cells about 60 m wide. Between its points the wind is a smooth fit.',
    ]);
  });

  it('level 4: the direction and speed are the air model’s with the fire model’s additions, and the eddies are still said to be added for looks', () => {
    expect(felt(state(4, 'detailed', ['cells']))).toEqual([
      'Level 4 of 4: detailed streaks.',
      'The wind the fire feels, in cells about 60 m wide.',
      MOST_DETAILED_LINE,
      "Direction and speed come from the air model, with the fire model's slope flow and the fire's own effect on the wind added, in cells about 60 m wide.",
      EDDIES_LINE,
    ]);
  });

  it('takes the cell from the scenario (an 80 m cell is said as 80 m), and says 60 m when the layer has not said', () => {
    expect(felt(state(1, 'arrows', ['zoom']), 80)[1]).toBe('The wind the fire feels, in cells about 80 m wide.');
    for (const none of [null, undefined]) expect(felt(state(1, 'arrows', ['zoom']), none)[1]).toBe('The wind the fire feels, in cells about 60 m wide.');
  });

  it('the 10 m and numbered heights are said as before', () => {
    expect(words(state(1, 'arrows', ['zoom']), 'fire')[1]).toBe('Wind about 10 m above open ground.');
    expect(words(state(1, 'arrows', ['zoom']), 300)[1]).toBe('Wind at about 300 m above the ground.');
  });
});

describe('the chip: the "cells" limit follows the cell of the data drawn', () => {
  const stats = (over: Partial<WindGlyphStats>): WindGlyphStats => ({
    active: true, idle: null, level: 3, count: 100, segments: 900, cellPx: 100, cellM: 133.33, rebuilds: 1, lastMs: 1, sliceP95Ms: 1, sliceMaxMs: 1, slicesLast: 1,
    detail: 'off', detailSegments: 0, glyphs: true, streaks: false, reduced: false, tickMaxMs: 0, ...over,
  });
  const input = (over: Partial<WindDetailInput>): WindDetailInput => ({ glyphsOn: true, streaks: 'off', viewMode: 'orbit', stats: stats({}), air: 'prognostic', height: 'felt', ...over });

  it('100 px of the model cell is 45 px of a 60 m cell: no smooth-fit limit for What the fire feels, one for the 10 m wind', () => {
    expect(windDetailState(input({ stats: stats({ dataCellM: 60, source: 'felt' }) })).limits).not.toContain('cells');
    expect(windDetailState(input({ height: 'fire' })).limits).toContain('cells');
  });

  it('160 px of the model cell is 72 px of a 60 m cell: the limit is there', () => {
    expect(windDetailState(input({ stats: stats({ cellPx: 160, dataCellM: 60, source: 'felt' }) })).limits).toContain('cells');
  });

  it('the detailed streaks always carry the limit', () => {
    expect(windDetailState(input({ stats: stats({ level: 4, detail: 'moving', dataCellM: 60, source: 'felt' }) })).limits).toContain('cells');
  });
});
