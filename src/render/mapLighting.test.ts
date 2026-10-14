/**
 * Night lighting of the map (sky.ts `mapLighting`): Realistic is today's lighting to the bit, every look is the same by day,
 * Daylight at night is the fixed north-west sun, Brighter is a fixed share of it, the dusk fade is smooth, and the things that
 * must keep following the clock (the real night, the real sun's direction in the sky) are not touched.
 */
import { describe, expect, it } from 'vitest';
import type { NightLook } from './api';
import { sunDirectionWorld, type Vec3 } from './coords';
import { MAP_SUN, NIGHT_LOOKS, NIGHT_LOOK_MIX, mapLighting, skyLighting } from './sky';

const ELEVATIONS = [-30, -18, -12, -8, -6, -3, -2.5, -2, -1, 0, 0.5, 2, 4, 6, 7.9, 8, 8.5, 12, 30, 60, 90];
const NIGHT_ELEVATIONS = [-8, -12, -18, -30]; // the real sun gives no light below -8 degrees
const AZIMUTHS = [0, 60, 120, 180, 240, 300];
/** The real sun's world direction the way SceneView computes it (the sun below the horizon is clamped to -2 degrees). */
const realDir = (el: number, az = 240): Vec3 => sunDirectionWorld(az, Math.max(el, -2));
const target = skyLighting(MAP_SUN.elevation);
const targetDir = sunDirectionWorld(MAP_SUN.azimuth, MAP_SUN.elevation);
const angle = (a: Vec3, b: Vec3): number => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * (180 / Math.PI);
const times = (c: readonly number[], k: number): number[] => c.map((x) => x * k);
const expectClose = (a: readonly number[], b: readonly number[], digits = 10): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(a[i], `component ${i}`).toBeCloseTo(b[i]!, digits);
};

describe('the constants', () => {
  it('are the spike S4 numbers: Brighter 0.3 of the way, a north-west sun at 30 degrees', () => {
    expect(NIGHT_LOOKS).toEqual(['realistic', 'brighter', 'daylight']);
    expect(NIGHT_LOOK_MIX).toEqual({ realistic: 0, brighter: 0.3, daylight: 1 });
    expect(MAP_SUN).toEqual({ azimuth: 315, elevation: 30 });
  });
});

describe('Realistic and the day', () => {
  it('Realistic hands back today\'s lighting untouched for every elevation, cloud and smoke value', () => {
    for (const el of ELEVATIONS)
      for (const cloudCover of [0, 40, 100])
        for (const smoke of [0, 0.3, 1]) {
          const real = skyLighting(el, { cloudCover, smoke });
          const dir = realDir(el);
          const m = mapLighting(real, 'realistic', dir);
          expect(m.weight).toBe(0);
          expect(m.sunDir).toBe(dir); // the very same numbers, not a recomputation
          expect(m.sunColour).toBe(real.sunColour);
          expect(m.sunIntensity).toBe(real.sunIntensity);
          expect(m.skyAmbient).toBe(real.skyAmbient);
          expect(m.groundAmbient).toBe(real.groundAmbient);
          expect(m.ambientIntensity).toBe(real.ambientIntensity);
          expect(m.exposure).toBe(real.exposure);
          expect(m.mapNight).toBe(real.night);
          expect(m.shadowGain).toBe(1);
        }
  });

  it('every look is identical to Realistic with the sun at 8 degrees or more', () => {
    for (const el of [8, 8.5, 12, 30, 60, 90])
      for (const look of NIGHT_LOOKS) {
        const real = skyLighting(el, { cloudCover: 30, smoke: 0.2 });
        const dir = realDir(el);
        const m = mapLighting(real, look, dir);
        expect(m).toEqual(mapLighting(real, 'realistic', dir));
        expect(m.sunDir).toBe(dir);
        expect(m.sunColour).toBe(real.sunColour);
        expect(m.exposure).toBe(real.exposure);
        expect(m.mapNight).toBe(0);
      }
  });

  it('does not change its inputs', () => {
    const real = skyLighting(-12, { cloudCover: 50 });
    const dir = realDir(-12);
    const before = JSON.stringify([real, dir]);
    mapLighting(real, 'daylight', dir);
    mapLighting(real, 'brighter', dir);
    expect(JSON.stringify([real, dir])).toBe(before);
  });
});

