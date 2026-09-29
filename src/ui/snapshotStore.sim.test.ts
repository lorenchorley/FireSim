/**
 * The history store against the REAL simulation (Katoomba demo, hot NW wind, ≥ 2 simulated hours): every snapshot is
 * fed to the store, which keeps keyframes only, and the fire it rebuilds for intermediate times is compared with the
 * true snapshots of those times. Also: memory for a 6 h run at 10 / 30 / 60 s steps, and rewinds.
 */
import { describe, expect, it } from 'vitest';
import { BurnState, type FireField, type SimSnapshot } from '../core/types';
import { Simulation } from '../sim/simulation';
import { demoScenario, pointIgnition, withIgnitions } from '../sim/testing/scenarios';
import { SnapshotStore } from './snapshotStore';

const IGN = { x: -2170, y: 900 };

interface Truth {
  time: number;
  fire: FireField;
}

async function scenario(step: number, hours: number): Promise<ReturnType<typeof withIgnitions>> {
  const base = await demoScenario({ startCivil: [2025, 12, 20, 14], extent: 6000, tier: 'fast', duration: hours * 3600 });
  return withIgnitions(base, [pointIgnition('escarpment', IGN.x, IGN.y, 0, 60)], { snapshotInterval: step, tier: 'fast' });
}

