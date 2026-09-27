/**
 * Class sampling (§9.1 table) and importance weights (§9.1: heavier-tailed proposal, W × likelihood ratio).
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { CLS_FLAKE, CLS_HEAVY, CLS_LEAF, CLS_RIBBON, CLS_TWIG, EMBER_PARAMS } from './params';
import { FastRng, NORMAL_TABLE, inverseNormalCdf, medianTauB, proposalMeanTauB, sampleClass, type EmberDraw } from './sampling';

const draws = (c: number, n: number, seed = 3): EmberDraw[] => {
  const r = new FastRng(seed);
  const out: EmberDraw[] = [];
  for (let q = 0; q < n; q++) out.push(sampleClass(EMBER_PARAMS.classes[c]!, r, { vt0: 0, tauF: 0, tauB: 0, weight: 1 }));
  return out;
};

describe('random streams', () => {
  it('FastRng reproduces core Rng.next() exactly (same stream-0 sequence)', () => {
    const a = new Rng(12345);
    const b = new FastRng(a.state);
    for (let q = 0; q < 1000; q++) expect(b.next()).toBe(a.next());
    expect(b.s).toBe(a.state);
  });

  it('normal table has unit variance and zero mean; inverse CDF is accurate', () => {
    let m = 0;
    let v = 0;
    for (const z of NORMAL_TABLE) {
      m += z;
      v += z * z;
    }
    expect(m / NORMAL_TABLE.length).toBeCloseTo(0, 10);
    expect(v / NORMAL_TABLE.length).toBeCloseTo(1, 10);
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.959964, 5);
    expect(inverseNormalCdf(0.01)).toBeCloseTo(-2.326348, 5);
  });
});

describe('class draws (§9.1)', () => {
  it('E1 flake: v_t0 lognormal median 4.5 clipped to 3–6; τ_f median 30', () => {
    const d = draws(CLS_FLAKE, 20000);
    const v = d.map((x) => x.vt0).sort((a, b) => a - b);
    expect(v[0]!).toBeGreaterThanOrEqual(3);
    expect(v[v.length - 1]!).toBeLessThanOrEqual(6);
    expect(v[v.length >> 1]!).toBeCloseTo(4.5, 1);
    const tf = d.map((x) => x.tauF).sort((a, b) => a - b);
    expect(tf[tf.length >> 1]!).toBeGreaterThan(26);
    expect(tf[tf.length >> 1]!).toBeLessThan(34);
    for (const x of d) expect(x.tauF).toBeLessThanOrEqual(x.tauB);
  });

  it('E2 ribbon: v_t0 in U(5.2, 5.8) [V]; τ_b spans the morphology mixture with a tail to 1500 s', () => {
    const d = draws(CLS_RIBBON, 20000);
    for (const x of d) {
      expect(x.vt0).toBeGreaterThanOrEqual(5.2);
      expect(x.vt0).toBeLessThanOrEqual(5.8);
      expect(x.tauB).toBeLessThanOrEqual(1500 * 1.0001);
    }
    // weighted mean of τ_b = nature mean ((251 + 122 + 429)/3 = 267.3 with a 5 % log-uniform tail 429–1500)
    const rb = EMBER_PARAMS.ribbonTauB;
    const natureMean = (1 - rb.tailWeight) * 267.33 + (rb.tailWeight * (1500 - 429)) / Math.log(1500 / 429);
    let sw = 0;
    let swt = 0;
    for (const x of d) {
      sw += x.weight;
      swt += x.weight * x.tauB;
    }
    expect(sw / d.length).toBeCloseTo(1, 1);
    expect(swt / sw).toBeGreaterThan(natureMean * 0.95);
    expect(swt / sw).toBeLessThan(natureMean * 1.05);
  });

  it('E3 leaf, E4 twig (τ_b = 24.3·v_t0, Albini), E5 heavy', () => {
    for (const x of draws(CLS_LEAF, 2000)) {
      expect(x.vt0).toBeGreaterThanOrEqual(1.5);
      expect(x.vt0).toBeLessThanOrEqual(2.5);
      expect(x.tauB).toBe(25);
      expect(x.tauF).toBe(10);
    }
    for (const x of draws(CLS_TWIG, 2000)) {
      expect(x.vt0).toBeGreaterThanOrEqual(4);
      expect(x.vt0).toBeLessThanOrEqual(7);
      expect(x.tauB).toBeCloseTo(EMBER_PARAMS.albiniK * x.vt0, 3);
      expect(x.weight).toBe(1);
    }
    for (const x of draws(CLS_HEAVY, 2000)) {
      expect(x.vt0).toBeGreaterThanOrEqual(8);
      expect(x.vt0).toBeLessThanOrEqual(12);
      expect(x.tauB).toBe(600);
    }
  });

  it('E1 importance sampling: unbiased mean and tail, oversampled long lifetimes', () => {
    const d = draws(CLS_FLAKE, 100000, 11);
    let sw = 0;
    let swt = 0;
    let tailW = 0;
    let tailN = 0;
    for (const x of d) {
      sw += x.weight;
      swt += x.weight * x.tauB;
      if (x.tauB > 600) {
        tailW += x.weight;
        tailN++;
      }
    }
    const natureMean = 150 * Math.exp(0.7 * 0.7 / 2); // 191.9 s
    const natureTail = 0.0239; // P(LN(150, 0.7) > 600) = 1 − Φ(ln 4 / 0.7)
    expect(sw / d.length).toBeCloseTo(1, 1);
    expect(swt / sw).toBeGreaterThan(natureMean * 0.97);
    expect(swt / sw).toBeLessThan(natureMean * 1.03);
    expect(tailW / sw).toBeGreaterThan(natureTail * 0.85);
    expect(tailW / sw).toBeLessThan(natureTail * 1.15);
    expect(tailN / d.length).toBeGreaterThan(4 * natureTail); // the proposal puts > 4× more particles in the tail
    // weights of a defensive mixture are bounded by 1/(1 − α)
    for (const x of d) expect(x.weight).toBeLessThanOrEqual(1 / (1 - 0.5) + 1e-9);
  });

  it('proposal mean τ_b (prior of τ̄_c) matches the sample mean; medians', () => {
    for (const c of [CLS_FLAKE, CLS_RIBBON, CLS_TWIG]) {
      const d = draws(c, 50000, 5);
      const m = d.reduce((a, x) => a + x.tauB, 0) / d.length;
      expect(m / proposalMeanTauB(EMBER_PARAMS.classes[c]!)).toBeGreaterThan(0.96);
      expect(m / proposalMeanTauB(EMBER_PARAMS.classes[c]!)).toBeLessThan(1.04);
    }
    expect(medianTauB(EMBER_PARAMS.classes[CLS_FLAKE]!)).toBe(150);
    expect(medianTauB(EMBER_PARAMS.classes[CLS_RIBBON]!)).toBe(251);
  });
});
