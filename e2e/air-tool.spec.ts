/**
 * The Air slices tool's placement flow, in the real app (plan section 8.3). It does not need the side-view panel's picture: it checks the
 * tool around it (the Tools entry, the controls, the crosshair, the marks on the map, what is written to the layers, Back and Escape,
 * focus), and that the panel is a lazy chunk. Where the scene does not publish a slice yet (`view.slice` absent), the spec gives the real
 * view a minimal stand-in for it, so the same spec keeps working once the scene's own `slice()` is there.
 *
 *   - the Tools menu lists "Air slices"; the 2-D map says "The side view needs the 3-D view." and loads nothing
 *   - the side view's chunk is asked for when the tool opens, not at start-up; a chunk that fails leaves one line, a Try again button and
 *     the controls working
 *   - Set start (A): the crosshair shows, a REAL one-finger touch pan moves the map under it, a tap sets a dashed mark (the two-step
 *     confirm for gloves) and "Place A here" keeps that point as A; a tap with nothing being placed does nothing; B is refused while
 *     too close to A ("Make the line longer than ..."), then placed: a and b are written together with preset null and the field Speed
 *   - marks A, B and the line on the map; Swap; a preset writes the live line and clears a and b; Me to fire is disabled with its reason
 *   - Back (Escape) drops a placement first and closes the tool next; focus goes back to the Tools button; nothing pops up by itself
 */
import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, armPopupWatch, openMenu, popups, watchPopups } from './helpers';

// The software-GL test browser draws about one frame per second whatever the resolution.
test.use({ deviceScaleFactor: 1 });

type Cs = { enabled: boolean; a?: [number, number]; b?: [number, number]; preset?: string | null; field?: string };
type Win = {
  __cs?: Cs | null;
  __csCount?: number;
  __firesim: {
    view: {
      slice?: unknown;
      setLayers(l: Record<string, unknown>): void;
      pickGround(x: number, y: number): [number, number] | null;
      lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void;
      rig?: { update(now: number): boolean };
    };
  };
};

async function buildMock(page: Page): Promise<void> {
  await page.goto('/?mock=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
}

async function buildReal(page: Page): Promise<void> {
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
}

/**
 * Record what the tool writes to the view (`__cs`), and when the scene publishes no slice yet give it a stand-in: the line the layers
 * describe (a hand-placed one, or a fixed one for a preset) and the four presets, so the tool's controls have what they read.
 */
async function watchLayers(page: Page): Promise<'stand-in' | 'scene'> {
  return page.evaluate(() => {
    const w = window as unknown as Win;
    const v = w.__firesim.view as Win['__firesim']['view'] & { onSlice?: (cb: (u: unknown) => void) => () => void };
    const own = typeof v.slice === 'function';
    const subs = new Set<(u: unknown) => void>();
    w.__cs = null;
    w.__csCount = 0;
    const lineOf = (cs: Cs): { a: [number, number]; b: [number, number]; dir: [number, number]; length: number } | null => {
      const [a, b] = cs.preset ? [[-1000, -300] as [number, number], [1000, -300] as [number, number]] : [cs.a, cs.b];
      if (!a || !b) return null;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return { a, b, dir: [(b[0] - a[0]) / length, (b[1] - a[1]) / length], length };
    };
    const update = (): unknown => {
      const cs = w.__cs;
      if (!cs || !cs.enabled) return null;
      const line = lineOf(cs);
      return {
        field: cs.field ?? 'speed',
        fields: {},
        data: null,
        presets: { along: { ok: true }, across: { ok: true }, slope: { ok: true }, me: { ok: false, issue: 'no-user' } },
        resolved: { line, source: cs.preset ? 'preset' : line ? 'endpoints' : 'centre', preset: cs.preset ?? null, issue: null, notes: [], minLengthM: 300 },
      };
    };
    const orig = v.setLayers.bind(v);
    v.setLayers = (l: Record<string, unknown>): void => {
      if (l.crossSection) {
        w.__cs = { ...(l.crossSection as Cs) };
        w.__csCount = (w.__csCount ?? 0) + 1;
      }
      orig(l);
      if (!own && l.crossSection) for (const cb of subs) cb(update());
    };
    if (!own) {
      (v as { slice?: () => unknown }).slice = update;
      v.onSlice = (cb) => {
        subs.add(cb);
        return () => subs.delete(cb);
      };
    }
    return own ? 'scene' : 'stand-in';
  });
}

const cs = (page: Page): Promise<Cs | null> => page.evaluate(() => (window as unknown as Win).__cs ?? null);

/** Real touch through the DevTools protocol (one finger), so the browser produces pointer events with pointerType 'touch'. */
async function touchDrag(page: Page, cdp: CDPSession, from: [number, number], to: [number, number], steps = 8): Promise<void> {
  const frame = (): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  const pt = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(...from) });
  await frame();
  for (let s = 1; s <= steps; s++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from[0] + ((to[0] - from[0]) * s) / steps, from[1] + ((to[1] - from[1]) * s) / steps) });
    await frame();
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: pt(...to) });
  await frame();
}

