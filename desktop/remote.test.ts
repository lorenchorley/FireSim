/**
 * What the page sees of the host through connectRemote (the page's interface): no request before the socket (the welcome says what the
 * host is), a version of the link that is not this one, and `onClosed`, told once when the link ends for any reason of its own.
 * Against the real host (an engine that runs nothing: the simulation is in engine.test.ts) over a real WebSocket, the one Node ships.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket as WsSocket, WebSocketServer } from 'ws';
import { connectRemote, RemoteVersionError, type RemoteConnection } from '../src/sim/remote';
import { detectHost } from '../src/sim/remote/detect';
import { encodeMessage } from '../src/sim/remote/codec';
import { startHost, type HostHandle, type HostOptions } from './server';
import { fakeEngines, waitFor, type FakeEngine } from './testHelpers';

const CODE = 'ABCD2345';
const hosts: HostHandle[] = [];
const open: RemoteConnection[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of open.splice(0)) c.close();
  for (const h of hosts.splice(0)) await h.close();
});

async function host(extra: Partial<HostOptions> = {}): Promise<{ h: HostHandle; engines: FakeEngine[]; base: string }> {
  const { factory, made } = fakeEngines();
  const h = await startHost({ distDir: '.', port: 0, bind: '127.0.0.1', code: CODE, name: 'Test desk', maxSessions: 4, engines: factory, log: () => undefined, ...extra });
  hosts.push(h);
  return { h, engines: made, base: `http://127.0.0.1:${h.port}` };
}

async function connect(base: string): Promise<RemoteConnection> {
  const c = await connectRemote({ base, code: CODE });
  open.push(c);
  return c;
}

/** The requests that asked for the host's info, by whoever made them in this process. */
const infoRequests = (spy: ReturnType<typeof vi.spyOn>): number => spy.mock.calls.filter((c: unknown[]) => String(c[0]).endsWith('/__firesim/host')).length;

describe('connectRemote and the host info (protocol 2)', () => {
  it('asks the host nothing before the socket: the welcome carries what the host is, with or without a probe', async () => {
    const { base } = await host();
    const probe = await detectHost({ base });
    expect(probe).toEqual({ app: 'firesim-desktop-host', protocol: 2, requiresCode: true });
    const spy = vi.spyOn(globalThis, 'fetch');
    const a = await connectRemote({ base, code: CODE, probe: probe! });
    const b = await connect(base);
    open.push(a);
    expect(spy).not.toHaveBeenCalled();
    for (const c of [a, b]) expect(c.info).toMatchObject({ app: 'firesim-desktop-host', protocol: 2, name: 'Test desk', maxSessions: 4, node: process.versions.node });
    expect(a.info.sessions).toBe(1);
    expect(b.info.sessions).toBe(2);
  });

  it('a page that detects and then connects asks /__firesim/host once in all', async () => {
    const { base } = await host();
    const spy = vi.spyOn(globalThis, 'fetch');
    const probe = await detectHost({ base });
    open.push(await connectRemote({ base, code: CODE, probe: probe! }));
    expect(infoRequests(spy)).toBe(1);
  });

  it('refuses a probe of another version of the link before it opens a socket: a RemoteVersionError with both numbers', async () => {
    const { h, base } = await host();
    let sockets = 0;
    class Counting extends WebSocket {
      constructor(url: string | URL) {
        super(url);
        sockets++;
      }
    }
    const err = await connectRemote({ base, code: CODE, probe: { app: 'firesim-desktop-host', protocol: 3, requiresCode: true }, WebSocketCtor: Counting }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteVersionError);
    expect(err).toMatchObject({ pageProtocol: 2, hostProtocol: 3 });
    expect(sockets).toBe(0);
    expect(h.sessions).toBe(0);
  });

  it('a host of protocol 1 (0.8.0) or 3 that is not asked first still gives a RemoteVersionError: from its welcome, or from its refusal of our hello', async () => {
    // A stand-in for a host of another version, on a real socket: it welcomes in its own protocol, or refuses the hello with 4426.
    const servers: WebSocketServer[] = [];
    const standIn = async (behave: (ws: WsSocket) => void): Promise<string> => {
      const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      servers.push(wss);
      await new Promise((r) => wss.once('listening', r));
      wss.on('connection', (ws) => ws.once('message', () => behave(ws)));
      return `http://127.0.0.1:${(wss.address() as { port: number }).port}`;
    };
    try {
      const v1 = await standIn((ws) => ws.send(JSON.stringify({ type: 'welcome', session: 'a', protocol: 1 })));
      const err1 = await connectRemote({ base: v1, code: CODE }).catch((e: unknown) => e);
      expect(err1).toBeInstanceOf(RemoteVersionError);
      expect(err1).toMatchObject({ pageProtocol: 2, hostProtocol: 1 });
      const v3 = await standIn((ws) => ws.close(4426, 'protocol 3'));
      const err3 = await connectRemote({ base: v3, code: CODE }).catch((e: unknown) => e);
      expect(err3).toBeInstanceOf(RemoteVersionError);
      expect(err3).toMatchObject({ pageProtocol: 2, hostProtocol: 3 });
    } finally {
      for (const w of servers) w.close();
    }
  });

  it("a page of protocol 1 (an old app) is told 4426 with the host's version, and gets no session", async () => {
    const { h, base } = await host();
    const ws = new WsSocket(`${base.replace('http', 'ws')}/__firesim/engine`);
    const closed = new Promise<{ code: number; reason: string }>((r) => ws.on('close', (code, reason) => r({ code, reason: reason.toString() })));
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocol: 1, code: CODE })));
    expect(await closed).toEqual({ code: 4426, reason: 'protocol 2' });
    expect(h.sessions).toBe(0);
  });
});

