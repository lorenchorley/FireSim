/**
 * Map gestures with REAL multi-touch, in the real app (bundled Katoomba demo, offline, the 3-D view).
 *
 * Fingers are driven through the DevTools protocol (Input.dispatchTouchEvent with every active point, like a touch screen
 * reports them), so the browser produces real pointer events (pointerType 'touch') for each finger, one after the other, the
 * way a phone does. The camera is read back with SceneViewApi.cameraState() and pickGround():
 *
 *   one finger        displaces the view like grabbing the map: the ground point under the finger stays under it, and the
 *                     azimuth, tilt and distance do not change
 *   two fingers       the drag of their midpoint turns (horizontal) and tilts (vertical) the view, the change of their
 *                     distance zooms ~1 : 1 - all at once, in any mix; target and the other quantities stay where they are
 *   lifting / adding  a finger continues / switches without a jump; a third finger is ignored
 *   taps              a quick tap still asks "Why here?", a pan drag does not
 *   eye level         one finger still looks around (the eye does not move)
 *   Draw mode         one finger still paints and the camera stays put
 *   mouse             left drag pans, right drag rotates (desktop development)
 *
 * The light glide after a flick is not measured here: the software-GL test browser draws a frame every ~0.3 s, so the finger's
 * release velocity is noise; src/render/cameraRig.gestures.test.ts drives the same rig with exact timing.
 */
import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, pickTool, pickViewMode } from './helpers';

// The software-GL test browser draws the 3-D view at about one frame per second whatever the resolution; the smaller
// canvas at least keeps each frame as cheap as it can be.
test.use({ deviceScaleFactor: 1 });

async function buildKatoomba(page: Page): Promise<void> {
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
}

/**
 * The gestures do not depend on the trees, roads or particles: switch them off so that the software-GL test browser draws a
 * frame in a third of a second instead of nearly two (the test waits for a frame after every finger movement).
 */
async function lightScene(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __firesim: { view: { setLayers(l: Record<string, unknown>): void } } }).__firesim.view.setLayers({
      vegetation: false,
      understorey: false,
      wind: 'off',
      flames: false,
      smoke: false,
      embers: false,
      roads: false,
      fireTrails: false,
      placeNames: false,
      imagery: false,
      insightMarkers: false,
      windSway: false,
    }),
  );
}

interface CamState {
  target: [number, number];
  distance: number;
  azimuthDeg: number;
  polarDeg: number;
  headingDeg: number;
  mode: 'orbit' | 'top' | 'ground';
}
type View = {
  cameraState(): CamState;
  pickGround(x: number, y: number): [number, number] | null;
  projectToScreen(x: number, y: number): [number, number] | null;
  lookAt(x: number, y: number, distance: number, azimuthDeg: number, tiltDeg: number, animate?: boolean): void;
  camera: { position: { x: number; y: number; z: number } };
  renderNow?(): void;
};
const cam = (page: Page): Promise<CamState> => page.evaluate(() => (window as unknown as { __firesim: { view: View } }).__firesim.view.cameraState());
const pick = (page: Page, x: number, y: number): Promise<[number, number] | null> =>
  page.evaluate(([px, py]) => (window as unknown as { __firesim: { view: View } }).__firesim.view.pickGround(px!, py!), [x, y]);
const screenOf = (page: Page, x: number, y: number): Promise<[number, number] | null> =>
  page.evaluate(([px, py]) => (window as unknown as { __firesim: { view: View } }).__firesim.view.projectToScreen(px!, py!), [x, y]);
const eyePosition = (page: Page): Promise<[number, number, number]> =>
  page.evaluate(() => {
    const p = (window as unknown as { __firesim: { view: View } }).__firesim.view.camera.position;
    return [p.x, p.y, p.z] as [number, number, number];
  });
const lookAt = (page: Page, x: number, y: number, d: number, az: number, tilt: number): Promise<void> =>
  page.evaluate(([a, b, c, e, f]) => (window as unknown as { __firesim: { view: View } }).__firesim.view.lookAt(a!, b!, c!, e!, f!, false), [x, y, d, az, tilt]);

const frame = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
const dist = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Signed difference of two compass angles in (−180, 180]. */
const angleDiff = (to: number, from: number): number => ((((to - from) % 360) + 540) % 360) - 180;

