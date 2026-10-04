/**
 * The Data sets screen (src/ui/screens/datasets.ts) in the browser, on the mock engine (?mock=1, which carries an honest
 * mock inventory): summary, filter and sort, the detail page, copies confirmed inline (never a pop-up), Escape and Back
 * stepping back one level at a time, "Show on map", and the run carrying on underneath without being paused.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, armPopupWatch, popups, session, watchPopups } from './helpers';

async function buildMock(page: Page): Promise<void> {
  await page.goto('/?mock=1&debug=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
}

async function openDatasets(page: Page, id?: string): Promise<void> {
  await page.evaluate((i) => (window as unknown as { __firesim: { app: { openDatasets(id?: string): void } } }).__firesim.app.openDatasets(i), id);
  await expect(page.getByTestId('datasets-screen')).toBeVisible();
}

const inventory = (page: Page): Promise<{ n: number; ids: string[]; titles: string[] }> =>
  page.evaluate(() => {
    const s = (window as unknown as { __firesim: { scenario: { datasets?: { id: string; title: string }[] } } }).__firesim.scenario;
    const ds = s.datasets ?? [];
    return { n: ds.length, ids: ds.map((d) => d.id), titles: ds.map((d) => d.title) };
  });

test('data sets: summary, filters, sort, detail, copy, Escape / Back one level at a time, the run keeps going', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await watchPopups(page);
  await buildMock(page);
  await armPopupWatch(page);
  const inv = await inventory(page);
  expect(inv.n).toBeGreaterThan(5);

  // Play, then open the screen: it never pauses the run.
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);
  await openDatasets(page);
  const screen = page.getByTestId('datasets-screen');
  await expect(page.getByTestId('training-badge')).toBeVisible();

  // Summary: the count is the inventory's; the origin mix and the model are there.
  await expect(screen.getByTestId('datasets-totals').locator('[data-stat=count] .stat-num')).toHaveText(String(inv.n));
  await expect(screen.getByTestId('origin-mix')).toBeVisible();
  await expect(screen.getByTestId('datasets-summary')).toContainText('Fire grid');
  // No broken values anywhere on the screen.
  expect(await screen.innerText()).not.toMatch(/\b(undefined|NaN|Infinity)\b/);

  // One row per data set.
  await expect(screen.locator('[data-testid^=dataset-row-]')).toHaveCount(inv.n);
  // Filter: Terrain.
  await screen.getByTestId('datasets-filters').getByRole('radio', { name: /^Terrain/ }).check({ force: true });
  await expect(screen.locator('[data-testid^=dataset-row-]')).not.toHaveCount(inv.n);
  await expect(screen.getByTestId('dataset-row-terrain')).toBeVisible();
  await screen.getByTestId('datasets-filters').getByRole('radio', { name: /^All/ }).check({ force: true });
  await expect(screen.locator('[data-testid^=dataset-row-]')).toHaveCount(inv.n);

  // Sort by name (a menu; Escape closes the menu first, not the screen).
  await screen.getByTestId('datasets-sort').click();
  await expect(screen.getByTestId('datasets-sort-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(screen.getByTestId('datasets-sort-menu')).toBeHidden();
  await expect(screen).toBeVisible();
  await screen.getByTestId('datasets-sort').click();
  await screen.getByTestId('datasets-sort-menu').locator('[data-sort=name]').click();
  const titles = await screen.locator('[data-testid^=dataset-row-] .list-title').allInnerTexts();
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, 'en')));

  // Detail page of the terrain.
  await screen.getByTestId('dataset-row-terrain').click();
  const detail = page.getByTestId('dataset-detail');
  await expect(detail).toBeVisible();
  for (const id of ['dataset-identity', 'dataset-source', 'dataset-space', 'dataset-size', 'dataset-trust', 'dataset-copy']) await expect(detail.getByTestId(id)).toBeVisible();
  expect(await detail.innerText()).not.toMatch(/\b(undefined|NaN|Infinity)\b/);

  // Copy details: the text lands on the clipboard and an inline line confirms it (no pop-up).
  await detail.getByTestId('copy-details').click();
  await expect(detail.getByTestId('detail-copy-status')).toContainText('Copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('Ground height');
  // Copy a licence link: copied, then "Open" is offered (it asks first).
  const link = detail.getByTestId('copy-link-licence');
  if (await link.count()) {
    await link.click();
    await expect(detail.getByTestId('open-licence')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^https:\/\//);
  }

  // Escape: detail → list; Escape again: the screen closes; the run is still playing.
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(screen.getByTestId('datasets-list-page')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);
  await expect(page.getByTestId('sim')).toBeVisible();
  expect((await session(page)).playing).toBe(true);

  // Back (Android hardware Back = history back): detail → list → closed, and the simulation stays.
  await openDatasets(page, 'terrain');
  await expect(page.getByTestId('dataset-detail')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('dataset-detail')).toBeHidden();
  await expect(page.getByTestId('datasets-screen')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('datasets-screen')).toHaveCount(0);
  await expect(page.getByTestId('sim')).toBeVisible();

  // CSV of the whole inventory from the list page.
  await openDatasets(page);
  await page.getByTestId('datasets-export').getByTestId('copy-csv').click();
  await expect(page.getByTestId('export-status')).toContainText('Copied');
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(inv.n + 1);

  // Show on map: the screen closes and the map shows the layer.
  await page.getByTestId('dataset-row-terrain').click();
  await page.getByTestId('dataset-detail').getByTestId('show-on-map').click();
  await expect(page.getByTestId('datasets-screen')).toHaveCount(0);
  const overlay = await page.evaluate(() => (window as unknown as { __firesim: { view: { layers?: { overlay?: string } } } }).__firesim.view.layers?.overlay ?? null);
  if (overlay !== null) expect(overlay).toBe('elevation');
  expect((await session(page)).playing).toBe(true);

  expect(await popups(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('data sets before a run: the plan of the Setup form, and what is on this phone', async ({ page }) => {
  await page.goto('/?mock=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('open-datasets').click();
  const screen = page.getByTestId('datasets-screen');
  await expect(screen).toBeVisible();
  await expect(screen.getByTestId('storage-headline')).toContainText('bundled with the app', { timeout: 15_000 });
  // The App passes the Setup form, so the screen shows what Build would fetch, with estimated sizes marked ≈.
  await expect(screen.getByTestId('datasets-summary')).toContainText('Planned data for this run', { timeout: 15_000 });
  await expect(screen.locator('[data-testid^=dataset-row-]').first()).toBeVisible();
  await expect(screen.getByTestId('datasets-list')).toContainText('≈');
  expect(await screen.innerText()).not.toMatch(/\b(undefined|NaN|Infinity)\b/);
  await page.getByTestId('datasets-close').click();
  await expect(screen).toHaveCount(0);
  await expect(page.getByTestId('build')).toBeVisible();
});
