#!/usr/bin/env node
/**
 * Spike S2 (bundle baseline and trim candidates): attributes the bytes of a production build to source modules,
 * packages and folders, using the build's own source maps. No dependencies beyond Node 22 and the `typescript`
 * package that is already in node_modules. It reads a build, it never changes the app.
 *
 * Build first (the maps need `--sourcemap`; the shipped build has none, and the JS is identical either way):
 *   nice -n 10 npx vite build --mode capacitor --sourcemap --outDir <scratch>/dist-map --emptyOutDir
 *
 * Commands (all print Markdown to stdout; `all` also writes the tables to --out as .md and .csv):
 *   node attribute.mjs chunks   --dist <dist>                      chunk table: size, load path, trigger
 *   node attribute.mjs modules  --dist <dist-with-maps> [--top 40] modules and packages per chunk
 *   node attribute.mjs blobs    --dist <dist-with-maps> [--min 600] big string literals and text-heavy modules
 *   node attribute.mjs cut      --dist <dist-with-maps> --match <regex> [--chunk <name-prefix>]
 *                                                                   gzip -9 saved by deleting the matching modules
 *   node attribute.mjs symbols  --dist <dist-with-maps> --match <regex>
 *                                                                   top-level declarations of matching modules, with bytes
 *   node attribute.mjs dead     --root <repo or HEAD snapshot> --dist <dist-with-maps>
 *                                                                   unreachable modules, unused exports, kept dead code
 *   node attribute.mjs all      --dist <dist-with-maps> --root <repo or snapshot> --out results
 *
 * How the numbers are made (details in README.md):
 *   - raw bytes: the source map says which original module every stretch of the generated chunk came from (the same
 *     method as source-map-explorer); stretches without a mapping are "[unmapped]" (import lines, runtime glue).
 *   - gzip bytes: the chunk is compressed once with `gzip -9` (zlib level 9, the level scripts/check-bundle.mjs uses), then
 *     the compressed stream is decoded again while counting the bits each output byte cost (a literal costs its code length;
 *     a match costs its length and distance codes, shared over the bytes it copies; block headers are shared over their
 *     block). The sum over all modules is the real gzip size of the chunk, so the table adds up to what check-bundle counts.
 *     A module that repeats text seen earlier pays only the cost of the matches, so the share depends on the order of
 *     the chunk. For a "what would deleting this save" figure use `cut`, which deletes the module's bytes and compresses again.
 *   - units: kB means 1024 bytes, as in scripts/check-bundle.mjs (its "1000 kB" budget is 1,024,000 bytes).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ts = require('typescript');

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------------

const KB = 1024;
const kb = (n, d = 1) => (n / KB).toFixed(d);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + ' %' : '-');
const gzip9 = (buf) => zlib.gzipSync(buf, { level: 9 });
const brotli11 = (buf) =>
  zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) opts[a.slice(2)] = true;
      else {
        opts[a.slice(2)] = next;
        i++;
      }
    } else opts._.push(a);
  }
  return { cmd, opts };
}

/** Markdown table. `align` is a string of 'l' / 'r' per column. */
export function mdTable(headers, rows, align = '') {
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const sep = headers.map((_, i) => (align[i] === 'r' ? '---:' : '---'));
  return [`| ${headers.map(esc).join(' | ')} |`, `| ${sep.join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
}

export function csv(headers, rows) {
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(q).join(','), ...rows.map((r) => r.map(q).join(','))].join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------------------------
// Source map decoding (base64 VLQ), spans, and UTF-8 offsets
// ---------------------------------------------------------------------------------------------------------------------

const B64 = new Int8Array(128).fill(-1);
'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((c, i) => {
  B64[c.charCodeAt(0)] = i;
});

/** Decodes a `mappings` string into parallel typed arrays, one entry per segment, in generated order. */
export function decodeMappings(str) {
  let cap = 1;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 44 || c === 59) cap++;
  }
  const line = new Int32Array(cap);
  const col = new Int32Array(cap);
  const src = new Int32Array(cap);
  const sLine = new Int32Array(cap);
  const sCol = new Int32Array(cap);
  const vals = [0, 0, 0, 0, 0];
  let n = 0;
  let l = 0;
  let gc = 0;
  let si = 0;
  let sl = 0;
  let sc = 0;
  let i = 0;
  const len = str.length;
  while (i < len) {
    const ch = str.charCodeAt(i);
    if (ch === 59) {
      l++;
      gc = 0;
      i++;
      continue;
    }
    if (ch === 44) {
      i++;
      continue;
    }
    let k = 0;
    while (i < len) {
      const c = str.charCodeAt(i);
      if (c === 44 || c === 59) break;
      let value = 0;
      let shift = 0;
      let digit;
      do {
        digit = B64[str.charCodeAt(i++)];
        value += (digit & 31) << shift;
        shift += 5;
      } while (digit & 32);
      vals[k++] = value & 1 ? -(value >>> 1) : value >>> 1;
    }
    gc += vals[0];
    line[n] = l;
    col[n] = gc;
    if (k >= 4) {
      si += vals[1];
      sl += vals[2];
      sc += vals[3];
      src[n] = si;
      sLine[n] = sl;
      sCol[n] = sc;
    } else {
      src[n] = -1;
      sLine[n] = -1;
      sCol[n] = -1;
    }
    n++;
  }
  return { n, line: line.subarray(0, n), col: col.subarray(0, n), src: src.subarray(0, n), sLine: sLine.subarray(0, n), sCol: sCol.subarray(0, n) };
}

/** UTF-16 index -> cumulative UTF-8 byte offset (length text.length + 1). */
export function utf8Offsets(text) {
  const out = new Int32Array(text.length + 1);
  let b = 0;
  for (let i = 0; i < text.length; i++) {
    out[i] = b;
    const c = text.charCodeAt(i);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c < 0xdc00) b += 4;
    else if (c >= 0xdc00 && c < 0xe000) b += 0;
    else b += 3;
  }
  out[text.length] = b;
  return out;
}

export function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

// ---------------------------------------------------------------------------------------------------------------------
// gzip -9 with a per-byte cost trace (an inflate that counts bits)
// ---------------------------------------------------------------------------------------------------------------------

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function huffman(lens, n) {
  const count = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lens[i]]++;
  const offs = new Uint16Array(16);
  for (let l = 1; l < 15; l++) offs[l + 1] = offs[l] + count[l];
  const symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lens[i]) symbol[offs[lens[i]]++] = i;
  return { count, symbol };
}

/**
 * Decodes a gzip stream and returns, for every output byte, the number of compressed bits it cost.
 * `expected` (the original bytes) is compared with the decoded output; a mismatch throws.
 */
export function traceGzip(gz, expected) {
  const rawLen = expected.length;
  let p = 10;
  const flg = gz[3];
  if (flg & 4) p += 2 + (gz[p] | (gz[p + 1] << 8));
  if (flg & 8) while (gz[p++] !== 0);
  if (flg & 16) while (gz[p++] !== 0);
  if (flg & 2) p += 2;
  const startBits = p * 8;
  let bb = 0;
  let bc = 0;
  const getBits = (n) => {
    while (bc < n) {
      bb |= gz[p++] << bc;
      bc += 8;
    }
    const v = bb & ((1 << n) - 1);
    bb >>>= n;
    bc -= n;
    return v;
  };
  const bitPos = () => p * 8 - bc;
  let dlen = 0;
  const decode = (h) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= getBits(1);
      const cnt = h.count[len];
      if (code - cnt < first) {
        dlen = len;
        return h.symbol[index + (code - first)];
      }
      index += cnt;
      first += cnt;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('traceGzip: bad Huffman code');
  };
  const fixedLens = new Uint8Array(288);
  fixedLens.fill(8, 0, 144);
  fixedLens.fill(9, 144, 256);
  fixedLens.fill(7, 256, 280);
  fixedLens.fill(8, 280, 288);
  const fixedLit = huffman(fixedLens, 288);
  const fixedDist = huffman(new Uint8Array(30).fill(5), 30);

  const cost = new Float32Array(rawLen);
  const out = Buffer.allocUnsafe(rawLen);
  let o = 0;
  for (;;) {
    const bStart = bitPos();
    const oStart = o;
    const last = getBits(1);
    const type = getBits(2);
    let symBits = 0;
    if (type === 0) {
      bb = 0;
      bc = 0;
      const len = gz[p] | (gz[p + 1] << 8);
      p += 4;
      gz.copy(out, o, p, p + len);
      p += len;
      o += len;
    } else if (type === 1 || type === 2) {
      let lit = fixedLit;
      let dist = fixedDist;
      if (type === 2) {
        const nlen = getBits(5) + 257;
        const ndist = getBits(5) + 1;
        const ncode = getBits(4) + 4;
        const lengths = new Uint8Array(320);
        for (let i = 0; i < ncode; i++) lengths[CL_ORDER[i]] = getBits(3);
        const clen = huffman(lengths, 19);
        let index = 0;
        const all = new Uint8Array(320);
        while (index < nlen + ndist) {
          const sym = decode(clen);
          if (sym < 16) all[index++] = sym;
          else {
            let len = 0;
            let rep;
            if (sym === 16) {
              len = all[index - 1];
              rep = 3 + getBits(2);
            } else if (sym === 17) rep = 3 + getBits(3);
            else rep = 11 + getBits(7);
            while (rep--) all[index++] = len;
          }
        }
        lit = huffman(all.subarray(0, nlen), nlen);
        dist = huffman(all.subarray(nlen, nlen + ndist), ndist);
      }
      for (;;) {
        let sym = decode(lit);
        if (sym < 256) {
          out[o] = sym;
          cost[o++] += dlen;
          symBits += dlen;
        } else if (sym === 256) break;
        else {
          sym -= 257;
          const len = LBASE[sym] + getBits(LEXT[sym]);
          const lb = dlen + LEXT[sym];
          const dsym = decode(dist);
          const d = DBASE[dsym] + getBits(DEXT[dsym]);
          const db = dlen + DEXT[dsym];
          const per = (lb + db) / len;
          for (let k = 0; k < len; k++) {
            out[o] = out[o - d];
            cost[o++] += per;
          }
          symBits += lb + db;
        }
      }
    } else throw new Error('traceGzip: bad block type');
    const overhead = bitPos() - bStart - symBits;
    if (o > oStart) {
      const per = overhead / (o - oStart);
      for (let k = oStart; k < o; k++) cost[k] += per;
    }
    if (last) break;
  }
  if (o !== rawLen || !out.equals(expected)) throw new Error('traceGzip: decoded output differs from the original');
  const prefix = new Float64Array(rawLen + 1);
  for (let i = 0; i < rawLen; i++) prefix[i + 1] = prefix[i] + cost[i];
  return { prefix, deflateBits: bitPos() - startBits, framingBytes: gz.length - (bitPos() - startBits) / 8 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Source naming and grouping
// ---------------------------------------------------------------------------------------------------------------------

/** Repo-relative name of a source path from a map (they are relative to the map, or odd for the worker bundle). */
export function normSource(s) {
  s = s.replace(/\\/g, '/');
  const nm = s.lastIndexOf('node_modules/');
  if (nm >= 0) return s.slice(nm);
  const m = s.match(/(?:^|\/)(src\/.*)$/);
  if (m) return m[1];
  if (s.startsWith('\0')) return s;
  return s.replace(/^(\.\.\/)+/, '');
}

export function groupOf(name) {
  if (name.startsWith('node_modules/')) {
    const p = name.split('/');
    return p[1].startsWith('@') ? `${p[1]}/${p[2]}` : p[1];
  }
  if (name.startsWith('src/')) {
    const p = name.split('/');
    return p.length > 2 ? `src/${p[1]}` : 'src (root)';
  }
  return '[bundler/glue]';
}

export function group2Of(name) {
  if (name.startsWith('src/')) {
    const p = name.split('/');
    if (p.length <= 2) return 'src (root)';
    if (p.length === 3) return `src/${p[1]} (files)`;
    return `src/${p[1]}/${p[2]}`;
  }
  return groupOf(name);
}

// ---------------------------------------------------------------------------------------------------------------------
// The build model: chunks, spans, per-source bytes, the chunk graph
// ---------------------------------------------------------------------------------------------------------------------

const normChunkRef = (s) => s.replace(/^\.\//, '');

/** Parses one chunk with TypeScript: static imports, dynamic imports (with position), literals, worker URL. */
function analyseAst(chunk, litMin) {
  const sf = ts.createSourceFile(chunk.name, chunk.text, ts.ScriptTarget.ES2022, false, ts.ScriptKind.JS);
  const statics = [];
  for (const s of sf.statements) {
    if ((ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) {
      statics.push(normChunkRef(s.moduleSpecifier.text));
    }
  }
  const dynamics = [];
  const workerRefs = [];
  const lits = []; // every string / template literal: {s, e, kind}
  const arrays = []; // big array literals
  const consoles = []; // console.<level>(...) calls: {s, e, level}
  const visit = (n) => {
    switch (n.kind) {
      case ts.SyntaxKind.CallExpression: {
        if (ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'console') {
          consoles.push({ s: n.getStart(sf), e: n.end, level: n.expression.name.text });
          break;
        }
        if (n.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const a = n.arguments[0];
          if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) dynamics.push({ target: normChunkRef(a.text), pos: n.getStart(sf) });
        }
        break;
      }
      case ts.SyntaxKind.NewExpression: {
        if (ts.isIdentifier(n.expression) && n.expression.text === 'URL' && n.arguments?.length) {
          const a = n.arguments[0];
          if ((ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && a.text.endsWith('.js')) workerRefs.push(normChunkRef(a.text));
        }
        break;
      }
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        lits.push({ s: n.getStart(sf), e: n.end, kind: n.kind === ts.SyntaxKind.StringLiteral ? 'string' : 'template' });
        return;
      case ts.SyntaxKind.TemplateExpression:
        lits.push({ s: n.getStart(sf), e: n.end, kind: 'template' });
        ts.forEachChild(n, (c) => {
          if (c.kind === ts.SyntaxKind.TemplateSpan) visit(c.expression);
        });
        return;
      case ts.SyntaxKind.ArrayLiteralExpression:
        if (n.elements.length >= 200 && n.end - n.getStart(sf) >= litMin) arrays.push({ s: n.getStart(sf), e: n.end, kind: `array[${n.elements.length}]` });
        break;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { statics, dynamics, workerRefs, lits, arrays, consoles };
}

/**
 * Loads every assets/*.js of a build. With maps: decodes them and attributes raw and gzip bytes per source.
 * `opts.skipAst` leaves out the TypeScript parse of the chunks (faster, but no graph, literals or triggers).
 */
export function loadBuild(dist, opts = {}) {
  dist = path.resolve(dist);
  const dir = path.join(dist, 'assets');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  const html = fs.existsSync(path.join(dist, 'index.html')) ? fs.readFileSync(path.join(dist, 'index.html'), 'utf8') : '';
  const entryMatch = html.match(/<script[^>]*type="module"[^>]*src="\.\/assets\/([^"]+\.js)"/);
  const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\.\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
  const litMin = opts.litMin ?? 600;
  const chunks = [];
  for (const name of files) {
    const file = path.join(dir, name);
    let buf = fs.readFileSync(file);
    let text = buf.toString('utf8');
    // The with-maps build adds one `//# sourceMappingURL=` line; it is not part of the shipped bytes.
    const mapRef = text.match(/\n?\/\/# sourceMappingURL=([^\n]+)\s*$/);
    if (mapRef) {
      text = text.slice(0, mapRef.index);
      buf = Buffer.from(text, 'utf8');
    }
    const mapFile = file + '.map';
    const map = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : null;
    const gz = gzip9(buf);
    const chunk = {
      name,
      id: name.replace(/-[\w-]{8}\.js$/, '').replace(/\.js$/, ''),
      raw: buf.length,
      gz: gz.length,
      br: brotli11(buf).length,
      text,
      buf,
      map,
      sources: map ? map.sources.map(normSource) : [],
      isEntry: entryMatch ? entryMatch[1] === name : false,
      isWorker: /^worker-/.test(name),
    };
    if (!opts.skipAst) Object.assign(chunk, analyseAst(chunk, litMin));
    if (map && !opts.skipMaps) {
      const trace = traceGzip(gz, buf);
      chunk.framingBytes = trace.framingBytes;
      buildSpans(chunk, trace.prefix);
    }
    chunks.push(chunk);
  }
  const byName = new Map(chunks.map((c) => [c.name, c]));
  return { dist, chunks, byName, entry: entryMatch ? entryMatch[1] : null, preloads, html };
}

/** Converts a char offset in the chunk to (line, col) using the chunk's line table. */
function posOf(chunk, off) {
  const ls = chunk.lineStarts;
  let lo = 0;
  let hi = ls.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ls[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, col: off - ls[lo] };
}

/** Segment index covering a char offset (the last segment that starts at or before it), or -1. */
function segmentAt(chunk, off) {
  const st = chunk.segStart;
  let lo = 0;
  let hi = st.length - 1;
  if (hi < 0 || st[0] > off) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (st[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Original file:line (1-based line) for a char offset in a chunk, or null. */
export function originalAt(chunk, off) {
  const i = segmentAt(chunk, off);
  if (i < 0 || chunk.dm.src[i] < 0) return null;
  return { file: chunk.sources[chunk.dm.src[i]], line: chunk.dm.sLine[i] + 1, col: chunk.dm.sCol[i] };
}

function buildSpans(chunk, prefix) {
  const text = chunk.text;
  const dm = decodeMappings(chunk.map.mappings);
  const ls = lineStartsOf(text);
  chunk.lineStarts = ls;
  chunk.dm = dm;
  const byteAt = utf8Offsets(text);
  chunk.byteAt = byteAt;
  chunk.prefix = prefix;
  const n = dm.n;
  const start = new Int32Array(n);
  const end = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const L = dm.line[i];
    const base = ls[L] ?? text.length;
    start[i] = base + dm.col[i];
    end[i] = i + 1 < n && dm.line[i + 1] === L ? base + dm.col[i + 1] : (ls[L + 1] ?? text.length);
  }
  // A template literal with line breaks inside (shader and help text) continues on generated lines that have no segment of
  // their own. Hand such unmapped stretches to the segment that starts the literal, so the text is not lost to "[unmapped]".
  const tpl = (chunk.lits ?? []).filter((l) => l.kind === 'template').sort((a, b) => a.s - b.s);
  if (tpl.length) {
    const tplAt = (pos) => {
      let lo = 0;
      let hi = tpl.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tpl[mid].s < pos) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return best >= 0 && tpl[best].e > pos ? tpl[best] : null;
    };
    for (let i = 0; i < n; i++) {
      const nextStart = i + 1 < n ? start[i + 1] : text.length;
      if (end[i] >= nextStart) continue;
      const lit = tplAt(end[i]);
      if (lit) end[i] = Math.min(Math.max(lit.e, end[i]), nextStart);
    }
  }
  chunk.segStart = start;
  chunk.segEnd = end;
  // Per source: raw bytes, gzip bytes (bits / 8), segment count.
  const nSrc = chunk.sources.length;
  const raw = new Float64Array(nSrc + 1); // last slot: unmapped
  const bits = new Float64Array(nSrc + 1);
  let mappedRaw = 0;
  let mappedBits = 0;
  for (let i = 0; i < n; i++) {
    const s = dm.src[i];
    if (s < 0) continue;
    const b0 = byteAt[start[i]];
    const b1 = byteAt[end[i]];
    raw[s] += b1 - b0;
    bits[s] += prefix[b1] - prefix[b0];
    mappedRaw += b1 - b0;
    mappedBits += prefix[b1] - prefix[b0];
  }
  raw[nSrc] = chunk.raw - mappedRaw;
  bits[nSrc] = prefix[chunk.raw] - mappedBits;
  chunk.srcRaw = raw;
  chunk.srcGz = bits.map((b) => b / 8);
  // Text bytes: literals attributed to the source of the segment where each starts.
  const textRaw = new Float64Array(nSrc + 1);
  const textBits = new Float64Array(nSrc + 1);
  for (const l of chunk.lits ?? []) {
    const i = segmentAt(chunk, l.s);
    const s = i >= 0 && dm.src[i] >= 0 ? dm.src[i] : nSrc;
    const b0 = byteAt[l.s];
    const b1 = byteAt[l.e];
    textRaw[s] += b1 - b0;
    textBits[s] += prefix[b1] - prefix[b0];
    l.src = s;
    l.raw = b1 - b0;
    l.gz = (prefix[b1] - prefix[b0]) / 8;
  }
  chunk.srcTextRaw = textRaw;
  chunk.srcTextGz = textBits.map((b) => b / 8);
  for (const l of chunk.consoles ?? []) {
    const i = segmentAt(chunk, l.s);
    l.src = i >= 0 && dm.src[i] >= 0 ? dm.src[i] : nSrc;
    l.raw = byteAt[l.e] - byteAt[l.s];
    l.gz = (prefix[byteAt[l.e]] - prefix[byteAt[l.s]]) / 8;
  }
  for (const l of chunk.arrays ?? []) {
    const i = segmentAt(chunk, l.s);
    l.src = i >= 0 && dm.src[i] >= 0 ? dm.src[i] : nSrc;
    l.raw = byteAt[l.e] - byteAt[l.s];
    l.gz = (prefix[byteAt[l.e]] - prefix[byteAt[l.s]]) / 8;
  }
}

/** Per-(chunk, module) rows. The unmapped bucket is reported as `[unmapped]`. */
export function moduleRows(build) {
  const rows = [];
  for (const c of build.chunks) {
    if (!c.srcRaw) {
      rows.push({ chunk: c.name, id: c.id, module: '[unmapped]', group: '[bundler/glue]', group2: '[bundler/glue]', raw: c.raw, gz: c.gz, textRaw: 0, textGz: 0 });
      continue;
    }
    const nSrc = c.sources.length;
    for (let s = 0; s <= nSrc; s++) {
      const raw = c.srcRaw[s];
      if (!raw && !c.srcGz[s]) continue;
      const module = s === nSrc ? '[unmapped]' : c.sources[s];
      const g = s === nSrc ? '[bundler/glue]' : groupOf(module);
      rows.push({
        chunk: c.name,
        id: c.id,
        module,
        group: g,
        group2: s === nSrc ? g : group2Of(module),
        raw,
        gz: c.srcGz[s] + (s === nSrc ? (c.framingBytes ?? 0) : 0),
        textRaw: c.srcTextRaw[s],
        textGz: c.srcTextGz[s],
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Chunk graph: what loads when
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Where the code that starts each dynamic import runs. These are read from the source (see README, "Load paths"):
 *   boot: runs before the first screen is usable (src/ui/modules.ts loadServices(), requested all at once)
 *   native-boot: runs at start-up on Android / iOS only (src/ui/prefs.ts native(): the Preferences plugin)
 * Everything else is on demand (a tap, a screen, a first use) and is named by its call site.
 */
const BOOT_CALLERS = [/^src\/ui\/modules\.ts$/];
const NATIVE_BOOT_CALLERS = [/^src\/ui\/prefs\.ts$/];

export function chunkGraph(build) {
  const { chunks, byName } = build;
  const entry = build.byName.get(build.entry);
  const closure = (roots) => {
    const seen = new Set();
    const stack = [...roots];
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n) || !byName.has(n)) continue;
      seen.add(n);
      for (const s of byName.get(n).statics ?? []) stack.push(s);
    }
    return seen;
  };
  const entryStatic = closure([entry.name]);
  // Dynamic edges with call sites.
  const edges = [];
  for (const c of chunks) {
    for (const d of c.dynamics ?? []) {
      const where = c.segStart ? originalAt(c, d.pos) : null;
      edges.push({ from: c.name, to: d.target, site: where ? `${where.file}:${where.line}` : '(no map)', file: where?.file ?? '' });
    }
    for (const w of c.workerRefs ?? []) {
      const where = c.segStart ? originalAt(c, c.text.indexOf(w)) : null;
      edges.push({ from: c.name, to: w, site: where ? `${where.file}:${where.line}` : '(no map)', file: where?.file ?? '', worker: true });
    }
  }
  const bootTargets = new Set();
  const nativeBootTargets = new Set();
  for (const e of edges) {
    if (e.worker) continue;
    if (BOOT_CALLERS.some((r) => r.test(e.file))) bootTargets.add(e.to);
    else if (NATIVE_BOOT_CALLERS.some((r) => r.test(e.file))) nativeBootTargets.add(e.to);
  }
  const bootSet = closure([entry.name, ...bootTargets]);
  const nativeBootSet = closure([entry.name, ...bootTargets, ...nativeBootTargets]);
  const workerRoots = edges.filter((e) => e.worker).map((e) => e.to);
  const workerSet = closure(workerRoots);
  const info = new Map();
  for (const c of chunks) {
    let kind;
    if (c.isEntry) kind = 'entry';
    else if (c.isWorker) kind = 'worker';
    else if (entryStatic.has(c.name)) kind = 'static (entry graph)';
    else if (bootTargets.has(c.name)) kind = 'boot (requested at start-up)';
    else if (bootSet.has(c.name)) kind = 'static (of a boot chunk)';
    else if (nativeBootSet.has(c.name)) kind = 'native boot';
    else kind = 'lazy';
    const importers = edges.filter((e) => e.to === c.name && !e.worker);
    const staticImporters = chunks.filter((o) => (o.statics ?? []).includes(c.name)).map((o) => o.name);
    info.set(c.name, { kind, importers, staticImporters, inWorkerGraph: workerSet.has(c.name) });
  }
  return { info, entryStatic, bootSet, nativeBootSet, workerSet, edges, bootTargets };
}

// ---------------------------------------------------------------------------------------------------------------------
// Costs of original source ranges (declarations, class members): bytes of the bundle whose map points inside the range
// ---------------------------------------------------------------------------------------------------------------------

function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Per (chunk, source): the segments sorted by original offset, with prefix sums of raw bytes and gzip bits. */
function origIndex(chunk, srcIdx) {
  chunk._orig ??= new Map();
  let x = chunk._orig.get(srcIdx);
  if (x) return x;
  const text = chunk.map?.sourcesContent?.[srcIdx];
  if (text == null || !chunk.dm) return null;
  const ls = lineStartsOf(text);
  const { dm, segStart, segEnd, byteAt, prefix } = chunk;
  const items = [];
  for (let i = 0; i < dm.n; i++) if (dm.src[i] === srcIdx) items.push(i);
  const off = items.map((i) => (ls[dm.sLine[i]] ?? 0) + dm.sCol[i]);
  const order = items.map((_, k) => k).sort((a, b) => off[a] - off[b]);
  const o = new Int32Array(order.length);
  const raw = new Float64Array(order.length + 1);
  const bits = new Float64Array(order.length + 1);
  order.forEach((k, j) => {
    const i = items[k];
    o[j] = off[k];
    const b0 = byteAt[segStart[i]];
    const b1 = byteAt[segEnd[i]];
    raw[j + 1] = raw[j] + (b1 - b0);
    bits[j + 1] = bits[j] + (prefix[b1] - prefix[b0]);
  });
  x = { o, raw, bits, text };
  chunk._orig.set(srcIdx, x);
  return x;
}

/** Raw bytes and gzip bytes of the generated code that maps into [a, b) of source `srcIdx` (offsets in the original text). */
export function rangeCost(chunk, srcIdx, a, b) {
  const x = origIndex(chunk, srcIdx);
  if (!x) return { raw: 0, gz: 0 };
  const lo = lowerBound(x.o, a);
  const hi = lowerBound(x.o, b);
  return { raw: x.raw[hi] - x.raw[lo], gz: (x.bits[hi] - x.bits[lo]) / 8 };
}

const hasMod = (n, kind) => !!n.modifiers?.some((m) => m.kind === kind);

/**
 * Runtime declarations of a TypeScript source: top-level functions, classes (with their members), variables, enums,
 * and the members of top-level object literals. Types and interfaces have no code and are left out.
 */
export function declUnits(text, fileName = 'x.ts') {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const units = [];
  const nameOf = (n) => (n.name && (ts.isIdentifier(n.name) || ts.isPrivateIdentifier(n.name) || ts.isStringLiteral(n.name)) ? n.name.text : n.name && ts.isComputedPropertyName(n.name) ? `[${n.name.expression.getText(sf)}]` : null);
  const add = (u) => units.push(u);
  for (const st of sf.statements) {
    const exported = hasMod(st, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasMod(st, ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(st) && st.body) {
      add({ name: st.name?.text ?? 'default', kind: 'function', start: st.getStart(sf), end: st.end, nameStart: (st.name ?? st).getStart(sf), exported, isDefault });
    } else if (ts.isClassDeclaration(st)) {
      const cname = st.name?.text ?? 'default';
      add({ name: cname, kind: 'class', start: st.getStart(sf), end: st.end, nameStart: (st.name ?? st).getStart(sf), exported, isDefault });
      for (const m of st.members) {
        if (ts.isConstructorDeclaration(m)) add({ name: 'constructor', kind: 'ctor', parent: cname, start: m.getStart(sf), end: m.end, nameStart: m.getStart(sf) });
        else if (ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m) || ts.isPropertyDeclaration(m)) {
          const n = nameOf(m);
          if (n == null) continue;
          const kind = ts.isMethodDeclaration(m) ? 'method' : ts.isGetAccessorDeclaration(m) ? 'getter' : ts.isSetAccessorDeclaration(m) ? 'setter' : 'field';
          add({ name: n, kind, parent: cname, start: m.getStart(sf), end: m.end, nameStart: m.name.getStart(sf), isStatic: hasMod(m, ts.SyntaxKind.StaticKeyword), isPrivate: hasMod(m, ts.SyntaxKind.PrivateKeyword) || (m.name && ts.isPrivateIdentifier(m.name)), isAbstract: hasMod(m, ts.SyntaxKind.AbstractKeyword), hasBody: ts.isPropertyDeclaration(m) ? !!m.initializer : !!m.body });
        }
      }
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) {
          // const { a, b } = ...: one unit for the whole declarator; references to any bound name count.
          const names = [];
          const collect = (b) => {
            for (const el of b.elements) {
              if (ts.isOmittedExpression(el)) continue;
              if (ts.isIdentifier(el.name)) names.push(el.name);
              else collect(el.name);
            }
          };
          collect(d.name);
          add({ name: '(' + names.map((n) => n.text).join(', ') + ')', kind: 'const', start: d.getStart(sf), end: d.end, nameStart: names[0]?.getStart(sf) ?? d.getStart(sf), nameStarts: names.map((n) => n.getStart(sf)), exported });
          continue;
        }
        add({ name: d.name.text, kind: 'const', start: d.getStart(sf), end: d.end, nameStart: d.name.getStart(sf), exported });
        const init = d.initializer && ts.skipOuterExpressions ? ts.skipOuterExpressions(d.initializer) : d.initializer;
        if (init && ts.isObjectLiteralExpression(init)) {
          for (const p of init.properties) {
            const n = p.name ? nameOf(p) : null;
            if (n == null) continue;
            add({ name: n, kind: 'prop', parent: d.name.text, start: p.getStart(sf), end: p.end, nameStart: p.name.getStart(sf) });
          }
        }
      }
    } else if (ts.isEnumDeclaration(st) && !hasMod(st, ts.SyntaxKind.ConstKeyword) && !hasMod(st, ts.SyntaxKind.DeclareKeyword)) {
      add({ name: st.name.text, kind: 'enum', start: st.getStart(sf), end: st.end, nameStart: st.name.getStart(sf), exported });
    }
  }
  return { units, sf };
}

// ---------------------------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------------------------

function cmdChunks(build) {
  const g = chunkGraph(build);
  const rows = build.chunks
    .map((c) => ({ c, i: g.info.get(c.name) }))
    .sort((a, b) => b.c.gz - a.c.gz);
  const tot = (f) => build.chunks.reduce((a, c) => a + f(c), 0);
  const out = [];
  out.push(
    mdTable(
      ['Chunk', 'Raw kB', 'gzip -9 kB', 'brotli 11 kB', 'Loaded', 'Trigger (source file:line of the import)'],
      [
        ...rows.map(({ c, i }) => {
          let trigger = '';
          if (i.kind === 'entry') trigger = 'index.html `<script type=module>`';
          else if (i.kind === 'worker') trigger = i.importers.length ? '' : 'new Worker(new URL(...)) in `src/sim/client.ts` (when the sim screen opens)';
          else if (i.kind === 'static (entry graph)') trigger = `static import of ${i.staticImporters.join(', ')}`;
          else if (i.importers.length) trigger = [...new Set(i.importers.map((e) => e.site))].join('; ');
          if (i.kind === 'static (of a boot chunk)' || (i.kind === 'lazy' && !trigger)) trigger = (trigger ? trigger + '; ' : '') + `static import of ${i.staticImporters.join(', ')}`;
          if (c.isWorker && i.importers.length === 0) trigger = 'new Worker(new URL(...)) in src/sim/client.ts, made when the sim screen opens';
          return [c.name, kb(c.raw), kb(c.gz), kb(c.br), i.kind, trigger];
        }),
        ['**All JS (' + build.chunks.length + ' files)**', `**${kb(tot((c) => c.raw))}**`, `**${kb(tot((c) => c.gz))}**`, `**${kb(tot((c) => c.br))}**`, '', ''],
      ],
      'lrrrll',
    ),
  );
  // When the bytes are parsed: the entry and its static imports first, then what loadServices() requests at once, then the
  // worker (parsed in the worker thread when the sim screen opens), then everything else on demand.
  const names = build.chunks.map((c) => c.name);
  const sumOf = (set, f) => build.chunks.filter((c) => set.has(c.name)).reduce((a, c) => a + f(c), 0);
  const phase1 = g.entryStatic;
  const phase2 = new Set([...g.bootSet].filter((n) => !phase1.has(n)));
  const phase3 = new Set(build.chunks.filter((c) => c.isWorker).map((c) => c.name));
  const phase4 = new Set(names.filter((n) => !phase1.has(n) && !phase2.has(n) && !phase3.has(n)));
  const row = (label, set) => [label, set.size, kb(sumOf(set, (c) => c.raw)), kb(sumOf(set, (c) => c.gz)), kb(sumOf(set, (c) => c.br))];
  out.push('\n### When the bytes are parsed\n');
  out.push(
    mdTable(
      ['Phase', 'Files', 'Raw kB', 'gzip -9 kB', 'brotli 11 kB'],
      [
        row('1. Before the first screen: the entry and its static imports (modulepreload in index.html)', phase1),
        row('2. Requested at once by `loadServices()` (sim, render, scenario, mocks) with their static imports: also at start-up, on the main thread', phase2),
        row('3. The simulation worker (parsed in the worker thread when the sim screen opens)', phase3),
        row('4. On demand (GeoTIFF decoders, geolocation, native preferences)', phase4),
      ],
      'lrrrr',
    ),
  );
  const startRaw = sumOf(phase1, (c) => c.raw) + sumOf(phase2, (c) => c.raw);
  out.push(`\nMain-thread JavaScript parsed at start-up (phases 1 and 2): raw ${kb(startRaw)} kB of ${kb(tot((c) => c.raw))} kB (${pct(startRaw, tot((c) => c.raw))}). Phase 4 members: ${[...phase4].join(', ')}.`);
  return { text: out.join('\n'), graph: g };
}

function cmdModules(build, top = 40) {
  const rows = moduleRows(build);
  const out = [];
  // Per chunk: groups.
  const byChunk = new Map();
  for (const r of rows) {
    if (!byChunk.has(r.chunk)) byChunk.set(r.chunk, []);
    byChunk.get(r.chunk).push(r);
  }
  const chunkOrder = build.chunks.slice().sort((a, b) => b.gz - a.gz);
  out.push('### Top ' + top + ' modules, all chunks (by gzip bytes attributed)\n');
  const sorted = rows.filter((r) => r.module !== '[unmapped]').sort((a, b) => b.gz - a.gz).slice(0, top);
  out.push(mdTable(['#', 'Module', 'Chunk', 'Raw kB', 'gzip kB', 'Group'], sorted.map((r, i) => [i + 1, '`' + r.module + '`', r.id, kb(r.raw), kb(r.gz, 2), r.group]), 'lllrrl'));
  out.push('\n### Packages and folders, all chunks together\n');
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.group) ?? { raw: 0, gz: 0, n: 0, chunks: new Map() };
    g.raw += r.raw;
    g.gz += r.gz;
    g.n++;
    g.chunks.set(r.id, (g.chunks.get(r.id) ?? 0) + r.gz);
    groups.set(r.group, g);
  }
  const totalGz = build.chunks.reduce((a, c) => a + c.gz, 0);
  const totalRaw = build.chunks.reduce((a, c) => a + c.raw, 0);
  out.push(
    mdTable(
      ['Group', 'Raw kB', 'gzip kB', '% of all gzip', 'Modules', 'Where (gzip kB per chunk)'],
      [...groups.entries()]
        .sort((a, b) => b[1].gz - a[1].gz)
        .map(([name, g]) => [
          name,
          kb(g.raw),
          kb(g.gz),
          pct(g.gz, totalGz),
          g.n,
          [...g.chunks.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([id, gz]) => `${id} ${kb(gz)}`)
            .join(', '),
        ]),
      'lrrrrl',
    ),
  );
  out.push(`\nTotal: raw ${kb(totalRaw)} kB, gzip ${kb(totalGz)} kB.`);
  // Modules that are bundled into more than one chunk (the worker is a separate bundle, so it repeats code of the main thread).
  const byModule = new Map();
  for (const r of rows) {
    if (r.module === '[unmapped]') continue;
    if (!byModule.has(r.module)) byModule.set(r.module, []);
    byModule.get(r.module).push(r);
  }
  const dups = [...byModule.entries()].filter(([, l]) => l.length > 1).map(([m, l]) => {
    const sorted = l.slice().sort((a, b) => b.gz - a.gz);
    return { m, chunks: sorted.map((x) => x.id), extraRaw: sorted.slice(1).reduce((a, x) => a + x.raw, 0), extraGz: sorted.slice(1).reduce((a, x) => a + x.gz, 0), group: groupOf(m) };
  });
  dups.sort((a, b) => b.extraGz - a.extraGz);
  const dupGz = dups.reduce((a, d) => a + d.extraGz, 0);
  const dupRaw = dups.reduce((a, d) => a + d.extraRaw, 0);
  out.push(`\n### Modules bundled into more than one chunk\n`);
  out.push(`${dups.length} modules appear in two chunks (the sim chunk and the worker bundle are built separately, so the engine is in both). The smaller copies add raw ${kb(dupRaw)} kB, gzip ${kb(dupGz)} kB to the total.\n`);
  out.push(mdTable(['Module', 'Chunks', 'Extra copy raw kB', 'Extra copy gzip kB'], dups.slice(0, 15).map((d) => ['`' + d.m + '`', d.chunks.join(' + '), kb(d.extraRaw), kb(d.extraGz, 2)]), 'llrr'));
  out.push('\n### Per chunk: groups, then the biggest modules\n');
  for (const c of chunkOrder) {
    const cr = byChunk.get(c.name) ?? [];
    out.push(`#### ${c.name}: raw ${kb(c.raw)} kB, gzip ${kb(c.gz)} kB\n`);
    const gg = new Map();
    for (const r of cr) {
      const g = gg.get(r.group) ?? { raw: 0, gz: 0, n: 0 };
      g.raw += r.raw;
      g.gz += r.gz;
      g.n++;
      gg.set(r.group, g);
    }
    out.push(mdTable(['Group', 'Raw kB', 'gzip kB', '% of chunk gzip', 'Modules'], [...gg.entries()].sort((a, b) => b[1].gz - a[1].gz).map(([n, g]) => [n, kb(g.raw), kb(g.gz), pct(g.gz, c.gz), g.n]), 'lrrrr'));
    const mm = cr.slice().sort((a, b) => b.gz - a.gz).slice(0, c.gz > 20 * KB ? 12 : 5);
    out.push('');
    out.push(mdTable(['Module', 'Raw kB', 'gzip kB'], mm.map((r) => ['`' + r.module + '`', kb(r.raw), kb(r.gz, 2)]), 'lrr'));
    out.push('');
  }
  return { text: out.join('\n'), rows, dups };
}

