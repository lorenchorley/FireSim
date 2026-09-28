/**
 * End-to-end test of the whole app with the REAL modules (scenario builder on the bundled Katoomba demo data,
 * simulation in its Web Worker, Three.js view) against the production build on the Pixel 7 profile:
 *   notice → Katoomba demo → preset weather → build → mark a fire on the Megalong escarpment → play at the highest
 *   speed → the fire grows, insight cards appear, "Why here?" explains → arrival overlay → rewind with the scrubber →
 *   a fuel brush edit and a spot fire in the past → play on.
 * Screenshots of the main views go to docs/screenshots/ (README). `?debug=1` exposes window.__firesim, used only to
 * read the session state and to aim the camera at the escarpment (the fire is then marked with the UI's crosshair).
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });

/** The escarpment ignition of the headless validation (src/sim/validation.test.ts): 688 m, 23° slope. */
const ESCARPMENT: [number, number] = [-2170, 900];

interface SessionView {
  playing: boolean;
  viewTime: number;
  headTime: number;
  area: number;
  insights: number;
  ignitions: string[];
  fuelEdits: number;
}

async function session(page: Page): Promise<SessionView> {
  return page.evaluate(() => {
    const fs = (window as unknown as { __firesim: { session: { state: { get(): Record<string, unknown> } } } }).__firesim;
    const s = fs.session.state.get() as {
      playing: boolean;
      viewTime: number;
      headTime: number;
      snapshot: { stats: { burntAreaHa: number } } | null;
      insights: unknown[];
      ignitions: { origin: string }[];
      edits: { edit: { kind: string } }[];
    };
    return {
      playing: s.playing,
      viewTime: s.viewTime,
      headTime: s.headTime,
      area: s.snapshot?.stats.burntAreaHa ?? 0,
      insights: s.insights.length,
      ignitions: s.ignitions.map((i) => i.origin),
      fuelEdits: s.edits.filter((e) => e.edit.kind === 'fuel').length,
    };
  });
}

async function dismissToasts(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const close = page.getByTestId('toast').getByRole('button', { name: 'Dismiss' });
    if (!(await close.count())) return;
    await close.first().click().catch(() => undefined);
  }
}

/** Play until the view time reaches `t` (s). "Pause on danger" stops playback the first time a danger appears. */
async function playUntil(page: Page, t: number, timeoutMs = 150_000): Promise<SessionView> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const s = await session(page);
    if (s.viewTime >= t) return s;
    if (Date.now() > end) throw new Error(`timed out at view time ${s.viewTime} s (head ${s.headTime} s)`);
    if (!s.playing) {
      await dismissToasts(page);
      await page.getByTestId('play').click();
    }
    await page.waitForTimeout(500);
  }
}

async function pause(page: Page): Promise<void> {
  if ((await session(page)).playing) await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  await dismissToasts(page);
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

async function setScrubber(page: Page, t: number): Promise<void> {
  await page.getByTestId('scrubber').evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, t);
}

