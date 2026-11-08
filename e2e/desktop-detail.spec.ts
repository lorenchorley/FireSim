/**
 * The Desktop detail setting in the browser (0.9.0, D35; contract 4.1), against the stand-in host of e2e/desktopStub.ts (the page's side alone) and,
 * in the last test, against a REAL host started as a child process on port 4501.
 *
 * With the stand-in host (Pixel 7 profile, the demo builder and demo engine of `?mock=1`, so the builds take no time):
 *   - the choice appears only with the desktop: no host, no row; a host with This device chosen, the row is there and hidden; Desktop chosen, it shows
 *     Standard, Finer (20 m) and Finest (10 m), Standard chosen; a finer level shows "Finer grid, results differ, not validated" in the callout, and
 *     Setup's own Detail chips and hint say the cell the build will make; back on This device they say 30 m again
 *   - a build with Finest records the level in the scenario (`options.desktopDetail`, 10 m cells, 8,000 embers) and sends the desktop that scenario; the
 *     map has the label under "Running on the desktop", the statistics have the row and the label in their first line, "How sure are we?" has the
 *     owner's words first, and the phone's speed test is not offered for a run on the desktop; a Standard build has none of it and 30 m cells
 *   - the history budget: a phone's page keeps exactly the budget it has today at a finer level; a desktop-class page gets 384 MiB
 *   - the label survives "Continue on this device" when this device can run the grid; when it cannot, the chip says so and offers the standard detail
 *     (nothing is lowered, nothing is started): the tap goes to Setup on This device with the detail row gone
 *   - a level this page cannot keep the pictures of is refused on Setup with a sentence before anything is built (no link opened)
 *   - the row's tap targets and text size at two phone sizes
 * With the real host (`node desktop/run.mjs --port 4501` serving the e2e build): Katoomba 3 km at the Finest level computes on the host, the label shows,
 * the grid is 10 m, and the wall time and the picture sizes are printed (`[desktop-detail] ...`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { failLink, installDesktopStub, remoteCalls, type DesktopStubOptions } from './desktopStub';
import { expect, test } from './fixtures';
import { acceptNotice, armPopupWatch, popups, session, watchPopups } from './helpers';

const SHOTS = process.env.AUDIT_SHOTS ?? 'test-results/desktop-detail';
mkdirSync(SHOTS, { recursive: true });
const CODE = 'ABCD2345';
const LABEL = 'Finer grid, results differ, not validated';
const MIB = 1024 * 1024;

interface OpenOptions {
  query?: string;
  hash?: string;
  stub?: DesktopStubOptions | false;
  /** `navigator.deviceMemory` (GB) the page sees: what the history budget and the device's limit follow. */
  memoryGb?: number;
  /** A page load after the first of this browser context: the safety notice was accepted then, and shows again only if it was not. */
  again?: boolean;
}

async function openSetup(page: Page, o: OpenOptions = {}): Promise<void> {
  if (o.stub !== false) await installDesktopStub(page, o.stub ?? {});
  if (o.memoryGb !== undefined) await page.addInitScript((gb) => Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => gb, configurable: true }), o.memoryGb);
  await page.goto(`/?${o.query ?? 'mock=1&debug=1'}${o.hash ?? ''}`);
  if (o.again) {
    await expect(page.getByTestId('setup')).toBeVisible();
    await page.waitForTimeout(500);
    if (await page.getByTestId('notice').isVisible()) await page.getByTestId('accept-notice').click();
  } else await acceptNotice(page);
  await expect(page.getByTestId('setup')).toBeVisible();
}

const engineChip = (page: Page, value: 'device' | 'desktop'): Locator => page.getByTestId('engine').locator(`label.chip[data-value=${value}]`);
const levelChip = (page: Page, value: 'standard' | 'finer' | 'finest'): Locator => page.getByTestId('desktop-detail').locator(`label.chip[data-value=${value}]`);
const detailRow = (page: Page): Locator => page.getByTestId('desktop-detail-row');
const areaHint = (page: Page): Locator => page.getByTestId('detail-hint');
const sizeChip = (page: Page, km: 3 | 6 | 9): Locator => page.getByTestId('extent').getByRole('radio', { name: `${km} km` });

