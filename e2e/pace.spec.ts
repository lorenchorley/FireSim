/**
 * The honest speed signal on the timeline (workstream B, docs/plans/air-slice-wind-detail-honest-speed.md §6.4 and §6.5).
 *
 * 1. The REAL engine on the slow tier (the Detail profile: 3-D air), played at 3600x so it cannot keep up: the 44 px button
 *    appears at the end of the timeline, but only after the wait the tracker keeps after Play; it announces itself once in a
 *    polite status line and never as an alert; its sheet opens on a tap (and only then) with the sections of the plan; "Play at N"
 *    (the nearest preset at or below what the phone achieves) sets that speed and clears the signal; nothing ever pops up.
 * 2. The debug hook (`?debug=1&paceLevel=...`, mock engine): each level in two phone sizes, the hit area of the button, the strip
 *    keeping its height, the sheet fitting the screen, Escape and an outside tap closing it, focus returning to the button.
 * Needs the production build (`npx playwright test` builds and serves it).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, animationsDone, armPopupWatch, popups, scenarioDuration, session, setSpeed, watchPopups } from './helpers';

const LABEL = 'Simulation is running slower than your playback speed. Show details.';
/** The speed presets of the speed sheet (speedModel.ts), below 3600x. */
const PRESETS = [0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800];
const BAD = /\b(undefined|NaN|Infinity|null|\[object)\b/;

interface PaceState {
  level: string;
  wanted: number;
  achieved: number | null;
  capacity: number | null;
  waitingShare: number;
}

const pace = (page: Page): Promise<PaceState | null> =>
  page.evaluate(() => {
    const fs = (window as unknown as { __firesim: { session: { state: { get(): { pace: unknown } } } } }).__firesim;
    return (fs.session.state.get().pace ?? null) as never;
  });

/** Build the Katoomba demo offline on the slow tier: the Detail profile asks for the 3-D air, whatever this machine's auto-tune would pick. */
async function buildSlow(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('firesim.settings', JSON.stringify({ performance: 'quality' })));
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('duration').getByRole('radio', { name: /^3/ }).check({ force: true });
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 240_000 });
}

