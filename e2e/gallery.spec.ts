/**
 * The pictures of the new screens for README.md and docs/screenshots/ (they are the product of this spec, so a stale one is
 * easy to spot and to regenerate): the Data sets screen, "How this simulation works", the Layers panel, heat maps, roads /
 * homes / zones / names, the colour-coded trees, "Where you are", and the simulation in the three looks (light, night and
 * high contrast) and at Android's 200 % font scale. Real engine, the bundled Katoomba demo (offline), one build; the looks are
 * switched on <html> (the same attributes Settings sets). Pictures are 412 x 915 CSS pixels (Pixel 7), a few hundred kB each.
 *
 * Release 0.4.0 (Air slices) adds the two tests named "gallery 0.4.0" at the end (run alone with `-g "gallery 0.4.0"`): pictures 33,
 * 34, 34b and 35. It also made three existing pictures STALE, which stay as they were until the whole suite is run again:
 *   - docs/screenshots/05-cross-section.png (e2e/app.spec.ts): the curtain now takes its colours from the slice lattice, has six colour
 *     chips in the Layers panel and works on the fast model too;
 *   - docs/screenshots/09-menus-open.png (e2e/app.spec.ts) and docs/screenshots/design/app-sim-menus-*.png (scripts/app-screenshots.mjs):
 *     the Tools list has a seventh entry, Air slices.
 * They are not produced by the gallery tests below: regenerate them with `npx playwright test e2e/app.spec.ts` and
 * `node scripts/app-screenshots.mjs` (README.md says so next to each).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, animationsDone, openMenu, pickTool, pickViewMode, session, setSpeed, zoomView } from './helpers';

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

  // ── How this simulation works: the top, and the live summary ("Speed and memory right now") ──
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

  // ── Simulation debug statistics (the menu row directly under Settings): the top, with the Summary open ──
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-debug-stats').click();
  const stats = page.getByTestId('debug-stats');
  await expect(stats).toBeVisible();
  await stats.locator('.screen-main').evaluate((m) => (m.scrollTop = 0));
  await shot(page, '13b-debug-stats');
  await page.keyboard.press('Escape');
  await expect(stats).toHaveCount(0);

  // ── At Android's 200 % font scale ──
  await fontScale(page, 2);
  await shot(page, '25-font-scale-200', ['light']);
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-datasets').click();
  await expect(ds).toBeVisible();
  await shot(page, '25b-font-scale-200-datasets', ['light']);
});

// ───────────────────────────────────────── 0.3.0 ─────────────────────────────────────────
// The pictures of the 0.3.0 features, in three tests of their own (each is run alone with `-g "gallery 0.3.0"`): the speed
// sheet, Settings with Picture quality and Why here? with an icon row (a daytime run), the night look, Realistic and
// Daylight (a run that starts at night, so the clock on the screen and the light agree), and an escarpment close-up on
// the High picture tier (cliffs drawn as rock walls). Real engine, the bundled Katoomba demo, offline.

type W = {
  __firesim: {
    view: {
      flyTo(x: number, y: number, d: number): void;
      lookAt(x: number, y: number, distance: number, azimuthDeg?: number, tiltDeg?: number): void;
      projectToScreen(x: number, y: number): [number, number] | null;
      setNightLook?(look: string): void;
      renderNow?(): void;
    };
    session: { state: { get(): { ignitions: { points: [number, number][] }[] } }; debugForcePace(level: string | null): void };
  };
};

/** Setup to the sim: the bundled Katoomba, a weather preset, nothing from the network. */
async function buildKatoomba(page: Page, preset: string): Promise<void> {
  await page.goto('/?debug=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId(`preset-${preset}`).click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
}

/** Mark a fire on the escarpment at the crosshair, then close the tool; returns the fire's own spot. */
async function markEscarpmentFire(page: Page): Promise<[number, number]> {
  await pickTool(page, 'fire');
  await expect(page.getByTestId('fire-panel')).toBeVisible();
  await page.evaluate(() => (window as unknown as W).__firesim.view.flyTo(-2170, 900, 2500));
  await page.waitForTimeout(1500);
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  return page.evaluate(() => (window as unknown as W).__firesim.session.state.get().ignitions[0]!.points[0]!);
}

/** Play at a speed until the clock passes `untilS`, then pause: the engine has some minutes of fire behind it. */
async function playTo(page: Page, speed: number, untilS: number): Promise<void> {
  await setSpeed(page, speed);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 300_000 }).toBeGreaterThan(untilS);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(false);
}

