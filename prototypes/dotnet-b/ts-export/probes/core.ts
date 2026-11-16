/**
 * Probe runtime (card T3.4): hashing, value descriptors, the call recorder and the blob store. Bundled with the solver by run.mjs --probes and
 * started by export.ts (FS_PROBES=1) through install.ts. Nothing here runs unless startProbes() was called, and nothing here mutates a value it is
 * given: arguments are read (hashed or encoded) before and after a call, and the call is made with the same `this` and the same arguments.
 *
 * Descriptor ("leaf") format of a hashed value, JSON:
 *   number            JSON number; NaN, +-Infinity and -0 as {"$num":"NaN"|"Infinity"|"-Infinity"|"-0"} (as the codec of src/sim/remote/codec.ts)
 *   typed array       {"$ta":"f32","n":<elements>,"h":"<8 hex digits>"}  h = FNV-1a 32 over the array's bytes (src/sim/testing/hash.ts `fnv`, start 0x811c9dc5)
 *   plain array       up to 32 elements: a JSON array of descriptors; longer: {"$arr":"f64","n":N,"h":..} (all numbers: FNV over the float64 bytes) or
 *                     {"$arr":"mixed","n":N,"h":..} (FNV over the UTF-8 of the JSON of the descriptors)
 *   plain object      an object with a descriptor per own enumerable field (insertion order)
 *   class instance    {"$class":"Name", <own number/boolean/string/typed-array fields>}
 *   undefined         {"$undef":1}      function {"$fn":1}      Map/Set {"$map":size}      too deep {"$deep":1}      cycle {"$cycle":1}
 */
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { encodeValue } from '../../../../src/sim/remote/codec';

export type Win = 'init' | 'spin' | 'w0' | 'w600' | 'w900';
const RAW_WINDOWS: Win[] = ['init', 'spin', 'w0', 'w900'];
export const WINDOWS: readonly Win[] = ['init', 'spin', 'w0', 'w600', 'w900'];

