/**
 * "What the fire feels" (0.7.0, E2, the picture and the words) in the real app (bundled Katoomba demo, 6 km, offline, the real worker, a Pixel 7 profile):
 * the first of seven Wind height chips and the default, drawn from `SimSnapshot.fireWind` (the fire model's own wind in 60 m cells). The layer's rules are
 * unit-tested (src/render/wind/windGlyphLayer.test.ts) and so are the words (src/ui/screens/sim/glyphWords.felt.test.ts); this checks what only the real
 * view can show:
 *
 *   - the snapshot carries the picture (grid, cell, time) and the chip draws it: the layer says it reads it (`source`, `dataCellM`), the picture is not the
 *     10 m one, the caption names the wind, the cell and the age, and a picture with none is the 10 m wind with a caption that says so
 *   - the default is What the fire feels for a new profile, a saved 10 m choice is kept, the 10 m caption points to the new chip
 *   - the history keeps the picture with its keyframes: scrubbed back, the picture is the keyframe's and the caption says how old it is (the real engine only)
 *   - the words, on the fast tier and on the 3-D tier, and the calm-night sentence
 * Until the engine publishes the 60 m wind (lane D), the snapshot shown gets a stand-in of the same shape (e2e/fireWindFixture.ts); each test says which it used.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ensureFireWind } from './fireWindFixture';
import { acceptNotice, jumpWithPopover, pickTool, session, setSpeed } from './helpers';

test.use({ deviceScaleFactor: 1, actionTimeout: 45_000 });

type GlyphStats = { active: boolean; idle: string | null; level: number; cellM: number; cellPx: number; source?: 'surface' | 'felt' | 'height'; dataCellM?: number };
type Handle = {
  __firesim: {
    view: {
      getLayers(): Record<string, unknown>;
      setLayers(p: Record<string, unknown>): void;
      lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void;
      renderNow(): void;
      windGlyphStats?(): GlyphStats | null;
      update(s: unknown): void;
    };
    session: { state: { get(): { snapshot: { time: number; atmosphere?: { nz: number; kind?: string; time?: number }; fireWind?: { grid: { nx: number; ny: number; cellSize: number; x0: number }; time: number; u: Int16Array; block: number } } | null; viewTime: number } } };
    scenario: { startTime: number; weather: { timezone?: string } };
  };
};

const layersOf = (page: Page): Promise<Record<string, unknown>> => page.evaluate(() => (window as unknown as Handle).__firesim.view.getLayers());
const airKind = (page: Page): Promise<string | null> => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().snapshot?.atmosphere?.kind ?? null);
/** Draw a frame (the glyph rebuild is finished in it) and read what the layer says. */
const drawAndRead = (page: Page): Promise<GlyphStats> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.renderNow();
    return v.windGlyphStats!()!;
  });
const lookAt = (page: Page, d: number): Promise<void> => page.evaluate((dd) => (window as unknown as Handle).__firesim.view.lookAt(0, 0, dd, 200, 55, false), d);
/** The clock time the caption says for a simulation time (s), in the scenario's own zone, as the words do. */
const clockOf = (page: Page, t: number): Promise<string> =>
  page.evaluate((tt) => {
    const sc = (window as unknown as Handle).__firesim.scenario;
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: sc.weather.timezone || 'Australia/Sydney' }).format(new Date(sc.startTime + tt * 1000));
  }, t);

/** Katoomba, 6 km, the hot NW wind preset, offline, at the fast tier or the 3-D tier; waits for the air. */
async function build(page: Page, detail: 'Fast' | 'Normal' = 'Fast'): Promise<void> {
  await page.goto('/?debug=1');
  if (await page.getByTestId('notice').isVisible()) await acceptNotice(page);
  await buildOpen(page, detail);
}
async function buildOpen(page: Page, detail: 'Fast' | 'Normal' = 'Fast'): Promise<void> {
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('detail').getByRole('radio', { name: new RegExp(`^${detail}`) }).check({ force: true });
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await expect.poll(() => airKind(page), { timeout: 90_000 }).not.toBeNull();
}

/** Open the Layers panel and the arrows switch: the Wind height chips are built the first time it is on. */
async function openArrows(page: Page): Promise<void> {
  await page.getByTestId('layers-fab').click();
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  await page.getByTestId('layer-windGlyphs').click();
  await expect(page.getByTestId('wind-height')).toBeVisible();
}

