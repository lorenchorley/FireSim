/**
 * The Air slice side-view panel in the real app (plan §8.1, §8.5, §8.8), bundled Katoomba demo, real worker, both tiers (each
 * test pins its tier by the Detail choice). What it checks:
 *  - the picture: the canvas draws the slice of a preset line ("Along the wind", through the map centre when there is no fire);
 *  - the chips: all six on the 3-D air, Temp and Smoke off with their reason and the "Use the 3-D atmosphere" button on the
 *    fast tier, a tap on a chip colours the slice by it and on a disabled one does nothing;
 *  - the probe: a tap puts a readout under the picture, a different tap changes it, the clear button, the arrow keys and Escape;
 *  - "Show model cells" redraws the picture (nearest neighbour) and says nothing else;
 *  - the honest footer: the kind of air, the model grid and the time of the air, always in view;
 *  - landscape 844x390: the canvas and the footer stay in view while the chips and the controls scroll under them (a reading takes the footer's line);
 *  - reduced motion: static arrows instead of streaks, and a picture that holds still.
 * It drives the tool (lane slicetool) by the Tools menu entry `tool-air` and its preset button `slice-preset-along`; the panel's own
 * parts by the test ids of slicePanel.ts (`slice-canvas`, `slice-chip-<field>`, `slice-readout`, `slice-footer`, ...). Nothing in
 * the console (the guard of ./fixtures).
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, openMenu } from './helpers';

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

/** The kind of air of the picture the scene shows now ('prognostic', 'diagnosed'), once it has one. */
const airKind = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const s = (window as unknown as { __firesim: { session: { state: { get(): { snapshot: { atmosphere?: { kind?: string } } | null } } } } }).__firesim.session.state.get().snapshot;
    return s?.atmosphere?.kind ?? null;
  });

