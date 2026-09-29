/**
 * PlacesLayer — roads, RFS fire trails, home markers, land-use zones and place/road names drawn in the 3-D scene so a
 * trainee can situate themselves. Five independent layers (LayerState.roads / fireTrails / homes / zones / placeNames),
 * at most 5 extra draw calls:
 *
 *   roads        one mesh: mitred ribbons draped on the terrain (resampled to ≤ 20 m), widest classes drawn last. The
 *                vertex shader widens a ribbon to at least ~2 px and adds a dark casing under the lighter fill; unsealed
 *                roads and tracks are dashed, sealed solid, paths dotted. Colour by class, dimmed with the scene light.
 *   fire trails  one mesh: bold magenta dashed line with a white halo (a colour that appears nowhere else on the map).
 *   zone edges   one mesh: thin outlines of the residential / built-up zones (the soft FILL is a texture sampled by the
 *                terrain shader — TerrainLayer.setZones — so it costs no draw call).
 *   homes        one instanced mesh of tiny gabled boxes (~8 m) that turn into plain dots of a minimum on-screen size when
 *                zoomed out and light their windows at night.
 *   names        one instanced sprite mesh: suburb/town names and main-road names from a canvas atlas, sized by distance,
 *                faded out of range, hidden behind hills, thinned by a screen-space collision pass (≤ 30 shown, recomputed
 *                at most 4× per second).
 *
 * Roads and trails show the fire: their fragment shader reads the same arrival-time texture as the terrain, so the
 * flaming band glows through them and burnt road is sooted — nothing hides the fire. Vertical exaggeration, lighting, fog
 * and the day/night theme come from the scene's shared uniforms, so none of them ever triggers a rebuild.
 *
 * Geometry is built in time slices (a generator pumped from the render loop) so a 2 000-segment town never blocks a frame
 * for more than a few milliseconds. Every GPU object is registered and disposed in {@link PlacesLayer.dispose}.
 */
import * as THREE from 'three';
import type { ContextLayers } from '../core/places';
import { FOG, TONEMAP } from './glsl';
import type { HeightField } from './heightfield';
import { dummyFloat } from './textures';
import {
  buildLabelCandidates,
  clipPolyline,
  FIRE_TRAIL_STYLE,
  FIRE_TRAIL_WIDTH_M,
  homeInstances,
  houseGeometry,
  LABEL_STYLES,
  lineOfSightClear,
  RIBBON_STRIDE,
  RibbonBuilder,
  rasterizeZones,
  ROAD_WIDTH_M,
  roadDash,
  roadStyleIndex,
  selectLabels,
  STYLE_COUNT,
  STYLES,
  zoneFrame,
  zoneStyleIndex,
  type Bounds,
  type LabelCandidate,
  type LabelKind,
  type RibbonMeshData,
  type ScreenItem,
  type ZoneFrame,
} from './placesGeometry';

/** Which places layers are on (the matching fields of LayerState). */
export interface PlacesLayers {
  roads: boolean;
  fireTrails: boolean;
  homes: boolean;
  zones: boolean;
  placeNames: boolean;
}

/** What the terrain must offer for the zone tint (implemented by TerrainLayer). */
export interface ZoneSink {
  setZones(tex: THREE.Texture | null, frame: ZoneFrame | null, visible?: boolean): void;
  setZonesVisible(visible: boolean): void;
}

export interface PlacesStats {
  /** Draw calls of the visible places meshes. */
  drawCalls: number;
  triangles: number;
  /** Approximate GPU memory of everything this layer owns (bytes). */
  gpuBytes: number;
  /** Live registered GPU objects (geometries + materials + textures); 0 after dispose. */
  resources: number;
  /** Milliseconds spent building the geometry, all slices together. */
  buildMs: number;
  /** Longest single slice (ms). */
  longestSliceMs: number;
  /** Build time per stage (ms): roads, trails, zones, homes, names. */
  stageMs: Record<string, number>;
  building: boolean;
  labelsShown: number;
  labelCandidates: number;
}

const ZONE_TEX = 1024;
const MAX_LABELS_SHOWN = 30;
const MAX_ATLAS_LABELS = 160;
const ATLAS_FONT_PX = 30;
const ATLAS_PAD = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Shaders
// ─────────────────────────────────────────────────────────────────────────────

const RIBBON_VERT = /* glsl */ `
uniform float uVex;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uLift;
uniform vec4 uPar[${STYLE_COUNT}];   // min fill px, casing m, casing px, dash duty
uniform vec4 uPar2[${STYLE_COUNT}];  // min dash period px, opacity
attribute vec2 aOff;
attribute float aAcross;
attribute vec4 aMeta;                // half width m, along m, dash period m, style
varying vec2 vLocal;
varying float vAcross;
varying float vFrac;
varying float vAA;
varying float vAlong;
varying float vPeriod;
varying float vStyle;
varying float vPx;
varying float vDist;
void main() {
  int st = int(aMeta.w + 0.5);
  vec3 base = vec3(position.x, position.z * uVex, -position.y);
  vec4 mv0 = viewMatrix * vec4(base, 1.0);
  float depth = max(-mv0.z, 0.5);
  // Metres covered by one CSS pixel at this depth: lines never get thinner than their minimum pixel width.
  float px = depth * 2.0 / (projectionMatrix[1][1] * uViewport.y) * uDpr;
  vec4 par = uPar[st];
  float hwFill = max(aMeta.x, 0.5 * par.x * px);
  float cas = max(par.y, par.z * px);
  float H = hwFill + cas;
  vec2 off = aOff * (aAcross * H);
  // Lift above the ground grows with distance so the ribbon never sinks into the (differently triangulated) mesh.
  float lift = uLift + depth * 0.00035;
  vec3 w = vec3(position.x + off.x, base.y + lift, base.z - off.y);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  vLocal = position.xy;
  vAcross = aAcross;
  vFrac = hwFill / H;
  vAA = px / H;
  vAlong = aMeta.y;
  vPeriod = aMeta.z;
  vStyle = aMeta.w;
  vPx = px;
}
`;

