import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decode, encode } from 'fast-png';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { LocalProjection } from '../core/geo';
import { DEMO_SITES } from './demoSites';
import { setAssetLoader } from './assets';
import { createMemoryKV } from './cache';
import { resetHttpConfig, setHttpConfig } from './http';
import { fillInvalidNearest, loadBundledCanopyRaster, loadCanopy, loadRemoteCanopy, quadkey, remoteCanopyCacheKey } from './canopy';

const PUBLIC = new URL('../../public/', import.meta.url);
const site = (id: string) => DEMO_SITES.find((s) => s.id === id)!;
// Only these fixtures are guaranteed to be present (others may still be downloading).
const READY = ['katoomba', 'grose', 'kanangra', 'thredbo'];

afterEach(() => {
  setAssetLoader(null);
  resetHttpConfig();
  vi.restoreAllMocks();
});

const mean = (a: ArrayLike<number>) => {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k]!;
  return s / a.length;
};

function range(a: ArrayLike<number>) {
  let min = Infinity;
  let max = -Infinity;
  let nan = 0;
  for (let k = 0; k < a.length; k++) {
    const v = a[k]!;
    if (Number.isNaN(v)) nan++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max, nan };
}

describe('bundled canopy rasters', () => {
  it('decodes the Katoomba raster onto its own grid with row 0 = south', async () => {
    const r = (await loadBundledCanopyRaster('katoomba'))!;
    expect(r.grid.nx).toBe(450);
    expect(r.grid.cellSize).toBe(20);
    expect(r.grid.x0).toBeCloseTo(-4490);
    // Compare against the raw PNG: grid row j is PNG row n-1-j.
    const png = decode(new Uint8Array(readFileSync(new URL('demo/katoomba/canopy.png', PUBLIC))));
    for (const [i, j] of [[0, 0], [449, 0], [10, 400], [225, 225]] as const) {
      const o = ((449 - j) * 450 + i) * 3;
      const k = j * 450 + i;
      expect(r.height[k]).toBe(png.data[o]);
      expect(r.meanHeight[k]).toBe(png.data[o + 1]);
      expect(r.cover[k]).toBeCloseTo(png.data[o + 2]! / 255, 6);
    }
    expect(range(r.height).max).toBeLessThanOrEqual(60);
    expect(range(r.cover).max).toBeLessThanOrEqual(1);
  });

  it('returns null for sites without a raster', async () => {
    expect(await loadBundledCanopyRaster('nowhere')).toBeNull();
  });
});

