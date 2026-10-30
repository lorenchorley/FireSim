/**
 * The idle stop and reduced motion (0.7.0, items E3 and F4) in the real app (bundled Katoomba demo, 6 km, offline, the fast tier, the High picture
 * tier, the real worker, a Pixel 7 profile at device scale 1, software GL). The clock and the rules are unit-tested (src/render/idleStop.test.ts, the
 * SceneView source pins in it, windLayer.test.ts, vegetationLayer.test.ts); this checks what only a real frame loop shows.
 *
 * The idle stop (the limit is 3 s here: the shared fixture sets the seam `window.__firesimIdleStopMs` to never, this spec sets its own before the view is built):
 *   - hands off at the closest zoom with the default Wind streaks: after a few seconds the renderer draws no frame in 1.5 s, the shader clock stands still,
 *     the layer says `detail: 'paused'`, and two frames drawn by hand are byte-equal
 *   - a tap on the screen wakes it (frames at once, `moving` again, two frames 500 ms apart differ); so does a layer change and a time change
 *   - a running simulation never pauses, 10 s
 *   - nothing opens by itself, no `role=alert`
 * Reduced motion (`emulateMedia`):
 *   - the old Wind streaks (levels 1 to 3, the default) stay on screen and stand still: the mesh is visible with marks, no frame in 3 s, and a new
 *     snapshot redraws them once; the trees stop swaying
 *   - at the closest zoom the detailed streaks say `still`, and stay `still` (never `paused`) after the idle time
 * Nothing in the console (the guard of ./fixtures).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, armPopupWatch, popups, watchPopups } from './helpers';

test.use({ deviceScaleFactor: 1, actionTimeout: 45_000 });

interface Stats {
  active: boolean;
  level: number;
  detail: 'off' | 'moving' | 'still' | 'paused';
  reduced: boolean;
}
interface Mesh {
  visible: boolean;
  geometry: { instanceCount: number };
  material: { uniforms: Record<string, { value: number }> };
}
type View = {
  lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void;
  setLayers(l: Record<string, unknown>): void;
  renderNow(): void;
  windGlyphStats?(): Stats | null;
  scene: { getObjectByName(n: string): Mesh | undefined };
  renderer: { domElement: HTMLCanvasElement; info: { render: { frame: number } } };
  /** (private members, read here the way the other specs read the rig) */
  vegetation: { animating: boolean; placing: boolean } | null;
  wind: { animating: boolean };
  activity: { setLimit(ms: number): void };
};
type Session = { state: { get(): { snapshot: { atmosphere?: { kind?: string } } | null; viewTime: number; headTime: number; playing: boolean } }; play(): void; pause(): void; scrub(t: number): void };
type Handle = { __firesim: { view: View; session: Session } };

const airKind = (page: Page): Promise<string | null> => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().snapshot?.atmosphere?.kind ?? null);
const frames = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as Handle).__firesim.view.renderer.info.render.frame);
const stats = (page: Page): Promise<Stats> => page.evaluate(() => (window as unknown as Handle).__firesim.view.windGlyphStats!()!);
const setLayers = (page: Page, l: Record<string, unknown>): Promise<void> => page.evaluate((v) => (window as unknown as Handle).__firesim.view.setLayers(v), l);
const lookAt = (page: Page, d: number, az = 200, tilt = 55): Promise<void> =>
  page.evaluate(([pd, a, t]) => (window as unknown as Handle).__firesim.view.lookAt(0, 0, pd!, a!, t!, false), [d, az, tilt]);
const renderNow = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as Handle).__firesim.view.renderNow());
const vegetationPlacing = (page: Page): Promise<boolean> => page.evaluate(() => (window as unknown as Handle).__firesim.view.vegetation!.placing);
const treesSway = (page: Page): Promise<boolean> => page.evaluate(() => (window as unknown as Handle).__firesim.view.vegetation!.animating);
const windAnimating = (page: Page): Promise<boolean> => page.evaluate(() => (window as unknown as Handle).__firesim.view.wind.animating);
const setIdleLimit = (page: Page, ms: number): Promise<void> => page.evaluate((v) => (window as unknown as Handle).__firesim.view.activity.setLimit(v), ms);
/** The shared shader clock the detailed streaks read (`uTime` of their material is the view's own `uClock`). */
const clock = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as Handle).__firesim.view.scene.getObjectByName('wind-detail')!.material.uniforms.uTime!.value);

/** One frame of the 3-D view as a PNG data URL, drawn and read in the same task (the clock is whatever the view holds). */
const shot = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.renderNow();
    return v.renderer.domElement.toDataURL('image/png');
  });

/** Trees stay, so that the sway can be checked; roads, names, flames, embers and smoke go (a frame is cheap, and the fire would keep the loop going on its own). */
const quietScene = (page: Page): Promise<void> =>
  setLayers(page, { vegetation: true, understorey: true, windSway: true, flames: false, smoke: false, embers: false, roads: false, fireTrails: false, placeNames: false, imagery: false, insightMarkers: false });

