// Stands in for the desktop host on a page opened with ?debug=1 (0.8.0, workstream J; protocol 2 since 0.9.0): the test seam `window.__firesimRemote =
// { detectHost, connectRemote, reach }`. A plain script, run before the page's own: by the e2e specs (through e2e/desktopStub.ts, which
// sets `window.__desktopStubOptions` first) and by the audit scripts (`--init e2e/desktop-stub.init.js`, default options).
// It speaks what protocol 2 of the host says (docs/plans/0.9.0/CONTRACT-0.9.0.md section 4.2): `detectHost` answers with the probe
// `{ app, protocol: 2, requiresCode }` and nothing of the host's name (or none: `noHost`); `connectRemote` accepts one code and hands back a link whose
// `info` (name, cores, Node, sessions) is what the welcome says, and a controller that is a small fake: it answers `init` and records what the
// run asks of it on `window.__remote.calls`. Two ways for the link to go, as a real link has: `window.__remote.fail(message)` is an engine's error
// message with the link still open; `window.__remote.close(reason)` ends the link (the controller says so with an `error` event, and `onClosed` is called
// once; `{ quiet: true }` calls `onClosed` only). `failAfterMs` (an option, or `?stubfail=N` in the address, for the audit scripts) closes it that long
// after the engine was initialised. `unreachable` (an option, or `?stubunreachable=1`) makes the connection fail; `rateLimited` refuses the code the
// way the desktop does after several wrong ones; `noOnClosed` leaves `onClosed` out (an older module).
// For the typed address (the Android app; `?desktopaddr=1` in a browser): `base` is where the stub's desktop is (`http://192.168.1.20:4300`): the probe and the
// link answer only there, anywhere else is a desktop that is not there. `notAllowed` is a desktop that is there but does not list this page (the probe
// is refused as a browser's CORS check refuses it, and `reach` says something is listening). `hostProtocol: 3` is a host whose probe says another version (the
// connection then refuses it at once, as the real one does); `versionMismatch: { page, host }` makes the connection
// fail with a RemoteVersionError; `noSession` with a full desktop. The code itself is never recorded, only whether it was the right one.
(() => {
  const o = window.__desktopStubOptions || {};
  const code = o.code || 'ABCD2345';
  const calls = [];
  const probe = { app: 'firesim-desktop-host', protocol: o.hostProtocol || 2, requiresCode: true };
  // What the welcome says: the host's name and cores are not known to the page before it.
  const info = { app: 'firesim-desktop-host', protocol: 2, name: o.name || 'Studio PC', cores: o.cores || 8, node: o.node || 'v22.11.0', sessions: 0, maxSessions: 4 };
  const here = (base) => !o.base || String(base || '').replace(/\/$/, '') === o.base.replace(/\/$/, '');
  let fail = () => undefined;
  let close = () => undefined;
  window.__remote = { calls, fail: (m) => fail(m), close: (reason, how) => close(reason, how) };
  window.__firesimRemote = {
    detectHost: async (opts) => {
      calls.push(['detect', opts]);
      return o.noHost || o.notAllowed || !here(opts && opts.base) ? null : probe;
    },
    reach: async (base) => {
      calls.push(['reach', base]);
      return !!o.notAllowed && here(base);
    },
    connectRemote: async (opts) => {
      calls.push(['connect', { base: opts.base, rightCode: opts.code === code }]);
      calls.push(['info', !!opts.info]); // whether the page handed over a name or cores of the start-up answer (protocol 2: it has none to give)
      calls.push(['probe', opts.probe ? opts.probe.protocol : null]); // what the host said before the code, handed over so a host of another version is refused before a socket is opened
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      if (opts.probe && opts.probe.protocol !== 2) {
        // As the real connectRemote does: a host that said another version before the code is refused at once, whatever the code is.
        const e = new Error('The desktop speaks another version.');
        e.name = 'RemoteVersionError';
        e.pageProtocol = 2;
        e.hostProtocol = opts.probe.protocol;
        throw e;
      }
      if (!here(opts.base)) throw new Error('Could not reach the desktop.');
      if (opts.code !== code || o.rateLimited) {
        const e = new Error('The desktop did not accept the code.');
        e.name = 'RemoteAuthError';
        e.reason = o.rateLimited ? 'rate-limited' : 'wrong-code';
        throw e;
      }
      if (o.versionMismatch) {
        const e = new Error('The desktop speaks another version.');
        e.name = 'RemoteVersionError';
        e.pageProtocol = o.versionMismatch.page;
        e.hostProtocol = o.versionMismatch.host;
        throw e;
      }
      if (o.noSession) throw new Error('The desktop has no free session.');
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