/** The screen position of a ground point once the camera has settled (two reads 250 ms apart agree). */
async function settledAt(page: Page, x: number, y: number): Promise<[number, number]> {
  let last: [number, number] | null = null;
  let found: [number, number] | null = null;
  await expect
    .poll(
      async () => {
        const p = await page.evaluate(([px, py]) => (window as unknown as W).__firesim.view.projectToScreen(px!, py!), [x, y]);
        const ok = !!p && !!last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.5;
        if (ok) found = p;
        last = p;
        return ok;
      },
      { timeout: 20_000, intervals: [250] },
    )
    .toBe(true);
  return found!;
}

test('gallery 0.3.0: the speed sheet, Why here? with an icon row and Settings with Picture quality', async ({ page }) => {
  test.setTimeout(900_000);
  await buildKatoomba(page, 'hot-nw-sw-change');
  const ignition = await markEscarpmentFire(page);
  await playTo(page, 600, 900);

  // ── The speed sheet: the debug hook shows the signal (60x asked for; the sheet's own fixture is the reading), the real
  //    engine supplies where the time goes ──
  await setSpeed(page, 60);
  await page.evaluate(() => (window as unknown as W).__firesim.session.debugForcePace('waiting'));
  await page.getByTestId('pace-btn').click();
  await expect(page.getByTestId('pace-lead')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pace-time')).toBeVisible({ timeout: 30_000 });
  await animationsDone(page);
  await shot(page, '28-pace-sheet', ['light', 'dark']);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pace-sheet')).toBeHidden();
  await page.evaluate(() => (window as unknown as W).__firesim.session.debugForcePace(null));
  await expect(page.getByTestId('pace-btn')).toBeHidden();

  // ── Why here? with an icon row: tap the ignition pin (it stands above its tip, so its picture is half its height up) ──
  await page.evaluate(([x, y]) => (window as unknown as W).__firesim.view.flyTo(x!, y!, 2500), ignition);
  const tip = await settledAt(page, ignition[0], ignition[1]);
  await page.mouse.click(tip[0], tip[1] - 17);
  const why = page.getByTestId('why-panel');
  await expect(page.getByTestId('why-marker')).toContainText('Ignition point', { timeout: 30_000 });
  await expect(why.locator('.narrative li').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await shot(page, '29-why-here-icon', ['light']);
  await why.getByRole('button', { name: 'Close' }).click();

  // ── Settings: Performance and Picture quality, with their hints ──
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await scrollTo(page, '#settings-simulation');
  await expect(page.getByTestId('picture-quality')).toBeVisible();
  await shot(page, '30-settings-picture-quality', ['light', 'dark']);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings')).toHaveCount(0);
});

test('gallery 0.3.0: the night look, Realistic and Daylight, on a run that starts at night', async ({ page }) => {
  test.setTimeout(900_000);
  await buildKatoomba(page, 'calm-night-katabatic');
  const ignition = await markEscarpmentFire(page);
  await playTo(page, 600, 5400); // an hour and a half of fire: the glow is wider than its pin
  // Close enough to see the glow and low enough to show a strip of sky: what changes is the ground; the sky and the fire stay as they were.
  await page.evaluate(([x, y]) => (window as unknown as W).__firesim.view.lookAt(x!, y!, 2000, 200, 68), ignition);
  await page.waitForTimeout(1500);
  const look = async (l: 'realistic' | 'daylight'): Promise<void> => {
    await page.evaluate((v) => {
      const view = (window as unknown as W).__firesim.view;
      view.setNightLook?.(v);
      view.renderNow?.();
    }, l);
    await page.waitForTimeout(800);
  };
  await look('realistic');
  await shot(page, '31-night-realistic', ['light']);
  await look('daylight');
  await shot(page, '31b-night-daylight', ['light']);
});

test('gallery 0.3.0: an escarpment close-up, the cliffs drawn as rock walls on the High picture tier', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/?debug=1&theme=light');
  await acceptNotice(page);
  // Picture quality High, chosen in Settings (it applies to the model built next), so the picture has all six kinds of rock detail.
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('picture-quality').getByRole('radio', { name: 'High' }).check();
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('settings')).toHaveCount(0);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  // The tallest sheer face of Katoomba's escarpment (spike S5; e2e/cliffs.spec.ts frames it the same way): orbit from the valley side,
  // 25 degrees off the face's fall line, 650 m from its foot, no wind streaks. No fire: the picture is of the ground.
  const face = { x: 2505, y: -1995, down: 181 };
  const foot = { x: face.x + 60 * Math.sin((face.down * Math.PI) / 180), y: face.y + 60 * Math.cos((face.down * Math.PI) / 180) };
  await setLayers(page, { wind: 'off' });
  await page.evaluate(([x, y, az]) => (window as unknown as W).__firesim.view.lookAt(x!, y!, 650, az, 62), [foot.x, foot.y, (face.down + 25) % 360]);
  await page.waitForTimeout(2500); // the canopy is placed a frame at a time
  await shot(page, '32-escarpment-cliffs', ['light']);
});

