/**
 * The cliff drawing's data (cliffDrawing.ts): the order of the modules, what the render mesh, the lighting gradient and the rock mask are
 * made from, and the tier's rock-detail flags. Synthetic escarpments for the properties; Katoomba (the bundled 10 m terrain) for the
 * numbers the statistics screen shows. The pictures are the real-renderer check (docs/plans/spikes/S5-cliff-look/README.md, e2e/cliffs.spec.ts).
 */
import { describe, expect, it } from 'vitest';
import { cliffSharpen } from './cliffSharpen';
import { ROCK_DETAIL_PLAIN, buildCliffDrawing, cliffDefines, rockDetailCount, rockDetailFlags, type DetailTier } from './cliffDrawing';
import { decimateGrid, hornGradient } from './fields';
import { sampleRock } from './rockMask';
import { edgeSlopes, flatGrid, loadSite, maxOf, terrainOf } from './testing/cliffs';

const TAN = (deg: number): number => Math.tan((deg * Math.PI) / 180);
const FACE_RUN = 150 / TAN(70);

/** Plateau at 600 m, a 70 degree face of 150 m from x = 700 m, then 30 degree talus: 180 x 60 cells of 10 m. */
const g = flatGrid(180, 60);
function height(x: number): number {
  if (x <= 700) return 600;
  if (x <= 700 + FACE_RUN) return 600 - (x - 700) * TAN(70);
  return 450 - (x - 700 - FACE_RUN) * TAN(30);
}
const escarpment = (): Float32Array => terrainOf(g, (i) => height(i * 10));
const noCover = { grid: g, canopyCover: new Float32Array(g.nx * g.ny) };
const run = (z: Float32Array, o: { tier?: DetailTier; meshN?: number; cover?: { grid: typeof g; canopyCover: Float32Array } } = {}) =>
  buildCliffDrawing({ hi: { grid: g, elevation: z }, fuel: o.cover ?? noCover, meshN: o.meshN ?? 90, tier: o.tier ?? 'high', source: 'test' });

describe('rock detail by picture-quality tier (plan 9d.3.5)', () => {
  it('High draws all six effects, Medium drops the joints and the overhang bands, Low keeps ledges, stains and scree', () => {
    expect(rockDetailFlags('high')).toEqual({ ledges: true, joints: true, overhang: true, stains: true, scree: true, pavement: true });
    expect(rockDetailFlags('medium')).toEqual({ ledges: true, joints: false, overhang: false, stains: true, scree: true, pavement: true });
    expect(rockDetailFlags('low')).toEqual({ ledges: true, joints: false, overhang: false, stains: true, scree: true, pavement: false });
  });

  it('counts six, four and three effects (the statistics screen says "all six", "four" and "three")', () => {
    expect([rockDetailCount('high'), rockDetailCount('medium'), rockDetailCount('low')]).toEqual([6, 4, 3]);
  });

  it('the shader defines follow the flags, and an overhang needs the ledges it hangs under', () => {
    expect(Object.keys(cliffDefines('high')).sort()).toEqual(['CLIFF', 'RD_JOINTS', 'RD_LEDGES', 'RD_OVERHANG', 'RD_PAVEMENT', 'RD_SCREE', 'RD_STAINS']);
    expect(Object.keys(cliffDefines('medium')).sort()).toEqual(['CLIFF', 'RD_LEDGES', 'RD_PAVEMENT', 'RD_SCREE', 'RD_STAINS']);
    expect(Object.keys(cliffDefines('low')).sort()).toEqual(['CLIFF', 'RD_LEDGES', 'RD_SCREE', 'RD_STAINS']);
  });

  it('the Plain map type keeps 40 % of the normal perturbation', () => {
    expect(ROCK_DETAIL_PLAIN).toBe(0.4);
  });
});

