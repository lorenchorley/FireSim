/**
 * Setup-form model (pure, unit-tested): defaults, validation and conversion to a {@link ScenarioRequest}.
 */
import type { LatLon } from '../core/geo';
import { DEMO_SITES } from '../data/demoSites';
import type { ScenarioRequest, WeatherMode } from '../scenario/request';
import { manualSeries } from './weatherSeries';
import { pressureAtElevation, relativeHumidityFromWetBulb } from './weatherCalc';
import { parseLatLon } from './nsw';
import { REPLAYS, WEATHER_PRESETS } from './content';
import { isPresetId, WEATHER_PRESETS as SCENARIO_PRESETS } from '../scenario/presets';
import type { BeltKitInput } from '../scenario/beltKit';
import { builtFireCell, SCENARIO_PARAMS } from '../scenario/params';
import type { PerformanceMode, ScenarioSettings } from './settings';
import { performanceProfile } from './settings';

export type WhereMode = 'demo' | 'gps' | 'manual';
export type Detail = 'fast' | 'normal' | 'detailed';
export type WeatherChoice = 'now' | 'past' | 'forecast' | 'preset' | 'replay' | 'belt' | 'manual';

/**
 * The fire cell each detail option asks for. The builder only makes 30 m or 20 m cells (scenario/params.ts
 * `builtFireCell`; the engine is calibrated at 20-30 m), so 'Fast' is 30 m cells with the simple (2-D) wind model,
 * i.e. the fast tier, not a coarser grid; 'Detailed' gives 20 m only for areas up to 6 km.
 */
export const DETAIL_CELL: Record<Detail, number> = { fast: 30, normal: 30, detailed: 20 };

/** Labels of the detail picker: exactly what each option builds. */
export const DETAIL_OPTIONS: Record<Detail, { label: string; sub: string }> = {
  fast: { label: 'Fast', sub: '30 m · 2-D' },
  normal: { label: 'Normal', sub: '30 m' },
  detailed: { label: 'Detailed', sub: '20 m' },
};
export const EXTENTS_KM = [3, 6, 9] as const;
export type ExtentKm = (typeof EXTENTS_KM)[number];

export interface BeltKit {
  dry: number;
  wet: number;
  windKmh: number;
  windDir: number;
  /** Local time of the reading (unix ms). */
  time: number;
  droughtFactor: number;
}

export interface ManualWeather {
  temperature: number;
  rh: number;
  windKmh: number;
  windDir: number;
  start: number;
  droughtFactor: number;
  change: { enabled: boolean; afterHours: number; windKmh: number; windDir: number; temperature: number; rh: number };
}

export interface SetupState {
  where: WhereMode;
  demoSiteId: string;
  /** GPS fix (not persisted). */
  gps: { position: LatLon; accuracy: number } | null;
  manualText: string;
  extentKm: ExtentKm;
  detail: Detail;
  weather: WeatherChoice;
  pastTime: number;
  forecastTime: number;
  presetId: string;
  presetStart: number;
  replayId: string;
  belt: BeltKit;
  manual: ManualWeather;
  durationH: number;
  online: boolean;
}

/** Round to the next 10 minutes. */
const roundTo10 = (ms: number): number => Math.ceil(ms / 600_000) * 600_000;

export function defaultSetup(now = Date.now()): SetupState {
  return {
    where: 'demo',
    demoSiteId: 'katoomba',
    gps: null,
    manualText: '',
    extentKm: 6,
    detail: 'normal',
    weather: 'preset',
    pastTime: roundTo10(now - 24 * 3600_000),
    forecastTime: roundTo10(now + 3 * 3600_000),
    presetId: WEATHER_PRESETS[0]!.id,
    presetStart: roundTo10(now),
    replayId: REPLAYS[0]!.id,
    belt: { dry: 32, wet: 19, windKmh: 25, windDir: 315, time: roundTo10(now), droughtFactor: 8 },
    manual: {
      temperature: 34,
      rh: 15,
      windKmh: 30,
      windDir: 315,
      start: roundTo10(now),
      droughtFactor: 9,
      change: { enabled: true, afterHours: 3, windKmh: 40, windDir: 225, temperature: 25, rh: 40 },
    },
    durationH: 6,
    online: true,
  };
}

/** Fields that are persisted between sessions (not the GPS fix; times are refreshed). */
export function persistable(s: SetupState): Partial<SetupState> {
  const { gps: _gps, pastTime: _p, forecastTime: _f, presetStart: _ps, ...rest } = s;
  return { ...rest, belt: { ...s.belt, time: 0 }, manual: { ...s.manual, start: 0 } };
}

