// node summarize.mjs DIR [--sites OUT.md] [--areas areas.json]
// DIR holds slice-union.json (run-slice.sh). Prints the aggregate tables of reports/3-slice-map.md and, with --sites, writes the exhaustive site list.
import fs from 'node:fs';
const args = process.argv.slice(2);
const DIR = args[0];
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const U = JSON.parse(fs.readFileSync(`${DIR}/slice-union.json`, 'utf8'));
const E = U.entries.filter((e) => !e.module);
const mods = U.entries.filter((e) => e.module);
const short = (f) => f.replace(/^src\//, '');
const fsmath = { exp: 'Exp', log: 'Log', pow: 'Pow', sin: 'Sin', cos: 'Cos', tan: 'Tan', atan: 'Atan', atan2: 'Atan2', acos: 'Acos', asin: 'Asin', sinh: 'Sinh', cbrt: 'Cbrt', log2: 'Log2', log10: 'Log10', hypot: 'Hypot' };
const exact = { abs: 'Math.Abs', sqrt: 'Math.Sqrt', floor: 'Math.Floor (then FsConv if used as an index)', ceil: 'Math.Ceiling (then FsConv)', trunc: 'Math.Truncate (then FsConv)', min: 'Math.Min', max: 'Math.Max', sign: 'FsConv.Sign (JS: NaN and -0 pass through)', round: 'FsConv.Round (JS half up)', fround: 'FsConv.Fround', imul: 'FsConv.Imul', clz32: 'FsConv.Clz32' };
const all = (key) => { const out = []; for (const e of [...E, ...mods]) for (const s of (e.sites?.[key] || [])) out.push({ ...s, file: e.file, fn: e.name, efn: s.fn, entry: e.name }); return out; };
const maths = all('math');
const byFn = {}; for (const m of maths) { const k = m.efn; byFn[k] = (byFn[k] || 0) + 1; }
const out = [];
const p = (...a) => out.push(a.join(' '));
p('## Math call sites by function (static, union slice)');
const order = Object.entries(byFn).sort((a, b) => b[1] - a[1]);
p('| Math function | static sites | needs |'); p('|---|---|---|');
for (const [k, n] of order) p(`| ${k} | ${n} | ${fsmath[k] ? 'FsMath.' + fsmath[k] : exact[k] || (k.startsWith('const:') ? 'constant' : '?')} |`);
p(''); p('total call sites (excluding constants):', maths.filter((m) => !m.efn.startsWith('const:')).length);
const fsm = maths.filter((m) => fsmath[m.efn]); p(''); p('FsMath (non-exact) sites:', fsm.length);
p('\n## Math sites by file (calls; FsMath-routed / exact / rounding-sensitive)');
const files = {}; for (const m of maths) { if (m.efn.startsWith('const:')) continue; const f = (files[m.file] ??= { fs: 0, ex: 0, rnd: 0, total: 0 }); f.total++; if (fsmath[m.efn]) f.fs++; else if (['round', 'sign', 'fround', 'imul', 'clz32', 'floor', 'ceil', 'trunc'].includes(m.efn)) f.rnd++; else f.ex++; }
p('| file | total | FsMath | floor/ceil/trunc/round/sign/fround/imul | abs/sqrt/min/max |'); p('|---|---|---|---|---|');
for (const [f, v] of Object.entries(files).sort()) p(`| ${short(f)} | ${v.total} | ${v.fs} | ${v.rnd} | ${v.ex} |`);
p('\n## `**` sites'); const pows = all('pow');
p('| file:line | function | kind | text |'); p('|---|---|---|---|');
for (const s of pows) p(`| ${short(s.file)}:${s.line} | ${s.fn} | ${s.kind} | \`${s.text.replace(/\|/g, '\\|')}\` |`);
p(''); p('count:', pows.length, ' squares:', pows.filter((s) => s.kind === 'square').length, ' other:', pows.filter((s) => s.kind !== 'square').length);
p('\n## Typed-array stores by array kind and file');
const ta = all('taStore'); const tk = {}; for (const s of ta) { const f = (tk[s.file] ??= {}); f[s.kind] = (f[s.kind] || 0) + 1; }
const kinds = ['Float32Array', 'Float64Array', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array'];
p('| file | ' + kinds.map((k) => k.replace('Array', '')).join(' | ') + ' |'); p('|---|' + kinds.map(() => '---').join('|') + '|');
for (const [f, v] of Object.entries(tk).sort()) p(`| ${short(f)} | ${kinds.map((k) => v[k] || '').join(' | ')} |`);
const kt = {}; for (const s of ta) kt[s.kind] = (kt[s.kind] || 0) + 1; p(''); p('totals:', JSON.stringify(kt));
p('\n## Bit operations (ToInt32 / ToUint32)'); const bo = all('bitop'); const bz = bo.filter((s) => s.zero);
p(''); p('total', bo.length, ' `| 0` / `>>> 0` / `>> 0` style (right operand 0):', bz.length, ' others (masks, shifts, xor):', bo.length - bz.length);
const boByFile = {}; for (const s of bo) { const f = (boByFile[s.file] ??= { zero: 0, other: 0 }); s.zero ? f.zero++ : f.other++; }
p(''); p('| file | `x op 0` | other bit ops |'); p('|---|---|---|'); for (const [f, v] of Object.entries(boByFile).sort()) p(`| ${short(f)} | ${v.zero} | ${v.other} |`);
const out2 = { floatToInt: all('idxFromRound').length };
p('\nindex expressions containing Math.floor/ceil/round/trunc or `| 0`:', out2.floatToInt);
const tot = (k) => all(k).length;
p('\nsorts', tot('sort'), 'Map/Set constructions', tot('mapset'), 'Map/Set iterations', tot('mapIter'), 'Object.* key walks', tot('objKeys'), 'string-key sites', tot('strKey'), 'number truthiness', tot('truthy'), 'NaN compares', tot('nanCmp'), 'number checks', tot('numCheck'), 'Date', tot('date'), 'string/number formatting', tot('str'), 'rng calls', tot('rng'), 'coercions', tot('coerce'));
// exhaustive list
const sitesOut = opt('--sites');
if (sitesOut) {
  const L = [];
  const q = (...a) => L.push(a.join(' '));
  q('# T3.3 exhaustive site list (generated; `node reports/3-slice-map/summarize.mjs DIR --sites reports/3-slice-sites.md`)\n');
  q('Every site is `file:line | function | text`. Union slice (both gate tiers), cuts as in `run-slice.sh`. Static sites only: a function that runs a million times is still one line.\n');
  const secs = [['math', 'Math.* calls (and Math constants)'], ['pow', '`**`'], ['bitop', 'Bit operations'], ['taStore', 'Typed-array element stores'], ['taFill', 'Typed-array fill / set'], ['idxFromRound', 'Index expressions built from a rounding call or `| 0`'], ['sort', 'sort / reverse'], ['mapset', 'new Map / Set'], ['mapIter', 'Map / Set iteration'], ['objKeys', 'Object.keys/values/entries/assign, for-in'], ['strKey', 'String-keyed object access and `in`'], ['truthy', 'JavaScript truthiness on numbers'], ['nanCmp', 'Comparison with NaN'], ['numCheck', 'Number.isFinite / isNaN / parse'], ['date', 'Date and Intl'], ['str', 'String and JSON formatting of numbers'], ['coerce', 'Coercions, includes / indexOf'], ['rng', 'Rng calls'], ['minmax', 'Math.min / Math.max (NaN and -0 semantics)']];
  for (const [k, title] of secs) {
    const list = all(k).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    q(`\n## ${title} (${list.length})\n`);
    for (const s of list) q(`- ${short(s.file)}:${s.line} | ${s.fn} | ${s.kind ? s.kind + ': ' : ''}${s.efn && k === 'math' ? s.efn + ': ' : ''}\`${(s.text || '').replace(/`/g, "'")}\``);
  }
  fs.writeFileSync(sitesOut, L.join('\n') + '\n');
}
console.log(out.join('\n'));
