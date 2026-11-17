/**
 * The Desktop detail setting and plan section 4, rules 1 and 2 (0.9.0, D35; contract 4.1 item 5).
 *
 *   OFF  With the setting off the snapshot hashes equal 0.8.0's. The scenario is the one `desktop/engine.test.ts` uses for the determinism of the
 *        transport (Katoomba demo site, 6 km, fast tier, a fire on the escarpment, seed 11), and the fifteen hashes below were taken from the
 *        0.8.0 source (this tree before any 0.9.0 change; `git diff 7122c74 HEAD -- src desktop` was empty) with the same code, `Simulation`
 *        advanced to 900 s with a picture every 60 s. They go through the real builder, so a change to the builder's rule for the cell or the
 *        options would show here. They were not re-taken for this test: if one changes, results changed, and the report must say why.
 *   ON   With a finer level the same scenario and seed give the same hash twice, a different one from the standard detail's (a finer grid is
 *        not the same answer), and the grid, the ember cap and the record of the level are the same in every picture of the run: nothing during
 *        the run (a tier change, an option, a rewind) changes the detail.
 *
 * What is measured on the 0.8.0 tree and not here: the Katoomba 6 km run at 10 m is in the real-host run of e2e/desktop-detail.spec.ts and the
 * 15e study (studies/desktop-simulation); this file keeps to a 3 km area at 10 m so that it runs in seconds.
 */
import { describe, expect, it } from 'vitest';
import type { ScenarioData, SimSnapshot } from '../core/types';
import { Simulation } from './simulation';
import { snapshotHash } from './testing/hash';
import { demoScenario, pointIgnition, withIgnitions } from './testing/scenarios';

/** `time:hash` of every picture of the 0.8.0 run (the 0.8.0 tree, Katoomba 6 km, fast tier, seed 11, fire at (-2170, 900), pictures every 60 s to 900 s). */
const HASHES_0_8_0 = '60:1084538110 120:3498841198 180:1526728740 240:1652064113 300:3663678893 360:3575792216 420:2912366359 480:3708820897 540:3981135305 600:4269165313 660:1265999462 720:2911373612 780:3197235222 840:3229478989 900:3943397813';

interface Run {
  snaps: Map<number, SimSnapshot>;
  sim: Simulation;
}

function run(sc: ScenarioData, until: number): Run {
  const snaps = new Map<number, SimSnapshot>();
  const sim = new Simulation(sc, { hooks: { snapshot: (s) => snaps.set(s.time, s) } });
  sim.spinUp();
  sim.advance(until);
  return { snaps, sim };
}

const trace = (r: Run): string =>
  [...r.snaps.keys()]
    .sort((a, b) => a - b)
    .map((t) => `${t}:${snapshotHash(r.snaps.get(t)!)}`)
    .join(' ');

describe('the setting off: the snapshot hashes are 0.8.0\'s', () => {
  it('Katoomba 6 km, fast tier, seed 11: fifteen pictures, every hash the one the 0.8.0 tree gave', async () => {
    const base = await demoScenario({ startCivil: [2025, 12, 20, 14], extent: 6000, tier: 'fast', duration: 3600 });
    const sc = withIgnitions(base, [pointIgnition('escarpment', -2170, 900, 0, 60)], { snapshotInterval: 60, tier: 'fast', seed: 11 });
    // The standard detail leaves no trace in the scenario: no record, the 30 m grid, the fast tier's 2,000 embers.
    expect('desktopDetail' in sc.options).toBe(false);
    expect(sc.terrain.grid.cellSize).toBe(30);
    expect(sc.options.maxEmbers).toBe(2000);
    expect(sc.options.fireCellSize).toBe(30);
    const r = run(sc, 900);
    expect(r.snaps.size).toBe(15);
    expect(trace(r)).toBe(HASHES_0_8_0);
  }, 300_000);
});

describe('a finer level: reproducible, different from the standard detail, and fixed for the whole run', () => {
  async function katoomba3(options: Partial<ScenarioData['options']> = {}): Promise<ScenarioData> {
    const base = await demoScenario({ startCivil: [2025, 12, 20, 14], extent: 3000, tier: 'fast', duration: 3600, options });
    return withIgnitions(base, [pointIgnition('escarpment', -800, 300, 0, 60)], { snapshotInterval: 60, tier: 'fast', seed: 11, ...options });
  }

  it('10 m cells with the level recorded: the same scenario and seed give the same hash at every picture, twice (two Simulations, one scenario)', async () => {
    const sc = await katoomba3({ desktopDetail: 'finest', fireCellSize: 10, maxEmbers: 8000 });
    expect(sc.options.desktopDetail).toBe('finest');
    expect(sc.terrain.grid.cellSize).toBe(10);
    expect(sc.terrain.grid.nx).toBe(300);
    expect(sc.options.maxEmbers).toBe(8000);
    const a = run(sc, 600);
    const b = run(sc, 600);
    expect(a.snaps.size).toBeGreaterThan(8);
    expect(trace(b)).toBe(trace(a));
    // The fire burnt, so the hashes mean something.
    expect(a.snaps.get(600)!.fire.burnState.some((x) => x === 1 || x === 2)).toBe(true);
  }, 300_000);

  it('a finer grid is not the same answer: its hashes differ from the standard detail\'s over the same area, and the grid is nine times as fine', async () => {
    const finest = run(await katoomba3({ desktopDetail: 'finest', fireCellSize: 10, maxEmbers: 8000 }), 600);
    const standard = run(await katoomba3(), 600);
    expect(trace(finest)).not.toBe(trace(standard));
    expect(finest.snaps.get(600)!.engine!.fire.nx).toBe(300);
    expect(standard.snaps.get(600)!.engine!.fire.nx).toBe(100);
  }, 300_000);

  it('the grid, the ember cap and the record are the same in every picture, and nothing during the run changes them (a tier change, options, a rewind)', async () => {
    const sc = await katoomba3({ desktopDetail: 'finest', fireCellSize: 10, maxEmbers: 8000 });
    const before = JSON.stringify(sc.options);
    const r = run(sc, 300);
    r.sim.setQuality('standard'); // the person may change the air tier: the grid is not the tier's
    r.sim.setOption('embers', false);
    r.sim.setOption('embers', true);
    r.sim.setOption('coupling', 0.5);
    r.sim.setOption('maxStepS', 5);
    r.sim.advance(600);
    r.sim.rewind(240);
    r.sim.advance(600);
    expect(r.snaps.size).toBeGreaterThan(8);
    for (const [t, s] of r.snaps) {
      expect(s.engine!.fire.cellM, `cell at ${t}`).toBe(10);
      expect(s.engine!.fire.nx, `nx at ${t}`).toBe(300);
      expect(s.engine!.embers.max, `embers at ${t}`).toBe(8000);
    }
    // The scenario object (the page's record of the run) is untouched by the engine.
    expect(JSON.stringify(sc.options)).toBe(before);
    expect(sc.options.desktopDetail).toBe('finest');
    expect(sc.terrain.grid.cellSize).toBe(10);
  }, 300_000);
});
