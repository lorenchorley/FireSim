/**
 * The Wind speed map at the Wind height (0.7.0, E1b): the values the heat map paints while the arrows are on. `'fire'` is the 10 m map bit for bit, a
 * height is the sampler's `windP` at the ground plus that height (km/h), What the fire feels is the Int16 `fireWind` read as it is, and a picture with no
 * `fireWind` shows the 10 m wind for it. Also the scale and the legend that go with the field (range 60 or 90 km/h, one set of colours).
 */
import { describe, expect, it } from 'vitest';
import { FIRE_WIND_QUANTUM, fireWindGrid } from '../../core/fireWind';
import { makeGridSpec } from '../../core/grid';
import type { FireWindRaster } from '../../core/types';
import { AtmosphereSampler } from '../atmosphereSampler';
import { NO_DATA, legendFor, overlayColour, overlayScale, windSpeedRangeKmh } from '../legends';
import { WIND_HEIGHTS, type WindHeight } from './glyphTypes';
import { overlayField } from '../fields';
import { HeightRaster } from './glyphField';
import { bilinear, groundOf, ORIGIN } from './glyphOracle.testing';
import { makeAirView } from '../slice/testing';
import { DEFAULT_LAYERS, shownWindHeight, windMapHeight } from '../layers';
import { fieldRange, windMapField, windMapSource, type WindMapSources } from './windMapField';

const GRID = makeGridSpec(ORIGIN, 45 * 133, 133);
const BASE = 500;
const hills = (x: number, y: number): number => BASE + 220 + 150 * Math.sin(x / 800) * Math.cos(y / 650);
const GROUND = groundOf({ nx: 150, ny: 150, cellSize: 40, x0: GRID.x0, y0: GRID.y0, origin: ORIGIN }, (x, y) => hills(x, y) + 12 * Math.sin(x / 90 + y / 70));

const atm = () =>
  makeAirView({
    grid: GRID,
    baseM: BASE,
    topM: 3000,
    groundAt: (x, y) => hills(x, y) - 25,
    u: (x, y, z) => 6 + 3 * Math.sin(x / 700 + z / 900) + 0.002 * y,
    v: (x, _y, z) => 1 + 2 * Math.cos(x / 600 - z / 700),
    w: () => 0.3,
  });

/** A 60 m fire-felt picture of a 6 km, 30 m fire grid: block centres 15 m in, 100 x 100 cells, a wind that grows to the north-east. */
function felt(): FireWindRaster {
  const fire = { nx: 200, ny: 200, cellSize: 30, x0: GRID.x0, y0: GRID.y0, origin: ORIGIN };
  const grid = fireWindGrid(fire, 2);
  const n = grid.nx * grid.ny;
  const u = new Int16Array(n);
  const v = new Int16Array(n);
  for (let j = 0; j < grid.ny; j++)
    for (let i = 0; i < grid.nx; i++) {
      u[j * grid.nx + i] = Math.round((2 + i * 0.1) / FIRE_WIND_QUANTUM);
      v[j * grid.nx + i] = Math.round((-1 + j * 0.05) / FIRE_WIND_QUANTUM);
    }
  return { grid, u, v, block: 2, time: 600 };
}

const sources = (over: Partial<WindMapSources> = {}): WindMapSources => {
  const a = atm();
  return { atm: a, sampler: new AtmosphereSampler(a, BASE, null), ground10: GROUND, fireWind: null, ...over };
};
const KMH = 3.6;

describe("'fire': the 10 m map, as it has always been", () => {
  it('is hypot(surfaceU, surfaceV) x 3.6 on the atmosphere grid, bit for bit what the heat map made before', () => {
    const s = sources();
    for (let k = 0; k < s.atm!.surfaceU.length; k++) {
      s.atm!.surfaceU[k] = 4 + 3 * Math.sin(k * 0.37);
      s.atm!.surfaceV[k] = -2 + 2 * Math.cos(k * 0.11);
    }
    const f = windMapField(s, 'fire', null)!;
    expect(f.grid).toBe(s.atm!.grid);
    expect(f.categorical).toBe(false);
    const old = overlayField('windSpeed', { terrain: undefined as never, fuel: undefined as never, atmosphere: s.atm })!;
    expect(f.values).toEqual(old.values);
  });

  it('is null with no air, and for a surface wind that does not cover its grid', () => {
    expect(windMapField(sources({ atm: null }), 'fire', null)).toBeNull();
    const a = atm();
    expect(windMapField(sources({ atm: { ...a, surfaceU: new Float32Array(3) } }), 'fire', null)).toBeNull();
  });

  it('a non-finite texel is NO_DATA', () => {
    const s = sources();
    s.atm!.surfaceU[7] = NaN;
    s.atm!.surfaceV[9] = Infinity;
    const f = windMapField(s, 'fire', null)!;
    expect(f.values[7]).toBe(NO_DATA);
    expect(f.values[9]).toBe(NO_DATA);
    expect(Number.isFinite(f.values[8])).toBe(true);
  });
});

