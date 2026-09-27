/**
 * Batched screen-space streaks and arrows: one instanced quad per segment, expanded to a constant pixel width in the
 * vertex shader (WebGL lines are 1 px, which vanishes on high-DPR phones in sunlight). One draw call per batch.
 * Used for wind particles, ember trails and the cross-section wind vectors.
 */
import * as THREE from 'three';
import { FOG, TONEMAP } from './glsl';

const STREAK_VERT = /* glsl */ `
uniform vec2 uViewport;
uniform float uWidthPx;
uniform float uHeadPx;
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aC;
varying vec4 vC;
varying vec2 vUv;
varying float vLenPx;
varying float vDist;
void main() {
  vec4 ca = projectionMatrix * viewMatrix * vec4(aA, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(aB, 1.0);
  vDist = cb.w;
  if (ca.w <= 0.01 || cb.w <= 0.01 || aC.a <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec2 sa = ca.xy / ca.w * uViewport * 0.5;
  vec2 sb = cb.xy / cb.w * uViewport * 0.5;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  // position.x: 0 tail … 1 head; position.y: −1 … 1 across. Heads extend by uHeadPx for arrows.
  float ext = uHeadPx > 0.0 ? uHeadPx : 0.0;
  float halfW = uHeadPx > 0.0 ? max(uWidthPx, uHeadPx * 0.55) : uWidthPx * 0.5 + 1.0;
  vec4 c = mix(ca, cb, position.x);
  vec2 off = nrm * position.y * halfW + dir * (position.x * ext - (1.0 - position.x) * 1.0);
  c.xy += off / (uViewport * 0.5) * c.w;
  gl_Position = c;
  vC = aC;
  vLenPx = len + ext;
  vUv = vec2(position.x * vLenPx, position.y * halfW);
}
`;

const STREAK_FRAG = /* glsl */ `
${TONEMAP}
${FOG}
uniform float uWidthPx;
uniform float uHeadPx;
uniform float uTailAlpha;
uniform float uFog;
uniform float uOutline;
varying vec4 vC;
varying vec2 vUv;
varying float vLenPx;
varying float vDist;
void main() {
  float along = vUv.x;             // px from tail
  float across = abs(vUv.y);       // px from axis
  float a;
  if (uHeadPx > 0.0) {
    float shaftEnd = vLenPx - uHeadPx;
    float shaft = (1.0 - smoothstep(uWidthPx * 0.5 - 0.5, uWidthPx * 0.5 + 0.5, across)) * step(along, shaftEnd + 0.5);
    float hx = (along - shaftEnd) / uHeadPx; // 0 … 1 along the head
    float headHalf = (1.0 - hx) * uHeadPx * 0.55;
    float head = (hx >= 0.0 && hx <= 1.0) ? 1.0 - smoothstep(headHalf - 0.6, headHalf + 0.6, across) : 0.0;
    a = max(shaft, head);
  } else {
    float t = clamp(along / max(vLenPx, 1.0), 0.0, 1.0);
    a = (1.0 - smoothstep(uWidthPx * 0.5 - 0.6, uWidthPx * 0.5 + 0.6, across)) * mix(uTailAlpha, 1.0, t * t);
  }
  a *= vC.a;
  if (a < 0.01) discard;
  vec3 ldr = vC.rgb;
  // Optional dark outline (legibility on bright ground, doc 09 §9): the outer ~1 px of the stroke is darkened.
  if (uOutline > 0.5) ldr *= mix(1.0, 0.18, smoothstep(uWidthPx * 0.5 - 1.6, uWidthPx * 0.5 - 0.4, across));
  if (uFog > 0.5) ldr = fsFog(ldr, vDist);
  gl_FragColor = vec4(ldr, a);
  #include <colorspace_fragment>
}
`;

export interface StreakOptions {
  capacity: number;
  widthPx: number;
  /** Arrow head length in px (0 = plain streak fading towards the tail). */
  headPx?: number;
  /** Alpha at the tail of plain streaks (default 0). */
  tailAlpha?: number;
  additive?: boolean;
  depthTest?: boolean;
  fog?: boolean;
  /** Darken the outer pixel of plain streaks (legibility on bright backgrounds). */
  outline?: boolean;
  shared: Record<string, THREE.IUniform>;
}

export class StreakBatch {
  readonly mesh: THREE.Mesh;
  readonly a: Float32Array;
  readonly b: Float32Array;
  /** Colour in DISPLAY space (sRGB-linear after tone mapping, 0–1) + alpha. */
  readonly c: Float32Array;
  private readonly geom: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly attrA: THREE.InstancedBufferAttribute;
  private readonly attrB: THREE.InstancedBufferAttribute;
  private readonly attrC: THREE.InstancedBufferAttribute;
  readonly capacity: number;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(o: StreakOptions) {
    this.capacity = o.capacity;
    this.a = new Float32Array(o.capacity * 3);
    this.b = new Float32Array(o.capacity * 3);
    this.c = new Float32Array(o.capacity * 4);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.attrA = new THREE.InstancedBufferAttribute(this.a, 3).setUsage(THREE.DynamicDrawUsage);
    this.attrB = new THREE.InstancedBufferAttribute(this.b, 3).setUsage(THREE.DynamicDrawUsage);
    this.attrC = new THREE.InstancedBufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aA', this.attrA);
    g.setAttribute('aB', this.attrB);
    g.setAttribute('aC', this.attrC);
    g.instanceCount = 0;
    this.geom = g;
    this.uniforms = {
      uViewport: o.shared.uViewport!,
      uExposure: o.shared.uExposure!,
      uFogColour: o.shared.uFogColour!,
      uFogDensity: o.shared.uFogDensity!,
      uWidthPx: { value: o.widthPx },
      uHeadPx: { value: o.headPx ?? 0 },
      uTailAlpha: { value: o.tailAlpha ?? 0 },
      uFog: { value: o.fog === false ? 0 : 1 },
      uOutline: { value: o.outline ? 1 : 0 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: o.depthTest ?? true,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
  }

  /** Upload the first `count` segments. */
  commit(count: number): void {
    const n = Math.min(count, this.capacity);
    this.geom.instanceCount = n;
    for (let a = 0; a < 3; a++) {
      const at = a === 0 ? this.attrA : a === 1 ? this.attrB : this.attrC;
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * at.itemSize);
      at.needsUpdate = true;
    }
  }

  set widthPx(v: number) {
    this.uniforms.uWidthPx!.value = v;
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
  }
}
