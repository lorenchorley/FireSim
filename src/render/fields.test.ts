import { describe, expect, it } from 'vitest';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { BurnState, FuelType, SpreadDriver, type FireField, type FuelMap, type Terrain } from '../core/types';
import {
  arrivalTexture,
  decimateGrid,
  fireAuxTexture,
  fireCentroid,
  flameSites,
  glowField,
  groundColours,
  hash01,
  hornGradient,
  lightTerrain,
  nearestCell,
  overlayField,
} from './fields';
import { NOT_BURNT, NO_DATA } from './legends';

const origin = { lat: -33.7, lon: 150.3 };

function plane(g: GridSpec, a: number, b: number, c = 500): Float32Array {
  const z = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = c + a * (g.x0 + i * g.cellSize) + b * (g.y0 + j * g.cellSize);
  return z;
}

function fireOn(g: GridSpec, arrival: (x: number, y: number) => number, time: number): FireField {
  const n = g.nx * g.ny;
  const f: FireField = {
    grid: g,
    arrivalTime: new Float32Array(n),
    burnState: new Uint8Array(n),
    ros: new Float32Array(n).fill(0.2),
    intensity: new Float32Array(n).fill(3000),
    flameHeight: new Float32Array(n).fill(3),
    spreadDir: new Float32Array(n),
    driver: new Uint8Array(n).fill(SpreadDriver.Wind),
    phase: new Uint8Array(n).fill(1),
  };
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const a = arrival(g.x0 + i * g.cellSize, g.y0 + j * g.cellSize);
      if (a <= time) {
        f.arrivalTime[k] = a;
        f.burnState[k] = time - a < 300 ? BurnState.Burning : BurnState.BurntOut;
      } else {
        f.arrivalTime[k] = Infinity;
        f.burnState[k] = BurnState.Unburnt;
      }
    }
  }
  return f;
}

function fuelOn(g: GridSpec, type: FuelType = FuelType.DryForestShrubby): FuelMap {
  const n = g.nx * g.ny;
  const a = (v: number): Float32Array => new Float32Array(n).fill(v);
  return {
    grid: g,
    type: new Uint8Array(n).fill(type),
    surfaceHazard: a(3),
    nearSurfaceHazard: a(2),
    nearSurfaceHeight: a(0.3),
    elevatedHazard: a(3),
    elevatedHeight: a(1.5),
    barkHazard: a(2),
    surfaceLoad: a(12),
    nearSurfaceLoad: a(4),
    elevatedLoad: a(5),
    barkLoad: a(2),
    canopyHeight: a(20),
    canopyCover: a(0.6),
    curing: a(0),
    timeSinceFire: a(12),
    lastFireKind: new Uint8Array(n),
    sources: [],
  };
}

describe('hornGradient', () => {
  it('is exact on a plane (interior and edges)', () => {
    const g = makeGridSpec(origin, 1000, 20);
    const { dzdx, dzdy } = hornGradient(g, plane(g, 0.3, -0.12));
    const k = 25 * g.nx + 25;
    expect(dzdx[k]).toBeCloseTo(0.3, 6);
    expect(dzdy[k]).toBeCloseTo(-0.12, 6);
    // Edges replicate the border (one-sided): still close to the plane slope scaled by 3/4.
    expect(Math.abs(dzdx[0]!)).toBeGreaterThan(0.1);
  });
});

describe('decimateGrid', () => {
  it('keeps small grids and resamples large ones onto the same extent', () => {
    const g = makeGridSpec(origin, 9000, 10); // 900 × 900
    const z = plane(g, 0.05, 0.02);
    const small = decimateGrid(g, z, 1000);
    expect(small.grid).toBe(g);
    const d = decimateGrid(g, z, 300);
    expect(d.grid.nx).toBe(300);
    expect(d.grid.x0).toBeCloseTo(g.x0, 6);
    expect(d.grid.x0 + (d.grid.nx - 1) * d.grid.cellSize).toBeCloseTo(g.x0 + (g.nx - 1) * g.cellSize, 3);
    // A plane stays a plane (blur + bilinear are exact on linear fields away from the edge).
    const k = 150 * d.grid.nx + 150;
    const x = d.grid.x0 + 150 * d.grid.cellSize;
    const y = d.grid.y0 + 150 * d.grid.cellSize;
    expect(d.elevation[k]).toBeCloseTo(500 + 0.05 * x + 0.02 * y, 2);
  });

  it('builds a light terrain with slope and aspect', () => {
    const g = makeGridSpec(origin, 2000, 20);
    const t = lightTerrain({ grid: g, elevation: plane(g, 0, 0.2), ratio: 1 }, 'test');
    const k = 50 * g.nx + 50;
    expect(t.slopeDeg[k]).toBeCloseTo((Math.atan(0.2) * 180) / Math.PI, 3);
    // Rising to the north → faces (drains) south.
    expect(t.aspectDeg[k]).toBeCloseTo(180, 3);
  });
});

