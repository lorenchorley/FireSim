/**
 * "Colour the map by speed" (0.7.0, E1b) in the real app (bundled Katoomba demo, 6 km, offline, the fast tier, the real worker, a Pixel 7 profile).
 * The Wind speed heat map follows the Wind height while "Arrows and flow lines" is on; the chip under the height chips is the way in. The map's own
 * rules (values against the sampler, ranges, legends) are unit-tested (src/render/wind/windMapField.test.ts); this checks what only the real view can show:
 *
 *   - the chip is there once the arrows are on, needs a fire like the Wind speed row, and presses the heat map `overlay`; the map is at the chosen height:
 *     what the view says it painted (`overlayStats()`: raster, grid, cell, range) agrees with numbers worked out here from the snapshot, at What the fire
 *     feels, 10 m and the five heights; the legend (the view's, the map's card, the Layers panel) says which wind and the range (60 or 90 km/h)
 *   - one heat map at a time, solo heat as for any heat map, off again, and the choice is remembered
 *   - the Layers panel stays under 1,000 DOM nodes with the chips and the chip built, the chips fit at 412 x 915, 360 x 640 and 844 x 390 (nothing is
 *     clipped, every control has a 44 px hit area), and with the arrows off the map is the 10 m one again
 * Until the engine publishes the 60 m wind (lane D), the snapshot shown gets a stand-in of the same shape (e2e/fireWindFixture.ts); each test says which it used.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ensureFireWind, surfaceRangeKmh } from './fireWindFixture';
import { acceptNotice, pickTool } from './helpers';

test.use({ deviceScaleFactor: 1, actionTimeout: 45_000 });

type Stats = { overlay: string; source: 'surface' | 'height' | 'felt' | 'other'; height: string | number; nx: number; ny: number; cellM: number; minKmh: number; maxKmh: number; time: number | null } | null;
type Legend = { title: string; units: string; entries: { value: number; label: string; colour: string }[]; note?: string } | null;
type Handle = {
  __firesim: {
    view: { getLayers(): Record<string, unknown>; overlayStats?(): Stats; legend?(): Legend; groundState?(): { imagery: boolean; plain: boolean; solo: boolean; canopyVisible: boolean }; setLayers(p: Record<string, unknown>): void; renderNow(): void };
    session: { state: { get(): { snapshot: { atmosphere?: { nz: number } } | null } } };
  };
};

const layersOf = (page: Page): Promise<Record<string, unknown>> => page.evaluate(() => (window as unknown as Handle).__firesim.view.getLayers());
const stats = (page: Page): Promise<Stats> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.renderNow(); // (the map is made when the layer or the picture changes; a frame is drawn so what was asked for is there)
    return v.overlayStats?.() ?? null;
  });
const legend = (page: Page): Promise<Legend> => page.evaluate(() => (window as unknown as Handle).__firesim.view.legend?.() ?? null);
const airPicture = (page: Page): Promise<boolean> => page.evaluate(() => ((window as unknown as Handle).__firesim.session.state.get().snapshot?.atmosphere?.nz ?? 0) > 0);

/** Katoomba, 6 km, the fast tier, the hot NW wind preset, offline; waits for the air. */
async function build(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('detail').getByRole('radio', { name: /^Fast/ }).check({ force: true });
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await expect.poll(() => airPicture(page), { timeout: 90_000 }).toBe(true);
}

/** Mark a fire at the crosshair (the Wind speed row, and so the chip, need one), and wait for the picture the engine makes of it (a stand-in picture of the 60 m wind must not be put on the one that is about to be replaced). */
async function markFire(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __snapBefore?: unknown } & Handle;
    w.__snapBefore = w.__firesim.session.state.get().snapshot;
  });
  await pickTool(page, 'fire');
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await expect(page.getByTestId('fire-panel')).toHaveCount(0);
  await page.waitForFunction(() => (window as unknown as { __snapBefore?: unknown } & Handle).__firesim.session.state.get().snapshot !== (window as unknown as { __snapBefore?: unknown }).__snapBefore, undefined, { timeout: 30_000 }).catch(() => undefined);
  await expect.poll(() => airPicture(page), { timeout: 90_000 }).toBe(true);
}

