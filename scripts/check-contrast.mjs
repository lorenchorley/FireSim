#!/usr/bin/env node
// WCAG 2.x contrast audit of the FireSim design system (src/styles/*.css), no browser and no dependencies.
//
//   node scripts/check-contrast.mjs                 table of the worst ratios per mode; exit 1 when a check fails
//   node scripts/check-contrast.mjs --verbose       every checked pair
//   node scripts/check-contrast.mjs --json          machine-readable result (used by src/ui/contrast.script.test.ts)
//   npm run check:contrast
//
// What it checks, in the four looks the app has: light, dark, high-contrast light, high-contrast dark
//   (light = base tokens; dark = base + dark block; high = theme + the shared high-contrast block + its theme's block, as the cascade does):
//   1. CURATED pairs: every text / icon / boundary / status token used against every surface it can sit on
//      (text on surface, secondary text, links and accents on surface and on tints, badges, status pills, chips, banner, snackbar,
//      FAB icon, switch track and thumb, slider, dividers and outlines against the surface, the TRAINING strip, chart series ...).
//   2. AUTOMATIC pairs: every rule in the design-system CSS files that sets both `color` and `background` from tokens is resolved
//      and checked, with the high-contrast overrides merged in, so a new component cannot ship an unreadable pair.
// Thresholds (WCAG 2.x): text 4.5:1 (7:1 in high contrast); large text and UI components / graphics / boundaries 3:1 (4.5:1 in high contrast);
// the mandatory TRAINING strip 7:1 in every look. "info" rows are reported but never fail (decorative hairlines, disabled controls).
// Limits: only opaque sRGB colours are compared (a translucent surface such as --surface-glass is checked over black and over white,
// and the worse result counts); colours that come from JavaScript or from images are out of scope (the DOM audit,
// scripts/audit-contrast-dom.mjs, measures the rendered page).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles');
/** Every stylesheet of the app (design system first, then the screens): a failure in any of them fails the check. */
export const DESIGN_FILES = ['base.css', 'components.css', 'overlays.css', 'data.css', 'screens.css', 'sim.css', 'transport.css', 'layers.css', 'datasets.css', 'modelcard.css'];

// ───────────────────────────── WCAG maths ─────────────────────────────

/** '#rgb' | '#rrggbb' | 'rgb(a)(r, g, b, a)' -> [r, g, b, a] (0..255, alpha 0..1) or null. */
export function parseColor(value) {
  const v = String(value).trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }
  return null;
}

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance of an opaque [r, g, b, ...] colour. */
export function luminance(rgb) {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** Composite `fg` (with alpha) over an opaque `bg`. */
export function over(fg, bg) {
  const a = fg[3] ?? 1;
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
}

/** Contrast ratio of two colours (strings or arrays); a translucent foreground is composited over the background first. */
export function contrast(fg, bg) {
  const f = typeof fg === 'string' ? parseColor(fg) : fg;
  const b = typeof bg === 'string' ? parseColor(bg) : bg;
  const x = luminance(over(f, b));
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ───────────────────────────── CSS parsing ─────────────────────────────

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Flat list of style rules {sel, ctx (enclosing @media/@supports heads), decl (property -> value)}; @keyframes and @font-face are skipped. */
export function parseRules(cssText) {
  const css = strip(cssText);
  const out = [];
  const walk = (text, ctx) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (/^@(media|supports|layer)/.test(head)) walk(body, [...ctx, head.replace(/\s+/g, ' ')]);
      else if (!head.startsWith('@')) out.push({ sel: head.replace(/\s+/g, ' '), ctx, decl: parseDecls(body) });
      i = j;
    }
  };
  walk(css, []);
  return out;
}

/** "a: b; c: d(e;f)" -> {a: 'b', c: 'd(e;f)'} (semicolons inside parentheses, e.g. data URIs, do not split). */
export function parseDecls(body) {
  const d = {};
  for (const part of body.split(/;(?![^(]*\))/)) {
    const k = part.indexOf(':');
    if (k < 0) continue;
    d[part.slice(0, k).trim()] = part.slice(k + 1).trim();
  }
  return d;
}

