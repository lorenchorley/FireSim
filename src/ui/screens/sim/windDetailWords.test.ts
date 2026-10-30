/**
 * The words of the Wind detail sheet (windDetailWords.ts): exact strings for each picture, plain words ("about" for numbers, sentence case, no em or
 * en dash, no shouting), and the truth rules: the eddies are said to be added, never the model's, at every height and for every state that draws them.
 */
import { describe, expect, it } from 'vitest';
import { WIND_HEIGHTS, type WindHeight } from '../../../render/wind/glyphTypes';
import { BUDGET_LINE, heightLabel } from './glyphWords';
import type { DetailKind, DetailLimit, WindDetailState } from './windDetailState';
import { EDDIES_LINE, ESTIMATED_LINE, MOST_DETAILED_LINE, NOTHING_LINE, OVERVIEW_LINE, SHEET_TITLE, STILL_LINE, ZOOM_LINE, levelLine, windDetailWords } from './windDetailWords';

const state = (level: WindDetailState['level'], kind: DetailKind, limits: DetailLimit[] = []): WindDetailState => ({ visible: true, level, kind, limits, key: 'k' });
const words = (s: WindDetailState, height: WindHeight = 'fire', cellM: number | null = 133.33): string[] => windDetailWords(s, { heightLabel: heightLabel(height), height, cellM }).lines;

describe('the sheet, one picture at a time (exact strings)', () => {
  it('the title is "Wind detail"', () => {
    expect(windDetailWords(state(3, 'curves'), { heightLabel: '10 m', height: 'fire', cellM: 133 }).title).toBe('Wind detail');
    expect(SHEET_TITLE).toBe('Wind detail');
  });

  it('level 1, straight arrows, at the 10 m height', () => {
    expect(words(state(1, 'arrows', ['zoom']))).toEqual(['Level 1 of 4: straight arrows.', 'Wind about 10 m above open ground.', 'Zoom in for more detail.']);
  });

  it('level 2, straight arrows closer together, at a height above the ground', () => {
    expect(words(state(2, 'arrows', ['zoom']), 100)).toEqual(['Level 2 of 4: straight arrows, closer together.', 'Wind at about 100 m above the ground.', 'Zoom in for more detail.']);
  });

  it('level 3, curved flow lines, with the model’s cell once it is wider than 60 px', () => {
    expect(words(state(3, 'curves', ['zoom']), 'fire')).toEqual(['Level 3 of 4: curved flow lines.', 'Wind about 10 m above open ground.', 'Zoom in for more detail.']);
    expect(words(state(3, 'curves', ['zoom', 'cells']), 300, 133.33)).toEqual([
      'Level 3 of 4: curved flow lines.',
      'Wind at about 300 m above the ground.',
      'Zoom in for more detail.',
      'The air model works on cells about 133 m wide. Between its points the wind is a smooth fit.',
    ]);
  });

  it('level 4, the detailed streaks: what is the model’s, and what is added for looks, in plain words', () => {
    expect(words(state(4, 'detailed', ['cells']))).toEqual([
      'Level 4 of 4: detailed streaks.',
      'Wind about 10 m above open ground.',
      'This is the most detailed level.',
      'Direction and speed come from the air model, which works on cells about 133 m wide.',
      'The small eddies are added for looks, from the shape of the ground. The streaks also move faster than the real wind so that you can see them.',
    ]);
  });

  it('level 4 standing still (reduced motion), on an estimated wind', () => {
    expect(words(state(4, 'detailed', ['cells', 'estimated', 'still']), 1000, 266.7)).toEqual([
      'Level 4 of 4: detailed streaks.',
      'Wind at about 1 km above the ground.',
      'This is the most detailed level.',
      'Direction and speed come from the air model, which works on cells about 267 m wide.',
      EDDIES_LINE,
      "The fast tier's wind is estimated from the forecast and the shape of the ground. It is not simulated.",
      'Your phone is set to reduce motion, so the streaks stand still.',
    ]);
  });

  it('the Wind streaks over the whole area: they do not follow the zoom until the closest level', () => {
    expect(words(state(1, 'overview', ['zoom']))).toEqual(['Level 1 of 4: moving streaks over the whole area.', 'These streaks do not get more detailed as you zoom in, until the closest level.', 'Zoom in for more detail.']);
  });

  it('the Wind streaks through the air: named, nothing more to say about the zoom', () => {
    expect(words(state(1, 'volume'))).toEqual(['Level 1 of 4: moving streaks through the air.']);
  });

  it('level 0: nothing is drawn at this zoom, and the zoom is the way in', () => {
    expect(words(state(0, 'none'))).toEqual(['Nothing is drawn at this zoom.', 'Zoom in to see the wind arrows.']);
  });

  it('a full view: nothing is drawn, and what to do (the Layers line, word for word)', () => {
    expect(words(state(0, 'none', ['budget']))).toEqual(['Nothing is drawn at this zoom.', 'Not drawn here: this view already uses all the phone can draw. Zoom out or switch a layer off.']);
    expect(BUDGET_LINE).toBe('Not drawn here: this view already uses all the phone can draw. Zoom out or switch a layer off.');
  });

  it('the streaks drawn while the arrows do not fit: both the picture and the reason', () => {
    expect(words(state(1, 'overview', ['budget', 'zoom']))).toEqual([
      'Level 1 of 4: moving streaks over the whole area.',
      OVERVIEW_LINE,
      ZOOM_LINE,
      BUDGET_LINE,
    ]);
  });

  it('an estimated wind says it is not simulated, after the cells and the budget', () => {
    expect(words(state(3, 'curves', ['zoom', 'cells', 'estimated']), 'fire', null)).toEqual([
      'Level 3 of 4: curved flow lines.',
      'Wind about 10 m above open ground.',
      'Zoom in for more detail.',
      'The air model works on large cells. Between its points the wind is a smooth fit.',
      ESTIMATED_LINE,
    ]);
  });

  it('the exported lines are the words above', () => {
    expect(NOTHING_LINE).toBe('Nothing is drawn at this zoom.');
    expect(ZOOM_LINE).toBe('Zoom in for more detail.');
    expect(MOST_DETAILED_LINE).toBe('This is the most detailed level.');
    expect(STILL_LINE).toBe('Your phone is set to reduce motion, so the streaks stand still.');
    expect(levelLine(state(3, 'curves'))).toBe('Level 3 of 4: curved flow lines.');
  });
});

