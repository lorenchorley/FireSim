/**
 * A view that holds still has finished its forest (0.9.0, lane R; plan 23.x, the idle-stop investigation) in the real app (bundled Katoomba demo, 6 km, offline,
 * the fast tier, the High picture tier, the real worker, a Pixel 7 profile at device scale 1, software GL; the idle limit is 3 s, set before the view is built).
 *
 * What the investigation found: the forest is placed a few ms a frame, one step per drawn frame (14 to 20 of them), and a frame of the whole scene takes the software GL
 * about 1.15 s on a busy machine (measured: the median gap between drawn frames, with about 10 ms of script in each). The placement then needs about 20 s, the view holds
 * still after 3 s, and the loop kept drawing a frame per step with the view held, so the forest was unfinished for the rest of that time, and "no frame in 1.5 s" was
 * true in the 2 to 3 s gaps between those frames (e2e/wind-motion.spec.ts takes its first picture by hand for that reason).
 *   - slow frames: the loop is let through at most once in 1.2 s on purpose (the cadence the software GL gives it under load), so that the test does not depend on how
 *     busy the machine is; the view holds still after 3 s with the placement far from done, and its forest is finished there, in one frame; it then draws nothing (two
 *     pictures drawn by hand are the same picture) and a touch wakes it
 *   - a camera that settles after the hold: in a quiet scene, with the loop running at a phone's pace (a frame every 16 ms), the settle that follows a camera move is
 *     not left waiting for a frame that the view never draws; a view that holds still before the 350 ms settle has the forest placed for where the camera is
 * Nothing in the console (the guard of ./fixtures).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice } from './helpers';

test.use({ deviceScaleFactor: 1, actionTimeout: 45_000 });

type View = {
  lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void;
  setLayers(l: Record<string, unknown>): void;
  renderNow(): void;
  renderer: { domElement: HTMLCanvasElement; info: { render: { frame: number } } };
  /** (private members, read here the way the other specs read the rig) */
  vegetation: { placing: boolean } | null;
  vegPending: number;
  vegRadius: number;
  heldStill: boolean;
  frame(now: number): void;
  settleNow: boolean;
  activity: { setLimit(ms: number): void };
};
type Handle = { __firesim: { view: View; session: { play(): void; pause(): void; state: { get(): { snapshot: { atmosphere?: { kind?: string } } | null; headTime: number; playing: boolean } } } } };

interface Held {
  heldStill: boolean;
  placing: boolean;
  vegPending: number;
  vegRadius: number;
  frames: number;
}
const held = (page: Page): Promise<Held> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    return { heldStill: v.heldStill, placing: v.vegetation!.placing, vegPending: v.vegPending, vegRadius: v.vegRadius, frames: v.renderer.info.render.frame };
  });
const frames = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as Handle).__firesim.view.renderer.info.render.frame);
const setLayers = (page: Page, l: Record<string, unknown>): Promise<void> => page.evaluate((v) => (window as unknown as Handle).__firesim.view.setLayers(v), l);
const lookAt = (page: Page, d: number): Promise<void> => page.evaluate((pd) => (window as unknown as Handle).__firesim.view.lookAt(0, 0, pd, 200, 55, false), d);
const renderNow = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as Handle).__firesim.view.renderNow());
const setIdleLimit = (page: Page, ms: number): Promise<void> => page.evaluate((v) => (window as unknown as Handle).__firesim.view.activity.setLimit(v), ms);

/** One frame of the 3-D view as a PNG data URL, drawn and read in the same task. */
const shot = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.renderNow();
    return v.renderer.domElement.toDataURL('image/png');
  });

/**
 * Let the loop through at most once in `everyMs` (a frame drawn by hand, `renderNow`, always goes through): the cadence the software GL gives the loop when the machine
 * is busy, because the next animation frame comes only after the last picture is on the screen. `0` puts the loop back.
 */
const slowLoop = (page: Page, everyMs: number): Promise<void> =>
  page.evaluate((ms) => {
    const v = (window as unknown as Handle).__firesim.view as View & { loopFrame?: (now: number) => void };
    if (!v.loopFrame) v.loopFrame = v.frame.bind(v);
    const real = v.loopFrame;
    let last = -Infinity;
    v.frame = (t: number): void => {
      if (ms > 0 && !v.settleNow && t - last < ms) return;
      last = t;
      real(t);
    };
  }, everyMs);

/**
 * Run the loop the way a phone's GPU does: a frame every 16 ms, whatever the last one cost. (The software GL gives the next animation frame only after the last picture
 * is on the screen, which takes about a second on a busy machine, longer than the 350 ms the camera takes to settle, and that hides what a fast loop shows.)
 */
const fastLoop = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view as View & { renderer: { setAnimationLoop(f: null): void } };
    v.renderer.setAnimationLoop(null);
    setInterval(() => v.frame(performance.now()), 16);
  });

