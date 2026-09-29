/**
 * Pure rules of the simulation screen's collapsed chrome (no DOM, unit-tested): which floating menu is open, how the
 * bottom dock reacts to taps and drags, how tall each dock detent is, and how many columns a menu list needs so it
 * fits the room above the timeline. The DOM code (simScreen.ts, sheet.ts, mapMenu.ts) only applies the results.
 */
import type { MenuId, SheetDetent, SheetTab } from './context';

/** Height (px) of the slim dock row that holds the four tab buttons: 44 px tabs (the smallest tap target) under a 2 px border. Keep in step with --dock-h in tokens.css. */
export const DOCK_H = 46;
/** Height (px) of the grip row that tops an open panel. */
export const GRIP_H = 44;

// ───────────── floating menus ─────────────

export type MenuEvent =
  | { type: 'toggle'; id: MenuId }
  /** An item was chosen (tool, camera mode…), the map was tapped, Escape was pressed or a panel opened. */
  | { type: 'pick' }
  | { type: 'map-tap' }
  | { type: 'escape' }
  | { type: 'panel-open' };

/** The menu that is open after an event: only one at a time; every event but a toggle collapses them all. */
export function reduceMenu(cur: MenuId | null, ev: MenuEvent): MenuId | null {
  if (ev.type === 'toggle') return cur === ev.id ? null : ev.id;
  return null;
}

/** Columns and rows a menu list of `n` items needs to fit `availH` × `availW` (px); `scroll` when even the best does not. */
export interface MenuFit {
  cols: number;
  rows: number;
  scroll: boolean;
}

export function fitMenu(n: number, o: { availH: number; availW: number; itemH?: number; itemW?: number; gap?: number }): MenuFit {
  const itemH = o.itemH ?? 48;
  const itemW = o.itemW ?? 190;
  const gap = o.gap ?? 4;
  const maxCols = Math.max(1, Math.min(n, Math.floor((o.availW + gap) / (itemW + gap))));
  for (let cols = 1; cols <= maxCols; cols++) {
    const rows = Math.ceil(n / cols);
    if (rows * itemH + (rows - 1) * gap <= o.availH) return { cols, rows, scroll: false };
  }
  return { cols: maxCols, rows: Math.ceil(n / maxCols), scroll: true };
}

// ───────────── bottom dock ─────────────

export interface DockState {
  sheet: SheetDetent;
  tab: SheetTab;
}

/**
 * A tab button was pressed. Closed: open the panel (peek) on that tab. Open on another tab: switch, keeping the height.
 * Open on the same tab: close, so a second tap always gives the map back.
 */
export function pressTab(cur: DockState, tab: SheetTab): DockState {
  if (cur.sheet === 'closed') return { sheet: 'peek', tab };
  if (cur.tab === tab) return { sheet: 'closed', tab };
  return { sheet: cur.sheet, tab };
}

/** The grip / empty part of the tab row was tapped: open at peek, or close. */
export function tapHandle(sheet: SheetDetent): SheetDetent {
  return sheet === 'closed' ? 'peek' : 'closed';
}

/**
 * Total dock height (px, tab row included) for each detent, given the vertical room `avail` between the top bar and the
 * timeline strip. Ordered closed ≤ peek ≤ half ≤ full; on short screens the open detents converge on "as tall as fits".
 */
export function detentHeights(avail: number): Record<SheetDetent, number> {
  const full = Math.max(DOCK_H, Math.round(avail - 8));
  const peek = Math.min(full, Math.max(DOCK_H + GRIP_H + 96, Math.round(avail * 0.38)));
  const half = Math.min(full, Math.max(peek, Math.round(avail * 0.62)));
  return { closed: DOCK_H, peek, half, full };
}

/** The detent whose height is nearest `h` (where a drag ended). */
export function snapDetent(h: number, heights: Record<SheetDetent, number>): SheetDetent {
  let best: SheetDetent = 'closed';
  for (const d of ['closed', 'peek', 'half', 'full'] as const) if (Math.abs(heights[d] - h) < Math.abs(heights[best] - h)) best = d;
  return best;
}

/** Badge text for a count of unseen cards ("9+" beyond nine so it never grows wide). */
export function badgeText(n: number): string {
  return n > 9 ? '9+' : String(n);
}
