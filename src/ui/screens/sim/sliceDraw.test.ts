import { describe, expect, it } from 'vitest';
import { WIND_RAMP } from '../../../render/palette';
import { drawArrows, drawAxes, drawCells, drawGround, drawProbe, drawStreaks, fadeTrail, paintStatic, type Ctx, type DrawColours, type StaticView } from './sliceDraw';
import { fakeSlice } from './slicePanelFixtures';
import { axisTicks, makeLut, plotLayout, xOfS, yOfZ, type TickFn } from './slicePanelModel';

interface Call {
  name: string;
  args: unknown[];
}

/** A context that records every call and every property set, and answers measureText. */
function stub(): { ctx: Ctx; calls: Call[]; sets: { name: string; value: unknown }[]; count(name: string): number; numbers(): number[] } {
  const calls: Call[] = [];
  const sets: { name: string; value: unknown }[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'measureText') return (t: string) => ({ width: t.length * 6 });
        return (...args: unknown[]) => void calls.push({ name: prop, args });
      },
      set(_t, prop: string, value) {
        sets.push({ name: prop, value });
        return true;
      },
    },
  ) as unknown as Ctx;
  const count = (name: string): number => calls.filter((c) => c.name === name).length;
  // every numeric argument handed to a path, rect, arc, text or image call
  const numbers = (): number[] =>
    calls
      .filter((c) => ['moveTo', 'lineTo', 'rect', 'fillRect', 'clearRect', 'arc', 'drawImage', 'fillText', 'setLineDash'].includes(c.name))
      .flatMap((c) => c.args.flatMap((a) => (typeof a === 'number' ? [a] : Array.isArray(a) ? (a as number[]) : [])));
  return { ctx, calls, sets, count, numbers };
}

const COLOURS: DrawColours = { ink: '#202124', muted: '#5f6368', grid: 'rgba(0,0,0,.1)', surface: '#fff', outline: '#80868b', ground: '#e8eaed', groundTint: '#8a5a14' };
const FONT = { small: '400 12px system-ui', smallPx: 12 };
const ticks: TickFn = (lo, hi) => {
  const step = hi - lo > 1000 ? 500 : 250;
  const values: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) values.push(v);
  return { values, step };
};
const LUT = makeLut({ ramp: WIND_RAMP, lo: 0, hi: 25 });
const RASTER = { raster: true } as unknown as CanvasImageSource;

function view(over: Partial<StaticView> = {}): StaticView {
  const data = over.data ?? fakeSlice({ cells: true });
  const layout = over.layout ?? plotLayout({ width: 358, height: 230, length: data.line.length, zMin: data.zMin, zMax: data.zMax, exaggeration: 1, smallPx: 12 });
  const t = axisTicks(layout, ticks, 12);
  return { layout, data, field: 'speed', colours: COLOURS, font: FONT, heightTicks: t.height, distanceTicks: t.distance, raster: RASTER, lut: LUT, showCells: false, ...over };
}

const balanced = (calls: Call[]): boolean => calls.filter((c) => c.name === 'save').length === calls.filter((c) => c.name === 'restore').length;

