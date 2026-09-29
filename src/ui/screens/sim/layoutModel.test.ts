import { describe, expect, it } from 'vitest';
import { badgeText, detentHeights, DOCK_H, fitMenu, pressTab, reduceMenu, snapDetent, tapHandle } from './layoutModel';
import { DEFAULT_UI, type MenuId } from './context';
import { Store } from '../../store';

describe('defaults: everything collapsed', () => {
  it('starts with the dock closed and no menu open', () => {
    expect(DEFAULT_UI.sheet).toBe('closed');
    expect(DEFAULT_UI.menu).toBeNull();
    expect(DEFAULT_UI.panelOpen).toBe(false);
    expect(DEFAULT_UI.tool).toBe('why'); // the default map tap needs no button press
  });
});

describe('floating menus', () => {
  it('opens one menu at a time; a second toggle of the same one collapses it', () => {
    let m: MenuId | null = null;
    m = reduceMenu(m, { type: 'toggle', id: 'tools' });
    expect(m).toBe('tools');
    m = reduceMenu(m, { type: 'toggle', id: 'view' });
    expect(m).toBe('view'); // opening the view menu collapses the tools menu
    m = reduceMenu(m, { type: 'toggle', id: 'view' });
    expect(m).toBeNull();
  });

  it('collapses after a pick, a map tap, Escape or a panel opening', () => {
    for (const type of ['pick', 'map-tap', 'escape', 'panel-open'] as const) {
      expect(reduceMenu('tools', { type })).toBeNull();
      expect(reduceMenu('view', { type })).toBeNull();
      expect(reduceMenu(null, { type })).toBeNull();
    }
  });

  it('is driven through the UI store so other components can collapse it', () => {
    const ui = new Store({ ...DEFAULT_UI });
    let changes = 0;
    ui.subscribe(() => changes++, ['menu']);
    ui.set({ menu: reduceMenu(ui.get().menu, { type: 'toggle', id: 'tools' }) });
    expect(ui.get().menu).toBe('tools');
    ui.set({ menu: reduceMenu(ui.get().menu, { type: 'escape' }) });
    expect(ui.get().menu).toBeNull();
    ui.set({ menu: reduceMenu(ui.get().menu, { type: 'escape' }) }); // already collapsed: no notification
    expect(changes).toBe(2);
  });

  it('fits the list to the room: one column when it fits, more columns on short screens, scrolling as a last resort', () => {
    expect(fitMenu(6, { availH: 400, availW: 300 })).toEqual({ cols: 1, rows: 6, scroll: false });
    expect(fitMenu(6, { availH: 160, availW: 600 })).toEqual({ cols: 2, rows: 3, scroll: false });
    expect(fitMenu(6, { availH: 100, availW: 600 })).toEqual({ cols: 3, rows: 2, scroll: false });
    // A narrow phone cannot take a second column: the list scrolls instead of overflowing.
    expect(fitMenu(6, { availH: 160, availW: 260 })).toEqual({ cols: 1, rows: 6, scroll: true });
    expect(fitMenu(1, { availH: 10, availW: 10 }).cols).toBe(1);
  });
});

describe('bottom dock', () => {
  it('a tab opens the peek detent when closed; another tab switches; the same tab closes', () => {
    let d = { sheet: 'closed', tab: 'insights' } as ReturnType<typeof pressTab>;
    d = pressTab(d, 'weather');
    expect(d).toEqual({ sheet: 'peek', tab: 'weather' });
    d = pressTab({ sheet: 'half', tab: 'weather' }, 'stats');
    expect(d).toEqual({ sheet: 'half', tab: 'stats' });
    d = pressTab(d, 'stats');
    expect(d).toEqual({ sheet: 'closed', tab: 'stats' });
  });

  it('the handle opens at peek and closes from any open detent', () => {
    expect(tapHandle('closed')).toBe('peek');
    for (const s of ['peek', 'half', 'full'] as const) expect(tapHandle(s)).toBe('closed');
  });

  it('detent heights are ordered, start at the slim row, and never exceed the room', () => {
    for (const avail of [190, 300, 452, 654, 900]) {
      const h = detentHeights(avail);
      expect(h.closed).toBe(DOCK_H);
      expect(h.peek).toBeGreaterThanOrEqual(h.closed);
      expect(h.half).toBeGreaterThanOrEqual(h.peek);
      expect(h.full).toBeGreaterThanOrEqual(h.half);
      expect(h.full).toBeLessThanOrEqual(Math.max(DOCK_H, avail));
    }
    const h = detentHeights(654);
    expect(h.peek).toBeLessThan(h.half);
    expect(h.half).toBeLessThan(h.full);
  });

  it('a drag snaps to the nearest detent', () => {
    const h = detentHeights(654);
    expect(snapDetent(40, h)).toBe('closed');
    expect(snapDetent(h.peek + 5, h)).toBe('peek');
    expect(snapDetent(h.half - 10, h)).toBe('half');
    expect(snapDetent(9999, h)).toBe('full');
  });

  it('caps the badge at 9+', () => {
    expect([1, 9, 10, 120].map(badgeText)).toEqual(['1', '9', '9+', '9+']);
  });
});