describe('a height above the ground', () => {
  const hr = new HeightRaster();
  it('is the sampler’s windP at ground + h, in km/h, within 1e-4 km/h, on the atmosphere grid', () => {
    const s = sources();
    for (const h of [50, 100, 300, 1000, 2000] as const) {
      const f = windMapField(s, h, hr)!;
      expect(f.grid.nx).toBe(GRID.nx);
      expect(f.grid.cellSize).toBeCloseTo(GRID.cellSize, 9);
      const ref = new HeightRaster().fill(s.sampler!, GROUND, h, 1);
      let worst = 0;
      for (let k = 0; k < f.values.length; k++) worst = Math.max(worst, Math.abs(f.values[k]! - Math.hypot(ref.u[k]!, ref.v[k]!) * KMH));
      expect(worst, String(h)).toBeLessThan(1e-4);
    }
  });

  it('makes its own height raster when it is not given one, and reuses `out` when it is the right size', () => {
    const s = sources();
    const a = windMapField(s, 300, null)!;
    const out = new Float32Array(GRID.nx * GRID.ny);
    const b = windMapField(s, 300, hr, out)!;
    expect(b.values).toBe(out);
    expect(b.values).toEqual(a.values);
    const wrong = new Float32Array(10);
    expect(windMapField(s, 300, hr, wrong)!.values).not.toBe(wrong); // a size that does not fit is not written into
  });

  it('needs the air and the ground: null without a sampler with wind, or without the 10 m ground', () => {
    expect(windMapField(sources({ sampler: null }), 100, hr)).toBeNull();
    expect(windMapField(sources({ ground10: null }), 100, hr)).toBeNull();
  });

  it('differs between heights (the wind is not the same at 50 m and at 2 km)', () => {
    const s = sources();
    const lo = windMapField(s, 50, hr)!.values.slice();
    const hi = windMapField(s, 2000, hr)!.values;
    let diff = 0;
    for (let k = 0; k < lo.length; k++) diff = Math.max(diff, Math.abs(lo[k]! - hi[k]!));
    expect(diff).toBeGreaterThan(1);
  });
});

describe('What the fire feels', () => {
  it('is the Int16 picture read as it is, on its own 60 m grid, in km/h (no decode, no copy of the arrays)', () => {
    const fw = felt();
    const f = windMapField(sources({ fireWind: fw }), 'felt', null)!;
    expect(f.grid).toBe(fw.grid);
    expect(f.grid.nx).toBe(100);
    expect(f.grid.cellSize).toBe(60);
    expect(f.grid.x0).toBe(GRID.x0 + 15);
    expect(f.values).toHaveLength(100 * 100);
    for (const k of [0, 1, 55, 9999]) expect(f.values[k]).toBeCloseTo(Math.hypot(fw.u[k]! * FIRE_WIND_QUANTUM, fw.v[k]! * FIRE_WIND_QUANTUM) * KMH, 5);
  });

  it('is not the 10 m map: its own raster, its own grid', () => {
    const s = sources({ fireWind: felt() });
    expect(windMapField(s, 'felt', null)!.grid).not.toBe(windMapField(s, 'fire', null)!.grid);
    expect(windMapSource('felt', s.fireWind)).toBe('felt');
  });

  it('with no picture of it (or one that is too short) is the 10 m map, the same fallback as the arrows', () => {
    const s = sources();
    for (const fw of [null, undefined, { ...felt(), u: new Int16Array(4) }]) {
      const f = windMapField({ ...s, fireWind: fw }, 'felt', null)!;
      expect(f.values).toEqual(windMapField(s, 'fire', null)!.values);
      expect(windMapSource('felt', fw)).toBe('surface');
    }
  });

  it('reuses `out` and allocates no array of its own with it', () => {
    const fw = felt();
    const out = new Float32Array(100 * 100);
    const f = windMapField(sources({ fireWind: fw }), 'felt', null, out)!;
    expect(f.values).toBe(out);
  });

  it('a height raster is never made for it (it reads the picture)', () => {
    let begun = 0;
    const hr = new HeightRaster();
    const begin = hr.begin.bind(hr);
    hr.begin = (...a: Parameters<HeightRaster['begin']>) => {
      begun++;
      begin(...a);
    };
    windMapField(sources({ fireWind: felt() }), 'felt', hr);
    windMapField(sources(), 'fire', hr);
    expect(begun).toBe(0);
  });
});