describe('Daylight and Brighter at night', () => {
  it('Daylight (the whole way) equals the lighting of the fixed sun by day, whatever the real cloud and smoke', () => {
    for (const el of [-2, -4, -6, -12, -30]) {
      const real = skyLighting(el, { cloudCover: 80, smoke: 0.5 });
      const m = mapLighting(real, 'daylight', realDir(el));
      expect(m.weight).toBe(1);
      expect(m.sunIntensity).toBeCloseTo(target.sunIntensity, 12);
      expect(m.ambientIntensity).toBeCloseTo(target.ambientIntensity, 12);
      expect(m.exposure).toBeCloseTo(target.exposure, 12);
      expectClose(m.sunColour, target.sunColour, 12);
      expectClose(m.skyAmbient, target.skyAmbient, 12);
      expectClose(m.groundAmbient, target.groundAmbient, 12);
      expect(m.mapNight).toBe(0);
      expect(m.shadowGain).toBe(0);
    }
    // The target is a clear day: no cloud grey, no smoke orange (the real values above had both).
    expect(target.sunIntensity).toBeGreaterThan(1.2);
  });

  it('at night the direction of every look is the fixed sun\'s, whatever the real sun\'s azimuth does', () => {
    for (const el of NIGHT_ELEVATIONS)
      for (const az of AZIMUTHS)
        for (const look of ['brighter', 'daylight'] as NightLook[]) {
          const m = mapLighting(skyLighting(el), look, realDir(el, az));
          expectClose(m.sunDir, targetDir, 12);
        }
    // Realistic keeps the real sun (which has no light at night, so only the sky dome and the shadows look at it).
    const dir = realDir(-12, 60);
    expect(mapLighting(skyLighting(-12), 'realistic', dir).sunDir).toBe(dir);
  });

  it('Brighter\'s sun light (colour times intensity) is its mix times Daylight\'s, not the mix squared', () => {
    for (const el of NIGHT_ELEVATIONS) {
      const real = skyLighting(el);
      const b = mapLighting(real, 'brighter', realDir(el));
      const d = mapLighting(real, 'daylight', realDir(el));
      expect(b.weight).toBeCloseTo(0.3, 12);
      expectClose(times(b.sunColour, b.sunIntensity), times(d.sunColour, 0.3 * d.sunIntensity), 12);
      expect(b.sunIntensity).toBeCloseTo(0.3 * d.sunIntensity, 12);
    }
  });

  it('the ambient light is blended as colour times intensity too', () => {
    const real = skyLighting(-12, { cloudCover: 60 });
    const b = mapLighting(real, 'brighter', realDir(-12));
    const light = (c: readonly number[], i: number): number[] => times(c, i);
    const want = (r: readonly number[], t: readonly number[]): number[] => r.map((x, k) => 0.7 * x * real.ambientIntensity + 0.3 * t[k]! * target.ambientIntensity);
    expectClose(light(b.skyAmbient, b.ambientIntensity), want(real.skyAmbient, target.skyAmbient), 12);
    expectClose(light(b.groundAmbient, b.ambientIntensity), want(real.groundAmbient, target.groundAmbient), 12);
  });

  it('the three looks light the ground in order: Realistic below Brighter below Daylight', () => {
    // The sun term on flat ground plus the sky term, in linear light (the same two sums the terrain shader adds).
    const flat = (m: ReturnType<typeof mapLighting>): number => m.sunIntensity * m.sunDir[1] * (m.sunColour[0] + m.sunColour[1] + m.sunColour[2]) + m.ambientIntensity * (m.skyAmbient[0] + m.skyAmbient[1] + m.skyAmbient[2]);
    for (const el of [-12, -30]) {
      const real = skyLighting(el);
      const [r, b, d] = NIGHT_LOOKS.map((look) => flat(mapLighting(real, look, realDir(el))));
      expect(r!).toBeLessThan(b!);
      expect(b!).toBeLessThan(d!);
    }
  });
});

