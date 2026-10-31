/**
 * The wind the fire feels in the engine's snapshots (0.7.0, D-CONTRACT-070-raster section 8, lane D): `SimSnapshot.fireWind`, the fire-grid
 * wind `env.windU/V` block-averaged to about 60 m and quantised to Int16. On a synthetic flat-west / sloping-east 3 km scenario with a westerly
 * of 20 km/h and a fire west of the centre (the fast tier), and on 1.5 km with the 3-D air (the standard tier: its spin-up and steps cost more).
 * What it guards: the picture is there at every snapshot, on the 60 m grid, equal to the block mean of what the engine itself holds within half
 * a quantum; the fast tier refits it once a minute and the 3-D tiers at every air step; two runs, a display step of 300 s, no statistics, a wild
 * clock, extra `snapshot()` calls and a rewind all give the same pictures (so the history can keep them). That the rest of every snapshot is
 * unchanged by publishing it is `fireWind.identity.sim.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { fireWindBlock, fireWindGrid } from '../core/fireWind';
import type { FireWindRaster, SimSnapshot } from '../core/types';
import { Simulation, type SimulationOptions } from './simulation';
import { snapshotHash } from './testing/hash';
import { pointIgnition, syntheticScenario } from './testing/scenarios';

type Scenario = ReturnType<typeof syntheticScenario>;

const fast = (o: Parameters<typeof syntheticScenario>[0] = {}): Scenario =>
  syntheticScenario({ windFromDeg: 270, windKmh: 20, extent: 3000, duration: 3600, ignitions: [pointIgnition('a', -600, 0, 0, 60)], options: { snapshotInterval: 60 }, ...o });
const std = (o: Parameters<typeof syntheticScenario>[0] = {}): Scenario => fast({ extent: 1500, duration: 1800, options: { snapshotInterval: 60, tier: 'standard' }, ...o });

/** A simulation with its snapshots collected by time (the t0 snapshot is `sim.snapshot()`, as the host posts it). */
function start(sc: Scenario, o: Omit<SimulationOptions, 'hooks'> = {}): { sim: Simulation; snaps: Map<number, SimSnapshot> } {
  const snaps = new Map<number, SimSnapshot>();
  const sim = new Simulation(sc, { ...o, hooks: { snapshot: (s) => snaps.set(s.time, s) } });
  snaps.set(0, sim.snapshot());
  return { sim, snaps };
}

function run(sc: Scenario, until: number, o: Omit<SimulationOptions, 'hooks'> = {}): ReturnType<typeof start> {
  const r = start(sc, o);
  r.sim.spinUp();
  r.sim.advance(until);
  return r;
}

const pic = (s: SimSnapshot): FireWindRaster => {
  expect(s.fireWind, `the snapshot at ${s.time} s has no fireWind`).toBeDefined();
  return s.fireWind!;
};

/** The bytes of a picture without its stamp: what repeats while the engine has not refitted the wind. */
const values = (f: FireWindRaster): number => snapshotHash({ fireWind: { ...f, time: 0 } } as unknown as SimSnapshot, []);
/** The whole picture, stamp and grid included. */
const whole = (f: FireWindRaster): number => snapshotHash({ fireWind: f } as unknown as SimSnapshot, []);

const every = (from: number, to: number, step = 60): number[] => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/** The mean of the fire cells of block (bi, bj) of the engine's own wind array: the oracle, a plain loop. */
function blockMean(nx: number, ny: number, a: Float32Array, k: number, bi: number, bj: number): number {
  let sum = 0;
  let n = 0;
  for (let j = bj * k; j < Math.min(ny, (bj + 1) * k); j++) for (let i = bi * k; i < Math.min(nx, (bi + 1) * k); i++, n++) sum += a[j * nx + i]!;
  return sum / n;
}

/** The picture of `snap` against the engine's own `windU/V` (read now, so `snap` must be the state as it stands): every block within half a quantum. */
function expectEqualsEngineWind(sim: Simulation, snap: SimSnapshot): { maxSpeed: number; spread: number } {
  const g = sim.stateView().terrain.grid;
  const { windU, windV } = sim.stateView();
  const fw = pic(snap);
  const k = fireWindBlock(g.cellSize);
  expect(fw.block).toBe(k);
  expect(fw.grid).toEqual(fireWindGrid(g, k));
  let maxSpeed = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let bj = 0; bj < fw.grid.ny; bj++) {
    for (let bi = 0; bi < fw.grid.nx; bi++) {
      const o = bj * fw.grid.nx + bi;
      const mu = blockMean(g.nx, g.ny, windU, k, bi, bj);
      const mv = blockMean(g.nx, g.ny, windV, k, bi, bj);
      expect(Math.abs(fw.u[o]! * 0.01 - mu), `u block ${bi},${bj}`).toBeLessThanOrEqual(0.005 + 1e-6);
      expect(Math.abs(fw.v[o]! * 0.01 - mv), `v block ${bi},${bj}`).toBeLessThanOrEqual(0.005 + 1e-6);
      maxSpeed = Math.max(maxSpeed, Math.hypot(mu, mv));
      lo = Math.min(lo, mu);
      hi = Math.max(hi, mu);
    }
  }
  return { maxSpeed, spread: hi - lo };
}

