/**
 * The wind glyph layer (Three.js objects built in node, no renderer) with stub builders and a fake clock: when it builds, how it
 * stages, what it draws and hides, how it trims itself, and that the frame loop animates only for the detailed streaks of the most
 * detailed level (0.6.0): which picture each level draws, how they fade and hand over, reduced motion, the budget.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AtmosphereSampler } from '../atmosphereSampler';
import type { ViewMode } from '../cameraRig';
import { HeightField } from '../heightfield';
import { StreakBatch } from '../streaks';
import { makeAirView } from '../slice/testing';
import { HALO_INK } from './flowGlyphs';
import { FILL_ROWS_PER_CHECK } from './glyphField';
import { GLYPH_DEPTH_BIAS_M, WindGlyphLayer, type GlyphData, type PrecompileTarget } from './windGlyphLayer';
import { DETAIL_FADE_IN_MS, DETAIL_FADE_OUT_MS, DETAIL_GEOMETRY, DETAIL_MIN_SEGMENTS, DETAIL_RELIEF, FRAME_TRIANGLE_LIMIT, GLYPH_CAPS, type CrownSource, type DetailBuilder, type DetailInput, type DetailOutput, type GlyphBuilder, type GlyphInput, type GlyphOutput, type GlyphTier, type WindHeight } from './glyphTypes';

const shared = (): Record<string, THREE.IUniform> => ({
  uExposure: { value: 1 },
  uFogColour: { value: new THREE.Color(0.5, 0.5, 0.5) },
  uFogDensity: { value: 0 },
  uViewport: { value: new THREE.Vector2(400, 800) },
});

/** A builder that needs `steps` calls to finish and takes `stepMs` of the fake clock for each; `Infinity` finishes in one. */
abstract class StubBase<I extends GlyphInput> {
  readonly begins: I[] = [];
  /** The budget (ms) of every `step` call, in order. */
  readonly budgets: number[] = [];
  cancels = 0;
  steps = 2;
  glyphs = 40;
  segments = 400;
  private left = 0;
  private working = false;
  constructor(
    private readonly clock: { t: number },
    public stepMs = 3,
  ) {}
  get busy(): boolean {
    return this.working;
  }
  begin(input: I): void {
    this.begins.push(input);
    this.left = this.steps;
    this.working = true;
  }
  protected abstract write(n: number, count: number): void;
  step(budgetMs: number): boolean {
    this.budgets.push(budgetMs);
    this.clock.t += this.stepMs;
    this.left = budgetMs === Infinity ? 0 : this.left - 1;
    if (this.left > 0) return false;
    const input = this.begins[this.begins.length - 1]!;
    const n = Math.min(this.segments, input.cap.segments);
    this.write(n, n < this.segments ? Math.ceil(n / 10) : this.glyphs);
    this.working = false;
    return true;
  }
  cancel(): void {
    this.cancels++;
    this.working = false;
  }
}

class StubBuilder extends StubBase<GlyphInput> implements GlyphBuilder {
  readonly out: GlyphOutput;
  constructor(clock: { t: number }, tier: GlyphTier, stepMs = 3) {
    super(clock, stepMs);
    const cap = GLYPH_CAPS[tier].segments;
    this.out = { a: new Float32Array(cap * 3), b: new Float32Array(cap * 3), c: new Float32Array(cap * 4), glyphs: 0, segments: 0, dropped: 0, calm: 0 };
  }
  protected write(n: number, count: number): void {
    for (let i = 0; i < n; i++) {
      this.out.a[i * 3] = i;
      this.out.b[i * 3] = i + 0.5;
      this.out.c[i * 4] = 0.25;
      this.out.c[i * 4 + 3] = 1;
    }
    this.out.segments = n;
    this.out.glyphs = count;
  }
}

/** The same for the detailed streaks: segment i is at x = i with the line's numbers (seed, speed, tail) written so a copy can be told apart. */
class StubDetail extends StubBase<DetailInput> implements DetailBuilder {
  readonly out: DetailOutput;
  constructor(clock: { t: number }, tier: GlyphTier, stepMs = 3) {
    super(clock, stepMs);
    const cap = GLYPH_CAPS[tier].segments;
    this.out = { a: new Float32Array(cap * 3), b: new Float32Array(cap * 3), c: new Float32Array(cap * 4), d: new Float32Array(cap * 4), e: new Float32Array(cap * 4), lines: 0, segments: 0, dropped: 0, calm: 0, steep: 0, blocked: 0 };
  }
  protected write(n: number, count: number): void {
    for (let i = 0; i < n; i++) {
      this.out.a[i * 3] = i;
      this.out.b[i * 3] = i + 0.5;
      this.out.c[i * 4] = 0.5;
      this.out.c[i * 4 + 3] = 1;
      this.out.d.set([i * 9, i * 9 + 9, 150, 0.25], i * 4);
      this.out.e.set([6, 0.5, 0, 40], i * 4);
    }
    this.out.segments = n;
    this.out.lines = count;
  }
}

const CSS = { w: 400, h: 800, fov: 50 };
const GROUND = 500;

/** The camera of these tests: `distance` metres from the ground point (x, 0), looking at it from the south-south-west at 55 degrees from the vertical. */
function cameraAt(distance: number, x = 0): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, CSS.w / CSS.h, 5, 80000);
  const az = THREE.MathUtils.degToRad(200);
  const po = THREE.MathUtils.degToRad(55);
  cam.position.set(x + Math.sin(az) * Math.sin(po) * distance, GROUND + Math.cos(po) * distance, -Math.cos(az) * Math.sin(po) * distance);
  cam.lookAt(x, GROUND, 0);
  cam.updateMatrixWorld();
  return cam;
}

let gcFn: (() => void) | null = null;
function gc(): void {
  if (!gcFn) {
    v8.setFlagsFromString('--expose-gc');
    gcFn = vm.runInNewContext('gc') as () => void;
  }
  gcFn();
}

interface Rig {
  layer: WindGlyphLayer;
  stub: StubBuilder;
  /** The builder of the detailed streaks (what the most detailed level builds with). */
  detail: StubDetail;
  clock: { t: number };
  /** One frame: the camera looks at (x, 0) from `distance` metres, at the fake time plus `dt`. Returns what `tick` returned. */
  go(distance: number, o?: { x?: number; dt?: number; mode?: ViewMode; tris?: number; settle?: boolean }): boolean;
  instances(name: 'wind-glyph' | 'wind-glyph-halo' | 'wind-detail'): number;
  mesh(name: 'wind-glyph' | 'wind-glyph-halo' | 'wind-detail'): THREE.Mesh;
  fresh(): GlyphData;
}

