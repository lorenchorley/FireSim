// node codelines.mjs FILE FROM TO  : non-blank, non-comment-only lines in [FROM, TO] (1-based, inclusive); `//`, `///`, `/*`, ` *` count as comments
import fs from 'node:fs';
const [file, a, b] = process.argv.slice(2);
const L = fs.readFileSync(file, 'utf8').split('\n');
const from = Number(a ?? 1), to = Number(b ?? L.length);
let span = 0, code = 0;
for (let i = from; i <= to && i <= L.length; i++) {
  span++;
  if (!/^\s*(\/\/.*|\/\*.*|\*.*|\*\/)?\s*$/.test(L[i - 1])) code++;
}
console.log(`${file} ${from}-${to}: span ${span}, code ${code}`);
