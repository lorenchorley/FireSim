/**
 * "Where you are" (placeInfo.ts): nearest road and fire trail, nearest named place, the zone under the point, homes within
 * 500 m and 1 km and the nearest home, the ground in words, on synthetic data (exact answers) and on the bundled Katoomba
 * places data (checked against brute force), and the "not available for this place" answer without places data.
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../../../core/grid';
import { EMPTY_CONTEXT, type ContextLayers } from '../../../core/places';
import { loadBundledContext } from '../../../data/contextLayers';
import { DEMO_SITES } from '../../../data/demoSites';
import { compass8, groundAt, homesNear, nearestFireTrail, nearestLocality, nearestRoad, placeInfo, placeRows, pointInRings, zoneAt, HOME_RADII } from './placeInfo';

const ORIGIN = { lat: -33.7, lon: 150.3 };
const line = (...p: number[]): Float32Array => new Float32Array(p);

/** A small made-up town: a sealed street along y = 0, a named track up x = 500 with a fire trail on it, one R2 zone, a few homes and two names. */
function synthetic(): ContextLayers {
  const c = EMPTY_CONTEXT(ORIGIN);
  c.roads = [
    { cls: 'local', surface: 1, name: 'Test Street', xy: line(-1000, 0, 1000, 0), lengthM: 2000 },
    { cls: 'track', surface: 2, name: 'Jamison Fire Trail', xy: line(500, 0, 500, 1500), lengthM: 1500 },
    { cls: 'path', surface: 0, xy: line(-800, -800, -800, 800), lengthM: 1600 },
  ];
  c.fireTrails = [{ xy: line(500, 50, 500, 1500), lengthM: 1450 }];
  c.zones = [{ code: 'R2', kind: 'residential', name: 'Low Density Residential', rings: [line(0, -200, 200, -200, 200, -50, 0, -50), line(50, -150, 100, -150, 100, -100, 50, -100)] }];
  c.homes = line(100, -120, 150, -80, 300, 0, 0, 800, 2000, 2000);
  c.places = [
    { name: 'Testville', kind: 'suburb', x: 100, y: -100 },
    { name: 'Far Town', kind: 'town', x: 5000, y: 5000 },
  ];
  c.sources = [{ id: 'roads', title: 'Roads', provider: 'Spatial Services NSW', layer: 'x', url: 'https://example.invalid', licence: 'CC BY 4.0', attribution: '', fetched: '2026-09-29' }];
  return c;
}

/** A 3 km plane sloping down to the north-west at about 11°. */
function slopeTerrain() {
  const g = makeGridSpec(ORIGIN, 3000, 30);
  const n = g.nx * g.ny;
  const elevation = new Float32Array(n);
  const slopeDeg = new Float32Array(n);
  const aspectDeg = new Float32Array(n);
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const x = g.x0 + i * g.cellSize;
      const y = g.y0 + j * g.cellSize;
      elevation[k] = 1000 + 0.14 * (x - y);
      slopeDeg[k] = 11;
      aspectDeg[k] = 315;
    }
  return { grid: g, elevation, slopeDeg, aspectDeg };
}

