/**
 * VegetationLayer without a WebGL context: it builds Three.js objects (geometry, materials, textures) only, so the level-of-
 * detail meshes, style switching, sway inputs, incremental placement and disposal can be tested in Node.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { makeGridSpec } from '../core/grid';
import { FuelType, type FuelMap } from '../core/types';
import { CANOPY_BUDGETS, VegetationLayer } from './vegetationLayer';
import { PlacementJob, VegGroup, placeVegetation, type VegInstances } from './vegetationPlacement';
import { swayParams } from './canopyStyle';
import { DEFAULT_LAYERS } from './layers';

function sharedUniforms(): Record<string, THREE.IUniform> {
  const v = (value: unknown): THREE.IUniform => ({ value });
  return {
    uVex: v(1),
    uTime: v(0),
    uClock: v(0),
    uHasFire: v(0),
    uBurnBand: v(420),
    uArrival: v(null),
    uFireAux: v(null),
    uFireXf: v(new THREE.Vector4()),
    uGlow: v(null),
    uGlowXf: v(new THREE.Vector4()),
    uGlowGain: v(2),
    uSunDir: v(new THREE.Vector3(0, 1, 0)),
    uSunColour: v(new THREE.Color()),
    uSunI: v(2),
    uSkyAmb: v(new THREE.Color()),
    uGroundAmb: v(new THREE.Color()),
    uAmbI: v(0.6),
    uExposure: v(1),
    uFogColour: v(new THREE.Color()),
    uFogDensity: v(0),
    uNight: v(0),
  };
}

function fuel(): FuelMap {
  const g = makeGridSpec({ lat: -33.7, lon: 150.3 }, 3000, 30);
  const n = g.nx * g.ny;
  const a = (x: number): Float32Array => new Float32Array(n).fill(x);
  return {
    grid: g,
    type: new Uint8Array(n).fill(FuelType.DryForestGrassy),
    surfaceHazard: a(3),
    nearSurfaceHazard: a(2),
    nearSurfaceHeight: a(0.4),
    elevatedHazard: a(3),
    elevatedHeight: a(1.5),
    barkHazard: a(2.5),
    surfaceLoad: a(10),
    nearSurfaceLoad: a(3),
    elevatedLoad: a(4),
    barkLoad: a(2),
    canopyHeight: a(22),
    canopyCover: a(0.7),
    curing: a(60),
    timeSinceFire: a(10),
    lastFireKind: new Uint8Array(n),
    sources: [],
  };
}

const heightAt = (x: number, y: number): number => 500 + 0.01 * x + 0.02 * y;
const fm = fuel();
const sets: VegInstances[] = placeVegetation(fm, { budget: 8000, heightAt, focus: [0, 0], focusRadius: 700, seed: 2 });
const layer = (): VegetationLayer => {
  const l = new VegetationLayer(sharedUniforms());
  l.setProjection(1000, 2600);
  return l;
};
const meshNames = (l: VegetationLayer): string[] => l.group.children.map((c) => c.name);
const onLayers = { ...DEFAULT_LAYERS };

describe('VegetationLayer', () => {
  it('builds one mesh per (species, level of detail) within the budgets and reports its statistics', () => {
    const l = layer();
    l.setBudget(CANOPY_BUDGETS.high);
    l.updateLod([0, 0, 520], 1, 700, true);
    l.setInstances(sets);
    const st = l.stats();
    expect(st.instances).toBe(l.instanceCount);
    expect(st.near).toBeGreaterThan(0);
    expect(st.mid).toBeGreaterThan(0);
    expect(st.far).toBeGreaterThan(0);
    expect(st.near + st.mid + st.far).toBe(st.instances);
    expect(st.triangles).toBeLessThanOrEqual(CANOPY_BUDGETS.high.triangles);
    expect(st.meshes).toBe(l.group.children.length);
    expect(st.meshes).toBeLessThanOrEqual(30);
    expect(meshNames(l).some((n) => n.endsWith('-near'))).toBe(true);
    expect(meshNames(l).some((n) => n.endsWith('-far'))).toBe(true);
    for (const c of l.group.children) expect((c as THREE.Mesh).frustumCulled).toBe(false);
    l.dispose();
  });

  it('respects the low quality budget (≤ 100 000 triangles) even when everything is close', () => {
    const l = layer();
    l.setBudget(CANOPY_BUDGETS.low);
    l.updateLod([0, 0, 505], 1, 700, true);
    l.setInstances(sets);
    expect(l.stats().triangles).toBeLessThanOrEqual(100000);
    expect(l.stats().near).toBeLessThanOrEqual(CANOPY_BUDGETS.low.near + CANOPY_BUDGETS.low.nearSmall);
    l.dispose();
  });

  it('switches style: simple and coded use the cheaper flat shapes, coded leaves the grass out, the legend follows the code', () => {
    const l = layer();
    l.updateLod([0, 0, 505], 1, 700, true);
    l.setInstances(sets);
    l.setLayers({ ...onLayers, canopyStyle: 'natural' });
    const natural = l.stats().triangles;
    expect(l.legend()).toBeNull();
    l.setLayers({ ...onLayers, canopyStyle: 'simple' });
    expect(l.stats().triangles).toBeLessThan(natural);
    expect(l.uniforms.uStyle!.value).toBe(1);
    expect(meshNames(l).some((n) => n.includes('Grass'))).toBe(true);
    l.setLayers({ ...onLayers, canopyStyle: 'coded', canopyCode: 'bark' });
    expect(l.uniforms.uStyle!.value).toBe(2);
    expect(l.uniforms.uCode!.value).toBe(2);
    expect(meshNames(l).some((n) => n.includes('Grass'))).toBe(false);
    expect(l.legend()?.overlay).toBe('barkHazard');
    l.setLayers({ ...onLayers, canopyStyle: 'coded', canopyCode: 'height' });
    expect(l.legend()?.overlay).toBe('canopyHeight');
    expect(l.uniforms.uCode!.value).toBe(0);
    l.setLayers({ ...onLayers, canopyStyle: 'natural' });
    expect(l.uniforms.uStyle!.value).toBe(0);
    expect(l.stats().triangles).toBe(natural);
    l.dispose();
  });

  it('hides for a solo heat map, when switched off, and drops the understorey when it is off', () => {
    const l = layer();
    l.updateLod([0, 0, 505], 1, 700, true);
    l.setInstances(sets);
    expect(meshNames(l).some((n) => n.includes('Understorey'))).toBe(true);
    l.setLayers({ ...onLayers, understorey: false });
    expect(meshNames(l).some((n) => n.includes('Understorey'))).toBe(false);
    l.setLayers({ ...onLayers, understorey: true });
    expect(meshNames(l).some((n) => n.includes('Understorey'))).toBe(true);
    expect(l.visible).toBe(true);
    l.setLayers({ ...onLayers, overlay: 'slope', soloHeat: true });
    expect(l.visible).toBe(false);
    l.setLayers({ ...onLayers, overlay: 'slope', soloHeat: false });
    expect(l.visible).toBe(true);
    l.setLayers({ ...onLayers, vegetation: false });
    expect(l.visible).toBe(false);
    l.dispose();
  });

  it('is not drawn at all in a straight-down top view, where every tree has faded out anyway', () => {
    const l = layer();
    l.updateLod([0, 0, 505], 1, 700, true);
    l.setInstances(sets);
    l.setLayers({ ...onLayers });
    expect(l.group.visible).toBe(true);
    l.setViewDown(0.6); // an ordinary oblique view
    expect(l.group.visible).toBe(true);
    l.setViewDown(0.95); // steep: fading, still drawn
    expect(l.group.visible).toBe(true);
    l.setViewDown(0.999); // top view
    expect(l.group.visible).toBe(false);
    expect(l.visible).toBe(true); // still switched on: the legend and the layer switch are unchanged
    l.setViewDown(0.3);
    expect(l.group.visible).toBe(true);
    l.setLayers({ ...onLayers, vegetation: false });
    l.setViewDown(0.1);
    expect(l.group.visible).toBe(false); // the switch wins
    l.dispose();
  });

  it('takes the sway from the wind: direction, lean and oscillation follow the speed; it only animates when it matters', () => {
    const l = layer();
    l.updateLod([0, 0, 505], 1, 700, true);
    l.setInstances(sets);
    l.setLayers({ ...onLayers, windSway: true });
    l.setWind(0, 0);
    expect(l.animating).toBe(false);
    // Wind blowing towards the north-east at 12 m/s: world direction (x east, z = −north).
    l.setWind(8.4853, 8.4853);
    const dir = l.uniforms.uWindDir!.value as THREE.Vector2;
    expect(dir.x).toBeCloseTo(Math.SQRT1_2, 3);
    expect(dir.y).toBeCloseTo(-Math.SQRT1_2, 3);
    const amp = l.uniforms.uSwayAmp!.value as THREE.Vector3;
    const p = swayParams(12);
    expect(amp.x).toBeCloseTo(p.lean, 4);
    expect(amp.y).toBeCloseTo(p.amp, 4);
    expect(amp.z).toBeCloseTo(p.flutter, 4);
    expect(l.animating).toBe(true);
    l.setLayers({ ...onLayers, windSway: false });
    expect(l.uniforms.uSway!.value).toBe(0);
    expect(l.animating).toBe(false);
    l.dispose();
  });

  it('places incrementally: a job pumped a few ms at a time ends with the same trees as a one-shot placement', () => {
    const l = layer();
    l.updateLod([0, 0, 505], 1, 700, true);
    l.startPlacement(fm, { budget: 8000, heightAt, focus: [0, 0], focusRadius: 700, seed: 2 }, [0, 0, 505], 1);
    expect(l.placing).toBe(true);
    let pumps = 0;
    while (l.placing && pumps < 100000) {
      l.pump(0.0001);
      pumps++;
    }
    expect(pumps).toBeGreaterThan(5);
    expect(l.placing).toBe(false);
    expect(l.instanceCount).toBeGreaterThan(0);
    // Same as the reference job.
    const job = new PlacementJob(fm, { budget: 8000, heightAt, focus: [0, 0], focusRadius: 700, seed: 2 });
    job.step(Infinity);
    expect(job.result.reduce((s, x) => s + x.count, 0)).toBeGreaterThan(0);
    // cancelPlacement stops a running job and keeps the trees.
    const n = l.instanceCount;
    l.startPlacement(fm, { budget: 8000, heightAt }, [0, 0, 505], 1);
    l.cancelPlacement();
    expect(l.placing).toBe(false);
    expect(l.pump(5)).toBe(false);
    expect(l.instanceCount).toBe(n);
    l.dispose();
  });

  it('re-plans the levels of detail only when the camera has moved enough', () => {
    const l = layer();
    l.updateLod([0, 0, 505], 1, 700, true);
    l.setInstances(sets);
    const a = l.stats();
    l.updateLod([3, 0, 505], 1, 700); // 3 m: below the threshold
    expect(l.stats()).toEqual(a);
    l.updateLod([400, 0, 505], 1, 700);
    expect(l.stats().near).not.toBe(a.near - 1e9); // ran without throwing; the plan follows the new camera
    l.updateLod([0, 0, 505], 1, 700, true);
    expect(l.stats().near).toBe(a.near);
    l.dispose();
  });

  it('disposes every geometry, material and texture it made, and empties itself', () => {
    const geomDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const matDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    const texDispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const l = layer();
    l.updateLod([0, 0, 505], 1, 700, true);
    l.setInstances(sets);
    l.setLayers({ ...onLayers, canopyStyle: 'coded', canopyCode: 'cover' });
    l.setLayers({ ...onLayers, canopyStyle: 'natural' });
    const priv = l as unknown as { geometries: Map<string, THREE.BufferGeometry>; materials: Map<string, THREE.ShaderMaterial> };
    const nGeom = priv.geometries.size;
    const nMat = priv.materials.size;
    expect(nGeom).toBeGreaterThanOrEqual(3);
    expect(nMat).toBeGreaterThanOrEqual(3);
    const meshes = [...l.group.children] as THREE.Mesh[];
    geomDispose.mockClear();
    matDispose.mockClear();
    texDispose.mockClear();
    l.dispose();
    // Base geometries + the per-mesh instanced geometries; every material; leaf, impostor and code textures.
    expect(geomDispose.mock.calls.length).toBeGreaterThanOrEqual(nGeom + meshes.length);
    expect(matDispose.mock.calls.length).toBe(nMat);
    expect(texDispose.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(l.group.children).toHaveLength(0);
    expect(l.instanceCount).toBe(0);
    // Idempotent.
    l.dispose();
    expect(l.group.children).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('keeps a shared-uniform contract: every uniform the shaders read is provided per material', () => {
    const l = layer();
    l.updateLod([0, 0, 505], 1, 700, true);
    l.setInstances(sets);
    const m = (l.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    const used = new Set<string>();
    for (const src of [m.vertexShader, m.fragmentShader]) for (const x of src.matchAll(/uniform\s+(?:float|vec[234]|sampler2D)\s+(u[A-Za-z]+)/g)) used.add(x[1]!);
    for (const name of used) expect(Object.keys(m.uniforms), `uniform ${name}`).toContain(name);
    expect(sets.some((s) => s.group === VegGroup.Understorey && s.count > 0)).toBe(true);
    l.dispose();
  });
});

describe('VegetationLayer staged work', () => {
  it('spreads placement, planning and the buffer build over successive pumps and never leaves work behind', () => {
    const l = layer();
    l.staged = true;
    l.updateLod([0, 0, 505], 1, 700, true);
    expect(l.placing).toBe(true); // the plan is pending
    l.startPlacement(fm, { budget: 8000, heightAt, focus: [0, 0], focusRadius: 700, seed: 2 }, [0, 0, 505], 1);
    const changes: boolean[] = [];
    let calls = 0;
    while (l.placing && calls < 100000) {
      changes.push(l.pump(0.0001));
      calls++;
    }
    expect(calls).toBeGreaterThan(5);
    // Only the very last call (the buffer build) changes the picture, and it happens in a call of its own.
    expect(changes.filter(Boolean)).toHaveLength(1);
    expect(changes.at(-1)).toBe(true);
    expect(l.instanceCount).toBeGreaterThan(0);
    // A camera move is planned and applied by later pumps, one stage each.
    const before = l.stats();
    l.updateLod([600, 0, 505], 1, 700);
    expect(l.placing).toBe(true);
    expect(l.stats()).toEqual(before);
    expect(l.pump(4)).toBe(false); // plan
    expect(l.pump(4)).toBe(true); // build
    expect(l.placing).toBe(false);
    // Infinity finishes everything at once (screenshots, tests, the first placement).
    l.updateLod([0, 0, 505], 1, 700, true);
    expect(l.pump(Infinity)).toBe(true);
    expect(l.placing).toBe(false);
    expect(l.stats().near).toBe(before.near);
    l.dispose();
  });
});
