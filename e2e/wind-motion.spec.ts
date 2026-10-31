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
 *   - the programs of the wind marks are compiled before the first zoom to the closest level (after the first drawn frame, `compileAsync` or, in this
 *     browser, which has no parallel shader compile, `compile`)
 * Reduced motion (`emulateMedia`):
 *   - the old Wind streaks (levels 1 to 3, the default) stay on screen and stand still: the mesh is visible with marks, no frame in 3 s, and a new
 *     snapshot redraws them once; the trees stop swaying
 *   - at the closest zoom the detailed streaks say `still`, and stay `still` (never `paused`) after the idle time
 * The 3-D curtain (0.7.0, F2), at 360 x 640:
 *   - seen face-on all its arrows are drawn; seen along the line only every few columns are, the halo under them the same; the pictures are attached
 *     (a person judges the 14 px of `ARROW_MIN_SPACING_PX`)
 * Nothing in the console (the guard of ./fixtures).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
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
/** A `StreakBatch`: the curtain's arrows, and the halo under them. */
interface Batch {
  mesh: Mesh;
}
type View = {
  lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void;
  setLayers(l: Record<string, unknown>): void;
  renderNow(): void;
  windGlyphStats?(): Stats | null;
  slice?(): unknown;
  scene: { getObjectByName(n: string): Mesh | undefined };
  renderer: { domElement: HTMLCanvasElement; info: { render: { frame: number } }; properties: { get(o: unknown): { currentProgram?: unknown } } };
  /** (private members, read here the way the other specs read the rig) */
  vegetation: { animating: boolean; placing: boolean } | null;
  wind: { animating: boolean };
  activity: { setLimit(ms: number): void };
  section: { arrows: Batch; halo: Batch };
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
  // The run is not playing yet: play it until there is some time to scrub back over (the tests pause it).
  await page.evaluate(() => (window as unknown as Handle).__firesim.session.play());
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

/**
 * The view says it is paused, and has then drawn nothing for `ms`. The wait is on what the layer says and not on the frame counter alone: a frame of the whole scene
 * takes the software GL up to a second, so "no frame in 1.5 s" can be true of a view that is still moving.
 */
async function expectPaused(page: Page, what: string, ms = 1500): Promise<void> {
  await expect.poll(async () => (await stats(page)).detail, { message: `${what}: the detailed streaks say they are paused`, timeout: 90_000, intervals: [250] }).toBe('paused');
  await expectStopped(page, what, ms);
}

/** The renderer is drawing: its frame counter moves within `within` ms. */
async function expectDrawing(page: Page, what: string, within = 5000): Promise<void> {
  const f0 = await frames(page);
  await expect.poll(async () => (await frames(page)) - f0, { message: `${what}: frames are drawn again`, timeout: within, intervals: [50] }).toBeGreaterThan(0);
}

/** One frame of the 3-D view, drawn and read in the same task, attached to the report (and put on disk with $WIND_MOTION_SHOTS, for looking at). */
async function attach(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const png = Buffer.from((await shot(page)).split(',')[1]!, 'base64');
  await testInfo.attach(name, { body: png, contentType: 'image/png' });
  const dir = process.env.WIND_MOTION_SHOTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), png);
  }
}

