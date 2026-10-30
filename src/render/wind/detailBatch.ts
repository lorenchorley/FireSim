/**
 * The detailed wind streaks of the most detailed level (0.6.0): one instanced quad per segment of a traced line, animated entirely on the
 * GPU. The CPU builds the lines once per rebuild (render/wind/detailStreaks.ts, in flat arrays) and never touches them again; what moves is a
 * pure function of the clock `uTime` (the view's `uClock`), so a still camera costs the frame loop nothing but the draw.
 *
 *  - a pulse travels each line: a bright, thick head with a tail that thins and fades, born at a random phase, with its own lifetime and a
 *    dead gap before the next one (per line, from the line's seed: the same line always keeps the same rhythm, so a rebuild changes nothing);
 *  - the lines meander: a time-varying noise shifts every vertex sideways, in three octaves (60 m, 15 m and 4 m wavelength) of which a
 *    finer one fades in only when its amplitude would be about a pixel, so more eddies appear the closer you zoom. The shift is a function
 *    of the vertex alone (never of its segment), so two segments that share an end agree on it and the line stays joined;
 *  - a gust band, a brightness envelope of about 120 m that travels along the line, and a slightly brighter windward slope (`lift`);
 *  - the colour is the model's speed as the glyph builder baked it (display-linear in `aC`); nothing here ever changes a colour.
 * No texture is read and no extension is needed: the shaders use only what the neighbouring streak batch does (WebGL1 is enough).
 *
 * Per segment, flat typed arrays (the builder's `DetailOutput`): `a`, `b` the world ends (y exaggerated and lifted), `c` colour rgb and alpha 1,
 * `d` (`s0`, `s1` arc length in px, `L` the line's length in px, `seed` 0..1), `e` (`speed` of the line in m/s, `turb`, `lift`, `tail` in px).
 * The stroke is drawn like the glyphs': the colour on a dark navy ring so the pale stops of the wind ramp read on every ground, tested for
 * depth as if `depthBiasM` metres nearer the eye (a crown of trees does not hide it, a ridge does).
 */
import * as THREE from 'three';
import { HALO_INK } from './flowGlyphs';

/** The colour stroke of a streak at its head, in CSS pixels (baked at the device pixel ratio by `widthPx`). First guess, to be tuned on a phone. */
export const DETAIL_WIDTH_PX = 3.2;
/** The depth bias of the glyph strokes, the same: 40 m toward the eye. */
export const DETAIL_DEPTH_BIAS_M = 40;
/** The frame a still batch (reduced motion) is drawn at: a time at which most lines carry a pulse. */
export const DETAIL_STILL_TIME_S = 3.7;

const f5 = (v: number): string => v.toFixed(5);

/** The pulse of a line and its timing as plain scalar GLSL, shared by both stages and read by the shader text tests as a mirror of the TS rules. */
export const DETAIL_PULSE_GLSL = /* glsl */ `
float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// How far the head of a line's pulse has got, in px along the line, at time t. The cycle is +/-30 % of the time the pulse takes to cross
// the line and its tail at 14 px per m/s (40 to 260 px/s), from a random phase, with a dead gap of 0 to 60 % before the next one.
float lineHead(float t, float seed, float L, float tail, float speed) {
  float vpx = clamp(14.0 * speed, 40.0, 260.0);
  float life = L + tail;
  float T = life / vpx * (0.7 + 0.6 * h21(vec2(seed * 91.7, 3.1)));
  float gap = 0.6 * h21(vec2(seed * 53.3, 7.7));
  float ph = fract(t / T + h21(vec2(seed * 17.9, 1.3)));
  return ph * (1.0 + gap) * life;
}
// The brightness of a point s px along the line: 1 at the head, 0 a tail's length behind it, 0 ahead of it.
float pulse(float s, float head, float tail) {
  return s <= head ? clamp(1.0 - (head - s) / tail, 0.0, 1.0) : 0.0;
}
`;

