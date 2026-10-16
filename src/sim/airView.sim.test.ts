/**
 * The air view as it leaves the engine (plan section 7): the new optional fields stamped on every snapshot of both tiers,
 * `decimateView` and `snapshotTransferables` carrying them, and the rule of ground rule 1: the view is derived data, so the
 * simulation's results are the same whatever the view holds, however often it is read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { airHas, airKind, airLayout, hasAirWind } from '../core/airView';
import { packWind, windPackErrorBound } from '../core/airPack';
import type { AtmosphereView, SimSnapshot } from '../core/types';
import { Atmosphere } from '../atmosphere/atmosphere';
import { DiagnosticWind } from '../atmosphere/diagnosticWind';
import { AtmosphereSampler } from '../render/atmosphereSampler';
import { SnapshotStore } from '../ui/snapshotStore';
import { snapshotTransferables } from './host';
import { Simulation, decimateView } from './simulation';
import { snapshotPartHashes } from './testing/hash';
import { pointIgnition, syntheticScenario } from './testing/scenarios';

afterEach(() => vi.restoreAllMocks());

const scenarioFor = (tier: 'fast' | 'standard') => syntheticScenario({ extent: 2400, cellSize: 30, ignitions: [pointIgnition('a', -300, 0, 0, 60)], options: { tier, snapshotInterval: 300, maxEmbers: 600 } });

function fresh(tier: 'fast' | 'standard', seconds: number): SimSnapshot[] {
  const snaps: SimSnapshot[] = [];
  const sim = new Simulation(scenarioFor(tier), { hooks: { snapshot: (s) => snaps.push(s) } });
  sim.advance(seconds);
  return snaps;
}
/** A run of the unmodified engine, kept: the standard tier's spin-up makes it the slow part of this file. */
const runs = new Map<string, SimSnapshot[]>();
function run(tier: 'fast' | 'standard', seconds: number): SimSnapshot[] {
  const key = `${tier}:${seconds}`;
  if (!runs.has(key)) runs.set(key, fresh(tier, seconds));
  return runs.get(key)!;
}

describe('every snapshot of both tiers carries the stamped air view', () => {
  it('fast tier: a diagnosed terrain-following wind volume, with the air’s own time', { timeout: 120_000 }, () => {
    const snaps = run('fast', 900);
    expect(snaps.map((s) => s.time)).toEqual([300, 600, 900]);
    for (const s of snaps) {
      const a = s.atmosphere!;
      expect(airKind(a)).toBe('diagnosed');
      expect(airLayout(a)).toBe('terrain-following');
      expect(a.time).toBe(s.time);
      expect(a.topM).toBeGreaterThanOrEqual(3000);
      expect(Number.isFinite(a.baseM)).toBe(true);
      expect(a.nz).toBeGreaterThan(1);
      expect(hasAirWind(a)).toBe(true);
      expect(airHas(a, 'theta')).toBe(false);
      expect(airHas(a, 'smoke')).toBe(false);
    }
  });

  it('standard tier: the time-stepped air as a terrain-following volume, with the air’s own time', { timeout: 300_000 }, () => {
    const snaps = run('standard', 600);
    expect(snaps.map((s) => s.time)).toEqual([300, 600]);
    for (const s of snaps) {
      const a = s.atmosphere!;
      expect(airKind(a)).toBe('prognostic');
      expect(airLayout(a)).toBe('terrain-following');
      expect(a.time).toBe(s.time);
      expect(airHas(a, 'wind') && airHas(a, 'theta') && airHas(a, 'smoke')).toBe(true);
    }
  });
});

