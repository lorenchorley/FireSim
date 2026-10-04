/**
 * The seams between the screens of the app (the integration of the screens phase): every way into the Data sets screen and
 * "How this simulation works", the Back order (Android hardware Back = history back), focus returning to the control that
 * opened a screen, the stage being inert behind a full-screen screen, the earlier reviewers' follow-ups (the weather chip is
 * not a button, Tab never leaves Settings for the map, Play carries no aria-pressed, backgrounding cancels a fast-forward),
 * the high-contrast switch, Android's 200 % font scale, a deletion that always asks first, and a whole run in which every
 * screen is visited while nothing pops up and nothing pauses the run. Mock engine (?mock=1) unless a test says otherwise.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { formatBytes, type DatasetRecord, type DatasetSummary } from '../src/core/datasets';
import { LAYER_CATALOG } from '../src/render/layerCatalog';
import {
  acceptNotice,
  armPopupWatch,
  expectStillPlaying,
  openMenu,
  pickTool,
  popups,
  scenarioDuration,
  session,
  setSpeed,
  watchPopups,
} from './helpers';

// ───────────── plumbing ─────────────

async function buildMock(page: Page, query = ''): Promise<void> {
  await page.goto(`/?mock=1&debug=1&theme=light${query}`);
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
}

async function buildKatoomba(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
}

/** Mark a fire at the crosshair and close the tool (the gloved-hand path). */
async function markFire(page: Page): Promise<void> {
  await pickTool(page, 'fire');
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await expect(page.getByTestId('fire-panel')).toHaveCount(0);
}

/** `inert` of the app's stage (the screens are siblings of it: the stage goes inert while a full-screen screen is on top). */
const stageInert = (page: Page): Promise<boolean> => page.evaluate(() => !!(document.querySelector('.stage') as (HTMLElement & { inert?: boolean }) | null)?.inert);

