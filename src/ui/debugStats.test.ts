/**
 * "Simulation debug statistics" content (debugStats.ts): every group renders with real data and with each kind of data
 * missing and never prints undefined, NaN, null or Infinity; group titles and labels are stable; the copy has the header, a
 * timestamp and the end marker; no coordinate or custom place name ever appears; the phone groups handle a reduced user agent,
 * no Client Hints, no battery API, no WebGPU and a WebGL2 that cannot be created.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineInfo, EnginePerfInfo, SimSnapshot } from '../core/types';
import type { FrameStatsInfo, QualityInfo, TerrainDrawStats } from '../render/api';
import { Simulation } from '../sim/simulation';
import { pointIgnition, syntheticScenario } from '../sim/testing/scenarios';
import { buildDebugStats, debugStatsToText, END_MARKER, pictureQualityWhy, scrubError, TITLE, type DebugStats, type DebugStatsInput, type StatRow } from './debugStats';
import { deviceInfoAsync, deviceInfoNow, type DeviceEnv, type NavLike } from './deviceInfo';
import type { LogEvent } from './eventLog';
import type { PaceInfo } from './paceTypes';

const GROUPS: [string, string][] = [
  ['summary', 'Summary'],
  ['run', 'Run'],
  ['choices', 'Choices'],
  ['grids', 'Grids'],
  ['speed', 'Speed'],
  ['history', 'Speed history'],
  ['step', 'Step'],
  ['duty', 'Worker duty'],
  ['time', 'Where the time goes'],
  ['quality', 'Step quality'],
  ['embers', 'Embers'],
  ['reruns', 'Re-runs'],
  ['memory', 'Memory'],
  ['display', 'Display (main thread)'],
  ['hardware', 'Phone: hardware'],
  ['software', 'Phone: software and graphics'],
  ['canDo', 'What this phone can do'],
  ['events', 'Recent events'],
];

/** The row labels of the full statistics, per group. A change here is a change people see in every paste: do it on purpose. */
const LABELS: Record<string, string[]> = {
  summary: ['In one line'],
  run: ['App version', 'Build', 'Platform', 'Engine', 'Place', 'Area', 'Fire cell', 'Run length', 'Scenario start', 'Seed', 'Deterministic', 'Run clock', 'Computed up to', 'Wall time since the run started', 'Wall time since the app started'],
  choices: ['Tier in use', 'Tier asked for', 'How it was decided', 'Timing test', 'Display step', 'Solver step limit', 'Playback speed asked for', 'Fire and air feedback', 'Embers', 'Mountain phenomena'],
  grids: ['Atmosphere grid', 'Atmosphere spacing', 'First layer thickness', 'Model top above the lowest ground', 'Level stretch ratio', '3-D spin-up', 'Upper air from', 'Air in the pictures', 'Fire grid', 'Fire sub-step now'],
  speed: ['Computing speed, last 10 s', 'Computing speed, last 60 s', 'Computing speed, whole run on this tier', 'Best 10 s window', 'Worst 10 s window', 'Playback speed asked for', 'Playback speed achieved, last 10 s', 'Share of the last 10 s playback waited for the simulation', 'Pace signal'],
  history: ['Computing speed, one sample per 30 s of computing, oldest first', 'Chart'],
  step: ['Outer step now', 'Outer step, mean', 'Steps taken', 'Whole step, mean wall time', 'Whole step, median (last 128)', 'Whole step, 95th percentile (last 128)', 'Whole step, longest (last 128)', 'Steps over 100 ms and over 250 ms', '3-D air step, mean wall time'],
  duty: ['Share of wall time computing, last 10 s', 'Share of wall time computing, last 60 s'],
  time: ['3-D air step', 'Fire spread', 'Coupling (wind sampling, heat)', 'Embers', 'Everything else'],
  quality: ['Air steps limited by', 'Strongest horizontal wind in the air steps', 'Strongest vertical wind in the air steps', 'Pressure corrections per air step', '3-D spin-up wall time', 'Fire sub-steps per outer step', 'Burning cells'],
  embers: ['Tracked embers now', 'Embers released, whole run', 'Embers landed, whole run'],
  reruns: ['Rewinds (a change in the past)', 'Simulated time computed again', 'Tier switches', 'Checkpoint restores'],
  memory: ['Engine memory (measured)', 'Checkpoints (rewind points)', 'History budget (the time scrubber)', 'History held', 'Full pictures (keyframes)', 'Light frames kept', 'Frames thinned away', 'JavaScript heap, screen thread', 'Storage used by the app'],
  display: ['Frame rate, last 10 s', 'Frame time, mean and 95th percentile', 'Frames slower than 30 per second, and over 100 ms', 'Long tasks, last 60 s', 'Draw calls and triangles', 'Textures held by the graphics card', 'Pixel ratio used and its cap', 'Drawing size', 'Last frame drawn', 'Picture quality in use', 'What that tier sets', 'Cliff drawing (once per scenario)'],
  hardware: ['Maker and model', 'Android version', 'CPU cores', 'Architecture and bitness', 'Memory class', 'Screen', 'Window', 'Pixel ratio', 'Refresh rate', 'Touch points', 'Battery'],
  software: ['WebView or browser', 'User agent (as the WebView reports it)', 'WebGL2', 'GPU vendor and renderer', 'Largest texture', 'Float and half-float render targets', 'Compressed textures', 'WebGPU', 'WebAssembly and SIMD', 'Shared memory between threads', 'Offscreen canvas and module workers', 'Reduced motion, contrast, colour scheme'],
  canDo: ['Speed', 'Memory', 'Graphics'],
};

const UA_WEBVIEW = 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36';
const UA_REDUCED = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const CUSTOM_NAME = 'Smiths Creek Rd, 12 Example St';
const CUSTOM_ID = '-33.715432,150.285123-20261011T0300Z-now';

