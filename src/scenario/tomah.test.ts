/**
 * The bundled Mount Tomah demo site (public/demo/tomah): a complete offline build from the bundle alone (no request,
 * every data set 'bundled', the 5 m elevation model and not the SRTM fallback), the Bilpin ridge (-33.52 150.42, 6 km)
 * covered by it, the elevations against the bundle's own range, the site's data against its teaching sentence, and a
 * short headless fire to show the whole chain runs on it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findDataset } from '../core/datasets';
import { LocalProjection } from '../core/geo';
import { makeGridSpec } from '../core/grid';
import { demoSiteCovering } from '../data/contextLayers';
import { DEMO_SITES } from '../data/demoSites';
import { loadDemoDem } from '../data/demoRasters';
import { Simulation } from '../sim/simulation';
import { cellOf, pointIgnition, withIgnitions } from '../sim/testing/scenarios';
import { buildScenario } from './build';
import { WEATHER_PRESETS } from './presets';
import { withFakeNetwork } from './testing';

const tomah = DEMO_SITES.find((s) => s.id === 'tomah')!;
const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const BILPIN_RIDGE = { lat: -33.52, lon: 150.42 };

describe('Mount Tomah demo site', () => {
  it('is registered next to its Blue Mountains neighbours', () => {
    expect(tomah.name).toBe('Mount Tomah');
    expect(tomah.region).toBe('Blue Mountains');
    const ids = DEMO_SITES.map((s) => s.id);
    expect(ids.indexOf('tomah')).toBe(ids.indexOf('grose') + 1);
  });

  it('a complete offline build is served from the bundle alone: every data set bundled, the 5 m model (not SRTM), no request', async () => {
    const net = withFakeNetwork([]);
    try {
      const start = WEATHER_PRESETS['hot-nw-sw-change'].canonicalStart(tomah.centre.lon, 2026);
      const s = await buildScenario({ centre: tomah.centre, extent: 9000, demoSiteId: 'tomah', weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start }, duration: 2 * 3600, online: false });
      expect(net.calls).toEqual([]);
      const rec = (id: string) => {
        const r = findDataset(s.datasets, id);
        if (!r) throw new Error(`no record '${id}'`);
        return r;
      };
      for (const id of ['terrain', 'imagery', 'vegetation-svtm', 'canopy-height', 'fire-history', 'roads', 'fire-trails', 'homes', 'zones', 'place-names']) {
        expect(rec(id).origin, id).toBe('bundled');
        // 'partial' only for the vegetation map, where the SVTM has "Not classified" land (cleared or built) that the fuel model infers.
        expect(rec(id).status, id).toBe(id === 'vegetation-svtm' ? 'partial' : 'used');
      }
      expect(s.terrain.source).toMatch(/NSW_5M_Elevation/);
      expect(s.terrain.source).not.toMatch(/SRTM|synthetic/i);
      expect(s.terrainHiRes!.grid.nx).toBe(900);
      // The bundled model's own range, read from its sidecar (Mount Tomah is about 1,000 m: the NSW model reads 982 m at the locality point).
      const dem = (await loadDemoDem('tomah'))!;
      expect(dem.meta.minElevation!).toBeGreaterThan(250);
      expect(dem.meta.maxElevation!).toBeGreaterThan(950);
      expect(dem.meta.maxElevation!).toBeLessThan(1100);
      expect(s.terrain.maxElevation).toBeLessThanOrEqual(dem.meta.maxElevation! + 1);
      expect(s.terrain.minElevation).toBeGreaterThanOrEqual(dem.meta.minElevation! - 1);
      expect(s.terrain.maxElevation - s.terrain.minElevation).toBeGreaterThan(600);
      // The fuel comes from the bundled SVTM, NPWS history and canopy.
      const src = s.fuel.sources.join(' | ');
      expect(src).toMatch(/SVTM/);
      expect(src).toMatch(/NPWS/);
      expect(src).toMatch(/[Cc]anopy/);
      // The context of the bundle: Bells Line of Road and the houses along it.
      expect(s.context!.roads.some((r) => /Bells Line/i.test(r.name ?? ''))).toBe(true);
      expect(s.context!.homes.length / 2).toBeGreaterThan(100);
      expect(s.context!.places.map((p) => p.name)).toContain('Mount Tomah');
      expect(s.weather.annualRainfall).toBe(1100);
    } finally {
      net.restore();
    }
  });

  it('covers the Bilpin ridge (-33.52 150.42, 6 km): the bundle answers there, offline', async () => {
    expect(demoSiteCovering(BILPIN_RIDGE, 6000)).toBe('tomah');
    const net = withFakeNetwork([]);
    try {
      const start = WEATHER_PRESETS['hot-nw-sw-change'].canonicalStart(BILPIN_RIDGE.lon, 2026);
      const s = await buildScenario({ centre: BILPIN_RIDGE, extent: 6000, weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start }, duration: 3600, online: false });
      expect(net.calls).toEqual([]);
      expect(s.terrain.source).toMatch(/NSW_5M_Elevation/);
      const rec = (id: string) => findDataset(s.datasets, id)!;
      for (const id of ['terrain', 'vegetation-svtm', 'fire-history', 'canopy-height', 'roads', 'homes']) expect(rec(id).origin, id).toBe('bundled');
    } finally {
      net.restore();
    }
  });

  it('is not claimed for places beyond its square (Bilpin village, 9 km east)', () => {
    expect(demoSiteCovering({ lat: -33.498, lon: 150.522 }, 6000)).toBeNull();
    expect(demoSiteCovering({ lat: -33.53, lon: 150.425 }, 9000)).toBe('tomah');
    expect(makeGridSpec(tomah.centre, 9000, 30).nx).toBe(300);
  });

  it('a fire on the Bells Line of Road ridge runs for 30 simulated minutes with sane numbers', async () => {
    const start = WEATHER_PRESETS['hot-nw-sw-change'].canonicalStart(tomah.centre.lon, 2026);
    const base = await buildScenario({ centre: tomah.centre, extent: 6000, demoSiteId: 'tomah', weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start }, duration: 3600, online: false, options: { tier: 'fast' } });
    const k = cellOf(base.terrain, 0, -1200); // near the Botanic Garden ridge, 1.2 km south of the site's centre
    const g = base.terrain.grid;
    const x = g.x0 + (k % g.nx) * g.cellSize;
    const y = g.y0 + Math.floor(k / g.nx) * g.cellSize;
    const sc = withIgnitions(base, [pointIgnition('ridge', x, y, 0, 60)], { snapshotInterval: 300 });
    const sim = new Simulation(sc);
    sim.advance(1800);
    const st = sim.snapshot().stats;
    expect(sim.time).toBe(1800);
    for (const key of ['burntAreaHa', 'perimeterKm', 'maxRos', 'maxIntensity', 'ffdi', 'deadFuelMoistureMean'] as const) expect(Number.isFinite(st[key]), key).toBe(true);
    expect(st.burntAreaHa).toBeGreaterThan(0.5);
    expect(st.burntAreaHa).toBeLessThan(2000);
    expect(st.maxRos).toBeGreaterThan(0);
    expect(st.deadFuelMoistureMean).toBeGreaterThan(2); // per cent of dry weight: a hot dry day
    expect(st.deadFuelMoistureMean).toBeLessThan(30);
  }, 120_000);

  it('its square keeps clear of the Blackheath square (a gap of about 1 km, no overlap)', () => {
    const grose = DEMO_SITES.find((x) => x.id === 'grose')!;
    const [, y] = new LocalProjection(tomah.centre).toLocal(grose.centre);
    const gap = Math.abs(y) - 9000; // the squares are 9 km tall; their centres are ~10 km apart
    expect(gap).toBeGreaterThan(900);
    expect(gap).toBeLessThan(1100);
  });
});

/**
 * The teaching sentence of the card ("tall wet forest on the high ground, rainforest in the steep gullies, dry forest and heath on
 * the rest, all inside the 2019/20 Gospers Mountain fire perimeter") read against the bundled files: every claim is a measurable
 * difference between the vegetation polygons, the 5 m ground heights and the fire perimeters, sampled every 50 m.
 */
