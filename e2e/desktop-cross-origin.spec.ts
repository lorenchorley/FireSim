/**
 * The app on one origin and a REAL desktop host on another (0.9.0, workstream P, contract section 4.3 item 5). This is what the Android app does: its page
 * (`https://localhost`, here the e2e build served by `vite preview` on `http://localhost:PORT`) is not served by the host; the person types the host's
 * address and the code, and the page opens the link across origins. The host is started as a child process (`node desktop/run.mjs`, as
 * e2e/desktop-real.spec.ts does) with `--allow-origin http://localhost:PORT` (the page's own origin, which the host's origin check lets in only when it is
 * listed) and the page is opened with the test seam `?desktopaddr=1` (a browser never offers an address box by itself).
 *
 *   1. a listed origin: the typed address and code open the link, the host computes the Katoomba demo (snapshots arrive, time advances on Play, the page
 *      holds no engine of its own), the map and the statistics say so; the page asked the host's address one thing only (`GET /__firesim/host`) and its
 *      one engine link, and nobody else; the address (never the code) is remembered
 *   2. a wrong code is said next to the box (and the chip tells nothing of the host); the host is not at fault and the right code then works
 *   3. an origin that is not listed: the browser refuses the host's answer (no CORS header) and the page says the desktop is THERE but did not let the app
 *      in, not that nothing answered; at the host itself the same origin is refused at the handshake (403) and never gets a CORS header, and a listed one gets
 *      its own origin back, never `*`
 *   4. a host that is not there (a closed port): "No desktop answered at that address", with the flags to check, and the code is not sent
 *   5. `--allow-app`: the app's own origins (`https://localhost`, `capacitor://localhost`) are let in by it and by nothing less
 *
 * SKIPPED, with the reason, on a tree whose host has no `--allow-origin` (lane H's, protocol 2): the orchestrator's merge of H turns it on. Never deleted.
 * Run it with the build served on a port of its own (`lane-e2e.sh <worktree> <port> e2e/desktop-cross-origin.spec.ts`): the host's allowed origin is that port's.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test as plain, type Locator, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { chooseKatoombaOffline, sameOrigin, whereIsTheCode } from './desktopStub';
import { expect, test } from './fixtures';
import { acceptNotice } from './helpers';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CODE = 'ABCD2345';
const NAME = 'FireSim e2e';
const CORES = availableParallelism();
const HOST_IS_PROTOCOL_2 = readFileSync(new URL('../desktop/cli.ts', import.meta.url), 'utf8').includes('allow-origin');
const NOT_MERGED = 'lane H is not merged: the host in this tree (desktop/cli.ts) has no --allow-origin and still speaks protocol 1';
test.skip(!HOST_IS_PROTOCOL_2, NOT_MERGED);
plain.skip(!HOST_IS_PROTOCOL_2, NOT_MERGED);

interface Host {
  /** `http://127.0.0.1:PORT` (no slash). */
  origin: string;
  port: number;
  stop(): Promise<void>;
}

const hosts = new Set<Host>();
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `node desktop/run.mjs --port 0 --code ABCD2345 …extra` as a child process; resolves with its address once the banner is printed. */
async function startHost(extra: string[] = []): Promise<Host> {
  const child: ChildProcess = spawn(process.execPath, ['desktop/run.mjs', '--port', '0', '--code', CODE, '--name', NAME, ...extra], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  let gone = false;
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => {
      gone = true;
      resolve();
    }),
  );
  const host: Host = {
    origin: '',
    port: 0,
    async stop() {
      if (gone) return;
      child.kill('SIGTERM');
      if (!(await Promise.race([exited.then(() => true), pause(10_000).then(() => false)]))) child.kill('SIGKILL');
      await exited;
    },
  };
  hosts.add(host);
  child.stdout!.on('data', (d: Buffer) => (text += d));
  child.stderr!.on('data', (d: Buffer) => (text += d));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The host printed no address within 60 s:\n${text}`)), 60_000);
      const done = (): void => {
        if (!/Pairing code: /.test(text)) return;
        clearTimeout(timer);
        resolve();
      };
      child.stdout!.on('data', done);
      void exited.then(() => {
        clearTimeout(timer);
        reject(new Error(`The host ended while starting:\n${text}`));
      });
    });
  } catch (e) {
    await host.stop();
    throw e;
  }
  const at = /http:\/\/([\d.]+):(\d+)\//.exec(text);
  if (!at) {
    await host.stop();
    throw new Error(`No address in the banner:\n${text}`);
  }
  host.origin = `http://${at[1]}:${at[2]}`;
  host.port = Number(at[2]);
  return host;
}

