/**
 * PLANNED data of a scenario, before anything is downloaded (for the Setup screen): one {@link DatasetRecord} per data
 * set the builder will look for, with the likely origin (bundled when a demo site covers the area, a saved area pack or
 * stored copy when one exists, else a live download), an ESTIMATED size range with its basis, and whether it can be had
 * with no signal. Every planned record carries `plan` and `sizes.estimate: true`.
 *
 * How sizes are estimated (never invented):
 *  - Bundled files and area-pack items: their EXACT byte lengths (public/demo/provenance.json, the pack's item sizes).
 *  - Terrain tiles: the exact tile list of the request (data/terrainTiles.ts `elevationTilesFor`), minus tiles already
 *    stored, times the typical tile size measured from real downloads ({@link TYPICAL}).
 *  - Vegetation and fire history: bytes per km² of the eight bundled demo areas (the same ArcGIS queries, fetched
 *    2026-09-27; lowest, median and highest site) times the queried area.
 *  - Weather: the measured size of the responses of the same requests (tests/fixtures/live, fetched 2026-09-27).
 *  - Roads, homes and places: bytes per km² measured from the live Bilpin build (2026-09-30), wide range.
 * The live test (src/scenario/datasets.live.test.ts) compares these with a real build.
 *
 * `estimateScenarioData` reads only local things (the bundle manifest, the area-pack index and the cache's key list);
 * it makes no network request.
 */
import { formatBytes, type DatasetOrigin, type DatasetPlan, type DatasetRecord, type DatasetRole, type DatasetStatus } from '../core/datasets';
import type { LatLon } from '../core/types';
import {
  CONTEXT_MARGIN_M,
  contextCacheKey,
  contextQueryBBox,
  DEMO_SITES,
  elevationTilesFor,
  findAreaPacks,
  loadBundleManifest,
  MAX_REMOTE_CANOPY_EXTENT,
  openCache,
  type AreaPackMeta,
  type BundleManifest,
  type KV,
} from '../data';
import { resolveRequest } from './build';
import { demoCoverage, domainBBox, FIRE_HISTORY_TAG, NPWS_FIRE_QUERY_PATH, SVTM_QUERY_PATH, VEGETATION_TAG } from './layers';
import { SCENARIO_PARAMS } from './params';
import { ATTRIBUTION, LICENCES, PROVIDERS, extentOf, skeleton } from './recordKit';
import { replayInfo } from './replays';
import type { ScenarioRequest } from './request';

// ─────────────────────────────────────────────────────────────────────────────
// Typical sizes (measured; see the header)
// ─────────────────────────────────────────────────────────────────────────────

export interface TypicalSize {
  low: number;
  mid: number;
  high: number;
  basis: string;
}

/**
 * Roads, fire trails, homes, zones and names: raw ArcGIS JSON bytes per km² of the queried square, per layer. Mid =
 * measured at Bilpin (semi-rural, 46 km² queried, 2026-09-30: roads 102 kB, trails 17 kB, homes 16 kB, zones 211 kB,
 * names 29 kB); low = bush with nothing mapped; high = a town (Katoomba has 7 368 address points in 81 km²).
 */
const CONTEXT_BASIS_TEXT = 'bytes per km² measured on a live build at Bilpin (semi-rural, 2026-09-30); bush areas have less, towns several times more';

export const CONTEXT_PER_KM2: Readonly<Record<'roads' | 'fire-trails' | 'homes' | 'zones' | 'place-names', TypicalSize>> = Object.freeze({
  roads: { low: 300, mid: 2_200, high: 15_000, basis: CONTEXT_BASIS_TEXT },
  'fire-trails': { low: 50, mid: 370, high: 3_000, basis: CONTEXT_BASIS_TEXT },
  homes: { low: 20, mid: 340, high: 20_000, basis: CONTEXT_BASIS_TEXT },
  zones: { low: 0, mid: 4_600, high: 25_000, basis: CONTEXT_BASIS_TEXT },
  'place-names': { low: 100, mid: 630, high: 3_000, basis: CONTEXT_BASIS_TEXT },
});

