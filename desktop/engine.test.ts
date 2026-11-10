/**
 * The desktop host with its real engine: a worker thread running SimHost, driven by RemoteSimController over a real
 * WebSocket (contract 0.8.0 J, section 5).
 *
 *  - determinism across the transport: the same scenario and seed through LocalSimController and through host plus
 *    RemoteSimController give the same snapshots, bit for bit (the repository's snapshot hash), at the same simulation times;
 *  - the controller's behaviour against the real host: a wrong code, a full host, a lost link, the engine's errors;
 *  - a worker that is terminated on close (no leak);
 *  - a throughput figure (MB/s and ms for a real scenario upload and a real snapshot), printed and not asserted.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CellExplanation, Insight, ScenarioData, SimSnapshot } from '../src/core/types';
import { LocalSimController, withoutContext } from '../src/sim/client';
import type { SimController } from '../src/sim/protocol';
import { connectRemote, RemoteAuthError, TOO_BIG_MESSAGE, type RemoteConnection } from '../src/sim/remote';
import { decodeMessage, encodeMessage } from '../src/sim/remote/codec';
import { difference } from '../src/sim/testing/compare';
import { snapshotHash } from '../src/sim/testing/hash';
import { demoScenario, pointIgnition, syntheticScenario, withIgnitions } from '../src/sim/testing/scenarios';
import { Simulation } from '../src/sim/simulation';
import { workerEngines } from './engine';
import { MIB } from './memoryBound';
import { startHost, type HostHandle } from './server';
import { estimateSessionBytes, sizeOfScenario } from './sessionEstimate';
import { buildForTests, fakeEngines, hello, openClient, waitFor, welcomeOf } from './testHelpers';

const CODE = 'KATOOMBA';
const log = (s: string): void => {
  process.stderr.write(`[desktop perf] ${s}\n`);
};

let work: string;
let built: Awaited<ReturnType<typeof buildForTests>>;
let workerFile: URL;
const hosts: HostHandle[] = [];
const open: RemoteConnection[] = [];

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'firesim-engine-'));
  writeFileSync(join(work, 'index.html'), '<!doctype html><title>FireSim</title>');
  built = await buildForTests();
  workerFile = pathToFileURL(join(built.dir, 'engineWorker.mjs'));
}, 120_000);

afterEach(async () => {
  for (const c of open.splice(0)) c.close();
  for (const h of hosts.splice(0)) await h.close();
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  built.remove();
});

async function realHost(extra: { maxSessions?: number; highWaterBytes?: number; lowWaterBytes?: number; maxSessionBytes?: number; logs?: string[] } = {}): Promise<HostHandle> {
  const h = await startHost({
    ...(extra.highWaterBytes !== undefined ? { highWaterBytes: extra.highWaterBytes } : {}),
    ...(extra.lowWaterBytes !== undefined ? { lowWaterBytes: extra.lowWaterBytes } : {}),
    distDir: work,
    port: 0,
    bind: '127.0.0.1',
    code: CODE,
    name: 'Test desk',
    maxSessions: extra.maxSessions ?? 2,
    // Every snapshot is sent (no wall-clock coalescing), so that the times are the same as an in-thread run's.
    engines: workerEngines(workerFile, { simulation: { minSnapshotWallMs: 0 }, ...(extra.maxSessionBytes !== undefined ? { maxSessionBytes: extra.maxSessionBytes } : {}) }),
    log: (l) => void extra.logs?.push(l),
  });
  hosts.push(h);
  return h;
}

async function connect(h: HostHandle): Promise<RemoteConnection> {
  const c = await connectRemote({ base: `http://127.0.0.1:${h.port}`, code: CODE });
  open.push(c);
  return c;
}

interface Trace {
  /** Every event but 'status', in the order it came: kind, simulation time, the snapshot's hash. */
  events: [string, number, number][];
  insights: Insight[];
  explanation: CellExplanation;
  snapshots: Map<number, SimSnapshot>;
}

