/**
 * Mock scenario builder for UI development and tests (`?mock=1`, or when src/scenario is unavailable).
 *
 * Terrain is REAL (bundled NSW 5 m LiDAR DTM for the demo sites via src/data loadElevation, then src/terrain
 * buildTerrain) and canopy height comes from the bundled Meta/WRI raster when available. Fuel and weather are
 * fabricated but plausible: fuel types follow landform, canopy and elevation; weather follows the chosen mode.
 */
import { FireHistoryKind, FuelType, Landform, DEFAULT_SIM_OPTIONS, type FuelMap, type ScenarioData, type Terrain, type WeatherHour, type WeatherSeries } from '../core/types';
import { makeGridSpec } from '../core/grid';
import { Rng } from '../core/rng';
import { kmhToMs } from '../core/units';
import { loadCanopy, loadElevation, syntheticElevation, syntheticSource, DEMO_SITES } from '../data';
import { buildTerrain } from '../terrain';
import type { BuildProgress, ScenarioRequest } from '../scenario/request';
import { dewPoint } from './weatherCalc';
import { DEFAULT_TZ, tzOffsetHours, zonedTime } from './format';
import { REPLAYS, WEATHER_PRESETS } from './content';

export type BuildScenarioFn = (req: ScenarioRequest, onProgress: (p: BuildProgress) => void, signal?: AbortSignal) => Promise<ScenarioData>;

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true },
    );
  });

function abortError(): Error {
  const e = new Error('Build cancelled');
  e.name = 'AbortError';
  return e;
}

interface WeatherShape {
  tMax: number;
  rhMin: number;
  windKmh: number;
  dir: number;
  change?: { afterHours: number; dir: number; windKmh: number; tDrop: number; rhRise: number };
  droughtFactor: number;
  night?: boolean;
}

/** Diurnal synthetic weather: T peaks ~15:00, RH mirrors it, optional wind change. */
function synthSeries(start: number, hours: number, shape: WeatherShape, source: string, location: { lat: number; lon: number }, kind: WeatherSeries['kind']): WeatherSeries {
  const H = 3600_000;
  const t0 = Math.floor(start / H) * H - H;
  const out: WeatherHour[] = [];
  for (let t = t0; t <= start + (hours + 2) * H; t += H) {
    const lh = (((t / H + tzOffsetHours(t)) % 24) + 24) % 24;
    const diurnal = Math.cos(((lh - 15) / 24) * 2 * Math.PI); // 1 at 15:00, −1 at 03:00
    let temperature = shape.tMax - 9 * (1 - diurnal) * 0.5 - (shape.night ? 4 : 0);
    let rh = shape.rhMin + (shape.night ? 45 : 32) * (1 - diurnal) * 0.5;
    let kmh = shape.windKmh * (0.75 + 0.25 * diurnal) * (shape.night ? 0.6 : 1);
    let dir = shape.dir + 10 * Math.sin(t / (5 * H));
    const ch = shape.change;
    if (ch && t >= start + ch.afterHours * H) {
      dir = ch.dir;
      kmh = ch.windKmh;
      temperature -= ch.tDrop;
      rh += ch.rhRise;
    }
    rh = Math.min(98, Math.max(3, rh));
    out.push({
      time: t,
      temperature,
      relativeHumidity: rh,
      dewPoint: dewPoint(temperature, rh),
      windSpeed10: kmhToMs(kmh),
      windDir10: ((dir % 360) + 360) % 360,
      windGust10: kmhToMs(kmh * 1.5),
      cloudCover: shape.night ? 5 : 15,
    });
  }
  return { kind, source, location: { ...location }, timezone: DEFAULT_TZ, hours: out, droughtFactor: shape.droughtFactor, kbdi: shape.droughtFactor * 15 };
}

const PRESET_SHAPES: Record<string, WeatherShape> = {
  'hot-nw-sw-change': { tMax: 37, rhMin: 11, windKmh: 40, dir: 315, change: { afterHours: 4, dir: 230, windKmh: 42, tDrop: 9, rhRise: 28 }, droughtFactor: 9 },
  'calm-night-katabatic': { tMax: 22, rhMin: 35, windKmh: 6, dir: 140, droughtFactor: 6, night: true },
  'mild-spring-hr': { tMax: 21, rhMin: 42, windKmh: 11, dir: 135, droughtFactor: 5 },
  'catastrophic-black-summer': { tMax: 42, rhMin: 6, windKmh: 55, dir: 300, change: { afterHours: 6, dir: 215, windKmh: 55, tDrop: 12, rhRise: 30 }, droughtFactor: 10 },
};