describe('Mount Tomah teaching sentence against its bundle', () => {
  type Ring = number[][];
  type Feature = { properties: Record<string, unknown>; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };
  const read = (name: string): Feature[] => (JSON.parse(readFileSync(`${PUBLIC}demo/tomah/${name}`, 'utf8')) as { features: Feature[] }).features;
  const proj = new LocalProjection(tomah.centre);
  const STEP = 50;
  const N = 9000 / STEP;
  const inRing = (x: number, y: number, ring: [number, number][]): boolean => {
    let c = false;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, ya] = ring[a]!;
      const [xb, yb] = ring[b]!;
      if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c;
    }
    return c;
  };
  /** For every sample point of the square (row-major, row 0 south): the index of the last feature that covers it, or -1. */
  const paint = (features: Feature[]): Int32Array => {
    const out = new Int32Array(N * N).fill(-1);
    features.forEach((f, fi) => {
      const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates as Ring[]] : (f.geometry.coordinates as Ring[][])).map((p) => p.map((r) => r.map(([lon, lat]) => proj.toLocal({ lat: lat!, lon: lon! }))));
      for (const poly of polys) {
        const outer = poly[0] as [number, number][];
        const xs = outer.map((p) => p[0]);
        const ys = outer.map((p) => p[1]);
        const i0 = Math.max(0, Math.ceil((Math.min(...xs) + 4500 - STEP / 2) / STEP));
        const i1 = Math.min(N - 1, Math.floor((Math.max(...xs) + 4500 - STEP / 2) / STEP));
        const j0 = Math.max(0, Math.ceil((Math.min(...ys) + 4500 - STEP / 2) / STEP));
        const j1 = Math.min(N - 1, Math.floor((Math.max(...ys) + 4500 - STEP / 2) / STEP));
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const x = -4500 + (i + 0.5) * STEP;
            const y = -4500 + (j + 0.5) * STEP;
            if (inRing(x, y, outer) && !poly.slice(1).some((h) => inRing(x, y, h as [number, number][]))) out[j * N + i] = fi;
          }
      }
    });
    return out;
  };
  const median = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
  const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

  it('wet forest on the high ground, rainforest below it in the steep gullies, dry forest and heath on the rest', async () => {
    const dem = (await loadDemoDem('tomah'))!;
    const g = dem.grid;
    const z = (i: number, j: number): number => dem.elevation[Math.min(g.ny - 1, Math.floor((j * STEP) / g.cellSize + STEP / g.cellSize / 2)) * g.nx + Math.min(g.nx - 1, Math.floor((i * STEP) / g.cellSize + STEP / g.cellSize / 2))]!;
    const slope = (i: number, j: number): number => {
      const ci = Math.min(g.nx - 2, Math.max(1, Math.floor((i * STEP) / g.cellSize + STEP / g.cellSize / 2)));
      const cj = Math.min(g.ny - 2, Math.max(1, Math.floor((j * STEP) / g.cellSize + STEP / g.cellSize / 2)));
      const e = dem.elevation;
      const dx = (e[cj * g.nx + ci + 1]! - e[cj * g.nx + ci - 1]!) / (2 * g.cellSize);
      const dy = (e[(cj + 1) * g.nx + ci]! - e[(cj - 1) * g.nx + ci]!) / (2 * g.cellSize);
      return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
    };
    const veg = read('vegetation.geojson');
    const cover = paint(veg);
    const cells = (pred: (p: Record<string, unknown>) => boolean): number[] => {
      const out: number[] = [];
      cover.forEach((fi, k) => {
        if (fi >= 0 && pred(veg[fi]!.properties)) out.push(k);
      });
      return out;
    };
    const at = (k: number): [number, number] => [k % N, Math.floor(k / N)];
    const form = (p: Record<string, unknown>): string => String(p['vegForm']);
    const cap = cells((p) => p['PCTName'] === 'Blue Mountains Basalt Cap Forest');
    const dry = cells((p) => form(p).startsWith('Dry Sclerophyll'));
    const rain = cells((p) => form(p) === 'Rainforests');
    const heath = cells((p) => form(p) === 'Heathlands');
    const wet = cells((p) => form(p).startsWith('Wet Sclerophyll'));
    const everyCell = Array.from({ length: N * N }, (_, k) => k);
    const elev = (ks: number[]): number[] => ks.map((k) => z(...at(k)));
    const steep = (ks: number[]): number[] => ks.map((k) => slope(...at(k)));
    // The cap: a real class of the bundle, several square km, on the highest ground (well above the dry forests and above the site as a whole).
    expect(cap.length * STEP * STEP).toBeGreaterThan(5e6);
    expect(mean(elev(cap))).toBeGreaterThan(mean(elev(dry)) + 80);
    expect(mean(elev(cap))).toBeGreaterThan(mean(elev(everyCell)) + 80);
    // "tall wet forest on the high ground": above 900 m the wet sclerophyll forest is the biggest group, far ahead of the dry forests.
    const high = everyCell.filter((k) => z(...at(k)) > 900);
    const wetHigh = high.filter((k) => cover[k]! >= 0 && form(veg[cover[k]!]!.properties).startsWith('Wet Sclerophyll')).length;
    const dryHigh = high.filter((k) => cover[k]! >= 0 && form(veg[cover[k]!]!.properties).startsWith('Dry Sclerophyll')).length;
    expect(wetHigh / high.length).toBeGreaterThan(0.4);
    expect(wetHigh).toBeGreaterThan(4 * dryHigh);
    expect(wet.length * STEP * STEP).toBeGreaterThan(1e7);
    // "rainforest in the steep gullies": it is the steepest group and sits lower than the cap (not "on the cap").
    expect(median(steep(rain))).toBeGreaterThan(median(steep(everyCell)) + 5);
    expect(median(elev(rain))).toBeLessThan(median(elev(cap)) - 100);
    // "dry forest and heath on the rest": together they are most of the ground the cap and the rainforest do not hold.
    expect((dry.length + heath.length) / everyCell.length).toBeGreaterThan(0.45);
    expect(dry.length).toBeGreaterThan(rain.length);
    expect(heath.length).toBeGreaterThan(0);
  });

  it('the whole square lies inside the 2019/20 Gospers Mountain fire perimeter', () => {
    const fires = read('fire-history.geojson');
    const gospers = fires.map((f, i) => ({ f, i })).filter(({ f }) => f.properties['FireYear'] === 201920 && f.properties['FireName'] === 'Gospers Mountain');
    expect(gospers).toHaveLength(1);
    const covered = paint([gospers[0]!.f]);
    expect(covered.every((v) => v === 0)).toBe(true);
  });

  it('Bells Line of Road runs through the square as its one arterial road, for more than 10 km', () => {
    const ctx = JSON.parse(readFileSync(`${PUBLIC}demo/tomah/context.json`, 'utf8')) as { roads: { c: string; n?: string; p: number[] }[] };
    const arterial = ctx.roads.filter((r) => r.c === 'arterial');
    expect(arterial.length).toBeGreaterThan(0);
    expect(new Set(arterial.map((r) => r.n))).toEqual(new Set(['Bells Line Of Road']));
    let km = 0;
    for (const r of arterial)
      for (let k = 2; k < r.p.length; k += 2) km += Math.hypot((r.p[k]! / 1e5) * 111195 * Math.cos((tomah.centre.lat * Math.PI) / 180), (r.p[k + 1]! / 1e5) * 111195) / 1000; // deltas in 1e-5 degrees
    expect(km).toBeGreaterThan(10);
  });
});
