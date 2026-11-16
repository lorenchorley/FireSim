#!/usr/bin/env node
/**
 * Reference reader of a probes folder (card T3.4; no dependencies, so it also documents what a C# loader must do).
 *
 *   node reader.mjs DIR                      what the folder holds (index.json summary)
 *   node reader.mjs DIR --selftest           decode every raw frame and blob; check each against the recorded descriptors (exit 1 on a mismatch)
 *   node reader.mjs DIR --probe A5/headRosKernel [--window w0] [--raw]     the records of one probe (and its raw frames decoded)
 *   import { openProbes, decodeFrame } from './reader.mjs'
 *
 * Files of a folder (all JSON unless said; formats in reports/3-probes.md):
 *   index.json           scenario, seed, windows, per-probe call counts, call sequence of the per-step calls
 *   calls/A<n>.json      the recorded calls of area n: { probes: { "A5/headRosKernel": { w0: [record...], w900: [...], init: [...], spin: [...] } } }
 *   raw/<probe>-<window>-<i>.bin    a codec frame (same as init.bin): { probe, window, i, t, before: {args, state}, after: {args, ret, state} }
 *   steps.json           one entry per atmosphere step: state digests after the step, generator draw counters
 *   env-tape.json        one entry per fire step: scalars, weather hour, moisture/availability/fuelTemp arrays (hash + blob reference)
 *   air-tape.json        one entry per fire step: the wind/ridge/air arrays; and the ember side logs (files ember-*.f64) and landing/ignite lists
 *   blobs.bin            the arrays referenced by {blob:{o,n,k}}: element kind k, n elements, at byte offset o (a multiple of 8)
 *   ember-wind-<w>.f64   float64 records [x, y, zAGL, u, v, w] in call order; ember-turb-<w>.f64: [x, y, zAGL, zi, wStar, uStar]
 *   draws.json           random streams, per-particle draw counts, standalone generator goldens, table hashes
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KINDS = { f32: Float32Array, f64: Float64Array, i8: Int8Array, u8: Uint8Array, u8c: Uint8ClampedArray, i16: Int16Array, u16: Uint16Array, i32: Int32Array, u32: Uint32Array, i64: BigInt64Array, u64: BigUint64Array };
const NON_FINITE = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity, '-0': -0 };

/** Decode one codec frame (u32 header length H, H bytes of UTF-8 JSON, padding to 8, body of arrays): typed-array placeholders become arrays, $num becomes a number. */
export function decodeFrame(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = dv.getUint32(0, true);
  const tree = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + h)));
  const bodyStart = Math.ceil((4 + h) / 8) * 8;
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    if ('$ta' in v) {
      const C = KINDS[v.$ta];
      const out = new C(v.n);
      new Uint8Array(out.buffer).set(bytes.subarray(bodyStart + v.o, bodyStart + v.o + v.n * C.BYTES_PER_ELEMENT));
      return out;
    }
    if ('$num' in v) return NON_FINITE[v.$num];
    const o = {};
    for (const k of Object.keys(v)) o[k] = walk(v[k]);
    return o;
  };
  return walk(tree);
}