/** The same script against any controller: init, run, a fire marked in the past (a rewind and a replay), run on, explain. */
async function script(c: SimController, scenario: ScenarioData): Promise<Trace> {
  const events: Trace['events'] = [];
  const snapshots = new Map<number, SimSnapshot>();
  let lastSnapshot = -1;
  c.on('ready', () => events.push(['ready', 0, 0]));
  c.on('snapshot', (s) => {
    lastSnapshot = s.time;
    snapshots.set(s.time, s);
    events.push(['snapshot', s.time, snapshotHash(s)]);
  });
  c.on('rewound', (t) => events.push(['rewound', t, 0]));
  const errors: string[] = [];
  c.on('error', (m) => errors.push(m));
  const insights = await c.init(scenario);
  const until = (t: number, afterRewind = false): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no end of the run to ${t} s`)), 240_000);
      let rewound = !afterRewind;
      const offR = c.on('rewound', () => (rewound = true));
      const offS = c.on('status', (st) => {
        if (rewound && !st.running && st.time >= t - 1e-6 && lastSnapshot >= t - 1e-6) {
          offR();
          offS();
          clearTimeout(timer);
          resolve();
        }
      });
      if (!afterRewind) c.run(t);
      else {
        c.ignite({ ...pointIgnition('late', -2000, 800, 600, 45), origin: 'spot' });
        c.run(t);
      }
    });
  await until(1200);
  await until(1200, true);
  const explanation = await c.explain(-2100, 900);
  expect(errors).toEqual([]);
  return { events, insights, explanation, snapshots };
}

async function katoomba(): Promise<ScenarioData> {
  const base = await demoScenario({ startCivil: [2025, 12, 20, 14], extent: 6000, tier: 'fast', duration: 3600 });
  return withIgnitions(base, [pointIgnition('escarpment', -2170, 900, 0, 60)], { snapshotInterval: 60, tier: 'fast', seed: 11 });
}

describe('determinism across the transport (Katoomba demo site, 6 km, fast tier, a fire on the escarpment)', () => {
  it('LocalSimController and host plus RemoteSimController give identical snapshot hashes at identical simulation times', async () => {
    const scenario = await katoomba();
    const local = new LocalSimController({ simulation: { minSnapshotWallMs: 0 } });
    const t0 = Date.now();
    const a = await script(local, scenario);
    const localMs = Date.now() - t0;
    local.dispose();

    const h = await realHost();
    const remote = await connect(h);
    const t1 = Date.now();
    const b = await script(remote.controller, scenario);
    const remoteMs = Date.now() - t1;

    const times = (t: Trace): number[] => t.events.filter((e) => e[0] === 'snapshot').map((e) => e[1]);
    expect(times(a).length).toBeGreaterThan(20); // a real run: the t0 picture, twenty steps, and the re-run after the rewind
    expect(a.events.some((e) => e[0] === 'rewound')).toBe(true);
    // The same events in the same order, and every snapshot has the same hash.
    expect(b.events.map((e) => `${e[0]}@${e[1]}`)).toEqual(a.events.map((e) => `${e[0]}@${e[1]}`));
    const hashes = (t: Trace): string => t.events.map((e) => `${e[0]}@${e[1]}=${e[2]}`).join('\n');
    expect(hashes(b)).toBe(hashes(a));
    // The fire burnt: the hashes mean something.
    const last = a.snapshots.get(1200)!;
    expect(last.fire.burnState.some((x) => x === 1 || x === 2)).toBe(true);
    // And the rest of what crossed: the forecast insights and the answer to "Why here?" are the same, value for value.
    expect(difference(b.insights, a.insights)).toBeNull();
    expect(difference(b.explanation, a.explanation)).toBeNull();
    // Part by part, the last snapshot is the same arrays, bit for bit.
    expect(difference(b.snapshots.get(1200)!.fire, last.fire)).toBeNull();
    expect(difference(b.snapshots.get(1200)!.moisture, last.moisture)).toBeNull();
    log(`Katoomba script: ${times(a).length} snapshots; in-thread ${localMs} ms, through the host ${remoteMs} ms (both include the scenario upload and the rewind)`);
  }, 600_000);
});

describe('RemoteSimController against the real host', () => {
  it('reports who the host is, measures the link, and runs a small scenario like the Web Worker does', async () => {
    const h = await realHost();
    const remote = await connect(h);
    expect(remote.info).toMatchObject({ app: 'firesim-desktop-host', protocol: 2, name: 'Test desk', node: process.versions.node, sessions: 1, maxSessions: 2 });
    await waitFor(() => remote.rttMs() !== null, 5000, 'the first round trip');
    expect(remote.rttMs()!).toBeGreaterThanOrEqual(0);
    expect(remote.rttMs()!).toBeLessThan(1000);
    const c = remote.controller;
    const snaps: SimSnapshot[] = [];
    const statuses: { time: number; running: boolean }[] = [];
    c.on('snapshot', (s) => snaps.push(s));
    c.on('status', (s) => statuses.push(s));
    const scenario = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent: 2400, options: { snapshotInterval: 300 } });
    expect(Array.isArray(await c.init(scenario))).toBe(true);
    await waitFor(() => snaps.length >= 1, 30000, 'the t0 snapshot');
    c.run(1500);
    await waitFor(() => snaps.some((s) => s.time === 1500) && statuses.length > 0 && !statuses[statuses.length - 1]!.running, 60000, 'the end of the run');
    expect(snaps.map((s) => s.time).filter((t, i, all) => all.indexOf(t) === i)).toEqual([0, 300, 600, 900, 1200, 1500]);
    expect(statuses.some((s) => s.running)).toBe(true);
    const ex = await c.explain(-250, 0);
    expect(ex.narrative.length).toBeGreaterThan(0);
    // Arrays arrive as the kinds the page expects, each with a buffer of its own.
    const s = snaps[snaps.length - 1]!;
    expect(s.fire.arrivalTime).toBeInstanceOf(Float32Array);
    expect(s.fire.burnState).toBeInstanceOf(Uint8Array);
    expect(s.fire.arrivalTime.buffer.byteLength).toBe(s.fire.arrivalTime.byteLength);
    c.pause();
  }, 120_000);

  it('a wrong code rejects with RemoteAuthError and leaves nothing running; the right code afterwards works', async () => {
    const h = await realHost();
    const err = await connectRemote({ base: `http://127.0.0.1:${h.port}`, code: 'WRONG234' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteAuthError);
    expect((err as RemoteAuthError).reason).toBe('wrong-code');
    expect((err as RemoteAuthError).message).toBe('That code was not right.');
    expect(h.sessions).toBe(0);
    expect(h.liveEngines).toBe(0);
    expect((await connect(h)).info.name).toBe('Test desk');
  });

  it('five wrong codes refuse the address: RemoteAuthError with reason rate-limited, even for the right code', async () => {
    const h = await realHost();
    for (let i = 0; i < 5; i++) await expect(connectRemote({ base: `http://127.0.0.1:${h.port}`, code: `WRONG23${i}` })).rejects.toBeInstanceOf(RemoteAuthError);
    const err = await connectRemote({ base: `http://127.0.0.1:${h.port}`, code: CODE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteAuthError);
    expect((err as RemoteAuthError).reason).toBe('rate-limited');
  });

  it('a host with no free session rejects with a sentence, and a host that is not there with another', async () => {
    const h = await realHost({ maxSessions: 1 });
    await connect(h);
    await expect(connectRemote({ base: `http://127.0.0.1:${h.port}`, code: CODE })).rejects.toThrow('The desktop has no free session.');
    await expect(connectRemote({ base: 'http://127.0.0.1:9', code: CODE })).rejects.toThrow('Could not reach the desktop.');
  });

  it('a lost link is one plain error event and a disposed controller (no exception, no second event)', async () => {
    const h = await realHost();
    const remote = await connect(h);
    const errors: string[] = [];
    remote.controller.on('error', (m) => errors.push(m));
    const scenario = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent: 2400 });
    const pendingExplain = remote.controller.explain(0, 0);
    pendingExplain.catch(() => undefined);
    await remote.controller.init(scenario);
    await h.close();
    await waitFor(() => errors.length > 0, 10000, 'the error');
    await new Promise((r) => setTimeout(r, 200));
    expect(errors).toEqual(['The desktop connection closed.']);
    expect(() => remote.controller.run(10)).not.toThrow(); // a disposed controller ignores calls
    await expect(pendingExplain).rejects.toThrow();
  }, 60_000);

  it("the engine's failure reaches the page as an error event of one line (no stack, no file names), and the session goes on", async () => {
    const h = await realHost();
    const remote = await connect(h);
    const errors: string[] = [];
    remote.controller.on('error', (m) => errors.push(m));
    const broken = { ...syntheticScenario({ extent: 2400 }), terrain: undefined } as unknown as ScenarioData;
    await expect(remote.controller.init(broken)).rejects.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain('\n');
    expect(errors[0]).not.toMatch(/file:|\/home\/|\.mjs|\.ts:/);
    // The controller is still connected: a good scenario runs.
    await remote.controller.init(syntheticScenario({ extent: 2400 }));
  }, 60_000);

  it('a message that cannot be read is answered with an error, not a crash', async () => {
    const h = await realHost();
    const c = await openRaw(h.port);
    c.send(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const answer = await c.next();
    expect(decodeMessage(answer)).toMatchObject({ type: 'error' });
    expect(h.sessions).toBe(1);
    c.close();
  });
});

