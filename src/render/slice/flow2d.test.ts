/**
 * Flow streaks against analytic fields (uniform, shear, solid-body rotation, exaggeration), seeding in valid air only,
 * re-seeding, determinism for a seed, and the static arrow lattice of reduced motion.
 */
import { describe, expect, it } from 'vitest';
import { createFlow, flowArrows, seedFlow, stepFlow, type FlowOptions, type FlowParticles } from './flow2d';
import { inValidAir as inValidAirP } from './lattice';
import { makeSliceData } from './testing';
import type { SliceData } from './types';

const inValidAir = (d: SliceData, s: number, z: number): boolean => inValidAirP(d, Float64Array.of(s, z));
const OPTS: FlowOptions = { exaggeration: 1, timeScale: 1, maxAgeS: 1e9 };
const bytes = (a: Float32Array): string => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('hex');
const state = (f: FlowParticles): string => [f.s, f.z, f.ps, f.pz, f.age].map(bytes).join('|') + `|${f.seed}`;

/** A 4 km by 2 km slice of valid air everywhere (the ground is far below the lowest row), 81 x 41 lattice points. */
const open = (wind: (s: number, z: number) => [number, number, number]): SliceData => makeSliceData({ columns: 81, rows: 41, a: [0, 0], b: [4000, 0], zMin: 0, zMax: 2000, ground: () => -500, wind });

function place(f: FlowParticles, i: number, s: number, z: number): void {
  f.s[i] = s;
  f.z[i] = z;
  f.ps[i] = s;
  f.pz[i] = z;
  f.age[i] = 0;
}

describe('createFlow and seedFlow', () => {
  it('makes arrays of the asked count', () => {
    const f = createFlow(300, 7);
    expect(f.count).toBe(300);
    for (const a of [f.s, f.z, f.ps, f.pz, f.age]) expect(a.length).toBe(300);
    expect(createFlow(0).count).toBe(0);
    expect(createFlow(-5).count).toBe(0);
  });

  it('scatters every particle over valid air only, spread over the whole slice, with ps = s', () => {
    // The ground rises across the slice: the left is under 600 m and the right under 1400 m.
    const d = makeSliceData({ columns: 81, rows: 41, a: [0, 0], b: [4000, 0], zMin: 0, zMax: 2000, ground: (s) => 600 + (800 * s) / 4000 });
    const f = createFlow(300, 3);
    seedFlow(f, d);
    let left = 0;
    let right = 0;
    let high = 0;
    for (let i = 0; i < f.count; i++) {
      expect(inValidAir(d, f.s[i]!, f.z[i]!), `particle ${i} at ${f.s[i]}, ${f.z[i]}`).toBe(true);
      expect(f.z[i]!).toBeGreaterThanOrEqual(600 + (800 * f.s[i]!) / 4000 - 60);
      expect(f.ps[i]).toBe(f.s[i]);
      expect(f.pz[i]).toBe(f.z[i]);
      if (f.s[i]! < 1000) left++;
      if (f.s[i]! > 3000) right++;
      if (f.z[i]! > 1500) high++;
    }
    expect(left).toBeGreaterThan(15);
    expect(right).toBeGreaterThan(15);
    expect(high).toBeGreaterThan(15);
  });

  it('finds air in a slice that is mostly ground (the fallback scan)', () => {
    const d = makeSliceData({ columns: 60, rows: 40, zMin: 0, zMax: 2000, ground: () => 1990 }); // only the top row is air
    const f = createFlow(50, 1);
    seedFlow(f, d);
    for (let i = 0; i < f.count; i++) expect(inValidAir(d, f.s[i]!, f.z[i]!)).toBe(true);
  });

  it('spreads the ages so the particles do not all expire together', () => {
    const f = createFlow(300, 1);
    seedFlow(f, open(() => [5, 0, 0]));
    const ages = Array.from(f.age).sort((a, b) => a - b);
    expect(ages[0]!).toBeGreaterThanOrEqual(0);
    expect(ages[ages.length - 1]!).toBeGreaterThan(2);
  });

  it('is deterministic for a seed, and different for another', () => {
    const d = open((s, z) => [5 + z / 500, 0, Math.sin(s / 700)]);
    const run = (seed: number): string => {
      const f = createFlow(300, seed);
      seedFlow(f, d);
      for (let i = 0; i < 40; i++) stepFlow(f, d, 0.04, { exaggeration: 2, timeScale: 30, maxAgeS: 3 });
      return state(f);
    };
    expect(run(11)).toBe(run(11));
    expect(run(11)).not.toBe(run(12));
  });
});

