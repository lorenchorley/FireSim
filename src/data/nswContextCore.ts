/**
 * The pure half of the NSW "places" context (roads, fire trails, homes, zones, place names): which service layers are
 * queried and how, how raw ArcGIS features are classified, and how they are packed into the version-1 file that
 * `contextLayers.ts` decodes.
 *
 * It is shared, not copied: `scripts/fetch-demo-context.mjs` (Node, bundled demo sites) imports this file directly
 * (Node strips the types), and `nswContext.ts` (live queries anywhere in NSW, in the browser or on device) imports it
 * too, so both produce byte-identical files for the same envelope. For that reason this file must stay
 * **erasable TypeScript with no runtime imports** (no enums, no parameter properties, only `import type`).
 */
import type { ContextSource, PlaceKind, RoadClass, ZoneKind } from '../core/places';
import type { ContextFileV1 } from './contextLayers';

// ─────────────────────────────────────────────────────────────────────────────
// Services and queries
// ─────────────────────────────────────────────────────────────────────────────

/** NSW Spatial Services portal (roads, fire trails, addresses, places, suburbs). CORS enabled. */
export const NSW_SPATIAL_BASE = 'https://portal.spatial.nsw.gov.au';
/** NSW Planning (ePlanning land zoning) is served by the NSW Environment ArcGIS host. CORS enabled. */
export const NSW_PLANNING_BASE = 'https://mapprod3.environment.nsw.gov.au';

/** The six layers queried (`places` and `suburbs` together make the context `places`). */
export type ContextQueryId = 'roads' | 'fireTrails' | 'homes' | 'zones' | 'places' | 'suburbs';

export interface ContextQuery {
  id: ContextQueryId;
  /** Which host serves the layer (the ServiceId of data/http.ts). */
  service: 'nswspatial' | 'nswenv';
  /** Layer path from the service root; the query is `<path>/query`. */
  path: string;
  outFields: string;
  where: string;
  /** `maxAllowableOffset` (degrees): the server generalises geometry to this tolerance (0 = full detail, points). */
  offset: number;
  /** Object ids per feature request (servers cap the records and the size of one response; polygons are heavy). */
  chunk: number;
  /**
   * How long one request may take before it is abandoned and retried (ms). Measured 2026-09-29: the portal answers in
   * 0.5-2 s but about one request in three STALLS (no answer for 25-60 s, then HTTP 504) and the same request answers at
   * once when repeated, so a short timeout with retries is much faster than waiting; the zoning server really needs
   * 4-10 s for a 2-7 km area.
   */
  timeoutMs: number;
}

const SS = '/server/rest/services';
const PLAN = '/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer';

export const CONTEXT_QUERIES: Readonly<Record<ContextQueryId, ContextQuery>> = {
  roads: {
    id: 'roads',
    service: 'nswspatial',
    path: `${SS}/NSW_Transport_Theme/FeatureServer/5`,
    outFields: 'roadnamebase,roadnametype,roadnamesuffix,functionhierarchy,surface,roadontype,operationalstatus',
    where: 'operationalstatus=1',
    offset: 0.00002,
    chunk: 400,
    timeoutMs: 10_000,
  },
  fireTrails: { id: 'fireTrails', service: 'nswspatial', path: `${SS}/NSW_Transport_Theme/FeatureServer/9`, outFields: 'objectid', where: '1=1', offset: 0.00002, chunk: 400, timeoutMs: 10_000 },
  homes: { id: 'homes', service: 'nswspatial', path: `${SS}/NSW_Geocoded_Addressing_Theme/FeatureServer/1`, outFields: 'rid', where: '1=1', offset: 0, chunk: 800, timeoutMs: 10_000 },
  zones: { id: 'zones', service: 'nswenv', path: `${PLAN}/19`, outFields: 'SYM_CODE,LAY_CLASS,LGA_NAME', where: '1=1', offset: 0.00005, chunk: 100, timeoutMs: 20_000 },
  places: { id: 'places', service: 'nswspatial', path: `${SS}/NSW_Features_of_Interest_Category/FeatureServer/1`, outFields: 'generalname,placetype', where: '1=1', offset: 0, chunk: 400, timeoutMs: 10_000 },
  suburbs: { id: 'suburbs', service: 'nswspatial', path: `${SS}/NSW_Administrative_Boundaries_Theme/FeatureServer/2`, outFields: 'suburbname', where: '1=1', offset: 0.0005, chunk: 50, timeoutMs: 10_000 },
};

