/**
 * The history of a 6 h FAST-tier run on a weak phone (fix F1 of the 0.4.0 list): real Katoomba snapshots (40 000 fire cells, the
 * fast tier's diagnosed 3-D wind, 45 x 45 x 20) replayed over 6 h into a store at the budgets the device classes get (ui/session.ts
 * `defaultSnapshotBudget`: 48 MiB at 0.5 GB, 61.4 MiB at 1 GB, 122.9 MiB at 2 GB; 64 MiB is the figure of the older table).
 *
 * Two stores see the same snapshots: the "0.3.0" one gets them WITHOUT the 3-D wind (u, v, w emptied: a 0.3.0 fast keyframe is
 * 824,556 B and the store treats it as it did then), the other gets them as the engine makes them now (12 bytes per cell more in
 * every air view). The wind must not cost the history its pictures: the keyframe count and the longest gap are the 0.3.0 ones to
 * within the sawtooth of the thinning (the count falls when the budget is reached and grows back until the next time; the table
 * therefore also gives the last hour, one instant every 5 min, not only the 6 h instant). Run it alone to see the table:
 *   npx vitest run src/ui/snapshotStore.fast6h.sim.test.ts --reporter=verbose --silent=false
 * and, for what a restored view differs by, the second test.
 */
import { describe, expect, it } from 'vitest';
import { packWind, windPackErrorBound } from '../core/airPack';
import { airAgeS, hasAirWind } from '../core/airView';
import type { AtmosphereView, SimSnapshot } from '../core/types';
import { Simulation } from '../sim/simulation';
import { demoScenario, pointIgnition, withIgnitions } from '../sim/testing/scenarios';
import { SnapshotStore, keyframeBytes } from './snapshotStore';

const MIB = 1048576;
const EMPTY = new Float32Array(0);
/** The budgets of the device classes: 0.5 GB, 1 GB, the older table's 64 MiB, 2 GB (`defaultSnapshotBudget`). */
const BUDGETS_MIB = [48, 61.44, 64, 122.88];
const STEP = 60;
const HOURS = 6;

/** The air view as 0.3.0's fast tier made it: no 3-D wind. */
const without3d = (a: AtmosphereView): AtmosphereView => ({ ...a, u: EMPTY, v: EMPTY, w: EMPTY });

interface Row {
  keyframes: number;
  meanGapMin: number;
  maxGapMin: number;
  /** Bytes of a keyframe with the wind volume it carries, on average. */
  keyframeBytes: number;
  totalMiB: number;
  windFrames: number;
  /** Share of the pictures along the scrubber (one per minute) that carry a 3-D wind, and the oldest air shown (min before the picture). */
  windShare: number;
  maxAirAgeMin: number;
  /** The keyframes and the longest gap (min) at every 5 min of the last hour of the run: the count is a sawtooth, so one instant is a lottery. */
  last: { keyframes: number[]; maxGapMin: number[] };
}

const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

function maxGap(times: number[]): number {
  let g = 0;
  for (let i = 1; i < times.length; i++) g = Math.max(g, times[i]! - times[i - 1]!);
  return g / 60;
}

function replay(seed: SimSnapshot[], template: SimSnapshot, budget: number, strip: boolean): Row {
  const store = new SnapshotStore({ maxBytes: budget, minInterval: STEP });
  const n = Math.round((HOURS * 3600) / STEP);
  const last = { keyframes: [] as number[], maxGapMin: [] as number[] };
  for (let i = 0; i <= n; i++) {
    const src = seed[i % seed.length]!;
    const t = i * STEP;
    const air = { ...src.atmosphere!, time: t };
    // The same arrays every time (no extra memory in the test), advancing time, a stamped air view.
    store.push({ ...src, time: t, stats: { ...src.stats, time: t }, fire: template.fire, insights: [], atmosphere: strip ? without3d(air) : air });
    if (t > (HOURS - 1) * 3600 && t % 300 === 0) {
      last.keyframes.push(store.keyframeCount);
      last.maxGapMin.push(maxGap(store.keyframeTimes()));
    }
  }
  let wind = 0;
  let maxAge = 0;
  let shown = 0;
  for (let t = 0; t <= n * STEP; t += 60) {
    const view = store.at(t)!.atmosphere;
    shown++;
    if (hasAirWind(view)) {
      wind++;
      maxAge = Math.max(maxAge, airAgeS(view, t) ?? 0);
    }
  }
  return {
    keyframes: store.keyframeCount,
    meanGapMin: store.keyframeSpacing / 60,
    maxGapMin: maxGap(store.keyframeTimes()),
    keyframeBytes: store.keyframeBytes / Math.max(1, store.keyframeCount),
    totalMiB: store.totalBytes / MIB,
    windFrames: store.windFrameCount,
    windShare: wind / shown,
    maxAirAgeMin: maxAge / 60,
    last,
  };
}

