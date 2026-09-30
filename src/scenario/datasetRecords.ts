/**
 * Data-set records (core/datasets.ts) for the map data of a scenario: terrain, aerial imagery, vegetation, canopy height
 * and fire history. Weather, drought and upper air are in datasetRecordsWeather.ts, the places layers, the derived fuel
 * map, the user's edits and the bundle in datasetRecordsPlaces.ts; scenario/build.ts assembles them all.
 *
 * Every number comes from the finished grids (datasetStats.ts), the request ledger (bytes, requests, times) or the
 * loaders' own reports (origin, site, tile counts). The only typed-in text is the documented static facts: provider and
 * licence names, service copyright text, format names and the plain-English explanations.
 */
import { formatBytes, formatPercent, type DatasetOrigin, type DatasetPart, type DatasetRecord, type DatasetStat } from '../core/datasets';
import type { FireHistoryRecord, FuelMap, LatLon, Terrain } from '../core/types';
import { FireHistoryKind } from '../core/types';
import type { BundleManifest, DatasetLedger } from '../data';
import { bundleFile, CHM_SOURCE, DEM5M_SOURCE, TERRARIUM_SOURCE } from '../data';
import type { ParsedFireHistory } from '../fuel/history';
import { SVTM_SOURCE } from '../fuel/svtm';
import type { ImageryInfo } from './imagery';
import { CANOPY_TAG, FIRE_HISTORY_TAG, VEGETATION_TAG, type CanopyLayer, type LayerOrigin, type VectorLayer } from './layers';
import { MESSAGES } from './messages';
import { canopyStats, fireHistoryStats, fuelStats, num, shareStat, stat, terrainStats, textStat, vegetationStats } from './datasetStats';
import { ATTRIBUTION, CC_BY_4, COPIES, LICENCES, PROVIDERS, endpoint, endpointsOf, extentOf, overlapShare, ownArrayBytes, skeleton, sizesOf, sumTotals, typedBytes, vintageFor, day } from './recordKit';
import { DEMO_EXTENT_M, DEMO_SITES } from '../data';
import type { HiResResult } from './terrain';
import { TERRAIN_TAG } from './terrain';

/** Everything the map-data record builders read. */
export interface MapInputs {
  ledger: DatasetLedger;
  bundle: BundleManifest | null;
  now: number;
  centre: LatLon;
  extentM: number;
  fireCellM: number;
  online: boolean;
  demoSiteId?: string;
  terrain: Terrain;
  hiRes: { grid: { nx: number; ny: number; cellSize: number }; elevation: Float32Array };
  hi: HiResResult;
  localRelief?: Float32Array;
  imagery: ImageryInfo | null;
  canopy: CanopyLayer;
  veg: VectorLayer;
  vegPolygons: number;
  fh: VectorLayer;
  parsedHistory: ParsedFireHistory | null;
  fuel: FuelMap;
  includedFires: readonly FireHistoryRecord[];
  activeFires: readonly FireHistoryRecord[];
  /** Wall times (ms) of the build steps. */
  timings: Partial<Record<'terrain' | 'imagery' | 'canopy' | 'vegetation' | 'fireHistory', number>>;
  /** Build warnings each loader raised. */
  warnings: { terrain: string[]; canopy: string[]; vegetation: string[]; fireHistory: string[] };
}

const PROVIDER_ROOT = 'https://creativecommons.org/licenses/by/4.0/';
void PROVIDER_ROOT;

/** Data-set origin of a loader's layer origin; a 'network' answer that was really a stored copy (download failed) counts as 'cache'. */
export function originOf(o: LayerOrigin, ledger: DatasetLedger | undefined, tags: readonly string[]): DatasetOrigin {
  switch (o) {
    case 'demo':
      return 'bundled';
    case 'pack':
      return 'area-pack';
    case 'cache':
      return 'cache';
    case 'none':
      return 'none';
    case 'network': {
      const t = sumTotals(ledger, tags);
      return t.bySource.network === 0 && t.bySource.cache + t.bySource.stale > 0 ? 'cache' : 'live';
    }
  }
}

const capturedOf = (m: BundleManifest | null, siteId: string | undefined, file: string): string | undefined => (siteId ? bundleFile(m, siteId, file)?.capturedOn : undefined);

/** Ground metres per Terrarium pixel at a latitude and zoom. */
const terrariumPixelM = (latDeg: number, z: number): number => (Math.cos((latDeg * Math.PI) / 180) * 2 * Math.PI * 6378137) / (256 * 2 ** z);

// ─────────────────────────────────────────────────────────────────────────────
// Terrain
// ─────────────────────────────────────────────────────────────────────────────

