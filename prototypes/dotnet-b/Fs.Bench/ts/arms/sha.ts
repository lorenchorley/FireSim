/**
 * T1.5: a synchronous SHA-256 that runs in Node and in a browser worker (no `node:crypto`, no `crypto.subtle`), and the hash scheme of the C# tests:
 * the first 128 bits (32 hex digits) of SHA-256 over the raw little-endian bytes of a typed array, every NaN replaced by the canonical quiet NaN
 * (`0x7ff8000000000000` for Float64, `0x7fc00000` for Float32), -0 kept. Same scheme as `Fs.Bench/ts/air/lib.ts` `canonHash` (which this file is checked against by `selftest`).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of `data`, as 32 bytes. */
export function sha256(data: Uint8Array): Uint8Array {
  const len = data.length;
  const total = (len + 9 + 63) & ~63;
  const full = len & ~63;
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const block = (src: Uint8Array, off: number): void => {
    for (let i = 0; i < 16; i++) {
      const p = off + 4 * i;
      w[i] = ((src[p]! << 24) | (src[p + 1]! << 16) | (src[p + 2]! << 8) | src[p + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  };
  for (let o = 0; o < full; o += 64) block(data, o);
  const tail = new Uint8Array(total - full);
  tail.set(data.subarray(full));
  tail[len - full] = 0x80;
  const bits = len * 8;
  const tv = new DataView(tail.buffer);
  tv.setUint32(tail.length - 8, Math.floor(bits / 4294967296), false);
  tv.setUint32(tail.length - 4, bits >>> 0, false);
  for (let o = 0; o < tail.length; o += 64) block(tail, o);
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(4 * i, h[i]!, false);
  return out;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
export function hex(b: Uint8Array, n = b.length): string {
  let s = '';
  for (let i = 0; i < n; i++) s += HEX[b[i]!];
  return s;
}

export type Typed = Float32Array | Float64Array | Uint8Array | Int32Array;

/** SHA-256 first 32 hex digits of the raw bytes, NaN canonicalised (floats), -0 kept; integers are hashed as they are. Works on views of a SharedArrayBuffer (the bytes are copied first). */
export function canonHash(a: Typed): string {
  let bytes: Uint8Array;
  if (a instanceof Float64Array) {
    const c = new Float64Array(a.length);
    c.set(a);
    const u = new Uint32Array(c.buffer);
    for (let i = 0; i < c.length; i++) {
      if (c[i] !== c[i]) {
        u[2 * i] = 0;
        u[2 * i + 1] = 0x7ff80000;
      }
    }
    bytes = new Uint8Array(c.buffer);
  } else if (a instanceof Float32Array) {
    const c = new Float32Array(a.length);
    c.set(a);
    const u = new Uint32Array(c.buffer);
    for (let i = 0; i < c.length; i++) if (c[i] !== c[i]) u[i] = 0x7fc00000;
    bytes = new Uint8Array(c.buffer);
  } else if (a instanceof Int32Array) {
    const c = new Int32Array(a.length);
    c.set(a);
    bytes = new Uint8Array(c.buffer);
  } else {
    const c = new Uint8Array(a.length);
    c.set(a);
    bytes = c;
  }
  return hex(sha256(bytes), 16);
}

/** `fast/lib.ts` `hash`: the same for every type (Int32Array hashed raw). */
export const hash = canonHash;

export function bitsHex(x: number): string {
  const f = new Float64Array([x]);
  const u = new BigUint64Array(f.buffer);
  return u[0]!.toString(16).padStart(16, '0');
}