/** Weather for a request (mock). Returns the series and the scenario start time. */
export function mockWeather(req: ScenarioRequest): { series: WeatherSeries; start: number } {
  const hours = Math.ceil(req.duration / 3600);
  const w = req.weather;
  const now = Math.floor(Date.now() / 600_000) * 600_000;
  switch (w.kind) {
    case 'manual':
      return { series: w.series, start: w.series.hours.find((h) => h.time >= w.series.hours[0]!.time + 3600_000)?.time ?? w.series.hours[0]!.time };
    case 'preset': {
      const shape = PRESET_SHAPES[w.presetId] ?? PRESET_SHAPES['hot-nw-sw-change']!;
      const name = WEATHER_PRESETS.find((p) => p.id === w.presetId)?.name ?? w.presetId;
      return { series: synthSeries(w.start, hours, shape, `Preset: ${name}`, req.centre, 'preset'), start: w.start };
    }
    case 'replay': {
      const r = REPLAYS.find((x) => x.id === w.replayId);
      const date = r?.date ?? '2019-12-19';
      const start = zonedTime(date, 10);
      return { series: synthSeries(start, hours, PRESET_SHAPES['catastrophic-black-summer']!, `Replay (mock): ${r?.name ?? w.replayId}`, req.centre, 'historical'), start };
    }
    case 'past':
    case 'forecast': {
      const shape: WeatherShape = { tMax: 32, rhMin: 18, windKmh: 28, dir: 320, change: { afterHours: 5, dir: 225, windKmh: 35, tDrop: 7, rhRise: 25 }, droughtFactor: 8 };
      return { series: synthSeries(w.start, hours, shape, `Mock ${w.kind === 'past' ? 'historical' : 'forecast'} weather`, req.centre, w.kind === 'past' ? 'historical' : 'forecast'), start: w.start };
    }
    default: {
      const shape: WeatherShape = { tMax: 32, rhMin: 18, windKmh: 28, dir: 320, change: { afterHours: 4, dir: 225, windKmh: 35, tDrop: 7, rhRise: 25 }, droughtFactor: 8 };
      return { series: synthSeries(now, hours, shape, 'Mock live weather + forecast', req.centre, 'forecast'), start: now };
    }
  }
}

interface FuelDefaults {
  s: number;
  ns: number;
  nsh: number;
  el: number;
  elh: number;
  bark: number;
  loads: [number, number, number, number];
  canopy: number;
  cover: number;
}

const FUEL_DEFAULTS: Partial<Record<FuelType, FuelDefaults>> = {
  [FuelType.DryForestShrubby]: { s: 3, ns: 2.5, nsh: 0.3, el: 3, elh: 2, bark: 3, loads: [12, 4, 5, 2], canopy: 22, cover: 0.55 },
  [FuelType.DryForestGrassy]: { s: 2.5, ns: 3, nsh: 0.4, el: 1.5, elh: 1.2, bark: 2, loads: [9, 5, 2, 1.5], canopy: 20, cover: 0.45 },
  [FuelType.WetForest]: { s: 3.5, ns: 2, nsh: 0.4, el: 2, elh: 3, bark: 2, loads: [16, 3, 3, 2], canopy: 35, cover: 0.75 },
  [FuelType.Rainforest]: { s: 1.5, ns: 1, nsh: 0.3, el: 1, elh: 2, bark: 0.5, loads: [6, 1, 1, 0.3], canopy: 30, cover: 0.9 },
  [FuelType.Heath]: { s: 2, ns: 3, nsh: 0.6, el: 3.5, elh: 1.6, bark: 0, loads: [6, 6, 8, 0], canopy: 3, cover: 0.1 },
  [FuelType.Grassland]: { s: 0.5, ns: 3, nsh: 0.4, el: 0, elh: 0, bark: 0, loads: [1, 4.5, 0, 0], canopy: 0, cover: 0 },
  [FuelType.GrassyWoodland]: { s: 1.5, ns: 3, nsh: 0.4, el: 1, elh: 1, bark: 1.5, loads: [5, 4, 1, 1], canopy: 15, cover: 0.25 },
  [FuelType.AlpineHeathGrass]: { s: 1, ns: 3, nsh: 0.4, el: 2, elh: 0.8, bark: 0, loads: [3, 5, 3, 0], canopy: 1, cover: 0.05 },
  [FuelType.SnowGumWoodland]: { s: 2, ns: 2.5, nsh: 0.4, el: 2, elh: 1.2, bark: 1, loads: [8, 4, 3, 1], canopy: 10, cover: 0.35 },
};

