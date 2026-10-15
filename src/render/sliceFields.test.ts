/** Which chips of the air slice the air can give, and the words that say why not (the Layers panel, the map legend and the Air slices panel all use them). */
import { describe, expect, it } from 'vitest';
import type { AtmosphereView } from '../core/types';
import type { LayerState } from './layers';
import { DIAGNOSED_SECTION_NOTE, DIAGNOSED_STREAKS_NOTE, LINE_BY_CENTRE, NO_AIR_REASON, SWITCHING_NOTE, USE_3D_LABEL, effectiveSliceField, sectionChanged, sectionColouring, sliceAirOf, sliceFieldStatuses, sliceKindOf, type SliceAir } from './sliceFields';
import { SLICE_FIELD_IDS, SLICE_FIELDS } from './slice/types';
import { SLICE_USE_3D_LABEL } from '../ui/screens/sim/sliceTypes';

const PROGNOSTIC: SliceAir = { kind: 'prognostic', has: { wind: true, theta: true, smoke: true } };
const DIAGNOSED: SliceAir = { kind: 'diagnosed', has: { wind: true, theta: false, smoke: false } };
const NONE: SliceAir = { kind: 'none', has: { wind: false, theta: false, smoke: false } };
const SURFACE: SliceAir = { kind: 'surface', has: { wind: false, theta: false, smoke: false } };

/** A tiny view with the arrays a kind has (`airHas` reads their lengths). */
function view(kind: 'prognostic' | 'diagnosed' | 'surface' | undefined, withThetaAndSmoke: boolean): AtmosphereView {
  const nx = 3;
  const ny = 3;
  const nz = kind === 'surface' ? 0 : 2;
  const n = nx * ny * nz;
  const f = (len: number): Float32Array => new Float32Array(len);
  return {
    grid: { nx, ny, x0: 0, y0: 0, cellSize: 100 },
    nz,
    ...(kind && kind !== 'surface' ? { kind } : {}),
    u: f(n),
    v: f(n),
    w: f(n),
    thetaAnomaly: f(withThetaAndSmoke ? n : 0),
    smoke: f(withThetaAndSmoke ? n : 0),
  } as unknown as AtmosphereView;
}

describe('sliceFieldStatuses', () => {
  it('the 3-D atmosphere gives every chip', () => {
    const s = sliceFieldStatuses(PROGNOSTIC);
    for (const id of SLICE_FIELD_IDS) expect(s[id], id).toEqual({ ok: true });
  });

  it('the fast model gives the wind chips, and says in plain words why Temp and Smoke are off, with the switch to the 3-D atmosphere', () => {
    const s = sliceFieldStatuses(DIAGNOSED);
    for (const id of ['speed', 'along', 'up', 'across'] as const) expect(s[id], id).toEqual({ ok: true });
    expect(s.theta).toEqual({ ok: false, reason: 'Temperature needs the 3-D atmosphere. The fast model only fits the wind to the terrain.', action: 'use-3d' });
    expect(s.smoke).toEqual({ ok: false, reason: 'Smoke needs the 3-D atmosphere. The fast model does not simulate smoke.', action: 'use-3d' });
  });

  it('with no 3-D wind in the picture every chip is off and nothing offers the switch (it would not help)', () => {
    for (const air of [NONE, SURFACE]) {
      const s = sliceFieldStatuses(air);
      for (const id of SLICE_FIELD_IDS) expect(s[id], `${air.kind} ${id}`).toEqual({ ok: false, reason: NO_AIR_REASON });
    }
  });

  it('a 3-D atmosphere that lacks a field says so without offering the switch', () => {
    const s = sliceFieldStatuses({ kind: 'prognostic', has: { wind: true, theta: true, smoke: false } });
    expect(s.theta).toEqual({ ok: true });
    expect(s.smoke).toMatchObject({ ok: false });
    expect((s.smoke as { action?: string }).action).toBeUndefined();
  });

  it('covers every chip, and each chip needs the field its SLICE_FIELDS entry names', () => {
    expect(Object.keys(sliceFieldStatuses(PROGNOSTIC)).sort()).toEqual([...SLICE_FIELD_IDS].sort());
    expect(SLICE_FIELDS.filter((f) => f.needs !== 'wind').map((f) => f.id)).toEqual(['theta', 'smoke']);
  });
});

describe('effectiveSliceField', () => {
  const p = sliceFieldStatuses(PROGNOSTIC);
  const d = sliceFieldStatuses(DIAGNOSED);
  const n = sliceFieldStatuses(NONE);

  it('with none chosen it is the original curtain colouring: temperature where the air has it, else speed', () => {
    expect(effectiveSliceField(undefined, p)).toBe('theta');
    expect(effectiveSliceField(undefined, d)).toBe('speed');
    expect(effectiveSliceField(undefined, n)).toBe('speed');
  });

  it('the chosen chip is used when the air can give it, else speed', () => {
    for (const id of SLICE_FIELD_IDS) expect(effectiveSliceField(id, p), id).toBe(id);
    expect(effectiveSliceField('along', d)).toBe('along');
    expect(effectiveSliceField('theta', d)).toBe('speed');
    expect(effectiveSliceField('smoke', d)).toBe('speed');
    expect(effectiveSliceField('up', n)).toBe('speed');
  });
});

