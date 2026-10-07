// Compares a demo site's bundle in two folders (e.g. the committed public/demo and a scratch re-run of the fetch scripts made with
// `--out=<dir>`), to show that scripts/fetch-demo-*.mjs reproduce the committed files. Prints, per layer:
//   dem5m        header fields; the elevation difference over the 900 x 900 cells (mean, rms, 99th percentile, max)
//   imagery      header fields; the picture difference (mean absolute grey-level difference per channel, best 1-px shift, JPEG layout);
//                needs Python 3 with Pillow (scripts/lib/imagery_compare.py)
//   vegetation   area per vegForm (km2) in both files; agreement of the polygon class at random points
//   fire history polygons with the same OBJECTID and identical geometry and attributes
// Usage: node scripts/compare-demo-site.mjs <siteId> <dirB> [dirA = public/demo]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decode } from 'fast-png';
import { ROOT, demoSites, K_LAT } from './lib/demoSite.mjs';

const [id, dirB, dirA = `${ROOT}public/demo`] = process.argv.slice(2);
if (!id || !dirB) {
  console.error('usage: node scripts/compare-demo-site.mjs <siteId> <dirB> [dirA]');
  process.exit(2);
}
const A = `${dirA}/${id}/`;
const B = `${dirB.replace(/\/+$/, '')}/${id}/`;
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
const site = demoSites().sites.find((s) => s.id === id);

function header(name) {
  const a = json(A + name), b = json(B + name);
  const keysSame = Object.keys(a).join() === Object.keys(b).join();
  const diff = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  console.log(`  ${name}: fields ${keysSame ? 'identical' : 'DIFFERENT'}; values that differ: ${diff.map((k) => `${k} ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`).join('; ') || 'none'}`);
}

console.log(`${id}: ${A} (committed) against ${B}`);
// DEM
header('dem5m.json');
{
  const a = decode(readFileSync(A + 'dem5m.png')), b = decode(readFileSync(B + 'dem5m.png'));
  const n = a.width * a.height;
  const h = (img, i) => img.data[i * 3] * 256 + img.data[i * 3 + 1] + img.data[i * 3 + 2] / 256 - 32768;
  let s = 0, s2 = 0, mx = 0;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = h(b, i) - h(a, i);
    s += e; s2 += e * e; d[i] = Math.abs(e); mx = Math.max(mx, d[i]);
  }
  d.sort();
  console.log(`  dem5m.png ${a.width}x${a.height} vs ${b.width}x${b.height}: mean ${(s / n).toFixed(4)} m, rms ${Math.sqrt(s2 / n).toFixed(3)} m, 99th percentile ${d[Math.floor(n * 0.99)].toFixed(2)} m, max ${mx.toFixed(2)} m; bytes ${readFileSync(A + 'dem5m.png').length} vs ${readFileSync(B + 'dem5m.png').length}`);
}
// imagery
header('imagery.json');
try {
  const out = execFileSync('python3', ['-I', `${ROOT}scripts/lib/imagery_compare.py`, A + 'imagery.jpg', B + 'imagery.jpg'], { encoding: 'utf8' });
  const r = JSON.parse(out);
  console.log(`  imagery.jpg: ${r.sizeA} vs ${r.sizeB}, progressive ${r.progressiveA}/${r.progressiveB}, subsampling ${r.subsamplingA}/${r.subsamplingB}, mean |diff| per channel ${r.meanAbsDiff} (best alignment ${r.bestShift} px), pixels off by more than 24 levels ${(r.shareOfPixelsOff24Levels * 100).toFixed(2)} %; bytes ${readFileSync(A + 'imagery.jpg').length} vs ${readFileSync(B + 'imagery.jpg').length}`);
} catch (e) {
  console.log(`  imagery.jpg: not compared (${e.message.split('\n')[0]})`);
}
// vegetation
{
  const a = json(A + 'vegetation.geojson'), b = json(B + 'vegetation.geojson');
  const kLon = K_LAT * Math.cos(site.lat * Math.PI / 180);
  const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; };
  const polys = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
  const area = (g) => polys(g).reduce((t, p) => t + Math.abs(ringArea(p[0])) - p.slice(1).reduce((u, h) => u + Math.abs(ringArea(h)), 0), 0) * K_LAT * kLon / 1e6;
  const byForm = (fc) => { const m = {}; for (const f of fc.features) m[f.properties.vegForm] = (m[f.properties.vegForm] ?? 0) + area(f.geometry); return m; };
  const ma = byForm(a), mb = byForm(b);
  console.log(`  vegetation.geojson: ${a.features.length} vs ${b.features.length} polygons, clippedTo ${a.clippedTo.map((v) => v.toFixed(4))} vs ${b.clippedTo.map((v) => v.toFixed(4))}; bytes ${readFileSync(A + 'vegetation.geojson').length} vs ${readFileSync(B + 'vegetation.geojson').length}`);
  for (const k of Object.keys(ma)) console.log(`    ${k.padEnd(52)} ${ma[k].toFixed(2).padStart(7)} km2 ${(mb[k] ?? 0).toFixed(2).padStart(7)} km2`);
  const inRing = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  const index = (fc) => fc.features.map((f) => { const rings = polys(f.geometry).flat(); const xs = rings.flatMap((r) => r.map((p) => p[0])), ys = rings.flatMap((r) => r.map((p) => p[1])); return { rings, cls: f.properties.vegClass, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }; });
  const ia = index(a), ib = index(b);
  const look = (idx, x, y) => { for (const o of idx) { if (x < o.bb[0] || x > o.bb[2] || y < o.bb[1] || y > o.bb[3]) continue; let ins = false; for (const r of o.rings) if (inRing(x, y, r)) ins = !ins; if (ins) return o.cls; } return 'none'; };
  let seed = 12345, same = 0;
  const N = 6000;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const [w, s, e, n] = a.clippedTo;
  for (let i = 0; i < N; i++) { const x = w + rnd() * (e - w), y = s + rnd() * (n - s); if (look(ia, x, y) === look(ib, x, y)) same++; }
  console.log(`  vegetation class at ${N} random points: ${((100 * same) / N).toFixed(2)} % the same`);
}
// fire history
{
  const a = json(A + 'fire-history.geojson'), b = json(B + 'fire-history.geojson');
  const mb = new Map(b.features.map((f) => [f.properties.OBJECTID, f]));
  let same = 0;
  for (const f of a.features) if (mb.has(f.properties.OBJECTID) && JSON.stringify(mb.get(f.properties.OBJECTID)) === JSON.stringify(f)) same++;
  console.log(`  fire-history.geojson: ${a.features.length} vs ${b.features.length} polygons, ${same} identical (geometry and attributes); bytes ${readFileSync(A + 'fire-history.geojson').length} vs ${readFileSync(B + 'fire-history.geojson').length}`);
}
