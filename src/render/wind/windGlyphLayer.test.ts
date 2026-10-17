/**
 * The wind glyph layer (Three.js objects built in node, no renderer) with a stub builder and a fake clock: when it builds, how it
 * stages, what it draws and hides, how it trims itself, and that it never makes the frame loop animate.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AtmosphereSampler } from '../atmosphereSampler';
import type { ViewMode } from '../cameraRig';
import { HeightField } from '../heightfield';
import { makeAirView } from '../slice/testing';
import { HALO_INK } from './flowGlyphs';
import { WindGlyphLayer, type GlyphData } from './windGlyphLayer';
import { GLYPH_CAPS, type GlyphBuilder, type GlyphInput, type GlyphOutput, type GlyphTier, type WindHeight } from './glyphTypes';

const shared = (): Record<string, THREE.IUniform> => ({
  uExposure: { value: 1 },
  uFogColour: { value: new THREE.Color(0.5, 0.5, 0.5) },
  uFogDensity: { value: 0 },
  uViewport: { value: new THREE.Vector2(400, 800) },
});

/** A builder that needs `steps` calls to finish and takes `stepMs` of the fake clock for each; `Infinity` finishes in one. */
class StubBuilder implements GlyphBuilder {
  readonly begins: GlyphInput[] = [];
  cancels = 0;
  steps = 2;
  glyphs = 40;
  segments = 400;
  private left = 0;
  private working = false;
  readonly out: GlyphOutput;
  constructor(
    private readonly clock: { t: number },
    tier: GlyphTier,
    private readonly stepMs = 3,
  ) {
    const cap = GLYPH_CAPS[tier].segments;
    this.out = { a: new Float32Array(cap * 3), b: new Float32Array(cap * 3), c: new Float32Array(cap * 4), glyphs: 0, segments: 0, dropped: 0, calm: 0 };
  }
  get busy(): boolean {
    return this.working;
  }
  begin(input: GlyphInput): void {
    this.begins.push(input);
    this.left = this.steps;
    this.working = true;
  }
  step(budgetMs: number): boolean {
    this.clock.t += this.stepMs;
    this.left = budgetMs === Infinity ? 0 : this.left - 1;
    if (this.left > 0) return false;
    const input = this.begins[this.begins.length - 1]!;
    const n = Math.min(this.segments, input.cap.segments);
    for (let i = 0; i < n; i++) {
      this.out.a[i * 3] = i;
      this.out.b[i * 3] = i + 0.5;
      this.out.c[i * 4] = 0.25;
      this.out.c[i * 4 + 3] = 1;
    }
    this.out.segments = n;
    this.out.glyphs = n < this.segments ? Math.ceil(n / 10) : this.glyphs;
    this.working = false;
    return true;
  }
  cancel(): void {
    this.cancels++;
    this.working = false;
  }
}

const CSS = { w: 400, h: 800, fov: 50 };
const GROUND = 500;

interface Rig {
  layer: WindGlyphLayer;
  stub: StubBuilder;
  clock: { t: number };
  /** One frame: the camera looks at (x, 0) from `distance` metres, at the fake time plus `dt`. Returns what `tick` returned. */
  go(distance: number, o?: { x?: number; dt?: number; mode?: ViewMode; tris?: number; settle?: boolean }): boolean;
  instances(name: 'wind-glyph' | 'wind-glyph-halo'): number;
  mesh(name: 'wind-glyph' | 'wind-glyph-halo'): THREE.Mesh;
  fresh(): GlyphData;
}