export const CONTEXT_QUERY_IDS: readonly ContextQueryId[] = ['roads', 'fireTrails', 'homes', 'zones', 'places', 'suburbs'];

/** Absolute URL of a layer (recorded in the file's `sources`). */
export const contextLayerUrl = (q: ContextQuery): string => (q.service === 'nswenv' ? NSW_PLANNING_BASE : NSW_SPATIAL_BASE) + q.path;

/** Distance beyond the domain covered by the query so lines and zones reach the edge of any domain at the site (m). */
export const CONTEXT_MARGIN_M = 400;
/** File coordinates are integers in units of 1/Q degrees (~1 m). */
export const CONTEXT_Q = 1e5;

/** The `context source` ids a failed query affects (places and suburbs are one source). */
export const sourceOfQuery = (id: ContextQueryId): ContextSource['id'] => (id === 'suburbs' ? 'places' : id);

// ─────────────────────────────────────────────────────────────────────────────
// Query envelope
// ─────────────────────────────────────────────────────────────────────────────

export type BBox = [west: number, south: number, east: number, north: number];

/** Envelope (degrees) of the square of side `extentM` around a point, plus `marginM` on every side. */
export function contextBBox(lat: number, lon: number, extentM: number, marginM: number = CONTEXT_MARGIN_M): BBox {
  const dLat = (extentM / 2 + marginM) / 111195;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/** The `geometry` parameter of an envelope query (0.1 m precision keeps the request text stable). */
export const envelopeParam = (b: BBox): string => b.map((v) => v.toFixed(6)).join(',');

/** Form fields of the "which object ids intersect the envelope" query. */
export function idsQueryForm(q: ContextQuery, bbox: BBox): Record<string, string> {
  return {
    geometry: envelopeParam(bbox),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: q.where,
    returnIdsOnly: 'true',
    f: 'json',
  };
}

/** Form fields of the "give me these features" query (one chunk of object ids). */
export function featuresQueryForm(q: ContextQuery, ids: readonly number[]): Record<string, string> {
  return {
    objectIds: ids.join(','),
    outFields: q.outFields,
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: String(q.offset),
    geometryPrecision: '5',
    f: 'json',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

/** NSW road-segment "function hierarchy" → display class. */
export const ROAD_CLASS: Readonly<Record<number, RoadClass>> = { 1: 'motorway', 2: 'primary', 3: 'arterial', 4: 'subarterial', 5: 'distributor', 6: 'local', 7: 'service', 8: 'track', 9: 'path', 10: 'local', 11: 'service' };
/** NSW road-segment surface code → 0 unknown, 1 sealed, 2 unsealed, 3 unsealed 4WD only. */
export const SURFACE: Readonly<Record<number, 0 | 1 | 2 | 3>> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 3 };

export const roadClassOf = (functionHierarchy: unknown): RoadClass => ROAD_CLASS[functionHierarchy as number] ?? 'local';
export const surfaceOf = (surface: unknown): 0 | 1 | 2 | 3 => SURFACE[surface as number] ?? 0;

/**
 * "MEGALONG" → "Megalong", "MCKENZIE" → "McKenzie", "O'GRADYS HUT" → "O'Gradys Hut"; a possessive keeps its s
 * ("GOVETT'S LEAP" → "Govett's Leap").
 */
export function titleCase(s: string): string {
  const lower = s.toLowerCase();
  return lower
    .replace(/\b([a-z])/g, (m, _c: string, at: number) => {
      if (at > 0 && lower[at - 1] === "'") {
        // Capitalise after an apostrophe only in a one-letter prefix (O'Grady, D'Aguilar), never a possessive.
        const prefix = at >= 2 && /[a-z]/.test(lower[at - 2]!) && (at === 2 || !/[a-z]/.test(lower[at - 3]!));
        if (!prefix) return m;
      }
      return m.toUpperCase();
    })
    .replace(/\bMc([a-z])/g, (_, c: string) => `Mc${c.toUpperCase()}`);
}

/** "Megalong Road", "Great Western Highway", … or undefined for unnamed tracks. */
export function roadName(a: Record<string, unknown>): string | undefined {
  if (!a['roadnamebase']) return undefined;
  return titleCase([a['roadnamebase'], a['roadnametype'], a['roadnamesuffix']].filter(Boolean).join(' '));
}

/** Zone code → display kind. Only the kinds a firefighter uses to read "where people live and work" are kept. */
export function zoneKind(code: string): ZoneKind | null {
  if (/^R[1-5]$/.test(code)) return 'residential';
  if (code === 'RU5') return 'village';
  if (code === 'C4') return 'envLiving';
  if (/^RU[46]$/.test(code)) return 'ruralSmall';
  if (/^(B\d|E1|E2|MU1)$/.test(code)) return 'commercial';
  if (/^(IN\d|E3|E4|E5)$/.test(code)) return 'industrial';
  if (code === 'SP3') return 'tourist';
  return null;
}

export const PLACE_KIND: Readonly<Record<number, PlaceKind>> = { 1: 'region', 2: 'city', 3: 'town', 4: 'village', 5: 'locality', 6: 'suburb' };
export const placeKindOf = (placetype: unknown): PlaceKind => PLACE_KIND[placetype as number] ?? 'locality';

// ─────────────────────────────────────────────────────────────────────────────
// Encoding
// ─────────────────────────────────────────────────────────────────────────────

const qi = (v: number): number => Math.round(v * CONTEXT_Q);

/** Delta-code a polyline (or point list): [x0, y0, dx1, dy1, ...] in 1e-5 degrees; repeated points are dropped. */
export function encodeLine(points: readonly (readonly number[])[]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  points.forEach(([x, y], i) => {
    const X = qi(x!);
    const Y = qi(y!);
    if (i === 0) out.push(X, Y);
    else if (X !== px || Y !== py) out.push(X - px, Y - py);
    px = X;
    py = Y;
  });
  return out;
}

/** Centroid of a ring (shoelace); the first vertex for a degenerate ring. */
export function ringCentroid(ring: readonly (readonly number[])[]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % n]!;
    const f = x0! * y1! - x1! * y0!;
    a += f;
    cx += (x0! + x1!) * f;
    cy += (y0! + y1!) * f;
  }
  a *= 0.5;
  return Math.abs(a) < 1e-12 ? [ring[0]![0]!, ring[0]![1]!] : [cx / (6 * a), cy / (6 * a)];
}

