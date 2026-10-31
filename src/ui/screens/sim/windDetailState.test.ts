/**
 * The Wind detail chip's rules (windDetailState.ts): when it shows, how many of the four steps are reached and what the picture is, what
 * limits it (in the order the sheet says it), when its key changes (the DOM is touched only then), and what it reads from the screen.
 */
import { describe, expect, it } from 'vitest';
import type { AirKind } from '../../../core/airView';
import type { WindGlyphStats } from '../../../render/api';
import type { WindHeight } from '../../../render/wind/glyphTypes';
import { WIND_HEIGHTS } from '../../../render/wind/glyphTypes';
import { GLYPH_SMOOTH_FIT_PX } from './glyphWords';
import { chipLabel, windDetailInput, windDetailState, type DetailKind, type DetailLimit, type WindDetailInput } from './windDetailState';

const stats = (over: Partial<WindGlyphStats> = {}): WindGlyphStats => ({
  active: true,
  idle: null,
  level: 3,
  count: 412,
  segments: 2980,
  cellPx: 45,
  cellM: 133,
  rebuilds: 14,
  lastMs: 3.1,
  sliceP95Ms: 4.2,
  sliceMaxMs: 6,
  slicesLast: 2,
  detail: 'off',
  detailSegments: 0,
  glyphs: true,
  streaks: false,
  reduced: false,
  tickMaxMs: 0,
  ...over,
});
/** The default: the arrows and flow lines on, the Wind streaks off, the 3-D view, the standard tier's air. */
const input = (over: Partial<WindDetailInput> = {}): WindDetailInput => ({ glyphsOn: true, streaks: 'off', viewMode: 'orbit', stats: stats(), air: 'prognostic', height: 'fire', ...over });
/** The state of an input as `level kind limits`, for the table below. */
const read = (over: Partial<WindDetailInput>): string => {
  const s = windDetailState(input(over));
  return s.visible ? `${s.level} ${s.kind} [${s.limits.join(',')}]` : 'hidden';
};

describe('when the chip shows', () => {
  it('not at all in the 2-D map (no statistics), whatever is switched on', () => {
    expect(windDetailState(input({ stats: null })).visible).toBe(false);
    expect(windDetailState(input({ stats: null, streaks: 'surface' })).visible).toBe(false);
  });

  it('not when no wind mark is on: neither the arrows and flow lines nor the Wind streaks', () => {
    expect(read({ glyphsOn: false, streaks: 'off' })).toBe('hidden');
    expect(read({ glyphsOn: false, streaks: 'off', stats: stats({ idle: 'off', active: false }) })).toBe('hidden');
  });

  it('with the arrows and flow lines alone, or with either kind of Wind streaks alone', () => {
    expect(windDetailState(input({ glyphsOn: true, streaks: 'off' })).visible).toBe(true);
    expect(windDetailState(input({ glyphsOn: false, streaks: 'surface' })).visible).toBe(true);
    expect(windDetailState(input({ glyphsOn: false, streaks: 'volume' })).visible).toBe(true);
  });

  it('at eye level only while the Wind streaks are on (the arrows are not drawn there; the streaks are)', () => {
    expect(read({ viewMode: 'ground', streaks: 'off', stats: stats({ active: false, idle: 'eye-level' }) })).toBe('hidden');
    expect(read({ viewMode: 'ground', glyphsOn: false, streaks: 'surface', stats: stats({ active: false, idle: 'off', level: 0 }) })).toMatch(/^1 overview/);
    expect(read({ viewMode: 'ground', glyphsOn: false, streaks: 'volume', stats: stats({ active: false, idle: 'off', level: 0 }) })).toMatch(/^1 volume/);
  });

  it('not while the arrows wait for the air picture, unless the streaks are on', () => {
    expect(read({ stats: stats({ active: false, idle: 'no-wind', level: 0 }) })).toBe('hidden');
    expect(read({ streaks: 'surface', stats: stats({ active: false, idle: 'no-wind', level: 0 }) })).toMatch(/^1 overview/);
  });

  it('with the arrows on but a model cell under 4 px (level 0): shown with no pips, nothing drawn, so the sheet can say why', () => {
    expect(read({ stats: stats({ active: false, level: 0, cellPx: 2 }) })).toBe('0 none []');
  });

  it('the Wind speed map is not a wind mark: with both switches off the chip is hidden (the map is an overlay the chip never reads)', () => {
    const ctx = fakeCtx({ layers: { windGlyphs: false, wind: 'off', overlay: 'windSpeed' } });
    expect(windDetailState(windDetailInput(ctx)).visible).toBe(false);
  });
});