describe('flow control with the real engine', () => {
  it('a hold takes effect within a few frames, however much of the run is still to come: the engine does not go on producing the whole run while the host waits for the link', async () => {
    // Measured on the throttled link of 0.9.0 (desktop/linkMeasure.ts): while the worker continued its run through a MessageChannel of its own, Node took the
    // messages of that port in one go (up to 1000 in a turn, those the handler posts to itself included), `parentPort` was not read in between, and a hold
    // reached the worker only when the run was over: 64 MiB of snapshots were produced after the host had said hold at 11 MiB. The worker now yields with an
    // immediate, between which the event loop turns.
    const frames: Uint8Array[] = [];
    const failures: string[] = [];
    const engine = workerEngines(workerFile, { simulation: { minSnapshotWallMs: 0 } })({ frame: (b) => void frames.push(b), note: () => undefined, failed: (m) => void failures.push(m), exited: () => undefined });
    const snapshots = (): number => frames.filter((f) => f.byteLength > 1_000_000).length; // a snapshot of the 6 km demo site is 2.2 MB, everything else is small
    try {
      engine.receive(encodeMessage({ type: 'init', scenario: withoutContext(await katoomba()) }));
      await waitFor(() => frames.length >= 1, 60_000, 'ready');
      engine.receive(encodeMessage({ type: 'run', until: 3600 })); // 61 snapshots, 134 MB: some seconds of compute when nothing holds it back
      await waitFor(() => snapshots() >= 4, 60_000, 'the first snapshots');
      engine.hold(true);
      const atHold = snapshots();
      await new Promise((r) => setTimeout(r, 1500));
      const produced = snapshots() - atHold;
      expect(produced, `${produced} snapshots were produced in the 1.5 s after the hold (of ${61 - atHold} still to come)`).toBeLessThanOrEqual(4);
      expect(snapshots()).toBeLessThan(61);
      engine.hold(false);
      await waitFor(() => snapshots() >= 61, 120_000, 'the end of the run once it was let go');
      expect(failures).toEqual([]);
    } finally {
      await engine.terminate();
    }
  }, 240_000);

  it('a client that stops reading holds the run back, and the run finishes with every snapshot once it reads again', async () => {
    const logs: string[] = [];
    const h = await realHost({ maxSessions: 1, highWaterBytes: 2 * 1024 * 1024, lowWaterBytes: 512 * 1024, logs });
    const c = await openRaw(h.port);
    c.send(encodeMessage({ type: 'init', scenario: withoutContext(await katoomba()) }));
    await c.next(); // ready
    c.pause();
    c.send(encodeMessage({ type: 'run', until: 3600 }));
    await waitFor(() => logs.some((l) => l.includes('slow link')), 60000, 'the host to see that the link is behind');
    expect(logs.filter((l) => l.includes('slow link'))).toHaveLength(1); // said once, not at every change
    c.resume();
    const status = (): { time: number; running: boolean } | undefined =>
      c
        .all()
        .filter((f) => f.byteLength < 400)
        .map((f) => decodeMessage(f))
        .filter((m) => m.type === 'status')
        .pop() as { time: number; running: boolean } | undefined;
    await waitFor(() => status() !== undefined && !status()!.running && status()!.time >= 3600 - 1e-6, 120000, 'the end of the run');
    const times = c
      .all()
      .filter((f) => f.byteLength > 100_000)
      .map((f) => (decodeMessage(f) as { snapshot: SimSnapshot }).snapshot.time);
    expect(times).toEqual(Array.from({ length: 61 }, (_, i) => i * 60)); // none lost, none repeated, in order
  }, 240_000);
});