describe('placeInfo: synthetic town', () => {
  const c = synthetic();

  it('finds the nearest road with its name, class, surface, distance and direction', () => {
    const r = nearestRoad(c, 200, 300)!;
    expect(r.name).toBe('Test Street');
    expect(r.distanceM).toBeCloseTo(300, 6);
    expect(r.dir).toBe('S');
    expect(r.classWords).toBe('local street');
    expect(r.surfaceWords).toBe('sealed');
    const t = nearestRoad(c, 450, 900)!;
    expect(t.name).toBe('Jamison Fire Trail');
    expect(t.distanceM).toBeCloseTo(50, 6);
    expect(t.dir).toBe('E');
    expect(t.surfaceWords).toBe('unsealed');
  });

  it('names a fire trail after the track that runs along it and measures to the trail itself', () => {
    const f = nearestFireTrail(c, 160, 1000)!;
    expect(f.distanceM).toBeCloseTo(340, 6);
    expect(f.dir).toBe('E');
    expect(f.name).toBe('Jamison Fire Trail');
    // Before the trail starts (y < 50) the nearest point is its end.
    const g = nearestFireTrail(c, 500, -100)!;
    expect(g.distanceM).toBeCloseTo(150, 6);
    expect(g.dir).toBe('N');
    const rows = placeRows(placeInfo(160, 1000, { context: c }));
    expect(rows.find((r) => r.id === 'trail')!.value).toBe('340 m E — Jamison Fire Trail');
  });

  it('an unnamed fire trail far from any named road has no name', () => {
    const c2 = synthetic();
    c2.fireTrails = [{ xy: line(-2000, 2000, -2000, 2500), lengthM: 500 }];
    expect(nearestFireTrail(c2, -2000, 1900)!.name).toBeUndefined();
  });

  it('tells the zone under the point (holes excluded) and outside any zone', () => {
    expect(zoneAt(c, 20, -180)).toEqual({ code: 'R2', kind: 'residential', name: 'Low Density Residential' });
    expect(zoneAt(c, 75, -125)).toBeNull(); // in the hole
    expect(zoneAt(c, 500, 500)).toBeNull();
    expect(pointInRings(c.zones[0]!.rings, 190, -60)).toBe(true);
  });

  it('counts homes within 500 m and 1 km and finds the nearest one', () => {
    const h = homesNear(c, 0, 0);
    // (100,-120) 156 m, (150,-80) 170 m, (300,0) 300 m, (0,800) 800 m, (2000,2000) 2828 m
    expect(HOME_RADII).toEqual([500, 1000]);
    expect(h.within).toEqual([3, 4]);
    expect(h.nearest!.distanceM).toBeCloseTo(Math.hypot(100, 120), 6);
    expect(h.nearest!.dir).toBe('SE');
  });

  it('finds the nearest named place', () => {
    const l = nearestLocality(c, 1000, 0)!;
    expect(l.name).toBe('Testville');
    expect(l.dir).toBe('W');
  });

  it('says the ground in words from the terrain', () => {
    const t = slopeTerrain();
    const g = groundAt(t, 0, 0)!;
    expect(g.elevation).toBeCloseTo(1000, 0);
    expect(g.words).toBe('1,000 m above sea level, on a 11° slope facing north-west');
    expect(groundAt(t, 99999, 0)).toBeNull();
  });

  it('rows read in plain words, with "right here" when the point is on the line', () => {
    const rows = placeRows(placeInfo(200, 5, { context: c, terrain: slopeTerrain() }));
    const v = Object.fromEntries(rows.map((r) => [r.id, r.value]));
    expect(v.road).toBe('Test Street (local street, sealed) · right here');
    expect(v.zone).toBe('Outside the residential and built-up zones');
    expect(v.homes).toBe('3 within 500 m · 4 within 1 km');
    expect(v.place).toMatch(/^Testville \(suburb\) · 1\d0 m SW$/);
    expect(v.ground).toMatch(/above sea level/);
    const inZone = Object.fromEntries(placeRows(placeInfo(20, -180, { context: c })).map((r) => [r.id, r.value]));
    expect(inZone.zone).toBe('Low Density Residential (zone R2: houses)');
  });

  it('without places data: "not available for this place" (and the ground still comes from the terrain)', () => {
    const info = placeInfo(0, 0, { context: null, terrain: slopeTerrain() });
    expect(info.hasContext).toBe(false);
    const rows = placeRows(info);
    expect(rows.map((r) => r.id)).toEqual(['none', 'ground']);
    expect(rows[0]!.value).toBe('Not available for this place');
  });

  it('compass points', () => {
    expect([0, 44, 46, 90, 180, 225, 270, 315, 359].map(compass8)).toEqual(['N', 'NE', 'NE', 'E', 'S', 'SW', 'W', 'NW', 'N']);
  });
});

describe('placeInfo: bundled Katoomba places (offline)', () => {
  const kat = DEMO_SITES.find((s) => s.id === 'katoomba')!;

  it('agrees with brute force at points around the site and names trails from the road data', async () => {
    const c = (await loadBundledContext('katoomba', kat.centre))!;
    expect(c).not.toBeNull();
    expect(c.roads.length).toBeGreaterThan(1000);
    const brute = (xy: Float32Array, x: number, y: number): number => {
      let best = Infinity;
      for (let i = 0; i + 3 < xy.length; i += 2) {
        const ax = xy[i]!;
        const ay = xy[i + 1]!;
        const vx = xy[i + 2]! - ax;
        const vy = xy[i + 3]! - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
        best = Math.min(best, Math.hypot(ax + vx * t - x, ay + vy * t - y));
      }
      return best;
    };
    let named = 0;
    for (const [x, y] of [
      [0, 0],
      [-2000, 1500],
      [2500, -1800],
      [-3500, -3000],
      [1200, 3200],
    ] as const) {
      const info = placeInfo(x, y, { context: c });
      const road = Math.min(...c.roads.map((r) => brute(r.xy, x, y)));
      expect(info.road!.distanceM).toBeCloseTo(road, 3);
      const trail = Math.min(...c.fireTrails.map((t) => brute(t.xy, x, y)));
      expect(info.fireTrail!.distanceM).toBeCloseTo(trail, 3);
      if (info.fireTrail!.name) named++;
      let a = 0;
      let b = 0;
      for (let i = 0; i < c.homes.length; i += 2) {
        const d = Math.hypot(c.homes[i]! - x, c.homes[i + 1]! - y);
        if (d <= 500) a++;
        if (d <= 1000) b++;
      }
      expect(info.homes!.within).toEqual([a, b]);
      expect(info.locality).not.toBeNull();
      const rows = placeRows(info);
      expect(rows.map((r) => r.id)).toEqual(['road', 'trail', 'place', 'zone', 'homes', 'nearestHome']);
      for (const r of rows) expect(r.value.length).toBeGreaterThan(2);
    }
    // The RFS lines carry no names: at least some are named after the track they follow ("K2 Trail" ...).
    expect(named).toBeGreaterThan(0);
  });

  it('finds a residential zone in Katoomba town', async () => {
    const c = (await loadBundledContext('katoomba', kat.centre))!;
    const town = c.places.find((p) => p.name === 'Katoomba')!;
    let found: ReturnType<typeof zoneAt> = null;
    for (let dy = -600; dy <= 600 && !found; dy += 50) for (let dx = -600; dx <= 600 && !found; dx += 50) found = zoneAt(c, town.x + dx, town.y + dy);
    expect(found).not.toBeNull();
    expect(found!.code).toMatch(/^[A-Z]+\d*$/);
  });
});