function rig(o: { tier?: GlyphTier; warm?: boolean; height?: WindHeight; enabled?: boolean; data?: boolean; u?: (x: number, y: number, z: number) => number; drawElevation?: number } = {}): Rig {
  const tier = o.tier ?? 'high';
  const clock = { t: 0 };
  const stub = new StubBuilder(clock, tier);
  const layer = new WindGlyphLayer(shared(), tier, { createBuilder: () => stub, now: () => clock.t, warm: o.warm ?? false });
  const view = makeAirView({ u: o.u ?? (() => 8), v: () => 2, w: () => 0, baseM: GROUND, groundAt: () => GROUND });
  view.surfaceU.fill(8);
  view.surfaceV.fill(2);
  const sampler = new AtmosphereSampler(view, GROUND, null);
  const hf = new HeightField(view.grid, new Float32Array(view.grid.nx * view.grid.ny).fill(GROUND));
  const drawn = new HeightField(view.grid, new Float32Array(view.grid.nx * view.grid.ny).fill(o.drawElevation ?? GROUND));
  const fresh = (): GlyphData => ({ sampler, atm: view, sliceGround: hf, drawGround: drawn });
  if (o.height !== undefined) layer.setHeight(o.height);
  if (o.enabled !== false) layer.setEnabled(true);
  if (o.data !== false) layer.setData(fresh());
  const mesh = (name: string): THREE.Mesh => layer.group.children.find((c) => c.name === name) as THREE.Mesh;
  return {
    layer,
    stub,
    clock,
    fresh,
    mesh: (name) => mesh(name),
    instances: (name) => (mesh(name).geometry as THREE.InstancedBufferGeometry).instanceCount,
    go(distance, g = {}) {
      clock.t += g.dt ?? 0;
      const cam = new THREE.PerspectiveCamera(50, CSS.w / CSS.h, 5, 80000);
      const az = THREE.MathUtils.degToRad(200);
      const po = THREE.MathUtils.degToRad(55);
      const tx = g.x ?? 0;
      cam.position.set(tx + Math.sin(az) * Math.sin(po) * distance, GROUND + Math.cos(po) * distance, -Math.cos(az) * Math.sin(po) * distance);
      cam.lookAt(tx, GROUND, 0);
      cam.updateMatrixWorld();
      return layer.tick(clock.t, cam, CSS, g.mode ?? 'orbit', 1, distance, g.tris ?? 0, g.settle ?? false);
    },
  };
}

// One model cell here is 200 m on a 800 px canvas: cellPx = CELL_PX_KM / distance, so L1 is at 24 km (7 px), L2 at 8 km (21 px),
// L3 at 3.5 km (49 px), L4 at 1.2 km (143 px) and L0 at 60 km (3 px).
const CELL_PX_M = (200 * 800) / (2 * Math.tan(THREE.MathUtils.degToRad(25)));
const L1 = 24000;
const L2 = 8000;
const L3 = 3500;
const L4 = 1200;
const L0 = 60000;