const BAD = /\b(undefined|NaN|Infinity|\[object)\b/;

/** Android's font scale at `k` (system text zoom scales text, not layout): every font-size and line-height token times k. */
async function fontScale(page: Page, k: number): Promise<void> {
  await page.evaluate((scale) => {
    document.getElementById('font-scale')?.remove(); // measure the normal sizes, so a second call does not compound the first
    const cs = getComputedStyle(document.documentElement);
    const decl: string[] = [];
    for (const n of ['xs', 'sm', 'md', 'lg', 'xl', '2xl']) decl.push(`--fs-${n}: ${parseFloat(cs.getPropertyValue(`--fs-${n}`)) * scale}px !important`);
    for (const n of ['xs', 'sm', 'md', 'lg', 'xl']) {
      const v = parseFloat(cs.getPropertyValue(`--lh-${n}`));
      if (Number.isFinite(v)) decl.push(`--lh-${n}: ${v * scale}px !important`);
    }
    const st = document.createElement('style');
    st.id = 'font-scale';
    st.textContent = `:root { ${decl.join('; ')} }`;
    document.head.append(st);
  }, k);
  await page.waitForTimeout(150);
}

/**
 * Layout damage on the screen as it is now: the page scrolling sideways, a visible element sticking out of the viewport
 * (unless it sits in something that scrolls sideways by design), or a button whose label is cut off inside it.
 */
async function layoutDamage(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const H = document.documentElement.clientHeight;
    const bad: string[] = [];
    const name = (e: Element): string => `<${e.tagName.toLowerCase()} class="${(e as HTMLElement).className}" testid="${e.getAttribute('data-testid') ?? ''}"> ${(e.textContent ?? '').trim().slice(0, 40)}`;
    if (document.documentElement.scrollWidth > W + 1) bad.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${W}`);
    const scrollsSideways = (el: Element): boolean => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') {
          const r = p.getBoundingClientRect();
          if (r.left >= -1 && r.right <= W + 1) return true;
        }
      }
      return false;
    };
    const scrollsDown = (el: Element): boolean => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowY;
        if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[inert], [hidden], svg, .sr-only, canvas')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if ((r.right > W + 1 || r.left < -1) && !scrollsSideways(el)) bad.push(`sticks out (${Math.round(r.left)}..${Math.round(r.right)} of ${W}): ${name(el)}`);
      // A control must be reachable: on the screen, or inside something that scrolls up and down.
      if ((el.matches('button, a[href], input, select, textarea, summary, [role=button], [role=radio], [role=switch], [role=tab], [role=menuitem]') && (r.bottom > H + 1 || r.top < -1)) && !scrollsDown(el)) bad.push(`control cannot be reached (${Math.round(r.top)}..${Math.round(r.bottom)} of ${H}): ${name(el)}`);
      if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 2 && cs.overflowY !== 'visible') bad.push(`label cut off: ${name(el)}`);
    }
    return bad.slice(0, 12);
  });
}

// ───────────── entry points, Back order, focus, inert ─────────────

test('every way into Data sets and How this simulation works, in Setup and in the run; Back closes the top-most thing first; focus returns; the stage is inert behind a screen', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?mock=1&debug=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  const datasets = page.getByTestId('datasets-screen');
  const card = page.getByTestId('model-card');

  // ── Setup: "All data sets" opens the screen (the stage behind it is inert), Close returns focus to the row ──
  const all = page.getByTestId('open-datasets');
  await all.click();
  await expect(datasets).toBeVisible();
  expect(await stageInert(page)).toBe(true);
  await page.getByTestId('datasets-close').click();
  await expect(datasets).toHaveCount(0);
  expect(await stageInert(page)).toBe(false);
  await expect(all).toBeFocused();

  // ── Setup: a row of "Data for this run" opens that data set's page of the PLANNED data; Escape: page → list → closed ──
  const plan = page.getByTestId('plan-terrain');
  await plan.scrollIntoViewIfNeeded();
  await plan.click();
  await expect(datasets).toBeVisible();
  await expect(page.getByTestId('dataset-detail')).toBeVisible();
  await expect(datasets).toContainText(/Planned|planned|≈/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dataset-detail')).toBeHidden();
  await expect(datasets).toBeVisible();
  await expect(page.getByTestId('datasets-summary')).toContainText('Planned data for this run');
  await page.keyboard.press('Escape');
  await expect(datasets).toHaveCount(0);
  await expect(plan).toBeFocused();

  // ── Setup: How this simulation works (a preview of the form) ──
  const setupModel = page.getByTestId('setup-model-card');
  await setupModel.scrollIntoViewIfNeeded();
  await setupModel.click();
  await expect(card).toBeVisible();
  await page.getByTestId('model-card-close').click();
  await expect(card).toHaveCount(0);
  await expect(setupModel).toBeFocused();

  // ── Settings → both screens; Back goes card → Settings → Setup, one at a time ──
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('settings-datasets').click();
  await expect(datasets).toBeVisible();
  await page.goBack();
  await expect(datasets).toHaveCount(0);
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect(page.getByTestId('settings-datasets')).toBeFocused();
  await page.getByTestId('settings-model-card').click();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('settings')).toHaveCount(0);
  await expect(page.getByTestId('open-settings')).toBeFocused();
  expect(await stageInert(page)).toBe(false);

  // ── Into the run ──
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await markFire(page);
  await setSpeed(page, 60);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);

  // Main menu → Data sets; the run keeps playing; Close puts focus back on the menu button.
  const menu = page.getByTestId('menu');
  await menu.click();
  await page.getByTestId('menu-datasets').click();
  await expect(datasets).toBeVisible();
  expect(await stageInert(page)).toBe(true);
  expect((await session(page)).playing).toBe(true);
  await expect(datasets.getByTestId('datasets-summary')).not.toContainText('Planned data for this run'); // the run's own inventory
  await page.getByTestId('datasets-close').click();
  await expect(datasets).toHaveCount(0);
  await expect(menu).toBeFocused();
  // Main menu → How this simulation works.
  await menu.click();
  await page.getByTestId('menu-model').click();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(menu).toBeFocused();

  // Stats tab: "Data used" (See all, and a row = that data set's page) and the model card row.
  await page.getByTestId('tab-stats').click();
  await page.getByTestId('data-open').scrollIntoViewIfNeeded();
  await page.getByTestId('data-open').click();
  await expect(datasets).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(datasets).toHaveCount(0);
  await expect(page.getByTestId('data-open')).toBeFocused();
  const row = page.locator('[data-testid^=data-row-]').first();
  await row.scrollIntoViewIfNeeded();
  const rowId = (await row.getAttribute('data-testid'))!.replace('data-row-', '');
  await row.click();
  await expect(page.getByTestId('dataset-detail')).toBeVisible();
  await expect(page.getByTestId('dataset-detail')).toHaveAttribute('data-dataset', rowId);
  await page.goBack(); // detail → list
  await expect(page.getByTestId('dataset-detail')).toBeHidden();
  await expect(datasets).toBeVisible();
  await page.goBack(); // list → closed
  await expect(datasets).toHaveCount(0);
  await page.getByTestId('stats-model-card').scrollIntoViewIfNeeded();
  await page.getByTestId('stats-model-card').click();
  await expect(card).toBeVisible();
  await expect(card.getByTestId('model-card-open-datasets').or(card.getByRole('button', { name: /data sets/i })).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await page.getByTestId('tab-stats').click(); // close the dock

  // Layers panel: the (i) of a layer lists its data set; the link opens that data set's page.
  await pickTool(page, 'layers');
  await page.getByTestId('layer-info-btn-canopy3d').click();
  const link = page.getByTestId('layer-dataset-canopy3d');
  await expect(link).toBeVisible();
  await link.click();
  await expect(datasets).toBeVisible();
  await expect(page.getByTestId('dataset-detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(datasets).toHaveCount(0);
  await page.getByTestId('layers-panel').getByRole('button', { name: /close/i }).first().click();
  await expect(page.getByTestId('layers-panel')).toHaveCount(0);

  // The map credit line opens the Data sets screen.
  await page.getByTestId('map-credit').click();
  await expect(datasets).toBeVisible();
  await expect(page.getByTestId('map-credit')).toBeVisible({ timeout: 100 }).catch(() => undefined); // behind the inert stage
  await page.keyboard.press('Escape');
  await expect(datasets).toHaveCount(0);
  await expect(page.getByTestId('map-credit')).toBeFocused();

  // "Show on map" applies the layer and closes the screen; the run is untouched.
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-datasets').click();
  await page.getByTestId('dataset-row-terrain').click();
  await page.getByTestId('dataset-detail').getByTestId('show-on-map').click();
  await expect(datasets).toHaveCount(0);
  expect((await session(page)).playing).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __firesim: { view: { layers?: { overlay?: string } } } }).__firesim.view.layers?.overlay ?? null)).toBe('elevation');

  // ── Back order: Layers panel (a tool) ← Settings ← Data sets ← one data set's page ──
  await pickTool(page, 'layers');
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('settings-datasets').click();
  await page.getByTestId('dataset-row-terrain').click();
  await expect(page.getByTestId('dataset-detail')).toBeVisible();
  const steps: [string, () => Promise<void>][] = [
    ['the data set page closes (list shows)', async () => void (await expect(page.getByTestId('dataset-detail')).toBeHidden(), await expect(datasets).toBeVisible())],
    ['the Data sets screen closes (Settings shows)', async () => void (await expect(datasets).toHaveCount(0), await expect(page.getByTestId('settings')).toBeVisible())],
    ['Settings closes (the Layers panel is still there)', async () => void (await expect(page.getByTestId('settings')).toHaveCount(0), await expect(page.getByTestId('layers-panel')).toBeVisible())],
    ['the Layers panel closes', async () => void (await expect(page.getByTestId('layers-panel')).toHaveCount(0), await expect(page.getByTestId('sim')).toBeVisible())],
  ];
  for (const [what, check] of steps) {
    await page.goBack();
    await check().catch((e: Error) => {
      e.message = `After Back: ${what}. ${e.message}`;
      throw e;
    });
    expect((await session(page)).playing, `still playing after Back: ${what}`).toBe(true);
  }
  // Nothing is left to close: Back asks before leaving the simulation, and Back again cancels that question.
  await page.goBack();
  await expect(page.getByTestId('confirm-leave')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('confirm-leave')).toHaveCount(0);
  await expect(page.getByTestId('sim')).toBeVisible();
  expect((await session(page)).playing).toBe(true);

  expect(errors).toEqual([]);
});

// ───────────── reviewers' follow-ups ─────────────

test('follow-ups: the weather chip is not a button; Tab from Settings never reaches the map; Play has no aria-pressed; backgrounding cancels a fast-forward', async ({ page }) => {
  test.setTimeout(180_000);
  await buildMock(page);
  await markFire(page);

  // The weather read-out chips are information, not controls.
  const wx = page.getByTestId('weather-chip');
  await expect(wx).toBeVisible();
  expect(await wx.evaluate((e) => e.tagName)).not.toBe('BUTTON');
  await expect(wx.locator('button, a, [role=button], [tabindex]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /weather now/i })).toHaveCount(0);

  // Play is a plain button whose label changes: it never exposes aria-pressed.
  const play = page.getByTestId('play');
  await expect(play).not.toHaveAttribute('aria-pressed', /.*/);
  await setSpeed(page, 600);
  await play.click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await expect(play).not.toHaveAttribute('aria-pressed', /.*/);
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Play');
  await expect(play).not.toHaveAttribute('aria-pressed', /.*/);

  // Tab and Shift+Tab inside Settings stay in Settings (the map and its controls are inert behind it).
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press(key);
      const where = await page.evaluate(() => {
        const a = document.activeElement;
        return { inSim: !!a?.closest('.sim-screen'), inSettings: !!a?.closest('[data-testid=settings]'), tag: a?.tagName ?? '' };
      });
      expect(where.inSim, `${key} #${i + 1} landed in the simulation screen`).toBe(false);
      expect(where.inSettings || where.tag === 'BODY', `${key} #${i + 1} left Settings`).toBe(true);
    }
  }
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('settings')).toHaveCount(0);

  // Backgrounding the page while a fast-forward computes cancels it (and a playing run is paused too).
  await page.getByTestId('time-btn').click();
  await page.getByTestId('time-end').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('seek-cancel')).toBeVisible({ timeout: 5000 });
  const hide = (state: 'hidden' | 'visible'): Promise<void> =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await hide('hidden');
  await expect.poll(async () => (await session(page)).seekTarget).toBeNull();
  const s = await session(page);
  expect(s.playing).toBe(false);
  await expect(page.getByTestId('seek-status')).toBeHidden();
  await hide('visible');
  expect((await session(page)).playing).toBe(false); // back in the foreground it stays paused until Play

  // A playing run is paused when the page goes to the background, too.
  await play.click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);
  await hide('hidden');
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  await hide('visible');
});

