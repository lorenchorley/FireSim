/**
 * T1.5 (a), (c) one worker: the standard tier's air kernels as the app has them, UNMODIFIED (`EllipticSolver.prototype.relax/gradient/divergence` of src/atmosphere/solver.ts through a plain
 * object as `this`, and `advect` of src/atmosphere/dynamics.ts), run on the fixture's data resident in the worker. This is the same replay as `Fs.Bench/ts/air/lib.ts` and `bench.ts`
 * (T1.4a's TypeScript arm), made free of `node:*` imports so that it also runs in a browser worker. Nothing in src/ is edited or wrapped.
 */
import { EllipticSolver } from '../../../../../src/atmosphere/solver';
import { advect } from '../../../../../src/atmosphere/dynamics';
import { maskRecipe, type AirBackend } from './air-cases';
import type { Fixture } from './fixture';

interface Proto {
  gradient: (phi: Float64Array) => { gu: Float64Array; gv: Float64Array; gw: Float64Array };
  divergence: (u: ArrayLike<number>, v: ArrayLike<number>, w: ArrayLike<number>, out: Float64Array, scaleU?: number, scaleW?: number) => void;
  relax: (L: unknown, sweeps: number, reverse: boolean) => void;
}
const P = EllipticSolver.prototype as unknown as Proto;

interface Shell { g: Record<string, unknown> & { nx: number; ny: number; nz: number; n: number; nU: number; nV: number; nW: number }; self: Record<string, unknown>; masks: { activeU: Uint8Array; activeV: Uint8Array; topActive: boolean } }

/** The solver's `this`, as the three methods read it (`air/lib.ts` makeShell). */
function makeShell(fx: Fixture): Shell {
  const h = fx.header as unknown as { grid: Record<string, number>; topActive: boolean };
  const f64 = (n: string): Float64Array => fx.get(n) as Float64Array;
  const g = {
    ...h.grid,
    dzeta: f64('grid.dzeta'), dzetaW: f64('grid.dzetaW'), J: f64('grid.J'), Ju: f64('grid.Ju'), Jv: f64('grid.Jv'), zsx: f64('grid.zsx'), zsy: f64('grid.zsy'),
  } as unknown as Shell['g'];
  const masks = { activeU: fx.get('masks.activeU') as Uint8Array, activeV: fx.get('masks.activeV') as Uint8Array, topActive: h.topActive };
  const self: Record<string, unknown> = {
    g, masks, fzeta: f64('solver.fzeta'),
    sx: new Float64Array(g.nW), sy: new Float64Array(g.nW), wt: new Float64Array(g.nW), gu: new Float64Array(g.nU), gv: new Float64Array(g.nV), gw: new Float64Array(g.nW),
  };
  return { g, self, masks };
}

export class AppAir implements AirBackend {
  readonly shell: Shell;
  private readonly realMasks: Shell['masks'];
  constructor(private readonly fx: Fixture) {
    this.shell = makeShell(fx);
    this.realMasks = { ...this.shell.masks };
  }

  gradient(maskMode: 'real' | 'recipe', topActive: boolean, phi: Float64Array): { gu: Float64Array; gv: Float64Array; gw: Float64Array } {
    const sh = this.shell;
    if (maskMode === 'recipe') {
      const m = maskRecipe(sh.g.nU, sh.g.nV);
      sh.self.masks = { activeU: m.activeU, activeV: m.activeV, topActive };
    } else sh.self.masks = { ...this.realMasks, topActive };
    return P.gradient.call(sh.self as never, phi);
  }

  divergence(u: Float32Array | Float64Array, v: Float32Array | Float64Array, w: Float32Array | Float64Array, scaleU: number, scaleW: number): Float64Array {
    const out = new Float64Array(this.shell.g.n);
    P.divergence.call(this.shell.self as never, u, v, w, out, scaleU, scaleW);
    return out;
  }

  advect(dx: Float32Array, dy: Float32Array, dz: Float32Array, src: Float32Array, nxF: number, nyF: number, nzF: number, ox: number, oy: number, oz: number, src2: Float32Array | null): { dst: Float32Array; dst2: Float32Array | null } {
    const dst = new Float32Array(nxF * nyF * nzF);
    const dst2 = src2 ? new Float32Array(dst.length) : null;
    advect(this.shell.g as never, dx, dy, dz, src, dst, nxF, nyF, nzF, ox, oy, oz, src2, dst2);
    return { dst, dst2 };
  }