/** A phone: Client Hints answer, battery, storage, WebGPU, WebGL2, refresh rate. */
const fullEnv = (ua = UA_WEBVIEW): DeviceEnv => {
  let t = 0;
  const gl = {
    MAX_TEXTURE_SIZE: 3379,
    getParameter: (p: number) => (p === 37445 ? 'ARM' : p === 37446 ? 'Mali-G710' : 8192),
    getExtension: (n: string) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 } : n === 'WEBGL_lose_context' ? { loseContext: () => undefined } : n.includes('color_buffer') || n.includes('astc') ? {} : null),
  } as unknown as WebGL2RenderingContext;
  const nav: NavLike = {
    userAgent: ua,
    hardwareConcurrency: 8,
    deviceMemory: 6,
    maxTouchPoints: 5,
    userAgentData: {
      platform: 'Android',
      brands: [{ brand: 'Android WebView', version: '120' }],
      getHighEntropyValues: async () => ({ model: 'Pixel 7', platformVersion: '13.0.0', architecture: 'arm', bitness: '64', fullVersionList: [{ brand: 'Android WebView', version: '120.0.6099.144' }] }),
    },
    getBattery: async () => ({ level: 0.64, charging: false }),
    storage: { estimate: async () => ({ usage: 120e6, quota: 30e9 }) },
    gpu: { requestAdapter: async () => ({ info: { vendor: 'arm', architecture: 'valhall' } }) },
  };
  return {
    platform: 'android',
    nav,
    screen: { width: 412, height: 915 },
    win: { innerWidth: 412, innerHeight: 800, devicePixelRatio: 2.625 },
    matchMedia: () => ({ matches: false }),
    openGl2: () => gl,
    raf: (cb) => (setTimeout(() => cb((t += 1000 / 60)), 0), 1),
    wasm: { validate: () => true },
    sharedArrayBuffer: false,
    crossOriginIsolated: false,
    offscreenCanvas: true,
    moduleWorkers: () => true,
    timeoutMs: 1000,
  };
};

const perf: EnginePerfInfo = {
  speed: { s10: 871.4, s60: 860.2, mean: 842.9, best10: 905.1, worst10: 610.3 },
  history: [880, 870, null, 860, 850, 845, 840, 838, 836, 830, 828, 826, 820, 818, 815, 812, 810, 808, 806, 804],
  step: { nowS: 10, minS: 3, meanS: 9.4, maxS: 12, medianMs: 11.5, p95Ms: 18.2, maxMs: 41.7, over100: 0, over250: 0 },
  duty: { s10: 0.42, s60: 0.37 },
  modules: [
    { id: 'air', ms: 6.2, share: 0.52, share10: 0.5 },
    { id: 'fire', ms: 2.5, share: 0.21, share10: 0.22 },
    { id: 'coupling', ms: 1.1, share: 0.09, share10: null },
    { id: 'embers', ms: 1.4, share: 0.12, share10: 0.1 },
    { id: 'other', ms: null, share: null, share10: null },
  ],
  quality: { limitedBy: { cflH: 0.7, cflV: 0.05, cap: 0.2, user: 0.05 }, maxWindH: 14.2, maxWindV: 3.1, projectionCorrections: 2.4, spinUpWallS: 1.9, fireSubSteps: 2.2, burningCells: 640 },
  embers: { spawned: 12034, landed: 9120 },
  reruns: { rewinds: 2, recomputedS: 5400, tierSwitches: 1, restores: 2 },
  events: [],
};

const frames: FrameStatsInfo = { fps10: 28.6, frameMeanMs: 34.9, frameP95Ms: 52.1, over33: 41, over100: 3, frames: 120, drawCalls: 212, triangles: 910_000, textures: 38, pixelRatio: 1.5, pixelRatioCap: 1.75, dprDrops: 1, canvasW: 618, canvasH: 1200, lastDrawAgeS: 2.4 };
const quality: QualityInfo = { tier: 'medium', source: 'guess', guess: 'medium', cores: 6, memoryGb: 4, terrainSamples: 320, treeBudget: 32000, canopyTriangles: 170000, pixelRatioCap: 1.75, flameSites: 5000, smokePuffs: 1500, treeSwayDefault: true };
const terrain: TerrainDrawStats = { sharpenedShare: 0.047, sharpenMs: 180, maskMs: 70, meshMs: 95, gradientMs: 40, meshVertices: 102400, meshTriangles: 204000, rockDetail: 'high' };
const pace: PaceInfo = { level: 'waiting', wanted: 600, achieved: 410, waitingShare: 0.27, capacity: 430, duty: 0.97, aheadS: 12, bufferS: 0.02, sinceMs: 0 };

const NOW = Date.UTC(2026, 9, 11, 3, 32, 5); // 14:32:05 at UTC+11
const events: LogEvent[] = [
  { wallMs: NOW - 120_000, runS: 0, kind: 'run', text: 'Run started.' },
  { wallMs: NOW - 90_000, runS: 0, kind: 'tier', text: 'Detailed 3-D air chosen: about 41 ms per air step.' },
  { wallMs: NOW - 30_000, runS: 1800, kind: 'slow', text: 'The simulation is falling behind: computing about 430×, asked for 600×.' },
];

let engine: EngineInfo;
let fastEngine: EngineInfo;
beforeAll(() => {
  const sc = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], options: { snapshotInterval: 300 } });
  let last: SimSnapshot | null = null;
  const sim = new Simulation(sc, { hooks: { snapshot: (s) => (last = s) } });
  sim.advance(1200);
  // The real engine's report is the fast tier's; the 3-D variant changes what the tier says and the timing test.
  fastEngine = { ...(last!.engine as EngineInfo), perf };
  engine = {
    ...fastEngine,
    tier: 'standard',
    tierRequested: 'auto',
    tierCause: 'auto-tune',
    tierReason: 'Auto: the 3-D air steps took about 41 ms each on this device, so the whole run should compute in about 2 min: the 3-D atmosphere was kept.',
    autoTune: { stepMs: 41.1, predictedS: 124, budgetS: 600, chosen: 'standard', steps: 30, warmupSteps: 10, warmupMeanMs: 52.3 },
    atmosphere: { ...fastEngine.atmosphere, kind: '3d', nx: 45, ny: 45, nz: 20, dxM: 133, spunUp: true, meanStepMs: 41.1 },
  };
}, 120000);