// ───────────── appearance ─────────────

test('high contrast: the Settings switch sets and clears <html data-contrast> and is remembered', async ({ page }) => {
  await page.goto('/?mock=1&theme=light');
  await acceptNotice(page);
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-contrast', 'high');
  await page.getByTestId('open-settings').click();
  const sw = page.getByTestId('high-contrast').getByRole('switch');
  await expect(sw).not.toBeChecked();
  await page.getByTestId('high-contrast').click();
  await expect(sw).toBeChecked();
  await expect(html).toHaveAttribute('data-contrast', 'high');
  // The strip stays visible and the tokens changed (the primary colour is darker than the standard blue).
  await expect(page.getByTestId('training-badge')).toBeVisible();
  const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase());
  expect(primary).toBe('#0842a0');
  await page.getByTestId('close-settings').click();
  // Remembered across a reload.
  await page.reload();
  await expect(html).toHaveAttribute('data-contrast', 'high');
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('high-contrast').getByRole('switch')).toBeChecked();
  await page.getByTestId('high-contrast').click();
  await expect(html).not.toHaveAttribute('data-contrast', 'high');
});

for (const [vw, vh] of [
  [412, 915],
  [360, 640],
  [844, 390],
] as const) {
test(`Android font scale 200 % at ${vw}x${vh}: Setup, Settings, the run, its menus and sheets, Data sets and the model card neither overflow nor hide a control`, async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: vw, height: vh });
  const scale = Number(process.env.FIRESIM_FONT_SCALE ?? 2); // 4 is a negative control: the checks below must then fail
  await page.goto('/?mock=1&debug=1&theme=light');
  await acceptNotice(page);
  await fontScale(page, scale);
  const check = async (what: string): Promise<void> => expect(await layoutDamage(page), what).toEqual([]);
  await expect(page.getByTestId('training-badge')).toBeVisible();
  await page.getByTestId('site-katoomba').click();
  await check('Setup');
  await page.getByTestId('open-settings').click();
  await check('Settings');
  await page.getByTestId('close-settings').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await fontScale(page, scale);
  await page.waitForTimeout(300);
  await check('the run, collapsed');
  await openMenu(page, 'tools');
  await check('the Tools menu');
  await page.keyboard.press('Escape');
  await openMenu(page, 'view');
  await check('the View menu');
  await page.keyboard.press('Escape');
  await page.getByTestId('menu').click();
  await check('the main menu');
  await page.keyboard.press('Escape');
  await page.getByTestId('tab-insights').click();
  await check('the Insights sheet');
  await page.getByTestId('tab-stats').click();
  await check('the Stats sheet');
  await page.getByTestId('tab-stats').click();
  await pickTool(page, 'layers');
  await check('the Layers panel');
  await page.getByTestId('layers-panel').getByRole('button', { name: /close/i }).first().click();
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-datasets').click();
  await expect(page.getByTestId('datasets-screen')).toBeVisible();
  await check('Data sets');
  await page.getByTestId('dataset-row-terrain').click();
  await check('a data set page');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-model').click();
  await expect(page.getByTestId('model-card')).toBeVisible();
  await check('How this simulation works');
  // The safety strip is still all there.
  await expect(page.getByTestId('training-badge')).toBeVisible();
  const strip = await page.getByTestId('training-badge').boundingBox();
  expect(strip!.width).toBeGreaterThan(100);
});
}

