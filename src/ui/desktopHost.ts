/**
 * The desktop engine on the page (0.8.0, workstream J; contract section 4), as logic with no DOM and no network of its own: what the
 * page does about a desktop host, given an environment (`HostEnv`) that the thin file desktop.ts fills from the window. It
 *   - reads the pairing code from `#code=` of the address ONCE and takes it out of the address bar (`history.replaceState`); the
 *     code lives in this object's memory for the page load and nowhere else (never in storage, never in the store below);
 *   - asks the page's own origin, once, whether it is a desktop host (not in the Capacitor app, only on http or https; 800 ms);
 *   - keeps the choice of engine for this page load only: Desktop is preselected only when a code came with the address;
 *   - opens the link when a run starts on the desktop engine, tells a refused code from any other failure, and hands the link's
 *     controller to the run (`take`); a link that closes later is the run's error, and the next Setup starts on This device.
 * 0.9.0 (protocol 2, D36) changes three things. The host says little before the code (`HostProbe`: that it is a desktop host, the protocol, that
 * it needs a code), so the Engine row's second chip says "Desktop" until the host's welcome and then "Desktop (NAME, N cores)" (`DesktopView.host`).
 * In the Android app, which no host serves, and in a browser with the test seam `?desktopaddr=1`, the person TYPES the desktop's address
 * (desktopAddress.ts): nothing is asked at start-up, and Build probes that address first so the row can say "no desktop answered there" in words
 * (`env.typed`). And a page and a host of different protocols are told apart from a refused code (`VersionMismatch`).
 * No result depends on any of this: the controller is the same protocol (src/sim/protocol.ts) whoever computes.
 */
import type { SimController } from '../sim/protocol';
import { parseDesktopAddress } from './desktopAddress';
import { ADDRESS_PROBLEM, CLOSED_LINK, CLOSED_LINK_HELP, cleanName, ENGINE_PROBLEM, RUNNING_ON_DESKTOP, versionProblem } from './desktopWords';
import type { DesktopLink, DesktopRun, DetectFn, HostProbe } from './desktopTypes';
import { SwitchableController, watchStandby } from './runController';
import { Store } from './store';

export type EngineChoice = 'device' | 'desktop';

/** The version of the link this page speaks (`RemoteHostProbe.protocol`). */
export const HOST_PROTOCOL = 2;

/** What the Engine row draws. It never holds the code, only whether there is one. */
export interface DesktopView {
  engine: EngineChoice;
  /** A code is held (from the address, or typed). */
  hasCode: boolean;
  /** The code came with the address, so the row asks for none until it is refused. */
  fromLink: boolean;
  /** The link is being opened. */
  busy: boolean;
  /** What to say next to the code box (or the address box). */
  problem: 'needs-code' | 'refused' | 'rate-limited' | 'unreachable' | 'needs-address' | 'bad-address' | 'no-answer' | 'not-allowed' | 'no-session' | 'version' | null;
  /** The words of a problem that carries its own (which part of the address is wrong, the two versions); null for the others. */
  note: string | null;
  /** The address is typed (the app, or the test seam): the row has an address box and the page asks nobody at start-up. */
  typed: boolean;
  /** The address as typed (remembered in the preferences by the page, never the code). */
  address: string;
  /** Whom the desktop said it was, in its welcome: the second step of the chip's label. Null until a link has been opened once. */
  host: { name: string; cores: number } | null;
}

