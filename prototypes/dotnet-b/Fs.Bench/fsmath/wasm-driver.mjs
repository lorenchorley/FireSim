// T1.3: drives the published Fs.Wasm (FsMathExports) with the fixed input files. Shared by Node and the Chromium page (wasm-run.mjs), so both do exactly the same.
//   ref(exports, io, fns)   for every function and both implementations: Eval over the whole input, the result bits to io.output
//   ns(exports, io, fns, n, repeats)   ns per call from performance.now around Run (the data stays inside WebAssembly): median, min, max over the repeats
// io = { input(fn): Promise<Float64Array>, output(fn, implName, Float64Array): Promise<void> }
export const FNS = ['exp', 'log', 'pow', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10', 'hypot'];
export const ARITY = { pow: 2, atan2: 2, hypot: 2 };
export const IMPLS = ['fdlibm', 'cms'];

export async function ref(E, io, fns = FNS) {
  for (const fn of fns) {
    const x = await io.input(fn);
    if (!x) continue;
    const n = x.length / (ARITY[fn] ?? 1);
    for (let impl = 0; impl < IMPLS.length; impl++) {
      const yb = E.Eval(impl, FNS.indexOf(fn), new Uint8Array(x.buffer, x.byteOffset, x.byteLength), n);
      if (yb.length !== n * 8) throw new Error(`Eval returned ${yb.length} bytes, expected ${n * 8}`);
      await io.output(fn, IMPLS[impl], new Float64Array(yb.buffer.slice(yb.byteOffset, yb.byteOffset + yb.byteLength))); // a copy: the array may be a view of WebAssembly memory
    }
  }
}

export async function ns(E, io, fns = FNS, n = 65536, repeats = 15) {
  const rows = [];
  let sink = 0;
  for (const fn of fns) {
    const full = await io.input(fn);
    if (!full) continue;
    const ar = ARITY[fn] ?? 1;
    const x = full.slice(0, n * ar);
    E.Load(new Uint8Array(x.buffer, x.byteOffset, x.byteLength), n);
    for (let impl = 0; impl < IMPLS.length; impl++) {
      const t = [];
      for (let r = -3; r < repeats; r++) {
        const t0 = performance.now();
        sink += E.Run(impl, FNS.indexOf(fn), n);
        const dt = ((performance.now() - t0) * 1e6) / n;
        if (r >= 0) t.push(dt);
      }
      t.sort((p, q) => p - q);
      rows.push({ fn, impl: IMPLS[impl], n, repeats, nsMedian: t[t.length >> 1], nsMin: t[0], nsMax: t[t.length - 1] });
    }
  }
  return { rows, sink };
}
