// Stands in for the desktop host on a page opened with ?debug=1 (0.8.0, workstream J): the test seam `window.__firesimRemote =
// { detectHost, connectRemote }`. A plain script, run before the page's own: by the e2e specs (through e2e/desktopStub.ts, which
// sets `window.__desktopStubOptions` first) and by the audit scripts (`--init e2e/desktop-stub.init.js`, default options).
// `detectHost` answers with a host (or none: `noHost`); `connectRemote` accepts one code and hands back a controller that is a small
// fake: it answers `init` and records what the run asks of it on `window.__remote.calls`. Two ways for the link to go, as a real link has:
// `window.__remote.fail(message)` is an engine's error message with the link still open; `window.__remote.close(reason)` ends the link
// (the controller says so with an `error` event, and `onClosed` is called once; `{ quiet: true }` calls `onClosed` only). `failAfterMs`
// (an option, or `?stubfail=N` in the address, for the audit scripts) closes it that long after the engine was initialised.
// `unreachable` (an option, or `?stubunreachable=1`) makes the connection fail; `rateLimited` refuses the code the way the desktop does
// after several wrong ones; `noOnClosed` leaves `onClosed` out (an older module). The code itself is never recorded, only whether it
// was the right one.
(() => {
  const o = window.__desktopStubOptions || {};
  const code = o.code || 'ABCD2345';
  const calls = [];
  const info = { app: 'firesim-desktop-host', protocol: 1, name: o.name || 'Studio PC', cores: o.cores || 8, node: o.node || 'v22.11.0', sessions: 0, maxSessions: 4 };
  let fail = () => undefined;
  let close = () => undefined;
  window.__remote = { calls, fail: (m) => fail(m), close: (reason, how) => close(reason, how) };
  window.__firesimRemote = {
    detectHost: async (opts) => {
      calls.push(['detect', opts]);
      return o.noHost ? null : info;
    },
    connectRemote: async (opts) => {
      calls.push(['connect', { base: opts.base, rightCode: opts.code === code }]);
      calls.push(['info', !!opts.info]); // whether the start-up answer came with it (the connection then does not ask again)
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      if (opts.code !== code || o.rateLimited) {
        const e = new Error('The desktop did not accept the code.');
        e.name = 'RemoteAuthError';
        e.reason = o.rateLimited ? 'rate-limited' : 'wrong-code';
        throw e;
      }
      if (o.unreachable || new URLSearchParams(location.search).get('stubunreachable')) throw new Error('connect failed');
      const listeners = {};
      const emit = (ev, ...a) => (listeners[ev] ? [...listeners[ev]] : []).forEach((cb) => cb(...a));
      const closedCbs = new Set();
      let ended = false;
      fail = (m) => emit('error', m);
      close = (reason = 'The desktop connection closed.', how = {}) => {
        if (ended) return;
        ended = true;
        if (!how.quiet) emit('error', reason);
        for (const cb of [...closedCbs]) cb(reason);
        closedCbs.clear();
      };
      const controller = {
        on: (ev, cb) => {
          (listeners[ev] = listeners[ev] || new Set()).add(cb);
          return () => listeners[ev].delete(cb);
        },
        init: async (scenario) => {
          calls.push(['init', scenario.name]);
          const after = Number(new URLSearchParams(location.search).get('stubfail')) || o.failAfterMs || 0;
          if (after) setTimeout(() => close(), after);
          return [];
        },
        run: (until) => {
          calls.push(['run', until]);
          emit('status', { time: 0, running: true, speed: 60, until });
        },
        pause: () => {
          calls.push(['pause']);
          emit('status', { time: 0, running: false, speed: 0 });
        },
        ignite: (i) => calls.push(['ignite', i.id, i.time]),
        edit: (e, t) => calls.push(['edit', e.id, t]),
        removeEdit: () => undefined,
        removeIgnition: () => undefined,
        rewind: () => undefined,
        setOption: (k, v) => calls.push(['setOption', k, v]),
        setQuality: (tier) => calls.push(['setQuality', tier]),
        explain: () => new Promise(() => undefined),
        dispose: () => calls.push(['dispose']),
      };
      const link = { controller, info, rttMs: () => 3.4, close: () => (ended = true, calls.push(['close'])) };
      if (!o.noOnClosed) link.onClosed = (cb) => (closedCbs.add(cb), () => closedCbs.delete(cb));
      return link;
    },
  };
})();
