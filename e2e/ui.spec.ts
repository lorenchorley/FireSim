/**
 * End-to-end test of the field UI with the mock engine (?mock=1): safety notice → demo site → build → mark a fire →
 * play → insight card → "Why here?" → layers; plus settings/theme and the belt weather kit.
 */
import { expect, test, type Page } from '@playwright/test';

async function acceptNotice(page: Page): Promise<void> {
  await expect(page.getByTestId('notice')).toBeVisible();
  await page.getByTestId('accept-notice').click();
  await expect(page.getByTestId('notice')).toHaveCount(0);
}

test('notice → Katoomba → build → mark fire → play → insight → why here → layers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?mock=1');
  await expect(page.getByTestId('training-badge')).toBeVisible();
  await acceptNotice(page);

  // Setup: pick the Katoomba demo site and build.
  await page.getByTestId('site-katoomba').click();
  await expect(page.getByTestId('site-katoomba')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('build').click();
  await expect(page.getByTestId('building')).toBeVisible();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('training-badge')).toBeVisible();

  // Mark a fire with the crosshair (the gloved-hand path), confirm it.
  await page.getByTestId('tool-fire').click();
  await expect(page.getByTestId('fire-panel')).toBeVisible();
  await page.getByTestId('use-crosshair').click();
  // The confirm bar sits outside the panel's scroll area, so "Add fire" is on screen without scrolling.
  await expect(page.getByTestId('confirm-fire')).toBeInViewport();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();

  // Play as fast as possible.
  await page.getByTestId('speed').click();
  await page.locator('[data-speed="Infinity"]').click();
  await page.getByTestId('play').click();

  // An insight about the fire appears (in the Insights tab; Danger ones also pop a toast).
  await page.getByTestId('tab-insights').click();
  const fireCard = page.locator('[data-testid=insight-card]:not(:has-text("Forecast"))').first();
  await expect(fireCard).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('clock')).not.toHaveText('--:--');

  // Why here? — tap the map above the sheet.
  const toastClose = page.getByTestId('toast').getByRole('button', { name: 'Dismiss' });
  if (await toastClose.isVisible()) await toastClose.click();
  const scene = await page.getByTestId('scene').boundingBox();
  expect(scene).not.toBeNull();
  await page.mouse.click(scene!.x + scene!.width * 0.5, scene!.y + scene!.height * 0.3);
  const why = page.getByTestId('why-panel');
  await expect(why).toBeVisible();
  await expect(why.locator('.narrative li').first()).toBeVisible({ timeout: 10_000 });
  await expect(why.locator('.factor-row')).toHaveCount(7);
  await why.getByRole('button', { name: 'Close' }).click();

  // Layers: choose the arrival-time overlay and see its legend.
  await page.getByTestId('tool-layers').click();
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  await page.getByTestId('overlay-arrival').click();
  await expect(page.getByTestId('overlay-arrival')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('legend')).toContainText('Fire arrival time');

  expect(errors).toEqual([]);
});

test('settings switch to the night theme; belt kit computes RH live', async ({ page }) => {
  await page.goto('/?mock=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('theme').getByRole('radio', { name: 'Night' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('settings')).toHaveCount(0);

  await page.getByTestId('weather-source').getByRole('radio', { name: 'Belt kit' }).check();
  await page.getByTestId('belt-dry').fill('30');
  await page.getByTestId('belt-wet').fill('20');
  // 30 °C dry / 20 °C wet bulb at ~950 m → about 41 % (≈ 39 % at sea level).
  await expect(page.getByTestId('belt-rh')).toHaveText(/RH 4[01]%/);
  await page.getByTestId('belt-wet').fill('31');
  await expect(page.getByTestId('belt-rh')).toHaveText('RH –');
});
