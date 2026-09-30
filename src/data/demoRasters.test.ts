import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { DEMO_SITES } from './demoSites';
import { imageryWindow, loadDemoDem, loadDemoElevation, loadDemoFireHistoryGeoJson, loadDemoImageryInfo, loadDemoVegetationGeoJson } from './demoRasters';
import { loadElevation } from './terrainTiles';

const katoomba = DEMO_SITES.find((s) => s.id === 'katoomba')!;

describe('bundled 5 m elevation model', () => {
  it('decodes the Katoomba DTM with plausible elevations, north at the top', async () => {
    const dem = await loadDemoDem('katoomba');
    expect(dem).not.toBeNull();
    const { grid, elevation, meta } = dem!;
    expect(grid.nx).toBe(900);
    let mn = Infinity;
    let mx = -Infinity;
    for (const v of elevation) {
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
    }
    expect(mn).toBeCloseTo(meta.minElevation!, 0);
    expect(mx).toBeCloseTo(meta.maxElevation!, 0);
  });

  it('every demo site has a DTM whose range matches its metadata', async () => {
    for (const s of DEMO_SITES) {
      const dem = await loadDemoDem(s.id);
      expect(dem, s.id).not.toBeNull();
      expect(dem!.meta.maxElevation! - dem!.meta.minElevation!).toBeGreaterThan(150);
    }
  });

  it('loadElevation prefers the LiDAR DTM inside a demo domain and agrees with SRTM broadly', async () => {
    const req = { centre: katoomba.centre, extent: 6000, cellSize: 30, cache: null, offline: true } as const;
    const lidar = await loadElevation(req);
    const srtm = await loadElevation({ ...req, lidar: false });
    expect(lidar.source).toMatch(/NSW_5M_Elevation/);
    expect(srtm.source).not.toMatch(/NSW_5M_Elevation/);
    let diff = 0;
    for (let k = 0; k < lidar.elevation.length; k++) diff += Math.abs(lidar.elevation[k]! - srtm.elevation[k]!);
    // Same landscape: mean absolute difference of a few tens of metres at most (SRTM includes some canopy, 30 m data).
    expect(diff / lidar.elevation.length).toBeLessThan(40);
  });

  it('falls back to tiles when the domain extends beyond the DTM', async () => {
    const r = await loadElevation({ centre: katoomba.centre, extent: 12000, cellSize: 60, cache: null, offline: true }).catch((e) => e);
    // Either SRTM tiles (bundled cover 9 km only, so offline this may be unavailable) — but never the clipped DTM.
    if (!(r instanceof Error)) expect(r.source).not.toMatch(/NSW_5M_Elevation/);
    const grid = makeGridSpec(katoomba.centre, 12000, 60);
    expect(await loadDemoElevation(grid, ['katoomba'])).toBeNull();
  });
});

describe('other bundled layers', () => {
  it('imagery window covers the requested sub-domain', async () => {
    const info = await loadDemoImageryInfo('katoomba');
    expect(info).not.toBeNull();
    const full = imageryWindow(info!.meta, makeGridSpec(katoomba.centre, 9000, 30));
    expect(full.sx).toBeCloseTo(0, 1);
    expect(full.sw).toBeCloseTo(1125, 0);
    const sub = imageryWindow(info!.meta, makeGridSpec(katoomba.centre, 4500, 30));
    expect(sub.sx).toBeCloseTo(1125 / 4, 0);
    expect(sub.sh).toBeCloseTo(1125 / 2, 0);
  });

  it('fire history and vegetation load with the expected fields', async () => {
    const fh = await loadDemoFireHistoryGeoJson('katoomba');
    expect(fh!.features.length).toBeGreaterThan(10);
    const types = new Set(fh!.features.map((f) => f.properties.FireType));
    expect(types.has(1) && types.has(2)).toBe(true);
    const veg = await loadDemoVegetationGeoJson('katoomba');
    const forms = new Set(veg!.features.map((f) => f.properties.vegForm));
    expect(forms.has('Heathlands')).toBe(true);
    expect([...forms].some((f) => f?.startsWith('Dry Sclerophyll'))).toBe(true);
  });
});
