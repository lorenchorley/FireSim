/**
 * Wire codec of the desktop host (0.8.0 workstream J, contract section 3.3): one protocol message (`ToWorker` /
 * `FromWorker`, plus the two control messages below) as one binary frame. Pure TypeScript: no DOM and no Node imports,
 * so the page and the host share it.
 *
 * Layout of a frame, all little endian:
 *   u32   length H of the header
 *   H     the header: UTF-8 JSON of the message in which every typed array is a placeholder
 *         `{"$ta":"<kind>","o":<byte offset in the body>,"n":<element count>}` and a number JSON cannot carry is
 *         `{"$num":"NaN"|"Infinity"|"-Infinity"|"-0"}`
 *   0..7  zero padding, so that the body starts on a multiple of 8
 *   body  the bytes of the typed arrays back to back, each starting on a multiple of 8
 *
 * The decoder copies each array into a buffer of its own (aligned, exactly as long as the array), so what it returns can
 * be kept, transferred and viewed freely. `decode(encode(x))` equals `x` for everything the protocol carries; an
 * `undefined` object field is left out (as in JSON). A value that cannot be represented (a Map, a Set, a Date, a BigInt, a
 * class instance, a function, an `undefined` inside an array, a cycle) throws a {@link CodecError} naming where it is: it
 * is never dropped silently. A frame that is not a well-formed frame also throws a CodecError (never a hang, never a read
 * outside the frame, never more memory than the frame is long).
 */
import type { FromWorker, ToWorker } from '../protocol';

/** Link-level messages of the desktop connection (not part of the simulation protocol): the page measures the round trip with them. */
export type WireControl = { type: 'ping'; t: number } | { type: 'pong'; t: number };
export type WireMessage = ToWorker | FromWorker | WireControl;

export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodecError';
  }
}

type TypedCtor = new (length: number) => ArrayBufferView;

/** Typed array kinds by their tag in the header: the constructor and the bytes per element. */
const KINDS: Readonly<Record<string, readonly [TypedCtor, number]>> = {
  f32: [Float32Array, 4],
  f64: [Float64Array, 8],
  i8: [Int8Array, 1],
  u8: [Uint8Array, 1],
  u8c: [Uint8ClampedArray, 1],
  i16: [Int16Array, 2],
  u16: [Uint16Array, 2],
  i32: [Int32Array, 4],
  u32: [Uint32Array, 4],
  i64: [BigInt64Array, 8],
  u64: [BigUint64Array, 8],
};

/** `Symbol.toStringTag` of a typed array (read the same in every realm) to its tag in the header. */
const TAG_OF_CLASS: Readonly<Record<string, string>> = {
  Float32Array: 'f32',
  Float64Array: 'f64',
  Int8Array: 'i8',
  Uint8Array: 'u8',
  Uint8ClampedArray: 'u8c',
  Int16Array: 'i16',
  Uint16Array: 'u16',
  Int32Array: 'i32',
  Uint32Array: 'u32',
  BigInt64Array: 'i64',
  BigUint64Array: 'u64',
};

const NON_FINITE: Readonly<Record<string, number>> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity, '-0': -0 };

/** Nesting deeper than any message of the protocol (a cycle, or a hostile header, hits this and not the call stack). */
const MAX_DEPTH = 128;

/**
 * What a decoder accepts before it allocates. A scenario of the 6 km Katoomba site has about 60 typed arrays and a header of
 * a few KB; a header of tens of MB or a million empty arrays is not a message, and an 8 MiB header already costs the heap
 * of the thread that reads it about 150 MB.
 */
export interface DecodeLimits {
  /** The most bytes of header (default 8 MiB). */
  maxHeaderBytes?: number;
  /** The most typed arrays in one message (default 4096). */
  maxArrays?: number;
}
export const MAX_HEADER_BYTES = 8 * 1024 * 1024;
export const MAX_ARRAYS = 4096;

const align8 = (n: number): number => Math.ceil(n / 8) * 8;

function requireLittleEndian(): void {
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new CodecError('This codec needs a little endian machine.');
}

// ── encoding ──────────────────────────────────────────────────────────────────────────────────────────────────────

class Encoder {
  readonly arrays: Uint8Array[] = [];
  readonly offsets: number[] = [];
  bodyBytes = 0;
  private readonly path: (string | number)[] = [];

