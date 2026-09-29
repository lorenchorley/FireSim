import { describe, expect, it } from 'vitest';
import { HAS_FAR_LOD, MIN_LOBES, Part, barkKindOfGroup, modelTriangles, treeModel, type Lod, type MeshData, type ModelFamily } from './treeModels';
import { VEG_GROUP_COUNT, VegGroup } from './vegetationPlacement';

const FAMILIES: ModelFamily[] = ['natural', 'flat'];
const LODS: Lod[] = [0, 1, 2];

function bounds(m: MeshData): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) for (let q = 0; q < 3; q++) {
    min[q] = Math.min(min[q]!, m.pos[i + q]!);
    max[q] = Math.max(max[q]!, m.pos[i + q]!);
  }
  return { min, max };
}

describe('tree models', () => {
  it('are well formed: consistent attribute lengths, valid indices, finite numbers, unit normals', () => {
    for (let g = 0; g < VEG_GROUP_COUNT; g++) {
      for (const fam of FAMILIES) {
        for (const lod of LODS) {
          const m = treeModel(g as VegGroup, fam, lod);
          const n = m.pos.length / 3;
          expect(n).toBeGreaterThan(3);
          expect(m.nor.length).toBe(n * 3);
          expect(m.uv.length).toBe(n * 2);
          expect(m.mat.length).toBe(n * 3);
          expect(m.idx.length % 3).toBe(0);
          for (const i of m.idx) expect(i).toBeLessThan(n);
          for (const v of [...m.pos, ...m.nor, ...m.uv, ...m.mat]) expect(Number.isFinite(v)).toBe(true);
          for (let i = 0; i < n; i++) expect(Math.hypot(m.nor[i * 3]!, m.nor[i * 3 + 1]!, m.nor[i * 3 + 2]!)).toBeCloseTo(1, 4);
          // The part code is one of the known parts and ao is a fraction.
          for (let i = 0; i < n; i++) {
            expect(Object.values(Part)).toContain(m.mat[i * 3]);
            expect(m.mat[i * 3 + 1]).toBeGreaterThanOrEqual(0);
            expect(m.mat[i * 3 + 1]).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('respect the triangle budgets: near ≤ 500, mid ≤ 130, far = 2 (one billboard)', () => {
    for (let g = 0; g < VEG_GROUP_COUNT; g++) {
      for (const fam of FAMILIES) {
        expect(modelTriangles(g as VegGroup, fam, 2)).toBe(2);
        expect(modelTriangles(g as VegGroup, fam, 0)).toBeLessThanOrEqual(500);
        expect(modelTriangles(g as VegGroup, fam, 1)).toBeLessThanOrEqual(130);
        expect(modelTriangles(g as VegGroup, fam, 0)).toBeGreaterThanOrEqual(modelTriangles(g as VegGroup, fam, 1));
      }
    }
    // The species trees are the detailed ones (the brief: ~300–500 near, ~60 mid).
    for (const g of [VegGroup.Stringybark, VegGroup.Ribbonbark, VegGroup.SmoothGum, VegGroup.Rainforest, VegGroup.TallWetGum, VegGroup.SnowGum]) {
      expect(modelTriangles(g, 'natural', 0)).toBeGreaterThan(150);
      expect(modelTriangles(g, 'natural', 1)).toBeLessThanOrEqual(130);
    }
    // Simple styles are cheaper than the natural ones.
    for (const g of [VegGroup.Stringybark, VegGroup.Conifer, VegGroup.Heath]) expect(modelTriangles(g, 'flat', 0)).toBeLessThan(modelTriangles(g, 'natural', 0));
  });

  it('stand on the ground in unit space (crown ≤ ~1.4 wide, height ≤ 1.05), billboards face +z', () => {
    for (let g = 0; g < VEG_GROUP_COUNT; g++) {
      for (const fam of FAMILIES) {
        for (const lod of [0, 1] as Lod[]) {
          const b = bounds(treeModel(g as VegGroup, fam, lod));
          expect(b.min[1]).toBeGreaterThanOrEqual(-0.02);
          expect(b.max[1]).toBeLessThanOrEqual(1.06);
          expect(b.max[0]! - b.min[0]!).toBeLessThan(1.5);
          expect(b.max[2]! - b.min[2]!).toBeLessThan(1.5);
        }
        const bb = bounds(treeModel(g as VegGroup, fam, 2));
        expect(bb.min[1]).toBeCloseTo(0, 5);
        expect(bb.max[1]).toBeCloseTo(1, 5);
        expect(bb.min[2]).toBe(0);
        expect(bb.max[2]).toBe(0);
      }
    }
  });

  it('give ribbon-bark trees hanging streamers and the other eucalypts none', () => {
    const count = (g: VegGroup, part: number): number => {
      const m = treeModel(g, 'natural', 0);
      let c = 0;
      for (let i = 0; i < m.mat.length; i += 3) if (m.mat[i] === part) c++;
      return c;
    };
    expect(count(VegGroup.Ribbonbark, Part.Streamer)).toBeGreaterThan(30);
    expect(count(VegGroup.Stringybark, Part.Streamer)).toBe(0);
    expect(count(VegGroup.SmoothGum, Part.Streamer)).toBe(0);
    // Stringybark has the thickest trunk, smooth gum the slimmest.
    const trunkR = (g: VegGroup): number => {
      const m = treeModel(g, 'natural', 0);
      let r = 0;
      for (let i = 0; i < m.pos.length / 3; i++) if (m.mat[i * 3] === Part.Wood && m.pos[i * 3 + 1]! < 0.02) r = Math.max(r, Math.hypot(m.pos[i * 3]!, m.pos[i * 3 + 2]!));
      return r;
    };
    expect(trunkR(VegGroup.Stringybark)).toBeGreaterThan(trunkR(VegGroup.Ribbonbark));
    expect(trunkR(VegGroup.Ribbonbark)).toBeGreaterThanOrEqual(trunkR(VegGroup.SmoothGum));
  });

  it('have 4–7 foliage lobes (ids), the optional ones beyond MIN_LOBES', () => {
    for (const g of [VegGroup.Stringybark, VegGroup.Ribbonbark, VegGroup.SmoothGum]) {
      const m = treeModel(g, 'natural', 0);
      const ids = new Set<number>();
      for (let i = 0; i < m.mat.length; i += 3) if (m.mat[i] === Part.Leaf) ids.add(m.mat[i + 2]!);
      expect(ids.size).toBeGreaterThanOrEqual(MIN_LOBES);
      expect(ids.size).toBeLessThanOrEqual(7);
      expect(Math.max(...ids)).toBeGreaterThan(MIN_LOBES);
    }
  });

  it('knows which groups have a far level and the bark kind of the eucalypt groups', () => {
    expect(HAS_FAR_LOD[VegGroup.Stringybark]).toBe(true);
    expect(HAS_FAR_LOD[VegGroup.Understorey]).toBe(false);
    expect(HAS_FAR_LOD[VegGroup.Grass]).toBe(false);
    expect(barkKindOfGroup(VegGroup.Stringybark)).toBe('stringy');
    expect(barkKindOfGroup(VegGroup.Ribbonbark)).toBe('ribbon');
    expect(barkKindOfGroup(VegGroup.SmoothGum)).toBe('smooth');
    expect(barkKindOfGroup(VegGroup.Rainforest)).toBeNull();
  });

  it('is cached: the same model object comes back', () => {
    expect(treeModel(VegGroup.SnowGum, 'natural', 1)).toBe(treeModel(VegGroup.SnowGum, 'natural', 1));
  });
});
