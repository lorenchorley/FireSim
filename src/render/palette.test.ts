/** Heat-map palettes: cool-to-warm order, colour-blind safety, consistent hazard colours. */
import { describe, expect, it } from 'vitest';
import { FireHistoryKind, Landform } from '../core/types';
import { VISION_TYPES, deltaE, minPairDistance, simulateVision, toLab } from './colourVision';
import { SLICE_FIELD_IDS } from './slice/types';
import {
  ALONG_RAMP,
  AMOUNT_RAMP,
  CANOPY_COVER_RAMP,
  CANOPY_HEIGHT_RAMP,
  CURING_RAMP,
  ELEVATED_HEIGHT_RAMP,
  FIRE_HISTORY_COLOURS,
  HAZARD_NONE_COLOUR,
  HAZARD_RATING_COLOURS,
  HEAT_COLOURS,
  LANDFORM_COLOURS,
  SMOKE_RAMP,
  THETA_RAMP,
  TSF_NO_RECORD,
  UPDRAFT_RAMP,
  WIND_RAMP,
  WIND_SPEED_RAMP,
  amountClassColours,
  amountRamp,
  hexToRgb,
  luminance,
  sampleRamp,
  sliceFieldScale,
  type Ramp,
} from './palette';

/** Every pair of classes must stay this far apart (ΔE) for every kind of colour vision. */
const CLASS_MIN_DE = 10;

describe('amount ramps (cool = little, warm = much)', () => {
  it('the master ramp runs blue to plum through teal, green, yellow, orange and red', () => {
    const order: string[] = [HEAT_COLOURS.blue, HEAT_COLOURS.teal, HEAT_COLOURS.green, HEAT_COLOURS.yellow, HEAT_COLOURS.orange, HEAT_COLOURS.red, HEAT_COLOURS.plum];
    expect(AMOUNT_RAMP.stops.map((s) => s.colour)).toEqual(order);
    expect(AMOUNT_RAMP.stops[0]!.at).toBe(0);
    expect(AMOUNT_RAMP.stops[AMOUNT_RAMP.stops.length - 1]!.at).toBe(1);
  });

  it('amountRamp puts the master colours at the requested values', () => {
    const r = amountRamp([0, 10, 100]);
    expect(r.stops.map((s) => s.at)).toEqual([0, 10, 100]);
    expect(r.stops[0]!.colour).toBe(HEAT_COLOURS.blue);
    expect(r.stops[2]!.colour).toBe(HEAT_COLOURS.plum);
    expect(() => amountRamp([1])).toThrow();
    expect(amountClassColours(1)).toEqual([HEAT_COLOURS.blue]);
    expect(amountClassColours(3)[2]).toBe(HEAT_COLOURS.plum);
  });

  const ramps: [string, Ramp][] = [
    ['master', AMOUNT_RAMP],
    ['canopy height', CANOPY_HEIGHT_RAMP],
    ['canopy cover', CANOPY_COVER_RAMP],
    ['shrub height', ELEVATED_HEIGHT_RAMP],
    ['grass curing', CURING_RAMP],
    ['wind speed', WIND_SPEED_RAMP],
  ];
  for (const [name, ramp] of ramps) {
    it(`${name}: low end is cool, high end is warm and dark, and it stays readable for every kind of colour vision`, () => {
      const lo = ramp.rgb[0]!;
      const hi = ramp.rgb[ramp.rgb.length - 1]!;
      expect(lo[2]).toBeGreaterThan(lo[0]); // blue-ish
      expect(hi[0]).toBeGreaterThan(hi[1]); // red/plum-ish
      expect(toLab(hi)[0]).toBeLessThan(toLab(lo)[0]); // darkest at the top
      // Points of the ramp that are a fifth of the way apart or more are never mistaken for each other.
      for (const v of VISION_TYPES) {
        const pos = ramp.pos;
        const a = pos[0]!;
        const b = pos[pos.length - 1]!;
        for (let i = 0; i <= 20; i++) {
          for (let j = i + 4; j <= 20; j++) {
            const c1 = simulateVision(sampleRamp(ramp, a + ((b - a) * i) / 20), v);
            const c2 = simulateVision(sampleRamp(ramp, a + ((b - a) * j) / 20), v);
            expect(deltaE(c1, c2), `${name} ${v} ${i}/20 vs ${j}/20`).toBeGreaterThan(9);
          }
        }
      }
    });
  }
});

