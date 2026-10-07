/**
 * ONE real check against the live NSW services, for a place that is not a demo site: Bilpin village (-33.498, 150.522), a
 * semi-rural village in the Blue Mountains foothills. Skipped unless NET=1 (and, behind a proxy, NODE_USE_ENV_PROXY=1):
 *
 *   NET=1 NODE_USE_ENV_PROXY=1 npx vitest run src/scenario/context.live.test.ts
 *
 * Prints the counts and the duration; asserts only what any successful query must satisfy.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryKV, resetHttpConfig } from '../data';
import { fetchNswContextFile, contextQueryBBox } from '../data/nswContext';
import { loadContext } from './context';

/** Bilpin village. (-33.52 150.42, where this test first ran, is inside the bundled Mount Tomah demo site, so it would be read from the bundle.) */
const BILPIN = { lat: -33.498, lon: 150.522 };

describe.skipIf(!process.env.NET)('live NSW services (NET=1)', () => {
  it('Bilpin, 6 km domain: roads, homes, zones and names, then the cached repeat', { timeout: 300_000 }, async () => {
    resetHttpConfig();
    const kv = createMemoryKV();
    const progress: string[] = [];
    let last = 0;
    const t0 = Date.now();
    const r = await loadContext({
      centre: BILPIN,
      extent: 6000,
      online: true,
      kv,
      onProgress: (f, m) => {
        last = f;
        progress.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${(f * 100).toFixed(0)}% ${m.replace('Roads, homes and place names: ', '')}`);
      },
    });
    const secs = (Date.now() - t0) / 1000;
    expect(r.origin).toBe('live');
    const c = r.context!;
    const zoneKinds = [...new Set(c.zones.map((z) => z.kind))].sort();
    const roadKm = Math.round(c.roads.reduce((a, x) => a + x.lengthM, 0) / 1000);
    console.log(
      `Bilpin live: ${c.roads.length} road lines (${roadKm} km), ${c.fireTrails.length} fire trails, ${c.homes.length / 2} homes, ${c.zones.length} zone polygons [${zoneKinds.join(', ')}], ` +
        `${c.places.length} names [${c.places.map((p) => p.name).join(', ')}]; ${secs.toFixed(1)} s; bbox ${r.file!.bbox.join(',')}; warnings ${JSON.stringify(r.warnings)}`,
    );
    console.log(progress.join('\n'));
    expect(last).toBe(1);
    expect(c.roads.length).toBeGreaterThan(50);
    expect(c.homes.length / 2).toBeGreaterThan(50);
    expect(r.warnings).toEqual([]);
    // The same place again is answered by the cache.
    const t1 = Date.now();
    const again = await loadContext({ centre: BILPIN, extent: 6000, online: false, kv });
    expect(again.origin).toBe('cache');
    expect(again.context!.roads.length).toBe(c.roads.length);
    console.log(`Bilpin from cache: ${Date.now() - t1} ms`);
    // The raw query reports which layers it could read.
    const f = await fetchNswContextFile(contextQueryBBox(BILPIN, 3000));
    expect(f.failed).toEqual([]);
  });
});
