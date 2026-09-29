/**
 * The "3-D forest": species-shaped, instanced trees, understorey shrubs and grass, drawn in three levels of detail.
 *
 *   near  (≈ 150–350 triangles)  trunk with bark cues, limbs, 4–7 lobes of alpha-tested leaf-cluster cards, streamers, contact shadow
 *   mid   (≈ 40–60 triangles)    trunk and crossed cards
 *   far   (2 triangles)          a camera-facing billboard with a procedural silhouette
 * so the whole forest is a few dozen draw calls (≤ 10 groups × 3 levels) for up to 60 000 instances and ≤ 250 000 triangles
 * (100 000 on 'low'). Three styles: 'natural' (all of the above), 'simple' (clean, uniform low-poly shapes, the easiest to read
 * and the cheapest) and 'coded' (the simple shapes coloured by height, cover, bark hazard or understorey hazard with the same
 * ramps as the matching heat maps).
 *
 * Fire state, wind sway, fades (top view, flames, eye-level camera) all happen in the vertex shader (treeShaders.ts); nothing is
 * recomputed per snapshot on the CPU except two wind uniforms. Placement runs as a resumable job pumped a few ms per frame
 * ({@link VegetationLayer.pump}); levels of detail are re-planned when the camera has moved ({@link VegetationLayer.updateLod}).
 * Everything created here is released by {@link VegetationLayer.dispose}.
 */
import * as THREE from 'three';
import type { FuelMap } from '../core/types';
import { canopyCodeLegend, canopyCodeScale, swayParams, type CanopyCode, type CanopyStyle } from './canopyStyle';
import type { LayerState } from './layers';
import type { LegendSpec } from './legends';
import { hexToRgb, srgbToLinear } from './palette';
import { treeModel, type Lod, type MeshData, type ModelFamily } from './treeModels';
import { TREE_FRAG, TREE_VERT } from './treeShaders';
import { impostorAtlas, leafAtlas, type TextureImage } from './treeTextures';
import { planLod, type LodPlan } from './vegetationLod';
import { PlacementJob, VegGroup, type PlacementOptions, type VegInstances } from './vegetationPlacement';

/** Quality-dependent budgets of the layer. */
export interface CanopyBudget {
  /** Triangles over all levels (hard limit). */
  triangles: number;
  /** Instance caps of the near and mid levels for trees. */
  near: number;
  mid: number;
  /** Caps of the low plants (heath, understorey, grass), which are only detailed very close to the camera. */
  nearSmall: number;
  midSmall: number;
}

export const CANOPY_BUDGETS = {
  high: { triangles: 250000, near: 220, mid: 1200, nearSmall: 420, midSmall: 700 },
  medium: { triangles: 170000, near: 150, mid: 800, nearSmall: 280, midSmall: 450 },
  low: { triangles: 100000, near: 80, mid: 400, nearSmall: 150, midSmall: 250 },
} as const satisfies Record<string, CanopyBudget>;

/** Per-group shader constants. */
interface GroupSpec {
  kind: number;
  consumable: number;
  lobeJit: number;
  lobeHide: number;
  /** Linear trunk colours of [smooth, ribbon, stringy] bark. */
  bark: [string, string, string];
  simpleCrown: string;
  simpleTrunk: string;
}