/** Open the Layers panel and the arrows switch (the height chips and the map chip are built the first time it is on). */
async function openArrows(page: Page): Promise<void> {
  await page.getByTestId('layers-fab').click();
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  await page.getByTestId('layer-windGlyphs').click();
  await expect(page.getByTestId('wind-height')).toBeVisible();
}

const HEIGHTS = [
  ['What the fire feels', 'felt'],
  ['10 m', 'fire'],
  ['50 m', 50],
  ['100 m', 100],
  ['300 m', 300],
  ['1 km', 1000],
  ['2 km', 2000],
] as const;

test('Colour the map by speed: chip, map at the chosen height, legend and numbers', async ({ page }, info) => {
  test.setTimeout(480_000);
  await build(page);
  await markFire(page);
  const felt = await ensureFireWind(page);
  info.annotations.push({ type: 'the 60 m wind', description: `${felt.source}: ${felt.nx} x ${felt.ny} cells of ${felt.cellM} m, ${felt.minKmh.toFixed(1)} to ${felt.maxKmh.toFixed(1)} km/h` });
  const surface = await surfaceRangeKmh(page);
  await openArrows(page);
  const panel = page.getByTestId('layers-panel');
  const chips = panel.getByTestId('wind-height');
  const chip = panel.getByTestId('wind-map-chip');

  // ── The chip: under the height chips, named as the owner asked, a fire is marked so it is usable, and off ──
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('Colour the map by speed');
  await expect(chip).toBeEnabled();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByTestId('wind-map-reason')).toHaveCount(0); // (made only when it is needed)
  expect(await chip.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  const chipsBox = (await chips.boundingBox())!;
  const chipBox = (await chip.boundingBox())!;
  expect(chipBox.y, 'the chip sits under the height chips').toBeGreaterThan(chipsBox.y + chipsBox.height - 1);
  expect((await layersOf(page)).overlay).toBe('none');
  expect(await stats(page), 'no heat map: no overlay statistics').toBeNull();

  // ── On: the Wind speed map, at What the fire feels (the default height), on the picture's own 60 m grid ──
  await chip.click();
  await expect.poll(async () => (await layersOf(page)).overlay).toBe('windSpeed');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('wind-glyph-caption')).toContainText('The ground is coloured by wind speed at this height; the legend shows the colours.');
  let s = (await stats(page))!;
  expect(s).toMatchObject({ overlay: 'windSpeed', source: 'felt', height: 'felt', nx: felt.nx, ny: felt.ny, cellM: felt.cellM });
  expect(s.minKmh).toBeCloseTo(felt.minKmh, 1);
  expect(s.maxKmh).toBeCloseTo(felt.maxKmh, 1); // worked out here from the Int16 values, not by the view
  expect(s.time).toBe(felt.time);
  let lg = (await legend(page))!;
  expect(lg.title).toBe('Wind speed the fire feels');
  expect(lg.entries.map((e) => e.label)).toEqual(['0', '10', '20', '30', '40', '50', '60+']);
  expect(lg.note).toContain('not a measurement');
  await expect(page.getByTestId('map-legend')).toContainText('Wind speed the fire feels'); // the card on the map
  await expect(panel.getByTestId('legend')).toContainText('Wind speed the fire feels'); // and the one under the Wind speed row (the group opens for the map on show)
  await expect(panel.locator('.lp-heat[data-layer="windSpeed"] .lp-heat-sub')).toHaveText('In km/h, the wind the fire feels');

  // ── 10 m: the map the Wind speed row has always shown, the model's surface wind on the atmosphere grid ──
  await chips.getByRole('radio', { name: '10 m', exact: true }).check({ force: true });
  await expect.poll(async () => (await stats(page))?.source).toBe('surface');
  s = (await stats(page))!;
  expect(s).toMatchObject({ height: 'fire', nx: surface.nx, ny: surface.ny, cellM: surface.cellM });
  expect(s.minKmh).toBeCloseTo(surface.min, 1);
  expect(s.maxKmh).toBeCloseTo(surface.max, 1);
  lg = (await legend(page))!;
  expect(lg.title).toBe('Wind speed near the ground');
  expect(lg.entries.map((e) => e.label)).toEqual(['0', '10', '20', '30', '40', '50', '60+']);
  expect(lg.entries.some((e) => /breeze/.test((e as { words?: string }).words ?? ''))).toBe(true); // the Beaufort words are the 10 m map's
  await expect(panel.locator('.lp-heat[data-layer="windSpeed"] .lp-heat-sub')).toHaveText('In km/h');
  const tenMax = s.maxKmh;

  // ── The five heights: a height raster on the model's grid, a range of 60 km/h up to 100 m and 90 km/h from 300 m, the title says which ──
  const seen: number[] = [];
  for (const [label, height] of HEIGHTS.slice(2)) {
    await chips.getByRole('radio', { name: label, exact: true }).check({ force: true });
    await expect.poll(async () => (await stats(page))?.height, { message: label }).toBe(height);
    s = (await stats(page))!;
    expect(s, label).toMatchObject({ overlay: 'windSpeed', source: 'height', nx: surface.nx, ny: surface.ny, cellM: surface.cellM });
    expect(Number.isFinite(s.minKmh) && Number.isFinite(s.maxKmh), label).toBe(true);
    expect(s.minKmh, label).toBeGreaterThanOrEqual(0);
    expect(s.maxKmh, label).toBeGreaterThan(0);
    expect(s.maxKmh, label).toBeLessThan(250);
    seen.push(s.maxKmh);
    lg = (await legend(page))!;
    expect(lg.title, label).toBe(`Wind speed at ${label}`);
    const top = (height as number) >= 300 ? 90 : 60;
    expect(lg.entries.map((e) => e.value), label).toEqual(top === 90 ? [0, 15, 30, 45, 60, 75, 90] : [0, 10, 20, 30, 40, 50, 60]);
    expect(lg.entries.at(-1)!.label, label).toBe(`${top}+`);
    await expect(page.getByTestId('map-legend'), label).toContainText(`Wind speed at ${label}`);
    await expect(panel.locator('.lp-heat[data-layer="windSpeed"] .lp-heat-sub'), label).toHaveText(`In km/h, at ${label}`);
    await expect(panel.getByTestId('wind-glyph-caption'), label).toContainText(`Wind at ${label} above the ground`);
  }
  // The heights are different winds (the map is not the 10 m wind painted five times).
  expect(new Set(seen.map((x) => x.toFixed(2))).size, `the five maxima ${seen.map((x) => x.toFixed(1)).join(', ')} differ (10 m: ${tenMax.toFixed(1)})`).toBeGreaterThan(1);

  // ── The arrows off: the chip goes with the height chips, the heat map stays, and it is the 10 m map again ──
  await panel.getByTestId('layer-windGlyphs').click();
  await expect(chips).toBeHidden();
  await expect(chip).toBeHidden();
  await expect.poll(async () => (await stats(page))?.source).toBe('surface');
  s = (await stats(page))!;
  expect(s).toMatchObject({ overlay: 'windSpeed', height: 'fire', nx: surface.nx });
  expect((await legend(page))!.title).toBe('Wind speed near the ground');
  await expect(panel.locator('.lp-heat[data-layer="windSpeed"] .lp-heat-sub')).toHaveText('In km/h');
  // ... and on again: the map follows the height that was left (2 km).
  await panel.getByTestId('layer-windGlyphs').click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await stats(page))?.height).toBe(2000);
  expect((await legend(page))!.title).toBe('Wind speed at 2 km');
  // ... and off with the chip.
  await chip.click();
  await expect.poll(async () => (await layersOf(page)).overlay).toBe('none');
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  expect(await stats(page)).toBeNull();
});

