/**
 * The Back button (Android hardware Back, the browser's Back, and Escape where a screen forwards it): it closes the
 * top-most thing first — a confirmation dialog, a dataset's detail page, a full-screen screen (Data sets, How this
 * simulation works, Settings), then the simulation's own menus, popovers, panels and dock — and only then leaves the
 * simulation (after asking) or the app.
 *
 * History model: ONE guard entry is kept on the browser history whenever anything can be closed (a layer is open, the
 * simulation or the build is showing). Back pops the guard (popstate), the stack closes one thing, and the guard is pushed
 * again if something closable is left. Closing from the UI (a Close button) never touches the history; when nothing
 * closable is left the guard is removed (history.back(), its popstate ignored), so the next Back leaves the app. On Android
 * the native shell maps the hardware Back to WebView.goBack() while the WebView can go back (MainActivity), which fires
 * the same popstate.
 */

export interface HistoryLike {
  pushState(data: unknown, unused: string): void;
  back(): void;
}

/** Something the Back button can close. */
export interface BackLayer {
  /** For tests and debugging ('settings', 'datasets', 'confirm' ...). */
  id: string;
  /**
   * One step back INSIDE the layer (e.g. a data set's detail page back to the list). Return true when it did something;
   * false (or absent) lets the stack close the whole layer.
   */
  back?(): boolean;
  /** Close the layer (called by the stack; the owner then must not call its remove function again, though it may). */
  close(): void;
}

/** What is under the layers: the current screen (the simulation, the build, Setup). */
export interface BackBase {
  /** One step back on the screen itself (close a menu, cancel the build, ask to leave the simulation). True = handled. */
  back(): boolean;
  /** True while the screen wants Back to come to it (the simulation, the build); false on Setup (Back leaves the app). */
  closable(): boolean;
}

export class BackStack {
  private readonly layers: BackLayer[] = [];
  private guarded = false;
  private ignore = 0;
  private base: BackBase = { back: () => false, closable: () => false };

  constructor(private readonly hist: HistoryLike) {}

  setBase(base: BackBase): void {
    this.base = base;
    this.sync();
  }

  /** Open layers, bottom first (for tests and debugging). */
  ids(): string[] {
    return this.layers.map((l) => l.id);
  }

  get depth(): number {
    return this.layers.length;
  }

  /** Register a layer on top. Returns `remove`: call it when the layer closes by itself (its own Close button). Idempotent. */
  push(layer: BackLayer): () => void {
    this.layers.push(layer);
    this.sync();
    return () => {
      const i = this.layers.indexOf(layer);
      if (i < 0) return;
      this.layers.splice(i, 1);
      this.sync();
    };
  }

  /** The history's popstate: the guard is gone; step back once and put the guard back if needed. */
  onPopState(): void {
    if (this.ignore > 0) {
      this.ignore--;
      return;
    }
    this.guarded = false;
    this.back();
    this.sync();
  }

  /** One step back (also for Escape forwarded by a screen). True when something was closed or handled. */
  back(): boolean {
    const top = this.layers[this.layers.length - 1];
    if (top) {
      let inner = false;
      try {
        inner = !!top.back?.();
      } catch (e) {
        console.error(e);
      }
      if (!inner) {
        const i = this.layers.lastIndexOf(top);
        if (i >= 0) this.layers.splice(i, 1);
        top.close();
      }
      this.sync();
      return true;
    }
    const handled = this.base.back();
    this.sync();
    return handled;
  }

  /** Keep exactly one guard entry while something can be closed, none otherwise. */
  sync(): void {
    const want = this.layers.length > 0 || this.base.closable();
    if (want && !this.guarded) {
      this.guarded = true;
      this.hist.pushState({ firesim: 'guard' }, '');
    } else if (!want && this.guarded) {
      this.guarded = false;
      this.ignore++;
      this.hist.back();
    }
  }
}

/** The app's stack (set by the App); screens and dialogs register their layers through {@link pushBackLayer}. */
let current: BackStack | null = null;

export function setAppBackStack(stack: BackStack | null): void {
  current = stack;
}

/** Register a layer with the app's Back stack (a no-op outside the app, e.g. in the style guide). Returns `remove`. */
export function pushBackLayer(layer: BackLayer): () => void {
  return current ? current.push(layer) : () => undefined;
}

/**
 * Ask an element to step back as if Escape had been pressed on it: dispatches a cancelable Escape keydown on `target` and
 * reports whether anything reacted — a handler called preventDefault(), or the DOM under `watch` changed synchronously
 * (a menu collapsed, a detail page went back to its list, the element closed). Used for screens that handle Escape
 * themselves but have no back() of their own.
 */
export function escapeStep(target: EventTarget, watch: Node): boolean {
  if (typeof MutationObserver === 'undefined' || typeof KeyboardEvent === 'undefined') return false;
  const mo = new MutationObserver(() => undefined);
  mo.observe(watch, { subtree: true, childList: true, attributes: true, characterData: false });
  const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  const changed = mo.takeRecords().length > 0;
  mo.disconnect();
  return ev.defaultPrevented || changed;
}
