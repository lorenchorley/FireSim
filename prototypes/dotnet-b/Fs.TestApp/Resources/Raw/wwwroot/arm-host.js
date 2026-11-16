// Browser-side arm host for the FireSim test app (plan T0.5). Plain script, no bundler.
//
// C# calls (HybridWebView.InvokeJavaScriptAsync, string arguments, string result):
//   fsProbe()                         -> JSON: origin, crossOriginIsolated, typeof SharedArrayBuffer, user agent, extra facts
//   fsRunArm(name, argsJson, runId)   -> JSON: the arm's result, or {"cancelled":true}, or {"error":"..."}
//   fsCancelArm(runId)                -> "ok"
// The page calls C# only with HybridWebView.SendRawMessage(json): {"t":"ready"} once, {"t":"progress","id","f","text"} while an arm runs,
// {"t":"visibility","hidden":bool} on visibilitychange (Android throttles a hidden WebView, so the runner treats it as a pause).
//
// To add an arm: add an entry to window.fsArms below, an async function (args, ctx) that returns a JSON-serialisable object and calls
// ctx.progress(fraction, text) now and then, and checks ctx.cancelled() at each yield (a pause cancels the arm; the block is re-run).
// Then list the arm in the C# plan as new WebArm(host, "<name>", <estimated seconds>). T0.6b adds the real arms.
(function () {
  'use strict';

  const statusEl = document.getElementById('status');
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
    send({ t: 'status', text: String(text).slice(0, 200) });
  }

  function send(obj) {
    try { window.HybridWebView.SendRawMessage(JSON.stringify(obj)); } catch (e) { /* the bridge is not up yet or is gone */ }
  }

  document.addEventListener('visibilitychange', function () {
    send({ t: 'visibility', hidden: document.hidden === true });
  });

  const running = new Map(); // runId -> { cancelled: bool }

  // ---- arms ----
  // The stub: a deterministic integer loop (xorshift mixing) in time slices, yielding between them. It is only a stand-in
  // so the host, progress, cancellation and result path can be tried; it measures nothing meaningful.
  async function stubArm(args, ctx) {
    const slices = Math.max(1, Math.min(200, (args && args.slices) | 0 || 20));
    const perSlice = 200000;
    let x = 0x9E3779B9 | 0;
    const t0 = performance.now();
    for (let s = 0; s < slices; s++) {
      if (ctx.cancelled()) return { cancelled: true };
      for (let i = 0; i < perSlice; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x = (x + i) | 0; }
      ctx.progress((s + 1) / slices, 'slice ' + (s + 1) + ' of ' + slices);
      await new Promise(function (r) { setTimeout(r, 50); });
    }
    return {
      checksum: x >>> 0, slices: slices, iterations: slices * perSlice, elapsedMs: Math.round((performance.now() - t0) * 1000) / 1000,
      crossOriginIsolated: self.crossOriginIsolated === true, sharedArrayBuffer: typeof SharedArrayBuffer,
    };
  }

  window.fsArms = { 'web-stub': stubArm };

  window.fsProbe = async function () {
    let headerSeenByPage = null;
    try {
      // a same-origin fetch of this very page returns the headers the app put on it
      const r = await fetch(location.href, { cache: 'no-store' });
      headerSeenByPage = r.headers.get('document-isolation-policy');
    } catch (e) { headerSeenByPage = 'fetch failed: ' + e; }
    const extra = {
      headerSeenByPage: headerSeenByPage,
      webAssembly: typeof WebAssembly,
      hardwareConcurrency: navigator.hardwareConcurrency | 0,
      // T0.6b adds WebAssembly SIMD and threads feature detection here
    };
    return JSON.stringify({
      origin: location.origin,
      crossOriginIsolated: self.crossOriginIsolated === true,
      sharedArrayBuffer: typeof SharedArrayBuffer,
      userAgent: navigator.userAgent,
      extra: extra,
    });
  };

  window.fsRunArm = async function (name, argsJson, runId) {
    const arm = window.fsArms[name];
    if (!arm) return JSON.stringify({ error: 'unknown arm ' + name });
    let args = {};
    try { args = JSON.parse(argsJson || '{}'); } catch (e) { return JSON.stringify({ error: 'bad arguments: ' + e }); }
    const state = { cancelled: false };
    running.set(runId, state);
    const ctx = {
      cancelled: function () { return state.cancelled; },
      progress: function (f, text) { send({ t: 'progress', id: runId, f: f, text: text || null }); },
    };
    try {
      setStatus('running ' + name);
      const result = await arm(args, ctx);
      return JSON.stringify(result === undefined ? null : result);
    } catch (e) {
      return JSON.stringify({ error: String(e && e.stack ? e.stack : e).slice(0, 1500) });
    } finally {
      running.delete(runId);
      setStatus('idle');
    }
  };

  window.fsCancelArm = function (runId) {
    const s = running.get(runId);
    if (s) s.cancelled = true;
    return 'ok';
  };

  setStatus('arm host ready, origin ' + location.origin + ', crossOriginIsolated ' + (self.crossOriginIsolated === true));
  send({ t: 'ready' });
})();
