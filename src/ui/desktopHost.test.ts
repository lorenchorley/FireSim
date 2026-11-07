import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimController, SimEvents } from '../sim/protocol';
import { CodeRefused, codeFromHash, DETECT_TIMEOUT_MS, hashWithoutCode, isHostInfo, normaliseCode, startDesktopHost, type HostEnv } from './desktopHost';
import type { DesktopLink, DesktopRun, HostInfo } from './desktopTypes';

const INFO: HostInfo = { app: 'firesim-desktop-host', protocol: 1, name: 'Studio PC', cores: 8, node: 'v22.11.0', sessions: 0, maxSessions: 3 };
const ORIGIN = 'http://192.168.1.20:4300';

/** A controller that is only its event line: the page's desktop object listens to `error` on it and hands it to the run. */
function fakeController(): SimController & { emit(message: string): void; listeners(): number } {
  const errors = new Set<(m: string) => void>();
  return {
    on: ((event: keyof SimEvents, cb: (m: string) => void) => {
      if (event === 'error') errors.add(cb);
      return () => errors.delete(cb);
    }) as SimController['on'],
    emit: (m: string) => errors.forEach((cb) => cb(m)),
    listeners: () => errors.size,
  } as unknown as SimController & { emit(message: string): void; listeners(): number };
}

function fakeLink(rtt: number | null = 4.2): DesktopLink & { controller: ReturnType<typeof fakeController>; closed: number } {
  const controller = fakeController();
  const link = { controller, info: INFO, rttMs: () => rtt, closed: 0, close: () => void link.closed++ };
  return link;
}

interface Rig {
  env: HostEnv;
  detect: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  replaced: string[];
  runs: (DesktopRun | null)[];
}

function rig(over: Partial<HostEnv> = {}, answer: unknown = INFO): Rig {
  const replaced: string[] = [];
  const runs: (DesktopRun | null)[] = [];
  const detect = vi.fn(async () => answer as HostInfo | null);
  const connect = vi.fn(async () => fakeLink() as DesktopLink);
  const env: HostEnv = {
    origin: ORIGIN,
    protocol: 'http:',
    native: false,
    hash: '',
    replaceHash: (h) => void replaced.push(h),
    detect,
    connect,
    publishRun: (r) => void runs.push(r),
    ...over,
  };
  return { env, detect, connect, replaced, runs };
}

afterEach(() => vi.useRealTimers());

describe('the pairing code in the address', () => {
  it('reads #code=, keeps the rest of the fragment, and says what stays in the address bar', () => {
    expect(codeFromHash('#code=ABCD2345')).toBe('ABCD2345');
    expect(codeFromHash('#a=1&code=abcd-2345')).toBe('ABCD2345'); // capitals, no dash (a phone splits a code to read it)
    expect(codeFromHash('')).toBe('');
    expect(codeFromHash('#other=1')).toBe('');
    expect(hashWithoutCode('#code=ABCD2345')).toBe('');
    expect(hashWithoutCode('#a=1&code=ABCD2345')).toBe('#a=1');
    expect(hashWithoutCode('#other=1')).toBe('#other=1');
    expect(normaliseCode(' ab cd-23 45 ')).toBe('ABCD2345');
  });
});

describe('what the page believes of a host', () => {
  it('needs the right app and protocol, a name, a node version and at least one core', () => {
    expect(isHostInfo(INFO)).toBe(true);
    expect(isHostInfo({ ...INFO, app: 'something-else' })).toBe(false);
    expect(isHostInfo({ ...INFO, protocol: 2 })).toBe(false);
    expect(isHostInfo({ ...INFO, cores: 0 })).toBe(false);
    expect(isHostInfo({ ...INFO, cores: Number.NaN })).toBe(false);
    expect(isHostInfo({ ...INFO, name: 7 })).toBe(false);
    expect(isHostInfo({ ...INFO, node: undefined })).toBe(false);
    expect(isHostInfo(null)).toBe(false);
    expect(isHostInfo('firesim-desktop-host')).toBe(false);
  });
});

