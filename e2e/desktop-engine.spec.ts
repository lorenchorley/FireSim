/**
 * The desktop engine on the page (0.8.0, workstream J, lane J2), with the test seam `window.__firesimRemote` (e2e/desktopStub.ts)
 * standing in for the host, so the page's side is checked without lane J1's host. The real host and its wire are exercised by the
 * integration pass after both lanes merge.
 *
 * What is checked in the browser (Pixel 7 profile):
 *   - a page with no host has no Engine row and asks one same-origin question at most (`GET /__firesim/host`, the page's own
 *     origin: no request to any other origin); inside the Capacitor app it asks nothing, and does not even load the chunk;
 *   - with a host: the Engine row (This device / Desktop (NAME, N cores)), This device chosen; Desktop shows a box for the code;
 *     a wrong code is said in words next to the box, in the page (no pop-up, nothing with role=alert), and Setup stays;
 *   - a code in the address: Desktop is preselected, the box is not asked for, the code leaves the address bar and is nowhere in
 *     storage; the run then computes behind the stub's controller, with "Running on the desktop" on the map and the engine row in
 *     the debug statistics; This device never touches the stub;
 *   - the link closing during the run: the existing error chip says so and offers "Continue on this device" (never by itself); the tap
 *     restarts the same scenario on this device's engine, from the start, with the marks in their original order and times, and says so;
 *     the Engine row and the statistics say This device again. The desktop that cannot be reached at the start offers the same on Setup;
 *   - the layout of the row at 360 x 640, 390 x 844, 412 x 915 and 844 x 390 in light, dark and high contrast: inside the screen,
 *     44 x 44 px hit areas, text at least 14 px.
 * `EXPECT_REAL_DETECT=1` (after lane J1's `detectHost` is merged) also asks for exactly one same-origin question on a page with no host.
 */
import { mkdirSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { emulateCapacitorAndroid } from './androidBridge';
import { failLink, installDesktopStub, remoteCalls, type DesktopStubOptions } from './desktopStub';
import { expect, test } from './fixtures';
import { acceptNotice, armPopupWatch, popups, session, watchPopups } from './helpers';

const SHOTS = process.env.AUDIT_SHOTS ?? 'test-results/desktop-engine';
mkdirSync(SHOTS, { recursive: true });
const CODE = 'ABCD2345';
const SIZES: [number, number][] = [
  [360, 640],
  [390, 844],
  [412, 915],
  [844, 390],
];

async function openSetup(page: Page, o: { query?: string; hash?: string; stub?: DesktopStubOptions | false } = {}): Promise<void> {
  if (o.stub !== false) await installDesktopStub(page, o.stub ?? {});
  await page.goto(`/?${o.query ?? 'mock=1&debug=1'}${o.hash ?? ''}`);
  await acceptNotice(page);
  await expect(page.getByTestId('setup')).toBeVisible();
}

/** A page load after the first one: the safety notice was accepted for this browser, and shows again only if it was not. */
async function pastNotice(page: Page): Promise<void> {
  await expect(page.getByTestId('setup')).toBeVisible();
  await page.waitForTimeout(500);
  if (await page.getByTestId('notice').isVisible()) await page.getByTestId('accept-notice').click();
}

const row = (page: Page): Locator => page.getByTestId('engine-row');
const codeBox = (page: Page): Locator => page.getByTestId('engine-code');
const chip = (page: Page, value: 'device' | 'desktop'): Locator => page.getByTestId('engine').locator(`label.chip[data-value=${value}]`);

/** Every place the page may have put the code: storage, the address, the history entry and what the page wrote to the console. */
async function whereIsTheCode(page: Page, code: string): Promise<string[]> {
  return page.evaluate(async (c) => {
    const found: string[] = [];
    for (const [name, s] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]] as const) for (let i = 0; i < s.length; i++) if (`${s.key(i)}=${s.getItem(s.key(i)!)}`.includes(c)) found.push(name);
    if (location.href.includes(c)) found.push('address');
    if (JSON.stringify(history.state ?? null).includes(c)) found.push('history state');
    if (document.cookie.includes(c)) found.push('cookie');
    for (const d of (await indexedDB.databases?.()) ?? []) if ((d.name ?? '').includes(c)) found.push('indexedDB name');
    return found;
  }, code);
}

