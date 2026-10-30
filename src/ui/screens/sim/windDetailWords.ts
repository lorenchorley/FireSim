/**
 * The words of the Wind detail sheet (0.6.0): the title and the lines that say which step of wind detail the map shows, what the picture is and where it
 * is read, and what holds it back. Pure (no DOM, no Three), unit-tested (windDetailWords.test.ts); loaded with the sheet on the first tap, not in the entry.
 *
 * Truth in the sheet (plan section 4 rule 4): numbers are "about"; the model's cells are named, since between its points the wind is a smooth fit;
 * at the closest zoom the streaks wear small eddies that the model does not calculate, and the sheet says so in plain words and never calls them the
 * model's; an estimated wind (the fast tier) says it is not simulated.
 */
import type { WindHeight } from '../../../render/wind/glyphTypes';
import { BUDGET_LINE, LEVEL_LINE } from './glyphWords';
import type { DetailKind, WindDetailState } from './windDetailState';

export const SHEET_TITLE = 'Wind detail';
export const NOTHING_LINE = 'Nothing is drawn at this zoom.';
export const ZOOM_LINE = 'Zoom in for more detail.';
export const MOST_DETAILED_LINE = 'This is the most detailed level.';
export const OVERVIEW_LINE = 'These streaks do not get more detailed as you zoom in, until the closest level.';
export const EDDIES_LINE = 'The small eddies are added for looks, from the shape of the ground. The streaks also move faster than the real wind so that you can see them.';
export const ESTIMATED_LINE = "The fast tier's wind is estimated from the forecast and the shape of the ground. It is not simulated.";
export const STILL_LINE = 'Your phone is set to reduce motion, so the streaks stand still.';

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

/** What the picture is at the What the fire feels height: the fire model's wind in its cells (60 m unless the scenario's fire grid makes them another size). */
const feltWords = (cellM: number | null | undefined): string => `The wind the fire feels, in ${cellWords(cellM ?? 60)}.`;

/** The model's cell as the sheet says it: "cells about 133 m wide", or "large cells" when the size is not known. */
function cellWords(cellM: number | null): string {
  return cellM !== null && Number.isFinite(cellM) && cellM > 0 ? `cells about ${Math.round(cellM)} m wide` : 'large cells';
}

export function windDetailWords(s: WindDetailState, o: { heightLabel: string; height: WindHeight; cellM: number | null; feltCellM?: number | null }): { title: string; lines: string[] } {
  const lines: string[] = [levelLine(s)];
  const marks = s.kind === 'arrows' || s.kind === 'curves' || s.kind === 'detailed';
  // What and where: the model's wind at the height of the Wind height chip (the 10 m chip is the open-ground wind; What the fire feels is the fire model's own, in its 60 m cells).
  if (marks) lines.push(o.height === 'fire' ? 'Wind about 10 m above open ground.' : o.height === 'felt' ? feltWords(o.feltCellM) : `Wind at about ${o.heightLabel} above the ground.`);
  if (s.kind === 'overview' && s.limits.includes('zoom')) lines.push(OVERVIEW_LINE);
  // What to do next. At level 0 nothing is drawn: the zoom is the way in, unless the view is full (the budget line says what to do then).
  if (s.limits.includes('zoom')) lines.push(ZOOM_LINE);
  else if (s.kind === 'detailed') lines.push(MOST_DETAILED_LINE);
  else if (s.kind === 'none' && !s.limits.includes('budget')) lines.push(LEVEL_LINE[0]);
  // The cells of the data that is drawn: the air model's, or for What the fire feels the fire model's own (about 60 m).
  const felt = o.height === 'felt';
  if (s.kind === 'detailed') {
    // The model's part and the added part, said apart.
    lines.push(felt ? `Direction and speed come from the air model, with the fire model's slope flow and the fire's own draw added, in ${cellWords(o.feltCellM ?? 60)}.` : `Direction and speed come from the air model, which works on ${cellWords(o.cellM)}.`, EDDIES_LINE);
  } else if (s.limits.includes('cells')) lines.push(felt ? `The wind the fire model uses is in ${cellWords(o.feltCellM ?? 60)}. Between its points the wind is a smooth fit.` : `The air model works on ${cellWords(o.cellM)}. Between its points the wind is a smooth fit.`);
  if (s.limits.includes('budget')) lines.push(BUDGET_LINE);
  if (s.limits.includes('estimated')) lines.push(ESTIMATED_LINE);
  if (s.limits.includes('still')) lines.push(STILL_LINE);
  return { title: SHEET_TITLE, lines };
}
