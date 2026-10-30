/**
 * The speed test button (0.7.0, item C; docs/plans/0.7.0/D-CONTRACT-070-raster.md section 5), in the real app (offline, the Katoomba demo, the real engine, Pixel 7
 * profile): the button under "What this phone can do" in the debug statistics.
 *   - from Setup, before any run: a press runs the two frozen kernels in a throwaway worker for about two seconds, the row then holds both numbers and their ratio to
 *     the build machine, the status line says so, and the copied text has the row;
 *   - it is off, with its reason, while a run plays and while the engine is still computing, and on again once the run is paused and the engine has caught up;
 *   - closing the screen mid-test terminates the worker and shows nothing; the app going to the background stops it; no pop-up or alert; a 44 px hit area;
 *   - it never changes a result: a run paused part way, tested, and played on has exactly the snapshots of a run that was never tested (the engine's own hash).
 * The kernels' numbers are checked by src/ui/speedTest.test.ts, the words by speedTestModel.test.ts, the import fence by speedTest.deps.test.ts.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, armPopupWatch, pickTool, popups, scenarioDuration, session, setSpeed, watchPopups } from './helpers';

const BAD = /\b(undefined|NaN|Infinity|null)\b|\[object/;
const screen = (page: Page) => page.getByTestId('debug-stats');
const button = (page: Page) => page.getByTestId('speed-test');
const status = (page: Page) => page.getByTestId('speed-test-status');
const row = (page: Page) => page.locator('[data-testid=debug-group-canDo-body] [data-row=speed-test] .mc-fact-value');
const norm = (s: string): string => s.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Remember every Worker that is made and every one that is terminated, so a test can see that the speed test ran off the main thread and was stopped. */
async function watchWorkers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __workers: string[]; __terminated: number };
    w.__workers = [];
    w.__terminated = 0;
    const Real = window.Worker;
    window.Worker = class extends Real {
      constructor(url: string | URL, o?: WorkerOptions) {
        super(url, o);
        w.__workers.push(String(url));
      }
      override terminate(): void {
        w.__terminated++;
        super.terminate();
      }
    } as typeof Worker;
  });
}
const workers = (page: Page): Promise<{ made: string[]; terminated: number }> =>
  page.evaluate(() => {
    const w = window as unknown as { __workers: string[]; __terminated: number };
    return { made: [...w.__workers], terminated: w.__terminated };
  });

async function openFromSetup(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  const open = page.getByTestId('setup-debug-stats');
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await expect(screen(page)).toBeVisible();
  await openGroup(page);
}

/** Open "What this phone can do" and bring the button into view. */
async function openGroup(page: Page): Promise<void> {
  const toggle = page.getByTestId('debug-group-canDo');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await button(page).scrollIntoViewIfNeeded();
}

/** The repo's tap rule on one button (scripts/audit-tap-targets.mjs): the eight points round its centre, 21 px out and 15 px out, all land on it. */
async function missedProbes(page: Page, testId: string): Promise<number> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const probes = [[-21, 0], [21, 0], [0, -21], [0, 21], [-15, -15], [15, 15], [-15, 15], [15, -15]];
    return probes.filter(([dx, dy]) => {
      const hit = document.elementFromPoint(cx + dx!, cy + dy!);
      return !(hit && (el === hit || el.contains(hit)));
    }).length;
  }, testId);
}