/** The eight probes of the repo's tap audit: a point around the centre that lands on something else is a hit area under 44 x 44 px. */
async function missedProbes(loc: Locator): Promise<number> {
  return loc.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const label = el.closest('label');
    return [[-21, 0], [21, 0], [0, -21], [0, 21], [-15, -15], [15, 15], [-15, 15], [15, -15]].filter(([dx, dy]) => {
      const hit = document.elementFromPoint(cx + dx!, cy + dy!);
      return !(hit && (el === hit || el.contains(hit) || (label && label.contains(hit))));
    }).length;
  });
}

const sameOrigin = (url: string, origin: string): boolean => new URL(url).origin === origin;

/** The Setup form for the real builder: the Katoomba demo, preset weather, offline (the build then takes seconds). */
async function chooseKatoombaOffline(page: Page): Promise<void> {
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
}

test('a page with no host: no Engine row, no change of Setup, and at most one same-origin question (never to another origin)', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const requests: { url: string; method: string }[] = [];
  context.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  await openSetup(page, { query: 'mock=1', stub: false });
  await page.waitForTimeout(1500); // the question has an 800 ms limit; the row would be there by now
  await expect(row(page)).toHaveCount(0);
  await expect(page.getByTestId('engine')).toHaveCount(0);
  await expect(page.getByTestId('engine-code')).toHaveCount(0);
  expect(requests.filter((r) => !sameOrigin(r.url, origin) && /^https?:/.test(r.url)), 'a request to another origin').toEqual([]);
  const asks = requests.filter((r) => new URL(r.url).pathname === '/__firesim/host');
  expect(asks.length).toBeLessThanOrEqual(1);
  for (const a of asks) expect(a.method).toBe('GET');
  if (process.env.EXPECT_REAL_DETECT === '1') expect(asks).toHaveLength(1); // lane J1's detectHost is merged: the one question is asked
});

test('inside the Capacitor app nothing is asked: no question to the host, and the desktop chunk is not even loaded', async ({ page, context }) => {
  const requests: string[] = [];
  context.on('request', (r) => requests.push(r.url()));
  await emulateCapacitorAndroid(page);
  await openSetup(page, { query: 'mock=1&debug=1' }); // with the stub installed: a host that would answer if it were asked
  await page.waitForTimeout(1500);
  expect((await remoteCalls(page)).filter((c) => c[0] === 'detect')).toEqual([]);
  expect(requests.filter((u) => /__firesim\/host/.test(u))).toEqual([]);
  expect(requests.filter((u) => /\/assets\/desktop-[^/]*\.js/.test(u))).toEqual([]);
  await expect(row(page)).toHaveCount(0);
});

test('the seam is honoured only with ?debug=1: without it a stub host is not a host', async ({ page }) => {
  await installDesktopStub(page, {});
  await page.goto('/?mock=1');
  await acceptNotice(page);
  await page.waitForTimeout(1500);
  await expect(row(page)).toHaveCount(0);
  expect((await remoteCalls(page)).filter((c) => c[0] === 'detect')).toEqual([]);
});

