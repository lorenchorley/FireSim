// node areas.mjs DIR [--functions] : assigns every union-slice entry to one area (areas.json), checks that none is left over or counted twice, prints the size table.
//   per area: TS function-span lines (union of spans, nested functions once), tables (code lines of constant tables), types (members), estimated C# lines
//   est = round(ratio * function lines) + tables + types + extra  (see areas.json for the ratio and where it comes from)
import fs from 'node:fs';
import path from 'node:path';
const DIR = process.argv[2];
const here = path.dirname(new URL(import.meta.url).pathname);
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'areas.json'), 'utf8'));
const U = JSON.parse(fs.readFileSync(`${DIR}/slice-union.json`, 'utf8'));
const F = JSON.parse(fs.readFileSync(`${DIR}/slice-fast.json`, 'utf8'));
const S = JSON.parse(fs.readFileSync(`${DIR}/slice-std.json`, 'utf8'));
const fi = new Set(F.entries.map((e) => e.id)), si = new Set(S.entries.map((e) => e.id));
const entries = U.entries.filter((e) => !e.module && !e.synthetic);
const owner = new Map();
const dup = [];
for (const a of cfg.areas) {
  a.entries = [];
  for (const [file, re] of a.select) {
    const rx = re ? new RegExp(re) : null;
    for (const e of entries) if (e.file === file && (!rx || rx.test(e.name))) { if (owner.has(e.id)) dup.push([e.id, owner.get(e.id), a.id]); owner.set(e.id, a.id); a.entries.push(e); }
  }
}
const left = entries.filter((e) => !owner.has(e.id));
if (dup.length) { console.log('DUPLICATES', dup); process.exitCode = 1; }
if (left.length) { console.log('NOT IN ANY AREA', left.map((e) => `${e.file}:${e.name}@${e.start}`)); process.exitCode = 1; }
const union = (es) => { const byF = {}; for (const e of es) (byF[e.file] ??= []).push([e.start, e.end]); let tot = 0; for (const iv of Object.values(byF)) { iv.sort((a, b) => a[0] - b[0]); let cs = -1, ce = -1; for (const [s, e] of iv) { if (s > ce) { if (ce >= 0) tot += ce - cs + 1; cs = s; ce = e; } else ce = Math.max(ce, e); } if (ce >= 0) tot += ce - cs + 1; } return tot; };
const rows = [];
let T = { ts: 0, est: 0, tables: 0, types: 0 };
for (const a of cfg.areas) {
  const ts = union(a.entries) + (a.extraTs || []).reduce((x, y) => x + y.lines, 0);
  const tables = a.tablesCode || 0;
  const types = (a.typeMembers || 0) + 3 * (a.typeCount || 0);
  const extra = (a.extraCs || []).reduce((x, y) => x + y.lines, 0);
  const est = Math.round(cfg.ratio * ts) + tables + types + extra;
  const tierOnly = a.entries.filter((e) => !(fi.has(e.id) && si.has(e.id)));
  rows.push({ id: a.id, title: a.title, needs: a.needs, ts, tables, types, extra, est, fns: a.entries.length, files: [...new Set(a.entries.map((e) => e.file))], fastOnly: tierOnly.filter((e) => fi.has(e.id)).length, stdOnly: tierOnly.filter((e) => si.has(e.id)).length });
  T.ts += ts; T.est += est; T.tables += tables; T.types += types;
}
console.log('| area | needs | files | functions | TS function lines | tables | types | est. C# lines |'); console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.id} ${r.title} | ${r.needs.join(', ') || '-'} | ${r.files.length} | ${r.fns} | ${r.ts} | ${r.tables} | ${r.types} | ${r.est} |`);
console.log(`| total | | | ${entries.length} | ${T.ts} | ${T.tables} | ${T.types} | ${T.est} |`);
console.log('entries in the union slice:', entries.length, ' union span lines (whole slice, nested once):', U.totalLines);
if (process.argv.includes('--functions')) {
  for (const a of cfg.areas) {
    console.log(`\n### ${a.id} ${a.title}`);
    const byF = {};
    for (const e of a.entries) (byF[e.file] ??= []).push(e);
    for (const [f, es] of Object.entries(byF)) {
      const u = union(es);
      console.log(`- \`${f}\` (${u} lines): ` + es.filter((e) => !(es.some((o) => o !== e && o.file === e.file && o.start <= e.start && o.end >= e.end && o.lines > e.lines))).map((e) => `${e.name.replace(/^[A-Za-z]+\./, '')} ${e.lines}`).join(', '));
    }
    for (const x of a.extraTs || []) console.log(`- ${x.what} (${x.lines} lines, not in the TS closure of host.ts)`);
  }
}
if (process.argv.includes('--json')) fs.writeFileSync(process.argv[process.argv.indexOf('--json') + 1], JSON.stringify(rows, null, 1));
