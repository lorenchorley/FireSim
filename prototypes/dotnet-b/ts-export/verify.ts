/**
 * Fixture self-check (stage 3a): decodes every file of a fixture with the app's own codec and checks that
 *   - init.bin decodes to an `init` message whose scenario has the grid and ignitions of meta.json and ignitions.json,
 *   - every snap-<t>.bin decodes to a `snapshot` message of time t whose `snapshotHash` equals hashes.json[t],
 *   - arrival.f32 equals the last snapshot's arrivalTime (unburnt, +Infinity, written as -1).
 *
 *   node run.mjs verify --out FIXTURES_DIR [NAME ...]      (all fixtures in the folder when no NAME is given)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeMessage } from '../../../src/sim/remote/codec';
import { snapshotHash } from '../../../src/sim/testing/hash';
import type { SimSnapshot } from '../../../src/core/types';

const out = process.argv[2]!;
const names = process.argv.slice(3);
const dirs = names.length ? names : readdirSync(out).filter((n) => existsSync(join(out, n, 'meta.json')));
let bad = 0;
for (const name of dirs) {
  const dir = join(out, name);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const hashes = JSON.parse(readFileSync(join(dir, 'hashes.json'), 'utf8')) as Record<string, number>;
  const problems: string[] = [];
  const init = decodeMessage(new Uint8Array(readFileSync(join(dir, 'init.bin')))) as { type: string; scenario?: { terrain: { grid: { nx: number } }; ignitions: unknown[] } };
  if (init.type !== 'init') problems.push(`init.bin is a ${init.type} message`);
  if (init.scenario?.terrain.grid.nx !== meta.fireGrid.nx) problems.push('init terrain grid differs from meta.fireGrid');
  if (JSON.stringify(init.scenario?.ignitions) !== JSON.stringify(JSON.parse(readFileSync(join(dir, 'ignitions.json'), 'utf8')))) problems.push('init ignitions differ from ignitions.json');
  let last: SimSnapshot | undefined;
  for (const t of Object.keys(hashes).map(Number).sort((a, b) => a - b)) {
    const m = decodeMessage(new Uint8Array(readFileSync(join(dir, `snap-${t}.bin`)))) as { type: string; snapshot?: SimSnapshot };
    if (m.type !== 'snapshot' || !m.snapshot) {
      problems.push(`snap-${t}.bin is a ${m.type} message`);
      continue;
    }
    if (m.snapshot.time !== t) problems.push(`snap-${t}.bin has time ${m.snapshot.time}`);
    const h = snapshotHash(m.snapshot);
    if (h !== hashes[String(t)]) problems.push(`snap-${t}.bin hash ${h} != ${hashes[String(t)]}`);
    last = m.snapshot;
  }
  const b = readFileSync(join(dir, 'arrival.f32'));
  const arr = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (!last || arr.length !== last.fire.arrivalTime.length) problems.push('arrival.f32 length differs from the last snapshot');
  else for (let i = 0; i < arr.length; i++) {
    const a = last.fire.arrivalTime[i]!;
    if (arr[i] !== (Number.isFinite(a) ? a : -1)) {
      problems.push(`arrival.f32[${i}] = ${arr[i]} but the snapshot has ${a}`);
      break;
    }
  }
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}: ${Object.keys(hashes).length} snapshots${problems.length ? '\n  ' + problems.join('\n  ') : ''}`);
  if (problems.length) bad++;
}
process.exit(bad ? 1 : 0);