  fail(what: string): never {
    throw new CodecError(`Cannot encode ${what} at ${this.path.length ? this.path.join('.') : 'the top level'}.`);
  }

  walk(v: unknown): unknown {
    switch (typeof v) {
      case 'string':
      case 'boolean':
        return v;
      case 'number':
        return Number.isFinite(v) ? (Object.is(v, -0) ? { $num: '-0' } : v) : { $num: String(v) };
      case 'undefined':
        return this.fail('undefined (only an object field may be undefined, and it is left out)');
      case 'bigint':
        return this.fail('a BigInt');
      case 'function':
        return this.fail('a function');
      case 'symbol':
        return this.fail('a symbol');
    }
    if (v === null) return null;
    const obj = v as object;
    if (this.path.length >= MAX_DEPTH) return this.fail('a value nested too deeply (a cycle?)');
    if (ArrayBuffer.isView(obj)) return this.typedArray(obj);
    if (Array.isArray(obj)) {
      const out = new Array<unknown>(obj.length);
      for (let i = 0; i < obj.length; i++) {
        this.path.push(i);
        out[i] = this.walk(obj[i]);
        this.path.pop();
      }
      return out;
    }
    if (!isPlainObject(obj)) return this.fail(`${describeClass(obj)} (only plain objects, arrays and typed arrays are carried)`);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      const x = (obj as Record<string, unknown>)[k];
      if (x === undefined) continue;
      this.path.push(k);
      // `__proto__` could not come back as the field it was (JSON.parse would make it one, but a consumer that copies the object would change a prototype).
      if (k === '$ta' || k === '$num' || k === '__proto__') this.fail(`the reserved key "${k}"`);
      out[k] = this.walk(x);
      this.path.pop();
    }
    return out;
  }

  private typedArray(v: ArrayBufferView): unknown {
    const tag = TAG_OF_CLASS[(v as unknown as { [Symbol.toStringTag]: string })[Symbol.toStringTag]!];
    if (tag === undefined) return this.fail(`${describeClass(v)} (a DataView is not carried)`);
    const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    const o = align8(this.bodyBytes);
    this.arrays.push(bytes);
    this.offsets.push(o);
    this.bodyBytes = o + bytes.byteLength;
    return { $ta: tag, o, n: bytes.byteLength / KINDS[tag]![1] };
  }
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v) as object | null;
  if (proto === null || proto === Object.prototype) return true;
  // The Object.prototype of another realm (a worker, a frame): its own prototype is null.
  return Object.getPrototypeOf(proto) === null && Object.prototype.toString.call(v) === '[object Object]';
}

function describeClass(v: object): string {
  const name = (Object.getPrototypeOf(v) as { constructor?: { name?: string } } | null)?.constructor?.name;
  return name ? `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}` : 'an object without a plain prototype';
}

/** Encode one message (or any value of the protocol's shape) as one frame. */
export function encodeValue(value: unknown): Uint8Array {
  requireLittleEndian();
  const enc = new Encoder();
  let header: Uint8Array;
  try {
    header = new TextEncoder().encode(JSON.stringify(enc.walk(value)));
  } catch (e) {
    if (e instanceof CodecError) throw e;
    throw new CodecError(`Cannot encode the message: ${e instanceof Error ? e.message : String(e)}`);
  }
  const bodyStart = align8(4 + header.byteLength);
  let out: Uint8Array;
  try {
    out = new Uint8Array(bodyStart + enc.bodyBytes);
  } catch {
    throw new CodecError('The message is too large to encode.');
  }
  new DataView(out.buffer).setUint32(0, header.byteLength, true);
  out.set(header, 4);
  for (let i = 0; i < enc.arrays.length; i++) out.set(enc.arrays[i]!, bodyStart + enc.offsets[i]!);
  return out;
}

export function encodeMessage(msg: WireMessage): Uint8Array {
  return encodeValue(msg);
}

// ── decoding ──────────────────────────────────────────────────────────────────────────────────────────────────────

class Decoder {
  /** Bytes of the body not yet claimed by an array: a header cannot make the decoder allocate more than the frame holds. */
  private budget: number;
  private arrays = 0;
  /** [start, end) of every array that has bytes, to check at the end that no two share any (the encoder never lets them). */
  private readonly ranges: [number, number][] = [];
  private readonly maxArrays: number;

