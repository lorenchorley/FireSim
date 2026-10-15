import { describe, expect, it } from 'vitest';
import { BurnState, type FireField, type SimSnapshot } from '../core/types';
import { DEFAULT_LAYERS, type LayerState } from '../render/layers';
import { plane, testGrid } from '../terrain/testing/synthetic';
import { mockSectionEnds } from './mockScene';

/**
 * The 2-D stand-in map (`?mock=1`) draws the section line from the same resolver as the 3-D view, by the same precedence
 * (a preset, else A and B, else the chord through the centre along the azimuth). Nothing else checks that drawing: the stand-in
 * is a canvas, so what it draws is read here, before the canvas.
 */
const grid = testGrid(6000, 30);
const terrain = { grid, elevation: plane(grid, 0, 0, 500) };
const cs = (over: Partial<LayerState['crossSection']>): LayerState['crossSection'] => ({ ...DEFAULT_LAYERS.crossSection, enabled: true, ...over });
const input = { terrain, snapshot: null, mapCentre: [0, 0] as [number, number], user: null, halfExtent: 3000 };

/** A snapshot with the wind from the west and, when given, one burning cell (local metres); only what the line reads is real. */
function snapshotWith(fireAt: [number, number] | null): SimSnapshot {
  const n = grid.nx * grid.ny;
  const fire: FireField = {
    grid,
    arrivalTime: new Float32Array(n).fill(Infinity),
    burnState: new Uint8Array(n),
    ros: new Float32Array(n),
    intensity: new Float32Array(n),
    flameHeight: new Float32Array(n),
    spreadDir: new Float32Array(n),
    driver: new Uint8Array(n),
    phase: new Uint8Array(n),
  };
  if (fireAt) {
    const i = Math.round((fireAt[0] - grid.x0) / grid.cellSize);
    const j = Math.round((fireAt[1] - grid.y0) / grid.cellSize);
    fire.burnState[j * grid.nx + i] = BurnState.Burning;
    fire.arrivalTime[j * grid.nx + i] = 0;
    fire.intensity[j * grid.nx + i] = 5000;
  }
  return { fire, time: 60, stats: { weather: { windSpeed10: 8, windDir10: 270 } } } as unknown as SimSnapshot;
}

describe('the 2-D stand-in map draws the line the layers describe', () => {
  it('keeps the old chord through the centre along the azimuth when nothing was placed', () => {
    const e = mockSectionEnds(cs({ azimuth: 90, centre: [100, 200] }), input)!;
    const L = 3000 * 1.4;
    expect(e.a[0]).toBeCloseTo(100 - L, 6);
    expect(e.a[1]).toBeCloseTo(200, 6);
    expect(e.b[0]).toBeCloseTo(100 + L, 6);
    expect(e.b[1]).toBeCloseTo(200, 6);
  });

  it('draws a hand-placed line from A to B, ignoring the centre and the azimuth', () => {
    const e = mockSectionEnds(cs({ azimuth: 0, centre: [900, 900], a: [-1000, -500], b: [1200, -400], preset: null }), input)!;
    expect(e.a).toEqual([-1000, -500]);
    expect(e.b).toEqual([1200, -400]);
  });

  it('draws a preset by the wind and the map centre (there is no fire in the stand-in), and a preset wins over A and B', () => {
    const snapshot = snapshotWith(null);
    const along = mockSectionEnds(cs({ preset: 'along', a: [-1000, -500], b: [1200, -400] }), { ...input, snapshot })!;
    // wind from the west: the line runs west to east through the map centre, 3 km each way
    expect(along.a[0]).toBeLessThan(-2900); // 3 km each way, less what the model rectangle clips
    expect(along.b[0]).toBeGreaterThan(2900);
    expect(along.a[1]).toBeCloseTo(0, 0);
    expect(along.b[1]).toBeCloseTo(0, 0);
    const across = mockSectionEnds(cs({ preset: 'across' }), { ...input, snapshot })!;
    expect(Math.abs(across.a[0])).toBeLessThan(1);
    expect(Math.abs(across.b[1] - across.a[1])).toBeGreaterThan(5000);
  });

  it('runs a preset through the fire when there is one', () => {
    const snapshot = snapshotWith([600, 900]);
    const along = mockSectionEnds(cs({ preset: 'along' }), { ...input, snapshot })!;
    expect(Math.abs(along.a[1] - 900)).toBeLessThan(30); // within the cell the fire is in
    expect(Math.abs(along.b[1] - 900)).toBeLessThan(30);
  });

  it('draws nothing for a preset that cannot be made (Me to fire with no phone position)', () => {
    expect(mockSectionEnds(cs({ preset: 'me' }), input)).toBeNull();
  });

  it('a line put back on the centre rule (a, b and preset cleared) is the chord again', () => {
    const placed = cs({ a: [-1000, 0], b: [1000, 0], preset: 'along' });
    const back = { ...placed, azimuth: 45, centre: [0, 0] as [number, number], a: undefined, b: undefined, preset: null };
    const e = mockSectionEnds(back, input)!;
    expect(e.b[0] - e.a[0]).toBeCloseTo(e.b[1] - e.a[1], 6); // 45 degrees
    expect(Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1])).toBeCloseTo(2 * 3000 * 1.4, 6);
  });
});
