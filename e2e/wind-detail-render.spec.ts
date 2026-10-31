/**
 * The detailed wind streaks of the most detailed level (0.6.0, request 2) in the real app (bundled Katoomba demo, 6 km, offline, the fast
 * tier, the High picture tier, the real worker, a Pixel 7 profile at device scale 1, software GL). The layer's own rules are unit-tested
 * (src/render/wind: the fade, the hand-over, the budget, the shader text); this checks what only a real renderer and a real frame loop show:
 *
 * The shader, the ladder and the budget:
 *   - the shader compiles and links in a real GL stack, and the console stays empty
 *   - with only the Wind streaks on (the default: the glyph switch is off) a REAL pinch from 12 km to the closest zoom walks the level 1 to 4,
 *     and the level always agrees with the pixels a model cell covers; nothing is built below level 4
 *   - at the closest zoom the draw calls are at most those one level out, and the frame stays inside 550,000 triangles (the detailed streaks
 *     may take 2 x DETAIL_MIN_SEGMENTS more, in a frame that is full without them)
 *   - through two octaves of zoom, in steps of 6 %, the number of lines never changes by more than 1.35 times between neighbours
 *   - eye level draws no detailed streaks
 *
 * The streaks themselves, built by `detailStreaks.ts`:
 *   - the Wind streaks switch alone shows the detailed streaks at level 4, and the old streaks step aside (`getObjectByName('wind').visible`);
 *     the volume streaks do not; the glyph switch alone shows them too
 *   - one draw call and 2 triangles a segment, at most the draw calls of level 3
 *   - reduced motion (`emulateMedia`): `detail: 'still'`, no frame in 3 s, two shots at the frozen frame are byte-equal; moving: the frame loop
 *     runs and two shots at different clocks differ; the picture is really drawn (a shot with the batch hidden differs)
 *   - the hand-over, sampled frame by frame with the real frame loop, never has an empty frame in either direction; 20 round trips leave
 *     the GPU objects and the heap where they were
 * Nothing in the console (the guard of ./fixtures).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { DETAIL_MIN_SEGMENTS, FRAME_TRIANGLE_LIMIT } from '../src/render/wind/glyphTypes';
import { acceptNotice, frame, newHand } from './helpers';

test.use({ deviceScaleFactor: 1, actionTimeout: 45_000 });

type Pt = [number, number];
interface CamState {
  target: Pt;
  distance: number;
  azimuthDeg: number;
  polarDeg: number;
  mode: 'orbit' | 'top' | 'ground';
}
interface Stats {
  active: boolean;
  idle: 'off' | 'eye-level' | 'no-wind' | 'budget' | null;
  level: number;
  count: number;
  segments: number;
  cellPx: number;
  cellM: number;
  rebuilds: number;
  detail: 'off' | 'moving' | 'still';
  detailSegments: number;
}
interface Info {
  calls: number;
  triangles: number;
  frame: number;
  geometries: number;
  textures: number;
  programs: number;
}
interface Mesh {
  visible: boolean;
  geometry: { instanceCount: number };
  material: { uniforms: Record<string, { value: number }> };
}
type View = {
  cameraState(): CamState;
  lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void;
  projectToScreen(x: number, y: number): Pt | null;
  setLayers(l: Record<string, unknown>): void;
  setViewMode(m: 'orbit' | 'top' | 'ground'): void;
  renderNow(): void;
  windGlyphStats?(): Stats | null;
  renderQuality: 'low' | 'medium' | 'high';
  glyphs: { setRelief(on: boolean): void };
  rig: { update(now: number): boolean };
  scene: { getObjectByName(n: string): Mesh | undefined };
  renderer: {
    render(scene: unknown, camera: unknown): void;
    domElement: HTMLCanvasElement;
    info: { render: { calls: number; triangles: number; frame: number }; memory: { geometries: number; textures: number }; programs?: unknown[] | null };
  };
};
type Handle = { __firesim: { view: View; session: { state: { get(): { snapshot: { atmosphere?: { kind?: string } } | null } } } } };

const airKind = (page: Page): Promise<string | null> => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().snapshot?.atmosphere?.kind ?? null);
const cam = (page: Page): Promise<CamState> => page.evaluate(() => (window as unknown as Handle).__firesim.view.cameraState());
const screenOf = (page: Page, x: number, y: number): Promise<Pt | null> => page.evaluate(([px, py]) => (window as unknown as Handle).__firesim.view.projectToScreen(px!, py!), [x, y]);
const lookAt = (page: Page, d: number, x = 0, y = 0, az = 200, tilt = 55): Promise<void> =>
  page.evaluate(([px, py, pd, a, t]) => (window as unknown as Handle).__firesim.view.lookAt(px!, py!, pd!, a!, t!, false), [x, y, d, az, tilt]);
const setLayers = (page: Page, l: Record<string, unknown>): Promise<void> => page.evaluate((v) => (window as unknown as Handle).__firesim.view.setLayers(v), l);
/** Draw a frame now (a rebuild is finished in it) and read what the layer says. */
const drawAndRead = (page: Page): Promise<Stats> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.renderNow();
    return v.windGlyphStats!()!;
  });
