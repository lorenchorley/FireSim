/**
 * Wind arrows and flow lines (0.5.0, stage E1) in the real app (bundled Katoomba demo, 6 km, offline, the fast tier, the High picture
 * tier, the real worker, a Pixel 7 profile at device scale 1). The layer's own rules are unit-tested (src/render/wind); this checks
 * what only the real view can show:
 *
 *   - a REAL pinch zoom (CDP touch) from 12 km to under 1 km walks the ladder: the level never goes down, starts at L1 or L2 and ends
 *     at L4, and always agrees with the pixels a model cell covers (`cellPx`, within the planner's 15 % hysteresis); a pan keeps it
 *   - three zooms x two heights (the 10 m wind, `'fire'`, and 300 m): the picture is drawn, the numbers fit the zoom, the heights draw differently;
 *     the screenshots go to the report (and to $WIND_GLYPH_SHOTS when it is set) for the docs gallery and for looking at
 *   - eye level draws nothing and says why; going back draws again
 *   - under a 4x CPU slowdown a rebuild stays in slices (p95 <= 12 ms, at most 4 slices) while the camera pans for 5 s
 *   - at the High tier with everything on: two more draw calls, 4 triangles a segment, the frame inside 550,000 triangles; off draws nothing extra
 *   - 60 on / off and height changes and 20 zooms leave renderer.info.memory and the JS heap where they were
 *   - with the glyphs on and nothing else moving the frame loop stops (the layer never keeps `animating` on)
 *   - the 2-D stand-in map (?mock=1) has no glyph statistics
 * Nothing in the console (the guard of ./fixtures).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, frame, newHand } from './helpers';

// The software-GL test browser draws about one frame per second whatever the resolution; the smaller canvas keeps each frame cheap.
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
  idle: 'off' | 'eye-level' | 'no-wind' | null;
  level: number;
  count: number;
  segments: number;
  cellPx: number;
  cellM: number;
  rebuilds: number;
  lastMs: number;
  sliceP95Ms: number;
  sliceMaxMs: number;
  slicesLast: number;
}
type Height = 'fire' | 50 | 100 | 300 | 1000 | 2000;
interface Info {
  calls: number;
  triangles: number;
  frame: number;
  geometries: number;
  textures: number;
}
type View = {
  cameraState(): CamState;
  projectToScreen(x: number, y: number): Pt | null;
  lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void;
  setLayers(l: Record<string, unknown>): void;
  setViewMode(m: 'orbit' | 'top' | 'ground'): void;
  renderNow(): void;
  windGlyphStats?(): Stats | null;
  stats(): { drawCalls: number; triangles: number; windGlyphs?: { level: number; count: number } };
  renderQuality: 'low' | 'medium' | 'high';
  rig: { update(now: number): boolean };
  scene: { getObjectByName(n: string): { visible: boolean; geometry: { instanceCount: number } } | undefined };
  renderer: {
    render(scene: unknown, camera: unknown): void;
    domElement: HTMLCanvasElement;
    info: { render: { calls: number; triangles: number; frame: number }; memory: { geometries: number; textures: number } };
  };
};
type Handle = { __firesim: { view: View; session: { state: { get(): { snapshot: { atmosphere?: { kind?: string } } | null } } } } };

const airKind = (page: Page): Promise<string | null> => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().snapshot?.atmosphere?.kind ?? null);
const cam = (page: Page): Promise<CamState> => page.evaluate(() => (window as unknown as Handle).__firesim.view.cameraState());
const screenOf = (page: Page, x: number, y: number): Promise<Pt | null> => page.evaluate(([px, py]) => (window as unknown as Handle).__firesim.view.projectToScreen(px!, py!), [x, y]);
const lookAt = (page: Page, d: number, x = 0, y = 0, az = 200, tilt = 55): Promise<void> =>
  page.evaluate(([px, py, pd, a, t]) => (window as unknown as Handle).__firesim.view.lookAt(px!, py!, pd!, a!, t!, false), [x, y, d, az, tilt]);
const setLayers = (page: Page, l: Record<string, unknown>): Promise<void> => page.evaluate((v) => (window as unknown as Handle).__firesim.view.setLayers(v), l);
/** Draw a frame now (the glyph rebuild is finished in it) and read what the layer says. */
const drawAndRead = (page: Page): Promise<Stats> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.renderNow();
    return v.windGlyphStats!()!;
  });
