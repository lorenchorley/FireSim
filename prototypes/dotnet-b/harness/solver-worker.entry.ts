/**
 * Card T1.5 (d): the whole TypeScript solver as a browser Web Worker. It runs a named scenario of `ts-export/scenarios.ts` exactly the way
 * `ts-export/export.ts` does under Node: the same scenario construction (`ts-export/scenario-build.ts`, shared with export.ts), the same
 * `new Simulation(scenario, { minSnapshotWallMs: 0, hooks: { snapshot } })`, the same calls (`snapshot()` once, `spinUp()`, `advance(runTo)`,
 * `emitRunEnd()`), the same per-snapshot work (codec encode of the message, then the app's `snapshotHash`), the same `--keep` rules.
 * Nothing under `src/` is edited and no physics is copied: this bundle imports the app's own modules.
 *
 * Message in:  { cmd: 'run', scenario, seed?, to?, interval?, keep?: 'all' | 'none' | 'last' | 'T,T,..', assetBase }
 * Message out: { type: 'result', ... } (one message, big buffers transferred) or { type: 'error', error }.
 *
 * Timing (performance.now in the worker): scenarioMs (build, including the asset fetches), constructMs, spinUpMs, advanceMs. As in export.ts the
 * per-snapshot callback (encode + hash) runs inside `advance`, so advanceMs includes it; `callbackMs` is that share, `encodeMs` the encode part.
 */
import { setAssetBase } from '../../../src/data/assets';
import { withoutContext } from '../../../src/sim/client';
import { decodeMessage, encodeMessage } from '../../../src/sim/remote/codec';
import { Simulation } from '../../../src/sim/simulation';
import { snapshotHash } from '../../../src/sim/testing/hash';
import type { ScenarioData, SimSnapshot } from '../../../src/core/types';
import { buildScenarioData } from '../ts-export/scenario-build';
import { scenarioByName } from '../ts-export/scenarios';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown, transfer?: Transferable[]): void;
};

interface RunMessage {
  cmd: 'run';
  scenario: string;
  seed?: number;
  to?: number;
  interval?: number;
  keep?: string;
  assetBase: string;
  /** URL of an init.bin (codec frame): run the solver on that scenario instead of building one (separates the build's maths from the solver's). */
  initUrl?: string;
}

const wall = (): number => performance.now();

/** A Uint8Array that owns its whole buffer, so that the buffer can be transferred without taking bytes of another array. */
const own = (u: Uint8Array): Uint8Array => (u.byteOffset === 0 && u.byteLength === u.buffer.byteLength ? u : u.slice());

function memory(): { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return m ? { usedJSHeapSize: m.usedJSHeapSize, totalJSHeapSize: m.totalJSHeapSize, jsHeapSizeLimit: m.jsHeapSizeLimit } : null;
}