/** The eight probes of the repo's tap audit: a point around the centre that lands on something else is a hit area under 44 x 44 px. */
async function missedProbes(loc: Locator): Promise<number> {
  return loc.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const label = el.closest('label');
    return [[-21, 0], [21, 0], [0, -21], [0, 21], [-15, -15], [15, 15], [-15, 15], [15, -15]].filter(([dx, dy]) => {
      const hit = document.elementFromPoint(cx + dx!, cy + dy!);
      return !(hit && (el === hit || el.contains(hit) || (label && label.contains(hit))));
    }).length;
  });
}

type Opts = { desktopDetail?: string; fireCellSize: number; maxEmbers: number; tier?: string };
/** What the page holds of the run it built: the scenario's options and grid, and the history store's budget. */
const built = (page: Page) =>
  page.evaluate(() => {
    const fs = (window as unknown as { __firesim: { scenario: { options: Record<string, unknown>; terrain: { grid: { cellSize: number; nx: number } }; extent: number }; session: { snapshots: { maxBytes: number } } } }).__firesim;
    return { options: fs.scenario.options as unknown as Opts, cellM: fs.scenario.terrain.grid.cellSize, nx: fs.scenario.terrain.grid.nx, extent: fs.scenario.extent, maxBytes: fs.session.snapshots.maxBytes };
  });

/** Setup of a run on the desktop through the link (the code comes with the address): the area, the level, then Build. */
async function buildOnDesktop(page: Page, o: { km: 3 | 6 | 9; level: 'standard' | 'finer' | 'finest' }): Promise<void> {
  await sizeChip(page, o.km).check({ force: true });
  if (o.level !== 'standard') await levelChip(page, o.level).click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
}

async function leaveToSetup(page: Page): Promise<void> {
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('setup')).toBeVisible();
}

