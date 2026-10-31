/**
 * Wind direction in the engine (contract D-CONTRACT-060-wind, section 7.2). A synthetic flat 3 km scenario with a
 * westerly of 10 m/s and a fire west of the centre; the change turns the wind to come from the south at 600 s.
 * What it guards: the fire's head follows the change; nothing before the change moves (bitwise); two runs are the same,
 * whatever the display step, the statistics or the clock; an edit in the past, a change at a checkpoint boundary or at
 * time 0, and a removal ("as if never made") all equal the run that knew the change from the start; the speed and the
 * rest of the weather stay the forecast's; the standard tier and the in-thread controller get the same change.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { cellAt } from '../core/grid';
import { angleDiffDeg, uvToWind } from '../core/units';
import type { SimSnapshot, WindDirectionEdit, WindEdit } from '../core/types';
import { Simulation, type SimulationOptions } from './simulation';
import { LocalSimController } from './client';
import { snapshotHash, snapshotPartHashes } from './testing/hash';
import { pointIgnition, syntheticScenario } from './testing/scenarios';

const T = 600;
const turn = (id: string, dir: number, time: number): WindDirectionEdit => ({ kind: 'windDirection', id, dir, time });
const SOUTH = turn('w1', 180, T);

const scenario = (o: Parameters<typeof syntheticScenario>[0] = {}, edits: WindDirectionEdit[] = []): ReturnType<typeof syntheticScenario> => ({
  ...syntheticScenario({
    windFromDeg: 270,
    windKmh: 36,
    slopeDeg: 0,
    extent: 3000,
    duration: 3600,
    ignitions: [pointIgnition('a', -600, 0, 0, 60)],
    options: { snapshotInterval: 60 },
    ...o,
  }),
  ...(edits.length ? { edits } : {}),
});

interface Run {
  sim: Simulation;
  snaps: Map<number, SimSnapshot>;
  rewound: number[];
}

/** A simulation with its snapshots (by time) and rewound notices collected. */
function start(sc: ReturnType<typeof syntheticScenario>, o: Omit<SimulationOptions, 'hooks'> = {}): Run {
  const snaps = new Map<number, SimSnapshot>();
  const rewound: number[] = [];
  const sim = new Simulation(sc, { ...o, hooks: { snapshot: (s) => snaps.set(s.time, s), rewound: (t) => rewound.push(t) } });
  return { sim, snaps, rewound };
}

function run(sc: ReturnType<typeof syntheticScenario>, until: number, o: Omit<SimulationOptions, 'hooks'> = {}): Run {
  const r = start(sc, o);
  r.sim.spinUp();
  r.sim.advance(until);
  return r;
}

const parts = (a: SimSnapshot, b: SimSnapshot): string[] => {
  const pa = snapshotPartHashes(a);
  const pb = snapshotPartHashes(b);
  return Object.keys(pa).filter((k) => pa[k] !== pb[k]);
};

/** Assert two runs hold the same snapshots (every part but `ignore`, bitwise) at each of `times`. */
function expectSame(a: Run, b: Run, times: number[], label = '', ignore: string[] = []): void {
  for (const t of times) {
    expect(a.snaps.has(t) && b.snaps.has(t), `${label} snapshot at ${t}`).toBe(true);
    expect(parts(a.snaps.get(t)!, b.snaps.get(t)!).filter((k) => !ignore.includes(k)), `${label} t=${t}`).toEqual([]);
  }
}

/** The parts of a snapshot that describe the display window (insights since the last picture, accumulated layers), not the physics. */
const WINDOWED = ['insights', 'layers', 'layers.landing'];

const every = (from: number, to: number, step = 60): number[] => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