const infoOf = (page: Page): Promise<Info> =>
  page.evaluate(() => {
    const i = (window as unknown as Handle).__firesim.view.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, frame: i.render.frame, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 };
  });
const canvasHeight = (page: Page): Promise<number> => page.evaluate(() => document.querySelector('canvas')!.clientHeight);
const visibleOf = (page: Page, name: string): Promise<boolean | null> => page.evaluate((n) => (window as unknown as Handle).__firesim.view.scene.getObjectByName(n)?.visible ?? null, name);
const instancesOf = (page: Page, name: string): Promise<number | null> => page.evaluate((n) => (window as unknown as Handle).__firesim.view.scene.getObjectByName(n)?.geometry.instanceCount ?? null, name);

/** Build the Katoomba demo at the fast tier and the High picture tier, and wait for the air. */
async function build(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await acceptNotice(page);
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
  expect(await page.evaluate(() => (window as unknown as Handle).__firesim.view.renderQuality)).toBe('high');
}

/** Trees, roads and names off (a frame is cheap in the software-GL browser) and everything else that would keep the frame loop going: the Wind streaks stay as they are. */
const quietScene = (page: Page): Promise<void> =>
  setLayers(page, { vegetation: false, understorey: false, flames: false, smoke: false, embers: false, roads: false, fireTrails: false, placeNames: false, imagery: false, insightMarkers: false, windSway: false });

/** Let the camera come to rest (the rig's per-frame update, run many times without drawing). */
async function settle(page: Page): Promise<CamState> {
  await page.evaluate(() => {
    const rig = (window as unknown as Handle).__firesim.view.rig;
    const t0 = performance.now() + 4000;
    for (let i = 0; i < 100; i++) rig.update(t0 + i * 16);
  });
  await frame(page);
  return cam(page);
}

/** The levels a model cell of `cellPx` screen pixels may show, with the planner's +/-15 % hysteresis around the edges 4, 12, 32 and 90 px: [lowest, highest]. */
function levelBand(cellPx: number): [number, number] {
  let lo = 0;
  let hi = 0;
  [4, 12, 32, 90].forEach((edge, i) => {
    if (cellPx >= edge * 1.15) lo = i + 1;
    if (cellPx >= edge / 1.15) hi = i + 1;
  });
  return [lo, hi];
}
const expectBand = (s: Stats, what: string): void => {
  const [lo, hi] = levelBand(s.cellPx);
  expect(s.level, `${what}: level ${s.level} with a model cell of ${s.cellPx.toFixed(1)} px`).toBeGreaterThanOrEqual(lo);
  expect(s.level, `${what}: level ${s.level} with a model cell of ${s.cellPx.toFixed(1)} px`).toBeLessThanOrEqual(hi);
};

