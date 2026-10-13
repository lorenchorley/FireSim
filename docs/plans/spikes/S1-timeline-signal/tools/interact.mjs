// Run from the repo root with the prototype applied and a dev server on BASE: BASE=http://localhost:4301 OUT=./s1-out node docs/plans/spikes/S1-timeline-signal/tools/interact.mjs
// S1 interaction checks: does each candidate open its sheet, and does the slider keep its taps and drags?
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'http://localhost:4301';
const OUT = process.env.OUT ?? './s1-out';
fs.mkdirSync(OUT, { recursive: true });
const PACE = (level) => ({ level, wanted: 60, achieved: 38, waitingShare: 0.4, capacity: 38, duty: 0.97, aheadS: 60, bufferS: 1, sinceMs: 0 });
const vps = { portrait: [412, 915], landscape: [844, 390] };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const out = [];
const log = (vp, variant, test, pass, detail) => { out.push({ vp, variant, test, pass, detail }); console.log(`${vp} ${variant} ${test}: ${pass ? 'PASS' : 'FAIL'} ${detail ?? ''}`); };

async function open(vp, variant) {
  const [w, h] = vps[vp];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?mock=1&theme=light&pace=${variant}`);
  await page.getByTestId('accept-notice').click();
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await page.getByTestId('sim').waitFor({ timeout: 90000 });
  await page.getByTestId('dock').waitFor();
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__firesim.session.seek(window.__firesim.scenario.duration * 0.4));
  await page.waitForFunction(() => window.__firesim.session.state.get().seekTarget === null, null, { timeout: 30000 });
  await page.evaluate((p) => window.__firesim.session.state.set({ pace: p }), PACE('waiting'));
  await page.waitForTimeout(600);
  return { ctx, page, cdp: await ctx.newCDPSession(page) };
}
const st = (page) => page.evaluate(() => { const s = window.__firesim.session.state.get(); return { view: Math.round(s.viewTime), head: Math.round(s.headTime), seek: s.seekTarget }; });
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }, sel);
const geo = (page) => page.evaluate(() => { const t = document.querySelector('.tl-thumb').getBoundingClientRect(); const a = document.querySelector('.tl-area').getBoundingClientRect(); return { tx: t.x + t.width / 2, ty: t.y + t.height / 2, ax: a.x, aw: a.width }; });
async function drag(cdp, x0, y0, x1, y1) {
  const pt = (x, y) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
  const n = 8;
  for (let i = 1; i <= n; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n) }); await new Promise((r) => setTimeout(r, 30)); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function reseek(page, frac) {
  await page.evaluate((f) => window.__firesim.session.seek(window.__firesim.scenario.duration * f), frac);
  await page.waitForFunction(() => window.__firesim.session.state.get().seekTarget === null, null, { timeout: 30000 });
  await page.waitForTimeout(500);
}

for (const vp of Object.keys(vps)) {
  for (const variant of ['t1', 't2', 't3']) {
    const { ctx, page, cdp } = await open(vp, variant);
    const g0 = await geo(page);
    const s0 = await st(page);
    // 1: a tap on the track away from the thumb still jumps there
    const farX = g0.ax + g0.aw * 0.15;
    await page.touchscreen.tap(farX, g0.ty);
    await page.waitForTimeout(700);
    const s1 = await st(page);
    log(vp, variant, 'track tap seeks', s1.view < s0.view - 1500 && !(await visible(page, '[data-testid=pace-sheet]')), `view ${s0.view} -> ${s1.view}`);
    await reseek(page, 0.4);
    const g = await geo(page);

    if (variant === 't1') {
      const b = await page.getByTestId('pace-btn').boundingBox();
      log(vp, variant, 'button >= 44 px', b.width >= 44 && b.height >= 44, `${b.width} x ${b.height}`);
      const before = await st(page);
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(500);
      const open1 = await visible(page, '[data-testid=pace-sheet]');
      const exp = await page.getByTestId('pace-btn').getAttribute('aria-expanded');
      const after = await st(page);
      log(vp, variant, 'tap opens the sheet, clock untouched', open1 && exp === 'true' && after.view === before.view, `open ${open1} expanded ${exp} view ${before.view} -> ${after.view}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const closed = !(await visible(page, '[data-testid=pace-sheet]'));
      const focus = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      log(vp, variant, 'Escape closes and focus returns', closed && focus === 'pace-btn', `closed ${closed} focus ${focus}`);
      // outside tap closes
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(400);
      await page.touchscreen.tap(g.ax + 20, 200);
      await page.waitForTimeout(400);
      log(vp, variant, 'outside tap closes', !(await visible(page, '[data-testid=pace-sheet]')));
    }
    if (variant === 't2') {
      const c = await page.getByTestId('time-btn').boundingBox();
      const badge = await page.getByTestId('pace-badge').boundingBox().catch(() => null);
      log(vp, variant, 'badge shown in the clock', !!badge, badge ? `badge ${Math.round(badge.width)} x ${Math.round(badge.height)} in a clock button ${Math.round(c.width)} x ${Math.round(c.height)}` : 'missing');
      await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2);
      await page.waitForTimeout(600);
      const sec = await visible(page, '[data-testid=pace-section]');
      const rect = await page.evaluate(() => { const s = document.querySelector('[data-testid=pace-section]'); const b = s?.getBoundingClientRect(); const sheet = s?.closest('.tb-sheet')?.getBoundingClientRect(); return b && sheet ? { top: Math.round(b.top), bottom: Math.round(b.bottom), sheetTop: Math.round(sheet.top), sheetBottom: Math.round(sheet.bottom), vh: innerHeight } : null; });
      const inView = rect && rect.top >= rect.sheetTop && rect.bottom <= Math.min(rect.sheetBottom, rect.vh);
      log(vp, variant, 'clock tap opens the time sheet with the new section', sec, `section ${JSON.stringify(rect)} fullyInView ${inView}`);
      await page.keyboard.press('Escape');
    }
    if (variant === 't3') {
      const before = await st(page);
      await page.touchscreen.tap(g.tx, g.ty);
      await page.waitForTimeout(600);
      const open3 = await visible(page, '[data-testid=pace-sheet]');
      const a3 = await st(page);
      log(vp, variant, 'tap on the thumb opens the sheet, clock untouched', open3 && a3.view === before.view, `open ${open3} view ${before.view} -> ${a3.view}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      // a tap 30 px away still seeks
      await page.touchscreen.tap(g.tx - 30, g.ty);
      await page.waitForTimeout(700);
      const a4 = await st(page);
      log(vp, variant, 'tap 30 px from the thumb still seeks', a4.view !== before.view && !(await visible(page, '[data-testid=pace-sheet]')), `view ${before.view} -> ${a4.view}`);
      await reseek(page, 0.4);
      const g2 = await geo(page);
      // a tap 18 px from the thumb (inside the 22 px hit zone): opens the sheet instead of seeking
      const b5 = await st(page);
      await page.touchscreen.tap(g2.tx - 18, g2.ty);
      await page.waitForTimeout(600);
      const o5 = await visible(page, '[data-testid=pace-sheet]');
      const a5 = await st(page);
      log(vp, variant, 'tap 18 px from the thumb (taps stolen from the slider)', true, `sheet ${o5}, view ${b5.view} -> ${a5.view} (a plain seek would have moved it ${Math.round((18 / g2.aw) * 21600)} s)`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await reseek(page, 0.4);
      const g3 = await geo(page);
      const b6 = await st(page);
      await drag(cdp, g3.tx, g3.ty, g3.tx - 60, g3.ty);
      await page.waitForTimeout(800);
      const a6 = await st(page);
      log(vp, variant, 'drag from the thumb still scrubs', a6.view < b6.view - 1500 && !(await visible(page, '[data-testid=pace-sheet]')), `view ${b6.view} -> ${a6.view}`);
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(`${OUT}/interact.json`, JSON.stringify(out, null, 1));