test.describe('the stand-in host', () => {
  test('the choice is there only with the desktop: no host, no row; This device, the row is hidden; Desktop, three levels with Standard chosen', async ({ page }) => {
    test.setTimeout(120_000);
    await openSetup(page, { stub: false, query: 'mock=1' });
    await page.waitForTimeout(1500);
    await expect(detailRow(page)).toHaveCount(0);
    await expect(page.getByTestId('desktop-detail')).toHaveCount(0);
    await page.goto('about:blank');

    await openSetup(page, { again: true });
    await expect(page.getByTestId('engine-row')).toBeVisible();
    await expect(engineChip(page, 'device').locator('input')).toBeChecked();
    await expect(detailRow(page)).toBeHidden(); // mounted, but not offered for this device
    await expect(page.getByTestId('desktop-detail')).toBeHidden();
    await engineChip(page, 'desktop').click();
    await expect(detailRow(page)).toBeVisible();
    await expect(page.getByTestId('desktop-detail').locator('legend')).toHaveText('Desktop detail');
    const chips = page.getByTestId('desktop-detail').locator('label.chip .chip-text');
    await expect(chips).toHaveText(['Standard', 'Finer · 20 m', 'Finest · 10 m']);
    await expect(levelChip(page, 'standard').locator('input')).toBeChecked();
    await expect(page.getByTestId('desktop-detail-hint')).toHaveText('The usual detail of the app: 30 m fire cells (20 m with Detailed, up to 6 km).');
    await expect(page.getByTestId('desktop-detail-label')).toHaveCount(0); // Standard has no label
    await expect(page.getByTestId('desktop-detail-note')).toContainText('Only the desktop computer runs the finer grids; this device does not.');
  });

  test('a finer level says the label next to the chips, and Setup\'s own cells say what the build will make; back on This device they say 30 m again', async ({ page }) => {
    test.setTimeout(120_000);
    await openSetup(page, {});
    await sizeChip(page, 3).check({ force: true });
    await expect(areaHint(page)).toContainText('30 m cells, 100 × 100 = 10,000 cells');
    await engineChip(page, 'desktop').click();
    await levelChip(page, 'finest').click();
    await expect(page.getByTestId('desktop-detail-label')).toHaveText(LABEL);
    await expect(page.getByTestId('desktop-detail-hint')).toContainText('Fire cells of 10 m at any area, up to 8,000 embers.');
    await expect(page.getByTestId('desktop-detail-hint')).toContainText('About 9 times the work of the usual 30 m cells, and about 16 MB a picture over 6 km (one study, one computer).');
    await expect(areaHint(page)).toContainText('10 m cells, 300 × 300 = 90,000 cells');
    await expect(page.getByTestId('detail').locator('label.chip .chip-text')).toHaveText(['Fast · 10 m 2-D', 'Normal · 10 m', 'Detailed · 10 m']);
    await levelChip(page, 'finer').click();
    await expect(areaHint(page)).toContainText('20 m cells, 150 × 150 = 22,500 cells');
    await expect(page.getByTestId('desktop-detail-hint')).toContainText('Fire cells of 20 m at any area, up to 8,000 embers.');
    await expect(page.getByTestId('desktop-detail-label')).toHaveText(LABEL);
    // This device: the level does not apply, and the cells are the usual
    await engineChip(page, 'device').click();
    await expect(detailRow(page)).toBeHidden();
    await expect(areaHint(page)).toContainText('30 m cells, 100 × 100 = 10,000 cells');
    await expect(page.getByTestId('detail').locator('label.chip .chip-text')).toHaveText(['Fast · 30 m 2-D', 'Normal · 30 m', 'Detailed · 20 m']);
  });

  for (const [w, h] of [[360, 640], [390, 844], [412, 915], [844, 390]] as const)
    test(`the row at ${w} x ${h}: inside the screen, 44 px hit areas, text of 14 px or more, in light, dark and high contrast`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: w, height: h });
      for (const look of ['theme=light', 'theme=dark', 'theme=light&contrast=high']) {
        await installDesktopStub(page, {});
        await page.goto(`/?mock=1&debug=1&${look}`);
        await expect(page.getByTestId('setup')).toBeVisible();
        await page.waitForTimeout(500);
        if (await page.getByTestId('notice').isVisible()) await page.getByTestId('accept-notice').click();
        await expect(page.getByTestId('engine-row')).toBeVisible();
        await engineChip(page, 'desktop').click();
        await levelChip(page, 'finest').click();
        await detailRow(page).scrollIntoViewIfNeeded();
        const m = await page.evaluate(() => {
          const r = document.querySelector('[data-testid=desktop-detail-row]')!;
          const bad: string[] = [];
          for (const el of r.querySelectorAll('*')) {
            const b = el.getBoundingClientRect();
            if (b.width && (b.right > innerWidth + 1 || b.left < -1)) bad.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className)} ${Math.round(b.left)}..${Math.round(b.right)}`);
          }
          const small: string[] = [];
          for (const el of r.querySelectorAll('.chip-text, .hint, .callout div, legend')) {
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < 14) small.push(`${el.tagName.toLowerCase()} ${fs}px`);
          }
          return { bad, small, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
        });
        expect(m.bad, look).toEqual([]);
        expect(m.small, look).toEqual([]);
        expect(m.scrollW, look).toBeLessThanOrEqual(m.clientW);
        for (const v of ['standard', 'finer', 'finest'] as const) expect(await missedProbes(levelChip(page, v)), `${look}: ${v} chip`).toBe(0);
        await page.screenshot({ path: `${SHOTS}/detail-row-${w}x${h}-${look.replace(/[^a-z]+/g, '-')}.png`, scale: 'css' });
      }
    });

  test('a build at the Finest level records it, tells the desktop, and says the label on the map, in the statistics and in "How sure are we?"', async ({ page }) => {
    test.setTimeout(240_000);
    await watchPopups(page);
    await openSetup(page, { hash: `#code=${CODE}`, memoryGb: 4 });
    await expect(engineChip(page, 'desktop').locator('input')).toBeChecked();
    await buildOnDesktop(page, { km: 3, level: 'finest' });
    await armPopupWatch(page);

    // the scenario carries the level, its cell and its embers; the tier stays the performance setting's (Auto)
    const b = await built(page);
    expect(b.options).toMatchObject({ desktopDetail: 'finest', fireCellSize: 10, maxEmbers: 8000, tier: 'auto' });
    expect(b).toMatchObject({ cellM: 10, nx: 300, extent: 3000 });
    // the desktop was sent that scenario, once
    expect((await remoteCalls(page)).filter((c) => c[0] === 'init')).toHaveLength(1);

    // the map: the engine's label, then the owner's words in a chip of the same kind below it, inside the screen, not on top of it
    const engine = page.getByTestId('engine-banner');
    const label = page.getByTestId('detail-banner');
    await expect(engine).toHaveText('Running on the desktop');
    await expect(label).toHaveText(/^Finer grid, results differ, not validated · 10\sm cells$/);
    const [e, l] = await Promise.all([engine.boundingBox(), label.boundingBox()]);
    expect(l!.y).toBeGreaterThanOrEqual(e!.y + e!.height - 0.5);
    expect(l!.x).toBeGreaterThanOrEqual(0);
    expect(l!.x + l!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await label.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);

    // the statistics: the row, the label in the summary line, and the phone's speed test is not used for a run on the desktop
    await page.getByTestId('menu').click();
    await page.getByTestId('menu-debug-stats').click();
    await expect(page.getByTestId('debug-stats')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('debug-stats-headline')).toContainText(LABEL);
    await page.getByTestId('debug-group-run').click();
    const run = page.getByTestId('debug-group-run-body');
    await expect(run).toContainText('Desktop detail');
    await expect(run).toContainText(LABEL);
    await expect(run).toContainText('Finest level: fire cells of 10');
    await page.getByTestId('debug-group-canDo').click();
    const canDo = page.getByTestId('debug-group-canDo-body');
    await expect(canDo).toContainText('Not used on a run that computes on the desktop.');
    await expect(page.getByTestId('speed-test')).toHaveCount(0);
    await page.getByTestId('debug-stats-close').click();
    await expect(page.getByTestId('debug-stats')).toHaveCount(0);

    // the model card: the owner's words come first in "How sure are we?"
    await page.getByTestId('menu').click();
    await page.getByTestId('menu-model').click();
    await expect(page.getByTestId('model-card')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('model-section-sure').click();
    const sure = page.getByTestId('model-section-sure-body');
    await expect(sure.locator('.callout').first()).toContainText(LABEL);
    await expect(sure.locator('.callout').first()).toContainText('Nothing says which is closer to a real fire');
    await page.getByTestId('model-card-close').click();
    expect(await popups(page)).toEqual([]);
  });

  test('a Standard build on the desktop has none of it: no record, 30 m cells, no label, no row in the statistics', async ({ page }) => {
    test.setTimeout(180_000);
    await openSetup(page, { hash: `#code=${CODE}` });
    await buildOnDesktop(page, { km: 3, level: 'standard' });
    const b = await built(page);
    expect('desktopDetail' in b.options).toBe(false);
    expect(b).toMatchObject({ cellM: 30, nx: 100 });
    await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');
    await expect(page.getByTestId('detail-banner')).toHaveCount(0);
    await page.getByTestId('menu').click();
    await page.getByTestId('menu-debug-stats').click();
    await expect(page.getByTestId('debug-stats')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('debug-stats-headline')).not.toContainText(LABEL);
    await page.getByTestId('debug-group-run').click();
    await expect(page.getByTestId('debug-group-run-body')).not.toContainText('Desktop detail');
    await page.getByTestId('debug-stats-close').click();
    // the phone's speed test is the one thing that follows the engine: on the desktop it is not offered, with the standard detail too
    await page.getByTestId('menu').click();
    await page.getByTestId('menu-debug-stats').click();
    await page.getByTestId('debug-group-canDo').click();
    await expect(page.getByTestId('debug-group-canDo-body')).toContainText('Not used on a run that computes on the desktop.');
  });

  test('This device chosen after a finer level builds a standard run: the level is not left behind', async ({ page }) => {
    test.setTimeout(180_000);
    await openSetup(page, {});
    await sizeChip(page, 3).check({ force: true });
    await engineChip(page, 'desktop').click();
    await expect(page.getByTestId('engine-code')).toBeVisible();
    await levelChip(page, 'finest').click();
    await engineChip(page, 'device').click();
    await page.getByTestId('build').click();
    await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
    const b = await built(page);
    expect('desktopDetail' in b.options).toBe(false);
    expect(b.cellM).toBe(30);
    expect((await remoteCalls(page)).filter((c) => c[0] === 'connect' || c[0] === 'init')).toEqual([]);
    await expect(page.getByTestId('detail-banner')).toHaveCount(0);
  });

  test('the history budget: a phone\'s page keeps the budget it has today at the Finest level; a desktop-class page gets 384 MiB', async ({ page, browser }) => {
    test.setTimeout(240_000);
    // a phone (the Pixel 7 profile) that reports 2 GB: 6 % of it (122.9 MiB, under the 160 MiB cap), as defaultSnapshotBudget has always said
    await openSetup(page, { hash: `#code=${CODE}`, memoryGb: 2 });
    await buildOnDesktop(page, { km: 3, level: 'finest' });
    expect((await built(page)).maxBytes).toBe(Math.round(2 * 1024 * 0.06 * MIB));
    // the same phone with the standard detail
    await leaveToSetup(page);
    await engineChip(page, 'desktop').click();
    await expect(levelChip(page, 'finest').locator('input')).toBeChecked(); // the choice is kept for the page load
    await levelChip(page, 'standard').click();
    await page.getByTestId('build').click();
    await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
    expect((await built(page)).maxBytes).toBe(Math.round(2 * 1024 * 0.06 * MIB));
    await page.close();

    // a desktop-class page: a window of a desktop browser that reports the 8 GB class
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
    try {
      const desk = await context.newPage();
      await openSetup(desk, { hash: `#code=${CODE}`, memoryGb: 8 });
      expect(await desk.evaluate(() => (navigator as { userAgentData?: { mobile: boolean } }).userAgentData?.mobile)).toBe(false);
      await buildOnDesktop(desk, { km: 3, level: 'finest' });
      expect((await built(desk)).maxBytes).toBe(384 * MIB);
      await leaveToSetup(desk);
      await engineChip(desk, 'desktop').click();
      await levelChip(desk, 'standard').click();
      await desk.getByTestId('build').click();
      await expect(desk.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
      expect((await built(desk)).maxBytes).toBe(160 * MIB); // the standard detail on that page is what it was
    } finally {
      await context.close();
    }
  });

  test('the label survives "Continue on this device" when this device can run the grid; the run is restarted here from the start', async ({ page }) => {
    test.setTimeout(240_000);
    await openSetup(page, { hash: `#code=${CODE}`, memoryGb: 8 });
    await buildOnDesktop(page, { km: 3, level: 'finest' });
    await expect(page.getByTestId('detail-banner')).toContainText(LABEL);
    await failLink(page);
    const go = page.getByTestId('continue-here');
    await expect(go).toBeVisible();
    await expect(go).toHaveText('Continue on this device'); // the device can run 3 km at 10 m by itself: the usual offer
    await expect(page.getByTestId('error-chip')).not.toContainText('cannot run');
    await go.click();
    await expect(page.getByTestId('engine-banner')).toHaveText('Running on this device again, from the start.');
    // the run is the same scenario, with the same record: the label is still there, under the new note
    await expect(page.getByTestId('detail-banner')).toContainText(LABEL);
    const b = await built(page);
    expect(b.options).toMatchObject({ desktopDetail: 'finest', fireCellSize: 10 });
    expect(b.cellM).toBe(10);
    const [e, l] = await Promise.all([page.getByTestId('engine-banner').boundingBox(), page.getByTestId('detail-banner').boundingBox()]);
    expect(l!.y, 'the label is under the note, not on top of it').toBeGreaterThanOrEqual(e!.y + e!.height - 0.5);
    await page.getByTestId('menu').click();
    await page.getByTestId('menu-debug-stats').click();
    await expect(page.getByTestId('debug-stats')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('debug-stats-headline')).toContainText(LABEL);
    await page.getByTestId('debug-group-run').click();
    await expect(page.getByTestId('debug-group-run-body')).toContainText('This device (the run was started again here, from the start, after the desktop connection closed)');
    await expect(page.getByTestId('debug-group-run-body')).toContainText(LABEL);
  });

  test('when this device cannot run the grid, "Continue on this device" says so and offers the standard detail: nothing is lowered or started, and the tap goes to Setup on This device', async ({ page }) => {
    test.setTimeout(240_000);
    // a small device: 0.25 GB (a third of it is what an app can use), whose history still holds 3 km at 10 m
    await openSetup(page, { hash: `#code=${CODE}`, memoryGb: 0.25 });
    await buildOnDesktop(page, { km: 3, level: 'finest' });
    await failLink(page);
    const chip = page.getByTestId('error-chip');
    const go = page.getByTestId('continue-here');
    await expect(go).toBeVisible();
    await expect(chip).toContainText('The desktop connection closed.');
    await expect(chip).toContainText(/This device cannot run the 10\sm grid of this run\./);
    await expect(go).toHaveText('Set up at the standard detail');
    expect(await go.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
    expect(await missedProbes(go), 'a 44 x 44 px hit area').toBe(0);
    // the whole reason is in the chip's tooltip (the chip has two lines)
    expect(await chip.locator('.error-chip-text').getAttribute('title')).toMatch(/needs about [\d.]+\sGB of memory, it reports about 0\.25 GB.*It would not be switched to a coarser grid for you\./);
    // nothing was started: the spare engine is still idle and the run is still the desktop's last picture
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { __firesim: { session: { controller: { standby: unknown } } } }).__firesim.session.controller.standby !== null)).toBe(true);
    await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');
    expect((await session(page)).error).toBe('The desktop connection closed.');
    // the tap: Setup, This device chosen, no detail row, the usual cells
    await go.click();
    await expect(page.getByTestId('setup')).toBeVisible();
    await expect(engineChip(page, 'device').locator('input')).toBeChecked();
    await expect(detailRow(page)).toBeHidden();
    await sizeChip(page, 3).check({ force: true });
    await expect(areaHint(page)).toContainText('30 m cells, 100 × 100 = 10,000 cells');
    await page.getByTestId('build').click();
    await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
    const b = await built(page);
    expect('desktopDetail' in b.options).toBe(false);
    expect(b.cellM).toBe(30);
    await expect(page.getByTestId('detail-banner')).toHaveCount(0);
  });

  test('a level this page cannot keep the pictures of is refused on Setup with a sentence, before anything is built or any link opened', async ({ page }) => {
    test.setTimeout(180_000);
    // 0.25 GB: a history of 48 MiB (50.3 MB), which holds three pictures of 4 MB (3 km at 10 m) and of 16 MB (6 km) but not of 36 MB (9 km)
    await openSetup(page, { hash: `#code=${CODE}`, memoryGb: 0.25 });
    await levelChip(page, 'finest').click();
    await sizeChip(page, 9).check({ force: true });
    // the sentence is on the form as soon as the area is chosen for that level, and Build is refused with it
    const errors = page.locator('.footer-errors');
    await expect(errors).toContainText(/This device cannot keep the pictures of 10\sm cells over 9\skm: each is about 3\d\.\d\sMB and its history has room for about 1 \(50\.3\sMB\)\./);
    await expect(errors).toContainText(/Choose a smaller area or the Finer level\.$/);
    await page.getByTestId('build').click();
    await expect(page.getByTestId('setup')).toBeVisible();
    await expect(errors).toContainText('This device cannot keep the pictures');
    await page.waitForTimeout(500);
    expect((await remoteCalls(page)).filter((c) => c[0] === 'connect')).toEqual([]); // no link was opened for a build that was refused
    expect((await remoteCalls(page)).filter((c) => c[0] === 'init')).toEqual([]);
    // the same device takes 6 km and 3 km at this level (the refusal is for the area, and the person chooses)
    await sizeChip(page, 6).check({ force: true });
    await page.getByTestId('build').click();
    await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
    expect((await built(page)).options).toMatchObject({ desktopDetail: 'finest', fireCellSize: 10 });
    await leaveToSetup(page);
    await engineChip(page, 'desktop').click();
    // the same sizes at Finer (20 m) fit: the refusal is for the level, and the person chooses
    await levelChip(page, 'finer').click();
    await sizeChip(page, 9).check({ force: true });
    await page.getByTestId('build').click();
    await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
    expect((await built(page)).options).toMatchObject({ desktopDetail: 'finer', fireCellSize: 20 });
  });
});