test('What the fire feels: the snapshot carries the 60 m wind and the chip draws it', async ({ page }, info) => {
  test.setTimeout(480_000);
  await build(page);
  const felt = await ensureFireWind(page);
  info.annotations.push({ type: 'the 60 m wind', description: `${felt.source}: ${felt.nx} x ${felt.ny} cells of ${felt.cellM} m from x0 ${felt.x0}, ${felt.minKmh.toFixed(1)} to ${felt.maxKmh.toFixed(1)} km/h, at t = ${felt.time} s` });

  // ── The picture: 60 m cells over the fire grid, the centres a half block in (6 km at 30 m: 100 x 100 cells, x0 + 15 m) ──
  const k = Math.max(1, Math.round(60 / felt.fire.cellSize));
  expect(felt.cellM).toBe(felt.fire.cellSize * k);
  expect(felt.nx).toBe(Math.ceil(felt.fire.nx / k));
  expect(felt.ny).toBe(Math.ceil(felt.fire.ny / k));
  expect(felt.x0).toBeCloseTo(felt.fire.x0 + ((k - 1) / 2) * felt.fire.cellSize, 6);
  if (felt.fire.cellSize === 30) expect([felt.nx, felt.cellM]).toEqual([felt.fire.nx / 2, 60]);
  expect(Number.isFinite(felt.time)).toBe(true);
  expect(felt.maxKmh).toBeGreaterThan(0);
  expect(felt.maxKmh, 'a wind in km/h, not in some other unit').toBeLessThan(250);
  const types = await page.evaluate(() => {
    const fw = (window as unknown as Handle).__firesim.session.state.get().snapshot!.fireWind!;
    return { u: fw.u.constructor.name, bytes: fw.u.byteLength, block: fw.block };
  });
  expect(types).toMatchObject({ u: 'Int16Array', block: k });

  // ── The chip: the first of seven, and the default of a new profile ──
  expect((await layersOf(page)).windHeight, 'a new profile starts with What the fire feels').toBe('felt');
  await openArrows(page);
  const panel = page.getByTestId('layers-panel');
  const chips = panel.getByTestId('wind-height');
  await expect(chips.getByRole('radio')).toHaveCount(7);
  await expect(chips.getByRole('radio').first()).toHaveAccessibleName('What the fire feels');
  await expect(chips.getByRole('radio', { name: 'What the fire feels', exact: true })).toBeChecked();
  for (const l of ['10 m', '50 m', '100 m', '300 m', '1 km', '2 km']) await expect(chips.getByRole('radio', { name: l, exact: true })).toHaveCount(1);

  // ── The layer reads it: the picture's own cell, the model's cell still keys the zoom ladder, and it draws ──
  await lookAt(page, 3000);
  await expect.poll(async () => (await drawAndRead(page)).active, { timeout: 30_000 }).toBe(true);
  let s = await drawAndRead(page);
  expect(s).toMatchObject({ idle: null, source: 'felt', dataCellM: felt.cellM });
  expect(s.level).toBeGreaterThanOrEqual(1);
  expect(s.cellM, 'the ladder keeps the model cell (100 to 270 m), not the 60 m one').toBeGreaterThan(felt.cellM);
  const canvas = page.locator('canvas').first();
  const feltPixels = await canvas.screenshot();

  // ── The caption names the wind, the cell and the age ──
  const caption = panel.getByTestId('wind-glyph-caption');
  const clock = await clockOf(page, felt.time);
  await expect(caption).toContainText(`Wind the fire feels · ${felt.cellM} m cells · air from ${clock}`);
  await expect(caption).toContainText(`The wind the fire model uses in each ${felt.cellM} m cell: slope flow, lee eddies and the fire's own draw are included. It is not a measurement.`);
  await expect(caption).not.toContainText('The wind the fire feels is not in this picture');
  await expect(caption).not.toContainText('On a calm night the fire can feel much less');
  expect(await caption.innerText()).not.toMatch(/[—–]/);

  // ── The picture is not the 10 m one: the same camera, the same wind map, the lines are somewhere else ──
  await chips.getByRole('radio', { name: '10 m', exact: true }).check({ force: true });
  await expect.poll(async () => (await drawAndRead(page)).source).toBe('surface');
  s = await drawAndRead(page);
  expect(s.dataCellM, 'the 10 m wind is the model cell').toBeUndefined();
  const tenPixels = await canvas.screenshot();
  expect(Buffer.compare(feltPixels, tenPixels), 'What the fire feels is drawn differently from the 10 m wind').not.toBe(0);
  await expect(caption).toContainText('Wind about 10 m above open ground');
  await expect(caption).toContainText('On a calm night the fire can feel much less wind than this in places, and much more in others. Choose What the fire feels to see it.');
  await chips.getByRole('radio', { name: 'What the fire feels', exact: true }).check({ force: true });
  await expect.poll(async () => (await drawAndRead(page)).source).toBe('felt');

  // ── A picture with none (a replay from before 0.7.0, the demo engine): the 10 m wind is drawn, and the caption says so ──
  await page.evaluate(() => {
    const h = (window as unknown as Handle).__firesim;
    const snap = h.session.state.get().snapshot!;
    (window as unknown as { __keptFelt?: unknown }).__keptFelt = snap.fireWind;
    delete (snap as { fireWind?: unknown }).fireWind;
    h.view.update(snap);
  });
  await expect.poll(async () => (await drawAndRead(page)).source, { timeout: 30_000 }).toBe('surface');
  await expect(caption).toContainText('The wind the fire feels is not in this picture, so the 10 m wind is shown.');
  await expect(caption).toContainText('Wind about 10 m above open ground');
  await expect(caption).toContainText('On a calm night the fire can feel much less wind than this in places, and much more in others.');
  await expect(chips.getByRole('radio', { name: 'What the fire feels', exact: true }), 'the chip stays chosen; what is drawn is said').toBeChecked();
  // The picture comes back with the next snapshot (here: put back).
  await page.evaluate(() => {
    const h = (window as unknown as Handle).__firesim;
    const snap = h.session.state.get().snapshot!;
    (snap as { fireWind?: unknown }).fireWind = (window as unknown as { __keptFelt?: unknown }).__keptFelt;
    h.view.update(snap);
  });
  await expect.poll(async () => (await drawAndRead(page)).source, { timeout: 30_000 }).toBe('felt');
  await expect(caption).toContainText('Wind the fire feels');
});

