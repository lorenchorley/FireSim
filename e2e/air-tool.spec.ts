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

const layersOf = (page: Page): Promise<Record<string, unknown>> => page.evaluate(() => ((window as unknown as { __firesim: { view: { getLayers(): Record<string, unknown> } } }).__firesim.view.getLayers()));
/** The screen-reader live region (the app's one polite announcer). */
const liveRegion = (page: Page) => page.locator('div.sr-only[aria-live="polite"]');

/** Android's font scale at `k` (system text zoom scales text, not layout): every font-size and line-height token times k (as integration.spec does). */
async function fontScale(page: Page, k: number): Promise<void> {
  await page.evaluate((scale) => {
    document.getElementById('font-scale')?.remove();
    const cs = getComputedStyle(document.documentElement);
    const decl: string[] = [];
    for (const n of ['xs', 'sm', 'md', 'lg', 'xl', '2xl']) decl.push(`--fs-${n}: ${parseFloat(cs.getPropertyValue(`--fs-${n}`)) * scale}px !important`);
    for (const n of ['xs', 'sm', 'md', 'lg', 'xl']) {
      const v = parseFloat(cs.getPropertyValue(`--lh-${n}`));
      if (Number.isFinite(v)) decl.push(`--lh-${n}: ${v * scale}px !important`);
    }
    const st = document.createElement('style');
    st.id = 'font-scale';
    st.textContent = `:root { ${decl.join('; ')} }`;
    document.head.append(st);
  }, k);
  await page.waitForTimeout(250);
}

/**
 * What is wrong with the tool's tabs, chips and switch at this text size: a word broken inside itself (a range over the word has rectangles on two
 * lines), a label that runs out of its tab or chip, a control that sticks out of the panel's sides or has no size, the page scrolling sideways.
 */
async function toolDamage(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    const panel = document.querySelector('[data-testid="air-panel"]') as HTMLElement;
    const pr = panel.getBoundingClientRect();
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) bad.push('the page scrolls sideways');
    const shown = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const words = panel.querySelectorAll('[data-testid="slice-tabs"] .segmented-main, [data-testid="wind-height"] .chip-text, [data-testid="layer-windGlyphs"] .toggle-label');
    for (const el of words) {
      if (!shown(el)) continue;
      const node = el.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;
      for (const m of (node.textContent ?? '').matchAll(/\S+/g)) {
        const r = document.createRange();
        r.setStart(node, m.index!);
        r.setEnd(node, m.index! + m[0].length);
        const lines = new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
        if (lines.size > 1) bad.push(`the word "${m[0]}" is broken across lines`);
      }
    }
    const inside = (what: string, el: Element, box: DOMRect, slack = 1): void => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) bad.push(`${what} has no size`);
      else if (r.left < box.left - slack || r.right > box.right + slack) bad.push(`${what} sticks out (${Math.round(r.left)} to ${Math.round(r.right)} in ${Math.round(box.left)} to ${Math.round(box.right)})`);
    };
    for (const el of panel.querySelectorAll('[data-testid="slice-tabs"] .slice-tab, [data-testid="air-close"], [data-testid="wind-height"] label.chip, [data-testid="layer-windGlyphs"]')) {
      if (el.closest('[hidden]')) continue;
      inside(el.getAttribute('data-testid') ?? el.textContent!.trim(), el, pr);
    }
    for (const face of panel.querySelectorAll('[data-testid="slice-tabs"] .segmented-face')) inside(`the label of the tab "${face.textContent!.trim()}"`, face.querySelector('.segmented-text')!, face.getBoundingClientRect());
    for (const chip of panel.querySelectorAll('[data-testid="wind-height"] label.chip')) {
      if (shown(chip)) inside(`the label of the chip "${chip.textContent!.trim()}"`, chip.querySelector('.chip-text')!, chip.getBoundingClientRect());
    }
    return bad;
  });
}

/** Pictures for a look by eye, when asked for (FIRESIM_SHOTS is a folder). */
async function shot(page: Page, name: string): Promise<void> {
  if (process.env.FIRESIM_SHOTS) await page.screenshot({ path: `${process.env.FIRESIM_SHOTS}/${name}.png` });
}

