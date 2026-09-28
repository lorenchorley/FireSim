/**
 * SceneView — the Three.js implementation of {@link SceneViewApi}.
 *
 * One WebGL2 renderer, ~10–20 draw calls in a typical frame:
 *   sky dome · terrain + skirt (one material compositing imagery/palette, lighting, fire, overlays, decals) ·
 *   5 instanced vegetation groups (+ ≤ 2 near-LOD meshes in low views) · flames · embers (points + trails) ·
 *   wind streaks · smoke puffs · cross-section curtain + arrows (+ halo) · icons.
 * Rendering is on demand: the loop only draws when the camera moves, data changes or something is animating
 * (flames, embers, wind, pulses, playback), capped at 30 fps for pure playback and 60 fps while interacting.
 * The device pixel ratio adapts to the measured frame rate (perf.ts). Everything is disposed in dispose(), and a lost
 * WebGL context (common when a phone backgrounds the app) pauses rendering until it is restored.
 */
import * as THREE from 'three';
import type { GridSpec } from '../core/grid';
import type { FireField, FuelMap, Ignition, Insight, SimSnapshot, SpotFire, Terrain } from '../core/types';
import { castShadows, insolation, multiHillshade, skyViewFactor, solarPosition } from '../terrain';
import type { SceneImagery, SceneViewApi } from './api';
import { AtmosphereSampler } from './atmosphereSampler';
import { CameraRig, type ViewMode } from './cameraRig';
import { gridBounds, sunDirectionWorld } from './coords';
import { CrossSectionLayer } from './crossSectionLayer';
import { EmberLayer } from './emberLayer';
import { FlameLayer } from './fireLayer';
import {
  arrivalTexture,
  decimateGrid,
  fireAuxTexture,
  fireCentroid,
  flameSites,
  glowField,
  lightTerrain,
  overlayField,
  type OverlayField,
  type RenderGrid,
} from './fields';
import { HeightField } from './heightfield';
import { Icon, IconLayer, severityIcon, type IconInstance } from './iconLayer';
import { DEFAULT_LAYERS, type LayerState, type OverlayKind } from './layers';
import { legendFor, overlayScale, type LegendSpec } from './legends';
import { AdaptiveDpr, FrameMeter } from './perf';
import { skyLighting } from './sky';
import { SkyDome } from './skyDome';
import { plumeColumn, puffsFromAtmosphere, SmokeLayer } from './smokeLayer';
import { TerrainLayer, type TerrainDecals } from './terrainLayer';
import { VegetationLayer } from './vegetationLayer';
import { placeVegetation, type PlacementCache } from './vegetationPlacement';
import { WindArrows, WindLayer, type WindDomain } from './windLayer';

export type RenderQuality = 'low' | 'medium' | 'high';

export interface SceneViewOptions {
  /** Preset for mesh resolution, vegetation budget and maximum DPR (default: guessed from the device). */
  quality?: RenderQuality;
  /** Override the vegetation instance budget (≤ 60 000). */
  vegetationBudget?: number;
  /** Maximum samples per side of the terrain mesh (default 400 high / 320 medium / 224 low). */
  meshResolution?: number;
  /** Highest device pixel ratio used (default min(devicePixelRatio, 2)). */
  maxDpr?: number;
  /** Disable adaptive DPR (screenshots / tests). */
  fixedDpr?: boolean;
  /** Keep the drawing buffer for screenshots (slightly slower). */
  preserveDrawingBuffer?: boolean;
  /** Smoke concentration (AtmosphereView.smoke units) drawn at full puff opacity (default 1). */
  smokeReference?: number;
  /** Show static surface-wind arrows on a coarse lattice when the wind layer is on (default false). */
  windArrows?: boolean;
}

/**
 * Quality tiers. Triangle budget (doc 09 §8.1: ≤ 1–1.5 M): terrain 2·mesh² + vegetation ≈ 30 triangles per tree,
 * 16 per shrub; distant/tiny instances are culled in the vertex shader so the rasterised count is far lower.
 */
const QUALITY: Record<RenderQuality, { mesh: number; veg: number; dpr: number; lod: number }> = {
  low: { mesh: 224, veg: 16000, dpr: 1.25, lod: 700 },
  medium: { mesh: 320, veg: 32000, dpr: 1.75, lod: 1500 },
  high: { mesh: 400, veg: 48000, dpr: 2, lod: 2500 },
};

