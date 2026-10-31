/**
 * The pictures of release 0.7.0 for README.md and docs/screenshots/ (42 and up; 34b, 35, 38, 39, 40 and 41 are the older pictures that 0.7.0 changed, redone
 * under their own names). Real engine, the bundled Katoomba demo at 6 km (offline), a Pixel 7 profile at a device scale of 2. Run alone with
 * `-g "gallery 0.7.0"`; they write only these pictures. Light unless a picture says otherwise.
 *
 *   speed test        48   the debug statistics' "What this phone can do" after a press of "Run the speed test" (light and dark)
 *   the 60 m wind     42   the arrows and flow lines at What the fire feels (the default Wind height), top view, one model cell about 50 px
 *   colour by speed   43   the same view with "Colour the map by speed" on: the Wind speed map under the arrows, and the map's legend card
 *                     44   the Layers row: the switch, the seven Wind height chips, the "Colour the map by speed" chip pressed, the caption (light and dark)
 *   the streaks       38   level 4 over the forest at about 870 m (the old picture of long flow lines, redone: they are the detailed streaks now)
 *                     46   the closest zoom over forest, High picture quality: the streaks ride the tree tops and part round the crowns
 *                     45   the Wind detail sheet at level 4
 *                     47   the same sheet after a few seconds without a touch: "The streaks paused to save battery"
 *   Wind direction    49   the panel after Apply: the change in the list and "Back to the forecast" under it (light and dark)
 *                     50   the Insights list with the card of the change of your own (Watch out)
 *   Air slices        34b  the side view on the fast model, with the 3-D button under the chips (light and dark)
 *                     35   the 3-D curtain in the scene, with the Layers panel's chips (the fast model)
 *                     39   the Layers row of the arrows (seven chips)
 *                     40   the Map view tab, 41 Turn off the slice
 *   the 3-D tier      34   the side view with the probe on the 3-D atmosphere (light and dark), 35 the curtain coloured by Up/down (light and dark)
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, animationsDone, openMenu, pickTool, pickViewMode, session, setSpeed } from './helpers';

test.use({ deviceScaleFactor: 2, actionTimeout: 45_000 });

const SHOTS = 'docs/screenshots';
type Look = 'light' | 'dark';
const suffix = (l: Look): string => (l === 'light' ? '' : `-${l}`);

async function setLook(page: Page, look: Look): Promise<void> {
  await page.evaluate((l) => {
    const r = document.documentElement;
    r.dataset.theme = l === 'dark' ? 'dark' : 'light';
    delete r.dataset.contrast;
  }, look);
  await page.waitForTimeout(200);
}

/** One picture per look (the light one by default), in CSS pixels. */
async function shot(page: Page, name: string, looks: Look[] = ['light']): Promise<void> {
  for (const l of looks) {
    await setLook(page, l);
    await animationsDone(page);
    await page.screenshot({ path: `${SHOTS}/${name}${suffix(l)}.png`, scale: 'css' });
  }
  await setLook(page, 'light');
}

type View = {
  setLayers(p: Record<string, unknown>): void;
  lookAt(x: number, y: number, distance: number, azimuthDeg?: number, tiltDeg?: number, animate?: boolean): void;
  flyTo(x: number, y: number, d: number): void;
  renderNow?(): void;
  windGlyphStats?(): { active: boolean; level: number; count: number; cellPx: number; cellM: number; detail: string; idle: string | null } | null;
  rig: { update(now: number): boolean };
  activity: { setLimit(ms: number): void };
};
type Handle = {
  __firesim: {
    view: View;
    session: {
      state: { get(): { ignitions: { points: [number, number][] }[]; snapshot: { atmosphere?: { kind?: string; nz: number } } | null } };
      visibleInsights(): { key?: string; kind: string }[];
      controller: { setQuality(t: string): void };
    };
  };
};
const setLayers = (page: Page, patch: Record<string, unknown>): Promise<void> =>
  page.evaluate((p) => {
    const v = (window as unknown as Handle).__firesim.view;
    v.setLayers(p);
    v.renderNow?.();
  }, patch);