describe('the view never feeds back into the simulation (ground rule 1)', () => {
  /** Everything of a snapshot except the air view itself, as per-part hashes. */
  const withoutAir = (s: SimSnapshot): Record<string, number> => {
    const h = snapshotPartHashes(s);
    delete h['atmosphere'];
    return h;
  };
  const legacyShape = (v: AtmosphereView): AtmosphereView => {
    const { layout: _l, kind: _k, topM: _t, baseM: _b, time: _time, ...rest } = v;
    return rest;
  };

  for (const tier of ['fast', 'standard'] as const) {
    it(`${tier}: the same results with the new fields stripped from every view, and with every view read twice`, { timeout: 300_000 }, () => {
      const secs = tier === 'fast' ? 900 : 600;
      const plain = run(tier, secs);
      const Engine = (tier === 'fast' ? DiagnosticWind : Atmosphere) as unknown as { prototype: { view(): AtmosphereView } };
      const orig = Engine.prototype.view;
      let calls = 0;
      // Without the new fields: the view an older engine made (the stamp of `time` is stripped again after makeSnapshot too).
      const spy = vi.spyOn(Engine.prototype, 'view').mockImplementation(function (this: { view(): AtmosphereView }) {
        calls++;
        orig.call(this); // read twice: reading must change nothing
        return legacyShape(orig.call(this));
      });
      const stripped = fresh(tier, secs).map((s) => ({ ...s, atmosphere: s.atmosphere ? legacyShape(s.atmosphere) : s.atmosphere }));
      expect(calls).toBeGreaterThanOrEqual(plain.length);
      spy.mockRestore();
      expect(stripped.length).toBe(plain.length);
      for (let i = 0; i < plain.length; i++) {
        expect(withoutAir(stripped[i] as SimSnapshot), `snapshot at ${plain[i]!.time}`).toEqual(withoutAir(plain[i]!));
      }
      // The comparison is not vacuous: the air parts do differ (the fields are there in one run and not in the other).
      expect(snapshotPartHashes(stripped[0] as SimSnapshot)['atmosphere']).not.toBe(snapshotPartHashes(plain[0]!)['atmosphere']);
    });
  }

  it('two fresh runs give the same view bytes, new fields included', { timeout: 120_000 }, () => {
    const a = run('fast', 600);
    const b = run('fast', 600);
    for (let i = 0; i < a.length; i++) expect(snapshotPartHashes(a[i]!)['atmosphere']).toBe(snapshotPartHashes(b[i]!)['atmosphere']);
  });
});

describe('decimateView (large domains halve the columns)', () => {
  const snapOf = (tier: 'fast' | 'standard'): AtmosphereView => run(tier, 300)[0]!.atmosphere!;

  it('carries the layout, kind, top, datum and time, and halves the columns of a diagnosed view with empty temperature and smoke', { timeout: 120_000 }, () => {
    const v = snapOf('fast');
    const d = decimateView(v);
    expect(d.layout).toBe('terrain-following');
    expect(d.kind).toBe('diagnosed');
    expect(d.topM).toBe(v.topM);
    expect(d.baseM).toBe(v.baseM);
    expect(d.time).toBe(v.time);
    expect(d.nz).toBe(v.nz);
    expect(d.grid.cellSize).toBe(2 * v.grid.cellSize);
    const plane2 = d.grid.nx * d.grid.ny;
    expect(plane2).toBe(Math.ceil(v.grid.nx / 2) * Math.ceil(v.grid.ny / 2));
    expect(d.u.length).toBe(plane2 * v.nz);
    expect(d.w.length).toBe(plane2 * v.nz);
    expect(d.thetaAnomaly.length).toBe(0);
    expect(d.smoke.length).toBe(0);
    expect(airHas(d, 'wind')).toBe(true);
    expect(airHas(d, 'theta')).toBe(false);
    expect(d.terrainHeight.length).toBe(plane2);
    // Fresh arrays: nothing shared with the input (transfer detaches them).
    expect(d.u.buffer).not.toBe(v.u.buffer);
    expect(d.levels.buffer).not.toBe(v.levels.buffer);
    // Block means of a terrain-following view keep its meaning: the first level of a block is the mean of its four columns'.
    const i = 3;
    const j = 4;
    const nx = v.grid.nx;
    const mean = (f: Float32Array, k: number): number => (f[k * v.grid.nx * v.grid.ny + 2 * j * nx + 2 * i]! + f[k * v.grid.nx * v.grid.ny + 2 * j * nx + 2 * i + 1]! + f[k * v.grid.nx * v.grid.ny + (2 * j + 1) * nx + 2 * i]! + f[k * v.grid.nx * v.grid.ny + (2 * j + 1) * nx + 2 * i + 1]!) / 4;
    expect(d.u[0 * plane2 + j * d.grid.nx + i]).toBeCloseTo(mean(v.u, 0), 4);
    expect(d.v[5 * plane2 + j * d.grid.nx + i]).toBeCloseTo(mean(v.v, 5), 4);
  });

  it('carries the fields of the time-stepped 3-D view and keeps every array', { timeout: 300_000 }, () => {
    const v = snapOf('standard');
    const d = decimateView(v);
    expect([d.layout, d.kind, d.topM, d.baseM, d.time]).toEqual([v.layout, v.kind, v.topM, v.baseM, v.time]);
    const plane2 = d.grid.nx * d.grid.ny;
    for (const k of ['u', 'v', 'w', 'thetaAnomaly', 'smoke'] as const) expect(d[k].length, k).toBe(plane2 * v.nz);
    expect(airKind(d)).toBe('prognostic');
  });

  it('leaves a view made before the new fields existed without them', () => {
    const grid = { ...run('fast', 300)[0]!.atmosphere!.grid };
    const n = grid.nx * grid.ny;
    const legacy: AtmosphereView = { grid, nz: 0, levels: new Float32Array(0), terrainHeight: new Float32Array(n), surfaceU: new Float32Array(n), surfaceV: new Float32Array(n), u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0), thetaAnomaly: new Float32Array(0), smoke: new Float32Array(0) };
    const d = decimateView(legacy);
    expect(Object.keys(d)).not.toEqual(expect.arrayContaining(['layout']));
    expect('kind' in d || 'topM' in d || 'baseM' in d || 'time' in d).toBe(false);
    expect(airKind(d)).toBe('surface');
  });
});

