/**
 * Night lighting of the map (Layers, Map type, Night lighting: Realistic, Brighter, Daylight), in the real app (bundled Katoomba
 * demo, offline, the 3-D view), night through the `setStartTime` debug path:
 *  - the mean luminance of a ground region rises Realistic < Brighter < Daylight by a margin (spike S4, harness view: Katoomba
 *    10.0, 36.5, 54.9; Thredbo 17.0, 57.0, 83.6), measured on frames decoded with fast-png;
 *  - the sky does not change (pixel for pixel), and no sun disc appears when looking north-west and up from eye level;
 *  - by day all three looks are the same picture; a look change draws the same number of draw calls and triangles and makes
 *    no new GPU objects;
 *  - the choice is remembered for the next run, and "Reset layers" returns it to Realistic;
 *  - the row is not there on the 2-D map, which has no night.
 *
 * Frames are read from the canvas: the app's own render loop is stopped, the clock is frozen while a frame is drawn and the
 * view insets are set to none, so two frames of one state are the same picture whatever panel is open.
 */
import type { Page } from '@playwright/test';
import { decode } from 'fast-png';
import { expect, test } from './fixtures';
import { acceptNotice } from './helpers';

// The software-GL test browser draws a frame in about a second whatever the resolution; the smaller canvas keeps each one cheap
// and the frames comparable with the spike's (412 x 915 at device scale 1).
test.use({ deviceScaleFactor: 1 });

type Look = 'realistic' | 'brighter' | 'daylight';
type Region = [number, number, number, number]; // fractions of the frame: x0, y0, x1, y1

/** Where the mean luma of the ground and of the sky is read (spike S4's regions, drawn in its shot 04). */
const GROUND: Region = [0.04, 0.7, 0.96, 0.97];
const SKY: Region = [0.03, 0.015, 0.45, 0.1];
/**
 * Looking north-west and up 32 degrees from eye level on the highest ground of the area, with the trees, roads and names off: the
 * frame holds nothing but sky above the horizon, and the fixed map sun (north-west, 30 degrees up) would sit in this region
 * just above its lower edge (the vertical field of view is 50 degrees, so the region reaches down to about 26 degrees).
 */
const EYE_SKY: Region = [0.1, 0.05, 0.9, 0.62];

interface Frame {
  w: number;
  h: number;
  ch: number;
  data: ArrayLike<number>;
  calls: number;
  triangles: number;
  memory: string;
  png: Buffer;
}

interface ViewHandle {
  scenario: { startTime: number; weather: { timezone?: string }; terrain: { elevation: Float32Array; grid: { nx: number; ny: number; cellSize: number; x0: number; y0: number } } };
  view: {
    nightLook?: Look;
    cameraState(): { target: [number, number]; distance: number };
  };
}

async function buildKatoomba(page: Page): Promise<void> {
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
}

/** Open the app and build Katoomba; `again` is a second run in the same browser profile (the safety notice is already accepted). */
async function start(page: Page, again = false): Promise<void> {
  await page.goto('/?debug=1');
  if (!again) await acceptNotice(page);
  else if (await page.getByTestId('notice').isVisible()) await acceptNotice(page);
  await buildKatoomba(page);
}

/** Unix ms of `hour`:00 local time on the scenario's first day (the scenario's own time zone), for `setStartTime`. */
const localClock = (page: Page, hour: number): Promise<number> =>
  page.evaluate((hour) => {
    const sc = (window as unknown as { __firesim: ViewHandle }).__firesim.scenario;
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: sc.weather.timezone || 'Australia/Sydney' }).formatToParts(sc.startTime);
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return sc.startTime + ((hour - get('hour')) * 60 - get('minute')) * 60_000;
  }, hour);

interface Shot {
  /** The sun clock to draw (unix ms); omitted keeps the current one. */
  ms?: number;
  /** A look to set through the view; omitted keeps the one the panel set. */
  look?: Look;
  /**
   * 'std': the orbit camera above the middle of the area, 0.45 of the area's width out, from the south-south-west and low enough
   * to show a strip of sky. 'eye': eye level on the highest ground, looking north-west and up 32 degrees, with the trees, roads,
   * names and wind off (it leaves them off: take these shots last).
   */
  camera: 'std' | 'eye';
}

/**
 * One frame of the 3-D view as pixels. The app's loop is stopped (so nothing else draws between our frames), the clock is
 * frozen while the frame is drawn (flames, embers and trees move with it), the camera and the view insets are set here, and the
 * canvas is read in the same task as the draw.
 */
