/**
 * Map gestures with REAL touch (CDP Input.dispatchTouchEvent) in the cases that went wrong in review, in the real app (bundled
 * Katoomba demo, offline):
 *
 *   horizon        a finger that lands near the horizon at a flat viewing angle moves the view at a bounded speed (it used to throw
 *                  the camera across the domain in one frame)
 *   rugged ground  a drag at a flat angle over the cliffs is steady (the grab and the terrain-following height used to feed back
 *                  on each other and flip-flop), and the view settles gently after the finger lifts
 *   taps           a touch that stops a gliding map, and a drag that comes back to where it began, are not map taps
 *   domain edge    a finger that pushed on past the edge and turns back is followed at once
 *   glide          it does not carry on after the map was covered by a screen for a while
 *   view mode      a finger still down when the mode changes does not carry on rotating the new view
 *   resize         the phone is turned under a dragging finger: no jump
 *
 * The software-GL test browser draws a frame in 0.3 s or more, which is too slow to judge motion frame by frame, so these steps
 * skip the drawing (renderer.render does nothing but keep the camera matrices current): the frame loop, the camera rig and
 * the touch handling run at the display rate, as on a phone.
 */
import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, pickViewMode } from './helpers';

test.use({ deviceScaleFactor: 1 });

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
  setViewMode(m: 'orbit' | 'top' | 'ground'): void;
  setCovered(c: boolean): void;
  readonly gliding: boolean;
  readonly renderer: { render: (scene: unknown, camera: { updateMatrixWorld(): void }) => void };
  camera: { position: { x: number; y: number; z: number } };
  rig: { flight: unknown };
};
const V = (page: Page, fn: string, ...args: unknown[]): Promise<unknown> =>
  page.evaluate(([f, a]) => ((window as unknown as { __firesim: { view: Record<string, (...x: unknown[]) => unknown> } }).__firesim.view[f as string] as (...x: unknown[]) => unknown)(...(a as unknown[])), [fn, args] as [string, unknown[]]);
const cam = (page: Page): Promise<CamState> => V(page, 'cameraState') as Promise<CamState>;
/** Where the camera is over the ground (x, z in world metres): the picture. (The orbit target also slides onto the terrain for a moment after the camera has stopped.) */
const eyeOverGround = (page: Page): Promise<[number, number]> =>
  page.evaluate(() => {
    const p = (window as unknown as { __firesim: { view: View } }).__firesim.view.camera.position;
    return [p.x, p.z] as [number, number];
  });
const pick = (page: Page, x: number, y: number): Promise<[number, number] | null> => V(page, 'pickGround', x, y) as Promise<[number, number] | null>;
const screenOf = (page: Page, x: number, y: number): Promise<[number, number] | null> => V(page, 'projectToScreen', x, y) as Promise<[number, number] | null>;
const lookAt = (page: Page, x: number, y: number, d: number, az: number, tilt: number): Promise<unknown> => V(page, 'lookAt', x, y, d, az, tilt, false);
const gliding = (page: Page): Promise<boolean> => page.evaluate(() => (window as unknown as { __firesim: { view: View } }).__firesim.view.gliding);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const dist = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleDiff = (to: number, from: number): number => ((((to - from) % 360) + 540) % 360) - 180;
const frame = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
const whyPanels = (page: Page): Promise<number> => page.evaluate(() => document.querySelectorAll('[data-testid="why-panel"]').length);

/** Fingers through the DevTools protocol (one touchStart / touchMove / touchEnd with every active point, like a touch screen). */
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
  async move(to: Record<number, [number, number]>): Promise<void> {
    for (const [id, p] of Object.entries(to)) this.pts.set(Number(id), p);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.points() });
    await frame(this.page);
  }
  /** A straight drag in `steps` hops, a frame after each (~60 Hz). */
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