test.afterAll(async () => {
  await Promise.all([...hosts].map((h) => h.stop()));
  hosts.clear();
});

const row = (page: Page): Locator => page.getByTestId('engine-row');
const codeBox = (page: Page): Locator => page.getByTestId('engine-code');
const addressBox = (page: Page): Locator => page.getByTestId('engine-address');
const problem = (page: Page): Locator => page.getByTestId('engine-problem');
const chip = (page: Page, value: 'device' | 'desktop'): Locator => page.getByTestId('engine').locator(`label.chip[data-value=${value}]`);

type State = { hasSnapshot: boolean; headTime: number; error: string | null };
const state = (page: Page): Promise<State> =>
  page.evaluate(() => {
    const s = (window as unknown as { __firesim: { session: { state: { get(): { snapshot: unknown; headTime: number; error: string | null } } } } }).__firesim.session.state.get();
    return { hasSnapshot: s.snapshot !== null, headTime: s.headTime, error: s.error };
  });

/** The simulation's own Web Worker (the in-page engine); the speed test's and any other worker do not match. */
const simWorkers = (page: Page): number => page.workers().filter((w) => /\/assets\/worker-[^/]*\.js/.test(w.url()) || w.url().startsWith('blob:')).length;

/** The page from the build under test, with the address box offered by the test seam, and the notice accepted. */
async function openApp(page: Page): Promise<void> {
  await page.goto('/?debug=1&desktopaddr=1');
  await acceptNotice(page);
  await expect(row(page)).toBeVisible();
  await expect(chip(page, 'desktop')).toHaveText('Desktop (another computer)');
}

async function typeAddressAndCode(page: Page, address: string, code: string): Promise<void> {
  if (!(await addressBox(page).isVisible())) await chip(page, 'desktop').click();
  await addressBox(page).fill(address);
  await codeBox(page).fill(code);
}

/** The Katoomba demo at 6 km, the fast tier, preset weather, offline: the model is built in seconds. Then Build. */
async function chooseAndBuild(page: Page): Promise<void> {
  await chooseKatoombaOffline(page);
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('detail').getByRole('radio', { name: /^Fast/ }).check({ force: true });
  await page.getByTestId('build').click();
}