async function shoot(page: Page, shot: Shot): Promise<Frame> {
  const r = await page.evaluate((o) => {
    const fs = (window as unknown as { __firesim: ViewHandle }).__firesim;
    type V3 = { x: number; y: number; z: number; clone(): V3 };
    const v = fs.view as unknown as {
      renderer: { setAnimationLoop(f: null): void; domElement: HTMLCanvasElement; info: { render: { calls: number; triangles: number }; memory: { geometries: number; textures: number }; programs?: unknown[] } };
      rig: { setViewInsets(i: object, animate: boolean): void; groundPoint(x: number, y: number): V3; goTo(target: V3, position: V3, seconds: number): void };
      u: Record<string, { value: number }>;
      displayTime: number;
      setNightLook(look: string): void;
      setStartTime(ms: number): void;
      setViewMode(m: string): void;
      setLayers(p: Record<string, unknown>): void;
      lookAt(x: number, y: number, d: number, az: number, tilt: number): void;
      renderNow(): void;
    };
    v.renderer.setAnimationLoop(null);
    const realNow = performance.now;
    performance.now = () => 1e7;
    try {
      v.rig.setViewInsets({}, false);
      if (o.look) v.setNightLook(o.look);
      if (o.ms !== undefined) v.setStartTime(o.ms - v.displayTime * 1000);
      const g = fs.scenario.terrain.grid;
      const size = Math.max(g.nx, g.ny) * g.cellSize;
      if (o.camera === 'std') {
        v.setViewMode('orbit');
        v.lookAt(0, 0, 0.45 * size, 200, 72);
      } else {
        // Nothing but terrain below the horizon and sky above it: the highest ground, and nothing standing on it or floating over it.
        v.setLayers({ vegetation: false, understorey: false, roads: false, fireTrails: false, homes: false, zones: false, placeNames: false, wind: 'off', smoke: false, flames: false, embers: false, insightMarkers: false });
        const t = fs.scenario.terrain;
        let top = 0;
        for (let i = 1; i < t.elevation.length; i++) if (t.elevation[i]! > t.elevation[top]!) top = i;
        const ex = t.grid.x0 + (top % t.grid.nx) * t.grid.cellSize;
        const ey = t.grid.y0 + Math.floor(top / t.grid.nx) * t.grid.cellSize;
        v.setViewMode('orbit'); // the eye stands where the orbit view is centred
        v.lookAt(ex, ey, 200, 315, 80);
        v.setViewMode('ground');
        const eye = v.rig.groundPoint(ex, ey);
        eye.y += 1.7;
        const a = (315 * Math.PI) / 180;
        const p = (32 * Math.PI) / 180;
        const target = eye.clone(); // a THREE.Vector3: the camera's lookAt needs the real thing
        target.x += Math.sin(a) * Math.cos(p);
        target.y += Math.sin(p);
        target.z -= Math.cos(a) * Math.cos(p);
        v.rig.goTo(target, eye, 0);
      }
      v.u.uClock!.value = 3;
      for (let i = 0; i < 3; i++) v.renderNow(); // three, so the canopy and the labels are settled
      const info = v.renderer.info;
      return {
        url: v.renderer.domElement.toDataURL('image/png'),
        calls: info.render.calls,
        triangles: info.render.triangles,
        memory: `${info.programs?.length ?? 0} programs, ${info.memory.geometries} geometries, ${info.memory.textures} textures`,
      };
    } finally {
      performance.now = realNow;
    }
  }, shot);
  const png = decode(Buffer.from(r.url.split(',')[1]!, 'base64'));
  return { w: png.width, h: png.height, ch: png.channels, data: png.data, calls: r.calls, triangles: r.triangles, memory: r.memory, png: Buffer.from(r.url.split(',')[1]!, 'base64') };
}

const box = (f: Frame, r: Region): { x0: number; y0: number; x1: number; y1: number } => ({ x0: Math.floor(r[0] * f.w), y0: Math.floor(r[1] * f.h), x1: Math.floor(r[2] * f.w), y1: Math.floor(r[3] * f.h) });

/** Mean luma (0 to 255: 0.2126 R + 0.7152 G + 0.0722 B of the 8-bit values) of a region. */
function meanLuma(f: Frame, r: Region = [0, 0, 1, 1]): number {
  const { x0, y0, x1, y1 } = box(f, r);
  let sum = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * f.w + x) * f.ch;
      sum += 0.2126 * f.data[i]! + 0.7152 * f.data[i + 1]! + 0.0722 * f.data[i + 2]!;
    }
  return sum / ((x1 - x0) * (y1 - y0));
}

