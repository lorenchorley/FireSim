/**
 * T1.2 TypeScript benchmark: the ORIGINAL frozen speed-test kernels (src/ui/speedTestKernels.ts, unmodified, run by Node/V8, one thread) on the app's own
 * inputs. It first checks the two frozen checksums (so the input is the app's), then times, per kernel, ONE WHOLE SWEEP per sample (all parts then
 * end(): the unit the C# BenchmarkDotNet cases call an operation), after a warm-up of at least WARM_MS and at least 30 sweeps.
 *   node speedtest-bench.mjs OUT.json [STENCIL_SAMPLES=600] [COPY_SAMPLES=300] [WARM_MS=1500]
 * Build it first: node build.mjs OUT_DIR speedtest-bench.ts
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { makeCopyKernel, makeStencilKernel, sweeps, type Kernel } from '../../../../src/ui/speedTestKernels';

const [outFile, sArg, cArg, wArg] = process.argv.slice(2);
if (!outFile) throw new Error('usage: speedtest-bench.mjs OUT.json [STENCIL_SAMPLES] [COPY_SAMPLES] [WARM_MS]');
const stencilSamples = Number(sArg ?? 600);
const copySamples = Number(cArg ?? 300);
const warmMs = Number(wArg ?? 1500);

const FROZEN = { stencilAfter3: 0x7d268009, copyAfter2: 0x1e84aad9 };
const k1 = makeStencilKernel();
sweeps(k1, 3);
const k2 = makeCopyKernel();
sweeps(k2, 2);
const checksums = { stencilAfter3: k1.checksum(), copyAfter2: k2.checksum(), ok: k1.checksum() === FROZEN.stencilAfter3 && k2.checksum() === FROZEN.copyAfter2 };
if (!checksums.ok) throw new Error(`frozen checksums not reproduced: ${JSON.stringify(checksums)}`);

const pct = (s: number[], p: number): number => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;

function time(name: string, make: () => Kernel, samples: number, unit: string): Record<string, unknown> {
  const k = make();
  const oneSweep = (): void => {
    for (let p = 0; p < k.parts; p++) k.part(p);
    k.end();
  };
  let warm = 0;
  for (const w0 = performance.now(); warm < 30 || performance.now() - w0 < warmMs; warm++) oneSweep();
  const ms: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    oneSweep();
    ms.push(performance.now() - t0);
  }
  const s = [...ms].sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const sd = Math.sqrt(ms.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (ms.length - 1));
  const med = pct(s, 0.5);
  const out = { name, n: samples, warmup: warm, medianMs: med, meanMs: mean, stdDevMs: sd, p95Ms: pct(s, 0.95), minMs: s[0], maxMs: s[s.length - 1], work: k.work, workUnit: unit, ratePerS: k.work / (med / 1000), samplesMs: ms };
  console.log(name, 'median', med.toFixed(4), 'ms', 'min', s[0]!.toFixed(4), 'p95', pct(s, 0.95).toFixed(4), 'max', s[s.length - 1]!.toFixed(4), 'sd', sd.toFixed(4));
  return out;
}

const cases = [time('stencil sweep (K1, 45x45x20)', makeStencilKernel, stencilSamples, 'cell updates'), time('copy sweep (K2, 16 MiB)', makeCopyKernel, copySamples, 'bytes')];
writeFileSync(outFile, JSON.stringify({ impl: 'ts', node: process.version, v8: process.versions.v8, cpu: os.cpus()[0]?.model, cores: os.cpus().length, loadavgBefore: os.loadavg(), checksums, cases }));
process.exit(0);
