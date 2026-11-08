/**
 * RemoteSimController on a socket that does what the test says (contract 0.8.0 J, 3.4): the hello and welcome, what a
 * refusal looks like, the 10 s welcome time, the single error event of a lost or damaged link, the round trip, dispose. The
 * real host is in desktop/engine.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CONTEXT } from '../../core/places';
import type { FromWorker, ToWorker } from '../protocol';
import { pointIgnition, syntheticScenario } from '../testing/scenarios';
import { decodeMessage, encodeMessage } from './codec';
import { RemoteAuthError, RemoteSimController, RemoteVersionError, type SocketLike } from './RemoteSimController';
import { TOO_BIG_MESSAGE } from './wire';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  binaryType = 'blob';
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: (string | Uint8Array)[] = [];
  closedWith: number | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string | ArrayBufferView): void {
    this.sent.push(typeof d === 'string' ? d : new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
  }
  close(code?: number): void {
    this.closedWith = code ?? 1005;
    this.readyState = 3;
  }
  // The server's side, driven by the test.
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  say(data: unknown): void {
    this.onmessage?.({ data });
  }
  frame(msg: FromWorker | { type: 'pong'; t: number }): void {
    const f = encodeMessage(msg as FromWorker);
    this.say(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
  }
  welcome(): void {
    this.say(JSON.stringify({ type: 'welcome', session: 'abc123', protocol: 2, name: 'Test desk', cores: 8, node: '22.22.0', sessions: 1, maxSessions: 3 }));
  }
  hangUp(code: number, reason?: string): void {
    this.readyState = 3;
    this.onclose?.({ code, ...(reason !== undefined ? { reason } : {}) });
  }
  /** The binary frames sent so far, decoded. */
  messages(): ToWorker[] {
    return this.sent.filter((s): s is Uint8Array => typeof s !== 'string').map((b) => decodeMessage(b) as ToWorker);
  }
}

const Ctor = FakeSocket as unknown as new (url: string) => SocketLike;
const URL_ = 'ws://desk:4300/__firesim/engine';

/** A controller connected to a fake socket. */
async function connected(): Promise<{ c: RemoteSimController; s: FakeSocket; errors: string[] }> {
  const c = new RemoteSimController();
  const p = c.connect({ url: URL_, code: 'ABCD2345', WebSocketCtor: Ctor });
  const s = FakeSocket.all.at(-1)!;
  s.open();
  s.welcome();
  await p;
  const errors: string[] = [];
  c.on('error', (m) => errors.push(m));
  return { c, s, errors };
}

beforeEach(() => {
  FakeSocket.all = [];
});
afterEach(() => vi.useRealTimers());