describe('WindGlyphLayer: what is built, when', () => {
  it('draws nothing while it is off, and says so', () => {
    const r = rig({ enabled: false });
    expect(r.go(L2)).toBe(false);
    expect(r.layer.stats()).toMatchObject({ active: false, idle: 'off', level: 0, count: 0 });
    expect(r.stub.begins).toHaveLength(0);
    expect(r.mesh('wind-glyph').visible).toBe(false);
  });

  it('draws nothing without air wind, before the first snapshot or on a view that holds none', () => {
    const none = rig({ data: false });
    expect(none.go(L2)).toBe(false);
    expect(none.layer.stats()).toMatchObject({ active: false, idle: 'no-wind' });
    const r = rig();
    const bare = r.fresh();
    r.layer.setData({ ...bare, atm: null });
    expect(r.go(L2)).toBe(false);
    expect(r.layer.stats().idle).toBe('no-wind');
    const noSurface = rig();
    const d = noSurface.fresh();
    noSurface.layer.setData({ ...d, atm: { ...d.atm!, surfaceU: new Float32Array(0), surfaceV: new Float32Array(0) } });
    expect(noSurface.go(L2)).toBe(false);
    expect(noSurface.layer.stats().idle).toBe('no-wind'); // the "ground" height has no raster to draw
    expect(noSurface.stub.begins).toHaveLength(0);
  });

  it('builds the first picture at once, one slice a frame, and swaps only on the last slice', () => {
    const r = rig();
    expect(r.go(L2)).toBe(false); // begins and runs the first slice
    expect(r.stub.begins).toHaveLength(1);
    expect(r.layer.stats().active).toBe(false);
    expect(r.instances('wind-glyph')).toBe(0);
    expect(r.go(L2)).toBe(true); // the last slice: swapped, a frame must be drawn
    const s = r.layer.stats();
    expect(s).toMatchObject({ active: true, idle: null, level: 2, count: 40, segments: 400, rebuilds: 1, slicesLast: 2, cellM: 200 });
    expect(s.lastMs).toBeCloseTo(6, 9);
    expect(s.cellPx).toBeCloseTo(CELL_PX_M / L2, 6);
    expect(r.instances('wind-glyph')).toBe(400);
    expect(r.instances('wind-glyph-halo')).toBe(400);
    expect(r.mesh('wind-glyph').visible).toBe(true);
    expect(r.mesh('wind-glyph-halo').visible).toBe(true);
  });

  it('leaves a picture alone when nothing changes, and never asks the builder again', () => {
    const r = rig();
    r.go(L2);
    r.go(L2);
    for (let i = 0; i < 50; i++) expect(r.go(L2, { dt: 16 })).toBe(false);
    expect(r.stub.begins).toHaveLength(1);
    expect(r.layer.stats().rebuilds).toBe(1);
  });

  it('copies the builder output into both batches: the same positions, the colours in front, a dark halo behind', () => {
    const r = rig();
    r.go(L2);
    r.go(L2);
    const aOf = (n: 'wind-glyph' | 'wind-glyph-halo'): Float32Array => (r.mesh(n).geometry.getAttribute('aA') as THREE.InstancedBufferAttribute).array as Float32Array;
    const cOf = (n: 'wind-glyph' | 'wind-glyph-halo'): Float32Array => (r.mesh(n).geometry.getAttribute('aC') as THREE.InstancedBufferAttribute).array as Float32Array;
    expect(aOf('wind-glyph')[3 * 7]).toBe(7);
    expect(aOf('wind-glyph-halo')[3 * 7]).toBe(7);
    expect(cOf('wind-glyph')[4 * 7]).toBeCloseTo(0.25, 6);
    const halo = cOf('wind-glyph-halo');
    for (const i of [0, 7, 399, GLYPH_CAPS.high.segments - 1]) {
      expect([halo[i * 4], halo[i * 4 + 1], halo[i * 4 + 2], halo[i * 4 + 3]].map((v) => +v.toFixed(5))).toEqual([HALO_INK[0], HALO_INK[1], HALO_INK[2], 1].map((v) => +v.toFixed(5)));
    }
    expect(r.mesh('wind-glyph-halo').renderOrder).toBeLessThan(r.mesh('wind-glyph').renderOrder);
  });

  it('is two draw calls, one batch for the halo and one for the colour', () => {
    const r = rig();
    expect(r.layer.group.children.map((c) => c.name).sort()).toEqual(['wind-glyph', 'wind-glyph-halo']);
    expect(r.layer.group.name).toBe('wind-glyphs');
  });

  it('holds a camera move back until 250 ms after the last swap, then rebuilds', () => {
    const r = rig();
    r.go(L2);
    r.go(L2); // swapped at the fake time 6 ms
    expect(r.go(L2, { x: 2500, dt: 100 })).toBe(false); // moved 2.5 km: out of date, but too soon
    expect(r.stub.begins).toHaveLength(1);
    expect(r.go(L2, { x: 2500, dt: 100 })).toBe(false);
    expect(r.stub.begins).toHaveLength(1);
    r.go(L2, { x: 2500, dt: 60 }); // 260 ms after the swap
    expect(r.stub.begins).toHaveLength(2);
    expect(r.go(L2, { x: 2500 })).toBe(true);
    expect(r.layer.stats().rebuilds).toBe(2);
  });

  it('judges a camera against the picture it drew, not against the previous frame', () => {
    const r = rig();
    r.go(L2);
    r.go(L2);
    // Eight frames of a slow drift, 60 m each (a tenth of 8 km is 800 m): none is a "move", all together are.
    for (let i = 1; i <= 8; i++) r.go(L2, { x: 60 * i, dt: 300 });
    expect(r.stub.begins).toHaveLength(1);
    for (let i = 9; i <= 14; i++) r.go(L2, { x: 60 * i, dt: 300 });
    expect(r.stub.begins.length).toBeGreaterThan(1);
  });

  it('rebuilds for a new snapshot after the gap, never sooner', () => {
    const r = rig();
    r.go(L2);
    r.go(L2);
    r.layer.setData(r.fresh());
    expect(r.go(L2, { dt: 200 })).toBe(false);
    expect(r.go(L2, { dt: 40 })).toBe(false);
    expect(r.stub.begins).toHaveLength(1);
    r.go(L2, { dt: 20 });
    expect(r.stub.begins).toHaveLength(2);
  });

  it('rebuilds a snapshot that comes after a long rest at once', () => {
    const r = rig();
    r.go(L2);
    r.go(L2);
    r.layer.setData(r.fresh());
    r.go(L2, { dt: 30_000 });
    expect(r.stub.begins).toHaveLength(2);
  });

  it('keeps waiting rebuilds alive on a still camera: the frame loop only has to call tick', () => {
    const r = rig();
    r.go(L2);
    r.go(L2);
    r.layer.setData(r.fresh());
    let swapped = false;
    for (let i = 0; i < 40 && !swapped; i++) swapped = r.go(L2, { dt: 16 }) && r.layer.stats().rebuilds === 2;
    expect(swapped).toBe(true);
  });

  it('finishes in one call when the frame is settled (screenshots, tests), whatever the throttle', () => {
    const r = rig();
    r.go(L2, { settle: true });
    expect(r.layer.stats()).toMatchObject({ active: true, rebuilds: 1, slicesLast: 1 });
    expect(r.go(L3, { settle: true })).toBe(true); // a new level, 3 ms after the last swap
    expect(r.layer.stats()).toMatchObject({ level: 3, rebuilds: 2 });
    expect(r.stub.begins).toHaveLength(2);
  });
});