/** Fabricate a plausible fuel map from terrain (landform, TPI, slope, elevation) and canopy. */
export function fabricateFuel(terrain: Terrain, canopy: { height: Float32Array; cover: Float32Array } | null, seed: number, now: number, alpine: boolean): FuelMap {
  const g = terrain.grid;
  const n = g.nx * g.ny;
  const rng = new Rng(seed);
  const f: FuelMap = {
    grid: g,
    type: new Uint8Array(n),
    surfaceHazard: new Float32Array(n),
    nearSurfaceHazard: new Float32Array(n),
    nearSurfaceHeight: new Float32Array(n),
    elevatedHazard: new Float32Array(n),
    elevatedHeight: new Float32Array(n),
    barkHazard: new Float32Array(n),
    surfaceLoad: new Float32Array(n),
    nearSurfaceLoad: new Float32Array(n),
    elevatedLoad: new Float32Array(n),
    barkLoad: new Float32Array(n),
    canopyHeight: new Float32Array(n),
    canopyCover: new Float32Array(n),
    curing: new Float32Array(n).fill(80),
    timeSinceFire: new Float32Array(n).fill(Number.NaN),
    lastFireKind: new Uint8Array(n),
    sources: ['Mock fuel map (synthetic, from landform and canopy height)'],
  };
  // Fire-history patches: a few old wildfires and recent hazard-reduction burns.
  const patches: { x: number; y: number; r: number; years: number; kind: FireHistoryKind }[] = [];
  const half = (g.nx * g.cellSize) / 2;
  for (let p = 0; p < 7; p++) {
    const kind = p < 3 ? FireHistoryKind.PrescribedBurn : FireHistoryKind.Wildfire;
    patches.push({ x: rng.range(-half, half), y: rng.range(-half, half), r: rng.range(500, 1600), years: kind === FireHistoryKind.PrescribedBurn ? rng.range(1, 4) : rng.range(6, 25), kind });
  }
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const z = terrain.elevation[k]!;
      const slope = terrain.slopeDeg[k]!;
      const lf = terrain.landform[k] as Landform;
      const tpi = terrain.tpi[k]!;
      const cov = canopy ? canopy.cover[k]! : Math.min(0.8, Math.max(0, 0.5 - tpi / 80));
      const ch = canopy ? canopy.height[k]! : 18;
      let t: FuelType;
      if (slope > 55 || lf === Landform.Cliff) t = FuelType.NonFuel;
      else if (alpine && z > 1750) t = FuelType.AlpineHeathGrass;
      else if (alpine && z > 1450) t = FuelType.SnowGumWoodland;
      else if (tpi < -25 && cov > 0.5) t = ch > 28 ? FuelType.Rainforest : FuelType.WetForest;
      else if ((lf === Landform.Gully || lf === Landform.ValleyFloor) && cov > 0.45) t = FuelType.WetForest;
      else if (cov < 0.08 && slope < 6) t = FuelType.Grassland;
      else if (cov < 0.2 && (lf === Landform.Ridge || lf === Landform.Peak || lf === Landform.UpperSlope || lf === Landform.Flat)) t = FuelType.Heath;
      else if (cov < 0.25) t = FuelType.GrassyWoodland;
      else t = lf === Landform.ValleyFloor ? FuelType.DryForestGrassy : FuelType.DryForestShrubby;
      f.type[k] = t;
      const d = FUEL_DEFAULTS[t];
      if (d) {
        f.surfaceHazard[k] = d.s;
        f.nearSurfaceHazard[k] = d.ns;
        f.nearSurfaceHeight[k] = d.nsh;
        f.elevatedHazard[k] = d.el;
        f.elevatedHeight[k] = d.elh;
        f.barkHazard[k] = d.bark;
        f.surfaceLoad[k] = d.loads[0];
        f.nearSurfaceLoad[k] = d.loads[1];
        f.elevatedLoad[k] = d.loads[2];
        f.barkLoad[k] = d.loads[3];
      }
      f.canopyHeight[k] = canopy ? ch : (d?.canopy ?? 0);
      f.canopyCover[k] = canopy ? cov : (d?.cover ?? 0);
      // Time since fire from the nearest covering patch; fuel is lighter in recently burnt ground.
      const x = g.x0 + i * g.cellSize;
      const y = g.y0 + j * g.cellSize;
      for (const p of patches) {
        if ((x - p.x) ** 2 + (y - p.y) ** 2 < p.r * p.r && !(f.timeSinceFire[k]! < p.years)) {
          f.timeSinceFire[k] = p.years;
          f.lastFireKind[k] = p.kind;
        }
      }
      const tsf = f.timeSinceFire[k]!;
      if (Number.isFinite(tsf) && d) {
        const acc = 1 - Math.exp(-tsf / 5); // Olson-style accumulation
        f.surfaceHazard[k] = d.s * (0.3 + 0.7 * acc);
        f.surfaceLoad[k] = d.loads[0] * acc;
        f.elevatedHazard[k] = d.el * (0.2 + 0.8 * acc);
        f.elevatedLoad[k] = d.loads[2] * acc;
      }
    }
  }
  void now;
  return f;
}

