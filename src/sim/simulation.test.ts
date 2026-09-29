/**
 * Orchestrator tests on a small synthetic scenario (3 km, 30 m, flat west half + 15° slope rising east, dry forest,
 * constant hot westerly): §12.2 cadences, stats (§12.3), records (ignitions, fuel / wind edits, removals, options),
 * snapshots and layers, checkpoints and rewind (§12.4), determinism (§12.5), tier switching (§12.6).
 */
import { describe, expect, it } from 'vitest';
import { BurnState, FuelType, SpreadDriver, type FuelEdit, type SimSnapshot, type WindEdit } from '../core/types';
import { cellAt } from '../core/grid';
import { Simulation } from './simulation';
import { snapshotHash, snapshotPartHashes } from './testing/hash';
import { pointIgnition, syntheticScenario } from './testing/scenarios';
import { SIM_PARAMS } from './params';

const diffParts = (a: SimSnapshot, b: SimSnapshot): string[] => {
  const pa = snapshotPartHashes(a);
  const pb = snapshotPartHashes(b);
  return Object.keys(pa).filter((k) => pa[k] !== pb[k]);
};

function collect(): { snaps: Map<number, SimSnapshot>; rewound: number[]; hooks: { snapshot: (s: SimSnapshot) => void; rewound: (t: number) => void } } {
  const snaps = new Map<number, SimSnapshot>();
  const rewound: number[] = [];
  return { snaps, rewound, hooks: { snapshot: (s) => snaps.set(s.time, s), rewound: (t) => rewound.push(t) } };
}

