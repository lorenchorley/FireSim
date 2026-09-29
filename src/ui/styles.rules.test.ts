/**
 * Guard rails for the field-UI rules of the stylesheets (no DOM needed: the CSS is read as text). A firefighter uses the
 * phone with wet hands in sunlight, so: no text under 14 px, every tap target at least 44 px, and the numbers the layout
 * code uses (DOCK_H, GRIP_H) must stay in step with the CSS that draws the same rows.
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

describe('stylesheets: tap targets', () => {
  it('the tap size tokens are at least 44 px', () => {
    const tokens = css('tokens.css');
    expect(Number(/--tap:\s*([0-9]+)px/.exec(tokens)![1])).toBeGreaterThanOrEqual(44);
    expect(Number(/--tap-lg:\s*([0-9]+)px/.exec(tokens)![1])).toBeGreaterThanOrEqual(44);
    expect(Number(/--fab:\s*([0-9]+)px/.exec(tokens)![1])).toBeGreaterThanOrEqual(44);
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
