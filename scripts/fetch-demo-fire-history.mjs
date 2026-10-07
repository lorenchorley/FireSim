// Builds public/demo/<id>/fire-history.geojson: NPWS Fire History polygons (whole fire perimeters) that touch a demo site. Read by
// src/fuel/history.ts (FireType 1 = wildfire, 2 = prescribed burn) and the fire-history map layer.
//
// Source: DCCEEW MapServer Fire/NPWS_Fire_History, layer 0, queried with maxAllowableOffset=0.00005 deg and geometryPrecision=6
// (maxRecordCount 1000; no demo site needs a second page). The polygons are NOT clipped: they are the whole perimeters that
// intersect the site square. Licence: CC BY 4.0, (c) State of NSW and DCCEEW.
// docs/research/08b-live-endpoint-verification.md section 3 has the notes (fields, FireYear season codes, epoch-ms dates).
//
// File format (as the committed files of the first eight sites, which are the service's GeoJSON answer as it is):
//   { type: 'FeatureCollection', capturedOn, features: [ { type: 'Feature', id, geometry, properties: { OBJECTID, FireType, FireName,
//       FireNo, FireYear, Label, StartDate, EndDate, Intensity, AreaHa, PerimeterM, OFHObjMet, ObjNotMet, NPWSBranch, NPWSArea, VerDate,
//       'Shape.STArea()', 'Shape.STLength()' } } ] }
//
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch-demo-fire-history.mjs [--out=<dir>] [--force] [siteId ...]
import { exists, isMain, parseArgs, siteBox, siteDir, today, writeGuarded } from './lib/demoSite.mjs';
import { queryPages } from './fetch-demo-vegetation.mjs';

export const NPWS_URL = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/NPWS_Fire_History/MapServer/0/query';

export async function buildFireHistory(site, extent, { capturedOn = today(), log = console.log } = {}) {
  const q = siteBox(site, extent, 0);
  const features = await queryPages(
    NPWS_URL,
    {
      geometry: [q.w, q.s, q.e, q.n].join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      maxAllowableOffset: '0.00005',
      geometryPrecision: '6',
    },
    { log },
  );
  const seen = new Set();
  const unique = features.filter((f) => !seen.has(f.properties?.OBJECTID) && seen.add(f.properties?.OBJECTID));
  return { type: 'FeatureCollection', capturedOn, features: unique };
}

async function main() {
  const a = parseArgs();
  for (const s of a.sites) {
    const dir = await siteDir(s.id, a.out);
    if (!a.force && (await exists(`${dir}fire-history.geojson`))) {
      console.log(`${s.id}: fire-history.geojson exists, left alone (--force replaces it)`);
      continue;
    }
    const fc = await buildFireHistory(s, a.extent);
    const json = JSON.stringify(fc);
    await writeGuarded(`${dir}fire-history.geojson`, json, true);
    const wild = fc.features.filter((f) => f.properties.FireType === 1).length;
    console.log(`${s.id}: fire-history.geojson ${json.length} bytes, ${fc.features.length} polygons (${wild} wildfires, ${fc.features.length - wild} prescribed burns or other)`);
  }
}
if (isMain(import.meta)) await main();
