/** Legends and shader scales of the data-layer heat maps: plain words everywhere, and the ground colours match the legend. */
import { describe, expect, it } from 'vitest';
import { FireHistoryKind, Landform } from '../core/types';
import { ratingFromFhs } from '../fuel/hazard';
import type { OverlayKind } from './layers';
import {
  HAZARD_CLASS_BOUNDS,
  HOME_DENSITY_CLASSES,
  ROAD_ACCESS_CLASSES,
  fmtThousands,
  legendFor,
  niceElevationRange,
  overlayColour,
  overlayScale,
  type LegendSpec,
} from './legends';
import { LANDFORM_COLOURS, LANDFORM_LABELS, TSF_NO_RECORD, hexToRgb } from './palette';

const DATA_KINDS = [
  'elevation',
  'landform',
  'canopyHeight',
  'canopyCover',
  'elevatedHazard',
  'elevatedHeight',
  'surfaceHazard',
  'nearSurfaceHazard',
  'barkHazard',
  'grassCuring',
  'fireHistoryKind',
  'homeDensity',
  'roadAccess',
  'windSpeed',
] as const satisfies readonly OverlayKind[];

const CTX = { elevationRange: [312, 1047] as const };

const texts = (l: LegendSpec): string[] => [
  l.title,
  l.units,
  l.note ?? '',
  ...l.entries.flatMap((e) => [e.label, e.words ?? '', e.colour]),
  l.noData?.label ?? '',
  l.noData?.colour ?? '',
  l.gradient ?? '',
];