describe('a worker thread that dies', () => {
  it('is reported to the page as one error line (no stack, no path) and ends the session with 1011, the worker gone', async () => {
    const dying = join(work, 'dying-worker.mjs');
    writeFileSync(dying, "import { parentPort } from 'node:worker_threads';\nparentPort.on('message', () => { throw new Error('boom\\n    at /secret/path/engine.js:1:1'); });\n");
    const logs: string[] = [];
    const h = await startHost({ distDir: work, port: 0, bind: '127.0.0.1', code: CODE, name: 'x', maxSessions: 1, engines: workerEngines(pathToFileURL(dying)), log: (l) => logs.push(l) });
    hosts.push(h);
    const c = await openClient(h.port);
    hello(c, CODE);
    expect((await welcomeOf(c))?.type).toBe('welcome');
    c.ws.send(encodeMessage({ type: 'run', until: 10 }));
    expect((await c.closed).code).toBe(1011);
    const frame = c.received.find((m): m is Uint8Array => typeof m !== 'string')!;
    expect(decodeMessage(frame)).toEqual({ type: 'error', message: 'The simulation engine stopped: boom' });
    await waitFor(() => h.sessions === 0 && h.liveEngines === 0, 10000, 'the slot to be freed');
    expect(logs.join('\n')).not.toContain('/secret/path');
  }, 30_000);
});