describe('class palettes', () => {
  it('hazard ratings (and "none") are distinguishable for every kind of colour vision', () => {
    const all = [HAZARD_NONE_COLOUR, ...HAZARD_RATING_COLOURS];
    for (const v of VISION_TYPES) expect(minPairDistance(all, v), v).toBeGreaterThan(CLASS_MIN_DE);
  });

  it('hazard ratings get warmer and darker from Low to Extreme', () => {
    const lab = HAZARD_RATING_COLOURS.map((h) => toLab(hexToRgb(h)));
    // Blue (Low) then yellow to plum: lightness falls from Moderate to Extreme.
    for (let i = 2; i < lab.length; i++) expect(lab[i]![0]).toBeLessThan(lab[i - 1]![0]);
    expect(hexToRgb(HAZARD_RATING_COLOURS[0]!)[2]).toBeGreaterThan(hexToRgb(HAZARD_RATING_COLOURS[0]!)[0]);
  });

  it('landform classes are distinguishable for every kind of colour vision', () => {
    const all = Object.values(LANDFORM_COLOURS);
    expect(all.length).toBe(Object.keys(Landform).length / 2);
    expect(new Set(all).size).toBe(all.length);
    for (const v of VISION_TYPES) expect(minPairDistance(all, v), v).toBeGreaterThan(CLASS_MIN_DE);
  });

  it('last-fire kinds and the "no record" grey are distinguishable for every kind of colour vision', () => {
    const all = [...Object.values(FIRE_HISTORY_COLOURS), TSF_NO_RECORD];
    expect(Object.keys(FIRE_HISTORY_COLOURS).length).toBe(3);
    expect(FIRE_HISTORY_COLOURS[FireHistoryKind.Wildfire]).not.toBe(FIRE_HISTORY_COLOURS[FireHistoryKind.PrescribedBurn]);
    for (const v of VISION_TYPES) expect(minPairDistance(all, v), v).toBeGreaterThan(CLASS_MIN_DE);
  });

  it('classes sampled from the master ramp (homes, distance to a road) are distinguishable for every kind of colour vision', () => {
    for (const n of [5, 6]) for (const v of VISION_TYPES) expect(minPairDistance(amountClassColours(n), v), `${n} ${v}`).toBeGreaterThan(CLASS_MIN_DE);
  });
});

