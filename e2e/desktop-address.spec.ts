/**
 * The desktop engine, 0.9.0 (workstream P): the typed address of the Android app, the two-step label, the sentences of protocol 2, and the gaps of
 * "Continue on this device" that 0.8.0 left (plan 23.4). The desktop host is the test seam's stand-in (e2e/desktopStub.ts: it speaks protocol 2: a
 * probe with no name, a welcome with the name and the cores); the real host and a page from another origin are e2e/desktop-cross-origin.spec.ts.
 *
 * What is checked in the browser (Pixel 7 profile):
 *   - the typed address (`?desktopaddr=1`, the test seam for what the Android app does by itself): the Engine row with an address box and a code box,
 *     "Desktop (another computer)" until the desktop's welcome and "Desktop (NAME, N cores)" after it; a sentence for an empty address, a wrong one,
 *     no desktop there, a desktop there that will not let the app in, a wrong code, a version the page does not speak and a desktop with no free
 *     session; the address (never the code) remembered in the preferences and the page asking nothing before Build;
 *   - the same in the Capacitor app (the real bridge, emulated): the address in the native preferences, the code nowhere;
 *   - on a page a host serves, with the host really gone (every request to its origin refused after the link was open, or before it opened):
 *     a fresh engine made after the spare one failed starts from the script kept in memory; the speed test still runs; "Continue on this device"
 *     on Setup still builds the chosen demo site from the files kept when Desktop was chosen; the model card's planning text names the desktop;
 *   - the layout of the row with its address box at 360 x 640, 390 x 844, 412 x 915 and 844 x 390 in light, dark and high contrast.
 */
import { mkdirSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { emulateCapacitorAndroid } from './androidBridge';
import { chooseKatoombaOffline, failLink, installDesktopStub, missedProbes, remoteCalls, sameOrigin, untilQuiet, whereIsTheCode, type DesktopStubOptions } from './desktopStub';
import { expect, test } from './fixtures';
import { acceptNotice, session } from './helpers';

const SHOTS = process.env.AUDIT_SHOTS ?? 'test-results/desktop-address';
mkdirSync(SHOTS, { recursive: true });
const CODE = 'ABCD2345';
const ADDRESS = '192.168.1.20';
const BASE = 'http://192.168.1.20:4300';
const SIZES: [number, number][] = [
  [360, 640],
  [390, 844],
  [412, 915],
  [844, 390],
];

async function openTyped(page: Page, o: { stub?: DesktopStubOptions; query?: string } = {}): Promise<void> {
  await installDesktopStub(page, { base: BASE, ...o.stub });
  await page.goto(`/?${o.query ?? 'mock=1&debug=1&desktopaddr=1'}`);
  await acceptNotice(page);
  await expect(page.getByTestId('setup')).toBeVisible();
}

/** A page load after the first: the notice was accepted for this browser, and shows again only if it was not. */
async function pastNotice(page: Page): Promise<void> {
  await expect(page.getByTestId('setup')).toBeVisible();
  await page.waitForTimeout(500);
  if (await page.getByTestId('notice').isVisible()) await page.getByTestId('accept-notice').click();
}

const row = (page: Page): Locator => page.getByTestId('engine-row');
const codeBox = (page: Page): Locator => page.getByTestId('engine-code');
const addressBox = (page: Page): Locator => page.getByTestId('engine-address');
const problem = (page: Page): Locator => page.getByTestId('engine-problem');
const chip = (page: Page, value: 'device' | 'desktop'): Locator => page.getByTestId('engine').locator(`label.chip[data-value=${value}]`);
const calls = async (page: Page, kind: string): Promise<unknown[][]> => (await remoteCalls(page)).filter((c) => c[0] === kind).map((c) => c.slice(1));

/** Desktop chosen, an address and a code typed, Build pressed. */
async function typeAndBuild(page: Page, address: string, code: string): Promise<void> {
  if (!(await addressBox(page).isVisible())) await chip(page, 'desktop').click();
  await addressBox(page).fill(address);
  await codeBox(page).fill(code);
  await page.getByTestId('build').click();
}

test('a page that is not typed has no address box, and a typed one asks nobody before Build: the row, the words for an empty and a wrong address, and the two-step label', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  const requests: string[] = [];
  context.on('request', (r) => requests.push(r.url()));
  await openTyped(page);
  await page.waitForTimeout(1500);
  // nothing asked at start-up, of the page's own origin or any other
  expect(await remoteCalls(page)).toEqual([]);
  expect(requests.filter((u) => /__firesim\/host/.test(u))).toEqual([]);
  await expect(row(page)).toBeVisible();
  await expect(chip(page, 'device').locator('input')).toBeChecked();
  await expect(chip(page, 'device')).toHaveText('This device');
  await expect(chip(page, 'desktop')).toHaveText('Desktop (another computer)');
  await expect(addressBox(page)).toBeHidden();
  await expect(codeBox(page)).toBeHidden();

  await chip(page, 'desktop').click();
  await expect(addressBox(page)).toBeVisible();
  await expect(codeBox(page)).toBeVisible();
  await expect(page.locator('label[for]').filter({ hasText: 'Desktop address' })).toBeVisible();
  await expect(addressBox(page)).toHaveAttribute('placeholder', '192.168.1.20');
  await expect(addressBox(page)).toHaveAttribute('inputmode', 'url');
  await expect(page.getByTestId('engine-hint')).toHaveText('The simulation runs on another computer on this network. Type the address and the code the desktop shows.');
  // the address box sits above the code box, in the Run card
  const a = (await addressBox(page).boundingBox())!;
  const c = (await codeBox(page).boundingBox())!;
  expect(a.y + a.height).toBeLessThanOrEqual(c.y + 1);

  // nothing typed
  await page.getByTestId('build').click();
  await expect(problem(page)).toContainText('Type the desktop’s address, for example 192.168.1.20, then build again.');
  await expect(addressBox(page)).toBeFocused();
  // a kind of address that does not work here, then a path
  await addressBox(page).fill('ws://192.168.1.20');
  await expect(problem(page)).toHaveCount(0); // typing takes the words away
  await codeBox(page).fill(CODE);
  await page.getByTestId('build').click();
  await expect(problem(page)).toContainText('The address can start with http:// or https:// or with nothing at all.');
  await addressBox(page).fill('192.168.1.20/app');
  await page.getByTestId('build').click();
  await expect(problem(page)).toContainText('Leave out anything after it.');
  await addressBox(page).fill('fe80::1');
  await page.getByTestId('build').click();
  await expect(problem(page)).toContainText('Put an IPv6 address in square brackets');
  // none of that asked anyone
  expect(await remoteCalls(page)).toEqual([]);
  expect(requests.filter((u) => /^https?:/.test(u) && !sameOrigin(u, origin))).toEqual([]);
  await expect(page.getByTestId('setup')).toBeVisible();
  expect(await page.locator('[role=alert], [role=alertdialog], .toast, dialog[open]').count()).toBe(0);
});