describe('loadCanopy (bundled)', () => {
  it('Katoomba at 30 m over 6 km: full coverage, plausible dry-sclerophyll forest values', async () => {
    const grid = makeGridSpec(site('katoomba').centre, 6000, 30);
    const c = (await loadCanopy(grid, { demoSiteId: 'katoomba' }))!;
    expect(c).not.toBeNull();
    expect(c.height.length).toBe(grid.nx * grid.ny);
    expect(c.coverage).toBe(1);
    expect(range(c.height).nan + range(c.cover).nan + range(c.meanHeight).nan).toBe(0);
    expect(range(c.height).min).toBeGreaterThanOrEqual(0);
    expect(range(c.height).max).toBeLessThanOrEqual(60);
    expect(range(c.cover).min).toBeGreaterThanOrEqual(0);
    expect(range(c.cover).max).toBeLessThanOrEqual(1);
    expect(mean(c.height)).toBeGreaterThan(5);
    expect(mean(c.height)).toBeLessThan(30);
    expect(mean(c.cover)).toBeGreaterThan(0.3);
    // The 90th-percentile height is never below the mean height (up to rounding and interpolation).
    let bad = 0;
    for (let k = 0; k < c.height.length; k++) if (c.height[k]! + 1 < c.meanHeight[k]!) bad++;
    expect(bad / c.height.length).toBeLessThan(0.01);
    expect(c.source).toContain("bundled demo 'katoomba'");
    expect(c.source).toContain('averaged');
  });

  it('reproduces the raster exactly on its own grid', async () => {
    const raster = (await loadBundledCanopyRaster('katoomba'))!;
    const c = (await loadCanopy(raster.grid, { demoSiteId: 'katoomba' }))!;
    expect(c.height).toEqual(raster.height);
    expect(c.cover).toEqual(raster.cover);
  });

  it('area-averaging to 60 m conserves the mean cover of the covered area', async () => {
    const raster = (await loadBundledCanopyRaster('katoomba'))!;
    // 60 m cells aligned with 3×3 blocks of the 20 m raster, over the central 6 km.
    const grid: GridSpec = { nx: 100, ny: 100, cellSize: 60, x0: -2970, y0: -2970, origin: raster.grid.origin };
    const c = (await loadCanopy(grid, { demoSiteId: 'katoomba' }))!;
    let s = 0;
    let n = 0;
    for (let j = 0; j < 450; j++)
      for (let i = 0; i < 450; i++) {
        const x = raster.grid.x0 + i * 20;
        const y = raster.grid.y0 + j * 20;
        if (x > -3000 && x < 3000 && y > -3000 && y < 3000) (s += raster.cover[j * 450 + i]!), n++;
      }
    expect(mean(c.cover)).toBeCloseTo(s / n, 3);
    // Each 60 m cell is the mean of its 3×3 block.
    const i = 40;
    const j = 55;
    let block = 0;
    const ci = Math.round((grid.x0 + i * 60 - raster.grid.x0) / 20);
    const cj = Math.round((grid.y0 + j * 60 - raster.grid.y0) / 20);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) block += raster.height[(cj + dj) * 450 + ci + di]!;
    expect(c.height[j * 100 + i]).toBeCloseTo(block / 9, 3);
  });

  it('maps geography correctly when the grid origin differs from the raster centre', async () => {
    const katoomba = site('katoomba').centre;
    const shifted = new LocalProjection(katoomba).toLatLon(1000, -700);
    const a = (await loadCanopy(makeGridSpec(katoomba, 3000, 20), { demoSiteId: 'katoomba' }))!;
    const bGrid = makeGridSpec(shifted, 3000, 20);
    const b = (await loadCanopy(bGrid, { demoSiteId: 'katoomba' }))!;
    const pa = new LocalProjection(katoomba);
    const pb = new LocalProjection(shifted);
    const aGrid = makeGridSpec(katoomba, 3000, 20);
    let diff = 0;
    let n = 0;
    // b's cells (i 10..60, j 60..140) lie inside a (b is 1 km east, 700 m south of a).
    for (let j = 60; j < 140; j += 5)
      for (let i = 10; i < 60; i += 5) {
        const [x, y] = pa.toLocal(pb.toLatLon(bGrid.x0 + i * 20, bGrid.y0 + j * 20));
        const ia = Math.round((x - aGrid.x0) / 20);
        const ja = Math.round((y - aGrid.y0) / 20);
        diff += Math.abs(a.height[ja * aGrid.nx + ia]! - b.height[j * bGrid.nx + i]!);
        n++;
      }
    expect(diff / n).toBeLessThan(0.5);
  });

  it('finds the bundled raster automatically and reports partial coverage', async () => {
    const katoomba = site('katoomba').centre;
    const auto = await loadCanopy(makeGridSpec(katoomba, 2000, 30));
    expect(auto?.source).toContain("'katoomba'");
    // 5 km east: the 6 km grid overlaps the 9 km raster by 2.5 km → ~42 % coverage.
    const east = new LocalProjection(katoomba).toLatLon(5000, 0);
    const grid = makeGridSpec(east, 6000, 30);
    expect(await loadCanopy(grid, { demoSiteId: 'katoomba' })).toBeNull();
    const part = (await loadCanopy(grid, { demoSiteId: 'katoomba', minCoverage: 0.3 }))!;
    expect(part.coverage).toBeGreaterThan(0.38);
    expect(part.coverage).toBeLessThan(0.46);
    expect(part.valid[100 * grid.nx + 10]).toBe(1); // west edge: inside the raster
    expect(part.valid[100 * grid.nx + 190]).toBe(0); // east edge: outside
    expect(range(part.height).nan).toBe(0); // extended from the edge, never NaN
    expect(part.source).toMatch(/% of area covered/);
  });

  it('handles a bundled raster only one cell wide and tall (degenerate bilinear) without NaN', async () => {
    // Regression: bilinear resampling indexed cell −1 when the source had a single row or column.
    const centre = site('katoomba').centre;
    const json = JSON.stringify({ id: 'tiny', cellSize: 20, n: 1, centre, extent: 20 });
    const png = encode({ width: 1, height: 1, data: new Uint8Array([18, 9, 204]), channels: 3, depth: 8 });
    setAssetLoader(async (p) => (p === 'demo/tiny/canopy.json' ? new TextEncoder().encode(json) : p === 'demo/tiny/canopy.png' ? png : null));
    const c = (await loadCanopy({ nx: 3, ny: 3, cellSize: 5, x0: -5, y0: -5, origin: centre }, { demoSiteId: 'tiny' }))!;
    expect(c).not.toBeNull();
    expect([...c.height]).toEqual(new Array(9).fill(18));
    expect([...c.meanHeight]).toEqual(new Array(9).fill(9));
    for (const v of c.cover) expect(v).toBeCloseTo(0.8, 6);
  });

  it('returns null far from any demo site when remote access is not allowed', async () => {
    expect(await loadCanopy(makeGridSpec({ lat: -30.5, lon: 152.0 }, 3000, 30))).toBeNull();
  });

  it('survives a corrupt bundle and falls through', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setAssetLoader(async (p) => (p.endsWith('canopy.json') ? new TextEncoder().encode('{"id":"x","cellSize":20,"n":450,"centre":{"lat":-33.715,"lon":150.285},"extent":9000}') : new Uint8Array([1, 2, 3])));
    expect(await loadCanopy(makeGridSpec(site('katoomba').centre, 3000, 30), { demoSiteId: 'katoomba' })).toBeNull();
    warn.mockRestore();
  });

  it('bundled canopy loads for grose, kanangra and thredbo; alpine Thredbo is lower than Katoomba forest', async () => {
    const means: Record<string, number> = {};
    for (const id of READY) {
      const grid = makeGridSpec(site(id).centre, 6000, 30);
      const c = (await loadCanopy(grid, { demoSiteId: id }))!;
      expect(c, id).not.toBeNull();
      expect(c.coverage).toBe(1);
      expect(range(c.height).nan).toBe(0);
      expect(range(c.height).max).toBeGreaterThan(15);
      means[id] = mean(c.height);
    }
    expect(means.thredbo!).toBeLessThan(means.katoomba!);
  });
});