/** A different picture of the run: 150 s back from the view time, or 150 s on from it near the start (the run has more than 400 s computed). A new time is a new snapshot for the view. */
const scrubAway = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const s = (window as unknown as Handle).__firesim.session;
    const st = s.state.get();
    const to = st.viewTime > 150 ? st.viewTime - 150 : Math.min(st.headTime, st.viewTime + 150);
    s.scrub(to);
    return `from ${Math.round(st.viewTime)} s to ${Math.round(to)} s of ${Math.round(st.headTime)} s computed`;
  });

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

  await test.step('the detailed streaks\' program is compiled before the first zoom to the closest level: the mesh has not been drawn, and its material already has a program', async () => {
    const before = await page.evaluate(() => {
      const v = (window as unknown as Handle).__firesim.view;
      const m = v.scene.getObjectByName('wind-detail')!;
      return { visible: m.visible, compiled: v.renderer.properties.get(m.material)?.currentProgram !== undefined };
    });
    expect(before.visible, 'nothing has asked for the detailed streaks yet').toBe(false);
    expect(before.compiled, 'compileAsync has run on the glyph group').toBe(true);
  });

  await setLayers(page, { windGlyphs: false, wind: 'surface', windHeight: 'fire' }); // the default Wind streaks, the closest zoom draws them as the detailed streaks
  await lookAt(page, 150);
  await renderNow(page);

  await test.step('in use it moves: the detailed streaks are moving and the loop draws', async () => {
    expect(await stats(page)).toMatchObject({ active: true, level: 4, detail: 'moving', reduced: false });
    await expectDrawing(page, 'a camera that has just moved');
  });

  await test.step('hands off: no frame is drawn, the shader clock stands still, the layer says paused, and two frames drawn by hand are the same frame', async () => {
    await expectPaused(page, 'hands off');
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
    // Two pictures 500 ms apart take the software GL a few seconds (each is a whole frame and a PNG), and the picture's idle limit is 3 s: the view would
    // hold still again between them and the two would be the same picture, rightly. So the limit is long while they are taken, and short again after.
    await setIdleLimit(page, 120_000);
    const a = await shot(page);
    await page.waitForTimeout(500);
    const b = await shot(page);
    await setIdleLimit(page, 3000);
    expect(a === b, 'half a second later the streaks are somewhere else').toBe(false);
  });

  await test.step('a layer change wakes it', async () => {
    await expectPaused(page, 'hands off again');
    expect((await stats(page)).detail).toBe('paused');
    await setLayers(page, { windHeight: 300 });
    await expectDrawing(page, 'a layer change');
    expect((await stats(page)).detail).toBe('moving');
    await setLayers(page, { windHeight: 'fire' });
  });

  await test.step('a time change (a scrub back over the run) wakes it', async () => {
    await expectPaused(page, 'hands off a third time');
    expect((await stats(page)).detail).toBe('paused');
    const moved = await scrubAway(page);
    await expectDrawing(page, `a new snapshot (${moved})`);
    expect((await stats(page)).detail).toBe('moving');
  });

  await test.step('a running simulation never pauses, over 10 s', async () => {
    await page.evaluate(() => (window as unknown as Handle).__firesim.session.play());
    await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().playing)).toBe(true);
    const t0 = await page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().viewTime);
    await expect.poll(async () => (await stats(page)).detail, { message: 'running the simulation wakes the view', timeout: 8000 }).toBe('moving');
    // Once a second for 10 s: the frame counter and what the layer says. (A frame of the whole scene in the software GL takes a good part of a second, so
    // the test asks for frames in every 3 s, not in every one.)
    const seen: { frame: number; detail: Stats['detail'] }[] = [{ frame: await frames(page), detail: (await stats(page)).detail }];
    for (let second = 1; second <= 10; second++) {
      await page.waitForTimeout(1000);
      seen.push({ frame: await frames(page), detail: (await stats(page)).detail });
    }
    expect(
      seen.map((x) => x.detail),
      'the detailed streaks move all through the run',
    ).toEqual(Array(11).fill('moving'));
    for (let i = 3; i < seen.length; i++) expect(seen[i]!.frame - seen[i - 3]!.frame, `frames drawn in seconds ${i - 2} to ${i} of the run (${seen.map((x) => x.frame).join(', ')})`).toBeGreaterThan(0);
    expect(seen[10]!.frame - seen[0]!.frame, 'the loop drew all through the run').toBeGreaterThanOrEqual(5);
    expect(await page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().viewTime), 'the run really ran').toBeGreaterThan(t0);
    await pauseRun(page);
  });

  await test.step('it pauses again once the run is paused and nobody touches', async () => {
    await expectPaused(page, 'the run is paused, hands off');
    expect((await stats(page)).detail).toBe('paused');
  });

  await test.step('nothing opened by itself, nothing said aloud: no pop-up, no role=alert', async () => {
    expect(await popups(page)).toEqual([]); // (the watcher also looks for a visible role=alert; the failure strip is in the page hidden)
    await expect(page.locator('[role=alert]:visible')).toHaveCount(0);
  });
});