describe('connect', () => {
  it('opens the socket, says hello with the code as its first frame (TEXT), and resolves on the welcome; the first ping goes out at once', async () => {
    const c = new RemoteSimController();
    const p = c.connect({ url: URL_, code: 'ABCD2345', WebSocketCtor: Ctor });
    const s = FakeSocket.all[0]!;
    expect(s.url).toBe(URL_);
    expect(s.binaryType).toBe('arraybuffer');
    expect(s.sent).toEqual([]); // nothing before the socket is open
    s.open();
    expect(s.sent).toEqual([JSON.stringify({ type: 'hello', protocol: 2, code: 'ABCD2345' })]);
    s.welcome();
    await p;
    expect(c.session).toBe('abc123');
    expect(c.info).toEqual({ app: 'firesim-desktop-host', protocol: 2, name: 'Test desk', cores: 8, node: '22.22.0', sessions: 1, maxSessions: 3 });
    expect(c.rttMs()).toBeNull();
    expect(s.messages()).toEqual([expect.objectContaining({ type: 'ping' })]);
  });

  it('rejects with RemoteAuthError for a wrong code and for a refused address, with a sentence for a full host and for anything else', async () => {
    const outcome = async (code: number): Promise<unknown> => {
      const p = new RemoteSimController().connect({ url: URL_, code: 'X', WebSocketCtor: Ctor }).catch((e: unknown) => e);
      const s = FakeSocket.all.at(-1)!;
      s.open();
      s.hangUp(code);
      return p;
    };
    const wrong = await outcome(4401);
    expect(wrong).toBeInstanceOf(RemoteAuthError);
    expect(wrong).toMatchObject({ reason: 'wrong-code', message: 'That code was not right.' });
    const limited = await outcome(4429);
    expect(limited).toBeInstanceOf(RemoteAuthError);
    expect(limited).toMatchObject({ reason: 'rate-limited' });
    const full = await outcome(4503);
    expect(full).not.toBeInstanceOf(RemoteAuthError);
    expect((full as Error).message).toBe('The desktop has no free session.');
    for (const code of [1006, 1000, 4400, 1011]) expect(((await outcome(code)) as Error).message, String(code)).toBe('Could not reach the desktop.');
  });

  it('rejects when the socket cannot be made or fails before the welcome, and when there is no WebSocket at all', async () => {
    const c = new RemoteSimController();
    await expect(
      c.connect({
        url: URL_,
        code: 'X',
        WebSocketCtor: class {
          constructor() {
            throw new Error('SecurityError');
          }
        } as unknown as typeof Ctor,
      }),
    ).rejects.toThrow('Could not reach the desktop.');
    const p = new RemoteSimController().connect({ url: URL_, code: 'X', WebSocketCtor: Ctor });
    FakeSocket.all.at(-1)!.onerror?.({});
    await expect(p).rejects.toThrow('Could not reach the desktop.');
    expect(FakeSocket.all.at(-1)!.closedWith).toBe(1000);
    vi.stubGlobal('WebSocket', undefined);
    try {
      await expect(new RemoteSimController().connect({ url: URL_, code: 'X' })).rejects.toThrow('cannot open a WebSocket');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives up after 10 s without a welcome and closes the socket', async () => {
    vi.useFakeTimers();
    const p = new RemoteSimController().connect({ url: URL_, code: 'X', WebSocketCtor: Ctor }).catch((e: unknown) => e);
    const s = FakeSocket.all[0]!;
    s.open();
    await vi.advanceTimersByTimeAsync(9999);
    expect(s.closedWith).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(((await p) as Error).message).toBe('The desktop did not answer.');
    expect(s.closedWith).toBe(1000);
  });

  it('rejects a first frame that is not a welcome of this protocol, with all of what the host is: a welcome without it is something unexpected', async () => {
    const good = { type: 'welcome', protocol: 2, session: 'x', name: 'Desk', cores: 8, node: '22.22.0', sessions: 1, maxSessions: 3 };
    const wrong = (patch: Record<string, unknown>): string => JSON.stringify({ ...good, ...patch });
    for (const first of [new ArrayBuffer(8), 'hello', 'not json', 'null', '[]', JSON.stringify({ type: 'welcome', protocol: 2, session: 'x' }), wrong({ name: 5 }), wrong({ name: undefined }), wrong({ cores: '8' }), wrong({ cores: -1 }), wrong({ sessions: 1.5 }), wrong({ maxSessions: undefined }), wrong({ node: 22 }), wrong({ session: 7 }), wrong({ protocol: '2' }), wrong({ protocol: undefined }), wrong({ type: 'hello' })]) {
      const p = new RemoteSimController().connect({ url: URL_, code: 'X', WebSocketCtor: Ctor }).catch((e: unknown) => e);
      const s = FakeSocket.all.at(-1)!;
      s.open();
      s.say(first);
      const err = (await p) as Error;
      expect(err.message, String(first)).toBe('The desktop sent something unexpected.');
      expect(err).not.toBeInstanceOf(RemoteVersionError);
      expect(s.closedWith).toBe(1000);
    }
  });

  it('keeps the welcome as the host said it, cut to a sane length (a name of 64 characters at most)', async () => {
    const c = new RemoteSimController();
    const p = c.connect({ url: URL_, code: 'X', WebSocketCtor: Ctor });
    const s = FakeSocket.all.at(-1)!;
    s.open();
    s.say(JSON.stringify({ type: 'welcome', protocol: 2, session: 's', name: 'N'.repeat(500), cores: 4, node: '22.0.0', sessions: 0, maxSessions: 1, extra: 'ignored' }));
    await p;
    expect(c.info!.name).toBe('N'.repeat(64));
    expect(Object.keys(c.info!).sort()).toEqual(['app', 'cores', 'maxSessions', 'name', 'node', 'protocol', 'sessions']);
  });

  it('a welcome of another version of the link is a RemoteVersionError with both numbers, and the socket is let go', async () => {
    for (const hostVersion of [1, 3, 99]) {
      const p = new RemoteSimController().connect({ url: URL_, code: 'X', WebSocketCtor: Ctor }).catch((e: unknown) => e);
      const s = FakeSocket.all.at(-1)!;
      s.open();
      s.say(JSON.stringify({ type: 'welcome', session: 'x', protocol: hostVersion }));
      const err = (await p) as RemoteVersionError;
      expect(err).toBeInstanceOf(RemoteVersionError);
      expect(err).toMatchObject({ pageProtocol: 2, hostProtocol: hostVersion, name: 'RemoteVersionError' });
      expect(err.message).toBe(`The app and the desktop host do not speak the same version of the link (the app 2, the host ${hostVersion}). Update the app or the host.`);
      expect(s.closedWith).toBe(1000);
    }
  });

  it('a host that refuses the hello for its version (4426) says its own in the close reason: a RemoteVersionError, and not a wrong code', async () => {
    const outcome = async (code: number, reason?: string): Promise<unknown> => {
      const p = new RemoteSimController().connect({ url: URL_, code: 'X', WebSocketCtor: Ctor }).catch((e: unknown) => e);
      const s = FakeSocket.all.at(-1)!;
      s.open();
      s.hangUp(code, reason);
      return p;
    };
    const old = await outcome(4426, 'protocol 3');
    expect(old).toBeInstanceOf(RemoteVersionError);
    expect(old).not.toBeInstanceOf(RemoteAuthError);
    expect(old).toMatchObject({ pageProtocol: 2, hostProtocol: 3 });
    // a close that does not say it, or says something else, is nothing the page can word as a version
    for (const reason of [undefined, '', 'protocol', 'protocol x', 'protocol 99999', 'protocol 3 and more', 'wrong code']) expect(((await outcome(4426, reason)) as Error).message, String(reason)).toBe('Could not reach the desktop.');
    expect(await outcome(4400, 'protocol 3')).not.toBeInstanceOf(RemoteVersionError);
  });
});

describe('after the welcome', () => {
  it('speaks the worker protocol: messages out as codec frames (the init without the places context), events in', async () => {
    const { c, s } = await connected();
    const events: string[] = [];
    c.on('ready', () => events.push('ready'));
    c.on('snapshot', (x) => events.push(`snapshot ${x.time}`));
    c.on('status', (x) => events.push(`status ${x.time} ${x.running}`));
    c.on('rewound', (t) => events.push(`rewound ${t}`));
    const base = syntheticScenario({ extent: 1500, ignitions: [pointIgnition('a', 0, 0, 0, 30)] });
    const scenario = { ...base, context: { ...EMPTY_CONTEXT(base.origin), homes: new Float32Array(1000) } };
    const ready = c.init(scenario);
    c.run(600);
    c.pause();
    c.ignite(pointIgnition('b', 5, 5, 10, 20));
    c.rewind(60);
    c.setOption('maxStepS', 3);
    c.setQuality('high');
    c.removeEdit('e');
    c.removeIgnition('b');
    const asked = c.explain(1, 2, 30);
    const sent = s.messages();
    expect(sent.map((m) => m.type)).toEqual(['ping', 'init', 'run', 'pause', 'ignite', 'rewind', 'setOption', 'setQuality', 'removeEdit', 'removeIgnition', 'explain']);
    const init = sent[1] as Extract<ToWorker, { type: 'init' }>;
    expect(init.scenario.id).toBe(scenario.id);
    expect(init.scenario.context).toBeUndefined();
    expect(sent[10]).toEqual({ type: 'explain', x: 1, y: 2, reqId: 1, time: 30 });
    s.frame({ type: 'ready', forecastInsights: [] });
    await expect(ready).resolves.toEqual([]);
    s.frame({ type: 'status', time: 5, running: true, speed: 100 });
    s.frame({ type: 'rewound', time: 60 });
    s.frame({ type: 'explain', reqId: 1, explanation: { narrative: 'because' } as never });
    await expect(asked).resolves.toMatchObject({ narrative: 'because' });
    expect(events).toEqual(['ready', 'status 5 true', 'rewound 60']);
  });

  it('measures the round trip with a ping every 5 s', async () => {
    vi.useFakeTimers();
    const clock = vi.spyOn(performance, 'now');
    clock.mockReturnValue(1000);
    const { c, s } = await connected();
    const first = s.messages().find((m) => m.type === ('ping' as never)) as unknown as { t: number };
    expect(first.t).toBe(1000);
    clock.mockReturnValue(1012.5);
    s.frame({ type: 'pong', t: 1000 });
    expect(c.rttMs()).toBe(12.5);
    clock.mockReturnValue(6000);
    await vi.advanceTimersByTimeAsync(5000);
    const pings = s.messages().filter((m) => (m.type as string) === 'ping') as unknown as { t: number }[];
    expect(pings.map((p) => p.t)).toEqual([1000, 6000]);
    clock.mockReturnValue(6003);
    s.frame({ type: 'pong', t: 6000 });
    expect(c.rttMs()).toBe(3);
    c.dispose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.messages().filter((m) => (m.type as string) === 'ping')).toHaveLength(2); // no ping after dispose
    clock.mockRestore();
  });

  it('a closed link is one plain error event, waiting calls reject with it, and the controller is disposed', async () => {
    const { c, s, errors } = await connected();
    const ready = c.init(syntheticScenario({ extent: 1500 }));
    const asked = c.explain(0, 0);
    ready.catch(() => undefined);
    asked.catch(() => undefined);
    s.hangUp(1006);
    expect(errors).toEqual(['The desktop connection closed.']);
    await expect(ready).rejects.toThrow('The desktop connection closed.');
    await expect(asked).rejects.toThrow('The desktop connection closed.');
    const before = s.sent.length;
    c.run(10);
    c.dispose();
    expect(s.sent.length).toBe(before);
    expect(errors).toHaveLength(1);
    s.frame({ type: 'status', time: 1, running: true, speed: 1 }); // a late frame of a dead link is ignored
  });

  it('a host that stops (1001) or drops us for a reason of its own gives the same one error', async () => {
    for (const code of [1001, 1006, 4400, 1000]) {
      const { s, errors } = await connected();
      s.hangUp(code);
      expect(errors, String(code)).toEqual(['The desktop connection closed.']);
    }
  });

  it("a session that fails on the host is one error: the host's own sentence, and the close that follows says nothing more", async () => {
    const { s, errors, c } = await connected();
    s.frame({ type: 'error', message: 'The simulation engine stopped: boom' });
    s.hangUp(1011);
    expect(errors).toEqual(['The simulation engine stopped: boom']);
    expect(() => c.run(1)).not.toThrow();
  });

  it("an engine error that does not end the session is passed on and the link stays up", async () => {
    const { s, errors, c } = await connected();
    s.frame({ type: 'error', message: 'Cannot read properties of undefined' });
    expect(errors).toEqual(['Cannot read properties of undefined']);
    expect(s.closedWith).toBeNull();
    const before = s.sent.length;
    c.run(10);
    expect(s.sent.length).toBe(before + 1);
  });

  it('a frame it cannot read is one error and the end of the link', async () => {
    const { s, errors } = await connected();
    s.say(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer);
    expect(errors).toEqual(['The desktop sent a message this page could not read.']);
    expect(s.closedWith).toBe(1000);
  });

  it('ignores what it does not understand (a text frame, a blob) and a ping of the host', async () => {
    const { s, errors } = await connected();
    s.say('{"type":"status"}');
    s.say({ size: 10 });
    s.frame({ type: 'ping', t: 1 } as never);
    expect(errors).toEqual([]);
  });

  it("a scenario the host will not take is an ordinary engine error with the host's sentence: init rejects with it, the link stays up and takes another scenario", async () => {
    const { c, s, errors } = await connected();
    const told: string[] = [];
    c.onClosed((r) => told.push(r));
    const ready = c.init(syntheticScenario({ extent: 1500 }));
    s.frame({ type: 'error', message: TOO_BIG_MESSAGE });
    await expect(ready).rejects.toThrow("This scenario is too big for the desktop's free memory.");
    expect(errors).toEqual(["This scenario is too big for the desktop's free memory."]);
    expect(told).toEqual([]);
    expect(s.closedWith).toBeNull();
    const before = s.sent.length;
    void c.init(syntheticScenario({ extent: 1500 })).catch(() => undefined); // a smaller one, on the same link
    expect(s.sent.length).toBe(before + 1);
  });

  it('dispose closes the socket with 1000, says nothing, and rejects what is waiting', async () => {
    const { c, s, errors } = await connected();
    const ready = c.init(syntheticScenario({ extent: 1500 }));
    ready.catch(() => undefined);
    c.dispose();
    expect(s.closedWith).toBe(1000);
    expect(errors).toEqual([]);
    await expect(ready).rejects.toThrow('disposed');
    c.dispose(); // twice is fine
  });

  it('a send that throws (a scenario the codec cannot carry) is an error event, not an exception on the page', async () => {
    const { c, errors } = await connected();
    const bad = { ...syntheticScenario({ extent: 1500 }), name: new Map() } as never;
    const p = c.init(bad);
    p.catch(() => undefined);
    expect(errors).toEqual(['The desktop connection could not send a message.']);
    await expect(p).rejects.toThrow();
  });
});