test('2-D map: no tabs (the tool is one line)', async ({ page }) => {
  await buildMock(page);
  await openAirTool(page);
  await expect(page.getByTestId('slice-needs-3d')).toBeVisible();
  await expect(page.getByTestId('slice-tabs')).toHaveCount(0);
});

test('Side view and Map view tabs: the header fits, the Map view is the Layers panel’s arrows controls (one state, both ways), a placement is dropped, the tab is kept, and Turn off the slice works from it', async ({ page }) => {
  test.setTimeout(480_000);
  await watchPopups(page);
  await buildReal(page);
  await watchLayers(page);
  await page.evaluate(() => {
    const v = (window as unknown as Win).__firesim.view;
    v.setLayers({ vegetation: false, understorey: false, wind: 'off', flames: false, smoke: false, embers: false, roads: false, fireTrails: false, placeNames: false, imagery: false, insightMarkers: false });
    v.lookAt(0, 0, 3000, 200, 52, false);
  });
  await settle(page);
  await armPopupWatch(page);

  await openAirTool(page);
  const tabs = page.getByTestId('slice-tabs');
  const sideTab = tabs.getByRole('tab', { name: 'Side view' });
  const mapTab = tabs.getByRole('tab', { name: 'Map view' });
  const mapView = page.getByTestId('slice-map-tab');
  const glyphLabel = page.getByTestId('layer-windGlyphs');
  const glyphSwitch = glyphLabel.getByRole('switch');
  const chips = page.getByTestId('wind-height');
  const caption = page.getByTestId('wind-glyph-caption');
  const off = page.getByTestId('slice-off');

  // ───────── the header: the title, the two tabs and Close fit in one row, at the phone sizes the tool is judged at ─────────
  await expect(sideTab).toHaveAttribute('aria-selected', 'true');
  await expect(mapTab).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('air-panel').locator('h2')).toHaveText('Air slice'); // the old subtitle "Side view" is the tab now
  for (const [w, h] of [[412, 915], [360, 640], [844, 390]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const head = document.querySelector('[data-testid="air-panel"] .panel-head')!.getBoundingClientRect();
      const t = document.querySelector('[data-testid="slice-tabs"]')!.getBoundingClientRect();
      const c = document.querySelector('[data-testid="air-close"]')!.getBoundingClientRect();
      const title = document.querySelector('[data-testid="air-panel"] h2') as HTMLElement;
      const options = [...document.querySelectorAll('[data-testid="slice-tabs"] [role="tab"]')].map((o) => o.getBoundingClientRect());
      return { head: head.height, tabsRight: t.right, tabsLeft: t.left, closeLeft: c.left, closeRight: c.right, titleClipped: title.scrollWidth > title.clientWidth + 1, titleHeight: title.getBoundingClientRect().height, optionHeights: options.map((o) => o.height), headRight: head.right };
    });
    expect(m.head, `the header is one row, as tall as it was before the tabs (49 px with its border) at ${w}x${h}`).toBeLessThanOrEqual(50);
    expect(m.tabsRight, `the tabs end before Close at ${w}x${h}`).toBeLessThanOrEqual(m.closeLeft + 1);
    expect(m.closeRight, `Close is inside the panel at ${w}x${h}`).toBeLessThanOrEqual(m.headRight + 1);
    expect(m.titleClipped, `the title is not cut off at ${w}x${h}`).toBe(false);
    expect(m.titleHeight, `the title stays on one line at ${w}x${h}`).toBeLessThanOrEqual(32);
    for (const oh of m.optionHeights) expect(oh, `a tab is a 44 px target at ${w}x${h}`).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(500);

  // ───────── the tabs are a tablist: roles, one tab in the tab order, arrow keys choose, the change is announced politely ─────────
  await expect(page.getByRole('tablist', { name: 'Air slice view' })).toHaveCount(1);
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(tabs.getByRole('radio'), 'the tabs are not a radio group any more').toHaveCount(0);
  await expect(sideTab).toHaveAttribute('tabindex', '0');
  await expect(mapTab).toHaveAttribute('tabindex', '-1');
  const panelOf = page.getByTestId('air-panel').getByRole('tabpanel');
  await expect(panelOf, 'the body is the panel of the chosen tab').toHaveAccessibleName('Side view');
  await expect(sideTab).toHaveAttribute('aria-controls', /.+/);
  expect(await sideTab.getAttribute('aria-controls')).toBe(await panelOf.getAttribute('id'));
  expect(await mapTab.getAttribute('aria-controls')).toBe(await panelOf.getAttribute('id'));
  await sideTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(mapTab).toHaveAttribute('aria-selected', 'true');
  await expect(mapTab, 'the arrow moves the focus with the choice').toBeFocused();
  await expect(sideTab).toHaveAttribute('tabindex', '-1');
  await expect(mapTab).toHaveAttribute('tabindex', '0');
  await expect(mapView).toBeVisible();
  await expect(panelOf).toHaveAccessibleName('Map view');
  await expect(liveRegion(page), 'the change is said politely, in the one live region').toHaveText('Map view: wind arrows and flow lines.');
  await expect(page.getByTestId('air-panel').locator('[role="alert"]'), 'no alert role in the tool').toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(sideTab).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab).toBeFocused();
  await expect(liveRegion(page)).toHaveText('Side view.');
  await page.keyboard.press('End');
  await expect(mapTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight'); // wraps round
  await expect(sideTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await expect(sideTab).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab).toBeFocused();

  // ───────── the Map view: the arrows switch and nothing of the side view; nothing to turn off yet ─────────
  await mapTab.click();
  await expect(mapView).toBeVisible();
  await expect(page.getByTestId('slice-canvas')).toHaveCount(0);
  await expect(page.getByTestId('slice-set-a')).toHaveCount(0);
  await expect(off, 'no slice, so nothing to turn off: the button is absent, not disabled').toBeHidden();
  await expect(chips).toHaveCount(0); // built when the switch is first on
  await expect(glyphSwitch).not.toBeChecked();
  await expect(glyphSwitch).toBeEnabled(); // the fast tier's diagnosed wind is a wind to draw
  // With the switch off the tab is not a lone switch: it is named with "Wind", and one line says what it does (and is its description).
  await expect(page.getByRole('switch', { name: 'Wind arrows and flow lines' })).toHaveCount(1);
  const intro = page.getByTestId('wind-glyph-intro');
  await expect(intro).toBeVisible();
  await expect(intro).toHaveText('Draws the wind on the map: arrows from far away, flow lines when you zoom in.');
  await expect(glyphSwitch).toHaveAccessibleDescription('Draws the wind on the map: arrows from far away, flow lines when you zoom in.');
  expect(await intro.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  await shot(page, 'map-tab-off-412x915');
  await glyphLabel.click();
  await expect.poll(async () => (await layersOf(page)).windGlyphs).toBe(true);
  await expect(intro, 'once the switch is on the caption says what is drawn, and the hint goes').toBeHidden();
  await expect(chips).toBeVisible();
  await expect(chips.getByRole('radio')).toHaveCount(7);
  await expect(chips.getByRole('radio', { name: 'What the fire feels', exact: true }), 'the first chip is What the fire feels (0.7.0), and the default').toBeChecked();
  // Its caption names the picture's 60 m wind when the engine publishes it, and says the 10 m wind is shown when it does not.
  const hasFelt = await page.evaluate(() => !!(window as unknown as { __firesim: { session: { state: { get(): { snapshot: { fireWind?: unknown } | null } } } } }).__firesim.session.state.get().snapshot?.fireWind);
  if (hasFelt) await expect(caption).toContainText(/Wind the fire feels · \d+ m cells · air from \d\d:\d\d\./);
  else await expect(caption).toContainText('The wind the fire feels is not in this picture, so the 10 m wind is shown.');
  await chips.getByRole('radio', { name: '10 m', exact: true }).check({ force: true });
  await expect.poll(async () => (await layersOf(page)).windHeight).toBe('fire');
  await expect(chips.getByRole('radio', { name: '10 m', exact: true }), 'the 10 m chip is the 10 m wind, as the caption says').toBeChecked();
  await expect(caption).toContainText('Wind about 10 m above open ground, as the model fits it to the terrain'); // the fast tier's own words
  await expect(caption).toContainText(/ · model grid \d+ m · air from \d\d:\d\d\./);
  await expect(caption).toContainText('Diagnosed wind: terrain effects only, no plume.'); // the fast tier says what it leaves out
  await expect(caption).toContainText('On a calm night the fire can feel much less wind than this in places, and much more in others.');
  await chips.getByRole('radio', { name: '300 m' }).check({ force: true });
  await expect.poll(async () => (await layersOf(page)).windHeight).toBe(300);
  await expect(caption).toContainText('Wind at 300 m above the ground');

  // ───────── one state with the Layers panel, both ways ─────────
  await page.getByTestId('air-close').click();
  await page.getByTestId('layers-fab').click();
  const layers = page.getByTestId('layers-panel');
  await expect(layers.getByTestId('layer-windGlyphs').getByRole('switch')).toBeChecked(); // flipped in the Map view, read in Layers
  await expect(layers.getByTestId('wind-height').getByRole('radio', { name: '300 m' })).toBeChecked();
  await layers.getByTestId('wind-height').getByRole('radio', { name: '1 km' }).check({ force: true }); // flipped in Layers, read in the Map view
  await expect.poll(async () => (await layersOf(page)).windHeight).toBe(1000);
  await layers.getByRole('button', { name: 'Close' }).click();
  await openAirTool(page);
  await expect(mapView, 'the tool opens on the tab it was left on').toBeVisible();
  await expect(mapTab).toHaveAttribute('aria-selected', 'true');
  await expect(glyphSwitch).toBeChecked();
  await expect(chips.getByRole('radio', { name: '1 km' })).toBeChecked();
  await expect(caption).toContainText('Wind at 1 km above the ground');

  // ───────── Escape closes the tool from a chip (a radio) and from the switch (a checkbox) in one press, as from a button; Back does too ─────────
  await chips.getByRole('radio', { name: '300 m' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('air-panel'), 'Escape on a Wind height chip closes the tool').toHaveCount(0);
  await openAirTool(page);
  await glyphSwitch.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('air-panel'), 'Escape on the switch closes the tool').toHaveCount(0);
  await openAirTool(page);
  await chips.getByRole('radio', { name: '2 km' }).focus();
  await page.goBack(); // Android hardware Back
  await expect(page.getByTestId('air-panel'), 'Back from a chip closes the tool in one press').toHaveCount(0);
  await openAirTool(page);
  await expect(chips.getByRole('radio', { name: '1 km' }), 'the keys closed the tool and changed nothing else').toBeChecked();
  await glyphLabel.click(); // off in the Map view ...
  await expect.poll(async () => (await layersOf(page)).windGlyphs).toBe(false);
  await expect(chips).toBeHidden();
  await page.getByTestId('air-close').click();
  await page.getByTestId('layers-fab').click();
  await expect(layers.getByTestId('layer-windGlyphs').getByRole('switch')).not.toBeChecked(); // ... and off in Layers
  await expect(layers.getByTestId('wind-height')).toBeHidden();
  await layers.getByRole('button', { name: 'Close' }).click();
  await openAirTool(page);

  // ───────── at Android's 200 % text size no word of the tabs, the chips or the switch breaks inside itself, and nothing sticks out or is hidden ─────────
  // (The text size is set before the tool opens, as a phone's setting is: the screen lays itself out for the panel it opens.)
  await glyphLabel.click(); // on, so the chips are there
  await expect(chips).toBeVisible();
  const reopen = async (tab: 'side' | 'map'): Promise<void> => {
    await page.getByTestId('air-close').click();
    await openAirTool(page);
    await (tab === 'map' ? mapTab : sideTab).click();
    await page.waitForTimeout(400);
  };
  for (const [w, h] of [
    [412, 915],
    [360, 640],
    [844, 390],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const k of [1, 2]) {
      await fontScale(page, k);
      await reopen('map');
      expect(await toolDamage(page), `Map view at ${w}x${h}, text x${k}`).toEqual([]);
      await shot(page, `map-${w}x${h}-x${k}`);
    }
    await sideTab.click();
    await page.waitForTimeout(400);
    expect(await toolDamage(page), `Side view at ${w}x${h}, text x2`).toEqual([]);
    await shot(page, `side-${w}x${h}-x2`);
    await fontScale(page, 1);
  }
  // The check can fail: with the old rules put back (a word may break anywhere, the tabs may shrink below a word, the header does not wrap) the screen the
  // reviewer found damaged, 844x390 at 200 % text, is reported with a word broken inside itself.
  await page.setViewportSize({ width: 844, height: 390 });
  await fontScale(page, 2);
  await reopen('map');
  const old = await page.addStyleTag({
    content: `.wg-options .chip-radio .chip-text { white-space: normal !important; overflow-wrap: anywhere !important; }
      .wg-options .chips { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
      .slice-tabs .segmented-text { overflow-wrap: anywhere !important; hyphens: auto !important; }
      .panel-head .slice-tabs { min-width: 0 !important; }
      .slice-head-main { flex-wrap: nowrap !important; }`,
  });
  await page.waitForTimeout(300);
  expect(await toolDamage(page), 'with the old rules the check sees the broken word').toContain('the word "view" is broken across lines');
  await old.evaluate((n) => (n as Element).remove());
  expect(await toolDamage(page), 'and with the rules of the page it does not').toEqual([]);
  await fontScale(page, 1);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(400);
  await reopen('map');
  await glyphLabel.click(); // off again
  await expect(chips).toBeHidden();

  // ───────── a placement under way is dropped by the tab: no crosshair hidden on the map ─────────
  await sideTab.click();
  await expect(page.getByTestId('slice-set-a')).toBeVisible();
  await page.getByTestId('slice-set-a').click();
  await expect(page.locator('.sim-screen .crosshair')).toBeVisible();
  await mapTab.click();
  await expect(page.locator('.sim-screen .crosshair')).toBeHidden();
  await expect(liveRegion(page)).toHaveText('Map view: wind arrows and flow lines. Placing cancelled.');
  await sideTab.click();
  await expect(page.getByTestId('slice-set-a')).toBeVisible();
  await expect(page.getByTestId('slice-place')).toBeHidden();
  await expect(page.locator('.sim-screen .crosshair')).toBeHidden();

  // ───────── Turn off the slice from the Map view: focus goes to the Map view's own switch; the tool and its tab stay ─────────
  await page.getByTestId('slice-presets-toggle').click();
  await page.getByTestId('slice-preset-along').click();
  await expect.poll(() => cs(page)).toMatchObject({ enabled: true, preset: 'along' });
  await mapTab.click();
  await expect(off).toBeVisible();
  await expect(page.getByTestId('slice-off-note'), 'a recorder with nothing in it: nothing to warn about').toBeHidden();
  await expect(off).not.toHaveAttribute('aria-describedby', /.+/);
  await off.click();
  await expect(liveRegion(page)).toHaveText('Slice turned off.');
  await expect(off).toBeHidden();
  await expect(glyphSwitch, 'focus goes to the Map view switch').toBeFocused();
  await expect.poll(() => cs(page)).toMatchObject({ enabled: false });
  const gone = (await cs(page))!;
  expect(gone.a ?? null).toBeNull();
  expect(gone.b ?? null).toBeNull();
  expect(gone.preset ?? null).toBeNull();
  await expect(mapTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('air-panel')).toBeVisible();
  await sideTab.click();
  await expect(page.getByTestId('slice-empty')).toBeVisible();
  await expect(page.getByTestId('slice-set-a')).toBeVisible();
  await expect(off).toBeHidden();
  await page.getByTestId('air-close').click();
  expect(await popups(page)).toEqual([]);
});