test('a host and no code: This device is chosen, Desktop shows a box for the code, a wrong code is said next to it and Setup stays', async ({ page }) => {
  await watchPopups(page);
  await openSetup(page);
  await armPopupWatch(page);
  await expect(row(page)).toBeVisible();
  await expect(page.getByTestId('engine').locator('legend')).toHaveText('Engine');
  await expect(chip(page, 'device')).toContainText('This device');
  await expect(chip(page, 'desktop')).toContainText('Desktop (Studio PC, 8 cores)');
  await expect(chip(page, 'device').locator('input')).toBeChecked();
  await expect(codeBox(page)).toBeHidden();
  await expect(page.getByTestId('engine-hint')).toHaveText('The simulation runs on this device.');
  // the row sits in the Run card, under the network switch
  await expect(page.locator('#setup-run').getByTestId('engine-row')).toBeVisible();

  await chip(page, 'desktop').click();
  await expect(chip(page, 'desktop').locator('input')).toBeChecked();
  await expect(codeBox(page)).toBeVisible();
  await expect(page.getByTestId('engine-hint')).toContainText('Type the code the desktop shows');
  // Build with no code: nothing is opened; the words say what to do next to the box
  await page.getByTestId('build').click();
  await expect(page.getByTestId('engine-problem')).toContainText('Type the code the desktop shows, then build again.');
  await expect(codeBox(page)).toBeFocused();
  expect((await remoteCalls(page)).filter((c) => c[0] === 'connect')).toEqual([]);

  // a wrong code
  await codeBox(page).fill('wrong 000');
  await expect(page.getByTestId('engine-problem')).toHaveCount(0); // typing takes the words away
  await page.getByTestId('build').click();
  await expect(page.getByTestId('engine-problem')).toContainText('The desktop did not accept that code.', { timeout: 10_000 });
  await expect(page.getByTestId('engine-problem')).toContainText('After several wrong tries it waits about a minute.');
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('building')).toHaveCount(0);
  await expect(codeBox(page)).toBeFocused();
  await expect(codeBox(page)).toHaveValue(''); // the refused code is forgotten
  // the words sit next to the box (the callout is in the row, under the box)
  const box = (await codeBox(page).boundingBox())!;
  const words = (await page.getByTestId('engine-problem').boundingBox())!;
  expect(words.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
  expect(words.y - (box.y + box.height)).toBeLessThan(40);
  // no pop-up, no alert, no toast anywhere
  expect(await popups(page)).toEqual([]);
  expect(await page.locator('[role=alert], [role=alertdialog], .toast, dialog[open]').count()).toBe(0);
  expect((await remoteCalls(page)).filter((c) => c[0] === 'connect')).toEqual([['connect', { base: new URL(page.url()).origin, rightCode: false }]]);
  expect(await whereIsTheCode(page, 'WRONG000')).toEqual([]);
});

test('an unreachable desktop is said in words too, and Build stays on Setup', async ({ page }) => {
  await openSetup(page, { stub: { unreachable: true }, hash: `#code=${CODE}` });
  await expect(chip(page, 'desktop').locator('input')).toBeChecked();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('engine-problem')).toContainText('Could not reach the desktop. Check that it is still running, then try again.', { timeout: 10_000 });
  await expect(page.getByTestId('setup')).toBeVisible();
});

