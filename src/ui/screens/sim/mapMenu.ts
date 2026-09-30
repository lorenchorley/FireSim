/**
 * A collapsed-by-default floating menu over the map, in two Google-Maps flavours:
 *  - 'dial': an extended FAB ("Tools") whose speed dial opens labelled mini-FABs stacked above it;
 *  - 'card': a round white mini-FAB (the View button, showing the current camera mode) whose list opens as a small
 *    white card beside it.
 * The open state lives in the UI store (`menu`), so at most one menu is open and other components (map taps, Escape,
 * Back, tool panels) can collapse it. Disclosure pattern: the button carries aria-expanded / aria-controls, arrow keys
 * move between items, Escape and Tab-away collapse and return focus.
 */
import { h, setChildren, uniqueId } from '../../dom';
import { icon, type IconName } from '../../icons';
import type { Store } from '../../store';
import type { MenuId, UiState } from './context';
import { fitMenu, reduceMenu } from './layoutModel';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** A custom icon element (e.g. the live compass needle); replaces `icon`. */
  iconEl?: Node;
  testId?: string;
  data?: Record<string, string>;
  class?: string;
  /** A choice among several (the active tool, the camera mode): carries aria-pressed. */
  toggle?: boolean;
  /** Chosen: collapses the menu unless `keepOpen`. */
  onSelect(): void;
  keepOpen?: boolean;
}

/** A full-width custom row (e.g. zoom out / zoom in side by side) whose own buttons handle the taps. */
export interface MenuRow {
  id: string;
  el: HTMLElement;
}

export interface MapMenu {
  el: HTMLElement;
  fab: HTMLButtonElement;
  list: HTMLElement;
  items: ReadonlyMap<string, HTMLElement>;
  /** Show the current choice on the button. */
  setCurrent(name: IconName, label: string): void;
  /** Mark the chosen item (aria-pressed). */
  setPressed(id: string | null): void;
  /** Re-fit the list to the room (px) beside or above the button. */
  fit(availH: number, availW: number): void;
  isOpen(): boolean;
  destroy(): void;
}

/** Row height, width and gap of each flavour's list (px): the layout fit and the CSS use the same numbers. */
export const MENU_METRICS = {
  dial: { itemH: 44, itemW: 176, gap: 8 },
  card: { itemH: 48, itemW: 196, gap: 0 },
} as const;

