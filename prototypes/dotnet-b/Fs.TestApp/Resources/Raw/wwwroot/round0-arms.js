// Round 0's browser-side arms for the FireSim test app (plan T0.6b). Plain script, no bundler; loaded by index.html before arm-host.js.
//
//   webview-facts      what this WebView is and can do: user agent, crossOriginIsolated, SharedArrayBuffer, WebAssembly (SIMD, threads, shared memory, a few more
//                      feature tests), WebGPU adapter, origin, timer resolution, hardware concurrency, Atomics.waitAsync. Every part is its own try/catch: a failure is
//                      recorded under `failures` and the rest still runs, so one round trip says as much as possible.
//   speedtest-kernels  the two frozen speed-test kernels (speedtest.worker.js, built from src/ui/speedTestKernels.ts) in a WebView worker, `runs` times (default 3), one
//                      throwaway worker per run, as the app's own speed test does. Raw numbers and checksums only; the C# side judges them (checksums, medians, ratios).
//
// Also exposes window.fsRound0.quickFeatures() (the synchronous feature tests, used by fsProbe in arm-host.js so they land in webView.extra too).
// Runs unchanged in node for harness/check-round0-js.mjs (every browser-only name is guarded with typeof).
(function (root) {
  'use strict';

  // ---- WebAssembly feature tests: tiny hand-assembled modules (the byte strings of the wasm-feature-detect library) given to WebAssembly.validate ----
  var MODULES = {
    simd: [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11],
    // a function that executes memory.atomic.notify on a shared memory: needs the threads proposal (atomics and shared memory)
    threads: [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11],
    // only a memory section with the shared flag (memory 1 1 shared)
    sharedMemoryModule: [0, 97, 115, 109, 1, 0, 0, 0, 5, 4, 1, 3, 1, 1],
    bulkMemory: [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 10, 14, 1, 12, 0, 65, 0, 65, 0, 65, 0, 252, 10, 0, 0, 11],
    relaxedSimd: [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11],
  };

  function validates(bytes) {
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.validate !== 'function') return null;
    try { return WebAssembly.validate(new Uint8Array(bytes)) === true; } catch (e) { return 'error: ' + short(e); }
  }

  function short(e) { return String(e && e.message ? e.name + ': ' + e.message : e).slice(0, 300); }
  function typeOf(name) { try { return typeof root[name]; } catch (e) { return 'error'; } }

  // The synchronous part: no awaits, no timing. Cheap enough to run before every arm and in the first probe.
  function quickFeatures() {
    var out = { failures: [] };
    function part(name, fn) { try { out[name] = fn(); } catch (e) { out.failures.push({ part: name, error: short(e) }); } }
    part('crossOriginIsolated', function () { return root.crossOriginIsolated === true; });
    part('sharedArrayBuffer', function () { return typeOf('SharedArrayBuffer'); });
    part('sharedArrayBufferConstructs', function () {
      if (typeof SharedArrayBuffer !== 'function') return false;
      var s = new SharedArrayBuffer(16);
      return s.byteLength === 16;
    });
    part('webAssembly', function () { return typeOf('WebAssembly'); });
    part('wasmSimd', function () { return validates(MODULES.simd); });
    part('wasmThreads', function () { return validates(MODULES.threads); });
    part('wasmSharedMemoryModule', function () { return validates(MODULES.sharedMemoryModule); });
    part('wasmSharedMemoryConstructs', function () {
      if (typeof WebAssembly !== 'object' || typeof WebAssembly.Memory !== 'function') return null;
      try {
        var m = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
        return typeof SharedArrayBuffer === 'function' && m.buffer instanceof SharedArrayBuffer;
      } catch (e) { return 'error: ' + short(e); }
    });
    part('wasmBulkMemory', function () { return validates(MODULES.bulkMemory); });
    part('wasmRelaxedSimd', function () { return validates(MODULES.relaxedSimd); });
    part('atomics', function () { return typeOf('Atomics'); });
    part('atomicsWaitAsync', function () { return typeof Atomics === 'object' ? typeof Atomics.waitAsync : 'no Atomics'; });
    return out;
  }

  // The smallest step performance.now() takes (a coarse timer is a sign of no cross-origin isolation: Chrome rounds to 100 us when not isolated, 5 us when isolated).
  function timerResolution() {
    if (typeof performance !== 'object' || typeof performance.now !== 'function') return { error: 'no performance.now' };
    var deltas = new Map();
    var min = Infinity;
    var last = performance.now();
    var t0 = last;
    var calls = 0;
    while (calls < 200000 && last - t0 < 30) {
      var t = performance.now();
      calls++;
      var d = t - last;
      if (d > 0) {
        if (d < min) min = d;
        deltas.set(d, (deltas.get(d) || 0) + 1);
      }
      last = t;
    }
    return { minStepMs: Number.isFinite(min) ? min : null, distinctSteps: deltas.size, calls: calls, spanMs: last - t0 };
  }

  function withTimeout(promise, ms, what) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error(what + ' did not answer within ' + ms + ' ms')); }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }

  async function webGpu() {
    if (typeof navigator !== 'object' || !navigator || typeof navigator.gpu === 'undefined') return { present: false };
    var out = { present: true, typeofGpu: typeof navigator.gpu };
    try { out.preferredCanvasFormat = navigator.gpu.getPreferredCanvasFormat ? navigator.gpu.getPreferredCanvasFormat() : null; } catch (e) { out.preferredCanvasFormat = 'error: ' + short(e); }
    try {
      var adapter = await withTimeout(navigator.gpu.requestAdapter(), 4000, 'requestAdapter');
      if (!adapter) { out.adapter = null; return out; }
      var info = adapter.info;
      if (!info && typeof adapter.requestAdapterInfo === 'function') info = await withTimeout(adapter.requestAdapterInfo(), 2000, 'requestAdapterInfo');
      out.adapter = {};
      if (info) {
        ['vendor', 'architecture', 'device', 'description', 'subgroupMinSize', 'subgroupMaxSize', 'isFallbackAdapter'].forEach(function (k) {
          if (info[k] !== undefined && info[k] !== '') out.adapter[k] = info[k];
        });
      }
      if (adapter.isFallbackAdapter !== undefined) out.adapter.isFallbackAdapter = adapter.isFallbackAdapter;
      try { out.adapter.features = Array.from(adapter.features || []).map(String).sort().slice(0, 64); } catch (e) { out.adapter.features = 'error: ' + short(e); }
      try {
        var lim = adapter.limits || {};
        out.adapter.limits = {};
        ['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupStorageSize', 'maxTextureDimension2D'].forEach(function (k) {
          if (lim[k] !== undefined) out.adapter.limits[k] = lim[k];
        });
      } catch (e) { out.adapter.limits = 'error: ' + short(e); }
    } catch (e) { out.adapterError = short(e); }
    return out;
  }

  async function webviewFacts(args, ctx) {
    var failures = [];
    var out = { schema: 1, failures: failures };
    async function part(name, fn) {
      try { out[name] = await fn(); } catch (e) { failures.push({ part: name, error: short(e) }); }
    }
    ctx.progress(0.05, 'page and browser');
    await part('page', async function () {
      var p = {};
      // a same-origin fetch of this page returns the headers the app put on it (what the page can see of the isolation header)
      if (typeof location === 'object' && location && typeof fetch === 'function') {
        try {
          var r = await withTimeout(fetch(location.href, { cache: 'no-store' }), 4000, 'fetch of the page');
          p.headerSeenByPage = r.headers.get('document-isolation-policy');
          p.coepSeenByPage = r.headers.get('cross-origin-embedder-policy');
        } catch (e) { p.headerSeenByPage = 'fetch failed: ' + short(e); }
      }
      if (typeof location === 'object' && location) { p.origin = location.origin; p.protocol = location.protocol; p.href = String(location.href).slice(0, 200); }
      if (typeof isSecureContext !== 'undefined') p.isSecureContext = isSecureContext === true;
      if (typeof document === 'object' && document) p.visibilityState = document.visibilityState;
      if (typeof devicePixelRatio === 'number') p.devicePixelRatio = devicePixelRatio;
      if (typeof screen === 'object' && screen) { p.screenWidth = screen.width; p.screenHeight = screen.height; }
      return p;
    });
    await part('navigator', function () {
      var n = typeof navigator === 'object' && navigator ? navigator : {};
      var ua = String(n.userAgent || '').slice(0, 512);
      var m = /Chrome\/([0-9.]+)/.exec(ua);
      var o = { userAgent: ua, chromeVersion: m ? m[1] : null, isWebViewUserAgent: / wv\)/.test(ua) || /Version\/[0-9.]+ Chrome\//.test(ua), hardwareConcurrency: n.hardwareConcurrency | 0 };
      if (n.deviceMemory !== undefined) o.deviceMemoryGb = n.deviceMemory;
      if (n.userAgentData && n.userAgentData.brands) o.brands = n.userAgentData.brands.map(function (b) { return b.brand + ' ' + b.version; });
      if (n.userAgentData) o.mobile = n.userAgentData.mobile;
      o.language = n.language;   // recorded for the reader; nothing in a result depends on it
      return o;
    });
    ctx.progress(0.2, 'isolation and shared memory');
    await part('features', function () { var f = quickFeatures(); var fl = f.failures; delete f.failures; if (fl.length) failures.push({ part: 'features', error: JSON.stringify(fl).slice(0, 400) }); return f; });
    ctx.progress(0.4, 'timer');
    await part('timer', timerResolution);
    ctx.progress(0.55, 'WebGPU');
    await part('webgpu', webGpu);
    ctx.progress(0.9, 'workers');
    await part('workers', function () {
      return { typeofWorker: typeOf('Worker'), typeofOffscreenCanvas: typeOf('OffscreenCanvas'), typeofBlob: typeOf('Blob'), typeofCreateObjectURL: typeof URL === 'function' ? typeof URL.createObjectURL : 'no URL' };
    });
    ctx.progress(1, 'done');
    return out;
  }

  // ---- the frozen kernels in a worker ----
  var WORKER_URL = 'speedtest.worker.js';
  var RUN_TIMEOUT_MS = 40000;

  // One run in one throwaway worker. Resolves { message, how } or rejects with { startError } when the worker never started.
  function runInWorker(how, scriptText, ctx) {
    return new Promise(function (resolve, reject) {
      var worker = null;
      var blobUrl = null;
      var finished = false;
      var poll = null;
      var timer = null;
      function done(fn, value) {
        if (finished) return;
        finished = true;
        if (poll) clearInterval(poll);
        if (timer) clearTimeout(timer);
        try { if (worker) worker.terminate(); } catch (e) { /* ignore */ }
        try { if (blobUrl) URL.revokeObjectURL(blobUrl); } catch (e) { /* ignore */ }
        fn(value);
      }
      try {
        if (how === 'blob') {
          blobUrl = URL.createObjectURL(new Blob([scriptText], { type: 'text/javascript' }));
          worker = new Worker(blobUrl);
        } else {
          worker = new Worker(WORKER_URL);
        }
      } catch (e) { done(reject, { startError: how + ': ' + short(e) }); return; }
      worker.onmessage = function (ev) { done(resolve, { message: ev.data, how: how }); };
      worker.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        done(reject, { startError: how + ': worker error: ' + String((ev && ev.message) || 'no message').slice(0, 200) + (ev && ev.filename ? ' at ' + ev.filename + ':' + ev.lineno : '') });
      };
      poll = setInterval(function () { if (ctx.cancelled()) done(resolve, { cancelled: true }); }, 100);
      timer = setTimeout(function () { done(reject, { startError: how + ': no answer within ' + RUN_TIMEOUT_MS + ' ms' }); }, RUN_TIMEOUT_MS);
      try { worker.postMessage('run'); } catch (e) { done(reject, { startError: how + ': postMessage: ' + short(e) }); }
    });
  }

  async function speedtestKernels(args, ctx) {
    var runs = Math.max(1, Math.min(10, (args && args.runs) | 0 || 3));
    var out = { schema: 1, bundle: WORKER_URL, runsRequested: runs, runs: [], startNotes: [], crossOriginIsolated: root.crossOriginIsolated === true };
    if (typeof Worker !== 'function') throw new Error('this WebView has no Worker');
    var mode = 'url';
    var scriptText = null;
    for (var r = 0; r < runs; r++) {
      if (ctx.cancelled()) return { cancelled: true };
      ctx.progress(r / runs, 'kernels, run ' + (r + 1) + ' of ' + runs);
      var wall0 = performance.now();
      var got = null;
      try { got = await runInWorker(mode, scriptText, ctx); }
      catch (e) {
        out.startNotes.push(e && e.startError ? e.startError : short(e));
        if (mode === 'url') {
          // the script URL may be refused (isolation rules for worker scripts); the same text from a blob is the fallback
          mode = 'blob';
          try {
            var resp = await fetch(WORKER_URL, { cache: 'no-store' });
            if (!resp.ok) throw new Error('fetch ' + WORKER_URL + ' answered ' + resp.status);
            scriptText = await resp.text();
            got = await runInWorker(mode, scriptText, ctx);
          } catch (e2) {
            out.startNotes.push(e2 && e2.startError ? e2.startError : 'blob fallback: ' + short(e2));
            throw new Error('the speed-test worker could not be started: ' + out.startNotes.join(' | '));
          }
        } else {
          throw new Error('the speed-test worker could not be started: ' + out.startNotes.join(' | '));
        }
      }
      if (got.cancelled) return { cancelled: true };
      var m = got.message || {};
      if (m.error) throw new Error('the worker failed: ' + m.error);
      out.runs.push({
        started: got.how, stencilMcellsPerS: m.stencilMcellsPerS, copyGBps: m.copyGBps, stencilAfter3: m.stencilAfter3, copyAfter2: m.copyAfter2,
        measureMs: m.measureMs, verifyMs: m.verifyMs, wallMs: performance.now() - wall0, warmMs: m.warmMs, timeMs: m.timeMs, kernelsSha256: m.kernelsSha256,
      });
      // a short gap lets the page and the bridge breathe between runs (it is outside every timed phase)
      await new Promise(function (res) { setTimeout(res, 50); });
    }
    ctx.progress(1, 'kernels done');
    return out;
  }

  var arms = root.fsArms || (root.fsArms = {});
  arms['webview-facts'] = webviewFacts;
  arms['speedtest-kernels'] = speedtestKernels;
  root.fsRound0 = { quickFeatures: quickFeatures, webviewFacts: webviewFacts, speedtestKernels: speedtestKernels, timerResolution: timerResolution, MODULES: MODULES };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