const airKindOf = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const a = (window as unknown as Handle).__firesim.session.state.get().snapshot?.atmosphere;
    return a ? (a.kind ?? (a.nz > 0 ? 'prognostic' : 'surface')) : null;
  });

/** Setup to the sim at 6 km on a tier, with the picture quality `High` where the trees matter (Settings, which applies to the model built next). */
async function build(page: Page, detail: 'Fast' | 'Normal', quality: 'High' | null = null): Promise<void> {
  await page.goto('/?debug=1&theme=light');
  await acceptNotice(page);
  if (quality) {
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('settings')).toBeVisible();
    await page.getByTestId('picture-quality').getByRole('radio', { name: quality }).check();
    await page.getByTestId('close-settings').click();
    await expect(page.getByTestId('settings')).toHaveCount(0);
  }
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('detail').getByRole('radio', { name: new RegExp(`^${detail}`) }).check({ force: true });
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await expect.poll(() => airKindOf(page), { timeout: 90_000 }).not.toBeNull();
}

async function markEscarpmentFire(page: Page): Promise<[number, number]> {
  await pickTool(page, 'fire');
  await expect(page.getByTestId('fire-panel')).toBeVisible();
  await page.evaluate(() => (window as unknown as Handle).__firesim.view.flyTo(-2170, 900, 2500));
  await page.waitForTimeout(1500);
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  return page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().ignitions[0]!.points[0]!);
}

async function playTo(page: Page, speed: number, untilS: number): Promise<void> {
  await setSpeed(page, speed);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 300_000 }).toBeGreaterThan(untilS);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(false);
}

/** Let the camera come to rest (the rig's per-frame update, run many times without drawing), then draw a frame with the glyph rebuild finished in it. */
async function draw(page: Page): Promise<NonNullable<ReturnType<NonNullable<View['windGlyphStats']>>>> {
  await page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    const t0 = performance.now() + 4000;
    for (let i = 0; i < 100; i++) v.rig.update(t0 + i * 16);
  });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.renderNow?.();
    return v.windGlyphStats!()!;
  });
}
const look = (page: Page, x: number, y: number, d: number, tilt: number, az: number): Promise<void> =>
  page.evaluate(([px, py, pd, pt, pa]) => (window as unknown as Handle).__firesim.view.lookAt(px!, py!, pd!, pa!, pt!, false), [x, y, d, tilt, az]);

/** The camera distance at which one model cell covers `px` screen pixels (the rig's field of view is 50 degrees). */
async function distanceForCell(page: Page, px: number): Promise<number> {
  const s = (await draw(page))!;
  const h = await page.evaluate(() => document.querySelector('canvas')!.clientHeight);
  return (s.cellM * h) / (2 * Math.tan((25 * Math.PI) / 180) * px);
}

/** Open the Layers panel with the arrows on (the Wind streaks off, so the picture of the arrows stands alone) and the Wind height as it is. */
async function arrowsOn(page: Page): Promise<void> {
  await pickTool(page, 'layers');
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  await page.getByTestId('wind-layer').getByRole('radio', { name: 'Off' }).check({ force: true });
  await page.getByTestId('layer-windGlyphs').click();
  await expect(page.getByTestId('wind-height')).toBeVisible();
}
const closePanel = async (page: Page): Promise<void> => {
  await page.getByTestId('layers-panel').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('layers-panel')).toHaveCount(0);
};

// The escarpment's edge and the Megalong valley, both on the screen (the 0.5.0 pictures use the same centre).
const CENTRE: [number, number] = [-600, 300];

// ── The speed test ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('gallery 0.7.0: the speed test in the debug statistics', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?debug=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  const open = page.getByTestId('setup-debug-stats');
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await expect(page.getByTestId('debug-stats')).toBeVisible();
  const toggle = page.getByTestId('debug-group-canDo');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const button = page.getByTestId('speed-test');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.getByTestId('speed-test-status')).toContainText('Done', { timeout: 60_000 });
  await expect(button).toBeEnabled();
  // The row is above the button: put the button at the bottom of the window so that the result and the status line are both on the screen.
  await button.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await page.waitForTimeout(400);
  await shot(page, '48-speed-test', ['light', 'dark']);
});

