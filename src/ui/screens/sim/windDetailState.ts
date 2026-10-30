/**
 * The state of the Wind detail chip (0.6.0): which of the four steps of wind detail the map is showing now, what the picture is, and what
 * limits it (the zoom, the model's cells, a full view, an estimated wind, reduced motion). Pure (no DOM, no Three), unit-tested
 * (windDetailState.test.ts), and in the entry chunk: it imports only types of the render API and the glyph engine, the air helpers and the words
 * the Layers panel already holds. The words of the sheet are in windDetailWords.ts (loaded on the first tap).
 *
 * Truth in the chip (plan section 4 rule 4): the level is the finest wind picture ACTUALLY drawn, read from the layer's own statistics, so the
 * chip and the picture cannot disagree. Four pips by shape (a filled circle for a step reached, a ring for the rest), never by colour alone.
 * The Wind speed map is not a wind mark here: the chip is for the arrows and flow lines and for the Wind streaks.
 */
import { airKind, type AirKind } from '../../../core/airView';
import type { WindGlyphStats } from '../../../render/api';
import type { WindHeight } from '../../../render/wind/glyphTypes';
import type { SimContext } from './context';
import { GLYPH_SMOOTH_FIT_PX } from './glyphWords';

/** What the wind picture is: nothing drawn, the straight arrows, the curved flow lines, the detailed streaks of the closest zoom, the Wind streaks over the whole area, or through the air. */
export type DetailKind = 'none' | 'arrows' | 'curves' | 'detailed' | 'overview' | 'volume';
/** What holds the picture back, in the order the sheet says it. */
export type DetailLimit = 'budget' | 'zoom' | 'cells' | 'estimated' | 'still';
export interface WindDetailInput {
  glyphsOn: boolean;
  streaks: 'off' | 'surface' | 'volume';
  viewMode: 'orbit' | 'top' | 'ground';
  stats: WindGlyphStats | null;
  air: AirKind;
  height: WindHeight;
}
export interface WindDetailState {
  visible: boolean;
  /** Steps reached, 0 to 4: the pips filled. */
  level: 0 | 1 | 2 | 3 | 4;
  kind: DetailKind;
  limits: DetailLimit[];
  /** Changes only when something the chip or the sheet shows changes: the DOM is touched only then. */
  key: string;
}

const HIDDEN = (): WindDetailState => ({ visible: false, level: 0, kind: 'none', limits: [], key: 'hidden' });

/** The picture one switch draws now, or null when it draws nothing. `level` is the pips. */
interface Picture {
  level: 1 | 2 | 3 | 4;
  kind: Exclude<DetailKind, 'none'>;
}

/** The arrows and flow lines of the layer's own level; its closest zoom is the 0.5.0 long flow lines (the third step) unless the detailed streaks are drawn. */
function glyphPicture(stats: WindGlyphStats): Picture | null {
  if (!stats.active || stats.level < 1) return null;
  return stats.level <= 2 ? { level: stats.level as 1 | 2, kind: 'arrows' } : { level: 3, kind: 'curves' };
}

export function windDetailState(i: WindDetailInput): WindDetailState {
  const { stats, streaks } = i;
  if (!stats || !(i.glyphsOn || streaks !== 'off')) return HIDDEN(); // the 2-D map has no statistics; nothing wind is on
  if (i.viewMode === 'ground' && streaks === 'off') return HIDDEN(); // eye level draws no arrows
  if (stats.idle === 'no-wind' && streaks === 'off') return HIDDEN(); // waiting for the air: nothing to describe yet

  // The detailed streaks of the closest zoom are fed by both switches (the streaks only while they are the surface ones).
  const detailed = stats.detail !== 'off' && (i.glyphsOn || streaks === 'surface');
  let pic: Picture | null = null;
  if (detailed) pic = { level: 4, kind: 'detailed' };
  else {
    // The finer of the two; on a tie the arrows and lines, which follow the zoom.
    const glyph = i.glyphsOn ? glyphPicture(stats) : null;
    const moving: Picture | null = streaks === 'surface' ? { level: 1, kind: 'overview' } : streaks === 'volume' ? { level: 1, kind: 'volume' } : null;
    pic = glyph && (!moving || glyph.level >= moving.level) ? glyph : moving;
  }
  const level = pic?.level ?? 0;
  const kind: DetailKind = pic?.kind ?? 'none';
  const onGlyphs = kind === 'arrows' || kind === 'curves' || kind === 'detailed';

  const limits: DetailLimit[] = [];
  if (stats.idle === 'budget') limits.push('budget');
  if (level < 4 && stats.level < 4 && (kind === 'arrows' || kind === 'curves' || kind === 'overview')) limits.push('zoom');
  if (onGlyphs && (kind === 'detailed' || stats.cellPx > GLYPH_SMOOTH_FIT_PX)) limits.push('cells');
  if (i.air === 'diagnosed') limits.push('estimated');
  if (stats.detail === 'still') limits.push('still');

  return { visible: true, level, kind, limits, key: `true|${level}|${kind}|${limits.join(',')}|${i.height}` };
}

/** The chip's accessible name for a level (the visible text is always "Wind detail"). */
export function chipLabel(level: number): string {
  return level >= 1 ? `Wind detail: level ${level} of 4. Open the explanation.` : 'Wind detail: not drawn yet. Open the explanation.';
}

/** What the chip and the sheet read from the screen: the layer switches, the camera mode, the layer's statistics and the kind of air. */
export function windDetailInput(ctx: Pick<SimContext, 'layers' | 'ui' | 'view' | 'session'>): WindDetailInput {
  const l = ctx.layers.get();
  return {
    glyphsOn: l.windGlyphs,
    streaks: l.wind,
    viewMode: ctx.ui.get().viewMode,
    stats: ctx.view.windGlyphStats?.() ?? null,
    air: airKind(ctx.session.state.get().snapshot?.atmosphere),
    height: l.windHeight,
  };
}
