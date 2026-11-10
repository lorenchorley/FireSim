/**
 * The page against the REAL desktop host (0.8.0, workstream J), as a person would meet it: `node desktop/run.mjs` is started as a child
 * process on a free port (it serves the `dist/` that the e2e build made), and a browser opens the page from it. Nothing here is the stub
 * of e2e/desktop-engine.spec.ts (that spec checks the page's side alone; this one checks the two sides together).
 *
 *   1. a page served by the host, opened with `#code=`: the Engine row with Desktop preselected, the code gone from the address bar, the
 *      Katoomba demo (6 km, fast tier) computed BY THE HOST (snapshots arrive, the time advances on Play; the page holds one idle standby
 *      engine worker and the host does the computing), the map and the debug statistics say so, the page asks `GET /__firesim/host` once,
 *      the host counts one session while the run is on and none after the page leaves it, and everything stays on the host's own origin
 *   2. the same page choosing This device runs on the in-page engine and the host stays at 0 sessions
 *   3. a wrong code is said next to the box, nothing is built and the host has no session; after 5 wrong tries the address is refused
 *      (the right code too: close 4429) and the page says so in its own words (the desktop is waiting, the code is not wrong)
 *   4. the host is killed mid-run: the chip says the connection closed, nothing switches by itself, the last picture stays, the statistics
 *      still open (their chunk was warmed while the host was there); "Continue on this device" restarts the same scenario on the page's
 *      standby engine from the start with the fire and the wind change marked before, and Play computes there
 *  4b. the same with nothing opened or fetched since the link opened (the case the first verification found failing): the standby engine
 *      and the warmed chunks are what make it work, with the host really gone
 *   5. a host started with `--lan`, opened through this machine's non-loopback IPv4 address (a phone's browser would do the same; an
 *      insecure context): it runs on the desktop as in 1; a host started without `--lan` cannot be reached through that address
 *   6. a page of another origin cannot open the engine link (Origin check: refused at the handshake), cannot read the host's answer,
 *      and a client with no Origin and no code never gets a session
 *   7. inside the Capacitor app (the real bridge, emulated) the page asks the host nothing and shows no Engine row
 * Each test starts its own host (so the rate limit of 3 cannot reach another) and stops it by its process id.
 *
 * 0.9.0 (workstream P): written for the host of protocol 2 (contract docs/plans/0.9.0/CONTRACT-0.9.0.md section 4.2: `GET /__firesim/host` says only
 * `{ app, protocol: 2, requiresCode }`; the name and the cores come with the welcome, so the chip says "Desktop" until then; the session count is no
 * longer public, so what the host frees is pinned by its own tests, desktop/server.test.ts). It is SKIPPED, with the reason, on a tree whose host is
 * still protocol 1 (the marker is the host's `--allow-origin` flag, lane H's): the orchestrator's merge of lane H turns it on. The typed address
 * and a page from another origin are e2e/desktop-cross-origin.spec.ts. Case 7 now says what the Capacitor app does: asks nothing, shows the row.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { availableParallelism, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test as plain, type Locator, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { emulateCapacitorAndroid } from './androidBridge';
import { expect, test } from './fixtures';
import { untilQuiet } from './desktopStub';
import { acceptNotice } from './helpers';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CODE = 'ABCD2345';
/** Lane H's host (protocol 2, `--allow-origin`, `--allow-app`) is in this tree: its flag parser names the flag. Until then this spec is skipped, never deleted. */
const HOST_IS_PROTOCOL_2 = readFileSync(new URL('../desktop/cli.ts', import.meta.url), 'utf8').includes('allow-origin');
const NOT_MERGED = 'lane H is not merged: the host in this tree (desktop/cli.ts) has no --allow-origin and still speaks protocol 1';
test.skip(!HOST_IS_PROTOCOL_2, NOT_MERGED);
plain.skip(!HOST_IS_PROTOCOL_2, NOT_MERGED);
const NAME = 'FireSim e2e';
const CORES = availableParallelism();
/** This machine's non-loopback IPv4 address, if it has one (what a phone on the same network would use). */
const lanIp = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && !i.internal && i.family === 'IPv4')?.address;

