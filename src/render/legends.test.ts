import { describe, expect, it } from 'vitest';
import { FuelType, SpreadDriver } from '../core/types';
import type { OverlayKind } from './layers';
import { NO_DATA, crossSectionLegend, formatDuration, legendFor, niceArrivalMax, overlayColour, overlayScale, sliceLegend, windLegend } from './legends';
import { FUEL_TYPE_COLOURS, INTENSITY_CLASSES, MOISTURE_RAMP, hexToRgb, sampleRamp, sliceFieldScale } from './palette';
import { SLICE_FIELD_IDS } from './slice/types';

const ALL: OverlayKind[] = ['arrival', 'ros', 'intensity', 'driver', 'moisture', 'fuelLoad', 'fuelType', 'timeSinceFire', 'slope', 'aspect', 'insolation'];

const close = (a: number[], b: number[], tol = 1.5 / 255): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

describe('legendFor', () => {
  it('returns null for none and a legend for every overlay', () => {
    expect(legendFor('none')).toBeNull();
    for (const o of ALL) {
      const l = legendFor(o)!;
      expect(l.overlay).toBe(o);
      expect(l.title.length).toBeGreaterThan(3);
      expect(l.entries.length).toBeGreaterThanOrEqual(3);
      for (const e of l.entries) expect(e.colour).toMatch(/^#[0-9a-f]{6}/i);
      if (l.kind === 'continuous' || l.kind === 'classes') {
        for (let i = 1; i < l.entries.length; i++) expect(l.entries[i]!.value).toBeGreaterThan(l.entries[i - 1]!.value);
      }
      if (l.kind === 'continuous' || l.kind === 'cyclic') expect(l.gradient).toMatch(/^linear-gradient/);
    }
  });

  it('arrival legend spans the elapsed time with nice labels', () => {
    const l = legendFor('arrival', { arrivalMaxSeconds: 2.2 * 3600, isochroneMinutes: 30 })!;
    expect(l.entries[0]!.label).toBe('0 min');
    expect(l.entries[l.entries.length - 1]!.value).toBe(niceArrivalMax(2.2 * 3600));
    expect(l.note).toContain('30 min');
  });

  it('slope legend teaches the model limit and flame attachment thresholds', () => {
    const l = legendFor('slope')!;
    expect(l.entries.some((e) => e.value === 20 && /beyond/i.test(e.label))).toBe(true);
    expect(l.entries.some((e) => e.value === 25 && /attach/i.test(e.label))).toBe(true);
  });

  it('section and wind legends exist', () => {
    expect(crossSectionLegend().entries.length).toBeGreaterThan(4);
    expect(windLegend('surface').units).toBe('km/h');
    expect(windLegend('volume').units).toBe('m/s');
  });
});

describe('sliceLegend (one legend for every chip of the air slice)', () => {
  const KINDS = ['prognostic', 'diagnosed'] as const;

  it('has a legend for every chip and both kinds of air, with evenly spaced labels that sit under their colours', () => {
    for (const id of SLICE_FIELD_IDS)
      for (const kind of KINDS) {
        const l = sliceLegend(id, kind);
        const s = sliceFieldScale(id);
        expect(l.overlay).toBe('slice');
        expect(l.kind).toBe('continuous');
        expect(l.title.length, `${id} title`).toBeGreaterThan(3);
        expect(l.entries.length, id).toBeGreaterThanOrEqual(3);
        expect(l.gradient, id).toMatch(/^linear-gradient/);
        expect(l.note, id).toBeTruthy();
        // Evenly spaced along the bar: in value, or in tenfold steps for the log scale of smoke.
        const place = (v: number): number => (s.ramp.log ? Math.log10(v) : v);
        const step = place(l.entries[1]!.value) - place(l.entries[0]!.value);
        for (let i = 0; i < l.entries.length; i++) {
          const e = l.entries[i]!;
          expect(e.colour, id).toMatch(/^#[0-9a-f]{6}$/i);
          if (i > 0) expect(place(e.value) - place(l.entries[i - 1]!.value), `${id} spacing`).toBeCloseTo(step, 9);
          // The colour of a label is the colour the curtain and the panel draw at that value.
          const v = l.units === 'km/h' ? e.value / 3.6 : e.value;
          expect(close(hexToRgb(e.colour), sampleRamp(s.ramp, v), 1.5 / 255), `${id} ${e.value}`).toBe(true);
        }
        // The ends of the labels are the ends of the scale.
        const toMs = (v: number): number => (l.units === 'km/h' ? v / 3.6 : v);
        expect(toMs(l.entries[0]!.value), id).toBeCloseTo(s.lo, 6);
        expect(toMs(l.entries[l.entries.length - 1]!.value), id).toBeCloseTo(s.hi, 6);
        expect(l.entries[0]!.words, id).toBeTruthy();
        expect(l.entries[l.entries.length - 1]!.words, id).toBeTruthy();
      }
  });

  it('wind speed is in km/h like the wind streaks, up and down in m/s, temperature in kelvin, smoke in no unit (the model’s own scale)', () => {
    expect(sliceLegend('speed', 'prognostic').units).toBe('km/h');
    expect(sliceLegend('along', 'prognostic').units).toBe('km/h');
    expect(sliceLegend('across', 'prognostic').units).toBe('km/h');
    expect(sliceLegend('up', 'prognostic').units).toBe('m/s');
    expect(sliceLegend('theta', 'prognostic').units).toBe('K');
    expect(sliceLegend('smoke', 'prognostic').units).toBe('');
    expect(sliceLegend('speed', 'prognostic').entries.map((e) => e.label)).toEqual(['0', '30', '60', '90']);
    expect(sliceLegend('along', 'prognostic').entries.map((e) => e.label)).toEqual(['-90', '-60', '-30', '0', '+30', '+60', '+90']);
  });

  it('the temperature legend says warmer or cooler than the average of the slice at that height, not "vs surroundings"', () => {
    const l = sliceLegend('theta', 'prognostic');
    expect(l.title).toBe('Warmer or cooler than the average of the slice at that height');
    expect(JSON.stringify(l)).not.toMatch(/vs surroundings/i);
    expect(l.note).toMatch(/warmer or cooler than the rest of the section at the same height/i);
    expect(crossSectionLegend().title).toBe(l.title);
  });

  it('along and across say which way is which, in words', () => {
    expect(sliceLegend('along', 'prognostic').entries[0]!.words).toBe('blowing towards A');
    expect(sliceLegend('along', 'prognostic').entries[6]!.words).toBe('blowing towards B');
    expect(sliceLegend('across', 'prognostic').entries[0]!.words).toBe('blowing to the left');
    expect(sliceLegend('across', 'prognostic').entries[6]!.words).toBe('blowing to the right');
  });

  it('the 3-D atmosphere mentions the cyan reverse-flow arrows; the fast model says what it is and has none', () => {
    for (const id of SLICE_FIELD_IDS) {
      expect(sliceLegend(id, 'prognostic').note, id).toMatch(/cyan arrows blow against the main wind/i);
      const d = sliceLegend(id, 'diagnosed').note!;
      expect(d, id).toContain('Diagnosed wind: terrain effects only');
      expect(d, id).not.toMatch(/cyan/i);
    }
  });

  it('is written in plain words: no em dash, sentences that end', () => {
    for (const id of SLICE_FIELD_IDS)
      for (const kind of KINDS) {
        const l = sliceLegend(id, kind);
        expect(JSON.stringify(l), `${id} ${kind}`).not.toMatch(/[—–]/);
        expect(l.note, `${id} ${kind}`).toMatch(/\.$/);
      }
  });
});

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(90 * 60)).toBe('1 h 30');
    expect(formatDuration(6 * 3600)).toBe('6 h');
  });
  it('rounds the arrival range to nice steps', () => {
    expect(niceArrivalMax(100)).toBe(900);
    expect(niceArrivalMax(3700)).toBe(4500);
    expect(niceArrivalMax(5 * 3600 + 10)).toBe(5.5 * 3600);
    expect(niceArrivalMax(7 * 3600 + 10)).toBe(8 * 3600);
  });
});

