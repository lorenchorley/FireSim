/**
 * The Layers panel and the layer finishing of the 3-D view, in the real app (bundled Katoomba demo, offline):
 *  - the panel lists every layer of the catalog exactly once in its place (map type, a tile, a switch, a heat-map row),
 *    greys out what cannot be shown with the catalog's reason, and each (i) opens the catalog text;
 *  - heat maps behave like a radio group that can be switched off; "Show on its own" hides the photo and the canopy and
 *    draws plain ground (read back from the 3-D view); the Plain map type does the same without a heat map;
 *  - toggling any layer, 40 times over, never leaks GPU objects (renderer.info stays constant) and never pauses;
 *  - the choices are remembered for the next run;
 *  - the wind arrows and flow lines (0.5.0): a switch row with the Wind height chips, built when it is first on and kept under the DOM budget,
 *    remembered; on the real glyph layer the map legend, the caption and the line about the zoom follow the camera; the 2-D map says why it cannot;
 *  - "Why here?" says where you are (nearest road and fire trail, homes nearby, the ground).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { LAYER_CATALOG } from '../src/render/layerCatalog';
import { LEVEL_LINE, SMOOTH_FIT_LINE } from '../src/ui/screens/sim/glyphWords';
import { SCENE_WITH_SETTINGS } from '../src/ui/screens/sim/layersModel';
import { acceptNotice, openMenu, pickViewMode, session, viewMenuAction } from './helpers';

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
    else if (SCENE_WITH_SETTINGS.has(l.scene!)) await expect(panel.locator(`.lp-switch[data-layer="${l.id}"]`)).toHaveCount(1); // a switch row: the wind arrows and flow lines, the air slice
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

// ─────────────────────────────────────────────────────────────────────────────
// Arrows and flow lines (0.5.0)
// ─────────────────────────────────────────────────────────────────────────────

type AirHandle = { __firesim: { session: { state: { get(): { snapshot: { atmosphere?: { nz: number } } | null } } } } };
/** The air picture exists once the first snapshot is in (the switch waits for it, with its reason). */
const airPicture = (page: Page): Promise<boolean> => page.evaluate(() => ((window as unknown as AirHandle).__firesim.session.state.get().snapshot?.atmosphere?.nz ?? 0) > 0);
/** The 3-D view has the glyph layer (`windGlyphStats`): the spec that reads the layer's own numbers needs it. */
const hasGlyphLayer = (page: Page): Promise<boolean> => page.evaluate(() => typeof (window as unknown as { __firesim: { view: { windGlyphStats?: unknown } } }).__firesim.view.windGlyphStats === 'function');
const layersOf = (page: Page): Promise<Record<string, unknown>> => page.evaluate(() => ((window as unknown as { __firesim: ViewHandle }).__firesim.view.getLayers?.() ?? {}) as Record<string, unknown>);

