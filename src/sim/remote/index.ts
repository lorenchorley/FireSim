/**
 * The lazy entry of the desktop connection (0.8.0 workstream J): the page loads it with `await import('../sim/remote')`
 * only when the user starts a run on the desktop engine. `detect.ts` (the check that a host is there) is the only part in
 * the entry chunk.
 */
import { detectHost, hostUrl, type RemoteHostInfo } from './detect';
import { RemoteAuthError, RemoteSimController, type SocketLike } from './RemoteSimController';
import type { SimController } from '../protocol';

export { RemoteAuthError };
export type { RemoteHostInfo };

export interface RemoteConnection {
  controller: SimController;
  info: RemoteHostInfo;
  /** The last measured round trip of the link (ms), null before the first answer. */
  rttMs(): number | null;
  close(): void;
}

/** `http://host:port/` to `ws://host:port/__firesim/engine` (and `https:` to `wss:`). */
function engineUrl(base: string): string {
  const u = new URL(hostUrl(base, '__firesim/engine'));
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.href;
}

/**
 * Connect to the host at `base` with the pairing `code`. Rejects with {@link RemoteAuthError} when the code is refused and
 * with a plain Error (a sentence) when there is no host, no free session or no answer. After that every failure is an
 * 'error' event of the controller.
 */
export async function connectRemote(o: { base: string; code: string; WebSocketCtor?: typeof WebSocket }): Promise<RemoteConnection> {
  const info = await detectHost({ base: o.base, timeoutMs: 5000 });
  if (!info) throw new Error('The desktop did not answer.');
  const controller = new RemoteSimController();
  await controller.connect({ url: engineUrl(o.base), code: o.code, ...(o.WebSocketCtor ? { WebSocketCtor: o.WebSocketCtor as unknown as new (url: string) => SocketLike } : {}) });
  return { controller, info, rttMs: () => controller.rttMs(), close: () => controller.dispose() };
}
