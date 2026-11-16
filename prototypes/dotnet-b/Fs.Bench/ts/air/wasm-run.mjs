// T1.4a: runs the air kernels of the published Fs.Wasm (Mono WebAssembly) under Node on a captured fixture and compares every output with the hash the real TypeScript
// kernels gave (the golden file Fs.Tests/golden/air-*.json; the x64 C# tests check the same hashes on 9 forms, so equal here means equal to the x64 build too).
//   node wasm-run.mjs FRAMEWORK_DIR FIXTURE_DIR GOLDEN.json OUT.json
// FRAMEWORK_DIR is Fs.Wasm/bin/Release/net11.0/publish/wwwroot/_framework. Forms: 0 scalar, 1 Vector128, 2 Parallel.For x4 (one thread here), 3 the same with the vector body.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [fwDir, fixDir, goldenFile, outFile] = process.argv.slice(2);
if (!fwDir || !fixDir || !goldenFile || !outFile) throw new Error('usage: wasm-run.mjs FRAMEWORK_DIR FIXTURE_DIR GOLDEN.json OUT.json');

const { dotnet } = await import(pathToFileURL(path.join(path.resolve(fwDir), 'dotnet.js')).href);
const t0 = performance.now();
const { getAssemblyExports } = await dotnet.withDiagnosticTracing(false).create();
const E = (await getAssemblyExports('Fs.Wasm')).Fs.Wasm.AirExports;
const startMs = performance.now() - t0;
const info = E.Info();

const headerText = fs.readFileSync(`${fixDir}/header.json`, 'utf8');
const header = JSON.parse(headerText);
const data = fs.readFileSync(`${fixDir}/data.bin`);
E.SetHeader(headerText);
for (const a of header.arrays) {
  const size = a.type === 'float32' ? 4 : a.type === 'float64' ? 8 : 1;
  E.SetArray(a.name, new Uint8Array(data.buffer, data.byteOffset + a.byteOffset, a.length * size));
}

// SHA-256 (first 32 hex digits) of the raw bytes with every NaN replaced by the canonical quiet NaN, -0 kept (Fs.Bench/ts/air/lib.ts canonHash)
function canonHash(bytes, kind) {
  const copy = new Uint8Array(bytes); // a fresh, aligned buffer
  if (kind === 'f64') {
    const f = new Float64Array(copy.buffer), u = new Uint32Array(copy.buffer);
    for (let i = 0; i < f.length; i++) if (f[i] !== f[i]) { u[2 * i] = 0; u[2 * i + 1] = 0x7ff80000; }
  } else {
    const f = new Float32Array(copy.buffer), u = new Uint32Array(copy.buffer);
    for (let i = 0; i < f.length; i++) if (f[i] !== f[i]) u[i] = 0x7fc00000;
  }
  return crypto.createHash('sha256').update(copy).digest('hex').slice(0, 32);
}
const OUT_KIND = { gu: 'f64', gv: 'f64', gw: 'f64', out: 'f64', dst: 'f32', dst2: 'f32', x: 'f32' };

const golden = JSON.parse(fs.readFileSync(goldenFile, 'utf8'));
const FORMS = ['scalar', 'vector128', 'parallel x4 (one thread in WebAssembly)', 'parallel x4 + vector128'];
const failures = [];
const perForm = FORMS.map(() => ({ checks: 0, ms: 0 }));
const aggregate = crypto.createHash('sha256');
let first = true;
for (const c of golden.cases) {
  for (let form = 0; form < FORMS.length; form++) {
    const t = performance.now();
    const roles = E.RunCase(JSON.stringify(c), form).split(',');
    perForm[form].ms += performance.now() - t;
    for (const o of c.outputs) {
      if (!roles.includes(o.role)) { failures.push(`${c.id} [${FORMS[form]}]: role ${o.role} missing`); continue; }
      const h = canonHash(E.GetArray(`out.${c.id}.${o.role}`), OUT_KIND[o.role]);
      perForm[form].checks++;
      if (h !== o.hash) failures.push(`${c.id} [${FORMS[form]}] ${o.role}: ${h} != ${o.hash}`);
      if (form === 0) aggregate.update(h);
    }
  }
}
const result = {
  engine: 'node', node: process.version, v8: process.versions.v8, runtime: info, startUpMs: startMs, fixture: path.basename(fixDir), scenario: golden.scenario,
  cases: golden.cases.length, forms: FORMS.map((f, i) => ({ form: f, outputChecks: perForm[i].checks, totalMs: perForm[i].ms })),
  failures: failures.length, failureList: failures.slice(0, 20), aggregateHashOfScalarOutputs: aggregate.digest('hex').slice(0, 32),
};
fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
console.log(`${path.basename(fixDir)}: ${golden.cases.length} cases x ${FORMS.length} forms, ${perForm.reduce((a, b) => a + b.checks, 0)} output hashes compared with the TypeScript's, ${failures.length} differ; aggregate ${result.aggregateHashOfScalarOutputs}; ${info}`);
for (const f of failures.slice(0, 10)) console.log('  ' + f);
process.exit(failures.length ? 1 : 0);
