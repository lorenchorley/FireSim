/**
 * A pen (stylus) drags the map like a finger, with real pen pointer events (CDP Input.dispatchMouseEvent, pointerType 'pen').
 *
 * The browser captures a finger's pointer by itself but not a pen's: a pen stroke that runs off the canvas (over the top bar, a
 * panel) would lose its pointermove and pointerup events, leaving the one-finger pan stuck on a pen that has gone up. The pan
 * therefore captures the pen while it is down, and the next stroke must work.
 */
import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice } from './helpers';

test.use({ deviceScaleFactor: 1 });

interface CamState {
  target: [number, number];
  distance: number;
  azimuthDeg: number;
  polarDeg: number;
}
type View = {
  cameraState(): CamState;
  projectToScreen(x: number, y: number): [number, number] | null;
  lookAt(x: number, y: number, distance: number, azimuthDeg: number, tiltDeg: number, animate?: boolean): void;
  setLayers(l: Record<string, unknown>): void;
  camera: { position: { y: number } };
};
const cameraState = (page: Page): Promise<CamState> => page.evaluate(() => (window as unknown as { __firesim: { view: View } }).__firesim.view.cameraState());

async function settle(page: Page): Promise<CamState> {
  await page.evaluate(() => {
    const rig = (window as unknown as { __firesim: { view: { rig: { update(now: number): boolean } } } }).__firesim.view.rig;
    const t0 = performance.now() + 4000;
    for (let i = 0; i < 100; i++) rig.update(t0 + i * 16);
  });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  return cameraState(page);
}

async function pen(cdp: CDPSession, type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    pointerType: 'pen',
    button: type === 'mouseMoved' ? 'none' : 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });
}

test('a pen drags the map like a finger, also when the stroke runs off the canvas, and the next stroke works', async ({ page }) => {
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
  await page.evaluate(() =>
    (window as unknown as { __firesim: { view: View } }).__firesim.view.setLayers({
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
  const cdp = await page.context().newCDPSession(page);

  await page.evaluate(() => (window as unknown as { __firesim: { view: View } }).__firesim.view.lookAt(0, 0, 3000, 200, 52, false));
  const s0 = await settle(page);
  const eyeY = (): Promise<number> => page.evaluate(() => (window as unknown as { __firesim: { view: View } }).__firesim.view.camera.position.y);
  const y0 = await eyeY();
  const c = (await page.evaluate(([x, y]) => (window as unknown as { __firesim: { view: View } }).__firesim.view.projectToScreen(x!, y!), s0.target))!;
  const A: [number, number] = [c[0], c[1] + 150];

  // The first point above the canvas where something else (the top bar, a panel) is under the pen.
  const off = await page.evaluate(
    ([x, y0]) => {
      for (let y = y0!; y >= 0; y -= 4) if (document.elementFromPoint(x!, y)?.tagName !== 'CANVAS') return y;
      return -1;
    },
    [A[0], A[1]],
  );
  expect(off, 'an element above the map in the pen\'s column').toBeGreaterThan(-1);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.tagName, A)).toBe('CANVAS');

  // Stroke 1: down on the map, up the screen, over the bar, released there.
  await pen(cdp, 'mouseMoved', ...A);
  await pen(cdp, 'mousePressed', ...A);
  const path = 10;
  for (let i = 1; i <= path; i++) {
    await pen(cdp, 'mouseMoved', A[0], A[1] + ((off - 6 - A[1]) * i) / path);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  }
  await pen(cdp, 'mouseReleased', A[0], off - 6);
  const s1 = await settle(page);
  const moved1 = Math.hypot(s1.target[0] - s0.target[0], s1.target[1] - s0.target[1]);
  expect(moved1, 'the pen moved the map (also over the bar)').toBeGreaterThan(200);
  expect(Math.abs(s1.polarDeg - s0.polarDeg), 'a pan does not tilt').toBeLessThan(0.2);
  // The camera does not rise or sink with the terrain (the orbit target slides along the line of sight onto the ground instead),
  // so the distance follows the relief a little: 6 % over this 400 m pan on Katoomba.
  expect(Math.abs((await eyeY()) - y0), 'the camera keeps its height (m)').toBeLessThan(0.5);
  expect(Math.abs(s1.distance / s0.distance - 1)).toBeLessThan(0.15);

  // Stroke 2, the same pen: it must pan again (a stuck first stroke would swallow it).
  await page.evaluate(() => (window as unknown as { __firesim: { view: View } }).__firesim.view.lookAt(0, 0, 3000, 200, 52, false));
  const s2 = await settle(page);
  await pen(cdp, 'mousePressed', ...A);
  for (let i = 1; i <= 8; i++) {
    await pen(cdp, 'mouseMoved', A[0] + 6 * i, A[1] - 12 * i);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  }
  await pen(cdp, 'mouseReleased', A[0] + 48, A[1] - 96);
  const s3 = await settle(page);
  expect(Math.hypot(s3.target[0] - s2.target[0], s3.target[1] - s2.target[1]), 'the second stroke pans too').toBeGreaterThan(150);
});
