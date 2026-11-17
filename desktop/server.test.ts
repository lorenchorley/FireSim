/**
 * The desktop host (contract 0.8.0 J, 3.2 and 5), over real sockets with an engine that runs nothing (the real worker is
 * in engine.test.ts): the hello and its refusals, the rate limit, the Origin check, the hello timeout, the session limit,
 * what happens to an engine when its session ends, the frame limits, the answer of /__firesim/host, traversal through the
 * host's own routes, what the log holds, flow control, the heartbeat and a graceful stop.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect as connectTcp } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { decodeMessage, encodeMessage } from '../src/sim/remote/codec';
import { OpenTokens } from './openToken';
import { CLOSE, DEFAULT_HIGH_WATER_BYTES, DEFAULT_LOW_WATER_BYTES, startHost, type HostHandle, type HostOptions } from './server';
import { fakeEngines, hello, openClient, rawUpgrade, waitFor, welcomeOf, type FakeEngine, type TestClient } from './testHelpers';

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
function get(port: number, path: string, method = 'GET', headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
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
    expect(welcome).toMatchObject({ type: 'welcome', protocol: 2 });
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
    c.ws.send(JSON.stringify({ type: 'hello', protocol: 2, code: 12345678 }));
    expect((await c.closed).code).toBe(4400);
    expect(engines).toHaveLength(0);
  });

  it('a first frame that is not a good hello is 4400: binary, not JSON, JSON of another shape, another protocol, no code', async () => {
    const { h, engines } = await host();
    const frames: (string | Uint8Array)[] = [new Uint8Array([1, 2, 3]), 'hello', '[1,2]', '"hello"', 'null', JSON.stringify({ type: 'hello', protocol: '2', code: CODE }), JSON.stringify({ type: 'hello', protocol: 2 }), JSON.stringify({ type: 'welcome', protocol: 2, code: CODE }), encodeMessage({ type: 'hello', protocol: 2, code: CODE } as never)];
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
    early.ws.send(JSON.stringify({ type: 'hello', protocol: 2, code: CODE, pad: 'x'.repeat(2000) }));
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
  it('says before the code only that it is a FireSim host that wants a code (protocol 2): exactly these three fields, and nothing of the computer or a secret', async () => {
    const { h } = await host({ name: 'Test desk', maxSessions: 3 });
    const r = await get(h.port, '/__firesim/host');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toBe('{"app":"firesim-desktop-host","protocol":2,"requiresCode":true}');
    expect(JSON.parse(r.body)).toEqual({ app: 'firesim-desktop-host', protocol: 2, requiresCode: true });
    // No code, no name, no core count, no Node version, no session count, no path, no environment, no host name.
    for (const secret of [CODE, 'Test desk', dist, SECRET_ENV, process.cwd(), process.env.HOME ?? '\u0000', process.env.PATH ?? '\u0000', process.versions.node, 'cores', 'sessions', '"node"', 'name']) expect(r.body, secret).not.toContain(secret);
    const more = await get(h.port, '/__firesim/host?x=1&code=' + CODE);
    expect(more.body).toBe(r.body);
    expect((await get(h.port, '/__firesim/host', 'HEAD')).body).toBe('');
    expect((await get(h.port, '/__firesim/host', 'POST')).status).toBe(405);
  });

  it('the welcome, after the code, carries what the host is: name, cores, Node version, and the sessions running (this one included) and allowed', async () => {
    const { h } = await host({ name: 'Test desk', maxSessions: 3 });
    const a = await join_(h.port);
    expect(a.welcome).toMatchObject({ type: 'welcome', protocol: 2, name: 'Test desk', node: process.versions.node, sessions: 1, maxSessions: 3 });
    expect(Number.isInteger(a.welcome!.cores) && a.welcome!.cores! >= 1).toBe(true);
    expect(Object.keys(a.welcome!).sort()).toEqual(['cores', 'maxSessions', 'name', 'node', 'protocol', 'session', 'sessions', 'type']);
    const b = await join_(h.port);
    expect(b.welcome).toMatchObject({ sessions: 2, maxSessions: 3 });
  });

  it('a wrong code gets none of that: the answer to a refused hello is a close and nothing about the computer', async () => {
    const { h } = await host({ name: 'Test desk' });
    const { c, welcome } = await join_(h.port, 'WRONG234');
    expect(welcome).toBeNull();
    expect((await c.closed).code).toBe(4401);
    expect(c.received).toEqual([]);
  });

  it("a hello of another version of the link is closed with 4426 and the host's own version, not 4400 or 4401, and it does not count as a wrong code", async () => {
    const { h, engines, logs } = await host({ rateLimit: { max: 2 } });
    for (const protocol of [1, 3, 0, 99]) {
      const c = await connect(h.port);
      c.ws.send(JSON.stringify({ type: 'hello', protocol, code: CODE }));
      expect(await c.closed, String(protocol)).toEqual({ code: 4426, reason: 'protocol 2' });
      expect(c.received).toEqual([]);
    }
    // the same with a wrong code: the version is said first, and nothing about the code
    const wrong = await connect(h.port);
    wrong.ws.send(JSON.stringify({ type: 'hello', protocol: 1, code: 'WRONG234' }));
    expect((await wrong.closed).code).toBe(4426);
    expect(engines).toHaveLength(0);
    // five version refusals did not use up the two wrong codes this address may send
    expect((await join_(h.port, 'WRONG234')).welcome).toBeNull();
    expect((await join_(h.port, CODE)).welcome?.type).toBe('welcome');
    expect(logs.some((l) => l.includes('hello of protocol 1 (this host speaks 2)'))).toBe(true);
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
    bad.ws.send(`{"type":"hello","protocol":2,"code":"${CODE}","extra":"PAYLOAD-MARKER"}x`);
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

  it('has the pair of numbers the throttled-link measurement chose, 8 MiB to hold and 4 MiB to let go (0.8.0 had 16 and 4), and a host that is given none uses them', async () => {
    expect(DEFAULT_HIGH_WATER_BYTES).toBe(8 * 1024 * 1024);
    expect(DEFAULT_LOW_WATER_BYTES).toBe(4 * 1024 * 1024);
    const { h, engines } = await host(); // no pair given
    const { c } = await join_(h.port);
    (c.ws as unknown as { _socket: { pause(): void; resume(): void } })._socket.pause();
    const frame = new Uint8Array(1024 * 1024);
    // The kernel takes some of what is sent to a client that does not read (its buffers, up to tens of MiB here); the rest queues in the host and is held at 8 MiB.
    for (let i = 0; i < 200 && engines[0]!.holds.length === 0; i++) {
      engines[0]!.events.frame(frame.slice());
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(engines[0]!.holds).toEqual([true]);
    (c.ws as unknown as { _socket: { resume(): void } })._socket.resume();
    await waitFor(() => engines[0]!.holds.length === 2, 20000, 'the hold to be lifted');
    expect(engines[0]!.holds).toEqual([true, false]);
  }, 60000);

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

describe('host allowlist (DNS rebinding)', () => {
  const ALLOWED = ['desk-pc', 'desk-pc.local', 'rebinder-friend.lan'];

  it('refuses a request whose Host header is not a name of this computer: 421 and an empty body, for the app, the host info and every other path', async () => {
    const { h, logs } = await host({ allowedHosts: ALLOWED });
    const evil = `attacker.example:${h.port}`;
    for (const path of ['/__firesim/host', '/', '/index.html', '/assets/x.js', '/__firesim/engine', '/nope']) {
      const r = await get(h.port, path, 'GET', { Host: evil });
      expect(r.status, path).toBe(421);
      expect(r.body, path).toBe('');
      expect(r.headers['content-length'], path).toBe('0');
    }
    for (const host_ of ['localhost.attacker.example', '127.0.0.1.attacker.example', 'desk-pc.attacker.example', 'xdesk-pc.local', 'attacker.example']) {
      expect((await get(h.port, '/__firesim/host', 'GET', { Host: host_ })).status, host_).toBe(421);
    }
    expect((await get(h.port, '/__firesim/host', 'HEAD', { Host: evil })).status).toBe(421);
    expect((await get(h.port, '/__firesim/host', 'POST', { Host: evil })).status).toBe(421);
    // and it says so, once for each name
    expect(logs.filter((l) => l.includes('"attacker.example:'))).toHaveLength(1);
    expect(logs.find((l) => l.includes('"attacker.example:'))).toContain('--allow-host');
  });

  it('refuses a request with no Host header at all (HTTP/1.0) and one with a Host that is not a host', async () => {
    const { h } = await host({ allowedHosts: ALLOWED });
    const rawStatus = (text: string): Promise<string> =>
      new Promise((resolve) => {
        const s = connectTcp(h.port, '127.0.0.1');
        let buf = '';
        s.on('data', (d: Buffer) => (buf += d.toString('latin1')));
        s.on('close', () => resolve(/^HTTP\/1\.\d (\d+)/.exec(buf)?.[1] ?? 'none'));
        s.on('connect', () => s.write(text));
        setTimeout(() => s.destroy(), 1500);
      });
    expect(await rawStatus('GET /__firesim/host HTTP/1.0\r\n\r\n')).toBe('421');
    expect(await rawStatus('GET /__firesim/host HTTP/1.1\r\nHost: user@127.0.0.1\r\nConnection: close\r\n\r\n')).toBe('421');
    expect(await rawStatus('GET /__firesim/host HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')).toBe('200');
  });

  it('serves every allowed form: an IPv4 literal, an IPv6 literal, localhost, the computer name and its .local name, and an --allow-host name, with or without a port', async () => {
    const { h } = await host({ allowedHosts: ALLOWED });
    for (const host_ of [`127.0.0.1:${h.port}`, '127.0.0.1', '192.168.1.20:4300', `[::1]:${h.port}`, `localhost:${h.port}`, 'LOCALHOST', 'desk-pc', `DESK-PC.local:${h.port}`, 'rebinder-friend.lan', `Rebinder-Friend.LAN:${h.port}`]) {
      const r = await get(h.port, '/__firesim/host', 'GET', { Host: host_ });
      expect(r.status, host_).toBe(200);
      expect(JSON.parse(r.body).app, host_).toBe('firesim-desktop-host');
      expect((await get(h.port, '/', 'GET', { Host: host_ })).status, host_).toBe(200);
    }
  });

  it('refuses the WebSocket handshake of a rebound page (Origin and Host are both the attacker\'s name) with the same 421, and an allowed name gets through', async () => {
    const { h, engines } = await host({ allowedHosts: ALLOWED, maxSessions: 10 });
    const evil = `attacker.example:${h.port}`;
    await expect(openClient(h.port, { host: evil, origin: `http://${evil}` })).rejects.toMatchObject({ status: 421 });
    await expect(openClient(h.port, { host: evil })).rejects.toMatchObject({ status: 421 });
    await expect(openClient(h.port, { host: 'xdesk-pc.local', origin: 'http://xdesk-pc.local' })).rejects.toMatchObject({ status: 421 });
    expect(engines).toHaveLength(0);
    for (const name of [`localhost:${h.port}`, `desk-pc.local:${h.port}`, `rebinder-friend.lan:${h.port}`, `[::1]:${h.port}`, `127.0.0.1:${h.port}`]) {
      expect((await join_(h.port, CODE, { host: name, origin: `http://${name}` })).welcome?.type, name).toBe('welcome');
    }
  });

  it('does not touch the rate-limit counter: any number of refused-Host handshakes, with wrong codes ready to send, leave the owner his five tries and a right code', async () => {
    const { h, engines } = await host({ allowedHosts: ALLOWED });
    const evil = `attacker.example:${h.port}`;
    for (let i = 0; i < 12; i++) {
      try {
        const c = await connect(h.port, { host: evil, origin: `http://${evil}` });
        hello(c, `WRONGWR${i % 10}`);
        await c.closed;
      } catch {
        /* refused at the handshake: nothing to send */
      }
    }
    expect(engines).toHaveLength(0);
    for (let i = 0; i < 4; i++) {
      const { c } = await join_(h.port, 'WRONGWRO');
      expect((await c.closed).code).toBe(4401); // not 4429: the twelve did not count
    }
    expect((await join_(h.port, CODE)).welcome?.type).toBe('welcome');
  });

  it('keeps the log short under a flood of forged names', async () => {
    const { h, logs } = await host({ allowedHosts: ALLOWED });
    for (let i = 0; i < 100; i++) await get(h.port, '/__firesim/host', 'GET', { Host: `n${i}.attacker.example` });
    expect(logs.filter((l) => l.includes('is not a name of this computer')).length).toBeLessThanOrEqual(32);
  });
});

