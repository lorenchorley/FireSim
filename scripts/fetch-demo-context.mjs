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
// The queries, the classification and the file layout live in src/data/nswContextCore.ts, which this script IMPORTS
// (Node strips the types: Node >= 22.18) and which the app's live query (src/data/nswContext.ts) uses too, so the
// two cannot drift apart: the same envelope gives the same file (tested in src/data/nswContext.test.ts).
//
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch-demo-context.mjs [--out=<dir>] [siteId ...]
//   --out=<dir> writes <dir>/<siteId>/context.json instead of public/demo/<siteId>/context.json (to compare a re-fetch).
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CONTEXT_MARGIN_M, CONTEXT_QUERIES, CONTEXT_QUERY_IDS, buildContextFile, contextBBox, contextLayerUrl, featuresQueryForm, idsQueryForm } from '../src/data/nswContextCore.ts';

async function post(fetchImpl, url, body, tries = 4, delayMs = 1500) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(`${j.error.code} ${j.error.message}`);
      return j;
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
}

/** All features of one layer intersecting the envelope, fetched by object id in chunks (Feature and Map services alike). */
export async function queryLayer(id, bbox, { fetchImpl = globalThis.fetch, delayMs = 1500 } = {}) {
  const q = CONTEXT_QUERIES[id];
  const url = `${contextLayerUrl(q)}/query`;
  const ids = (await post(fetchImpl, url, idsQueryForm(q, bbox), 4, delayMs)).objectIds ?? [];
  const out = [];
  for (let i = 0; i < ids.length; i += q.chunk) {
    const j = await post(fetchImpl, url, featuresQueryForm(q, ids.slice(i, i + q.chunk)), 4, delayMs);
    out.push(...(j.features ?? []));
  }
  return out;
}

/** The version-1 context file of an envelope (all six layers, one after the other). */
export async function fetchContextFile({ id, bbox, today = new Date().toISOString().slice(0, 10), fetchImpl = globalThis.fetch, delayMs = 1500 }) {
  const features = {};
  for (const layer of CONTEXT_QUERY_IDS) features[layer] = await queryLayer(layer, bbox, { fetchImpl, delayMs });
  return buildContextFile({ id, bbox, fetched: today, features });
}

/** The bundled demo sites, read from src/data/demoSites.ts. */
export function demoSites() {
  const src = readFileSync(new URL('../src/data/demoSites.ts', import.meta.url), 'utf8');
  const sites = [...src.matchAll(/id: '([a-z]+)'[\s\S]*?centre: \{ lat: (-?[\d.]+), lon: (-?[\d.]+) \}/g)].map((m) => ({ id: m[1], lat: +m[2], lon: +m[3] }));
  return { sites, extent: Number(/DEMO_EXTENT_M = (\d+)/.exec(src)[1]) };
}

/** Envelope of a demo site: its 9 km square plus the context margin. */
export const siteBBox = (site, extent) => contextBBox(site.lat, site.lon, extent, CONTEXT_MARGIN_M);

async function main() {
  const { sites: all, extent } = demoSites();
  const args = process.argv.slice(2);
  const out = args.find((a) => a.startsWith('--out='))?.slice(6);
  const wanted = args.filter((a) => !a.startsWith('--'));
  const sites = wanted.length ? all.filter((s) => wanted.includes(s.id)) : all;
  for (const s of sites) {
    const t0 = Date.now();
    const doc = await fetchContextFile({ id: s.id, bbox: siteBBox(s, extent) });
    const dir = out ? pathToFileURL(`${out.replace(/\/+$/, '')}/${s.id}/`) : new URL(`../public/demo/${s.id}/`, import.meta.url);
    await mkdir(dir, { recursive: true });
    const json = JSON.stringify(doc);
    await writeFile(new URL('context.json', dir), json);
    console.log(
      `${s.id}: roads ${doc.roads.length}, fire trails ${doc.fireTrails.length}, homes ${doc.homes.length / 2}, zones ${doc.zones.length}, places ${doc.places.length}; ${(json.length / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(0)} s`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
