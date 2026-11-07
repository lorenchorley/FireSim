/**
 * The desktop host (contract 0.8.0 J, 3.2 and 5), over real sockets with an engine that runs nothing (the real worker is
 * in engine.test.ts): the hello and its refusals, the rate limit, the Origin check, the hello timeout, the session limit,
 * what happens to an engine when its session ends, the frame limits, the answer of /__firesim/host, traversal through the
 * host's own routes, what the log holds, flow control, the heartbeat and a graceful stop.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { decodeMessage, encodeMessage } from '../src/sim/remote/codec';
import { CLOSE, startHost, type HostHandle, type HostOptions } from './server';
import { fakeEngines, hello, openClient, waitFor, welcomeOf, type FakeEngine, type TestClient } from './testHelpers';

const CODE = 'ABCD2345';
const SECRET_ENV = 'env-secret-value-4f9a1c';
let dist: string;
const hosts: HostHandle[] = [];
const clients: TestClient[] = [];

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'firesim-host-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>FireSim</title>');
  writeFileSync(join(dist, '..', `${dist.split('/').pop()}-outside.txt`), 'OUTSIDE-THE-APP');
  process.env.FIRESIM_TEST_SECRET = SECRET_ENV;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  for (const h of hosts.splice(0)) await h.close();
});

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
  rmSync(`${dist}-outside.txt`, { force: true });
  delete process.env.FIRESIM_TEST_SECRET;
});

async function host(extra: Partial<HostOptions> = {}): Promise<{ h: HostHandle; engines: FakeEngine[]; logs: string[]; factory: ReturnType<typeof fakeEngines>['factory'] }> {
  const { factory, made } = fakeEngines();
  const logs: string[] = [];
  const h = await startHost({ distDir: dist, port: 0, bind: '127.0.0.1', code: CODE, name: 'Test desk', maxSessions: 2, engines: factory, log: (l) => logs.push(l), helloTimeoutMs: 400, ...extra });
  hosts.push(h);
  return { h, engines: made, logs, factory };
}

async function connect(port: number, o: Parameters<typeof openClient>[1] = {}): Promise<TestClient> {
  const c = await openClient(port, o);
  clients.push(c);
  return c;
}

/** A connection that has said hello with `code` and what the host answered. */
async function join_(port: number, code = CODE, o: Parameters<typeof openClient>[1] = {}): Promise<{ c: TestClient; welcome: Awaited<ReturnType<typeof welcomeOf>> }> {
  const c = await connect(port, o);
  hello(c, code);
  return { c, welcome: await welcomeOf(c) };
}

