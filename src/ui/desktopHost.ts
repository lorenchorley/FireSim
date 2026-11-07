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
import { CLOSED_LINK, CLOSED_LINK_HELP, ENGINE_PROBLEM, RUNNING_ON_DESKTOP } from './desktopWords';
import type { DesktopLink, DesktopRun, DetectFn, HostInfo } from './desktopTypes';
import { SwitchableController, watchStandby } from './runController';
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
  problem: 'needs-code' | 'refused' | 'rate-limited' | 'unreachable' | null;
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
  /** The controller the run that computes on the desktop holds (the one `take` handed out), or null. */
  proxy(): SwitchableController | null;
  /**
   * The new engine of "Continue on this device" has started (desktopRestart.ts calls this then, and not before): the run gives up its
   * link. The engine choice goes back to This device, the link is closed, and the run is marked as started again on this device.
   * Returns the run's controller, or null when no run holds a desktop link.
   */
  leave(): SwitchableController | null;
  /** Setup is shown again: closes a link no run took, closes the last run's, and forgets that run. */
  release(): void;
}

/** The code was refused: a wrong code, or the desktop has stopped taking codes from this device for a while. The row says which, next to the code box. */
export class CodeRefused extends Error {
  constructor(readonly reason: 'wrong-code' | 'rate-limited' = 'wrong-code') {
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
  /** Opens the link (`info`: what the start-up check found, so the connection does not ask again); a refused code rejects with {@link CodeRefused}, any other failure with its own error. */
  connect(o: { base: string; code: string; info: HostInfo }): Promise<DesktopLink>;
  /** Tells the screens which run computes on the desktop (null: none). */
  publishRun(run: DesktopRun | null): void;
  /**
   * This device's own engine, made idle when the link opens (null: it could not be made). On a page the desktop host serves, that engine's
   * script comes from the host: made at once, it is here when the host is gone. The run's controller holds it for the fallback.
   */
  standby?(): SimController | null;
  /** The link has opened: the moment to load, once and idle, what the running screen can still ask the host for. */
  warm?(): void;
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
  /** This device's own engine, idle, until `take` gives it to the run's controller (or the link is let go before). */
  standby: SimController | null;
  /** Whether that engine has reported a failure since it was made. */
  watch?: ReturnType<typeof watchStandby>;
  /** The sentence the link ended with, once it ended. */
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
    const e: Entry = { link, standby: null, dead: null, off: () => undefined };
    const ended = (reason: string): void => {
      e.dead = reason || CLOSED_LINK;
      if (e !== taken || !run) return;
      // The run's engine is gone: the map's chip says so with the link's own sentence, and the next Setup starts on This device.
      run = { ...run, closed: true, closedReason: e.dead };
      env.publishRun(run);
      state.set({ engine: 'device' });
    };
    // The link says when it ends. A link that cannot says it with an `error` event of its controller, and then any error ends the run.
    e.off = link.onClosed ? link.onClosed(ended) : link.controller.on('error', ended);
    return e;
  };
  const close = (e: Entry | null): void => {
    if (!e) return;
    e.off();
    e.watch?.stop();
    e.standby?.dispose();
    e.standby = null;
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
        pending = open(await env.connect({ base: env.origin, code, info }));
        // The link is open while the host is surely up: this device's own engine is made now (its script comes from the host), and what the running screen can still ask for is loaded.
        try {
          pending.standby = env.standby?.() ?? null;
          if (pending.standby) pending.watch = watchStandby(pending.standby);
        } catch {
          pending.standby = null;
        }
        env.warm?.();
        return true;
      } catch (e) {
        if (e instanceof CodeRefused && e.reason === 'rate-limited') {
          // The code may be the right one: it is kept, so the same button works again in a minute.
          state.set({ problem: 'rate-limited' });
        } else if (e instanceof CodeRefused) {
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
      // The run's controller owns the standby now (and a standby that reported a failure meanwhile is not handed over).
      const usable = e.standby && !e.watch?.bad() ? e.standby : null;
      if (e.standby && !usable) e.standby.dispose();
      e.watch?.stop();
      const proxy = new SwitchableController(l.controller, usable);
      e.standby = null;
      return (e.proxy = proxy);
    },
    proxy: () => taken?.proxy ?? null,
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
