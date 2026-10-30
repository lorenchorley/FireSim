/**
 * Wind arrows and flow lines drawn on the map (0.5.0, stage E1): the Three.js side of the zoom-adaptive glyphs. The pure engine
 * (`flowGlyphs.ts`) traces the glyphs into flat arrays; this layer decides when, copies them into two `StreakBatch`es (a dark halo
 * under a coloured stroke, so the pale stops of the wind ramp stay readable on every ground) and keeps the work off the frame:
 *
 *  - it lives inside the frame loop (`tick`, once per frame before the idle return). The arrows and flow lines never move, so a
 *    still map stays still and the loop only draws when `tick` says a new picture was swapped in. The one thing that moves is the
 *    most detailed level (0.6.0), which draws the detailed streaks instead (`detailBatch.ts`, animated on the GPU from the clock:
 *    no work per frame here but a fade ramp while it comes in or goes out); `animating` is true only while those are drawn in motion;
 *  - a rebuild starts when the drawn picture is out of date (`glyphSchedule.rebuildReason`), at most once per 250 ms, and is
 *    staged: the raster fill in slices of its own (resumable by rows), then the trace in slices of at most 8 ms; the batches
 *    change only at the swap;
 *  - the segment cap follows `renderer.info`, so a frame never crosses `FRAME_TRIANGLE_LIMIT`; when that leaves no room at all
 *    nothing is drawn and `stats().idle` says `budget` (the layer looks again when the frame has room). The one exception is the
 *    detailed streaks, which keep `DETAIL_MIN_SEGMENTS` however full the frame is (a dense forest at the High tier is over the limit
 *    without them): that is the High tier's whole cap, so they are never trimmed, the closest zoom always has its picture, the same view
 *    gives the same picture, and the limit is exceeded by at most 2 triangles a segment of it;
 *  - the picture is draped on the drawn mesh a little above the ground; the numbers come from the 10 m ground as received.
 * Eye level, a view without air wind and a map zoomed so far out that a model cell is under 4 px draw nothing (`stats().idle`).
 *
 * The detailed streaks (0.6.0) are what the most detailed level draws, whichever of the two switches asked for it (the arrows and flow lines,
 * or the Wind streaks, `setStreaksDetail`): at that level the glyph batches are empty and the detail batch holds the picture, below it the
 * reverse. With only the Wind streaks on, nothing is built below the most detailed level (the old particles draw there) but the level is
 * still told. The hand-over never goes through an empty frame: the old picture stays until the new one swaps in, the detailed streaks fade in
 * over 400 ms and out over 250 ms (from the frame time capped at 0.1 s, so a page that was hidden resumes without a jump), and the old
 * particles step aside only while the detailed streaks are drawn (`detailShown`), so a picture trimmed to nothing gives them back.
 *
 * 0.7.0 (docs/plans/0.7.0/D-CONTRACT-070-detail-looks.md): the detailed builder is also given the canopy (`setCanopy`, a `FuelMap` by reference),
 * the placed crowns (`setCrowns`, a `CrownSource` by reference) and the fire's plume (`setPlumes`), so that the streaks ride on the canopy top, bend
 * round ridges and crowns and curl into eddies (display only: the direction of a line, never its speed or colour). A change of the crowns (the
 * forest was placed again) or of the canopy makes the `'canopy'` rebuild reason; `DETAIL_RELIEF.enabled` (or `setRelief(false)`) draws the 0.6.0
 * picture, byte for byte. `setPaused` is the idle stop's word (`detail: 'paused'`), `precompile` the shader's early compile, and `stats().tickMaxMs`
 * the layer's own share of a frame.
 */
