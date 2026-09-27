import { describe, expect, it } from 'vitest';
import { cellAt } from '../core/grid';
import { DEG } from '../core/units';
import { buildTerrain } from './analysis';
import { hillshade, multiHillshade } from './hillshade';
import { cone, plane, randomHills, testGrid } from './testing/synthetic';

const g = testGrid(2000, 20);
const k = cellAt(g, 0, 0);

describe('hillshade', () => {
  it('flat ground = sin(light elevation)', () => {
    const t = buildTerrain(g, plane(g, 0, 0), 'x');
    expect(hillshade(t)[k]).toBeCloseTo(Math.sin(45 * DEG), 6);
    expect(hillshade(t, 90, 30)[k]).toBeCloseTo(0.5, 6);
  });

  it('a slope facing the light at 90° − elevation is fully lit; facing away steeper than the light is black', () => {
    // Faces north-west (aspect 315) at 45°: its normal points at a 315°/45° light.
    const s = Math.tan(45 * DEG) * Math.SQRT1_2;
    const facing = buildTerrain(g, plane(g, s, -s), 'x'); // rises to the south-east
    expect(hillshade(facing, 315, 45)[k]).toBeCloseTo(1, 5);
    const away = buildTerrain(g, plane(g, -s * 1.5, s * 1.5), 'x'); // faces south-east at ≈ 56°
    expect(hillshade(away, 315, 30)[k]).toBe(0);
  });

  it('matches the ESRI formula cos Z cos S + sin Z sin S cos(Az − A)', () => {
    const t = buildTerrain(g, cone(g, 300, 900), 'x');
    const hs = hillshade(t, 250, 35);
    for (const kk of [cellAt(g, 300, 200), cellAt(g, -400, 100), cellAt(g, 50, -600)]) {
      const S = t.slopeDeg[kk]! * DEG;
      const A = t.aspectDeg[kk]! * DEG;
      const Z = (90 - 35) * DEG;
      const expected = Math.max(0, Math.cos(Z) * Math.cos(S) + Math.sin(Z) * Math.sin(S) * Math.cos(250 * DEG - A));
      expect(hs[kk]).toBeCloseTo(expected, 5);
    }
  });

  it('zFactor exaggerates relief', () => {
    const t = buildTerrain(g, plane(g, 0.1, 0), 'x'); // faces west
    expect(hillshade(t, 270, 45, 3)[k]!).toBeGreaterThan(hillshade(t, 270, 45, 1)[k]!);
  });
});

describe('multiHillshade', () => {
  it('flat ground = sin(30°) with default settings', () => {
    const t = buildTerrain(g, plane(g, 0, 0), 'x');
    expect(multiHillshade(t)[k]).toBeCloseTo(0.5, 6);
  });

  it('equal weighting is the mean of the single-light hillshades', () => {
    const t = buildTerrain(g, randomHills(g, 4), 'x');
    const m = multiHillshade(t, { weighting: 'equal', elevation: 40 });
    const parts = [225, 270, 315, 360].map((a) => hillshade(t, a, 40));
    for (const kk of [10, 1234, 5000, 9999]) {
      expect(m[kk]).toBeCloseTo((parts[0]![kk]! + parts[1]![kk]! + parts[2]![kk]! + parts[3]![kk]!) / 4, 5);
    }
  });

  it('aspect weighting keeps every orientation in 0–1 and favours lights aligned with the aspect', () => {
    const t = buildTerrain(g, cone(g, 400, 900), 'x');
    const m = multiHillshade(t);
    expect(Math.min(...m)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...m)).toBeLessThanOrEqual(1);
    // A west-facing slope is weighted towards the 270° light and comes out bright.
    const west = cellAt(g, -450, 0);
    expect(m[west]!).toBeGreaterThan(hillshade(t, 270, 30)[west]! * 0.8);
    // East- and west-facing flanks still differ (relief reads), but less than under a single west light.
    const east = cellAt(g, 450, 0);
    expect(m[west]!).toBeGreaterThan(m[east]!);
  });
});