test('Colour the map by speed: one heat map at a time, solo heat, off, remembered', async ({ page }) => {
  test.setTimeout(480_000);
  await build(page);
  const noFireChip = async (): Promise<void> => {
    // Before a fire is marked the chip is greyed with the Wind speed row's own reason, as the row is.
    await openArrows(page);
    const chip = page.getByTestId('layers-panel').getByTestId('wind-map-chip');
    await expect(chip).toBeDisabled();
    await expect(page.getByTestId('layers-panel').getByTestId('wind-map-reason')).toHaveText('Needs a fire: mark one first');
    await expect(chip).toHaveAccessibleDescription('Needs a fire: mark one first');
    expect((await layersOf(page)).overlay).toBe('none');
    await page.getByTestId('layer-windGlyphs').click(); // arrows off again
    await expect(page.getByTestId('wind-height')).toBeHidden();
    await page.getByTestId('layers-panel').getByRole('button', { name: 'Close' }).click();
  };
  await noFireChip();
  await markFire(page);
  await ensureFireWind(page);
  await openArrows(page);
  const panel = page.getByTestId('layers-panel');
  const chip = panel.getByTestId('wind-map-chip');
  await expect(chip).toBeEnabled();
  await expect(panel.getByTestId('wind-map-reason')).toBeHidden();
  await panel.getByTestId('wind-height').getByRole('radio', { name: '100 m', exact: true }).check({ force: true });
  await expect.poll(async () => (await layersOf(page)).windHeight).toBe(100);

  // ── On: the heat map is the Wind speed map, and it stands on its own (solo heat is on by default: the photo and the canopy are hidden) ──
  await chip.click();
  await expect.poll(async () => (await layersOf(page)).overlay).toBe('windSpeed');
  const ground = (): Promise<{ imagery: boolean; plain: boolean; solo: boolean; canopyVisible: boolean } | null> => page.evaluate(() => (window as unknown as Handle).__firesim.view.groundState?.() ?? null);
  await expect.poll(async () => (await ground())?.solo).toBe(true);
  expect(await ground()).toMatchObject({ solo: true, imagery: false, canopyVisible: false });
  const fireGroup = panel.getByTestId('layer-group-fire-and-weather');
  await expect(fireGroup, 'the group of the map on show is open').toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByTestId('overlay-windSpeed')).toHaveAttribute('aria-pressed', 'true');

  // ── One heat map at a time: another one from the list takes over, and the chip lets go ──
  await panel.getByTestId('overlay-moisture').click();
  await expect.poll(async () => (await layersOf(page)).overlay).toBe('moisture');
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByTestId('overlay-windSpeed')).toHaveAttribute('aria-pressed', 'false');
  expect((await stats(page))?.source, 'another heat map is not the wind map').toBe('other');
  // The chip takes it back (the height chip is still 100 m).
  await chip.click();
  await expect.poll(async () => (await layersOf(page)).overlay).toBe('windSpeed');
  await expect(panel.getByTestId('overlay-moisture')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByTestId('overlay-windSpeed')).toHaveAttribute('aria-pressed', 'true');
  expect((await stats(page))?.height).toBe(100);

  // ── The row and the chip are one state: the row turns it off, and the chip is not pressed ──
  await panel.getByTestId('overlay-windSpeed').click();
  await expect.poll(async () => (await layersOf(page)).overlay).toBe('none');
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await chip.click();
  await expect.poll(async () => (await layersOf(page)).overlay).toBe('windSpeed');

  // ── Show on its own is the Layers panel's switch for any heat map: off brings the photo back, the chip stays pressed ──
  await panel.getByTestId('solo-heat').click();
  await expect.poll(async () => (await ground())?.solo).toBe(false);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await panel.getByTestId('solo-heat').click();
  await expect.poll(async () => (await ground())?.solo).toBe(true);

  // ── Remembered: the heat map, the arrows and the height are saved as the user's choices, and the chip saves nothing else ──
  const stored = (): Promise<{ layers: Record<string, unknown> } | null> => page.evaluate(() => JSON.parse(localStorage.getItem('firesim.layers') ?? 'null'));
  const saved = await stored();
  expect(saved?.layers).toMatchObject({ overlay: 'windSpeed', windGlyphs: true, windHeight: 100 });
  expect(Object.keys(saved!.layers).sort(), 'only the choices the user made').toEqual(['overlay', 'soloHeat', 'windGlyphs', 'windHeight']);
  await chip.click();
  await expect.poll(async () => (await layersOf(page)).overlay).toBe('none');
  expect((await stored())?.layers.overlay).toBe('none');
  await chip.click();
  await expect.poll(async () => (await stored())?.layers.overlay).toBe('windSpeed');

  // ── A new run: the arrows and the 100 m come back; the heat map waits for a fire, as any fire map does (the chip is there, unpressed and greyed with the row's reason) ──
  await page.goto('/?debug=1');
  if (await page.getByTestId('notice').isVisible()) await acceptNotice(page);
  await buildAgain(page);
  await expect.poll(() => layersOf(page).then((l) => [l.windGlyphs, l.windHeight])).toEqual([true, 100]);
  expect((await layersOf(page)).overlay, 'a heat map that needs a fire is not put back before there is one').toBe('none');
  await page.getByTestId('layers-fab').click();
  const again = page.getByTestId('layers-panel');
  await expect(again.getByTestId('wind-height').getByRole('radio', { name: '100 m', exact: true })).toBeChecked();
  await expect(again.getByTestId('wind-map-chip')).toHaveAttribute('aria-pressed', 'false');
  await expect(again.getByTestId('wind-map-chip')).toBeDisabled();
  expect((await stored())?.layers.overlay, 'what was saved is still saved').toBe('windSpeed');
});

