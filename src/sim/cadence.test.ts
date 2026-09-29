/**
 * Display step, solver step and run-end snapshots (fast-forward support): the snapshot cadence follows the live
 * 'snapshotInterval' option, the solver step honours 'maxStepS' and the display step, a run-end snapshot gives the UI
 * exactly the time reached without changing any later snapshot, and coalescing keeps the rest of the stream intact.
 */
import { describe, expect, it } from 'vitest';
import type { Insight, SimSnapshot } from '../core/types';
import { LocalSimController } from './client';
import { SimHost } from './host';
import type { FromWorker } from './protocol';
import { Simulation } from './simulation';
import { snapshotPartHashes } from './testing/hash';
import { pointIgnition, syntheticScenario } from './testing/scenarios';

function collect(): { snaps: SimSnapshot[]; rewound: number[]; hooks: { snapshot: (s: SimSnapshot) => void; rewound: (t: number) => void } } {
  const snaps: SimSnapshot[] = [];
  const rewound: number[] = [];
  return { snaps, rewound, hooks: { snapshot: (s) => snaps.push(s), rewound: (t) => rewound.push(t) } };
}

const scenario = (interval: number, extra: Parameters<typeof syntheticScenario>[0] = {}) =>
  syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent: 2400, options: { snapshotInterval: interval }, ...extra });

const parts = (s: SimSnapshot): Record<string, number> => {
  const h = snapshotPartHashes(s);
  delete h['insights'];
  return h;
};
const ids = (list: SimSnapshot[]): string[] => list.flatMap((s) => s.insights.map((i: Insight) => i.id));

describe('display step', () => {
  it('defaults to 60 s and snapshots land exactly on every multiple of the step, for 10, 30, 60 and 120 s', () => {
    for (const step of [10, 30, 60, 120]) {
      const c = collect();
      const sim = new Simulation(scenario(step), { hooks: c.hooks });
      sim.advance(600);
      expect(c.snaps.map((s) => s.time), `step ${step}`).toEqual(Array.from({ length: 600 / step }, (_, i) => (i + 1) * step));
    }
    const d = collect();
    new Simulation(syntheticScenario({ ignitions: [pointIgnition('a', -300, 0)], extent: 2400 }), { hooks: d.hooks }).advance(240);
    expect(d.snaps.map((s) => s.time)).toEqual([60, 120, 180, 240]);
  }, 120000);

  it('honours the display step in the standard tier too (steps of at most 12 s that land on the 30 s marks)', () => {
    const c = collect();
    const sim = new Simulation(scenario(30, { extent: 1500 }), { hooks: c.hooks, tier: 'standard' });
    sim.advance(180);
    expect(c.snaps.map((s) => s.time)).toEqual([30, 60, 90, 120, 150, 180]);
    // At most 12 s per step, split evenly between the 30 s marks: at least 3 steps per mark.
    expect(sim.perf().steps).toBeGreaterThanOrEqual(18);
  }, 120000);

  it('a live change applies at once from the next multiple, without a rewind or a record', () => {
    const c = collect();
    const sim = new Simulation(scenario(300), { hooks: c.hooks });
    sim.advance(700);
    expect(c.snaps.map((s) => s.time)).toEqual([300, 600]);
    sim.setOption('snapshotInterval', 60);
    expect(c.rewound).toEqual([]);
    sim.advance(1030);
    expect(c.snaps.map((s) => s.time)).toEqual([300, 600, 720, 780, 840, 900, 960, 1020]);
    // Back to a long step; a rewind to a checkpoint keeps the step now in force.
    sim.setOption('snapshotInterval', 300);
    sim.advance(1900);
    expect(c.snaps.at(-1)!.time).toBe(1800);
    c.snaps.length = 0;
    sim.rewind(900);
    sim.advance(2200);
    expect(c.snaps.map((s) => s.time)).toEqual([1200, 1500, 1800, 2100]);
    expect(sim.snapshotInterval).toBe(300);
  }, 120000);

  it('the display step does not alter the trajectory: the fire, moisture, atmosphere and stats at 600 s are bitwise identical for 300 s and 60 s steps', () => {
    const a = collect();
    new Simulation(scenario(300), { hooks: a.hooks }).advance(600);
    const b = collect();
    new Simulation(scenario(60), { hooks: b.hooks }).advance(600);
    // Same 60 s marks: the solver sequence is the classic one for both. (The landing-density overlay decays lazily
    // when it is read, so reading it every 60 s or every 300 s differs in float rounding only.)
    const at = (l: SimSnapshot[], t: number): SimSnapshot => l.find((s) => s.time === t)!;
    const pa = parts(at(a.snaps, 600));
    const pb = parts(at(b.snaps, 600));
    for (const k of Object.keys(pa)) if (k !== 'layers' && k !== 'layers.landing') expect(pb[k], k).toBe(pa[k]);
    const la = at(a.snaps, 600).layers!['landing']!;
    const lb = at(b.snaps, 600).layers!['landing']!;
    for (let k = 0; k < la.length; k++) expect(Math.abs(la[k]! - lb[k]!)).toBeLessThanOrEqual(1e-4 * Math.max(1e-6, Math.abs(la[k]!)) + 1e-9);
  }, 120000);
});

