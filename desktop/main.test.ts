/**
 * `npm run desktop` as a process (contract 0.8.0 J, 3.2 and 5): what it prints, where it listens by default and with --lan,
 * the exit codes, and the graceful stop on SIGINT and SIGTERM. The host runs in a child process built from the same
 * desktop/build.mjs that `npm run desktop` uses.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { hostname, networkInterfaces, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import { lanAddresses } from './lan';
import { availableMemory, defaultMaxSessionMib } from './memoryBound';
import { buildForTests, hello, openClient, waitFor, welcomeOf } from './testHelpers';

let work: string;
let built: Awaited<ReturnType<typeof buildForTests>>;
let dist: string;
let runner: string;
let runnerLaunch: string;
const children: ChildProcessWithoutNullStreams[] = [];

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'firesim-main-'));
  dist = join(work, 'dist');
  mkdirSync(dist);
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>FireSim</title>');
  built = await buildForTests();
  // The same two lines as desktop/run.mjs, with the built app somewhere else.
  runner = join(work, 'run.mjs');
  writeFileSync(
    runner,
    `import { main } from ${JSON.stringify(pathToFileURL(join(built.dir, 'main.mjs')).href)};
process.exit(await main(process.argv.slice(2), { distDir: process.env.TEST_DIST, workerFile: new URL(${JSON.stringify(pathToFileURL(join(built.dir, 'engineWorker.mjs')).href)}) }));\n`,
  );
  // The same, with the browser launch injected: the address it would start the browser with is printed instead.
  runnerLaunch = join(work, 'run-launch.mjs');
  writeFileSync(
    runnerLaunch,
    `import { main } from ${JSON.stringify(pathToFileURL(join(built.dir, 'main.mjs')).href)};
process.exit(await main(process.argv.slice(2), { distDir: process.env.TEST_DIST, workerFile: new URL(${JSON.stringify(pathToFileURL(join(built.dir, 'engineWorker.mjs')).href)}), launch: (url) => console.log('LAUNCH ' + url) }));\n`,
  );
}, 60_000);

afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  built.remove();
});

interface Running {
  child: ChildProcessWithoutNullStreams;
  out: () => string;
  err: () => string;
  exited: Promise<number | null>;
}

function run(args: string[], distDir = dist, env: Record<string, string> = {}, program = runner): Running {
  const child = spawn(process.execPath, [program, ...args], { env: { ...process.env, TEST_DIST: distDir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as ChildProcessWithoutNullStreams;
  children.push(child);
  let out = '';
  let err = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (err += d.toString()));
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
  return { child, out: () => out, err: () => err, exited };
}

/** Wait for the banner and read the port of the first address it prints. */
async function started(r: Running): Promise<{ port: number; code: string }> {
  // The banner is several writes: wait for its last line (the e2e spec of the real host needs only the Pairing code line, which comes before).
  await waitFor(() => r.out().includes('Ctrl+C stops it.') || r.err().length > 0, 20000, 'the banner');
  const m = /http:\/\/(?:[\d.]+|\[[0-9a-f:]+\]):(\d+)\/#code=([A-Z0-9]+)/.exec(r.out());
  if (!m) throw new Error(`no address in the output: ${r.out()} ${r.err()}`);
  return { port: Number(m[1]), code: m[2]! };
}

const canConnect = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = createConnection({ host, port, timeout: 2000 }, () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
    s.on('timeout', () => {
      s.destroy();
      resolve(false);
    });
  });