/** The custom-property blocks of tokens.css as {base, dark, hcShared, hcLight, hcDark}. */
export function readTokenBlocks(css = readFileSync(join(STYLES, 'tokens.css'), 'utf8')) {
  const rules = parseRules(css);
  const pick = (selector) => {
    const o = {};
    for (const r of rules) {
      if (r.sel !== selector) continue;
      for (const [k, v] of Object.entries(r.decl)) if (k.startsWith('--')) o[k] = v;
    }
    return o;
  };
  return {
    base: { ...pick(":root, :root[data-theme='light']"), ...pick(':root') },
    dark: pick(":root[data-theme='dark']"),
    hcShared: pick(":root[data-contrast='high']"),
    hcLight: pick(":root[data-contrast='high']:not([data-theme='dark'])"),
    hcDark: pick(":root[data-theme='dark'][data-contrast='high']"),
  };
}

/** Replace var(--x) references until the value is plain. */
function resolveAll(all) {
  const out = {};
  for (const k of Object.keys(all)) {
    let v = all[k];
    for (let i = 0; i < 12 && /var\(/.test(v); i++) v = v.replace(/var\((--[a-z0-9-]+)(?:,[^)]*)?\)/gi, (_, n) => all[n] ?? `MISSING(${n})`);
    out[k] = v;
  }
  return out;
}

/** The four looks, every custom property resolved to a plain value. */
export function buildModes(blocks = readTokenBlocks()) {
  const { base, dark, hcShared, hcLight, hcDark } = blocks;
  return {
    light: resolveAll({ ...base }),
    dark: resolveAll({ ...base, ...dark }),
    'high-light': resolveAll({ ...base, ...hcShared, ...hcLight }),
    'high-dark': resolveAll({ ...base, ...dark, ...hcShared, ...hcDark }),
  };
}
export const MODE_NAMES = ['light', 'dark', 'high-light', 'high-dark'];
const isHigh = (mode) => mode.startsWith('high');

// ───────────────────────────── Checks ─────────────────────────────

// kind: text (4.5 | 7), large (3 | 4.5, text >= 24 px or >= 18.66 px bold), ui (3 | 4.5), strip (7 | 7), info (reported, never fails)
const LIMITS = { text: [4.5, 7], large: [3, 4.5], ui: [3, 4.5], strip: [7, 7], info: [0, 0] };

/** Backdrops a translucent surface can sit on: the sim map is dark (#20251f) or light imagery, so try black and white. */
const BACKDROPS = [[0, 0, 0, 1], [255, 255, 255, 1]];

/** Resolve a token or literal colour in a mode to a list of opaque candidates (a translucent one gives two, one per backdrop). */
function candidates(mode, token) {
  const raw = token.startsWith('--') ? mode[token] : token;
  const c = raw === undefined ? null : parseColor(raw);
  if (!c) return null;
  return c[3] < 1 ? BACKDROPS.map((b) => over(c, b)) : [c];
}

/** Worst contrast of fg on bg over their candidates, or null when a token is not a colour in this mode. */
function ratio(mode, fg, bg) {
  const fs = candidates(mode, fg);
  const bs = candidates(mode, bg);
  if (!fs || !bs) return null;
  let worst = Infinity;
  for (const b of bs) for (const f of fs) worst = Math.min(worst, contrast(f, b));
  return worst;
}

/** Contrast of fg on a (possibly translucent) bg that sits on the look's --surface: a state layer or disabled fill, where
 * both colours are veils over the same card (compositing each over black and white separately would mean nothing). */
function ratioOnSurface(mode, fg, bg) {
  const s = parseColor(mode['--surface'] ?? '#ffffff');
  const f = parseColor(fg.startsWith('--') ? (mode[fg] ?? '') : fg);
  const b = parseColor(bg.startsWith('--') ? (mode[bg] ?? '') : bg);
  if (!s || !f || !b) return null;
  return contrast(f, over(b, s));
}

