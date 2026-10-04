/**
 * The pictures of the new screens for README.md and docs/screenshots/ (they are the product of this spec, so a stale one is
 * easy to spot and to regenerate): the Data sets screen, "How this simulation works", the Layers panel, heat maps, roads /
 * homes / zones / names, the colour-coded trees, "Where you are", and the simulation in the three looks (light, night and
 * high contrast) and at Android's 200 % font scale. Real engine, the bundled Katoomba demo (offline), one build; the looks are
 * switched on <html> (the same attributes Settings sets). Pictures are 412 x 915 CSS pixels (Pixel 7), a few hundred kB each.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, animationsDone, pickTool, pickViewMode, session, setSpeed, zoomView } from './helpers';

const SHOTS = 'docs/screenshots';
type Look = 'light' | 'dark' | 'high-contrast';
const LOOKS: Look[] = ['light', 'dark', 'high-contrast'];
const suffix = (l: Look): string => (l === 'light' ? '' : `-${l}`);

async function setLook(page: Page, look: Look): Promise<void> {
  await page.evaluate((l) => {
    const r = document.documentElement;
    r.dataset.theme = l === 'dark' ? 'dark' : 'light';
    if (l === 'high-contrast') r.dataset.contrast = 'high';
    else delete r.dataset.contrast;
  }, look);
  await page.waitForTimeout(200);
}

/** One picture per look (or just the light one), in CSS pixels. */
async function shot(page: Page, name: string, looks: Look[] = LOOKS): Promise<void> {
  for (const l of looks) {
    await setLook(page, l);
    await animationsDone(page);
    await page.screenshot({ path: `${SHOTS}/${name}${suffix(l)}.png`, scale: 'css' });
  }
  await setLook(page, 'light');
}

/** Scroll a screen's main column so that an element is at its top (under the app bar). */
async function scrollTo(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
    const main = el.closest('.screen-main');
    if (main) main.scrollTop -= 8;
  });
  await animationsDone(page);
}

async function fontScale(page: Page, k: number): Promise<void> {
  await page.evaluate((scale) => {
    document.getElementById('font-scale')?.remove();
    const cs = getComputedStyle(document.documentElement);
    const decl: string[] = [];
    for (const n of ['xs', 'sm', 'md', 'lg', 'xl', '2xl']) decl.push(`--fs-${n}: ${parseFloat(cs.getPropertyValue(`--fs-${n}`)) * scale}px !important`);
    for (const n of ['xs', 'sm', 'md', 'lg', 'xl']) decl.push(`--lh-${n}: ${parseFloat(cs.getPropertyValue(`--lh-${n}`)) * scale}px !important`);
    const st = document.createElement('style');
    st.id = 'font-scale';
    st.textContent = `:root { ${decl.join('; ')} }`;
    document.head.append(st);
  }, k);
  await page.waitForTimeout(250);
}

type V = { view: { setLayers(p: Record<string, unknown>): void; renderNow?(): void; projectToScreen(x: number, y: number): [number, number] | null } };
const setLayers = (page: Page, patch: Record<string, unknown>): Promise<void> =>
  page.evaluate((p) => {
    const v = (window as unknown as { __firesim: V }).__firesim.view;
    v.setLayers(p);
    v.renderNow?.();
  }, patch);