describe('which raster a height reads, and the height that is shown', () => {
  it('says surface for 10 m, felt only with a usable picture, height for every number', () => {
    expect(windMapSource('fire', felt())).toBe('surface');
    expect(windMapSource('felt', felt())).toBe('felt');
    expect(windMapSource('felt', null)).toBe('surface');
    for (const h of [50, 100, 300, 1000, 2000] as const) expect(windMapSource(h, felt()), String(h)).toBe('height');
  });

  it('shownWindHeight keeps every height but What the fire feels without a picture, which is the 10 m wind', () => {
    for (const h of WIND_HEIGHTS) expect(shownWindHeight(h, true), String(h)).toBe(h);
    for (const h of WIND_HEIGHTS) expect(shownWindHeight(h, false), String(h)).toBe(h === 'felt' ? 'fire' : h);
  });

  it('with the arrows off the map is the 10 m one, whatever the Wind height says (the Wind speed map is then today’s, bit for bit)', () => {
    for (const h of WIND_HEIGHTS) expect(shownWindHeight(windMapHeight({ windGlyphs: false, windHeight: h }), true)).toBe('fire');
    expect(DEFAULT_LAYERS.windHeight).toBe('felt');
  });
});

describe('the range of a field', () => {
  it('is the smallest and largest finite value, ignoring NO_DATA, and null for none', () => {
    const grid = makeGridSpec(ORIGIN, 400, 100);
    const values = new Float32Array(grid.nx * grid.ny).fill(NO_DATA);
    values[3] = 12.5;
    values[8] = 40;
    values[9] = 0;
    expect(fieldRange({ grid, values, categorical: false })).toEqual({ min: 0, max: 40 });
    expect(fieldRange({ grid, values: new Float32Array(values.length).fill(NO_DATA), categorical: false })).toBeNull();
  });
});

