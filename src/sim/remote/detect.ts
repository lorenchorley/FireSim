/**
 * Is this page served by a FireSim desktop host (desktop/, 0.8.0 workstream J)? One same-origin GET of
 * `/__firesim/host` and a type check of the answer; nothing else. This is the only file of src/sim/remote in the entry
 * chunk, so it imports nothing (no codec, no controller): the rest loads with `await import('../sim/remote')`.
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

/** The URL of a path of the host under `base` (an origin, or a base with a path), keeping the base's path. */
export function hostUrl(base: string, path: string): string {
  return new URL(path, base.endsWith('/') ? base : `${base}/`).href;
}

function isInfo(v: unknown): v is RemoteHostInfo {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const count = (x: unknown): boolean => typeof x === 'number' && Number.isInteger(x) && x >= 0;
  return o.app === 'firesim-desktop-host' && o.protocol === 1 && typeof o.name === 'string' && count(o.cores) && typeof o.node === 'string' && count(o.sessions) && count(o.maxSessions);
}

/** The host's info, or null on any failure or mismatch (not a FireSim host, another protocol, no answer within `timeoutMs`, default 800). */
export async function detectHost(opts: { base?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<RemoteHostInfo | null> {
  const base = opts.base ?? (typeof location !== 'undefined' ? location.origin : undefined);
  const fetchFn = opts.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!base || !fetchFn) return null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctl?.abort();
      resolve(null);
    }, opts.timeoutMs ?? 800);
  });
  const ask = (async (): Promise<RemoteHostInfo | null> => {
    const res = await fetchFn(hostUrl(base, '__firesim/host'), { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: ctl?.signal });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 2048) return null;
    const v: unknown = JSON.parse(text);
    return isInfo(v) ? v : null;
  })();
  try {
    return await Promise.race([ask, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    ask.catch(() => undefined); // an answer that comes after the timeout must not be an unhandled rejection
  }
}