// ───────────── no pop-ups, no pauses: a whole run with every screen visited ─────────────

test('nothing pops up and nothing pauses the run while every screen is visited during a whole scenario', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[FireSim]'))) consoleErrors.push(m.text());
  });
  await watchPopups(page);
  await buildMock(page);
  await armPopupWatch(page);
  await markFire(page);
  const D = await scenarioDuration(page);
  await setSpeed(page, 600);
  await page.getByTestId('play').click();

  let visited = 0;
  const visit = async (): Promise<void> => {
    await expectStillPlaying(page, D);
    // Main menu → each screen, closed again, while the run is still going.
    for (const [row, screen] of [
      ['menu-datasets', 'datasets-screen'],
      ['menu-model', 'model-card'],
      ['menu-settings', 'settings'],
    ] as const) {
      const s = await expectStillPlaying(page, D);
      expect(s.viewTime, `the run must still be going when ${screen} is visited`).toBeLessThan(D - 1);
      visited++;
      await page.getByTestId('menu').click();
      await page.getByTestId(row).click();
      await expect(page.getByTestId(screen)).toBeVisible();
      await page.waitForTimeout(150);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId(screen)).toHaveCount(0);
    }
    // Menus, panels and the dock.
    await pickTool(page, 'layers');
    await page.getByTestId('overlay-slope').click();
    await page.getByTestId('overlay-slope').click();
    await page.keyboard.press('Escape');
    await openMenu(page, 'view');
    await page.keyboard.press('Escape');
    for (const tab of ['insights', 'weather', 'stats', 'help']) await page.getByTestId(`tab-${tab}`).click();
    await page.getByTestId('tab-help').click();
    await expectStillPlaying(page, D);
  };
  await visit();
  expect(visited).toBe(3);
  expect((await session(page)).viewTime).toBeLessThan(D - 1);
  const deadline = Date.now() + 120_000;
  for (;;) {
    const s = await expectStillPlaying(page, D);
    if (s.viewTime >= D - 1) break;
    if (Date.now() > deadline) throw new Error(`timed out at ${s.viewTime} s`);
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => (await session(page)).playing).toBe(false); // the end of the scenario, nothing else
  expect(await popups(page)).toEqual([]);
  expect(errors).toEqual([]);
  expect(consoleErrors.filter((t) => !/favicon|net::ERR/i.test(t))).toEqual([]);
});