describe('npm run desktop', () => {
  it('prints the address with the pairing code once, serves on this computer only by default, and stops cleanly on SIGINT (exit 0)', async () => {
    const r = run(['--port', '0', '--name', 'Workbench']);
    const { port, code } = await started(r);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    const out = r.out();
    expect(out).toContain('FireSim desktop host "Workbench"');
    expect(out).toContain(`http://127.0.0.1:${port}/#code=${code}`);
    expect(out).toContain('Open this on this computer:');
    expect(out).toContain('Pairing code: the part of the address after #code=');
    expect(out).not.toContain('TLS'); // the warning is for --lan
    // Served on 127.0.0.1 and on no other address of this computer.
    expect(await canConnect('127.0.0.1', port)).toBe(true);
    for (const a of lanAddresses(networkInterfaces())) expect(await canConnect(a, port), `${a} must not answer`).toBe(false);
    // Before the code the host says only that it is a FireSim host that wants a code; its name is in the welcome.
    expect(await (await fetch(`http://127.0.0.1:${port}/__firesim/host`)).json()).toEqual({ app: 'firesim-desktop-host', protocol: 2, requiresCode: true });
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toContain('FireSim');
    // A session, then the stop: the socket is closed by the host and the process ends with 0.
    const c = await openClient(port);
    hello(c, code);
    const welcome = await welcomeOf(c);
    expect(welcome?.type).toBe('welcome');
    expect(welcome).toMatchObject({ name: 'Workbench', protocol: 2 });
    await waitFor(() => r.out().includes('connect 127.0.0.1 session'), 5000, 'the connect line');
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
    expect((await c.closed).code).toBe(1001);
    // The code was printed once, in the address of the banner, and in no line after it.
    expect(r.out().split(code).length - 1).toBe(1);
    expect(r.out().split('\n').filter((l) => l.includes(code))).toEqual([`  http://127.0.0.1:${port}/#code=${code}`]);
    const afterBanner = r.out().slice(r.out().indexOf('Ctrl+C stops it.'));
    expect(afterBanner).not.toContain(code);
    expect(r.err()).not.toContain(code);
    expect(r.out()).toContain('SIGINT: stopping.');
  }, 60_000);

  it('stops cleanly on SIGTERM too', async () => {
    const r = run(['--port', '0']);
    await started(r);
    r.child.kill('SIGTERM');
    expect(await r.exited).toBe(0);
    expect(r.out()).toContain('SIGTERM: stopping.');
  }, 30_000);

  it('uses the code of --code, and with --lan listens on every interface and prints every LAN address with the code and the TLS warning', async () => {
    const r = run(['--port', '0', '--lan', '--code', 'ABCD2345', '--max-sessions', '3']);
    const { port, code } = await started(r);
    expect(code).toBe('ABCD2345');
    const lan = lanAddresses(networkInterfaces());
    for (const a of lan) {
      expect(r.out(), a).toContain(`http://${a}:${port}/#code=ABCD2345`);
      expect(await canConnect(a, port), `${a} must answer with --lan`).toBe(true);
    }
    expect(r.out().split('ABCD2345').length - 1).toBe(Math.max(1, lan.length)); // in each address printed, nowhere else
    expect(r.out()).toContain('Pairing code: the part of the address after #code=');
    expect(r.out()).toContain('There is no TLS: use this only on a network you trust.');
    expect(r.out()).toMatch(/Up to 3 simulations at once, each of at most about [\d,]+ MiB of memory \(--max-session-mib\)\. There is no TLS: use this only on a network you trust\. Ctrl\+C stops it\./);
    const c = await openClient(port);
    hello(c, 'ABCD2345');
    expect(await welcomeOf(c)).toMatchObject({ type: 'welcome', maxSessions: 3, sessions: 1 });
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 30_000);

  it('refuses a request whose Host is not a name of this computer, and takes this computer name, its .local name and the --allow-host names', async () => {
    const r = run(['--port', '0', '--allow-host', 'My-Router-Name.lan', '--allow-host', 'second.example']);
    const { port } = await started(r);
    const status = (host: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port, path: '/__firesim/host', headers: { Host: host } }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        });
        req.on('error', reject);
        req.end();
      });
    const own = hostname().toLowerCase();
    for (const ok of [`127.0.0.1:${port}`, `localhost:${port}`, own, `${own}.local:${port}`, 'my-router-name.lan', `MY-ROUTER-NAME.LAN:${port}`, 'second.example']) expect(await status(ok), ok).toBe(200);
    for (const bad of [`attacker.example:${port}`, 'third.example', 'my-router-name.lan.attacker.example', `x${own}.local`]) expect(await status(bad), bad).toBe(421);
    expect(r.out()).toContain('the Host header "attacker.example:');
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 30_000);

  it('without --allow-host only this computer and the IP addresses are accepted', async () => {
    const r = run(['--port', '0']);
    const { port } = await started(r);
    const status = new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/__firesim/host', headers: { Host: 'my-router-name.lan' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(await status).toBe(421);
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 30_000);

  it('--max-frame-mib sets the largest message: a frame above it is closed with 1009, one under it goes through to the engine', async () => {
    const r = run(['--port', '0', '--max-frame-mib', '1']);
    const { port, code } = await started(r);
    const c = await openClient(port);
    hello(c, code);
    expect((await welcomeOf(c))?.type).toBe('welcome');
    c.ws.send(new Uint8Array(512 * 1024)); // under 1 MiB: read by the engine, which says it is not a message
    await waitFor(() => c.received.length >= 2, 20000, 'the engine\'s answer');
    expect(c.ws.readyState).toBe(c.ws.OPEN);
    c.ws.send(new Uint8Array(2 * 1024 * 1024));
    expect((await c.closed).code).toBe(1009);
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 60_000);

  it('says so when a --max-old-space-size of Node itself replaces --worker-heap-mib, and not otherwise', async () => {
    const quiet = run(['--port', '0', '--worker-heap-mib', '512'], dist, { NODE_OPTIONS: '' });
    await started(quiet);
    await new Promise((r) => setTimeout(r, 300)); // the note, if there were one, is printed right after the banner
    expect(quiet.out()).not.toContain('max-old-space-size');
    quiet.child.kill('SIGINT');
    await quiet.exited;
    const loud = run(['--port', '0', '--worker-heap-mib', '512'], dist, { NODE_OPTIONS: '--max-old-space-size=8192' });
    await started(loud);
    await waitFor(() => loud.out().includes('--max-old-space-size is set for Node itself'), 5000, 'the note');
    expect(loud.out()).toContain('--worker-heap-mib');
    loud.child.kill('SIGINT');
    await loud.exited;
  }, 60_000);

  it('exits with 2 and says how to build when there is no built app', async () => {
    const empty = join(work, 'no-dist');
    const r = run(['--port', '0'], empty);
    expect(await r.exited).toBe(2);
    expect(r.err()).toContain('npm run build');
    expect(r.err()).toContain('no index.html');
    expect(r.out()).not.toContain('#code=');
  }, 30_000);

  it('exits with 2 and the usage for a wrong flag, and with 0 for --help', async () => {
    const bad = run(['--bogus']);
    expect(await bad.exited).toBe(2);
    expect(bad.err()).toContain('Unknown flag --bogus.');
    expect(bad.err()).toContain('Usage: npm run desktop');
    const short = run(['--code', 'abc']);
    expect(await short.exited).toBe(2);
    expect(short.err()).toContain('--code must be 8 to 32 letters and digits.');
    const help = run(['--help']);
    expect(await help.exited).toBe(0);
    expect(help.out()).toContain('--max-sessions N');
    expect(help.out()).toContain('--lan');
  }, 30_000);

  it('exits with 1 and names the flag when the port is taken', async () => {
    const first = run(['--port', '0']);
    const { port } = await started(first);
    const second = run(['--port', String(port)]);
    expect(await second.exited).toBe(1);
    expect(second.err()).toContain(`Port ${port} is already in use. Pick another with --port N.`);
    first.child.kill('SIGINT');
    expect(await first.exited).toBe(0);
  }, 30_000);
});

