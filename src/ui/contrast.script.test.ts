/**
 * Runs scripts/check-contrast.mjs (`npm run check:contrast`) so a token or CSS edit that breaks WCAG contrast fails the unit tests.
 * The script checks the curated token pairs AND every rule of every stylesheet (design system and screens) that sets both a text and a
 * background colour, in the four looks (light, dark, high-contrast light and dark). See the header of the script for the thresholds.
 * tokens.contrast.test.ts is the older token-pair table; this one also covers the CSS itself.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

const script = join(__dirname, '..', '..', 'scripts', 'check-contrast.mjs');

interface Report {
  failures: string[];
  literals: { file: string; sel: string; prop: string; value: string }[];
  worst: Record<string, { ratio: number }>;
  checked: number;
}

function run(args: string[]): { report: Report; status: number } {
  try {
    const out = execFileSync(process.execPath, [script, '--json', ...args], { encoding: 'utf8' });
    return { report: JSON.parse(out) as Report, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { report: JSON.parse(err.stdout ?? '{}') as Report, status: err.status ?? 1 };
  }
}

describe('scripts/check-contrast.mjs', () => {
  const { report, status } = run([]);

  it('every design-system colour pair meets WCAG in light, dark and both high-contrast looks', () => {
    expect(report.failures).toEqual([]);
    expect(status).toBe(0);
  });

  it('actually checked something (a silent parser failure must not pass)', () => {
    expect(report.checked).toBeGreaterThan(600);
    for (const mode of ['light', 'dark', 'high-light', 'high-dark']) {
      expect(report.worst[`${mode}/text`]?.ratio, `${mode} text`).toBeGreaterThanOrEqual(mode.startsWith('high') ? 6.5 : 4.5);
      expect(report.worst[`${mode}/ui`]?.ratio, `${mode} ui`).toBeGreaterThanOrEqual(3);
      expect(report.worst[`${mode}/strip`]?.ratio, `${mode} strip`).toBeGreaterThanOrEqual(7);
    }
  });

  it('the design-system CSS has no hard-coded colour (they cannot follow the theme)', () => {
    expect(report.literals).toEqual([]);
  });

  it('agrees with src/ui/contrast.ts (the style guide table) and with the WCAG reference values', async () => {
    const path = '../../scripts/check-contrast.mjs';
    const m = (await import(/* @vite-ignore */ path)) as { contrast: (a: string, b: string) => number };
    expect(m.contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(m.contrast('#767676', '#ffffff')).toBeGreaterThan(4.5); // the classic 4.54:1 grey
    expect(m.contrast('#777777', '#ffffff')).toBeLessThan(4.5);
    for (const [a, b] of [['#1a73e8', '#ffffff'], ['#5f6368', '#f1f3f4'], ['#aab0b6', '#3c4043'], ['#fbbc04', '#3c2e00']] as const) {
      expect(m.contrast(a, b)).toBeCloseTo(contrastRatio(a, b), 9);
    }
  });
});