test.describe.configure({ mode: 'serial' });
// A machine may send web requests through an HTTP proxy (the CI sandbox does, and Chromium reads it for WebSocket addresses): the browser must go straight to
// the host on this machine's loopback address. Every address the specs use is on the bypass list, so the unreachable proxy is never used.
test.use({ actionTimeout: 45_000, proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' } });

test('1. a page of another origin, a listed origin on the host: the typed address and code open the link, the host computes, and the page asks nobody else', async ({ page, context, baseURL }) => {
  test.setTimeout(360_000);
  const pageOrigin = new URL(baseURL!).origin;
  const host = await startHost(['--allow-origin', pageOrigin]);
  const address = `127.0.0.1:${host.port}`;
  const requests: { url: string; method: string }[] = [];
  context.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));

  await openApp(page);
  await typeAddressAndCode(page, address, CODE);
  await chooseAndBuild(page);
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await expect.poll(async () => (await state(page)).hasSnapshot, { message: 'snapshots arrive from the host', timeout: 60_000 }).toBe(true);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await state(page)).headTime, { message: 'the time advances on Play (the host computes)', timeout: 120_000 }).toBeGreaterThan(200);
  expect((await state(page)).error).toBeNull();
  expect(simWorkers(page), 'the page holds no engine of its own: the host computes (an app has nothing to spare for one)').toBe(0);

  await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-debug-stats').click();
  await expect(page.getByTestId('debug-stats')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('debug-group-run').click();
  const stats = await page.getByTestId('debug-group-run-body').innerText();
  expect(stats).toContain('Engine runs on');
  expect(stats).toMatch(new RegExp(`Desktop ${NAME}, ${CORES} cores, Node ${process.versions.node.replace(/\./g, '\\.')}, link [\\d.]+ ms`));
  await page.getByTestId('debug-stats-close').click();

  // who the page asked, and what: its own origin, and the host for the one question and the one link
  const web = requests.filter((r) => /^https?:/.test(r.url));
  const strangers = web.filter((r) => !sameOrigin(r.url, pageOrigin) && !sameOrigin(r.url, host.origin));
  expect(strangers.map((r) => r.url), 'a request to an origin that is neither the page\'s nor the host\'s').toEqual([]);
  expect(web.filter((r) => sameOrigin(r.url, host.origin)).map((r) => `${r.method} ${new URL(r.url).pathname}`), 'of the host the page asked only who it is').toEqual(expect.arrayContaining(['GET /__firesim/host']));
  expect(web.filter((r) => sameOrigin(r.url, host.origin) && new URL(r.url).pathname !== '/__firesim/host').map((r) => r.url), 'nothing else of the host (the page is not served by it)').toEqual([]);
  expect(sockets, 'one engine link, to the typed address').toEqual([`ws://${address}/__firesim/engine`]);

  // the address is remembered, the code is nowhere; back on Setup the chip names the desktop from its welcome
  expect(await page.evaluate(() => localStorage.getItem('firesim.desktopAddress'))).toBe(JSON.stringify(address));
  expect(await whereIsTheCode(page, CODE)).toEqual([]);
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(chip(page, 'desktop')).toHaveText(`Desktop (${NAME}, ${CORES} cores)`);
  await expect(addressBox(page)).toHaveValue(address);
});

test('2. a wrong code is said next to the box and tells the page nothing of the host; the right code then works', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const host = await startHost(['--allow-origin', new URL(baseURL!).origin]);
  await openApp(page);
  await typeAddressAndCode(page, `127.0.0.1:${host.port}`, 'WRONG000');
  await page.getByTestId('build').click();
  await expect(problem(page)).toContainText('The desktop did not accept that code.', { timeout: 15_000 });
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('building')).toHaveCount(0);
  await expect(codeBox(page)).toHaveValue('');
  await expect(addressBox(page)).toHaveValue(`127.0.0.1:${host.port}`);
  await expect(chip(page, 'desktop')).toHaveText('Desktop (another computer)');
  await expect(page.getByTestId('continue-here-setup')).toHaveCount(0);
  await codeBox(page).fill(CODE);
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');
});

