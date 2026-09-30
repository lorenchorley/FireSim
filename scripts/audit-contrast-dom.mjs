// Measures the REAL rendered contrast of a running page (ground truth for scripts/check-contrast.mjs, which works on the CSS text).
// For every visible text node it takes the computed text colour and composites the ancestors' backgrounds (alpha and opacity honoured)
// to get the colour actually behind it; the same for the boundary of text fields, checkboxes, switches and segmented options
// (>= 3:1 against the surface they sit on; separate tiles of a .segmented-grid are identified by their label and are not measured) and for 24 px icons (>= 3:1). Disabled controls are skipped (WCAG exempts them).
// An element with a background image or gradient behind its text is reported as "unknown" (not a failure).
//
// Usage (dev server running):
//   node scripts/audit-contrast-dom.mjs "http://localhost:5173/src/ui/styleguide.html?theme=dark&contrast=high" [--high] [--click a,b] [--wait id]
//   --high        use the high-contrast thresholds (text 7, boundaries 4.5)
//   --width 390 --height 844   viewport
//   --all         print every measured element, not only the failures
// Env: PW_CHROMIUM = path of the Chromium binary (default /opt/pw-browsers/chromium). Exit code 1 when something fails.
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:/.test(a));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!url) {
  console.error('usage: node scripts/audit-contrast-dom.mjs <url> [--high] [--click id,id] [--wait id] [--width 390] [--height 844] [--all]');
  process.exit(2);
}
const high = args.includes('--high') || /contrast=high/.test(url);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: Number(opt('width', 390)), height: Number(opt('height', 844)) } })).newPage();
await page.goto(url);
for (const id of (opt('click', '') ?? '').split(',').filter(Boolean)) {
  await page.getByTestId(id).click();
  await page.waitForTimeout(500);
}
const waitFor = opt('wait', '');
if (waitFor) await page.getByTestId(waitFor).waitFor({ timeout: 90_000 });
await page.waitForTimeout(600);

const report = await page.evaluate((highContrast) => {
  const parse = (c) => {
    let m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/.exec(c);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
    m = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(c);
    if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    return null;
  };
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
  const ratio = (f, b) => {
    const x = lum(over(f, b));
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const canvas = parse(getComputedStyle(document.documentElement).backgroundColor) ?? [255, 255, 255, 1];
  const rootBg = canvas[3] < 1 ? parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1] : canvas;
  /** Colour behind `el`: composite the ancestors' background colours; null when an image / gradient is in the way. */
  const backdrop = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none' && !/^url\(.*(check|chev)/.test(cs.backgroundImage) && !/linear-gradient\(to right, rgb/.test(cs.backgroundImage)) return null;
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let acc = [rootBg[0], rootBg[1], rootBg[2], 1];
    for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
    return acc;
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const isDisabled = (el) => !!el.closest(':disabled, [aria-disabled="true"], .is-disabled, [inert]');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]');
  };
  const name = (el) => {
    const cls = String(el.className?.baseVal ?? el.className ?? '').trim().split(/\s+/).slice(0, 3).join('.');
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  };
  const rows = [];
  const push = (kind, el, label, fg, bg, need) => {
    if (!bg) return rows.push({ kind, el: name(el), label, unknown: true });
    const r = ratio(fg, bg);
    rows.push({ kind, el: name(el), label, ratio: +r.toFixed(2), need, ok: r + 1e-9 >= need, fg: fg.slice(0, 3).map(Math.round).join(','), bg: bg.slice(0, 3).map(Math.round).join(',') });
  };
  // Text
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const text = t.textContent.trim();
    const el = t.parentElement;
    if (!text || !el || seen.has(el) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) || el.closest('.sg-ct')) continue; // .sg-ct: the style guide's own colour samples
    seen.add(el);
    if (!visible(el) || isDisabled(el) || opacityOf(el) < 0.99) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = backdrop(el);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = highContrast ? (large ? 4.5 : 7) : large ? 3 : 4.5;
    push('text', el, text.slice(0, 32), bg ? over(fg, bg) : fg, bg, need);
  }
  // Boundaries of input-like controls against what they sit on (3:1, 4.5:1 in high contrast)
  const needB = highContrast ? 4.5 : 3;
  for (const el of document.querySelectorAll('.input-wrap input:not([type=range]), .input-wrap select, .input-wrap textarea, .segmented-options:not(.segmented-grid), .toggle-track, .check input, .radio input')) {
    if (!visible(el) || isDisabled(el)) continue;
    const cs = getComputedStyle(el);
    const bc = parse(cs.borderTopColor);
    if (!bc || parseFloat(cs.borderTopWidth) < 1) continue;
    const bg = backdrop(el.parentElement);
    push('boundary', el, name(el), bc, bg, needB);
  }
  // Icons (24 px glyphs carry meaning: 3:1)
  for (const el of document.querySelectorAll('svg.icon')) {
    if (!visible(el) || isDisabled(el) || opacityOf(el) < 0.99) continue;
    const fg = parse(getComputedStyle(el).color);
    const bg = backdrop(el);
    if (fg) push('icon', el, el.closest('button,a,li,div')?.getAttribute('aria-label') ?? name(el.parentElement), bg ? over(fg, bg) : fg, bg, highContrast ? 4.5 : 3);
  }
  return rows;
}, high);

await browser.close();
const measured = report.filter((r) => !r.unknown);
const bad = measured.filter((r) => !r.ok);
const unknown = report.length - measured.length;
if (args.includes('--all')) for (const r of measured) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.kind.padEnd(8)} ${String(r.ratio).padStart(5)}/${r.need} ${r.el} "${r.label}" fg ${r.fg} bg ${r.bg}`);
console.log(`${measured.length} measured (${unknown} on images/gradients skipped), ${bad.length} below threshold${high ? ' [high contrast]' : ''}`);
for (const r of bad) console.log(`  FAIL ${r.kind.padEnd(8)} ${r.ratio}:1 (need ${r.need}) ${r.el} "${r.label}" fg rgb(${r.fg}) on rgb(${r.bg})`);
if (measured.length) {
  const min = measured.filter((r) => r.kind === 'text').sort((a, b) => a.ratio - b.ratio)[0];
  if (min) console.log(`  lowest text ratio: ${min.ratio}:1 ${min.el} "${min.label}"`);
}
process.exit(bad.length ? 1 : 0);
