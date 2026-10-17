/**
 * Wind arrows and flow lines drawn on the map (0.5.0, stage E1): the Three.js side of the zoom-adaptive glyphs. The pure engine
 * (`flowGlyphs.ts`) traces the glyphs into flat arrays; this layer decides when, copies them into two `StreakBatch`es (a dark halo
 * under a coloured stroke, so the pale stops of the wind ramp stay readable on every ground) and keeps the work off the frame:
 *
 *  - it lives inside the frame loop (`tick`, once per frame before the idle return) and never sets `animating`: nothing here
 *    moves, so a still map stays still and the loop only draws when `tick` says a new picture was swapped in;
 *  - a rebuild starts when the drawn picture is out of date (`glyphSchedule.rebuildReason`), at most once per 250 ms, and is
 *    staged: the raster fill in its own slice, then the trace in slices of at most 8 ms; the batches change only at the swap;
 *  - the segment cap follows `renderer.info`, so a frame never crosses `FRAME_TRIANGLE_LIMIT`;
 *  - the picture is draped on the drawn mesh a little above the ground; the numbers come from the 10 m ground as received.
 * Eye level, a view without air wind and a map zoomed so far out that a model cell is under 4 px draw nothing (`stats().idle`).
 */
import * as THREE from 'three';
import type { GridSpec } from '../../core/grid';
import type { AtmosphereView } from '../../core/types';
import type { WindGlyphStats } from '../api';
import type { AtmosphereSampler } from '../atmosphereSampler';
import type { ViewMode } from '../cameraRig';
import { StreakBatch } from '../streaks';
import { createGlyphBuilder, HALO_INK } from './flowGlyphs';
import { HeightRaster, refineFor, surfaceRaster } from './glyphField';
import { metresPerPixelAt, planLod, visibleBox } from './glyphLod';
import { mayRebuild, rebuildReason, segmentCap, SliceLog, type BuiltPicture, type PictureNow } from './glyphSchedule';
import { GLYPH_CAPS, type Box, type FlowRaster, type GlyphBuilder, type GlyphInput, type GlyphTier, type GroundRaster, type LodPlan, type WindHeight } from './glyphTypes';

/** Stroke widths in CSS pixels (baked at the device pixel ratio by `setDpr`): the colour stroke, and the halo that shows 1.25 px either side of it. */
const GLYPH_WIDTH_PX = 2.5;
const HALO_WIDTH_PX = GLYPH_WIDTH_PX + 2 * 1.25;
/** What one slice of a rebuild may take on the main thread (ms, the device's own clock). */
const SLICE_BUDGET_MS = 8;
/** How far the ground is enumerated toward the horizon: this many camera distances, at least `MIN_RANGE_M`. */
const RANGE_PER_DISTANCE = 6;
const MIN_RANGE_M = 3000;
/** The throw-away rebuild that warms the tracer when the layer is first switched on (a cold tracer is 4 to 7 times slower). */
const WARM_GLYPHS = 48;

/** What the layer reads, per snapshot: the air, the ground the numbers come from and the ground the picture is draped on. */
export interface GlyphData {
  sampler: AtmosphereSampler;
  atm: AtmosphereView | null;
  /** The 10 m ground as received (the wind heights are above it). */
  sliceGround: GroundRaster;
  /** The drawn mesh (the glyphs sit on it). */
  drawGround: GroundRaster;
}

/** What `tick` needs to know about the canvas: its CSS size and its vertical field of view (the rig's, without the panel insets). */
export interface GlyphCss {
  w: number;
  h: number;
  fov: number;
}

/** Seams for tests: a stub builder, a fake clock. The app passes nothing. */
export interface GlyphLayerDeps {
  createBuilder?: (tier: GlyphTier) => GlyphBuilder;
  now?: () => number;
  /** Run the warm-up rebuild on first enable (default true). */
  warm?: boolean;
}

type Idle = WindGlyphStats['idle'];

const newBuilt = (): BuiltPicture => ({ dataSerial: -1, height: 'fire', level: 0, spacingExp: 0, pose: new Float64Array(12), proj: new Float64Array(3), box: { x0: 0, y0: 0, x1: 0, y1: 0 } });

export class WindGlyphLayer {
  readonly group = new THREE.Group();
  private readonly halo: StreakBatch;
  private readonly colour: StreakBatch;
  private readonly builder: GlyphBuilder;
  private readonly tier: GlyphTier;
  private readonly clock: () => number;
  private readonly warmOnEnable: boolean;

