/**
 * The old Wind streaks (particles advected on the CPU) step aside while the detailed streaks of the most detailed level are drawn (0.6.0):
 * hidden, not advanced, and given back where they were.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AtmosphereSampler } from './atmosphereSampler';
import { WindLayer, type WindDomain } from './windLayer';

const shared = (): Record<string, THREE.IUniform> => ({
  uExposure: { value: 1 },
  uFogColour: { value: new THREE.Color(0.5, 0.5, 0.5) },
  uFogDensity: { value: 0 },
  uViewport: { value: new THREE.Vector2(400, 800) },
});
const DOMAIN: WindDomain = { xMin: -3000, xMax: 3000, yMin: -3000, yMax: 3000, heightAt: () => 500 };
/** A sampler that blows 5 m/s east everywhere (only the call the surface mode makes). */
const SAMPLER = {
  top: 3000,
  surfaceWind(_x: number, _y: number, out: Float32Array): void {
    out[0] = 5;
    out[1] = 0;
    out[2] = 0;
  },
} as unknown as AtmosphereSampler;

describe('WindLayer.setSuppressed', () => {
  it('hides the particles and does not advance them, and gives them back where they were', () => {
    const w = new WindLayer(shared(), 64);
    w.setMode('surface', DOMAIN);
    expect(w.streaks.mesh.visible).toBe(true);
    w.animate(0.05, SAMPLER, DOMAIN, 1);
    const before = Array.from(w.streaks.b.subarray(0, 12));
    expect(before.some((v) => v !== 0)).toBe(true);
    w.setSuppressed(true);
    expect(w.streaks.mesh.visible).toBe(false);
    w.animate(0.05, SAMPLER, DOMAIN, 1);
    w.animate(0.05, SAMPLER, DOMAIN, 1);
    expect(Array.from(w.streaks.b.subarray(0, 12)), 'not advanced while suppressed').toEqual(before);
    w.setSuppressed(false);
    expect(w.streaks.mesh.visible).toBe(true);
    w.animate(0.05, SAMPLER, DOMAIN, 1);
    expect(Array.from(w.streaks.b.subarray(0, 12)), 'advanced again').not.toEqual(before);
  });

  it('stays hidden when the mode is set while suppressed, and never shows a layer that is off', () => {
    const w = new WindLayer(shared(), 64);
    w.setSuppressed(true);
    w.setMode('surface', DOMAIN);
    expect(w.streaks.mesh.visible).toBe(false);
    expect(w.currentMode).toBe('surface'); // the mode is still the switch's: only the drawing steps aside
    w.setSuppressed(false);
    expect(w.streaks.mesh.visible).toBe(true);
    w.setMode('off', DOMAIN);
    expect(w.streaks.mesh.visible).toBe(false);
    w.setSuppressed(true);
    w.setSuppressed(false);
    expect(w.streaks.mesh.visible, 'off stays off').toBe(false);
  });

  it('is a plain flag: asking twice changes nothing', () => {
    const w = new WindLayer(shared(), 64);
    w.setMode('surface', DOMAIN);
    w.setSuppressed(true);
    w.setSuppressed(true);
    expect(w.streaks.mesh.visible).toBe(false);
    w.setSuppressed(false);
    w.setSuppressed(false);
    expect(w.streaks.mesh.visible).toBe(true);
  });
});