/** Build the Katoomba demo at the fast tier and the High picture tier, with the idle limit `idleMs` (the view reads it once, when it is built), and wait for the air. */
async function build(page: Page, idleMs: number): Promise<void> {
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.evaluate((ms) => ((window as unknown as { __firesimIdleStopMs: number }).__firesimIdleStopMs = ms), idleMs);
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
  await expect.poll(() => airKind(page), { timeout: 60_000 }).not.toBeNull();
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get())).headTime, { timeout: 120_000 }).toBeGreaterThan(400);
}

/** Pause the run (a running simulation never lets the view stop) at a time with something to scrub back over. */
const pauseRun = async (page: Page): Promise<void> => {
  await page.evaluate(() => (window as unknown as Handle).__firesim.session.pause());
  await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().playing)).toBe(false);
};

/** The renderer has drawn nothing in the last `ms`: two readings of its frame counter that far apart are equal. Polled until it is true (the idle stop takes its time). */
async function expectStopped(page: Page, what: string, ms = 1500): Promise<void> {
  await expect
    .poll(
      async () => {
        const a = await frames(page);
        await page.waitForTimeout(ms);
        return (await frames(page)) - a;
      },
      { message: `${what}: no frame drawn in ${ms} ms`, timeout: 90_000, intervals: [200] },
    )
    .toBe(0);
}

/** The renderer is drawing: its frame counter moves within `within` ms. */
async function expectDrawing(page: Page, what: string, within = 5000): Promise<void> {
  const f0 = await frames(page);
  await expect.poll(async () => (await frames(page)) - f0, { message: `${what}: frames are drawn again`, timeout: within, intervals: [50] }).toBeGreaterThan(0);
}

/** A touch on the screen, in the middle of the picture. */
async function tapScreen(page: Page): Promise<void> {
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test('idle stop: hands off, the view holds still and stops drawing; a touch, a layer change and a time change wake it; a running simulation never stops; nothing pops up', async ({ page }) => {
  test.setTimeout(900_000);
  await watchPopups(page);
  await build(page, 3000);
  await armPopupWatch(page, true);
  await pauseRun(page);
  await setLayers(page, { windGlyphs: false, wind: 'surface', windHeight: 'fire' }); // the default Wind streaks, the closest zoom draws them as the detailed streaks
  await lookAt(page, 150);
  await renderNow(page);

  await test.step('in use it moves: the detailed streaks are moving and the loop draws', async () => {
    expect(await stats(page)).toMatchObject({ active: true, level: 4, detail: 'moving', reduced: false });
    await expectDrawing(page, 'a camera that has just moved');
  });

  await test.step('hands off: no frame is drawn, the shader clock stands still, the layer says paused, and two frames drawn by hand are the same frame', async () => {
    await expectStopped(page, 'hands off');
    expect((await stats(page)).detail, 'the detailed streaks say they are paused').toBe('paused');
    const t0 = await clock(page);
    await page.waitForTimeout(1500);
    expect(await clock(page), 'the shader clock does not move').toBe(t0);
    const a = await shot(page);
    await page.waitForTimeout(1000);
    const b = await shot(page);
    expect(a === b, 'a frame drawn by hand while held is the same frame').toBe(true);
    expect(a.length, 'and it is a real picture').toBeGreaterThan(20_000);
    expect(await clock(page), 'drawing by hand does not wake it').toBe(t0);
    expect((await stats(page)).detail).toBe('paused');
  });

  await test.step('a tap on the screen wakes it at once: frames, moving, and two frames 500 ms apart differ', async () => {
    await tapScreen(page);
    await expectDrawing(page, 'a tap');
    expect((await stats(page)).detail).toBe('moving');
    const a = await shot(page);
    await page.waitForTimeout(500);
    const b = await shot(page);
    expect(a === b, 'half a second later the streaks are somewhere else').toBe(false);
  });

  await test.step('a layer change wakes it', async () => {
    await expectStopped(page, 'hands off again');
    expect((await stats(page)).detail).toBe('paused');
    await setLayers(page, { windHeight: 300 });
    await expectDrawing(page, 'a layer change');
    expect((await stats(page)).detail).toBe('moving');
    await setLayers(page, { windHeight: 'fire' });
  });

  await test.step('a time change (a scrub back over the run) wakes it', async () => {
    await expectStopped(page, 'hands off a third time');
    expect((await stats(page)).detail).toBe('paused');
    await page.evaluate(() => {
      const s = (window as unknown as Handle).__firesim.session;
      s.scrub(Math.max(0, s.state.get().viewTime - 180));
    });
    await expectDrawing(page, 'a new snapshot');
    expect((await stats(page)).detail).toBe('moving');
  });

  await test.step('a running simulation never pauses, over 10 s', async () => {
    await page.evaluate(() => (window as unknown as Handle).__firesim.session.play());
    await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().playing)).toBe(true);
    const t0 = await page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().viewTime);
    for (let second = 0; second < 10; second++) {
      const f0 = await frames(page);
      await page.waitForTimeout(1000);
      expect((await frames(page)) - f0, `second ${second + 1} of the run: frames are drawn`).toBeGreaterThan(0);
      expect((await stats(page)).detail, `second ${second + 1} of the run`).toBe('moving');
    }
    expect(await page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().viewTime), 'the run really ran').toBeGreaterThan(t0);
    await pauseRun(page);
  });

  await test.step('it pauses again once the run is paused and nobody touches', async () => {
    await expectStopped(page, 'the run is paused, hands off');
    expect((await stats(page)).detail).toBe('paused');
  });

  await test.step('nothing opened by itself, nothing said aloud: no pop-up, no role=alert', async () => {
    expect(await popups(page)).toEqual([]);
    await expect(page.locator('[role=alert]')).toHaveCount(0);
  });
});