// ───────────── a deletion always asks first ─────────────

test('storage: Clear asks to confirm; Cancel (and Back) keep the stored copies; only Clear removes them', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?mock=1&debug=1&theme=light');
  await acceptNotice(page);
  // A stored copy of a weather download, the way the app's cache writes one (IndexedDB 'firesim' / 'kv').
  const seed = (): Promise<void> =>
    page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('firesim', 1);
          open.onupgradeneeded = () => {
            if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv');
          };
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put({ t: Date.now(), n: 40_000, url: 'e2e' }, 'openmeteo/e2e-seed');
            tx.oncomplete = () => (open.result.close(), resolve());
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
  const stored = (): Promise<boolean> =>
    page.evaluate(
      () =>
        new Promise<boolean>((resolve, reject) => {
          const open = indexedDB.open('firesim', 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('kv')) return resolve(false);
            const get = db.transaction('kv').objectStore('kv').get('openmeteo/e2e-seed');
            get.onsuccess = () => (db.close(), resolve(get.result !== undefined));
            get.onerror = () => reject(get.error);
          };
        }),
    );
  await seed();
  expect(await stored()).toBe(true);

  await page.getByTestId('open-datasets').click();
  const screen = page.getByTestId('datasets-screen');
  const clear = screen.getByTestId('clear-cache-weather');
  await expect(clear).toBeVisible({ timeout: 15_000 });
  await clear.scrollIntoViewIfNeeded();

  // Cancel: nothing is removed.
  await clear.click();
  const dialog = page.getByTestId('confirm-clear-cache');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Saved areas are not touched');
  await expect(page.getByTestId('confirm-cancel')).toBeFocused(); // the safe choice has the focus
  await page.getByTestId('confirm-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(clear).toBeFocused();
  expect(await stored()).toBe(true);

  // Android Back answers "no" as well.
  await clear.click();
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(screen).toBeVisible(); // Back closed the question, not the screen
  expect(await stored()).toBe(true);

  // Escape too; then the real thing.
  await clear.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(screen).toBeVisible();
  expect(await stored()).toBe(true);
  await clear.click();
  await page.getByTestId('confirm-ok').click();
  await expect(screen.getByTestId('storage-result')).toContainText(/Cleared/, { timeout: 15_000 });
  expect(await stored()).toBe(false);
});

