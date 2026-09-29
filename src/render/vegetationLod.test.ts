import { describe, expect, it } from 'vitest';
import { modelTriangles } from './treeModels';
import { capByKey, planLod, type LodParams, type LodPlan } from './vegetationLod';
import { INSTANCE_BYTES, VegGroup, type VegInstances } from './vegetationPlacement';

/** A set of instances at the given points (x, y), all `h` m tall on ground z. */
function set(group: VegGroup, pts: [number, number][], h = 24, z = 100): VegInstances {
  const n = pts.length;
  const position = new Float32Array(n * 3);
  const size = new Float32Array(n * 2);
  pts.forEach(([x, y], i) => {
    position.set([x, y, z], i * 3);
    size.set([h, h * 0.45], i * 2);
  });
  return { group, count: n, position, size, rand: new Float32Array(n * 2).fill(0.5), tint: new Uint8Array(n * INSTANCE_BYTES).fill(100), info: new Uint8Array(n * INSTANCE_BYTES).fill(50), aux: new Uint8Array(n * INSTANCE_BYTES).fill(60) };
}

const ring = (n: number, r0: number, dr: number): [number, number][] => Array.from({ length: n }, (_, i) => [r0 + i * dr, 0] as [number, number]);

const base: LodParams = { cam: [0, 0, 101], vex: 1, pxPerRad: 1000, family: 'natural', maxNear: 220, maxMid: 1200, maxTriangles: 250000, maxInstances: 60000 };

const levelOf = (plan: LodPlan, group: VegGroup, x: number): number | null => {
  for (const s of plan.sets) {
    if (s.group !== group) continue;
    for (let i = 0; i < s.set.count; i++) if (s.set.position[i * 3] === x) return s.lod;
  }
  return null;
};

describe('capByKey', () => {
  it('keeps the smallest keys within the capacity, in candidate order, exactly', () => {
    const key = Float32Array.from([5, 1, 9, 3, 7, 2, 8, 4, 6, 0]);
    const cands = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const [kept, dropped] = capByKey(cands, key, () => 1, 4);
    expect(kept.length).toBe(4);
    expect(new Set(kept)).toEqual(new Set([9, 1, 5, 3])); // keys 0, 1, 2, 3
    expect(new Set([...kept, ...dropped])).toEqual(new Set(cands));
    // Costs, not counts, fill the capacity.
    const [k2] = capByKey(cands, key, (c) => (c === 9 ? 3 : 1), 4);
    expect(k2.reduce((s, c) => s + (c === 9 ? 3 : 1), 0)).toBeLessThanOrEqual(4);
    expect(capByKey(cands, key, () => 1, 0)[0]).toEqual([]);
    expect(capByKey(cands, key, () => 1, 100)[1]).toEqual([]);
  });
});

