// Discovery helper: how are the candidate boundary functions declared? usage: node disc.mjs want.json  (run from the repo root)
import ts from 'typescript';
import { readFileSync } from 'fs';
const want = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [file, names] of Object.entries(want)) {
  const code = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true);
  const found = {};
  const sig = (n) => n.parameters.map((p) => p.name.getText(sf)).join(',');
  const exp = (n) => (n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ? ' export' : '');
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name) found[n.name.text] = `fn${exp(n)}(${sig(n)})`;
    if (ts.isVariableStatement(n))
      for (const d of n.declarationList.declarations)
        if (ts.isIdentifier(d.name)) found[d.name.text] = `var ${d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) ? 'arrow(' + sig(d.initializer) + ')' : 'value'}${exp(n)}`;
    if (ts.isClassDeclaration(n) && n.name) {
      for (const m of n.members) {
        if (ts.isMethodDeclaration(m) || ts.isGetAccessor(m)) found[n.name.text + '.' + m.name.getText(sf)] = `method${ts.isGetAccessor(m) ? ' get' : ''}${m.name.kind === ts.SyntaxKind.PrivateIdentifier ? ' #private' : ''}(${sig(m)})`;
        else if (ts.isPropertyDeclaration(m)) found[n.name.text + '.' + m.name.getText(sf)] = 'field';
        else if (ts.isConstructorDeclaration(m)) found[n.name.text + '.constructor'] = 'ctor(' + sig(m) + ')';
      }
    }
  });
  console.log('## ' + file);
  for (const nm of names) console.log('  ', nm, '=>', found[nm] ?? 'MISSING');
}
