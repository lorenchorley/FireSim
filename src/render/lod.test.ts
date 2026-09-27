/**
 * Tests for the vegetation near LOD (split + detailed geometry) and the ember snapshot hand-over. These construct
 * Three.js geometry / buffers only (no WebGL context), so they run in Node.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EmberLayer } from './emberLayer';
import { splitLod, vegetationDetailGeometry, vegetationGeometry, trianglesPerInstance } from './vegetationLayer';
import { VegGroup, type VegInstances } from './vegetationPlacement';

function instances(group: VegGroup, pts: [number, number][], z = 100, h = 20): VegInstances {
  const n = pts.length;
  const position = new Float32Array(n * 3);
  const size = new Float32Array(n * 2);
  pts.forEach(([x, y], i) => {
    position.set([x, y, z], i * 3);
    size.set([h, 8], i * 2);
  });
  return { group, count: n, position, size, rand: new Float32Array(n * 2).fill(0.5), tint: new Uint8Array(n * 3).fill(100) };
}

/** Every triangle's face normal agrees with its vertices' normals (front faces point outwards). */
function outwardFraction(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const idx = g.getIndex()!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const f = new THREE.Vector3();
  const vn = new THREE.Vector3();
  let ok = 0;
  const tris = idx.count / 3;
  for (let t = 0; t < tris; t++) {
    const i0 = idx.getX(t * 3);
    const i1 = idx.getX(t * 3 + 1);
    const i2 = idx.getX(t * 3 + 2);
    a.fromBufferAttribute(p, i0);
    b.fromBufferAttribute(p, i1).sub(a);
    c.fromBufferAttribute(p, i2).sub(a);
    f.crossVectors(b, c);
    vn.fromBufferAttribute(nrm, i0).add(new THREE.Vector3().fromBufferAttribute(nrm, i1)).add(new THREE.Vector3().fromBufferAttribute(nrm, i2));
    if (f.dot(vn) >= 0) ok++;
  }
  return ok / tris;
}

describe('vegetation near LOD', () => {
  it('detailed models exist for eucalypt and rainforest, face outwards and stay within ~200 triangles', () => {
    for (const grp of [VegGroup.Eucalypt, VegGroup.Rainforest]) {
      const g = vegetationDetailGeometry(grp)!;
      expect(g).not.toBeNull();
      const tris = g.getIndex()!.count / 3;
      expect(tris).toBeGreaterThan(80);
      expect(tris).toBeLessThanOrEqual(200);
      expect(outwardFraction(g)).toBe(1);
      // Unit space: crown width ≈ 1, height ≈ 1, standing on y = 0.
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      expect(bb.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(bb.max.y).toBeLessThanOrEqual(1.05);
      expect(bb.max.x - bb.min.x).toBeLessThan(1.2);
    }
    expect(vegetationDetailGeometry(VegGroup.Shrub)).toBeNull();
    // The far models are the cheap ones.
    expect(trianglesPerInstance(VegGroup.Eucalypt)).toBeLessThan(45);
    for (const grp of [VegGroup.Eucalypt, VegGroup.Rainforest, VegGroup.Conifer, VegGroup.Shrub]) expect(outwardFraction(vegetationGeometry(grp))).toBe(1);
  });

  it('puts the nearest detailed-group instances (≤ max, within the radius) in the near LOD and keeps every instance once', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 40; i++) pts.push([i * 20, 0]); // 0 … 780 m east of the camera
    const euc = instances(VegGroup.Eucalypt, pts);
    const shrubs = instances(VegGroup.Shrub, pts.slice(0, 5));
    const split = splitLod([euc, shrubs], [0, 0, 101], 1, 300, 10);
    const [e, s] = split;
    expect(e!.near.count).toBe(10); // capped
    expect(e!.far.count).toBe(30);
    // The nearest ten (x = 0 … 180 m).
    const nx = Array.from({ length: e!.near.count }, (_, i) => e!.near.position[i * 3]!);
    expect(Math.max(...nx)).toBeLessThanOrEqual(180);
    // Shrubs have no detailed model: untouched.
    expect(s!.near.count).toBe(0);
    expect(s!.far).toBe(shrubs);
    // Radius limit without the cap.
    const r = splitLod([euc], [0, 0, 101], 1, 300, 1000)[0]!;
    expect(r.near.count).toBe(15); // x = 0 … 280 m (3-D distance to mid-height ≈ horizontal here)
    expect(r.near.count + r.far.count).toBe(euc.count);
  });

  it('measures height with the vertical exaggeration (a camera high above is far from every tree)', () => {
    const euc = instances(VegGroup.Eucalypt, [[0, 0]], 100);
    expect(splitLod([euc], [0, 0, 400], 1, 280, 100)[0]!.near.count).toBe(0);
    expect(splitLod([euc], [0, 0, 200], 1, 280, 100)[0]!.near.count).toBe(1);
    expect(splitLod([euc], [0, 0, 200], 3, 280, 100)[0]!.near.count).toBe(0);
  });
});

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