const RIBBON_FRAG = /* glsl */ `
${TONEMAP}
${FOG}
uniform vec3 uFill[${STYLE_COUNT}];
uniform vec3 uCase[${STYLE_COUNT}];
uniform vec4 uPar[${STYLE_COUNT}];
uniform vec4 uPar2[${STYLE_COUNT}];
uniform float uNight;
uniform float uClock;
uniform float uTime;
uniform float uBurnBand;
uniform float uHasFire;
uniform vec4 uFireXf;
uniform sampler2D uArrival;
varying vec2 vLocal;
varying float vAcross;
varying float vFrac;
varying float vAA;
varying float vAlong;
varying float vPeriod;
varying float vStyle;
varying float vPx;
varying float vDist;

// Fire arrival time (same filtering as the terrain, so the fire crosses a road exactly where it crosses the ground).
float arrivalAt(vec2 uv) {
  ivec2 size = textureSize(uArrival, 0);
  vec2 p = uv * vec2(size) - 0.5;
  vec2 f = fract(p);
  ivec2 i0 = ivec2(floor(p));
  ivec2 mx = size - 1;
  float va = texelFetch(uArrival, clamp(i0, ivec2(0), mx), 0).r;
  float vb = texelFetch(uArrival, clamp(i0 + ivec2(1, 0), ivec2(0), mx), 0).r;
  float vc = texelFetch(uArrival, clamp(i0 + ivec2(0, 1), ivec2(0), mx), 0).r;
  float vd = texelFetch(uArrival, clamp(i0 + ivec2(1, 1), ivec2(0), mx), 0).r;
  float m = -1.0;
  if (va < 1e29) m = max(m, va);
  if (vb < 1e29) m = max(m, vb);
  if (vc < 1e29) m = max(m, vc);
  if (vd < 1e29) m = max(m, vd);
  if (m < 0.0) return 1e30;
  float r = m + 600.0;
  va = va < 1e29 ? va : r;
  vb = vb < 1e29 ? vb : r;
  vc = vc < 1e29 ? vc : r;
  vd = vd < 1e29 ? vd : r;
  return mix(mix(va, vb, f.x), mix(vc, vd, f.x), f.y);
}

void main() {
  int st = int(vStyle + 0.5);
  float a = abs(vAcross);
  float aa = max(vAA, 1e-4);
  float outer = 1.0 - smoothstep(1.0 - aa, 1.0, a);
  float inner = 1.0 - smoothstep(vFrac - aa, vFrac, a);
  vec4 par = uPar[st];
  vec4 par2 = uPar2[st];
  float alpha = outer * par2.y;
  // Dashes: the period stretches by powers of two in wide views so a dash is never shorter than par2.x CSS pixels.
  if (vPeriod > 0.0) {
    float per = vPeriod * exp2(ceil(log2(max(1.0, par2.x * vPx / vPeriod))));
    float ph = fract(vAlong / per);
    float d = par.w;
    float aaL = clamp(vPx / per, 1e-3, 0.25);
    alpha *= smoothstep(0.0, aaL, ph) * (1.0 - smoothstep(d - aaL, d, ph));
  }
  if (alpha < 0.01) discard;
  vec3 col = mix(uCase[st], uFill[st], inner);
  // Close up (eye level, low orbit) a road looks like a road: the class colours give way to asphalt or dirt so the
  // map does not paint bright stripes across the view. Fire trails keep their colour everywhere.
  if (st < ${FIRE_TRAIL_STYLE}) {
    float nearK = 1.0 - smoothstep(70.0, 380.0, vDist);
    vec3 natural = vPeriod > 0.0 ? vec3(0.2, 0.135, 0.075) : vec3(0.06, 0.06, 0.065);
    col = mix(col, natural, 0.93 * nearK) + 0.02 * col * nearK;
  }
  // Scene light: night dims and cools the map, but roads stay readable.
  float k = mix(1.0, 0.36, uNight);
  col *= k * mix(vec3(1.0), vec3(0.78, 0.9, 1.12), uNight);

  // Fire: the flaming band glows through the road, burnt road is sooted.
  vec3 emit = vec3(0.0);
  float ta = 1e30;
  vec2 fuv = (vLocal - uFireXf.xy) / uFireXf.zw;
  if (uHasFire > 0.5 && fuv.x >= 0.0 && fuv.y >= 0.0 && fuv.x <= 1.0 && fuv.y <= 1.0) ta = arrivalAt(fuv);
  if (ta < 1e29) {
    float dt = uTime - ta;
    float flick = 0.6 + 0.4 * sin(uClock * 5.0 + vLocal.x * 0.07 + vLocal.y * 0.05);
    if (dt >= 0.0) {
      col = mix(col, col * 0.45, smoothstep(0.0, 300.0, dt));
      float band = 1.0 - smoothstep(0.0, uBurnBand, dt);
      emit += mix(vec3(0.9, 0.16, 0.02), vec3(1.0, 0.45, 0.08), flick) * band * band * (0.9 + 1.0 * flick) * 0.9;
    }
  }
  vec3 ldr = fsDisplay(col);
  ldr += fsTonemap(emit) * 0.9;
  ldr = fsFog(ldr, vDist);
  gl_FragColor = vec4(ldr, alpha);
  #include <colorspace_fragment>
}
`;

