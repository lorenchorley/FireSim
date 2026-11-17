/**
 * T1.5: replays the golden cases of the standard-tier fixtures (Fs.Tests/golden/air-*.json = the `cases` of the fixture's header.json) on any backend, and compares the output hashes with the
 * unmodified TypeScript's. The recipes are those of `Fs.Bench/ts/air/capture.ts` (which made the goldens) and `Fs.Tests/AirTestData.cs` (which replays them in C#): poison, masks, which array is which.
 * A backend takes inputs as plain typed arrays and returns the outputs; what is inside (the app's own functions, or the pool over SharedArrayBuffer) is its business.
 */
import { canonHash, type Typed } from './sha';
import type { Fixture } from './fixture';

export interface AirBackend {
  gradient(maskMode: 'real' | 'recipe', topActive: boolean, phi: Float64Array): { gu: Float64Array; gv: Float64Array; gw: Float64Array };
  divergence(u: Float32Array | Float64Array, v: Float32Array | Float64Array, w: Float32Array | Float64Array, scaleU: number, scaleW: number): Float64Array;
  advect(dx: Float32Array, dy: Float32Array, dz: Float32Array, src: Float32Array, nxF: number, nyF: number, nzF: number, ox: number, oy: number, oz: number, src2: Float32Array | null): { dst: Float32Array; dst2: Float32Array | null };
  relax(level: number, b: Float32Array, x: Float32Array, sweeps: number, reverse: boolean): Float32Array;
}

/** NaN at every 331st element from `salt`, then -0 at every 211th from `salt + 7` (the second pass wins an overlap): `air/lib.ts` poison */
export function poison(a: Float32Array | Float64Array, salt: number): void {
  for (let i = salt; i < a.length; i += 331) a[i] = NaN;
  for (let i = salt + 7; i < a.length; i += 211) a[i] = -0;
}

interface GoldenCase {
  id: string;
  kernel: string;
  params: Record<string, unknown>;
  inputs: { role: string; array: string; poison?: number }[];
  outputs: { role: string; hash: string }[];
  inputHashes: Record<string, string>;
}

export interface CaseResult { id: string; kernel: string; checks: number; mismatches: string[]; actual: unknown }

export function runAirCases(fx: Fixture, be: AirBackend, filter?: (kernel: string) => boolean): CaseResult[] {
  const h = fx.header as unknown as { grid: { nU: number; nV: number }; cases: GoldenCase[] };
  const results: CaseResult[] = [];
  for (const c of h.cases) {
    if (filter && !filter(c.kernel)) continue;
    const ins: Record<string, string> = {};
    const outs: Record<string, string> = {};
    const arr = <T extends Float32Array | Float64Array>(i: GoldenCase['inputs'][number]): T => {
      const a = fx.get(i.array) as T;
      if (typeof i.poison === 'number') poison(a, i.poison);
      ins[i.role] = canonHash(a);
      return a;
    };
    const p = c.params;
    switch (c.kernel) {
      case 'gradient': {
        const r = be.gradient(p.maskMode as 'real' | 'recipe', p.topActive as boolean, arr<Float64Array>(c.inputs[0]!));
        outs.gu = canonHash(r.gu);
        outs.gv = canonHash(r.gv);
        outs.gw = canonHash(r.gw);
        break;
      }
      case 'divergence': {
        const isF32 = fx.header.arrays.find((a) => a.name === c.inputs[0]!.array)!.type === 'float32';
        const [u, v, w] = c.inputs.map((i) => (isF32 ? arr<Float32Array>(i) : arr<Float64Array>(i))) as [Float32Array, Float32Array, Float32Array];
        outs.out = canonHash(be.divergence(u, v, w, p.scaleU as number, p.scaleW as number));
        break;
      }
      case 'advect': {
        const dual = p.dual as boolean;
        const [dx, dy, dz, src] = c.inputs.slice(0, 4).map((i) => arr<Float32Array>(i)) as [Float32Array, Float32Array, Float32Array, Float32Array];
        const src2 = dual ? arr<Float32Array>(c.inputs[4]!) : null;
        const r = be.advect(dx, dy, dz, src, p.nxF as number, p.nyF as number, p.nzF as number, p.ox as number, p.oy as number, p.oz as number, src2);
        outs.dst = canonHash(r.dst);
        if (dual) outs.dst2 = canonHash(r.dst2!);
        break;
      }
      case 'relax': {
        const b = arr<Float32Array>(c.inputs[0]!);
        const x = arr<Float32Array>(c.inputs[1]!);
        outs.x = canonHash(be.relax(p.level as number, b, x, p.sweeps as number, p.reverse as boolean));
        break;
      }
      default:
        throw new Error(`unknown kernel ${c.kernel}`);
    }
    const mism: string[] = [];
    let checks = 0;
    for (const o of c.outputs) {
      checks++;
      if (outs[o.role] !== o.hash) mism.push(`output ${o.role}: ${outs[o.role]} != ${o.hash}`);
    }
    for (const [role, hh] of Object.entries(c.inputHashes)) {
      checks++;
      if (ins[role] !== hh) mism.push(`input ${role}: ${ins[role]} != ${hh}`);
    }
    results.push({ id: c.id, kernel: c.kernel, checks, mismatches: mism, actual: { outs, ins } });
  }
  return results;
}

/** the mask recipe of capture.ts `maskRecipe` */
export function maskRecipe(nU: number, nV: number): { activeU: Uint8Array; activeV: Uint8Array } {
  const au = new Uint8Array(nU);
  const av = new Uint8Array(nV);
  for (let f = 0; f < au.length; f++) au[f] = f % 3 === 0 ? 0 : 1;
  for (let f = 0; f < av.length; f++) av[f] = f % 5 === 0 ? 0 : 1;
  return { activeU: au, activeV: av };
}

export type { Typed };