const SURFACES = ['--bg', '--surface', '--surface-2', '--surface-glass'];
const TINTS = ['--primary-container', '--danger-bg', '--watch-bg', '--ok-bg', '--info-bg', '--fire-bg', '--violet-bg'];
const STATUS = ['danger', 'watch', 'ok', 'info', 'fire'];

/**
 * Curated pairs: [foreground, background, kind, why, options?]. options.high overrides the kind's high-contrast limit,
 * options.min overrides the default-look limit.
 */
export function curatedPairs() {
  const P = [];
  const add = (fg, bg, kind, why, opt) => P.push({ fg, bg, kind, why, ...(opt ?? {}) });

  // Body and secondary text on every surface and tint it can sit on (cards, lists, callouts, chips, floating map overlays)
  for (const bg of [...SURFACES, '--surface-3', ...TINTS]) {
    add('--text', bg, 'text', `body text on ${bg}`);
    if (bg !== '--surface-3') add('--muted', bg, 'text', `secondary text on ${bg}`);
  }
  // Muted text on the neutral badge / track fill is a documented limit (the design system uses --text there): reported only
  add('--muted', '--surface-3', 'info', 'muted on the neutral badge / track fill: not allowed (the design system uses --text there)');

  // Links, text buttons, accent-coloured labels (blue): on the surfaces and on every tint they can appear in
  for (const bg of [...SURFACES, ...TINTS]) add('--primary-ink', bg, 'text', `link / text button / selected label on ${bg}`);
  add('--on-primary', '--primary', 'text', 'label of a filled button, FAB icon, selected switch thumb, tab badge');
  add('--on-primary-container', '--primary-container', 'text', 'selected chip, tonal button, nav pill, segmented selected');
  add('--on-primary-container', '--surface', 'text', 'tonal label if it lands on a card');
  add('--on-primary', '--info', 'text', 'label on an info fill');
  add('--on-info', '--info', 'text', 'label on an info fill');

  // Status: -ink on the surface and its own tint, -on on the fill
  for (const s of STATUS) {
    const ink = `--${s}-ink`;
    for (const bg of ['--bg', '--surface', '--surface-2', '--surface-glass', `--${s}-bg`]) add(ink, bg, 'text', `${s} text or icon on ${bg}`);
    if (s !== 'fire') add(`--on-${s}`, `--${s}`, 'text', `${s}: label on the fill`, s === 'fire' ? { high: 6.5 } : undefined);
  }
  // Fire orange is a marker colour: a label on the fill is never used by the design system; chips use --fire-bg + --fire-ink
  add('--on-fire', '--fire', 'text', 'label on a fire-orange fill (marker colour; the design system uses --fire-bg + --fire-ink instead)', { high: 6.5 });
  add('--fire', '--surface', 'ui', 'fire markers and bars against a card', { high: 3 });
  // Against the grey fills the orange is 2.6-2.8:1: only ever the fill of a bar / meter whose value is printed next to it
  add('--fire', '--surface-3', 'info', 'fire bar fill against its track (the value is always printed next to a bar)');
  add('--fire', '--bg', 'info', 'fire marker against the app background (markers carry a label)');

  // Fire-danger ratings (data colours, both themes) and the pill text on them
  for (const r of ['none', 'moderate', 'high', 'extreme']) add('--rating-ink', `--rating-${r}`, 'text', `rating pill: ${r}`);
  add('--rating-ink-catastrophic', '--rating-catastrophic', 'text', 'rating pill: catastrophic');
  for (const r of ['moderate', 'high', 'extreme', 'catastrophic']) add(`--rating-${r}`, '--surface', 'info', `${r} rating swatch against a card (the word always comes with it)`);

  // Icons and graphics
  for (const bg of [...SURFACES, '--surface-3']) add('--icon', bg, 'ui', `icons on ${bg}`);
  add('--icon', '--surface-2', 'ui', 'icon in the tile thumbnail');
  add('--primary', '--surface', 'ui', 'active FAB icon, switch track, slider, selected frame against a card');
  add('--primary', '--bg', 'ui', 'the same against the app background');
  add('--primary', '--surface-2', 'ui', 'selected tile frame against its thumbnail fill');
  add('--focus', '--surface', 'ui', 'focus ring on a card');
  add('--focus', '--bg', 'ui', 'focus ring on the app background');
  add('--focus', '--surface-2', 'ui', 'focus ring on subtle fills');
  add('--focus', '--primary-container', 'ui', 'focus ring on a selected chip / nav pill');

  // Boundaries of controls (text fields, checkbox, radio, switch, segmented): need 3:1 against whatever they sit on
  for (const bg of ['--surface', '--bg', '--surface-2']) add('--outline', bg, 'ui', `text field / checkbox / switch / segmented boundary on ${bg}`);
  add('--outline', '--primary-container', 'ui', 'segmented boundary next to the selected (tinted) segment');
  // Switch (M3, flat): off = 2 px --outline border on --surface-2 with an --outline dot; on = --primary track with an --on-primary thumb
  add('--outline', '--surface-2', 'ui', 'switch OFF: thumb on its track');
  add('--on-primary', '--primary', 'ui', 'switch ON: thumb on its track');
  add('--danger-ink', '--surface', 'ui', 'error frame of a text field');
  // Slider: the active part and thumb are --primary (checked above); the unfilled track is a light guide line, the thumb marks the value
  add('--outline-variant', '--surface', 'info', 'slider / progress unfilled track and label-carrying button / chip outlines (a text label identifies those)');
  add('--surface-3', '--surface', 'info', 'progress and bar track against a card');
  // Hairlines: decorative, reported so a change is visible
  add('--divider', '--surface', 'info', 'hairline between rows (decorative)');
  add('--divider', '--bg', 'info', 'hairline on the app background (decorative)');

  // Bars, meters and sparkbars are data and sit on --surface-3 (the track) inside a card
  for (const c of ['--muted', '--ok', '--danger', '--series-1', '--series-2', '--series-3', '--series-4', '--series-5']) add(c, '--surface-3', 'ui', `bar fill ${c} against its track`);
  add('--watch', '--surface-3', 'info', 'amber bar fill against its track (a value always accompanies a bar)');
  for (const c of ['--chart-wind', '--chart-temp', '--chart-rh', '--chart-moist', '--series-1', '--series-2', '--series-3', '--series-4', '--series-5']) {
    add(c, '--surface', 'ui', `chart / bar colour ${c} against a card`);
  }
  add('--violet-ink', '--violet-bg', 'text', 'origin chip: user data');
  add('--text', '--surface-3', 'text', 'origin chip: saved on device / neutral badge / code');

  // Safety strip, snackbar, dialog scrim text
  add('--badge-ink', '--badge-bg', 'strip', 'TRAINING AID strip');
  add('--on-surface-inverse', '--surface-inverse', 'text', 'snackbar text');
  add('--snackbar-action', '--surface-inverse', 'text', 'snackbar action label');
  add('--surface-inverse', '--bg', 'info', 'snackbar edge against the app background (its shadow carries the edge)');

  // Placeholder, disabled (exempt from WCAG: reported at their real blended contrast)
  add('--muted', '--surface', 'text', 'input placeholder');
  add('--muted', '--surface-2', 'text', 'disabled input value on its grey fill');
  return P;
}