describe('Wind direction in the engine (fast tier)', () => {
  // No change, and the change at 600 s, each to 1800 s: shared by several tests.
  let base: Run;
  let turned: Run;
  beforeAll(() => {
    base = run(scenario(), 1800);
    turned = run(scenario({}, [SOUTH]), 1800);
  }, 240000);

  it('the fire follows the change: the head turns from east to the north-west of it, the area differs', () => {
    // equal to the no-change run up to the change
    for (const t of [300, 540, 600]) expect(turned.snaps.get(t)!.stats.headDir, `t=${t}`).toBe(base.snaps.get(t)!.stats.headDir);
    const head = (r: Run, t: number): number => r.snaps.get(t)!.stats.headDir;
    // wind from 270 pushes the head east (about 106); from the south it pushes it north (0)
    expect(Math.abs(angleDiffDeg(head(base, 1800), 106))).toBeLessThan(15);
    expect(Math.abs(angleDiffDeg(head(turned, 600), 106))).toBeLessThan(15);
    expect(Math.abs(angleDiffDeg(head(turned, 1800), 0))).toBeLessThan(20);
    // on its way: the head is between the two while the wind turns
    expect(head(turned, 900)).toBeGreaterThan(20);
    expect(head(turned, 900)).toBeLessThan(100);
    // and the burnt area is not the one the old wind makes
    const a0 = base.snaps.get(1800)!.stats.burntAreaHa;
    const a1 = turned.snaps.get(1800)!.stats.burntAreaHa;
    expect(Math.abs(a1 - a0) / a0).toBeGreaterThan(0.2);
  }, 240000);

  it('stats.weather carries the new direction and the forecast speed, temperature and humidity bitwise', () => {
    const dir = (t: number): number => turned.snaps.get(t)!.stats.weather.windDir10;
    expect(dir(600)).toBeCloseTo(270, 6);
    expect(dir(900)).toBeCloseTo(246.67, 1);
    expect(dir(1200)).toBeCloseTo(203.33, 1);
    expect(dir(1500)).toBeCloseTo(180, 6);
    for (const t of every(60, 1800)) {
      const a = base.snaps.get(t)!.stats.weather;
      const b = turned.snaps.get(t)!.stats.weather;
      expect(b.windSpeed10, `speed t=${t}`).toBe(a.windSpeed10);
      expect(b.temperature, `temperature t=${t}`).toBe(a.temperature);
      expect(b.relativeHumidity, `humidity t=${t}`).toBe(a.relativeHumidity);
      expect(turned.snaps.get(t)!.stats.ffdi, `ffdi t=${t}`).toBe(base.snaps.get(t)!.stats.ffdi);
    }
  });

  it('every snapshot up to the change is bitwise the no-change run, and the next one is not', () => {
    expectSame(base, turned, every(60, T), 'before the change');
    expect(parts(base.snaps.get(660)!, turned.snaps.get(660)!).length).toBeGreaterThan(0);
  });

  it('is deterministic: a second run, a display step of 300 s, no statistics and a wild clock give the same snapshots', () => {
    const again = run(scenario({}, [SOUTH]), 1800);
    expectSame(turned, again, every(60, 1800), 'second run');
    const five = run(scenario({ options: { snapshotInterval: 300 } }, [SOUTH]), 1800);
    expectSame(turned, five, every(300, 1800, 300), 'display step 300', WINDOWED);
    const quiet = run(scenario({}, [SOUTH]), 1800, { perfStats: false });
    expectSame(turned, quiet, every(60, 1800), 'no statistics');
    let n = 0;
    const wild = (): number => (n += 1 + ((n * 7919) % 13) * 17);
    const jitter = run(scenario({}, [SOUTH]), 1800, { clock: wild });
    expectSame(turned, jitter, every(60, 1800), 'wild clock');
  }, 240000);

  it('an edit made after the run has passed it equals a run that had it from the start', () => {
    const late = run(scenario(), 2400);
    expect(late.rewound).toEqual([]);
    late.snaps.clear();
    late.sim.edit(SOUTH, T);
    expect(late.rewound).toEqual([T]);
    late.sim.advance(1800);
    expectSame(late, turned, every(660, 1800), 'edit in the past');
  }, 240000);

  it('a rewind to a checkpoint that holds the change, and one to before it, re-run bitwise (each with its own stamps)', () => {
    const r = run(scenario({}, [SOUTH]), 2400);
    const first = new Map([...r.snaps].map(([t, s]) => [t, snapshotHash(s)]));
    for (const target of [1900, 900]) {
      r.snaps.clear();
      r.sim.rewind(target); // 1900: the checkpoint at 1800 has applied the change; 900: the one at 0 has not
      r.sim.advance(2400);
      expect(r.snaps.size, `rewind ${target}`).toBeGreaterThan(5);
      for (const [t, s] of r.snaps) expect(snapshotHash(s), `rewind ${target} t=${t}`).toBe(first.get(t));
    }
  }, 240000);

  it('a change at a checkpoint boundary (1800 s), and one at time 0 given with the scenario or as an edit, equal their fresh runs', () => {
    const at1800 = turn('w2', 180, 1800);
    const added = run(scenario(), 2400);
    added.sim.edit(at1800, 1800); // at the head's checkpoint: nothing is past yet at 1800, the run is at 2400
    added.snaps.clear();
    added.sim.advance(2400);
    const fresh = run(scenario({}, [at1800]), 2400);
    expectSame(added, fresh, every(1860, 2400), 'change at 1800');
    expect(fresh.snaps.get(2400)!.stats.weather.windDir10).toBeCloseTo(203.33, 1); // 600 s into the turn

    const zeroS = run(scenario({}, [turn('z', 180, 0)]), 1200);
    const zeroE = start(scenario());
    zeroE.sim.edit(turn('z', 180, 0), 0);
    zeroE.sim.advance(1200);
    expectSame(zeroS, zeroE, every(60, 1200, 60), 'change at time 0');
    expect(zeroS.snaps.get(1200)!.stats.weather.windDir10).toBeCloseTo(180, 6);
    const none = run(scenario(), 1200);
    expect(parts(none.snaps.get(120)!, zeroS.snaps.get(120)!).length).toBeGreaterThan(0);
  }, 240000);

  it('a time that is not a whole minute starts on the next one, whatever the step', () => {
    const odd = run(scenario({}, [turn('w1', 180, 541)]), 1200);
    expectSame(odd, run(scenario({}, [turn('w1', 180, 600)]), 1200), every(60, 1200), 'rounded up to 600');
  }, 240000);

  it('removing a change that has been applied equals a run that never had it, from its time on', () => {
    const r = run(scenario({}, [SOUTH]), 1800);
    r.snaps.clear();
    r.rewound.length = 0;
    r.sim.removeEdit('w1');
    expect(r.rewound).toEqual([T]);
    expect(r.sim.logicalNow).toBe(1800);
    r.sim.advance(1800);
    expect([...r.snaps.keys()].sort((a, b) => a - b)).toEqual(every(660, 1800));
    expectSame(r, base, every(660, 1800), 'removed');
    expect(r.snaps.get(1800)!.stats.weather.windDir10).toBeCloseTo(270, 6);
  }, 240000);

  it('removing one that has not started yet just drops it: no rewind, and the run equals one without it', () => {
    const r = run(scenario(), 600);
    r.sim.edit(turn('later', 90, 1800), 1800);
    r.rewound.length = 0;
    r.sim.removeEdit('later');
    expect(r.rewound).toEqual([]);
    r.sim.advance(1800);
    expectSame(r, base, every(660, 1800), 'dropped before it started');
  }, 240000);

  it('removing a change that a later checkpoint (1800 s) already holds restores the one before the change', () => {
    const r = run(scenario({}, [turn('a', 180, 1200)]), 2400);
    r.snaps.clear();
    r.rewound.length = 0;
    r.sim.removeEdit('a');
    expect(r.rewound).toEqual([1200]);
    r.sim.advance(2400);
    const never = run(scenario(), 2400);
    expectSame(r, never, every(1260, 2400), 'removed after a checkpoint');
  }, 240000);

  it('removing an unknown id changes nothing (the plain removal record, from now on)', () => {
    const r = run(scenario({}, [SOUTH]), 1200);
    r.sim.removeEdit('nobody');
    r.sim.advance(1800);
    expect(r.snaps.get(1800)!.stats.weather.windDir10).toBeCloseTo(180, 6);
  }, 240000);

  it('two changes: the second cuts the first and the direction ends where the last one says', () => {
    const r = run(scenario({}, [turn('a', 180, 600), turn('b', 90, 900)]), 1800);
    const dir = (t: number): number => r.snaps.get(t)!.stats.weather.windDir10;
    expect(dir(900)).toBeCloseTo(246.67, 1);
    expect(dir(1800)).toBeCloseTo(90, 6);
    expect(Math.abs(angleDiffDeg(r.snaps.get(1800)!.stats.headDir, 270))).toBeLessThan(30); // wind from the east pushes the head west
  }, 240000);

  it('a forecast swing that the change replaces raises no card of the forecast\'s (its own keys); with no change it does', () => {
    // The forecast swings from 270 to 200 degrees (40 km/h) at its 4 h stamp: the card comes 3 h ahead, from 3600 s on.
    const swung = (edits: WindDirectionEdit[]): ReturnType<typeof syntheticScenario> => {
      const sc = scenario({ duration: 7200 }, edits);
      return { ...sc, weather: { ...sc.weather, hours: sc.weather.hours.map((h) => (h.time >= sc.startTime + 3.2 * 3.6e6 ? { ...h, windDir10: 200, windSpeed10: 40 / 3.6 } : h)) } };
    };
    // (0.7.0: the change of the user's has cards of its own, `wind-change:user:<id>`; only the forecast's keys, `:domain`, are the swing's.)
    const keysAfter = (r: Run, after: number): string[] => [...r.snaps.values()].filter((sn) => sn.time > after).flatMap((sn) => sn.insights.map((i) => i.key ?? ''));
    const none = run(swung([]), 3900);
    expect(keysAfter(none, 3000)).toContain('wind-change:domain');
    const replaced = run(swung([SOUTH]), 3900); // the change starts at 600 s, long before the card would come
    expect(keysAfter(replaced, 600).filter((k) => k.endsWith(':domain') && (k.startsWith('wind-change') || k.startsWith('dead-man-zone')))).toEqual([]);
    expect(keysAfter(replaced, 600)).toContain('wind-change:user:w1');
  }, 240000);

  it('a local wind reading (Setup\'s belt kit) keeps its own direction through a turn of the whole wind, and removing it frees its place from then on', () => {
    // A reading at the middle, 1000 m, from the east (84 degrees); the whole wind turns to come from the south from 600 s.
    const reading: WindEdit = { kind: 'wind', id: 'belt-kit-1', x: 0, y: 0, radius: 1000, speed: 10, dir: 84, time: 0 };
    const r = run({ ...scenario({ ignitions: [] }), edits: [reading, SOUTH] }, 1500);
    const dirAt = (x: number, y: number): number => {
      const v = r.sim.stateView();
      const k = cellAt(v.terrain.grid, x, y);
      return uvToWind(v.windU[k]!, v.windV[k]!)[1];
    };
    expect(r.snaps.get(1500)!.stats.weather.windDir10).toBeCloseTo(180, 6); // the wind of the whole map has turned
    expect(Math.abs(angleDiffDeg(dirAt(-1300, 1300), 180))).toBeLessThan(5); // away from the reading
    expect(Math.abs(angleDiffDeg(dirAt(0, 0), 84))).toBeLessThan(20); // the reading's own place has not
    r.sim.removeEdit('belt-kit-1'); // the panel's Remove: the session's removeEdit, from now on
    r.sim.advance(1560);
    expect(Math.abs(angleDiffDeg(dirAt(0, 0), 180))).toBeLessThan(5);
  }, 240000);

  it('the in-thread controller (the app without a Worker) gives the same results as the bare simulation, for an edit and a removal', async () => {
    const sc = scenario();
    const c = new LocalSimController({ chunkMs: 30, simulation: { minSnapshotWallMs: 0 } });
    const snaps = new Map<number, SimSnapshot>();
    const rewound: number[] = [];
    c.on('snapshot', (s) => snaps.set(s.time, s));
    c.on('rewound', (t) => rewound.push(t));
    const waitFor = (pred: () => boolean, ms = 120000): Promise<void> =>
      new Promise((resolve, reject) => {
        const t0 = Date.now();
        const check = (): void => (pred() ? resolve() : Date.now() - t0 > ms ? reject(new Error('timeout')) : void setTimeout(check, 5));
        check();
      });
    await c.init(sc);
    c.edit(SOUTH, T);
    c.run(1800);
    await waitFor(() => snaps.has(1800));
    expectSame({ sim: base.sim, snaps, rewound }, turned, every(60, 1800), 'in-thread edit');
    snaps.clear();
    c.removeEdit('w1');
    await waitFor(() => rewound.includes(T));
    c.run(1800);
    await waitFor(() => snaps.has(1800));
    expectSame({ sim: base.sim, snaps, rewound }, base, every(660, 1800), 'in-thread removal');
    c.dispose();
  }, 240000);
});

