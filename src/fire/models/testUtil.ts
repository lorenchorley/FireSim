/**
 * Test-only helper: the spec §14 tolerance rule — half a unit of the last printed digit, or ±0.1 % for closed-form
 * functions, whichever is larger (and at least `minAbs`, e.g. ±1 m/h for ROS, ±1 kW/m for intensity).
 */
import { expect } from 'vitest';

export function expectVector(actual: number, printed: string | number, minAbs = 0, label = ''): void {
  const s = String(printed);
  const expected = Number(s);
  const dot = s.indexOf('.');
  const dec = dot < 0 ? 0 : s.length - dot - 1;
  const tol = Math.max(0.5 * 10 ** -dec, 0.001 * Math.abs(expected), minAbs);
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) expect.fail(`${label} expected ${s} ± ${tol.toPrecision(3)}, got ${actual}`);
  expect(ok).toBe(true);
}
