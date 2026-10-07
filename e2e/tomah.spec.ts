/**
 * The bundled Mount Tomah demo site in the real app (production build, Pixel 7 profile, offline preset weather):
 *   Setup lists nine demo cards with Mount Tomah right after Blackheath, its photo thumbnail drawn from the bundled aerial image;
 *   choosing it and building gives the 3-D terrain of the NSW 5 m model (ground heights read from the scenario against the bundle's
 *   own range: the summit is about 1,000 m), the roads and Bells Line of Road from the bundle, a fire on the ridge that burns, and
 *   not a single request outside the app's own files.
 * Pictures go to test-results/tomah/ (looked at by hand; not README pictures).
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from './fixtures';
import { acceptNotice, pickTool, pickViewMode, session, setSpeed } from './helpers';
import { DEMO_SITES } from '../src/data/demoSites';

const SHOTS = 'test-results/tomah';
mkdirSync(SHOTS, { recursive: true });

type Handle = {
  scenario: { name: string; terrain: { minElevation: number; maxElevation: number; source: string; grid: { nx: number } }; context?: { roads: { name?: string }[]; homes: number[] } };
  view: { flyTo(x: number, y: number, d: number): void; setLayers(p: Record<string, unknown>): void; projectToScreen(x: number, y: number): [number, number] | null };
};

test('Mount Tomah: the card on the Setup screen, the build from the bundle, the ground heights, a fire on the ridge', async ({ page }) => {
  test.setTimeout(420_000);
  const outside: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname) && u.protocol.startsWith('http')) outside.push(r.url());
  });
  await page.goto('/?debug=1');
  await acceptNotice(page);

  // ── Setup: one card per demo site, Mount Tomah next to its neighbours, with its photo ──
  const cards = page.locator('[data-testid^=site-]');
  await expect(cards).toHaveCount(DEMO_SITES.length);
  const order = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(order.indexOf('site-tomah')).toBe(order.indexOf('site-grose') + 1);
  const tomah = page.getByTestId('site-tomah');
  await tomah.scrollIntoViewIfNeeded();
  await expect(tomah).toContainText('Mount Tomah');
  await expect(tomah).toContainText('Blue Mountains');
  await expect(tomah).toContainText('Bells Line of Road');
  // The photo: the thumbnail's canvas (or img) is there and holds more than one colour.
  const thumb = tomah.locator('.site-thumb canvas, .site-thumb img');
  await expect(thumb).toHaveCount(1, { timeout: 30_000 });
  const varied = await tomah.locator('.site-thumb canvas').evaluate((c) => {
    const cv = c as HTMLCanvasElement;
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i]! >> 4) * 256 + (d[i + 1]! >> 4) * 16 + (d[i + 2]! >> 4));
    return seen.size;
  });
  expect(varied).toBeGreaterThan(20);
  await tomah.click();
  await expect(tomah).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: `${SHOTS}/01-setup-card.png` });

  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 240_000 });

  // ── The terrain is the bundled 5 m model: heights against the bundle's own range (the default 6 km domain is the middle of the 9 km square), Mount Tomah about 1,000 m ──
  const info = await page.evaluate(async () => {
    const fs = (window as unknown as { __firesim: Handle }).__firesim;
    const dem = (await (await fetch('/demo/tomah/dem5m.json')).json()) as { minElevation: number; maxElevation: number };
    const t = fs.scenario.terrain;
    return { name: fs.scenario.name, source: t.source, min: t.minElevation, max: t.maxElevation, demMin: dem.minElevation, demMax: dem.maxElevation, nx: t.grid.nx, roads: fs.scenario.context?.roads.map((r) => r.name ?? '') ?? [], homes: (fs.scenario.context?.homes.length ?? 0) / 2 };
  });
  expect(info.name).toMatch(/Mount Tomah/);
  expect(info.source).toMatch(/NSW_5M_Elevation/);
  expect(info.source).toMatch(/bundled demo 'tomah'/);
  expect(info.max).toBeLessThanOrEqual(info.demMax + 1);
  expect(info.min).toBeGreaterThanOrEqual(info.demMin - 1);
  expect(info.max).toBeGreaterThan(950);
  expect(info.max).toBeLessThan(1100);
  expect(info.min).toBeGreaterThan(250);
  expect(info.roads.some((n) => /Bells Line/i.test(n))).toBe(true);
  expect(info.homes).toBeGreaterThan(100);
  test.info().annotations.push({ type: 'elevation', description: `scenario ${info.min.toFixed(0)}-${info.max.toFixed(0)} m, bundle ${info.demMin}-${info.demMax} m, ${info.nx} x ${info.nx} fire cells` });

  // ── Looking at it: orbit, then the top view with the roads over the photo ──
  await page.evaluate(() => (window as unknown as { __firesim: Handle }).__firesim.view.setLayers({ roads: true, fireTrails: true, imagery: true, homes: true, placeNames: true }));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/02-orbit.png` });
  await pickViewMode(page, 'top');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/03-top-roads.png` });
  await page.evaluate(() => (window as unknown as { __firesim: Handle }).__firesim.view.flyTo(0, -1200, 1800));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/04-top-closer.png` });
  await pickViewMode(page, 'orbit');

  // ── A fire on the ridge south of the centre burns ──
  await pickTool(page, 'fire');
  await page.evaluate(() => (window as unknown as { __firesim: Handle }).__firesim.view.flyTo(0, -1200, 2500));
  await page.waitForTimeout(1500);
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 180_000 }).toBeGreaterThan(1800);
  await page.getByTestId('play').click();
  const s = await session(page);
  expect(s.error).toBeNull();
  expect(s.area).toBeGreaterThan(1);
  await page.screenshot({ path: `${SHOTS}/05-fire-burning.png` });
  test.info().annotations.push({ type: 'fire', description: `${s.area.toFixed(1)} ha after ${Math.round(s.viewTime / 60)} min` });

  // Everything came from the app's own files: no request left the machine.
  expect(outside).toEqual([]);
});