async function run(msg: RunMessage): Promise<void> {
  setAssetBase(msg.assetBase);
  const def = scenarioByName(msg.scenario);
  if (!def) throw new Error(`unknown scenario ${msg.scenario}`);
  const seed = msg.seed ?? def.seed;
  const runTo = msg.to ?? def.runTo;
  const interval = msg.interval ?? def.snapshotInterval;
  const keepArg = msg.keep ?? 'all';
  const keepTimes = new Set(keepArg === 'all' || keepArg === 'none' || keepArg === 'last' ? [] : keepArg.split(',').map(Number));

  const T = { total0: wall(), scenarioMs: 0, constructMs: 0, spinUpMs: 0, advanceMs: 0, encodeMs: 0, callbackMs: 0 };
  const mem0 = memory();
  let t0 = wall();
  let scenario: ScenarioData;
  if (msg.initUrl) {
    const m = decodeMessage(new Uint8Array(await (await fetch(msg.initUrl)).arrayBuffer())) as { type: string; scenario?: ScenarioData };
    if (m.type !== 'init' || !m.scenario) throw new Error(`${msg.initUrl} is not an init frame`);
    scenario = m.scenario;
    if ((scenario.options as { seed?: number }).seed !== seed) throw new Error(`init.bin has seed ${(scenario.options as { seed?: number }).seed}, the run asks for ${seed}`);
  } else scenario = await buildScenarioData(def, seed, interval);
  T.scenarioMs = wall() - t0;

  const initBytes = own(encodeMessage({ type: 'init', scenario: withoutContext(scenario) }));

  const hashes: Record<string, number> = {};
  const snapBytes: Record<string, number> = {};
  const kept = new Map<number, Uint8Array>();
  let lastArrival: Float32Array | null = null;
  let lastGrid = scenario.terrain.grid;
  let lastTime = -1;
  let callbacks = 0;
  const onSnapshot = (s: SimSnapshot): void => {
    if (s.time > runTo + 1e-6) return;
    const c0 = wall();
    const bytes = encodeMessage({ type: 'snapshot', snapshot: s });
    // Same rule as export.ts: 'last' keeps the latest snapshot's bytes and drops the one it replaces.
    if (keepArg === 'all' || keepTimes.has(s.time) || keepArg === 'last') {
      kept.set(s.time, bytes);
      if (keepArg === 'last' && kept.size > 1) kept.delete(kept.keys().next().value as number);
    }
    T.encodeMs += wall() - c0;
    hashes[String(s.time)] = snapshotHash(s);
    snapBytes[String(s.time)] = bytes.byteLength;
    lastArrival = s.fire.arrivalTime;
    lastGrid = s.fire.grid;
    lastTime = s.time;
    callbacks++;
    T.callbackMs += wall() - c0;
  };

  t0 = wall();
  const sim = new Simulation(scenario, { minSnapshotWallMs: 0, hooks: { snapshot: onSnapshot } });
  T.constructMs = wall() - t0;
  onSnapshot(sim.snapshot());
  const callbackAtStart = T.callbackMs;
  t0 = wall();
  sim.spinUp();
  T.spinUpMs = wall() - t0;
  const mem1 = memory();
  t0 = wall();
  sim.advance(runTo);
  T.advanceMs = wall() - t0;
  sim.emitRunEnd();
  const mem2 = memory();
  const tierNow = sim.tier;

  if (!lastArrival) throw new Error('no snapshot was produced');
  const arrival = lastArrival as Float32Array;
  const out = new Float32Array(arrival.length);
  let burnt = 0;
  for (let i = 0; i < arrival.length; i++) {
    const a = arrival[i]!;
    if (Number.isFinite(a)) {
      out[i] = a;
      burnt++;
    } else out[i] = -1;
  }

  const times = Object.keys(snapBytes).map(Number).sort((a, b) => a - b);
  const keptTimes = [...kept.keys()].sort((a, b) => a - b);
  const keptBuffers: { t: number; bytes: Uint8Array }[] = keptTimes.map((t) => ({ t, bytes: own(kept.get(t)!) }));
  const g = lastGrid;
  const runMs = T.spinUpMs + T.advanceMs;
  const result = {
    type: 'result',
    scenario: def.name,
    description: def.description,
    tier: def.tier,
    gridMode: def.grid ?? 'builder',
    startCivil: def.startCivil,
    expectedHashes: def.expectedHashes ?? null,
    initFrom: msg.initUrl ?? null,
    seed,
    defaultSeed: def.seed,
    runTo,
    interval,
    keepArg,
    hashes,
    snapBytes,
    snapshotTimesS: times,
    snapshotsWritten: keptTimes,
    arrival: out,
    arrivalBurntCells: burnt,
    arrivalAtTimeS: lastTime,
    fireGrid: { nx: g.nx, ny: g.ny, cellSize: g.cellSize, x0: g.x0, y0: g.y0, origin: g.origin },
    terrainGridMatchesFireGrid: scenario.terrain.grid.nx === g.nx && scenario.terrain.grid.cellSize === g.cellSize,
    tierRunning: tierNow,
    extentM: scenario.extent,
    startTimeUtcMs: scenario.startTime,
    durationS: scenario.duration,
    options: scenario.options,
    ignitions: scenario.ignitions,
    initBytes,
    kept: keptBuffers,
    timingMs: {
      scenarioBuild: T.scenarioMs,
      simConstruct: T.constructMs,
      spinUp: T.spinUpMs,
      advance: T.advanceMs,
      spinUpPlusAdvance: runMs,
      snapshotEncode: T.encodeMs,
      snapshotCallbacks: T.callbackMs,
      snapshotCallbacksInRun: T.callbackMs - callbackAtStart,
      snapshotCallbackCount: callbacks,
      workerTotal: wall() - T.total0,
    },
    simSecondsPerWallSecond: runTo / (runMs / 1000),
    memory: { available: mem0 !== null, atStart: mem0, afterSpinUp: mem1, atEnd: mem2 },
    engine: {
      userAgent: (self as unknown as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? null,
      hardwareConcurrency: (self as unknown as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? null,
      crossOriginIsolated: (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? null,
    },
  };
  const transfer: Transferable[] = [out.buffer, initBytes.buffer as ArrayBuffer, ...keptBuffers.map((k) => k.bytes.buffer as ArrayBuffer)];
  scope.postMessage(result, transfer);
}

scope.onmessage = (e: MessageEvent): void => {
  const msg = e.data as RunMessage;
  if (msg?.cmd !== 'run') return;
  run(msg).catch((err: unknown) => scope.postMessage({ type: 'error', error: String(err && (err as Error).stack ? (err as Error).stack : err).slice(0, 4000) }));
};
