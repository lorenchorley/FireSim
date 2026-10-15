/**
 * The working-memory model against the REAL allocated arrays of small headless runs (Simulation.memoryReport walks
 * every typed array the engine holds), for each tier; plus the atmosphere grid, checkpoints and the live reading.
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { formatBytes, typedArrayFootprint } from '../core/datasets';
import { atmosCellSize } from '../atmosphere/grid';
import { Simulation } from '../sim/simulation';
import { keyframeBytes } from '../ui/snapshotStore';
import { pointIgnition, syntheticScenario } from '../sim/testing/scenarios';
import { CLIFF_BYTES, atmosphereGrid, checkpointCount, keyframeBytesModel, liveMemory, scenarioArrayBytes, workingMemory, workingMemoryForScenario } from './memoryModel';

const PARTS = ['fire', 'explain', 'moisture', 'fuel', 'rasters', 'atmosphere', 'embers'] as const;

describe('atmosphere grid and checkpoints', () => {
  it('matches atmosphere/grid.ts for every tier and extent', () => {
    for (const tier of ['fast', 'standard', 'high'] as const) {
      for (const ext of [2000, 3000, 4500, 6000, 9000, 12000]) {
        const g = atmosphereGrid(ext, tier);
        expect(g.cellM).toBeCloseTo(atmosCellSize(ext, tier), 9);
        const spec = makeGridSpec({ lat: -33.7, lon: 150.3 }, ext, atmosCellSize(ext, tier));
        expect([g.nx, g.ny]).toEqual([spec.nx, spec.ny]);
        expect(g.nz).toBe(tier === 'high' ? 24 : 20);
      }
    }
  });

  it('checkpoints: t0 plus one per 30 min, at most the ring of 8', () => {
    expect(checkpointCount(0)).toBe(1);
    expect(checkpointCount(1799)).toBe(1);
    expect(checkpointCount(4 * 3600)).toBe(9);
    expect(checkpointCount(12 * 3600)).toBe(9);
  });
});

describe('model vs the real allocated arrays', () => {
  for (const tier of ['fast', 'standard', 'high'] as const) {
    it(`${tier} tier, 2.4 km at 20 m (14 400 cells), after 30 min`, { timeout: 120_000 }, () => {
      const scenario = syntheticScenario({ extent: 2400, cellSize: 20, ignitions: [pointIgnition('a', -300, 0, 0, 60)], options: { tier, snapshotInterval: 300, maxEmbers: 1500 } });
      const sim = new Simulation(scenario, {});
      sim.advance(1800);
      const real = sim.memoryReport();
      expect(real.tier).toBe(tier);
      const g = scenario.terrain.grid;
      const wm = workingMemory({ tier, fireNx: g.nx, fireNy: g.ny, extentM: scenario.extent, maxEmbers: 1500, durationS: 1800, scenarioBytes: scenarioArrayBytes(scenario) });
      const item = (id: string): number => wm.items.find((x) => x.id === id)!.bytes;
      expect(real.parts.scenario).toBe(item('scenario-worker'));
      for (const p of PARTS) {
        const got = real.parts[p];
        const want = item(p);
        expect(Math.abs(want - got) / got, `${p}: model ${want} vs measured ${got}`).toBeLessThan(0.08);
      }
      // Checkpoints: t0 + one ring checkpoint; the ring one carries the young fire's sparse state.
      expect(real.checkpoints).toBe(2);
      expect(Math.abs(item('checkpoints') - real.parts.checkpoints) / real.parts.checkpoints).toBeLessThan(0.3);
      // The worker total (scenario copy + engine) within 5 %.
      const workerModel = wm.items.filter((x) => x.where === 'worker').reduce((a, x) => a + x.bytes, 0);
      expect(Math.abs(workerModel - real.totalBytes) / real.totalBytes).toBeLessThan(0.05);
      // The history's keyframe (moisture, overlay rasters and the air view the snapshot carries) against the model: the fast tier's
      // diagnosed volume holds u, v and w only, the 3-D tiers five fields per level.
      const snap = sim.snapshot();
      const atm = atmosphereGrid(scenario.extent, tier);
      const kfReal = keyframeBytes(snap);
      const kfModel = keyframeBytesModel(tier, g.nx * g.ny, atm.columns, atm.nz);
      expect(Math.abs(kfModel - kfReal) / kfReal, `keyframe: model ${kfModel} vs measured ${kfReal}`).toBeLessThan(0.03);
      expect(snap.atmosphere!.nz).toBe(atm.nz);
      // A measured checkpoint figure replaces the model.
      const wm2 = workingMemory({ tier, fireNx: g.nx, fireNy: g.ny, extentM: scenario.extent, durationS: 1800, measured: { checkpointBytes: real.checkpointBytes } });
      expect(wm2.items.find((x) => x.id === 'checkpoints')!.bytes).toBe(real.checkpointBytes);
    });
  }
});

describe('workingMemory text and totals', () => {
  it('adds up, uses the scenario measurement, and never prints NaN or undefined', () => {
    const scenario = syntheticScenario({ extent: 3000, cellSize: 30, options: { tier: 'auto' } });
    const wm = workingMemoryForScenario(scenario, { imagery: { width: 1125, height: 1125 }, snapshotBudgetBytes: 96 * 1024 * 1024 });
    expect(wm.tier).toBe('standard'); // 'auto' is modelled as Standard
    expect(wm.notes[0]).toMatch(/^Auto tier: shown for Standard, the usual result; on a phone far too slow for the 3-D air, Auto picks Fast at the start/);
    expect(wm.cells).toBe(100 * 100);
    expect(wm.totalBytes).toBe(wm.mainBytes + wm.workerBytes + wm.gpuBytes);
    expect(wm.items.find((x) => x.id === 'scenario-main')!.bytes).toBe(typedArrayFootprint(scenario).bytes);
    expect(wm.items.find((x) => x.id === 'snapshots')!.bytes).toBeLessThanOrEqual(96 * 1024 * 1024);
    expect(wm.items.some((x) => x.id === 'gpu-imagery')).toBe(true);
    for (const x of wm.items) {
      expect(Number.isFinite(x.bytes) && x.bytes >= 0).toBe(true);
      expect(`${x.label} ${x.formula} ${x.note ?? ''}`).not.toMatch(/NaN|undefined|Infinity/);
    }
    // Fast tier holds less than High for the same grid.
    const f = workingMemoryForScenario(scenario, { tier: 'fast' });
    const hgh = workingMemoryForScenario(scenario, { tier: 'high' });
    expect(f.workerBytes).toBeLessThan(hgh.workerBytes);
    // The engine's own tier is the one to model once it has reported: the fast tier is not described as the 3-D atmosphere, and
    // holds less than 'auto' (which is modelled as Standard) for the same scenario.
    const std = workingMemoryForScenario(scenario, { tier: 'auto' });
    expect(f.tier).toBe('fast');
    expect(f.items.find((x) => x.id === 'atmosphere')!.label).toMatch(/fast mode/);
    expect(f.items.find((x) => x.id === 'atmosphere')!.label).not.toMatch(/3-D/);
    expect(std.items.find((x) => x.id === 'atmosphere')!.label).toMatch(/3-D/);
    expect(f.workerBytes).toBeLessThan(std.workerBytes);
    expect(f.notes.join(' ')).not.toMatch(/Auto tier/);
  });

  it('a long run keeps the scrubber history under the budget', () => {
    const wm = workingMemory({ tier: 'standard', fireNx: 300, fireNy: 300, extentM: 9000, durationS: 12 * 3600, snapshotIntervalS: 10, snapshotBudgetBytes: 64e6 });
    expect(wm.items.find((x) => x.id === 'snapshots')!.bytes).toBe(64e6);
    expect(wm.items.find((x) => x.id === 'checkpoints')!.formula).toMatch(/9 x/);
  });
});

describe('the cliff drawing rows (plan 9d.3, section 11)', () => {
  const base = { tier: 'standard' as const, fireNx: 300, fireNy: 300, extentM: 9000, durationS: 3600 };
  const item = (wm: ReturnType<typeof workingMemory>, id: string) => wm.items.find((x) => x.id === id);

  it('a 9 km area with a 10 m terrain: a 0.8 MB rock copy and the copies of the textures on the screen thread, two 3.2 MB textures and the 0.64 MB mesh slope on the graphics side', () => {
    const wm = workingMemory({ ...base, hiResNx: 900, hiResNy: 900, renderQuality: 'high' });
    // The screen thread also keeps the array each texture and the slope attribute were made from (Three.js holds them for a lost
    // graphics context): 2 x 3.24 MB + 0.64 MB. Verifier measurement on the real view, High, Katoomba: uGrad and uRock `image.data`
    // 3.09 MiB each, `aSlope` 0.61 MiB, and 7.2 MB more array memory in the page than the same view without the cliff drawing.
    const kept = 810_000 + 900 * 900 * 8 + 400 * 400 * 4;
    expect(kept).toBe(7_930_000);
    expect(item(wm, 'cliff-main')).toMatchObject({ where: 'main', bytes: kept });
    expect(item(wm, 'gpu-cliff-light')).toMatchObject({ where: 'gpu', bytes: 900 * 900 * 4 + 400 * 400 * 4 });
    expect(item(wm, 'gpu-cliff-rock')).toMatchObject({ where: 'gpu', bytes: 900 * 900 * 4 });
    expect(item(wm, 'gpu-cliff-light')!.bytes - 900 * 900 * 4).toBe(640_000); // the mesh gradient of the plan (S5)
    // the extra held while the scenario is set up is said on the main item, and the totals include the new rows
    expect(item(wm, 'cliff-main')!.note).toContain(`While the scenario is set up about ${formatBytes(16 * 810_000)} more is held`);
    expect(wm.totalBytes).toBe(wm.mainBytes + wm.workerBytes + wm.gpuBytes);
    const without = workingMemory({ ...base, renderQuality: 'high' });
    expect(wm.mainBytes - without.mainBytes).toBe(kept + (wm.items.find((x) => x.id === 'scenario-main')!.bytes - without.items.find((x) => x.id === 'scenario-main')!.bytes));
    expect(wm.gpuBytes - without.gpuBytes).toBe(900 * 900 * 8 + 400 * 400 * 4);
  });

  it('the mesh slope follows the picture-quality tier, and a mesh never has more samples than the terrain', () => {
    const low = workingMemory({ ...base, hiResNx: 900, hiResNy: 900, renderQuality: 'low' });
    expect(item(low, 'gpu-cliff-light')!.bytes).toBe(900 * 900 * CLIFF_BYTES.gradientPerCell + 224 * 224 * CLIFF_BYTES.meshSlopePerVertex);
    const small = workingMemory({ ...base, hiResNx: 150, hiResNy: 150, renderQuality: 'high' });
    expect(item(small, 'gpu-cliff-light')!.bytes).toBe(150 * 150 * 4 + 150 * 150 * 4);
  });

  it('a scenario without a 10 m terrain (synthetic ground) has no cliff rows: nothing is sharpened', () => {
    const wm = workingMemory({ ...base, renderQuality: 'high' });
    expect(wm.items.filter((x) => x.id.includes('cliff'))).toEqual([]);
  });

  it('is built from the scenario that has a 10 m terrain, and never prints NaN', () => {
    const scenario = syntheticScenario({ extent: 3000, cellSize: 30, options: { tier: 'auto' } });
    const g = scenario.terrain.grid;
    const withHi = { ...scenario, terrainHiRes: { grid: { ...g, nx: 300, ny: 300, cellSize: 10 }, elevation: new Float32Array(300 * 300) } };
    const wm = workingMemoryForScenario(withHi, { renderQuality: 'medium' });
    expect(item(wm, 'cliff-main')!.bytes).toBe(300 * 300 * (1 + 8) + 300 * 300 * 4); // a 300 x 300 mesh: the terrain is not decimated
    expect(item(wm, 'gpu-cliff-rock')!.bytes).toBe(300 * 300 * 4);
    for (const x of wm.items.filter((y) => y.id.includes('cliff'))) expect(`${x.label} ${x.formula} ${x.note ?? ''}`).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('liveMemory', () => {
  it('reads performance.memory when present', () => {
    const r = liveMemory({ memory: { usedJSHeapSize: 52e6, totalJSHeapSize: 80e6, jsHeapSizeLimit: 2e9 } }, 1000);
    expect(r).toMatchObject({ available: true, usedJSHeapBytes: 52e6, totalJSHeapBytes: 80e6, limitBytes: 2e9, measuredAt: 1000 });
    expect(r.note).toMatch(/screen thread only/);
  });
  it('says plainly when the device does not tell, and never throws', () => {
    expect(liveMemory({})).toMatchObject({ available: false });
    expect(liveMemory(undefined).note).toMatch(/Not available on this device/);
    const hostile = {
      get memory(): never {
        throw new Error('no');
      },
    };
    expect(liveMemory(hostile).available).toBe(false);
  });
});