/** One frame of the 3-D view as a PNG, drawn and read in the same task; kept in the report and, with $WIND_DETAIL_SHOTS, on disk (for looking at). */
async function shot(page: Page, testInfo: TestInfo, name: string): Promise<Buffer> {
  const url = await page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.renderNow();
    return v.renderer.domElement.toDataURL('image/png');
  });
  const png = Buffer.from(url.split(',')[1]!, 'base64');
  await testInfo.attach(name, { body: png, contentType: 'image/png' });
  const dir = process.env.WIND_DETAIL_SHOTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), png);
  }
  return png;
}

/** Put the shared clock at `t` seconds (the detailed streaks' `uTime` is the view's own `uClock` object). */
const setClock = (page: Page, t: number): Promise<void> =>
  page.evaluate((v) => {
    (window as unknown as Handle).__firesim.view.scene.getObjectByName('wind-detail')!.material.uniforms.uTime!.value = v;
  }, t);

/** The camera distance at which one model cell is `px` screen pixels. */
const distanceFor = (cellM: number, canvasH: number, px: number): number => (cellM * canvasH) / (2 * Math.tan((25 * Math.PI) / 180) * px);

test('wind detail: the shader compiles, a real pinch walks the level with only the Wind streaks on, draw calls and triangles at the closest zoom, eye level', async ({ page }) => {
  test.setTimeout(900_000);
  await build(page);
  await quietScene(page);
  await setLayers(page, { windGlyphs: false, wind: 'surface', windHeight: 'fire' });
  const hand = await newHand(page);
  const H = await canvasHeight(page);
  expect(H).toBeGreaterThan(500);

  await test.step('the detail shader compiles and links in a real GL stack (the console guard fails the test on a shader error)', async () => {
    const r = await page.evaluate(() => {
      const v = (window as unknown as Handle).__firesim.view;
      const m = v.scene.getObjectByName('wind-detail')!;
      const before = v.renderer.info.programs?.length ?? 0;
      m.visible = true; // an empty batch is not drawn, but its program is built to find that out
      v.renderNow();
      const after = v.renderer.info.programs?.length ?? 0;
      m.visible = false;
      v.renderNow();
      return { before, after };
    });
    // (0.7.0: the scene view compiles the layer's programs ahead, when the first air arrives, so the program may be there already: it is built either way.)
    expect(r.after, 'the detail program was built').toBeGreaterThanOrEqual(r.before);
    expect(r.after, 'and there is a program for it').toBeGreaterThan(0);
  });

  // ───────── the ladder, by real pinches, with the Wind streaks alone ─────────
  const readings: { distance: number; stats: Stats }[] = [];
  const read = async (what: string): Promise<Stats> => {
    const c = await settle(page);
    const s = await drawAndRead(page);
    expectBand(s, what);
    console.log(`ladder, ${what}: ${c.distance.toFixed(0)} m out, a model cell is ${s.cellPx.toFixed(1)} px, L${s.level}, active ${s.active}, detail ${s.detail} (${s.detailSegments} segments), idle ${s.idle}`);
    expect(await page.evaluate(() => (window as unknown as Handle).__firesim.view.windGlyphStats!()!.level), `${what}: the level is the zoom's`).toBe(s.level);
    readings.push({ distance: c.distance, stats: s });
    return s;
  };
  await test.step('from 12 km with only the Wind streaks on: the level is told and nothing is built below the most detailed one', async () => {
    await lookAt(page, 12000, 0, 0, 200, 52);
    const s = await read('far');
    expect(s.level).toBeGreaterThanOrEqual(1);
    expect(s.level).toBeLessThanOrEqual(2);
    expect(s).toMatchObject({ active: false, idle: 'off', count: 0, segments: 0, detail: 'off', detailSegments: 0 });
    expect(await instancesOf(page, 'wind-glyph'), 'no arrows built').toBe(0);
    expect(await visibleOf(page, 'wind-detail')).toBe(false);
    expect(await visibleOf(page, 'wind'), 'the old Wind streaks are what moves here').toBe(true);
  });
  await test.step('three pinches of about 2.6x each bring the camera under 1 km: the level never goes down and ends at L4', async () => {
    for (let i = 1; i <= 3; i++) {
      const before = readings[readings.length - 1]!;
      const target = (await cam(page)).target;
      const c = (await screenOf(page, target[0], target[1]))!;
      await hand.down(1, c[0] - 30, c[1]);
      await hand.down(2, c[0] + 30, c[1]);
      await hand.drag({ 1: [c[0] - 78, c[1]], 2: [c[0] + 78, c[1]] }, 8);
      await hand.upAll();
      const s = await read(`after pinch ${i}`);
      const d = readings[readings.length - 1]!.distance;
      expect(d, `pinch ${i} zooms in`).toBeLessThan(before.distance * 0.6);
      expect(s.level, `pinch ${i} does not lower the level`).toBeGreaterThanOrEqual(before.stats.level);
      if (s.level < 4) expect(s, `pinch ${i}: below the closest level nothing is built`).toMatchObject({ active: false, idle: 'off', detail: 'off', segments: 0 });
    }
    const last = readings[readings.length - 1]!;
    expect(last.distance).toBeLessThan(1000);
    expect(last.stats.level).toBe(4);
    expect(new Set(readings.map((r) => r.stats.level)).size, 'at least three different levels on the way').toBeGreaterThanOrEqual(3);
    expect(last.stats, 'the closest zoom draws the detailed streaks').toMatchObject({ active: true, idle: null, detail: 'moving' });
  });

  // ───────── draw calls and triangles ─────────
  await test.step('at the closest zoom the draw calls are at most those one level out, and the frame stays inside 550,000 triangles, 2 x DETAIL_MIN_SEGMENTS more for the streaks (both switches on)', async () => {
    const cellM = (await drawAndRead(page)).cellM;
    expect(cellM).toBeGreaterThan(50);
    const measure = async (px: number, glyphs: boolean, wind: 'off' | 'surface'): Promise<{ info: Info; s: Stats }> => {
      await setLayers(page, { windGlyphs: glyphs, wind, windHeight: 'fire' });
      await lookAt(page, distanceFor(cellM, H, px));
      await settle(page);
      for (let i = 0; i < 2; i++) await drawAndRead(page);
      const s = await drawAndRead(page);
      return { info: await infoOf(page), s };
    };
    const base3 = await measure(50, false, 'off');
    const on3 = await measure(50, true, 'surface');
    const base4 = await measure(150, false, 'off');
    const on4 = await measure(150, true, 'surface');
    expect(on3.s.level).toBe(3);
    expect(on4.s.level).toBe(4);
    const extra3 = on3.info.calls - base3.info.calls;
    const extra4 = on4.info.calls - base4.info.calls;
    console.log(`draw calls added: L3 ${extra3} (base ${base3.info.calls}), L4 ${extra4} (base ${base4.info.calls}); triangles L3 +${on3.info.triangles - base3.info.triangles}, L4 +${on4.info.triangles - base4.info.triangles}; detail ${on4.s.detailSegments} segments, ${on4.s.count} lines`);
    expect(extra3, 'L3: the glyph pair and the old Wind streaks').toBe(3);
    expect(extra4, 'L4: at most what L3 adds').toBeLessThanOrEqual(extra3);
    expect(on4.info.calls).toBeLessThanOrEqual(base4.info.calls + extra3);
    expect(on3.info.triangles).toBeLessThanOrEqual(FRAME_TRIANGLE_LIMIT);
    // The detailed streaks keep a floor in a full frame (a dense forest at the High tier is over the limit without them): at most that much over it.
    expect(on4.info.triangles).toBeLessThanOrEqual(FRAME_TRIANGLE_LIMIT + 2 * DETAIL_MIN_SEGMENTS);
    expect(on4.s.detailSegments).toBeGreaterThan(500);
    expect(on4.s.detailSegments).toBeLessThanOrEqual(12_000);
    expect(extra4, 'L4: the detailed streaks are one draw call, and the old Wind streaks are not drawn').toBe(1);
    expect(on4.info.triangles - base4.info.triangles, 'two triangles a segment').toBe(2 * on4.s.detailSegments);
    expect(on4.s.segments, 'everything drawn is the streaks').toBe(on4.s.detailSegments);
    await setLayers(page, { windGlyphs: false, wind: 'surface' });
  });

  // ───────── the zoom through the lattice's octaves ─────────
  await test.step('the line count follows the zoom: over two octaves, in steps of 6 %, no two neighbours differ by more than 1.35 times, and the picture is never empty', async () => {
    await setLayers(page, { windGlyphs: false, wind: 'surface', windHeight: 'fire' });
    const cellM = (await drawAndRead(page)).cellM;
    const counts: number[] = [];
    for (let px = 120; px < 580; px *= 1.06) {
      await lookAt(page, distanceFor(cellM, H, px));
      await settle(page);
      const s = await drawAndRead(page);
      expect(s.level, `a model cell of ${px.toFixed(0)} px`).toBe(4);
      expect(s.detail).toBe('moving');
      counts.push(s.count);
    }
    console.log(`lines through two octaves of zoom (6 % steps): ${counts.join(' ')}`);
    expect(counts.length).toBeGreaterThan(20);
    expect(Math.min(...counts), 'a picture at every step').toBeGreaterThan(100);
    for (let i = 1; i < counts.length; i++) {
      const r = Math.max(counts[i]! / counts[i - 1]!, counts[i - 1]! / counts[i]!);
      expect(r, `${counts[i - 1]} to ${counts[i]} lines at step ${i}`).toBeLessThan(1.35);
    }
  });

  // ───────── eye level ─────────
  await test.step('eye level draws no detailed streaks, and the map view draws them again', async () => {
    await lookAt(page, distanceFor((await drawAndRead(page)).cellM, H, 150));
    await settle(page);
    await page.evaluate(() => (window as unknown as Handle).__firesim.view.setViewMode('ground'));
    const s = await drawAndRead(page);
    expect(s).toMatchObject({ active: false, idle: 'eye-level', level: 0, detail: 'off', detailSegments: 0 });
    expect(await visibleOf(page, 'wind-detail')).toBe(false);
    await page.evaluate(() => (window as unknown as Handle).__firesim.view.setViewMode('orbit'));
    await lookAt(page, distanceFor(s.cellM, H, 150));
    await settle(page);
    const back = await drawAndRead(page);
    expect(back.level).toBe(4);
    expect(back.idle).toBeNull();
    expect(back.detail).toBe('moving');
  });
});