  private enabled = false;
  private height: WindHeight = 'fire';
  private data: GlyphData | null = null;
  /** One per `setData`: a picture of the air is the same picture until it changes. */
  private dataSerial = 0;
  /** `surfaceRaster` of this data, computed once (undefined = not asked yet). */
  private surface: FlowRaster | null | undefined;
  private heightRaster: HeightRaster | null = null;
  private heightRasterN = 0;
  /** What the raster in use was filled for. */
  private raster: FlowRaster | null = null;
  private rasterSerial = -1;
  private rasterHeight: WindHeight | null = null;
  private rasterRefine = 0;
  private groundMin: { of: GroundRaster; y: number } | null = null;

  private lod: LodPlan | null = null;
  private built: BuiltPicture = newBuilt();
  private next: BuiltPicture = newBuilt();
  private builtValid = false;
  /** A rebuild is in progress (its slices run one per frame); `begun` once the builder has its input. */
  private working = false;
  private begun = false;
  private waiting = false;
  private lastSwapAt = -Infinity;
  private shown = false;
  private warmed = false;

  // The pose of this frame and of the previous one, the projection's numbers, and scratch for the view maths (no allocation per frame).
  private readonly pose = new Float64Array(12);
  private readonly lastPose = new Float64Array(12);
  private readonly proj = new Float64Array(3);
  private readonly lastProj = new Float64Array(3);
  private sigValid = false;
  private lastSerial = -1;
  private lastHeight: WindHeight | null = null;
  private readonly current: PictureNow = { dataSerial: 0, height: 'fire', level: 0, spacingExp: 0, pose: this.pose, proj: this.proj, distanceM: 0 };
  private readonly unproject = new THREE.Matrix4();
  private readonly viewProj = new Float64Array(16);
  private readonly eye = new Float64Array(3);
  private readonly fwd = new THREE.Vector3();
  private readonly bounds: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private cam: THREE.PerspectiveCamera | null = null;
  private vex = 1;
  private distance = 1;
  private readonly visibleNow = (): Box | null => this.boxFor(0);

  // Statistics.
  private readonly log = new SliceLog();
  private idle: Idle = 'off';
  private planLevel: WindGlyphStats['level'] = 0;
  private glyphs = 0;
  private segments = 0;
  private cellPx = 0;
  private cellM = 0;
  private rebuilds = 0;

  constructor(shared: Record<string, THREE.IUniform>, tier: GlyphTier, deps: GlyphLayerDeps = {}) {
    this.tier = tier;
    this.clock = deps.now ?? (() => performance.now());
    this.warmOnEnable = deps.warm ?? true;
    this.builder = (deps.createBuilder ?? createGlyphBuilder)(tier);
    const capacity = GLYPH_CAPS[tier].segments;
    // Plain strokes of one colour at full alpha (the segments overlap by about a pixel, so no translucency), no fog (the legend's
    // colours stay exact), tested against the ground so a ridge hides what is behind it.
    const stroke = { capacity, headPx: 0, tailAlpha: 1, fog: false, depthTest: true, shared };
    this.halo = new StreakBatch({ ...stroke, widthPx: HALO_WIDTH_PX });
    this.colour = new StreakBatch({ ...stroke, widthPx: GLYPH_WIDTH_PX });
    this.halo.mesh.name = 'wind-glyph-halo';
    this.halo.mesh.renderOrder = 5;
    this.colour.mesh.name = 'wind-glyph';
    this.colour.mesh.renderOrder = 6;
    this.halo.mesh.visible = this.colour.mesh.visible = false;
    // The halo is one dark ink everywhere: filled once, never again.
    const c = this.halo.c;
    for (let i = 0; i < capacity; i++) {
      c[i * 4] = HALO_INK[0];
      c[i * 4 + 1] = HALO_INK[1];
      c[i * 4 + 2] = HALO_INK[2];
      c[i * 4 + 3] = 1;
    }
    this.group.name = 'wind-glyphs';
    this.group.add(this.halo.mesh, this.colour.mesh);
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.warm();
  }

  setHeight(h: WindHeight): void {
    this.height = h;
  }

  /** Strokes are baked in device pixels: a new pixel ratio changes the widths and nothing else. */
  setDpr(dpr: number): void {
    this.halo.widthPx = HALO_WIDTH_PX * dpr;
    this.colour.widthPx = GLYPH_WIDTH_PX * dpr;
  }

  /** A new picture of the air (or none: a new scenario). The traces are redone at the next rebuild, never per camera move. */
  setData(d: GlyphData | null): void {
    this.data = d;
    this.dataSerial++;
    this.surface = undefined;
  }

