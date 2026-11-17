/**
 * A Vite plugin for the probe build of run.mjs only (`--probes`), in the manner of pow-lowering-plugin.mjs: after TypeScript has been stripped, each
 * module-level boundary function named in spec.mjs is renamed `name__fsp` and a wrapper with the original name (and the original `export`, if it had
 * one) is added, so that every caller, inside or outside the module, goes through it. The wrapper does nothing until install.ts has set
 * `globalThis.__FSP` (before that, and in the scenario builder, it calls straight through). Arguments, `this` and the result pass through unchanged.
 * Only top-level `function` declarations and `const name = (...) =>` / `function` expressions are handled; anything else is an error (the spec names
 * a function that is not there). The app's source files are not edited; the default build never loads this plugin.
 */
import ts from 'typescript';
import { moduleFunctionsByFile } from './spec.mjs';

export function probeWrap(repoRoot) {
  const byFile = moduleFunctionsByFile();
  const stats = { files: 0, wrapped: 0, missing: [] };
  const wanted = new Map(Object.entries(byFile).map(([f, list]) => [f, list]));
  return {
    name: 'ts-export-probe-wrap',
    enforce: 'post',
    stats,
    transform(code, id) {
      const file = id.split('?')[0];
      if (file.includes('node_modules')) return null;
      const rel = file.startsWith(repoRoot) ? file.slice(repoRoot.length).replace(/^\/+/, '') : file;
      const list = wanted.get(rel);
      if (!list) return null;
      const sf = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
      const edits = []; // [start, end, text]
      let tail = '';
      const found = new Set();
      const isExport = (n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st) && st.name) {
          const hit = list.find((x) => x.name === st.name.text);
          if (!hit) continue;
          found.add(hit.name);
          const exported = isExport(st);
          if (exported) {
            const m = st.modifiers.find((x) => x.kind === ts.SyntaxKind.ExportKeyword);
            edits.push([m.getStart(sf), m.end + 1, '']);
          }
          edits.push([st.name.getStart(sf), st.name.end, `${hit.name}__fsp`]);
          tail += `\n${exported ? 'export ' : ''}function ${hit.name}(...__a) { const __P = globalThis.__FSP; return __P === undefined ? ${hit.name}__fsp(...__a) : __P.callFn(${JSON.stringify(hit.id)}, ${hit.name}__fsp, undefined, __a); }`;
        } else if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            if (!ts.isIdentifier(d.name)) continue;
            const hit = list.find((x) => x.name === d.name.text);
            if (!hit) continue;
            if (!d.initializer || !(ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) throw new Error(`${rel}: ${hit.name} is not a function`);
            if (st.declarationList.declarations.length !== 1) throw new Error(`${rel}: ${hit.name} shares a declaration`);
            found.add(hit.name);
            const exported = isExport(st);
            if (exported) {
              const m = st.modifiers.find((x) => x.kind === ts.SyntaxKind.ExportKeyword);
              edits.push([m.getStart(sf), m.end + 1, '']);
            }
            edits.push([d.name.getStart(sf), d.name.end, `${hit.name}__fsp`]);
            edits.push([st.end, st.end, `\n${exported ? 'export ' : ''}const ${hit.name} = (...__a) => { const __P = globalThis.__FSP; return __P === undefined ? ${hit.name}__fsp(...__a) : __P.callFn(${JSON.stringify(hit.id)}, ${hit.name}__fsp, undefined, __a); };`]);
          }
        }
      }
      for (const x of list) if (!found.has(x.name)) stats.missing.push(`${rel}:${x.name}`);
      if (edits.length === 0) return null;
      edits.sort((a, b) => b[0] - a[0]);
      let out = code;
      for (const [s, e, t] of edits) out = out.slice(0, s) + t + out.slice(e);
      stats.files++;
      stats.wrapped += found.size;
      return { code: out + tail + '\n', map: null };
    },
  };
}
