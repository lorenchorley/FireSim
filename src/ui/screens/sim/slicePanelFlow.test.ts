/**
 * The panel's streaks and arrows against the real flow module: whatever the height axis is stretched to, a streak points the
 * way the picture shows the flow, so a wind that runs parallel to the ground runs parallel to the DRAWN ground (§8.5).
 * Both go through the panel's own layout (slicePanelModel.ts), so a change to how the exaggeration is applied shows up here.
 */
import { describe, expect, it } from 'vitest';
import { createFlow, flowArrows, seedFlow, stepFlow } from '../../../render/slice/flow2d';
import { makeSliceData } from '../../../render/slice/testing';
import { drawStreaks, type Ctx, type DrawColours } from './sliceDraw';
import { flowCount, flowTimeScale, plotLayout, streakExaggeration, xOfS, yOfZ, FLOW_COUNT, FLOW_LIFE_S } from './slicePanelModel';

const SLOPE = 0.2; // the ground rises 20 m in 100 m
const U = 10; // m/s along the line
/** Air that runs parallel to the ground everywhere: up = along x slope. */
const data = makeSliceData({ a: [0, 0], b: [3000, 0], zMin: 300, zMax: 2000, columns: 60, rows: 40, ground: (s) => 400 + SLOPE * s, wind: () => [U, 0, U * SLOPE] });

const layoutAt = (exaggeration: number) => plotLayout({ width: 358, height: 230, length: data.line.length, zMin: data.zMin, zMax: data.zMax, exaggeration, smallPx: 12 });
const groundAt = (s: number): number => 400 + SLOPE * s;

/** Screen slope (px of y per px of x, y down) of every streak that moved, against that of the drawn ground under it. */
function slopes(exaggeration: number, flowEx: (ratio: number) => number): { streak: number; ground: number }[] {
  const l = layoutAt(exaggeration);
  const f = createFlow(120, 7);
  seedFlow(f, data);
  stepFlow(f, data, 0.4, { exaggeration: flowEx(l.ratio), timeScale: 1, maxAgeS: 1e9 });
  const out: { streak: number; ground: number }[] = [];
  for (let i = 0; i < f.count; i++) {
    const ds = f.s[i]! - f.ps[i]!;
    if (Math.abs(ds - U * 0.4) > 1e-3) continue; // re-seeded this step: it did not move through the flow
    const dx = xOfS(l, f.s[i]!) - xOfS(l, f.ps[i]!);
    out.push({ streak: (yOfZ(l, f.z[i]!) - yOfZ(l, f.pz[i]!)) / dx, ground: (yOfZ(l, groundAt(f.s[i]!)) - yOfZ(l, groundAt(f.ps[i]!))) / dx });
  }
  return out;
}

describe('streaks follow the drawn ground at every exaggeration', () => {
  for (const ex of [1, 2, 3]) {
    it(`slider x${ex}: the streak runs parallel to the drawn ground`, () => {
      const l = layoutAt(ex);
      const s = slopes(ex, () => streakExaggeration(l));
      expect(s.length).toBeGreaterThan(40);
      // (particle positions are 32-bit floats: a step of a few metres is good to about 1e-4 of itself)
      for (const p of s) expect(p.streak).toBeCloseTo(p.ground, 3);
      // and the picture really is stretched by what the layout says: the drawn ground is steeper than the real one by the ratio
      expect(s[0]!.ground).toBeCloseTo(-SLOPE * l.ratio, 6);
    });
  }

  it('giving stepFlow the on-screen ratio as well would count it twice: the streak would climb steeper than the ground by that ratio', () => {
    const l = layoutAt(3);
    expect(l.ratio).toBeGreaterThan(1.1); // the box shortens a x3 stretch, but it is still a stretch
    const twice = slopes(3, (r) => r);
    for (const p of twice) expect(p.streak / p.ground).toBeCloseTo(l.ratio, 3);
  });

  it('the static arrows, which take the ratio, point along the drawn ground too', () => {
    for (const ex of [1, 3]) {
      const l = layoutAt(ex);
      const a = flowArrows(data, 6, 4, l.ratio);
      expect(a.count).toBeGreaterThan(5);
      for (let i = 0; i < a.count; i++) {
        // screen angle anticlockwise from +s; the ground rises SLOPE x ratio per unit of distance on screen
        expect(Math.tan(a.angle[i]!)).toBeCloseTo(SLOPE * l.ratio, 5);
      }
    }
  });
});