/** A suburb is labelled only where the label will be seen: its centroid must lie inside the envelope shrunk by 15 %. */
export function suburbLabelBox(b: BBox): BBox {
  const dLon = (b[2] - b[0]) / 2;
  const dLat = (b[3] - b[1]) / 2;
  return [b[0] + dLon * 0.15, b[1] + dLat * 0.15, b[2] - dLon * 0.15, b[3] - dLat * 0.15];
}

// ─────────────────────────────────────────────────────────────────────────────
// Building the file
// ─────────────────────────────────────────────────────────────────────────────

/** One feature as returned by an ArcGIS REST `query` (f=json, outSR 4326). */
export interface EsriFeature {
  attributes: Record<string, unknown>;
  geometry?: { x?: number; y?: number; paths?: number[][][]; rings?: number[][][] };
}

export type ContextFeatures = Partial<Record<ContextQueryId, readonly EsriFeature[]>>;

/** Provenance recorded in the file; the strings are the attribution shown in Settings → About. */
export function contextSources(fetched: string): ContextSource[] {
  const meta = (id: ContextSource['id'], title: string, layer: string, url: string, attribution: string): ContextSource => ({
    id,
    title,
    provider: attribution.replace('© ', ''),
    layer,
    url,
    licence: 'CC BY 4.0',
    attribution,
    fetched,
  });
  const q = CONTEXT_QUERIES;
  return [
    meta('roads', 'Roads and tracks', 'NSW_Transport_Theme / RoadSegment', contextLayerUrl(q.roads), '© Spatial Services NSW'),
    meta('fireTrails', 'Classified fire trails', 'NSW_Transport_Theme / ClassifiedFireTrail', contextLayerUrl(q.fireTrails), '© Spatial Services NSW'),
    meta('homes', 'Home addresses', 'NSW_Geocoded_Addressing_Theme / AddressPoint', contextLayerUrl(q.homes), '© Spatial Services NSW'),
    meta('zones', 'Land zoning (residential and built-up zones)', 'ePlanning Land Zoning Map', contextLayerUrl(q.zones), '© State of NSW and Department of Planning, Housing and Infrastructure'),
    meta('places', 'Place and suburb names', 'NSW Features of Interest PlacePoint; Administrative Boundaries Suburb', contextLayerUrl(q.places), '© Spatial Services NSW'),
  ];
}