test('no desktop at the address, a wrong code, and a good address and code: each has its sentence, the address (never the code) is remembered, and the chip names the desktop after its welcome', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  const requests: string[] = [];
  context.on('request', (r) => requests.push(r.url()));
  await openTyped(page);
  await chip(page, 'desktop').click();

  // an address where there is no desktop: the probe finds nothing, the code goes nowhere, and the words say what to check
  await typeAndBuild(page, '192.168.1.99', CODE);
  await expect(problem(page)).toContainText('No desktop answered at that address. Check that it is running with --lan and --allow-app, and that this device is on the same network.', { timeout: 10_000 });
  await expect(addressBox(page)).toBeFocused();
  await expect(codeBox(page)).toHaveValue(CODE); // not forgotten: it was not wrong
  expect(await calls(page, 'connect'), 'the code is not sent to an address that did not answer').toEqual([]);
  expect(await calls(page, 'detect')).toEqual([[{ base: 'http://192.168.1.99:4300', timeoutMs: 4000 }]]);
  expect(await calls(page, 'reach')).toEqual([['http://192.168.1.99:4300']]);
  await expect(page.getByTestId('continue-here-setup')).toBeVisible(); // this device is always there

  // the right address, a wrong code
  await addressBox(page).fill(ADDRESS);
  await codeBox(page).fill('wrong 000');
  await page.getByTestId('build').click();
  await expect(problem(page)).toContainText('The desktop did not accept that code.', { timeout: 10_000 });
  await expect(codeBox(page)).toBeFocused();
  await expect(codeBox(page)).toHaveValue('');
  await expect(addressBox(page)).toHaveValue(ADDRESS);
  await expect(page.getByTestId('continue-here-setup')).toHaveCount(0);
  await expect(chip(page, 'desktop')).toHaveText('Desktop (another computer)'); // a refused code tells nothing of the desktop

  // the right address and code: the run is the desktop's
  await codeBox(page).fill(CODE);
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  expect((await calls(page, 'connect')).map((c) => c[0])).toEqual([
    { base: BASE, rightCode: false },
    { base: BASE, rightCode: true },
  ]);
  expect((await calls(page, 'info')).map((c) => c[0]), 'the page hands the connection nothing of the probe (protocol 2: it has no name)').toEqual([false, false]);
  expect(await calls(page, 'init')).toHaveLength(1);
  await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');

  // the address is remembered, the code is nowhere
  expect(await page.evaluate(() => localStorage.getItem('firesim.desktopAddress'))).toBe(JSON.stringify(ADDRESS));
  expect(await whereIsTheCode(page, CODE)).toEqual([]);
  expect(await whereIsTheCode(page, 'WRONG000')).toEqual([]);
  expect(requests.filter((u) => /^https?:/.test(u) && !sameOrigin(u, origin)), 'the page asked nobody but the stand-in (a seam: no request at all)').toEqual([]);

  // the engine row in the debug statistics names the computer from the welcome
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-debug-stats').click();
  await expect(page.getByTestId('debug-stats')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('debug-group-run').click();
  await expect(page.getByTestId('debug-group-run-body')).toContainText('Desktop Studio PC, 8 cores, Node v22.11.0, link 3.4 ms');
  await page.getByTestId('debug-stats-close').click();

  // the second step of the label: after the welcome the chip names the desktop; a reload keeps the address and forgets the rest
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(chip(page, 'desktop')).toHaveText('Desktop (Studio PC, 8 cores)');
  await expect(chip(page, 'desktop').locator('input')).toBeChecked();
  await expect(addressBox(page)).toHaveValue(ADDRESS);
  await page.reload();
  await pastNotice(page);
  await expect(chip(page, 'device').locator('input')).toBeChecked();
  await expect(chip(page, 'desktop')).toHaveText('Desktop (another computer)'); // the name was for that page load
  await chip(page, 'desktop').click();
  await expect(addressBox(page)).toHaveValue(ADDRESS); // remembered in the preferences
  await expect(codeBox(page)).toHaveValue(''); // never
});

