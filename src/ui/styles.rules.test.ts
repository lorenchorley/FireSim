/**
 * Guard rails for the field-UI rules of the stylesheets (no DOM needed: the CSS is read as text). A firefighter uses the
 * phone with wet hands in sunlight, so: no literal text size under 14 px (the 12 px caption size only exists as the
 * --fs-xs token), every tap target at least 44 px, and the numbers the layout code uses (DOCK_H, GRIP_H) must stay in step
 * with the CSS that draws the same rows. The design-system files (base, components, overlays, data) additionally stay flat:
 * no gradients (bar the slider track), no shadows except through the --elev tokens, no uppercase or weights above 500 outside
 * the few sanctioned places. Docs: docs/DESIGN.md.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCK_H, GRIP_H } from './screens/sim/layoutModel';

const DIR = join(__dirname, '..', 'styles');
const files = readdirSync(DIR).filter((f) => f.endsWith('.css'));
const css = (name: string): string => readFileSync(join(DIR, name), 'utf8');
const all = files.map((f) => ({ f, text: css(f) }));

/** The declarations of the first rule whose selector list contains exactly `selector` (comments removed). */
function rule(name: string, selector: string): string {
  const text = css(name).replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]*)\{([^{}]*)\}/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1]!.split(',').some((s) => s.trim() === selector)) return m[2]!;
  }
  throw new Error(`no rule for ${selector} in ${name}`);
}
const px = (decls: string, prop: string): number => {
  const m = new RegExp(`(?:^|[;\\s])${prop}:\\s*([0-9.]+)px`).exec(decls);
  if (!m) throw new Error(`no ${prop} in px in: ${decls}`);
  return Number(m[1]);
};

describe('stylesheets: text size', () => {
  it('no font-size below 14 px anywhere except the start-up diagnostics dump', () => {
    const small: string[] = [];
    for (const { f, text } of all) {
      const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
      const re = /([^{}]*)\{([^{}]*)\}/g;
      for (let m = re.exec(clean); m; m = re.exec(clean)) {
        const size = /font-size:\s*([0-9.]+)px/.exec(m[2]!);
        if (size && Number(size[1]) < 14 && !m[1]!.includes('.boot-details')) small.push(`${f}: ${m[1]!.trim()} { font-size: ${size[1]}px }`);
      }
    }
    expect(small).toEqual([]);
  });

  it('the dock tabs (primary navigation for the cards) are 16 px', () => {
    expect(px(rule('sim.css', '.sheet-tab'), 'font-size')).toBeGreaterThanOrEqual(16);
  });
});

/** Every rule of the design-system files: [file, selector list, declarations]. */
const DS_FILES = ['base.css', 'components.css', 'overlays.css', 'data.css'];
function dsRules(): { f: string; sel: string; body: string }[] {
  const out: { f: string; sel: string; body: string }[] = [];
  for (const f of DS_FILES) {
    const clean = css(f).replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^{}]*)\}/g;
    for (let m = re.exec(clean); m; m = re.exec(clean)) out.push({ f, sel: m[1]!.replace(/\s+/g, ' ').trim(), body: m[2]! });
  }
  return out;
}

describe('stylesheets: type scale tokens', () => {
  const tokens = (): string => css('tokens.css');
  const tokenPx = (name: string, from: string): number => Number(new RegExp(`${name}:\\s*([0-9.]+)px`).exec(from)![1]);

  it('sizes are 12 / 14 / 16 / 20 / 24 and the caption size is never below 12', () => {
    const scale = tokens().slice(tokens().lastIndexOf('/* ───────────────────────────── Scales'));
    expect([tokenPx('--fs-xs', scale), tokenPx('--fs-sm', scale), tokenPx('--fs-md', scale), tokenPx('--fs-lg', scale), tokenPx('--fs-xl', scale)]).toEqual([12, 14, 16, 20, 24]);
  });

  it('high contrast adds 1 px to every size', () => {
    const t = tokens();
    const hc = t.slice(t.indexOf(":root[data-contrast='high'] {"));
    const scale = t.slice(t.lastIndexOf('/* ───────────────────────────── Scales'));
    for (const n of ['--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl']) expect(tokenPx(n, hc)).toBe(tokenPx(n, scale) + 1);
  });
});

