/**
 * Engine info (SimSnapshot.engine, core/simTypes.ts EngineInfo): every field equals the value of the module that owns
 * it, in both kinds of tier, after a tier switch mid-run and after a rewind; the spread models follow the fuel map; the
 * memory is measured at most every 30 wall-seconds; the physics hashes ignore it. The Auto policy of 0.3.0 (plan §6.2):
 * the warm-up is skipped, the median decides, the ceiling is ten minutes for six hours, and the tier never changes after
 * the one decision at the start. The timing statistics block (`perf`) is clean and small in both kinds of tier.
 */
import { describe, expect, it } from 'vitest';
import { FuelType, type EngineInfo, type FuelEdit, type SimSnapshot } from '../core/types';
import { ATMOS_PARAMS, ATMOS_TIERS } from '../atmosphere';
import { EMBER_CLASSES, EMBER_PARAMS } from '../embers';
import { SPREAD_PARAMS } from '../fire/spread/params';
import { Simulation } from './simulation';
import { SIM_PARAMS } from './params';
import { autoTuneDecision, autoTuneEventText, FAST_TIER_STEP_S, formatWallDuration, medianStampS, spreadModelName, spreadModelUse, tierReasonText } from './engineInfo';
import { snapshotHash } from './testing/hash';
import { pointIgnition, syntheticScenario } from './testing/scenarios';

interface AtmGrid {
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  dz1: number;
  Hp: number;
  stretch: number;
}
const atmGrid = (sim: Simulation): AtmGrid => (sim as unknown as { atm: { grid: AtmGrid } }).atm.grid;

function collect(): { snaps: Map<number, SimSnapshot>; snapsAll: SimSnapshot[]; hooks: { snapshot: (s: SimSnapshot) => void } } {
  const snaps = new Map<number, SimSnapshot>();
  const snapsAll: SimSnapshot[] = [];
  return { snaps, snapsAll, hooks: { snapshot: (s) => (snaps.set(s.time, s), snapsAll.push(s)) } };
}

/** No field of the engine info is undefined or NaN (null means "not measured yet"). */
function expectClean(v: unknown, path = 'engine'): void {
  if (v === null) return;
  if (typeof v === 'number') {
    expect(Number.isNaN(v), path).toBe(false);
    return;
  }
  expect(v, path).not.toBeUndefined();
  if (typeof v === 'object') for (const [k, x] of Object.entries(v as object)) expectClean(x, `${path}.${k}`);
}