export function terrainRecord(i: MapInputs): DatasetRecord {
  const { hi, terrain, ledger } = i;
  const info = hi.info;
  const t = sumTotals(ledger, [TERRAIN_TAG]);
  const g = terrain.grid;
  const cells = g.nx * g.ny;
  const b = Math.round(g.cellSize / i.hiRes.grid.cellSize);
  const hiCells = i.hiRes.grid.nx * i.hiRes.grid.ny;
  const st = terrainStats(terrain, { ...(i.localRelief ? { localRelief: i.localRelief } : {}), ...(info.tiles ? { seaOrNoDataCells: info.tiles.seaOrNoDataCells } : {}) });
  const memory = (ownArrayBytes(terrain) + typedBytes(i.hiRes.elevation)) * COPIES;
  const durationMs = i.timings.terrain ?? info.durationMs;
  const model = { resolutionM: g.cellSize, width: g.nx, height: g.ny, cells, resampling: 'block-average' as const, note: `A ${i.hiRes.grid.cellSize} m grid (${i.hiRes.grid.nx} x ${i.hiRes.grid.ny}) drives the 3-D view and is averaged ${b} x ${b} into each fire cell; slope, aspect and landforms are worked out on the fire grid.` };
  const stats: DatasetStat[] = [];
  const parts: DatasetPart[] = [];
  const common = {
    id: 'terrain',
    role: 'terrain' as const,
    title: 'Ground height',
    why: 'Gives every fire cell its slope and the direction it faces (fire runs much faster uphill), shelters and channels the wind, and decides which slopes the sun reaches.',
    layer: { overlay: 'elevation', layerId: 'elevation' },
    extent: extentOf(i.centre, i.extentM),
    model,
  };
  let rec: DatasetRecord;

  if (hi.origin === 'lidar' && info.lidar) {
    const m = info.lidar.meta;
    const site = hi.siteId;
    const cap = m.capturedOn ?? capturedOf(i.bundle, site, 'dem5m.png');
    parts.push({ label: 'dem5m.png (height image)', bytes: info.lidar.pngBytes, origin: 'bundled' }, { label: 'dem5m.json (details)', bytes: info.lidar.jsonBytes, origin: 'bundled' });
    stats.push(
      textStat('Published resolution', `${m.cellSize === 10 ? '5 m posts, bundled at 10 m' : `${m.cellSize} m`}`),
      textStat('Bundled image', `${m.n} x ${m.n} pixels, ${formatBytes(info.lidar.pngBytes)}`),
      ...(m.minElevation !== undefined && m.maxElevation !== undefined ? [textStat('Range in the bundled image', `${num(m.minElevation)} to ${num(m.maxElevation)} m (whole 9 km square)`)] : []),
      stat('No-data pixels in the bundled image', m.nodataCount ?? 0, ''),
    );
    rec = skeleton({
      ...common,
      what: `A 5 m elevation model of New South Wales from NSW Spatial Services, bundled with the app for the demo site '${site}' and resampled to a ${m.cellSize} m grid.`,
      provider: PROVIDERS.spatial,
      licence: LICENCES.ccBy,
      attribution: ATTRIBUTION.spatial,
      format: `PNG image, height stored in the red, green and blue channels (Terrarium encoding), ${m.n} x ${m.n} pixels`,
      kind: 'raster',
      status: 'used',
      origin: 'bundled',
      originDetail: `Bundled demo site '${site}'`,
      vintage: vintageFor('bundled', t, i.now, {
        bundleCapturedOn: cap,
        capturedNote: `The service's copyright notice reads '${(m as { serviceCopyright?: string }).serviceCopyright ?? 'DFSI 2019'}'. Survey dates are not part of the bundled data.`,
      }),
      crs: { native: 'EPSG:3857 (Web Mercator), 5 m post spacing', toModel: `Resampled (bilinear) to a ${m.cellSize} m grid of metres east and north of the site centre (an equirectangular projection), then block-averaged to the fire grid.` },
      coverage: { fraction: 1 },
      native: { resolutionM: 5, width: m.n, height: m.n, cells: m.n * m.n, note: `Published on a 5 m grid; the copy shipped with the app was resampled to ${m.cellSize} m.` },
      sizes: sizesOf(t, { decodedBytes: m.n * m.n * 4, memoryBytes: memory, durationMs, tiles: 0 }),
      evidence: {
        level: 'measured',
        note: "Heights come from the NSW statewide 5 m elevation model. The service describes it as 'derived from stereo imagery' (not LiDAR), so under tall forest it can follow the treetops and understate how deep gullies are.",
        specRef: 'docs/research/08-data-sources-apis.md §3.5',
      },
      limitations: [
        "The NSW_5M_Elevation service says its heights are 'derived from stereo imagery'. This app once called them LiDAR bare earth; the service does not say that.",
        `Averaged into ${g.cellSize} m cells, so cliffs and narrow gullies are softened. The 'very steep ground inside cells' figures show how much is hidden.`,
        'Bundled at 10 m: the 5 m detail of the source is not in the app.',
      ],
      sourceServices: [endpoint('maps.six.nsw.gov.au', '/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer', 'exportImage, F32 GeoTIFF in EPSG:3857')],
      endpoints: endpointsOf(ledger, [TERRAIN_TAG]),
      parts,
      stats: [...st.stats, ...stats],
      ...(st.distribution ? { distribution: st.distribution } : {}),
    });
  } else if (hi.origin === 'tiles' && info.tiles) {
    const tl = info.tiles;
    const lat = i.centre.lat;
    const px = terrariumPixelM(lat, tl.zoom);
    const bundled = tl.origins?.bundled ?? 0;
    const packed = tl.origins?.pack ?? 0;
    const cached = (tl.origins?.cache ?? 0) + (tl.origins?.stale ?? 0);
    const live = tl.origins?.network ?? 0;
    const origin: DatasetOrigin = live > 0 ? 'live' : cached > 0 ? 'cache' : packed > 0 ? 'area-pack' : 'bundled';
    if (bundled) parts.push({ label: 'Tiles bundled with the app', count: bundled, origin: 'bundled' });
    if (packed) parts.push({ label: 'Tiles from a saved area pack', count: packed, origin: 'area-pack' });
    if (cached) parts.push({ label: 'Tiles from stored copies', count: cached, origin: 'cache' });
    if (live) parts.push({ label: 'Tiles downloaded now', count: live, origin: 'live' });
    const warnings = [...i.warnings.terrain];
    const limitations = [
      'SRTM (radar, flown in February 2000) has about 30 m detail: it smooths gullies, ridges and cliffs, so slopes read gentler than the real ground.',
      'Radar heights can include some tree canopy.',
      'Tiles are cut at a fixed zoom: finer tiles add no new detail beyond the 30 m of the source.',
    ];
    if (tl.degradedFrom) limitations.push(`Zoom ${tl.degradedFrom} tiles were wanted but not available, so the coarser zoom ${tl.zoom} was used.`);
    const noDataShare = hiCells ? tl.seaOrNoDataCells / hiCells : 0;
    rec = skeleton({
      ...common,
      what: 'Satellite (SRTM, about 30 m) ground heights, cut into map tiles by Mapzen and hosted on AWS Open Data.',
      provider: PROVIDERS.awsTerrain,
      licence: LICENCES.publicDomain,
      attribution: ATTRIBUTION.terrarium,
      format: `Terrarium PNG tiles, 256 x 256 pixels, zoom ${tl.zoom} (height = red x 256 + green + blue / 256 - 32768 m)`,
      kind: 'raster',
      status: noDataShare > 0.02 ? 'partial' : 'used',
      origin,
      originDetail: [bundled ? `${bundled} tile${bundled === 1 ? '' : 's'} bundled${tl.sites?.length ? ` (${tl.sites.join(', ')})` : ''}` : '', packed ? `${packed} from area pack${tl.packs?.length ? ` '${tl.packs.join("', '")}'` : ''}` : '', cached ? `${cached} from stored copies` : '', live ? `${live} downloaded` : ''].filter(Boolean).join(', '),
      vintage: vintageFor(origin, t, i.now, {
        capturedNote: 'SRTM flew in February 2000. The tiles carry no newer survey.',
        ...(origin === 'bundled' ? { bundleCapturedOn: capturedOf(i.bundle, tl.sites?.[0], 'manifest.json') } : {}),
      }),
      crs: { native: `EPSG:3857 (Web Mercator) tiles, about ${num(px, 1)} m per pixel at zoom ${tl.zoom}`, toModel: `Bilinear sampling of the tile mosaic onto the ${i.hiRes.grid.cellSize} m local grid (metres east and north of the site centre), then block-averaged to the fire grid.` },
      coverage: { fraction: Math.max(0, 1 - noDataShare), ...(noDataShare > 0 ? { filledBy: 'sea level (0 m)', filledOrigin: 'synthetic' as const, note: 'Sea, deep water or no-data points are set to 0 m.' } : {}) },
      native: { resolutionM: Math.round(px * 10) / 10, width: 256, height: 256, note: 'The source data (SRTM) are about 30 m.' },
      sizes: sizesOf(t, { decodedBytes: tl.tiles * 256 * 256 * 4, memoryBytes: memory, durationMs, tiles: tl.tiles }),
      evidence: { level: 'measured', note: 'Radar-measured heights at about 30 m; coarse for mountain terrain.', specRef: 'docs/research/08-data-sources-apis.md §3.4' },
      warnings,
      limitations,
      sourceServices: [endpoint('s3.amazonaws.com', '/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', 'AWS Open Data Terrain Tiles')],
      endpoints: endpointsOf(ledger, [TERRAIN_TAG]),
      parts,
      stats: [
        ...st.stats,
        stat('Tiles', tl.tiles, '', 0, `Zoom ${tl.zoom}`),
        ...(tl.oldestCachedAt ? [textStat('Oldest stored tile downloaded', day(tl.oldestCachedAt))] : []),
      ],
      ...(st.distribution ? { distribution: st.distribution } : {}),
    });
  } else if (hi.origin === 'pack') {
    rec = skeleton({
      ...common,
      what: `A ${i.hiRes.grid.cellSize} m ground-height grid saved in an area pack for offline use.`,
      provider: PROVIDERS.app,
      licence: CC_BY_4,
      attribution: `${info.packSource ?? 'Elevation saved in an area pack'} (from your saved area pack '${info.packName ?? ''}')`,
      format: 'Float32 elevation grid saved in an area pack',
      kind: 'raster',
      status: 'used',
      origin: 'area-pack',
      originDetail: `Area pack '${info.packName ?? ''}'`,
      vintage: vintageFor('area-pack', t, i.now, {}),
      crs: { native: 'Local metres (the pack stores the grid it was built on)', toModel: 'Resampled (bilinear) onto the 10 m local grid, then block-averaged to the fire grid.' },
      coverage: { fraction: 1 },
      sizes: sizesOf(t, { memoryBytes: memory, durationMs }),
      evidence: { level: 'measured', note: `Heights as saved from: ${info.packSource ?? 'the source recorded in the pack'}.` },
      warnings: [...i.warnings.terrain],
      limitations: ['What the pack holds is a copy taken when you saved it; its own source and date are shown in the pack.'],
      endpoints: endpointsOf(ledger, [TERRAIN_TAG]),
      stats: st.stats,
      ...(st.distribution ? { distribution: st.distribution } : {}),
    });
  } else {
    rec = skeleton({
      ...common,
      what: 'An invented landscape, generated by the app because no real ground heights were available.',
      provider: PROVIDERS.app,
      licence: LICENCES.app,
      attribution: ATTRIBUTION.app,
      format: 'Procedurally generated height grid',
      kind: 'synthetic',
      status: 'fallback',
      origin: 'synthetic',
      originDetail: `Synthetic '${info.syntheticKind ?? 'escarpment'}' terrain`,
      fallbackReason: i.online ? 'The terrain tiles could not be downloaded and nothing stored covers this place.' : 'You are offline and no bundled, saved or stored terrain covers this place.',
      vintage: vintageFor('synthetic', t, i.now),
      coverage: { fraction: 0, filledBy: 'generated landscape', filledOrigin: 'synthetic' },
      sizes: sizesOf(t, { memoryBytes: memory, durationMs }),
      evidence: { level: 'synthetic', note: 'Not the real place: the slopes, gullies and ridges are made up.' },
      warnings: [MESSAGES.syntheticTerrain],
      limitations: ['This is NOT the real ground. Fire behaviour on it shows how fire behaves on this kind of terrain, not what would happen at this location.'],
      stats: st.stats,
      ...(st.distribution ? { distribution: st.distribution } : {}),
    });
  }
  // Keep the source strings the model uses visible.
  rec.stats.push(textStat('Model source text', terrain.source));
  void DEM5M_SOURCE;
  void TERRARIUM_SOURCE;
  return rec;
}