/** Build the Katoomba demo at the fast tier and the High picture tier, with the idle limit 3 s (the view reads it once, when it is built), and pause the run. */
async function build(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.evaluate(() => ((window as unknown as { __firesimIdleStopMs: number }).__firesimIdleStopMs = 3000));
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('picture-quality').getByRole('radio', { name: 'High' }).check();
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('settings')).toHaveCount(0);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('detail').getByRole('radio', { name: /^Fast/ }).check({ force: true });
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().snapshot?.atmosphere?.kind ?? null), { timeout: 60_000 }).not.toBeNull();
  await page.evaluate(() => (window as unknown as Handle).__firesim.session.play());
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get())).headTime, { timeout: 120_000 }).toBeGreaterThan(400);
  await page.evaluate(() => (window as unknown as Handle).__firesim.session.pause());
  await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().playing)).toBe(false);
}

/** A touch on the screen, in the middle of the picture. */
async function tapScreen(page: Page): Promise<void> {
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test('slow frames: the view holds still after 3 s with the forest far from placed; it is finished there, in one frame, and the view then draws nothing', async ({ page }) => {
  test.setTimeout(600_000);
  await build(page);
  await setLayers(page, { windGlyphs: false, wind: 'surface', windHeight: 'fire' }); // something that moves, so the loop draws until the hold
  await slowLoop(page, 1200);
  await lookAt(page, 150); // from the home view: the forest is placed again for a close view
  await renderNow(page);
  const seen: Held[] = []; // the first reading that says the view holds still
  await expect
    .poll(
      async () => {
        const s = await held(page);
        if (s.heldStill && !seen.length) seen.push(s);
        return s.heldStill;
      },
      { message: 'the view holds still', timeout: 120_000, intervals: [100] },
    )
    .toBe(true);
  const first = seen[0]!;
  expect(first.placing, `the forest is finished when the view first says it holds still (read: ${JSON.stringify(first)})`).toBe(false);
  expect(first.vegPending, 'and no placement is waiting for the camera to settle').toBe(0);
  // It draws the picture with the finished forest, and then nothing: no frame in 3 s (polled, the last picture takes its time).
  await expect
    .poll(
      async () => {
        const a = await frames(page);
        await page.waitForTimeout(3000);
        return (await frames(page)) - a;
      },
      { message: 'the held view stops drawing', timeout: 120_000, intervals: [200] },
    )
    .toBe(0);
  const end = await held(page);
  expect(end.placing).toBe(false);
  expect(end.frames - first.frames, `frames drawn from the hold to the stop (one picture, not one for each step of the placement: ${first.frames} to ${end.frames})`).toBeLessThanOrEqual(3);
  // Two pictures drawn by hand while held are the same picture, with no settling picture before them.
  const a = await shot(page);
  await page.waitForTimeout(1000);
  expect((await shot(page)) === a, 'a frame drawn by hand while held is the same frame').toBe(true);
  // And a touch wakes it.
  const f0 = await frames(page);
  await tapScreen(page);
  await expect.poll(async () => (await frames(page)) - f0, { message: 'a tap wakes the view', timeout: 15_000, intervals: [100] }).toBeGreaterThan(0);
});

test('a camera that settles after the hold: the forest is placed for where it is, not left waiting for a frame', async ({ page }) => {
  test.setTimeout(600_000);
  await build(page);
  // A quiet scene: trees stay, and nothing else moves or changes with the camera (the wind marks, the names and the roads would each ask for frames of their own).
  await setLayers(page, { windGlyphs: false, wind: 'off', vegetation: true, understorey: true, windSway: false, flames: false, smoke: false, embers: false, roads: false, fireTrails: false, placeNames: false, imagery: false, insightMarkers: false });
  await setIdleLimit(page, 300); // shorter than the 350 ms the camera takes to count as settled
  await fastLoop(page);
  // The quiet view holds still first, with nothing left to place (measured on the unfixed view: after a camera move in this state the settle was never
  // taken, `vegPending` stayed set 6 s later and the forest was still the one placed for the home view, 3,130 m wide).
  await expect
    .poll(
      async () => {
        const s = await held(page);
        return s.heldStill && !s.placing && s.vegPending === 0;
      },
      { message: 'the quiet view holds still, with nothing to place', timeout: 60_000, intervals: [200] },
    )
    .toBe(true);
  await page.waitForTimeout(3000); // (quiet for a while: a frame that something else asked for would take the settle)
  const before = (await held(page)).vegRadius;
  expect(before, 'the home view places its forest wide, so that the close view below needs a new placement').toBeGreaterThan(700);
  await lookAt(page, 150); // a close view: the forest is placed within 500 m (the smallest radius)
  await renderNow(page);
  await expect
    .poll(
      async () => {
        const s = await held(page);
        return s.heldStill && !s.placing && s.vegPending === 0 ? Math.round(s.vegRadius) : -1;
      },
      { message: `the view holds still and the forest is placed for the close view (the radius was ${Math.round(before)} m)`, timeout: 60_000, intervals: [200] },
    )
    .toBe(500);
});