/** Measured typical sizes (bytes) of the downloads whose size depends on the place. */
export const TYPICAL = Object.freeze({
  /** One zoom-14 Terrarium PNG tile (256 x 256). */
  terrariumTile: {
    low: 40_000,
    mid: 112_000,
    high: 150_000,
    basis: 'zoom-14 tiles measured on a live build at Bilpin on 2026-09-30 (16 tiles, 1.80 MB, 112 kB each); flat or sea tiles are smaller',
  },
  /** Forecast response (42 hourly variables incl. pressure levels, 7 past days + 16 forecast days max). */
  forecast: { low: 60_000, mid: 77_000, high: 95_000, basis: 'best_match forecast responses: 76.8 kB for Katoomba (2026-09-27), 76.9 kB for Bilpin (2026-09-30)' },
  /** Share of a forecast response taken by the pressure-level (upper-air) variables, as the built records split it. */
  upperAirShare: { low: 0.4, mid: 0.476, high: 0.5, basis: 'pressure-level variables are 20 of the 42 hourly variables (the built records split the download by variables)' },
  /** 365 days of daily rain and temperature (the Open-Meteo archive's default best match). */
  daily365: { low: 9_000, mid: 10_400, high: 14_000, basis: '365-day daily archive response for Katoomba, 10.4 kB (tests/fixtures/live, 2026-09-27)' },
  /** Ten years of daily rain (usual yearly rainfall). */
  annualRainfall10y: { low: 60_000, mid: 100_000, high: 130_000, basis: 'the 365-day history and the 10-year rain request measured 111.6 kB together at Bilpin (2026-09-30)' },
  /** A historical forecast / ERA5 hourly series for a past day (8 days of hours). */
  pastHourly: { low: 8_000, mid: 24_000, high: 90_000, basis: 'bundled replays: 8.7 kB (ERA5, 72 h) to 23.8 kB (IFS, 96 h); a longer window with pressure levels is larger' },
  /** Remote canopy (COG range reads), per km². */
  canopyPerKm2: { low: 1_500_000, mid: 4_000_000, high: 8_000_000, basis: 'a 600 m window at Katoomba read 2.2 MB in 158 range requests (data/canopy.ts COG_BLOCKS note); not measured on a whole domain' },
  /** Live vegetation polygons are whole (not clipped like the bundled files): factor on the bundled bytes per km². */
  vectorUnclipped: { low: 1, mid: 1.3, high: 2, basis: 'live queries return whole polygons; Bilpin measured 957 kB for 44 km² queried (22 kB per km², 2026-09-30)' },
} satisfies Record<string, TypicalSize>);

// ─────────────────────────────────────────────────────────────────────────────
// Facts gathered from the device
// ─────────────────────────────────────────────────────────────────────────────

/** What the planner knows about the device (gathered by {@link estimateScenarioData}; pass fakes in tests). */
export interface PlanFacts {
  manifest: BundleManifest | null;
  /** Area packs that cover the domain (smallest first). */
  packs: AreaPackMeta[];
  /** Cache keys present, by prefix asked for (terrarium tiles, ArcGIS pages, the context file, stored weather). */
  cachedKeys: Set<string>;
  /** Some stored Open-Meteo response exists (offline weather may be possible). */
  storedWeather: boolean;
}

const PER_KM2 = (m: BundleManifest | null, file: string): { low: number; mid: number; high: number } | null => {
  if (!m) return null;
  const km2 = (SCENARIO_PARAMS.demoExtentM / 1000) ** 2;
  const xs = Object.values(m.sites)
    .map((s) => s.files[file]?.bytes)
    .filter((b): b is number => typeof b === 'number' && b > 0)
    .map((b) => b / km2)
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  return { low: xs[0]!, mid: xs[Math.floor(xs.length / 2)]!, high: xs[xs.length - 1]! };
};

// ─────────────────────────────────────────────────────────────────────────────
// Planning
// ─────────────────────────────────────────────────────────────────────────────

interface PlanSpec {
  id: string;
  role: DatasetRole;
  title: string;
  what: string;
  why: string;
  provider: DatasetRecord['provider'];
  licence: DatasetRecord['licence'];
  attribution: string;
  format: string;
  kind: DatasetRecord['kind'];
  status: DatasetStatus;
  origin: DatasetOrigin;
  originDetail?: string;
  fallbackReason?: string;
  low: number;
  mid: number;
  high: number;
  /** The part that would come over the network (bytes, mid estimate). */
  network: number;
  requests: number;
  basis: string;
  offlineOk: boolean;
  offlineNote: string;
  onDevice: boolean;
  coverage?: number;
  filledBy?: string;
}

function planned(p: PlanSpec, centre: LatLon, extentM: number): DatasetRecord {
  const cachedLike = p.origin === 'cache' || p.origin === 'area-pack';
  const plan: DatasetPlan = {
    basis: p.basis,
    lowBytes: Math.round(p.low),
    highBytes: Math.round(p.high),
    likelyOrigin: p.origin,
    offlineOk: p.offlineOk,
    offlineNote: p.offlineNote,
    networkBytes: Math.round(p.network),
    onDevice: p.onDevice,
  };
  return skeleton({
    id: p.id,
    role: p.role,
    title: p.title,
    what: p.what,
    why: p.why,
    provider: p.provider,
    licence: p.licence,
    attribution: p.attribution,
    format: p.format,
    kind: p.kind,
    status: p.status,
    origin: p.origin,
    ...(p.originDetail ? { originDetail: p.originDetail } : {}),
    ...(p.fallbackReason ? { fallbackReason: p.fallbackReason } : {}),
    vintage: { retrievedAt: 0, retrievedBasis: 'unknown' },
    extent: extentOf(centre, extentM),
    coverage: { fraction: p.coverage ?? (p.status === 'unavailable' ? 0 : 1), ...(p.filledBy ? { filledBy: p.filledBy } : {}) },
    sizes: {
      transferredBytes: Math.round(p.mid),
      networkBytes: Math.round(p.network),
      cachedBytes: cachedLike ? Math.round(p.mid) : 0,
      requests: p.requests,
      estimate: true,
    },
    evidence: { level: 'assumed', note: `Planned before download: ${p.basis}.` },
    plan,
  });
}