let device: Awaited<ReturnType<typeof fullState>>;
async function fullState(env: DeviceEnv = fullEnv()): Promise<{ now: ReturnType<typeof deviceInfoNow>; later: Awaited<ReturnType<typeof deviceInfoAsync>> }> {
  return { now: deviceInfoNow(env), later: await deviceInfoAsync(env) };
}
beforeAll(async () => {
  device = await fullState();
});

/** Everything present, a custom place. */
function full(): DebugStatsInput {
  return {
    engine,
    engineSource: 'real',
    run: { id: CUSTOM_ID, extentM: 6000, fireCellM: 30, durationS: 21600, startTimeMs: Date.UTC(2026, 9, 11, 3, 0), seed: 1 },
    playback: { playing: true, viewTime: 5530, headTime: 5700, speed: 600, seeking: false, reviewing: false, pace, workerSpeed: 430 },
    frames,
    longTasks: { supported: true, count: 4, totalMs: 612, maxMs: 310 },
    quality,
    qualityAsk: null,
    terrain,
    store: { bytes: 61e6, maxBytes: 96e6, keyframes: 18, keyframeBytes: 54e6, newestBytes: 4e6, frames: 150, spacingS: 63, displayStepS: 60, range: { start: 0, end: 9600 } },
    historyBudget: { bytes: 96 * 1048576, memoryGb: 4 },
    heap: { usedBytes: 88e6, totalBytes: 120e6, limitBytes: 2.1e9 },
    device: device.now,
    deviceLater: device.later,
    events,
    errors: [],
    hide: [CUSTOM_NAME],
    build: { version: '0.3.0', id: 'BX3k9aQz', mode: 'capacitor' },
    clock: { nowMs: NOW, bootMs: 540_000, runStartMs: NOW - 125_000, tzOffsetMin: 660 },
    siteNames: { katoomba: 'Katoomba – Narrow Neck & Megalong escarpment', tomah: 'Mount Tomah' },
  };
}

/** Nothing but the phone's synchronous facts: opened from Setup in a browser that tells little. */
function bare(): DebugStatsInput {
  return {
    engine: null,
    engineSource: 'real',
    run: null,
    playback: null,
    frames: null,
    longTasks: { supported: false, count: 0, totalMs: 0, maxMs: 0 },
    quality: null,
    qualityAsk: null,
    terrain: undefined,
    store: null,
    historyBudget: null,
    heap: null,
    device: deviceInfoNow({ platform: 'web', nav: {} }),
    deviceLater: null,
    events: [],
    errors: [],
    build: { version: '0.3.0', id: 'development', mode: 'development' },
    clock: { nowMs: NOW, bootMs: 4000, runStartMs: null, tzOffsetMin: 0 },
    siteNames: {},
  };
}

/** Every string of the statistics (deep). */
function allText(s: DebugStats): string[] {
  const out: string[] = [s.title, ...Object.values(s.header).filter((v): v is string => typeof v === 'string')];
  for (const g of s.groups) {
    out.push(g.title, g.summary);
    for (const r of g.rows) out.push(r.label, r.value, ...(r.note ? [r.note] : []));
  }
  return out;
}

