/**
 * Stage 1 TypeScript benchmark: the ORIGINAL `PyrogenicPotential.solve` (src/atmosphere/pyrogenic.ts, unmodified, run by Node/V8) on the captured
 * fixture inputs. Checks that it reproduces the captured outputs bit for bit (same code, same engine: it must), then times it.
 *   node bench.mjs FIXTURE_DIR OUT.json [REPEATS=50] [WARMUP=30]
 * Output JSON: per case, the timed samples (ms per solve call) and median / p95 / min / max.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { PyrogenicPotential } from '../../../../src/atmosphere/pyrogenic';
import { makeGridSpec } from '../../../../src/core/grid';

const [dir, outFile, repArg, warmArg] = process.argv.slice(2);
const reps = Number(repArg ?? 50);
const warm = Number(warmArg ?? 30);
const header = JSON.parse(readFileSync(`${dir}/header.json`, 'utf8'));
const buf = readFileSync(`${dir}/${header.dataFile}`);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const get = (name: string): Float32Array | Float64Array => {
  const a = header.arrays.find((x: { name: string }) => x.name === name);
  return a.type === 'float32' ? new Float32Array(ab, a.byteOffset, a.length) : new Float64Array(ab, a.byteOffset, a.length);
};
const grid = makeGridSpec({ lat: -33.7, lon: 150.3 }, header.fireNx * header.cellSizeM, header.cellSizeM);
if (grid.nx !== header.fireNx || grid.ny !== header.fireNy) throw new Error('grid mismatch');
const pct = (s: number[], p: number): number => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
const result: Record<string, unknown>[] = [];
for (const c of header.cases as { name: string; simTimeS: number; nonZeroSourceCells: number }[]) {
  const q = get(`${c.name}.q`) as Float32Array;
  const k = new PyrogenicPotential(grid);
  k.solve(q);
  let diff = 0;
  const same = (a: Float32Array | Float64Array, b: Float32Array | Float64Array): void => {
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i]! - b[i]!);
      if (d > diff) diff = d;
    }
  };
  same(k.psi, get(`${c.name}.psi`));
  same(k.up, get(`${c.name}.up`));
  same(k.vp, get(`${c.name}.vp`));
  // warm-up: at least `warm` calls and at least 1 s (the C# side warms the same way)
  let warmCalls = 0;
  for (const w0 = performance.now(); warmCalls < warm || performance.now() - w0 < 1000; warmCalls++) k.solve(q);
  const ms: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    k.solve(q);
    ms.push(performance.now() - t0);
  }
  const s = [...ms].sort((a, b) => a - b);
  result.push({ case: c.name, simTimeS: c.simTimeS, nonZeroSourceCells: c.nonZeroSourceCells, maxAbsDiffVsCaptured: diff, n: reps, warmup: warmCalls, medianMs: pct(s, 0.5), p95Ms: pct(s, 0.95), minMs: s[0], maxMs: s[s.length - 1], samplesMs: ms });
  console.log(c.name, `t=${c.simTimeS}s`, 'maxAbsDiff', diff, 'median', pct(s, 0.5).toFixed(3), 'ms', 'min', s[0]!.toFixed(3), 'p95', pct(s, 0.95).toFixed(3), 'max', s[s.length - 1]!.toFixed(3));
}
writeFileSync(outFile!, JSON.stringify({ impl: 'ts', node: process.version, v8: process.versions.v8, cpu: os.cpus()[0]?.model, cores: os.cpus().length, loadavgBefore: os.loadavg(), cases: result }));
process.exit(0);