describe('paintStatic: the still layers', () => {
  it('draws the smoothed lattice once, clipped to the plot, with the ground over it', () => {
    const s = stub();
    const v = view();
    expect(() => paintStatic(s.ctx, v)).not.toThrow();
    expect(s.count('clearRect')).toBe(1);
    expect(s.count('clip')).toBe(1);
    expect(s.count('drawImage')).toBe(1);
    expect(s.sets.filter((x) => x.name === 'imageSmoothingEnabled').map((x) => x.value)).toEqual([true]);
    // the image comes before the ground fill: the ground hides the part of the field that lies in the rock
    const order = s.calls.map((c) => c.name);
    expect(order.indexOf('drawImage')).toBeLessThan(order.indexOf('fill'));
    expect(balanced(s.calls)).toBe(true);
    for (const n of s.numbers()) expect(Number.isFinite(n)).toBe(true);
  });

  it('fills the ground twice (opaque, then the earth tone) and strokes both ground lines, the model\'s one dashed', () => {
    const s = stub();
    drawGround(s.ctx, view());
    expect(s.count('fill')).toBe(2);
    expect(s.count('stroke')).toBe(2);
    const dash = s.calls.filter((c) => c.name === 'setLineDash').map((c) => c.args[0]);
    expect(dash).toEqual([[5, 4], []]);
    // one point per column in each line: columns - 1 lineTo for the 10 m line, and the same for the model's
    expect(s.count('lineTo')).toBe(24 + 1 + 23 + 23);
  });

  it('draws the model\'s own cells, one block per cell and level, in place of the smoothed image', () => {
    const s = stub();
    const v = view({ showCells: true });
    paintStatic(s.ctx, v);
    expect(s.count('drawImage')).toBe(0);
    expect(s.count('fillRect')).toBe(v.data.cells!.count * v.data.cells!.levels);
    expect(s.count('rect') - 1).toBe(v.data.cells!.count * v.data.cells!.levels); // the plot's own clip rectangle is the other one
    for (const n of s.numbers()) expect(Number.isFinite(n)).toBe(true);
  });

  it('colours each cell by its own native value, from the same LUT as the raster', () => {
    const s = stub();
    const v = view({ showCells: true });
    drawCells(s.ctx, v);
    const fills = s.sets.filter((x) => x.name === 'fillStyle').map((x) => x.value as string);
    expect(fills).toHaveLength(30);
    for (const f of fills) expect(LUT.styles).toContain(f);
    // the first column's lowest cell: speed value 2 on a 0 to 25 scale
    expect(fills[0]).toBe(LUT.styles[Math.round((2 / 25) * 255)]);
    // an adjacent level is a higher value: a different colour
    expect(fills[1]).not.toBe(fills[0]);
  });

  it('falls back to the lattice, without smoothing, when the line crosses no model cell', () => {
    const s = stub();
    paintStatic(s.ctx, view({ data: fakeSlice({ cells: false }), showCells: true }));
    expect(s.count('drawImage')).toBe(1);
    expect(s.sets.filter((x) => x.name === 'imageSmoothingEnabled').map((x) => x.value)).toEqual([false]);
  });

  it('draws nothing of the field before the first image exists, and does not throw', () => {
    const s = stub();
    expect(() => paintStatic(s.ctx, view({ raster: null }))).not.toThrow();
    expect(s.count('drawImage')).toBe(0);
    expect(s.count('fill')).toBe(2); // the ground is there
  });

  it('survives a ground column that is not a number, and a model ground that is not', () => {
    const s = stub();
    const d = fakeSlice();
    d.ground[3] = NaN;
    d.modelGround.fill(NaN);
    paintStatic(s.ctx, view({ data: d }));
    for (const n of s.numbers()) expect(Number.isFinite(n)).toBe(true);
    expect(s.calls.filter((c) => c.name === 'setLineDash')).toHaveLength(0); // no model line to dash
  });

  it('labels the axes: every height and distance tick, and the letters A and B', () => {
    const s = stub();
    const v = view();
    drawAxes(s.ctx, v);
    const texts = s.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(texts).toEqual([...v.heightTicks.map((t) => t.label), ...v.distanceTicks.map((t) => t.label), 'A', 'B']);
    expect(v.heightTicks.length).toBeGreaterThan(0);
    // A is at the left end, B at the right end of the distance axis
    const at = (label: string): number => s.calls.find((c) => c.name === 'fillText' && c.args[0] === label)!.args[1] as number;
    expect(at('A')).toBeCloseTo(v.layout.plot.x, 9);
    expect(at('B')).toBeCloseTo(v.layout.plot.x + v.layout.plot.w, 9);
  });

  it('keeps every coordinate a number at other canvas sizes and exaggerations', () => {
    for (const [w, h, ex] of [
      [280, 104, 1],
      [388, 96, 3],
      [800, 600, 2],
      [20, 20, 1],
    ] as const) {
      const d = fakeSlice({ cells: true });
      const layout = plotLayout({ width: w, height: h, length: d.line.length, zMin: d.zMin, zMax: d.zMax, exaggeration: ex, smallPx: 12 });
      for (const showCells of [false, true]) {
        const s = stub();
        expect(() => paintStatic(s.ctx, view({ data: d, layout, showCells }))).not.toThrow();
        for (const n of s.numbers()) expect(Number.isFinite(n)).toBe(true);
      }
    }
  });
});

describe('streaks', () => {
  const l = plotLayout({ width: 358, height: 230, length: 3000, zMin: 350, zMax: 2500, exaggeration: 1, smallPx: 12 });

  function particles(n: number): { count: number; s: Float32Array; z: Float32Array; ps: Float32Array; pz: Float32Array } {
    const f = { count: n, s: new Float32Array(n), z: new Float32Array(n), ps: new Float32Array(n), pz: new Float32Array(n) };
    for (let i = 0; i < n; i++) {
      f.ps[i] = (i / n) * 3000;
      f.s[i] = f.ps[i]! + 20;
      f.pz[i] = 800 + (i % 7) * 100;
      f.z[i] = f.pz[i]! + 2;
    }
    return f;
  }

  it('draws one segment per particle, from where it was to where it is, in two strokes (halo, then ink)', () => {
    const s = stub();
    const f = particles(300);
    expect(drawStreaks(s.ctx, l, f, COLOURS)).toBe(300);
    expect(s.count('moveTo')).toBe(300);
    expect(s.count('lineTo')).toBe(300);
    expect(s.count('stroke')).toBe(2);
    const first = s.calls.find((c) => c.name === 'moveTo' && s.calls.indexOf(c) > 0)!;
    expect(first.args[0]).toBeCloseTo(xOfS(l, f.ps[0]!), 9);
    expect(first.args[1]).toBeCloseTo(yOfZ(l, f.pz[0]!), 9);
    expect(balanced(s.calls)).toBe(true);
  });

  it('skips a particle with no position and one that was just re-seeded across the plot', () => {
    const s = stub();
    const f = particles(10);
    f.s[2] = NaN;
    f.pz[4] = Infinity;
    f.ps[6] = 2900; // jumped from the far end
    f.s[6] = 100;
    expect(drawStreaks(s.ctx, l, f, COLOURS)).toBe(7);
    for (const n of s.numbers()) expect(Number.isFinite(n)).toBe(true);
  });

  it('fades the trail buffer by painting over it with destination-out, then puts the state back', () => {
    const s = stub();
    fadeTrail(s.ctx, 358, 230, 0.2);
    expect(s.sets.map((x) => [x.name, x.value])).toContainEqual(['globalCompositeOperation', 'destination-out']);
    expect(s.sets.map((x) => [x.name, x.value])).toContainEqual(['globalAlpha', 0.2]);
    expect(s.calls.find((c) => c.name === 'fillRect')!.args).toEqual([0, 0, 358, 230]);
    expect(balanced(s.calls)).toBe(true);
  });
});

