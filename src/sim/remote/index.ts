/**
 * The lazy entry of the desktop connection (0.8.0 workstream J): the page loads it with `await import('../sim/remote')`
 * only when the user starts a run on the desktop engine. `detect.ts` (the check that a host is there) is the only part in
 * the entry chunk.
 */
import { detectHost, type RemoteHostInfo } from './detect';
import { RemoteAuthError, RemoteSimController, type SocketLike } from './RemoteSimController';
import type { SimController } from '../protocol';

export { RemoteAuthError };
export type { RemoteHostInfo };

export interface RemoteConnection {
  controller: SimController;
  info: RemoteHostInfo;
  /** The last measured round trip of the link (ms), null before the first answer. */
  rttMs(): number | null;
  /**
   * `cb(reason)` once when the link ends for any reason of its own: the socket closed or failed (any code), or the host ended the
   * session (1011, 1001, 4xxx). `reason` is a plain sentence. `close()` is not such a reason and calls nothing. An engine error that
   * the host forwards as an 'error' message stays a controller 'error' event and is not an end of the link, unless the host then
   * closes it. A link that has already ended calls `cb` at once. Returns the way to take `cb` off again.
   */
  onClosed(cb: (reason: string) => void): () => void;
  /** Let go of the link (the page's own doing: it does not call `onClosed`). */
  close(): void;
}

/** `http://host:port/` to `ws://host:port/__firesim/engine` (and `https:` to `wss:`). */
function engineUrl(base: string): string {
  const u = new URL(`${base.replace(/\/$/, '')}/__firesim/engine`);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.href;
}

/**
 * Connect to the host at `base` with the pairing `code`. `info` is what `detectHost` already said about it: given, no request is
 * made for it (the page asks `/__firesim/host` once); absent, it is asked here. Rejects with {@link RemoteAuthError} when the code
 * is refused and with a plain Error (a sentence) when there is no host, no free session or no answer. After that every failure is
 * an 'error' event of the controller and the end of the link is told to `onClosed`.
 */
export async function connectRemote(o: { base: string; code: string; info?: RemoteHostInfo; WebSocketCtor?: typeof WebSocket }): Promise<RemoteConnection> {
  const info = o.info ?? (await detectHost({ base: o.base, timeoutMs: 5000 }));
  if (!info) throw new Error('The desktop did not answer.');
  const controller = new RemoteSimController();
  await controller.connect({ url: engineUrl(o.base), code: o.code, ...(o.WebSocketCtor ? { WebSocketCtor: o.WebSocketCtor as unknown as new (url: string) => SocketLike } : {}) });
  return { controller, info, rttMs: () => controller.rttMs(), onClosed: (cb) => controller.onClosed(cb), close: () => controller.dispose() };
}
