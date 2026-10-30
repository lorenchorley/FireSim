/**
 * The 3-D curtain from a slice (Three.js objects built in node, no renderer): its geometry, its texture, what it hides and what its arrows say.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AtmosphereSampler } from './atmosphereSampler';
import { colourSlice } from './crossSectionColour';
import { CrossSectionLayer } from './crossSectionLayer';
import { sectionFromEndpoints } from './slice/sectionLine';
import { sampleSlice } from './slice/sliceField';
import { makeAirView } from './slice/testing';
import type { AirViewOptions } from './slice/testing';
import type { SliceData, SliceKind } from './slice/types';

const shared = (): Record<string, THREE.IUniform> => ({
  uVex: { value: 1 },
  uExposure: { value: 1 },
  uFogColour: { value: new THREE.Color(0.5, 0.5, 0.5) },
  uFogDensity: { value: 0 },
  uViewport: { value: new THREE.Vector2(400, 800) },
});

const GROUND = (x: number): number => 500 + 0.05 * (x + 3000); // a gentle slope up to the east
const heightAt = (x: number): number => GROUND(x);

/** A slice of an analytic air along a line, and the sampler it came from. */
function slice(o: AirViewOptions & { a?: [number, number]; b?: [number, number] } = {}): { data: SliceData; sampler: AtmosphereSampler; kind: SliceKind } {
  const { a = [-1500, 0], b = [1500, 0], ...air } = o;
  const view = makeAirView({ groundAt: GROUND, u: () => 8, v: () => 0, w: () => 0.5, theta: (_x, _y, z) => 0.002 * (z - 1500), ...air });
  const sampler = new AtmosphereSampler(view, 500, null);
  const line = sectionFromEndpoints(a, b, view.grid).line!;
  const data = sampleSlice(sampler, { heightAt: (x) => heightAt(x) }, { line, shownTime: 600 })!;
  return { data, sampler, kind: data.kind };
}