describe('connections that have not said hello', () => {
  it('a silent connection that never answers a close gives its slot back within a second of the hello time, and the socket is dropped', async () => {
    const { h } = await host({ helloTimeoutMs: 300 });
    const socks: Awaited<ReturnType<typeof rawUpgrade>>[] = [];
    for (let i = 0; i < 4; i++) socks.push(await rawUpgrade(h.port));
    expect(h.pending).toBe(4);
    await waitFor(() => h.pending === 0, 1000, 'the slots to be given back after the hello time (300 ms)');
    await waitFor(() => socks.every((s) => s.closed()), 3000, 'the sockets to be dropped');
    expect((await join_(h.port)).welcome?.type).toBe('welcome');
  });

  it('16 silent connections from one address take 4 slots and leave the rest free: another address is not blocked', async () => {
    const { h } = await host({ helloTimeoutMs: 5000 });
    const statuses: number[] = [];
    const socks = [];
    for (let i = 0; i < 16; i++) {
      const r = await rawUpgrade(h.port).catch(() => ({ status: 0, socket: null }));
      statuses.push(r.status);
      if (r.socket) socks.push(r.socket);
    }
    expect(statuses.filter((s) => s === 101)).toHaveLength(4);
    expect(statuses.filter((s) => s === 503)).toHaveLength(12);
    expect(h.pending).toBe(4);
    // another address (127.0.0.2 is this computer too) gets in, and so does a welcome
    expect((await join_(h.port, CODE, { localAddress: '127.0.0.2' })).welcome?.type).toBe('welcome');
    expect((await rawUpgrade(h.port, { localAddress: '127.0.0.3' })).status).toBe(101);
    for (const s of socks) s.destroy();
  });

  it('the per-address count follows connections that say hello or go away, and the limit can be set', async () => {
    const { h } = await host({ maxPendingPerAddress: 2, helloTimeoutMs: 5000 });
    const a = await connect(h.port);
    const b = await connect(h.port);
    await expect(openClient(h.port)).rejects.toMatchObject({ status: 503 });
    hello(a, CODE); // a is no longer waiting
    await welcomeOf(a);
    const c = await connect(h.port);
    await expect(openClient(h.port)).rejects.toMatchObject({ status: 503 });
    b.ws.terminate(); // b goes away
    await waitFor(() => h.pending === 1, 3000, 'b to be forgotten');
    const d = await connect(h.port);
    expect(h.pending).toBe(2);
    c.ws.terminate();
    d.ws.terminate();
  });
});