describe('WindLayer.setMotion (reduced motion, 0.7.0)', () => {
  /** A sampler that blows `u` m/s east, for a test that changes the wind between two draws. */
  const blowing = (u: number): AtmosphereSampler =>
    ({
      top: 3000,
      surfaceWind(_x: number, _y: number, out: Float32Array): void {
        out[0] = u;
        out[1] = 0;
        out[2] = 0;
      },
    }) as unknown as AtmosphereSampler;
  const heads = (w: WindLayer, n = 24): number[] => Array.from(w.streaks.b.subarray(0, n * 3));
  const tails = (w: WindLayer, n = 24): number[] => Array.from(w.streaks.a.subarray(0, n * 3));

  it('is allowed by default, and the layer animates only while it is on, not stepping aside and allowed to move', () => {
    const w = new WindLayer(shared(), 64);
    expect(w.animating, 'off').toBe(false);
    w.setMode('surface', DOMAIN);
    expect(w.animating).toBe(true);
    w.setSuppressed(true);
    expect(w.animating, 'the detailed streaks are drawn instead').toBe(false);
    w.setSuppressed(false);
    w.setMotion(false);
    expect(w.animating, 'reduced motion').toBe(false);
    w.setMotion(true);
    expect(w.animating).toBe(true);
    w.setMode('off', DOMAIN);
    expect(w.animating).toBe(false);
  });

  it('moves no particle when it is not allowed, and still writes the buffers (the dashes are drawn, standing still)', () => {
    const w = new WindLayer(shared(), 64);
    w.setMode('surface', DOMAIN);
    w.setMotion(false);
    expect(w.streaks.mesh.visible, 'not hidden: the person keeps the picture').toBe(true);
    w.animate(1, SAMPLER, DOMAIN, 1);
    const first = heads(w);
    expect(first.some((v) => v !== 0), 'the buffers were written').toBe(true);
    const firstTails = tails(w);
    for (let i = 0; i < 5; i++) w.animate(1, SAMPLER, DOMAIN, 1); // five seconds of wall time: nothing travels, nothing ages, nothing respawns
    expect(heads(w)).toEqual(first);
    expect(tails(w)).toEqual(firstTails);
    expect(w.streaks.mesh.visible).toBe(true);
  });

  it('draws every dash at full strength when frozen: no half-faded comet is held', () => {
    const w = new WindLayer(shared(), 64);
    w.setMode('surface', DOMAIN);
    w.animate(0.05, SAMPLER, DOMAIN, 1); // moving: ages are random, some dashes are young (faint) or old (fading)
    const moving = Array.from({ length: 24 }, (_, i) => w.streaks.c[i * 4 + 3]!);
    expect(Math.min(...moving), 'while moving some dashes are partly faded').toBeLessThan(0.5);
    w.setMotion(false);
    w.animate(0, SAMPLER, DOMAIN, 1);
    for (let i = 0; i < 24; i++) expect(w.streaks.c[i * 4 + 3], `dash ${i}`).toBeGreaterThanOrEqual(0.36); // 0.9 x the weakest weight (0.4)
  });

  it('the tails follow the wind as it is now, the heads stay: a new snapshot redraws the dashes', () => {
    const w = new WindLayer(shared(), 64);
    w.setMode('surface', DOMAIN);
    w.setMotion(false);
    w.animate(1, blowing(5), DOMAIN, 1);
    const heads5 = heads(w);
    const tails5 = tails(w);
    w.animate(1, blowing(10), DOMAIN, 1);
    expect(heads(w)).toEqual(heads5);
    const tails10 = tails(w);
    expect(tails10, 'the tail is longer in a stronger wind').not.toEqual(tails5);
    const reach = (t: number[]): number => heads5[0]! - t[0]!;
    expect(reach(tails10)).toBeGreaterThan(reach(tails5) * 1.5);
  });

  it('resumes from the same places when motion is allowed again', () => {
    const w = new WindLayer(shared(), 64);
    w.setMode('surface', DOMAIN);
    w.setMotion(false);
    w.animate(1, SAMPLER, DOMAIN, 1);
    const frozen = heads(w);
    w.setMotion(true);
    w.animate(0.05, SAMPLER, DOMAIN, 1);
    const after = heads(w);
    expect(after).not.toEqual(frozen);
    // 5 m/s east at the layer's visual speed of 30 for 0.05 s is 7.5 m: east only, from where the dash stood (the buffers hold x, height, minus y)
    for (let i = 0; i < 24; i++) {
      expect(after[i * 3]! - frozen[i * 3]!, `dash ${i} east`).toBeCloseTo(7.5, 3);
      expect(after[i * 3 + 2], `dash ${i} north`).toBeCloseTo(frozen[i * 3 + 2]!, 3);
    }
  });

  it('is a plain flag: asking twice changes nothing, and the volume streaks freeze too', () => {
    const w = new WindLayer(shared(), 64);
    w.setMode('volume', DOMAIN);
    w.setMotion(false);
    w.setMotion(false);
    expect(w.animating).toBe(false);
    const volume = {
      top: 3000,
      wind(_x: number, _y: number, _z: number, _agl: number, out: Float32Array): void {
        out[0] = 4;
        out[1] = 2;
        out[2] = 1;
      },
    } as unknown as AtmosphereSampler;
    w.animate(1, volume, DOMAIN, 1);
    const first = heads(w);
    w.animate(1, volume, DOMAIN, 1);
    expect(heads(w)).toEqual(first);
  });
});
