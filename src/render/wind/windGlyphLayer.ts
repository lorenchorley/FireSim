/**
 * Wind arrows and flow lines drawn on the map (0.5.0, stage E1): the Three.js side of the zoom-adaptive glyphs. The pure engine
 * (`flowGlyphs.ts`) traces the glyphs into flat arrays; this layer decides when, copies them into two `StreakBatch`es (a dark halo
 * under a coloured stroke, so the pale stops of the wind ramp stay readable on every ground) and keeps the work off the frame:
 *
 *  - it lives inside the frame loop (`tick`, once per frame before the idle return) and never sets `animating`: nothing here
 *    moves, so a still map stays still and the loop only draws when `tick` says a new picture was swapped in;
 *  - a rebuild starts when the drawn picture is out of date (`glyphSchedule.rebuildReason`), at most once per 250 ms, and is
 *    staged: the raster fill in slices of its own (resumable by rows), then the trace in slices of at most 8 ms; the batches
 *    change only at the swap;
 *  - the segment cap follows `renderer.info`, so a frame never crosses `FRAME_TRIANGLE_LIMIT`; when that leaves no room at all
 *    nothing is drawn and `stats().idle` says `budget` (the layer looks again when the frame has room);
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
/**
 * The strokes lie 1.5 m or so above the ground, under the canopy, which is drawn (a crown of 20 to 30 m would hide most of every flow
 * line close in). They are drawn where they are but tested for depth as if this many metres nearer the eye, so a crown in front of a
 * stroke does not hide it while a ridge, which stands well over this much in front of what is behind it, still does. (Switching the
 * depth test off instead shows every line behind every ridge.)
 */
export const GLYPH_DEPTH_BIAS_M = 40;
/** What one slice of a rebuild may take on the main thread (ms, the device's own clock). */
const SLICE_BUDGET_MS = 8;
/** How far the ground is enumerated toward the horizon: this many camera distances, at least `MIN_RANGE_M`. */
const RANGE_PER_DISTANCE = 6;
const MIN_RANGE_M = 3000;
/** Room (a share of the tier's segment cap) a frame must have again before a picture that was trimmed to nothing is built afresh. */
const BUDGET_RETRY_SHARE = 0.1;

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
}

type Idle = WindGlyphStats['idle'];

const newPlan = (): LodPlan => ({ level: 0, cellPx: 0, spacingPx: 0, spacingExp: 0, spacingM: 0, curved: false, jitter: 0, lengthPx: { min: 0, max: 0, pxPerMs: 0 } });
const copyPlan = (from: LodPlan, to: LodPlan): void => {
  to.level = from.level;
  to.cellPx = from.cellPx;
  to.spacingPx = from.spacingPx;
  to.spacingExp = from.spacingExp;
  to.spacingM = from.spacingM;
  to.curved = from.curved;
  to.jitter = from.jitter;
  to.lengthPx.min = from.lengthPx.min;
  to.lengthPx.max = from.lengthPx.max;
  to.lengthPx.pxPerMs = from.lengthPx.pxPerMs;
  to.mppCentre = from.mppCentre;
};
const newBuilt = (): BuiltPicture => ({ dataSerial: -1, height: 'fire', level: 0, spacingExp: 0, pose: new Float64Array(12), proj: new Float64Array(3), box: { x0: 0, y0: 0, x1: 0, y1: 0 } });

export class WindGlyphLayer {
  readonly group = new THREE.Group();
  private readonly halo: StreakBatch;
  private readonly colour: StreakBatch;
  private readonly builder: GlyphBuilder;
  private readonly tier: GlyphTier;
  private readonly clock: () => number;

  private enabled = false;
  private height: WindHeight = 'fire';
  private data: GlyphData | null = null;
  /** One per `setData`: a picture of the air is the same picture until it changes. */
  private dataSerial = 0;
  /** `surfaceRaster` of this data, computed once (undefined = not asked yet). */
  private surface: FlowRaster | null | undefined;
  private heightRaster: HeightRaster | null = null;
  /** What the raster in use was filled for. */
  private raster: FlowRaster | null = null;
  private rasterSerial = -1;
  private rasterHeight: WindHeight | null = null;
  private rasterRefine = 0;
  private groundMin: { of: GroundRaster; y: number } | null = null;

