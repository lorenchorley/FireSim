import { describe, expect, it } from 'vitest';
import { boxBlur, cellAt, gradient, makeGridSpec, sampleBilinear } from './grid';
import { LocalProjection, haversine, lonLatToTileFrac, tileFracToLonLat } from './geo';
import { angleDiffDeg, uvToWind, windToUV } from './units';
import { Rng } from './rng';

describe('grid', () => {
  const g = makeGridSpec({ lat: -33.7, lon: 150.3 }, 1000, 10);
  it('is centred on the origin', () => {
    expect(g.nx).toBe(100);
    expect(g.x0 + (g.nx - 1) * g.cellSize).toBeCloseTo(-g.x0);
    expect(cellAt(g, 0, 0)).toBeGreaterThan(0);
  });
  it('computes gradients of a plane', () => {
    const f = new Float32Array(g.nx * g.ny);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) f[j * g.nx + i] = 0.5 * i * g.cellSize - 0.25 * j * g.cellSize;
    const { dx, dy } = gradient(g, f);
    expect(dx[5050]).toBeCloseTo(0.5, 5);
    expect(dy[5050]).toBeCloseTo(-0.25, 5);
    expect(dx[0]).toBeCloseTo(0.5, 5);
    expect(sampleBilinear(g, f, g.x0 + 15, g.y0)).toBeCloseTo(7.5, 4);
  });
  it('box blur preserves constants', () => {
    const f = new Float32Array(g.nx * g.ny).fill(3);
    expect(boxBlur(g, f, 4)[1234]).toBeCloseTo(3, 5);
  });
});

describe('geo & units', () => {
  it('local projection round-trips and matches haversine', () => {
    const p = new LocalProjection({ lat: -33.71, lon: 150.31 });
    const q = { lat: -33.73, lon: 150.34 };
    const [x, y] = p.toLocal(q);
    const back = p.toLatLon(x, y);
    expect(back.lat).toBeCloseTo(q.lat, 9);
    expect(Math.hypot(x, y) / haversine(p.origin, q)).toBeCloseTo(1, 3);
  });
  it('tile maths round-trips', () => {
    const [tx, ty] = lonLatToTileFrac(-33.71, 150.31, 13);
    const ll = tileFracToLonLat(tx, ty, 13);
    expect(ll.lat).toBeCloseTo(-33.71, 8);
    expect(ll.lon).toBeCloseTo(150.31, 8);
  });
  it('wind vector conventions', () => {
    const [u, v] = windToUV(10, 315); // north-westerly blows to the south-east
    expect(u).toBeGreaterThan(0);
    expect(v).toBeLessThan(0);
    const [s, d] = uvToWind(u, v);
    expect(s).toBeCloseTo(10);
    expect(d).toBeCloseTo(315);
    expect(angleDiffDeg(10, 350)).toBeCloseTo(20);
  });
  it('rng is reproducible', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });
});