describe('WindGlyphLayer: the level of detail', () => {
  it('follows how many pixels a model cell covers at the middle of the screen', () => {
    const levels: number[] = [];
    for (const d of [L0, L1, L2, L3, L4]) {
      const r = rig();
      r.go(d, { settle: true });
      levels.push(r.layer.stats().level);
    }
    expect(levels).toEqual([0, 1, 2, 3, 4]);
  });

  it('draws nothing when a model cell is under 4 px, and shows no reason (the zoom is the reason)', () => {
    const r = rig();
    expect(r.go(L0, { settle: true })).toBe(false);
    expect(r.layer.stats()).toMatchObject({ active: false, idle: null, level: 0, count: 0 });
    expect(r.stub.begins).toHaveLength(0);
  });

  it('hands the previous level to the planner, so a pinch hovering at an edge does not flip it', () => {
    // 11.5 px a cell is below the L2 edge (12 px) but inside its 15 % hysteresis: from L2 it stays L2, fresh it is L1.
    const edge = CELL_PX_M / 11.5;
    const r = rig();
    r.go(L2, { settle: true });
    r.go(edge, { settle: true, dt: 1000 });
    expect(r.layer.stats().level).toBe(2);
    const fresh = rig();
    fresh.go(edge, { settle: true });
    expect(fresh.layer.stats().level).toBe(1);
  });

  it('rebuilds when the level changes, after the gap', () => {
    const r = rig();
    r.go(L2);
    r.go(L2);
    expect(r.go(L3, { dt: 100 })).toBe(false);
    expect(r.stub.begins).toHaveLength(1);
    r.go(L3, { dt: 200 });
    expect(r.stub.begins).toHaveLength(2);
    expect(r.go(L3)).toBe(true);
    expect(r.layer.stats().level).toBe(3);
    expect(r.stub.begins[1]!.lod.level).toBe(3);
  });

  it('reads the level from the middle of the screen for the canvas it is given, not from a fixed distance', () => {
    const r = rig();
    r.go(L2, { settle: true });
    const small = r.layer.stats().cellPx;
    const tall = rig();
    const cam = new THREE.PerspectiveCamera(50, 0.5, 5, 80000);
    cam.position.set(0, GROUND + 4500, 6000);
    cam.lookAt(0, GROUND, 0);
    cam.updateMatrixWorld();
    tall.layer.tick(0, cam, { w: 400, h: 1600, fov: 50 }, 'orbit', 1, L2, 0, true);
    expect(tall.layer.stats().cellPx).toBeCloseTo(small * 2, 5);
  });
});

