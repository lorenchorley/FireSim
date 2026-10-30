/**
 * The words of the Wind detail sheet (0.6.0): the title and the lines that say which step of wind detail the map shows, what the picture is and where it
 * is read, and what holds it back. Pure (no DOM, no Three), unit-tested (windDetailWords.test.ts); loaded with the sheet on the first tap, not in the entry.
 *
 * Truth in the sheet (plan section 4 rule 4): numbers are "about"; the model's cells are named, since between its points the wind is a smooth fit;
 * at the closest zoom the streaks bend around ridges and trees and wear small eddies that the model does not calculate, and the sheet says so in plain
 * words and never calls the bends or the eddies the model's; an estimated wind (the fast tier) says it is not simulated; reduced motion and the pause
 * after a minute without a touch (0.7.0) say why the streaks do not move.
 */
import type { WindHeight } from '../../../render/wind/glyphTypes';
import { BUDGET_LINE, LEVEL_LINE } from './glyphWords';
import type { DetailKind, WindDetailState } from './windDetailState';

export const SHEET_TITLE = 'Wind detail';
export const NOTHING_LINE = 'Nothing is drawn at this zoom.';
export const ZOOM_LINE = 'Zoom in for more detail.';
export const MOST_DETAILED_LINE = 'This is the most detailed level.';
export const OVERVIEW_LINE = 'These streaks do not get more detailed as you zoom in, until the closest level.';
export const EDDIES_LINE =
  'Where the ground rises or trees stand, the streaks bend around them, and small eddies are added behind them. These bends and eddies are added for looks, from the shape of the ground and the trees. The streaks also move faster than the real wind so that you can see them.';
export const ESTIMATED_LINE = "The fast tier's wind is estimated from the forecast and the shape of the ground. It is not simulated.";
export const STILL_LINE = 'Your phone is set to reduce motion, so the streaks stand still.';
export const PAUSED_LINE = 'The streaks paused to save battery. Touch the screen to move them again.';

/** What the picture is, after "Level N of 4:". The arrows are two steps: far apart, then closer together. */
const KIND_NAME: Record<Exclude<DetailKind, 'none'>, string> = {
  arrows: 'straight arrows',
  curves: 'curved flow lines',
  detailed: 'detailed streaks',
  overview: 'moving streaks over the whole area',
  volume: 'moving streaks through the air',
};

/** "Level 3 of 4: curved flow lines." (a second step of arrows is "straight arrows, closer together"); level 0 is "Nothing is drawn at this zoom." */
export function levelLine(s: Pick<WindDetailState, 'level' | 'kind'>): string {
  if (s.kind === 'none') return NOTHING_LINE;
  const name = s.kind === 'arrows' && s.level >= 2 ? `${KIND_NAME.arrows}, closer together` : KIND_NAME[s.kind];
  return `Level ${s.level} of 4: ${name}.`;
}

/** The model's cell as the sheet says it: "cells about 133 m wide", or "large cells" when the size is not known. */
function cellWords(cellM: number | null): string {
  return cellM !== null && Number.isFinite(cellM) && cellM > 0 ? `cells about ${Math.round(cellM)} m wide` : 'large cells';
}

export function windDetailWords(s: WindDetailState, o: { heightLabel: string; height: WindHeight; cellM: number | null }): { title: string; lines: string[] } {
  const lines: string[] = [levelLine(s)];
  const marks = s.kind === 'arrows' || s.kind === 'curves' || s.kind === 'detailed';
  // What and where: the model's wind at the height of the Wind height chip (the 10 m chip is the open-ground wind the fire feels).
  if (marks) lines.push(o.height === 'fire' ? 'Wind about 10 m above open ground.' : `Wind at about ${o.heightLabel} above the ground.`);
  if (s.kind === 'overview' && s.limits.includes('zoom')) lines.push(OVERVIEW_LINE);
  // What to do next. At level 0 nothing is drawn: the zoom is the way in, unless the view is full (the budget line says what to do then).
  if (s.limits.includes('zoom')) lines.push(ZOOM_LINE);
  else if (s.kind === 'detailed') lines.push(MOST_DETAILED_LINE);
  else if (s.kind === 'none' && !s.limits.includes('budget')) lines.push(LEVEL_LINE[0]);
  if (s.kind === 'detailed') {
    // The model's part and the added part, said apart.
    lines.push(`Direction and speed come from the air model, which works on ${cellWords(o.cellM)}.`, EDDIES_LINE);
  } else if (s.limits.includes('cells')) lines.push(`The air model works on ${cellWords(o.cellM)}. Between its points the wind is a smooth fit.`);
  if (s.limits.includes('budget')) lines.push(BUDGET_LINE);
  if (s.limits.includes('estimated')) lines.push(ESTIMATED_LINE);
  if (s.limits.includes('still')) lines.push(STILL_LINE);
  if (s.limits.includes('paused')) lines.push(PAUSED_LINE);
  return { title: SHEET_TITLE, lines };
}