// ─────────────────────────────────────────────────────────────────────────────
// Imagery
// ─────────────────────────────────────────────────────────────────────────────

export function imageryRecord(i: MapInputs): DatasetRecord {
  const t = sumTotals(i.ledger, ['imagery']);
  const im = i.imagery;
  const base = {
    id: 'imagery',
    role: 'imagery' as const,
    title: 'Aerial photo',
    why: 'Draped over the ground so you can recognise the place (display only: it does not change fire behaviour).',
    layer: { layerId: 'imagery' },
    provider: PROVIDERS.spatial,
    licence: LICENCES.ccBy,
    sourceServices: [endpoint('maps.six.nsw.gov.au', '/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}', 'XYZ tiles, zoom 15')],
  };
  if (!im) {
    return skeleton({
      ...base,
      what: 'Aerial photographs of the area from NSW Spatial Services.',
      attribution: ATTRIBUTION.imagery,
      format: 'JPEG image',
      kind: 'raster',
      status: 'unavailable',
      origin: 'none',
      fallbackReason: 'Aerial photos are bundled only for the eight demo sites; none covers this place. The ground is drawn with the height colours instead.',
      vintage: vintageFor('none', t, i.now),
      coverage: { fraction: 0 },
      sizes: sizesOf(t, { durationMs: i.timings.imagery }),
      evidence: { level: 'measured', note: 'Not used in this scenario.' },
      limitations: ['Photos are not downloaded for other places; they are display only, so fire behaviour is unaffected.'],
    });
  }
  const m = im.meta;
  const cap = im.capturedOn ?? bundleFile(i.bundle, im.siteId, 'imagery.jpg')?.capturedOn;
  const cropShare = Math.min(1, (im.crop.sw * im.crop.sh) / (m.n * m.n));
  const bytes = im.jpgBytes + im.jsonBytes;
  return skeleton({
    ...base,
    what: `Aerial photographs (an 8 m mosaic) of the demo site '${im.siteId}', bundled with the app.`,
    attribution: ATTRIBUTION.imagery,
    format: `Progressive JPEG (quality 82), ${m.n} x ${m.n} pixels`,
    kind: 'raster',
    status: 'used',
    origin: 'bundled',
    originDetail: `Bundled demo site '${im.siteId}'`,
    vintage: vintageFor('bundled', t, i.now, {
      bundleCapturedOn: cap,
      capturedNote: `A mosaic of flights from several years: the service credits AAM 2011-12, Jacobs Group Ausimage 2002-2014 and Landsat 2014 among its sources, with a service copyright of '${im.serviceCopyright ?? '© Department of Customer Service 2020'}'. The newest imagery overlays the oldest, so parts of the photo may be years out of date.`,
    }),
    crs: { native: 'EPSG:3857 (Web Mercator) tiles at zoom 15', toModel: 'Area-averaged 2 x 2, then resampled (bilinear) onto an 8 m local grid; cropped to the model area.' },
    extent: extentOf(i.centre, i.extentM),
    coverage: { fraction: 1 },
    native: { resolutionM: m.cellSize, width: m.n, height: m.n, cells: m.n * m.n, note: 'Zoom-15 tiles are about 4 m per pixel; the bundled image is 8 m.' },
    model: { resolutionM: m.cellSize, width: im.drawnPx.w, height: im.drawnPx.h, resampling: 'bilinear', note: `Cropped to the model area and drawn at up to ${im.drawnPx.w} x ${im.drawnPx.h} pixels.` },
    sizes: sizesOf(t, {
      transferredBytes: t.bytes + im.jpgBytes,
      decodedBytes: im.drawnPx.w * im.drawnPx.h * 4,
      requests: t.requests + 1,
      durationMs: i.timings.imagery,
    }),
    evidence: { level: 'measured', note: 'Photographs, not a model. Capture dates vary across the image.', specRef: 'docs/research/08-data-sources-apis.md §3.7' },
    endpoints: [...endpointsOf(i.ledger, ['imagery']), endpoint('bundled', `/demo/${im.siteId}/imagery.jpg`, 'the photo, decoded by the 3-D view', 1)],
    parts: [
      { label: 'imagery.jpg (the photo)', bytes: im.jpgBytes, origin: 'bundled' },
      { label: 'imagery.json (details)', bytes: im.jsonBytes || undefined, origin: 'bundled' },
    ],
    stats: [
      textStat('Photo size', `${m.n} x ${m.n} pixels of ${m.cellSize} m`),
      textStat('Shown', `${im.drawnPx.w} x ${im.drawnPx.h} pixels (the model area only)`),
      shareStat('Share of the bundled photo used', cropShare),
      textStat('Files', formatBytes(bytes)),
    ],
    limitations: [
      'Display only: the photo does not change the simulation.',
      'Photos show the ground as it was when flown, which can be years ago; bushfires and clearing since then are not shown.',
      'Only the eight demo sites carry photos; other places show height colours instead.',
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Vegetation
// ─────────────────────────────────────────────────────────────────────────────

export function vegetationRecord(i: MapInputs): DatasetRecord {
  const { veg, ledger, fuel } = i;
  const t = sumTotals(ledger, [VEGETATION_TAG]);
  const origin = originOf(veg.origin, ledger, [VEGETATION_TAG]);
  const vs = vegetationStats(fuel);
  const fs = vs.facts;
  const g = fuel.grid;
  const site = veg.info.siteId;
  const cap = capturedOf(i.bundle, site, 'vegetation.geojson');
  const none = veg.origin === 'none' || i.vegPolygons === 0;
  const partial = !none && (veg.partial || fs.inferredShare > 0.05);
  const status = none ? 'fallback' : partial ? 'partial' : 'used';
  const coverage = none ? 0 : 1 - fs.inferredShare;
  const parts: DatasetPart[] = [];
  const bf = site ? bundleFile(i.bundle, site, 'vegetation.geojson') : undefined;
  if (origin === 'bundled' && bf) parts.push({ label: 'vegetation.geojson', bytes: bf.bytes, origin: 'bundled', count: bf.features });
  const features = veg.geojson?.features.length ?? 0;
  const stats: DatasetStat[] = [stat('Vegetation polygons in the data', features, ''), ...(features !== i.vegPolygons ? [stat('Polygon parts mapped', i.vegPolygons, '', 0, 'A polygon with several parts counts once as a polygon and once per part here.')] : []), ...vs.stats];
  if (veg.geojson?.clippedTo) stats.push(textStat('Bundled polygons clipped to', veg.geojson.clippedTo.map((v) => v.toFixed(4)).join(', ') + ' (west, south, east, north)'));
  const limitations = [
    'A statewide map of plant communities made from plots, imagery and models: each polygon is a best estimate for that patch, not a survey of your site.',
    'Polygons are generalised by the service (about 20 m) before they reach the app, so small patches such as a wet gully or a rock outcrop can be lost.',
    'Each cell takes the most common vegetation class of 9 sample points; a wet-gully strip narrower than a cell is only flagged, not mapped.',
    'It shows what grows there, not how much fuel there is now: fuel load also depends on the time since the last fire (fire history).',
  ];
  return skeleton({
    id: 'vegetation-svtm',
    role: 'vegetation',
    title: 'Vegetation map',
    what: 'The NSW State Vegetation Type Map: polygons of plant community types, grouped into vegetation classes.',
    why: 'Chooses the fuel class of every cell: how much litter, shrub and bark fuel there is, how fast it builds up after a fire and how it burns.',
    provider: PROVIDERS.dccceew,
    licence: LICENCES.ccBy,
    attribution: ATTRIBUTION.svtm,
    endpoints: endpointsOf(ledger, [VEGETATION_TAG]),
    sourceServices: [endpoint('mapprod3.environment.nsw.gov.au', '/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer/3/query', 'Plant Community Type with labels (layer 3)')],
    format: origin === 'bundled' ? 'GeoJSON polygons (PCTID, PCTName, vegClass, vegForm)' : 'ArcGIS REST query answered as GeoJSON polygons, paged by 1000',
    kind: 'vector',
    status,
    origin,
    originDetail: veg.source.replace(/^Vegetation \(NSW SVTM\): /, ''),
    ...(none ? { fallbackReason: 'No vegetation map could be read for this area, so fuel types are inferred from the terrain and the canopy height.' } : partial ? { fallbackReason: veg.partial ? 'The vegetation map covers only part of the area.' : `${formatPercent(fs.inferredShare)} of the cells are unmapped or 'Not classified' and were filled in from terrain and canopy.` } : {}),
    vintage: vintageFor(origin, t, i.now, {
      bundleCapturedOn: cap,
      version: SVTM_SOURCE.includes('C2.0') ? 'C2.0' : undefined,
      versionNote: 'A label kept by the app, not read from the service (the service publishes no version).',
    }),
    crs: { native: 'EPSG:4326 (longitude and latitude) polygons', toModel: 'Projected to metres east and north of the site centre and rasterised onto the fire grid.' },
    extent: extentOf(i.centre, i.extentM),
    coverage: { fraction: coverage, ...(coverage < 1 ? { filledBy: 'vegetation inferred from terrain and canopy', filledOrigin: 'derived' as const } : {}) },
    native: { features, records: i.vegPolygons, note: 'Polygons; the service generalises them to about 20 m.' },
    model: { resolutionM: g.cellSize, width: g.nx, height: g.ny, cells: g.nx * g.ny, resampling: 'rasterise', note: 'Nine sample points per cell; the most common class wins.' },
    sizes: sizesOf(t, { durationMs: i.timings.vegetation ?? veg.info.durationMs, features, records: i.vegPolygons, decodedBytes: t.bodyBytes || undefined }),
    stats,
    distribution: vs.distribution,
    layer: { overlay: 'fuelType', layerId: 'fuelType' },
    evidence: { level: 'modelled', note: 'A mapped estimate of plant communities, translated to fuel classes by a lookup table the app keeps.', specRef: 'docs/research/00-synthesis.md §4.2, §4.3' },
    warnings: [...i.warnings.vegetation],
    limitations,
    ...(parts.length ? { parts } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Canopy height
// ─────────────────────────────────────────────────────────────────────────────

export function canopyRecord(i: MapInputs): DatasetRecord {
  const { canopy, ledger, fuel } = i;
  const t = sumTotals(ledger, [CANOPY_TAG]);
  const c = canopy.canopy;
  const g = fuel.grid;
  const cs = canopyStats(fuel);
  const origin = originOf(canopy.origin, ledger, [CANOPY_TAG]);
  const site = c?.site ?? canopy.info.siteId;
  const cap = c?.capturedOn ?? capturedOf(i.bundle, site, 'canopy.png');
  const common = {
    id: 'canopy-height',
    role: 'canopy' as const,
    title: 'Tree canopy height',
    what: 'How tall the trees are, from the Meta and WRI High Resolution Canopy Height Maps (a 1 m map made from satellite imagery by a machine-learning model).',
    why: 'Sets how much wind the trees take out of the air near the ground, how far embers loft, and whether a fire can climb into the crowns.',
    provider: PROVIDERS.meta,
    licence: LICENCES.ccBy,
    attribution: ATTRIBUTION.meta,
    sourceServices: [endpoint('dataforgood-fb-data.s3.amazonaws.com', '/forests/v1/alsgedi_global_v6_float/chm/{quadkey}.tif', 'Cloud-Optimised GeoTIFF, 1.19 m pixels')],
    format: origin === 'bundled' ? 'PNG image: red = 90th percentile height (m), green = mean height (m), blue = cover x 255' : c?.via?.startsWith('remote') ? 'Cloud-Optimised GeoTIFF read in row ranges (uint8 metres)' : 'PNG image (canopy heights)',
    kind: 'raster' as const,
    extent: extentOf(i.centre, i.extentM),
    layer: { overlay: 'canopyHeight', layerId: 'canopyHeight' },
    evidence: { level: 'modelled' as const, note: 'Predicted from imagery by a neural network trained on airborne LiDAR; not a direct measurement of your trees.', specRef: 'docs/research/08-data-sources-apis.md §3.8' },
  };
  if (!c) {
    return skeleton({
      ...common,
      status: 'fallback',
      origin: 'none',
      fallbackReason: `No canopy map could be read (${canopy.info.remoteSkipped ?? 'nothing covers this place'}). Each cell uses the typical tree height of its vegetation type.`,
      vintage: vintageFor('none', t, i.now),
      coverage: { fraction: 0, filledBy: 'typical canopy height of the vegetation type', filledOrigin: 'derived' },
      sizes: sizesOf(t, { durationMs: i.timings.canopy ?? canopy.info.durationMs }),
      stats: cs.stats,
      warnings: [...i.warnings.canopy],
      limitations: [
        'Without a canopy map, tree height and cover come from a table of typical values for each vegetation class.',
        'Canopy is downloaded live only for areas of 3 km or less (the source is read a row at a time and is slow); larger areas need a demo site or a saved area pack.',
      ],
    });
  }
  const nativeM = c.nativeCellM ?? 20;
  const partial = c.coverage < 0.999;
  const bf = site ? bundleFile(i.bundle, site, 'canopy.png') : undefined;
  const parts: DatasetPart[] = [];
  if (origin === 'bundled' && bf) parts.push({ label: 'canopy.png', bytes: bf.bytes, origin: 'bundled' });
  if (c.cogTiles?.length) parts.push({ label: `COG tiles read (${c.cogTiles.join(', ')})`, count: c.cogTiles.length, origin });
  return skeleton({
    ...common,
    status: partial ? 'partial' : 'used',
    origin,
    originDetail: origin === 'bundled' ? `Bundled demo site '${site}' (20 m)` : origin === 'area-pack' ? `Area pack '${canopy.info.packName ?? ''}'` : c.via === 'remote-cache' ? 'Stored copy of an earlier download' : 'Downloaded now (Cloud-Optimised GeoTIFF row ranges)',
    ...(partial ? { fallbackReason: `Canopy height is measured on ${formatPercent(c.coverage)} of the area; the rest uses typical heights for the vegetation type.` } : {}),
    vintage: vintageFor(origin, t, i.now, {
      capturedOn: '2016',
      capturedNote: 'Built from Maxar imagery of about 2016 (per the map’s citation); trees may have grown, burnt or been cleared since.',
      bundleCapturedOn: cap,
      version: 'v1 (2024)',
    }),
    crs: { native: 'EPSG:3857 (Web Mercator), 1.19 m pixels', toModel: `Aggregated on a ${nativeM} m local grid (90th percentile height, mean height and cover of the 1 m pixels), then resampled onto the fire grid.` },
    coverage: { fraction: c.coverage, ...(partial ? { filledBy: 'typical canopy height of the vegetation type', filledOrigin: 'derived' as const } : {}) },
    native: { resolutionM: 1.19, note: `Source pixels about 1.19 m. ${origin === 'bundled' ? 'Bundled pre-aggregated to 20 m.' : `Read and aggregated on a ${nativeM} m grid.`}` },
    model: { resolutionM: g.cellSize, width: g.nx, height: g.ny, cells: g.nx * g.ny, resampling: nativeM < g.cellSize ? 'area-average' : 'bilinear', channels: ['90th percentile height (m)', 'mean height (m)', 'cover (share of 1 m pixels 2 m or taller)'] },
    sizes: sizesOf(t, { durationMs: i.timings.canopy ?? canopy.info.durationMs, decodedBytes: nativeM === 20 && bf ? 450 * 450 * 3 : undefined }),
    endpoints: endpointsOf(ledger, [CANOPY_TAG]),
    stats: [...cs.stats, textStat('Native cell of the data used', `${nativeM} m`), ...(c.cogTiles?.length ? [stat('Source tiles read', c.cogTiles.length, '')] : [])],
    ...(cs.distribution ? { distribution: cs.distribution } : {}),
    warnings: [...i.warnings.canopy],
    limitations: [
      'A model prediction: heights of tall eucalypt forest can be off by several metres.',
      'Built from imagery of about 2016: it does not show fires, logging or growth since.',
      'Cover is the share of 1 m pixels 2 m or taller, not a count of trees.',
    ],
    ...(parts.length ? { parts } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Fire history
// ─────────────────────────────────────────────────────────────────────────────

export function fireHistoryRecord(i: MapInputs): DatasetRecord {
  const { fh, ledger, fuel } = i;
  const t = sumTotals(ledger, [FIRE_HISTORY_TAG]);
  const origin = originOf(fh.origin, ledger, [FIRE_HISTORY_TAG]);
  const pf = i.parsedHistory;
  const site = fh.info.siteId;
  const hs = fireHistoryStats(fuel, { included: i.includedFires, activeFires: i.activeFires, ...(pf ? { rawFeatures: fh.geojson?.features.length ?? pf.records.length + pf.skipped, skipped: pf.skipped, verDate: pf.verDate } : {}) });
  const g = fuel.grid;
  const cap = capturedOf(i.bundle, site, 'fire-history.geojson');
  const verDay = pf?.verDate ? new Date(pf.verDate).toISOString().slice(0, 10) : undefined;
  const common = {
    id: 'fire-history',
    role: 'fireHistory' as const,
    title: 'Fire history',
    what: 'Outlines of past bushfires and prescribed burns from the NPWS Fire History layer, with the year and type of each.',
    why: 'Sets how long each patch of ground has gone without fire, and so how much litter and shrub fuel has built up (an Olson accumulation curve per fuel class).',
    provider: PROVIDERS.npws,
    licence: LICENCES.ccBy,
    attribution: ATTRIBUTION.npws,
    sourceServices: [endpoint('mapprod3.environment.nsw.gov.au', '/arcgis/rest/services/Fire/NPWS_Fire_History/MapServer/0/query', 'FireType 1 = wildfire, 2 = prescribed burn')],
    kind: 'vector' as const,
    extent: extentOf(i.centre, i.extentM),
    layer: { overlay: 'timeSinceFire', layerId: 'timeSinceFire' },
  };
  if (!pf) {
    return skeleton({
      ...common,
      format: 'GeoJSON polygons',
      status: 'unavailable',
      origin: 'none',
      fallbackReason: fh.warnings.length || fh.origin === 'none' ? 'No fire history could be read for this area. The model assumes every patch has had no fire for a long time (steady-state fuel).' : 'No fire history is available for this area.',
      vintage: vintageFor('none', t, i.now),
      coverage: { fraction: 0, filledBy: 'steady-state fuel (long unburnt)', filledOrigin: 'derived' },
      sizes: sizesOf(t, { durationMs: i.timings.fireHistory ?? fh.info.durationMs }),
      evidence: { level: 'assumed', note: 'With no record, fuel is assumed to have built up to its long-run level: usually the worst case for fuel load.', specRef: 'docs/research/00-synthesis.md §4.4' },
      stats: hs.stats,
      warnings: [...i.warnings.fireHistory, MESSAGES.fireHistoryUnavailable],
      limitations: ['Recent burns and fires are not reflected: fuel is treated as fully built up.'],
    });
  }
  const partial = fh.partial;
  const fhFeatures = fh.geojson?.features.length ?? pf.records.length + pf.skipped;
  const siteCentre = DEMO_SITES.find((x) => x.id === site)?.centre;
  const partialShare = siteCentre ? overlapShare(i.centre, i.extentM, siteCentre, DEMO_EXTENT_M) : 0.5;
  const bf = site ? bundleFile(i.bundle, site, 'fire-history.geojson') : undefined;
  return skeleton({
    ...common,
    format: origin === 'bundled' ? 'GeoJSON polygons (whole fire perimeters that touch the area)' : 'ArcGIS REST query answered as GeoJSON polygons',
    status: partial ? 'partial' : 'used',
    origin,
    originDetail: fh.source.replace(/^Fire history \(NPWS\): /, ''),
    ...(partial ? { fallbackReason: 'The fire history covers only part of the area; elsewhere steady-state fuel is assumed.' } : {}),
    vintage: vintageFor(origin, t, i.now, { bundleCapturedOn: cap, ...(verDay ? { currentTo: verDay } : {}) }),
    crs: { native: 'EPSG:4326 (longitude and latitude) polygons', toModel: 'Projected to metres east and north of the site centre and rasterised onto the fire grid at the scenario start time.' },
    coverage: { fraction: partial ? partialShare : 1, ...(partial ? { filledBy: 'steady-state fuel (long unburnt)', filledOrigin: 'derived' as const } : {}), note: 'Cells with no fire on record are counted as covered: an empty cell is a real answer.' },
    native: { features: fhFeatures, records: pf.records.length, note: `${pf.records.length} fire outlines used${pf.skipped ? `, ${pf.skipped} skipped` : ''}.` },
    model: { resolutionM: g.cellSize, width: g.nx, height: g.ny, cells: g.nx * g.ny, resampling: 'rasterise', note: 'The newest fire before the start covering a cell sets its time since fire; earlier fires count towards fire frequency.' },
    sizes: sizesOf(t, { durationMs: i.timings.fireHistory ?? fh.info.durationMs, features: fhFeatures, records: pf.records.length, decodedBytes: t.bodyBytes || undefined, memoryBytes: (typedBytes(fuel.timeSinceFire, fuel.lastFireKind, fuel.fireCount30, fuel.fireCountTfi) ) * COPIES }),
    endpoints: endpointsOf(ledger, [FIRE_HISTORY_TAG]),
    stats: hs.stats,
    ...(hs.distribution ? { distribution: hs.distribution } : {}),
    evidence: { level: 'measured', note: 'Mapped fire outlines. Prescribed-burn effect on fuel is modelled; the outline itself is a record.', specRef: 'docs/research/08-data-sources-apis.md §3.11' },
    warnings: [...i.warnings.fireHistory],
    limitations: [
      'Covers the national-park estate and the fires NPWS mapped: hazard-reduction burns on RFS, forestry and private land may be missing.',
      'A burn outline says where fire went, not how severe it was: a patchy burn is treated as a full fuel reset only where the model says so.',
      "Undated fires use the middle of their fire season.",
      `Counted: wildfires ${formatPercent(hs.facts.wildfireShare)} and prescribed burns ${formatPercent(hs.facts.prescribedShare)} of the cells.`,
    ],
    ...(bf ? { parts: [{ label: 'fire-history.geojson', bytes: bf.bytes, origin: 'bundled' as const, count: bf.features }] } : {}),
  });
}

/** Fuel derived from the four map data sets (see datasetRecordsPlaces.ts fuelRecord). Exported for build.ts to call in order. */
export function mapRecords(i: MapInputs): DatasetRecord[] {
  return [terrainRecord(i), imageryRecord(i), vegetationRecord(i), canopyRecord(i), fireHistoryRecord(i)];
}

// Keep imports referenced for documentation of the source constants the records rely on.
void CHM_SOURCE;
void FireHistoryKind;
void fuelStats;
