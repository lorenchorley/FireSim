/**
 * Shared by capture.ts and bench.ts (card T1.4a, the standard tier's air kernels). The fixture is a folder: header.json (scalars, the array table, the cases)
 * and data.bin (little-endian typed arrays, each 8-byte aligned). Everything that the REAL, UNMODIFIED TypeScript kernels need is rebuilt from it:
 * `EllipticSolver.prototype.gradient/divergence/relax` are called with a plain object as `this` (they read only `g`, `masks`, `fzeta` and their scratch arrays),
 * `advect` is a module function. Nothing in src/ is edited or wrapped.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EllipticSolver } from '../../../../../src/atmosphere/solver';
import { advect } from '../../../../../src/atmosphere/dynamics';

export type Typed = Float32Array | Float64Array | Uint8Array;
export interface ArrayEntry {
  name: string;
  type: 'float32' | 'float64' | 'uint8';
  length: number;
  byteOffset: number;
}
export interface Header {
  arrays: ArrayEntry[];
  [k: string]: unknown;
}
export interface Fixture {
  header: Header;
  get: (name: string) => Typed;
}

export function loadFixture(dir: string): Fixture {
  const header = JSON.parse(readFileSync(`${dir}/header.json`, 'utf8')) as Header;
  const buf = readFileSync(`${dir}/data.bin`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const table = new Map(header.arrays.map((a) => [a.name, a]));
  const get = (name: string): Typed => {
    const a = table.get(name);
    if (!a) throw new Error(`fixture has no array ${name}`);
    const T = a.type === 'float32' ? Float32Array : a.type === 'float64' ? Float64Array : Uint8Array;
    return new T(ab.slice(a.byteOffset, a.byteOffset + a.length * T.BYTES_PER_ELEMENT)); // a copy: kernels write
  };
  return { header, get };
}

/** SHA-256 (first 32 hex digits) of the raw bytes with every NaN replaced by the canonical quiet NaN (NaN payloads differ by architecture), -0 kept. */
export function canonHash(a: Typed): string {
  let bytes: Uint8Array;
  if (a instanceof Float64Array) {
    const c = new Float64Array(a);
    const u = new Uint32Array(c.buffer);
    for (let i = 0; i < c.length; i++) {
      if (c[i] !== c[i]) {
        u[2 * i] = 0;
        u[2 * i + 1] = 0x7ff80000;
      }
    }
    bytes = new Uint8Array(c.buffer);
  } else if (a instanceof Float32Array) {
    const c = new Float32Array(a);
    const u = new Uint32Array(c.buffer);
    for (let i = 0; i < c.length; i++) if (c[i] !== c[i]) u[i] = 0x7fc00000;
    bytes = new Uint8Array(c.buffer);
  } else bytes = a;
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}

/** The edge-case recipe, repeated exactly in the C# tests: NaN at every 331st element from `salt`, then -0 at every 211th from `salt + 7` (the second pass wins an overlap). */
export function poison(a: Float32Array | Float64Array, salt: number): void {
  for (let i = salt; i < a.length; i += 331) a[i] = NaN;
  for (let i = salt + 7; i < a.length; i += 211) a[i] = -0;
}

export interface GridShell {
  nx: number;
  ny: number;
  nz: number;
  plane: number;
  n: number;
  nU: number;
  nV: number;
  nW: number;
  dx: number;
  Hp: number;
  dzeta: Float64Array;
  dzetaW: Float64Array;
  J: Float64Array;
  Ju: Float64Array;
  Jv: Float64Array;
  zsx: Float64Array;
  zsy: Float64Array;
}
export interface Shell {
  g: GridShell;
  self: Record<string, unknown>;
  masks: { activeU: Uint8Array; activeV: Uint8Array; topActive: boolean };
}

/** The solver's `this`, as the three methods read it. Scratch arrays are allocated here, zeroed, as the constructor does. */
export function makeShell(fx: Fixture): Shell {
  const h = fx.header as unknown as { grid: Record<string, number>; topActive: boolean };
  const f64 = (n: string): Float64Array => fx.get(n) as Float64Array;
  const g = {
    ...h.grid,
    dzeta: f64('grid.dzeta'),
    dzetaW: f64('grid.dzetaW'),
    J: f64('grid.J'),
    Ju: f64('grid.Ju'),
    Jv: f64('grid.Jv'),
    zsx: f64('grid.zsx'),
    zsy: f64('grid.zsy'),
  } as unknown as GridShell;
  const masks = { activeU: fx.get('masks.activeU') as Uint8Array, activeV: fx.get('masks.activeV') as Uint8Array, topActive: h.topActive };
  const self: Record<string, unknown> = {
    g,
    masks,
    fzeta: f64('solver.fzeta'),
    sx: new Float64Array(g.nW),
    sy: new Float64Array(g.nW),
    wt: new Float64Array(g.nW),
    gu: new Float64Array(g.nU),
    gv: new Float64Array(g.nV),
    gw: new Float64Array(g.nW),
  };
  return { g, self, masks };
}

interface Proto {
  gradient: (phi: Float64Array) => { gu: Float64Array; gv: Float64Array; gw: Float64Array };
  divergence: (u: ArrayLike<number>, v: ArrayLike<number>, w: ArrayLike<number>, out: Float64Array, scaleU?: number, scaleW?: number) => void;
  relax: (L: unknown, sweeps: number, reverse: boolean) => void;
}
const P = EllipticSolver.prototype as unknown as Proto;
export const gradient = (sh: Shell, phi: Float64Array): { gu: Float64Array; gv: Float64Array; gw: Float64Array } => P.gradient.call(sh.self as never, phi);
export const divergence = (sh: Shell, u: ArrayLike<number>, v: ArrayLike<number>, w: ArrayLike<number>, out: Float64Array, scaleU = 1, scaleW = 1): void =>
  P.divergence.call(sh.self as never, u, v, w, out, scaleU, scaleW);
export const relax = (L: unknown, sweeps: number, reverse: boolean): void => P.relax.call({} as never, L, sweeps, reverse);
export { advect };