describe('overlayScale (shader LUT) matches the legend', () => {
  it('continuous ramps reproduce the legend stop colours', () => {
    const s = overlayScale('moisture')!;
    for (const st of MOISTURE_RAMP.stops.slice(1, -1)) {
      const c = overlayColour(s, st.at)!;
      // Within one LUT texel of the stop: allow a small tolerance.
      expect(close(c.slice(0, 3), hexToRgb(st.colour), 0.05)).toBe(true);
    }
  });

  it('intensity classes switch exactly at the suppression boundaries', () => {
    const s = overlayScale('intensity')!;
    const cls = (i: number): number[] => hexToRgb(INTENSITY_CLASSES.stops[i]!.colour);
    expect(close(overlayColour(s, 400)!.slice(0, 3), cls(0))).toBe(true);
    expect(close(overlayColour(s, 600)!.slice(0, 3), cls(1))).toBe(true);
    expect(close(overlayColour(s, 3000)!.slice(0, 3), cls(2))).toBe(true);
    expect(close(overlayColour(s, 5000)!.slice(0, 3), cls(3))).toBe(true);
    expect(close(overlayColour(s, 20000)!.slice(0, 3), cls(4))).toBe(true);
    expect(close(overlayColour(s, 50000)!.slice(0, 3), cls(5))).toBe(true);
  });

  it('categorical overlays map codes to their colours; unburnt driver is transparent', () => {
    const f = overlayScale('fuelType')!;
    expect(close(overlayColour(f, FuelType.Heath)!.slice(0, 3), hexToRgb(FUEL_TYPE_COLOURS[FuelType.Heath]))).toBe(true);
    const d = overlayScale('driver')!;
    expect(overlayColour(d, SpreadDriver.None)).toBeNull();
    expect(overlayColour(d, SpreadDriver.Slope)).not.toBeNull();
  });

  it('aspect is cyclic and flat cells use the no-data colour', () => {
    const s = overlayScale('aspect')!;
    const a = overlayColour(s, 1)!;
    const b = overlayColour(s, 359)!;
    expect(close(a.slice(0, 3), b.slice(0, 3), 0.08)).toBe(true);
    expect(overlayColour(s, NO_DATA)).not.toBeNull();
    expect(overlayColour(s, NaN)).not.toBeNull();
  });

  it('time since fire shows a no-record colour; fire overlays are transparent where unburnt', () => {
    expect(overlayColour(overlayScale('timeSinceFire')!, NO_DATA)).not.toBeNull();
    expect(overlayColour(overlayScale('ros')!, NO_DATA)).toBeNull();
  });

  it('arrival LUT follows the requested range', () => {
    const s = overlayScale('arrival', { arrivalMaxSeconds: 3600 })!;
    expect(s.hi).toBe(3600);
    expect(s.lut.length).toBe(256 * 4);
  });
});
