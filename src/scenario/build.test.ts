/**
 * The build pipeline `buildScenario` (spec §11.6, §0.2 grid identity, §15 V19): Katoomba offline (LiDAR terrain,
 * real SVTM fuel and NPWS history, preset and replay weather), the Gospers replay sanity check, a location outside
 * the demo sites offline (synthetic terrain with warnings), area packs, the online path on the fake network,
 * request resolution, progress and cancellation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ScenarioData, WeatherSeries } from '../core/types';
import { LocalProjection } from '../core/geo';
import { lmstHour } from '../core/physics';
import { FuelFlag } from '../core/types';
import { listAreaPacks, loadAreaPack, saveAreaPack, syntheticElevation, clearCache } from '../data';
import { makeGridSpec } from '../core/grid';
import { downloadAreaPack } from './areaPack';
import { buildScenario, resolveRequest, resolveOptions } from './build';
import { MESSAGES } from './messages';
import { WEATHER_PRESETS } from './presets';
import type { BuildProgress, ScenarioRequest } from './request';
import { elevationAtLocal, medianOf } from './terrain';
import { pressureIsa } from '../core/physics';
import { psychrometerRh } from './beltKit';
import { fixture, KATOOMBA_NOW, KATOOMBA_NOW_ROUTES, withFakeNetwork } from './testing';

const KAT = { lat: -33.715, lon: 150.285 };
let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});
const offlineNet = () => {
  const n = withFakeNetwork([]);
  restore = n.restore;
  return n;
};

function checkScenario(s: ScenarioData): void {
  const g = s.terrain.grid;
  const n = g.nx * g.ny;
  expect(s.fuel.grid).toBe(g); // §0.2 grid identity
  expect(g.cellSize).toBe(s.options.fireCellSize);
  expect(g.nx * g.cellSize).toBe(s.extent);
  for (const f of [s.terrain.elevation, s.terrain.slopeDeg, s.terrain.slopeP90Deg!, s.terrain.cliffFraction!, s.fuel.surfaceLoad, s.fuel.type]) expect(f.length).toBe(n);
  const hi = s.terrainHiRes!;
  expect(hi.grid.cellSize).toBe(10);
  expect(hi.grid.nx).toBe(g.nx * (g.cellSize / 10));
  expect(hi.elevation.length).toBe(hi.grid.nx * hi.grid.ny);
  expect(s.fuelHistory!.recStart.length).toBe(n + 1);
  expect(s.weather.hours.length).toBeGreaterThanOrEqual(2);
  expect(s.weather.hours[0]!.time).toBeLessThanOrEqual(s.startTime);
  expect(s.weather.hours[s.weather.hours.length - 1]!.time).toBeGreaterThanOrEqual(s.startTime + s.duration * 1000);
  expect(Number.isFinite(s.weather.kbdi!)).toBe(true);
  expect(s.weather.droughtFactor!).toBeGreaterThanOrEqual(0);
  expect(s.weather.droughtFactor!).toBeLessThanOrEqual(10);
  for (let k = 0; k < n; k += 97) {
    expect(Number.isFinite(s.terrain.elevation[k]!)).toBe(true);
    expect(s.terrain.cliffFraction![k]!).toBeGreaterThanOrEqual(0);
    expect(s.terrain.cliffFraction![k]!).toBeLessThanOrEqual(1);
  }
  // Structured-clone serialisable (worker init).
  expect(() => structuredClone(s)).not.toThrow();
}

describe('request resolution (§11.4, §11.6, §12.6)', () => {
  const base: ScenarioRequest = { centre: KAT, extent: 9000, weather: { kind: 'now' }, duration: 14400, online: true };
  it('extent clamped to 3–12 km and snapped to the fire cell; 30 m by default', () => {
    expect(resolveRequest({ ...base, extent: 20000 }).extent).toBe(12000);
    expect(resolveRequest({ ...base, extent: 1000 }).extent).toBe(3000);
    const r = resolveRequest({ ...base, extent: 7550 });
    expect(r.fireCellSize).toBe(30);
    expect(r.extent % 30).toBe(0);
  });
  it('20 m only when High detail is requested and the extent is ≤ 6 km', () => {
    expect(resolveRequest({ ...base, extent: 6000, options: { fireCellSize: 20 } }).fireCellSize).toBe(20);
    expect(resolveRequest({ ...base, extent: 6000, options: { tier: 'high' } }).fireCellSize).toBe(20);
    const big = resolveRequest({ ...base, extent: 9000, options: { fireCellSize: 20 } });
    expect(big.fireCellSize).toBe(30);
    expect(big.warnings).toContain(MESSAGES.cellCoarsened(30));
    expect(resolveRequest({ ...base, options: { fireCellSize: 40 } }).fireCellSize).toBe(30);
  });
  it('replays run at their demo site and clamp the extent to the bundled 9 km; offline demo runs too', () => {
    const r = resolveRequest({ ...base, centre: { lat: 0, lon: 0 }, extent: 12000, weather: { kind: 'replay', replayId: 'gospers-2019-12-19' } });
    expect(r.demoSiteId).toBe('gospers');
    expect(r.centre).toEqual({ lat: -32.98, lon: 150.6 });
    expect(r.extent).toBe(9000);
    expect(r.name).toBe('Gospers Mountain, Dec 2019');
    expect(resolveRequest({ ...base, extent: 12000, demoSiteId: 'katoomba', online: false }).extent).toBe(9000);
    expect(resolveRequest({ ...base, extent: 12000, demoSiteId: 'katoomba', online: true }).extent).toBe(12000);
    expect(() => resolveRequest({ ...base, weather: { kind: 'replay', replayId: 'x' } })).toThrow();
  });
  it('options: §12.6 atmosphere cell by tier, user values win', () => {
    const o = resolveOptions(base, 9000, 30);
    expect(o).toMatchObject({ fireCellSize: 30, atmosCellSize: 200, atmosLevels: 20, atmosDz1: 30, tier: 'auto', maxEmbers: 4000 });
    expect(resolveOptions({ ...base, options: { tier: 'high' } }, 6000, 20)).toMatchObject({ atmosCellSize: 100, atmosLevels: 24, atmosDz1: 25 });
    expect(resolveOptions({ ...base, options: { tier: 'fast', maxEmbers: 999 } }, 12000, 30)).toMatchObject({ atmosCellSize: 267, maxEmbers: 999 });
  });
});

describe('Katoomba offline (demo site): LiDAR terrain, real fuel and history, preset weather', () => {
  let s: ScenarioData;
  const progress: BuildProgress[] = [];
  it('builds without any network request', async () => {
    const n = offlineNet();
    const start = WEATHER_PRESETS['hot-nw-sw-change'].canonicalStart(KAT.lon, 2026);
    s = await buildScenario(
      { centre: KAT, extent: 9000, demoSiteId: 'katoomba', weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start }, duration: 4 * 3600, online: false },
      (p) => progress.push(p),
    );
    expect(n.calls).toHaveLength(0);
    checkScenario(s);
  });
  it('progress follows terrain → canopy → vegetation → fire history → weather → drought → fuel → places → done', () => {
    const steps = progress.map((p) => p.step).filter((x, i, a) => a.indexOf(x) === i);
    expect(steps).toEqual(['terrain', 'canopy', 'vegetation', 'fireHistory', 'weather', 'drought', 'fuel', 'places', 'done']);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!.fraction).toBeGreaterThanOrEqual(progress[i - 1]!.fraction);
    expect(progress[progress.length - 1]!.fraction).toBe(1);
  });
  it('terrain: bundled LiDAR, 30 m fire grid from 3×3 blocks, cliffs in slopeP90 / cliffFraction', () => {
    expect(s.terrain.source).toMatch(/LiDAR/);
    expect(s.terrain.source).toMatch(/3×3/);
    expect(s.terrain.grid.nx).toBe(300);
    expect(s.terrainHiRes!.grid.nx).toBe(900);
    // Block mean of the 10 m DEM.
    const hi = s.terrainHiRes!;
    const k = 150 * 300 + 150;
    let m = 0;
    for (let bj = 0; bj < 3; bj++) for (let bi = 0; bi < 3; bi++) m += hi.elevation[(450 + bj) * 900 + 450 + bi]!;
    expect(s.terrain.elevation[k]).toBeCloseTo(m / 9, 3);
    let cliffy = 0;
    let p90ge = 0;
    const n = 300 * 300;
    for (let i = 0; i < n; i++) {
      if (s.terrain.cliffFraction![i]! > 0) cliffy++;
      if (s.terrain.slopeP90Deg![i]! >= s.terrain.slopeDeg[i]! - 1) p90ge++;
    }
    expect(cliffy).toBeGreaterThan(200); // Katoomba's escarpments
    expect(p90ge / n).toBeGreaterThan(0.9);
    expect(s.terrain.maxElevation - s.terrain.minElevation).toBeGreaterThan(600);
  });
  it('fuel: SVTM vegetation, NPWS history, canopy; some recently burnt cells', () => {
    const src = s.fuel.sources.join(' | ');
    expect(src).toMatch(/SVTM/);
    expect(src).toMatch(/NPWS/);
    expect(src).toMatch(/[Cc]anopy/);
    let burnt = 0;
    let forest = 0;
    for (let k = 0; k < s.fuel.type.length; k++) {
      if (s.fuel.timeSinceFire[k]! < 10) burnt++;
      if (s.fuel.type[k] === 4) forest++;
    }
    expect(burnt).toBeGreaterThan(1000);
    expect(forest / s.fuel.type.length).toBeGreaterThan(0.3);
  });
  it('weather: the preset at the domain median elevation, its drought', () => {
    expect(s.weather.kind).toBe('preset');
    expect(s.weather.sourceElevation).toBeCloseTo(medianOf(s.terrain.elevation), 6);
    expect(s.weather.upperAirSource).toBe('preset');
    expect([s.weather.droughtFactor, s.weather.kbdi]).toEqual([9, 120]);
    expect(s.weather.annualRainfall).toBe(1400);
    expect(lmstHour(s.startTime, KAT.lon)).toBeCloseTo(11, 3);
    expect(s.options).toMatchObject({ fireCellSize: 30, tier: 'auto' });
    expect(s.name).toMatch(/Katoomba/);
  });
});

describe('replays offline', () => {
  it('katoomba-2013-10-16: ERA5 weather, 10:00 LMST start, KBDI 74.9 ± 3', async () => {
    offlineNet();
    const s = await buildScenario({ centre: KAT, extent: 9000, weather: { kind: 'replay', replayId: 'katoomba-2013-10-16' }, duration: 6 * 3600, online: false });
    checkScenario(s);
    expect(s.weather.kind).toBe('historical');
    expect(s.weather.source).toMatch(/ERA5/);
    expect(lmstHour(s.startTime, s.weather.location.lon)).toBeCloseTo(10, 1);
    expect(Math.abs(s.weather.kbdi! - 74.9)).toBeLessThanOrEqual(3);
    expect(s.weather.daily).toHaveLength(365);
    expect(s.weather.warnings).toContain(MESSAGES.syntheticUpperAir);
  });

  it('V19 gospers-2019-12-19: Gospers Mountain active (not a fuel reset), KBDI 125 ± 3, DF 10, synthetic upper-air warning', async () => {
    offlineNet();
    const warnings: string[][] = [];
    const s = await buildScenario({ centre: KAT, extent: 9000, weather: { kind: 'replay', replayId: 'gospers-2019-12-19' }, duration: 4 * 3600, online: false }, (p) => warnings.push(p.warnings));
    checkScenario(s);
    expect(Math.abs(s.weather.kbdi! - 125)).toBeLessThanOrEqual(3);
    expect(s.weather.droughtFactor).toBeCloseTo(10, 1);
    const all = warnings[warnings.length - 1]!.join(' | ');
    expect(all).toContain(MESSAGES.syntheticUpperAir);
    expect(all).toMatch(/Gospers Mountain/);
    const gm = s.activeFires!.find((r) => r.name === 'Gospers Mountain')!;
    expect(gm).toBeDefined();
    // Cells inside the active perimeter keep pre-fire fuel: no 2019-20 reset (time since fire ≫ 0 or no record).
    const proj = new LocalProjection(s.origin);
    const ring = gm.rings[0]!.map(([lon, lat]) => proj.toLocal({ lat, lon }));
    const inside = (x: number, y: number): boolean => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const g = s.terrain.grid;
    let tested = 0;
    for (let j = 0; j < g.ny; j += 7) {
      for (let i = 0; i < g.nx; i += 7) {
        if (!inside(g.x0 + i * g.cellSize, g.y0 + j * g.cellSize)) continue;
        const tsf = s.fuel.timeSinceFire[j * g.nx + i]!;
        expect(Number.isNaN(tsf) || tsf > 0.2).toBe(true);
        tested++;
      }
    }
    expect(tested).toBeGreaterThan(10);
  });
});

describe('outside the demo sites, offline', () => {
  it('falls back to synthetic terrain, inferred vegetation, steady-state fuel and a preset, with warnings', async () => {
    offlineNet();
    const progress: BuildProgress[] = [];
    const s = await buildScenario({ centre: { lat: -35.6, lon: 149.3 }, extent: 6000, weather: { kind: 'now' }, duration: 3 * 3600, online: false, now: KATOOMBA_NOW }, (p) => progress.push(p));
    checkScenario(s);
    const w = progress[progress.length - 1]!.warnings;
    expect(w).toContain(MESSAGES.syntheticTerrain);
    expect(w).toContain(MESSAGES.vegetationInferred);
    expect(w).toContain(MESSAGES.fireHistoryUnavailable);
    expect(w).toContain(MESSAGES.canopyUnavailable);
    expect(w.some((x) => x.includes('choose a preset, manual entry or a replay'))).toBe(true);
    expect(s.terrain.source).toMatch(/Synthetic/);
    expect(s.weather.kind).toBe('preset');
    expect(s.startTime).toBe(KATOOMBA_NOW);
    let inferred = 0;
    for (let k = 0; k < s.fuel.flags!.length; k++) if (s.fuel.flags![k]! & FuelFlag.InferredVegetation) inferred++;
    expect(inferred / s.fuel.flags!.length).toBeGreaterThan(0.9);
    expect(s.fuel.timeSinceFire.every((v) => Number.isNaN(v))).toBe(true);
    expect(s.extent).toBe(6000);
  });

  it('manual weather: the readings drive the run, KBDI from DF, site elevation from the terrain', async () => {
    offlineNet();
    const series: WeatherSeries = {
      kind: 'belt-kit',
      source: 'Belt weather kit reading',
      location: { lat: -35.6, lon: 149.3 },
      timezone: 'Australia/Sydney',
      hours: [0, 1].map((i) => ({ time: KATOOMBA_NOW + i * 3.6e6, temperature: 31, relativeHumidity: 18, windSpeed10: 7, windDir10: 300 })),
      droughtFactor: 8,
    };
    const s = await buildScenario({ centre: { lat: -35.6, lon: 149.3 }, extent: 3000, weather: { kind: 'manual', series, start: KATOOMBA_NOW }, duration: 2 * 3600, online: false });
    checkScenario(s);
    expect(s.weather.kind).toBe('belt-kit');
    expect(s.startTime).toBe(KATOOMBA_NOW);
    expect(s.weather.droughtFactor).toBe(8);
    expect(s.weather.kbdi!).toBeGreaterThan(40);
    expect(s.weather.sourceElevation!).toBeGreaterThan(0);
  });
});

describe('area packs (offline field use)', () => {
  it('a stored pack supplies terrain, weather and the daily history offline', async () => {
    const n = offlineNet();
    const centre = { lat: -35.2, lon: 148.8 };
    const g10 = makeGridSpec(centre, 7000, 10);
    const fc = fixture<{ latitude: number; longitude: number }>('openmeteo-forecast-katoomba.json');
    const archive = fixture('openmeteo-archive-katoomba-365d.json');
    const { parseOpenMeteoDaily } = await import('./openMeteo');
    await saveAreaPack(
      {
        id: 'test-pack',
        name: 'Test pack',
        centre,
        extent: 7000,
        createdAt: KATOOMBA_NOW - 3.6e6,
        items: {
          dem10: { grid: g10, elevation: syntheticElevation(g10, 'ridges', 3), source: 'Test DEM' },
          weather: { ...fc, latitude: centre.lat, longitude: centre.lon },
          daily: { daily: parseOpenMeteoDaily(archive), annualRainfall: 900, fetchedAt: KATOOMBA_NOW },
        },
      },
      n.kv,
    );
    const progress: BuildProgress[] = [];
    const s = await buildScenario({ centre, extent: 6000, weather: { kind: 'now' }, duration: 4 * 3600, online: false, now: KATOOMBA_NOW }, (p) => progress.push(p));
    checkScenario(s);
    expect(s.terrain.source).toMatch(/area pack 'Test pack'/);
    expect(s.weather.kind).toBe('forecast');
    expect(s.weather.upperAirSource).toBe('model');
    expect(s.weather.annualRainfall).toBe(900);
    expect(s.weather.daily!.length).toBeGreaterThan(300);
    const w = progress[progress.length - 1]!.warnings;
    expect(w.some((x) => x.startsWith('Offline: using weather stored'))).toBe(true);
    expect(w).not.toContain(MESSAGES.syntheticTerrain);
  });

  it('downloadAreaPack stores DEM, canopy, vegetation, fire history, forecast and daily history', async () => {
    const n = withFakeNetwork(KATOOMBA_NOW_ROUTES());
    restore = n.restore;
    const r = await downloadAreaPack({ name: 'Katoomba field pack', centre: KAT, extent: 3000, demoSiteId: 'katoomba', now: KATOOMBA_NOW, kv: n.kv });
    expect(r.meta.itemNames).toEqual(expect.arrayContaining(['dem10', 'canopy', 'vegetation', 'fireHistory', 'weather', 'daily']));
    expect((await listAreaPacks(n.kv)).map((p) => p.id)).toEqual(['katoomba-field-pack']);
    const pack = (await loadAreaPack('katoomba-field-pack', n.kv))!;
    const dem = pack.items['dem10'] as { grid: { nx: number }; elevation: Float32Array; source: string };
    expect(dem.grid.nx).toBe(300);
    expect(dem.source).toMatch(/LiDAR/);
    expect((pack.items['daily'] as { daily: unknown[] }).daily.length).toBe(365);
    // Offline "now" build from the pack alone (response cache cleared).
    await clearCache('openmeteo/', n.kv);
    restore();
    const off = withFakeNetwork([]);
    restore = off.restore;
    const { setDefaultCache } = await import('../data');
    setDefaultCache(n.kv);
    const s = await buildScenario({ centre: KAT, extent: 3000, demoSiteId: 'katoomba', weather: { kind: 'now' }, duration: 3 * 3600, online: false, now: KATOOMBA_NOW + 3.6e6 });
    expect(s.weather.kind).toBe('forecast');
    expect(Math.abs(s.weather.kbdi! - 64.6)).toBeLessThanOrEqual(3);
    expect(off.calls).toHaveLength(0);
  });
});

describe('online (fake network)', () => {
  it('Katoomba now: best_match forecast with pressure levels, KBDI 64.6 from archive + gap-fill', async () => {
    const n = withFakeNetwork(KATOOMBA_NOW_ROUTES());
    restore = n.restore;
    const s = await buildScenario({ centre: KAT, extent: 6000, demoSiteId: 'katoomba', weather: { kind: 'now' }, duration: 4 * 3600, online: true, now: KATOOMBA_NOW, options: { fireCellSize: 20 } });
    checkScenario(s);
    expect(s.options.fireCellSize).toBe(20);
    expect(s.terrain.grid.nx).toBe(300);
    expect(s.terrain.source).toMatch(/2×2/);
    expect(s.weather.upperAirSource).toBe('model');
    expect(s.weather.sourceElevation).toBe(715);
    expect(Math.abs(s.weather.kbdi! - 64.6)).toBeLessThanOrEqual(3);
    expect(Math.abs(s.weather.droughtFactor! - 8.47)).toBeLessThanOrEqual(0.3);
    // Demo layers are bundled: only weather went to the network.
    expect(n.calls.every((u) => u.includes('open-meteo.com'))).toBe(true);
  });
  it('belt-kit readings in a forecast run become a WindEdit', async () => {
    const n = withFakeNetwork(KATOOMBA_NOW_ROUTES());
    restore = n.restore;
    const s = await buildScenario({
      centre: KAT,
      extent: 3000,
      demoSiteId: 'katoomba',
      weather: { kind: 'now' },
      duration: 2 * 3600,
      online: true,
      now: KATOOMBA_NOW,
      beltKit: [{ dryBulb: 30, wetBulb: 18, windKmh: 20, windDir: 280, time: KATOOMBA_NOW }],
    });
    expect(s.edits).toHaveLength(1);
    expect(s.edits[0]).toMatchObject({ kind: 'wind', radius: 1000, dir: 280, time: 0 });
  });
});

describe('cancellation', () => {
  it('rejects with an AbortError when the signal is aborted', async () => {
    offlineNet();
    const ac = new AbortController();
    ac.abort();
    await expect(buildScenario({ centre: KAT, extent: 3000, demoSiteId: 'katoomba', weather: { kind: 'preset', presetId: 'mild-spring-hr', start: KATOOMBA_NOW }, duration: 3600, online: false }, () => {}, ac.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('aborting during the build stops it', async () => {
    offlineNet();
    const ac = new AbortController();
    const p = buildScenario(
      { centre: KAT, extent: 9000, demoSiteId: 'katoomba', weather: { kind: 'preset', presetId: 'mild-spring-hr', start: KATOOMBA_NOW }, duration: 3600, online: false },
      (pr) => {
        if (pr.step === 'vegetation') ac.abort();
      },
      ac.signal,
    );
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('review additions', () => {
  // §11.4: the fires burning at each replay date (shown as outlines, excluded from the fuel reset by the §4.4 rule).
  const ACTIVE: Record<string, string> = {
    'grose-2019-12-19': 'Gospers Mountain',
    'gospers-2019-12-19': 'Gospers Mountain',
    'kanangra-2019-12-17': 'Green Wattle Creek',
    'budawangs-2019-12-30': 'Currowan',
    'thredbo-2020-01-02': 'Pilot Lookout',
    'warrumbungles-2013-01-12': 'Wambelong',
  };
  it.each(Object.entries(ACTIVE))('%s: %s is active at t0; synthetic upper air; replay drought on the series', async (id, fire) => {
    offlineNet();
    const s = await buildScenario({ centre: KAT, extent: 9000, weather: { kind: 'replay', replayId: id }, duration: 4 * 3600, online: false });
    expect(s.activeFires!.some((f) => (f.name ?? '').includes(fire))).toBe(true);
    expect(s.weather.upperAirSource).toBe('synthetic');
    expect(s.weather.warnings).toContain(MESSAGES.syntheticUpperAir);
    expect(s.weather.daily).toHaveLength(365);
    expect(s.weather.rainLast20).toHaveLength(20);
    expect(lmstHour(s.startTime, s.weather.location.lon)).toBeCloseTo(10, 1);
  });

  it('every build warning (terrain, layers, weather) travels on ScenarioData.weather.warnings', async () => {
    offlineNet();
    const progress: BuildProgress[] = [];
    const s = await buildScenario({ centre: { lat: -35.6, lon: 149.3 }, extent: 3000, weather: { kind: 'preset', presetId: 'mild-spring-hr', start: KATOOMBA_NOW }, duration: 3600, online: false }, (p) => progress.push(p));
    const last = progress[progress.length - 1]!;
    expect(last.step).toBe('done');
    for (const w of last.warnings) expect(s.weather.warnings).toContain(w);
    expect(s.weather.warnings).toContain(MESSAGES.syntheticTerrain);
    expect(s.weather.warnings).toContain(MESSAGES.vegetationInferred);
  });

  it('an impossible belt-kit reading (wet bulb > dry bulb) is skipped with a warning, the build succeeds', async () => {
    const n = withFakeNetwork(KATOOMBA_NOW_ROUTES());
    restore = n.restore;
    const s = await buildScenario({
      centre: KAT,
      extent: 3000,
      demoSiteId: 'katoomba',
      weather: { kind: 'now' },
      duration: 2 * 3600,
      online: true,
      now: KATOOMBA_NOW,
      beltKit: [
        { dryBulb: 20, wetBulb: 24, windKmh: 20, windDir: 280, time: KATOOMBA_NOW },
        { dryBulb: 30, wetBulb: 18, windKmh: 20, windDir: 280, time: KATOOMBA_NOW },
      ],
    });
    expect(s.edits).toHaveLength(1);
    expect(s.weather.warnings!.some((w) => w.startsWith('Belt-kit reading ignored'))).toBe(true);
  });

  it('belt-kit readings with a manual run: the kit converts RH and wind (D38, D39) and the run uses them', async () => {
    offlineNet();
    const series: WeatherSeries = { kind: 'manual', source: 'UI', location: KAT, timezone: 'Australia/Sydney', hours: [], droughtFactor: 9 };
    const s = await buildScenario({
      centre: KAT,
      extent: 3000,
      demoSiteId: 'katoomba',
      weather: { kind: 'manual', series },
      duration: 2 * 3600,
      online: false,
      beltKit: [{ dryBulb: 33, wetBulb: 19, windKmh: 30, windDir: 300, time: KATOOMBA_NOW }],
    });
    checkScenario(s);
    expect(s.startTime).toBe(KATOOMBA_NOW);
    expect(s.weather.kind).toBe('belt-kit');
    const h = s.weather.hours.find((x) => x.time === KATOOMBA_NOW)!;
    expect(h.windSpeed10).toBeCloseTo((30 / 3.6) * 1.25, 9);
    // Station pressure = ISA at the domain-centre elevation (the reading's site), not sea level.
    const zc = elevationAtLocal(s.terrain, 0, 0);
    expect(s.weather.sourceElevation!).toBeCloseTo(zc, 6);
    expect(h.relativeHumidity).toBeCloseTo(psychrometerRh(33, 19, pressureIsa(zc)), 9);
    expect(h.relativeHumidity).toBeGreaterThan(psychrometerRh(33, 19, 1013.25));
    expect(s.weather.droughtFactor).toBe(9);
  });
});

describe('area pack refresh', () => {
  it('re-downloading a pack while a layer service is down keeps that layer from the old pack', async () => {
    const n = offlineNet();
    const centre = { lat: -35.2, lon: 148.8 };
    const veg = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { vegForm: 'Dry sclerophyll forests (shrubby sub-formation)', vegClass: 'Southern Tableland Dry Sclerophyll Forests' }, geometry: { type: 'Polygon', coordinates: [[[148.79, -35.21], [148.81, -35.21], [148.81, -35.19], [148.79, -35.21]]] } }] };
    await saveAreaPack({ id: 'refresh-pack', name: 'Refresh pack', centre, extent: 5000, createdAt: KATOOMBA_NOW - 86.4e6, items: { vegetation: veg, fireHistory: { type: 'FeatureCollection', features: [] } } }, n.kv);
    const r = await downloadAreaPack({ id: 'refresh-pack', name: 'Refresh pack', centre, extent: 5000, weather: false, now: KATOOMBA_NOW, kv: n.kv });
    expect(r.meta.itemNames).toEqual(expect.arrayContaining(['vegetation', 'fireHistory']));
    const pack = (await loadAreaPack('refresh-pack', n.kv))!;
    expect((pack.items['vegetation'] as typeof veg).features).toHaveLength(1);
  });
});