test('Arrows and flow lines: a switch row with the seven Wind height chips (What the fire feels first) built when it is first on, remembered, and the Layers panel stays under 1,000 nodes', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await buildKatoomba(page);
  await expect.poll(() => airPicture(page), { timeout: 90_000 }).toBe(true);

  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();
  const nodes = (): Promise<number> => panel.evaluate((el) => el.querySelectorAll('*').length);
  const rowNodes = (): Promise<number> => panel.locator('.lp-switch[data-layer="windGlyphs"]').evaluate((el) => el.querySelectorAll('*').length);

  // ── The row: in Wind and air, a switch with the (i); the chips are not built yet ──
  const row = panel.locator('.lp-switch[data-layer="windGlyphs"]');
  await expect(row).toHaveCount(1);
  await expect(panel.locator('.lp-tile[data-layer="windGlyphs"]')).toHaveCount(0);
  await expect(row.locator('xpath=ancestor::section[@aria-label="Wind and air"]')).toHaveCount(1);
  await expect(row).toContainText('Arrows and flow lines');
  const sw = panel.getByTestId('layer-windGlyphs');
  await expect(sw.getByRole('switch')).not.toBeChecked();
  await expect(sw.getByRole('switch')).toBeEnabled(); // both tiers publish a wind
  await expect(panel.getByTestId('wind-glyph-reason')).toBeHidden();
  await expect(panel.getByTestId('wind-height')).toHaveCount(0);
  await expect(panel.getByTestId('wind-layer')).toBeVisible(); // the streaks' own control stays
  const offNodes = await nodes();
  const offRow = await rowNodes();

  // ── (i): the catalog text ──
  await panel.getByTestId('layer-info-btn-windGlyphs').click();
  const info = panel.getByTestId('layer-info-windGlyphs');
  await expect(info).toBeVisible();
  for (const k of ['What it shows', 'Why it matters', 'Where the data come from', 'How fine', 'How it is drawn', 'Available here']) await expect(info).toContainText(k);
  await expect(info).toContainText('smooth fit through them, not new detail');
  await expect(info).toContainText('60 m for What the fire feels'); // (0.7.0) the finer cells of the new chip are said in the row's own words
  await panel.getByTestId('layer-info-btn-windGlyphs').click();
  await expect(info).toBeHidden();

  // ── On: the view's windGlyphs, the chips (What the fire feels first, and the new default), the caption ──
  await sw.click();
  await expect.poll(async () => (await layersOf(page)).windGlyphs).toBe(true);
  await expect(sw.getByRole('switch')).toBeChecked();
  const chips = panel.getByTestId('wind-height');
  await expect(chips).toBeVisible();
  await expect(chips.getByRole('radio')).toHaveCount(7);
  for (const l of ['What the fire feels', '10 m', '50 m', '100 m', '300 m', '1 km', '2 km']) await expect(chips.getByRole('radio', { name: l, exact: true })).toHaveCount(1);
  await expect(chips.getByRole('radio').first()).toHaveAccessibleName('What the fire feels');
  await expect(chips.getByRole('radio', { name: 'What the fire feels', exact: true })).toBeChecked();
  expect((await layersOf(page)).windHeight).toBe('felt');
  const caption = panel.getByTestId('wind-glyph-caption');
  // What the fire feels is drawn from the picture's 60 m wind when the engine publishes it (the caption names it), and from the 10 m wind, with a line that says so, when it does not.
  const hasFelt = await page.evaluate(() => !!(window as unknown as { __firesim: { session: { state: { get(): { snapshot: { fireWind?: unknown } | null } } } } }).__firesim.session.state.get().snapshot?.fireWind);
  if (hasFelt) await expect(caption).toContainText(/^Wind the fire feels · \d+ m cells · air from \d\d:\d\d/);
  else await expect(caption).toContainText('The wind the fire feels is not in this picture, so the 10 m wind is shown.');
  // The 10 m chip is the wind the Wind speed map has always shown (and the caption's words are checked at it, as they were).
  await chips.getByRole('radio', { name: '10 m', exact: true }).check({ force: true });
  await expect.poll(async () => (await layersOf(page)).windHeight).toBe('fire');
  await expect(chips.getByRole('radio', { name: '10 m', exact: true })).toBeChecked();
  // The caption's words follow the air that is drawn: "as the model fits it to the terrain" is how the fast tier makes its wind, so the 3-D atmosphere does not say it.
  const diagnosed = await page.evaluate(() => (window as unknown as { __firesim: { session: { state: { get(): { snapshot: { atmosphere?: { kind?: string } } | null } } } } }).__firesim.session.state.get().snapshot?.atmosphere?.kind === 'diagnosed');
  await expect(caption).toContainText(diagnosed ? 'Wind about 10 m above open ground, as the model fits it to the terrain' : 'Wind about 10 m above open ground');
  if (!diagnosed) await expect(caption).not.toContainText('fits it to the terrain');
  await expect(caption.first()).toContainText(/ · model grid \d+ m · air from \d\d:\d\d\./); // the first line ends in a full stop
  await expect(caption).toContainText('On a calm night the fire can feel much less wind than this in places, and much more in others.');
  if (hasFelt) await expect(caption).toContainText('Choose What the fire feels to see it.');
  // Each chip sets the height, and the caption says which one.
  await chips.getByRole('radio', { name: 'What the fire feels', exact: true }).check({ force: true });
  await expect.poll(async () => (await layersOf(page)).windHeight).toBe('felt');
  await expect(caption).not.toContainText('Choose What the fire feels to see it.');
  for (const [label, h, words] of [
    ['50 m', 50, 'Wind at 50 m above the ground'],
    ['300 m', 300, 'Wind at 300 m above the ground'],
    ['1 km', 1000, 'Wind at 1 km above the ground'],
    ['2 km', 2000, 'Wind at 2 km above the ground'],
    ['100 m', 100, 'Wind at 100 m above the ground'],
  ] as const) {
    await chips.getByRole('radio', { name: label }).check({ force: true });
    await expect.poll(async () => (await layersOf(page)).windHeight, { message: label }).toBe(h);
    await expect(caption).toContainText(words);
    await expect(caption).not.toContainText('On a calm night');
  }
  const onNodes = await nodes();
  const onRow = await rowNodes();

  // ── The DOM budget (limit 1,000, as the plan measures it: the panel open, this row on, everything else as it starts) ──
  // Counted for the record as well: the air slice's box open, a heat map's legend and controls and the coded trees' legend shown. Those are built when first used
  // and take the panel past 1,000 without this row at all (the budget is the open panel's, as measured at 0.3.0: 940).
  await panel.getByTestId('cross-section').click();
  await expect(panel.getByTestId('slice-field')).toBeVisible();
  await panel.getByTestId('overlay-slope').click();
  await expect(panel.getByTestId('legend')).toHaveCount(1);
  await panel.getByTestId('canopy-style').getByRole('radio', { name: /^Coded/ }).check({ force: true });
  const fullNodes = await nodes();
  const line = `[layers] DOM nodes of the Layers panel: ${offNodes} open with the row off (the row is ${offRow}, so ${offNodes - offRow} without it), ${onNodes} with it on (the row is ${onRow}); ${fullNodes} with the air slice open, a heat map and the coded trees shown too`;
  console.log(line);
  test.info().annotations.push({ type: 'Layers panel DOM nodes', description: line });
  expect(onNodes, 'the open Layers panel with this row on stays within 1,000 DOM nodes').toBeLessThanOrEqual(1000);
  expect(onNodes - offNodes, 'the chips (seven), the map chip, the caption and the zoom line cost about 50 nodes, built once').toBeLessThan(80);
  await panel.getByTestId('overlay-slope').click();
  await panel.getByTestId('cross-section').click();

  // ── Remembered, and Reset puts it back ──
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('firesim.layers') ?? 'null'));
  expect(saved?.layers?.windGlyphs).toBe(true);
  expect(saved?.layers?.windHeight).toBe(100);
  await panel.getByTestId('layers-reset').click();
  await expect(sw.getByRole('switch')).not.toBeChecked();
  await expect(chips).toBeHidden();
  expect(await layersOf(page)).toMatchObject({ windGlyphs: false, windHeight: 'felt' });
  expect(await page.evaluate(() => localStorage.getItem('firesim.layers'))).toBeNull();
  expect((await session(page)).error).toBeNull();
  expect(errors).toEqual([]);
});

