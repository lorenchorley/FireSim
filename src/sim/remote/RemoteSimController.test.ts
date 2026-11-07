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
import { RemoteAuthError, RemoteSimController, type SocketLike } from './RemoteSimController';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  binaryType = 'blob';
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
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
    this.say(JSON.stringify({ type: 'welcome', session: 'abc123', protocol: 1 }));
  }
  hangUp(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
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
    expect(s.sent).toEqual([JSON.stringify({ type: 'hello', protocol: 1, code: 'ABCD2345' })]);
    s.welcome();
    await p;
    expect(c.session).toBe('abc123');
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

  it('rejects a first frame that is not a welcome of this protocol', async () => {
    for (const first of [new ArrayBuffer(8), 'hello', JSON.stringify({ type: 'welcome', protocol: 2, session: 'x' }), JSON.stringify({ type: 'welcome', protocol: 1 })]) {
      const p = new RemoteSimController().connect({ url: URL_, code: 'X', WebSocketCtor: Ctor }).catch((e: unknown) => e);
      const s = FakeSocket.all.at(-1)!;
      s.open();
      s.say(first);
      expect(((await p) as Error).message).toBe('The desktop sent something unexpected.');
      expect(s.closedWith).toBe(1000);
    }
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
    const scenario = { ...syntheticScenario({ extent: 1500, ignitions: [pointIgnition('a', 0, 0, 0, 30)] }), context: EMPTY_CONTEXT };
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