describe('the steps reached, and what the picture is', () => {
  it('the arrows and flow lines follow the layer: L1 and L2 straight arrows, L3 curved flow lines', () => {
    expect(read({ stats: stats({ level: 1, cellPx: 8 }) })).toBe('1 arrows [zoom]');
    expect(read({ stats: stats({ level: 2, cellPx: 20 }) })).toBe('2 arrows [zoom]');
    expect(read({ stats: stats({ level: 3, cellPx: 45 }) })).toBe('3 curves [zoom]');
  });

  it('the closest zoom is the fourth step only when the detailed streaks are drawn (moving)', () => {
    expect(read({ stats: stats({ level: 4, cellPx: 150, detail: 'moving', detailSegments: 3200 }) })).toBe('4 detailed [cells]');
  });

  it('and standing still under reduced motion: still the fourth step, and the sheet says why they stand still', () => {
    expect(read({ stats: stats({ level: 4, cellPx: 150, detail: 'still', detailSegments: 3200 }) })).toBe('4 detailed [cells,still]');
  });

  it('with the layer at its closest zoom but the detailed streaks not drawn (trimmed, or not built yet): the 0.5.0 flow lines, the third step, and no "zoom in" (there is no closer)', () => {
    expect(read({ stats: stats({ level: 4, cellPx: 150, detail: 'off' }) })).toBe('3 curves [cells]');
  });

  it('the Wind streaks alone (the surface ones): moving streaks over the whole area, the first step, until the closest zoom gives them the detailed picture', () => {
    expect(read({ glyphsOn: false, streaks: 'surface', stats: stats({ active: false, idle: 'off', level: 2, cellPx: 20 }) })).toBe('1 overview [zoom]');
    expect(read({ glyphsOn: false, streaks: 'surface', stats: stats({ active: false, idle: 'off', level: 0, cellPx: 2 }) })).toBe('1 overview [zoom]');
    expect(read({ glyphsOn: false, streaks: 'surface', stats: stats({ active: true, idle: null, level: 4, cellPx: 150, detail: 'moving' }) })).toBe('4 detailed [cells]');
  });

  it('the Wind streaks through the air (the volume ones): the first step, no zoom limit (they never follow the zoom), and never the detailed picture', () => {
    expect(read({ glyphsOn: false, streaks: 'volume', stats: stats({ active: false, idle: 'off', level: 2, cellPx: 20 }) })).toBe('1 volume []');
    expect(read({ glyphsOn: false, streaks: 'volume', stats: stats({ level: 4, cellPx: 150, detail: 'moving' }) })).toBe('1 volume []');
  });

  it('both on: the finer of the two, the arrows and lines on a tie', () => {
    expect(read({ streaks: 'surface', stats: stats({ level: 1, cellPx: 8 }) })).toBe('1 arrows [zoom]');
    expect(read({ streaks: 'surface', stats: stats({ level: 2, cellPx: 20 }) })).toBe('2 arrows [zoom]');
    expect(read({ streaks: 'surface', stats: stats({ level: 3, cellPx: 45 }) })).toBe('3 curves [zoom]');
    expect(read({ streaks: 'volume', stats: stats({ level: 3, cellPx: 45 }) })).toBe('3 curves [zoom]');
    expect(read({ streaks: 'surface', stats: stats({ active: false, level: 0, cellPx: 2 }) })).toBe('1 overview [zoom]');
    expect(read({ streaks: 'volume', stats: stats({ level: 4, cellPx: 150, detail: 'moving' }) })).toBe('4 detailed [cells]');
  });

  it('a full view (idle budget) draws no arrows: level 0 with the budget limit; with the streaks on, their picture is what is drawn, and the budget is still said', () => {
    const budget = stats({ active: false, idle: 'budget', level: 3, cellPx: 45 });
    expect(read({ stats: budget })).toBe('0 none [budget]');
    expect(read({ stats: budget, streaks: 'surface' })).toBe('1 overview [budget,zoom]');
    expect(read({ stats: budget, streaks: 'volume' })).toBe('1 volume [budget]');
  });
});