const exact = (bytes: number): { low: number; mid: number; high: number } => ({ low: bytes, mid: bytes, high: bytes });

/**
 * The planned data sets of a request (pure, given the device facts). Offline requests plan no network bytes: what is
 * not on the device is planned as the substitute the builder will use.
 */
export function planScenarioData(req: ScenarioRequest, facts: PlanFacts): DatasetRecord[] {
  const rr = resolveRequest(req);
  const centre = rr.centre;
  const extentM = rr.extent;
  const online = req.online;
  const cov = demoCoverage({ centre, extent: extentM, ...(rr.demoSiteId ? { demoSiteId: rr.demoSiteId } : {}) });
  const site = cov.full[0];
  const m = facts.manifest;
  const siteFiles = site ? m?.sites[site]?.files : undefined;
  const fileBytes = (name: string): number | undefined => siteFiles?.[name]?.bytes;
  const pack = (item: string): AreaPackMeta | undefined => facts.packs.find((p) => p.itemNames.includes(item));
  const packBytes = (p: AreaPackMeta, item: string): number => p.itemBytes?.[item] ?? 0;
  const km2 = (extentM / 1000) ** 2;
  const out: DatasetRecord[] = [];
  const add = (p: PlanSpec): void => void out.push(planned(p, centre, extentM));
  const siteNote = site ? `bundled demo site '${site}'` : '';
  const noSignal = (what: string): string => `Not available with no signal: ${what}.`;

  // ── terrain ──
  {
    const base = { id: 'terrain', role: 'terrain' as const, title: 'Ground height', what: 'Height of the ground on a 10 m grid.', why: 'Slope and aspect for fire spread, wind and sun.', kind: 'raster' as const };
    const dem = fileBytes('dem5m.png');
    const p = pack('dem10');
    if (site && dem !== undefined) {
      const b = dem + (fileBytes('dem5m.json') ?? 0);
      add({ ...base, provider: PROVIDERS.spatial, licence: LICENCES.ccBy, attribution: ATTRIBUTION.spatial, format: 'PNG (Terrarium encoding), bundled', status: 'used', origin: 'bundled', originDetail: siteNote, ...exact(b), network: 0, requests: 2, basis: 'exact size of the bundled files', offlineOk: true, offlineNote: 'Shipped with the app.', onDevice: true });
    } else if (p) {
      const b = packBytes(p, 'dem10');
      add({ ...base, provider: PROVIDERS.awsTerrain, licence: LICENCES.publicDomain, attribution: ATTRIBUTION.terrarium, format: 'Float32 grid in an area pack', status: 'used', origin: 'area-pack', originDetail: `area pack '${p.name}'`, ...exact(b), network: 0, requests: 1, basis: 'size of the stored pack item', offlineOk: true, offlineNote: 'Saved on this device.', onDevice: true });
    } else {
      const tiles = elevationTilesFor({ centre, extent: extentM, cellSize: SCENARIO_PARAMS.hiResCellM });
      const packTiles = new Set(facts.packs.flatMap((pk) => pk.itemNames.filter((n) => n.startsWith('terrarium/'))));
      const stored = tiles.filter((t) => facts.cachedKeys.has(t.key) || packTiles.has(t.key)).length;
      const missing = tiles.length - stored;
      const T = TYPICAL.terrariumTile;
      const all = missing === 0;
      if (!online && !all) {
        add({ ...base, provider: PROVIDERS.app, licence: LICENCES.app, attribution: ATTRIBUTION.app, format: 'Generated', status: 'fallback', origin: 'synthetic', fallbackReason: `Offline and ${missing} of ${tiles.length} terrain tiles are not stored: made-up terrain would be used.`, low: 0, mid: 0, high: 0, network: 0, requests: 0, basis: `${tiles.length} zoom-14 tiles needed, ${stored} stored`, offlineOk: false, offlineNote: noSignal('the terrain tiles for this place are not stored'), onDevice: stored > 0, coverage: 0, filledBy: 'synthetic terrain' });
      } else {
        add({
          ...base,
          provider: PROVIDERS.awsTerrain,
          licence: LICENCES.publicDomain,
          attribution: ATTRIBUTION.terrarium,
          format: 'Terrarium PNG tiles, zoom 14',
          status: 'used',
          origin: all ? 'cache' : 'live',
          ...(all ? { originDetail: 'stored tiles' } : {}),
          low: stored * T.low + missing * T.low,
          mid: tiles.length * T.mid,
          high: tiles.length * T.high,
          network: missing * T.mid,
          requests: tiles.length,
          basis: `${tiles.length} zoom-14 tiles (${stored} already stored) x ${formatBytes(T.mid)} typical; ${T.basis}`,
          offlineOk: all,
          offlineNote: all ? 'Every tile is stored on this device.' : noSignal(`${missing} tiles have to be downloaded`),
          onDevice: stored > 0,
        });
      }
    }
  }

  // ── imagery (display only; demo sites only) ──
  {
    const base = { id: 'imagery', role: 'imagery' as const, title: 'Aerial photo', what: 'Aerial photographs draped over the ground.', why: 'Display only: helps you recognise the place.', provider: PROVIDERS.spatial, licence: LICENCES.ccBy, attribution: ATTRIBUTION.imagery, kind: 'raster' as const };
    const jpg = fileBytes('imagery.jpg');
    if (site && jpg !== undefined) add({ ...base, format: 'JPEG, bundled', status: 'used', origin: 'bundled', originDetail: siteNote, ...exact(jpg + (fileBytes('imagery.json') ?? 0)), network: 0, requests: 2, basis: 'exact size of the bundled files', offlineOk: true, offlineNote: 'Shipped with the app.', onDevice: true });
    else add({ ...base, format: '-', status: 'unavailable', origin: 'none', fallbackReason: 'Photos are bundled for the eight demo sites only; this place shows height colours instead.', low: 0, mid: 0, high: 0, network: 0, requests: 0, basis: 'no photo is downloaded for other places', offlineOk: true, offlineNote: 'Nothing to download.', onDevice: false });
  }

  // ── canopy ──
  {
    const base = { id: 'canopy-height', role: 'canopy' as const, title: 'Tree canopy height', what: 'Tree height and cover from the Meta and WRI canopy height maps.', why: 'Wind reduction under the trees, ember lofting and crown fire.', provider: PROVIDERS.meta, licence: LICENCES.ccBy, attribution: ATTRIBUTION.meta, kind: 'raster' as const };
    const png = fileBytes('canopy.png');
    const p = pack('canopy');
    if (site && png !== undefined) add({ ...base, format: 'PNG, bundled', status: 'used', origin: 'bundled', originDetail: siteNote, ...exact(png + (fileBytes('canopy.json') ?? 0)), network: 0, requests: 2, basis: 'exact size of the bundled files', offlineOk: true, offlineNote: 'Shipped with the app.', onDevice: true });
    else if (p) add({ ...base, format: 'Float32 grids in an area pack', status: 'used', origin: 'area-pack', originDetail: `area pack '${p.name}'`, ...exact(packBytes(p, 'canopy')), network: 0, requests: 1, basis: 'size of the stored pack item', offlineOk: true, offlineNote: 'Saved on this device.', onDevice: true });
    else if (online && extentM <= MAX_REMOTE_CANOPY_EXTENT) {
      const T = TYPICAL.canopyPerKm2;
      add({ ...base, format: 'Cloud-optimised GeoTIFF range reads', status: 'used', origin: 'live', low: T.low * km2, mid: T.mid * km2, high: T.high * km2, network: T.mid * km2, requests: Math.round(160 * (km2 / 0.36)), basis: `${km2.toFixed(1)} km² x ${formatBytes(T.mid)} per km²; ${T.basis}`, offlineOk: false, offlineNote: noSignal('the canopy map is read from the internet'), onDevice: false });
    } else
      add({ ...base, format: '-', status: 'fallback', origin: 'none', fallbackReason: online ? `The canopy map is only read over the network for areas of ${MAX_REMOTE_CANOPY_EXTENT / 1000} km or less; typical tree heights for each vegetation type are used.` : 'Offline and not bundled here: typical tree heights for each vegetation type are used.', low: 0, mid: 0, high: 0, network: 0, requests: 0, basis: 'not downloaded for this area', offlineOk: true, offlineNote: 'Nothing to download (type defaults).', onDevice: false, coverage: 0, filledBy: 'type-default canopy heights' });
  }

  // ── vegetation, fire history (ArcGIS) ──
  const vector = (id: string, tag: string, path: string, file: string, packItem: string, base: Omit<PlanSpec, 'status' | 'origin' | 'low' | 'mid' | 'high' | 'network' | 'requests' | 'basis' | 'offlineOk' | 'offlineNote' | 'onDevice' | 'format'>, fallbackText: string): void => {
    void tag;
    const b = fileBytes(file);
    const p = pack(packItem);
    const bbox = domainBBox(centre, extentM);
    const cached = [...facts.cachedKeys].some((k) => k.startsWith(`arcgis/${path}/${bbox.join(',')}/`));
    if (site && b !== undefined) add({ ...base, id, format: 'GeoJSON, bundled', status: 'used', origin: 'bundled', originDetail: siteNote, ...exact(b), network: 0, requests: 1, basis: 'exact size of the bundled file', offlineOk: true, offlineNote: 'Shipped with the app.', onDevice: true });
    else if (p) add({ ...base, id, format: 'GeoJSON in an area pack', status: 'used', origin: 'area-pack', originDetail: `area pack '${p.name}'`, ...exact(packBytes(p, packItem)), network: 0, requests: 1, basis: 'size of the stored pack item', offlineOk: true, offlineNote: 'Saved on this device.', onDevice: true });
    else {
      const k = PER_KM2(m, file);
      const qKm2 = (((extentM + 2 * SCENARIO_PARAMS.queryMarginM) / 1000) ** 2);
      const U = TYPICAL.vectorUnclipped;
      const r = k ? { low: k.low * qKm2 * U.low, mid: k.mid * qKm2 * U.mid, high: k.high * qKm2 * U.high } : { low: 0, mid: 0, high: 0 };
      const basis = k
        ? `${qKm2.toFixed(0)} km² queried x ${formatBytes(k.mid)} per km² (median of the 8 bundled demo areas, ${formatBytes(k.low)} to ${formatBytes(k.high)} per km², same queries, fetched 2026-09-27), x ${U.low} to ${U.high} because ${U.basis}`
        : 'no bundled areas to compare with';
      if (cached) add({ ...base, id, format: 'GeoJSON pages (stored copy)', status: 'used', origin: 'cache', originDetail: 'stored copy', ...r, network: 0, requests: 1, basis, offlineOk: true, offlineNote: 'A stored copy is on this device.', onDevice: true });
      else if (online) add({ ...base, id, format: 'GeoJSON pages (ArcGIS REST query)', status: 'used', origin: 'live', ...r, network: r.mid, requests: Math.max(1, Math.ceil(r.mid / 1_000_000)), basis, offlineOk: false, offlineNote: noSignal('it is queried from the NSW service'), onDevice: false });
      else add({ ...base, id, format: '-', status: id === 'vegetation-svtm' ? 'fallback' : 'unavailable', origin: 'none', fallbackReason: fallbackText, low: 0, mid: 0, high: 0, network: 0, requests: 0, basis: 'offline and not stored', offlineOk: true, offlineNote: 'The substitute needs no download.', onDevice: false, coverage: 0, filledBy: id === 'vegetation-svtm' ? 'vegetation inferred from terrain and canopy' : 'steady-state fuel (no fire record)' });
    }
  };
  vector('vegetation-svtm', VEGETATION_TAG, SVTM_QUERY_PATH, 'vegetation.geojson', 'vegetation', { id: '', role: 'vegetation', title: 'Vegetation map', what: 'The NSW State Vegetation Type Map (plant community polygons).', why: 'Chooses the fuel class of every cell.', provider: PROVIDERS.dccceew, licence: LICENCES.ccBy, attribution: ATTRIBUTION.svtm, kind: 'vector' }, 'Offline and not stored: the vegetation would be inferred from the terrain.');
  vector('fire-history', FIRE_HISTORY_TAG, NPWS_FIRE_QUERY_PATH, 'fire-history.geojson', 'fireHistory', { id: '', role: 'fireHistory', title: 'Fire history', what: 'NPWS outlines of past bushfires and prescribed burns.', why: 'Time since fire sets how much fuel has built up.', provider: PROVIDERS.npws, licence: LICENCES.ccBy, attribution: ATTRIBUTION.npws, kind: 'vector' }, 'Offline and not stored: steady-state fuel would be assumed everywhere.');

  // ── weather, upper air, drought ──
  {
    const w = req.weather;
    const wBase = { id: 'weather', role: 'weather' as const, title: 'Weather', what: 'Hourly temperature, humidity, wind, cloud and rain for the site.', why: 'Drives fuel moisture, fire spread and the mountain wind model.', kind: 'timeseries' as const };
    const dBase = { id: 'drought-history', role: 'weather' as const, title: 'Rainfall history and drought', what: 'A year of daily rain and temperature, and the usual yearly rainfall.', why: 'Sets the drought factor and KBDI.', kind: 'timeseries' as const };
    const app = { provider: PROVIDERS.app, licence: LICENCES.app, attribution: ATTRIBUTION.app };
    const om = { provider: PROVIDERS.openMeteo, licence: LICENCES.openMeteo, attribution: ATTRIBUTION.openMeteo };
    const none = { low: 0, mid: 0, high: 0, network: 0, requests: 0 };
    if (w.kind === 'preset') {
      add({ ...wBase, ...app, format: 'Generated', status: 'used', origin: 'preset', ...none, basis: 'generated by the app', offlineOk: true, offlineNote: 'Generated on the device.', onDevice: true });
      add({ ...dBase, ...app, format: 'Generated', status: 'used', origin: 'preset', ...none, basis: 'designed with the preset', offlineOk: true, offlineNote: 'Generated on the device.', onDevice: true });
    } else if (w.kind === 'manual' || req.beltKit?.length) {
      add({ ...wBase, provider: PROVIDERS.user, licence: LICENCES.user, attribution: 'Entered by the user', format: 'Your entries', status: 'user', origin: 'user', ...none, basis: 'typed in', offlineOk: true, offlineNote: 'Entered on the device.', onDevice: true });
      add({ ...dBase, provider: PROVIDERS.user, licence: LICENCES.user, attribution: 'Entered by the user', format: 'Your entries', status: 'user', origin: 'user', ...none, basis: 'the drought factor you gave', offlineOk: true, offlineNote: 'Entered on the device.', onDevice: true });
    } else if (w.kind === 'replay') {
      const info = replayInfo(w.replayId);
      const f = m?.replays.files[`${w.replayId}.json`]?.bytes ?? 0;
      const d = m?.replays.files[`${w.replayId}-daily365.json`]?.bytes ?? 0;
      add({ ...wBase, ...om, format: 'JSON series, bundled', status: 'used', origin: 'bundled', originDetail: `bundled replay '${info?.name ?? w.replayId}'`, ...exact(f), network: 0, requests: 1, basis: 'exact size of the bundled file', offlineOk: true, offlineNote: 'Shipped with the app.', onDevice: true });
      add({ ...dBase, ...om, format: 'JSON series, bundled', status: 'used', origin: 'bundled', ...exact(d), network: 0, requests: 1, basis: 'exact size of the bundled file', offlineOk: true, offlineNote: 'Shipped with the app.', onDevice: true });
    } else {
      const past = w.kind === 'past';
      const T = past ? TYPICAL.pastHourly : TYPICAL.forecast;
      const packW = pack('weather');
      if (!online) {
        const stored = !!packW || facts.storedWeather;
        if (stored) add({ ...wBase, ...om, format: 'JSON series (stored)', status: 'used', origin: packW ? 'area-pack' : 'cache', ...(packW ? { originDetail: `area pack '${packW.name}'` } : {}), ...(packW ? exact(packBytes(packW, 'weather')) : T), network: 0, requests: 1, basis: packW ? 'size of the stored pack item' : T.basis, offlineOk: true, offlineNote: 'A stored forecast may cover the time (checked when building; stale after 6 h).', onDevice: true });
        else add({ ...wBase, ...app, format: 'Generated', status: 'fallback', origin: 'preset', fallbackReason: 'Offline with no stored weather: a designed weather day stands in.', ...none, basis: 'offline', offlineOk: true, offlineNote: 'The preset needs no download.', onDevice: false });
        const packD = pack('daily');
        add({ ...dBase, ...(packD ? om : app), format: packD ? 'JSON (area pack)' : 'Defaults', status: packD ? 'used' : 'fallback', origin: packD ? 'area-pack' : 'none', ...(packD ? {} : { fallbackReason: 'Offline: default drought values unless a stored rainfall history is found.' }), ...(packD ? exact(packBytes(packD, 'daily')) : none), network: 0, requests: packD ? 1 : 0, basis: packD ? 'size of the stored pack item' : 'offline', offlineOk: true, offlineNote: 'No download.', onDevice: !!packD });
      } else {
        // The built records split one download between the weather and the upper air by variables; plan the same.
        const S: TypicalSize = past ? { low: 0, mid: 0, high: 0, basis: '' } : TYPICAL.upperAirShare;
        add({ ...wBase, ...om, format: 'JSON (Open-Meteo)', status: 'used', origin: 'live', low: T.low * (1 - S.high), mid: T.mid * (1 - S.mid), high: T.high * 2 * (1 - S.low), network: T.mid * (1 - S.mid), requests: 1, basis: `one ${past ? 'historical' : 'forecast'} request; ${T.basis}${past ? '' : `; ${Math.round((1 - S.mid) * 100)} % of it is the surface weather (${S.basis})`} (a second request if the first model fails)`, offlineOk: false, offlineNote: noSignal('the weather is downloaded'), onDevice: false });
        if (!past)
          add({ id: 'upper-air', role: 'upperAir', title: 'Upper-air profile', what: 'Temperature, humidity and wind at pressure levels above the site.', why: 'Stability, the wind above the ridges and how high smoke rises.', kind: 'timeseries', ...om, format: 'JSON (pressure-level variables of the weather download)', status: 'used', origin: 'live', low: T.low * S.low, mid: T.mid * S.mid, high: T.high * 2 * S.high, network: T.mid * S.mid, requests: 0, basis: `part of the same download (${Math.round(S.mid * 100)} %); ${S.basis}`, offlineOk: false, offlineNote: noSignal('it comes with the weather download'), onDevice: false });
        const a = TYPICAL.annualRainfall10y;
        const d = TYPICAL.daily365;
        const rainKey = [...facts.cachedKeys].some((k) => k.startsWith('annualRainfall/'));
        add({ ...dBase, ...om, format: 'JSON (Open-Meteo historical weather archive)', status: 'used', origin: 'live', low: d.low, mid: d.mid + (rainKey ? 0 : a.mid), high: d.high + a.high, network: d.mid + (rainKey ? 0 : a.mid), requests: rainKey ? 1 : 2, basis: `365 days of daily weather (${formatBytes(d.mid)}; ${d.basis})${rainKey ? '' : ` and 10 years of daily rain for the usual yearly rainfall (${a.basis})`}`, offlineOk: false, offlineNote: noSignal('the rainfall history is downloaded'), onDevice: rainKey });
      }
    }
  }

  // ── roads, fire trails, homes, zones, names ──
  {
    const ctxFile = fileBytes('context.json');
    const cf = siteFiles?.['context.json'];
    const layers: { id: string; title: string; count?: number }[] = [
      { id: 'roads', title: 'Roads and tracks', ...(cf?.roads !== undefined ? { count: cf.roads } : {}) },
      { id: 'fire-trails', title: 'Fire trails', ...(cf?.fireTrails !== undefined ? { count: cf.fireTrails } : {}) },
      { id: 'homes', title: 'Homes (address points)', ...(cf?.homes !== undefined ? { count: cf.homes } : {}) },
      { id: 'zones', title: 'Residential and built-up zones', ...(cf?.zones !== undefined ? { count: cf.zones } : {}) },
      { id: 'place-names', title: 'Place names', ...(cf?.places !== undefined ? { count: cf.places } : {}) },
    ];
    const common = { role: 'context' as const, what: 'NSW government map data (Spatial Services, NSW Planning).', why: 'Display only: helps you find your way and see what is at risk.', provider: PROVIDERS.spatial, licence: LICENCES.ccBy, attribution: '© Spatial Services NSW', kind: 'vector' as const };
    const total = layers.reduce((a, l) => a + (l.count ?? 0), 0);
    const packC = pack('context');
    const cached = facts.cachedKeys.has(contextCacheKey(contextQueryBBox(centre, extentM)));
    const qKm2 = ((extentM + 2 * CONTEXT_MARGIN_M) / 1000) ** 2;
    for (const l of layers) {
      const T = CONTEXT_PER_KM2[l.id as keyof typeof CONTEXT_PER_KM2];
      const share = total > 0 ? (l.count ?? 0) / total : 1 / layers.length;
      if (site && ctxFile !== undefined) add({ ...common, id: l.id, title: l.title, format: 'delta-coded JSON, bundled (one file for all five layers)', status: 'used', origin: 'bundled', originDetail: siteNote, ...exact(Math.round(ctxFile * share)), network: 0, requests: l.id === 'roads' ? 1 : 0, basis: `share of the bundled context.json (${formatBytes(ctxFile)}) by feature count`, offlineOk: true, offlineNote: 'Shipped with the app.', onDevice: true });
      else if (packC || cached) add({ ...common, id: l.id, title: l.title, format: 'delta-coded JSON (stored)', status: 'used', origin: packC ? 'area-pack' : 'cache', ...(packC ? exact(Math.round(packBytes(packC, 'context') / layers.length)) : { low: 0, mid: 0, high: 0 }), network: 0, requests: 0, basis: packC ? 'share of the stored pack item' : 'stored copy', offlineOk: true, offlineNote: 'Saved on this device.', onDevice: true });
      else if (online) add({ ...common, id: l.id, title: l.title, format: 'ArcGIS REST JSON', status: 'used', origin: 'live', low: T.low * qKm2, mid: T.mid * qKm2, high: T.high * qKm2, network: T.mid * qKm2, requests: 2, basis: `${qKm2.toFixed(0)} km² queried x ${formatBytes(T.mid)} per km²; ${T.basis}`, offlineOk: false, offlineNote: noSignal('queried from the NSW services'), onDevice: false });
      else add({ ...common, id: l.id, title: l.title, format: '-', status: 'unavailable', origin: 'none', fallbackReason: 'Offline and not stored: the layer is left off the map.', low: 0, mid: 0, high: 0, network: 0, requests: 0, basis: 'offline', offlineOk: true, offlineNote: 'Display only; the run works without it.', onDevice: false });
    }
  }

  // ── derived and bundle ──
  add({ id: 'fuel-derived', role: 'fuel', title: 'Fuel map', what: 'Fuel in every cell, worked out from the data above.', why: 'The direct input of the fire model.', provider: PROVIDERS.app, licence: { name: 'Derived from the data sets it is built from' }, attribution: ATTRIBUTION.app, format: 'Computed', kind: 'derived', status: 'used', origin: 'derived', low: 0, mid: 0, high: 0, network: 0, requests: 0, basis: 'computed on the device', offlineOk: true, offlineNote: 'Computed on the device.', onDevice: true });
  if (site && m?.sites[site]) {
    const b = m.sites[site]!.totalBytes;
    add({ id: 'bundled-site', role: 'bundle', title: `Bundled demo site: ${DEMO_SITES.find((s) => s.id === site)?.name ?? site}`, what: 'Files shipped inside the app for this demo site.', why: 'Lets you train with no signal.', provider: PROVIDERS.app, licence: { name: 'Each file keeps the licence of its source' }, attribution: ATTRIBUTION.app, format: 'Files under public/demo', kind: 'table', status: 'used', origin: 'bundled', low: b, mid: 0, high: b, network: 0, requests: 0, basis: `the whole bundle for the site is ${formatBytes(b)}; its files are counted under each data set`, offlineOk: true, offlineNote: 'Shipped with the app.', onDevice: true });
  }
  const usedPack = facts.packs.find((p) => out.some((r) => r.origin === 'area-pack' && r.originDetail === `area pack '${p.name}'`));
  if (usedPack) {
    const b = usedPack.bytes;
    add({ id: 'area-pack', role: 'pack', title: `Saved area pack: ${usedPack.name}`, what: 'Data you saved on this device for use with no signal.', why: 'Real data instead of substitutes when offline.', provider: PROVIDERS.app, licence: { name: 'Each item keeps the licence of its source' }, attribution: ATTRIBUTION.app, format: 'Items stored in the app database', kind: 'table', status: 'used', origin: 'area-pack', originDetail: `saved ${new Date(usedPack.createdAt).toISOString().slice(0, 10)}`, low: b, mid: 0, high: b, network: 0, requests: 0, basis: `the whole pack is ${formatBytes(b)} (${usedPack.itemNames.length} items); its items are counted under each data set`, offlineOk: true, offlineNote: 'Saved on this device.', onDevice: true });
  }
  return out;
}

