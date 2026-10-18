/**
 * The words of the wind arrows and flow lines (0.5.0, stage E1): the Wind height chips, the caption that says what the picture is,
 * the line that says what the zoom is showing, and what the control says when it cannot draw. Pure (no DOM, no Three), unit-tested
 * (glyphWords.test.ts). It is in the entry chunk, so it imports only the types and constants of `render/wind/glyphTypes.ts` and the air
 * helpers the Layers panel already uses: nothing of the glyph engine (a dependency test holds that).
 *
 * Truth in captions (plan section 4 rule 4, section 9.2): the height, the model grid and the age of the air are always stated; a diagnosed
 * wind says what it leaves out; the 10 m chip says why it is not "what the fire feels"; and once one model cell is wider than 60 px on screen the
 * curves are said to be a smooth fit through the model, not new detail.
 */
import { AIR_STALE_S } from '../../../core/airView';
import type { WindGlyphStats } from '../../../render/api';
import { WIND_HEIGHTS, type GlyphLevel, type WindHeight } from '../../../render/wind/glyphTypes';
import { formatClock, formatNumber } from '../../format';

/** One model cell wider than this on screen (px): the curves are a fit between the model's values, so the caption says so. (The engine's `REFINE_CELL_PX` is the same number.) */
export const GLYPH_SMOOTH_FIT_PX = 60;

/** The 2-D map draws no glyphs and has no air: the reason the switch gives there. */
export const NEEDS_3D = 'Needs the 3-D view';

export const WIND_HEIGHT_LABEL = 'Wind height';

/** The switch's name on the Map view tab (the Layers row is "Arrows and flow lines", under its "Wind and air" heading, and the catalog keeps its titles to 24 characters). */
export const GLYPH_SWITCH_LABEL = 'Wind arrows and flow lines';

/** The one line under the switch while it is off and can be used (the Map view tab has no (i) button to say what the switch does). */
export const GLYPH_INTRO = 'Draws the wind on the map: arrows from far away, flow lines when you zoom in.';

/** The hint under the switch: what it does while it is off and usable; nothing once it is on (the caption says what is drawn) or when `reason` says why it cannot be used. */
export const glyphIntro = (on: boolean, reason: string | null): string => (on || reason ? '' : GLYPH_INTRO);

// ─────────────────────────────────────────────────────────────────────────────
// The height
// ─────────────────────────────────────────────────────────────────────────────

/** The chip of a height: `10 m` (the model's 10 m wind over open ground, so the chip and the caption agree), `50 m`, `100 m`, `300 m`, `1 km`, `2 km`. */
export function heightLabel(h: WindHeight): string {
  if (h === 'fire') return '10 m';
  return h >= 1000 ? `${h / 1000} km` : `${h} m`;
}

/** The chips, in order (the value is the string the chip carries: `String(height)`). */
export const WIND_HEIGHT_CHIPS: readonly { value: string; label: string }[] = WIND_HEIGHTS.map((h) => ({ value: String(h), label: heightLabel(h) }));

/** The height a chip's value stands for, or null for anything else. */
export function windHeightOf(value: string): WindHeight | null {
  return WIND_HEIGHTS.find((h) => String(h) === value) ?? null;
}

/** The words after "Wind" in the map legend's title: `near the ground` or `at 100 m`. */
export const legendHeightWords = (h: WindHeight): string => (h === 'fire' ? 'near the ground' : `at ${heightLabel(h)}`);

// ─────────────────────────────────────────────────────────────────────────────
// The caption
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "air from 14:05" ("wind from" would read as a compass direction), and how much older than the picture it is once that passes `AIR_STALE_S`
 * ("4 min before the time shown"). The slice footer says the same in `airFromText` (slicePanelModel.ts, a lazy chunk, so not imported here):
 * the same words, and a test pins it.
 */
export function windFromText(airTime: number | null, shownTime: number, tz: string, absTime: (t: number) => number): string {
  if (airTime === null || !Number.isFinite(airTime)) return 'air time not recorded';
  const base = `air from ${formatClock(absTime(airTime), tz)}`;
  const age = Math.max(0, shownTime - airTime);
  return age > AIR_STALE_S ? `${base} (${Math.max(1, Math.round(age / 60))} min before the time shown)` : base;
}

export const DIAGNOSED_LINE = 'Diagnosed wind: terrain effects only, no plume.';
export const GROUND_LINE = 'On a calm night the fire can feel much less wind than this in places, and much more in others.';
export const SMOOTH_FIT_LINE = 'At this zoom the curves are a smooth fit through the model, not new detail.';