test('What the fire feels: a saved 10 m choice is kept, and the choice of the chip comes back in the next run', async ({ page }) => {
  test.setTimeout(480_000);
  await build(page);
  expect((await layersOf(page)).windHeight).toBe('felt');
  await openArrows(page);
  const chips = page.getByTestId('layers-panel').getByTestId('wind-height');
  // The 10 m chip is a choice, and it is saved as one (a profile that chose it before 0.7.0 has 'fire' saved, and keeps it).
  await chips.getByRole('radio', { name: '10 m', exact: true }).check({ force: true });
  await expect.poll(async () => (await layersOf(page)).windHeight).toBe('fire');
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('firesim.layers') ?? 'null')))?.layers?.windHeight).toBe('fire');
  await page.goto('/?debug=1');
  if (await page.getByTestId('notice').isVisible()) await acceptNotice(page);
  await buildOpen(page);
  await expect.poll(() => layersOf(page).then((l) => [l.windGlyphs, l.windHeight])).toEqual([true, 'fire']);
  await page.getByTestId('layers-fab').click();
  await expect(page.getByTestId('wind-height').getByRole('radio', { name: '10 m', exact: true })).toBeChecked();
  // Choosing What the fire feels is saved too ('felt' is a value the sanitizer accepts), and is there after the next run.
  await page.getByTestId('wind-height').getByRole('radio', { name: 'What the fire feels', exact: true }).check({ force: true });
  await expect.poll(async () => (await layersOf(page)).windHeight).toBe('felt');
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('firesim.layers') ?? 'null')))?.layers?.windHeight).toBe('felt');
  await page.goto('/?debug=1');
  if (await page.getByTestId('notice').isVisible()) await acceptNotice(page);
  await buildOpen(page);
  await expect.poll(() => layersOf(page).then((l) => [l.windGlyphs, l.windHeight])).toEqual([true, 'felt']);
  // Reset puts the defaults back: What the fire feels, the arrows off, nothing saved.
  await page.getByTestId('layers-fab').click();
  await page.getByTestId('layers-reset').click();
  await expect.poll(() => layersOf(page).then((l) => [l.windGlyphs, l.windHeight])).toEqual([false, 'felt']);
  expect(await page.evaluate(() => localStorage.getItem('firesim.layers'))).toBeNull();
});

