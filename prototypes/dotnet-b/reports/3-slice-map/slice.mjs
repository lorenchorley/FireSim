// T3.3 slice analysis: reachability over the TypeScript call graph, and the JavaScript-semantics sites of every reachable function.
//
//   node prototypes/dotnet-b/reports/3-slice-map/slice.mjs --out FILE.json [--root Simulation.constructor,...] [--cut REGEX,...]
//        [--cut-file REGEX] [--list]
//
// Reads src/ (never edits it). Needs the repository's TypeScript (node_modules/typescript, or the main checkout's: set TS_PATH).
// Entry = a function-like declaration with a name: function, method, accessor, constructor, `const f = () =>`, class field arrow, object-literal method.
// Anonymous lambdas belong to the entry that contains them. Reachability follows every identifier that resolves to an entry (calls, `new`, callbacks
// passed by value, getters), interface methods to every implementing class, and base-class methods to every overriding method. It over-approximates
// (a branch that a tier never takes is still followed), so the output is an upper bound that the report then trims by hand where it says so.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ts = require(process.env.TS_PATH || path.resolve(process.cwd(), 'node_modules/typescript'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outFile = opt('--out', '');
const roots = (opt('--root', 'Simulation.constructor,Simulation.spinUp,Simulation.advance')).split(',');
const cuts = (opt('--cut', '')).split(',').filter(Boolean).map((s) => new RegExp(s));
const cutFile = opt('--cut-file', '') ? new RegExp(opt('--cut-file', '')) : null;
const entryFiles = (opt('--files', 'src/sim/simulation.ts,src/sim/remote/codec.ts')).split(',');
const repo = process.cwd();

const program = ts.createProgram({
  rootNames: entryFiles.map((f) => path.resolve(repo, f)),
  options: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], allowImportingTsExtensions: true },
});
const checker = program.getTypeChecker();
const srcFiles = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile && sf.fileName.startsWith(path.join(repo, 'src')) && !/\.test\.ts$|\/testing\//.test(sf.fileName));
const rel = (f) => path.relative(repo, f);
const isFnLike = (n) => ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isConstructorDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n);

