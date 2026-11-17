// T1.4b: runs the fast tier's kernels of the published Fs.Wasm (Mono WebAssembly) under Node on a captured fixture. For each of the four forms the build runs every recorded case
// and variant (Fs.Tests/FastCaseRunner.cs, compiled into Fs.Wasm) and compares every hash with the one the real TypeScript kernels gave (the golden file Fs.Tests/golden/fast-*.json);
// the x64 C# tests check the same hashes on 9 forms, so equal here means equal to the x64 build too. The aggregate hash of all the computed hashes is printed so that two runs
// (or this and the x64 one, Fs.Bench `fast-aggregate`) can be compared with one value.
//   node wasm-run.mjs FRAMEWORK_DIR FIXTURE_DIR GOLDEN.json OUT.json
// FRAMEWORK_DIR is Fs.Wasm/bin/Release/net11.0/publish/wwwroot/_framework. Forms: 0 scalar, 1 Vector128, 2 Parallel.For x4 (one thread here), 3 the same with the vector body.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [fwDir, fixDir, goldenFile, outFile] = process.argv.slice(2);
if (!fwDir || !fixDir || !goldenFile || !outFile) throw new Error('usage: wasm-run.mjs FRAMEWORK_DIR FIXTURE_DIR GOLDEN.json OUT.json');

const { dotnet } = await import(pathToFileURL(path.join(path.resolve(fwDir), 'dotnet.js')).href);
const t0 = performance.now();
const { getAssemblyExports } = await dotnet.withDiagnosticTracing(false).create();
const E = (await getAssemblyExports('Fs.Wasm')).Fs.Wasm.FastTierExports;
const startMs = performance.now() - t0;
const info = E.Info();

const headerText = fs.readFileSync(`${fixDir}/header.json`, 'utf8');
const header = JSON.parse(headerText);
const data = fs.readFileSync(`${fixDir}/data.bin`);
E.SetHeader(headerText);
for (const a of header.arrays) {
  const size = a.type === 'float64' ? 8 : a.type === 'uint8' ? 1 : 4;
  E.SetArray(a.name, new Uint8Array(data.buffer, data.byteOffset + a.byteOffset, a.length * size));
}
const goldenText = fs.readFileSync(goldenFile, 'utf8');

const FORMS = ['scalar', 'vector128', 'parallel x4 (one thread in WebAssembly)', 'parallel x4 + vector128'];
const results = [];
let failures = 0;
for (let form = 0; form < FORMS.length; form++) {
  const t = performance.now();
  const r = JSON.parse(E.Check(goldenText, form));
  const ms = performance.now() - t;
  results.push({ form: FORMS[form], ...r, totalMs: ms });
  failures += r.failures;
  console.log(`${path.basename(fixDir)} [${FORMS[form]}]: ${r.checks} hashes compared with the TypeScript's, ${r.failures} differ; aggregate ${r.aggregateHash}; ${ms.toFixed(0)} ms`);
  for (const f of r.failureList.slice(0, 5)) console.log('  ' + f);
}
const agg = new Set(results.map((r) => r.aggregateHash));
const result = { engine: 'node', node: process.version, v8: process.versions.v8, runtime: info, startUpMs: startMs, fixture: path.basename(fixDir), window: header.window, forms: results, failures, allFormsSameAggregate: agg.size === 1, aggregateHash: results[0].aggregateHash };
fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
console.log(`aggregate over every computed hash, all four forms equal: ${agg.size === 1} (${results[0].aggregateHash}); ${info}`);
process.exit(failures || agg.size !== 1 ? 1 : 0);
