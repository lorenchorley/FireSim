// Builds public/demo/<id>/dem5m.png + dem5m.json: the NSW Spatial Services 5 m elevation model of a demo site, bilinear-resampled
// onto the site's 10 m local grid and stored as a Terrarium RGB PNG (src/data/demoRasters.ts loadDemoDem reads it).
//
// Source: NSW_5M_Elevation ImageServer (the service calls it "5 metre post spacing elevation derived from stereo imagery"; it is NOT
// LiDAR), exportImage as a Float32 GeoTIFF in EPSG:3857. One request per site: the 9 km square plus a 300 m margin at 5 m ground
// pixels (1923 x 1923 px, under the 4100 px service cap). It is slow (27-250 s cold) and the connection resets now and then.
// Licence: CC BY 4.0, (c) Spatial Services NSW. docs/research/08b-live-endpoint-verification.md section 1 has the notes.
//
// Output format (identical to the files committed for the first eight sites):
//   dem5m.png   n x n (900 x 900) 8-bit RGB, row 0 = north. Terrarium: v = h + 32768, R = floor(v/256), G = floor(v) mod 256, B = floor(frac(v)*256).
//   dem5m.json  { id, cellSize, n, centre, extent, encoding, source, attribution, minElevation, maxElevation, nodataCount, capturedOn,
//                 serviceCopyright, serviceDescription }
//
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch-demo-dem5m.mjs [--out=<dir>] [--force] [siteId ...]
//   Without --out the files go to public/demo/<id>/ and existing files are left alone (--force replaces them).
import { fromArrayBuffer } from 'geotiff';
import { encodeRgbPng } from './lib/png.mjs';
import { DEG, exists, fetchRetry, isMain, mercX, mercY, parseArgs, projection, siteBox, siteDir, today, writeGuarded } from './lib/demoSite.mjs';

export const DEM_URL = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer/exportImage';
export const CELL = 10;
export const MARGIN_M = 300;
const PIXEL_M = 5;
export const ELEVATION_SOURCE = "NSW Spatial Services NSW_5M_Elevation ImageServer (5 m post-spacing elevation; the service describes it as 'derived from stereo imagery'), exportImage F32 GeoTIFF in EPSG:3857, bilinear-resampled to 10 m local grid";
const SERVICE_TEXT = 'This Elevation service provides a full state cover of 5 metre post spacing elevation derived from stereo imagery.';

