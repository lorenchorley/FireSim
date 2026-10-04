/**
 * End-to-end tests of the field UI with the mock engine (?mock=1): the collapsed chrome and its menus, the speed options,
 * the timeline (jump anywhere, back, cancel, picture interval), "nothing ever pops up and the run never stops by itself",
 * the opt-in pause on Danger cards, and settings/theme plus the belt weather kit.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  acceptNotice,
  armPopupWatch,
  expectStillPlaying,
  jumpWithPopover,
  openMenu,
  pickTool,
  pickViewMode,
  popups,
  scenarioDuration,
  session,
  setSpeed,
  tapTimeline,
  timelinePoint,
  viewMenuAction,
  waitForSeekEnd,
  watchPopups,
  zoomView,
} from './helpers';

async function buildMock(page: Page): Promise<void> {
  await page.goto('/?mock=1&theme=light');
  await expect(page.getByTestId('training-badge')).toBeVisible();
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await expect(page.getByTestId('site-katoomba')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('build').click();
  await expect(page.getByTestId('building')).toBeVisible();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('training-badge')).toBeVisible();
}

/** Mark a fire at the crosshair (the gloved-hand path) and close the panel. */
async function markFire(page: Page): Promise<void> {
  await pickTool(page, 'fire');
  await expect(page.getByTestId('fire-panel')).toBeVisible();
  await page.getByTestId('use-crosshair').click();
  // The confirm bar sits outside the panel's scroll area, so "Add fire" is on screen without scrolling.
  await expect(page.getByTestId('confirm-fire')).toBeInViewport();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await expect(page.getByTestId('fire-panel')).toHaveCount(0);
}