/**
 * Let the camera come to rest: finish a flight and run the rig's per-frame update (rotation damping, the target easing onto
 * the ground, the glide, the view insets) 100 times without drawing. The test browser draws about one frame per second, and
 * the damping needs ~40 updates, so waiting for real frames would take a minute. The finger-down state is not touched: a
 * finger that is still down keeps the grabbed ground under it, exactly as in the running frame loop.
 */
async function settle(page: Page): Promise<CamState> {
  await page.evaluate(() => {
    const rig = (window as unknown as { __firesim: { view: { rig: { update(now: number): boolean } } } }).__firesim.view.rig;
    const t0 = performance.now() + 4000; // beyond the end of any flight
    for (let i = 0; i < 100; i++) rig.update(t0 + i * 16);
  });
  await frame(page);
  return cam(page);
}

/**
 * Fingers on a touch screen, through CDP: a touchStart / touchMove carries all the active points (the protocol compares them with
 * the previous event, one pointer event per changed point), a touchEnd the point that is released.
 */
class Hand {
  private readonly pts = new Map<number, [number, number]>();
  constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}
  private points(): { x: number; y: number; id: number; radiusX: number; radiusY: number; force: number }[] {
    return [...this.pts].map(([id, [x, y]]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 }));
  }
  at(id: number): [number, number] {
    return this.pts.get(id)!;
  }
  async down(id: number, x: number, y: number): Promise<void> {
    this.pts.set(id, [x, y]);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.points() });
    await frame(this.page);
  }
  /** One touchMove carrying the new positions of the given fingers (the others stay). */
  async move(to: Record<number, [number, number]>): Promise<void> {
    for (const [id, p] of Object.entries(to)) this.pts.set(Number(id), p);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.points() });
    await frame(this.page);
  }
  /** Move the given fingers in a straight line to their targets in `steps` hops, a frame after each (a finger at ~60 Hz). */
  async drag(to: Record<number, [number, number]>, steps = 10): Promise<void> {
    const from = new Map(Object.keys(to).map((id) => [Number(id), this.at(Number(id))]));
    for (let s = 1; s <= steps; s++) {
      const hop: Record<number, [number, number]> = {};
      for (const [id, p] of Object.entries(to)) {
        const a = from.get(Number(id))!;
        hop[Number(id)] = [a[0] + ((p[0] - a[0]) * s) / steps, a[1] + ((p[1] - a[1]) * s) / steps];
      }
      await this.move(hop);
    }
  }
  /** Lift one finger: a touchEnd lists the points that are released (the others stay down). */
  async up(id: number): Promise<void> {
    const [x, y] = this.at(id);
    this.pts.delete(id);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x, y, id, radiusX: 4, radiusY: 4, force: 1 }] });
    await frame(this.page);
  }
  async upAll(): Promise<void> {
    for (const id of [...this.pts.keys()]) await this.up(id);
  }
}

async function newHand(page: Page): Promise<Hand> {
  return new Hand(page, await page.context().newCDPSession(page));
}

/** The element under a point must be the 3-D canvas (not a button or a panel), else a "map gesture" would not be one. */
async function expectCanvasAt(page: Page, x: number, y: number): Promise<void> {
  const tag = await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.tagName ?? '', [x, y]);
  expect(tag, `what is under (${x}, ${y})`).toBe('CANVAS');
}

/** Degrees one screen height of two-finger drag turns the view: 360° · rotateSpeed (2/3) → 240°, i.e. a full turn per 1.5 heights. */
const DEG_PER_HEIGHT = 240;