describe('what the engine takes of a client', () => {
  it('drops everything but init until the first init (one log line, nothing waits in a queue), and then works', async () => {
    const logs: string[] = [];
    const h = await realHost({ maxSessions: 1, logs });
    const c = await openRaw(h.port);
    const before = [
      { type: 'run', until: 100 },
      { type: 'ignite', ignition: pointIgnition('early', 0, 0, 0, 60) },
      { type: 'rewind', time: 0 },
      { type: 'setOption', key: 'embers', value: false },
    ] as const;
    for (const m of before) c.send(encodeMessage(m as never));
    await waitFor(() => logs.some((l) => l.includes('came before init')), 10000, 'the log line');
    await new Promise((r) => setTimeout(r, 300));
    expect(c.all()).toHaveLength(0); // nothing came back: no error either
    expect(logs.filter((l) => l.includes('came before init'))).toHaveLength(1);
    expect(logs.find((l) => l.includes('came before init'))).toContain('dropped a "run" message');
    expect(logs.join('\n')).not.toContain('early');
    // The fire marked before init was dropped, not kept for later: a scenario with no ignitions has no fire.
    c.send(encodeMessage({ type: 'init', scenario: syntheticScenario({ extent: 2400, ignitions: [], options: { snapshotInterval: 300 } }) }));
    await waitFor(() => c.all().length >= 1, 30000, 'ready');
    c.send(encodeMessage({ type: 'run', until: 600 }));
    const snapshotAt600 = (): SimSnapshot | undefined =>
      c
        .all()
        .filter((f) => f.byteLength > 5000)
        .map((f) => decodeMessage(f))
        .map((m) => (m as { snapshot?: SimSnapshot }).snapshot)
        .find((s) => s?.time === 600);
    await waitFor(() => snapshotAt600() !== undefined, 60000, 'the snapshot at 600 s');
    expect(Array.from(snapshotAt600()!.fire.burnState).some((x) => x === 1 || x === 2)).toBe(false);
    expect(logs.filter((l) => l.includes('came before init'))).toHaveLength(1);
  }, 120_000);

  it('refuses a message of more than 4096 typed arrays and a header of more than 8 MiB with an error, before it allocates, and goes on', async () => {
    const h = await realHost({ maxSessions: 1 });
    const c = await openRaw(h.port);
    const frame = (header: string): Uint8Array => {
      const bytes = new TextEncoder().encode(header);
      const out = new Uint8Array(Math.ceil((4 + bytes.byteLength) / 8) * 8);
      new DataView(out.buffer).setUint32(0, bytes.byteLength, true);
      out.set(bytes, 4);
      return out;
    };
    const errorAfter = async (f: Uint8Array, n: number): Promise<string> => {
      c.send(f);
      await waitFor(() => c.all().length >= n, 20000, 'the error');
      const m = decodeMessage(c.all()[n - 1]!);
      return m.type === 'error' ? m.message : m.type;
    };
    const empties = `{"type":"init","scenario":[${Array.from({ length: 5000 }, () => '{"$ta":"u8","o":0,"n":0}').join(',')}]}`;
    expect(await errorAfter(frame(empties), 1)).toContain('more than 4096 typed arrays');
    // the verifier's attack: a header of millions of empty arrays. 9 MiB of it is refused on its size.
    const t0 = Date.now();
    const huge = `{"type":"init","scenario":[${new Array(380_000).fill('{"$ta":"u8","o":0,"n":0}').join(',')}]}`;
    expect(huge.length).toBeGreaterThan(8 * 1024 * 1024);
    expect(await errorAfter(frame(huge), 2)).toContain('header is larger than 8388608 bytes');
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(h.sessions).toBe(1); // the session is still there
    c.close();
  }, 60_000);
});