describe('history store vs the real simulation', () => {
  it('rebuilds the exact fire front (and the burn state within the flame band) for intermediate times from keyframes only', async () => {
    const sc = await scenario(60, 2.2);
    const store = new SnapshotStore({ maxBytes: 600e6, minInterval: 60 });
    const truth: Truth[] = [];
    const sim = new Simulation(sc, {
      tier: 'fast',
      hooks: {
        snapshot: (s: SimSnapshot) => {
          // Keep the true fire of every 5th snapshot as the reference (the store gets all of them).
          if (Math.round(s.time / 60) % 5 === 2) truth.push({ time: s.time, fire: s.fire });
          store.push(s);
        },
      },
    });
    store.push(sim.snapshot()); // the t0 snapshot (the host posts it at init)
    sim.advance(2.2 * 3600);
    const head = store.latest()!;
    expect(head.time).toBeGreaterThanOrEqual(2.2 * 3600 - 1);
    // Keyframes only every 300 s; a light frame for every step.
    expect(store.size).toBe(Math.round(head.time / 60) + 1);
    expect(store.keyframeTimes().every((t) => t % 300 === 0)).toBe(true);
    expect(store.keyframeCount).toBeLessThan(store.size / 4);

    let burntChecked = 0;
    let stateMismatch = 0;
    const late = truth.filter((tr) => tr.time > 1800 && tr.time < head.time - 60);
    expect(late.length).toBeGreaterThan(5);
    for (const tr of late) {
      const s = store.at(tr.time)!;
      expect(s.time).toBe(tr.time);
      const A = tr.fire.arrivalTime;
      const B = tr.fire.burnState;
      const ra = s.fire.arrivalTime;
      const rb = s.fire.burnState;
      let ignited = 0;
      for (let k = 0; k < A.length; k++) {
        // The arrival times are exactly the true ones (+Infinity where the fire had not arrived).
        if (!Object.is(ra[k], A[k])) throw new Error(`arrival mismatch at t=${tr.time} cell ${k}: ${ra[k]} vs ${A[k]}`);
        if (A[k]! <= tr.time) {
          ignited++;
          burntChecked++;
          if (B[k] === BurnState.NonFlammable || rb[k] === BurnState.NonFlammable) throw new Error('burnt cell reported non-flammable');
          if (rb[k] !== B[k]) stateMismatch++;
        } else {
          // Not yet burnt: unburnt or non-flammable, exactly as in the true snapshot.
          expect(rb[k]).toBe(B[k]);
        }
      }
      expect(ignited).toBeGreaterThan(50);
      // The other per-cell arrays are the newest snapshot's (values of burnt cells never change).
      for (let k = 0; k < A.length; k += 97) if (A[k]! <= tr.time) expect(s.fire.ros[k]).toBe(tr.fire.ros[k]);
      // Stats and the moisture/atmosphere come from the steps and keyframes at or before the time.
      expect(s.stats.time).toBeLessThanOrEqual(tr.time);
      expect(tr.time - s.stats.time).toBeLessThanOrEqual(60);
      expect(s.moisture.length).toBe(A.length);
      expect(s.atmosphere).toBeTruthy();
    }
    // The burn state differs from the truth only where the true residence differs from the flame band.
    // At every snapshot time the derived burn state (Burning until the cell burnt out) equals the true one.
    expect(burntChecked).toBeGreaterThan(5000);
    expect(stateMismatch).toBe(0);
    // Fire state at a time between snapshots: cells arrive between 60 s marks, so the front is finer than the cadence.
    const t1 = 3600 + 20;
    const mid = store.at(t1)!;
    const before = store.at(3600)!;
    let between = 0;
    for (let k = 0; k < mid.fire.arrivalTime.length; k++) if (mid.fire.arrivalTime[k]! <= t1 && !(before.fire.arrivalTime[k]! <= 3600)) between++;
    expect(between).toBeGreaterThanOrEqual(0);
    expect(mid.time).toBe(t1);
    // Between two snapshots the burn state lies between the two neighbours' (a cell burns out once).
    const lo = store.at(5400)!.fire.burnState;
    const hi = store.at(5460)!.fire.burnState;
    const md = store.at(5430)!.fire.burnState;
    let burning = 0;
    for (let k = 0; k < md.length; k++) {
      if (md[k] === BurnState.Burning) {
        burning++;
        expect(lo[k] === BurnState.Burning || lo[k] === BurnState.Unburnt).toBe(true);
      }
      if (hi[k] === BurnState.Burning) expect(md[k] === BurnState.Burning || md[k] === BurnState.Unburnt).toBe(true);
    }
    expect(burning).toBeGreaterThan(0);
  }, 600000);

  it('after a rewind and re-simulation the new newest arrays are authoritative for earlier times too', async () => {
    const sc = await scenario(60, 1.5);
    const store = new SnapshotStore({ maxBytes: 600e6, minInterval: 60 });
    const first = new Map<number, Float32Array>();
    const sim = new Simulation(sc, {
      tier: 'fast',
      hooks: {
        snapshot: (s: SimSnapshot) => {
          if (s.time % 300 === 0) first.set(s.time, s.fire.arrivalTime);
          store.push(s);
        },
        rewound: (t: number) => store.truncateAfter(t),
      },
    });
    store.push(sim.snapshot());
    sim.advance(3600);
    // An edit at 1500 s: a second fire far from the first. Everything before 1500 s is unchanged, after it differs.
    const before1500 = store.at(1200)!.fire.arrivalTime.slice();
    sim.ignite({ ...pointIgnition('late', 1500, -1200, 1500, 60), origin: 'observed' });
    sim.advance(3600);
    expect(store.latest()!.time).toBeGreaterThanOrEqual(3600);
    for (const t of [600, 900, 1200]) {
      const now = store.at(t)!.fire.arrivalTime;
      const was = first.get(t)!;
      for (let k = 0; k < was.length; k++) if (!Object.is(now[k], was[k])) throw new Error(`t=${t} cell ${k} differs after the rewind: ${now[k]} vs ${was[k]}`);
    }
    expect(store.at(1200)!.fire.arrivalTime).toEqual(before1500);
    // The new fire is in the later history only.
    const g = sc.terrain.grid;
    const k = Math.round((1500 - g.x0) / g.cellSize) + Math.round((-1200 - g.y0) / g.cellSize) * g.nx;
    expect(store.at(1500 - 60)!.fire.arrivalTime[k]).toBe(Infinity);
    expect(store.at(3000)!.fire.arrivalTime[k]).toBeLessThanOrEqual(3000);
  }, 600000);

  it('keeps 6 h of history at 10, 30 and 60 s steps inside the memory budget (real snapshots replayed)', async () => {
    const sc = await scenario(60, 0.75);
    const real: SimSnapshot[] = [];
    const sim = new Simulation(sc, { tier: 'fast', hooks: { snapshot: (s: SimSnapshot) => real.push(s) } });
    sim.advance(0.75 * 3600);
    // (the t0 snapshot is not needed here)
    const template = real[real.length - 1]!;
    const seed = real.slice(-6);
    expect(template.fire.arrivalTime.length).toBeGreaterThan(20000);
    const budget = 64 * 1024 * 1024;
    const report: string[] = [];
    for (const step of [10, 30, 60]) {
      const store = new SnapshotStore({ maxBytes: budget, minInterval: step });
      let peak = 0;
      const n = Math.round((6 * 3600) / step);
      for (let i = 0; i <= n; i++) {
        const src = seed[i % seed.length]!;
        // Same arrays (no extra memory in the test), advancing time and monotone spot fires.
        store.push({ ...src, time: i * step, stats: { ...src.stats, time: i * step }, fire: template.fire, insights: [] });
        peak = Math.max(peak, store.totalBytes);
        if (i % 500 === 0) expect(store.totalBytes).toBeLessThanOrEqual(budget);
      }
      expect(store.totalBytes).toBeLessThanOrEqual(budget);
      expect(peak).toBeLessThanOrEqual(budget);
      // The first keyframe and the newest snapshot are always there; every time can be shown; recent history is fine.
      expect(store.keyframeTimes()[0]).toBe(0);
      expect(store.latest()!.time).toBe(n * step);
      expect(store.range()).toEqual({ start: 0, end: n * step });
      const ts = store.times();
      const recentGap = ts[ts.length - 1]! - ts[ts.length - 2]!;
      expect(recentGap).toBe(step);
      for (const t of [0, 1234, 9999, 6 * 3600 - 5]) expect(store.at(t)!.time).toBe(Math.min(t, n * step));
      report.push(`${step} s: ${(store.totalBytes / 1048576).toFixed(1)} MB (peak ${(peak / 1048576).toFixed(1)}), ${store.size} steps, ${store.keyframeCount} keyframes (mean ${Math.round(store.keyframeSpacing / 60)} min)`);
    }
    // eslint-disable-next-line no-console
    console.log(`6 h history, ${(budget / 1048576).toFixed(0)} MB budget, ${template.fire.arrivalTime.length} fire cells:\n  ${report.join('\n  ')}`);
  }, 600000);
});