/** Mock implementation of `buildScenario` from src/scenario. */
export const mockBuildScenario: BuildScenarioFn = async (req, onProgress, signal) => {
  const warnings: string[] = ['Mock mode: fuel, weather and fire behaviour are synthetic (for testing the interface).'];
  const report = (step: BuildProgress['step'], fraction: number, message: string): void => onProgress({ step, fraction, message, warnings: [...warnings] });
  const options = { ...DEFAULT_SIM_OPTIONS, ...req.options };
  const cellSize = options.fireCellSize;

  report('terrain', 0.02, 'Loading elevation…');
  let grid = makeGridSpec(req.centre, req.extent, cellSize);
  let elevation: Float32Array;
  let source: string;
  try {
    const r = await loadElevation({ centre: req.centre, extent: req.extent, cellSize, demoSiteId: req.demoSiteId, signal, offline: !req.online });
    grid = r.grid;
    elevation = r.elevation;
    source = r.source;
  } catch (e) {
    if (signal?.aborted) throw abortError();
    warnings.push(`Elevation unavailable (${(e as Error).message}); using synthetic terrain.`);
    elevation = syntheticElevation(grid, 'escarpment');
    source = syntheticSource('escarpment');
  }
  report('terrain', 0.2, 'Deriving slope, aspect and landforms…');
  await sleep(30, signal);
  const terrain = buildTerrain(grid, elevation, source);

  report('canopy', 0.35, 'Loading canopy height…');
  let canopy: { height: Float32Array; cover: Float32Array } | null = null;
  try {
    canopy = await loadCanopy(grid, { demoSiteId: req.demoSiteId, allowRemote: false, signal });
  } catch {
    if (signal?.aborted) throw abortError();
  }
  if (!canopy) warnings.push('Canopy height unavailable — estimated from terrain.');
  await sleep(120, signal);

  report('vegetation', 0.5, 'Mapping vegetation…');
  await sleep(150, signal);
  report('fireHistory', 0.6, 'Reading fire history…');
  await sleep(150, signal);
  if (!req.online && !req.demoSiteId) warnings.push('Fire history unavailable offline — assuming 10 years since fire.');

  report('fuel', 0.7, 'Building fuel model…');
  const alpine = req.demoSiteId === 'thredbo' || terrain.maxElevation > 1600;
  const now = Date.now();
  const fuel = fabricateFuel(terrain, canopy, options.seed, now, alpine);
  await sleep(120, signal);

  report('weather', 0.82, 'Getting weather…');
  const { series, start } = mockWeather(req);
  if (!req.online && (req.weather.kind === 'now' || req.weather.kind === 'forecast' || req.weather.kind === 'past')) {
    warnings.push('Offline: using stored/synthetic weather. Enter belt weather kit readings for local conditions.');
  }
  await sleep(150, signal);
  report('moisture', 0.92, 'Spinning up fuel moisture…');
  await sleep(150, signal);

  const site = DEMO_SITES.find((s) => s.id === req.demoSiteId);
  const scenario: ScenarioData = {
    id: `mock-${Date.now().toString(36)}`,
    name: req.name ?? site?.name ?? 'My location',
    origin: { ...req.centre },
    extent: req.extent,
    terrain,
    fuel,
    weather: series,
    startTime: start,
    duration: req.duration,
    ignitions: [],
    edits: [],
    options,
  };
  report('done', 1, 'Model ready');
  return scenario;
};
