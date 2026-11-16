/**
 * A Vite plugin for the noise build of run.mjs only: rewrites every `a ** b` of the app's own code (after TypeScript has been stripped) as
 * `Math.pow(a, b)`, so that the noise wrapper (noise.ts) sees those calls. V8 evaluates `**` with the same function as Math.pow, but a replaced
 * `Math.pow` cannot intercept the operator. The rewrite is textual (only the operator's two operands move into a call), uses the TypeScript
 * parser that the repository already has, and leaves node_modules alone. The default (noise-free) build does not load this plugin.
 */
import ts from 'typescript';

export function powLowering() {
  const stats = { files: 0, sites: 0 };
  return {
    name: 'ts-export-pow-lowering',
    enforce: 'post',
    stats,
    transform(code, id) {
      const file = id.split('?')[0];
      if (file.includes('node_modules') || !/\.(ts|tsx|js|mjs)$/.test(file) || !code.includes('**')) return null;
      const sf = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
      let sites = 0;
      const edit = (node, from) => {
        if (node.kind === ts.SyntaxKind.BinaryExpression && node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken) {
          sites++;
          return `Math.pow(${edit(node.left, node.left.getStart(sf))}, ${edit(node.right, node.right.getStart(sf))})`;
        }
        if (node.kind === ts.SyntaxKind.BinaryExpression && node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken) {
          throw new Error(`${file}: '**=' is not handled by the pow-lowering plugin`);
        }
        let out = '';
        let pos = from;
        node.forEachChild((c) => {
          if (ts.isJSDoc(c)) return;
          const s = c.getStart(sf);
          out += code.slice(pos, s) + edit(c, s);
          pos = c.end;
        });
        return out + code.slice(pos, node.end);
      };
      const result = edit(sf, 0);
      if (sites === 0) return null;
      stats.files++;
      stats.sites += sites;
      return { code: result, map: null };
    },
  };
}
