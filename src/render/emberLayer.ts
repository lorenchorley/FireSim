/**
 * Embers: glowing point sprites (THREE.Points, one draw call) with short additive motion trails (one StreakBatch).
 *
 * Snapshots arrive every few simulated minutes and do not identify individual firebrands, so between snapshots each
 * ember is animated locally: it is advected through the 3-D wind (atmosphere or ambient fallback) at an accelerated
 * visual time scale and falls at its terminal velocity, then respawns at its snapshot position. The cloud therefore
 * keeps the simulated shape while showing which way — and how fast — embers are travelling. A new snapshot does not
 * teleport the cloud: every ember switches to the new snapshot's positions at its next (staggered) respawn, embers the
 * new snapshot no longer has fade out, and new ones fade in — so the cloud morphs smoothly from one snapshot to the
 * next (setParticles(p, true) resets at once, e.g. after a rewind). Colour follows the
 * temperature fraction (white-yellow hot → dark red cooling), with a minimum on-screen size so embers stay visible in
 * sunlight (doc 09 §8.7).
 */
import * as THREE from 'three';
import type { EmberParticles } from '../core/types';
import type { AtmosphereSampler } from './atmosphereSampler';
import { hash01 } from './fields';
import { EMBER_RAMP, sampleRamp, srgbToLinear, type Rgb } from './palette';
import { StreakBatch } from './streaks';

const EMBER_VERT = /* glsl */ `
uniform float uPxPerRad;
uniform float uSizeM;
uniform float uMinPx;
uniform float uDpr;
attribute vec4 aCol;
varying vec4 vCol;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSizeM * uPxPerRad / max(-mv.z, 1.0), uMinPx * uDpr, 14.0 * uDpr);
  vCol = aCol;
}
`;

const EMBER_FRAG = /* glsl */ `
varying vec4 vCol;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 6.0);
  float halo = exp(-r2 * 2.0) * 0.45;
  vec3 c = vCol.rgb * (core + halo) + vec3(1.0, 0.95, 0.8) * core * core * 0.35;
  gl_FragColor = vec4(c * vCol.a, 1.0);
  #include <colorspace_fragment>
}
`;

export class EmberLayer {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly geom: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly trails: StreakBatch;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  // Simulation-space state (local x, y, z ASL).
  private seed = new Float32Array(0);
  private cur = new Float32Array(0);
  private age = new Float32Array(0);
  private life = new Float32Array(0);
  /** Temperature fraction of the ember's current flight (taken from its seed at respawn). */
  private temp = new Float32Array(0);
  /** 1 = the latest snapshot has no ember at this index: fade out, do not respawn. */
  private dying = new Uint8Array(0);
  /** Number of embers in the latest snapshot. */
  private seeds = 0;
  /** Embers being drawn (≥ seeds while surplus ones fade out). */
  private count = 0;
  readonly uniforms: Record<string, THREE.IUniform>;
  /** Simulated seconds per wall-clock second for the between-snapshot animation. */
  visualSpeed = 16;
  private readonly tmp = new Float32Array(3);

