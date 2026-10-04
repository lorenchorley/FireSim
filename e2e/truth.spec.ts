/**
 * Truth audit of the two information screens on the REAL engine (Katoomba bundled data, the 'hot NW wind' preset, offline):
 * what the Data sets screen says about the tier, the memory and the data is what the engine and the scenario say. (The wording
 * of each statement is also unit-tested; this checks it end to end, with whatever tier the machine's auto-tune picks.)
 *   - Setup does not promise the 3-D wind under 'Auto';
 *   - the Data sets screen names the ENGINE's tier (not 'Auto: starts on Standard') and sizes the memory for it;
 *   - the places figures are for the model area (the zoned land cannot exceed the 36 km² square);
 *   - the designed weather is "made up by the app", never "Real data", in the data set itself and in the fuel map built from it;
 *   - the model card's headline and its layer list say the same about the smoke and the wind as the engine's tier does.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, session } from './helpers';

const norm = (s: string): string => s.replace(/[\u2009\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();

interface Engine {
  tier: 'fast' | 'standard' | 'high';
  tierCause: string;
  atmosphere: { kind: '3d' | 'diagnostic'; nx: number; ny: number; nz: number; dxM: number };
  memory?: { totalBytes: number };
}
const engine = (page: Page): Promise<Engine | null> =>
  page.evaluate(() => {
    const fs = (window as unknown as { __firesim: { session: { state: { get(): { snapshot: { engine?: unknown } | null } } } } }).__firesim;
    return (fs.session.state.get().snapshot?.engine ?? null) as never;
  });

test('Data sets and the model card tell the truth about the tier, the memory and the data of a real run', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();

  // Setup: the default performance setting is Auto, which decides when the run starts: the hint names both winds.
  await expect(page.getByTestId('detail-hint')).toContainText('3-D wind if this phone is fast enough, else a simple 2-D surface wind');

  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tool-fire').click();
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);
  // Auto times the 3-D air during the first steps ('auto-pending' says so): read the tier only once it is decided.
  await expect
    .poll(async () => {
      const x = await engine(page);
      return !!x && x.atmosphere.nx > 0 && x.tierCause !== 'auto-pending';
    }, { timeout: 120_000 })
    .toBe(true);
  const e = (await engine(page))!;

  // ── the Data sets screen ──
  await page.evaluate(() => (window as unknown as { __firesim: { app: { openDatasets(): void } } }).__firesim.app.openDatasets());
  const screen = page.getByTestId('datasets-screen');
  await expect(screen).toBeVisible();
  const summary = norm(await screen.getByTestId('datasets-summary').innerText());
  const tierWords = { fast: 'Fast: a 2-D wind shaped by the ground (no 3-D air movement)', standard: 'Standard: 3-D atmosphere', high: 'High: finer 3-D atmosphere' }[e.tier];
  expect(summary).toContain(tierWords);
  expect(summary).not.toContain('Auto: starts on Standard');
  // What THIS build saved, not what the phone holds in all (the Storage card below says that).
  expect(summary).toContain('newly saved on this phone');
  if (e.tierCause === 'auto-tune') expect(summary).toContain('chosen by Auto after timing this phone');
  expect(summary).toContain(e.atmosphere.kind === 'diagnostic' ? 'Wind grid' : 'Atmosphere grid');
  expect(summary).toContain(`${e.atmosphere.nx} x ${e.atmosphere.ny} columns of ${Math.round(e.atmosphere.dxM)} m`);

  const memory = norm(await screen.getByTestId('datasets-memory').innerText());
  if (e.tier === 'fast') {
    expect(memory).toContain('Wind model of the fast mode');
    expect(memory).not.toContain('Atmosphere model (3-D');
    expect(memory).not.toContain('Auto tier: shown for Standard');
  } else {
    expect(memory).toContain('Atmosphere model (3-D');
  }
  if (e.memory) expect(memory).toContain('Simulation engine, measured by the engine:');

  // The zoned land inside the 6 km square cannot be more than the square (36 km²); the file as loaded holds more than 70 km².
  await screen.getByTestId('dataset-row-zones').click();
  const zones = norm(await page.getByTestId('dataset-detail').innerText());
  const total = /Total area ([\d.]+) km²/.exec(zones);
  expect(total, zones.slice(0, 600)).not.toBeNull();
  expect(Number(total![1])).toBeGreaterThan(0);
  expect(Number(total![1])).toBeLessThanOrEqual(36);
  expect(zones).toContain('Inside the model area only');
  await page.getByTestId('dataset-detail-back').click();

  // The designed weather is not "real data" (it covers the area, but it is made up); neither is the fuel map's drought input.
  await screen.getByTestId('dataset-row-weather').click();
  const weather = norm(await page.getByTestId('dataset-detail').innerText());
  expect(weather).not.toContain('Real data cover');
  expect(weather).toContain('Covers 100 % of the model area (made up by the app, not real data)');
  // A designed day has no capture date at all (and a series that has dates calls them "Days covered", never "Captured").
  expect(weather).not.toContain('Captured');
  expect(weather).not.toContain('About the capture date');
  await page.getByTestId('dataset-detail-back').click();
  await screen.getByTestId('dataset-row-fuel-derived').click();
  const fuel = norm(await page.getByTestId('dataset-detail').innerText());
  expect(fuel).toContain('designed by the app, not real data');
  expect(fuel).not.toMatch(/Rainfall history and drought real data/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);

  // ── the model card says the same about the plume and the wind as the tier does ──
  await page.evaluate(() => (window as unknown as { __firesim: { app: { openModelCard(): void } } }).__firesim.app.openModelCard());
  const card = page.getByTestId('model-card');
  await expect(card).toBeVisible();
  const toggles = card.locator('.mc-toggle');
  for (let i = 0; i < (await toggles.count()); i++) if ((await toggles.nth(i).getAttribute('aria-expanded')) !== 'true') await toggles.nth(i).click();
  const text = norm(await card.innerText());
  if (e.tier === 'fast') {
    expect(text).toContain('Smoke and plume'); // the glance row exists
    expect(text).toContain('One drawn column of puffs above the most intense part of the fire; there is no smoke field');
    expect(text).toContain('surface wind only');
    expect(text).not.toContain('133 m atmosphere cells, drawn as soft puffs');
  } else {
    expect(text).not.toContain('there is no smoke field');
  }
  expect(text).not.toMatch(/LiDAR/);
});