describe('buildCliffDrawing on a synthetic escarpment', () => {
  const z = escarpment();
  const before = Float32Array.from(z);
  const cd = run(z);
  const today = decimateGrid(g, z, 90);

  it('never changes the terrain it is given (numbers keep using the data as received)', () => {
    expect(z).toEqual(before);
  });

  it('draws the mesh on the same grid as today, with a steeper face and the same gentle ground', () => {
    expect(cd.mesh.grid).toEqual(today.grid);
    expect(maxOf(edgeSlopes(cd.mesh.grid, cd.mesh.elevation))).toBeGreaterThan(maxOf(edgeSlopes(today.grid, today.elevation)) + 3);
    // far from the face the mesh is the box-blurred one, bit for bit
    for (const i of [2, 5, 10, 15]) expect(cd.mesh.elevation[10 * cd.mesh.grid.nx + i]).toBe(today.elevation[10 * today.grid.nx + i]);
  });

  it('lights the shader from the sharpened 10 m terrain: the gradient is the Horn gradient of the sharpened copy, on the 10 m grid', () => {
    expect(cd.gradient.grid).toBe(g);
    const sharp = cliffSharpen(g, z);
    const horn = hornGradient(g, sharp.elevation);
    expect(cd.gradient.dzdx).toEqual(horn.dzdx);
    expect(cd.gradient.dzdy).toEqual(horn.dzdy);
    // and it is steeper on the face than the data's own
    const data = hornGradient(g, z);
    const k = 30 * g.nx + 73;
    expect(Math.hypot(cd.gradient.dzdx[k]!, cd.gradient.dzdy[k]!)).toBeGreaterThan(Math.hypot(data.dzdx[k]!, data.dzdy[k]!));
  });

  it("picks banded rock or the photo from the MESH's gradient, one value per vertex (spike S5)", () => {
    expect(cd.meshSlope.length).toBe(cd.mesh.grid.nx * cd.mesh.grid.ny);
    for (const k of [0, 500, 1500, 2600]) expect(cd.meshSlope[k]).toBeCloseTo(Math.hypot(cd.lightT.dzdx[k]!, cd.lightT.dzdy[k]!), 6);
    expect(cd.lightT.grid).toBe(cd.mesh.grid);
    expect(cd.lightT.elevation).toBe(cd.mesh.elevation); // hillshade, sky view and cast shadows follow the drawn mesh
  });

  it('classifies bare rock on the face from the mesh slope, none on the plateau or the talus, and trees get the same R', () => {
    const row = 30;
    const r = (i: number): number => cd.mask.rgba[(row * g.nx + i) * 4]! / 255;
    expect(r(73)).toBeGreaterThan(0.5);
    for (const i of [5, 30, 55, 120, 150, 175]) expect(r(i)).toBe(0);
    expect(cd.rock.grid).toBe(cd.mask.grid);
    expect(cd.rock.r.length).toBe(g.nx * g.ny);
    for (const i of [0, 40, 73, 74, 100]) expect(sampleRock(cd.rock, g.x0 + i * 10, g.y0 + row * 10)).toBeCloseTo(r(i), 2);
  });

  it('canopy cover takes the rock away (a forested face is not bare rock)', () => {
    const covered = run(z, { cover: { grid: g, canopyCover: new Float32Array(g.nx * g.ny).fill(1) } });
    expect(covered.mask.stats.rockCells).toBe(0);
    expect(cd.mask.stats.rockCells).toBeGreaterThan(0);
  });

  it('counts the vertices and triangles of the mesh and times each stage', () => {
    const s = cd.stats;
    expect(s.meshVertices).toBe(cd.mesh.grid.nx * cd.mesh.grid.ny);
    expect(s.meshTriangles).toBe(2 * (cd.mesh.grid.nx - 1) * (cd.mesh.grid.ny - 1));
    expect(s.sharpenedShare).toBeGreaterThan(0);
    expect(s.sharpenedShare).toBeLessThan(0.2);
    for (const ms of [s.sharpenMs, s.maskMs, s.meshMs, s.gradientMs]) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic', () => {
    const again = run(z);
    expect(again.mesh.elevation).toEqual(cd.mesh.elevation);
    expect(again.mask.rgba).toEqual(cd.mask.rgba);
    expect(again.gradient.dzdx).toEqual(cd.gradient.dzdx);
  });
});

describe('buildCliffDrawing on gentle ground', () => {
  const z = terrainOf(g, (i, j) => 500 + 40 * Math.sin(i / 17) * Math.cos(j / 11) + 0.2 * i);
  const cd = run(z);

  it('sharpens nothing, and the mesh is today\'s bit for bit', () => {
    expect(cd.stats.sharpenedShare).toBe(0);
    expect(cd.mesh.elevation).toEqual(decimateGrid(g, z, 90).elevation);
  });

  it('has no rock, scree or pavement anywhere', () => {
    expect(cd.mask.rgba.every((v, k) => (k % 4 === 3 ? v === 255 : v === 0))).toBe(true);
    expect(cd.mask.stats.rockCells).toBe(0);
    expect(cd.rock.r.every((v) => v === 0)).toBe(true);
  });

  it('a mesh as coarse as the terrain is the terrain (no decimation: nothing to keep an edge across)', () => {
    const same = run(z, { meshN: 400 });
    expect(same.mesh.ratio).toBe(1);
    expect(same.mesh.grid).toBe(g);
  });
});

describe('Katoomba, the bundled 10 m terrain', () => {
  it('builds in the budget the plan states and counts what the statistics screen shows', async () => {
    const { grid, elevation, cover } = await loadSite('katoomba');
    const before = Float32Array.from(elevation);
    const t0 = performance.now();
    const cd = buildCliffDrawing({ hi: { grid, elevation }, fuel: { grid: cover.grid, canopyCover: cover.values }, meshN: 400, tier: 'high', source: 'test' });
    const ms = performance.now() - t0;
    expect(elevation).toEqual(before);
    // 9d.3.1: about 4 % of cells move (S5: 3.9 % at Katoomba); the High mesh is 400 x 400 samples, 318,402 triangles (S5)
    expect(cd.stats.sharpenedShare).toBeGreaterThan(0.03);
    expect(cd.stats.sharpenedShare).toBeLessThan(0.05);
    expect(cd.stats.meshVertices).toBe(160000);
    expect(cd.stats.meshTriangles).toBe(318402);
    // the wall share under slope x (1 - cover) is about 0.5 % (S6)
    const share = cd.mask.stats.rockCells / (grid.nx * grid.ny);
    expect(share).toBeGreaterThan(0.001);
    expect(share).toBeLessThan(0.02);
    expect(cd.mask.rgba.length).toBe(grid.nx * grid.ny * 4);
    expect(cd.gradient.dzdx.every(Number.isFinite)).toBe(true);
    expect(cd.meshSlope.every(Number.isFinite)).toBe(true);
    // a sanity limit for a node run on a shared machine, not the phone budget
    expect(ms).toBeLessThan(5000);
    // the Low mesh draws the Low triangle budget
    const low = buildCliffDrawing({ hi: { grid, elevation }, fuel: { grid: cover.grid, canopyCover: cover.values }, meshN: 224, tier: 'low', source: 'test' });
    expect(low.stats.meshTriangles).toBe(99458);
  }, 60000);
});
