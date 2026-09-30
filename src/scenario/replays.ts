/**
 * Bundled historical fire-weather replays (spec §11.4).
 *
 * Replay id `<site>-<yyyy-mm-dd>` → demo site bundle + an hourly Open-Meteo file (ecmwf_ifs historical forecast for
 * 2019/20, ERA5 for 2013) and a `-daily365` file (archive daily rain / Tmax / Tmin for the 365 days before the date),
 * shipped in `public/replays/` (copied from tests/fixtures/live/replay-*.json, doc 08b §7) so replays work offline.
 * Default start: the date at 10:00 LMST; a user-moved start is kept inside the file with ≥ 4 h of weather after it.
 * Replays have no upper-air data (synthetic profile, C-Haines unavailable). Fires burning at the date are shown as
 * "burning at this date" outlines by the fuel/ inclusion rule (§4.4); the user places ignitions.
 */
import type { DailyWeather, WeatherSeries } from '../core/types';
import { loadAsset } from '../data/assets';
import type { TraceOptions } from '../data/ledger';
import { parseOpenMeteoDaily, parseOpenMeteoHourly, type OpenMeteoResponse } from './openMeteo';
import { SCENARIO_PARAMS } from './params';
import { lmstToUtc } from './time';

export interface ReplayInfo {
  /** `<site>-<yyyy-mm-dd>` */
  id: string;
  name: string;
  /** Demo site id (public/demo/<site>/). */
  site: string;
  /** Local date of the fire day. */
  date: string;
  /** What happened, for the setup card. */
  story: string;
  /** Fires the NPWS history shows burning at the date (context; the fuel inclusion rule decides). */
  activeFires: string[];
  /** Weather source of the hourly file. */
  model: 'ecmwf_ifs' | 'era5';
}

/** The replay catalogue (doc 08b §7; stories from ui/content.ts). */
export const REPLAYS: readonly ReplayInfo[] = Object.freeze([
  {
    id: 'katoomba-2013-10-16',
    name: 'Blue Mountains fires, Oct 2013',
    site: 'katoomba',
    date: '2013-10-16',
    story: 'Hot, dry westerlies the day before the State Mine and Mount York Road fires ran through the upper Blue Mountains.',
    activeFires: [],
    model: 'era5',
  },
  {
    id: 'grose-2019-12-19',
    name: 'Grose Valley, Dec 2019',
    site: 'grose',
    date: '2019-12-19',
    story: 'Black Summer: the Gospers Mountain fire approaching the Grose Valley and Blackheath on a catastrophic-rated week.',
    activeFires: ['Gospers Mountain'],
    model: 'ecmwf_ifs',
  },
  {
    id: 'gospers-2019-12-19',
    name: 'Gospers Mountain, Dec 2019',
    site: 'gospers',
    date: '2019-12-19',
    story: 'The mega-fire’s run through remote Wollemi sandstone country: 42 °C, 11 % RH, gusts to 90 km/h.',
    activeFires: ['Gospers Mountain'],
    model: 'ecmwf_ifs',
  },
  {
    id: 'kanangra-2019-12-17',
    name: 'Kanangra-Boyd, Dec 2019',
    site: 'kanangra',
    date: '2019-12-17',
    story: 'Green Wattle Creek and Kowmung River fires spreading through the dissected plateau country.',
    activeFires: ['Green Wattle Creek', 'Kowmung River'],
    model: 'ecmwf_ifs',
  },
  {
    id: 'budawangs-2019-12-30',
    name: 'Currowan fire, 30 Dec 2019',
    site: 'budawangs',
    date: '2019-12-30',
    story: 'Eve of the New Year’s Eve run to the coast: hot NW flow down the escarpment ahead of a southerly.',
    activeFires: ['Currowan 2'],
    model: 'ecmwf_ifs',
  },
  {
    id: 'thredbo-2020-01-02',
    name: 'Snowy Mountains, Jan 2020',
    site: 'thredbo',
    date: '2020-01-02',
    story: 'Dunns Road and Pilot Lookout fire weather in the alpine valleys: very dry air, strong winds on the ranges.',
    activeFires: ['Pilot Lookout'],
    model: 'ecmwf_ifs',
  },
  {
    id: 'warrumbungles-2013-01-12',
    name: 'Wambelong fire, Jan 2013',
    site: 'warrumbungles',
    date: '2013-01-12',
    story: 'The day the Wambelong fire started: record heat, then the run through the park and Siding Spring.',
    activeFires: ['Wambelong WNP'],
    model: 'era5',
  },
]);