test('from Setup: about two seconds in a worker, both numbers with their ratio to the build machine, the same in the copied text, nothing pops up', async ({ page }) => {
  test.setTimeout(180_000);
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  await watchPopups(page);
  await watchWorkers(page);
  await openFromSetup(page);
  await armPopupWatch(page);

  // Before the first press: the words, an enabled button, nothing in the status line.
  await expect(row(page)).toHaveText('Not run yet. Takes about 2 seconds.');
  await expect(button(page)).toBeEnabled();
  await expect(button(page)).toHaveText('Run the speed test');
  await expect(status(page)).toHaveAttribute('aria-live', 'polite');
  await expect(status(page)).toHaveText('');
  expect(await page.locator('[role=alert]').count(), 'no role=alert anywhere').toBe(0);
  // A standard button: 40 px drawn, a 44 x 44 hit area (the eight probes of the repo's tap audit land on it).
  expect((await button(page).boundingBox())!.height).toBeGreaterThanOrEqual(40);
  expect(await missedProbes(page, 'speed-test'), 'a 44 x 44 px hit area').toBe(0);

  // The press: busy and off for about two seconds, then a result.
  const t0 = Date.now();
  await button(page).click();
  await expect(status(page)).toHaveText('Testing, about 2 seconds.');
  await expect(button(page)).toBeDisabled();
  await expect(button(page)).toHaveAttribute('aria-busy', 'true');
  await expect(row(page)).toHaveText('Testing, about 2 seconds.');
  await expect(status(page)).toContainText('Done', { timeout: 60_000 });
  const took = Date.now() - t0;
  expect(took, `the test took ${took} ms: about two seconds`).toBeGreaterThan(1800);
  expect(took, `the test took ${took} ms`).toBeLessThan(30_000);
  await expect(button(page)).toBeEnabled();
  await expect(button(page)).toHaveAttribute('aria-busy', 'false');

  // The row: both kernels, each against the build machine, the version and a clock time, and what the number is not.
  const result = norm(await row(page).innerText());
  expect(result).toMatch(/^Air kernel [\d.]+ million cell updates a second \((about [\d.]+ times (slower|faster) than the build machine|about as fast as the build machine)\)\./);
  expect(result).toMatch(/Memory copy [\d.]+ GB a second \(about /);
  expect(result).toMatch(/Test version 1, \d\d:\d\d\./);
  expect(result).toContain('does not predict a run');
  expect(result).not.toMatch(BAD);
  expect(result).not.toMatch(/[\u2013\u2014]/);
  expect(norm(await status(page).innerText())).toMatch(/^Done: (about [\d.]+ times (slower|faster) than the build machine|about as fast as the build machine) on the air kernel\.$/);

  // It ran in a worker of its own (not the simulation's: there is no run), and the worker was let go.
  const w = await workers(page);
  expect(w.made.filter((u) => /speedTest/.test(u)).length, `workers made: ${w.made.join(', ')}`).toBe(1);
  expect(w.terminated, 'the throwaway worker was terminated').toBeGreaterThanOrEqual(1);

  // A second press works (two runs are what the words ask for), and the copied text carries the row.
  await button(page).click();
  await expect(status(page)).toHaveText('Testing, about 2 seconds.');
  await expect(status(page)).toContainText('Done', { timeout: 60_000 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('debug-stats-copy').click();
  await expect(page.getByTestId('debug-stats-status')).toContainText('Copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toMatch(/\n {2}Speed test: Air kernel [\d.]+ million cell updates a second \(about /);
  expect(clip).toContain('== What this phone can do ==');
  expect(clip).not.toMatch(BAD);

  expect(await popups(page), 'nothing pops up by itself').toEqual([]);
  expect(await page.locator('[role=alert]').count()).toBe(0);
  expect(external, 'no network call').toEqual([]);
});

/** Build Katoomba on the fast tier with the shortest run (1 h), the real engine, and mark a fire at the crosshair. */
async function buildFast1h(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('detail').getByRole('radio', { name: /Fast/ }).check({ force: true });
  await page.getByTestId('duration').getByRole('radio', { name: /^1 h/ }).check({ force: true });
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await page.waitForTimeout(2500); // the camera finishes its fly-in: the crosshair marks the same spot every time
  await pickTool(page, 'fire');
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await expect(page.getByTestId('fire-panel')).toHaveCount(0);
}

const computing = (page: Page): Promise<boolean> => page.evaluate(() => (window as unknown as { __firesim: { session: { state: { get(): { computing: boolean } } } } }).__firesim.session.state.get().computing);

async function openStatsFromMenu(page: Page): Promise<void> {
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-debug-stats').click();
  await expect(screen(page)).toBeVisible({ timeout: 30_000 });
  await openGroup(page);
}

test('while a run plays or the engine computes the button is off with its reason, and it is on again once the run is paused and the engine has caught up', async ({ page }) => {
  test.setTimeout(420_000);
  await watchPopups(page);
  await watchWorkers(page);
  await buildFast1h(page);
  await armPopupWatch(page);

  await setSpeed(page, 60);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 120_000 }).toBeGreaterThan(120);

  // Playing: off, and the status line says why.
  await openStatsFromMenu(page);
  await expect(button(page)).toBeDisabled();
  await expect(status(page)).toHaveText('Pause first so the test is fair.');
  await expect(row(page)).toHaveText('Not run yet. Takes about 2 seconds.');
  await button(page).click({ force: true }); // (a press on a disabled button does nothing)
  await expect(status(page)).toHaveText('Pause first so the test is fair.');
  expect((await workers(page)).made.filter((u) => /speedTest/.test(u)), 'no test worker was made').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveCount(0);
  expect((await session(page)).playing, 'looking at it never paused the run').toBe(true);

  // Paused: the first reason is gone. While the worker is still computing ahead the status gives its own reason; once it has caught up the button is on.
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  await openStatsFromMenu(page);
  await expect(status(page)).not.toHaveText('Pause first so the test is fair.');
  await expect.poll(() => computing(page), { timeout: 240_000, intervals: [500] }).toBe(false);
  await expect(button(page)).toBeEnabled({ timeout: 10_000 });
  await expect(status(page)).toHaveText('');

  // Paused and caught up: it runs.
  await button(page).click();
  await expect(status(page)).toHaveText('Testing, about 2 seconds.');
  await expect(status(page)).toContainText('Done', { timeout: 60_000 });
  await expect(row(page)).toContainText('Air kernel');
  expect((await session(page)).playing, 'the test never started the run').toBe(false);
  expect(await popups(page), 'nothing pops up by itself').toEqual([]);
});

test('closing the screen mid-test stops it and shows nothing; the app going to the background stops it; a stopped test leaves the button ready', async ({ page }) => {
  test.setTimeout(180_000);
  await watchPopups(page);
  await watchWorkers(page);
  await openFromSetup(page);
  await armPopupWatch(page);

  // Closed mid-test: the worker is terminated, no result is kept, and nothing pops up.
  await button(page).click();
  await expect(status(page)).toHaveText('Testing, about 2 seconds.');
  const before = (await workers(page)).terminated;
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveCount(0);
  await expect.poll(async () => (await workers(page)).terminated, { message: 'the worker was terminated when the screen closed' }).toBeGreaterThan(before);
  await page.waitForTimeout(2500); // longer than the test: a late result would have nowhere to go
  expect(await popups(page)).toEqual([]);
  expect(await page.locator('[role=alert]').count()).toBe(0);

  // Opened again: a fresh screen, nothing remembered, and the button works.
  await page.getByTestId('setup-debug-stats').click();
  await expect(screen(page)).toBeVisible();
  await openGroup(page);
  await expect(row(page)).toHaveText('Not run yet. Takes about 2 seconds.');
  await expect(button(page)).toBeEnabled();

  // The app goes to the background mid-test (the page's own visibility, as the WebView reports it): the test stops and the button is off while it is hidden.
  const hide = (hidden: boolean): Promise<void> =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { value: h, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await button(page).click();
  await expect(status(page)).toHaveText('Testing, about 2 seconds.');
  await hide(true);
  await expect(button(page)).toBeDisabled();
  await expect(row(page)).not.toContainText('Air kernel'); // (no result came of the stopped test)
  await hide(false);
  await expect(status(page)).toHaveText('The test was stopped. Run it again when you are ready.', { timeout: 10_000 });
  await expect(row(page)).toHaveText('Not run yet. Takes about 2 seconds.');
  await expect(button(page)).toBeEnabled();
  expect(await popups(page), 'nothing pops up by itself').toEqual([]);

  // And a test run after that is a whole one.
  await button(page).click();
  await expect(status(page)).toContainText('Done', { timeout: 60_000 });
  await expect(status(page)).not.toContainText('stopped');
});

// ───────────── the speed test never changes a result ─────────────

/** FNV-1a over the bytes of every typed array and the JSON of the rest (the engine's snapshotHash, in the page; as e2e/robustness.spec.ts). */
const HASH_SOURCE = `(() => {
  function fnv(h, bytes) { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; } return h; }
  function hv(h, v, skip, path) {
    if (ArrayBuffer.isView(v)) return fnv(h, new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    if (v === null || typeof v !== 'object') return fnv(h, new TextEncoder().encode(path + '=' + (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : JSON.stringify(v)) + ';'));
    if (Array.isArray(v)) { v.forEach((x, i) => (h = hv(h, x, skip, path + '[' + i + ']'))); return h; }
    for (const k of Object.keys(v).sort()) { const p = path ? path + '.' + k : k; if (skip.has(p)) continue; h = hv(h, v[k], skip, p); }
    return h;
  }
  return (s) => {
    const skip = new Set(['stats.msPerSimMinute', 'engine', 'layers.landing']);
    return { all: hv(0x811c9dc5, s, skip, ''), arrival: hv(0x811c9dc5, s.fire.arrivalTime, new Set(), ''), burntHa: s.stats.burntAreaHa, spots: s.stats.spotFires };
  };
})()`;

interface Fingerprint {
  tier: string;
  at: Record<string, { all: number; arrival: number; burntHa: number; spots: number }>;
}

const fingerprint = (page: Page, times: number[]): Promise<Fingerprint> =>
  page.evaluate(
    ([src, ts]) => {
      // eslint-disable-next-line no-eval
      const hash = (0, eval)(src as string) as (s: unknown) => { all: number; arrival: number; burntHa: number; spots: number };
      const fs = (window as unknown as { __firesim: { session: { state: { get(): { snapshot: { engine: { tier: string } } | null } }; snapshots: { at(t: number): unknown } } } }).__firesim;
      const at: Fingerprint['at'] = {};
      for (const t of ts as number[]) at[String(t)] = hash(fs.session.snapshots.at(t));
      return { tier: fs.session.state.get().snapshot?.engine.tier ?? '?', at };
    },
    [HASH_SOURCE, times] as const,
  );

/** One run: build, play at 600 x to 10 minutes, pause, let the engine catch up, (optionally run the speed test), play on at Max to the end, and fingerprint the history. */
async function runAndFingerprint(page: Page, withTest: boolean): Promise<Fingerprint> {
  await buildFast1h(page);
  const D = await scenarioDuration(page);
  expect(D).toBe(3600);
  await setSpeed(page, 600);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 180_000 }).toBeGreaterThan(600);
  await page.getByTestId('play').click(); // pause
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  await expect.poll(() => computing(page), { timeout: 240_000, intervals: [500] }).toBe(false);
  if (withTest) {
    await openStatsFromMenu(page);
    await expect(button(page)).toBeEnabled();
    await button(page).click();
    await expect(status(page)).toContainText('Done', { timeout: 60_000 });
    await page.keyboard.press('Escape');
    await expect(screen(page)).toHaveCount(0);
  }
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();
  await expect
    .poll(async () => {
      const s = await session(page);
      return !s.playing && s.seekTarget === null && s.viewTime >= D - 1;
    }, { timeout: 300_000, intervals: [1000] })
    .toBe(true);
  return fingerprint(page, [900, 1800, 2700, 3600]);
}

test('a run paused part way, tested, and played on has exactly the snapshots of a run that was never tested', async ({ page }) => {
  test.setTimeout(900_000);
  const untested = await runAndFingerprint(page, false);
  const tested = await runAndFingerprint(page, true);
  expect(tested.tier).toBe(untested.tier);
  expect(untested.at['3600']!.burntHa, 'the fire burnt something, so the hashes say something').toBeGreaterThan(0);
  for (const t of Object.keys(untested.at)) {
    const a = untested.at[t]!;
    const b = tested.at[t]!;
    expect(b.arrival, `arrival raster at ${t} s`).toBe(a.arrival);
    expect(b.burntHa, `burnt area at ${t} s`).toBe(a.burntHa);
    expect(b.spots, `spot fires at ${t} s`).toBe(a.spots);
    expect(b.all, `every other part of the snapshot at ${t} s`).toBe(a.all);
  }
});