test('real engine end to end: build → escarpment fire → play → insights → why here → overlays → rewind → edits', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  const fallbacks: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning' && /using the mock|2-D map instead|imagery load failed/.test(m.text())) fallbacks.push(m.text());
  });

  // ── Setup ──
  await page.goto('/?debug=1');
  await expect(page.getByTestId('training-badge')).toBeVisible();
  await expect(page.getByTestId('notice')).toBeVisible();
  await page.getByTestId('accept-notice').click();
  await expect(page.getByTestId('notice')).toHaveCount(0);
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

  // ── Mark the fire on the escarpment with the crosshair ──
  await page.getByTestId('tool-fire').click();
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
  await page.getByTestId('speed').click();
  await page.locator('[data-speed="Infinity"]').click();
  await page.getByTestId('play').click();
  const at1h = await playUntil(page, 3600);
  const at2h = await playUntil(page, 7200);
  expect(at1h.area).toBeGreaterThan(5);
  expect(at2h.area).toBeGreaterThan(at1h.area * 1.3);
  await pause(page);
  await page.getByTestId('tab-stats').click();
  await expect(page.getByTestId('sheet')).toContainText('Area burnt');
  await page.getByTestId('tab-insights').click();
  const fireCard = page.locator('[data-testid=insight-card]:not(:has-text("Forecast"))').first();
  await expect(fireCard).toBeVisible({ timeout: 30_000 });
  const cards = await page.locator('[data-testid=insight-card]').count();
  expect(cards).toBeGreaterThan(1);
  expect(cards).toBeLessThan(40); // repeats of one phenomenon share a card
  await expect(page.getByTestId('insight-repeats').first()).toBeVisible();
  await fireCard.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, '06-insights');
  await page.getByTestId('sheet-handle').click(); // half → full
  await page.getByTestId('sheet-handle').click(); // full → peek

  // ── 3-D orbit view of the running fire ──
  await page.locator('.view-btn[data-mode="orbit"]').click();
  await page.getByRole('button', { name: 'Fly to the fire' }).click();
  await page.waitForTimeout(1500);
  const h0 = await page.evaluate(() => (window as unknown as { __firesim: { view: { heading: number } } }).__firesim.view.heading);
  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-out').click();
  // Composition for the screenshot: from the Megalong Valley side, looking up the escarpment at the fire and plume.
  await page.evaluate(() => {
    const fs = (window as unknown as { __firesim: { view: { lookAt(x: number, y: number, d: number, az: number, tilt: number): void } } }).__firesim;
    fs.view.lookAt(-1200, 300, 6500, 235, 66);
  });
  await shot(page, '03-orbit');
  await page.getByTestId('compass').click(); // north up
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
  await page.getByTestId('tool-layers').click();
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  await page.getByTestId('overlay-arrival').click();
  await expect(page.getByTestId('overlay-arrival')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('legend')).toContainText('arrival');
  await page.getByTestId('layers-panel').getByRole('radio', { name: '30 min' }).check({ force: true });
  await page.getByTestId('layers-panel').getByRole('button', { name: 'Close' }).click();
  await page.locator('.view-btn[data-mode="top"]').click();
  await page.getByRole('button', { name: 'Fly to the fire' }).click();
  await expect(page.getByTestId('map-legend')).toContainText('arrival');
  await shot(page, '04-top-arrival');

  // ── Vertical cross-section through the plume, seen from the side ──
  await page.getByTestId('tool-layers').click();
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
  await page.getByTestId('tool-layers').click();
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
  await page.locator('.view-btn[data-mode="ground"]').click();
  await shot(page, '08-eye-level');
  await page.locator('.view-btn[data-mode="orbit"]').click();

  // ── Rewind with the scrubber ──
  const before = await session(page);
  await setScrubber(page, 3600);
  await expect.poll(async () => (await session(page)).viewTime).toBe(3600);
  const rewound = await session(page);
  expect(rewound.area).toBeLessThan(before.area);
  // The stored snapshot of 1 h is shown (at1h was read at the first poll with the clock ≥ 1 h, so it can be later).
  expect(await page.evaluate(() => (window as unknown as { __firesim: { session: { state: { get(): { snapshot: { time: number } } } } } }).__firesim.session.state.get().snapshot.time)).toBe(3600);
  expect(rewound.area).toBeLessThanOrEqual(at1h.area + 0.01);
  await expect(page.getByTestId('live')).toBeEnabled();

  // ── A fuel brush edit (a fresh bulldozer line: no fuel) ahead of the fire, in the past → the worker rewinds ──
  await page.getByTestId('tool-fuel').click();
  await page.getByTestId('fuel-nofuel').click();
  await flyTo(page, ESCARPMENT[0] + 900, ESCARPMENT[1] - 500, 2500);
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('apply-fuel').click();
  await expect(page.getByTestId('fuel-panel')).toContainText('Your fuel changes');
  await page.getByTestId('fuel-panel').getByRole('button', { name: 'Close tool' }).click();
  expect((await session(page)).fuelEdits).toBe(1);

  // ── A spot fire ahead of the main fire ──
  await page.getByTestId('tool-fire').click();
  await page.getByTestId('fire-origin').getByRole('radio', { name: 'Spot fire' }).check({ force: true });
  await flyTo(page, ESCARPMENT[0] + 1500, ESCARPMENT[1] - 1200, 2500);
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Spot fire ahead');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  expect((await session(page)).ignitions).toEqual(['observed', 'spot']);

  // ── Play on from the edit: the re-run passes the old head and the fire keeps growing ──
  const after = await playUntil(page, 7800);
  expect(after.area).toBeGreaterThan(rewound.area);
  await pause(page);

  // ── Undo the spot fire (a wrong mark): the worker re-runs from its time without it ──
  await page.getByTestId('tool-fire').click();
  await page.getByTestId('fire-panel').getByTestId('remove-ignition').last().click();
  await expect(page.getByTestId('fire-panel')).not.toContainText('Spot fire ahead');
  expect((await session(page)).ignitions).toEqual(['observed']);
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await expect.poll(async () => (await session(page)).headTime, { timeout: 60_000 }).toBeGreaterThanOrEqual(7800);

  expect(fallbacks).toEqual([]);
  expect(errors).toEqual([]);
});