/** exportImage request of a site: bbox in 3857 and the pixel size that gives 5 m ground pixels. */
export function exportRequest(site, extent) {
  const b = siteBox(site, extent, MARGIN_M);
  const bbox = [mercX(b.w), mercY(b.s), mercX(b.e), mercY(b.n)];
  const pix = PIXEL_M / Math.cos(site.lat * DEG); // Mercator metres per 5 m of ground
  const size = [Math.ceil((bbox[2] - bbox[0]) / pix), Math.ceil((bbox[3] - bbox[1]) / pix)];
  const q = new URLSearchParams({
    bbox: bbox.map((v) => v.toFixed(3)).join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: size.join(','),
    format: 'tiff',
    pixelType: 'F32',
    noData: '-9999',
    noDataInterpretation: 'esriNoDataMatchAny',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  return { url: `${DEM_URL}?${q}`, bbox, size };
}

/** Bilinear resample of a 3857 Float32 raster onto the site's local grid. Returns { h: Float32Array (row 0 = north), nodata }. */
export function resampleToLocal({ data, width, height, box }, site, extent, cell = CELL) {
  const n = Math.round(extent / cell);
  const p = projection(site.lat, site.lon);
  const [minX, minY, maxX, maxY] = box;
  const rx = (maxX - minX) / width;
  const ry = (maxY - minY) / height;
  const h = new Float32Array(n * n);
  let nodata = 0;
  const val = (i, j) => {
    const v = data[j * width + i];
    return Number.isFinite(v) && v > -9000 ? v : NaN;
  };
  for (let r = 0; r < n; r++) {
    const y = extent / 2 - (r + 0.5) * cell;
    const lat = p.toLat(y);
    const my = mercY(lat);
    const fv = (maxY - my) / ry - 0.5;
    const j0 = Math.max(0, Math.min(height - 2, Math.floor(fv)));
    const ty = Math.max(0, Math.min(1, fv - j0));
    for (let c = 0; c < n; c++) {
      const x = -extent / 2 + (c + 0.5) * cell;
      const fu = (mercX(p.toLon(x)) - minX) / rx - 0.5;
      const i0 = Math.max(0, Math.min(width - 2, Math.floor(fu)));
      const tx = Math.max(0, Math.min(1, fu - i0));
      const v00 = val(i0, j0), v10 = val(i0 + 1, j0), v01 = val(i0, j0 + 1), v11 = val(i0 + 1, j0 + 1);
      const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      let s = 0, ws = 0;
      [v00, v10, v01, v11].forEach((v, k) => {
        if (!Number.isNaN(v)) { s += v * w[k]; ws += w[k]; }
      });
      if (ws > 0) h[r * n + c] = s / ws;
      else { h[r * n + c] = NaN; nodata++; }
    }
  }
  return { h, n, nodata };
}

/** Terrarium RGB bytes of heights (m); NaN cells become 0 m. */
export function terrariumRgb(h) {
  const rgb = new Uint8Array(h.length * 3);
  for (let k = 0; k < h.length; k++) {
    const v = (Number.isFinite(h[k]) ? h[k] : 0) + 32768;
    const fl = Math.floor(v);
    rgb[k * 3] = Math.floor(v / 256);
    rgb[k * 3 + 1] = fl % 256;
    rgb[k * 3 + 2] = Math.floor((v - fl) * 256);
  }
  return rgb;
}

/** Download, parse and resample one site. Returns the PNG bytes and the sidecar object. */
export async function buildDem(site, extent, { capturedOn = today(), log = console.log } = {}) {
  const req = exportRequest(site, extent);
  log(`${site.id}: exportImage ${req.size.join('x')} px (slow: up to a few minutes) ...`);
  const t0 = Date.now();
  const res = await fetchRetry(req.url, { tries: 5, timeoutMs: 600_000, delayMs: 5000, what: `${site.id} exportImage` });
  const ct = res.headers.get('content-type') ?? '';
  const buf = await res.arrayBuffer();
  if (!/tiff|octet/.test(ct) && buf.byteLength < 2000) throw new Error(`${site.id}: the service answered ${ct}: ${new TextDecoder().decode(buf).slice(0, 300)}`);
  const tiff = await fromArrayBuffer(buf);
  const img = await tiff.getImage();
  const [raster] = await img.readRasters();
  log(`${site.id}: ${img.getWidth()}x${img.getHeight()} F32 (${(buf.byteLength / 1e6).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const { h, n, nodata } = resampleToLocal({ data: raster, width: img.getWidth(), height: img.getHeight(), box: img.getBoundingBox() }, site, extent);
  let min = Infinity, max = -Infinity;
  for (const v of h) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
  const png = encodeRgbPng(n, n, terrariumRgb(h));
  const meta = {
    id: site.id,
    cellSize: CELL,
    n,
    centre: { lat: site.lat, lon: site.lon },
    extent,
    encoding: 'terrarium rgb; row 0 = north',
    source: ELEVATION_SOURCE,
    attribution: '© Spatial Services NSW (CC BY 4.0)',
    minElevation: Math.round(min * 100) / 100,
    maxElevation: Math.round(max * 100) / 100,
    nodataCount: nodata,
    capturedOn,
    serviceCopyright: 'DFSI 2019',
    serviceDescription: SERVICE_TEXT,
  };
  return { png, meta, heights: h };
}

async function main() {
  const a = parseArgs();
  for (const s of a.sites) {
    const dir = await siteDir(s.id, a.out);
    if (!a.force && (await exists(`${dir}dem5m.png`))) {
      console.log(`${s.id}: dem5m.png exists, left alone (--force replaces it)`);
      continue;
    }
    const { png, meta } = await buildDem(s, a.extent);
    await writeGuarded(`${dir}dem5m.png`, png, true);
    await writeGuarded(`${dir}dem5m.json`, JSON.stringify(meta, null, 1), true);
    console.log(`${s.id}: dem5m.png ${png.length} bytes, elevation ${meta.minElevation} to ${meta.maxElevation} m, ${meta.nodataCount} cells without data`);
  }
}
if (isMain(import.meta)) await main();