/** Pixels of a region in which any channel differs. */
function differing(a: Frame, b: Frame, r: Region = [0, 0, 1, 1]): number {
  expect([a.w, a.h]).toEqual([b.w, b.h]);
  const { x0, y0, x1, y1 } = box(a, r);
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * a.w + x) * a.ch;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) n++;
    }
  return n;
}

const nightLookRadios = (page: Page) => page.getByTestId('night-look');
const pickLook = async (page: Page, label: 'Realistic' | 'Brighter' | 'Daylight'): Promise<void> => {
  await nightLookRadios(page).getByRole('radio', { name: label }).check({ force: true }); // the radio itself is visually hidden behind its label
  await expect(nightLookRadios(page).getByRole('radio', { name: label })).toBeChecked();
};
const viewLook = (page: Page): Promise<Look | undefined> => page.evaluate(() => (window as unknown as { __firesim: ViewHandle }).__firesim.view.nightLook);

test('Night lighting: the ground rises Realistic < Brighter < Daylight at night, the sky does not change, by day nothing changes', async ({ page }) => {
  test.setTimeout(420_000);
  await start(page);
  const night = await localClock(page, 22);
  const day = await localClock(page, 13);

  // ── The row: Map type section, three choices, Realistic on, the hint ──
  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();
  const row = nightLookRadios(page);
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('radio')).toHaveCount(3);
  await expect(row.getByRole('radio', { name: 'Realistic' })).toBeChecked();
  await expect(panel).toContainText('Realistic follows the clock. Brighter and Daylight light the ground, trees and roads after dark so terrain detail stays readable.');
  await expect(panel.locator('section[aria-label="Map type"]').getByTestId('night-look')).toHaveCount(1);
  expect(await viewLook(page)).toBe('realistic');
  // The row is small: the plan gives the whole feature about 12 DOM nodes of the Layers panel's 86 spare.
  const rowNodes = await row.evaluate((el) => 1 + el.querySelectorAll('*').length + 1); // the control and the hint under it
  test.info().annotations.push({ type: 'night row DOM nodes', description: String(rowNodes) });
  expect(rowNodes).toBeLessThanOrEqual(32);

  // ── Night, standard view: the three looks, chosen in the panel ──
  await shoot(page, { ms: night, look: 'realistic', camera: 'std' }); // the first frame after the loop stops takes one step of the animated state
  const realistic = await shoot(page, { camera: 'std' });
  await pickLook(page, 'Brighter');
  expect(await viewLook(page)).toBe('brighter');
  const brighter = await shoot(page, { camera: 'std' });
  await pickLook(page, 'Daylight');
  expect(await viewLook(page)).toBe('daylight');
  const daylight = await shoot(page, { camera: 'std' });

  const g = [meanLuma(realistic, GROUND), meanLuma(brighter, GROUND), meanLuma(daylight, GROUND)];
  test.info().annotations.push({ type: 'night ground luma', description: g.map((x) => x.toFixed(1)).join(' / ') });
  console.log(`NIGHT-LOOK ground luma R/B/D ${g.map((x) => x.toFixed(1)).join(' / ')}, sky luma ${meanLuma(realistic, SKY).toFixed(1)}, draw calls ${realistic.calls}, triangles ${realistic.triangles}, ${realistic.memory}`);
  expect.soft(g[1]! - g[0]!, `Brighter - Realistic (ground ${g.map((x) => x.toFixed(1)).join(' / ')})`).toBeGreaterThanOrEqual(12);
  expect.soft(g[2]! - g[1]!, `Daylight - Brighter (ground ${g.map((x) => x.toFixed(1)).join(' / ')})`).toBeGreaterThanOrEqual(9);

  // The sky, the stars and the horizon are the clock's: not one pixel changes.
  expect.soft(differing(realistic, brighter, SKY), 'sky pixels that differ, Brighter').toBe(0);
  expect.soft(differing(realistic, daylight, SKY), 'sky pixels that differ, Daylight').toBe(0);
  expect.soft(Math.abs(meanLuma(daylight, SKY) - meanLuma(realistic, SKY))).toBeLessThan(0.5);
  expect.soft(differing(realistic, daylight), 'the ground does change').toBeGreaterThan(1000);

  // Nothing is drawn or made on the way: same draw calls, triangles and GPU objects in every look.
  for (const f of [brighter, daylight]) {
    expect.soft(f.calls).toBe(realistic.calls);
    expect.soft(f.triangles).toBe(realistic.triangles);
    expect.soft(f.memory).toBe(realistic.memory);
  }

  // ── By day all three looks are the same picture, pixel for pixel ──
  const dayR = await shoot(page, { ms: day, look: 'realistic', camera: 'std' });
  const dayB = await shoot(page, { look: 'brighter', camera: 'std' });
  const dayD = await shoot(page, { look: 'daylight', camera: 'std' });
  expect.soft(differing(dayR, dayB), 'by day Brighter differs from Realistic in this many pixels').toBe(0);
  expect.soft(differing(dayR, dayD), 'by day Daylight differs from Realistic in this many pixels').toBe(0);
  expect.soft(dayB.calls).toBe(dayR.calls);
  expect.soft(dayD.triangles).toBe(dayR.triangles);
  // ... and that day really is brighter than the Realistic night (the clock moved).
  expect.soft(meanLuma(dayR, GROUND)).toBeGreaterThan(g[0]! + 20);

  // Going back to Realistic at night draws the first picture again.
  await pickLook(page, 'Realistic');
  const again = await shoot(page, { ms: night, camera: 'std' });
  expect.soft(differing(realistic, again)).toBeLessThan(50);

  // ── Eye level, looking north-west and up: no sun disc in the night sky, whatever the look ──
  // (The map sun is a fixed north-west sun: if the sky shared it, a disc would sit about in the middle of this region and the sky's
  // own exposure would change. A sun disc lifts the mean luma of a region like this from about 21 to 90.)
  const eyeR = await shoot(page, { ms: night, look: 'realistic', camera: 'eye' });
  const eyeB = await shoot(page, { look: 'brighter', camera: 'eye' });
  const eyeD = await shoot(page, { look: 'daylight', camera: 'eye' });
  await test.info().attach('eye-level-realistic.png', { body: eyeR.png, contentType: 'image/png' });
  await test.info().attach('eye-level-daylight.png', { body: eyeD.png, contentType: 'image/png' });
  const sky = [meanLuma(eyeR, EYE_SKY), meanLuma(eyeB, EYE_SKY), meanLuma(eyeD, EYE_SKY)];
  console.log(`NIGHT-LOOK eye-level sky region luma R/B/D ${sky.map((x) => x.toFixed(2)).join(' / ')}`);
  expect.soft(Math.abs(sky[2]! - sky[0]!), 'mean luma of the sky toward the north-west, Daylight against Realistic').toBeLessThan(0.5);
  expect.soft(differing(eyeR, eyeB, EYE_SKY), 'eye-level sky pixels that differ, Brighter').toBe(0);
  expect.soft(differing(eyeR, eyeD, EYE_SKY), 'eye-level sky pixels that differ, Daylight').toBe(0);
});