test('notice → Katoomba → build → mark fire → play → insight → why here → layers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await watchPopups(page);
  await buildMock(page);
  await armPopupWatch(page);

  // Mark a fire with the crosshair, from the Tools menu.
  await markFire(page);

  // Play as fast as possible.
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();

  // An insight about the fire appears in the Insights tab (nothing pops up for it, whatever its severity).
  await page.getByTestId('tab-insights').click();
  const fireCard = page.locator('[data-testid=insight-card]:not(:has-text("Forecast"))').first();
  await expect(fireCard).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('clock')).not.toHaveText('--:--');

  // Why here? — tap the map above the dock (a map tap also gives the map back: the dock closes).
  const scene = await page.getByTestId('scene').boundingBox();
  expect(scene).not.toBeNull();
  await page.mouse.click(scene!.x + scene!.width * 0.5, scene!.y + scene!.height * 0.3);
  const why = page.getByTestId('why-panel');
  await expect(why).toBeVisible();
  await expect(why.locator('.narrative li').first()).toBeVisible({ timeout: 10_000 });
  await expect(why.locator('.factor-row')).toHaveCount(7);
  await why.getByRole('button', { name: 'Close' }).click();

  // Layers: choose the arrival-time overlay and see its legend.
  await pickTool(page, 'layers');
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  await page.getByTestId('overlay-arrival').click();
  await expect(page.getByTestId('overlay-arrival')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('legend')).toContainText('Fire arrival time');

  expect(await popups(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('the chrome is collapsed by default; every menu opens on demand and collapses after a pick', async ({ page }) => {
  await buildMock(page);

  // Nothing is open: two round buttons, the dock's tab row, the timeline. No Live button anywhere.
  for (const id of ['tools-menu', 'view-menu']) await expect(page.getByTestId(id)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('dock')).toHaveAttribute('data-detent', 'closed');
  for (const id of ['tool-fire', 'tool-layers', 'zoom-in', 'compass', 'speed-popover', 'time-popover', 'menu-settings']) await expect(page.getByTestId(id)).toBeHidden();
  await expect(page.getByTestId('live')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^live$/i })).toHaveCount(0);

  // Tools menu: six tools, one press to choose, collapses again; Escape and a map tap also collapse it.
  await openMenu(page, 'tools');
  for (const t of ['why', 'fire', 'fuel', 'wind', 'layers', 'whatif']) await expect(page.getByTestId(`tool-${t}`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tools-menu')).toHaveAttribute('aria-expanded', 'false');
  await openMenu(page, 'tools');
  const scene = (await page.getByTestId('scene').boundingBox())!;
  await page.mouse.click(scene.x + scene.width / 2, scene.y + scene.height * 0.4);
  await expect(page.getByTestId('tools-menu')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('why-panel')).toHaveCount(0); // that press only dismissed the menu: it was not also a map tap
  await pickTool(page, 'wind');
  await expect(page.getByTestId('wind-panel')).toBeVisible();
  await page.getByTestId('wind-panel').getByRole('button', { name: 'Close tool' }).click();

  // View menu: opening one closes the other; zoom keeps it open for repeated taps.
  await openMenu(page, 'tools');
  await page.getByTestId('view-menu').click();
  await expect(page.getByTestId('view-menu')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('tools-menu')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await zoomView(page, 'in', 2);
  await zoomView(page, 'out');
  await pickViewMode(page, 'top');
  await expect(page.getByTestId('view-menu')).toHaveAttribute('aria-label', /Top view/);
  await pickViewMode(page, 'orbit');
  await viewMenuAction(page, 'compass');

  // The dock: a tab opens its panel, another tab switches, the same tab (or a map tap) closes it.
  await page.getByTestId('tab-insights').click();
  await expect(page.getByTestId('dock')).not.toHaveAttribute('data-detent', 'closed');
  await page.getByTestId('tab-weather').click();
  await expect(page.getByTestId('tab-weather')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('tab-weather').click();
  await expect(page.getByTestId('dock')).toHaveAttribute('data-detent', 'closed');

  // The top bar's menu: New scenario / Settings / Safety notice.
  await page.getByTestId('menu').click();
  for (const id of ['menu-new', 'menu-settings', 'menu-notice']) await expect(page.getByTestId(id)).toBeVisible();
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  // Nothing that stops the simulation or pops up is on by default.
  await expect(page.getByTestId('pause-on-danger').getByRole('switch')).not.toBeChecked();
  await expect(page.getByTestId('haptics').getByRole('switch')).not.toBeChecked();
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('settings')).toHaveCount(0);
});

test('speed options: presets, any speed with the slider, a custom value, and "as fast as possible"', async ({ page }) => {
  await buildMock(page);
  await page.getByTestId('speed').click();
  const pop = page.getByTestId('speed-popover');
  await expect(pop).toBeVisible();
  // 13 presets plus Max, from slow motion to an hour of fire per second.
  await expect(pop.locator('[data-speed]')).toHaveCount(14);
  for (const sp of ['0.25', '1', '60', '3600', 'Infinity']) await expect(pop.locator(`[data-speed="${sp}"]`)).toBeVisible();

  await pop.locator('[data-speed="30"]').click();
  expect((await session(page)).speed).toBe(30);
  await expect(page.getByTestId('speed')).toContainText('30×');
  await expect(pop.locator('[data-speed="30"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('speed-hint')).toContainText('30 s');

  // A slow-motion preset.
  await pop.locator('[data-speed="0.25"]').click();
  expect((await session(page)).speed).toBe(0.25);

  // The slider reaches any value in between (keyboard steps here; a finger drags it).
  await page.getByTestId('speed-slider').focus();
  const before = (await session(page)).speed;
  await page.keyboard.press('End');
  await expect.poll(async () => (await session(page)).speed).toBeGreaterThan(before);
  expect(Number.isFinite((await session(page)).speed)).toBe(true);

  // A custom value, in × and in minutes of fire per second.
  await page.getByTestId('speed-custom').fill('45');
  await page.getByTestId('speed-custom-set').click();
  expect((await session(page)).speed).toBe(45);
  await page.getByTestId('speed-unit-minps').click();
  await page.getByTestId('speed-custom').fill('2');
  await page.getByTestId('speed-custom-set').click();
  expect((await session(page)).speed).toBe(120);
  await page.getByTestId('speed-custom').fill('0');
  await page.getByTestId('speed-custom-set').click();
  expect((await session(page)).speed).toBe(120); // rejected: 0 is not a speed

  await pop.locator('[data-speed="Infinity"]').click();
  expect((await session(page)).speed).toBe(Infinity);
  await expect(page.getByTestId('speed')).toContainText('Max');
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();

  // The chosen speed is remembered for the next run.
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('speed')).toContainText('Max');
});

test('timeline: jump anywhere (forward beyond the computed range, back), cancel a fast-forward, change the picture interval', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await buildMock(page);
  await markFire(page);
  const D = await scenarioDuration(page);
  await expect(page.getByTestId('live')).toHaveCount(0);

  // Nothing has been computed yet (the engine works ahead of the view only while it plays). Cancel a fast-forward on its
  // way: jump to the End with the time popover, then stop it while it computes.
  expect((await session(page)).headTime).toBeLessThan(600);
  await page.getByTestId('time-btn').click();
  await page.getByTestId('time-end').click();
  await page.keyboard.press('Escape');
  const cancel = page.getByTestId('seek-cancel');
  await expect(cancel).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('seek-status')).toContainText('Computing to');
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Pause'); // the button offers to stop it, too
  await cancel.click();
  const cancelled = await session(page);
  expect(cancelled.seekTarget).toBeNull();
  expect(cancelled.playing).toBe(false);
  expect(cancelled.viewTime).toBeLessThan(D);
  await expect(page.getByTestId('seek-status')).toBeHidden();
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play');

  // Forward, far beyond what is computed, by typing a time: the view lands EXACTLY there and stays paused (it was paused).
  const far = 4.5 * 3600;
  expect((await session(page)).headTime).toBeLessThan(far);
  await jumpWithPopover(page, far);
  const landed = await waitForSeekEnd(page);
  expect(landed.viewTime).toBe(far);
  expect(landed.playing).toBe(false);
  expect(landed.headTime).toBeGreaterThanOrEqual(far);
  await expect(page.getByTestId('clock')).toHaveText(/16:30/);
  expect(await page.evaluate(() => (window as unknown as { __firesim: { session: { state: { get(): { snapshot: { time: number } } } } } }).__firesim.session.state.get().snapshot.time)).toBe(far);

  // Back: one tap on the track, a quarter of the way along. The past is shown at once (no computing), marked as a replay.
  await tapTimeline(page, D * 0.25);
  await expect.poll(async () => Math.abs((await session(page)).viewTime - D * 0.25)).toBeLessThan(200);
  await expect(page.locator('.tb-state')).toContainText('Replay');
  expect((await session(page)).playing).toBe(false);

  // Dragging shows a bubble with the time while the finger is down; letting go jumps there.
  const from = await timelinePoint(page, D * 0.3);
  const to = await timelinePoint(page, D * 0.8);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, from.y, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await expect(page.locator('.tl-bubble')).toBeVisible();
  await page.mouse.up();
  const dragged = await waitForSeekEnd(page);
  expect(Math.abs(dragged.viewTime - D * 0.8)).toBeLessThan(250);
  expect(dragged.playing).toBe(false);
  await expect(page.locator('.tl-bubble')).toBeHidden();

  // The picture interval: 10 s pictures show seconds, and the ‹ › buttons step by exactly that.
  await page.getByTestId('time-btn').click();
  await page.getByTestId('time-start').click();
  await expect.poll(async () => (await session(page)).viewTime).toBe(0);
  await page.getByTestId('step-10').click();
  await expect(page.getByTestId('step-10')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  expect((await session(page)).timeStep).toBe(10);
  await expect(page.getByTestId('clock')).toHaveText(/\d\d:\d\d:\d\d/);
  await page.getByTestId('scrub-next').click();
  await expect.poll(async () => (await session(page)).viewTime).toBe(10);
  await page.getByTestId('scrub-next').click();
  await expect.poll(async () => (await session(page)).viewTime).toBe(20);
  await page.getByTestId('scrub-prev').click();
  await expect.poll(async () => (await session(page)).viewTime).toBe(10);
  // Snapshots arrive at that interval too.
  await setSpeed(page, 60);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime).toBeGreaterThan(60);
  await page.getByTestId('play').click();
  const fine = await session(page);
  expect(fine.timeStep).toBe(10);
  expect(fine.headTime % 10).toBe(0);

  // Play while looking at the past keeps going from there; Play at the very end starts again from the start.
  await page.getByTestId('time-btn').click();
  await page.getByTestId('time-end').click();
  await page.keyboard.press('Escape');
  await waitForSeekEnd(page);
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play again from the start');
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime).toBeLessThan(D * 0.5);

  expect(errors).toEqual([]);
});

test('nothing pops up and the run never stops by itself: a whole scenario at maximum speed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await watchPopups(page);
  await buildMock(page);
  await armPopupWatch(page);
  await markFire(page);
  const D = await scenarioDuration(page);

  // The default "pause on Danger" is off: a run goes straight through every Danger card to the end.
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();
  const deadline = Date.now() + 90_000;
  let last = 0;
  for (;;) {
    const s = await expectStillPlaying(page, D);
    last = s.viewTime;
    if (s.viewTime >= D - 1) break;
    if (Date.now() > deadline) throw new Error(`timed out at ${s.viewTime} s`);
    await page.waitForTimeout(150);
  }
  expect(last).toBeGreaterThanOrEqual(D - 1);
  // It stopped because the scenario is over, and Play offers to run it again.
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play again from the start');

  // Cards were revealed (some of them Danger) and they wait in the Insights tab: the dock only shows a badge.
  const s = await session(page);
  expect(s.insights).toBeGreaterThan(2);
  await expect(page.getByTestId('insights-badge')).toBeVisible();
  await expect(page.locator('.toast, [data-testid=toast]')).toHaveCount(0);
  await expect(page.locator('[role=alert]:visible')).toHaveCount(0);
  await page.getByTestId('tab-insights').click();
  await expect(page.getByTestId('insights-badge')).toBeHidden(); // opening the tab is what "seen" means
  await expect(page.locator('[data-testid=insight-card]').first()).toBeVisible();
  await expect(page.locator('[data-testid=insight-card][data-severity=danger]').first()).toBeVisible();

  expect(await popups(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('"Pause when a Danger card appears" is opt-in: when switched on, a Danger card stops the run', async ({ page }) => {
  await buildMock(page);
  await markFire(page);
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('pause-on-danger').click();
  await expect(page.getByTestId('pause-on-danger').getByRole('switch')).toBeChecked();
  await page.getByTestId('close-settings').click();

  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();
  // It stops by itself, before the end, right after a Danger card was revealed - and nothing pops up over the map.
  await expect.poll(async () => (await session(page)).playing, { timeout: 60_000 }).toBe(false);
  const s = await session(page);
  expect(s.viewTime).toBeGreaterThan(0);
  expect(s.seekTarget).toBeNull();
  await expect(page.locator('.toast, [data-testid=toast]')).toHaveCount(0);
  const revealed = await page.evaluate(
    (t) => (window as unknown as { __firesim: { session: { state: { get(): { insights: { severity: string; time: number }[] } } } } }).__firesim.session.state.get().insights.filter((i) => i.severity === 'danger' && i.time <= t + 1).length,
    s.viewTime,
  );
  expect(revealed).toBeGreaterThan(0);
});

test('settings switch to the night theme; belt kit computes RH live', async ({ page }) => {
  await page.goto('/?mock=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('theme').getByRole('radio', { name: 'Night' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // The step options: a finer picture interval and the solver step are settings too.
  await expect(page.getByTestId('time-step').getByRole('radio')).toHaveCount(6);
  await expect(page.getByTestId('solver-step').getByRole('radio')).toHaveCount(4);
  await page.getByTestId('time-step').getByRole('radio', { name: '10 s' }).check({ force: true });
  await expect(page.getByTestId('time-step').getByRole('radio', { name: '10 s' })).toBeChecked();
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('settings')).toHaveCount(0);

  await page.getByTestId('weather-source').getByRole('radio', { name: 'Belt kit' }).check();
  await page.getByTestId('belt-dry').fill('30');
  await page.getByTestId('belt-wet').fill('20');
  // 30 °C dry / 20 °C wet bulb at ~950 m → about 41 % (≈ 39 % at sea level).
  await expect(page.getByTestId('belt-rh')).toHaveText(/RH 4[01]%/);
  await page.getByTestId('belt-wet').fill('31');
  await expect(page.getByTestId('belt-rh')).toHaveText('RH –');
});

test('the dock tabs share one scrolling body: each tab opens at its top; a glossary gloss sits under its term, never behind a stray separator', async ({ page }) => {
  await buildMock(page);
  const body = page.locator('[data-testid=sheet] .sheet-body');
  // Help, the tallest tab, scrolled to the bottom.
  await page.getByTestId('tab-help').click();
  await page.getByTestId('sheet-grip').click();
  await page.getByTestId('sheet-grip').click();
  await expect(page.getByTestId('dock')).toHaveAttribute('data-detent', 'full');
  await body.evaluate((e) => (e.scrollTop = e.scrollHeight));
  expect(await body.evaluate((e) => e.scrollTop)).toBeGreaterThan(100);
  // Another tab does not inherit that offset (it used to open half way down, or at the very bottom).
  await page.getByTestId('tab-stats').click();
  await expect(page.getByTestId('tab-stats')).toHaveAttribute('aria-selected', 'true');
  expect(await body.evaluate((e) => e.scrollTop)).toBe(0);
  await body.evaluate((e) => (e.scrollTop = e.scrollHeight));
  await page.getByTestId('tab-weather').click();
  expect(await body.evaluate((e) => e.scrollTop)).toBe(0);
  // Glossary: the one-line gloss is its own line under the term, without a leading "·".
  await page.getByTestId('tab-help').click();
  await expect(page.getByTestId('tab-help')).toHaveAttribute('aria-selected', 'true');
  const glosses = await page.locator('.gloss').evaluateAll((els) =>
    els.map((d) => {
      const term = d.querySelector('.gloss-term')!.getBoundingClientRect();
      const short = d.querySelector('.gloss-short');
      const s = short?.getBoundingClientRect();
      return { text: short?.textContent ?? '', below: s ? s.top >= term.bottom - 1 : true, hasTerm: term.width > 0 };
    }),
  );
  expect(glosses.length).toBeGreaterThan(5);
  for (const g of glosses) {
    expect(g.hasTerm).toBe(true);
    expect(g.below, `the gloss "${g.text}" sits under its term`).toBe(true);
    expect(g.text.trim()).not.toMatch(/^[·•]/);
  }
  expect(glosses.some((g) => g.text.trim().length > 0)).toBe(true);

  // Keyboard focus on a tab: the ring is drawn inside the tab (the tab row sits flush between the sheet and the timeline strip,
  // so the outer 2 px ring was cut off above and below and only two blue bars were left at the sides).
  await page.keyboard.press('Shift');
  await page.getByTestId('tab-weather').focus();
  const ring = await page.getByTestId('tab-weather').evaluate((e) => {
    const cs = getComputedStyle(e);
    return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset) };
  });
  expect(ring.style).toBe('solid');
  expect(ring.width).toBeGreaterThanOrEqual(2);
  expect(ring.offset).toBeLessThan(0);
});

test('the TRAINING strip keeps its full wording wherever it fits (360 px phones too), never clips, and shortens only when it must', async ({ page }) => {
  const strip = async (vw: number, vh: number, query: string, scale = 1) => {
    await page.setViewportSize({ width: vw, height: vh });
    await page.goto(`/?mock=1&${query}`);
    await expect(page.getByTestId('training-badge')).toBeVisible();
    if (scale !== 1) {
      await page.evaluate((k) => {
        const cs = getComputedStyle(document.documentElement);
        const decl = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'].map((n) => `--fs-${n}: ${parseFloat(cs.getPropertyValue(`--fs-${n}`)) * k}px !important`);
        const st = document.createElement('style');
        st.textContent = `:root { ${decl.join('; ')} }`;
        document.head.append(st);
      }, scale);
      await page.waitForTimeout(150);
    }
    return page.getByTestId('training-badge').evaluate((s) => {
      const shown = (sel: string): boolean => getComputedStyle(s.querySelector(sel)!).display !== 'none';
      const r = s.getBoundingClientRect();
      return { full: shown('.badge-full'), short: shown('.badge-short'), clipped: s.scrollWidth > s.clientWidth + 1, onScreen: r.left >= 0 && r.right <= window.innerWidth + 1 };
    });
  };
  const expectWording = (s: { full: boolean; short: boolean; clipped: boolean; onScreen: boolean }, wording: 'full' | 'short', what: string): void => {
    expect(s.full, `${what}: full wording`).toBe(wording === 'full');
    expect(s.short, `${what}: short wording`).toBe(wording === 'short');
    expect(s.clipped, `${what}: not clipped`).toBe(false);
    expect(s.onScreen, `${what}: inside the screen`).toBe(true);
  };
  expectWording(await strip(360, 740, 'theme=light'), 'full', '360 x 740, light'); // 28 em used to put these phones on the short wording
  expectWording(await strip(360, 640, 'theme=dark'), 'full', '360 x 640, night');
  expectWording(await strip(390, 844, 'theme=light'), 'full', '390 x 844, light');
  expectWording(await strip(844, 390, 'theme=light'), 'full', '844 x 390, light');
  expectWording(await strip(412, 915, 'theme=light&contrast=high'), 'full', '412 x 915, high contrast');
  expectWording(await strip(390, 844, 'theme=light&contrast=high'), 'short', '390 x 844, high contrast (bold caps are wider)');
  expectWording(await strip(320, 640, 'theme=light'), 'short', '320 x 640, light');
  expectWording(await strip(412, 915, 'theme=light', 2), 'short', '412 x 915 at 200 % text');
  expectWording(await strip(844, 390, 'theme=light', 2), 'full', '844 x 390 at 200 % text (the wide screen still has the room)');
});

test('the View card is never under the Tools button: every row, the zoom buttons included, takes the tap on a short phone, in high contrast and at a large text size', async ({ page }) => {
  test.setTimeout(240_000);
  const cases = [
    { vw: 360, vh: 640, query: 'theme=light&contrast=high', scale: 1 }, // the read-out chips wrap to two rows: the card used to reach the Tools button
    { vw: 360, vh: 640, query: 'theme=light', scale: 1 },
    { vw: 360, vh: 640, query: 'theme=dark', scale: 1.3 },
    { vw: 390, vh: 844, query: 'theme=light&contrast=high', scale: 1 },
    { vw: 844, vh: 390, query: 'theme=light&contrast=high', scale: 1 },
  ];
  for (const c of cases) {
    const what = `${c.vw}x${c.vh} ${c.query} text x${c.scale}`;
    await page.setViewportSize({ width: c.vw, height: c.vh });
    await page.goto(`/?mock=1&${c.query}`);
    await expect(page.getByTestId('notice').or(page.getByTestId('site-katoomba')).first()).toBeVisible(); // the notice is shown once per device
    if (await page.getByTestId('notice').isVisible()) await acceptNotice(page);
    await page.getByTestId('site-katoomba').click();
    await page.getByTestId('build').click();
    await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
    if (c.scale !== 1) {
      await page.evaluate((k) => {
        const cs = getComputedStyle(document.documentElement);
        const decl = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'].map((n) => `--fs-${n}: ${parseFloat(cs.getPropertyValue(`--fs-${n}`)) * k}px !important`);
        const st = document.createElement('style');
        st.textContent = `:root { ${decl.join('; ')} }`;
        document.head.append(st);
      }, c.scale);
    }
    await page.waitForTimeout(500);
    await openMenu(page, 'view');
    await page.waitForTimeout(300);
    const misses = await page.evaluate(() => {
      const bad: string[] = [];
      const probes = [[0, 0], [-15, -15], [15, -15], [-15, 15], [15, 15], [-21, 0], [21, 0], [0, -21], [0, 21]];
      for (const id of ['zoom-out', 'zoom-in', 'fly-fire', 'compass']) {
        const el = document.querySelector(`[data-testid=${id}]`) as HTMLElement | null;
        if (!el) continue;
        el.scrollIntoView({ block: 'nearest' }); // a card that scrolls has its last rows below the fold
        const r = el.getBoundingClientRect();
        const isZoom = id.startsWith('zoom');
        for (const [dx, dy] of probes) {
          // A row is as wide as its card: probe its own area only; the round zoom buttons have the 44 px area (+-21 px).
          if (!isZoom && (Math.abs(dx) > r.width / 2 || Math.abs(dy) > r.height / 2)) continue;
          const hit = document.elementFromPoint(r.left + r.width / 2 + dx, r.top + r.height / 2 + dy);
          if (!hit || !(el === hit || el.contains(hit))) bad.push(`${id} at ${dx},${dy} hits ${hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 30)}` : 'nothing'}`);
        }
      }
      return bad;
    });
    expect(misses, what).toEqual([]);
    // And the "+" really zooms (it used to open nothing: the tap went to the Tools button underneath).
    await page.getByTestId('zoom-in').click();
    await expect(page.getByTestId('view-menu')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('tools-menu')).toHaveAttribute('aria-expanded', 'false');
  }
});

test('at 200 % text on a short landscape screen the fire can still be added: the Add / Clear bar is on screen and takes the tap', async ({ page }) => {
  test.setTimeout(240_000);
  for (const [vw, vh] of [
    [844, 390],
    [360, 640],
  ] as const) {
    const what = `${vw}x${vh} at 200 % text`;
    await page.setViewportSize({ width: vw, height: vh });
    await page.goto('/?mock=1&theme=light');
    await expect(page.getByTestId('notice').or(page.getByTestId('site-katoomba')).first()).toBeVisible();
    if (await page.getByTestId('notice').isVisible()) await acceptNotice(page);
    await page.getByTestId('site-katoomba').click();
    await page.getByTestId('build').click();
    await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const decl: string[] = [];
      for (const n of ['xs', 'sm', 'md', 'lg', 'xl', '2xl']) decl.push(`--fs-${n}: ${parseFloat(cs.getPropertyValue(`--fs-${n}`)) * 2}px !important`);
      for (const n of ['xs', 'sm', 'md', 'lg', 'xl']) decl.push(`--lh-${n}: ${parseFloat(cs.getPropertyValue(`--lh-${n}`)) * 2}px !important`);
      const st = document.createElement('style');
      st.textContent = `:root { ${decl.join('; ')} }`;
      document.head.append(st);
    });
    await page.waitForTimeout(500);
    await pickTool(page, 'fire');
    await expect(page.getByTestId('fire-panel')).toBeVisible();
    await page.getByTestId('use-crosshair').click({ force: true });
    await expect(page.getByTestId('confirm-fire')).toBeVisible();
    await page.waitForTimeout(700); // the panel and the layout settle
    const probe = await page.getByTestId('confirm-fire').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const bad: string[] = [];
      for (const [fx, fy] of [[0.5, 0.5], [0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        const hit = y < innerHeight && x < innerWidth ? document.elementFromPoint(x, y) : null;
        if (!hit || !(el === hit || el.contains(hit))) bad.push(`${Math.round(fx * 100)}%,${Math.round(fy * 100)}% -> ${hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 24)}` : 'off screen'}`);
      }
      return { bad, bottom: Math.round(r.bottom), vh: innerHeight };
    });
    expect(probe.bad, `${what}: the Add fire button must take the tap over its whole face (it ends at ${probe.bottom} of ${probe.vh})`).toEqual([]);
    await page.getByTestId('confirm-fire').click();
    await expect(page.getByTestId('fire-panel')).toContainText('Marked');
    await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
    await expect(page.getByTestId('fire-panel')).toHaveCount(0);
    // The read-out chips come back with the panel closed.
    await expect(page.getByTestId('weather-chip')).toBeVisible();
  }
});

test('Layers tiles: the selected badge and its ring end before the label begins (they used to touch its first letter), and the tile name is 14 px body text', async ({ page }) => {
  await buildMock(page);
  await pickTool(page, 'layers');
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();
  const tiles = await panel.locator('.lp-tile.is-on').evaluateAll((els) =>
    els.map((t) => {
      const thumb = t.querySelector('.lp-thumb') as HTMLElement;
      const label = t.querySelector('.lp-tile-label') as HTMLElement;
      const after = getComputedStyle(thumb, '::after');
      const ring = 2; // the badge's ring: box-shadow 0 0 0 (--sp-1 / 2)
      const badgeRight = thumb.getBoundingClientRect().right - parseFloat(after.right);
      return { name: label.textContent, clear: label.getBoundingClientRect().left - (badgeRight + ring), size: parseFloat(getComputedStyle(label).fontSize) };
    }),
  );
  expect(tiles.length).toBeGreaterThan(1);
  for (const t of tiles) {
    expect(t.clear, `"${t.name}": room between the badge ring and the label`).toBeGreaterThanOrEqual(2);
    expect(t.size, `"${t.name}": the tile name is body text`).toBeGreaterThanOrEqual(14);
  }
});

test('the safety notice opens at its top on a short screen (title and first lines in sight), and its button is reachable by scrolling', async ({ page }) => {
  for (const [vw, vh] of [
    [844, 390],
    [360, 640],
  ] as const) {
    await page.setViewportSize({ width: vw, height: vh });
    await page.goto('/?mock=1&theme=light');
    await expect(page.getByTestId('notice')).toBeVisible();
    await page.waitForTimeout(400); // the focus lands one frame after the dialog opens
    const open = await page.evaluate(() => {
      const modal = document.querySelector('.modal.notice') as HTMLElement;
      const title = document.getElementById('notice-title') as HTMLElement;
      const t = title.getBoundingClientRect();
      const m = modal.getBoundingClientRect();
      return { scrollTop: modal.scrollTop, titleInSight: t.top >= m.top - 1 && t.bottom <= innerHeight, focused: document.activeElement?.getAttribute('data-testid') };
    });
    expect(open.scrollTop, `${vw}x${vh}: the dialog starts at its top`).toBe(0);
    expect(open.titleInSight, `${vw}x${vh}: the title is in sight`).toBe(true);
    expect(open.focused, 'the accept button still has the focus (keyboard users)').toBe('accept-notice');
    await acceptNotice(page); // scrolls the button into view and taps it
    await page.evaluate(() => localStorage.clear()); // the notice is shown once per device: show it again for the next size
  }
});
