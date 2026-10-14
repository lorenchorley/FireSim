/**
 * The cliff drawing modules (cliffSharpen, terrainMesh, rockMask) on the bundled 10 m terrain of the four steep demo sites,
 * against the table of plan 9d.3 and the acceptance numbers of 9d.6 (spike S5 measured them with the prototype; this is the
 * built code). Katoomba runs with the ordinary tests; all four sites run with `SLOW=1`, like the long validation scenarios:
 *
 *   SLOW=1 npx vitest run src/render/cliffSites.test.ts
 *
 * The acceptance numbers measure mesh edges, not the look: a serrated drawing passes all of them (S5), so they are necessary
 * checks only. Times are node times on a busy machine, so the guards are twice the plan's phone budgets (the real figures are
 * about a tenth of them).
 */
import { describe, expect, it } from 'vitest';
import { sampleBilinear } from '../core/grid';
import { cliffSharpen, hornSlopeDeg } from './cliffSharpen';
import { decimateGrid } from './fields';
import { buildRockMask } from './rockMask';
import { MESH_DESPIKE_M, decimateTerrain } from './terrainMesh';
import { CLIFF_SITES, countSpikes, drainageMask, edgeSlopes, iou, loadSite, maxOf, sharePercent, type CliffSite } from './testing/cliffs';

const SLOW = typeof process !== 'undefined' && !!process.env['SLOW'];

/** The table of plan 9d.3, data to new: steepest 10 m slope, area over 70 degrees (%), High mesh edges over 70 degrees (%), steepest High and Low mesh edge, drainage overlap. */
const PLAN: Record<CliffSite, { steepest: [number, number]; over70: [number, number]; edges70High: [number, number]; edgeMaxHigh: [number, number]; edgeMaxLow: [number, number]; iou: number }> = {
  katoomba: { steepest: [83.2, 85.0], over70: [0.52, 0.97], edges70High: [0.12, 0.6], edgeMaxHigh: [78.0, 83.5], edgeMaxLow: [73.2, 79.1], iou: 0.92 },
  kanangra: { steepest: [82.8, 86.2], over70: [0.16, 0.98], edges70High: [0.02, 0.47], edgeMaxHigh: [79.9, 85.3], edgeMaxLow: [75.9, 81.3], iou: 0.94 },
  grose: { steepest: [84.0, 86.2], over70: [1.09, 1.45], edges70High: [0.44, 0.87], edgeMaxHigh: [80.8, 85.4], edgeMaxLow: [76.4, 81.9], iou: 0.86 },
  tomah: { steepest: [73.5, 81.7], over70: [0.02, 0.79], edges70High: [0.0, 0.31], edgeMaxHigh: [67.3, 79.2], edgeMaxLow: [60.7, 72.3], iou: 0.91 },
};

