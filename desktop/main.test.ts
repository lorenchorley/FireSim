/**
 * `npm run desktop` as a process (contract 0.8.0 J, 3.2 and 5): what it prints, where it listens by default and with --lan,
 * the exit codes, and the graceful stop on SIGINT and SIGTERM. The host runs in a child process built from the same
 * desktop/build.mjs that `npm run desktop` uses.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { request as httpRequest } from 'node:http';
import { hostname, networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { lanAddresses } from './lan';
import { buildForTests, hello, openClient, waitFor, welcomeOf } from './testHelpers';

let work: string;
let built: Awaited<ReturnType<typeof buildForTests>>;
let dist: string;
let runner: string;
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

function run(args: string[], distDir = dist, env: Record<string, string> = {}): Running {
  const child = spawn(process.execPath, [runner, ...args], { env: { ...process.env, TEST_DIST: distDir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as ChildProcessWithoutNullStreams;
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
  await waitFor(() => /Pairing code: /.test(r.out()) || r.err().length > 0, 20000, 'the banner'); // the way the e2e spec of the real host waits for it
  const m = /http:\/\/[\d.]+:(\d+)\/#code=([A-Z0-9]+)/.exec(r.out());
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
    const info = (await (await fetch(`http://127.0.0.1:${port}/__firesim/host`)).json()) as { name: string };
    expect(info.name).toBe('Workbench');
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toContain('FireSim');
    // A session, then the stop: the socket is closed by the host and the process ends with 0.
    const c = await openClient(port);
    hello(c, code);
    expect((await welcomeOf(c))?.type).toBe('welcome');
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
    expect(r.out()).toContain('Up to 3 simulations at once.');
    expect(JSON.parse(await (await fetch(`http://127.0.0.1:${port}/__firesim/host`)).text())).toMatchObject({ maxSessions: 3 });
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
    expect(quiet.out()).not.toContain('max-old-space-size');
    quiet.child.kill('SIGINT');
    await quiet.exited;
    const loud = run(['--port', '0', '--worker-heap-mib', '512'], dist, { NODE_OPTIONS: '--max-old-space-size=8192' });
    await started(loud);
    expect(loud.out()).toContain('--max-old-space-size is set for Node itself');
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