test('a desktop that is there but will not let the app in says so (and not "no answer"), a version the page does not speak and a full desktop have their own words; this device is offered for each', async ({ page }) => {
  test.setTimeout(240_000);
  // there, but the probe is refused as a browser's check of the desktop's allowed pages would refuse it
  await openTyped(page, { stub: { notAllowed: true } });
  await typeAndBuild(page, ADDRESS, CODE);
  await expect(problem(page)).toContainText('The desktop is there but did not let this app connect. Start it with --allow-app (or with --allow-origin for this page), then try again.', { timeout: 10_000 });
  await expect(problem(page)).not.toContainText('No desktop answered');
  expect(await calls(page, 'reach')).toEqual([[BASE]]);
  expect(await calls(page, 'connect')).toEqual([]);
  const go = page.getByTestId('continue-here-setup');
  await expect(go).toBeVisible();
  expect(await missedProbes(go), 'a 44 x 44 px hit area').toBe(0);
  // the tap builds the model and runs it here (the demo engine under ?mock=1)
  await go.click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.mock-banner')).toHaveText('Demo engine');
  expect(await calls(page, 'init')).toEqual([]);
});

test('a version of the link the page does not speak says both numbers and what to do; a full desktop says so', async ({ page }) => {
  test.setTimeout(120_000);
  const SAYS = 'This app and the desktop do not speak the same version of the link (this app speaks version 2, the desktop version 3). Update the app or the desktop host.';
  // the probe says the host speaks version 3: it is still a host, the connection is refused at once (no socket, the code goes nowhere), and the words say to update
  await openTyped(page, { stub: { hostProtocol: 3 } });
  await typeAndBuild(page, ADDRESS, CODE);
  await expect(problem(page)).toContainText(SAYS, { timeout: 10_000 });
  await expect(problem(page)).not.toContainText('did not accept');
  await expect(problem(page)).not.toContainText('No desktop answered');
  expect(await calls(page, 'probe'), 'the probe went with the connection').toEqual([[3]]);
  expect(await calls(page, 'init')).toEqual([]);
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('continue-here-setup')).toBeVisible();

  // a host that says so only in its welcome (an error with the two numbers) is told the same way
  const third = await page.context().newPage();
  await installDesktopStub(third, { base: BASE, versionMismatch: { page: 2, host: 3 } });
  await third.goto('/?mock=1&debug=1&desktopaddr=1');
  await acceptNotice(third);
  await typeAndBuild(third, ADDRESS, CODE);
  await expect(problem(third)).toContainText(SAYS, { timeout: 10_000 });

  const second = await page.context().newPage();
  await installDesktopStub(second, { base: BASE, noSession: true });
  await second.goto('/?mock=1&debug=1&desktopaddr=1');
  await acceptNotice(second);
  await typeAndBuild(second, ADDRESS, CODE);
  await expect(problem(second)).toContainText('The desktop has no free session. Close a run on it, or start it with more --max-sessions, then try again.', { timeout: 10_000 });
  await expect(problem(second)).not.toContainText('Could not reach');
});