test('a code in the address, on the real modules: Desktop is preselected, the address loses the code, nothing stores it, and the run computes behind the desktop controller', async ({ page, context, baseURL }) => {
  test.setTimeout(240_000);
  const origin = new URL(baseURL!).origin;
  const requests: string[] = [];
  context.on('request', (r) => requests.push(r.url()));
  await watchPopups(page);
  await openSetup(page, { query: 'debug=1', hash: `#code=${CODE}` });
  await chooseKatoombaOffline(page);
  await expect(row(page)).toBeVisible();
  // preselected, no box, the address and the history entry hold no code
  await expect(chip(page, 'desktop').locator('input')).toBeChecked();
  await expect(codeBox(page)).toBeHidden();
  await expect(page.getByTestId('engine-hint')).toHaveText('The simulation runs on the desktop computer. The code came with the link you opened.');
  await expect(page).not.toHaveURL(/#|code/);
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(await whereIsTheCode(page, CODE)).toEqual([]);

  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await armPopupWatch(page);
  const calls = await remoteCalls(page);
  expect(calls.filter((c) => c[0] === 'connect')).toEqual([['connect', { base: origin, rightCode: true }]]); // the page's own origin only
  expect(calls.filter((c) => c[0] === 'init')).toHaveLength(1); // the run is the stub's
  expect(calls.filter((c) => c[0] === 'detect')).toEqual([['detect', { base: origin, timeoutMs: 800 }]]);
  expect(await whereIsTheCode(page, CODE)).toEqual([]);

  // the label on the map, at the body size
  const banner = page.getByTestId('engine-banner');
  await expect(banner).toHaveText('Running on the desktop');
  expect(await banner.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  await expect(page.getByText('Demo engine')).toHaveCount(0);

  // the engine row in the debug statistics
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-debug-stats').click();
  await expect(page.getByTestId('debug-stats')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('debug-group-run').click();
  await expect(page.getByTestId('debug-group-run-body')).toContainText('Engine runs on');
  await expect(page.getByTestId('debug-group-run-body')).toContainText('Desktop Studio PC, 8 cores, Node v22.11.0, link 3.4 ms');
  await page.getByTestId('debug-stats-close').click();
  await expect(page.getByTestId('debug-stats')).toHaveCount(0);

  // everything the page asked for stayed on its own origin
  expect(requests.filter((u) => /^https?:/.test(u) && !sameOrigin(u, origin))).toEqual([]);
  expect(await popups(page)).toEqual([]);
});

test('This device on a host page: the run never touches the desktop, and the label is the demo engine\'s, not the desktop\'s', async ({ page }) => {
  test.setTimeout(180_000);
  await openSetup(page);
  await expect(chip(page, 'device').locator('input')).toBeChecked();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  expect((await remoteCalls(page)).filter((c) => c[0] === 'connect' || c[0] === 'init')).toEqual([]);
  await expect(page.getByTestId('engine-banner')).toHaveCount(0);
  await expect(page.locator('.mock-banner')).toHaveText('Demo engine'); // ?mock=1: the demo engine computes
});

test('the link closing during the run: the existing error chip says so, nothing else pops up, and the next Setup starts on This device', async ({ page }) => {
  test.setTimeout(180_000);
  await watchPopups(page);
  await openSetup(page, { hash: `#code=${CODE}` });
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('engine-banner')).toContainText('Running on the desktop');
  await armPopupWatch(page);
  await expect(page.getByTestId('error-chip')).toBeHidden();
  await failLink(page);
  const chipEl = page.getByTestId('error-chip');
  await expect(chipEl).toBeVisible();
  await expect(chipEl).toContainText('The desktop connection closed.');
  expect(await chipEl.locator('.error-chip-text').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  expect(await popups(page)).toEqual([]); // the chip is the one thing that may appear, and it is the app's own
  // the chip's Details button shows the same sentence in the insights tab
  await page.getByTestId('error-details').click();
  await expect(page.locator('.sim-error')).toContainText('The desktop connection closed.');
  await expect(page.locator('.sim-error')).toContainText('Tap “Continue on this device” to run this scenario again here, from the start');
  await expect(page.locator('.sim-error')).not.toContainText('try Play again'); // Play cannot bring a closed link back
  // start over: the next Setup starts on This device (the choice is for the page load, and the link is gone)
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(row(page)).toBeVisible();
  await expect(chip(page, 'device').locator('input')).toBeChecked();
  await expect(page.getByTestId('engine-hint')).toHaveText('The simulation runs on this device.');
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('engine-banner')).toHaveCount(0);
  await expect(page.getByTestId('error-chip')).toBeHidden();
});

/** Marks made during a run on the desktop: two fires and a fuel brush at the same time, a wind change that starts later, and a changed display step. */
async function markThings(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Session = { ignite(i: unknown): void; edit(e: unknown): void; setWindDirection(id: string, dir: number, at: number): void; setTimeStep(s: number): void };
    const s = (window as unknown as { __firesim: { session: Session } }).__firesim.session;
    s.ignite({ id: 'fire-a', kind: 'point', points: [[10, 10]], radius: 40, origin: 'observed' });
    s.edit({ kind: 'fuel', id: 'brush-1', shape: { kind: 'circle', x: 200, y: 200, radius: 150 }, surfaceHazardDelta: 1 });
    s.ignite({ id: 'fire-b', kind: 'point', points: [[40, 40]], radius: 40, origin: 'observed' });
    s.setWindDirection('turn-1', 200, 1800);
    s.setTimeStep(120);
  });
}