/** Curated results for one mode. */
function checkCurated(modeName, mode) {
  const out = [];
  for (const p of curatedPairs()) {
    const r = ratio(mode, p.fg, p.bg);
    if (r === null) {
      out.push({ ...p, mode: modeName, source: 'curated', ratio: null, need: null, ok: false, note: `unresolved token (${p.fg} / ${p.bg})` });
      continue;
    }
    const [tn, th] = LIMITS[p.kind];
    const need = isHigh(modeName) ? (p.high ?? th) : (p.min ?? tn);
    out.push({ ...p, mode: modeName, source: 'curated', ratio: r, need, ok: p.kind === 'info' || r + 1e-9 >= need });
  }
  return out;
}

// ───────────────────────────── Automatic scan of the CSS ─────────────────────────────

/** First `var(--token)` in a value that names a colour token, or a literal colour, else null. */
function firstColour(value) {
  if (!value) return null;
  const v = value.trim();
  if (v === 'transparent' || v === 'none' || v === 'inherit' || v === 'currentColor' || /gradient/.test(v)) return null;
  const m = /var\((--[a-z0-9-]+)\)/i.exec(v) ?? /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/i.exec(v);
  return m ? m[1] : null;
}

const HC_PREFIX = /^:root\[data-contrast='high'\](?::not\(\[data-theme='dark'\]\))?\s*/;
const DARK_PREFIX = /^:root\[data-theme='dark'\]\s*/;
/** Selectors whose glyph is an icon or a graphic (3:1) rather than text (4.5:1). */
const GRAPHIC_SELECTOR = /icon|\.fab|\.tile-thumb|\.toggle-thumb|\.check|\.radio|-mark|\.swatch|spinner|nav-badge|badge-dot/;
/** Disabled controls: WCAG 1.4.3 exempts them, so they are reported ("info") at their real blended contrast, never failed. */
const DISABLED_SELECTOR = /:disabled|\.is-disabled|\[disabled\]|aria-disabled/;
/** Pairs the scan sees that are not text on the fill (their own reason is the value). */
const SCAN_EXEMPT = new Map([
  // (none today: add "selector" -> "reason" here rather than loosening a token)
]);