describe("a worker thread's heap limit (--worker-heap-mib)", () => {
  /**
   * `workerEngines` run in a process of its own with a worker that fills the heap with about 300 MB of small objects, and what
   * the host side was told. The process has no NODE_OPTIONS: a `--max-old-space-size` there is a V8 flag for every thread and wins
   * over a worker's resourceLimits (this machine sets one, and so may a user's).
   */
  function fillHeap(limitMib: number | null, nodeOptions = ''): Promise<string> {
    const hungry = join(work, 'hungry-worker.mjs');
    writeFileSync(hungry, "import { parentPort } from 'node:worker_threads';\nparentPort.on('message', () => {\n  const keep = [];\n  for (let i = 0; i < 4_000_000; i++) keep.push({ a: i, b: [i, i + 1] });\n  parentPort.postMessage(new Uint8Array(1));\n});\n");
    const script = `
      import { workerEngines } from ${JSON.stringify(pathToFileURL(join(built.dir, 'engine.mjs')).href)};
      const engine = workerEngines(new URL(${JSON.stringify(pathToFileURL(hungry).href)}), {}, ${limitMib === null ? '{}' : `{ maxOldGenerationSizeMb: ${limitMib} }`})({
        frame: () => { console.log('survived'); process.exit(0); },
        note: () => {},
        failed: (m) => { console.log('failed: ' + m); process.exit(0); },
        exited: () => {},
      });
      engine.receive(new Uint8Array([1]));
      setTimeout(() => { console.log('nothing happened'); process.exit(1); }, 45000);
    `;
    const file = join(work, 'fill-heap.mjs'); // a file, not -e: the worker would inherit the -e of its parent
    writeFileSync(file, script);
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [file], { env: { ...process.env, NODE_OPTIONS: nodeOptions }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (out += d.toString()));
      child.on('exit', () => resolve(out.trim()));
    });
  }

  it('ends a worker that runs out of its heap, as an engine failure with a plain sentence', async () => {
    const out = await fillHeap(48);
    expect(out).toMatch(/^failed: The simulation engine stopped: Worker terminated due to reaching memory limit: JS heap out of memory/);
  }, 60_000);

  it('lets the same worker finish when no limit is given (so the limit above is the flag, nothing else)', async () => {
    expect(await fillHeap(null)).toBe('survived');
  }, 60_000);

  it('is overridden by a --max-old-space-size in NODE_OPTIONS (a V8 flag of the whole process): said in the README', async () => {
    expect(await fillHeap(48, '--max-old-space-size=8192')).toBe('survived');
  }, 60_000);
});

