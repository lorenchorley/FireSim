#!/usr/bin/env node
/**
 * Layout budget of the simulation screen: with every menu and the dock collapsed, how much of the phone screen is free
 * map? Drives the app with the fast mock engine (?mock=1) in Chromium at the phone sizes below and prints, per size,
 *   band  = share of the viewport height not covered by a full-width bar (training strip, the top bar's pill and its row of
 *           read-out chips, error strip, dock / bottom navigation, timeline strip), and
 *   pixel = share of the viewport area not covered by ANY control (the bars, each read-out chip, the round map buttons,
 *           the Tools button, the legend, the attribution line and the demo label), measured exactly with a pixel mask.
 * The floating top bar lets the map show around its pill and between its chips, so the pill and the chips are measured
 * rather than the full-width box that holds them.
 * Budget (docs: layout brief L6, raised with the Maps-style chrome of the screens phase): 390x844 >= 72 %, 412x915 >= 74 %,
 * 360x740 >= 68 %, 360x640 >= 63 %, landscape 844x390 >= 72 %.
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
  [390, 844, 72],
  [412, 915, 74],
  [360, 740, 68],
  [360, 640, 63],
  [844, 390, 72],
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
    const rect = (els) => els.map((e) => e.getBoundingClientRect());
    const edges = rect([...shown('[data-testid=training-badge]'), ...shown('.error-chip'), ...shown('[data-testid=dock]'), ...shown('.scrubber')]);
    const pill = rect(shown('.sim-topbar .tb-pill'));
    // Bands: the full-width bars, the pill and the row of chips; covered pixels: the same but each chip on its own, plus
    // everything that floats over the map (the demo engine's label is not part of the app and is not counted).
    const bars = [...edges, ...pill, ...rect(shown('.sim-topbar .tb-wx'))];
    const floating = rect([...shown('.sim-topbar .tb-wx > *'), ...shown('.menu-fab'), ...shown('.map-fabs .fab'), ...shown('.map-legend'), ...shown('.map-credit')]);
    const rows = new Uint8Array(H);
    for (const r of bars) if (r.width >= W * 0.6) for (let y = Math.max(0, Math.floor(r.top)); y < Math.min(H, Math.ceil(r.bottom)); y++) rows[y] = 1;
    const mask = new Uint8Array(W * H);
    for (const r of [...edges, ...pill, ...floating]) for (let y = Math.max(0, Math.floor(r.top)); y < Math.min(H, Math.ceil(r.bottom)); y++) for (let x = Math.max(0, Math.floor(r.left)); x < Math.min(W, Math.ceil(r.right)); x++) mask[y * W + x] = 1;
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
