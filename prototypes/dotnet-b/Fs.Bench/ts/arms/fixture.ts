/**
 * T1.5: reads a T1.4a / T1.4b fixture folder (header.json + data.bin, `Fs.Bench/ts/air/lib.ts` format) from memory, so that Node (fs) and a browser (fetch) can both use it.
 * `get(name)` returns a COPY (the kernels write into their inputs), as `air/lib.ts` `loadFixture` does, including the int32 fix of T1.4b.
 */
import type { Typed } from './sha';

export interface ArrayEntry {
  name: string;
  type: 'float32' | 'float64' | 'uint8' | 'int32';
  length: number;
  byteOffset: number;
}
export interface Header {
  arrays: ArrayEntry[];
  cases: Record<string, unknown>[];
  scenario: string;
  window?: string;
  [k: string]: unknown;
}
export interface Fixture {
  name: string;
  header: Header;
  /** a copy of the named array */
  get: (name: string) => Typed;
  has: (name: string) => boolean;
  dataBytes: number;
}

export function makeFixture(name: string, headerJson: string, data: ArrayBuffer): Fixture {
  const header = JSON.parse(headerJson) as Header;
  const table = new Map(header.arrays.map((a) => [a.name, a]));
  const get = (n: string): Typed => {
    const a = table.get(n);
    if (!a) throw new Error(`fixture ${name} has no array ${n}`);
    const T = a.type === 'float32' ? Float32Array : a.type === 'float64' ? Float64Array : a.type === 'int32' ? Int32Array : Uint8Array;
    return new T(data.slice(a.byteOffset, a.byteOffset + a.length * T.BYTES_PER_ELEMENT)) as unknown as Typed;
  };
  return { name, header, get, has: (n) => table.has(n), dataBytes: data.byteLength };
}

/** Node: `loadDir` in `node-io.ts`; browser: `fetchFixture` in the page code. This one only takes the two blobs. */
export type RawFixture = { name: string; header: string; data: ArrayBuffer };
