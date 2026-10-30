/**
 * The wind the fire feels crosses the worker boundary (0.7.0, `SimSnapshot.fireWind`): the host lists both of its Int16 buffers for transfer
 * (nothing is copied), the receiving side gets the same numbers, a later snapshot is not harmed by a transferred one, and the in-thread engine
 * (`transfer: false`, the APK's fallback and the tests') hands the arrays over untouched.
 */
import { describe, expect, it } from 'vitest';
import type { FireWindRaster, SimSnapshot } from '../core/types';
import { SimHost, snapshotTransferables } from './host';
import type { FromWorker } from './protocol';
import { pointIgnition, syntheticScenario } from './testing/scenarios';

const scenario = (): ReturnType<typeof syntheticScenario> => syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent: 1500, duration: 3600, options: { snapshotInterval: 60 } });

interface Posted {
  msg: FromWorker;
  transfer: Transferable[] | undefined;
}

/** A host on a port that records every message and its transfer list, with `schedule` driven by hand: `pump` runs the loop until the simulation reaches `time`. */
function drive(transfer: boolean): { host: SimHost; posted: Posted[]; pump: (time: number) => void } {
  const posted: Posted[] = [];
  const pending: (() => void)[] = [];
  const host = new SimHost({ post: (msg, tr) => posted.push({ msg, transfer: tr }) }, { schedule: (fn) => pending.push(fn), transfer, simulation: { minSnapshotWallMs: 0 } });
  host.handle({ type: 'init', scenario: scenario() });
  const pump = (time: number): void => {
    host.handle({ type: 'run', until: time });
    for (let guard = 0; pending.length && guard < 100000; guard++) pending.shift()!();
    expect(host.simulation!.time).toBeGreaterThanOrEqual(time - 1e-6);
  };
  return { host, posted, pump };
}

const snapshots = (posted: Posted[]): { snapshot: SimSnapshot; transfer: Transferable[] | undefined }[] =>
  posted.flatMap((p) => (p.msg.type === 'snapshot' ? [{ snapshot: p.msg.snapshot, transfer: p.transfer }] : []));

describe('snapshotTransferables', () => {
  it('lists the two buffers of the picture, once each, beside the others', () => {
    const { host, pump } = drive(false);
    pump(120);
    const s = host.simulation!.snapshot();
    const fw = s.fireWind!;
    const list = snapshotTransferables(s);
    expect(list.filter((b) => b === fw.u.buffer)).toHaveLength(1);
    expect(list.filter((b) => b === fw.v.buffer)).toHaveLength(1);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toContain(s.moisture.buffer); // the rest is still there
    expect(list).toContain(s.fire.arrivalTime.buffer);
    const without = snapshotTransferables({ ...s, fireWind: undefined } as SimSnapshot);
    expect(list.length - without.length).toBe(2);
    expect(without).not.toContain(fw.u.buffer);
    host.dispose();
  });

  it('every typed array a snapshot carries is in the list (a new field that is forgotten would be copied, silently)', () => {
    const { host, pump } = drive(false);
    pump(120);
    const s = host.simulation!.snapshot();
    const list = new Set<unknown>(snapshotTransferables(s));
    const missing: string[] = [];
    const walk = (v: unknown, path: string, depth: number): void => {
      if (v === null || typeof v !== 'object' || depth > 4) return;
      if (ArrayBuffer.isView(v)) {
        if (v.byteLength > 0 && !list.has(v.buffer)) missing.push(path);
        return;
      }
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, depth + 1);
    };
    walk(s, 'snapshot', 0);
    expect(missing).toEqual([]);
    host.dispose();
  });

  it('a snapshot without the picture (the demo engine, an older producer) is listed as before', () => {
    const { host, pump } = drive(false);
    pump(60);
    const s = { ...host.simulation!.snapshot() } as SimSnapshot;
    delete s.fireWind;
    expect(() => snapshotTransferables(s)).not.toThrow();
    host.dispose();
  });
});

describe('across the worker boundary (transfer: true, the message cloned with its transfer list as postMessage does)', () => {
  it('the picture is sent without a copy: its buffers are in the transfer list, detached at the sender, intact at the receiver', () => {
    const { host, posted, pump } = drive(true);
    pump(240);
    const sent = snapshots(posted);
    expect(sent.length).toBeGreaterThanOrEqual(4); // t0 and the minutes
    const received: FireWindRaster[] = [];
    for (const { snapshot, transfer } of sent) {
      const fw = snapshot.fireWind!;
      expect(transfer, `at ${snapshot.time}`).toBeDefined();
      expect(transfer).toContain(fw.u.buffer);
      expect(transfer).toContain(fw.v.buffer);
      const u = Array.from(fw.u);
      const v = Array.from(fw.v);
      const copy = structuredClone(snapshot, { transfer: transfer! }); // what the receiving thread gets
      expect(fw.u.byteLength, `sender's u detached at ${snapshot.time}`).toBe(0);
      expect(fw.v.byteLength).toBe(0);
      const got = copy.fireWind!;
      expect(got.u).toBeInstanceOf(Int16Array);
      expect(Array.from(got.u)).toEqual(u);
      expect(Array.from(got.v)).toEqual(v);
      expect(got.time).toBe(snapshot.time);
      expect([got.block, got.grid.cellSize]).toEqual([2, 60]);
      received.push(got);
    }
    // the picture of the first snapshot was not an all-zero buffer, and a later one still differs from it (the transfers harmed nothing)
    expect(received[0]!.u.some((q) => q !== 0)).toBe(true);
    expect(received.at(-1)!.time).toBeGreaterThanOrEqual(240);
    host.dispose();
  });
});

describe('the in-thread engine (transfer: false)', () => {
  it('posts no transfer list, and the picture arrives as made: same arrays, intact, usable at once', () => {
    const { host, posted, pump } = drive(false);
    pump(180);
    const sent = snapshots(posted);
    expect(sent.length).toBeGreaterThanOrEqual(3);
    for (const { snapshot, transfer } of sent) {
      expect(transfer).toBeUndefined();
      const fw = snapshot.fireWind!;
      expect(fw.u.byteLength).toBe(fw.grid.nx * fw.grid.ny * 2);
      expect(fw.v.byteLength).toBe(fw.u.byteLength);
      expect(fw.time).toBe(snapshot.time);
    }
    // each snapshot has pictures of its own (the engine keeps none to write into: they cannot change under the history that holds them)
    expect(sent[1]!.snapshot.fireWind!.u).not.toBe(sent[2]!.snapshot.fireWind!.u);
    const before = Array.from(sent[1]!.snapshot.fireWind!.u);
    pump(300);
    expect(Array.from(sent[1]!.snapshot.fireWind!.u)).toEqual(before);
    host.dispose();
  });
});
