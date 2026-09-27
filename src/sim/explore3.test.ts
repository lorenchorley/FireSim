import { it } from 'vitest';
import { demoScenario, withIgnitions, pointIgnition } from './testing/scenarios';
import { Simulation } from './simulation';
function bytes(v: unknown, d = 0): number { if (d > 8 || v === null || typeof v !== 'object') return 0; if (ArrayBuffer.isView(v)) return v.byteLength; let b = 0; for (const x of Array.isArray(v) ? v : Object.values(v as object)) b += bytes(x, d + 1); return b; }
function breakdown(v: unknown, prefix = '', d = 0): string[] { const out: string[] = []; if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) for (const [k, x] of Object.entries(v as object)) { const b = bytes(x); if (b > 200e3) { out.push(`${prefix}${k}: ${(b/1e6).toFixed(2)} MB`); if (d < 1) out.push(...breakdown(x, prefix + k + '.', d + 1)); } } return out; }
it('cp sizes', async () => {
  const base = await demoScenario();
  const s = withIgnitions(base, [pointIgnition('a', -2600, 900, 0, 60)]);
  const sim = new Simulation(s, { tier: (process.env.TIER as 'fast') ?? 'fast' });
  sim.advance(1800);
  const cp = (sim as any).ring[0];
  process.stderr.write(breakdown(cp).join('\n') + '\n');
}, 600000);
