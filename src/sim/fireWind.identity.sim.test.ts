/**
 * Publishing the wind the fire feels changes nothing the engine computes (0.7.0 lane D; plan section 4, rule 1): a run whose snapshots carry
 * `fireWind` and the same run with the publisher switched off (it returns nothing, as the 0.6.0 code did not call it) have the same snapshots,
 * every part of every one, bit for bit, on both tiers, with a rewind in the middle. The snapshot hash is the repository's
 * (`sim/testing/hash.ts`: every typed array's bytes and the JSON of the rest), skipping `fireWind` and the statistics' wall clock. This is the
 * proof that the new field is a pure read of the arrays the engine already had; the hash of a run that carries the field is not the 0.6.0 one,
 * which is why the comparison skips it (V1 of the contract does the same against a 0.6.0 build).
 */
import { describe, expect, it, vi } from 'vitest';
import type { SimSnapshot } from '../core/types';
import { Simulation } from './simulation';
import { demoScenario, pointIgnition, syntheticScenario, withIgnitions } from './testing/scenarios';
import { snapshotHash, snapshotPartHashes } from './testing/hash';

/** The publisher, switched off for the "without" runs: every other module sees the real one. */
const gate = vi.hoisted(() => ({ off: false }));
vi.mock('./fireWindPublish', async (importOriginal) => {
  const real = await importOriginal<typeof import('./fireWindPublish')>();
  return { ...real, publishFireWind: (...a: Parameters<typeof real.publishFireWind>): ReturnType<typeof real.publishFireWind> | undefined => (gate.off ? undefined : real.publishFireWind(...a)) };
});

const SKIP = ['stats.msPerSimMinute', 'fireWind'];

interface Out {
  hashes: Map<number, number>;
  parts: Map<number, Record<string, number>>;
  carried: number;
  snaps: number;
}

/** Run `sc` to `until`, then rewind to `back` and run to `until` again, with the publisher on or off; the hashes of every snapshot (the last one of a time wins). */
function runWith(publish: boolean, sc: ReturnType<typeof syntheticScenario>, until: number, back: number, tier: 'fast' | 'standard'): Out {
  gate.off = !publish;
  try {
    const out: Out = { hashes: new Map(), parts: new Map(), carried: 0, snaps: 0 };
    const sim = new Simulation(sc, {
      tier,
      hooks: {
        snapshot: (s: SimSnapshot) => {
          out.snaps++;
          if (s.fireWind) out.carried++;
          out.hashes.set(s.time, snapshotHash(s, SKIP));
          out.parts.set(s.time, snapshotPartHashes(s));
        },
      },
    });
    const t0 = sim.snapshot();
    out.hashes.set(0, snapshotHash(t0, SKIP));
    if (t0.fireWind) out.carried++;
    sim.spinUp();
    sim.advance(until);
    sim.rewind(back);
    sim.advance(until);
    return out;
  } finally {
    gate.off = false;
  }
}

function expectSame(a: Out, b: Out, label: string): void {
  expect(a.snaps, `${label}: snapshots`).toBeGreaterThan(8);
  expect([...a.hashes.keys()]).toEqual([...b.hashes.keys()]);
  for (const [t, h] of a.hashes) expect(b.hashes.get(t), `${label} t=${t}`).toBe(h);
  // part by part, so a difference says where; `fireWind` is the one part allowed to differ (the "without" run has none)
  for (const [t, pa] of a.parts) {
    const pb = b.parts.get(t)!;
    for (const k of Object.keys(pa)) if (k !== 'fireWind') expect(pb[k], `${label} t=${t} part ${k}`).toBe(pa[k]);
    expect(Object.keys(pb).filter((k) => !(k in pa))).toEqual([]);
  }
}

describe('publishing fireWind changes no other part of any snapshot', () => {
  it('fast tier, 3 km, a fire and a rewind: every part but fireWind is bit-identical to the run that does not publish', () => {
    const sc = syntheticScenario({ windFromDeg: 270, windKmh: 36, extent: 3000, duration: 3600, ignitions: [pointIgnition('a', -600, 0, 0, 60)], options: { snapshotInterval: 60 } });
    const on = runWith(true, sc, 1500, 600, 'fast');
    const off = runWith(false, sc, 1500, 600, 'fast');
    expect(on.carried).toBe(on.snaps + 1); // every snapshot of the run (and the t0 one) carries it
    expect(off.carried).toBe(0);
    expectSame(on, off, 'fast');
  }, 600000);

  it('standard tier (3-D air with its spin-up), 1.5 km, a fire and a rewind: the same', () => {
    const sc = syntheticScenario({ windFromDeg: 270, windKmh: 36, extent: 1500, duration: 1800, ignitions: [pointIgnition('a', -300, 0, 0, 60)], options: { snapshotInterval: 60, tier: 'standard' } });
    const on = runWith(true, sc, 900, 300, 'standard');
    const off = runWith(false, sc, 900, 300, 'standard');
    expect(on.carried).toBe(on.snaps + 1);
    expect(off.carried).toBe(0);
    expectSame(on, off, 'standard');
  }, 900000);

  it('the Katoomba demo site, 6 km (real terrain, slope flow, a fire on the escarpment), fast tier: the same', { timeout: 900_000 }, async () => {
    const base = await demoScenario({ startCivil: [2025, 12, 20, 14], extent: 6000, tier: 'fast', duration: 3600 });
    const sc = withIgnitions(base, [pointIgnition('escarpment', -2170, 900, 0, 60)], { snapshotInterval: 60, tier: 'fast' });
    const on = runWith(true, sc, 900, 300, 'fast');
    const off = runWith(false, sc, 900, 300, 'fast');
    expect(on.carried).toBe(on.snaps + 1);
    expectSame(on, off, 'Katoomba');
  });
});
