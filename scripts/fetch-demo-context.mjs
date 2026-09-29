// Fetches "context" layers for each bundled NSW demo site from official NSW services and writes a compact
// public/demo/<id>/context.json:
//   roads       NSW Spatial Services  NSW_Transport_Theme / RoadSegment (5)          class, surface, name
//   fireTrails  NSW Spatial Services  NSW_Transport_Theme / ClassifiedFireTrail (9)  (RFS-classified fire trails)
//   homes       NSW Spatial Services  NSW_Geocoded_Addressing_Theme / AddressPoint (1)  one point per dwelling address
//   zones       NSW Planning          ePlanning Land Zoning Map (19): residential, village, environmental living, small
//                                     rural lots, commercial, industrial, tourist
//   places      NSW Spatial Services  Features of Interest PlacePoint (1) + Administrative Boundaries Suburb (2)
// Licence: CC BY 4.0 (© State of NSW, Spatial Services / Department of Planning, Housing and Infrastructure).
//
// File format (version 1). All coordinates are integers in units of 1e-5 degrees (~1 m), DELTA-CODED: a flat array
// [x0, y0, dx1, dy1, dx2, dy2, ...] where x = longitude, y = latitude. Decoded by src/data/contextLayers.ts.
//   { version, id, fetched, bbox:[w,s,e,n], sources:[{id,title,provider,layer,url,licence,attribution,fetched}],
//     roads:[{c:RoadClass, s:0|1|2|3, n?:string, p:number[]}],
//     fireTrails:[{p:number[]}],
//     zones:[{z:'R2', k:ZoneKind, n:'Low Density Residential', r:number[][]}],   // r = rings (outer first)
//     homes:number[],                                                         // delta-coded points
//     places:[{n:'Leura', k:'town'|'village'|'locality'|'suburb', x:number, y:number}] }   // x/y in degrees
//
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch-demo-context.mjs [siteId ...]
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

const src = readFileSync(new URL('../src/data/demoSites.ts', import.meta.url), 'utf8');
let sites = [...src.matchAll(/id: '([a-z]+)'[\s\S]*?centre: \{ lat: (-?[\d.]+), lon: (-?[\d.]+) \}/g)].map((m) => ({ id: m[1], lat: +m[2], lon: +m[3] }));
if (process.argv.length > 2) sites = sites.filter((s) => process.argv.slice(2).includes(s.id));
const EXTENT = Number(/DEMO_EXTENT_M = (\d+)/.exec(src)[1]);
const MARGIN = 400; // m beyond the 9 km square so lines and zones reach the edge of any domain at the site

const SS = 'https://portal.spatial.nsw.gov.au/server/rest/services';
const PLAN = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer';
const LAYERS = {
  roads: `${SS}/NSW_Transport_Theme/FeatureServer/5`,
  fireTrails: `${SS}/NSW_Transport_Theme/FeatureServer/9`,
  homes: `${SS}/NSW_Geocoded_Addressing_Theme/FeatureServer/1`,
  places: `${SS}/NSW_Features_of_Interest_Category/FeatureServer/1`,
  suburbs: `${SS}/NSW_Administrative_Boundaries_Theme/FeatureServer/2`,
  zones: `${PLAN}/19`,
};
const Q = 1e5;
const today = new Date().toISOString().slice(0, 10);

