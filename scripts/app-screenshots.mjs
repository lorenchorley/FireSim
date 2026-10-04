// Screenshots of the app's screens on the design tokens for docs/screenshots/design/ (app-*.png), on the mock engine, and (when
// the server is the dev server, which serves it) of the style guide (styleguide-*.png).
// Usage (dev server running): node scripts/app-screenshots.mjs [base URL, default http://localhost:5173] [out dir]
// 390 x 844, device scale 1, light / dark / high contrast. The sim views use ?mock=1 (2-D map, mock engine).
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'docs/screenshots/design';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const modes = { light: 'theme=light', dark: 'theme=dark', 'high-contrast': 'theme=light&contrast=high' };

async function open(q) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
  await page.goto(`${base}/?mock=1&${q}`);
  await page.getByTestId('notice').waitFor();
  return page;
}
const shot = async (page, name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png` });
};

// The Building screen with the real builder (bundled Katoomba, offline), data sets arriving: the later files are held back
// for a moment so the picture shows a build half way.
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
  await page.route(/\/demo\/katoomba\/(fire-history|context|vegetation)/, async (r) => {
    await new Promise((ok) => setTimeout(ok, 4000));
    await r.continue();
  });
  await page.goto(`${base}/?theme=light`);
  await page.getByTestId('accept-notice').click();
  await page.getByTestId('site-katoomba').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await page.locator('[data-dataset=canopy-height]').waitFor({ timeout: 30_000 });
  await shot(page, 'app-building-data-light');
  await page.context().close();
}

for (const [mode, q] of Object.entries(modes)) {
  const page = await open(q);
  if (mode !== 'high-contrast') await shot(page, `app-notice-${mode}`);
  await page.getByTestId('accept-notice').click();
  await page.getByTestId('notice').waitFor({ state: 'detached' });
  await page.locator('.site-thumb canvas, .site-thumb img').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  await shot(page, `app-setup-${mode}`);
  if (mode === 'light') {
    await page.evaluate(() => document.getElementById('setup-data')?.scrollIntoView({ block: 'start' }));
    await page.getByTestId('plan-terrain').waitFor();
    await shot(page, 'app-setup-data-light');
    await page.evaluate(() => document.querySelector('.setup-main')?.scrollTo(0, 0));
  }
  await page.getByTestId('open-settings').click();
  await shot(page, `app-settings-${mode}`);
  await page.getByTestId('close-settings').click();
  await page.getByTestId('build').click();
  if (mode === 'light') {
    await page.getByTestId('building').waitFor();
    await shot(page, 'app-building-light');
  }
  await page.getByTestId('sim').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.getByTestId('tools-menu').click();
  await shot(page, `app-sim-menus-${mode}`);
  await page.keyboard.press('Escape');
  if (mode !== 'high-contrast') {
    await page.getByTestId('tab-insights').click();
    await shot(page, `app-sim-insights-${mode}`);
  }
  await page.context().close();
}
// The style guide: the whole page at phone width, and the mock map screen at 2x.
const hasGuide = await fetch(`${base}/src/ui/styleguide.html`).then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('html')).catch(() => false);
if (hasGuide) {
  for (const [mode, q] of Object.entries(modes)) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${base}/src/ui/styleguide.html?${q}`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/styleguide-${mode}.png`, fullPage: true });
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport: { width: 700, height: 1200 }, deviceScaleFactor: 2 });
    const page2 = await ctx2.newPage();
    await page2.goto(`${base}/src/ui/styleguide.html?${q}`);
    await page2.waitForTimeout(900);
    await page2.getByTestId('sg-phone').screenshot({ path: `${out}/styleguide-${mode}-map-screen.png` });
    await ctx2.close();
  }
} else console.log('(the style guide is served by the dev server only: its pictures were not retaken)');
await browser.close();
console.log(`written to ${out}`);