describe('pace', () => {
  it('a particle in a 10 m/s wind crosses the 3 km slice in about 8 s of the panel clock, and lives a little less than that long', () => {
    const level = makeSliceData({ a: [0, 0], b: [3000, 0], zMin: 300, zMax: 2000, columns: 60, rows: 40, ground: () => 400, wind: () => [U, 0, 0] });
    const f = createFlow(1, 3);
    seedFlow(f, level);
    f.s[0] = 100;
    f.z[0] = 1500;
    f.pz[0] = 1500;
    f.age[0] = 0;
    let t = 0;
    while (f.s[0]! < 2900 && t < 30) {
      stepFlow(f, level, 1 / 24, { exaggeration: streakExaggeration(layoutAt(1)), timeScale: flowTimeScale(level.line.length), maxAgeS: FLOW_LIFE_S });
      t += 1 / 24;
      if (f.ps[0]! > f.s[0]!) break; // re-seeded
    }
    // 2800 m at 10 m/s of air time, 37.5 air seconds per panel second: about 7.5 s
    expect(t).toBeGreaterThan(6.5);
    expect(t).toBeLessThan(8.5);
    expect(FLOW_LIFE_S).toBeGreaterThan(t); // it is not re-seeded before it gets across
  });
});

describe('the doubled streaks (0.6.0)', () => {
  const COLOURS: DrawColours = { ink: '#202124', muted: '#5f6368', grid: 'rgba(0,0,0,.1)', surface: '#fff', outline: '#80868b', ground: '#e8eaed', groundTint: '#8a5a14' };
  /** A context that takes every call and draws nothing: what is timed is the panel's own work per frame, not the browser's rasteriser. */
  const noop = new Proxy({}, { get: () => () => undefined, set: () => true }) as unknown as Ctx;

  it('are 600 on a plot big enough for the most, and every frame of a long run draws a segment for almost every one (the few re-seeded in a step are left out)', () => {
    const l = plotLayout({ width: 460, height: 330, length: data.line.length, zMin: data.zMin, zMax: data.zMax, exaggeration: 1, smallPx: 12 });
    expect(flowCount(l)).toBe(FLOW_COUNT); // a plot this big carries the most
    expect(FLOW_COUNT).toBe(600);
    const f = createFlow(flowCount(l), 1);
    seedFlow(f, data);
    let drawn = 0;
    let moved = 0;
    for (let i = 0; i < 100; i++) {
      stepFlow(f, data, 1 / 24, { exaggeration: streakExaggeration(l), timeScale: flowTimeScale(data.line.length), maxAgeS: FLOW_LIFE_S });
      drawn += drawStreaks(noop, l, f, COLOURS);
      moved += f.count;
    }
    expect(drawn).toBeGreaterThan(0.95 * moved);
    expect(drawn).toBeLessThanOrEqual(moved);
  });

  it('cost a small part of a frame: stepFlow and drawStreaks for the most particles, in the 41 ms between two streak frames', () => {
    const l = plotLayout({ width: 460, height: 330, length: data.line.length, zMin: data.zMin, zMax: data.zMax, exaggeration: 1, smallPx: 12 });
    const f = createFlow(flowCount(l), 3);
    seedFlow(f, data);
    const opts = { exaggeration: streakExaggeration(l), timeScale: flowTimeScale(data.line.length), maxAgeS: FLOW_LIFE_S };
    const frame = (): void => {
      stepFlow(f, data, 1 / 24, opts);
      drawStreaks(noop, l, f, COLOURS);
    };
    for (let i = 0; i < 200; i++) frame(); // (warm-up)
    const ms: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t0 = performance.now();
      frame();
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const p50 = ms[150]!;
    const p95 = ms[285]!;
    process.stderr.write(`[slice perf] ${f.count} streaks, stepFlow plus drawStreaks (no-op context): median ${p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms per frame\n`);
    expect(p50).toBeLessThan(4); // (a tenth of the 41 ms between frames: the work measures about 0.14 ms on the build machine, and a busy one has room)
  });
});
