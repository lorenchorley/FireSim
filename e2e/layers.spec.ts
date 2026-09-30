/**
 * The Layers panel and the layer finishing of the 3-D view, in the real app (bundled Katoomba demo, offline):
 *  - the panel lists every layer of the catalog exactly once in its place (map type, a tile, a switch, a heat-map row),
 *    greys out what cannot be shown with the catalog's reason, and each (i) opens the catalog text;
 *  - heat maps behave like a radio group that can be switched off; "Show on its own" hides the photo and the canopy and
 *    draws plain ground (read back from the 3-D view); the Plain map type does the same without a heat map;
 *  - toggling any layer, 40 times over, never leaks GPU objects (renderer.info stays constant) and never pauses;
 *  - the choices are remembered for the next run;
 *  - "Why here?" says where you are (nearest road and fire trail, homes nearby, the ground).
 */
import { expect, test, type Page } from '@playwright/test';
import { LAYER_CATALOG } from '../src/render/layerCatalog';
import { acceptNotice, openMenu, session } from './helpers';

async function buildKatoomba(page: Page): Promise<void> {
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
}

type ViewHandle = {
  view: {
    groundState?(): { imagery: boolean; plain: boolean; solo: boolean; canopyVisible: boolean };
    renderNow?(): void;
    renderer?: { info: { memory: { geometries: number; textures: number } } };
    setLayers(p: Record<string, unknown>): void;
    getLayers?(): Record<string, unknown>;
    projectToScreen(x: number, y: number): [number, number] | null;
  };
};

const ground = (page: Page) => page.evaluate(() => (window as unknown as { __firesim: ViewHandle }).__firesim.view.groundState?.() ?? null);

test('Layers panel: every catalog layer once, availability, (i), radio heat maps, solo and plain ground, remembered choices', async ({ page }) => {
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await buildKatoomba(page);

  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();

  // ── Every catalog row exactly once in its place ──
  for (const l of LAYER_CATALOG) {
    if (l.scene === 'imagery') await expect(panel.locator(`[data-maptype="photo"][data-layer="${l.id}"]`)).toHaveCount(1);
    else if (l.scene === 'crossSection') await expect(panel.locator(`.lp-switch[data-layer="${l.id}"]`)).toHaveCount(1);
    else if (l.scene) await expect(panel.locator(`.lp-tile[data-layer="${l.id}"]`)).toHaveCount(1);
    if (l.heat) {
      await expect(panel.locator(`.lp-heat[data-layer="${l.id}"]`)).toHaveCount(1);
      await expect(panel.getByTestId(`overlay-${l.heat.overlay}`)).toHaveCount(1);
    }
  }
  await expect(panel.getByTestId('legend')).toHaveCount(0);

  // ── Availability: the fire maps wait for a fire, with the catalog's reason ──
  const fireGroup = panel.getByTestId('layer-group-fire-and-weather');
  await expect(fireGroup).toHaveAttribute('aria-expanded', 'false');
  await fireGroup.click();
  await expect(panel.locator('.lp-heat[data-layer="arrival"]')).toContainText('Needs a fire: mark one first');
  await panel.getByTestId('overlay-arrival').click();
  await expect(panel.getByTestId('overlay-arrival')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByTestId('heat-info-arrival')).toBeVisible(); // a greyed-out map explains itself
  await fireGroup.click();

  // ── (i): the catalog text and the data set behind the layer ──
  await panel.getByTestId('layer-info-btn-roads').click();
  const info = panel.getByTestId('layer-info-tiles');
  await expect(info).toBeVisible();
  for (const k of ['What it shows', 'Why it matters', 'Where the data come from', 'How fine', 'How it is drawn', 'Available here']) await expect(info).toContainText(k);
  await expect(info.getByTestId('layer-dataset-roads')).toBeVisible();
  await panel.getByTestId('layer-info-btn-roads').click();
  await expect(info).toBeHidden();

  // ── Scene tiles switch one layer each ──
  const homes = panel.getByTestId('layer-homes');
  const before = await homes.getAttribute('aria-pressed');
  await homes.click();
  await expect(homes).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');

  // ── Heat maps: one at a time, tap again to switch off; solo hides the photo and the canopy ──
  await panel.getByTestId('overlay-slope').click();
  await expect(panel.getByTestId('overlay-slope')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('legend')).toHaveCount(1);
  expect(await ground(page)).toMatchObject({ imagery: false, plain: true, solo: true, canopyVisible: false });
  await panel.getByTestId('overlay-aspect').click();
  await expect(panel.getByTestId('overlay-slope')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByTestId('overlay-aspect')).toHaveAttribute('aria-pressed', 'true');
  await panel.getByTestId('solo-heat').click();
  await expect(panel.getByTestId('solo-heat').getByRole('switch')).not.toBeChecked();
  expect(await ground(page)).toMatchObject({ imagery: true, plain: false, solo: false });
  await panel.getByTestId('solo-heat').click();
  await panel.getByTestId('overlay-aspect').click();
  await expect(panel.getByTestId('overlay-aspect')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByTestId('legend')).toHaveCount(0);
  expect(await ground(page)).toMatchObject({ imagery: true, plain: false, solo: false });

  // ── Map type Plain ──
  await panel.getByTestId('maptype-plain').click();
  await expect(panel.getByTestId('maptype-plain')).toHaveAttribute('aria-checked', 'true');
  expect(await ground(page)).toMatchObject({ imagery: false, plain: true });

  // ── Both forms: roads can be shown and heat-mapped ──
  await panel.getByTestId('layer-group-places').click();
  await panel.getByTestId('overlay-roadAccess').click();
  await expect(panel.getByTestId('overlay-roadAccess')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('layer-roads-show')).toHaveAttribute('aria-pressed', 'true');

  // ── Remembered: the choices are saved in the preferences ──
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('firesim.layers') ?? 'null'));
  expect(saved?.layers?.overlay).toBe('roadAccess');
  expect(saved?.plainGround).toBe(true);
  expect(typeof saved?.layers?.homes).toBe('boolean');

  // ── Nothing ever paused the run ──
  expect((await session(page)).error).toBeNull();

  // ── Reset ──
  await panel.getByTestId('layers-reset').click();
  await expect(panel.getByTestId('maptype-photo')).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('firesim.layers'))).toBeNull();
  expect(errors).toEqual([]);
});

