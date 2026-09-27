import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { encode } from 'fast-png';
import { gradient, makeGridSpec, type GridSpec } from '../core/grid';
import { LocalProjection, lonLatToTileFrac } from '../core/geo';
import { DEMO_SITES } from './demoSites';
import { setAssetLoader } from './assets';
import { createMemoryKV, saveAreaPack } from './cache';
import { resetHttpConfig, setHttpConfig } from './http';
import {
  clearDemoManifestCache,
  decodeTerrarium,
  defaultElevationZoom,
  elevationTilesFor,
  ElevationUnavailableError,
  encodeTerrariumPixels,
  loadElevation,
  syntheticElevation,
  terrariumTileKey,
  terrariumTileUrl,
} from './terrainTiles';

const PUBLIC = new URL('../../public/', import.meta.url);
const KATOOMBA = DEMO_SITES.find((s) => s.id === 'katoomba')!;
const readPublic = (p: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(new URL(p, PUBLIC)));

afterEach(() => {
  setAssetLoader(null);
  resetHttpConfig();
  clearDemoManifestCache();
});

function stats(a: ArrayLike<number>) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let nan = 0;
  for (let k = 0; k < a.length; k++) {
    const v = a[k]!;
    if (Number.isNaN(v)) nan++;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / a.length, nan };
}

/** Mean over the cells with column index in [i0, i1). */
function columnBandMean(g: GridSpec, f: ArrayLike<number>, i0: number, i1: number): number {
  let s = 0;
  let n = 0;
  for (let j = 0; j < g.ny; j++) for (let i = i0; i < i1; i++) (s += f[j * g.nx + i]!), n++;
  return s / n;
}

function slopeDeg(g: GridSpec, e: Float32Array): Float32Array {
  const { dx, dy } = gradient(g, e);
  const s = new Float32Array(e.length);
  for (let k = 0; k < e.length; k++) s[k] = (Math.atan(Math.hypot(dx[k]!, dy[k]!)) * 180) / Math.PI;
  return s;
}

/** A 256×256 Terrarium PNG whose pixels are given by f(col, row). */
function makeTile(f: (c: number, r: number) => number): Uint8Array {
  const e = new Float32Array(256 * 256);
  for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) e[r * 256 + c] = f(c, r);
  return encode({ width: 256, height: 256, data: encodeTerrariumPixels(e), channels: 3, depth: 8 });
}

describe('decodeTerrarium', () => {
  it('decodes a bundled Katoomba tile to plausible Blue Mountains elevations', () => {
    const t = decodeTerrarium(readPublic('demo/katoomba/terrarium/13/7515/4911.png'));
    expect(t.width).toBe(256);
    expect(t.height).toBe(256);
    const s = stats(t.elevation);
    expect(s.nan).toBe(0);
    expect(s.min).toBeGreaterThanOrEqual(200);
    expect(s.max).toBeLessThanOrEqual(1200);
    expect(s.max - s.min).toBeGreaterThan(300); // escarpment country
  });

  it('implements h = R·256 + G + B/256 − 32768 exactly (round trip with the encoder)', () => {
    const png = makeTile((c, r) => -50 + c * 7.25 + r * 0.00390625);
    const t = decodeTerrarium(png);
    for (const [c, r] of [[0, 0], [255, 0], [17, 200], [255, 255]] as const) {
      expect(t.elevation[r * 256 + c]).toBeCloseTo(-50 + c * 7.25 + r * 0.00390625, 2);
    }
    // Raw bytes: R=128, G=10, B=128 → 128·256 + 10 + 0.5 − 32768 = 10.5 m
    const one = encode({ width: 1, height: 1, data: new Uint8Array([128, 10, 128]), channels: 3, depth: 8 });
    expect(decodeTerrarium(one).elevation[0]).toBe(10.5);
  });

  it('accepts RGBA and maps no-data (< −100 m) to 0', () => {
    const rgba = encode({ width: 2, height: 1, data: new Uint8Array([0, 0, 0, 255, 128, 100, 0, 255]), channels: 4, depth: 8 });
    const t = decodeTerrarium(rgba);
    expect(t.elevation[0]).toBe(0); // −32768 sentinel
    expect(t.elevation[1]).toBe(100);
    expect(t.noData).toBe(1);
  });

  it('rejects non-PNG input', () => {
    expect(() => decodeTerrarium(new TextEncoder().encode('<html></html>'))).toThrow(/not a PNG/);
  });
});

