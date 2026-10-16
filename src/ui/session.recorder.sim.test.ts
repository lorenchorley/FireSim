/**
 * The Air slice recorder (0.4.1) behind a REAL session on the REAL engine: for each place the session cuts its history (an edit made in
 * the past, a what-if, a solver step change, undoing an ignition, a tier switch) the recorder ends up holding exactly the pictures of the
 * history that is left, with the content of THAT run. The oracle is a bare engine given the same operation, never the session: a fresh run
 * is the history the recorder must agree with, picture by picture, to the packing bound. session.recorder.test.ts checks the calls with a
 * scripted engine whose air never changes; this is the check that no sample of the replaced run survives. The worker's messages are also
 * delayed (a real Worker's latency), so results posted before an edit was sent arrive after it. Set FIRESIM_SKIP_SLOW=1 to skip (about 60 s).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SLICE_RECORDER_MAX_BYTES } from '../core/sliceRecording';
import type { ScenarioData, SimSnapshot } from '../core/types';
import { AtmosphereSampler } from '../render/atmosphereSampler';
import type { SceneViewApi } from '../render/api';
import { HeightField } from '../render/heightfield';
import { resolveSlice } from '../render/slice/sectionLine';
import { sampleSlice } from '../render/slice/sliceField';
import { createSliceTimeLapse, type SliceTimeLapse } from '../render/slice/sliceTimeLapse';
import type { SliceLineState } from '../render/slice/types';
import { LocalSimController } from '../sim/client';
import { Simulation } from '../sim/simulation';
import { pointIgnition, syntheticScenario } from '../sim/testing/scenarios';
import { SimSession } from './session';

const SKIP = typeof process !== 'undefined' && process.env['FIRESIM_SKIP_SLOW'] === '1';
const HEAD = 1200; // s of simulated time computed before the operation
const VIEW = 780; // where the view is when it is made
const LINE: SliceLineState = { azimuth: 0, centre: [0, 0], a: [-1300, -600], b: [1250, 700], preset: null };
const WIND = { kind: 'wind' as const, id: 'w1', x: 0, y: 0, radius: 1500, speed: 18, dir: 200 };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number, what: string): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(5);
  }
}

const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
let savedRaf: unknown;
let savedCaf: unknown;
let live: SimSession | null = null;
beforeEach(() => {
  savedRaf = g.requestAnimationFrame;
  savedCaf = g.cancelAnimationFrame;
  g.requestAnimationFrame = (cb: (n: number) => void): number => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  g.cancelAnimationFrame = (id: number): void => clearTimeout(id as unknown as NodeJS.Timeout);
});
afterEach(() => {
  live?.dispose();
  live = null;
  g.requestAnimationFrame = savedRaf;
  g.cancelAnimationFrame = savedCaf;
});

interface Setup {
  scenario: ScenarioData;
  ground: HeightField;
}
/** A 3 km model with two ignitions (the second at 360 s, so that undoing it changes everything after it), 60 s pictures. */
function setup(tier: 'fast' | 'standard'): Setup {
  const scenario = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60), pointIgnition('b', 400, -300, 360, 60)], extent: 3000, cellSize: 60, windKmh: 26, duration: 7200, options: { snapshotInterval: 60, tier } });
  return { scenario, ground: new HeightField(scenario.terrain.grid, scenario.terrain.elevation, 1) };
}

/** What the recorder should hold of one picture: the slice of the line in the air of that snapshot. */
type Picture = { kind: string; along: Float32Array; across: Float32Array; up: Float32Array; theta: Float32Array; smoke: Float32Array };

