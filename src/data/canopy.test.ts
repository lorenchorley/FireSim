import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decode } from 'fast-png';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { LocalProjection } from '../core/geo';
import { DEMO_SITES } from './demoSites';
import { setAssetLoader } from './assets';
import { createMemoryKV } from './cache';
import { loadBundledCanopyRaster, loadCanopy, loadRemoteCanopy, quadkey, remoteCanopyCacheKey } from './canopy';

const PUBLIC = new URL('../../public/', import.meta.url);
const site = (id: string) => DEMO_SITES.find((s) => s.id === id)!;
// Only these fixtures are guaranteed to be present (others may still be downloading).
const READY = ['katoomba', 'grose', 'kanangra', 'thredbo'];

afterEach(() => setAssetLoader(null));

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