describe('WindGlyphLayer: the view mode', () => {
  it('draws nothing at eye level, says why, and builds again on the way back', () => {
    const r = rig();
    r.go(L2, { settle: true });
    expect(r.layer.stats().active).toBe(true);
    expect(r.go(L2, { mode: 'ground' })).toBe(true); // hiding a picture needs a frame
    expect(r.layer.stats()).toMatchObject({ active: false, idle: 'eye-level', level: 0, count: 0 });
    expect(r.instances('wind-glyph')).toBe(0);
    expect(r.mesh('wind-glyph').visible).toBe(false);
    expect(r.mesh('wind-glyph-halo').visible).toBe(false);
    expect(r.go(L2, { mode: 'ground' })).toBe(false);
    r.go(L2, { settle: true });
    expect(r.layer.stats()).toMatchObject({ active: true, idle: null, level: 2 });
    expect(r.stub.begins).toHaveLength(2);
  });

  it('draws in the plan view too', () => {
    const r = rig();
    r.go(L2, { mode: 'top', settle: true });
    expect(r.layer.stats().active).toBe(true);
  });

  it('is hidden again when it is switched off, and the next frame is drawn', () => {
    const r = rig();
    r.go(L2, { settle: true });
    r.layer.setEnabled(false);
    expect(r.go(L2)).toBe(true);
    expect(r.layer.stats()).toMatchObject({ active: false, idle: 'off' });
    expect(r.instances('wind-glyph')).toBe(0);
    expect(r.go(L2)).toBe(false);
  });

  it('forgets a build under way when it is hidden', () => {
    const r = rig();
    r.go(L2); // one slice done, not swapped
    r.go(L2, { mode: 'ground' });
    expect(r.stub.cancels).toBe(1);
    expect(r.layer.stats().rebuilds).toBe(0);
  });
});