/** What a page or an app of `origin` would meet: the status of a refused handshake, the close code of a refused hello, or a welcome. */
function tryEngine(address: string, port: number, code: string, o: { origin?: string; host?: string } = {}): Promise<{ welcome: boolean; status?: number; close?: number }> {
  return new Promise((resolve) => {
    const url = `ws://${address.includes(':') ? `[${address}]` : address}:${port}/__firesim/engine`;
    const ws = new WsClient(url, { ...(o.origin ? { origin: o.origin } : {}), ...(o.host ? { headers: { Host: o.host } } : {}) });
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ welcome: false });
    }, 15_000);
    const done = (v: { welcome: boolean; status?: number; close?: number }): void => {
      clearTimeout(timer);
      resolve(v);
    };
    ws.on('unexpected-response', (_q, res) => {
      res.resume();
      done({ welcome: false, status: res.statusCode ?? 0 });
    });
    ws.on('error', () => undefined);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocol: 2, code })));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      done({ welcome: (JSON.parse(data.toString()) as { type: string }).type === 'welcome' });
      ws.close();
    });
    ws.on('close', (c) => done({ welcome: false, close: c }));
  });
}

/** A GET with the headers given; the path as it is. */
function getFrom(address: string, port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: address, port, path, headers }, (res) => {
      let body = '';
      res.on('data', (d: Buffer) => (body += d.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Whether this computer can listen on an IPv6 address (the sandbox of this build has no IPv6 at all: EAFNOSUPPORT). */
function canListen6(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.on('error', () => resolve(false));
    s.listen(0, address, () => s.close(() => resolve(true)));
  });
}

const APP = 'https://localhost';
const IOS = 'capacitor://localhost';

describe('apps and other origins (--allow-app, --allow-origin)', () => {
  it('--allow-app lets the Android and iOS app origins connect with the code, says so, and gives them /__firesim/host with their own origin; any other origin is still refused', async () => {
    const r = run(['--port', '0', '--code', 'ABCD2345', '--allow-app']);
    const { port } = await started(r);
    expect(r.out()).toContain('Apps may connect from: https://localhost, capacitor://localhost (the code is still needed; any app with one of these origins can try it).');
    for (const origin of [APP, IOS]) {
      expect(await tryEngine('127.0.0.1', port, 'ABCD2345', { origin }), origin).toEqual({ welcome: true });
      expect(await tryEngine('127.0.0.1', port, 'WRONG234', { origin }), origin).toEqual({ welcome: false, close: 4401 });
      const probe = await getFrom('127.0.0.1', port, '/__firesim/host', { Origin: origin });
      expect(probe.headers['access-control-allow-origin'], origin).toBe(origin);
      expect(JSON.parse(probe.body)).toEqual({ app: 'firesim-desktop-host', protocol: 2, requiresCode: true });
    }
    expect(await tryEngine('127.0.0.1', port, 'ABCD2345', { origin: 'https://evil.example' })).toMatchObject({ welcome: false, status: 403 });
    expect(await tryEngine('127.0.0.1', port, 'ABCD2345', { origin: 'http://localhost' })).toMatchObject({ welcome: false, status: 403 });
    expect((await getFrom('127.0.0.1', port, '/__firesim/host', { Origin: 'https://evil.example' })).headers['access-control-allow-origin']).toBeUndefined();
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 60_000);

  it('without the flags no app origin is accepted and the banner does not mention apps', async () => {
    const r = run(['--port', '0', '--code', 'ABCD2345']);
    const { port } = await started(r);
    expect(r.out()).not.toContain('Apps may connect');
    for (const origin of [APP, IOS]) expect(await tryEngine('127.0.0.1', port, 'ABCD2345', { origin }), origin).toMatchObject({ welcome: false, status: 403 });
    expect((await getFrom('127.0.0.1', port, '/__firesim/host', { Origin: APP })).headers['access-control-allow-origin']).toBeUndefined();
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 30_000);

  it('--allow-origin lists any other page, as written, and the banner shows the list, with --allow-app first; a repeat is listed once', async () => {
    const r = run(['--port', '0', '--code', 'ABCD2345', '--allow-origin', 'http://localhost:4173', '--allow-origin', 'HTTP://LOCALHOST:4173', '--allow-app']);
    const { port } = await started(r);
    expect(r.out()).toContain('Apps may connect from: https://localhost, capacitor://localhost, http://localhost:4173 (');
    expect(await tryEngine('127.0.0.1', port, 'ABCD2345', { origin: 'http://localhost:4173' })).toEqual({ welcome: true });
    expect(await tryEngine('127.0.0.1', port, 'ABCD2345', { origin: 'http://localhost:4174' })).toMatchObject({ welcome: false, status: 403 });
    expect(await tryEngine('127.0.0.1', port, 'ABCD2345', { origin: 'http://127.0.0.1:4173' })).toMatchObject({ welcome: false, status: 403 });
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 30_000);

  it('with --lan an app reaches the host through this computer\'s network address, without --lan that address is not served; a rebinding-style Host is 421 in both, with the app origin too', async () => {
    const lan = lanAddresses(networkInterfaces());
    expect(lan.length, 'this test needs a non-loopback IPv4 address of this computer').toBeGreaterThan(0);
    const open = run(['--port', '0', '--code', 'ABCD2345', '--allow-app', '--lan']);
    const { port: lanPort } = await started(open);
    for (const a of lan) {
      expect(await tryEngine(a, lanPort, 'ABCD2345', { origin: APP }), `${a} with the app origin`).toEqual({ welcome: true });
      expect(await tryEngine(a, lanPort, 'ABCD2345', { origin: 'https://evil.example' }), `${a} with another origin`).toMatchObject({ status: 403 });
      expect(await tryEngine(a, lanPort, 'ABCD2345', { origin: APP, host: `attacker.example:${lanPort}` }), `${a} with a name that is not this computer's`).toMatchObject({ welcome: false, status: 421 });
      expect((await getFrom(a, lanPort, '/__firesim/host', { Host: `attacker.example:${lanPort}`, Origin: APP })).status).toBe(421);
      const probe = await getFrom(a, lanPort, '/__firesim/host', { Origin: APP });
      expect(probe.status).toBe(200);
      expect(probe.headers['access-control-allow-origin']).toBe(APP);
    }
    open.child.kill('SIGINT');
    expect(await open.exited).toBe(0);

    const local = run(['--port', '0', '--code', 'ABCD2345', '--allow-app']);
    const { port } = await started(local);
    for (const a of lan) expect(await canConnect(a, port), `${a} must not answer without --lan`).toBe(false);
    expect(await tryEngine('127.0.0.1', port, 'ABCD2345', { origin: APP })).toEqual({ welcome: true });
    expect(await tryEngine('127.0.0.1', port, 'ABCD2345', { origin: APP, host: `attacker.example:${port}` })).toMatchObject({ welcome: false, status: 421 });
    expect((await getFrom('127.0.0.1', port, '/__firesim/host', { Host: `attacker.example:${port}`, Origin: APP })).status).toBe(421);
    local.child.kill('SIGINT');
    expect(await local.exited).toBe(0);
  }, 90_000);

  it('exits with 2 and the usage for an origin that is not exactly scheme://host[:port]', async () => {
    for (const bad of ['*', 'localhost', 'https://localhost/', 'ftp://localhost']) {
      const r = run(['--allow-origin', bad]);
      expect(await r.exited, bad).toBe(2);
      expect(r.err(), bad).toContain('--allow-origin needs an origin written exactly as scheme://host');
      expect(r.out(), bad).not.toContain('#code=');
    }
  }, 60_000);
});

describe('--open (a one-use link, not the code, starts the browser)', () => {
  const launched = (r: Running): string => /^LAUNCH (\S+)$/m.exec(r.out())?.[1] ?? '';

  it('starts the browser with /__firesim/open?t=TOKEN on the first address printed, and the code is not in what it is started with', async () => {
    const r = run(['--port', '0', '--open'], dist, {}, runnerLaunch);
    const { port, code } = await started(r);
    await waitFor(() => launched(r) !== '', 10_000, 'the launch');
    const url = launched(r);
    expect(url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/__firesim/open\\?t=[0-9a-f]{64}$`));
    expect(url).not.toContain(code);
    expect(r.out()).toContain('Opening the page in your browser.');
    // the printed address (with the code, for the owner to read) and the link are two different things
    expect(r.out().split('\n').filter((l) => l.includes(code))).toEqual([`  http://127.0.0.1:${port}/#code=${code}`]);
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 60_000);

  it('the link redirects once to /#code=CODE and then is spent: the second use is 410 and says what happened', async () => {
    const r = run(['--port', '0', '--open'], dist, {}, runnerLaunch);
    const { port, code } = await started(r);
    await waitFor(() => launched(r) !== '', 10_000, 'the launch');
    const path = new URL(launched(r)).pathname + new URL(launched(r)).search;
    const first = await getFrom('127.0.0.1', port, path);
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe(`/#code=${code}`);
    expect(first.headers['cache-control']).toBe('no-store');
    const second = await getFrom('127.0.0.1', port, path);
    expect(second.status).toBe(410);
    expect(second.body).toBe('This link was used already or has run out. Open the address the host printed.');
    expect(second.body).not.toContain(code);
    expect(r.out().split(code).length - 1).toBe(1); // the banner's one print, and no line about the link
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 60_000);

  it('does not start a browser, and has no such route, without --open', async () => {
    const r = run(['--port', '0'], dist, {}, runnerLaunch);
    const { port } = await started(r);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(r.out()).not.toContain('LAUNCH');
    expect(r.out()).not.toContain('Opening the page');
    expect((await getFrom('127.0.0.1', port, '/__firesim/open?t=x')).status).toBe(404);
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 30_000);

  it.runIf(process.platform === 'linux')('the real launcher (xdg-open here) is started with one argument, the link, and the code is nowhere in its arguments, its environment or its command line', async () => {
    // A program named xdg-open at the front of the PATH that writes what it was started with to a file and shows its own command line.
    const bin = join(work, 'fake-bin');
    mkdirSync(bin, { recursive: true });
    const record = join(work, 'xdg-open-args.txt');
    writeFileSync(join(bin, 'xdg-open'), `#!/bin/sh\nprintf '%s\\n' "$#" "$@" > ${record}\ntr '\\0' ' ' < /proc/$$/cmdline >> ${record}\n`, { mode: 0o755 });
    const r = run(['--port', '0', '--open'], dist, { PATH: `${bin}:${process.env.PATH ?? ''}` });
    const { port, code } = await started(r);
    await waitFor(() => existsSync(record) && (readFileSync(record, 'utf8').split('\n')[2] ?? '') !== '', 10_000, 'xdg-open to be started and to have written its command line');
    const [count, arg, cmdline] = readFileSync(record, 'utf8').split('\n');
    expect(count).toBe('1');
    expect(arg).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/__firesim/open\\?t=[0-9a-f]{64}$`));
    expect(readFileSync(record, 'utf8')).not.toContain(code);
    expect(cmdline).toContain(arg!);
    expect((await getFrom('127.0.0.1', port, new URL(arg!).pathname + new URL(arg!).search)).headers.location).toBe(`/#code=${code}`);
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 60_000);
});

describe('where it listens (--bind, --lan6) and IPv6', () => {
  it('--bind 127.0.0.2 listens on that address and no other: not on 127.0.0.1, and the banner prints it (this computer only, so no TLS warning)', async () => {
    const r = run(['--port', '0', '--code', 'ABCD2345', '--bind', '127.0.0.2']);
    const { port } = await started(r);
    expect(r.out()).toContain(`http://127.0.0.2:${port}/#code=ABCD2345`);
    expect(r.out()).toContain('Open this on this computer:');
    expect(r.out()).not.toContain('TLS');
    expect(await canConnect('127.0.0.2', port)).toBe(true);
    expect(await canConnect('127.0.0.1', port), '127.0.0.1 must not answer').toBe(false);
    expect(await tryEngine('127.0.0.2', port, 'ABCD2345')).toEqual({ welcome: true });
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 30_000);

  it('--bind with an address that is not this computer\'s is exit 1 with a sentence naming it, and --lan6, --lan and --bind together are exit 2', async () => {
    const away = run(['--port', '0', '--bind', '192.0.2.99']);
    expect(await away.exited).toBe(1);
    expect(away.err()).toContain('Cannot listen on 192.0.2.99: this computer has no such address. Check --bind.');
    for (const argv of [['--lan', '--bind', '127.0.0.1'], ['--lan', '--lan6'], ['--lan6', '--bind', '::1'], ['--bind', 'desk']]) {
      const r = run(argv);
      expect(await r.exited, argv.join(' ')).toBe(2);
      expect(r.out()).not.toContain('#code=');
    }
  }, 60_000);

  it('--bind ::1 serves on the IPv6 loopback as [::1] (the Host is accepted, the page of its own origin gets in, 127.0.0.1 does not answer), or says that this computer has no IPv6', async () => {
    const r = run(['--port', '0', '--code', 'ABCD2345', '--bind', '::1']);
    if (!(await canListen6('::1'))) {
      // This build machine has no IPv6 at all: what can be tested is that the host says so and exits 1. The sockets of the other branch were not tried here.
      process.stderr.write('[desktop ipv6] no IPv6 on this computer: tested the refusal, not an IPv6 socket\n');
      expect(await r.exited).toBe(1);
      expect(r.err()).toContain('Cannot listen on ::1: this computer has no IPv6 (or it is switched off).');
      return;
    }
    const { port } = await started(r);
    expect(r.out()).toContain(`http://[::1]:${port}/#code=ABCD2345`);
    expect(r.out()).toContain('Open this on this computer:');
    const probe = await getFrom('::1', port, '/__firesim/host');
    expect(JSON.parse(probe.body)).toEqual({ app: 'firesim-desktop-host', protocol: 2, requiresCode: true });
    expect((await getFrom('::1', port, '/__firesim/host', { Host: `attacker.example:${port}` })).status).toBe(421);
    expect(await tryEngine('::1', port, 'ABCD2345', { origin: `http://[::1]:${port}` })).toEqual({ welcome: true });
    expect(await tryEngine('::1', port, 'ABCD2345', { origin: 'http://evil.example' })).toMatchObject({ status: 403 });
    expect(await canConnect('127.0.0.1', port)).toBe(false);
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 60_000);

  it('--lan6 serves on every interface over IPv6 (and on most computers IPv4 too) and prints every address of this computer, or says that this computer has no IPv6', async () => {
    const r = run(['--port', '0', '--code', 'ABCD2345', '--lan6']);
    if (!(await canListen6('::'))) {
      process.stderr.write('[desktop ipv6] no IPv6 on this computer: tested the refusal, not an IPv6 socket\n');
      expect(await r.exited).toBe(1);
      expect(r.err()).toContain('Cannot listen on ::: this computer has no IPv6 (or it is switched off).');
      return;
    }
    const { port } = await started(r);
    expect(r.out()).toContain('Open one of these on this computer or on a phone on the same network:');
    expect(r.out()).toContain('There is no TLS: use this only on a network you trust.');
    expect(await tryEngine('::1', port, 'ABCD2345')).toEqual({ welcome: true });
    expect((await getFrom('::1', port, '/__firesim/host', { Host: `[::1]:${port}` })).status).toBe(200);
    r.child.kill('SIGINT');
    expect(await r.exited).toBe(0);
  }, 60_000);
});

describe('--max-session-mib', () => {
  it('is said in the banner as the limit of a session, with the figure given, and with the default from the computer\'s memory and --max-sessions when it is not', async () => {
    const given = run(['--port', '0', '--max-session-mib', '1500', '--max-sessions', '2']);
    await started(given);
    expect(given.out()).toContain('Up to 2 simulations at once, each of at most about 1,500 MiB of memory (--max-session-mib).');
    given.child.kill('SIGINT');
    await given.exited;
    const plain = run(['--port', '0', '--max-sessions', '3']);
    await started(plain);
    expect(plain.out()).toContain(`Up to 3 simulations at once, each of at most about ${defaultMaxSessionMib(availableMemory(totalmem(), process.constrainedMemory?.()), 3).toLocaleString('en-US')} MiB of memory (--max-session-mib).`);
    plain.child.kill('SIGINT');
    await plain.exited;
  }, 60_000);

  it('is refused below 64 MiB or as text', async () => {
    for (const bad of ['63', 'lots']) {
      const r = run(['--max-session-mib', bad]);
      expect(await r.exited, bad).toBe(2);
    }
  }, 30_000);
});