  /** The plan of this frame (the planner fills it in place, and reads it back for its hysteresis) and the copy a rebuild in progress runs with. */
  private readonly plan = newPlan();
  private readonly buildPlan = newPlan();
  private planKept = false;
  private built: BuiltPicture = newBuilt();
  private next: BuiltPicture = newBuilt();
  private builtValid = false;
  /** A rebuild is in progress (its slices run one per frame); `begun` once the builder has its input. */
  private working = false;
  private begun = false;
  private waiting = false;
  /** The raster fill of a rebuild is under way (in slices; `fillRefine` is its refinement). */
  private filling = false;
  private fillRefine: 1 | 2 = 1;
  /** The last picture was trimmed to nothing by the triangle limit (`stats().idle` is `budget` until one is drawn or the glyphs hide). */
  private noRoom = false;
  /** The segment cap the rebuild in progress was begun with. */
  private beginSegments = 0;
  private lastSwapAt = -Infinity;
  private shown = false;

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
  private readonly bounds: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly boxNow: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private cam: THREE.PerspectiveCamera | null = null;
  private vex = 1;
  private distance = 1;
  private readonly visibleNow = (): Box | null => this.boxFor(0, this.boxNow);

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
    this.builder = (deps.createBuilder ?? createGlyphBuilder)(tier);
    const capacity = GLYPH_CAPS[tier].segments;
    // Plain strokes of one colour at full alpha (the segments overlap by about a pixel, so no translucency), no fog (the legend's
    // colours stay exact), tested against the ground so a ridge hides what is behind it (see GLYPH_DEPTH_BIAS_M for the trees).
    const stroke = { capacity, headPx: 0, tailAlpha: 1, fog: false, depthTest: true, depthBiasM: GLYPH_DEPTH_BIAS_M, shared };
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
  }

  setHeight(h: WindHeight): void {
    this.height = h;
  }

  // 0.6.0 C0 stubs: the D-render lane writes these four (the detailed streaks of the most detailed level).
  /** Whether the Wind streaks switch wants the detailed picture at the most detailed level (the glyph switch may be off). */
  setStreaksDetail(_on: boolean): void {}

  /** Whether motion is allowed (false under reduced motion: the detailed streaks stand still). */
  setMotion(_allowed: boolean): void {}

  /** The detailed streaks are drawn in motion, so the frame loop must keep drawing. */
  get animating(): boolean {
    return false;
  }

  /** The detailed streaks are on screen (the old Wind streaks step aside while they are). */
  get detailShown(): boolean {
    return false;
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
    // (The quaternion is copied with `toArray` and the forward direction worked out from the copy: THREE's x, y, z and w are getters, and
    // a getter that V8 does not inline hands back a boxed number, which would make every frame of a map at rest allocate.)
    const p = camera.position;
    const pose = this.pose;
    camera.quaternion.toArray(pose, 5);
    const qx = pose[5]!;
    const qy = pose[6]!;
    const qz = pose[7]!;
    const qw = pose[8]!;
    pose[0] = p.x;
    pose[1] = p.y;
    pose[2] = p.z;
    pose[3] = p.x - 2 * (qw * qy + qz * qx) * targetDistance; // the orbit target: the eye plus the distance along the forward axis (0, 0, -1) turned by q
    pose[4] = p.z + (2 * (qx * qx + qy * qy) - 1) * targetDistance;
    pose[9] = css.w;
    pose[10] = css.h;
    pose[11] = vex;
    const proj = this.proj;
    proj[0] = camera.fov;
    proj[1] = camera.projectionMatrix.elements[8]!;
    proj[2] = camera.projectionMatrix.elements[9]!;
    // A picture trimmed to nothing is built again once the frame has room (a layer switched off, a smaller view), with no camera move needed.
    const retry = this.noRoom && segmentCap(GLYPH_CAPS[this.tier].segments, framesTriangles, 0) >= BUDGET_RETRY_SHARE * GLYPH_CAPS[this.tier].segments;
    // Nothing changed since the last frame and nothing is waiting: the whole idle cost is this comparison.
    if (this.sigValid && !retry && !this.working && !this.waiting && this.dataSerial === this.lastSerial && this.height === this.lastHeight && same(pose, this.lastPose) && same(proj, this.lastProj)) return false;
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
    const lod = planLod(grid.cellSize / mpp, mpp, this.planKept ? this.plan : null, this.plan);
    this.planKept = true;
    this.cellPx = lod.cellPx;
    this.cellM = grid.cellSize;
    if (lod.level === 0) return this.hide(null, true);
    this.idle = this.noRoom ? 'budget' : null;
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
      const reason = rebuildReason(this.builtValid ? this.built : null, n, this.visibleNow) ?? (retry ? 'room' : null);
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
      detail: 'off',
      detailSegments: 0,
    };
  }

  dispose(): void {
    this.builder.cancel();
    this.heightRaster?.cancel();
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
    this.noRoom = false;
    if (!keepSig) this.sigValid = false;
    if (this.working) this.cancel();
    this.builtValid = false;
    if (!this.shown) return false;
    this.halo.commit(0);
    this.colour.commit(0);
    this.setShown(false);
    return true;
  }

  private setNoRoom(on: boolean): void {
    this.noRoom = on;
    this.idle = on ? 'budget' : null;
  }

  private setShown(on: boolean): void {
    this.shown = on;
    this.halo.mesh.visible = this.colour.mesh.visible = on;
  }

  private cancel(): void {
    this.builder.cancel();
    this.heightRaster?.cancel();
    this.filling = false;
    this.log.abandon();
    this.working = false;
    this.begun = false;
  }

  /** One frame's share of a rebuild: the raster fill (its own slices), then the builder's slices; the swap on the last one. */
  private advance(now: number, d: GlyphData, lod: LodPlan, css: GlyphCss, vex: number, framesTriangles: number, settle: boolean): boolean {
    if (!this.begun) {
      const filled = this.fill(d, refineFor(lod.cellPx), settle);
      if (filled === 'more' || (filled === 'done' && !settle)) return false; // the trace starts a frame after the fill, from the camera as it is then
      if (!this.begin(d, lod, css, vex, framesTriangles)) return this.swapEmpty(now);
    }
    const t0 = this.clock();
    const done = this.builder.step(settle ? Infinity : SLICE_BUDGET_MS);
    this.log.push(this.clock() - t0);
    return done ? this.swap(now, framesTriangles) : false;
  }

  /**
   * Make the raster for this data, height and refinement, in slices (one per call, each stopping on the clock; `settle` runs it to the
   * end): `ready` when there is nothing to do, `more` while the fill is under way, `done` on the call that completed it. A fill that
   * is begun invalidates the last raster (its storage may be reused), and one that is cancelled leaves none.
   */
  private fill(d: GlyphData, refine: 1 | 2, settle: boolean): 'ready' | 'more' | 'done' {
    if (this.height === 'fire') {
      this.raster = this.surface!;
      this.rasterHeight = null; // a later numeric height must fill afresh
      return 'ready';
    }
    const hr = (this.heightRaster ??= new HeightRaster());
    if (!this.filling) {
      if (this.raster && this.rasterSerial === this.dataSerial && this.rasterHeight === this.height && this.rasterRefine === refine) return 'ready';
      hr.begin(d.sampler, d.sliceGround, this.height, refine);
      this.filling = true;
      this.fillRefine = refine;
      this.raster = null;
      this.rasterSerial = -1;
      this.rasterHeight = null;
    }
    const t0 = this.clock();
    const done = hr.step(settle ? Infinity : SLICE_BUDGET_MS, this.clock);
    this.log.push(this.clock() - t0);
    if (!done) return 'more';
    this.filling = false;
    this.raster = hr.raster;
    this.rasterSerial = this.dataSerial;
    this.rasterHeight = this.height;
    this.rasterRefine = this.fillRefine;
    return 'done';
  }

  /** Hand the builder its input, taken from the camera now. False when no ground is in view (nothing to trace). */
  private begin(d: GlyphData, lod: LodPlan, css: GlyphCss, vex: number, framesTriangles: number): boolean {
    const cam = this.cam!;
    const next = this.next;
    next.level = lod.level;
    next.spacingExp = lod.spacingExp;
    next.pose.set(this.pose);
    next.proj.set(this.proj);
    const box = this.boxFor(0.25, next.box);
    if (!box) {
      next.box.x0 = next.box.y0 = next.box.x1 = next.box.y1 = 0;
      return false;
    }
    copyPlan(lod, this.buildPlan);
    this.viewProj.set(this.unproject.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements);
    const caps = GLYPH_CAPS[this.tier];
    this.beginSegments = segmentCap(caps.segments, framesTriangles, this.shown ? this.segments : 0);
    const input: GlyphInput = {
      field: this.raster!,
      ground: d.drawGround,
      vex,
      lod: this.buildPlan,
      eye: this.eye,
      viewProj: this.viewProj,
      cssW: css.w,
      cssH: css.h,
      pxPerMetre1: css.h / (2 * Math.tan((css.fov * Math.PI) / 360)),
      near: cam.near,
      box,
      cap: { glyphs: caps.glyphs, segments: this.beginSegments },
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
    const room = Math.min(segmentCap(this.halo.capacity, framesTriangles, this.shown ? this.segments : 0), this.halo.capacity);
    const n = Math.min(out.segments, room);
    // The rest of the frame already uses every triangle: nothing of ours fits, and the control says so. (A build that was given no room
    // at its start drew nothing for that reason too, whatever the frame has by now: the next rebuild is due as soon as there is room.)
    this.setNoRoom(room === 0 || this.beginSegments === 0);
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
    this.setNoRoom(false);
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

  /** The ground the camera can see (local metres), grown by `margin`, inside the wind's own domain, written into `out`. */
  private boxFor(margin: number, out: Box): Box | null {
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
    return visibleBox(this.unproject.elements, this.eye, this.lowest(this.data!.drawGround) * this.vex, bounds, Math.max(MIN_RANGE_M, RANGE_PER_DISTANCE * this.distance), margin, out);
  }

  private lowest(g: GroundRaster): number {
    if (this.groundMin?.of !== g) {
      let lo = Infinity;
      for (let k = 0; k < g.elevation.length; k++) if (g.elevation[k]! < lo) lo = g.elevation[k]!;
      this.groundMin = { of: g, y: Number.isFinite(lo) ? lo : 0 };
    }
    return this.groundMin.y;
  }
}

const same = (a: Float64Array, b: Float64Array): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