test('map gestures with real touch: one finger pans, two fingers turn / tilt / zoom together, switching fingers does not jump, taps still work', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await buildKatoomba(page);
  await lightScene(page);
  const hand = await newHand(page);
  const H = await page.evaluate(() => document.querySelector('canvas')!.clientHeight);
  expect(H).toBeGreaterThan(500);

  // A known camera: 3 km from the middle of the domain at the default 52° tilt.
  const reset = async (d = 3000, az = 200, tilt = 52): Promise<CamState> => {
    await lookAt(page, 0, 0, d, az, tilt);
    return settle(page);
  };
  let s0 = await reset();
  expect(s0.mode).toBe('orbit');
  expect(s0.polarDeg).toBeCloseTo(52, 0);
  expect(s0.azimuthDeg).toBeCloseTo(200, 0);
  const c0 = await screenOf(page, s0.target[0], s0.target[1]);
  expect(c0).not.toBeNull();
  const [cx, cy] = c0!;
  await expectCanvasAt(page, cx, cy);

  // ───────── one finger: displaces the view, the grabbed ground stays under the finger ─────────
  await test.step('one-finger drag pans: target moves, azimuth / tilt / distance do not, the ground under the finger stays under it', async () => {
    const A: [number, number] = [cx + 40, cy + 120];
    const B: [number, number] = [cx - 70, cy - 90];
    await expectCanvasAt(page, ...A);
    const grabbed = await pick(page, ...A);
    expect(grabbed).not.toBeNull();
    await hand.down(1, ...A);
    await hand.drag({ 1: B }, 8);
    await settle(page); // (the finger is still down: the closed loop keeps the ground under it)
    const during = await cam(page);
    const under = await pick(page, ...B);
    expect(under).not.toBeNull();
    // Metres a screen pixel stands for at the target: the ground under the finger is within ~1 px of where it was grabbed.
    const mpp = (2 * s0.distance * Math.tan((25 * Math.PI) / 180)) / H;
    expect(dist(under!, grabbed!), 'ground under the finger').toBeLessThan(2 * mpp);
    await hand.up(1);
    const after = await settle(page);
    expect(dist(after.target, s0.target), 'the view was displaced').toBeGreaterThan(80 * mpp);
    expect(Math.abs(angleDiff(after.azimuthDeg, s0.azimuthDeg))).toBeLessThan(0.1);
    expect(Math.abs(after.polarDeg - s0.polarDeg)).toBeLessThan(0.1);
    expect(Math.abs(after.distance / s0.distance - 1)).toBeLessThan(0.03);
    expect(during.mode).toBe('orbit');
    // The ground moved WITH the finger (grabbed ground is now at B), i.e. the target went the opposite way from the drag
    // (up-left on screen = the target moves down-right over the ground): the screen point of the grabbed ground is B. It is
    // exact while the finger is down (above); once it lifts, the target's height follows the terrain again over ~0.5 s (it is
    // held while a finger drags: see CameraRig.clamp), which moves the view by a few pixels on this terrain (a few dozen after
    // a drag over high relief): within a tenth of the screen height, never a different place.
    const now = await screenOf(page, grabbed![0], grabbed![1]);
    expect(now).not.toBeNull();
    expect(Math.hypot(now![0] - B[0], now![1] - B[1]), 'the grabbed ground ends where the finger left it').toBeLessThan(0.1 * H);
  });

  // ───────── two fingers: a pinch zooms 1 : 1 ─────────
  s0 = await reset();
  const c1 = (await screenOf(page, s0.target[0], s0.target[1]))!;
  await test.step('a pinch zooms about 1 : 1 (spacing × 2 → distance ÷ 2, and back), azimuth / tilt unchanged', async () => {
    await hand.down(1, c1[0] - 50, c1[1]);
    await hand.down(2, c1[0] + 50, c1[1]);
    await hand.drag({ 1: [c1[0] - 100, c1[1]], 2: [c1[0] + 100, c1[1]] }, 10);
    const out = await settle(page);
    expect(out.distance / s0.distance, 'spacing ×2').toBeGreaterThan(0.45);
    expect(out.distance / s0.distance, 'spacing ×2').toBeLessThan(0.56);
    expect(Math.abs(angleDiff(out.azimuthDeg, s0.azimuthDeg))).toBeLessThan(0.5);
    expect(Math.abs(out.polarDeg - s0.polarDeg)).toBeLessThan(0.5);
    await hand.drag({ 1: [c1[0] - 25, c1[1]], 2: [c1[0] + 25, c1[1]] }, 10); // spacing ÷ 4 from there
    const back = await settle(page);
    expect(back.distance / out.distance, 'spacing ÷ 4').toBeGreaterThan(3.5);
    expect(back.distance / out.distance, 'spacing ÷ 4').toBeLessThan(4.6);
    await hand.upAll();
    await settle(page);
  });

  // ───────── two fingers moving together: turn (horizontal) and tilt (vertical) ─────────
  s0 = await reset();
  const c2 = (await screenOf(page, s0.target[0], s0.target[1]))!;
  await test.step('a parallel horizontal drag turns the view, a vertical one tilts it; target and distance stay', async () => {
    const mpp = (2 * s0.distance * Math.tan((25 * Math.PI) / 180)) / H;
    await hand.down(1, c2[0] - 50, c2[1]);
    await hand.down(2, c2[0] + 50, c2[1]);
    await hand.drag({ 1: [c2[0] + 30, c2[1]], 2: [c2[0] + 130, c2[1]] }, 10); // 80 px to the right
    const turned = await settle(page);
    const expected = (80 / H) * DEG_PER_HEIGHT;
    expect(Math.abs(angleDiff(turned.azimuthDeg, s0.azimuthDeg)), 'azimuth change').toBeGreaterThan(expected * 0.95);
    expect(Math.abs(angleDiff(turned.azimuthDeg, s0.azimuthDeg)), 'azimuth change').toBeLessThan(expected * 1.05);
    expect(Math.abs(turned.polarDeg - s0.polarDeg), 'tilt unchanged').toBeLessThan(1);
    expect(Math.abs(turned.distance / s0.distance - 1), 'distance unchanged').toBeLessThan(0.03);
    expect(dist(turned.target, s0.target), 'target unchanged').toBeLessThan(25 * mpp);
    // Vertical: 60 px down tilts (down = more top-down in this view).
    const before = turned;
    await hand.drag({ 1: [c2[0] + 30, c2[1] + 60], 2: [c2[0] + 130, c2[1] + 60] }, 10);
    const tilted = await settle(page);
    const expectedTilt = (60 / H) * DEG_PER_HEIGHT;
    expect(Math.abs(tilted.polarDeg - before.polarDeg), 'tilt change').toBeGreaterThan(expectedTilt * 0.95);
    expect(Math.abs(tilted.polarDeg - before.polarDeg), 'tilt change').toBeLessThan(expectedTilt * 1.05);
    expect(Math.abs(angleDiff(tilted.azimuthDeg, before.azimuthDeg)), 'azimuth unchanged').toBeLessThan(1);
    expect(Math.abs(tilted.distance / before.distance - 1)).toBeLessThan(0.03);
    expect(dist(tilted.target, before.target)).toBeLessThan(25 * mpp);
    await hand.upAll();
    await settle(page);
  });

  // ───────── simultaneous: pinch AND drag in one gesture ─────────
  s0 = await reset();
  const c3 = (await screenOf(page, s0.target[0], s0.target[1]))!;
  await test.step('a gesture that pinches and drags at once zooms AND turns / tilts (no mode lock, no threshold)', async () => {
    await hand.down(1, c3[0] - 40, c3[1]);
    await hand.down(2, c3[0] + 40, c3[1]);
    // spacing 80 → 160 (zoom in ×2) while the midpoint moves 70 px right and 50 px down
    await hand.drag({ 1: [c3[0] - 80 + 70, c3[1] + 50], 2: [c3[0] + 80 + 70, c3[1] + 50] }, 12);
    const r = await settle(page);
    expect(r.distance / s0.distance, 'zoom').toBeLessThan(0.65);
    expect(Math.abs(angleDiff(r.azimuthDeg, s0.azimuthDeg)), 'turn').toBeGreaterThan(8);
    expect(Math.abs(r.polarDeg - s0.polarDeg), 'tilt').toBeGreaterThan(5);
    await hand.upAll();
    await settle(page);
  });

  // ───────── switching between one and two fingers ─────────
  s0 = await reset();
  const c4 = (await screenOf(page, s0.target[0], s0.target[1]))!;
  await test.step('lifting one finger of a two-finger gesture carries on as a pan from where the other finger is, without a jump', async () => {
    const mpp = (2 * s0.distance * Math.tan((25 * Math.PI) / 180)) / H;
    await hand.down(1, c4[0] - 60, c4[1]);
    await hand.down(2, c4[0] + 60, c4[1]);
    await hand.drag({ 1: [c4[0] - 60, c4[1] + 40], 2: [c4[0] + 60, c4[1] + 40] }, 8);
    const g = await settle(page);
    const rest = hand.at(2);
    const grabbed = await pick(page, ...rest);
    await hand.up(1);
    await frame(page);
    await frame(page);
    const lifted = await cam(page);
    expect(dist(lifted.target, g.target), 'no jump when a finger lifts').toBeLessThan(3 * mpp);
    expect(Math.abs(angleDiff(lifted.azimuthDeg, g.azimuthDeg))).toBeLessThan(0.5);
    expect(Math.abs(lifted.distance / g.distance - 1)).toBeLessThan(0.01);
    // The remaining finger pans: the grabbed ground follows it.
    const dest: [number, number] = [rest[0] - 80, rest[1] - 100];
    await hand.drag({ 2: dest }, 12);
    await settle(page);
    const moved = await cam(page);
    expect(dist(moved.target, lifted.target), 'it pans').toBeGreaterThan(60 * mpp);
    expect(Math.abs(angleDiff(moved.azimuthDeg, lifted.azimuthDeg))).toBeLessThan(0.5);
    expect(Math.abs(moved.polarDeg - lifted.polarDeg)).toBeLessThan(0.5);
    const under = await pick(page, ...dest);
    expect(dist(under!, grabbed!), 'the ground under the finger').toBeLessThan(2 * mpp);
    // Putting a second finger down during the pan switches to the two-finger gesture, without a jump.
    const before = await cam(page);
    await hand.down(1, dest[0] + 120, dest[1] + 10);
    await frame(page);
    await frame(page);
    const two = await cam(page);
    expect(dist(two.target, before.target), 'no jump when a second finger lands').toBeLessThan(3 * mpp);
    expect(Math.abs(angleDiff(two.azimuthDeg, before.azimuthDeg))).toBeLessThan(0.5);
    expect(Math.abs(two.distance / before.distance - 1)).toBeLessThan(0.01);
    await hand.upAll();
    await settle(page);
  });

  s0 = await reset();
  const c5 = (await screenOf(page, s0.target[0], s0.target[1]))!;
  await test.step('a third finger is ignored: the two-finger gesture carries on', async () => {
    await hand.down(1, c5[0] - 40, c5[1]);
    await hand.down(2, c5[0] + 40, c5[1]);
    await hand.drag({ 1: [c5[0] - 60, c5[1]], 2: [c5[0] + 60, c5[1]] }, 6); // spacing 80 → 120
    const a = await settle(page);
    await hand.down(3, c5[0] + 100, c5[1] + 200);
    await hand.drag({ 3: [c5[0] - 100, c5[1] - 100] }, 6);
    const withThird = await settle(page);
    expect(dist(withThird.target, a.target), 'the third finger moved nothing').toBeLessThan(2);
    expect(Math.abs(withThird.distance / a.distance - 1)).toBeLessThan(0.005);
    expect(Math.abs(angleDiff(withThird.azimuthDeg, a.azimuthDeg))).toBeLessThan(0.1);
    await hand.drag({ 1: [c5[0] - 90, c5[1]], 2: [c5[0] + 90, c5[1]] }, 6); // spacing 120 → 180: still zooming
    const zoomed = await settle(page);
    expect(zoomed.distance / a.distance, 'the pinch carries on with a third finger down').toBeGreaterThan(0.6);
    expect(zoomed.distance / a.distance, 'the pinch carries on with a third finger down').toBeLessThan(0.72);
    await hand.up(3);
    await hand.upAll();
    await settle(page);
  });

  // ───────── taps and drags ─────────
  s0 = await reset();
  const c6 = (await screenOf(page, s0.target[0], s0.target[1]))!;
  await test.step('a pan drag is never a tap; a quick tap still opens "Why here?"', async () => {
    await expect(page.getByTestId('why-panel')).toHaveCount(0);
    await hand.down(1, c6[0] - 40, c6[1] + 60);
    await hand.drag({ 1: [c6[0] + 30, c6[1] - 60] }, 8);
    await hand.up(1);
    await page.waitForTimeout(400);
    await expect(page.getByTestId('why-panel')).toHaveCount(0);
    await settle(page);
    const where = await screenOf(page, 0, 0);
    expect(where).not.toBeNull();
    await expectCanvasAt(page, where![0], where![1]);
    await page.touchscreen.tap(where![0], where![1]);
    await expect(page.getByTestId('why-panel')).toBeVisible({ timeout: 30_000 });
  });
});

