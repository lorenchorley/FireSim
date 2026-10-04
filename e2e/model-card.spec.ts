/**
 * "How this simulation works" (src/ui/screens/modelCard.ts) in the browser, on the REAL engine (Katoomba bundled demo data,
 * the 'hot NW wind' preset, offline): the card opens from the Stats tab while the run is playing and never pauses it; its
 * headline and rows carry the grid sizes the engine itself reports (window.__firesim, SimSnapshot.engine); the live rows
 * follow the engine; switching the atmosphere tier mid-run changes the wording (3-D air flow <-> fast 2-D surface wind);
 * Escape and the hardware Back button close it; nothing pops up. A second test opens the card from Setup (no run: a
 * preview planned from the form). (Its pictures, docs/screenshots/12-model-card*.png and 13-model-card-live*.png, are taken by gallery.spec.ts.)
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, armPopupWatch, popups, session, watchPopups } from './helpers';

/** Thin / no-break spaces (thousands groups, before units) as plain spaces, so the expectations stay readable. */
const norm = (s: string): string => s.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
/** A count the way the card writes it: groups of three digits from 1 000 up (spaces after norm). */
const grp = (n: number): string => (n >= 1000 ? n.toLocaleString('en-AU').replace(/,/g, ' ') : String(n));
const BAD = /\b(undefined|NaN|Infinity|\[object)\b/;

interface Engine {
  mock?: boolean;
  tier: 'fast' | 'standard' | 'high';
  tierRequested: string;
  tierCause: string;
  tierReason: string;
  atmosphere: { kind: '3d' | 'diagnostic'; nx: number; ny: number; nz: number; dxM: number; dzFirstM: number; topM: number; currentStepS: number | null };
  fire: { nx: number; ny: number; cellM: number };
  embers: { on: boolean; active: number; max: number };
  cadence: { displayStepS: number; solverMaxStepS: number; checkpointS: number };
  run: { seed: number; checkpoints: number };
  memory?: { totalBytes: number };
}

const engine = (page: Page): Promise<Engine | null> =>
  page.evaluate(() => {
    const fs = (window as unknown as { __firesim: { session: { state: { get(): { snapshot: { engine?: unknown } | null } } } } }).__firesim;
    return (fs.session.state.get().snapshot?.engine ?? null) as never;
  });

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

/** Open every collapsed group of the card (the first one is open already). */
async function openAllSections(page: Page): Promise<void> {
  const toggles = page.getByTestId('model-card').locator('.mc-toggle');
  const n = await toggles.count();
  for (let i = 0; i < n; i++) {
    const t = toggles.nth(i);
    if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
    await expect(t).toHaveAttribute('aria-expanded', 'true');
  }
}

const cardText = async (page: Page): Promise<string> => norm(await page.getByTestId('model-card').innerText());

test('model card on the real engine: opens while playing, shows the engine’s own numbers, follows a tier switch, closes with Escape and Back', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await watchPopups(page);
  await buildKatoomba(page);
  await armPopupWatch(page);

  // Mark a fire and play: the card is opened WHILE the run is going.
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tool-fire').click();
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);
  await expect.poll(async () => (await engine(page))?.atmosphere.nx ?? 0, { timeout: 120_000 }).toBeGreaterThan(0);
  const t0 = (await session(page)).viewTime;

  // The entry point in the Stats tab ("How the model runs"): it opens the card on top of the running simulation.
  await page.getByTestId('tab-stats').click();
  const detent = await page.getByTestId('dock').getAttribute('data-detent');
  expect(detent).not.toBe('closed');
  await page.getByTestId('stats-model-card').click();
  const card = page.getByTestId('model-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('training-badge')).toBeVisible();
  await expect(card).toHaveAttribute('aria-modal', 'true');
  await expect(card).toHaveAttribute('role', 'dialog');

  // Mode: live. The headline is made from the engine's report (grid sizes of whichever tier is running).
  await expect(page.getByTestId('model-card-mode')).toContainText('Live');
  const e0 = (await engine(page))!;
  expect(e0.mock).not.toBe(true);
  const headline = async (): Promise<string> => norm(await page.getByTestId('model-card-headline').innerText());
  const checkHeadline = (head: string, e: Engine): void => {
    expect(head).toContain(`Fire spreads in 2-D on a ${e.fire.cellM} m grid`);
    if (e.atmosphere.kind === '3d') {
      expect(head).toContain(`the air above it is simulated in 3-D (${e.atmosphere.nx} × ${e.atmosphere.ny} × ${e.atmosphere.nz} cells, ${Math.round(e.atmosphere.dxM)} m apart)`);
    } else {
      expect(head).toContain('the wind is a 2-D surface field');
      expect(head).not.toMatch(/simulated in 3-D/);
    }
  };
  checkHeadline(await headline(), e0);

  // Every group opens; no broken value anywhere.
  await openAllSections(page);
  expect(await cardText(page)).not.toMatch(BAD);
  for (const id of ['glance', 'limits', 'sure', 'data', 'layers', 'engine', 'words']) await expect(page.getByTestId(`model-section-${id}`)).toBeVisible();

  // The "At a glance" rows: one per component, with the engine's numbers.
  for (const id of ['terrain', 'fuel', 'weather', 'moisture', 'fire', 'atmosphere', 'coupling', 'embers', 'smoke', 'mountain', 'display', 'time']) {
    await expect(page.getByTestId(`model-row-${id}`)).toHaveCount(1);
  }
  const fireRow = norm(await page.getByTestId('model-row-fire').innerText());
  expect(fireRow).toContain('2-D');
  expect(fireRow).toContain(`${e0.fire.cellM} m cells (${e0.fire.nx} × ${e0.fire.ny}`);
  const atmRow = norm(await page.getByTestId('model-row-atmosphere').innerText());
  if (e0.atmosphere.kind === '3d') {
    expect(atmRow).toContain('3-D');
    expect(atmRow).toContain(`${e0.atmosphere.nx} × ${e0.atmosphere.ny} columns ${Math.round(e0.atmosphere.dxM)} m apart, ${e0.atmosphere.nz} levels`);
  } else {
    expect(atmRow).toContain('Fast mode');
    expect(atmRow).toContain(`${e0.atmosphere.nx} × ${e0.atmosphere.ny} columns`);
  }
  expect(norm(await page.getByTestId('model-row-embers').innerText())).toContain(`${grp(e0.embers.max)} tracked particles`);
  expect(norm(await page.getByTestId('model-row-display').innerText())).toContain('Trees are decorative');
  // Evidence badges carry a word, an icon and a colour (never colour alone).
  const badges = page.getByTestId('model-card').locator('.mc-evidence');
  expect(await badges.count()).toBeGreaterThanOrEqual(12);
  for (const b of await badges.all()) {
    expect((await b.innerText()).trim().length).toBeGreaterThan(3);
    expect(await b.locator('svg').count()).toBeGreaterThan(0);
  }

  // "Data in this run" is a SHORT summary with a button to the Data sets screen (no per-data-set detail on this page).
  await expect(page.getByTestId('model-section-data-body')).toContainText('Data sets');
  expect(await page.getByTestId('model-section-data-body').locator('[data-testid^=dataset-row-]').count()).toBe(0);

  // The layer catalogue: every layer with its dimensionality and resolution.
  const layerCount = await page.getByTestId('model-section-layers-body').locator('.mc-layer').count();
  expect(layerCount).toBeGreaterThanOrEqual(30);

  // Playback was never paused by opening the card; the clock is still moving.
  await page.waitForTimeout(2500);
  const s1 = await session(page);
  expect(s1.playing).toBe(true);
  expect(s1.viewTime).toBeGreaterThan(t0);

  // The live rows: the engine rows equal the engine's report. (The test pauses to read two things at the same instant; the
  // card itself never does.)
  await page.evaluate(() => (window as unknown as { __firesim: { session: { pause(): void } } }).__firesim.session.pause());
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  await page.waitForTimeout(1600); // the card refreshes once a second
  const e1 = (await engine(page))!;
  const engBody = page.getByTestId('model-section-engine-body');
  const fact = async (id: string): Promise<string> => norm(await engBody.locator(`[data-fact="${id}"] .mc-fact-value`).innerText());
  await expect.poll(() => fact('eng-embers')).toBe(e1.embers.on ? `${grp(e1.embers.active)} of ${grp(e1.embers.max)} tracked` : 'Switched off');
  expect(await fact('eng-tier')).toBe(e1.tier === 'fast' ? 'Fast (surface wind)' : e1.tier === 'high' ? 'High (finer 3-D air)' : 'Standard (3-D air)');
  expect(await fact('eng-checkpoints')).toContain(`${e1.run.checkpoints} held`);
  expect(await fact('eng-seed')).toBe(String(e1.run.seed));
  expect(await fact('eng-display')).toContain('A picture every');
  expect(norm(await engBody.locator('[data-fact="eng-tier"] .mc-fact-note').innerText())).toContain(e1.tierReason.replace(/[   ]/g, ' ').slice(0, 30));
  checkHeadline(await headline(), e1);

  // ── Switch the tier mid-run (the worker restores the last checkpoint and re-runs): the wording follows the engine. ──
  const want: 'fast' | 'standard' = e1.tier === 'fast' ? 'standard' : 'fast';
  await page.evaluate((t) => (window as unknown as { __firesim: { session: { controller: { setQuality(t: string): void } } } }).__firesim.session.controller.setQuality(t), want);
  await page.evaluate(() => (window as unknown as { __firesim: { session: { play(): void } } }).__firesim.session.play());
  await expect.poll(async () => (await engine(page))?.tier, { timeout: 120_000 }).toBe(want);
  const e2 = (await engine(page))!;
  await expect.poll(async () => await headline(), { timeout: 10_000 }).toContain(want === 'fast' ? 'the wind is a 2-D surface field' : 'the air above it is simulated in 3-D');
  await expect.poll(() => fact('eng-tier'), { timeout: 10_000 }).toBe(want === 'fast' ? 'Fast (surface wind)' : 'Standard (3-D air)');
  checkHeadline(await headline(), e2);
  const atmNow = norm(await page.getByTestId('model-row-atmosphere').innerText());
  if (want === 'fast') {
    expect(atmNow).toContain('Fast mode: a 2-D surface wind');
    expect(atmNow).not.toContain('the air flow is simulated through time');
    expect(norm(await page.getByTestId('model-row-smoke').innerText())).toContain('Drawn only');
  } else {
    expect(atmNow).toContain('3-D: the air flow is simulated through time');
    expect(atmNow).toContain(`${e2.atmosphere.nx} × ${e2.atmosphere.ny} columns ${Math.round(e2.atmosphere.dxM)} m apart`);
    expect(norm(await page.getByTestId('model-row-smoke').innerText())).toContain('3-D: a smoke field');
  }
  expect(norm(await engBody.locator('[data-fact="eng-tier"] .mc-fact-note').innerText())).toContain('Changed during the run');
  expect(await cardText(page)).not.toMatch(BAD);

  // ── Copy as text: the whole page lands on the clipboard and an inline line confirms (no pop-up). ──
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('model-card-copy').click();
  await expect(page.getByTestId('model-card-status')).toContainText('Copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('TRAINING AID · NOT FOR OPERATIONAL USE');
  for (const w of ['At a glance', 'What it can and cannot resolve', 'How sure are we?', 'Data in this run', 'Layers and what they show', 'Engine right now', 'Words used']) expect(clip).toContain(w);
  expect(clip).not.toMatch(BAD);

  // ── Escape closes the card; the run is still going. Then Back (Android hardware Back = history back) the same. ──
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('sim')).toBeVisible();
  // ... and the simulation underneath is exactly as it was: the same panel is still open (Escape closed only the card).
  await expect(page.getByTestId('dock')).toHaveAttribute('data-detent', detent!);
  await page.getByTestId('stats-model-card').click();
  await expect(page.getByTestId('model-card')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('model-card')).toHaveCount(0);
  await expect(page.getByTestId('sim')).toBeVisible();
  await expect(page.getByTestId('dock')).toHaveAttribute('data-detent', detent!);
  expect((await session(page)).playing).toBe(true);

  expect(await popups(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('model card from Setup: a preview planned from the form, with no run behind it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });

  const hint = async (): Promise<RegExpExecArray> => {
    const m = /(\d+) m cells, (\d+) × (\d+)/.exec(norm(await page.getByTestId('detail-hint').innerText()));
    if (!m) throw new Error('no detail hint');
    return m;
  };
  const open = async (): Promise<void> => {
    await page.getByTestId('setup-model-card').click();
    await expect(page.getByTestId('model-card')).toBeVisible();
  };
  const close = async (): Promise<void> => {
    await page.getByTestId('model-card-close').click();
    await expect(page.getByTestId('model-card')).toHaveCount(0);
    await expect(page.getByTestId('build')).toBeVisible();
  };

  // Normal detail: the headline is the plan of the form (auto tier: 3-D if the phone is fast enough, else the fast mode).
  let [, cell, nx] = await hint();
  await open();
  await expect(page.getByTestId('training-badge')).toBeVisible();
  await expect(page.getByTestId('model-card-mode')).toContainText('preview');
  let head = norm(await page.getByTestId('model-card-headline').innerText());
  expect(head).toContain(`Planned: fire spreads in 2-D on a ${cell} m grid`);
  expect(head).toMatch(/if this phone is fast enough/);
  const fireRow = norm(await page.getByTestId('model-row-fire').innerText());
  expect(fireRow).toContain(`${cell} m cells (${nx} × ${nx}`);
  await openAllSections(page);
  // No run: the engine section says so; the data section points at the planned data.
  expect(await page.getByTestId('model-section-engine-body').innerText()).toMatch(/no engine yet/);
  expect(await cardText(page)).not.toMatch(BAD);
  await close();

  // Fast detail: the wording changes to the 2-D surface wind of the fast mode.
  await page.getByTestId('detail').getByRole('radio', { name: /^Fast/ }).check({ force: true });
  [, cell, nx] = await hint();
  await open();
  head = norm(await page.getByTestId('model-card-headline').innerText());
  expect(head).toContain(`Planned: fire spreads in 2-D on a ${cell} m grid`);
  expect(head).toContain('the wind is a 2-D surface field');
  expect(head).not.toMatch(/simulated in 3-D/);
  expect(norm(await page.getByTestId('model-row-atmosphere').innerText())).toContain('Fast mode');
  await close();

  expect(errors).toEqual([]);
});
