import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import type { AtmosphereView } from '../core/types';
import { AtmosphereSampler, profileFactor, sectionLine } from './atmosphereSampler';
import { AdaptiveDpr, FrameMeter } from './perf';
import { skyLighting } from './sky';
import { plumeColumn, puffsFromAtmosphere } from './smokeLayer';

const origin = { lat: -33.7, lon: 150.3 };

function atmosphere(): AtmosphereView {
  const grid = makeGridSpec(origin, 4000, 200); // 20 × 20
  const nz = 5;
  const levels = Float32Array.from([50, 150, 300, 600, 1000]);
  const plane = grid.nx * grid.ny;
  const f = (fn: (i: number, j: number, z: number) => number): Float32Array => {
    const a = new Float32Array(plane * nz);
    for (let z = 0; z < nz; z++) for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) a[(z * grid.ny + j) * grid.nx + i] = fn(i, j, z);
    return a;
  };
  return {
    grid,
    nz,
    levels,
    terrainHeight: new Float32Array(plane),
    surfaceU: new Float32Array(plane).fill(3),
    surfaceV: new Float32Array(plane).fill(-1),
    u: f((i) => i), // u = column index
    v: f(() => 0),
    w: f((_i, _j, z) => z), // w = level index
    thetaAnomaly: f((i, j) => (i === 10 && j === 10 ? 8 : 0)),
    smoke: f((i, j, z) => (Math.abs(i - 10) < 2 && Math.abs(j - 10) < 2 ? 5 - z : 0)),
  };
}

describe('AtmosphereSampler', () => {
  const atm = atmosphere();
  const s = new AtmosphereSampler(atm, 200, { time: 0, temperature: 30, relativeHumidity: 20, windSpeed10: 5, windDir10: 270 });

  it('samples surface wind and trilinear 3-D fields', () => {
    const o = [0, 0, 0];
    s.surfaceWind(0, 0, o);
    expect(o[0]).toBeCloseTo(3, 6);
    expect(o[1]).toBeCloseTo(-1, 6);
    // Column 10.5 → u = 10.5; halfway between levels 1 and 2 (225 m above the datum) → w = 1.5.
    const x = atm.grid.x0 + 10.5 * atm.grid.cellSize;
    s.wind(x, 0, 200 + 225, 225, o);
    expect(o[0]).toBeCloseTo(10.5, 4);
    expect(o[2]).toBeCloseTo(1.5, 4);
    // Below the first level clamps to it.
    s.wind(x, 0, 200, 1, o);
    expect(o[2]).toBeCloseTo(0, 6);
    expect(s.top).toBeGreaterThan(200 + 1000);
  });

  it('falls back to the ambient wind with a power-law profile', () => {
    const f = new AtmosphereSampler(null, 0, { time: 0, temperature: 30, relativeHumidity: 20, windSpeed10: 5, windDir10: 270 });
    const o = [0, 0, 0];
    f.wind(0, 0, 100, 10, o);
    expect(o[0]).toBeCloseTo(5, 6); // westerly blows towards the east
    f.wind(0, 0, 100, 1000, o);
    expect(o[0]).toBeCloseTo(5 * profileFactor(1000), 6);
    expect(profileFactor(1000)).toBeGreaterThan(1.5);
  });
});

describe('sectionLine', () => {
  const b = { xMin: -100, xMax: 100, yMin: -50, yMax: 50 };
  it('clips an east–west line to the rectangle', () => {
    const l = sectionLine(b, [0, 0], 90)!;
    expect(l.a[0]).toBeCloseTo(-100, 6);
    expect(l.b[0]).toBeCloseTo(100, 6);
    expect(l.length).toBeCloseTo(200, 6);
  });
  it('clips a diagonal and rejects an outside centre', () => {
    const l = sectionLine(b, [0, 0], 45)!;
    expect(l.length).toBeCloseTo(100 * Math.SQRT2, 6);
    expect(sectionLine(b, [500, 0], 0)).toBeNull();
  });
});