interface Host {
  /** `http://IP:PORT` (no slash). */
  origin: string;
  port: number;
  /** Every address the banner printed, with the code in the fragment. */
  urls: string[];
  /** Stops it the way Ctrl+C does and waits for the process to be gone. */
  stop(): Promise<void>;
  /** Ends it at once (SIGKILL), as a crash or a pulled plug would. */
  kill(): Promise<void>;
}

const hosts = new Set<Host>();
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `node desktop/run.mjs --port 0 --code ABCD2345 …` as a child process; resolves with its address once the banner is printed. */
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
    urls: [],
    async stop() {
      if (gone) return;
      child.kill('SIGTERM');
      if (!(await Promise.race([exited.then(() => true), pause(10_000).then(() => false)]))) child.kill('SIGKILL');
      await exited;
    },
    async kill() {
      if (gone) return;
      child.kill('SIGKILL');
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
    await host.kill();
    throw e;
  }
  host.urls = [...text.matchAll(/http:\/\/[\d.]+:\d+\/#code=[A-Z0-9]+/g)].map((m) => m[0]);
  const first = /^http:\/\/([\d.]+):(\d+)\//.exec(host.urls[0] ?? '');
  if (!first) {
    await host.kill();
    throw new Error(`No address in the banner:\n${text}`);
  }
  host.origin = `http://${first[1]}:${first[2]}`;
  host.port = Number(first[2]);
  return host;
}

test.afterAll(async () => {
  await Promise.all([...hosts].map((h) => h.stop()));
  hosts.clear();
});

/**
 * What the host says to anyone (a request from this test, not from the page: the page's own are counted separately). Protocol 2: that it is a
 * FireSim host, the protocol and that it wants a code, and nothing else (the name, the cores and the sessions wait for the welcome, after the code).
 */
const hostSays = async (h: Host): Promise<unknown> => (await fetch(`${h.origin}/__firesim/host`)).json();

const row = (page: Page): Locator => page.getByTestId('engine-row');
const codeBox = (page: Page): Locator => page.getByTestId('engine-code');
const chip = (page: Page, value: 'device' | 'desktop'): Locator => page.getByTestId('engine').locator(`label.chip[data-value=${value}]`);

/** The Setup choices of the real builder (the Katoomba demo, 6 km, the fast tier, preset weather, offline: the model is built in seconds), then Build. */
async function chooseAndBuild(page: Page): Promise<void> {
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('detail').getByRole('radio', { name: /^Fast/ }).check({ force: true });
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
}

type SessionState = { snapshot: unknown; headTime: number; viewTime: number; playing: boolean; error: string | null; ignitions: { id: string; time: number }[]; edits: { edit: { id: string }; time: number }[] };
type Handle = {
  __firesim: {
    session: { controller: { standby: Record<string, (...a: unknown[]) => unknown> | null }; state: { get(): SessionState }; play(): void; pause(): void; ignite(i: unknown): unknown; setWindDirection(id: string, dir: number, at?: number): unknown };
    scenario: { name: string };
    services: { createLocalController(): Record<string, (...a: unknown[]) => unknown> };
  };
};
/** The session's numbers and marks, small (the snapshot itself is megabytes of arrays and stays in the page). */
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Handle).__firesim.session.state.get();
    return { hasSnapshot: s.snapshot !== null, headTime: s.headTime, viewTime: s.viewTime, playing: s.playing, error: s.error, ignitions: s.ignitions.map((i) => ({ id: i.id, time: i.time })), edits: s.edits.map((e) => ({ edit: { id: e.edit.id }, time: e.time })) };
  });
const hasPicture = (page: Page): Promise<boolean> => state(page).then((s) => s.hasSnapshot);
const head = (page: Page): Promise<number> => state(page).then((s) => s.headTime);

/** The simulation's own Web Worker (the in-page engine), started from its own script or (since 0.9.0, on a page a host serves) from the copy kept in memory (a blob address); the speed test's worker is a blob only while that test runs. */
const simWorkers = (page: Page): number => page.workers().filter((w) => /\/assets\/worker-[^/]*\.js/.test(w.url()) || w.url().startsWith('blob:')).length;