describe('stylesheets: the flat design system', () => {
  it('no gradients except the two-colour slider track', () => {
    const bad = dsRules().filter((r) => /gradient\(/.test(r.body) && !r.sel.includes('slider-runnable-track'));
    expect(bad.map((r) => `${r.f}: ${r.sel}`)).toEqual([]);
  });

  it('shadows come only from the elevation tokens (or a 1 px ring / inset used as a border)', () => {
    const bad = dsRules().filter((r) => {
      const m = /box-shadow:\s*([^;]+)/.exec(r.body);
      if (!m) return false;
      const v = m[1]!.trim();
      if (v === 'none' || /^var\(--elev-[1-4]\)/.test(v)) return false;
      return !/^(inset\s+)?0 0 0 (\d+px|var\(--[a-z-]+\))/.test(v) && !/^(inset\s+)?0 -?\d+px 0 (var|\d)/.test(v) && !/^var\(--elev/.test(v) && !/^0 0 0 2px var\(--surface\)/.test(v) && !/^inset 0/.test(v);
    });
    expect(bad.map((r) => `${r.f}: ${r.sel} { ${/box-shadow:[^;]+/.exec(r.body)![0]} }`)).toEqual([]);
  });

  it('uppercase only on the safety strip and explicit caps badges', () => {
    const bad = dsRules().filter((r) => /text-transform:\s*uppercase/.test(r.body) && !/\.training-badge|\.badge-caps/.test(r.sel));
    expect(bad.map((r) => r.sel)).toEqual([]);
  });

  it('weights above 500 only for the sanctioned bold numbers and ratings', () => {
    const ok = /\.rating-pill|\.t-display|\.stat-lg|\.rose-label\.major|\.training-badge|\.spinner/;
    const bad = dsRules().filter((r) => /font-weight:\s*(var\(--fw-bold\)|[6-9]00)/.test(r.body) && !ok.test(r.sel));
    expect(bad.map((r) => `${r.f}: ${r.sel}`)).toEqual([]);
  });

  it('every interactive primitive grows its hit area to the tap size', () => {
    const all = (css('components.css') + css('overlays.css')).replace(/\/\*[\s\S]*?\*\//g, '');
    const grower = [...all.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => /width:\s*max\(100%,\s*var\(--tap\)\)/.test(m[2]!));
    expect(grower).toBeTruthy();
    for (const s of ['.btn::after', '.icon-btn::after', '.fab::after', 'button.chip::after']) expect(grower![1]).toContain(s);
    // Segments, list rows, toggles, checkboxes, tiles, nav items and the stepper are tap-sized by their own min-height / width.
    expect(rule('components.css', '.segmented-face')).toContain('min-height: var(--tap)');
    expect(rule('components.css', '.stepper-btn')).toContain('width: var(--tap)');
    expect(rule('components.css', '.check')).toContain('min-height: var(--tap)');
    expect(rule('overlays.css', '.tile')).toContain('min-height: var(--tap)');
    expect(rule('overlays.css', '.nav-item')).toContain('min-height: var(--nav-h)');
    expect(rule('overlays.css', '.snackbar-action')).toContain('min-height: var(--tap)');
  });
});

describe('stylesheets: tap targets', () => {
  it('the tap size tokens are at least 44 px', () => {
    const tokens = css('tokens.css');
    expect(Number(/--tap:\s*([0-9]+)px/.exec(tokens)![1])).toBeGreaterThanOrEqual(44);
    expect(Number(/--tap-lg:\s*([0-9]+)px/.exec(tokens)![1])).toBeGreaterThanOrEqual(44);
    expect(Number(/--fab:\s*([0-9]+)px/.exec(tokens)![1])).toBeGreaterThanOrEqual(44);
    expect(Number(/--field-h:\s*([0-9]+)px/.exec(tokens)![1])).toBeGreaterThanOrEqual(44);
  });

  it('the dock row is DOCK_H tall: 44 px tabs under the 2 px border', () => {
    const tokens = css('tokens.css');
    expect(Number(/--dock-h:\s*([0-9]+)px/.exec(tokens)![1])).toBe(DOCK_H);
    expect(DOCK_H - 2).toBeGreaterThanOrEqual(44);
    expect(px(rule('sim.css', '.sheet-tab'), 'min-width')).toBeGreaterThanOrEqual(44);
  });

  it('the panel grip strip is GRIP_H tall and at least 44 px', () => {
    expect(px(rule('sim.css', '.sheet-head'), 'height')).toBe(GRIP_H);
    expect(GRIP_H).toBeGreaterThanOrEqual(44);
  });

  it('the timeline step buttons and the popover controls are at least 44 px', () => {
    const step = rule('transport.css', '.tl-step');
    expect(px(step, 'width')).toBeGreaterThanOrEqual(44);
    expect(px(step, 'height')).toBeGreaterThanOrEqual(44);
    expect(px(rule('transport.css', '.tp-chip'), 'min-height')).toBeGreaterThanOrEqual(44);
    expect(px(rule('transport.css', '.tp-seg'), 'height')).toBeGreaterThanOrEqual(44);
    expect(px(rule('transport.css', '.tb-menu-item'), 'min-height')).toBeGreaterThanOrEqual(44);
  });

  it('the fast-forward Cancel button has a touch area of at least 44 px even against the screen edge (36 px + its reach upwards)', () => {
    const cancel = px(rule('transport.css', '.tl-cancel'), 'height');
    const border = 2; // the ::before inset starts inside the button's 2 px border
    const reach = /\.tl-cancel::before\s*\{[^}]*inset:\s*(-?[0-9]+)px\s+-?[0-9]+px\s+(-?[0-9]+)px/.exec(css('transport.css'));
    expect(reach).not.toBeNull();
    const up = Math.abs(Number(reach![1])) - border;
    const down = Math.abs(Number(reach![2])) - border;
    expect(cancel + up).toBeGreaterThanOrEqual(44); // no bottom inset (3-button navigation): the screen edge clips the reach downwards
    expect(cancel + up + down).toBeGreaterThanOrEqual(44);
  });
});