describe('smoke puffs', () => {
  it('draws puffs only where there is smoke, with opacity relative to an absolute reference', () => {
    const atm = atmosphere();
    const p = puffsFromAtmosphere(atm, 200, 500, 5);
    expect(p.length).toBeGreaterThan(0);
    for (const q of p) {
      expect(Math.hypot(q.x, q.y)).toBeLessThan(700);
      expect(q.alpha).toBeGreaterThan(0);
      expect(q.alpha).toBeLessThanOrEqual(0.31);
    }
    // A weak plume (same shape, 100× less smoke) is much fainter.
    for (let k = 0; k < atm.smoke.length; k++) atm.smoke[k]! *= 0.01;
    const weak = puffsFromAtmosphere(atm, 200, 500, 5);
    expect(Math.max(...weak.map((q) => q.alpha))).toBeLessThan(0.05);
  });

  it('fallback plume rises and bends downwind', () => {
    const s = new AtmosphereSampler(null, 0, { time: 0, temperature: 30, relativeHumidity: 20, windSpeed10: 8, windDir10: 270 });
    const p = plumeColumn({ x: 0, y: 0, ground: 500 }, 20000, s);
    expect(p.length).toBeGreaterThan(20);
    const last = p[p.length - 1]!;
    expect(last.x).toBeGreaterThan(1000); // drifted east
    expect(Math.max(...p.map((q) => q.z))).toBeGreaterThan(1500);
  });
});

describe('perf', () => {
  it('lowers the DPR after sustained low fps and raises it after sustained headroom', () => {
    const d = new AdaptiveDpr({ maxDpr: 2, minDpr: 1 });
    let changed: number | null = null;
    for (let i = 0; i < 40 && changed === null; i++) changed = d.sample(50, 20);
    expect(changed).toBe(1.75);
    for (let i = 0; i < 400; i++) d.sample(50, 20);
    expect(d.dpr).toBe(1);
    for (let i = 0; i < 2000; i++) d.sample(16, 60);
    expect(d.dpr).toBe(2);
    expect(d.forceMin()).toBe(1);
  });

  it('does not mistake a 30 fps playback cap (with jitter) for a slow GPU, and can recover under the cap', () => {
    const d = new AdaptiveDpr({ maxDpr: 2, minDpr: 1 });
    // 30 fps cap with occasional hiccups: mean fps hovers just under 30.
    for (let i = 0; i < 3000; i++) expect(d.sample(34, 29.4, 30)).toBeNull();
    expect(d.dpr).toBe(2);
    // Genuinely slow under the cap (20 fps) → lowered.
    for (let i = 0; i < 100; i++) d.sample(50, 20, 30);
    expect(d.dpr).toBeLessThan(2);
    // Holding the cap for long enough raises it again.
    const low = d.dpr;
    for (let i = 0; i < 400; i++) d.sample(33.3, 30, 30);
    expect(d.dpr).toBeGreaterThan(low);
  });

  it('frame meter ignores pauses', () => {
    const m = new FrameMeter();
    let t = 0;
    for (let i = 0; i < 30; i++) m.tick((t += 16.7));
    expect(m.fps).toBeGreaterThan(55);
    expect(m.tick((t += 5000))).toBe(0);
    expect(m.fps).toBeGreaterThan(55);
  });
});

describe('sky lighting', () => {
  it('is bright by day, dark blue by night, warm at sunset', () => {
    const day = skyLighting(50);
    const dusk = skyLighting(3);
    const night = skyLighting(-20);
    expect(day.sunIntensity).toBeGreaterThan(dusk.sunIntensity);
    expect(night.sunIntensity).toBe(0);
    expect(night.night).toBe(1);
    expect(day.night).toBe(0);
    expect(night.skyAmbient[2]).toBeGreaterThan(night.skyAmbient[0]); // blue
    expect(dusk.sunColour[0]).toBeGreaterThan(dusk.sunColour[2] * 2); // warm
    expect(skyLighting(50, { cloudCover: 100 }).sunIntensity).toBeLessThan(day.sunIntensity * 0.5);
  });
});