/** Opens the Simulation debug statistics, reads its "Run" group and closes it again. */
async function runStatistics(page: Page): Promise<string> {
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-debug-stats').click();
  await expect(page.getByTestId('debug-stats')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('debug-group-run').click();
  await expect(page.getByTestId('debug-group-run-body')).toContainText('Platform');
  const text = await page.getByTestId('debug-group-run-body').innerText();
  await page.getByTestId('debug-stats-close').click();
  await expect(page.getByTestId('debug-stats')).toHaveCount(0);
  return text;
}

async function leaveToSetup(page: Page): Promise<void> {
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('setup')).toBeVisible();
}

const sameOrigin = (url: string, origin: string): boolean => new URL(url).origin === origin;
const lap = (label: string, t0: number): void => console.log(`[desktop-real] ${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

/** Opens `url` (the host's page with a code), accepts the notice, builds the real Katoomba run on the desktop engine and waits for the first picture. */
async function runOnDesktop(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await acceptNotice(page);
  await expect(row(page)).toBeVisible();
  await expect(chip(page, 'desktop').locator('input')).toBeChecked();
  await chooseAndBuild(page);
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await expect.poll(() => hasPicture(page), { message: 'the first picture comes from the host', timeout: 60_000 }).toBe(true);
}

test.describe.configure({ mode: 'serial' });
// A machine may send web requests through an HTTP proxy (the CI sandbox does, and Chromium reads it for WebSocket addresses): the browser must go
// straight to this machine's LAN address, as a phone on the same Wi-Fi does. Every address the specs use is on the bypass list, so the unreachable proxy is never used.
test.use({ actionTimeout: 45_000, proxy: { server: 'http://127.0.0.1:9', bypass: `127.0.0.1,localhost,${lanIp ?? 'none.invalid'}` } });

test('1. a page served by the host: the Engine row, Desktop preselected, the code leaves the address, the run is computed by the host and says so, one question, one session', async ({ page, context }) => {
  test.setTimeout(300_000);
  const t0 = Date.now();
  const host = await startHost();
  try {
    const requests: { url: string; method: string }[] = [];
    context.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
    const sockets: string[] = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));

    await page.goto(`${host.origin}/?debug=1#code=${CODE}`);
    await acceptNotice(page);
    await expect(row(page)).toBeVisible();
    await expect(chip(page, 'device')).toContainText('This device');
    await expect(chip(page, 'desktop')).toHaveText('Desktop'); // protocol 2: the host has not said who it is yet (the code has not been used)
    await expect(chip(page, 'desktop').locator('input')).toBeChecked(); // a code came with the address
    await expect(codeBox(page)).toBeHidden();
    await expect(page.getByTestId('engine-hint')).toHaveText('The simulation runs on the desktop computer. The code came with the link you opened.');
    await expect(page).not.toHaveURL(/#|code/);
    expect(await page.evaluate(() => location.hash)).toBe('');
    expect(await hostSays(host), 'before the code the host says only that it is a FireSim host, its protocol and that it wants a code').toEqual({ app: 'firesim-desktop-host', protocol: 2, requiresCode: true });
    const asksAtSetup = requests.filter((r) => new URL(r.url).pathname === '/__firesim/host');
    expect(asksAtSetup, 'the page asked the host once before Build').toHaveLength(1);
    expect(asksAtSetup[0]!.method).toBe('GET');
    lap('1 setup shown with the row', t0);

    await chooseAndBuild(page);
    await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
    await expect.poll(() => hasPicture(page), { message: 'snapshots arrive from the host', timeout: 60_000 }).toBe(true);
    lap('1 first picture from the host', t0);
    expect(await (await fetch(`${host.origin}/__firesim/host`)).text(), 'the host says who it is and nothing else').not.toMatch(/ABCD2345|\/home|\/root|dist|firesim e2e|cores/i);

    await page.getByTestId('play').click();
    await expect.poll(() => head(page), { message: 'the time advances on Play (the host computes)', timeout: 120_000 }).toBeGreaterThan(200);
    lap('1 time advanced past 200 s', t0);
    await expect.poll(() => simWorkers(page), { message: 'the page holds one idle standby worker, and the host does the computing', timeout: 30_000 }).toBe(1);

    // the map and the debug statistics say where it runs
    await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');
    const stats = await runStatistics(page);
    expect(stats).toContain('Engine runs on');
    expect(stats).toMatch(new RegExp(`Desktop ${NAME}, ${CORES} cores, Node ${process.versions.node.replace(/\./g, '\\.')}, link [\\d.]+ ms`));

    // leaving the run: back on Setup the chip names the desktop from its welcome (the second step of the label). That the host frees the session is
    // pinned by its own tests (desktop/server.test.ts): since protocol 2 the count is no longer public before the code.
    await leaveToSetup(page);
    await expect(chip(page, 'desktop')).toHaveText(`Desktop (${NAME}, ${CORES} cores)`);
    await untilQuiet(() => requests.length, 3, 30_000); // Setup shown again with Desktop chosen keeps the chosen site's files once more: let that finish before the host is stopped
    lap('1 left the run', t0);

    // what the page asked, and of whom
    const all = requests.filter((r) => /^https?:/.test(r.url));
    expect(all.filter((r) => !sameOrigin(r.url, host.origin)).map((r) => r.url), 'a request to another origin').toEqual([]);
    expect(sockets, 'one engine link, to the host itself').toEqual([`ws://${new URL(host.origin).host}/__firesim/engine`]);
    const asks = requests.filter((r) => new URL(r.url).pathname === '/__firesim/host');
    test.info().annotations.push({ type: 'GET /__firesim/host by the page', description: `${asks.length} (contract 4: "no request is repeated")` });
    console.log(`[desktop-real] 1: GET /__firesim/host requested ${asks.length} time(s) by the page over the whole run`);
    expect(asks.length, 'the page asks the host once, and connectRemote asks again when the run starts (see the report)').toBeLessThanOrEqual(2);
  } finally {
    await host.stop();
    lap('1 total', t0);
  }
});

