import { describe, expect, it } from 'vitest';
import { FuelType, SpreadDriver } from '../core/types';
import type { OverlayKind } from './layers';
import { NO_DATA, crossSectionLegend, formatDuration, legendFor, niceArrivalMax, overlayColour, overlayScale, windLegend } from './legends';
import { FUEL_TYPE_COLOURS, INTENSITY_CLASSES, MOISTURE_RAMP, hexToRgb } from './palette';

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