describe('the cell size', () => {
  it('is rounded, and "large cells" when it is not known (none, zero, NaN, infinite)', () => {
    const at = (cellM: number | null): string => words(state(4, 'detailed', ['cells']), 'fire', cellM)[3]!;
    expect(at(133.33)).toBe('Direction and speed come from the air model, which works on cells about 133 m wide.');
    expect(at(99.6)).toBe('Direction and speed come from the air model, which works on cells about 100 m wide.');
    for (const bad of [null, 0, -5, NaN, Infinity]) expect(at(bad), String(bad)).toBe('Direction and speed come from the air model, which works on large cells.');
  });
});

/** Every picture the state can describe, at every height, with every combination of limits. */
const all: { s: WindDetailState; height: WindHeight; cellM: number | null; lines: string[] }[] = [];
const LIMITS: DetailLimit[] = ['budget', 'zoom', 'cells', 'estimated', 'still'];
const PICTURES: [WindDetailState['level'], DetailKind][] = [
  [0, 'none'],
  [1, 'arrows'],
  [2, 'arrows'],
  [3, 'curves'],
  [4, 'detailed'],
  [1, 'overview'],
  [1, 'volume'],
];
for (const [level, kind] of PICTURES)
  for (let mask = 0; mask < 1 << LIMITS.length; mask++)
    for (const height of WIND_HEIGHTS)
      for (const cellM of [null, 133.33, 266.7]) {
        const s = state(
          level,
          kind,
          LIMITS.filter((_, n) => mask & (1 << n)),
        );
        all.push({ s, height, cellM, lines: words(s, height, cellM) });
      }