/** A raw GET with the path exactly as given. */
function get(port: number, path: string, method = 'GET'): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('hello and welcome', () => {
  it('a right code is welcomed with a session id, and the session gets an engine', async () => {
    const { h, engines, logs } = await host();
    const { welcome } = await join_(h.port);
    expect(welcome).toMatchObject({ type: 'welcome', protocol: 1 });
    expect(welcome!.session).toMatch(/^[0-9a-f]{12}$/);
    expect(h.sessions).toBe(1);
    expect(engines).toHaveLength(1);
    expect(logs.some((l) => l.includes(`connect 127.0.0.1 session ${welcome!.session}`))).toBe(true);
  });

  it('the code is accepted in lower case as well', async () => {
    const { h } = await host();
    expect((await join_(h.port, CODE.toLowerCase())).welcome?.type).toBe('welcome');
  });

  it('a wrong code is closed with 4401 and gets no engine', async () => {
    const { h, engines } = await host();
    const { c, welcome } = await join_(h.port, 'WRONG234');
    expect(welcome).toBeNull();
    expect((await c.closed).code).toBe(4401);
    expect(engines).toHaveLength(0);
    expect(h.sessions).toBe(0);
  });

  it('a wrong code that is nearly right, too short, too long or not text is 4401 or 4400, never a welcome', async () => {
    const { h, engines } = await host({ rateLimit: { max: 1000 } });
    for (const code of ['ABCD2346', 'ABCD234', 'ABCD23456', '', 'a b c']) {
      const { c, welcome } = await join_(h.port, code);
      expect(welcome, code).toBeNull();
      expect((await c.closed).code, code).toBe(4401);
    }
    const c = await connect(h.port);
    c.ws.send(JSON.stringify({ type: 'hello', protocol: 1, code: 12345678 }));
    expect((await c.closed).code).toBe(4400);
    expect(engines).toHaveLength(0);
  });

  it('a first frame that is not a good hello is 4400: binary, not JSON, JSON of another shape, another protocol, no code', async () => {
    const { h, engines } = await host();
    const frames: (string | Uint8Array)[] = [new Uint8Array([1, 2, 3]), 'hello', '[1,2]', '"hello"', 'null', JSON.stringify({ type: 'hello', protocol: 2, code: CODE }), JSON.stringify({ type: 'hello', protocol: 1 }), JSON.stringify({ type: 'welcome', protocol: 1, code: CODE }), encodeMessage({ type: 'hello', protocol: 1, code: CODE } as never)];
    for (const f of frames) {
      const c = await connect(h.port);
      c.ws.send(f);
      expect((await c.closed).code, String(f)).toBe(4400);
    }
    expect(engines).toHaveLength(0);
  });

  it('a connection that says nothing is closed with 4400 after the hello time', async () => {
    const { h, logs } = await host({ helloTimeoutMs: 150 });
    const c = await connect(h.port);
    const t0 = Date.now();
    expect((await c.closed).code).toBe(4400);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(120);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(logs.some((l) => l.includes('no hello in time'))).toBe(true);
  });

  it('a hello after the hello time is too late', async () => {
    const { h } = await host({ helloTimeoutMs: 100 });
    const c = await connect(h.port);
    await waitFor(() => c.ws.readyState >= 2, 3000, 'the close');
    hello(c, CODE);
    expect((await c.closed).code).toBe(4400);
  });

  it('other paths and other methods are not the engine', async () => {
    const { h } = await host();
    await expect(openClient(h.port, { path: '/' })).rejects.toMatchObject({ status: 404 });
    await expect(openClient(h.port, { path: '/__firesim/engine2' })).rejects.toMatchObject({ status: 404 });
    await expect(openClient(h.port, { path: '/__firesim/host' })).rejects.toMatchObject({ status: 404 });
    expect((await get(h.port, '/__firesim/engine')).status).toBe(404); // a plain GET is not an upgrade: the static server does not know it
  });
});

describe('rate limit', () => {
  it('after 5 wrong codes from one address that address is refused with 4429, even with the right code, for 60 s; another address is not', async () => {
    let t = 1_000_000;
    const { h, engines, logs } = await host({ now: () => t });
    for (let i = 1; i <= 5; i++) {
      const { c, welcome } = await join_(h.port, `WRONG23${i}`);
      expect(welcome).toBeNull();
      expect((await c.closed).code, `wrong code ${i}`).toBe(4401);
    }
    const refused = await join_(h.port, CODE);
    expect(refused.welcome).toBeNull();
    expect((await refused.c.closed).code).toBe(4429);
    expect(engines).toHaveLength(0);
    // Another address (127.0.0.2 is this computer too) has its own count.
    const other = await join_(h.port, CODE, { localAddress: '127.0.0.2' });
    expect(other.welcome?.type).toBe('welcome');
    // 60 s on, the first address may try again.
    t += 59_000;
    expect((await (await join_(h.port, CODE)).c.closed.catch(() => ({ code: 0 }))).code).toBe(4429);
    t += 2000;
    const again = await join_(h.port, CODE);
    expect(again.welcome?.type).toBe('welcome');
    expect(logs.some((l) => l.includes('now refused'))).toBe(true);
  });

  it('a right code in between clears the count', async () => {
    const { h } = await host({ maxSessions: 20 });
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) {
        const { c } = await join_(h.port, 'WRONG234');
        expect((await c.closed).code).toBe(4401);
      }
      expect((await join_(h.port, CODE)).welcome?.type).toBe('welcome');
    }
  });
});