const HOME_VERT = /* glsl */ `
uniform float uVex;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uDotPx;
uniform float uFar;
attribute vec4 aInst;   // x, y, z ASL, random
attribute float aPart;  // 0 wall, 1 roof
varying vec3 vN;
varying float vPart;
varying float vDot;
varying float vDist;
void main() {
  float r = aInst.w;
  float ang = r * 3.14159265;
  float sc = 0.85 + 0.4 * fract(r * 17.31);
  vec3 base = vec3(aInst.x, aInst.z * uVex, -aInst.y);
  vec4 mv0 = viewMatrix * vec4(base + vec3(0.0, 3.0, 0.0), 1.0);
  float depth = -mv0.z;
  // Far, behind the camera or off screen: cull the whole house before doing any work.
  if (depth < 1.0 || depth > uFar || abs(mv0.x) > depth / projectionMatrix[0][0] + 25.0 || abs(mv0.y) > depth / projectionMatrix[1][1] + 25.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float mpp = depth * 2.0 / (projectionMatrix[1][1] * uViewport.y) * uDpr;  // metres per CSS px
  float sizePx = 8.0 * sc / mpp;
  // Never smaller than a dot of uDotPx pixels: zoomed out, houses become plain dots.
  float boost = clamp(uDotPx / max(sizePx, 1e-3), 1.0, 60.0);
  vec3 lp = position * (sc * boost);
  float cs = cos(ang);
  float sn = sin(ang);
  lp = vec3(cs * lp.x - sn * lp.z, lp.y, sn * lp.x + cs * lp.z);
  vec3 nn = vec3(cs * normal.x - sn * normal.z, normal.y, sn * normal.x + cs * normal.z);
  vN = nn;
  vPart = aPart;
  vDot = smoothstep(1.1, 2.2, boost);
  vec4 mv = viewMatrix * vec4(base + lp, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const HOME_FRAG = /* glsl */ `