describe('engine info: fast tier (DiagnosticWind)', () => {
  const scenario = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], options: { snapshotInterval: 300 } });

  it('reports the real grids, steps, cadences and models of the running engine', () => {
    const c = collect();
    const sim = new Simulation(scenario, { hooks: c.hooks });
    const e0 = sim.snapshot().engine!;
    expect(e0).toBeDefined();
    expect(e0.tier).toBe('fast');
    expect(e0.tierRequested).toBe('fast');
    expect(e0.tierCause).toBe('requested');
    expect(e0.atmosphere.currentStepS).toBeNull(); // no step yet
    sim.advance(2100); // (not on a checkpoint time: the checkpoint of a boundary is taken after its snapshot)
    const e = c.snaps.get(2100)!.engine!;
    expectClean(e);
    const g = atmGrid(sim);
    // 3 km: Δx_a = clamp(3000 / 45, 100, 270) = 100 m → 30 × 30 columns, 20 levels (the fast tier's mass-consistent grid).
    expect(e.atmosphere).toMatchObject({ kind: 'diagnostic', nx: g.nx, ny: g.ny, nz: g.nz, dxM: g.dx, dzFirstM: g.dz1, topM: g.Hp, stretch: g.stretch, spunUp: false });
    expect([e.atmosphere.nx, e.atmosphere.nz, e.atmosphere.dxM]).toEqual([30, ATMOS_TIERS.fast.levels, 100]);
    expect(e.atmosphere.topM).toBeGreaterThanOrEqual(ATMOS_PARAMS.atmosTop);
    expect(e.atmosphere.currentStepS).toBe(10); // §12.2: fast tier 10 s fixed
    expect(e.atmosphere.viewDecimated).toBe(false);
    expect(e.atmosphere.upperAir).toBe('none'); // synthetic weather has no upper air
    const fg = scenario.terrain.grid;
    expect(e.fire).toMatchObject({ nx: fg.nx, ny: fg.ny, cellM: 30, maxSpreadRate: SPREAD_PARAMS.levelSet.rosMaxMs });
    expect(e.fire.forestHeadCapMs).toBeCloseTo(15 / 3.6, 6);
    expect(e.fire.validSlopeDeg).toEqual([SPREAD_PARAMS.validation.headSlopeMinDeg, SPREAD_PARAMS.validation.headSlopeMaxDeg]);
    // A burning front: the level-set sub-step is the CFL bound or the whole 10 s step, whichever is shorter.
    expect(e.fire.currentSubStepS).toBeGreaterThan(0);
    expect(e.fire.currentSubStepS).toBeLessThanOrEqual(10);
    const bound = (sim as unknown as { fire: { maxStableDt(): number } }).fire.maxStableDt();
    expect(e.fire.currentSubStepS!).toBeCloseTo(Math.min(bound, 10), 0);
    expect(e.embers).toMatchObject({ on: true, max: 1000, stepS: 10, subStepMinS: EMBER_PARAMS.transport.dtMin, subStepMaxS: EMBER_PARAMS.transport.dtMax });
    expect(e.embers.classes).toEqual([...EMBER_CLASSES]);
    expect(e.embers.active).toBe(c.snaps.get(2100)!.stats.activeEmbers);
    expect(e.cadence).toEqual({
      displayStepS: 300,
      solverMaxStepS: 0,
      solverBoundS: FAST_TIER_STEP_S,
      solverFloorS: FAST_TIER_STEP_S,
      moistureUpdateS: SIM_PARAMS.solarIntervalS,
      detectorsS: SIM_PARAMS.minuteS,
      checkpointS: SIM_PARAMS.checkpointIntervalS,
      checkpointRing: SIM_PARAMS.checkpointRing,
      weatherStampS: 3600,
      weatherInterpolation: 'linear',
    });
    expect(e.run).toMatchObject({ seed: 7, deterministic: true, spinUpS: 0, checkpoints: sim.checkpointTimes.length, checkpointBytes: sim.checkpointBytes() });
    expect(e.run.steps).toBe(210); // 2100 s in 10 s steps
    expect(e.models).toEqual({
      spread: [{ family: 'vesta2', model: 'Vesta Mk2', cells: fg.nx * fg.ny, share: 1 }],
      coupling: 1,
      mountainPhenomena: true,
      embersOn: true,
      pyrogenic: true,
      heathModel: 'refit2024',
    });
    // Measured memory: the parts add up and match a fresh report.
    const m = e.memory!;
    expect(m.parts.map((p) => p.name)).toEqual(['scenario', 'fuel', 'fire', 'moisture', 'atmosphere', 'embers', 'explain', 'checkpoints', 'rasters']);
    expect(m.parts.reduce((a, p) => a + p.bytes, 0)).toBe(m.totalBytes);
    expect(m.totalBytes).toBeGreaterThan(1e6);
    // Small and structured-clone friendly: the block as before, and the timing statistics under 2 KB on top of it.
    expect(structuredClone(e)).toEqual(e);
    expect(JSON.stringify({ ...e, perf: undefined }).length).toBeLessThan(2500);
    expect(JSON.stringify(e.perf).length).toBeLessThan(2048);
  }, 120000);

  it('the timing statistics block is complete and consistent after a run (fast tier)', () => {
    const c = collect();
    const sim = new Simulation(scenario, { hooks: c.hooks });
    expect(sim.snapshot().engine!.perf).toMatchObject({ speed: { s10: null, mean: null }, history: [], step: { medianMs: null, over100: 0 }, events: [] });
    sim.advance(2100);
    const e = c.snaps.get(2100)!.engine!;
    const p = e.perf!;
    expectClean(p);
    expect(p.speed.mean).toBeGreaterThan(0);
    // The same measurement (run.simSecondsPerWallSecond counts the simulated seconds of the step under way, one step in 210).
    expect(Math.abs(p.speed.mean! / e.run.simSecondsPerWallSecond! - 1)).toBeLessThan(0.02);
    expect(p.step).toMatchObject({ nowS: 10, minS: 10, meanS: 10, maxS: 10 });
    expect(p.step.medianMs!).toBeGreaterThan(0);
    expect(p.step.p95Ms!).toBeGreaterThanOrEqual(p.step.medianMs!);
    expect(p.step.maxMs!).toBeGreaterThanOrEqual(p.step.p95Ms!);
    expect(p.modules.map((m) => m.id)).toEqual(['air', 'fire', 'coupling', 'embers', 'moisture', 'detectors', 'picture', 'checkpoints', 'other']);
    expect(p.modules.reduce((a, m) => a + m.share!, 0)).toBeCloseTo(1, 1);
    expect(p.modules.find((m) => m.id === 'fire')!.share!).toBeGreaterThan(0);
    expect(p.quality.limitedBy).toBeNull(); // the fast tier has no time-stepped air
    expect(p.quality.fireSubSteps!).toBeGreaterThan(0); // a front is burning: the level set takes sub-steps
    expect(p.quality.burningCells).toBe(c.snaps.get(2100)!.stats.burningCells);
    expect(p.quality.spinUpWallS).toBe(0);
    expect(p.reruns).toEqual({ rewinds: 0, recomputedS: 0, tierSwitches: 0, restores: 0 });
    expect(p.embers).toBeNull(); // the ember model keeps no running total of landings
    expect(p.duty.s10).toBeGreaterThan(0.5); // advance() is flat out
  }, 120000);

  it('rewinds, restores and re-computed seconds are counted and told as events', () => {
    const c = collect();
    const sim = new Simulation(scenario, { hooks: c.hooks });
    sim.advance(2100);
    sim.rewind(1000); // restores the checkpoint at 0 (the one at 1800 is later), replays from there
    sim.advance(2100);
    const p = sim.snapshot().engine!.perf!; // after the last step: the snapshot made inside a step lacks that step
    expect(p.reruns.rewinds).toBe(1);
    expect(p.reruns.restores).toBe(1);
    expect(p.reruns.recomputedS).toBe(2100); // all of the first 2100 s were computed twice
    expect(p.reruns.tierSwitches).toBe(0);
    const events = c.snapsAll.flatMap((x) => x.engine!.perf!.events);
    expect(events.map((x) => x.kind)).toEqual(['restore']);
    expect(events[0]!.text).toMatch(/Rewound to 17\smin.*checkpoint at 0\smin/);
    expect(events[0]!.seq).toBe(1);
    // The re-run is the same run bit for bit, statistics or not.
    const at = c.snapsAll.filter((x) => x.time === 2100);
    expect(at).toHaveLength(2);
    expect(snapshotHash(at[0]!)).toBe(snapshotHash(at[1]!));
  }, 120000);

  it('options and the solver step show up at once; the physics hash ignores the engine info', () => {
    const c = collect();
    const sim = new Simulation(scenario, { hooks: c.hooks });
    sim.setOption('embers', false);
    sim.setOption('coupling', 0);
    sim.setOption('maxStepS', 2);
    sim.setOption('snapshotInterval', 120);
    sim.advance(600);
    const e = c.snaps.get(600)!.engine!;
    expect(e.embers.on).toBe(false);
    expect(e.embers.stepS).toBeNull();
    expect(e.models).toMatchObject({ coupling: 0, embersOn: false, pyrogenic: false });
    expect(e.cadence.solverMaxStepS).toBe(2);
    expect(e.cadence.displayStepS).toBe(120);
    expect(e.atmosphere.currentStepS).toBe(2);
    // Two snapshots that differ only in their engine info hash the same.
    const s = c.snaps.get(600)!;
    const other: SimSnapshot = { ...s, engine: { ...e, run: { ...e.run, simSecondsPerWallSecond: 12345 }, tierReason: 'x' } };
    expect(snapshotHash(other)).toBe(snapshotHash(s));
  }, 120000);

  it('the spread models follow the fuel map and a fuel edit', () => {
    const c = collect();
    const sim = new Simulation(scenario, { hooks: c.hooks });
    sim.advance(300);
    expect(c.snaps.get(300)!.engine!.models.spread.map((m) => m.family)).toEqual(['vesta2']);
    // A grass paddock over a third of the domain (x < -500 m) from 300 s.
    const edit: FuelEdit = { kind: 'fuel', id: 'paddock', shape: { kind: 'polygon', points: [[-1600, -1600], [-500, -1600], [-500, 1600], [-1600, 1600]] }, setType: FuelType.Grassland };
    sim.edit(edit, 300);
    sim.advance(600);
    const spread = c.snaps.get(600)!.engine!.models.spread;
    expect(spread.map((m) => [m.family, m.model])).toEqual([
      ['vesta2', 'Vesta Mk2'],
      ['grass', 'CSIRO grassland'],
    ]);
    expect(spread[0]!.share + spread[1]!.share).toBeCloseTo(1, 9);
    expect(spread[1]!.share).toBeGreaterThan(0.3);
    expect(spread[1]!.share).toBeLessThan(0.4);
  }, 120000);

  it('the memory is measured at most every 30 wall-seconds', () => {
    let now = 0;
    const c = collect();
    const sim = new Simulation(scenario, { hooks: c.hooks, clock: () => now });
    sim.advance(600);
    const first = c.snaps.get(300)!.engine!.memory!;
    expect(first.measuredAt).toBe(300); // measured with the first snapshot the engine made (no t0 snapshot was asked for)
    expect(c.snaps.get(600)!.engine!.memory!.measuredAt).toBe(300);
    now += 30_000;
    sim.advance(900);
    expect(c.snaps.get(900)!.engine!.memory!.measuredAt).toBe(900);
  }, 120000);
});