const BAD = /undefined|NaN|\bnull\b|\[object|Infinity/;

function expectClean(s: DebugStats): void {
  expect(s.groups.map((g) => [g.id, g.title])).toEqual(GROUPS);
  for (const t of allText(s)) expect(t, t).not.toMatch(BAD);
  for (const g of s.groups) {
    expect(g.summary.trim().length, g.id).toBeGreaterThan(0);
    expect(g.rows.length, g.id).toBeGreaterThan(0);
    const ids = g.rows.map((r) => r.id);
    expect(new Set(ids).size, `${g.id}: row ids are unique`).toBe(ids.length);
    for (const r of g.rows) {
      expect(r.label.trim().length, `${g.id}/${r.id}`).toBeGreaterThan(0);
      if (!r.spark) expect(r.value.trim().length, `${g.id}/${r.id}`).toBeGreaterThan(0);
    }
  }
  const text = debugStatsToText(s);
  expect(text).not.toMatch(BAD);
  expect(text.endsWith(END_MARKER)).toBe(true);
}

/** The screen keeps no-break spaces between a number and its unit; the expectations are written with plain ones. */
const plain = (t: string): string => t.replace(/\u00a0/g, ' ');

const rowOf = (s: DebugStats, group: string, id: string): StatRow => {
  const r = s.groups.find((g) => g.id === group)?.rows.find((x) => x.id === id);
  if (!r) throw new Error(`no row ${group}/${id}`);
  return { ...r, value: plain(r.value), ...(r.note ? { note: plain(r.note) } : {}) };
};

describe('the groups of the catalogue', () => {
  it('every group is there with its stable id and title, with real data and with a run that has no perf block', () => {
    const s = buildDebugStats(full());
    expectClean(s);
    const noPerf = full();
    noPerf.engine = { ...engine, perf: undefined };
    expectClean(buildDebugStats(noPerf));
  });

  it('with nothing but the phone (opened from Setup before any run): every group still renders, the run groups say "No run yet"', () => {
    const s = buildDebugStats(bare());
    expectClean(s);
    expect(rowOf(s, 'run', 'clock').value).toBe('No run yet');
    expect(rowOf(s, 'choices', 'tier').value).toBe('No run yet');
    expect(s.header).toMatchObject({ status: 'No run yet', run: 'no run yet', seed: null });
    // The phone groups are live even then.
    expect(rowOf(s, 'hardware', 'cores').value).toBe('Not reported');
  });

  it('the Display group before a run says "No run yet" (there is no view), not that the view keeps no statistics; a view that cannot say says "Not available"', () => {
    const before = buildDebugStats(bare());
    for (const id of ['fps', 'picture-quality', 'cliffs']) expect(rowOf(before, 'display', id).value, id).toBe('No run yet');
    const map = full();
    map.frames = null;
    map.quality = null;
    map.terrain = undefined; // the 2-D map: a run, and a view with none of the 3-D statistics
    const flat = buildDebugStats(map);
    expect(rowOf(flat, 'display', 'fps').value).toBe('Not available (this view keeps no frame statistics)');
    expect(rowOf(flat, 'display', 'picture-quality').value).toBe('Not available (this view does not report a picture tier)');
    expect(rowOf(flat, 'display', 'cliffs')).toMatchObject({ label: 'Cliff drawing (once per scenario)', value: 'Not available' });
    // A 3-D view that built nothing sharpened says so, and one that did shows its numbers.
    expect(rowOf(buildDebugStats({ ...full(), terrain: null }), 'display', 'cliffs').value).toBe('Nothing sharpened in this run (no 10 m terrain)');
  });

  const missing: [string, (i: DebugStatsInput) => void][] = [
    ['no engine report yet', (i) => (i.engine = null)],
    ['a mock engine', (i) => ((i.engineSource = 'mock'), (i.engine = { ...engine, mock: true }))],
    ['no run facts', (i) => (i.run = null)],
    ['no playback state', (i) => (i.playback = null)],
    ['no pace judgement', (i) => (i.playback = { ...i.playback!, pace: null })],
    ['a pace with no measurements', (i) => (i.playback = { ...i.playback!, pace: { ...pace, achieved: null, capacity: null, duty: null } })],
    ['no frame statistics (the 2-D map)', (i) => (i.frames = null)],
    ['a frame ring that is still empty', (i) => (i.frames = { ...frames, fps10: null, frameMeanMs: null, frameP95Ms: null, frames: 0, over33: 0, over100: 0, lastDrawAgeS: null })],
    ['no picture quality facts', (i) => (i.quality = null)],
    ['a terrain view that cannot say, and one with nothing sharpened', (i) => (i.terrain = undefined)],
    ['nothing sharpened', (i) => (i.terrain = null)],
    ['sharpening numbers not measured', (i) => (i.terrain = { ...terrain, sharpenedShare: null, sharpenMs: null, maskMs: null, meshMs: null, gradientMs: null, rockDetail: 'off' })],
    ['no history store', (i) => (i.store = null)],
    ['an empty history store', (i) => (i.store = { bytes: 0, maxBytes: 0, keyframes: 0, keyframeBytes: 0, newestBytes: 0, frames: 0, spacingS: 60, displayStepS: 60, range: null })],
    ['no history budget', (i) => (i.historyBudget = null)],
    ['no JavaScript heap figure', (i) => (i.heap = null)],
    ['a heap with no limit', (i) => (i.heap = { usedBytes: 5e7, totalBytes: null, limitBytes: null })],
    ['no long-task API', (i) => (i.longTasks = { supported: false, count: 0, totalMs: 0, maxMs: 0 })],
    ['the slow phone facts still being read', (i) => (i.deviceLater = null)],
    ['no events and no errors', (i) => ((i.events = []), (i.errors = []))],
    ['a perf block of nulls (a run that has just started)', (i) => (i.engine = { ...engine, perf: { ...perf, speed: { s10: null, s60: null, mean: null, best10: null, worst10: null }, history: [null, null], step: { nowS: null, minS: null, meanS: null, maxS: null, medianMs: null, p95Ms: null, maxMs: null, over100: 0, over250: 0 }, duty: { s10: null, s60: null }, modules: [], quality: { limitedBy: null, maxWindH: null, maxWindV: null, projectionCorrections: null, spinUpWallS: null, fireSubSteps: null, burningCells: null }, embers: null } })],
    ['no engine memory measurement', (i) => (i.engine = { ...engine, memory: undefined })],
    ['no timing test (a requested tier)', (i) => (i.engine = { ...engine, autoTune: null, tierRequested: 'fast', tierCause: 'requested' })],
    ['as fast as possible playback', (i) => (i.playback = { ...i.playback!, speed: Infinity })],
    ['non-finite numbers where the engine had a hiccup', (i) => (i.frames = { ...frames, fps10: NaN, frameMeanMs: Infinity, lastDrawAgeS: NaN })],
  ];
  for (const [name, patch] of missing) {
    it(`renders with ${name}: never undefined, NaN, null or Infinity, same groups, ends with the marker`, () => {
      const i = full();
      patch(i);
      expectClean(buildDebugStats(i));
    });
  }
});

describe('labels and values', () => {
  let s: DebugStats;
  beforeAll(() => {
    s = buildDebugStats(full());
  });

  it('stable labels developers read in a paste', () => {
    expect(Object.fromEntries(s.groups.filter((g) => g.id !== 'events').map((g) => [g.id, g.rows.map((r) => r.label)]))).toEqual(LABELS);
  });

  it('Speed: the worker perf block, the speed asked for and the pace signal', () => {
    expect(rowOf(s, 'speed', 's10')).toMatchObject({ label: 'Computing speed, last 10 s', value: '871×' });
    expect(rowOf(s, 'speed', 'best10').value).toBe('905×');
    expect(rowOf(s, 'speed', 'wanted')).toMatchObject({ value: '600×', note: '10 min of fire per second' });
    expect(rowOf(s, 'speed', 'achieved').value).toBe('410×');
    expect(rowOf(s, 'speed', 'waiting').value).toBe('27 %');
    expect(rowOf(s, 'speed', 'pace').value).toBe('Waiting for the simulation');
  });

  it('Max speed has no speed asked for; a pace of null is "not judged now"', () => {
    const i = full();
    i.playback = { ...i.playback!, speed: Infinity, pace: null };
    const m = buildDebugStats(i);
    expect(rowOf(m, 'speed', 'wanted').value).toBe('Max (as fast as possible)');
    expect(rowOf(m, 'speed', 'achieved').value).toBe('Not judged now');
    expect(rowOf(m, 'choices', 'playback').value).toBe('Max (as fast as possible)');
  });

  it('Speed history lists the 20 samples oldest first with a gap marker, and carries the series for the chart', () => {
    const r = rowOf(s, 'history', 'samples');
    expect(r.value.split(' ')).toHaveLength(20);
    expect(r.value.startsWith('880 870 - 860 ')).toBe(true);
    expect(rowOf(s, 'history', 'chart').spark).toHaveLength(20);
  });

  it('Where the time goes: ms per step and the shares, a module with nothing measured says so', () => {
    expect(rowOf(s, 'time', 'air').value).toBe('6.2 ms per step, 52 % of busy time');
    expect(rowOf(s, 'time', 'air').note).toBe('Last 10 s: 50 %');
    expect(rowOf(s, 'time', 'other').value).toBe('Not measured yet');
    expect(s.groups.find((g) => g.id === 'time')!.summary).toBe('3-D air step 52\u00a0%');
  });

  it('the 3-D air step is one number in "Step", "Where the time goes" and the phone sentence (the engine\'s own reading also holds the wind for the fire and its heat)', () => {
    const i = full();
    i.engine = { ...engine, atmosphere: { ...engine.atmosphere, meanStepMs: 133 }, perf: { ...perf, modules: perf.modules.map((m) => (m.id === 'air' ? { ...m, ms: 116 } : m)) } };
    const d = buildDebugStats(i);
    expect(rowOf(d, 'step', 'air-mean')).toMatchObject({ value: '116 ms', note: 'The air module alone, as in "Where the time goes"' });
    expect(rowOf(d, 'time', 'air').value).toBe('116 ms per step, 52 % of busy time');
    expect(rowOf(d, 'canDo', 'speed').value).toContain('the 3-D air step takes about 116 ms on average');
    // An engine with no perf block has only its own reading, and the fast tier does not use the air step.
    i.engine = { ...engine, perf: undefined, atmosphere: { ...engine.atmosphere, meanStepMs: 133 } };
    expect(rowOf(buildDebugStats(i), 'step', 'air-mean')).toMatchObject({ value: '133 ms' });
    expect(rowOf(buildDebugStats(i), 'step', 'air-mean').note).toBeUndefined();
    i.engine = fastEngine;
    expect(rowOf(buildDebugStats(i), 'step', 'air-mean').value).toBe('Not used in this tier');
  });

  it('Solver step limit: a range in the 3-D tiers, one value when the floor and the cap are the same (the fast tier), your own limit when set', () => {
    const limit = (cadence: Partial<EngineInfo['cadence']>): string => {
      const i = full();
      i.engine = { ...engine, cadence: { ...engine.cadence, ...cadence } };
      return rowOf(buildDebugStats(i), 'choices', 'solver-limit').value;
    };
    expect(limit({ solverMaxStepS: 0, solverFloorS: 0.5, solverBoundS: 10 })).toBe('Automatic (0.5 s to 10 s)');
    expect(limit({ solverMaxStepS: 0, solverFloorS: 10, solverBoundS: 10 })).toBe('Automatic (10 s)');
    expect(limit({ solverMaxStepS: 0, solverFloorS: 9.98, solverBoundS: 10.01 })).toBe('Automatic (10 s)'); // the same as shown
    expect(limit({ solverMaxStepS: 6, solverFloorS: 10, solverBoundS: 10 })).toBe('6 s (your setting)');
  });

  it('Choices: the tier, why, and the timing test with the warm-up reading', () => {
    expect(rowOf(s, 'choices', 'tier').value).toBe('Standard (3-D air)');
    expect(rowOf(s, 'choices', 'tier').note).toBe(engine.tierReason);
    expect(rowOf(s, 'choices', 'requested').value).toBe('Auto (decided when the run starts, from a short timing test on this phone)');
    expect(rowOf(s, 'choices', 'cause').value).toBe('The timing test');
    expect(rowOf(s, 'choices', 'autotune').value).toBe('41 ms per 3-D air step over 30 steps; the warm-up steps before it averaged 52 ms');
    expect(rowOf(s, 'choices', 'autotune').note).toBe('Predicted 124 s for the whole run against a limit of 600 s; chose Standard (3-D air)');
  });

  it('Memory: budget with its memory class, what is held, thinned frames estimated from the range, the heap', () => {
    expect(rowOf(s, 'memory', 'history-budget').value).toBe('100.7 MB');
    // The limits are said in the same decimal megabytes as the figure (the real app once printed "167.8 MB ... between 48 and 160 MB": 160 MiB is 167.8 MB).
    expect(plain(rowOf(s, 'memory', 'history-budget').note!)).toBe('6 % of the 4 GB memory class, between 50.3 MB and 167.8 MB; older pictures are thinned beyond it, the fire front of any time is still rebuilt exactly');
    expect(rowOf(s, 'memory', 'history-held').value).toBe('61.0 MB of 96.0 MB');
    expect(rowOf(s, 'memory', 'full-pictures').value).toBe('18');
    // 9600 s at a 60 s step = 161 frames expected, 150 kept: about 11 thinned away.
    expect(rowOf(s, 'memory', 'thinned')).toMatchObject({ value: 'About 11', note: 'Kept frames are now about 63 s apart (display step 60 s)' });
    expect(rowOf(s, 'memory', 'heap').value).toBe('88.0 MB used of 120.0 MB, limit 2.1 GB');
    const noMem = full();
    noMem.historyBudget = { bytes: 48 * 1048576, memoryGb: null };
    expect(rowOf(buildDebugStats(noMem), 'memory', 'history-budget').note).toContain('3 GB assumed');
  });

  it('Frames thinned away: when none were, it says so and does not talk of kept frames being "now" apart (the mean spacing can sit under the display step)', () => {
    const i = full();
    i.store = { ...i.store!, frames: 190, spacingS: 50, displayStepS: 60, range: { start: 0, end: 9600 } }; // 161 expected, 190 kept
    expect(rowOf(buildDebugStats(i), 'memory', 'thinned')).toMatchObject({ value: 'None', note: 'The display step is 60 s' });
    i.store = { ...i.store, frames: 161 }; // exactly as many as expected
    expect(rowOf(buildDebugStats(i), 'memory', 'thinned').value).toBe('None');
    i.store = { ...i.store, frames: 0, range: null };
    expect(rowOf(buildDebugStats(i), 'memory', 'thinned').value).toBe('Not measured yet');
  });

  it('Display: frames, slow frames, long tasks, draw calls, pixel ratio drops, picture quality and why, and the cliff drawing', () => {
    expect(rowOf(s, 'display', 'fps').value).toBe('29 frames per second');
    expect(rowOf(s, 'display', 'slow-frames').value).toBe('41 and 3');
    expect(rowOf(s, 'display', 'long-tasks').value).toBe('4 (612 ms in all, longest 310 ms)');
    expect(rowOf(s, 'display', 'draw-calls').value).toBe('212 and 910000');
    expect(rowOf(s, 'display', 'pixel-ratio')).toMatchObject({ value: '1.50 and 1.75', note: "The cap is the tier's or the screen's own ratio, whichever is lower. The adaptive resolution has lowered the ratio 1 time" });
    expect(rowOf(s, 'display', 'picture-quality').value).toBe('Medium (guessed from this phone: 6 cores, 4 GB)');
    expect(rowOf(s, 'display', 'picture-sets').value).toBe('terrain 320 x 320 samples, 32000 trees, 170k canopy triangles, pixel ratio cap for this tier 1.75, 5000 flame sites, 1500 smoke puffs, tree sway on by default');
    expect(rowOf(s, 'display', 'cliffs').value).toBe('5 % of the 10 m cells moved; sharpening 180 ms, rock mask 70 ms, mesh 95 ms, lighting 40 ms');
    expect(rowOf(s, 'display', 'cliffs').note).toBe('102400 vertices, 204000 triangles; rock detail in the shader: high');
  });

  it('the frame rate says "1 frame per second", not "1 frames", in the row and in the group line', () => {
    const at = (fps10: number): DebugStats => buildDebugStats({ ...full(), frames: { ...frames, fps10 } });
    expect(rowOf(at(1), 'display', 'fps').value).toBe('1 frame per second');
    expect(rowOf(at(1.4), 'display', 'fps').value).toBe('1 frame per second'); // rounds to 1
    expect(plain(at(1).groups.find((g) => g.id === 'display')!.summary)).toBe('Medium picture; 1 frame per second');
    expect(rowOf(at(0.4), 'display', 'fps').value).toBe('0 frames per second');
    expect(rowOf(at(60), 'display', 'fps').value).toBe('60 frames per second');
  });

  it('picture quality says "set by you", "asked for by the Detail profile" or the guess with its numbers', () => {
    const base = { source: 'option' as const, cores: 8, memoryGb: 6 };
    expect(pictureQualityWhy(base, 'set')).toBe('set by you');
    expect(pictureQualityWhy(base, 'detail')).toBe('asked for by the Detail profile');
    expect(pictureQualityWhy(base, null)).toBe('asked for by the app');
    expect(pictureQualityWhy({ source: 'guess', cores: 4, memoryGb: 3 }, null)).toBe('guessed from this phone: 4 cores, 3 GB');
    expect(pictureQualityWhy({ source: 'guess', cores: null, memoryGb: null }, null)).toBe('guessed from this phone: cores not reported (counted as 4), memory not reported (counted as 4 GB)');
    // only an option has a reason of its own: a guess is a guess whatever the settings were when it was made
    expect(pictureQualityWhy({ source: 'guess', cores: 4, memoryGb: 3 }, 'set')).toBe('guessed from this phone: 4 cores, 3 GB');
  });

  it('the picture quality row keeps the reason it was built with, whatever the settings are now', () => {
    // The reason is an input (taken when the view was built), not read from the settings when the screen opens.
    expect(rowOf(buildDebugStats({ ...full(), qualityAsk: 'set' }), 'display', 'picture-quality').value).toBe('Medium (guessed from this phone: 6 cores, 4 GB)'); // the fixture's view guessed
    const option = { ...full(), quality: { ...quality, source: 'option' as const } };
    expect(rowOf(buildDebugStats({ ...option, qualityAsk: 'set' }), 'display', 'picture-quality').value).toBe('Medium (set by you)');
    expect(rowOf(buildDebugStats({ ...option, qualityAsk: 'detail' }), 'display', 'picture-quality').value).toBe('Medium (asked for by the Detail profile)');
    expect(rowOf(buildDebugStats({ ...option, qualityAsk: null }), 'display', 'picture-quality').value).toBe('Medium (asked for by the app)');
  });

  it('What this phone can do: three measured sentences', () => {
    const rows = s.groups.find((g) => g.id === 'canDo')!.rows;
    expect(rows.map((r) => r.id)).toEqual(['speed', 'memory', 'graphics']);
    expect(rows[2]!.value).toBe('WebGL2 on Mali-G710, float render targets yes, WebGPU present.'); // the row's label already says "Graphics"
    expect(rows[1]!.value).toContain('of a 2.1\u00a0GB limit');
    expect(plain(rows[0]!.value)).toBe('On this phone the 3-D air step takes about 6.2 ms on average (41 ms in the timing test), and the run computes at about 843× real time.');
    const fast = full();
    fast.engine = fastEngine;
    expect(rowOf(buildDebugStats(fast), 'canDo', 'speed').value).toBe('The fast model has computed this run at about 843× real time.');
    const mock = full();
    mock.engineSource = 'mock';
    expect(rowOf(buildDebugStats(mock), 'canDo', 'speed').value).toBe('The demo engine is running, so nothing was measured.');
    expect(rowOf(buildDebugStats(bare()), 'canDo', 'speed').value).toBe('No run has measured this phone yet. Start a run, or look here again during one.');
  });

  it('Summary: tier, speed, memory and the phone class in one line; the demo engine and "no run" say so', () => {
    const line = rowOf(s, 'summary', 'headline').value;
    expect(line).toContain('Standard (3-D air), computing about 871× (600× asked for)');
    expect(line).toMatch(/this phone: 8 cores, about 6 GB memory class\.$/);
    expect(rowOf(buildDebugStats(bare()), 'summary', 'headline').value).toBe('No run yet. This phone: cores not reported, memory class not reported.');
    const mock = full();
    mock.engineSource = 'mock';
    expect(rowOf(buildDebugStats(mock), 'summary', 'headline').value).toMatch(/^The demo engine is running: nothing is simulated/);
  });
});

describe('the phone groups', () => {
  it('a normal WebView: model and Android version with API level from the user agent or hints, WebGL2 renderer, refresh rate, battery, WebGPU', async () => {
    const s = buildDebugStats(full());
    expect(rowOf(s, 'hardware', 'model')).toMatchObject({ value: 'Google Pixel 7', note: 'From the client hints; the maker is guessed from the model name' });
    expect(rowOf(s, 'hardware', 'android').value).toBe('13 (API level 33)');
    expect(rowOf(s, 'hardware', 'arch').value).toBe('arm, 64-bit');
    expect(rowOf(s, 'hardware', 'memory-class').value).toBe('About 6 GB');
    expect(rowOf(s, 'hardware', 'screen').value).toBe('412 x 915 CSS pixels, about 1082 x 2402 device pixels');
    expect(rowOf(s, 'hardware', 'refresh').value).toBe('About 60 Hz');
    expect(rowOf(s, 'hardware', 'battery').value).toBe('64 %, not charging');
    expect(rowOf(s, 'software', 'webview').value).toBe('Android WebView 120.0.6099.144');
    expect(rowOf(s, 'software', 'user-agent').value).toBe(UA_WEBVIEW);
    expect(rowOf(s, 'software', 'gpu').value).toBe('ARM, Mali-G710');
    expect(rowOf(s, 'software', 'webgpu').value).toBe('Yes, arm valhall');
    expect(rowOf(s, 'software', 'wasm').value).toBe('Yes and Yes');
    expect(rowOf(s, 'software', 'compressed').value).toBe('ASTC');
  });

  it('a reduced user agent with no Client Hints: model and Android version are "hidden by the WebView", not guessed; no battery API; no WebGPU', async () => {
    const env: DeviceEnv = { platform: 'android', nav: { userAgent: UA_REDUCED, hardwareConcurrency: 4, deviceMemory: 3 }, timeoutMs: 20, openGl2: () => null };
    const st = await fullState(env);
    const i = full();
    i.device = st.now;
    i.deviceLater = st.later;
    const s = buildDebugStats(i);
    expectClean(s);
    expect(rowOf(s, 'hardware', 'model')).toMatchObject({ value: 'Hidden by the WebView', note: 'Its user agent is reduced ("Android 10; K")' });
    expect(rowOf(s, 'hardware', 'android').value).toBe('Hidden by the WebView');
    expect(rowOf(s, 'hardware', 'battery').value).toBe('Not available on this phone');
    expect(rowOf(s, 'hardware', 'arch').value).toBe('Not reported (needs Client Hints)');
    expect(rowOf(s, 'software', 'webview').value).toBe('Chromium-based browser 120');
    expect(rowOf(s, 'software', 'webview').note).toBe('This browser sends no Client Hints');
    expect(rowOf(s, 'software', 'webgpu').value).toBe('No');
    expect(rowOf(s, 'software', 'webgl2').value).toBe('No: the 3-D view cannot run, the 2-D map is used');
    expect(rowOf(s, 'software', 'gpu').value).toBe('Not available');
    expect(rowOf(s, 'canDo', 'graphics').value).toBe('WebGL2 is not available, so the 3-D view cannot run and the 2-D map is used.');
    // The raw user agent is always printed, so a developer sees exactly what the WebView said.
    expect(debugStatsToText(s)).toContain(UA_REDUCED);
  });

  it('while the slow facts are still being read the rows say "Reading..." (and the copy is still complete)', () => {
    const i = full();
    i.deviceLater = null;
    const s = buildDebugStats(i);
    expectClean(s);
    expect(rowOf(s, 'hardware', 'refresh').value).toBe('Reading...');
    expect(rowOf(s, 'software', 'graphics').value).toBe('Reading...');
    expect(rowOf(s, 'canDo', 'graphics').value).toBe('The graphics probe is still running.');
  });
});

describe('the header, the copy and its shape', () => {
  it('title, a header with the time and its UTC offset, the app, the run clock and the seed; every group; the end marker', () => {
    const text = debugStatsToText(buildDebugStats(full()));
    const lines = text.split('\n');
    expect(lines[0]).toBe(`FireSim: ${TITLE}`);
    expect(lines[1]).toBe('Copied 2026-10-11 14:32:05 (UTC+11) | app 0.3.0 (build BX3k9aQz, capacitor) | run 01:32:10 | seed 1');
    for (const [, title] of GROUPS) expect(lines).toContain(`== ${title} ==`);
    expect(lines.indexOf('== Summary ==')).toBeLessThan(lines.indexOf('== Speed =='));
    expect(lines.indexOf('== Memory ==')).toBeLessThan(lines.indexOf('== Phone: hardware =='));
    expect(lines.indexOf('== Phone: software and graphics ==')).toBeLessThan(lines.indexOf('== Recent events =='));
    expect(lines[lines.length - 1]).toBe('-- end --');
    expect(text).toContain('  Computing speed, last 10 s: 871× (Simulated seconds per wall second while the worker computes)');
    // One row per line, plain spaces (no no-break spaces in a paste).
    expect(text).not.toContain(' ');
  });

  it('the status word and the run text follow the playback: live, paused, finished, demo engine', () => {
    const at = (patch: (i: DebugStatsInput) => void): DebugStats['header'] => {
      const i = full();
      patch(i);
      return buildDebugStats(i).header;
    };
    expect(at(() => undefined)).toMatchObject({ status: 'Live', run: 'run 01:32:10' });
    expect(at((i) => (i.playback = { ...i.playback!, playing: false }))).toMatchObject({ status: 'Paused', run: 'run 01:32:10 (paused)' });
    expect(at((i) => (i.playback = { ...i.playback!, playing: false, viewTime: 21600 }))).toMatchObject({ status: 'Finished', run: 'run 06:00:00 (finished)' });
    expect(at((i) => (i.engineSource = 'mock'))).toMatchObject({ status: 'Demo engine' });
  });

  it('a negative or half-hour UTC offset is named correctly', () => {
    for (const [offset, name] of [[-180, 'UTC-3'], [330, 'UTC+5:30'], [0, 'UTC']] as const) {
      const i = full();
      i.clock = { ...i.clock, tzOffsetMin: offset };
      expect(buildDebugStats(i).header.copiedAt).toMatch(new RegExp(`\\(${name.replace('+', '\\+')}\\)$`));
    }
  });
});

describe('privacy: no coordinates, no custom place name, no identifier', () => {
  const dirty = (): DebugStatsInput => {
    const i = full();
    i.errors = [
      `unhandled rejection: TypeError: Failed to fetch https://api.open-meteo.com/v1/forecast?latitude=-33.715432&longitude=150.285123 for ${CUSTOM_NAME}\n    at fetchWeather (index-BX3k9aQz.js:1:2)`,
      'error: Could not build "Smiths Creek Rd, 12 Example St" at -33.7154321, 150.2851234 (index-BX3k9aQz.js:77)',
    ];
    i.events = [...events, { wallMs: NOW - 10_000, runS: 60, kind: 'tier', text: `Started near ${CUSTOM_NAME}.` }];
    return i;
  };

  it('a custom place: the copy never holds its name, its position, the scenario id or a link', () => {
    const text = debugStatsToText(buildDebugStats(dirty()));
    expect(text).not.toContain(CUSTOM_NAME);
    expect(text).not.toContain('Smiths Creek');
    expect(text).not.toContain(CUSTOM_ID);
    // Nothing that looks like a coordinate: no number with three or more decimals (the raw user agent, whose version numbers do, is the one exception).
    expect(text.split('\n').filter((l) => !l.includes('User agent')).join('\n').replace(/\d+(\.\d+){3}/g, 'version').match(/-?\d{1,3}\.\d{3,}/g)).toBeNull();
    expect(text).not.toMatch(/-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+/);
    expect(text).not.toMatch(/33\.7|150\.2|https?:\/\//);
    expect(text).toContain('A custom place (its name and position are never copied)');
    expect(text).toContain('<place>');
  });

  it('a bundled site is named by its own name (it identifies no one)', () => {
    const i = full();
    i.run = { ...i.run!, id: 'katoomba-20261011T0300Z-now' };
    const s = buildDebugStats(i);
    expect(rowOf(s, 'run', 'place').value).toBe('Katoomba – Narrow Neck & Megalong escarpment');
    expect(s.groups.find((g) => g.id === 'run')!.summary).toContain('Katoomba');
  });

  it('only the last five uncaught errors, newest first, each on one scrubbed line', () => {
    const i = full();
    i.errors = Array.from({ length: 8 }, (_, n) => `error: boom ${n} (x.js:1)`);
    const rows = buildDebugStats(i).groups.find((g) => g.id === 'events')!.rows.filter((r) => r.id.startsWith('x'));
    expect(rows.map((r) => r.value)).toEqual(['error: boom 7 (x.js:1)', 'error: boom 6 (x.js:1)', 'error: boom 5 (x.js:1)', 'error: boom 4 (x.js:1)', 'error: boom 3 (x.js:1)']);
  });

  it('scrubError: first line only, links and long decimals out, a hidden text replaced, 160 characters at most, never empty', () => {
    expect(scrubError('a\nb')).toBe('a');
    expect(scrubError('see https://x.test/?q=-33.7154,150.2851 now')).toBe('see <link> now');
    expect(scrubError('at -33.7154321, 150.2851234 and 41.1 ms')).toBe('at <number>, <number> and 41.1 ms');
    expect(scrubError('Place: Foo Bar', ['Foo Bar'])).toBe('Place: <place>');
    // Seen in the real app's copy: a pair of two-decimal coordinates and the Maps link's plus-joined name passed through.
    expect(scrubError('plain string: near -33.54,150.41 (maps/place/Mount+Tomah+Botanic+Garden)', ['Mount Tomah Botanic Garden'])).toBe('plain string: near <position> (maps/place/<place>)');
    expect(scrubError('no data for Mount%20Tomah%20Botanic%20Garden', ['Mount Tomah Botanic Garden'])).toBe('no data for <place>');
    expect(scrubError('took 1.5, 2.5 and 41.1 ms')).toBe('took <position> and 41.1 ms'); // the price of the pair rule: two short decimals in a row read as a position
    expect(scrubError('x'.repeat(500))).toHaveLength(160);
    expect(scrubError('')).toBe('Unknown error');
    expect(scrubError('ab', ['a'])).toBe('ab'); // one-letter names are not worth replacing (and would wreck the text)
  });
});

describe('Recent events', () => {
  it('lists the events newest first with their wall clock (in the phone\'s time), run clock and kind', () => {
    const rows = buildDebugStats(full()).groups.find((g) => g.id === 'events')!.rows;
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['14:31:35 (run 00:30:00, speed)', 'The simulation is falling behind: computing about 430×, asked for 600×.'],
      ['14:30:35 (run 00:00:00, tier)', 'Detailed 3-D air chosen: about 41 ms per air step.'],
      ['14:30:05 (run 00:00:00, start)', 'Run started.'],
    ]);
  });

  it('every kind of event has its own short word, also with no run clock', () => {
    const kinds: LogEvent['kind'][] = ['run', 'tier', 'slow', 'app', 'rewind', 'restore', 'long-steps', 'history'];
    const i = full();
    i.events = kinds.map((kind, n) => ({ wallMs: NOW + n * 1000, runS: n % 2 ? null : 60, kind, text: `event ${kind}` }));
    const rows = buildDebugStats(i).groups.find((g) => g.id === 'events')!.rows;
    const words = rows.map((r) => /, ([^)]+)\)$/.exec(r.label)?.[1]);
    expect(words).toEqual(['history', 'long steps', 'restore', 'rewind', 'app', 'speed', 'tier', 'start']); // newest first
    expect(rows.find((r) => r.value === 'event app')!.label).toMatch(/\(no run clock, app\)$/);
  });

  it('keeps 40 at most, and says "Nothing yet" for none', () => {
    const i = full();
    i.events = Array.from({ length: 60 }, (_, n) => ({ wallMs: NOW + n, runS: null, kind: 'run' as const, text: `e${n}` }));
    const rows = buildDebugStats(i).groups.find((g) => g.id === 'events')!.rows;
    expect(rows).toHaveLength(40);
    expect(rows[0]!.value).toBe('e59');
    expect(rows[0]!.label).toContain('no run clock');
    const none = full();
    none.events = [];
    expect(buildDebugStats(none).groups.find((g) => g.id === 'events')!.rows[0]!.value).toBe('Nothing yet');
  });
});