describe('fire textures', () => {
  const g = makeGridSpec(origin, 2000, 30);
  // Circular fire growing at 0.2 m/s from the centre.
  const fire = fireOn(g, (x, y) => Math.hypot(x, y) / 0.2, 1800);

  it('arrival texture: burnt cells keep arrival, a one-cell halo is never before the snapshot time', () => {
    const { data, maxArrival, burntCells } = arrivalTexture(fire, 1800);
    expect(burntCells).toBeGreaterThan(0);
    expect(maxArrival).toBeLessThanOrEqual(1800);
    let halo = 0;
    for (let k = 0; k < data.length; k++) {
      if (Number.isFinite(fire.arrivalTime[k]!)) expect(data[k]).toBe(fire.arrivalTime[k]);
      else if (data[k]! < NOT_BURNT) {
        halo++;
        expect(data[k]!).toBeGreaterThan(1800);
      }
    }
    expect(halo).toBeGreaterThan(0);
    // Far from the fire nothing is estimated.
    expect(data[0]).toBe(NOT_BURNT);
  });

  it('aux texture packs state, phase, driver and flame height', () => {
    const aux = fireAuxTexture(fire);
    const k = nearestCell(g, 0, 0);
    expect(aux[k * 4]).toBe(fire.burnState[k]);
    expect(aux[k * 4 + 2]).toBe(SpreadDriver.Wind);
    expect(aux[k * 4 + 3]).toBe(12); // 3 m × 4
  });

  it('flame sites: only near the active front, deterministic and capped', () => {
    const a = flameSites(fire, 1500, 1800);
    const b = flameSites(fire, 1500, 1800);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    for (const s of a) expect(Math.hypot(s.x, s.y)).toBeGreaterThan(150);
    expect(flameSites(fire, 1500, 1800, { max: 10 }).length).toBe(10);
  });

  it('glow is 0–1 and centred on the burning ring', () => {
    const glow = glowField(fire, 1800);
    let max = 0;
    for (const v of glow.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      max = Math.max(max, v);
    }
    expect(max).toBeGreaterThan(0.2);
    expect(glow.data[0]).toBe(0);
  });

  it('fire centroid of a centred ring is near the origin', () => {
    const c = fireCentroid(fire, 1800)!;
    expect(Math.hypot(c.x, c.y)).toBeLessThan(40);
  });
});

describe('ground colours and overlay fields', () => {
  const g = makeGridSpec(origin, 600, 30);
  const fuel = fuelOn(g);
  fuel.type[0] = FuelType.Water;
  const terrain: Terrain = lightTerrain({ grid: g, elevation: plane(g, 0, 0.1), ratio: 1 }, 't');

  it('are deterministic, opaque colours; cliffs show rock', () => {
    const a = groundColours(fuel, terrain);
    expect(a).toEqual(groundColours(fuel, terrain));
    const steep = lightTerrain({ grid: g, elevation: plane(g, 2.5, 0), ratio: 1 }, 't');
    const r = groundColours(fuel, steep);
    const k = 5 * g.nx + 5;
    expect(r[k * 4 + 3]).toBeGreaterThan(200); // rock fraction in alpha
    expect(a[k * 4 + 3]).toBe(0);
  });

  it('converts units and masks unburnt cells', () => {
    const fire = fireOn(g, (x, y) => Math.hypot(x, y) / 0.2, 600);
    const ros = overlayField('ros', { terrain, fuel, fire })!;
    const k = nearestCell(g, 0, 0);
    expect(ros.values[k]).toBeCloseTo(0.72, 5); // 0.2 m/s → km/h
    expect(ros.values[0]).toBe(NO_DATA);
    expect(overlayField('fuelType', { terrain, fuel })!.categorical).toBe(true);
    expect(overlayField('arrival', { terrain, fuel, fire: null })).toBeNull();
    const load = overlayField('fuelLoad', { terrain, fuel })!;
    expect(load.values[5]).toBeCloseTo(23, 5);
    expect(load.values[0]).toBe(NO_DATA); // water
  });

  it('hash is uniform-ish and deterministic', () => {
    let s = 0;
    for (let i = 0; i < 1000; i++) s += hash01(i, 7, 3);
    expect(s / 1000).toBeGreaterThan(0.45);
    expect(s / 1000).toBeLessThan(0.55);
    expect(hash01(3, 4, 5)).toBe(hash01(3, 4, 5));
  });
});
