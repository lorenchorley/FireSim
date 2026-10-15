import { describe, expect, it } from 'vitest';
import { analyticTerrain } from '../atmosphere/testUtils';
import { buildAtmosGrid } from '../atmosphere/grid';
import { AIR_STALE_S, airAgeS, airHas, airKind, airLayout, airTime, cellHeightAsl, hasAirWind } from './airView';
import { makeGridSpec } from './grid';
import type { AtmosphereView } from './types';

const grid = makeGridSpec({ lat: -33.7, lon: 150.3 }, 400, 100); // 4 x 4 columns
const plane = grid.nx * grid.ny;

/** A view as the producers made it before the optional fields existed (flat layout, no kind, no datum). */
function legacyView(nz: number, extra: Partial<AtmosphereView> = {}): AtmosphereView {
  const n = plane * nz;
  return {
    grid,
    nz,
    levels: Float32Array.from({ length: nz }, (_, k) => 20 + 40 * k),
    terrainHeight: new Float32Array(plane),
    surfaceU: new Float32Array(plane),
    surfaceV: new Float32Array(plane),
    u: new Float32Array(n),
    v: new Float32Array(n),
    w: new Float32Array(n),
    thetaAnomaly: new Float32Array(n),
    smoke: new Float32Array(n),
    ...extra,
  };
}

describe('airKind', () => {
  it('gives a view with no kind its old meaning', () => {
    expect(airKind(legacyView(5))).toBe('prognostic');
    expect(airKind(legacyView(0))).toBe('surface');
  });
  it('reads an explicit kind first', () => {
    expect(airKind(legacyView(5, { kind: 'diagnosed' }))).toBe('diagnosed');
    expect(airKind(legacyView(5, { kind: 'prognostic' }))).toBe('prognostic');
  });
  it('says none for no view', () => {
    expect(airKind(null)).toBe('none');
    expect(airKind(undefined)).toBe('none');
  });
});

describe('airLayout', () => {
  it('is flat unless the view says otherwise', () => {
    expect(airLayout(legacyView(5))).toBe('flat');
    expect(airLayout(legacyView(5, { layout: 'terrain-following' }))).toBe('terrain-following');
    expect(airLayout(null)).toBe('flat');
  });
});

describe('airHas and hasAirWind', () => {
  it('finds every field of a full 3-D view', () => {
    const v = legacyView(5);
    expect(airHas(v, 'wind')).toBe(true);
    expect(airHas(v, 'theta')).toBe(true);
    expect(airHas(v, 'smoke')).toBe(true);
    expect(hasAirWind(v)).toBe(true);
  });
  it('finds only the wind of a diagnosed view, whose temperature and smoke arrays are empty', () => {
    const v = legacyView(5, { kind: 'diagnosed', thetaAnomaly: new Float32Array(0), smoke: new Float32Array(0) });
    expect(airHas(v, 'wind')).toBe(true);
    expect(airHas(v, 'theta')).toBe(false);
    expect(airHas(v, 'smoke')).toBe(false);
    expect(hasAirWind(v)).toBe(true);
  });
  it('finds nothing in a surface-only view (nz 0) or when there is no view', () => {
    const surface = legacyView(0, { u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0), thetaAnomaly: new Float32Array(0), smoke: new Float32Array(0) });
    for (const f of ['wind', 'theta', 'smoke'] as const) {
      expect(airHas(surface, f)).toBe(false);
      expect(airHas(null, f)).toBe(false);
    }
    expect(hasAirWind(surface)).toBe(false);
    expect(hasAirWind(undefined)).toBe(false);
  });
  it('does not trust an array shorter than the volume', () => {
    const v = legacyView(5, { w: new Float32Array(plane * 5 - 1) });
    expect(airHas(v, 'wind')).toBe(false);
    expect(airHas(v, 'theta')).toBe(true);
  });
});

describe('cellHeightAsl', () => {
  it('adds the datum to the level height in the flat layout', () => {
    const v = legacyView(5, { baseM: 250 });
    expect(cellHeightAsl(v, 3, 2)).toBe(250 + 100);
    expect(cellHeightAsl(v, 3, 2, 300)).toBe(300 + 100); // an explicit datum wins
    expect(cellHeightAsl(legacyView(5), 3, 2)).toBe(100); // no datum known: 0, the caller passes the estimate
  });

  it('follows the terrain in the terrain-following layout', () => {
    const terrainHeight = new Float32Array(plane);
    terrainHeight[5] = 300;
    const v = legacyView(5, { layout: 'terrain-following', baseM: 250, topM: 3000, terrainHeight, levels: Float32Array.from([10, 30, 70, 150, 310]) });
    // column 0 sits on the datum: J = 1, so the level is at ζ above it.
    expect(cellHeightAsl(v, 0, 2)).toBeCloseTo(250 + 70, 6);
    // column 5 stands 300 m up: J = 1 − 300 / 3000 = 0.9.
    expect(cellHeightAsl(v, 5, 2)).toBeCloseTo(250 + 300 + 70 * 0.9, 6);
    expect(cellHeightAsl(v, 5, 4)).toBeCloseTo(250 + 300 + 310 * 0.9, 6);
  });

  it('takes J as 1 for a terrain-following view that lacks its top', () => {
    const terrainHeight = new Float32Array(plane).fill(100);
    const v = legacyView(3, { layout: 'terrain-following', baseM: 0, terrainHeight });
    expect(cellHeightAsl(v, 1, 0)).toBeCloseTo(100 + 20, 6);
  });

  it('agrees with the atmosphere grid it describes: z = z_s + ζ · J', () => {
    const ridge = analyticTerrain(6000, 100, (x) => 700 + 400 * Math.exp(-((x / 900) ** 2)));
    const g = buildAtmosGrid(ridge, undefined, undefined, 'standard', 6000);
    const n = g.nx * g.ny;
    const view: AtmosphereView = {
      ...legacyView(g.nz),
      grid: g.grid,
      nz: g.nz,
      layout: 'terrain-following',
      levels: Float32Array.from(g.zetaC),
      terrainHeight: Float32Array.from({ length: n }, (_, c) => g.zs[c]! - g.zMin),
      topM: g.Hp,
      baseM: g.zMin,
    };
    let checked = 0;
    for (const c of [0, g.nx * 7 + 3, Math.floor(n / 2), n - 1]) {
      for (let k = 0; k < g.nz; k += 3) {
        expect(cellHeightAsl(view, c, k)).toBeCloseTo(g.zs[c]! + g.zetaC[k]! * g.J[c]!, 3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('airTime and airAgeS', () => {
  it('read the time the air was produced and how much older it is than the picture shown with it', () => {
    const v = legacyView(5, { time: 14 * 60 });
    expect(airTime(v)).toBe(840);
    expect(airAgeS(v, 840)).toBe(0);
    expect(airAgeS(v, 840 + 300)).toBe(300);
    expect(airAgeS(v, 800)).toBe(0); // never negative
    expect(AIR_STALE_S).toBe(90);
  });
  it('say null for a view made before the stamp existed, a view with a non-finite time, or no view', () => {
    expect(airTime(legacyView(5))).toBeNull();
    expect(airTime(legacyView(5, { time: Number.NaN }))).toBeNull();
    expect(airTime(null)).toBeNull();
    expect(airAgeS(legacyView(5), 100)).toBeNull();
    expect(airAgeS(undefined, 100)).toBeNull();
  });
});