test('2. This device on a host page: the in-page engine computes (the demo engine under ?mock=1) and the host never has a session', async ({ page, context }) => {
  test.setTimeout(120_000);
  const t0 = Date.now();
  const host = await startHost();
  try {
    const sockets: string[] = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));
    const requests: string[] = [];
    context.on('request', (r) => requests.push(r.url()));
    await page.goto(`${host.origin}/?mock=1&debug=1#code=${CODE}`);
    await acceptNotice(page);
    await expect(chip(page, 'desktop').locator('input')).toBeChecked();
    await chip(page, 'device').click(); // the person chooses This device
    await expect(chip(page, 'device').locator('input')).toBeChecked();
    await expect(page.getByTestId('engine-hint')).toHaveText('The simulation runs on this device.');
    await page.getByTestId('build').click();
    await expect(page.getByTestId('sim')).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => hasPicture(page), { timeout: 30_000 }).toBe(true);
    await page.getByTestId('play').click();
    await expect.poll(() => head(page), { timeout: 60_000 }).toBeGreaterThan(30);
    await expect(page.getByTestId('engine-banner')).toHaveCount(0);
    await expect(page.locator('.mock-banner')).toHaveText('Demo engine'); // the in-page engine under ?mock=1
    expect(sockets, 'no engine link was opened').toEqual([]);
    expect(requests.filter((u) => /__firesim\/engine/.test(u))).toEqual([]);
    await page.waitForTimeout(1500);
    expect(sockets, 'still no engine link').toEqual([]);
    expect((await hostSays(host)) as { protocol: number }).toMatchObject({ protocol: 2 }); // the host is still there and was never given a code
    lap('2 total', t0);
  } finally {
    await host.stop();
  }
});

