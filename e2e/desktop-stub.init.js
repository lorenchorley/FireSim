// Stands in for the desktop host on a page opened with ?debug=1 (0.8.0, workstream J): the test seam `window.__firesimRemote =
// { detectHost, connectRemote }`. A plain script, run before the page's own: by the e2e specs (through e2e/desktopStub.ts, which
// sets `window.__desktopStubOptions` first) and by the audit scripts (`--init e2e/desktop-stub.init.js`, default options).
// `detectHost` answers with a host (or none: `noHost`); `connectRemote` accepts one code and hands back a controller that is a small
// fake: it answers `init`, records what the run asks of it on `window.__remote.calls`, and fails like a closed link on
// `window.__remote.fail(message)`. The code itself is never recorded, only whether it was the right one.
(() => {
  const o = window.__desktopStubOptions || {};
  const code = o.code || 'ABCD2345';
  const calls = [];
  const info = { app: 'firesim-desktop-host', protocol: 1, name: o.name || 'Studio PC', cores: o.cores || 8, node: o.node || 'v22.11.0', sessions: 0, maxSessions: 4 };
  let fail = () => undefined;
  window.__remote = { calls, fail: (m) => fail(m) };
  window.__firesimRemote = {
    detectHost: async (opts) => {
      calls.push(['detect', opts]);
      return o.noHost ? null : info;
    },
    connectRemote: async (opts) => {
      calls.push(['connect', { base: opts.base, rightCode: opts.code === code }]);
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      if (opts.code !== code) {
        const e = new Error('The desktop did not accept the code.');
        e.name = 'RemoteAuthError';
        throw e;
      }
      if (o.unreachable) throw new Error('connect failed');
      const listeners = {};
      const emit = (ev, ...a) => (listeners[ev] ? [...listeners[ev]] : []).forEach((cb) => cb(...a));
      fail = (m) => emit('error', m);
      const controller = {
        on: (ev, cb) => {
          (listeners[ev] = listeners[ev] || new Set()).add(cb);
          return () => listeners[ev].delete(cb);
        },
        init: async (scenario) => {
          calls.push(['init', scenario.name]);
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
        ignite: () => calls.push(['ignite']),
        edit: () => calls.push(['edit']),
        removeEdit: () => undefined,
        removeIgnition: () => undefined,
        rewind: () => undefined,
        setOption: () => undefined,
        setQuality: (tier) => calls.push(['setQuality', tier]),
        explain: () => new Promise(() => undefined),
        dispose: () => calls.push(['dispose']),
      };
      return { controller, info, rttMs: () => 3.4, close: () => calls.push(['close']) };
    },
  };
})();
