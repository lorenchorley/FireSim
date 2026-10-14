import { describe, expect, it } from 'vitest';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { FuelFlag, FuelType, type FuelMap } from '../core/types';
import { BARK_CODE } from './canopyStyle';
import { sampleRock, type RockCopy } from './rockMask';
import { INSTANCE_BYTES, MAX_VEG_INSTANCES, PlacementJob, VEG_GROUP_COUNT, VegGroup, placeVegetation, splitBudget, totalInstances, type VegInstances } from './vegetationPlacement';

const origin = { lat: -33.7, lon: 150.3 };

function forest(g: GridSpec): FuelMap {
  const n = g.nx * g.ny;
  const a = (v: number): Float32Array => new Float32Array(n).fill(v);
  const type = new Uint8Array(n);
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      // West third heath, middle dry forest, a rainforest gully strip, east grassland, one water column.
      type[k] = i < g.nx / 3 ? FuelType.Heath : i < (2 * g.nx) / 3 ? (j % 20 < 2 ? FuelType.Rainforest : FuelType.DryForestShrubby) : FuelType.Grassland;
      if (i === 0) type[k] = FuelType.Water;
    }
  }
  const cover = a(0);
  const height = a(0);
  for (let k = 0; k < n; k++) {
    if (type[k] === FuelType.DryForestShrubby || type[k] === FuelType.Rainforest) {
      cover[k] = 0.7;
      height[k] = type[k] === FuelType.Rainforest ? 30 : 22;
    } else if (type[k] === FuelType.Heath) {
      cover[k] = 0.05;
      height[k] = 3;
    }
  }
  return {
    grid: g,
    type,
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
    canopyHeight: height,
    canopyCover: cover,
    curing: a(60),
    timeSinceFire: a(10),
    lastFireKind: new Uint8Array(n),
    sources: [],
  };
}

const g = makeGridSpec(origin, 6000, 30);
const fuel = forest(g);
const heightAt = (x: number, y: number): number => 500 + 0.01 * x + 0.02 * y;
const EUC = [VegGroup.Stringybark, VegGroup.Ribbonbark, VegGroup.SmoothGum];
const eucalypts = (v: VegInstances[]): VegInstances[] => EUC.map((gr) => v[gr]!);