// ───────────────────────────────────────── 0.4.0 ─────────────────────────────────────────
// The pictures of Air slices (README.md): the tool placing the start of a line (33), the side view on the 3-D atmosphere with the
// probe (34), the side view on the fast model, where the air is the diagnosed wind and Temp and Smoke are off with their reason
// (34b), and the 3-D curtain with the Layers panel's colour chips (35). Real engine, the bundled Katoomba demo at 6 km (the model
// grid then reads 133 m), offline. Written for the 0.4.0 release and NOT RUN when it was written: the selectors are those of
// e2e/air-tool.spec.ts, e2e/airslice-panel.spec.ts and e2e/layers.spec.ts, which are run.

/** Setup to the sim at 6 km, with the Detail choice named: 'Fast' pins the fast model, 'Normal' leaves Auto (the 3-D air on this machine). */
async function buildKatoomba6km(page: Page, preset: string, detail: 'Fast' | 'Normal'): Promise<void> {
  await page.goto('/?debug=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('detail').getByRole('radio', { name: new RegExp(`^${detail}`) }).check({ force: true });
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId(`preset-${preset}`).click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
}

/** The kind of the air in the picture the scene shows now ('prognostic' or 'diagnosed'), once it has one. */
const airKindOf = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    type S = { snapshot: { atmosphere?: { kind?: string; nz: number } } | null };
    const a = (window as unknown as { __firesim: { session: { state: { get(): S } } } }).__firesim.session.state.get().snapshot?.atmosphere;
    return a ? (a.kind ?? (a.nz > 0 ? 'prognostic' : 'surface')) : null;
  });