describe('limits on what a session may send and may owe', () => {
  it('a session that pings more than 20 times in a second is closed (1008) and its engine ended; 20 pings are fine', async () => {
    const { h, engines, logs } = await host();
    const ok = await join_(h.port);
    for (let i = 0; i < 20; i++) ok.c.ws.send(encodeMessage({ type: 'ping', t: i }));
    await waitFor(() => ok.c.received.length === 21, 3000, 'twenty pongs');
    expect(ok.c.ws.readyState).toBe(ok.c.ws.OPEN);
    const { c } = await join_(h.port);
    for (let i = 0; i < 25; i++) c.ws.send(encodeMessage({ type: 'ping', t: i }));
    expect((await c.closed).code).toBe(1008);
    await waitFor(() => engines[1]!.terminated === 1, 3000, 'the engine to end');
    expect(logs.some((l) => l.includes('more than 20 pings in a second'))).toBe(true);
    expect(c.received.filter((m) => typeof m !== 'string').length).toBeLessThanOrEqual(20); // no more than the pongs it was owed
  });

  it('a session that sends more messages of any kind than the limit in a second is closed (1008)', async () => {
    const { h, engines } = await host({ messagesPerSecond: 50 });
    const { c } = await join_(h.port);
    const pause = encodeMessage({ type: 'pause' });
    for (let i = 0; i < 60; i++) c.ws.send(pause);
    expect((await c.closed).code).toBe(1008);
    expect(engines[0]!.frames.length).toBeLessThanOrEqual(50);
    await waitFor(() => engines[0]!.terminated === 1, 3000, 'the engine to end');
  });

  it('closes a session that has had more than the limit waiting to be sent for longer than the grace time, and not one that catches up in time', async () => {
    const flood = (e: FakeEngine, mib: number): void => {
      for (let i = 0; i < mib; i++) e.events.frame(new Uint8Array(1024 * 1024));
    };
    const { h, engines, logs } = await host({ maxBufferedBytes: 4 * 1024 * 1024, maxBufferedMs: 600, highWaterBytes: 1 << 30, lowWaterBytes: 1 << 29 });
    // one that reads too slowly for too long
    const slow = await join_(h.port);
    (slow.c.ws as unknown as { _socket: { pause(): void } })._socket.pause();
    flood(engines[0]!, 80);
    // The host gives up on it after 600 ms (its close frame is queued behind the frames it owes, and the socket is dropped soon after).
    await waitFor(() => engines[0]!.terminated === 1 && h.sessions === 0, 8000, 'the session to end');
    expect(logs.some((l) => l.includes('waited to be sent for over 600 ms'))).toBe(true);
    (slow.c.ws as unknown as { _socket: { resume(): void } })._socket.resume();
    await slow.c.closed;
    // one that is behind for a moment and then reads
    const brief = await join_(h.port);
    (brief.c.ws as unknown as { _socket: { pause(): void; resume(): void } })._socket.pause();
    flood(engines[1]!, 80);
    await new Promise((r) => setTimeout(r, 100));
    (brief.c.ws as unknown as { _socket: { resume(): void } })._socket.resume();
    await waitFor(() => brief.c.received.length === 81, 10000, 'all frames');
    await new Promise((r) => setTimeout(r, 1500));
    expect(brief.c.ws.readyState).toBe(brief.c.ws.OPEN);
  }, 30000);

  it('takes frames up to 128 MiB by default and says 1009 above it', async () => {
    const { h, engines } = await host();
    const { c } = await join_(h.port);
    // the header of a masked 128 MiB + 1 frame: ws refuses it from the header, before any of the payload is sent
    const header = Buffer.alloc(14);
    header[0] = 0x82;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(128 * 1024 * 1024 + 1), 2);
    (c.ws as unknown as { _socket: { write(b: Buffer): void } })._socket.write(header);
    expect((await c.closed).code).toBe(1009);
    expect(engines[0]!.frames).toHaveLength(0);
    const ok = await join_(h.port);
    ok.c.ws.send(new Uint8Array(20 * 1024 * 1024));
    await waitFor(() => engines[1]!.frames.length === 1, 10000, 'the 20 MiB frame');
  }, 30000);
});

