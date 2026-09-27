import { it } from 'vitest';
import { SimHost } from './host';
import { snapshotPartHashes } from './testing/hash';
import { pointIgnition, syntheticScenario } from './testing/scenarios';
import type { SimSnapshot } from '../core/types';
import type { FromWorker } from './protocol';
it('host flow', () => {
  const scenario = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent: 2400 });
  const q: (() => void)[] = [];
  const snaps: SimSnapshot[] = [];
  const host = new SimHost({ post: (m: FromWorker) => { if (m.type === 'snapshot') snaps.push(m.snapshot); } }, { schedule: (fn) => q.push(fn), chunkMs: Number(process.env.CHUNK ?? 15) });
  const drain = () => { while (q.length) q.shift()!(); };
  host.handle({ type: 'init', scenario }); drain();
  host.handle({ type: 'run', until: 1500 }); drain();
  if (process.env.EXPLAIN) { host.handle({ type: 'explain', x: -250, y: 0, reqId: 1 }); drain(); }
  const first = new Map(snaps.map(s => [s.time, snapshotPartHashes(s)])); snaps.length = 0;
  host.handle({ type: 'rewind', time: 1000 }); drain();
  host.handle({ type: 'run', until: 1500 }); drain();
  for (const s of snaps) { const a = first.get(s.time)!, b = snapshotPartHashes(s); process.stderr.write(`t=${s.time}: ${Object.keys(a).filter(k => a[k] !== b[k]).join(',') || 'same'}\n`); }
}, 120000);
