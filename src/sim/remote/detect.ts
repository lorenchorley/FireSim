/**
 * Is this page served by a FireSim desktop host (desktop/, 0.8.0 workstream J)? One same-origin GET of
 * `/__firesim/host` and a type check of the answer; nothing else. This is the only file of src/sim/remote in the entry
 * chunk (the page budget for it is a few hundred bytes), so it imports nothing: the rest loads with `await import('../sim/remote')`.
 */

/** What `GET /__firesim/host` says (and nothing more: no code, no paths, no environment). */
export interface RemoteHostInfo {
  app: 'firesim-desktop-host';
  protocol: 1;
  name: string;
  cores: number;
  node: string;
  sessions: number;
  maxSessions: number;
}

/** The host's info, or null on any failure or mismatch (not a FireSim host, another protocol, no answer within `timeoutMs`, default 800). */
export async function detectHost(o: { base?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<RemoteHostInfo | null> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ask = (async (): Promise<RemoteHostInfo | null> => {
    const res = await (o.fetchFn ?? fetch)(`${(o.base ?? location.origin).replace(/\/$/, '')}/__firesim/host`, { cache: 'no-store', redirect: 'error', signal: ctl.signal });
    const v = res.ok ? ((await res.json()) as RemoteHostInfo | null) : null;
    const num = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= 0;
    return v && v.app === 'firesim-desktop-host' && v.protocol === 1 && typeof v.name == 'string' && typeof v.node == 'string' && num(v.cores) && num(v.sessions) && num(v.maxSessions) ? v : null;
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