describe('remote canopy', () => {
  it('computes the CHM quadkey used by the bundling script', () => {
    expect(quadkey(-33.715, 150.285, 9)).toBe('311230121');
  });

  it('refuses areas larger than 3 km without touching the network', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadRemoteCanopy(makeGridSpec(site('katoomba').centre, 6000, 30), { cache: null })).toBeNull();
    expect(warn.mock.calls[0]?.[0]).toMatch(/limited to 3 km/);
    warn.mockRestore();
  });

  it('serves a previously computed remote result from the cache', async () => {
    const kv = createMemoryKV();
    const grid = makeGridSpec({ lat: -30.5, lon: 152.0 }, 200, 20);
    const n = grid.nx * grid.ny;
    const key = remoteCanopyCacheKey(grid);
    await kv.put(key, { height: new Float32Array(n).fill(12), meanHeight: new Float32Array(n).fill(8), cover: new Float32Array(n).fill(0.7), valid: new Uint8Array(n).fill(1), source: 'test' });
    const r = (await loadCanopy(grid, { allowRemote: true, cache: kv }))!;
    expect(r.source).toBe('test (cached)');
    expect(r.height[0]).toBe(12);
    expect(r.coverage).toBe(1);
  });

  it('aggregates a 1 m COG with 1-row strips into p90 / mean / cover with the right orientation (fake server)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const centre = site('katoomba').centre;
    const grid = makeGridSpec(centre, 600, 20);
    const server = fakeChmServer(grid, () => true);
    setHttpConfig({ fetch: server.fetch });
    const c = (await loadRemoteCanopy(grid, { cache: null }))!;
    expect(c).not.toBeNull();
    expect(c.coverage).toBe(1);
    expect(server.urls.every((u) => u.includes('/forests/v1/alsgedi_global_v6_float/chm/311230121.tif'))).toBe(true);
    // 1-row strips are read with about one range request per sampled row (every 4th of ~500 rows here). Regression:
    // without geotiff's block cache every row also cost two 4-byte requests for its strip offset and byte count (~460).
    expect(server.rangeRequests).toBeGreaterThan(20);
    expect(server.rangeRequests).toBeLessThan(200);
    let checked = 0;
    for (let j = 0; j < grid.ny; j++)
      for (let i = 0; i < grid.nx; i++) {
        const x = grid.x0 + i * 20;
        const y = grid.y0 + j * 20;
        if (Math.abs(x) < 30 || Math.abs(y) < 30) continue; // cells straddling a quadrant boundary
        const k = j * grid.nx + i;
        const q = quadrantCanopy(x, y);
        expect(c.height[k], `p90 at ${x},${y}`).toBe(q.p90);
        expect(c.meanHeight[k]!, `mean at ${x},${y}`).toBeCloseTo(q.mean, q.mean === 20 ? 0 : 5);
        expect(c.cover[k], `cover at ${x},${y}`).toBe(q.cover);
        checked++;
      }
    expect(checked).toBeGreaterThan(600);
  });

  it('caches complete remote results, but not partial ones where a COG failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Straddle the z9 quadkey boundary at lon 150.46875 so two COGs are needed.
    const grid = makeGridSpec({ lat: -33.715, lon: 150.46875 }, 400, 20);
    const west = quadkey(-33.715, 150.46, 9);
    expect(quadkey(-33.715, 150.48, 9)).not.toBe(west);
    const kv = createMemoryKV();
    // Only the western COG answers: the result must not be cached (regression: it was, leaving a permanent hole).
    setHttpConfig({ fetch: fakeChmServer(grid, (url) => url.includes(`/${west}.tif`)).fetch });
    expect(await loadRemoteCanopy(grid, { cache: kv })).not.toBeNull();
    expect(await kv.keys('canopy/')).toEqual([]);
    // Both answer: cached, and the next call does not touch the network.
    const server = fakeChmServer(grid, () => true);
    setHttpConfig({ fetch: server.fetch });
    expect((await loadRemoteCanopy(grid, { cache: kv }))!.coverage).toBe(1);
    expect(await kv.keys('canopy/')).toHaveLength(1);
    const n = server.urls.length;
    expect((await loadRemoteCanopy(grid, { cache: kv }))!.source).toMatch(/\(cached\)$/);
    expect(server.urls.length).toBe(n);
  });

  it.skipIf(!process.env.NET)('reads the Meta CHM COG over the network and matches the bundled raster (NET=1)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const grid = makeGridSpec(site('katoomba').centre, 600, 20);
    const remote = (await loadRemoteCanopy(grid, { cache: null }))!;
    warn.mockRestore();
    expect(remote).not.toBeNull();
    expect(remote.coverage).toBe(1);
    const bundled = (await loadCanopy(grid, { demoSiteId: 'katoomba' }))!;
    let dh = 0;
    let dc = 0;
    for (let k = 0; k < remote.height.length; k++) {
      dh += Math.abs(remote.height[k]! - bundled.height[k]!);
      dc += Math.abs(remote.cover[k]! - bundled.cover[k]!);
    }
    // Row sub-sampling makes it an estimate of the same statistics.
    expect(dh / remote.height.length).toBeLessThan(1.5);
    expect(dc / remote.height.length).toBeLessThan(0.05);
  }, 180_000);
});