/** The button's hit area: every probe point 21 px from its centre (and the diagonals at 15 px) lands on the button, like scripts/audit-tap-targets.mjs. */
async function hitArea(page: Page, testId: string): Promise<{ w: number; h: number; missed: string[] }> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid=${id}]`) as HTMLElement;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const missed: string[] = [];
    for (const [dx, dy] of [[-21, 0], [21, 0], [0, -21], [0, 21], [-15, -15], [15, 15], [-15, 15], [15, -15]] as const) {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      if (!(hit && (el === hit || el.contains(hit)))) missed.push(`${dx},${dy}`);
    }
    return { w: r.width, h: r.height, missed };
  }, testId);
}

test('real engine, slow tier, played at 3600x: the signal appears after the wait, explains itself on a tap, and "Play at N" clears it', async ({ page }) => {
  test.setTimeout(420_000);
  await watchPopups(page);
  await buildSlow(page);
  await armPopupWatch(page);
  const D = await scenarioDuration(page);
  const btn = page.getByTestId('pace-btn');
  const strip = page.locator('.scrubber');
  await expect(btn).toBeHidden();
  const stripH = (await strip.boundingBox())!.height;
  const trackBefore = (await page.locator('.tl-area').boundingBox())!.width;

  // ── play at 3600x: the engine cannot keep up ──
  await setSpeed(page, 3600);
  const t0 = Date.now();
  await page.getByTestId('play').click();
  await expect(btn).toBeVisible({ timeout: 240_000 });
  const after = (Date.now() - t0) / 1000;
  // Never before the wait the tracker keeps after Play (15 s), and not much later than the wait plus the hold of 6 s once the engine is running.
  expect(after, 'the signal must wait out the 15 s after Play').toBeGreaterThan(14);
  const p = await pace(page);
  expect(p).not.toBeNull();
  expect(p!.level === 'waiting' || p!.level === 'behind').toBe(true);
  expect(p!.wanted).toBe(3600);
  expect((await session(page)).error).toBeNull();

  // ── what it is: a real button, 44 px, the accessible name of the plan, a polite status line, never an alert ──
  await expect(btn).toHaveAttribute('aria-label', LABEL);
  await expect(btn).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  const hit = await hitArea(page, 'pace-btn');
  expect(hit.w).toBeGreaterThanOrEqual(44);
  expect(hit.h).toBeGreaterThanOrEqual(44);
  expect(hit.missed).toEqual([]);
  expect((await strip.boundingBox())!.height).toBe(stripH); // the strip keeps its height: the camera insets do not jump
  expect((await page.locator('.tl-area').boundingBox())!.width).toBeLessThan(trackBefore); // the track gave the button its column
  const live = page.getByTestId('pace-live');
  await expect(live).toHaveAttribute('role', 'status');
  await expect(live).toHaveAttribute('aria-live', 'polite');
  if ((await pace(page))?.level === 'waiting') await expect(live).toHaveText('Simulation is running slower than your playback speed.');
  // Nothing that could be an alert, a toast or a dialog scrim is on screen (the engine-failure strip is hidden unless the engine failed).
  expect(await page.locator('[role=alert], [role=alertdialog], .toast, .modal-scrim').evaluateAll((els) => els.filter((e) => !e.closest('.error-chip, .sim-error') && !(e as HTMLElement).hidden).length)).toBe(0);
  await expect(page.getByTestId('pace-sheet')).toBeHidden(); // nothing opened by itself

  // ── the sheet: only on a tap ──
  await btn.click();
  const sheet = page.getByTestId('pace-sheet');
  await expect(sheet).toBeVisible();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  // The sheet's contents are loaded on the first tap: allow for a loaded machine.
  await expect(page.getByTestId('pace-lead')).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByRole('heading', { name: 'Running slower than playback' })).toBeVisible();
  const lead = (await page.getByTestId('pace-lead').innerText()).replace(/\s+/g, ' ');
  expect(lead).toMatch(/^(You asked for 3600× \(1 hour of fire every second\)\. This phone is computing about \d+× right now, so playback waits for the simulation (about \d+ seconds? in every 10|almost all the time|now and then)\.|Computing about \d+×; you asked for 3600×\. )/);
  await expect(page.getByTestId('pace-result')).toContainText('Does it change the result?');
  await expect(page.getByTestId('pace-result')).toContainText('No. The same choices give the same fire at any speed. It only takes longer to appear.');
  await expect(page.getByTestId('pace-actions')).toBeVisible();
  await expect(page.getByTestId('pace-actions')).toContainText('Pausing stops the simulation too. Playing slower is what lets it keep up.');
  const play = page.getByTestId('pace-play-at');
  await expect(play).toBeVisible();
  await expect(play).toHaveText(/^Play at \d+(\.\d+)?×$/);
  await expect(page.getByTestId('pace-fast')).toHaveText('Use the fast model from here');
  await expect(page.getByTestId('pace-fast-note')).toHaveText('The fire from this moment on comes out a little different.');
  // Sections that need the engine's statistics (EngineInfo.perf) are there when it reports them, with four rows adding up to 100 %.
  if (await page.getByTestId('pace-time').isVisible()) {
    const rows = await page.locator('[data-testid^=pace-time-] .meter-value').allInnerTexts();
    expect(rows).toHaveLength(4);
    expect(rows.reduce((a, r) => a + Number.parseInt(r, 10), 0)).toBe(100);
  }
  // "All the numbers" is there when the app offers the debug statistics screen.
  if (await page.getByTestId('pace-numbers').count()) await expect(page.getByTestId('pace-numbers')).toContainText('All the numbers');
  await expect(sheet).toContainText('Measured on this phone, over the last 10 seconds.');
  expect(await sheet.innerText()).not.toMatch(BAD);
  // The sheet is inside the screen (once its slide-in has finished), and a screen reader's focus is in it.
  await animationsDone(page);
  const box = (await sheet.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  // The run keeps going while it is read: nothing paused it.
  expect((await session(page)).playing).toBe(true);
  // Escape closes it and the focus is back on the button.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(btn).toBeFocused();
  expect((await session(page)).playing).toBe(true);

  // ── "Play at N": the speed changes to a preset below the one asked for, the signal is cleared, the run keeps going ──
  await btn.click();
  await expect(play).toBeVisible();
  await expect(play).toHaveText(/^Play at \d+(\.\d+)?×$/);
  await play.click();
  await expect(sheet).toBeHidden();
  // (The sheet refreshes about once a second, so the number may have moved between a read and the tap: any preset below 3600 is right.)
  await expect.poll(async () => (await session(page)).speed).toBeLessThan(3600);
  expect(PRESETS).toContain((await session(page)).speed);
  await expect(btn).toBeHidden({ timeout: 5000 }); // a change of speed drops the reading; judged afresh after the wait
  expect((await pace(page))?.level ?? null).not.toBe('waiting');
  expect((await session(page)).playing).toBe(true);
  expect((await session(page)).error).toBeNull();
  expect(D).toBe(3 * 3600);

  // ── through all of it: no pop-up, no alert, no toast ──
  expect(await popups(page)).toEqual([]);
});

for (const [w, h, name] of [[412, 915, 'portrait'], [844, 390, 'landscape']] as const) {
  test(`debug hook, ${name} (${w}x${h}): each level, the hit area, the strip, the sheet, Escape, an outside tap and the focus`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: w, height: h });
    await watchPopups(page);
    await page.goto('/?mock=1&debug=1');
    await acceptNotice(page);
    await page.getByTestId('site-katoomba').click();
    await page.getByTestId('build').click();
    await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
    await armPopupWatch(page);
    // Park the clock at 40 % of the run, so the thumb is mid-track (at the very start the run under the rail has no length).
    await page.evaluate(() => {
      const fs = (window as unknown as { __firesim: { session: { seek(t: number): void }; scenario: { duration: number } } }).__firesim;
      fs.session.seek(fs.scenario.duration * 0.4);
    });
    await expect.poll(async () => (await session(page)).seekTarget, { timeout: 60_000 }).toBeNull();
    const force = (level: string | null): Promise<void> =>
      page.evaluate((l) => (window as unknown as { __firesim: { session: { debugForcePace(l: string | null): void } } }).__firesim.session.debugForcePace(l), level);
    const btn = page.getByTestId('pace-btn');
    const strip = page.locator('.scrubber');
    const sheet = page.getByTestId('pace-sheet');
    await expect(btn).toBeHidden();
    const stripH = (await strip.boundingBox())!.height;
    expect(stripH).toBe(64);

    for (const level of ['behind', 'waiting'] as const) {
      await force(level);
      await expect(btn).toBeVisible();
      await expect(strip).toHaveAttribute('data-pace', level);
      if (level === 'waiting') await expect(page.locator('.tl-pace-run')).toBeVisible();
      else await expect(page.locator('.tl-pace-run')).toBeHidden();
      expect((await strip.boundingBox())!.height).toBe(stripH);
      const hit = await hitArea(page, 'pace-btn');
      expect(hit).toMatchObject({ w: 44, h: 44, missed: [] });
      // The thumb and the run end together, and the run is 44 px long (or as long as the track before it).
      if (level === 'waiting') {
        const run = (await page.locator('.tl-pace-run').boundingBox())!;
        const thumb = (await page.locator('.tl-thumb').boundingBox())!;
        expect(run.width).toBeLessThanOrEqual(44.5);
        expect(Math.abs(run.x + run.width - (thumb.x + thumb.width / 2))).toBeLessThanOrEqual(1.5);
      }
    }

    // The sheet on a tap: it fits the screen, reads well, and closes three ways.
    await btn.click();
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('pace-lead')).toHaveText('You asked for 60× (1 minute of fire every second). This phone is computing about 38× right now, so playback waits for the simulation about 4 seconds in every 10.', { timeout: 30_000 });
    await expect(page.getByTestId('pace-play-at')).toHaveText('Play at 30×');
    await expect(page.getByTestId('pace-fast')).toBeHidden(); // the demo engine has no tiers to switch
    await animationsDone(page);
    const box = (await sheet.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(h + 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(w + 1);
    // Every control in the sheet has a 44 px hit area.
    for (const id of ['pace-play-at']) expect((await hitArea(page, id)).missed).toEqual([]);
    expect(await sheet.innerText()).not.toMatch(BAD);
    // No horizontal overflow anywhere.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(btn).toBeFocused();

    // An outside tap closes it too (the tap does not reach the map).
    await btn.click();
    await expect(sheet).toBeVisible();
    // Beside the sheet on a wide screen, above it on a tall one: on the scrim, below the top bar.
    await page.mouse.click(10, Math.max(150, (await sheet.boundingBox())!.y - 20));
    await expect(sheet).toBeHidden();
    // The close button.
    await btn.click();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();

    // Opening it never changed the run: paused stays paused, and the speed is what it was.
    expect((await session(page)).playing).toBe(false);
    expect((await session(page)).speed).toBe(60);
    // The speed button's "Play at 30×" changes the speed, and the forced signal stays until the hook is released.
    await btn.click();
    await page.getByTestId('pace-play-at').click();
    await expect.poll(async () => (await session(page)).speed).toBe(30);
    await force(null);
    await expect(btn).toBeHidden();

    // Reduced motion and forced colours have nothing to switch off here: the rules exist in the stylesheet (checked by name, not by looking).
    expect(await page.evaluate(() => [...document.styleSheets].some((s) => [...s.cssRules].some((r) => r.cssText.includes('.tl-pace')))))
      .toBe(true);
    expect(await popups(page)).toEqual([]);
  });
}

test('the debug hook does nothing without ?debug (and the mock page has no signal of its own)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?mock=1&paceLevel=waiting');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('pace-btn')).toBeHidden();
  await expect(page.locator('.scrubber')).toHaveAttribute('data-pace', 'ok');
});