describe('Wind direction in the engine (3-D air)', () => {
  const sc = (edits: WindDirectionEdit[] = []): ReturnType<typeof syntheticScenario> => scenario({ extent: 1500, duration: 1800, options: { snapshotInterval: 60, tier: 'standard' } }, edits);
  const centreDir = (r: Run): number => {
    const v = r.sim.stateView();
    const k = cellAt(v.terrain.grid, 0, 0);
    return uvToWind(v.windBgU[k]!, v.windBgV[k]!)[1];
  };

  it('standard tier: the change is deterministic, bitwise before the change, and the 3-D background follows it', () => {
    const a = run(sc([turn('w1', 180, 300)]), 1500, { tier: 'standard' });
    const b = run(sc([turn('w1', 180, 300)]), 1500, { tier: 'standard' });
    const none = run(sc(), 1500, { tier: 'standard' });
    expectSame(a, b, every(60, 1500, 60), 'standard, second run');
    expectSame(a, none, every(60, 300, 60), 'standard, before the change');
    expect(parts(a.snaps.get(360)!, none.snaps.get(360)!).length).toBeGreaterThan(0);
    expect(a.snaps.get(1500)!.stats.weather.windDir10).toBeCloseTo(180, 6);
    expect(Math.abs(angleDiffDeg(centreDir(a), 180))).toBeLessThan(10);
    expect(Math.abs(angleDiffDeg(centreDir(none), 270))).toBeLessThan(5);
  }, 600000);

  it('the 3-D air runs within 25 degrees of the ambient while it turns and 30 minutes after the change it is within 5 degrees (lag table of contract 7.4)', () => {
    const big = scenario({ extent: 3000, duration: 3600, ignitions: [], options: { snapshotInterval: 60, tier: 'standard' } }, [turn('w1', 180, 300)]);
    const r = start(big, { tier: 'standard' });
    r.sim.spinUp();
    const ambient = (t: number): number => r.snaps.get(t)!.stats.weather.windDir10;
    const worst: number[] = [];
    let last = 0;
    for (const t of [600, 900, 1200, 1500, 1800, 2100]) {
      r.sim.advance(t);
      const v = r.sim.stateView();
      const k = cellAt(v.terrain.grid, 0, 0);
      const fire = uvToWind(v.windU[k]!, v.windV[k]!)[1];
      worst.push(Math.abs(angleDiffDeg(fire, ambient(t))));
      last = fire;
    }
    expect(Math.max(...worst)).toBeLessThan(25);
    expect(worst.at(-1)!).toBeLessThan(5);
    expect(Math.abs(angleDiffDeg(last, 180))).toBeLessThan(5);
  }, 600000);

  it('switching to the standard tier after the change keeps the new wind', () => {
    const r = run(scenario({ extent: 1500, duration: 1800 }, [turn('w1', 180, 300)]), 900);
    expect(r.sim.tier).toBe('fast');
    r.sim.setQuality('standard');
    r.sim.advance(1500);
    expect(r.sim.tier).toBe('standard');
    expect(r.snaps.get(1500)!.stats.weather.windDir10).toBeCloseTo(180, 6);
    expect(Math.abs(angleDiffDeg(centreDir(r), 180))).toBeLessThan(10);
  }, 600000);

  it('a rewind across the change and back is bitwise (the stamp pair is re-bound from the checkpoint)', () => {
    const a = run(sc([turn('w1', 180, 300)]), 1200, { tier: 'standard' });
    const hashes = new Map([...a.snaps].map(([t, s]) => [t, snapshotHash(s)]));
    a.snaps.clear();
    a.sim.rewind(240); // before the change: the checkpoint is t0, which has not applied it
    a.sim.advance(1200);
    for (const [t, s] of a.snaps) expect(snapshotHash(s), `t=${t}`).toBe(hashes.get(t));
    expect(a.snaps.size).toBeGreaterThan(0);
  }, 600000);
});