describe('origin check', () => {
  it('refuses a page of another origin at the handshake, accepts a page served by this host and a client without an Origin', async () => {
    const { h, engines } = await host();
    for (const origin of ['http://evil.example', 'http://evil.example:' + h.port, `http://127.0.0.1:${h.port + 1}`, 'http://localhost:' + h.port + '.evil.example', 'null', 'file://']) {
      await expect(openClient(h.port, { origin }), origin).rejects.toMatchObject({ status: 403 });
    }
    expect(engines).toHaveLength(0);
    expect((await join_(h.port, CODE, { origin: `http://127.0.0.1:${h.port}` })).welcome?.type).toBe('welcome');
    expect((await join_(h.port, CODE)).welcome?.type).toBe('welcome');
  });

  it('a refused page does not get to try codes', async () => {
    const { h, logs } = await host();
    await expect(openClient(h.port, { origin: 'http://evil.example' })).rejects.toMatchObject({ status: 403 });
    expect(logs.some((l) => l.includes('another origin'))).toBe(true);
    expect((await join_(h.port, CODE)).welcome?.type).toBe('welcome'); // and it did not count against this address
  });
});

describe('session limit and what an ended session leaves behind', () => {
  it('the third session of two is refused with 4503, and a slot that is freed can be used', async () => {
    const { h, engines } = await host({ maxSessions: 2 });
    const a = await join_(h.port);
    await join_(h.port);
    const refused = await join_(h.port);
    expect(refused.welcome).toBeNull();
    expect((await refused.c.closed).code).toBe(4503);
    expect(engines).toHaveLength(2);
    a.c.ws.close(1000);
    await waitFor(() => h.sessions === 1, 3000, 'the slot to be freed');
    expect((await join_(h.port)).welcome?.type).toBe('welcome');
    expect(engines).toHaveLength(3);
  });

  it('a session that ends (closed, dropped, or the host told to stop) has its engine terminated once and its slot freed', async () => {
    const { h, engines } = await host({ maxSessions: 3 });
    const a = await join_(h.port);
    const b = await join_(h.port);
    const c = await join_(h.port);
    expect(h.sessions).toBe(3);
    a.c.ws.close(1000);
    b.c.ws.terminate(); // no closing handshake: a dropped link
    await waitFor(() => h.sessions === 1, 3000, 'both to end');
    expect(engines.map((e) => e.terminated)).toEqual([1, 1, 0]);
    expect(h.liveEngines).toBe(1);
    await h.close();
    expect(engines.map((e) => e.terminated)).toEqual([1, 1, 1]);
    expect(h.sessions).toBe(0);
    expect(h.liveEngines).toBe(0);
    expect((await c.c.closed).code).toBe(CLOSE.away);
  });

  it('an engine that fails tells the page in its own protocol and the session is closed with 1011', async () => {
    const { h, engines } = await host();
    const { c } = await join_(h.port);
    engines[0]!.events.failed('The simulation engine stopped: boom');
    const closed = await c.closed;
    expect(closed.code).toBe(1011);
    const frame = c.received.find((m): m is Uint8Array => typeof m !== 'string')!;
    expect(decodeMessage(frame)).toEqual({ type: 'error', message: 'The simulation engine stopped: boom' });
    await waitFor(() => h.sessions === 0, 3000, 'the slot to be freed');
    expect(engines[0]!.terminated).toBe(1);
  });

  it('an engine that ends by itself ends its session', async () => {
    const { h, engines } = await host();
    const { c } = await join_(h.port);
    engines[0]!.events.exited();
    expect((await c.closed).code).toBe(1011);
    await waitFor(() => h.sessions === 0, 3000, 'the slot to be freed');
  });

  it('an engine that cannot be started closes the session and leaks nothing', async () => {
    const { h, logs } = await host({
      engines: () => {
        throw new Error('no thread for you');
      },
    });
    const { c } = await join_(h.port);
    expect((await c.closed).code).toBe(1011);
    expect(h.sessions).toBe(0);
    expect(h.liveEngines).toBe(0);
    expect(logs.some((l) => l.includes('could not be started'))).toBe(true);
  });
});