// ── The wind the fire feels, Colour the map by speed, the Layers row, and the older pictures that they changed ──────────────────────────────────────────────
test('gallery 0.7.0: the wind the fire feels, Colour the map by speed and the Layers row', async ({ page }) => {
  test.setTimeout(900_000);
  await build(page, 'Fast');
  expect(await airKindOf(page)).toBe('diagnosed');
  await markEscarpmentFire(page);
  await playTo(page, 600, 900);
  await arrowsOn(page);
  // The default Wind height is What the fire feels: the first chip, already chosen.
  await expect(page.getByTestId('wind-height').getByRole('radio', { name: 'What the fire feels', exact: true })).toBeChecked();
  await closePanel(page);
  await pickViewMode(page, 'top');
  await look(page, CENTRE[0], CENTRE[1], 1000, 0, 0);
  await draw(page);
  await look(page, CENTRE[0], CENTRE[1], await distanceForCell(page, 50), 0, 0);
  const mid = await draw(page);
  expect(mid).toMatchObject({ active: true, level: 3 });
  await page.waitForTimeout(600);
  await shot(page, '42-wind-felt-flow-lines');

  // Colour the map by speed: the chip under the height chips (a fire is marked, so it is on offer); the legend card is the map's.
  await pickTool(page, 'layers');
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();
  const chip = panel.getByTestId('wind-map-chip');
  await expect(chip).toBeEnabled();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('map-legend')).toContainText('Wind speed the fire feels');
  await page.getByTestId('layer-windGlyphs').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(600);
  await shot(page, '44-layers-colour-by-speed', ['light', 'dark']);
  await closePanel(page);
  await draw(page);
  await page.waitForTimeout(600);
  await shot(page, '43-wind-colour-by-speed');

  // The Layers row at 0.5.0's own picture (39), with the seven chips: the map is turned off again, so the row is the arrows' row.
  await pickTool(page, 'layers');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('wind-glyph-level')).toBeVisible();
  await page.getByTestId('layer-windGlyphs').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(500);
  await shot(page, '39-layers-wind-arrows');
  await closePanel(page);
});

// ── Wind direction: a change of your own, its card, Back to the forecast ──────────────────────────────────────────────────────────────────────────────────
test('gallery 0.7.0: Wind direction with a change of your own, its card and Back to the forecast', async ({ page }) => {
  test.setTimeout(900_000);
  await build(page, 'Fast');
  expect(await airKindOf(page)).toBe('diagnosed');
  await markEscarpmentFire(page);
  await playTo(page, 600, 900);
  await look(page, CENTRE[0], CENTRE[1], 2200, 40, 200);
  await draw(page);

  await pickTool(page, 'wind');
  const panel = page.getByTestId('wind-panel');
  await expect(panel).toBeVisible();
  await page.getByTestId('wind-dial').focus();
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp'); // a quarter turn from where the wind is: well over the 45 degrees a card needs
  await page.getByTestId('wind-when').getByRole('radio', { name: 'In 30 min' }).check();
  await page.getByTestId('apply-wind').click();
  await expect(page.getByTestId('wind-list').locator('li')).toHaveCount(1);
  const back = page.getByTestId('wind-back-to-forecast');
  await expect(back).toBeVisible();
  await back.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, '49-wind-direction-change', ['light', 'dark']);

  // Play on past the start of the turn: the engine raises the card of the change (Watch out, never Danger) and the timeline marks it.
  await panel.getByRole('button', { name: 'Close tool' }).click();
  await expect(panel).toBeHidden();
  await setSpeed(page, 600);
  await page.getByTestId('play').click();
  await expect
    .poll(async () => (await page.evaluate(() => (window as unknown as Handle).__firesim.session.visibleInsights().map((i) => i.key ?? ''))).some((k) => k.includes('wind-change:user:')), {
      timeout: 300_000,
      intervals: [500],
    })
    .toBe(true);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  await page.getByTestId('tab-insights').click();
  const card = page.locator('[data-testid=insight-card][data-kind=wind-change]', { hasText: 'Your wind change' });
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-severity', 'watch');
  // The list is a short window over the map (a peek sheet): scroll its own scroller so that the card is the first thing in it, with its "Watch out" line.
  await card.evaluate((el) => {
    let p = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
    if (p) p.scrollTop += el.getBoundingClientRect().top - p.getBoundingClientRect().top - 6;
  });
  await page.waitForTimeout(600);
  await shot(page, '50-wind-change-card');
});

