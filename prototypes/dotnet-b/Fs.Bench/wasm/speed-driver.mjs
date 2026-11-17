// T1.6a: the timing driver shared by Node and the Chromium worker (speed-run.mjs loads it in both, so both do exactly the same).
//   suite(TS, E, cfg, log)  A B B A: the TypeScript frozen kernels (TS = the FsKernels global built from src/ui/speedTestKernels.ts, unmodified) and the .NET build (E =
//                           the Fs.Wasm SpeedTestExports of the published WebAssembly) in the SAME engine, on the same input (the fixed seed), kernel call only, data resident.
// One sample = `per` whole sweeps between two performance.now() reads (so Chromium's coarse 0.1 ms timer is under 1 % of a sample), reported as ms per sweep.
// One block = warm-up, then `samples` samples; its value is the median sample. One round of a series = TypeScript, .NET, .NET, TypeScript (four blocks); its
// ratio is mean(.NET blocks) / mean(TypeScript blocks). Gate 1W's bar is ratio <= 1.25 (plan section 4).
export const FROZEN = { stencil: 0x7d268009, copy: 0x1e84aad9 };
export const KERNELS = {
  stencil: { name: 'stencil', id: 0, label: 'K1 stencil', sumSweeps: 3, make: (TS) => TS.makeStencilKernel() },
  copy: { name: 'copy', id: 1, label: 'K2 copy', sumSweeps: 2, make: (TS) => TS.makeCopyKernel() },
};
export const PATHS = ['scalar', 'vector128', 'plain'];

const now = () => performance.now();
const sorted = (a) => [...a].sort((p, q) => p - q);
export const median = (a) => sorted(a)[a.length >> 1];
const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
const hex8 = (x) => '0x' + (x >>> 0).toString(16).padStart(8, '0');
let sink = 0;

function warm(fn, cfg) {
  const t0 = now();
  let n = 0;
  while (n < cfg.warmMin || now() - t0 < cfg.warmMs) { fn(); n++; }
}

function sample(fn, per, count) {
  const ms = [];
  for (let i = 0; i < count; i++) {
    const t0 = now();
    fn();
    ms.push((now() - t0) / per);
  }
  return ms;
}

function summarise(ms) {
  const s = sorted(ms);
  return { median: s[s.length >> 1], min: s[0], max: s[s.length - 1], samples: ms };
}

/** One TypeScript block: a fresh kernel from the fixed seed, warmed, then timed. */
function tsBlock(TS, kk, cfg) {
  if (cfg.gc && globalThis.gc) globalThis.gc();
  const k = kk.make(TS);
  const per = cfg.tsPer[kk.name];
  const run = () => TS.sweeps(k, per);
  warm(run, cfg);
  const r = summarise(sample(run, per, cfg.samples));
  sink += k.values()[0];
  return r;
}

/** One .NET block: a fresh kernel built inside WebAssembly, warmed, then timed (the call returns a result word). */
function netBlock(E, kk, path, cfg) {
  if (cfg.gc && globalThis.gc) globalThis.gc();
  E.Load(kk.id, path);
  const per = cfg.netPer[kk.name];
  const run = () => { sink += E.Run(per) | 0; };
  warm(run, cfg);
  return summarise(sample(run, per, cfg.samples));
}

export function checksums(TS, E, paths) {
  const out = { ts: {}, net: {}, ok: true };
  for (const [name, kk] of Object.entries(KERNELS)) {
    const k = kk.make(TS);
    TS.sweeps(k, kk.sumSweeps);
    out.ts[name] = hex8(k.checksum());
    if (k.checksum() !== FROZEN[name]) out.ok = false;
    out.net[name] = {};
    for (const p of paths[name]) {
      E.Load(kk.id, PATHS.indexOf(p));
      E.Run(kk.sumSweeps);
      const c = E.Checksum() >>> 0;
      out.net[name][p] = hex8(c);
      if (c !== FROZEN[name]) out.ok = false;
    }
  }
  out.expected = { stencil: hex8(FROZEN.stencil), copy: hex8(FROZEN.copy) };
  return out;
}