describe('engine info: 3-D tiers and tier changes', () => {
  it('standard tier: the Boussinesq grid, its stability-limited step and the spin-up', () => {
    const c = collect();
    const sim = new Simulation(syntheticScenario({ extent: 2400, ignitions: [pointIgnition('a', -300, 0, 0, 60)], options: { snapshotInterval: 300 } }), { tier: 'standard', hooks: c.hooks });
    expect(sim.snapshot().engine!.atmosphere.spunUp).toBe(false);
    sim.advance(600);
    const e = c.snaps.get(600)!.engine!;
    expectClean(e);
    const g = atmGrid(sim);
    // 2.4 km: Δx_a = clamp(2400 / 45, 100, 270) = 100 m → 24 × 24 columns, 20 levels, Δζ₁ 30 m.
    expect(e.atmosphere).toMatchObject({ kind: '3d', nx: g.nx, ny: g.ny, nz: g.nz, dxM: g.dx, dzFirstM: g.dz1, topM: g.Hp, spunUp: true });
    expect([g.nx, g.nz, g.dx, g.dz1]).toEqual([24, ATMOS_TIERS.standard.levels, 100, ATMOS_TIERS.standard.dz1]);
    expect(e.atmosphere.currentStepS).toBeGreaterThanOrEqual(ATMOS_PARAMS.dtMin - 1e-9);
    expect(e.atmosphere.currentStepS).toBeLessThanOrEqual(SIM_PARAMS.dtMaxS + 1e-9);
    expect(e.cadence).toMatchObject({ solverBoundS: SIM_PARAMS.dtMaxS, solverFloorS: ATMOS_PARAMS.dtMin });
    expect(e.run.spinUpS).toBe(SIM_PARAMS.spinUpS);
    expect(e.models.pyrogenic).toBe(false); // the resolved 3-D plume replaces the 2-D estimate
    expect(e.embers.max).toBe(1000);
    expect(e.tierCause).toBe('requested');
    // The timing statistics of a 3-D tier: what limited the air steps, the wind maxima, the projection, the spin-up.
    const q = e.perf!.quality;
    const lim = q.limitedBy!;
    expect(lim.cflH + lim.cflV + lim.cap + lim.user).toBeCloseTo(1, 2);
    expect(q.maxWindH!).toBeGreaterThan(0);
    expect(q.maxWindV!).toBeGreaterThanOrEqual(0);
    expect(q.projectionCorrections!).toBeGreaterThanOrEqual(ATMOS_TIERS.standard.vCycles);
    expect(q.spinUpWallS!).toBeGreaterThan(0);
    expect(e.perf!.step.nowS!).toBeGreaterThanOrEqual(ATMOS_PARAMS.dtMin - 1e-9);
    expect(e.perf!.step.maxS!).toBeLessThanOrEqual(SIM_PARAMS.dtMaxS + 1e-9);
    const air = e.perf!.modules.find((m) => m.id === 'air')!;
    expect(air.share!).toBeGreaterThan(0.2); // the 3-D step is a large part of a step of this tier
    expect(e.perf!.modules.reduce((a, m) => a + m.share!, 0)).toBeCloseTo(1, 1);
    expect(e.perf!.speed.mean!).toBeGreaterThan(0);
  }, 240000);

  it('a tier switch mid-run changes the report from the checkpoint on, and a rewind before it changes it back', () => {
    const c = collect();
    const sim = new Simulation(syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent: 2400, options: { snapshotInterval: 300 } }), { hooks: c.hooks });
    sim.advance(2400);
    expect(c.snaps.get(2400)!.engine!.atmosphere.kind).toBe('diagnostic');
    c.snaps.clear();
    sim.setQuality('standard');
    sim.advance(2400);
    const e = c.snaps.get(2400)!.engine!;
    expect(e.tier).toBe('standard');
    expect(e.atmosphere.kind).toBe('3d');
    expect(e.atmosphere.nz).toBe(ATMOS_TIERS.standard.levels);
    expect(e.tierCause).toBe('changed');
    expect(e.tierChangedAt).toBe(1800); // the checkpoint the engine re-ran from
    expect(e.tierReason).toMatch(/Changed during the run.*30\smin/);
    expect(e.tierRequested).toBe('fast');
    c.snaps.clear();
    sim.rewind(900);
    sim.advance(1200);
    const back = c.snaps.get(1200)!.engine!;
    expect(back.tier).toBe('fast');
    expect(back.tierCause).toBe('requested');
    expect(back.tierChangedAt).toBeNull();
  }, 240000);

  it('auto: the reason carries the auto-tune measurement (a very slow device → fast tier; a fast device → 3-D kept)', () => {
    let now = 0;
    const slow = new Simulation(syntheticScenario({ extent: 2400, options: { tier: 'auto' } }), { clock: () => (now += 1000) });
    expect(slow.snapshot().engine!.tierCause).toBe('auto-pending');
    expect(slow.spinUp()).toBe(true);
    const es = slow.snapshot().engine!;
    expect(es.tier).toBe('fast');
    expect(es.tierCause).toBe('auto-tune');
    expect(es.autoTune).toMatchObject({ chosen: 'fast', steps: SIM_PARAMS.autoTuneSteps, warmupSteps: SIM_PARAMS.autoTuneWarmupSteps, stepMs: 1000, warmupMeanMs: 1000 });
    expect(es.autoTune!.predictedS).toBeGreaterThan(es.autoTune!.budgetS);
    expect(es.tierReason).toMatch(/^Fast surface-wind model: the detailed 3-D air would take about \d+\smin to compute this run on this phone \(about 1000\sms per air step\), longer than the limit of about \d+\smin for a run this long\. Switch in Settings, Performance, or Layers, Use the 3-D atmosphere\.$/);
    expect(es.perf!.events.map((e) => [e.kind, e.simS])).toEqual([['tier', 0]]);
    expect(es.perf!.events[0]!.text).toMatch(/^Auto chose the fast model: the 3-D air would take about/);
    expect(es.perf!.quality.spinUpWallS).toBeCloseTo(SIM_PARAMS.autoTuneSteps, 0); // the timing steps cost 1 s each on this clock
    expect(es.perf!.reruns.tierSwitches).toBe(0); // the choice at the start is not a switch
    const quick = new Simulation(syntheticScenario({ extent: 2400, duration: 3600, options: { tier: 'auto' } }), { clock: () => 0 });
    expect(quick.spinUp()).toBe(true);
    const eq = quick.snapshot().engine!;
    expect(eq.tier).toBe('standard');
    expect(eq.tierCause).toBe('auto-tune');
    expect(eq.tierReason).toMatch(/^Detailed 3-D air: this phone takes about 0\.0\sms per air step, so this run should compute in about 0\ss\. It can fall behind when you play faster than that; the timeline will say so\.$/);
    expect(eq.autoTune).toMatchObject({ chosen: 'standard', stepMs: 0, warmupMeanMs: 0 });
  }, 240000);
});

