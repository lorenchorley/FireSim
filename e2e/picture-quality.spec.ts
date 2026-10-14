/**
 * Picture quality (Settings, Simulation), in the real app (bundled Katoomba demo, offline, the real 3-D view):
 *  - High set in Settings gives a High view on a phone the guess calls Low (4 cores, 3 GB), with the heads-up line shown;
 *  - Low set in Settings gives a Low view on a phone the guess calls High, and the trees' wind sway starts off;
 *  - Auto under the Detail profile asks for High (on a Low phone, so it is not the guess);
 *  - Auto under Balanced is the guess of the page's own navigator values (6 cores, 4 GB: Medium, so neither Low nor High);
 *  - on every tier the view stays inside its draw-call and triangle budgets and reports what the tier sets.
 * The navigator values are stubbed so each case is distinct from the host machine; the view is read through the
 * `?debug=1` handle (window.__firesim.view). One Katoomba run per case.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { guessQuality } from '../src/render/qualityGuess';
import { acceptNotice } from './helpers';

/** Make the page report these cores and this memory (GB), as a phone would. */
async function phone(page: Page, cores: number, memoryGb: number): Promise<void> {
  await page.addInitScript(
    ([c, m]) => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => c, configurable: true });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => m, configurable: true });
    },
    [cores, memoryGb],
  );
}

type Performance = 'Saver' | 'Balanced' | 'Detail';
type Picture = 'Auto' | 'Low' | 'Medium' | 'High';

/** Open Settings from Setup, choose the Performance and Picture quality rows, close it again. */
async function choose(page: Page, o: { performance?: Performance; picture?: Picture }): Promise<void> {
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  if (o.performance) await page.getByTestId('performance').getByRole('radio', { name: o.performance }).check();
  if (o.picture) await page.getByTestId('picture-quality').getByRole('radio', { name: o.picture }).check();
}

async function closeSettings(page: Page): Promise<void> {
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('settings')).toHaveCount(0);
}

/** Build the Katoomba demo offline and wait for the run screen. */
async function buildKatoomba(page: Page): Promise<void> {
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
}

interface Probe {
  tier: 'low' | 'medium' | 'high';
  info: {
    tier: string;
    source: string;
    guess: string;
    cores: number | null;
    memoryGb: number | null;
    terrainSamples: number;
    treeBudget: number;
    canopyTriangles: number;
    pixelRatioCap: number;
    flameSites: number;
    smokePuffs: number;
    treeSwayDefault: boolean;
  };
  stats: { drawCalls: number; triangles: number };
  mesh: string;
  trees: number;
  vegLod: string;
  navigator: { hardwareConcurrency?: number; deviceMemory?: number };
}

/**
 * The view's tier and facts, with the canopy placed and one frame drawn now. The first placement of a run can come out empty
 * on a slow start (it happened in some runs on this busy machine, with identical settings and data), so the canopy is placed
 * again by switching it off and on, as the Layers panel's switch does: the count the budgets are read from is then always
 * the tier's own.
 */
async function probe(page: Page): Promise<Probe> {
  type Handle = { __firesim: { view: { setLayers(p: Record<string, unknown>): void; renderNow(): void; diagnostics(): Record<string, number> } } };
  await page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.setLayers({ vegetation: false });
    v.setLayers({ vegetation: true });
  });
  const trees = (): Promise<number> =>
    page.evaluate(() => {
      const v = (window as unknown as Handle).__firesim.view;
      v.renderNow();
      return Number(v.diagnostics()['vegetation']);
    });
  await expect.poll(trees, { message: 'the canopy is placed', timeout: 60_000 }).toBeGreaterThan(0);
  return page.evaluate(() => {
    const v = (window as unknown as { __firesim: { view: Record<string, unknown> & { renderNow(): void; stats(): { drawCalls: number; triangles: number }; diagnostics(): Record<string, string> } } }).__firesim.view;
    v.renderNow();
    const d = v.diagnostics();
    const nav = navigator as Navigator & { deviceMemory?: number };
    return {
      tier: v.renderQuality as Probe['tier'],
      info: v.qualityInfo as Probe['info'],
      stats: v.stats(),
      mesh: String(d['mesh']),
      trees: Number(d['vegetation']),
      vegLod: String(d['vegLod']),
      navigator: { hardwareConcurrency: nav.hardwareConcurrency, deviceMemory: nav.deviceMemory },
    };
  });
}

const windSway = (page: Page): Promise<boolean> => page.evaluate(() => (window as unknown as { __firesim: { view: { getLayers(): { windSway: boolean } } } }).__firesim.view.getLayers().windSway);

/** What a tier sets (plan 9c.2). */
const TIER = {
  low: { terrainSamples: 224, treeBudget: 16000, canopyTriangles: 100000, pixelRatioCap: 1.25, flameSites: 2500, smokePuffs: 800, treeSwayDefault: false },
  medium: { terrainSamples: 320, treeBudget: 32000, canopyTriangles: 170000, pixelRatioCap: 1.75, flameSites: 5000, smokePuffs: 1500, treeSwayDefault: true },
  high: { terrainSamples: 400, treeBudget: 48000, canopyTriangles: 250000, pixelRatioCap: 2, flameSites: 5000, smokePuffs: 1500, treeSwayDefault: true },
} as const;

