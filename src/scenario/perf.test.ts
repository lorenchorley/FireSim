/**
 * Performance of the scenario builder. The spec's §13 budgets are for the simulation; the build is a one-off before
 * it. Gates (x86 Node CI, generous for shared runners): Katoomba 9 km offline build ≤ 5 s (target on a phone
 * 2–3× slower: ≤ 15 s), 10 m → 30 m terrain ≤ 400 ms, parsing a 336-hour forecast ≤ 100 ms, weatherAt ≤ 10 µs/call.
 */
import { describe, expect, it } from 'vitest';
import { setDefaultCache, createMemoryKV } from '../data';
import { makeGridSpec } from '../core/grid';
import { syntheticElevation } from '../data';
import { buildScenario } from './build';
import { parseOpenMeteoHourly } from './openMeteo';
import { WEATHER_PRESETS } from './presets';
import { fireTerrainFromHiRes } from './terrain';
import { fixture } from './testing';
import { weatherAt } from './weather';

const KAT = { lat: -33.715, lon: 150.285 };

describe('build performance', () => {
  it('Katoomba 9 km offline (LiDAR, SVTM, NPWS, canopy, preset) ≤ 5 s', async () => {
    setDefaultCache(createMemoryKV());
    const start = WEATHER_PRESETS['catastrophic-black-summer'].canonicalStart(KAT.lon, 2026);
    const req = { centre: KAT, extent: 9000, demoSiteId: 'katoomba', weather: { kind: 'preset' as const, presetId: 'catastrophic-black-summer', start }, duration: 6 * 3600, online: false };
    await buildScenario(req); // warm-up (module JIT, asset cache)
    const t = performance.now();
    await buildScenario(req);
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(5000);
    setDefaultCache(null);
  });
  it('10 m → 30 m terrain (900² → 300²) ≤ 400 ms', () => {
    const g = makeGridSpec(KAT, 9000, 10);
    const z = syntheticElevation(g, 'escarpment', 1);
    fireTerrainFromHiRes({ grid: g, elevation: z, source: 's' }, 30);
    const t = performance.now();
    fireTerrainFromHiRes({ grid: g, elevation: z, source: 's' }, 30);
    expect(performance.now() - t).toBeLessThan(400);
  });
  it('parse the 336-hour forecast ≤ 100 ms; weatherAt ≤ 10 µs per call', () => {
    const json = fixture('openmeteo-forecast-katoomba.json');
    parseOpenMeteoHourly(json);
    let t = performance.now();
    const s = parseOpenMeteoHourly(json).series;
    expect(performance.now() - t).toBeLessThan(100);
    const t0 = s.hours[0]!.time;
    const span = s.hours[s.hours.length - 1]!.time - t0;
    const N = 100_000;
    let acc = 0;
    t = performance.now();
    for (let i = 0; i < N; i++) acc += weatherAt(s, t0 + (span * i) / N).windSpeed10;
    const us = ((performance.now() - t) * 1000) / N;
    expect(acc).toBeGreaterThan(0);
    expect(us).toBeLessThan(10); // ≈ 2 µs measured (x86 Node), incl. 4 levels + profile
  });
});