describe('arrows (reduced motion)', () => {
  const l = plotLayout({ width: 358, height: 230, length: 3000, zMin: 350, zMax: 2500, exaggeration: 1, smallPx: 12 });

  it('draws a shaft and two head strokes per arrow, pointing along its angle on screen', () => {
    const s = stub();
    const a = { count: 2, s: [500, 1500], z: [900, 1200], angle: [0, Math.PI / 2], speed: [5, 12] };
    expect(drawArrows(s.ctx, l, a, COLOURS)).toBe(2);
    expect(s.count('stroke')).toBe(2);
    expect(s.count('moveTo')).toBe(2 * 3);
    expect(s.count('lineTo')).toBe(2 * 3);
    // the first arrow points along +s: its tip is to the right of its centre, at the same height
    const cx = xOfS(l, 500);
    const cy = yOfZ(l, 900);
    const moves = s.calls.filter((c) => c.name === 'moveTo');
    const lines = s.calls.filter((c) => c.name === 'lineTo');
    expect(moves[0]!.args[0] as number).toBeLessThan(cx);
    expect(lines[0]!.args[0] as number).toBeGreaterThan(cx);
    expect(lines[0]!.args[1] as number).toBeCloseTo(cy, 9);
    // the second points up: the tip has a smaller pixel y than the centre
    expect(lines[3]!.args[1] as number).toBeLessThan(yOfZ(l, 1200));
    expect(lines[3]!.args[0] as number).toBeCloseTo(xOfS(l, 1500), 6);
    for (const n of s.numbers()) expect(Number.isFinite(n)).toBe(true);
  });

  it('a stronger wind draws a longer arrow, up to 18 px, and one with no angle is left out', () => {
    const len = (speed: number): number => {
      const s = stub();
      drawArrows(s.ctx, l, { count: 1, s: [1500], z: [1200], angle: [0], speed: [speed] }, COLOURS);
      const m = s.calls.filter((c) => c.name === 'moveTo')[0]!.args[0] as number;
      const t = s.calls.filter((c) => c.name === 'lineTo')[0]!.args[0] as number;
      return t - m;
    };
    expect(len(0)).toBeCloseTo(10, 6);
    expect(len(30)).toBeCloseTo(18, 6);
    expect(len(8)).toBeGreaterThan(len(2));
    const s = stub();
    expect(drawArrows(s.ctx, l, { count: 2, s: [100, 200], z: [900, 900], angle: [NaN, 0], speed: [1, 1] }, COLOURS)).toBe(1);
    expect(balanced(s.calls)).toBe(true);
  });
});

describe('probe', () => {
  const l = plotLayout({ width: 358, height: 230, length: 3000, zMin: 350, zMax: 2500, exaggeration: 1, smallPx: 12 });

  it('draws a ring at the pixel of the position, dotted guides to both axes, and puts the dash back', () => {
    const s = stub();
    expect(drawProbe(s.ctx, l, { s: 1200, z: 900 }, COLOURS)).toBe(true);
    const arc = s.calls.find((c) => c.name === 'arc')!;
    expect(arc.args[0]).toBeCloseTo(xOfS(l, 1200), 9);
    expect(arc.args[1]).toBeCloseTo(yOfZ(l, 900), 9);
    expect(s.calls.filter((c) => c.name === 'setLineDash').map((c) => c.args[0])).toEqual([[3, 3], []]);
    expect(balanced(s.calls)).toBe(true);
    for (const n of s.numbers()) expect(Number.isFinite(n)).toBe(true);
  });

  it('draws nothing for a position that is not a number', () => {
    const s = stub();
    expect(drawProbe(s.ctx, l, { s: NaN, z: 900 }, COLOURS)).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
});