test('map gestures with real touch: flat angles, rugged ground, taps, the domain edge, glide, mode and resize', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  const hand = new Hand(page, await page.context().newCDPSession(page));

  // Skip the drawing (see the header) and record the camera at every frame.
  await page.evaluate(() => {
    const v = (window as unknown as { __firesim: { view: View } }).__firesim.view;
    v.renderer.render = (_scene, camera) => camera.updateMatrixWorld();
    const w = window as unknown as { __rec: { on: boolean; frames: { x: number; y: number; z: number; tx: number; tz: number }[] } };
    w.__rec = { on: false, frames: [] };
    const tick = (): void => {
      if (w.__rec.on) {
        const p = v.camera.position;
        const s = v.cameraState();
        w.__rec.frames.push({ x: p.x, y: p.y, z: p.z, tx: s.target[0], tz: s.target[1] });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const rec = async (on: boolean): Promise<{ x: number; y: number; z: number; tx: number; tz: number }[]> =>
    page.evaluate((on) => {
      const w = window as unknown as { __rec: { on: boolean; frames: { x: number; y: number; z: number; tx: number; tz: number }[] } };
      if (on) w.__rec.frames = [];
      w.__rec.on = on;
      return w.__rec.frames;
    }, on);
  const canvasAt = (x: number, y: number): Promise<boolean> => page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.tagName === 'CANVAS', [x, y]);
  const reset = async (d = 2500, az = 200, tilt = 52): Promise<CamState> => {
    await page.keyboard.press('Escape');
    await lookAt(page, 0, 0, d, az, tilt);
    await sleep(500);
    return cam(page);
  };

  await test.step('flat angle: a finger that lands under the horizon moves the view at a bounded speed (no throw across the domain)', async () => {
    const s0 = await reset(2500, 200, 84);
    // The first row (from the top) where the ground starts: just under the horizon.
    let horizon = 0;
    for (let y = 130; y < 700 && !horizon; y += 5) if (await pick(page, 206, y)) horizon = y;
    expect(horizon).toBeGreaterThan(130);
    for (const y0 of [horizon + 10, horizon + 40, horizon - 25 /* in the sky */]) {
      await reset(2500, 200, 84);
      expect(await canvasAt(206, y0), `canvas at ${y0}`).toBe(true);
      await hand.down(1, 206, y0);
      let prev = (await cam(page)).target;
      let worst = 0;
      for (let i = 1; i <= 25; i++) {
        await hand.move({ 1: [206, y0 + 4 * i] });
        const t = (await cam(page)).target;
        worst = Math.max(worst, dist(t, prev));
        prev = t;
      }
      await hand.up(1);
      expect(worst, `largest step of the view for one 4 px move (finger at ${y0}, horizon at ${horizon})`).toBeLessThan(0.2 * s0.distance);
      const sane = await cam(page);
      expect(Number.isFinite(sane.distance) && sane.distance > 0).toBe(true);
      await sleep(900);
    }
  });

  await test.step('rugged ground at 70°: the drag is steady, the ground stays under the finger, the view settles gently after the lift', async () => {
    await reset(2000, 200, 70);
    const x0 = 206;
    const y0 = 330;
    expect(await canvasAt(x0, y0)).toBe(true);
    const grabbed = await pick(page, x0, y0);
    expect(grabbed).not.toBeNull();
    await rec(true);
    await hand.down(1, x0, y0);
    await hand.drag({ 1: [x0, y0 + 90] }, 30);
    await sleep(200);
    const during = await rec(false);
    const under = await screenOf(page, grabbed![0], grabbed![1]);
    expect(under).not.toBeNull();
    expect(dist(under!, [x0, y0 + 90]), 'the grabbed ground is under the finger (px)').toBeLessThan(3);
    // Path length of the camera over the drag against its net displacement: a flip-flop makes the path many times longer.
    const moving = during.filter((f, i) => i > 0 && (f.x !== during[i - 1]!.x || f.z !== during[i - 1]!.z));
    let path = 0;
    for (let i = 1; i < moving.length; i++) path += Math.hypot(moving[i]!.x - moving[i - 1]!.x, moving[i]!.z - moving[i - 1]!.z);
    const net = Math.hypot(moving.at(-1)!.x - moving[0]!.x, moving.at(-1)!.z - moving[0]!.z);
    expect(net).toBeGreaterThan(300);
    expect(path / net, 'camera path / net displacement').toBeLessThan(1.25);
    // The lift: the picture stays (the camera does not move for the terrain; the target slides along the line of sight onto the ground).
    const px: [number, number][] = [];
    await hand.up(1);
    for (let i = 0; i < 40; i++) {
      await frame(page);
      const p = await screenOf(page, grabbed![0], grabbed![1]);
      if (p) px.push(p);
    }
    expect(px.length).toBeGreaterThan(20);
    let lurch = 0;
    for (let i = 1; i < px.length; i++) lurch = Math.max(lurch, dist(px[i]!, px[i - 1]!));
    expect(lurch, 'largest on-screen step of the grabbed ground after the lift (px)').toBeLessThan(1);
  });

  await test.step('taps: a touch that stops a glide is not a tap, a drag that comes back is not a tap, a clean tap still is', async () => {
    await reset();
    await expect(page.getByTestId('why-panel')).toHaveCount(0);
    // A flick (300 px in ~150 ms), then a finger down while it glides.
    await hand.down(1, 250, 620);
    await hand.drag({ 1: [250, 320] }, 9);
    await hand.up(1);
    await sleep(120);
    expect(await gliding(page), 'the flick is gliding').toBe(true);
    const midGlide = await cam(page);
    await hand.down(1, 250, 300);
    await sleep(50);
    await hand.up(1);
    await sleep(500);
    expect(await whyPanels(page), 'the touch that stopped the glide was not a tap').toBe(0);
    expect(await gliding(page)).toBe(false);
    const stopped = await cam(page);
    const stoppedAt = await eyeOverGround(page);
    await sleep(400);
    expect(dist(await eyeOverGround(page), stoppedAt), 'the view stays where the touch stopped it').toBeLessThan(0.5);
    expect(dist(stopped.target, midGlide.target)).toBeGreaterThan(0);
    // A drag out and back to within a few px of where it began.
    await hand.down(1, 250, 450);
    await hand.drag({ 1: [250, 250] }, 8);
    await hand.drag({ 1: [252, 452] }, 8);
    await hand.up(1);
    await sleep(500);
    expect(await whyPanels(page), 'a round trip is a drag, not a tap').toBe(0);
    await sleep(1500);
    // A clean tap, once everything is still.
    await hand.down(1, 250, 450);
    await sleep(60);
    await hand.up(1);
    await expect(page.getByTestId('why-panel')).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('why-panel')).toHaveCount(0);
  });

  await test.step('domain edge: a finger that pushed on past the edge and turns back is followed at once', async () => {
    await reset();
    for (let k = 0; k < 8; k++) {
      await hand.down(1, 250, 180);
      await hand.drag({ 1: [250, 650] }, 8);
      await hand.up(1);
      await sleep(250);
    }
    await sleep(1200);
    const edge = await cam(page);
    expect(Math.max(Math.abs(edge.target[0]), Math.abs(edge.target[1])), 'at the edge of the domain').toBeGreaterThan(2900);
    await hand.down(1, 250, 180);
    await hand.drag({ 1: [250, 650] }, 16); // 470 px of pushing against the edge
    expect(dist((await cam(page)).target, edge.target)).toBeLessThan(2);
    await hand.drag({ 1: [250, 610] }, 4); // back by 40 px
    await frame(page);
    await frame(page);
    const mpp = (2 * edge.distance * Math.tan((25 * Math.PI) / 180)) / 891;
    expect(dist((await cam(page)).target, edge.target), 'the view followed the finger that turned back').toBeGreaterThan(20 * mpp);
    await hand.up(1);
    await sleep(1500);
  });

  await test.step('glide: it does not carry on after a screen covered the map', async () => {
    await reset();
    await hand.down(1, 250, 620);
    await hand.drag({ 1: [250, 320] }, 9);
    await hand.up(1);
    await sleep(100);
    await V(page, 'setCovered', true);
    await sleep(900);
    const covered = await eyeOverGround(page);
    await V(page, 'setCovered', false);
    await sleep(2200);
    expect(dist(await eyeOverGround(page), covered), 'the glide did not start again').toBeLessThan(1);
    expect(await gliding(page)).toBe(false);
  });

  await test.step('view mode: a finger still down at eye level when the mode changes does not rotate the new view', async () => {
    await reset();
    await V(page, 'setViewMode', 'ground');
    await expect.poll(async () => page.evaluate(() => !(window as unknown as { __firesim: { view: View } }).__firesim.view.rig.flight), { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await cam(page)).mode).toBe('ground');
    await hand.down(1, 200, 300);
    await hand.drag({ 1: [260, 320] }, 6);
    await sleep(700); // the damping of that turn runs out
    await V(page, 'setViewMode', 'orbit');
    await expect.poll(async () => page.evaluate(() => !(window as unknown as { __firesim: { view: View } }).__firesim.view.rig.flight), { timeout: 20_000 }).toBe(true);
    await sleep(300);
    const before = await cam(page);
    expect(before.mode).toBe('orbit');
    await hand.drag({ 1: [320, 420] }, 10);
    await sleep(500);
    const after = await cam(page);
    expect(Math.abs(angleDiff(after.azimuthDeg, before.azimuthDeg)), 'azimuth').toBeLessThan(0.5);
    expect(Math.abs(after.polarDeg - before.polarDeg), 'tilt').toBeLessThan(0.5);
    await hand.up(1);
    await sleep(300);
    // The next touch pans.
    const s = await cam(page);
    await hand.down(1, 250, 500);
    await hand.drag({ 1: [250, 350] }, 8);
    await hand.up(1);
    expect(dist((await cam(page)).target, s.target)).toBeGreaterThan(50);
    await pickViewMode(page, 'orbit');
  });

  await test.step('resize: the phone is turned under a dragging finger, the view does not jump', async () => {
    const s0 = await reset();
    await hand.down(1, 250, 450);
    await hand.drag({ 1: [230, 380] }, 6);
    await sleep(200);
    const before = await cam(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await sleep(500);
    const after = await cam(page);
    expect(dist(after.target, before.target), 'target moved by the turn (m)').toBeLessThan(0.08 * s0.distance);
    await hand.drag({ 1: [260, 300] }, 6);
    await hand.up(1);
    await page.setViewportSize({ width: 412, height: 915 });
    await sleep(500);
    const ok = await cam(page);
    expect(Number.isFinite(ok.distance)).toBe(true);
  });
});
