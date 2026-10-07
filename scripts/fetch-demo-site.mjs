// Builds the whole bundle of one demo site, public/demo/<id>/, from the live services, one script after the other:
//   fetch-demo-terrain.mjs   terrarium/<z>/<x>/<y>.png + manifest.json   AWS Terrain Tiles (SRTM 1 arc-second), the fallback terrain
//   fetch-demo-dem5m.mjs     dem5m.png + dem5m.json                      NSW 5 m elevation model on a 10 m grid
//   fetch-demo-imagery.mjs   imagery.jpg + imagery.json                  NSW aerial imagery on an 8 m grid (needs Python 3 + Pillow)
//   fetch-demo-canopy.mjs    canopy.png + canopy.json                    Meta & WRI canopy height on a 20 m grid
//   fetch-demo-vegetation.mjs   vegetation.geojson                       NSW State Vegetation Type Map
//   fetch-demo-fire-history.mjs fire-history.geojson                     NPWS fire history
//   fetch-demo-context.mjs   context.json                                roads, fire trails, homes, zones, place names
//   build-demo-provenance.mjs   (provenance.json: sizes and capture dates of every bundled file; not for --out runs)
// The site must be listed in src/data/demoSites.ts first (a lowercase-letters id, the centre; the extent is DEMO_EXTENT_M).
// Files that already exist are left alone unless --force is given, so a site that is already bundled is never overwritten by accident.
// Notes on how each file was made and checked: docs/research/08b-live-endpoint-verification.md and the header of each script.
//
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch-demo-site.mjs [--force] [--out=<dir>] [--skip=terrain,imagery,...] <siteId>
//   --out=<dir> writes <dir>/<id>/... instead (terrain, canopy and context ignore it: they write under public/demo only when
//   no --out is given, so with --out those three are skipped); --skip=<steps> leaves steps out.
import { execFileSync } from 'node:child_process';
import { ROOT, demoSites } from './lib/demoSite.mjs';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const ids = args.filter((a) => !a.startsWith('--'));
const out = flags.find((a) => a.startsWith('--out='));
const skip = (flags.find((a) => a.startsWith('--skip='))?.slice(7) ?? '').split(',').filter(Boolean);
const force = flags.includes('--force');
if (ids.length !== 1 || !demoSites().sites.some((s) => s.id === ids[0])) {
  console.error('usage: node scripts/fetch-demo-site.mjs [--force] [--out=<dir>] [--skip=<steps>] <siteId>   (the site must be in src/data/demoSites.ts)');
  process.exit(2);
}
const id = ids[0];
const common = [...(out ? [out] : []), ...(force ? ['--force'] : [])];
const steps = [
  ['terrain', 'fetch-demo-terrain.mjs', [id], !out],
  ['dem5m', 'fetch-demo-dem5m.mjs', [...common, id], true],
  ['imagery', 'fetch-demo-imagery.mjs', [...common, id], true],
  ['canopy', 'fetch-demo-canopy.mjs', [...(force ? ['--force'] : []), id], !out],
  ['vegetation', 'fetch-demo-vegetation.mjs', [...common, id], true],
  ['fire-history', 'fetch-demo-fire-history.mjs', [...common, id], true],
  ['context', 'fetch-demo-context.mjs', [...(out ? [out] : []), id], true],
  ['provenance', 'build-demo-provenance.mjs', [], !out],
];
for (const [name, script, a, enabled] of steps) {
  if (!enabled || skip.includes(name)) {
    console.log(`--- ${name}: skipped`);
    continue;
  }
  console.log(`--- ${name}`);
  execFileSync(process.execPath, [`${ROOT}scripts/${script}`, ...a], { stdio: 'inherit', cwd: ROOT, env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? '1' } });
}
console.log(`${id}: done`);