const infoOf = (page: Page): Promise<Info> =>
  page.evaluate(() => {
    const i = (window as unknown as Handle).__firesim.view.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, frame: i.render.frame, geometries: i.memory.geometries, textures: i.memory.textures };
  });
const canvasHeight = (page: Page): Promise<number> => page.evaluate(() => document.querySelector('canvas')!.clientHeight);

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

/** Trees, roads, particles and names off: a frame is cheap in the software-GL browser and the glyphs stand alone on plain relief. */
const lightScene = (page: Page): Promise<void> =>
  setLayers(page, { vegetation: false, understorey: false, wind: 'off', flames: false, smoke: false, embers: false, roads: false, fireTrails: false, placeNames: false, imagery: false, insightMarkers: false, windSway: false });

/** Let the camera come to rest (the rig's per-frame update, run many times without drawing), as the gesture specs do. */
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

/** One frame of the 3-D view as a PNG, drawn and read in the same task (nothing else is drawn in between); kept in the report and, with $WIND_GLYPH_SHOTS, on disk. */
async function shot(page: Page, testInfo: TestInfo, name: string): Promise<Buffer> {
  const url = await page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.renderNow();
    return v.renderer.domElement.toDataURL('image/png');
  });
  const png = Buffer.from(url.split(',')[1]!, 'base64');
  await testInfo.attach(name, { body: png, contentType: 'image/png' });
  const dir = process.env.WIND_GLYPH_SHOTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), png);
  }
  return png;
}

