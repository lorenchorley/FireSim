/**
 * Tests for the ember snapshot hand-over (the vegetation levels of detail are tested in vegetationLod.test.ts, treeModels.test.ts
 * and vegetationLayer.test.ts). These construct Three.js buffers only (no WebGL context), so they run in Node.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EmberLayer } from './emberLayer';

describe('ember snapshot hand-over', () => {
  const shared: Record<string, THREE.IUniform> = {
    uViewport: { value: new THREE.Vector2(400, 800) },
    uExposure: { value: 1 },
    uFogColour: { value: new THREE.Color() },
    uFogDensity: { value: 0 },
  };
  const pack = (pts: [number, number, number][]): { count: number; data: Float32Array } => ({
    count: pts.length,
    data: Float32Array.from(pts.flatMap(([x, y, z]) => [x, y, z, 0.8])),
  });
  const flat = (): number => 0;

  it('keeps surplus embers fading out for a while instead of dropping them, then settles on the new count', () => {
    const e = new EmberLayer(shared, 100);
    e.setParticles(pack(Array.from({ length: 50 }, (_, i) => [i, 0, 200] as [number, number, number])));
    e.animate(0.1, null, flat, 1);
    expect(e.active).toBe(50);
    e.setParticles(pack(Array.from({ length: 20 }, (_, i) => [1000 + i, 0, 200] as [number, number, number])));
    expect(e.active).toBe(50); // 30 surplus embers still finishing their flight
    for (let s = 0; s < 40; s++) e.animate(0.1, null, flat, 1); // > max visual life (2.8 s)
    expect(e.active).toBe(20);
    e.dispose();
  });

  it('resets immediately when asked (rewind)', () => {
    const e = new EmberLayer(shared, 100);
    e.setParticles(pack(Array.from({ length: 50 }, (_, i) => [i, 0, 200] as [number, number, number])));
    e.setParticles(pack([[5, 5, 200]]), true);
    expect(e.active).toBe(1);
    e.dispose();
  });
});