function guessQuality(): RenderQuality {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as { hardwareConcurrency?: number; deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  if (cores >= 8 && mem >= 6) return 'high';
  if (cores <= 4 || mem <= 3) return 'low';
  return 'medium';
}

/** True if the fine grid spans the coarse grid's domain (cell edges, within one fine cell). */
function coversDomain(fine: GridSpec, coarse: GridSpec): boolean {
  const edge = (g: GridSpec): [number, number, number, number] => [g.x0 - g.cellSize / 2, g.y0 - g.cellSize / 2, g.x0 + (g.nx - 0.5) * g.cellSize, g.y0 + (g.ny - 0.5) * g.cellSize];
  const [a0, b0, a1, b1] = edge(fine);
  const [c0, d0, c1, d1] = edge(coarse);
  const tol = fine.cellSize * 1.01;
  return Math.abs(a0 - c0) <= tol && Math.abs(b0 - d0) <= tol && Math.abs(a1 - c1) <= tol && Math.abs(b1 - d1) <= tol;
}

const FIRE_OVERLAYS = new Set<OverlayKind>(['arrival', 'ros', 'intensity', 'driver']);
/** Overlays whose values change with every snapshot. */
const SNAPSHOT_OVERLAYS = new Set<OverlayKind>(['arrival', 'ros', 'intensity', 'driver', 'moisture', 'insolation']);

export class SceneView implements SceneViewApi {
  private readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig: CameraRig;
  /** Uniforms shared by all custom materials. */
  private readonly u: Record<string, THREE.IUniform>;
  private readonly sky: SkyDome;
  private readonly flames: FlameLayer;
  private readonly embers: EmberLayer;
  private readonly wind: WindLayer;
  private readonly windArrows: WindArrows;
  private windArrowsOn = false;
  private readonly smoke: SmokeLayer;
  private readonly section: CrossSectionLayer;
  private readonly icons: IconLayer;
  private terrainLayer: TerrainLayer | null = null;
  private vegetation: VegetationLayer | null = null;

  private terrain: Terrain | null = null;
  private fuel: FuelMap | null = null;
  private rg: RenderGrid | null = null;
  private hf: HeightField | null = null;
  private lightT: Terrain | null = null;
  private domain: WindDomain | null = null;
  private layers: LayerState = structuredClone(DEFAULT_LAYERS);
  private readonly quality: (typeof QUALITY)[RenderQuality];
  private readonly opts: SceneViewOptions;

  // Simulation state.
  private snap: SimSnapshot | null = null;
  private fire: FireField | null = null;
  private sampler: AtmosphereSampler | null = null;
  private atmBase = 0;
  private displayTime = 0;
  private timeFrom = 0;
  private timeTo = 0;
  private timeT0 = 0;
  private timeDur = 1;
  private lastUpdateWall = 0;
  private startMs: number | null = null;
  /** Minute of the last lighting update (lighting is recomputed once per simulated minute). */
  private sunKey = NaN;
  private shadowKey = NaN;
  private insolKey = '';
  private sunAz = 0;
  private sunEl = 45;
  private lastShadowWall = -1e9;
  private insolField: OverlayField | null = null;
  private maxArrival = 0;
  private arrBuf: Float32Array | null = null;
  private auxBuf: Uint8Array | null = null;
  /** 0–1 amount of smoke haze in the air (fog and sky tint). */
  private smokeHaze = 0;

  // Markers.
  private ignitions: Ignition[] = [];
  private userSpots: SpotFire[] = [];
  private insights: Insight[] = [];
  private focus: Insight | null = null;
  private user: { x: number; y: number; heading: number | null } | null = null;
  private brush: { x: number; y: number; radius: number; colour: string } | null = null;

  // Loop.
  private dirty = true;
  private disposed = false;
  private contextLost = false;
  private lastFrame = 0;
  private lastRender = 0;
  private interacting = false;
  private readonly meter = new FrameMeter();
  private readonly dpr: AdaptiveDpr;
  private readonly lastCam = new THREE.Vector3(Infinity, 0, 0);
  private readonly tmpO = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();
  private readonly lastTarget = new THREE.Vector3();
  private vegFocus: [number, number] | null = null;
  private vegRadius = 0;
  private vegCache: PlacementCache = {};
  private flameSpacing = 10;
  private vegPending = 0;
  private readonly lastStats = { fps: 0, drawCalls: 0, triangles: 0 };
  private wasCapped = false;
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
  };
  private readonly onRestored = (): void => {
    this.contextLost = false;
    this.dirty = true;
  };
  private readonly onStart = (): void => {
    this.interacting = true;
  };
  private readonly onEnd = (): void => {
    this.interacting = false;
  };
  private readonly onChange = (): void => {
    this.dirty = true;
  };

  constructor(container: HTMLElement, opts: SceneViewOptions = {}) {
    this.container = container;
    this.opts = opts;
    this.quality = QUALITY[opts.quality ?? guessQuality()];
    const maxDpr = opts.maxDpr ?? Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, this.quality.dpr);
    this.dpr = new AdaptiveDpr({ maxDpr, minDpr: Math.min(1, maxDpr) });

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    });
    this.renderer.setPixelRatio(this.dpr.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // custom materials apply the same ACES curve themselves
    this.renderer.setClearColor(0x0b1020, 1);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);

    this.u = {
      uVex: { value: 1 },
      uTime: { value: 0 },
      uClock: { value: 0 },
      uBurnBand: { value: 420 },
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, -0.4).normalize() },
      uSunColour: { value: new THREE.Color(1, 0.95, 0.88) },
      uSunI: { value: 2.6 },
      uSkyAmb: { value: new THREE.Color(0.5, 0.6, 0.8) },
      uGroundAmb: { value: new THREE.Color(0.3, 0.26, 0.2) },
      uAmbI: { value: 0.65 },
      uNight: { value: 0 },
      uExposure: { value: 1 },
      uFogColour: { value: new THREE.Color(0.7, 0.78, 0.88) },
      uFogDensity: { value: 1 / 45000 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: this.dpr.dpr },
      uGlowGain: { value: 2 },
    };

    this.rig = new CameraRig(canvas, 1);
    this.rig.controls.addEventListener('start', this.onStart);
    this.rig.controls.addEventListener('end', this.onEnd);
    this.rig.controls.addEventListener('change', this.onChange);

    this.sky = new SkyDome(this.u);
    this.flames = new FlameLayer(this.u);
    this.embers = new EmberLayer(this.u);
    this.wind = new WindLayer(this.u);
    this.windArrows = new WindArrows(this.u);
    this.windArrowsOn = !!opts.windArrows;
    this.smoke = new SmokeLayer(this.u);
    this.section = new CrossSectionLayer(this.u);
    this.section.visible = false;
    this.icons = new IconLayer(this.u);
    this.scene.add(this.sky.mesh, this.flames.mesh, this.embers.group, this.wind.streaks.mesh, this.windArrows.arrows.mesh, this.smoke.mesh, this.section.group, this.icons.mesh);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    this.resize();
    this.applyLighting(Date.now());
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario
  // ───────────────────────────────────────────────────────────────────────────

  setScenario(terrain: Terrain, fuel: FuelMap, opts: { imagery?: SceneImagery | null; hiRes?: { grid: GridSpec; elevation: Float32Array } | null } = {}): void {
    this.terrainLayer?.dispose();
    this.vegetation?.dispose();
    if (this.terrainLayer) this.scene.remove(this.terrainLayer.group);
    if (this.vegetation) this.scene.remove(this.vegetation.group);
    this.terrain = terrain;
    this.fuel = fuel;
    this.vegCache = {};
    this.snap = null;
    this.fire = null;
    this.sampler = null;
    this.displayTime = this.timeFrom = this.timeTo = 0;
    this.lastUpdateWall = 0;
    this.startMs = this.explicitStartMs = null;
    this.sunKey = NaN;
    this.shadowKey = NaN;
    this.insolKey = '';
    this.insolField = null;
    this.maxArrival = 0;

    // Mesh from the finer DEM when the scenario has one of the same domain (10 m bundled LiDAR / tiles).
    const hi = opts.hiRes;
    const useHi = !!hi && hi.grid.cellSize < terrain.grid.cellSize && hi.elevation.length === hi.grid.nx * hi.grid.ny && coversDomain(hi.grid, terrain.grid);
    const src = useHi ? hi! : terrain;
    const rg = decimateGrid(src.grid, src.elevation, this.opts.meshResolution ?? this.quality.mesh);
    this.rg = rg;
    this.hf = new HeightField(rg.grid, rg.elevation, this.vex);
    const b = gridBounds(rg.grid);
    const hf = this.hf;
    this.domain = { ...b, heightAt: (x, y) => hf.heightAt(x, y) };
    this.lightT = lightTerrain(rg, terrain.source);

    const tl = new TerrainLayer(rg, terrain, this.u, Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    tl.setFuel(fuel, terrain);
    tl.setImagery(opts.imagery ?? null, terrain.grid);
    tl.setShade(multiHillshade(this.lightT), skyViewFactor(this.lightT, 12), null);
    this.terrainLayer = tl;
    this.scene.add(tl.group);

    this.vegetation = new VegetationLayer(tl.uniforms);
    // Near LOD: detailed trees for the closest few thousand (≈ 180 triangles each), within 280 m of the camera.
    this.vegetation.lodMax = this.quality.lod;
    this.scene.add(this.vegetation.group);
    this.rig.setHeightField(hf);
    this.rig.home(false);
    this.placeVegetation(true);

    this.flames.setSites([], () => 0);
    this.embers.setParticles({ count: 0, data: new Float32Array(0) }, true);
    this.smoke.setPuffs([], false);
    this.wind.setMode('off', null);
    this.applyLayers(this.layers, null);
    this.refreshMarkers();
    this.applyLighting(this.sunTimeMs());
    this.dirty = true;
  }

  refreshFuel(fuel: FuelMap): void {
    this.fuel = fuel;
    if (!this.terrain || !this.terrainLayer) return;
    this.terrainLayer.setFuel(fuel, this.terrain);
    this.vegCache = {}; // fuel edits mutate the map in place: recompute demand
    this.placeVegetation(true);
    if (!FIRE_OVERLAYS.has(this.layers.overlay)) this.updateOverlay();
    this.dirty = true;
  }

  private placeVegetation(force = false): void {
    if (!this.fuel || !this.hf || !this.vegetation) return;
    const t = this.rig.controls.target;
    const focus: [number, number] = [t.x, -t.z];
    // Full density within a radius that follows the zoom (close views get dense forest, wide views spread out).
    const radius = THREE.MathUtils.clamp(this.cameraDistance() * 0.55, 500, 3500);
    if (!force && this.vegFocus && Math.hypot(focus[0] - this.vegFocus[0], focus[1] - this.vegFocus[1]) < Math.max(250, radius * 0.4) && Math.abs(radius - this.vegRadius) < radius * 0.35) return;
    this.vegFocus = focus;
    this.vegRadius = radius;
    const overlayOn = this.layers.overlay !== 'none';
    const hf = this.hf;
    const sets = placeVegetation(this.fuel, {
      budget: this.opts.vegetationBudget ?? this.quality.veg,
      heightAt: (x, y) => hf.heightAt(x, y),
      focus,
      focusRadius: radius,
      densityScale: overlayOn ? 0.4 : 1,
      seed: 7,
      cache: this.vegCache,
    });
    this.vegetation.setInstances(sets);
    this.dirty = true;
  }

  /** Re-centre the vegetation near LOD on the camera (local coordinates). */
  private updateVegLod(): void {
    if (!this.vegetation) return;
    const p = this.rig.camera.position;
    const vex = this.hf?.vex ?? 1;
    this.vegetation.updateLod([p.x, -p.z, p.y / Math.max(vex, 1e-6)], vex);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Snapshots
  // ───────────────────────────────────────────────────────────────────────────

  update(snapshot: SimSnapshot): void {
    if (!this.terrainLayer || !this.hf || !this.terrain) return;
    const now = performance.now();
    this.snap = snapshot;
    this.fire = snapshot.fire;
    // Scenario clock for the sun. SimSnapshot has no start time, so unless setStartTime() was called it is derived
    // from the ambient weather record. That record may be the hourly one (rounded time), so the derived start is only
    // adopted when there is none yet or it is off by more than 2 h (a new scenario): it must not jump every snapshot.
    const w = snapshot.stats?.weather;
    if (this.explicitStartMs === null && w && Number.isFinite(w.time)) {
      const derived = w.time - snapshot.time * 1000;
      if (this.startMs === null || Math.abs(derived - this.startMs) > 2 * 3600e3) this.startMs = derived;
    }

    // Display-time interpolation from where we are now to the new snapshot time.
    const target = snapshot.time;
    const jump = target < this.displayTime - 1 || target - this.displayTime > 3 * 3600 || this.lastUpdateWall === 0;
    this.timeFrom = jump ? target : this.displayTime;
    this.timeTo = target;
    this.timeT0 = now;
    this.timeDur = Math.min(1500, Math.max(300, now - this.lastUpdateWall));
    this.lastUpdateWall = now;
    if (jump) this.displayTime = target;

    // Fire textures.
    const fire = snapshot.fire;
    // Scratch buffers are reused between snapshots (the textures copy them), so playback does not churn ~1 MB of
    // garbage per snapshot.
    const arr = arrivalTexture(fire, snapshot.time, this.arrBuf ?? undefined);
    this.arrBuf = arr.data;
    this.maxArrival = arr.maxArrival;
    this.auxBuf = fireAuxTexture(fire, this.auxBuf ?? undefined);
    this.terrainLayer.setFire(fire, arr.data, this.auxBuf);
    const glow = glowField(fire, target);
    this.terrainLayer.setGlow(glow.grid, glow.data);
    const hf = this.hf;
    const sites = flameSites(fire, this.timeFrom, this.timeTo, { max: this.quality === QUALITY.low ? 2500 : 5000 });
    this.flames.setSites(sites, (x, y) => hf.heightAt(x, y));
    this.flameSpacing = fire.grid.cellSize / Math.max(1, Math.min(3, Math.round(fire.grid.cellSize / 12)));

    // Atmosphere sampler (height datum = mean ground elevation minus the model's terrain height).
    this.atmBase = snapshot.atmosphere ? this.estimateAtmBase(snapshot.atmosphere.grid, snapshot.atmosphere.terrainHeight) : this.hf.minElevation;
    this.sampler = new AtmosphereSampler(snapshot.atmosphere ?? null, this.atmBase, snapshot.stats?.weather ?? null);
    const [lu, lv] = this.sampler.ambient;
    this.flames.setLean(lu, lv);

    // Embers morph from snapshot to snapshot, except after a jump in time (rewind, scrub, new run).
    this.embers.setParticles(snapshot.embers, jump);
    this.updateSmoke();
    const c = fireCentroid(fire, target);
    this.wind.focus = c ? { x: c.x, y: c.y, radius: 900 } : null;
    if (this.layers.crossSection.enabled) this.updateSection();
    this.updateWindArrows();
    if (SNAPSHOT_OVERLAYS.has(this.layers.overlay)) this.updateOverlay();
    this.refreshMarkers();
    this.applyLighting(this.sunTimeMs());
    this.dirty = true;
  }

  private estimateAtmBase(g: GridSpec, th: Float32Array): number {
    if (!this.hf) return 0;
    let s = 0;
    let n = 0;
    for (let j = 0; j < g.ny; j += 2) {
      for (let i = 0; i < g.nx; i += 2) {
        const x = g.x0 + i * g.cellSize;
        const y = g.y0 + j * g.cellSize;
        if (!this.hf.contains(x, y)) continue;
        s += this.hf.heightAt(x, y) - th[j * g.nx + i]!;
        n++;
      }
    }
    return n ? s / n : this.hf.minElevation;
  }

  private updateSmoke(): void {
    if (!this.snap || !this.hf || !this.sampler) return;
    const atm = this.snap.atmosphere;
    let puffs = atm ? puffsFromAtmosphere(atm, this.atmBase, this.quality === QUALITY.low ? 800 : 1500, this.opts.smokeReference) : [];
    if (!atm || puffs.length === 0) {
      const c = this.fire ? fireCentroid(this.fire, this.snap.time) : null;
      puffs = c ? plumeColumn({ x: c.x, y: c.y, ground: this.hf.heightAt(c.x, c.y) }, c.maxIntensity, this.sampler) : [];
    }
    this.smoke.setPuffs(puffs, true);
    // A big plume hazes the sky and the distance (feeds the fog density and sky tint).
    this.smokeHaze = Math.min(1, puffs.reduce((a, p) => a + p.alpha, 0) / 250);
  }

  private updateSection(): void {
    if (!this.hf || !this.domain) return;
    const cs = this.layers.crossSection;
    const sampler = this.sampler ?? new AtmosphereSampler(null, this.hf.minElevation, null);
    const hf = this.hf;
    this.section.update({ centre: cs.centre, azimuth: cs.azimuth }, this.domain, (x, y) => hf.heightAt(x, y), sampler, this.vex, this.dpr.dpr);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Layers
  // ───────────────────────────────────────────────────────────────────────────

  setLayers(partial: Partial<LayerState>): void {
    const prev = this.layers;
    const next: LayerState = { ...prev, ...partial, crossSection: { ...prev.crossSection, ...(partial.crossSection ?? {}) } };
    this.layers = next;
    this.applyLayers(next, prev);
    this.dirty = true;
  }

  /** Current layer state (a copy). */
  getLayers(): LayerState {
    return structuredClone(this.layers);
  }

  private applyLayers(l: LayerState, prev: LayerState | null): void {
    const tl = this.terrainLayer;
    if (prev === null || l.verticalExaggeration !== prev.verticalExaggeration) {
      const v = Math.max(0.2, l.verticalExaggeration);
      this.u.uVex!.value = v;
      if (this.hf) {
        // Keep the camera's offset from its (ground) target while the ground moves vertically.
        this.rig.rescaleHeights(this.hf.vex, v);
        this.hf.vex = v;
      }
    }
    if (tl) {
      tl.setUseImagery(l.imagery);
      tl.uniforms.uOverlayOpacity!.value = l.overlayOpacity;
    }
    this.flames.mesh.visible = l.flames;
    this.embers.group.visible = l.embers;
    this.smoke.mesh.visible = l.smoke;
    this.wind.setMode(l.wind, this.domain);
    this.wind.setDpr(this.dpr.dpr);
    this.updateWindArrows();
    const overlayChanged = !prev || prev.overlay !== l.overlay;
    if (overlayChanged || !prev || prev.isochroneMinutes !== l.isochroneMinutes) this.updateOverlay();
    if (overlayChanged && prev && (prev.overlay === 'none') !== (l.overlay === 'none')) this.placeVegetation(true);
    this.updateViewDependentLayers();
    this.section.visible = l.crossSection.enabled;
    if (l.crossSection.enabled && (!prev || !prev.crossSection.enabled || prev.crossSection.azimuth !== l.crossSection.azimuth || prev.crossSection.centre[0] !== l.crossSection.centre[0] || prev.crossSection.centre[1] !== l.crossSection.centre[1] || prev.verticalExaggeration !== l.verticalExaggeration)) {
      this.updateSection();
    }
    if (!prev || prev.insightMarkers !== l.insightMarkers) this.refreshMarkers();
  }

  /** Toggle the static wind arrows (shown only while the wind layer is on). */
  setWindArrows(on: boolean): void {
    this.windArrowsOn = on;
    this.updateWindArrows();
    this.dirty = true;
  }

  private updateWindArrows(): void {
    const show = this.windArrowsOn && this.layers.wind !== 'off' && !!this.sampler && !!this.domain;
    this.windArrows.arrows.mesh.visible = show;
    if (show) this.windArrows.update(this.sampler!, this.domain!, this.vex, this.dpr.dpr);
  }

  /** Layers whose visibility depends on the view mode and overlay. */
  private updateViewDependentLayers(): void {
    // Plan view is a map: keep smoke translucent so the ground stays readable; likewise thin it while the
    // cross-section is shown (the section already shows the plume, and puffs are drawn over it).
    this.smoke.uniforms.uAlphaScale!.value = this.rig.mode === 'top' ? 0.35 : this.layers.crossSection.enabled ? 0.45 : 1;
    if (!this.vegetation) return;
    this.vegetation.group.visible = this.layers.vegetation && !(this.rig.mode === 'top' && this.layers.overlay !== 'none');
  }

  private updateOverlay(): void {
    const tl = this.terrainLayer;
    if (!tl || !this.terrain || !this.fuel) return;
    const kind = this.layers.overlay;
    const fireOv = FIRE_OVERLAYS.has(kind);
    const iso = kind === 'arrival' || kind === 'none' ? this.layers.isochroneMinutes : 0;
    tl.uniforms.uIsoMinutes!.value = iso;
    tl.uniforms.uIsoStrong!.value = kind === 'arrival' ? 1 : 0;
    if (kind === 'none') {
      tl.setOverlay(null, null, false);
      return;
    }
    let field: OverlayField | null;
    if (kind === 'insolation') field = this.insolationField();
    else field = overlayField(kind, { terrain: this.terrain, fuel: this.fuel, fire: this.fire, moisture: this.snap?.moisture ?? null, layers: this.snap?.layers ?? null });
    const arrivalMax = Math.max(this.snap?.time ?? 0, this.maxArrival, 1800);
    const scale = overlayScale(kind, { arrivalMaxSeconds: arrivalMax });
    tl.setOverlay(field, scale, fireOv);
  }

  private insolationField(): OverlayField | null {
    if (!this.lightT || !this.rg || !this.terrain) return null;
    const t = this.sunTimeMs();
    const key = `${Math.round(t / 600000)}`;
    if (key === this.insolKey && this.insolField) return this.insolField;
    const w = this.snap?.stats?.weather;
    const ins = insolation(this.lightT, t, { cloudCover: w?.cloudCover, ghi: w?.shortwaveRadiation, location: this.terrain.grid.origin });
    this.insolKey = key;
    this.insolField = { grid: this.rg.grid, values: ins.total, categorical: false };
    return this.insolField;
  }

  /** Legend for the active overlay with its current dynamic range (null for 'none'). */
  legend(): LegendSpec | null {
    return legendFor(this.layers.overlay, {
      arrivalMaxSeconds: Math.max(this.snap?.time ?? 0, this.maxArrival, 1800),
      isochroneMinutes: this.layers.isochroneMinutes,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Markers
  // ───────────────────────────────────────────────────────────────────────────

  setIgnitions(ignitions: Ignition[], spots: SpotFire[]): void {
    this.ignitions = ignitions.slice();
    this.userSpots = spots.slice();
    this.refreshMarkers();
  }

  setInsights(insights: Insight[]): void {
    this.insights = insights.slice();
    this.refreshMarkers();
  }

  focusInsight(insight: Insight | null, fly = false): void {
    this.focus = insight;
    this.refreshMarkers();
    if (insight && fly) this.flyTo(insight.x, insight.y, 1600);
  }

  setUserLocation(x: number, y: number, headingDeg: number | null = null): void {
    this.user = { x, y, heading: headingDeg };
    this.refreshMarkers();
  }

  setBrushPreview(p: { x: number; y: number; radius: number; colour: string } | null): void {
    this.brush = p;
    this.refreshMarkers();
  }

  private refreshMarkers(): void {
    const tl = this.terrainLayer;
    const hf = this.hf;
    if (!tl || !hf) return;
    const dist = this.cameraDistance();
    const segs: [number, number, number, number][] = [];
    for (const ig of this.ignitions) {
      const p = ig.points;
      if (p.length === 1 || ig.kind === 'point') segs.push([p[0]![0], p[0]![1], p[0]![0], p[0]![1]]);
      else {
        for (let s = 0; s + 1 < p.length; s++) segs.push([p[s]![0], p[s]![1], p[s + 1]![0], p[s + 1]![1]]);
        if (ig.kind === 'area' && p.length > 2) segs.push([p[p.length - 1]![0], p[p.length - 1]![1], p[0]![0], p[0]![1]]);
      }
    }
    const spots = [...this.userSpots, ...(this.snap?.spotFires ?? [])];
    const ringR = Math.max(40, dist * 0.012);
    const decals: TerrainDecals = {
      brush: this.brush ? { ...this.brush, colour: new THREE.Color(this.brush.colour) } : null,
      spots: spots.slice(-16).map((s) => ({ x: s.x, y: s.y, radius: ringR })),
      ignitionSegments: segs,
      // At eye level the viewer IS the user: no marker under their feet.
      user: this.user && this.rig.mode !== 'ground' ? { x: this.user.x, y: this.user.y, radius: Math.max(15, dist * 0.01), heading: this.user.heading } : null,
      focus: this.focus ? { x: this.focus.x, y: this.focus.y, radius: Math.max(120, dist * 0.04) } : null,
    };
    tl.setDecals(decals);

    const icons: IconInstance[] = [];
    const h = (x: number, y: number): number => hf.heightAt(x, y);
    for (const ig of this.ignitions) {
      const p = ig.points[0];
      if (p) icons.push({ icon: ig.origin === 'spot' ? Icon.Spot : Icon.Ignition, x: p[0], y: p[1], z: h(p[0], p[1]), sizePx: 34, pin: ig.origin !== 'spot' });
    }
    for (const s of spots.slice(-48)) icons.push({ icon: Icon.Spot, x: s.x, y: s.y, z: h(s.x, s.y), sizePx: 26 });
    if (this.layers.insightMarkers) {
      for (const ins of this.insights) {
        const focused = this.focus?.id === ins.id;
        icons.push({ icon: severityIcon(ins.severity), x: ins.x, y: ins.y, z: h(ins.x, ins.y), sizePx: focused ? 40 : 30, pin: false, pulse: focused });
      }
    }
    if (this.focus) icons.push({ icon: Icon.Focus, x: this.focus.x, y: this.focus.y, z: h(this.focus.x, this.focus.y), sizePx: 64, pulse: true });
    if (this.user && this.rig.mode !== 'ground') icons.push({ icon: Icon.User, x: this.user.x, y: this.user.y, z: h(this.user.x, this.user.y) + 1, sizePx: 22 });
    this.icons.set(icons);
    this.dirty = true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Camera & picking
  // ───────────────────────────────────────────────────────────────────────────

  pickGround(clientX: number, clientY: number): [number, number] | null {
    if (!this.hf) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    // Camera ray through the pixel (no Raycaster / triangle tests: the heightfield is ray-marched).
    const cam = this.rig.camera;
    const o = this.tmpO.setFromMatrixPosition(cam.matrixWorld);
    const d = this.tmpD
      .set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, 0.5)
      .unproject(cam)
      .sub(o)
      .normalize();
    const hit = this.hf.raycast(o.x, o.y, o.z, d.x, d.y, d.z);
    return hit ? [hit.x, hit.y] : null;
  }

  projectToScreen(x: number, y: number): [number, number] | null {
    if (!this.hf) return null;
    const p = this.tmpO.set(x, this.hf.worldHeightAt(x, y), -y).project(this.rig.camera);
    if (p.z < -1 || p.z > 1 || p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return [rect.left + ((p.x + 1) / 2) * rect.width, rect.top + ((1 - p.y) / 2) * rect.height];
  }

  flyTo(x: number, y: number, distance?: number): void {
    this.rig.flyTo(x, y, distance);
    this.dirty = true;
  }

  setViewInsets(insets: { top?: number; right?: number; bottom?: number; left?: number }): void {
    this.rig.setViewInsets(insets, this.hf !== null);
    this.dirty = true;
  }

  zoomBy(factor: number): void {
    this.rig.zoomBy(factor);
    this.dirty = true;
  }

  get heading(): number {
    return this.rig.heading;
  }

  setHeading(deg: number): void {
    this.rig.setHeading(deg);
    this.dirty = true;
  }

  setViewMode(mode: 'orbit' | 'top' | 'ground'): void {
    const c = this.fire && this.snap ? fireCentroid(this.fire, this.displayTime, 3 * 3600) : null;
    // Eye level stands at the user's GPS position, else at the point the view is centred on ("stand here").
    const t = this.rig.controls.target;
    const stand: [number, number] = this.user ? [this.user.x, this.user.y] : [t.x, -t.z];
    this.rig.setMode(mode as ViewMode, { user: stand, lookAt: c ? [c.x, c.y] : null });
    this.updateViewDependentLayers();
    // Eye level: clear the few trees right in front of the viewer's face.
    this.vegetation?.setNearCull(mode === 'ground' ? 45 : 0);
    this.refreshMarkers();
    this.dirty = true;
  }

  get viewMode(): ViewMode {
    return this.rig.mode;
  }

  setInteractionEnabled(enabled: boolean): void {
    this.rig.setInteractionEnabled(enabled);
  }

  /** Camera access for tests and the dev harness. */
  get camera(): THREE.PerspectiveCamera {
    return this.rig.camera;
  }

  /** Place the camera explicitly (local coordinates of the target, viewing azimuth/tilt in degrees). */
  lookAt(x: number, y: number, distance: number, azimuthDeg = 200, tiltDeg = 55, animate = false): void {
    const t = this.rig.groundPoint(x, y);
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const po = THREE.MathUtils.degToRad(tiltDeg);
    const pos = new THREE.Vector3(t.x + Math.sin(az) * Math.sin(po) * distance, t.y + Math.cos(po) * distance, t.z - Math.cos(az) * Math.sin(po) * distance);
    this.rig.goTo(t, pos, animate ? 1.2 : 0);
    this.dirty = true;
  }

  /**
   * Fly to a side-on view of the cross-section (layers.crossSection), from whichever side is closer to the current
   * view, framing up to ~5 km of the section around its centre.
   */
  viewSection(animate = true): void {
    const cs = this.layers.crossSection;
    if (!this.hf) return;
    // A side view needs the oblique camera (the top view locks the tilt, eye level the position).
    if (this.rig.mode !== 'orbit') this.rig.setMode('orbit');
    const cam = this.rig.camera;
    const vfov = THREE.MathUtils.degToRad(this.rig.viewFov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.rig.viewAspect);
    // Frame ~3 km of the section across and its lowest ~2.5 km (where the fire, the plume base and the drainage
    // flows are) top to bottom: portrait phones are limited by the width, landscape by the height.
    const span = Math.min(3000, this.section.line?.length ?? 3000);
    const height = 2500 * this.vex;
    const d = THREE.MathUtils.clamp(Math.max((0.5 * span) / Math.tan(hfov / 2), (0.6 * height) / Math.tan(vfov / 2)), 1500, 12000);
    // Current camera azimuth as seen from the target; view from the nearer side of the section.
    const t = this.rig.controls.target;
    const curAz = (Math.atan2(cam.position.x - t.x, -(cam.position.z - t.z)) * 180) / Math.PI;
    const diff = (a: number): number => Math.abs(((a - curAz + 540) % 360) - 180);
    const az = diff(cs.azimuth - 90) <= diff(cs.azimuth + 90) ? cs.azimuth - 90 : cs.azimuth + 90;
    // The target must stay on the ground, so aim at a ground point BEHIND the section: the line of sight then crosses
    // the section about a third of the way up and the curtain sits in the middle of the screen, not at the top.
    const tilt = 72;
    const behind = (0.35 * height) / Math.tan(THREE.MathUtils.degToRad(90 - tilt));
    const a = THREE.MathUtils.degToRad(az);
    const tx = THREE.MathUtils.clamp(cs.centre[0] - Math.sin(a) * behind, this.hf.xMin, this.hf.xMax);
    const ty = THREE.MathUtils.clamp(cs.centre[1] - Math.cos(a) * behind, this.hf.yMin, this.hf.yMax);
    const back = Math.hypot(tx - cs.centre[0], ty - cs.centre[1]);
    this.lookAt(tx, ty, d + back, az, tilt, animate);
  }

  /** Vertical exaggeration in effect (LayerState value clamped to ≥ 0.2, the same one the shaders use). */
  private get vex(): number {
    return this.u.uVex!.value as number;
  }

  private cameraDistance(): number {
    return this.rig.camera.position.distanceTo(this.rig.controls.target);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lighting
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Scenario start (unix ms) = simulation time 0, used for the sun position (ScenarioData.startTime). Recommended:
   * without it the clock is derived from each snapshot's ambient weather record.
   */
  setStartTime(unixMs: number): void {
    this.explicitStartMs = unixMs;
    this.startMs = unixMs;
    this.fallbackSunMs = unixMs + this.displayTime * 1000;
    this.sunKey = NaN;
    this.applyLighting(this.sunTimeMs());
    this.dirty = true;
  }

  /** Sun clock (unix ms) shown before any snapshot arrives, when no start time is known. */
  setSunTime(unixMs: number): void {
    this.fallbackSunMs = unixMs;
    if (this.startMs === null) {
      this.applyLighting(unixMs);
      this.dirty = true;
    }
  }
  private fallbackSunMs = Date.now();
  private explicitStartMs: number | null = null;

  private sunTimeMs(): number {
    return this.startMs !== null ? this.startMs + this.displayTime * 1000 : this.fallbackSunMs;
  }

  private applyLighting(tMs: number): void {
    const origin = this.terrain?.grid.origin ?? { lat: -33.7, lon: 150.3 };
    const key = Math.round(tMs / 60000); // numeric: no per-frame string garbage during playback
    if (key === this.sunKey) return;
    this.sunKey = key;
    const sun = solarPosition(tMs, origin.lat, origin.lon);
    const w = this.snap?.stats?.weather;
    const L = skyLighting(sun.elevation, { cloudCover: w?.cloudCover, smoke: this.smokeHaze * 0.35 });
    const u = this.u;
    const dir = sunDirectionWorld(sun.azimuth, Math.max(sun.elevation, -2));
    (u.uSunDir!.value as THREE.Vector3).set(dir[0], dir[1], dir[2]);
    (u.uSunColour!.value as THREE.Color).setRGB(...L.sunColour);
    u.uSunI!.value = L.sunIntensity;
    (u.uSkyAmb!.value as THREE.Color).setRGB(...L.skyAmbient);
    (u.uGroundAmb!.value as THREE.Color).setRGB(...L.groundAmbient);
    u.uAmbI!.value = L.ambientIntensity;
    u.uNight!.value = L.night;
    u.uExposure!.value = L.exposure;
    (u.uFogColour!.value as THREE.Color).setRGB(...L.fog);
    (this.sky.uniforms.uZenith!.value as THREE.Color).setRGB(...L.zenith);
    (this.sky.uniforms.uHorizon!.value as THREE.Color).setRGB(...L.horizon);
    u.uGlowGain!.value = 1.2 + 5 * L.night;
    const size = this.hf ? Math.max(this.hf.xMax - this.hf.xMin, this.hf.yMax - this.hf.yMin) : 9000;
    u.uFogDensity!.value = (1 + 1.5 * this.smokeHaze) / (size * 4.2);
    this.sunAz = sun.azimuth;
    this.sunEl = sun.elevation;
    this.updateShadows(performance.now());
    // The insolation overlay changes with the sun: rebuild it when its (10-min) key changes.
    if (this.layers.overlay === 'insolation' && `${Math.round(tMs / 600000)}` !== this.insolKey) this.updateOverlay();
  }

  /**
   * Terrain cast shadows (src/terrain castShadows on the render grid: ~10 ms on a desktop, several times that on a
   * phone). Recomputed when the sun has moved by a quantum (1° azimuth / 0.5° elevation, i.e. every few simulated
   * minutes) and, during playback, at most about once a second so the frame rate does not stutter.
   */
  private updateShadows(nowWall: number): void {
    if (!this.lightT || !this.terrainLayer) return;
    const el = this.sunEl;
    const az = Math.round(this.sunAz);
    const elq = Math.round(el * 2) / 2;
    const sk = el <= 0.5 ? -1 : az * 1000 + elq * 2; // numeric key (this runs every frame)
    if (sk === this.shadowKey) return;
    const playing = this.timeTo !== this.displayTime;
    if (!Number.isNaN(this.shadowKey) && playing && nowWall - this.lastShadowWall < 1000) return; // picked up by a later frame
    this.shadowKey = sk;
    this.lastShadowWall = nowWall;
    const q = el > 0.5 ? castShadows(this.lightT, az, elq) : null;
    this.terrainLayer.setShade(null, null, q ?? new Float32Array(this.lightT.elevation.length));
    this.dirty = true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Loop
  // ───────────────────────────────────────────────────────────────────────────

  private frame(now: number): void {
    if (this.disposed || this.contextLost) return;
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    this.u.uClock!.value = (this.u.uClock!.value as number) + dt;

    this.rig.update(now);
    // Camera motion since the previous frame (also catches programmatic jumps made outside the loop).
    const cp = this.rig.camera.position;
    const ct = this.rig.controls.target;
    const moved = cp.distanceToSquared(this.lastCam) > 1e-4 || ct.distanceToSquared(this.lastTarget) > 1e-4;
    this.lastCam.copy(cp);
    this.lastTarget.copy(ct);
    // Display-time interpolation between snapshots.
    let playing = false;
    if (this.snap && this.displayTime !== this.timeTo) {
      const f = Math.min(1, (now - this.timeT0) / this.timeDur);
      this.displayTime = this.timeFrom + (this.timeTo - this.timeFrom) * f;
      playing = f < 1;
      this.applyLighting(this.sunTimeMs());
    }
    this.updateShadows(now);
    this.u.uTime!.value = this.displayTime;

    const animating =
      playing ||
      this.rig.flying ||
      this.smoke.animating ||
      (this.flames.mesh.visible && this.flames.count > 0) ||
      (this.embers.group.visible && this.embers.active > 0) ||
      this.wind.currentMode !== 'off' ||
      this.focus !== null ||
      this.user !== null ||
      this.userSpots.length + (this.snap?.spotFires.length ?? 0) > 0;
    if (!this.dirty && !moved && !animating) {
      this.meter.tick(-1e9); // break the frame-interval chain while idle
      return;
    }
    // Cap pure playback animation at 30 fps (doc 09 §3.4); interaction and camera moves run at the display rate.
    const capped = !this.dirty && !moved && !this.interacting;
    if (capped && now - this.lastRender < 31) return;
    const rdt = this.lastRender ? Math.min(0.1, (now - this.lastRender) / 1000) : dt;
    this.lastRender = now;
    this.dirty = false;

    if (moved) {
      // Re-place vegetation around the new focus once the camera settles.
      this.vegPending = now;
    } else if (this.vegPending && now - this.vegPending > 350 && !this.rig.flying) {
      this.vegPending = 0;
      this.placeVegetation(false);
      this.updateVegLod();
      this.refreshMarkers();
    }

    const vex = this.vex;
    if (this.hf && this.domain) {
      const heightAt = this.domain.heightAt;
      if (this.embers.group.visible && this.embers.active > 0) this.embers.animate(rdt, this.sampler, heightAt, vex);
      if (this.wind.currentMode !== 'off' && this.sampler) this.wind.animate(rdt, this.sampler, this.domain, vex);
    }
    this.smoke.animate(rdt);
    if (this.smoke.mesh.visible && this.smoke.count > 0) this.smoke.sort(this.rig.camera.position, vex);

    const cam = this.rig.camera;
    const vpH = (this.u.uViewport!.value as THREE.Vector2).y;
    const fovRad = THREE.MathUtils.degToRad(this.rig.viewFov);
    const pxPerRad = vpH / fovRad;
    if (this.terrainLayer) this.terrainLayer.uniforms.uPixelMetres!.value = (2 * Math.tan(fovRad / 2)) / Math.max(1, vpH);
    this.vegetation?.setProjection(pxPerRad, 2600);
    // Both in drawing-buffer pixels: flames stay ≥ 13 CSS px tall.
    this.flames.setView(pxPerRad, this.flameSpacing, 13 * this.dpr.dpr);
    this.embers.setProjection(pxPerRad, this.dpr.dpr);

    this.renderer.render(this.scene, cam);
    const info = this.renderer.info.render;
    // The adaptive DPR judges the frame rate against the cap in force (30 fps playback vs uncapped interaction).
    if (capped !== this.wasCapped) {
      this.wasCapped = capped;
      this.meter.clearHistory();
    }
    const fdt = this.measuring ? this.meter.tick(now) : 0;
    const st = this.lastStats;
    st.fps = Math.round(this.meter.fps);
    st.drawCalls = info.calls;
    st.triangles = info.triangles;
    if (!this.opts.fixedDpr && fdt > 0) {
      const d = this.dpr.sample(fdt, this.meter.fps, capped ? 30 : Infinity);
      if (d !== null) {
        this.renderer.setPixelRatio(d);
        this.u.uDpr!.value = d;
        this.wind.setDpr(d);
        this.updateViewport();
        // Pixel-width strokes baked at build time follow the new DPR.
        this.updateWindArrows();
        if (this.layers.crossSection.enabled) this.updateSection();
        this.dirty = true;
      }
    }
  }

  /** Render statistics of the last frame. */
  stats(): { fps: number; drawCalls: number; triangles: number } {
    return { ...this.lastStats };
  }

  /** Extra diagnostics for the dev HUD. */
  diagnostics(): Record<string, number | string> {
    return {
      dpr: this.dpr.dpr,
      vegetation: this.vegetation?.instanceCount ?? 0,
      vegNear: this.vegetation?.nearInstanceCount ?? 0,
      flames: this.flames.count,
      embers: this.embers.active,
      puffs: this.smoke.count,
      mesh: this.rg ? `${this.rg.grid.nx}×${this.rg.grid.ny}` : '-',
      displayTime: Math.round(this.displayTime),
    };
  }

  /** Render one frame immediately (tests / screenshots). */
  renderNow(): void {
    this.dirty = true;
    this.lastRender = 0;
    // Out-of-band frames must not feed the frame-rate meter (back-to-back calls would read as hundreds of fps and
    // make the adaptive DPR raise the resolution).
    this.measuring = false;
    try {
      this.frame(performance.now());
    } finally {
      this.measuring = true;
    }
  }
  private measuring = true;

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.rig.resize(w / h, w, h);
    this.updateViewport();
    this.dirty = true;
  }

  private updateViewport(): void {
    const v = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(v);
    (this.u.uViewport!.value as THREE.Vector2).copy(v);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.onLost);
    canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.rig.controls.removeEventListener('start', this.onStart);
    this.rig.controls.removeEventListener('end', this.onEnd);
    this.rig.controls.removeEventListener('change', this.onChange);
    this.rig.dispose();
    this.terrainLayer?.dispose();
    this.vegetation?.dispose();
    this.sky.dispose();
    this.flames.dispose();
    this.embers.dispose();
    this.wind.dispose();
    this.windArrows.dispose();
    this.smoke.dispose();
    this.section.dispose();
    this.icons.dispose();
    this.renderer.dispose();
    // Release the GL context now instead of at GC time: browsers allow only ~8–16 live contexts, and the app may
    // create a new view per scenario.
    this.renderer.forceContextLoss();
    canvas.remove();
  }
}
