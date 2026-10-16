import { describe, expect, it } from 'vitest';
import { AIR_STALE_S } from '../../../core/airView';
import { WIND_RAMP } from '../../../render/palette';
import type { SliceFieldStatus, SliceRecordingStatus } from '../../../render/slice/types';
import type { ExternalLegend } from '../../legends';
import { fakeSlice, fakeUpdate } from './slicePanelFixtures';
import {
  airFromText,
  arrowGrid,
  axisTicks,
  canvasLabel,
  cellsNote,
  chipModel,
  disabledNotes,
  emptyState,
  flowCount,
  flowSlice,
  flowTick,
  flowTimeScale,
  footerCacheKey,
  footerParts,
  footerRuns,
  footerText,
  legendView,
  lutIndex,
  makeLut,
  naturalBoxHeight,
  pickPos,
  plotLayout,
  rasterBox,
  rasterize,
  recordingLine,
  sameFlowSlice,
  scaleCaption,
  scaleTag,
  showsScaleTag,
  sOfX,
  splitKindLabel,
  spreadLabels,
  xOfS,
  yOfZ,
  zOfY,
  type FlowClock,
  type LayoutInput,
  type TickFn,
} from './slicePanelModel';

const BASE: LayoutInput = { width: 358, height: 230, length: 3000, zMin: 350, zMax: 2500, exaggeration: 1, smallPx: 12 };

/** A stand-in for niceTicks (src/render/slice/niceTicks.ts): the multiples of a 1-2-5 step inside the range. */
const ticks: TickFn = (lo, hi, target = 5) => {
  const raw = (hi - lo) / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * p >= raw) ?? 10) * p;
  const values: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) values.push(v);
  return { values, step };
};

describe('plotLayout', () => {
  it('always holds the whole line across the width and keeps the plot inside the canvas', () => {
    const l = plotLayout(BASE);
    expect(l.plot.x).toBeGreaterThanOrEqual(40);
    expect(l.plot.x + l.plot.w).toBeLessThanOrEqual(BASE.width);
    expect(l.plot.y).toBeGreaterThanOrEqual(0);
    expect(l.plot.y + l.plot.h).toBeLessThan(BASE.height);
    expect(xOfS(l, 0)).toBeCloseTo(l.plot.x, 9);
    expect(xOfS(l, 3000)).toBeCloseTo(l.plot.x + l.plot.w, 9);
  });

  it('draws the height at the true ratio times the slider where it fits, anchored on the distance axis', () => {
    const l = plotLayout({ ...BASE, length: 12000, zMax: 1000, exaggeration: 1 });
    expect(l.fitted).toBe(false);
    expect(l.ratio).toBeCloseTo(1, 9);
    const l2 = plotLayout({ ...BASE, length: 12000, zMax: 1000, exaggeration: 2 });
    expect(l2.fitted).toBe(false);
    expect(l2.ratio).toBeCloseTo(2, 9);
    // the slice is shorter than the box: the room is left above it, the bottom edge does not move
    expect(l2.plot.h).toBeLessThan(plotLayout({ ...BASE, exaggeration: 3 }).plot.h);
    expect(l.plot.y + l.plot.h).toBeCloseTo(plotLayout(BASE).plot.y + plotLayout(BASE).plot.h, 9);
  });

  it('fits the box when the asked-for height would not, and the ratio says what is really drawn', () => {
    const l = plotLayout({ ...BASE, length: 6000, zMax: 2500, exaggeration: 3 });
    expect(l.fitted).toBe(true);
    expect(l.ratio).toBeLessThan(3);
    expect(l.ratio).toBeCloseTo(l.pxPerMZ / l.pxPerM, 12);
    // the whole box is used: the canvas height less the top margin and the distance axis (8 + 24 px at a 12 px text size)
    expect(l.plot.h).toBeCloseTo(BASE.height - 8 - 24, 6);
    expect(yOfZ(l, l.zMax)).toBeCloseTo(l.plot.y, 6);
    expect(yOfZ(l, l.zMin)).toBeCloseTo(l.plot.y + l.plot.h, 6);
  });

  it('a short line in a tall range is squashed below true scale (ratio under 1) and says so', () => {
    const l = plotLayout({ ...BASE, length: 1000, zMax: 2500, exaggeration: 1 });
    expect(l.fitted).toBe(true);
    expect(l.ratio).toBeLessThan(1);
    expect(scaleCaption(l.ratio)).toMatch(/squashed to about 0\.\d of true scale/);
  });

  it('clamps the slider to 1 to 3 and survives numbers that are not numbers', () => {
    expect(plotLayout({ ...BASE, length: 12000, zMax: 1000, exaggeration: 9 }).ratio).toBeCloseTo(3, 9);
    expect(plotLayout({ ...BASE, length: 12000, zMax: 1000, exaggeration: 0 }).ratio).toBeCloseTo(1, 9);
    const l = plotLayout({ width: NaN, height: Infinity, length: NaN, zMin: NaN, zMax: NaN, exaggeration: NaN, smallPx: NaN });
    for (const v of [l.width, l.height, l.plot.x, l.plot.y, l.plot.w, l.plot.h, l.pxPerM, l.pxPerMZ, l.ratio, l.length, l.zMin, l.zMax]) expect(Number.isFinite(v)).toBe(true);
  });

  it('wants a canvas no taller than its picture: no empty band above a long or low slice at true scale', () => {
    const { height: _h, ...input } = BASE;
    // a 6 km line over a 2 150 m range at true scale is 330 px wide, so about 118 px tall, not the 230 px box
    const six = { ...input, length: 6000, zMax: 2500 };
    const need = naturalBoxHeight(six);
    expect(need).toBeLessThan(160);
    // in a box of that height the picture fills it, exactly at the asked-for ratio (not fitted), with the room above it gone
    const l = plotLayout({ ...six, height: need });
    expect(l.fitted).toBe(false);
    expect(l.ratio).toBeCloseTo(1, 9);
    expect(l.plot.y).toBeGreaterThanOrEqual(8);
    expect(l.plot.y).toBeLessThan(9); // the box is rounded up to a whole pixel
    expect(l.plot.y + l.plot.h).toBeLessThanOrEqual(need - 24 + 1e-6);
    // the same line at 3 times needs more, and a line too short for the box wants more than the box (the stylesheet's cap fits it)
    expect(naturalBoxHeight({ ...six, exaggeration: 3 })).toBeGreaterThan(need);
    expect(naturalBoxHeight({ ...input, length: 1000, zMax: 2500 })).toBeGreaterThan(BASE.height);
    // a thin strip is never thinner than the least worth drawing, and a text that is not a number does not break it
    expect(naturalBoxHeight({ ...input, length: 60000, zMax: 400 })).toBe(120);
    expect(Number.isFinite(naturalBoxHeight({ width: NaN, length: NaN, zMin: NaN, zMax: NaN, exaggeration: NaN, smallPx: NaN }))).toBe(true);
  });

  it('makes room for the larger text of a bigger type size', () => {
    expect(plotLayout({ ...BASE, smallPx: 16 }).plot.x).toBeGreaterThan(plotLayout(BASE).plot.x);
  });
});

