/**
 * The desktop engine on the page (0.8.0, workstream J; contract section 4), as logic with no DOM and no network of its own: what the
 * page does about a desktop host, given an environment (`HostEnv`) that the thin file desktop.ts fills from the window. It
 *   - reads the pairing code from `#code=` of the address ONCE and takes it out of the address bar (`history.replaceState`); the
 *     code lives in this object's memory for the page load and nowhere else (never in storage, never in the store below);
 *   - asks the page's own origin, once, whether it is a desktop host (not in the Capacitor app, only on http or https; 800 ms);
 *   - keeps the choice of engine for this page load only: Desktop is preselected only when a code came with the address;
 *   - opens the link when a run starts on the desktop engine, tells a refused code from any other failure, and hands the link's
 *     controller to the run (`take`); a link that closes later is the run's error, and the next Setup starts on This device.
 * No result depends on any of this: the controller is the same protocol (src/sim/protocol.ts) whoever computes.
 */
import type { SimController } from '../sim/protocol';
import { CLOSED_LINK_HELP, ENGINE_PROBLEM, RUNNING_ON_DESKTOP } from './desktopWords';
import type { DesktopLink, DesktopRun, DetectFn, HostInfo } from './desktopTypes';
import { SwitchableController } from './runController';
import { Store } from './store';

export type EngineChoice = 'device' | 'desktop';

/** What the Engine row draws. It never holds the code, only whether there is one. */
export interface DesktopView {
  engine: EngineChoice;
  /** A code is held (from the address, or typed). */
  hasCode: boolean;
  /** The code came with the address, so the row asks for none until it is refused. */
  fromLink: boolean;
  /** The link is being opened. */
  busy: boolean;
  /** What to say next to the code box. */
  problem: 'needs-code' | 'refused' | 'unreachable' | null;
}

export interface DesktopHost {
  readonly info: HostInfo;
  readonly state: Store<DesktopView>;
  choose(engine: EngineChoice): void;
  /** The code box changed (kept in memory only; the box shows it back after a rebuild of Setup). */
  typeCode(text: string): void;
  /** What was typed in the code box (empty for a code that came with the address: that one is never shown). */
  typedCode(): string;
  /**
   * Build was pressed on Setup. On This device it resolves true at once. On Desktop it opens the link first (a wrong code stays on
   * Setup and is said next to the code box) and resolves true when the run may start. Never throws.
   */
  beforeBuild(): Promise<boolean>;
  /**
   * The controller of the run that is starting: the open link's on Desktop, null on This device. Throws, with the sentence the
   * build screen shows, when Desktop was chosen and the link is not there (closed while the model was built).
   */
  take(): SimController | null;
  /**
   * "Continue on this device": the run that computes on the desktop gives up its link. The engine choice goes back to This device (so
   * `take` gives the in-app engine), the link is closed, and the run is marked as started again on this device. Returns the run's
   * controller, which the caller points at the new engine (desktopRestart.ts), or null when no run holds a desktop link.
   */
  leave(): SwitchableController | null;
  /** Setup is shown again: closes a link no run took, closes the last run's, and forgets that run. */
  release(): void;
}

/** The code was refused (a wrong code, or too many wrong ones): the row says so next to the code box. */
export class CodeRefused extends Error {
  constructor() {
    super('The desktop did not accept the code.');
    this.name = 'CodeRefused';
  }
}

export interface HostEnv {
  /** The page's own origin: the only one the page ever asks. */
  origin: string;
  /** `location.protocol`. */
  protocol: string;
  /** The Capacitor app: it never asks. */
  native: boolean;
  /** `location.hash` as the page was opened. */
  hash: string;
  /** Replace the address's fragment (`history.replaceState`, keeping the history entry and its state). */
  replaceHash(hash: string): void;
  detect: DetectFn;
  /** Opens the link; a refused code rejects with {@link CodeRefused}, any other failure with its own error. */
  connect(o: { base: string; code: string }): Promise<DesktopLink>;
  /** Tells the screens which run computes on the desktop (null: none). */
  publishRun(run: DesktopRun | null): void;
}

/** The host's own answer is allowed this long (ms). */
export const DETECT_TIMEOUT_MS = 800;
/** A detect that never answers is given up on a little after that, so nothing can wait for it. */
const DETECT_GUARD_MS = DETECT_TIMEOUT_MS + 700;

/** A code as typed or linked: no spaces or dashes (a phone splits one for reading), capitals (the host's alphabet). */
export const normaliseCode = (text: string): string => text.replace(/[\s-]+/g, '').toUpperCase();

function fragmentParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ''));
}

/** The code of `#code=…`, or ''. */
export function codeFromHash(hash: string): string {
  return normaliseCode(fragmentParams(hash).get('code') ?? '');
}

/** The fragment without its `code` (what stays in the address bar): '' when nothing else is in it. */
export function hashWithoutCode(hash: string): string {
  const p = fragmentParams(hash);
  if (!p.has('code')) return hash;
  p.delete('code');
  const rest = p.toString();
  return rest ? `#${rest}` : '';
}

