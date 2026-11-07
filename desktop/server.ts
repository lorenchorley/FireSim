/**
 * The desktop host (contract 0.8.0 J, 3.2): serves the built app (`dist/`), tells who it is at `/__firesim/host`, and runs
 * one engine session per WebSocket at `/__firesim/engine`.
 *
 * A connection is a stranger until it sends `{"type":"hello","protocol":1,"code":"..."}` as its first frame, as TEXT, within
 * the hello time. The host answers `{"type":"welcome",...}` and from then on every frame is BINARY and carries one codec
 * message, or closes with 4400 (no good hello in time), 4401 (wrong code), 4429 (this address has sent too many wrong
 * codes) or 4503 (no free session). Before the welcome a frame may be a few KB at most; after it, as large as a scenario.
 *
 * Nothing here logs or returns the code, a scenario or an environment variable.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { availableParallelism, cpus } from 'node:os';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { decodeMessage, encodeMessage } from '../src/sim/remote/codec';
import type { Engine, EngineFactory } from './engine';
import { addressKey, codesMatch, normaliseCode, originAllowed, RateLimiter, type RateLimitOptions } from './security';
import { serveStatic } from './staticFiles';

export const PROTOCOL = 1;
export const ENGINE_PATH = '/__firesim/engine';
export const HOST_PATH = '/__firesim/host';
/** Close codes of the link (desktop/README.md). */
export const CLOSE = { normal: 1000, away: 1001, failed: 1011, badHello: 4400, wrongCode: 4401, rateLimited: 4429, noSession: 4503 } as const;

export interface HostOptions {
  /** The built app (the folder with index.html). */
  distDir: string;
  /** 0 picks a free port. */
  port: number;
  /** The address to listen on: 127.0.0.1 (this computer) or 0.0.0.0 (`--lan`). */
  bind: string;
  /** The pairing code (8 to 32 letters and digits, in capitals). */
  code: string;
  name: string;
  maxSessions: number;
  /** One engine per session: `workerEngines(file)` in the real host. */
  engines: EngineFactory;
  log?: (line: string) => void;
  /** How long a connection may be silent before its hello (ms, default 5000). */
  helloTimeoutMs?: number;
  /** A ping to every session this often (ms, default 20 000), and a session silent for `deadAfterMs` (default 60 000) is closed. */
  pingIntervalMs?: number;
  deadAfterMs?: number;
  /** The largest frame after the welcome (bytes, default 256 MiB) and before it (default 4096). */
  maxFrameBytes?: number;
  maxHelloBytes?: number;
  /** Connections that have not said hello yet (default 16). */
  maxPending?: number;
  /** The link is "behind" above this many unsent bytes (default 16 MiB) and caught up below `lowWaterBytes` (default 4 MiB). */
  highWaterBytes?: number;
  lowWaterBytes?: number;
  rateLimit?: RateLimitOptions;
  now?: () => number;
}

export interface HostHandle {
  readonly port: number;
  /** Sessions running now (and those being ended). */
  readonly sessions: number;
  /** Engines started and not yet ended: a leak shows as a number that stays above `sessions`. */
  readonly liveEngines: number;
  close(): Promise<void>;
}

interface Session {
  id: string;
  ws: WebSocket;
  address: string;
  engine: Engine;
  lastSeen: number;
  held: boolean;
  closing: boolean;
}

type Data = ArrayBuffer | Buffer | Buffer[];
interface Refusal {
  code: number;
  reason: string;
  log: string;
}

const cores = (): number => {
  try {
    return availableParallelism();
  } catch {
    return Math.max(1, cpus().length);
  }
};