/** Totals of a plan: network range, what is already on the device, and whether the whole scenario works offline. */
export function summarisePlan(records: readonly DatasetRecord[]): { networkLowBytes: number; networkMidBytes: number; networkHighBytes: number; onDeviceBytes: number; offlineOk: boolean; notOffline: string[] } {
  let lo = 0;
  let mid = 0;
  let hi = 0;
  let dev = 0;
  const notOffline: string[] = [];
  for (const r of records) {
    const p = r.plan;
    if (!p) continue;
    if (p.networkBytes > 0) {
      lo += p.lowBytes;
      mid += p.networkBytes;
      hi += p.highBytes;
    }
    if (p.onDevice || r.origin === 'bundled') dev += r.sizes.transferredBytes;
    if (!p.offlineOk) notOffline.push(r.title);
  }
  return { networkLowBytes: lo, networkMidBytes: mid, networkHighBytes: hi, onDeviceBytes: dev, offlineOk: notOffline.length === 0, notOffline };
}

/**
 * Planned data sets of a request, reading the device's bundle manifest, area packs and cache keys (no network). Never
 * throws for a missing store: the facts it cannot read are treated as absent.
 */
export async function estimateScenarioData(req: ScenarioRequest, o: { kv?: KV; manifest?: BundleManifest | null; signal?: AbortSignal } = {}): Promise<DatasetRecord[]> {
  const kv = o.kv ?? openCache();
  const rr = resolveRequest(req);
  const manifest = o.manifest !== undefined ? o.manifest : await loadBundleManifest(o.signal).catch(() => null);
  const packs = await findAreaPacks(rr.centre, rr.extent, kv).catch(() => [] as AreaPackMeta[]);
  const cachedKeys = new Set<string>();
  const add = async (prefix: string): Promise<void> => {
    try {
      for (const k of await kv.keys(prefix)) cachedKeys.add(k);
    } catch {
      /* store unavailable */
    }
  };
  await add('terrarium/14/');
  await add('arcgis/');
  await add('context/');
  await add('annualRainfall/');
  let storedWeather = false;
  try {
    storedWeather = (await kv.keys('openmeteo/')).length > 0;
  } catch {
    storedWeather = false;
  }
  return planScenarioData(req, { manifest, packs, cachedKeys, storedWeather });
}
