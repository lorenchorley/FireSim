/**
 * The page's controller for a simulation that runs on a FireSim desktop host (0.8.0 workstream J, contract section 3.4):
 * the same protocol as the Web Worker (`ToWorker` / `FromWorker`), one codec frame per message over a WebSocket, in the
 * place of `SimClient`. One engine session per connection: the host runs a worker thread of its own for it, and when the
 * link goes the session is gone with its worker (no reconnect in this release).
 *
 * Errors are events, never exceptions on the page: a closed or failed link after `connect()` emits 'error' once with a
 * plain sentence and disposes the controller. Only `connect()` rejects (a wrong code: {@link RemoteAuthError}).
 */
import { ProtocolController, withoutContext } from '../client';
import type { FromWorker, ToWorker } from '../protocol';
import { decodeMessage, encodeMessage, type WireControl } from './codec';

/** The host did not accept the code: `reason` says whether it was wrong or the address has been refused for a minute. */
export class RemoteAuthError extends Error {
  constructor(
    message: string,
    readonly reason: 'wrong-code' | 'rate-limited' = 'wrong-code',
  ) {
    super(message);
    this.name = 'RemoteAuthError';
  }
}

/** The part of the WebSocket interface the controller uses (the browser's, Node's global one, or `ws`). */
export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export const PROTOCOL = 1;
const OPEN = 1;
const WELCOME_TIMEOUT_MS = 10_000;
const PING_EVERY_MS = 5_000;
/** The link's close codes of the host (desktop/README.md). */
const CLOSE_WRONG_CODE = 4401;
const CLOSE_RATE_LIMITED = 4429;
const CLOSE_NO_SESSION = 4503;
const CLOSE_HOST_FAILED = 1011;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class RemoteSimController extends ProtocolController {
  private socket: SocketLike | null = null;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private rtt: number | null = null;
  private erroredOnce = false;
  private sessionId: string | null = null;

  /** The host's id of this session (after `connect()`). */
  get session(): string | null {
    return this.sessionId;
  }

  /** The last measured round trip of the link (ms), or null before the first answer. */
  rttMs(): number | null {
    return this.rtt;
  }

  /** Open the socket, say hello with the pairing `code`, wait for the welcome (10 s). Rejects with {@link RemoteAuthError} when the code is refused. */
  connect(o: { url: string; code: string; WebSocketCtor?: new (url: string) => SocketLike }): Promise<void> {
    const Ctor = o.WebSocketCtor ?? (typeof WebSocket !== 'undefined' ? (WebSocket as unknown as new (url: string) => SocketLike) : undefined);
    if (!Ctor) return Promise.reject(new Error('This browser cannot open a WebSocket.'));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: SocketLike;
      try {
        ws = new Ctor(o.url);
      } catch {
        reject(new Error('Could not reach the desktop.'));
        return;
      }
      this.socket = ws;
      ws.binaryType = 'arraybuffer';
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const refuse = (e: Error): void => {
        settle(() => reject(e));
        this.disposeSocket(1000);
      };
      const timer = setTimeout(() => refuse(new Error('The desktop did not answer.')), WELCOME_TIMEOUT_MS);
      ws.onopen = (): void => ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, code: o.code }));
      ws.onerror = (): void => {
        if (!settled) refuse(new Error('Could not reach the desktop.'));
      };
      ws.onclose = (ev): void => {
        if (!settled) {
          this.socket = null;
          settle(() => reject(refusal(ev.code)));
        } else this.linkClosed(ev.code);
      };
      ws.onmessage = (ev): void => {
        if (!settled) {
          const welcome = typeof ev.data === 'string' ? parseWelcome(ev.data) : null;
          if (!welcome) return refuse(new Error('The desktop sent something unexpected.'));
          this.sessionId = welcome;
          settle(resolve);
          this.startPing();
          return;
        }
        this.onFrame(ev.data);
      };
    });
  }

  protected send(msg: ToWorker): void {
    const ws = this.socket;
    if (this.disposed || !ws || ws.readyState !== OPEN) return;
    try {
      // The places context is display only and large: it stays on this device, as SimClient leaves it.
      ws.send(encodeMessage(msg.type === 'init' ? { ...msg, scenario: withoutContext(msg.scenario) } : msg));
    } catch {
      this.fail('The desktop connection could not send a message.');
    }
  }

  private onFrame(data: unknown): void {
    if (this.disposed || !(data instanceof ArrayBuffer)) return;
    try {
      const msg = decodeMessage(new Uint8Array(data));
      if (msg.type === 'pong') this.rtt = Math.max(0, now() - msg.t);
      else if (msg.type !== 'ping') this.receive(msg as FromWorker); // the host sends nothing but its own messages and pongs
    } catch {
      this.fail('The desktop sent a message this page could not read.');
    }
  }

  private startPing(): void {
    const ping = (): void => {
      const ws = this.socket;
      if (!this.disposed && ws && ws.readyState === OPEN) ws.send(encodeMessage({ type: 'ping', t: now() } satisfies WireControl));
    };
    ping();
    this.pingTimer = setInterval(ping, PING_EVERY_MS);
    (this.pingTimer as { unref?: () => void }).unref?.();
  }

  /** The socket closed after the welcome and not by `dispose()`. */
  private linkClosed(code: number): void {
    this.socket = null;
    // The host reports why a session failed in an 'error' message just before it closes with 1011: that is the one error.
    if (code === CLOSE_HOST_FAILED && this.erroredOnce) this.dispose();
    else this.fail('The desktop connection closed.');
  }

  /** Say so once (waiting `init` and `explain` calls reject with the same sentence), then let go of the socket. */
  private fail(message: string): void {
    if (this.disposed) return;
    this.receive({ type: 'error', message });
    this.dispose();
  }

  protected override receive(msg: FromWorker): void {
    if (msg.type === 'error') this.erroredOnce = true;
    super.receive(msg);
  }

  private disposeSocket(code: number): void {
    clearInterval(this.pingTimer);
    const ws = this.socket;
    this.socket = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close(code);
    } catch {
      /* already closed */
    }
  }

  override dispose(): void {
    this.disposeSocket(1000);
    super.dispose();
  }
}

function parseWelcome(text: string): string | null {
  try {
    const v = JSON.parse(text) as { type?: unknown; protocol?: unknown; session?: unknown };
    return v.type === 'welcome' && v.protocol === PROTOCOL && typeof v.session === 'string' ? v.session : null;
  } catch {
    return null;
  }
}

function refusal(code: number): Error {
  if (code === CLOSE_WRONG_CODE) return new RemoteAuthError('That code was not right.', 'wrong-code');
  if (code === CLOSE_RATE_LIMITED) return new RemoteAuthError('Too many wrong codes from this device. Try again in a minute.', 'rate-limited');
  if (code === CLOSE_NO_SESSION) return new Error('The desktop has no free session.');
  return new Error('Could not reach the desktop.');
}
