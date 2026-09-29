/**
 * End-to-end test of the REAL engine in the browser (no ?mock): the scenario builder with the bundled Katoomba demo
 * data (offline), the simulation in its Web Worker (SimClient → src/sim/worker.ts) and the Three.js view.
 * Build → mark a fire → play → the worker streams snapshots and insight cards → "Why here?" from the worker;
 * then the timeline against the real worker (a jump beyond the computed range lands exactly, a fast-forward can be
 * cancelled, the picture interval can be finer) and a whole run at maximum speed in which nothing pops up and playback
 * never stops by itself.
 */
import { expect, test } from '@playwright/test';
import {
  acceptNotice,
  armPopupWatch,
  expectStillPlaying,
  jumpWithPopover,
  pickTool,
  popups,
  scenarioDuration,
  session,
  setSpeed,
  tapTimeline,
  waitForSeekEnd,
  watchPopups,
} from './helpers';

test('real engine: Katoomba preset offline → build → fire → play → worker insight → why here → timeline → full run without interruptions', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'warning' && m.text().includes('[FireSim]')) warnings.push(m.text());
  });
  await watchPopups(page);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await armPopupWatch(page);
  const D = await scenarioDuration(page);

  // The whole transport is one row, and nothing labelled Live exists.
  await expect(page.getByTestId('live')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^live$/i })).toHaveCount(0);

  await pickTool(page, 'fire');
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();

  // ── Jump beyond what is computed: from the very start (nothing computed yet) to 15:00 by tapping the timeline ──
  // The real worker computes up to the target at full speed; the view lands on the tapped time and stays paused
  // (the run was not playing).
  await tapTimeline(page, D * 0.5);
  await expect.poll(async () => (await session(page)).seekTarget !== null || (await session(page)).viewTime > 0, { timeout: 10_000 }).toBe(true);
  const jumped = await waitForSeekEnd(page, 150_000);
  expect(Math.abs(jumped.viewTime - D * 0.5)).toBeLessThan(250);
  expect(jumped.playing).toBe(false);
  expect(jumped.headTime).toBeGreaterThanOrEqual(jumped.viewTime);
  expect(jumped.area).toBeGreaterThan(0); // the fire has burnt for 3 h

  // ── Back to the start, then cancel a fast-forward part-way ──
  await page.getByTestId('time-btn').click();
  await page.getByTestId('time-start').click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await session(page)).viewTime).toBe(0);
  const headBefore = (await session(page)).headTime;
  await page.getByTestId('time-btn').click();
  await page.getByTestId('time-end').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('seek-status')).toBeVisible();
  // (already computed up to `headBefore`, so the first part is instant; then the worker computes on)
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 60_000 }).toBeGreaterThan(headBefore);
  await page.getByTestId('seek-cancel').click();
  const cancelled = await session(page);
  expect(cancelled.seekTarget).toBeNull();
  expect(cancelled.playing).toBe(false);
  expect(cancelled.viewTime).toBeLessThan(D);
  await expect(page.getByTestId('seek-status')).toBeHidden();
  // Cancelling leaves a consistent session: the view is where the jump had got to, and it keeps working.
  expect(cancelled.viewTime).toBeLessThanOrEqual(cancelled.headTime);

  // ── An exact jump, typed: 15:30 (3.5 h) - lands exactly on it ──
  const exact = 3.5 * 3600;
  await jumpWithPopover(page, exact);
  const landed = await waitForSeekEnd(page, 150_000);
  expect(landed.viewTime).toBe(exact);
  expect(landed.playing).toBe(false);
  await expect(page.getByTestId('clock')).toHaveText(/15:30/);

  // ── A finer picture interval, live: from here on the worker emits a picture every 10 s ──
  await page.getByTestId('time-btn').click();
  await page.getByTestId('step-10').click();
  await page.keyboard.press('Escape');
  expect((await session(page)).timeStep).toBe(10);
  await page.getByTestId('scrub-next').click();
  await expect.poll(async () => (await session(page)).viewTime).toBe(exact + 10);
  await page.getByTestId('scrub-prev').click();
  await expect.poll(async () => (await session(page)).viewTime).toBe(exact);
  await page.getByTestId('time-btn').click();
  await page.getByTestId('step-60').click();
  await page.keyboard.press('Escape');

  // ── Back to the start and play the whole scenario as fast as possible ──
  await page.getByTestId('time-btn').click();
  await page.getByTestId('time-start').click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await session(page)).viewTime).toBe(0);
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();

  // An insight about the fire appears in the Insights tab (dock), without pausing or popping up.
  await page.getByTestId('tab-insights').click();
  const fireCard = page.locator('[data-testid=insight-card]:not(:has-text("Forecast"))').first();
  await expect(fireCard).toBeVisible({ timeout: 150_000 });
  await expect(page.getByTestId('clock')).not.toHaveText('--:--');

  // Why here? works while it plays.
  const scene = await page.getByTestId('scene').boundingBox();
  expect(scene).not.toBeNull();
  await page.mouse.click(scene!.x + scene!.width * 0.5, scene!.y + scene!.height * 0.3);
  const why = page.getByTestId('why-panel');
  await expect(why).toBeVisible();
  await expect(why.locator('.narrative li').first()).toBeVisible({ timeout: 30_000 });
  await why.getByRole('button', { name: 'Close' }).click();

  // The run goes on to the end of the scenario without ever being stopped by a card.
  const end = Date.now() + 240_000;
  for (;;) {
    const s = await expectStillPlaying(page, D);
    if (s.viewTime >= D - 1) break;
    if (Date.now() > end) throw new Error(`timed out at ${s.viewTime} s (head ${s.headTime} s)`);
    await page.waitForTimeout(250);
  }
  await expect.poll(async () => (await session(page)).playing, { timeout: 30_000 }).toBe(false); // the end of the scenario stops it
  const final = await session(page);
  expect(final.viewTime).toBeGreaterThanOrEqual(D - 1);
  expect(final.insights).toBeGreaterThan(5);
  expect(final.error).toBeNull();
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play again from the start');

  // Nothing popped up over the map for any of those cards (Danger ones included).
  expect(await popups(page)).toEqual([]);
  await expect(page.getByTestId('error-chip')).toBeHidden();

  // The real modules were used (no "using the mock" fallback) and nothing threw.
  expect(warnings.filter((w) => w.includes('mock'))).toEqual([]);
  expect(errors).toEqual([]);
});