describe('detection at start-up', () => {
  it('asks once, of the page own origin only, with the 800 ms the contract names', async () => {
    const r = rig();
    const host = await startDesktopHost(r.env);
    expect(host?.info).toEqual(INFO);
    expect(r.detect).toHaveBeenCalledTimes(1);
    expect(r.detect).toHaveBeenCalledWith({ base: ORIGIN, timeoutMs: 800 });
    expect(DETECT_TIMEOUT_MS).toBe(800);
  });

  it('never asks inside the Capacitor app, nor on a page that is not http or https', async () => {
    for (const over of [{ native: true }, { protocol: 'file:' }, { protocol: 'capacitor:' }, { protocol: 'blob:' }] as Partial<HostEnv>[]) {
      const r = rig(over);
      expect(await startDesktopHost(r.env)).toBeNull();
      expect(r.detect).not.toHaveBeenCalled();
      expect(r.connect).not.toHaveBeenCalled();
    }
    // https is a page too (a desktop host behind a proxy)
    const r = rig({ protocol: 'https:', origin: 'https://sim.example' });
    expect(await startDesktopHost(r.env)).not.toBeNull();
    expect(r.detect).toHaveBeenCalledWith({ base: 'https://sim.example', timeoutMs: 800 });
  });

  it('no host: a null answer, an answer of another app, a rejected call, a call that never answers (no host shows anywhere)', async () => {
    expect(await startDesktopHost(rig({}, null).env)).toBeNull();
    expect(await startDesktopHost(rig({}, { ...INFO, app: 'an-other-app' }).env)).toBeNull();
    expect(await startDesktopHost(rig({}, '<!doctype html>').env)).toBeNull(); // the page itself came back for the question
    const rejects = rig({ detect: () => Promise.reject(new Error('refused')) });
    expect(await startDesktopHost(rejects.env)).toBeNull();
    vi.useFakeTimers();
    const silent = rig({ detect: () => new Promise<HostInfo | null>(() => undefined) });
    const done = startDesktopHost(silent.env);
    await vi.advanceTimersByTimeAsync(1400);
    let settled = false;
    void done.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false); // still inside the guard
    await vi.advanceTimersByTimeAsync(200);
    expect(await done).toBeNull();
  });

  it('the code leaves the address at once, with or without a host, on the app and off it', async () => {
    for (const over of [{}, { native: true }, { protocol: 'file:' }] as Partial<HostEnv>[]) {
      const r = rig({ ...over, hash: '#code=ABCD2345' });
      await startDesktopHost(r.env);
      expect(r.replaced).toEqual(['']);
    }
    const none = rig({ hash: '' });
    await startDesktopHost(none.env);
    expect(none.replaced).toEqual([]); // no code, no change of the address
    const other = rig({ hash: '#a=1&code=ABCD2345' });
    await startDesktopHost(other.env);
    expect(other.replaced).toEqual(['#a=1']);
    const missing = rig({ hash: '#code=ABCD2345' }, null);
    await startDesktopHost(missing.env);
    expect(missing.replaced).toEqual(['']);
  });

  it('Desktop is preselected only when a code came with the address', async () => {
    const withCode = await startDesktopHost(rig({ hash: '#code=ABCD2345' }).env);
    expect(withCode?.state.get()).toMatchObject({ engine: 'desktop', hasCode: true, fromLink: true, busy: false, problem: null });
    const without = await startDesktopHost(rig().env);
    expect(without?.state.get()).toMatchObject({ engine: 'device', hasCode: false, fromLink: false });
    const empty = await startDesktopHost(rig({ hash: '#code=' }).env);
    expect(empty?.state.get().engine).toBe('device');
  });
});