// ───────────── the real engine: the screen's numbers are the scenario's numbers; layer toggles ─────────────

test('real engine: the Data sets screen shows the scenario’s own numbers; every places layer and tree style switches the view', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await buildKatoomba(page);

  // ── Data sets screen: counts, sizes and names are read from window.__firesim.scenario ──
  const sc = await page.evaluate(() => {
    const s = (window as unknown as { __firesim: { scenario: { datasets?: unknown[]; datasetSummary?: unknown } } }).__firesim.scenario;
    return JSON.parse(JSON.stringify({ datasets: s.datasets ?? [], summary: s.datasetSummary ?? null }));
  }) as { datasets: DatasetRecord[]; summary: DatasetSummary | null };
  expect(sc.datasets.length).toBeGreaterThan(8);
  expect(sc.summary).not.toBeNull();
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-datasets').click();
  const screen = page.getByTestId('datasets-screen');
  await expect(screen).toBeVisible();
  const norm = (s: string): string => s.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  const stat = async (id: string): Promise<string> => norm(await screen.getByTestId('datasets-totals').locator(`[data-stat=${id}]`).innerText());
  const tight = (v: string): string => v.replace(/ /g, ''); // the number and its unit are two spans: "13.6" "MB"
  expect(tight(await stat('count'))).toContain(String(sc.datasets.length));
  const t = sc.summary!.totals;
  expect(tight(await stat('memory'))).toContain(tight(formatBytes(t.memoryBytes)));
  expect(tight(await stat('stored'))).toContain(tight(formatBytes(t.storedBytes)));
  // One row per record, with the record's own title.
  await expect(screen.locator('[data-testid^=dataset-row-]')).toHaveCount(sc.datasets.length);
  for (const r of sc.datasets) await expect(screen.getByTestId(`dataset-row-${r.id}`)).toContainText(r.title);
  // A page per data set: the sizes are the record's.
  for (const id of ['terrain', 'canopy-height'].filter((i) => sc.datasets.some((r) => r.id === i))) {
    const r = sc.datasets.find((d) => d.id === id)!;
    await screen.getByTestId(`dataset-row-${id}`).click();
    const size = page.getByTestId('dataset-size');
    await expect(size).toBeVisible();
    const text = norm(await size.innerText());
    expect(text).toContain(formatBytes(r.sizes.transferredBytes));
    if (typeof r.sizes.memoryBytes === 'number') expect(text).toContain(formatBytes(r.sizes.memoryBytes));
    expect(text).not.toMatch(BAD);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dataset-detail')).toBeHidden();
  }
  expect(norm(await screen.innerText())).not.toMatch(BAD);
  await page.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);

  // ── Layers panel: every places layer and tree style switches the 3-D view (read back from window.__firesim.view) ──
  type V = { view: { getLayers?(): Record<string, unknown> } };
  const layerState = (): Promise<Record<string, unknown>> => page.evaluate(() => ((window as unknown as { __firesim: V }).__firesim.view.getLayers?.() ?? {}) as Record<string, unknown>);
  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();
  for (const key of ['roads', 'fireTrails', 'homes', 'zones', 'placeNames'] as const) {
    const info = LAYER_CATALOG.find((l) => l.scene === key)!;
    const control = panel.getByTestId(`layer-${info.id}`).or(panel.getByTestId(`layer-${info.id}-show`)).first();
    await expect(control, `a control for ${info.id}`).toBeVisible();
    const was = (await layerState())[key];
    await control.click();
    await expect.poll(async () => (await layerState())[key], { message: `${info.id} flips its switch` }).toBe(!was);
    await control.click();
    await expect.poll(async () => (await layerState())[key]).toBe(was);
  }
  // Trees: the three styles, and the colour code of the coded style.
  const canopy = panel.getByTestId('layer-canopy3d');
  if ((await canopy.getAttribute('aria-pressed')) !== 'true') await canopy.click();
  const styles = panel.getByTestId('canopy-style');
  for (const [label, value] of [['Simple', 'simple'], ['Coded', 'coded'], ['Natural', 'natural']] as const) {
    await styles.getByRole('radio', { name: new RegExp(`^${label}`) }).check({ force: true });
    await expect.poll(async () => (await layerState()).canopyStyle).toBe(value);
  }
  await styles.getByRole('radio', { name: /^Coded/ }).check({ force: true });
  await panel.getByTestId('canopy-code').getByRole('radio', { name: /bark/i }).check({ force: true });
  await expect.poll(async () => (await layerState()).canopyCode).toBe('bark');
  await styles.getByRole('radio', { name: /^Natural/ }).check({ force: true });
  // A heat map on its own (solo): the photo and the trees step aside; off again brings them back.
  await panel.getByTestId('overlay-slope').click();
  await expect.poll(async () => (await layerState()).overlay).toBe('slope');
  await expect(panel.getByTestId('solo-heat').getByRole('switch')).toBeChecked();
  await panel.getByTestId('overlay-slope').click();
  await expect.poll(async () => (await layerState()).overlay).toBe('none');
  expect((await session(page)).error).toBeNull();
  expect(errors).toEqual([]);
});

