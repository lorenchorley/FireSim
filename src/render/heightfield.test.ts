import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { gridBounds, gridTransform, localToWorld, normalFromGradient, sunDirectionWorld, worldToLocal } from './coords';
import { HeightField } from './heightfield';

const origin = { lat: -33.7, lon: 150.3 };
const g = makeGridSpec(origin, 4000, 20);

function field(fn: (x: number, y: number) => number): Float32Array {
  const z = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = fn(g.x0 + i * g.cellSize, g.y0 + j * g.cellSize);
  return z;
}

describe('HeightField', () => {
  it('interpolates planes exactly and clamps outside', () => {
    const hf = new HeightField(g, field((x, y) => 300 + 0.1 * x - 0.05 * y));
    expect(hf.heightAt(123.4, -56.7)).toBeCloseTo(300 + 12.34 + 2.835, 4);
    expect(hf.heightAt(1e6, 0)).toBeCloseTo(hf.heightAt(hf.xMax, 0), 4);
    expect(hf.minElevation).toBeLessThan(hf.maxElevation);
  });

  it('raycasts straight down onto the surface', () => {
    const hf = new HeightField(g, field((x, y) => 400 + 50 * Math.sin(x / 300) * Math.cos(y / 400)));
    const [wx, wy, wz] = localToWorld(250, -310, 5000, 1);
    const hit = hf.raycast(wx, wy, wz, 0, -1, 0)!;
    expect(hit.x).toBeCloseTo(250, 3);
    expect(hit.y).toBeCloseTo(-310, 3);
    expect(hit.z).toBeCloseTo(hf.heightAt(250, -310), 3);
  });

  it('raycasts obliquely and finds the first intersection (ridge occludes the valley)', () => {
    // A ridge along x = 0 (600 m high) between two flat valleys at 200 m.
    const hf = new HeightField(g, field((x) => 200 + 400 * Math.exp(-((x / 150) ** 2))));
    // Camera west of the ridge at 700 m ASL looking east, slightly down: the ray would reach the eastern valley
    // floor (200 m) at x = 1000 but must stop on the ridge's west face first.
    const hit = hf.raycast(-1500, 700, 0, 1, -0.2, 0)!;
    expect(hit).not.toBeNull();
    expect(hit.x).toBeLessThan(0);
    const h = hf.heightAt(hit.x, hit.y);
    expect(700 - 0.2 * (hit.x + 1500)).toBeCloseTo(h, 1);
  });

  it('respects vertical exaggeration', () => {
    const hf = new HeightField(g, field(() => 500), 2);
    const hit = hf.raycast(0, 5000, 0, 0.3, -1, 0)!;
    // Ground at world y = 1000; ray drops 4000 → horizontal travel 1200.
    expect(hit.x).toBeCloseTo(1200, 1);
    expect(hf.worldHeightAt(0, 0)).toBe(1000);
  });

  it('misses when pointing at the sky or outside the domain', () => {
    const hf = new HeightField(g, field(() => 500));
    expect(hf.raycast(0, 1000, 0, 0, 1, 0)).toBeNull();
    expect(hf.raycast(1e5, 1000, 0, 0, -1, 0)).toBeNull();
  });

  it('decimation keeps the last row/column', () => {
    const d = HeightField.decimation(901, 901, 400);
    expect(d.stride).toBe(3);
    expect(d.is[d.is.length - 1]).toBe(900);
  });
});

describe('coords', () => {
  it('maps local to world Y-up with north = −z and round-trips', () => {
    expect(localToWorld(10, 20, 100, 1.5)).toEqual([10, 150, -20]);
    const [x, y, z] = worldToLocal(10, 150, -20, 1.5);
    expect([x, y, z]).toEqual([10, 20, 100]);
  });

  it('grid transform maps cell centres to texel centres', () => {
    const [ox, oy, sx, sy] = gridTransform(g);
    const u = (g.x0 - ox) / sx;
    const v = (g.y0 + (g.ny - 1) * g.cellSize - oy) / sy;
    expect(u).toBeCloseTo(0.5 / g.nx, 9);
    expect(v).toBeCloseTo(1 - 0.5 / g.ny, 9);
    const b = gridBounds(g);
    expect(b.xMax - b.xMin).toBeCloseTo((g.nx - 1) * g.cellSize, 6);
  });

  it('sun direction: north is −z, east is +x, zenith is +y', () => {
    const n = sunDirectionWorld(0, 0);
    expect(n[2]).toBeCloseTo(-1, 9);
    const e = sunDirectionWorld(90, 0);
    expect(e[0]).toBeCloseTo(1, 9);
    expect(sunDirectionWorld(123, 90)[1]).toBeCloseTo(1, 9);
  });

  it('normals tilt away from uphill', () => {
    // z rises to the east → normal points west (−x).
    const nrm = normalFromGradient(0.5, 0, 1);
    expect(nrm[0]).toBeLessThan(0);
    // z rises to the north → normal points south (+z in world).
    expect(normalFromGradient(0, 0.5, 1)[2]).toBeGreaterThan(0);
  });
});