import * as THREE from 'three';
import type { GridSpec } from '../../core/grid';
import type { AtmosphereView, FireWindRaster, FuelMap } from '../../core/types';
import type { WindGlyphStats } from '../api';
import type { AtmosphereSampler } from '../atmosphereSampler';
import type { ViewMode } from '../cameraRig';
import { StreakBatch } from '../streaks';
import { DETAIL_DEPTH_BIAS_M, DETAIL_WIDTH_PX, DetailBatch } from './detailBatch';
import { createDetailBuilder } from './detailStreaks';
import { createGlyphBuilder, HALO_INK } from './flowGlyphs';
import { HeightRaster, refineFor, surfaceRaster } from './glyphField';
import { metresPerPixelAt, planLod, visibleBox } from './glyphLod';
import { mayRebuild, rebuildReason, segmentCap, SliceLog, type BuiltPicture, type PictureNow } from './glyphSchedule';
import { DETAIL_FADE_IN_MS, DETAIL_FADE_OUT_MS, DETAIL_LEVEL, DETAIL_MIN_SEGMENTS, DETAIL_RELIEF, GLYPH_CAPS, type Box, type CrownSource, type DetailBuilder, type DetailInput, type FlowRaster, type GlyphBuilder, type GlyphInput, type GlyphTier, type GroundRaster, type LodPlan, type Plume, type WindHeight, type DetailRelief } from './glyphTypes';

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
/**
 * The first slices of a builder run in code that is still interpreted (a cold line costs 100 times a warm one) and cannot stop on the clock any
 * sooner than its next check: they are given half the budget (0.7.0: the cold first zoom into the most detailed level overshot 8 ms by 2 to 7).
 */
const COLD_SLICE_BUDGET_MS = 4;
const COLD_SLICES = 2;
/** How far the ground is enumerated toward the horizon: this many camera distances, at least `MIN_RANGE_M`. */
const RANGE_PER_DISTANCE = 6;
const MIN_RANGE_M = 3000;
/** Room (a share of the tier's segment cap) a frame must have again before a picture that was trimmed to nothing is built afresh. */
const BUDGET_RETRY_SHARE = 0.1;
/** The frame time a fade may take in one step (ms): a page that was hidden for a minute resumes with a short step, not a jump. */
const MAX_FADE_STEP_MS = 100;
/** Triangles a segment of each kind costs the frame: the glyph pair draws a quad in two batches, the detailed streaks one. */
const GLYPH_TRIANGLES = 4;
const DETAIL_TRIANGLES = 2;

/** What the layer reads, per snapshot: the air, the ground the numbers come from and the ground the picture is draped on. */
export interface GlyphData {
  sampler: AtmosphereSampler;
  atm: AtmosphereView | null;
  /** The 10 m ground as received (the wind heights are above it). */
  sliceGround: GroundRaster;
  /** The drawn mesh (the glyphs sit on it). */
  drawGround: GroundRaster;
  /** 0.7.0 (item B): the wind the fire feels, for the `'felt'` height (null or absent: none, so `'felt'` has no field and the layer is idle `no-wind`). Unread until the E2 picture lane. */
  fireWind?: FireWindRaster | null;
}

/** The part of the renderer `precompile` uses (`THREE.WebGLRenderer` has both). */
export interface PrecompileTarget {
  compile?(scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Object3D | null): unknown;
  compileAsync?(scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Object3D | null): Promise<unknown>;
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
  createDetailBuilder?: (tier: GlyphTier) => DetailBuilder;
  now?: () => number;
}

type Idle = WindGlyphStats['idle'];

const NO_PLUMES: readonly Plume[] = [];
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
  to.thin = from.thin;
};
const newBuilt = (): BuiltPicture => ({ dataSerial: -1, height: 'fire', level: 0, spacingExp: 0, thin: 1, crownSerial: 0, pose: new Float64Array(12), proj: new Float64Array(3), box: { x0: 0, y0: 0, x1: 0, y1: 0 } });

export class WindGlyphLayer {
  readonly group = new THREE.Group();
  private readonly halo: StreakBatch;
  private readonly colour: StreakBatch;
  /** The detailed streaks of the most detailed level (0.6.0): one batch, animated on the GPU. */
  private readonly detail: DetailBatch;
  private readonly builder: GlyphBuilder;
  private readonly detailBuilder: DetailBuilder;
  private readonly tier: GlyphTier;
  private readonly clock: () => number;