describe('pixels and metres', () => {
  const l = plotLayout(BASE);

  it('round-trips a distance and a height', () => {
    for (const s of [0, 1, 1234.5, 3000]) expect(sOfX(l, xOfS(l, s))).toBeCloseTo(s, 6);
    for (const z of [350, 777, 2500]) expect(zOfY(l, yOfZ(l, z))).toBeCloseTo(z, 6);
  });

  it('A is the left end and B the right, height grows upwards', () => {
    expect(xOfS(l, 0)).toBeLessThan(xOfS(l, 3000));
    expect(yOfZ(l, 2000)).toBeLessThan(yOfZ(l, 500));
  });

  it('clamps a press outside the plot to the nearest edge of the slice', () => {
    expect(sOfX(l, -50)).toBe(0);
    expect(sOfX(l, 9999)).toBe(3000);
    expect(zOfY(l, -50)).toBe(l.zMax);
    expect(zOfY(l, 9999)).toBe(l.zMin);
    expect(pickPos(l, -1, -1)).toEqual({ s: 0, z: l.zMax });
  });
});

describe('axis ticks', () => {
  it('labels heights in metres above sea level and distances in m or km, with no tick label over A or B', () => {
    const l = plotLayout(BASE);
    const t = axisTicks(l, ticks, 12);
    expect(t.height.length).toBeGreaterThanOrEqual(2);
    expect(t.height[0]!.label).toMatch(/^[\d,]+ m$/);
    for (const h of t.height) expect(h.pos).toBeGreaterThanOrEqual(l.plot.y - 1e-6);
    expect(t.distance.length).toBeGreaterThanOrEqual(1);
    for (const d of t.distance) {
      expect(d.pos - l.plot.x).toBeGreaterThanOrEqual(22);
      expect(l.plot.x + l.plot.w - d.pos).toBeGreaterThanOrEqual(22);
      expect(d.label).toMatch(/^[\d.,]+ (m|km)$/);
    }
    for (const v of [...t.height, ...t.distance]) expect(Number.isFinite(v.pos)).toBe(true);
  });
});