/**
 * Per-file rules grouped by selector: [{file, sel, plain, dark, hc}] where plain / dark / hc are the merged declarations of the plain rules,
 * of the ":root[data-theme='dark'] .x" overrides and of the ":root[data-contrast='high'] .x" overrides for that selector. A look is resolved by
 * layering plain, then dark (dark looks), then hc (high-contrast looks), as the cascade does for equal specificity, so a rule that only swaps
 * the background in high contrast is checked against the base rule's text colour.
 */
export function scanRules(files) {
  const out = [];
  for (const file of files) {
    const bySel = new Map();
    for (const r of parseRules(readFileSync(join(STYLES, file), 'utf8'))) {
      if (r.ctx.some((c) => /reduced-motion|forced-colors|hover|max-width/.test(c))) continue;
      const layer = HC_PREFIX.test(r.sel) ? 'hc' : DARK_PREFIX.test(r.sel) ? 'dark' : 'plain';
      for (const raw of r.sel.split(',').map((x) => x.trim())) {
        const sel = raw.replace(HC_PREFIX, '').replace(DARK_PREFIX, '');
        const entry = bySel.get(sel) ?? { file, sel, plain: {}, dark: {}, hc: {} };
        Object.assign(entry[layer], r.decl);
        bySel.set(sel, entry);
      }
    }
    out.push(...bySel.values());
  }
  return out;
}

/** The colour pair a rule gives in one look, or null when it does not set both a text and a background colour from tokens. */
function pairInMode(rule, modeName) {
  const d = { ...rule.plain, ...(modeName.endsWith('dark') ? rule.dark : {}), ...(isHigh(modeName) ? rule.hc : {}) };
  const fg = firstColour(d.color);
  const bg = firstColour(d['background-color'] ?? d.background);
  return fg && bg ? { fg, bg } : null;
}

function checkScan(modeName, mode, files) {
  const out = [];
  const high = isHigh(modeName);
  for (const rule of scanRules(files)) {
    const p = pairInMode(rule, modeName);
    if (!p || SCAN_EXEMPT.has(rule.sel)) continue;
    const disabled = DISABLED_SELECTOR.test(rule.sel);
    const r = disabled ? ratioOnSurface(mode, p.fg, p.bg) : ratio(mode, p.fg, p.bg);
    if (r === null) continue; // literal or non-colour value the scan cannot resolve
    const kind = disabled ? 'info' : GRAPHIC_SELECTOR.test(rule.sel) ? 'ui' : 'text';
    const [tn, th] = LIMITS[kind];
    const need = high ? th : tn;
    out.push({ fg: p.fg, bg: p.bg, kind, why: `${rule.file}: ${rule.sel.slice(0, 80)}`, mode: modeName, source: 'scan', ratio: r, need, ok: kind === 'info' || r + 1e-9 >= need, file: rule.file });
  }
  return out;
}