/**
 * Classify raw features and pack them as a version-1 file (see contextLayers.ts for the format). A query that is
 * absent from `features` contributes nothing (its layer is empty).
 * @param id      site id, or 'live' for a query outside the demo sites
 * @param bbox    the envelope that was queried
 * @param fetched ISO date of the query
 */
export function buildContextFile(o: { id: string; bbox: BBox; fetched: string; features: ContextFeatures }): ContextFileV1 {
  const { bbox, features: F } = o;

  const roads: ContextFileV1['roads'] = [];
  for (const f of F.roads ?? []) {
    const a = f.attributes;
    if (a['roadontype'] === 3) continue; // in a tunnel: not visible on the ground
    const c = roadClassOf(a['functionhierarchy']);
    for (const path of f.geometry?.paths ?? []) {
      if (path.length < 2) continue;
      const p = encodeLine(path);
      if (p.length < 4) continue;
      const r: ContextFileV1['roads'][number] = { c, s: surfaceOf(a['surface']), p };
      const n = roadName(a);
      if (n) r.n = n;
      roads.push(r);
    }
  }

  const fireTrails: ContextFileV1['fireTrails'] = [];
  for (const f of F.fireTrails ?? []) for (const path of f.geometry?.paths ?? []) if (path.length > 1) fireTrails.push({ p: encodeLine(path) });

  const seen = new Set<string>();
  const pts: [number, number][] = [];
  for (const f of F.homes ?? []) {
    const { x, y } = f.geometry ?? {};
    if (x === undefined || y === undefined) continue;
    const key = `${qi(x)},${qi(y)}`;
    if (seen.has(key)) continue; // units in one building share a point
    seen.add(key);
    pts.push([x, y]);
  }
  pts.sort((a, b) => qi(a[1]) - qi(b[1]) || qi(a[0]) - qi(b[0]));
  const homes = encodeLine(pts);

  const zones: ContextFileV1['zones'] = [];
  for (const f of F.zones ?? []) {
    const code = String(f.attributes['SYM_CODE'] ?? '');
    const k = zoneKind(code);
    if (!k) continue;
    const rings = (f.geometry?.rings ?? []).map(encodeLine).filter((r) => r.length >= 6);
    if (rings.length) zones.push({ z: code, k, n: String(f.attributes['LAY_CLASS'] ?? ''), r: rings });
  }

  const places: ContextFileV1['places'] = [];
  const names = new Set<string>();
  for (const f of F.places ?? []) {
    const { x, y } = f.geometry ?? {};
    const raw = f.attributes['generalname'];
    const n = typeof raw === 'string' && raw ? titleCase(raw) : '';
    if (!n || x === undefined || y === undefined || names.has(n)) continue;
    names.add(n);
    places.push({ n, k: placeKindOf(f.attributes['placetype']), x: +x.toFixed(5), y: +y.toFixed(5) });
  }
  const box = suburbLabelBox(bbox);
  for (const f of F.suburbs ?? []) {
    const raw = f.attributes['suburbname'];
    const n = typeof raw === 'string' && raw ? titleCase(raw) : '';
    const rings = f.geometry?.rings ?? [];
    if (!n || !rings.length || names.has(n)) continue;
    const biggest = rings.reduce((a, b) => (b.length > a.length ? b : a));
    const [x, y] = ringCentroid(biggest);
    if (!(x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3])) continue; // label only where it will be seen
    names.add(n);
    places.push({ n, k: 'suburb', x: +x.toFixed(5), y: +y.toFixed(5) });
  }

  return {
    version: 1,
    id: o.id,
    fetched: o.fetched,
    bbox: bbox.map((v) => +v.toFixed(5)) as BBox,
    sources: contextSources(o.fetched),
    roads,
    fireTrails,
    zones,
    homes,
    places,
  };
}