/** A second run in the same browser profile (the first run left its preferences): the same build, on the page that is already open. */
async function buildAgain(page: Page): Promise<void> {
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('detail').getByRole('radio', { name: /^Fast/ }).check({ force: true });
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await expect.poll(() => airPicture(page), { timeout: 90_000 }).toBe(true);
}

/** The repo's tap-target rule on the controls of the Wind height block: a 44 x 44 px hit area judged at the four edge middles and four diagonals of the centre. */
const tapAudit = (page: Page): Promise<{ audited: number; misses: string[] }> =>
  page.evaluate(() => {
    const probes = [[-21, 0], [21, 0], [0, -21], [0, 21], [-15, -15], [15, 15], [-15, 15], [15, -15]] as const;
    const misses: string[] = [];
    let audited = 0;
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid="wind-height"] label.chip, [data-testid="wind-map-chip"]')) {
      if (el.closest('[hidden]')) continue;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (r.width === 0 || cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
      audited++;
      const label = el.closest('label');
      const missed = probes.filter(([dx, dy]) => {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return !(hit && (el === hit || el.contains(hit) || (label && label.contains(hit))));
      });
      if (missed.length) misses.push(`"${(el.textContent ?? '').trim()}" ${Math.round(r.width)}x${Math.round(r.height)} misses ${missed.length}/8 probes`);
    }
    return { audited, misses };
  });

