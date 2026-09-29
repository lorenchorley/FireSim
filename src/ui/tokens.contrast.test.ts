/**
 * WCAG checks on the design tokens (src/styles/tokens.css), read as text and resolved the way the cascade does:
 *   light = base;  dark = base + dark block;  high = theme + shared high-contrast block + its theme's high-contrast block.
 * Default look: body text >= 4.5:1, component boundaries / icons / graphics >= 3:1, safety strip >= 7:1.
 * High-contrast look: every text pair >= 7:1 and boundaries >= 4.5:1.
 * Rule of thumb these checks encode (also in docs/DESIGN.md): the --x fill of a status colour is for fills and big icons;
 * TEXT on a surface or a tint uses --x-ink; muted text never goes on --surface-3.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

type Tokens = Record<string, string>;

const css = readFileSync(join(__dirname, '..', 'styles', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Custom properties declared by every rule whose selector list is exactly `selector`. */
function block(selector: string): Tokens {
  const out: Tokens = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    if (m[1]!.replace(/\s+/g, ' ').trim() !== selector) continue;
    for (const d of m[2]!.split(/;(?![^(]*\))/)) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const name = d.slice(0, i).trim();
      if (name.startsWith('--')) out[name] = d.slice(i + 1).trim();
    }
  }
  return out;
}

