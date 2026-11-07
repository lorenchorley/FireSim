/** Exact comparison of protocol values for tests (the codec's, the desktop host's): bitwise for typed arrays, `Object.is` for numbers, an `undefined` field the same as no field. */

const isView = (v: unknown): v is ArrayBufferView => ArrayBuffer.isView(v);
const bytesOf = (v: ArrayBufferView): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

/** The first place where two values differ, or null when they are the same. */
export function difference(a: unknown, b: unknown, path = ''): string | null {
  if (isView(a) || isView(b)) {
    if (!isView(a) || !isView(b) || a.constructor !== b.constructor) return `${path}: not the same kind of array`;
    if (a.byteLength !== b.byteLength) return `${path}: length ${a.byteLength} against ${b.byteLength}`;
    return Buffer.compare(bytesOf(a), bytesOf(b)) === 0 ? null : `${path}: bytes differ`;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return Object.is(a, b) ? null : `${path}: ${String(a)} against ${String(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array against object`;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return `${path}: ${ka.length} fields against ${kb.length}`;
  for (const k of ka) {
    const d = difference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}