describe('WindGlyphLayer: the height', () => {
  it('fills a raster for a numeric height as a slice of its own, before the first trace slice', () => {
    const r = rig({ height: 300 });
    expect(r.go(L2)).toBe(false);
    expect(r.stub.begins).toHaveLength(0); // the fill took this frame
    r.go(L2);
    expect(r.stub.begins).toHaveLength(1);
    const field = r.stub.begins[0]!.field;
    expect(field.u.length).toBe(field.grid.nx * field.grid.ny);
    expect(field.u[Math.floor(field.u.length / 2)]).toBeCloseTo(8, 3); // the analytic wind, at 300 m, over flat ground
    expect(field.v[Math.floor(field.v.length / 2)]).toBeCloseTo(2, 3);
  });

  it('reads the model 10 m wind as it is, with no copy, for Ground', () => {
    const r = rig({ height: 'fire' });
    r.go(L2);
    const d = r.fresh();
    expect(r.stub.begins[0]!.field.u).toBe(d.atm!.surfaceU);
    expect(r.stub.begins[0]!.field.v).toBe(d.atm!.surfaceV);
    expect(r.stub.begins[0]!.ground).toBe(d.drawGround);
  });

  it('draws on the mesh and takes the numbers from the 10 m ground', () => {
    // A wind that is the height ASL over 100: 100 m above the 10 m ground (500 m) reads 6, wherever the mesh is drawn.
    const r = rig({ height: 100, u: (_x, _y, z) => z / 100, drawElevation: 560 });
    r.go(L2, { settle: true });
    const input = r.stub.begins[0]!;
    expect(input.ground).toBe(r.fresh().drawGround);
    expect(input.ground.elevation[0]).toBe(560);
    expect(input.field.u[Math.floor(input.field.u.length / 2)]).toBeCloseTo(6, 3);
  });

  it('rebuilds at once after the gap when the height changes, and again when it changes back', () => {
    const r = rig();
    r.go(L2, { settle: true });
    r.layer.setHeight(1000);
    r.go(L2, { dt: 300 }); // the raster fill
    r.go(L2); // the trace
    r.go(L2); // the swap
    expect(r.stub.begins).toHaveLength(2);
    expect(r.layer.stats().rebuilds).toBe(2);
    r.layer.setHeight('fire');
    r.go(L2, { dt: 300 });
    expect(r.stub.begins).toHaveLength(3);
    expect(r.stub.begins[2]!.field.u).toBe(r.fresh().atm!.surfaceU);
  });

  it('does not refill the raster for a camera move, only for new air or a new height', () => {
    const r = rig({ height: 300 });
    r.go(L2, { settle: true });
    const first = r.stub.begins[0]!.field;
    r.go(L2, { settle: true, x: 3000, dt: 300 });
    expect(r.stub.begins[1]!.field).toBe(first);
    r.layer.setData(r.fresh());
    r.go(L2, { settle: true, dt: 300 });
    expect(r.stub.begins[2]!.field.u).toBe(first.u); // refilled in place: one raster, never reallocated
  });

  it('throws a build away when its air or height changed under it, and starts the right one', () => {
    const r = rig();
    r.stub.steps = 3;
    r.go(L2); // slice one of three
    r.layer.setHeight(50);
    r.go(L2);
    expect(r.stub.cancels).toBe(1);
    expect(r.layer.stats().rebuilds).toBe(0);
    r.go(L2);
    expect(r.stub.begins).toHaveLength(2);
    expect(r.stub.begins[1]!.field.u).not.toBe(r.fresh().atm!.surfaceU);
  });

  it('throws a build away when the zoom crossed into another level under it', () => {
    const r = rig();
    r.stub.steps = 3;
    r.go(L2); // slice one of three, for level 2
    r.go(L3);
    expect(r.stub.cancels).toBe(1);
    expect(r.stub.begins).toHaveLength(2);
    expect(r.stub.begins[1]!.lod.level).toBe(3);
    r.go(L3);
    r.go(L3);
    expect(r.layer.stats()).toMatchObject({ level: 3, rebuilds: 1 });
  });

  it('lets a build under way finish when only the camera moved', () => {
    const r = rig();
    r.stub.steps = 3;
    r.go(L2);
    r.go(L2, { x: 3000, dt: 20 });
    expect(r.stub.cancels).toBe(0);
    r.go(L2, { x: 3000 });
    expect(r.layer.stats().rebuilds).toBe(1);
  });
});