/**
 * A clock that moves by `tick` ms on every read: a step measured by two consecutive reads (as the spin-up does) takes
 * exactly `tick`. The test sets `tick` before each step to say how long that step took on "this phone".
 */
function tickClock(): { clock: () => number; tick: { ms: number } } {
  let now = 0;
  const tick = { ms: 0 };
  return { clock: () => (now += tick.ms), tick };
}

describe('Auto policy (plan §6.2): detailed unless hopeless, decided once at the start', () => {
  const scenario = syntheticScenario({ extent: 2400, options: { tier: 'auto' } }); // a 4 h run: 1440 steps of 10 s, budget 400 s

  /** Run the spin-up one step at a time, step i taking `costMs(i)`; returns the engine info once ready. */
  function timed(costMs: (i: number) => number, sc = scenario): { sim: Simulation; engine: EngineInfo; tc: ReturnType<typeof tickClock> } {
    const tc = tickClock();
    const sim = new Simulation(sc, { clock: tc.clock });
    for (let i = 0; !sim.isReady && i < 200; i++) {
      tc.tick.ms = costMs(i);
      sim.spinUp(-1); // a deadline in the past: exactly one step per call
    }
    expect(sim.isReady).toBe(true);
    tc.tick.ms = 0;
    return { sim, engine: sim.snapshot().engine!, tc };
  }

  it('skips the warm-up: a slow first ten steps and a fast rest give the detailed 3-D air, with both numbers reported', () => {
    const { engine } = timed((i) => (i < SIM_PARAMS.autoTuneWarmupSteps ? 800 : 5));
    expect(engine.tier).toBe('standard');
    expect(engine.autoTune).toMatchObject({ chosen: 'standard', stepMs: 5, warmupMeanMs: 800, steps: 30, warmupSteps: 10 });
    expect(engine.autoTune!.predictedS).toBeCloseTo((1.4 * 5 * (scenario.duration / 10)) / 1000, 9);
    // The 0.2.x reading (the mean of the first 20 steps, warm-up included) would have called this phone too slow:
    // (10 x 800 + 10 x 5) / 20 = 402 ms → 810 s against the old budget of 80 s for this run.
    const oldMean = (10 * 800 + 10 * 5) / 20;
    expect((1.4 * oldMean * (scenario.duration / 10)) / 1000).toBeGreaterThan((120 * scenario.duration) / 21600);
    expect(engine.tierReason).toMatch(/^Detailed 3-D air: this phone takes about 5\.0\sms per air step/);
  }, 240000);

  it('the median resists one outlier (a garbage collection, another app): the mean would have flipped the choice', () => {
    const { engine } = timed((i) => (i === 17 ? 5000 : 40));
    expect(engine.autoTune).toMatchObject({ chosen: 'standard', stepMs: 40 });
    const mean = (29 * 40 + 5000) / 30; // 206.7 ms
    expect((1.4 * mean * (scenario.duration / 10)) / 1000).toBeGreaterThan(engine.autoTune!.budgetS);
  }, 240000);

  it('a phone that is slow at every step gets the fast model, and says by how much', () => {
    const { engine } = timed(() => 300);
    expect(engine.tier).toBe('fast');
    expect(engine.autoTune).toMatchObject({ chosen: 'fast', stepMs: 300 });
    expect(engine.autoTune!.predictedS).toBeCloseTo((1.4 * 300 * 1440) / 1000, 6);
    expect(engine.autoTune!.budgetS).toBeCloseTo(400, 6);
    expect(engine.tierReason).toContain('longer than the limit of about 7 min');
  }, 240000);

  it('the tier never changes after the start decision, even when the clock turns very slow mid-run', () => {
    const { sim, tc } = timed(() => 20);
    expect(sim.tier).toBe('standard');
    const seen = new Set<string>();
    for (let t = 60; t <= 600; t += 60) {
      tc.tick.ms = t < 300 ? 1 : 30_000; // from five minutes on every clock read costs 30 s
      sim.advance(t);
      const e = sim.snapshot().engine!;
      seen.add(`${sim.tier}|${e.tier}|${e.tierCause}|${e.autoTune!.chosen}|${e.tierChangedAt}`);
    }
    expect([...seen]).toEqual(['standard|standard|auto-tune|standard|null']);
    const p = sim.snapshot().engine!.perf!;
    expect(p.step.over250).toBeGreaterThan(0); // the statistics saw the slow clock ...
    expect(p.reruns.tierSwitches).toBe(0); // ... and nothing reacted to it
    expect(sim.perf().tier).toBe('standard');
  }, 240000);

  it('and a run that started fast stays fast when the clock then turns very quick', () => {
    const { sim, tc } = timed(() => 500);
    expect(sim.tier).toBe('fast');
    tc.tick.ms = 0;
    sim.advance(900);
    expect(sim.snapshot().engine).toMatchObject({ tier: 'fast', tierCause: 'auto-tune' });
  }, 240000);

  describe('the decision (pure)', () => {
    const steps = (ms: number): number[] => Array.from({ length: 30 }, () => ms);
    const SIX_H = 6 * 3600;

    it('the ceiling arithmetic of the table in the plan: predicted = 1.4 x step x (duration / 10 s), budget 600 s for 6 h', () => {
      const rows: [number, number, 'standard' | 'fast'][] = [
        [17.5, 52.9, 'standard'], // this build machine
        [41.1, 124.3, 'standard'], // the one phone measured so far
        [80, 241.9, 'standard'],
        [150, 453.6, 'standard'],
        [198, 598.8, 'standard'], // the cut-off, about 198.4 ms
        [300, 907.2, 'fast'],
      ];
      for (const [ms, predicted, chosen] of rows) {
        const d = autoTuneDecision(steps(ms), SIX_H);
        expect(d.predictedS, `${ms} ms`).toBeCloseTo(predicted, 1);
        expect(d.predictedS).toBeCloseTo(3.024 * ms, 6);
        expect(d.budgetS).toBe(600);
        expect(d.chosen, `${ms} ms`).toBe(chosen);
        expect(d.stepMs).toBe(ms);
        expect(d.warmupMeanMs).toBeCloseTo(ms, 9);
      }
      const cut = 600 / 3.024; // 198.41 ms
      expect(autoTuneDecision(steps(cut - 0.01), SIX_H).chosen).toBe('standard');
      expect(autoTuneDecision(steps(cut), SIX_H).chosen).toBe('standard'); // predicted <= budget keeps the 3-D air
      expect(autoTuneDecision(steps(cut + 0.01), SIX_H).chosen).toBe('fast');
    });

    it('the budget scales with the run length and is never under a minute', () => {
      expect(autoTuneDecision(steps(1), 3600).budgetS).toBe(100);
      expect(autoTuneDecision(steps(1), 12 * 3600).budgetS).toBe(1200);
      expect(autoTuneDecision(steps(1), 1800).budgetS).toBe(60); // 50 s would be under the floor
      // The same cut-off per step for 1 h and 12 h; a half-hour run, held up by the floor, allows 238 ms.
      for (const h of [1, 12]) expect(autoTuneDecision(steps(198.4), h * 3600).chosen).toBe('standard');
      for (const h of [1, 12]) expect(autoTuneDecision(steps(198.5), h * 3600).chosen).toBe('fast');
      expect(autoTuneDecision(steps(238), 1800).chosen).toBe('standard');
      expect(autoTuneDecision(steps(239), 1800).chosen).toBe('fast');
    });

    it('uses the median of the steps after the warm-up, and the mean of the warm-up is only reported', () => {
      const times = [...Array.from({ length: 10 }, (_, i) => 100 + i * 10), ...Array.from({ length: 20 }, (_, i) => 30 + (i % 2 ? 2 : 0))];
      const d = autoTuneDecision(times, SIX_H);
      expect(d.stepMs).toBe(31); // 10 values of 30 and 10 of 32: the middle two are 30 and 32
      expect(d.warmupMeanMs).toBe(145);
      expect(autoTuneDecision([], SIX_H)).toMatchObject({ stepMs: 0, warmupMeanMs: null, chosen: 'standard' });
      expect(autoTuneDecision([7], SIX_H)).toMatchObject({ stepMs: 7, warmupMeanMs: null }); // too few steps to skip any
    });

    it('computing times read as plain words', () => {
      expect(formatWallDuration(53.4)).toBe('53 s');
      expect(formatWallDuration(124.3)).toBe('2 min');
      expect(formatWallDuration(599)).toBe('10 min');
      expect(formatWallDuration(3900)).toBe('1 h 5 min');
      expect(formatWallDuration(Number.NaN)).toBe('?');
      expect(autoTuneEventText(autoTuneDecision(steps(41.1), SIX_H))).toBe('Auto kept the detailed 3-D air: about 41 ms per air step.');
      expect(autoTuneEventText(autoTuneDecision(steps(300), SIX_H))).toBe('Auto chose the fast model: the 3-D air would take about 15 min, over the limit of 10 min.');
    });

    it('the reason sentences carry the measured numbers and no jargon', () => {
      const reason = (ms: number, durationS = SIX_H): string => {
        const d = autoTuneDecision(steps(ms), durationS);
        return tierReasonText({ tier: d.chosen, cause: 'auto-tune', autoTune: { ...d, steps: 30, warmupSteps: 10 }, changedAt: null, durationS });
      };
      expect(reason(41.1)).toBe(
        'Detailed 3-D air: this phone takes about 41 ms per air step, so this run should compute in about 2 min (about 174 times real time). It can fall behind when you play faster than that; the timeline will say so.',
      );
      expect(reason(300)).toBe(
        'Fast surface-wind model: the detailed 3-D air would take about 15 min to compute this run on this phone (about 300 ms per air step), longer than the limit of 10 min for a run this long. Switch in Settings, Performance, or Layers, Use the 3-D atmosphere.',
      );
      for (const text of [reason(41.1), reason(300), reason(5, 3600)]) {
        expect(text).not.toMatch(/—|–|undefined|NaN|null/); // no em or en dash, no leaked values
        expect(text).not.toMatch(/\btier\b|\bauto-tune\b/i);
      }
    });
  });
});