describe('snapshotTransferables lists the diagnosed volume', () => {
  it('fast tier: the u, v and w buffers are listed once each, the empty temperature and smoke are not', { timeout: 120_000 }, () => {
    const s = run('fast', 300)[0]!;
    const a = s.atmosphere!;
    const list = snapshotTransferables(s);
    expect(new Set(list).size).toBe(list.length);
    for (const f of [a.levels, a.terrainHeight, a.surfaceU, a.surfaceV, a.u, a.v, a.w]) expect(list).toContain(f.buffer);
    expect(a.thetaAnomaly.byteLength + a.smoke.byteLength).toBe(0);
    // Three more buffers than a view with no volume would have had.
    const bare = { ...s, atmosphere: { ...a, u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0) } } as SimSnapshot;
    expect(list.length - snapshotTransferables(bare).length).toBe(3);
  });

  for (const tier of ['fast', 'standard'] as const) {
    it(`${tier}: a worker round trip (transfer list, structured clone) keeps every field, and the sender's arrays detach`, { timeout: 300_000 }, () => {
      const s = fresh(tier, 300)[0]!; // not the cached run: a transfer detaches the sender's arrays
      const a = s.atmosphere!;
      const keys = ['levels', 'terrainHeight', 'surfaceU', 'surfaceV', 'u', 'v', 'w', 'thetaAnomaly', 'smoke'] as const;
      const before = Object.fromEntries(keys.map((k) => [k, a[k].slice()])) as Record<(typeof keys)[number], Float32Array>;
      const scalars = [a.layout, a.kind, a.topM, a.baseM, a.time, a.nz];
      const received = structuredClone(s, { transfer: snapshotTransferables(s) }).atmosphere!;
      expect([received.layout, received.kind, received.topM, received.baseM, received.time, received.nz]).toEqual(scalars);
      expect(received.grid).toEqual(a.grid);
      for (const k of keys) {
        expect(Buffer.from(received[k].buffer).equals(Buffer.from(before[k].buffer)), k).toBe(true);
        expect(received[k].length, k).toBe(before[k].length);
      }
      // The listed buffers moved: the sender's views of the big arrays are empty now (a snapshot is not reused after posting).
      expect(a.u.byteLength + a.v.byteLength + a.w.byteLength).toBe(0);
      expect(received.u.byteLength).toBeGreaterThan(0);
      // And the received view is still a working air view.
      expect(airKind(received)).toBe(tier === 'fast' ? 'diagnosed' : 'prognostic');
      expect(hasAirWind(received)).toBe(true);
    });
  }
});