  /**
   * Once per frame, before the idle return. Decides, stages and swaps; true when what is drawn changed (a swapped picture, or
   * the glyphs hidden or shown), so the frame must be drawn. `settle` (screenshots, tests) skips the throttle and the slice
   * budget: the picture is finished in this call.
   */
  tick(now: number, camera: THREE.PerspectiveCamera, css: GlyphCss, mode: ViewMode, vex: number, targetDistance: number, framesTriangles: number, settle: boolean): boolean {
    if (!this.enabled) return this.hide('off');
    if (mode === 'ground') return this.hide('eye-level'); // the target is 1 m away: a cell on screen means nothing there
    const d = this.data;
    if (!d || !this.hasField(d)) return this.hide('no-wind');

    // The pose of this frame (the camera, the orbit target it looks at, the canvas, the exaggeration) and the projection's numbers.
    const q = camera.quaternion;
    const p = camera.position;
    const f = this.fwd.set(0, 0, -1).applyQuaternion(q);
    const pose = this.pose;
    pose[0] = p.x;
    pose[1] = p.y;
    pose[2] = p.z;
    pose[3] = p.x + f.x * targetDistance;
    pose[4] = p.z + f.z * targetDistance;
    pose[5] = q.x;
    pose[6] = q.y;
    pose[7] = q.z;
    pose[8] = q.w;
    pose[9] = css.w;
    pose[10] = css.h;
    pose[11] = vex;
    const proj = this.proj;
    proj[0] = camera.fov;
    proj[1] = camera.projectionMatrix.elements[8]!;
    proj[2] = camera.projectionMatrix.elements[9]!;
    // Nothing changed since the last frame and nothing is waiting: the whole idle cost is this comparison.
    if (this.sigValid && !this.working && !this.waiting && this.dataSerial === this.lastSerial && this.height === this.lastHeight && same(pose, this.lastPose) && same(proj, this.lastProj)) return false;
    this.lastPose.set(pose);
    this.lastProj.set(proj);
    this.lastSerial = this.dataSerial;
    this.lastHeight = this.height;
    this.sigValid = true;
    camera.updateMatrixWorld();
    this.cam = camera;
    this.vex = vex;
    this.distance = targetDistance;

    // The level of detail from how many pixels one model cell covers at the middle of the screen.
    const grid = d.atm!.grid;
    const mpp = metresPerPixelAt(targetDistance, css.fov, css.h);
    const lod = planLod(grid.cellSize / mpp, mpp, this.lod);
    this.lod = lod;
    this.cellPx = lod.cellPx;
    this.cellM = grid.cellSize;
    if (lod.level === 0) return this.hide(null, true);
    this.idle = null;
    this.planLevel = lod.level;

    const n = this.current;
    n.dataSerial = this.dataSerial;
    n.height = this.height;
    n.level = lod.level;
    n.spacingExp = lod.spacingExp;
    n.distanceM = targetDistance;
    // A rebuild under way is thrown away when it is about a different picture; a camera that moved only makes the next one.
    if (this.working && (this.next.dataSerial !== n.dataSerial || this.next.height !== n.height || this.next.level !== n.level || this.next.spacingExp !== n.spacingExp)) this.cancel();
    if (!this.working) {
      const reason = rebuildReason(this.builtValid ? this.built : null, n, this.visibleNow);
      if (reason === null) {
        this.waiting = false;
        return false;
      }
      if (!mayRebuild(reason, now, this.lastSwapAt, settle)) {
        this.waiting = true;
        return false;
      }
      this.waiting = false;
      this.working = true;
      this.begun = false;
      this.next.dataSerial = n.dataSerial;
      this.next.height = n.height;
      this.next.level = n.level;
      this.next.spacingExp = n.spacingExp;
    }
    return this.advance(now, d, lod, css, vex, framesTriangles, settle);
  }

  stats(): WindGlyphStats {
    const log = this.log;
    return {
      active: this.shown,
      idle: this.idle,
      level: this.planLevel,
      count: this.glyphs,
      segments: this.segments,
      cellPx: this.cellPx,
      cellM: this.cellM,
      rebuilds: this.rebuilds,
      lastMs: log.lastMs,
      sliceP95Ms: log.p95(),
      sliceMaxMs: log.max(),
      slicesLast: log.slicesLast,
    };
  }

  dispose(): void {
    this.builder.cancel();
    this.halo.dispose();
    this.colour.dispose();
  }

  // ───────────────────────────────────────────────────────────────────────────