describe('planLod', () => {
  it('draws the nearest as detailed models, the middle distance simplified and the rest as billboards', () => {
    const trees = set(VegGroup.Stringybark, ring(60, 20, 50)); // 20 … 2970 m away
    const plan = planLod([trees], base);
    expect(levelOf(plan, VegGroup.Stringybark, 20)).toBe(0);
    expect(levelOf(plan, VegGroup.Stringybark, 20 + 8 * 50)).toBe(1); // 420 m ≈ 17.5 × height
    expect(levelOf(plan, VegGroup.Stringybark, 20 + 50 * 50)).toBe(2); // 2520 m
    // Every instance appears once at most.
    expect(plan.instances).toBeLessThanOrEqual(60);
    expect(plan.counts[0] + plan.counts[1] + plan.counts[2]).toBe(plan.instances);
  });

  it('gives the detail to the nearest when a level is full, and demotes the rest', () => {
    const trees = set(VegGroup.SmoothGum, ring(100, 10, 3)); // 10 … 307 m, all within 14 × 24 m = 336 m
    const plan = planLod([trees], { ...base, maxNear: 10, maxMid: 20 });
    expect(plan.counts[0]).toBe(10);
    expect(plan.counts[1]).toBe(20);
    for (let i = 0; i < 10; i++) expect(levelOf(plan, VegGroup.SmoothGum, 10 + i * 3)).toBe(0);
    expect(levelOf(plan, VegGroup.SmoothGum, 10 + 10 * 3)).toBe(1);
    expect(levelOf(plan, VegGroup.SmoothGum, 10 + 40 * 3)).toBe(2);
  });

  it('never exceeds the triangle budget', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 4000; i++) pts.push([30 + (i % 80) * 12, ((i / 80) | 0) * 12]);
    const sets = [set(VegGroup.Stringybark, pts), set(VegGroup.Understorey, pts.slice(0, 800), 2), set(VegGroup.Grass, pts.slice(0, 500), 0.5)];
    for (const budget of [250000, 100000, 20000, 3000]) {
      const plan = planLod(sets, { ...base, maxTriangles: budget, maxNear: 5000, maxMid: 5000 });
      expect(plan.triangles).toBeLessThanOrEqual(budget);
      // The reported total is the real one.
      let t = 0;
      for (const s of plan.sets) t += s.set.count * modelTriangles(s.group, 'natural', s.lod);
      expect(t).toBe(plan.triangles);
    }
  });

  it('drops what would be smaller than a pixel and the groups without a far level, hides hidden groups', () => {
    const far = 6000;
    const plan = planLod(
      [set(VegGroup.Stringybark, [[far, 0]]), set(VegGroup.Understorey, [[far, 0]], 2), set(VegGroup.Grass, [[15, 0]], 0.4), set(VegGroup.Heath, [[300, 0]], 1.5)],
      { ...base, hidden: new Set([VegGroup.Grass]) },
    );
    expect(levelOf(plan, VegGroup.Stringybark, far)).toBe(2);
    expect(levelOf(plan, VegGroup.Understorey, far)).toBeNull(); // 2 m at 6 km is 0.3 px
    expect(levelOf(plan, VegGroup.Grass, 15)).toBeNull(); // hidden
    expect(levelOf(plan, VegGroup.Heath, 300)).toBe(2); // 1.5 m at 300 m ≈ 5 px, beyond 55 × height = 82 m
    // Understorey and grass have no far level: at 200 m an understorey shrub is dropped, at 10 m it is drawn.
    const p2 = planLod([set(VegGroup.Understorey, [[10, 0], [200, 0]], 2)], base);
    expect(levelOf(p2, VegGroup.Understorey, 10)).toBe(0);
    expect(levelOf(p2, VegGroup.Understorey, 200)).toBeNull();
  });

  it('keeps the low plants from using up the trees\' near level', () => {
    const shrubs = set(VegGroup.Understorey, ring(500, 2, 0.05), 2); // 500 shrubs within 27 m
    const trees = set(VegGroup.Stringybark, ring(30, 40, 4));
    const plan = planLod([shrubs, trees], { ...base, maxNear: 30, maxNearSmall: 100 });
    const treesNear = plan.sets.filter((s) => s.group === VegGroup.Stringybark && s.lod === 0).reduce((s, x) => s + x.set.count, 0);
    expect(treesNear).toBe(30);
    const shrubsNear = plan.sets.filter((s) => s.group === VegGroup.Understorey && s.lod === 0).reduce((s, x) => s + x.set.count, 0);
    expect(shrubsNear).toBeLessThanOrEqual(100);
  });

  it('accounts for the vertical exaggeration (a camera high above is far from every tree)', () => {
    const t = set(VegGroup.Stringybark, [[0, 0]], 24, 100);
    expect(levelOf(planLod([t], { ...base, cam: [0, 0, 105] }), VegGroup.Stringybark, 0)).toBe(0);
    expect(levelOf(planLod([t], { ...base, cam: [0, 0, 700] }), VegGroup.Stringybark, 0)).toBe(1); // 600 m ≈ 25 × height
    expect(levelOf(planLod([t], { ...base, cam: [0, 0, 105], vex: 100 }), VegGroup.Stringybark, 0)).not.toBe(0);
  });

  it('is deterministic and uses the family of the style for the triangle counts', () => {
    const t = set(VegGroup.Stringybark, ring(200, 20, 15));
    const a = planLod([t], base);
    const b = planLod([t], base);
    expect(a.counts).toEqual(b.counts);
    expect(a.sets.map((s) => `${s.group}.${s.lod}.${s.set.count}`)).toEqual(b.sets.map((s) => `${s.group}.${s.lod}.${s.set.count}`));
    const flat = planLod([t], { ...base, family: 'flat' });
    expect(flat.triangles).toBeLessThan(a.triangles);
  });
});