/** The answer of a host the page believes: the right app and protocol, a name, a count of cores, a Node version (the checks `detectHost` makes, once more here). */
export function isHostInfo(x: unknown): x is HostInfo {
  if (typeof x !== 'object' || x === null) return false;
  const h = x as Record<string, unknown>;
  const count = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return h.app === 'firesim-desktop-host' && h.protocol === 1 && typeof h.name === 'string' && typeof h.node === 'string' && count(h.cores) && (h.cores as number) >= 1 && count(h.sessions) && count(h.maxSessions);
}

/** Asks once whether the page's origin is a desktop host; null for any failure, mismatch or silence. */
async function detect(env: HostEnv): Promise<HostInfo | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      env.detect({ base: env.origin, timeoutMs: DETECT_TIMEOUT_MS }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), DETECT_GUARD_MS);
      }),
    ]);
    return isHostInfo(answer) ? answer : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start-up: take the code out of the address, and (when the page can be a desktop host's) ask once. Resolves with the host's
 * object when one answered, null otherwise (then nothing of the desktop engine shows anywhere).
 */
export async function startDesktopHost(env: HostEnv): Promise<DesktopHost | null> {
  // The code leaves the address bar at once, whatever comes next: it must not stay in the history or a bookmark.
  const code = codeFromHash(env.hash);
  const fromLink = code !== '';
  if (fromLink) env.replaceHash(hashWithoutCode(env.hash));
  if (env.native || !/^https?:$/.test(env.protocol)) return null;
  const info = await detect(env);
  if (!info) return null;
  return createHost(env, info, code, fromLink);
}

interface Entry {
  link: DesktopLink;
  /** The controller the run holds, once `take` handed it out. */
  proxy?: SwitchableController;
  /** The sentence of the link's error, once it said one. */
  dead: string | null;
  off(): void;
}

function createHost(env: HostEnv, info: HostInfo, initialCode: string, fromLinkAtStart: boolean): DesktopHost {
  let code = initialCode;
  let fromLink = fromLinkAtStart;
  let pending: Entry | null = null;
  let taken: Entry | null = null;
  let run: DesktopRun | null = null;
  const state = new Store<DesktopView>({ engine: code ? 'desktop' : 'device', hasCode: code !== '', fromLink, busy: false, problem: null });

  const open = (link: DesktopLink): Entry => {
    const e: Entry = { link, dead: null, off: () => undefined };
    e.off = link.controller.on('error', (message) => {
      e.dead = message;
      if (e !== taken || !run) return;
      // The run's engine is gone: the map's chip says so (the session shows the error), and the next Setup starts on This device.
      run = { ...run, closed: true };
      env.publishRun(run);
      state.set({ engine: 'device' });
    });
    return e;
  };
  const close = (e: Entry | null): void => {
    if (!e) return;
    e.off();
    try {
      e.link.close();
    } catch {
      /* closing a link that is already gone is fine */
    }
  };

  return {
    info,
    state,
    choose: (engine) => state.set({ engine, problem: null }),
    typeCode(text) {
      code = normaliseCode(text);
      fromLink = false;
      state.set({ hasCode: code !== '', fromLink: false, problem: null });
    },
    typedCode: () => (fromLink ? '' : code),
    async beforeBuild() {
      const s = state.get();
      if (s.engine !== 'desktop') {
        close(pending);
        pending = null;
        return true;
      }
      if (s.busy) return false;
      if (!code) {
        state.set({ problem: 'needs-code' });
        return false;
      }
      close(pending);
      pending = null;
      state.set({ busy: true, problem: null });
      try {
        pending = open(await env.connect({ base: env.origin, code }));
        return true;
      } catch (e) {
        if (e instanceof CodeRefused) {
          code = '';
          fromLink = false;
          state.set({ problem: 'refused', hasCode: false, fromLink: false });
        } else state.set({ problem: 'unreachable' });
        return false;
      } finally {
        state.set({ busy: false });
      }
    },
    take() {
      if (state.get().engine !== 'desktop') return null;
      const e = pending;
      pending = null;
      if (!e) throw new Error(ENGINE_PROBLEM.noLink);
      if (e.dead !== null) {
        close(e);
        throw new Error(e.dead);
      }
      taken = e;
      const l = e.link;
      run = { label: RUNNING_ON_DESKTOP, help: CLOSED_LINK_HELP, name: l.info.name, cores: l.info.cores, node: l.info.node, rttMs: () => l.rttMs(), closed: false };
      env.publishRun(run);
      return (e.proxy = new SwitchableController(l.controller));
    },
    leave() {
      const e = taken;
      if (!e?.proxy || !run) return null;
      close(e);
      close(pending);
      taken = pending = null;
      state.set({ engine: 'device', problem: null });
      run = { ...run, help: undefined, closed: true, restarted: true };
      env.publishRun(run);
      return e.proxy;
    },
    release() {
      close(pending);
      close(taken);
      pending = null;
      taken = null;
      run = null;
      env.publishRun(null);
      state.set({ problem: null }); // what was said on the last Setup is not said again on the next
    },
  };
}
