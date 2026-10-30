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
import type { StreakBatch } from './streaks';

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

    describe('thinned where the curtain is seen edge on (0.7.0, F2)', () => {
      // A flat ground, so that every column has all eight of its arrows (21 x 8 = 168), on a line that runs east and west for 3 km (143 m between columns).
      const flat = (): { data: SliceData; sampler: AtmosphereSampler } => {
        const view = makeAirView({ groundAt: () => 500, u: () => 8, v: () => 0, w: () => 0.5 });
        const sampler = new AtmosphereSampler(view, 500, null);
        const line = sectionFromEndpoints([-1500, 0], [1500, 0], view.grid).line!;
        return { data: sampleSlice(sampler, { heightAt: () => 500 }, { line, shownTime: 600 })!, sampler };
      };
      /** A camera of the view's 50 degrees at (x, y, z) in the scene's axes (z is south), looking at the middle of the curtain, 1,000 m up. */
      const camera = (x: number, y: number, z: number): THREE.PerspectiveCamera => {
        const c = new THREE.PerspectiveCamera(50, 360 / 640, 10, 60000);
        c.position.set(x, y, z);
        c.lookAt(0, 1000, 0);
        c.updateMatrixWorld();
        return c;
      };
      const SOUTH = (): THREE.PerspectiveCamera => camera(0, 1500, 2500); // face-on: the curtain runs across the screen
      const EAST_END = (): THREE.PerspectiveCamera => camera(6000, 1100, 0); // along the line: the 21 columns land on one screen column
      const haloOf = (l: CrossSectionLayer): StreakBatch => (l as unknown as { halo: StreakBatch }).halo;
      const haloCount = (l: CrossSectionLayer): number => (haloOf(l).mesh.geometry as THREE.InstancedBufferGeometry).instanceCount;
      const version = (l: CrossSectionLayer): number => (l.arrows.mesh.geometry.getAttribute('aA') as THREE.BufferAttribute).version;
      const first = (l: CrossSectionLayer, n: number): number[] => [...l.arrows.a.subarray(0, n * 3), ...l.arrows.b.subarray(0, n * 3), ...l.arrows.c.subarray(0, n * 4)];

      it('draws every column face-on, and only columns 0, 7 and 14 along the line, the batch and the halo together', () => {
        const l = new CrossSectionLayer(shared());
        const { data, sampler } = flat();
        l.update(data, 'speed', () => 500, sampler, 1, 1);
        expect(instances(l)).toBe(168);
        l.setView(SOUTH(), 640);
        expect(instances(l), 'face-on: nothing is thinned').toBe(168);
        expect(haloCount(l)).toBe(168);
        l.setView(EAST_END(), 640);
        expect(instances(l), '3 columns of 8 arrows').toBe(24);
        expect(haloCount(l), 'the halo holds the same arrows').toBe(24);
        const n = 24;
        expect([...haloOf(l).a.subarray(0, n * 3)]).toEqual([...l.arrows.a.subarray(0, n * 3)]);
        expect([...haloOf(l).b.subarray(0, n * 3)]).toEqual([...l.arrows.b.subarray(0, n * 3)]);
      });

      it('keeps the same arrows at each stride (column 0 first, then every stride-th): the subset is the full set’s, bit for bit', () => {
        const l = new CrossSectionLayer(shared());
        const { data, sampler } = flat();
        l.update(data, 'speed', () => 500, sampler, 1, 1);
        const all = [...l.arrows.a.subarray(0, 168 * 3)];
        // Halfway between face-on and end on: a stride of 2 or 3.
        const mid = camera(5000, 2500, 2500);
        l.setView(mid, 640);
        const kept = instances(l);
        expect(kept).toBeGreaterThan(24);
        expect(kept).toBeLessThan(168);
        expect(kept % 8).toBe(0); // whole columns
        const columns = kept / 8;
        const stride = Math.ceil(21 / columns);
        expect([2, 3, 4, 5, 6]).toContain(stride);
        // Column c of the thinned set is column c x stride of the full one.
        for (let c = 0; c < columns; c++) expect([...l.arrows.a.subarray(c * 8 * 3, (c * 8 + 8) * 3)]).toEqual(all.slice(c * stride * 8 * 3, (c * stride * 8 + 8) * 3));
      });

      it('goes back to every column when the camera comes round, and the arrows are the ones it started with', () => {
        const l = new CrossSectionLayer(shared());
        const { data, sampler } = flat();
        l.update(data, 'speed', () => 500, sampler, 1, 1);
        const start = first(l, 168);
        l.setView(EAST_END(), 640);
        expect(instances(l)).toBe(24);
        l.setView(SOUTH(), 640);
        expect(instances(l)).toBe(168);
        expect(first(l, 168)).toEqual(start);
        expect([...haloOf(l).a.subarray(0, 168 * 3)]).toEqual([...l.arrows.a.subarray(0, 168 * 3)]);
      });

      it('commits again only when the stride changes: the same view, or a small move of it, uploads nothing', () => {
        const l = new CrossSectionLayer(shared());
        const { data, sampler } = flat();
        l.update(data, 'speed', () => 500, sampler, 1, 1);
        l.setView(EAST_END(), 640);
        const v = version(l);
        l.setView(EAST_END(), 640);
        l.setView(camera(6040, 1100, 30), 640);
        l.setView(camera(5980, 1120, -20), 640);
        expect(version(l), 'nothing was uploaded for a camera that stays end on').toBe(v);
        expect(instances(l)).toBe(24);
        l.setView(SOUTH(), 640);
        expect(version(l), 'a new stride uploads').toBeGreaterThan(v);
      });

      it('a new slice (a new snapshot, a new pixel ratio) is drawn with the stride in use, not all at once', () => {
        const l = new CrossSectionLayer(shared());
        const { data, sampler } = flat();
        l.update(data, 'speed', () => 500, sampler, 1, 1);
        l.setView(EAST_END(), 640);
        l.update(data, 'speed', () => 500, sampler, 1, 2);
        expect(instances(l)).toBe(24);
        expect(haloCount(l)).toBe(24);
        l.update(data, 'speed', () => 500, sampler, 2, 2); // a new vertical exaggeration too
        expect(instances(l)).toBe(24);
      });

      it('a smaller screen thins more (the columns are fewer pixels apart), a taller one less', () => {
        const l = new CrossSectionLayer(shared());
        const { data, sampler } = flat();
        l.update(data, 'speed', () => 500, sampler, 1, 1);
        const slanted = camera(3000, 1800, 3000); // about 45 degrees to the line
        l.setView(slanted, 1280);
        const tall = instances(l);
        l.setView(slanted, 320);
        const short = instances(l);
        expect(short).toBeLessThan(tall);
      });

      it('thins what it is for: the heads that stand on each other on a 360 x 640 screen, at any tilt, and leaves a curtain seen face-on as it was', () => {
        const W = 360;
        const H = 640;
        /** A camera `dist` m from the middle of the curtain, `az` degrees round from north (the line runs east to west), `dip` degrees above the horizon. */
        const view = (dist: number, az: number, dip: number): THREE.PerspectiveCamera => {
          const a = (az * Math.PI) / 180;
          const d = (dip * Math.PI) / 180;
          const c = new THREE.PerspectiveCamera(50, W / H, 10, 60000);
          c.position.set(Math.sin(a) * Math.cos(d) * dist, 1100 + Math.sin(d) * dist, -Math.cos(a) * Math.cos(d) * dist);
          c.lookAt(0, 1100, 0);
          c.updateMatrixWorld();
          c.updateProjectionMatrix();
          return c;
        };
        /** Pairs of arrow heads on the screen that are closer than 8 px (a head is 10 px across), among those on the screen. */
        const stacked = (l: CrossSectionLayer, cam: THREE.PerspectiveCamera): number => {
          const pts: [number, number][] = [];
          for (let i = 0; i < instances(l); i++) {
            const v = new THREE.Vector3(l.arrows.b[i * 3]!, l.arrows.b[i * 3 + 1]!, l.arrows.b[i * 3 + 2]!).project(cam);
            const x = ((v.x + 1) / 2) * W;
            const y = ((1 - v.y) / 2) * H;
            if (x >= 0 && x <= W && y >= 0 && y <= H && v.z < 1) pts.push([x, y]);
          }
          let n = 0;
          for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1]) < 8) n++;
          return n;
        };
        const { data, sampler } = flat();
        const at = (dist: number, az: number, dip: number): { before: number; after: number; arrows: number } => {
          const l = new CrossSectionLayer(shared());
          l.update(data, 'speed', () => 500, sampler, 1, 1);
          const cam = view(dist, az, dip);
          const before = stacked(l, cam); // every column drawn
          l.setView(cam, H);
          return { before, after: stacked(l, cam), arrows: instances(l) };
        };
        // Looking along the line, low and at the orbit's usual 35 degrees: the curtain is a line on the screen, and 700 to 1,200 pairs of heads stand on each other.
        for (const [dist, dip] of [
          [6000, 10],
          [6000, 35],
          [4000, 35],
          [8000, 35],
        ] as const) {
          const r = at(dist, 90, dip);
          expect(r.before, `${dist} m, ${dip} degrees, along the line: heads on heads`).toBeGreaterThan(400);
          expect(r.after, `${dist} m, ${dip} degrees, along the line`).toBeLessThanOrEqual(r.before / 20);
          expect(r.arrows).toBeLessThanOrEqual(56);
        }
        // A little off the line: still thinned, and the stacking is nearly gone.
        for (const dip of [10, 35]) {
          const r = at(6000, 110, dip);
          expect(r.before).toBeGreaterThan(90);
          expect(r.after, `a little off the line, ${dip} degrees`).toBeLessThanOrEqual(r.before / 10);
        }
        // Seen face-on, at any tilt and zoom: every arrow, exactly as before.
        for (const dist of [2500, 4000, 6000, 8000]) {
          for (const dip of [10, 35, 60]) expect(at(dist, 180, dip).arrows, `face-on at ${dist} m, ${dip} degrees`).toBe(168);
        }
      });

      it('does nothing without a slice (never shown, or cleared) and does not break the next one', () => {
        const l = new CrossSectionLayer(shared());
        l.setView(EAST_END(), 640);
        expect(instances(l)).toBe(0);
        const { data, sampler } = flat();
        l.update(data, 'speed', () => 500, sampler, 1, 1);
        l.setView(EAST_END(), 640);
        l.clear();
        l.setView(SOUTH(), 640);
        expect(instances(l)).toBe(0);
        l.update(data, 'speed', () => 500, sampler, 1, 1);
        expect(instances(l), 'it is drawn again, at the stride the view asks for next').toBeGreaterThan(0);
      });
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