/** The view reports what its tier sets, and one frame stays inside the tier's draw-call and triangle budgets. */
function expectTier(p: Probe, tier: 'low' | 'medium' | 'high'): void {
  expect(p.tier).toBe(tier);
  expect(p.info).toMatchObject({ tier, ...TIER[tier] });
  const [nx, ny] = p.mesh.split('×').map(Number) as [number, number];
  expect(nx).toBeLessThanOrEqual(TIER[tier].terrainSamples);
  expect(ny).toBeLessThanOrEqual(TIER[tier].terrainSamples);
  // Drawn: at least the terrain mesh; at most the terrain mesh plus the tier's canopy budget plus the small rest (sky, skirt, flames,
  // smoke, icons, places: about 28 k measured without the canopy, so 60 k is twice that).
  const terrainTriangles = 2 * (nx - 1) * (ny - 1);
  expect(p.stats.triangles, 'the terrain is drawn').toBeGreaterThanOrEqual(terrainTriangles);
  expect(p.stats.triangles, 'terrain mesh + canopy budget + the rest').toBeLessThanOrEqual(2 * nx * ny + TIER[tier].canopyTriangles + 60_000);
  expect(p.stats.drawCalls, 'draw calls in one frame (about 7 to 15 measured)').toBeLessThanOrEqual(40);
  expect(p.trees, 'tree instances').toBeLessThanOrEqual(TIER[tier].treeBudget);
  const canopyK = Number(/(\d+)k tris/.exec(p.vegLod)?.[1] ?? 0);
  expect(canopyK * 1000, `canopy triangles (${p.vegLod})`).toBeLessThanOrEqual(TIER[tier].canopyTriangles);
  expect(canopyK, `the canopy is drawn (${p.vegLod})`).toBeGreaterThan(0);
  test.info().annotations.push({ type: `${tier} budgets`, description: `mesh ${p.mesh}, ${p.stats.triangles} triangles, ${p.stats.drawCalls} draw calls, ${p.trees} trees, canopy ${p.vegLod}` });
}

test('High set in Settings gives a High view on a phone the guess calls Low, and the heads-up shows', async ({ page }) => {
  test.setTimeout(360_000);
  await phone(page, 4, 3);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('open-settings').click();
  const picture = page.getByTestId('picture-quality');
  const note = page.getByTestId('picture-quality-note');
  await expect(picture.getByRole('radio', { name: 'Auto' })).toBeChecked();
  await expect(note).toBeHidden();
  await picture.getByRole('radio', { name: 'High' }).check();
  await expect(note).toBeVisible();
  await expect(note).toHaveText('This phone looks like a Low device (4 cores, 3 GB). High may run slowly or close the app.');
  expect(await note.getAttribute('role'), 'a quiet line, never an alert').toBeNull();
  await picture.getByRole('radio', { name: 'Medium' }).check();
  await expect(note).toBeHidden();
  await picture.getByRole('radio', { name: 'High' }).check();
  await closeSettings(page);
  await buildKatoomba(page);

  const p = await probe(page);
  expectTier(p, 'high');
  expect(p.info).toMatchObject({ source: 'option', guess: 'low', cores: 4, memoryGb: 3 });
  await expect.poll(() => windSway(page)).toBe(true);
});

test('Low set in Settings gives a Low view on a phone the guess calls High, and tree sway starts off', async ({ page }) => {
  test.setTimeout(360_000);
  await phone(page, 8, 8);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await choose(page, { picture: 'Low' });
  await expect(page.getByTestId('picture-quality-note')).toBeHidden();
  await closeSettings(page);
  await buildKatoomba(page);

  const p = await probe(page);
  expectTier(p, 'low');
  expect(p.info).toMatchObject({ source: 'option', guess: 'high', cores: 8, memoryGb: 8 });
  await expect.poll(() => windSway(page), 'tree sway defaults off on Low').toBe(false);
});

test('Auto under the Detail profile asks for High (on a Low phone, so it is not the guess)', async ({ page }) => {
  test.setTimeout(480_000);
  await phone(page, 4, 3);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await choose(page, { performance: 'Detail' });
  await expect(page.getByTestId('picture-quality').getByRole('radio', { name: 'Auto' })).toBeChecked();
  await expect(page.getByTestId('picture-quality-note'), 'Detail asks for High on a Low phone: the same heads-up').toBeVisible();
  await closeSettings(page);
  await buildKatoomba(page);

  const p = await probe(page);
  expectTier(p, 'high');
  expect(p.info).toMatchObject({ source: 'option', guess: 'low' });
});

test("Auto under Balanced is the guess of the page's own navigator values", async ({ page }) => {
  test.setTimeout(360_000);
  await phone(page, 6, 4);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('performance').getByRole('radio', { name: 'Balanced' })).toBeChecked();
  await expect(page.getByTestId('picture-quality').getByRole('radio', { name: 'Auto' })).toBeChecked();
  await expect(page.getByTestId('picture-quality-note')).toBeHidden();
  await closeSettings(page);
  await buildKatoomba(page);

  const p = await probe(page);
  const expected = guessQuality(p.navigator);
  expect(expected, 'the stubbed phone is neither Low nor High, so the guess is told apart from both overrides').toBe('medium');
  expectTier(p, expected);
  expect(p.info).toMatchObject({ source: 'guess', guess: expected, cores: 6, memoryGb: 4 });
  await expect.poll(() => windSway(page)).toBe(true);
});
