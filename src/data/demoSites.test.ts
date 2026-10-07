/**
 * The registry of bundled demo sites (src/data/demoSites.ts) and the bundle folders behind it: unique lowercase-letter ids
 * (the fetch scripts read them with a regular expression), centres inside NSW, squares that barely overlap, a complete
 * folder for every site (listed in provenance.json, sidecars that agree with the registry) and the terrain tiles its manifest
 * names present on disk and covering the square.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isInNsw } from '../ui/nsw';
import { loadBundleManifest } from './bundleManifest';
import { DEMO_EXTENT_M, DEMO_SITES, DEMO_TILE_ZOOM } from './demoSites';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const SRC = readFileSync(new URL('./demoSites.ts', import.meta.url), 'utf8');
const json = <T = Record<string, unknown>>(site: string, name: string): T => JSON.parse(readFileSync(`${PUBLIC}demo/${site}/${name}`, 'utf8')) as T;
const FILES = ['dem5m.png', 'dem5m.json', 'imagery.jpg', 'imagery.json', 'canopy.png', 'canopy.json', 'vegetation.geojson', 'fire-history.geojson', 'context.json', 'manifest.json', 'terrarium'];
const KM_LAT = 111.195;

describe('demo site registry', () => {
  it('has unique ids of lowercase letters only, names, regions and one teaching sentence each', () => {
    const ids = DEMO_SITES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(DEMO_SITES.map((s) => s.name)).size).toBe(ids.length);
    for (const s of DEMO_SITES) {
      expect(s.id, s.id).toMatch(/^[a-z]+$/);
      expect(s.name.length, s.id).toBeGreaterThan(3);
      expect(s.region.length, s.id).toBeGreaterThan(3);
      expect(s.teaching, s.id).toMatch(/^[A-Z].{40,260}[.]$/);
    }
  });

  it('can be read by the fetch scripts (they parse this file with a regular expression)', () => {
    const parsed = [...SRC.matchAll(/id: '([a-z]+)'[\s\S]*?centre: \{ lat: (-?[\d.]+), lon: (-?[\d.]+) \}/g)].map((m) => ({ id: m[1], lat: +m[2], lon: +m[3] }));
    expect(parsed).toEqual(DEMO_SITES.map((s) => ({ id: s.id, lat: s.centre.lat, lon: s.centre.lon })));
    expect(Number(/DEMO_EXTENT_M = (\d+)/.exec(SRC)![1])).toBe(DEMO_EXTENT_M);
    expect(Number(/DEMO_TILE_ZOOM = (\d+)/.exec(SRC)![1])).toBe(DEMO_TILE_ZOOM);
  });

  it('puts every centre, and every corner of its square, inside New South Wales', () => {
    for (const s of DEMO_SITES) {
      const h = DEMO_EXTENT_M / 2000;
      const dLat = h / KM_LAT;
      const dLon = h / (KM_LAT * Math.cos((s.centre.lat * Math.PI) / 180));
      for (const [a, b] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) expect(isInNsw({ lat: s.centre.lat + a * dLat, lon: s.centre.lon + b * dLon }), `${s.id} ${a},${b}`).toBe(true);
    }
  });

  it('keeps the squares apart: no two overlap by more than 5 % of a square', () => {
    for (let i = 0; i < DEMO_SITES.length; i++)
      for (let j = i + 1; j < DEMO_SITES.length; j++) {
        const a = DEMO_SITES[i]!;
        const b = DEMO_SITES[j]!;
        const dy = Math.abs(a.centre.lat - b.centre.lat) * KM_LAT;
        const dx = Math.abs(a.centre.lon - b.centre.lon) * KM_LAT * Math.cos((a.centre.lat * Math.PI) / 180);
        const side = DEMO_EXTENT_M / 1000;
        const overlap = Math.max(0, side - dx) * Math.max(0, side - dy);
        expect(overlap / (side * side), `${a.id} and ${b.id}`).toBeLessThan(0.05);
      }
  });
});

describe('demo site bundles', () => {
  it('every site has a complete folder, listed in provenance.json, and no folder is missing from the registry', async () => {
    const m = (await loadBundleManifest())!;
    expect(Object.keys(m.sites).sort()).toEqual(DEMO_SITES.map((s) => s.id).sort());
    expect(readdirSync(`${PUBLIC}demo`, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()).toEqual(DEMO_SITES.map((s) => s.id).sort());
    for (const s of DEMO_SITES) {
      for (const f of FILES) {
        expect(existsSync(`${PUBLIC}demo/${s.id}/${f}`), `${s.id}/${f}`).toBe(true);
        expect(m.sites[s.id]!.files[f]?.bytes, `${s.id}/${f} in provenance.json`).toBeGreaterThan(0);
        expect(m.sites[s.id]!.files[f]?.capturedOn, `${s.id}/${f} capture date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('every sidecar agrees with the registry: centre, extent, grid sizes, elevation range', () => {
    for (const s of DEMO_SITES) {
      for (const [name, cell, n] of [['dem5m.json', 10, 900], ['imagery.json', 8, 1125], ['canopy.json', 20, 450]] as const) {
        const j = json<{ id: string; centre: { lat: number; lon: number }; extent: number; cellSize: number; n: number }>(s.id, name);
        expect({ id: j.id, centre: j.centre, extent: j.extent, cellSize: j.cellSize, n: j.n }, `${s.id}/${name}`).toEqual({ id: s.id, centre: s.centre, extent: DEMO_EXTENT_M, cellSize: cell, n });
      }
      const dem = json<{ minElevation: number; maxElevation: number; nodataCount: number }>(s.id, 'dem5m.json');
      expect(dem.maxElevation - dem.minElevation, s.id).toBeGreaterThan(150);
      expect(dem.nodataCount, s.id).toBe(0);
      const veg = json<{ clippedTo: number[]; features: unknown[] }>(s.id, 'vegetation.geojson');
      expect(veg.features.length, s.id).toBeGreaterThan(100);
      const [w, so, e, n] = veg.clippedTo as [number, number, number, number];
      expect(w < s.centre.lon && e > s.centre.lon && so < s.centre.lat && n > s.centre.lat, `${s.id} clip box around the centre`).toBe(true);
      expect(json<{ features: unknown[] }>(s.id, 'fire-history.geojson').features.length, s.id).toBeGreaterThan(0);
      const ctx = json<{ id: string; version: number }>(s.id, 'context.json');
      expect({ id: ctx.id, version: ctx.version }, s.id).toEqual({ id: s.id, version: 1 });
    }
  });

  it('every site manifest names terrain tiles that exist and cover its square', () => {
    for (const s of DEMO_SITES) {
      const man = json<{ id: string; zoom: number; tiles: [number, number][] }>(s.id, 'manifest.json');
      expect(man.zoom, s.id).toBe(DEMO_TILE_ZOOM);
      for (const [x, y] of man.tiles) expect(existsSync(`${PUBLIC}demo/${s.id}/terrarium/${man.zoom}/${x}/${y}.png`), `${s.id} tile ${x}/${y}`).toBe(true);
      const n = 2 ** man.zoom;
      const frac = (lat: number, lon: number): [number, number] => {
        const r = (lat * Math.PI) / 180;
        return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
      };
      const dLat = DEMO_EXTENT_M / 2 / 111195;
      const dLon = dLat / Math.cos((s.centre.lat * Math.PI) / 180);
      const [x0, y0] = frac(s.centre.lat + dLat, s.centre.lon - dLon);
      const [x1, y1] = frac(s.centre.lat - dLat, s.centre.lon + dLon);
      for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let y = Math.floor(y0); y <= Math.floor(y1); y++) expect(man.tiles.some(([a, b]) => a === x && b === y), `${s.id} needs tile ${x}/${y}`).toBe(true);
    }
  });
});