test('reduced motion: the old Wind streaks and the trees stand still (and are not hidden), a new snapshot redraws them once; the detailed streaks stay "still", never "paused"', async ({ page }) => {
  test.setTimeout(900_000);
  await build(page, 0); // never: the frames below stop because nothing moves, not because the view was left alone
  await pauseRun(page);
  await quietScene(page);
  await setLayers(page, { windGlyphs: false, wind: 'surface', windHeight: 'fire' });
  await lookAt(page, 1800); // a model cell of about 70 px: level 3, the old Wind streaks (the detailed ones come at level 4), and trees near enough to be drawn in detail (they sway)
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
    const moved = await scrubAway(page);
    await expect.poll(async () => (await frames(page)) - f0, { message: `a new snapshot (${moved}): frames are drawn`, timeout: 10_000 }).toBeGreaterThan(0);
    // The display time glides to the new snapshot (up to 1.5 s of the view's clock), and the last frame of the glide comes with the next animation
    // frame after that: under software GL they are far apart (the first frame of a scrub at 0.5 s, its last at 3.1 s), so a fixed 1 s wait put it in the
    // window below. The loop must stop (polled, as after every other change here), and then it draws nothing for 2 s.
    await expectStopped(page, 'after a new snapshot (the glide of the display time over)');
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

test('the 3-D curtain: its arrows are drawn whole face-on and thinned where the line is seen edge on, the halo with them (360 x 640)', async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await build(page, 0);
  await pauseRun(page);
  await setLayers(page, {
    wind: 'off',
    windGlyphs: false,
    vegetation: false,
    understorey: false,
    flames: false,
    smoke: false,
    embers: false,
    roads: false,
    fireTrails: false,
    placeNames: false,
    insightMarkers: false,
    crossSection: { enabled: true, azimuth: 90, centre: [0, 0], a: [-1500, 0], b: [1500, 0], preset: null, field: 'speed' }, // a line of 3 km, east to west
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__firesim.view.slice!() !== null), { timeout: 30_000 }).toBe(true);
  const counts = (): Promise<{ arrows: number; halo: number }> =>
    page.evaluate(() => {
      const s = (window as unknown as Handle).__firesim.view.section;
      return { arrows: s.arrows.mesh.geometry.instanceCount, halo: s.halo.mesh.geometry.instanceCount };
    });
  const look = async (name: string, az: number, tilt = 80): Promise<{ arrows: number; halo: number }> => {
    await lookAt(page, 3500, az, tilt); // 3.5 km from the middle of the line; a tilt of 80 is a low view (10 degrees below the horizon), 55 the orbit's usual
    await renderNow(page);
    await attach(page, testInfo, `curtain-360x640-${name}.png`);
    return counts();
  };

  const faceOn = await look('face-on', 180); // from the south: the line runs across the screen
  expect(faceOn.arrows, 'face-on the curtain has its arrows (21 columns of up to 9)').toBeGreaterThan(100);
  expect(faceOn.halo).toBe(faceOn.arrows);
  const slanted = await look('slanted', 135);
  const edgeOn = await look('edge-on', 90); // from the east: the camera looks along the line
  const edgeOnHigh = await look('edge-on-tilt55', 90, 55); // along the line from higher up: the curtain is edge on at any height, so it is thinned as much
  expect(edgeOn.arrows, 'along the line only every few columns are drawn').toBeLessThanOrEqual(faceOn.arrows * 0.5);
  expect(edgeOn.arrows, 'but some are').toBeGreaterThanOrEqual(3);
  expect(edgeOn.halo, 'the halo under them is the same arrows').toBe(edgeOn.arrows);
  expect(edgeOnHigh.arrows, 'along the line at the usual tilt too').toBeLessThanOrEqual(faceOn.arrows * 0.5);
  expect(edgeOnHigh.halo).toBe(edgeOnHigh.arrows);
  expect(slanted.arrows, 'in between it is in between').toBeLessThanOrEqual(faceOn.arrows);
  expect(slanted.arrows).toBeGreaterThanOrEqual(edgeOn.arrows);
  const back = await look('face-on-again', 180);
  expect(back, 'coming round again gives the arrows back').toEqual(faceOn);
});