describe('sliceAirOf and sliceKindOf', () => {
  it('reads the kind and the arrays of a view, old views included', () => {
    expect(sliceAirOf(view('prognostic', true))).toEqual(PROGNOSTIC);
    expect(sliceAirOf(view(undefined, true))).toEqual(PROGNOSTIC); // a view made before `kind` existed
    expect(sliceAirOf(view('diagnosed', false))).toEqual(DIAGNOSED);
    expect(sliceAirOf(view('surface', false))).toEqual(SURFACE);
    expect(sliceAirOf(null)).toEqual(NONE);
    expect(sliceAirOf(undefined)).toEqual(NONE);
  });

  it('only an air with a 3-D wind has a slice kind', () => {
    expect(sliceKindOf(PROGNOSTIC)).toBe('prognostic');
    expect(sliceKindOf(DIAGNOSED)).toBe('diagnosed');
    expect(sliceKindOf(NONE)).toBeNull();
    expect(sliceKindOf(SURFACE)).toBeNull();
  });
});

describe('sectionColouring (the legend and the curtain)', () => {
  it('is the effective chip and the kind of air, or null while there is no 3-D wind', () => {
    expect(sectionColouring(PROGNOSTIC, undefined)).toEqual({ field: 'theta', kind: 'prognostic' });
    expect(sectionColouring(PROGNOSTIC, 'across')).toEqual({ field: 'across', kind: 'prognostic' });
    expect(sectionColouring(DIAGNOSED, undefined)).toEqual({ field: 'speed', kind: 'diagnosed' });
    expect(sectionColouring(DIAGNOSED, 'smoke')).toEqual({ field: 'speed', kind: 'diagnosed' });
    expect(sectionColouring(DIAGNOSED, 'up')).toEqual({ field: 'up', kind: 'diagnosed' });
    expect(sectionColouring(NONE, 'speed')).toBeNull();
    expect(sectionColouring(SURFACE, undefined)).toBeNull();
  });
});

describe('sectionChanged (what makes the scene compute a new slice)', () => {
  const base = (cs: Partial<LayerState['crossSection']> = {}, vex = 1): Pick<LayerState, 'crossSection' | 'verticalExaggeration'> => ({
    crossSection: { enabled: true, azimuth: 90, centre: [100, 200], ...cs },
    verticalExaggeration: vex,
  });

  it('is false for the same section, even in new objects and arrays', () => {
    expect(sectionChanged(base(), base())).toBe(false);
    expect(sectionChanged(base({ a: [1, 2], b: [3, 4], preset: null, field: 'along' }), base({ a: [1, 2], b: [3, 4], preset: null, field: 'along' }))).toBe(false);
    expect(sectionChanged(base({ preset: undefined }), base({ preset: null }))).toBe(false); // absent and null both mean "no preset"
  });

  it('is true when the section is switched on, or anything that makes the line or the colouring changes', () => {
    expect(sectionChanged(base({ enabled: false }), base())).toBe(true);
    expect(sectionChanged(base(), base({ azimuth: 91 }))).toBe(true);
    expect(sectionChanged(base(), base({ centre: [101, 200] }))).toBe(true);
    expect(sectionChanged(base(), base({ centre: [100, 201] }))).toBe(true);
    expect(sectionChanged(base(), base({ a: [1, 2] }))).toBe(true);
    expect(sectionChanged(base({ a: [1, 2] }), base({ a: [1, 3] }))).toBe(true);
    expect(sectionChanged(base({ b: [1, 2] }), base({ b: [2, 2] }))).toBe(true);
    expect(sectionChanged(base(), base({ preset: 'along' }))).toBe(true);
    expect(sectionChanged(base({ preset: 'along' }), base({ preset: 'across' }))).toBe(true);
    expect(sectionChanged(base(), base({ field: 'theta' }))).toBe(true);
    expect(sectionChanged(base({ field: 'speed' }), base({ field: 'up' }))).toBe(true);
    expect(sectionChanged(base(), base({}, 2))).toBe(true);
  });

  it('is true when the line is put back on the centre rule: an explicit undefined and a null preset replace the old A, B and preset', () => {
    const placed = base({ a: [1, 2], b: [3, 4], preset: 'slope' });
    const back = { ...placed, crossSection: { ...placed.crossSection, ...LINE_BY_CENTRE } };
    expect(back.crossSection.a).toBeUndefined();
    expect(sectionChanged(placed, back)).toBe(true);
    expect(sectionChanged(base({ a: [1, 2], b: [3, 4] }), { ...placed, crossSection: { ...placed.crossSection, a: undefined, b: undefined, preset: null } })).toBe(true);
  });
});

describe('the words', () => {
  const all = [NO_AIR_REASON, DIAGNOSED_SECTION_NOTE, DIAGNOSED_STREAKS_NOTE, SWITCHING_NOTE, USE_3D_LABEL, ...Object.values(sliceFieldStatuses(DIAGNOSED)).map((s) => (s.ok ? '' : s.reason))].filter(Boolean);

  it('are plain: sentence case, whole sentences, no em dash', () => {
    for (const t of all) {
      expect(t, t).not.toMatch(/[—–]/);
      expect(t[0], t).toBe(t[0]!.toUpperCase());
    }
    for (const t of all.filter((x) => x !== USE_3D_LABEL)) expect(t, t).toMatch(/[.…]$/);
  });

  it('the section note is the plan’s sentence, and the button says the same as the Air slices panel’s', () => {
    expect(DIAGNOSED_SECTION_NOTE).toBe('This section shows the diagnosed wind (terrain effects only). Use the 3-D atmosphere to see the plume, temperature and smoke.');
    expect(USE_3D_LABEL).toBe(SLICE_USE_3D_LABEL);
  });
});