export function createMapMenu(o: {
  id: MenuId;
  /** Accessible name of the button, e.g. "Tools". */
  label: string;
  testId: string;
  ui: Store<UiState>;
  entries: (MenuItem | MenuRow)[];
  current: { icon: IconName; label: string };
  variant: 'dial' | 'card';
  /** Visible text of the extended FAB ('dial'). */
  text?: string;
  /** Called when the list expands or collapses. */
  onOpenChange?: (open: boolean) => void;
}): MapMenu {
  const { ui } = o;
  const dial = o.variant === 'dial';
  const listId = uniqueId(`menu-${o.id}`);
  const offs: (() => void)[] = [];
  const items = new Map<string, HTMLElement>();
  let currentIcon: IconName = o.current.icon;

  const fabIcon = h('span', { class: 'fab-icon', aria: { hidden: true } }, icon(o.current.icon));
  const fab = h(
    'button',
    {
      type: 'button',
      class: dial ? 'fab fab-ext menu-fab tools-fab' : 'fab fab-sm menu-fab view-fab',
      dataset: { testid: o.testId },
      attrs: { 'aria-expanded': 'false', 'aria-controls': listId },
      aria: { label: `${o.label}: ${o.current.label}` },
      on: {
        click: (e) => {
          const wasOpen = ui.get().menu === o.id;
          ui.set({ menu: reduceMenu(ui.get().menu, { type: 'toggle', id: o.id }) });
          // Keyboard users land on the first item; a touch tap leaves focus alone (no focus ring on the map).
          if (!wasOpen && (e as MouseEvent).detail === 0) focusItem(0);
        },
      },
    },
    dial ? [fabIcon, h('span', { class: 'fab-label' }, o.text ?? o.label)] : fabIcon,
  );

  const rendered = o.entries.map((e) => {
    if ('el' in e) {
      items.set(e.id, e.el);
      return e.el;
    }
    const glyph = e.iconEl ?? (e.icon ? icon(e.icon) : null);
    const b = h(
      'button',
      {
        type: 'button',
        class: [dial ? 'dial-item' : 'menu-item', e.class],
        dataset: { ...(e.data ?? {}), ...(e.testId ? { testid: e.testId } : {}) },
        attrs: { 'aria-pressed': e.toggle ? 'false' : null },
        on: {
          click: () => {
            if (!e.keepOpen) ui.set({ menu: reduceMenu(ui.get().menu, { type: 'pick' }) });
            e.onSelect();
            if (!e.keepOpen) fab.focus({ preventScroll: true });
          },
        },
      },
      dial
        ? [h('span', { class: 'dial-label' }, [e.toggle ? icon('check', { class: 'dial-check' }) : null, h('span', null, e.label)]), h('span', { class: 'dial-fab', aria: { hidden: true } }, glyph)]
        : [h('span', { class: 'menu-item-icon', aria: { hidden: true } }, glyph), h('span', { class: 'menu-item-label' }, e.label), e.toggle ? icon('check', { class: 'menu-check' }) : null],
    );
    items.set(e.id, b);
    return b;
  });
  const list = h('div', { class: ['menu-list', dial ? 'dial-list' : 'menu-card'], id: listId, hidden: true, attrs: { role: 'group' }, aria: { label: o.label } }, rendered);
  // The button comes first in tab order (Tab from it goes into the list); the list is positioned beside it with CSS.
  const el = h('div', { class: ['map-menu', dial ? 'map-menu-dial' : 'map-menu-card'], dataset: { menu: o.id } }, [fab, list]);

  const focusable = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('button:not([disabled])')].filter((b) => !b.closest('[hidden]'));
  function focusItem(i: number): void {
    const all = focusable();
    const pressed = i === 0 ? all.find((b) => b.getAttribute('aria-pressed') === 'true') : undefined;
    (pressed ?? all[Math.max(0, Math.min(all.length - 1, i))])?.focus({ preventScroll: true });
  }

  el.addEventListener('keydown', (e) => {
    if (ui.get().menu !== o.id) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      ui.set({ menu: reduceMenu(ui.get().menu, { type: 'escape' }) });
      fab.focus({ preventScroll: true });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      const all = focusable();
      if (!all.length) return;
      e.preventDefault();
      const cur = all.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : cur < 0 ? (e.key === 'ArrowDown' ? 0 : all.length - 1) : (cur + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length;
      all[next]!.focus({ preventScroll: true });
    }
  });
  // Tabbing out of the open menu collapses it (focus never gets stuck on hidden items).
  el.addEventListener('focusout', (e) => {
    const to = e.relatedTarget as Node | null;
    if (ui.get().menu === o.id && to && !el.contains(to)) ui.set({ menu: null });
  });

  let lastOpen = false;
  const render = (): void => {
    const open = ui.get().menu === o.id;
    if (open === lastOpen) return;
    lastOpen = open;
    list.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
    el.classList.toggle('is-open', open);
    // An open speed dial shows a close cross on its button (the Material speed-dial pattern); the view button keeps its mode.
    if (dial) setChildren(fabIcon, icon(open ? 'close' : currentIcon));
    o.onOpenChange?.(open);
  };
  offs.push(ui.subscribe(render, ['menu']));
  render();

  const m = MENU_METRICS[o.variant];
  return {
    el,
    fab,
    list,
    items,
    setCurrent(name, label) {
      currentIcon = name;
      if (!(dial && lastOpen)) setChildren(fabIcon, icon(name));
      fab.setAttribute('aria-label', `${o.label}: ${label}`);
    },
    setPressed(id) {
      for (const [k, b] of items) if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(k === id));
    },
    fit(availH, availW) {
      // The rows grow with the text size: measure them while the list is showing (the metrics are the minimum).
      let itemH: number = m.itemH;
      let itemW: number = m.itemW;
      if (!list.hidden) for (const b of items.values()) {
        itemH = Math.max(itemH, b.offsetHeight);
        itemW = Math.max(itemW, b.offsetWidth);
      }
      const f = fitMenu(items.size, { availH, availW, itemH, itemW, gap: m.gap });
      list.style.setProperty('--rows', String(f.rows));
      list.style.setProperty('--cols', String(f.cols));
      list.style.maxHeight = f.scroll ? `${Math.max(96, Math.floor(availH))}px` : '';
      list.classList.toggle('is-scroll', f.scroll);
    },
    isOpen: () => ui.get().menu === o.id,
    destroy() {
      for (const u of offs) u();
      el.remove();
    },
  };
}