test('wind glyphs: a real pinch walks the ladder, a pan keeps the level, three zooms at two heights, eye level, 4x CPU', async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  await build(page);
  await lightScene(page);
  const enableMs = await page.evaluate(() => {
    const t0 = performance.now();
    (window as unknown as Handle).__firesim.view.setLayers({ windGlyphs: true, windHeight: 'fire' });
    return performance.now() - t0;
  });
  console.log(`first switch-on, warm-up included: ${enableMs.toFixed(1)} ms`);
  const hand = await newHand(page);
  const H = await canvasHeight(page);
  expect(H).toBeGreaterThan(500);

  // ───────── the ladder, by real pinches ─────────
  const readings: { distance: number; stats: Stats }[] = [];
  const read = async (what: string): Promise<Stats> => {
    const c = await settle(page);
    const s = await drawAndRead(page);
    expectBand(s, what);
    console.log(`ladder, ${what}: ${c.distance.toFixed(0)} m out, a model cell is ${s.cellPx.toFixed(1)} px, L${s.level}, ${s.count} glyphs, ${s.segments} segments, rebuild ${s.lastMs.toFixed(1)} ms in ${s.slicesLast} slice(s)`);
    expect(s.idle, `${what}: nothing is said to be missing`).toBeNull();
    expect(await page.evaluate(() => (window as unknown as Handle).__firesim.view.stats().windGlyphs), `${what}: view.stats().windGlyphs is the level and the count`).toEqual({ level: s.level, count: s.count });
    readings.push({ distance: c.distance, stats: s });
    return s;
  };
  await test.step('from 12 km: the arrows of L1 or L2, drawn', async () => {
    await lookAt(page, 12000, 0, 0, 200, 52);
    const s = await read('far');
    expect(s.active).toBe(true);
    expect(s.count).toBeGreaterThan(20);
    expect(s.segments).toBeGreaterThan(s.count); // a shaft and a head at least
    expect(s.level).toBeGreaterThanOrEqual(1);
    expect(s.level).toBeLessThanOrEqual(2);
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
      expect(s.active).toBe(true);
    }
    const last = readings[readings.length - 1]!;
    expect(last.distance).toBeLessThan(1000);
    expect(last.stats.level).toBe(4);
    expect(new Set(readings.map((r) => r.stats.level)).size, 'at least three different levels on the way').toBeGreaterThanOrEqual(3);
  });
  await test.step('a one-finger pan keeps the level and redraws the picture', async () => {
    const before = readings[readings.length - 1]!.stats;
    const target = (await cam(page)).target;
    const c = (await screenOf(page, target[0], target[1]))!;
    await hand.down(1, c[0], c[1]);
    await hand.drag({ 1: [c[0] + 200, c[1] + 100] }, 8);
    await hand.upAll();
    const s = await read('after a pan');
    expect(s.level).toBe(before.level);
    expect(s.rebuilds, 'a pan of that size makes a new picture').toBeGreaterThan(before.rebuilds);
    expect(s.count).toBeGreaterThan(0);
  });

  // ───────── three zooms x two heights ─────────
  const bytes: Record<string, Buffer> = {};
  await test.step('three zooms at two heights: drawn at the level the zoom asks for, and the heights are not the same picture', async () => {
    const cellM = (await drawAndRead(page)).cellM;
    expect(cellM).toBeGreaterThan(50);
    // The distance that puts a model cell at `px` pixels: far (an L1 arrow field), middle (L3 curves), close (L4 long lines).
    const at = (px: number): number => (cellM * H) / (2 * Math.tan((25 * Math.PI) / 180) * px);
    const zooms = [
      { name: 'far', px: 8, level: 1 },
      { name: 'middle', px: 50, level: 3 },
      { name: 'close', px: 150, level: 4 },
    ] as const;
    for (const height of ['fire', 300] as const) {
      await setLayers(page, { windHeight: height });
      for (const z of zooms) {
        await lookAt(page, at(z.px));
        await settle(page);
        const s = await drawAndRead(page);
        expect(s, `${height} ${z.name}`).toMatchObject({ active: true, level: z.level });
        expect(s.count, `${height} ${z.name}: glyphs`).toBeGreaterThan(10); // far out the 6 km area is a small part of the screen
        bytes[`${height}-${z.name}`] = await shot(page, testInfo, `wind-glyphs-${height === 'fire' ? 'ground' : `${height}m`}-${z.name}.png`);
      }
    }
    for (const z of zooms) expect(bytes[`fire-${z.name}`]!.equals(bytes[`300-${z.name}`]!), `the 10 m wind and 300 m differ at the ${z.name} zoom`).toBe(false);
    // The same two for the sake of looking: the aerial photo and the canopy under the glyphs (the halo has to carry the pale stops).
    await setLayers(page, { windHeight: 'fire', imagery: true, vegetation: true, understorey: true });
    await lookAt(page, at(50));
    await settle(page);
    await drawAndRead(page);
    await shot(page, testInfo, 'wind-glyphs-ground-middle-aerial.png');
    await setLayers(page, { imagery: false, vegetation: false, understorey: false });
  });

  // ───────── eye level ─────────
  await test.step('eye level draws nothing and says why; the map view draws again', async () => {
    await lookAt(page, 2500);
    await settle(page);
    await setLayers(page, { windGlyphs: false });
    await page.evaluate(() => (window as unknown as Handle).__firesim.view.setViewMode('ground'));
    await drawAndRead(page);
    const off = await infoOf(page);
    await setLayers(page, { windGlyphs: true });
    const s = await drawAndRead(page);
    const on = await infoOf(page);
    expect(s).toMatchObject({ active: false, idle: 'eye-level', level: 0, count: 0 });
    expect(on.calls, 'no extra draw calls at eye level').toBe(off.calls);
    expect(on.triangles, 'no extra triangles at eye level').toBe(off.triangles);
    expect(await page.evaluate(() => (window as unknown as Handle).__firesim.view.scene.getObjectByName('wind-glyph')!.visible)).toBe(false);
    await page.evaluate(() => (window as unknown as Handle).__firesim.view.setViewMode('orbit'));
    await lookAt(page, 2500);
    await settle(page);
    expect(await drawAndRead(page)).toMatchObject({ active: true, idle: null });
  });

  // ───────── a 4x slower CPU ─────────
  await test.step('under a 4x CPU slowdown a rebuild stays in slices while the camera pans for 5 s (and 30 frames)', async () => {
    const cdp: CDPSession = await page.context().newCDPSession(page);
    await setLayers(page, { windHeight: 300 });
    await lookAt(page, 2500);
    await settle(page);
    await drawAndRead(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    try {
      // The drawing is skipped (the test browser's software GL draws a frame a second): the frame loop, the camera and the layer's
      // rebuilds run at the display rate, as on a phone, and the 5 s of panning ask for a rebuild every time the gap allows.
      const r = await page.evaluate(
        (d) =>
          new Promise<{ rebuilds0: number; rebuilds1: number; frames: number; swapsAt: number[] }>((resolve) => {
            const v = (window as unknown as Handle).__firesim.view;
            const draw = v.renderer.render;
            v.renderer.render = () => undefined;
            const rebuilds0 = v.windGlyphStats!()!.rebuilds;
            const t0 = performance.now();
            let frames = 0;
            let seen = rebuilds0;
            const swapsAt: number[] = [];
            const tick = (now: number): void => {
              frames++;
              const rebuilds = v.windGlyphStats!()!.rebuilds;
              if (rebuilds !== seen) {
                seen = rebuilds;
                swapsAt.push(frames);
              }
              const a = (now - t0) / 500; // a circle of 1.4 km: about 47 m a frame, so a rebuild is due about as often as the 250 ms gap allows
              v.lookAt(1400 * Math.cos(a), 1400 * Math.sin(a), d, 200, 55, false);
              // 5 s of panning, and at least 30 frames of it (a shared machine can draw a frame a second): the slices are what is measured.
              if ((now - t0 < 5000 || frames < 30) && now - t0 < 90_000) requestAnimationFrame(tick);
              else {
                v.renderer.render = draw;
                resolve({ rebuilds0, rebuilds1: v.windGlyphStats!()!.rebuilds, frames, swapsAt });
              }
            };
            requestAnimationFrame(tick);
          }),
        2500,
      );
      const s = (await page.evaluate(() => (window as unknown as Handle).__firesim.view.windGlyphStats!()))!;
      console.log(`4x CPU: ${r.rebuilds1 - r.rebuilds0} rebuilds in ${r.frames} frames (swapped at frames ${r.swapsAt.join(', ')}), slice p95 ${s.sliceP95Ms.toFixed(2)} ms, max ${s.sliceMaxMs.toFixed(2)} ms, last ${s.slicesLast} slices, ${s.lastMs.toFixed(2)} ms`);
      // One slice a frame and at most four rebuilds a second: how many there are depends on how fast this machine draws a frame.
      expect(r.rebuilds1 - r.rebuilds0, 'the pan made rebuilds').toBeGreaterThanOrEqual(3);
      expect(s.sliceP95Ms, 'p95 of a slice (ms)').toBeLessThanOrEqual(12);
      expect(s.slicesLast, 'slices of the last rebuild').toBeLessThanOrEqual(4);
      expect(s.count).toBeGreaterThan(0);
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
  });
});

