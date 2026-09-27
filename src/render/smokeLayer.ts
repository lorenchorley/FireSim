/**
 * Smoke and plume as instanced soft billboards ("puffs"), one draw call, sorted back-to-front.
 *
 * With an atmosphere, puffs are drawn at 3-D cells whose smoke concentration exceeds a threshold, sampled in
 * proportion to concentration (≤ 1 500 puffs), with opacity by concentration and a warm underside glow where the air is
 * hot (theta anomaly) — so the plume tilts with the modelled wind and pools under inversions. Without an atmosphere, a
 * plume column rises from the most intense part of the fire and bends over with the ambient wind (stronger fires rise
 * higher before bending). Consecutive snapshots cross-fade (old puffs fade out while new ones fade in).
 *
 * Raymarching a Data3DTexture would look softer but costs pixels × steps on a fill-rate-bound phone GPU; billboards
 * cost ~2 triangles per puff and scale with the plume size instead of the screen size.
 */
import * as THREE from 'three';
import type { AtmosphereView } from '../core/types';
import { profileFactor, type AtmosphereSampler } from './atmosphereSampler';
import { hash01 } from './fields';
import { NOISE, TONEMAP, FOG } from './glsl';

const SMOKE_VERT = /* glsl */ `
uniform float uVex;
uniform float uMix;
uniform float uClock;
attribute vec4 aPuff;   // x, y, z ASL, radius (m)
attribute vec4 aProps;  // alpha, rand, generation (0 old / 1 new), heat
varying vec2 vUv;
varying float vAlpha;
varying float vRand;
varying float vHeat;
varying float vDist;
varying float vUp;
void main() {
  float gen = aProps.z;
  float a = aProps.x * (gen > 0.5 ? uMix : 1.0 - uMix);
  if (a <= 0.002) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec3 c = vec3(aPuff.x, aPuff.z * uVex, -aPuff.y);
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float ang = aProps.y * 6.2831853 + uClock * 0.03 * (aProps.y - 0.5);
  float cs = cos(ang);
  float sn = sin(ang);
  vec2 q = vec2(cs * position.x - sn * position.y, sn * position.x + cs * position.y);
  float r = aPuff.w * (1.0 + 0.04 * sin(uClock * 0.5 + aProps.y * 20.0));
  mv.xy += q * r;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vUp = position.y;
  vAlpha = a;
  vRand = aProps.y;
  vHeat = aProps.w;
}
`;

const SMOKE_FRAG = /* glsl */ `
${NOISE}
${TONEMAP}
${FOG}
uniform vec3 uSunColour; uniform float uSunI; uniform vec3 uSkyAmb; uniform float uAmbI; uniform float uNight;
uniform float uClock;
uniform float uAlphaScale;
varying vec2 vUv;
varying float vAlpha;
varying float vRand;
varying float vHeat;
varying float vDist;
varying float vUp;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float n = fsFbm(vUv * 1.7 + vec2(vRand * 31.0, uClock * 0.05));
  float dens = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.55);
  if (dens <= 0.01) discard;
  // Light from above-ish: tops brighter than bottoms; night smoke lit from below by the fire.
  float lit = 0.45 + 0.55 * clamp(vUp * 0.7 + 0.5 + (n - 0.5) * 0.5, 0.0, 1.0);
  vec3 smokeC = vec3(0.5, 0.47, 0.44);
  vec3 col = smokeC * (uSunColour * uSunI * 0.75 * lit + uSkyAmb * uAmbI * 1.4 * (0.7 + 0.3 * lit)) / LIGHT_REF;
  float under = clamp(0.5 - vUp * 0.5, 0.0, 1.0);
  vec3 ldr = fsDisplay(col) + fsTonemap(vec3(1.0, 0.36, 0.1) * vHeat * vHeat * under * (0.12 + 0.45 * uNight));
  ldr = fsFog(ldr, vDist);
  gl_FragColor = vec4(ldr, dens * vAlpha * uAlphaScale);
  #include <colorspace_fragment>
}
`;

/** Smoke concentration (atmosphere units) drawn at the full puff opacity; override with SceneViewOptions.smokeReference. */
export const SMOKE_REFERENCE = 1;

export interface Puff {
  x: number;
  y: number;
  z: number;
  radius: number;
  alpha: number;
  heat: number;
  rand: number;
}