const DETAIL_VERT = /* glsl */ `
uniform float uTime;
uniform float uMoving;
uniform float uFade;
uniform float uWidthPx;
uniform float uPxPerM1;
uniform vec2 uViewport;
uniform float uDepthBias;
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aC;
attribute vec4 aD;
attribute vec4 aE;
varying vec3 vC;
varying vec2 vUv;
varying float vLen;
varying float vAlpha;
varying vec3 vPulse;

const float STILL_TIME = ${f5(DETAIL_STILL_TIME_S)};
const float HALO_RING = 0.4;

${DETAIL_PULSE_GLSL}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 vn2(vec2 p) {
  return vec2(vn(p), vn(p + vec2(31.7, 17.3))) - 0.5;
}
// The meander at a ground point: three octaves of drifting value noise, in metres. An octave counts only as far as it would show: its weight
// rises from 0 at 0.75 px of amplitude to 1 at 3 px (pxPerM is the pixels a metre covers at the point's depth).
vec2 meander(vec2 p, float pxPerM, float t) {
  vec2 o = vec2(0.0);
  float w0 = smoothstep(0.75, 3.0, 20.0 * pxPerM);
  float w1 = smoothstep(0.75, 3.0, 5.0 * pxPerM);
  float w2 = smoothstep(0.75, 3.0, 1.2 * pxPerM);
  if (w0 > 0.0) o += vn2(p / 60.0 + vec2(0.05, 0.07) * t) * (40.0 * w0);
  if (w1 > 0.0) o += vn2(p / 15.0 + vec2(0.10, 0.14) * t) * (10.0 * w1);
  if (w2 > 0.0) o += vn2(p / 4.0 + vec2(0.15, 0.21) * t) * (2.4 * w2);
  return o;
}
// The gust band at a point of a line: 0.85 to 1.15, a wave of about 120 m along the line that travels with time, its phase nudged by position.
float gust(float alongM, vec2 p, float t) {
  return 0.85 + 0.15 * (1.0 + sin(6.2831853 * (alongM / 120.0 - t / 4.0 + 0.8 * vn(p / 300.0))));
}
// Depth of a point slid toward the eye by uDepthBias metres along its own ray (the place on the screen does not change).
float biasedDepth(vec3 p) {
  vec3 v = (viewMatrix * vec4(p, 1.0)).xyz;
  float l = length(v);
  vec4 b = projectionMatrix * vec4(v * (1.0 - min(uDepthBias, 0.5 * l) / l), 1.0);
  return b.z / b.w;
}

void main() {
  float t = uMoving > 0.5 ? uTime : STILL_TIME;
  float tail = max(aE.w, 1.0);
  float head = lineHead(t, aD.w, aD.z, tail, aE.x);
  float ia = pulse(aD.x, head, tail);
  float ib = pulse(aD.y, head, tail);
  vec4 ca0 = projectionMatrix * viewMatrix * vec4(aA, 1.0);
  vec4 cb0 = projectionMatrix * viewMatrix * vec4(aB, 1.0);
  // Nothing of this segment shows (the pulse is not on it, the batch is faded out, or an end is behind the eye): drawn off the screen.
  if (uFade <= 0.0 || aC.a <= 0.0 || (ia <= 0.0 && ib <= 0.0) || ca0.w <= 0.01 || cb0.w <= 0.01) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float pxA = uPxPerM1 / ca0.w;
  float pxB = uPxPerM1 / cb0.w;
  float turbF = 0.25 + 0.75 * aE.y;
  vec3 pa = aA;
  vec3 pb = aB;
  pa.xz += meander(aA.xz, pxA, t) * turbF;
  pb.xz += meander(aB.xz, pxB, t) * turbF;
  vec4 ca = projectionMatrix * viewMatrix * vec4(pa, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(pb, 1.0);
  if (ca.w <= 0.01 || cb.w <= 0.01) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float za = 0.0;
  float zb = 0.0;
  if (uDepthBias > 0.0) {
    za = biasedDepth(pa);
    zb = biasedDepth(pb);
  }
  vec2 sa = ca.xy / ca.w * uViewport * 0.5;
  vec2 sb = cb.xy / cb.w * uViewport * 0.5;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  // position.x: 0 at the tail end of the segment, 1 at the head end; position.y: -1 to 1 across. The quad is as wide as the thickest part of
  // the stroke and its ring; the fragment shader cuts the taper out of it.
  float reach = 0.5 * uWidthPx * (1.0 + 2.0 * HALO_RING) + 1.5;
  vec4 c = mix(ca, cb, position.x);
  vec2 off = nrm * position.y * reach + dir * (position.x * 2.0 - 1.0); // a pixel either way along the line, so the joins close
  c.xy += off / (uViewport * 0.5) * c.w;
  gl_Position = c;
  if (uDepthBias > 0.0) gl_Position.z = mix(za, zb, position.x) * c.w;
  float ext = 1.0 / max(len, 1.0);
  float lift = 1.0 + 0.12 * aE.z; // windward slopes a little brighter, lee slopes a little dimmer
  float gA = gust(aD.x / pxA, aA.xz, t);
  float gB = gust(aD.y / pxB, aB.xz, t);
  vC = aC.rgb;
  vAlpha = mix(gA, gB, position.x) * lift * uFade;
  vLen = len;
  vUv = vec2(mix(-1.0, len + 1.0, position.x), position.y * reach);
  vPulse = vec3(mix(aD.x, aD.y, mix(-ext, 1.0 + ext, position.x)), head, tail);
}
`;