/**
 * The cards of a change of the user's, and the Danger-gate gap (0.7.0, contract D-CONTRACT-070-wind-small, items 1.2 and 1.3). `madeAt` is
 * the view time at which the user pressed Apply: from then on the engine counts the change (the forecast's swings after its start stop
 * raising cards, its own cards come), though the record only applies at its start. The physics never sees `madeAt`.
 */
describe('Wind direction cards (0.7.0)', () => {
  const made = (id: string, dir: number, time: number, madeAt?: number): WindDirectionEdit => ({ kind: 'windDirection', id, dir, time, ...(madeAt === undefined ? {} : { madeAt }) });
  /** The forecast swings from 270 to 200 degrees at 40 km/h from its 4 h stamp (the card comes 3 h ahead, from 3600 s on). */
  const swung = (edits: WindDirectionEdit[], o: Parameters<typeof syntheticScenario>[0] = {}): ReturnType<typeof syntheticScenario> => {
    const sc = scenario({ duration: 7200, ...o }, edits);
    return { ...sc, weather: { ...sc.weather, hours: sc.weather.hours.map((h) => (h.time >= sc.startTime + 3.2 * 3.6e6 ? { ...h, windDir10: 200, windSpeed10: 40 / 3.6 } : h)) } };
  };
  const cards = (r: Run, from = 0, to = Infinity): { key: string; severity: string; body: string; time: number }[] =>
    [...r.snaps.values()]
      .filter((sn) => sn.time > from && sn.time <= to)
      .flatMap((sn) => sn.insights.filter((i) => i.kind === 'wind-change' || i.kind === 'dead-man-zone').map((i) => ({ key: i.key ?? '', severity: i.severity, body: i.body, time: i.time })));
  const dmzAt = (r: Run, t: number): Float32Array | undefined => r.snaps.get(t)?.layers?.dmz;
  /** What the engine said, snapshot by snapshot (id, severity and words of every card): the same list means the same cards at every cycle. */
  const said = (r: Run, times: number[]): string[][] => times.map((t) => (r.snaps.get(t)?.insights ?? []).map((i) => `${i.id}|${i.severity}|${i.body}`));

  it('the gap is closed: a swing that a change made earlier replaces raises no card from the moment of making it, and the physics does not see madeAt', () => {
    // A hold from 240 degrees (30 degrees, so the change has no card of its own) at 6000 s; the forecast's swing is at 14400 s.
    const ctrl = run(swung([made('h', 240, 6000)]), 3900); // not made until its start: the swing's card comes 3 h ahead, from 3600 s on
    expect(cards(ctrl, 3000).map((c) => c.key)).toContain('wind-change:domain');
    const gap = run(swung([made('h', 240, 6000, 0)]), 3900);
    expect(cards(gap)).toEqual([]);
    for (const t of every(60, 3900)) expect(dmzAt(gap, t), `dmz t=${t}`).toBeUndefined();
    gap.sim.advance(5400);
    expect(cards(gap)).toEqual([]);
    // madeAt is no part of the physics: every snapshot, but the cards and the layers, is bitwise the run that does not have it.
    expectSame(gap, ctrl, every(60, 3900), 'madeAt', WINDOWED);
    expect(gap.snaps.get(3900)!.stats.weather.windDir10).toBeCloseTo(270, 6); // the hold is still ahead
  }, 600000);

  it('a change made now gets its own card at the next cycle: Watch, its own key, in the user\'s words; a zone while its start is ahead, none once it has started', () => {
    const r = run(scenario({ duration: 7200 }, [made('w1', 180, 3600, 0)]), 3720);
    const first = cards(r).find((c) => c.key === 'wind-change:user:w1')!;
    expect(first).toBeDefined();
    expect(first.severity).toBe('watch');
    expect(first.body.startsWith('You set the wind to swing from the west to the south, starting at about ')).toBe(true);
    expect(first.time).toBeLessThanOrEqual(120);
    const zone = cards(r).filter((c) => c.key === 'dead-man-zone:user:w1');
    expect(zone.length).toBeGreaterThan(0);
    expect(zone[0]!.severity).toBe('watch');
    expect(zone[0]!.body).toContain('The change you set, to the south,');
    // The layer is there while the start is ahead (at most an hour: from the first cycle for a start at 3600 s) and gone at the start.
    for (const t of every(120, 3480, 360)) {
      const layer = dmzAt(r, t);
      expect(layer, `dmz t=${t}`).toBeInstanceOf(Float32Array);
      expect(Math.max(...layer!), `dmz t=${t}`).toBeGreaterThan(0);
    }
    for (const t of [3600, 3660, 3720]) expect(dmzAt(r, t), `dmz t=${t}`).toBeUndefined();
    expect(cards(r).filter((c) => c.severity === 'danger')).toEqual([]); // never Danger: it never pauses the run
  }, 600000);

  it('a turn of 30 degrees, or a wind of 12 km/h after it, raises neither card; "now" (the start within a minute) raises the card and no zone', () => {
    const small = run(scenario({ duration: 7200 }, [made('w1', 240, 3600, 0)]), 420);
    expect(cards(small)).toEqual([]);
    expect(dmzAt(small, 420)).toBeUndefined();
    const slow = run(scenario({ duration: 7200, windKmh: 12 }, [made('w1', 180, 3600, 0)]), 420);
    expect(cards(slow)).toEqual([]);
    const now = run(scenario({ duration: 7200 }, [made('w1', 180, 60, 60)]), 300);
    expect(cards(now).map((c) => c.key)).toEqual(['wind-change:user:w1']);
    for (const t of every(60, 300)) expect(dmzAt(now, t), `dmz t=${t}`).toBeUndefined();
  }, 600000);

  it('the changes the engine may count are those made before the step time; a change that starts inside an earlier one starts from the value it has reached', () => {
    const sc = scenario({ duration: 7200, extent: 1500, ignitions: [] }, [made('a', 180, 1800, 0), made('b', 90, 2100, 1000), made('c', 0, 4000, 1500)]);
    const r = start(sc);
    r.sim.spinUp();
    const none = r.sim.stateView();
    expect(none.windUserChanges).toBeUndefined(); // before the first step nothing has been made yet
    expect(none.windOverrideFromMs).toBeUndefined();
    const ids = (t: number): string[] => {
      r.sim.advance(t);
      return (r.sim.stateView().windUserChanges ?? []).map((c) => c.id);
    };
    expect(ids(120)).toEqual(['a']);
    const s0 = sc.startTime + 1800_000;
    expect(r.sim.stateView().windOverrideFromMs).toBe(s0); // the forecast's later swings are left out from the start of `a`, which has not started
    expect(ids(900)).toEqual(['a']);
    expect(ids(1100)).toEqual(['a', 'b']);
    expect(r.sim.stateView().windOverrideFromMs).toBe(s0);
    const [a, b] = r.sim.stateView().windUserChanges!;
    expect(a!.time).toBe(s0);
    expect(a!.fromDir).toBeCloseTo(270, 6);
    expect(a!.toDir).toBe(180);
    expect(b!.time).toBe(s0 + 300_000);
    expect(b!.fromDir).toBeCloseTo(246.67, 1); // 300 s into a's turn
    expect(b!.toDir).toBe(90);
    expect(a!.preSpeed).toBeCloseTo(10, 6); // the forecast's 36 km/h: a turn leaves it alone
    expect(a!.postSpeed).toBeCloseTo(10, 6);
    expect(ids(1400)).toEqual(['a', 'b']);
    expect(ids(1600)).toEqual(['a', 'b', 'c']);
    expect(r.sim.stateView().windUserChanges![2]!.fromDir).toBeCloseTo(90, 6); // b has finished by 4000 s
  }, 600000);

  it('explain is a function of the record list and the step time: an edit added during the run and one given from the start say the same at every cycle, and a replay says it again', () => {
    // The change was made at 1200 (madeAt) for a start at 3000: the first run did not know it before 1200, so neither does a run that has it from the start.
    const e = made('w1', 180, 3000, 1200);
    const fresh = run(scenario({ duration: 7200 }, [e]), 2100);
    const added = run(scenario({ duration: 7200 }), 1200);
    added.sim.edit(e, 3000); // the record is for later than now: nothing is rewound
    expect(added.rewound).toEqual([]);
    added.sim.advance(2100);
    const times = every(60, 2100);
    expect(said(added, times)).toEqual(said(fresh, times));
    expect(cards(fresh, 0, 1200)).toEqual([]);
    expect(cards(fresh, 1200).map((c) => c.key)).toContain('wind-change:user:w1');
    // A replay from the checkpoint at 0 reproduces the first run's cards, not only its hashes.
    added.snaps.clear();
    added.sim.rewind(0);
    added.sim.advance(2100);
    expect(said(added, times)).toEqual(said(fresh, times));
    expectSame(added, fresh, times, 'replay', WINDOWED);
  }, 600000);

  it('removing a change that has not started takes it away as if never made, from when it was made: its cards and its zone are gone from then on, and the run is the one that never had it', () => {
    // Made at 600 (the view time) for a start at 3600; removed at 1500, when its card and zone have been up for fifteen minutes.
    const e = made('w1', 180, 3600, 600);
    const control = run(scenario({ duration: 7200 }), 2400);
    const r = run(scenario({ duration: 7200 }), 600);
    r.sim.edit(e, 3600); // the record is for later than now: nothing is rewound
    r.sim.advance(1500);
    expect(r.rewound).toEqual([]);
    expect(cards(r, 600).map((c) => c.key)).toEqual(expect.arrayContaining(['wind-change:user:w1', 'dead-man-zone:user:w1']));
    expect(dmzAt(r, 1500)).toBeInstanceOf(Float32Array);
    expect(cards(control)).toEqual([]);
    r.sim.removeEdit('w1');
    expect(r.rewound).toEqual([600]); // the results after 600 are stale: they were computed with the change known
    for (const t of every(660, 1500)) r.snaps.delete(t); // what the receiver is told to drop; the run now sends them again
    r.sim.advance(2400);
    // Nothing the change raised is left, and every snapshot (physics, cards, layers, the lot) is the run that never had it.
    expect(cards(r, 600).filter((c) => c.key.includes(':user:'))).toEqual([]);
    for (const t of every(660, 2400)) expect(dmzAt(r, t), `dmz t=${t}`).toBeUndefined();
    expectSame(r, control, every(660, 2400), 'removed');
  }, 600000);

  it('a change that has started comes away from when it was made too: the cards it raised before its start go, and the run equals the one that never had it', () => {
    const e = made('w1', 180, 1200, 600);
    const control = run(scenario({ duration: 7200 }), 3000);
    const r = run(scenario({ duration: 7200 }), 600);
    r.sim.edit(e, 1200);
    r.sim.advance(2400); // it started at 1200 and has turned (done at 2100)
    expect(r.snaps.get(2400)!.stats.weather.windDir10).toBeCloseTo(180, 6);
    expect(cards(r, 600, 1200).map((c) => c.key)).toContain('wind-change:user:w1');
    r.rewound.length = 0;
    r.sim.removeEdit('w1');
    expect(r.rewound).toEqual([600]); // not 1200, its start
    for (const t of every(660, 2400)) r.snaps.delete(t);
    r.sim.advance(3000);
    expect(cards(r, 600).filter((c) => c.key.includes(':user:'))).toEqual([]);
    expect(r.snaps.get(2400)!.stats.weather.windDir10).toBeCloseTo(270, 6); // the forecast again
    expectSame(r, control, every(660, 3000), 'removed after the start');
  }, 600000);

  it('a change without madeAt (a scenario edit) is taken away from its start, as before: nothing earlier is recomputed', () => {
    const r = run(scenario({ duration: 7200 }, [made('w1', 180, 1200)]), 1800);
    r.rewound.length = 0;
    r.sim.removeEdit('w1');
    expect(r.rewound).toEqual([1200]);
  }, 600000);

  it('two changes made at different times: removing the later one leaves the earlier one\'s cards and takes its own', () => {
    const control = run(scenario({ duration: 7200 }), 600);
    control.sim.edit(made('a', 180, 3600, 600), 3600);
    control.sim.advance(2100);
    const r = run(scenario({ duration: 7200 }), 600);
    r.sim.edit(made('a', 180, 3600, 600), 3600);
    r.sim.advance(1200);
    r.sim.edit(made('b', 90, 3000, 1200), 3000);
    r.sim.advance(1800);
    expect(cards(r, 1200).filter((c) => c.key.includes(':user:b'))).not.toEqual([]);
    r.rewound.length = 0;
    r.sim.removeEdit('b');
    expect(r.rewound).toEqual([1200]);
    for (const t of every(1260, 1800)) r.snaps.delete(t);
    r.sim.advance(2100);
    expect(cards(r, 1200).filter((c) => c.key.includes(':user:b'))).toEqual([]);
    expect(cards(r).filter((c) => c.key === 'wind-change:user:a')).toEqual(cards(control).filter((c) => c.key === 'wind-change:user:a'));
    expectSame(r, control, every(1260, 2100), 'b removed');
  }, 600000);
});