test('inside the Capacitor app: the address goes to the native preferences and the code nowhere, and a run on the desktop starts from the typed address', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  const requests: string[] = [];
  context.on('request', (r) => requests.push(r.url()));
  await emulateCapacitorAndroid(page, { persistPreferences: true });
  await installDesktopStub(page, { base: BASE });
  await page.goto('/?mock=1&debug=1');
  await acceptNotice(page);
  await expect(page.getByTestId('setup')).toBeVisible();
  expect(await calls(page, 'detect')).toEqual([]); // the app asks nobody at start-up
  await expect(chip(page, 'desktop')).toHaveText('Desktop (another computer)');
  await typeAndBuild(page, ADDRESS, CODE);
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  expect(await calls(page, 'connect')).toEqual([[{ base: BASE, rightCode: true }]]);
  expect(await calls(page, 'detect')).toEqual([[{ base: BASE, timeoutMs: 4000 }]]);
  // the native preferences hold the address; nothing of them (and no storage of the page) holds the code
  const prefs = await page.evaluate(() => sessionStorage.getItem('__nativePrefs') ?? '');
  expect(prefs).toContain('firesim.desktopAddress');
  expect(prefs).toContain(JSON.stringify(JSON.stringify(ADDRESS)).slice(1, -1));
  expect(prefs).not.toContain(CODE);
  expect(await whereIsTheCode(page, CODE)).toEqual([]);
  // the app keeps no spare engine and warms nothing for the desktop's going away: its own files are always there
  expect(requests.filter((u) => /\/assets\/(worker|speedTest\.worker)-/.test(u))).toEqual([]);
  expect(requests.filter((u) => /^https?:/.test(u) && !sameOrigin(u, origin))).toEqual([]);
  await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');
  // back to Setup after the link: the address is there, the chip names the desktop
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  await expect(chip(page, 'desktop')).toHaveText('Desktop (Studio PC, 8 cores)');
  await expect(addressBox(page)).toHaveValue(ADDRESS);
  await expect(codeBox(page)).toHaveValue(CODE); // kept in memory for this page load, as for a link's typed code
});

test('the model card\'s planning text follows the engine: Desktop chosen on Setup names the desktop, This device the phone', async ({ page }) => {
  test.setTimeout(180_000);
  await openTyped(page, { query: 'debug=1&desktopaddr=1' }); // the real modules: the card plans from the form
  await page.getByTestId('setup-model-card').click();
  await expect(page.getByTestId('model-card')).toBeVisible();
  await expect(page.getByTestId('model-card-headline')).toContainText('unless a short timing test on this phone, when the run starts, finds it far too slow');
  await page.getByTestId('model-card-close').click();
  await chip(page, 'desktop').click();
  await page.getByTestId('setup-model-card').click();
  await expect(page.getByTestId('model-card-headline')).toContainText('unless a short timing test on the desktop, when the run starts, finds it far too slow');
  await expect(page.getByTestId('model-card-headline')).not.toContainText('this phone');
  await page.getByTestId('model-card-close').click();
  await chip(page, 'device').click();
  await page.getByTestId('setup-model-card').click();
  await expect(page.getByTestId('model-card-headline')).toContainText('on this phone, when the run starts');
});

/** Everything the page asked of its own origin, with the path. */
function watchAsked(page: Page, origin: string): { all: string[] } {
  const seen = { all: [] as string[] };
  page.context().on('request', (r) => {
    if (sameOrigin(r.url(), origin)) seen.all.push(new URL(r.url()).pathname);
  });
  return seen;
}

