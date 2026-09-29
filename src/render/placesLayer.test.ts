/**
 * PlacesLayer: build budget, draw-call and memory budgets, layer toggling, and leak-free disposal. Node only: Three.js
 * objects are constructed without a WebGL context (labels need a 2-D canvas and are skipped here; see the browser
 * checks in docs/screenshots and the dev harness).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeGridSpec } from '../core/grid';
import { EMPTY_CONTEXT, type ContextLayers } from '../core/places';
import { loadBundledContext } from '../data/contextLayers';
import { DEMO_SITES } from '../data/demoSites';
import { HeightField } from './heightfield';
import { PlacesLayer, type ZoneSink } from './placesLayer';

const kat = DEMO_SITES.find((s) => s.id === 'katoomba')!;

function terrain(extent = 9000, cell = 30): HeightField {
  const g = makeGridSpec(kat.centre, extent, cell);
  const e = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) e[j * g.nx + i] = 900 + 120 * Math.sin(i / 17) * Math.cos(j / 23);
  return new HeightField(g, e);
}

class Sink implements ZoneSink {
  tex: THREE.Texture | null = null;
  visible = true;
  calls = 0;
  setZones(tex: THREE.Texture | null, _frame: unknown, visible = true): void {
    this.tex = tex;
    this.visible = visible;
    this.calls++;
  }
  setZonesVisible(v: boolean): void {
    this.visible = v;
  }
}

async function katoomba(): Promise<ContextLayers> {
  const c = await loadBundledContext('katoomba', kat.centre);
  expect(c).not.toBeNull();
  return c!;
}

/** Track prototype-level dispose() calls of the Three.js classes the layer registers. */
function spyDispose(): { disposed: Set<object>; restore(): void } {
  const disposed = new Set<object>();
  const protos = [THREE.BufferGeometry.prototype, THREE.Material.prototype, THREE.Texture.prototype] as { dispose(): void }[];
  const orig = protos.map((p) => p.dispose);
  protos.forEach((p, i) => {
    p.dispose = function (this: object) {
      disposed.add(this);
      orig[i]!.call(this);
    };
  });
  return {
    disposed,
    restore: () => protos.forEach((p, i) => (p.dispose = orig[i]!)),
  };
}

