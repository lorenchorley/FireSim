/**
 * The desktop engine's lazy chunk (0.8.0, workstream J): everything the page has of it except the empty slot of desktopSlot.ts.
 * main.ts loads it (a chunk of its own, so the first screen carries none of it) and calls `startDesktop`; it reads the pairing code from
 * the address, asks the page's own origin ONCE whether it is a desktop host and, when one answers, puts the host's object in the
 * slot, so Setup shows the Engine row (screens/engineRow.ts) and a run can compute on the desktop. On a page without a host
 * nothing is drawn, nothing is stored and no request is repeated.
 *
 * 0.9.0 (D36): in the Android app, and in a browser only with the test seam `?desktopaddr=1`, no host serves the page, so nothing is asked at
 * start-up; the Engine row is drawn with an address box and the person types where the desktop is (the address is remembered, never the code).
 * On a page a host DOES serve, this file also keeps in memory what a run needs after that host has died (desktopKeep.ts): the engine's and the
 * speed test's worker scripts, once the link opens, and the chosen demo site's files, while Desktop is chosen.
 *
 * The host's modules are lane J1's (src/sim/remote/*), reached by name only: `detectHost` (src/sim/remote/detect.ts, a few lines,
 * loaded with this chunk) and, only when a run starts on the desktop engine, the lazy `connectRemote` (src/sim/remote/index.ts).
 * Both are found with `import.meta.glob`, like the other real modules (modules.ts), so a checkout without them still builds.
 * With `?debug=1` the seam `window.__firesimRemote = { detectHost, connectRemote }` replaces the two (the e2e specs put a stub
 * controller behind it).
 */
import { Capacitor } from '@capacitor/core';
import { resolveAssetBase, setAssetLoader, type AssetLoader } from '../data/assets';
import simWorkerUrl from '../sim/worker.ts?worker&url';
import type { Services } from './modules';
import { loadSlicePanel } from './screens/sim/sliceToolLoad';
import { loadAddress, saveAddress } from './desktopAddress';
import { CodeRefused, startDesktopHost, VersionMismatch, versionNumbers } from './desktopHost';
import { keptLoader, keepSiteFiles, ScriptKeeper } from './desktopKeep';
import { desktopSlot, type DesktopApi } from './desktopSlot';
import type { ConnectFn, DetectFn, RemoteModule, RemoteSeam } from './desktopTypes';
import speedWorkerUrl from './speedTest.worker.ts?worker&url';

// Eager: detect.ts is tiny and goes with this chunk. A build without it (no desktop host in this checkout) finds nothing here.
const detectModules = import.meta.glob('../sim/remote/detect.ts', { eager: true, import: 'detectHost' }) as Record<string, DetectFn>;
const realDetect: DetectFn | undefined = Object.values(detectModules)[0];
// Lazy: the rest (the wire, the controller) is a chunk of its own, loaded by the first Build on the desktop engine.
const remoteLoaders = import.meta.glob('../sim/remote/index.ts') as Record<string, () => Promise<unknown>>;

const isRemote = (m: unknown): m is RemoteModule => typeof (m as RemoteModule | null)?.connectRemote === 'function';

/**
 * Is this the error of a refused code, and which? `RemoteAuthError` of the loaded module, or (a stub, a copy of the class) one that says so by
 * name; its `reason` tells a wrong code from an address the desktop has stopped taking codes from for a while.
 */
function refusal(e: unknown, m?: RemoteModule): 'wrong-code' | 'rate-limited' | null {
  if (!((!!m?.RemoteAuthError && e instanceof m.RemoteAuthError) || (e instanceof Error && e.name === 'RemoteAuthError'))) return null;
  return (e as { reason?: unknown }).reason === 'rate-limited' ? 'rate-limited' : 'wrong-code';
}

/** Is this the error of a page and a host that speak different versions of the link (`RemoteVersionError`)? Same two ways of knowing as {@link refusal}. */
const isVersionError = (e: unknown, m?: RemoteModule): boolean => (!!m?.RemoteVersionError && e instanceof m.RemoteVersionError) || (e instanceof Error && e.name === 'RemoteVersionError');

async function loadRemote(): Promise<RemoteModule> {
  const load = remoteLoaders['../sim/remote/index.ts'];
  const m = load ? await load() : null;
  if (!isRemote(m)) throw new Error('This build has no desktop engine.');
  return m;
}

/**
 * What a running screen, and the statistics, can still ask the host for: the lazy chunks they open on first use (the run's own label and chip, the
 * statistics, the model card, the Air slice panel, the two top-bar sheets, the storage report of the Data sets screen, and since 0.9.0 the data plan
 * of Setup, which a Setup shown again after the host died would ask for). A page the host serves cannot fetch any of them once the host is gone, so
 * they are loaded once, one at a time and when the page is idle, as soon as a link opens.
 */
const WARM: (() => Promise<unknown>)[] = [
  () => import('./screens/desktopBar'),
  () => import('./screens/debugStats'),
  () => import('./screens/modelCard'),
  () => loadSlicePanel(),
  () => import('./screens/sim/paceSheet'),
  () => import('./screens/sim/windDetailSheet'),
  () => import('../data/storage'),
  () => import('../scenario/estimate'),
  () => import('./speedTest'),
];

