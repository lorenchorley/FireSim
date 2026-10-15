/**
 * Smoke puffs from an atmosphere view in either layout (plan section 7.2): the one place that read the 3-D arrays directly
 * now asks `cellHeightAsl` for where a cell is, and `airHas` before it reads an array.
 */
import { describe, expect, it } from 'vitest';
import { cellHeightAsl } from '../core/airView';
import { makeGridSpec } from '../core/grid';
import type { AtmosphereView } from '../core/types';
import { puffsFromAtmosphere } from './smokeLayer';

const grid = makeGridSpec({ lat: -33.7, lon: 150.3 }, 800, 100); // 8 x 8 columns
const plane = grid.nx * grid.ny;
const NZ = 5;
const HILL = 3 + 3 * grid.nx; // a column on a 400 m hill
const FLAT = 6 + 6 * grid.nx; // a column on the datum

/** Smoke at level 2 of two columns only; everything else empty. There is one puff per smoky cell at most, so two puffs. */
function view(extra: Partial<AtmosphereView> = {}): AtmosphereView {
  const smoke = new Float32Array(plane * NZ);
  smoke[2 * plane + HILL] = 8;
  smoke[2 * plane + FLAT] = 8;
  const terrainHeight = new Float32Array(plane);
  terrainHeight[HILL] = 400;
  return {
    grid,
    nz: NZ,
    levels: Float32Array.from([10, 30, 70, 150, 310]),
    terrainHeight,
    surfaceU: new Float32Array(plane),
    surfaceV: new Float32Array(plane),
    u: new Float32Array(plane * NZ),
    v: new Float32Array(plane * NZ),
    w: new Float32Array(plane * NZ),
    thetaAnomaly: new Float32Array(plane * NZ).fill(3),
    smoke,
    ...extra,
  };
}

const columnOf = (p: { x: number; y: number }): number => Math.round((p.x - grid.x0) / grid.cellSize) + Math.round((p.y - grid.y0) / grid.cellSize) * grid.nx;

describe('puffsFromAtmosphere', () => {
  it('flat layout: a puff sits at the datum plus the level height, in every column', () => {
    const puffs = puffsFromAtmosphere(view(), 200, 2000, 5);
    expect(puffs.length).toBe(2);
    for (const p of puffs) {
      expect(p.z).toBeGreaterThan(200 + 70 - 0.2 * 140 - 1);
      expect(p.z).toBeLessThan(200 + 70 + 0.2 * 140 + 1);
    }
  });

  it('terrain-following layout: the puffs of a column over a 400 m hill stand 400 m (times J) higher than over the datum', () => {
    const tf = view({ layout: 'terrain-following', kind: 'prognostic', topM: 3000, baseM: 200 });
    const puffs = puffsFromAtmosphere(tf, 200, 2000, 5);
    const hill = puffs.filter((p) => columnOf(p) === HILL);
    const low = puffs.filter((p) => columnOf(p) === FLAT);
    expect(puffs.length).toBe(2);
    expect(hill.length).toBe(1);
    expect(low.length).toBe(1);
    const dzHill = cellHeightAsl(tf, HILL, 3, 200) - cellHeightAsl(tf, HILL, 1, 200);
    for (const p of hill) expect(Math.abs(p.z - cellHeightAsl(tf, HILL, 2, 200))).toBeLessThanOrEqual(0.2 * dzHill + 1e-6);
    const dzLow = cellHeightAsl(tf, FLAT, 3, 200) - cellHeightAsl(tf, FLAT, 1, 200);
    for (const p of low) expect(Math.abs(p.z - cellHeightAsl(tf, FLAT, 2, 200))).toBeLessThanOrEqual(0.2 * dzLow + 1e-6);
    // Level 2 is 70 m above the ground in both columns, so the hill's puffs are about 400 + 70 x (1 - 400 / 3000) above the datum.
    const mean = (a: { z: number }[]): number => a.reduce((s, p) => s + p.z, 0) / a.length;
    expect(mean(hill) - mean(low)).toBeGreaterThan(400 - 70 * (400 / 3000) - 30);
    expect(mean(hill) - mean(low)).toBeLessThan(400 + 30);
  });

  it('uses the view’s own datum, not the caller’s estimate, when it has one', () => {
    const tf = view({ layout: 'terrain-following', kind: 'prognostic', topM: 3000, baseM: 250 });
    const a = puffsFromAtmosphere(tf, 250, 2000, 5);
    const b = puffsFromAtmosphere(tf, 250, 2000, 5);
    expect(a).toEqual(b); // deterministic
    const lowest = a.filter((p) => columnOf(p) === FLAT).map((p) => p.z);
    expect(Math.min(...lowest)).toBeGreaterThan(250 + 70 - 0.2 * 140 - 1);
  });

  it('the fast tier’s diagnosed view has no smoke array: no puffs, no NaN, no throw', () => {
    const diag = view({ layout: 'terrain-following', kind: 'diagnosed', topM: 3000, baseM: 200, smoke: new Float32Array(0), thetaAnomaly: new Float32Array(0) });
    expect(puffsFromAtmosphere(diag, 200, 2000, 5)).toEqual([]);
  });

  it('a view with smoke but no temperature array still draws, without heat', () => {
    const noTheta = view({ thetaAnomaly: new Float32Array(0) });
    const puffs = puffsFromAtmosphere(noTheta, 200, 2000, 5);
    expect(puffs.length).toBe(2);
    for (const p of puffs) expect(p.heat).toBe(0);
    for (const p of puffsFromAtmosphere(view(), 200, 2000, 5)) expect(p.heat).toBe(0.5); // 3 K of anomaly of the 6 K scale
  });
});