function cmdBlobs(build, min = 600) {
  const out = [];
  const all = [];
  for (const c of build.chunks) {
    for (const l of [...(c.lits ?? []), ...(c.arrays ?? [])]) {
      if (l.e - l.s < min) continue;
      const nSrc = c.sources.length;
      all.push({ chunk: c, l, module: l.src === nSrc || l.src === undefined ? '[unmapped]' : c.sources[l.src] });
    }
  }
  all.sort((a, b) => b.l.gz - a.l.gz);
  const preview = (c, l) => c.text.slice(l.s, Math.min(l.e, l.s + 70)).replace(/\s+/g, ' ');
  out.push(`### Literals of ${min} characters or more (strings, templates, big arrays), biggest 40 by gzip bytes\n`);
  out.push(
    mdTable(
      ['Chunk', 'Module', 'Kind', 'Raw kB', 'gzip kB', 'Starts with'],
      all.slice(0, 40).map(({ chunk, l, module }) => [chunk.id, '`' + module + '`', l.kind, kb(l.raw, 2), kb(l.gz, 2), '`' + preview(chunk, l).replace(/`/g, "'") + '`']),
      'llcrrl',
    ),
  );
  const sum = (f) => all.reduce((a, x) => a + f(x), 0);
  out.push(`\n${all.length} such literals: raw ${kb(sum((x) => x.l.raw))} kB, gzip ${kb(sum((x) => x.l.gz))} kB (of all JS gzip ${kb(build.chunks.reduce((a, c) => a + c.gz, 0))} kB).\n`);
  // By module: all string-like text, any size.
  const rows = moduleRows(build).filter((r) => r.module !== '[unmapped]');
  const textHeavy = rows.filter((r) => r.raw >= 4 * KB).map((r) => ({ ...r, share: r.textRaw / r.raw })).sort((a, b) => b.textGz - a.textGz).slice(0, 25);
  out.push('### Modules by bytes inside string and template literals (any size), top 25 by gzip\n');
  out.push(mdTable(['Module', 'Chunk', 'Module raw kB', 'Text raw kB', 'Text gzip kB', 'Text share of raw'], textHeavy.map((r) => ['`' + r.module + '`', r.id, kb(r.raw), kb(r.textRaw), kb(r.textGz, 2), pct(r.textRaw, r.raw)]), 'llrrrr'));
  const tText = rows.reduce((a, r) => a + r.textRaw, 0);
  const tTextGz = rows.reduce((a, r) => a + r.textGz, 0);
  out.push(`\nAll string and template literals together: raw ${kb(tText)} kB, gzip ${kb(tTextGz)} kB.`);
  // console.* diagnostics
  const cons = new Map();
  let cN = 0;
  for (const c of build.chunks) {
    for (const l of c.consoles ?? []) {
      const mod = l.src === c.sources.length || l.src === undefined ? '[unmapped]' : c.sources[l.src];
      const lib = mod.startsWith('node_modules/');
      const key = (lib ? 'library: ' : 'app: ') + l.level;
      const g = cons.get(key) ?? { n: 0, raw: 0, gz: 0 };
      g.n++;
      g.raw += l.raw;
      g.gz += l.gz;
      cons.set(key, g);
      cN++;
    }
  }
  out.push(`\n### console.* calls (the call and its arguments, as compiled)\n`);
  out.push(mdTable(['Origin and level', 'Calls', 'Raw kB', 'gzip kB'], [...cons.entries()].sort((a, b) => b[1].gz - a[1].gz).map(([k, g]) => [k, g.n, kb(g.raw, 2), kb(g.gz, 2)]), 'lrrr'));
  out.push(`\n${cN} calls, raw ${kb([...cons.values()].reduce((a, g) => a + g.raw, 0), 2)} kB, gzip ${kb([...cons.values()].reduce((a, g) => a + g.gz, 0), 2)} kB.`);
  return { text: out.join('\n'), all };
}

/** gzip -9 bytes saved (and raw) by deleting every byte that maps to the matching sources. */
function cutBytes(chunk, matchIdx) {
  if (!chunk.segStart) return { raw: 0, gz: 0 };
  const keep = [];
  let pos = 0;
  const { dm, segStart, segEnd } = chunk;
  const buf = chunk.buf;
  let deleted = 0;
  const ranges = [];
  for (let i = 0; i < dm.n; i++) {
    if (dm.src[i] >= 0 && matchIdx.has(dm.src[i])) {
      const b0 = chunk.byteAt[segStart[i]];
      const b1 = chunk.byteAt[segEnd[i]];
      if (ranges.length && ranges[ranges.length - 1][1] === b0) ranges[ranges.length - 1][1] = b1;
      else ranges.push([b0, b1]);
    }
  }
  for (const [b0, b1] of ranges) {
    keep.push(buf.subarray(pos, b0));
    deleted += b1 - b0;
    pos = b1;
  }
  keep.push(buf.subarray(pos));
  const rest = Buffer.concat(keep);
  return { raw: deleted, gz: chunk.gz - gzip9(rest).length };
}

/** Top-level declarations (and class members) of the matching modules with the bytes each one ships. */
function cmdSymbols(build, match, minRaw = 0) {
  const re = new RegExp(match);
  const out = [];
  for (const c of build.chunks) {
    if (!c.map) continue;
    c.sources.forEach((src, idx) => {
      if (!re.test(src)) return;
      const text = c.map.sourcesContent[idx];
      const { units } = declUnits(text, src);
      const total = rangeCost(c, idx, 0, text.length);
      const rows = units
        .map((u) => ({ u, ...rangeCost(c, idx, u.start, u.end) }))
        .filter((r) => r.raw >= minRaw)
        .sort((a, b) => b.gz - a.gz);
      out.push(`#### ${src} in ${c.name}: raw ${kb(total.raw, 2)} kB, gzip ${kb(total.gz, 2)} kB (${units.length} declarations)\n`);
      out.push(
        mdTable(
          ['Declaration', 'Kind', 'Exported', 'Raw kB', 'gzip kB'],
          rows.slice(0, 40).map((r) => [(r.u.parent ? r.u.parent + '.' : '') + r.u.name, r.u.kind, r.u.exported ? 'yes' : '', kb(r.raw, 2), kb(r.gz, 2)]),
          'llcrr',
        ),
      );
      out.push('');
    });
  }
  return { text: out.join('\n') || 'No matching source with code in the bundle.' };
}

function cmdCut(build, match, chunkPrefix) {
  const re = new RegExp(match);
  const out = [];
  let tRaw = 0;
  let tGz = 0;
  const rows = [];
  for (const c of build.chunks) {
    if (chunkPrefix && !c.name.startsWith(chunkPrefix)) continue;
    if (!c.sources.length) continue;
    const idx = new Set(c.sources.map((s, i) => (re.test(s) ? i : -1)).filter((i) => i >= 0));
    if (!idx.size) continue;
    const r = cutBytes(c, idx);
    tRaw += r.raw;
    tGz += r.gz;
    rows.push([c.name, [...idx].map((i) => c.sources[i]).join(', '), kb(r.raw, 2), kb(r.gz, 2)]);
  }
  out.push(mdTable(['Chunk', 'Modules deleted', 'Raw kB', 'gzip -9 kB saved'], rows, 'llrr'));
  out.push(`\nTotal: raw ${kb(tRaw, 2)} kB, gzip ${kb(tGz, 2)} kB (the chunk is compressed again without those bytes).`);
  return { text: out.join('\n'), raw: tRaw, gz: tGz };
}

// ---------------------------------------------------------------------------------------------------------------------
// Dead code: module reachability and a symbol-level call graph from the TypeScript language service
// ---------------------------------------------------------------------------------------------------------------------

const isTestPath = (rel) => /\.test\.ts$/.test(rel) || /\/testing\//.test(rel) || /\/(testing|testUtils?|testUtil|nswContextTesting)\.ts$/.test(rel);
const isDevPath = (rel) => /^src\/render\/(dev|devTrees|devScenario|legendGallery)\.(ts|html)$/.test(rel) || /^src\/ui\/styleguide\.(ts|html)$/.test(rel);

/** Names the platform or a library calls on its own: never reported as dead. */
const PROTOCOL_NAMES = new Set(['constructor', 'toString', 'toJSON', 'valueOf', 'handleEvent', 'then', '[Symbol.iterator]', '[Symbol.asyncIterator]', '[Symbol.dispose]', '[Symbol.toPrimitive]']);

function openProgram(root) {
  const cfg = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
  const files = parsed.fileNames;
  const host = {
    getScriptFileNames: () => files,
    getScriptVersion: () => '1',
    getScriptSnapshot: (f) => (fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined),
    getCurrentDirectory: () => root,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };
  const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
  return { ls, program: ls.getProgram(), options: parsed.options, files };
}

/** Specifiers a module loads at run time: static imports and re-exports (not `import type`), import(), import.meta.glob(), new URL(x, import.meta.url). */
function runtimeSpecs(sf) {
  const specs = [];
  const lit = (a) => (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null);
  const visit = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.importClause?.isTypeOnly) specs.push({ spec: n.moduleSpecifier.text, kind: 'static' });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.isTypeOnly) specs.push({ spec: n.moduleSpecifier.text, kind: 'static' });
    } else if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const v = lit(n.arguments[0]);
        if (v) specs.push({ spec: v, kind: 'dynamic' });
      } else if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'glob' && ts.isMetaProperty(n.expression.expression)) {
        const a = n.arguments[0];
        if (lit(a)) specs.push({ spec: lit(a), kind: 'glob', relative: true });
        else if (a && ts.isArrayLiteralExpression(a)) for (const e of a.elements) if (lit(e)) specs.push({ spec: lit(e), kind: 'glob', relative: true });
      }
    } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'URL' && n.arguments?.length === 2 && lit(n.arguments[0]) && /import\.meta\.url/.test(n.arguments[1].getText(sf))) {
      specs.push({ spec: lit(n.arguments[0]), kind: 'url', relative: true });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return specs;
}