/** Merge a persisted partial state over the defaults (ignoring invalid values). */
export function restoreSetup(saved: Partial<SetupState> | null, now = Date.now()): SetupState {
  const d = defaultSetup(now);
  if (!saved || typeof saved !== 'object') return d;
  const s: SetupState = { ...d, ...saved, gps: null, pastTime: d.pastTime, forecastTime: d.forecastTime, presetStart: d.presetStart };
  s.belt = { ...d.belt, ...(saved.belt ?? {}), time: d.belt.time };
  s.manual = { ...d.manual, ...(saved.manual ?? {}), start: d.manual.start, change: { ...d.manual.change, ...(saved.manual?.change ?? {}) } };
  if (!DEMO_SITES.some((x) => x.id === s.demoSiteId)) s.demoSiteId = d.demoSiteId;
  if (!EXTENTS_KM.includes(s.extentKm)) s.extentKm = d.extentKm;
  if (!(s.detail in DETAIL_CELL)) s.detail = d.detail;
  if (s.where === 'gps') s.where = 'demo'; // a fix is needed again
  if (!WEATHER_PRESETS.some((p) => p.id === s.presetId)) s.presetId = d.presetId;
  if (!REPLAYS.some((r) => r.id === s.replayId)) s.replayId = d.replayId;
  s.durationH = Math.min(12, Math.max(1, Math.round(Number(s.durationH) || d.durationH)));
  return s;
}

/** Approximate ground elevation (m) of the demo sites, for the psychrometer pressure correction. */
const DEMO_ELEVATION: Record<string, number> = {
  katoomba: 950,
  grose: 900,
  kanangra: 1150,
  thredbo: 1450,
  gospers: 550,
  budawangs: 450,
  barrington: 1250,
  warrumbungles: 650,
};

/** Rough site elevation for the setup (the terrain is not loaded yet); 600 m for places away from the demo sites. */
export function approxElevation(s: Pick<SetupState, 'where' | 'demoSiteId'>): number {
  return s.where === 'demo' ? (DEMO_ELEVATION[s.demoSiteId] ?? 600) : 600;
}

/** Belt-kit RH from the dry/wet bulb, corrected for site elevation (NaN if the readings are inconsistent). */
export function beltRh(b: Pick<BeltKit, 'dry' | 'wet'>, elevationM = 0): number {
  return relativeHumidityFromWetBulb(b.dry, b.wet, pressureAtElevation(elevationM));
}

/** Where the scenario is centred, and the demo site to use for bundled data. */
export function resolveCentre(s: SetupState): { centre: LatLon; demoSiteId?: string; name: string } | { error: string } {
  if (s.where === 'demo') {
    const site = DEMO_SITES.find((x) => x.id === s.demoSiteId);
    if (!site) return { error: 'Pick a demo site.' };
    return { centre: site.centre, demoSiteId: site.id, name: site.name };
  }
  if (s.where === 'gps') {
    if (!s.gps) return { error: 'No location yet — tap “Use my location”.' };
    return { centre: s.gps.position, name: 'My location' };
  }
  const p = parseLatLon(s.manualText);
  if (!p) return { error: 'Enter coordinates such as -33.715, 150.285.' };
  return { centre: p, name: `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}` };
}

/** Validation messages for the current form (empty = OK to build). */
export function validateSetup(s: SetupState, now = Date.now()): string[] {
  const errs: string[] = [];
  const c = resolveCentre(s);
  if ('error' in c) errs.push(c.error);
  if (s.weather === 'past' && s.pastTime > now) errs.push('A past date must be before now.');
  if (s.weather === 'forecast' && (s.forecastTime < now - 3600_000 || s.forecastTime > now + 16 * 24 * 3600_000)) errs.push('Forecast start must be within the next 16 days.');
  if (s.weather === 'belt') {
    if (!Number.isFinite(beltRh(s.belt))) errs.push('Wet bulb must not read warmer than the dry bulb.');
    if (!(s.belt.windKmh >= 0)) errs.push('Enter the wind speed.');
  }
  if (s.weather === 'manual') {
    const m = s.manual;
    if (!(m.rh >= 1 && m.rh <= 100)) errs.push('Humidity must be 1–100 %.');
    if (!Number.isFinite(m.temperature)) errs.push('Enter the temperature.');
    if (!(m.windKmh >= 0)) errs.push('Enter the wind speed.');
  }
  return errs;
}

/** Start (unix ms) of a preset's canonical day and hour in the year of `now`, at longitude `lon` (null if unknown). */
export function presetStart(presetId: string, lon: number, now = Date.now()): number | null {
  if (!isPresetId(presetId)) return null;
  // Rounded to 10 min so the clock starts on a round local time (11:00 LMST at Katoomba is 11:59 AEDT → 12:00).
  return Math.round(SCENARIO_PRESETS[presetId].canonicalStart(lon, new Date(now).getUTCFullYear()) / 600_000) * 600_000;
}

