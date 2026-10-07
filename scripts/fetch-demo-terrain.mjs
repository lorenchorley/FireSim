// Downloads AWS Terrain Tiles (Terrarium encoding) covering each bundled NSW demo site into public/demo/<id>/terrarium/.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch-demo-terrain.mjs [siteId ...]   (no ids = every site; tiles already there are kept)
// manifest.json carries the capture date (`capturedOn`, the day the tiles were first fetched; an existing one is kept).
import { mkdir, writeFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/data/demoSites.ts', import.meta.url), 'utf8');
const wanted = process.argv.slice(2);
const sites = [...src.matchAll(/id: '([a-z]+)'[\s\S]*?centre: \{ lat: (-?[\d.]+), lon: (-?[\d.]+) \}/g)].map((m) => ({ id: m[1], lat: +m[2], lon: +m[3] })).filter((s) => !wanted.length || wanted.includes(s.id));
const EXTENT = Number(/DEMO_EXTENT_M = (\d+)/.exec(src)[1]);
const Z = Number(/DEMO_TILE_ZOOM = (\d+)/.exec(src)[1]);

const tileFrac = (lat, lon, z) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
};

for (const s of sites) {
  const dLat = EXTENT / 2 / 111195;
  const dLon = dLat / Math.cos((s.lat * Math.PI) / 180);
  const [x0, y0] = tileFrac(s.lat + dLat, s.lon - dLon, Z);
  const [x1, y1] = tileFrac(s.lat - dLat, s.lon + dLon, Z);
  const tiles = [];
  for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let y = Math.floor(y0); y <= Math.floor(y1); y++) tiles.push([x, y]);
  for (const [x, y] of tiles) {
    const dir = new URL(`../public/demo/${s.id}/terrarium/${Z}/${x}/`, import.meta.url);
    const file = new URL(`${y}.png`, dir);
    try {
      await access(file);
      continue;
    } catch {}
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);
    if (!res.ok) throw new Error(`tile ${Z}/${x}/${y}: ${res.status}`);
    await mkdir(dir, { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  const manifest = new URL(`../public/demo/${s.id}/manifest.json`, import.meta.url);
  let capturedOn = new Date().toISOString().slice(0, 10);
  try {
    capturedOn = JSON.parse(readFileSync(manifest, 'utf8')).capturedOn ?? capturedOn;
  } catch {}
  await writeFile(manifest, JSON.stringify({ id: s.id, zoom: Z, tiles, source: 'AWS Terrain Tiles (Terrarium), SRTM 1 arc-second', capturedOn }, null, 1));
  console.log(s.id, tiles.length, 'tiles');
}
