// Run from the repo root with the prototype applied and a dev server on BASE: BASE=http://localhost:4301 OUT=./s1-out/shots node docs/plans/spikes/S1-timeline-signal/tools/drive.mjs  (LOOKS, VPS, VARIANTS, TAG narrow the run)
// S1 driver: opens the worktree dev server in the phone sizes and looks, forces each pace level, takes crops and measures the strip.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:4301';
const OUT = process.env.OUT ?? './s1-out/shots';
fs.mkdirSync(OUT, { recursive: true });
const looks = { light: 'theme=light', dark: 'theme=dark', 'light-hc': 'theme=light&contrast=high', 'dark-hc': 'theme=dark&contrast=high' };
const viewports = { portrait: [412, 915], landscape: [844, 390] };
const variants = (process.env.VARIANTS ?? 'none,t1,t2,t3').split(',');
const levelsFor = (v) => (v === 'none' ? ['ok'] : ['behind', 'waiting']);
const wantLooks = (process.env.LOOKS ?? Object.keys(looks).join(',')).split(',');
const wantVps = (process.env.VPS ?? Object.keys(viewports).join(',')).split(',');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];

const PACE = (level) => ({ level, wanted: 60, achieved: 38, waitingShare: level === 'waiting' ? 0.4 : 0, capacity: 38, duty: 0.97, aheadS: 60, bufferS: 1, sinceMs: 0 });
for (const look of wantLooks) {
  for (const vp of wantVps) {
    const [w, h] = viewports[vp];
    for (const variant of variants) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e)));
      const q = `mock=1&${looks[look]}` + (variant === 'none' ? '' : `&pace=${variant}`);
      await page.goto(`${BASE}/?${q}`);
      await page.getByTestId('accept-notice').click();
      await page.getByTestId('site-katoomba').click();
      await page.getByTestId('build').click();
      await page.getByTestId('sim').waitFor({ timeout: 90_000 });
      await page.getByTestId('dock').waitFor();
      await page.waitForTimeout(1200);
      // park the clock at 40 % of the run, at the newest result, so the thumb is mid-track
      await page.evaluate(() => window.__firesim.session.seek(window.__firesim.scenario.duration * 0.4));
      await page.waitForFunction(() => window.__firesim.session.state.get().seekTarget === null, null, { timeout: 30_000 });
      await page.waitForTimeout(800);
      for (const level of levelsFor(variant)) {
        await page.evaluate((p) => window.__firesim.session.state.set({ pace: p }), variant === 'none' ? null : PACE(level));
        await page.waitForTimeout(500);
        const m = await page.evaluate(() => {
          const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
          const vis = (e) => !!e && getComputedStyle(e).display !== 'none' && !e.hidden && e.getBoundingClientRect().width > 0;
          const q = (s) => document.querySelector(s);
          return {
            strip: r(q('.scrubber')),
            area: r(q('.tl-area')),
            pace: vis(q('[data-testid=pace-btn]')) ? r(q('[data-testid=pace-btn]')) : null,
            badge: vis(q('[data-testid=pace-badge]')) ? r(q('[data-testid=pace-badge]')) : null,
            line: vis(q('.tl-pace-line')) ? r(q('.tl-pace-line')) : null,
            thumb: r(q('.tl-thumb')),
            labels: [...document.querySelectorAll('.tl-label')].map((e) => e.textContent),
            clock: r(q('[data-testid=time-btn]')),
            clockText: q('[data-testid=time-btn]')?.innerText.replace(/\n/g, ' | '),
          };
        });
        const name = `${vp}-${look}-${variant}-${level}`;
        const strip = m.strip;
        const y0 = Math.max(0, strip.y - 34);
        await page.screenshot({ path: `${OUT}/${name}-strip.png`, clip: { x: 0, y: y0, width: w, height: Math.min(h - y0, strip.h + 34) } });
        const pillBox = await page.evaluate(() => { const b = document.querySelector('.tb-pill').getBoundingClientRect(); return { x: 0, y: Math.max(0, b.y - 6), width: innerWidth, height: b.height + 14 }; });
        await page.screenshot({ path: `${OUT}/${name}-pill.png`, clip: pillBox });
        results.push({ name, look, vp, variant, level, ...m, errors: errs.slice() });
      }
      await ctx.close();
    }
  }
}
await browser.close();
fs.writeFileSync(`${OUT}/metrics-${process.env.TAG ?? 'run'}.json`, JSON.stringify(results, null, 1));
console.log('done', results.length);