test('Arrows and flow lines: the choice comes back in the next run', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await buildKatoomba(page);
  await expect.poll(() => airPicture(page), { timeout: 90_000 }).toBe(true);
  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  await panel.getByTestId('layer-windGlyphs').click();
  await panel.getByTestId('wind-height').getByRole('radio', { name: '300 m' }).check({ force: true });
  await expect.poll(async () => (await layersOf(page)).windHeight).toBe(300);
  // A new run (the preferences stay in this browser profile).
  await page.goto('/?debug=1');
  if (await page.getByTestId('notice').isVisible()) await acceptNotice(page);
  await buildKatoomba(page);
  await expect.poll(() => layersOf(page).then((l) => [l.windGlyphs, l.windHeight])).toEqual([true, 300]);
  await page.getByTestId('layers-fab').click();
  await expect(page.getByTestId('layer-windGlyphs').getByRole('switch')).toBeChecked();
  await expect(page.getByTestId('wind-height').getByRole('radio', { name: '300 m' })).toBeChecked();
});

test('Arrows and flow lines on the real layer: the map legend, and the caption and the line about the zoom follow the camera', async ({ page }) => {
  test.setTimeout(480_000);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await buildKatoomba(page);
  expect(await hasGlyphLayer(page), 'the real 3-D view has the glyph layer (windGlyphStats)').toBe(true);
  await expect.poll(() => airPicture(page), { timeout: 90_000 }).toBe(true);
  type Stats = { level: 0 | 1 | 2 | 3 | 4; cellPx: number; cellM: number; idle: string | null; active: boolean };
  const statsOf = (): Promise<Stats> => page.evaluate(() => (window as unknown as { __firesim: { view: { windGlyphStats(): Stats } } }).__firesim.view.windGlyphStats());
  const lookAt = (d: number): Promise<void> =>
    page.evaluate((dist) => {
      const v = (window as unknown as { __firesim: { view: { lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void; renderNow(): void } } }).__firesim.view;
      v.lookAt(0, 0, dist, 200, 52, false);
      v.renderNow();
    }, d);

  // A fire to fly to (the View menu's "Fly to the fire" has nothing to do without one).
  await openMenu(page, 'tools');
  await page.getByTestId('tool-fire').click();
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();

  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  await panel.getByTestId('layer-windGlyphs').click();
  await panel.getByTestId('wind-height').getByRole('radio', { name: '100 m' }).check({ force: true });
  const caption = panel.getByTestId('wind-glyph-caption');
  const level = panel.getByTestId('wind-glyph-level');

  // The legend card names the wind and its height, in km/h (it comes after the heat map, the coded trees and the slice, and before the streaks).
  const legend = page.getByTestId('map-legend');
  await expect(legend).toContainText('Wind at 100 m');
  await expect(legend).toContainText(/km\/h/);
  await panel.getByTestId('wind-height').getByRole('radio', { name: '10 m', exact: true }).check({ force: true });
  await expect(legend).toContainText('Wind near the ground');

  // From far to close, the line about the zoom says what the layer reports, and the smooth-fit sentence comes once a model cell is wider than 60 px.
  const seen: number[] = [];
  for (const d of [16000, 9000, 5000, 2500, 1200, 600, 350]) {
    await lookAt(d);
    const st = await statsOf();
    seen.push(st.level);
    await expect(level, `at ${d} m (level ${st.level}, ${st.cellPx.toFixed(1)} px a cell)`).toHaveText(LEVEL_LINE[st.level], { timeout: 15_000 });
    if (st.cellPx > 61) await expect(caption).toContainText(SMOOTH_FIT_LINE);
    else if (st.cellPx < 59) await expect(caption).not.toContainText(SMOOTH_FIT_LINE);
  }
  expect(seen, 'the level never falls as the camera comes closer').toEqual([...seen].sort((a, b) => a - b));
  expect(seen[seen.length - 1]!, 'curved flow lines or longer close in').toBeGreaterThanOrEqual(3);

  // At eye level nothing is drawn, and the line says why and how to get back; the legend card for the arrows (something not drawn there) is not shown either.
  // (The Layers panel is open, so the card is covered whatever it holds: its text is what is read. The wind streaks, on by default, keep their own card.)
  const ARROWS_CARD = 'Wind near the ground';
  await expect(legend).toContainText(ARROWS_CARD);
  await pickViewMode(page, 'ground');
  await expect(level).toHaveText('Not drawn at eye level. Go back to the map view.', { timeout: 15_000 });
  await expect(legend, 'no card for arrows that are not drawn').not.toContainText(ARROWS_CARD);
  await pickViewMode(page, 'orbit');
  await expect(level).not.toHaveText('Not drawn at eye level. Go back to the map view.', { timeout: 15_000 });
  await expect(legend).toContainText(ARROWS_CARD);
  // "Fly to the fire" from eye level puts the camera back in the 3-D view: the arrows and their card come back with it.
  await pickViewMode(page, 'ground');
  await expect(legend).not.toContainText(ARROWS_CARD);
  await viewMenuAction(page, 'fly-fire');
  await expect(level).not.toHaveText('Not drawn at eye level. Go back to the map view.', { timeout: 15_000 });
  await expect(legend, 'the card is back once the camera is').toContainText(ARROWS_CARD);
  await openMenu(page, 'view');
  await expect(page.locator('.view-btn[data-mode="orbit"]'), 'the View menu says 3D view too').toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  // The farthest zoom on a short landscape phone: a model cell is under 4 px there, so "Zoom in to see the wind arrows." is a line a person can reach
  // (the unit test holds the arithmetic; this reads what the real layer says, once the view has taken the new size).
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(1000);
  const far = await page.evaluate(() => {
    const v = (window as unknown as { __firesim: { view: { rig: { controls: { maxDistance: number } }; lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void; renderNow(): void } } }).__firesim.view;
    const d = v.rig.controls.maxDistance;
    v.lookAt(0, 0, d, 200, 52, false);
    v.renderNow();
    return d;
  });
  await page.waitForTimeout(500);
  const canvasH = await page.evaluate(() => Math.round(document.querySelector('canvas')!.getBoundingClientRect().height));
  const st = await statsOf();
  expect(canvasH, 'the view has taken the landscape size').toBeLessThan(400);
  expect(st.level, `at the farthest zoom of 844x390 (${Math.round(far)} m out, a ${canvasH} px canvas, ${st.cellPx.toFixed(2)} px a cell of ${st.cellM} m) nothing is drawn: level 0`).toBe(0);
  await level.scrollIntoViewIfNeeded(); // (the caption reads the layer only while it is on screen)
  await expect(level).toHaveText(LEVEL_LINE[0], { timeout: 15_000 });
  await expect(level).toHaveText('Zoom in to see the wind arrows.');
  console.log(`[layers] 844x390 at the farthest zoom (${Math.round(far)} m out, a ${canvasH} px canvas): level ${st.level}, ${st.cellPx.toFixed(2)} px a cell of ${st.cellM} m`);
  test.info().annotations.push({ type: 'farthest zoom at 844x390', description: `level ${st.level}, ${st.cellPx.toFixed(2)} px a cell` });
});

