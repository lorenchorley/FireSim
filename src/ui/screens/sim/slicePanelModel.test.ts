import { describe, expect, it } from 'vitest';
import { AIR_STALE_S } from '../../../core/airView';
import { WIND_RAMP } from '../../../render/palette';
import type { SliceFieldStatus } from '../../../render/slice/types';
import type { ExternalLegend } from '../../legends';
import { fakeSlice, fakeUpdate } from './slicePanelFixtures';
import {
  airFromText,
  arrowGrid,
  axisTicks,
  canvasLabel,
  chipModel,
  disabledNotes,
  emptyState,
  flowKey,
  flowTimeScale,
  footerParts,
  footerText,
  joinLabels,
  legendView,
  lutIndex,
  makeLut,
  noteText,
  pickPos,
  plotLayout,
  rasterBox,
  rasterize,
  readoutSide,
  scaleCaption,
  sOfX,
  spreadLabels,
  xOfS,
  yOfZ,
  zOfY,
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

  it('puts the floating readout on the half of the canvas away from the pin', () => {
    expect(readoutSide(l, { s: 100, z: l.zMax })).toBe('bottom');
    expect(readoutSide(l, { s: 100, z: l.zMin })).toBe('top');
    expect(readoutSide(l, null)).toBe('top');
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
    expect(scaleCaption(1)).toBe('Heights are above sea level, drawn to the same scale as distance.');
    expect(scaleCaption(1.04)).toContain('same scale');
    expect(scaleCaption(NaN)).toContain('same scale');
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

  it('keeps the particles for the same line and lattice, seeds again for another', () => {
    const a = fakeSlice();
    const b = fakeSlice();
    b.seq = 99;
    expect(flowKey(a)).toBe(flowKey(b));
    const moved = fakeSlice();
    moved.line = { ...moved.line, b: [moved.line.b[0] + 500, moved.line.b[1]] };
    expect(flowKey(moved)).not.toBe(flowKey(a));
    expect(flowKey(fakeSlice({ columns: 30 }))).not.toBe(flowKey(a));
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

  it('groups the notes by reason: one reason is shown alone, several carry the chip names', () => {
    const same = disabledNotes(chipModel({ ...fakeUpdate(null).fields, theta: off('Needs the 3-D atmosphere.', 'use-3d'), smoke: off('Needs the 3-D atmosphere.', 'use-3d') }, 'speed'));
    expect(same).toEqual([{ labels: ['Temp', 'Smoke'], reason: 'Needs the 3-D atmosphere.', use3d: true }]);
    expect(noteText(same[0]!, false)).toBe('Needs the 3-D atmosphere.');
    const two = disabledNotes(chipModel({ ...fakeUpdate(null).fields, theta: off('No temperature here.'), smoke: off('No smoke here.', 'use-3d') }, 'speed'));
    expect(two.map((n) => noteText(n, true))).toEqual(['Temp: No temperature here.', 'Smoke: No smoke here.']);
    expect(two.map((n) => n.use3d)).toEqual([false, true]);
    expect(disabledNotes(chipModel(null, 'speed'))).toEqual([]);
  });

  it('joins names in plain words', () => {
    expect(joinLabels([])).toBe('');
    expect(joinLabels(['Temp'])).toBe('Temp');
    expect(joinLabels(['Temp', 'Smoke'])).toBe('Temp and Smoke');
    expect(joinLabels(['A', 'B', 'C'])).toBe('A, B and C');
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
