/**
 * The host's status reports: whatever throttling does, the last report of a run or replay that has finished must say
 * "not running" (the UI's `computing` flag and its stalled-run recovery rely on it).
 */
import { describe, expect, it } from 'vitest';
import { SimHost } from './host';
import type { FromWorker } from './protocol';
import { pointIgnition, syntheticScenario } from './testing/scenarios';

type Status = Extract<FromWorker, { type: 'status' }>;

/** run to 900 s, then a stale larger target, an edit at 300 s (a replay) and an immediate pause. */
async function pausedReplay(clock: () => number): Promise<{ host: SimHost; statuses: () => Status[] }> {
  const posted: FromWorker[] = [];
  const host = new SimHost({ post: (m) => posted.push(m) }, { schedule: (fn) => setTimeout(fn, 0), clock, simulation: { minSnapshotWallMs: 0 } });
  host.handle({ type: 'init', scenario: syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent: 1500, duration: 7200 }) });
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const statuses = (): Status[] => posted.filter((m): m is Status => m.type === 'status');
  const settle = async (): Promise<void> => {
    await sleep(30);
    for (let i = 0; i < 400; i++) {
      const sim = host.simulation!;
      if (sim.isReady && sim.time >= sim.logicalNow - 1e-6) break;
      await sleep(10);
    }
    await sleep(30);
  };
  host.handle({ type: 'run', until: 900 });
  await settle();
  for (let i = 0; i < 400 && host.simulation!.time < 900; i++) await sleep(10);
  expect(host.simulation!.time).toBeGreaterThanOrEqual(900);
  // A stale, larger target from an earlier run; then an edit in the past (a replay) and an immediate pause: the
  // pause report says "replaying"; the replay ends inside the throttle window.
  host.handle({ type: 'run', until: 7200 });
  host.handle({ type: 'pause' });
  await settle();
  host.handle({ type: 'ignite', ignition: { ...pointIgnition('b', 200, 100, 300, 45) } });
  host.handle({ type: 'pause' });
  await settle();
  return { host, statuses };
}

describe('SimHost status reports', () => {
  it('a replay that finishes inside the throttle window still ends with running = false', async () => {
    // A fake wall clock that advances 1 ms per read: a chunk is a few steps and every report is inside the throttle window unless forced.
    let wall = 0;
    const { host, statuses } = await pausedReplay(() => (wall += 1));
    expect(host.simulation!.time).toBeGreaterThanOrEqual(host.simulation!.logicalNow - 1e-6);
    expect(statuses().at(-1)!.running).toBe(false);
    host.dispose();
  }, 120000);

  it('a paused replay (an edit in the past) stops at the logical now, not at a stale run target', async () => {
    const { host, statuses } = await pausedReplay(() => 1000); // a frozen clock: a chunk never ends by itself
    const sim = host.simulation!;
    expect(sim.logicalNow).toBe(300);
    expect(sim.time).toBeGreaterThanOrEqual(300 - 1e-6);
    expect(sim.time).toBeLessThan(400); // (the stale target from the earlier run is 7200)
    expect(statuses().at(-1)!.running).toBe(false);
    host.dispose();
  }, 120000);
});