/** Open the Air slices tool, put the line "Along the wind" with one tap on its preset, and wait for the panel to draw it. */
async function alongTheWind(page: Page): Promise<void> {
  await openMenu(page, 'tools');
  await page.getByTestId('tool-air').click();
  await expect(page.getByTestId('air-panel')).toBeVisible();
  await page.getByTestId('slice-presets-toggle').click();
  await page.getByTestId('slice-preset-along').click();
  const canvas = page.getByTestId('slice-canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(canvas).not.toHaveAttribute('data-seq', '', { timeout: 30_000 });
  await page.waitForTimeout(2500); // the streaks need a moment to draw their tails
}

test('gallery 0.4.0: the Air slices tool placing a line, the side view with the probe on the 3-D atmosphere, and the curtain with its colour chips', async ({ page }) => {
  test.setTimeout(900_000);
  await buildKatoomba6km(page, 'hot-nw-sw-change', 'Normal');
  // Auto keeps the 3-D air unless this machine is far too slow for it: switch the run over if it chose the fast model.
  await expect.poll(() => airKindOf(page), { timeout: 60_000 }).not.toBeNull();
  if ((await airKindOf(page)) !== 'prognostic') {
    await page.evaluate(() => (window as unknown as { __firesim: { session: { controller: { setQuality(t: string): void } } } }).__firesim.session.controller.setQuality('standard'));
    await expect.poll(() => airKindOf(page), { timeout: 240_000 }).toBe('prognostic');
  }
  const ignition = await markEscarpmentFire(page);
  await playTo(page, 600, 900);

  // ── 33: the tool placing the start of a line: the cross over the map, "Place A here" and Cancel ──
  await page.evaluate(([x, y]) => (window as unknown as W).__firesim.view.lookAt(x!, y!, 3000, 200, 58), ignition);
  await page.waitForTimeout(1500);
  await openMenu(page, 'tools');
  await page.getByTestId('tool-air').click();
  await expect(page.getByTestId('air-panel')).toBeVisible();
  await page.getByTestId('slice-set-a').click();
  await expect(page.locator('.sim-screen .crosshair')).toBeVisible();
  await expect(page.getByTestId('slice-place')).toHaveText('Place A here');
  await page.waitForTimeout(800);
  await shot(page, '33-air-slices-placing', ['light', 'dark']);
  await page.getByTestId('slice-cancel').click();
  await expect(page.locator('.sim-screen .crosshair')).toBeHidden();
  await page.getByTestId('air-close').click();
  await expect(page.getByTestId('air-panel')).toHaveCount(0);

  // ── 34: the side view of a line along the wind, with a probe reading ──
  await alongTheWind(page);
  const canvas = page.getByTestId('slice-canvas');
  await expect(page.getByTestId('slice-footer')).toContainText('3-D time-stepped air');
  await expect(page.getByTestId('slice-footer')).toContainText(/air from \d\d:\d\d/);
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.3);
  await expect(page.getByTestId('slice-readout')).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  await shot(page, '34-air-slice-side-view', ['light', 'dark']);
  await page.getByTestId('air-close').click();
  await expect(page.getByTestId('air-panel')).toHaveCount(0);

  // ── 35: the curtain in the 3-D view, seen from the side, coloured by Up/down, with the Layers panel's chips ──
  await pickTool(page, 'layers');
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  await page.getByTestId('cs-view').scrollIntoViewIfNeeded();
  await page.getByTestId('cs-view').click();
  await page.getByTestId('slice-field-up').click();
  await page.waitForTimeout(3000); // the camera flies side-on and the curtain is redrawn with the new colours
  await page.getByTestId('slice-field').scrollIntoViewIfNeeded();
  await shot(page, '35-air-slice-curtain-chips', ['light', 'dark']);
});

test('gallery 0.4.0: the side view on the fast model, the diagnosed wind, with Temp and Smoke off and the reason', async ({ page }) => {
  test.setTimeout(900_000);
  await buildKatoomba6km(page, 'hot-nw-sw-change', 'Fast');
  await expect.poll(() => airKindOf(page), { timeout: 60_000 }).toBe('diagnosed');
  await markEscarpmentFire(page);
  await playTo(page, 600, 900);
  await alongTheWind(page);
  const footer = page.getByTestId('slice-footer');
  await expect(footer).toContainText('Diagnosed wind');
  await expect(footer).toContainText('terrain effects only');
  for (const id of ['theta', 'smoke']) await expect(page.getByTestId(`slice-chip-${id}`)).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('slice-use3d')).toHaveText('Use the 3-D atmosphere');
  // The panel scrolls inside the tool: bring the reasons and the button into view (the footer stays pinned at the bottom).
  await page.getByTestId('slice-use3d').scrollIntoViewIfNeeded();
  await shot(page, '34b-air-slice-diagnosed', ['light', 'dark']);
});
