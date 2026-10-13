// Contrast of the amber ring and glyph against the strip in the four looks: BASE=... node docs/plans/spikes/S1-timeline-signal/tools/contrast.mjs
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const looks = { light: 'theme=light', dark: 'theme=dark', 'light-hc': 'theme=light&contrast=high', 'dark-hc': 'theme=dark&contrast=high' };
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const [name, q] of Object.entries(looks)) {
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  await page.goto(`${process.env.BASE ?? 'http://localhost:4301'}/?mock=1&${q}`);
  await page.getByTestId('accept-notice').click();
  await page.waitForTimeout(500);
  const v = await page.evaluate(() => {
    const probe = document.createElement('div'); document.body.append(probe);
    const get = (n) => { probe.style.color = `var(${n})`; return getComputedStyle(probe).color; };
    const out = { watch: get('--watch'), watchInk: get('--watch-ink'), surface: get('--surface'), outline: get('--outline'), text: get('--text'), primary: get('--primary') };
    probe.remove(); return out;
  });
  const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const S = rgb(v.surface);
  console.log(name.padEnd(9), `ring --watch ${v.watch} on surface ${v.surface}: ${ratio(rgb(v.watch), S).toFixed(2)}:1 | glyph --watch-ink ${v.watchInk}: ${ratio(rgb(v.watchInk), S).toFixed(2)}:1 | outline ${v.outline}: ${ratio(rgb(v.outline), S).toFixed(2)}:1 | text ${ratio(rgb(v.text), S).toFixed(2)}:1`);
}
await browser.close();
