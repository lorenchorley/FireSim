/**
 * What the page relies on of the desktop host's modules (workstream J, docs/plans/0.8.0/J-CONTRACT-desktop-host.md section 3.5).
 * The modules themselves (src/sim/remote/*) are lane J1's and are only ever reached through a dynamic import, so the few names
 * the page uses are declared here, and a type-only file costs the entry chunk nothing.
 *
 * The page relies on exactly these names:
 *   detect.ts  `detectHost(opts?: { base?: string; timeoutMs?: number }): Promise<RemoteHostInfo | null>`
 *   index.ts   `connectRemote(o: { base: string; code: string }): Promise<RemoteConnection>` and `class RemoteAuthError extends Error`
 *   `RemoteHostInfo`: app, protocol, name, cores, node, sessions, maxSessions
 *   `RemoteConnection`: controller (a SimController), info (RemoteHostInfo), rttMs(), close()
 */
import type { SimController } from '../sim/protocol';

/** The host's answer (`RemoteHostInfo`). */
export interface HostInfo {
  app: 'firesim-desktop-host';
  protocol: 1;
  name: string;
  cores: number;
  node: string;
  sessions: number;
  maxSessions: number;
}

/** An open engine session on the desktop (`RemoteConnection`). */
export interface DesktopLink {
  controller: SimController;
  info: HostInfo;
  /** The round trip to the desktop in ms, or null before the first ping came back. */
  rttMs(): number | null;
  /** The page closes the link (this does not call `onClosed`). */
  close(): void;
  /**
   * `cb(reason)` is called exactly once when the link ends for any reason but `close()`: THE signal that the link is closed (the reason is a
   * plain sentence). Returns the function that stops listening. An engine's own error message is not this: it stays a controller `error` event.
   * Optional: an older module has none, and then an `error` event of the controller is taken for the link's end.
   */
  onClosed?(cb: (reason: string) => void): () => void;
}

export type DetectFn = (opts?: { base?: string; timeoutMs?: number }) => Promise<HostInfo | null>;
/** `info` is the answer of the check made at start-up: the connection does not ask the host again when it has it. */
export type ConnectFn = (o: { base: string; code: string; info?: HostInfo }) => Promise<DesktopLink>;

/** The lazy remote module as the page checks it after loading (src/sim/remote/index.ts). */
export interface RemoteModule {
  connectRemote: ConnectFn;
  RemoteAuthError?: abstract new (...args: never[]) => Error;
}

/** `window.__firesimRemote`, honoured only with `?debug=1`: the two functions, replaced (the e2e specs put a stub controller behind it). */
export interface RemoteSeam {
  detectHost?: DetectFn;
  connectRemote?: ConnectFn;
}

/**
 * The run that computes on the desktop, as the screens read it (the label on the map, the statistics, the closed-link chip). The
 * two sentences come with it so that the first screen, which only reads this, carries none of the desktop's words.
 */
export interface DesktopRun {
  /** The label on the map ("Running on the desktop"). */
  label: string;
  /** The help line of the Insights tab's error note, for a run whose desktop went away (absent once the run was started again on this device). */
  help?: string;
  name: string;
  cores: number;
  node: string;
  /** The round trip to the desktop in ms, or null before the first ping came back. */
  rttMs(): number | null;
  /** The link is gone: the run's engine is no longer there. */
  closed: boolean;
  /** The link's own sentence for it (what `onClosed` said). */
  closedReason?: string;
  /** The person chose "Continue on this device": the run was started again on this device's own engine. */
  restarted?: boolean;
}
