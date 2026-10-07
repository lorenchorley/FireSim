// Pre-computes canopy height / cover rasters for each bundled demo site from the Meta & WRI global 1 m
// canopy height map (Tolan et al. 2024, CC BY 4.0, s3://dataforgood-fb-data/forests/v1/alsgedi_global_v6_float/chm/).
// Output: public/demo/<id>/canopy.png (RGB: R = 90th-percentile height m, G = mean height m, B = cover fraction × 255)
// on a CELL m grid centred on the site, plus canopy.json metadata.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch-demo-canopy.mjs [--force] [siteId ...]   (an existing canopy.png is kept unless --force)
import { fromUrl } from 'geotiff';
import { encode } from 'fast-png';
import { readFileSync } from 'node:fs';
import { writeFile, access } from 'node:fs/promises';

const src = readFileSync(new URL('../src/data/demoSites.ts', import.meta.url), 'utf8');
let sites = [...src.matchAll(/id: '([a-z]+)'[\s\S]*?centre: \{ lat: (-?[\d.]+), lon: (-?[\d.]+) \}/g)].map((m) => ({ id: m[1], lat: +m[2], lon: +m[3] }));
const wantedIds = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const force = process.argv.includes('--force');
if (wantedIds.length) sites = sites.filter((s) => wantedIds.includes(s.id));
const EXTENT = Number(/DEMO_EXTENT_M = (\d+)/.exec(src)[1]);
const CELL = 20;
const R = 6378137;
const RES = (2 * Math.PI * R) / 2 ** 25; // 1.194 m: native pixel size of the CHM tiles (Web-Mercator zoom 17 × 256)
const quadkey = (lat, lon, z) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  let q = '';
  for (let i = z; i > 0; i--) q += String(((x >> (i - 1)) & 1) + (((y >> (i - 1)) & 1) << 1));
  return q;
};
const merc = (lat, lon) => [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];

for (const s of sites) {
  const out = new URL(`../public/demo/${s.id}/canopy.png`, import.meta.url);
  if (!force) try { await access(out); console.log(s.id, 'exists'); continue; } catch {}
  const n = Math.round(EXTENT / CELL);
  const kLat = 111195, kLon = 111195 * Math.cos((s.lat * Math.PI) / 180);
  const hist = new Array(n * n); // per cell: histogram of heights 0..60
  const sum = new Float64Array(n * n), cnt = new Uint32Array(n * n), cover = new Uint32Array(n * n);
  for (let k = 0; k < n * n; k++) hist[k] = new Uint16Array(61);
  // bounding lat/lon
  const half = EXTENT / 2;
  const north = s.lat + half / kLat, south = s.lat - half / kLat, west = s.lon - half / kLon, east = s.lon + half / kLon;
  const qks = new Set([quadkey(north, west, 9), quadkey(north, east, 9), quadkey(south, west, 9), quadkey(south, east, 9)]);
  for (const qk of qks) {
    const tif = await fromUrl(`https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/${qk}.tif`);
    const img = await tif.getImage(0);
    const [minX, minY, maxX, maxY] = img.getBoundingBox();
    const [mx0, my1] = merc(north, west), [mx1, my0] = merc(south, east);
    const px0 = Math.max(0, Math.floor((Math.max(mx0, minX) - minX) / RES)), px1 = Math.min(img.getWidth(), Math.ceil((Math.min(mx1, maxX) - minX) / RES));
    const py0 = Math.max(0, Math.floor((maxY - Math.min(my1, maxY)) / RES)), py1 = Math.min(img.getHeight(), Math.ceil((maxY - Math.max(my0, minY)) / RES));
    if (px1 <= px0 || py1 <= py0) continue;
    for (let row = py0; row < py1; row += 256) {
      const rEnd = Math.min(py1, row + 256);
      const [band] = await img.readRasters({ window: [px0, row, px1, rEnd] });
      const w = px1 - px0;
      for (let yy = row; yy < rEnd; yy++) {
        const my = maxY - (yy + 0.5) * RES;
        const lat = (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * 180 / Math.PI;
        const j = Math.floor(((lat - s.lat) * kLat + half) / CELL);
        if (j < 0 || j >= n) continue;
        for (let xx = px0; xx < px1; xx++) {
          const lon = ((minX + (xx + 0.5) * RES) / R) * 180 / Math.PI;
          const i = Math.floor(((lon - s.lon) * kLon + half) / CELL);
          if (i < 0 || i >= n) continue;
          const h = band[(yy - row) * w + (xx - px0)];
          const k = j * n + i;
          hist[k][Math.min(60, h)]++;
          sum[k] += h; cnt[k]++; if (h >= 2) cover[k]++;
        }
      }
      process.stdout.write(`\r${s.id} ${qk} ${Math.round(((rEnd - py0) / (py1 - py0)) * 100)}%   `);
    }
  }
  const png = new Uint8Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i; const o = ((n - 1 - j) * n + i) * 3; // PNG row 0 = north
    if (!cnt[k]) continue;
    let acc = 0, p90 = 0; const target = cnt[k] * 0.9;
    for (let h = 0; h <= 60; h++) { acc += hist[k][h]; if (acc >= target) { p90 = h; break; } }
    png[o] = p90; png[o + 1] = Math.round(sum[k] / cnt[k]); png[o + 2] = Math.round((cover[k] / cnt[k]) * 255);
  }
  await writeFile(out, encode({ width: n, height: n, data: png, channels: 3, depth: 8 }));
  await writeFile(new URL(`../public/demo/${s.id}/canopy.json`, import.meta.url), JSON.stringify({ id: s.id, cellSize: CELL, n, centre: { lat: s.lat, lon: s.lon }, extent: EXTENT, encoding: 'RGB: R=p90 canopy height (m), G=mean height (m), B=cover fraction (>=2 m) x255; row 0 = north', source: 'Meta & WRI High Resolution Canopy Height Maps v1 (Tolan et al. 2024), CC BY 4.0', capturedOn: new Date().toISOString().slice(0, 10) }, null, 1));
  console.log(`\n${s.id} done`);
}
