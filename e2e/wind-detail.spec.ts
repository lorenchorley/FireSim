/**
 * The Wind detail chip (0.6.0, request 1: "an on screen icon indicating the level of detail of the wind currently shown because of the zoom level")
 * in the real app (bundled Katoomba demo, 6 km, offline, the fast tier, the Low picture tier, the real worker, a Pixel 7 profile at device scale 1).
 * The rules and the words are unit-tested (windDetailState, windDetailWords); this checks what only the real screen can show:
 *
 *   - with the default layers (the Wind streaks on) the chip is shown at 412x915, 360x640 and 844x390: at least 44 x 44 with a 44 px hit area,
 *     inside the screen, standing 8 px on the legend card, and clear of every other control (the round buttons, Tools, the legend, the attribution
 *     line, the weather chips, the pill, the dock, the timeline and the speed signal)
 *   - the sheet opens by a tap and closes by Escape (focus back on the chip), an outside tap (which does not reach the map) and Close; it fits the
 *     screen, says the step in plain words, and nothing opens by itself while the run plays; no alert, no toast
 *   - the arrows and flow lines alone: a REAL pinch from 12 km walks the pips with the layer's own level (the chip and the picture cannot disagree);
 *     at the closest zoom the fourth pip needs the detailed streaks drawn (`stats.detail`), the third is the 0.5.0 long flow lines; the sheet follows
 *   - not for the Wind speed map; not at eye level unless the Wind streaks are on; hidden while the Layers panel is open; not in the 2-D map
 * Nothing in the console (the guard of ./fixtures).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { chipLabel } from '../src/ui/screens/sim/windDetailState';
import { expect, test } from './fixtures';
import { acceptNotice, animationsDone, armPopupWatch, frame, newHand, pickViewMode, popups, watchPopups } from './helpers';

// The software-GL test browser draws about one frame per second whatever the resolution; the smaller canvas keeps each frame cheap.
test.use({ deviceScaleFactor: 1, actionTimeout: 45_000 });

type Pt = [number, number];
interface Stats {
  active: boolean;
  idle: 'off' | 'eye-level' | 'no-wind' | 'budget' | null;
  level: number;
  cellPx: number;
  detail?: 'off' | 'moving' | 'still';
}
type Handle = {
  __firesim: {
    view: {
      cameraState(): { target: Pt; distance: number };
      projectToScreen(x: number, y: number): Pt | null;
      lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void;
      renderNow(): void;
      windGlyphStats?(): Stats | null;
      rig: { update(now: number): boolean };
    };
    session: { state: { get(): { snapshot: { atmosphere?: { kind?: string } } | null } }; debugForcePace(l: string | null): void };
  };
};
const SIZES = [
  [412, 915, 'portrait phone'],
  [360, 640, 'small portrait phone'],
  [844, 390, 'landscape phone'],
] as const;
const BAD = /\b(undefined|NaN|Infinity|null|\[object)\b/;

/** Build the Katoomba demo at the fast tier and the Low picture tier, and wait for the air. */
async function build(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('firesim.settings', JSON.stringify({ pictureQuality: 'low' })));
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
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 240_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().snapshot?.atmosphere?.kind ?? null), { timeout: 90_000 })
    .not.toBeNull();
}

/** The page as a PNG, kept in the report and, with $WIND_DETAIL_SHOTS set, on disk (for looking at; nothing compares them). */
async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await animationsDone(page); // the sheet slides in: wait for it, the software-GL page draws about a frame a second
  const png = await page.screenshot();
  await testInfo.attach(name, { body: png, contentType: 'image/png' });
  const dir = process.env.WIND_DETAIL_SHOTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), png);
  }
}

/** The chip's pips that are filled. */
const pipsOn = (page: Page): Promise<number> => page.locator('[data-testid=wind-detail] .wd-pip.is-on').count();

/** The layer's own reading after a frame is drawn (the glyph rebuild is finished in it). */
const drawAndRead = (page: Page): Promise<Stats> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.renderNow();
    return v.windGlyphStats!()!;
  });