  /** Air with wind to draw: the view has it, and for `'fire'` the model's 10 m wind raster too. */
  private hasField(d: GlyphData): boolean {
    if (!d.atm || !d.sampler.hasWind) return false;
    if (this.height !== 'fire') return true;
    if (this.surface === undefined) this.surface = surfaceRaster(d.atm);
    return this.surface !== null;
  }

  /** Draw nothing: the stroke batches empty, a rebuild under way dropped, the next picture built afresh. True when something was shown. */
  private hide(idle: Idle, keepSig = false): boolean {
    this.idle = idle;
    if (idle) this.cellPx = 0;
    this.planLevel = 0;
    this.glyphs = 0;
    this.segments = 0;
    this.waiting = false;
    if (!keepSig) this.sigValid = false;
    if (this.working) this.cancel();
    this.builtValid = false;
    if (!this.shown) return false;
    this.halo.commit(0);
    this.colour.commit(0);
    this.setShown(false);
    return true;
  }

  private setShown(on: boolean): void {
    this.shown = on;
    this.halo.mesh.visible = this.colour.mesh.visible = on;
  }

  private cancel(): void {
    this.builder.cancel();
    this.log.abandon();
    this.working = false;
    this.begun = false;
  }

  /** One frame's share of a rebuild: the raster fill (its own slice), then the builder's slices; the swap on the last one. */
  private advance(now: number, d: GlyphData, lod: LodPlan, css: GlyphCss, vex: number, framesTriangles: number, settle: boolean): boolean {
    if (!this.begun) {
      const filled = this.fill(d, refineFor(lod.cellPx));
      if (filled && !settle) return false; // the trace starts next frame, from the camera as it is then
      if (!this.begin(d, lod, css, vex, framesTriangles)) return this.swapEmpty(now);
    }
    const t0 = this.clock();
    const done = this.builder.step(settle ? Infinity : SLICE_BUDGET_MS);
    this.log.push(this.clock() - t0);
    return done ? this.swap(now, framesTriangles) : false;
  }

  /** Fill the raster for this data, height and refinement when it is not already; true when a fill ran (timed as a slice). */
  private fill(d: GlyphData, refine: 1 | 2): boolean {
    if (this.height === 'fire') {
      this.raster = this.surface!;
      this.rasterHeight = null; // a later numeric height must fill afresh
      return false;
    }
    if (this.raster && this.rasterSerial === this.dataSerial && this.rasterHeight === this.height && this.rasterRefine === refine) return false;
    const g = d.atm!.grid;
    const need = Math.max(g.nx, g.ny);
    if (!this.heightRaster || this.heightRasterN < need) {
      this.heightRaster = new HeightRaster(need);
      this.heightRasterN = need;
    }
    const t0 = this.clock();
    this.raster = this.heightRaster.fill(d.sampler, d.sliceGround, this.height, refine);
    this.log.push(this.clock() - t0);
    this.rasterSerial = this.dataSerial;
    this.rasterHeight = this.height;
    this.rasterRefine = refine;
    return true;
  }

  /** Hand the builder its input, taken from the camera now. False when no ground is in view (nothing to trace). */
  private begin(d: GlyphData, lod: LodPlan, css: GlyphCss, vex: number, framesTriangles: number): boolean {
    const cam = this.cam!;
    const box = this.boxFor(0.25);
    const next = this.next;
    next.level = lod.level;
    next.spacingExp = lod.spacingExp;
    next.pose.set(this.pose);
    next.proj.set(this.proj);
    if (!box) {
      next.box = { x0: 0, y0: 0, x1: 0, y1: 0 };
      return false;
    }
    next.box = box;
    this.viewProj.set(this.unproject.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements);
    const caps = GLYPH_CAPS[this.tier];
    const input: GlyphInput = {
      field: this.raster!,
      ground: d.drawGround,
      vex,
      lod,
      eye: this.eye,
      viewProj: this.viewProj,
      cssW: css.w,
      cssH: css.h,
      pxPerMetre1: css.h / (2 * Math.tan((css.fov * Math.PI) / 360)),
      near: cam.near,
      box,
      cap: { glyphs: caps.glyphs, segments: segmentCap(caps.segments, framesTriangles, this.shown ? this.segments : 0) },
      now: this.clock,
    };
    this.builder.begin(input);
    this.begun = true;
    return true;
  }