test('map gestures with real touch: top view, eye level, Draw mode and the mouse', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await buildKatoomba(page);
  await lightScene(page);
  const hand = await newHand(page);
  const H = await page.evaluate(() => document.querySelector('canvas')!.clientHeight);

  await test.step('top view: one finger drags the plan like a map, two fingers turn and zoom (it cannot tilt)', async () => {
    await pickViewMode(page, 'top');
    await expect.poll(async () => (await cam(page)).mode).toBe('top');
    await settle(page); // the flight to the plan view ends
    await lookAt(page, 0, 0, 3000, 0, 0); // plan view, a known distance
    await settle(page);
    const s0 = await cam(page);
    expect(s0.polarDeg).toBeLessThan(0.2);
    const c = (await screenOf(page, s0.target[0], s0.target[1]))!;
    const mpp = (2 * s0.distance * Math.tan((25 * Math.PI) / 180)) / H;
    const A: [number, number] = [c[0] + 50, c[1] + 100];
    const B: [number, number] = [c[0] - 60, c[1] - 80];
    await expectCanvasAt(page, ...A);
    const grabbed = await pick(page, ...A);
    await hand.down(1, ...A);
    await hand.drag({ 1: B }, 12);
    await settle(page);
    expect(dist((await pick(page, ...B))!, grabbed!), 'ground under the finger').toBeLessThan(2 * mpp);
    await hand.up(1);
    const panned = await settle(page);
    expect(dist(panned.target, s0.target)).toBeGreaterThan(100 * mpp);
    expect(panned.polarDeg).toBeLessThan(0.2);
    expect(Math.abs(angleDiff(panned.azimuthDeg, s0.azimuthDeg))).toBeLessThan(0.2);
    expect(Math.abs(panned.distance / s0.distance - 1)).toBeLessThan(0.02);
    // Two fingers: a pinch ×2 and a horizontal drag at once → zoom and turn, no tilt.
    const c2 = (await screenOf(page, panned.target[0], panned.target[1]))!;
    await hand.down(1, c2[0] - 40, c2[1]);
    await hand.down(2, c2[0] + 40, c2[1]);
    await hand.drag({ 1: [c2[0] - 80 + 60, c2[1] + 40], 2: [c2[0] + 80 + 60, c2[1] + 40] }, 12);
    const r = await settle(page);
    expect(r.polarDeg).toBeLessThan(0.2);
    expect(r.distance / panned.distance).toBeLessThan(0.65);
    expect(Math.abs(angleDiff(r.azimuthDeg, panned.azimuthDeg))).toBeGreaterThan(5);
    await hand.upAll();
    await settle(page);
  });

  await test.step('eye level: one finger still looks around (the eye does not move, it cannot be displaced)', async () => {
    await pickViewMode(page, 'ground');
    await expect.poll(async () => (await cam(page)).mode).toBe('ground');
    await settle(page); // the flight to eye level ends
    const eye0 = await eyePosition(page);
    const h0 = (await cam(page)).headingDeg;
    const x = 206;
    const y = 420;
    await expectCanvasAt(page, x, y);
    await hand.down(1, x - 80, y);
    await hand.drag({ 1: [x + 80, y + 20] }, 10);
    await hand.up(1);
    const s1 = await settle(page);
    expect(Math.abs(angleDiff(s1.headingDeg, h0)), 'the view turned').toBeGreaterThan(5);
    const eye1 = await eyePosition(page);
    expect(Math.hypot(eye1[0] - eye0[0], eye1[1] - eye0[1], eye1[2] - eye0[2]), 'the eye stayed').toBeLessThan(0.5);
    // Two fingers look around too; a third is ignored.
    await hand.down(1, x - 60, y);
    await hand.down(2, x + 60, y);
    await hand.down(3, x, y + 200);
    await hand.drag({ 3: [x + 100, y + 250] }, 4);
    await hand.upAll();
    await settle(page);
    const eye2 = await eyePosition(page);
    expect(Math.hypot(eye2[0] - eye0[0], eye2[1] - eye0[1], eye2[2] - eye0[2])).toBeLessThan(0.5);
    await pickViewMode(page, 'orbit');
    await expect.poll(async () => (await cam(page)).mode).toBe('orbit');
    await settle(page); // the flight back ends
  });

  await test.step('Draw mode: one finger paints and the camera stays where it is', async () => {
    await lookAt(page, 0, 0, 3000, 200, 52);
    await settle(page);
    await pickTool(page, 'fuel');
    const panel = page.getByTestId('fuel-panel');
    await expect(panel).toBeVisible();
    await panel.locator('.segmented-option[data-value="paint"]').click();
    const layer = page.getByTestId('draw-layer');
    await expect(layer).toBeVisible();
    const before = await cam(page);
    const box = (await layer.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.3;
    await hand.down(1, x - 50, y);
    await hand.drag({ 1: [x + 60, y + 40] }, 10);
    await hand.up(1);
    await expect(page.getByTestId('apply-fuel')).toBeVisible(); // the stroke is a pending brush
    const after = await settle(page);
    expect(dist(after.target, before.target)).toBeLessThan(0.5);
    expect(Math.abs(angleDiff(after.azimuthDeg, before.azimuthDeg))).toBeLessThan(0.05);
    expect(Math.abs(after.polarDeg - before.polarDeg)).toBeLessThan(0.05);
    expect(Math.abs(after.distance / before.distance - 1)).toBeLessThan(0.001);
    // Back to Tap mode with the panel still open (it covers the lower part of the map: the view insets): the map pans again,
    // and the ground under the finger stays under it with the optical centre moved up.
    await panel.locator('.segmented-option[data-value="tap"]').click();
    await expect(layer).toBeHidden();
    const mid = await settle(page); // the insets have settled
    const c = (await screenOf(page, mid.target[0], mid.target[1]))!;
    const A: [number, number] = [c[0] + 30, c[1] + 60];
    const B: [number, number] = [c[0] - 50, c[1] - 60];
    await expectCanvasAt(page, ...A);
    await expectCanvasAt(page, ...B);
    const grabbed = await pick(page, ...A);
    await hand.down(1, ...A);
    await hand.drag({ 1: B }, 8);
    await settle(page);
    const mpp = (2 * mid.distance * Math.tan((25 * Math.PI) / 180)) / H;
    expect(dist((await pick(page, ...B))!, grabbed!), 'ground under the finger with a panel open').toBeLessThan(2 * mpp);
    await hand.up(1);
    const panned = await settle(page);
    expect(dist(panned.target, mid.target), 'the map pans again after Draw mode').toBeGreaterThan(50);
    await page.keyboard.press('Escape');
  });

  await test.step('mouse: left drag pans, right drag rotates, the wheel zooms', async () => {
    await lookAt(page, 0, 0, 3000, 200, 52);
    const s0 = await settle(page);
    const c = (await screenOf(page, s0.target[0], s0.target[1]))!;
    await expectCanvasAt(page, c[0], c[1]);
    await page.mouse.move(c[0], c[1] + 80);
    await page.mouse.down();
    await page.mouse.move(c[0] - 40, c[1] - 40, { steps: 8 });
    await page.mouse.up();
    const p = await settle(page);
    expect(dist(p.target, s0.target), 'left drag pans').toBeGreaterThan(50);
    expect(Math.abs(angleDiff(p.azimuthDeg, s0.azimuthDeg))).toBeLessThan(0.1);
    expect(Math.abs(p.polarDeg - s0.polarDeg)).toBeLessThan(0.1);
    await page.mouse.move(c[0], c[1]);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(c[0] + 60, c[1] + 40, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    const r = await settle(page);
    expect(Math.abs(angleDiff(r.azimuthDeg, p.azimuthDeg)), 'right drag turns').toBeGreaterThan(5);
    expect(Math.abs(r.polarDeg - p.polarDeg), 'right drag tilts').toBeGreaterThan(3);
    await page.mouse.move(c[0], c[1]);
    await page.mouse.wheel(0, -300);
    const z = await settle(page);
    expect(z.distance, 'the wheel zooms in').toBeLessThan(r.distance * 0.95);
  });
});