describe('stepFlow: analytic fields', () => {
  it('uniform wind: every particle moves along by along x air time, and not at all vertically', () => {
    const d = open(() => [10, 0, 0]);
    const f = createFlow(40, 5);
    seedFlow(f, d);
    // Keep them away from the ends so none is re-seeded.
    for (let i = 0; i < f.count; i++) place(f, i, 500 + 20 * i, 200 + 30 * i);
    stepFlow(f, d, 0.5, { exaggeration: 1, timeScale: 20, maxAgeS: 100 }); // 0.5 s x 20 = 10 s of air: 100 m
    for (let i = 0; i < f.count; i++) {
      expect(f.s[i]! - (500 + 20 * i)).toBeCloseTo(100, 2);
      expect(f.z[i]!).toBeCloseTo(200 + 30 * i, 3);
      expect(f.ps[i]!).toBeCloseTo(500 + 20 * i, 3);
      expect(f.pz[i]!).toBeCloseTo(200 + 30 * i, 3);
      expect(f.age[i]!).toBeCloseTo(0.5, 5);
    }
  });

  it('a wind along the line only gives no vertical motion even with a large exaggeration; a vertical wind is multiplied by it', () => {
    const d = open(() => [0, 0, 2]); // 2 m/s up
    const f = createFlow(1, 1);
    place(f, 0, 2000, 500);
    stepFlow(f, d, 1, { exaggeration: 3, timeScale: 10, maxAgeS: 100 }); // 10 s: 20 m up, drawn 3 times as steep: 60
    expect(f.s[0]!).toBeCloseTo(2000, 3);
    expect(f.z[0]!).toBeCloseTo(560, 2);
    // The streak points the way the picture shows: its screen slope (dz / ds, both in metres of the picture) is exaggeration x up / along.
    const g = createFlow(1, 1);
    const e = open(() => [8, 0, 2]);
    place(g, 0, 1000, 500);
    stepFlow(g, e, 1, { exaggeration: 2.5, timeScale: 5, maxAgeS: 100 });
    expect((g.z[0]! - g.pz[0]!) / (g.s[0]! - g.ps[0]!)).toBeCloseTo((2.5 * 2) / 8, 4);
  });

  it('linear shear: a particle at height z moves at along(z), exactly', () => {
    const d = open((_s, z) => [2 + 0.01 * z, 0, 0]);
    const f = createFlow(5, 2);
    const zs = [100, 400, 777, 1200, 1900];
    zs.forEach((z, i) => place(f, i, 300, z));
    stepFlow(f, d, 1, { exaggeration: 1, timeScale: 10, maxAgeS: 100 });
    zs.forEach((z, i) => {
      expect(f.s[i]! - 300).toBeCloseTo((2 + 0.01 * z) * 10, 2);
      expect(f.z[i]!).toBeCloseTo(z, 3);
    });
  });

  it('a field that varies along the particle’s path is integrated at second order (midpoint)', () => {
    // along = 0.01 s: s grows as exp(0.01 t). Over 10 s the exact factor is exp(0.1) = 1.10517; Euler would give 1.1 exactly one step, the midpoint 1.105.
    const d = open((s) => [0.01 * s, 0, 0]);
    const f = createFlow(1, 1);
    place(f, 0, 100, 1000);
    stepFlow(f, d, 1, { exaggeration: 1, timeScale: 10, maxAgeS: 100 });
    // Midpoint: 100 + 10 x 0.01 x 105 = 110.5 (exact 110.517; Euler would stop at 110).
    expect(f.s[0]!).toBeCloseTo(110.5, 2);
    expect(Math.abs(f.s[0]! - 100 * Math.exp(0.1))).toBeLessThan(0.05);
  });

  it('solid-body rotation (along = -w (z - zc), up = w (s - sc)): a streak stays on its circle for a whole turn', () => {
    const omega = 0.01;
    const sc = 2000;
    const zc = 1000;
    const d = open((s, z) => [-omega * (z - zc), 0, omega * (s - sc)]);
    const f = createFlow(3, 1);
    const radii = [200, 450, 800];
    radii.forEach((r, i) => place(f, i, sc + r, zc));
    const dt = 5; // omega dt = 0.05 rad per step
    const steps = Math.round((2 * Math.PI) / (omega * dt));
    let worst = 0;
    for (let n = 0; n < steps; n++) {
      stepFlow(f, d, dt, { exaggeration: 1, timeScale: 1, maxAgeS: 1e9 });
      radii.forEach((r, i) => {
        worst = Math.max(worst, Math.abs(Math.hypot(f.s[i]! - sc, f.z[i]! - zc) - r) / r);
      });
    }
    expect(worst).toBeLessThan(2e-3);
    // And it went round: after a whole turn it is back near where it started (counter-clockwise: up on the right, left at the top).
    radii.forEach((r, i) => {
      expect(Math.hypot(f.s[i]! - (sc + r), f.z[i]! - zc)).toBeLessThan(0.05 * r);
    });
    // Counter-clockwise from the +s side: the first step goes up.
    const g = createFlow(1, 1);
    place(g, 0, sc + 500, zc);
    stepFlow(g, d, 1, { exaggeration: 1, timeScale: 1, maxAgeS: 1e9 });
    expect(g.z[0]!).toBeGreaterThan(zc);
  });

  it('the blend does not drag a particle near the ground towards zero', () => {
    // 10 m/s everywhere in air; the ground's cells hold zeros. A particle 10 m above the model ground must still move at 10 m/s.
    const d = makeSliceData({ columns: 81, rows: 41, a: [0, 0], b: [4000, 0], zMin: 0, zMax: 2000, ground: () => 500, wind: () => [10, 0, 0] });
    const f = createFlow(1, 1);
    place(f, 0, 1000, 510);
    stepFlow(f, d, 1, { exaggeration: 1, timeScale: 10, maxAgeS: 100 });
    expect(f.s[0]! - 1000).toBeCloseTo(100, 2);
  });
});

