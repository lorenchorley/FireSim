/**
 * The rock mask (plan 9d.3.4; pure, no Three.js, no DOM): one RGBA8 raster on the 10 m terrain's grid that the terrain
 * shader reads for rock detail, and the CPU copy of its R channel that tree placement reads.
 *
 *   R  bare steep rock: smoothstep(52, 62, slope) x (1 - canopy cover)
 *   G  scree: a slope window of 22 to 40 degrees x rock within 80 m uphill (up the cell's own fall line, ending at a crest)
 *   B  lip pavement: slope under 15 degrees x rock within 40 m (rock that lies below the cell: the top of a face, not its foot)
 *   A  255
 *
 * The caller says which slope to classify with. Spike S5 found that a slope taken from the 10 m terrain disagrees with a 22 or
 * 40 m render triangle by up to one vertex spacing, and a switch drawn on that disagreement shows as spikes along the lip and
 * foot of a face. So for drawing, pass the render mesh's own slope (`hornSlopeDeg` of the mesh's grid and heights, which is
 * resampled to the raster's grid here) and, if the band is too wide from above, tune `loDeg` and `hiDeg`; the 52 to 62 default is
 * for a 10 m slope. {@link hornSlopeDeg} (cliffSharpen.ts) gives the 10 m slope of a terrain when that is wanted instead.
 */
import { sampleBilinear, type GridSpec } from '../core/grid';
import { smoothstep } from '../core/units';
import { hornSlopeDeg } from './cliffSharpen';

/** A scalar field on its own regular grid (j = 0 south), resampled bilinearly onto the raster's grid. */
export interface RockField {
  grid: GridSpec;
  values: ArrayLike<number>;
}

export interface RockMaskInput {
  /** The raster's grid: the 10 m terrain's. */
  grid: GridSpec;
  /**
   * Heights on `grid` that the picture is drawn from (the sharpened terrain). Only their fall line (uphill for scree) and their
   * order (the lip is higher than the rock below it) are used, never their size.
   */
  elevation: ArrayLike<number>;
  /** Slope in degrees, on any grid. The caller chooses which slope the rock follows (see the file header). */
  slope: RockField;
  /** Canopy cover (0 to 1) on any grid, normally the fuel map's; absent means no cover. */
  cover?: RockField | null;
  /**
   * The slope the scree and pavement windows use. Absent means the 10 m slope of `elevation` on `grid` (Horn, as `hornSlopeDeg`),
   * not `slope`: the render mesh's slope is smoothed over about three vertices (45 m at High), so with it the flat ground that
   * counts as pavement starts about 20 m from the lip and almost no pavement is found (verifier: 70 cells against 2311 at
   * Katoomba). Pass a field to override.
   */
  windowSlope?: RockField | null;
}

export interface RockMaskOptions {
  /** R: slope (deg) where bare rock starts and where it is complete. */
  loDeg: number;
  hiDeg: number;
  /** G: the scree slope window (deg), plateau between `screeLoDeg` and `screeHiDeg` and a ramp of `screeEdgeDeg` outside it. */
  screeLoDeg: number;
  screeHiDeg: number;
  screeEdgeDeg: number;
  /** G: how far uphill (m) rock counts. */
  screeReachM: number;
  /** B: slope (deg) below which ground is pavement, the ramp of `lipEdgeDeg` below it, and how far (m) rock counts. */
  lipMaxDeg: number;
  lipEdgeDeg: number;
  lipReachM: number;
}

/** The plan's numbers; the ramps outside the scree window and under the lip limit are mine (the plan gives the limits). */
export const ROCK_MASK_DEFAULTS: Readonly<RockMaskOptions> = Object.freeze({
  loDeg: 52,
  hiDeg: 62,
  screeLoDeg: 22,
  screeHiDeg: 40,
  screeEdgeDeg: 4,
  screeReachM: 80,
  lipMaxDeg: 15,
  lipEdgeDeg: 4,
  lipReachM: 40,
});