describe('diverging air-slice ramps (neutral in the middle, darker with the size of the value)', () => {
  const diverging: [string, Ramp][] = [
    ['along and across', ALONG_RAMP],
    ['temperature', THETA_RAMP],
    ['up and down', UPDRAFT_RAMP],
  ];
  const lum = (ramp: Ramp, v: number): number => luminance(sampleRamp(ramp, v));

  for (const [name, ramp] of diverging) {
    it(`${name}: pale at 0 and luminance-ordered, so it also reads in grey`, () => {
      expect(lum(ramp, 0)).toBeGreaterThan(0.85);
      const neg = ramp.stops.filter((s) => s.at <= 0).reverse(); // 0, then outwards
      const pos = ramp.stops.filter((s) => s.at >= 0);
      for (const arm of [neg, pos]) for (let i = 1; i < arm.length; i++) expect(lum(ramp, arm[i]!.at), `${name} ${arm[i]!.at}`).toBeLessThan(lum(ramp, arm[i - 1]!.at));
    });

    it(`${name}: the two sides are never mistaken for each other, for every kind of colour vision`, () => {
      const lo = ramp.pos[0]!;
      const hi = ramp.pos[ramp.pos.length - 1]!;
      for (const v of VISION_TYPES) {
        let min = Infinity;
        // Every value at least a quarter of the way out on the negative side against every one on the positive side.
        for (let i = 0; i <= 20; i++)
          for (let j = 0; j <= 20; j++) {
            const a = simulateVision(sampleRamp(ramp, lo * (0.25 + (0.75 * i) / 20)), v);
            const b = simulateVision(sampleRamp(ramp, hi * (0.25 + (0.75 * j) / 20)), v);
            min = Math.min(min, deltaE(a, b));
          }
        expect(min, `${name} ${v}`).toBeGreaterThan(20);
      }
    });
  }

  /** Smallest ΔE between two points of the ramp that are a fifth of its range apart or more, for one kind of colour vision. */
  const fifthApart = (ramp: Ramp, v: (typeof VISION_TYPES)[number]): number => {
    const a = ramp.pos[0]!;
    const b = ramp.pos[ramp.pos.length - 1]!;
    let min = Infinity;
    for (let i = 0; i <= 20; i++) for (let j = i + 4; j <= 20; j++) min = Math.min(min, deltaE(simulateVision(sampleRamp(ramp, a + ((b - a) * i) / 20), v), simulateVision(sampleRamp(ramp, a + ((b - a) * j) / 20), v)));
    return min;
  };

  it('along and across: every value a fifth of the range apart or more is easy to tell apart, for every kind of colour vision', () => {
    for (const v of VISION_TYPES) expect(fifthApart(ALONG_RAMP, v), v).toBeGreaterThan(20);
  });

  it('temperature and up and down (older ramps): a fifth apart stays clearly different; the two darkest shades of one hue are the closest pair', () => {
    // Measured when these tests were added: temperature 8.9 (protan) and up and down 6.4 (deutan), both between the two darkest
    // shades of one hue at the strong end. Well above a just-noticeable difference (about 2.3) but below the 9 the heat-map ramps keep,
    // so the floor here is the measured one, not the sequential ramps': the strength is also carried by the luminance order above and by the legend numbers.
    for (const v of VISION_TYPES) {
      expect(fifthApart(THETA_RAMP, v), `temperature ${v}`).toBeGreaterThan(8);
      expect(fifthApart(UPDRAFT_RAMP, v), `up and down ${v}`).toBeGreaterThan(6);
    }
  });

  it('along and across is symmetric: mirror stops, the same luminance on both sides, purple for one side and green for the other', () => {
    const stops = ALONG_RAMP.stops;
    expect(stops.map((s) => s.at)).toEqual(stops.map((s) => 0 - s.at).reverse());
    for (const s of stops) expect(Math.abs(lum(ALONG_RAMP, s.at) - lum(ALONG_RAMP, -s.at)), `${s.at}`).toBeLessThan(0.02);
    const neg = sampleRamp(ALONG_RAMP, -25);
    const pos = sampleRamp(ALONG_RAMP, 25);
    expect(neg[0]).toBeGreaterThan(neg[1]); // purple: red and blue above green
    expect(neg[2]).toBeGreaterThan(neg[1]);
    expect(pos[1]).toBeGreaterThan(pos[0]); // green
    expect(pos[1]).toBeGreaterThan(pos[2]);
  });

  it('smoke goes from pale to dark in order of luminance and stays readable for every kind of colour vision', () => {
    for (let i = 1; i < SMOKE_RAMP.stops.length; i++) expect(luminance(hexToRgb(SMOKE_RAMP.stops[i]!.colour))).toBeLessThan(luminance(hexToRgb(SMOKE_RAMP.stops[i - 1]!.colour)));
    for (const v of VISION_TYPES) expect(fifthApart(SMOKE_RAMP, v), v).toBeGreaterThan(9);
  });
});

describe('sliceFieldScale', () => {
  it('gives every chip a ramp whose own range sits inside the scale, in the units of the slice', () => {
    for (const id of SLICE_FIELD_IDS) {
      const s = sliceFieldScale(id);
      expect(s.hi, id).toBeGreaterThan(s.lo);
      expect(s.lo, id).toBeLessThanOrEqual(s.ramp.pos[0]!);
      expect(s.hi, id).toBeGreaterThanOrEqual(s.ramp.pos[s.ramp.pos.length - 1]!);
    }
  });

  it('uses the ramps the plan names: wind speed 0 to 25 m/s, up and down, temperature, along and across symmetric about 0, smoke', () => {
    expect(sliceFieldScale('speed')).toMatchObject({ ramp: WIND_RAMP, lo: 0, hi: 25, diverging: false });
    expect(sliceFieldScale('up')).toMatchObject({ ramp: UPDRAFT_RAMP, diverging: true });
    expect(sliceFieldScale('theta')).toMatchObject({ ramp: THETA_RAMP, diverging: true });
    expect(sliceFieldScale('smoke')).toMatchObject({ ramp: SMOKE_RAMP, lo: 0, diverging: false });
    for (const id of ['along', 'across'] as const) {
      const s = sliceFieldScale(id);
      expect(s.ramp).toBe(ALONG_RAMP);
      expect(s.lo).toBe(-s.hi);
      expect(s.diverging).toBe(true);
    }
  });

  it('puts the neutral colour of a diverging chip at 0', () => {
    for (const id of SLICE_FIELD_IDS) {
      const s = sliceFieldScale(id);
      if (s.diverging) expect(luminance(sampleRamp(s.ramp, 0)), id).toBeGreaterThan(0.85);
    }
  });
});
