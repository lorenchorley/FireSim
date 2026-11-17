/**
 * T1.4a TypeScript timing: the ORIGINAL kernels (EllipticSolver.relax/gradient/divergence, dynamics.advect; unmodified, run by Node/V8, one thread) on the captured
 * real state of the standard tier (capture.ts). One operation each, the same as Fs.Bench/AirBench.cs: RelaxCycle (the six relax calls of one V(2,2) from their
 * recorded inputs; x is restored from the recorded input before each call, as the C# does), Gradient, DivergenceF32, DivergenceF64, AdvectStep (the four advect calls of
 * one atmosphere step). Each sample is ONE operation timed on its own; a warm-up of at least WARM_MS and 30 operations comes first.
 *   node bench.mjs FIXTURE_DIR OUT.json [SAMPLES=1000] [WARM_MS=1500]
 * Build: node ../build.mjs BUILD_DIR air/capture.ts air/bench.ts  (into a folder under the repository: node_modules must resolve)
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { advect, divergence, gradient, loadFixture, makeShell, relax } from './lib';

const [fixDir, outFile, sArg, wArg] = process.argv.slice(2);
if (!fixDir || !outFile) throw new Error('usage: bench.mjs FIXTURE_DIR OUT.json [SAMPLES] [WARM_MS]');
const samples = Number(sArg ?? 1000);
const warmMs = Number(wArg ?? 1500);
const fx = loadFixture(fixDir);
const h = fx.header as unknown as { grid: { nx: number; ny: number; nz: number; n: number }; levels: { nx: number; ny: number; nz: number }[]; relaxCalls: { level: number; sweeps: number; reverse: boolean }[]; scenario: string };
const { nx, ny, nz, n } = h.grid;
const shell = makeShell(fx);
const f32 = (name: string): Float32Array => fx.get(name) as Float32Array;
const f64 = (name: string): Float64Array => fx.get(name) as Float64Array;

const phi = f64('field.phi');
const u = f32('field.u'), v = f32('field.v'), w = f32('field.w'), th = f32('field.th'), sm = f32('field.sm');
const gu = f64('derived.gu'), gv = f64('derived.gv'), gw = f64('derived.gw');
const Dx = f32('derived.Dx'), Dy = f32('derived.Dy'), Dz = f32('derived.Dz');
const out = new Float64Array(n);
const du = new Float32Array((nx + 1) * ny * nz), dv = new Float32Array(nx * (ny + 1) * nz), dw = new Float32Array(nx * ny * (nz + 1)), dth = new Float32Array(n), dsm = new Float32Array(n);
const levels = h.levels.map((d, l) => {
  const plane = d.nx * d.ny;
  return { nx: d.nx, ny: d.ny, nz: d.nz, plane, n: plane * d.nz, cx: f32(`level${l}.cx`), cy: f32(`level${l}.cy`), cz: f32(`level${l}.cz`), tInv: f32(`level${l}.tInv`), tC: f32(`level${l}.tC`) };
});
const calls = h.relaxCalls.map((c, i) => {
  const xIn = f32(`call${i}.x`);
  const L = { ...levels[c.level]!, b: f32(`call${i}.b`), x: new Float32Array(xIn.length) };
  return { L, xIn, sweeps: c.sweeps, reverse: c.reverse };
});

let sink = 0;
const ops: Record<string, () => void> = {
  relax: () => {
    for (const c of calls) {
      c.L.x.set(c.xIn);
      relax(c.L, c.sweeps, c.reverse);
    }
    sink += calls[0]!.L.x[0]!;
  },
  gradient: () => {
    sink += gradient(shell, phi).gu[1]!;
  },
  divergenceF32: () => {
    divergence(shell, u, v, w, out, 1, 1);
    sink += out[1]!;
  },
  divergenceF64: () => {
    divergence(shell, gu, gv, gw, out, 1, 1);
    sink += out[1]!;
  },
  advect: () => {
    const g = shell.g;
    advect(g as never, Dx, Dy, Dz, u, du, nx + 1, ny, nz, 0.5, 0, 0);
    advect(g as never, Dx, Dy, Dz, v, dv, nx, ny + 1, nz, 0, 0.5, 0);
    advect(g as never, Dx, Dy, Dz, w, dw, nx, ny, nz + 1, 0, 0, 0.5);
    advect(g as never, Dx, Dy, Dz, th, dth, nx, ny, nz, 0, 0, 0, sm, dsm);
    sink += dth[1]!;
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
  console.log(`${h.scenario} ${fixDir.split('/').pop()} ${name}: median ${med.toFixed(4)} ms, min ${s[0]!.toFixed(4)}, p95 ${pct(s, 0.95).toFixed(4)}, max ${s[s.length - 1]!.toFixed(4)}, sd ${sd.toFixed(4)}`);
  cases.push({ kernel: name, n: samples, warmup: warm, medianMs: med, meanMs: mean, stdDevMs: sd, p95Ms: pct(s, 0.95), minMs: s[0], maxMs: s[s.length - 1] });
}
if (!Number.isFinite(sink)) console.log('(sink not finite: NaN in the data, timing unaffected)');
writeFileSync(outFile, JSON.stringify({ impl: 'ts', fixture: fixDir.split('/').pop(), node: process.version, v8: process.versions.v8, cpu: os.cpus()[0]?.model, cores: os.cpus().length, loadavg: os.loadavg(), cases }));
process.exit(0);