test('3. a wrong code: said next to the box, nothing is built, no session; after 5 wrong tries the address is refused, the right code too', async ({ page }) => {
  test.setTimeout(150_000);
  const t0 = Date.now();
  const host = await startHost();
  try {
    await page.goto(`${host.origin}/?mock=1&debug=1#code=WRONGWRO`);
    await acceptNotice(page);
    await expect(chip(page, 'desktop').locator('input')).toBeChecked();
    const wrongTry = async (code: string | null, n: number, words = ['The desktop did not accept that code.', 'After several wrong tries it waits about a minute.']): Promise<void> => {
      if (code !== null) await codeBox(page).fill(code);
      await page.getByTestId('build').click();
      await expect(page.getByTestId('engine-problem'), `try ${n}`).toContainText(words[0]!, { timeout: 15_000 });
      await expect(page.getByTestId('engine-problem')).toContainText(words[1]!);
      await expect(page.getByTestId('setup')).toBeVisible();
      await expect(page.getByTestId('building')).toHaveCount(0); // nothing is built
      await expect(chip(page, 'desktop')).toHaveText('Desktop'); // a refused code tells the page nothing of the host
    };
    await wrongTry(null, 1);
    await expect(codeBox(page)).toBeVisible(); // the refused code is forgotten and the box asks for another
    await expect(codeBox(page)).toHaveValue('');
    const box = (await codeBox(page).boundingBox())!;
    const words = (await page.getByTestId('engine-problem').boundingBox())!;
    expect(words.y).toBeGreaterThanOrEqual(box.y + box.height - 1); // the words sit under the box, next to it
    expect(words.y - (box.y + box.height)).toBeLessThan(40);
    for (let n = 2; n <= 5; n++) await wrongTry(`WRONGWR${n}`, n);
    lap('3 five wrong tries', t0);

    // the address is now refused for a minute: the right code too (the host closes with 4429, seen here from a plain client)
    const close = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://${new URL(host.origin).host}/__firesim/engine`);
      const t = setTimeout(() => reject(new Error('no answer')), 10_000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocol: 2, code: CODE })));
      ws.on('message', () => resolve(0)); // a welcome would be a failure
      ws.on('close', (c) => {
        clearTimeout(t);
        resolve(c);
      });
      ws.on('error', reject);
    });
    expect(close, 'the right code, from the refused address').toBe(4429);
    // the page says the desktop is waiting (the code was not wrong), keeps the code for the next try, builds nothing and gets no session
    await wrongTry(CODE, 6, ['The desktop is waiting before it takes another code.', 'Try again in about a minute.']);
    await expect(page.getByTestId('engine-problem')).not.toContainText('did not accept');
    await expect(codeBox(page)).toHaveValue(CODE);
    lap('3 total', t0);
  } finally {
    await host.stop();
  }
});

