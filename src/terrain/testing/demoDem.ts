/**
 * Test-only helper (Node): loads a bundled demo site's Terrarium tiles from public/demo/<id>/ and resamples them
 * onto a local grid. It deliberately does not depend on src/data so that terrain tests are self-contained.
 * Not imported by application code.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decode } from 'fast-png';
import { LocalProjection, lonLatToTileFrac, type LatLon } from '../../core/geo';
import { makeGridSpec, type GridSpec } from '../../core/grid';

const DEMO_ROOT = fileURLToPath(new URL('../../../public/demo/', import.meta.url));

export function demoAvailable(id: string): boolean {
  return existsSync(`${DEMO_ROOT}${id}/manifest.json`);
}

export function loadDemoDem(id: string, centre: LatLon, extentM: number, cellSize: number): { grid: GridSpec; elevation: Float32Array } {
  const manifest = JSON.parse(readFileSync(`${DEMO_ROOT}${id}/manifest.json`, 'utf8')) as { zoom: number; tiles: [number, number][] };
  const z = manifest.zoom;
  const tiles = new Map<string, Float32Array>();
  for (const [tx, ty] of manifest.tiles) {
    const png = decode(readFileSync(`${DEMO_ROOT}${id}/terrarium/${z}/${tx}/${ty}.png`));
    const ch = png.channels;
    const px = png.data as Uint8Array;
    const e = new Float32Array(png.width * png.height);
    for (let p = 0; p < e.length; p++) e[p] = px[p * ch]! * 256 + px[p * ch + 1]! + px[p * ch + 2]! / 256 - 32768;
    tiles.set(`${tx}/${ty}`, e);
  }
  const at = (gx: number, gy: number): number => {
    const tx = Math.floor(gx / 256);
    const ty = Math.floor(gy / 256);
    const t = tiles.get(`${tx}/${ty}`);
    if (!t) return NaN;
    return t[(gy - ty * 256) * 256 + (gx - tx * 256)]!;
  };
  const grid = makeGridSpec(centre, extentM, cellSize);
  const proj = new LocalProjection(centre);
  const out = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const ll = proj.toLatLon(grid.x0 + i * cellSize, grid.y0 + j * cellSize);
      const [fx, fy] = lonLatToTileFrac(ll.lat, ll.lon, z);
      const px = fx * 256 - 0.5;
      const py = fy * 256 - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const tx = px - x0;
      const ty = py - y0;
      out[j * grid.nx + i] =
        (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    }
  }
  return { grid, elevation: out };
}
