/**
 * Geometry helpers of the spread module (spec §7.2 ignition rasterisation, §7.9 VLS zone labelling, §7.13 frontDist):
 * the exact Euclidean distance transform against brute force, 4-connected labelling, signed distances and lengths.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng';
import { DistanceTransform, distToPolyline, labelComponents4, pointInPolygon, polylineLength, signedDistToPolygon } from './geometry';

describe('DistanceTransform (spec §7.13 frontDist)', () => {
  it('equals the brute-force Euclidean distance to the nearest source (random sources, non-square grid)', () => {
    const nx = 37;
    const ny = 23;
    const h = 30;
    const rng = new Rng(7);
    const src = new Uint8Array(nx * ny);
    for (let k = 0; k < src.length; k++) src[k] = rng.next() < 0.03 ? 1 : 0;
    src[0] = 1;
    const out = new Float32Array(nx * ny);
    new DistanceTransform(nx, ny).compute((k) => src[k] === 1, h, out);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let best = Infinity;
        for (let q = 0; q < src.length; q++) {
          if (!src[q]) continue;
          const di = (q % nx) - i;
          const dj = Math.floor(q / nx) - j;
          best = Math.min(best, Math.hypot(di, dj) * h);
        }
        expect(out[j * nx + i]).toBeCloseTo(best, 3);
      }
    }
  });

  it('is Infinity everywhere without a source and 0 on sources', () => {
    const out = new Float32Array(20);
    const dt = new DistanceTransform(5, 4);
    dt.compute(() => false, 10, out);
    for (const v of out) expect(v).toBe(Infinity);
    dt.compute((k) => k === 7, 10, out);
    expect(out[7]).toBe(0);
    expect(out[8]).toBeCloseTo(10, 6);
    expect(out[0]).toBeCloseTo(Math.hypot(2, 1) * 10, 5);
  });
});

describe('labelComponents4 (spec §7.9 VLS zones)', () => {
  it('labels 4-connected components deterministically (diagonal contact does not connect)', () => {
    const nx = 6;
    const ny = 4;
    // Rows from j = 0: two blobs touching only diagonally, plus a separate line.
    const m = [
      1, 1, 0, 0, 0, 1,
      1, 0, 0, 0, 0, 1,
      0, 1, 1, 0, 0, 1,
      0, 0, 0, 0, 0, 0,
    ];
    const cells = new Int32Array(m.map((_, k) => k));
    const labels = new Int32Array(nx * ny);
    const n = labelComponents4(nx, ny, cells, cells.length, (k) => m[k] === 1, labels, new Int32Array(cells.length));
    expect(n).toBe(3);
    expect(labels[0]).toBe(1);
    expect(labels[1]).toBe(1);
    expect(labels[6]).toBe(1);
    expect(labels[5]).toBe(2);
    expect(labels[11]).toBe(2);
    expect(labels[17]).toBe(2);
    expect(labels[13]).toBe(3); // (1, 2) touches (0, 1) only diagonally
    expect(labels[14]).toBe(3);
    expect(labels[3]).toBe(0);
  });
});

describe('ignition geometry (spec §7.2)', () => {
  it('distances to polylines and signed distances to polygons', () => {
    const line: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    expect(distToPolyline(50, 20, line)).toBeCloseTo(20, 12);
    expect(distToPolyline(130, 50, line)).toBeCloseTo(30, 12);
    expect(distToPolyline(-30, -40, line)).toBeCloseTo(50, 12);
    expect(polylineLength(line)).toBeCloseTo(200, 12);
    expect(polylineLength(line, true)).toBeCloseTo(200 + 100 * Math.SQRT2, 12);
    const sq: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    expect(pointInPolygon(50, 50, sq)).toBe(true);
    expect(signedDistToPolygon(50, 40, sq)).toBeCloseTo(-40, 12);
    expect(signedDistToPolygon(150, 50, sq)).toBeCloseTo(50, 12);
    expect(signedDistToPolygon(5, 5, [[0, 0]])).toBeCloseTo(Math.hypot(5, 5), 12);
  });
});
