/**
 * Wind particles advected on the CPU through the atmosphere (doc 09 §8.6 — "the most important why-visual in
 * mountains"), drawn as fading screen-space streaks in one draw call.
 *
 *  'surface'  terrain-following particles at ~12 m AGL in the 10 m wind (surfaceU/V), coloured by speed: shows
 *             channelling along valleys, crest speed-up, katabatic drainage and fire indraft.
 *  'volume'   particles through the 3-D (u, v, w) field from near the ground to the model top, coloured by vertical
 *             velocity: rising plume and anabatic flow red, sinking air blue. A share of particles is seeded near the
 *             fire so the updraft and indraft are always visible.
 * Motion runs at an accelerated visual time scale (simulated seconds per wall second, default 30).
 */
import * as THREE from 'three';
import type { AtmosphereSampler } from './atmosphereSampler';
import { UPDRAFT_RAMP, WIND_RAMP, sampleRamp, srgbToLinear, type Rgb } from './palette';
import { StreakBatch } from './streaks';

export type WindMode = 'off' | 'surface' | 'volume';

/** Tiny deterministic PRNG so particle respawns are reproducible between runs (screenshots, tests). */
class Lcg {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
}

export interface WindDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  heightAt: (x: number, y: number) => number;
}

export class WindLayer {
  readonly streaks: StreakBatch;
  private mode: WindMode = 'off';
  private readonly cap: number;
  private readonly p: Float32Array; // x, y, z
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private n = 0;
  private rng = new Lcg(12345);
  private readonly w = new Float32Array(3);
  visualSpeed = 30;
  trailSeconds = 0.55;
  /** Where to seed extra particles in volume mode (fire centroid), local m. */
  focus: { x: number; y: number; radius: number } | null = null;

  constructor(shared: Record<string, THREE.IUniform>, capacity = 3500) {
    this.cap = capacity;
    this.p = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.streaks = new StreakBatch({ capacity, widthPx: 3, tailAlpha: 0, shared, outline: true });
    this.streaks.mesh.name = 'wind';
    this.streaks.mesh.renderOrder = 4;
  }

  setMode(mode: WindMode, domain: WindDomain | null): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.n = mode === 'surface' ? Math.min(this.cap, 1300) : mode === 'volume' ? Math.min(this.cap, 2600) : 0;
    if (domain) for (let i = 0; i < this.n; i++) this.spawn(i, domain, true);
    this.streaks.mesh.visible = mode !== 'off';
    if (mode === 'off') this.streaks.commit(0);
  }

  get currentMode(): WindMode {
    return this.mode;
  }

  private spawn(i: number, d: WindDomain, initial: boolean): void {
    const r = this.rng;
    let x: number;
    let y: number;
    let agl: number;
    if (this.mode === 'volume' && this.focus && r.next() < 0.35) {
      const a = r.next() * Math.PI * 2;
      const rr = Math.sqrt(r.next()) * this.focus.radius;
      x = this.focus.x + Math.cos(a) * rr;
      y = this.focus.y + Math.sin(a) * rr;
      agl = 20 + r.next() * 300;
    } else {
      x = d.xMin + r.next() * (d.xMax - d.xMin);
      y = d.yMin + r.next() * (d.yMax - d.yMin);
      agl = this.mode === 'volume' ? 20 + r.next() ** 1.6 * 2200 : 12;
    }
    x = Math.min(d.xMax, Math.max(d.xMin, x));
    y = Math.min(d.yMax, Math.max(d.yMin, y));
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = d.heightAt(x, y) + agl;
    this.life[i] = 2.2 + 2.5 * r.next();
    this.age[i] = initial ? r.next() * this.life[i]! : 0;
  }

  /** Advance particles by `dt` wall seconds and write the streak buffers (world coordinates). */
  animate(dt: number, sampler: AtmosphereSampler, d: WindDomain, vex: number): void {
    if (this.mode === 'off' || this.n === 0) return;
    const k = this.visualSpeed;
    const tt = this.trailSeconds * k;
    const w = this.w;
    const c: Rgb = [0, 0, 0];
    const A = this.streaks.a;
    const B = this.streaks.b;
    const C = this.streaks.c;
    const surface = this.mode === 'surface';
    for (let i = 0; i < this.n; i++) {
      let age = this.age[i]! + dt;
      if (age > this.life[i]!) {
        this.spawn(i, d, false);
        age = 0;
      }
      let x = this.p[i * 3]!;
      let y = this.p[i * 3 + 1]!;
      let z = this.p[i * 3 + 2]!;
      let ground = d.heightAt(x, y);
      if (surface) {
        sampler.surfaceWind(x, y, w);
        w[2] = 0;
      } else sampler.wind(x, y, z, z - ground, w);
      const u = w[0]!;
      const v = w[1]!;
      const ww = w[2]!;
      x += u * dt * k;
      y += v * dt * k;
      if (surface) {
        ground = d.heightAt(x, y);
        z = ground + 12;
      } else z += ww * dt * k;
      const out = x < d.xMin || x > d.xMax || y < d.yMin || y > d.yMax;
      ground = d.heightAt(x, y);
      if (out || (!surface && (z < ground + 2 || z > sampler.top))) {
        this.spawn(i, d, false);
        this.age[i] = 0;
        C[i * 4 + 3] = 0;
        continue;
      }
      this.p[i * 3] = x;
      this.p[i * 3 + 1] = y;
      this.p[i * 3 + 2] = z;
      this.age[i] = age;
      const speed = Math.hypot(u, v);
      // Tail: back along the local velocity; on the surface it follows the ground.
      const tx = x - u * tt;
      const ty = y - v * tt;
      const tz = surface ? d.heightAt(tx, ty) + 12 : z - ww * tt;
      A[i * 3] = tx;
      A[i * 3 + 1] = tz * vex;
      A[i * 3 + 2] = -ty;
      B[i * 3] = x;
      B[i * 3 + 1] = z * vex;
      B[i * 3 + 2] = -y;
      if (surface) sampleRamp(WIND_RAMP, speed, c);
      else sampleRamp(UPDRAFT_RAMP, ww, c);
      const life = this.life[i]!;
      const fade = Math.min(1, age / 0.4) * Math.min(1, (life - age) / 0.5);
      C[i * 4] = srgbToLinear(c[0]);
      C[i * 4 + 1] = srgbToLinear(c[1]);
      C[i * 4 + 2] = srgbToLinear(c[2]);
      // Surface: stronger wind = more opaque. Volume: rising / sinking air stands out, level flow stays faint.
      const weight = surface ? Math.min(1, 0.4 + speed / 5) : 0.4 + 0.6 * Math.min(1, Math.abs(ww) / 2);
      C[i * 4 + 3] = Math.max(0, fade) * 0.9 * weight;
    }
    this.streaks.commit(this.n);
  }

  setDpr(dpr: number): void {
    this.streaks.widthPx = (this.mode === 'volume' ? 2.6 : 3.0) * dpr;
  }

  dispose(): void {
    this.streaks.dispose();
  }
}