describe('fireWind in the engine snapshots (fast tier, 3 km)', () => {
  it('every snapshot carries the picture, on the 60 m grid, stamped with its own time, in buffers of its own', () => {
    const { sim, snaps } = run(fast(), 600);
    expect([...snaps.keys()].sort((a, b) => a - b)).toEqual(every(0, 600));
    const g = sim.stateView().terrain.grid;
    expect([g.nx, g.ny, g.cellSize]).toEqual([100, 100, 30]);
    for (const [t, s] of snaps) {
      const fw = pic(s);
      expect(fw.time, `stamp at ${t}`).toBe(t);
      expect(s.time).toBe(t);
      expect([fw.grid.nx, fw.grid.ny, fw.grid.cellSize, fw.block]).toEqual([50, 50, 60, 2]);
      expect(fw.grid.x0).toBeCloseTo(g.x0 + 15, 9); // the first block centre is 15 m in from the first fire cell
      expect(fw.grid.y0).toBeCloseTo(g.y0 + 15, 9);
      expect(fw.grid.origin).toEqual(g.origin);
      expect(fw.u).toBeInstanceOf(Int16Array);
      expect(fw.u.length).toBe(2500);
      expect(fw.v.length).toBe(2500);
      // its own buffers: nothing else of the snapshot shares them (the host transfers each one), and the engine's grid is not the picture's
      const others = new Set<ArrayBufferLike>([s.moisture.buffer, s.fire.arrivalTime.buffer, s.embers.data.buffer, ...Object.values(s.layers ?? {}).map((l) => l.buffer)]);
      expect(others.has(fw.u.buffer)).toBe(false);
      expect(others.has(fw.v.buffer)).toBe(false);
      expect(fw.u.buffer).not.toBe(fw.v.buffer);
      expect(fw.grid).not.toBe(s.fire.grid);
    }
    // two snapshots do not share a picture either (the history keeps them)
    expect(pic(snaps.get(60)!).u.buffer).not.toBe(pic(snaps.get(120)!).u.buffer);
  }, 240000);

  it('equals the block mean of the engine\'s own fire-grid wind within 0.005 m/s, and is not an empty picture', () => {
    const { sim } = run(fast(), 600);
    const now = sim.snapshot();
    const { maxSpeed, spread } = expectEqualsEngineWind(sim, now);
    expect(maxSpeed).toBeGreaterThan(3); // a 20 km/h westerly is 5.6 m/s at 10 m: the picture holds it, not zeros
    expect(maxSpeed).toBeLessThan(40);
    expect(spread).toBeGreaterThan(0.05); // and it varies over the terrain (the ground rises east of the centre)
    // the t0 snapshot (before any step) is the engine's t0 winds
    const t0 = new Simulation(fast(), {});
    expectEqualsEngineWind(t0, t0.snapshot());
  }, 240000);

  it('is refitted once a minute: with a display step of 10 s the same values come back for about a minute, and they change with the fire', () => {
    const { snaps } = run(fast({ options: { snapshotInterval: 10 } }), 360);
    const times = [...snaps.keys()].sort((a, b) => a - b);
    expect(times.length).toBe(37);
    const runs: number[] = [];
    let prev: number | null = null;
    for (const t of times) {
      const h = values(pic(snaps.get(t)!));
      if (h !== prev) runs.push(1);
      else runs[runs.length - 1]!++;
      prev = h;
    }
    // 360 s at one refit a minute: 6 or 7 pictures (the first covers the start and a little more), each repeated while no refit happened
    expect(runs.length).toBeGreaterThanOrEqual(5);
    expect(runs.length).toBeLessThanOrEqual(8);
    expect(Math.max(...runs)).toBeGreaterThanOrEqual(6);
    expect(runs.reduce((a, b) => a + b, 0)).toBe(37);
    // a repeated picture is byte-identical but stamped with its own snapshot's time
    expect(values(pic(snaps.get(20)!))).toBe(values(pic(snaps.get(30)!)));
    expect(whole(pic(snaps.get(20)!))).not.toBe(whole(pic(snaps.get(30)!)));
    expect(pic(snaps.get(30)!).time).toBe(30);
  }, 240000);

  it('is deterministic: a second run, a display step of 300 s, no statistics and a wild clock give the same pictures', () => {
    const a = run(fast(), 900);
    const hashes = new Map([...a.snaps].map(([t, s]) => [t, whole(pic(s))]));
    expect(hashes.size).toBe(16);
    for (const [t, s] of run(fast(), 900).snaps) expect(whole(pic(s)), `second run t=${t}`).toBe(hashes.get(t));
    for (const [t, s] of run(fast({ options: { snapshotInterval: 300 } }), 900).snaps) expect(whole(pic(s)), `display step 300 t=${t}`).toBe(hashes.get(t));
    for (const [t, s] of run(fast(), 900, { perfStats: false }).snaps) expect(whole(pic(s)), `no statistics t=${t}`).toBe(hashes.get(t));
    let n = 0;
    const wild = (): number => (n += 1 + ((n * 7919) % 13) * 17);
    for (const [t, s] of run(fast(), 900, { clock: wild }).snaps) expect(whole(pic(s)), `wild clock t=${t}`).toBe(hashes.get(t));
  }, 600000);

  it('is a pure read: extra snapshot() calls between steps change no later picture', () => {
    const a = run(fast(), 900);
    const b = start(fast());
    for (let t = 60; t <= 900; t += 60) {
      b.sim.advance(t);
      b.sim.snapshot(); // takes the pending insights and the ember overlays, nothing the picture reads
      b.sim.snapshot();
    }
    for (const [t, s] of a.snaps) expect(whole(pic(b.snaps.get(t)!)), `t=${t}`).toBe(whole(pic(s)));
    // and the rest of the snapshot too, apart from the insights and the ember landing overlay an extra call consumes
    for (const [t, s] of a.snaps) expect(snapshotHash(b.snaps.get(t)!, ['stats.msPerSimMinute', 'insights', 'layers']), `whole snapshot t=${t}`).toBe(snapshotHash(s, ['stats.msPerSimMinute', 'insights', 'layers']));
  }, 240000);

  it('a rewind to a checkpoint and a re-run give the same pictures as the first run (the history is rebuilt from them)', () => {
    const r = run(fast({ duration: 3600 }), 2400);
    const first = new Map([...r.snaps].map(([t, s]) => [t, whole(pic(s))]));
    for (const target of [1900, 900]) {
      r.snaps.clear();
      r.sim.rewind(target); // 1900: the checkpoint at 1800; 900: the one at 0
      r.sim.advance(2400);
      expect(r.snaps.size, `rewind ${target}`).toBeGreaterThan(5);
      for (const [t, s] of r.snaps) expect(whole(pic(s)), `rewind ${target} t=${t}`).toBe(first.get(t));
    }
  }, 240000);
});

