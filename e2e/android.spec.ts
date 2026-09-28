/**
 * The app under an emulated Capacitor ANDROID runtime (see androidBridge.ts): Capacitor.isNativePlatform() is true,
 * so the native-only paths run — Preferences over the bridge, CapacitorHttp routing, native Geolocation.
 * Regression test for the build that hung on "Loading FireSim…" on phones.
 */
import { expect, test, type Page } from '@playwright/test';
import { emulateCapacitorAndroid } from './androidBridge';

async function nativeCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as unknown as { __nativeCalls: { plugin: string; method: string }[] }).__nativeCalls ?? []).map((c) => `${c.plugin}.${c.method}`));
}

test('boots past the splash on Android and keeps settings in native Preferences', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await emulateCapacitorAndroid(page);
  await page.goto('/');
  expect(await page.evaluate(() => (window as unknown as { Capacitor: { getPlatform(): string; isNativePlatform(): boolean } }).Capacitor.getPlatform())).toBe('android');
  await expect(page.getByTestId('notice')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('accept-notice').click();
  await expect(page.getByTestId('notice')).toHaveCount(0);
  const calls = await nativeCalls(page);
  expect(calls).toContain('Preferences.get');
  expect(calls).toContain('Preferences.set');
  expect(calls.filter((c) => c.endsWith('.then'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('Android: use my location → build Katoomba offline → fire → play → insight → why here', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await emulateCapacitorAndroid(page);
  await page.goto('/');
  await expect(page.getByTestId('notice')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('accept-notice').click();

  // "Use my location" goes through the native Geolocation plugin.
  const locate = page.getByTestId('use-location');
  if (await locate.count()) {
    await locate.click();
    await expect.poll(async () => (await nativeCalls(page)).includes('Geolocation.getCurrentPosition'), { timeout: 15_000 }).toBe(true);
  }

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
  await expect(page.locator('[data-testid=insight-card]:not(:has-text("Forecast"))').first()).toBeVisible({ timeout: 150_000 });

  const toastClose = page.getByTestId('toast').getByRole('button', { name: 'Dismiss' });
  if (await toastClose.isVisible()) await toastClose.click();
  const scene = await page.getByTestId('scene').boundingBox();
  await page.mouse.click(scene!.x + scene!.width * 0.5, scene!.y + scene!.height * 0.3);
  await expect(page.getByTestId('why-panel').locator('.narrative li').first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