  private enabled = false;
  /** The Wind streaks switch is on (and is the surface kind): the detailed streaks are wanted at the most detailed level even with the glyph switch off. */
  private streaksDetail = false;
  /** Motion is allowed (false under reduced motion: the detailed streaks stand still). */
  private motion = true;
  /** The view holds still after a minute without a touch (`setPaused`): the streaks are drawn but do not move. */
  private paused = false;
  /** The relief terms of the detailed streaks are on (the switch of the tests and of the tuning; `DETAIL_RELIEF.enabled` is the constant that kills them). */
  private reliefOn = true;
  /** What the relief reads: the canopy, the placed crowns (and the serial of them the last frame saw), the plume. */
  private canopy: FuelMap | null = null;
  private crownSrc: CrownSource | null = null;
  private crownSeen = 0;
  private plumes: readonly Plume[] = NO_PLUMES;
  /** Counts every change of what the relief reads (the canopy, the crowns, the switch): a picture built for another count is out of date (`'canopy'`). From 1, so that 0 is "no relief". */
  private reliefSerial = 1;
  private lastRelief = -1;
  private compiled = false;
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
  /** Slices run so far by the glyph builder (0) and by the detailed one (1): the first `COLD_SLICES` of each take the cold budget. */
  private readonly coldSlices = new Int32Array(2);
  private shown = false;
  /** The detailed streaks are on screen (a picture of at least one segment, not yet faded out), what they hold, and how far they have faded in (0 to 1) toward `fadeTo`. */
  private detailOn = false;
  private detailSegments = 0;
  private detailLines = 0;
  private fade = 0;
  private fadeTo = 0;
  /** The time of the last tick (ms), for the fade. */
  private lastTickMs = -1;

