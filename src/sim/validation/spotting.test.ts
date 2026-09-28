/**
 * Spotting in the coupled model (spec §15 V9; §9.4 ridge release), headless through `Simulation` with embers on:
 *  V9  flat 9 km, DSF (bark hazard 3), T 34 °C, RH 18 %, DF 10, U10 7.5 / 37.1 / 66.7 km/h (FFDI 25 / 50 / 100): the
 *      W-weighted P95 travel of ignition-capable landings (p ≥ 0.05) is ordered and within ×2 of Mk5 S = 1.29 / 2.95 /
 *      6.25 km — fast tier by default, standard tier under SLOW;
 *  ridges: brands released from a ridge fly farther and land lower than brands from the windward slope (ridge drop),
 *      and reach the lee valley.
 * The fire itself is the coupled model's (Mk2 spread, coupled wind), not a prescribed front.
 */
import { describe, expect, it } from 'vitest';
import type { QualityTier } from '../../core/types';
import type { EmberLandingEvent } from '../../embers';
import { ffdi } from '../../fire/models';
import { DEG, SLOW, kindsOf, line, log, median, runSim, synth } from './harness';

/** W-weighted quantile of the travel distance (m). */
function wq(ev: EmberLandingEvent[], q: number): number {
  const w = ev.map((e) => ({ d: e.travel, w: e.weight })).sort((a, b) => a.d - b.d);
  const tot = w.reduce((a, b) => a + b.w, 0);
  let c = 0;
  for (const x of w) {
    c += x.w;
    if (c >= q * tot) return x.d;
  }
  return NaN;
}

const MK5_S = [1290, 2950, 6250];
const WINDS = [7.5, 37.1, 66.7];

function v9(tier: QualityTier): { p95: number[]; spots: number[]; left: number[] } {
  const p95: number[] = [];
  const spots: number[] = [];
  const left: number[] = [];
  for (const u of WINDS) {
    const ev: EmberLandingEvent[] = [];
    // The FFDI 100 head runs ≈ 8 km/h and throws brands 6–7 km: start further west and stop earlier so the landings stay
    // inside the 9 km domain.
    const x0 = u > 50 ? -4300 : -4000;
    const T = u > 50 ? 1500 : 2700;
    const s = synth({ extent: 9000, temperature: 34, rh: 18, windKmh: u, droughtFactor: 10, kbdi: 100, duration: 2 * 3600, ignitions: [line([[x0, -1000], [x0, 1000]])], options: { embers: true, maxEmbers: 4000 } });
    const r = runSim(s, { tier, until: T, every: 300, onLanding: (e) => e.p >= 0.05 && ev.push(e) });
    const st = r.sim.stats();
    p95.push(wq(ev, 0.95));
    spots.push(st.spotFires);
    left.push(st.embersLeftDomain);
    log(`V9 ${tier} U10 ${u} km/h (FFDI ${ffdi(34, 18, u, 10).toFixed(0)}): capable landings ${ev.length}, P50 ${(wq(ev, 0.5) / 1000).toFixed(2)} P95 ${(wq(ev, 0.95) / 1000).toFixed(2)} P99 ${(wq(ev, 0.99) / 1000).toFixed(2)} km; spots ${st.spotFires}; left the domain ${st.embersLeftDomain}; head ${(st.headRos * 3.6).toFixed(1)} km/h; cards ${[...kindsOf(r.insights)].join(', ')}`);
  }
  return { p95, spots, left };
}

describe('V9 spotting distance vs FFDI (coupled, flat 9 km)', () => {
  const tiers: QualityTier[] = SLOW ? ['fast', 'standard'] : ['fast'];
  for (const tier of tiers) {
    it(`${tier}: P95 ordered 25 < 50 < 100 and within ×2 of Mk5 S`, () => {
      const r = v9(tier);
      expect(r.p95[0]!).toBeLessThan(r.p95[1]!);
      expect(r.p95[1]!).toBeLessThan(r.p95[2]!);
      for (let q = 0; q < 3; q++) {
        expect(r.p95[q]! / MK5_S[q]!).toBeGreaterThanOrEqual(0.5);
        expect(r.p95[q]! / MK5_S[q]!).toBeLessThanOrEqual(2);
      }
    }, 600000);
  }
});

describe('spotting over a ridge (N–S ridge 300 m, 20° windward / 28° lee, 40 km/h westerly, moisture from the model)', () => {
  it('brands carried over the crest fall into the lee valley (ridge drop > 50 m) and reach at least as far as from flat ground', () => {
    const H = 300;
    const tw = Math.tan(20 * DEG);
    const tl = Math.tan(28 * DEG);
    const flight = (ridge: boolean): { lee: EmberLandingEvent[]; all: number } => {
      const ev: EmberLandingEvent[] = [];
      const s = synth({
        extent: 7000, windKmh: 40, windFromDeg: 270, duration: 2 * 3600,
        elevation: ridge ? (x) => 500 + Math.max(0, x < 0 ? H + tw * x : H - tl * x) : () => 500,
        ignitions: [line([[-1500, -600], [-1500, 600]])], options: { embers: true, maxEmbers: 4000 },
      });
      runSim(s, { until: 3600, every: 600, onLanding: (e) => e.p >= 0.05 && e.maxHeightAGL > 20 && ev.push(e) });
      const g = s.terrain.grid;
      // Launched in the last 400 m before the crest line (x = 0) and landing beyond it.
      const lee = ev.filter((e) => {
        const sx = g.x0 + (e.sourceCell % g.nx) * g.cellSize;
        return sx > -400 && sx <= 0 && e.x > 100;
      });
      return { lee, all: ev.length };
    };
    const perLoft = (a: EmberLandingEvent[]): number => median(a.map((e) => e.travel / e.maxHeightAGL));
    const rg = flight(true);
    const fl = flight(false);
    const drop = rg.lee.reduce((a, e) => a + e.ridgeDrop * e.weight, 0) / Math.max(1e-9, rg.lee.reduce((a, e) => a + e.weight, 0));
    log(`ridge spotting: ${rg.lee.length} of ${rg.all} capable landings launched before the crest landed beyond it (P95 ${(wq(rg.lee, 0.95) / 1000).toFixed(2)} km, mean ridge drop ${drop.toFixed(0)} m, travel per m of loft ${perLoft(rg.lee).toFixed(2)}); flat: ${fl.lee.length} (P95 ${(wq(fl.lee, 0.95) / 1000).toFixed(2)} km, per m of loft ${perLoft(fl.lee).toFixed(2)})`);
    expect(rg.lee.length).toBeGreaterThan(10);
    expect(fl.lee.length).toBeGreaterThan(10);
    expect(drop).toBeGreaterThan(50);
    // Brands gain the ridge drop in fall height, so over-the-crest spotting reaches at least as far as on flat ground
    // with the same fire line (the crest fire is slower and less intense than the upslope run that preceded it).
    expect(wq(rg.lee, 0.95)).toBeGreaterThanOrEqual(0.9 * wq(fl.lee, 0.95));
  }, 300000);
});