/** The history a bare engine ends with after the same operation: the receiver's rule (a snapshot at t drops every one at or after t; `rewound(t)` drops every one after t). */
function freshHistory(s: Setup, tier: 'fast' | 'standard', operate: (sim: Simulation) => void): Map<number, Picture> {
  const pictures = new Map<number, Picture>();
  const take = (snap: SimSnapshot): void => {
    for (const t of [...pictures.keys()]) if (t >= snap.time) pictures.delete(t);
    const air = snap.atmosphere;
    if (!air) return;
    const ctx = { grid: air.grid, heightAt: (x: number, y: number) => s.ground.heightAt(x, y), mapCentre: [0, 0] as [number, number], fire: null, windFromDeg: 270, user: null };
    const line = resolveSlice(LINE, ctx).line;
    const d = line ? sampleSlice(new AtmosphereSampler(air, air.baseM!, snap.stats?.weather ?? null), s.ground, { line, shownTime: snap.time }) : null;
    if (d) pictures.set(snap.time, { kind: d.kind, along: d.values.along.slice(), across: d.values.across.slice(), up: d.values.up.slice(), theta: d.values.theta.slice(), smoke: d.values.smoke.slice() });
  };
  const sim = new Simulation(s.scenario, {
    tier,
    minSnapshotWallMs: 0,
    hooks: {
      snapshot: take,
      rewound: (t) => {
        for (const k of [...pictures.keys()]) if (k > t) pictures.delete(k);
      },
    },
  });
  take(sim.snapshot()); // the picture the worker posts when a run starts
  sim.advance(HEAD);
  operate(sim);
  return pictures;
}

interface Rig {
  session: SimSession;
  recorder: SliceTimeLapse;
  cuts: number[];
  rewinds(): number;
  /** How many pictures reached the recorder, and when the last one did. */
  arrivals(): number;
  lastArrival(): number;
}
/** A session on the real engine whose view holds a real recorder (as the scene does), the engine's messages `delayMs` late. */
function rig(s: Setup, delayMs: number): Rig {
  const recorder = createSliceTimeLapse({ line: () => LINE, enabled: () => true, terrain: () => s.ground, budgetBytes: SLICE_RECORDER_MAX_BYTES });
  const cuts: number[] = [];
  let arrived = 0;
  let count = 0;
  const api = {
    record: (snap: SimSnapshot) => {
      arrived = Date.now();
      count++;
      recorder.record(snap);
    },
    truncateAfter: (t: number) => {
      cuts.push(t);
      recorder.truncateAfter(t);
    },
    clear: () => recorder.clear(),
    status: () => recorder.status(),
  };
  const view = new Proxy({}, { get: (_t, key) => (key === 'sliceRecording' ? api : () => null) }) as unknown as SceneViewApi;
  const controller = new LocalSimController({ chunkMs: 40, simulation: { minSnapshotWallMs: 0 } });
  if (delayMs > 0) {
    const receive = (controller as unknown as { receive(m: unknown): void }).receive.bind(controller);
    (controller as unknown as { receive(m: unknown): void }).receive = (m: unknown): void => void setTimeout(() => receive(m), delayMs);
  }
  const session = new SimSession(s.scenario, controller, view, { maxBytes: 300e6 });
  let rewinds = 0;
  controller.on('rewound', () => void rewinds++);
  live = session;
  return { session, recorder, cuts, rewinds: () => rewinds, arrivals: () => count, lastArrival: () => arrived };
}

const OPERATIONS: { name: string; tier: 'fast' | 'standard'; cut: number | null; again: number; run: (session: SimSession) => void; operate: (sim: Simulation) => void }[] = [
  {
    name: 'an edit made in the past (prepareEditAt)',
    tier: 'fast',
    cut: VIEW,
    again: (HEAD - VIEW) / 60,
    run: (session) => session.edit({ ...WIND, time: 0 }),
    operate: (sim) => {
      sim.edit({ ...WIND, time: VIEW }, VIEW);
      sim.advance(HEAD);
    },
  },
  {
    name: 'a what-if from the view time (rerunWith)',
    tier: 'fast',
    cut: VIEW,
    again: (HEAD - VIEW) / 60,
    run: (session) => {
      session.rerunWith({ coupling: 0, embers: false, mountainPhenomena: false }, 'no coupling');
      session.pause(); // a what-if plays on by itself
    },
    operate: (sim) => {
      sim.setOption('coupling', 0);
      sim.setOption('embers', false);
      sim.setOption('mountainPhenomena', false);
      sim.rewind(VIEW);
      sim.advance(HEAD);
    },
  },
  {
    name: 'a solver step change (rerunFromView)',
    tier: 'fast',
    cut: VIEW,
    again: (HEAD - VIEW) / 60,
    run: (session) => session.setSolverStep(5),
    operate: (sim) => {
      sim.setOption('maxStepS', 5);
      sim.rewind(VIEW);
      sim.advance(HEAD);
    },
  },
  {
    name: 'undoing an ignition made before the view time (removeIgnition)',
    tier: 'fast',
    cut: 360,
    again: (HEAD - 360) / 60,
    run: (session) => session.removeIgnition('b'),
    operate: (sim) => {
      sim.removeIgnition('b');
      sim.advance(HEAD);
    },
  },
  {
    name: 'a tier switch, fast to the 3-D air (the worker says rewound and streams the pictures again)',
    tier: 'fast',
    cut: null,
    again: HEAD / 60,
    run: (session) => session.controller.setQuality('standard'),
    operate: (sim) => {
      sim.setQuality('standard');
      sim.advance(HEAD);
    },
  },
];

