/**
 * Fire-trail corridors in the canopy (vegetationPlacement.ts, PlacementOptions.clearings): no tree or shrub whose crown
 * would reach into a cleared track is placed, the rest of the forest is unchanged, and the result stays deterministic.
 * Also checks the bundled Katoomba fire trails are cleared.
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { FuelType, type FuelMap } from '../core/types';
import { loadBundledContext } from '../data/contextLayers';
import { DEMO_SITES } from '../data/demoSites';
import { ClearingIndex, placeVegetation, totalInstances, type VegInstances } from './vegetationPlacement';

const origin = { lat: -33.7, lon: 150.3 };

function dryForest(g: GridSpec): FuelMap {
  const n = g.nx * g.ny;
  const a = (v: number): Float32Array => new Float32Array(n).fill(v);
  return {
    grid: g,
    type: new Uint8Array(n).fill(FuelType.DryForestShrubby),
    surfaceHazard: a(3),
    nearSurfaceHazard: a(2),
    nearSurfaceHeight: a(0.4),
    elevatedHazard: a(3),
    elevatedHeight: a(1.5),
    barkHazard: a(2),
    surfaceLoad: a(12),
    nearSurfaceLoad: a(4),
    elevatedLoad: a(5),
    barkLoad: a(2),
    canopyHeight: a(22),
    canopyCover: a(0.7),
    curing: a(60),
    timeSinceFire: a(10),
    lastFireKind: new Uint8Array(n),
    sources: [],
  };
}

/** Distance from (x, y) to a polyline. */
function distTo(xy: Float32Array, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < xy.length; i += 2) {
    const ax = xy[i]!;
    const ay = xy[i + 1]!;
    const vx = xy[i + 2]! - ax;
    const vy = xy[i + 3]! - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(ax + vx * t - x, ay + vy * t - y));
  }
  return best;
}

/** Plants whose crown (half its width) reaches within `half` m of any line. */
function intruders(sets: VegInstances[], lines: Float32Array[], half: number): number {
  let n = 0;
  for (const s of sets)
    for (let i = 0; i < s.count; i++) {
      const x = s.position[i * 3]!;
      const y = s.position[i * 3 + 1]!;
      const w = s.size[i * 2 + 1]!;
      if (lines.some((l) => distTo(l, x, y) < half + 0.5 * w)) n++;
    }
  return n;
}

const heightAt = (): number => 500;

describe('fire-trail corridors', () => {
  const g = makeGridSpec(origin, 3000, 30);
  const fuel = dryForest(g);
  // A dog-leg trail across the middle of the forest.
  const trail = new Float32Array([-1400, -200, 0, 50, 300, 1400]);
  const opts = { budget: 40000, heightAt, focus: [0, 0] as [number, number], focusRadius: 1500, farDensity: 0.5, seed: 3 };

  it('leaves no crown reaching into the cleared track, and leaves the rest of the forest alone', () => {
    const open = placeVegetation(fuel, opts);
    const cleared = placeVegetation(fuel, { ...opts, clearings: { lines: [trail], halfWidth: 4 } });
    expect(intruders(open, [trail], 4)).toBeGreaterThan(50);
    expect(intruders(cleared, [trail], 4)).toBe(0);
    const before = totalInstances(open);
    const after = totalInstances(cleared);
    expect(after).toBeLessThan(before);
    // The corridor is a thin strip: most of the forest stays.
    expect(after / before).toBeGreaterThan(0.85);
    // Away from the trail the very same plants are placed.
    const far = (sets: VegInstances[]): string[] => {
      const out: string[] = [];
      for (const s of sets)
        for (let i = 0; i < s.count; i++) {
          const x = s.position[i * 3]!;
          const y = s.position[i * 3 + 1]!;
          if (distTo(trail, x, y) > 60) out.push(`${s.group}:${x.toFixed(2)},${y.toFixed(2)}`);
        }
      return out.sort();
    };
    expect(far(cleared)).toEqual(far(open));
  });

  it('is deterministic and a null or empty clearing changes nothing', () => {
    const a = placeVegetation(fuel, { ...opts, clearings: { lines: [trail], halfWidth: 4 } });
    const b = placeVegetation(fuel, { ...opts, clearings: { lines: [trail], halfWidth: 4 } });
    expect(totalInstances(a)).toBe(totalInstances(b));
    expect(Array.from(a[0]!.position)).toEqual(Array.from(b[0]!.position));
    expect(totalInstances(placeVegetation(fuel, { ...opts, clearings: null }))).toBe(totalInstances(placeVegetation(fuel, opts)));
    expect(totalInstances(placeVegetation(fuel, { ...opts, clearings: { lines: [], halfWidth: 4 } }))).toBe(totalInstances(placeVegetation(fuel, opts)));
  });

  it('the index answers distances like brute force', () => {
    const idx = new ClearingIndex(g, [trail], 4);
    for (const [x, y] of [
      [0, 0],
      [-700, -80],
      [250, 1100],
      [800, -800],
    ] as const) {
      const i = Math.round((x - g.x0) / g.cellSize);
      const j = Math.round((y - g.y0) / g.cellSize);
      const k = j * g.nx + i;
      const d = distTo(trail, x, y);
      if (d < 20) expect(idx.distance(k, x, y)).toBeCloseTo(d, 3);
      else if (!idx.near(k)) expect(idx.distance(k, x, y)).toBe(Infinity);
    }
  });

  it('clears the bundled Katoomba fire trails', async () => {
    const kat = DEMO_SITES.find((s) => s.id === 'katoomba')!;
    const ctx = (await loadBundledContext('katoomba', kat.centre))!;
    const gk = makeGridSpec(kat.centre, 9000, 30);
    const fk = dryForest(gk);
    const lines = ctx.fireTrails.map((t) => t.xy);
    const o = { budget: 30000, heightAt, focus: [0, 0] as [number, number], focusRadius: 2500, farDensity: 0.3, seed: 7 };
    const open = placeVegetation(fk, o);
    const cleared = placeVegetation(fk, { ...o, clearings: { lines, halfWidth: 4 } });
    expect(intruders(open, lines, 4)).toBeGreaterThan(0);
    expect(intruders(cleared, lines, 4)).toBe(0);
  });
});
