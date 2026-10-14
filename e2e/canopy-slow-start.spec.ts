/**
 * The first canopy after a slow engine start, in the real app (bundled Katoomba demo, offline, the real 3-D view).
 *
 * The 3-D view is built before its screen is in the page: the app waits for the engine's first answer in between, and on a busy
 * phone that takes seconds. The view used to draw frames at 1 px tall during that wait, and the canopy plan (which trees are drawn
 * at which level of detail, and which are under a pixel) made then was never made again, so the map came up without a forest until
 * the camera moved. The engine's init message is held back here to make the start slow on purpose.
 */
import { expect, test } from './fixtures';
import { acceptNotice } from './helpers';

const ENGINE_DELAY_MS = 3000;

test('the first canopy is there after a slow engine start, without moving the camera or switching it off and on', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript((delay) => {
    const Original = window.Worker;
    (window as unknown as { Worker: unknown }).Worker = class extends Original {
      override postMessage(message: unknown, ...rest: unknown[]): void {
        if ((message as { type?: string } | null)?.type === 'init') setTimeout(() => super.postMessage(message, ...(rest as [])), delay);
        else super.postMessage(message, ...(rest as []));
      }
    };
  }, ENGINE_DELAY_MS);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });

  // No renderNow() and no camera move: the canopy has to be there on its own, and not only after some slow frames (the software
  // renderer of this test browser can take seconds per frame at the real screen size, so a repair that needs frames shows late).
  type Handle = { __firesim: { view: { diagnostics(): Record<string, number | string> } } };
  const trees = (): Promise<number> => page.evaluate(() => Number((window as unknown as Handle).__firesim.view.diagnostics()['vegetation']));
  await expect.poll(trees, { message: 'the canopy is placed and planned for the real screen size', timeout: 5000 }).toBeGreaterThan(0);
});