/** Open the Air slices tool and put the line "Along the wind" (one tap on a preset), then wait for the panel to draw it. */
async function openSlice(page: Page): Promise<Locator> {
  await expect.poll(() => airKind(page), { timeout: 60_000 }).not.toBeNull();
  await openMenu(page, 'tools');
  await page.getByTestId('tool-air').click();
  await expect(page.getByTestId('air-panel')).toBeVisible();
  const along = page.getByTestId('slice-preset-along');
  if (!(await along.isVisible())) await page.getByTestId('slice-presets-toggle').click();
  await along.click();
  const canvas = page.getByTestId('slice-canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(canvas).not.toHaveAttribute('data-seq', '', { timeout: 30_000 });
  return canvas;
}

/** How much of the canvas is painted, and a checksum of its pixels (a coarse one: every 5th pixel of every 3rd row). */
async function paint(canvas: Locator): Promise<{ painted: number; sum: number }> {
  return canvas.evaluate((c: HTMLCanvasElement) => {
    // read a copy: repeated getImageData on the panel's own canvas makes Chromium warn (and the console guard fails the test)
    const copy = document.createElement('canvas');
    copy.width = c.width;
    copy.height = c.height;
    const g = copy.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    let sum = 0;
    let n = 0;
    for (let y = 0; y < c.height; y += 3) {
      for (let x = 0; x < c.width; x += 5) {
        const k = (y * c.width + x) * 4;
        n++;
        if (d[k + 3]! > 0) painted++;
        sum = (sum * 31 + d[k]! + 3 * d[k + 1]! + 7 * d[k + 2]! + 11 * d[k + 3]!) % 1_000_003;
      }
    }
    return { painted: painted / n, sum };
  });
}

const press = async (page: Page, canvas: Locator, fx: number, fy: number): Promise<void> => {
  const b = (await canvas.boundingBox())!;
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
};

test('3-D air: the picture, six chips, the probe, model cells and the honest footer', async ({ page }) => {
  test.setTimeout(420_000);
  // Reduced motion keeps the picture still, so a changed checksum below means the picture was redrawn, not that a streak moved.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await build(page, 'Normal');
  // Auto keeps the 3-D air unless this machine is far too slow for it: switch the run to the 3-D atmosphere if it chose the fast tier.
  await expect.poll(() => airKind(page), { timeout: 60_000 }).not.toBeNull();
  if ((await airKind(page)) !== 'prognostic') {
    await page.evaluate(() => (window as unknown as { __firesim: { session: { controller: { setQuality(t: string): void } } } }).__firesim.session.controller.setQuality('standard'));
    await expect.poll(() => airKind(page), { timeout: 240_000 }).toBe('prognostic');
  }
  const canvas = await openSlice(page);
  const panel = page.getByTestId('slice-panel');

  // The picture: the field, the ground, the axes: most of the canvas is painted.
  expect((await paint(canvas)).painted).toBeGreaterThan(0.4);
  await expect(canvas).toHaveAttribute('data-field', 'speed');

  // The footer says what this is, in plain words, and is in view.
  const footer = page.getByTestId('slice-footer');
  await expect(footer).toBeVisible();
  await expect(footer).toContainText('3-D time-stepped air');
  await expect(footer).toContainText(/model grid \d+ m/);
  await expect(footer).toContainText(/air from \d\d:\d\d/);
  await expect(footer).toBeInViewport();

  // Six chips, all on the 3-D air; none needs the button.
  for (const id of ['speed', 'along', 'up', 'across', 'theta', 'smoke']) await expect(page.getByTestId(`slice-chip-${id}`)).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('slice-use3d')).toHaveCount(0);
  await expect(page.getByTestId('slice-chip-speed')).toHaveAttribute('aria-pressed', 'true');
  const speedPaint = await paint(canvas);
  await page.getByTestId('slice-chip-up').click();
  await expect(page.getByTestId('slice-chip-up')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('slice-chip-speed')).toHaveAttribute('aria-pressed', 'false');
  await expect(canvas).toHaveAttribute('data-field', 'up');
  expect((await paint(canvas)).sum).not.toBe(speedPaint.sum);
  await expect(page.getByTestId('slice-legend')).toBeVisible();
  await page.getByTestId('slice-chip-theta').click();
  await expect(canvas).toHaveAttribute('data-field', 'theta');
  await page.getByTestId('slice-chip-speed').click();

  // The probe: a tap in the air high in the picture reads the wind there; a tap at another place reads something else.
  const readout = page.getByTestId('slice-readout');
  await expect(readout).toBeHidden();
  await press(page, canvas, 0.3, 0.2);
  await expect(readout).toBeVisible();
  await expect(page.getByTestId('slice-readout-text')).toContainText(/^(Wind about|Calm)/);
  const first = await page.getByTestId('slice-readout-text').innerText();
  await press(page, canvas, 0.8, 0.35);
  await expect.poll(() => page.getByTestId('slice-readout-text').innerText()).not.toBe(first);
  // the arrow keys move it, Escape clears it
  await canvas.focus();
  const before = await page.getByTestId('slice-readout-text').innerText();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.getByTestId('slice-readout-text').innerText()).not.toBe(before);
  await page.keyboard.press('Escape');
  await expect(readout).toBeHidden();
  // a tap puts it back and the clear button takes it away (a 44 px target)
  await press(page, canvas, 0.5, 0.25);
  await expect(readout).toBeVisible();
  const clear = page.getByTestId('slice-probe-clear');
  const cb = (await clear.boundingBox())!;
  expect(Math.min(cb.width, cb.height)).toBeGreaterThanOrEqual(40);
  await clear.click();
  await expect(readout).toBeHidden();

  // Model cells: the picture is redrawn from the model's own blocks, and goes back.
  const smooth = await paint(canvas);
  await page.getByTestId('slice-cells').click();
  await expect.poll(async () => (await paint(canvas)).sum).not.toBe(smooth.sum);
  await expect(page.getByTestId('slice-cells').getByRole('switch')).toBeChecked();
  await page.getByTestId('slice-cells').click();
  await expect(page.getByTestId('slice-cells').getByRole('switch')).not.toBeChecked();

  // A text alternative, and the controls the tool gave it are in the panel.
  await expect(canvas).toHaveAttribute('aria-label', /Side view of the air along a .* line from A to B/);
  await expect(canvas).toHaveAttribute('tabindex', '0');
  await expect(panel.getByTestId('slice-controls')).toBeAttached();
});