describe('captions', () => {
  it('says the stretch in plain words, and "same scale" near 1', () => {
    expect(scaleCaption(2.34)).toBe('Heights are above sea level and stretched about 2.3 times.');
    expect(scaleCaption(1)).toBe('Heights are above sea level, to the same scale as distance.');
    expect(scaleCaption(1.04)).toContain('same scale');
    expect(scaleCaption(NaN)).toContain('same scale');
  });

  it('puts the same facts in the small tag on the axis', () => {
    expect(scaleTag(2.34)).toBe('Height ×2.3');
    expect(scaleTag(0.62)).toBe('Height ×0.6');
    expect(scaleTag(1)).toBe('True scale');
    expect(scaleTag(1.049)).toBe('True scale');
    expect(scaleTag(NaN)).toBe('True scale');
  });

  it('leaves the tag out of a plot too small to carry it (the short landscape panel)', () => {
    expect(showsScaleTag(plotLayout(BASE))).toBe(true);
    expect(showsScaleTag(plotLayout({ ...BASE, width: 356, height: 96 }))).toBe(false);
    expect(showsScaleTag(plotLayout({ ...BASE, width: 220, height: 230 }))).toBe(false);
  });
});

describe('colouring', () => {
  const lut = makeLut({ ramp: WIND_RAMP, lo: 0, hi: 25 });

  it('maps a value to its entry, clamping the ends, and refuses what is not a number', () => {
    expect(lut.size).toBe(256);
    expect(lutIndex(lut, 0)).toBe(0);
    expect(lutIndex(lut, -5)).toBe(0);
    expect(lutIndex(lut, 25)).toBe(255);
    expect(lutIndex(lut, 99)).toBe(255);
    expect(lutIndex(lut, 12.5)).toBe(128);
    expect(lutIndex(lut, NaN)).toBe(-1);
    expect(lutIndex({ ...lut, hi: lut.lo }, 3)).toBe(0);
    expect(lut.styles).toHaveLength(256);
    expect(lut.styles[0]).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  it('turns the lattice into an image with the lowest row at the BOTTOM and the outside of the model transparent', () => {
    const d = fakeSlice({ columns: 6, rows: 5 });
    d.valid.fill(1);
    d.valid[0] = 0; // lowest row, first column
    d.values.speed[(d.rows - 1) * d.columns + 2] = 25; // highest row, third column
    d.values.speed[4 * 1] = NaN; // a NaN in a valid cell: transparent, never a coloured guess
    const r = rasterize(d, 'speed', lut);
    expect(r.width).toBe(6);
    expect(r.height).toBe(5);
    // image row 0 is the highest lattice row
    const top = (0 * 6 + 2) * 4;
    expect(r.rgba[top + 3]).toBe(255);
    expect([r.rgba[top], r.rgba[top + 1], r.rgba[top + 2]]).toEqual([lut.rgba[255 * 4], lut.rgba[255 * 4 + 1], lut.rgba[255 * 4 + 2]]);
    // the invalid cell (lowest row, first column) is the last image row, first pixel
    expect(r.rgba[((d.rows - 1) * 6 + 0) * 4 + 3]).toBe(0);
    expect(r.rgba[((d.rows - 1) * 6 + 1) * 4 + 3]).toBe(255);
    const nan = ((d.rows - 1) * 6 + 4) * 4 + 3; // lattice row 0, column 4
    expect(r.rgba[nan]).toBe(0);
  });

  it('refills an image of the same size in place', () => {
    const d = fakeSlice({ columns: 6, rows: 5 });
    const a = rasterize(d, 'speed', lut);
    expect(rasterize(d, 'up', lut, a)).toBe(a);
    expect(rasterize(fakeSlice({ columns: 7, rows: 5 }), 'speed', lut, a)).not.toBe(a);
  });

  it('places the image half a lattice step beyond the plot so each lattice point is the centre of its pixel', () => {
    const l = plotLayout(BASE);
    const b = rasterBox(l, 24, 16);
    const dx = l.plot.w / 23;
    expect(b.x).toBeCloseTo(l.plot.x - dx / 2, 9);
    expect(b.w).toBeCloseTo(dx * 24, 9);
    expect(b.y).toBeLessThan(l.plot.y);
    expect(b.y + b.h).toBeGreaterThan(l.plot.y + l.plot.h);
  });
});

describe('streak helpers', () => {
  it('paces the streaks so a 10 m/s wind crosses the line in about 8 s, whatever its length', () => {
    for (const len of [800, 3000, 9000]) expect(len / 10 / flowTimeScale(len)).toBeCloseTo(8, 9);
    expect(flowTimeScale(10)).toBe(1);
    expect(flowTimeScale(NaN)).toBe(1);
  });

  it('keeps the particles while a preset line drifts with the fire (a few metres at every update), seeds again for a new line', () => {
    // "Along the wind" and "Me to fire" are live lines: at 60x the fire's centre moves tens of metres between two updates, so the ends do too.
    // Seeding afresh at every update would restart the streaks 4 times a second (the old key rounded the ends to 1 m).
    let prev = flowSlice(fakeSlice());
    for (let i = 1; i <= 60; i++) {
      const d = fakeSlice();
      d.line = { ...d.line, a: [d.line.a[0] + 7 * i, d.line.a[1] - 3 * i], b: [d.line.b[0] + 9 * i, d.line.b[1] - 4 * i] };
      d.zMin += 2 * i;
      d.zMax += 3 * i;
      const now = flowSlice(d);
      expect(sameFlowSlice(prev, now), `update ${i}`).toBe(true);
      prev = now;
    }
    const base = flowSlice(fakeSlice());
    const again = fakeSlice();
    again.seq = 99; // the same line and lattice with new air: the particles go on
    expect(sameFlowSlice(base, flowSlice(again))).toBe(true);
    expect(sameFlowSlice(null, base)).toBe(false);
    expect(sameFlowSlice(base, flowSlice(fakeSlice({ columns: 30 })))).toBe(false);
    const placed = fakeSlice();
    placed.line = { ...placed.line, b: [placed.line.b[0] + 500, placed.line.b[1]] }; // B put somewhere else: a new line
    expect(sameFlowSlice(base, flowSlice(placed))).toBe(false);
    const taller = fakeSlice();
    taller.zMax += 600;
    expect(sameFlowSlice(base, flowSlice(taller))).toBe(false);
  });

  it('gives a smaller plot fewer streaks, between 60 and 300', () => {
    expect(flowCount(plotLayout(BASE))).toBe(300);
    const landscape = flowCount(plotLayout({ ...BASE, width: 356, height: 96 }));
    expect(landscape).toBeGreaterThanOrEqual(60);
    expect(landscape).toBeLessThan(150);
    expect(flowCount(plotLayout({ ...BASE, width: 60, height: 40 }))).toBe(60);
  });

  it('sizes the static arrow lattice to the plot', () => {
    const g = arrowGrid(plotLayout(BASE));
    expect(g.cols).toBeGreaterThanOrEqual(2);
    expect(g.rows).toBeGreaterThanOrEqual(2);
    expect(arrowGrid(plotLayout({ ...BASE, width: 100, height: 60 })).cols).toBeGreaterThanOrEqual(2);
  });
});

describe('footer: the honest labels (§8.1)', () => {
  const tz = 'Australia/Sydney';
  const abs = (t: number): number => Date.UTC(2026, 9, 10, 0, 20, 0) + t * 1000; // 11:20 Sydney at t = 0

  it('names the kind, the model grid and the time of the air', () => {
    const parts = footerParts({ kind: 'diagnosed', cellSizeM: 133.3, airTime: 3600, shownTime: 3600 }, tz, abs);
    expect(parts).toEqual(['Diagnosed wind: terrain effects only', 'model grid 133 m', 'air from 12:20']);
    expect(footerText({ kind: 'prognostic', cellSizeM: 200, airTime: 0, shownTime: 0 }, tz, abs)).toBe('3-D time-stepped air · model grid 200 m · air from 11:20');
  });

  it('splits the kind at its colon so a short screen can keep the first half', () => {
    expect(splitKindLabel('Diagnosed wind: terrain effects only')).toEqual(['Diagnosed wind', ': terrain effects only']);
    expect(splitKindLabel('3-D time-stepped air')).toEqual(['3-D time-stepped air', '']);
  });

  it('keeps kind, grid and age when a short screen drops the explanations, and says the same words otherwise', () => {
    const info = { kind: 'diagnosed' as const, cellSizeM: 133.3, airTime: 1000, shownTime: 1300 };
    const runs = footerRuns(info, tz, abs);
    expect(runs.map((r) => r.text).join('')).toBe(footerText(info, tz, abs));
    expect(runs.filter((r) => r.keep).map((r) => r.text).join('')).toBe('Diagnosed wind · grid 133 m · air from 11:36 (5 min before the time shown)');
    const prog = footerRuns({ kind: 'prognostic', cellSizeM: 200, airTime: 0, shownTime: 0 }, tz, abs);
    expect(prog.map((r) => r.text).join('')).toBe('3-D time-stepped air · model grid 200 m · air from 11:20');
    expect(prog.filter((r) => r.keep).map((r) => r.text).join('')).toBe('3-D time-stepped air · grid 200 m · air from 11:20');
  });

  it('says how much older the air is than the time shown only beyond 90 s', () => {
    expect(airFromText(1000, 1000 + AIR_STALE_S, tz, abs)).toBe('air from 11:36');
    expect(airFromText(1000, 1000 + AIR_STALE_S + 1, tz, abs)).toBe('air from 11:36 (2 min before the time shown)');
    expect(airFromText(1000, 1000 + 300, tz, abs)).toBe('air from 11:36 (5 min before the time shown)');
    expect(airFromText(1000, 500, tz, abs)).toBe('air from 11:36'); // air newer than the picture: never "before"
  });

  it('says so when the air has no time', () => {
    expect(airFromText(null, 100, tz, abs)).toBe('air time not recorded');
    expect(airFromText(NaN, 100, tz, abs)).toBe('air time not recorded');
  });
});

describe('footer: a slice read from the time-lapse recording (0.4.1)', () => {
  const tz = 'Australia/Sydney';
  const abs = (t: number): number => Date.UTC(2026, 9, 10, 0, 20, 0) + t * 1000; // 11:20 Sydney at t = 0

  it('says "recorded air from" with the time of the sample, and the same footer otherwise', () => {
    const rec = { kind: 'prognostic' as const, cellSizeM: 133.3, airTime: 0, shownTime: 300, recordedAt: 300 };
    expect(footerText(rec, tz, abs)).toBe('3-D time-stepped air · model grid 133 m · recorded air from 11:25');
    expect(footerText({ ...rec, kind: 'diagnosed' }, tz, abs)).toBe('Diagnosed wind: terrain effects only · model grid 133 m · recorded air from 11:25');
    // not recorded: the 0.4.0 words, whatever the picture's own air time was
    const { recordedAt: _none, ...live } = rec;
    expect(footerText(live, tz, abs)).toBe('3-D time-stepped air · model grid 133 m · air from 11:20 (5 min before the time shown)');
  });

  it('counts the age from the sample, and says it only beyond 90 s, as for the picture\'s own air', () => {
    expect(airFromText(0, 300 + AIR_STALE_S, tz, abs, 300)).toBe('recorded air from 11:25');
    expect(airFromText(0, 300 + AIR_STALE_S + 1, tz, abs, 300)).toBe('recorded air from 11:25 (2 min before the time shown)');
    expect(airFromText(0, 300 + 600, tz, abs, 300)).toBe('recorded air from 11:25 (10 min before the time shown)');
    expect(airFromText(0, 100, tz, abs, 300)).toBe('recorded air from 11:25'); // a sample never newer than the picture in practice; still never "before"
  });

  it('takes the sample\'s time even when the picture\'s air has none, and falls back to the air time for a tag that is not a number', () => {
    expect(airFromText(null, 300, tz, abs, 300)).toBe('recorded air from 11:25');
    expect(airFromText(0, 60, tz, abs, NaN)).toBe('air from 11:20');
    expect(airFromText(null, 60, tz, abs, NaN)).toBe('air time not recorded');
  });

  it('keeps the word "recorded" when a short screen drops the explanations', () => {
    const info = { kind: 'diagnosed' as const, cellSizeM: 133.3, airTime: 0, shownTime: 400, recordedAt: 300 };
    const runs = footerRuns(info, tz, abs);
    expect(runs.map((r) => r.text).join('')).toBe(footerText(info, tz, abs));
    const kept = runs.filter((r) => r.keep).map((r) => r.text).join('');
    expect(kept).toBe('Diagnosed wind · grid 133 m · recorded air from 11:25 (2 min before the time shown)'); // (100 s after the sample)
    expect(kept).toContain('recorded ');
  });

  it('has a cache key that changes with the tag, so the words are rewritten when only the tag changes', () => {
    const base = { kind: 'prognostic' as const, cellSizeM: 133, airTime: 600, shownTime: 900 };
    const live = footerCacheKey(base);
    expect(footerCacheKey({ ...base, recordedAt: 800 })).not.toBe(live);
    expect(footerCacheKey({ ...base, recordedAt: 800 })).not.toBe(footerCacheKey({ ...base, recordedAt: 850 }));
    expect(footerCacheKey({ ...base })).toBe(live);
    expect(footerCacheKey(null)).toBe('');
  });
});

describe('the recording\'s status line and the cells note (0.4.1, every sentence)', () => {
  const tz = 'Australia/Sydney';
  const abs = (t: number): number => Date.UTC(2026, 9, 10, 0, 20, 0) + t * 1000; // 11:20 Sydney at t = 0: 600 s is 11:30, 4800 s is 12:40, 5100 s is 12:45
  const status = (o: Partial<SliceRecordingStatus> = {}): SliceRecordingStatus => ({ state: 'recording', offFor: null, count: 40, from: 600, to: 4800, spacingS: 0, bytes: 2e6, budgetBytes: 6.3e6, dropped: null, ...o });
  const line = (rec: SliceRecordingStatus | undefined, shownTime = 2000, withData = true): string | null => {
    const u = fakeUpdate(withData ? fakeSlice({ shownTime }) : null);
    if (rec) u.recording = rec;
    return recordingLine(u, tz, abs);
  };

  it('recording: the span and how close its pictures are, "about" once pictures were thinned', () => {
    expect(line(status())).toBe('Recorded from 11:30 to 12:40, every picture.');
    expect(line(status({ spacingS: 20 }))).toBe('Recorded from 11:30 to 12:40, about every 20 s.');
    expect(line(status({ spacingS: 120 }))).toBe('Recorded from 11:30 to 12:40, about every 2 min.');
    expect(line(status({ spacingS: 600 }))).toBe('Recorded from 11:30 to 12:40, about every 10 min.');
  });

  it('says only the start while the first pictures are all in one minute', () => {
    expect(line(status({ count: 1, to: 600 }))).toBe('Recorded from 11:30.');
    expect(line(status({ count: 3, to: 640, spacingS: 0 }))).toBe('Recorded from 11:30.');
  });

  it('a time before the first picture says why the air can be older', () => {
    expect(line(status(), 300)).toBe("Recorded from 11:30. This time is earlier, so it uses the history's saved air, which can be older.");
    expect(line(status(), 600)).toBe('Recorded from 11:30 to 12:40, every picture.'); // the first picture itself is inside
  });

  it('waiting: nothing recorded yet', () => {
    expect(line(status({ state: 'waiting', count: 0, from: null, to: null }))).toBe('Recording starts with the next picture.');
  });

  it('after a drop: the reason, then where it records from', () => {
    const one = { count: 1, from: 5100, to: 5100 };
    expect(line(status({ ...one, dropped: 'line' }), 5100)).toBe('The line changed, so the old recording was dropped. Recording again from 12:45.');
    expect(line(status({ ...one, dropped: 'cleared' }), 5100)).toBe('Recording cleared. Recording again from 12:45.');
    expect(line(status({ ...one, dropped: 'model' }), 5100)).toBe('The air model changed, so the earlier recording was dropped. Recording again from 12:45.');
    // the span grows with the new recording; the reason stays with it
    expect(line(status({ count: 9, from: 5100, to: 6000, dropped: 'line', spacingS: 0 }), 5400)).toBe('The line changed, so the old recording was dropped. Recording again from 12:45 to 13:00, every picture.');
    // and none of it is lost when the time shown is before the new start
    expect(line(status({ ...one, dropped: 'cleared' }), 4000)).toBe("Recording cleared. Recording again from 12:45. This time is earlier, so it uses the history's saved air, which can be older.");
    // dropped and nothing recorded yet
    expect(line(status({ state: 'waiting', count: 0, from: null, to: null, dropped: 'cleared' }))).toBe('Recording cleared. Recording starts with the next picture.');
  });

  it('off for a preset or the Layers chord: why, and what to do', () => {
    const off = (offFor: 'preset' | 'chord' | null): SliceRecordingStatus => status({ state: 'off', offFor, count: 0, from: null, to: null });
    expect(line(off('preset'))).toBe('This preset follows the wind and the fire, so it is not recorded. Press Keep this line to record it.');
    expect(line(off('chord'))).toBe('The Layers line is not recorded. Place a line with Set start (A) and Set end (B) to record it.');
    expect(line(off(null))).toBeNull();
  });

  it('failed: the slice is not affected', () => {
    expect(line(status({ state: 'failed', count: 0, from: null, to: null }))).toBe('Recording stopped. The slice is not affected.');
  });

  it('says nothing without a recorder (the 2-D map, an older scene) or without a slice', () => {
    expect(line(undefined)).toBeNull();
    expect(line(status(), 2000, false)).toBeNull();
    expect(recordingLine(null, tz, abs)).toBeNull();
  });

  it('every sentence is plain: sentence case, no em or en dash, no exclamation, ends with a full stop', () => {
    const all: (string | null)[] = [];
    for (const dropped of [null, 'line', 'cleared', 'model'] as const) {
      for (const shown of [100, 2000]) {
        all.push(line(status({ dropped }), shown), line(status({ dropped, count: 1, to: 600 }), shown), line(status({ dropped, state: 'waiting', count: 0, from: null, to: null }), shown));
      }
    }
    for (const offFor of ['preset', 'chord'] as const) all.push(line(status({ state: 'off', offFor, count: 0, from: null, to: null })));
    all.push(line(status({ state: 'failed', count: 0, from: null, to: null })));
    const words = all.filter((x): x is string => x !== null);
    expect(words.length).toBeGreaterThan(20);
    for (const w of words) {
      expect(w, w).toMatch(/^[A-Z]/);
      expect(w, w).toMatch(/\.$/);
      expect(w, w).not.toMatch(/[\u2013\u2014!]/);
      expect(w, w).not.toMatch(/undefined|NaN|null/);
    }
  });

  it('the cells switch on a recorded slice says why the smooth picture stays', () => {
    const rec = { recordedAt: 300 };
    expect(cellsNote(true, rec)).toBe("The recording does not keep the model's own cells, so the smooth picture is shown.");
    expect(cellsNote(false, rec)).toBeNull();
    expect(cellsNote(true, {})).toBeNull();
    expect(cellsNote(true, null)).toBeNull();
  });
});

describe('chips', () => {
  const off = (reason: string, action?: 'use-3d'): SliceFieldStatus => (action ? { ok: false, reason, action } : { ok: false, reason });

  it('lists the six chips in order and opens every one when the scene has said nothing', () => {
    const c = chipModel(null, 'speed');
    expect(c.map((x) => x.label)).toEqual(['Speed', 'Along', 'Up/down', 'Across', 'Temp', 'Smoke']);
    expect(c.every((x) => x.available && x.reason === null)).toBe(true);
    expect(c.filter((x) => x.selected).map((x) => x.id)).toEqual(['speed']);
  });

  it('carries the scene\'s reason, word for word, on a chip that cannot be used', () => {
    const u = fakeUpdate(fakeSlice({ kind: 'diagnosed' }), { theta: off('Temperature needs the 3-D atmosphere.', 'use-3d'), smoke: off('Temperature needs the 3-D atmosphere.', 'use-3d') });
    const c = chipModel(u.fields, 'along');
    const temp = c.find((x) => x.id === 'theta')!;
    expect(temp.available).toBe(false);
    expect(temp.reason).toBe('Temperature needs the 3-D atmosphere.');
    expect(temp.use3d).toBe(true);
    expect(c.find((x) => x.id === 'along')!.selected).toBe(true);
    expect(c.filter((x) => x.available).map((x) => x.id)).toEqual(['speed', 'along', 'up', 'across']);
  });

  it('makes one note per distinct reason, each word for word as the scene wrote it', () => {
    const same = disabledNotes(chipModel({ ...fakeUpdate(null).fields, theta: off('Needs the 3-D atmosphere.', 'use-3d'), smoke: off('Needs the 3-D atmosphere.', 'use-3d') }, 'speed'));
    expect(same).toEqual([{ reason: 'Needs the 3-D atmosphere.', labels: ['Temp', 'Smoke'], use3d: true }]);
    const two = disabledNotes(chipModel({ ...fakeUpdate(null).fields, theta: off('Temperature needs the 3-D atmosphere.'), smoke: off('Smoke needs the 3-D atmosphere.', 'use-3d') }, 'speed'));
    expect(two.map((n) => n.reason)).toEqual(['Temperature needs the 3-D atmosphere.', 'Smoke needs the 3-D atmosphere.']);
    expect(two.map((n) => n.use3d)).toEqual([false, true]);
    expect(disabledNotes(chipModel(null, 'speed'))).toEqual([]);
  });
});

describe('empty states and the canvas label', () => {
  it('shows none while there is a slice', () => {
    expect(emptyState(fakeUpdate(fakeSlice()))).toBeNull();
  });

  it('says what to do when there is no line yet, and why a line cannot be drawn', () => {
    expect(emptyState(null)).toEqual({ kind: 'no-line', text: 'Choose a preset, or set A and B.' });
    const none = fakeUpdate(null);
    none.resolved = { ...none.resolved, line: null, issue: null };
    expect(emptyState(none)?.kind).toBe('no-line');
    none.resolved = { ...none.resolved, line: null, issue: 'too-short' };
    expect(emptyState(none)).toEqual({ kind: 'too-short', text: 'That line is too short to show.' });
    none.resolved = { ...none.resolved, line: null, issue: 'outside-model' };
    expect(emptyState(none)?.text).toBe('That line is outside the model area.');
    none.resolved = { ...none.resolved, line: null, issue: 'no-user' }; // a preset that could not be made: the tool says why
    expect(emptyState(none)?.kind).toBe('no-line');
  });

  it('says there is no 3-D wind when the line is fine but the air holds none', () => {
    const u = fakeUpdate(null);
    u.resolved = { ...u.resolved, line: fakeSlice().line };
    expect(emptyState(u)?.kind).toBe('no-wind');
    expect(emptyState(u)?.text).toContain('no 3-D wind');
  });

  it('gives the canvas a text alternative with the line length and the colouring', () => {
    expect(canvasLabel(fakeSlice(), 'Wind speed')).toBe('Side view of the air along a 3 km line from A to B, coloured by wind speed. The arrow keys move a probe that reads the air at a point; Escape clears it.');
    expect(canvasLabel(null, 'Wind speed')).toContain('no slice');
  });
});

describe('legend', () => {
  const ramp: ExternalLegend = {
    title: 'Wind speed',
    units: 'km/h',
    kind: 'continuous',
    entries: [0, 15, 30, 45, 60, 75, 90].map((v, i) => ({ value: v, colour: `#${i}${i}${i}${i}${i}${i}`, label: String(v) })),
  };

  it('is a bar with up to five labels, the first and the last always among them', () => {
    const v = legendView(ramp)!;
    expect(v.title).toBe('Wind speed (km/h)');
    expect(v.gradient).toMatch(/^linear-gradient\(to right,/);
    expect(v.ends).toEqual(['0', '30', '45', '75', '90']);
  });

  it('keeps the scene\'s own gradient when it gives one', () => {
    expect(legendView({ ...ramp, gradient: 'linear-gradient(red, blue)' })!.gradient).toBe('linear-gradient(red, blue)');
  });

  it('is swatches for classes, with the no-data colour last', () => {
    const v = legendView({ title: 'Smoke', units: '', kind: 'classes', entries: [{ value: 0, colour: '#111111', label: 'None' }, { value: 1, colour: '#222222', label: 'Some' }], noData: { colour: '#999999', label: 'Not modelled' } })!;
    expect(v.title).toBe('Smoke');
    expect(v.gradient).toBeNull();
    expect(v.classes.map((c) => c.label)).toEqual(['None', 'Some', 'Not modelled']);
  });

  it('is nothing when the scene gives none', () => {
    expect(legendView(null)).toBeNull();
    expect(legendView(undefined)).toBeNull();
    expect(legendView({ ...ramp, entries: [] })).toBeNull();
  });

  it('spreads labels evenly', () => {
    expect(spreadLabels(['a', 'b', 'c'], 5)).toEqual(['a', 'b', 'c']);
    expect(spreadLabels(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3)).toEqual(['a', 'd', 'g']);
  });
});

describe('flowTick: the streaks are drawn at most 24 times a second, whatever the display', () => {
  /** Streak frames drawn in `seconds` on a display of `hz`, its frame times rounded to a tenth of a millisecond (and shaken by `jitterMs`). */
  function drawnPerSecond(hz: number, seconds = 20, jitterMs = 0): { rate: number; steps: number[] } {
    const clock: FlowClock = { last: 0, acc: 0 };
    let drawn = 0;
    const steps: number[] = [];
    const n = Math.round(hz * seconds);
    for (let i = 1; i <= n; i++) {
      const shake = jitterMs ? Math.sin(i * 12.9898) * jitterMs : 0;
      const dt = flowTick(clock, Math.round(((i * 1000) / hz + shake) * 10) / 10);
      if (dt > 0) {
        drawn++;
        steps.push(dt);
      }
    }
    return { rate: drawn / seconds, steps };
  }

  it('draws no more than 24 a second on 60, 75, 90, 120, 144, 165 and 240 Hz displays (144 Hz drew about 29 a second when a frame could come 8 ms early)', () => {
    for (const hz of [30, 48, 60, 72, 75, 90, 100, 120, 144, 165, 240, 360]) {
      const { rate } = drawnPerSecond(hz);
      expect(rate, `${hz} Hz`).toBeLessThanOrEqual(24.05);
    }
    expect(drawnPerSecond(144).rate).toBeGreaterThan(23.5);
    expect(drawnPerSecond(120).rate).toBeGreaterThan(23.5);
    expect(drawnPerSecond(60).rate).toBeGreaterThan(19.5); // every third frame: 20 a second
    expect(drawnPerSecond(60).rate).toBeLessThanOrEqual(20.05);
  });

  it('stays at or under about 24 a second when the frame times are not exactly regular', () => {
    for (const hz of [60, 120, 144]) expect(drawnPerSecond(hz, 20, 0.4).rate, `${hz} Hz with 0.4 ms of jitter`).toBeLessThanOrEqual(24.5);
  });

  it('steps the particles by all the time since the last streak frame, and by no more than a tenth of a second after a long pause', () => {
    const { steps } = drawnPerSecond(144, 2);
    for (const dt of steps) expect(dt).toBeGreaterThan(1 / 24 - 0.002);
    const clock: FlowClock = { last: 0, acc: 0 };
    expect(flowTick(clock, 1000)).toBe(0); // the first frame only starts the clock
    expect(flowTick(clock, 1010)).toBe(0); // 10 ms: not yet
    expect(flowTick(clock, 1050)).toBeCloseTo(0.05, 9); // 50 ms in all: draws, stepping by all of it
    expect(flowTick(clock, 9000)).toBe(0.1); // a tab that was away
  });
});