// ── hashing ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const FNV0 = 0x811c9dc5;
export function fnv(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
export const hex8 = (h: number): string => (h >>> 0).toString(16).padStart(8, '0');
const bytesOf = (v: ArrayBufferView): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
export const hashArray = (v: ArrayBufferView): string => hex8(fnv(FNV0, bytesOf(v)));

const TAG: Readonly<Record<string, string>> = { Float32Array: 'f32', Float64Array: 'f64', Int8Array: 'i8', Uint8Array: 'u8', Uint8ClampedArray: 'u8c', Int16Array: 'i16', Uint16Array: 'u16', Int32Array: 'i32', Uint32Array: 'u32', BigInt64Array: 'i64', BigUint64Array: 'u64' };
export const tagOf = (v: ArrayBufferView): string => TAG[(v as { constructor: { name: string } }).constructor.name] ?? 'dv';

const f1 = new Float64Array(1);
const f1b = new Uint8Array(f1.buffer);
const isPlain = (v: object): boolean => {
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

export const numLeaf = (v: number): unknown => (Number.isFinite(v) ? (Object.is(v, -0) ? { $num: '-0' } : v) : { $num: String(v) });

const MAX_DEPTH = 6;
const MAX_KEYS = 256;

/** Descriptor of a value (see the header of this file). */
export function leafOf(v: unknown, depth = 0, seen: Set<object> = new Set()): unknown {
  switch (typeof v) {
    case 'number':
      return numLeaf(v);
    case 'boolean':
    case 'string':
      return v;
    case 'undefined':
      return { $undef: 1 };
    case 'function':
      return { $fn: 1 };
    case 'bigint':
      return { $big: String(v) };
    case 'symbol':
      return { $sym: 1 };
  }
  if (v === null) return null;
  const o = v as object;
  if (ArrayBuffer.isView(o)) return { $ta: tagOf(o), n: (o as unknown as { length: number }).length ?? o.byteLength, h: hashArray(o) };
  if (depth > MAX_DEPTH) return { $deep: 1 };
  if (seen.has(o)) return { $cycle: 1 };
  if (o instanceof Map || o instanceof Set) return { $map: o.size };
  seen.add(o);
  try {
    if (Array.isArray(o)) {
      if (o.length <= 32) return o.map((x) => leafOf(x, depth + 1, seen));
      if (o.every((x) => typeof x === 'number')) {
        const a = Float64Array.from(o as number[]);
        return { $arr: 'f64', n: o.length, h: hashArray(a) };
      }
      const js = JSON.stringify(o.map((x) => leafOf(x, depth + 1, seen)));
      return { $arr: 'mixed', n: o.length, h: hex8(fnv(FNV0, new TextEncoder().encode(js))) };
    }
    const out: Record<string, unknown> = {};
    if (!isPlain(o)) {
      out.$class = (o as { constructor?: { name?: string } }).constructor?.name ?? '?';
      for (const k of Object.keys(o).slice(0, MAX_KEYS)) {
        const x = (o as Record<string, unknown>)[k];
        if (typeof x === 'number' || typeof x === 'boolean' || typeof x === 'string' || ArrayBuffer.isView(x)) out[k] = leafOf(x);
      }
      return out;
    }
    for (const k of Object.keys(o).slice(0, MAX_KEYS)) out[k] = leafOf((o as Record<string, unknown>)[k], depth + 1, seen);
    return out;
  } finally {
    seen.delete(o);
  }
}

/**
 * A copy of a value in the form the codec can carry (src/sim/remote/codec.ts `encodeValue`): typed arrays kept as they are (the encoder copies
 * them at once), class instances reduced to their number/boolean/string fields (and typed-array fields at depth 0), `undefined` dropped in an
 * object and null in an array, functions and Maps dropped. `budget.bytes` is decremented by the bytes of every typed array; a negative budget
 * means "too big, do not write" (the caller checks it).
 */
export function plainify(v: unknown, budget: { bytes: number }, depth = 0, seen: Set<object> = new Set(), copy = false): unknown {
  switch (typeof v) {
    case 'number':
    case 'boolean':
    case 'string':
      return v;
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    case 'bigint':
      return String(v);
  }
  if (v === null) return null;
  const o = v as object;
  if (ArrayBuffer.isView(o)) {
    if (!tagOf(o) || tagOf(o) === 'dv') return undefined;
    budget.bytes -= o.byteLength;
    return copy ? (o as unknown as { slice(): ArrayBufferView }).slice() : o;
  }
  if (depth > 12 || seen.has(o) || o instanceof Map || o instanceof Set) return undefined;
  seen.add(o);
  try {
    if (Array.isArray(o)) return o.map((x) => plainify(x, budget, depth + 1, seen, copy) ?? null);
    const out: Record<string, unknown> = {};
    const plain = isPlain(o);
    if (!plain) out.$class = (o as { constructor?: { name?: string } }).constructor?.name ?? '?';
    for (const k of Object.keys(o).slice(0, 512)) {
      const x = (o as Record<string, unknown>)[k];
      if (!plain && typeof x === 'object' && x !== null && !ArrayBuffer.isView(x)) continue;
      const p = plainify(x, budget, depth + 1, seen, copy);
      if (p !== undefined) out[k] = p;
    }
    return out;
  } finally {
    seen.delete(o);
  }
}

// ── blob store: raw arrays of the tapes, appended to one file, deduplicated by content ───────────────────────────

export interface BlobRef {
  o: number;
  n: number;
  k: string;
}

export class BlobStore {
  private fd: number;
  private off = 0;
  private readonly seen = new Map<string, BlobRef>();
  bytesWritten = 0;
  constructor(readonly path: string) {
    this.fd = openSync(path, 'w');
  }
  /** Writes the array (once per distinct content) and returns where it is; `o` is a multiple of 8. */
  put(v: ArrayBufferView): BlobRef {
    const key = `${tagOf(v)}:${(v as unknown as { length: number }).length}:${hashArray(v)}`;
    const hit = this.seen.get(key);
    if (hit) return hit;
    const b = bytesOf(v);
    const ref: BlobRef = { o: this.off, n: (v as unknown as { length: number }).length, k: tagOf(v) };
    writeSync(this.fd, b);
    const pad = (8 - (b.length % 8)) % 8;
    if (pad) writeSync(this.fd, new Uint8Array(pad));
    this.off += b.length + pad;
    this.bytesWritten = this.off;
    this.seen.set(key, ref);
    return ref;
  }
  close(): void {
    closeSync(this.fd);
  }
}

// ── the recorder ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface ProbeOpts {
  /** The first `first` calls of each window are recorded (default 6) ... */
  first?: number;
  /** ... and, from then on, every `stride`-th call, up to `max` recorded calls in all (default: no stride). */
  stride?: number;
  max?: number;
  /** Calls per window that also write a raw codec frame (arguments before and after, result, state before and after). */
  raw?: number;
  /** Windows in which raw frames are written (default: init, spin, w0, w900). */
  rawIn?: Win[];
  /** A raw frame bigger than this many bytes of arrays is not written (default 4 MiB). */
  rawMaxBytes?: number;
  /** State digest of `this` before and after a method call: 'own' (own typed arrays and scalars), 'fire', 'ember', 'atm', 'moist', or a list of field names. */
  state?: 'own' | 'fire' | 'ember' | 'atm' | 'moist' | string[];
  /** Arguments to leave out of the descriptors (indices): e.g. callbacks. */
  skipArgs?: number[];
  /** Appends the call to the in-window call sequence (the order of the per-step calls of Simulation.stepOnce). */
  seq?: boolean;
  /** While the call runs, draws of the random generators are labelled with this. */
  label?: string;
}

export interface ProbeRow {
  id: string;
  area: string;
  file: string;
  /** 'Name' for a module function, 'Class.method' for a method. */
  name: string;
  opts: ProbeOpts;
}

export interface CallRecord {
  i: number;
  t: number;
  a: unknown[];
  z?: Record<string, unknown>;
  r?: unknown;
  s?: { b: unknown; a: unknown };
  raw?: string;
  rawSkipped?: string;
  threw?: string;
}

export interface ProbeState {
  row: ProbeRow;
  idx: number;
  n: Record<string, number>;
  rec: Record<string, CallRecord[]>;
  nrec: Record<string, number>;
  nraw: Record<string, number>;
}

export interface Digest {
  /** Descriptors of the state of `self`. */
  leaf: (self: unknown) => unknown;
  /** The same state as plain data for a raw frame (budget.bytes is decremented by every array). */
  raw: (self: unknown, budget: { bytes: number }, copy?: boolean) => unknown;
}

export class ProbeRuntime {
  on = false;
  win: Win | null = 'init';
  t = -1;
  step = -1;
  label = '';
  readonly probes = new Map<string, ProbeState>();
  readonly list: ProbeState[] = [];
  readonly seq: Record<string, number[]> = { init: [], spin: [], w0: [], w600: [], w900: [] };
  readonly digests: Record<string, Digest> = {};
  outDir = '';
  rawBytes = 0;
  rawBudget = 120e6;
  rawFiles = 0;
  /** Totals of what was cut, for the index. */
  cut = { rawBudget: 0 };

  register(rows: readonly ProbeRow[]): void {
    for (const row of rows) {
      const ps: ProbeState = { row, idx: this.list.length, n: {}, rec: {}, nrec: {}, nraw: {} };
      this.probes.set(row.id, ps);
      this.list.push(ps);
    }
  }

  private digest(self: unknown, spec: ProbeOpts['state']): unknown {
    if (spec === undefined || self === undefined || self === null) return undefined;
    if (Array.isArray(spec)) {
      const out: Record<string, unknown> = {};
      for (const k of spec) out[k] = leafOf((self as Record<string, unknown>)[k]);
      return out;
    }
    if (spec === 'own') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(self as object)) {
        const x = (self as Record<string, unknown>)[k];
        if (ArrayBuffer.isView(x) || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'string') out[k] = leafOf(x);
      }
      return out;
    }
    const d = this.digests[spec];
    return d ? d.leaf(self) : undefined;
  }

  private shouldRecord(ps: ProbeState, w: Win, i: number): boolean {
    const o = ps.row.opts;
    const first = o.first ?? 6;
    if (i < first) return true;
    if (!o.stride) return false;
    return i % o.stride === 0 && (ps.nrec[w] ?? 0) < (o.max ?? 40);
  }

  /** The wrapper's body: count, maybe record, call. Returns the call's result unchanged. */
  callFn(id: string, f: (...a: unknown[]) => unknown, self: unknown, args: unknown[]): unknown {
    const ps = this.probes.get(id);
    if (!this.on || ps === undefined) return f.apply(self, args);
    const w = this.win;
    const key = w ?? 'other';
    const i = (ps.n[key] = (ps.n[key] ?? 0) + 1) - 1;
    const o = ps.row.opts;
    let prevLabel = '';
    if (o.label !== undefined) {
      prevLabel = this.label;
      this.label = o.label;
    }
    if (w === null || !this.shouldRecord(ps, w, i)) {
      try {
        return f.apply(self, args);
      } finally {
        if (o.label !== undefined) this.label = prevLabel;
      }
    }
    if (o.seq) this.seq[w]!.push(ps.idx);
    ps.nrec[w] = (ps.nrec[w] ?? 0) + 1;
    const skip = o.skipArgs;
    const before = args.map((x, k) => (skip?.includes(k) ? { $skipped: 1 } : leafOf(x)));
    const beforeJson = before.map((x) => JSON.stringify(x));
    const sb = this.digest(self, o.state);
    const wantRaw = (o.raw ?? 0) > (ps.nraw[w] ?? 0) && this.rawBytes < this.rawBudget && (o.rawIn ?? RAW_WINDOWS).includes(w);
    let rawBefore: unknown;
    let rawSkipped: string | undefined;
    const rawBudget = { bytes: o.rawMaxBytes ?? 4 * 1024 * 1024 };
    if (wantRaw) {
      // the arrays are copied now: the call may change them, and the frame is encoded after the call
      rawBefore = { args: args.map((x, k) => (skip?.includes(k) ? null : plainify(x, rawBudget, 0, new Set(), true) ?? null)), state: this.stateRaw(self, o.state, rawBudget, true) };
      if (rawBudget.bytes < 0) {
        rawSkipped = 'size';
        rawBefore = undefined;
      }
    }
    const rec: CallRecord = { i, t: this.t, a: before };
    let ret: unknown;
    try {
      ret = f.apply(self, args);
    } catch (e) {
      rec.threw = String((e as Error)?.message ?? e).slice(0, 200);
      (ps.rec[w] ??= []).push(rec);
      throw e;
    } finally {
      if (o.label !== undefined) this.label = prevLabel;
    }
    // after: only the arguments that can have changed (objects and arrays), and only the ones whose descriptor differs
    let z: Record<string, unknown> | undefined;
    args.forEach((x, k) => {
      if (skip?.includes(k) || typeof x !== 'object' || x === null) return;
      const js = JSON.stringify(leafOf(x));
      if (js !== beforeJson[k]) (z ??= {})[String(k)] = JSON.parse(js);
    });
    if (z) rec.z = z;
    if (ret !== undefined) rec.r = leafOf(ret);
    if (o.state !== undefined) rec.s = { b: sb, a: this.digest(self, o.state) };
    if (wantRaw && rawBefore !== undefined) {
      const rb2 = { bytes: o.rawMaxBytes ?? 4 * 1024 * 1024 };
      const after = { args: args.map((x, k) => (skip?.includes(k) ? null : plainify(x, rb2) ?? null)), ret: plainify(ret, rb2) ?? null, state: this.stateRaw(self, o.state, rb2) };
      if (rb2.bytes < 0) rec.rawSkipped = 'size-after';
      else {
        const rel = `raw/${id.replace(/[^A-Za-z0-9_.-]/g, '_')}-${w}-${i}.bin`;
        const bytes = encodeValue({ probe: id, window: w, i, t: this.t, before: rawBefore, after });
        writeFileSync(join(this.outDir, rel), bytes);
        this.rawBytes += bytes.byteLength;
        this.rawFiles++;
        ps.nraw[w] = (ps.nraw[w] ?? 0) + 1;
        rec.raw = rel;
      }
    } else if (rawSkipped) rec.rawSkipped = rawSkipped;
    (ps.rec[w] ??= []).push(rec);
    return ret;
  }

  private stateRaw(self: unknown, spec: ProbeOpts['state'], budget: { bytes: number }, copy = false): unknown {
    if (spec === undefined || self === undefined || self === null) return null;
    if (typeof spec === 'string' && spec !== 'own') return this.digests[spec]?.raw(self, budget, copy) ?? null;
    const out: Record<string, unknown> = {};
    const keys = Array.isArray(spec) ? spec : Object.keys(self as object);
    for (const k of keys) {
      const x = (self as Record<string, unknown>)[k];
      if (spec === 'own' && !(ArrayBuffer.isView(x) || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'string')) continue;
      const p = plainify(x, budget, 0, new Set(), copy);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
}

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}