test('3-D air in landscape (844x390): the picture and the footer stay in view while the chips and the controls scroll under them', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 844, height: 390 });
  await build(page, 'Normal');
  await expect.poll(() => airKind(page), { timeout: 60_000 }).not.toBeNull();
  const canvas = await openSlice(page);
  const footer = page.getByTestId('slice-footer');
  await expect(canvas).toBeInViewport();
  await expect(footer).toBeInViewport();
  await page.waitForTimeout(800); // the tool panel slides in
  const cb = (await canvas.boundingBox())!;
  expect(cb.height).toBeGreaterThanOrEqual(80);
  expect(cb.width).toBeGreaterThan(300);
  // the one-line footer still names the kind of air, the grid and the age of the air
  await expect(footer).toContainText(/grid \d+ m/);
  await expect(footer).toContainText(/air from \d\d:\d\d/);
  // the controls are further down: scrolling the panel brings them in view, and the canvas does not move
  const along = page.getByTestId('slice-presets-toggle');
  await along.scrollIntoViewIfNeeded();
  await expect(along).toBeInViewport();
  const after = (await canvas.boundingBox())!;
  expect(Math.abs(after.y - cb.y)).toBeLessThan(2);
  await expect(canvas).toBeInViewport();
  await expect(footer).toBeInViewport();
  // a chip is within reach, and a tap there still works
  await page.getByTestId('slice-chip-along').scrollIntoViewIfNeeded();
  await page.getByTestId('slice-chip-along').click();
  await expect(canvas).toHaveAttribute('data-field', 'along');
  // a tap on the picture reads the air; the readout comes in under the pinned picture, all of it in view: there is no room for the
  // footer as well, so it gives the reading its line and is back when the reading is cleared
  await press(page, canvas, 0.4, 0.3);
  const readout = page.getByTestId('slice-readout');
  await expect(readout).toBeVisible();
  const rb = (await readout.boundingBox())!;
  const panelBottom = (await page.getByTestId('air-panel').boundingBox())!;
  expect(rb.y + rb.height, 'the whole reading is inside the panel').toBeLessThanOrEqual(panelBottom.y + panelBottom.height + 1);
  await expect(footer).toBeHidden();
  await page.getByTestId('slice-probe-clear').click();
  await expect(footer).toBeInViewport();

  // The longest reading: a line oblique to the wind has an along and an across part, and the 3-D air has a temperature clause, which
  // wraps to five lines here. Every one of them is all inside the panel (it ran under the timeline by a line before the picture was
  // 84 px and the lines 1.3 high).
  await page.evaluate(() =>
    (window as unknown as { __firesim: { view: { setLayers(l: Record<string, unknown>): void } } }).__firesim.view.setLayers({ crossSection: { enabled: true, a: [-2500, 0], b: [2500, 0], preset: null, field: 'speed' } }),
  );
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(1500);
  for (const [fx, fy] of [[0.2, 0.2], [0.5, 0.5], [0.8, 0.35]] as const) {
    await press(page, canvas, fx, fy);
    await expect(readout).toBeVisible();
    await expect(page.getByTestId('slice-readout-text')).toContainText(/across the line/);
    const ob = (await readout.boundingBox())!;
    const pb = (await page.getByTestId('air-panel').boundingBox())!;
    expect(ob.y + ob.height, `the whole reading is inside the panel (${fx}, ${fy})`).toBeLessThanOrEqual(pb.y + pb.height + 1);
  }
});