/** FNV-1a 32 over bytes (src/sim/testing/hash.ts); 8 hex digits. */
export function fnvHex(bytes, h = 0x811c9dc5) {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const TAGS = new Map(Object.entries(KINDS).map(([k, C]) => [C, k]));
const f64a = new Float64Array(1);
/** The descriptor (core.ts leafOf) of a decoded raw-frame value: typed arrays, plain objects and arrays, numbers. */
export function leafOfDecoded(v, depth = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? { $num: '-0' } : v) : { $num: String(v) };
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (ArrayBuffer.isView(v)) return { $ta: TAGS.get(v.constructor), n: v.length, h: fnvHex(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (Array.isArray(v)) {
    if (v.length <= 32) return v.map((x) => leafOfDecoded(x, depth + 1));
    if (v.every((x) => typeof x === 'number')) {
      const a = Float64Array.from(v);
      return { $arr: 'f64', n: v.length, h: fnvHex(new Uint8Array(a.buffer)) };
    }
    return { $arr: 'mixed', n: v.length, h: fnvHex(new TextEncoder().encode(JSON.stringify(v.map((x) => leafOfDecoded(x, depth + 1))))) };
  }
  const o = {};
  for (const k of Object.keys(v)) o[k] = leafOfDecoded(v[k], depth + 1);
  return o;
}

/**
 * Self-test of a probes folder: every raw frame decodes, and the descriptor of each of its argument values (before the call) equals the one recorded in the
 * call record; the arrays of the environment and air tapes that have a blob read back with the recorded hash. Returns { frames, args, mismatches: [...] }.
 */
export function selftest(dir) {
  const p = openProbes(dir);
  const idx = p.index();
  const out = { frames: 0, args: 0, state: 0, blobs: 0, mismatches: [] };
  const areas = [...new Set(Object.values(idx.probes).map((x) => x.area))];
  for (const area of areas) {
    let c;
    try {
      c = p.calls(area);
    } catch {
      continue;
    }
    for (const [id, wins] of Object.entries(c.probes)) {
      for (const [w, list] of Object.entries(wins)) {
        for (const r of list) {
          if (!r.raw) continue;
          const f = p.raw(r.raw);
          out.frames++;
          (f.before.args ?? []).forEach((v, k) => {
            if (v === null || v === undefined) return;
            out.args++;
            const got = JSON.stringify(leafOfDecoded(v));
            const want = JSON.stringify(r.a[k]);
            // a class instance has the same fields in both; a descriptor of $skipped / $fn / $undef is not comparable
            if (got !== want && !/\$skipped|\$fn|\$undef|\$class/.test(want)) out.mismatches.push(`${id} ${w} #${r.i} arg ${k}`);
          });
          if (f.before.state && r.s && typeof r.s.b === 'object') {
            for (const [k, v] of Object.entries(f.before.state)) {
              if (v === null || typeof v !== 'object' || ArrayBuffer.isView(v) === false) continue;
              out.state++;
              const want = r.s.b?.[k] ?? r.s.b?.particles?.[k];
              if (want && JSON.stringify(leafOfDecoded(v)) !== JSON.stringify(want)) out.mismatches.push(`${id} ${w} #${r.i} state ${k}`);
            }
          }
        }
      }
    }
  }
  for (const tape of [p.envTape().steps, p.airTape().steps]) {
    for (const e of tape) {
      for (const v of Object.values(e)) {
        if (v && typeof v === 'object' && v.blob) {
          out.blobs++;
          const a = p.blob(v.blob);
          if (fnvHex(new Uint8Array(a.buffer)) !== v.h) out.mismatches.push(`tape step ${e.k} blob ${JSON.stringify(v.blob)}`);
        }
      }
    }
  }
  return out;
}

export function openProbes(dir) {
  const json = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  let blobFile;
  return {
    dir,
    index: () => json('index.json'),
    calls: (area) => json(`calls/${area}.json`),
    steps: () => json('steps.json'),
    envTape: () => json('env-tape.json'),
    airTape: () => json('air-tape.json'),
    draws: () => json('draws.json'),
    /** The array a {blob:{o,n,k}} reference points to. */
    blob(ref) {
      blobFile ??= readFileSync(join(dir, 'blobs.bin'));
      const C = KINDS[ref.k];
      const out = new C(ref.n);
      new Uint8Array(out.buffer).set(blobFile.subarray(ref.o, ref.o + ref.n * C.BYTES_PER_ELEMENT));
      return out;
    },
    /** An ember log as an array of records (each a Float64Array view of `width` numbers). */
    emberLog(kind, win) {
      const f = join(dir, `ember-${kind}-${win}.f64`);
      if (!existsSync(f)) return [];
      const b = readFileSync(f);
      const all = new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8);
      const recs = [];
      for (let i = 0; i + 6 <= all.length; i += 6) recs.push(all.subarray(i, i + 6));
      return recs;
    },
    raw: (rel) => decodeFrame(readFileSync(join(dir, rel))),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node reader.mjs DIR [--probe ID [--window W] [--raw]]');
    process.exit(2);
  }
  const p = openProbes(dir);
  const idx = p.index();
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  if (process.argv.includes('--selftest')) {
    const t = selftest(dir);
    console.log(JSON.stringify({ ...t, mismatches: t.mismatches.slice(0, 20), mismatchCount: t.mismatches.length }));
    process.exit(t.mismatches.length ? 1 : 0);
  }
  const id = arg('probe');
  if (!id) {
    console.log(`${idx.scenario} seed ${idx.seed} to ${idx.runToS} s, tier ${idx.tier}, embers ${idx.embers}, ${idx.steps} steps, raw ${idx.rawFiles} files ${idx.rawBytes} bytes`);
    const byArea = {};
    for (const [pid, pr] of Object.entries(idx.probes)) {
      const a = (byArea[pr.area] ??= { probes: 0, called: 0, recorded: 0 });
      a.probes++;
      const ws = Object.values(pr.windows);
      if (ws.length) a.called++;
      a.recorded += ws.reduce((s, w) => s + w.recorded, 0);
    }
    console.log(JSON.stringify(byArea, null, 1));
  } else {
    const area = id.split('/')[0];
    const rec = p.calls(area).probes[id];
    const w = arg('window');
    for (const [win, list] of Object.entries(rec ?? {})) {
      if (w && w !== win) continue;
      console.log(`## ${id} ${win}: ${list.length} records`);
      for (const r of list) {
        console.log(JSON.stringify(r));
        if (process.argv.includes('--raw') && r.raw) {
          const f = p.raw(r.raw);
          console.log('  raw:', Object.keys(f.before.args ?? {}).length, 'args before,', Object.keys(f.after.args ?? {}).length, 'after');
        }
      }
    }
  }
}