describe('fillInvalidNearest', () => {
  it('copies each invalid cell from a valid cell at the minimum 4-neighbour distance', () => {
    const nx = 37;
    const ny = 23;
    const valid = new Uint8Array(nx * ny);
    const f = new Float32Array(nx * ny).fill(-1);
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let k = 0; k < valid.length; k++) if (rnd() < 0.04) (valid[k] = 1), (f[k] = k); // value = own index
    const g = f.slice();
    fillInvalidNearest({ nx, ny }, valid, [f, g]);
    for (let k = 0; k < f.length; k++) {
      const src = f[k]!;
      expect(src).toBeGreaterThanOrEqual(0);
      expect(g[k]).toBe(src); // all fields filled consistently
      expect(valid[Math.round(src)]).toBe(1);
      // Manhattan distance to the source equals the distance to the nearest valid cell.
      const d = (a: number, b: number) => Math.abs((a % nx) - (b % nx)) + Math.abs(Math.floor(a / nx) - Math.floor(b / nx));
      let best = Infinity;
      for (let q = 0; q < valid.length; q++) if (valid[q]) best = Math.min(best, d(k, q));
      expect(d(k, src)).toBe(best);
    }
  });

  it('is linear-time: a 1000 × 1000 grid with one valid cell fills quickly', () => {
    const n = 1000;
    const valid = new Uint8Array(n * n);
    valid[123 * n + 456] = 1;
    const f = new Float32Array(n * n);
    f[123 * n + 456] = 7;
    const t0 = performance.now();
    fillInvalidNearest({ nx: n, ny: n }, valid, [f]);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(f[0]).toBe(7);
    expect(f[n * n - 1]).toBe(7);
    expect(valid[0]).toBe(0); // the mask is not modified
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake Meta CHM server: a hand-built uncompressed 8-bit GeoTIFF in Web Mercator with 1-row strips (like the real COGs)
// served with HTTP range requests through the injectable fetch.
// ─────────────────────────────────────────────────────────────────────────────

const MERC_R = 6378137;
const CHM_RES = (2 * Math.PI * MERC_R) / 2 ** 25;

/** Expected canopy statistics per quadrant of the fake image (x east, y north of the grid origin). */
function quadrantCanopy(x: number, y: number): { p90: number; mean: number; cover: number } {
  if (x > 0 && y > 0) return { p90: 30, mean: 20, cover: 1 }; // NE: alternate 1 m columns 10 m / 30 m tall
  if (x <= 0 && y > 0) return { p90: 0, mean: 0, cover: 0 }; // NW: bare
  if (x > 0) return { p90: 5, mean: 5, cover: 1 }; // SE: 5 m regrowth
  return { p90: 1, mean: 1, cover: 0 }; // SW: 1 m heath, below the 2 m cover threshold
}

function quadrantPixel(x: number, y: number, col: number): number {
  if (x > 0 && y > 0) return col % 2 ? 30 : 10;
  if (x <= 0 && y > 0) return 0;
  return x > 0 ? 5 : 1;
}

/** Minimal little-endian TIFF: uint8, one band, uncompressed, RowsPerStrip = 1, ModelPixelScale + ModelTiepoint. */
function buildStripTiff(w: number, h: number, pixels: Uint8Array, minX: number, maxY: number): ArrayBuffer {
  const entries: [tag: number, type: number, count: number, value: number | number[]][] = [];
  const nEntries = 13;
  const ifdSize = 2 + nEntries * 12 + 4;
  let off = 8 + ifdSize;
  const stripOffsetsAt = off;
  off += 4 * h;
  const stripCountsAt = off;
  off += 4 * h;
  const scaleAt = off;
  off += 24;
  const tieAt = off;
  off += 48;
  const dataAt = off;
  const buf = new ArrayBuffer(dataAt + w * h);
  const dv = new DataView(buf);
  dv.setUint16(0, 0x4949, true);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  const SHORT = 3;
  const LONG = 4;
  const DOUBLE = 12;
  entries.push([256, LONG, 1, w], [257, LONG, 1, h], [258, SHORT, 1, 8], [259, SHORT, 1, 1], [262, SHORT, 1, 1]);
  entries.push([273, LONG, h, stripOffsetsAt], [277, SHORT, 1, 1], [278, LONG, 1, 1], [279, LONG, h, stripCountsAt]);
  entries.push([284, SHORT, 1, 1], [339, SHORT, 1, 1], [33550, DOUBLE, 3, scaleAt], [33922, DOUBLE, 6, tieAt]);
  dv.setUint16(8, nEntries, true);
  entries.forEach(([tag, type, count, value], e) => {
    const p = 10 + e * 12;
    dv.setUint16(p, tag, true);
    dv.setUint16(p + 2, type, true);
    dv.setUint32(p + 4, count, true);
    if (type === SHORT && count === 1) dv.setUint16(p + 8, value as number, true);
    else dv.setUint32(p + 8, value as number, true);
  });
  dv.setUint32(10 + nEntries * 12, 0, true);
  for (let r = 0; r < h; r++) {
    dv.setUint32(stripOffsetsAt + 4 * r, dataAt + r * w, true);
    dv.setUint32(stripCountsAt + 4 * r, w, true);
  }
  [CHM_RES, CHM_RES, 0].forEach((v, n) => dv.setFloat64(scaleAt + 8 * n, v, true));
  [0, 0, 0, minX, maxY, 0].forEach((v, n) => dv.setFloat64(tieAt + 8 * n, v, true));
  new Uint8Array(buf, dataAt).set(pixels);
  return buf;
}

/** A fetch that serves a fake CHM covering `grid` (plus a margin) for URLs accepted by `serve`, 404 otherwise. */
function fakeChmServer(grid: GridSpec, serve: (url: string) => boolean) {
  const proj = new LocalProjection(grid.origin);
  const half = (grid.nx * grid.cellSize) / 2 + 60;
  const sw = proj.toLatLon(-half, -half);
  const ne = proj.toLatLon(half, half);
  const mx = (lon: number) => (MERC_R * lon * Math.PI) / 180;
  const my = (lat: number) => MERC_R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const minX = mx(sw.lon);
  const maxY = my(ne.lat);
  const w = Math.ceil((mx(ne.lon) - minX) / CHM_RES);
  const h = Math.ceil((maxY - my(sw.lat)) / CHM_RES);
  const pixels = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    const lat = ((2 * Math.atan(Math.exp((maxY - (r + 0.5) * CHM_RES) / MERC_R)) - Math.PI / 2) * 180) / Math.PI;
    const y = proj.toLocal({ lat, lon: grid.origin.lon })[1];
    for (let c = 0; c < w; c++) {
      const lon = (((minX + (c + 0.5) * CHM_RES) / MERC_R) * 180) / Math.PI;
      const x = proj.toLocal({ lat: grid.origin.lat, lon })[0];
      pixels[r * w + c] = quadrantPixel(x, y, c);
    }
  }
  const tiff = new Uint8Array(buildStripTiff(w, h, pixels, minX, maxY));
  const urls: string[] = [];
  let rangeRequests = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (!serve(url)) return new Response('not found', { status: 404 });
    const range = (init?.headers as Record<string, string> | undefined)?.['range'];
    const m = /bytes=(\d+)-(\d+)/.exec(range ?? '');
    if (!m) return new Response(tiff.slice());
    rangeRequests++;
    const a = Number(m[1]);
    const b = Math.min(Number(m[2]), tiff.length - 1);
    return new Response(tiff.slice(a, b + 1), { status: 206, headers: { 'content-range': `bytes ${a}-${b}/${tiff.length}`, 'content-type': 'image/tiff' } });
  }) as typeof globalThis.fetch;
  return {
    fetch,
    urls,
    get rangeRequests() {
      return rangeRequests;
    },
  };
}
