/**
 * Property tests of the cliff drawing modules on random terrains (fixed seeds, so a failure repeats): cliffSharpen, decimateTerrain,
 * buildRockMask and the rock option of placeVegetation. Each module is held to invariants that need no golden number: no NaN
 * made, bounded moves, untouched ground, determinism, and, for the sharpening, agreement with a plain reference of the rule of plan
 * 9d.3.1 written here from the plan's words (a per-cell loop with no gating, no scatter and no tan^2 shortcut), so the optimised
 * code cannot drift from the rule without a test saying so. About 3 s.
 */
import { describe, expect, it } from 'vitest';
import { sampleBilinear, type GridSpec } from '../core/grid';
import { smoothstep } from '../core/units';
import { FuelType, type FuelMap } from '../core/types';
import { cliffSharpen, hornSlopeDeg } from './cliffSharpen';
import { decimateGrid, hornGradient, slopeFromGradient } from './fields';
import { buildRockMask, rockCopy, sampleRock, type RockCopy } from './rockMask';
import { MESH_DESPIKE_M, decimateTerrain } from './terrainMesh';
import { countSpikes, flatGrid, loadSite } from './testing/cliffs';
import { placeVegetation, totalInstances, type VegInstances } from './vegetationPlacement';

/** mulberry32. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random rugged terrain: a few waves, stair-stepped bands so there are real faces of 60 to 85 degrees, lone pinnacles and pits,
 * and (with `nanHoles`) a few cells with no height. Cells of `cell` metres.
 */
function randomTerrain(rnd: () => number, nx: number, ny: number, cell: number, nanHoles: boolean): { g: GridSpec; z: Float32Array } {
  const g = flatGrid(nx, ny, cell);
  const z = new Float32Array(nx * ny);
  const waves = Array.from({ length: 4 }, () => ({ ax: 0.03 + 0.2 * rnd(), ay: 0.03 + 0.2 * rnd(), ph: 6.28 * rnd(), amp: 40 + 140 * rnd() }));
  const step = 20 + 90 * rnd();
  const stairs = 0.3 + 0.7 * rnd();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let h = 500;
      for (const w of waves) h += w.amp * Math.sin(w.ax * i + w.ph) * Math.cos(w.ay * j + w.ph);
      const q = Math.floor(h / step);
      const f = (h - q * step) / step;
      const t = Math.min(1, Math.max(0, (f - 0.4) / 0.2));
      z[j * nx + i] = (q + t * t * (3 - 2 * t)) * step * stairs + h * (1 - stairs);
    }
  }
  for (let s = 0; s < Math.floor(nx * ny * 0.01); s++) z[Math.floor(rnd() * nx * ny)] += (rnd() - 0.5) * 120;
  if (nanHoles) for (let s = 0; s < 3; s++) z[Math.floor(rnd() * nx * ny)] = NaN;
  return { g, z };
}

/** True when the interior cell stands `m` metres or more above all eight neighbours or below all of them. */
function isSpike(z: ArrayLike<number>, nx: number, ny: number, i: number, j: number, m: number): boolean {
  if (i < 1 || j < 1 || i > nx - 2 || j > ny - 2) return false;
  let up = true;
  let dn = true;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const q = z[(j + dj) * nx + i + di]!;
      if (z[j * nx + i]! - q < m) up = false;
      if (q - z[j * nx + i]! < m) dn = false;
    }
  }
  return up || dn;
}