/** What the caption needs to know about the air that is drawn. */
export interface GlyphAir {
  /** The model's cell (m): the grid the air is on. */
  cellM: number | null;
  /** Simulation time (s) of the air, and of the picture it is drawn with. */
  airTime: number | null;
  shownTime: number;
  /** The fast tier's diagnosed wind (terrain effects only), not the 3-D atmosphere. */
  diagnosed: boolean;
}

/**
 * The first line: what is drawn, the model grid and the age of the air, parts joined as the slice footer does, ending in a full stop (a screen
 * reader would run it into the next line otherwise). "As the model fits it to the terrain" is how the fast tier makes its wind, so only that tier says it.
 */
export function captionHeadline(height: WindHeight, air: GlyphAir, tz: string, absTime: (t: number) => number): string {
  const ground = air.diagnosed ? 'Wind about 10 m above open ground, as the model fits it to the terrain' : 'Wind about 10 m above open ground';
  const what = height === 'fire' ? ground : `Wind at ${heightLabel(height)} above the ground`;
  const grid = air.cellM !== null && Number.isFinite(air.cellM) && air.cellM > 0 ? `model grid ${formatNumber(Math.round(air.cellM))} m` : null;
  return `${[what, grid, windFromText(air.airTime, air.shownTime, tz, absTime)].filter((x): x is string => !!x).join(' · ')}.`;
}

/**
 * The caption lines under the Wind height chips. In 0.5.0 every field is the atmosphere's (the 60 m "wind the fire feels" raster is a later
 * stage), so the smooth-fit sentence follows the size of a model cell alone: `cellPx` is the screen pixels one model cell covers at the middle
 * of the screen (`WindGlyphStats.cellPx`).
 */
export function glyphCaption(height: WindHeight, air: GlyphAir, cellPx: number | null, tz: string, absTime: (t: number) => number): string[] {
  const lines = [captionHeadline(height, air, tz, absTime)];
  if (air.diagnosed) lines.push(DIAGNOSED_LINE);
  if (height === 'fire') lines.push(GROUND_LINE);
  if (cellPx !== null && Number.isFinite(cellPx) && cellPx > GLYPH_SMOOTH_FIT_PX) lines.push(SMOOTH_FIT_LINE);
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// What the zoom is showing
// ─────────────────────────────────────────────────────────────────────────────

export const LEVEL_LINE: Record<GlyphLevel, string> = {
  0: 'Zoom in to see the wind arrows.',
  1: 'Showing straight arrows. Zoom in for more.',
  2: 'Showing straight arrows, closer together. Zoom in for flow lines.',
  3: 'Showing curved flow lines.',
  4: 'Showing long flow lines.',
};

export const EYE_LEVEL_LINE = 'Not drawn at eye level. Go back to the map view.';
export const NO_WIND_LINE = 'Waiting for the wind picture.';

/** The line under the caption, from the layer's own statistics; '' when the layer says nothing yet (or is off). */
export function glyphLevelLine(stats: Pick<WindGlyphStats, 'idle' | 'level'> | null | undefined): string {
  if (!stats) return '';
  if (stats.idle === 'eye-level') return EYE_LEVEL_LINE;
  if (stats.idle === 'no-wind') return NO_WIND_LINE;
  if (stats.idle === 'off') return '';
  return LEVEL_LINE[stats.level] ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
// The control
// ─────────────────────────────────────────────────────────────────────────────

export interface GlyphViewInput {
  height: WindHeight;
  on: boolean;
  /** The view is the 3-D scene (the 2-D map has no air, so it draws no glyphs and has no `windGlyphStats`). */
  has3dView: boolean;
  /** The catalog's answer for the picture shown (`LayerInfo.available`). */
  availability: { ok: boolean; reason?: string };
  stats: WindGlyphStats | null;
  /** The air that is drawn, or null before there is one. */
  air: GlyphAir | null;
  tz: string;
  absTime(t: number): number;
}

/** What the control shows: why the switch cannot be used (or null), the caption lines under the chips and the line about the zoom. */
export interface GlyphView {
  reason: string | null;
  caption: string[];
  level: string;
}

export function glyphView(i: GlyphViewInput): GlyphView {
  const reason = !i.has3dView ? NEEDS_3D : i.availability.ok ? null : (i.availability.reason ?? 'Not available here');
  if (!i.on || !i.has3dView) return { reason, caption: [], level: '' };
  return {
    reason,
    caption: i.air && !reason ? glyphCaption(i.height, i.air, i.stats?.cellPx ?? null, i.tz, i.absTime) : [],
    level: glyphLevelLine(i.stats),
  };
}
