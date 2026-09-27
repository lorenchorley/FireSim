/**
 * Protocol tests (spec §12.1, §2.3): LocalSimController and SimClient (in-thread fallback: Node has no Worker) over the
 * same SimHost the worker runs — ready + t0 snapshot, chunked run with status and streamed snapshots, explain,
 * pause, rewind with 'rewound' and a re-run that re-emits nothing it had already sent, edits in the past, errors.
 */
import { describe, expect, it } from 'vitest';
import type { CellExplanation, SimSnapshot } from '../core/types';
import { LocalSimController, SimClient } from './client';
import { SimHost, snapshotTransferables } from './host';
import type { FromWorker, SimController } from './protocol';
import { snapshotHash } from './testing/hash';
import { pointIgnition, syntheticScenario } from './testing/scenarios';

function waitFor(_c: SimController, pred: (snaps: SimSnapshot[], st: { time: number; running: boolean }[]) => boolean, snaps: SimSnapshot[], st: { time: number; running: boolean }[], ms = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = (): void => {
      if (pred(snaps, st)) resolve();
      else if (Date.now() - t0 > ms) reject(new Error('timeout'));
      else setTimeout(check, 5);
    };
    check();
  });
}

describe('LocalSimController (in-thread host)', () => {
  it('init → ready + t0 snapshot; run streams snapshots and status; explain; rewind re-runs without duplicates', async () => {
    const c = new LocalSimController({ chunkMs: 15 });
    const snaps: SimSnapshot[] = [];
    const st: { time: number; running: boolean }[] = [];
    const rewound: number[] = [];
    const order: string[] = [];
    c.on('ready', () => order.push('ready'));
    c.on('snapshot', (s) => {
      order.push(`snap:${s.time}`);
      snaps.push(s);
    });
    c.on('status', (s) => st.push(s));
    c.on('rewound', (t) => rewound.push(t));
    const errors: string[] = [];
    c.on('error', (m) => errors.push(m));
    const scenario = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent: 2400 });
    const forecast = await c.init(scenario);
    expect(Array.isArray(forecast)).toBe(true);
    await waitFor(c, (s) => s.length >= 1, snaps, st);
    expect(order.slice(0, 2)).toEqual(['ready', 'snap:0']);
    c.run(1500);
    await waitFor(c, (s, x) => s.some((q) => q.time === 1500) && x.length > 0 && !x[x.length - 1]!.running, snaps, st);
    expect(snaps.map((s) => s.time)).toEqual([0, 300, 600, 900, 1200, 1500]);
    expect(st.some((s) => s.running)).toBe(true);
    const ex: CellExplanation = await c.explain(-250, 0);
    expect(ex.narrative.length).toBeGreaterThan(0);
    // Rewind to 1000: the host restores t0, posts 'rewound', re-runs silently to 1000; a later run emits 1200, 1500 again.
    // Hashes without the insights: a snapshot after the rewind target carries only insights newer than the target
    // (the UI kept the ones up to it).
    const firstRun = new Map(snaps.map((s) => [s.time, snapshotHash(s, ['stats.msPerSimMinute', 'insights'])]));
    const firstInsights = new Map(snaps.map((s) => [s.time, s.insights]));
    snaps.length = 0;
    c.rewind(1000);
    await waitFor(c, () => rewound.length > 0, snaps, st);
    expect(rewound).toEqual([1000]);
    c.run(1500);
    await waitFor(c, (s) => s.some((q) => q.time === 1500), snaps, st);
    expect(snaps.map((s) => s.time)).toEqual([1200, 1500]);
    for (const s of snaps) {
      expect(snapshotHash(s, ['stats.msPerSimMinute', 'insights'])).toBe(firstRun.get(s.time));
      const expected = firstInsights.get(s.time)!.filter((i) => i.time > 1000);
      expect(s.insights.map((i) => i.id)).toEqual(expected.map((i) => i.id));
    }
    // An ignition in the past rewinds by itself.
    rewound.length = 0;
    c.ignite({ ...pointIgnition('late', 600, 600, 900, 45), origin: 'spot' });
    await waitFor(c, () => rewound.length > 0, snaps, st);
    expect(rewound).toEqual([900]);
    expect(errors).toEqual([]);
    c.dispose();
  }, 120000);

  it('pause stops a run between chunks and a new run continues', async () => {
    const c = new LocalSimController({ chunkMs: 5 });
    const snaps: SimSnapshot[] = [];
    const st: { time: number; running: boolean }[] = [];
    c.on('snapshot', (s) => snaps.push(s));
    c.on('status', (s) => st.push(s));
    await c.init(syntheticScenario({ ignitions: [pointIgnition('a', -300, 0)], extent: 2400 }));
    c.run(3600);
    await waitFor(c, (s) => s.some((q) => q.time >= 300), snaps, st);
    c.pause();
    await waitFor(c, (_s, x) => x.length > 0 && !x[x.length - 1]!.running, snaps, st);
    const t = st[st.length - 1]!.time;
    expect(t).toBeLessThan(3600);
    await new Promise((r) => setTimeout(r, 50));
    expect(st[st.length - 1]!.time).toBe(t);
    c.run(t + 600);
    await waitFor(c, (_s, x) => x[x.length - 1]!.time >= t + 600 && !x[x.length - 1]!.running, snaps, st);
    c.dispose();
  }, 120000);
});

describe('SimClient', () => {
  it('falls back to an in-thread host without Worker and implements the SimController contract', async () => {
    const c = new SimClient();
    expect(c.inWorker).toBe(false);
    const snaps: SimSnapshot[] = [];
    c.on('snapshot', (s) => snaps.push(s));
    await c.init(syntheticScenario({ ignitions: [pointIgnition('a', -300, 0)], extent: 2400 }));
    c.run(600);
    await waitFor(c, (s) => s.some((q) => q.time === 600), snaps, []);
    expect(snaps[snaps.length - 1]!.stats.burntAreaHa).toBeGreaterThan(0);
    c.setQuality('fast');
    c.setOption('coupling', 0.5);
    c.dispose();
  }, 60000);

  it('reports errors from the host as error events (bad scenario)', async () => {
    const c = new SimClient();
    const errors: string[] = [];
    c.on('error', (m) => errors.push(m));
    const bad = syntheticScenario();
    const wrongFuel = syntheticScenario({ extent: 1500 }).fuel;
    await expect(c.init({ ...bad, fuel: wrongFuel })).rejects.toThrow(/grid/);
    expect(errors.length).toBe(1);
    c.dispose();
  }, 60000);
});

describe('SimHost transfer lists', () => {
  it('lists every distinct snapshot buffer once', () => {
    const posted: { msg: FromWorker; transfer?: Transferable[] }[] = [];
    const host = new SimHost({ post: (msg, transfer) => posted.push({ msg, ...(transfer ? { transfer } : {}) }) }, { transfer: true, schedule: () => {} });
    host.handle({ type: 'init', scenario: syntheticScenario({ extent: 1500 }) });
    const snap = posted.find((p) => p.msg.type === 'snapshot')!;
    expect(snap.transfer!.length).toBeGreaterThan(10);
    expect(new Set(snap.transfer).size).toBe(snap.transfer!.length);
    const s = (snap.msg as { snapshot: SimSnapshot }).snapshot;
    expect(snapshotTransferables(s).length).toBe(snap.transfer!.length);
  });
});
