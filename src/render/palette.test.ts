/** Heat-map palettes: cool-to-warm order, colour-blind safety, consistent hazard colours. */
import { describe, expect, it } from 'vitest';
import { FireHistoryKind, Landform } from '../core/types';
import { VISION_TYPES, deltaE, minPairDistance, simulateVision, toLab } from './colourVision';
import {
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
  TSF_NO_RECORD,
  WIND_SPEED_RAMP,
  amountClassColours,
  amountRamp,
  hexToRgb,
  sampleRamp,
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
