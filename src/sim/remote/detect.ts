/**
 * Is there a FireSim desktop host here (desktop/, 0.8.0 workstream J, protocol 2 since 0.9.0)? One GET of `/__firesim/host` and
 * a type check of the answer; nothing else. This file imports nothing (it loads with the page's desktop chunk), so the rest of
 * src/sim/remote loads later, with `await import('../sim/remote')`.
 *
 * Before the pairing code the host says as little as it can: that it is a FireSim host, the version of its link and that it wants a
 * code. Its name, cores and Node version come in the welcome, after the code (`RemoteHostInfo`).
 */

/** What `GET /__firesim/host` says, and nothing more: no name, no cores, no code, no paths, no environment. */
export interface RemoteHostProbe {
  app: 'firesim-desktop-host';
  /** The version of the link the host speaks. This page speaks 2: `connectRemote` refuses another with a `RemoteVersionError`. */
  protocol: number;
  /** Always true: every host asks for its pairing code. */
  requiresCode: boolean;
}

/** What a host says of itself in its welcome, once the code was right (`RemoteConnection.info`). */
export interface RemoteHostInfo {
  app: 'firesim-desktop-host';
  protocol: 2;
  name: string;
  cores: number;
  node: string;
  /** Sessions running on the host, this one included. */
  sessions: number;
  maxSessions: number;
}

/**
 * The host's probe, or null on any failure or mismatch (not a FireSim host, no answer within `timeoutMs`, default 800, an answer
 * that is not the three fields). A host of another protocol number is still a host: the probe says which, and it is `connectRemote`
 * that refuses to connect to it (`RemoteVersionError`), so the page can say "update the app or the host" in place of "no desktop".
 * Only the three fields are kept: whatever else an answer carries is dropped.
 */
export async function detectHost(o: { base?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<RemoteHostProbe | null> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ask = (async (): Promise<RemoteHostProbe | null> => {
    const res = await (o.fetchFn ?? fetch)(`${(o.base ?? location.origin).replace(/\/$/, '')}/__firesim/host`, { cache: 'no-store', redirect: 'error', signal: ctl.signal });
    const v = res.ok ? ((await res.json()) as Record<string, unknown> | null) : null;
    return v && v.app === 'firesim-desktop-host' && Number.isInteger(v.protocol) && (v.protocol as number) >= 1 && typeof v.requiresCode === 'boolean' ? { app: v.app, protocol: v.protocol as number, requiresCode: v.requiresCode } : null;
  })().catch(() => null); // no fetch, no page, a refused connection, not JSON: all the same answer
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve(null);
    }, o.timeoutMs ?? 800);
  });
  try {
    return await Promise.race([ask, late]);
  } finally {
    clearTimeout(timer);
  }
}
