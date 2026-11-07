/**
 * The desktop engine's lazy chunk (0.8.0, workstream J): everything the page has of it except the empty slot of desktopSlot.ts.
 * main.ts loads it on the web build only (never in the Capacitor app) and calls `startDesktop`; it reads the pairing code from
 * the address, asks the page's own origin ONCE whether it is a desktop host and, when one answers, puts the host's object in the
 * slot, so Setup shows the Engine row (screens/engineRow.ts) and a run can compute on the desktop. On a page without a host
 * nothing is drawn, nothing is stored and no request is repeated.
 *
 * The host's modules are lane J1's (src/sim/remote/*), reached by name only: `detectHost` (src/sim/remote/detect.ts, a few lines,
 * loaded with this chunk) and, only when a run starts on the desktop engine, the lazy `connectRemote` (src/sim/remote/index.ts).
 * Both are found with `import.meta.glob`, like the other real modules (modules.ts), so a checkout without them still builds.
 * With `?debug=1` the seam `window.__firesimRemote = { detectHost, connectRemote }` replaces the two (the e2e specs put a stub
 * controller behind it).
 */
import { Capacitor } from '@capacitor/core';
import { CodeRefused, startDesktopHost } from './desktopHost';
import { desktopSlot, type DesktopApi } from './desktopSlot';
import type { ConnectFn, DetectFn, RemoteModule, RemoteSeam } from './desktopTypes';

// Eager: detect.ts is tiny and goes with this chunk. A build without it (no desktop host in this checkout) finds nothing here.
const detectModules = import.meta.glob('../sim/remote/detect.ts', { eager: true, import: 'detectHost' }) as Record<string, DetectFn>;
const realDetect: DetectFn | undefined = Object.values(detectModules)[0];
// Lazy: the rest (the wire, the controller) is a chunk of its own, loaded by the first Build on the desktop engine.
const remoteLoaders = import.meta.glob('../sim/remote/index.ts') as Record<string, () => Promise<unknown>>;

const isRemote = (m: unknown): m is RemoteModule => typeof (m as RemoteModule | null)?.connectRemote === 'function';

/** Is this the error of a refused code? `RemoteAuthError` of the loaded module, or (a stub, a copy of the class) one that says so by name. */
function refused(e: unknown, m?: RemoteModule): boolean {
  return (!!m?.RemoteAuthError && e instanceof m.RemoteAuthError) || (e instanceof Error && e.name === 'RemoteAuthError');
}

async function loadRemote(): Promise<RemoteModule> {
  const load = remoteLoaders['../sim/remote/index.ts'];
  const m = load ? await load() : null;
  if (!isRemote(m)) throw new Error('This build has no desktop engine.');
  return m;
}

export async function startDesktop(params: URLSearchParams): Promise<void> {
  const seam = params.has('debug') ? (window as unknown as { __firesimRemote?: RemoteSeam }).__firesimRemote : undefined;
  const connect: ConnectFn = async (o) => {
    let m: RemoteModule | undefined;
    try {
      if (seam?.connectRemote) return await seam.connectRemote(o);
      m = await loadRemote();
      return await m.connectRemote(o);
    } catch (e) {
      throw refused(e, m) ? new CodeRefused() : e;
    }
  };
  const host = await startDesktopHost({
    origin: location.origin,
    protocol: location.protocol,
    native: Capacitor.isNativePlatform(),
    hash: location.hash,
    // The same entry, the same state: only the fragment goes.
    replaceHash: (hash) => history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`),
    detect: seam?.detectHost ?? realDetect ?? (() => Promise.resolve(null)),
    connect,
    publishRun: (run) => {
      desktopSlot.set({ run });
      if (run) void import('./screens/desktopBar'); // the run's label and chip: ready by the time the screen asks
    },
  });
  if (!host) return;
  // The two things that draw are chunks of their own, loaded only now that a host is there; each hands back the function that undoes it.
  const later = <T>(load: () => Promise<T>, use: (m: T) => (() => void) | void): (() => void) => {
    let undo: (() => void) | void;
    let gone = false;
    void load().then((m) => {
      if (!gone) undo = use(m);
    });
    return () => {
      gone = true;
      undo?.();
    };
  };
  const api: DesktopApi = {
    ...host,
    mount: (card, build) => later(() => import('./screens/engineRow'), (m) => m.mountEngineRow(api, card, build)),
    decorate: (o) => later(() => import('./screens/desktopBar'), (m) => m.decorateSim(api, o)),
  };
  desktopSlot.set({ host: api });
}
