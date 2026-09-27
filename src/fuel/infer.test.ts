import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { FuelType, Landform } from '../core/types';
import { buildTerrain } from '../terrain';
import { plane, TEST_ORIGIN } from '../terrain/testing/synthetic';
import { inferCell, inferFuelTypes, southernAspect } from './infer';
import { FUEL_PARAMS } from './params';

const P = FUEL_PARAMS;
// inferCell(z, slope, aspect, landform, cliffFraction, h, c, P)
const withCanopy = (h: number, c: number, over: Partial<{ z: number; s: number; a: number; lf: Landform; cliff: number }> = {}): FuelType =>
  inferCell(over.z ?? 900, over.s ?? 10, over.a ?? NaN, over.lf ?? Landform.MidSlope, over.cliff ?? 0, h, c, P);
const noCanopy = (over: Partial<{ z: number; s: number; a: number; lf: Landform; cliff: number }> = {}): FuelType =>
  inferCell(over.z ?? 900, over.s ?? 10, over.a ?? NaN, over.lf ?? Landform.MidSlope, over.cliff ?? 0, NaN, NaN, P);

describe('inferFuelTypes (spec §4.3)', () => {
  it('rule 1: cliffs and very steep rock are NonFuel', () => {
    expect(withCanopy(20, 0.8, { cliff: 0.5 })).toBe(FuelType.NonFuel);
    expect(withCanopy(20, 0.8, { s: 55 })).toBe(FuelType.NonFuel);
    expect(noCanopy({ s: 60 })).toBe(FuelType.NonFuel);
    expect(withCanopy(20, 0.8, { cliff: 0.49, s: 54 })).toBe(FuelType.DryForestShrubby);
  });

  it('rule 2: canopy height / cover classes', () => {
    expect(withCanopy(1, 0.05)).toBe(FuelType.Grassland); // cleared land (median "Not classified" cell)
    expect(withCanopy(4, 0.1)).toBe(FuelType.GrassyWoodland);
    expect(withCanopy(2, 0.5)).toBe(FuelType.Heath);
    expect(withCanopy(2, 0.5, { z: 1600 })).toBe(FuelType.AlpineHeathGrass);
    expect(withCanopy(10, 0.3)).toBe(FuelType.GrassyWoodland);
    expect(withCanopy(10, 0.3, { z: 1600 })).toBe(FuelType.SnowGumWoodland);
    expect(withCanopy(18, 0.7, { z: 1600 })).toBe(FuelType.SnowGumWoodland);
    expect(withCanopy(18, 0.7)).toBe(FuelType.DryForestShrubby);
    expect(withCanopy(18, 0.7, { lf: Landform.Gully, a: 180 })).toBe(FuelType.WetForest);
    expect(withCanopy(18, 0.7, { lf: Landform.LowerSlope, a: 100 })).toBe(FuelType.WetForest);
    expect(withCanopy(12, 0.7, { lf: Landform.Gully, a: 180 })).toBe(FuelType.DryForestShrubby); // h < 15
    expect(withCanopy(18, 0.7, { lf: Landform.Gully, a: 0 })).toBe(FuelType.DryForestShrubby); // north-facing
    expect(withCanopy(18, 0.7, { lf: Landform.Gully, a: NaN })).toBe(FuelType.DryForestShrubby); // flat: false
    expect(withCanopy(18, 0.7, { lf: Landform.Ridge, a: 180 })).toBe(FuelType.DryForestShrubby);
  });

  it('rule 3: terrain only', () => {
    expect(noCanopy({ z: 1900 })).toBe(FuelType.AlpineHeathGrass);
    expect(noCanopy({ z: 1600 })).toBe(FuelType.SnowGumWoodland);
    expect(noCanopy({ lf: Landform.Gully, a: 200, s: 20 })).toBe(FuelType.WetForest);
    expect(noCanopy({ lf: Landform.ValleyFloor, a: 200, s: 5 })).toBe(FuelType.WetForest);
    expect(noCanopy({ lf: Landform.Gully, a: 200, s: 35 })).toBe(FuelType.DryForestShrubby);
    expect(noCanopy({ lf: Landform.LowerSlope, a: 200 })).toBe(FuelType.DryForestShrubby);
    expect(noCanopy()).toBe(FuelType.DryForestShrubby);
  });

  it('southern half: 90° < aspect < 270°, false on NaN', () => {
    expect(southernAspect(91)).toBe(true);
    expect(southernAspect(269)).toBe(true);
    expect(southernAspect(90)).toBe(false);
    expect(southernAspect(300)).toBe(false);
    expect(southernAspect(NaN)).toBe(false);
  });

  it('raster form: canopy valid mask, mask of cells to infer', () => {
    const g = makeGridSpec(TEST_ORIGIN, 300, 30);
    const t = buildTerrain(g, plane(g, 0, 0, 800), 'flat');
    const n = g.nx * g.ny;
    const height = new Float32Array(n).fill(1);
    const cover = new Float32Array(n).fill(0.05);
    const valid = new Uint8Array(n).fill(1);
    valid[5] = 0;
    const mask = new Uint8Array(n).fill(1);
    mask[7] = 0;
    const out = inferFuelTypes(t, { height, cover, valid }, mask);
    expect(out[0]).toBe(FuelType.Grassland);
    expect(out[5]).toBe(FuelType.DryForestShrubby); // canopy invalid → terrain rule
    expect(out[7]).toBe(FuelType.NonFuel); // not evaluated
    expect(inferFuelTypes(t, null)[0]).toBe(FuelType.DryForestShrubby);
  });
});