describe('placeVegetation', () => {
  it('is deterministic', () => {
    const a = placeVegetation(fuel, { budget: 20000, heightAt, seed: 3 });
    const b = placeVegetation(fuel, { budget: 20000, heightAt, seed: 3 });
    expect(a.map((s) => s.count)).toEqual(b.map((s) => s.count));
    for (let s = 0; s < a.length; s++) {
      expect(Array.from(a[s]!.position)).toEqual(Array.from(b[s]!.position));
      expect(Array.from(a[s]!.size)).toEqual(Array.from(b[s]!.size));
      expect(Array.from(a[s]!.tint)).toEqual(Array.from(b[s]!.tint));
      expect(Array.from(a[s]!.info)).toEqual(Array.from(b[s]!.info));
      expect(Array.from(a[s]!.aux)).toEqual(Array.from(b[s]!.aux));
    }
    const c = placeVegetation(fuel, { budget: 20000, heightAt, seed: 4 });
    const big = a.findIndex((s) => s.count > 100);
    expect(Array.from(c[big]!.position.slice(0, 30))).not.toEqual(Array.from(a[big]!.position.slice(0, 30)));
  });

  it('never exceeds the budget or the hard cap and fills every group array consistently', () => {
    for (const budget of [0, 500, 8000, 30000, 200000]) {
      const v = placeVegetation(fuel, { budget, heightAt });
      expect(totalInstances(v)).toBeLessThanOrEqual(Math.min(budget, MAX_VEG_INSTANCES));
      expect(v).toHaveLength(VEG_GROUP_COUNT);
      for (const s of v) {
        expect(s.position.length).toBe(s.count * 3);
        expect(s.size.length).toBe(s.count * 2);
        expect(s.rand.length).toBe(s.count * 2);
        for (const arr of [s.tint, s.info, s.aux]) expect(arr.length).toBe(s.count * INSTANCE_BYTES);
      }
    }
    expect(totalInstances(placeVegetation(fuel, { budget: 30000, heightAt }))).toBeGreaterThan(20000);
    const half = totalInstances(placeVegetation(fuel, { budget: 30000, heightAt, densityScale: 0.4 }));
    expect(half).toBeLessThanOrEqual(12000);
  });

  it('puts the right species in the right fuel, on the ground, at the height of the canopy data', () => {
    const v = placeVegetation(fuel, { budget: 30000, heightAt });
    const typeAt = (x: number, y: number): FuelType => {
      const i = Math.round((x - g.x0) / g.cellSize);
      const j = Math.round((y - g.y0) / g.cellSize);
      return fuel.type[Math.min(g.ny - 1, Math.max(0, j)) * g.nx + Math.min(g.nx - 1, Math.max(0, i))] as FuelType;
    };
    let inForest = 0;
    let total = 0;
    for (const euc of eucalypts(v)) {
      for (let i = 0; i < euc.count; i += 7) {
        const t = typeAt(euc.position[i * 3]!, euc.position[i * 3 + 1]!);
        // Eucalypts grow in the forest; the sparse heath canopy (5 % cover, 3 m) gives a few emergent mallee.
        expect([FuelType.DryForestShrubby, FuelType.Heath]).toContain(t);
        expect(euc.position[i * 3 + 2]).toBeCloseTo(heightAt(euc.position[i * 3]!, euc.position[i * 3 + 1]!), 3);
        total++;
        if (t === FuelType.DryForestShrubby) {
          inForest++;
          // Tree heights follow the canopy raster (22 m) within natural variation (no exaggeration).
          expect(euc.size[i * 2]).toBeGreaterThan(22 * 0.84);
          expect(euc.size[i * 2]).toBeLessThan(22 * 1.12);
        }
      }
    }
    expect(total).toBeGreaterThan(200);
    expect(inForest).toBeGreaterThan(total / 2);
    // Rainforest patches get rainforest trees, 30 m ± 14 %.
    const rain = v[VegGroup.Rainforest]!;
    expect(rain.count).toBeGreaterThan(0);
    for (let i = 0; i < rain.count; i++) {
      expect(typeAt(rain.position[i * 3]!, rain.position[i * 3 + 1]!)).toBe(FuelType.Rainforest);
      expect(rain.size[i * 2]).toBeGreaterThan(30 * 0.84);
      expect(rain.size[i * 2]).toBeLessThan(30 * 1.12);
    }
    const grass = v[VegGroup.Grass]!;
    for (let i = 0; i < grass.count; i += 23) expect(typeAt(grass.position[i * 3]!, grass.position[i * 3 + 1]!)).toBe(FuelType.Grassland);
    // Nothing in water.
    for (const set of v) for (let i = 0; i < set.count; i++) expect(typeAt(set.position[i * 3]!, set.position[i * 3 + 1]!)).not.toBe(FuelType.Water);
  });

  it('gives identical results with the demand cache and from an incremental job', () => {
    const cache = {};
    const a = placeVegetation(fuel, { budget: 12000, heightAt, focus: [500, 0], cache });
    const b = placeVegetation(fuel, { budget: 12000, heightAt, focus: [500, 0], cache });
    const c = placeVegetation(fuel, { budget: 12000, heightAt, focus: [500, 0] });
    expect(a.map((s) => s.count)).toEqual(c.map((s) => s.count));
    expect(Array.from(b[0]!.position)).toEqual(Array.from(c[0]!.position));
    // The same job run a few microseconds at a time (many steps) gives the very same trees.
    const job = new PlacementJob(fuel, { budget: 12000, heightAt, focus: [500, 0] });
    let steps = 0;
    while (!job.step(0.0001) && steps < 100000) steps++;
    expect(steps).toBeGreaterThan(10);
    expect(job.done).toBe(true);
    for (let s = 0; s < c.length; s++) {
      expect(job.result[s]!.count).toBe(c[s]!.count);
      expect(Array.from(job.result[s]!.position)).toEqual(Array.from(c[s]!.position));
      expect(Array.from(job.result[s]!.aux)).toEqual(Array.from(c[s]!.aux));
    }
  });

  it('is densest around the focus point', () => {
    const v = placeVegetation(fuel, { budget: 15000, heightAt, focus: [0, 0], focusRadius: 800 });
    let near = 0;
    let far = 0;
    for (const euc of eucalypts(v)) {
      for (let i = 0; i < euc.count; i++) {
        const y = euc.position[i * 3 + 1]!;
        // The forest strip is centred on x = 0; compare the same-size band near and far in y.
        if (Math.abs(y) < 500) near++;
        else if (Math.abs(y) > 2000 && Math.abs(y) < 2500) far++;
      }
    }
    expect(near).toBeGreaterThan(2 * far);
  });

  it('keeps the small plants close to the focus so the budget goes to the trees that carry the view', () => {
    const v = placeVegetation(fuel, { budget: 30000, heightAt, focus: [0, 0], focusRadius: 1000 });
    const far = (s: VegInstances): number => {
      let c = 0;
      for (let i = 0; i < s.count; i++) if (Math.hypot(s.position[i * 3]!, s.position[i * 3 + 1]!) > 1500) c++;
      return c / Math.max(1, s.count);
    };
    expect(far(v[VegGroup.Understorey]!)).toBeLessThan(0.05);
    const trees = eucalypts(v);
    expect(trees.reduce((s, t) => s + far(t) * t.count, 0) / trees.reduce((s, t) => s + t.count, 0)).toBeGreaterThan(0.1);
  });
});

