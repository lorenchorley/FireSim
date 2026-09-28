/**
 * End-to-end test of the REAL engine in the browser (no ?mock): the scenario builder with the bundled Katoomba demo
 * data (offline), the simulation in its Web Worker (SimClient → src/sim/worker.ts) and the Three.js view.
 * Build → mark a fire → play → the worker streams snapshots and insight cards → "Why here?" from the worker.
 */
import { expect, test, type Page } from '@playwright/test';

async function acceptNotice(page: Page): Promise<void> {
  await expect(page.getByTestId('notice')).toBeVisible();
  await page.getByTestId('accept-notice').click();
  await expect(page.getByTestId('notice')).toHaveCount(0);
}

test('real engine: Katoomba preset offline → build → fire → play → worker insight → why here', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'warning' && m.text().includes('[FireSim]')) warnings.push(m.text());
  });
  await page.goto('/');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });

  await page.getByTestId('tool-fire').click();
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();

  await page.getByTestId('speed').click();
  await page.locator('[data-speed="Infinity"]').click();
  await page.getByTestId('play').click();

  await page.getByTestId('tab-insights').click();
  const fireCard = page.locator('[data-testid=insight-card]:not(:has-text("Forecast"))').first();
  await expect(fireCard).toBeVisible({ timeout: 150_000 });
  await expect(page.getByTestId('clock')).not.toHaveText('--:--');

  const toastClose = page.getByTestId('toast').getByRole('button', { name: 'Dismiss' });
  if (await toastClose.isVisible()) await toastClose.click();
  const scene = await page.getByTestId('scene').boundingBox();
  expect(scene).not.toBeNull();
  await page.mouse.click(scene!.x + scene!.width * 0.5, scene!.y + scene!.height * 0.3);
  const why = page.getByTestId('why-panel');
  await expect(why).toBeVisible();
  await expect(why.locator('.narrative li').first()).toBeVisible({ timeout: 30_000 });

  // The real modules were used (no "using the mock" fallback) and nothing threw.
  expect(warnings.filter((w) => w.includes('mock'))).toEqual([]);
  expect(errors).toEqual([]);
});
