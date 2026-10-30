/**
 * "What the fire feels" (0.7.0, item B), the words side: the first of seven chips, the caption of its picture on both tiers, the same height with no
 * picture of it (the 10 m wind is drawn, and the caption says so), the 10 m caption that points to it, the smooth-fit rule on the 60 m cell, and the
 * line about the coloured map. (C0 pinned six chips and `heightLabel('felt')`; the E2 picture lane made it a chip.)
 */
import { describe, expect, it } from 'vitest';
import type { WindGlyphStats } from '../../../render/api';
import { WIND_HEIGHTS } from '../../../render/wind/glyphTypes';
import {
  DIAGNOSED_LINE,
  FELT_FAST_LINE,
  FELT_MISSING_LINE,
  FELT_NIGHT_LINE,
  GROUND_LINE,
  GROUND_LINE_CHOOSE,
  MAP_COLOURED_LINE,
  SMOOTH_FIT_LINE,
  WIND_HEIGHT_CHIPS,
  captionHeadline,
  dataCellPx,
  feltLine,
  glyphCaption,
  glyphView,
  heightLabel,
  legendHeightWords,
  windHeightOf,
  type GlyphAir,
  type GlyphViewInput,
} from './glyphWords';

const TZ = 'Australia/Sydney';
const T0 = Date.UTC(2026, 0, 15, 3, 0, 0); // t = 0 is 14:00 in Sydney in January
const abs = (t: number): number => T0 + t * 1000;
const felt = { cellM: 60, time: 300 };
const air = (over: Partial<GlyphAir> = {}): GlyphAir => ({ cellM: 133, airTime: 300, shownTime: 300, diagnosed: false, felt, ...over });
const NO_DASH = /[—–]/;

describe("the 'felt' height as a chip", () => {
  it("is 'What the fire feels', and the other labels are as they were", () => {
    expect(heightLabel('felt')).toBe('What the fire feels');
    expect(heightLabel('fire')).toBe('10 m');
    expect(heightLabel(50)).toBe('50 m');
    expect(heightLabel(1000)).toBe('1 km');
  });

  it('is chip 1 of 7, before the 10 m chip, and a chip value gives it back', () => {
    expect(WIND_HEIGHTS).toEqual(['felt', 'fire', 50, 100, 300, 1000, 2000]);
    expect(WIND_HEIGHT_CHIPS.map((c) => c.label)).toEqual(['What the fire feels', '10 m', '50 m', '100 m', '300 m', '1 km', '2 km']);
    expect(WIND_HEIGHT_CHIPS[0]).toEqual({ value: 'felt', label: 'What the fire feels' });
    expect(windHeightOf('felt')).toBe('felt');
    expect(windHeightOf('Felt')).toBeNull();
  });

  it('says "Wind the fire feels" in the legend title, as the map legend does', () => {
    expect(legendHeightWords('felt')).toBe('the fire feels');
  });
});

describe('the caption of What the fire feels', () => {
  it('names the wind, the data cell and the age of the picture, ending in a full stop', () => {
    expect(captionHeadline('felt', air(), TZ, abs)).toBe('Wind the fire feels · 60 m cells · air from 14:05.');
    // The picture's own time and cell, not the air's (the fast tier refits it once a minute; the grid is the fire grid's).
    expect(captionHeadline('felt', air({ airTime: 0, felt: { cellM: 80, time: 240 } }), TZ, abs)).toBe('Wind the fire feels · 80 m cells · air from 14:04.');
    expect(captionHeadline('felt', air({ shownTime: 540 }), TZ, abs)).toBe('Wind the fire feels · 60 m cells · air from 14:05 (4 min before the time shown).');
  });

  it('says what the numbers are and that they are not a measurement', () => {
    expect(glyphCaption('felt', air(), null, TZ, abs)).toEqual([
      'Wind the fire feels · 60 m cells · air from 14:05.',
      "The wind the fire model uses in each 60 m cell: slope flow, lee eddies and the fire's own draw are included. It is not a measurement.",
      'On a calm night much of it is air draining downhill.',
    ]);
    expect(feltLine(60)).toContain('It is not a measurement.');
    expect(FELT_NIGHT_LINE).toBe('On a calm night much of it is air draining downhill.');
  });

  it('on the fast model adds the diagnosed line, then that the wind is refitted once a minute', () => {
    expect(glyphCaption('felt', air({ diagnosed: true }), null, TZ, abs)).toEqual(['Wind the fire feels · 60 m cells · air from 14:05.', DIAGNOSED_LINE, feltLine(60), FELT_FAST_LINE, FELT_NIGHT_LINE]);
    expect(FELT_FAST_LINE).toBe('On the fast model it is refitted once a minute.');
    expect(glyphCaption('felt', air({ diagnosed: false }), null, TZ, abs)).not.toContain(FELT_FAST_LINE);
  });

  it('says its own calm-night sentence (the air drains downhill: checked on both tiers), never the 10 m one, and the 10 m or missing-picture captions never say it', () => {
    expect(glyphCaption('felt', air(), null, TZ, abs)).toContain(FELT_NIGHT_LINE);
    for (const h of [50, 100, 300, 1000, 2000, 'fire'] as const) expect(glyphCaption(h, air(), null, TZ, abs), String(h)).not.toContain(FELT_NIGHT_LINE);
    expect(glyphCaption('felt', air({ felt: null }), null, TZ, abs)).not.toContain(FELT_NIGHT_LINE);
  });

  it('says the smooth-fit line by the cell it is given, and not the 10 m calm-night sentence', () => {
    expect(glyphCaption('felt', air(), 400, TZ, abs).join('\n')).not.toContain('On a calm night the fire can feel much less');
    expect(glyphCaption('felt', air(), 61, TZ, abs).at(-1)).toBe(SMOOTH_FIT_LINE);
    expect(glyphCaption('felt', air(), 60, TZ, abs)).not.toContain(SMOOTH_FIT_LINE);
  });

  it('the 10 m caption points to it once the picture has it, and keeps the 0.6.0 sentence when it has not', () => {
    expect(GROUND_LINE_CHOOSE).toBe('On a calm night the fire can feel much less wind than this in places, and much more in others. Choose What the fire feels to see it.');
    expect(glyphCaption('fire', air(), null, TZ, abs)).toEqual([captionHeadline('fire', air(), TZ, abs), GROUND_LINE_CHOOSE]);
    expect(glyphCaption('fire', air({ felt: null }), null, TZ, abs)).toEqual([captionHeadline('fire', air({ felt: null }), TZ, abs), GROUND_LINE]);
    expect(glyphCaption('fire', air({ felt: undefined }), null, TZ, abs)).toContain(GROUND_LINE);
    // A numbered height has neither sentence.
    for (const h of [50, 100, 300, 1000, 2000] as const) expect(glyphCaption(h, air(), null, TZ, abs).join('\n'), String(h)).not.toContain('calm night');
  });

  it('with no picture of it (a replay from before 0.7.0, the demo engine) it is the 10 m wind, and the caption says so, in the 0.6.0 words', () => {
    for (const none of [null, undefined]) {
      const lines = glyphCaption('felt', air({ felt: none }), null, TZ, abs);
      expect(lines).toEqual([captionHeadline('fire', air({ felt: none }), TZ, abs), FELT_MISSING_LINE, GROUND_LINE]);
      expect(lines[0]).toBe('Wind about 10 m above open ground · model grid 133 m · air from 14:05.');
    }
    expect(FELT_MISSING_LINE).toBe('The wind the fire feels is not in this picture, so the 10 m wind is shown.');
  });

  it('is plain words: no em or en dash, and every line ends in a full stop', () => {
    for (const a of [air(), air({ diagnosed: true }), air({ felt: null }), air({ felt: { cellM: 50, time: 0 } })]) {
      for (const h of WIND_HEIGHTS)
        for (const line of glyphCaption(h, a, 200, TZ, abs)) {
          expect(line).toMatch(/\.$/);
          expect(line).not.toMatch(NO_DASH);
        }
    }
    for (const t of [FELT_FAST_LINE, FELT_MISSING_LINE, MAP_COLOURED_LINE, GROUND_LINE_CHOOSE, feltLine(60)]) expect(t).not.toMatch(NO_DASH);
  });
});