describe('frames', () => {
  it('after the welcome a binary frame reaches the engine as it was sent, and a frame from the engine reaches the client as binary', async () => {
    const { h, engines } = await host();
    const { c } = await join_(h.port);
    const msg = encodeMessage({ type: 'run', until: 600 });
    c.ws.send(msg);
    await waitFor(() => engines[0]!.frames.length === 1, 3000, 'the frame');
    expect(Array.from(engines[0]!.frames[0]!)).toEqual(Array.from(msg));
    expect(decodeMessage(engines[0]!.frames[0]!)).toEqual({ type: 'run', until: 600 });
    engines[0]!.events.frame(encodeMessage({ type: 'status', time: 5, running: true, speed: 1 }));
    await waitFor(() => c.received.length === 2, 3000, 'the answer');
    expect(typeof c.received[1]).not.toBe('string');
    expect(decodeMessage(c.received[1] as Uint8Array)).toMatchObject({ type: 'status', time: 5 });
  });

  it('a ping of the page is answered by the host with a pong of the same time, and the engine does not see it', async () => {
    const { h, engines } = await host();
    const { c } = await join_(h.port);
    c.ws.send(encodeMessage({ type: 'ping', t: 1234.5 }));
    await waitFor(() => c.received.length === 2, 3000, 'the pong');
    expect(decodeMessage(c.received[1] as Uint8Array)).toEqual({ type: 'pong', t: 1234.5 });
    expect(engines[0]!.frames).toHaveLength(0);
  });

  it('a text frame after the welcome closes the session', async () => {
    const { h, engines } = await host();
    const { c } = await join_(h.port);
    c.ws.send('{"type":"run","until":5}');
    expect((await c.closed).code).toBe(4400);
    await waitFor(() => engines[0]!.terminated === 1, 3000, 'the engine to end');
  });

  it('before the welcome a frame may be a few KB at most; after it, as large as the limit says (1009 beyond it)', async () => {
    const { h, engines } = await host({ maxHelloBytes: 1024, maxFrameBytes: 300_000 });
    const early = await connect(h.port);
    early.ws.send(JSON.stringify({ type: 'hello', protocol: 1, code: CODE, pad: 'x'.repeat(2000) }));
    expect((await early.closed).code).toBe(1009);
    const { c } = await join_(h.port);
    const big = new Uint8Array(250_000); // more than the hello limit, under the frame limit
    big.set(encodeMessage({ type: 'run', until: 1 }));
    c.ws.send(big);
    await waitFor(() => engines[0]!.frames.length === 1, 3000, 'the large frame');
    expect(engines[0]!.frames[0]!.byteLength).toBe(250_000);
    c.ws.send(new Uint8Array(400_000));
    expect((await c.closed).code).toBe(1009);
    expect(engines[0]!.frames).toHaveLength(1);
    await waitFor(() => h.sessions === 0, 3000, 'the session to end');
  });

  it('carries a message the size of a scenario (tens of MB) in one frame, at the default limit', async () => {
    const { h, engines } = await host();
    const { c } = await join_(h.port);
    c.ws.send(new Uint8Array(40 * 1024 * 1024));
    await waitFor(() => engines[0]!.frames.length === 1, 20000, 'the 40 MB frame');
    expect(engines[0]!.frames[0]!.byteLength).toBe(40 * 1024 * 1024);
  }, 30000);
});