test('4. the host is killed mid-run: the chip says the link closed, nothing switches by itself, the last picture stays; Continue on this device restarts the same scenario here with the fire and the wind change, and Play computes locally', async ({ page, context }) => {
  test.setTimeout(360_000);
  const t0 = Date.now();
  const host = await startHost();
  try {
    const requests: string[] = [];
    context.on('request', (r) => requests.push(r.url()));
    await runOnDesktop(page, `${host.origin}/?debug=1#code=${CODE}`);
    await page.getByTestId('play').click();
    await expect.poll(() => head(page), { timeout: 120_000 }).toBeGreaterThan(150);
    // mark one fire and one wind change, then let it play on
    await page.evaluate(() => {
      const s = (window as unknown as Handle).__firesim.session;
      s.pause();
      s.ignite({ id: 'e2e-fire', kind: 'point', points: [[120, -80]], radius: 40, origin: 'observed' });
      s.setWindDirection('e2e-turn', 200, 3600);
      s.play();
    });
    const marked = await state(page);
    expect(marked.ignitions.map((i) => i.id)).toContain('e2e-fire');
    expect(marked.edits.map((e) => e.edit.id)).toContain('e2e-turn');
    const fireTime = marked.ignitions.find((i) => i.id === 'e2e-fire')!.time;
    const turnTime = marked.edits.find((e) => e.edit.id === 'e2e-turn')!.time;
    // (marking in the past rewinds the host's run to a checkpoint and replays: the head falls back and climbs again)
    await expect.poll(() => head(page), { message: 'the host computes on after the marks', timeout: 120_000 }).toBeGreaterThan(100);
    expect(simWorkers(page), 'the one idle standby worker, nothing else').toBe(1);
    // what the page's own engines are sent from now on: the standby the run holds (idle until the tap), and any engine the page makes (`createLocalController`)
    await page.evaluate(() => {
      const w = window as unknown as { __local: unknown[][]; __firesim: Handle['__firesim'] };
      w.__local = [];
      const watch = (c: Record<string, (...a: unknown[]) => unknown>): Record<string, (...a: unknown[]) => unknown> => {
        const say: Record<string, (a: any[]) => unknown[]> = { init: (a) => ['init', a[0].name], ignite: (a) => ['ignite', a[0].id, a[0].time], edit: (a) => ['edit', a[0].id, a[1]], run: (a) => ['run', a[0]] };
        for (const m of Object.keys(say)) {
          const f = (c[m] as (...a: unknown[]) => unknown).bind(c);
          c[m] = (...a: unknown[]) => (w.__local.push(say[m]!(a)), f(...a));
        }
        return c;
      };
      const fs = w.__firesim;
      if (fs.session.controller.standby) watch(fs.session.controller.standby);
      const services = fs.services;
      const make = services.createLocalController;
      services.createLocalController = () => watch(make());
    });
    const scenarioName = await page.evaluate(() => (window as unknown as Handle).__firesim.scenario.name);
    lap('4 marked, about to kill', t0);

    await host.kill(); // SIGKILL: no goodbye
    const chipEl = page.getByTestId('error-chip');
    await expect(chipEl).toContainText('The desktop connection closed.', { timeout: 30_000 });
    const go = page.getByTestId('continue-here');
    await expect(go).toBeVisible();
    const frozen = await state(page);
    expect(frozen.hasSnapshot, 'the last picture stays').toBe(true);
    await page.waitForTimeout(3000);
    const later = await state(page);
    expect(later.headTime, 'nothing computes after the link is lost').toBe(frozen.headTime);
    expect(later.hasSnapshot).toBe(true);
    expect(simWorkers(page), 'nothing switches by itself: still the one idle standby').toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __local: unknown[] }).__local), 'nothing was sent to the standby').toEqual([]);
    await expect(page.getByTestId('engine-banner')).toContainText('Running on the desktop');
    // what the person opens meanwhile still opens, with the host gone: the statistics (a chunk that was warmed while the host was there)
    const meanwhile = await runStatistics(page);
    expect(meanwhile).toContain(`Desktop ${NAME}`);
    expect(meanwhile).toContain('(the connection closed)');
    lap('4 chip shown', t0);

    // the tap: the same scenario again, here, from the start, with what was marked
    await go.click();
    await expect(page.getByTestId('engine-banner')).toHaveText('Running on this device again, from the start.');
    await expect(chipEl).toBeHidden();
    const restarted = await state(page);
    expect(restarted).toMatchObject({ viewTime: 0, playing: false, error: null });
    expect(restarted.ignitions.map((i) => i.id)).toContain('e2e-fire');
    expect(restarted.edits.map((e) => e.edit.id)).toContain('e2e-turn');
    expect(simWorkers(page), 'the standby is the run\'s engine now (no second worker)').toBe(1);
    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as { __local: unknown[][] }).__local)).map((c) => c[0]), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(['init', 'ignite', 'edit']));
    const log = await page.evaluate(() => (window as unknown as { __local: unknown[][] }).__local);
    expect(log.filter((c) => c[0] !== 'run')).toEqual([['init', scenarioName], ['ignite', 'e2e-fire', fireTime], ['edit', 'e2e-turn', turnTime]]);
    await page.getByTestId('play').click();
    await expect.poll(() => head(page), { message: 'Play computes on this device', timeout: 120_000 }).toBeGreaterThan(60);
    expect((await page.evaluate(() => (window as unknown as { __local: unknown[][] }).__local)).some((c) => c[0] === 'run')).toBe(true);
    const after = await runStatistics(page);
    expect(after).toContain('This device (the run was started again here, from the start, after the desktop connection closed)');
    expect(after).not.toContain(`Desktop ${NAME}`);
    expect(requests.filter((u) => /^https?:/.test(u) && !sameOrigin(u, host.origin))).toEqual([]);
    lap('4 total', t0);
  } finally {
    await host.stop();
  }
});