describe('species rules', () => {
  const withBark = (mut: (f: FuelMap) => void): VegInstances[] => {
    const f = forest(g);
    f.flags = new Uint16Array(g.nx * g.ny);
    mut(f);
    return placeVegetation(f, { budget: 20000, heightAt });
  };

  it('splits the eucalypts into stringybark, ribbon bark and smooth gum by the fuel flags and the bark hazard', () => {
    // Flags decide when set…
    const flagged = withBark((f) => {
      for (let k = 0; k < f.flags!.length; k++) f.flags![k] = k % 2 === 0 ? FuelFlag.Stringybark : FuelFlag.RibbonBark;
    });
    expect(flagged[VegGroup.Stringybark]!.count).toBeGreaterThan(100);
    expect(flagged[VegGroup.Ribbonbark]!.count).toBeGreaterThan(100);
    expect(flagged[VegGroup.SmoothGum]!.count).toBe(0);
    // …otherwise the bark hazard does.
    const hazard = (h: number): VegInstances[] => withBark((f) => f.barkHazard.fill(h));
    expect(hazard(3.8)[VegGroup.Stringybark]!.count).toBeGreaterThan(100);
    expect(hazard(3.8)[VegGroup.SmoothGum]!.count).toBe(0);
    expect(hazard(0.3)[VegGroup.SmoothGum]!.count).toBeGreaterThan(100);
    expect(hazard(0.3)[VegGroup.Stringybark]!.count).toBe(0);
    expect(hazard(2.4)[VegGroup.Ribbonbark]!.count).toBeGreaterThan(100);
    // The bark code and the bark-hazard byte are stored per tree.
    const s = hazard(3.8)[VegGroup.Stringybark]!;
    expect(s.tint[3]).toBe(BARK_CODE.stringy);
    expect(s.info[0]).toBe(Math.round((Math.fround(3.8) / 4) * 255));
  });

  it('uses the real elevated-fuel height for understorey shrubs and makes them broader with a higher hazard', () => {
    const low = withBark((f) => {
      f.elevatedHazard.fill(1);
      f.elevatedHeight.fill(1.2);
    });
    const high = withBark((f) => {
      f.elevatedHazard.fill(3.6);
      f.elevatedHeight.fill(1.2);
    });
    const meanH = (s: VegInstances): number => {
      let t = 0;
      for (let i = 0; i < s.count; i++) t += s.size[i * 2]!;
      return t / s.count;
    };
    const meanRatio = (s: VegInstances): number => {
      let t = 0;
      for (let i = 0; i < s.count; i++) t += s.size[i * 2 + 1]! / s.size[i * 2]!;
      return t / s.count;
    };
    // Height ≈ the cell's elevated height (±25 % variation), not exaggerated.
    expect(meanH(high[VegGroup.Understorey]!)).toBeGreaterThan(1.2 * 0.85);
    expect(meanH(high[VegGroup.Understorey]!)).toBeLessThan(1.2 * 1.15);
    expect(meanRatio(high[VegGroup.Understorey]!)).toBeGreaterThan(meanRatio(low[VegGroup.Understorey]!));
    // Bytes carry the hazard for the coded style.
    expect(high[VegGroup.Understorey]!.info[1]).toBe(Math.round((Math.fround(3.6) / 4) * 255));
  });

  it('leaves the understorey out (and gives its budget to the others) when it is switched off', () => {
    const on = placeVegetation(fuel, { budget: 20000, heightAt, understorey: true });
    const off = placeVegetation(fuel, { budget: 20000, heightAt, understorey: false });
    expect(off[VegGroup.Understorey]!.count).toBe(0);
    expect(on[VegGroup.Understorey]!.count).toBeGreaterThan(500);
    expect(totalInstances(off)).toBeGreaterThan(0.9 * totalInstances(on));
  });

  it('plants pine plantations in rows and tall wet forest, snow gum and rainforest as their own groups', () => {
    const f = forest(g);
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        if (f.type[k] === FuelType.DryForestShrubby) f.type[k] = i < g.nx / 2 ? FuelType.PinePlantation : FuelType.WetForest;
      }
    }
    f.canopyHeight.forEach((_h, k) => {
      if (f.type[k] === FuelType.WetForest) f.canopyHeight[k] = 48;
    });
    const v = placeVegetation(f, { budget: 30000, heightAt, focusRadius: 4000 });
    const pine = v[VegGroup.Conifer]!;
    expect(pine.count).toBeGreaterThan(300);
    // Rows: after rotating onto the row axes, the across-row coordinate sits on a 5.5 m lattice.
    const ca = Math.cos(0.35);
    const sa = Math.sin(0.35);
    let onLattice = 0;
    for (let i = 0; i < pine.count; i++) {
      const u = pine.position[i * 3]! * ca + pine.position[i * 3 + 1]! * sa;
      const frac = Math.abs(u / 5.5 - Math.round(u / 5.5));
      if (frac < 0.02) onLattice++;
    }
    expect(onLattice / pine.count).toBeGreaterThan(0.95);
    const tall = v[VegGroup.TallWetGum]!;
    expect(tall.count).toBeGreaterThan(100);
    for (let i = 0; i < tall.count; i += 11) expect(tall.size[i * 2]).toBeGreaterThan(48 * 0.85); // very tall, as the data says
  });

  it('records the years since the last fire and colours grass by curing', () => {
    const f = forest(g);
    f.timeSinceFire.fill(NaN);
    f.timeSinceFire.forEach((_, k) => {
      if (k % 3 === 0) f.timeSinceFire[k] = 2;
    });
    f.curing.fill(0);
    const green = placeVegetation(f, { budget: 20000, heightAt });
    f.curing.fill(100);
    const straw = placeVegetation(f, { budget: 20000, heightAt });
    const years = new Set<number>();
    for (const s of green) for (let i = 0; i < s.count; i++) years.add(s.info[i * 4 + 3]!);
    expect(years.has(255)).toBe(true); // no record
    expect(years.has(16)).toBe(true); // 2 years × 8
    const gg = green[VegGroup.Grass]!;
    const ss = straw[VegGroup.Grass]!;
    // Straw is more red than green grass.
    expect(ss.tint[0]! - ss.tint[2]!).toBeGreaterThan(gg.tint[0]! - gg.tint[2]!);
  });
});