export interface RockMaskStats {
  /** Cells with R at 0.5 or more (what trees avoid), cells with G at 0.5 or more, cells with B at 0.5 or more. */
  rockCells: number;
  screeCells: number;
  lipCells: number;
  /** Wall milliseconds of the build. */
  ms: number;
}

export interface RockMask {
  grid: GridSpec;
  /** RGBA8, 4 bytes per cell in the grid's order (row 0 = south), the order `rgbaTexture` (textures.ts) takes for the other grid textures. */
  rgba: Uint8Array;
  stats: RockMaskStats;
}

/** The CPU copy of R, for tree placement ({@link sampleRock}). */
export interface RockCopy {
  grid: GridSpec;
  /** R x 255, one byte per cell. */
  r: Uint8Array;
}

/** Rock below this R (of 255) is ignored when looking for rock near a cell. */
const R_MIN_BYTE = 6;
/** A ray up a slope ends when the ground has fallen this far (m) below the highest point it has passed. */
const CREST_DROP_M = 2;
/** Cells per side of a block of the "is there rock near here" gate. */
const GATE = 3;

interface Axis {
  /** Source cell at or below each destination position (clamped so that it and the next one exist), and the fraction beyond it. */
  i0: Int32Array;
  t: Float64Array;
}

/** The bilinear position of every cell of a destination axis on a source axis (clamped at the edge, as `sampleBilinear` does). */
function axisOf(n: number, x0: number, cell: number, dn: number, dx0: number, dcell: number): Axis {
  const i0 = new Int32Array(dn);
  const t = new Float64Array(dn);
  for (let a = 0; a < dn; a++) {
    let f = (dx0 + a * dcell - x0) / cell;
    f = f < 0 ? 0 : f > n - 1 ? n - 1 : f;
    const b = Math.min(Math.floor(f), n - 2);
    i0[a] = b;
    t[a] = f - b;
  }
  return { i0, t };
}

const sameGrid = (a: GridSpec, b: GridSpec): boolean => a.nx === b.nx && a.ny === b.ny && a.cellSize === b.cellSize && a.x0 === b.x0 && a.y0 === b.y0;

/**
 * A sampler of a field on the grid `to`: bilinear, with the per-axis index and weight worked out once, and a plain read when
 * the field is already on `to`. Fields are at least 2 x 2.
 */
function sampler(field: RockField, to: GridSpec): (i: number, j: number) => number {
  const src = field.grid;
  const v = field.values;
  if (sameGrid(src, to)) return (i, j) => v[j * to.nx + i]!;
  const ax = axisOf(src.nx, src.x0, src.cellSize, to.nx, to.x0, to.cellSize);
  const ay = axisOf(src.ny, src.y0, src.cellSize, to.ny, to.y0, to.cellSize);
  const sn = src.nx;
  return (i, j) => {
    const k = ay.i0[j]! * sn + ax.i0[i]!;
    const tx = ax.t[i]!;
    const ty = ay.t[j]!;
    return (v[k]! * (1 - tx) + v[k + 1]! * tx) * (1 - ty) + (v[k + sn]! * (1 - tx) + v[k + sn + 1]! * tx) * ty;
  };
}

/** Weight (1 to 0) of rock at distance `d` (m) for a reach of `reach` m: full out to half the reach, gone one cell past it. */
const reachFade = (d: number, reach: number, cell: number): number => 1 - smoothstep(0.5 * reach, reach + cell, d);

/**
 * Build the rock mask (see the file header). Only the neighbourhood of rock is visited after the first pass, so a scenario
 * with little rock costs little. A cell with no slope (NaN) is no rock, no scree and no pavement.
 */
