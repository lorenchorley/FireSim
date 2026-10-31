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
 *
 * 0.7.0: every real snapshot also carries the wind the fire feels (`fireWind`, 40,064 B at 6 km: a keyframe holds it, 4.6 % of 0.86 MB). Both
 * stores above carry it (so the comparison still isolates the 3-D volume, and the "0.3.0" keyframe is 40,064 B above its old 824,6xx B). A third
 * replay of the current build without it measures what it costs the history: the table's "no E2" rows.
 */
import { describe, expect, it } from 'vitest';
import { packWind, windPackErrorBound } from '../core/airPack';
import { airAgeS, hasAirWind } from '../core/airView';
import { fireWindBytes } from '../core/fireWind';
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
/** The budgets (MiB) the sweep tries: 44 to 70 in steps of 2, and the four the verifier found failing the old last-hour bound (58.5, 59.5, 60.5, 62). */
const SWEEP_MIB = [44, 46, 48, 50, 52, 54, 56, 58, 58.5, 59.5, 60.5, 62, 64, 66, 68, 70];
/**
 * The least ratio of the 3 h mean of kept keyframes (with the fire-wind picture) to that of the run without it that holds at EVERY budget of the sweep. MEASURED (the
 * table the sweep test prints): 0.868 at 59.5 MiB is the worst, then 0.874 (60.5), 0.881 (58.5), 0.891 (62.0), and 0.954 to 0.993 at the other twelve; the mean over the
 * sixteen is 0.952 (`SWEEP_RATIO_MEAN`). 0.85 is the worst rounded down to the figure the verifier asked for; the 0.9 of the old last-hour bound is not true at four of them.
 */
const SWEEP_RATIO_FLOOR = 0.85;
/** The mean of the sweep's ratios: the picture costs a few percent of the keyframes on average (4.6 % heavier keyframes), and the sawtooth's luck evens out over the budgets. */
const SWEEP_RATIO_MEAN = 0.93;

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
  /** The keyframes at every 5 min of the last 3 h: the window the sweep's statistical bound reads (36 instants: the count swings between 33 and 58 within one hour at some budgets, so three hours span several swings). */
  last3h: number[];
}

const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

function maxGap(times: number[]): number {
  let g = 0;
  for (let i = 1; i < times.length; i++) g = Math.max(g, times[i]! - times[i - 1]!);
  return g / 60;
}