test('reduced motion: the old Wind streaks and the trees stand still (and are not hidden), a new snapshot redraws them once; the detailed streaks stay "still", never "paused"', async ({ page }) => {
  test.setTimeout(900_000);
  await build(page, 0); // never: the frames below stop because nothing moves, not because the view was left alone
  await pauseRun(page);
  await quietScene(page);
  await setLayers(page, { windGlyphs: false, wind: 'surface', windHeight: 'fire' });
  await lookAt(page, 2500); // a model cell of about 45 px: level 3, the old Wind streaks (the detailed ones come at level 4)
  await renderNow(page);
  await expect.poll(() => vegetationPlacing(page), { timeout: 60_000 }).toBe(false);
  await renderNow(page);

  await test.step('moving: the old Wind streaks and the sway ask for frames, and the loop draws them', async () => {
    const s = await stats(page);
    expect(s.level, 'a level the old streaks stay for').toBeGreaterThanOrEqual(1);
    expect(s.level).toBeLessThanOrEqual(3);
    expect(s.detail).toBe('off');
    expect(await windAnimating(page), 'the old Wind streaks are drawn').toBe(true);
    expect(await treesSway(page), 'the trees sway').toBe(true);
    await expectDrawing(page, 'moving');
  });

  await test.step('reduced motion: the marks stay on screen, standing still: no frame in 3 s, the trees stop, the layer says reduced', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(async () => (await stats(page)).reduced).toBe(true);
    await renderNow(page); // the one frame that draws them standing still
    expect(await windAnimating(page), 'the old Wind streaks ask for no frames').toBe(false);
    expect(await treesSway(page), 'the trees stand still').toBe(false);
    const mesh = await page.evaluate(() => {
      const m = (window as unknown as Handle).__firesim.view.scene.getObjectByName('wind')!;
      return { visible: m.visible, count: m.geometry.instanceCount };
    });
    expect(mesh.visible, 'the streaks are not hidden: the person keeps the picture').toBe(true);
    expect(mesh.count, 'and there are marks in it').toBeGreaterThan(100);
    await page.waitForTimeout(500);
    const f0 = await frames(page);
    await page.waitForTimeout(3000);
    expect((await frames(page)) - f0, 'frames drawn in 3 s under reduced motion').toBe(0);
  });

  await test.step('a new snapshot (a scrub) redraws the standing marks once, and the loop stops again', async () => {
    const f0 = await frames(page);
    await page.evaluate(() => {
      const s = (window as unknown as Handle).__firesim.session;
      s.scrub(Math.max(0, s.state.get().viewTime - 240));
    });
    await expect.poll(async () => (await frames(page)) - f0, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    const f1 = await frames(page);
    await page.waitForTimeout(2000);
    expect((await frames(page)) - f1, 'frames drawn in 2 s after it').toBe(0);
    const count = await page.evaluate(() => (window as unknown as Handle).__firesim.view.scene.getObjectByName('wind')!.geometry.instanceCount);
    expect(count, 'the marks are still there').toBeGreaterThan(100);
  });

  await test.step('at the closest zoom the detailed streaks say still, and stay still after the idle time: never paused', async () => {
    await lookAt(page, 150);
    await renderNow(page);
    expect(await stats(page)).toMatchObject({ active: true, level: 4, detail: 'still', reduced: true });
    await setIdleLimit(page, 3000); // the idle stop on, now
    await page.waitForTimeout(6000);
    expect((await stats(page)).detail, 'standing still is not paused').toBe('still');
    expect(await treesSway(page)).toBe(false);
    await setIdleLimit(page, 0);
  });

  await test.step('back to normal motion: moving again', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(async () => (await stats(page)).reduced).toBe(false);
    await renderNow(page);
    expect((await stats(page)).detail).toBe('moving');
    expect(await treesSway(page), 'the trees sway again').toBe(true);
  });
});