test('wind glyphs: two draw calls, 4 triangles a segment, inside 550,000 at High with everything on; no leak; the loop stops', async ({ page }) => {
  test.setTimeout(900_000);
  await build(page);
  const cdp = await page.context().newCDPSession(page);
  const read = async (): Promise<Stats> => drawAndRead(page);

  await test.step('everything on at the High tier: +2 draw calls, +4 triangles a segment, inside the frame budgets', async () => {
    await lookAt(page, 3000);
    await settle(page);
    await setLayers(page, { windGlyphs: false });
    for (let i = 0; i < 3; i++) await read(); // three frames, so the canopy and the labels are settled
    const off = await infoOf(page);
    await setLayers(page, { windGlyphs: true, windHeight: 'fire' });
    for (let i = 0; i < 3; i++) await read();
    const on = await infoOf(page);
    const s = (await read())!;
    expect(s.active).toBe(true);
    expect(on.calls - off.calls, 'draw calls the glyphs add').toBe(2);
    expect(on.triangles - off.triangles, 'triangles the glyphs add: 4 a segment').toBe(4 * s.segments);
    expect(on.calls, 'draw calls in all').toBeLessThanOrEqual(25);
    expect(on.triangles, 'triangles in all').toBeLessThanOrEqual(550_000);
    expect(s.segments).toBeLessThanOrEqual(12_000);
    console.log(`High, everything on, L${s.level}: ${off.calls} -> ${on.calls} draw calls, ${off.triangles} -> ${on.triangles} triangles, ${s.count} glyphs, ${s.segments} segments`);
    // The close zoom and a numeric height: the densest the layer draws.
    await setLayers(page, { windHeight: 100 });
    await lookAt(page, 900);
    await settle(page);
    for (let i = 0; i < 2; i++) await read();
    const close = await infoOf(page);
    const c = await read();
    expect(c.level).toBe(4);
    expect(close.calls).toBeLessThanOrEqual(25);
    expect(close.triangles).toBeLessThanOrEqual(550_000);
    // Switched off again: nothing extra is drawn.
    await setLayers(page, { windGlyphs: false });
    for (let i = 0; i < 2; i++) await read();
    const gone = await infoOf(page);
    expect(gone.calls).toBe(close.calls - 2);
  });

  await lightScene(page);
  await setLayers(page, { windGlyphs: true, windHeight: 'fire' });
  const probe = async (): Promise<{ heapMB: number; geometries: number; textures: number }> => {
    await cdp.send('HeapProfiler.collectGarbage');
    const i = await infoOf(page);
    const heap = await page.evaluate(() => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576);
    return { heapMB: heap, geometries: i.geometries, textures: i.textures };
  };

  await test.step('60 on / off and height changes and 20 zooms leave the GPU objects and the heap where they were', async () => {
    const heights: Height[] = ['fire', 50, 100, 300, 1000, 2000];
    await lookAt(page, 3000);
    await settle(page);
    await read(); // the first picture makes its two batches: the baseline is taken after it
    await setLayers(page, { windGlyphs: false });
    await read();
    const base = await probe();
    for (let i = 0; i < 60; i++) {
      await setLayers(page, { windGlyphs: i % 4 !== 3, windHeight: heights[i % 6]! });
      await read();
    }
    for (let i = 0; i < 20; i++) {
      await setLayers(page, { windGlyphs: true });
      await lookAt(page, 14000 / 1.25 ** i);
      await read();
    }
    const end = await probe();
    console.log(`leak: base ${JSON.stringify(base)} end ${JSON.stringify(end)}`);
    expect(end.geometries, 'geometries').toBeLessThanOrEqual(base.geometries);
    expect(end.textures, 'textures').toBeLessThanOrEqual(base.textures);
    expect(end.heapMB - base.heapMB, 'JS heap grew by (MB)').toBeLessThan(12);
  });

  await test.step('with the glyphs on and nothing else moving, the frame loop stops', async () => {
    await lookAt(page, 3000);
    await settle(page);
    await setLayers(page, { windGlyphs: false });
    await read();
    const frames = async (ms: number): Promise<number> => {
      const f0 = (await infoOf(page)).frame;
      await page.waitForTimeout(ms);
      return (await infoOf(page)).frame - f0;
    };
    // Whatever the engine was still publishing has settled; then a window with no frame at all.
    await expect.poll(() => frames(1500), { timeout: 60_000, intervals: [250] }).toBe(0);
    await setLayers(page, { windGlyphs: true });
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as Handle).__firesim.view.windGlyphStats!()!)).active, { timeout: 60_000 }).toBe(true); // the first picture came by itself
    const s = (await page.evaluate(() => (window as unknown as Handle).__firesim.view.windGlyphStats!()))!;
    expect(s.rebuilds).toBeGreaterThanOrEqual(1);
    await expect.poll(() => frames(1500), { timeout: 60_000, intervals: [250] }).toBe(0);
    expect(await frames(2500), 'frames drawn in 2.5 s with the glyphs on').toBe(0);
    expect((await page.evaluate(() => (window as unknown as Handle).__firesim.view.windGlyphStats!()))!.active).toBe(true);
  });
});