test('Night lighting: the choice is remembered for the next run and Reset layers returns it to Realistic', async ({ page }) => {
  test.setTimeout(420_000);
  await start(page);
  await page.getByTestId('layers-fab').click();
  await expect(nightLookRadios(page).getByRole('radio', { name: 'Realistic' })).toBeChecked();
  await pickLook(page, 'Daylight');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('firesim.layers') ?? 'null'))).toMatchObject({ v: 1, nightLook: 'daylight' });

  // A new run (the preferences stay in this browser profile).
  await start(page, true);
  await expect.poll(() => viewLook(page)).toBe('daylight');
  await page.getByTestId('layers-fab').click();
  await expect(nightLookRadios(page).getByRole('radio', { name: 'Daylight' })).toBeChecked();
  const night = await localClock(page, 22);
  await shoot(page, { ms: night, camera: 'std' });
  const remembered = await shoot(page, { camera: 'std' });

  // Reset layers: Realistic again, in the panel, in the view, in the preferences and in the picture.
  await page.getByTestId('layers-reset').click();
  await expect(nightLookRadios(page).getByRole('radio', { name: 'Realistic' })).toBeChecked();
  expect(await viewLook(page)).toBe('realistic');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('firesim.layers'))).toBeNull();
  const reset = await shoot(page, { camera: 'std' });
  console.log(`NIGHT-LOOK after a reload and after Reset: ground luma ${meanLuma(remembered, GROUND).toFixed(1)} (remembered Daylight) / ${meanLuma(reset, GROUND).toFixed(1)} (Realistic)`);
  expect(meanLuma(remembered, GROUND) - meanLuma(reset, GROUND), 'the remembered Daylight is lighter than Realistic').toBeGreaterThanOrEqual(21);
  expect(differing(remembered, reset, SKY)).toBe(0);
});

test('Night lighting: the 2-D map has no night, so the row is not there', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?mock=1&debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('layers-fab').click();
  const panel = page.getByTestId('layers-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('maptype-terrain')).toBeVisible();
  await expect(panel.getByTestId('night-look')).toHaveCount(0);
  await expect(panel).not.toContainText('Night lighting');
});