  relax(level: number, b: Float32Array, x: Float32Array, sweeps: number, reverse: boolean): Float32Array {
    const d = (this.fx.header as unknown as { levels: { nx: number; ny: number; nz: number }[] }).levels[level]!;
    const plane = d.nx * d.ny;
    const f32 = (k: string): Float32Array => this.fx.get(`level${level}.${k}`) as Float32Array;
    const L = { nx: d.nx, ny: d.ny, nz: d.nz, plane, n: plane * d.nz, cx: f32('cx'), cy: f32('cy'), cz: f32('cz'), tInv: f32('tInv'), tC: f32('tC'), b, x };
    P.relax.call({} as never, L, sweeps, reverse);
    return x;
  }
}

/** The timed operations of `air/bench.ts`, on resident data: one operation = what `Fs.Bench/AirBench.cs` times. */
export function airOpsApp(fx: Fixture): Record<string, () => number> {
  const h = fx.header as unknown as { grid: { nx: number; ny: number; nz: number; n: number }; levels: { nx: number; ny: number; nz: number }[]; relaxCalls: { level: number; sweeps: number; reverse: boolean }[] };
  const { nx, ny, nz, n } = h.grid;
  const shell = makeShell(fx);
  const f32 = (name: string): Float32Array => fx.get(name) as Float32Array;
  const f64 = (name: string): Float64Array => fx.get(name) as Float64Array;
  const phi = f64('field.phi');
  const u = f32('field.u'), v = f32('field.v'), w = f32('field.w'), th = f32('field.th'), sm = f32('field.sm');
  const gu = f64('derived.gu'), gv = f64('derived.gv'), gw = f64('derived.gw');
  const Dx = f32('derived.Dx'), Dy = f32('derived.Dy'), Dz = f32('derived.Dz');
  const out = new Float64Array(n);
  const du = new Float32Array((nx + 1) * ny * nz), dv = new Float32Array(nx * (ny + 1) * nz), dw = new Float32Array(nx * ny * (nz + 1)), dth = new Float32Array(n), dsm = new Float32Array(n);
  const levels = h.levels.map((d, l) => {
    const plane = d.nx * d.ny;
    return { nx: d.nx, ny: d.ny, nz: d.nz, plane, n: plane * d.nz, cx: f32(`level${l}.cx`), cy: f32(`level${l}.cy`), cz: f32(`level${l}.cz`), tInv: f32(`level${l}.tInv`), tC: f32(`level${l}.tC`) };
  });
  const calls = h.relaxCalls.map((c, i) => {
    const xIn = f32(`call${i}.x`);
    const L = { ...levels[c.level]!, b: f32(`call${i}.b`), x: new Float32Array(xIn.length) };
    return { L, xIn, sweeps: c.sweeps, reverse: c.reverse };
  });
  let sink = 0;
  return {
    relax: () => {
      for (const c of calls) {
        c.L.x.set(c.xIn);
        P.relax.call({} as never, c.L, c.sweeps, c.reverse);
      }
      sink += calls[0]!.L.x[0]!;
      return sink;
    },
    gradient: () => {
      sink += P.gradient.call(shell.self as never, phi).gu[1]!;
      return sink;
    },
    divergenceF32: () => {
      P.divergence.call(shell.self as never, u, v, w, out, 1, 1);
      sink += out[1]!;
      return sink;
    },
    divergenceF64: () => {
      P.divergence.call(shell.self as never, gu, gv, gw, out, 1, 1);
      sink += out[1]!;
      return sink;
    },
    advect: () => {
      const g = shell.g;
      advect(g as never, Dx, Dy, Dz, u, du, nx + 1, ny, nz, 0.5, 0, 0);
      advect(g as never, Dx, Dy, Dz, v, dv, nx, ny + 1, nz, 0, 0.5, 0);
      advect(g as never, Dx, Dy, Dz, w, dw, nx, ny, nz + 1, 0, 0, 0.5);
      advect(g as never, Dx, Dy, Dz, th, dth, nx, ny, nz, 0, 0, 0, sm, dsm);
      sink += dth[1]!;
      return sink;
    },
  };
}