describe('engine info helpers', () => {
  it('names the model of every family as the kernel dispatches it', () => {
    expect(spreadModelName('vesta2', 'refit2024')).toBe('Vesta Mk2');
    expect(spreadModelName('heath', 'refit2024')).toMatch(/2024 refit/);
    expect(spreadModelName('heath', 'v1')).toMatch(/v1\.0/);
    const type = new Uint8Array([FuelType.Heath, FuelType.Heath, FuelType.Grassland, FuelType.NonFuel, FuelType.Water, FuelType.PinePlantation]);
    const use = spreadModelUse({ type }, 'refit2024');
    expect(use.map((u) => [u.family, u.cells])).toEqual([
      ['heath', 2],
      ['grass', 1],
      ['pine', 1],
    ]);
    expect(use.reduce((a, u) => a + u.share, 0)).toBeCloseTo(1, 12);
  });

  it('stamp spacing and tier sentences', () => {
    const t0 = Date.UTC(2025, 0, 1);
    const hours = [0, 600, 1200, 1800, 5400].map((s) => ({ time: t0 + s * 1000, temperature: 20, relativeHumidity: 50, windSpeed10: 3, windDir10: 0 }));
    expect(medianStampS({ hours })).toBe(600);
    const reason = (cause: EngineInfo['tierCause']): string => tierReasonText({ tier: 'standard', cause, autoTune: null, changedAt: 5400, durationS: 21600 });
    expect(reason('changed')).toMatch(/1\sh\s30\smin/);
    expect(reason('requested')).toMatch(/standard 3-D/);
    expect(reason('auto-pending')).toMatch(/being timed/);
  });
});