  constructor(shared: Record<string, THREE.IUniform>, capacity = 4000) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geom.setDrawRange(0, 0);
    this.uniforms = {
      uPxPerRad: { value: 1000 },
      uSizeM: { value: 3.5 },
      uMinPx: { value: 2.5 },
      uDpr: { value: 1 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: EMBER_VERT,
      fragmentShader: EMBER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geom, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    // Trails use normal blending so they read as glowing streaks at night but not as white scratches on a bright sky.
    this.trails = new StreakBatch({ capacity, widthPx: 1.6, additive: false, tailAlpha: 0, fog: false, shared });
    this.trails.mesh.renderOrder = 6;
    this.group.add(this.points, this.trails.mesh);
    this.group.name = 'embers';
  }

  /**
   * Load a snapshot's embers (packed [x, y, zASL, temperatureFraction]). With `reset` every ember restarts at its new
   * position immediately; otherwise the change is blended in over the embers' visual lifetimes (see class docs).
   */
  setParticles(p: EmberParticles, reset = false): void {
    const n = Math.min(p.count, this.capacity, Math.floor(p.data.length / 4));
    const old = reset ? 0 : this.count;
    const m = Math.max(n, old);
    if (this.seed.length < m * 4) {
      const grow = <T extends Float32Array | Uint8Array>(a: T, len: number): T => {
        const b = new (a.constructor as { new (n: number): T })(len);
        b.set(a.subarray(0, Math.min(a.length, len)));
        return b;
      };
      const cap = Math.min(this.capacity, Math.ceil(m * 1.25));
      this.seed = grow(this.seed, cap * 4);
      this.cur = grow(this.cur, cap * 3);
      this.age = grow(this.age, cap);
      this.life = grow(this.life, cap);
      this.temp = grow(this.temp, cap);
      this.dying = grow(this.dying, cap);
    }
    this.seed.set(p.data.subarray(0, n * 4));
    for (let e = 0; e < m; e++) {
      if (e >= n) {
        this.dying[e] = 1; // no counterpart in the new snapshot: finish the current flight and fade out
        continue;
      }
      this.dying[e] = 0;
      if (e < old) continue; // live ember: picks up its new seed at its next respawn
      this.cur[e * 3] = this.seed[e * 4]!;
      this.cur[e * 3 + 1] = this.seed[e * 4 + 1]!;
      this.cur[e * 3 + 2] = this.seed[e * 4 + 2]!;
      this.temp[e] = this.seed[e * 4 + 3]!;
      this.life[e] = 1.2 + 1.6 * hash01(e, 7);
      // Stagger ages so respawns are spread out (fresh embers after a reset start anywhere in their life).
      this.age[e] = reset || old === 0 ? hash01(e, 11) * this.life[e]! : 0;
    }
    this.seeds = n;
    this.count = m;
  }

  get active(): number {
    return this.count;
  }

  /**
   * Advance the between-snapshot animation by `dt` wall seconds and write GPU buffers.
   * @param heightAt ground elevation (m ASL)
   */
  animate(dt: number, sampler: AtmosphereSampler | null, heightAt: (x: number, y: number) => number, vex: number, trailSeconds = 0.2): void {
    const n = this.count;
    const w = this.tmp;
    const c: Rgb = [0, 0, 0];
    const k = this.visualSpeed;
    let o = 0;
    let live = 0;
    for (let e = 0; e < n; e++) {
      let age = this.age[e]! + dt;
      const life = this.life[e]!;
      let x = this.cur[e * 3]!;
      let y = this.cur[e * 3 + 1]!;
      let z = this.cur[e * 3 + 2]!;
      const ground = heightAt(x, y);
      if (age > life || z < ground - 1) {
        if (this.dying[e]) continue; // surplus ember of an older snapshot: gone
        age = age % life;
        x = this.seed[e * 4]! + (hash01(e, (age * 1000) | 0) - 0.5) * 20;
        y = this.seed[e * 4 + 1]! + (hash01(e, 5 + ((age * 1000) | 0)) - 0.5) * 20;
        z = this.seed[e * 4 + 2]!;
        this.temp[e] = this.seed[e * 4 + 3]!;
      }
      live = e + 1;
      const agl = Math.max(1, z - ground);
      if (sampler) sampler.wind(x, y, z, agl, w);
      else {
        w[0] = 0;
        w[1] = 0;
        w[2] = 0;
      }
      // Terminal fall speed of a bark firebrand ≈ 4–7 m/s; embers low over the ground slow down.
      const vz = w[2]! - 5 * Math.min(1, agl / 30);
      const vx = w[0]!;
      const vy = w[1]!;
      x += vx * dt * k;
      y += vy * dt * k;
      z = Math.max(ground + 0.5, z + vz * dt * k);
      this.cur[e * 3] = x;
      this.cur[e * 3 + 1] = y;
      this.cur[e * 3 + 2] = z;
      this.age[e] = age;
      // Colour by temperature; fade in / out over the visual life.
      const temp = this.temp[e]!;
      sampleRamp(EMBER_RAMP, temp, c);
      const fade = Math.min(1, age / 0.25) * Math.min(1, (life - age) / 0.35);
      const alpha = Math.max(0, fade) * (0.55 + 0.45 * temp);
      this.pos[o * 3] = x;
      this.pos[o * 3 + 1] = z * vex;
      this.pos[o * 3 + 2] = -y;
      const lr = srgbToLinear(c[0]);
      const lg = srgbToLinear(c[1]);
      const lb = srgbToLinear(c[2]);
      const boost = 0.9 + 1.4 * temp;
      this.col[o * 4] = lr * boost;
      this.col[o * 4 + 1] = lg * boost;
      this.col[o * 4 + 2] = lb * boost;
      this.col[o * 4 + 3] = alpha;
      // Trail from where the ember was `trailSeconds` of visual time ago.
      const tt = trailSeconds * k;
      const ta = this.trails.a;
      const tb = this.trails.b;
      const tc = this.trails.c;
      ta[o * 3] = x - vx * tt;
      ta[o * 3 + 1] = (z - vz * tt) * vex;
      ta[o * 3 + 2] = -(y - vy * tt);
      tb[o * 3] = x;
      tb[o * 3 + 1] = z * vex;
      tb[o * 3 + 2] = -y;
      tc[o * 4] = Math.min(1, lr * 1.1);
      tc[o * 4 + 1] = lg * 0.7;
      tc[o * 4 + 2] = lb * 0.5;
      tc[o * 4 + 3] = alpha * 0.55;
      o++;
    }
    // Surplus embers that have all expired no longer need to be visited.
    if (this.count > this.seeds && live <= this.seeds) this.count = this.seeds;
    this.geom.setDrawRange(0, o);
    const pa = this.geom.getAttribute('position') as THREE.BufferAttribute;
    const ca = this.geom.getAttribute('aCol') as THREE.BufferAttribute;
    pa.clearUpdateRanges();
    pa.addUpdateRange(0, o * 3);
    pa.needsUpdate = true;
    ca.clearUpdateRanges();
    ca.addUpdateRange(0, o * 4);
    ca.needsUpdate = true;
    this.trails.commit(o);
  }

  setProjection(pxPerRad: number, dpr: number): void {
    this.uniforms.uPxPerRad!.value = pxPerRad;
    this.uniforms.uDpr!.value = dpr;
    this.trails.widthPx = 1.1 * dpr;
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
    this.trails.dispose();
  }
}
