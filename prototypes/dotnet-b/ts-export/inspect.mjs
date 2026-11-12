#!/usr/bin/env node
/**
 * `node inspect.mjs FILE.bin [--json]`: lists the structure of a codec frame (init.bin, snap-<t>.bin): every field path, scalar values and, for every
 * typed array, its kind, element count and byte offset in the body. A C# reader can be checked against this listing. With --json the header JSON
 * itself is printed (typed arrays as the {"$ta":...} placeholders).
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: inspect.mjs FILE.bin [--json]');
  process.exit(2);
}
const b = readFileSync(file);
const H = b.readUInt32LE(0);
const tree = JSON.parse(b.subarray(4, 4 + H).toString('utf8'));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(tree, null, 1));
  process.exit(0);
}
const lines = [];
function walk(v, p) {
  if (v && typeof v === 'object') {
    if ('$ta' in v) return void lines.push(`${p}: ${v.$ta}[${v.n}] at body+${v.o}`);
    if ('$num' in v) return void lines.push(`${p}: number ${v.$num}`);
    if (Array.isArray(v)) {
      if (v.length === 0) return void lines.push(`${p}: []`);
      if (typeof v[0] !== 'object' || v[0] === null) return void lines.push(`${p}: array(${v.length}) of ${typeof v[0]}, first ${JSON.stringify(v.slice(0, 3))}`);
      lines.push(`${p}: array(${v.length}) of objects, element 0 follows`);
      return walk(v[0], `${p}[0]`);
    }
    for (const k of Object.keys(v)) walk(v[k], p ? `${p}.${k}` : k);
    return;
  }
  lines.push(`${p}: ${typeof v === 'string' ? JSON.stringify(v).slice(0, 100) : v}`);
}
walk(tree, '');
console.log(`file ${b.length} bytes; header ${H} bytes; body starts at ${Math.ceil((4 + H) / 8) * 8}`);
console.log(lines.join('\n'));