test('wind glyphs: close in over the canopy the crowns do not hide the flow lines, and a ridge still hides what lies behind it', async ({ page }) => {
  test.setTimeout(600_000);
  await build(page);
  await setLayers(page, { vegetation: true, understorey: true, imagery: true, wind: 'off', flames: false, smoke: false, embers: false, insightMarkers: false, roads: false, fireTrails: false, placeNames: false, windGlyphs: true, windHeight: 'fire' });
  type Glyphs = { halo: { uniforms: { uDepthBias: { value: number } } }; colour: { uniforms: { uDepthBias: { value: number } } } };
  const bias = (b?: number): Promise<number> =>
    page.evaluate((to) => {
      const g = (window as unknown as { __firesim: { view: { glyphs: Glyphs } } }).__firesim.view.glyphs;
      const was = g.halo.uniforms.uDepthBias.value;
      if (to !== undefined) g.halo.uniforms.uDepthBias.value = g.colour.uniforms.uDepthBias.value = to;
      return was;
    }, b);
  /** Draw a frame and count the pixels of the halo's dark navy ink (8, 16, 36), a stroke's edge on every ground; the same scene is compared with itself. */
  const ink = (): Promise<number> =>
    page.evaluate(() => {
      const v = (window as unknown as Handle).__firesim.view;
      v.renderNow();
      const src = v.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(src, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]! - 8) <= 10 && Math.abs(d[i + 1]! - 16) <= 10 && Math.abs(d[i + 2]! - 36) <= 10) n++;
      return n;
    });
  const both = async (what: string): Promise<{ biased: number; plain: number }> => {
    await settle(page);
    const asked = await bias();
    const biased = await ink();
    await bias(0);
    const plain = await ink();
    await bias(asked);
    console.log(`${what}: halo ink ${biased} px with the depth bias (${asked} m), ${plain} px without`);
    return { biased, plain };
  };
  expect(await bias(), 'the layer asks for a depth bias').toBeGreaterThan(0);
  await test.step('close in at 55 degrees over the forest: the strokes show through the crowns in front of them', async () => {
    await lookAt(page, 700, 0, 0, 200, 55);
    await drawAndRead(page);
    const r = await both('700 m, 55 degrees');
    expect(r.plain, 'there are strokes to count').toBeGreaterThan(1500);
    expect(r.biased, 'the bias shows at least a third more of the strokes than the plain depth test').toBeGreaterThan(r.plain * 1.3);
  });
  await test.step('across a valley toward the escarpment: a ridge still hides what is behind it (no more than a crown bias of difference)', async () => {
    await lookAt(page, 2200, 800, -600, 90, 65);
    await drawAndRead(page);
    const r = await both('2200 m, 65 degrees, from the west');
    expect(r.plain).toBeGreaterThan(1000);
    // Switching the depth test off showed 35 % more ink here (every line behind the ridge); the bias adds only the lines under crowns.
    expect(r.biased, 'strokes behind a ridge stay hidden').toBeLessThan(r.plain * 1.25);
  });
});

test('wind glyphs: the 2-D stand-in map (?mock=1) has no glyph statistics', async ({ page }) => {
  await page.goto('/?mock=1&debug=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  const r = await page.evaluate(() => {
    const v = (window as unknown as { __firesim: { view: { windGlyphStats?: unknown; stats(): { windGlyphs?: unknown } } } }).__firesim.view;
    return { fn: typeof v.windGlyphStats, stats: v.stats().windGlyphs };
  });
  expect(r.fn).toBe('undefined');
  expect(r.stats).toBeUndefined();
});