/**
 * Convert the form to a scenario request (call {@link validateSetup} first). `settings` is a performance mode or the
 * user's settings: their display step (`timeStep`) becomes the engine's snapshotInterval and their solver step limit
 * (`solverStep`, 0 = automatic) its maxStepS; a bare mode leaves both at the engine defaults (60 s, automatic).
 */
export function buildRequest(s: SetupState, settings: PerformanceMode | ScenarioSettings = 'auto', now = Date.now()): ScenarioRequest {
  const perf: PerformanceMode = typeof settings === 'string' ? settings : settings.performance;
  const c = resolveCentre(s);
  if ('error' in c) throw new Error(c.error);
  const hours = s.durationH;
  let weather: WeatherMode;
  switch (s.weather) {
    case 'now':
      weather = { kind: 'now' };
      break;
    case 'past':
      weather = { kind: 'past', start: s.pastTime };
      break;
    case 'forecast':
      weather = { kind: 'forecast', start: s.forecastTime };
      break;
    case 'preset': {
      // Presets start on their canonical day and teaching hour (spec §11.3: e.g. 20 Dec 11:00 LMST for the NW-wind
      // day) in the current year, so the sun angle, curing and the rating chip match what the preset was designed for.
      const start = presetStart(s.presetId, c.centre.lon, now) ?? (s.presetStart || roundTo10(now));
      weather = { kind: 'preset', presetId: s.presetId, start };
      break;
    }
    case 'replay':
      weather = { kind: 'replay', replayId: s.replayId };
      break;
    case 'belt': {
      const b = s.belt;
      const rh = beltRh(b, approxElevation(s));
      weather = {
        kind: 'manual',
        series: manualSeries({
          location: c.centre,
          start: b.time || roundTo10(now),
          hours,
          temperature: b.dry,
          relativeHumidity: rh,
          windKmh: b.windKmh,
          windDir: b.windDir,
          droughtFactor: b.droughtFactor,
          kind: 'belt-kit',
        }),
      };
      break;
    }
    case 'manual': {
      const m = s.manual;
      const start = m.start || roundTo10(now);
      weather = {
        kind: 'manual',
        series: manualSeries({
          location: c.centre,
          start,
          hours,
          temperature: m.temperature,
          relativeHumidity: m.rh,
          windKmh: m.windKmh,
          windDir: m.windDir,
          droughtFactor: m.droughtFactor,
          change: m.change.enabled
            ? { time: start + m.change.afterHours * 3600_000, windKmh: m.change.windKmh, windDir: m.change.windDir, temperature: m.change.temperature, relativeHumidity: m.change.rh }
            : null,
        }),
      };
      break;
    }
  }
  const prof = performanceProfile(perf);
  // Belt kit: the builder converts the readings itself (psychrometer at the site's station pressure from the real
  // terrain, kit wind at ~2 m → 10 m open wind, spec §11.5); the manual series above supplies the drought inputs.
  const beltKit: BeltKitInput[] | undefined =
    s.weather === 'belt' ? [{ dryBulb: s.belt.dry, wetBulb: s.belt.wet, windKmh: s.belt.windKmh, windDir: s.belt.windDir, time: s.belt.time || roundTo10(now) }] : undefined;
  const req: ScenarioRequest = {
    name: c.name,
    centre: c.centre,
    extent: s.extentKm * 1000,
    weather,
    duration: hours * 3600,
    online: s.online,
    options: {
      fireCellSize: DETAIL_CELL[s.detail],
      maxEmbers: prof.maxEmbers,
      // 'Fast' = the fast tier (2-D wind, no 3-D atmosphere): the quick option the engine really has.
      tier: s.detail === 'fast' ? 'fast' : prof.tier,
      ...(typeof settings === 'string' ? {} : { snapshotInterval: settings.timeStep, maxStepS: settings.solverStep }),
    },
  };
  if (c.demoSiteId) req.demoSiteId = c.demoSiteId;
  if (beltKit) req.beltKit = beltKit;
  return req;
}

/**
 * The cells the builder will really make for this choice (scenario/params.ts `builtFireCell`), for the detail picker.
 * `tier` is the performance profile's tier ('high' with the Quality setting also gives 20 m up to 6 km).
 */
export function detailHint(extentKm: number, detail: Detail, tier?: string): string {
  const extentM = extentKm * 1000;
  const t = detail === 'fast' ? 'fast' : tier;
  const built = builtFireCell(extentM, DETAIL_CELL[detail], t);
  const n = Math.round(extentM / built.cellM);
  const cells = n * n;
  const count = cells >= 1e5 ? `${Math.round(cells / 1000)}k` : cells.toLocaleString('en-AU');
  const why = built.coarsened ? ` (20 m needs an area of ${SCENARIO_PARAMS.highDetailMaxExtentM / 1000} km or less)` : detail === 'fast' ? ', simple 2-D wind' : '';
  return `${built.cellM} m cells · ${count} cells${why}`;
}
