/**
 * Helpers of the desktop host's tests: a client on the `ws` library (so a test can set the Origin and the local address,
 * read the close code and see the status of a refused handshake) and a small engine to stand in for the worker thread.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { connect as tcpConnect, type Socket } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { buildDesktop } from './build.mjs';
import type { Engine, EngineEvents, EngineFactory } from './engine';

/**
 * The built host (main.mjs and engineWorker.mjs), in a folder of its own inside the repository so that `ws` resolves from it
 * (the way desktop/.build does for `npm run desktop`). `remove()` deletes it.
 */
export async function buildForTests(): Promise<{ dir: string; remove(): void }> {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dir = mkdtempSync(join(here, '.build-test-'));
  await buildDesktop({ root: join(here, '..'), outDir: dir, logLevel: 'silent', extra: { engine: 'desktop/engine.ts' } });
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface TestClient {
  ws: WebSocket;
  /** Everything received, in order: text frames as strings, binary frames as bytes. */
  received: (string | Uint8Array)[];
  /** Resolves when the connection has closed. */
  closed: Promise<{ code: number; reason: string }>;
}

export function waitFor(pred: () => boolean, ms = 5000, what = 'a condition'): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = (): void => {
      if (pred()) resolve();
      else if (Date.now() - t0 > ms) reject(new Error(`timed out waiting for ${what}`));
      else setTimeout(check, 5);
    };
    check();
  });
}

export interface OpenOptions {
  origin?: string;
  path?: string;
  localAddress?: string;
  autoPong?: boolean;
  /** The Host header to send instead of the address's own. */
  host?: string;
}

/** Open a connection and wait for the handshake; rejects with the HTTP status when the handshake is refused (`error.status`). */
export function openClient(port: number, o: OpenOptions = {}): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${o.path ?? '/__firesim/engine'}`, {
      ...(o.origin !== undefined ? { origin: o.origin } : {}),
      ...(o.localAddress ? { localAddress: o.localAddress } : {}),
      ...(o.autoPong === false ? { autoPong: false } : {}),
      ...(o.host !== undefined ? { headers: { Host: o.host } } : {}),
    });
    const received: (string | Uint8Array)[] = [];
    const closed = new Promise<{ code: number; reason: string }>((res) => ws.on('close', (code, reason) => res({ code, reason: reason.toString() })));
    ws.on('message', (data: Buffer, isBinary: boolean) => received.push(isBinary ? new Uint8Array(data) : data.toString('utf8')));
    ws.on('unexpected-response', (_req, res) => {
      res.resume();
      reject(Object.assign(new Error(`refused with ${res.statusCode}`), { status: res.statusCode }));
    });
    ws.on('error', () => undefined);
    ws.once('open', () => resolve({ ws, received, closed }));
    ws.once('error', (e) => reject(e));
  });
}

export const hello = (c: TestClient, code: string, protocol = 1): void => c.ws.send(JSON.stringify({ type: 'hello', protocol, code }));

/** The text frame the host answered with (a welcome), or null when it closed instead. */
export async function welcomeOf(c: TestClient): Promise<{ type: string; session: string; protocol: number } | null> {
  const first = await Promise.race([waitFor(() => c.received.length > 0, 5000, 'a frame').then(() => 'frame' as const), c.closed.then(() => 'closed' as const)]);
  const m = first === 'frame' ? c.received[0] : undefined;
  return typeof m === 'string' ? (JSON.parse(m) as { type: string; session: string; protocol: number }) : null;
}

export interface FakeEngine extends Engine {
  events: EngineEvents;
  /** Frames the host handed to it, in order. */
  frames: Uint8Array[];
  holds: boolean[];
  terminated: number;
}

/** Engines that record what they are given and run nothing. `terminate()` ends them the way a worker's exit does. */
export function fakeEngines(): { factory: EngineFactory; made: FakeEngine[] } {
  const made: FakeEngine[] = [];
  const factory: EngineFactory = (events) => {
    const e: FakeEngine = {
      events,
      frames: [],
      holds: [],
      terminated: 0,
      receive: (bytes) => void e.frames.push(bytes),
      hold: (on) => void e.holds.push(on),
      terminate: async () => {
        e.terminated++;
        events.exited();
      },
    };
    made.push(e);
    return e;
  };
  return { factory, made };
}

/**
 * A WebSocket upgrade written by hand on a bare socket, so that nothing answers the host's closing frame and nothing reads:
 * the silent connection of a slow-loris. Resolves with the HTTP status of the answer; `socket` stays open until the test destroys it.
 */
export function rawUpgrade(port: number, o: { localAddress?: string; host?: string } = {}): Promise<{ status: number; socket: Socket; closed: () => boolean }> {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect({ host: '127.0.0.1', port, ...(o.localAddress ? { localAddress: o.localAddress } : {}) });
    let buf = '';
    let isClosed = false;
    socket.on('close', () => (isClosed = true));
    socket.on('error', (e) => (isClosed ? undefined : reject(e)));
    socket.on('connect', () =>
      socket.write(`GET /__firesim/engine HTTP/1.1\r\nHost: ${o.host ?? `127.0.0.1:${port}`}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`),
    );
    const onData = (d: Buffer): void => {
      buf += d.toString('latin1');
      if (!buf.includes('\r\n\r\n')) return;
      socket.off('data', onData); // what comes next is thrown away and never answered: the host's close frame included
      resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(buf)![1]), socket, closed: () => isClosed });
    };
    socket.on('data', onData);
  });
}
