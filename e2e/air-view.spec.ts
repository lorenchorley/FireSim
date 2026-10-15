/**
 * The air view as the real engines publish it (plan section 7), on both tiers, in the real app (bundled Katoomba demo, offline,
 * real worker): the tier is pinned by the Detail choice (Fast) or by switching the run to the 3-D atmosphere. What it checks:
 *  - every picture carries the terrain-following layout, the kind of the air, the datum and top, and the air's own time;
 *  - the fast tier's view holds a 3-D wind (kind 'diagnosed', no temperature or smoke) and the 3-D tier's holds all five fields;
 *  - the layers that read the air work on both: the wind speed heat map (now also in the fast tier), the wind streaks, the
 *    smoke and the curtain, whose chips (Temp and Smoke need the 3-D atmosphere) and "diagnosed wind" callout follow the kind
 *    of the air and not the number of levels;
 *  - nothing in the console (the guard of ./fixtures) and the run is never paused by an error.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, session, setSpeed } from './helpers';

interface Air {
  kind: string | null;
  layout: string | null;
  nz: number;
  topM: number | null;
  baseM: number | null;
  time: number | null;
  snapshotTime: number;
  cells: number;
  u: number;
  w: number;
  theta: number;
  smoke: number;
}

const air = (page: Page): Promise<Air | null> =>
  page.evaluate(() => {
    type V = { kind?: string; layout?: string; nz: number; topM?: number; baseM?: number; time?: number; grid: { nx: number; ny: number }; u: Float32Array; w: Float32Array; thetaAnomaly: Float32Array; smoke: Float32Array };
    const s = (window as unknown as { __firesim: { session: { state: { get(): { snapshot: { time: number; atmosphere?: V } | null } } } } }).__firesim.session.state.get().snapshot;
    const a = s?.atmosphere;
    if (!s || !a) return null;
    return { kind: a.kind ?? null, layout: a.layout ?? null, nz: a.nz, topM: a.topM ?? null, baseM: a.baseM ?? null, time: a.time ?? null, snapshotTime: s.time, cells: a.grid.nx * a.grid.ny * a.nz, u: a.u.length, w: a.w.length, theta: a.thetaAnomaly.length, smoke: a.smoke.length };
  });

async function build(page: Page, detail: 'Fast' | 'Normal'): Promise<void> {
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('detail').getByRole('radio', { name: new RegExp(`^${detail}`) }).check({ force: true });
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
}

/** Mark a fire at the crosshair, play as fast as possible until the picture shown is past six minutes, and pause. */
async function runSixMinutes(page: Page): Promise<void> {
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tool-fire').click();
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 240_000 }).toBeGreaterThan(370);
  await page.getByTestId('play').click(); // pause
  await expect.poll(async () => (await session(page)).playing).toBe(false);
}

async function checkLayers(page: Page, prognostic: boolean): Promise<void> {
  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();
  // The wind speed heat map is available in both tiers now (the fast tier's diagnosed wind carries the 10 m wind).
  // (the group opens by itself once a fire exists; a tap on an open group would close it)
  const group = panel.getByTestId('layer-group-fire-and-weather');
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  const row = panel.locator('.lp-heat[data-layer="windSpeed"]');
  await expect(row).not.toContainText('Needs the 3-D atmosphere');
  await expect(row).not.toContainText('Needs a fire');
  await panel.getByTestId('overlay-windSpeed').click();
  await expect(panel.getByTestId('overlay-windSpeed')).toHaveAttribute('aria-pressed', 'true');
  await panel.getByTestId('overlay-windSpeed').click();
  await expect(panel.getByTestId('overlay-windSpeed')).toHaveAttribute('aria-pressed', 'false');
  // The wind streaks near the ground, and the curtain: its callout follows the kind of the air.
  await panel.getByTestId('wind-layer').getByRole('radio', { name: 'Near the ground' }).check({ force: true });
  await panel.getByTestId('cross-section').click();
  await expect(panel.getByTestId('cross-section').getByRole('switch')).toBeChecked();
  // The section works on both airs. The old "need the 3-D atmosphere" warning stays only for the streaks through the plume (not on here).
  await expect(page.getByTestId('need-3d')).toBeHidden();
  const chip = (id: string) => panel.getByTestId(`slice-field-${id}`);
  for (const id of ['speed', 'along', 'up', 'across']) await expect(chip(id)).toBeEnabled();
  if (prognostic) {
    // Every chip works, nothing is said about a missing plume, and with no chip chosen the curtain keeps its old colouring: temperature.
    await expect(panel.getByTestId('slice-diagnosed')).toBeHidden();
    await expect(chip('theta')).toBeEnabled();
    await expect(chip('smoke')).toBeEnabled();
    await expect(chip('theta')).toHaveAttribute('aria-pressed', 'true');
  } else {
    // The fast tier shows the diagnosed wind: Temp and Smoke are off and say why, the info callout says what the section is and offers the switch.
    const note = panel.getByTestId('slice-diagnosed');
    await expect(note).toBeVisible();
    await expect(note).toContainText('This section shows the diagnosed wind (terrain effects only). Use the 3-D atmosphere to see the plume, temperature and smoke.');
    await expect(panel.getByTestId('use-3d-slice')).toBeVisible();
    await expect(chip('theta')).toBeDisabled();
    await expect(chip('smoke')).toBeDisabled();
    await expect(chip('theta')).toHaveAttribute('aria-label', /Temperature needs the 3-D atmosphere/);
    await expect(chip('speed')).toHaveAttribute('aria-pressed', 'true');
  }
  // A chip changes the colouring, and the legend on the map follows it.
  await chip('along').click();
  await expect(chip('along')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('speed')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('map-legend')).toContainText('Wind along the line');
  await chip('up').click();
  await expect(page.getByTestId('map-legend')).toContainText('Air going up or down');
  await page.waitForTimeout(500); // a few frames with the layers on
  expect((await session(page)).error).toBeNull();
  await panel.getByTestId('cross-section').click();
  await panel.getByRole('button', { name: 'Close' }).click();
}