type Made = { demoEngine: boolean; log: unknown[][] };

/** Watch the engines the page makes from now on (its own `createController`, which gives the in-app engine once This device is chosen) and what each is sent. */
async function watchLocalEngines(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Engine = Record<string, (...a: unknown[]) => unknown>;
    const w = window as unknown as { __local: { demoEngine: boolean; log: unknown[][] }[]; __firesim: { services: { createController(): Engine } } };
    w.__local = [];
    const services = w.__firesim.services;
    const make = services.createController;
    services.createController = () => {
      const c = make();
      const log: unknown[][] = [];
      // (class names do not survive the production build: the demo engine is the one that holds its ignitions in a list of its own)
      w.__local.push({ demoEngine: Array.isArray((c as unknown as { ignitions?: unknown }).ignitions), log });
      const say: Record<string, (a: any[]) => unknown[]> = {
        init: (a) => ['init', a[0].name, a[0].ignitions.length, a[0].edits.length],
        ignite: (a) => ['ignite', a[0].id, a[0].time],
        edit: (a) => ['edit', a[0].id, a[1]],
        setOption: (a) => ['setOption', a[0], a[1]],
        run: (a) => ['run', a[0]],
      };
      for (const m of Object.keys(say)) {
        const f = (c[m] as (...a: unknown[]) => unknown).bind(c);
        c[m] = (...a: unknown[]) => (log.push(say[m]!(a)), f(...a));
      }
      return c;
    };
  });
}

const localEngines = (page: Page): Promise<Made[]> => page.evaluate(() => (window as unknown as { __local: Made[] }).__local);