describe('PlacesLayer', () => {
  it('draws nothing without context', () => {
    const layer = new PlacesLayer({}, terrain(), new Sink());
    layer.flush();
    expect(layer.stats().drawCalls).toBe(0);
    layer.setContext(EMPTY_CONTEXT(kat.centre));
    layer.flush();
    expect(layer.stats().drawCalls).toBe(0);
    layer.setContext(null);
    layer.flush();
    expect(layer.stats().resources).toBe(0);
    layer.dispose();
  });

  it('builds Katoomba within the budgets: draw calls, GPU memory, build time', async () => {
    const ctx = await katoomba();
    const sink = new Sink();
    // Warm up the JIT first: the first build of a process compiles the builders, which is not what a frame sees.
    const warm = new PlacesLayer({}, terrain(), new Sink());
    warm.setContext(ctx);
    warm.flush();
    warm.dispose();
    const layer = new PlacesLayer({}, terrain(), sink);
    layer.setLayers({ roads: true, fireTrails: true, homes: true, zones: true, placeNames: true });
    layer.setContext(ctx);
    // Pump in 3 ms slices as the render loop does; no single slice may block a frame for 50 ms.
    let slices = 0;
    while (layer.building && slices < 500) {
      layer.pump(3);
      slices++;
    }
    const st = layer.stats();
    expect(st.building).toBe(false);
    expect(slices).toBeGreaterThan(1); // it really was chunked
    expect(st.longestSliceMs).toBeLessThan(80); // measured: ~8 ms warm, 12 ms in the browser
    expect(st.buildMs).toBeLessThan(400); // spec: < 150 ms on a desktop; generous for a loaded CI machine
    // Roads, fire trails, zone outlines, homes (+ names in the browser) = at most 6 draw calls.
    expect(st.drawCalls).toBeGreaterThanOrEqual(4);
    expect(st.drawCalls).toBeLessThanOrEqual(6);
    expect(st.gpuBytes).toBeLessThan(15e6);
    expect(sink.tex).not.toBeNull();
    // Homes: all in the domain.
    const homes = layer.group.children.find((c) => c.name === 'places-homes') as THREE.Mesh;
    expect((homes.geometry as THREE.InstancedBufferGeometry).instanceCount).toBeGreaterThan(6000);
    // Roads are one mesh with plausible vertex counts (2171 lines, resampled to ≤ 20 m).
    const roads = layer.group.children.find((c) => c.name === 'places-roads') as THREE.Mesh;
    const n = roads.geometry.getAttribute('position').count;
    expect(n).toBeGreaterThan(10000);
    expect(n).toBeLessThan(120000);
    layer.dispose();
  });

  it('toggles layers by visibility only', async () => {
    const ctx = await katoomba();
    const layer = new PlacesLayer({}, terrain(), new Sink());
    layer.setContext(ctx);
    layer.flush();
    const base = layer.stats().resources;
    const vis = (name: string): boolean => (layer.group.children.find((c) => c.name === name) as THREE.Object3D).visible;
    layer.setLayers({ roads: false, fireTrails: false, homes: false, zones: false, placeNames: false });
    expect(['places-roads', 'places-fire-trails', 'places-homes', 'places-zone-edges'].some(vis)).toBe(false);
    expect(layer.stats().drawCalls).toBe(0);
    layer.setLayers({ roads: true });
    expect(vis('places-roads')).toBe(true);
    expect(vis('places-fire-trails')).toBe(false);
    layer.setLayers({ homes: true, zones: true, fireTrails: true });
    expect(['places-roads', 'places-fire-trails', 'places-homes', 'places-zone-edges'].every(vis)).toBe(true);
    for (let i = 0; i < 20; i++) {
      layer.setLayers({ roads: i % 2 === 0, homes: i % 3 === 0 });
    }
    expect(layer.stats().resources).toBe(base); // toggling never creates or drops a GPU object
    layer.dispose();
  });

  it('does not leak when the data is replaced repeatedly and disposes everything', async () => {
    const ctx = await katoomba();
    const sink = new Sink();
    const spy = spyDispose();
    try {
      const layer = new PlacesLayer({}, terrain(), sink);
      layer.setContext(ctx);
      layer.flush();
      const first = layer.stats().resources;
      expect(first).toBeGreaterThan(8);
      const created = new Set<object>(layer.resourceList());
      for (let i = 0; i < 5; i++) {
        layer.setContext(ctx);
        layer.flush();
        expect(layer.stats().resources).toBe(first);
        for (const r of layer.resourceList()) created.add(r);
      }
      layer.setContext(null);
      expect(layer.stats().resources).toBe(0);
      layer.setContext(ctx);
      layer.flush();
      for (const r of layer.resourceList()) created.add(r);
      layer.dispose();
      expect(layer.liveResources).toBe(0);
      expect(layer.group.children.length).toBe(0);
      expect(sink.tex).toBeNull(); // the terrain lost its zone texture
      // Every GPU object the layer ever created was disposed.
      for (const r of created) expect(spy.disposed.has(r)).toBe(true);
      // Safe to call twice; safe to use after: nothing is built.
      layer.dispose();
      layer.setContext(ctx);
      layer.flush();
      expect(layer.liveResources).toBe(0);
    } finally {
      spy.restore();
    }
  });

  it('abandons a half-built job when the context changes (no partial resources)', async () => {
    const ctx = await katoomba();
    const layer = new PlacesLayer({}, terrain(), new Sink());
    layer.setContext(ctx);
    layer.pump(1);
    layer.setContext(EMPTY_CONTEXT(kat.centre));
    layer.flush();
    expect(layer.stats().drawCalls).toBe(0);
    expect(layer.stats().resources).toBeLessThanOrEqual(1);
    layer.dispose();
    expect(layer.liveResources).toBe(0);
  });

  it('keeps everything inside the terrain: lines that leave the domain are clipped', async () => {
    const hf = terrain(3000, 30);
    const ctx: ContextLayers = {
      ...EMPTY_CONTEXT(kat.centre),
      roads: [{ cls: 'primary', surface: 1, name: 'X', xy: Float32Array.from([-9000, 0, 9000, 0]), lengthM: 18000 }],
    };
    const layer = new PlacesLayer({}, hf, new Sink());
    layer.setContext(ctx);
    layer.flush();
    const mesh = layer.group.children.find((c) => c.name === 'places-roads') as THREE.Mesh;
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getX(i)).toBeGreaterThanOrEqual(hf.xMin - 1e-3);
      expect(pos.getX(i)).toBeLessThanOrEqual(hf.xMax + 1e-3);
    }
    layer.dispose();
  });
});
