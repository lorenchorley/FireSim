/**
 * Performance of the hot-loop kernel against spec §13: "fire prepare ≤ 20k prepared cells × 180–300 ns" on a phone
 * (≈ 2–3× slower than one x86 Node core), i.e. ≈ 60–150 ns per prepared cell on Node for all of prepare, of which the
 * kernel is the largest part (R_w is reused where |ΔU10| ≤ 2 % and M is unchanged, §7.1). Measured on x86 Node:
 * ≈ 150–200 ns (headRosKernel, forest) and ≈ 120–150 ns (headRosKernelCached). The asserted limits are regression
 * guards with slack for shared CI machines; the measured numbers are printed.
 */
import { describe, expect, it } from 'vitest';
import { FuelType, type CellFuelParams } from '../../core/types';
import { createReferenceFactorsOut, referenceFactors } from './factors';
import { cellParamsFromRow, fuelRow } from './fuelRef';
import { buildKernelCache, createHeadKernelOut, createIntensityOut, headRosKernel, headRosKernelCached, intensityKernel } from './kernel';

function cells(n: number, types: FuelType[]): CellFuelParams[] {
  const out: CellFuelParams[] = [];
  for (let k = 0; k < n; k++) {
    const t = types[k % types.length]!;
    const p = cellParamsFromRow(t, fuelRow(t));
    // Vary loads a little so nothing is constant-folded.
    p.surfaceLoad *= 0.6 + 0.4 * ((k * 7919) % 101) / 100;
    out.push(p);
  }
  return out;
}

function timeNs(fn: () => void, calls: number, reps = 7): number {
  fn(); // warm-up
  const t: number[] = [];
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now();
    fn();
    t.push(((performance.now() - t0) * 1e6) / calls);
  }
  // Minimum over repetitions: the machine may be shared with other test runs; the minimum is the least noisy estimate.
  return Math.min(...t);
}

describe('kernel performance (spec §13)', () => {
  const N = 20000;
  const forest = cells(N, [FuelType.DryForestShrubby, FuelType.WetForest, FuelType.DryForestGrassy]);
  const mixed = cells(N, [FuelType.DryForestShrubby, FuelType.Grassland, FuelType.Heath, FuelType.PinePlantation, FuelType.WetForest]);
  const u = new Float32Array(N).map((_, k) => 5 + ((k * 13) % 50));
  const m = new Float32Array(N).map((_, k) => 4 + ((k * 7) % 12));
  const out = createHeadKernelOut();
  let sink = 0;

  it('headRosKernel on 20k forest cells', () => {
    const ns = timeNs(() => {
      for (let k = 0; k < N; k++) {
        headRosKernel(forest[k]!, u[k]!, m[k]!, 0.95, out, 9);
        sink += out.rw;
      }
    }, N);
    console.log(`headRosKernel (vesta2): ${ns.toFixed(0)} ns/cell → ${(ns * N / 1e6).toFixed(2)} ms per 20k prepare`);
    expect(ns).toBeLessThan(600);
  });

  it('headRosKernelCached on 20k forest cells gives identical results, faster', () => {
    const cache = buildKernelCache(forest);
    const o2 = createHeadKernelOut();
    for (let k = 0; k < N; k += 7) {
      headRosKernel(forest[k]!, u[k]!, m[k]!, 0.95, out, 9);
      headRosKernelCached(cache, k, u[k]!, m[k]!, 0.95, o2, 9);
      expect(o2).toEqual(out);
    }
    const ns = timeNs(() => {
      for (let k = 0; k < N; k++) {
        headRosKernelCached(cache, k, u[k]!, m[k]!, 0.95, out, 9);
        sink += out.rw;
      }
    }, N);
    console.log(`headRosKernelCached (vesta2): ${ns.toFixed(0)} ns/cell`);
    expect(ns).toBeLessThan(500);
  });

  it('headRosKernel on 20k mixed-family cells', () => {
    const ns = timeNs(() => {
      for (let k = 0; k < N; k++) {
        headRosKernel(mixed[k]!, u[k]!, m[k]!, 0.95, out, 9);
        sink += out.rw;
      }
    }, N);
    console.log(`headRosKernel (mixed): ${ns.toFixed(0)} ns/cell`);
    expect(ns).toBeLessThan(700);
  });

  it('intensityKernel and referenceFactors (arrival-time only)', () => {
    const io = createIntensityOut();
    const ns = timeNs(() => {
      for (let k = 0; k < N; k++) {
        intensityKernel(mixed[k]!, 100 + u[k]! * 20, 0.9, io, 9);
        sink += io.intensity;
      }
    }, N);
    const fo = createReferenceFactorsOut();
    const nsF = timeNs(() => {
      for (let k = 0; k < N; k++) {
        referenceFactors(mixed[k]!, u[k]!, m[k]!, 0.9, fo, 9);
        sink += fo.fuel;
      }
    }, N);
    console.log(`intensityKernel: ${ns.toFixed(0)} ns/cell; referenceFactors: ${nsF.toFixed(0)} ns/cell (sink ${sink > 0})`);
    expect(ns).toBeLessThan(400);
    expect(nsF).toBeLessThan(2000);
  });
});