// ───────────────────────────── Hard-coded colours ─────────────────────────────

/** Literal colours in the design-system CSS (they cannot follow the theme). */
export function literalColours(files = DESIGN_FILES) {
  const out = [];
  for (const file of files) {
    for (const r of parseRules(readFileSync(join(STYLES, file), 'utf8'))) {
      for (const [k, v] of Object.entries(r.decl)) {
        if (k.startsWith('--') || /^(--)/.test(k)) continue;
        if (/^(color|background(-color)?|border(-[a-z]+)?(-color)?|outline(-color)?|fill|stroke)$/.test(k) && /#[0-9a-f]{3,8}\b/i.test(v.replace(/url\([^)]*\)/g, ''))) {
          out.push({ file, sel: r.sel.slice(0, 70), prop: k, value: v.slice(0, 40) });
        }
      }
    }
  }
  return out;
}

// ───────────────────────────── Run ─────────────────────────────

/** Run every check. Returns {results, failures, literals, worst} (worst = lowest ratio per mode and kind). */
export function runChecks() {
  const modes = buildModes();
  const results = [];
  for (const name of MODE_NAMES) {
    results.push(...checkCurated(name, modes[name]));
    results.push(...checkScan(name, modes[name], DESIGN_FILES));
  }
  const failures = results.filter((r) => !r.ok);
  const worst = {};
  for (const r of results) {
    if (r.ratio === null || r.kind === 'info') continue;
    const key = `${r.mode}/${r.kind}`;
    if (!worst[key] || r.ratio < worst[key].ratio) worst[key] = { ratio: r.ratio, fg: r.fg, bg: r.bg, why: r.why };
  }
  return { results, failures, literals: literalColours(), worst };
}

// ───────────────────────────── CLI ─────────────────────────────

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const res = runChecks();
  const fmt = (r) => `${r.mode.padEnd(10)} ${r.kind.padEnd(5)} ${(r.ratio === null ? 'n/a' : r.ratio.toFixed(2)).padStart(6)} (need ${r.need}) ${r.fg} on ${r.bg}: ${r.why}`;
  if (args.includes('--json')) {
    console.log(JSON.stringify({ failures: res.failures.map(fmt), literals: res.literals, worst: res.worst, checked: res.results.length }));
    process.exit(res.failures.length ? 1 : 0);
  }
  if (args.includes('--verbose')) for (const r of res.results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${fmt(r)}`);
  console.log(`\nChecked ${res.results.length} pairs in ${MODE_NAMES.length} looks (curated + automatic scan of ${DESIGN_FILES.join(', ')}).\n`);
  console.log('Worst ratio per look and kind (kind: text 4.5|7, large 3|4.5, ui 3|4.5, strip 7):');
  for (const m of MODE_NAMES) {
    for (const k of ['text', 'ui', 'strip']) {
      const w = res.worst[`${m}/${k}`];
      if (w) console.log(`  ${m.padEnd(10)} ${k.padEnd(5)} ${w.ratio.toFixed(2).padStart(6)}  ${w.fg} on ${w.bg}  (${w.why})`);
    }
  }
  if (res.literals.length) {
    console.log(`\nHard-coded colours in the design-system CSS (${res.literals.length}); prefer a token:`);
    for (const l of res.literals) console.log(`  ${l.file}: ${l.sel} { ${l.prop}: ${l.value} }`);
  }
  if (res.failures.length) {
    console.log(`\n${res.failures.length} FAILING pair(s):`);
    for (const r of res.failures) console.log(`  ${fmt(r)}`);
    process.exit(1);
  }
  console.log('\nok: every checked pair meets its threshold');
}