// ───────────────────────────── the real host ─────────────────────────────

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOST_PORT = Number(process.env.DESKTOP_DETAIL_HOST_PORT ?? 4501);
const NAME = 'FireSim detail e2e';
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `node desktop/run.mjs --port 4501 --code ABCD2345 ...` as a child process (it serves the `dist/` of the e2e build); resolves when its banner has been printed. */
async function startHost(): Promise<{ origin: string; stop(): Promise<void> }> {
  const child: ChildProcess = spawn(process.execPath, ['desktop/run.mjs', '--port', String(HOST_PORT), '--code', CODE, '--name', NAME], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  let gone = false;
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => {
      gone = true;
      resolve();
    }),
  );
  child.stdout!.on('data', (d: Buffer) => (text += d));
  child.stderr!.on('data', (d: Buffer) => (text += d));
  const stop = async (): Promise<void> => {
    if (gone) return;
    child.kill('SIGTERM');
    if (!(await Promise.race([exited.then(() => true), pause(10_000).then(() => false)]))) child.kill('SIGKILL');
    await exited;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The host printed no address within 60 s:\n${text}`)), 60_000);
      const done = (): void => {
        if (!/Pairing code: /.test(text)) return;
        clearTimeout(timer);
        resolve();
      };
      child.stdout!.on('data', done);
      void exited.then(() => {
        clearTimeout(timer);
        reject(new Error(`The host ended while starting:\n${text}`));
      });
    });
  } catch (e) {
    await stop();
    throw e;
  }
  return { origin: `http://localhost:${HOST_PORT}`, stop };
}