/** Let the camera come to rest (the rig's per-frame update, run many times without drawing), as the gesture specs do. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rig = (window as unknown as Win).__firesim.view.rig;
    const t0 = performance.now() + 4000;
    for (let i = 0; i < 100; i++) rig?.update(t0 + i * 16);
  });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
}

const crosshairBox = async (page: Page): Promise<{ x: number; y: number }> => {
  const b = (await page.locator('.sim-screen .crosshair').boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const groundAtCrosshair = async (page: Page): Promise<[number, number] | null> => {
  const c = await crosshairBox(page);
  return page.evaluate(([x, y]) => (window as unknown as Win).__firesim.view.pickGround(x!, y!), [c.x, c.y]);
};

async function openAirTool(page: Page): Promise<void> {
  await openMenu(page, 'tools');
  await page.getByTestId('tool-air').click();
  await expect(page.getByTestId('air-panel')).toBeVisible();
}

test('2-D map: the tool is in the Tools menu, says it needs the 3-D view, and asks for no chunk', async ({ page }) => {
  const chunks: string[] = [];
  page.on('request', (r) => /slicePanel/i.test(r.url()) && chunks.push(r.url()));
  await buildMock(page);
  await openMenu(page, 'tools');
  await expect(page.getByTestId('tool-air')).toContainText('Air slices');
  await page.getByTestId('tool-air').click();
  await expect(page.getByTestId('air-panel')).toBeVisible();
  await expect(page.getByTestId('slice-needs-3d')).toHaveText('The side view needs the 3-D view.');
  await expect(page.getByTestId('slice-controls')).toHaveCount(0);
  await page.getByTestId('air-close').click();
  await expect(page.getByTestId('air-panel')).toHaveCount(0);
  expect(chunks).toEqual([]);
});

test('a side-view chunk that fails to load leaves one line, Try again, and the controls working; a failed retry says to reopen the app', async ({ page }) => {
  test.info().annotations.push({ type: 'network-failures' });
  await page.route(/slicePanel[^/]*\.js/, (route) => route.abort());
  await buildMock(page);
  await watchLayers(page);
  await openAirTool(page);
  await expect(page.getByTestId('slice-load-failed')).toBeVisible();
  await expect(page.getByTestId('slice-load-failed')).toContainText('The side view could not be loaded.');
  await expect(page.getByTestId('slice-load-failed')).not.toContainText('reopen');
  await expect(page.getByTestId('slice-load-retry')).toBeVisible();
  await expect(page.getByTestId('slice-controls')).toBeVisible();
  // Try again fails the same way (a browser remembers a module that failed to load): the words say what can be done, and there is no button that cannot work
  await page.getByTestId('slice-load-retry').click();
  await expect(page.getByTestId('slice-load-failed')).toContainText('Close and reopen FireSim to load it.');
  await expect(page.getByTestId('slice-load-retry')).toBeHidden();
  await expect(page.getByTestId('slice-controls')).toBeVisible();
  await page.getByTestId('slice-presets-toggle').click();
  await page.getByTestId('slice-preset-along').click();
  await expect.poll(() => cs(page)).toMatchObject({ enabled: true, preset: 'along' });
  await expect(page.getByTestId('air-panel')).toBeVisible();
});

test('placing a line with the crosshair after a real touch pan, Swap, a preset, Back and Escape, and focus', async ({ page }) => {
  test.setTimeout(420_000);
  const chunks: string[] = [];
  page.on('request', (r) => /slicePanel/i.test(r.url()) && chunks.push(r.url()));
  await watchPopups(page);
  await buildReal(page);
  const mode = await watchLayers(page);
  console.log(`[air-tool] the scene's own slice: ${mode === 'scene'}`);
  await page.evaluate(() => {
    const v = (window as unknown as Win).__firesim.view;
    v.setLayers({ vegetation: false, understorey: false, wind: 'off', flames: false, smoke: false, embers: false, roads: false, fireTrails: false, placeNames: false, imagery: false, insightMarkers: false });
    v.lookAt(0, 0, 3000, 200, 52, false);
  });
  await settle(page);
  await armPopupWatch(page);
  expect(chunks, 'the side view is not asked for at start-up').toEqual([]);

  // ───────── open: the controls, the chunk, the crosshair is not there yet ─────────
  await openAirTool(page);
  await expect(page.getByTestId('slice-controls')).toBeVisible();
  await expect.poll(() => chunks.length, { message: 'the chunk is asked for when the tool opens' }).toBeGreaterThan(0);
  await expect(page.locator('.sim-screen .crosshair')).toBeHidden();
  await expect(page.getByTestId('slice-swap')).toBeDisabled();
  await expect(page.getByTestId('slice-note')).toBeHidden();
  expect(await cs(page)).toBeNull(); // opening the tool changes no layer

  // Every button is a real 44 px target (the visual height of a .btn is 40 and its hit area 44).
  for (const id of ['slice-set-a', 'slice-set-b', 'slice-swap', 'slice-presets-toggle']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.height, id).toBeGreaterThanOrEqual(40);
    expect(b.width, id).toBeGreaterThanOrEqual(44);
  }

  // ───────── presets: four, Me to fire disabled with its reason ─────────
  await page.getByTestId('slice-presets-toggle').click();
  await expect(page.getByTestId('slice-presets-toggle')).toHaveAttribute('aria-expanded', 'true');
  for (const [id, label] of [['along', 'Along the wind'], ['across', 'Across the wind'], ['slope', 'Up the slope'], ['me', 'Me to fire']] as const) await expect(page.getByTestId(`slice-preset-${id}`)).toContainText(label);
  await expect(page.getByTestId('slice-preset-me')).toBeDisabled();
  await expect(page.getByTestId('slice-presets-toggle').locator('xpath=ancestor::*[@data-testid="slice-controls"]')).toContainText('This run has no position for you');
  await page.getByTestId('slice-presets-toggle').click();
  await expect(page.getByTestId('slice-preset-along')).toBeHidden();

  // A tap on the map with the tool open but nothing being placed does nothing.
  await page.touchscreen.tap(206, 300);
  await page.waitForTimeout(500);
  await expect(page.locator('.annotations .ann-slice-end')).toHaveCount(0);

  // ───────── Set start (A): the crosshair, a real touch pan, a tap for the two-step confirm, Place A here ─────────
  await page.getByTestId('slice-set-a').click();
  await expect(page.locator('.sim-screen .crosshair')).toBeVisible();
  await expect(page.getByTestId('slice-place')).toHaveText('Place A here');
  await expect(page.getByTestId('slice-place')).toBeFocused();
  await expect(page.getByTestId('slice-note')).toContainText('Move the map until the cross is over the start (A)');
  const cdp = await page.context().newCDPSession(page);
  const c0 = await crosshairBox(page);
  const under0 = await groundAtCrosshair(page);
  expect(under0).not.toBeNull();
  await touchDrag(page, cdp, [c0.x + 40, c0.y + 110], [c0.x - 20, c0.y - 110]);
  await settle(page);
  await expect.poll(async () => (await groundAtCrosshair(page)) ?? [NaN, NaN], { message: 'the one-finger pan moved the map under the cross while placing' }).not.toEqual(under0);
  // The two-step confirm of a wet screen or a glove: a tap sets the point (a dashed mark), "Place A here" confirms it, and it is the
  // tapped point that is placed, not the one under the cross.
  const crossGround = (await groundAtCrosshair(page))!;
  const tapAt: [number, number] = [c0.x + 35, c0.y - 25];
  const aPoint = (await page.evaluate(([x, y]) => (window as unknown as Win).__firesim.view.pickGround(x!, y!), tapAt))!;
  const tapAway = Math.hypot(aPoint[0] - crossGround[0], aPoint[1] - crossGround[1]);
  expect(tapAway, 'the tapped point is not the one under the cross, and (for the too-short check below) not far from it').toBeGreaterThan(40);
  expect(tapAway).toBeLessThan(280);
  await page.touchscreen.tap(...tapAt);
  await expect(page.locator('.annotations .ann-slice-end')).toHaveCount(1);
  await expect(page.locator('.annotations .ann-slice-end circle')).toHaveAttribute('style', /stroke-dasharray/);
  await expect(page.getByTestId('slice-note')).toContainText('The mark shows where A will go. Press Place A here');
  await expect(page.getByTestId('slice-place')).toBeEnabled();
  await page.getByTestId('slice-place').click();
  await expect(page.locator('.sim-screen .crosshair')).toBeHidden();
  expect(await cs(page), 'a lone end is never written').toBeNull();
  await expect(page.getByTestId('slice-note')).toHaveText('Start (A) is set. Now set the end (B).');
  await expect(page.locator('.annotations .ann-slice-end')).toHaveCount(1);
  await expect(page.locator('.annotations .ann-slice-end text')).toHaveText('A');
  await expect(page.locator('.annotations .ann-slice-end circle')).not.toHaveAttribute('style', /stroke-dasharray/); // placed: a solid mark now
  await expect(page.getByTestId('slice-set-b')).toBeFocused();

  // ───────── Set end (B): too close to A is refused in words, then a pan and Place B here ─────────
  await page.getByTestId('slice-set-b').click();
  await expect(page.getByTestId('slice-place')).toHaveText('Place B here');
  await expect(page.getByTestId('slice-place')).toBeDisabled(); // the cross is still within 300 m of A
  await expect(page.getByTestId('slice-note')).toHaveText('Make the line longer than 300 m');
  await touchDrag(page, cdp, [c0.x + 30, c0.y - 100], [c0.x - 10, c0.y + 120]);
  await settle(page);
  await expect(page.getByTestId('slice-place')).toBeEnabled();
  await expect(page.getByTestId('slice-note')).not.toContainText('Make the line longer');
  const bPoint = (await groundAtCrosshair(page))!;
  expect(Math.hypot(bPoint[0] - aPoint[0], bPoint[1] - aPoint[1])).toBeGreaterThan(300);
  await page.getByTestId('slice-place').click();
  await expect.poll(() => cs(page)).toMatchObject({ enabled: true, preset: null, field: 'speed' });
  const line = (await cs(page))!;
  expect(line.a![0]).toBeCloseTo(aPoint[0], 0);
  expect(line.b![1]).toBeCloseTo(bPoint[1], 0);
  await expect(page.locator('.sim-screen .crosshair')).toBeHidden();
  await expect(page.getByTestId('slice-swap')).toBeEnabled();
  await expect(page.locator('.annotations .ann-slice-end')).toHaveCount(2);
  await expect(page.locator('.annotations path.ann-stroke')).toHaveCount(1);

  // ───────── Swap, and re-placing one end keeps the other ─────────
  const before = (await cs(page))!;
  await page.getByTestId('slice-swap').click();
  await expect.poll(async () => (await cs(page))!.a).toEqual(before.b);
  expect((await cs(page))!.b).toEqual(before.a);

  // ───────── a preset writes the live line and clears a and b ─────────
  // (the stand-in's preset line is fixed, 1 km each way from (0, -300): look at it so both ends are on the screen)
  await page.evaluate(() => (window as unknown as Win).__firesim.view.lookAt(0, -300, 3500, 200, 52, false));
  await settle(page);
  await page.getByTestId('slice-presets-toggle').click();
  await page.getByTestId('slice-preset-across').click();
  await expect.poll(() => cs(page)).toMatchObject({ enabled: true, preset: 'across' });
  if (mode === 'scene') {
    // The scene's own preset is a chord of up to 3 km each way (the stand-in's is 1 km), longer than the 3.5 km view above: back off, over
    // the middle of the line it really resolved, until both ends are on the screen (a mark is only drawn for an end that projects).
    const ends = await page.evaluate(() => {
      const l = ((window as unknown as Win).__firesim.view as unknown as { slice(): { resolved: { line: { a: [number, number]; b: [number, number] } | null } } | null }).slice()?.resolved.line;
      return l ? { a: l.a, b: l.b } : null;
    });
    expect(ends, 'the scene resolved the preset line').not.toBeNull();
    const mid: [number, number] = [(ends!.a[0] + ends!.b[0]) / 2, (ends!.a[1] + ends!.b[1]) / 2];
    let framed = false;
    for (const d of [4500, 6500, 9000, 12000, 16000]) {
      await page.evaluate(([x, y, dist]) => (window as unknown as Win).__firesim.view.lookAt(x!, y!, dist!, 200, 52, false), [mid[0], mid[1], d]);
      await settle(page);
      framed = await page.evaluate(([a, b]) => {
        const v = (window as unknown as Win).__firesim.view as unknown as { projectToScreen(x: number, y: number): [number, number] | null };
        return !!v.projectToScreen(a![0]!, a![1]!) && !!v.projectToScreen(b![0]!, b![1]!);
      }, [ends!.a, ends!.b]);
      if (framed) break;
    }
    expect(framed, 'both ends of the preset line can be put on the screen').toBe(true);
  }
  const preset = (await cs(page))!;
  expect(preset.a ?? null).toBeNull();
  expect(preset.b ?? null).toBeNull();
  await expect(page.getByTestId('slice-preset-across')).toBeHidden(); // the list folds away after a choice
  await expect(page.getByTestId('slice-presets-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('slice-presets-toggle').locator('svg path')).toHaveAttribute('d', 'M6 9l6 6 6-6'); // and its arrow points down again
  await expect(page.locator('.annotations .ann-slice-end')).toHaveCount(2);

  // ───────── Back and Escape: the placement first, then the tool; focus goes back to the Tools button ─────────
  await page.getByTestId('slice-set-a').click();
  await expect(page.locator('.sim-screen .crosshair')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sim-screen .crosshair')).toBeHidden();
  await expect(page.getByTestId('air-panel')).toBeVisible();
  await expect(page.getByTestId('slice-set-a')).toBeVisible();
  await page.getByTestId('slice-set-b').click();
  await page.getByTestId('slice-cancel').click();
  await expect(page.locator('.sim-screen .crosshair')).toBeHidden();
  await expect(page.getByTestId('slice-set-b')).toBeFocused();
  await page.getByTestId('slice-set-b').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('air-panel')).toHaveCount(0);
  await expect(page.getByTestId('tools-menu')).toBeFocused();
  await expect(page.locator('.annotations .ann-slice-end')).toHaveCount(0); // the marks belong to the open tool; the curtain stays in the scene
  expect((await cs(page))!.preset).toBe('across'); // closing the tool does not take the slice away

  // Open again: the line is still the tool's, and nothing pops up by itself.
  await openAirTool(page);
  await expect(page.getByTestId('slice-swap')).toBeEnabled();
  await expect(page.getByTestId('slice-preset-across')).toBeHidden();
  await page.getByTestId('air-close').click();
  await expect(page.getByTestId('air-panel')).toHaveCount(0);
  expect(await popups(page)).toEqual([]);
});
