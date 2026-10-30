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