describe('RemoteConnection.onClosed against the real host', () => {
  it('is told once, with a plain sentence, when the host stops (1001), and the controller still says its error event once', async () => {
    const { h, base } = await host();
    const c = await connect(base);
    const told: string[] = [];
    const errors: string[] = [];
    c.onClosed((r) => told.push(r));
    c.controller.on('error', (m) => errors.push(m));
    await h.close();
    await waitFor(() => told.length > 0, 10000, 'the end of the link');
    await new Promise((r) => setTimeout(r, 200));
    expect(told).toEqual(['The desktop connection closed.']);
    expect(errors).toEqual(['The desktop connection closed.']);
  });

  it("is told the engine's own sentence when the engine fails and the host ends the session with 1011", async () => {
    const { engines, base } = await host();
    const c = await connect(base);
    const told: string[] = [];
    const errors: string[] = [];
    c.onClosed((r) => told.push(r));
    c.controller.on('error', (m) => errors.push(m));
    engines[0]!.events.failed('The simulation engine stopped: boom');
    await waitFor(() => told.length > 0, 10000, 'the end of the link');
    await new Promise((r) => setTimeout(r, 200));
    expect(told).toEqual(['The simulation engine stopped: boom']);
    expect(errors).toEqual(['The simulation engine stopped: boom']);
  });

  it('is told for a session that the host ends with 1011 without a word, and for one it ends with 1008 (too many messages)', async () => {
    const quiet = await host();
    const a = await connect(quiet.base);
    const toldA: string[] = [];
    a.onClosed((r) => toldA.push(r));
    quiet.engines[0]!.events.exited();
    await waitFor(() => toldA.length > 0, 10000, 'the end of the link');
    expect(toldA).toEqual(['The desktop connection closed.']);

    const strict = await host({ messagesPerSecond: 5 });
    const b = await connect(strict.base);
    const toldB: string[] = [];
    b.onClosed((r) => toldB.push(r));
    for (let i = 0; i < 12; i++) b.controller.pause();
    await waitFor(() => toldB.length > 0, 10000, 'the end of the link');
    expect(toldB).toEqual(['The desktop connection closed.']);
  });

  it('is not told of an engine error that the host forwards: it is an error event, and the link goes on', async () => {
    const { engines, base } = await host();
    const c = await connect(base);
    const told: string[] = [];
    const errors: string[] = [];
    c.onClosed((r) => told.push(r));
    c.controller.on('error', (m) => errors.push(m));
    engines[0]!.events.frame(encodeMessage({ type: 'error', message: 'Cannot read properties of undefined' }));
    await waitFor(() => errors.length === 1, 10000, 'the error event');
    expect(errors).toEqual(['Cannot read properties of undefined']);
    c.controller.run(30); // the link still carries messages
    await waitFor(() => engines[0]!.frames.length >= 1, 10000, 'the run message');
    await waitFor(() => c.rttMs() !== null, 10000, 'a round trip');
    expect(told).toEqual([]);
  });

  it('is not told when the page closes the connection itself, not then and not when the host later ends the session', async () => {
    const { h, engines, base } = await host();
    const c = await connect(base);
    const told: string[] = [];
    c.onClosed((r) => told.push(r));
    c.close();
    await waitFor(() => h.sessions === 0, 10000, 'the session to end');
    await h.close();
    await new Promise((r) => setTimeout(r, 300));
    expect(told).toEqual([]);
    expect(engines[0]!.terminated).toBe(1);
  });

  it('lets a listener be taken off, and tells one that comes after the end at once', async () => {
    const { h, base } = await host();
    const c = await connect(base);
    const never: string[] = [];
    const off = c.onClosed((r) => never.push(r));
    off();
    const told: string[] = [];
    c.onClosed((r) => told.push(r));
    await h.close();
    await waitFor(() => told.length > 0, 10000, 'the end of the link');
    expect(never).toEqual([]);
    const late: string[] = [];
    c.onClosed((r) => late.push(r));
    await Promise.resolve();
    expect(late).toEqual(['The desktop connection closed.']);
  });
});
