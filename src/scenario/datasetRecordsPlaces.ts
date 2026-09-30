/**
 * Data-set records for the places layers (roads, fire trails, homes, residential zones, place names), the derived fuel
 * map, the user's own input, the bundled demo-site package and the start-of-run fuel moisture. See datasetRecords.ts for
 * the conventions.
 */
import { formatBytes, formatCount, type DatasetOrigin, type DatasetPart, type DatasetRecord, type DatasetStat } from '../core/datasets';
import type { ContextLayers, ContextSource } from '../core/places';
import type { FuelMap, Ignition, LatLon, ScenarioEdit } from '../core/types';
import type { BundleManifest, DatasetLedger } from '../data';
import { CONTEXT_DATASET_ID } from '../data';
import { CONTEXT_FILE_TAG, type ContextInfo, type ContextResult } from './context';
import { contextStats, fuelStats, moistureStats, num, stat, textStat, type MoistureFacts } from './datasetStats';
import { ATTRIBUTION, COPIES, LICENCES, PROVIDERS, dateMs, endpoint, endpointsOf, extentOf, ownArrayBytes, skeleton, sizesOf, sumTotals, typedBytes, vintageFor, day } from './recordKit';

export interface PlacesInputs {
  ledger: DatasetLedger;
  bundle: BundleManifest | null;
  now: number;
  centre: LatLon;
  extentM: number;
  places: ContextResult;
  timingMs?: number;
}

type LayerKey = 'roads' | 'fireTrails' | 'homes' | 'zones' | 'places';

const LAYERS: { id: string; key: LayerKey; title: string; what: string; why: string; layerId: string; overlay?: string; format: string; kind: 'vector' | 'points'; limits: string[] }[] = [
  {
    id: 'roads',
    key: 'roads',
    title: 'Roads and tracks',
    what: 'Road and track centre lines, each with a hierarchy class (highway to path) and a surface (sealed or unsealed).',
    why: 'Drawn on the map so you can find your way, see where the fire could be reached or crossed, and worked into the "distance to a road" heat map. Display only: roads are not fire breaks in the fire model yet.',
    layerId: 'roads',
    overlay: 'roadAccess',
    format: 'ArcGIS REST features, packed as delta-coded JSON (coordinates in 1e-5 degrees)',
    kind: 'vector',
    limits: ['Map data can be out of date: new roads and closed tracks may be missing or wrong.', 'Being on the map does not mean a vehicle can use it: check trail classification and conditions locally.'],
  },
  {
    id: 'fire-trails',
    key: 'fireTrails',
    title: 'Fire trails',
    what: 'Access tracks the NSW Rural Fire Service classifies as fire trails.',
    why: 'Highlighted so crews can see the routes the RFS maintains for firefighting access. Display only.',
    layerId: 'fireTrails',
    format: 'ArcGIS REST features, packed as delta-coded JSON',
    kind: 'vector',
    limits: ['Only trails the RFS has classified; other tracks are under roads.', 'Trail condition, gates and closures are not in the data.'],
  },
  {
    id: 'homes',
    key: 'homes',
    title: 'Homes (address points)',
    what: 'One point for every registered address, standing in for a home.',
    why: 'Shows where people live relative to the fire and feeds the "homes per hectare" heat map. Display only: homes do not change the fire.',
    layerId: 'homes',
    overlay: 'homeDensity',
    format: 'ArcGIS REST points, packed as delta-coded JSON',
    kind: 'points',
    limits: ['An address is not necessarily a building: sheds, vacant lots and holiday sites can be included, and a block of units shares one point.', 'The data are a snapshot and do not show new houses or ones lost since.'],
  },
  {
    id: 'zones',
    key: 'zones',
    title: 'Residential and built-up zones',
    what: 'Planning zones for residential, village, rural-residential, commercial, industrial and tourist land.',
    why: 'Shaded on the map to show built-up land and where people are likely to be. Display only.',
    layerId: 'zones',
    format: 'ArcGIS REST polygons, packed as delta-coded JSON',
    kind: 'vector',
    limits: ['A planning zone says what land may be used for, not what is built on it.', 'Only built-up zone types are kept; national park and rural zones are left out.'],
  },
  {
    id: 'place-names',
    key: 'places',
    title: 'Place names',
    what: 'Suburb, town, village and locality names, and named features such as regions.',
    why: 'Labels on the map so you can name where you are. Display only.',
    layerId: 'placeNames',
    format: 'ArcGIS REST points, packed as delta-coded JSON',
    kind: 'points',
    limits: ['Names are official gazetted names, which may differ from local usage.'],
  },
];