  /** The finished picture replaces the drawn one: copied into both batches, which change only here. */
  private swap(now: number, framesTriangles: number): boolean {
    const out = this.builder.out;
    // The room may have changed since the build began (the frame's other layers moved): the cap is applied again.
    const n = Math.min(out.segments, segmentCap(this.halo.capacity, framesTriangles, this.shown ? this.segments : 0), this.halo.capacity);
    const a = out.a.subarray(0, n * 3);
    const b = out.b.subarray(0, n * 3);
    this.halo.a.set(a);
    this.halo.b.set(b);
    this.colour.a.set(a);
    this.colour.b.set(b);
    this.colour.c.set(out.c.subarray(0, n * 4));
    this.halo.commit(n);
    this.colour.commit(n);
    this.setShown(n > 0);
    this.segments = n;
    this.glyphs = n === out.segments ? out.glyphs : Math.round((out.glyphs * n) / Math.max(1, out.segments));
    return this.finish(now);
  }

  /** No ground in view: an empty picture, so the frame loop does not ask again until the camera sees ground. */
  private swapEmpty(now: number): boolean {
    const wasShown = this.shown;
    this.halo.commit(0);
    this.colour.commit(0);
    this.setShown(false);
    this.segments = 0;
    this.glyphs = 0;
    this.finish(now);
    return wasShown;
  }

  private finish(now: number): boolean {
    const built = this.built;
    this.built = this.next;
    this.next = built;
    this.builtValid = true;
    this.lastSwapAt = now;
    this.working = false;
    this.begun = false;
    this.rebuilds++;
    this.log.finish();
    return true;
  }

  /** The ground the camera can see (local metres), grown by `margin`, inside the wind's own domain. */
  private boxFor(margin: number): Box | null {
    const cam = this.cam!;
    const g: GridSpec = this.data!.atm!.grid;
    const bounds = this.bounds;
    bounds.x0 = g.x0;
    bounds.y0 = g.y0;
    bounds.x1 = g.x0 + (g.nx - 1) * g.cellSize;
    bounds.y1 = g.y0 + (g.ny - 1) * g.cellSize;
    const p = cam.position;
    this.eye[0] = p.x;
    this.eye[1] = p.y;
    this.eye[2] = p.z;
    this.unproject.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    // The lowest ground of the drawn mesh is the plane the rays are cut with: every downward ray meets the real ground before it.
    return visibleBox(this.unproject.elements, this.eye, this.lowest(this.data!.drawGround) * this.vex, bounds, Math.max(MIN_RANGE_M, RANGE_PER_DISTANCE * this.distance), margin);
  }

  private lowest(g: GroundRaster): number {
    if (this.groundMin?.of !== g) {
      let lo = Infinity;
      for (let k = 0; k < g.elevation.length; k++) if (g.elevation[k]! < lo) lo = g.elevation[k]!;
      this.groundMin = { of: g, y: Number.isFinite(lo) ? lo : 0 };
    }
    return this.groundMin.y;
  }

  /** One throw-away rebuild of a few glyphs on a made-up wind, so the first real one does not pay for a cold tracer. */
  private warm(): void {
    if (this.warmed || !this.warmOnEnable) return;
    this.warmed = true;
    const n = 24;
    const grid: GridSpec = { nx: n, ny: n, cellSize: 100, x0: -1150, y0: -1150, origin: { lat: 0, lon: 0 } };
    const u = new Float32Array(n * n);
    const v = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        u[j * n + i] = 6 + 2 * Math.sin(i * 0.3);
        v[j * n + i] = 2 * Math.cos(j * 0.3);
      }
    }
    const cam = new THREE.PerspectiveCamera(50, 0.5, 5, 60000);
    cam.position.set(0, 2600, 1800);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const cssH = 800;
    const mpp = metresPerPixelAt(Math.hypot(2600, 1800), 50, cssH);
    const lod = planLod(40, mpp, null); // a curved level: the trace the real rebuilds run
    const p = cam.position;
    this.builder.begin({
      field: { grid, u, v },
      ground: { grid, elevation: new Float32Array(n * n) },
      vex: 1,
      lod,
      eye: [p.x, p.y, p.z],
      viewProj: this.unproject.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements,
      cssW: 400,
      cssH,
      pxPerMetre1: cssH / (2 * Math.tan((50 * Math.PI) / 360)),
      near: cam.near,
      box: { x0: -1000, y0: -1000, x1: 1000, y1: 1000 },
      cap: { glyphs: WARM_GLYPHS, segments: WARM_GLYPHS * 12 },
      now: this.clock,
    });
    let guard = 0;
    while (!this.builder.step(Infinity) && guard++ < 1000) {
      // run to the end
    }
    this.builder.cancel();
  }
}

const same = (a: Float64Array, b: Float64Array): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