describe('WindGlyphLayer: what goes to the builder', () => {
  it('gives it the view as it is: the eye, the projection, the canvas, the pixels a metre covers, a box and the tier caps', () => {
    const r = rig();
    r.go(L3, { settle: true });
    const input = r.stub.begins[0]!;
    expect(input.cssW).toBe(400);
    expect(input.cssH).toBe(800);
    expect(input.pxPerMetre1).toBeCloseTo(800 / (2 * Math.tan((25 * Math.PI) / 180)), 6);
    expect(input.near).toBe(5);
    expect(input.eye[1]).toBeGreaterThan(GROUND);
    expect(input.viewProj).toHaveLength(16);
    expect(input.cap).toEqual({ glyphs: GLYPH_CAPS.high.glyphs, segments: GLYPH_CAPS.high.segments });
    expect(input.box.x1).toBeGreaterThan(input.box.x0);
    expect(input.box.y1).toBeGreaterThan(input.box.y0);
    expect(input.box.x1).toBeLessThanOrEqual(3000 + 1e-6); // the model's domain: 31 columns of 200 m
    expect(input.lod.level).toBe(3);
    expect(typeof input.now()).toBe('number');
  });

  it('projects a ground point inside the box onto the screen with the matrix it was given', () => {
    const r = rig();
    r.go(L3, { settle: true });
    const input = r.stub.begins[0]!;
    const m = input.viewProj;
    const clip = (x: number, y: number, z: number): [number, number, number] => {
      const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
      return [(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w, (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w, w];
    };
    const [sx, sy, w] = clip(0, GROUND, 0); // the target: the middle of the screen
    expect(sx).toBeCloseTo(0, 5);
    expect(sy).toBeCloseTo(0, 5);
    expect(w).toBeCloseTo(L3, 3);
  });

  it('grows the box by a margin, so a small pan does not leave it', () => {
    const r = rig();
    r.go(L3, { settle: true });
    const wide = r.stub.begins[0]!.box;
    expect(wide.x1 - wide.x0).toBeGreaterThan(0);
    r.go(L3, { settle: true, x: 60, dt: 300 }); // 60 m is no move at 3.5 km (it takes 350 m) and the visible ground is still inside the box
    expect(r.stub.begins).toHaveLength(1);
  });

  it('passes the exaggeration and the tier caps through', () => {
    const r = rig({ tier: 'low' });
    r.go(L3, { settle: true });
    expect(r.stub.begins[0]!.cap).toEqual({ glyphs: GLYPH_CAPS.low.glyphs, segments: GLYPH_CAPS.low.segments });
  });
});

describe('WindGlyphLayer: the triangle budget', () => {
  it('trims the segment cap to the room the last frame left, at the start and again at the swap', () => {
    const r = rig();
    r.go(L3, { tris: 549_000 });
    expect(r.stub.begins[0]!.cap.segments).toBe(250); // (550,000 - 549,000) / 4
    r.go(L3, { tris: 549_000 });
    expect(r.layer.stats().segments).toBe(250);
    expect(r.instances('wind-glyph')).toBe(250);
    expect(r.instances('wind-glyph-halo')).toBe(250);
    expect(r.layer.stats().count).toBeLessThan(40);
  });

  it('does not count its own segments as somebody else is using the room', () => {
    const r = rig();
    r.go(L3, { settle: true });
    expect(r.layer.stats().segments).toBe(400); // 1,600 triangles of ours in the next frame's figure
    r.go(L3, { settle: true, x: 3000, dt: 300, tris: 549_000 });
    // 549,000 - 1,600 are the others': (550,000 - 547,400) / 4 = 650 segments fit.
    expect(r.stub.begins[1]!.cap.segments).toBe(650);
  });

  it('keeps the full cap when the frame has room, on every tier', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const r = rig({ tier });
      r.go(L3, { settle: true, tris: 400_000 });
      expect(r.stub.begins[0]!.cap.segments).toBe(GLYPH_CAPS[tier].segments);
    }
  });
});

describe('WindGlyphLayer: the first switch-on', () => {
  it('warms the tracer once with a throw-away 48 glyph rebuild that is never drawn', () => {
    const r = rig({ warm: true, enabled: false });
    expect(r.stub.begins).toHaveLength(0);
    r.layer.setEnabled(true);
    expect(r.stub.begins).toHaveLength(1);
    expect(r.stub.begins[0]!.cap.glyphs).toBe(48);
    expect(r.stub.begins[0]!.lod.curved).toBe(true);
    expect(r.layer.stats()).toMatchObject({ active: false, rebuilds: 0, count: 0 });
    expect(r.instances('wind-glyph')).toBe(0);
    r.layer.setEnabled(false);
    r.layer.setEnabled(true);
    expect(r.stub.begins).toHaveLength(1);
  });

  it('does not warm anything while it stays off', () => {
    const r = rig({ warm: true, enabled: false });
    r.go(L2);
    expect(r.stub.begins).toHaveLength(0);
  });
});