test('wind detail: the streaks from either switch, the old streaks step aside, reduced motion, the hand-over, no leak', async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  await build(page);
  await quietScene(page);
  await setLayers(page, { windGlyphs: false, wind: 'surface', windHeight: 'fire' });
  const H = await canvasHeight(page);
  const cellM = (await drawAndRead(page)).cellM;
  const at = (px: number): number => distanceFor(cellM, H, px);
  const go = async (px: number): Promise<Stats> => {
    await lookAt(page, at(px));
    await settle(page);
    return drawAndRead(page);
  };

  await test.step('the Wind streaks switch alone shows the detailed streaks at level 4, and the old streaks step aside; one level out it is the other way round', async () => {
    const s = await go(150);
    expect(s).toMatchObject({ active: true, idle: null, level: 4, detail: 'moving' });
    expect(s.detailSegments).toBeGreaterThan(500);
    expect(await visibleOf(page, 'wind-detail')).toBe(true);
    expect(await instancesOf(page, 'wind-detail')).toBe(s.detailSegments);
    expect(await visibleOf(page, 'wind'), 'the old particles are hidden while the detailed streaks are drawn').toBe(false);
    expect(await visibleOf(page, 'wind-glyph'), 'and no arrows').toBe(false);
    const out = await go(50);
    expect(out).toMatchObject({ active: false, idle: 'off', level: 3, detail: 'off', detailSegments: 0 });
    expect(await visibleOf(page, 'wind-detail')).toBe(false);
    expect(await visibleOf(page, 'wind'), 'the old particles are back').toBe(true);
  });

  await test.step('the glyph switch alone shows them too, and the volume streaks keep the old layer', async () => {
    await setLayers(page, { windGlyphs: true, wind: 'off' });
    const g = await go(150);
    expect(g).toMatchObject({ active: true, level: 4, detail: 'moving' });
    expect(await visibleOf(page, 'wind-detail')).toBe(true);
    await setLayers(page, { windGlyphs: false, wind: 'volume' });
    const v = await go(150);
    expect(v, 'the volume kind is not the detailed picture').toMatchObject({ active: false, detail: 'off' });
    expect(await visibleOf(page, 'wind'), 'the volume particles are drawn as before').toBe(true);
    await setLayers(page, { windGlyphs: true, wind: 'volume' });
    const both = await go(150);
    expect(both).toMatchObject({ active: true, detail: 'moving' });
    expect(await visibleOf(page, 'wind'), 'the volume particles stay with the detailed streaks drawn too').toBe(true);
    await setLayers(page, { windGlyphs: false, wind: 'surface' });
  });

  await test.step('the picture is really drawn: the frame with the batch hidden is another frame', async () => {
    await go(150);
    const withDetail = await shot(page, testInfo, 'wind-detail-L4.png');
    await page.evaluate(() => {
      (window as unknown as Handle).__firesim.view.scene.getObjectByName('wind-detail')!.visible = false;
    });
    const without = await shot(page, testInfo, 'wind-detail-L4-hidden.png');
    expect(withDetail.equals(without), 'the detailed streaks change the frame').toBe(false);
    await page.evaluate(() => {
      (window as unknown as Handle).__firesim.view.scene.getObjectByName('wind-detail')!.visible = true;
    });
  });

  if (process.env.WIND_DETAIL_SHOTS) {
    await test.step('for looking at: the closest zooms at a fixed clock (WIND_DETAIL_SHOTS)', async () => {
      for (const px of [110, 150, 250, 600, 1500, 4000]) {
        await go(px);
        await setClock(page, 2.4);
        await shot(page, testInfo, `look-${px}px-t2.4.png`);
        await setClock(page, 7.1);
        await shot(page, testInfo, `look-${px}px-t7.1.png`);
      }
    });
  }

  await test.step('moving: the frame loop runs and the picture changes with the clock', async () => {
    await go(150);
    const f0 = (await infoOf(page)).frame;
    await page.waitForTimeout(3000);
    expect((await infoOf(page)).frame - f0, 'frames drawn in 3 s: the streaks move on the GPU, the loop has to draw').toBeGreaterThan(0);
    await setClock(page, 2.0);
    const a = await shot(page, testInfo, 'wind-detail-t2.0.png');
    await setClock(page, 2.5);
    const b = await shot(page, testInfo, 'wind-detail-t2.5.png');
    expect(a.equals(b), 'half a second later the streaks are somewhere else').toBe(false);
  });

  await test.step('reduced motion: still, no frame in 3 s, and the frozen frame is the same frame every time', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await frame(page);
    await page.waitForTimeout(500);
    const s = await drawAndRead(page);
    expect(s).toMatchObject({ active: true, detail: 'still' });
    expect(await page.evaluate(() => (window as unknown as Handle).__firesim.view.scene.getObjectByName('wind-detail')!.material.uniforms.uMoving!.value)).toBe(0);
    await page.waitForTimeout(500);
    const f0 = (await infoOf(page)).frame;
    await page.waitForTimeout(3000);
    expect((await infoOf(page)).frame - f0, 'frames drawn in 3 s under reduced motion').toBe(0);
    await setClock(page, 2.0);
    const a = await shot(page, testInfo, 'wind-detail-still-a.png');
    await setClock(page, 9.0);
    const b = await shot(page, testInfo, 'wind-detail-still-b.png');
    expect(a.equals(b), 'the clock does not move a frozen picture').toBe(true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await frame(page);
    await page.waitForTimeout(500);
    expect((await drawAndRead(page)).detail).toBe('moving');
  });

  await test.step('the depth bias of the glyph strokes carries over: the streaks show through the crowns in front of them, a ridge still hides what is behind it', async () => {
    // Reduced motion freezes the picture, so that a frame can be compared with itself. The streaks' pixels are those that change when the batch is hidden.
    // (0.7.0: the relief rides the strokes on the canopy where trees are drawn, which is a different depth story: the numbers below are about the 0.6.0 stroke,
    // 1.5 m over the ground, so the relief is switched off for them and measured on its own after.)
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => (window as unknown as Handle).__firesim.view.glyphs.setRelief(false));
    await setLayers(page, { vegetation: true, understorey: true, imagery: true, windGlyphs: true, wind: 'off' });
    const bias = (b?: number): Promise<number> =>
      page.evaluate((to) => {
        const u = (window as unknown as Handle).__firesim.view.scene.getObjectByName('wind-detail')!.material.uniforms.uDepthBias!;
        const was = u.value;
        if (to !== undefined) u.value = to;
        return was;
      }, b);
    /** Pixels the streaks change: the frame as it is against the same frame with the batch hidden. */
    const strokes = (): Promise<number> =>
      page.evaluate(() => {
        const v = (window as unknown as Handle).__firesim.view;
        const m = v.scene.getObjectByName('wind-detail')!;
        const read = (): Uint8ClampedArray => {
          v.renderNow();
          const src = v.renderer.domElement;
          const c = document.createElement('canvas');
          c.width = src.width;
          c.height = src.height;
          const g = c.getContext('2d', { willReadFrequently: true })!;
          g.drawImage(src, 0, 0);
          return g.getImageData(0, 0, c.width, c.height).data;
        };
        const withStreaks = read();
        m.visible = false;
        const without = read();
        m.visible = true;
        let n = 0;
        for (let i = 0; i < withStreaks.length; i += 4) {
          if (Math.abs(withStreaks[i]! - without[i]!) + Math.abs(withStreaks[i + 1]! - without[i + 1]!) + Math.abs(withStreaks[i + 2]! - without[i + 2]!) > 40) n++;
        }
        return n;
      });
    const both = async (what: string): Promise<{ biased: number; plain: number }> => {
      await settle(page);
      const asked = await bias();
      const biased = await strokes();
      await bias(0);
      const plain = await strokes();
      await bias(asked);
      console.log(`${what}: ${biased} px of streaks with the depth bias (${asked} m), ${plain} px without`);
      return { biased, plain };
    };
    expect(await bias(), 'the streaks ask for the glyph strokes\' depth bias').toBe(40);
    await lookAt(page, 700, 0, 0, 200, 55);
    await drawAndRead(page);
    const over = await both('700 m, 55 degrees, over the forest');
    expect(over.plain, 'there are streaks to count').toBeGreaterThan(1000);
    expect(over.biased, 'the bias shows at least a third more of the streaks than the plain depth test').toBeGreaterThan(over.plain * 1.3);
    await lookAt(page, 1000, 800, -600, 90, 65);
    await drawAndRead(page);
    const across = await both('1000 m, 65 degrees, from the west');
    expect(across.plain).toBeGreaterThan(3000);
    // The bias adds only the streaks under crowns: here it shows 10 % more (switching the depth test off would show every streak behind the ridge).
    expect(across.biased, 'streaks behind a ridge stay hidden').toBeLessThan(across.plain * 1.25);
    // With the relief the strokes ride the canopy's top, so the plain depth test already shows most of them: the bias still never shows fewer, and a ridge still hides.
    await page.evaluate(() => (window as unknown as Handle).__firesim.view.glyphs.setRelief(true));
    await lookAt(page, 700, 0, 0, 200, 55);
    await drawAndRead(page);
    const ridden = await both('700 m, 55 degrees, over the forest, with the relief');
    expect(ridden.plain, 'there are streaks to count').toBeGreaterThan(1000);
    expect(ridden.biased, 'the bias never shows fewer streaks').toBeGreaterThanOrEqual(ridden.plain * 0.98);
    await lookAt(page, 1000, 800, -600, 90, 65);
    await drawAndRead(page);
    const ridgeSide = await both('1000 m, 65 degrees, from the west, with the relief');
    expect(ridgeSide.biased, 'streaks behind a ridge stay hidden').toBeLessThan(ridgeSide.plain * 1.25);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await setLayers(page, { vegetation: false, understorey: false, imagery: false, windGlyphs: false, wind: 'surface' });
  });

  await test.step('the hand-over has no empty frame, in either direction, with the real frame loop', async () => {
    await setLayers(page, { windGlyphs: true, wind: 'surface' });
    await go(50); // the arrows of level 3
    const sample = (px: number): Promise<{ glyph: number; detail: number; level: number; fade: number }[]> =>
      page.evaluate(
        ([d]) =>
          new Promise((resolve) => {
            const v = (window as unknown as Handle).__firesim.view;
            const draw = v.renderer.render;
            v.renderer.render = () => undefined; // the frame loop, the camera and the layer run; the software GL does not draw
            const seen: { glyph: number; detail: number; level: number; fade: number }[] = [];
            const t0 = performance.now();
            v.lookAt(0, 0, d!, 200, 55, false);
            const tick = (): void => {
              const detail = v.scene.getObjectByName('wind-detail')!;
              seen.push({
                glyph: v.scene.getObjectByName('wind-glyph')!.geometry.instanceCount,
                detail: detail.visible ? detail.geometry.instanceCount : 0,
                level: v.windGlyphStats!()!.level,
                fade: detail.material.uniforms.uFade!.value,
              });
              if (performance.now() - t0 < 4000 && seen.length < 400) requestAnimationFrame(tick);
              else {
                v.renderer.render = draw;
                resolve(seen);
              }
            };
            requestAnimationFrame(tick);
          }),
        [px],
      );
    const emptyAfterFirst = (frames: { glyph: number; detail: number }[]): number[] => {
      const first = frames.findIndex((f) => f.glyph > 0 || f.detail > 0);
      return frames.flatMap((f, i) => (first >= 0 && i > first && f.glyph === 0 && f.detail === 0 ? [i] : []));
    };
    const inward = await sample(at(150));
    expect(emptyAfterFirst(inward), 'frames with nothing drawn on the way in').toEqual([]);
    expect(inward[inward.length - 1]).toMatchObject({ glyph: 0, level: 4 });
    expect(inward[inward.length - 1]!.detail).toBeGreaterThan(0);
    expect(inward[inward.length - 1]!.fade, 'faded in').toBe(1);
    const outward = await sample(at(50));
    expect(emptyAfterFirst(outward), 'frames with nothing drawn on the way out').toEqual([]);
    expect(outward[outward.length - 1]).toMatchObject({ detail: 0, level: 3 });
    expect(outward[outward.length - 1]!.glyph).toBeGreaterThan(0);
    await setLayers(page, { windGlyphs: false });
  });

  await test.step('20 round trips between the two levels leave the GPU objects and the heap where they were', async () => {
    const cdp = await page.context().newCDPSession(page);
    const probe = async (): Promise<{ heapMB: number; geometries: number; textures: number }> => {
      await cdp.send('HeapProfiler.collectGarbage');
      const i = await infoOf(page);
      const heap = await page.evaluate(() => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576);
      return { heapMB: heap, geometries: i.geometries, textures: i.textures };
    };
    await go(150);
    await go(50);
    const base = await probe();
    for (let i = 0; i < 20; i++) {
      await go(i % 2 ? 50 : 150);
      await go(i % 2 ? 150 : 50);
    }
    const end = await probe();
    console.log(`leak: base ${JSON.stringify(base)} end ${JSON.stringify(end)}`);
    expect(end.geometries, 'geometries').toBeLessThanOrEqual(base.geometries);
    expect(end.textures, 'textures').toBeLessThanOrEqual(base.textures);
    expect(end.heapMB - base.heapMB, 'JS heap grew by (MB)').toBeLessThan(12);
  });
});