describe('cliffSharpen on random terrains', () => {
  /** The rule of plan 9d.3.1 as a plain per-cell loop; the outer ring is never moved (plan 9d.6). */
  function reference(g: GridSpec, z0: Float32Array): Float32Array {
    const { nx, ny } = g;
    const { dzdx, dzdy } = hornGradient(g, z0);
    const w0 = new Float64Array(nx * ny);
    for (let k = 0; k < nx * ny; k++) w0[k] = smoothstep(48, 62, slopeFromGradient(dzdx[k]!, dzdy[k]!));
    const at = (i: number, j: number): number => z0[j * nx + i]!;
    const bil = (x: number, y: number): number => {
      x = Math.min(nx - 1, Math.max(0, x));
      y = Math.min(ny - 1, Math.max(0, y));
      const i0 = Math.min(nx - 2, Math.floor(x));
      const j0 = Math.min(ny - 2, Math.floor(y));
      const fx = x - i0;
      const fy = y - j0;
      return (at(i0, j0) * (1 - fx) + at(i0 + 1, j0) * fx) * (1 - fy) + (at(i0, j0 + 1) * (1 - fx) + at(i0 + 1, j0 + 1) * fx) * fy;
    };
    const moved = new Float32Array(z0);
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        let w = w0[j * nx + i]!;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj) w = Math.max(w, 0.6 * w0[(j + dj) * nx + i + di]!);
        const k = j * nx + i;
        const gm = Math.hypot(dzdx[k]!, dzdy[k]!);
        if (!(w > 0) || !(gm > 1e-6)) continue;
        const ux = dzdx[k]! / gm;
        const uy = dzdy[k]! / gm;
        let lo = at(i, j);
        let hi = lo;
        for (let t = 1; t <= 3; t++) {
          const ends = [[i + t * ux, j + t * uy], [i - t * ux, j - t * uy]] as const;
          if (ends.some(([x, y]) => x < 0 || x > nx - 1 || y < 0 || y > ny - 1)) break; // a window that would leave the grid is cut short on both sides
          for (const [x, y] of ends) {
            const v = bil(x, y);
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        const d = at(i, j) - (lo + hi) / 2;
        if (Math.abs(d) > 0.5) moved[k] = at(i, j) + w * ((d > 0 ? hi : lo) - at(i, j));
      }
    }
    const out = new Float32Array(moved);
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        let hi = -Infinity;
        let lo = Infinity;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const v = moved[(j + dj) * nx + i + di]!;
            hi = Math.max(hi, v);
            lo = Math.min(lo, v);
          }
        }
        const v = moved[j * nx + i]!;
        if (v - hi >= 10) out[j * nx + i] = hi + 2;
        else if (lo - v >= 10) out[j * nx + i] = lo - 2;
      }
    }
    return out;
  }

  it('agrees with the plain reference of the rule, never makes a NaN, keeps the ring and the far ground, is bounded and deterministic', () => {
    const rnd = seeded(20261014);
    let steepTrials = 0;
    for (let trial = 0; trial < 40; trial++) {
      const nx = 4 + Math.floor(rnd() * 70);
      const ny = 4 + Math.floor(rnd() * 70);
      const cell = [5, 10, 10, 10, 20, 30][Math.floor(rnd() * 6)]!;
      const { g, z } = randomTerrain(rnd, nx, ny, cell, false);
      const before = Float32Array.from(z);
      const r = cliffSharpen(g, z);
      const out = r.elevation;
      const tag = `trial ${trial} (${nx} x ${ny}, ${cell} m)`;
      expect(Array.from(z), `${tag}: the input is never modified`).toEqual(Array.from(before));
      expect(out.length).toBe(z.length);
      expect(out.every(Number.isFinite), `${tag}: no NaN or infinity`).toBe(true);
      const again = cliffSharpen(g, z).elevation;
      expect(Array.from(again), `${tag}: deterministic`).toEqual(Array.from(out));
      // the outer ring is never moved
      for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) expect(out[j * nx + i], `${tag}: ring`).toBe(z[j * nx + i]);
      for (let j = 0; j < ny; j++) for (const i of [0, nx - 1]) expect(out[j * nx + i], `${tag}: ring`).toBe(z[j * nx + i]);
      const slope = hornSlopeDeg(g, z);
      const steep = (i: number, j: number): boolean => slope[j * nx + i]! > 48;
      let any = false;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (steep(i, j)) any = true;
      if (!any) {
        expect(Array.from(out), `${tag}: nothing over 48 degrees comes back as an exact copy`).toEqual(Array.from(z));
        continue;
      }
      steepTrials++;
      // ground three or more cells from any steep cell is untouched, except a tower or pit of the data itself: the despike runs on the whole terrain
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (isSpike(z, nx, ny, i, j, 10)) continue;
          let near = false;
          for (let dj = -2; dj <= 2 && !near; dj++) for (let di = -2; di <= 2 && !near; di++) if (i + di >= 0 && i + di < nx && j + dj >= 0 && j + dj < ny && steep(i + di, j + dj)) near = true;
          if (!near) expect(out[j * nx + i], `${tag}: untouched ground (${i}, ${j})`).toBe(z[j * nx + i]);
        }
      }
      // bounded: a moved cell lands inside the range of the 11 x 11 block around it (the window reaches 3 cells and the bilinear one more), give or take the 2 m despike margin
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          let lo = Infinity;
          let hi = -Infinity;
          for (let dj = -5; dj <= 5; dj++) {
            for (let di = -5; di <= 5; di++) {
              const ii = Math.min(nx - 1, Math.max(0, i + di));
              const jj = Math.min(ny - 1, Math.max(0, j + dj));
              lo = Math.min(lo, z[jj * nx + ii]!);
              hi = Math.max(hi, z[jj * nx + ii]!);
            }
          }
          const v = out[j * nx + i]!;
          expect(v, `${tag}: bounded (${i}, ${j})`).toBeGreaterThanOrEqual(lo - 2 - 1e-3);
          expect(v, `${tag}: bounded (${i}, ${j})`).toBeLessThanOrEqual(hi + 2 + 1e-3);
        }
      }
      // no tower or pit of 10 m or more is left in the interior (the plan's despike guarantee)
      expect(countSpikes(g, out, 10), `${tag}: towers and pits`).toEqual({ towers: 0, pits: 0 });
      // the optimised code is the rule: every cell within a millimetre of the plain reference
      const ref = reference(g, z);
      let worst = 0;
      for (let k = 0; k < ref.length; k++) worst = Math.max(worst, Math.abs(ref[k]! - out[k]!));
      expect(worst, `${tag}: against the reference`).toBeLessThan(1e-3);
    }
    expect(steepTrials).toBeGreaterThan(20);
  });

  it('leaves a straight ramp untouched all the way to the border (a window that would leave the grid is cut short, not clamped)', () => {
    for (const [nx, ny, deg, run] of [[40, 30, 50, 1], [40, 30, 70, 1], [40, 30, 80, 1], [36, 36, 62, 1], [30, 44, 66, 0.5]] as const) {
      const g = flatGrid(nx, ny, 10);
      const t = Math.tan((deg * Math.PI) / 180);
      const z = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 2000 - t * (run * i * 10 + (1 - run) * 0.3 * j * 10 + 0.4 * (run === 1 ? 0 : j * 10));
      const r = cliffSharpen(g, z);
      const changed = Array.from(r.elevation).filter((v, k) => v !== z[k]).length;
      expect(changed, `${deg} degree plane in a ${nx} x ${ny} grid`).toBe(0);
    }
  });

  it('never makes a NaN out of terrain with holes, moves no cell that has no height, and still sharpens the rest', () => {
    const rnd = seeded(77);
    for (let trial = 0; trial < 25; trial++) {
      const { g, z } = randomTerrain(rnd, 20 + Math.floor(rnd() * 40), 20 + Math.floor(rnd() * 40), 10, true);
      const out = cliffSharpen(g, z);
      for (let k = 0; k < z.length; k++) {
        if (Number.isNaN(z[k]!)) expect(Number.isNaN(out.elevation[k]!), `trial ${trial}: a hole stays a hole`).toBe(true);
        else expect(Number.isNaN(out.elevation[k]!), `trial ${trial}: no new NaN`).toBe(false);
      }
      expect(Object.values(out.stats).every((v) => typeof v !== 'number' || Number.isFinite(v))).toBe(true);
      expect(out.stats.ms.total).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * The steepest 10 m Horn slope (deg) in the footprint of every vertex of the mesh grid `dst`: the source cells within half a mesh
 * cell of the vertex, rounded outwards to whole cells (the footprint of plan 9d.3.2 as terrainMesh.ts takes it).
 */
function footprintSlope(g: GridSpec, z: Float32Array, dst: GridSpec): Float32Array {
  const { dzdx, dzdy } = hornGradient(g, z);
  const half = dst.cellSize / 2;
  const out = new Float32Array(dst.nx * dst.ny);
  for (let j = 0; j < dst.ny; j++) {
    for (let i = 0; i < dst.nx; i++) {
      const x = dst.x0 + i * dst.cellSize;
      const y = dst.y0 + j * dst.cellSize;
      let mx = 0;
      for (let b = Math.max(0, Math.floor((y - half - g.y0) / g.cellSize)); b <= Math.min(g.ny - 1, Math.ceil((y + half - g.y0) / g.cellSize)); b++) {
        for (let a = Math.max(0, Math.floor((x - half - g.x0) / g.cellSize)); a <= Math.min(g.nx - 1, Math.ceil((x + half - g.x0) / g.cellSize)); a++) mx = Math.max(mx, slopeFromGradient(dzdx[b * g.nx + a]!, dzdy[b * g.nx + a]!));
      }
      out[j * dst.nx + i] = mx;
    }
  }
  return out;
}

describe('decimateTerrain on random terrains', () => {
  it('is decimateGrid wherever no 10 m slope in the footprint is over 40 degrees, is bounded, deterministic and NaN-free, and leaves no spike after its despike', () => {
    const rnd = seeded(4242);
    let gentleTotal = 0;
    for (let trial = 0; trial < 30; trial++) {
      const nx = 30 + Math.floor(rnd() * 120);
      const ny = 30 + Math.floor(rnd() * 90);
      const cell = [10, 10, 10, 5, 20, 30][trial % 6]!; // the bundled terrain is 10 m; other cells are checked too
      const { g, z } = randomTerrain(rnd, nx, ny, cell, false);
      // every other trial is calm ground with a few cliffs, so there are vertices of both kinds
      if (trial % 2) for (let k = 0; k < z.length; k++) z[k] = 500 + (z[k]! - 500) * 0.25;
      const maxN = 12 + Math.floor(rnd() * (Math.max(nx, ny) - 13)); // always fewer vertices than cells: a grid within maxN comes back as it is, despike included
      const base = decimateGrid(g, z, maxN);
      expect(base.ratio).toBeGreaterThan(1);
      const tag = `trial ${trial} (${nx} x ${ny} to ${maxN})`;
      const plain = decimateTerrain(g, z, maxN);
      expect(plain.grid, tag).toEqual(base.grid);
      expect(plain.elevation.every(Number.isFinite), `${tag}: no NaN`).toBe(true);
      expect(Array.from(decimateTerrain(g, z, maxN).elevation), `${tag}: deterministic`).toEqual(Array.from(plain.elevation));
      const dst = base.grid;
      const steepest = footprintSlope(g, z, dst);
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of z) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      let gentle = 0;
      for (let k = 0; k < dst.nx * dst.ny; k++) {
        if (steepest[k]! <= 40) {
          gentle++;
          expect(plain.elevation[k], `${tag}: gentle vertex ${k % dst.nx}, ${(k / dst.nx) | 0}`).toBe(base.elevation[k]);
        }
        expect(plain.elevation[k]!, tag).toBeGreaterThanOrEqual(lo - 1e-3);
        expect(plain.elevation[k]!, tag).toBeLessThanOrEqual(hi + 1e-3);
      }
      gentleTotal += gentle;
      for (const m of [MESH_DESPIKE_M.high, MESH_DESPIKE_M.low]) {
        const d = decimateTerrain(g, z, maxN, { despikeM: m });
        expect(countSpikes(d.grid, d.elevation, m), `${tag}: spikes of ${m} m after the despike`).toEqual({ towers: 0, pits: 0 });
        expect(d.elevation.every(Number.isFinite)).toBe(true);
        // the despike touches only towers and pits of the mesh (it does not look at why: a real summit that stands out by `m` is clipped as well, see the header of terrainMesh.ts)
        for (let k = 0; k < d.elevation.length; k++) if (d.elevation[k] !== plain.elevation[k]) expect(isSpike(plain.elevation, d.grid.nx, d.grid.ny, k % d.grid.nx, (k / d.grid.nx) | 0, m), `${tag}: a despiked vertex was a spike`).toBe(true);
      }
    }
    // there were gentle vertices to compare (the test would pass empty otherwise)
    expect(gentleTotal).toBeGreaterThan(500);
  });

  it('on Katoomba, at all three tiers, on the data and on the sharpened terrain, is decimateGrid at every vertex whose footprint has no 10 m slope over 40 degrees', async () => {
    const { grid, elevation } = await loadSite('katoomba');
    const sharp = cliffSharpen(grid, elevation).elevation;
    for (const z of [elevation, sharp]) {
      for (const maxN of [400, 320, 224]) {
        const base = decimateGrid(grid, z, maxN);
        const mesh = decimateTerrain(grid, z, maxN);
        const steepest = footprintSlope(grid, z, base.grid);
        let gentle = 0;
        let differ = 0;
        for (let k = 0; k < steepest.length; k++) {
          if (steepest[k]! <= 40) {
            gentle++;
            if (mesh.elevation[k] !== base.elevation[k]) differ++;
          }
        }
        expect(gentle, `${maxN}: most of the mesh is gentle ground`).toBeGreaterThan(steepest.length / 2);
        expect(differ, `${maxN}: gentle vertices that differ from decimateGrid`).toBe(0);
      }
    }
  }, 60000);

  it('keeps a 150 m step steeper than the blur at EVERY phase of the vertex lattice, and says what the worst phase gives (the plan\'s 80 and 72 degrees are the favourable phases)', () => {
    // The data step is one 10 m cell wide, so a vertex that lands inside that cell takes an in-between height and the steepest edge
    // beside it is shallower than the ideal atan(150 / spacing) = 81.5 degrees at 22.5 m and 75.0 at 40.3 m. terrainMesh.test.ts
    // moves the step over only three to five positions; here it moves over 90, which covers every phase (10 m against 22.5 or 40.3 m).
    // Measured (software, node): worst 75.1 and 62.5 degrees, 28 % and 22 % of phases under the plan's 80 and 72, means 80.1 and 73.2.
    const g: GridSpec = { nx: 900, ny: 24, cellSize: 10, x0: 0, y0: 0, origin: flatGrid(2, 2).origin };
    const steepest = (m: { grid: GridSpec; elevation: Float32Array }): number => {
      const row = (m.grid.ny >> 1) * m.grid.nx;
      let best = 0;
      for (let i = 0; i < m.grid.nx - 1; i++) best = Math.max(best, (Math.atan(Math.abs(m.elevation[row + i + 1]! - m.elevation[row + i]!) / m.grid.cellSize) * 180) / Math.PI);
      return best;
    };
    for (const [maxN, despikeM, floor, spacing] of [[400, MESH_DESPIKE_M.high, 74.5, 22.53], [224, MESH_DESPIKE_M.low, 62, 40.31]] as const) {
      let worst = 90;
      let sum = 0;
      for (let cut = 400; cut < 490; cut++) {
        const z = new Float32Array(g.nx * g.ny);
        for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = i < cut ? 0 : 150;
        const mesh = decimateTerrain(g, z, maxN, { despikeM });
        const s = steepest(mesh);
        const blur = steepest(decimateGrid(g, z, maxN));
        expect(mesh.grid.cellSize).toBeCloseTo(spacing, 1);
        expect(s, `step at cell ${cut} on the ${spacing} m mesh: never shallower than the blur`).toBeGreaterThan(blur);
        worst = Math.min(worst, s);
        sum += s;
      }
      expect(worst, `${spacing} m mesh, worst phase`).toBeGreaterThanOrEqual(floor);
      expect(sum / 90, `${spacing} m mesh, mean over phases`).toBeGreaterThan(floor + 5);
    }
  });

  it('makes NaN only where decimateGrid does (holes in the data), at any size', () => {
    const rnd = seeded(31);
    for (let trial = 0; trial < 15; trial++) {
      const { g, z } = randomTerrain(rnd, 40 + Math.floor(rnd() * 50), 40 + Math.floor(rnd() * 50), 10, true);
      const maxN = 15 + Math.floor(rnd() * 30);
      const base = decimateGrid(g, z, maxN);
      const mesh = decimateTerrain(g, z, maxN, { despikeM: 10 });
      let extra = 0;
      for (let k = 0; k < base.elevation.length; k++) if (Number.isNaN(mesh.elevation[k]!) && !Number.isNaN(base.elevation[k]!)) extra++;
      expect(extra, `trial ${trial}`).toBe(0);
    }
  });
});

describe('buildRockMask on random fields', () => {
  /** A random field on a grid of its own (cell, offset and size differ from the raster's). */
  const field = (rnd: () => number, g: GridSpec, lo: number, hi: number): { grid: GridSpec; values: Float32Array } => {
    const values = new Float32Array(g.nx * g.ny);
    for (let k = 0; k < values.length; k++) values[k] = lo + (hi - lo) * rnd();
    return { grid: g, values };
  };

  it('puts R where the slope on its own grid and the cover say, and G and B only near rock and on the slopes they are for', () => {
    const rnd = seeded(99);
    for (let trial = 0; trial < 20; trial++) {
      const cell = [10, 10, 5, 20, 30][trial % 5]!;
      const g = flatGrid(30 + Math.floor(rnd() * 50), 30 + Math.floor(rnd() * 50), cell);
      const { z } = randomTerrain(rnd, g.nx, g.ny, cell, false);
      const sg: GridSpec = { ...flatGrid(8 + Math.floor(rnd() * 30), 8 + Math.floor(rnd() * 30), (12 + 20 * rnd()) * (cell / 10)), x0: -5 + 10 * rnd(), y0: -5 + 10 * rnd() };
      const cg: GridSpec = { ...flatGrid(5 + Math.floor(rnd() * 12), 5 + Math.floor(rnd() * 12), 30), x0: 5, y0: 5 };
      // a slope field that is steep in blobs, so rock, scree and pavement all occur
      const slope = field(rnd, sg, 0, 0);
      for (let j = 0; j < sg.ny; j++) for (let i = 0; i < sg.nx; i++) slope.values[j * sg.nx + i] = 40 + 45 * Math.sin(i / 2.3 + trial) * Math.cos(j / 3.1 - trial);
      const cover = field(rnd, cg, 0, 1);
      const m = buildRockMask({ grid: g, elevation: z, slope, windowSlope: slope, cover });
      const tag = `trial ${trial}`;
      expect(m.rgba.length).toBe(4 * g.nx * g.ny);
      const again = buildRockMask({ grid: g, elevation: z, slope, windowSlope: slope, cover });
      expect(Array.from(again.rgba), `${tag}: deterministic`).toEqual(Array.from(m.rgba));
      const R = (i: number, j: number): number => m.rgba[(j * g.nx + i) * 4]!;
      let rockSeen = 0;
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const k = (j * g.nx + i) * 4;
          expect(m.rgba[k + 3], `${tag}: alpha`).toBe(255);
          const x = g.x0 + i * g.cellSize;
          const y = g.y0 + j * g.cellSize;
          const s = sampleBilinear(sg, slope.values, x, y);
          const c = Math.min(1, Math.max(0, sampleBilinear(cg, cover.values, x, y)));
          const want = s > 52 ? Math.round(255 * smoothstep(52, 62, s) * (1 - c)) : 0;
          expect(Math.abs(R(i, j) - want), `${tag}: R at ${i}, ${j}`).toBeLessThanOrEqual(1);
          if (R(i, j) > 0) rockSeen++;
          // G: only on the scree slopes (22 to 40 degrees, with a 4 degree ramp each side), and not on the outer ring
          if (m.rgba[k + 1]! > 0) {
            expect(s, `${tag}: G slope`).toBeGreaterThan(18 - 0.01);
            expect(s, `${tag}: G slope`).toBeLessThan(44 + 0.01);
          }
          // B: only on ground under 15 degrees
          if (m.rgba[k + 2]! > 0) expect(s, `${tag}: B slope`).toBeLessThan(15);
        }
      }
      // G and B never exceed the strongest rock within their reach (80 m and 40 m, one cell of margin)
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const k = (j * g.nx + i) * 4;
          for (const [chan, reach] of [[1, 80], [2, 40]] as const) {
            const v = m.rgba[k + chan]!;
            if (v === 0) continue;
            const r = Math.ceil(reach / g.cellSize) + 1;
            let mx = 0;
            for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (i + di >= 0 && i + di < g.nx && j + dj >= 0 && j + dj < g.ny) mx = Math.max(mx, R(i + di, j + dj));
            expect(v, `${tag}: channel ${chan} at ${i}, ${j} comes from rock nearby`).toBeLessThanOrEqual(mx + 1);
          }
        }
      }
      expect(rockSeen, tag).toBeGreaterThan(0);
      // the CPU copy is exactly R
      const copy = rockCopy(m);
      for (let k = 0; k < copy.r.length; k++) expect(copy.r[k]).toBe(m.rgba[k * 4]);
    }
  });

  it('stops the scree ray at a crest: rock beyond the crest, on the far side, is not uphill of the scree below it, and is when the ground goes on rising', () => {
    // along x: a 30 degree talus rising east from x = 300 m to x = 700 m, then a 70 degree face of 150 m that either falls east (a
    // crest at x = 700 m: the rock is behind the crest) or rises east (the rock is uphill of the talus)
    const g = flatGrid(120, 12, 10);
    const tan30 = Math.tan((30 * Math.PI) / 180);
    const run = 150 / Math.tan((70 * Math.PI) / 180);
    const top = 100 + 400 * tan30;
    const profile = (sign: number) => (x: number): number => (x < 300 ? 100 : x < 700 ? 100 + (x - 300) * tan30 : x < 700 + run ? top + (sign * (x - 700) * 150) / run : top + sign * 150);
    const scree = (sign: number): number[] => {
      const z = new Float32Array(g.nx * g.ny);
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = profile(sign)(i * 10);
      const m = buildRockMask({ grid: g, elevation: z, slope: { grid: g, values: hornSlopeDeg(g, z) } });
      expect(m.rgba[(6 * g.nx + 72) * 4], 'the face is rock').toBeGreaterThan(200);
      return Array.from({ length: 7 }, (_, d) => m.rgba[(6 * g.nx + 62 + d) * 4 + 1]!);
    };
    const rising = scree(1);
    const falling = scree(-1);
    expect(Math.max(...rising), 'rock uphill: scree on the talus below it').toBeGreaterThan(100);
    expect(falling, 'a crest between the talus and the rock: no scree').toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('is zero everywhere but the alpha with no rock, and finite with holes (NaN) in the slope, the cover and the heights', () => {
    const rnd = seeded(5);
    const g = flatGrid(40, 40, 10);
    const { z } = randomTerrain(rnd, 40, 40, 10, false);
    const calm = buildRockMask({ grid: g, elevation: z, slope: field(rnd, g, 0, 50) });
    expect(calm.rgba.every((v, k) => (k % 4 === 3 ? v === 255 : v === 0))).toBe(true);
    expect(calm.stats.rockCells).toBe(0);
    const s = field(rnd, g, 50, 85);
    const c = field(rnd, g, 0, 0.5);
    const zn = Float32Array.from(z);
    for (let q = 0; q < 20; q++) {
      s.values[Math.floor(rnd() * s.values.length)] = NaN;
      c.values[Math.floor(rnd() * c.values.length)] = NaN;
      zn[Math.floor(rnd() * zn.length)] = NaN;
    }
    const m = buildRockMask({ grid: g, elevation: zn, slope: s, cover: c });
    expect(m.rgba.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
    expect(m.stats.rockCells).toBeGreaterThan(0);
  });
});

describe('placeVegetation with a rock copy on random fuel', () => {
  const fuelOf = (rnd: () => number, g: GridSpec): FuelMap => {
    const n = g.nx * g.ny;
    const a = (v: number): Float32Array => new Float32Array(n).fill(v);
    const types = [FuelType.DryForestShrubby, FuelType.WetForest, FuelType.Heath, FuelType.Grassland, FuelType.PinePlantation, FuelType.Rainforest];
    const type = new Uint8Array(n);
    const cover = new Float32Array(n);
    const height = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      type[k] = types[Math.floor(rnd() * types.length)]!;
      cover[k] = type[k] === FuelType.Grassland ? 0 : 0.2 + 0.7 * rnd();
      height[k] = type[k] === FuelType.Heath || type[k] === FuelType.Grassland ? 1 : 12 + 20 * rnd();
    }
    return {
      grid: g,
      type,
      surfaceHazard: a(3),
      nearSurfaceHazard: a(2),
      nearSurfaceHeight: a(0.4),
      elevatedHazard: a(3),
      elevatedHeight: a(1.5),
      barkHazard: a(2),
      surfaceLoad: a(12),
      nearSurfaceLoad: a(4),
      elevatedLoad: a(5),
      barkLoad: a(2),
      canopyHeight: height,
      canopyCover: cover,
      curing: a(60),
      timeSinceFire: a(10),
      lastFireKind: new Uint8Array(n),
      sources: [],
    };
  };
  const digest = (v: VegInstances[]): string => v.map((s) => `${s.count}:${Array.from(s.position.slice(0, 60)).join(',')}`).join('|');
  const all = (v: VegInstances[]): { x: number; y: number }[] => v.flatMap((s) => Array.from({ length: s.count }, (_, i) => ({ x: s.position[i * 3]!, y: s.position[i * 3 + 1]! })));

  it('puts no plant at R of 0.5 or more, never more plants than without the mask, and is deterministic; an empty mask changes nothing', () => {
    const rnd = seeded(808);
    const g = flatGrid(50, 50, 30);
    const g10 = flatGrid(150, 150, 10);
    const heightAt = (x: number, y: number): number => 500 + 0.02 * x + 0.01 * y;
    for (let trial = 0; trial < 10; trial++) {
      const fuel = fuelOf(rnd, g);
      const r = new Uint8Array(g10.nx * g10.ny);
      const cx = 50 + 1400 * rnd();
      const cy = 50 + 1400 * rnd();
      const rad = 100 + 500 * rnd();
      for (let j = 0; j < g10.ny; j++) for (let i = 0; i < g10.nx; i++) r[j * g10.nx + i] = Math.round(255 * Math.min(1, Math.max(0, (rad - Math.hypot(i * 10 - cx, j * 10 - cy)) / 120)));
      const copy: RockCopy = { grid: g10, r };
      const opts = { budget: 6000 + Math.floor(rnd() * 20000), seed: 1 + trial, heightAt, focusRadius: 800 };
      const free = placeVegetation(fuel, opts);
      const masked = placeVegetation(fuel, { ...opts, rock: copy });
      const tag = `trial ${trial}`;
      expect(digest(placeVegetation(fuel, { ...opts, rock: copy })), `${tag}: deterministic`).toBe(digest(masked));
      for (const p of all(masked)) expect(sampleRock(copy, p.x, p.y), `${tag}: on rock`).toBeLessThan(0.5);
      expect(all(free).some((p) => sampleRock(copy, p.x, p.y) >= 0.5), `${tag}: without the mask there are plants on the rock`).toBe(true);
      for (let gi = 0; gi < free.length; gi++) expect(masked[gi]!.count, `${tag}: group ${gi}`).toBeLessThanOrEqual(free[gi]!.count);
      expect(totalInstances(masked)).toBeLessThan(totalInstances(free));
      expect(totalInstances(masked)).toBeLessThanOrEqual(opts.budget);
      expect(masked.every((s) => Array.from(s.position).every(Number.isFinite))).toBe(true);
      const none: RockCopy = { grid: g10, r: new Uint8Array(g10.nx * g10.ny) };
      expect(digest(placeVegetation(fuel, { ...opts, rock: none })), `${tag}: an empty mask`).toBe(digest(free));
      expect(digest(placeVegetation(fuel, { ...opts, rock: null })), `${tag}: no mask`).toBe(digest(free));
    }
  });
});

describe('input of the wrong size', () => {
  const g = flatGrid(30, 20, 10);
  const z = new Float32Array(30 * 20).fill(100);
  const slope = { grid: g, values: new Float32Array(30 * 20).fill(60) };

  it('is refused, not read past its end (a mesh height array given for the 10 m grid would otherwise give no rock and no error)', () => {
    const mesh = new Float32Array(15 * 10);
    expect(() => cliffSharpen(g, mesh)).toThrow(RangeError);
    expect(() => decimateTerrain(g, mesh, 10)).toThrow(RangeError);
    expect(() => buildRockMask({ grid: g, elevation: mesh, slope })).toThrow(RangeError);
    expect(() => buildRockMask({ grid: g, elevation: z, slope: { grid: g, values: mesh } })).toThrow(RangeError);
    expect(() => buildRockMask({ grid: g, elevation: z, slope, cover: { grid: g, values: mesh } })).toThrow(RangeError);
    expect(() => buildRockMask({ grid: g, elevation: z, slope, windowSlope: { grid: g, values: mesh } })).toThrow(RangeError);
    expect(() => buildRockMask({ grid: g, elevation: z, slope })).not.toThrow();
  });
});