test('gallery: the new screens in light, night and high contrast, for README.md', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/?debug=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  // Setup with the planned data (a card), before building.
  await page.evaluate(() => document.getElementById('setup-data')?.scrollIntoView({ block: 'start' }));
  await page.getByTestId('plan-terrain').waitFor();
  await shot(page, '26-setup-data');
  await page.evaluate(() => document.querySelector('.setup-main')?.scrollTo(0, 0));
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });

  // A fire on the escarpment and a few minutes of it, then pause: the picture of a run.
  await pickTool(page, 'fire');
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await setSpeed(page, 600);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 180_000 }).toBeGreaterThan(1500);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(false);

  // ── The run in the three looks, collapsed; and the Tools dial ──
  await shot(page, '23-sim');
  await pickTool(page, 'layers'); // opens the Layers panel (a tool); the Tools dial itself is shown in 09-menus-open

  // ── Layers panel: map type and map details; a heat map on its own ──
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();
  await shot(page, '18-layers-panel');
  const ground = panel.getByTestId('layer-group-ground-and-terrain');
  if ((await ground.getAttribute('aria-expanded')) !== 'true') await ground.click();
  await panel.getByTestId('overlay-slope').click();
  await expect(panel.getByTestId('overlay-slope')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(600);
  await shot(page, '19-layers-heat-map', ['light', 'dark']);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await shot(page, '20-heat-map-legend', ['light']); // the map with its legend card
  await pickTool(page, 'layers');
  await panel.getByTestId('overlay-slope').click(); // off again
  await page.keyboard.press('Escape');

  // ── Roads, fire trails, homes, residential zones and place names on the map (top view) ──
  await pickViewMode(page, 'top');
  await setLayers(page, { roads: true, fireTrails: true, homes: true, zones: true, placeNames: true, vegetation: false, wind: 'off' });
  await page.waitForTimeout(800);
  await shot(page, '21-places', ['light']);
  await setLayers(page, { vegetation: true });

  // ── Trees coloured by bark hazard, close to the ground ──
  await pickViewMode(page, 'orbit');
  await zoomView(page, 'in', 3);
  await setLayers(page, { roads: false, fireTrails: false, homes: false, zones: false, placeNames: false, canopyStyle: 'coded', canopyCode: 'bark', wind: 'off' });
  await page.waitForTimeout(1500);
  await shot(page, '22-trees-coded', ['light']);
  await setLayers(page, { canopyStyle: 'natural', wind: 'surface' });
  await zoomView(page, 'out', 3);

  // ── "Where you are" in Why here? ──
  await pickViewMode(page, 'top');
  await pickTool(page, 'why');
  const p = await page.evaluate(() => (window as unknown as { __firesim: V }).__firesim.view.projectToScreen(0, 0));
  expect(p).not.toBeNull();
  await page.mouse.click(p![0], p![1]);
  await expect(page.getByTestId('why-where')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('why-where').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shot(page, '24-where-you-are', ['light']);
  await page.getByTestId('why-panel').getByRole('button', { name: 'Close' }).click();
  await pickViewMode(page, 'orbit');

  // ── Data sets: summary, the list, one data set, the memory and the storage ──
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-datasets').click();
  const ds = page.getByTestId('datasets-screen');
  await expect(ds).toBeVisible();
  await expect(ds.getByTestId('datasets-totals')).toBeVisible();
  await shot(page, '14-datasets-summary');
  await scrollTo(page, '[data-testid=datasets-list]');
  await shot(page, '15-datasets-list');
  await ds.getByTestId('dataset-row-terrain').click();
  await expect(page.getByTestId('dataset-detail')).toBeVisible();
  await shot(page, '16-datasets-detail');
  await scrollTo(page, '[data-testid=dataset-space]');
  await shot(page, '16b-datasets-detail-space', ['light', 'dark']); // with the preview in the heat map's own colours
  await scrollTo(page, '[data-testid=dataset-size]');
  await shot(page, '16c-datasets-detail-size', ['light']);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dataset-detail')).toBeHidden();
  await scrollTo(page, '[data-testid=datasets-memory]');
  await shot(page, '17b-datasets-memory', ['light', 'dark']);
  await scrollTo(page, '[data-testid=datasets-storage]');
  await shot(page, '17-datasets-storage');
  await page.keyboard.press('Escape');
  await expect(ds).toHaveCount(0);

  // ── How this simulation works: the top, and the live engine rows ──
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-model').click();
  const card = page.getByTestId('model-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('model-card-mode')).toContainText('Live');
  await card.locator('.screen-main').evaluate((m) => (m.scrollTop = 0));
  await shot(page, '12-model-card');
  const toggles = card.locator('.mc-toggle');
  for (let i = 0; i < (await toggles.count()); i++) if ((await toggles.nth(i).getAttribute('aria-expanded')) !== 'true') await toggles.nth(i).click();
  await scrollTo(page, '[data-section=engine]');
  await shot(page, '13-model-card-live');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  // ── At Android's 200 % font scale ──
  await fontScale(page, 2);
  await shot(page, '25-font-scale-200', ['light']);
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-datasets').click();
  await expect(ds).toBeVisible();
  await shot(page, '25b-font-scale-200-datasets', ['light']);
});