// ---------- entries ----------
const entries = []; // {id,name,file,node,sf,start,end,lines,nestedIn,sites}
const entryOfNode = new Map();
function className(n) { let p = n.parent; while (p && !ts.isClassLike(p)) p = p.parent; return p && p.name ? p.name.text : null; }
function entryName(n) {
  if (ts.isConstructorDeclaration(n)) return `${className(n)}.constructor`;
  if (ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)) {
    const nm = n.name.getText();
    if (ts.isClassLike(n.parent)) return `${className(n)}.${ts.isGetAccessor(n) ? 'get ' : ts.isSetAccessor(n) ? 'set ' : ''}${nm}`;
    const o = n.parent && ts.isObjectLiteralExpression(n.parent) && n.parent.parent && ts.isVariableDeclaration(n.parent.parent) ? n.parent.parent.name.getText() : '?';
    return `${o}.${nm}`;
  }
  if (ts.isFunctionDeclaration(n)) return n.name ? n.name.text : 'default';
  if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent) {
    const p = n.parent;
    if (ts.isVariableDeclaration(p)) return p.name.getText();
    if (ts.isPropertyDeclaration(p)) return `${className(p)}.${p.name.getText()}`;
    if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.parent) && p.parent.parent && ts.isVariableDeclaration(p.parent.parent)) return `${p.parent.parent.name.getText()}.${p.name.getText()}`;
  }
  return null;
}
const moduleEntries = new Map(); // file -> entry
for (const sf of srcFiles) {
  const modE = { id: `${rel(sf.fileName)}:<module>`, name: '<module>', file: rel(sf.fileName), node: sf, sf, start: 0, end: 0, lines: 0, sites: null, isModule: true };
  moduleEntries.set(sf.fileName, modE); entries.push(modE);
  const visit = (n) => {
    if (isFnLike(n)) {
      const nm = entryName(n);
      if (nm) {
        const s = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, e = sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1;
        // a class property arrow / variable arrow: span the whole declaration line range of the function itself
        const E = { id: `${rel(sf.fileName)}:${nm}@${s}`, name: nm, file: rel(sf.fileName), node: n, sf, start: s, end: e, lines: e - s + 1, sites: null };
        entries.push(E); entryOfNode.set(n, E);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
// class entries: constructor or synthetic, for `new C()` and field initialisers
const classCtor = new Map(); // class symbol -> entry
for (const sf of srcFiles) {
  const visit = (n) => {
    if (ts.isClassLike(n) && n.name) {
      const sym = checker.getSymbolAtLocation(n.name);
      const ctor = n.members.find(ts.isConstructorDeclaration);
      let E = ctor ? entryOfNode.get(ctor) : null;
      if (!E) {
        const s = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        E = { id: `${rel(sf.fileName)}:${n.name.text}.constructor(implicit)@${s}`, name: `${n.name.text}.constructor(implicit)`, file: rel(sf.fileName), node: null, sf, start: s, end: s, lines: 0, sites: null, synthetic: true, classNode: n };
        entries.push(E);
      }
      E.classNode = n; classCtor.set(sym, E);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
// owner of a node = innermost entry containing it (anonymous lambdas fall to the enclosing entry); class field initialisers -> class ctor entry
function ownerOf(n) {
  for (let p = n; p; p = p.parent) {
    const E = entryOfNode.get(p); if (E) return E;
    if (ts.isPropertyDeclaration(p) && p.initializer && !isFnLike(p.initializer) && ts.isClassLike(p.parent) && p.parent.name) {
      return classCtor.get(checker.getSymbolAtLocation(p.parent.name)) || null;
    }
    if (ts.isSourceFile(p)) return moduleEntries.get(p.fileName);
  }
  return null;
}

// ---------- implementers / overrides ----------
const subOf = new Map(); // symbol -> [class nodes extending or implementing it]
for (const sf of srcFiles) {
  const visit = (n) => {
    if (ts.isClassLike(n) && n.heritageClauses) for (const hc of n.heritageClauses) for (const t of hc.types) {
      let s = checker.getSymbolAtLocation(t.expression); if (s && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
      if (s) { if (!subOf.has(s)) subOf.set(s, []); subOf.get(s).push(n); }
    }
    if (ts.isInterfaceDeclaration(n) && n.heritageClauses) for (const hc of n.heritageClauses) for (const t of hc.types) {
      let s = checker.getSymbolAtLocation(t.expression); if (s && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
      if (s) { if (!subOf.has(s)) subOf.set(s, []); subOf.get(s).push(n); }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
function memberEntries(classNode, memberName, seen = new Set()) {
  const out = [];
  if (seen.has(classNode)) return out; seen.add(classNode);
  for (const m of classNode.members) {
    if (m.name && m.name.getText() === memberName) {
      if (entryOfNode.has(m)) out.push(entryOfNode.get(m));
      else if (ts.isPropertyDeclaration(m) && m.initializer && entryOfNode.has(m.initializer)) out.push(entryOfNode.get(m.initializer));
    }
  }
  const cs = classNode.name && checker.getSymbolAtLocation(classNode.name);
  for (const sub of (subOf.get(cs) || [])) out.push(...memberEntries(sub, memberName, seen));
  return out;
}
function declToEntries(d, symName) {
  const out = [];
  if (isFnLike(d) && entryOfNode.has(d)) out.push(entryOfNode.get(d));
  else if (ts.isVariableDeclaration(d) && d.initializer && entryOfNode.has(d.initializer)) out.push(entryOfNode.get(d.initializer));
  else if (ts.isPropertyDeclaration(d) && d.initializer && entryOfNode.has(d.initializer)) {
    out.push(entryOfNode.get(d.initializer));
    if (ts.isClassLike(d.parent)) for (const m of memberEntries(d.parent, symName)) out.push(m);
  } else if (ts.isClassLike(d) && d.name) { const E = classCtor.get(checker.getSymbolAtLocation(d.name)); if (E) out.push(E); }
  if ((ts.isMethodDeclaration(d) || ts.isGetAccessor(d) || ts.isSetAccessor(d)) && ts.isClassLike(d.parent)) for (const m of memberEntries(d.parent, symName)) out.push(m);
  if ((ts.isMethodSignature(d) || ts.isPropertySignature(d)) && ts.isInterfaceDeclaration(d.parent)) {
    const is = checker.getSymbolAtLocation(d.parent.name);
    for (const sub of (subOf.get(is) || [])) out.push(...memberEntries(sub, symName));
  }
  return out;
}

// ---------- edges ----------
function resolveSym(n) {
  let s; try { s = checker.getSymbolAtLocation(n); } catch { return null; }
  if (s && s.flags & ts.SymbolFlags.Alias) { try { s = checker.getAliasedSymbol(s); } catch { return s; } }
  return s;
}
const edges = new Map(); // entry -> Set(entry)
for (const E of entries) edges.set(E, new Set());
for (const sf of srcFiles) {
  const visit = (n) => {
    if (ts.isImportDeclaration(n) || ts.isImportEqualsDeclaration(n) || ts.isExportDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return; // imports and re-exports are not uses
    const owner = ownerOf(n);
    if ((ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) && owner) {
      const s = resolveSym(n);
      if (s && s.declarations) for (const d of s.declarations) for (const T of declToEntries(d, s.name)) if (T !== owner || true) edges.get(owner).add(T);
      // property-access on a union: symbol is synthetic; try the property of each constituent
      if (ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) {
        const t = checker.getTypeAtLocation(n.parent.expression);
        const parts = t.isUnion() ? t.types : [t];
        for (const p of parts) { const ps = p.getProperty(n.text); if (ps && ps.declarations) for (const d of ps.declarations) for (const T of declToEntries(d, n.text)) edges.get(owner).add(T); }
      }
    }
    if (ts.isNewExpression(n) && owner) {
      const s = resolveSym(n.expression);
      if (s && s.declarations) for (const d of s.declarations) if (ts.isClassLike(d) && d.name) { const E = classCtor.get(checker.getSymbolAtLocation(d.name)); if (E) edges.get(owner).add(E); }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
// module entry of a file is reached when any entry of the file is reached (its top-level code runs on import)
// ---------- reachability ----------
const byName = (nm) => entries.filter((e) => e.name === nm);
const isCut = (E) => cuts.some((r) => r.test(`${E.file}:${E.name}`)) || (cutFile && cutFile.test(E.file));
const reach = new Set(); const cutHit = new Map(); const via = new Map();
const stack = [];
for (const r of roots) for (const E of byName(r)) if (E.file === 'src/sim/simulation.ts' || r.includes('.') ) { if (!reach.has(E)) { reach.add(E); stack.push(E); } }
while (stack.length) {
  const E = stack.pop();
  const mod = moduleEntries.get(E.sf.fileName); if (mod && !reach.has(mod)) { reach.add(mod); stack.push(mod); }
  for (const T of edges.get(E) || []) {
    if (reach.has(T)) continue;
    if (isCut(T)) { cutHit.set(T, (cutHit.get(T) || 0) + 1); continue; }
    reach.add(T); via.set(T, E); stack.push(T);
  }
}
const whyRe = opt('--why', '') ? new RegExp(opt('--why', '')) : null;
if (whyRe) for (const E of reach) if (whyRe.test(`${E.file}:${E.name}`)) { const p = []; for (let x = E; x; x = via.get(x)) p.push(`${x.file.replace('src/', '')}:${x.name}@${x.start}`); console.log('WHY', p.reverse().join('  ->  ')); }

// ---------- sites ----------
const TA = new Set(['Float32Array', 'Float64Array', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'BigInt64Array', 'BigUint64Array']);
const typeNames = (t) => { const parts = t.isUnion() ? t.types : [t]; return parts.map((p) => (p.symbol ? p.symbol.name : '')).filter(Boolean); };
const taKind = (expr) => { try { const t = checker.getTypeAtLocation(expr); for (const nm of typeNames(t)) if (TA.has(nm)) return nm; } catch {} return null; };
const symNameOfType = (expr) => { try { return typeNames(checker.getTypeAtLocation(expr)); } catch { return []; } };
const hasNumberFlag = (t) => { const parts = t.isUnion() ? t.types : [t]; return parts.some((p) => p.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) && !parts.some((p) => p.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)); };
const isNumOperand = (expr) => { try { return hasNumberFlag(checker.getTypeAtLocation(expr)); } catch { return false; } };
const isStringType = (expr) => { try { const t = checker.getTypeAtLocation(expr); const parts = t.isUnion() ? t.types : [t]; return parts.length > 0 && parts.every((p) => p.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral | ts.TypeFlags.TemplateLiteral)); } catch { return false; } };
const lineOf = (n) => n.getSourceFile().getLineAndCharacterOfPosition(n.getStart(n.getSourceFile())).line + 1;
const txt = (n) => n.getText().replace(/\s+/g, ' ').slice(0, 110);
const isAssignTarget = (n) => { const p = n.parent; return (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) || ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)); };
const MATH_ROUNDERS = new Set(['floor', 'ceil', 'round', 'trunc']);
function collectSites(E) {
  const S = { math: [], pow: [], bitop: [], taStore: [], taFill: [], idxFromRound: [], sort: [], mapset: [], mapIter: [], objKeys: [], strKey: [], truthy: [], nanCmp: [], numCheck: [], date: [], str: [], rng: [], coerce: [], minmax: [] };
  const root = E.node; if (!root) return S;
  const visit = (n) => {
    if (n !== root && entryOfNode.has(n)) return; // nested entry has its own sites
    const L = lineOf(n);
    // Math.*
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Math' && !(n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && false)) {
      const nm = n.name.text; const call = ts.isCallExpression(n.parent) && n.parent.expression === n ? n.parent : null;
      if (call) {
        S.math.push({ fn: nm, line: L, text: txt(call), spread: call.arguments.some(ts.isSpreadElement) });
        if (nm === 'min' || nm === 'max') S.minmax.push({ fn: nm, line: L, text: txt(call), nargs: call.arguments.length, spread: call.arguments.some(ts.isSpreadElement) });
      } else S.math.push({ fn: `const:${nm}`, line: L, text: txt(n) });
    }
    // **
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken || n.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken)) {
      const r = n.right; const lit = ts.isNumericLiteral(r) ? r.text : null;
      S.pow.push({ line: L, exp: lit, kind: lit === '2' ? 'square' : lit !== null ? `const ${lit}` : 'variable', text: txt(n) });
    }
    // bit ops (ToInt32 / ToUint32)
    if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind; const T = ts.SyntaxKind;
      const m = { [T.BarToken]: '|', [T.AmpersandToken]: '&', [T.CaretToken]: '^', [T.LessThanLessThanToken]: '<<', [T.GreaterThanGreaterThanToken]: '>>', [T.GreaterThanGreaterThanGreaterThanToken]: '>>>', [T.BarEqualsToken]: '|=', [T.AmpersandEqualsToken]: '&=', [T.CaretEqualsToken]: '^=', [T.LessThanLessThanEqualsToken]: '<<=', [T.GreaterThanGreaterThanEqualsToken]: '>>=', [T.GreaterThanGreaterThanGreaterThanEqualsToken]: '>>>=' };
      if (m[k]) S.bitop.push({ op: m[k], line: L, zero: ts.isNumericLiteral(n.right) && n.right.text === '0', text: txt(n) });
      // JS truthiness defaults with number operands
      if (k === T.BarBarToken && isNumOperand(n.left)) S.truthy.push({ kind: '||', line: L, text: txt(n) });
      if (k === T.AmpersandAmpersandToken && isNumOperand(n.left)) S.truthy.push({ kind: '&&', line: L, text: txt(n) });
      if (k === T.BarBarEqualsToken || k === T.AmpersandAmpersandEqualsToken) S.truthy.push({ kind: ts.tokenToString(k), line: L, text: txt(n) });
      if ((k === T.EqualsEqualsEqualsToken || k === T.ExclamationEqualsEqualsToken || k === T.EqualsEqualsToken || k === T.ExclamationEqualsToken) && ((ts.isIdentifier(n.left) && n.left.text === 'NaN') || (ts.isIdentifier(n.right) && n.right.text === 'NaN'))) S.nanCmp.push({ line: L, text: txt(n) });
      if (k === T.InKeyword) S.strKey.push({ kind: 'in', line: L, text: txt(n) });
      // string concatenation with a number operand (formatting of numbers)
      if (k === T.PlusToken && (isStringType(n.left) !== isStringType(n.right)) && (isNumOperand(n.left) || isNumOperand(n.right))) S.str.push({ kind: 'string+number', line: L, text: txt(n) });
      // typed-array store through assignment
      if (n.operatorToken.kind >= T.FirstAssignment && n.operatorToken.kind <= T.LastAssignment && ts.isElementAccessExpression(n.left)) {
        const kd = taKind(n.left.expression);
        if (kd) S.taStore.push({ kind: kd, line: L, op: n.operatorToken.getText(), text: txt(n) });
      }
    }
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.TildeToken) S.bitop.push({ op: '~', line: L, zero: false, text: txt(n) });
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) && ts.isElementAccessExpression(n.operand)) {
      const kd = taKind(n.operand.expression); if (kd) S.taStore.push({ kind: kd, line: L, op: n.operator === ts.SyntaxKind.PlusPlusToken ? '++' : '--', text: txt(n) });
    }
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken && isNumOperand(n.operand)) S.truthy.push({ kind: '!', line: L, text: txt(n) });
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.PlusToken) S.coerce.push({ kind: 'unary+', line: L, text: txt(n) });
    if ((ts.isIfStatement(n) || ts.isConditionalExpression(n) || ts.isWhileStatement(n)) && isNumOperand(ts.isIfStatement(n) || ts.isWhileStatement(n) ? n.expression : n.condition)) S.truthy.push({ kind: 'cond', line: L, text: txt(ts.isConditionalExpression(n) ? n.condition : n.expression) });
    // index from a rounding call
    if (ts.isElementAccessExpression(n)) {
      const a = n.argumentExpression; const kd = taKind(n.expression);
      const hasRound = (x) => { let f = false; const v = (y) => { if (ts.isCallExpression(y) && ts.isPropertyAccessExpression(y.expression) && ts.isIdentifier(y.expression.expression) && y.expression.expression.text === 'Math' && MATH_ROUNDERS.has(y.expression.name.text)) f = true; if (ts.isBinaryExpression(y) && [ts.SyntaxKind.BarToken, ts.SyntaxKind.GreaterThanGreaterThanToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken].includes(y.operatorToken.kind) && ts.isNumericLiteral(y.right) && y.right.text === '0') f = true; ts.forEachChild(y, v); }; v(x); return f; };
      if (hasRound(a)) S.idxFromRound.push({ line: L, text: txt(n), ta: kd });
      if (isStringType(a) && !ts.isNumericLiteral(a)) S.strKey.push({ kind: 'string-index', line: L, text: txt(n) });
    }
    // calls
    if (ts.isCallExpression(n)) {
      const f = n.expression;
      if (ts.isPropertyAccessExpression(f)) {
        const nm = f.name.text; const recvNames = symNameOfType(f.expression);
        if ((nm === 'sort' || nm === 'toSorted') ) S.sort.push({ line: L, cmp: n.arguments.length > 0, recv: recvNames.join('|'), ta: taKind(f.expression), text: txt(n) });
        if (nm === 'reverse' || nm === 'toReversed') S.sort.push({ line: L, cmp: true, recv: recvNames.join('|'), ta: taKind(f.expression), text: txt(n), kind: 'reverse' });
        if ((nm === 'fill' || nm === 'set') && taKind(f.expression)) S.taFill.push({ kind: taKind(f.expression), method: nm, line: L, text: txt(n) });
        if ((nm === 'includes' || nm === 'indexOf' || nm === 'lastIndexOf') ) S.coerce.push({ kind: `.${nm}`, line: L, text: txt(n) });
        if (recvNames.some((x) => x === 'Map' || x === 'Set' || x === 'ReadonlyMap' || x === 'ReadonlySet') && ['keys', 'values', 'entries', 'forEach'].includes(nm)) S.mapIter.push({ kind: `${recvNames[0]}.${nm}`, line: L, text: txt(n) });
        if (ts.isIdentifier(f.expression)) {
          const o = f.expression.text;
          if (o === 'Object' && ['keys', 'values', 'entries', 'assign', 'fromEntries', 'getOwnPropertyNames'].includes(nm)) S.objKeys.push({ kind: `Object.${nm}`, line: L, text: txt(n) });
          if (o === 'JSON') S.str.push({ kind: `JSON.${nm}`, line: L, text: txt(n) });
          if (o === 'Number' && ['isFinite', 'isNaN', 'isInteger', 'isSafeInteger', 'parseFloat', 'parseInt'].includes(nm)) S.numCheck.push({ kind: `Number.${nm}`, line: L, text: txt(n) });
          if (o === 'Object' && nm === 'is') S.numCheck.push({ kind: 'Object.is', line: L, text: txt(n) });
          if (o === 'Array' && nm === 'from') { const a0 = n.arguments[0]; if (a0 && symNameOfType(a0).some((x) => x === 'Map' || x === 'Set')) S.mapIter.push({ kind: 'Array.from(Map|Set)', line: L, text: txt(n) }); }
          if (o === 'Date') S.date.push({ kind: `Date.${nm}`, line: L, text: txt(n) });
        }
        if (['toFixed', 'toString', 'toPrecision', 'toLocaleString', 'localeCompare', 'padStart', 'padEnd'].includes(nm) && (isNumOperand(f.expression) || isStringType(f.expression))) S.str.push({ kind: `.${nm}`, line: L, text: txt(n) });
        if (recvNames.includes('Date')) S.date.push({ kind: `Date#${nm}`, line: L, text: txt(n) });
        if (recvNames.includes('Rng')) S.rng.push({ method: nm, line: L, text: txt(n) });
      } else if (ts.isIdentifier(f)) {
        if (['isFinite', 'isNaN', 'parseFloat', 'parseInt'].includes(f.text)) S.numCheck.push({ kind: f.text, line: L, text: txt(n) });
        if (f.text === 'Number' || f.text === 'String' || f.text === 'Boolean') S.coerce.push({ kind: `${f.text}()`, line: L, text: txt(n) });
      }
    }
    if (ts.isNewExpression(n)) {
      const nm = ts.isIdentifier(n.expression) ? n.expression.text : '';
      if (nm === 'Map' || nm === 'Set' || nm === 'WeakMap' || nm === 'WeakSet') S.mapset.push({ kind: nm, line: L, text: txt(n) });
      if (nm === 'Date' || nm === 'Intl') S.date.push({ kind: `new ${nm}`, line: L, text: txt(n) });
    }
    if (ts.isForOfStatement(n)) { const nms = symNameOfType(n.expression); if (nms.some((x) => ['Map', 'Set', 'ReadonlyMap', 'ReadonlySet', 'IterableIterator', 'MapIterator', 'SetIterator'].includes(x))) S.mapIter.push({ kind: `for-of ${nms[0]}`, line: L, text: txt(n.expression) }); }
    if (ts.isForInStatement(n)) S.objKeys.push({ kind: 'for-in', line: L, text: txt(n.expression) });
    if (ts.isSpreadElement(n) && symNameOfType(n.expression).some((x) => x === 'Map' || x === 'Set')) S.mapIter.push({ kind: 'spread Map|Set', line: L, text: txt(n) });
    if (ts.isTemplateExpression(n)) { for (const sp of n.templateSpans) if (isNumOperand(sp.expression)) { S.str.push({ kind: 'template number', line: L, text: txt(n) }); break; } }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(root, (c) => { if (E.isModule) { if (!isFnLike(c) && !ts.isClassLike(c)) visit(c); else if (ts.isClassLike(c)) ts.forEachChild(c, (m) => { if (ts.isPropertyDeclaration(m) && m.initializer && !isFnLike(m.initializer)) visit(m.initializer); }); } else visit(c); });
  // class field initialisers of a constructor entry
  if (E.classNode) for (const m of E.classNode.members) if (ts.isPropertyDeclaration(m) && m.initializer && !isFnLike(m.initializer)) visit(m.initializer);
  return S;
}

const out = [];
for (const E of reach) {
  if (!E.sites) E.sites = collectSites(E);
  out.push({ id: E.id, name: E.name, file: E.file, start: E.start, end: E.end, lines: E.lines, synthetic: !!E.synthetic, module: !!E.isModule, sites: E.sites });
}
out.sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start);
const covered = {}; // union of spans per file
for (const e of out) { if (e.module || e.synthetic) continue; (covered[e.file] ??= []).push([e.start, e.end]); }
const fileLines = {};
for (const [f, iv] of Object.entries(covered)) { iv.sort((a, b) => a[0] - b[0]); let tot = 0, cs = -1, ce = -1; for (const [s, e] of iv) { if (s > ce) { if (ce >= 0) tot += ce - cs + 1; cs = s; ce = e; } else ce = Math.max(ce, e); } if (ce >= 0) tot += ce - cs + 1; fileLines[f] = tot; }
const cutOut = [...cutHit.entries()].map(([E, n]) => ({ id: E.id, lines: E.lines, refs: n }));
const result = { roots, cuts: cuts.map(String), cutFile: cutFile ? String(cutFile) : null, fileLines, totalLines: Object.values(fileLines).reduce((a, b) => a + b, 0), entries: out, cutHits: cutOut };
if (outFile) fs.writeFileSync(outFile, JSON.stringify(result));
if (args.includes('--list')) { for (const [f, n] of Object.entries(fileLines).sort()) console.log(String(n).padStart(6), f); console.log(String(result.totalLines).padStart(6), 'total in', Object.keys(fileLines).length, 'files;', out.length, 'entries'); }
console.error(`reachable entries: ${out.length}; lines: ${result.totalLines}; cut edges: ${cutOut.length}`);