describe('choosing the engine and starting the run', () => {
  const start = async (over: Partial<HostEnv> = {}): Promise<{ host: NonNullable<Awaited<ReturnType<typeof startDesktopHost>>>; r: Rig }> => {
    const r = rig(over);
    const host = await startDesktopHost(r.env);
    return { host: host!, r };
  };

  it('This device: Build goes on, nothing is opened, and the controller is left to the app', async () => {
    const { host, r } = await start();
    expect(await host.beforeBuild()).toBe(true);
    expect(r.connect).not.toHaveBeenCalled();
    expect(host.take()).toBeNull();
  });

  it('Desktop without a code: nothing is opened, the row is asked to say so, and a typed code is kept in memory only', async () => {
    const { host, r } = await start();
    host.choose('desktop');
    expect(await host.beforeBuild()).toBe(false);
    expect(r.connect).not.toHaveBeenCalled();
    expect(host.state.get().problem).toBe('needs-code');
    host.typeCode('ab cd-2345');
    expect(host.state.get()).toMatchObject({ hasCode: true, fromLink: false, problem: null });
    expect(host.typedCode()).toBe('ABCD2345');
    expect(await host.beforeBuild()).toBe(true);
    expect(r.connect).toHaveBeenCalledTimes(1);
    expect(r.connect).toHaveBeenCalledWith({ base: ORIGIN, code: 'ABCD2345' }); // the page's own origin, the code as the host wants it
  });

  it('a code from the address is used but never shown back, and never held in the state the row reads', async () => {
    const { host, r } = await start({ hash: '#code=ABCD2345' });
    expect(host.typedCode()).toBe('');
    expect(JSON.stringify(host.state.get())).not.toContain('ABCD2345');
    expect(await host.beforeBuild()).toBe(true);
    expect(r.connect).toHaveBeenCalledWith({ base: ORIGIN, code: 'ABCD2345' });
    expect(JSON.stringify(r.runs)).not.toContain('ABCD2345');
  });

  it('a wrong code: Build stays on Setup, the code is forgotten, the box is asked for and the words say it was refused', async () => {
    const { host, r } = await start({ hash: '#code=ABCD2345' });
    r.connect.mockRejectedValueOnce(new CodeRefused());
    expect(await host.beforeBuild()).toBe(false);
    expect(host.state.get()).toMatchObject({ engine: 'desktop', problem: 'refused', hasCode: false, fromLink: false, busy: false });
    expect(host.typedCode()).toBe('');
    // the next Build with no new code does not try the old one again
    expect(await host.beforeBuild()).toBe(false);
    expect(r.connect).toHaveBeenCalledTimes(1);
    expect(host.state.get().problem).toBe('needs-code');
    // typing a new code clears the words
    host.typeCode('WXYZ2345');
    expect(host.state.get().problem).toBeNull();
  });

  it('any other failure is "could not reach", and the code stays for another try', async () => {
    const { host, r } = await start({ hash: '#code=ABCD2345' });
    r.connect.mockRejectedValueOnce(new Error('socket hang up'));
    expect(await host.beforeBuild()).toBe(false);
    expect(host.state.get()).toMatchObject({ problem: 'unreachable', hasCode: true, fromLink: true });
    expect(await host.beforeBuild()).toBe(true);
    expect(r.connect).toHaveBeenCalledTimes(2);
  });

  it('a second Build while the link is being opened does nothing', async () => {
    const { host, r } = await start({ hash: '#code=ABCD2345' });
    let open: (l: DesktopLink) => void = () => undefined;
    r.connect.mockImplementationOnce(() => new Promise<DesktopLink>((res) => (open = res)));
    const first = host.beforeBuild();
    expect(host.state.get().busy).toBe(true);
    expect(await host.beforeBuild()).toBe(false);
    open(fakeLink());
    expect(await first).toBe(true);
    expect(r.connect).toHaveBeenCalledTimes(1);
    expect(host.state.get().busy).toBe(false);
  });

  it('take hands the open link to the run, publishes the run, and the next take has no link', async () => {
    const link = fakeLink(12.6);
    const { host, r } = await start({ hash: '#code=ABCD2345', connect: vi.fn(async () => link as DesktopLink) });
    expect(await host.beforeBuild()).toBe(true);
    expect(host.take()).toBe(link.controller);
    const run = r.runs[r.runs.length - 1]!;
    expect(run).toMatchObject({ name: 'Studio PC', cores: 8, node: 'v22.11.0', closed: false });
    expect(run.rttMs()).toBe(12.6);
    // the words the first screen shows come with the run (it carries none of the desktop's words itself)
    expect(run.label).toBe('Running on the desktop');
    expect(run.help).toMatch(/start a new scenario on This device\.$/);
    expect(() => host.take()).toThrow(/not open/);
  });

  it('Desktop chosen but no link (nothing opened): the run does not start on this device in silence', async () => {
    const { host } = await start({ hash: '#code=ABCD2345' });
    expect(() => host.take()).toThrow(/connection is not open/);
  });

  it('a link that died while the model was being built is said, not hung on', async () => {
    const link = fakeLink();
    const { host } = await start({ hash: '#code=ABCD2345', connect: vi.fn(async () => link as DesktopLink) });
    await host.beforeBuild();
    link.controller.emit('The desktop connection closed.');
    expect(() => host.take()).toThrow('The desktop connection closed.');
    expect(link.closed).toBe(1);
  });

  it('a link that closes during the run marks the run closed, and the next Setup starts on This device', async () => {
    const link = fakeLink();
    const { host, r } = await start({ hash: '#code=ABCD2345', connect: vi.fn(async () => link as DesktopLink) });
    await host.beforeBuild();
    host.take();
    expect(host.state.get().engine).toBe('desktop');
    link.controller.emit('The desktop connection closed.');
    expect(r.runs[r.runs.length - 1]).toMatchObject({ name: 'Studio PC', closed: true });
    expect(host.state.get().engine).toBe('device');
  });

  it('release closes a link nobody took, and the run that ended, and forgets the run', async () => {
    const a = fakeLink();
    const b = fakeLink();
    const links = [a, b];
    const { host, r } = await start({ hash: '#code=ABCD2345', connect: vi.fn(async () => links.shift() as DesktopLink) });
    await host.beforeBuild();
    host.release(); // Cancel on the build screen: Setup is shown again
    expect(a.closed).toBe(1);
    expect(r.runs[r.runs.length - 1]).toBeNull();
    await host.beforeBuild();
    host.take();
    host.release(); // leaving the run
    expect(b.closed).toBe(1);
    expect(b.controller.listeners()).toBe(0);
    expect(r.runs[r.runs.length - 1]).toBeNull();
  });

  it('a Setup shown again does not repeat what the last one said next to the code box', async () => {
    const { host, r } = await start({ hash: '#code=ABCD2345' });
    r.connect.mockRejectedValueOnce(new Error('socket hang up'));
    await host.beforeBuild();
    expect(host.state.get().problem).toBe('unreachable');
    host.release();
    expect(host.state.get().problem).toBeNull();
  });

  it('building again after a Cancel closes the link that was opened for the first try', async () => {
    const a = fakeLink();
    const b = fakeLink();
    const links = [a, b];
    const { host } = await start({ hash: '#code=ABCD2345', connect: vi.fn(async () => links.shift() as DesktopLink) });
    await host.beforeBuild();
    await host.beforeBuild();
    expect(a.closed).toBe(1);
    expect(host.take()).toBe(b.controller);
    // and choosing This device after a link was opened closes it
    const c = fakeLink();
    const { host: h2 } = await start({ hash: '#code=ABCD2345', connect: vi.fn(async () => c as DesktopLink) });
    await h2.beforeBuild();
    h2.choose('device');
    expect(await h2.beforeBuild()).toBe(true);
    expect(c.closed).toBe(1);
    expect(h2.take()).toBeNull();
  });
});

describe('what the desktop engine never does', () => {
  // The code lives in memory for this page load: not in localStorage, sessionStorage, IndexedDB, a cookie or the app's preferences.
  it('writes the code nowhere: its files do not touch any storage', () => {
    const files = ['desktop.ts', 'desktopHost.ts', 'desktopSlot.ts', 'desktopTypes.ts', 'desktopWords.ts', 'screens/engineRow.ts'];
    for (const f of files) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|setPref|getPref|Preferences|console\.(log|info|warn|error|debug)/);
    }
  });
});
