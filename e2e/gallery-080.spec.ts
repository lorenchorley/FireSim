/**
 * The pictures of release 0.8.0 (the desktop host) for README.md and docs/screenshots/ (51 and up; 0.7.0 used up to 50). The page is the real build (Katoomba
 * at 6 km, offline, the real scene) and the desktop host is the test seam's stand-in (`e2e/desktopStub.ts`): a host that answers, accepts the code
 * ABCD2345 and hands back a small fake controller that computes nothing, so there is no fire in the pictures and the clock stays at 0. What they show is the
 * page's own words and layout. The real host and its wire are exercised by `desktop/*.test.ts` and `src/sim/remote/*.test.ts`. A Pixel 7 profile at a device
 * scale of 2. Run alone with `-g "gallery 0.8.0"`; it writes only these three pictures, light.
 *
 *   51  Setup: the Engine row in the Run card, Desktop chosen, the box for the code the desktop shows (no code came with the address)
 *   52  the run with the label on the map, "Running on the desktop", and a fire marked
 *   53  the same run after the link was cut: the error chip says "The desktop connection closed." and offers "Continue on this device"
 */
import type { Page } from '@playwright/test';
import { installDesktopStub, failLink } from './desktopStub';
import { expect, test } from './fixtures';
import { acceptNotice, animationsDone, pickTool } from './helpers';

test.use({ deviceScaleFactor: 2, actionTimeout: 45_000 });

const SHOTS = 'docs/screenshots';
const CODE = 'ABCD2345';

async function shot(page: Page, name: string): Promise<void> {
  await animationsDone(page);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, scale: 'css' });
}

/** A fire at the crosshair over the escarpment, so the picture of the run has a mark on it (the stand-in controller computes nothing). */
async function markFire(page: Page): Promise<void> {
  await pickTool(page, 'fire');
  await expect(page.getByTestId('fire-panel')).toBeVisible();
  await page.evaluate(() => (window as unknown as { __firesim: { view: { flyTo(x: number, y: number, d: number): void } } }).__firesim.view.flyTo(-2170, 900, 2500));
  await page.waitForTimeout(1500);
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
}

test('gallery 0.8.0: the Engine row on Setup, the run on the desktop, and the closed link with Continue on this device', async ({ page }) => {
  test.setTimeout(300_000);
  await installDesktopStub(page, { name: 'Studio PC', cores: 8, code: CODE });
  await page.goto('/?debug=1&theme=light');
  await acceptNotice(page);
  await expect(page.getByTestId('engine-row')).toBeVisible();

  // The place and the weather, as the other gallery tests choose them (offline: the build takes seconds).
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();

  // 51: Desktop chosen, no code came with the address, so the box is there (empty, with its placeholder).
  await page.getByTestId('engine').locator('label.chip[data-value=desktop]').click();
  await expect(page.getByTestId('engine-code')).toBeVisible();
  await expect(page.getByTestId('engine-hint')).toContainText('Type the code the desktop shows');
  await page.getByTestId('engine-row').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('[data-testid=engine-row]')!.scrollIntoView({ block: 'center' }));
  await shot(page, '51-desktop-engine-setup');

  // The run on the desktop: type the code, build, mark a fire.
  await page.getByTestId('engine-code').fill(CODE);
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');
  await markFire(page);
  await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');
  await page.waitForTimeout(1500);
  await shot(page, '52-desktop-running-label');

  // The link is cut: the chip says so and offers the way out; nothing switches by itself.
  await failLink(page);
  await expect(page.getByTestId('error-chip')).toContainText('The desktop connection closed.');
  await expect(page.getByTestId('continue-here')).toHaveText('Continue on this device');
  await expect(page.getByTestId('engine-banner')).toHaveText('Running on the desktop');
  await shot(page, '53-desktop-closed-link');
});