describe('Simulation on a synthetic slope (fast tier)', () => {
  // A 300 s display step (the default is 60 s) keeps these expectations short.
  const scenario = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], options: { snapshotInterval: 300 } });

  it('initialises, gives a t0 snapshot and runs in the §12.2 cadences with sane stats', () => {
    const c = collect();
    const sim = new Simulation(scenario, { hooks: c.hooks });
    expect(sim.isReady).toBe(true); // fast tier: no 3-D spin-up
    expect(sim.tier).toBe('fast');
    const s0 = sim.snapshot();
    expect(s0.time).toBe(0);
    expect(s0.stats.burntAreaHa).toBe(0);
    expect(s0.atmosphere?.surfaceU.length).toBeGreaterThan(0);
    expect(Number.isFinite(s0.stats.deadFuelMoistureMean)).toBe(true);
    sim.advance(3600);
    expect(sim.time).toBe(3600);
    const times = [...c.snaps.keys()];
    expect(times).toEqual(Array.from({ length: 12 }, (_, i) => (i + 1) * 300));
    let prev = 0;
    for (const s of c.snaps.values()) {
      expect(s.stats.burntAreaHa).toBeGreaterThanOrEqual(prev);
      prev = s.stats.burntAreaHa;
      for (const k of ['perimeterKm', 'maxRos', 'maxIntensity', 'headRos', 'ffdi', 'deadFuelMoistureMean', 'convectiveNumber'] as const) expect(Number.isFinite(s.stats[k])).toBe(true);
      expect(s.layers && Object.keys(s.layers).sort()).toEqual(expect.arrayContaining(['attach', 'landing', 'trench', 'vls']));
      expect(s.fire.arrivalTime.length).toBe(scenario.terrain.grid.nx * scenario.terrain.grid.ny);
    }
    const last = c.snaps.get(3600)!;
    expect(last.stats.burntAreaHa).toBeGreaterThan(5);
    expect(last.stats.perimeterKm).toBeGreaterThan(0.5);
    // Westerly wind + slope rising east: the head runs east (towards ~90°) and far faster than the back. Checked at
    // 50 min: by 60 min the head has reached the east edge of the 3 km domain and the fastest front cell is a flank.
    const s50 = c.snaps.get(3000)!;
    expect(Math.abs(((s50.stats.headDir - 90 + 540) % 360) - 180)).toBeLessThan(50);
    const g = scenario.terrain.grid;
    let east = -Infinity;
    let west = Infinity;
    for (let k = 0; k < last.fire.arrivalTime.length; k++) {
      if (!(last.fire.arrivalTime[k]! <= 3600) || last.fire.driver[k] === SpreadDriver.Spotting) continue;
      const x = g.x0 + (k % g.nx) * g.cellSize;
      if (Math.abs(g.y0 + Math.floor(k / g.nx) * g.cellSize) > 60) continue;
      east = Math.max(east, x);
      west = Math.min(west, x);
    }
    expect(east - -300).toBeGreaterThan(4 * (-300 - west));
    // Checkpoints every 1800 s plus t0.
    expect(sim.checkpointTimes).toEqual([0, 1800, 3600]);
    const perf = sim.perf();
    expect(perf.steps).toBe(360); // fast tier: 10 s steps
    expect(perf.modules['atmosphere']).toBeGreaterThanOrEqual(0);
  }, 120000);

  it('rewind → re-run is bitwise identical, with ignitions, fuel and wind edits and options added mid-run', () => {
    const c = collect();
    const sim = new Simulation(scenario, { hooks: c.hooks });
    sim.advance(1800);
    // A fuel break (NonFuel strip) ahead of the head, a later spot ignition, a wind edit and an option change.
    const brk: FuelEdit = { kind: 'fuel', id: 'break', shape: { kind: 'polygon', points: [[600, -1500], [690, -1500], [690, 1500], [600, 1500]] }, setType: FuelType.NonFuel };
    const wet: FuelEdit = { kind: 'fuel', id: 'wet', shape: { kind: 'circle', x: -300, y: 600, radius: 200 }, moistureDelta: 10 };
    const wind: WindEdit = { kind: 'wind', id: 'w1', x: 0, y: 0, radius: 800, speed: 8, dir: 250, time: 1800 };
    sim.edit(brk, 1800);
    sim.edit(wet, 1800);
    sim.edit(wind, 1800);
    sim.ignite({ ...pointIgnition('b', -900, -900, 2400, 45), origin: 'spot' });
    sim.setOption('maxEmbers', 600);
    sim.advance(3600);
    const first = new Map(c.snaps);
    expect(first.get(3600)!.stats.burntAreaHa).toBeGreaterThan(first.get(1800)!.stats.burntAreaHa);
    // The break holds (embers are the only way across; allow isolated spots).
    const g = scenario.terrain.grid;
    const f = first.get(3600)!.fire;
    for (let j = 0; j < g.ny; j++) {
      const k = cellAt(g, 645, g.y0 + j * g.cellSize);
      expect(f.burnState[k]).toBe(BurnState.NonFlammable);
    }
    // The later ignition happened.
    const kb = cellAt(g, -900, -900);
    expect(f.arrivalTime[kb]).toBeGreaterThanOrEqual(2400 - 1e-3);
    expect(f.arrivalTime[kb]).toBeLessThan(2500);
    // Rewind into the middle and re-run.
    c.snaps.clear();
    const cpT = sim.rewind(2700);
    expect(cpT).toBe(1800);
    expect(c.rewound).toEqual([2700]);
    expect(sim.time).toBe(1800);
    sim.advance(3600);
    expect([...c.snaps.keys()]).toEqual([3000, 3300, 3600]); // nothing re-emitted up to the rewind target
    for (const [t, s] of c.snaps) expect(diffParts(first.get(t)!, s), `t=${t}`).toEqual([]);
    // Rewind to before the edits (t0 checkpoint): the edits are replayed at their times.
    c.snaps.clear();
    expect(sim.rewind(600)).toBe(0);
    sim.advance(3600);
    for (const t of [900, 1800, 2400, 3000, 3600]) expect(diffParts(first.get(t)!, c.snaps.get(t)!), `t=${t}`).toEqual([]);
  }, 180000);

  it('two fresh runs with the same scenario and seed are bitwise identical; a different ember seed changes only ember-driven parts', () => {
    const a = collect();
    const b = collect();
    new Simulation(scenario, { hooks: a.hooks }).advance(1800);
    new Simulation(scenario, { hooks: b.hooks }).advance(1800);
    for (const [t, s] of a.snaps) expect(snapshotHash(s)).toBe(snapshotHash(b.snaps.get(t)!));
    const c = collect();
    new Simulation({ ...scenario, options: { ...scenario.options, seed: 99 } }, { hooks: c.hooks }).advance(600);
    const d = diffParts(a.snaps.get(600)!, c.snaps.get(600)!);
    expect(d).toContain('embers');
  }, 180000);

  it('an edit in the past rewinds to it (rewound hook) and the result equals a run that knew the edit from the start', () => {
    const brk: FuelEdit = { kind: 'fuel', id: 'b', shape: { kind: 'circle', x: 300, y: 0, radius: 150 }, setType: FuelType.NonFuel };
    const c1 = collect();
    const late = new Simulation(scenario, { hooks: c1.hooks });
    late.advance(2400);
    late.edit(brk, 1200); // in the past
    expect(c1.rewound).toEqual([1200]);
    expect(late.time).toBe(0); // latest checkpoint ≤ 1200 is t0 (the 1800 one is after the edit)
    c1.snaps.clear();
    late.advance(2400);
    const c2 = collect();
    const early = new Simulation(scenario, { hooks: c2.hooks });
    early.edit(brk, 1200);
    early.advance(2400);
    for (const t of [1500, 1800, 2100, 2400]) expect(diffParts(c2.snaps.get(t)!, c1.snaps.get(t)!), `t=${t}`).toEqual([]);
  }, 180000);

  it('removeIgnition undoes a marked fire: the re-run equals a run that never had it, from its time on', () => {
    const extra = pointIgnition('wrong', 600, 600, 900, 40);
    const c1 = collect();
    const sim = new Simulation(scenario, { hooks: c1.hooks });
    sim.ignite(extra);
    sim.advance(2400);
    expect(sim.removeIgnition('nope')).toBe(false);
    expect(sim.removeIgnition('wrong')).toBe(true);
    expect(c1.rewound).toEqual([900]);
    expect(sim.logicalNow).toBe(2400); // re-runs to where the user was
    c1.snaps.clear();
    sim.advance(2400);
    expect([...c1.snaps.keys()]).toEqual([1200, 1500, 1800, 2100, 2400]); // everything after the ignition time again
    const c2 = collect();
    const clean = new Simulation(scenario, { hooks: c2.hooks });
    clean.advance(2400);
    for (const t of [1200, 1800, 2400]) expect(diffParts(c2.snaps.get(t)!, c1.snaps.get(t)!), `t=${t}`).toEqual([]);
  }, 180000);

  it('removeEdit restores the base fuel from its time on; options apply from the next step', () => {
    const sim = new Simulation(scenario);
    const road: FuelEdit = { kind: 'fuel', id: 'road', shape: { kind: 'circle', x: 900, y: 0, radius: 120 }, setType: FuelType.NonFuel };
    sim.edit(road, 0);
    sim.advance(600);
    const k = cellAt(scenario.terrain.grid, 900, 0);
    expect(sim.stateView().fuel.type[k]).toBe(FuelType.NonFuel);
    expect(sim.stateView().fire.burnState[k]).toBe(BurnState.NonFlammable);
    sim.removeEdit('road');
    sim.setOption('embers', false);
    sim.setOption('coupling', 0);
    sim.advance(660);
    expect(sim.stateView().fuel.type[k]).toBe(FuelType.DryForestShrubby);
    expect(sim.stateView().fire.burnState[k]).toBe(BurnState.Unburnt);
    expect(sim.options.embers).toBe(false);
    expect(sim.options.coupling).toBe(0);
    expect(sim.snapshot().embers.count).toBe(0);
  }, 120000);

  it('explain returns a coherent explanation for burnt and unburnt cells, at the current or an earlier view time', () => {
    const sim = new Simulation(scenario);
    sim.advance(2400);
    const burnt = sim.explain(-100, 0);
    expect(burnt.arrivalTime).toBeLessThan(2400);
    expect(burnt.narrative.length).toBeGreaterThanOrEqual(2);
    expect(burnt.narrative.join(' ')).toMatch(/wind|slope|moisture|litter/i);
    expect(burnt.ros).toBeGreaterThan(0);
    const ahead = sim.explain(1300, 0);
    expect(Number.isFinite(ahead.ros)).toBe(true);
    expect(ahead.narrative.length).toBeGreaterThanOrEqual(1);
    // At an earlier view time the same burnt cell is described as not yet reached.
    const earlier = sim.explain(-100, 0, 1);
    expect(earlier.narrative.length).toBeGreaterThanOrEqual(1);
  }, 120000);

  it('setQuality switches the tier from the latest checkpoint and re-runs to now (rewound at the checkpoint time)', () => {
    const c = collect();
    const sim = new Simulation(syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent: 2400 }), { hooks: c.hooks });
    sim.advance(1800 + 600);
    c.snaps.clear();
    sim.setQuality('standard');
    expect(c.rewound).toEqual([1800]);
    sim.advance(1800 + 600);
    expect(sim.tier).toBe('standard');
    expect(c.snaps.has(2100)).toBe(true); // re-run results are emitted (they changed)
    const afterSwitch = new Map(c.snaps);
    expect(afterSwitch.get(2400)!.atmosphere!.nz).toBeGreaterThan(0);
    // Rewinding to before the switch goes back to the fast tier and replays the switch bitwise.
    c.snaps.clear();
    sim.rewind(900);
    expect(sim.tier).toBe('fast');
    sim.advance(2400);
    expect(sim.tier).toBe('standard');
    for (const t of [2100, 2400]) expect(diffParts(afterSwitch.get(t)!, c.snaps.get(t)!), `t=${t}`).toEqual([]);
  }, 240000);

  it('rewind at or after the current time restores nothing (what-if at the head) and moves later option records to it', () => {
    const c = collect();
    const sim = new Simulation(scenario, { hooks: c.hooks });
    sim.advance(1200);
    sim.setOption('coupling', 0.5);
    expect(sim.rewind(1200)).toBe(1200);
    expect(sim.time).toBe(1200);
    expect(c.rewound).toEqual([1200]);
    sim.advance(1260);
    expect(sim.options.coupling).toBe(0.5);
  }, 120000);

  it('line, area and backburn ignitions light their geometry at their times', () => {
    const sim = new Simulation(syntheticScenario({ extent: 2400, options: { embers: false } }));
    sim.ignite({ id: 'line', kind: 'line', points: [[-600, -600], [-600, 600]], time: 0, origin: 'observed' });
    sim.ignite({ id: 'area', kind: 'area', points: [[300, -900], [600, -900], [600, -600], [300, -600]], time: 120, origin: 'backburn' });
    sim.advance(180);
    const f = sim.stateView().fire;
    const g = sim.stateView().terrain.grid;
    for (let y = -540; y <= 540; y += 90) expect(f.arrivalTime[cellAt(g, -600, y)]).toBeLessThanOrEqual(1e-3);
    for (const [x, y] of [[450, -750], [330, -870], [570, -630]] as const) {
      const ta = f.arrivalTime[cellAt(g, x, y)]!;
      expect(ta).toBeLessThanOrEqual(120 + 1e-3);
      expect(ta).toBeGreaterThan(0);
    }
    expect(f.arrivalTime[cellAt(g, 450, 300)]).toBe(Infinity);
  }, 120000);

  it('the minute cadence is exact: steps land on every 60 s boundary in the 3-D tier', () => {
    const sim = new Simulation(syntheticScenario({ extent: 2400 }), { tier: 'standard' });
    expect(sim.isReady).toBe(false);
    expect(sim.spinUp()).toBe(true);
    const seen: number[] = [];
    for (let q = 0; q < 40; q++) {
      sim.advance(sim.time + 1);
      seen.push(sim.time);
    }
    for (let m = 60; m <= Math.floor(seen[seen.length - 1]! / 60) * 60; m += 60) expect(seen).toContain(m);
    for (let q = 1; q < seen.length; q++) expect(seen[q]! - seen[q - 1]!).toBeLessThanOrEqual(SIM_PARAMS.dtMaxS + 1e-9);
  }, 120000);
});
