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
  close(): void;
}

export type DetectFn = (opts?: { base?: string; timeoutMs?: number }) => Promise<HostInfo | null>;
export type ConnectFn = (o: { base: string; code: string }) => Promise<DesktopLink>;

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

/** The run that computes on the desktop, as the screens read it (the line on the map, the statistics, the closed-link chip). */
export interface DesktopRun {
  name: string;
  cores: number;
  node: string;
  /** The round trip to the desktop in ms, or null before the first ping came back. */
  rttMs(): number | null;
  /** The link is gone: the run's engine is no longer there. */
  closed: boolean;
}