describe('what limits the picture, in the order the sheet says it', () => {
  it('the model cell is said once it covers more than 60 px (the smooth-fit rule of the Layers caption), and not at exactly 60', () => {
    expect(GLYPH_SMOOTH_FIT_PX).toBe(60);
    expect(read({ stats: stats({ level: 3, cellPx: 30 }) })).toBe('3 curves [zoom]');
    expect(read({ stats: stats({ level: 3, cellPx: 60 }) })).toBe('3 curves [zoom]');
    expect(read({ stats: stats({ level: 3, cellPx: 61 }) })).toBe('3 curves [zoom,cells]');
    expect(read({ stats: stats({ level: 3, cellPx: 500 }) })).toBe('3 curves [zoom,cells]');
  });

  it('an estimated wind (the fast tier) says so at every step; the 3-D atmosphere and no air do not', () => {
    expect(read({ air: 'diagnosed' })).toBe('3 curves [zoom,estimated]');
    expect(read({ air: 'diagnosed', stats: stats({ level: 1, cellPx: 8 }) })).toBe('1 arrows [zoom,estimated]');
    expect(read({ air: 'diagnosed', stats: stats({ level: 4, cellPx: 150, detail: 'moving' }) })).toBe('4 detailed [cells,estimated]');
    for (const air of ['prognostic', 'surface', 'none'] as AirKind[]) expect(read({ air }), air).toBe('3 curves [zoom]');
  });

  it('all that apply, in one order: budget, zoom, cells, estimated, still', () => {
    expect(read({ air: 'diagnosed', stats: stats({ level: 3, cellPx: 70 }) })).toBe('3 curves [zoom,cells,estimated]');
    expect(read({ air: 'diagnosed', stats: stats({ level: 4, cellPx: 150, detail: 'still' }) })).toBe('4 detailed [cells,estimated,still]');
    expect(read({ air: 'diagnosed', streaks: 'surface', stats: stats({ active: false, idle: 'budget', level: 3 }) })).toBe('1 overview [budget,zoom,estimated]');
  });

  it('reduced motion is said while the detailed streaks stand still, and, with a Wind streaks switch on, at every zoom (the old streaks stand still too)', () => {
    expect(read({ stats: stats({ level: 4, cellPx: 150, detail: 'moving' }) })).not.toContain('still');
    expect(read({ stats: stats({ level: 3, cellPx: 45 }) })).not.toContain('still');
    expect(read({ stats: stats({ level: 4, cellPx: 150, detail: 'still' }) })).toContain('still');
    // 0.7.0: the old Wind streaks freeze under reduced motion, so the sheet says why they do not move at the lower levels too.
    const reduced = (over: Partial<WindGlyphStats>): Partial<WindGlyphStats> => ({ reduced: true, ...over });
    expect(read({ glyphsOn: false, streaks: 'surface', stats: stats(reduced({ active: false, idle: 'off', level: 2, cellPx: 20 })) })).toBe('1 overview [zoom,still]');
    expect(read({ glyphsOn: false, streaks: 'volume', stats: stats(reduced({ active: false, idle: 'off', level: 2, cellPx: 20 })) })).toBe('1 volume [still]');
    expect(read({ streaks: 'surface', stats: stats(reduced({ level: 3, cellPx: 45 })) })).toBe('3 curves [zoom,still]');
    // The arrows alone have nothing that moves below the closest zoom: nothing to explain there.
    expect(read({ streaks: 'off', stats: stats(reduced({ level: 3, cellPx: 45 })) })).toBe('3 curves [zoom]');
    // And without reduced motion, a Wind streaks switch says nothing about it.
    expect(read({ glyphsOn: false, streaks: 'surface', stats: stats({ active: false, idle: 'off', level: 2, cellPx: 20 }) })).toBe('1 overview [zoom]');
    // At the closest zoom it is said once, whichever way it is reached.
    expect(read({ streaks: 'surface', stats: stats(reduced({ level: 4, cellPx: 150, detail: 'still' })) })).toBe('4 detailed [cells,still]');
  });

  it('the pause after a minute without a touch is a limit of the detailed streaks, said after reduced motion, and a different key', () => {
    expect(read({ stats: stats({ level: 4, cellPx: 150, detail: 'paused', detailSegments: 3200 }) })).toBe('4 detailed [cells,paused]');
    expect(read({ glyphsOn: false, streaks: 'surface', stats: stats({ level: 4, cellPx: 150, detail: 'paused', detailSegments: 3200 }) })).toBe('4 detailed [cells,paused]');
    expect(read({ air: 'diagnosed', stats: stats({ level: 4, cellPx: 150, detail: 'paused' }) })).toBe('4 detailed [cells,estimated,paused]');
    // Still the fourth step: a pause is not a lower level.
    expect(windDetailState(input({ stats: stats({ level: 4, cellPx: 150, detail: 'paused' }) })).level).toBe(4);
    // Never said for a picture that is not the detailed streaks.
    expect(read({ stats: stats({ level: 3, cellPx: 45, detail: 'off' }) })).not.toContain('paused');
    const moving = windDetailState(input({ stats: stats({ level: 4, cellPx: 150, detail: 'moving' }) }));
    const paused = windDetailState(input({ stats: stats({ level: 4, cellPx: 150, detail: 'paused' }) }));
    expect(paused.key).not.toBe(moving.key);
  });
});