function rig(
  o: {
    tier?: GlyphTier;
    height?: WindHeight;
    enabled?: boolean;
    data?: boolean;
    u?: (x: number, y: number, z: number) => number;
    drawElevation?: number;
    windMs?: number;
    /** The ground (m ASL) of the air view and of both rasters; with it the layer builds its detailed streaks with the real builder, not the stub. */
    groundAt?: (x: number, y: number) => number;
  } = {},
): Rig {
  const tier = o.tier ?? 'high';
  const clock = { t: 0 };
  const stub = new StubBuilder(clock, tier);
  const detail = new StubDetail(clock, tier);
  const layer = new WindGlyphLayer(shared(), tier, { createBuilder: () => stub, ...(o.groundAt ? {} : { createDetailBuilder: () => detail }), now: () => clock.t });
  const view = makeAirView({ u: o.u ?? (() => 8), v: () => 2, w: () => 0, baseM: GROUND, groundAt: o.groundAt ?? (() => GROUND) });
  view.surfaceU.fill(8);
  view.surfaceV.fill(2);
  const sampler = new AtmosphereSampler(view, GROUND, null);
  if (o.windMs) {
    // Every wind lookup of a raster fill costs `windMs` of the fake clock: a texel has a price, so the length of a slice can be asserted.
    const real = sampler.windP.bind(sampler);
    sampler.windP = (pos, out) => {
      clock.t += o.windMs!;
      real(pos, out);
    };
  }
  const raster = (at: (x: number, y: number) => number): Float32Array => {
    const e = new Float32Array(view.grid.nx * view.grid.ny);
    for (let k = 0; k < e.length; k++) e[k] = at(view.grid.x0 + (k % view.grid.nx) * view.grid.cellSize, view.grid.y0 + Math.floor(k / view.grid.nx) * view.grid.cellSize);
    return e;
  };
  const hf = new HeightField(view.grid, o.groundAt ? raster(o.groundAt) : new Float32Array(view.grid.nx * view.grid.ny).fill(GROUND));
  const drawn = new HeightField(view.grid, o.groundAt ? raster(o.groundAt) : new Float32Array(view.grid.nx * view.grid.ny).fill(o.drawElevation ?? GROUND));
  const fresh = (): GlyphData => ({ sampler, atm: view, sliceGround: hf, drawGround: drawn });
  if (o.height !== undefined) layer.setHeight(o.height);
  if (o.enabled !== false) layer.setEnabled(true);
  if (o.data !== false) layer.setData(fresh());
  const mesh = (name: string): THREE.Mesh => layer.group.children.find((c) => c.name === name) as THREE.Mesh;
  return {
    layer,
    stub,
    detail,
    clock,
    fresh,
    mesh: (name) => mesh(name),
    instances: (name) => (mesh(name).geometry as THREE.InstancedBufferGeometry).instanceCount,
    go(distance, g = {}) {
      clock.t += g.dt ?? 0;
      return layer.tick(clock.t, cameraAt(distance, g.x ?? 0), CSS, g.mode ?? 'orbit', 1, distance, g.tris ?? 0, g.settle ?? false);
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

  it('allocates nothing on a frame where nothing changed (the whole idle cost of a map at rest)', () => {
    // Bytes a frame, as atmosphereSampler.alloc.test.ts measures them: inlining off (so that escape analysis cannot hide an
    // allocation), the median heap growth of 41 windows, no collection inside.
    v8.setFlagsFromString('--no-turbo-inlining');
    try {
      const r = rig();
      r.go(L2, { settle: true });
      const cam = cameraAt(L2);
      const WINDOW = 500;
      const frames = (n: number): void => {
        for (let i = 0; i < n; i++) r.layer.tick(r.clock.t, cam, CSS, 'orbit', 1, L2, 0, false);
      };
      frames(20_000); // the JIT first
      gc();
      gc();
      const grown: number[] = [];
      for (let k = 0; k < 41; k++) {
        const a0 = process.memoryUsage().heapUsed;
        frames(WINDOW);
        grown.push(process.memoryUsage().heapUsed - a0);
      }
      grown.sort((a, b) => a - b);
      const perFrame = grown[grown.length >> 1]! / WINDOW;
      expect(r.stub.begins).toHaveLength(1);
      expect(perFrame, 'bytes a frame').toBeLessThan(2);
    } finally {
      v8.setFlagsFromString('--turbo-inlining');
    }
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

  it('is three batches of which at most two are drawn at once: the halo and the colour of the glyphs, or the detailed streaks alone', () => {
    const r = rig();
    expect(r.layer.group.children.map((c) => c.name).sort()).toEqual(['wind-detail', 'wind-glyph', 'wind-glyph-halo']);
    expect(r.layer.group.name).toBe('wind-glyphs');
    expect(r.layer.group.children.map((c) => c.visible)).toEqual([false, false, false]); // nothing is drawn until a picture is swapped in
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
    // Refilled in place into one of the engine's two storages, used in turn (a build still tracing the last raster is never overwritten):
    // the second fill is in the other one, the third is back in the first. Nothing is reallocated.
    const second = r.stub.begins[2]!.field;
    expect(second.u).not.toBe(first.u);
    r.layer.setData(r.fresh());
    r.go(L2, { settle: true, dt: 300 });
    expect(r.stub.begins[3]!.field.u).toBe(first.u);
    r.layer.setData(r.fresh());
    r.go(L2, { settle: true, dt: 300 });
    expect(r.stub.begins[4]!.field.u).toBe(second.u);
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

describe('WindGlyphLayer: the raster fill in clocked slices', () => {
  // 31 columns of 200 m: at L4 (a model cell over 60 px) the raster is made at half spacing, 61 x 61 texels. L4 builds the detailed streaks,
  // so these tests read what the detail builder was given (`r.detail`): the fill is the glyphs' own, the same for both.
  const TEXELS = 61 * 61;
  const ROW_BATCH_MS = (rows: number, ms: number): number => rows * 61 * ms;
  const SLICE_MS = 8;

  it('is cut into slices that stop on the clock: none passes 8 ms by more than a batch of rows, and the trace starts after the last one', () => {
    const MS = 0.01; // 37 ms of lookups for the whole raster
    const r = rig({ height: 100, windMs: MS });
    expect(TEXELS * MS).toBeGreaterThan(4 * SLICE_MS);
    let fillFrames = 0;
    while (r.detail.begins.length === 0) {
      r.go(L4, { dt: 16 });
      if (r.detail.begins.length === 0) fillFrames++;
      if (fillFrames > 50) throw new Error('the fill did not finish');
    }
    expect(fillFrames, 'frames of fill, one slice each, before the trace begins').toBeGreaterThanOrEqual(4);
    expect(fillFrames).toBeLessThanOrEqual(Math.ceil((TEXELS * MS) / SLICE_MS) + 1);
    expect(r.layer.stats().sliceMaxMs).toBeLessThanOrEqual(SLICE_MS + ROW_BATCH_MS(FILL_ROWS_PER_CHECK, MS) + 1e-9);
    expect(r.layer.stats().sliceMaxMs).toBeGreaterThanOrEqual(SLICE_MS - 1e-9); // and it used the slice, it did not stop early
    r.go(L4);
    expect(r.layer.stats()).toMatchObject({ active: true, idle: null, level: 4, rebuilds: 1, slicesLast: fillFrames + 2 });
    // The raster the builder got is complete: the analytic wind at every texel.
    const field = r.detail.begins[0]!.field;
    expect(field.grid.nx).toBe(61);
    for (let k = 0; k < field.u.length; k++) expect(field.u[k]!).toBeCloseTo(8, 3);
  });

  it('is one slice, as before, when the whole fill fits the budget', () => {
    const r = rig({ height: 100, windMs: 0.0005 }); // 1.9 ms
    r.go(L4);
    expect(r.detail.begins).toHaveLength(0); // the fill took this frame
    r.go(L4);
    expect(r.detail.begins).toHaveLength(1);
    r.go(L4);
    expect(r.layer.stats()).toMatchObject({ rebuilds: 1, slicesLast: 3 }); // one slice of fill, two of trace
    expect(r.layer.stats().sliceMaxMs).toBeLessThan(SLICE_MS);
  });

  it('is finished in one call when the frame is settled, whatever the budget', () => {
    const r = rig({ height: 100, windMs: 0.01 });
    r.go(L4, { settle: true });
    expect(r.detail.begins).toHaveLength(1);
    expect(r.layer.stats()).toMatchObject({ active: true, rebuilds: 1, slicesLast: 2 });
    expect(r.layer.stats().sliceMaxMs).toBeGreaterThan(30); // one unclocked slice of the whole fill
  });

  it('is thrown away when the height changes under it: the raster that is traced is the new height\'s, whole, with no texel of the old one', () => {
    const r = rig({ height: 100, windMs: 0.01, u: (_x, _y, z) => z / 100 }); // 100 m above the 500 m ground reads 6, 50 m reads 5.5
    r.go(L4, { dt: 16 });
    r.go(L4, { dt: 16 });
    expect(r.detail.begins).toHaveLength(0); // still filling
    r.layer.setHeight(50);
    for (let i = 0; i < 40 && r.detail.begins.length === 0; i++) r.go(L4, { dt: 16 });
    expect(r.detail.begins).toHaveLength(1);
    const field = r.detail.begins[0]!.field;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < field.u.length; k++) {
      lo = Math.min(lo, field.u[k]!);
      hi = Math.max(hi, field.u[k]!);
    }
    expect(lo).toBeCloseTo(5.5, 3);
    expect(hi).toBeCloseTo(5.5, 3);
  });

  it('is dropped when the layer hides (eye level) in the middle of it, and fills whole on the way back', () => {
    const r = rig({ height: 100, windMs: 0.01, u: (_x, _y, z) => z / 100 });
    r.go(L4, { dt: 16 });
    r.go(L4, { mode: 'ground', dt: 16 });
    expect(r.layer.stats().idle).toBe('eye-level');
    for (let i = 0; i < 40 && r.detail.begins.length === 0; i++) r.go(L4, { dt: 16 });
    expect(r.detail.begins).toHaveLength(1);
    const field = r.detail.begins[0]!.field;
    for (let k = 0; k < field.u.length; k++) expect(field.u[k]!).toBeCloseTo(6, 3);
  });

  it('does not refill for a camera move or a level change at the same refinement, and never traces a half filled raster', () => {
    const r = rig({ height: 100, windMs: 0.01 });
    for (let i = 0; i < 40 && r.layer.stats().rebuilds === 0; i++) r.go(L4, { dt: 16 });
    const first = r.detail.begins[0]!.field;
    r.go(L4, { x: 3000, dt: 300 });
    r.go(L4, { x: 3000 });
    expect(r.detail.begins).toHaveLength(2);
    expect(r.detail.begins[1]!.field).toBe(first); // the same raster, straight to the trace
  });

  it('keeps `Ground` free of a fill: the model raster is traced at once', () => {
    const r = rig({ height: 'fire', windMs: 0.01 });
    r.go(L4);
    expect(r.detail.begins).toHaveLength(1);
    r.go(L4);
    expect(r.layer.stats()).toMatchObject({ rebuilds: 1, slicesLast: 2 }); // the trace's two slices, no fill
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

  it('says `budget` when the rest of the frame already fills the limit: nothing drawn, and the reason stays while it does', () => {
    const r = rig();
    r.go(L3, { tris: 560_000, settle: true }); // the other layers alone are over 550,000 triangles
    expect(r.layer.stats()).toMatchObject({ active: false, idle: 'budget', level: 3, count: 0, segments: 0, rebuilds: 1 });
    expect(r.instances('wind-glyph')).toBe(0);
    expect(r.mesh('wind-glyph').visible).toBe(false);
    expect(r.mesh('wind-glyph-halo').visible).toBe(false);
    // A still camera in the same crowded frame asks for nothing and does not flap (the stub counts every rebuild).
    for (let i = 0; i < 60; i++) expect(r.go(L3, { dt: 300, tris: 560_000 })).toBe(false);
    expect(r.layer.stats()).toMatchObject({ idle: 'budget', rebuilds: 1 });
    expect(r.stub.begins).toHaveLength(1);
  });

  it('says `budget` too when the build began with room and the frame filled up before the swap', () => {
    const r = rig();
    r.go(L3, { tris: 100_000 }); // the first slice, with room
    expect(r.stub.begins[0]!.cap.segments).toBe(GLYPH_CAPS.high.segments);
    r.go(L3, { tris: 551_000 }); // the swap: the room is gone
    expect(r.layer.stats()).toMatchObject({ active: false, idle: 'budget', segments: 0, count: 0 });
  });

  it('does not say `budget` while some of the picture fits, even a little', () => {
    const r = rig();
    r.go(L3, { tris: 549_000, settle: true }); // room for 250 segments
    expect(r.layer.stats()).toMatchObject({ active: true, idle: null, segments: 250 });
    const none = rig();
    none.go(L3, { tris: 550_000, settle: true }); // exactly full: not one segment
    expect(none.layer.stats()).toMatchObject({ active: false, idle: 'budget', segments: 0 });
  });

  it('builds the picture again when the frame has room, without a camera move, and the reason goes', () => {
    const r = rig();
    r.go(L3, { tris: 560_000, settle: true });
    expect(r.layer.stats().idle).toBe('budget');
    // A layer was switched off: the next frame is drawn with 400,000 triangles.
    r.go(L3, { dt: 100, tris: 400_000 });
    expect(r.stub.begins).toHaveLength(1); // the 250 ms gap since the last swap holds it back, as for any rebuild
    r.go(L3, { dt: 200, tris: 400_000 });
    expect(r.stub.begins).toHaveLength(2);
    expect(r.stub.begins[1]!.cap.segments).toBe(GLYPH_CAPS.high.segments);
    r.go(L3, { tris: 400_000 });
    expect(r.layer.stats()).toMatchObject({ active: true, idle: null, segments: 400 });
  });

  it('waits for real room before it tries again: a tenth of the tier cap, not a handful of segments', () => {
    const r = rig();
    r.go(L3, { tris: 560_000, settle: true });
    const tenth = GLYPH_CAPS.high.segments / 10;
    r.go(L3, { dt: 1000, tris: 550_000 - 4 * (tenth - 1) }); // room for one segment fewer than a tenth
    r.go(L3, { dt: 1000, tris: 550_000 - 4 * (tenth - 1) });
    expect(r.stub.begins).toHaveLength(1);
    expect(r.layer.stats().idle).toBe('budget');
    r.go(L3, { dt: 1000, tris: 550_000 - 4 * tenth });
    expect(r.stub.begins).toHaveLength(2);
  });

  it('keeps saying `budget` through a camera move that finds the frame still full, and a build begun with no room stays `budget` at its swap', () => {
    const r = rig();
    r.go(L3, { tris: 560_000, settle: true });
    r.go(L3, { x: 3000, dt: 300, tris: 560_000 }); // a rebuild for the new pose: starts, one slice
    expect(r.stub.begins).toHaveLength(2);
    expect(r.stub.begins[1]!.cap.segments).toBe(0);
    expect(r.layer.stats().idle).toBe('budget');
    // The frame has room by the time it swaps, but the build was given none and drew nothing: still `budget`, never "Showing flow lines" over nothing.
    r.go(L3, { x: 3000, tris: 480_000 });
    expect(r.layer.stats()).toMatchObject({ active: false, idle: 'budget', segments: 0, rebuilds: 2 });
    // And the room is used at once: the next build (the 250 ms gap) has it.
    r.go(L3, { x: 3000, dt: 300, tris: 480_000 });
    r.go(L3, { x: 3000, tris: 480_000 });
    expect(r.stub.begins).toHaveLength(3);
    expect(r.layer.stats()).toMatchObject({ active: true, idle: null, segments: 400, rebuilds: 3 });
  });

  it('forgets `budget` when it hides: eye level and switching off give their own reasons, and the next build starts clean', () => {
    const r = rig();
    r.go(L3, { tris: 560_000, settle: true });
    expect(r.go(L3, { mode: 'ground', tris: 560_000 })).toBe(false); // nothing was shown, so nothing to redraw
    expect(r.layer.stats().idle).toBe('eye-level');
    r.go(L3, { dt: 300, tris: 400_000, settle: true });
    expect(r.layer.stats()).toMatchObject({ active: true, idle: null });
    r.go(L3, { tris: 560_000, x: 3000, dt: 300, settle: true });
    expect(r.layer.stats().idle).toBe('budget');
    r.layer.setEnabled(false);
    r.go(L3);
    expect(r.layer.stats().idle).toBe('off');
    r.layer.setEnabled(true);
    r.go(L3, { dt: 300, tris: 400_000, settle: true });
    expect(r.layer.stats()).toMatchObject({ active: true, idle: null });
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
  // A throw-away warm-up rebuild used to run inside setEnabled (12 to 21 ms at 4x CPU) and bought nothing: in the real app at 4x CPU the first
  // picture took 46 to 59 ms of work with it (the warm-up included) and 30 to 64 ms without, so the first picture is just built, in clocked slices.
  it('does no work by itself: switching on makes no rebuild, not even a throw-away one', () => {
    const clock = { t: 0 };
    const stub = new StubBuilder(clock, 'high');
    const layer = new WindGlyphLayer(shared(), 'high', { createBuilder: () => stub, now: () => clock.t }); // the defaults, as the app builds it
    layer.setEnabled(true);
    expect(stub.begins).toHaveLength(0);
    expect(clock.t).toBe(0);
    expect(layer.stats()).toMatchObject({ active: false, rebuilds: 0, count: 0, slicesLast: 0 });
    layer.setEnabled(false);
    layer.setEnabled(true);
    expect(stub.begins).toHaveLength(0);
  });

  it('builds the first picture from the real air, as the first and only rebuild', () => {
    const r = rig();
    r.layer.setEnabled(false);
    r.layer.setEnabled(true);
    r.go(L3);
    expect(r.stub.begins).toHaveLength(1);
    const input = r.stub.begins[0]!;
    expect(input.field.grid.nx).toBe(r.fresh().atm!.grid.nx); // the model's own grid, not a made-up 24 x 24 wind
    expect(input.cap.glyphs).toBe(GLYPH_CAPS.high.glyphs);
    r.go(L3);
    expect(r.layer.stats()).toMatchObject({ active: true, rebuilds: 1, slicesLast: 2 });
  });

  it('does not build anything while it stays off', () => {
    const r = rig({ enabled: false });
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
    // The detailed streaks are 3.2 px of colour (the ring is the shader's), baked the same way.
    r.layer.setDpr(1);
    expect(widthOf(r.mesh('wind-detail'))).toBe(3.2);
    r.layer.setDpr(2);
    expect(widthOf(r.mesh('wind-detail'))).toBe(6.4);
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

  it('tests its depth as if 40 m nearer the eye, so a tree crown in front of a stroke does not hide it, and a ridge still does', () => {
    const r = rig();
    expect(GLYPH_DEPTH_BIAS_M).toBe(40);
    for (const name of ['wind-glyph', 'wind-glyph-halo'] as const) {
      const m = r.mesh(name).material as THREE.ShaderMaterial;
      expect(m.uniforms.uDepthBias!.value, name).toBe(GLYPH_DEPTH_BIAS_M);
      expect(m.depthTest, `${name} keeps the depth test: switching it off shows every line behind every ridge`).toBe(true);
    }
    // The other users of the streak batch (wind particles, ember trails, the slice's arrows) draw as they did.
    const plain = new StreakBatch({ capacity: 4, widthPx: 2, shared: shared() });
    expect(plain.uniforms.uDepthBias!.value).toBe(0);
    plain.dispose();
  });

  it('the streak shader slides a stroke toward the eye along its own ray: the depth changes, the place on the screen does not', () => {
    // The shader's own text: the bias branch sets only the depth (z), and only when a bias is asked for.
    const vs = (rig().mesh('wind-glyph').material as THREE.ShaderMaterial).vertexShader;
    expect(vs).toContain('uniform float uDepthBias;');
    expect(vs).toMatch(/vec3 pa = \(viewMatrix \* vec4\(aA, 1\.0\)\)\.xyz;/);
    expect(vs).toMatch(/pa \* \(1\.0 - min\(uDepthBias, 0\.5 \* la\) \/ la\)/);
    expect(vs).toMatch(/gl_Position = c;\s*\n\s*if \(uDepthBias > 0\.0\) gl_Position\.z = mix\(za, zb, position\.x\) \* c\.w;/);
    // The same algebra in node, with the camera of these tests: a point slid toward the eye keeps its NDC x and y and moves nearer in z.
    const cam = cameraAt(1500);
    for (const p of [new THREE.Vector3(0, GROUND, 0), new THREE.Vector3(300, GROUND + 40, -200), new THREE.Vector3(-900, GROUND - 60, 500)]) {
      const view = p.clone().applyMatrix4(cam.matrixWorldInverse);
      const len = view.length();
      const slid = view.clone().multiplyScalar(1 - Math.min(GLYPH_DEPTH_BIAS_M, 0.5 * len) / len);
      const a = view.clone().applyMatrix4(cam.projectionMatrix);
      const b = slid.clone().applyMatrix4(cam.projectionMatrix);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
      expect(b.z).toBeLessThan(a.z);
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
    for (const name of ['wind-glyph', 'wind-glyph-halo', 'wind-detail'] as const) {
      r.mesh(name).geometry.addEventListener('dispose', () => disposed++);
    }
    r.layer.dispose();
    expect(disposed).toBe(3);
    expect(r.stub.cancels).toBe(1); // both builders are told to stop
    expect(r.detail.cancels).toBe(1);
  });
});

describe('WindGlyphLayer: the detailed streaks of the most detailed level', () => {
  const detailU = (r: Rig): Record<string, THREE.IUniform> => (r.mesh('wind-detail').material as THREE.ShaderMaterial).uniforms;
  const fadeOf = (r: Rig): number => detailU(r).uFade!.value as number;
  const visible = (r: Rig, name: 'wind-glyph' | 'wind-glyph-halo' | 'wind-detail'): boolean => r.mesh(name).visible;
  /** A rig with the detail stub taking no time of its own, so that the fade reads exact numbers off the fake clock. */
  const fadeRig = (o: Parameters<typeof rig>[0] = {}): Rig => {
    const r = rig(o);
    r.detail.stepMs = 0;
    r.stub.stepMs = 0;
    return r;
  };
  /** At L4 and swapped in, still at fade 0. */
  const atL4 = (o: Parameters<typeof rig>[0] = {}): Rig => {
    const r = fadeRig(o);
    r.go(L4);
    r.go(L4);
    return r;
  };

  it('draws the detailed streaks and no glyphs at the most detailed level, and the glyphs and no streaks below it', () => {
    const r = rig();
    r.go(L3, { settle: true });
    expect([r.instances('wind-glyph'), r.instances('wind-glyph-halo'), r.instances('wind-detail')]).toEqual([400, 400, 0]);
    expect([visible(r, 'wind-glyph'), visible(r, 'wind-glyph-halo'), visible(r, 'wind-detail')]).toEqual([true, true, false]);
    expect(r.layer.stats()).toMatchObject({ active: true, level: 3, count: 40, segments: 400, detail: 'off', detailSegments: 0 });
    r.go(L4, { settle: true, dt: 300 });
    expect([r.instances('wind-glyph'), r.instances('wind-glyph-halo'), r.instances('wind-detail')]).toEqual([0, 0, 400]);
    expect([visible(r, 'wind-glyph'), visible(r, 'wind-glyph-halo'), visible(r, 'wind-detail')]).toEqual([false, false, true]);
    // `count` is the lines, `segments` all that is drawn, `detailSegments` the streaks' share of them.
    expect(r.layer.stats()).toMatchObject({ active: true, idle: null, level: 4, count: 40, segments: 400, detail: 'moving', detailSegments: 400 });
    expect(r.stub.begins).toHaveLength(1); // the glyph builder made the L3 picture and nothing else
    expect(r.detail.begins).toHaveLength(1);
    r.go(L3, { settle: true, dt: 300 });
    expect([r.instances('wind-glyph'), r.instances('wind-glyph-halo'), r.instances('wind-detail')]).toEqual([400, 400, 0]);
    expect([visible(r, 'wind-glyph'), visible(r, 'wind-detail')]).toEqual([true, false]);
    expect(r.layer.stats()).toMatchObject({ level: 3, detail: 'off', detailSegments: 0, segments: 400 });
  });

  it('copies all five arrays of the builder into the batch', () => {
    const r = rig();
    r.go(L4, { settle: true });
    const at = (name: string): Float32Array => (r.mesh('wind-detail').geometry.getAttribute(name) as THREE.InstancedBufferAttribute).array as Float32Array;
    expect(at('aA')[3 * 7]).toBe(7);
    expect(at('aB')[3 * 7]).toBe(7.5);
    expect(at('aC')[4 * 7]).toBe(0.5);
    expect(at('aC')[4 * 7 + 3]).toBe(1);
    expect(Array.from(at('aD').subarray(4 * 7, 4 * 7 + 4))).toEqual([63, 72, 150, 0.25]);
    expect(Array.from(at('aE').subarray(4 * 7, 4 * 7 + 4))).toEqual([6, 0.5, 0, 40]);
    expect(r.layer.stats().detailSegments).toBe(400);
  });

  it('gives the detailed builder the detailed plan, the 10 m ground and a seed of 0, and the glyph builder the 0.5.0 plan below it', () => {
    const r = rig({ drawElevation: 560 });
    r.go(L4, { settle: true });
    const input = r.detail.begins[0]!;
    expect(input.lod.level).toBe(4);
    expect(input.lod).toMatchObject({ spacingPx: DETAIL_GEOMETRY.spacingPx, curved: true, jitter: DETAIL_GEOMETRY.jitter });
    expect(input.lod.lengthPx).toEqual({ min: DETAIL_GEOMETRY.minPx, max: DETAIL_GEOMETRY.maxPx, pxPerMs: DETAIL_GEOMETRY.pxPerMs });
    // 1.4 m a pixel at 1.2 km: lines 32 px apart are 45 m, so the finest lattice is the power of two of metres under that, 32 (23 px), and it is
    // kept to (23 / 32)^2 of its points: 32 px between the lines on average.
    expect(input.lod.spacingM).toBe(32);
    expect(input.lod.spacingExp).toBe(5);
    expect(input.lod.thin).toBeCloseTo((32 / ((32 * 2 * L4 * Math.tan(THREE.MathUtils.degToRad(25))) / CSS.h)) ** 2, 6);
    expect(input.ground10.elevation[0]).toBe(GROUND); // the 10 m ground as received: the numbers come from it
    expect(input.ground.elevation[0]).toBe(560); // the drawn mesh: the picture sits on it
    expect(input.seed).toBe(0);
    expect(input.heightM).toBe(10); // the Wind height 'fire' is the model's 10 m wind: the ground terms in full
    expect(input.cap).toEqual({ glyphs: GLYPH_CAPS.high.glyphs, segments: GLYPH_CAPS.high.segments });
    expect(input.field.u).toBe(r.fresh().atm!.surfaceU);
    r.go(L3, { settle: true, dt: 300 });
    expect(r.stub.begins[0]!.lod).toMatchObject({ level: 3, spacingPx: 36, curved: true, jitter: 0.3 });
    expect('ground10' in r.stub.begins[0]!).toBe(false);
  });

  it('tells the detailed builder the height the wind is read at, so that the ground terms fade with it', () => {
    const r = rig({ height: 300, windMs: 0.01 });
    for (let i = 0; i < 40 && r.detail.begins.length === 0; i++) r.go(L4, { dt: 16 });
    expect(r.detail.begins[0]!.heightM).toBe(300);
  });

  it('keeps the lattice of the zoom: the same power of two from either side, held inside the narrow band at an octave edge', () => {
    const r = rig();
    const exps: number[] = [];
    for (const d of [1500, 1000, 600, 300, 150, 80]) {
      r.go(d, { settle: true, dt: 300 });
      exps.push(r.detail.begins[r.detail.begins.length - 1]!.lod.spacingExp);
    }
    for (let i = 1; i < exps.length; i++) expect(exps[i]!).toBeLessThanOrEqual(exps[i - 1]!); // zooming in never coarsens the lattice
    expect(new Set(exps).size).toBeGreaterThan(2);
  });

  it('follows the zoom with its density: a zoom of 6 % rebuilds the detailed streaks although the lattice and the pose rule do not, and a zoom of 2 % does not; the arrows never do', () => {
    // The share of the lattice kept is 4^-octaves: 12 % for 6 % of distance, and the pose rule asks for 10 % (the lattice is the same power of two here).
    const r = rig();
    r.go(L4, { settle: true });
    const thin0 = r.detail.begins[0]!.lod.thin!;
    expect(r.detail.begins).toHaveLength(1);
    r.go(L4 * 0.98, { dt: 300 });
    r.go(L4 * 0.98, { dt: 300 });
    expect(r.detail.begins, 'a zoom of 2 % keeps the picture').toHaveLength(1);
    r.go(L4 * 0.94, { dt: 300 });
    expect(r.detail.begins, 'a zoom of 6 % rebuilds').toHaveLength(2);
    r.go(L4 * 0.9, { dt: 100 }); // and the next one is held back by the 250 ms gap, like any rebuild
    r.go(L4 * 0.9, { dt: 100 });
    expect(r.detail.begins).toHaveLength(2);
    expect(r.detail.begins[1]!.lod.spacingExp).toBe(r.detail.begins[0]!.lod.spacingExp);
    expect(r.detail.begins[1]!.lod.thin!).toBeGreaterThan(thin0 * 1.1);
    // The arrows below the last level have no share (always 1): a zoom of 6 % is not a reason for them.
    const a = rig();
    a.go(L3, { settle: true });
    a.go(L3 * 0.94, { dt: 300 });
    a.go(L3 * 0.94, { dt: 300 });
    expect(a.stub.begins).toHaveLength(1);
  });

  it('builds nothing below the most detailed level with only the Wind streaks on, but says which level the zoom is at', () => {
    const r = rig({ enabled: false });
    r.layer.setStreaksDetail(true);
    for (const [d, level] of [[L1, 1], [L2, 2], [L3, 3]] as const) {
      expect(r.go(d, { settle: true, dt: 300 })).toBe(false);
      expect(r.layer.stats(), `L${level}`).toMatchObject({ active: false, idle: 'off', level, count: 0, segments: 0, detail: 'off', cellM: 200 });
      expect(r.layer.stats().cellPx).toBeCloseTo(CELL_PX_M / d, 6);
    }
    expect(r.go(L0, { settle: true, dt: 300 })).toBe(false);
    expect(r.layer.stats()).toMatchObject({ level: 0, idle: null });
    expect(r.stub.begins).toHaveLength(0);
    expect(r.detail.begins).toHaveLength(0);
    r.go(L4, { settle: true, dt: 300 });
    expect(r.layer.stats()).toMatchObject({ active: true, idle: null, level: 4, detail: 'moving', detailSegments: 400 });
    expect(r.instances('wind-detail')).toBe(400);
    expect(r.stub.begins).toHaveLength(0); // the arrows were never built
    r.go(L3, { settle: true, dt: 300 });
    expect(r.layer.stats()).toMatchObject({ active: false, idle: 'off', level: 3, detail: 'off', detailSegments: 0 }); // the streaks leave, the arrows do not come
    expect(r.stub.begins).toHaveLength(0);
  });

  it('says nothing is on when neither switch is: no level, `off`', () => {
    const r = rig({ enabled: false });
    expect(r.go(L3)).toBe(false);
    expect(r.layer.stats()).toMatchObject({ active: false, idle: 'off', level: 0, cellPx: 0 });
    r.layer.setStreaksDetail(true);
    r.go(L3, { settle: true });
    expect(r.layer.stats().level).toBe(3);
    r.layer.setStreaksDetail(false);
    r.go(L3);
    expect(r.layer.stats()).toMatchObject({ idle: 'off', level: 0, cellPx: 0 });
  });

  it('builds the arrows as soon as the glyph switch comes on at a level below the most detailed one, and takes them away when it goes off', () => {
    const r = rig({ enabled: false });
    r.layer.setStreaksDetail(true);
    r.go(L3, { settle: true });
    expect(r.stub.begins).toHaveLength(0);
    r.layer.setEnabled(true);
    r.go(L3, { settle: true });
    expect(r.stub.begins).toHaveLength(1);
    expect(r.layer.stats()).toMatchObject({ active: true, level: 3, count: 40 });
    r.layer.setEnabled(false);
    expect(r.go(L3)).toBe(true); // hiding what was drawn needs a frame
    expect(r.layer.stats()).toMatchObject({ active: false, idle: 'off', level: 3, count: 0 });
    expect(r.instances('wind-glyph')).toBe(0);
    expect(r.go(L3)).toBe(false);
  });

  it('draws the detailed streaks from either switch: glyphs alone, streaks alone, and keeps them when only one of the two goes off', () => {
    const glyphsOnly = rig();
    glyphsOnly.go(L4, { settle: true });
    expect(glyphsOnly.layer.detailShown).toBe(true);
    const both = rig();
    both.layer.setStreaksDetail(true);
    both.go(L4, { settle: true });
    both.layer.setEnabled(false); // the streaks keep it
    both.go(L4, { settle: true, dt: 300 });
    expect(both.layer.detailShown).toBe(true);
    expect(both.detail.begins).toHaveLength(1); // the same picture: no rebuild for a switch
    both.layer.setStreaksDetail(false); // now neither
    expect(both.go(L4)).toBe(true);
    expect(both.layer.detailShown).toBe(false);
    expect(both.layer.stats()).toMatchObject({ active: false, idle: 'off', detail: 'off', detailSegments: 0 });
    expect(both.instances('wind-detail')).toBe(0);
    expect(both.mesh('wind-detail').visible).toBe(false);
  });

  it('fades the streaks in over 400 ms of frame time, from nothing, and then asks for no more frames', () => {
    const r = atL4();
    expect(r.layer.detailShown).toBe(true);
    expect(fadeOf(r)).toBe(0); // swapped in, drawn at nothing: the picture grows, it does not pop
    expect(r.mesh('wind-detail').visible).toBe(true);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      expect(r.go(L4, { dt: 100 }), 'a step of the fade draws a frame').toBe(true);
      seen.push(fadeOf(r));
    }
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
    expect(DETAIL_FADE_IN_MS).toBe(400);
    expect(r.go(L4, { dt: 100 }), 'the fade is over: nothing changes').toBe(false);
    expect(fadeOf(r)).toBe(1);
  });

  it('takes its fade from the frame time capped at 0.1 s: a page that was hidden for a minute resumes with one short step', () => {
    const r = atL4();
    r.go(L4, { dt: 60_000 });
    expect(fadeOf(r)).toBe(0.25);
    r.go(L4, { dt: 1 });
    expect(fadeOf(r)).toBeCloseTo(0.25 + 1 / 400, 9);
    r.go(L4, { dt: -50 }); // a clock that stepped back moves nothing
    expect(fadeOf(r)).toBeCloseTo(0.25 + 1 / 400, 9);
  });

  it('settles at once: a settled frame is at full strength, and a settled hand-over takes the streaks away', () => {
    const r = rig();
    r.go(L4, { settle: true });
    expect(fadeOf(r)).toBe(1);
    r.go(L3, { settle: true, dt: 300 });
    expect(r.mesh('wind-detail').visible).toBe(false);
    expect(fadeOf(r)).toBe(0);
  });

  it('keeps the picture it had until the new one swaps in, in both directions: never an empty frame at the edge of the level', () => {
    const r = fadeRig();
    r.go(L3, { settle: true });
    // In: the arrows stay while the streaks are built (a slice a frame), and go at the swap.
    r.go(L4, { dt: 300 });
    expect(r.detail.begins).toHaveLength(1);
    expect([r.instances('wind-glyph'), r.instances('wind-detail')], 'building').toEqual([400, 0]);
    r.go(L4);
    expect([r.instances('wind-glyph'), r.instances('wind-detail')], 'swapped').toEqual([0, 400]);
    for (let i = 0; i < 5; i++) r.go(L4, { dt: 100 });
    expect(fadeOf(r)).toBe(1);
    // Out: the streaks stay at full strength while the arrows are built, and fade out as they swap in.
    r.go(L3, { dt: 300 });
    expect(r.stub.begins).toHaveLength(2);
    expect([r.instances('wind-glyph'), r.instances('wind-detail'), fadeOf(r)], 'building').toEqual([0, 400, 1]);
    expect(r.layer.detailShown).toBe(true);
    r.go(L3);
    expect([r.instances('wind-glyph'), r.instances('wind-detail')], 'swapped: both for a moment').toEqual([400, 400]);
    expect(r.layer.detailShown).toBe(true);
    expect(r.go(L3, { dt: 100 })).toBe(true);
    expect(fadeOf(r)).toBeCloseTo(0.6, 9);
    expect(DETAIL_FADE_OUT_MS).toBe(250);
    expect(r.go(L3, { dt: 100 })).toBe(true);
    expect(fadeOf(r)).toBeCloseTo(0.2, 9);
    expect(r.layer.detailShown, 'still fading').toBe(true);
    expect(r.go(L3, { dt: 50 })).toBe(true);
    expect(r.layer.detailShown, 'faded out after 250 ms').toBe(false);
    expect(r.mesh('wind-detail').visible).toBe(false);
    expect(r.instances('wind-detail')).toBe(0);
    expect(r.go(L3, { dt: 100 })).toBe(false);
  });

  it('does not flicker at the edge of the level: a pinch that hovers around it keeps the streaks and never brings the arrows back', () => {
    const r = fadeRig();
    r.go(L3, { settle: true });
    const at = (px: number): number => CELL_PX_M / px;
    r.go(at(110), { dt: 300 }); // above the edge, 103.5 px
    r.go(at(110));
    expect(r.layer.stats().level).toBe(4);
    for (let i = 0; i < 12; i++) {
      r.go(at(i % 2 ? 110 : 95), { dt: 300 }); // 95 px is below the edge going up, but above the 78 px of going down
      r.go(at(i % 2 ? 110 : 95), { dt: 20 });
      r.go(at(i % 2 ? 110 : 95), { dt: 20 });
      expect(r.layer.stats().level, `step ${i}`).toBe(4);
      expect(r.instances('wind-glyph'), `step ${i}: no arrows`).toBe(0);
      expect(r.instances('wind-detail'), `step ${i}: the streaks stay`).toBeGreaterThan(0);
    }
    expect(r.stub.begins, 'the glyph builder is not asked again').toHaveLength(1);
    // From L3 the same 100 px is still L3: the edge is 103.5 going up.
    const up = fadeRig();
    up.go(L3, { settle: true });
    up.go(at(100), { settle: true, dt: 300 });
    expect(up.layer.stats().level).toBe(3);
    expect(up.instances('wind-glyph')).toBeGreaterThan(0);
    expect(up.instances('wind-detail')).toBe(0);
  });

  it('swaps a rebuild at the same level in place: the streaks keep their fade and the lines their phase', () => {
    const r = atL4();
    for (let i = 0; i < 4; i++) r.go(L4, { dt: 100 });
    expect(fadeOf(r)).toBe(1);
    r.go(L4, { x: 1500, dt: 300 });
    r.go(L4, { x: 1500 });
    expect(r.detail.begins).toHaveLength(2);
    expect(r.layer.stats().rebuilds).toBe(2);
    expect(fadeOf(r)).toBe(1); // not faded in again
    expect(r.instances('wind-detail')).toBe(400);
    expect(r.layer.detailShown).toBe(true);
  });

  it('comes back from a fade-out: the zoom returns before the streaks are gone, and they fade up from where they were', () => {
    const r = fadeRig({ enabled: false });
    r.layer.setStreaksDetail(true);
    r.go(L4, { settle: true, dt: 300 });
    expect(fadeOf(r)).toBe(1);
    r.go(L3, { dt: 300 }); // the Wind streaks alone: nothing is built at this level, so the fade-out starts at once
    r.go(L3, { dt: 100 });
    expect(fadeOf(r)).toBeCloseTo(0.6, 9);
    r.go(L4, { dt: 100 }); // back: the picture was dropped with the level, so it is built again (a slice a frame)
    expect(fadeOf(r)).toBeCloseTo(0.2, 9);
    r.go(L4, { dt: 20 }); // and swapped in: the fade turns round where it was, it does not start over
    expect(fadeOf(r)).toBeCloseTo(0.12, 9);
    expect(r.layer.detailShown).toBe(true);
    for (let i = 0; i < 10; i++) r.go(L4, { dt: 100 });
    expect(fadeOf(r)).toBe(1);
    expect(r.instances('wind-detail')).toBe(400);
  });

  it('moves only while the streaks are drawn and motion is allowed: `animating`, and `detail` in the statistics', () => {
    const r = rig();
    expect(r.layer.animating).toBe(false);
    r.go(L3, { settle: true });
    expect(r.layer.animating, 'arrows do not move').toBe(false);
    expect(r.layer.stats().detail).toBe('off');
    r.go(L4, { settle: true, dt: 300 });
    expect(r.layer.animating).toBe(true);
    expect(r.layer.stats().detail).toBe('moving');
    expect(detailU(r).uMoving!.value).toBe(1);
    r.layer.setMotion(false); // reduced motion
    expect(r.layer.animating).toBe(false);
    expect(r.layer.stats()).toMatchObject({ detail: 'still', detailSegments: 400, active: true });
    expect(detailU(r).uMoving!.value).toBe(0);
    expect(r.layer.detailShown, 'still drawn, only not moving').toBe(true);
    r.layer.setMotion(true);
    expect(r.layer.animating).toBe(true);
    expect(detailU(r).uMoving!.value).toBe(1);
    r.go(L3, { settle: true, dt: 300 });
    expect(r.layer.animating).toBe(false);
  });

  it('stands still from the start under reduced motion, and still fades in (the fade is a frame step, not motion)', () => {
    const r = fadeRig();
    r.layer.setMotion(false);
    r.go(L4);
    r.go(L4);
    expect(r.layer.stats().detail).toBe('still');
    expect(r.layer.animating).toBe(false);
    expect(r.go(L4, { dt: 100 }), 'the fade still draws its frames').toBe(true);
    expect(fadeOf(r)).toBe(0.25);
    for (let i = 0; i < 3; i++) r.go(L4, { dt: 100 });
    expect(fadeOf(r)).toBe(1);
    expect(r.go(L4, { dt: 100 }), 'and then nothing').toBe(false);
  });

  it('hides the streaks at once at eye level, when nothing is switched on, when the air goes and when the zoom is far out', () => {
    for (const how of ['eye-level', 'off', 'no-wind', 'far'] as const) {
      const r = rig();
      r.layer.setStreaksDetail(true);
      r.go(L4, { settle: true });
      expect(r.layer.detailShown, how).toBe(true);
      if (how === 'eye-level') expect(r.go(L4, { mode: 'ground' }), how).toBe(true);
      if (how === 'off') {
        r.layer.setEnabled(false);
        r.layer.setStreaksDetail(false);
        expect(r.go(L4), how).toBe(true);
      }
      if (how === 'no-wind') {
        r.layer.setData(null);
        expect(r.go(L4), how).toBe(true);
      }
      if (how === 'far') expect(r.go(L0, { dt: 300 }), how).toBe(true);
      expect(r.layer.detailShown, how).toBe(false);
      expect(r.layer.animating, how).toBe(false);
      expect(r.instances('wind-detail'), how).toBe(0);
      expect(r.mesh('wind-detail').visible, how).toBe(false);
      expect(r.layer.stats(), how).toMatchObject({ active: false, detail: 'off', detailSegments: 0 });
    }
  });

  it('gives the old Wind streaks back when the builder finds no line: `detailShown` is false while nothing is drawn', () => {
    const none = rig();
    none.detail.segments = 0; // a builder that finds no line (the stub of the 0.6.0 C0 commit does)
    none.go(L4, { settle: true });
    expect(none.layer.detailShown).toBe(false);
    expect(none.layer.animating).toBe(false);
    expect(none.layer.stats()).toMatchObject({ active: false, idle: null, level: 4, detail: 'off', detailSegments: 0, count: 0 });
  });

  it('is never trimmed to nothing by a full frame: the floor (DETAIL_MIN_SEGMENTS) is drawn over 550,000 triangles, and the old streaks stay away', () => {
    // A dense forest at the High tier is 548,000 to 563,000 triangles on its own: with no floor the closest zoom drew nothing and said `budget`.
    for (const tris of [FRAME_TRIANGLE_LIMIT, 560_000, 600_000]) {
      const r = rig();
      r.detail.segments = 12000;
      r.go(L4, { tris, settle: true });
      expect(r.detail.begins[0]!.cap.segments, `${tris} triangles`).toBe(DETAIL_MIN_SEGMENTS);
      expect(r.layer.detailShown, `${tris} triangles`).toBe(true);
      expect(r.layer.stats(), `${tris} triangles`).toMatchObject({ active: true, idle: null, level: 4, detail: 'moving', detailSegments: DETAIL_MIN_SEGMENTS });
      expect(r.instances('wind-detail')).toBe(DETAIL_MIN_SEGMENTS);
    }
  });

  it('gives the same picture for the same view whatever the frame held when it was built: a jump into a forest and a smooth zoom (the floor is the whole cap)', () => {
    // The first frame after a jump still holds the last view's triangles (the canopy is not placed yet); a smooth zoom has met the full frame all along.
    // A view whose lines fill the cap (a fast wind: 12,000 segments and more) is the cap in every one of them.
    const sizes = [0, 100_000, 480_000, 527_000, 540_000, 549_000, 560_000, 580_000, 640_000].map((tris) => {
      const r = rig();
      r.detail.segments = 12000;
      r.go(L4, { tris, settle: true });
      return r.layer.stats().detailSegments;
    });
    expect(new Set(sizes)).toEqual(new Set([GLYPH_CAPS.high.segments]));
  });

  it('is never trimmed to the frame, at any tier: the cap is the tier\'s own whatever the frame holds (the floor is the High tier\'s cap), 2 triangles a segment on top of it', () => {
    expect(DETAIL_MIN_SEGMENTS).toBe(GLYPH_CAPS.high.segments);
    for (const tier of ['low', 'medium', 'high'] as const) {
      for (const tris of [0, 300_000, 530_000, 549_800, 580_000]) {
        const r = rig({ tier });
        r.detail.segments = GLYPH_CAPS[tier].segments;
        r.go(L4, { tris, settle: true });
        expect(r.detail.begins[0]!.cap.segments, `${tier}, ${tris} triangles`).toBe(GLYPH_CAPS[tier].segments);
        expect(r.layer.stats().detailSegments, `${tier}, ${tris} triangles`).toBe(GLYPH_CAPS[tier].segments);
      }
    }
  });

  it('does not count the streaks it is about to drop against the arrows that replace them (the glyph pair has no floor)', () => {
    const r = rig();
    r.go(L4, { settle: true }); // 400 segments of 2 triangles: 800 of the frame's 549,800 are the streaks'
    r.go(L3, { settle: true, dt: 300, tris: 549_800 });
    expect(r.stub.begins[0]!.cap.segments).toBe(250); // (550,000 - (549,800 - 800)) / 4
  });

  it('is `budget` at no level but the arrows\': the detailed streaks keep their floor in a full frame, so the reason never shows at the closest zoom', () => {
    const r = rig();
    r.go(L3, { tris: 560_000, settle: true });
    expect(r.layer.stats()).toMatchObject({ active: false, idle: 'budget', level: 3 }); // the glyph pair has no floor
    r.go(L4, { tris: 560_000, dt: 300, settle: true });
    expect(r.layer.stats()).toMatchObject({ active: true, idle: null, level: 4, detail: 'moving', detailSegments: 400 });
    expect(r.layer.detailShown).toBe(true);
    // And back out to the arrows in the full frame: the reason is the glyphs' again.
    r.go(L3, { tris: 560_000, dt: 300, settle: true });
    expect(r.layer.stats()).toMatchObject({ active: false, idle: 'budget', level: 3 });
    expect(r.layer.detailShown).toBe(false);
  });

  it('cancels a detail build that the zoom made out of date, with the detail builder', () => {
    const r = rig();
    r.detail.steps = 3;
    r.go(L4); // slice one of three, for the detailed streaks
    r.go(L3);
    expect(r.detail.cancels).toBe(1);
    expect(r.stub.cancels).toBe(0);
    expect(r.stub.begins).toHaveLength(1);
    expect(r.stub.begins[0]!.lod.level).toBe(3);
  });

  it('tells the shader how many pixels a metre covers at distance 1, from the canvas and the field of view of the frame', () => {
    const r = rig();
    r.go(L4, { settle: true });
    expect(detailU(r).uPxPerM1!.value).toBeCloseTo(800 / (2 * Math.tan((25 * Math.PI) / 180)), 9);
    const tall = rig();
    const cam = new THREE.PerspectiveCamera(50, 0.5, 5, 80000);
    cam.position.set(0, GROUND + 600, 700);
    cam.lookAt(0, GROUND, 0);
    cam.updateMatrixWorld();
    tall.layer.tick(0, cam, { w: 400, h: 1600, fov: 50 }, 'orbit', 1, 900, 0, true);
    expect((tall.mesh('wind-detail').material as THREE.ShaderMaterial).uniforms.uPxPerM1!.value).toBeCloseTo(1600 / (2 * Math.tan((25 * Math.PI) / 180)), 9);
  });

  it('allocates nothing on a frame where nothing changed with the streaks drawn and moving (the animation is the GPU\'s)', async () => {
    v8.setFlagsFromString('--no-turbo-inlining');
    try {
      const r = rig();
      r.go(L4, { settle: true });
      const cam = cameraAt(L4);
      // A frame time that changes every frame, and is a fraction as the browser's is: the numbers are made beforehand (in an array that
      // also holds an object, so that they are boxed), because a caller that works one out allocates it, and that is not the layer's.
      const WINDOW = 500;
      const times: unknown[] = [{}];
      for (let k = 1; k <= WINDOW; k++) times.push(100_000.25 + k * 16.7);
      const frames = (n: number): void => {
        for (let i = 0; i < n; i++) r.layer.tick(times[1 + (i % WINDOW)] as number, cam, CSS, 'orbit', 1, L4, 0, false);
      };
      // The JIT first: in rounds with a pause between them, so that the optimising compiler (which works on another thread) is not starved when
      // the machine is busy with other test files, and the code measured is the code that runs in the app.
      for (let round = 0; round < 4; round++) {
        frames(20_000);
        await new Promise((done) => setTimeout(done, 25));
      }
      gc();
      gc();
      const grown: number[] = [];
      for (let k = 0; k < 41; k++) {
        const a0 = process.memoryUsage().heapUsed;
        frames(WINDOW);
        grown.push(process.memoryUsage().heapUsed - a0);
      }
      grown.sort((a, b) => a - b);
      expect(r.detail.begins).toHaveLength(1);
      expect(r.layer.animating).toBe(true);
      expect(grown[grown.length >> 1]! / WINDOW, 'bytes a frame').toBeLessThan(2);
    } finally {
      v8.setFlagsFromString('--turbo-inlining');
    }
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

  it('switches the frame loop on only for the detailed streaks: the glyph layer is in `animating` through its own `animating` and nothing else', () => {
    const animating = /const animating =([\s\S]*?);\n/.exec(scene)![1]!;
    expect(animating).toMatch(/this\.glyphs\.animating/);
    expect(animating.replace(/this\.glyphs\.animating/g, '')).not.toMatch(/glyph/i);
    // The old Wind streaks leave it while the detailed streaks stand in for them.
    expect(animating).toMatch(/\(this\.wind\.currentMode !== 'off' && !detailInstead\)/);
  });

  it('puts the Wind streaks switch and the system\'s reduced motion into the layer, and follows the setting while the app runs', () => {
    expect(scene).toMatch(/this\.glyphs\.setStreaksDetail\(l\.wind === 'surface'\)/); // the volume streaks are another picture, not the detailed one
    expect(scene).toMatch(/window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
    expect(scene).toMatch(/this\.glyphs\.setMotion\(!this\.motionQuery\?\.matches\)/);
    expect(scene).toMatch(/this\.motionQuery\?\.addEventListener\?\.\('change', this\.onMotion\)/);
    expect(scene).toMatch(/this\.motionQuery\?\.removeEventListener\?\.\('change', this\.onMotion\)/);
    // A change of the setting draws a frame, so the streaks stop (or start) at once.
    expect(/private readonly onMotion = \(\): void => \{([\s\S]*?)\};/.exec(scene)![1]).toContain('this.dirty = true');
  });

  it('steps the old Wind streaks aside while the detailed streaks are drawn: decided after the tick and before `animating`, and only for the surface kind', () => {
    const tick = scene.indexOf('this.glyphs.tick(');
    const aside = scene.indexOf('this.wind.setSuppressed(detailInstead)');
    const animating = scene.indexOf('const animating =');
    expect(tick).toBeGreaterThan(0);
    expect(aside).toBeGreaterThan(tick);
    expect(animating).toBeGreaterThan(aside);
    expect(scene).toMatch(/const detailInstead = this\.glyphs\.detailShown && this\.layers\.wind === 'surface';/);
  });

  it('is ticked every frame, before the idle return, with the settle flag of renderNow', () => {
    const tick = scene.indexOf('this.glyphs.tick(');
    const idle = scene.indexOf('if (!this.dirty && !moved && !animating)');
    expect(tick).toBeGreaterThan(0);
    expect(idle).toBeGreaterThan(tick);
    expect(scene.slice(tick, tick + 220)).toContain('this.settleNow');
  });

  it('stays out of the entry chunk: nothing in src/ui, the layer catalog or the layer state imports the engine or the layer', () => {
    // The UI may read the types and constants (glyphTypes.ts, erased or tiny) and its own words; the tracer, the planner, the raster,
    // the scheduler and the layer belong to the lazy render chunk (plan section 5).
    const engine = /from '[^']*\/wind\/(flowGlyphs|glyphField|glyphLod|glyphPose|glyphSchedule|windGlyphLayer|detailBatch|detailStreaks)'/;
    const files: string[] = [];
    const walk = (dir: URL): void => {
      for (const name of readdirSync(dir)) {
        const url = new URL(name, dir);
        if (statSync(url).isDirectory()) walk(new URL(`${name}/`, dir));
        else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(fileURLToPath(url));
      }
    };
    walk(new URL('../../ui/', import.meta.url));
    files.push(fileURLToPath(new URL('../layerCatalog.ts', import.meta.url)), fileURLToPath(new URL('../layers.ts', import.meta.url)), fileURLToPath(new URL('../legends.ts', import.meta.url)));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => engine.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('reaches the view through stats() and windGlyphStats()', () => {
    expect(scene).toMatch(/windGlyphs: \{ level: g\.level, count: g\.count \}/);
    expect(scene).toMatch(/windGlyphStats\(\): WindGlyphStats/);
  });
});

describe('WindGlyphLayer with the real detailed-streak builder: what the shader is given', () => {
  /** A ground that rolls from east to west (a slope of 0.2 at the steepest), under a wind that blows from the west-south-west at 8.2 m/s. */
  const ROLLING = (x: number): number => GROUND + 60 * Math.sin(x / 300);
  const attr = (r: Rig, name: string): Float32Array => (r.mesh('wind-detail').geometry.getAttribute(name) as THREE.InstancedBufferAttribute).array as Float32Array;
  const build = (height: WindHeight): { r: Rig; n: number } => {
    const r = rig({ groundAt: (x) => ROLLING(x), height });
    r.go(L4, { settle: true });
    return { r, n: r.layer.stats().detailSegments };
  };

  it('hands the shader 18 floats a segment in the ranges it reads: arc lengths that grow along the line, a seed, a tail, the terrain terms, alpha 1', () => {
    const { r, n } = build('fire');
    expect(n).toBeGreaterThan(200);
    expect(r.layer.stats()).toMatchObject({ active: true, idle: null, level: 4, detail: 'moving', detailSegments: n });
    const geom = r.mesh('wind-detail').geometry as THREE.InstancedBufferGeometry;
    expect(['aA', 'aB', 'aC', 'aD', 'aE'].map((name) => geom.getAttribute(name).itemSize)).toEqual([3, 3, 4, 4, 4]); // 18 floats = 72 bytes
    const [a, b, c, d, e] = ['aA', 'aB', 'aC', 'aD', 'aE'].map((name) => attr(r, name)) as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
    let lifted = 0;
    for (let i = 0; i < n; i++) {
      const at = `segment ${i}`;
      expect(c[4 * i + 3], at).toBe(1); // the shader draws nothing at alpha 0
      const [s0, s1, len, seed] = [d[4 * i]!, d[4 * i + 1]!, d[4 * i + 2]!, d[4 * i + 3]!];
      expect(s0, at).toBeGreaterThanOrEqual(0);
      expect(s1, at).toBeGreaterThan(s0);
      expect(s1 - s0, at).toBeLessThanOrEqual(12); // the lines are in steps of 9 px or so
      expect(s1, at).toBeLessThanOrEqual(len + 1e-3);
      expect(len, at).toBeGreaterThanOrEqual(26); // 90 to 220 px, or as much as is drawn of a line that a wall or the raster's edge cut short
      expect(len, at).toBeLessThanOrEqual(220 + 1e-3);
      expect(seed, at).toBeGreaterThanOrEqual(0);
      expect(seed, at).toBeLessThan(1);
      const [speed, turb, lift, tail] = [e[4 * i]!, e[4 * i + 1]!, e[4 * i + 2]!, e[4 * i + 3]!];
      expect(speed, at).toBeGreaterThan(0.3); // m/s, not px
      expect(speed, at).toBeLessThan(30);
      expect(turb, at).toBeGreaterThanOrEqual(0.25 - 1e-6);
      expect(turb, at).toBeLessThanOrEqual(1);
      expect(Math.abs(lift), at).toBeLessThanOrEqual(1);
      expect(tail, at).toBeGreaterThanOrEqual(24);
      expect(tail, at).toBeLessThanOrEqual(90);
      if (Math.abs(lift) > 0.05) lifted++;
      // The ends are in metres (world axes), a few metres apart at this zoom.
      const run = Math.hypot(b[3 * i]! - a[3 * i]!, b[3 * i + 2]! - a[3 * i + 2]!);
      expect(run, at).toBeGreaterThan(0.5);
      expect(run, at).toBeLessThan(60); // (a step of 9 px reaches 40 m or so near the horizon of an orbit view)
    }
    expect(lifted, 'the rolling ground lifts and sinks some lines').toBeGreaterThan(n / 10);
  });

  it('bakes the lift into the heights once: the arrays hold it above the ground, and the shader reads it only to brighten', () => {
    const { r, n } = build('fire');
    const [a, e] = ['aA', 'aE'].map((name) => attr(r, name)) as [Float32Array, Float32Array];
    for (let i = 0; i < n; i++) expect(a[3 * i + 1]! - ROLLING(a[3 * i]!), `segment ${i}: never under the ground`).toBeGreaterThan(-3); // (the ground is a raster of 200 m cells: a few metres of give)
    // Lines that rise over the rolling ground and lines that sink in the lee both exist, so the heights above did carry a lift.
    let up = 0;
    let down = 0;
    for (let i = 0; i < n; i++) {
      if (e[4 * i + 2]! > 0.3) up++;
      if (e[4 * i + 2]! < -0.3) down++;
    }
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
    // The shader moves a vertex across the ground (the meander) and never up or down, and uses `lift` (aE.z) in one place: the brightness.
    const src = (r.mesh('wind-detail').material as THREE.ShaderMaterial).vertexShader;
    expect(src.match(/aE\.z/g)).toHaveLength(1);
    expect(src).toMatch(/float lift = 1\.0 \+ 0\.12 \* aE\.z;/);
    expect(src).not.toMatch(/\b(pa|pb)\.y\b/);
  });

  it('fades the ground terms with the wind height: a 300 m wind keeps about 0.38 of the lift and the turbulence the 10 m wind has', () => {
    const near = build('fire');
    const high = build(300);
    const mean = (b: { r: Rig; n: number }, off: number, f: (v: number) => number): number => {
      const e = attr(b.r, 'aE');
      let sum = 0;
      for (let i = 0; i < b.n; i++) sum += f(e[4 * i + off]!);
      return sum / b.n;
    };
    const lift10 = mean(near, 2, Math.abs);
    const lift300 = mean(high, 2, Math.abs);
    const turb10 = mean(near, 1, (v) => v - 0.25);
    const turb300 = mean(high, 1, (v) => v - 0.25);
    expect(lift10).toBeGreaterThan(0.1);
    expect(lift300 / lift10, 'lift at 300 m over lift at 10 m').toBeGreaterThan(0.3);
    expect(lift300 / lift10).toBeLessThan(0.46);
    expect(turb10).toBeGreaterThan(0.01);
    expect(turb300 / turb10, 'turbulence above the base').toBeGreaterThan(0.3);
    expect(turb300 / turb10).toBeLessThan(0.46);
  });
});

describe('WindGlyphLayer: the cold first zoom (0.7.0)', () => {
  it('takes the lowest ground of a HeightField from the field itself, without reading a cell of the mesh, and walks a plain raster once', () => {
    const r = rig();
    const d = r.fresh();
    const hf = d.drawGround as HeightField;
    Object.defineProperty(hf, 'elevation', {
      get() {
        throw new Error('the layer walked the mesh');
      },
    });
    r.layer.setData({ ...d, drawGround: hf });
    expect(() => r.go(L4, { settle: true })).not.toThrow();
    expect(r.layer.stats()).toMatchObject({ active: true, level: 4, detail: 'moving' });
    // A plain raster (no `minElevation`) is walked, and once: the answer is kept for the same object.
    const plain = r.fresh();
    let reads = 0;
    const cells = (plain.sliceGround as HeightField).elevation;
    const counted = { grid: plain.drawGround.grid, get elevation() { reads++; return cells; } };
    r.layer.setData({ ...plain, drawGround: counted });
    r.go(L4, { settle: true, dt: 300 });
    r.go(L4, { settle: true, dt: 300, x: 200 });
    expect(reads, 'the plain raster is read').toBeGreaterThan(0);
    const after = reads;
    r.layer.setData({ ...plain, drawGround: counted });
    r.go(L4, { settle: true, dt: 300 });
    expect(reads, 'the same raster is walked once, not per rebuild').toBe(after);
  });

  it('gives the first two slices of each builder half the budget (4 ms), the later ones 8 ms, and a settled frame none', () => {
    const r = rig();
    r.detail.steps = 6;
    r.stub.steps = 4;
    for (let i = 0; i < 12 && r.detail.begins.length < 2; i++) r.go(L4, { dt: 16 });
    expect(r.detail.budgets.slice(0, 6)).toEqual([4, 4, 8, 8, 8, 8]);
    for (let i = 0; i < 12; i++) r.go(L3, { dt: 300 });
    expect(r.stub.budgets.slice(0, 4), 'the glyph builder is cold on its own').toEqual([4, 4, 8, 8]);
    r.go(L4, { dt: 300, settle: true });
    expect(r.detail.budgets[r.detail.budgets.length - 1]).toBe(Infinity);
  });

  it('reports the longest tick since the statistics were last read, and starts a new window with each read', () => {
    const r = rig();
    r.detail.stepMs = 5;
    expect(r.layer.stats().tickMaxMs).toBe(0);
    r.go(L4, { dt: 16 }); // one slice of 5 ms on the fake clock
    r.go(L4, { dt: 16 }); // the second, which swaps
    const first = r.layer.stats().tickMaxMs;
    expect(first).toBeGreaterThanOrEqual(5);
    expect(first).toBeLessThan(10);
    r.go(L4, { dt: 16 });
    expect(r.layer.stats().tickMaxMs, 'a tick that did nothing took no time on the fake clock').toBe(0);
  });

  it('compiles its programs ahead through the renderer (compileAsync when there is one), once, and never throws or rejects', async () => {
    const r = rig();
    const calls: unknown[][] = [];
    const camera = cameraAt(L4);
    const scene = new THREE.Scene();
    const target: PrecompileTarget = { compileAsync: (...a) => (calls.push(a), Promise.resolve(scene)) };
    await r.layer.precompile(target, camera, scene);
    await r.layer.precompile(target, camera, scene);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([r.layer.group, camera, scene]);
    // Without compileAsync the synchronous compile is used; a renderer that throws or rejects costs nothing.
    const sync: unknown[][] = [];
    await rig().layer.precompile({ compile: (...a) => void sync.push(a) }, camera);
    expect(sync).toHaveLength(1);
    await rig().layer.precompile({ compileAsync: () => Promise.reject(new Error('no GL')) }, camera);
    await rig().layer.precompile({ compile: () => { throw new Error('no GL'); } }, camera);
    await rig().layer.precompile({}, camera);
  });
});

describe('WindGlyphLayer: what the relief reads, and when it rebuilds (0.7.0)', () => {
  /** A source with one placed tree (`serial` is a plain number the test moves). */
  const tree = { group: 0, count: 1, position: new Float32Array([5, 5, 0]), size: new Float32Array([30, 10]) };
  const crowns = (serial = 1): CrownSource & { serial: number } => ({ serial, sets: () => [tree] });
  /** At L4 with a picture swapped in, `gap` ms since. */
  const atL4 = (): Rig => {
    const r = rig();
    r.go(L4, { settle: true });
    return r;
  };

  it('gives the detailed builder the relief, the canopy, the crowns and the plume, and the glyph builder none of them', () => {
    const r = rig();
    const fuel = { grid: r.fresh().atm!.grid } as never;
    const src = crowns();
    r.layer.setCanopy(fuel);
    r.layer.setCrowns(src);
    r.layer.setPlumes([{ x: 10, y: 20, radiusM: 60, strength: 0.5 }]);
    r.go(L3, { settle: true });
    expect('relief' in r.stub.begins[0]!).toBe(false);
    r.go(L4, { settle: true, dt: 300 });
    const input = r.detail.begins[0]!;
    expect(input.relief).toBe(DETAIL_RELIEF);
    expect(input.canopy).toBe(fuel);
    expect(input.crowns).toEqual([tree]);
    expect(input.plumes).toEqual([{ x: 10, y: 20, radiusM: 60, strength: 0.5 }]);
  });

  it('rides on the canopy and bends round crowns only while trees are drawn: no canopy for a source with no tree placed or drawn', () => {
    const r = rig();
    const fuel = { grid: r.fresh().atm!.grid } as never;
    r.layer.setCanopy(fuel);
    r.layer.setCrowns({ serial: 1, sets: () => [] });
    r.go(L4, { settle: true });
    expect([r.detail.begins[0]!.canopy, r.detail.begins[0]!.crowns], 'the canopy layer is off or hidden: the sets are empty').toEqual([undefined, undefined]);
    r.layer.setCrowns({ serial: 1, sets: () => [{ ...tree, count: 0 }] });
    r.go(L4, { settle: true, dt: 300 });
    expect(r.detail.begins[1]!.canopy, 'a set with no tree in it').toBeUndefined();
    r.layer.setCrowns(crowns());
    r.go(L4, { settle: true, dt: 300 });
    expect(r.detail.begins[2]!.canopy).toBe(fuel);
    expect(r.detail.begins[2]!.crowns).toEqual([tree]);
  });

  it('gives nothing of it while it is not set, with the canopy layer off (null), or with the relief switched off', () => {
    const r = atL4();
    const input = r.detail.begins[0]!;
    expect(input.relief).toBe(DETAIL_RELIEF);
    expect([input.canopy, input.crowns, input.plumes]).toEqual([undefined, undefined, undefined]);
    r.layer.setRelief(false);
    r.go(L4, { settle: true, dt: 300 });
    expect(r.detail.begins).toHaveLength(2);
    expect(r.detail.begins[1]!.relief, 'the 0.6.0 picture: no relief at all').toBeUndefined();
    expect(r.detail.begins[1]!.canopy).toBeUndefined();
    const k = DETAIL_RELIEF.enabled;
    try {
      DETAIL_RELIEF.enabled = false; // the constant of the kill switch
      r.layer.setRelief(true);
      r.go(L4, { settle: true, dt: 300 });
      expect(r.detail.begins.length, 'no change of picture: the constant keeps it off').toBe(2);
    } finally {
      DETAIL_RELIEF.enabled = k;
    }
  });

  it('rebuilds once for a new crown source, a new serial or a new canopy, and for nothing else the relief reads', () => {
    const r = atL4();
    const src = crowns();
    r.layer.setCrowns(src);
    r.go(L4, { dt: 300 });
    r.go(L4, { dt: 300 });
    expect(r.detail.begins).toHaveLength(2);
    expect(r.detail.begins[1]!.crowns).toEqual([tree]);
    r.go(L4, { dt: 300 });
    r.go(L4, { dt: 300 });
    expect(r.detail.begins, 'an unchanged serial gives no rebuild').toHaveLength(2);
    src.serial = 2; // the forest was placed again
    r.go(L4, { dt: 300 });
    r.go(L4, { dt: 300 });
    expect(r.detail.begins).toHaveLength(3);
    r.layer.setCanopy({ grid: r.fresh().atm!.grid } as never);
    r.go(L4, { dt: 300 });
    r.go(L4, { dt: 300 });
    expect(r.detail.begins).toHaveLength(4);
    r.layer.setCrowns(null); // the canopy layer went off
    r.go(L4, { dt: 300 });
    r.go(L4, { dt: 300 });
    expect(r.detail.begins).toHaveLength(5);
    expect(r.detail.begins[4]!.crowns).toBeUndefined();
    r.layer.setPlumes([{ x: 0, y: 0, radiusM: 50, strength: 1 }]);
    r.go(L4, { dt: 300 });
    r.go(L4, { dt: 300 });
    expect(r.detail.begins, 'a plume alone waits for the next snapshot').toHaveLength(5);
  });

  it('holds a rebuild for new crowns to the 250 ms gap, like any other, and not at all below the most detailed level', () => {
    const r = atL4();
    const src = crowns();
    r.layer.setCrowns(src);
    r.go(L4, { dt: 100 });
    expect(r.detail.begins).toHaveLength(1);
    r.go(L4, { dt: 200 });
    expect(r.detail.begins).toHaveLength(2);
    const lowRig = rig();
    lowRig.go(L3, { settle: true });
    lowRig.layer.setCrowns(crowns());
    lowRig.layer.setCanopy({ grid: lowRig.fresh().atm!.grid } as never);
    lowRig.go(L3, { dt: 1000 });
    lowRig.go(L3, { dt: 1000 });
    expect(lowRig.stub.begins, 'the arrows do not read the relief').toHaveLength(1);
  });

  it('says `paused` for streaks that move while the view holds still, never over `still` or `off`, and animates as before', () => {
    const r = rig();
    r.layer.setPaused(true);
    expect(r.layer.stats().detail).toBe('off');
    r.go(L4, { settle: true });
    expect(r.layer.stats().detail).toBe('paused');
    expect(r.layer.animating, 'the frame loop (not the layer) holds the clock still').toBe(true);
    r.layer.setMotion(false);
    expect(r.layer.stats().detail, 'reduced motion wins').toBe('still');
    r.layer.setMotion(true);
    r.layer.setPaused(false);
    expect(r.layer.stats().detail).toBe('moving');
  });

  it('tells which switches asked for the picture and whether motion is reduced', () => {
    const r = rig({ enabled: false });
    expect(r.layer.stats()).toMatchObject({ glyphs: false, streaks: false, reduced: false });
    r.layer.setStreaksDetail(true);
    r.layer.setEnabled(true);
    r.layer.setMotion(false);
    expect(r.layer.stats()).toMatchObject({ glyphs: true, streaks: true, reduced: true });
  });
});
