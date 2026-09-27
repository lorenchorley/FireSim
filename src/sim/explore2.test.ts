import { it, expect } from 'vitest';
import { demoScenario, withIgnitions, pointIgnition } from './testing/scenarios';
import { Simulation } from './simulation';
import { snapshotHash, snapshotPartHashes } from './testing/hash';
import type { SimSnapshot } from '../core/types';
it('determinism', async () => {
  const base = await demoScenario();
  const s = withIgnitions(base, [pointIgnition('a', -2600, 900, 0, 60)]);
  const tier = (process.env.TIER as 'fast') ?? 'fast';
  const first = new Map<number, SimSnapshot>();
  let mode = 'first';
  const second = new Map<number, SimSnapshot>();
  const sim = new Simulation(s, { tier, hooks: { snapshot: (sn) => (mode === 'first' ? first : second).set(sn.time, sn), rewound: (t) => process.stderr.write(`rewound ${t}\n`) } });
  sim.advance(3600);
  process.stderr.write(`cps ${sim.checkpointTimes} bytes ${(sim.checkpointBytes()/1e6).toFixed(1)} MB\n`);
  mode = 'second';
  const cpT = sim.rewind(2400);
  process.stderr.write(`restored ${cpT} t=${sim.time}\n`);
  sim.advance(3600);
  for (const [t, sn] of second) {
    const a = first.get(t)!;
    const ha = snapshotHash(a), hb = snapshotHash(sn);
    if (ha !== hb) {
      const pa = snapshotPartHashes(a), pb = snapshotPartHashes(sn);
      process.stderr.write(`t=${t} DIFF ${Object.keys(pa).filter(k => pa[k] !== pb[k]).join(',')}\n`);
    } else process.stderr.write(`t=${t} same\n`);
  }
  // Second rewind to t0 checkpoint
  mode = 'third';
  const third = new Map<number, SimSnapshot>();
  (sim as any).hooks.snapshot = (sn: SimSnapshot) => third.set(sn.time, sn);
  sim.rewind(600); sim.advance(1800);
  for (const [t, sn] of third) process.stderr.write(`t0-replay t=${t} ${snapshotHash(first.get(t)!) === snapshotHash(sn) ? 'same' : 'DIFF ' + Object.entries(snapshotPartHashes(first.get(t)!)).filter(([k, v]) => snapshotPartHashes(sn)[k] !== v).map(([k]) => k).join(',')}\n`);
  expect(second.size).toBeGreaterThan(0);
}, 600000);