test('the desktop link is cut mid-run: the chip offers "Continue on this device" and nothing happens until it is tapped; the tap restarts the same scenario here, from the start, and says so', async ({ page, context, baseURL }) => {
  test.setTimeout(240_000);
  const origin = new URL(baseURL!).origin;
  const requests: string[] = [];
  context.on('request', (r) => requests.push(r.url()));
  await watchPopups(page);
  await openSetup(page, { hash: `#code=${CODE}` });
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await armPopupWatch(page);
  await markThings(page);
  await watchLocalEngines(page);
  const sent = (await remoteCalls(page)).filter((c) => c[0] === 'ignite' || c[0] === 'edit');
  expect(sent.map((c) => c[1])).toEqual(['fire-a', 'brush-1', 'fire-b', 'turn-1']); // what the desktop was sent, in order

  // the link is lost: the chip says so and offers the action; the label stays, and nothing switches by itself
  await failLink(page);
  const chipEl = page.getByTestId('error-chip');
  const go = page.getByTestId('continue-here');
  await expect(chipEl).toContainText('The desktop connection closed.');
  await expect(go).toBeVisible();
  await expect(go).toHaveText('Continue on this device');
  await expect(chipEl.getByTestId('error-details')).toBeVisible();
  expect(await missedProbes(go), 'a 44 x 44 px hit area').toBe(0);
  expect(await go.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  await page.waitForTimeout(2000);
  expect(await localEngines(page), 'no engine is made before the tap').toEqual([]);
  await expect(page.getByTestId('engine-banner')).toContainText('Running on the desktop');
  expect((await session(page)).error).toBe('The desktop connection closed.');
  expect(await popups(page)).toEqual([]);
  expect(await page.locator('[role=alert]').count()).toBe(1); // the chip, which was always one; the action added none

  // the tap
  await go.click();
  await expect(page.getByTestId('engine-banner')).toHaveText('Running on this device again, from the start.');
  await expect(chipEl).toBeHidden();
  await expect(go).toHaveCount(0);
  const made = await localEngines(page);
  expect(made).toHaveLength(1);
  expect(made[0]!.demoEngine).toBe(true); // the in-app engine of this page (the demo engine under ?mock=1), through the page's own choice
  // the same scenario, then the options, then the marks in the order they were made, each with its time
  expect(made[0]!.log.filter((c) => c[0] !== 'run')).toEqual([
    ['init', expect.any(String), 0, 0],
    ['setOption', 'snapshotInterval', 120],
    ['ignite', 'fire-a', 0],
    ['edit', 'brush-1', 0],
    ['ignite', 'fire-b', 0],
    ['edit', 'turn-1', 1800],
  ]);
  const after = await remoteCalls(page);
  expect(after.filter((c) => c[0] === 'init')).toHaveLength(1); // the desktop's engine was started once, never again
  expect(after.filter((c) => c[0] === 'close').length).toBeGreaterThanOrEqual(1); // its link is closed
  // what the desktop computed is gone, what the person marked is not
  const st = await session(page);
  expect(st).toMatchObject({ viewTime: 0, playing: false, error: null });
  expect(st.ignitions).toEqual(['observed', 'observed']);

  // the statistics say This device again
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-debug-stats').click();
  await expect(page.getByTestId('debug-stats')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('debug-group-run').click();
  await expect(page.getByTestId('debug-group-run-body')).toContainText('This device (the run was started again here, from the start, after the desktop connection closed)');
  await expect(page.getByTestId('debug-group-run-body')).not.toContainText('Desktop Studio PC');
  await page.getByTestId('debug-stats-close').click();

  // the run goes on on this device: Play computes
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).headTime, { timeout: 60_000 }).toBeGreaterThan(0);
  expect((await localEngines(page))[0]!.log.some((c) => c[0] === 'run')).toBe(true);
  expect((await remoteCalls(page)).filter((c) => c[0] === 'init')).toHaveLength(1);

  // the next Setup says This device
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(chip(page, 'device').locator('input')).toBeChecked();
  await expect(page.getByTestId('engine-hint')).toHaveText('The simulation runs on this device.');
  expect(requests.filter((u) => /^https?:/.test(u) && !sameOrigin(u, origin))).toEqual([]);
  expect(await popups(page)).toEqual([]);
});

test('the desktop cannot be reached at the start: the note on Setup offers "Continue on this device", nothing starts by itself, and the tap builds the model and runs it here', async ({ page }) => {
  test.setTimeout(180_000);
  await openSetup(page, { stub: { unreachable: true }, hash: `#code=${CODE}` });
  await expect(chip(page, 'desktop').locator('input')).toBeChecked();
  await page.getByTestId('build').click();
  const note = page.getByTestId('engine-problem');
  await expect(note).toContainText('Could not reach the desktop.', { timeout: 10_000 });
  const go = page.getByTestId('continue-here-setup');
  await expect(go).toBeVisible();
  await expect(go).toHaveText('Continue on this device');
  expect(await missedProbes(go), 'a 44 x 44 px hit area').toBe(0);
  expect(await go.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  expect(await page.locator('[role=alert]').count()).toBe(0);
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('setup')).toBeVisible(); // nothing started by itself
  await expect(page.getByTestId('building')).toHaveCount(0);
  await go.click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  const calls = await remoteCalls(page);
  expect(calls.filter((c) => c[0] === 'connect')).toHaveLength(1); // the one try; the run is the in-app engine's
  expect(calls.filter((c) => c[0] === 'init')).toEqual([]);
  await expect(page.getByTestId('engine-banner')).toHaveCount(0);
  await expect(page.locator('.mock-banner')).toHaveText('Demo engine');
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  await expect(chip(page, 'device').locator('input')).toBeChecked();
});