function nodeAt(sf, pos) {
  let found = sf;
  const walk = (n) => {
    if (pos >= n.getStart(sf) && pos < n.end) {
      found = n;
      ts.forEachChild(n, walk);
    }
  };
  ts.forEachChild(sf, walk);
  return found;
}

/** True when the identifier at a reference is a run-time use (not an import, export list, type position or `implements`). */
function isValueUse(node) {
  for (let p = node; p; p = p.parent) {
    if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isImportEqualsDeclaration(p) || ts.isExportSpecifier(p) || ts.isExportDeclaration(p)) return false;
    if (ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) return false;
    if (ts.isHeritageClause(p) && p.token === ts.SyntaxKind.ImplementsKeyword) return false;
    if (ts.isTypeNode(p) && !ts.isExpressionWithTypeArguments(p)) return false;
    if (ts.isStatement(p) || ts.isSourceFile(p)) return true;
  }
  return true;
}

async function cmdDead(build, rootArg, opts = {}) {
  const root = path.resolve(rootArg).replace(/\\/g, '/');
  const log = (...a) => console.error('[dead]', ...a);
  const out = [];
  // --- 1. the modules in the build, and whether `root` is the tree the build came from
  const bundled = new Map(); // rel -> [{chunk, idx}]
  for (const c of build.chunks) {
    c.sources.forEach((src, idx) => {
      if (!src.startsWith('src/')) return;
      if (!bundled.has(src)) bundled.set(src, []);
      bundled.get(src).push({ chunk: c, idx });
    });
  }
  const mismatch = [];
  for (const [rel, list] of bundled) {
    const f = path.join(root, rel);
    const disk = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    if (disk !== list[0].chunk.map.sourcesContent[list[0].idx]) mismatch.push(rel);
  }
  if (mismatch.length) {
    log(`WARNING: ${mismatch.length} source file(s) under ${root} differ from the build's sourcesContent (e.g. ${mismatch[0]}); the numbers below are not reliable.`);
  }
  out.push(`Tree checked: \`${root}\`; ${bundled.size} application modules have code in the build; ${mismatch.length} differ from the build's embedded sources.\n`);
  // --- 2. program
  const t0 = Date.now();
  const { ls, program, options } = openProgram(root);
  const checker = program.getTypeChecker();
  const relOf = (f) => path.relative(root, f).split(path.sep).join('/');
  const appFiles = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile && relOf(sf.fileName).startsWith('src/') && !relOf(sf.fileName).startsWith('..'));
  log(`program: ${appFiles.length} files under src/ in ${Date.now() - t0} ms`);
  // --- 3. module graph from the entry points
  const byRel = new Map(appFiles.map((sf) => [relOf(sf.fileName), sf]));
  const edges = new Map(); // rel -> Set(rel)
  for (const sf of appFiles) {
    const from = relOf(sf.fileName);
    const set = new Set();
    for (const s of runtimeSpecs(sf)) {
      let target = null;
      if (s.relative) target = path.resolve(path.dirname(sf.fileName), s.spec);
      else if (s.spec.startsWith('.') || s.spec.startsWith('@/')) {
        const r = ts.resolveModuleName(s.spec, sf.fileName, options, ts.sys).resolvedModule;
        target = r?.resolvedFileName ?? null;
      }
      if (target) {
        const rel = relOf(target.replace(/\\/g, '/'));
        if (byRel.has(rel)) set.add(rel);
      }
    }
    edges.set(from, set);
  }
  const entries = ['src/main.ts', 'src/sim/worker.ts'].filter((e) => byRel.has(e));
  const reachable = new Set();
  const stack = [...entries];
  while (stack.length) {
    const m = stack.pop();
    if (reachable.has(m)) continue;
    reachable.add(m);
    for (const n of edges.get(m) ?? []) stack.push(n);
  }
  const bundledSet = new Set(bundled.keys());
  const notReachableButBundled = [...bundledSet].filter((m) => !reachable.has(m));
  const sizeOf = (rel) => fs.statSync(path.join(root, rel)).size;
  const unreachable = [...byRel.keys()].filter((m) => !reachable.has(m));
  const cat = (m) => (isTestPath(m) ? 'test or test helper' : isDevPath(m) ? 'dev page' : 'other');
  const unreachCats = new Map();
  for (const m of unreachable) {
    const k = cat(m);
    const g = unreachCats.get(k) ?? { n: 0, bytes: 0, list: [] };
    g.n++;
    g.bytes += sizeOf(m);
    g.list.push(m);
    unreachCats.set(k, g);
  }
  out.push('### Modules: reachability from `src/main.ts` and `src/sim/worker.ts`\n');
  out.push(
    `${appFiles.length} files under src/ (the TypeScript program, tests included). Following run-time imports (static, \`import()\`, \`import.meta.glob\`, \`new URL(...)\`; \`import type\` is not followed) from the two entry points reaches ${reachable.size}. ${bundledSet.size} of those have code in the build. Modules in the build that the graph did not reach: ${notReachableButBundled.length}${notReachableButBundled.length ? ' (' + notReachableButBundled.join(', ') + ')' : ' (the graph is complete)'}.\n`,
  );
  out.push(mdTable(['Not reachable from the app', 'Files', 'Source kB', 'Examples'], [...unreachCats.entries()].map(([k, g]) => [k, g.n, kb(g.bytes), g.list.slice(0, 6).map((x) => '`' + x + '`').join(', ')]), 'lrrl'));
  const otherUnreach = (unreachCats.get('other')?.list ?? []).map((m) => [`\`${m}\``, kb(sizeOf(m), 1)]);
  out.push('\nFiles under `src/` that are not tests, not dev pages and not reachable from the entry points (they cost nothing in the bundle):\n');
  out.push(mdTable(['File', 'Source kB'], otherUnreach, 'lr'));
  const reachNoBytes = [...reachable].filter((m) => !bundledSet.has(m) && !isTestPath(m));
  const withCode = [];
  for (const m of reachNoBytes) {
    const { units } = declUnits(fs.readFileSync(path.join(root, m), 'utf8'), m);
    if (units.length) withCode.push([m, units.length, sizeOf(m)]);
  }
  out.push(`\nReachable modules with run-time declarations but no bytes in any chunk (the bundler dropped everything: nothing in them is used): ${withCode.length}.\n`);
  if (withCode.length) out.push(mdTable(['Module', 'Declarations', 'Source kB'], withCode.sort((a, b) => b[2] - a[2]).map((r) => ['`' + r[0] + '`', r[1], kb(r[2])]), 'lrr'));

  // --- 4. units of the bundled modules, with their bytes
  const unitsOf = new Map(); // rel -> {units, sf}
  const unitList = [];
  for (const [rel, list] of bundled) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const { units } = declUnits(text, rel);
    const kept = units.filter((u) => u.kind !== 'prop' && u.kind !== 'ctor');
    for (const u of kept) {
      u.rel = rel;
      u.id = unitList.length;
      u.raw = 0;
      u.gz = 0;
      u.byChunk = {};
      for (const { chunk, idx } of list) {
        const r = rangeCost(chunk, idx, u.start, u.end);
        u.raw += r.raw;
        u.gz += r.gz;
        if (r.raw) u.byChunk[chunk.id] = (u.byChunk[chunk.id] ?? 0) + r.gz;
      }
      unitList.push(u);
    }
    unitsOf.set(rel, { units: kept, sf: byRel.get(rel) });
  }
  // Own bytes: a class's bytes minus its members'.
  for (const [rel, { units }] of unitsOf) {
    for (const u of units) {
      if (u.kind !== 'class') continue;
      let mr = 0;
      let mg = 0;
      for (const m of units) if (m.parent === u.name && m !== u && m.kind !== 'class') {
        mr += m.raw;
        mg += m.gz;
      }
      u.ownRaw = Math.max(0, u.raw - mr);
      u.ownGz = Math.max(0, u.gz - mg);
    }
    for (const u of units) if (u.ownRaw === undefined) {
      u.ownRaw = u.raw;
      u.ownGz = u.gz;
    }
  }
  const innermost = (rel, pos) => {
    const ent = unitsOf.get(rel);
    if (!ent) return null;
    let best = null;
    for (const u of ent.units) if (pos >= u.start && pos < u.end && (!best || u.end - u.start < best.end - best.start)) best = u;
    return best;
  };
  const unitContaining = (rel, start) => (unitsOf.get(rel)?.units ?? []).find((u) => u.start <= start && start < u.end && u.nameStart === start) ?? null;

  // --- 5. references (value uses only) from the language service
  const refsTo = new Map(); // target id -> Set of source ids (-1 = module top level)
  const refCount = new Map();
  const queryUnits = unitList.filter((u) => !(u.kind === 'field' && !u.hasBody) && !u.isAbstract);
  let done = 0;
  const t1 = Date.now();
  const mention = new Map();
  for (const u of queryUnits) {
    const file = path.join(root, u.rel);
    const res = (u.nameStarts ?? [u.nameStart]).flatMap((pos) => ls.findReferences(file, pos) ?? []);
    const set = new Set();
    let nRefs = 0;
    for (const g of res) {
      for (const r of g.references) {
        if (r.isDefinition) continue;
        const rf = relOf(r.fileName.replace(/\\/g, '/'));
        if (!unitsOf.has(rf)) continue; // tests, dev pages, modules without code in the build
        const sf = unitsOf.get(rf).sf;
        const node = nodeAt(sf, r.textSpan.start);
        if (!isValueUse(node)) continue;
        const enc = innermost(rf, r.textSpan.start);
        if (enc && rf === u.rel && enc.start >= u.start && enc.end <= u.end) continue; // inside itself
        if (enc && rf === u.rel && u.kind === 'class' && enc.parent === u.name) continue;
        set.add(enc ? enc.id : -1);
        nRefs++;
      }
    }
    refsTo.set(u.id, set);
    refCount.set(u.id, nRefs);
    if (++done % 500 === 0) log(`${done}/${queryUnits.length} units queried (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
  }
  log(`references: ${queryUnits.length} units in ${((Date.now() - t1) / 1000).toFixed(0)} s`);

  // --- 6. liveness
  const outEdges = new Map(); // source id -> Set(target ids)
  const rootLive = new Set();
  for (const [t, srcs] of refsTo) {
    for (const s of srcs) {
      if (s === -1) rootLive.add(t);
      else {
        if (!outEdges.has(s)) outEdges.set(s, new Set());
        outEdges.get(s).add(t);
      }
    }
  }
  const live = new Set(rootLive);
  const reason = new Map();
  for (const t of rootLive) reason.set(t, 'referenced from module top-level code');
  // Exports of the modules loaded through import.meta.glob are used through interface types the checker does not link.
  for (const idxRel of ['src/sim/index.ts', 'src/render/index.ts', 'src/scenario/index.ts']) {
    const sf = byRel.get(idxRel);
    const sym = sf && checker.getSymbolAtLocation(sf);
    if (!sym) continue;
    for (const e of checker.getExportsOfModule(sym)) {
      const target = e.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(e) : e;
      for (const d of target.declarations ?? []) {
        const rf = relOf(d.getSourceFile().fileName.replace(/\\/g, '/'));
        const nm = d.name ? d.name.getStart(d.getSourceFile()) : d.getStart(d.getSourceFile());
        const u = unitContaining(rf, nm);
        if (u && !live.has(u.id)) {
          live.add(u.id);
          reason.set(u.id, `exported through ${idxRel} (loaded by import.meta.glob in src/ui/modules.ts)`);
        }
      }
    }
  }
  // Members that override something an external library declares, protocol names, and fields' initialisers.
  const classNode = (rel, u) => {
    const sf = unitsOf.get(rel).sf;
    let found = null;
    ts.forEachChild(sf, (n) => {
      if (ts.isClassDeclaration(n) && n.getStart(sf) === u.start) found = n;
    });
    return found;
  };
  const externalOverride = new Set();
  for (const [rel, { units }] of unitsOf) {
    for (const cu of units.filter((x) => x.kind === 'class')) {
      const node = classNode(rel, cu);
      if (!node) continue;
      const type = checker.getTypeAtLocation(node);
      const bases = [];
      const walkBases = (t, depth = 0) => {
        if (depth > 6) return;
        for (const b of checker.getBaseTypes(t) ?? []) {
          bases.push(b);
          walkBases(b.target ?? b, depth + 1);
        }
      };
      try {
        walkBases(type);
      } catch {
        /* a class whose base is unresolved */
      }
      for (const m of units.filter((x) => x.parent === cu.name)) {
        for (const b of bases) {
          const prop = b.getProperty?.(m.name);
          if (prop?.declarations?.some((d) => !relOf(d.getSourceFile().fileName.replace(/\\/g, '/')).startsWith('src/'))) externalOverride.add(m.id);
        }
      }
    }
  }
  const classOf = new Map(); // "rel|ClassName" -> class unit
  for (const [rel, { units }] of unitsOf) for (const u of units) if (u.kind === 'class') classOf.set(rel + '|' + u.name, u);
  const alwaysLive = (u) => {
    if (u.parent && (PROTOCOL_NAMES.has(u.name) || externalOverride.has(u.id))) return 'protocol name or overrides a library member';
    if (u.isAbstract) return 'abstract';
    return null;
  };
  const queue = [...live];
  const markLive = (id, why) => {
    if (live.has(id)) return;
    live.add(id);
    reason.set(id, why);
    queue.push(id);
  };
  // When a class is live: its fields (initialisers run at construction), its protocol members and library overrides are live.
  const membersOf = new Map();
  for (const u of unitList) if (u.parent) {
    const k = u.rel + '|' + u.parent;
    if (!membersOf.has(k)) membersOf.set(k, []);
    membersOf.get(k).push(u);
  }
  const reviveMembers = (cu) => {
    for (const m of membersOf.get(cu.rel + '|' + cu.name) ?? []) {
      const why = m.kind === 'field' ? 'field of a live class (initialiser runs at construction)' : alwaysLive(m);
      if (why) markLive(m.id, why);
    }
  };
  for (const id of [...live]) if (unitList[id].kind === 'class') reviveMembers(unitList[id]);
  // Members whose class is also referenced only count once the class is live; seeds first, then propagate.
  while (queue.length) {
    const id = queue.pop();
    const u = unitList[id];
    if (u.kind === 'class') reviveMembers(u);
    // a live member keeps its class
    if (u.parent) {
      const cu = classOf.get(u.rel + '|' + u.parent);
      if (cu) markLive(cu.id, `contains the live member ${u.name}`);
    }
    for (const t of outEdges.get(id) ?? []) markLive(t, `used by ${u.parent ? u.parent + '.' : ''}${u.name} (${u.rel})`);
  }
  // Fields keep their class's other state; nothing else to do.
  const dead = unitList.filter((u) => !live.has(u.id) && u.kind !== 'field' && (u.raw > 0));
  const deadFields = unitList.filter((u) => !live.has(u.id) && u.kind === 'field' && u.raw > 0);
  const deadSet = new Set(dead.map((u) => u.id));
  // Why dead: referenced by nothing, or only by other dead units.
  const referrers = new Map();
  for (const [s, ts_] of outEdges) for (const t of ts_) {
    if (!referrers.has(t)) referrers.set(t, []);
    referrers.get(t).push(s);
  }
  const whyDead = (u) => {
    const rs = (referrers.get(u.id) ?? []).filter((r) => deadSet.has(r));
    const n = refCount.get(u.id) ?? 0;
    if (!n) return 'no reference in the bundled code';
    return rs.length ? 'only used by dead code: ' + rs.slice(0, 2).map((r) => `${unitList[r].parent ? unitList[r].parent + '.' : ''}${unitList[r].name}`).join(', ') : 'used only from code that is not in the build';
  };
  // --- 7. report
  const sum = (arr, f) => arr.reduce((a, u) => a + f(u), 0);
  const label = (u) => (u.parent ? `${u.parent}.${u.name}` : u.name);
  out.push('\n### Symbols in the build with no live reference\n');
  out.push(
    `Method: the TypeScript language service lists every reference to each of the ${unitList.length} top-level declarations and class members (functions, classes, variables, enums, methods, accessors, fields) of the ${bundled.size} modules in the build. A reference counts when it is a run-time use (not an import, an export list, a type position or \`implements\`) inside code that is itself live. Roots: module top-level statements, the exports behind the three \`import.meta.glob\` modules, constructors and fields of live classes, protocol names (${[...PROTOCOL_NAMES].slice(0, 4).join(', ')}, ...) and members that override a library class. Everything else not reached is dead. Bytes are the generated code whose source map points inside the declaration (summed over every chunk that contains it).\n`,
  );
  const totalDeadRaw = sum(dead, (u) => u.ownRaw);
  const totalDeadGz = sum(dead, (u) => u.ownGz);
  out.push(`Dead declarations with code in the build: ${dead.length}, own bytes raw ${kb(totalDeadRaw)} kB, gzip ${kb(totalDeadGz, 2)} kB (class bodies count without their members). Fields never read: ${deadFields.length} (raw ${kb(sum(deadFields, (u) => u.raw), 2)} kB).\n`);
  const byKind = new Map();
  for (const u of dead) {
    const g = byKind.get(u.kind) ?? { n: 0, raw: 0, gz: 0 };
    g.n++;
    g.raw += u.ownRaw;
    g.gz += u.ownGz;
    byKind.set(u.kind, g);
  }
  out.push(mdTable(['Kind', 'Count', 'Raw kB', 'gzip kB'], [...byKind.entries()].sort((a, b) => b[1].gz - a[1].gz).map(([k, g]) => [k, g.n, kb(g.raw, 2), kb(g.gz, 2)]), 'lrrr'));
  const byMod = new Map();
  for (const u of dead) {
    const g = byMod.get(u.rel) ?? { n: 0, raw: 0, gz: 0 };
    g.n++;
    g.raw += u.ownRaw;
    g.gz += u.ownGz;
    byMod.set(u.rel, g);
  }
  out.push('\nBy module (top 15 by gzip):\n');
  out.push(mdTable(['Module', 'Dead declarations', 'Raw kB', 'gzip kB'], [...byMod.entries()].sort((a, b) => b[1].gz - a[1].gz).slice(0, 15).map(([m, g]) => ['`' + m + '`', g.n, kb(g.raw, 2), kb(g.gz, 2)]), 'lrrr'));
  out.push('\nThe 40 biggest (own gzip bytes):\n');
  out.push(
    mdTable(
      ['Declaration', 'Module', 'Kind', 'Raw kB', 'gzip kB', 'Chunks', 'Why dead'],
      dead
        .slice()
        .sort((a, b) => b.ownGz - a.ownGz)
        .slice(0, 40)
        .map((u) => [label(u), '`' + u.rel + '`', u.kind, kb(u.ownRaw, 2), kb(u.ownGz, 2), Object.keys(u.byChunk).join(', '), whyDead(u)]),
      'llcrrll',
    ),
  );
  return { text: out.join('\n'), dead, deadFields, unitList, reachable, unreachable, bundled, refCount };
}

// ---------------------------------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------------------------------

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (!cmd || !['chunks', 'modules', 'blobs', 'cut', 'symbols', 'dead', 'all'].includes(cmd)) {
    console.error(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    process.exit(cmd ? 2 : 0);
  }
  const dist = opts.dist;
  if (!dist) {
    console.error('--dist <build folder> is required');
    process.exit(2);
  }
  const build = loadBuild(dist, { litMin: Number(opts.min ?? 600) });
  if (cmd === 'chunks') console.log(cmdChunks(build).text);
  else if (cmd === 'modules') console.log(cmdModules(build, Number(opts.top ?? 40)).text);
  else if (cmd === 'blobs') console.log(cmdBlobs(build, Number(opts.min ?? 600)).text);
  else if (cmd === 'dead') {
    if (!opts.root) throw new Error('--root <a clean checkout or git-archive snapshot of the commit the build came from> is required');
    const r = await cmdDead(build, opts.root, opts);
    console.log(r.text);
    if (opts.csv) fs.writeFileSync(opts.csv, csv(['declaration', 'module', 'kind', 'own_raw_bytes', 'own_gzip_bytes', 'chunks'], r.dead.map((u) => [(u.parent ? u.parent + '.' : '') + u.name, u.rel, u.kind, Math.round(u.ownRaw), Math.round(u.ownGz), Object.keys(u.byChunk).join(' ')])));
  } else if (cmd === 'symbols') {
    if (!opts.match) throw new Error('--match <regex on the module path> is required');
    console.log(cmdSymbols(build, opts.match, Number(opts.minraw ?? 0)).text);
  } else if (cmd === 'cut') {
    if (!opts.match) throw new Error('--match <regex on the module path> is required');
    console.log(cmdCut(build, opts.match, opts.chunk).text);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