export function buildRockMask(input: RockMaskInput, opts: Partial<RockMaskOptions> = {}): RockMask {
  const o: RockMaskOptions = { ...ROCK_MASK_DEFAULTS, ...opts };
  const t0 = performance.now();
  const { grid, elevation: z } = input;
  const { nx, ny, cellSize: h } = grid;
  const n = nx * ny;
  // A field of the wrong size would be read past its end and give no rock, scree or pavement without a word.
  if (z.length !== n) throw new RangeError(`buildRockMask: ${z.length} heights for a ${nx} x ${ny} grid`);
  for (const [name, f] of [['slope', input.slope], ['cover', input.cover], ['windowSlope', input.windowSlope]] as const) {
    if (f && f.values.length !== f.grid.nx * f.grid.ny) throw new RangeError(`buildRockMask: ${name} has ${f.values.length} values for a ${f.grid.nx} x ${f.grid.ny} grid`);
  }
  const rgba = new Uint8Array(n * 4);
  for (let p = 3; p < rgba.length; p += 4) rgba[p] = 255;
  const r = new Uint8Array(n);
  const bnx = Math.ceil(nx / GATE);
  const bny = Math.ceil(ny / GATE);
  const has = new Uint8Array(bnx * bny);
  const coverAt = input.cover ? sampler(input.cover, grid) : null;
  let rockCells = 0;
  let screeCells = 0;
  let lipCells = 0;
  let rockSeen = false;

  // R, from the slope, at the cells that are steep enough to have any: the rest of the raster is left at zero.
  const putR = (i: number, j: number, s: number): void => {
    const c = coverAt ? Math.min(1, Math.max(0, coverAt(i, j))) : 0;
    const v = Math.round(255 * smoothstep(o.loDeg, o.hiDeg, s) * (1 - c));
    if (v === 0) return;
    const k = j * nx + i;
    r[k] = v;
    rgba[k * 4] = v;
    if (v >= 128) rockCells++;
    if (v >= R_MIN_BYTE) {
      has[Math.floor(j / GATE) * bnx + Math.floor(i / GATE)] = 1;
      rockSeen = true;
    }
  };
  const sv = input.slope.values;
  const sg = input.slope.grid;
  if (sameGrid(sg, grid)) {
    for (let k = 0; k < n; k++) {
      const s = sv[k]!;
      if (s > o.loDeg) putR(k % nx, (k / nx) | 0, s);
    }
  } else {
    // The slope is on another grid: walk its cells, skip every quad with no corner over the limit, and sample the cells of the
    // raster that lie inside the others (each raster cell lies in exactly one quad).
    const ax = axisOf(sg.nx, sg.x0, sg.cellSize, nx, grid.x0, grid.cellSize);
    const ay = axisOf(sg.ny, sg.y0, sg.cellSize, ny, grid.y0, grid.cellSize);
    const colFrom = new Int32Array(sg.nx).fill(nx);
    const colTo = new Int32Array(sg.nx);
    const rowFrom = new Int32Array(sg.ny).fill(ny);
    const rowTo = new Int32Array(sg.ny);
    for (let i = 0; i < nx; i++) {
      const a = ax.i0[i]!;
      if (i < colFrom[a]!) colFrom[a] = i;
      colTo[a] = i + 1;
    }
    for (let j = 0; j < ny; j++) {
      const b = ay.i0[j]!;
      if (j < rowFrom[b]!) rowFrom[b] = j;
      rowTo[b] = j + 1;
    }
    const sn = sg.nx;
    for (let b = 0; b < sg.ny - 1; b++) {
      for (let a = 0; a < sn - 1; a++) {
        const q = b * sn + a;
        const v00 = sv[q]!;
        const v10 = sv[q + 1]!;
        const v01 = sv[q + sn]!;
        const v11 = sv[q + sn + 1]!;
        if (!(v00 > o.loDeg || v10 > o.loDeg || v01 > o.loDeg || v11 > o.loDeg)) continue;
        for (let j = rowFrom[b]!; j < rowTo[b]!; j++) {
          const ty = ay.t[j]!;
          for (let i = colFrom[a]!; i < colTo[a]!; i++) {
            const tx = ax.t[i]!;
            const s = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
            if (s > o.loDeg) putR(i, j, s);
          }
        }
      }
    }
  }

  if (rockSeen) {
    const steps = Math.max(1, Math.round(o.screeReachM / h));
    const tb = Math.max(1, Math.round(o.lipReachM / h));

    // Blocks that hold rock, grown by as many blocks as the longest reach plus a cell: scree and pavement are only looked for there.
    const rad = Math.ceil((Math.max(steps, tb) + 1) / GATE);
    const wide = new Uint8Array(bnx * bny);
    const near = new Uint8Array(bnx * bny);
    for (let bj = 0; bj < bny; bj++)
      for (let bi = 0; bi < bnx; bi++) {
        if (!has[bj * bnx + bi]) continue;
        for (let d = Math.max(0, bi - rad); d <= Math.min(bnx - 1, bi + rad); d++) wide[bj * bnx + d] = 1;
      }
    for (let bj = 0; bj < bny; bj++)
      for (let bi = 0; bi < bnx; bi++) {
        if (!wide[bj * bnx + bi]) continue;
        for (let d = Math.max(0, bj - rad); d <= Math.min(bny - 1, bj + rad); d++) near[d * bnx + bi] = 1;
      }

    // B, first half: the rock cells give the ground within reach that lies above them a share of their R.
    const offI: number[] = [];
    const offJ: number[] = [];
    const offK: number[] = [];
    const offW: number[] = [];
    for (let dj = -tb; dj <= tb; dj++)
      for (let di = -tb; di <= tb; di++) {
        const d = Math.hypot(di, dj) * h;
        if (d > o.lipReachM + 1e-6) continue;
        offI.push(di);
        offJ.push(dj);
        offK.push(dj * nx + di);
        offW.push(reachFade(d, o.lipReachM, h));
      }
    const lip = new Uint8Array(n);
    for (let bj = 0; bj < bny; bj++) {
      for (let bi = 0; bi < bnx; bi++) {
        if (!has[bj * bnx + bi]) continue;
        const j1 = Math.min(ny, (bj + 1) * GATE);
        const i1 = Math.min(nx, (bi + 1) * GATE);
        for (let j = bj * GATE; j < j1; j++) {
          for (let i = bi * GATE; i < i1; i++) {
            const k = j * nx + i;
            const rv = r[k]!;
            if (rv < R_MIN_BYTE) continue;
            const zr = z[k]!;
            const inside = i >= tb && i < nx - tb && j >= tb && j < ny - tb;
            for (let t = 0; t < offI.length; t++) {
              if (!inside) {
                const ii = i + offI[t]!;
                const jj = j + offJ[t]!;
                if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
              }
              const kk = k + offK[t]!;
              const v = (rv * offW[t]! + 0.5) | 0;
              if (v > lip[kk]! && zr <= z[kk]!) lip[kk] = v;
            }
          }
        }
      }
    }

    // G, and the rest of B, in the blocks near rock: the slope windows, then the ray up the fall line for scree.
    const windowAt = sampler(input.windowSlope ?? { grid, values: hornSlopeDeg(grid, input.elevation) }, grid);
    const screeFrom = o.screeLoDeg - o.screeEdgeDeg;
    const screeTo = o.screeHiDeg + o.screeEdgeDeg;
    const lipFrom = o.lipMaxDeg - o.lipEdgeDeg;
    const fade = new Float32Array(steps + 1);
    for (let t = 1; t <= steps; t++) fade[t] = reachFade(t * h, o.screeReachM, h);
    const inv8h = 1 / (8 * h);
    const mx1 = nx - 1;
    const my1 = ny - 1;
    for (let bj = 0; bj < bny; bj++) {
      for (let bi = 0; bi < bnx; bi++) {
        if (!near[bj * bnx + bi]) continue;
        const j1 = Math.min(ny, (bj + 1) * GATE);
        const i1 = Math.min(nx, (bi + 1) * GATE);
        for (let j = bj * GATE; j < j1; j++) {
          for (let i = bi * GATE; i < i1; i++) {
            const k = j * nx + i;
            const s = windowAt(i, j);
            if (s < o.lipMaxDeg) {
              if (lip[k]! > 0) {
                const bv = Math.round(lip[k]! * (1 - smoothstep(lipFrom, o.lipMaxDeg, s)));
                if (bv > 0) {
                  rgba[k * 4 + 2] = bv;
                  if (bv >= 128) lipCells++;
                }
              }
              continue;
            }
            if (!(s > screeFrom && s < screeTo) || i === 0 || j === 0 || i === mx1 || j === my1) continue;
            const win = smoothstep(screeFrom, o.screeLoDeg, s) * (1 - smoothstep(o.screeHiDeg, screeTo, s));
            if (!(win > 0)) continue;
            const n0 = k + nx;
            const s0 = k - nx;
            const gx = (z[n0 + 1]! + 2 * z[k + 1]! + z[s0 + 1]! - (z[n0 - 1]! + 2 * z[k - 1]! + z[s0 - 1]!)) * inv8h;
            const gy = (z[n0 - 1]! + 2 * z[n0]! + z[n0 + 1]! - (z[s0 - 1]! + 2 * z[s0]! + z[s0 + 1]!)) * inv8h;
            const gn = Math.hypot(gx, gy);
            if (!(gn > 1e-6)) continue;
            const ux = gx / gn;
            const uy = gy / gn;
            let zTop = z[k]!;
            let best = 0;
            for (let t = 1; t <= steps && best < 255; t++) {
              let fx = i + t * ux;
              let fy = j + t * uy;
              fx = fx < 0 ? 0 : fx > mx1 ? mx1 : fx;
              fy = fy < 0 ? 0 : fy > my1 ? my1 : fy;
              // The ray is up the fall line: it stops where the ground falls away (a crest), so rock beyond a crest is not uphill.
              const zi = z[((fy + 0.5) | 0) * nx + ((fx + 0.5) | 0)]!;
              if (!(zi >= zTop - CREST_DROP_M)) break;
              if (zi > zTop) zTop = zi;
              let i0 = fx | 0;
              let j0 = fy | 0;
              if (i0 > nx - 2) i0 = nx - 2;
              if (j0 > ny - 2) j0 = ny - 2;
              const tx = fx - i0;
              const ty = fy - j0;
              const q = j0 * nx + i0;
              const rv = (r[q]! * (1 - tx) + r[q + 1]! * tx) * (1 - ty) + (r[q + nx]! * (1 - tx) + r[q + nx + 1]! * tx) * ty;
              const v = rv * fade[t]!;
              if (v > best) best = v;
            }
            const gv = Math.round(best * win);
            if (gv > 0) {
              rgba[k * 4 + 1] = gv;
              if (gv >= 128) screeCells++;
            }
          }
        }
      }
    }
  }
  return { grid, rgba, stats: { rockCells, screeCells, lipCells, ms: performance.now() - t0 } };
}

/** The CPU copy of R (a fresh array, so the raster can go to the GPU and be dropped). */
export function rockCopy(mask: RockMask): RockCopy {
  const n = mask.grid.nx * mask.grid.ny;
  const r = new Uint8Array(n);
  for (let k = 0, p = 0; k < n; k++, p += 4) r[k] = mask.rgba[p]!;
  return { grid: mask.grid, r };
}

/** R (0 to 1) at a local point, bilinear and clamped at the edge. */
export function sampleRock(copy: RockCopy, x: number, y: number): number {
  return sampleBilinear(copy.grid, copy.r, x, y) / 255;
}
