/**
 * T1.5 (b), (c): the pool forms of the fast tier, made the same way on every thread (so that job ids agree), the replay factories and the timed operations (driver side).
 */
import type { Pool, TypedAny } from './pool';
import { LS_INSTANCES, LevelSetPar, PyroPar, type FastMeta } from './fast-pool';
import { buildLS, type Case, type LS, type LSFactory, type PyroFactory } from './fast-frames';
import type { Fixture } from './fixture';

export interface FastThread { ls: LevelSetPar[]; py: PyroPar }

/** Same order on the driver and on every helper: the registration order fixes the job ids. */
export function makeFastThread(meta: FastMeta, views: Record<string, TypedAny>, pool: Pool): FastThread {
  const ls: LevelSetPar[] = [];
  for (let i = 0; i < LS_INSTANCES; i++) ls.push(new LevelSetPar(i, meta, views, pool));
  return { ls, py: new PyroPar(meta, views, pool) };
}

/** Replay factories (`force`: chunked paths whatever the size): instance 3 for the level set, the one pyro instance, both reset to a fresh object. */
export function replayFactories(ft: FastThread, force = false): { ls: LSFactory; py: PyroFactory } {
  return {
    ls: (): LS => {
      const l = ft.ls[3]!;
      l.reset();
      if (force) {
        // as the C# tests' MinParallelBand = MinParallelBox = 0: the chunked evaluate and the wavefront run whatever the size
        l.minParallelBand = 0;
        l.minParallelBox = 0;
      }
      return l;
    },
    py: (): LS => {
      ft.py.reset();
      return ft.py;
    },
  };
}

/** the timed operations of `fast/bench.ts` in the pool form: frames 0, 1, 2 of the arena hold the stage-1, stage-2 and reinit frames */
export function fastOpsPool(fx: Fixture, ft: FastThread): Record<string, () => number> {
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
  const of = (i: number): LSFactory => (): LS => {
    ft.ls[i]!.reset();
    return ft.ls[i];
  };
  const ls1 = buildLS(fx, meta, e1, 'plain', of(0)).ls as LevelSetPar;
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
  const ls2 = buildLS(fx, meta, e2, 'plain', of(1)).ls as LevelSetPar;
  const ls3 = buildLS(fx, meta, ri, 'plain', of(2)).ls as LevelSetPar;
  const phi0 = Float64Array.from(ls3.phi);
  const band0 = Int32Array.from(ls3.band.subarray(0, ls3.bandCount));
  const count3 = ls3.bandCount;
  const pyro = ft.py;
  pyro.reset();
  pyro.loadQ(fx.get(py.q as string) as Float32Array);
  let sink = 0;
  const restore = (): void => {
    ls3.phi.set(phi0);
    ls3.band.set(band0);
    ls3.bandCount = count3;
  };
  return {
    evalStage1: () => {
      for (let i = 0; i < hookK.length; i++) ls1.prepStamp[hookK[i]!] = prepBefore[i]!;
      sink += ls1.evalInto(0, 1, true);
      return sink;
    },
    evalStage2: () => {
      sink += ls2.evalInto(1, 2, false);
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
      pyro.solveResident();
      sink += pyro.up[1]!;
      return sink;
    },
  };
}