test('the remembered layer choices come back in the next run', async ({ page }) => {
  test.setTimeout(360_000);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await buildKatoomba(page);
  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  if ((await panel.getByTestId('layer-zones').getAttribute('aria-pressed')) !== 'true') await panel.getByTestId('layer-zones').click();
  await panel.getByTestId('overlay-elevation').click();
  await expect(panel.getByTestId('overlay-elevation')).toHaveAttribute('aria-pressed', 'true');
  // A new run (the preferences stay in this browser profile).
  await page.goto('/?debug=1');
  if (await page.getByTestId('notice').isVisible()) await acceptNotice(page);
  await buildKatoomba(page);
  await expect
    .poll(() => page.evaluate(() => ((window as unknown as { __firesim: ViewHandle }).__firesim.view.getLayers?.() ?? {}) as Record<string, unknown>).then((l) => [l.zones, l.overlay]))
    .toEqual([true, 'elevation']);
  await page.getByTestId('layers-fab').click();
  await expect(page.getByTestId('overlay-elevation')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('layer-zones')).toHaveAttribute('aria-pressed', 'true');
});

test('3-D view: toggling every layer 40 times keeps the GPU objects constant and never pauses', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await buildKatoomba(page);
  const r = await page.evaluate(() => {
    const v = (window as unknown as { __firesim: ViewHandle }).__firesim.view;
    if (!v.renderer || !v.renderNow) return null;
    const mem = (): { g: number; t: number } => ({ g: v.renderer!.info.memory.geometries, t: v.renderer!.info.memory.textures });
    const keys = ['roads', 'fireTrails', 'homes', 'zones', 'placeNames', 'flames', 'smoke', 'embers', 'insightMarkers', 'imagery', 'understorey', 'vegetation'];
    const cycle = (i: number): void => {
      for (const k of keys) v.setLayers({ [k]: i % 2 === 1 });
      v.setLayers({ overlay: i % 3 === 0 ? 'slope' : i % 3 === 1 ? 'homeDensity' : 'none', soloHeat: i % 4 < 2, windSway: i % 2 === 0, wind: i % 2 ? 'surface' : 'off' });
      v.renderNow!();
    };
    const settle = (): void => {
      v.setLayers({ roads: true, fireTrails: true, homes: true, zones: true, placeNames: true, flames: true, smoke: true, embers: true, insightMarkers: true, imagery: true, understorey: true, vegetation: true, overlay: 'none', soloHeat: true, windSway: true, wind: 'surface' });
      for (let i = 0; i < 3; i++) v.renderNow!();
    };
    // Warm up once (everything uploaded once), then measure.
    for (let i = 0; i < 4; i++) cycle(i);
    settle();
    const base = mem();
    for (let i = 0; i < 40; i++) cycle(i);
    settle();
    return { base, end: mem() };
  });
  expect(r).not.toBeNull();
  expect(r!.end.t).toBe(r!.base.t);
  expect(r!.end.g).toBe(r!.base.g);
  expect((await session(page)).playing).toBe(false); // it was paused before and nothing started or stopped it
});

test('Why here? says where you are: nearest road and fire trail, homes nearby, the ground', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await buildKatoomba(page);
  await openMenu(page, 'tools');
  await page.getByTestId('tool-why').click();
  const p = await page.evaluate(() => (window as unknown as { __firesim: ViewHandle }).__firesim.view.projectToScreen(0, 0));
  expect(p).not.toBeNull();
  await page.mouse.click(p![0], p![1]);
  const where = page.getByTestId('why-where');
  await expect(where).toBeVisible({ timeout: 30_000 });
  await expect(where).toContainText('Nearest road');
  await expect(where).toContainText('Nearest fire trail');
  await expect(where).toContainText('Homes nearby');
  await expect(where).toContainText('above sea level');
  await expect(where.locator('[data-place="trail"]')).toHaveText(/^(right here|[\d.,]+ k?m (N|NE|E|SE|S|SW|W|NW))/);
});