// ── The detailed streaks: the relief, the sheet and the pause (High picture quality, the trees drawn) ───────────────────────────────────────────────────────
test('gallery 0.7.0: the detailed streaks round the crowns, the Wind detail sheet and the pause', async ({ page }) => {
  test.setTimeout(900_000);
  await build(page, 'Fast', 'High');
  expect(await airKindOf(page)).toBe('diagnosed');
  await arrowsOn(page);
  await closePanel(page);
  await setLayers(page, { vegetation: true, understorey: true, imagery: true });
  await pickViewMode(page, 'orbit');

  // 38: level 4 over the forest at the old picture's framing (one model cell about 150 px, 55 degrees): the detailed streaks.
  await look(page, CENTRE[0], CENTRE[1], 1000, 55, 200);
  await draw(page);
  const far = await distanceForCell(page, 150);
  await look(page, CENTRE[0], CENTRE[1], far, 55, 200);
  await page.waitForTimeout(3000); // the canopy is placed a frame at a time
  const l4 = await draw(page);
  expect(l4).toMatchObject({ active: true, level: 4 });
  await page.waitForTimeout(1500);
  await shot(page, '38-wind-flow-lines-trees');

  // 46 (PROVISIONAL: the way a line bends round a crown was being changed again when this was taken): the closest zoom over forest, 150 m out at 55 degrees.
  // The relief is on only while the trees are drawn and a 5 m crown is 8 px across (about 600 m).
  await look(page, CENTRE[0], CENTRE[1], 150, 55, 200);
  await page.waitForTimeout(3000);
  const close = await draw(page);
  expect(close.level).toBe(4);
  await page.waitForTimeout(1200);
  await shot(page, '46-wind-streaks-round-crowns');

  // 45: the Wind detail sheet at level 4 (a tap on the chip).
  await page.getByTestId('wind-detail').click();
  const sheet = page.getByTestId('wind-detail-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('detailed streaks');
  await expect(sheet).not.toContainText('paused');
  await page.waitForTimeout(500);
  await shot(page, '45-wind-detail-sheet');

  // 47: the same sheet after a few seconds without a touch (the limit is 3 s from here; the shared fixture sets it to never). A pointer move wakes the
  // view and starts the count; the sheet repaints in place, and the picture is taken when it says so.
  await page.evaluate(() => (window as unknown as Handle).__firesim.view.activity.setLimit(3000));
  await page.mouse.move(200, 250);
  await expect(sheet).toContainText('paused to save battery', { timeout: 30_000 });
  await shot(page, '47-wind-streaks-paused');
});

// ── Air slices on the fast model: the 3-D button under the chips, the side view, the curtain, the Map view tab ───────────────────────────────────────────────
type Rec = { count: number; from: number | null; to: number | null };
const recOf = (page: Page): Promise<Rec | null> =>
  page.evaluate(() => {
    const v = (window as unknown as { __firesim: { view: { sliceRecording?: { status(): Rec } } } }).__firesim.view;
    return v.sliceRecording ? v.sliceRecording.status() : null;
  });

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

test('gallery 0.7.0: Air slices on the fast model, the 3-D button under the chips, the curtain, the Map view tab and Turn off the slice', async ({ page }) => {
  test.setTimeout(900_000);
  await build(page, 'Fast');
  expect(await airKindOf(page)).toBe('diagnosed');
  await markEscarpmentFire(page);
  await playTo(page, 600, 900);
  await setLayers(page, { wind: 'off' });
  await alongTheWind(page);
  const footer = page.getByTestId('slice-footer');
  await expect(footer).toContainText('Diagnosed wind');
  const use3d = page.getByTestId('slice-use3d');
  await expect(use3d).toHaveText('Use the 3-D atmosphere');
  // The button is directly under the chips (0.7.0): chips, then the button, then the controls.
  const chipsBox = (await page.locator('.slice-panel .slice-chips').boundingBox())!;
  const buttonBox = (await use3d.boundingBox())!;
  expect(buttonBox.y).toBeGreaterThan(chipsBox.y + chipsBox.height - 1);
  await page.getByTestId('slice-canvas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, '34b-air-slice-diagnosed', ['light', 'dark']);

  // A preset, kept where it is now, so the recorder has a line to record; play on until it holds pictures, then pause.
  await page.getByTestId('slice-keep').click();
  await expect(page.getByTestId('slice-keep')).toBeHidden();
  await setSpeed(page, 120);
  await page.getByTestId('play').click();
  await expect
    .poll(
      async () => {
        const st = await recOf(page);
        return !!st && st.count >= 6 && st.to! - st.from! >= 400;
      },
      { timeout: 400_000, intervals: [500] },
    )
    .toBe(true);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(false);

  // 40: the Map view tab with the arrows on, from above, and the button under them; 41: back on the side view, scrolled to Turn off the slice.
  await page.getByTestId('slice-tab-map').click();
  await expect(page.getByTestId('slice-map-tab')).toBeVisible();
  await page.getByTestId('layer-windGlyphs').click();
  await expect(page.getByTestId('wind-height')).toBeVisible();
  await pickViewMode(page, 'top');
  const mapZoom = await distanceForCell(page, 40);
  await look(page, CENTRE[0], CENTRE[1], mapZoom, 0, 0);
  await expect(page.getByTestId('slice-off')).toBeVisible();
  await expect(page.getByTestId('slice-off-note')).toHaveText('This also clears the recording.');
  await draw(page);
  await page.getByTestId('slice-map-tab').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(600);
  await shot(page, '40-air-slice-map-view');
  await page.getByTestId('slice-tab-side').click();
  await expect(page.getByTestId('slice-canvas')).toBeVisible();
  const off = page.getByTestId('slice-off');
  await expect(page.getByTestId('slice-off-note')).toBeVisible();
  await off.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(600);
  await shot(page, '41-air-slice-turn-off');

  // 35: the 3-D curtain in the scene, seen from the side, with the Layers panel's chips (the fast model colours it by what it has).
  await page.getByTestId('air-close').click();
  await expect(page.getByTestId('air-panel')).toHaveCount(0);
  await pickTool(page, 'layers');
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  await page.getByTestId('cs-view').scrollIntoViewIfNeeded();
  await page.getByTestId('cs-view').click();
  await page.waitForTimeout(3000); // the camera flies side-on and the curtain is redrawn
  await page.getByTestId('slice-field').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, '35-air-slice-curtain-chips-fast');
});

// ── Air slices on the 3-D tier: the side view with the probe, and the curtain coloured by Up/down ───────────────────────────────────────────────────────
test('gallery 0.7.0: the side view with the probe and the curtain on the 3-D atmosphere', async ({ page }) => {
  test.setTimeout(1_500_000);
  await build(page, 'Normal');
  if ((await airKindOf(page)) !== 'prognostic') {
    await page.evaluate(() => (window as unknown as Handle).__firesim.session.controller.setQuality('standard'));
    await expect.poll(() => airKindOf(page), { timeout: 300_000 }).toBe('prognostic');
  }
  const ignition = await markEscarpmentFire(page);
  await playTo(page, 600, 900);
  await look(page, ignition[0], ignition[1], 3000, 58, 200);
  await page.waitForTimeout(1500);
  await alongTheWind(page);
  const canvas = page.getByTestId('slice-canvas');
  await expect(page.getByTestId('slice-footer')).toContainText('3-D time-stepped air');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.3);
  await expect(page.getByTestId('slice-readout')).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  await shot(page, '34-air-slice-side-view', ['light', 'dark']);
  await page.getByTestId('air-close').click();
  await expect(page.getByTestId('air-panel')).toHaveCount(0);
  await pickTool(page, 'layers');
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  await page.getByTestId('cs-view').scrollIntoViewIfNeeded();
  await page.getByTestId('cs-view').click();
  await page.getByTestId('slice-field-up').click();
  await page.waitForTimeout(3000);
  await page.getByTestId('slice-field').scrollIntoViewIfNeeded();
  await shot(page, '35-air-slice-curtain-chips', ['light', 'dark']);
});
