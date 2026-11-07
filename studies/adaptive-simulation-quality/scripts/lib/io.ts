/**
 * A tiny container for the per-site fields of this study: one JSON header line, then the raw bytes of each typed array,
 * all gzipped (fflate, already a dependency of the app). Written by 01_baseline.run.ts, read by 02_analyse.run.ts, so the
 * analysis can be re-run without re-running the simulation.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'fflate';

export type Arr = Float32Array | Uint8Array | Int32Array | Float64Array;

interface Entry {
  name: string;
  type: 'f32' | 'u8' | 'i32' | 'f64';
  length: number;
}

const typeOf = (a: Arr): Entry['type'] => (a instanceof Float32Array ? 'f32' : a instanceof Uint8Array ? 'u8' : a instanceof Int32Array ? 'i32' : 'f64');
const SIZE: Record<Entry['type'], number> = { f32: 4, u8: 1, i32: 4, f64: 8 };

export function saveFields(path: string, meta: unknown, arrays: Record<string, Arr>): number {
  const entries: Entry[] = Object.entries(arrays).map(([name, a]) => ({ name, type: typeOf(a), length: a.length }));
  const header = Buffer.from(JSON.stringify({ entries, meta }) + '\n', 'utf8');
  const total = entries.reduce((s, e) => s + e.length * SIZE[e.type], 0);
  const body = Buffer.alloc(header.length + total);
  header.copy(body, 0);
  let off = header.length;
  for (const [, a] of Object.entries(arrays)) {
    Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(body, off);
    off += a.byteLength;
  }
  const gz = gzipSync(new Uint8Array(body.buffer, body.byteOffset, body.length), { level: 9 });
  writeFileSync(path, gz);
  return gz.length;
}

export function loadFields<M = unknown>(path: string): { meta: M; a: Record<string, Arr> } {
  const raw = Buffer.from(gunzipSync(new Uint8Array(readFileSync(path))));
  const nl = raw.indexOf(10);
  const head = JSON.parse(raw.subarray(0, nl).toString('utf8')) as { entries: Entry[]; meta: M };
  const a: Record<string, Arr> = {};
  let off = nl + 1;
  for (const e of head.entries) {
    const bytes = e.length * SIZE[e.type];
    const copy = new Uint8Array(raw.subarray(off, off + bytes)); // aligned copy
    off += bytes;
    a[e.name] = e.type === 'f32' ? new Float32Array(copy.buffer) : e.type === 'u8' ? copy : e.type === 'i32' ? new Int32Array(copy.buffer) : new Float64Array(copy.buffer);
  }
  return { meta: head.meta, a };
}