describe('stepFlow: re-seeding', () => {
  it('re-seeds a particle that leaves the slice, the ground or the air, in valid air, with age 0 and no streak across the jump', () => {
    const d = makeSliceData({ columns: 81, rows: 41, a: [0, 0], b: [4000, 0], zMin: 0, zMax: 2000, ground: () => 300, wind: () => [10, 0, 0] });
    const f = createFlow(3, 9);
    place(f, 0, 3990, 1000); // leaves through B
    place(f, 1, 1000, 1990); // stays
    place(f, 2, 2000, 310);
    f.age[1] = 1;
    stepFlow(f, d, 1, { exaggeration: 1, timeScale: 5, maxAgeS: 100 });
    expect(f.s[1]!).toBeCloseTo(1050, 2);
    expect(f.age[1]!).toBeCloseTo(2, 5);
    expect(f.age[0]).toBe(0);
    expect(inValidAir(d, f.s[0]!, f.z[0]!)).toBe(true);
    expect(f.ps[0]).toBe(f.s[0]);
    expect(f.pz[0]).toBe(f.z[0]);
    expect(f.s[0]!).not.toBeCloseTo(4040, 0);
  });

  it('re-seeds a particle that passes the maximum age, and counts the age in seconds of the panel clock', () => {
    const d = open(() => [1, 0, 0]);
    const f = createFlow(1, 2);
    place(f, 0, 1000, 1000);
    for (let i = 0; i < 9; i++) stepFlow(f, d, 0.5, { exaggeration: 1, timeScale: 1, maxAgeS: 5 });
    expect(f.age[0]!).toBeCloseTo(4.5, 5);
    expect(f.s[0]!).toBeCloseTo(1000 + 4.5, 3);
    stepFlow(f, d, 0.5, { exaggeration: 1, timeScale: 1, maxAgeS: 5 }); // 5.0: not yet older than 5
    expect(f.age[0]!).toBeCloseTo(5, 5);
    stepFlow(f, d, 0.5, { exaggeration: 1, timeScale: 1, maxAgeS: 5 });
    expect(f.age[0]).toBe(0);
    expect(f.ps[0]).toBe(f.s[0]);
  });

  it('a step of zero, negative or not a number changes nothing', () => {
    const d = open(() => [10, 0, 0]);
    const f = createFlow(20, 4);
    seedFlow(f, d);
    const before = state(f);
    for (const dt of [0, -1, NaN]) stepFlow(f, d, dt, OPTS);
    expect(state(f)).toBe(before);
  });

  it('keeps every particle in valid air through a long run in a real-looking field', () => {
    const d = makeSliceData({ columns: 90, rows: 50, a: [0, 0], b: [6000, 0], zMin: 300, zMax: 2800, ground: (s) => 600 + 400 * Math.sin(s / 800), wind: (s, z) => [6 + z / 300, 0, 2 * Math.cos(s / 500) * Math.exp(-z / 1500)] });
    const f = createFlow(300, 17);
    seedFlow(f, d);
    for (let i = 0; i < 500; i++) {
      stepFlow(f, d, 1 / 24, { exaggeration: 2, timeScale: 40, maxAgeS: 6 });
      for (let p = 0; p < f.count; p++) {
        expect(inValidAir(d, f.s[p]!, f.z[p]!), `step ${i} particle ${p}`).toBe(true);
        expect(Number.isFinite(f.ps[p]! + f.pz[p]! + f.age[p]!)).toBe(true);
      }
    }
  });
});