test('Colour the map by speed: the Layers panel stays under 1,000 nodes and the chips wrap and fit at three sizes', async ({ page }, info) => {
  test.setTimeout(480_000);
  await build(page);
  await markFire(page);
  await ensureFireWind(page);
  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();
  const nodes = (): Promise<number> => panel.evaluate((el) => el.querySelectorAll('*').length);
  const offNodes = await nodes();
  await panel.getByTestId('layer-windGlyphs').click();
  const chips = panel.getByTestId('wind-height');
  const chip = panel.getByTestId('wind-map-chip');
  await expect(chips).toBeVisible();
  await expect(chips.getByRole('radio')).toHaveCount(7);
  await expect(chip).toBeVisible();
  const onNodes = await nodes();
  // The heat map on too (its legend and controls are built), counted for the record as the 0.5.0 budget was.
  await chip.click();
  await expect.poll(async () => (await layersOf(page)).overlay).toBe('windSpeed');
  const mapNodes = await nodes();
  const line = `[wind-map] DOM nodes of the Layers panel: ${offNodes} with the arrows off, ${onNodes} with the arrows on (seven height chips, the map chip and the caption built: +${onNodes - offNodes}), ${mapNodes} with the Wind speed map on too`;
  console.log(line);
  info.annotations.push({ type: 'Layers panel DOM nodes', description: line });
  expect(onNodes, 'the open Layers panel with the arrows on stays within 1,000 DOM nodes').toBeLessThanOrEqual(1000);
  expect(onNodes - offNodes, 'the chips, the map chip, the caption and the zoom line cost about 50 nodes, built once').toBeLessThan(80);
  await chip.click();
  await expect.poll(async () => (await layersOf(page)).overlay).toBe('none');

  // ── The chips at the three sizes the layout is judged at: every label whole (words never break inside), nothing sticks out of the panel, a 44 px hit area ──
  for (const [w, h] of [[412, 915], [360, 640], [844, 390]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(700);
    await chips.scrollIntoViewIfNeeded();
    const m = await page.evaluate(() => {
      const panelEl = document.querySelector('[data-testid="layers-panel"]') as HTMLElement;
      const pr = panelEl.getBoundingClientRect();
      const bad: string[] = [];
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) bad.push('the page scrolls sideways');
      const felt = document.querySelector('[data-testid="wind-height"] label.chip[data-value="felt"]') as HTMLElement;
      const rows = new Set<number>();
      for (const c of document.querySelectorAll<HTMLElement>('[data-testid="wind-height"] label.chip')) {
        const r = c.getBoundingClientRect();
        rows.add(Math.round(r.top));
        const t = c.querySelector('.chip-text') as HTMLElement;
        if (r.left < pr.left - 1 || r.right > pr.right + 1) bad.push(`the chip "${t.textContent}" sticks out of the panel (${Math.round(r.left)} to ${Math.round(r.right)} in ${Math.round(pr.left)} to ${Math.round(pr.right)})`);
        if (t.scrollWidth > t.clientWidth + 1) bad.push(`the label of "${t.textContent}" runs out of its chip`);
        const node = t.firstChild;
        if (node && node.nodeType === Node.TEXT_NODE) {
          for (const mm of (node.textContent ?? '').matchAll(/\S+/g)) {
            const rg = document.createRange();
            rg.setStart(node, mm.index!);
            rg.setEnd(node, mm.index! + mm[0].length);
            if (new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size > 1) bad.push(`the word "${mm[0]}" is broken across lines`);
          }
        }
      }
      const mapChip = document.querySelector('[data-testid="wind-map-chip"]') as HTMLElement;
      const mr = mapChip.getBoundingClientRect();
      if (mr.left < pr.left - 1 || mr.right > pr.right + 1) bad.push('the map chip sticks out of the panel');
      const fr = felt.getBoundingClientRect();
      return { bad, rows: rows.size, feltWidth: Math.round(fr.width), panelWidth: Math.round(pr.width), feltH: Math.round(fr.height), mapH: Math.round(mr.height), mapText: mapChip.textContent!.trim() };
    });
    expect(m.bad, `${w}x${h}`).toEqual([]);
    expect(m.mapText).toBe('Colour the map by speed');
    expect(m.feltWidth, `${w}x${h}: What the fire feels has the first row to itself`).toBeGreaterThan(m.panelWidth * 0.6);
    expect(m.rows, `${w}x${h}: the felt chip's row, then the six numbered chips in two rows of three (or more rows where they do not fit)`).toBeGreaterThanOrEqual(3);
    const a = await tapAudit(page);
    expect(a.audited, `${w}x${h}: the chips were reached`).toBeGreaterThanOrEqual(7);
    expect(a.misses, `${w}x${h}: every chip has a 44 x 44 px hit area`).toEqual([]);
  }
  await page.setViewportSize({ width: 412, height: 915 });
});
