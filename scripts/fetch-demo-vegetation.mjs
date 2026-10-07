// Builds public/demo/<id>/vegetation.geojson: NSW State Vegetation Type Map (SVTM) polygons of a demo site, clipped to the site
// square plus 100 m. Read by src/fuel/svtm.ts (parseVegetation / rasteriseVegetation) and the vegetation map layer.
//
// Source: DCCEEW MapServer VIS/SVTM_NSW_Extant_PCT, layer 3 ("Plant Community Type with labels", the only vector layer), queried with
// maxAllowableOffset=0.0002 deg (about 20 m) and geometryPrecision=5, paged by object id (maxRecordCount 1000).
// Licence: CC BY 4.0, (c) State of NSW and Department of Climate Change, Energy, the Environment and Water.
// docs/research/08b-live-endpoint-verification.md section 4 has the notes (why the polygons are clipped: a few "Not classified"
// polygons reach 5 MB each and extend far outside the site).
//
// The query asks for Esri JSON (f=json), not GeoJSON: the service's own GeoJSON conversion hangs the holes of large multi-part
// polygons ("Not classified" land around towns) on the wrong parts, which turned 10 km2 of Katoomba's map into 15 km2. The rings
// are therefore clipped one by one and every hole is given to the clipped outer ring that contains it (outer rings are clockwise,
// holes counter-clockwise in Esri JSON).
//
// File format (identical to the committed files of the first eight sites):
//   { type: 'FeatureCollection', clippedTo: [w, s, e, n], capturedOn, features: [ { type: 'Feature',
//       properties: { OBJECTID, PCTID, PCTName, vegClass, vegForm }, geometry: Polygon | MultiPolygon (lon, lat; 5 decimals) } ] }
//   PCTID 0 / "Not classified" = cleared or urban land. Polygons clipped away entirely are dropped.
//
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch-demo-vegetation.mjs [--out=<dir>] [--force] [siteId ...]
import { exists, fetchRetry, isMain, parseArgs, siteBox, siteDir, today, writeGuarded } from './lib/demoSite.mjs';

export const SVTM_URL = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer/3/query';
export const CLIP_MARGIN_M = 100;
export const PAGE = 1000;
const FIELDS = ['OBJECTID', 'PCTID', 'PCTName', 'vegClass', 'vegForm'];

// ---- polygon clipping against an axis-aligned box (Sutherland-Hodgman, one ring at a time) ----------------------------------

function clipRing(pts, edge) {
  const out = [];
  const { inside, cut } = edge;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length];
    const b = pts[i];
    const ia = inside(a);
    const ib = inside(b);
    if (ib) {
      if (!ia) out.push(cut(a, b));
      out.push(b);
    } else if (ia) out.push(cut(a, b));
  }
  return out;
}

/** The four edges of a box [w, s, e, n] as inside tests and segment cuts. */
const boxEdges = ([w, s, e, n]) => [
  { inside: (p) => p[0] >= w, cut: (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])] },
  { inside: (p) => p[0] <= e, cut: (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])] },
  { inside: (p) => p[1] >= s, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s] },
  { inside: (p) => p[1] <= n, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n] },
];

const ringArea = (r) => {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return a / 2;
};

/** A ring clipped to the box, rounded to 5 decimals, duplicates removed, closed; null if nothing (or only a sliver) is left. */
export function clipRingToBox(ring, box) {
  let r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  for (const e of boxEdges(box)) {
    r = clipRing(r, e);
    if (r.length < 3) return null;
  }
  const rounded = [];
  for (const p of r) {
    const q = [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];
    const last = rounded[rounded.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) rounded.push(q);
  }
  if (rounded.length > 1 && rounded[0][0] === rounded[rounded.length - 1][0] && rounded[0][1] === rounded[rounded.length - 1][1]) rounded.pop();
  if (rounded.length < 3) return null;
  rounded.push(rounded[0]);
  return Math.abs(ringArea(rounded)) > 0 ? rounded : null;
}

const bboxOf = (ring) => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
};

/** Even-odd point-in-ring test. */
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Esri JSON rings (outer rings clockwise, holes counter-clockwise) -> a GeoJSON Polygon / MultiPolygon clipped to the box
 * (null when nothing remains). Holes that vanish in the clip are dropped; the others go to the smallest clipped outer ring around them.
 */
