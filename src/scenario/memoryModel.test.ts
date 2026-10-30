/**
 * The working-memory model against the REAL allocated arrays of small headless runs (Simulation.memoryReport walks
 * every typed array the engine holds), for each tier; plus the atmosphere grid, checkpoints and the live reading.
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { formatBytes, typedArrayFootprint } from '../core/datasets';
import { fireWindBytesModel } from '../core/fireWind';
import { atmosCellSize } from '../atmosphere/grid';
import { Simulation } from '../sim/simulation';
import { SnapshotStore, keyframeBytes } from '../ui/snapshotStore';
import { pointIgnition, syntheticScenario } from '../sim/testing/scenarios';
import { readFileSync } from 'node:fs';
import { sliceRecorderBudgetBytes as coreBudget, sliceSampleBytes } from '../core/sliceRecording';
import { CLIFF_BYTES, atmosphereGrid, checkpointCount, keptKeyframeBytesModel, keyframeBytesModel, liveMemory, scenarioArrayBytes, sliceRecorderBudgetBytes, sliceSampleBytesModel, windVolumeBytesModel, workingMemory, workingMemoryForScenario } from './memoryModel';

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
      // The wind the fire feels (0.7.0): the snapshot carries it and the keyframe counts it, exactly what the byte model says.
      const fw = fireWindBytesModel(g.nx, g.ny, g.cellSize);
      expect(snap.fireWind).toBeDefined();
      expect(kfReal - keyframeBytes({ ...snap, fireWind: undefined })).toBe(fw);
      const kfModel = keyframeBytesModel(tier, g.nx * g.ny, atm.columns, atm.nz, fw);
      expect(Math.abs(kfModel - kfReal) / kfReal, `keyframe: model ${kfModel} vs measured ${kfReal}`).toBeLessThan(0.03);
      expect(kfModel - keyframeBytesModel(tier, g.nx * g.ny, atm.columns, atm.nz)).toBe(fw);
      expect(snap.atmosphere!.nz).toBe(atm.nz);
      // The keyframe as the history keeps it (a store that has demoted the snapshot): the fast tier's wind volume is packed, 6 B per cell
      // and level, in a list beside the keyframes; the 3-D tiers keep their air whole.
      const store = new SnapshotStore({ maxBytes: 1e9 });
      store.push(snap);
      store.push({ ...snap, time: snap.time + 300 });
      expect(store.keyframeCount).toBe(1);
      const keptReal = store.keyframeBytes;
      const keptModel = keptKeyframeBytesModel(tier, g.nx * g.ny, atm.columns, atm.nz, fw) + windVolumeBytesModel(tier, atm.columns, atm.nz);
      expect(Math.abs(keptModel - keptReal) / keptReal, `kept keyframe: model ${keptModel} vs measured ${keptReal}`).toBeLessThan(0.03);
      expect(store.windFrameCount).toBe(tier === 'fast' ? 1 : 0);
      if (tier === 'fast') expect(keptReal).toBeLessThan(kfReal - 0.4 * atm.columns * atm.nz * 12); // the volume costs half of what the live one does
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

describe('the Air slices recording (0.4.1): it comes on top of the history and takes nothing from it', () => {
  const MiB = 1048576;
  const run = { tier: 'standard' as const, fireNx: 300, fireNy: 300, extentM: 9000, durationS: 6 * 3600, snapshotIntervalS: 60 };
  const item = (wm: ReturnType<typeof workingMemory>, id: string) => wm.items.find((x) => x.id === id)!;

  it('exports the budget and the bytes of a sample of a line: 48,696 at 90 x 54 on the 3-D tiers, 29,256 on the fast tier', () => {
    expect(sliceRecorderBudgetBytes).toBe(coreBudget);
    expect(sliceRecorderBudgetBytes(48 * MiB)).toBe(6 * MiB);
    expect(sliceRecorderBudgetBytes(61.44 * MiB) / MiB).toBeCloseTo(7.68, 2);
    expect(sliceRecorderBudgetBytes(96 * MiB)).toBe(12 * MiB);
    expect(sliceRecorderBudgetBytes(160 * MiB)).toBe(12 * MiB);
    expect(sliceSampleBytesModel(90, 54, 'standard')).toBe(48696);
    expect(sliceSampleBytesModel(90, 54, 'high')).toBe(48696);
    expect(sliceSampleBytesModel(90, 54, 'fast')).toBe(29256);
    expect(sliceSampleBytesModel(192, 56, 'fast')).toBe(sliceSampleBytes(192 * 56, 'diagnosed'));
    expect(sliceSampleBytesModel(192, 56, 'standard')).toBe(107616);
  });

  it('appends ONE note and does not touch the first: the Auto note stays at [0], the new one is last and says how much (an eighth, at most 12 MiB)', () => {
    const auto = workingMemory({ ...run, tier: 'auto', snapshotBudgetBytes: 48 * MiB });
    expect(auto.notes[0]).toMatch(/^Auto tier: shown for Standard/);
    const note = auto.notes[auto.notes.length - 1]!;
    expect(note).toBe('An Air slices recording adds up to 6.3 MB while a line is recorded; it is not in the figures above.');
    expect(auto.notes.filter((n) => /Air slices recording/.test(n))).toHaveLength(1);
    const fixed = workingMemory({ ...run, snapshotBudgetBytes: 48 * MiB });
    expect(fixed.notes[0]).not.toMatch(/Air slices recording/); // the pinned first note of a fixed tier is still the scenario note
    expect(fixed.notes[0]).toMatch(/^Every figure is modelled|^The scenario data/);
    expect(workingMemory({ ...run, snapshotBudgetBytes: 61.44 * MiB }).notes.pop()).toContain('8.1 MB');
    expect(workingMemory({ ...run, snapshotBudgetBytes: 122.88 * MiB }).notes.pop()).toContain('12.6 MB');
    expect(workingMemory({ ...run }).notes.pop()).toContain('12.6 MB'); // the 150 MiB default history
  });

  it('the history item and the totals are exactly what they were: the figures of 0.4.0 at budgets of 48, 61.44 and 122.88 MiB', () => {
    // Taken from the model before the recorder existed (a long run, which the budget caps; a short one, which it does not).
    const capped = { fast: [50331648, 64424509, 128849019], standard: [50331648, 64424509, 128849019] } as const;
    // The short run is under every cap, so it is the sum of its parts, and 0.7.0 adds one: each keyframe (7, with the newest picture 8) holds
    // the wind the fire feels, 10,064 B at 100 x 100 cells of 30 m (`fireWindBytesModel`). The figures of 0.4.0 plus that, nothing else.
    const FIRE_WIND = fireWindBytesModel(100, 100, 30);
    expect(FIRE_WIND).toBe(10_064);
    const small = { fast: 3903328 + 8 * FIRE_WIND, standard: 5810880 + 8 * FIRE_WIND } as const;
    for (const tier of ['fast', 'standard'] as const) {
      [48, 61.44, 122.88].forEach((b, k) => {
        const long = workingMemory({ ...run, tier, snapshotBudgetBytes: Math.round(b * MiB) });
        expect(item(long, 'snapshots').bytes, `${tier} 6 h at ${b} MiB`).toBe(capped[tier][k]);
        const short = workingMemory({ tier, fireNx: 100, fireNy: 100, extentM: 3000, durationS: 1800, snapshotIntervalS: 60, snapshotBudgetBytes: Math.round(b * MiB) });
        expect(item(short, 'snapshots').bytes, `${tier} 30 min at ${b} MiB`).toBe(small[tier]);
        // the recording is in no item and no total: the main-thread bytes are the history's and the scenario's, nothing more
        expect(long.items.map((x) => x.id)).not.toContain('slice-recording');
        expect(long.totalBytes).toBe(long.mainBytes + long.workerBytes + long.gpuBytes);
      });
    }
    // The same run under different budgets differs by exactly the history's cap and nothing else.
    const a = workingMemory({ ...run, snapshotBudgetBytes: 48 * MiB });
    const b = workingMemory({ ...run, snapshotBudgetBytes: 122.88 * MiB });
    expect(b.totalBytes - a.totalBytes).toBe(item(b, 'snapshots').bytes - item(a, 'snapshots').bytes);
  });

  it('snapshotStore.ts has no part in it: the store does not know the recorder (no diff, and a source check says so)', () => {
    const src = readFileSync(new URL('../ui/snapshotStore.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/SliceRecord|sliceRecord|SliceTimeLapse|time-lapse|recorder/i);
    // and nothing of the recorder is added to what the store counts
    const wm = workingMemory({ ...run, snapshotBudgetBytes: 48 * MiB });
    expect(item(wm, 'snapshots').formula).not.toMatch(/recording/i);
  });
});