/** Let the camera come to rest (the rig's per-frame update, run many times without drawing), as the gesture specs do. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rig = (window as unknown as Handle).__firesim.view.rig;
    const t0 = performance.now() + 4000;
    for (let i = 0; i < 100; i++) rig.update(t0 + i * 16);
  });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
}

/** The button's hit area: every probe point 21 px from its centre (and the diagonals at 15 px) lands on it, like scripts/audit-tap-targets.mjs. */
function hitArea(page: Page, testId: string): Promise<{ w: number; h: number; missed: string[] }> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid=${id}]`) as HTMLElement;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const missed: string[] = [];
    for (const [dx, dy] of [[-21, 0], [21, 0], [0, -21], [0, 21], [-15, -15], [15, 15], [-15, 15], [15, -15]] as const) {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      if (!(hit && (el === hit || el.contains(hit)))) missed.push(`${dx},${dy}`);
    }
    return { w: r.width, h: r.height, missed };
  }, testId);
}

/** What the chip overlaps: the rectangles of everything else the map carries that shows now, and how far the chip stands above the legend. */
function crowd(page: Page): Promise<{ chip: number[]; overlaps: string[]; present: string[]; aboveLegend: number | null; legendLeft: number | null; inside: boolean }> {
  return page.evaluate(() => {
    const others: [string, string][] = [
      ['round buttons', '.map-fabs .fab'],
      ['Tools', '.menu-fab'],
      ['legend', '.map-legend'],
      ['attribution', '.map-credit'],
      ['weather chips', '.sim-topbar .tb-wx > *'],
      ['pill', '.sim-topbar .tb-pill'],
      ['dock', '[data-testid=dock]'],
      ['timeline', '.scrubber'],
      ['speed signal', '[data-testid=pace-btn]'],
      ['training strip', '[data-testid=training-badge]'],
    ];
    const rects = (sel: string): DOMRect[] =>
      [...document.querySelectorAll(sel)]
        .filter((e) => {
          const cs = getComputedStyle(e);
          const b = e.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && !(e as HTMLElement).hidden && b.width > 0 && b.height > 0;
        })
        .map((e) => e.getBoundingClientRect());
    const c = document.querySelector('[data-testid=wind-detail]')!.getBoundingClientRect();
    const overlaps: string[] = [];
    const present: string[] = [];
    for (const [name, sel] of others) {
      const rs = rects(sel);
      if (rs.length) present.push(name);
      for (const b of rs) if (c.left < b.right - 0.5 && b.left < c.right - 0.5 && c.top < b.bottom - 0.5 && b.top < c.bottom - 0.5) overlaps.push(name);
    }
    const legend = rects('.map-legend')[0];
    return {
      chip: [c.left, c.top, c.right, c.bottom].map(Math.round),
      overlaps,
      present,
      aboveLegend: legend ? legend.top - c.bottom : null,
      legendLeft: legend ? legend.left : null,
      inside: c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight,
    };
  });
}

/**
 * `crowd` once the layout has stopped moving. The screen places its chips from an animation frame after a resize (and again 320 ms after the last
 * change), and the software-GL test browser draws about a frame a second: three frames first, then two equal readings in a row.
 */
async function settledCrowd(page: Page): Promise<Awaited<ReturnType<typeof crowd>>> {
  for (let i = 0; i < 3; i++) await frame(page);
  await page.waitForTimeout(400);
  let last = await crowd(page);
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(400);
    const now = await crowd(page);
    if (JSON.stringify(now) === JSON.stringify(last)) return now;
    last = now;
  }
  return last;
}

test('the Wind detail chip, in the real app: three sizes, the sheet, a real pinch, and where it does not belong', async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  await watchPopups(page);
  await build(page);
  await armPopupWatch(page);
  const chip = page.getByTestId('wind-detail');
  const sheet = page.getByTestId('wind-detail-sheet');
  // The speed signal is in the strip too: force it so the check sees it (the debug hook of the pace sheet).
  await page.evaluate(() => (window as unknown as Handle).__firesim.session.debugForcePace('behind'));
  await expect(page.getByTestId('pace-btn')).toBeVisible();
  // The run plays while everything is looked at: nothing may open because of it.
  await page.getByTestId('play').click();

  // ───────── default layers (the Wind streaks on): the chip at three sizes ─────────
  for (const [w, h, name] of SIZES) {
    await test.step(`${name} (${w}x${h}): the chip is shown, 44 px, inside the screen and clear of the other controls`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await animationsDone(page);
      await expect(chip).toBeVisible({ timeout: 30_000 });
      await expect(chip).toContainText('Wind detail');
      await expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(chip).toHaveAttribute('aria-expanded', 'false');
      // The default layers have only the Wind streaks on: moving streaks over the whole area, the first step (the arrows and flow lines are off).
      await expect(chip).toHaveAccessibleName(chipLabel(1));
      expect(await pipsOn(page)).toBe(1);
      await expect(chip.locator('.wd-pip')).toHaveCount(4);
      // A pip is a circle or a ring: the step is in the shape, so a filled one and an empty one differ in more than colour.
      const looks = await chip.locator('.wd-pip').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)'));
      expect(looks).toEqual([true, false, false, false]);
      const c = await settledCrowd(page);
      const hit = await hitArea(page, 'wind-detail');
      expect(hit.w).toBeGreaterThanOrEqual(44);
      expect(hit.h).toBeGreaterThanOrEqual(44);
      expect(hit.missed).toEqual([]);
      console.log(`wind detail chip at ${w}x${h}: ${JSON.stringify(c.chip)} above the legend by ${c.aboveLegend}, clear of ${c.present.join(', ')}`);
      expect(c.inside).toBe(true);
      expect(c.overlaps, `the chip overlaps ${c.overlaps.join(', ')}`).toEqual([]);
      expect(c.present).toEqual(expect.arrayContaining(['round buttons', 'Tools', 'legend', 'pill', 'dock', 'timeline', 'speed signal']));
      if (c.aboveLegend !== null) {
        expect(c.aboveLegend, 'the chip stands 8 px on the legend card').toBeGreaterThanOrEqual(6);
        expect(c.aboveLegend).toBeLessThanOrEqual(10);
        expect(Math.abs(c.chip[0]! - c.legendLeft!), 'in the same column as the legend card').toBeLessThanOrEqual(1);
      }
      // The top bar and the weather chips stay above it.
      const below = await page.evaluate(() => {
        const top = Math.max(...[...document.querySelectorAll('.sim-topbar .tb-pill, .sim-topbar .tb-wx > *')].map((e) => e.getBoundingClientRect().bottom));
        return document.querySelector('[data-testid=wind-detail]')!.getBoundingClientRect().top - top;
      });
      expect(below).toBeGreaterThan(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, testInfo, `wind-detail-${w}x${h}-chip.png`);
    });

    await test.step(`${name}: the sheet opens by a tap, fits the screen and says the step; Escape, an outside tap and Close shut it`, async () => {
      await expect(sheet).toBeHidden(); // nothing opened by itself while the run played
      await chip.click();
      await expect(sheet).toBeVisible();
      await expect(chip).toHaveAttribute('aria-expanded', 'true');
      await expect(sheet.getByRole('heading', { name: 'Wind detail' })).toBeVisible();
      await expect(page.getByTestId('wind-detail-lead')).toHaveText('Level 1 of 4: moving streaks over the whole area.', { timeout: 15_000 });
      const text = await sheet.innerText();
      expect(text).toContain('These streaks do not get more detailed as you zoom in, until the closest level.');
      expect(text).toContain('Zoom in for more detail.');
      expect(text).toContain("The fast tier's wind is estimated from the forecast and the shape of the ground. It is not simulated.");
      expect(text).not.toMatch(BAD);
      expect(text).not.toMatch(/[—–]/);
      await animationsDone(page);
      const box = (await sheet.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(w + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(h + 1);
      const scroll = await sheet.locator('.tb-sheet-body').evaluate((e) => [e.scrollHeight, e.clientHeight]);
      await shot(page, testInfo, `wind-detail-${w}x${h}-sheet.png`);
      console.log(`wind detail sheet at ${w}x${h}: ${Math.round(box.width)} x ${Math.round(box.height)} at y ${Math.round(box.y)}, body ${scroll[0]} of ${scroll[1]} px`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // Escape: closed, and the focus is back on the chip (not left on the page).
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(chip).toBeFocused();
      await expect(chip).toHaveAttribute('aria-expanded', 'false');
      // An outside tap closes it too, and the tap does not reach the map (no panel, no mark).
      await chip.click();
      await expect(sheet).toBeVisible();
      await page.mouse.click(10, Math.max(150, (await sheet.boundingBox())!.y - 20));
      await expect(sheet).toBeHidden();
      await expect(page.locator('.sim-screen')).not.toHaveClass(/panel-open/);
      // The close button.
      await chip.click();
      await sheet.getByRole('button', { name: 'Close' }).click();
      await expect(sheet).toBeHidden();
      // The hardware Back closes it like Escape does.
      await chip.click();
      await expect(sheet).toBeVisible();
      await page.goBack();
      await expect(sheet).toBeHidden();
      await expect(chip).toBeFocused();
    });
  }

  // ───────── the arrows and flow lines alone: a real pinch walks the pips ─────────
  await page.setViewportSize({ width: 412, height: 915 });
  await animationsDone(page);
  await page.getByTestId('play').click(); // pause: the frames are for the pinch
  await test.step('switch the arrows and flow lines on and the Wind streaks off, as a person does in Layers: the chip hides while the panel is open', async () => {
    await page.getByTestId('layers-fab').click();
    const panel = page.getByTestId('layers-panel');
    await expect(panel).toBeVisible();
    await expect(chip).toBeHidden(); // a tool panel is open: the chip steps aside like the legend
    await panel.getByTestId('layer-windGlyphs').click();
    await panel.getByTestId('wind-layer').getByRole('radio', { name: 'Off' }).check({ force: true });
    await page.getByTestId('layers-fab').click();
    await expect(panel).toBeHidden();
    await expect(chip).toBeVisible();
  });
  const hand = await newHand(page);
  /** The pips the layer's reading asks for: its level, but the fourth pip only while the detailed streaks are drawn (otherwise the closest zoom is the third step). */
  const stepsOf = (s: Stats): number => (!s.active ? 0 : s.level >= 4 ? ((s.detail ?? 'off') !== 'off' ? 4 : 3) : s.level);
  const seen: number[] = [];
  const levels: number[] = [];
  const read = async (what: string): Promise<number> => {
    await settle(page);
    const s = await drawAndRead(page);
    const want = stepsOf(s);
    // The chip polls four times a second; it catches up within a moment of the layer's own reading.
    await expect.poll(() => pipsOn(page), { message: `${what}: the pips follow the layer (level ${s.level}, a cell of ${s.cellPx.toFixed(1)} px)`, timeout: 10_000 }).toBe(want);
    await expect(chip).toHaveAccessibleName(chipLabel(want));
    console.log(`wind detail, ${what}: layer level ${s.level}, detail ${s.detail ?? 'n/a'}, pips ${want}`);
    seen.push(want);
    levels.push(s.level);
    return want;
  };
  await test.step('from 12 km the pips are the arrows of the first or second step', async () => {
    await page.evaluate(() => (window as unknown as Handle).__firesim.view.lookAt(0, 0, 12000, 200, 52, false));
    const n = await read('12 km');
    expect([1, 2]).toContain(n);
  });
  await test.step('three pinches of about 2.6x each bring the camera under 1 km: the pips never go down and the chip agrees with the layer at every stop', async () => {
    for (let i = 1; i <= 3; i++) {
      const target = (await page.evaluate(() => (window as unknown as Handle).__firesim.view.cameraState())).target;
      const c = (await page.evaluate(([x, y]) => (window as unknown as Handle).__firesim.view.projectToScreen(x!, y!), target))!;
      await hand.down(1, c[0] - 30, c[1]);
      await hand.down(2, c[0] + 30, c[1]);
      await hand.drag({ 1: [c[0] - 78, c[1]], 2: [c[0] + 78, c[1]] }, 8);
      await hand.upAll();
      const before = seen[seen.length - 1]!;
      const n = await read(`pinch ${i}`);
      expect(n, `pinch ${i} does not lower the pips`).toBeGreaterThanOrEqual(before);
    }
    expect((await page.evaluate(() => (window as unknown as Handle).__firesim.view.cameraState())).distance).toBeLessThan(1000);
    // The layer walked the ladder (its level took at least three values) and the chip followed it at every stop (checked in `read`).
    expect(new Set(levels).size, `the layer's levels on the way: ${levels.join(', ')} (pips ${seen.join(', ')})`).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size, `the pips on the way: ${seen.join(', ')}`).toBeGreaterThanOrEqual(2);
    // At the closest zoom: the third pip (0.5.0's long flow lines) or, with the detailed streaks drawn, the fourth. Only the integrated build draws them.
    expect([3, 4]).toContain(seen[seen.length - 1]);
  });
  await test.step('the sheet says the same step as the pips, and the model cells when they are wider than 60 px', async () => {
    const want = seen[seen.length - 1]!;
    await shot(page, testInfo, 'wind-detail-412x915-closest-chip.png');
    await chip.click();
    await expect(sheet).toBeVisible();
    await shot(page, testInfo, 'wind-detail-412x915-closest-sheet.png');
    const lead = await page.getByTestId('wind-detail-lead').innerText();
    expect(lead).toBe(want === 4 ? 'Level 4 of 4: detailed streaks.' : 'Level 3 of 4: curved flow lines.');
    const text = await sheet.innerText();
    // The default Wind height is What the fire feels (0.7.0): its sheet names the fire model's cells when the picture has the 60 m wind, and it is the 10 m wind's words when it has not.
    const hasFelt = await page.evaluate(() => !!(window as unknown as { __firesim: { session: { state: { get(): { snapshot: { fireWind?: unknown } | null } } } } }).__firesim.session.state.get().snapshot?.fireWind);
    if (hasFelt) expect(text).toMatch(/The wind the fire feels, in cells about \d+ m wide\./);
    else expect(text).toContain('Wind about 10 m above open ground.');
    expect(text).toContain('wide');
    if (want === 4) {
      expect(text).toContain('These bends and eddies are added for looks, from the shape of the ground and the trees.');
      expect(text).toContain('This is the most detailed level.');
    } else expect(text).not.toContain('eddies');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  // ───────── where it does not belong ─────────
  await test.step('eye level draws no arrows: the chip is hidden; with the Wind streaks on it is back (they are drawn there)', async () => {
    await pickViewMode(page, 'ground');
    await expect(chip).toBeHidden();
    await page.getByTestId('layers-fab').click();
    await page.getByTestId('layers-panel').getByTestId('wind-layer').getByRole('radio', { name: 'Near the ground' }).check({ force: true });
    await page.getByTestId('layers-fab').click();
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAccessibleName(chipLabel(1));
    await pickViewMode(page, 'orbit');
  });
  await test.step('the Wind speed map is not a wind mark: with both wind layers off and the map on, the chip is hidden; the arrows back on bring it back', async () => {
    await page.getByTestId('layers-fab').click();
    const panel = page.getByTestId('layers-panel');
    await panel.getByTestId('layer-windGlyphs').click();
    await panel.getByTestId('wind-layer').getByRole('radio', { name: 'Off' }).check({ force: true });
    await page.getByTestId('layers-fab').click();
    await expect(panel).toBeHidden();
    await expect(chip).toBeHidden();
    // The heat map is switched on by the path "Show on map" takes from the Data sets screen (in Layers it waits for a fire, which this run has not marked).
    await page.evaluate(() => (window as unknown as { __firesim: { app: { sim: { showLayer(t: { overlay: string }): void } } } }).__firesim.app.sim.showLayer({ overlay: 'windSpeed' }));
    await page.waitForTimeout(800); // the chip polls four times a second
    await expect(chip).toBeHidden();
    await page.getByTestId('layers-fab').click();
    await expect(panel.getByTestId('overlay-windSpeed')).toHaveAttribute('aria-pressed', 'true'); // the map was on while the chip stayed hidden
    await panel.getByTestId('layer-windGlyphs').click();
    await page.getByTestId('layers-fab').click();
    await expect(chip).toBeVisible();
  });

  // ───────── through all of it ─────────
  expect(await popups(page), 'no alert, toast or pop-up came up').toEqual([]);
  expect(await page.locator('[role=alert]:visible').count()).toBe(0);
  await testInfo.attach('note', { body: `pips seen on the pinch: ${seen.join(', ')}`, contentType: 'text/plain' });
});

test('the 2-D stand-in map (?mock=1) has no wind statistics, so no chip is shown', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?mock=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('wind-detail')).toBeHidden();
  await expect(page.getByTestId('wind-detail-sheet')).toBeHidden();
});
