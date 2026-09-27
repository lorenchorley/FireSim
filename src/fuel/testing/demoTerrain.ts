/**
 * Test / dev helper: a demo site's fire-grid Terrain from its bundled 10 m LiDAR DEM, the way spec §11.6 builds it
 * (block-average b×b 10 m cells to the fire cell, `buildTerrain` on the fire grid, `slopeP90Deg` and `cliffFraction`
 * from the 10 m sub-cells). scenario/ owns the production version; this one exists so fuel/ tests run on real
 * terrain without depending on scenario/. Results are memoised per (site, cell size).
 */
import { makeGridSpec, type GridSpec } from '../../core/grid';
import type { Terrain } from '../../core/types';
import { RAD } from '../../core/units';
import { loadDemoDem } from '../../data';
import { buildTerrain } from '../../terrain';

const cache = new Map<string, Promise<Terrain | null>>();

/** Fire-grid terrain of a demo site (cellSize a multiple of the 10 m DEM cell), or null if the site has no DEM. */
export function loadDemoFireTerrain(siteId: string, cellSize = 30): Promise<Terrain | null> {
  const key = `${siteId}@${cellSize}`;
  let p = cache.get(key);
  if (!p) {
    p = build(siteId, cellSize);
    cache.set(key, p);
  }
  return p;
}

async function build(siteId: string, cellSize: number): Promise<Terrain | null> {
  const dem = await loadDemoDem(siteId);
  if (!dem) return null;
  const src = dem.grid;
  const b = Math.round(cellSize / src.cellSize);
  if (b < 1 || Math.abs(b * src.cellSize - cellSize) > 1e-6) throw new Error(`cellSize ${cellSize} is not a multiple of ${src.cellSize}`);
  const extent = src.nx * src.cellSize;
  const grid: GridSpec = makeGridSpec(src.origin, extent, cellSize);
  const { nx, ny } = grid;
  const z = new Float32Array(nx * ny);
  const p90 = new Float32Array(nx * ny);
  const cliff = new Float32Array(nx * ny);
  const slope10 = slopeDeg(src, dem.elevation);
  const vals = new Float32Array(b * b);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      let c = 0;
      let nc = 0;
      for (let bj = 0; bj < b; bj++) {
        for (let bi = 0; bi < b; bi++) {
          const kk = (j * b + bj) * src.nx + i * b + bi;
          s += dem.elevation[kk]!;
          const sl = slope10[kk]!;
          vals[c++] = sl;
          if (sl > 60) nc++;
        }
      }
      const k = j * nx + i;
      z[k] = s / (b * b);
      vals.sort();
      p90[k] = vals[Math.min(b * b - 1, Math.floor(0.9 * (b * b - 1) + 0.5))]!;
      cliff[k] = nc / (b * b);
    }
  }
  const t = buildTerrain(grid, z, `${dem.meta.source} (block-averaged to ${cellSize} m)`);
  t.slopeP90Deg = p90;
  t.cliffFraction = cliff;
  return t;
}

function slopeDeg(g: GridSpec, z: Float32Array): Float32Array {
  const { nx, ny, cellSize: h } = g;
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const il = i > 0 ? k - 1 : k;
      const ir = i < nx - 1 ? k + 1 : k;
      const jd = j > 0 ? k - nx : k;
      const ju = j < ny - 1 ? k + nx : k;
      const dx = (z[ir]! - z[il]!) / (h * (ir - il));
      const dy = (z[ju]! - z[jd]!) / (h * ((ju - jd) / nx));
      out[k] = Math.atan(Math.hypot(dx, dy)) * RAD;
    }
  }
  return out;
}
