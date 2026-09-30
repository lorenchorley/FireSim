/** public/demo/provenance.json must describe the files that are really there (run `npm run provenance` after changing them). */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bundleFile, clearBundleManifestCache, loadBundleManifest } from './bundleManifest';
import { DEMO_SITES } from './demoSites';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));

describe('bundled-data manifest', () => {
  it('loads and lists every demo site and replay file with its real byte length', async () => {
    clearBundleManifestCache();
    const m = await loadBundleManifest();
    expect(m).not.toBeNull();
    for (const s of DEMO_SITES) {
      const site = m!.sites[s.id];
      expect(site, s.id).toBeDefined();
      for (const [name, f] of Object.entries(site!.files)) {
        if (name === 'terrarium') {
          let n = 0;
          let bytes = 0;
          const walk = (d: string): void => {
            for (const e of readdirSync(d, { withFileTypes: true })) {
              if (e.isDirectory()) walk(`${d}/${e.name}`);
              else if (e.name.endsWith('.png')) {
                n++;
                bytes += statSync(`${d}/${e.name}`).size;
              }
            }
          };
          walk(`${PUBLIC}demo/${s.id}/terrarium`);
          expect({ bytes: f.bytes, count: f.count }, `${s.id}/terrarium`).toEqual({ bytes, count: n });
        } else expect(f.bytes, `${s.id}/${name}`).toBe(statSync(`${PUBLIC}demo/${s.id}/${name}`).size);
      }
      expect(site!.totalBytes).toBe(Object.values(site!.files).reduce((a, f) => a + f.bytes, 0));
      // Every file except the manifest itself is listed.
      for (const name of readdirSync(`${PUBLIC}demo/${s.id}`)) if (name !== 'terrarium') expect(site!.files[name], `${s.id}/${name} missing from provenance.json (npm run provenance)`).toBeDefined();
    }
    for (const name of readdirSync(`${PUBLIC}replays`)) expect(m!.replays.files[name]?.bytes).toBe(statSync(`${PUBLIC}replays/${name}`).size);
    expect(m!.totalBytes).toBe(Object.values(m!.sites).reduce((a, s) => a + s.totalBytes, 0) + m!.replays.totalBytes);
  });

  it('carries capture dates and counts that match the data files', async () => {
    const m = (await loadBundleManifest())!;
    expect(bundleFile(m, 'katoomba', 'dem5m.png')?.capturedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bundleFile(m, 'katoomba', 'context.json')).toMatchObject({ roads: 2171, homes: 7368 });
    const veg = JSON.parse(readFileSync(`${PUBLIC}demo/katoomba/vegetation.geojson`, 'utf8')) as { features: unknown[] };
    expect(bundleFile(m, 'katoomba', 'vegetation.geojson')?.features).toBe(veg.features.length);
    const dem = JSON.parse(readFileSync(`${PUBLIC}demo/katoomba/dem5m.json`, 'utf8')) as { capturedOn?: string; source: string };
    expect(dem.capturedOn).toBe(bundleFile(m, 'katoomba', 'dem5m.png')?.capturedOn);
    // The service does not call its elevation model LiDAR (service description read 2026-09-29): neither may the bundle.
    expect(dem.source).not.toMatch(/lidar/i);
    expect(existsSync(`${PUBLIC}demo/provenance.json`)).toBe(true);
  });

  it('a missing manifest is null, not an error', async () => {
    const { setAssetLoader } = await import('./assets');
    setAssetLoader(async () => null);
    clearBundleManifestCache();
    expect(await loadBundleManifest()).toBeNull();
    setAssetLoader(null);
    clearBundleManifestCache();
    expect(await loadBundleManifest()).not.toBeNull();
  });
});