const close = (a: readonly number[], b: readonly number[], tol: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

describe('data legends', () => {
  for (const kind of DATA_KINDS) {
    it(`${kind}: plain words, colours and a why-it-matters note`, () => {
      for (const ctx of [{}, CTX]) {
        const l = legendFor(kind, ctx)!;
        expect(l, kind).not.toBeNull();
        expect(l.overlay).toBe(kind);
        expect(l.title.length).toBeGreaterThan(5);
        expect(['continuous', 'classes', 'categorical']).toContain(l.kind);
        expect(l.entries.length).toBeGreaterThanOrEqual(3);
        for (const t of texts(l)) expect(t, `${kind}: ${t}`).not.toMatch(/undefined|NaN|\[object|null/);
        for (const e of l.entries) {
          expect(e.colour).toMatch(/^#[0-9a-f]{6}$/i);
          expect(e.label.trim().length).toBeGreaterThan(0);
          expect(Number.isFinite(e.value)).toBe(true);
        }
        // One teaching sentence.
        expect(l.note, kind).toMatch(/^[A-Z].*\.$/);
        expect(l.note!.match(/[.!?] [A-Z]/), kind).toBeNull();
        if (l.kind === 'continuous') expect(l.gradient).toMatch(/^linear-gradient\(to right, #[0-9a-f]{6} 0%/);
        // Ramps and classes list increasing values; every continuous stop and hazard class carries a plain-English gloss.
        if (l.kind !== 'categorical') for (let i = 1; i < l.entries.length; i++) expect(l.entries[i]!.value).toBeGreaterThan(l.entries[i - 1]!.value);
        if (l.kind === 'continuous' || kind.endsWith('Hazard')) for (const e of l.entries) expect((e.words ?? '').length, `${kind} ${e.label}`).toBeGreaterThan(2);
      }
    });
  }

  it('ramp stops are evenly spaced in value, so the labels line up with the colour bar', () => {
    for (const kind of DATA_KINDS) {
      const l = legendFor(kind, CTX)!;
      if (l.kind !== 'continuous') continue;
      const step = l.entries[1]!.value - l.entries[0]!.value;
      for (let i = 1; i < l.entries.length; i++) expect(l.entries[i]!.value - l.entries[i - 1]!.value, `${kind} stop ${i}`).toBeCloseTo(step, 9);
    }
  });

  it('layers with NO_DATA cells say what the empty cells mean', () => {
    const noData = (k: OverlayKind): string | undefined => legendFor(k)!.noData?.label;
    expect(noData('canopyHeight')).toMatch(/no trees/i);
    expect(noData('elevatedHeight')).toMatch(/no shrub/i);
    expect(noData('grassCuring')).toMatch(/not grass/i);
    for (const k of ['surfaceHazard', 'nearSurfaceHazard', 'elevatedHazard', 'barkHazard'] as const) expect(noData(k)).toMatch(/not fuel/i);
    expect(noData('fireHistoryKind')).toMatch(/no fire on record/i);
    expect(legendFor('fireHistoryKind')!.noData!.colour).toBe(TSF_NO_RECORD);
    expect(noData('homeDensity')).toMatch(/no homes/i);
  });

  it('hazard legends use the standard ratings, in the same colours in every layer', () => {
    const rating = ['Low', 'Moderate', 'High', 'Very high', 'Extreme'];
    const colours = (k: OverlayKind): string[] => legendFor(k)!.entries.filter((e) => rating.includes(e.label)).map((e) => e.colour);
    for (const k of ['surfaceHazard', 'nearSurfaceHazard', 'elevatedHazard', 'barkHazard'] as const) {
      const labels = legendFor(k)!.entries.map((e) => e.label);
      expect(labels.filter((l) => l !== 'None')).toEqual(rating);
      expect(colours(k)).toEqual(colours('barkHazard'));
    }
    expect(legendFor('surfaceHazard')!.entries[0]!.label).toBe('None');
    expect(legendFor('barkHazard')!.entries[0]!.label).toBe('Low');
  });

  it("hazard class boundaries are the fuel module's own OFHAG ratings (ratingFromFhs)", () => {
    const cases = [
      ['surfaceHazard', 'surface'],
      ['nearSurfaceHazard', 'nearSurface'],
      ['elevatedHazard', 'elevated'],
      ['barkHazard', 'bark'],
    ] as const;
    for (const [kind, layer] of cases) {
      const entries = legendFor(kind)!.entries;
      for (let s = 0.01; s < 4; s += 0.05) {
        const cls = [...entries].reverse().find((e) => e.value <= s)!;
        expect(cls.label.toLowerCase(), `${kind} ${s.toFixed(2)}`).toBe(ratingFromFhs(layer, s).toLowerCase());
      }
    }
    expect(HAZARD_CLASS_BOUNDS.fuel.length).toBe(6);
    expect(HAZARD_CLASS_BOUNDS.bark.length).toBe(5);
  });

  it('landform lists every class with a label, in the shader colours', () => {
    const l = legendFor('landform')!;
    expect(l.kind).toBe('categorical');
    const n = Object.keys(Landform).length / 2;
    expect(l.entries.length).toBe(n);
    expect(new Set(l.entries.map((e) => e.value)).size).toBe(n);
    for (const e of l.entries) {
      expect(e.label).toBe(LANDFORM_LABELS[e.value as Landform]);
      expect(e.colour).toBe(LANDFORM_COLOURS[e.value as Landform]);
    }
    expect(l.entries.map((e) => e.label).join(' ')).toMatch(/Ridge top.*Gully.*Valley floor.*Cliff/);
  });

  it('fire history lists wildfire, prescribed burn and back burn, and unrecorded kinds', () => {
    const l = legendFor('fireHistoryKind')!;
    expect(l.kind).toBe('categorical');
    const byCode = new Map(l.entries.map((e) => [e.value, e.label]));
    expect(byCode.get(FireHistoryKind.Wildfire)).toBe('Wildfire');
    expect(byCode.get(FireHistoryKind.PrescribedBurn)).toMatch(/prescribed burn or back burn/i);
    expect(byCode.get(FireHistoryKind.Unknown)).toBeDefined();
  });

  it('home density and road distance classes carry numbers and words', () => {
    const homes = legendFor('homeDensity')!;
    expect(homes.entries.map((e) => e.value)).toEqual([...HOME_DENSITY_CLASSES.bounds]);
    expect(homes.entries[0]!.label).toMatch(/scattered/);
    expect(homes.entries[4]!.label).toMatch(/town centres/);
    const roads = legendFor('roadAccess')!;
    expect(roads.entries.map((e) => e.value)).toEqual([...ROAD_ACCESS_CLASSES.bounds]);
    expect(roads.entries[0]!.label).toMatch(/beside/);
    expect(roads.entries[5]!.label).toMatch(/very remote/);
    expect(roads.units).toBe('m');
  });

  it('wind speed is in km/h with Beaufort-style words', () => {
    const l = legendFor('windSpeed')!;
    expect(l.units).toBe('km/h');
    expect(l.entries[0]!.words).toBe('calm');
    expect(l.entries[l.entries.length - 1]!.words).toBe('gale');
    expect(l.entries[l.entries.length - 1]!.label).toBe('60+');
  });
});

describe('elevation legend and scale', () => {
  it('rounds the site height range outwards to four equal round steps', () => {
    expect(niceElevationRange(312, 1047)).toEqual({ lo: 300, hi: 1100, step: 200 });
    expect(niceElevationRange(0, 1)).toEqual({ lo: 0, hi: 20, step: 5 });
    expect(niceElevationRange(2000.5, 2228)).toEqual({ lo: 2000, hi: 2400, step: 100 });
    expect(niceElevationRange(200, 1093)).toEqual({ lo: 200, hi: 1200, step: 250 });
    expect(niceElevationRange(NaN, NaN).hi).toBeGreaterThan(niceElevationRange(NaN, NaN).lo);
    for (const [min, max] of [[10, 12], [-30, 90], [312, 1047], [0, 4000], [850, 852]] as const) {
      const r = niceElevationRange(min, max);
      expect(r.lo).toBeLessThanOrEqual(min);
      expect(r.hi).toBeGreaterThanOrEqual(max);
      expect(r.hi - r.lo).toBe(4 * r.step);
      expect(Math.abs(r.lo % 5)).toBe(0);
    }
  });

  it('the legend and the shader scale span the same heights, with metres on the labels', () => {
    const l = legendFor('elevation', CTX)!;
    const s = overlayScale('elevation', CTX)!;
    expect(l.entries.length).toBe(5);
    expect(l.entries[0]!.value).toBe(s.lo);
    expect(l.entries[4]!.value).toBe(s.hi);
    expect(l.entries[0]!.label).toBe(fmtThousands(s.lo));
    expect(l.units).toBe('m');
    // The colours at the ends are the ends of the ramp: coolest at the lowest ground, warmest at the highest.
    const low = overlayColour(s, s.lo + 1)!;
    const high = overlayColour(s, s.hi - 1)!;
    expect(low[2]).toBeGreaterThan(low[0]);
    expect(high[0]).toBeGreaterThan(high[2]);
    // Another site gets another scale from the same LUT.
    const s2 = overlayScale('elevation', { elevationRange: [40, 300] })!;
    expect(s2.lut).toBe(s.lut);
    expect(s2.lo).not.toBe(s.lo);
    expect(overlayScale('elevation', CTX)!.lo).toBe(s.lo);
  });

  it('without a range the legend only says lowest to highest (no wrong heights) and colours still match', () => {
    const l = legendFor('elevation')!;
    expect(l.entries.map((e) => e.label)).toEqual(['Lowest', 'Middle', 'Highest']);
    expect(l.entries.map((e) => e.words)).toEqual(['lowest ground', 'in between', 'highest ground']);
    const s = overlayScale('elevation')!;
    expect(s.hi).toBeGreaterThan(s.lo);
  });

  it('formats thousands with a space', () => {
    expect(fmtThousands(1200)).toBe('1 200');
    expect(fmtThousands(999)).toBe('999');
    expect(fmtThousands(-15)).toBe('−15');
  });
});

describe('the ground colours are the legend colours (shader LUT)', () => {
  const rgbOf = (hex: string): number[] => hexToRgb(hex);

  it('classes: the middle of each class has the class colour', () => {
    for (const kind of ['surfaceHazard', 'nearSurfaceHazard', 'elevatedHazard', 'barkHazard', 'homeDensity', 'roadAccess'] as const) {
      const l = legendFor(kind)!;
      const s = overlayScale(kind)!;
      expect(s.mode).toBe('classes');
      const top = kind.endsWith('Hazard') ? 4 : kind === 'homeDensity' ? 30 : 1500;
      l.entries.forEach((e, i) => {
        const next = l.entries[i + 1]?.value ?? top;
        const mid = kind === 'homeDensity' ? Math.sqrt(e.value * next) : (e.value + next) / 2;
        const c = overlayColour(s, mid)!;
        expect(close(c.slice(0, 3), rgbOf(e.colour), 1.5 / 255), `${kind} ${e.label}`).toBe(true);
      });
    }
  });

  it('classes switch exactly at the OFHAG rating boundaries', () => {
    const s = overlayScale('surfaceHazard')!;
    const at = (v: number): number[] => overlayColour(s, v)!.slice(0, 3);
    const col = (label: string): number[] => rgbOf(legendFor('surfaceHazard')!.entries.find((e) => e.label === label)!.colour);
    expect(close(at(0.45), col('None'), 1.5 / 255)).toBe(true);
    expect(close(at(0.55), col('Low'), 1.5 / 255)).toBe(true);
    expect(close(at(1.45), col('Low'), 1.5 / 255)).toBe(true);
    expect(close(at(1.55), col('Moderate'), 1.5 / 255)).toBe(true);
    expect(close(at(3.3), col('Very high'), 1.5 / 255)).toBe(true);
    expect(close(at(3.9), col('Extreme'), 1.5 / 255)).toBe(true);
  });

  it('ramps: the stops have the legend colours', () => {
    for (const kind of ['canopyHeight', 'canopyCover', 'elevatedHeight', 'grassCuring', 'windSpeed'] as const) {
      const l = legendFor(kind)!;
      const s = overlayScale(kind)!;
      expect(s.mode).toBe('ramp');
      expect(s.lo).toBe(l.entries[0]!.value);
      expect(s.hi).toBe(l.entries[l.entries.length - 1]!.value);
      for (const e of l.entries) {
        const c = overlayColour(s, Math.min(e.value, s.hi - 1e-6))!;
        expect(close(c.slice(0, 3), rgbOf(e.colour), 8 / 255), `${kind} ${e.label}`).toBe(true);
      }
    }
  });

  it('categorical maps: every code has its colour; no-data is the grey (fire history) or clear', () => {
    for (const kind of ['landform', 'fireHistoryKind'] as const) {
      const l = legendFor(kind)!;
      const s = overlayScale(kind)!;
      expect(s.mode).toBe('categorical');
      for (const e of l.entries) expect(close(overlayColour(s, e.value)!.slice(0, 3), rgbOf(e.colour), 1.5 / 255), `${kind} ${e.label}`).toBe(true);
    }
    expect(overlayColour(overlayScale('landform')!, -1e30)).toBeNull();
    const nd = overlayColour(overlayScale('fireHistoryKind')!, -1e30)!;
    expect(close(nd.slice(0, 3), rgbOf(TSF_NO_RECORD), 1.5 / 255)).toBe(true);
    for (const k of ['canopyHeight', 'canopyCover', 'surfaceHazard', 'grassCuring', 'homeDensity', 'roadAccess', 'windSpeed'] as const) expect(overlayColour(overlayScale(k)!, -1e30), k).toBeNull();
  });

  it('the tree colours can share these scales: canopy and hazard scales are linear ramps or classes over the attribute range', () => {
    const cases = [
      ['canopyHeight', 0, 40, 'ramp'],
      ['canopyCover', 0, 100, 'ramp'],
      ['barkHazard', 0, 4, 'classes'],
      ['elevatedHazard', 0, 4, 'classes'],
    ] as const;
    for (const [kind, lo, hi, mode] of cases) {
      const s = overlayScale(kind)!;
      expect([s.lo, s.hi, s.mode, s.log]).toEqual([lo, hi, mode, false]);
    }
  });
});
