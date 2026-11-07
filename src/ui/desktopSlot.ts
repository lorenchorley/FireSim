/**
 * Where the desktop engine (workstream J) shows itself to the rest of the page. Everything of it is a lazy chunk (desktop.ts: the
 * check for a host, the Engine row, the link), so the first screen carries only this slot: empty on every page that has no
 * desktop host, which is every page but the one a desktop host serves.
 *   host  the desktop's object (the Engine row, the choice and the link), set once a host answered (never otherwise)
 *   run   the run that computes on the desktop (null: it computes on this device); the map's label, the statistics and the
 *         closed-link message read it
 */
import type { DesktopHost } from './desktopHost';
import type { DesktopRun } from './desktopTypes';
import { Store } from './store';

/** The desktop's object: the page's logic of it (desktopHost.ts) and the one thing that draws, the Engine row. */
export interface DesktopApi extends DesktopHost {
  /** Adds the Engine row to `card` (its chunk loads now) and keeps it in step; returns the function that takes it out again. */
  mount(card: HTMLElement): () => void;
}

export const desktopSlot = new Store<{ host: DesktopApi | null; run: DesktopRun | null }>({ host: null, run: null });

/** Calls `cb` when a desktop host is there (at once when it already is). Returns the stop function. */
export function watchDesktop(cb: (host: DesktopApi) => void): () => void {
  const now = desktopSlot.get().host;
  if (now) {
    cb(now);
    return () => undefined;
  }
  return desktopSlot.subscribe((s) => s.host && cb(s.host), ['host']);
}