describe('the memory bound of a session (--max-session-mib) with the real engine', () => {
  it('refuses a scenario whose estimate is above the limit with the engine error the page words, builds nothing for it, keeps the session open, and takes a smaller scenario after it', async () => {
    const small = syntheticScenario({ extent: 2400, ignitions: [pointIgnition('a', -300, 0, 0, 60)], options: { snapshotInterval: 300 } });
    const big = syntheticScenario({ extent: 6000, cellSize: 10 }); // 360,000 fire cells: the finer detail of 0.9.0, 6 km at 10 m
    const estimate = (s: ScenarioData): number => estimateSessionBytes(sizeOfScenario(encodeMessage({ type: 'init', scenario: withoutContext(s) }).byteLength, s));
    const [low, high] = [estimate(small), estimate(big)];
    expect(high).toBeGreaterThan(low * 10); // the limit has room between them
    const limit = Math.round(Math.sqrt(low * high));
    const logs: string[] = [];
    const h = await realHost({ maxSessionBytes: limit, logs });
    const remote = await connect(h);
    const errors: string[] = [];
    const snaps: SimSnapshot[] = [];
    const told: string[] = [];
    remote.controller.on('error', (m) => errors.push(m));
    remote.controller.on('snapshot', (s) => snaps.push(s));
    remote.onClosed((r) => told.push(r));
    // The big one: the engine's own error, and init rejects with the exact sentence.
    await expect(remote.controller.init(big)).rejects.toThrow(TOO_BIG_MESSAGE);
    expect(errors).toEqual(["This scenario is too big for the desktop's free memory."]);
    await waitFor(() => logs.some((l) => l.includes('refused a scenario')), 5000, 'the log line');
    const line = logs.find((l) => l.includes('refused a scenario'))!;
    expect(line).toMatch(/refused a scenario: about [\d,]+ MiB expected, [\d,]+ MiB allowed for a session \(--max-session-mib\)/);
    expect(line).toContain(`${Math.round(limit / MIB).toLocaleString('en-US')} MiB allowed`);
    // The link is up and the session is alive; nothing was built: a run is dropped as one that came before an init.
    expect(h.sessions).toBe(1);
    expect(told).toEqual([]);
    remote.controller.run(300);
    await waitFor(() => logs.some((l) => l.includes('dropped a "run" message')), 5000, 'the run to be dropped (no simulation was built)');
    expect(snaps).toHaveLength(0);
    // The small one on the same link: it is built, run and answered.
    expect(Array.isArray(await remote.controller.init(small))).toBe(true);
    await waitFor(() => snaps.length >= 1, 30_000, 'the first picture of the smaller scenario');
    remote.controller.run(600);
    await waitFor(() => snaps.some((s) => s.time === 600), 60_000, 'the run');
    expect(errors).toHaveLength(1); // the one refusal
    expect(told).toEqual([]);
  }, 180_000);

  it('takes every scenario when no limit is set (the host started without --max-session-mib in tests only: the command line always sets one)', async () => {
    const h = await realHost();
    const remote = await connect(h);
    expect(Array.isArray(await remote.controller.init(syntheticScenario({ extent: 2400 })))).toBe(true);
  }, 60_000);
});

describe('a session that ends leaves no worker behind', () => {
  it('closing the controller ends its worker thread and frees its slot, again and again', async () => {
    const h = await realHost({ maxSessions: 1 });
    for (let i = 0; i < 4; i++) {
      const remote = await connect(h);
      await remote.controller.init(syntheticScenario({ extent: 2400, ignitions: [pointIgnition('a', -300, 0, 0, 60)] }));
      remote.controller.run(300);
      expect(h.liveEngines).toBe(1);
      remote.close();
      await waitFor(() => h.sessions === 0 && h.liveEngines === 0, 10000, `session ${i} to be gone`);
    }
  }, 120_000);

  it('a client that vanishes in the middle of a run (no closing handshake) frees the worker too', async () => {
    const h = await realHost({ maxSessions: 1 });
    const c = await openRaw(h.port);
    c.send(encodeMessage({ type: 'init', scenario: syntheticScenario({ extent: 2400, ignitions: [pointIgnition('a', -300, 0, 0, 60)], duration: 6 * 3600 }) }));
    c.send(encodeMessage({ type: 'run', until: 6 * 3600 }));
    await c.next(); // the engine is busy
    expect(h.liveEngines).toBe(1);
    c.terminate();
    await waitFor(() => h.sessions === 0 && h.liveEngines === 0, 10000, 'the worker to end');
  }, 60_000);

  it('stopping the host ends every worker and the process has nothing of the host left to wait for', async () => {
    const h = await realHost({ maxSessions: 2 });
    const a = await connect(h);
    const b = await connect(h);
    await a.controller.init(syntheticScenario({ extent: 2400 }));
    await b.controller.init(syntheticScenario({ extent: 2400 }));
    expect(h.liveEngines).toBe(2);
    await h.close();
    expect(h.liveEngines).toBe(0);
    expect(h.sessions).toBe(0);
  }, 60_000);
});