/** Puffs for the atmosphere's smoke field (≤ max, deterministic). */
export function puffsFromAtmosphere(atm: AtmosphereView, base: number, max = 1500, reference = SMOKE_REFERENCE): Puff[] {
  const g = atm.grid;
  const plane = g.nx * g.ny;
  const n = plane * atm.nz;
  let maxC = 0;
  for (let k = 0; k < n; k++) if (atm.smoke[k]! > maxC) maxC = atm.smoke[k]!;
  if (maxC <= 0) return [];
  const thr = maxC * 0.02;
  let sum = 0;
  for (let k = 0; k < n; k++) if (atm.smoke[k]! > thr) sum += atm.smoke[k]!;
  const out: Puff[] = [];
  // Opacity is relative to an absolute reference so a small plume stays faint (not normalised by its own maximum).
  const cRef = Math.max(maxC * 0.35, reference);
  for (let k = 0; k < n && out.length < max; k++) {
    const c = atm.smoke[k]!;
    if (c <= thr) continue;
    const p = Math.min(1, (max * c) / sum);
    const r0 = hash01(k, 1);
    if (r0 > p) continue;
    const z = (k / plane) | 0;
    const rem = k - z * plane;
    const j = (rem / g.nx) | 0;
    const i = rem - j * g.nx;
    const dz = atm.nz > 1 ? atm.levels[Math.min(z + 1, atm.nz - 1)]! - atm.levels[Math.max(z - 1, 0)]! : 200;
    const r1 = hash01(k, 2);
    const r2 = hash01(k, 3);
    const r3 = hash01(k, 4);
    // Fewer puffs than cells: make each one cover proportionally more.
    const cover = Math.min(1.5, 1 / Math.sqrt(p));
    out.push({
      x: g.x0 + (i + (r1 - 0.5) * 0.8) * g.cellSize,
      y: g.y0 + (j + (r2 - 0.5) * 0.8) * g.cellSize,
      z: base + atm.levels[z]! + (r3 - 0.5) * 0.4 * dz,
      radius: g.cellSize * (0.8 + 0.5 * r3) * cover,
      alpha: Math.min(1, c / cRef) * 0.3,
      heat: Math.min(1, Math.max(0, atm.thetaAnomaly[k]! / 6)),
      rand: r1,
    });
  }
  return out;
}

/**
 * Fallback plume: a column from `src` (local m, ground m ASL) with fireline intensity `intensity` (kW/m), rising while
 * the ambient wind (via `sampler`) bends it over, then drifting downwind at the top.
 */
export function plumeColumn(
  src: { x: number; y: number; ground: number },
  intensity: number,
  sampler: AtmosphereSampler,
  opts: { max?: number } = {},
): Puff[] {
  const max = opts.max ?? 700;
  const out: Puff[] = [];
  const w0 = Math.min(22, Math.max(3, 2 + intensity / 1500));
  const top = Math.min(5500, Math.max(700, 500 + 0.18 * intensity));
  const [ua, va] = sampler.ambient;
  let x = src.x;
  let y = src.y;
  let agl = 5;
  let t = 0;
  let station = 0;
  const dt = 12;
  while (out.length < max && t < 3600) {
    const f = profileFactor(agl);
    const u = ua * f;
    const v = va * f;
    const rising = agl < top;
    const w = rising ? w0 * Math.max(0.25, Math.exp(-agl / (top * 0.8))) : 0;
    x += u * dt;
    y += v * dt;
    agl = Math.min(top, agl + w * dt);
    t += dt;
    const radius = 25 + 0.22 * agl + (rising ? 0 : (t - 0) * 0.05);
    const step = Math.max(1, Math.round(radius / 60));
    if (station++ % step === 0) {
      const fadeTop = rising ? 1 : Math.max(0, 1 - (t - 600) / 2400);
      const per = 3;
      for (let s = 0; s < per && out.length < max; s++) {
        const r1 = hash01(station, s, 1);
        const r2 = hash01(station, s, 2);
        const r3 = hash01(station, s, 3);
        out.push({
          x: x + (r1 - 0.5) * radius * 1.2,
          y: y + (r2 - 0.5) * radius * 1.2,
          z: src.ground + agl + (r3 - 0.5) * radius * 0.8,
          radius: radius * (0.9 + 0.5 * r3),
          alpha: 0.38 * fadeTop * (rising ? 1 : 0.8),
          heat: Math.max(0, 1 - agl / 400),
          rand: r1,
        });
      }
    }
    if (!rising && t > 2400) break;
  }
  return out;
}

export class SmokeLayer {
  readonly mesh: THREE.Mesh;
  private readonly geom: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private puff: Float32Array;
  private props: Float32Array;
  private aPuff: THREE.InstancedBufferAttribute;
  private aProps: THREE.InstancedBufferAttribute;
  private current: Puff[] = [];
  private previous: Puff[] = [];
  private mixT = 1;
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly order: number[] = [];