describe('the key (the DOM is touched only when it changes)', () => {
  const key = (over: Partial<WindDetailInput> = {}): string => windDetailState(input(over)).key;

  it('is "visible|level|kind|limits|height"', () => {
    expect(key()).toBe('true|3|curves|zoom|fire');
    expect(key({ height: 100, air: 'diagnosed', stats: stats({ level: 3, cellPx: 70 }) })).toBe('true|3|curves|zoom,cells,estimated|100');
    expect(key({ glyphsOn: false })).toBe('hidden');
  });

  it('does not change with the numbers that move every poll: counts, segments, rebuilds, the time of a rebuild, the pixels of a cell under 60', () => {
    const a = key({ stats: stats({ count: 100, segments: 800, rebuilds: 1, lastMs: 1, cellPx: 40 }) });
    const b = key({ stats: stats({ count: 412, segments: 2980, rebuilds: 99, lastMs: 9, cellPx: 44.9, sliceP95Ms: 7, slicesLast: 3, detailSegments: 0 }) });
    expect(a).toBe(b);
  });

  it('changes with the step, the picture, a limit and the height', () => {
    const keys = new Set<string>([
      key(),
      key({ stats: stats({ level: 2, cellPx: 20 }) }),
      key({ stats: stats({ level: 3, cellPx: 70 }) }),
      key({ stats: stats({ level: 4, cellPx: 150, detail: 'moving' }) }),
      key({ stats: stats({ level: 4, cellPx: 150, detail: 'still' }) }),
      key({ stats: stats({ level: 4, cellPx: 150, detail: 'paused' }) }),
      key({ air: 'diagnosed' }),
      key({ height: 300 }),
      key({ glyphsOn: false, streaks: 'volume' }),
    ]);
    expect(keys.size).toBe(9);
  });

  it('is different for every height (the sheet says where the wind is read)', () => {
    expect(new Set(WIND_HEIGHTS.map((height: WindHeight) => key({ height }))).size).toBe(WIND_HEIGHTS.length);
  });
});

