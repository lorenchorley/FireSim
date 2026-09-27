/**
 * Coordinate conventions of the 3-D scene.
 *
 * Simulation data lives in LOCAL metres (x east, y north, z metres above sea level). The Three.js world is Y-up:
 *
 *   world.x =  local x                         (east)
 *   world.y =  z (m ASL) · verticalExaggeration
 *   world.z = −local y                         (north is −z)
 *
 * Every custom shader receives geometry in local coordinates (or world-with-unexaggerated-height) and applies the
 * same mapping with a shared `uVex` uniform, so changing the vertical exaggeration costs one uniform write.
 */
import type { GridSpec } from '../core/grid';
import { DEG } from '../core/units';

export type Vec3 = [number, number, number];

/** Local (x east, y north, z ASL) → world (Y-up). */
export function localToWorld(x: number, y: number, zAsl: number, vex: number, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = x;
  out[1] = zAsl * vex;
  out[2] = -y;
  return out;
}

/** World (Y-up) → local (x east, y north, z ASL). */
export function worldToLocal(wx: number, wy: number, wz: number, vex: number, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = wx;
  out[1] = -wz;
  out[2] = vex !== 0 ? wy / vex : wy;
  return out;
}

/**
 * Transform used by shaders to turn a local (x, y) into texture coordinates of a grid-aligned DataTexture:
 * [originX, originY, sizeX, sizeY] where the origin is the south-west EDGE of cell (0, 0) and the size is the full
 * extent. uv = (p − origin) / size maps cell (i, j) centre to ((i + ½)/nx, (j + ½)/ny); texture row 0 = j 0 = south.
 */
export function gridTransform(g: GridSpec): [number, number, number, number] {
  return [g.x0 - g.cellSize / 2, g.y0 - g.cellSize / 2, g.nx * g.cellSize, g.ny * g.cellSize];
}

/** Local extents of a grid measured between the outer cell centres (the area the terrain mesh covers). */
export function gridBounds(g: GridSpec): { xMin: number; xMax: number; yMin: number; yMax: number } {
  return { xMin: g.x0, xMax: g.x0 + (g.nx - 1) * g.cellSize, yMin: g.y0, yMax: g.y0 + (g.ny - 1) * g.cellSize };
}

/**
 * World-space unit vector pointing TOWARDS the sun, from a compass azimuth (deg, clockwise from north) and elevation
 * above the horizon (deg).
 */
export function sunDirectionWorld(azimuthDeg: number, elevationDeg: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const a = azimuthDeg * DEG;
  const e = elevationDeg * DEG;
  out[0] = Math.sin(a) * Math.cos(e);
  out[1] = Math.sin(e);
  out[2] = -Math.cos(a) * Math.cos(e);
  return out;
}

/** Terrain surface normal in world space from local gradients (dz/dx east, dz/dy north) and vertical exaggeration. */
export function normalFromGradient(dzdx: number, dzdy: number, vex: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const nx = -vex * dzdx;
  const ny = 1;
  const nz = vex * dzdy;
  const l = Math.hypot(nx, ny, nz);
  out[0] = nx / l;
  out[1] = ny / l;
  out[2] = nz / l;
  return out;
}