/** Six real snapshots of a fast-tier run on the Katoomba demo site (6 km, 40 000 fire cells), the seed of every replay. */
async function realSnapshots(): Promise<SimSnapshot[]> {
  const base = await demoScenario({ startCivil: [2025, 12, 20, 14], extent: 6000, tier: 'fast', duration: 0.75 * 3600 });
  const sc = withIgnitions(base, [pointIgnition('escarpment', -2170, 900, 0, 60)], { snapshotInterval: STEP, tier: 'fast' });
  const real: SimSnapshot[] = [];
  const sim = new Simulation(sc, { tier: 'fast', hooks: { snapshot: (s: SimSnapshot) => real.push(s) } });
  sim.advance(0.75 * 3600);
  return real;
}

describe('6 h of fast-tier history under the budgets of weak phones', () => {
  it('keeps the pictures 0.3.0 kept (count, longest gap) and a 3-D wind for every picture', { timeout: 900_000 }, async () => {
    const real = await realSnapshots();
    const template = real[real.length - 1]!;
    const seed = real.slice(-6);
    expect(template.fire.arrivalTime.length).toBeGreaterThan(20000);
    const a = template.atmosphere!;
    expect(a.kind).toBe('diagnosed');
    const rows: string[] = [
      `6 h fast-tier history, ${template.fire.arrivalTime.length} fire cells, ${a.grid.nx} x ${a.grid.ny} x ${a.nz} wind volume, display step ${STEP} s, keyframes every 300 s; keyframe of 0.3.0 ${keyframeBytes({ ...template, atmosphere: without3d(a) }).toLocaleString('en-AU')} B, as the engine publishes it now ${keyframeBytes(template).toLocaleString('en-AU')} B`,
      'budget MiB | build   | keyframes | mean gap min | max gap min | keyframe B | store MiB | wind volumes | pictures with wind | oldest air min | last hour: keyframes min / mean, longest gap min',
    ];
    const pairs: [number, Row, Row][] = [];
    for (const mib of BUDGETS_MIB) {
      const old = replay(seed, template, mib * MIB, true);
      const now = replay(seed, template, mib * MIB, false);
      const line = (name: string, r: Row): string =>
        `${mib.toFixed(2).padStart(10)} | ${name} | ${String(r.keyframes).padStart(9)} | ${r.meanGapMin.toFixed(1).padStart(12)} | ${r.maxGapMin.toFixed(1).padStart(11)} | ${Math.round(r.keyframeBytes).toLocaleString('en-AU').padStart(10)} | ${r.totalMiB.toFixed(1).padStart(9)} | ${String(r.windFrames).padStart(12)} | ${(100 * r.windShare).toFixed(0).padStart(17)}% | ${r.maxAirAgeMin.toFixed(0).padStart(14)} | ${Math.min(...r.last.keyframes)} / ${mean(r.last.keyframes).toFixed(1)}, ${Math.max(...r.last.maxGapMin).toFixed(0)}`;
      rows.push(line('0.3.0  ', old), line('now    ', now));
      pairs.push([mib, old, now]);
    }
    // eslint-disable-next-line no-console
    console.log(rows.join('\n'));
    for (const [mib, old, now] of pairs) {
      const at = `${mib} MiB`;
      // No picture is lost to the wind beyond the sawtooth. The volume held whole in every keyframe kept 0.6 of the 0.3.0 count with a longest
      // gap 4 times as long at 48 to 64 MiB; now it is within about 5 % on average over the last hour. The bounds leave room for the
      // sawtooth (one instant is partly luck, and the gaps come in steps of 2: 5, 10, 20, 40 min), none for the 0.6.
      expect(now.keyframes, `${at}: keyframes at the 6 h instant`).toBeGreaterThanOrEqual(0.85 * old.keyframes);
      expect(now.maxGapMin, `${at}: longest gap at the 6 h instant`).toBeLessThanOrEqual(2 * old.maxGapMin);
      expect(Math.max(...now.last.maxGapMin), `${at}: longest gap in the last hour`).toBeLessThanOrEqual(2 * Math.max(...old.last.maxGapMin));
      expect(mean(now.last.keyframes), `${at}: mean keyframes in the last hour`).toBeGreaterThanOrEqual(0.85 * mean(old.last.keyframes));
      expect(Math.min(...now.last.keyframes), `${at}: fewest keyframes in the last hour`).toBeGreaterThanOrEqual(Math.min(...old.last.keyframes) - 3);
      // The store is within its budget, and every picture of the run has a 3-D wind, from the newest saved volume at or before it.
      expect(now.totalMiB, `${at}: store size`).toBeLessThanOrEqual(mib);
      expect(now.windShare, `${at}: pictures with a wind`).toBe(1);
      expect(now.windFrames, `${at}: volumes kept`).toBeGreaterThanOrEqual(5);
      // A keyframe with its wind is about 5 % heavier than the 0.3.0 one where the budget thins (the volumes are a share of the budget
      // of their own, held at 4 %), and 30 % where nothing is thinned (the wind, packed, is on every keyframe).
      expect(now.keyframeBytes / old.keyframeBytes, `${at}: keyframe growth`).toBeLessThanOrEqual(now.windFrames === now.keyframes ? 1.31 : 1.1);
    }
    // At 2 GB nothing is thinned: every keyframe has its own volume, at most one keyframe interval older than the picture.
    const big = pairs.find(([m]) => m === 122.88)![2];
    expect([big.keyframes, big.windFrames]).toEqual([72, 72]);
    expect(big.maxAirAgeMin).toBeLessThan(5);
  });

  it('what a restored view of the real 6 km site differs from the exact one by (m/s), by the field and through the sampler’s points', { timeout: 900_000 }, async () => {
    const real = await realSnapshots();
    const store = new SnapshotStore({ maxBytes: 1e9, minInterval: STEP });
    for (const s of real) store.push(s);
    // A keyframe time of the replay (the first snapshot, then every 300 s): its picture carries the volume of exactly that time.
    const snap = real.find((s) => s.time === 2460)!;
    const exact = snap.atmosphere!;
    const got = store.at(snap.time)!.atmosphere!;
    expect(got.time).toBe(exact.time);
    const bound = windPackErrorBound(packWind(exact.u, exact.v, exact.w)!);
    const worst = (x: Float32Array, y: Float32Array): number => x.reduce((m, v, k) => Math.max(m, Math.abs(v - y[k]!)), 0);
    const peak = (f: Float32Array): number => f.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const diff = [worst(got.u, exact.u), worst(got.v, exact.v), worst(got.w, exact.w)];
    // eslint-disable-next-line no-console
    console.log(`restored vs exact, ${exact.grid.nx} x ${exact.grid.ny} x ${exact.nz} at t=${exact.time}: worst difference u ${diff[0]!.toExponential(2)}, v ${diff[1]!.toExponential(2)}, w ${diff[2]!.toExponential(2)} m/s; bounds ${bound.map((b) => b.toExponential(2)).join(', ')}; largest |u|, |v|, |w| ${peak(exact.u).toFixed(2)}, ${peak(exact.v).toFixed(2)}, ${peak(exact.w).toFixed(2)} m/s`);
    for (let c = 0; c < 3; c++) expect(diff[c]!).toBeLessThanOrEqual(bound[c]!);
    for (const d of diff) expect(d).toBeLessThan(0.001);
  });
});