describe('the chip’s name', () => {
  it('says the step reached, and "not drawn yet" at none', () => {
    expect(chipLabel(0)).toBe('Wind detail: not drawn yet. Open the explanation.');
    expect(chipLabel(1)).toBe('Wind detail: level 1 of 4. Open the explanation.');
    expect(chipLabel(3)).toBe('Wind detail: level 3 of 4. Open the explanation.');
    expect(chipLabel(4)).toBe('Wind detail: level 4 of 4. Open the explanation.');
  });
});

describe('what it reads from the screen (windDetailInput)', () => {
  it('the two switches, the camera mode, the layer’s statistics, the kind of air and the height', () => {
    const st = stats({ level: 2, cellPx: 20 });
    const ctx = fakeCtx({ layers: { windGlyphs: true, wind: 'surface', windHeight: 300 }, ui: { viewMode: 'top' }, stats: st, atmosphere: { nz: 0, kind: 'diagnosed' } });
    expect(windDetailInput(ctx)).toEqual({ glyphsOn: true, streaks: 'surface', viewMode: 'top', stats: st, air: 'diagnosed', height: 300 });
  });

  it('a view with no statistics (the 2-D map) and no air picture yet', () => {
    const ctx = fakeCtx({ stats: null, noAtmosphere: true });
    const i = windDetailInput(ctx);
    expect(i.stats).toBeNull();
    expect(i.air).toBe('none');
    expect(windDetailState(i).visible).toBe(false);
  });
});