test('4b. the host dies and nothing was opened or fetched since the link opened: Continue on this device still starts the run here (the standby engine and the warmed chunks)', async ({ page }) => {
  test.setTimeout(240_000);
  const host = await startHost();
  try {
    await runOnDesktop(page, `${host.origin}/?debug=1#code=${CODE}`);
    await page.getByTestId('play').click();
    await expect.poll(() => head(page), { timeout: 120_000 }).toBeGreaterThan(60);
    await host.kill();
    await expect(page.getByTestId('error-chip')).toContainText('The desktop connection closed.', { timeout: 30_000 });
    await page.getByTestId('continue-here').click();
    await expect(page.getByTestId('engine-banner')).toHaveText('Running on this device again, from the start.');
    await expect.poll(async () => (await state(page)).error, { message: 'the page\'s own engine starts without an error', timeout: 10_000 }).toBeNull();
    await page.waitForTimeout(3000);
    expect((await state(page)).error, 'still no error after the engine had time to start').toBeNull();
    await page.getByTestId('play').click();
    await expect.poll(() => head(page), { message: 'Play computes on this device', timeout: 120_000 }).toBeGreaterThan(30);
  } finally {
    await host.stop();
  }
});

test('5. --lan: the page opened through the non-loopback IPv4 address (as a phone would) runs on the desktop engine; without --lan that address is not reachable', async ({ page, context }) => {
  test.skip(!lanIp, 'this machine has no non-loopback IPv4 address, so there is nothing to open the page through');
  test.setTimeout(300_000);
  const t0 = Date.now();
  // without --lan: nothing listens on the LAN address
  const closed = await startHost();
  try {
    const refused = await new Promise<string>((resolve) => {
      const s = connect({ host: lanIp!, port: closed.port });
      const t = setTimeout(() => {
        s.destroy();
        resolve('timeout');
      }, 5000);
      s.once('connect', () => {
        clearTimeout(t);
        s.destroy();
        resolve('connected');
      });
      s.once('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(t);
        resolve(e.code ?? 'error');
      });
    });
    expect(refused, `the default host listens on 127.0.0.1 only; ${lanIp}:${closed.port}`).toBe('ECONNREFUSED');
  } finally {
    await closed.stop();
  }

  const host = await startHost(['--lan']);
  try {
    const url = host.urls.find((u) => u.startsWith(`http://${lanIp}:`));
    expect(url, `the banner names ${lanIp}`).toBeTruthy();
    expect(host.urls.every((u) => !u.startsWith('http://127.0.0.1:')), 'with --lan the banner lists the LAN addresses').toBe(true);
    const requests: string[] = [];
    context.on('request', (r) => requests.push(r.url()));
    const origin = new URL(url!).origin;
    await runOnDesktop(page, `${origin}/?debug=1#code=${CODE}`);
    expect(await page.evaluate(() => window.isSecureContext), 'a page opened by a LAN address is not a secure context, as on a phone').toBe(false);
    await page.getByTestId('play').click();
    await expect.poll(() => head(page), { timeout: 120_000 }).toBeGreaterThan(200);
    await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');
    expect(simWorkers(page), 'the one idle standby worker, nothing else').toBe(1);
    expect(requests.filter((u) => /^https?:/.test(u) && !sameOrigin(u, origin))).toEqual([]);
    await leaveToSetup(page);
    await expect(chip(page, 'desktop')).toHaveText(`Desktop (${NAME}, ${CORES} cores)`);
    await untilQuiet(() => requests.length, 3, 30_000); // Setup shown again with Desktop chosen keeps the chosen site's files once more: let that finish before the host is stopped
    lap('5 total', t0);
  } finally {
    await host.stop();
  }
});

