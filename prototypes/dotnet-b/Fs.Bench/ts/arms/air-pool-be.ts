/**
 * T1.5 (b), (c): the `AirBackend` (golden replay) and the timed operations of the pool form (`air-pool.ts`), driver side. Inputs of a golden case are copied into the arena; timed operations
 * run on the arena arrays as they are (data resident, nothing copied but what the app's benchmark also restores: relax's x).
 */
import { AirPar } from './air-pool';
import { maskRecipe, type AirBackend } from './air-cases';

export class PoolAir implements AirBackend {
  constructor(readonly par: AirPar, private readonly realMasks: { activeU: Uint8Array; activeV: Uint8Array }) {}

  gradient(maskMode: 'real' | 'recipe', topActive: boolean, phi: Float64Array): { gu: Float64Array; gv: Float64Array; gw: Float64Array } {
    const v = this.par.v;
    const m = this.par.m;
    const masks = maskMode === 'real' ? this.realMasks : maskRecipe(m.nU, m.nV);
    (v.activeU as Uint8Array).set(masks.activeU);
    (v.activeV as Uint8Array).set(masks.activeV);
    (v.phi as Float64Array).set(phi);
    this.par.gradient(topActive);
    return { gu: v.gu as Float64Array, gv: v.gv as Float64Array, gw: v.gw as Float64Array };
  }

  divergence(u: Float32Array | Float64Array, vv: Float32Array | Float64Array, w: Float32Array | Float64Array, scaleU: number, scaleW: number): Float64Array {
    const v = this.par.v;
    const f32 = u instanceof Float32Array;
    (v[f32 ? 'u' : 'fu'] as Float32Array).set(u as Float32Array);
    (v[f32 ? 'v' : 'fv'] as Float32Array).set(vv as Float32Array);
    (v[f32 ? 'w' : 'fw'] as Float32Array).set(w as Float32Array);
    this.par.divergence(f32, scaleU, scaleW);
    return v.out as Float64Array;
  }

  advect(dx: Float32Array, dy: Float32Array, dz: Float32Array, src: Float32Array, nxF: number, nyF: number, nzF: number, ox: number, oy: number, oz: number, src2: Float32Array | null): { dst: Float32Array; dst2: Float32Array | null } {
    const v = this.par.v;
    (v.Dx as Float32Array).set(dx);
    (v.Dy as Float32Array).set(dy);
    (v.Dz as Float32Array).set(dz);
    (v.sA as Float32Array).set(src);
    if (src2) (v.sB as Float32Array).set(src2);
    this.par.advect(AirPar.ADVECT_STAGING, nxF, nyF, nzF, ox, oy, oz, src2 !== null);
    const nF = nxF * nyF * nzF;
    return { dst: (v.tA as Float32Array).subarray(0, nF), dst2: src2 ? (v.tB as Float32Array).subarray(0, nF) : null };
  }

  relax(level: number, b: Float32Array, x: Float32Array, sweeps: number, reverse: boolean): Float32Array {
    const m = this.par.m;
    const call = m.relaxCalls.findIndex((c) => c.level === level);
    if (call < 0) throw new Error(`no recorded relax call on level ${level}`);
    const v = this.par.v;
    (v[`C${call}.b`] as Float32Array).set(b);
    const xs = v[`C${call}.x`] as Float32Array;
    xs.set(x);
    const keep = this.par.minParallelCells;
    this.par.minParallelCells = 0; // as the C# test: force chunked passes on every level
    try {
      this.par.relax(call, sweeps, reverse);
    } finally {
      this.par.minParallelCells = keep;
    }
    return xs;
  }
}

/** The timed operations of `air/bench.ts` in the pool form. Call `reload` (via `fillAirResident`) after golden replays: they overwrite the arena's inputs. */
export function airOpsPool(par: AirPar): Record<string, () => number> {
  const m = par.m;
  const v = par.v;
  const { nx, ny, nz } = m;
  const calls = m.relaxCalls.map((c, i) => ({ x: v[`C${i}.x`] as Float32Array, xIn: v[`C${i}.xIn`] as Float32Array, sweeps: c.sweeps, reverse: c.reverse }));
  let sink = 0;
  const gu = v.gu as Float64Array, out = v.out as Float64Array, dth = v.dth as Float32Array;
  return {
    relax: () => {
      for (let i = 0; i < calls.length; i++) {
        const c = calls[i]!;
        c.x.set(c.xIn);
        par.relax(i, c.sweeps, c.reverse);
      }
      sink += calls[0]!.x[0]!;
      return sink;
    },
    gradient: () => {
      par.gradient(m.topActive);
      sink += gu[1]!;
      return sink;
    },
    divergenceF32: () => {
      par.divergence(true, 1, 1);
      sink += out[1]!;
      return sink;
    },
    divergenceF64: () => {
      par.divergence(false, 1, 1);
      sink += out[1]!;
      return sink;
    },
    advect: () => {
      par.advect(AirPar.ADVECT_U, nx + 1, ny, nz, 0.5, 0, 0, false);
      par.advect(AirPar.ADVECT_V, nx, ny + 1, nz, 0, 0.5, 0, false);
      par.advect(AirPar.ADVECT_W, nx, ny, nz + 1, 0, 0, 0.5, false);
      par.advect(AirPar.ADVECT_THSM, nx, ny, nz, 0, 0, 0, true);
      sink += dth[1]!;
      return sink;
    },
  };
}
