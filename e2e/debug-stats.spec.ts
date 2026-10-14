/**
 * "Simulation debug statistics" (src/ui/screens/debugStats.ts, content in src/ui/debugStats.ts) in the browser. Part 1 opens it
 * from Setup, before any run (the run groups say "No run yet", the phone groups are live) and from Settings. Part 2 is the real
 * engine (Katoomba bundled demo data, the 'hot NW wind' preset, offline): the menu row sits directly under Settings; the screen
 * opens from the menu and from Settings while the run is playing and never pauses it; values update in place once a second
 * (the same DOM nodes, new text); Copy puts the whole page on the clipboard as plain text (group titles, a header with a time,
 * an end marker, no coordinates); when the phone refuses the clipboard the text appears in a box to select; Escape and the
 * hardware Back close it and focus returns to the control that opened it; no pop-up, no network call, text at least 14 px and
 * 44 px group headers in the three looks. (The contrast of its colours is checked by `npm run check:contrast`, the stylesheet
 * rules by src/ui/styles.rules.test.ts, the content by src/ui/debugStats.test.ts.)
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, armPopupWatch, popups, session, watchPopups } from './helpers';

const BAD = /\b(undefined|NaN|Infinity|null)\b|\[object/;
const GROUPS = [
  'Summary',
  'Run',
  'Choices',
  'Grids',
  'Speed',
  'Speed history',
  'Step',
  'Worker duty',
  'Where the time goes',
  'Step quality',
  'Embers',
  'Re-runs',
  'Memory',
  'Display (main thread)',
  'Phone: hardware',
  'Phone: software and graphics',
  'What this phone can do',
  'Recent events',
];

const screen = (page: Page) => page.getByTestId('debug-stats');
const norm = (s: string): string => s.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Open every collapsed group. */
async function openAllGroups(page: Page): Promise<void> {
  const toggles = screen(page).locator('.mc-toggle');
  const n = await toggles.count();
  expect(n).toBe(GROUPS.length);
  for (let i = 0; i < n; i++) {
    const t = toggles.nth(i);
    if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
    await expect(t).toHaveAttribute('aria-expanded', 'true');
  }
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
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
}

test('before any run: opens from Setup and from Settings, the run groups say so, the phone groups are live, Escape and Back close it', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();

  // From Setup: next to "How this simulation works".
  const row = page.getByTestId('setup-debug-stats');
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(screen(page)).toBeVisible();
  await expect(screen(page)).toHaveAttribute('role', 'dialog');
  await expect(screen(page)).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByRole('heading', { name: 'Simulation debug statistics', level: 1 })).toBeVisible();
  await expect(page.getByTestId('debug-stats-header')).toContainText('no run yet');
  await expect(page.getByTestId('debug-stats-headline')).toContainText('No run yet');
  await expect(page.getByTestId('debug-stats-state')).toHaveText('No run yet');
  await expect(page.getByTestId('training-badge')).toBeVisible();
  // The groups are the catalogue's, all collapsed at first, each with a line of its own.
  await expect(page.getByTestId('debug-group-summary')).toHaveAttribute('aria-expanded', 'false');
  await expect(screen(page).locator('.mc-toggle-title')).toHaveText(GROUPS);
  await openAllGroups(page);
  await expect(page.getByTestId('debug-group-run-body')).toContainText('No run yet');
  // The phone groups are live even now: the WebGL2 probe and the user agent arrive a moment after opening.
  await expect(page.getByTestId('debug-group-software-body')).toContainText('WebGL2');
  await expect.poll(async () => norm(await page.getByTestId('debug-group-software-body').innerText())).not.toContain('Reading...');
  expect(norm(await page.getByTestId('debug-group-software-body').innerText())).toContain(await page.evaluate(() => navigator.userAgent));
  expect(norm(await screen(page).innerText())).not.toMatch(BAD);
  // Escape closes it and focus returns to the row that opened it.
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveCount(0);
  await expect(row).toBeFocused();

  // From Settings (Data and transparency): Back closes the statistics first, then Settings.
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  const sRow = page.getByTestId('settings-debug-stats');
  await sRow.scrollIntoViewIfNeeded();
  await sRow.click();
  await expect(screen(page)).toBeVisible();
  await page.goBack();
  await expect(screen(page)).toHaveCount(0);
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect(sRow).toBeFocused();
  await page.goBack();
  await expect(page.getByTestId('settings')).toHaveCount(0);

  // One instance only: a second tap while it is open does not stack another.
  await row.click();
  await expect(screen(page)).toBeVisible();
  expect(await screen(page).count()).toBe(1);
  await page.getByTestId('debug-stats-close').click();
  await expect(screen(page)).toHaveCount(0);
  expect(external).toEqual([]);
});