describe('the history keeps the diagnosed wind packed (display only: the live view and the engine stay exact)', () => {
  /** The three snapshots of the fast run, in a store with room for everything: the first two become keyframes, the last is the live one. */
  const stored = (): { store: SnapshotStore; snaps: SimSnapshot[] } => {
    const snaps = run('fast', 900);
    const store = new SnapshotStore({ maxBytes: 1e9, minInterval: 300 });
    for (const s of snaps) store.push(s);
    return { store, snaps };
  };

  it('a restored view is within the stated bound of the exact one in every field, and carries the same layout, kind, top, datum and time', { timeout: 120_000 }, () => {
    const { store, snaps } = stored();
    expect(store.windFrameCount).toBe(2);
    const report: string[] = [];
    for (const [i, exact] of [snaps[0]!.atmosphere!, snaps[1]!.atmosphere!].entries()) {
      const got = store.at(snaps[i]!.time)!.atmosphere!;
      const bound = windPackErrorBound(packWind(exact.u, exact.v, exact.w)!);
      const worst = (a: Float32Array, b: Float32Array): number => a.reduce((m, x, k) => Math.max(m, Math.abs(x - b[k]!)), 0);
      const diff = [worst(got.u, exact.u), worst(got.v, exact.v), worst(got.w, exact.w)];
      expect(diff[0]!, 'u').toBeLessThanOrEqual(bound[0]);
      expect(diff[1]!, 'v').toBeLessThanOrEqual(bound[1]);
      expect(diff[2]!, 'w').toBeLessThanOrEqual(bound[2]);
      // The numbers a reader can hold the claim to: well under a millimetre per second, for winds of metres per second.
      for (const d of diff) expect(d).toBeLessThan(0.001);
      const peak = (f: Float32Array): number => f.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      report.push(`t=${snaps[i]!.time}: worst difference u ${diff[0]!.toExponential(2)}, v ${diff[1]!.toExponential(2)}, w ${diff[2]!.toExponential(2)} m/s (bounds ${bound.map((b) => b.toExponential(2)).join(', ')}; largest |u|, |v|, |w| ${peak(exact.u).toFixed(2)}, ${peak(exact.v).toFixed(2)}, ${peak(exact.w).toFixed(2)} m/s)`);
      // Everything else of the view is the exact one, and the air says it is of its own time.
      expect([got.layout, got.kind, got.topM, got.baseM, got.time, got.nz]).toEqual([exact.layout, exact.kind, exact.topM, exact.baseM, exact.time, exact.nz]);
      expect(got.grid).toEqual(exact.grid);
      for (const k of ['levels', 'terrainHeight', 'surfaceU', 'surfaceV'] as const) expect(got[k], k).toEqual(exact[k]);
      expect(got.u.length).toBe(exact.u.length);
      expect(hasAirWind(got)).toBe(true);
      expect(airKind(got)).toBe('diagnosed');
      expect(airHas(got, 'theta') || airHas(got, 'smoke')).toBe(false);
    }
    // eslint-disable-next-line no-console
    console.log(`[history wind] real fast-tier views (2.4 km synthetic site, 24 x 24 x 20):\n  ${report.join('\n  ')}`);
  });

  it('the sampler reads a restored view like the exact one: any wind it gives is within the same bound', { timeout: 120_000 }, () => {
    const { store, snaps } = stored();
    const exact = snaps[0]!.atmosphere!;
    const got = store.at(snaps[0]!.time)!.atmosphere!;
    const bound = windPackErrorBound(packWind(exact.u, exact.v, exact.w)!);
    const base = exact.baseM!;
    const a = new AtmosphereSampler(exact, base, null);
    const b = new AtmosphereSampler(got, base, null);
    expect(b.hasWind).toBe(true);
    const g = exact.grid;
    const pos = new Float64Array(3);
    const x = new Float32Array(3);
    const y = new Float32Array(3);
    let s = 7;
    const rnd = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const worst = [0, 0, 0];
    for (let n = 0; n < 4000; n++) {
      pos[0] = g.x0 + rnd() * (g.nx - 1) * g.cellSize;
      pos[1] = g.y0 + rnd() * (g.ny - 1) * g.cellSize;
      pos[2] = base + rnd() * exact.topM!; // from the datum to the model top: below the ground included
      a.windP(pos, x);
      b.windP(pos, y);
      for (let c = 0; c < 3; c++) worst[c] = Math.max(worst[c]!, Math.abs(x[c]! - y[c]!));
    }
    // A sampled wind is a mix of stored values with weights that add up to 1, so it is off by at most what the stored values are
    // (the sampler hands back Float32: allow the rounding of one).
    for (let c = 0; c < 3; c++) expect(worst[c]!, `component ${c}`).toBeLessThanOrEqual(bound[c]! + 1e-5);
    expect(worst[0]!).toBeGreaterThan(0); // not vacuous: the restored view is not the exact one
    // eslint-disable-next-line no-console
    console.log(`[history wind] 4000 sampled points: worst difference u ${worst[0]!.toExponential(2)}, v ${worst[1]!.toExponential(2)}, w ${worst[2]!.toExponential(2)} m/s`);
  });

  it('the newest picture is the live snapshot itself, bit for bit: only older pictures are restored', { timeout: 120_000 }, () => {
    const { store, snaps } = stored();
    const head = store.latest()!;
    expect(head).toBe(snaps[2]);
    expect(head.atmosphere).toBe(snaps[2]!.atmosphere);
    const n = head.atmosphere!.grid.nx * head.atmosphere!.grid.ny * head.atmosphere!.nz;
    expect(head.atmosphere!.u.byteLength).toBe(4 * n); // the live view keeps its Float32 volume
    // Older pictures are not the engine's arrays: the keyframe holds its own copy and the engine's snapshot is left as it was.
    const old = store.at(snaps[0]!.time)!.atmosphere!;
    expect(old.u).not.toBe(snaps[0]!.atmosphere!.u);
    expect(snaps[0]!.atmosphere!.u.length).toBe(n);
  });
});