test('What the fire feels: the history keeps it with the keyframes (the real engine)', async ({ page }, info) => {
  test.setTimeout(600_000);
  await build(page);
  const felt = await ensureFireWind(page);
  test.skip(felt.source !== 'engine', 'the engine in this build does not publish SimSnapshot.fireWind yet (lane D): the history is the engine and the snapshot store, a stand-in cannot test it');
  info.annotations.push({ type: 'the 60 m wind', description: 'the engine publishes it' });
  await pickTool(page, 'fire');
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await openArrows(page);
  await page.getByTestId('layers-panel').getByRole('button', { name: 'Close' }).click();

  // ── Run 25 minutes at full speed, then stop: the newest picture carries a picture of the wind of about its own time ──
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 300_000 }).toBeGreaterThanOrEqual(1500);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  const head = await page.evaluate(() => {
    const st = (window as unknown as Handle).__firesim.session.state.get();
    return { t: st.snapshot!.time, fw: st.snapshot!.fireWind ? { time: st.snapshot!.fireWind.time, nx: st.snapshot!.fireWind.grid.nx } : null };
  });
  expect(head.fw, 'every snapshot carries it').not.toBeNull();
  expect(head.fw!.time).toBeLessThanOrEqual(head.t);
  expect(head.t - head.fw!.time, 'the fast tier refits it once a minute, the 3-D tier at every air step').toBeLessThanOrEqual(61);
  expect(head.fw!.nx).toBe(felt.nx);

  // ── Scrub back 13 minutes: the picture is the keyframe's (a keyframe every 5 minutes), not newer than the time shown, and the caption says how old it is ──
  await jumpWithPopover(page, 780);
  await expect.poll(async () => (await session(page)).viewTime).toBeCloseTo(780, -2);
  const back = await page.evaluate(() => {
    const st = (window as unknown as Handle).__firesim.session.state.get();
    const fw = st.snapshot!.fireWind;
    return { shown: st.viewTime, t: st.snapshot!.time, fw: fw ? { time: fw.time, nx: fw.grid.nx, cell: fw.grid.cellSize } : null };
  });
  expect(back.fw, 'the scrubbed picture still has it').not.toBeNull();
  expect(back.fw!).toMatchObject({ nx: felt.nx, cell: felt.cellM });
  expect(back.fw!.time, 'the picture is not from after the time shown').toBeLessThanOrEqual(back.shown + 1);
  expect(back.shown - back.fw!.time, 'and not older than one keyframe step (300 s) and a refit (60 s)').toBeLessThanOrEqual(361);
  await page.getByTestId('layers-fab').click();
  const caption = page.getByTestId('layers-panel').getByTestId('wind-glyph-caption');
  await expect(caption).toContainText(`air from ${await clockOf(page, back.fw!.time)}`);
  if (back.shown - back.fw!.time > 90) await expect(caption).toContainText('min before the time shown');
});

test('What the fire feels: the words on the fast tier, with the 10 m sentence pointing to it', async ({ page }, info) => {
  test.setTimeout(480_000);
  await build(page);
  const felt = await ensureFireWind(page);
  info.annotations.push({ type: 'the 60 m wind', description: felt.source });
  expect(await airKind(page)).toBe('diagnosed');
  await openArrows(page);
  const caption = page.getByTestId('layers-panel').getByTestId('wind-glyph-caption');
  await expect(caption).toContainText('Diagnosed wind: terrain effects only, no plume.'); // the fast tier says what it leaves out
  await expect(caption).toContainText('On the fast model it is refitted once a minute.');
  await expect(caption).toContainText(/^Wind the fire feels · \d+ m cells · air from \d\d:\d\d/);
  // The model's own words, in order: what it is, what the fast tier leaves out, what the numbers are, how often the fast tier makes them.
  const lines = (await caption.innerText()).split('\n');
  expect(lines[0]).toMatch(/^Wind the fire feels · \d+ m cells · air from \d\d:\d\d\.$/);
  expect(lines.slice(1, 5)).toEqual([
    'Diagnosed wind: terrain effects only, no plume.',
    expect.stringMatching(/^The wind the fire model uses in each \d+ m cell: .* It is not a measurement\.$/),
    'On the fast model it is refitted once a minute.',
    'On a calm night much of it is air draining downhill.', // (the contract's V6 check on calm-night-katabatic: the fire grid's wind drains downhill over most steep ground)
  ]);
  for (const line of lines) expect(line).toMatch(/\.$/);
  // Every other height keeps its own words: no calm-night sentence on a height above the ground, the 10 m one points to this chip.
  const chips = page.getByTestId('layers-panel').getByTestId('wind-height');
  await chips.getByRole('radio', { name: '300 m', exact: true }).check({ force: true });
  await expect(caption).toContainText('Wind at 300 m above the ground');
  await expect(caption).not.toContainText('calm night');
  await chips.getByRole('radio', { name: '10 m', exact: true }).check({ force: true });
  await expect(caption).toContainText('Wind about 10 m above open ground, as the model fits it to the terrain');
  await expect(caption).toContainText('Choose What the fire feels to see it.');
});
