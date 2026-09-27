import { describe, expect, it } from 'vitest';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { FuelType, type FuelMap } from '../core/types';
import { MAX_VEG_INSTANCES, VegGroup, placeVegetation, splitBudget, totalInstances } from './vegetationPlacement';

const origin = { lat: -33.7, lon: 150.3 };

function forest(g: GridSpec): FuelMap {
  const n = g.nx * g.ny;
  const a = (v: number): Float32Array => new Float32Array(n).fill(v);
  const type = new Uint8Array(n);
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      // West third heath, middle dry forest, a rainforest gully strip, east grassland, one water column.
      type[k] = i < g.nx / 3 ? FuelType.Heath : i < (2 * g.nx) / 3 ? (j % 20 < 2 ? FuelType.Rainforest : FuelType.DryForestShrubby) : FuelType.Grassland;
      if (i === 0) type[k] = FuelType.Water;
    }
  }
  const cover = a(0);
  const height = a(0);
  for (let k = 0; k < n; k++) {
    if (type[k] === FuelType.DryForestShrubby || type[k] === FuelType.Rainforest) {
      cover[k] = 0.7;
      height[k] = type[k] === FuelType.Rainforest ? 30 : 22;
    } else if (type[k] === FuelType.Heath) {
      cover[k] = 0.05;
      height[k] = 3;
    }
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
}

const g = makeGridSpec(origin, 6000, 30);
const fuel = forest(g);
const heightAt = (x: number, y: number): number => 500 + 0.01 * x + 0.02 * y;

describe('placeVegetation', () => {
  it('is deterministic', () => {
    const a = placeVegetation(fuel, { budget: 20000, heightAt, seed: 3 });
    const b = placeVegetation(fuel, { budget: 20000, heightAt, seed: 3 });
    expect(a.map((s) => s.count)).toEqual(b.map((s) => s.count));
    for (let s = 0; s < a.length; s++) {
      expect(Array.from(a[s]!.position)).toEqual(Array.from(b[s]!.position));
      expect(Array.from(a[s]!.size)).toEqual(Array.from(b[s]!.size));
    }
    const c = placeVegetation(fuel, { budget: 20000, heightAt, seed: 4 });
    expect(Array.from(c[0]!.position.slice(0, 30))).not.toEqual(Array.from(a[0]!.position.slice(0, 30)));
  });

  it('never exceeds the budget or the hard cap', () => {
    for (const budget of [0, 500, 8000, 30000, 200000]) {
      const v = placeVegetation(fuel, { budget, heightAt });
      expect(totalInstances(v)).toBeLessThanOrEqual(Math.min(budget, MAX_VEG_INSTANCES));
    }
    expect(totalInstances(placeVegetation(fuel, { budget: 30000, heightAt }))).toBeGreaterThan(20000);
    const half = totalInstances(placeVegetation(fuel, { budget: 30000, heightAt, densityScale: 0.4 }));
    expect(half).toBeLessThanOrEqual(12000);
  });

  it('puts the right groups in the right fuel and on the ground', () => {
    const v = placeVegetation(fuel, { budget: 30000, heightAt });
    const typeAt = (x: number, y: number): FuelType => {
      const i = Math.round((x - g.x0) / g.cellSize);
      const j = Math.round((y - g.y0) / g.cellSize);
      return fuel.type[Math.min(g.ny - 1, Math.max(0, j)) * g.nx + Math.min(g.nx - 1, Math.max(0, i))] as FuelType;
    };
    const euc = v[VegGroup.Eucalypt]!;
    expect(euc.count).toBeGreaterThan(1000);
    let inForest = 0;
    for (let i = 0; i < euc.count; i += 7) {
      const t = typeAt(euc.position[i * 3]!, euc.position[i * 3 + 1]!);
      // Eucalypts grow in the forest; the sparse heath canopy (5 % cover, 3 m) gives a few emergent mallee.
      expect([FuelType.DryForestShrubby, FuelType.Heath]).toContain(t);
      expect(euc.position[i * 3 + 2]).toBeCloseTo(heightAt(euc.position[i * 3]!, euc.position[i * 3 + 1]!), 3);
      if (t === FuelType.DryForestShrubby) {
        inForest++;
        // Heights follow the canopy raster (22 m) with jitter.
        expect(euc.size[i * 2]).toBeGreaterThan(22 * 0.7);
        expect(euc.size[i * 2]).toBeLessThan(22 * 1.2);
      }
    }
    expect(inForest).toBeGreaterThan(euc.count / 7 / 2);
    expect(v[VegGroup.Rainforest]!.count).toBeGreaterThan(0);
    const grass = v[VegGroup.Grass]!;
    for (let i = 0; i < grass.count; i += 23) expect(typeAt(grass.position[i * 3]!, grass.position[i * 3 + 1]!)).toBe(FuelType.Grassland);
    // Nothing in water.
    for (const set of v) for (let i = 0; i < set.count; i++) expect(typeAt(set.position[i * 3]!, set.position[i * 3 + 1]!)).not.toBe(FuelType.Water);
  });

  it('gives identical results with the demand cache', () => {
    const cache = {};
    const a = placeVegetation(fuel, { budget: 12000, heightAt, focus: [500, 0], cache });
    const b = placeVegetation(fuel, { budget: 12000, heightAt, focus: [500, 0], cache });
    const c = placeVegetation(fuel, { budget: 12000, heightAt, focus: [500, 0] });
    expect(a.map((s) => s.count)).toEqual(c.map((s) => s.count));
    expect(Array.from(b[0]!.position)).toEqual(Array.from(c[0]!.position));
  });

  it('is densest around the focus point', () => {
    const v = placeVegetation(fuel, { budget: 15000, heightAt, focus: [0, 0], focusRadius: 800 });
    const euc = v[VegGroup.Eucalypt]!;
    let near = 0;
    let far = 0;
    for (let i = 0; i < euc.count; i++) {
      const y = euc.position[i * 3 + 1]!;
      // The forest strip is centred on x = 0; compare the same-size band near and far in y.
      if (Math.abs(y) < 500) near++;
      else if (Math.abs(y) > 2000 && Math.abs(y) < 2500) far++;
    }
    expect(near).toBeGreaterThan(2 * far);
  });
});

describe('splitBudget', () => {
  it('gives unused shares to groups with demand', () => {
    const a = splitBudget(1000, [1e6, 0, 0, 1e6, 0]);
    expect(a[1]).toBe(0);
    expect(a[0]! + a[3]!).toBeGreaterThan(990);
    const b = splitBudget(1000, [100, 1e6, 0, 0, 0]);
    expect(b[0]).toBe(100);
    expect(b[1]).toBeGreaterThan(890);
  });
});
