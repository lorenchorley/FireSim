// Shared helpers of the demo-site fetch scripts (scripts/fetch-demo-*.mjs): the site list, the local grid convention,
// Web-Mercator maths, a retrying fetch, and the common command line.
//
// Grid convention of every bundled raster (docs/research/08b-live-endpoint-verification.md "Grid convention"): a square of
// side EXTENT metres centred on the site, row 0 = north; cell (col,row) has its centre at x = -EXTENT/2 + (col+0.5)*cell,
// y = EXTENT/2 - (row+0.5)*cell; lat = lat0 + y/K_LAT, lon = lon0 + x/(K_LAT*cos(lat0)) (src/core/geo.ts LocalProjection).
import { readFileSync } from 'node:fs';
import { mkdir, access, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** Metres per degree of latitude of the app's local projection (EARTH_RADIUS 6371008.8 m). */
export const K_LAT = (6371008.8 * Math.PI) / 180;
export const R_MERC = 6378137;
export const DEG = Math.PI / 180;

/** The bundled demo sites and the extent, read from src/data/demoSites.ts (site ids are lowercase letters only). */
export function demoSites() {
  const src = readFileSync(new URL('../../src/data/demoSites.ts', import.meta.url), 'utf8');
  const sites = [...src.matchAll(/id: '([a-z]+)'[\s\S]*?centre: \{ lat: (-?[\d.]+), lon: (-?[\d.]+) \}/g)].map((m) => ({ id: m[1], lat: +m[2], lon: +m[3] }));
  return { sites, extent: Number(/DEMO_EXTENT_M = (\d+)/.exec(src)[1]), zoom: Number(/DEMO_TILE_ZOOM = (\d+)/.exec(src)[1]) };
}

/** Local metres -> degrees for a site (kLon uses the site latitude, like LocalProjection). */
export const projection = (lat0, lon0) => {
  const kLon = K_LAT * Math.cos(lat0 * DEG);
  return { toLat: (y) => lat0 + y / K_LAT, toLon: (x) => lon0 + x / kLon, kLon };
};

/** Lat/lon box (w, s, e, n) of the site square grown by marginM metres. */
export function siteBox(site, extent, marginM = 0) {
  const h = extent / 2 + marginM;
  const p = projection(site.lat, site.lon);
  return { w: p.toLon(-h), s: p.toLat(-h), e: p.toLon(h), n: p.toLat(h) };
}

export const mercX = (lon) => R_MERC * lon * DEG;
export const mercY = (lat) => R_MERC * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));

/** Today (UTC) as an ISO date: the `capturedOn` of the files fetched now. */
export const today = () => new Date().toISOString().slice(0, 10);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with a timeout and retries (the NSW services reset about 5 % of connections and stall now and then). */
export async function fetchRetry(url, { tries = 5, timeoutMs = 60_000, delayMs = 2000, init = {}, what = url } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw new Error(`${what}: ${last?.cause?.code ?? last?.message ?? last}`);
}

/** Command line: `[--out=<dir>] [--force] [siteId ...]` -> { sites, out, force } (no ids = every site). */
export function parseArgs(argv = process.argv.slice(2)) {
  const { sites: all, extent, zoom } = demoSites();
  const out = argv.find((a) => a.startsWith('--out='))?.slice(6);
  const force = argv.includes('--force');
  const wanted = argv.filter((a) => !a.startsWith('--'));
  for (const w of wanted) if (!all.some((s) => s.id === w)) throw new Error(`unknown site '${w}' (see src/data/demoSites.ts)`);
  return { sites: wanted.length ? all.filter((s) => wanted.includes(s.id)) : all, extent, zoom, out: out ? out.replace(/\/+$/, '') : undefined, force };
}

/** Folder of a site's files (`<out>/<id>/` or public/demo/<id>/), created. */
export async function siteDir(id, out) {
  const dir = out ? `${out}/${id}/` : `${ROOT}public/demo/${id}/`;
  await mkdir(dir, { recursive: true });
  return dir;
}

export const exists = (f) => access(f).then(() => true, () => false);

/** Write a file unless it exists (and not --force): bundled sites are never overwritten by accident. */
export async function writeGuarded(file, data, force) {
  if (!force && (await exists(file))) {
    console.log(`  ${file.replace(ROOT, '')} exists: left alone (use --force to replace it)`);
    return false;
  }
  await writeFile(file, data);
  return true;
}

export const isMain = (meta) => !!process.argv[1] && meta.url === pathToFileURL(process.argv[1]).href;