  // The pose of this frame and of the previous one, the projection's numbers, and scratch for the view maths (no allocation per frame).
  private readonly pose = new Float64Array(12);
  private readonly lastPose = new Float64Array(12);
  private readonly proj = new Float64Array(3);
  private readonly lastProj = new Float64Array(3);
  private sigValid = false;
  private lastSerial = -1;
  private lastHeight: WindHeight | null = null;
  private readonly current: PictureNow = { dataSerial: 0, height: 'fire', level: 0, spacingExp: 0, thin: 1, crownSerial: 0, pose: this.pose, proj: this.proj, distanceM: 0 };
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
  /** The longest `tick` since the statistics were last read (ms, the layer's own clock). */
  private tickMax = 0;
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
    this.detailBuilder = (deps.createDetailBuilder ?? createDetailBuilder)(tier);
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
    this.detail = new DetailBatch({ capacity, widthPx: DETAIL_WIDTH_PX, depthBiasM: DETAIL_DEPTH_BIAS_M, shared });
    this.group.name = 'wind-glyphs';
    this.group.add(this.halo.mesh, this.colour.mesh, this.detail.mesh);
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.sigValid = false; // a layer that sat idle with nothing changed looks again
  }

  setHeight(h: WindHeight): void {
    this.height = h;
  }

  /** Whether the Wind streaks switch wants the detailed picture at the most detailed level (the glyph switch may be off). */
  setStreaksDetail(on: boolean): void {
    if (on === this.streaksDetail) return;
    this.streaksDetail = on;
    this.sigValid = false;
  }

  /** Whether motion is allowed (false under reduced motion: the detailed streaks stand still, at the frozen frame of the shader). The caller draws a frame. */
  setMotion(allowed: boolean): void {
    this.motion = allowed;
    this.detail.setMoving(allowed);
  }

  /**
   * The view holds still after a minute without activity (`idleStop.ts`): the detailed streaks then say `'paused'` in the statistics (only while they
   * are moving: reduced motion says `'still'` whatever else, and nothing drawn says `'off'`). The frame loop freezes the shader's clock; the layer
   * itself does nothing else, so a rebuild that is due still runs (the picture it makes is as still as the one it replaces).
   */
  setPaused(on: boolean): void {
    this.paused = on;
  }

  /**
   * The canopy height and cover per fire cell, by reference (null when the canopy layer is off or there is none): the strokes ride on the crowns' tops
   * (0.7.0, T1). A different object makes the `'canopy'` rebuild reason.
   */
  setCanopy(fuel: FuelMap | null): void {
    if (fuel === this.canopy) return;
    this.canopy = fuel;
    this.reliefSerial++;
  }

  /**
   * Where the placed crowns are read from (`VegetationLayer.crownSource()`; null when the canopy layer is off: a stroke does not bend round trees
   * that are not drawn). The source's `serial` is read once a frame, and a new one gives the `'canopy'` rebuild reason (0.7.0, T3).
   */
  setCrowns(src: CrownSource | null): void {
    if (src === this.crownSrc) return;
    this.crownSrc = src;
    this.crownSeen = src ? src.serial : 0;
    this.reliefSerial++;
  }

  /** The fire's plume as a site for an eddy pair (local metres), made by the caller per snapshot (empty: none). Read at the next rebuild, which a new snapshot makes anyway. */
  setPlumes(plumes: readonly Plume[]): void {
    this.plumes = plumes;
  }

  /**
   * The relief of the detailed streaks on or off (0.7.0): off draws the 0.6.0 picture, byte for byte. The seam of the e2e specs and of the tuning
   * on the real picture; the app leaves it on (`DETAIL_RELIEF.enabled` is the constant that switches it off for good).
   */
  setRelief(on: boolean): void {
    if (on === this.reliefOn) return;
    this.reliefOn = on;
    this.reliefSerial++;
  }

  /** The live numbers of the relief (`DETAIL_RELIEF`), for the tuning on the real picture: change a field, then `setRelief(false)` and `setRelief(true)` to build again. */
  get reliefSettings(): DetailRelief {
    return DETAIL_RELIEF;
  }

  /**
   * Compile the layer's shaders now (0.7.0, D12 c): the first frame of the most detailed level used to compile the streaks' program in the middle of
   * the zoom. Called once by the scene view when the first data arrives (`compileAsync` uses `KHR_parallel_shader_compile` where the browser has it,
   * so the link does not block the thread; without it the compile is a short synchronous one at this quiet moment instead of at the first zoom).
   * `compile` visits hidden objects too, so the batches need not be shown. Resolves when the programs are ready; never rejects.
   */
  precompile(renderer: PrecompileTarget, camera: THREE.Camera, scene?: THREE.Object3D): Promise<void> {
    if (this.compiled) return Promise.resolve();
    this.compiled = true;
    try {
      const done = typeof renderer.compileAsync === 'function' ? renderer.compileAsync(this.group, camera, scene ?? null) : (renderer.compile?.(this.group, camera, scene ?? null), Promise.resolve());
      return Promise.resolve(done).then(
        () => undefined,
        () => undefined,
      );
    } catch {
      return Promise.resolve();
    }
  }

  /** The detailed streaks are drawn in motion, so the frame loop must keep drawing. */
  get animating(): boolean {
    return this.detailOn && this.motion;
  }

  /** The detailed streaks are on screen (the old Wind streaks step aside while they are). */
  get detailShown(): boolean {
    return this.detailOn;
  }

  /** Strokes are baked in device pixels: a new pixel ratio changes the widths and nothing else. */
  setDpr(dpr: number): void {
    this.halo.widthPx = HALO_WIDTH_PX * dpr;
    this.colour.widthPx = GLYPH_WIDTH_PX * dpr;
    this.detail.widthPx = DETAIL_WIDTH_PX * dpr;
  }

  /** A new picture of the air (or none: a new scenario). The traces are redone at the next rebuild, never per camera move. */
  setData(d: GlyphData | null): void {
    this.data = d;
    this.dataSerial++;
    this.surface = undefined;
  }

  /**
   * Once per frame, before the idle return. Decides, stages and swaps; true when what is drawn changed (a swapped picture, the
   * glyphs hidden or shown, a step of the detailed streaks' fade), so the frame must be drawn. `settle` (screenshots, tests) skips
   * the throttle, the slice budget and the fade: the picture is finished in this call.
   */
  tick(now: number, camera: THREE.PerspectiveCamera, css: GlyphCss, mode: ViewMode, vex: number, targetDistance: number, framesTriangles: number, settle: boolean): boolean {
    const t0 = this.clock();
    const fading = this.ramp(now, settle);
    const changed = this.update(now, camera, css, mode, vex, targetDistance, framesTriangles, settle) || fading;
    const took = this.clock() - t0;
    if (took > this.tickMax) this.tickMax = took;
    return changed;
  }

  /**
   * One step of the detailed streaks' fade (400 ms in, 250 ms out) from the time since the last frame, never more than 0.1 s of it; true while it
   * moves. A batch that has faded out is taken off the screen. (The step is worked out here and not passed in: a number made by the caller is
   * a number allocated every frame.)
   */
  private ramp(now: number, settle: boolean): boolean {
    const last = this.lastTickMs;
    this.lastTickMs = now;
    if (this.fade === this.fadeTo) return false;
    const dtMs = last < 0 ? 0 : Math.min(MAX_FADE_STEP_MS, Math.max(0, now - last));
    if (settle) this.fade = this.fadeTo;
    else if (this.fadeTo > this.fade) this.fade = Math.min(this.fadeTo, this.fade + dtMs / DETAIL_FADE_IN_MS);
    else this.fade = Math.max(this.fadeTo, this.fade - dtMs / DETAIL_FADE_OUT_MS);
    this.detail.setFade(this.fade);
    if (this.fade === 0 && this.fadeTo === 0) this.hideDetail();
    return true;
  }

  /** The decisions of a frame (see `tick`). */
  private update(now: number, camera: THREE.PerspectiveCamera, css: GlyphCss, mode: ViewMode, vex: number, targetDistance: number, framesTriangles: number, settle: boolean): boolean {
    if (!this.enabled && !this.streaksDetail) return this.hide('off');
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
    const retry = this.noRoom && this.roomFor(this.planLevel === DETAIL_LEVEL, framesTriangles) >= BUDGET_RETRY_SHARE * GLYPH_CAPS[this.tier].segments;
    // The forest was placed again (the crowns' serial moved): the relief is out of date, like new data.
    const src = this.crownSrc;
    if (src !== null && src.serial !== this.crownSeen) {
      this.crownSeen = src.serial;
      this.reliefSerial++;
    }
    // Nothing changed since the last frame and nothing is waiting: the whole idle cost is this comparison.
    if (this.sigValid && !retry && !this.working && !this.waiting && this.dataSerial === this.lastSerial && this.reliefSerial === this.lastRelief && this.height === this.lastHeight && same(pose, this.lastPose) && same(proj, this.lastProj)) return false;
    this.lastPose.set(pose);
    this.lastProj.set(proj);
    this.detail.setPxPerM1(css.h / (2 * Math.tan((css.fov * Math.PI) / 360))); // the eddies' octaves count by the pixels a metre covers
    this.lastSerial = this.dataSerial;
    this.lastRelief = this.reliefSerial;
    this.lastHeight = this.height;
    this.sigValid = true;
    camera.updateMatrixWorld();
    this.cam = camera;
    this.vex = vex;
    this.distance = targetDistance;

    // The level of detail from how many pixels one model cell covers at the middle of the screen.
    const grid = d.atm!.grid;
    const mpp = metresPerPixelAt(targetDistance, css.fov, css.h);
    // The most detailed level draws the detailed streaks: `planLod` gives it their lattice and line lengths (`detail`), the lower levels the 0.5.0 ones.
    const lod = planLod(grid.cellSize / mpp, mpp, this.planKept ? this.plan : null, this.plan, true);
    this.planKept = true;
    this.cellPx = lod.cellPx;
    this.cellM = grid.cellSize;
    if (lod.level === 0) return this.hide(null, true);
    this.idle = this.noRoom ? 'budget' : null;
    this.planLevel = lod.level;
    if (lod.level < DETAIL_LEVEL && !this.enabled) return this.rest(settle); // the Wind streaks alone: the zoom is told, nothing is built here

    const n = this.current;
    n.dataSerial = this.dataSerial;
    n.height = this.height;
    n.level = lod.level;
    n.spacingExp = lod.spacingExp;
    n.thin = lod.thin;
    n.crownSerial = lod.level === DETAIL_LEVEL && this.reliefActive() ? this.reliefSerial : 0;
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
      this.next.crownSerial = n.crownSerial;
      this.next.level = n.level;
      this.next.spacingExp = n.spacingExp;
    }
    return this.advance(now, d, lod, css, vex, framesTriangles, settle);
  }

  /** The layer's statistics. `tickMaxMs` is the longest `tick` since the last call, so every read starts a new window. */
  stats(): WindGlyphStats {
    const log = this.log;
    const tickMaxMs = this.tickMax;
    this.tickMax = 0;
    return {
      active: this.shown || this.detailOn,
      idle: this.idle,
      level: this.planLevel,
      count: this.glyphs,
      segments: this.segments + this.detailSegments,
      cellPx: this.cellPx,
      cellM: this.cellM,
      rebuilds: this.rebuilds,
      lastMs: log.lastMs,
      sliceP95Ms: log.p95(),
      sliceMaxMs: log.max(),
      slicesLast: log.slicesLast,
      detail: this.detailOn ? (this.motion ? (this.paused ? 'paused' : 'moving') : 'still') : 'off',
      detailSegments: this.detailSegments,
      glyphs: this.enabled,
      streaks: this.streaksDetail,
      reduced: !this.motion,
      tickMaxMs,
    };
  }

  dispose(): void {
    this.builder.cancel();
    this.detailBuilder.cancel();
    this.heightRaster?.cancel();
    this.halo.dispose();
    this.colour.dispose();
    this.detail.dispose();
  }

  // ───────────────────────────────────────────────────────────────────────────

  /** Air with wind to draw: the view has it, and for `'fire'` the model's 10 m wind raster too. */
  private hasField(d: GlyphData): boolean {
    if (!d.atm || !d.sampler.hasWind) return false;
    if (this.height !== 'fire' && this.height !== 'felt') return true; // ('felt' is read like 'fire' until the E2 picture lane gives it its own raster)
    if (this.surface === undefined) this.surface = surfaceRaster(d.atm);
    return this.surface !== null;
  }

  /** Draw nothing: the stroke batches and the detailed streaks empty (at once), a rebuild under way dropped, the next picture built afresh. True when something was shown. */
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
    const detailWas = this.detailOn;
    if (detailWas) this.hideDetail();
    if (!this.shown) return detailWas;
    this.halo.commit(0);
    this.colour.commit(0);
    this.setShown(false);
    return true;
  }

  /**
   * The Wind streaks alone are on and the zoom is short of the most detailed level: the level is told (`stats().level`), nothing is built, what the
   * layer drew goes (the arrows and flow lines of a glyph switch that was just turned off at once, the detailed streaks by their fade). `idle` is
   * `off`, as for the glyphs themselves. True when something that was shown is gone from the frame.
   */
  private rest(settle: boolean): boolean {
    this.idle = 'off';
    this.glyphs = 0;
    this.segments = 0;
    this.waiting = false;
    this.noRoom = false;
    if (this.working) this.cancel();
    this.builtValid = false;
    this.fadeDetailOut(settle);
    if (!this.shown) return false;
    this.halo.commit(0);
    this.colour.commit(0);
    this.setShown(false);
    return true;
  }

  /** The detailed streaks leave: their fade runs down (at once when settled), and `ramp` takes the batch off the screen at the end of it. */
  private fadeDetailOut(settle: boolean): void {
    if (!this.detailOn) return;
    if (settle) this.hideDetail();
    else this.fadeTo = 0;
  }

  /** The detailed streaks are drawn: the batch shows, fading in from nothing when it was not there before (a picture swapped in place keeps its fade). */
  private showDetail(settle: boolean): void {
    const was = this.detailOn;
    this.detailOn = true;
    this.detail.mesh.visible = true;
    this.fadeTo = 1;
    if (!was || settle) {
      this.fade = settle ? 1 : 0;
      this.detail.setFade(this.fade);
    }
  }

  /** Take the detailed streaks off the screen at once (nothing to fade: switched off, a level with no wind, nothing in view, trimmed to nothing). */
  private hideDetail(): void {
    this.detail.commit(0);
    this.detail.mesh.visible = false;
    this.detailOn = false;
    this.detailSegments = 0;
    this.detailLines = 0;
    this.fade = 0;
    this.fadeTo = 0;
    this.detail.setFade(0);
  }

  /** The triangles of the frame that are not ours (what we draw now is replaced at the swap, so it does not count against the picture that replaces it). */
  private othersTriangles(framesTriangles: number): number {
    return Math.max(0, framesTriangles - GLYPH_TRIANGLES * (this.shown ? this.segments : 0) - DETAIL_TRIANGLES * this.detailSegments);
  }

  /**
   * The segments a picture of this kind may hold with `others` triangles in the rest of the frame: the tier's cap trimmed to the limit, and for the
   * detailed streaks never under `DETAIL_MIN_SEGMENTS` (the whole cap of every tier, so no trim), so that the closest zoom of a full frame (dense
   * forest, High tier) has its picture, the same one whatever the frame held when it was built.
   */
  private roomFor(detailed: boolean, others: number): number {
    return segmentCap(GLYPH_CAPS[this.tier].segments, others, 0, detailed ? DETAIL_TRIANGLES : GLYPH_TRIANGLES, detailed ? DETAIL_MIN_SEGMENTS : 0);
  }

  /** The relief of the detailed streaks is wanted: the switch and the constant. */
  private reliefActive(): boolean {
    return this.reliefOn && DETAIL_RELIEF.enabled;
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
    (this.next.level === DETAIL_LEVEL ? this.detailBuilder : this.builder).cancel();
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
    const kind = this.next.level === DETAIL_LEVEL ? 1 : 0;
    const t0 = this.clock();
    const done = (kind === 1 ? this.detailBuilder : this.builder).step(settle ? Infinity : this.coldSlices[kind]! < COLD_SLICES ? COLD_SLICE_BUDGET_MS : SLICE_BUDGET_MS);
    this.coldSlices[kind]!++;
    this.log.push(this.clock() - t0);
    return done ? this.swap(now, framesTriangles, settle) : false;
  }

  /**
   * Make the raster for this data, height and refinement, in slices (one per call, each stopping on the clock; `settle` runs it to the
   * end): `ready` when there is nothing to do, `more` while the fill is under way, `done` on the call that completed it. A fill that
   * is begun invalidates the last raster (its storage may be reused), and one that is cancelled leaves none.
   */
  private fill(d: GlyphData, refine: 1 | 2, settle: boolean): 'ready' | 'more' | 'done' {
    if (this.height === 'fire' || this.height === 'felt') {
      this.raster = this.surface!;
      this.rasterHeight = null; // a later numeric height must fill afresh
      return 'ready';
    }
    const hr = (this.heightRaster ??= new HeightRaster());
    if (!this.filling) {
      if (this.raster && this.rasterSerial === this.dataSerial && this.rasterHeight === this.height && this.rasterRefine === refine) return 'ready';
      hr.begin(d.sampler, d.sliceGround, typeof this.height === 'number' ? this.height : 10, refine);
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
    next.thin = lod.thin;
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
    const detailed = lod.level === DETAIL_LEVEL;
    this.beginSegments = this.roomFor(detailed, this.othersTriangles(framesTriangles));
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
    if (detailed) {
      const detail: DetailInput = { ...input, ground10: d.sliceGround, seed: 0, heightM: typeof this.height === 'number' ? this.height : 10 }; // the ground terms fade with the wind's height
      if (this.reliefActive()) {
        detail.relief = DETAIL_RELIEF;
        if (this.canopy) detail.canopy = this.canopy;
        if (this.crownSrc) detail.crowns = this.crownSrc.sets();
        if (this.plumes.length > 0) detail.plumes = this.plumes;
      }
      this.detailBuilder.begin(detail);
    } else this.builder.begin(input);
    this.begun = true;
    return true;
  }

  /**
   * The finished picture replaces the drawn one: the glyph pair is copied into both batches, the detailed streaks into theirs, and the other
   * kind of picture leaves (the batches change only here). The detailed streaks fade in over 400 ms; leaving, they fade out over 250.
   */
  private swap(now: number, framesTriangles: number, settle: boolean): boolean {
    if (this.next.level === DETAIL_LEVEL) return this.swapDetail(now, framesTriangles, settle);
    const out = this.builder.out;
    // The room may have changed since the build began (the frame's other layers moved): the cap is applied again.
    const room = this.roomFor(false, this.othersTriangles(framesTriangles));
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
    this.fadeDetailOut(settle); // the zoom left the most detailed level: its streaks go as the arrows come in
    return this.finish(now);
  }

  /** The detailed streaks' picture swaps in (the arrows and flow lines of the lower levels go at once, the streaks fade in). */
  private swapDetail(now: number, framesTriangles: number, settle: boolean): boolean {
    const out = this.detailBuilder.out;
    const room = this.roomFor(true, this.othersTriangles(framesTriangles));
    const n = Math.min(out.segments, room);
    this.setNoRoom(room === 0 || this.beginSegments === 0);
    this.detail.a.set(out.a.subarray(0, n * 3));
    this.detail.b.set(out.b.subarray(0, n * 3));
    this.detail.c.set(out.c.subarray(0, n * 4));
    this.detail.d.set(out.d.subarray(0, n * 4));
    this.detail.e.set(out.e.subarray(0, n * 4));
    this.detail.commit(n);
    this.detailSegments = n;
    this.detailLines = n === 0 ? 0 : n === out.segments ? out.lines : Math.round((out.lines * n) / Math.max(1, out.segments));
    this.halo.commit(0);
    this.colour.commit(0);
    this.setShown(false);
    this.segments = 0;
    this.glyphs = this.detailLines;
    if (n > 0) this.showDetail(settle);
    else this.hideDetail(); // trimmed to nothing: the old Wind streaks come back (`detailShown` is false)
    return this.finish(now);
  }

  /** No ground in view: an empty picture, so the frame loop does not ask again until the camera sees ground. */
  private swapEmpty(now: number): boolean {
    const wasShown = this.shown || this.detailOn;
    this.halo.commit(0);
    this.colour.commit(0);
    this.setShown(false);
    this.hideDetail();
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

  /** The lowest ground (m ASL) of a raster: what a `HeightField` already knows (0.7.0: no walk of 160,000 cells in the one frame that cannot be sliced), else a walk, once. */
  private lowest(g: GroundRaster): number {
    if (this.groundMin?.of !== g) {
      let lo = Infinity;
      if (typeof g.minElevation === 'number') lo = g.minElevation;
      else for (let k = 0; k < g.elevation.length; k++) if (g.elevation[k]! < lo) lo = g.elevation[k]!;
      this.groundMin = { of: g, y: Number.isFinite(lo) ? lo : 0 };
    }
    return this.groundMin.y;
  }
}

const same = (a: Float64Array, b: Float64Array): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
