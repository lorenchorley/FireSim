import { describe, expect, it } from 'vitest';
import { has3dAtmosphere } from './context';

describe('has3dAtmosphere: the kind of the view decides, not whether it has levels (plan 7.4)', () => {
  it('is true for the time-stepped air, with or without the kind stamp', () => {
    expect(has3dAtmosphere({ atmosphere: { nz: 20, kind: 'prognostic' } })).toBe(true);
    expect(has3dAtmosphere({ atmosphere: { nz: 20 } })).toBe(true); // a view made before `kind` existed
  });
  it('is false for the fast tier’s diagnosed wind, although it has 20 levels', () => {
    expect(has3dAtmosphere({ atmosphere: { nz: 20, kind: 'diagnosed' } })).toBe(false);
  });
  it('is false for a surface-only view and for no picture', () => {
    expect(has3dAtmosphere({ atmosphere: { nz: 0 } })).toBe(false);
    expect(has3dAtmosphere({ atmosphere: null })).toBe(false);
    expect(has3dAtmosphere({})).toBe(false);
    expect(has3dAtmosphere(null)).toBe(false);
    expect(has3dAtmosphere(undefined)).toBe(false);
  });
});