/**
 * Optional wind arrows on a coarse lattice (surface wind at ~30 m AGL), length ∝ speed, coloured by speed with a dark
 * outline — a static complement to the particles for screenshots, briefings and reduced-motion users.
 */
export class WindArrows {
  readonly arrows: StreakBatch;
  private readonly w = new Float32Array(3);

  constructor(shared: Record<string, THREE.IUniform>, capacity = 256) {
    this.arrows = new StreakBatch({ capacity, widthPx: 3, headPx: 10, shared, fog: true });
    this.arrows.mesh.name = 'wind-arrows';
    this.arrows.mesh.renderOrder = 4;
  }

  /** Rebuild the arrows on an n × n lattice over the domain. */
  update(sampler: AtmosphereSampler, d: WindDomain, vex: number, dpr: number, n = 9): void {
    const A = this.arrows.a;
    const B = this.arrows.b;
    const C = this.arrows.c;
    const c: Rgb = [0, 0, 0];
    const sx = (d.xMax - d.xMin) / n;
    const sy = (d.yMax - d.yMin) / n;
    const len = Math.min(sx, sy) * 0.8;
    let o = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (o >= this.arrows.capacity) break;
        const x = d.xMin + (i + 0.5) * sx;
        const y = d.yMin + (j + 0.5) * sy;
        sampler.surfaceWind(x, y, this.w);
        const u = this.w[0]!;
        const v = this.w[1]!;
        const sp = Math.hypot(u, v);
        if (sp < 0.2) continue;
        const l = len * Math.min(1, 0.3 + sp / 12);
        const hx = (u / sp) * l * 0.5;
        const hy = (v / sp) * l * 0.5;
        const z0 = d.heightAt(x - hx, y - hy) + 30;
        const z1 = d.heightAt(x + hx, y + hy) + 30;
        A[o * 3] = x - hx;
        A[o * 3 + 1] = z0 * vex;
        A[o * 3 + 2] = -(y - hy);
        B[o * 3] = x + hx;
        B[o * 3 + 1] = z1 * vex;
        B[o * 3 + 2] = -(y + hy);
        sampleRamp(WIND_RAMP, sp, c);
        C[o * 4] = srgbToLinear(c[0]);
        C[o * 4 + 1] = srgbToLinear(c[1]);
        C[o * 4 + 2] = srgbToLinear(c[2]);
        C[o * 4 + 3] = 0.95;
        o++;
      }
    }
    this.arrows.commit(o);
    this.arrows.widthPx = 3 * dpr;
    this.arrows.uniforms.uHeadPx!.value = 10 * dpr;
  }

  dispose(): void {
    this.arrows.dispose();
  }
}
