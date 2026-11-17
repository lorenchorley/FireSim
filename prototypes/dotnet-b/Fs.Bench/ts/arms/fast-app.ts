/**
 * T1.5 (a), (c) one worker: the fast tier's kernels as the app has them, UNMODIFIED: `LevelSetCore.evaluate` and `reinit` (src/fire/spread/levelSet.ts) and `PyrogenicPotential.solve`
 * (src/atmosphere/pyrogenic.ts), on real instances of the app's classes holding the fixture's frames (the replay of `Fs.Bench/ts/fast/lib.ts` and the timed operations of
 * `Fs.Bench/ts/fast/bench.ts`, free of `node:*` imports). Nothing in src/ is edited or wrapped.
 */
import type { GridSpec } from '../../../../../src/core/grid';
import { LevelSetCore } from '../../../../../src/fire/spread/levelSet';
import { PyrogenicPotential } from '../../../../../src/atmosphere/pyrogenic';
import type { Fixture } from './fixture';
import { buildLS, type Case, type LS, type LSFactory, type PyroFactory } from './fast-frames';
import type { FastMeta } from './fast-pool';

export const appLsFactory: LSFactory = (m: FastMeta): LS => new LevelSetCore({ nx: m.grid.nx, ny: m.grid.ny, cellSize: m.grid.cellSize } as unknown as GridSpec, m.levelSet as never);
export const appPyroFactory: PyroFactory = (_m, nx, ny, cell): LS => new PyrogenicPotential({ nx, ny, cellSize: cell } as unknown as GridSpec);

/** the timed operations of `fast/bench.ts` (one operation each), on resident frames */
export function fastOpsApp(fx: Fixture): Record<string, () => number> {
  const h = fx.header as unknown as { meta: FastMeta; cases: Case[] };
  const meta = h.meta;
  const find = (pred: (c: Case) => boolean): Case => {
    const c = h.cases.find(pred);
    if (!c) throw new Error('case not found');
    return c;
  };
  const e1 = find((c) => c.kind === 'evaluate' && c.mode === 'e1');
  const e2 = find((c) => c.kind === 'evaluate' && c.mode === 'e2');
  const ri = find((c) => c.kind === 'reinit');
  const py = find((c) => c.kind === 'pyro');
  const ls1: LS = buildLS(fx, meta, e1, 'plain', appLsFactory).ls;
  const hk = e1.hook as { k: string; vals: string };
  const hookK = fx.get(hk.k) as Int32Array;
  const hookV = fx.get(hk.vals) as Float32Array;
  const hookIndex = new Int32Array(ls1.n).fill(-1);
  hookK.forEach((k, i) => (hookIndex[k] = i));
  const prepBefore = Int32Array.from(hookK, (k) => ls1.prepStamp[k]!);
  ls1.hooks = {
    ensureSpeed: (k: number): void => {
      const i = hookIndex[k]!;
      if (i >= 0) {
        ls1.sA2[k] = hookV[6 * i]!; ls1.sB2[k] = hookV[6 * i + 1]!; ls1.sC[k] = hookV[6 * i + 2]!;
        ls1.sEx[k] = hookV[6 * i + 3]!; ls1.sEy[k] = hookV[6 * i + 4]!; ls1.sVls[k] = hookV[6 * i + 5]!;
      }
      ls1.prepStamp[k] = ls1.stamp;
    },
    onArrival: () => undefined,
  };
  const out1 = new Float64Array(ls1.bandCount);
  const ls2: LS = buildLS(fx, meta, e2, 'plain', appLsFactory).ls;
  const out2 = new Float64Array(ls2.bandCount);
  const ls3: LS = buildLS(fx, meta, ri, 'plain', appLsFactory).ls;
  const phi0 = Float64Array.from(ls3.phi);
  const band0 = Int32Array.from(ls3.band.subarray(0, ls3.bandCount));
  const count3 = ls3.bandCount as number;
  const pyro = appPyroFactory(meta, py.fireNx as number, py.fireNy as number, py.cellSize as number);
  const q = fx.get(py.q as string) as Float32Array;
  let sink = 0;
  const restore = (): void => {
    ls3.phi.set(phi0);
    ls3.band.set(band0);
    ls3.bandCount = count3;
  };
  return {
    evalStage1: () => {
      for (let i = 0; i < hookK.length; i++) ls1.prepStamp[hookK[i]!] = prepBefore[i]!;
      sink += ls1.evaluate(ls1.phi, out1, true);
      return sink;
    },
    evalStage2: () => {
      sink += ls2.evaluate(ls2.phiS, out2, false);
      return sink;
    },
    reinit: () => {
      restore();
      ls3.reinit();
      sink += ls3.bandCount;
      return sink;
    },
    restore: () => {
      restore();
      sink += ls3.bandCount;
      return sink;
    },
    pyro: () => {
      pyro.solve(q);
      sink += pyro.up[1]!;
      return sink;
    },
  };
}