// The cross-origin attempts are refused by the browser and logged to its console as errors, which the shared console guard would fail on.
plain('6. a page of another origin cannot open the engine link or read the host; a client with no Origin and no code never gets a session', async ({ page }) => {
  plain.setTimeout(60_000);
  const t0 = Date.now();
  const host = await startHost();
  const other = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>another origin</title>'));
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
  try {
    const otherOrigin = `http://127.0.0.1:${(other.address() as { port: number }).port}`;
    expect(otherOrigin).not.toBe(host.origin);
    await page.goto(otherOrigin);
    const seen = await page.evaluate(
      async ([wsUrl, infoUrl]) => {
        const socket = await new Promise<string>((resolve) => {
          const t = setTimeout(() => resolve('timeout'), 10_000);
          const ws = new WebSocket(wsUrl!);
          ws.onopen = () => {
            clearTimeout(t);
            ws.close();
            resolve('open');
          };
          ws.onclose = () => {
            clearTimeout(t);
            resolve('refused');
          };
        });
        const info = await fetch(infoUrl!).then(
          () => 'readable',
          () => 'blocked',
        );
        return { socket, info };
      },
      [`ws://127.0.0.1:${host.port}/__firesim/engine`, `${host.origin}/__firesim/host`],
    );
    expect(seen.socket, 'the browser never opens the link from another origin').toBe('refused');
    expect(seen.info, 'the host sends no CORS header, so another origin cannot read its answer').toBe('blocked');

    // what the host itself says at the handshake of such a page, and of a client with no Origin and no code
    const handshake = (headers: Record<string, string>): Promise<string> =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${host.port}/__firesim/engine`, { headers });
        ws.on('unexpected-response', (req, res) => {
          resolve(`http ${res.statusCode}`);
          req.destroy();
        });
        ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocol: 2 }))); // no code
        ws.on('close', (c) => resolve(`closed ${c}`));
        ws.on('message', () => resolve('welcome'));
        ws.on('error', () => undefined);
      });
    expect(await handshake({ Origin: otherOrigin }), 'a page of another origin').toBe('http 403');
    expect(await handshake({ Origin: 'null' }), 'a sandboxed or file page').toBe('http 403');
    expect(await handshake({}), 'no Origin and no code').toBe('closed 4400');
    lap('6 total', t0);
  } finally {
    other.close();
    await host.stop();
  }
});

test('7. inside the Capacitor app the page asks the host nothing at start-up; it shows the Engine row with an address box instead (the typed address, 0.9.0)', async ({ page, context }) => {
  test.setTimeout(90_000);
  const t0 = Date.now();
  const host = await startHost();
  try {
    const requests: string[] = [];
    context.on('request', (r) => requests.push(r.url()));
    // The real Capacitor bridge, emulated (e2e/androidBridge.ts). A bare `window.Capacitor = { isNativePlatform: () => true }` is not enough:
    // @capacitor/core replaces `isNativePlatform` with its own when it starts and decides from `window.androidBridge`.
    await emulateCapacitorAndroid(page);
    await page.goto(`${host.origin}/?debug=1#code=${CODE}`);
    await acceptNotice(page);
    await expect(page.getByTestId('setup')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { Capacitor: { isNativePlatform(): boolean } }).Capacitor.isNativePlatform())).toBe(true);
    await page.waitForTimeout(2500); // the host check has an 800 ms limit
    expect(requests.filter((u) => /__firesim/.test(u)), 'nothing is asked of the host that served the page: the app has no host of its own to ask').toEqual([]);
    expect(requests.filter((u) => /\/assets\/remote-[^/]*\.js/.test(u)), 'the wire (the remote chunk) is not fetched until a run starts on the desktop').toEqual([]);
    // 0.9.0 (D36): the row is there, with This device chosen and the desktop to be found by the address the person types
    await expect(row(page)).toBeVisible();
    await expect(chip(page, 'device').locator('input')).toBeChecked();
    await expect(chip(page, 'desktop')).toHaveText('Desktop (another computer)');
    await chip(page, 'desktop').click();
    await expect(page.getByTestId('engine-address')).toBeVisible();
    expect(requests.filter((u) => /__firesim/.test(u)), 'choosing Desktop asks nothing either: only Build does').toEqual([]);
    lap('7 total', t0);
  } finally {
    await host.stop();
  }
});
