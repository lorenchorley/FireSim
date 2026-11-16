// node --test prototypes/dotnet-b/ts-export/bars.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { barMetrics, burntBy, firstDivergence, quantileSorted, verdict, worstFraction, BARS } from './bars.mjs';

const raster = (vals) => Float32Array.from(vals);
// 6 cells burn at 0, 100, 200, 300, 400, 500; six never (-1)
const base = () => raster([0, 100, 200, 300, 400, 500, -1, -1, -1, -1, -1, -1]);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('burntBy: arrival <= horizon; the sentinel -1, NaN and infinities are unburnt', () => {
  assert.equal(burntBy(0, 0), true);
  assert.equal(burntBy(300, 300), true);
  assert.equal(burntBy(300.5, 300), false);
  assert.equal(burntBy(-1, 1e9), false);
  assert.equal(burntBy(NaN, 1e9), false);
  assert.equal(burntBy(Infinity, 1e9), false);
  assert.equal(burntBy(-Infinity, 1e9), false);
});

test('identical rasters: every metric zero at every horizon', () => {
  for (const h of [0, 150, 300, 600, 14400]) {
    const m = barMetrics(base(), base(), h);
    assert.equal(m.disagree, 0);
    assert.equal(m.disagreePct, 0);
    assert.equal(m.areaDiffPct, 0);
    assert.equal(m.differing, 0);
    assert.equal(m.maxAbsS, 0);
    assert.equal(m.medianAbsS, 0);
    assert.equal(worstFraction(m), 0);
  }
  const f = firstDivergence(base(), base(), { gridS: [300, 600] });
  assert.deepEqual(f, { exactS: null, snapshotS: null, firstExceedS: { disagreePct: null, areaDiffPct: null, medianAbsS: null, p95AbsS: null } });
});

test('one flipped cell: burnt in the candidate only', () => {
  const c = base();
  c[6] = 250; // one extra cell, burnt at 250 s
  const m = barMetrics(base(), c, 600);
  assert.equal(m.burntRef, 6);
  assert.equal(m.burntCand, 7);
  assert.equal(m.ever, 7);
  assert.equal(m.disagree, 1);
  near(m.disagreePct, 100 / 7);
  near(m.areaRatio, 7 / 6);
  near(m.areaDiffPct, 100 / 6);
  near(m.areaSignedPct, 100 / 6);
  assert.equal(m.both, 6);
  assert.equal(m.differing, 0);
  assert.equal(m.medianAbsS, 0);
  // before the extra cell burns it does not count; at 250 it does
  assert.equal(barMetrics(base(), c, 249).disagree, 0);
  assert.equal(barMetrics(base(), c, 250).disagree, 1);
  // the other way round: burnt in the reference only (area ratio below 1, negative signed difference)
  const r = barMetrics(c, base(), 600);
  assert.equal(r.disagree, 1);
  assert.ok(r.areaSignedPct < 0);
  near(r.areaDiffPct, 100 / 7);
  // first divergence: the cell ignites at 250 in one run only
  const f = firstDivergence(base(), c, { gridS: [100, 200, 300, 400] });
  assert.equal(f.exactS, 250);
  assert.equal(f.snapshotS, 300);
  assert.equal(f.firstExceedS.disagreePct, 300); // 1/7 = 14 % > 1 %
  assert.equal(f.firstExceedS.areaDiffPct, 300); // 1/6 = 16.7 % > 2 %
  assert.equal(f.firstExceedS.medianAbsS, null);
});

test('shifted arrivals: statistics over the cells burnt in both', () => {
  const ref = raster([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, -1, -1]);
  const cand = raster([10, 25, 20, 40, 51, 60, 70, 140, 90, 100, -1, -1]); // d = 0 5 10 0 1 0 0 60 0 0
  const m = barMetrics(ref, cand, 1000);
  assert.equal(m.both, 10);
  assert.equal(m.differing, 4);
  assert.equal(m.maxAbsS, 60);
  assert.equal(m.disagree, 0);
  assert.equal(m.areaDiffPct, 0);
  // sorted d: 0 0 0 0 0 0 1 5 10 60: median (0+0)/2 = 0; p95: rank .95*9 = 8.55, 10 + .55*(60-10) = 37.5
  assert.equal(m.medianAbsS, 0);
  near(m.p95AbsS, 37.5);
  // a shift of every cell by a whole 40 s: median 40
  const all = barMetrics(ref, ref.map((x) => (x >= 0 ? x + 40 : x)), 1000);
  assert.equal(all.medianAbsS, 40);
  assert.equal(all.p95AbsS, 40);
  assert.equal(all.differing, 10);
  // at horizon 75 s the 80 vs 140 cell is burnt in neither
  const early = barMetrics(ref, cand, 75);
  assert.equal(early.both, 7);
  assert.equal(early.disagree, 0);
  // cell 1: 20 vs 25 -> min 20; cell 2: 30 vs 20 -> min 20
  const f = firstDivergence(ref, cand, { gridS: [10, 20, 30] });
  assert.equal(f.exactS, 20);
  assert.equal(f.snapshotS, 20);
  // a 1 s shift is a status difference in between: 50 vs 51 at t = 50.5
  const s = barMetrics(raster([50, -1]), raster([51, -1]), 50.5);
  assert.equal(s.disagree, 1);
  assert.equal(s.both, 0);
});

