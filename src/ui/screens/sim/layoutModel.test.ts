import { describe, expect, it } from 'vitest';
import { backLayer, badgeText, cycleDetent, detentHeights, DOCK_H, fitMenu, GRIP_H, pressTab, reduceMenu, snapDetent, tapHandle } from './layoutModel';
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

  it('the collapsed dock is the 56 px bottom navigation and an open sheet shows its 44 px head plus content at peek', () => {
    expect(DOCK_H).toBe(56);
    expect(GRIP_H).toBeGreaterThanOrEqual(44);
    // On a 360 x 640 phone the room between the chrome and the timeline is about 400 px: peek still shows a head and a card.
    const h = detentHeights(400);
    expect(h.peek - DOCK_H - GRIP_H).toBeGreaterThanOrEqual(96);
  });

  it('a tap on the grab handle steps the sheet taller, and from full back to peek', () => {
    expect(cycleDetent('peek')).toBe('half');
    expect(cycleDetent('half')).toBe('full');
    expect(cycleDetent('full')).toBe('peek');
  });
});

describe('Back and Escape: one layer per press, top-most first', () => {
  const none = { popover: null, menu: null, panelOpen: false, pending: false, sheet: 'closed' } as const;

  it('closes a top-bar sheet (menu, time, speed) before anything else', () => {
    expect(backLayer({ ...none, popover: 'speed', menu: 'tools', panelOpen: true, sheet: 'half' })).toBe('popover');
  });

  it('then the speed dial or view list, then the tool panel (or a mark waiting to be confirmed), then the bottom sheet', () => {
    expect(backLayer({ ...none, menu: 'view', panelOpen: true, sheet: 'half' })).toBe('menu');
    expect(backLayer({ ...none, panelOpen: true, sheet: 'half' })).toBe('panel');
    expect(backLayer({ ...none, pending: true })).toBe('panel');
    expect(backLayer({ ...none, sheet: 'peek' })).toBe('sheet');
  });

  it('reports nothing to close when everything is collapsed, so Back may leave the screen', () => {
    expect(backLayer(none)).toBeNull();
  });

  it('simulating Back presses walks down the layers and ends with nothing open', () => {
    let s: Parameters<typeof backLayer>[0] = { popover: 'menu', menu: 'tools', panelOpen: true, pending: true, sheet: 'full' };
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const l = backLayer(s);
      if (!l) break;
      seen.push(l);
      if (l === 'popover') s = { ...s, popover: null };
      else if (l === 'menu') s = { ...s, menu: null };
      else if (l === 'panel') s = { ...s, panelOpen: false, pending: false };
      else s = { ...s, sheet: 'closed' };
    }
    expect(seen).toEqual(['popover', 'menu', 'panel', 'sheet']);
  });
});

describe('speed dial and view card fit', () => {
  it('the six tools fit one column above the Tools button on a portrait phone', () => {
    // 44 px rows with 8 px gaps: 6 rows need 304 px.
    expect(fitMenu(6, { availH: 320, availW: 330, itemH: 44, itemW: 176, gap: 8 })).toEqual({ cols: 1, rows: 6, scroll: false });
  });

  it('a landscape phone spreads the dial over columns towards the middle instead of scrolling', () => {
    expect(fitMenu(6, { availH: 150, availW: 700, itemH: 44, itemW: 176, gap: 8 })).toEqual({ cols: 2, rows: 3, scroll: false });
  });
});
