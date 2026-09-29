/**
 * Small pieces shared by the transport controls (top bar, speed, time popover, timeline): a group of collapsed-by-default
 * popovers (one open at a time, closed by an outside tap or Escape, never by anything the simulation does) and a few
 * glyphs that are not in the icon set.
 */
import { h, listen, svg } from '../../dom';

/** A stroked 24 px glyph from `|`-separated path data. */
export function glyph(paths: string, size = 24): SVGSVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      class: 'icon',
    },
    paths.split('|').map((d) => svg('path', { d })),
  );
}

export const GLYPHS = {
  menu: 'M4 6.5h16|M4 12h16|M4 17.5h16',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12|M18 6L6 18',
} as const;

export interface PopoverEntry {
  id: string;
  /** The button that opens it (gets aria-expanded and gets the focus back on Escape). */
  button: HTMLElement;
  panel: HTMLElement;
  onOpen?(): void;
  onClose?(): void;
}

export interface PopoverGroup {
  toggle(id: string): void;
  open(id: string): void;
  closeAll(returnFocus?: boolean): void;
  openId(): string | null;
  destroy(): void;
}

/**
 * Popovers hang from `host` (the top bar). While one is open a transparent scrim covers the screen below the bar, so a
 * tap outside only closes it (on the click, so the tap is not also delivered to what is underneath) and never reaches
 * the map.
 */
export function createPopoverGroup(host: HTMLElement, entries: readonly PopoverEntry[]): PopoverGroup {
  let current: PopoverEntry | null = null;
  const scrim = h('div', { class: 'tb-scrim', hidden: true, aria: { hidden: true }, on: { click: () => closeAll() } });
  host.prepend(scrim);
  for (const e of entries) {
    e.panel.hidden = true;
    e.button.setAttribute('aria-expanded', 'false');
  }
  function close(e: PopoverEntry): void {
    e.panel.hidden = true;
    e.button.setAttribute('aria-expanded', 'false');
    e.onClose?.();
  }
  /** Close whatever is open. Focus goes back to the button that opened it (unless `returnFocus` is false), so a keyboard or screen-reader user is not dropped on the page. */
  function closeAll(returnFocus = true): void {
    const was = current;
    current = null;
    scrim.hidden = true;
    if (was) {
      close(was);
      if (returnFocus) was.button.focus({ preventScroll: true });
    }
  }
  function open(id: string): void {
    const e = entries.find((x) => x.id === id);
    if (!e || current === e) return;
    if (current) close(current);
    current = e;
    scrim.hidden = false;
    e.panel.hidden = false; // shown first: onOpen fills in content that only updates while visible
    e.onOpen?.();
    e.button.setAttribute('aria-expanded', 'true');
    // Keyboard and screen-reader users continue inside the popover (Tab reaches its controls next).
    e.panel.focus({ preventScroll: true });
  }
  // Tabbing out of the bar (past the last control of an open popover) closes it, like the round menus do: focus is never
  // left on a control hidden behind the scrim while the popover stays open.
  const onFocusOut = (ev: FocusEvent): void => {
    const to = ev.relatedTarget as Node | null;
    if (current && to && !host.contains(to)) closeAll(false);
  };
  host.addEventListener('focusout', onFocusOut);
  // In the capture phase, so that one Escape closes the popover and does not also close the panels behind it.
  const off = listen(
    document,
    'keydown',
    (ev) => {
      if (ev.key === 'Escape' && current) {
        ev.stopPropagation();
        closeAll(true);
      }
    },
    { capture: true },
  );
  return {
    open,
    toggle: (id) => (current?.id === id ? closeAll() : open(id)),
    closeAll,
    openId: () => current?.id ?? null,
    destroy() {
      off();
      host.removeEventListener('focusout', onFocusOut);
      current = null;
      scrim.remove();
    },
  };
}

/** Run `fn` at most once per animation frame with the latest argument. */
export function frameThrottle<T>(fn: (v: T) => void): { push(v: T): void; flush(): void; cancel(): void } {
  let raf = 0;
  let pending: { v: T } | null = null;
  const run = (): void => {
    raf = 0;
    if (pending) {
      const { v } = pending;
      pending = null;
      fn(v);
    }
  };
  return {
    push(v) {
      pending = { v };
      if (!raf) raf = requestAnimationFrame(run);
    },
    flush() {
      if (raf) cancelAnimationFrame(raf);
      run();
    },
    cancel() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      pending = null;
    },
  };
}
