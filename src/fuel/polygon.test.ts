/**
 * Scanline rasteriser (spec §4.2 vegetation, §4.4 fire history, §4.8 brush polygons): exactness against a brute-force
 * even-odd point-in-polygon test, tiling (shared edges never double count or drop lattice points), clipping at the
 * grid edges and degenerate inputs.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { pointInRings, ScanlineRasteriser, subPointLattice, type Lattice, type LocalRings } from './polygon';

const LAT: Lattice = { x0: 0, y0: 0, step: 10, nx: 60, ny: 50 };

function rasterMask(rings: LocalRings, lat: Lattice): Uint8Array {
  const m = new Uint8Array(lat.nx * lat.ny);
  new ScanlineRasteriser().rasterise(rings, lat, (j, i0, i1) => {
    for (let i = i0; i <= i1; i++) m[j * lat.nx + i]!++;
  });
  return m;
}
function bruteMask(rings: LocalRings, lat: Lattice): Uint8Array {
  const m = new Uint8Array(lat.nx * lat.ny);
  for (let j = 0; j < lat.ny; j++)
    for (let i = 0; i < lat.nx; i++) if (pointInRings(lat.x0 + i * lat.step, lat.y0 + j * lat.step, rings)) m[j * lat.nx + i] = 1;
  return m;
}
const ring = (pts: [number, number][], close = true): Float64Array => {
  const p = close ? [...pts, pts[0]!] : pts;
  return Float64Array.from(p.flat());
};
const sum = (a: Uint8Array): number => a.reduce((s, v) => s + v, 0);

describe('ScanlineRasteriser', () => {
  it('matches brute-force even-odd point-in-polygon on random polygons with holes and self-intersections', () => {
    const rng = new Rng(12345);
    for (let trial = 0; trial < 60; trial++) {
      const rings: LocalRings = [];
      const nRings = 1 + Math.floor(rng.next() * 3);
      for (let r = 0; r < nRings; r++) {
        const cx = -50 + rng.next() * 700;
        const cy = -50 + rng.next() * 600;
        const nv = 3 + Math.floor(rng.next() * 12);
        const pts: [number, number][] = [];
        for (let v = 0; v < nv; v++) {
          // Star-shaped when trial is even, arbitrary (self-intersecting) when odd.
          const a = trial % 2 === 0 ? (2 * Math.PI * v) / nv : rng.next() * 2 * Math.PI;
          const rad = 20 + rng.next() * 250;
          pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
        }
        rings.push(ring(pts, trial % 3 !== 0));
      }
      const a = rasterMask(rings, LAT);
      const b = bruteMask(rings, LAT);
      expect(Math.max(...a)).toBeLessThanOrEqual(1); // no lattice point filled twice
      let diff = 0;
      for (let q = 0; q < a.length; q++) if (a[q] !== b[q]) diff++;
      expect(diff).toBe(0);
    }
  });

  it('tiles: squares sharing edges on lattice rows/columns fill every point exactly once', () => {
    // A 3×3 block of 100 m squares whose edges lie exactly on lattice points (step 10).
    const m = new Uint8Array(LAT.nx * LAT.ny);
    const ras = new ScanlineRasteriser();
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) {
        const x = 100 + 100 * a;
        const y = 100 + 100 * b;
        ras.rasterise([ring([[x, y], [x + 100, y], [x + 100, y + 100], [x, y + 100]])], LAT, (j, i0, i1) => {
          for (let i = i0; i <= i1; i++) m[j * LAT.nx + i]!++;
        });
      }
    expect(Math.max(...m)).toBe(1);
    expect(sum(m)).toBe(30 * 30); // half-open [100, 400) in x and y: 30 lattice points per axis
  });

  it('handles closed and unclosed rings identically, clips at the lattice edges and ignores degenerate rings', () => {
    const sq: [number, number][] = [[-1000, -1000], [250, -1000], [250, 5000], [-1000, 5000]];
    const closed = rasterMask([ring(sq, true)], LAT);
    const open = rasterMask([ring(sq, false)], LAT);
    expect(Array.from(closed)).toEqual(Array.from(open));
    expect(sum(closed)).toBe(25 * LAT.ny); // x ∈ [0, 250): 25 columns, every row
    // Entirely outside, zero-area and collinear rings fill nothing.
    expect(sum(rasterMask([ring([[-500, -500], [-400, -500], [-400, -400]])], LAT))).toBe(0);
    expect(sum(rasterMask([ring([[10, 10], [300, 10], [300, 10]])], LAT))).toBe(0);
    expect(sum(rasterMask([ring([[10, 10], [100, 100], [200, 200]])], LAT))).toBe(0);
    expect(sum(rasterMask([], LAT))).toBe(0);
  });

  it('a polygon far larger than the lattice costs O(rows), not O(polygon extent)', () => {
    const big = ring([[-1e7, -1e7], [1e7, -1e7], [1e7, 1e7], [-1e7, 1e7]]);
    const t = performance.now();
    const m = rasterMask([big], LAT);
    expect(performance.now() - t).toBeLessThan(50);
    expect(sum(m)).toBe(LAT.nx * LAT.ny);
  });

  it('sub-point lattice: 3×3 points per cell at the centre and ±Δx/3', () => {
    const g = { nx: 4, ny: 5, cellSize: 30, x0: -45, y0: -60, origin: { lat: -33.7, lon: 150.3 } };
    const s = subPointLattice(g, 3);
    expect(s.nx).toBe(12);
    expect(s.ny).toBe(15);
    expect(s.step).toBe(10);
    // Sub-point (1, 1) is the centre of cell (0, 0); (0, 0) and (2, 2) are ∓Δx/3 from it.
    expect(s.x0 + 1 * s.step).toBeCloseTo(g.x0, 9);
    expect(s.y0 + 1 * s.step).toBeCloseTo(g.y0, 9);
    expect(s.x0 + 2 * s.step - g.x0).toBeCloseTo(10, 9);
  });
});