describe('solver step (maxStepS)', () => {
  it('is a timed record: it caps the steps from the current time and a rewind replays it identically', () => {
    const c = collect();
    const sim = new Simulation(scenario(60), { hooks: c.hooks });
    sim.advance(600);
    expect(sim.perf().steps).toBe(60); // fast tier: 10 s steps
    sim.setOption('maxStepS', 2);
    sim.advance(660);
    expect(sim.perf().steps).toBe(60 + 30); // 2 s steps for the last minute
    sim.setOption('maxStepS', 0);
    sim.advance(900);
    expect(sim.perf().steps).toBe(60 + 30 + 24);
    const first = new Map(c.snaps.map((s) => [s.time, s]));
    // Rewind to after both records and re-run: the records are replayed at their times, same results.
    c.snaps.length = 0;
    sim.rewind(800);
    sim.advance(900);
    for (const s of c.snaps) expect(parts(s), `t=${s.time}`).toEqual(parts(first.get(s.time)!));
    expect(c.snaps.map((s) => s.time)).toEqual([840, 900]);
    // A different solver step gives a (slightly) different trajectory.
    const other = collect();
    const alt = new Simulation(scenario(60), { hooks: other.hooks });
    alt.advance(900);
    expect(parts(other.snaps.find((s) => s.time === 900)!)['fire.arrivalTime']).not.toBe(parts(first.get(900)!)['fire.arrivalTime']);
  }, 120000);

  it('never goes below 1 s and is limited by a display step that is smaller than the automatic step', () => {
    const sim = new Simulation(scenario(60), {});
    sim.setOption('maxStepS', 0.25);
    sim.advance(60);
    expect(sim.perf().steps).toBe(60); // 1 s floor
    const small = new Simulation(scenario(5), {});
    small.advance(60);
    expect(small.perf().steps).toBe(12); // 5 s steps, snapshots every 5 s
  }, 120000);
});

describe('run-end snapshot', () => {
  it('gives a snapshot at exactly the time reached, once, and none where the cadence already produced one', () => {
    const c = collect();
    const sim = new Simulation(scenario(60), { hooks: c.hooks });
    sim.advance(125);
    expect(sim.time).toBe(130);
    expect(c.snaps.map((s) => s.time)).toEqual([60, 120]);
    expect(sim.emitRunEnd()).toBe(true);
    expect(c.snaps.map((s) => s.time)).toEqual([60, 120, 130]);
    expect(c.snaps.at(-1)!.stats.time).toBe(130);
    expect(sim.emitRunEnd()).toBe(false);
    sim.advance(180);
    expect(c.snaps.map((s) => s.time)).toEqual([60, 120, 130, 180]);
    expect(sim.emitRunEnd()).toBe(false); // 180 is a cadence time
  }, 120000);

  it('chunking a run differently gives identical later snapshots (only the insight grouping may move)', () => {
    const straight = collect();
    new Simulation(scenario(60), { hooks: straight.hooks }).advance(900);
    const chunked = collect();
    const sim = new Simulation(scenario(60), { hooks: chunked.hooks });
    for (const until of [95, 121, 333, 337, 512, 900]) {
      sim.advance(until);
      sim.emitRunEnd();
    }
    const cadence = chunked.snaps.filter((s) => s.time % 60 === 0);
    expect(cadence.map((s) => s.time)).toEqual(straight.snaps.map((s) => s.time));
    for (const s of cadence) expect(parts(s), `t=${s.time}`).toEqual(parts(straight.snaps.find((q) => q.time === s.time)!));
    expect(chunked.snaps.some((s) => s.time % 60 !== 0)).toBe(true);
    // Every insight is delivered exactly once, in the same order.
    expect(ids(chunked.snaps)).toEqual(ids(straight.snaps));
  }, 120000);

  it('the ember overlays are read without decaying them (bitwise identical final state)', () => {
    const a = new Simulation(scenario(60), {});
    a.advance(900);
    const b = new Simulation(scenario(60), { hooks: { snapshot: () => undefined } });
    for (const until of [130, 250, 470, 610, 900]) {
      b.advance(until);
      b.emitRunEnd();
    }
    expect(parts(b.snapshot())).toEqual(parts(a.snapshot()));
  }, 120000);

  it('does not emit inside a silent replay after a rewind, and emits when the replay ends between display steps', () => {
    const c = collect();
    const sim = new Simulation(scenario(300), { hooks: c.hooks });
    sim.advance(1500);
    c.snaps.length = 0;
    sim.rewind(1000);
    sim.advance(1000);
    expect(sim.time).toBeGreaterThanOrEqual(1000);
    // The receiver holds everything up to 1000 (results at 900 and 1200 were kept); the replay is silent.
    expect(c.snaps.length).toBe(0);
    sim.advance(1500);
    expect(c.snaps.map((s) => s.time)).toEqual([1200, 1500]);
  }, 120000);
});