async function post(url, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(`${j.error.code} ${j.error.message}`);
      return j;
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

/** All features intersecting the envelope, fetched by object id in chunks (works for Feature and Map services). */
async function queryAll(layerUrl, bbox, { outFields, offset = 0, geometry = true, where = '1=1' }) {
  const env = { geometry: `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', where };
  const ids = (await post(`${layerUrl}/query`, { ...env, returnIdsOnly: 'true', f: 'json' })).objectIds ?? [];
  const out = [];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const j = await post(`${layerUrl}/query`, {
      objectIds: chunk.join(','),
      outFields,
      returnGeometry: geometry ? 'true' : 'false',
      outSR: '4326',
      maxAllowableOffset: String(offset),
      geometryPrecision: '5',
      f: 'json',
    });
    out.push(...(j.features ?? []));
  }
  return out;
}

// ── encoding ──
const qi = (v) => Math.round(v * Q);
function encodeLine(points) {
  const out = [];
  let px = 0;
  let py = 0;
  points.forEach(([x, y], i) => {
    const X = qi(x);
    const Y = qi(y);
    if (i === 0) out.push(X, Y);
    else if (X !== px || Y !== py) out.push(X - px, Y - py);
    px = X;
    py = Y;
  });
  return out;
}
const inside = (x, y, b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

// ── classification ──
const ROAD_CLASS = { 1: 'motorway', 2: 'primary', 3: 'arterial', 4: 'subarterial', 5: 'distributor', 6: 'local', 7: 'service', 8: 'track', 9: 'path', 10: 'local', 11: 'service' };
const SURFACE = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 3 }; // 0 unknown, 1 sealed, 2 unsealed, 3 4WD
const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);
function roadName(a) {
  if (!a.roadnamebase) return undefined;
  return titleCase([a.roadnamebase, a.roadnametype, a.roadnamesuffix].filter(Boolean).join(' '));
}
/** Zone code -> display kind. Only kinds a firefighter uses to read "where people live and work" are kept. */
function zoneKind(code) {
  if (/^R[1-5]$/.test(code)) return 'residential';
  if (code === 'RU5') return 'village';
  if (code === 'C4') return 'envLiving';
  if (/^RU[46]$/.test(code)) return 'ruralSmall';
  if (/^(B\d|E1|E2|MU1)$/.test(code)) return 'commercial';
  if (/^(IN\d|E3|E4|E5)$/.test(code)) return 'industrial';
  if (code === 'SP3') return 'tourist';
  return null;
}
const PLACE_KIND = { 1: 'region', 2: 'city', 3: 'town', 4: 'village', 5: 'locality', 6: 'suburb' };

function ringCentroid(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  a *= 0.5;
  return Math.abs(a) < 1e-12 ? ring[0] : [cx / (6 * a), cy / (6 * a)];
}

for (const s of sites) {
  const dLat = (EXTENT / 2 + MARGIN) / 111195;
  const dLon = dLat / Math.cos((s.lat * Math.PI) / 180);
  const bbox = [s.lon - dLon, s.lat - dLat, s.lon + dLon, s.lat + dLat];
  const t0 = Date.now();

  const roadF = await queryAll(LAYERS.roads, bbox, { outFields: 'roadnamebase,roadnametype,roadnamesuffix,functionhierarchy,surface,roadontype,operationalstatus', offset: 0.00002, where: 'operationalstatus=1' });
  const roads = [];
  for (const f of roadF) {
    const a = f.attributes;
    if (a.roadontype === 3) continue; // in a tunnel: not visible on the ground
    const c = ROAD_CLASS[a.functionhierarchy] ?? 'local';
    for (const path of f.geometry?.paths ?? []) {
      if (path.length < 2) continue;
      const p = encodeLine(path);
      if (p.length < 4) continue;
      const r = { c, s: SURFACE[a.surface] ?? 0, p };
      const n = roadName(a);
      if (n) r.n = n;
      roads.push(r);
    }
  }

  const trailF = await queryAll(LAYERS.fireTrails, bbox, { outFields: 'objectid', offset: 0.00002 });
  const fireTrails = [];
  for (const f of trailF) for (const path of f.geometry?.paths ?? []) if (path.length > 1) fireTrails.push({ p: encodeLine(path) });

  const homeF = await queryAll(LAYERS.homes, bbox, { outFields: 'rid' });
  const seen = new Set();
  const pts = [];
  for (const f of homeF) {
    const { x, y } = f.geometry ?? {};
    if (x === undefined) continue;
    const key = `${qi(x)},${qi(y)}`;
    if (seen.has(key)) continue; // units in one building share a point
    seen.add(key);
    pts.push([x, y]);
  }
  pts.sort((a, b) => qi(a[1]) - qi(b[1]) || qi(a[0]) - qi(b[0]));
  const homes = encodeLine(pts);

  const zoneF = await queryAll(LAYERS.zones, bbox, { outFields: 'SYM_CODE,LAY_CLASS,LGA_NAME', offset: 0.00005 });
  const zones = [];
  for (const f of zoneF) {
    const code = f.attributes.SYM_CODE;
    const k = zoneKind(code);
    if (!k) continue;
    const rings = (f.geometry?.rings ?? []).map(encodeLine).filter((r) => r.length >= 6);
    if (rings.length) zones.push({ z: code, k, n: f.attributes.LAY_CLASS, r: rings });
  }

  const placeF = await queryAll(LAYERS.places, bbox, { outFields: 'generalname,placetype' });
  const places = [];
  const names = new Set();
  for (const f of placeF) {
    const { x, y } = f.geometry ?? {};
    const n = f.attributes.generalname && titleCase(f.attributes.generalname);
    if (!n || x === undefined || names.has(n)) continue;
    names.add(n);
    places.push({ n, k: PLACE_KIND[f.attributes.placetype] ?? 'locality', x: +x.toFixed(5), y: +y.toFixed(5) });
  }
  const subF = await queryAll(LAYERS.suburbs, bbox, { outFields: 'suburbname', offset: 0.0005 });
  for (const f of subF) {
    const n = f.attributes.suburbname && titleCase(f.attributes.suburbname);
    const rings = f.geometry?.rings ?? [];
    if (!n || !rings.length || names.has(n)) continue;
    const biggest = rings.reduce((a, b) => (b.length > a.length ? b : a));
    const [x, y] = ringCentroid(biggest);
    if (!inside(x, y, [bbox[0] + dLon * 0.15, bbox[1] + dLat * 0.15, bbox[2] - dLon * 0.15, bbox[3] - dLat * 0.15])) continue; // label only where it will be seen
    names.add(n);
    places.push({ n, k: 'suburb', x: +x.toFixed(5), y: +y.toFixed(5) });
  }

  const meta = (id, title, layer, url, attribution, licence = 'CC BY 4.0') => ({ id, title, provider: attribution.replace('© ', ''), layer, url, licence, attribution, fetched: today });
  const doc = {
    version: 1,
    id: s.id,
    fetched: today,
    bbox: bbox.map((v) => +v.toFixed(5)),
    sources: [
      meta('roads', 'Roads and tracks', 'NSW_Transport_Theme / RoadSegment', LAYERS.roads, '© Spatial Services NSW'),
      meta('fireTrails', 'Classified fire trails', 'NSW_Transport_Theme / ClassifiedFireTrail', LAYERS.fireTrails, '© Spatial Services NSW'),
      meta('homes', 'Home addresses', 'NSW_Geocoded_Addressing_Theme / AddressPoint', LAYERS.homes, '© Spatial Services NSW'),
      meta('zones', 'Land zoning (residential and built-up zones)', 'ePlanning Land Zoning Map', LAYERS.zones, '© State of NSW and Department of Planning, Housing and Infrastructure'),
      meta('places', 'Place and suburb names', 'NSW Features of Interest PlacePoint; Administrative Boundaries Suburb', LAYERS.places, '© Spatial Services NSW'),
    ],
    roads,
    fireTrails,
    zones,
    homes,
    places,
  };
  const dir = new URL(`../public/demo/${s.id}/`, import.meta.url);
  await mkdir(dir, { recursive: true });
  const json = JSON.stringify(doc);
  await writeFile(new URL('context.json', dir), json);
  console.log(`${s.id}: roads ${roads.length}, fire trails ${fireTrails.length}, homes ${pts.length}, zones ${zones.length}, places ${places.length}; ${(json.length / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