  constructor(
    private readonly body: Uint8Array,
    limits: DecodeLimits,
  ) {
    this.budget = body.byteLength;
    this.maxArrays = limits.maxArrays ?? MAX_ARRAYS;
  }

  walk(v: unknown, depth: number): unknown {
    if (v === null || typeof v !== 'object') return v;
    if (depth >= MAX_DEPTH) throw new CodecError('The frame is nested too deeply.');
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = this.walk(v[i], depth + 1);
      return v;
    }
    const o = v as Record<string, unknown>;
    if ('$ta' in o) return this.typedArray(o);
    if ('$num' in o) return this.number(o);
    // JSON.parse makes an own key `__proto__` a plain data property. The encoder never writes one, and a consumer that copies or merges
    // the object (Object.assign, a deep merge) would take it for a prototype: so it is not a frame.
    if (Object.hasOwn(o, '__proto__')) throw new CodecError('The frame has a "__proto__" field.');
    for (const k of Object.keys(o)) o[k] = this.walk(o[k], depth + 1);
    return o;
  }

  /** After the walk: two arrays that share a byte are not a frame an encoder made. */
  checkRanges(): void {
    this.ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < this.ranges.length; i++) if (this.ranges[i]![0] < this.ranges[i - 1]![1]) throw new CodecError('Two typed arrays of the frame share bytes.');
  }

  private number(o: Record<string, unknown>): number {
    const s = o.$num;
    if (Object.keys(o).length !== 1 || typeof s !== 'string' || !Object.hasOwn(NON_FINITE, s)) throw new CodecError('The frame has a malformed number.');
    return NON_FINITE[s]!;
  }

  private typedArray(o: Record<string, unknown>): ArrayBufferView {
    if (++this.arrays > this.maxArrays) throw new CodecError(`The frame has more than ${this.maxArrays} typed arrays.`);
    const { $ta: tag, o: offset, n } = o;
    const keys = Object.keys(o);
    const kind = typeof tag === 'string' && Object.hasOwn(KINDS, tag) ? KINDS[tag] : undefined;
    if (keys.length !== 3 || !kind || !Number.isSafeInteger(offset) || !Number.isSafeInteger(n) || (offset as number) < 0 || (n as number) < 0) {
      throw new CodecError('The frame has a malformed typed array.');
    }
    const [Ctor, size] = kind;
    const bytes = (n as number) * size;
    if ((offset as number) % 8 !== 0 || (offset as number) + bytes > this.body.byteLength || bytes > this.budget) throw new CodecError('A typed array of the frame lies outside its body.');
    this.budget -= bytes;
    if (bytes > 0) this.ranges.push([offset as number, (offset as number) + bytes]);
    const out = new Ctor(n as number);
    new Uint8Array(out.buffer).set(this.body.subarray(offset as number, (offset as number) + bytes));
    return out;
  }
}

/** Decode one frame to the value it carries (or throw a CodecError: see {@link DecodeLimits} for what is refused before anything is allocated). */
export function decodeValue(bytes: Uint8Array, limits: DecodeLimits = {}): unknown {
  requireLittleEndian();
  if (bytes.byteLength < 4) throw new CodecError('The frame is too short.');
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (4 + headerLength > bytes.byteLength) throw new CodecError('The frame is shorter than its header says.');
  const maxHeader = limits.maxHeaderBytes ?? MAX_HEADER_BYTES;
  if (headerLength > maxHeader) throw new CodecError(`The frame header is larger than ${maxHeader} bytes.`);
  let tree: unknown;
  try {
    tree = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4, 4 + headerLength)));
  } catch {
    throw new CodecError('The frame header is not valid JSON.');
  }
  const bodyStart = align8(4 + headerLength);
  try {
    const d = new Decoder(bytes.subarray(Math.min(bodyStart, bytes.byteLength)), limits);
    const v = d.walk(tree, 0);
    d.checkRanges();
    return v;
  } catch (e) {
    if (e instanceof CodecError) throw e;
    throw new CodecError('The frame could not be decoded.');
  }
}

export function decodeMessage(bytes: Uint8Array, limits: DecodeLimits = {}): WireMessage {
  const v = decodeValue(bytes, limits);
  if (v === null || typeof v !== 'object' || Array.isArray(v) || typeof (v as { type?: unknown }).type !== 'string') throw new CodecError('The frame is not a message.');
  return v as WireMessage;
}