test('a wrong code is not a lost link: it keeps its own wording next to the box and has no "Continue on this device"', async ({ page }) => {
  await openSetup(page);
  await chip(page, 'desktop').click();
  await codeBox(page).fill('WRONG000');
  await page.getByTestId('build').click();
  await expect(page.getByTestId('engine-problem')).toContainText('The desktop did not accept that code.', { timeout: 10_000 });
  await expect(page.getByTestId('continue-here-setup')).toHaveCount(0);
  await expect(page.getByTestId('continue-here')).toHaveCount(0);
});

for (const [w, h] of SIZES) {
  test(`the chip with "Continue on this device" and the label after the tap at ${w} x ${h}: inside the screen, 44 px hit areas, text of 14 px or more, clear of the round buttons, in light, dark and high contrast`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: w, height: h });
    for (const look of ['theme=light', 'theme=dark', 'theme=light&contrast=high']) {
      await installDesktopStub(page, {});
      await page.goto(`/?mock=1&debug=1&${look}#code=${CODE}`);
      await pastNotice(page);
      await expect(row(page)).toBeVisible();
      await page.getByTestId('build').click();
      await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
      await failLink(page);
      const go = page.getByTestId('continue-here');
      await expect(go).toBeVisible();
      const tag = `${w}x${h}-${look.replace(/[^a-z]+/g, '-')}`;
      const geo = await page.evaluate(() => {
        const rect = (sel: string): { l: number; r: number; t: number; b: number } | null => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return b.width ? { l: b.left, r: b.right, t: b.top, b: b.bottom } : null;
        };
        const chipRect = rect('[data-testid=error-chip]')!;
        const small: string[] = [];
        for (const el of document.querySelectorAll('[data-testid=error-chip] .error-chip-text, [data-testid=error-chip] button')) if (parseFloat(getComputedStyle(el).fontSize) < 14) small.push(el.className);
        return { chip: chipRect, inner: innerWidth, scrollW: document.documentElement.scrollWidth, small, go: rect('[data-testid=continue-here]')!, details: rect('[data-testid=error-details]')! };
      });
      expect(geo.chip.l, look).toBeGreaterThanOrEqual(0);
      expect(geo.chip.r, look).toBeLessThanOrEqual(geo.inner + 1);
      expect(geo.scrollW, look).toBeLessThanOrEqual(geo.inner);
      expect(geo.small, look).toEqual([]);
      expect(geo.go.r, look).toBeLessThanOrEqual(geo.chip.r + 1);
      expect(geo.details.r, look).toBeLessThanOrEqual(geo.chip.r + 1);
      expect(geo.go.l >= geo.details.r || geo.go.b <= geo.details.t || geo.go.r <= geo.details.l, `${look}: the two actions do not overlap`).toBe(true);
      expect(await missedProbes(go), `${look}: Continue`).toBe(0);
      expect(await missedProbes(page.getByTestId('error-details')), `${look}: Details`).toBe(0);
      await page.screenshot({ path: `${SHOTS}/chip-${tag}.png`, scale: 'css' });

      await go.click();
      const banner = page.getByTestId('engine-banner');
      await expect(banner).toHaveText('Running on this device again, from the start.');
      const lay = await page.evaluate(() => {
        const rect = (el: Element): { l: number; r: number; t: number; b: number } => {
          const b = el.getBoundingClientRect();
          return { l: b.left, r: b.right, t: b.top, b: b.bottom };
        };
        const banner = rect(document.querySelector('[data-testid=engine-banner]')!);
        const others = ['.map-fabs', '[data-testid=tools-menu]', '[data-testid=view-menu]'].map((s) => document.querySelector(s)).filter((e): e is Element => !!e && e.getBoundingClientRect().width > 0).map(rect);
        const hit = others.some((o) => banner.l < o.r && banner.r > o.l && banner.t < o.b && banner.b > o.t);
        return { banner, hit, inner: innerWidth, fs: parseFloat(getComputedStyle(document.querySelector('[data-testid=engine-banner]')!).fontSize) };
      });
      expect(lay.banner.l, look).toBeGreaterThanOrEqual(0);
      expect(lay.banner.r, look).toBeLessThanOrEqual(lay.inner);
      expect(lay.hit, `${look}: the label is clear of the round buttons`).toBe(false);
      expect(lay.fs, look).toBeGreaterThanOrEqual(14);
      await page.screenshot({ path: `${SHOTS}/restarted-${tag}.png`, scale: 'css' });
    }
  });
}

