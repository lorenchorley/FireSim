// Builds public/demo/<id>/imagery.jpg + imagery.json: NSW aerial imagery of a demo site on an 8 m local grid (1125 x 1125 px for the
// 9 km square), progressive JPEG quality 82. The app shows it as the ground texture (src/ui/imagery.ts, src/scenario/imagery.ts) and
// crops it with imageryWindow() (src/data/demoRasters.ts).
//
// Source: NSW Spatial Services NSW_Imagery MapServer, cached XYZ tiles at zoom 15 (about 4 m of ground per pixel at -33 degrees; ten
// by ten tiles of 256 px cover a site), 2 x 2 area-averaged, then bilinear-resampled onto the 8 m local grid.
// Licence: CC BY 4.0, (c) Spatial Services NSW; the service copyright is "(c) Department of Customer Service 2020".
// docs/research/08b-live-endpoint-verification.md section 2 has the notes. Visible seams between capture dates are in the source.
//
// The tiles are downloaded here (with the proxy and the retries of the other fetch scripts); the mosaic, the resampling and the
// JPEG encoding are done by scripts/lib/imagery_mosaic.py because the existing files were written by Pillow (progressive, 4:2:0)
// and no JavaScript JPEG encoder in the dependencies writes that. Needs Python 3 with Pillow (python3 -c "import PIL").
//
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch-demo-imagery.mjs [--out=<dir>] [--force] [siteId ...]
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DEG, ROOT, exists, fetchRetry, isMain, parseArgs, siteBox, siteDir, today, writeGuarded } from './lib/demoSite.mjs';

export const TILE_URL = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile';
export const ZOOM = 15;
export const CELL = 8;
const CONCURRENCY = 4;

const tileFrac = (lat, lon, z) => {
  const n = 2 ** z;
  const r = lat * DEG;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
};

/** The tile block covering a site square: x0, y0 and the number of columns / rows. */
export function tileBlock(site, extent, z = ZOOM) {
  const b = siteBox(site, extent, 0);
  const [xa, ya] = tileFrac(b.n, b.w, z);
  const [xb, yb] = tileFrac(b.s, b.e, z);
  const x0 = Math.floor(xa), y0 = Math.floor(ya);
  return { x0, y0, nx: Math.floor(xb) - x0 + 1, ny: Math.floor(yb) - y0 + 1 };
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

export async function buildImagery(site, extent, { capturedOn = today(), log = console.log } = {}) {
  const blk = tileBlock(site, extent);
  const n = Math.round(extent / CELL);
  const tmp = await mkdtemp(`${tmpdir()}/imagery-${site.id}-`);
  try {
    const jobs = [];
    for (let ty = 0; ty < blk.ny; ty++) for (let tx = 0; tx < blk.nx; tx++) jobs.push([blk.x0 + tx, blk.y0 + ty]);
    log(`${site.id}: ${jobs.length} tiles (${blk.nx} x ${blk.ny}) at zoom ${ZOOM}`);
    let done = 0;
    await pool(jobs, CONCURRENCY, async ([x, y]) => {
      const res = await fetchRetry(`${TILE_URL}/${ZOOM}/${y}/${x}`, { tries: 6, timeoutMs: 30_000, delayMs: 1500, what: `tile ${ZOOM}/${y}/${x}` });
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(`tile ${ZOOM}/${y}/${x} is not a JPEG`);
      await writeFile(`${tmp}/${x}_${y}.jpg`, bytes);
      if (++done % 25 === 0) log(`  ${done}/${jobs.length}`);
    });
    const spec = { dir: tmp, z: ZOOM, ...blk, lat0: site.lat, lon0: site.lon, extent, cell: CELL, n, quality: 82, out: `${tmp}/imagery.jpg` };
    await writeFile(`${tmp}/spec.json`, JSON.stringify(spec));
    execFileSync('python3', ['-I', `${ROOT}scripts/lib/imagery_mosaic.py`, `${tmp}/spec.json`], { stdio: ['ignore', 'inherit', 'inherit'] });
    const jpeg = await readFile(`${tmp}/imagery.jpg`);
    const meta = {
      id: site.id,
      cellSize: CELL,
      n,
      centre: { lat: site.lat, lon: site.lon },
      extent,
      source: `NSW Spatial Services NSW_Imagery MapServer XYZ tiles, zoom ${ZOOM} (${jobs.length} tiles, Web Mercator), 2x2 area-averaged then bilinear-resampled to ${CELL} m local grid; JPEG quality 82`,
      attribution: '© Spatial Services NSW (CC BY 4.0)',
      encoding: 'RGB JPEG; row 0 = north',
      capturedOn,
      serviceCopyright: '© Department of Customer Service 2020',
    };
    return { jpeg, meta };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const a = parseArgs();
  for (const s of a.sites) {
    const dir = await siteDir(s.id, a.out);
    if (!a.force && (await exists(`${dir}imagery.jpg`))) {
      console.log(`${s.id}: imagery.jpg exists, left alone (--force replaces it)`);
      continue;
    }
    const { jpeg, meta } = await buildImagery(s, a.extent);
    await writeGuarded(`${dir}imagery.jpg`, jpeg, true);
    await writeGuarded(`${dir}imagery.json`, JSON.stringify(meta, null, 1), true);
    console.log(`${s.id}: imagery.jpg ${jpeg.length} bytes`);
  }
}
if (isMain(import.meta)) await main();