test('fast tier: the picture carries a diagnosed 3-D wind with its own time, and the layers that read the air work', async ({ page }) => {
  test.setTimeout(420_000);
  await build(page, 'Fast');
  await expect.poll(() => air(page), { timeout: 60_000 }).not.toBeNull();
  await runSixMinutes(page);
  const a = (await air(page))!;
  expect(a).toMatchObject({ kind: 'diagnosed', layout: 'terrain-following', theta: 0, smoke: 0 });
  expect(a.nz).toBeGreaterThan(1);
  expect(a.u).toBe(a.cells);
  expect(a.w).toBe(a.cells);
  expect(a.topM).toBeGreaterThanOrEqual(3000);
  expect(Number.isFinite(a.baseM!)).toBe(true);
  // The air's own time: the keyframe at or before the picture shown, never later, less than a keyframe interval older.
  expect(a.time, JSON.stringify(a)).not.toBeNull();
  expect(a.time!, JSON.stringify(a)).toBeGreaterThan(0);
  expect(a.time!, JSON.stringify(a)).toBeLessThanOrEqual(a.snapshotTime);
  expect(a.snapshotTime - a.time!, JSON.stringify(a)).toBeLessThan(301);
  await checkLayers(page, false);
});

test('3-D tier: the picture carries the time-stepped air as a terrain-following volume with its own time, and the layers that read the air work', async ({ page }) => {
  test.setTimeout(600_000);
  await build(page, 'Normal');
  await expect.poll(() => air(page), { timeout: 60_000 }).not.toBeNull();
  // Auto keeps the 3-D air unless this machine is far too slow for it: switch the run to the 3-D atmosphere if it chose the fast tier.
  if ((await air(page))!.kind !== 'prognostic') {
    await page.evaluate(() => (window as unknown as { __firesim: { session: { controller: { setQuality(t: string): void } } } }).__firesim.session.controller.setQuality('standard'));
    await expect.poll(async () => (await air(page))?.kind, { timeout: 240_000 }).toBe('prognostic');
  }
  await runSixMinutes(page);
  const a = (await air(page))!;
  expect(a).toMatchObject({ kind: 'prognostic', layout: 'terrain-following' });
  expect(a.nz).toBeGreaterThan(1);
  for (const n of [a.u, a.w, a.theta, a.smoke]) expect(n).toBe(a.cells);
  expect(a.topM).toBeGreaterThanOrEqual(3000);
  expect(Number.isFinite(a.baseM!)).toBe(true);
  expect(a.time, JSON.stringify(a)).not.toBeNull();
  expect(a.time!, JSON.stringify(a)).toBeGreaterThan(0);
  expect(a.time!, JSON.stringify(a)).toBeLessThanOrEqual(a.snapshotTime);
  expect(a.snapshotTime - a.time!, JSON.stringify(a)).toBeLessThan(301);
  await checkLayers(page, true);
});