/** From now on every request to the page's own origin fails, as it does when the host has been shut down. Returns the paths it refused. */
async function hostGoes(page: Page, origin: string): Promise<string[]> {
  const refused: string[] = [];
  await page.route(
    (u) => sameOrigin(u.href, origin),
    (route) => {
      refused.push(new URL(route.request().url()).pathname);
      return route.abort('connectionrefused');
    },
  );
  return refused;
}

test('the host is gone and the spare engine failed: the second try starts a fresh engine from the script kept in memory, the speed test still runs, and nothing under /assets is asked of the gone host', async ({ page, baseURL }) => {
  test.setTimeout(420_000);
  test.info().annotations.push({ type: 'network-failures' }); // the requests this test refuses are reported by the browser
  const origin = new URL(baseURL!).origin;
  const asked = watchAsked(page, origin);
  await installDesktopStub(page, {});
  await page.goto(`/?debug=1#code=${CODE}`);
  await acceptNotice(page);
  await expect(chip(page, 'desktop').locator('input')).toBeChecked();
  await chooseKatoombaOffline(page);
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await untilQuiet(() => asked.all.length);
  const before = [...asked.all];
  expect(before.filter((u) => /\/assets\/worker-/.test(u)).length, 'the engine\'s script was read while the host was there').toBeGreaterThanOrEqual(1);
  expect(before.filter((u) => /\/assets\/speedTest\.worker-/.test(u)).length, 'so was the speed test\'s').toBeGreaterThanOrEqual(1);
  expect(before.filter((u) => /\/assets\/estimate-/.test(u)).length, 'and the Setup plan chunk').toBeGreaterThanOrEqual(1);

  // the card's planning text on this run names the desktop (the stand-in sends no report yet, so the card is the plan of the scenario)
  await page.getByTestId('tab-stats').click();
  await page.getByTestId('stats-model-card').click();
  await expect(page.getByTestId('model-card')).toBeVisible();
  const toggles = page.getByTestId('model-card').locator('.mc-toggle');
  for (let i = 0; i < (await toggles.count()); i++) if ((await toggles.nth(i).getAttribute('aria-expanded')) !== 'true') await toggles.nth(i).click();
  await expect(page.getByTestId('model-card-headline')).toContainText('unless a short timing test on the desktop, when the run starts');
  const atmosphere = await page.getByTestId('model-row-atmosphere').innerText();
  expect(atmosphere).toContain('from a short timing test on the desktop.');
  expect(atmosphere).toContain('The desktop does that timing itself');
  expect(atmosphere).not.toContain('this phone');
  await page.getByTestId('model-card-close').click();

  // the spare engine fails when it is asked to start, and the host goes
  await page.evaluate(() => {
    const c = (window as unknown as { __firesim: { session: { controller: { standby: { init(): Promise<unknown> } | null } } } }).__firesim.session.controller;
    c.standby!.init = async () => {
      await new Promise((r) => setTimeout(r, 800));
      throw new Error('worker failed');
    };
  });
  const refused = await hostGoes(page, origin);
  await failLink(page);
  const go = page.getByTestId('continue-here');
  await expect(go).toBeVisible();
  await go.click();
  await expect(page.getByTestId('error-chip')).toContainText('This device could not start the run. Tap to try again.', { timeout: 20_000 });
  // the second tap: a fresh engine, started from the script in memory (a worker whose address is a blob), not from the gone host
  await go.click();
  await expect(page.getByTestId('engine-banner')).toHaveText('Running on this device again, from the start.', { timeout: 60_000 });
  expect(page.workers().filter((w) => w.url().startsWith('blob:')).length, 'the engine is a worker started from a blob').toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(3000);
  expect((await session(page)).error).toBeNull();
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).headTime, { message: 'Play computes on this device', timeout: 120_000 }).toBeGreaterThan(0);

  // the speed test, with the host gone: it starts from its copy in memory and gives a result
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-debug-stats').click();
  await expect(page.getByTestId('debug-stats')).toBeVisible({ timeout: 30_000 });
  const canDo = page.getByTestId('debug-group-canDo');
  if ((await canDo.getAttribute('aria-expanded')) !== 'true') await canDo.click();
  await page.getByTestId('speed-test').scrollIntoViewIfNeeded();
  await page.getByTestId('speed-test').click();
  await expect(page.locator('[data-testid=debug-group-canDo-body] [data-row=speed-test] .mc-fact-value')).toContainText('Test version', { timeout: 60_000 });
  await expect(page.locator('[data-testid=debug-group-canDo-body] [data-row=speed-test]')).not.toContainText('failed');

  expect(refused.filter((u) => /\/assets\//.test(u)), 'nothing under /assets was needed from the gone host').toEqual([]);
  console.log(`[desktop-address] asked of the gone host: ${refused.join(' ') || 'nothing'}`);
});