describe('WindGlyphLayer: strokes and statistics', () => {
  const widthOf = (m: THREE.Mesh): number => (m.material as THREE.ShaderMaterial).uniforms.uWidthPx!.value as number;

  it('bakes the stroke widths at the device pixel ratio: 2.5 px of colour on 5 px of halo', () => {
    const r = rig();
    r.layer.setDpr(1);
    expect(widthOf(r.mesh('wind-glyph'))).toBe(2.5);
    expect(widthOf(r.mesh('wind-glyph-halo'))).toBe(5);
    r.layer.setDpr(2);
    expect(widthOf(r.mesh('wind-glyph'))).toBe(5);
    expect(widthOf(r.mesh('wind-glyph-halo'))).toBe(10);
  });

  it('draws plain, opaque, unfogged strokes tested against the ground', () => {
    const r = rig();
    for (const name of ['wind-glyph', 'wind-glyph-halo'] as const) {
      const u = (r.mesh(name).material as THREE.ShaderMaterial).uniforms;
      expect(u.uHeadPx!.value).toBe(0);
      expect(u.uTailAlpha!.value).toBe(1);
      expect(u.uFog!.value).toBe(0);
      expect((r.mesh(name).material as THREE.ShaderMaterial).depthTest).toBe(true);
      expect((r.mesh(name).material as THREE.ShaderMaterial).depthWrite).toBe(false);
    }
  });

  it('reports the rebuild times: slices of the last rebuild, the p95 and the largest slice', () => {
    const r = rig();
    r.go(L2, { settle: true });
    for (let i = 0; i < 5; i++) {
      const x = 3000 * (i % 2 ? 1 : -1);
      r.go(L2, { x, dt: 300 });
      r.go(L2, { x });
    }
    const s = r.layer.stats();
    expect(s.rebuilds).toBe(6);
    expect(s.slicesLast).toBe(2);
    expect(s.lastMs).toBeCloseTo(6, 9);
    expect(s.sliceMaxMs).toBeCloseTo(3, 9);
    expect(s.sliceP95Ms).toBeCloseTo(3, 9);
  });

  it('disposes its batches', () => {
    const r = rig();
    let disposed = 0;
    for (const name of ['wind-glyph', 'wind-glyph-halo'] as const) {
      r.mesh(name).geometry.addEventListener('dispose', () => disposed++);
    }
    r.layer.dispose();
    expect(disposed).toBe(2);
  });
});

describe('the layer and the frame loop (source pins)', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
  const scene = read('../SceneView.ts');

  it('WindArrows and ?arrows as a fixed lattice are gone; ?arrows=1 now switches the glyphs on', () => {
    expect(read('../windLayer.ts')).not.toMatch(/WindArrows/);
    expect(scene).not.toMatch(/WindArrows|windArrows|setWindArrows|updateWindArrows/);
    const dev = read('../dev.ts');
    expect(dev).not.toMatch(/windArrows/);
    expect(dev).toMatch(/windGlyphs: q\.get\('arrows'\) === '1'/);
  });

  it('never switches the frame loop on: the glyph layer is not part of `animating`', () => {
    const animating = /const animating =([\s\S]*?);\n/.exec(scene)![1]!;
    expect(animating).not.toMatch(/glyph/i);
  });

  it('is ticked every frame, before the idle return, with the settle flag of renderNow', () => {
    const tick = scene.indexOf('this.glyphs.tick(');
    const idle = scene.indexOf('if (!this.dirty && !moved && !animating)');
    expect(tick).toBeGreaterThan(0);
    expect(idle).toBeGreaterThan(tick);
    expect(scene.slice(tick, tick + 220)).toContain('this.settleNow');
  });

  it('reaches the view through stats() and windGlyphStats()', () => {
    expect(scene).toMatch(/windGlyphs: \{ level: g\.level, count: g\.count \}/);
    expect(scene).toMatch(/windGlyphStats\(\): WindGlyphStats/);
  });
});
