/**
 * Measures the speed test's REFERENCE on the build machine (0.7.0, item C): the numbers pasted into SPEED_TEST_REFERENCE in speedTest.ts. Skipped unless asked:
 *
 *   SPEEDTEST_REF=1 npx vitest run src/ui/speedTest.reference.test.ts          (SPEEDTEST_RUNS=9 by default; each run is about 2 s)
 *
 * It runs the same two kernels as the app (`measureAll`) in this node process, on one core, several times, and prints every run (wall clock, which is what the
 * app measures, and CPU time, which a busy machine cannot steal from), the best of them and the MEDIAN of the wall-clock runs. Paste the median line into speedTest.ts
 * with the date, and say how many runs and how loaded the machine was: a phone's number is one run of 0.8 s, so the typical run is the fair thing to divide it by
 * (the best run is a little above what one run usually gives). Take it under the heavy lock (`flock /tmp/firesim-heavy.lock ...`) so nothing heavy runs beside it.
 */
import { appendFileSync } from 'node:fs';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { measureAll } from './speedTestKernels';
import { SPEED_TEST_VERSION } from './speedTest';

const cpuMs = (): number => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};

describe.skipIf(!process.env.SPEEDTEST_REF)('the speed test reference (SPEEDTEST_REF=1)', () => {
  it('measures the kernels in this node process and prints the numbers to paste', () => {
    const runs = Math.max(1, Number(process.env.SPEEDTEST_RUNS ?? 9));
    const wall: { stencilMcellsPerS: number; copyGBps: number }[] = [];
    const cpu: { stencilMcellsPerS: number; copyGBps: number }[] = [];
    const lines: string[] = [`speed test version ${SPEED_TEST_VERSION}, node ${process.version}, ${os.cpus()[0]?.model ?? 'unknown cpu'} x ${os.cpus().length}, load ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`];
    for (let i = 0; i < runs; i++) {
      const w = measureAll(() => performance.now());
      const c = measureAll(cpuMs);
      wall.push(w);
      cpu.push(c);
      lines.push(`run ${i + 1}: wall ${w.stencilMcellsPerS.toFixed(2)} Mcells/s, ${w.copyGBps.toFixed(3)} GB/s | cpu time ${c.stencilMcellsPerS.toFixed(2)} Mcells/s, ${c.copyGBps.toFixed(3)} GB/s`);
    }
    const best = (xs: typeof wall, k: 'stencilMcellsPerS' | 'copyGBps'): number => Math.max(...xs.map((x) => x[k]));
    const median = (xs: typeof wall, k: 'stencilMcellsPerS' | 'copyGBps'): number => xs.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    lines.push(`paste (median of ${runs}, wall): { stencilMcellsPerS: ${median(wall, 'stencilMcellsPerS').toFixed(1)}, copyGBps: ${median(wall, 'copyGBps').toFixed(2)} }`);
    lines.push(`best of ${runs} (wall): ${best(wall, 'stencilMcellsPerS').toFixed(1)} Mcells/s, ${best(wall, 'copyGBps').toFixed(2)} GB/s; best by cpu time: ${best(cpu, 'stencilMcellsPerS').toFixed(1)} Mcells/s, ${best(cpu, 'copyGBps').toFixed(2)} GB/s`);
    const out = `\n${lines.join('\n')}\n`;
    process.stdout.write(out);
    if (process.env.SPEEDTEST_OUT) appendFileSync(process.env.SPEEDTEST_OUT, out);
    expect(best(wall, 'stencilMcellsPerS')).toBeGreaterThan(0);
  }, 900_000);
});