describe('the whole space of inputs (property test)', () => {
  const ORDER: DetailLimit[] = ['budget', 'zoom', 'cells', 'estimated', 'still', 'paused'];
  const KINDS = new Set<DetailKind>(['none', 'arrows', 'curves', 'detailed', 'overview', 'volume']);
  const IDLE = [null, 'off', 'eye-level', 'no-wind', 'budget'] as const;
  /** What the layer can say about the detailed streaks and reduced motion together: not drawn (either way), moving, standing still (reduced motion), paused (not reduced). */
  const MOTION = [
    ['off', false],
    ['off', true],
    ['moving', false],
    ['still', true],
    ['paused', false],
  ] as const;
  const AIRS: AirKind[] = ['prognostic', 'diagnosed', 'surface', 'none'];

  const all: { i: WindDetailInput; s: ReturnType<typeof windDetailState> }[] = [];
  for (const glyphsOn of [false, true])
    for (const streaks of ['off', 'surface', 'volume'] as const)
      for (const viewMode of ['orbit', 'top', 'ground'] as const)
        for (const idle of IDLE)
          for (const level of [0, 1, 2, 3, 4] as const)
            for (const active of [false, true])
              for (const air of AIRS)
                for (const cellPx of [2, 30, 61, 500])
                  for (const [detail, reduced] of MOTION) {
                    const i = input({ glyphsOn, streaks, viewMode, air, stats: stats({ idle, level, active, cellPx, detail, reduced }) });
                    all.push({ i, s: windDetailState(i) });
                  }

  it('covers 72,000 inputs', () => {
    expect(all).toHaveLength(2 * 3 * 3 * 5 * 5 * 2 * 4 * 4 * 5);
  });

  it('never more than four steps, and a whole number of them', () => {
    for (const { i, s } of all) {
      expect([0, 1, 2, 3, 4], JSON.stringify(i)).toContain(s.level);
      expect(KINDS.has(s.kind)).toBe(true);
    }
  });

  it('hidden whenever no wind mark is on, and a hidden chip says nothing', () => {
    for (const { i, s } of all) {
      if (!i.glyphsOn && i.streaks === 'off') expect(s.visible, JSON.stringify(i)).toBe(false);
      if (!s.visible) expect(s).toEqual({ visible: false, level: 0, kind: 'none', limits: [], key: 'hidden' });
    }
  });

  it('the fourth step if and only if the detailed streaks are drawn (a switch that feeds them is on)', () => {
    for (const { i, s } of all) {
      if (!s.visible) continue;
      const fed = i.glyphsOn || i.streaks === 'surface';
      expect(s.level === 4, JSON.stringify(i)).toBe(i.stats!.detail !== 'off' && fed);
      expect(s.kind === 'detailed', JSON.stringify(i)).toBe(s.level === 4);
    }
  });

  it('no pips means nothing drawn, and the converse; a picture that is not the detailed one never claims more than the third step', () => {
    for (const { i, s } of all) {
      if (!s.visible) continue;
      expect(s.level === 0, JSON.stringify(i)).toBe(s.kind === 'none');
      if (s.kind !== 'detailed') expect(s.level).toBeLessThanOrEqual(3);
      if (s.kind === 'volume' || s.kind === 'overview') expect(s.level).toBe(1);
    }
  });

  it('the limits are in the sheet’s order, without repeats, and each is true to its cause', () => {
    for (const { i, s } of all) {
      const at = s.limits.map((l) => ORDER.indexOf(l));
      expect(at, JSON.stringify(i)).toEqual([...new Set(at)].sort((a, b) => a - b));
      expect(at.every((x) => x >= 0)).toBe(true);
      if (!s.visible) continue;
      expect(s.limits.includes('budget')).toBe(i.stats!.idle === 'budget');
      expect(s.limits.includes('estimated')).toBe(i.air === 'diagnosed');
      expect(s.limits.includes('still')).toBe(i.stats!.detail === 'still' || (i.stats!.reduced && i.streaks !== 'off'));
      expect(s.limits.includes('paused')).toBe(i.stats!.detail === 'paused');
      if (s.limits.includes('zoom')) {
        expect(s.level).toBeLessThan(4);
        expect(s.kind === 'arrows' || s.kind === 'curves' || s.kind === 'overview').toBe(true);
        expect(i.stats!.level).toBeLessThan(4);
      }
      if (s.limits.includes('cells')) expect(s.kind === 'detailed' || (['arrows', 'curves'].includes(s.kind) && i.stats!.cellPx > GLYPH_SMOOTH_FIT_PX)).toBe(true);
      if (s.kind === 'detailed') expect(s.limits).toContain('cells'); // "the eddies are not the model's" always travels with the model's cell size
      if (s.kind === 'volume') expect(s.limits.filter((l) => l === 'zoom' || l === 'cells')).toEqual([]);
    }
  });

  it('the key is the state: equal keys mean equal states, and the same input gives the same state twice', () => {
    const byKey = new Map<string, string>();
    for (const { i, s } of all) {
      const what = JSON.stringify({ v: s.visible, l: s.level, k: s.kind, m: s.limits, h: i.height });
      expect(byKey.get(s.key) ?? what, s.key).toBe(what);
      byKey.set(s.key, what);
    }
    for (const { i, s } of all.filter((_, n) => n % 997 === 0)) expect(windDetailState(i)).toEqual(s);
  });
});

/** A context with just what `windDetailInput` reads. */
function fakeCtx(o: {
  layers?: Record<string, unknown>;
  ui?: Record<string, unknown>;
  stats?: WindGlyphStats | null;
  atmosphere?: { nz: number; kind: AirKind };
  noAtmosphere?: boolean;
}): Parameters<typeof windDetailInput>[0] {
  const layers = { windGlyphs: false, wind: 'surface', windHeight: 'fire', ...o.layers };
  const ui = { viewMode: 'orbit', ...o.ui };
  const snapshot = o.noAtmosphere ? null : { atmosphere: o.atmosphere ?? { nz: 0, kind: 'prognostic' } };
  return {
    layers: { get: () => layers },
    ui: { get: () => ui },
    view: { windGlyphStats: () => (o.stats === undefined ? stats() : o.stats) },
    session: { state: { get: () => ({ snapshot }) } },
  } as unknown as Parameters<typeof windDetailInput>[0];
}