/** `quick` skips the 361 reads of the air along the scrubber (the sweep only counts keyframes and bytes): the air rows of a quick replay are 0. */
function replay(seed: SimSnapshot[], template: SimSnapshot, budget: number, strip: boolean, fireWind = true, quick = false): Row {
  const store = new SnapshotStore({ maxBytes: budget, minInterval: STEP });
  const n = Math.round((HOURS * 3600) / STEP);
  const last = { keyframes: [] as number[], maxGapMin: [] as number[] };
  const last3h: number[] = [];
  for (let i = 0; i <= n; i++) {
    const src = seed[i % seed.length]!;
    const t = i * STEP;
    const air = { ...src.atmosphere!, time: t };
    const { fireWind: _picture, ...withoutE2 } = src;
    // The same arrays every time (no extra memory in the test), advancing time, a stamped air view.
    store.push({ ...(fireWind ? src : withoutE2), time: t, stats: { ...src.stats, time: t }, fire: template.fire, insights: [], atmosphere: strip ? without3d(air) : air });
    if (t > (HOURS - 1) * 3600 && t % 300 === 0) {
      last.keyframes.push(store.keyframeCount);
      last.maxGapMin.push(maxGap(store.keyframeTimes()));
    }
    if (t > (HOURS - 3) * 3600 && t % 300 === 0) last3h.push(store.keyframeCount);
  }
  let wind = 0;
  let maxAge = 0;
  let shown = 0;
  for (let t = 0; !quick && t <= n * STEP; t += 60) {
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
    windShare: shown ? wind / shown : 0,
    maxAirAgeMin: maxAge / 60,
    last,
    last3h,
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
    const e2: [number, Row, Row][] = [];
    for (const mib of BUDGETS_MIB) {
      const old = replay(seed, template, mib * MIB, true);
      const now = replay(seed, template, mib * MIB, false);
      const noE2 = replay(seed, template, mib * MIB, false, false);
      const line = (name: string, r: Row): string =>
        `${mib.toFixed(2).padStart(10)} | ${name} | ${String(r.keyframes).padStart(9)} | ${r.meanGapMin.toFixed(1).padStart(12)} | ${r.maxGapMin.toFixed(1).padStart(11)} | ${Math.round(r.keyframeBytes).toLocaleString('en-AU').padStart(10)} | ${r.totalMiB.toFixed(1).padStart(9)} | ${String(r.windFrames).padStart(12)} | ${(100 * r.windShare).toFixed(0).padStart(17)}% | ${r.maxAirAgeMin.toFixed(0).padStart(14)} | ${Math.min(...r.last.keyframes)} / ${mean(r.last.keyframes).toFixed(1)}, ${Math.max(...r.last.maxGapMin).toFixed(0)}`;
      rows.push(line('0.3.0  ', old), line('now    ', now), line('no E2  ', noE2));
      pairs.push([mib, old, now]);
      e2.push([mib, noE2, now]);
    }
    // eslint-disable-next-line no-console
    console.log(rows.join('\n'));
    for (const [mib, old, now] of pairs) {
      const at = `${mib} MiB`;
      // No picture is lost to the wind beyond the sawtooth. The volume held whole in every keyframe kept 0.6 of the 0.3.0 count with a longest
      // gap 4 times as long at 48 to 64 MiB; now it is within about 5 % on average over the last hour. The bounds leave room for the
      // sawtooth (one instant is partly luck, and the gaps come in steps of 2: 5, 10, 20, 40 min), none for the 0.6. The count at the one 6 h
      // instant is held against the fewest the 0.3.0 store had in the last hour, not against its count at that instant: the keyframes of both
      // stores are 4.6 % heavier since 0.7.0 (the wind the fire feels), which moves where each one's thinning peaks and troughs fall (at 61.44 MiB
      // the 0.3.0 store was at a peak of 41 at the 6 h instant and the current one at a trough of 33; the means over the hour are 40.7 and 50.4).
      expect(now.keyframes, `${at}: keyframes at the 6 h instant`).toBeGreaterThanOrEqual(0.85 * Math.min(old.keyframes, ...old.last.keyframes));
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
    // What the wind the fire feels costs the history of a weak phone: each keyframe is its 40,064 B heavier (so 4.6 % fewer fit once the budget
    // thins), which shows as a few percent fewer keyframes on average and nothing at 2 GB. The table above shows it at these four budgets; what is
    // PINNED about it is the arithmetic and, across a sweep of budgets, the statistics (the next two tests). A bound on one hour at four budgets is
    // a lottery: the count is a sawtooth that flips between 33 and 58 within 1 % of the budget, with the picture and without it.
    const picture = template.fireWind!;
    expect(picture.u.length).toBe(100 * 100); // 6 km at 30 m: 200 x 200 fire cells in blocks of 2
    expect(keyframeBytes(template) - keyframeBytes({ ...template, fireWind: undefined })).toBe(fireWindBytes(picture));
    expect(fireWindBytes(picture)).toBe(40_064);
    for (const [mib, noE2, now] of e2) {
      const at = `${mib} MiB`;
      expect(now.totalMiB, `${at}: store size`).toBeLessThanOrEqual(mib);
      expect(noE2.totalMiB, `${at}: store size without it`).toBeLessThanOrEqual(mib);
      if (mib >= 122) expect([now.keyframes, now.maxGapMin]).toEqual([noE2.keyframes, noE2.maxGapMin]);
    }
    // At 2 GB nothing is thinned: every keyframe has its own volume, at most one keyframe interval older than the picture.
    const big = pairs.find(([m]) => m === 122.88)![2];
    expect([big.keyframes, big.windFrames]).toEqual([72, 72]);
    expect(big.maxAirAgeMin).toBeLessThan(5);
  });

  /**
   * What the wind the fire feels costs a weak phone's history, as arithmetic and as statistics (0.7.0, raster verifier F2). The first is exact: a kept keyframe holds
   * the picture's `fireWind`, 40,064 B at 6 km, and nothing else changes in it. The second is not: how many keyframes the thinning keeps is a SAWTOOTH of the budget
   * (it grows until the budget is reached, then falls back by a third or more), so the count at one instant, or the mean over the last hour at four budgets, is a
   * lottery: the verifier swept 44 to 70 MiB and found the count of kept 6 h instants flipping between 33 and 58 within 1 % of the budget even WITHOUT the picture, and
   * the bound "the last hour's mean is 0.9 of the run without it" failing at 58.5 to 60.5 and 62.0 MiB (0.69 to 0.80). What holds at every budget is the mean over
   * 3 h of 5 min instants (36 of them, which span several swings of the sawtooth: it goes from 33 to 58 within an hour at 61.44 MiB): a bound on that, over sixteen budgets, is the honest one.
   */
  it('the wind the fire feels: a kept keyframe is exactly 40,064 B heavier, the total never exceeds the budget, and over a sweep of budgets the 3 h mean of kept keyframes holds', { timeout: 1_800_000 }, async () => {
    const real = await realSnapshots();
    const template = real[real.length - 1]!;
    const seed = real.slice(-6);
    // (a) the arithmetic: one keyframe of the current build with and without the picture, in the store and by the model's own count.
    const picture = template.fireWind!;
    expect(fireWindBytes(picture)).toBe(40_064);
    const heavier = keyframeBytes(template) - keyframeBytes({ ...template, fireWind: undefined });
    expect(heavier).toBe(40_064);
    const oneKeyframe = (fireWind: boolean): number => {
      const { fireWind: _picture, ...bare } = template;
      const store = new SnapshotStore({ maxBytes: 1e9, minInterval: STEP });
      // A keyframe is made when the newest picture gives way to the next one: two pushes, one keyframe (the first picture's).
      for (const t of [0, STEP]) store.push({ ...(fireWind ? template : bare), time: t, stats: { ...template.stats, time: t }, insights: [] });
      expect(store.keyframeCount).toBe(1);
      return store.keyframeBytes;
    };
    const alone = oneKeyframe(false);
    expect(oneKeyframe(true) - alone, 'the store holds exactly the picture more in a keyframe').toBe(40_064);
    // The keyframe a thinned store keeps shares its wind volume with its neighbours: the model's count of it (the 0.3.0 keyframe, no 3-D wind, with the picture) is
    // 864,700 B, so the picture is 4.6 % of it (4.9 % of the 824,636 B it was without it). A keyframe that carries its own packed volume is 1.07 MB, 3.8 %.
    const thinned = keyframeBytes({ ...template, atmosphere: without3d(template.atmosphere!) });
    const share = 40_064 / thinned;
    expect(thinned).toBe(864_700);
    expect(share, 'about 4.6 % of the keyframe a thinned store keeps').toBeGreaterThan(0.046);
    expect(share).toBeLessThan(0.047);
    const kept = thinned - 40_064;
    // (b) the sweep.
    const rows: string[] = [`${HOURS} h, 3 h window of ${STEP * 5} s instants; a thinned store's keyframe ${thinned.toLocaleString('en-AU')} B with the picture, ${kept.toLocaleString('en-AU')} B without (the picture is ${(100 * share).toFixed(2)} % of the first); one that carries its own volume ${alone + 40_064} B`, 'budget MiB | keyframes at 6 h (with / without) | 3 h mean (with / without) | ratio | 3 h min (with / without) | store MiB (with / without)'];
    const ratios: [number, number][] = [];
    for (const mib of SWEEP_MIB) {
      const now = replay(seed, template, mib * MIB, false, true, true);
      const without = replay(seed, template, mib * MIB, false, false, true);
      const ratio = mean(now.last3h) / mean(without.last3h);
      ratios.push([mib, ratio]);
      rows.push(`${mib.toFixed(2).padStart(10)} | ${String(now.keyframes).padStart(3)} / ${String(without.keyframes).padEnd(3)} | ${mean(now.last3h).toFixed(1).padStart(5)} / ${mean(without.last3h).toFixed(1).padEnd(5)} | ${ratio.toFixed(3)} | ${Math.min(...now.last3h)} / ${Math.min(...without.last3h)} | ${now.totalMiB.toFixed(2)} / ${without.totalMiB.toFixed(2)}`);
      // The arithmetic's other half: never over the budget, with the picture or without.
      expect(now.totalMiB, `${mib} MiB: store size with the picture`).toBeLessThanOrEqual(mib);
      expect(without.totalMiB, `${mib} MiB: store size without it`).toBeLessThanOrEqual(mib);
    }
    // eslint-disable-next-line no-console
    console.log(rows.join('\n'));
    for (const [mib, ratio] of ratios) expect(ratio, `${mib} MiB: the 3 h mean of kept keyframes with the picture, against the run without it`).toBeGreaterThanOrEqual(SWEEP_RATIO_FLOOR);
    expect(mean(ratios.map(([, r]) => r)), 'and on average over the sweep the picture costs only a few percent of the keyframes').toBeGreaterThanOrEqual(SWEEP_RATIO_MEAN);
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