test('on the real engine: the menu row under Settings, live in-place values, Copy as text, the clipboard fallback, Escape and Back', async ({ page }) => {
  test.setTimeout(420_000);
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  await watchPopups(page);
  await buildKatoomba(page);
  await armPopupWatch(page);

  // Mark a fire and play.
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tool-fire').click();
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);
  await expect.poll(async () => (await session(page)).headTime, { timeout: 120_000 }).toBeGreaterThan(300);

  // The row sits directly under Settings in the main menu.
  const menu = page.getByTestId('menu');
  await menu.click();
  const ids = await page.locator('ul[aria-label="App"] [role=menuitem]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(ids).toEqual(['menu-settings', 'menu-debug-stats', 'menu-new']);
  await expect(page.getByTestId('menu-debug-stats')).toContainText('Simulation debug statistics');
  await expect(page.getByTestId('menu-debug-stats')).toContainText('Speed, memory and what this phone can do');

  // Open it while the run plays: it never pauses it.
  const t0 = (await session(page)).viewTime;
  await page.getByTestId('menu-debug-stats').click();
  await expect(screen(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('debug-stats-header')).toContainText('run ');
  await expect(page.getByTestId('debug-stats-header')).toContainText(/seed \d+/);
  await expect(page.getByTestId('debug-stats-headline')).toContainText(/Fast \(surface wind\)|Standard \(3-D air\)|High \(finer 3-D air\)/);
  await expect(page.getByTestId('debug-stats-headline')).toContainText('this phone:');
  await expect(page.getByTestId('debug-stats-header')).not.toContainText('paused');
  await expect(page.getByTestId('debug-stats-state')).toHaveText('Live');
  await openAllGroups(page);
  // The place is a bundled site, named; nothing else identifies it.
  await expect(page.getByTestId('debug-group-run-body')).toContainText('Katoomba');
  expect(norm(await screen(page).innerText())).not.toMatch(BAD);

  // Live: the run clock moves, in the same DOM node (patched in place, no rebuild).
  const clock = page.locator('[data-testid=debug-group-run-body] [data-row=clock] .mc-fact-value');
  await clock.evaluate((el) => ((el as HTMLElement).dataset.mark = 'same'));
  const c0 = norm(await clock.innerText());
  await expect.poll(async () => norm(await clock.innerText()), { timeout: 30_000 }).not.toBe(c0);
  await expect(clock).toHaveAttribute('data-mark', 'same');
  const s1 = await session(page);
  expect(s1.playing).toBe(true);
  expect(s1.viewTime).toBeGreaterThan(t0);
  // Steps taken keep growing too.
  const steps = page.locator('[data-testid=debug-group-step-body] [data-row=steps] .mc-fact-value');
  const n0 = Number(norm(await steps.innerText()));
  await expect.poll(async () => Number(norm(await steps.innerText())), { timeout: 60_000 }).toBeGreaterThan(n0);

  // The phone groups finish reading; the graphics probe works in the test browser (SwiftShader).
  await expect.poll(async () => norm(await page.getByTestId('debug-group-software-body').innerText()), { timeout: 20_000 }).not.toContain('Reading...');
  await expect(page.getByTestId('debug-group-software-body').locator('[data-row=webgl2] .mc-fact-value')).toHaveText('Yes');
  await expect(page.getByTestId('debug-group-hardware-body').locator('[data-row=cores] .mc-fact-value')).toHaveText(/^\d+$/);
  // The frame statistics: the view drew before the screen opened, so there are numbers.
  await expect(page.getByTestId('debug-group-display-body').locator('[data-row=draw-calls] .mc-fact-value')).toHaveText(/^\d+ and \d+$/);
  await expect(page.getByTestId('debug-group-display-body').locator('[data-row=picture-quality] .mc-fact-value')).toHaveText(/^(Low|Medium|High) \(/);

  // Copy as text.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('debug-stats-copy').click();
  await expect(page.getByTestId('debug-stats-status')).toContainText('Copied: these statistics as text, ready to paste.');
  await expect(page.getByTestId('debug-stats-fallback')).toBeHidden();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const lines = clip.split('\n');
  expect(lines[0]).toBe('FireSim: Simulation debug statistics');
  expect(lines[1]).toMatch(/^Copied \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(UTC([+-]\d+(:\d+)?)?\) \| app \S+ \(build \S+, \w+\) \| run \d{2}:\d{2}:\d{2} \| seed \d+$/);
  for (const g of GROUPS) expect(lines, g).toContain(`== ${g} ==`);
  expect(lines[lines.length - 1]).toBe('-- end --');
  expect(clip).toContain('Katoomba');
  expect(clip).toContain(await page.evaluate(() => navigator.userAgent));
  expect(clip).not.toMatch(BAD);
  // No coordinates (the user agent's version numbers are the only long decimals), no links.
  expect(clip.split('\n').filter((l) => !l.includes('User agent')).join('\n').replace(/\d+(\.\d+){3}/g, 'version')).not.toMatch(/-?\d{1,3}\.\d{3,}/);
  expect(clip).not.toMatch(/33\.7|150\.2|https?:\/\//);
  // Copying changed nothing: the run still plays.
  expect((await session(page)).playing).toBe(true);

  // The icon in the app bar does the same.
  await page.getByTestId('debug-stats-copy-icon').click();
  await expect(page.getByTestId('debug-stats-status')).toContainText('Copied');

  // A phone that refuses the clipboard: the text appears in a box to touch and hold.
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { value: () => Promise.reject(new Error('denied')), configurable: true });
    document.execCommand = () => false;
  });
  await page.getByTestId('debug-stats-copy').click();
  const box = page.getByTestId('debug-stats-fallback');
  await expect(box).toBeVisible();
  await expect(page.getByTestId('debug-stats-status')).toContainText('Touch and hold to select, then Copy.');
  const boxText = await box.inputValue();
  expect(boxText.startsWith('FireSim: Simulation debug statistics')).toBe(true);
  expect(boxText.endsWith('-- end --')).toBe(true);

  // The three looks: text of at least 14 px and group headers of at least 44 px (the colours are checked by check:contrast).
  for (const look of ['light', 'dark', 'high-contrast'] as const) {
    await page.evaluate((l) => {
      const r = document.documentElement;
      r.dataset.theme = l === 'dark' ? 'dark' : 'light';
      if (l === 'high-contrast') r.dataset.contrast = 'high';
      else delete r.dataset.contrast;
    }, look);
    const small = await screen(page).evaluate((root) => {
      const bad: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>('*')) {
        if (el.closest('svg') || el.closest('[hidden]')) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
        if (own && parseFloat(getComputedStyle(el).fontSize) < 14 - 0.01) bad.push(`${el.className || el.tagName}: ${getComputedStyle(el).fontSize}`);
      }
      return bad;
    });
    expect(small, look).toEqual([]);
    const heights = await screen(page).locator('.mc-toggle').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const hgt of heights) expect(hgt, look).toBeGreaterThanOrEqual(44);
    for (const id of ['debug-stats-close', 'debug-stats-copy-icon']) {
      const b = await page.getByTestId(id).boundingBox();
      expect(b!.width, `${look} ${id}`).toBeGreaterThanOrEqual(44);
      expect(b!.height, `${look} ${id}`).toBeGreaterThanOrEqual(44);
    }
  }
  await page.evaluate(() => {
    const r = document.documentElement;
    r.dataset.theme = 'light';
    delete r.dataset.contrast;
  });

  // Escape closes it; the run is still playing and focus is back on the menu button.
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveCount(0);
  await expect(page.getByTestId('sim')).toBeVisible();
  await expect(menu).toBeFocused();
  expect((await session(page)).playing).toBe(true);

  // Opened again, the hardware Back (history back) closes it, then nothing else of the simulation was touched.
  await menu.click();
  await page.getByTestId('menu-debug-stats').click();
  await expect(screen(page)).toBeVisible();
  await page.goBack();
  await expect(screen(page)).toHaveCount(0);
  await expect(page.getByTestId('sim')).toBeVisible();
  await expect(menu).toBeFocused();

  // From Settings (opened from the menu) while the run plays.
  await menu.click();
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  const sRow = page.getByTestId('settings-debug-stats');
  await sRow.scrollIntoViewIfNeeded();
  await sRow.click();
  await expect(screen(page)).toBeVisible();
  await expect(page.getByTestId('debug-stats-header')).toContainText('run ');
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveCount(0);
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings')).toHaveCount(0);

  // Paused: the header says so.
  await page.evaluate(() => (window as unknown as { __firesim: { session: { pause(): void } } }).__firesim.session.pause());
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  await menu.click();
  await page.getByTestId('menu-debug-stats').click();
  await expect(screen(page)).toBeVisible();
  await expect(page.getByTestId('debug-stats-header')).toContainText('(paused)');
  await expect(page.getByTestId('debug-stats-state')).toHaveText('Paused');
  await page.getByTestId('debug-stats-close').click();
  await expect(screen(page)).toHaveCount(0);

  expect(await popups(page)).toEqual([]);
  expect(external).toEqual([]);
});