test('2-D stand-in map: a remembered "on" says why nothing is drawn, can be turned off, and offers no Wind height chips', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('firesim.layers', JSON.stringify({ v: 1, layers: { windGlyphs: true, windHeight: 300 } })));
  await page.goto('/?mock=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  const sw = panel.getByTestId('layer-windGlyphs').getByRole('switch');
  await expect(sw).toBeChecked(); // remembered
  await expect(sw, 'an "on" switch stays operable, so it can always be turned off').toBeEnabled();
  await expect(panel.getByTestId('wind-glyph-reason')).toHaveText('Needs the 3-D view');
  await expect(panel.getByTestId('wind-height'), 'the 2-D map draws no glyphs, so there is no height to choose').toBeHidden();
  await panel.getByTestId('layer-windGlyphs').click();
  await expect(sw).not.toBeChecked();
  await expect(sw).toBeDisabled();
});

test('2-D stand-in map: the Arrows and flow lines switch cannot be used, and says why', async ({ page }) => {
  await page.goto('/?mock=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  await expect(panel.getByTestId('layer-windGlyphs').getByRole('switch')).toBeDisabled();
  await expect(panel.getByTestId('wind-glyph-reason')).toHaveText('Needs the 3-D view');
  await expect(panel.getByTestId('wind-height')).toHaveCount(0);
  await expect(panel.getByTestId('wind-layer')).toBeVisible(); // the rest of Wind and air is as it was
});
