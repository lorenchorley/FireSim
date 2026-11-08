/**
 * detectHost (contract 0.8.0 J, 3.5; the probe of protocol 2 since 0.9.0): the one request, the type check of the answer (three
 * fields: the host says no more before the code), null on every failure and mismatch, and the 800 ms default timeout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectHost, type RemoteHostProbe } from './detect';

const INFO: RemoteHostProbe = { app: 'firesim-desktop-host', protocol: 2, requiresCode: true };

const answer = (body: unknown, init: { status?: number } = {}): Response => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: init.status ?? 200 });

afterEach(() => vi.useRealTimers());

describe('detectHost', () => {
  it('returns the probe of a FireSim desktop host, asking only /__firesim/host of the base, without caches and without following a redirect (which could lead to another origin)', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return answer(INFO);
    }) as unknown as typeof fetch;
    expect(await detectHost({ base: 'http://192.168.1.20:4300', fetchFn })).toEqual(INFO);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('http://192.168.1.20:4300/__firesim/host');
    expect(calls[0]![1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
  });

  it('keeps the path of a base (a reverse proxy), and takes the page origin when there is no base', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return answer(INFO);
    }) as unknown as typeof fetch;
    await detectHost({ base: 'https://desk.example/firesim/', fetchFn });
    await detectHost({ base: 'https://desk.example/firesim', fetchFn });
    expect(urls).toEqual(['https://desk.example/firesim/__firesim/host', 'https://desk.example/firesim/__firesim/host']);
    vi.stubGlobal('location', { origin: 'http://localhost:4300' });
    try {
      await detectHost({ fetchFn });
      expect(urls[2]).toBe('http://localhost:4300/__firesim/host');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is null for everything that is not the answer of a FireSim desktop host', async () => {
    const wrong: [string, () => Response][] = [
      ['a 404', () => answer('nope', { status: 404 })],
      ['a 500', () => answer(INFO, { status: 500 })],
      ['not JSON', () => answer('<html>hello</html>')],
      ['an empty body', () => answer('')],
      ['null', () => answer('null')],
      ['an array', () => answer([INFO])],
      ['a string', () => answer('"firesim-desktop-host"')],
      ['another app', () => answer({ ...INFO, app: 'something-else' })],
      ['protocol as text', () => answer({ ...INFO, protocol: '2' })],
      ['a fractional protocol', () => answer({ ...INFO, protocol: 2.5 })],
      ['protocol 0', () => answer({ ...INFO, protocol: 0 })],
      ['no protocol', () => answer({ ...INFO, protocol: undefined })],
      ['no requiresCode (a host of protocol 1 had none)', () => answer({ app: 'firesim-desktop-host', protocol: 1, name: 'Desk', cores: 8, node: '22.22.0', sessions: 0, maxSessions: 3 })],
      ['requiresCode as text', () => answer({ ...INFO, requiresCode: 'true' })],
    ];
    for (const [what, make] of wrong) expect(await detectHost({ base: 'http://h:1', fetchFn: (async () => make()) as unknown as typeof fetch }), what).toBeNull();
  });

  it('says which version the host speaks, whatever it is: it is connectRemote that refuses another one (a RemoteVersionError), so the page can say "update" and not "no desktop"', async () => {
    for (const protocol of [1, 3, 99]) expect(await detectHost({ base: 'http://h:1', fetchFn: (async () => answer({ ...INFO, protocol })) as unknown as typeof fetch })).toEqual({ app: 'firesim-desktop-host', protocol, requiresCode: true });
  });

  it('keeps the three fields and drops whatever else an answer carries (a name, cores and the like are for after the code)', async () => {
    const full = { ...INFO, name: 'Studio PC', cores: 16, node: '22.22.0', sessions: 1, maxSessions: 3, secret: 'x' };
    expect(await detectHost({ base: 'http://h:1', fetchFn: (async () => answer(full)) as unknown as typeof fetch })).toEqual(INFO);
  });

  it('is null when the request fails (a refused connection, a redirect, a thrown error) and never throws', async () => {
    for (const fetchFn of [
      (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
      (() => {
        throw new Error('synchronous');
      }) as unknown as typeof fetch,
      (async () => Promise.reject(undefined)) as unknown as typeof fetch,
    ]) {
      expect(await detectHost({ base: 'http://h:1', fetchFn })).toBeNull();
    }
  });

  it('is null with no answer within 800 ms by default, and within the time given', async () => {
    vi.useFakeTimers();
    const hang = (() => new Promise(() => undefined)) as unknown as typeof fetch;
    let settled = false;
    const p = detectHost({ base: 'http://h:1', fetchFn: hang }).then((v) => {
      settled = true;
      return v;
    });
    await vi.advanceTimersByTimeAsync(799);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBeNull();
    const q = detectHost({ base: 'http://h:1', fetchFn: hang, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(51);
    expect(await q).toBeNull();
  });

  it('aborts the request when it gives up, and an answer that comes too late is nothing', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let release!: (r: Response) => void;
    const slow = ((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((r) => (release = r));
    }) as unknown as typeof fetch;
    const p = detectHost({ base: 'http://h:1', fetchFn: slow });
    await vi.advanceTimersByTimeAsync(801);
    expect(await p).toBeNull();
    expect(signal?.aborted).toBe(true);
    release(answer(INFO)); // too late: no effect, no unhandled rejection
    await vi.advanceTimersByTimeAsync(10);
  });

  it('answers as soon as the host does, without waiting out the timeout', async () => {
    vi.useFakeTimers();
    const p = detectHost({ base: 'http://h:1', fetchFn: (async () => answer(INFO)) as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(0);
    expect(await p).toEqual(INFO);
    expect(vi.getTimerCount()).toBe(0); // the timeout is cleared
  });

  it('is null when there is no base and no page, or no fetch', async () => {
    expect(await detectHost({ fetchFn: (async () => answer(INFO)) as unknown as typeof fetch })).toBeNull();
    vi.stubGlobal('fetch', undefined);
    try {
      expect(await detectHost({ base: 'http://h:1' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