/** Replace var(--x) references until the value is plain. */
function resolve(all: Tokens): Tokens {
  const out: Tokens = {};
  for (const k of Object.keys(all)) {
    let v = all[k]!;
    for (let i = 0; i < 10 && /var\(/.test(v); i++) v = v.replace(/var\((--[a-z0-9-]+)\)/g, (_, n: string) => all[n] ?? `MISSING(${n})`);
    out[k] = v;
  }
  return out;
}

const base = { ...block(":root, :root[data-theme='light']"), ...block(':root') };
const dark = block(":root[data-theme='dark']");
const hcShared = block(":root[data-contrast='high']");
const hcLight = block(":root[data-contrast='high']:not([data-theme='dark'])");
const hcDark = block(":root[data-theme='dark'][data-contrast='high']");

const MODES = {
  light: resolve({ ...base }),
  dark: resolve({ ...base, ...dark }),
  'high-light': resolve({ ...base, ...hcShared, ...hcLight }),
  'high-dark': resolve({ ...base, ...dark, ...hcShared, ...hcDark }),
} as const;
type Mode = keyof typeof MODES;
const HIGH: readonly Mode[] = ['high-light', 'high-dark'];

/** [foreground token, background token, minimum in the default look, minimum in high contrast, why] */
type Pair = readonly [string, string, number, number, string];

const TEXT = 4.5;
const HC_TEXT = 7;
const UI = 3;
const HC_UI = 4.5;

const PAIRS: readonly Pair[] = [
  // Body and secondary text on every surface it can sit on
  ['--text', '--bg', TEXT, HC_TEXT, 'body text on the app background'],
  ['--text', '--surface', TEXT, HC_TEXT, 'body text on cards and sheets'],
  ['--text', '--surface-2', TEXT, HC_TEXT, 'body text on subtle fills'],
  ['--text', '--surface-3', TEXT, HC_TEXT, 'body text on tracks and neutral badges'],
  ['--muted', '--bg', TEXT, HC_TEXT, 'secondary text on the app background'],
  ['--muted', '--surface', TEXT, HC_TEXT, 'secondary text on cards'],
  ['--muted', '--surface-2', TEXT, HC_TEXT, 'secondary text on subtle fills'],
  // Interactive blue
  ['--on-primary', '--primary', TEXT, HC_TEXT, 'label of a filled button'],
  ['--primary-ink', '--surface', TEXT, HC_TEXT, 'text button / link on a card'],
  ['--primary-ink', '--bg', TEXT, HC_TEXT, 'text button / link on the app background'],
  ['--on-primary-container', '--primary-container', TEXT, HC_TEXT, 'selected chip, tonal button, nav pill'],
  ['--primary', '--surface', UI, HC_UI, 'switch track, slider, selected frame against a card'],
  ['--primary', '--bg', UI, HC_UI, 'the same against the app background'],
  ['--focus', '--surface', UI, HC_UI, 'focus ring'],
  ['--focus', '--bg', UI, HC_UI, 'focus ring on the app background'],
  // Component boundaries and icons
  ['--outline', '--surface', UI, HC_UI, 'text field / checkbox / segmented boundary'],
  ['--outline', '--bg', UI, HC_UI, 'the same on the app background'],
  ['--outline', '--surface-2', UI, HC_UI, 'the same on subtle fills and raised surfaces'],
  ['--icon', '--surface', UI, HC_TEXT, 'icons'],
  ['--icon', '--bg', UI, HC_TEXT, 'icons on the app background'],
  // Status: fills carry dark or white text, tints carry the -ink colour
  ['--on-danger', '--danger', TEXT, HC_TEXT, 'destructive button label'],
  ['--danger-ink', '--surface', TEXT, HC_TEXT, 'error text on a card'],
  ['--danger-ink', '--bg', TEXT, HC_TEXT, 'error text on the app background'],
  ['--danger-ink', '--danger-bg', TEXT, HC_TEXT, 'danger badge / callout icon'],
  ['--on-watch', '--watch', TEXT, HC_TEXT, 'label on an amber fill'],
  ['--watch-ink', '--watch-bg', TEXT, HC_TEXT, 'watch badge / callout icon'],
  ['--watch-ink', '--surface', TEXT, HC_TEXT, 'watch text on a card'],
  ['--on-ok', '--ok', TEXT, HC_TEXT, 'label on a green fill'],
  ['--ok-ink', '--ok-bg', TEXT, HC_TEXT, 'ok badge / callout icon'],
  ['--ok-ink', '--surface', TEXT, HC_TEXT, 'ok text on a card'],
  ['--on-info', '--info', TEXT, HC_TEXT, 'label on an info fill'],
  ['--info-ink', '--info-bg', TEXT, HC_TEXT, 'info badge / callout icon'],
  // Fire orange is a marker colour: in the design system no text sits on it (chips use --fire-bg + --fire-ink), so its high-contrast text minimum is 6.5 (6.8 today) because 7:1 and 3:1 on white cannot both hold for an orange.
  ['--on-fire', '--fire', TEXT, 6.5, 'label on a fire-orange fill'],
  ['--fire-ink', '--fire-bg', TEXT, HC_TEXT, 'fire badge'],
  ['--fire', '--surface', UI, UI, 'fire markers and bars against a card'],
  ['--violet-ink', '--violet-bg', TEXT, HC_TEXT, 'user-data origin chip'],
  // Fire-danger ratings
  ['--rating-ink', '--rating-none', TEXT, HC_TEXT, 'rating: no rating'],
  ['--rating-ink', '--rating-moderate', TEXT, HC_TEXT, 'rating: moderate'],
  ['--rating-ink', '--rating-high', TEXT, HC_TEXT, 'rating: high'],
  ['--rating-ink', '--rating-extreme', TEXT, HC_TEXT, 'rating: extreme'],
  ['--rating-ink-catastrophic', '--rating-catastrophic', TEXT, HC_TEXT, 'rating: catastrophic'],
  // Safety strip and snackbar
  ['--badge-ink', '--badge-bg', 7, 7, 'TRAINING AID strip'],
  ['--on-surface-inverse', '--surface-inverse', TEXT, HC_TEXT, 'snackbar text'],
  // Data colours must be visible against a card (graphics: 3:1)
  ['--chart-wind', '--surface', UI, HC_UI, 'wind series'],
  ['--chart-temp', '--surface', UI, HC_UI, 'temperature series'],
  ['--chart-rh', '--surface', UI, HC_UI, 'humidity series'],
  ['--chart-moist', '--surface', UI, HC_UI, 'moisture series'],
  ['--series-1', '--surface', UI, HC_UI, 'series 1'],
  ['--series-2', '--surface', UI, HC_UI, 'series 2'],
  ['--series-3', '--surface', UI, HC_UI, 'series 3'],
  ['--series-4', '--surface', UI, HC_UI, 'series 4'],
  ['--series-5', '--surface', UI, HC_UI, 'series 5'],
];

describe('tokens.css: parsing', () => {
  it('finds the four theme blocks', () => {
    expect(Object.keys(base).length).toBeGreaterThan(60);
    expect(Object.keys(dark).length).toBeGreaterThan(50);
    expect(Object.keys(hcShared).length).toBeGreaterThan(5);
    expect(Object.keys(hcLight).length).toBeGreaterThan(20);
    expect(Object.keys(hcDark).length).toBeGreaterThan(20);
  });

  it('every colour token resolves to an opaque hex colour in every mode', () => {
    for (const [mode, t] of Object.entries(MODES)) {
      for (const name of new Set(PAIRS.flatMap((p) => [p[0], p[1]]))) {
        expect(t[name], `${mode} ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('the dark block redefines every colour the light block defines (no light colour leaks into the night theme)', () => {
    const colour = (v: string): boolean => /^#|^rgba?\(/.test(v);
    // The fire-danger rating colours are data and deliberately the same in both themes.
    const lightOnly = Object.keys(base).filter((k) => colour(base[k]!) && !(k in dark) && !k.startsWith('--rating-'));
    expect(lightOnly).toEqual([]);
  });
});

for (const mode of Object.keys(MODES) as Mode[]) {
  describe(`tokens.css: contrast, ${mode}`, () => {
    const high = HIGH.includes(mode);
    for (const [fg, bg, min, hcMin, why] of PAIRS) {
      const need = high ? hcMin : min;
      it(`${fg} on ${bg} >= ${need}:1 (${why})`, () => {
        const t = MODES[mode];
        expect(contrastRatio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(need);
      });
    }
  });
}

describe('tokens.css: other rules', () => {
  it('muted text is not used on --surface-3 by the design system (checked: it is too faint in the night theme)', () => {
    // documented limit, not a pass/fail on the colours: 3.88:1 in dark. The primitives use --text on --surface-3.
    expect(contrastRatio(MODES.dark['--muted']!, MODES.dark['--surface-3']!)).toBeLessThan(4.5);
    const files = ['components.css', 'overlays.css', 'data.css'].map((f) => readFileSync(join(__dirname, '..', 'styles', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
    const re = /([^{}]+)\{([^{}]*)\}/g;
    const bad: string[] = [];
    for (const text of files) {
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (/background(-color)?:\s*var\(--surface-3\)/.test(m[2]!) && /(^|[;\s])color:\s*var\(--muted\)/.test(m[2]!)) bad.push(m[1]!.trim());
      }
    }
    expect(bad).toEqual([]);
  });

  it('the interactive blue is not used for data colours', () => {
    for (const mode of Object.keys(MODES) as Mode[]) {
      const t = MODES[mode];
      for (const k of ['--chart-wind', '--chart-temp', '--chart-rh', '--chart-moist', '--series-1', '--series-2', '--series-3', '--series-4', '--series-5']) {
        expect(t[k]!.toLowerCase(), `${mode} ${k}`).not.toBe(t['--primary']!.toLowerCase());
      }
    }
  });

  it('hit-area tokens: tap >= 44, FABs >= 40 visual, control heights follow the spec', () => {
    const scale = block(':root');
    expect(parseInt(scale['--tap']!)).toBeGreaterThanOrEqual(44);
    expect(parseInt(scale['--tap-lg']!)).toBeGreaterThanOrEqual(44);
    expect(parseInt(scale['--field-h']!)).toBeGreaterThanOrEqual(44);
    expect(parseInt(scale['--fab']!)).toBeGreaterThanOrEqual(40);
    expect(parseInt(scale['--fab']!)).toBeLessThanOrEqual(48);
    expect(parseInt(scale['--ctl-h-sm']!)).toBe(32);
    expect(parseInt(scale['--bar-h']!)).toBe(48);
    expect(parseInt(scale['--nav-h']!)).toBe(56);
    expect(parseInt(scale['--timeline-h']!)).toBe(64);
    expect(parseInt(scale['--strip-h']!)).toBeGreaterThanOrEqual(22);
    expect(parseInt(scale['--strip-h']!)).toBeLessThanOrEqual(24);
  });
});
