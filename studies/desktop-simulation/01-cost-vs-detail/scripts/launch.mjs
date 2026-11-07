// Runs ONE measurement row in its own Node process: a Vite SSR server loads the TypeScript of src/ (no new dependency,
// the repo's own vite) and calls row.ts with the row's JSON spec; the result is written as JSON.
//
//   node --expose-gc studies/desktop-simulation/01-cost-vs-detail/scripts/launch.mjs <spec.json> <out.json>
//
// Overrides of src/scenario/params.ts live HERE, as a build-time text patch seen only by this process (src/ is not changed):
//   spec.cell < 30   highDetailCellM -> spec.cell and highDetailMaxExtentM -> 12000 (the builder then returns that cell
//                    for any extent; without it only 20 m up to 6 km is reachable)
//   spec.hiResCellM  hiResCellM -> that value (only for the 15 m row: the builder needs a fire cell that is a whole
//                    multiple of the DEM cell, so 15 m needs a 5 m DEM grid)
import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const [specPath, outPath] = process.argv.slice(2);
if (!specPath || !outPath) throw new Error('usage: launch.mjs <spec.json> <out.json>');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

function patchParams() {
  return {
    name: 'study-patch-scenario-params',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]src[\\/]scenario[\\/]params\.ts$/.test(id.split('?')[0])) return null;
      let out = code;
      const swap = (from, to) => {
        if (!out.includes(from)) throw new Error(`params.ts no longer contains "${from}": update the patch`);
        out = out.replace(from, to);
      };
      if (spec.cell && spec.cell < 30) {
        swap('highDetailCellM: 20,', `highDetailCellM: ${spec.cell},`);
        swap('highDetailMaxExtentM: 6000,', 'highDetailMaxExtentM: 12000,');
      }
      if (spec.hiResCellM) swap('hiResCellM: 10,', `hiResCellM: ${spec.hiResCellM},`);
      return { code: out, map: null };
    },
  };
}

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { '@': resolve(root, 'src') } },
  plugins: [patchParams()],
});
let result;
try {
  const mod = await server.ssrLoadModule('/studies/desktop-simulation/01-cost-vs-detail/scripts/row.ts');
  result = await mod.default(spec);
} catch (e) {
  result = { spec, error: String(e && e.stack ? e.stack : e) };
} finally {
  await server.close();
}
writeFileSync(outPath, JSON.stringify(result));
console.log(result.error ? `FAILED ${spec.id}: ${String(result.error).split('\n')[0]}` : `ok ${spec.id}`);
process.exit(result.error ? 1 : 0);