async function checkSite(id: CliffSite): Promise<void> {
  const { grid, elevation, cover } = await loadSite(id);
  const P = PLAN[id];

  const t0 = performance.now();
  const sharp = cliffSharpen(grid, elevation);
  const sharpenMs = performance.now() - t0;
  const t1 = performance.now();
  const high = decimateTerrain(grid, sharp.elevation, 400, { despikeM: MESH_DESPIKE_M.high });
  const low = decimateTerrain(grid, sharp.elevation, 224, { despikeM: MESH_DESPIKE_M.low });
  const meshMs = performance.now() - t1;
  const highToday = decimateGrid(grid, elevation, 400);
  const lowToday = decimateGrid(grid, elevation, 224);

  const s0 = hornSlopeDeg(grid, elevation);
  const s1 = hornSlopeDeg(grid, sharp.elevation);
  const eHigh = edgeSlopes(high.grid, high.elevation);
  const eLow = edgeSlopes(low.grid, low.elevation);

  // The table of 9d.3, to the printed digit (the edge numbers there are without the mesh despike, which moves Kanangra's 0.47 to 0.46).
  expect(Math.abs(maxOf(s0) - P.steepest[0])).toBeLessThan(0.06);
  expect(Math.abs(maxOf(s1) - P.steepest[1])).toBeLessThan(0.06);
  expect(Math.abs(sharePercent(s0, 70) - P.over70[0])).toBeLessThan(0.006);
  expect(Math.abs(sharePercent(s1, 70) - P.over70[1])).toBeLessThan(0.006);
  expect(Math.abs(sharePercent(edgeSlopes(highToday.grid, highToday.elevation), 70) - P.edges70High[0])).toBeLessThan(0.006);
  expect(Math.abs(sharePercent(eHigh, 70) - P.edges70High[1])).toBeLessThan(0.012);
  expect(Math.abs(maxOf(edgeSlopes(highToday.grid, highToday.elevation)) - P.edgeMaxHigh[0])).toBeLessThan(0.06);
  expect(Math.abs(maxOf(eHigh) - P.edgeMaxHigh[1])).toBeLessThan(0.06);
  expect(Math.abs(maxOf(edgeSlopes(lowToday.grid, lowToday.elevation)) - P.edgeMaxLow[0])).toBeLessThan(0.06);
  expect(Math.abs(maxOf(eLow) - P.edgeMaxLow[1])).toBeLessThan(0.06);

  // The acceptance numbers of 9d.6.
  expect(sharePercent(eHigh, 70)).toBeGreaterThanOrEqual(0.3);
  expect(maxOf(eHigh)).toBeGreaterThanOrEqual(79);
  expect(countSpikes(grid, sharp.elevation, 10)).toEqual({ towers: 0, pits: 0 });
  expect(countSpikes(high.grid, high.elevation, MESH_DESPIKE_M.high)).toEqual({ towers: 0, pits: 0 });
  expect(countSpikes(low.grid, low.elevation, MESH_DESPIKE_M.low)).toEqual({ towers: 0, pits: 0 });
  expect(iou(drainageMask(grid, elevation), drainageMask(grid, sharp.elevation))).toBeGreaterThanOrEqual(0.85);
  expect(sharpenMs).toBeLessThan(800);
  expect(meshMs).toBeLessThan(200);

  // The sharpening is a bounded, local change: a few percent of the cells.
  expect(sharp.stats.moved / elevation.length).toBeGreaterThan(0.02);
  expect(sharp.stats.moved / elevation.length).toBeLessThan(0.1);
  expect(sharp.elevation.every(Number.isFinite)).toBe(true);

  // The rock mask, classified with the High mesh's own slope (spike S5's correction) and the canopy cover on the 30 m grid.
  const t2 = performance.now();
  const mask = buildRockMask({ grid, elevation: sharp.elevation, slope: { grid: high.grid, values: hornSlopeDeg(high.grid, high.elevation) }, cover });
  const maskMs = performance.now() - t2;
  expect(maskMs).toBeLessThan(300);
  expect(mask.stats.rockCells / elevation.length).toBeGreaterThan(0.0002); // Tomah, with short faces, has 0.05 %; the others 0.5 to 0.9 %
  expect(mask.stats.rockCells / elevation.length).toBeLessThan(0.1);
  expect(mask.stats.screeCells).toBeGreaterThan(0);
  expect(mask.stats.lipCells).toBeGreaterThan(0);
  // No bare rock under a closed canopy: a cell at R of 0.5 or more has at most half cover.
  let checked = 0;
  for (let j = 0; j < grid.ny; j += 1) {
    for (let i = 0; i < grid.nx; i += 1) {
      const k = j * grid.nx + i;
      if (mask.rgba[k * 4]! < 128) continue;
      expect(sampleBilinear(cover.grid, cover.values, grid.x0 + i * grid.cellSize, grid.y0 + j * grid.cellSize)).toBeLessThanOrEqual(0.5 + 1e-6);
      checked++;
    }
  }
  expect(checked).toBe(mask.stats.rockCells);
}

describe('the cliff drawing on a bundled site (plan 9d.3 table and 9d.6 acceptance numbers)', () => {
  it('Katoomba', async () => {
    await checkSite('katoomba');
  }, 120000);
});

describe.skipIf(!SLOW)('the cliff drawing on the four bundled sites [SLOW]', () => {
  for (const id of CLIFF_SITES) {
    it(id, async () => {
      await checkSite(id);
    }, 300000);
  }
});
