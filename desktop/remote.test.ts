/**
 * What the page sees of the host through connectRemote (lane J2's interface): the one request for the host's info (a given `info`
 * means no request), and `onClosed`, told once when the link ends for any reason of its own. Against the real host (an engine that
 * runs nothing: the simulation is in engine.test.ts) over a real WebSocket, the one Node ships.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectRemote, type RemoteConnection } from '../src/sim/remote';
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

describe('connectRemote and the host info', () => {
  it('makes no request for it when it is given (the page has it from detectHost), and the connection carries that very info', async () => {
    const { base } = await host();
    const info = await detectHost({ base });
    expect(info).not.toBeNull();
    const spy = vi.spyOn(globalThis, 'fetch');
    const c = await connectRemote({ base, code: CODE, info: info! });
    open.push(c);
    expect(infoRequests(spy)).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(c.info).toBe(info);
  });

  it('asks once when it is not given, as before', async () => {
    const { base } = await host();
    const spy = vi.spyOn(globalThis, 'fetch');
    const c = await connect(base);
    expect(infoRequests(spy)).toBe(1);
    expect(c.info).toMatchObject({ app: 'firesim-desktop-host', name: 'Test desk', maxSessions: 4 });
  });

  it('a page that detects and then connects with the info it has asks /__firesim/host once in all', async () => {
    const { base } = await host();
    const spy = vi.spyOn(globalThis, 'fetch');
    const info = await detectHost({ base });
    open.push(await connectRemote({ base, code: CODE, info: info! }));
    expect(infoRequests(spy)).toBe(1);
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