describe.skipIf(SKIP)('the recorder behind a real session on the real engine', () => {
  for (const delayMs of [0, 70]) {
    for (const op of OPERATIONS) {
      it(`${op.name}: the recording is the history that is left, worker ${delayMs} ms away`, async () => {
        const s = setup(op.tier);
        const r = rig(s, delayMs);
        const { session, recorder } = r;
        await session.start();
        session.setSpeed(Infinity);
        session.seek(HEAD);
        await until(() => session.state.get().headTime >= HEAD - 1e-6 && !session.state.get().computing, 240_000, 'the run up to the head');
        await sleep(300);
        expect(recorder.status()).toMatchObject({ state: 'recording', count: HEAD / 60 + 1, from: 0, to: HEAD, spacingS: 0 });

        session.seek(VIEW);
        const rewinds = r.rewinds();
        const arrived = r.arrivals();
        op.run(session);
        if (op.cut !== null) {
          expect(r.cuts, 'the session cut the recorder where it cuts the history').toContain(op.cut);
          expect(recorder.status().to ?? -1, 'nothing newer than the cut is left right after the call').toBeLessThanOrEqual(op.cut);
        }
        await until(() => r.rewinds() > rewinds, 60_000, 'the worker says rewound');
        session.setSpeed(Infinity);
        session.seek(HEAD);
        // the re-run is done when the engine has sent the pictures again and none comes for a while (a tier switch spins the 3-D air up first, with none)
        await until(() => r.arrivals() - arrived >= op.again && session.state.get().headTime >= HEAD - 1e-6 && !session.state.get().computing && Date.now() - r.lastArrival() > 1500, 400_000, 'the re-run');

        const history = freshHistory(s, op.tier, op.operate);
        const air = session.state.get().snapshot!.atmosphere!;
        const line = resolveSlice(LINE, { grid: air.grid, heightAt: (x, y) => s.ground.heightAt(x, y), mapCentre: [0, 0], fire: null, windFromDeg: 270, user: null }).line!;
        const held: number[] = [];
        for (let t = 0; t <= HEAD; t += 60) {
          for (const kind of ['prognostic', 'diagnosed'] as const) {
            const slice = recorder.read(line, t, kind, null, null);
            if (!slice || slice.recordedAt !== t) continue;
            held.push(t);
            const picture = history.get(t);
            if (!picture) continue;
            expect(slice.kind, `kind of the air at ${t}`).toBe(picture.kind);
            for (const field of ['along', 'across', 'up', 'theta'] as const) {
              const live = picture[field];
              let worst = 0;
              let biggest = 0;
              for (let i = 0; i < live.length; i++) {
                worst = Math.max(worst, Math.abs(live[i]! - slice.values[field][i]!));
                biggest = Math.max(biggest, Math.abs(live[i]!));
              }
              expect(worst, `${field} at ${t}: a sample of the replaced run?`).toBeLessThanOrEqual(0.502 * (biggest / 32767) + 1e-6 * Math.max(1, biggest));
            }
          }
        }
        const expected = [...history.keys()].filter((t) => t % 60 === 0 && t <= HEAD);
        expect(held.filter((t) => !history.has(t)), 'pictures of a history that is gone').toEqual([]);
        expect(expected.filter((t) => !held.includes(t)), 'pictures of the history the recorder lacks').toEqual([]);
        // a read gives the newest picture at or before the time asked
        for (const t of [59, 61, 359, 361, 779, 781, 1139]) {
          const newest = Math.max(...held.filter((h) => h <= t));
          const kind = history.get(newest)!.kind === 'prognostic' ? 'prognostic' : 'diagnosed';
          expect(recorder.read(line, t, kind, null, null)!.recordedAt).toBe(newest);
        }
      }, 600_000);
    }
  }
});