describe('the cell of the data on screen', () => {
  const st = { cellPx: 45, cellM: 133.33, dataCellM: 60 } as Pick<WindGlyphStats, 'cellPx' | 'cellM' | 'dataCellM'>;
  it('is the model cell, or for What the fire feels the 60 m cell scaled from it', () => {
    expect(dataCellPx(st, false)).toBe(45);
    expect(dataCellPx(st, true)).toBeCloseTo((45 * 60) / 133.33, 9);
    expect(dataCellPx({ cellPx: 45, cellM: 133.33 }, true)).toBe(45); // the layer has not said (the 10 m wind is drawn)
    expect(dataCellPx(null, true)).toBeNull();
  });
});

describe('the control: the line about the coloured map, and the smooth-fit rule through the layer statistics', () => {
  const stats = (over: Partial<WindGlyphStats> = {}): WindGlyphStats => ({
    active: true,
    idle: null,
    level: 3,
    count: 100,
    segments: 900,
    cellPx: 100,
    cellM: 133.33,
    rebuilds: 1,
    lastMs: 1,
    sliceP95Ms: 1,
    sliceMaxMs: 1,
    slicesLast: 1,
    detail: 'off',
    detailSegments: 0,
    glyphs: true,
    streaks: false,
    reduced: false,
    tickMaxMs: 0,
    ...over,
  });
  const input = (over: Partial<GlyphViewInput> = {}): GlyphViewInput => ({
    height: 'felt',
    on: true,
    has3dView: true,
    availability: { ok: true },
    stats: stats({ dataCellM: 60, source: 'felt' }),
    air: air(),
    tz: TZ,
    absTime: abs,
    ...over,
  });

  it('adds the map line only while the ground is coloured, and only with a caption', () => {
    expect(glyphView(input()).caption).not.toContain(MAP_COLOURED_LINE);
    expect(glyphView(input({ mapOn: false })).caption).not.toContain(MAP_COLOURED_LINE);
    expect(glyphView(input({ mapOn: true })).caption.at(-1)).toBe(MAP_COLOURED_LINE);
    expect(MAP_COLOURED_LINE).toBe('The ground is coloured by wind speed at this height; the legend shows the colours.');
    expect(glyphView(input({ mapOn: true, air: null })).caption).toEqual([]);
  });

  it('judges the smooth fit by the 60 m cell: 100 px of a 133 m cell is 45 px of a 60 m one (no sentence); 160 px is 72 px (the sentence)', () => {
    expect(glyphView(input()).caption).not.toContain(SMOOTH_FIT_LINE);
    expect(glyphView(input({ stats: stats({ cellPx: 160, dataCellM: 60, source: 'felt' }) })).caption).toContain(SMOOTH_FIT_LINE);
    // Without a picture of it (the layer draws the 10 m wind) it is the model's cell: 100 px is over 60.
    expect(glyphView(input({ stats: stats({ source: 'surface' }), air: air({ felt: null }) })).caption).toContain(SMOOTH_FIT_LINE);
  });
});