describe('a client that breaks the WebSocket protocol', () => {
  /** An unmasked frame from a client (RFC 6455 forbids it): the receiver of the host raises an error. */
  const broken = Buffer.from([0x82, 0x01, 0x00]);
  const inject = (c: TestClient): void => void (c.ws as unknown as { _socket: { write(b: Buffer): void } })._socket.write(broken);

  it('before the hello, and after the welcome, ends that connection and nothing else (the host and its other sessions go on)', async () => {
    const { h, engines } = await host({ maxSessions: 3 });
    const other = await join_(h.port);
    const early = await connect(h.port);
    inject(early);
    expect((await early.closed).code).toBe(1002);
    const late = await join_(h.port);
    inject(late.c);
    expect((await late.c.closed).code).toBe(1002);
    await waitFor(() => h.sessions === 1, 3000, 'the broken session to be freed');
    expect(engines[1]!.terminated).toBe(1);
    expect(other.c.ws.readyState).toBe(other.c.ws.OPEN);
    expect((await join_(h.port)).welcome?.type).toBe('welcome');
  });
});

describe('/__firesim/host and the static routes of the host', () => {
  it('says who the host is, with exactly these fields and nothing that is a secret', async () => {
    const { h } = await host({ name: 'Test desk', maxSessions: 3 });
    const r = await get(h.port, '/__firesim/host');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(r.headers['cache-control']).toBe('no-store');
    const body = JSON.parse(r.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['app', 'cores', 'maxSessions', 'name', 'node', 'protocol', 'sessions']);
    expect(body).toMatchObject({ app: 'firesim-desktop-host', protocol: 1, name: 'Test desk', sessions: 0, maxSessions: 3, node: process.versions.node });
    expect(Number.isInteger(body.cores) && (body.cores as number) >= 1).toBe(true);
    // No code, no path, no environment.
    for (const secret of [CODE, dist, SECRET_ENV, process.cwd(), process.env.HOME ?? '\u0000', process.env.PATH ?? '\u0000']) expect(r.body, secret).not.toContain(secret);
    const more = await get(h.port, '/__firesim/host?x=1&code=' + CODE);
    expect(more.body).toBe(r.body);
    expect((await get(h.port, '/__firesim/host', 'HEAD')).body).toBe('');
    expect((await get(h.port, '/__firesim/host', 'POST')).status).toBe(405);
  });

  it('counts the sessions it is running', async () => {
    const { h } = await host({ maxSessions: 3 });
    await join_(h.port);
    await join_(h.port);
    expect(JSON.parse((await get(h.port, '/__firesim/host')).body)).toMatchObject({ sessions: 2, maxSessions: 3 });
  });

  it('serves the app and refuses traversal through its own routes', async () => {
    const { h } = await host();
    const index = await get(h.port, '/');
    expect(index.status).toBe(200);
    expect(index.body).toContain('FireSim');
    expect(index.headers['cache-control']).toBe('no-store');
    const outside = `/../${dist.split('/').pop()}-outside.txt`;
    for (const p of [outside, '/..%2f' + dist.split('/').pop() + '-outside.txt', '/%2e%2e/etc/passwd', '/__firesim/../../etc/passwd', '/__firesim/host/../../../etc/passwd']) {
      const r = await get(h.port, p);
      expect(r.status, p).toBeGreaterThanOrEqual(400);
      expect(r.body, p).not.toContain('OUTSIDE-THE-APP');
      expect(r.body, p).not.toContain('root:');
    }
  });
});