const PALE = '#a99f8b';
const SPEC: Record<VegGroup, GroupSpec> = {
  // Stringybark: near-black fibrous trunk. Ribbon bark: pale grey. Smooth gum: pale cream.
  [VegGroup.Stringybark]: { kind: 0, consumable: 0, lobeJit: 0.15, lobeHide: 0.35, bark: ['#8a806b', '#8a806b', '#3a2a20'], simpleCrown: '#5f8f56', simpleTrunk: '#6b5a48' },
  [VegGroup.Ribbonbark]: { kind: 0, consumable: 0, lobeJit: 0.15, lobeHide: 0.35, bark: ['#b6ad9a', '#b6ad9a', '#8a806b'], simpleCrown: '#5f8f56', simpleTrunk: '#6b5a48' },
  [VegGroup.SmoothGum]: { kind: 0, consumable: 0, lobeJit: 0.15, lobeHide: 0.35, bark: ['#cfc8b6', '#cfc8b6', '#b6ad9a'], simpleCrown: '#5f8f56', simpleTrunk: '#6b5a48' },
  [VegGroup.TallWetGum]: { kind: 1, consumable: 0, lobeJit: 0.14, lobeHide: 0.3, bark: ['#b7ad99', '#9d9482', '#4a3a2c'], simpleCrown: '#5f8f56', simpleTrunk: '#6b5a48' },
  [VegGroup.Rainforest]: { kind: 2, consumable: 0, lobeJit: 0.12, lobeHide: 0.25, bark: ['#5b4f42', '#5b4f42', '#5b4f42'], simpleCrown: '#5f8f56', simpleTrunk: '#6b5a48' },
  [VegGroup.SnowGum]: { kind: 3, consumable: 0, lobeJit: 0.14, lobeHide: 0.3, bark: ['#e0d9c8', '#d4ccb8', '#bfb5a0'], simpleCrown: '#5f8f56', simpleTrunk: '#6b5a48' },
  [VegGroup.Conifer]: { kind: 4, consumable: 0, lobeJit: 0, lobeHide: 0, bark: ['#4a3a2c', '#4a3a2c', '#4a3a2c'], simpleCrown: '#3d6b45', simpleTrunk: '#5a4a3a' },
  [VegGroup.Heath]: { kind: 5, consumable: 1, lobeJit: 0.1, lobeHide: 0, bark: [PALE, PALE, PALE], simpleCrown: '#7ea060', simpleTrunk: '#6b5a48' },
  [VegGroup.Understorey]: { kind: 6, consumable: 1, lobeJit: 0.1, lobeHide: 0, bark: [PALE, PALE, PALE], simpleCrown: '#7ea060', simpleTrunk: '#6b5a48' },
  [VegGroup.Grass]: { kind: 7, consumable: 1, lobeJit: 0, lobeHide: 0, bark: [PALE, PALE, PALE], simpleCrown: '#a2b56a', simpleTrunk: '#6b5a48' },
};

const linear = (hex: string): THREE.Color => {
  const c = hexToRgb(hex);
  return new THREE.Color(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]));
};

function dataTexture(img: TextureImage): THREE.DataTexture {
  const t = new THREE.DataTexture(img.mips[0]!.data, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.mipmaps = img.mips.map((m) => ({ data: m.data, width: m.width, height: m.height }));
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export function meshGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(m.mat, 3));
  g.setIndex(m.idx);
  return g;
}

export interface VegetationStats {
  instances: number;
  /** Instances per level of detail. */
  near: number;
  mid: number;
  far: number;
  triangles: number;
  meshes: number;
}

const SHARED_KEYS = [
  'uVex',
  'uTime',
  'uClock',
  'uHasFire',
  'uBurnBand',
  'uArrival',
  'uFireAux',
  'uFireXf',
  'uGlow',
  'uGlowXf',
  'uGlowGain',
  'uSunDir',
  'uSunColour',
  'uSunI',
  'uSkyAmb',
  'uGroundAmb',
  'uAmbI',
  'uExposure',
  'uFogColour',
  'uFogDensity',
];

/** Sine of the view elevation between which the canopy fades out (≈ 60° … 82° above the horizon). */
export const TOP_FADE: [number, number] = [0.87, 0.99];

export class VegetationLayer {
  readonly group = new THREE.Group();
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly materials = new Map<string, THREE.ShaderMaterial>();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private meshes: THREE.Mesh[] = [];
  private instanceGeoms: THREE.InstancedBufferGeometry[] = [];
  private readonly leafTex: THREE.DataTexture;
  private readonly impTex: THREE.DataTexture;
  private codeTex: THREE.DataTexture;
  private readonly shared: Record<string, THREE.IUniform>;

