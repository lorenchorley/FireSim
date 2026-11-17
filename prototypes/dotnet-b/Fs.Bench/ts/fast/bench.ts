/**
 * T1.4b TypeScript timing: the ORIGINAL kernels (LevelSetCore.evaluate stage 1 and 2, LevelSetCore.reinit, PyrogenicPotential.solve; unmodified, run by Node/V8, one thread) on the
 * real frames of the fast tier that capture.ts recorded. One operation each, the same as Fs.Bench/FastBench.cs:
 *   evalStage1   LevelSetCore.evaluate(phi, out, true): lazy speed requests answered by the replay hook (the coefficients the real hook wrote, from the frame); the prepStamp of the
 *                cells the hook was asked about is put back before each call (a loop over those cells), in both languages
 *   evalStage2   LevelSetCore.evaluate(phiS, out, false)
 *   reinit       LevelSetCore.reinit(): phi (the whole array), band and bandCount are restored before each call (a copy), in both languages
 *   restore      the restore of reinit alone (to subtract: both languages)
 *   pyro         PyrogenicPotential.solve(q) on a persistent instance
 * Each sample is ONE operation timed on its own; a warm-up of at least WARM_MS and 30 operations comes first.
 *   node bench.mjs FIXTURE_DIR OUT.json [SAMPLES=1000] [WARM_MS=1500]
 * Build: node ../build.mjs BUILD_DIR fast/capture.ts fast/bench.ts  (into a folder under the repository: node_modules must resolve)
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { buildLS, loadFixture, makePyro, type Case, type LS, type Meta } from './lib';

const [fixDir, outFile, sArg, wArg] = process.argv.slice(2);
if (!fixDir || !outFile) throw new Error('usage: bench.mjs FIXTURE_DIR OUT.json [SAMPLES] [WARM_MS]');
const samples = Number(sArg ?? 1000);
const warmMs = Number(wArg ?? 1500);
const fx = loadFixture(fixDir);
const h = fx.header as unknown as { meta: Meta; cases: Case[]; scenario: string; window: string };
const meta = h.meta;
const find = (pred: (c: Case) => boolean): Case => {
  const c = h.cases.find(pred);
  if (!c) throw new Error('case not found');
  return c;
};
const e1 = find((c) => c.kind === 'evaluate' && c.mode === 'e1');
const e2 = find((c) => c.kind === 'evaluate' && c.mode === 'e2');
const ri = find((c) => c.kind === 'reinit');
const py = find((c) => c.kind === 'pyro');

// stage 1: a lean replay hook (typed index, no log) on the real LevelSetCore
const f1 = buildLS(fx, meta, e1, 'plain');
const ls1: LS = f1.ls;
const hk = e1.hook as { k: string; vals: string };
const hookK = fx.get(hk.k) as unknown as Int32Array;
const hookV = fx.get(hk.vals) as Float32Array;
const hookIndex = new Int32Array(ls1.n).fill(-1);
hookK.forEach((k, i) => (hookIndex[k] = i));
const prepBefore = Int32Array.from(hookK, (k) => ls1.prepStamp[k]!);
ls1.hooks = {
  ensureSpeed: (k: number): void => {
    const i = hookIndex[k]!;
    if (i >= 0) {
      ls1.sA2[k] = hookV[6 * i]!; ls1.sB2[k] = hookV[6 * i + 1]!; ls1.sC[k] = hookV[6 * i + 2]!;
      ls1.sEx[k] = hookV[6 * i + 3]!; ls1.sEy[k] = hookV[6 * i + 4]!; ls1.sVls[k] = hookV[6 * i + 5]!;
    }
    ls1.prepStamp[k] = ls1.stamp;
  },
  onArrival: () => undefined,
};
const out1 = new Float64Array(ls1.bandCount);
const ls2: LS = buildLS(fx, meta, e2, 'plain').ls;
const out2 = new Float64Array(ls2.bandCount);
const ls3: LS = buildLS(fx, meta, ri, 'plain').ls;
const phi0 = Float64Array.from(ls3.phi);
const band0 = Int32Array.from(ls3.band.subarray(0, ls3.bandCount));
const count3 = ls3.bandCount;
const pyro = makePyro(meta, py.fireNx as number, py.fireNy as number, py.cellSize as number);
const q = fx.get(py.q as string) as Float32Array;

let sink = 0;
const restore = (): void => {
  ls3.phi.set(phi0);
  ls3.band.set(band0);
  ls3.bandCount = count3;
};
const ops: Record<string, () => void> = {
  evalStage1: () => {
    for (let i = 0; i < hookK.length; i++) ls1.prepStamp[hookK[i]!] = prepBefore[i]!;
    sink += ls1.evaluate(ls1.phi, out1, true);
  },
  evalStage2: () => {
    sink += ls2.evaluate(ls2.phiS, out2, false);
  },
  reinit: () => {
    restore();
    ls3.reinit();
    sink += ls3.bandCount;
  },
  restore: () => {
    restore();
    sink += ls3.bandCount;
  },
  pyro: () => {
    pyro.solve(q);
    sink += pyro.up[1]!;
  },
};

const pct = (s: number[], p: number): number => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
const cases: Record<string, unknown>[] = [];
for (const [name, op] of Object.entries(ops)) {
  let warm = 0;
  for (const w0 = performance.now(); warm < 30 || performance.now() - w0 < warmMs; warm++) op();
  const ms: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    op();
    ms.push(performance.now() - t0);
  }
  const s = [...ms].sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const sd = Math.sqrt(ms.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (ms.length - 1));
  const med = pct(s, 0.5);
  console.log(`${h.scenario} ${h.window} ${name}: median ${med.toFixed(4)} ms, min ${s[0]!.toFixed(4)}, p95 ${pct(s, 0.95).toFixed(4)}, max ${s[s.length - 1]!.toFixed(4)}, sd ${sd.toFixed(4)}`);
  cases.push({ kernel: name, n: samples, warmup: warm, medianMs: med, meanMs: mean, stdDevMs: sd, p95Ms: pct(s, 0.95), minMs: s[0], maxMs: s[s.length - 1] });
}
if (!Number.isFinite(sink)) console.log('(sink not finite)');
writeFileSync(outFile, JSON.stringify({ impl: 'ts', fixture: fixDir.split('/').pop(), node: process.version, v8: process.versions.v8, cpu: os.cpus()[0]?.model, cores: os.cpus().length, loadavg: os.loadavg(), bandCount: ls1.bandCount, hookCells: hookK.length, cases }));
process.exit(0);