test('the host dies before the link opens: the demo site chosen when Desktop was chosen is still here, so Continue on this device on Setup builds the model and runs it', async ({ page, baseURL }) => {
  test.setTimeout(420_000);
  test.info().annotations.push({ type: 'network-failures' });
  const origin = new URL(baseURL!).origin;
  const asked = watchAsked(page, origin);
  await installDesktopStub(page, { unreachable: true });
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await chooseKatoombaOffline(page);
  await chip(page, 'desktop').click(); // Desktop chosen: the page keeps Katoomba's files (and loads what it would ask a gone host for)
  await expect(codeBox(page)).toBeVisible();
  await expect.poll(() => asked.all.filter((u) => /\/demo\/katoomba\/terrarium\//.test(u)).length, { message: 'the site\'s terrain tiles were read', timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  await untilQuiet(() => asked.all.length);
  const kept = asked.all.filter((u) => /\/demo\/katoomba\//.test(u));
  console.log(`[desktop-address] kept for Katoomba: ${[...new Set(kept)].map((u) => u.replace('/demo/katoomba/', '')).join(' ')}`);
  for (const f of ['manifest.json', 'canopy.png', 'context.json', 'dem5m.png']) expect(kept.some((u) => u.endsWith(f)), f).toBe(true);

  // the host goes before Build: the link cannot open
  const refused = await hostGoes(page, origin);
  await codeBox(page).fill(CODE);
  await page.getByTestId('build').click();
  await expect(problem(page)).toContainText('Could not reach the desktop.', { timeout: 20_000 });
  const go = page.getByTestId('continue-here-setup');
  await expect(go).toBeVisible();
  await go.click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('engine-banner')).toHaveCount(0); // the real engine of this device, not a label of the desktop's
  expect(refused.filter((u) => /\/demo\//.test(u)), 'no demo file was asked of the gone host').toEqual([]);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).headTime, { message: 'Play computes on this device', timeout: 180_000 }).toBeGreaterThan(0);
  expect((await session(page)).error).toBeNull();
  console.log(`[desktop-address] asked of the gone host from the tap on: ${refused.join(' ') || 'nothing'}`);
});

for (const [w, h] of SIZES) {
  test(`the Engine row with its address box at ${w} x ${h}: inside the screen, 44 px hit areas, text of 14 px or more, in light, dark and high contrast`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    for (const look of ['theme=light', 'theme=dark', 'theme=light&contrast=high']) {
      await installDesktopStub(page, { base: BASE, name: 'A very long computer name that should be cut', cores: 16 });
      await page.goto(`/?mock=1&debug=1&desktopaddr=1&${look}`);
      await pastNotice(page);
      await expect(row(page)).toBeVisible();
      await chip(page, 'desktop').click();
      await expect(addressBox(page)).toBeVisible();
      await page.getByTestId('build').click(); // nothing typed: the words show under the boxes
      await expect(problem(page)).toBeVisible();
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
      expect(await missedProbes(addressBox(page)), `${look}: address box`).toBe(0);
      expect(await missedProbes(codeBox(page)), `${look}: code box`).toBe(0);
      expect((await addressBox(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `${SHOTS}/address-row-${w}x${h}-${look.replace(/[^a-z]+/g, '-')}.png`, scale: 'css' });
    }
  });
}

test('after the welcome the chip names a desktop with a long name in one line that fits a 360 px screen', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await openTyped(page, { stub: { name: 'A very long computer name that should be cut', cores: 16 } });
  await typeAndBuild(page, ADDRESS, CODE);
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  await expect(chip(page, 'desktop')).toHaveText('Desktop (A very long computer na…, 16 cores)'); // cut at 24 characters, with an ellipsis
  const m = await chip(page, 'desktop').evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { r: b.right, inner: innerWidth, h: b.height };
  });
  expect(m.r).toBeLessThanOrEqual(m.inner);
});