test('a typed code works, is remembered for the page load only, and the choice is not remembered across a reload', async ({ page }) => {
  test.setTimeout(180_000);
  await openSetup(page);
  await chip(page, 'desktop').click();
  await codeBox(page).fill(`${CODE.slice(0, 4)}-${CODE.slice(4).toLowerCase()}`); // as a phone keyboard might give it
  await expect(codeBox(page)).toHaveValue(`${CODE.slice(0, 4)}-${CODE.slice(4).toLowerCase()}`); // the box shows what was typed
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  expect((await remoteCalls(page)).filter((c) => c[0] === 'connect')).toEqual([['connect', { base: new URL(page.url()).origin, rightCode: true }]]);
  expect(await whereIsTheCode(page, CODE)).toEqual([]);
  expect(await whereIsTheCode(page, CODE.toLowerCase())).toEqual([]);
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  // back on Setup (same page load): still Desktop, the typed code is still in the box (as the page keeps it: capitals, no dash)
  await expect(chip(page, 'desktop').locator('input')).toBeChecked();
  await expect(codeBox(page)).toHaveValue(CODE);
  // a reload forgets both
  await page.reload();
  await pastNotice(page);
  await expect(row(page)).toBeVisible();
  await expect(chip(page, 'device').locator('input')).toBeChecked();
  await expect(codeBox(page)).toBeHidden();
  expect(await whereIsTheCode(page, CODE)).toEqual([]);
});

for (const [w, h] of SIZES) {
  test(`the Engine row at ${w} x ${h}: inside the screen, 44 px hit areas, text of 14 px or more, in light, dark and high contrast`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    for (const look of ['theme=light', 'theme=dark', 'theme=light&contrast=high']) {
      await installDesktopStub(page, { name: 'A very long computer name that should be cut', cores: 16 });
      await page.goto(`/?mock=1&debug=1&${look}`);
      await pastNotice(page);
      await expect(row(page)).toBeVisible();
      await chip(page, 'desktop').click();
      await expect(codeBox(page)).toBeVisible();
      await page.getByTestId('build').click(); // no code yet: the words show under the box
      await expect(page.getByTestId('engine-problem')).toBeVisible();
      await row(page).scrollIntoViewIfNeeded();
      const m = await page.evaluate(() => {
        const r = document.querySelector('[data-testid=engine-row]')!;
        const bad: string[] = [];
        for (const el of r.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (b.width && (b.right > innerWidth + 1 || b.left < -1)) bad.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className)} ${Math.round(b.left)}..${Math.round(b.right)}`);
        }
        const small: string[] = [];
        for (const el of r.querySelectorAll('.chip-text, .field-label, input, .hint, .callout div, legend')) {
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 14) small.push(`${el.tagName.toLowerCase()} ${fs}px`);
        }
        return { bad, small, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
      });
      expect(m.bad, look).toEqual([]);
      expect(m.small, look).toEqual([]);
      expect(m.scrollW, look).toBeLessThanOrEqual(m.clientW);
      expect(await missedProbes(chip(page, 'device')), `${look}: This device chip`).toBe(0);
      expect(await missedProbes(chip(page, 'desktop')), `${look}: Desktop chip`).toBe(0);
      expect(await missedProbes(codeBox(page)), `${look}: code box`).toBe(0);
      expect((await codeBox(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `${SHOTS}/engine-row-${w}x${h}-${look.replace(/[^a-z]+/g, '-')}.png`, scale: 'css' });
    }
  });
}
