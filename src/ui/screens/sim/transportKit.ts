/**
 * Small pieces shared by the transport controls (top bar, speed, time sheet, timeline): a group of collapsed-by-default
 * popovers (one open at a time, closed by an outside tap, Escape or Back, never by anything the simulation does), the
 * Maps-style bottom-sheet shell the speed and time controls open in, and a per-frame throttle.
 */
import { h, listen } from '../../dom';
import { icon } from '../../icons';

export interface PopoverEntry {
  id: string;
  /** The button that opens it (gets aria-expanded and gets the focus back on Escape). */
  button: HTMLElement;
  panel: HTMLElement;
  /** Dim the screen behind it (the main menu's side sheet); the speed and time sheets keep the map in full view. */
  dim?: boolean;
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
 * Popovers hang from `host` (the top bar). While one is open a scrim covers the screen behind it (transparent, or dimmed
 * for the side sheet), so a tap outside only closes it (on the click, so the tap is not also delivered to what is
 * underneath) and never reaches the map.
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
    scrim.classList.remove('is-dim');
    host.classList.remove('has-popover');
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
    scrim.classList.toggle('is-dim', !!e.dim);
    host.classList.add('has-popover');
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

/**
 * A Maps-style modal bottom sheet for a transport control (speed, time): grab handle, a title row with a close button,
 * then the body. Rounded top corners, --elev-3; the CSS pins it to the bottom of the screen (centred, at most 560 px wide;
 * two columns on a landscape phone).
 */
export function transportSheet(o: { title: string; label?: string; testId: string; body: HTMLElement[]; onClose(): void; class?: string }): HTMLElement {
  return h(
    'div',
    {
      class: ['bottom-sheet', 'tb-sheet', o.class],
      dataset: { testid: o.testId },
      attrs: { role: 'dialog', tabindex: '-1' },
      aria: { label: o.label ?? o.title },
      hidden: true,
    },
    [
      // The handle only says "this is a sheet": the close button, a tap outside, Escape and Back close it.
      h('span', { class: 'bottom-sheet-grab', aria: { hidden: true } }),
      h('div', { class: 'bottom-sheet-head' }, [
        h('h2', { class: 'bottom-sheet-title' }, o.title),
        h('button', { type: 'button', class: 'icon-btn', aria: { label: 'Close' }, on: { click: () => o.onClose() } }, icon('close')),
      ]),
      h('div', { class: 'bottom-sheet-body tb-sheet-body' }, o.body),
    ],
  );
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