const sourceOf = (ctx: ContextLayers | null, key: LayerKey): ContextSource | undefined => ctx?.sources.find((s) => s.id === key);

function urlEndpoint(url: string, note?: string): { host: string; path: string; note?: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: u.pathname, ...(note ? { note } : {}) };
  } catch {
    return { host: '', path: url, ...(note ? { note } : {}) };
  }
}

function originOfContext(o: ContextResult['origin']): DatasetOrigin {
  switch (o) {
    case 'bundled':
      return 'bundled';
    case 'live':
      return 'live';
    case 'cache':
      return 'cache';
    case 'area-pack':
      return 'area-pack';
    default:
      return 'none';
  }
}

/** Bytes each layer occupies in the shared file (by the size of its JSON), so one file's size can be split fairly. */
export function layerShares(file: ContextResult['file']): Record<LayerKey, number> | null {
  if (!file) return null;
  const size = (v: unknown): number => JSON.stringify(v).length;
  const parts: Record<LayerKey, number> = { roads: size(file.roads), fireTrails: size(file.fireTrails), homes: size(file.homes), zones: size(file.zones), places: size(file.places) };
  const total = Object.values(parts).reduce((a, b) => a + b, 0) || 1;
  return { roads: parts.roads / total, fireTrails: parts.fireTrails / total, homes: parts.homes / total, zones: parts.zones / total, places: parts.places / total };
}