export interface DesktopHost {
  readonly state: Store<DesktopView>;
  choose(engine: EngineChoice): void;
  /** The address box changed (0.9.0, typed mode: kept in the state the row reads, and remembered by the page once a Build uses it). */
  typeAddress(text: string): void;
  /**
   * Setup says which bundled demo site it would build (null: none, or not a demo). On a page a host serves, while Desktop is chosen, the page
   * keeps that site's files, so "Continue on this device" can still build if the host dies before the run starts (`HostEnv.keepSite`).
   */
  site(id: string | null): void;
  /** The code box changed (kept in memory only; the box shows it back after a rebuild of Setup). */
  typeCode(text: string): void;
  /** What was typed in the code box (empty for a code that came with the address: that one is never shown). */
  typedCode(): string;
  /**
   * Build was pressed on Setup (`site`: the demo site it would build, as in {@link DesktopHost.site}). On This device it resolves true at once.
   * On Desktop it opens the link first (a wrong code stays on Setup and is said next to the code box; with a typed address, the address is
   * checked and probed first) and resolves true when the run may start. Never throws.
   */
  beforeBuild(site?: string | null): Promise<boolean>;
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

/** The desktop speaks another version of the link (`RemoteVersionError`): `page` and `host` are the two protocol numbers when the error carried them. */
export class VersionMismatch extends Error {
  constructor(
    readonly page: number | null = null,
    readonly host: number | null = null,
  ) {
    super(versionProblem(page, host));
    this.name = 'VersionMismatch';
  }
}

/**
 * The two protocol numbers of a version error, whatever the module calls its fields (the page and the host were built apart: the contract
 * says "a distinct error with the two numbers" and names no fields). A number is taken only when it is a small whole number.
 */
export function versionNumbers(e: unknown): { page: number | null; host: number | null } {
  const o = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>;
  const first = (keys: string[]): number | null => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000) return v;
    }
    return null;
  };
  return {
    page: first(['pageProtocol', 'page', 'clientProtocol', 'client', 'ours', 'expected', 'wanted']),
    host: first(['hostProtocol', 'host', 'serverProtocol', 'server', 'theirs', 'actual', 'got', 'received', 'found']),
  };
}

export interface HostEnv {
  /** The page's own origin: the only one the page ever asks, unless the person types an address (`typed`). */
  origin: string;
  /** `location.protocol`. */
  protocol: string;
  /** The Capacitor app: it never asks at start-up. */
  native: boolean;
  /**
   * 0.9.0: the person types the desktop's address (the Android app; a browser only with the test seam `?desktopaddr=1`). Nothing is asked at
   * start-up and no host is expected at the page's own origin; the row has an address box; Build probes the typed address before the link.
   */
  typed?: boolean;
  /** The address typed last time (typed mode), from the preferences. */
  address?: string;
  /** Remember the address (the page writes it to the preferences; the code is never given to it). */
  saveAddress?(text: string): void;
  /** Typed mode, after `detect` found nothing at `base`: is something listening there that this page may not read (so "not there" and "not allowed" are told apart)? */
  reach?(base: string): Promise<boolean>;
  /** Keep (or, null, let go of) the files of this bundled demo site: see {@link DesktopHost.site}. Only on a page a host serves. */
  keepSite?(site: string | null): void;
  /** `location.hash` as the page was opened. */
  hash: string;
  /** Replace the address's fragment (`history.replaceState`, keeping the history entry and its state). */
  replaceHash(hash: string): void;
  detect: DetectFn;
  /** Opens the link; a refused code rejects with {@link CodeRefused}, a protocol mismatch with {@link VersionMismatch}, any other failure with its own error. */
  connect(o: { base: string; code: string; probe?: HostProbe }): Promise<DesktopLink>;
  /** Tells the screens which run computes on the desktop (null: none). */
  publishRun(run: DesktopRun | null): void;
  /**
   * This device's own engine, made idle when the link opens (null: it could not be made). On a page the desktop host serves, that engine's
   * script comes from the host: made at once, it is here when the host is gone. The run's controller holds it for the fallback.
   */
  standby?(): SimController | null;
  /**
   * Desktop is the engine chosen on a page a host serves (from the start when the link brought a code, else when it is chosen): the moment to load,
   * once and idle, what the page would ask the host for after it has gone: the screens a running view can open, the engine's script and the
   * speed test's, the Setup plan. Called at most once (0.8.0 did it when the link opened; a host that dies BEFORE the link opens, which the Setup
   * path of "Continue on this device" is for, needs it earlier).
   */
  warm?(): void;
}