describe('origins the owner lists (--allow-origin, --allow-app)', () => {
  const APP = 'https://localhost';
  const IOS = 'capacitor://localhost';
  const LISTED = [APP, IOS, 'http://192.168.1.50:4173'];

  it('accepts the handshake of a listed origin with the right code, and the session works as any other', async () => {
    const { h, engines } = await host({ allowedOrigins: LISTED, maxSessions: 5 });
    for (const origin of LISTED) {
      const { c, welcome } = await join_(h.port, CODE, { origin });
      expect(welcome?.type, origin).toBe('welcome');
      c.ws.send(encodeMessage({ type: 'run', until: 1 }));
    }
    await waitFor(() => engines.length === 3 && engines.every((e) => e.frames.length === 1), 3000, 'the frames');
  });

  it('refuses the handshake of any origin that is not listed with 403 (and no session), however much it looks like a listed one', async () => {
    const { h, engines, logs } = await host({ allowedOrigins: LISTED, maxSessions: 10 });
    for (const origin of ['http://localhost', 'https://localhost:8443', 'https://localhost.evil.example', 'https://evil.example', 'capacitor://localhost:80', 'ionic://localhost', 'http://192.168.1.50', 'null', 'file://', 'https://user@localhost', '*']) {
      await expect(openClient(h.port, { origin }), origin).rejects.toMatchObject({ status: 403 });
    }
    expect(engines).toHaveLength(0);
    expect(logs.some((l) => l.includes('another origin'))).toBe(true);
  });

  it('refuses a listed origin with a wrong code, exactly as it refuses any page: 4401 and the rate limit', async () => {
    const { h, engines } = await host({ allowedOrigins: LISTED });
    for (let i = 1; i <= 5; i++) {
      const { c, welcome } = await join_(h.port, `WRONG23${i}`, { origin: APP });
      expect(welcome).toBeNull();
      expect((await c.closed).code, `wrong code ${i}`).toBe(4401);
    }
    const { c, welcome } = await join_(h.port, CODE, { origin: APP });
    expect(welcome).toBeNull();
    expect((await c.closed).code).toBe(4429);
    expect(engines).toHaveLength(0);
  });

  it('refuses what it refused before when no origin is listed: the app origins are 403 without --allow-app', async () => {
    const { h } = await host();
    for (const origin of [APP, IOS]) await expect(openClient(h.port, { origin }), origin).rejects.toMatchObject({ status: 403 });
  });

  it("keeps the Host allowlist for a listed origin: a rebinding-style Host (a name that is not the computer's) is 421, with the app origin and with a page of the attacker's own", async () => {
    const { h, engines } = await host({ allowedOrigins: LISTED, allowedHosts: ['desk-pc', 'desk-pc.local'], maxSessions: 10 });
    const evil = `attacker.example:${h.port}`;
    await expect(openClient(h.port, { host: evil, origin: APP })).rejects.toMatchObject({ status: 421 });
    await expect(openClient(h.port, { host: evil, origin: `http://${evil}` })).rejects.toMatchObject({ status: 421 });
    await expect(openClient(h.port, { host: `localhost.attacker.example:${h.port}`, origin: APP })).rejects.toMatchObject({ status: 421 });
    expect((await get(h.port, '/__firesim/host', 'GET', { Host: evil, Origin: APP })).status).toBe(421);
    expect(engines).toHaveLength(0);
    for (const name of [`127.0.0.1:${h.port}`, `192.168.1.20:${h.port}`, `[::1]:${h.port}`, `desk-pc.local:${h.port}`, `localhost:${h.port}`]) expect((await join_(h.port, CODE, { host: name, origin: APP })).welcome?.type, name).toBe('welcome');
  });

  describe('/__firesim/host from another origin (CORS)', () => {
    const PROBE = '{"app":"firesim-desktop-host","protocol":2,"requiresCode":true}';

    it('answers a listed origin with its own origin in Access-Control-Allow-Origin (never *, never with credentials), the same three fields, and Vary: Origin', async () => {
      const { h } = await host({ allowedOrigins: LISTED });
      for (const origin of LISTED) {
        const r = await get(h.port, '/__firesim/host', 'GET', { Origin: origin });
        expect(r.status, origin).toBe(200);
        expect(r.headers['access-control-allow-origin'], origin).toBe(origin);
        expect(r.headers['access-control-allow-credentials'], origin).toBeUndefined();
        expect(String(r.headers.vary), origin).toMatch(/\bOrigin\b/);
        expect(r.body, origin).toBe(PROBE);
        const head = await get(h.port, '/__firesim/host', 'HEAD', { Origin: origin });
        expect(head.headers['access-control-allow-origin']).toBe(origin);
      }
    });

    it("gives no CORS header to an origin that is not listed, to a page of the host's own origin, or to a client with no Origin: a browser will not let those pages read it", async () => {
      const { h } = await host({ allowedOrigins: LISTED });
      for (const origin of ['https://evil.example', 'http://localhost', 'null', 'https://localhost:8443', `http://127.0.0.1:${h.port}`]) {
        const r = await get(h.port, '/__firesim/host', 'GET', { Origin: origin });
        expect(r.status, origin).toBe(200);
        expect(r.headers['access-control-allow-origin'], origin).toBeUndefined();
        expect(String(r.headers.vary), origin).toMatch(/\bOrigin\b/);
      }
      const none = await get(h.port, '/__firesim/host');
      expect(none.headers['access-control-allow-origin']).toBeUndefined();
      expect(JSON.stringify(none.headers)).not.toContain('"*"');
    });

    it('gives no CORS header to anyone when no origin is listed', async () => {
      const { h } = await host();
      for (const origin of [APP, IOS, 'https://evil.example']) expect((await get(h.port, '/__firesim/host', 'GET', { Origin: origin })).headers['access-control-allow-origin'], origin).toBeUndefined();
    });

    it('answers the preflight of a listed origin with 204, its origin, GET and HEAD and the two headers a no-store fetch adds, and says the private network may be reached when asked', async () => {
      const { h } = await host({ allowedOrigins: LISTED });
      const r = await get(h.port, '/__firesim/host', 'OPTIONS', { Origin: APP, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'cache-control, pragma', 'Access-Control-Request-Private-Network': 'true' });
      expect(r.status).toBe(204);
      expect(r.body).toBe('');
      expect(r.headers['access-control-allow-origin']).toBe(APP);
      expect(r.headers['access-control-allow-methods']).toBe('GET, HEAD, OPTIONS');
      expect(String(r.headers['access-control-allow-headers']).toLowerCase()).toBe('cache-control, pragma');
      expect(r.headers['access-control-allow-private-network']).toBe('true');
      expect(Number(r.headers['access-control-max-age'])).toBeGreaterThan(0);
      expect(r.headers['access-control-allow-credentials']).toBeUndefined();
      // without the private network question, no answer to it
      const plain = await get(h.port, '/__firesim/host', 'OPTIONS', { Origin: IOS, 'Access-Control-Request-Method': 'GET' });
      expect(plain.status).toBe(204);
      expect(plain.headers['access-control-allow-origin']).toBe(IOS);
      expect(plain.headers['access-control-allow-private-network']).toBeUndefined();
    });

    it('does not answer the preflight of an origin that is not listed, or of a request with no Origin: 405 and no CORS header; and the engine path has no preflight at all', async () => {
      const { h } = await host({ allowedOrigins: LISTED });
      const refused: Record<string, string>[] = [{ Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' }, { Origin: 'null', 'Access-Control-Request-Method': 'GET' }, { 'Access-Control-Request-Method': 'GET' }];
      for (const headers of refused) {
        const r = await get(h.port, '/__firesim/host', 'OPTIONS', headers);
        expect(r.status, JSON.stringify(headers)).toBe(405);
        expect(r.headers['access-control-allow-origin']).toBeUndefined();
        expect(r.headers['access-control-allow-methods']).toBeUndefined();
      }
      expect((await get(h.port, '/__firesim/host', 'POST', { Origin: APP })).status).toBe(405);
      expect((await get(h.port, '/__firesim/engine', 'OPTIONS', { Origin: APP, 'Access-Control-Request-Method': 'GET' })).headers['access-control-allow-origin']).toBeUndefined();
    });

    it("gives no CORS header on the app's own files: a listed origin may read /__firesim/host and nothing else", async () => {
      const { h } = await host({ allowedOrigins: LISTED });
      for (const path of ['/', '/index.html', '/nope']) expect((await get(h.port, path, 'GET', { Origin: APP })).headers['access-control-allow-origin'], path).toBeUndefined();
    });
  });
});

describe('the one-use link of --open (/__firesim/open)', () => {
  /** A host with its tokens on a clock the test moves. */
  async function opening(): Promise<{ h: HostHandle; tokens: OpenTokens; clock: { t: number }; logs: string[] }> {
    const clock = { t: 5_000_000 };
    const tokens = new OpenTokens({ now: () => clock.t });
    const { h, logs } = await host({ openTokens: tokens });
    return { h, tokens, clock, logs };
  }
  const redirect = (r: { status: number; headers: Record<string, string | string[] | undefined> }): string | undefined => (r.status === 302 ? String(r.headers.location) : undefined);

  it('redirects a good token, once, to /#code=CODE, and never keeps the answer', async () => {
    const { h, tokens, logs } = await opening();
    const token = tokens.issue();
    const first = await get(h.port, `/__firesim/open?t=${token}`);
    expect(redirect(first)).toBe(`/#code=${CODE}`);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['referrer-policy']).toBe('no-referrer');
    expect(first.body).toBe('');
    const again = await get(h.port, `/__firesim/open?t=${token}`);
    expect(again.status).toBe(410);
    expect(again.body).toBe('This link was used already or has run out. Open the address the host printed.');
    expect(again.headers.location).toBeUndefined();
    expect(again.body).not.toContain(CODE);
    expect(logs.join('\n')).not.toContain(CODE);
    expect(logs.filter((l) => l.includes('one-use link used'))).toHaveLength(1);
  });

  it('is good for 60 seconds, and a token that has run out gets the same refusal as a spent one (and no code)', async () => {
    const { h, tokens, clock } = await opening();
    const a = tokens.issue();
    const b = tokens.issue();
    clock.t += 60_000;
    expect(redirect(await get(h.port, `/__firesim/open?t=${a}`))).toBe(`/#code=${CODE}`);
    clock.t += 1;
    const late = await get(h.port, `/__firesim/open?t=${b}`);
    expect(late.status).toBe(410);
    expect(late.body).not.toContain(CODE);
  });

  it('refuses no token, a wrong one and an empty one with 410 and no code', async () => {
    const { h, tokens } = await opening();
    const token = tokens.issue();
    for (const path of ['/__firesim/open', '/__firesim/open?t=', '/__firesim/open?t=wrong', `/__firesim/open?t=${token}x`, `/__firesim/open?T=${token}`, '/__firesim/open?t=%00']) {
      const r = await get(h.port, path);
      expect(r.status, path).toBe(410);
      expect(JSON.stringify(r)).not.toContain(CODE);
    }
    expect(redirect(await get(h.port, `/__firesim/open?t=${token}`))).toBe(`/#code=${CODE}`); // the wrong tries did not spend it
  });

  it('is spent only by a GET: a HEAD, a POST or an OPTIONS leave it for the browser', async () => {
    const { h, tokens } = await opening();
    const token = tokens.issue();
    for (const method of ['HEAD', 'POST', 'OPTIONS', 'PUT']) expect((await get(h.port, `/__firesim/open?t=${token}`, method)).status, method).toBe(405);
    expect(redirect(await get(h.port, `/__firesim/open?t=${token}`))).toBe(`/#code=${CODE}`);
  });

  it("keeps the Host allowlist: a link opened by a name that is not the computer's is 421, and does not spend the token", async () => {
    const { h, tokens } = await opening();
    const token = tokens.issue();
    expect((await get(h.port, `/__firesim/open?t=${token}`, 'GET', { Host: `attacker.example:${h.port}` })).status).toBe(421);
    expect(redirect(await get(h.port, `/__firesim/open?t=${token}`))).toBe(`/#code=${CODE}`);
  });

  it("is not a route of the host without --open: the path is the static server's (a 404), and no code comes out of it", async () => {
    const { h } = await host();
    const r = await get(h.port, '/__firesim/open?t=anything');
    expect(r.status).toBe(404);
    expect(JSON.stringify(r)).not.toContain(CODE);
  });
});
