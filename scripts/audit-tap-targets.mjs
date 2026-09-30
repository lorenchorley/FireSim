// Audits the 44 x 44 px hit-area rule of docs/DESIGN.md on a running page.
// For every visible interactive element it probes points around the centre (the four edge middles at +-21 px and four diagonals
// at +-15 px) with document.elementFromPoint; a point that lands on something else means the hit area is smaller than 44 px there
// (or is clipped by a scrolling parent / covered by a neighbour). Invisible ::after hit-area expanders count, as they do for a finger.
//
// Usage (dev server running):
//   node scripts/audit-tap-targets.mjs http://localhost:5173/src/ui/styleguide.html?theme=dark
//   node scripts/audit-tap-targets.mjs "http://localhost:5173/?mock=1" --click accept-notice,site-katoomba,build --wait sim
//   --click a,b,c   click these data-testid values in order first (waits 500 ms after each)
//   --wait id       wait until [data-testid=id] is visible before auditing
//   --width 390 --height 844   viewport (default phone portrait)
// Env: PW_CHROMIUM = path of the Chromium binary (default /opt/pw-browsers/chromium). Exit code 1 when something fails.
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--') && /^https?:/.test(a));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!url) {
  console.error('usage: node scripts/audit-tap-targets.mjs <url> [--click id,id] [--wait id] [--width 390] [--height 844]');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: Number(opt('width', 390)), height: Number(opt('height', 844)) }, hasTouch: true })).newPage();
await page.goto(url);
for (const id of (opt('click', '') ?? '').split(',').filter(Boolean)) {
  await page.getByTestId(id).click();
  await page.waitForTimeout(500);
}
const waitFor = opt('wait', '');
if (waitFor) await page.getByTestId(waitFor).waitFor({ timeout: 90_000 });
await page.waitForTimeout(500);

const problems = await page.evaluate(() => {
  const sel =
    'button, a[href], [role=button], [role=tab], [role=switch], label.toggle, label.check, label.radio, .segmented-option, input:not([type=hidden]), select, textarea, summary, [tabindex="0"]';
  const probes = [[-21, 0], [21, 0], [0, -21], [0, 21], [-15, -15], [15, 15], [-15, 15], [15, -15]];
  const out = [];
  for (const el of new Set(document.querySelectorAll(sel))) {
    const cs = getComputedStyle(el);
    const r0 = el.getBoundingClientRect();
    if (r0.width === 0 || r0.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[hidden], [inert]')) continue;
    // A checkbox, radio or switch inside its label row: the row is the tap target and is audited itself.
    if (el instanceof HTMLInputElement && el.closest('label.toggle, label.check, label.radio, .segmented-option')) continue;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
    const label = el.closest('label');
    const missed = [];
    for (const [dx, dy] of probes) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (!(hit && (el === hit || el.contains(hit) || (label && label.contains(hit))))) missed.push(`${dx},${dy}`);
    }
    if (missed.length) {
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30);
      out.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).slice(0, 40)} ${Math.round(r.width)}x${Math.round(r.height)} "${name}" misses ${missed.length}/8 probes`);
    }
  }
  return out;
});

await browser.close();
if (problems.length) {
  console.log(`${problems.length} control(s) with a hit area under 44 x 44 px:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('ok: every visible control has a 44 x 44 px hit area');