// ───────────── battery: nothing is drawn behind a full-screen screen ─────────────

test('real engine: a full-screen screen over the run stops the 3-D view drawing frames while the run carries on; closing it resumes drawing', async ({ page }) => {
  test.setTimeout(420_000);
  await buildKatoomba(page);
  await markFire(page); // a burning fire keeps the view animating, so frames are drawn unless something stops them
  await setSpeed(page, 60);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);
  const frames = (): Promise<number> => page.evaluate(() => (window as unknown as { __firesim: { view: { renderer: { info: { render: { frame: number } } } } } }).__firesim.view.renderer.info.render.frame);
  const f0 = await frames();
  await expect.poll(frames, { message: 'the uncovered view draws', timeout: 30_000 }).toBeGreaterThan(f0 + 1);

  await page.getByTestId('menu').click();
  await page.getByTestId('menu-datasets').click();
  await expect(page.getByTestId('datasets-screen')).toBeVisible();
  await page.waitForTimeout(1200); // a frame already in flight may land
  const covered = await frames();
  const t0 = (await session(page)).headTime;
  await page.waitForTimeout(3000);
  expect(await frames(), 'no frame is drawn behind the screen').toBe(covered);
  expect((await session(page)).playing, 'opening the screen does not pause the run').toBe(true);
  await expect.poll(async () => (await session(page)).headTime, { message: 'the run carries on underneath' }).toBeGreaterThan(t0);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('datasets-screen')).toHaveCount(0);
  await expect.poll(frames, { message: 'closing the screen resumes drawing', timeout: 30_000 }).toBeGreaterThan(covered);
  expect((await session(page)).error).toBeNull();
});
