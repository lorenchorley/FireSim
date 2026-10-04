/**
 * End-to-end test of the whole app with the REAL modules (scenario builder on the bundled Katoomba demo data,
 * simulation in its Web Worker, Three.js view) against the production build on the Pixel 7 profile:
 *   notice → Katoomba demo → preset weather → build → mark a fire on the Megalong escarpment (Tools menu) → play at the
 *   highest speed → the fire grows, insight cards wait in the dock, nothing pops up and playback never stops by itself →
 *   "Why here?" explains → arrival overlay → jump back in time → a fuel brush edit and a spot fire in the past → play on →
 *   a jump far beyond the computed range (its progress on the timeline) that is cancelled, then an exact jump.
 * Screenshots of the main views go to docs/screenshots/ (README). `?debug=1` exposes window.__firesim, used only to
 * read the session state and to aim the camera at the escarpment (the fire is then marked with the UI's crosshair).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { mkdirSync } from 'node:fs';
import {
  acceptNotice,
  animationsDone,
  armPopupWatch,
  composeSideBySide,
  expectStillPlaying,
  jumpWithPopover,
  openMenu,
  pickTool,
  pickViewMode,
  popups,
  scenarioDuration,
  session,
  setDock,
  setSpeed,
  tapTimeline,
  viewMenuAction,
  waitForSeekEnd,
  watchPopups,
  zoomView,
  type SessionView,
} from './helpers';

const SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });

/** The escarpment ignition of the headless validation (src/sim/validation.test.ts): 688 m, 23° slope. */
const ESCARPMENT: [number, number] = [-2170, 900];

/**
 * Play until the view time reaches `t` (s). Play is pressed once (when it is not already playing); after that the run must
 * keep going by itself - no card, however dangerous, may stop it - so a stop before `t` fails the test.
 */
async function playUntil(page: Page, t: number, duration: number, timeoutMs = 150_000): Promise<SessionView> {
  if (!(await session(page)).playing) await page.getByTestId('play').click();
  const end = Date.now() + timeoutMs;
  for (;;) {
    const s = await expectStillPlaying(page, duration);
    if (s.viewTime >= t) return s;
    if (Date.now() > end) throw new Error(`timed out at view time ${s.viewTime} s (head ${s.headTime} s)`);
    await page.waitForTimeout(500);
  }
}

async function pause(page: Page): Promise<void> {
  if ((await session(page)).playing) await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(false);
}