describe('plain words, every picture, every height, every limit', () => {
  it('covers 7 pictures x 32 limit sets x 7 heights (What the fire feels and six more) x 3 cell sizes', () => {
    expect(WIND_HEIGHTS).toHaveLength(7);
    expect(all).toHaveLength(7 * 32 * 7 * 3);
  });

  it('no em or en dash, no exclamation mark, no shouting, no "undefined" or "NaN"; every line is a sentence that ends in a full stop', () => {
    for (const { lines, s } of all) {
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line, `${s.kind} ${s.limits}: ${line}`).not.toMatch(/[—–!]/);
        expect(line, line).not.toMatch(/\b(undefined|NaN|Infinity|null|\[object)\b/);
        expect(line, line).toMatch(/^[A-Z].*[.]$/);
        expect(line, line).not.toMatch(/[A-Z]{4,}/);
        expect(line, line).not.toMatch(/  /);
      }
    }
  });

  it('a number is "about": the height and the cell never come as a bare measurement', () => {
    for (const { lines } of all) {
      for (const line of lines) {
        if (/\d+ (m|km)\b/.test(line)) expect(line, line).toMatch(/\babout \d+ (m|km)\b/);
      }
    }
  });

  it('the first line says the step reached (or that nothing is drawn); no line is said twice', () => {
    for (const { s, lines } of all) {
      expect(lines[0], `${s.kind}`).toBe(s.kind === 'none' ? NOTHING_LINE : levelLine(s));
      expect(new Set(lines).size, lines.join(' | ')).toBe(lines.length);
    }
  });

  it('the detailed streaks always say the eddies are added for looks; the sheet never says they are the model’s', () => {
    for (const { s, lines } of all) {
      const text = lines.join(' ');
      if (s.kind === 'detailed') {
        expect(lines, `${s.limits}`).toContain(EDDIES_LINE);
        expect(text).toContain('eddies are added for looks');
        expect(text).toContain('from the air model');
      } else {
        expect(text, `${s.kind}`).not.toMatch(/eddies/);
      }
      // The eddies are never described as coming from the model or the simulation.
      expect(text).not.toMatch(/eddies?[^.]*\b(calculated|computed|simulated|modelled|come from the (air )?model)\b/i);
      expect(text).not.toMatch(/\b(calculates?|computes?|simulates?) the (small )?eddies/i);
    }
  });

  it('every limit that is on gets its line; one that is off gets none', () => {
    for (const { s, lines } of all) {
      const text = lines.join('\n');
      expect(text.includes(BUDGET_LINE), `budget ${s.kind} ${s.limits}`).toBe(s.limits.includes('budget'));
      expect(text.includes(ESTIMATED_LINE), `estimated ${s.kind}`).toBe(s.limits.includes('estimated'));
      expect(text.includes(STILL_LINE), `still ${s.kind}`).toBe(s.limits.includes('still'));
      expect(text.includes(ZOOM_LINE), `zoom ${s.kind}`).toBe(s.limits.includes('zoom'));
    }
  });

  it('the most detailed level says so, and nothing else does', () => {
    for (const { s, lines } of all) {
      expect(lines.includes(MOST_DETAILED_LINE), `${s.kind} ${s.limits}`).toBe(s.kind === 'detailed' && !s.limits.includes('zoom'));
    }
  });

  it('the height is said as the chip says it: the 10 m wind over open ground, or a number above the ground', () => {
    for (const { s, height, lines } of all) {
      const where = lines.find((l) => /^(Wind (about|at about) |The wind the fire feels)/.test(l));
      if (!(s.kind === 'arrows' || s.kind === 'curves' || s.kind === 'detailed')) {
        expect(where, `${s.kind}`).toBeUndefined();
        continue;
      }
      expect(where, `${s.kind} ${String(height)}`).toBe(
        height === 'fire' ? 'Wind about 10 m above open ground.' : height === 'felt' ? 'The wind the fire feels, in cells about 60 m wide.' : `Wind at about ${heightLabel(height)} above the ground.`,
      );
    }
  });
});
