// node typecount.mjs : members of the interfaces and enums that the slice's functions name in their signatures, fields or parameters (the types area 1 must declare in C#).
// Method: every type name that occurs in a union-slice function's text (identifiers) and is declared as an interface / enum / type alias in src/core/types.ts, src/core/simTypes.ts or
// the declaring file of the function, counted once. Members = property and method signatures (interfaces), enum members, 1 for an alias.
// Usage: node typecount.mjs DIR/slice-union.json
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = require(process.env.TS_PATH || path.resolve(process.cwd(), 'node_modules/typescript'));
const U = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const repo = process.cwd();
const files = [...new Set(U.entries.map((e) => e.file))];
const prog = ts.createProgram({ rootNames: files.map((f) => path.resolve(repo, f)), options: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, noEmit: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], allowImportingTsExtensions: true } });
const decl = new Map(); // name -> {file, kind, members}
for (const sf of prog.getSourceFiles()) {
  if (sf.isDeclarationFile || !sf.fileName.startsWith(path.join(repo, 'src'))) continue;
  const v = (n) => {
    if (ts.isInterfaceDeclaration(n)) decl.set(n.name.text, { file: path.relative(repo, sf.fileName), kind: 'interface', members: n.members.length });
    else if (ts.isEnumDeclaration(n)) decl.set(n.name.text, { file: path.relative(repo, sf.fileName), kind: 'enum', members: n.members.length });
    else if (ts.isTypeAliasDeclaration(n)) decl.set(n.name.text, { file: path.relative(repo, sf.fileName), kind: 'alias', members: ts.isTypeLiteralNode(n.type) ? n.type.members.length : 1 });
    ts.forEachChild(n, v);
  };
  v(sf);
}
// identifiers used inside union-slice functions' spans
const used = new Set();
for (const f of files) {
  const sf = prog.getSourceFile(path.resolve(repo, f)); if (!sf) continue;
  const spans = U.entries.filter((e) => e.file === f && !e.module && !e.synthetic).map((e) => [e.start, e.end]);
  const v = (n) => {
    if (ts.isIdentifier(n)) { const l = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1; if (spans.some(([a, b]) => l >= a && l <= b) && decl.has(n.text)) used.add(n.text); }
    ts.forEachChild(n, v);
  };
  v(sf);
}
const byFile = {};
for (const nm of used) { const d = decl.get(nm); const k = d.file; (byFile[k] ??= []).push([nm, d.kind, d.members]); }
let tot = 0, totT = 0, n = 0;
for (const [f, list] of Object.entries(byFile).sort()) {
  const s = list.reduce((a, x) => a + x[2], 0); console.log(`${f}: ${list.length} types, ${s} members`);
  if (/types\.ts|simTypes\.ts/.test(f)) { tot += s; totT += list.length; }
  n += list.length;
}
console.log(`core/types.ts + core/simTypes.ts: ${totT} types, ${tot} members; all files: ${n} types`);
if (process.argv.includes('--list')) for (const [f, list] of Object.entries(byFile).sort()) console.log(f, list.map((x) => `${x[0]}(${x[1][0]}${x[2]})`).join(' '));
