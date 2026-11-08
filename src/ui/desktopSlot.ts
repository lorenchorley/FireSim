/**
 * Where the desktop engine (workstream J) shows itself to the rest of the page. Everything of it is a lazy chunk (desktop.ts: the
 * check for a host, the Engine row, the link), so the first screen carries only this slot: empty on every page that has no
 * desktop host, which is every page but the one a desktop host serves.
 *   host  the desktop's object (the Engine row, the choice and the link), set once a host answered (never otherwise)
 *   run   the run that computes on the desktop (null: it computes on this device); the map's label, the statistics and the
 *         closed-link message read it
 */
import type { SimController } from '../sim/protocol';
import type { DesktopHost } from './desktopHost';
import type { DesktopRun } from './desktopTypes';
import type { SimSession } from './session';
import { Store } from './store';

/** What the simulation screen hands over for a run that computes on the desktop. */
export interface DecorateOptions {
  root: HTMLElement;
  /** The error chip, and the label on the map (the demo engine's slot) when the screen made one. */
  chip: HTMLElement;
  notice: HTMLElement | null;
  session: Pick<SimSession, 'scenario' | 'state' | 'restart'>;
  /** The page's `createLocalController`: a fresh in-app engine, never the desktop's. */
  makeController(): SimController;
  announce(message: string): void;
}

/** The desktop's object: the page's logic of it (desktopHost.ts) and the two things that draw, the Engine row and the run's label and error chip. */
export interface DesktopApi extends DesktopHost {
  /**
   * Adds the Engine row to `card` (its chunk loads now) and keeps it in step; `build` presses Build; `siteOf` is the bundled demo site Setup would
   * build now (null: none), which the row tells the page so it can keep that site while Desktop is chosen. Returns the function that takes it out again.
   */
  mount(card: HTMLElement, build: () => void, siteOf?: () => string | null): () => void;
  /** Labels the run on the map, puts the link's sentence in the error chip and adds "Continue on this device" to it. Returns the stop function. */
  decorate(o: DecorateOptions): () => void;
  /**
   * A new Web Worker of the page's own engine, started from the script kept in memory when the link opened (desktopKeep.ts), so that an engine
   * made after the host is gone does not need it. Absent on a page no host serves (the app's own files are always there), and undefined
   * until the script has been kept: the engine then starts from its own address, as it always did.
   */
  localWorker?(): Worker | undefined;
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