/** The raw HTTP answer of a handshake that is refused (the socket is not a WebSocket yet, so there is no close code). */
function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`);
}

/** Only these close codes may be sent; anything else (1005, 1006: "none", "abnormal") is a plain close. */
const sendable = (code: number): number => (code === 1000 || code === 1001 || code === 1011 || (code >= 4000 && code <= 4999) ? code : CLOSE.normal);

export async function startHost(o: HostOptions): Promise<HostHandle> {
  const log = o.log ?? ((line: string) => console.log(`${new Date().toISOString()} ${line}`));
  const now = o.now ?? Date.now;
  const helloTimeoutMs = o.helloTimeoutMs ?? 5000;
  const pingIntervalMs = o.pingIntervalMs ?? 20_000;
  const deadAfterMs = o.deadAfterMs ?? 60_000;
  const maxFrameBytes = o.maxFrameBytes ?? 256 * 1024 * 1024;
  const maxHelloBytes = o.maxHelloBytes ?? 4096;
  const maxPending = o.maxPending ?? 16;
  const highWater = o.highWaterBytes ?? 16 * 1024 * 1024;
  const lowWater = o.lowWaterBytes ?? 4 * 1024 * 1024;
  const limiter = new RateLimiter(o.rateLimit);
  const code = normaliseCode(o.code);
  if (!code) throw new Error('The pairing code must be 8 to 32 letters and digits.');

  const sessions = new Map<string, Session>();
  const pending = new Set<WebSocket>();
  let liveEngines = 0;
  let closed = false;
  let ended: Promise<unknown> = Promise.resolve();

  // The frame limit before the welcome is the server's; after it, the receiver's limit is raised for that connection only.
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxHelloBytes, perMessageDeflate: false });

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if ((req.url ?? '/').split('?')[0] === HOST_PATH) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      // Exactly these fields and nothing else: no code, no paths, no environment.
      const body = JSON.stringify({ app: 'firesim-desktop-host', protocol: PROTOCOL, name: o.name, cores: cores(), node: process.versions.node, sessions: sessions.size, maxSessions: o.maxSessions });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(body) });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    serveStatic(o.distDir, req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end();
    });
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => undefined);
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://host').pathname;
    } catch {
      return refuse(socket, 400, 'Bad Request');
    }
    if (pathname !== ENGINE_PATH) return refuse(socket, 404, 'Not Found');
    const address = addressKey(req.socket.remoteAddress);
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      log(`refused ${address}: a page from another origin`);
      return refuse(socket, 403, 'Forbidden');
    }
    if (closed || pending.size >= maxPending) return refuse(socket, 503, 'Service Unavailable');
    wss.handleUpgrade(req, socket, head, (ws) => meet(ws, address));
  });

  /** A connection that has not said hello: it has `helloTimeoutMs` to send a good one. */
  function meet(ws: WebSocket, address: string): void {
    pending.add(ws);
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      log(`refused ${address}: no hello in time`);
      ws.close(CLOSE.badHello, 'no hello');
    }, helloTimeoutMs);
    const forget = (): void => {
      clearTimeout(timer);
      pending.delete(ws);
    };
    const gone = (): void => {
      forget();
      ws.terminate();
    };
    ws.once('close', forget);
    ws.once('error', gone);
    ws.once('message', (data: Data, isBinary: boolean) => {
      ws.off('close', forget);
      ws.off('error', gone);
      forget();
      const refusal = checkHello(data, isBinary, address);
      if (refusal) {
        log(`refused ${address}: ${refusal.log}`);
        ws.on('error', () => undefined);
        ws.close(refusal.code, refusal.reason);
      } else start(ws, address);
    });
  }

  function checkHello(data: Data, isBinary: boolean, address: string): Refusal | null {
    const t = now();
    if (limiter.isBlocked(address, t)) return { code: CLOSE.rateLimited, reason: 'too many wrong codes', log: 'too many wrong codes, refused for a while' };
    let hello: { type?: unknown; protocol?: unknown; code?: unknown } | null = null;
    if (!isBinary) {
      try {
        const v: unknown = JSON.parse((Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)).toString('utf8'));
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) hello = v;
      } catch {
        hello = null;
      }
    }
    if (!hello || hello.type !== 'hello' || hello.protocol !== PROTOCOL || typeof hello.code !== 'string') return { code: CLOSE.badHello, reason: 'bad hello', log: 'a first frame that is not a hello' };
    if (!codesMatch(hello.code, code!)) {
      const blocked = limiter.recordFailure(address, t);
      return { code: CLOSE.wrongCode, reason: 'wrong code', log: blocked ? 'wrong code (that address is now refused for a while)' : 'wrong code' };
    }
    limiter.recordSuccess(address, t);
    if (sessions.size >= o.maxSessions) return { code: CLOSE.noSession, reason: 'no free session', log: 'no free session' };
    return null;
  }

  /** The code was right and there is a free slot: welcome, and start the session's engine. */
  function start(ws: WebSocket, address: string): void {
    // Frames may be large from here on; if this version of ws no longer lets the limit be raised, say so and stop rather than run on the small one.
    const receiver = (ws as unknown as { _receiver?: { _maxPayload?: number } })._receiver;
    if (!receiver || typeof receiver._maxPayload !== 'number') {
      log(`refused ${address}: cannot raise the frame limit of this version of ws`);
      ws.close(CLOSE.failed, 'host error');
      return;
    }
    receiver._maxPayload = maxFrameBytes;
    const id = randomBytes(6).toString('hex');
    const s: Session = { id, ws, address, engine: undefined as unknown as Engine, lastSeen: now(), held: false, closing: false };
    sessions.set(id, s);
    ws.send(JSON.stringify({ type: 'welcome', session: id, protocol: PROTOCOL }));
    try {
      liveEngines++;
      s.engine = o.engines({
        frame: (bytes) => sendFrame(s, bytes),
        failed: (message) => {
          if (s.closing) return;
          sendFrame(s, encodeMessage({ type: 'error', message })); // tell the page why, in its own protocol
          end(s, CLOSE.failed, 'engine stopped');
        },
        exited: () => {
          if (!s.closing) end(s, CLOSE.failed, 'engine stopped');
        },
      });
    } catch {
      liveEngines--;
      log(`close ${address} session ${id}: the engine could not be started`);
      sessions.delete(id);
      ws.close(CLOSE.failed, 'host error');
      return;
    }
    log(`connect ${address} session ${id} (${sessions.size} of ${o.maxSessions})`);
    ws.on('pong', () => {
      s.lastSeen = now();
    });
    ws.on('message', (data: Data, isBinary: boolean) => {
      s.lastSeen = now();
      if (!isBinary) return end(s, CLOSE.badHello, 'binary frames only');
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : Buffer.isBuffer(data) ? new Uint8Array(data) : null; // a Buffer is copied: it may be a slice of a bigger buffer
      if (!bytes) return end(s, CLOSE.badHello, 'one frame, one message');
      if (bytes.byteLength <= 512 && answerPing(s, bytes)) return;
      s.engine.receive(bytes);
    });
    ws.on('close', (c: number) => end(s, c, 'closed by the client'));
    ws.on('error', () => end(s, CLOSE.failed, 'socket error'));
  }

  /** A ping of the page (it measures the link with it) is answered here, not by the engine. */
  function answerPing(s: Session, bytes: Uint8Array): boolean {
    try {
      const m = decodeMessage(bytes);
      if (m.type !== 'ping') return false;
      sendFrame(s, encodeMessage({ type: 'pong', t: m.t }));
      return true;
    } catch {
      return false; // not a ping: the engine will say what is wrong with it
    }
  }

  function sendFrame(s: Session, bytes: Uint8Array): void {
    if (s.closing || s.ws.readyState !== s.ws.OPEN) return;
    s.ws.send(bytes, { binary: true }, () => relieve(s));
    if (!s.held && s.ws.bufferedAmount > highWater) {
      s.held = true;
      s.engine.hold(true);
    }
  }

  function relieve(s: Session): void {
    if (s.held && !s.closing && s.ws.bufferedAmount < lowWater) {
      s.held = false;
      s.engine.hold(false);
    }
  }

  /** End a session: close the socket, stop the engine, free the slot. Once only. */
  function end(s: Session, code: number, reason: string): void {
    if (s.closing) return;
    s.closing = true;
    log(`close ${s.address} session ${s.id} (${code})`);
    s.ws.removeAllListeners();
    s.ws.on('error', () => undefined);
    // A client that does not finish the closing handshake does not hold the socket for long.
    const kill = setTimeout(() => s.ws.terminate(), 2000);
    s.ws.once('close', () => clearTimeout(kill));
    kill.unref();
    if (s.ws.readyState === s.ws.OPEN) s.ws.close(sendable(code), reason);
    else if (s.ws.readyState === s.ws.CONNECTING) s.ws.terminate();
    const stopped = Promise.resolve(s.engine.terminate())
      .catch(() => undefined)
      .then(() => {
        sessions.delete(s.id);
        liveEngines--;
      });
    ended = Promise.all([ended, stopped]);
  }

  const heartbeat = setInterval(() => {
    const t = now();
    for (const s of sessions.values()) {
      if (s.closing) continue;
      if (t - s.lastSeen > deadAfterMs) s.ws.terminate();
      else if (s.ws.readyState === s.ws.OPEN) s.ws.ping();
    }
  }, pingIntervalMs);
  heartbeat.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, o.bind, () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.on('error', (e) => log(`server error: ${e.message}`));
  const bound = server.address();

  return {
    port: typeof bound === 'object' && bound ? bound.port : o.port,
    get sessions() {
      return sessions.size;
    },
    get liveEngines() {
      return liveEngines;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      for (const ws of pending) ws.terminate();
      for (const s of [...sessions.values()]) end(s, CLOSE.away, 'host stopping');
      await ended;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      wss.close();
    },
  };
}