${TONEMAP}
${FOG}
uniform vec3 uSunDir; uniform vec3 uSunColour; uniform float uSunI;
uniform vec3 uSkyAmb; uniform vec3 uGroundAmb; uniform float uAmbI; uniform float uNight;
uniform vec3 uWall; uniform vec3 uRoof; uniform vec3 uDotCol;
varying vec3 vN;
varying float vPart;
varying float vDot;
varying float vDist;
void main() {
  vec3 n = normalize(vN);
  vec3 albedo = mix(uWall, uRoof, vPart);
  albedo = mix(albedo, uDotCol, vDot);
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 amb = mix(uGroundAmb, uSkyAmb, 0.5 + 0.5 * n.y) * uAmbI;
  vec3 lit = (uSunColour * uSunI * ndl * 0.85 + amb * 1.3 + 0.05 * (1.0 - uNight)) / LIGHT_REF;
  // Dots are drawn flat and bright so they read as markers; houses are lit by the scene.
  vec3 col = albedo * mix(lit, vec3(0.9) + 0.1 * lit, vDot);
  // Lit windows at night keep the town readable.
  col += vec3(1.0, 0.72, 0.32) * uNight * (0.04 + 0.3 * vDot) * (1.0 - vPart * 0.6);
  vec3 ldr = fsDisplay(col);
  ldr = fsFog(ldr, vDist);
  gl_FragColor = vec4(ldr, 1.0);
  #include <colorspace_fragment>
}
`;

const LABEL_VERT = /* glsl */ `
uniform float uVex;
uniform vec2 uViewport;
uniform float uDpr;
attribute vec3 aAnchor;  // local x, y, z ASL
attribute vec4 aRect;    // atlas u0, v0 (top), u1, v1 (bottom)
attribute vec3 aSize;    // width px, height px (CSS), opacity
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4(aAnchor.x, aAnchor.z * uVex, -aAnchor.y, 1.0);
  if (clip.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec2 corner = position.xy;  // -0.5 … 0.5
  clip.xy += corner * aSize.xy * uDpr / (uViewport * 0.5) * clip.w;
  clip.z = 0.0;
  gl_Position = clip;
  vUv = vec2(mix(aRect.x, aRect.z, corner.x + 0.5), mix(aRect.w, aRect.y, corner.y + 0.5));
  vAlpha = aSize.z;
}
`;

const LABEL_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uNight;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 c = texture(uAtlas, vUv);
  c.rgb *= mix(1.0, 0.82, uNight);
  c.a *= vAlpha;
  if (c.a < 0.02) discard;
  gl_FragColor = c;
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Layer
// ─────────────────────────────────────────────────────────────────────────────

type Disposable = { dispose(): void };

interface AtlasEntry {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Size of the entry in atlas pixels (at ATLAS_FONT_PX). */
  w: number;
  h: number;
}

const linear = (hex: string): THREE.Vector3 => {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
};

export class PlacesLayer {
  readonly group = new THREE.Group();
  private readonly shared: Record<string, THREE.IUniform>;
  private readonly hf: HeightField;
  private readonly zoneSink: ZoneSink | null;
  private readonly bounds: Bounds;
  private readonly registry = new Set<Disposable>();
  private readonly ribbonUniforms: Record<string, THREE.IUniform>;

  private ctx: ContextLayers | null = null;
  private job: Generator<void, void, void> | null = null;
  private deadline = Infinity;
  private generation = 0;
  private vis: PlacesLayers = { roads: true, fireTrails: true, homes: false, zones: false, placeNames: true };
  private meshes: { roads: THREE.Mesh | null; trails: THREE.Mesh | null; edges: THREE.Mesh | null; homes: THREE.Mesh | null; labels: THREE.Mesh | null } = {
    roads: null,
    trails: null,
    edges: null,
    homes: null,
    labels: null,
  };
  private gpuBytes = 0;
  private buildMs = 0;
  private fallbackArrival: THREE.Texture | null = null;
  private stage = 'roads';
  private stageStart = 0;
  private idleMs = 0;
  private idleFrom = 0;
  private stageMs: Record<string, number> = {};
  private longestSlice = 0;
  private changed = false;
  private disposed = false;

  // Labels.
  private candidates: LabelCandidate[] = [];
  private atlas = new Map<string, AtlasEntry>();
  private labelGeom: THREE.InstancedBufferGeometry | null = null;
  private labelAnchor = new Float32Array(MAX_LABELS_SHOWN * 3);
  private labelRect = new Float32Array(MAX_LABELS_SHOWN * 4);
  private labelSize = new Float32Array(MAX_LABELS_SHOWN * 3);
  private labelsShown = 0;
  private lastLabelTime = -1e9;
  private readonly sigNow = new Float64Array(15);
  private readonly sigLast = new Float64Array(15);
  private sigValid = false;
  private readonly tmpV = new THREE.Vector3();

  constructor(shared: Record<string, THREE.IUniform>, hf: HeightField, zoneSink: ZoneSink | null = null) {
    this.shared = shared;
    this.hf = hf;
    this.zoneSink = zoneSink;
    this.bounds = { xMin: hf.xMin, xMax: hf.xMax, yMin: hf.yMin, yMax: hf.yMax };
    this.group.name = 'places';

    const pick = <T>(k: string, d: T): THREE.IUniform => shared[k] ?? { value: d };
    this.ribbonUniforms = {
      uVex: pick('uVex', 1),
      uViewport: pick('uViewport', new THREE.Vector2(1, 1)),
      uDpr: pick('uDpr', 1),
      uNight: pick('uNight', 0),
      uClock: pick('uClock', 0),
      uTime: pick('uTime', 0),
      uBurnBand: pick('uBurnBand', 420),
      uHasFire: pick('uHasFire', 0),
      uFireXf: pick('uFireXf', new THREE.Vector4(0, 0, 1, 1)),
      uArrival: pick('uArrival', null),
      uExposure: pick('uExposure', 1),
      uFogColour: pick('uFogColour', new THREE.Color(0.7, 0.78, 0.88)),
      uFogDensity: pick('uFogDensity', 1 / 45000),
      uLift: { value: 0.35 },
      uFill: { value: STYLES.map((s) => linear(s.fill)) },
      uCase: { value: STYLES.map((s) => linear(s.casing)) },
      uPar: { value: STYLES.map((s) => new THREE.Vector4(s.minFillPx, s.casingM, s.casingPx, s.duty)) },
      uPar2: { value: STYLES.map((s) => new THREE.Vector4(s.dashMinPx, s.alpha, 0, 0)) },
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Replace the data (null = nothing drawn). Geometry is built in slices: call {@link pump} each frame. */
  setContext(ctx: ContextLayers | null): void {
    this.clear();
    this.ctx = ctx;
    this.generation++;
    if (ctx && !this.disposed) this.job = this.build(ctx, this.generation);
  }

  /**
   * Screen areas (CSS px from each edge) covered by UI panels: names are not placed under them, so the space left free
   * shows as many as fit.
   */
  setInsets(insets: { top?: number; right?: number; bottom?: number; left?: number }): void {
    this.insets = { top: insets.top ?? 0, right: insets.right ?? 0, bottom: insets.bottom ?? 0, left: insets.left ?? 0 };
    this.sigValid = false;
  }
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };

  /** Which layers are shown. Cheap: only toggles visibility. */
  setLayers(l: Partial<PlacesLayers>): void {
    const v = this.vis;
    this.vis = {
      roads: l.roads ?? v.roads,
      fireTrails: l.fireTrails ?? v.fireTrails,
      homes: l.homes ?? v.homes,
      zones: l.zones ?? v.zones,
      placeNames: l.placeNames ?? v.placeNames,
    };
    this.applyVisibility();
  }

  /** The data currently shown (null without context). */
  get context(): ContextLayers | null {
    return this.ctx;
  }

  get building(): boolean {
    return this.job !== null;
  }

  /** Run construction for at most `budgetMs`; true if something new became visible (a redraw is needed). */
  pump(budgetMs = 4): boolean {
    if (this.job) {
      const t0 = performance.now();
      if (this.idleFrom) this.idleMs += t0 - this.idleFrom;
      this.deadline = t0 + budgetMs;
      const r = this.job.next();
      const dt = performance.now() - t0;
      this.buildMs += dt;
      if (dt > this.longestSlice) this.longestSlice = dt;
      this.idleFrom = performance.now();
      if (r.done) {
        this.job = null;
        this.mark('done');
      }
    }
    const c = this.changed;
    this.changed = false;
    return c;
  }

  /** Finish all pending construction now (tests, screenshots). */
  flush(): void {
    while (this.job) {
      const t0 = performance.now();
      this.deadline = Infinity;
      const r = this.job.next();
      const dt = performance.now() - t0;
      this.buildMs += dt;
      if (dt > this.longestSlice) this.longestSlice = dt;
      if (r.done) {
        this.job = null;
        this.mark('done');
      }
    }
    this.changed = true;
  }

  /**
   * Choose which names to show for the current camera and update the label sprites. Throttled to 4× per second and
   * skipped while the view has not changed; returns true when the shown set changed (redraw needed).
   */
  updateLabels(camera: THREE.PerspectiveCamera, cssW: number, cssH: number, nowMs: number, force = false): boolean {
    const mesh = this.meshes.labels;
    if (!mesh || !this.vis.placeNames || this.candidates.length === 0) return false;
    const p = camera.position;
    const q = camera.quaternion;
    const vex = Number(this.shared.uVex?.value ?? 1);
    // View signature (camera pose, viewport, exaggeration, insets): recompute only when it changed. Numbers, not strings,
    // so an idle scene allocates nothing here.
    const n = this.sigNow;
    n[0] = p.x;
    n[1] = p.y;
    n[2] = p.z;
    n[3] = q.x;
    n[4] = q.y;
    n[5] = q.z;
    n[6] = q.w;
    n[7] = cssW;
    n[8] = cssH;
    n[9] = vex;
    n[10] = camera.fov;
    n[11] = this.insets.top;
    n[12] = this.insets.right;
    n[13] = this.insets.bottom;
    n[14] = this.insets.left;
    let same = !force && this.sigValid;
    for (let i = 0; same && i < n.length; i++) if (Math.abs(n[i]! - this.sigLast[i]!) > (i < 3 ? 0.05 : 1e-5)) same = false;
    if (same) return false;
    if (!force && nowMs - this.lastLabelTime < 250) return false;
    this.sigLast.set(n);
    this.sigValid = true;
    this.lastLabelTime = nowMs;
    return this.selectVisible(camera, cssW, cssH, vex);
  }

  stats(): PlacesStats {
    let calls = 0;
    let tris = 0;
    const m = this.meshes;
    for (const [key, mesh] of Object.entries(m) as [keyof typeof m, THREE.Mesh | null][]) {
      if (!mesh || !mesh.visible) continue;
      calls++;
      const g = mesh.geometry;
      if (key === 'homes') tris += ((g.index?.count ?? 0) / 3) * ((g as THREE.InstancedBufferGeometry).instanceCount || 0);
      else if (key === 'labels') tris += 2 * this.labelsShown;
      else tris += (g.index?.count ?? 0) / 3;
    }
    return {
      drawCalls: calls,
      triangles: tris,
      gpuBytes: this.gpuBytes,
      resources: this.registry.size,
      buildMs: this.buildMs,
      longestSliceMs: this.longestSlice,
      stageMs: { ...this.stageMs },
      building: this.job !== null,
      labelsShown: this.labelsShown,
      labelCandidates: this.candidates.length,
    };
  }

  /** Names currently drawn (tests, dev HUD). */
  shownLabels(): string[] {
    return this.shownText.slice();
  }
  private shownText: string[] = [];

  /** Live registered GPU objects: 0 after {@link dispose}. */
  get liveResources(): number {
    return this.registry.size;
  }
  /** The registered GPU objects (geometries, materials, textures) — for leak tests. */
  resourceList(): readonly { dispose(): void }[] {
    return [...this.registry];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.job = null;
    this.ctx = null;
  }

  // ── Construction ───────────────────────────────────────────────────────────

  private reg<T extends Disposable>(o: T, bytes = 0): T {
    this.registry.add(o);
    this.gpuBytes += bytes;
    return o;
  }

  /** Remove and dispose everything built for the previous data. */
  private clear(): void {
    this.job = null;
    for (const m of Object.values(this.meshes)) if (m) this.group.remove(m);
    this.meshes = { roads: null, trails: null, edges: null, homes: null, labels: null };
    for (const d of this.registry) d.dispose();
    this.registry.clear();
    if (this.fallbackArrival) {
      this.ribbonUniforms.uArrival!.value = null; // it was disposed with the rest: make a fresh one for the next build
      this.fallbackArrival = null;
    }
    this.gpuBytes = 0;
    this.candidates = [];
    this.atlas.clear();
    this.labelGeom = null;
    this.labelsShown = 0;
    this.shownText = [];
    this.sigValid = false;
    this.zoneSink?.setZones(null, null);
    this.buildMs = 0;
    this.longestSlice = 0;
    this.stageMs = {};
    this.stage = 'roads';
    this.stageStart = performance.now();
    this.idleMs = 0;
    this.idleFrom = 0;
    this.changed = true;
  }

  /** Close the current build stage in the timing table and start `next`. Time spent waiting between slices is excluded. */
  private mark(next: string): void {
    const now = performance.now();
    this.stageMs[this.stage] = (this.stageMs[this.stage] ?? 0) + Math.max(0, now - this.stageStart - this.idleMs);
    this.stage = next;
    this.stageStart = now;
    this.idleMs = 0;
  }

  private timeUp(): boolean {
    return performance.now() >= this.deadline;
  }

  private applyVisibility(): void {
    const m = this.meshes;
    if (m.roads) m.roads.visible = this.vis.roads;
    if (m.trails) m.trails.visible = this.vis.fireTrails;
    if (m.edges) m.edges.visible = this.vis.zones;
    if (m.homes) m.homes.visible = this.vis.homes;
    if (m.labels) m.labels.visible = this.vis.placeNames && this.labelsShown > 0;
    this.zoneSink?.setZonesVisible(this.vis.zones);
    this.changed = true;
  }

  private ribbonMaterial(name: string, lift: number): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.ribbonUniforms, uLift: { value: lift } },
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    mat.name = name;
    return this.reg(mat);
  }

  private ribbonMesh(name: string, d: RibbonMeshData, order: number, lift: number): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    const ib = new THREE.InterleavedBuffer(d.data, RIBBON_STRIDE);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    g.setAttribute('aOff', new THREE.InterleavedBufferAttribute(ib, 2, 3));
    g.setAttribute('aAcross', new THREE.InterleavedBufferAttribute(ib, 1, 5));
    g.setAttribute('aMeta', new THREE.InterleavedBufferAttribute(ib, 4, 6));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    this.reg(g, d.data.byteLength + d.index.byteLength);
    const mesh = new THREE.Mesh(g, this.ribbonMaterial(name, lift));
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.name = name;
    return mesh;
  }

  private add(key: keyof PlacesLayer['meshes'], mesh: THREE.Mesh): void {
    if (this.disposed) return;
    this.meshes[key] = mesh;
    this.group.add(mesh);
    this.applyVisibility();
  }

  /** The construction job: one generator, yielding whenever the time slice is used up. */
  private *build(ctx: ContextLayers, gen: number): Generator<void, void, void> {
    const hf = this.hf;
    const heightAt = (x: number, y: number): number => hf.heightAt(x, y);
    const b = this.bounds;
    const alive = (): boolean => gen === this.generation && !this.disposed;
    this.stage = 'roads';
    this.stageStart = performance.now();
    this.idleMs = 0;
    // Without a terrain layer's fire textures (tests) the ribbons still need a valid sampler.
    if (!this.ribbonUniforms.uArrival!.value) {
      this.fallbackArrival = this.reg(dummyFloat(1e30), 4);
      this.ribbonUniforms.uArrival!.value = this.fallbackArrival;
    }

    // ── Roads (widest classes last so they overdraw the small ones at junctions)
    {
      const rb = new RibbonBuilder();
      const order = ctx.roads.map((_, i) => i).sort((p, q) => roadStyleIndex(ctx.roads[q]!.cls) - roadStyleIndex(ctx.roads[p]!.cls) || p - q);
      let since = 0;
      for (const li of order) {
        const r = ctx.roads[li]!;
        const style = roadStyleIndex(r.cls);
        const { periodM } = roadDash(r.cls, r.surface);
        for (const piece of clipPolyline(r.xy, b)) rb.addLine(piece, heightAt, { style, widthM: ROAD_WIDTH_M[r.cls], periodM });
        since += r.xy.length >> 1;
        if (since > 400) {
          since = 0;
          if (this.timeUp()) yield;
          if (!alive()) return;
        }
      }
      if (rb.vertexCount > 0) this.add('roads', this.ribbonMesh('places-roads', rb.build(), 3, 0.3));
      this.changed = true;
      if (this.timeUp()) yield;
      if (!alive()) return;
    }

    // ── Fire trails
    this.mark('trails');
    {
      const rb = new RibbonBuilder();
      for (const t of ctx.fireTrails) {
        for (const piece of clipPolyline(t.xy, b)) rb.addLine(piece, heightAt, { style: FIRE_TRAIL_STYLE, widthM: FIRE_TRAIL_WIDTH_M, periodM: 26 });
      }
      if (rb.vertexCount > 0) this.add('trails', this.ribbonMesh('places-fire-trails', rb.build(), 4, 0.55));
      this.changed = true;
      if (this.timeUp()) yield;
      if (!alive()) return;
    }

    // ── Zones: outlines (mesh) and fill (texture for the terrain shader)
    this.mark('zones');
    if (ctx.zones.length > 0) {
      const rb = new RibbonBuilder();
      let since = 0;
      for (const z of ctx.zones) {
        const style = zoneStyleIndex(z.kind);
        for (const ring of z.rings) {
          if (ring.length < 6) continue;
          const closed = new Float32Array(ring.length + 2);
          closed.set(ring);
          closed[ring.length] = ring[0]!;
          closed[ring.length + 1] = ring[1]!;
          for (const piece of clipPolyline(closed, b)) {
            const isRing = piece.length >= 6 && piece[0] === piece[piece.length - 2] && piece[1] === piece[piece.length - 1];
            rb.addLine(piece, heightAt, { style, widthM: 0, periodM: 0, closed: isRing, maxStep: 25 });
          }
          since += ring.length >> 1;
        }
        if (since > 600) {
          since = 0;
          if (this.timeUp()) yield;
          if (!alive()) return;
        }
      }
      if (rb.vertexCount > 0) this.add('edges', this.ribbonMesh('places-zone-edges', rb.build(), 2, 0.25));
      const frame = zoneFrame(ctx.zones, b);
      if (frame && this.zoneSink) {
        const data = new Uint8Array(ZONE_TEX * ZONE_TEX * 4);
        for (let zi = 0; zi < ctx.zones.length; ) {
          const to = Math.min(ctx.zones.length, zi + 1);
          rasterizeZones(ctx.zones, frame, ZONE_TEX, data, zi, to);
          zi = to;
          if (this.timeUp()) yield;
          if (!alive()) return;
        }
        const tex = new THREE.DataTexture(data, ZONE_TEX, ZONE_TEX, THREE.RGBAFormat, THREE.UnsignedByteType);
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.flipY = false;
        tex.needsUpdate = true;
        this.reg(tex, Math.round(data.byteLength * 1.34));
        this.zoneSink.setZones(tex, frame, this.vis.zones);
      }
      this.changed = true;
      if (this.timeUp()) yield;
      if (!alive()) return;
    }

    // ── Homes
    this.mark('homes');
    if (ctx.homes.length >= 2) {
      const n = ctx.homes.length >> 1;
      const acc = { data: new Float32Array((n + 1) * 4), n: 0 };
      for (let i = 0; i < n; i += 1500) {
        homeInstances(ctx.homes, b, heightAt, i, Math.min(n, i + 1500), acc);
        if (this.timeUp()) yield;
        if (!alive()) return;
      }
      if (acc.n > 0) {
        const hg = houseGeometry();
        const g = new THREE.InstancedBufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(hg.position, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(hg.normal, 3));
        g.setAttribute('aPart', new THREE.BufferAttribute(hg.part, 1));
        g.setIndex(new THREE.BufferAttribute(hg.index, 1));
        const inst = new THREE.InstancedBufferAttribute(acc.data.slice(0, acc.n * 4), 4);
        g.setAttribute('aInst', inst);
        g.instanceCount = acc.n;
        this.reg(g, acc.n * 16 + hg.position.byteLength + hg.normal.byteLength + hg.part.byteLength + hg.index.byteLength);
        const sh = this.shared;
        const mat = new THREE.ShaderMaterial({
          uniforms: {
            uVex: this.ribbonUniforms.uVex!,
            uViewport: this.ribbonUniforms.uViewport!,
            uDpr: this.ribbonUniforms.uDpr!,
            uNight: this.ribbonUniforms.uNight!,
            uExposure: this.ribbonUniforms.uExposure!,
            uFogColour: this.ribbonUniforms.uFogColour!,
            uFogDensity: this.ribbonUniforms.uFogDensity!,
            uSunDir: sh.uSunDir ?? { value: new THREE.Vector3(0.3, 0.8, -0.4).normalize() },
            uSunColour: sh.uSunColour ?? { value: new THREE.Color(1, 0.95, 0.88) },
            uSunI: sh.uSunI ?? { value: 2.6 },
            uSkyAmb: sh.uSkyAmb ?? { value: new THREE.Color(0.5, 0.6, 0.8) },
            uGroundAmb: sh.uGroundAmb ?? { value: new THREE.Color(0.3, 0.26, 0.2) },
            uAmbI: sh.uAmbI ?? { value: 0.65 },
            uDotPx: { value: 3.5 },
            uFar: { value: 12000 },
            uWall: { value: linear('#f7e2b4') },
            uRoof: { value: linear('#b9532a') },
            uDotCol: { value: linear('#ffe49a') },
          },
          vertexShader: HOME_VERT,
          fragmentShader: HOME_FRAG,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        mat.name = 'places-homes';
        this.reg(mat);
        const mesh = new THREE.Mesh(g, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        mesh.name = 'places-homes';
        this.add('homes', mesh);
      }
      this.changed = true;
      if (this.timeUp()) yield;
      if (!alive()) return;
    }

    // ── Names
    this.mark('names');
    this.candidates = buildLabelCandidates(ctx, b);
    if (typeof document !== 'undefined' && this.candidates.length > 0) {
      yield* this.buildLabels(alive);
    }
    this.changed = true;
  }

  private *buildLabels(alive: () => boolean): Generator<void, void, void> {
    // Unique (kind, text) pairs, most important first, capped.
    const uniq = new Map<string, { text: string; kind: LabelKind }>();
    const ranked = this.candidates.slice().sort((a, c) => LABEL_STYLES[c.kind].priority - LABEL_STYLES[a.kind].priority);
    for (const c of ranked) {
      const k = `${c.kind}|${c.text}`;
      if (!uniq.has(k) && uniq.size < MAX_ATLAS_LABELS) uniq.set(k, { text: c.text, kind: c.kind });
    }
    const cv = document.createElement('canvas');
    const W = 1024;
    // Layout first (measure with a scratch context), then size the canvas.
    const g0 = cv.getContext('2d');
    if (!g0) return;
    const fontFor = (kind: LabelKind): string => `${LABEL_STYLES[kind].bold ? '700' : '600'} ${ATLAS_FONT_PX}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const rowH = ATLAS_FONT_PX + 2 * ATLAS_PAD + 4;
    const placed: { key: string; kind: LabelKind; text: string; x: number; y: number; w: number }[] = [];
    let x = 0;
    let y = 0;
    for (const [key, u] of uniq) {
      g0.font = fontFor(u.kind);
      const w = Math.ceil(g0.measureText(u.text).width) + 2 * ATLAS_PAD;
      if (x + w > W) {
        x = 0;
        y += rowH;
      }
      placed.push({ key, kind: u.kind, text: u.text, x, y, w });
      x += w;
      if (this.timeUp()) yield;
      if (!alive()) return;
    }
    const H = Math.min(2048, Math.max(64, 2 ** Math.ceil(Math.log2(y + rowH))));
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.lineJoin = 'round';
    for (const p of placed) {
      if (p.y + rowH > H) continue;
      const st = LABEL_STYLES[p.kind];
      g.font = fontFor(p.kind);
      const cx = p.x + ATLAS_PAD;
      const cy = p.y + rowH / 2;
      g.lineWidth = 7;
      g.strokeStyle = 'rgba(8,16,26,0.92)';
      g.strokeText(p.text, cx, cy);
      g.fillStyle = st.colour;
      g.fillText(p.text, cx, cy);
      this.atlas.set(p.key, { u0: p.x / W, v0: p.y / H, u1: (p.x + p.w) / W, v1: (p.y + rowH) / H, w: p.w, h: rowH });
      if (this.timeUp()) yield;
      if (!alive()) return;
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    this.reg(tex, Math.round(W * H * 4 * 1.34));

    const geom = new THREE.InstancedBufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geom.setIndex([0, 1, 2, 0, 2, 3]);
    geom.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(this.labelAnchor, 3));
    geom.setAttribute('aRect', new THREE.InstancedBufferAttribute(this.labelRect, 4));
    geom.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.labelSize, 3));
    geom.instanceCount = 0;
    this.reg(geom, this.labelAnchor.byteLength + this.labelRect.byteLength + this.labelSize.byteLength + 64);
    this.labelGeom = geom;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uVex: this.ribbonUniforms.uVex!,
        uViewport: this.ribbonUniforms.uViewport!,
        uDpr: this.ribbonUniforms.uDpr!,
        uNight: this.ribbonUniforms.uNight!,
        uAtlas: { value: tex },
      },
      vertexShader: LABEL_VERT,
      fragmentShader: LABEL_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    mat.name = 'places-labels';
    this.reg(mat);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 19;
    mesh.name = 'places-labels';
    mesh.visible = false;
    this.add('labels', mesh);
  }

  /** Screen-space label selection; returns true when the shown set changed. */
  private selectVisible(camera: THREE.PerspectiveCamera, cssW: number, cssH: number, vex: number): boolean {
    camera.updateMatrixWorld();
    const cam = camera.position;
    const hf = this.hf;
    const heightAt = (x: number, y: number): number => hf.heightAt(x, y);
    const items: ScreenItem[] = [];
    const meta: { cand: LabelCandidate; entry: AtlasEntry; z: number; wPx: number; hPx: number; alpha: number }[] = [];
    const groups = new Map<string, number>();
    const v = this.tmpV;
    for (const c of this.candidates) {
      const entry = this.atlas.get(`${c.kind}|${c.text}`);
      if (!entry) continue;
      const st = LABEL_STYLES[c.kind];
      const z = hf.heightAt(c.x, c.y);
      // World position of the anchor (a little above the ground so the label is not inside the slope).
      const wy = z * vex + 6;
      const dist = Math.hypot(c.x - cam.x, wy - cam.y, -c.y - cam.z);
      if (dist > st.range) continue;
      v.set(c.x, wy, -c.y).project(camera);
      if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02) continue;
      const alpha = 1 - smooth(st.range * 0.72, st.range, dist);
      if (alpha < 0.05) continue;
      const scale = Math.min(1.3, Math.max(0.8, Math.pow(1800 / Math.max(dist, 50), 0.32)));
      const fontPx = st.sizePx * scale;
      const k = fontPx / ATLAS_FONT_PX;
      const wPx = entry.w * k;
      const hPx = entry.h * k;
      const sx = (v.x * 0.5 + 0.5) * cssW;
      const sy = (0.5 - v.y * 0.5) * cssH;
      const ins = this.insets;
      if (sx < ins.left || sx > cssW - ins.right || sy < ins.top || sy > cssH - ins.bottom) continue; // under a panel
      // Behind a hill: hidden.
      if (!lineOfSightClear(heightAt, vex, [cam.x, -cam.z, cam.y], [c.x, c.y, wy], 60, 40)) continue;
      const centre = 1 - Math.min(1, Math.hypot(v.x, v.y) / 1.4);
      let gid = groups.get(c.group);
      if (gid === undefined) groups.set(c.group, (gid = groups.size));
      items.push({ x: sx, y: sy, w: wPx, h: hPx, priority: st.priority + 4 * centre, group: gid });
      meta.push({ cand: c, entry, z, wPx, hPx, alpha });
    }
    const sel = selectLabels(items, MAX_LABELS_SHOWN, 5, 280);
    const texts: string[] = [];
    for (let s = 0; s < sel.length; s++) {
      const m = meta[sel[s]!]!;
      this.labelAnchor[s * 3] = m.cand.x;
      this.labelAnchor[s * 3 + 1] = m.cand.y;
      this.labelAnchor[s * 3 + 2] = m.z + 6 / Math.max(vex, 0.2);
      this.labelRect[s * 4] = m.entry.u0;
      this.labelRect[s * 4 + 1] = m.entry.v0;
      this.labelRect[s * 4 + 2] = m.entry.u1;
      this.labelRect[s * 4 + 3] = m.entry.v1;
      this.labelSize[s * 3] = m.wPx;
      this.labelSize[s * 3 + 1] = m.hPx;
      this.labelSize[s * 3 + 2] = m.alpha;
      texts.push(m.cand.text);
    }
    const geom = this.labelGeom;
    if (!geom) return false;
    geom.instanceCount = sel.length;
    for (const name of ['aAnchor', 'aRect', 'aSize']) geom.getAttribute(name).needsUpdate = true;
    this.labelsShown = sel.length;
    if (this.meshes.labels) this.meshes.labels.visible = this.vis.placeNames && sel.length > 0;
    this.shownText = texts;
    return true; // positions and sizes follow the camera: redraw once after every recompute
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
