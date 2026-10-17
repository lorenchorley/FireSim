/**
 * The words of the wind arrows and flow lines (glyphWords.ts): the chips, the caption in each of its cases, the line about the zoom,
 * the control's view of a stats record, and the rule that keeps the glyph engine out of the entry chunk.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AIR_STALE_S } from '../../../core/airView';
import type { WindGlyphStats } from '../../../render/api';
import { REFINE_CELL_PX, refineFor } from '../../../render/wind/glyphField';
import { WIND_HEIGHTS } from '../../../render/wind/glyphTypes';
import { airFromText } from './slicePanelModel';
import {
  DIAGNOSED_LINE,
  EYE_LEVEL_LINE,
  GLYPH_SMOOTH_FIT_PX,
  GROUND_LINE,
  LEVEL_LINE,
  NEEDS_3D,
  NO_WIND_LINE,
  SMOOTH_FIT_LINE,
  WIND_HEIGHT_CHIPS,
  captionHeadline,
  glyphCaption,
  glyphLevelLine,
  glyphView,
  heightLabel,
  legendHeightWords,
  windFromText,
  windHeightOf,
  type GlyphAir,
  type GlyphViewInput,
} from './glyphWords';

const TZ = 'Australia/Sydney';
// t = 0 is 14:00 in Sydney in January (UTC+11).
const T0 = Date.UTC(2026, 0, 15, 3, 0, 0);
const abs = (t: number): number => T0 + t * 1000;
const air = (over: Partial<GlyphAir> = {}): GlyphAir => ({ cellM: 133, airTime: 300, shownTime: 300, diagnosed: false, ...over });
const stats = (over: Partial<WindGlyphStats> = {}): WindGlyphStats => ({
  active: true,
  idle: null,
  level: 3,
  count: 412,
  segments: 2980,
  cellPx: 45,
  cellM: 133,
  rebuilds: 14,
  lastMs: 3.1,
  sliceP95Ms: 4.2,
  sliceMaxMs: 6,
  slicesLast: 2,
  ...over,
});
const NO_DASH = /[—–]/;

describe('the Wind height chips', () => {
  it('are Ground, 50 m, 100 m, 300 m, 1 km and 2 km, in that order, one for each height', () => {
    expect(WIND_HEIGHT_CHIPS.map((c) => c.label)).toEqual(['Ground', '50 m', '100 m', '300 m', '1 km', '2 km']);
    expect(WIND_HEIGHT_CHIPS.map((c) => c.value)).toEqual(['fire', '50', '100', '300', '1000', '2000']);
    expect(WIND_HEIGHT_CHIPS).toHaveLength(WIND_HEIGHTS.length);
    expect(WIND_HEIGHTS.map(heightLabel)).toEqual(WIND_HEIGHT_CHIPS.map((c) => c.label));
  });

  it('give back the height they stand for, and nothing for anything else (the chip value is a string, the stored height a number)', () => {
    for (const h of WIND_HEIGHTS) expect(windHeightOf(String(h))).toBe(h);
    expect(windHeightOf('50')).toBe(50);
    expect(windHeightOf('10')).toBeNull(); // no 10 m chip: the sampler clamps below its first level
    for (const bad of ['', 'Ground', 'FIRE', '50 m', '1e3', ' 100', 'null']) expect(windHeightOf(bad), bad).toBeNull();
  });

  it('say the same height in the legend’s title: near the ground, or at a height', () => {
    expect(legendHeightWords('fire')).toBe('near the ground');
    expect(legendHeightWords(100)).toBe('at 100 m');
    expect(legendHeightWords(1000)).toBe('at 1 km');
    expect(legendHeightWords(2000)).toBe('at 2 km');
  });
});

describe('the caption', () => {
  it('a height above the ground: the height, the model grid and the age of the wind', () => {
    expect(captionHeadline(100, air(), TZ, abs)).toBe('Wind at 100 m above the ground · model grid 133 m · wind from 14:05');
    expect(captionHeadline(50, air(), TZ, abs)).toBe('Wind at 50 m above the ground · model grid 133 m · wind from 14:05');
    expect(captionHeadline(300, air({ cellM: 266.4 }), TZ, abs)).toBe('Wind at 300 m above the ground · model grid 266 m · wind from 14:05');
  });

  it('kilometre heights are said in kilometres', () => {
    expect(captionHeadline(1000, air(), TZ, abs)).toBe('Wind at 1 km above the ground · model grid 133 m · wind from 14:05');
    expect(captionHeadline(2000, air(), TZ, abs)).toBe('Wind at 2 km above the ground · model grid 133 m · wind from 14:05');
  });

  it('Ground is the model’s 10 m wind over open ground, fitted to the terrain, and always says it differs on a calm night', () => {
    expect(captionHeadline('fire', air(), TZ, abs)).toBe('Wind about 10 m above open ground, as the model fits it to the terrain · model grid 133 m · wind from 14:05');
    const lines = glyphCaption('fire', air(), 20, TZ, abs);
    expect(lines).toEqual([captionHeadline('fire', air(), TZ, abs), GROUND_LINE]);
    expect(GROUND_LINE).toBe('On a calm night the wind the fire feels can differ a lot from this.');
    for (const h of WIND_HEIGHTS) expect(glyphCaption(h, air(), null, TZ, abs).includes(GROUND_LINE), String(h)).toBe(h === 'fire');
  });

  it('a diagnosed wind says what it leaves out, at every height; the 3-D atmosphere does not', () => {
    expect(DIAGNOSED_LINE).toBe('Diagnosed wind: terrain effects only, no plume.');
    for (const h of WIND_HEIGHTS) {
      expect(glyphCaption(h, air({ diagnosed: true }), null, TZ, abs), String(h)).toContain(DIAGNOSED_LINE);
      expect(glyphCaption(h, air({ diagnosed: false }), null, TZ, abs), String(h)).not.toContain(DIAGNOSED_LINE);
    }
    // The order: what it is, what it leaves out, why Ground is not the fire's wind.
    expect(glyphCaption('fire', air({ diagnosed: true }), null, TZ, abs)).toEqual([captionHeadline('fire', air(), TZ, abs), DIAGNOSED_LINE, GROUND_LINE]);
  });

  it('old wind says how much older it is than the picture, past the same limit the slice footer uses', () => {
    expect(windFromText(300, 300, TZ, abs)).toBe('wind from 14:05');
    expect(windFromText(300, 300 + AIR_STALE_S, TZ, abs)).toBe('wind from 14:05'); // at the limit: not yet
    expect(windFromText(300, 300 + AIR_STALE_S + 1, TZ, abs)).toBe('wind from 14:05 (2 min before the time shown)');
    expect(windFromText(300, 300 + 240, TZ, abs)).toBe('wind from 14:05 (4 min before the time shown)');
    expect(windFromText(300, 300 + 3600 * 3, TZ, abs)).toBe('wind from 14:05 (180 min before the time shown)');
    expect(windFromText(300, 100, TZ, abs)).toBe('wind from 14:05'); // air from after the picture: never a negative age
    expect(captionHeadline(100, air({ airTime: 300, shownTime: 540 }), TZ, abs)).toBe('Wind at 100 m above the ground · model grid 133 m · wind from 14:05 (4 min before the time shown)');
  });

  it('a wind with no time says so, and a grid that is not known is left out', () => {
    expect(windFromText(null, 300, TZ, abs)).toBe('wind time not recorded');
    expect(windFromText(NaN, 300, TZ, abs)).toBe('wind time not recorded');
    expect(captionHeadline(100, air({ airTime: null }), TZ, abs)).toBe('Wind at 100 m above the ground · model grid 133 m · wind time not recorded');
    expect(captionHeadline(100, air({ cellM: null }), TZ, abs)).toBe('Wind at 100 m above the ground · wind from 14:05');
    expect(captionHeadline(100, air({ cellM: 0 }), TZ, abs)).toBe('Wind at 100 m above the ground · wind from 14:05');
  });

  it('says the curves are a smooth fit once one model cell covers more than 60 px, and not before', () => {
    expect(GLYPH_SMOOTH_FIT_PX).toBe(60);
    expect(SMOOTH_FIT_LINE).toBe('Closer than this the curves are a smooth fit through the model, not new detail.');
    expect(glyphCaption(100, air(), 60, TZ, abs)).not.toContain(SMOOTH_FIT_LINE); // exactly 60: not more than
    expect(glyphCaption(100, air(), 60.5, TZ, abs)).toContain(SMOOTH_FIT_LINE);
    expect(glyphCaption(100, air(), 45, TZ, abs)).not.toContain(SMOOTH_FIT_LINE);
    expect(glyphCaption(100, air(), 400, TZ, abs).at(-1)).toBe(SMOOTH_FIT_LINE);
    expect(glyphCaption(100, air(), null, TZ, abs)).not.toContain(SMOOTH_FIT_LINE); // no statistics: nothing said
    expect(glyphCaption('fire', air({ diagnosed: true }), 100, TZ, abs)).toEqual([captionHeadline('fire', air(), TZ, abs), DIAGNOSED_LINE, GROUND_LINE, SMOOTH_FIT_LINE]);
  });

  it('is the slice footer’s age of the air in its words, as the footer words it (pinned against airFromText)', () => {
    const asWind = (s: string): string => s.replace(/^air /, 'wind ');
    for (const [airT, shown] of [
      [300, 300],
      [300, 389],
      [300, 391],
      [300, 600],
      [0, 7200],
      [300, 100],
      [null, 300],
    ] as const) {
      expect(windFromText(airT, shown, TZ, abs), `${airT} ${shown}`).toBe(asWind(airFromText(airT, shown, TZ, abs)));
    }
  });
});

describe('the line about the zoom', () => {
  it('says what each level is showing and what to do next', () => {
    expect(glyphLevelLine(stats({ level: 0, active: false }))).toBe('Zoom in to see the wind arrows.');
    expect(glyphLevelLine(stats({ level: 1 }))).toBe('Showing straight arrows. Zoom in for more.');
    expect(glyphLevelLine(stats({ level: 2 }))).toBe('Showing straight arrows, closer together. Zoom in for flow lines.');
    expect(glyphLevelLine(stats({ level: 3 }))).toBe('Showing curved flow lines.');
    expect(glyphLevelLine(stats({ level: 4 }))).toBe('Showing long flow lines.');
    expect(Object.keys(LEVEL_LINE)).toEqual(['0', '1', '2', '3', '4']);
  });

  it('says why nothing is drawn: eye level, no wind picture yet; nothing when the layer is off or has said nothing', () => {
    expect(glyphLevelLine(stats({ active: false, idle: 'eye-level' }))).toBe('Not drawn at eye level. Go back to the map view.');
    expect(glyphLevelLine(stats({ active: false, idle: 'no-wind' }))).toBe('Waiting for the wind picture.');
    expect(EYE_LEVEL_LINE).toBe('Not drawn at eye level. Go back to the map view.');
    expect(NO_WIND_LINE).toBe('Waiting for the wind picture.');
    expect(glyphLevelLine(stats({ active: false, idle: 'off' }))).toBe('');
    expect(glyphLevelLine(null)).toBe('');
    expect(glyphLevelLine(undefined)).toBe('');
  });
});

describe('what the control shows (glyphView)', () => {
  const base = (over: Partial<GlyphViewInput> = {}): GlyphViewInput => ({ height: 100, on: true, has3dView: true, availability: { ok: true }, stats: stats(), air: air(), tz: TZ, absTime: abs, ...over });

  it('on and available: no reason, the caption, the level line', () => {
    const v = glyphView(base());
    expect(v.reason).toBeNull();
    expect(v.caption).toEqual(['Wind at 100 m above the ground · model grid 133 m · wind from 14:05']);
    expect(v.level).toBe('Showing curved flow lines.');
  });

  it('the 2-D map: the reason is the 3-D view, and nothing else is said', () => {
    expect(NEEDS_3D).toBe('Needs the 3-D view');
    expect(glyphView(base({ has3dView: false, stats: null, air: null }))).toEqual({ reason: 'Needs the 3-D view', caption: [], level: '' });
    // (the 3-D view is the reason even when the catalog also says there is no air)
    expect(glyphView(base({ has3dView: false, availability: { ok: false, reason: 'Needs the air picture, which the simulation makes once it has started' } })).reason).toBe('Needs the 3-D view');
  });

  it('no air picture yet: the catalog’s reason, no caption, and the layer’s own “waiting” line', () => {
    const waits = { ok: false, reason: 'Needs the air picture, which the simulation makes once it has started' };
    const v = glyphView(base({ availability: waits, air: null, stats: stats({ active: false, idle: 'no-wind' }) }));
    expect(v).toEqual({ reason: waits.reason, caption: [], level: 'Waiting for the wind picture.' });
    // The reason beats a stale air record: no caption for wind that cannot be drawn.
    expect(glyphView(base({ availability: waits })).caption).toEqual([]);
  });

  it('off: only the reason (if any) is shown, no caption and no level line', () => {
    expect(glyphView(base({ on: false }))).toEqual({ reason: null, caption: [], level: '' });
    expect(glyphView(base({ on: false, availability: { ok: false, reason: 'x' } })).reason).toBe('x');
  });

  it('on at eye level: the caption stays and the level line says why nothing is drawn', () => {
    const v = glyphView(base({ stats: stats({ active: false, idle: 'eye-level' }) }));
    expect(v.caption).toHaveLength(1);
    expect(v.level).toBe('Not drawn at eye level. Go back to the map view.');
  });

  it('close in on a diagnosed Ground picture: every line, in order', () => {
    const v = glyphView(base({ height: 'fire', air: air({ diagnosed: true }), stats: stats({ level: 4, cellPx: 180 }) }));
    expect(v.caption).toEqual([captionHeadline('fire', air(), TZ, abs), DIAGNOSED_LINE, GROUND_LINE, SMOOTH_FIT_LINE]);
    expect(v.level).toBe('Showing long flow lines.');
  });

  it('with no statistics yet the caption still stands (the model cell size comes from the air), without the smooth-fit line', () => {
    const v = glyphView(base({ stats: null }));
    expect(v.caption).toHaveLength(1);
    expect(v.level).toBe('');
  });
});

describe('words', () => {
  it('are plain: no em or en dash anywhere, sentence case, nothing shouted', () => {
    const all = [
      NEEDS_3D,
      DIAGNOSED_LINE,
      GROUND_LINE,
      SMOOTH_FIT_LINE,
      EYE_LEVEL_LINE,
      NO_WIND_LINE,
      ...Object.values(LEVEL_LINE),
      ...WIND_HEIGHT_CHIPS.map((c) => c.label),
      ...WIND_HEIGHTS.map(legendHeightWords),
      ...WIND_HEIGHTS.flatMap((h) => [captionHeadline(h, air({ airTime: 0, shownTime: 900 }), TZ, abs), ...glyphCaption(h, air({ diagnosed: true }), 100, TZ, abs)]),
    ];
    for (const s of all) {
      expect(s, s).not.toMatch(NO_DASH);
      expect(s.length, s).toBeGreaterThan(0);
    }
    for (const s of [DIAGNOSED_LINE, GROUND_LINE, SMOOTH_FIT_LINE, EYE_LEVEL_LINE, NO_WIND_LINE, ...Object.values(LEVEL_LINE)]) expect(s).toMatch(/^[A-Z].*[.]$/);
  });
});

describe('the smooth-fit words follow the engine', () => {
  // glyphWords.ts is in the entry chunk and cannot import the engine, so it holds its own copy of the number; this test (which may) keeps the two together.
  it('GLYPH_SMOOTH_FIT_PX is the engine REFINE_CELL_PX', () => {
    expect(GLYPH_SMOOTH_FIT_PX).toBe(REFINE_CELL_PX);
  });

  it('the caption adds the smooth-fit sentence exactly where the engine starts to refine its raster', () => {
    for (const cellPx of [REFINE_CELL_PX - 10, REFINE_CELL_PX - 0.01, REFINE_CELL_PX, REFINE_CELL_PX + 0.01, REFINE_CELL_PX + 40]) {
      expect(glyphCaption(100, air(), cellPx, TZ, abs).includes(SMOOTH_FIT_LINE), `${cellPx} px a cell`).toBe(refineFor(cellPx) === 2);
    }
  });
});

describe('the glyph engine stays out of the entry chunk', () => {
  // Everything under src/ui (the Layers panel, the tool, the words) and the layer catalog are entry code: they may use the types and
  // constants of render/wind/glyphTypes.ts and nothing of the engine or the Three.js layer, which load with the 3-D view.
  const ENGINE = /from\s+['"][^'"]*(flowGlyphs|glyphField|glyphLod|glyphPose|glyphOracle|windGlyphLayer)(\.testing)?['"]|import\(\s*['"][^'"]*(flowGlyphs|glyphField|glyphLod|glyphPose|windGlyphLayer)['"]\s*\)/;
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
    });

  it('no module of src/ui and not the catalog imports flowGlyphs, glyphField, glyphLod, glyphPose or windGlyphLayer', () => {
    const files = [...walk(join(__dirname, '..', '..')), join(__dirname, '..', '..', '..', 'render', 'layerCatalog.ts')];
    expect(files.length).toBeGreaterThan(50);
    const bad = files.filter((f) => ENGINE.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });

  it('glyphWords.ts imports only types and constants of glyphTypes, the air helpers, the formatters and the api types', () => {
    const src = readFileSync(join(__dirname, 'glyphWords.ts'), 'utf8');
    const imports = [...src.matchAll(/^import\s.*from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../../../core/airView', '../../../render/api', '../../../render/wind/glyphTypes', '../../format']);
  });
});