const instances = (l: CrossSectionLayer): number => (l.arrows.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount;
const geometryOf = (l: CrossSectionLayer): THREE.BufferGeometry => (l.group.children.find((c) => c.renderOrder === 7) as THREE.Mesh).geometry;
const meshOf = (l: CrossSectionLayer): THREE.Mesh => l.group.children.find((c) => c.renderOrder === 7) as THREE.Mesh;

describe('CrossSectionLayer', () => {
  it('draws nothing until it is given a slice, and nothing again after clear()', () => {
    const l = new CrossSectionLayer(shared());
    expect(l.line).toBeNull();
    expect(l.group.children.find((c) => c.renderOrder === 7)).toBeUndefined();
    const { data, sampler } = slice();
    l.update(data, 'speed', heightAt, sampler, 1, 1);
    expect(meshOf(l).visible).toBe(true);
    expect(l.line).toBe(data.line);
    l.clear();
    expect(meshOf(l).visible).toBe(false);
    expect(instances(l)).toBe(0);
    expect(l.line).toBeNull();
    l.update(data, 'speed', heightAt, sampler, 1, 1);
    expect(meshOf(l).visible).toBe(true);
    expect(instances(l)).toBeGreaterThan(0);
  });

  it('stands on the 10 m ground: two vertices per lattice column, the lowest and the highest row, with the ground under each', () => {
    const l = new CrossSectionLayer(shared());
    const { data, sampler } = slice();
    l.update(data, 'speed', heightAt, sampler, 1, 1);
    const g = geometryOf(l);
    const pos = g.getAttribute('position').array as Float32Array;
    const uv = g.getAttribute('uv').array as Float32Array;
    const ground = g.getAttribute('aGround').array as Float32Array;
    const M = data.columns;
    expect(pos.length).toBe(M * 2 * 3);
    expect(ground.length).toBe(M * 2);
    expect(g.index!.count).toBe((M - 1) * 6);
    for (const c of [0, 1, Math.floor(M / 2), M - 1]) {
      const s = c / (M - 1);
      const x = data.line.a[0] + (data.line.b[0] - data.line.a[0]) * s;
      const y = data.line.a[1] + (data.line.b[1] - data.line.a[1]) * s;
      expect(pos[(c * 2) * 3]).toBeCloseTo(x, 3);
      expect(pos[(c * 2) * 3 + 1]).toBeCloseTo(y, 3);
      expect(pos[(c * 2) * 3 + 2]).toBeCloseTo(data.zMin, 3); // bottom: the lowest row
      expect(pos[(c * 2 + 1) * 3 + 2]).toBeCloseTo(data.zMax, 3); // top: the highest row
      expect(uv[c * 2 * 2]).toBeCloseTo(s, 6);
      expect(uv[c * 2 * 2 + 1]).toBe(0);
      expect(uv[(c * 2 + 1) * 2 + 1]).toBe(1);
      expect(ground[c * 2]).toBe(data.ground[c]);
      expect(ground[c * 2 + 1]).toBe(data.ground[c]);
    }
    // The ground profile climbs with the slope: the curtain's ground line is the DEM, not a flat bottom.
    expect(ground[(M - 1) * 2]!).toBeGreaterThan(ground[0]! + 100);
    // Every index points at a real vertex.
    const idx = g.index!.array;
    for (let i = 0; i < idx.length; i++) expect(idx[i]!).toBeLessThan(M * 2);
  });

  it('uses the lattice as the texture, coloured by the chip', () => {
    const l = new CrossSectionLayer(shared());
    const { data, sampler } = slice();
    l.update(data, 'along', heightAt, sampler, 1, 1);
    const mat = meshOf(l).material as THREE.ShaderMaterial;
    const tex = mat.uniforms.uTex!.value as THREE.DataTexture;
    expect(tex.image.width).toBe(data.columns);
    expect(tex.image.height).toBe(data.rows);
    expect((mat.uniforms.uTexSize!.value as THREE.Vector2).toArray()).toEqual([data.columns, data.rows]);
    const expected = new Uint8Array(data.columns * data.rows * 4);
    colourSlice(data, 'along', expected);
    expect(Array.from(tex.image.data as Uint8Array)).toEqual(Array.from(expected));
    // Another chip repaints the same texture.
    l.update(data, 'up', heightAt, sampler, 1, 1);
    colourSlice(data, 'up', expected);
    expect(mat.uniforms.uTex!.value).toBe(tex);
    expect(Array.from(tex.image.data as Uint8Array)).toEqual(Array.from(expected));
  });

  it('keeps its geometry and texture while the line and the lattice stay, and rebuilds them when they change', () => {
    const l = new CrossSectionLayer(shared());
    const first = slice();
    l.update(first.data, 'speed', heightAt, first.sampler, 1, 1);
    const g1 = geometryOf(l);
    const mat = meshOf(l).material as THREE.ShaderMaterial;
    const t1 = mat.uniforms.uTex!.value;
    l.update(first.data, 'speed', heightAt, first.sampler, 1, 2); // a new pixel ratio redraws, nothing is rebuilt
    expect(geometryOf(l)).toBe(g1);
    expect(mat.uniforms.uTex!.value).toBe(t1);
    // The same lattice size along another line: new geometry, same texture.
    const moved = slice({ a: [-1500, 300], b: [1500, 300] });
    expect(moved.data.columns).toBe(first.data.columns);
    l.update(moved.data, 'speed', heightAt, moved.sampler, 1, 1);
    expect(geometryOf(l)).not.toBe(g1);
    expect(mat.uniforms.uTex!.value).toBe(t1);
    // A longer line has more columns: a new texture too.
    const longer = slice({ a: [-3000, 0], b: [3000, 0] });
    expect(longer.data.columns).toBeGreaterThan(first.data.columns);
    l.update(longer.data, 'speed', heightAt, longer.sampler, 1, 1);
    expect(mat.uniforms.uTex!.value).not.toBe(t1);
    expect((mat.uniforms.uTex!.value as THREE.DataTexture).image.width).toBe(longer.data.columns);
  });

  describe('arrows', () => {
    // On the 3-D atmosphere the wind runs west to east above 1.5 km and the other way near the ground (a reverse flow under the ridge-top wind).
    const reverse = { u: (_x: number, _y: number, z: number): number => (z > 1700 ? 10 : -4), v: () => 0, w: () => 0 };
    const cyanCount = (l: CrossSectionLayer): number => {
      let n = 0;
      for (let i = 0; i < instances(l); i++) {
        const [r, g, b] = [l.arrows.c[i * 4]!, l.arrows.c[i * 4 + 1]!, l.arrows.c[i * 4 + 2]!];
        if (b > 0.9 && g > 0.7 && r < 0.5) n++;
      }
      return n;
    };

    it('mark reverse flow in cyan on the 3-D atmosphere', () => {
      const l = new CrossSectionLayer(shared());
      const { data, sampler } = slice({ ...reverse, kind: 'prognostic' });
      expect(data.kind).toBe('prognostic');
      l.update(data, 'speed', heightAt, sampler, 1, 1);
      expect(instances(l)).toBeGreaterThan(20);
      expect(cyanCount(l)).toBeGreaterThan(0);
    });

    it('mark none on the fast tier’s diagnosed wind, which has no such flow to mark', () => {
      const l = new CrossSectionLayer(shared());
      const { data, sampler } = slice({ ...reverse, kind: 'diagnosed', theta: null, smoke: null });
      expect(data.kind).toBe('diagnosed');
      l.update(data, 'speed', heightAt, sampler, 1, 1);
      expect(instances(l)).toBeGreaterThan(20);
      expect(cyanCount(l)).toBe(0);
    });

    it('are about twice as dense as the first 15 columns by six heights: 21 columns by nine, the top row cut on a flat line as before', () => {
      const l = new CrossSectionLayer(shared());
      // A flat ground: the curtain ends 2 km over it, so the 2,200 m row is cut (15 x 5 = 75 arrows before).
      const view = makeAirView({ groundAt: () => 500, u: () => 8, v: () => 0, w: () => 0.5 });
      const sampler = new AtmosphereSampler(view, 500, null);
      const line = sectionFromEndpoints([-1500, 0], [1500, 0], view.grid).line!;
      const data = sampleSlice(sampler, { heightAt: () => 500 }, { line, shownTime: 600 })!;
      l.update(data, 'speed', () => 500, sampler, 1, 1);
      expect(instances(l)).toBe(21 * 8);
      expect(instances(l)).toBeGreaterThanOrEqual(2 * 75);
      expect(instances(l)).toBeLessThanOrEqual(l.arrows.capacity);
    });

    it('stay inside the curtain and follow the vertical exaggeration', () => {
      const l = new CrossSectionLayer(shared());
      const { data, sampler } = slice();
      l.update(data, 'speed', heightAt, sampler, 1, 1);
      const n = instances(l);
      for (let i = 0; i < n; i++) {
        expect(l.arrows.a[i * 3 + 1]!).toBeLessThanOrEqual(data.zMax + 1e-3);
        expect(l.arrows.b[i * 3 + 1]!).toBeLessThanOrEqual(data.zMax + 1e-3);
      }
      const y1 = l.arrows.a[1]!;
      l.update(data, 'speed', heightAt, sampler, 2, 1);
      expect(l.arrows.a[1]!).toBeCloseTo(2 * y1, 3);
      expect(instances(l)).toBe(n);
    });
  });
});