describe('flowArrows', () => {
  it('lays arrows on an even lattice where there is air, with the screen angle of the exaggerated vector and the real speed', () => {
    const d = makeSliceData({ columns: 81, rows: 41, a: [0, 0], b: [4000, 0], zMin: 0, zMax: 2000, ground: () => -500, wind: () => [10, 0, 5] });
    const a = flowArrows(d, 8, 4, 2);
    expect(a.count).toBe(32);
    expect(a.s.length).toBe(32);
    expect(a.s[0]).toBeCloseTo(250, 3); // the centre of the first of 8 divisions of 4 km
    expect(a.z[0]).toBeCloseTo(250, 3); // and of the first of 4 divisions of 2 km
    expect(a.s[7]).toBeCloseTo(3750, 3);
    for (let i = 0; i < a.count; i++) {
      expect(a.angle[i]!).toBeCloseTo(Math.atan2(2 * 5, 10), 5); // 45 degrees on screen
      expect(a.speed[i]!).toBeCloseTo(Math.hypot(10, 5), 4);
    }
    // True to scale the same wind points less steeply.
    expect(flowArrows(d, 8, 4, 1).angle[0]).toBeCloseTo(Math.atan2(5, 10), 5);
  });

  it('leaves out the points under the ground, and a descending wind points below the horizontal', () => {
    const d = makeSliceData({ columns: 81, rows: 41, a: [0, 0], b: [4000, 0], zMin: 0, zMax: 2000, ground: () => 950, wind: () => [-6, 0, -3] });
    const a = flowArrows(d, 10, 10, 1);
    expect(a.count).toBe(50); // the row centres are 100, 300 ... 1900: those from 1100 up are over the ground, 5 rows of 10
    for (let i = 0; i < a.count; i++) {
      expect(a.z[i]!).toBeGreaterThan(950);
      expect(a.angle[i]!).toBeCloseTo(Math.atan2(-3, -6), 5); // pointing left and down
    }
  });

  it('an empty lattice, or one with no air, gives no arrows', () => {
    const d = makeSliceData({ ground: () => 5000, zMin: 0, zMax: 2000, topAsl: 2500 });
    expect(flowArrows(d, 6, 4, 1).count).toBe(0);
    expect(flowArrows(makeSliceData(), 0, 5, 1).count).toBe(0);
  });
});