describe('the dusk fade', () => {
  it('is smooth: the weight is monotone, between 0 and the look\'s mix, and nothing jumps between 0.1 degree steps', () => {
    for (const look of ['brighter', 'daylight'] as NightLook[]) {
      let prev: ReturnType<typeof mapLighting> | null = null;
      for (let el = 10; el >= -14; el -= 0.1) {
        const real = skyLighting(el);
        const m = mapLighting(real, look, realDir(el));
        expect(m.weight).toBeGreaterThanOrEqual(prev?.weight ?? 0);
        expect(m.weight).toBeLessThanOrEqual(NIGHT_LOOK_MIX[look] + 1e-12);
        if (prev) {
          expect(Math.abs(m.weight - prev.weight)).toBeLessThan(0.02);
          expect(Math.abs(m.sunIntensity - prev.sunIntensity)).toBeLessThan(0.05);
          expect(Math.abs(m.ambientIntensity - prev.ambientIntensity)).toBeLessThan(0.02);
          expect(Math.abs(m.exposure - prev.exposure)).toBeLessThan(0.02);
          expect(angle(m.sunDir, prev.sunDir)).toBeLessThan(2);
          for (let c = 0; c < 3; c++) {
            expect(Math.abs(m.sunColour[c]! - prev.sunColour[c]!)).toBeLessThan(0.05);
            expect(Math.abs(m.skyAmbient[c]! - prev.skyAmbient[c]!)).toBeLessThan(0.02);
          }
        }
        prev = m;
      }
    }
  });

  it('takes over completely: nothing at 8 degrees, the whole mix at -2', () => {
    for (const look of NIGHT_LOOKS) {
      expect(mapLighting(skyLighting(8), look, realDir(8)).weight).toBe(0);
      expect(mapLighting(skyLighting(-2), look, realDir(-2)).weight).toBeCloseTo(NIGHT_LOOK_MIX[look], 12);
      expect(mapLighting(skyLighting(-30), look, realDir(-30)).weight).toBeCloseTo(NIGHT_LOOK_MIX[look], 12);
    }
    // Half way (the smoothstep is symmetric) at +3 degrees.
    expect(mapLighting(skyLighting(3), 'daylight', realDir(3)).weight).toBeCloseTo(0.5, 12);
  });

  it('turns the light from the setting sun to the fixed sun, nearer all the way down (Daylight)', () => {
    let prev = Infinity;
    for (let el = 8; el >= -2; el -= 0.25) {
      const a = angle(mapLighting(skyLighting(el), 'daylight', realDir(el)).sunDir, targetDir);
      expect(a).toBeLessThanOrEqual(prev + 1e-9);
      prev = a;
    }
    expect(prev).toBeLessThan(1e-6);
  });

  it('the direction is a unit vector everywhere', () => {
    for (const el of ELEVATIONS)
      for (const az of AZIMUTHS)
        for (const look of NIGHT_LOOKS) expect(Math.hypot(...mapLighting(skyLighting(el), look, realDir(el, az)).sunDir)).toBeCloseTo(1, 12);
  });
});

describe('the night factor and the cast shadows', () => {
  it('mapNight is the real night times (1 - weight): the real value in Realistic, less in Brighter, none in Daylight', () => {
    for (const el of ELEVATIONS) {
      const real = skyLighting(el);
      const dir = realDir(el);
      const r = mapLighting(real, 'realistic', dir);
      const b = mapLighting(real, 'brighter', dir);
      const d = mapLighting(real, 'daylight', dir);
      expect(r.mapNight).toBe(real.night);
      expect(b.mapNight).toBeCloseTo(real.night * (1 - b.weight), 12);
      expect(d.mapNight).toBeCloseTo(real.night * (1 - d.weight), 12);
      expect(d.mapNight).toBeLessThanOrEqual(b.mapNight + 1e-12);
      expect(b.mapNight).toBeLessThanOrEqual(r.mapNight + 1e-12);
    }
    const night = skyLighting(-20);
    expect(night.night).toBe(1);
    expect(mapLighting(night, 'brighter', realDir(-20)).mapNight).toBeCloseTo(0.7, 12);
    expect(mapLighting(night, 'daylight', realDir(-20)).mapNight).toBe(0);
    expect(mapLighting(skyLighting(40), 'daylight', realDir(40)).mapNight).toBe(0); // by day the real night is 0 as well
  });

  it('shadowGain is 1 - weight: full shadows when nothing changes, none when the fixed sun lights the map, so they fade with the look', () => {
    expect(mapLighting(skyLighting(-20), 'realistic', realDir(-20)).shadowGain).toBe(1);
    expect(mapLighting(skyLighting(30), 'daylight', realDir(30)).shadowGain).toBe(1);
    expect(mapLighting(skyLighting(-20), 'brighter', realDir(-20)).shadowGain).toBeCloseTo(0.7, 12);
    expect(mapLighting(skyLighting(-20), 'daylight', realDir(-20)).shadowGain).toBe(0);
    for (const el of ELEVATIONS) {
      const m = mapLighting(skyLighting(el), 'daylight', realDir(el));
      expect(m.shadowGain).toBeCloseTo(1 - m.weight, 12);
    }
  });

  it('the exposure follows the same blend (Realistic at night keeps its raised exposure)', () => {
    const real = skyLighting(-20);
    expect(real.exposure).toBeCloseTo(1.6, 12);
    expect(mapLighting(real, 'realistic', realDir(-20)).exposure).toBe(real.exposure);
    expect(mapLighting(real, 'daylight', realDir(-20)).exposure).toBeCloseTo(target.exposure, 12);
    expect(mapLighting(real, 'brighter', realDir(-20)).exposure).toBeCloseTo(0.7 * real.exposure + 0.3 * target.exposure, 12);
  });
});