describe('tile planning', () => {
  it('chooses zoom 13 for ≥ 20 m cells and 14 below', () => {
    expect(defaultElevationZoom(30)).toBe(13);
    expect(defaultElevationZoom(20)).toBe(13);
    expect(defaultElevationZoom(10)).toBe(14);
  });

  it('lists the tiles covering a request, all of them bundled for the demo site', () => {
    const tiles = elevationTilesFor({ centre: KATOOMBA.centre, extent: 6000, cellSize: 30 });
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(tiles.length).toBeLessThanOrEqual(9);
    const manifest = JSON.parse(new TextDecoder().decode(readPublic('demo/katoomba/manifest.json'))) as { tiles: [number, number][] };
    const bundled = new Set(manifest.tiles.map(([x, y]) => `${x}/${y}`));
    for (const t of tiles) {
      expect(t.z).toBe(13);
      expect(bundled.has(`${t.x}/${t.y}`)).toBe(true);
      expect(t.key).toBe(terrariumTileKey(t));
      expect(t.url).toBe(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/${t.x}/${t.y}.png`);
    }
    expect(terrariumTileUrl(13, 1, 2)).toMatch(/\/terrarium\/13\/1\/2\.png$/);
  });
});

describe('loadElevation', () => {
  it('builds the Katoomba demo grid from bundled tiles (30 m, 6 km)', async () => {
    let progress = 0;
    const r = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 6000, cellSize: 30, demoSiteId: 'katoomba', cache: createMemoryKV(), onProgress: () => progress++ });
    expect(r.grid.nx).toBe(200);
    expect(r.grid.ny).toBe(200);
    expect(r.elevation.length).toBe(200 * 200);
    const s = stats(r.elevation);
    expect(s.nan).toBe(0);
    expect(s.min).toBeGreaterThanOrEqual(250);
    expect(s.min).toBeLessThanOrEqual(450);
    expect(s.max).toBeGreaterThanOrEqual(1000);
    expect(s.max).toBeLessThanOrEqual(1120);
    // Megalong Valley (west of centre) lies well below the Katoomba plateau (east).
    const west = columnBandMean(r.grid, r.elevation, 0, 60);
    const east = columnBandMean(r.grid, r.elevation, 140, 200);
    expect(east - west).toBeGreaterThan(150);
    // Real escarpments: some cliff cells steeper than 55°.
    expect(stats(slopeDeg(r.grid, r.elevation)).max).toBeGreaterThan(55);
    expect(r.source).toContain('bundled');
    expect(r.source).toContain('katoomba');
    expect(r.zoom).toBe(13);
    expect(progress).toBe(r.tiles);
    expect(r.seaOrNoDataCells).toBe(0);
  });

  it('is georeferenced correctly: each cell equals an independent bilinear lookup in its tile', async () => {
    const r = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 3000, cellSize: 30, demoSiteId: 'katoomba', cache: null });
    const proj = new LocalProjection(r.grid.origin);
    const tiles = new Map<string, Float32Array>();
    const pixel = (gx: number, gy: number): number => {
      const tx = Math.floor(gx / 256);
      const ty = Math.floor(gy / 256);
      const key = `${tx}/${ty}`;
      if (!tiles.has(key)) tiles.set(key, decodeTerrarium(readPublic(`demo/katoomba/terrarium/13/${tx}/${ty}.png`)).elevation);
      return tiles.get(key)![(gy - ty * 256) * 256 + (gx - tx * 256)]!;
    };
    for (const [i, j] of [[0, 0], [99, 0], [0, 99], [37, 81], [50, 50], [99, 99]] as const) {
      const ll = proj.toLatLon(r.grid.x0 + i * r.grid.cellSize, r.grid.y0 + j * r.grid.cellSize);
      const [fx, fy] = lonLatToTileFrac(ll.lat, ll.lon, 13);
      const u = fx * 256 - 0.5;
      const v = fy * 256 - 0.5;
      const c = Math.floor(u);
      const rr = Math.floor(v);
      const a = u - c;
      const b = v - rr;
      const expected = (pixel(c, rr) * (1 - a) + pixel(c + 1, rr) * a) * (1 - b) + (pixel(c, rr + 1) * (1 - a) + pixel(c + 1, rr + 1) * a) * b;
      expect(r.elevation[j * r.grid.nx + i]).toBeCloseTo(expected, 1);
    }
  });

  it('gives the same elevation for the same place from grids with different origins', async () => {
    const a = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 4000, cellSize: 30, cache: null });
    const shifted = new LocalProjection(KATOOMBA.centre).toLatLon(600, -900);
    const b = await loadElevation({ lidar: false, centre: shifted, extent: 4000, cellSize: 30, cache: null });
    const pa = new LocalProjection(a.grid.origin);
    const pb = new LocalProjection(b.grid.origin);
    let maxDiff = 0;
    for (let j = 40; j < 100; j += 7)
      for (let i = 40; i < 100; i += 7) {
        const ll = pb.toLatLon(b.grid.x0 + i * 30, b.grid.y0 + j * 30);
        const [x, y] = pa.toLocal(ll);
        // Compare against the nearest cell of grid a (≤ 21 m away): allow for real slope over that distance.
        const ia = Math.round((x - a.grid.x0) / 30);
        const ja = Math.round((y - a.grid.y0) / 30);
        const d = Math.abs(a.elevation[ja * a.grid.nx + ia]! - b.elevation[j * b.grid.nx + i]!);
        maxDiff = Math.max(maxDiff, d);
        expect(Math.hypot(x - (a.grid.x0 + ia * 30), y - (a.grid.y0 + ja * 30))).toBeLessThan(0.5); // shift is whole cells
      }
    expect(maxDiff).toBeLessThan(0.5);
  });

  it('finds bundled tiles automatically when inside a demo area without a demoSiteId', async () => {
    const r = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 2000, cellSize: 30, cache: null, offline: true });
    expect(r.source).toContain('bundled (katoomba)');
  });

  it('downloads missing tiles, caches them, then serves them from the cache', async () => {
    setAssetLoader(async () => null); // pretend nothing is bundled
    const urls: string[] = [];
    setHttpConfig({
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        const m = /terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url)!;
        return new Response(readPublic(`demo/katoomba/terrarium/${m[1]}/${m[2]}/${m[3]}.png`));
      }) as typeof fetch,
    });
    const kv = createMemoryKV();
    const req = { centre: KATOOMBA.centre, extent: 6000, cellSize: 30, cache: kv };
    const first = await loadElevation(req);
    expect(first.source).toContain(`${first.tiles} downloaded`);
    expect(urls).toHaveLength(first.tiles);
    expect(urls[0]).toMatch(/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/13\//);
    expect((await kv.keys('terrarium/13/')).length).toBe(first.tiles);
    const second = await loadElevation({ lidar: false, ...req, offline: true });
    expect(second.source).toContain(`${first.tiles} cached`);
    expect(urls).toHaveLength(first.tiles);
    expect(second.elevation).toEqual(first.elevation);
    // Identical to the bundled result.
    setAssetLoader(null);
    const bundled = await loadElevation({ lidar: false, ...req, cache: null });
    expect(bundled.elevation).toEqual(first.elevation);
  });

  it('throws ElevationUnavailableError listing the tiles when offline with nothing cached', async () => {
    // An explicit zoom never falls back.
    const err = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 3000, cellSize: 10, zoom: 14, cache: createMemoryKV(), offline: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ElevationUnavailableError);
    expect((err as ElevationUnavailableError).missing.every((t) => t.z === 14)).toBe(true);
    // Far from any demo site, network failing → also unavailable.
    setHttpConfig({ fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch, retryDelayMs: 1 });
    const err2 = await loadElevation({ lidar: false, centre: { lat: -30.5, lon: 152.0 }, extent: 2000, cellSize: 30, cache: null }).catch((e) => e);
    expect(err2).toBeInstanceOf(ElevationUnavailableError);
  });

  it('falls back to the bundled zoom-13 tiles when fine cells (default zoom 14) are requested offline', async () => {
    // Regression: at a demo site with < 20 m cells and no network this used to fail outright.
    const r = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 3000, cellSize: 10, cache: createMemoryKV(), offline: true });
    expect(r.zoom).toBe(13);
    expect(r.grid.cellSize).toBe(10);
    expect(r.grid.nx).toBe(300);
    expect(r.source).toContain('bundled (katoomba)');
    expect(r.source).toContain('zoom 14 unavailable');
    const s = stats(r.elevation);
    expect(s.nan).toBe(0);
    expect(s.min).toBeGreaterThan(250);
  });

  it('interpolates around isolated no-data pixels instead of dropping cells to sea level', async () => {
    // Regression: one void pixel made every cell touching it NaN → 0 m, a 800 m deep pit in the surface.
    setAssetLoader(async (p) => (p.endsWith('.png') ? makeTile((c, r) => ((c + r) % 37 === 0 ? -32768 : 800 + c * 0.5)) : null));
    const r = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 3000, cellSize: 30, cache: null, offline: true });
    const s = stats(r.elevation);
    expect(r.seaOrNoDataCells).toBe(0);
    expect(s.nan).toBe(0);
    expect(s.min).toBeGreaterThanOrEqual(800);
    expect(s.max).toBeLessThanOrEqual(800 + 255 * 0.5);
  });

  it('uses Terrarium tiles stored in an overlapping area pack (offline)', async () => {
    const tiles = elevationTilesFor({ centre: KATOOMBA.centre, extent: 4000, cellSize: 30 });
    const items: Record<string, ArrayBuffer | Uint8Array> = {};
    tiles.forEach((t, n) => {
      const png = readPublic(`demo/katoomba/terrarium/${t.z}/${t.x}/${t.y}.png`);
      // Packs may hold raw ArrayBuffers or typed arrays.
      items[t.key] = n % 2 ? png : png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
    });
    const kv = createMemoryKV();
    await saveAreaPack({ id: 'nn', name: 'Narrow Neck', centre: KATOOMBA.centre, extent: 5000, createdAt: 1, items }, kv);
    setAssetLoader(async () => null); // nothing bundled
    const r = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 4000, cellSize: 30, cache: kv, offline: true });
    expect(r.source).toContain(`${tiles.length} from area pack 'Narrow Neck'`);
    setAssetLoader(null);
    const bundled = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 4000, cellSize: 30, cache: null, offline: true });
    expect(r.elevation).toEqual(bundled.elevation);
  });

  it('falls through a corrupt bundled tile to the network, and never caches a non-PNG download', async () => {
    const corrupt = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]); // PNG signature + junk
    setAssetLoader(async (p) => (p.endsWith('.png') ? corrupt : null));
    let html = true;
    setHttpConfig({
      retryDelayMs: 1,
      fetch: (async (input: RequestInfo | URL) => {
        if (html) return new Response('<!doctype html><title>proxy error</title>', { headers: { 'content-type': 'text/html' } });
        const m = /terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(String(input))!;
        return new Response(readPublic(`demo/katoomba/terrarium/${m[1]}/${m[2]}/${m[3]}.png`));
      }) as typeof fetch,
    });
    const kv = createMemoryKV();
    const req = { centre: KATOOMBA.centre, extent: 2000, cellSize: 30, cache: kv };
    const err = await loadElevation(req).catch((e) => e);
    expect(err).toBeInstanceOf(ElevationUnavailableError);
    expect(await kv.keys('terrarium/')).toEqual([]); // the HTML page was not cached
    html = false;
    const r = await loadElevation(req);
    expect(r.source).toContain('downloaded');
    expect(stats(r.elevation).min).toBeGreaterThan(250);
  });

  it('drops a corrupt cached tile and downloads it again', async () => {
    setAssetLoader(async () => null);
    const tiles = elevationTilesFor({ centre: KATOOMBA.centre, extent: 1000, cellSize: 30 });
    const kv = createMemoryKV();
    for (const t of tiles) await kv.put(t.key, { t: Date.now(), url: t.url, v: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]).buffer });
    let calls = 0;
    setHttpConfig({
      fetch: (async (input: RequestInfo | URL) => {
        calls++;
        const m = /terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(String(input))!;
        return new Response(readPublic(`demo/katoomba/terrarium/${m[1]}/${m[2]}/${m[3]}.png`));
      }) as typeof fetch,
    });
    const r = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 1000, cellSize: 30, cache: kv });
    expect(calls).toBe(tiles.length);
    expect(r.source).toContain(`${tiles.length} downloaded`);
    // The good copy replaced the corrupt one: the next load is served from the cache.
    const again = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 1000, cellSize: 30, cache: kv, offline: true });
    expect(again.source).toContain(`${tiles.length} cached`);
  });

  it('clamps sea / no-data to 0 m and counts it', async () => {
    setAssetLoader(async (p) => (p.endsWith('.png') ? makeTile((c) => (c < 128 ? -32768 : -12)) : null));
    const r = await loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 2000, cellSize: 50, cache: null, offline: true });
    expect(stats(r.elevation)).toMatchObject({ min: 0, max: 0, nan: 0 });
    expect(r.seaOrNoDataCells).toBe(r.elevation.length);
  });

  it('respects an aborted signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 2000, cellSize: 30, cache: null, signal: ctrl.signal })).rejects.toBeTruthy();
  });

  it('refuses absurdly large requests', async () => {
    await expect(loadElevation({ lidar: false, centre: KATOOMBA.centre, extent: 60000, cellSize: 10, cache: null })).rejects.toThrow(RangeError);
  });

  for (const id of ['grose', 'kanangra', 'thredbo']) {
    it(`loads the ${id} demo terrain without gaps`, async () => {
      const site = DEMO_SITES.find((s) => s.id === id)!;
      const r = await loadElevation({ lidar: false, centre: site.centre, extent: 6000, cellSize: 30, demoSiteId: id, cache: null, offline: true });
      const s = stats(r.elevation);
      expect(s.nan).toBe(0);
      expect(s.min).toBeGreaterThan(200);
      expect(s.max - s.min).toBeGreaterThan(300);
      if (id === 'thredbo') expect(s.min).toBeGreaterThan(1200); // alpine valley floor
    });
  }
});

describe('syntheticElevation', () => {
  const origin = { lat: -33.7, lon: 150.3 };
  const grid = makeGridSpec(origin, 6000, 30);

  it('is deterministic, finite and seed-dependent', () => {
    for (const kind of ['escarpment', 'gorge', 'ridges'] as const) {
      const a = syntheticElevation(grid, kind);
      expect(syntheticElevation(grid, kind)).toEqual(a);
      expect(stats(a).nan).toBe(0);
      expect(Number.isFinite(stats(a).max)).toBe(true);
      const b = syntheticElevation(grid, kind, 7);
      let diff = 0;
      for (let k = 0; k < a.length; k++) diff = Math.max(diff, Math.abs(a[k]! - b[k]!));
      expect(diff).toBeGreaterThan(10);
    }
  });

  it('is resolution independent (a 60 m grid samples the same surface as a 30 m grid)', () => {
    const fine: GridSpec = { nx: 201, ny: 201, cellSize: 30, x0: -3000, y0: -3000, origin };
    const coarse: GridSpec = { nx: 101, ny: 101, cellSize: 60, x0: -3000, y0: -3000, origin };
    for (const kind of ['escarpment', 'gorge', 'ridges'] as const) {
      const f = syntheticElevation(fine, kind);
      const c = syntheticElevation(coarse, kind);
      for (let j = 0; j < 101; j += 10) for (let i = 0; i < 101; i += 10) expect(c[j * 101 + i]).toBeCloseTo(f[2 * j * 201 + 2 * i]!, 3);
    }
  });

  it('is continuous: no steps between points 1 m apart (gully mouths, canyon mouths, wall-texture edges)', () => {
    // Regression: gully mouths used to end in ~50 m steps (with pits behind them) and the gorge's wall texture and
    // side canyons switched on abruptly (~20 m steps). The steepest real feature is the escarpment cliff
    // (250 m over 70 m with a smoothstep profile → 5.4 m per metre at most).
    for (const kind of ['escarpment', 'gorge', 'ridges'] as const) {
      let worst = 0;
      for (let line = -4500; line <= 4500; line += 150) {
        const ew = syntheticElevation({ nx: 9001, ny: 1, cellSize: 1, x0: -4500, y0: line, origin }, kind);
        const ns = syntheticElevation({ nx: 1, ny: 9001, cellSize: 1, x0: line, y0: -4500, origin }, kind);
        for (let k = 1; k < 9001; k++) worst = Math.max(worst, Math.abs(ew[k]! - ew[k - 1]!), Math.abs(ns[k]! - ns[k - 1]!));
      }
      expect(worst, kind).toBeLessThan(6);
    }
  });

  it("'escarpment': ~1000 m plateau to the east, 250 m cliffs, dissected valley to the west, gullies", () => {
    const e = syntheticElevation(grid, 'escarpment');
    const s = stats(e);
    expect(s.max).toBeGreaterThan(990);
    expect(s.max).toBeLessThan(1060);
    expect(s.min).toBeGreaterThan(380);
    expect(s.min).toBeLessThan(650);
    expect(columnBandMean(grid, e, 150, 200) - columnBandMean(grid, e, 0, 50)).toBeGreaterThan(350);
    // Cliffs: many cells steeper than 60°.
    const sl = slopeDeg(grid, e);
    let cliffs = 0;
    for (const v of sl) if (v > 60) cliffs++;
    expect(cliffs).toBeGreaterThan(200);
    // Cliff height: going west along each row, the surface drops ≥ 200 m within 150 m of the rim.
    let rows = 0;
    const rimX: number[] = [];
    for (let j = 0; j < grid.ny; j++) {
      const row = j * grid.nx;
      let rim = -1;
      for (let i = grid.nx - 1; i >= 0; i--) if (e[row + i]! < 960) { rim = i; break; }
      if (rim < 5) continue;
      rimX.push(rim);
      if (e[row + rim + 1]! - e[row + rim - 5]! > 200) rows++;
    }
    expect(rows / grid.ny).toBeGreaterThan(0.5);
    // Sinuous rim with gullies cutting back into the plateau: rim position varies by > 300 m.
    expect((Math.max(...rimX) - Math.min(...rimX)) * grid.cellSize).toBeGreaterThan(300);
  });

  it("'gorge': deep E–W gorge with a south-facing north wall and a north-facing south wall", () => {
    const e = syntheticElevation(grid, 'gorge');
    const { dy } = gradient(grid, e);
    const sl = slopeDeg(grid, e);
    expect(stats(sl).max).toBeGreaterThan(55);
    let northWallRising = 0;
    let southWallFalling = 0;
    let wallCells = 0;
    for (let i = 0; i < grid.nx; i += 3) {
      // Gorge floor: lowest cell in the column, which must be deep everywhere (the gorge runs right across).
      let jMin = 0;
      for (let j = 0; j < grid.ny; j++) if (e[j * grid.nx + i]! < e[jMin * grid.nx + i]!) jMin = j;
      expect(e[jMin * grid.nx + i]).toBeLessThan(520);
      expect(Math.abs((grid.y0 + jMin * grid.cellSize) / 1000)).toBeLessThan(0.8);
      // Plateau well above on both sides.
      expect(e[(grid.ny - 1) * grid.nx + i]! - e[jMin * grid.nx + i]!).toBeGreaterThan(400);
      expect(e[i]! - e[jMin * grid.nx + i]!).toBeGreaterThan(400);
      for (let d = 5; d <= 15; d++) {
        const jn = jMin + d;
        const js = jMin - d;
        if (jn < grid.ny) (wallCells++, dy[jn * grid.nx + i]! > 0.1 && northWallRising++);
        if (js >= 0) (wallCells++, dy[js * grid.nx + i]! < -0.1 && southWallFalling++);
      }
    }
    // Upslope to the north on the north wall (so it faces south); upslope to the south on the south wall.
    expect((northWallRising + southWallFalling) / wallCells).toBeGreaterThan(0.85);
  });

  it("'ridges': several parallel ridges whose crests dip into saddles", () => {
    const e = syntheticElevation(grid, 'ridges');
    const s = stats(e);
    expect(s.max - s.min).toBeGreaterThan(180);
    // Count prominent ridges crossing the middle row.
    const j = grid.ny >> 1;
    const prof = Array.from({ length: grid.nx }, (_, i) => e[j * grid.nx + i]!);
    let ridges = 0;
    // A crest is the highest point within ±600 m and stands > 50 m above the lowest point there (even at a saddle).
    for (let i = 20; i < grid.nx - 20; i++) {
      const win = prof.slice(i - 20, i + 21);
      if (prof[i] === Math.max(...win) && prof[i]! - Math.min(...win) > 50) ridges++;
    }
    expect(ridges).toBeGreaterThanOrEqual(3);
    // Follow the crest nearest x = 0 northwards: its height varies by > 60 m (knolls and saddles).
    let i0 = grid.nx >> 1;
    const crest: number[] = [];
    for (let jj = 0; jj < grid.ny; jj++) {
      let best = i0;
      for (let i = Math.max(0, i0 - 4); i <= Math.min(grid.nx - 1, i0 + 4); i++) if (e[jj * grid.nx + i]! > e[jj * grid.nx + best]!) best = i;
      i0 = best;
      crest.push(e[jj * grid.nx + best]!);
    }
    expect(Math.max(...crest) - Math.min(...crest)).toBeGreaterThan(60);
  });
});