test('reduced motion: arrows instead of streaks, and a picture that holds still', async ({ page }) => {
  test.setTimeout(420_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await build(page, 'Normal');
  await expect.poll(() => airKind(page), { timeout: 60_000 }).not.toBeNull();
  const canvas = await openSlice(page);
  await expect(canvas).toHaveAttribute('data-motion', 'arrows');
  // The air may still be settling for a moment (the 3-D air's first pictures): wait until two looks 500 ms apart agree, then it must hold.
  await expect
    .poll(async () => {
      const first = (await paint(canvas)).sum;
      await page.waitForTimeout(500);
      return first === (await paint(canvas)).sum;
    }, { timeout: 60_000 })
    .toBe(true);
  const a = await paint(canvas);
  await page.waitForTimeout(1200);
  expect((await paint(canvas)).sum).toBe(a.sum); // nothing moves
  await page.getByTestId('slice-chip-up').click();
  await expect.poll(async () => (await paint(canvas)).sum).not.toBe(a.sum);
});

test('streaks move while the panel is on screen (and not under reduced motion)', async ({ page }) => {
  test.setTimeout(420_000);
  await build(page, 'Normal');
  await expect.poll(() => airKind(page), { timeout: 60_000 }).not.toBeNull();
  const canvas = await openSlice(page);
  await expect(canvas).toHaveAttribute('data-motion', 'streaks');
  const a = await paint(canvas);
  await expect.poll(async () => (await paint(canvas)).sum, { timeout: 5000 }).not.toBe(a.sum);
});

test('fast tier: Temp and Smoke are off with the reason and the button, the footer says diagnosed, and the rest works', async ({ page }) => {
  test.setTimeout(420_000);
  await build(page, 'Fast');
  await expect.poll(() => airKind(page), { timeout: 60_000 }).toBe('diagnosed');
  const canvas = await openSlice(page);
  expect((await paint(canvas)).painted).toBeGreaterThan(0.4);
  const footer = page.getByTestId('slice-footer');
  await expect(footer).toContainText('Diagnosed wind');
  await expect(footer).toContainText('terrain effects only');
  await expect(footer).toBeInViewport();
  for (const id of ['speed', 'along', 'up', 'across']) await expect(page.getByTestId(`slice-chip-${id}`)).not.toHaveAttribute('aria-disabled', 'true');
  for (const id of ['theta', 'smoke']) await expect(page.getByTestId(`slice-chip-${id}`)).toHaveAttribute('aria-disabled', 'true');
  // the reason, in the scene's own words, and the button of the Layers panel's wording
  const reasons = page.getByTestId('slice-reasons');
  await reasons.scrollIntoViewIfNeeded();
  await expect(reasons).toBeVisible();
  await expect(reasons).toContainText(/3-D atmosphere/);
  const use3d = page.getByTestId('slice-use3d');
  await expect(use3d).toBeVisible();
  await expect(use3d).toHaveText('Use the 3-D atmosphere');
  const ub = (await use3d.boundingBox())!;
  expect(ub.height).toBeGreaterThanOrEqual(40);
  // a tap on an unavailable chip does nothing
  await page.getByTestId('slice-chip-theta').click({ force: true });
  await expect(canvas).toHaveAttribute('data-field', 'speed');
  await expect(page.getByTestId('slice-chip-theta')).toHaveAttribute('aria-pressed', 'false');
  // the wind chips colour the slice, and the probe has no temperature clause
  await page.getByTestId('slice-chip-across').click();
  await expect(canvas).toHaveAttribute('data-field', 'across');
  await press(page, canvas, 0.35, 0.2);
  await expect(page.getByTestId('slice-readout')).toBeVisible();
  await expect(page.getByTestId('slice-readout-text')).not.toContainText(/warmer|cooler/);
});