test('empty sets and the quantile helper', () => {
  assert.ok(Number.isNaN(quantileSorted([], 0.5)));
  assert.equal(quantileSorted([7], 0.95), 7);
  assert.equal(quantileSorted([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantileSorted([1, 2, 3], 0.5), 2);
  assert.equal(quantileSorted([0, 10], 0.95), 9.5);
  const m = barMetrics(raster([-1, -1]), raster([-1, -1]), 100);
  assert.equal(m.ever, 0);
  assert.equal(m.disagreePct, 0);
  assert.equal(m.areaDiffPct, 0);
  assert.ok(Number.isNaN(m.areaRatio));
  assert.ok(Number.isNaN(m.medianAbsS));
  assert.equal(worstFraction(m), 0);
});

test('NaN and unburnt handling', () => {
  // NaN, -1, +Infinity and -Infinity are all "unburnt" and equal one another
  const ref = raster([100, NaN, -1, Infinity, -Infinity, 200]);
  const cand = raster([100, -1, NaN, -1, Infinity, 200]);
  const m = barMetrics(ref, cand, 1e6);
  assert.equal(m.burntRef, 2);
  assert.equal(m.burntCand, 2);
  assert.equal(m.disagree, 0);
  assert.equal(m.differing, 0);
  assert.equal(firstDivergence(ref, cand, { gridS: [300] }).exactS, null);
  // burnt in the reference only, NaN in the candidate: a flipped cell
  const m2 = barMetrics(raster([100, 200]), raster([100, NaN]), 1e6);
  assert.equal(m2.disagree, 1);
  assert.equal(m2.ever, 2);
  assert.equal(m2.disagreePct, 50);
  assert.equal(m2.areaRatio, 0.5);
  // reference empty, candidate not
  const m3 = barMetrics(raster([-1, -1]), raster([5, -1]), 10);
  assert.equal(m3.areaRatio, Infinity);
  assert.equal(m3.areaDiffPct, Infinity);
  assert.equal(m3.disagreePct, 100);
  // a size mismatch is an error, not a silent truncation
  assert.throws(() => barMetrics(raster([1]), raster([1, 2]), 10));
});

test('bars, fractions and the verdict words', () => {
  assert.deepEqual(BARS.embersOn, { disagreePct: 1, areaDiffPct: 2, medianAbsS: 30, p95AbsS: null });
  const m = { disagreePct: 0.5, areaDiffPct: 0.2, medianAbsS: 3, p95AbsS: 90 };
  assert.equal(worstFraction(m, true), 0.5); // no p95 bar with embers on
  assert.equal(worstFraction(m, false), 90 / 60);
  assert.equal(verdict(0), 'floor far below the bar (zero)');
  assert.equal(verdict(0.05), 'floor far below the bar');
  assert.equal(verdict(0.1), 'floor far below the bar');
  assert.equal(verdict(0.3), 'within a factor of 4 of the bar');
  assert.equal(verdict(0.5), 'within a factor of 2 of the bar');
  assert.equal(verdict(1), 'at or above the bar');
  assert.equal(verdict(5.8), 'at or above the bar');
});

test('first exceedance of each bar over the grid', () => {
  // 100 cells burn at 10, 20, ..., 1000 s; the candidate never burns the last 5 and ignites cell 10 (110 s) 40 s late
  const ref = raster(Array.from({ length: 100 }, (_, i) => 10 * (i + 1)));
  const cand = Float32Array.from(ref);
  for (let i = 95; i < 100; i++) cand[i] = -1;
  cand[10] += 40;
  const f = firstDivergence(ref, cand, { gridS: [100, 500, 960, 1000] });
  assert.equal(f.exactS, 110);
  assert.equal(f.snapshotS, 500);
  // 500 s: cell 10 burnt in both, 40 s apart; nothing else. 960 s: ref 96 burnt, cand 95: 1/96 = 1.04 % of cells (> 1 %), area 1.04 % (< 2 %)
  assert.equal(f.firstExceedS.disagreePct, 960);
  assert.equal(f.firstExceedS.areaDiffPct, 1000); // 5 of 100 at 1000 s
  assert.equal(f.firstExceedS.medianAbsS, null);
  assert.equal(f.firstExceedS.p95AbsS, null); // no p95 bar with embers on
  const off = firstDivergence(ref, cand, { gridS: [100, 500, 960, 1000], embers: false });
  assert.equal(off.firstExceedS.disagreePct, 1000); // 2.5 % bar: 1.04 % at 960 is below, 5 % at 1000 is above
});
