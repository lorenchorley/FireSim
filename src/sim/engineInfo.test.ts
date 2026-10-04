/**
 * Engine info (SimSnapshot.engine, core/simTypes.ts EngineInfo): every field equals the value of the module that owns
 * it, in both kinds of tier, after a tier switch mid-run and after a rewind; the spread models follow the fuel map; the
 * memory is measured at most every 30 wall-seconds; the physics hashes ignore it.
 */
import { describe, expect, it } from 'vitest';
import { FuelType, type EngineInfo, type FuelEdit, type SimSnapshot } from '../core/types';
import { ATMOS_PARAMS, ATMOS_TIERS } from '../atmosphere';
import { EMBER_CLASSES, EMBER_PARAMS } from '../embers';
import { SPREAD_PARAMS } from '../fire/spread/params';
import { Simulation } from './simulation';
import { SIM_PARAMS } from './params';
import { FAST_TIER_STEP_S, medianStampS, spreadModelName, spreadModelUse, tierReasonText } from './engineInfo';
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

function collect(): { snaps: Map<number, SimSnapshot>; hooks: { snapshot: (s: SimSnapshot) => void } } {
  const snaps = new Map<number, SimSnapshot>();
  return { snaps, hooks: { snapshot: (s) => snaps.set(s.time, s) } };
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
    // Small and structured-clone friendly.
    expect(structuredClone(e)).toEqual(e);
    expect(JSON.stringify(e).length).toBeLessThan(2500);
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

  it('auto: the reason carries the auto-tune measurement (slow device → fast tier; fast device → 3-D kept)', () => {
    let now = 0;
    const slow = new Simulation(syntheticScenario({ extent: 2400, options: { tier: 'auto' } }), { clock: () => (now += 1000) });
    expect(slow.snapshot().engine!.tierCause).toBe('auto-pending');
    expect(slow.spinUp()).toBe(true);
    const es = slow.snapshot().engine!;
    expect(es.tier).toBe('fast');
    expect(es.tierCause).toBe('auto-tune');
    expect(es.autoTune).toMatchObject({ chosen: 'fast', steps: SIM_PARAMS.autoTuneSteps });
    expect(es.autoTune!.predictedS).toBeGreaterThan(es.autoTune!.budgetS);
    expect(es.tierReason).toMatch(/too slow, so the fast tier/);
    const quick = new Simulation(syntheticScenario({ extent: 2400, duration: 3600, options: { tier: 'auto' } }), { clock: () => 0 });
    expect(quick.spinUp()).toBe(true);
    const eq = quick.snapshot().engine!;
    expect(eq.tier).toBe('standard');
    expect(eq.tierCause).toBe('auto-tune');
    expect(eq.tierReason).toMatch(/standard 3-D atmosphere was kept/);
  }, 240000);
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
