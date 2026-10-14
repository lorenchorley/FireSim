/**
 * The working-memory estimate and the picture quality tier (plan 9c.3): the GPU rows (ground mesh, trees) follow the tier the
 * Data sets screen passes, and the build-time estimate (build.ts, stored in the scenario data) keeps the medium default, so a
 * device setting never enters the scenario data.
 */
import { describe, expect, it } from 'vitest';
import { describeQuality } from '../render/SceneView';
import { syntheticScenario } from '../sim/testing/scenarios';
import { RENDER_MESH_N, RENDER_TREE_INSTANCES, workingMemoryForScenario } from './memoryModel';

describe('workingMemoryForScenario with a render quality', () => {
  const scenario = syntheticScenario({ extent: 3000, cellSize: 30, options: { tier: 'standard' } });
  const gpu = (q?: 'low' | 'medium' | 'high') => workingMemoryForScenario(scenario, q ? { renderQuality: q } : {});
  const row = (q: 'low' | 'medium' | 'high', id: string) => gpu(q).items.find((x) => x.id === id)!;

  it('shows what High costs: the ground mesh and the trees grow with the tier, nothing else changes', () => {
    const [lo, md, hi] = [gpu('low'), gpu('medium'), gpu('high')];
    expect(lo.gpuBytes).toBeLessThan(md.gpuBytes);
    expect(md.gpuBytes).toBeLessThan(hi.gpuBytes);
    expect([lo.mainBytes, md.mainBytes, hi.mainBytes]).toEqual([md.mainBytes, md.mainBytes, md.mainBytes]);
    expect([lo.workerBytes, md.workerBytes, hi.workerBytes]).toEqual([md.workerBytes, md.workerBytes, md.workerBytes]);
    expect(row('high', 'gpu-trees').formula).toContain('48,000');
    expect(row('low', 'gpu-trees').formula).toContain('16,000');
    expect(row('high', 'gpu-terrain').formula).toContain('400 x 400');
    expect(row('low', 'gpu-terrain').formula).toContain('224 x 224');
  });

  it('keeps the medium default without one (the build-time estimate must not depend on the device)', () => {
    expect(gpu().totalBytes).toBe(gpu('medium').totalBytes);
    expect(gpu().items.map((x) => x.bytes)).toEqual(gpu('medium').items.map((x) => x.bytes));
  });

  it("uses the same tier numbers as the 3-D view's table (plan 9c.2)", () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const info = describeQuality({ quality: tier }, { cores: null, memoryGb: null }, tier);
      expect(RENDER_MESH_N[tier], tier).toBe(info.terrainSamples);
      expect(RENDER_TREE_INSTANCES[tier], tier).toBe(info.treeBudget);
    }
  });
});