test.describe('the real host', () => {
  // A machine may send web requests through an HTTP proxy (the CI sandbox does): the browser goes straight to this machine.
  test.use({ actionTimeout: 45_000, proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' } });

  test('Katoomba 3 km at the Finest level computes on the host: 10 m cells, the label, and the wall time and picture sizes of 30 minutes of fire', async ({ page }) => {
    test.setTimeout(600_000);
    const host = await startHost();
    try {
      const t0 = Date.now();
      await page.goto(`${host.origin}/?debug=1#code=${CODE}`);
      await acceptNotice(page);
      await expect(engineChip(page, 'desktop').locator('input')).toBeChecked();
      // the real builder, offline, the Katoomba demo at 3 km, the fast tier (what 15e measured), preset weather
      await page.getByTestId('site-katoomba').click();
      await sizeChip(page, 3).check({ force: true });
      await page.getByTestId('detail').getByRole('radio', { name: /^Fast/ }).check({ force: true });
      await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
      await page.getByTestId('preset-hot-nw-sw-change').click();
      const online = page.getByTestId('online').getByRole('switch');
      if (await online.isChecked()) await page.getByTestId('online').click();
      await levelChip(page, 'finest').click();
      await expect(areaHint(page)).toContainText('10 m cells, 300 × 300 = 90,000 cells, simple 2-D surface wind');
      await page.getByTestId('build').click();
      await expect(page.getByTestId('sim')).toBeVisible({ timeout: 240_000 });
      const built0 = Date.now();

      // the scenario the host was sent: the level, 10 m cells, 8,000 embers; the host's engine says 10 m too
      const b = await built(page);
      expect(b.options).toMatchObject({ desktopDetail: 'finest', fireCellSize: 10, maxEmbers: 8000, tier: 'fast' });
      expect(b).toMatchObject({ cellM: 10, nx: 300, extent: 3000 });
      await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');
      await expect(page.getByTestId('detail-banner')).toContainText(LABEL);

      // a fire on the escarpment, then 30 minutes of fire as fast as the host goes
      await page.evaluate(() => {
        const fs = (window as unknown as { __firesim: { session: { ignite(i: unknown): void; setSpeed(s: number): void; play(): void } } }).__firesim;
        fs.session.ignite({ id: 'fire-a', kind: 'point', points: [[-800, 300]], radius: 60, origin: 'observed' });
        fs.session.setSpeed(Infinity);
        fs.session.play();
      });
      const playedAt = Date.now();
      await expect
        .poll(async () => (await session(page)).headTime, { message: 'the host computes 1800 s of fire', timeout: 480_000, intervals: [1000] })
        .toBeGreaterThanOrEqual(1800);
      const wallS = (Date.now() - playedAt) / 1000;
      await page.evaluate(() => (window as unknown as { __firesim: { session: { pause(): void } } }).__firesim.session.pause());

      const facts = await page.evaluate(() => {
        const fs = (window as unknown as { __firesim: { session: { engineInfo(): { fire: { cellM: number; nx: number }; embers: { max: number }; tier: string; perf?: { speed: { mean: number } } } | null; snapshots: { newestBytes: number; keyframeBytes: number; keyframeCount: number; totalBytes: number; maxBytes: number } } } }).__firesim;
        const e = fs.session.engineInfo()!;
        const s = fs.session.snapshots;
        return { cellM: e.fire.cellM, nx: e.fire.nx, embers: e.embers.max, tier: e.tier, speed: e.perf?.speed.mean ?? null, newest: s.newestBytes, keyframeBytes: s.keyframeBytes, keyframes: s.keyframeCount, total: s.totalBytes, budget: s.maxBytes };
      });
      expect(facts).toMatchObject({ cellM: 10, nx: 300, embers: 8000 });
      expect(facts.newest).toBeGreaterThan(1e6); // a 10 m picture over 3 km is megabytes, not the few hundred kB of 30 m
      console.log(
        `[desktop-detail] real host, Katoomba 3 km, Finest (10 m), tier ${facts.tier}: build ${((built0 - t0) / 1000).toFixed(1)} s from page load; 1800 s of fire in ${wallS.toFixed(1)} s wall (engine mean ${facts.speed?.toFixed(0) ?? 'n/a'}x real time); newest picture ${(facts.newest / 1e6).toFixed(2)} MB, ${facts.keyframes} keyframes ${(facts.keyframeBytes / 1e6).toFixed(1)} MB, history ${(facts.total / 1e6).toFixed(1)} of ${(facts.budget / 1e6).toFixed(0)} MB`,
      );

      // the statistics say so, in the desktop's own words
      await page.getByTestId('menu').click();
      await page.getByTestId('menu-debug-stats').click();
      await expect(page.getByTestId('debug-stats')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('debug-stats-headline')).toContainText(LABEL);
      await page.getByTestId('debug-group-run').click();
      await expect(page.getByTestId('debug-group-run-body')).toContainText('Desktop detail');
      await expect(page.getByTestId('debug-group-run-body')).toContainText(`Desktop ${NAME}`);
      await page.getByTestId('debug-group-grids').click();
      await expect(page.getByTestId('debug-group-grids-body')).toContainText(/300 x 300 cells, 10\sm apart/);
      await page.getByTestId('debug-stats-close').click();
    } finally {
      await host.stop();
    }
  });
});