/**
 * The two worker scripts a page the host serves would otherwise fetch from the host when it makes an engine or runs the speed test. Read once, when
 * the first link opens (a script is 0.5 MB and 5 kB; the dev server's are not files). Not in the app: its own files are always there.
 */
const scripts = new ScriptKeeper(
  { fetchFn: (u, i) => fetch(u, i), makeUrl: (b) => URL.createObjectURL(b) },
  { sim: simWorkerUrl, speed: speedWorkerUrl },
);

let warmed = false;
async function warm(): Promise<void> {
  if (warmed) return;
  warmed = true;
  if (!import.meta.env.DEV) {
    void scripts.keep().then(async () => {
      const speed = scripts.url('speed');
      if (speed) (await import('./speedTest')).setSpeedTestWorkerUrl(speed);
    });
  }
  for (const load of WARM) {
    await new Promise<void>((resolve) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => resolve(), { timeout: 2000 }) : setTimeout(resolve, 300)));
    try {
      await load();
    } catch {
      /* a chunk that cannot be loaded now is asked for again when it is needed */
    }
  }
}

/** A new Web Worker of the page's own engine from the kept script; undefined when it is not kept (yet) or cannot be made: the engine then starts from its own address. */
function localWorker(): Worker | undefined {
  const url = scripts.url('sim');
  if (!url) return undefined;
  try {
    return new Worker(url, { type: 'module' });
  } catch {
    return undefined;
  }
}

/** The asset loader's own read of a bundled file (src/data/assets.ts, the browser loader), for the files the kept site does not hold and for reading them. */
const networkAsset: AssetLoader = async (path, signal) => {
  try {
    const res = await fetch(new URL(path.replace(/^\/+/, ''), resolveAssetBase()).href, { signal });
    if (!res.ok) return null;
    // A single-page server answers an unknown path with index.html (200): that is "missing".
    if ((res.headers.get('content-type') ?? '').includes('text/html') && !path.endsWith('.html')) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
};

/** Keep (or let go of) one bundled demo site's files, as the asset loader's first source. Only the newest call counts. */
let siteCall: AbortController | null = null;
function keepSite(site: string | null): void {
  siteCall?.abort();
  siteCall = null;
  if (!site) {
    setAssetLoader(null);
    return;
  }
  const ctl = (siteCall = new AbortController());
  void keepSiteFiles(site, networkAsset, undefined, ctl.signal).then((kept) => {
    if (!ctl.signal.aborted) setAssetLoader(keptLoader(kept, networkAsset));
  });
}

/** Is anything listening at `base` that the page may not read? A request that needs no CORS answer is answered (opaque) by a host that does not list this page, and fails with no host. */
async function reachable(base: string): Promise<boolean> {
  try {
    await fetch(`${base.replace(/\/$/, '')}/__firesim/host`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

export async function startDesktop(params: URLSearchParams, services: Pick<Services, 'createLocalController'>): Promise<void> {
  const seam = params.has('debug') ? (window as unknown as { __firesimRemote?: RemoteSeam }).__firesimRemote : undefined;
  // The Android app, or a browser asked to act like it (the test seam): the person types where the desktop is.
  const typed = Capacitor.isNativePlatform() || params.get('desktopaddr') === '1';
  const connect: ConnectFn = async (o) => {
    let m: RemoteModule | undefined;
    try {
      if (seam?.connectRemote) return await seam.connectRemote(o);
      m = await loadRemote();
      return await m.connectRemote(o);
    } catch (e) {
      const why = refusal(e, m);
      if (why) throw new CodeRefused(why);
      if (isVersionError(e, m)) {
        const n = versionNumbers(e);
        throw new VersionMismatch(n.page, n.host);
      }
      throw e;
    }
  };
  const host = await startDesktopHost({
    origin: location.origin,
    protocol: location.protocol,
    native: Capacitor.isNativePlatform(),
    typed,
    address: typed ? await loadAddress() : '',
    saveAddress: (text) => void saveAddress(text),
    reach: seam?.reach ?? reachable,
    hash: location.hash,
    // The same entry, the same state: only the fragment goes.
    replaceHash: (hash) => history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`),
    detect: seam?.detectHost ?? realDetect ?? (() => Promise.resolve(null)),
    connect,
    publishRun: (run) => desktopSlot.set({ run }),
    // A page a host serves keeps a spare engine, some screens, two worker scripts and a demo site's files for the day the host is gone. The app's files are its own: it keeps none of it.
    ...(typed ? {} : { standby: () => services.createLocalController(), warm: () => void warm(), keepSite }),
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
    mount: (card, build, siteOf) => later(() => import('./screens/engineRow'), (m) => m.mountEngineRow(api, card, build, siteOf)),
    decorate: (o) => later(() => import('./screens/desktopBar'), (m) => m.decorateSim(api, o)),
    ...(typed ? {} : { localWorker }),
  };
  desktopSlot.set({ host: api });
}