describe('the scale and the legend of the map at each height', () => {
  const HEIGHTS: readonly WindHeight[] = ['felt', 'fire', 50, 100, 300, 1000, 2000];

  it('the colours are one set over 0 to 60 km/h, or 0 to 90 from 300 m: the same colour at the same fraction', () => {
    const lo = overlayScale('windSpeed', { windHeight: 'fire' })!;
    const hi = overlayScale('windSpeed', { windHeight: 300 })!;
    expect([lo.lo, lo.hi, hi.lo, hi.hi]).toEqual([0, 60, 0, 90]);
    expect(hi.lut).toBe(lo.lut);
    for (const f of [0, 0.1, 0.33, 0.5, 0.9, 1]) {
      expect(overlayColour(hi, f * 90)).toEqual(overlayColour(lo, f * 60));
    }
    for (const h of HEIGHTS) expect(overlayScale('windSpeed', { windHeight: h })!.hi, String(h)).toBe(windSpeedRangeKmh(h));
  });

  it('the default is the 10 m scale, the one the map has always had, and a 60 km/h scale is the cached object itself', () => {
    const a = overlayScale('windSpeed')!;
    expect(a.hi).toBe(60);
    expect(overlayScale('windSpeed', {})).toBe(a);
    expect(overlayScale('windSpeed', { windHeight: 'felt' })).toBe(a);
    // The wide scale does not leak into the narrow one (the cache holds the 60 km/h scale).
    overlayScale('windSpeed', { windHeight: 2000 });
    expect(overlayScale('windSpeed', { windHeight: 'fire' })!.hi).toBe(60);
  });

  it('the legend stops are the LUT colours at the same fractions, and end at 60+ or 90+', () => {
    for (const h of HEIGHTS) {
      const lg = legendFor('windSpeed', { windHeight: h })!;
      const sc = overlayScale('windSpeed', { windHeight: h })!;
      const top = windSpeedRangeKmh(h);
      expect(lg.entries.map((e) => e.value)).toEqual(top === 90 ? [0, 15, 30, 45, 60, 75, 90] : [0, 10, 20, 30, 40, 50, 60]);
      expect(lg.entries.at(-1)!.label).toBe(`${top}+`);
      for (const e of lg.entries) {
        const c = overlayColour(sc, Math.min(e.value, top - 1e-6))!;
        const hex = `#${c
          .slice(0, 3)
          .map((x) => Math.round(x * 255).toString(16).padStart(2, '0'))
          .join('')}`;
        // (the LUT has 256 texels: a stop's colour is within a couple of units of the texel it falls in)
        const want = e.colour.replace('#', '');
        for (let i = 0; i < 3; i++) expect(Math.abs(parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) - parseInt(want.slice(2 * i, 2 * i + 2), 16)), `${String(h)} ${e.value}`).toBeLessThanOrEqual(12);
      }
    }
  });

  it('says which wind it is in the title, with the Beaufort words at 10 m only', () => {
    const title = (h?: WindHeight): string => legendFor('windSpeed', h === undefined ? {} : { windHeight: h })!.title;
    expect(title()).toBe('Wind speed near the ground');
    expect(title('fire')).toBe('Wind speed near the ground');
    expect(title('felt')).toBe('Wind speed the fire feels');
    expect(title(50)).toBe('Wind speed at 50 m');
    expect(title(100)).toBe('Wind speed at 100 m');
    expect(title(1000)).toBe('Wind speed at 1 km');
    expect(title(2000)).toBe('Wind speed at 2 km');
    expect(legendFor('windSpeed', { windHeight: 'fire' })!.entries.map((e) => e.words)).toContain('light breeze');
    for (const h of HEIGHTS.filter((x) => x !== 'fire')) expect(legendFor('windSpeed', { windHeight: h })!.entries.every((e) => !e.words), String(h)).toBe(true);
  });

  it('the notes say which wind and are plain words (no dash, a full stop); the 10 m note keeps its calm-night sentence', () => {
    for (const h of HEIGHTS) {
      const n = legendFor('windSpeed', { windHeight: h })!.note!;
      expect(n, String(h)).toMatch(/\.$/);
      expect(n, String(h)).not.toMatch(/[—–]/);
    }
    expect(legendFor('windSpeed', { windHeight: 'fire' })!.note).toContain('on a calm night can differ a lot from the wind the fire feels');
    expect(legendFor('windSpeed', { windHeight: 'felt' })!.note).toContain('60 m cell');
    expect(legendFor('windSpeed', { windHeight: 'felt' })!.note).toContain('not a measurement');
    expect(legendFor('windSpeed', { windHeight: 300 })!.note).toContain('about 300 m above the ground');
  });

  it('the 10 m legend is what it was (title, units, stops, words, gradient)', () => {
    const a = legendFor('windSpeed')!;
    const b = legendFor('windSpeed', { windHeight: 'fire' })!;
    expect(b).toEqual(a);
    expect(a.units).toBe('km/h');
    expect(a.entries.map((e) => e.label)).toEqual(['0', '10', '20', '30', '40', '50', '60+']);
  });
});

describe('the field is bilinear-compatible with the arrows’ raster (a sanity check on what the map paints)', () => {
  it('at a cell centre the felt map equals the speed of the picture there', () => {
    const fw = felt();
    const f = windMapField(sources({ fireWind: fw }), 'felt', null)!;
    const g = f.grid;
    const k = 37 * g.nx + 21;
    const [u, v] = bilinear({ grid: g, u: Float32Array.from(fw.u, (q) => q * FIRE_WIND_QUANTUM), v: Float32Array.from(fw.v, (q) => q * FIRE_WIND_QUANTUM) }, g.x0 + 21 * g.cellSize, g.y0 + 37 * g.cellSize);
    expect(f.values[k]).toBeCloseTo(Math.hypot(u, v) * KMH, 4);
  });
});