export function placesRecords(i: PlacesInputs): DatasetRecord[] {
  const { places, ledger } = i;
  const ctx = places.context;
  const origin = originOfContext(places.origin);
  const cs = ctx ? contextStats(ctx) : null;
  const shares = origin === 'live' ? null : layerShares(places.file);
  const fileTotals = sumTotals(ledger, [CONTEXT_FILE_TAG]);
  const info: ContextInfo = places.info;
  const failedIds = new Set((info.failed ?? []).map((f) => CONTEXT_DATASET_ID[f]));
  const out: DatasetRecord[] = [];
  for (const L of LAYERS) {
    const src = sourceOf(ctx, L.key);
    const own = sumTotals(ledger, [L.id]);
    const share = shares?.[L.key] ?? 0;
    // Bundled / pack / stored: the shared file is split by each layer's share of its JSON; live: the layer's own requests.
    const bytes = origin === 'live' ? own.bytes : Math.round(fileTotals.bytes * share);
    const net = origin === 'live' ? own.networkBytes : 0;
    const cached = origin === 'live' ? 0 : origin === 'bundled' ? 0 : Math.round((fileTotals.cacheBytes + fileTotals.packBytes) * share);
    const missing = !ctx || failedIds.has(L.id);
    const sourceStats = cs ? (L.key === 'roads' ? cs.roads : L.key === 'fireTrails' ? cs.fireTrails : L.key === 'homes' ? cs.homes : L.key === 'zones' ? cs.zones : cs.places) : [];
    const count = !ctx ? 0 : L.key === 'roads' ? ctx.roads.length : L.key === 'fireTrails' ? ctx.fireTrails.length : L.key === 'homes' ? ctx.homes.length >> 1 : L.key === 'zones' ? ctx.zones.length : ctx.places.length;
    const memory = !ctx ? 0 : L.key === 'roads' ? ctx.roads.reduce((s, r) => s + r.xy.byteLength, 0) : L.key === 'fireTrails' ? ctx.fireTrails.reduce((s, r) => s + r.xy.byteLength, 0) : L.key === 'homes' ? ctx.homes.byteLength : L.key === 'zones' ? ctx.zones.reduce((s, z) => s + z.rings.reduce((a, r) => a + r.byteLength, 0), 0) : 0;
    const common = {
      id: L.id,
      role: 'context' as const,
      title: L.title,
      what: L.what,
      why: L.why,
      provider: src ? { name: src.provider, url: PROVIDERS.spatial.url } : PROVIDERS.spatial,
      licence: src ? { name: src.licence, url: LICENCES.ccBy.url } : LICENCES.ccBy,
      attribution: src?.attribution ?? ATTRIBUTION.spatial,
      format: L.format,
      kind: L.kind,
      extent: extentOf(i.centre, i.extentM),
      layer: { layerId: L.layerId, ...(L.overlay ? { overlay: L.overlay } : {}) },
      sourceServices: src ? [urlEndpoint(src.url, src.layer)] : [],
    };
    if (missing) {
      out.push(
        skeleton({
          ...common,
          status: 'unavailable',
          origin: 'none',
          fallbackReason: places.warnings[0] ?? 'This layer could not be loaded.',
          vintage: vintageFor('none', own, i.now),
          coverage: { fraction: 0 },
          sizes: sizesOf(own, { durationMs: i.timingMs }),
          endpoints: endpointsOf(ledger, [L.id]),
          evidence: { level: 'measured', note: 'Not loaded in this scenario.' },
          warnings: [...places.warnings],
          limitations: L.limits,
        }),
      );
      continue;
    }
    const fetched = src?.fetched ?? ctx?.fetched;
    const partial = !!info.partial;
    const stored = info.cachedAt;
    const parts: DatasetPart[] = [];
    if (origin !== 'live' && fileTotals.bytes) parts.push({ label: `Share of the shared place file (${formatBytes(fileTotals.bytes)})`, bytes, origin, note: 'The five place data sets are read from one file; its size is split by each layer’s share of the content.' });
    out.push(
      skeleton({
        ...common,
        status: partial ? 'partial' : 'used',
        origin,
        originDetail: origin === 'bundled' ? `Bundled demo site '${info.siteId ?? ''}'${partial ? ' (part of the area)' : ''}` : origin === 'area-pack' ? `Area pack '${info.packName ?? ''}'` : origin === 'cache' ? `Stored copy from ${day(stored ?? 0)}` : 'Live query of the NSW map services',
        ...(partial ? { fallbackReason: 'The bundled map of the demo site ends before the edge of the area.' } : {}),
        vintage: vintageFor(origin, own, i.now, {
          capturedOn: fetched,
          bundleCapturedOn: fetched,
          ...(origin === 'cache' && stored ? { packCreatedAt: stored } : {}),
          capturedNote: origin === 'live' ? 'Read from the live service; the services do not publish an update date.' : `Fetched from the service on ${fetched ?? 'an unknown date'}; not refreshed since.`,
        }),
        crs: { native: 'EPSG:4326 (longitude and latitude), coordinates rounded to 1e-5 degrees (about 1 m)', toModel: 'Projected to metres east and north of the site centre (equirectangular).' },
        coverage: { fraction: partial ? 0.5 : 1, note: 'Complete for the queried box unless flagged partial; an empty layer means the service has nothing there.' },
        native: { ...(L.kind === 'points' ? { points: count } : { features: count }) },
        model: { resampling: 'none', ...(L.kind === 'points' ? { points: count } : { features: count }), note: 'Drawn as vectors; the heat maps derived from them are on the fire grid.' },
        sizes: sizesOf(own, {
          transferredBytes: bytes,
          networkBytes: net,
          cachedBytes: cached,
          // The shared file is one read: it is counted once, under the first layer.
          requests: origin === 'live' ? own.requests : L.key === 'roads' ? fileTotals.requests : 0,
          memoryBytes: memory,
          features: count,
          ...(origin === 'live' && own.storedBytes === 0 ? {} : {}),
          ...(i.timingMs !== undefined ? { durationMs: i.timingMs } : {}),
        }),
        endpoints: origin === 'live' ? endpointsOf(ledger, [L.id]) : [endpoint('bundled', origin === 'bundled' ? `/demo/${info.siteId ?? ''}/context.json` : `/${origin}`, 'shared place file')],
        stats: sourceStats,
        evidence: { level: 'measured', note: 'Official NSW government map data, a snapshot as of the fetch date.', specRef: 'docs/research/00-synthesis.md §11.7' },
        warnings: [...places.warnings],
        limitations: L.limits,
        ...(parts.length ? { parts } : {}),
      }),
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived fuel map
// ─────────────────────────────────────────────────────────────────────────────

export interface FuelInputs {
  now: number;
  centre: LatLon;
  extentM: number;
  fuel: FuelMap;
  /** The input data sets (records already built), for the "worked out from" list and the status. */
  inputs: readonly DatasetRecord[];
  timingMs?: number;
}

export function fuelRecord(i: FuelInputs): DatasetRecord {
  const fs = fuelStats(i.fuel);
  const g = i.fuel.grid;
  const ids = ['terrain', 'vegetation-svtm', 'canopy-height', 'fire-history', 'drought-history'];
  const ins = i.inputs.filter((r) => ids.includes(r.id));
  const parts: DatasetPart[] = ins.map((r) => ({ label: r.title, origin: r.origin, note: r.status === 'used' ? 'real data' : r.fallbackReason ?? r.status }));
  const bad = ins.filter((r) => r.status === 'fallback' || r.status === 'unavailable' || r.status === 'partial');
  const memory = ownArrayBytes(i.fuel) * COPIES + typedBytes();
  return skeleton({
    id: 'fuel-derived',
    role: 'fuel',
    title: 'Fuel map',
    what: 'The fuel in every cell (fuel type and class, litter, near-surface, shrub and bark loads and hazard scores, canopy, grass curing), worked out by the app from the data sets above.',
    why: 'The direct input of the fire spread, fuel moisture and ember models.',
    provider: PROVIDERS.app,
    licence: { name: 'Derived from the data sets it is built from (their licences apply)' },
    attribution: `FireSim, worked out from: ${ins.map((r) => r.title.toLowerCase()).join(', ')}`,
    endpoints: [],
    sourceServices: [],
    format: 'Typed arrays on the fire grid (about 20 Float32 and 6 Uint8 arrays plus flags)',
    kind: 'derived',
    status: bad.length ? 'partial' : 'used',
    origin: 'derived',
    originDetail: 'Computed on this device from the data sets it lists',
    ...(bad.length ? { fallbackReason: `Built partly from substitutes: ${bad.map((r) => `${r.title.toLowerCase()} (${r.status})`).join(', ')}.` } : {}),
    vintage: { retrievedAt: i.now, retrievedBasis: 'generated', versionNote: 'Fuel class and accumulation tables are compiled into the app (Olson curves per class, OFHAG hazard scores, Vesta Mk2 inputs).' },
    extent: extentOf(i.centre, i.extentM),
    coverage: { fraction: 1 },
    model: { resolutionM: g.cellSize, width: g.nx, height: g.ny, cells: g.nx * g.ny, resampling: 'none' },
    sizes: { transferredBytes: 0, networkBytes: 0, cachedBytes: 0, requests: 0, memoryBytes: memory, ...(i.timingMs !== undefined ? { durationMs: i.timingMs } : {}) },
    stats: [...fs.stats, ...i.fuel.sources.map((s) => textStat('Source line', s))],
    distribution: fs.distribution,
    layer: { overlay: 'fuelLoad', layerId: 'fuelLoad' },
    evidence: { level: 'modelled', note: 'Fuel loads and hazard scores come from published fuel tables and accumulation curves applied to the mapped vegetation and fire history; many class values are FireSim design choices marked [H] in the spec.', specRef: 'docs/research/00-synthesis.md §4.5, §4.7' },
    warnings: [],
    limitations: [
      'Every error in the vegetation map, canopy height, fire history and drought state flows into the fuel map.',
      'Grass curing comes from a monthly table adjusted for height and drought, not from satellite curing.',
      'Fuel is a cell average: a fuel break or wet gully narrower than a cell is only flagged.',
      'Your fuel edits are applied to a copy during the run and listed under Your input.',
    ],
    parts,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The user's own input
// ─────────────────────────────────────────────────────────────────────────────

export interface UserInputs {
  now: number;
  edits: readonly ScenarioEdit[];
  ignitions: readonly Ignition[];
  weatherKind: string;
  /** Number of belt-kit readings entered in Setup. */
  beltReadings: number;
}

/** What the user typed, marked or painted. Pure: call it again after the user edits to refresh the record. */
export function userEditsRecord(u: UserInputs): DatasetRecord {
  const fuel = u.edits.filter((e) => e.kind === 'fuel').length;
  const wind = u.edits.filter((e) => e.kind === 'wind').length;
  const manual = u.weatherKind === 'manual' || u.weatherKind === 'belt-kit';
  const any = fuel + wind + u.ignitions.length > 0 || manual || u.beltReadings > 0;
  const stats: DatasetStat[] = [
    stat('Fuel edits (paint, time since fire, hazard)', fuel, ''),
    stat('Wind edits (including from belt kit readings)', wind, ''),
    stat('Ignitions and spot fires you marked', u.ignitions.length, ''),
    stat('Belt weather kit readings', u.beltReadings, ''),
    textStat('Weather', manual ? 'typed or from a belt kit' : 'not typed'),
  ];
  return skeleton({
    id: 'user-edits',
    role: 'user',
    title: 'Your input',
    what: 'Everything you typed, marked or painted: weather readings, ignitions, fuel and wind edits.',
    why: 'Your changes override the data: they are applied on top of the fuel map, the wind and the weather, and recorded so a run can be reproduced.',
    provider: PROVIDERS.user,
    licence: LICENCES.user,
    attribution: 'Entered by the user',
    endpoints: [],
    sourceServices: [],
    format: 'Scenario edits (JSON)',
    kind: 'table',
    status: any ? 'user' : 'skipped',
    origin: any ? 'user' : 'none',
    vintage: { retrievedAt: u.now, retrievedBasis: 'generated' },
    coverage: { fraction: any ? 1 : 0 },
    sizes: { transferredBytes: 0, networkBytes: 0, cachedBytes: 0, requests: 0, records: u.edits.length + u.ignitions.length },
    stats,
    evidence: { level: 'assumed', note: 'Whatever you entered is taken as true.' },
    warnings: [],
    limitations: ['Edits are not checked against the data: a painted road or a typed drought factor is used as given.'],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundled package
// ─────────────────────────────────────────────────────────────────────────────

/** The bundled demo-site files this scenario read, as one record (sizes are counted under the data sets that read them). */
export function bundleRecord(i: { now: number; centre: LatLon; extentM: number; sites: readonly string[]; bundle: BundleManifest | null; ledger: DatasetLedger; replayId?: string }): DatasetRecord | null {
  const sites = [...new Set(i.sites)].filter((s) => i.bundle?.sites[s]);
  if (!sites.length && !i.replayId) return null;
  const parts: DatasetPart[] = [];
  let total = 0;
  let latest = '';
  for (const s of sites) {
    for (const [name, f] of Object.entries(i.bundle!.sites[s]!.files)) {
      parts.push({ label: `${s}/${name}`, bytes: f.bytes, origin: 'bundled', ...(f.capturedOn ? { note: `captured ${f.capturedOn}` } : {}), ...(f.count ? { count: f.count } : {}) });
      total += f.bytes;
      if (f.capturedOn && f.capturedOn > latest) latest = f.capturedOn;
    }
  }
  const read = i.ledger.totals().bundledBytes;
  const earliest = parts.reduce((m, p) => {
    const d = /captured (\d{4}-\d{2}-\d{2})/.exec(p.note ?? '')?.[1];
    return d && (!m || d < m) ? d : m;
  }, '');
  return skeleton({
    id: 'bundled-site',
    role: 'bundle',
    title: `Bundled demo site${sites.length > 1 ? 's' : ''}: ${sites.join(', ')}`,
    what: 'Terrain, aerial photo, canopy, vegetation, fire history and roads captured from the NSW services and shipped inside the app, so demo sites work with no signal.',
    why: 'Lets you train offline. The files were captured from the services before the app was built and are shipped as they were: they are never refreshed while you use the app.',
    provider: PROVIDERS.app,
    licence: { name: 'Each file keeps the licence of the service it came from (CC BY 4.0, see the data sets)' },
    attribution: ATTRIBUTION.app,
    endpoints: [],
    sourceServices: [],
    format: 'Files under public/demo (PNG, JPEG, GeoJSON, JSON)',
    kind: 'table',
    status: 'used',
    origin: 'bundled',
    originDetail: earliest && latest ? `Files captured ${earliest === latest ? earliest : `${earliest} to ${latest}`} and shipped inside the app` : 'Shipped inside the app',
    vintage: { retrievedAt: dateMs(latest), retrievedBasis: latest ? 'bundle-capture' : 'unknown', ...(latest ? { capturedOn: latest } : {}), capturedNote: earliest && earliest !== latest ? `Files were fetched on different days, from ${earliest} to ${latest}.` : 'The day the files were fetched from their services.' },
    extent: extentOf(i.centre, i.extentM),
    coverage: { fraction: 1 },
    sizes: { transferredBytes: 0, networkBytes: 0, cachedBytes: 0, requests: 0 },
    stats: [
      textStat('Whole bundle for the site' + (sites.length > 1 ? 's' : ''), formatBytes(total)),
      textStat('Read for this scenario', formatBytes(read), 'The sizes are counted under the data sets that read them, so they are not added again here.'),
      stat('Files', parts.length, ''),
    ],
    evidence: { level: 'measured', note: 'The files are copies of the services’ data at the capture date.' },
    warnings: [],
    limitations: ['Bundled data are a snapshot: fires, roads and buildings since the capture date are not in them.', 'The elevation model is a 5 m grid from a 2019-era service resampled to 10 m; the aerial photo is a mosaic of several years.'],
    parts,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuel moisture at the start of the run (worker output)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Litter moisture at the start, from the first snapshot the worker sends (`SimSnapshot.moisture`, %). The moisture model
 * runs in the worker after the build, so this record cannot exist at build time: the session appends it with
 * `withRecord(scenario, describeStartMoisture(...))` when the first snapshot arrives.
 */
export function describeStartMoisture(o: { moisture: ArrayLike<number>; now: number; centre: LatLon; extentM: number; kbdi?: number; droughtFactor?: number; cellSizeM: number; nx: number; ny: number }): DatasetRecord {
  const ms = moistureStats(o.moisture);
  const f: MoistureFacts = ms.facts;
  return skeleton({
    id: 'fuel-moisture',
    role: 'derived',
    title: 'Fuel moisture at the start',
    what: 'How wet the dead leaf litter is in every cell at the start, spun up from a week of weather before it.',
    why: 'Wetter litter burns slowly or not at all; drier litter catches embers easily. It changes hour by hour with sun, shade, humidity and rain.',
    provider: PROVIDERS.app,
    licence: LICENCES.app,
    attribution: ATTRIBUTION.app,
    endpoints: [],
    sourceServices: [],
    format: 'Float32 grid on the fire grid (percent of dry weight)',
    kind: 'derived',
    status: 'used',
    origin: 'derived',
    originDetail: 'Computed in the simulation worker from the weather, terrain and fuel',
    vintage: { retrievedAt: o.now, retrievedBasis: 'generated' },
    extent: extentOf(o.centre, o.extentM),
    coverage: { fraction: 1 },
    model: { resolutionM: o.cellSizeM, width: o.nx, height: o.ny, cells: o.nx * o.ny, resampling: 'none' },
    sizes: { transferredBytes: 0, networkBytes: 0, cachedBytes: 0, requests: 0, memoryBytes: o.nx * o.ny * 4 },
    stats: [...ms.stats, ...(o.kbdi !== undefined ? [stat('Drought index used (KBDI)', o.kbdi, '', 0)] : []), ...(o.droughtFactor !== undefined ? [stat('Drought factor used', o.droughtFactor, '', 1)] : []), textStat('Median litter moisture', `${num(f.median, 1)} %`)],
    layer: { overlay: 'moisture', layerId: 'moisture' },
    evidence: { level: 'calibrated', note: 'A dead-fuel moisture model with time lags, tuned to published Australian fuel-moisture studies.', specRef: 'docs/research/04-fuel-moisture.md' },
    warnings: [],
    limitations: ['The model knows the weather at one point and the terrain: it cannot see a spring or a shaded patch it has no map of.'],
  });
}

export { formatCount };