async function shot(page: Page, name: string): Promise<void> {
  // Let the camera flight, the sheet and the panel animations settle.
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function flyTo(page: Page, x: number, y: number, distance: number): Promise<void> {
  await page.evaluate(([px, py, d]) => (window as unknown as { __firesim: { view: { flyTo(x: number, y: number, d: number): void } } }).__firesim.view.flyTo(px, py, d), [x, y, distance] as const);
  await page.waitForTimeout(1500);
}

test('real engine end to end: build → escarpment fire → play → insights → why here → overlays → rewind → edits', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  const fallbacks: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning' && /using the mock|2-D map instead|imagery load failed/.test(m.text())) fallbacks.push(m.text());
  });
  await watchPopups(page);

  // ── Setup ──
  await page.goto('/?debug=1');
  await expect(page.getByTestId('training-badge')).toBeVisible();
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  await expect(page.getByTestId('preset-hot-nw-sw-change')).toHaveAttribute('aria-checked', 'true');
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click(); // fully offline: bundled demo data only
  await page.getByTestId('weather-source').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await shot(page, '01-setup');
  await expect(page.getByTestId('preset-hot-nw-sw-change')).toContainText('Starts');
  const buildStart = Date.now();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('building')).toBeVisible();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  test.info().annotations.push({ type: 'build', description: `${Date.now() - buildStart} ms to the simulation screen` });
  await expect(page.locator('.mock-banner')).toHaveCount(0); // the real engine and 3-D view, not the mocks
  await expect(page.getByTestId('clock')).toHaveText(/12:00/); // the preset's canonical start, 20 Dec 11:00 LMST
  await armPopupWatch(page); // from here on nothing may pop up over the simulation
  const D = await scenarioDuration(page);

  // ── The chrome starts collapsed: two round buttons, the dock's tab row, the timeline; no Live button ──
  await expect(page.getByTestId('tools-menu')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('view-menu')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('dock')).toHaveAttribute('data-detent', 'closed');
  await expect(page.getByTestId('live')).toHaveCount(0);

  // ── Mark the fire on the escarpment with the crosshair ──
  await pickTool(page, 'fire');
  await expect(page.getByTestId('fire-panel')).toBeVisible();
  await flyTo(page, ESCARPMENT[0], ESCARPMENT[1], 2500);
  await page.getByTestId('use-crosshair').click();
  await expect(page.getByTestId('confirm-fire')).toBeInViewport();
  const marked = await page.evaluate(() => {
    const fs = (window as unknown as { __firesim: { view: { projectToScreen(x: number, y: number): [number, number] | null } } }).__firesim;
    return fs.view.projectToScreen(-2170, 900);
  });
  expect(marked).not.toBeNull();
  await shot(page, '02-mark-fire');
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  // The view centres fly-to targets in the map area above the open panel, where the crosshair is: the mark lands on
  // the escarpment point the camera flew to.
  const mark = await page.evaluate(() => (window as unknown as { __firesim: { session: { state: { get(): { ignitions: { points: [number, number][] }[] } } } } }).__firesim.session.state.get().ignitions[0]!.points[0]!);
  expect(Math.hypot(mark[0] - ESCARPMENT[0], mark[1] - ESCARPMENT[1])).toBeLessThan(120);
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();

  // ── Play as fast as possible: the fire grows, cards appear ──
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();
  const at1h = await playUntil(page, 3600, D);
  const at2h = await playUntil(page, 7200, D);
  expect(at1h.area).toBeGreaterThan(5);
  expect(at2h.area).toBeGreaterThan(at1h.area * 1.3);
  await pause(page);
  // The speed options, open (for the README): presets from slow motion to an hour per second, a slider, a custom value.
  await page.getByTestId('speed').click();
  await expect(page.getByTestId('speed-popover')).toBeVisible();
  await shot(page, '11-speed-popover');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('speed-popover')).toBeHidden();
  await page.getByTestId('tab-stats').click();
  await expect(page.getByTestId('sheet')).toContainText('Area burnt');
  await page.getByTestId('tab-insights').click();
  const fireCard = page.locator('[data-testid=insight-card]:not(:has-text("Forecast"))').first();
  await expect(fireCard).toBeVisible({ timeout: 30_000 });
  const cards = await page.locator('[data-testid=insight-card]').count();
  expect(cards).toBeGreaterThan(1);
  expect(cards).toBeLessThan(40); // repeats of one phenomenon share a card
  await expect(page.getByTestId('insight-repeats').first()).toBeVisible();
  await setDock(page, 'half'); // drag the tab row up: half-height panel
  await fireCard.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, '06-insights');
  await setDock(page, 'full');
  await setDock(page, 'peek');
  await page.getByTestId('tab-insights').click(); // the same tab again gives the whole map back
  await expect(page.getByTestId('dock')).toHaveAttribute('data-detent', 'closed');

  // ── 3-D orbit view of the running fire ──
  await pickViewMode(page, 'orbit');
  await viewMenuAction(page, 'fly-fire');
  await page.waitForTimeout(1500);
  const h0 = await page.evaluate(() => (window as unknown as { __firesim: { view: { heading: number } } }).__firesim.view.heading);
  await zoomView(page, 'in');
  await zoomView(page, 'out');
  // Composition for the screenshot: from the Megalong Valley side, looking up the escarpment at the fire and plume.
  await page.evaluate(() => {
    const fs = (window as unknown as { __firesim: { view: { lookAt(x: number, y: number, d: number, az: number, tilt: number): void } } }).__firesim;
    fs.view.lookAt(-1200, 300, 6500, 235, 66);
  });
  await shot(page, '03-orbit');
  // The two round menus, expanded (only one is open at a time: tools, then view, side by side in one picture).
  {
    const size = page.viewportSize()!;
    await openMenu(page, 'tools');
    await expect(page.getByTestId('tool-fire')).toBeVisible();
    await animationsDone(page);
    const tools = await page.screenshot();
    await page.keyboard.press('Escape');
    await openMenu(page, 'view');
    await expect(page.getByTestId('compass')).toBeVisible();
    await animationsDone(page);
    const view = await page.screenshot();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('view-menu')).toHaveAttribute('aria-expanded', 'false');
    await composeSideBySide(page, tools, view, `${SHOTS}/09-menus-open.png`, size);
  }
  await viewMenuAction(page, 'compass'); // north up
  await expect.poll(async () => Math.round(await page.evaluate(() => (window as unknown as { __firesim: { view: { heading: number } } }).__firesim.view.heading)) % 360, { timeout: 5000 }).toBeLessThan(3);
  expect(Number.isFinite(h0)).toBe(true);

  // ── Why here? on the burnt escarpment ──
  await flyTo(page, ESCARPMENT[0] + 150, ESCARPMENT[1] + 150, 2500);
  const p = await page.evaluate(() => {
    const fs = (window as unknown as { __firesim: { view: { projectToScreen(x: number, y: number): [number, number] | null } } }).__firesim;
    return fs.view.projectToScreen(-2020, 1050);
  });
  expect(p).not.toBeNull();
  await page.mouse.click(p![0], p![1]);
  const why = page.getByTestId('why-panel');
  await expect(why).toBeVisible();
  await expect(why.locator('.narrative li').first()).toBeVisible({ timeout: 30_000 });
  await expect(why.locator('.factor-row').first()).toBeVisible();
  await shot(page, '07-why-here');
  await why.getByRole('button', { name: 'Close' }).click();

  // ── Layers: arrival-time overlay with 30-minute isochrones, from the top ──
  await pickTool(page, 'layers');
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  await page.getByTestId('overlay-arrival').click();
  await expect(page.getByTestId('overlay-arrival')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('legend')).toContainText('arrival');
  await page.getByTestId('layers-panel').getByRole('radio', { name: '30 min' }).check({ force: true });
  await page.getByTestId('layers-panel').getByRole('button', { name: 'Close' }).click();
  await pickViewMode(page, 'top');
  await viewMenuAction(page, 'fly-fire');
  await expect(page.getByTestId('map-legend')).toContainText('arrival');
  await shot(page, '04-top-arrival');

  // ── Vertical cross-section through the plume, seen from the side ──
  await pickTool(page, 'layers');
  await page.getByTestId('overlay-arrival').click(); // toggles the overlay off
  await expect(page.getByTestId('overlay-arrival')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('cross-section').click();
  await expect(page.getByTestId('cross-section').getByRole('switch')).toBeChecked();
  // If the auto-tune picked the fast (surface-wind) tier, switch this run to the 3-D atmosphere from the panel.
  if (await page.getByTestId('need-3d').isVisible()) {
    await page.getByTestId('use-3d').click();
    await expect(page.getByTestId('need-3d')).toBeHidden({ timeout: 120_000 });
  }
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __firesim: { session: { state: { get(): { snapshot: { atmosphere?: { nz: number } } } } } } }).__firesim.session.state.get().snapshot.atmosphere?.nz ?? 0), { timeout: 120_000 })
    .toBeGreaterThan(0);
  await page.getByTestId('cs-view').click();
  await page.getByTestId('layers-panel').getByRole('button', { name: 'Close' }).click();
  await shot(page, '05-cross-section');
  await pickTool(page, 'layers');
  await page.getByTestId('cross-section').click();
  await page.getByTestId('layers-panel').getByRole('button', { name: 'Close' }).click();

  // ── Eye level: stand on high ground 2–3.5 km from the fire (the view centre when there is no GPS fix) ──
  const vantage = await page.evaluate(() => {
    type T = { grid: { nx: number; ny: number; x0: number; y0: number; cellSize: number }; elevation: Float32Array };
    const fs = (window as unknown as { __firesim: { scenario: { terrain: T }; session: { state: { get(): { snapshot: { fire: { arrivalTime: Float32Array }; time: number } } } } } }).__firesim;
    const { grid: g, elevation } = fs.scenario.terrain;
    const snap = fs.session.state.get().snapshot;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let k = 0; k < elevation.length; k++)
      if (snap.fire.arrivalTime[k]! <= snap.time) {
        sx += g.x0 + (k % g.nx) * g.cellSize;
        sy += g.y0 + Math.floor(k / g.nx) * g.cellSize;
        n++;
      }
    const cx = sx / n;
    const cy = sy / n;
    let best: [number, number] = [0, 0];
    let bz = -Infinity;
    for (let k = 0; k < elevation.length; k++) {
      const x = g.x0 + (k % g.nx) * g.cellSize;
      const y = g.y0 + Math.floor(k / g.nx) * g.cellSize;
      const d = Math.hypot(x - cx, y - cy);
      if (d < 2000 || d > 3500 || snap.fire.arrivalTime[k]! <= snap.time) continue;
      if (elevation[k]! > bz) {
        bz = elevation[k]!;
        best = [x, y];
      }
    }
    return best;
  });
  await flyTo(page, vantage[0], vantage[1], 1500);
  await pickViewMode(page, 'ground');
  await shot(page, '08-eye-level');
  await pickViewMode(page, 'orbit');

  // ── Jump back to 13:00 (1 h) in one step: the timeline can go to any time ──
  const before = await session(page);
  await jumpWithPopover(page, 3600);
  await expect.poll(async () => (await session(page)).viewTime).toBe(3600);
  await expect(page.locator('.tb-state')).toContainText('Replay');
  const rewound = await session(page);
  expect(rewound.area).toBeLessThan(before.area);
  // The stored snapshot of 1 h is shown (at1h was read at the first poll with the clock ≥ 1 h, so it can be later).
  expect(await page.evaluate(() => (window as unknown as { __firesim: { session: { state: { get(): { snapshot: { time: number } } } } } }).__firesim.session.state.get().snapshot.time)).toBe(3600);
  expect(rewound.area).toBeLessThanOrEqual(at1h.area + 0.01);
  await expect(page.getByTestId('live')).toHaveCount(0); // there is no Live button: Play carries on from anywhere

  // ── A fuel brush edit (a fresh bulldozer line: no fuel) ahead of the fire, in the past → the worker rewinds ──
  await pickTool(page, 'fuel');
  await page.getByTestId('fuel-nofuel').click();
  await flyTo(page, ESCARPMENT[0] + 900, ESCARPMENT[1] - 500, 2500);
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('apply-fuel').click();
  await expect(page.getByTestId('fuel-panel')).toContainText('Your fuel changes');
  await page.getByTestId('fuel-panel').getByRole('button', { name: 'Close tool' }).click();
  expect((await session(page)).fuelEdits).toBe(1);

  // ── A spot fire ahead of the main fire ──
  await pickTool(page, 'fire');
  await page.getByTestId('fire-origin').getByRole('radio', { name: 'Spot fire' }).check({ force: true });
  await flyTo(page, ESCARPMENT[0] + 1500, ESCARPMENT[1] - 1200, 2500);
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Spot fire ahead');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  expect((await session(page)).ignitions).toEqual(['observed', 'spot']);

  // ── Play on from the edit: the re-run passes the old head and the fire keeps growing ──
  const after = await playUntil(page, 7800, D);
  expect(after.area).toBeGreaterThan(rewound.area);
  await pause(page);

  // ── Undo the spot fire (a wrong mark): the worker re-runs from its time without it ──
  await pickTool(page, 'fire');
  await page.getByTestId('fire-panel').getByTestId('remove-ignition').last().click();
  await expect(page.getByTestId('fire-panel')).not.toContainText('Spot fire ahead');
  expect((await session(page)).ignitions).toEqual(['observed']);
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await expect.poll(async () => (await session(page)).headTime, { timeout: 60_000 }).toBeGreaterThanOrEqual(7800);

  // ── A jump far beyond the computed range: one tap on the timeline; its progress shows on the track (for the README) ──
  const head0 = (await session(page)).headTime;
  await pickViewMode(page, 'top');
  await viewMenuAction(page, 'fly-fire');
  await tapTimeline(page, D * 0.92);
  await expect(page.getByTestId('seek-status')).toBeVisible();
  await expect.poll(async () => (await session(page)).seekProgress, { timeout: 90_000 }).toBeGreaterThan(0.3);
  await shot(page, '10-timeline-jump');
  expect((await session(page)).seekTarget).not.toBeNull();
  expect((await session(page)).playing).toBe(false); // the clock waits while the jump computes
  // Cancel it part-way: the view stays where the computation had got to, and the session is still fully usable.
  await page.getByTestId('seek-cancel').click();
  const stopped = await session(page);
  expect(stopped.seekTarget).toBeNull();
  expect(stopped.playing).toBe(false);
  expect(stopped.viewTime).toBeGreaterThan(head0);
  expect(stopped.viewTime).toBeLessThan(D * 0.92);
  // Then an exact jump: 16:00 (4 h), typed. It lands precisely there.
  await jumpWithPopover(page, 4 * 3600);
  const exact = await waitForSeekEnd(page, 150_000);
  expect(exact.viewTime).toBe(4 * 3600);
  expect(exact.playing).toBe(false);
  expect(exact.area).toBeGreaterThan(after.area);
  await expect(page.getByTestId('clock')).toHaveText(/16:00/);

  // Nothing popped up over the simulation in all of this, and no card stopped playback.
  expect(await popups(page)).toEqual([]);
  expect(fallbacks).toEqual([]);
  expect(errors).toEqual([]);
});