/** The end-to-end rows: a byte[] argument of the kernel's input size copied by the marshaller (sweeps 0 = the copy and the call only), and the same call with one sweep. */
function endToEnd(E, kk, cfg) {
  const bytes = E.InputBytes(kk.id);
  const payload = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i += 4096) payload[i] = i >> 12;
  payload[bytes - 1] = 7;
  E.Load(kk.id, 0);
  const t = {};
  for (const [label, sweeps] of [['copyOnly', 0], ['copyPlusOneSweep', 1]]) {
    const run = () => { sink += E.Call(payload, sweeps) | 0; };
    warm(run, { warmMin: 2, warmMs: 0 });
    t[label] = summarise(sample(run, 1, cfg.e2eSamples));
  }
  return { bytes, ...t };
}

export function suite(TS, E, cfg, log = () => {}) {
  const paths = cfg.paths;
  const result = { cfg, checksums: checksums(TS, E, paths), series: [], endToEnd: [] };
  log('checksums ' + JSON.stringify(result.checksums.net) + ' ts ' + JSON.stringify(result.checksums.ts) + ' ok=' + result.checksums.ok);
  if (!result.checksums.ok) return result;
  const series = [];
  for (const name of Object.keys(KERNELS)) for (const p of paths[name]) series.push({ kernel: name, path: p, rounds: [] });
  for (let r = 0; r < cfg.rounds; r++) {
    for (const s of series) {
      const kk = KERNELS[s.kernel];
      const pi = PATHS.indexOf(s.path);
      const a1 = tsBlock(TS, kk, cfg);
      const b1 = netBlock(E, kk, pi, cfg);
      const b2 = netBlock(E, kk, pi, cfg);
      const a2 = tsBlock(TS, kk, cfg);
      const tsMs = mean([a1.median, a2.median]);
      const netMs = mean([b1.median, b2.median]);
      s.rounds.push({ order: 'TS NET NET TS', ts: [a1, a2], net: [b1, b2], tsMs, netMs, ratio: netMs / tsMs });
      log(`round ${r + 1}/${cfg.rounds} ${s.kernel}/${s.path}: ts ${tsMs.toFixed(3)} ms  net ${netMs.toFixed(3)} ms  ratio ${(netMs / tsMs).toFixed(3)}`);
    }
    for (const name of Object.keys(KERNELS)) result.endToEnd[r] = { ...(result.endToEnd[r] ?? {}), [name]: endToEnd(E, KERNELS[name], cfg) };
  }
  for (const s of series) {
    const ratios = s.rounds.map((x) => x.ratio);
    s.summary = {
      ratioMedian: median(ratios), ratioMin: Math.min(...ratios), ratioMax: Math.max(...ratios), ratios,
      tsMsMedian: median(s.rounds.map((x) => x.tsMs)), tsMsMin: Math.min(...s.rounds.map((x) => x.tsMs)), tsMsMax: Math.max(...s.rounds.map((x) => x.tsMs)),
      netMsMedian: median(s.rounds.map((x) => x.netMs)), netMsMin: Math.min(...s.rounds.map((x) => x.netMs)), netMsMax: Math.max(...s.rounds.map((x) => x.netMs)),
    };
  }
  result.series = series;
  result.sink = sink;
  return result;
}

/**
 * TypeScript alone (no WebAssembly loaded in this process or worker): the same blocks, 2 x rounds of them per kernel. Needed because the in-process A B B A reference is
 * disturbed by the .NET runtime having run in the same process (Node: the TypeScript copy kernel is about 45 % slower once Mono WebAssembly has run the 16 MiB copy, section
 * 5 of the report), which would flatter the .NET side.
 */
export function tsAlone(TS, cfg, log = () => {}) {
  const out = { cfg, kernels: {} };
  for (const [name, kk] of Object.entries(KERNELS)) {
    const blocks = [];
    for (let i = 0; i < cfg.rounds * 2; i++) { blocks.push(tsBlock(TS, kk, cfg)); log(`ts alone ${name} block ${i + 1}: ${blocks.at(-1).median.toFixed(3)} ms/sweep`); }
    const meds = blocks.map((b) => b.median);
    out.kernels[name] = { median: median(meds), min: Math.min(...meds), max: Math.max(...meds), blocks: meds };
  }
  out.sink = sink;
  return out;
}