const DETAIL_FRAG = /* glsl */ `
uniform float uWidthPx;
varying vec3 vC;
varying vec2 vUv;
varying float vLen;
varying float vAlpha;
varying vec3 vPulse;

const vec3 HALO_INK = vec3(${f5(HALO_INK[0])}, ${f5(HALO_INK[1])}, ${f5(HALO_INK[2])});
const float HALO_ALPHA = 0.6;
const float HALO_RING = 0.4;
const float TAIL_WIDTH = 0.45;

void main() {
  // The pulse is worked out per pixel from the line's own arc length: the head is as crisp as a pixel whatever the segments' length.
  float behind = vPulse.y - vPulse.x;
  float tailI = clamp(1.0 - behind / vPulse.z, 0.0, 1.0);
  float inten = tailI * clamp(behind + 0.5, 0.0, 1.0);
  float taper = mix(TAIL_WIDTH, 1.0, tailI);
  float halfW = 0.5 * uWidthPx * taper;
  float ring = HALO_RING * uWidthPx * taper;
  float across = abs(vUv.y);
  float core = 1.0 - smoothstep(halfW - 0.5, halfW + 0.5, across);
  float halo = (1.0 - smoothstep(halfW + ring - 0.5, halfW + ring + 0.5, across)) * HALO_ALPHA;
  float a = max(core, halo) * inten * vAlpha;
  // Two neighbouring segments both cover the pixel either side of their join: each gives the share that makes the pair add up to one.
  if (vUv.x < 1.0 || vUv.x > vLen - 1.0) a = 1.0 - sqrt(max(1.0 - a, 0.0));
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(HALO_INK, vC, core), a);
  #include <colorspace_fragment>
}
`;

export class DetailBatch {
  readonly mesh: THREE.Mesh;
  readonly a: Float32Array;
  readonly b: Float32Array;
  readonly c: Float32Array;
  readonly d: Float32Array;
  readonly e: Float32Array;
  readonly capacity: number;
  private readonly geom: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(o: { capacity: number; widthPx: number; depthBiasM: number; shared: Record<string, THREE.IUniform> }) {
    this.capacity = o.capacity;
    this.a = new Float32Array(o.capacity * 3);
    this.b = new Float32Array(o.capacity * 3);
    this.c = new Float32Array(o.capacity * 4);
    this.d = new Float32Array(o.capacity * 4);
    this.e = new Float32Array(o.capacity * 4);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const arrays: [string, Float32Array, number][] = [
      ['aA', this.a, 3],
      ['aB', this.b, 3],
      ['aC', this.c, 4],
      ['aD', this.d, 4],
      ['aE', this.e, 4],
    ];
    this.attrs = arrays.map(([name, array, size]) => {
      const at = new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, at);
      return at;
    });
    g.instanceCount = 0;
    this.geom = g;
    this.uniforms = {
      uTime: o.shared.uClock ?? { value: 0 }, // the view's clock (SceneView's `uClock`): the one thing that moves the streaks
      uMoving: { value: 1 },
      uFade: { value: 1 },
      uWidthPx: { value: o.widthPx },
      uPxPerM1: { value: 1 },
      uViewport: o.shared.uViewport!,
      uDepthBias: { value: o.depthBiasM },
    };
    // Plain alpha blending, no fog and no tone mapping (the colours are the legend's), the depth tested but never written.
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: DETAIL_VERT,
      fragmentShader: DETAIL_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = 'wind-detail';
    this.mesh.visible = false;
  }

  /** Upload the first `n` segments. */
  commit(n: number): void {
    const count = Math.min(n, this.capacity);
    this.geom.instanceCount = count;
    for (const at of this.attrs) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, count * at.itemSize);
      at.needsUpdate = true;
    }
  }

  /** `false` draws the frozen frame (reduced motion). */
  setMoving(on: boolean): void {
    this.uniforms.uMoving!.value = on ? 1 : 0;
  }

  /** 0 to 1: the fade of the whole batch on entering and leaving the level. */
  setFade(f: number): void {
    this.uniforms.uFade!.value = f;
  }

  /** Pixels one metre covers at distance 1 (`css.h / (2 tan(fov / 2))`). */
  setPxPerM1(v: number): void {
    this.uniforms.uPxPerM1!.value = v;
  }

  /** Stroke width in device pixels (the CSS width times the pixel ratio). */
  set widthPx(v: number) {
    this.uniforms.uWidthPx!.value = v;
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
  }
}
