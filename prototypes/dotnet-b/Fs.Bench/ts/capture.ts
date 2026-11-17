/**
 * Stage 1 fixture capture: runs the Katoomba 6 km fast-tier scenario (same set-up as profile.ts) and records every input and output of
 * `PyrogenicPotential.solve` (src/atmosphere/pyrogenic.ts, the fast tier's fire-induced-wind potential solve, the chosen kernel) by wrapping the
 * method on the prototype from outside (nothing in src/ is edited; the original code runs and its results are copied).
 *   node capture.mjs OUT_DIR
 * Writes OUT_DIR/data.bin (little-endian typed arrays, each 8-byte aligned) and OUT_DIR/header.json (names, types, lengths, byte offsets).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Simulation } from '../../../../src/sim/simulation';
import { demoScenario, withIgnitions } from '../../../../src/sim/testing/scenarios';
import { PyrogenicPotential } from '../../../../src/atmosphere/pyrogenic';
import { ATMOS_PARAMS } from '../../../../src/atmosphere/params';

const outDir = process.argv[2]!;
mkdirSync(outDir, { recursive: true });
const WANT = [300, 900, 1500]; // simulated seconds: young, mid-run (the representative one) and late front

const base = await demoScenario({ startCivil: [2025, 12, 20, 12], extent: 6000, tier: 'fast', duration: 3600 });
const scenario = withIgnitions(base, [{ id: 'line', kind: 'line', points: [[-570, -450], [-350, -230]], time: 0, origin: 'observed' }], { snapshotInterval: 60, tier: 'fast', seed: 11 });
const sim = new Simulation(scenario, { tier: 'fast' });

interface Rec { t: number; q: Float32Array; psi: Float64Array; up: Float32Array; vp: Float32Array; nx: number; ny: number; cx: number; cy: number; h: number }
const recs: Rec[] = [];
const proto = PyrogenicPotential.prototype as unknown as { solve: (q: Float32Array) => void };
const orig = proto.solve;
proto.solve = function (this: PyrogenicPotential, q: Float32Array): void {
  orig.call(this, q);
  recs.push({ t: sim.time, q: q.slice(), psi: this.psi.slice(), up: this.up.slice(), vp: this.vp.slice(), nx: this.fire.nx, ny: this.fire.ny, cx: this.nx, cy: this.ny, h: this.fire.cellSize });
};
sim.spinUp();
sim.advance(1800);
if (recs.length === 0) throw new Error('solve was never called');

const chosen: Rec[] = [];
for (const w of WANT) {
  let best = recs[0]!;
  for (const r of recs) if (Math.abs(r.t - w) < Math.abs(best.t - w) && r.q.some((v) => v > 0)) best = r;
  chosen.push(best);
}

type Arr = Float32Array | Float64Array;
const chunks: Uint8Array[] = [];
const arrays: { name: string; type: 'float32' | 'float64'; length: number; byteOffset: number }[] = [];
let off = 0;
const add = (name: string, a: Arr): void => {
  const pad = (8 - (off % 8)) % 8;
  if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  chunks.push(bytes.slice());
  arrays.push({ name, type: a instanceof Float32Array ? 'float32' : 'float64', length: a.length, byteOffset: off });
  off += bytes.byteLength;
};
const cases = chosen.map((r, i) => {
  add(`case${i}.q`, r.q);
  add(`case${i}.psi`, r.psi);
  add(`case${i}.up`, r.up);
  add(`case${i}.vp`, r.vp);
  return { name: `case${i}`, simTimeS: r.t, nonZeroSourceCells: r.q.reduce((n, v) => n + (v > 0 ? 1 : 0), 0), maxQ: r.q.reduce((m, v) => (v > m ? v : m), 0) };
});
const r0 = chosen[0]!;
const header = {
  kernel: 'PyrogenicPotential.solve (src/atmosphere/pyrogenic.ts): fire heat flux q -> coarse Poisson potential psi (separable DST) -> u_p, v_p on the fire grid',
  endianness: 'little',
  scenario: 'Katoomba demo, 6 km, fast tier, seed 11, civil start 2025-12-20 12:00, 310 m ignition line (-570,-450)->(-350,-230) at t=0, snapshot interval 60 s',
  fireNx: r0.nx, fireNy: r0.ny, cellSizeM: r0.h, coarseNx: r0.cx, coarseNy: r0.cy,
  pyroK: ATMOS_PARAMS.pyroK, pyroMax: ATMOS_PARAMS.pyroMax,
  callsCaptured: recs.length,
  cases,
  arrays,
  dataFile: 'data.bin',
};
writeFileSync(`${outDir}/data.bin`, Buffer.concat(chunks));
writeFileSync(`${outDir}/header.json`, JSON.stringify(header, null, 1));
console.log('captured', recs.length, 'calls; wrote', cases.map((c) => `${c.name} t=${c.simTimeS} nz=${c.nonZeroSourceCells}`).join(', '), `bytes=${off}`);
process.exit(0);
