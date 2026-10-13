// Track width and clock labels at the narrow phone sizes: BASE=... node docs/plans/spikes/S1-timeline-signal/tools/narrow.mjs
// S1: does the track still carry its clock labels at the narrow phone sizes when T1's button is showing?
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [w, h] of [[390, 844], [360, 740], [360, 640], [320, 640]]) {
  const row = [];
  for (const variant of ['none', 't1']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(`${process.env.BASE ?? 'http://localhost:4301'}/?mock=1&theme=light${variant === 'none' ? '' : '&pace=t1&paceLevel=waiting'}`);
    await page.getByTestId('accept-notice').click();
    await page.getByTestId('site-katoomba').click();
    await page.getByTestId('build').click();
    await page.getByTestId('sim').waitFor({ timeout: 90000 });
    await page.getByTestId('dock').waitFor();
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => ({ area: Math.round(document.querySelector('.tl-area').getBoundingClientRect().width), labels: [...document.querySelectorAll('.tl-label')].map((e) => e.textContent), btn: !!document.querySelector('[data-testid=pace-btn]:not([hidden])') }));
    row.push(`${variant}: track ${m.area} px, labels ${m.labels.length} (${m.labels.join(' ')}), button ${m.btn}`);
    await ctx.close();
  }
  console.log(`${w}x${h}\n  ${row.join('\n  ')}`);
}
await browser.close();