describe('onClosed (the end of the link, told once)', () => {
  /** A connected controller with a listener that records what it is told. */
  async function watched(): Promise<{ c: RemoteSimController; s: FakeSocket; errors: string[]; told: string[] }> {
    const { c, s, errors } = await connected();
    const told: string[] = [];
    c.onClosed((r) => told.push(r));
    return { c, s, errors, told };
  }

  it('is told once, with a plain sentence, for a close with any code (the host ending the session with 1011, 1001, 4xxx included), and the controller still says its error event once', async () => {
    for (const code of [1006, 1005, 1000, 1001, 1008, 1011, 4400, 4401, 4429, 4503, 4999]) {
      const { s, errors, told } = await watched();
      s.hangUp(code);
      s.hangUp(code); // a second close event changes nothing
      expect(told, String(code)).toEqual(['The desktop connection closed.']);
      expect(errors, String(code)).toEqual(['The desktop connection closed.']);
    }
  });

  it('is told for a socket that fails after the welcome, and once only when the close follows', async () => {
    const { s, errors, told } = await watched();
    s.onerror?.({});
    expect(told).toEqual(['The desktop connection closed.']);
    s.hangUp(1006);
    expect(told).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("is told the engine's own sentence when the host reports a failure and then closes with 1011, and there is the one error event", async () => {
    const { s, errors, told } = await watched();
    s.frame({ type: 'error', message: 'The simulation engine stopped: boom' });
    expect(told).toEqual([]); // the message alone is not the end of the link
    s.hangUp(1011);
    expect(told).toEqual(['The simulation engine stopped: boom']);
    expect(errors).toEqual(['The simulation engine stopped: boom']);
  });

  it('is not told of an engine error that the host forwards, and is told when the link then ends', async () => {
    const { c, s, errors, told } = await watched();
    s.frame({ type: 'error', message: 'Cannot read properties of undefined' });
    s.frame({ type: 'error', message: 'and again' });
    expect(errors).toEqual(['Cannot read properties of undefined', 'and again']);
    expect(told).toEqual([]);
    expect(s.closedWith).toBeNull();
    c.run(5); // the link works
    expect(s.messages().at(-1)).toEqual({ type: 'run', until: 5 });
    s.hangUp(1006);
    expect(told).toEqual(['The desktop connection closed.']);
  });

  it('is not told when the page lets go (dispose), not then and not when the socket closes afterwards', async () => {
    const { c, s, errors, told } = await watched();
    c.dispose();
    s.hangUp(1000);
    s.onerror?.({});
    expect(told).toEqual([]);
    expect(errors).toEqual([]);
    // and a listener added after dispose is never told either
    const later: string[] = [];
    c.onClosed((r) => later.push(r));
    s.hangUp(1006);
    await Promise.resolve();
    expect(later).toEqual([]);
  });

  it('is told when the host sends something unreadable, and when the controller cannot send', async () => {
    const a = await watched();
    a.s.say(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer);
    expect(a.told).toEqual(['The desktop sent a message this page could not read.']);
    expect(a.s.closedWith).toBe(1000);
    const b = await watched();
    void b.c.init({ ...syntheticScenario({ extent: 1500 }), name: new Map() } as never).catch(() => undefined);
    expect(b.told).toEqual(['The desktop connection could not send a message.']);
  });

  it('tells every listener once, in order, survives a listener that throws, and the unsubscribe takes one off', async () => {
    const { c, s } = await connected();
    const log: string[] = [];
    const off = c.onClosed(() => log.push('removed'));
    c.onClosed(() => {
      throw new Error('a listener that fails');
    });
    c.onClosed((r) => log.push(`a:${r}`));
    c.onClosed((r) => log.push(`b:${r}`));
    off();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    s.hangUp(1006);
    expect(log).toEqual(['a:The desktop connection closed.', 'b:The desktop connection closed.']);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('is told at once (in a microtask) by a listener added after the link ended, unless it is taken off first', async () => {
    const { c, s } = await connected();
    s.hangUp(1001);
    const got: string[] = [];
    c.onClosed((r) => got.push(r));
    const off = c.onClosed((r) => got.push(`never ${r}`));
    off();
    expect(got).toEqual([]);
    await Promise.resolve();
    expect(got).toEqual(['The desktop connection closed.']);
  });

  it('can register from inside the error event of the very failure', async () => {
    const { c, s } = await connected();
    const got: string[] = [];
    c.on('error', () => void c.onClosed((r) => got.push(r)));
    s.hangUp(1006);
    await Promise.resolve();
    expect(got).toEqual(['The desktop connection closed.']);
  });
});
