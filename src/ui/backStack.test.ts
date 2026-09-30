/**
 * The Back button (Android hardware Back → WebView.goBack() → popstate; the browser's Back; Escape): the top-most thing
 * closes first — a confirmation, a data set's detail page, the full-screen screen, then the simulation's own menus — and
 * only then the simulation asks to leave; on Setup, Back leaves the app. One guard entry sits on the history while
 * something can be closed and is removed when nothing can.
 */
import { describe, expect, it } from 'vitest';
import { BackStack, pushBackLayer, setAppBackStack, type HistoryLike } from './backStack';

/** A fake history that fires popstate (asynchronously in a browser; synchronously here, on flush()). */
class FakeHistory implements HistoryLike {
  entries = 1; // the page itself
  queue: (() => void)[] = [];
  onPop: () => void = () => undefined;
  pushState(): void {
    this.entries++;
  }
  back(): void {
    this.queue.push(() => {
      if (this.entries > 1) {
        this.entries--;
        this.onPop();
      }
    });
  }
  /** The user presses Back: false = the app would be left (nothing to go back to). */
  press(): boolean {
    if (this.entries <= 1) return false;
    this.entries--;
    this.onPop();
    this.flush();
    return true;
  }
  flush(): void {
    while (this.queue.length) this.queue.shift()!();
  }
}

function setup(): { hist: FakeHistory; stack: BackStack; log: string[]; base: { sim: boolean; menus: number; leaving: boolean } } {
  const hist = new FakeHistory();
  const stack = new BackStack(hist);
  hist.onPop = () => stack.onPopState();
  const log: string[] = [];
  const base = { sim: false, menus: 0, leaving: false };
  stack.setBase({
    closable: () => base.sim,
    back: () => {
      if (!base.sim) return false;
      if (base.menus > 0) {
        base.menus--;
        log.push('close sim menu');
        return true;
      }
      log.push('ask to leave');
      base.leaving = true;
      return true;
    },
  });
  return { hist, stack, log, base };
}

describe('BackStack', () => {
  it('on Setup with nothing open, Back leaves the app (no guard entry)', () => {
    const { hist } = setup();
    expect(hist.entries).toBe(1);
    expect(hist.press()).toBe(false);
  });

  it('closes the top-most layer first: detail page → list → screen → sim menus → leave', () => {
    const { hist, stack, log, base } = setup();
    base.sim = true;
    stack.sync();
    expect(hist.entries).toBe(2); // the guard
    base.menus = 2;
    let detail = true;
    const removeSettings = stack.push({ id: 'settings', close: () => log.push('close settings') });
    stack.push({
      id: 'datasets',
      back: () => {
        if (!detail) return false;
        detail = false;
        log.push('detail → list');
        return true;
      },
      close: () => log.push('close datasets'),
    });
    expect(hist.entries).toBe(2); // still one guard, whatever the depth
    expect(stack.ids()).toEqual(['settings', 'datasets']);
    for (let i = 0; i < 5; i++) expect(hist.press()).toBe(true);
    expect(log).toEqual(['detail → list', 'close datasets', 'close settings', 'close sim menu', 'close sim menu']);
    expect(hist.press()).toBe(true);
    expect(log[log.length - 1]).toBe('ask to leave');
    expect(base.leaving).toBe(true);
    expect(hist.entries).toBe(2); // the guard is back while the simulation shows
    removeSettings(); // already closed: idempotent
    expect(stack.depth).toBe(0);
  });

  it('a layer closed from the UI removes itself without touching the history; the guard goes when nothing is left', () => {
    const { hist, stack } = setup();
    const remove = stack.push({ id: 'settings', close: () => undefined });
    expect(hist.entries).toBe(2);
    remove();
    hist.flush();
    expect(hist.entries).toBe(1);
    expect(stack.depth).toBe(0);
    expect(hist.press()).toBe(false); // the next Back leaves the app, not a stale entry
  });

  it('the guard removal does not close anything (its popstate is ignored)', () => {
    const { hist, stack, log } = setup();
    const r1 = stack.push({ id: 'a', close: () => log.push('close a') });
    r1();
    stack.push({ id: 'b', close: () => log.push('close b') });
    hist.flush(); // the ignored popstate of the removed guard arrives late
    expect(log).toEqual([]);
    expect(stack.ids()).toEqual(['b']);
  });

  it('dialogs register through pushBackLayer (no-op without an app stack)', () => {
    setAppBackStack(null);
    expect(() => pushBackLayer({ id: 'confirm', close: () => undefined })()).not.toThrow();
    const { hist, stack, log } = setup();
    setAppBackStack(stack);
    pushBackLayer({ id: 'confirm', close: () => log.push('cancel dialog') });
    expect(hist.press()).toBe(true);
    expect(log).toEqual(['cancel dialog']);
    setAppBackStack(null);
  });

  it('Escape forwarded to back() steps once and keeps the guard in step', () => {
    const { hist, stack, log, base } = setup();
    base.sim = true;
    stack.sync();
    stack.push({ id: 'model-card', close: () => log.push('close card') });
    expect(stack.back()).toBe(true);
    expect(log).toEqual(['close card']);
    expect(hist.entries).toBe(2); // the simulation still wants Back
    base.sim = false;
    stack.sync();
    hist.flush();
    expect(hist.entries).toBe(1);
  });
});