// The browser refuses what the host does not allow and logs it to its console as an error (a CORS block, a refused handshake), which the shared console guard would fail on.
plain('3. an origin the host does not list: the page says the desktop is there but did not let the app in; the host refuses it at the handshake and gives it no CORS header, and a listed one gets its own origin back, never *', async ({ page, baseURL }) => {
  plain.setTimeout(120_000);
  const pageOrigin = new URL(baseURL!).origin;
  const listed = await startHost(['--allow-origin', pageOrigin]);
  const unlisted = await startHost(['--allow-origin', 'http://localhost:9']);
  const none = await startHost();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/CORS|Failed to load resource|WebSocket connection/i.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  // at the host: the answer to a page's GET, by whom it is addressed
  const get = (host: Host, origin: string): Promise<{ status: number; acao: string | undefined; body: string }> =>
    new Promise((resolve, reject) => {
      const req = request(`${host.origin}/__firesim/host`, { headers: { Origin: origin } }, (res) => {
        let body = '';
        res.on('data', (d: Buffer) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, acao: res.headers['access-control-allow-origin'] as string | undefined, body }));
      });
      req.on('error', reject);
      req.end();
    });
  const fromListed = await get(listed, pageOrigin);
  expect(fromListed.status).toBe(200);
  expect(fromListed.acao, 'a listed origin gets its own origin back').toBe(pageOrigin);
  expect(fromListed.acao).not.toBe('*');
  for (const [host, what] of [[unlisted, 'a host with another origin listed'], [none, 'a host that lists none']] as const) {
    const r = await get(host, pageOrigin);
    expect(r.status, what).toBe(200); // the question is answered to anyone with a good Host: it says only that this is a host and wants a code
    expect(r.acao, `${what}: no CORS header for an origin that is not listed`).toBeUndefined();
    expect(JSON.parse(r.body), what).toEqual({ app: 'firesim-desktop-host', protocol: 2, requiresCode: true });
  }
  const handshake = (host: Host, origin: string): Promise<string> =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${host.port}/__firesim/engine`, { headers: { Origin: origin } });
      ws.on('unexpected-response', (req, res) => {
        resolve(`http ${res.statusCode}`);
        req.destroy();
      });
      ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocol: 2, code: CODE })));
      ws.on('message', (d: Buffer) => {
        resolve(`message ${(JSON.parse(d.toString()) as { type?: string }).type}`);
        ws.close();
      });
      ws.on('close', (c) => resolve(`closed ${c}`));
      ws.on('error', () => undefined);
    });
  expect(await handshake(listed, pageOrigin), 'a listed origin, with the right code').toBe('message welcome');
  expect(await handshake(unlisted, pageOrigin), 'an origin that is not on the list').toBe('http 403');
  expect(await handshake(none, pageOrigin), 'a host that lists none').toBe('http 403');

  // in the page: nothing for it to read, but something is there
  await openApp(page);
  await typeAddressAndCode(page, `127.0.0.1:${unlisted.port}`, CODE);
  await page.getByTestId('build').click();
  await expect(problem(page)).toContainText('The desktop is there but did not let this app connect.', { timeout: 20_000 });
  await expect(problem(page)).not.toContainText('No desktop answered');
  await expect(page.getByTestId('continue-here-setup')).toBeVisible();
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('building')).toHaveCount(0);
  await expect(codeBox(page)).toHaveValue(CODE); // the code went nowhere: it is kept
  expect(errors).toEqual([]);
});

test('4. a host that is not there: the page says no desktop answered, with the flags to check, and the code is sent nowhere', async ({ page }) => {
  test.setTimeout(90_000);
  test.info().annotations.push({ type: 'network-failures' }); // the refused connection is reported by the browser
  // a port nothing listens on: a server is started on a free one and closed
  const free = await new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  await openApp(page);
  await typeAddressAndCode(page, `127.0.0.1:${free}`, CODE);
  await page.getByTestId('build').click();
  await expect(problem(page)).toContainText('No desktop answered at that address. Check that it is running with --lan and --allow-app, and that this device is on the same network.', { timeout: 20_000 });
  await expect(problem(page)).not.toContainText('did not let this app connect');
  await expect(page.getByTestId('continue-here-setup')).toBeVisible();
  expect(sockets, 'no engine link was tried at an address that did not answer').toEqual([]);
  await expect(codeBox(page)).toHaveValue(CODE);
});

plain('5. --allow-app lets the app\'s own origins in (https://localhost and capacitor://localhost) and a host without it does not', async () => {
  plain.setTimeout(90_000);
  const withApp = await startHost(['--allow-app']);
  const without = await startHost();
  const handshake = (host: Host, origin: string): Promise<string> =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${host.port}/__firesim/engine`, { headers: { Origin: origin } });
      ws.on('unexpected-response', (req, res) => {
        resolve(`http ${res.statusCode}`);
        req.destroy();
      });
      ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocol: 2, code: CODE })));
      ws.on('message', (d: Buffer) => {
        resolve(`message ${(JSON.parse(d.toString()) as { type?: string }).type}`);
        ws.close();
      });
      ws.on('close', (c) => resolve(`closed ${c}`));
      ws.on('error', () => undefined);
    });
  for (const origin of ['https://localhost', 'capacitor://localhost']) {
    expect(await handshake(withApp, origin), `--allow-app, ${origin}`).toBe('message welcome');
    expect(await handshake(without, origin), `no --allow-app, ${origin}`).toBe('http 403');
  }
  expect(await handshake(withApp, 'https://evil.example'), 'an origin --allow-app does not name').toBe('http 403');
  expect(await handshake(withApp, 'http://localhost'), 'http://localhost is not the app (the app is https://localhost)').toBe('http 403');
});