export function clipEsriRings(rings, box) {
  const outers = [];
  const holes = [];
  for (const ring of rings) {
    const [w, s, e, n] = bboxOf(ring);
    if (e < box[0] || w > box[2] || n < box[1] || s > box[3]) continue;
    const c = clipRingToBox(ring, box);
    if (!c) continue;
    const a = ringArea(c);
    (a < 0 ? outers : holes).push({ ring: c, area: Math.abs(a) });
  }
  if (!outers.length) return null;
  const parts = outers.map((o) => ({ o, holes: [] }));
  for (const h of holes) {
    const pt = h.ring.find(([x, y]) => x > box[0] && x < box[2] && y > box[1] && y < box[3]) ?? h.ring[0];
    let best = null;
    for (const p of parts) if (p.o.area > h.area && inRing(pt, p.o.ring) && (!best || p.o.area < best.o.area)) best = p;
    if (best) best.holes.push(h.ring);
  }
  const polys = parts.map((p) => [p.o.ring, ...p.holes]);
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

// ---- the query ------------------------------------------------------------------------------------------------------------

/** All pages of a layer query (`params.f` is 'json' or 'geojson'); features come back as { properties, geometry } with the raw geometry. */
export async function queryPages(url, params, { pageSize = PAGE, timeoutMs = 90_000, log = () => {} } = {}) {
  const features = [];
  for (let offset = 0; ; offset += pageSize) {
    const body = new URLSearchParams({ ...params, orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: String(pageSize), f: params.f ?? 'geojson' });
    const res = await fetchRetry(url, { tries: 5, timeoutMs, delayMs: 3000, init: { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }, what: `${url} offset ${offset}` });
    const j = await res.json();
    if (j.error) throw new Error(`${url}: ${j.error.code} ${j.error.message}`);
    const got = j.features ?? [];
    features.push(...got.map((f) => (f.attributes ? { properties: f.attributes, geometry: f.geometry } : f)));
    log(`  page at ${offset}: ${got.length} features`);
    if (got.length < pageSize && !j.properties?.exceededTransferLimit && !j.exceededTransferLimit) break;
    if (!got.length) break;
  }
  return features;
}

export async function buildVegetation(site, extent, { capturedOn = today(), log = console.log } = {}) {
  const q = siteBox(site, extent, CLIP_MARGIN_M);
  const box = [q.w, q.s, q.e, q.n];
  const raw = await queryPages(
    SVTM_URL,
    {
      geometry: box.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      where: '1=1',
      outFields: FIELDS.join(','),
      returnGeometry: 'true',
      outSR: '4326',
      maxAllowableOffset: '0.0002',
      geometryPrecision: '5',
      f: 'json',
    },
    { log },
  );
  const features = [];
  const seen = new Set();
  for (const f of raw) {
    const id = f.properties?.OBJECTID;
    if (seen.has(id) || !f.geometry) continue;
    seen.add(id);
    const geometry = f.geometry?.rings ? clipEsriRings(f.geometry.rings, box) : null;
    if (!geometry) continue;
    features.push({ type: 'Feature', properties: Object.fromEntries(FIELDS.map((k) => [k, f.properties?.[k] ?? null])), geometry });
  }
  log(`${site.id}: ${raw.length} polygons from the service, ${features.length} left after clipping`);
  return { type: 'FeatureCollection', clippedTo: box, capturedOn, features };
}

async function main() {
  const a = parseArgs();
  for (const s of a.sites) {
    const dir = await siteDir(s.id, a.out);
    if (!a.force && (await exists(`${dir}vegetation.geojson`))) {
      console.log(`${s.id}: vegetation.geojson exists, left alone (--force replaces it)`);
      continue;
    }
    const fc = await buildVegetation(s, a.extent);
    const json = JSON.stringify(fc);
    await writeGuarded(`${dir}vegetation.geojson`, json, true);
    const forms = {};
    for (const f of fc.features) forms[f.properties.vegForm] = (forms[f.properties.vegForm] ?? 0) + 1;
    console.log(`${s.id}: vegetation.geojson ${json.length} bytes, ${fc.features.length} polygons`, forms);
  }
}
if (isMain(import.meta)) await main();