  private sets: VegInstances[] = [];
  private job: PlacementJob | null = null;
  private plan: LodPlan | null = null;
  private lodCam: [number, number, number] | null = null;
  private lodVex = 1;
  private lodPx = 1000;
  private planSig = '';
  private pendingSets: VegInstances[] | null = null;
  private pendingPlan: LodPlan | null = null;
  private planDirty = false;
  /**
   * Spread the heavy steps (placement, level-of-detail plan, buffer build) over successive {@link pump} calls, one per frame,
   * so none of them is a hitch. The scene view turns this on; off (the default), every change is applied at once.
   */
  staged = false;
  private budget: CanopyBudget = CANOPY_BUDGETS.high;
  /** Distance / height below which an instance uses the near / mid model (tests and tuning may override). */
  nearRatio: number | undefined;
  midRatio: number | undefined;

  private layers: { vegetation: boolean; understorey: boolean; style: CanopyStyle; code: CanopyCode; sway: boolean; solo: boolean } = {
    vegetation: true,
    understorey: true,
    style: 'natural',
    code: 'height',
    sway: true,
    solo: true,
  };
  private overlayOn = false;
  private windSpeed = 0;
  private disposed = false;

  constructor(shared: Record<string, THREE.IUniform>) {
    this.group.name = 'vegetation';
    this.shared = shared;
    this.leafTex = dataTexture(leafAtlas());
    this.impTex = dataTexture(impostorAtlas());
    this.codeTex = this.makeCodeTexture('height');
    const scale = canopyCodeScale('height');
    this.uniforms = {
      uPxPerRad: { value: 1000 },
      uCullPx: { value: 1.2 },
      uThinStart: { value: 2600 },
      uNearFade: { value: 0 },
      uStyle: { value: 0 },
      uSway: { value: 1 },
      uWindDir: { value: new THREE.Vector2(0, 1) },
      uSwayAmp: { value: new THREE.Vector3(0, 0, 0) },
      uTopFade: { value: new THREE.Vector2(TOP_FADE[0], TOP_FADE[1]) },
      uFireFade: { value: 1 },
      uCode: { value: 0 },
      uCodeRange: { value: new THREE.Vector2(scale.lo, scale.hi) },
      uCodeLut: { value: this.codeTex },
      uLeaf: { value: this.leafTex },
      uImp: { value: this.impTex },
    };
    for (const k of SHARED_KEYS) if (!shared[k]) throw new Error(`uniform ${k} missing`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Options
  // ─────────────────────────────────────────────────────────────────────────

  /** Triangle and instance budgets of the quality tier. */
  setBudget(b: CanopyBudget): void {
    this.budget = b;
    this.planSig = '';
  }

  /** The near-LOD instance cap (kept for the old API; the quality tier sets it through {@link setBudget}). */
  set lodMax(n: number) {
    this.budget = { ...this.budget, near: n };
  }
  get lodMax(): number {
    return this.budget.near;
  }

  /**
   * Apply the layer switches. Style, code, sway and the understorey take effect on the next frame; the 3-D canopy is hidden
   * while a heat map is solo (`soloHeat` with an active overlay).
   */
  setLayers(l: Pick<LayerState, 'vegetation' | 'understorey' | 'canopyStyle' | 'canopyCode' | 'windSway' | 'soloHeat' | 'overlay'>): void {
    const prev = this.layers;
    const next = { vegetation: l.vegetation, understorey: l.understorey, style: l.canopyStyle, code: l.canopyCode, sway: l.windSway, solo: l.soloHeat };
    this.layers = next;
    this.overlayOn = l.overlay !== 'none';
    this.group.visible = next.vegetation && !(next.solo && this.overlayOn);
    this.uniforms.uStyle!.value = next.style === 'natural' ? 0 : next.style === 'simple' ? 1 : 2;
    this.uniforms.uSway!.value = next.sway ? 1 : 0;
    if (next.style === 'coded' && (next.code !== prev.code || prev.style !== 'coded')) this.applyCode(next.code);
    if (next.style !== prev.style || next.understorey !== prev.understorey) {
      this.planSig = '';
      this.requestPlan();
    }
  }

  /** True when the canopy is drawn. */
  get visible(): boolean {
    return this.group.visible;
  }

  /** The style now in force. */
  get style(): CanopyStyle {
    return this.layers.style;
  }

  /** Legend of the colour coding while the 'coded' style is shown, else null. */
  legend(): LegendSpec | null {
    return this.layers.style === 'coded' && this.group.visible ? canopyCodeLegend(this.layers.code) : null;
  }

  private makeCodeTexture(code: CanopyCode): THREE.DataTexture {
    const t = new THREE.DataTexture(canopyCodeScale(code).lut, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }

  private applyCode(code: CanopyCode): void {
    const scale = canopyCodeScale(code);
    this.codeTex.dispose();
    this.codeTex = this.makeCodeTexture(code);
    this.uniforms.uCodeLut!.value = this.codeTex;
    (this.uniforms.uCodeRange!.value as THREE.Vector2).set(scale.lo, scale.hi);
    this.uniforms.uCode!.value = ['height', 'cover', 'bark', 'understorey'].indexOf(code);
  }

  /**
   * Near-surface wind (m/s, u east and v north) that leans and sways the trees. Cheap: two uniforms. Call per snapshot.
   */
  setWind(u: number, v: number): void {
    const speed = Math.hypot(u, v);
    this.windSpeed = speed;
    const p = swayParams(speed);
    const dir = this.uniforms.uWindDir!.value as THREE.Vector2;
    if (speed > 1e-3) dir.set(u / speed, -v / speed);
    (this.uniforms.uSwayAmp!.value as THREE.Vector3).set(p.lean, p.amp, p.flutter);
  }

  /** True while the trees sway (the caller must keep rendering frames). */
  get animating(): boolean {
    return this.layers.sway && this.group.visible && this.windSpeed > 0.5 && (this.plan?.counts[0] ?? 0) + (this.plan?.counts[1] ?? 0) > 0;
  }

  /** Radius (m) inside which trees fade out around the camera (eye-level views); 0 = off. */
  setNearCull(metres: number): void {
    this.uniforms.uNearFade!.value = metres;
  }

  /** Pixels per radian of view angle (for screen-size culling) and the distance where far trees start to thin out. */
  setProjection(pxPerRad: number, thinStart: number): void {
    this.uniforms.uPxPerRad!.value = pxPerRad;
    this.uniforms.uThinStart!.value = thinStart;
    this.lodPx = pxPerRad;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Placement (incremental) and level of detail
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start (or restart) placing the forest for a fuel map. The work is done a few ms per frame by {@link pump}; the current
   * trees stay on screen until the new set is ready. `cam` seeds the level-of-detail plan of the result.
   */
  startPlacement(fuel: FuelMap, opts: PlacementOptions, cam?: readonly [number, number, number], vex = 1): void {
    this.job = new PlacementJob(fuel, { ...opts, understorey: opts.understorey ?? this.layers.understorey });
    if (cam) {
      this.lodCam = [cam[0], cam[1], cam[2]];
      this.lodVex = vex;
    }
  }

  /** Abandon a running placement job and any unfinished follow-up work (the current trees stay). */
  cancelPlacement(): void {
    this.job = null;
    this.pendingSets = null;
    this.pendingPlan = null;
    this.planDirty = false;
  }

  /** True while placement, planning or the buffer build is unfinished (the caller must keep rendering frames and pumping). */
  get placing(): boolean {
    return this.job !== null || this.pendingSets !== null || this.planDirty || this.pendingPlan !== null;
  }

  /**
   * Advance the placement job by about `ms` milliseconds, then plan the levels of detail and build the buffers. Staged
   * layers do one of these steps per call (so a frame never has more than one), unstaged layers and `ms = Infinity` finish
   * everything. Returns true when the picture changed.
   */
  pump(ms = 4): boolean {
    const oneStep = this.staged && ms !== Infinity;
    if (this.job) {
      if (!this.job.step(ms)) return false;
      this.pendingSets = this.job.result;
      this.job = null;
      if (oneStep) return false;
    }
    if (this.pendingSets) {
      this.sets = this.pendingSets;
      this.pendingSets = null;
      this.planSig = '';
      this.planDirty = true;
      if (oneStep) return false;
    }
    if (this.planDirty) {
      this.planDirty = false;
      this.pendingPlan = this.computePlan();
      if (oneStep) return false;
    }
    if (this.pendingPlan) {
      const plan = this.pendingPlan;
      this.pendingPlan = null;
      return this.applyPlan(plan);
    }
    return false;
  }

  /** Replace all instances at once (tests, and after a finished placement job). */
  setInstances(sets: VegInstances[]): void {
    this.sets = sets;
    this.planSig = '';
    this.requestPlan();
  }

  /**
   * Re-plan the levels of detail around a camera position (local x, y and z m ASL). Cheap to call every frame: it does
   * nothing unless the camera moved by more than a tenth of its distance to the scene (or `force`).
   */
  updateLod(cam: readonly [number, number, number], vex: number, focusDist = 800, force = false): void {
    const c = this.lodCam;
    const moved = c ? Math.hypot(cam[0] - c[0], cam[1] - c[1], (cam[2] - c[2]) * vex) : Infinity;
    if (!force && c && this.lodVex === vex && moved < Math.max(12, 0.1 * focusDist)) return;
    if (c) {
      c[0] = cam[0];
      c[1] = cam[1];
      c[2] = cam[2];
    } else this.lodCam = [cam[0], cam[1], cam[2]];
    this.lodVex = vex;
    this.requestPlan();
  }

  /** Plan now, or (staged) at the next {@link pump}. */
  private requestPlan(): void {
    if (this.staged) this.planDirty = true;
    else this.replan();
  }

  private family(): ModelFamily {
    return this.layers.style === 'natural' ? 'natural' : 'flat';
  }

  private hiddenGroups(): Set<VegGroup> {
    const h = new Set<VegGroup>();
    if (!this.layers.understorey) h.add(VegGroup.Understorey);
    if (this.layers.style === 'coded') h.add(VegGroup.Grass);
    return h;
  }

  /** Re-plan the levels of detail and rebuild the buffers now (after changing the ratios or the camera). */
  replan(): void {
    if (this.disposed) return;
    this.planDirty = false;
    this.pendingPlan = null;
    this.applyPlan(this.computePlan());
  }

  private computePlan(): LodPlan | null {
    if (this.sets.length === 0) return null;
    return planLod(this.sets, {
      cam: this.lodCam ?? [0, 0, 1e5],
      vex: this.lodVex,
      pxPerRad: this.lodPx,
      family: this.family(),
      nearRatio: this.nearRatio,
      midRatio: this.midRatio,
      maxNear: this.budget.near,
      maxMid: this.budget.mid,
      maxNearSmall: this.budget.nearSmall,
      maxMidSmall: this.budget.midSmall,
      maxTriangles: this.budget.triangles,
      maxInstances: 60000,
      hidden: this.hiddenGroups(),
    });
  }

  /** Swap in a plan: rebuild the meshes unless it is the one already drawn. True if the picture changed. */
  private applyPlan(plan: LodPlan | null): boolean {
    if (this.disposed) return false;
    if (!plan) {
      const had = this.meshes.length > 0;
      this.clearMeshes();
      this.plan = null;
      return had;
    }
    // Skip the (few MB) re-upload when the plan did not change.
    const sig = planSignature(plan, this.family());
    this.plan = plan;
    if (sig === this.planSig) return false;
    this.planSig = sig;
    this.rebuild(plan);
    return true;
  }

  private clearMeshes(): void {
    for (const m of this.meshes) this.group.remove(m);
    for (const g of this.instanceGeoms) g.dispose();
    this.meshes = [];
    this.instanceGeoms = [];
  }

  private rebuild(plan: LodPlan): void {
    this.clearMeshes();
    const family = this.family();
    for (const { group, lod, set } of plan.sets) {
      if (set.count === 0) continue;
      const base = this.geometryFor(group, family, lod);
      const ig = new THREE.InstancedBufferGeometry();
      for (const name of ['position', 'normal', 'uv', 'aMat']) ig.setAttribute(name, base.getAttribute(name));
      ig.setIndex(base.getIndex());
      ig.setAttribute('aInst', new THREE.InstancedBufferAttribute(set.position, 3));
      ig.setAttribute('aSize', new THREE.InstancedBufferAttribute(set.size, 2));
      ig.setAttribute('aRand', new THREE.InstancedBufferAttribute(set.rand, 2));
      ig.setAttribute('aTint', new THREE.InstancedBufferAttribute(set.tint, 4, true));
      ig.setAttribute('aInfo', new THREE.InstancedBufferAttribute(set.info, 4, true));
      ig.setAttribute('aAux', new THREE.InstancedBufferAttribute(set.aux, 4, true));
      ig.instanceCount = set.count;
      const mesh = new THREE.Mesh(ig, this.materialFor(group, lod));
      mesh.frustumCulled = false; // culled per instance in the vertex shader
      mesh.name = `veg-${VegGroup[group]}-${['near', 'mid', 'far'][lod]}`;
      this.meshes.push(mesh);
      this.instanceGeoms.push(ig);
      this.group.add(mesh);
    }
  }

  private geometryFor(group: VegGroup, family: ModelFamily, lod: Lod): THREE.BufferGeometry {
    const key = `${group}/${family}/${lod}`;
    let g = this.geometries.get(key);
    if (!g) {
      g = meshGeometry(treeModel(group, family, lod));
      this.geometries.set(key, g);
    }
    return g;
  }

  private materialFor(group: VegGroup, lod: Lod): THREE.ShaderMaterial {
    const key = `${group}/${lod}`;
    let m = this.materials.get(key);
    if (!m) {
      const s = SPEC[group];
      const uniforms: Record<string, THREE.IUniform> = {};
      for (const k of SHARED_KEYS) uniforms[k] = this.shared[k]!;
      if (this.shared.uNight) uniforms.uNight = this.shared.uNight;
      Object.assign(uniforms, this.uniforms);
      Object.assign(uniforms, {
        uKind: { value: s.kind },
        uLod: { value: lod },
        uConsumable: { value: s.consumable },
        uLobeJit: { value: s.lobeJit },
        uLobeHide: { value: s.lobeHide },
        uBarkCol: { value: s.bark.map(linear) },
        uSimpleCrown: { value: linear(s.simpleCrown) },
        uSimpleTrunk: { value: linear(s.simpleTrunk) },
      });
      m = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: TREE_VERT,
        fragmentShader: TREE_FRAG,
        toneMapped: false,
        side: THREE.DoubleSide,
        alphaToCoverage: true,
        // A little towards the camera: trunk bases and ground decals never z-fight with the terrain mesh.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      });
      this.materials.set(key, m);
    }
    return m;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Diagnostics
  // ─────────────────────────────────────────────────────────────────────────

  get instanceCount(): number {
    return this.instanceGeoms.reduce((s, g) => s + g.instanceCount, 0);
  }

  /** Instances currently drawn with the detailed near-LOD models. */
  get nearInstanceCount(): number {
    return this.plan?.counts[0] ?? 0;
  }

  stats(): VegetationStats {
    const p = this.plan;
    return { instances: p?.instances ?? 0, near: p?.counts[0] ?? 0, mid: p?.counts[1] ?? 0, far: p?.counts[2] ?? 0, triangles: p?.triangles ?? 0, meshes: this.meshes.length };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearMeshes();
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.leafTex.dispose();
    this.impTex.dispose();
    this.codeTex.dispose();
    this.sets = [];
    this.plan = null;
    this.job = null;
  }
}

/** Cheap fingerprint of a plan (counts and a position checksum per set) to detect "nothing changed". */
function planSignature(plan: LodPlan, family: string): string {
  let s = family;
  for (const { group, lod, set } of plan.sets) {
    let h = 0;
    const p = set.position;
    const step = Math.max(1, Math.floor(set.count / 64));
    for (let i = 0; i < set.count; i += step) h += p[i * 3]! * 1.37 + p[i * 3 + 1]! * 0.73;
    s += `|${group}.${lod}:${set.count}:${h.toFixed(1)}`;
  }
  return s;
}