describe('splitBudget', () => {
  it('gives unused shares to families with demand', () => {
    const a = splitBudget(1000, [1e6, 0, 0, 0, 0, 1e6, 0, 0]);
    expect(a[1]).toBe(0);
    expect(a[0]! + a[5]!).toBeGreaterThan(990);
    const b = splitBudget(1000, [100, 1e6, 0, 0, 0, 0, 0, 0]);
    expect(b[0]).toBe(100);
    expect(b[1]).toBeGreaterThan(890);
  });
});

describe('bare rock (the rock mask)', () => {
  /** FNV-1a over every array of every group, so two placements can be compared bit for bit with one number. */
  const digest = (v: VegInstances[]): number => {
    let h = 0x811c9dc5;
    const feed = (a: ArrayBufferView): void => {
      const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 0x01000193) >>> 0;
    };
    for (const s of v) {
      feed(new Uint32Array([s.count]));
      for (const a of [s.position, s.size, s.rand, s.tint, s.info, s.aux]) feed(a);
    }
    return h;
  };
  /** The pine and wet-forest variant of the 6 km forest, with a fire trail so the clearing rule runs too. */
  const mixed = (): FuelMap => {
    const f = forest(g);
    for (let k = 0; k < f.type.length; k++) {
      const i = k % g.nx;
      if (f.type[k] === FuelType.DryForestShrubby) f.type[k] = i < g.nx / 2 ? FuelType.PinePlantation : FuelType.WetForest;
    }
    return f;
  };
  const trail = { lines: [new Float32Array([-300, -1500, 200, 1500])], halfWidth: 4 };

  // A rock raster on a 10 m grid over the same 6 km: R as a function of local x and y.
  const rockOf = (fn: (x: number, y: number) => number): RockCopy => {
    const g10 = makeGridSpec(origin, 6000, 10);
    const r = new Uint8Array(g10.nx * g10.ny);
    for (let j = 0; j < g10.ny; j++) for (let i = 0; i < g10.nx; i++) r[j * g10.nx + i] = Math.round(255 * fn(g10.x0 + i * 10, g10.y0 + j * 10));
    return { grid: g10, r };
  };
  const all = (v: VegInstances[]): [number, number, number][] => {
    const out: [number, number, number][] = [];
    for (const s of v) for (let i = 0; i < s.count; i++) out.push([s.position[i * 3]!, s.position[i * 3 + 1]!, s.group]);
    return out;
  };
  // A rock band across the forest: bare for |y| < 300, falling to none at |y| = 400 (R = 0.5 at 350 and 0.2 at 380).
  const band = rockOf((_x, y) => Math.min(1, Math.max(0, (400 - Math.abs(y)) / 100)));

  it('places the scenarios with no mask exactly as before the rule: the digests were taken on the code without it', () => {
    // Taken from the placement code before the rock rule existed (the same two scenarios, same options).
    expect(digest(placeVegetation(fuel, { budget: 20000, heightAt, seed: 3 }))).toBe(3283714147);
    expect(digest(placeVegetation(mixed(), { budget: 30000, heightAt, focusRadius: 4000, clearings: trail }))).toBe(1445165315);
  });

  it('is unchanged by a mask with no rock in it, or by no mask at all', () => {
    const none = rockOf(() => 0);
    const base = placeVegetation(mixed(), { budget: 30000, heightAt, focusRadius: 4000, clearings: trail });
    expect(digest(placeVegetation(mixed(), { budget: 30000, heightAt, focusRadius: 4000, clearings: trail, rock: none }))).toBe(digest(base));
    expect(digest(placeVegetation(mixed(), { budget: 30000, heightAt, focusRadius: 4000, clearings: trail, rock: null }))).toBe(digest(base));
  });

  it('puts no plant where R is 0.5 or more, in any group, and is deterministic', () => {
    const opts = { budget: 40000, heightAt, focusRadius: 4000, clearings: trail, rock: band };
    const a = placeVegetation(mixed(), opts);
    const b = placeVegetation(mixed(), opts);
    expect(digest(a)).toBe(digest(b));
    const free = placeVegetation(mixed(), { ...opts, rock: null });
    // Without the mask there are plenty of plants on the band (so the test can fail), with it none.
    const onBand = (v: VegInstances[]): number => all(v).filter(([x, y]) => sampleRock(band, x, y) >= 0.5 - 1e-4).length;
    expect(onBand(free)).toBeGreaterThan(300);
    expect(onBand(a)).toBe(0);
    expect(totalInstances(a)).toBeLessThan(totalInstances(free));
    expect(a.map((s) => s.count).some((c) => c > 0)).toBe(true);
  });

  it('leaves the plants away from the rock exactly where they were, and thins the edge of the rock between R 0.2 and 0.5', () => {
    const opts = { budget: 40000, heightAt, focusRadius: 4000 };
    const free = all(placeVegetation(fuel, opts));
    const masked = all(placeVegetation(fuel, { ...opts, rock: band }));
    const far = (v: [number, number, number][]): string[] => v.filter(([, y]) => Math.abs(y) > 450).map((p) => p.join(','));
    expect(far(masked)).toEqual(far(free));
    // R falls from 0.5 (|y| = 350) to 0.2 (|y| = 380): about half the plants of a cell of that strip are kept on average.
    const inEdge = (v: [number, number, number][]): number => v.filter(([, y]) => Math.abs(y) >= 350 && Math.abs(y) < 380).length;
    expect(inEdge(free)).toBeGreaterThan(200);
    expect(inEdge(masked) / inEdge(free)).toBeGreaterThan(0.2);
    expect(inEdge(masked) / inEdge(free)).toBeLessThan(0.8);
  });

  it('draws a plant on rock again within its cell before it drops it, so a half-rock cell keeps most of its plants', () => {
    // R is 1 at x = -25 and 0.5 at x = -15 and falls to none by x = -5, so the cells of the column x = -30 to 0 are half bare rock.
    const half = rockOf((x) => (x <= -25 ? 1 : x === -15 ? 0.5 : 0));
    const opts = { budget: 40000, heightAt, focusRadius: 4000 };
    const inColumn = (v: [number, number, number][]): [number, number, number][] => v.filter(([x]) => x >= -30 && x < 0);
    const free = inColumn(all(placeVegetation(fuel, opts)));
    const masked = inColumn(all(placeVegetation(fuel, { ...opts, rock: half })));
    expect(free.length).toBeGreaterThan(400);
    // Per draw: half of the cell is rock (draw again), a fifth is the thin edge (kept about half the time) and three tenths is clear.
    // Four draws keep 0.4 x (1 + 0.5 + 0.25 + 0.125) = 75 % of the plants, where dropping every plant that lands on rock keeps 40 %.
    expect(masked.length / free.length).toBeGreaterThan(0.65);
    for (const [x] of masked) expect(x).toBeGreaterThanOrEqual(-15 - 1e-3);
  });
});