describe('throughput of a real scenario and a real snapshot (printed, not asserted)', () => {
  it('measures the codec, the upload through the host, and a snapshot stream', async () => {
    const scenario = await katoomba();
    const sent = withoutContext(scenario);
    const best = <T>(n: number, f: () => T): { ms: number; value: T } => {
      let ms = Infinity;
      let value!: T;
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        value = f();
        ms = Math.min(ms, performance.now() - t0);
      }
      return { ms, value };
    };
    const enc = best(3, () => encodeMessage({ type: 'init', scenario: sent }));
    const dec = best(3, () => decodeMessage(enc.value));
    const mb = (n: number): string => (n / 1048576).toFixed(2);
    log(`scenario (Katoomba 6 km, the init message): ${mb(enc.value.byteLength)} MB; encode ${enc.ms.toFixed(1)} ms, decode ${dec.ms.toFixed(1)} ms`);

    const sim = new Simulation(scenario, { tier: 'fast' });
    sim.advance(600);
    const snapshot = sim.snapshot();
    const senc = best(5, () => encodeMessage({ type: 'snapshot', snapshot }));
    const sdec = best(5, () => decodeMessage(senc.value));
    log(`snapshot (fast tier, 6 km, t = 600 s): ${mb(senc.value.byteLength)} MB; encode ${senc.ms.toFixed(2)} ms, decode ${sdec.ms.toFixed(2)} ms`);

    // The upload through the real host and a real WebSocket client, onto an engine that only counts (so the simulation is not in the figure).
    const { factory, made } = fakeEngines();
    const h = await startHost({ distDir: work, port: 0, bind: '127.0.0.1', code: CODE, name: 'x', maxSessions: 1, engines: factory, log: () => undefined });
    hosts.push(h);
    const raw = await openRaw(h.port);
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = made[0]!.frames.length;
      const t0 = performance.now();
      raw.send(enc.value.slice());
      await waitFor(() => made[0]!.frames.length > before, 60000, 'the upload');
      times.push(performance.now() - t0);
    }
    const up = Math.min(...times);
    log(`upload of that scenario through the host on a loopback: ${up.toFixed(0)} ms, ${(enc.value.byteLength / 1048576 / (up / 1000)).toFixed(0)} MB/s (best of 3)`);
    raw.close();

    // The real engine: init to ready, and the snapshots of a run counted at the socket.
    const real = await realHost();
    let received = 0;
    let frames = 0;
    class Counting extends WebSocket {
      constructor(url: string | URL) {
        super(url);
        this.addEventListener('message', (ev) => {
          if (ev.data instanceof ArrayBuffer) {
            received += ev.data.byteLength;
            frames++;
          }
        });
      }
    }
    const conn = await connectRemote({ base: `http://127.0.0.1:${real.port}`, code: CODE, WebSocketCtor: Counting });
    open.push(conn);
    const tInit = performance.now();
    await conn.controller.init(scenario);
    const initMs = performance.now() - tInit;
    let snaps = 0;
    conn.controller.on('snapshot', () => snaps++);
    const tRun = performance.now();
    await new Promise<void>((resolve) => {
      const off = conn.controller.on('status', (st) => {
        if (!st.running && st.time >= 1800 - 1e-6) {
          off();
          resolve();
        }
      });
      conn.controller.run(1800);
    });
    const runMs = performance.now() - tRun;
    log(`real engine: init to ready ${initMs.toFixed(0)} ms (upload, decode, moisture spin-up); a run of 1800 s: ${snaps} snapshots in ${runMs.toFixed(0)} ms, ${mb(received)} MB over ${frames} frames (${(received / 1048576 / (runMs / 1000)).toFixed(1)} MB/s)`);
  }, 300_000);
});

/** A bare client of the host after the welcome: send frames, take the next frame, close. */
async function openRaw(port: number): Promise<{ send(b: Uint8Array): void; next(): Promise<Uint8Array>; all(): Uint8Array[]; pause(): void; resume(): void; close(): void; terminate(): void }> {
  const c = await openClient(port);
  hello(c, CODE);
  expect((await welcomeOf(c))?.type).toBe('welcome');
  let taken = 1;
  return {
    send: (b) => c.ws.send(b),
    next: async () => {
      await waitFor(() => c.received.length > taken, 60000, 'a frame');
      return c.received[taken++] as Uint8Array;
    },
    all: () => c.received.slice(1) as Uint8Array[],
    // A client that stops reading: the socket is paused, the kernel's buffers fill, and the host's queue grows.
    pause: () => (c.ws as unknown as { _socket: { pause(): void } })._socket.pause(),
    resume: () => (c.ws as unknown as { _socket: { resume(): void } })._socket.resume(),
    close: () => c.ws.close(1000),
    terminate: () => c.ws.terminate(),
  };
}
