/**
 * `windP` and `fieldsP` allocate nothing, whether or not V8 inlines their helper. A method that returns a double is boxed (a heap
 * number per call) unless TurboFan inlines it into its caller, and it declines to when a machine is busy or a loop is cold, so
 * the blend hands its answer back through a scratch array and not through a return value. This file runs with inlining
 * switched off, which makes the difference deterministic (atmosphereSampler.test.ts measures the default state, which depends
 * on the JIT's mood). Its own file, so that no earlier test has already optimised the methods.
 */
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import type { AtmosphereView } from '../core/types';
import { AtmosphereSampler } from './atmosphereSampler';

let gcFn: (() => void) | null = null;
function gc(): void {
  if (!gcFn) {
    v8.setFlagsFromString('--expose-gc');
    gcFn = vm.runInNewContext('gc') as () => void;
  }
  gcFn();
}

function view(): AtmosphereView {
  const grid = makeGridSpec({ lat: -33.7, lon: 150.3 }, 44 * 133, 133);
  const nz = 20;
  const plane = grid.nx * grid.ny;
  const field = (): Float32Array => Float32Array.from({ length: plane * nz }, (_, i) => Math.sin(i * 0.37) * 5);
  const levels = Float32Array.from({ length: nz }, (_, k) => 15 * 1.3 ** k);
  return {
    grid,
    nz,
    levels,
    terrainHeight: Float32Array.from({ length: plane }, (_, i) => 300 + 300 * Math.sin(i * 0.01)),
    layout: 'terrain-following',
    kind: 'prognostic',
    topM: levels[nz - 1]! * 1.1,
    baseM: 400,
    surfaceU: field().subarray(0, plane),
    surfaceV: field().subarray(0, plane),
    u: field(),
    v: field(),
    w: field(),
    thetaAnomaly: field(),
    smoke: field(),
  };
}

describe('sampler allocation does not depend on inlining', () => {
  it('windP and fieldsP allocate under 2 bytes per call with TurboFan inlining off', () => {
    v8.setFlagsFromString('--no-turbo-inlining');
    try {
      const s = new AtmosphereSampler(view(), 0, null);
      const g = s.atm!.grid;
      const N = 512;
      const p = new Float64Array(N * 3);
      for (let i = 0; i < N; i++) {
        p[i * 3] = g.x0 + 0.05 * (g.nx - 1) * g.cellSize + (0.9 * (g.nx - 1) * g.cellSize * ((i * 7919) % N)) / N;
        p[i * 3 + 1] = g.y0 + 0.05 * (g.ny - 1) * g.cellSize + (0.9 * (g.ny - 1) * g.cellSize * ((i * 104729) % N)) / N;
        p[i * 3 + 2] = 800 + (1500 * (i % 17)) / 17;
      }
      const w = new Float32Array(3);
      const sw = new Float32Array(2);
      const pos = new Float64Array(4);
      const five = new Float32Array(5);
      const loops: Record<string, (n: number) => number> = {
        windP: (n) => {
          let a = 0;
          for (let i = 0; i < n; i++) {
            const k = (i & (N - 1)) * 3;
            pos[0] = p[k]!;
            pos[1] = p[k + 1]!;
            pos[2] = p[k + 2]!;
            s.windP(pos, w);
            a += w[0]!;
          }
          return a;
        },
        fieldsP: (n) => {
          let a = 0;
          for (let i = 0; i < n; i++) {
            const k = (i & (N - 1)) * 3;
            pos[0] = p[k]!;
            pos[1] = p[k + 1]!;
            pos[2] = p[k + 2]!;
            s.fieldsP(pos, five);
            a += five[4]!;
          }
          return a;
        },
        wind: (n) => {
          let a = 0;
          for (let i = 0; i < n; i++) {
            const k = (i & (N - 1)) * 3;
            s.wind(p[k]!, p[k + 1]!, p[k + 2]!, p[k + 2]! - 520, w);
            a += w[0]!;
          }
          return a;
        },
        surfaceWind: (n) => {
          let a = 0;
          for (let i = 0; i < n; i++) {
            const k = (i & (N - 1)) * 3;
            s.surfaceWind(p[k]!, p[k + 1]!, sw);
            a += sw[0]!;
          }
          return a;
        },
      };
      const perCall: Record<string, number> = {};
      let sink = 0;
      for (const [name, loop] of Object.entries(loops)) {
        for (let r = 0; r < 100; r++) sink += loop(5000);
        const WINDOW = 2000;
        gc();
        gc();
        const d: number[] = [];
        for (let r = 0; r < 41; r++) {
          const a0 = process.memoryUsage().heapUsed;
          sink += loop(WINDOW);
          d.push(process.memoryUsage().heapUsed - a0);
        }
        d.sort((x, y) => x - y);
        perCall[name] = d[d.length >> 1]! / WINDOW;
      }
      process.stderr.write(`[sampler alloc, inlining off] ${Object.entries(perCall).map(([k, v]) => `${k} ${v.toFixed(2)} B/call`).join(', ')}\n`);
      expect(Number.isFinite(sink)).toBe(true);
      // `wind` and `surfaceWind` take doubles as arguments, and a call that V8 does not inline boxes each of them: those two are
      // logged above, not asserted. `windP` and `fieldsP` take their position in a Float64Array, so they have nothing to box.
      for (const name of ['windP', 'fieldsP']) expect(perCall[name], `${name}: bytes per call`).toBeLessThan(2);
    } finally {
      v8.setFlagsFromString('--turbo-inlining');
    }
  });
});
