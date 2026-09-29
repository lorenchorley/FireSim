#!/usr/bin/env node
/**
 * Layout budget of the simulation screen: with every menu and the dock collapsed, how much of the phone screen is free
 * map? Drives the app with the fast mock engine (?mock=1) in Chromium at the phone sizes below and prints, per size,
 *   band  = share of the viewport height not covered by a full-width bar (training badge, top bar, error chip, dock,
 *           timeline strip), and
 *   pixel = share of the viewport area not covered by ANY control (the bars plus the two round menu buttons and the
 *           legend), measured exactly with a pixel mask.
 * Budget (docs: layout brief L6): 390x844 >= 70 %, 360x740 >= 66 %, 360x640 >= 60 %, landscape 844x390 >= 55 %.
 * The exit code is 1 when a `band` value is below its budget.
 *
 *   npx vite --port 4183 --strictPort &      # or `vite preview`
 *   node scripts/layout-budget.mjs [--url http://localhost:4183] [--chromium /opt/pw-browsers/chromium]
 */
import { chromium } from '@playwright/test';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const url = arg('url', 'http://localhost:4183');
const executablePath = arg('chromium', process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium');

/** [width, height, minimum free share of the viewport height in %] */
const SIZES = [
  [390, 844, 70],
  [412, 915, 70],
  [360, 740, 66],
  [360, 640, 60],
  [844, 390, 55],
];

const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
for (const [width, height, need] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`${url}/?mock=1`);
  await page.getByTestId('accept-notice').click();
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await page.getByTestId('sim').waitFor({ timeout: 90_000 });
  await page.getByTestId('dock').waitFor();
  await page.waitForTimeout(1500); // dock / menu layout settles
  const r = await page.evaluate(() => {
    const shown = (sel) =>
      [...document.querySelectorAll(sel)].filter((e) => {
        const cs = getComputedStyle(e);
        const b = e.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && !e.hidden && b.width > 0 && b.height > 0;
      });
    const W = innerWidth;
    const H = innerHeight;
    const bars = [...shown('[data-testid=training-badge]'), ...shown('.sim-topbar'), ...shown('.error-chip'), ...shown('[data-testid=dock]'), ...shown('.scrubber')].map((e) => e.getBoundingClientRect());
    const floating = [...shown('.menu-fab'), ...shown('.map-legend')].map((e) => e.getBoundingClientRect());
    const rows = new Uint8Array(H);
    for (const r of bars) if (r.width >= W * 0.6) for (let y = Math.max(0, Math.floor(r.top)); y < Math.min(H, Math.ceil(r.bottom)); y++) rows[y] = 1;
    const mask = new Uint8Array(W * H);
    for (const r of [...bars, ...floating]) for (let y = Math.max(0, Math.floor(r.top)); y < Math.min(H, Math.ceil(r.bottom)); y++) for (let x = Math.max(0, Math.floor(r.left)); x < Math.min(W, Math.ceil(r.right)); x++) mask[y * W + x] = 1;
    let covered = 0;
    for (const v of mask) covered += v;
    return { band: 1 - rows.reduce((a, b) => a + b, 0) / H, pixel: 1 - covered / (W * H), badge: shown('[data-testid=training-badge]')[0]?.getBoundingClientRect().height ?? 0 };
  });
  const ok = r.band * 100 >= need;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}x${height}  band ${(r.band * 100).toFixed(1)} %  pixel ${(r.pixel * 100).toFixed(1)} %  (budget ${need} %)  badge ${r.badge}px`);
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
