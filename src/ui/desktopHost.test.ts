import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimController, SimEvents } from '../sim/protocol';
import { CodeRefused, codeFromHash, DETECT_TIMEOUT_MS, hashWithoutCode, isHostProbe, normaliseCode, startDesktopHost, TYPED_DETECT_TIMEOUT_MS, VersionMismatch, versionNumbers, type HostEnv } from './desktopHost';
import type { DesktopLink, DesktopRun, HostInfo, HostProbe } from './desktopTypes';
import type { SwitchableController } from './runController';

const INFO: HostInfo = { app: 'firesim-desktop-host', protocol: 2, name: 'Studio PC', cores: 8, node: 'v22.11.0', sessions: 0, maxSessions: 3 };
/** What a protocol 2 host says to anyone, before its code: the name and the cores wait for the welcome. */
const PROBE: HostProbe = { app: 'firesim-desktop-host', protocol: 2, requiresCode: true };
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
    dispose: () => undefined,
    listeners: () => errors.size,
  } as unknown as SimController & { emit(message: string): void; listeners(): number };
}

type FakeLink = DesktopLink & { controller: ReturnType<typeof fakeController>; closed: number; end(reason: string): void };

/** A link: with `onClosed` (the signal of the module, `end(reason)` calls it) or without (an older module: an error of the controller then ends the run). */
function fakeLink(rtt: number | null = 4.2, withOnClosed = false): FakeLink {
  const controller = fakeController();
  const ended = new Set<(reason: string) => void>();
  const link: FakeLink = {
    controller,
    info: INFO,
    rttMs: () => rtt,
    closed: 0,
    close: () => void link.closed++,
    end: (reason) => {
      for (const cb of [...ended]) cb(reason);
      ended.clear();
    },
  };
  if (withOnClosed) link.onClosed = (cb) => (ended.add(cb), () => ended.delete(cb));
  return link;
}

interface Rig {
  env: HostEnv;
  detect: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  replaced: string[];
  runs: (DesktopRun | null)[];
}

function rig(over: Partial<HostEnv> = {}, answer: unknown = PROBE): Rig {
  const replaced: string[] = [];
  const runs: (DesktopRun | null)[] = [];
  const detect = vi.fn(async () => answer as HostProbe | null);
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
  it('needs the right app, protocol 2 and a yes or no for the code; the name and the cores are not part of it any more', () => {
    expect(isHostProbe(PROBE)).toBe(true);
    expect(isHostProbe({ ...PROBE, requiresCode: false })).toBe(true);
    expect(isHostProbe({ ...PROBE, app: 'something-else' })).toBe(false);
    expect(isHostProbe({ ...PROBE, protocol: 1 })).toBe(false); // protocol 1 said the name and the cores to anyone: a page of this version does not take it
    expect(isHostProbe({ ...PROBE, protocol: 3 })).toBe(false);
    expect(isHostProbe({ ...PROBE, requiresCode: 'yes' })).toBe(false);
    expect(isHostProbe({ app: 'firesim-desktop-host', protocol: 2 })).toBe(false);
    expect(isHostProbe(INFO)).toBe(false); // the welcome is not the probe
    expect(isHostProbe(null)).toBe(false);
    expect(isHostProbe('firesim-desktop-host')).toBe(false);
  });
});