describe('fireWind in the engine snapshots (standard tier, 1.5 km, 3-D air)', () => {
  it('is there at every snapshot, on the 60 m grid, equals the block mean of the engine\'s wind, and changes at every air step', () => {
    const { sim, snaps } = run(std(), 600, { tier: 'standard' });
    expect([...snaps.keys()].sort((a, b) => a - b)).toEqual(every(0, 600));
    for (const [t, s] of snaps) {
      const fw = pic(s);
      expect(fw.time).toBe(t);
      expect([fw.grid.nx, fw.grid.ny, fw.grid.cellSize, fw.block]).toEqual([25, 25, 60, 2]);
    }
    const now = sim.snapshot();
    const { maxSpeed } = expectEqualsEngineWind(sim, now);
    expect(maxSpeed).toBeGreaterThan(2);
    // the 3-D tiers refit the wind every air step: consecutive minutes differ (a growing fire and a spinning-up air)
    for (const t of every(120, 600)) expect(values(pic(snaps.get(t)!)), `t=${t} against ${t - 60}`).not.toBe(values(pic(snaps.get(t - 60)!)));
  }, 600000);

  it('is deterministic and survives a rewind across a checkpoint, as the rest of the snapshot does', () => {
    const a = run(std(), 1000, { tier: 'standard' });
    const hashes = new Map([...a.snaps].map(([t, s]) => [t, whole(pic(s))]));
    for (const [t, s] of run(std(), 1000, { tier: 'standard' }).snaps) expect(whole(pic(s)), `second run t=${t}`).toBe(hashes.get(t));
    a.snaps.clear();
    a.sim.rewind(300); // back to the t0 checkpoint
    a.sim.advance(1000);
    expect(a.snaps.size).toBeGreaterThan(5);
    for (const [t, s] of a.snaps) expect(whole(pic(s)), `after a rewind t=${t}`).toBe(hashes.get(t));
  }, 600000);
});