describe('snapshot coalescing', () => {
  it('skips snapshots produced faster than the limit but keeps the first of every 300 s window, the run end and all other data', () => {
    let wall = 0;
    // Every clock read advances 1 ms: a step costs several reads, so 10 s snapshots come far faster than 25/s.
    const clock = (): number => (wall += 1);
    const full = collect();
    new Simulation(scenario(10), { hooks: full.hooks }).advance(900);
    const c = collect();
    const sim = new Simulation(scenario(10), { hooks: c.hooks, clock, minSnapshotWallMs: 40 });
    sim.advance(895);
    sim.emitRunEnd();
    const times = c.snaps.map((s) => s.time);
    expect(times.length).toBeLessThan(full.snaps.length / 2);
    for (const t of [10, 300, 600]) expect(times, `first of window at ${t}`).toContain(t);
    expect(times.at(-1)).toBe(sim.time);
    // Every emitted cadence snapshot equals the uncoalesced one (bitwise, apart from insight grouping).
    for (const s of c.snaps) {
      const ref = full.snaps.find((q) => q.time === s.time);
      if (ref) expect(parts(s), `t=${s.time}`).toEqual(parts(ref));
    }
    // No insight is lost or duplicated.
    expect(new Set(ids(c.snaps)).size).toBe(ids(c.snaps).length);
    expect(ids(c.snaps)).toEqual(ids(full.snaps));
  }, 120000);
});

describe('SimHost run end', () => {
  it('posts a snapshot at the exact time reached when a run completes, and on pause', async () => {
    const posted: FromWorker[] = [];
    const host = new SimHost({ post: (m) => posted.push(m) }, { schedule: (fn) => setTimeout(fn, 0), simulation: { minSnapshotWallMs: 0 } });
    host.handle({ type: 'init', scenario: scenario(60, { extent: 1500 }) });
    const times = (): number[] => posted.filter((m): m is Extract<FromWorker, { type: 'snapshot' }> => m.type === 'snapshot').map((m) => m.snapshot.time);
    const waitIdle = async (): Promise<void> => {
      for (let i = 0; i < 4000; i++) {
        await new Promise((r) => setTimeout(r, 5));
        const st = [...posted].reverse().find((m) => m.type === 'status');
        if (st && st.type === 'status' && !st.running && posted.length > 3) return;
      }
      throw new Error('timeout');
    };
    host.handle({ type: 'run', until: 125 });
    await waitIdle();
    expect(times()).toEqual([0, 60, 120, 130]);
    // Status reports carry the target of the run they belong to (the UI tells its own run's reports from stale ones).
    const statuses = posted.filter((m): m is Extract<FromWorker, { type: 'status' }> => m.type === 'status');
    expect(statuses.length).toBeGreaterThan(1);
    expect(statuses.every((m) => m.until === 125)).toBe(true);
    expect(statuses[0]!.running).toBe(true);
    expect(statuses.at(-1)!.running).toBe(false);
    posted.length = 0;
    host.handle({ type: 'run', until: 400 });
    await new Promise((r) => setTimeout(r, 15));
    host.handle({ type: 'pause' });
    await waitIdle();
    const t = times();
    const sim = host.simulation!;
    expect(t.at(-1)).toBe(sim.time);
    host.dispose();
  }, 60000);

  it('LocalSimController: a run to a time between steps ends with a snapshot for that time', async () => {
    const c = new LocalSimController({ chunkMs: 10, simulation: { minSnapshotWallMs: 0 } });
    const times: number[] = [];
    c.on('snapshot', (s) => times.push(s.time));
    await c.init(scenario(60, { extent: 1500 }));
    c.run(200);
    await new Promise<void>((resolve, reject) => {
      const t0 = Date.now();
      const check = (): void => {
        if (times.includes(200)) resolve();
        else if (Date.now() - t0 > 30000) reject(new Error('timeout'));
        else setTimeout(check, 5);
      };
      check();
    });
    expect(times).toEqual([0, 60, 120, 180, 200]);
    c.dispose();
  }, 60000);
});