describe('detection at start-up', () => {
  it('asks once, of the page own origin only, with the 800 ms the contract names', async () => {
    const r = rig();
    const host = await startDesktopHost(r.env);
    expect(host).not.toBeNull();
    expect(host?.state.get()).toMatchObject({ host: null, typed: false }); // nothing of the host's name or cores before its code
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
    expect(await startDesktopHost(rig({}, { ...PROBE, app: 'an-other-app' }).env)).toBeNull();
    expect(await startDesktopHost(rig({}, { ...PROBE, protocol: 1 }).env)).toBeNull(); // a host of the old protocol is not one this page can use
    expect(await startDesktopHost(rig({}, '<!doctype html>').env)).toBeNull(); // the page itself came back for the question
    const rejects = rig({ detect: () => Promise.reject(new Error('refused')) });
    expect(await startDesktopHost(rejects.env)).toBeNull();
    vi.useFakeTimers();
    const silent = rig({ detect: () => new Promise<HostProbe | null>(() => undefined) });
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
    expect(r.connect).toHaveBeenCalledWith({ base: ORIGIN, code: 'ABCD2345' }); // the page's own origin and the code as the host wants it: protocol 2 has nothing of the start-up check to pass on
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
    expect((host.take() as SwitchableController).inner).toBe(link.controller); // the run holds the link's controller through the switchable one
    const run = r.runs[r.runs.length - 1]!;
    expect(run).toMatchObject({ name: 'Studio PC', cores: 8, node: 'v22.11.0', closed: false });
    expect(run.rttMs()).toBe(12.6);
    // the words the first screen shows come with the run (it carries none of the desktop's words itself)
    expect(run.label).toBe('Running on the desktop');
    expect(run.help).toMatch(/^Tap “Continue on this device”/);
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
    (host.take() as SwitchableController).dispose(); // the session does this when the run is left
    host.release(); // leaving the run
    expect(b.closed).toBe(1);
    expect(b.controller.listeners()).toBe(0);
    expect(r.runs[r.runs.length - 1]).toBeNull();
  });

  it('leave (Continue on this device): the link is closed, the choice goes back to This device, the run is marked, and the run keeps its controller to point elsewhere', async () => {
    const link = fakeLink();
    const { host, r } = await start({ hash: '#code=ABCD2345', connect: vi.fn(async () => link as DesktopLink) });
    await host.beforeBuild();
    const proxy = host.take() as SwitchableController;
    link.controller.emit('The desktop connection closed.');
    expect(host.leave()).toBe(proxy);
    expect(link.closed).toBe(1);
    expect(host.state.get()).toMatchObject({ engine: 'device', problem: null });
    expect(host.take()).toBeNull(); // the page's own choice now gives the in-app engine
    const run = r.runs[r.runs.length - 1]!;
    expect(run).toMatchObject({ name: 'Studio PC', closed: true, restarted: true });
    expect(run.help).toBeUndefined(); // the Insights help for a lost desktop no longer applies
    expect(host.leave()).toBeNull(); // nothing left to leave
  });

  it('leave with no run on the desktop does nothing', async () => {
    const { host, r } = await start({ hash: '#code=ABCD2345' });
    const before = r.runs.length;
    expect(host.leave()).toBeNull();
    expect(host.state.get().engine).toBe('desktop'); // untouched
    expect(r.runs.length).toBe(before);
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
    expect((host.take() as SwitchableController).inner).toBe(b.controller);
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

describe('the end of the link (onClosed), the standby engine and what is warmed', () => {
  const startOn = async (over: Partial<HostEnv> = {}): Promise<{ host: NonNullable<Awaited<ReturnType<typeof startDesktopHost>>>; r: Rig }> => {
    const r = rig({ hash: '#code=ABCD2345', ...over });
    return { host: (await startDesktopHost(r.env))!, r };
  };

  it('with onClosed, an engine error while the link is open is only a message: the run is not closed, the Engine row stays on Desktop; onClosed ends it, with the link\'s sentence', async () => {
    const link = fakeLink(4, true);
    const { host, r } = await startOn({ connect: vi.fn(async () => link as DesktopLink) });
    await host.beforeBuild();
    host.take();
    link.controller.emit('The engine had a problem.');
    expect(r.runs[r.runs.length - 1]).toMatchObject({ closed: false });
    expect(host.state.get().engine).toBe('desktop');
    link.end('The desktop connection closed.');
    expect(r.runs[r.runs.length - 1]).toMatchObject({ closed: true, closedReason: 'The desktop connection closed.' });
    expect(host.state.get().engine).toBe('device');
  });

  it('with onClosed, a link that ended while the model was being built is said at once, with its sentence', async () => {
    const link = fakeLink(4, true);
    const { host } = await startOn({ connect: vi.fn(async () => link as DesktopLink) });
    await host.beforeBuild();
    link.controller.emit('an engine message does not end it');
    expect(() => host.take()).not.toThrow();
    const again = fakeLink(4, true);
    const { host: h2 } = await startOn({ connect: vi.fn(async () => again as DesktopLink) });
    await h2.beforeBuild();
    again.end('The desktop connection closed.');
    expect(() => h2.take()).toThrow('The desktop connection closed.');
    expect(again.closed).toBe(1);
  });

  it('the page closing the link does not call onClosed (nothing marks the run closed by the page\'s own hand)', async () => {
    const link = fakeLink(4, true);
    const { host, r } = await startOn({ connect: vi.fn(async () => link as DesktopLink) });
    await host.beforeBuild();
    host.take();
    host.release();
    link.end('late'); // the listener is gone: nothing happens
    expect(r.runs[r.runs.length - 1]).toBeNull();
  });

  it('without onClosed (an older module) an error of the controller is taken for the end of the link', async () => {
    const link = fakeLink(4, false);
    const { host, r } = await startOn({ connect: vi.fn(async () => link as DesktopLink) });
    await host.beforeBuild();
    host.take();
    link.controller.emit('The desktop connection closed.');
    expect(r.runs[r.runs.length - 1]).toMatchObject({ closed: true, closedReason: 'The desktop connection closed.' });
    expect(host.state.get().engine).toBe('device');
  });

  it('an empty reason becomes the plain sentence', async () => {
    const link = fakeLink(4, true);
    const { host, r } = await startOn({ connect: vi.fn(async () => link as DesktopLink) });
    await host.beforeBuild();
    host.take();
    link.end('');
    expect(r.runs[r.runs.length - 1]!.closedReason).toBe('The desktop connection closed.');
  });

  it('the standby is made when the link opens, once, with the warm-up started; the run\'s controller gets it, idle', async () => {
    const standby = fakeController();
    const made = vi.fn(() => standby);
    const warm = vi.fn();
    const { host } = await startOn({ standby: made, warm });
    expect(made).not.toHaveBeenCalled(); // not before a link is open: This device never needs one
    await host.beforeBuild();
    expect(made).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledTimes(1);
    const proxy = host.take() as SwitchableController;
    expect(proxy.standby).toBe(standby);
    expect(host.proxy()).toBe(proxy);
  });

  it('a link let go before a run took it lets its standby go too (Cancel, or building again)', async () => {
    const first = fakeController();
    const second = fakeController();
    const engines = [first, second];
    const disposed: unknown[] = [];
    for (const e of engines) e.dispose = () => void disposed.push(e);
    const { host } = await startOn({ standby: () => engines.shift() ?? null });
    await host.beforeBuild();
    await host.beforeBuild(); // the first link and its standby go, a second pair is made
    expect(disposed).toEqual([first]);
    host.release(); // Setup shown again
    expect(disposed).toEqual([first, second]);
  });

  it('a standby that reported a failure while the model was being built is not handed to the run (it is finished with)', async () => {
    const standby = fakeController();
    let disposed = 0;
    standby.dispose = () => void disposed++;
    const { host } = await startOn({ standby: () => standby });
    await host.beforeBuild();
    standby.emit('simulation worker failed');
    const proxy = host.take() as SwitchableController;
    expect(proxy.standby).toBeNull();
    expect(disposed).toBe(1);
    expect(standby.listeners()).toBe(0); // nobody listens to it any more
  });

  it('no standby is made on a page without the means, or when making it fails: the run still starts, without one', async () => {
    const { host } = await startOn();
    await host.beforeBuild();
    expect((host.take() as SwitchableController).standby).toBeNull();
    const { host: h2 } = await startOn({
      standby: () => {
        throw new Error('no worker');
      },
    });
    expect(await h2.beforeBuild()).toBe(true);
    expect((h2.take() as SwitchableController).standby).toBeNull();
  });

  it('proxy() is null until a run took the link, and again after Continue on this device gave it up', async () => {
    const { host } = await startOn();
    expect(host.proxy()).toBeNull();
    await host.beforeBuild();
    expect(host.proxy()).toBeNull(); // pending, not taken
    const p = host.take() as SwitchableController;
    expect(host.proxy()).toBe(p);
    expect(host.leave()).toBe(p);
    expect(host.proxy()).toBeNull();
  });

  it('leave marks the run started again only when it is called (the restart calls it once the new engine has started)', async () => {
    const link = fakeLink(4, true);
    const { host, r } = await startOn({ connect: vi.fn(async () => link as DesktopLink) });
    await host.beforeBuild();
    host.take();
    link.end('The desktop connection closed.');
    expect(r.runs[r.runs.length - 1]).toMatchObject({ closed: true });
    expect(r.runs[r.runs.length - 1]!.restarted).toBeUndefined(); // closed is not restarted
    expect(link.closed).toBe(0);
    host.leave();
    expect(r.runs[r.runs.length - 1]).toMatchObject({ restarted: true });
    expect(link.closed).toBe(1);
  });

  it('a code the desktop refuses for a while (rate-limited) has its own words and is kept for the next try; a wrong code is forgotten', async () => {
    const { host, r } = await startOn();
    r.connect.mockRejectedValueOnce(new CodeRefused('rate-limited'));
    expect(await host.beforeBuild()).toBe(false);
    expect(host.state.get()).toMatchObject({ problem: 'rate-limited', hasCode: true, fromLink: true, busy: false });
    expect(await host.beforeBuild()).toBe(true); // the same code goes again, with no retyping
    expect(r.connect).toHaveBeenCalledTimes(2);
    const { host: h2, r: r2 } = await startOn();
    r2.connect.mockRejectedValueOnce(new CodeRefused('wrong-code'));
    expect(await h2.beforeBuild()).toBe(false);
    expect(h2.state.get()).toMatchObject({ problem: 'refused', hasCode: false });
    expect(new CodeRefused().reason).toBe('wrong-code');
  });
});

describe('the second step of the chip: the desktop says who it is in its welcome, not before', () => {
  it('no name and no cores before a link has been opened; after the welcome the view has them, cleaned, and they stay for the page load', async () => {
    const r = rig({ hash: '#code=ABCD2345', connect: vi.fn(async () => ({ ...fakeLink(), info: { ...INFO, name: '  Studio\n PC ', cores: 12 } }) as DesktopLink) });
    const host = (await startDesktopHost(r.env))!;
    expect(host.state.get().host).toBeNull();
    expect(await host.beforeBuild()).toBe(true);
    expect(host.state.get().host).toEqual({ name: 'Studio PC', cores: 12 });
    host.release(); // Setup again: the chip still names the desktop that was met
    expect(host.state.get().host).toEqual({ name: 'Studio PC', cores: 12 });
  });

  it('a refused code tells nothing of the host: the view still has none', async () => {
    const r = rig({ hash: '#code=ABCD2345' });
    r.connect.mockRejectedValueOnce(new CodeRefused());
    const host = (await startDesktopHost(r.env))!;
    await host.beforeBuild();
    expect(host.state.get().host).toBeNull();
  });
});

describe('a version that is not this page\'s', () => {
  it('a mismatch is its own problem with its own words (the two numbers when the error has them), not a refused code and not "could not reach"', async () => {
    const r = rig({ hash: '#code=ABCD2345' });
    r.connect.mockRejectedValueOnce(new VersionMismatch(2, 3));
    const host = (await startDesktopHost(r.env))!;
    expect(await host.beforeBuild()).toBe(false);
    expect(host.state.get()).toMatchObject({ problem: 'version', hasCode: true, busy: false });
    expect(host.state.get().note).toBe('This app and the desktop do not speak the same version of the link (this app speaks version 2, the desktop version 3). Update the app or the desktop host.');
    host.typeCode('WXYZ2345');
    expect(host.state.get()).toMatchObject({ problem: null, note: null });
    r.connect.mockRejectedValueOnce(new VersionMismatch());
    await host.beforeBuild();
    expect(host.state.get().note).toBe('This app and the desktop do not speak the same version of the link. Update the app or the desktop host.');
  });

  it('the two numbers are read from the error under any of the names a module may give them, and only when they are small whole numbers', () => {
    expect(versionNumbers(Object.assign(new Error('x'), { pageProtocol: 2, hostProtocol: 3 }))).toEqual({ page: 2, host: 3 });
    expect(versionNumbers(Object.assign(new Error('x'), { page: 2, host: 1 }))).toEqual({ page: 2, host: 1 });
    expect(versionNumbers(Object.assign(new Error('x'), { expected: 2, actual: 5 }))).toEqual({ page: 2, host: 5 });
    expect(versionNumbers(new Error('x'))).toEqual({ page: null, host: null });
    expect(versionNumbers(Object.assign(new Error('x'), { page: '2', host: 2.5 }))).toEqual({ page: null, host: null });
    expect(versionNumbers(Object.assign(new Error('x'), { page: -1, host: 1e9 }))).toEqual({ page: null, host: null });
    expect(versionNumbers(null)).toEqual({ page: null, host: null });
    expect(versionNumbers('RemoteVersionError')).toEqual({ page: null, host: null });
  });

  it('a desktop with no session to spare is said so, not "could not reach"', async () => {
    const r = rig({ hash: '#code=ABCD2345' });
    r.connect.mockRejectedValueOnce(new Error('The desktop has no free session.'));
    const host = (await startDesktopHost(r.env))!;
    expect(await host.beforeBuild()).toBe(false);
    expect(host.state.get()).toMatchObject({ problem: 'no-session', hasCode: true });
  });
});

describe('a typed address (the Android app, and the test seam)', () => {
  const typedRig = (over: Partial<HostEnv> = {}): Rig => rig({ typed: true, native: true, protocol: 'https:', origin: 'https://localhost', ...over });
  const startTyped = async (over: Partial<HostEnv> = {}): Promise<{ host: NonNullable<Awaited<ReturnType<typeof startDesktopHost>>>; r: Rig }> => {
    const r = typedRig(over);
    return { host: (await startDesktopHost(r.env))!, r };
  };

  it('nothing is asked at start-up: the object is made at once, on This device, with the address remembered and no host name', async () => {
    const { host, r } = await startTyped({ address: '192.168.1.20' });
    expect(host).not.toBeNull();
    expect(r.detect).not.toHaveBeenCalled();
    expect(r.connect).not.toHaveBeenCalled();
    expect(host.state.get()).toMatchObject({ engine: 'device', typed: true, address: '192.168.1.20', host: null, problem: null });
  });

  it('an app that is not typed still gets nothing', async () => {
    expect(await startDesktopHost(rig({ native: true }).env)).toBeNull();
    expect(await startDesktopHost(rig({ typed: false, native: true }).env)).toBeNull();
  });

  it('a code in the address is taken out of the bar and not used (the page has no host of its own to come from)', async () => {
    const r = typedRig({ hash: '#code=ABCD2345' });
    const host = (await startDesktopHost(r.env))!;
    expect(r.replaced).toEqual(['']);
    expect(host.state.get()).toMatchObject({ engine: 'device', hasCode: false, fromLink: false });
  });

  it('Build on Desktop with no address asks for it, with a bad address says which part is wrong; nothing is probed or opened', async () => {
    const { host, r } = await startTyped();
    host.choose('desktop');
    host.typeCode('ABCD2345');
    expect(await host.beforeBuild()).toBe(false);
    expect(host.state.get()).toMatchObject({ problem: 'needs-address', note: null });
    host.typeAddress('ws://192.168.1.20');
    expect(host.state.get().problem).toBeNull(); // typing takes the words away
    expect(await host.beforeBuild()).toBe(false);
    expect(host.state.get()).toMatchObject({ problem: 'bad-address' });
    expect(host.state.get().note).toMatch(/^The address can start with http:\/\/ or https:\/\//);
    host.typeAddress('192.168.1.20/app');
    await host.beforeBuild();
    expect(host.state.get().note).toMatch(/Leave out anything after it/);
    expect(r.detect).not.toHaveBeenCalled();
    expect(r.connect).not.toHaveBeenCalled();
  });

  it('a good address and a code: the address is remembered, probed first (4 s), then the link is opened at that address with the code and nothing else', async () => {
    const saved: string[] = [];
    const link = fakeLink();
    const connect = vi.fn(async (_o: { base: string; code: string }) => link as DesktopLink);
    const { host, r } = await startTyped({ saveAddress: (t) => void saved.push(t), connect });
    host.choose('desktop');
    host.typeAddress('  Desk.local ');
    host.typeCode('ab cd-2345');
    expect(await host.beforeBuild()).toBe(true);
    expect(saved).toEqual(['Desk.local']); // trimmed, as typed: the preferences get the address and nothing else
    expect(r.detect).toHaveBeenCalledTimes(1);
    expect(r.detect).toHaveBeenCalledWith({ base: 'http://desk.local:4300', timeoutMs: TYPED_DETECT_TIMEOUT_MS });
    expect(connect.mock.calls).toEqual([[{ base: 'http://desk.local:4300', code: 'ABCD2345' }]]);
    expect(JSON.stringify(saved)).not.toContain('ABCD2345');
    expect(host.state.get().host).toEqual({ name: 'Studio PC', cores: 8 });
    expect((host.take() as SwitchableController).inner).toBe(link.controller);
  });

  it('nothing answers at the address: "no answer", the code is not sent anywhere and is kept for the next try', async () => {
    const { host, r } = await startTyped();
    r.detect.mockResolvedValueOnce(null);
    host.choose('desktop');
    host.typeAddress('192.168.1.20');
    host.typeCode('ABCD2345');
    expect(await host.beforeBuild()).toBe(false);
    expect(host.state.get()).toMatchObject({ problem: 'no-answer', hasCode: true, busy: false });
    expect(r.connect).not.toHaveBeenCalled();
  });

  it('something is there but will not let this page read it: "not allowed", not "no answer" (told apart by reach)', async () => {
    const reach = vi.fn(async () => true);
    const { host, r } = await startTyped({ reach });
    r.detect.mockResolvedValueOnce(null);
    host.choose('desktop');
    host.typeAddress('192.168.1.20:4301');
    host.typeCode('ABCD2345');
    expect(await host.beforeBuild()).toBe(false);
    expect(reach).toHaveBeenCalledWith('http://192.168.1.20:4301');
    expect(host.state.get().problem).toBe('not-allowed');
    expect(r.connect).not.toHaveBeenCalled();
    // a reach that throws is "not there"
    const { host: h2, r: r2 } = await startTyped({
      reach: async () => {
        throw new Error('boom');
      },
    });
    r2.detect.mockResolvedValueOnce(null);
    h2.choose('desktop');
    h2.typeAddress('192.168.1.20');
    h2.typeCode('ABCD2345');
    await h2.beforeBuild();
    expect(h2.state.get().problem).toBe('no-answer');
  });

  it('a desktop that answered the probe but then refuses the link is "not allowed" (the app\'s origin is not on its list); a wrong code and a version mismatch keep their own words', async () => {
    const { host, r } = await startTyped();
    host.choose('desktop');
    host.typeAddress('192.168.1.20');
    host.typeCode('ABCD2345');
    r.connect.mockRejectedValueOnce(new Error('Could not reach the desktop.'));
    expect(await host.beforeBuild()).toBe(false);
    expect(host.state.get().problem).toBe('not-allowed');
    r.connect.mockRejectedValueOnce(new CodeRefused());
    await host.beforeBuild();
    expect(host.state.get()).toMatchObject({ problem: 'refused', hasCode: false });
    host.typeCode('ABCD2345');
    r.connect.mockRejectedValueOnce(new VersionMismatch(2, 1));
    await host.beforeBuild();
    expect(host.state.get().problem).toBe('version');
  });

  it('the code box is not a link\'s: a typed page always asks for the code, and it is never held in the state', async () => {
    const { host } = await startTyped();
    host.choose('desktop');
    host.typeCode('ABCD2345');
    expect(host.typedCode()).toBe('ABCD2345');
    expect(JSON.stringify(host.state.get())).not.toContain('ABCD2345');
  });

  it('a typed page asks for no site to be kept (desktop.ts gives it no keeper): the app\'s files are its own', async () => {
    const keepSite = vi.fn();
    const { host } = await startTyped({ keepSite });
    host.choose('desktop');
    host.site('katoomba');
    host.typeAddress('192.168.1.20');
    host.typeCode('ABCD2345');
    expect(await host.beforeBuild('katoomba')).toBe(true);
    expect(keepSite).not.toHaveBeenCalled();
  });
});

describe('the demo site kept for the day the host dies at the start', () => {
  const startOn = async (over: Partial<HostEnv> = {}): Promise<{ host: NonNullable<Awaited<ReturnType<typeof startDesktopHost>>>; r: Rig }> => {
    const r = rig({ hash: '#code=ABCD2345', ...over });
    return { host: (await startDesktopHost(r.env))!, r };
  };

  it('while Desktop is chosen the site Setup would build is kept; a site chosen later replaces it', async () => {
    const keepSite = vi.fn();
    const { host } = await startOn({ keepSite });
    // preselected by the link, so the row (which tells the page the site when it is mounted) keeps it at once
    host.site('katoomba');
    expect(keepSite.mock.calls).toEqual([['katoomba']]);
    host.site('katoomba'); // the same site again: nothing to do
    expect(keepSite).toHaveBeenCalledTimes(1);
    host.site('thredbo');
    expect(keepSite.mock.calls).toEqual([['katoomba'], ['thredbo']]);
    host.site(null); // not a demo site (or none): the kept one is let go
    expect(keepSite.mock.calls.at(-1)).toEqual([null]);
  });

  it('on This device nothing is kept; choosing Desktop keeps the site that was named meanwhile', async () => {
    const keepSite = vi.fn();
    const { host } = await startOn({ keepSite, hash: '' });
    host.site('grose');
    expect(keepSite).not.toHaveBeenCalled();
    host.choose('desktop');
    expect(keepSite.mock.calls).toEqual([['grose']]);
  });

  it('choosing This device does not let the files go (the tap on Continue on this device chooses it and builds in the same breath)', async () => {
    const keepSite = vi.fn();
    const { host } = await startOn({ keepSite });
    host.site('katoomba');
    host.choose('device');
    expect(keepSite.mock.calls).toEqual([['katoomba']]);
  });

  it('Build tells the site once more (a top-up if Setup changed it), and the files go when a run has started on the desktop', async () => {
    const keepSite = vi.fn();
    const { host } = await startOn({ keepSite });
    host.site('katoomba');
    expect(await host.beforeBuild('tomah')).toBe(true);
    expect(keepSite.mock.calls).toEqual([['katoomba'], ['tomah']]);
    host.take();
    expect(keepSite.mock.calls.at(-1)).toEqual([null]); // the model is built: the run needs none of it again
    host.site('tomah'); // Setup shown again: kept again
    expect(keepSite.mock.calls.at(-1)).toEqual(['tomah']);
  });

  it('a keeper that throws is no reason to fail', async () => {
    const { host } = await startOn({
      keepSite: () => {
        throw new Error('no memory');
      },
    });
    expect(() => host.site('katoomba')).not.toThrow();
    expect(await host.beforeBuild('katoomba')).toBe(true);
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