  constructor(shared: Record<string, THREE.IUniform>, capacity = 3200) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.puff = new Float32Array(capacity * 4);
    this.props = new Float32Array(capacity * 4);
    this.aPuff = new THREE.InstancedBufferAttribute(this.puff, 4).setUsage(THREE.DynamicDrawUsage);
    this.aProps = new THREE.InstancedBufferAttribute(this.props, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPuff', this.aPuff);
    g.setAttribute('aProps', this.aProps);
    g.instanceCount = 0;
    this.geom = g;
    this.uniforms = { uMix: { value: 1 }, uAlphaScale: { value: 1 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uVex: shared.uVex!,
        uClock: shared.uClock!,
        uSunColour: shared.uSunColour!,
        uSunI: shared.uSunI!,
        uSkyAmb: shared.uSkyAmb!,
        uAmbI: shared.uAmbI!,
        uNight: shared.uNight!,
        uExposure: shared.uExposure!,
        uFogColour: shared.uFogColour!,
        uFogDensity: shared.uFogDensity!,
      },
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'smoke';
  }

  /** New puff set; the previous one fades out over ~1 s. */
  setPuffs(puffs: Puff[], crossfade = true): void {
    this.previous = crossfade ? this.current : [];
    this.current = puffs;
    this.mixT = crossfade && this.previous.length ? 0 : 1;
    this.uniforms.uMix!.value = this.mixT;
    const total = this.previous.length + this.current.length;
    if (total * 4 > this.puff.length) {
      this.geom.dispose(); // free the old GPU buffers before replacing the attributes
      const cap = Math.ceil(total * 1.2);
      this.puff = new Float32Array(cap * 4);
      this.props = new Float32Array(cap * 4);
      this.aPuff = new THREE.InstancedBufferAttribute(this.puff, 4).setUsage(THREE.DynamicDrawUsage);
      this.aProps = new THREE.InstancedBufferAttribute(this.props, 4).setUsage(THREE.DynamicDrawUsage);
      this.geom.setAttribute('aPuff', this.aPuff);
      this.geom.setAttribute('aProps', this.aProps);
    }
    this.order.length = 0;
    for (let i = 0; i < total; i++) this.order.push(i);
    this.sortValid = false;
  }

  get count(): number {
    return this.previous.length + this.current.length;
  }

  /** True while a cross-fade is running. */
  get animating(): boolean {
    return this.mixT < 1;
  }

  /** Advance the cross-fade. */
  animate(dt: number): void {
    if (this.mixT < 1) {
      this.mixT = Math.min(1, this.mixT + dt / 1.2);
      this.uniforms.uMix!.value = this.mixT;
      if (this.mixT >= 1 && this.previous.length) {
        this.previous = [];
        this.setPuffs(this.current, false);
      }
    }
  }

  private readonly sortKey = new Float64Array(5);
  private sortValid = false;
  private dist = new Float32Array(0);

  /** Sort back-to-front for the camera (world position) and upload. Cheap for ≤ 3 000 puffs; skipped if unchanged. */
  sort(camera: THREE.Vector3, vex: number): void {
    // Re-sort only when the camera moved by ≥ 40 m (numeric key: no per-frame string garbage).
    const kx = Math.round(camera.x / 40);
    const ky = Math.round(camera.y / 40);
    const kz = Math.round(camera.z / 40);
    const key = this.sortKey;
    if (this.sortValid && key[0] === kx && key[1] === ky && key[2] === kz && key[3] === vex && key[4] === this.count) return;
    this.sortValid = true;
    key[0] = kx;
    key[1] = ky;
    key[2] = kz;
    key[3] = vex;
    key[4] = this.count;
    const prevN = this.previous.length;
    const get = (i: number): Puff => (i < prevN ? this.previous[i]! : this.current[i - prevN]!);
    if (this.dist.length < this.order.length) this.dist = new Float32Array(Math.ceil(this.order.length * 1.25));
    const d = this.dist;
    for (let i = 0; i < this.order.length; i++) {
      const p = get(i);
      const dx = p.x - camera.x;
      const dy = p.z * vex - camera.y;
      const dz = -p.y - camera.z;
      d[i] = dx * dx + dy * dy + dz * dz;
    }
    this.order.sort((a, b) => d[b]! - d[a]!);
    for (let s = 0; s < this.order.length; s++) {
      const i = this.order[s]!;
      const p = get(i);
      this.puff[s * 4] = p.x;
      this.puff[s * 4 + 1] = p.y;
      this.puff[s * 4 + 2] = p.z;
      this.puff[s * 4 + 3] = p.radius;
      this.props[s * 4] = p.alpha;
      this.props[s * 4 + 1] = p.rand;
      this.props[s * 4 + 2] = i < prevN ? 0 : 1;
      this.props[s * 4 + 3] = p.heat;
    }
    this.geom.instanceCount = this.order.length;
    this.aPuff.needsUpdate = true;
    this.aProps.needsUpdate = true;
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
  }
}