export const replayInfo = (id: string): ReplayInfo | undefined => REPLAYS.find((r) => r.id === id);

/** Asset paths of a replay (the app copy in public/replays/, with the spec's public/demo/replays/ as a fallback). */
export const replayAssetPaths = (id: string): { hourly: string[]; daily: string[] } => ({
  hourly: [`replays/${id}.json`, `demo/replays/${id}.json`],
  daily: [`replays/${id}-daily365.json`, `demo/replays/${id}-daily365.json`],
});

interface ReplayFile {
  path: string;
  bytes: number;
}

/** The bundled files a replay was read from (sizes are the files' real byte lengths). */
export interface ReplayFiles {
  hourly: ReplayFile;
  daily?: ReplayFile;
}

async function firstJson<T>(paths: string[], signal?: AbortSignal, trace?: TraceOptions): Promise<{ json: T; file: ReplayFile } | null> {
  for (const p of paths) {
    const bytes = await loadAsset(p, signal, trace);
    if (!bytes) continue;
    try {
      return { json: JSON.parse(new TextDecoder().decode(bytes)) as T, file: { path: p, bytes: bytes.byteLength } };
    } catch {
      /* an SPA dev server answering a missing file with index.html: try the next path */
    }
  }
  return null;
}

export interface LoadedReplay {
  info: ReplayInfo;
  series: WeatherSeries;
  daily: DailyWeather[];
  /** Default start: the date at 10:00 LMST at the site (unix ms). */
  defaultStart: number;
  files: ReplayFiles;
}

/**
 * Load and parse a bundled replay (offline). Throws for an unknown id or a missing file. `hourlyTrace` / `dailyTrace`
 * record the two file reads on a request ledger (the hourly file is the 'weather' data set, the daily one 'drought-history').
 */
export async function loadReplay(id: string, signal?: AbortSignal, hourlyTrace?: TraceOptions, dailyTrace?: TraceOptions): Promise<LoadedReplay> {
  const info = replayInfo(id);
  if (!info) throw new Error(`Unknown replay '${id}'`);
  const paths = replayAssetPaths(id);
  const [hourly, daily] = await Promise.all([firstJson<OpenMeteoResponse>(paths.hourly, signal, hourlyTrace), firstJson<OpenMeteoResponse>(paths.daily, signal, dailyTrace)]);
  if (!hourly) throw new Error(`Replay '${id}': weather file missing (public/replays/${id}.json)`);
  const src = info.model === 'era5' ? 'ERA5 reanalysis (Open-Meteo archive)' : 'ECMWF IFS historical forecast (Open-Meteo)';
  const parsed = parseOpenMeteoHourly(hourly.json, { kind: 'historical', source: `Replay ${info.name}: ${src}` });
  if (parsed.missingRequired.length) throw new Error(`Replay '${id}': weather file lacks ${parsed.missingRequired.join(', ')}`);
  const series = parsed.series;
  const d = daily ? parseOpenMeteoDaily(daily.json) : [];
  series.daily = d;
  return { info, series, daily: d, defaultStart: replayDefaultStart(info, series.location.lon), files: { hourly: hourly.file, ...(daily ? { daily: daily.file } : {}) } };
}

/** 10:00 LMST on the replay date (rounded to the minute) (§11.4). */
export function replayDefaultStart(info: Pick<ReplayInfo, 'date'>, lonDeg: number): number {
  return Math.round(lmstToUtc(info.date, SCENARIO_PARAMS.replayDefaultStartLmst, lonDeg) / 60_000) * 60_000;
}

/**
 * Clamp a user-moved replay start into the file so ≥ 4 h of weather follow it; returns the start and whether it moved.
 */
export function clampReplayStart(series: WeatherSeries, start: number): { start: number; moved: boolean } {
  const hs = series.hours;
  const first = hs[0]!.time;
  const last = hs[hs.length - 1]!.time - SCENARIO_PARAMS.replayMinWeatherAfterH * 3.6e6;
  const s = Math.min(Math.max(start, first), Math.max(first, last));
  return { start: s, moved: s !== start };
}