describe('what the log holds', () => {
  it('a line per connect and close with the address and the session id, and never the code, a wrong guess or a frame', async () => {
    const { h, logs } = await host();
    const wrong = await join_(h.port, 'GUESSED22');
    await wrong.c.closed;
    const bad = await connect(h.port);
    bad.ws.send(`{"type":"hello","protocol":1,"code":"${CODE}","extra":"PAYLOAD-MARKER"}x`);
    await bad.closed;
    const a = await join_(h.port);
    a.c.ws.send(encodeMessage({ type: 'edit', edit: { id: 'secret-edit-marker' } as never, time: 0 }));
    a.c.ws.close(1000);
    await waitFor(() => h.sessions === 0, 3000, 'the session to end');
    await h.close();
    const all = logs.join('\n');
    expect(all).not.toContain(CODE);
    expect(all).not.toContain('GUESSED22');
    expect(all).not.toContain('PAYLOAD-MARKER');
    expect(all).not.toContain('secret-edit-marker');
    expect(all).not.toContain(SECRET_ENV);
    expect(logs.filter((l) => /connect 127\.0\.0\.1 session [0-9a-f]{12}/.test(l))).toHaveLength(1);
    expect(logs.filter((l) => new RegExp(`close 127\\.0\\.0\\.1 session ${a.welcome!.session}`).test(l))).toHaveLength(1);
    expect(logs.filter((l) => l.includes('wrong code'))).toHaveLength(1);
  });

  it('is told a code that cannot be one', async () => {
    await expect(startHost({ distDir: dist, port: 0, bind: '127.0.0.1', code: 'short', name: 'x', maxSessions: 1, engines: fakeEngines().factory, log: () => undefined })).rejects.toThrow(/8 to 32 letters and digits/);
  });
});

describe('flow control, heartbeat and stop', () => {
  it('holds the engine when the client is behind and lets it go when it has caught up', async () => {
    const { h, engines } = await host({ highWaterBytes: 8 * 1024 * 1024, lowWaterBytes: 2 * 1024 * 1024 });
    const { c } = await join_(h.port);
    // A client that does not read: the kernel's buffers fill and the rest queues in the host.
    (c.ws as unknown as { _socket: { pause(): void; resume(): void } })._socket.pause();
    const frame = new Uint8Array(1024 * 1024);
    for (let i = 0; i < 96 && engines[0]!.holds.length === 0; i++) {
      engines[0]!.events.frame(frame.slice());
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(engines[0]!.holds).toEqual([true]);
    (c.ws as unknown as { _socket: { resume(): void } })._socket.resume();
    await waitFor(() => engines[0]!.holds.length === 2, 10000, 'the hold to be lifted');
    expect(engines[0]!.holds).toEqual([true, false]);
  }, 30000);

  it('pings its sessions, and closes one that has gone silent', async () => {
    const { h, engines } = await host({ pingIntervalMs: 40, deadAfterMs: 250 });
    const alive = await join_(h.port);
    let pings = 0;
    alive.c.ws.on('ping', () => pings++);
    const silent = await join_(h.port, CODE, { autoPong: false });
    await waitFor(() => pings >= 2, 3000, 'two pings');
    expect((await silent.c.closed).code).toBe(1006); // dropped: nothing was sent back
    await waitFor(() => h.sessions === 1, 3000, 'the silent session to be freed');
    expect(engines[1]!.terminated).toBe(1);
    expect(engines[0]!.terminated).toBe(0);
    expect(alive.c.ws.readyState).toBe(alive.c.ws.OPEN);
  });

  it('stops gracefully: closes its sockets with 1001, ends its engines, stops listening, and a second stop is harmless', async () => {
    const { h, engines } = await host();
    const a = await join_(h.port);
    const waiting = await connect(h.port); // has not said hello
    const port = h.port;
    await h.close();
    expect((await a.c.closed).code).toBe(CLOSE.away);
    await waiting.closed;
    expect(engines[0]!.terminated).toBe(1);
    await expect(openClient(port)).rejects.toBeDefined();
    await h.close();
  });

  it('refuses new connections while it has too many that have not said hello', async () => {
    const { h } = await host({ maxPending: 2, helloTimeoutMs: 2000 });
    await connect(h.port);
    await connect(h.port);
    await expect(openClient(h.port)).rejects.toMatchObject({ status: 503 });
  });
});