/** The host's own answer is allowed this long (ms). */
export const DETECT_TIMEOUT_MS = 800;
/** A typed address may be across a network and asleep: the probe is allowed longer than the one question to the page's own origin. */
export const TYPED_DETECT_TIMEOUT_MS = 4000;
/** A detect that never answers is given up on a little after that, so nothing can wait for it. */
const guardOf = (timeoutMs: number): number => timeoutMs + 700;

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

/**
 * What a host says before its code, as the page believes it: the right app, a version of the link (any whole number: a host that speaks another
 * version than this page's {@link HOST_PROTOCOL} is still a host, and the first Build says to update the app or the host instead of "nothing
 * answered") and whether it wants a code.
 */
export function isHostProbe(x: unknown): x is HostProbe {
  if (typeof x !== 'object' || x === null) return false;
  const h = x as Record<string, unknown>;
  return h.app === 'firesim-desktop-host' && Number.isInteger(h.protocol) && (h.protocol as number) >= 1 && typeof h.requiresCode === 'boolean';
}

/** Asks `base` whether it is a desktop host (once); null for any failure, mismatch or silence. */
async function detect(env: HostEnv, base: string, timeoutMs: number): Promise<HostProbe | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      env.detect({ base, timeoutMs }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), guardOf(timeoutMs));
      }),
    ]);
    return isHostProbe(answer) ? answer : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start-up: take the code out of the address, and (when the page can be a desktop host's) ask once. Resolves with the host's
 * object when one answered, null otherwise (then nothing of the desktop engine shows anywhere). A typed page (the app) asks nobody:
 * the object is made at once and the row has an address box.
 */
export async function startDesktopHost(env: HostEnv): Promise<DesktopHost | null> {
  // The code leaves the address bar at once, whatever comes next: it must not stay in the history or a bookmark.
  const linked = codeFromHash(env.hash);
  if (linked !== '') env.replaceHash(hashWithoutCode(env.hash));
  // A typed page has no host of its own to come from: a code in its address is not used (it is only taken out of the bar).
  const code = env.typed ? '' : linked;
  const fromLink = code !== '';
  if (env.typed) return createHost(env, code, fromLink, null);
  if (env.native || !/^https?:$/.test(env.protocol)) return null;
  const probe = await detect(env, env.origin, DETECT_TIMEOUT_MS);
  if (!probe) return null;
  return createHost(env, code, fromLink, probe);
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

function createHost(env: HostEnv, initialCode: string, fromLinkAtStart: boolean, startProbe: HostProbe | null): DesktopHost {
  const typed = env.typed === true;
  let code = initialCode;
  let fromLink = fromLinkAtStart;
  let pending: Entry | null = null;
  let taken: Entry | null = null;
  let run: DesktopRun | null = null;
  let wantedSite: string | null = null;
  let keptSite: string | null = null;
  let prepared = false;
  const state = new Store<DesktopView>({
    engine: code && !typed ? 'desktop' : 'device',
    hasCode: code !== '',
    fromLink,
    busy: false,
    problem: null,
    note: null,
    typed,
    address: typed ? (env.address ?? '') : '',
    host: null,
  });

  /**
   * While Desktop is the engine chosen on a page a host serves (a typed page, the app's, has nothing to keep: its files are its own), the page
   * prepares for the host's going away: it loads what it would then ask the host for (`env.warm`, once) and keeps the chosen demo site's files.
   * The site is not let go when This device is chosen (the tap on "Continue on this device" chooses it and builds in the next breath: it needs
   * the files then), only when a run has started on the desktop (`take`: the scenario is built, nothing of the site is needed again) or
   * another site is wanted.
   */
  const prepare = (): void => {
    if (typed || state.get().engine !== 'desktop') return;
    if (!prepared) {
      prepared = true;
      try {
        env.warm?.();
      } catch {
        /* warming is a help, never a reason to fail */
      }
    }
    if (wantedSite !== keptSite) keep(wantedSite);
  };
  const keep = (site: string | null): void => {
    keptSite = site;
    try {
      env.keepSite?.(site);
    } catch {
      /* keeping a site is a help, never a reason to fail */
    }
  };

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

  /** Is anything there that the page may not read? Never throws. */
  const reaches = async (base: string): Promise<boolean> => {
    try {
      return (await env.reach?.(base)) === true;
    } catch {
      return false;
    }
  };

  prepare(); // Desktop chosen from the start (the link brought a code): prepare now

  return {
    state,
    choose: (engine) => {
      state.set({ engine, problem: null, note: null });
      prepare();
    },
    typeAddress: (text) => state.set({ address: text, problem: null, note: null }),
    site: (id) => {
      wantedSite = id;
      prepare();
    },
    typeCode(text) {
      code = normaliseCode(text);
      fromLink = false;
      state.set({ hasCode: code !== '', fromLink: false, problem: null, note: null });
    },
    typedCode: () => (fromLink ? '' : code),
    async beforeBuild(site) {
      if (site !== undefined) {
        wantedSite = site;
        prepare();
      }
      const s = state.get();
      if (s.engine !== 'desktop') {
        close(pending);
        pending = null;
        return true;
      }
      if (s.busy) return false;
      let base = env.origin;
      if (typed) {
        const a = parseDesktopAddress(s.address);
        if (!a.ok) {
          state.set(a.problem === 'empty' ? { problem: 'needs-address', note: null } : { problem: 'bad-address', note: ADDRESS_PROBLEM[a.problem] });
          return false;
        }
        base = a.base;
        env.saveAddress?.(s.address.trim());
      }
      if (!code) {
        state.set({ problem: 'needs-code', note: null });
        return false;
      }
      close(pending);
      pending = null;
      state.set({ busy: true, problem: null, note: null });
      let probed = false;
      try {
        // What the desktop said before the code: the start-up question of a page it serves, or the probe of a typed address.
        let probe = startProbe;
        if (typed) {
          // Before the code goes anywhere, is there a desktop at that address? "Nothing there" and "there, but not for this page" are different words.
          probe = await detect(env, base, TYPED_DETECT_TIMEOUT_MS);
          if (!probe) {
            state.set({ problem: (await reaches(base)) ? 'not-allowed' : 'no-answer' });
            return false;
          }
          probed = true;
        }
        // The probe goes with the connection: a host of another version of the link is refused at once, with no socket opened, and the code stays here.
        const link = await env.connect({ base, code, ...(probe ? { probe } : {}) });
        pending = open(link);
        // The desktop has welcomed the page: it has told who it is, and the chip can say it.
        state.set({ host: { name: cleanName(link.info.name), cores: link.info.cores } });
        // The link is open while the host is surely up: this device's own engine is made now (its script comes from the host, or from the copy kept since Desktop was chosen).
        try {
          pending.standby = env.standby?.() ?? null;
          if (pending.standby) pending.watch = watchStandby(pending.standby);
        } catch {
          pending.standby = null;
        }
        return true;
      } catch (e) {
        if (e instanceof CodeRefused && e.reason === 'rate-limited') {
          // The code may be the right one: it is kept, so the same button works again in a minute.
          state.set({ problem: 'rate-limited' });
        } else if (e instanceof CodeRefused) {
          code = '';
          fromLink = false;
          state.set({ problem: 'refused', hasCode: false, fromLink: false });
        } else if (e instanceof VersionMismatch) {
          state.set({ problem: 'version', note: e.message });
        } else if (e instanceof Error && /no free session/i.test(e.message)) {
          state.set({ problem: 'no-session' });
        } else state.set({ problem: typed && probed ? 'not-allowed' : 'unreachable' });
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
      if (keptSite !== null) keep(null); // the model is built: a run that has started needs none of the site's files again
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
      state.set({ engine: 'device', problem: null, note: null });
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
      state.set({ problem: null, note: null }); // what was said on the last Setup is not said again on the next
    },
  };
}
