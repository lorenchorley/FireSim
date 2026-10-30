/**
 * The obstacles of the detailed streaks (0.7.0): the soft doublet round a crown, the Rankine pair behind a site, the canopy the strokes ride on, the choice of
 * the trees that count, the grid that finds them, and the rules that keep it all a function of the world (determinism, order, pan).
 */
import { describe, expect, it } from 'vitest';
import { hash01 } from '../fields';
import {
  crownDiscRadius,
  IO_BLOCK,
  IO_DX,
  IO_DY,
  IO_HIT,
  IO_K,
  IO_MODE,
  IO_NEAR,
  IO_PX,
  IO_PY,
  IO_R,
  IO_X,
  IO_Y,
  IO_Z,
  IO_ZC,
  MAX_CROWNS_CAP,
  Obstacles,
  PIN_GAIN,
  P_BX0,
  P_BX1,
  P_BY0,
  P_BY1,
  P_MPPC,
  P_MX,
  P_MY,
  P_PXM1,
  P_VEX,
  P_WMIN,
  P_ZBASE,
} from './detailObstacles';
import { ORIGIN, topDownCamera } from './glyphOracle.testing';
import { DETAIL_RELIEF, type CrownSet, type DetailRelief } from './glyphTypes';
import { makeGridSpec } from '../../core/grid';
import type { FuelMap } from '../../core/types';

const relief = (tweak: (r: DetailRelief) => void = () => {}): DetailRelief => {
  const r = structuredClone(DETAIL_RELIEF);
  tweak(r);
  return r;
};

/** An obstacle field with the crowns `[x, y, r]` put straight in (no scan), the grid built. */
function field(crowns: readonly [number, number, number][], r: DetailRelief = DETAIL_RELIEF): Obstacles {
  const ob = new Obstacles();
  ob.configure(r, undefined);
  crowns.forEach(([x, y, rad], i) => {
    ob.cx[i] = x;
    ob.cy[i] = y;
    ob.cr[i] = rad;
  });
  ob.nCrowns = crowns.length;
  ob.buildGrid();
  return ob;
}

/** The perturbation, nearness and rim hit at (x, y) for a unit wind along (dx, dy). */
function at(ob: Obstacles, x: number, y: number, dx = 1, dy = 0, mode = 0): { px: number; py: number; near: number; hit: number } {
  const io = ob.io;
  io[IO_X] = x;
  io[IO_Y] = y;
  io[IO_DX] = dx;
  io[IO_DY] = dy;
  io[IO_MODE] = mode;
  ob.perturb();
  return { px: io[IO_PX]!, py: io[IO_PY]!, near: io[IO_NEAR]!, hit: io[IO_HIT]! };
}

/** The same by the textbook formula, summed over every crown (no grid): the soft doublet of potential flow past a cylinder, faded to 0 at 3 r. */
function brute(crowns: readonly [number, number, number][], x: number, y: number, dx: number, dy: number): [number, number] {
  let px = 0;
  let py = 0;
  for (const [cx, cy, r] of crowns) {
    const rx = x - cx;
    const ry = y - cy;
    const d2 = rx * rx + ry * ry;
    if (d2 >= 9 * r * r) continue;
    const a = rx * dx + ry * dy;
    const b = -rx * dy + ry * dx;
    const q = a * a + b * b + 0.35 * 0.35 * r * r;
    const s = (r * r) / (q * q);
    const fade = (1 - d2 / (9 * r * r)) ** 2;
    const ua = -s * (a * a - b * b) * fade;
    const ub = -2 * s * a * b * fade;
    px += ua * dx - ub * dy;
    py += ua * dy + ub * dx;
  }
  return [px, py];
}

describe('the soft doublet round a crown', () => {
  const ob = field([[0, 0, 5]]);

  it('slows the wind at the stagnation point by about four fifths, and turns nothing there (on the axis, nothing across)', () => {
    const p = at(ob, -5, 0);
    // -r^4 / (r^2 + a^2)^2 with a = 0.35 r, faded by (1 - 1/9)^2.
    const bare = -(25 * 25) / (25 + 0.1225 * 25) ** 2;
    expect(p.px).toBeCloseTo(bare * (1 - 25 / 225) ** 2, 9);
    expect(p.py).toBeCloseTo(0, 12);
    expect(p.hit).toBe(0);
  });

  it('is symmetric about the axis: the along part is the same either side, the across part has the opposite sign', () => {
    for (const [x, y] of [[-6, 2], [3, 6], [-2, 9], [7, 4]] as const) {
      const up = at(ob, x, y);
      const down = at(ob, x, -y);
      expect(down.px).toBeCloseTo(up.px, 12);
      expect(down.py).toBeCloseTo(-up.py, 12);
    }
  });

  it('turns an off-axis line away from the crown before it and back toward the axis behind it', () => {
    expect(at(ob, -7, 4).py, 'upwind and to the left: pushed further left').toBeGreaterThan(0);
    expect(at(ob, 7, 4).py, 'downwind and to the left: pulled back').toBeLessThan(0);
    expect(at(ob, -7, -4).py).toBeLessThan(0);
    expect(at(ob, 7, -4).py).toBeGreaterThan(0);
  });

  it('is the same in a wind from any direction (the frame turns with the wind)', () => {
    const a = at(ob, -7, 4, 1, 0);
    for (const deg of [30, 90, 137, 200, 271]) {
      const c = Math.cos((deg * Math.PI) / 180);
      const s = Math.sin((deg * Math.PI) / 180);
      const q = at(ob, -7 * c - 4 * s, -7 * s + 4 * c, c, s); // the same point and wind, turned about the crown
      expect(q.px * c + q.py * s).toBeCloseTo(a.px, 9);
      expect(-q.px * s + q.py * c).toBeCloseTo(a.py, 9);
    }
  });

  it('decays as r squared over d squared away from the crown, and is exactly zero from 3 r on', () => {
    const wide = relief((r) => {
      r.crowns.reach = 1000; // no fade: the pure doublet
    });
    const one = at(field([[0, 0, 1]], wide), -20, 5);
    const two = at(field([[0, 0, 2]], wide), -20, 5);
    expect(Math.hypot(two.px, two.py) / Math.hypot(one.px, one.py)).toBeCloseTo(4, 1); // r squared
    const near = at(field([[0, 0, 1]], wide), -20, 5);
    const far = at(field([[0, 0, 1]], wide), -40, 10);
    expect(Math.hypot(near.px, near.py) / Math.hypot(far.px, far.py)).toBeCloseTo(4, 1); // 1 / d squared
    expect(at(ob, 15.0001, 0)).toMatchObject({ px: 0, py: 0 });
    expect(at(ob, 0, -15.5)).toMatchObject({ px: 0, py: 0 });
    expect(Math.hypot(at(ob, 14.9, 0).px, at(ob, 14.9, 0).py)).toBeGreaterThan(0);
  });

  it('never makes more than 1.2 of the wind, anywhere outside the rim (the softening keeps the stagnation point finite)', () => {
    let worst = 0;
    for (let x = -16; x <= 16; x += 0.25) {
      for (let y = -16; y <= 16; y += 0.25) {
        if (Math.hypot(x, y) < 0.85 * 5) continue;
        const p = at(ob, x, y);
        worst = Math.max(worst, Math.hypot(p.px, p.py));
      }
    }
    expect(worst).toBeGreaterThan(0.5);
    expect(worst).toBeLessThanOrEqual(1.2);
  });

  it('says how near it is (1 on the crown, 0 from 2.5 r) and when a point is inside the rim (0.85 r)', () => {
    expect(at(ob, 0.5, 0).hit).toBe(1);
    expect(at(ob, 4.2, 0).hit).toBe(1);
    expect(at(ob, 4.3, 0).hit).toBe(0);
    expect(at(ob, 4.3, 0).near).toBe(1); // PIN_GAIN x (1 - 4.3 / 12.5) is over 1
    expect(at(ob, 8, 0).near).toBeCloseTo(PIN_GAIN * (1 - 8 / 12.5), 9);
    expect(at(ob, 6.25, 0).near, 'the whole depth from half way in').toBe(1);
    expect(at(ob, 12.5, 0).near).toBe(0);
    expect(at(ob, 30, 0).near).toBe(0);
    expect(at(ob, 4.2, 0, 1, 0, 1).hit, 'the rim test alone').toBe(1);
    expect(at(ob, 6, 0, 1, 0, 1)).toMatchObject({ px: 0, py: 0, hit: 0 });
  });

  it('seeds inside 0.8 r of a crown are blocked, and none outside it', () => {
    const io = ob.io;
    const blocked = (x: number, y: number): number => {
      io[IO_X] = x;
      io[IO_Y] = y;
      ob.blocked();
      return io[IO_BLOCK]!;
    };
    expect(blocked(0, 0)).toBe(1);
    expect(blocked(3.9, 0)).toBe(1);
    expect(blocked(4.1, 0)).toBe(0);
    expect(blocked(100, 100)).toBe(0);
    expect(field([]).io[IO_BLOCK]).toBe(0);
  });
});

describe('the Rankine pair behind a site', () => {
  /** A site of radius 5 at the origin, wind along +x. The vortices are 8.5 m downwind and 4.5 m either side; the core is 3.5 m. */
  const site = (strength = 1): Obstacles => {
    const ob = new Obstacles();
    ob.configure(DETAIL_RELIEF, undefined);
    ob.view.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    ob.p[P_PXM1] = 1000;
    ob.p[P_WMIN] = -1e9;
    const io = ob.io;
    io[IO_X] = 0;
    io[IO_Y] = 0;
    io[IO_R] = 5;
    io[IO_DX] = 1;
    io[IO_DY] = 0;
    io[IO_K] = strength;
    io[IO_Z] = 0;
    ob.addSite();
    expect(io[IO_BLOCK]).toBe(1);
    return ob;
  };

  it('turns the upper vortex clockwise and the lower anticlockwise, and reverses the flow on the axis between them', () => {
    const ob = site();
    // East of the upper vortex (8.5, 4.5) a clockwise flow points south; east of the lower one (8.5, -4.5) an anticlockwise one points north.
    expect(at(ob, 11, 4.5).py).toBeLessThan(0);
    expect(at(ob, 11, -4.5).py).toBeGreaterThan(0);
    expect(at(ob, 6, 4.5).py, 'west of the upper vortex: north').toBeGreaterThan(0);
    // On the axis both push back toward the crowns.
    expect(at(ob, 8.5, 0).px).toBeLessThan(-0.3);
    expect(at(ob, 8.5, 0).py).toBeCloseTo(0, 9);
  });

  it('has the speed `kappa x rv / a` inside the core and `kappa x a / rv` outside it (faded from two cores to 3.2 r), and nothing from 3.2 r: the formulas of the contract, summed over the pair', () => {
    const ob = site();
    const kappa = 0.6;
    const r = 5;
    const a = 0.7 * r;
    const reach = 3.2 * r;
    /** The textbook pair for the wind along +x: the upper vortex (to the left) clockwise, the lower anticlockwise. */
    const oracle = (x: number, y: number): [number, number] => {
      let px = 0;
      let py = 0;
      for (const side of [1, -1]) {
        const rx = x - 1.7 * r;
        const ry = y - side * 0.9 * r;
        const rv = Math.hypot(rx, ry);
        if (rv >= reach || rv === 0) continue;
        let t = rv < a ? (kappa * rv) / a : (kappa * a) / rv;
        if (rv > 2 * a) t *= (1 - (rv - 2 * a) / (reach - 2 * a)) ** 2;
        // clockwise (upper): (ry, -rx) / rv; anticlockwise (lower): (-ry, rx) / rv
        px += (side * t * ry) / rv;
        py += (-side * t * rx) / rv;
      }
      return [px, py];
    };
    let inCore = 0;
    let outCore = 0;
    for (const [x, y] of [[8.5 + 0.5 * a, 4.5], [8.5, 4.5 + 0.8 * a], [8.5 - 2, 4.5 + 1], [8.5 + 1.2 * a, 4.5], [8.5 + 2 * a, 4.5], [8.5 + 2.5 * a, 4.5 - 1], [14, 8], [20, 0], [8.5, 0], [3, -6], [-1, 3], [8.5 + 3.2 * 5 + 0.1, 4.5]] as const) {
      const p = at(ob, x, y);
      const [ox, oy] = oracle(x, y);
      expect(p.px, `x ${x} y ${y}`).toBeCloseTo(ox, 6);
      expect(p.py, `x ${x} y ${y}`).toBeCloseTo(oy, 6);
      if (Math.hypot(x - 8.5, y - 4.5) < a) inCore++;
      else outCore++;
    }
    expect(inCore).toBeGreaterThan(2);
    expect(outCore).toBeGreaterThan(5);
    expect(at(ob, 8.5 + 3.2 * 5 + 0.1, 4.5)).toMatchObject({ px: 0, py: 0 });
    expect(at(ob, 100, 100)).toMatchObject({ px: 0, py: 0, near: 0 });
  });

  it('peaks at `kappa` at the edge of the core of a vortex that is alone in its reach, and is the pin around its core', () => {
    const ob = site();
    const edge = at(ob, 8.5 + 3.5, 4.5 + 0.0001);
    expect(Math.hypot(edge.px, edge.py)).toBeGreaterThan(0.4);
    expect(Math.hypot(edge.px, edge.py)).toBeLessThanOrEqual(0.6 + 0.05);
    expect(at(ob, 8.5, 4.5).near, 'the pin is 1 at a core').toBe(1);
    expect(at(ob, 8.5 + 12.5, 4.5).near, 'and 0 at 2.5 r from it').toBeCloseTo(0, 6);
    expect(at(ob, 8.5 + 9.4, 4.5).near, 'and rising by PIN_GAIN toward it').toBeCloseTo(PIN_GAIN * (1 - 9.4 / 12.5), 9);
  });

  it('scales with the strength of the site, and is turned with the wind', () => {
    const full = at(site(1), 11, 4.5);
    const half = at(site(0.5), 11, 4.5);
    expect(half.py).toBeCloseTo(0.5 * full.py, 9);
    expect(half.px).toBeCloseTo(0.5 * full.px, 9);
  });

  it('is not used when its core would be under 10 px across, or behind the eye, and not beyond the room', () => {
    const ob = new Obstacles();
    ob.configure(DETAIL_RELIEF, undefined);
    ob.view.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // w = 1 everywhere: pixels a metre = pxm1
    ob.p[P_WMIN] = 0.5;
    const io = ob.io;
    const tryAdd = (r: number, pxm1: number): number => {
      ob.p[P_PXM1] = pxm1;
      io[IO_X] = 0;
      io[IO_Y] = 0;
      io[IO_R] = r;
      io[IO_DX] = 1;
      io[IO_DY] = 0;
      io[IO_K] = 1;
      io[IO_Z] = 0;
      ob.addSite();
      return io[IO_BLOCK]!;
    };
    // The core is 2 x 0.7 x r metres across: 14 m for r = 10.
    expect(tryAdd(10, 0.6)).toBe(0); // 8.4 px
    expect(tryAdd(10, 0.8)).toBe(1); // 11.2 px
    ob.view[15] = 0.1; // w under the near limit
    expect(tryAdd(10, 100)).toBe(0);
    ob.view[15] = 1;
    for (let i = 0; i < 100; i++) tryAdd(10, 100);
    expect(ob.nSites).toBe(DETAIL_RELIEF.eddies.maxEddies);
    expect(ob.siteRoom).toBe(0);
  });
});

describe('the grid finds every crown within reach', () => {
  const random = (n: number, seed: number, extent: number): [number, number, number][] =>
    Array.from({ length: n }, (_, i) => [(hash01(i, seed, 1) - 0.5) * extent, (hash01(i, seed, 2) - 0.5) * extent, 2 + hash01(i, seed, 3) * 8]);

  it('gives the same perturbation as a sum over every crown (no grid), at random points and in random winds', () => {
    for (const [n, extent] of [[40, 200], [300, 600], [1000, 1500]] as const) {
      const crowns = random(n, n, extent);
      const ob = field(crowns);
      let worst = 0;
      let touched = 0;
      for (let k = 0; k < 300; k++) {
        const x = (hash01(k, n, 4) - 0.5) * extent * 1.1;
        const y = (hash01(k, n, 5) - 0.5) * extent * 1.1;
        const ang = hash01(k, n, 6) * 2 * Math.PI;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        // Inside a rim the point is a hit and the field is not wanted.
        if (crowns.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < 0.85 * r)) continue;
        const p = at(ob, x, y, dx, dy);
        const [bx, by] = brute(crowns, x, y, dx, dy);
        worst = Math.max(worst, Math.abs(p.px - bx), Math.abs(p.py - by));
        if (Math.hypot(bx, by) > 1e-3) touched++;
      }
      expect(touched, `${n} crowns: points that feel one`).toBeGreaterThan(20);
      expect(worst, `${n} crowns`).toBeLessThan(1e-4); // Float32 positions and radii
    }
  });

  it('is the same whatever order the crowns come in (up to rounding of the sum)', () => {
    const crowns = random(200, 7, 400);
    const a = field(crowns);
    const b = field([...crowns].reverse());
    for (let k = 0; k < 100; k++) {
      const x = (hash01(k, 7, 4) - 0.5) * 440;
      const y = (hash01(k, 7, 5) - 0.5) * 440;
      if (crowns.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < 0.85 * r)) continue;
      const p = at(a, x, y, 0.6, 0.8);
      const q = at(b, x, y, 0.6, 0.8);
      expect(q.px).toBeCloseTo(p.px, 9);
      expect(q.py).toBeCloseTo(p.py, 9);
    }
  });

  it('holds the crowns it was given in a grid of at most 64 x 64 cells with the cell at least twice the longest reach', () => {
    const crowns = random(1000, 9, 20000); // a sparse forest over 20 km
    const ob = field(crowns);
    const p = at(ob, crowns[10]![0] + crowns[10]![2] * 1.5, crowns[10]![1]);
    expect(Math.hypot(p.px, p.py)).toBeGreaterThan(0);
    // A point nowhere near any crown is not an error.
    expect(at(ob, 1e6, 1e6)).toMatchObject({ px: 0, py: 0, near: 0, hit: 0 });
    expect(at(field([]), 0, 0)).toMatchObject({ px: 0, py: 0, near: 0, hit: 0 });
  });
});

describe('the crown that a stroke cuts', () => {
  it('is the cross-section of its ellipsoid at the stroke: the full width at the middle, none under the base or over the top', () => {
    // A tree 20 m high and 8 m wide: the crown's middle is at 14 m, its base at 8 m, its top at 20 m.
    expect(crownDiscRadius(20, 8, 14, 0.7, 0.3)).toBeCloseTo(4, 12);
    expect(crownDiscRadius(20, 8, 7.9, 0.7, 0.3)).toBe(0);
    expect(crownDiscRadius(20, 8, 8, 0.7, 0.3)).toBe(0);
    expect(crownDiscRadius(20, 8, 20, 0.7, 0.3)).toBe(0);
    expect(crownDiscRadius(20, 8, 21, 0.7, 0.3)).toBe(0);
    expect(crownDiscRadius(20, 8, 11, 0.7, 0.3)).toBeCloseTo(4 * Math.sqrt(1 - 0.25), 12); // half way up the lower half
    expect(crownDiscRadius(20, 8, 17, 0.7, 0.3)).toBeCloseTo(4 * Math.sqrt(1 - 0.25), 12);
    expect(crownDiscRadius(0, 8, 1, 0.7, 0.3)).toBe(0);
    expect(crownDiscRadius(20, 0, 14, 0.7, 0.3)).toBe(0);
    expect(crownDiscRadius(20, NaN, 14, 0.7, 0.3)).toBe(0);
  });
});

describe('the canopy the strokes ride on', () => {
  const grid = makeGridSpec(ORIGIN, 600, 30); // 20 x 20 cells of 30 m, centred
  const fuel = (h: (i: number, j: number) => number, c: (i: number, j: number) => number): FuelMap => {
    const n = grid.nx * grid.ny;
    const height = new Float32Array(n);
    const cover = new Float32Array(n);
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        height[j * grid.nx + i] = h(i, j);
        cover[j * grid.nx + i] = c(i, j);
      }
    }
    return { grid, canopyHeight: height, canopyCover: cover } as unknown as FuelMap;
  };
  const zc = (ob: Obstacles, x: number, y: number): number => {
    ob.io[IO_X] = x;
    ob.io[IO_Y] = y;
    ob.canopyAt();
    return ob.io[IO_ZC]!;
  };
  const make = (f: FuelMap | undefined, r: DetailRelief = DETAIL_RELIEF): Obstacles => {
    const ob = new Obstacles();
    ob.configure(r, f);
    return ob;
  };

  it('is 85 % of the canopy height where there is cover of a third or more, and nothing without a canopy', () => {
    const ob = make(fuel(() => 24, () => 0.7));
    expect(ob.hasCanopy).toBe(true);
    expect(zc(ob, 10, 10)).toBeCloseTo(0.85 * 24, 5);
    expect(zc(ob, -250, 250)).toBeCloseTo(0.85 * 24, 5);
    const bare = make(undefined);
    expect(bare.hasCanopy).toBe(false);
    expect(zc(bare, 10, 10)).toBe(0);
  });

  it('weighs the height by the cover (a third of the cover is the whole weight, open woodland below it keeps a ground stroke) and holds the height to 60 m', () => {
    expect(zc(make(fuel(() => 24, () => 0.15)), 0, 0)).toBeCloseTo(0.85 * 24 * 0.5, 5);
    expect(zc(make(fuel(() => 24, () => 0)), 0, 0)).toBe(0);
    expect(zc(make(fuel(() => 24, () => 0.3)), 0, 0)).toBeCloseTo(0.85 * 24, 5);
    expect(zc(make(fuel(() => 24, () => 1)), 0, 0)).toBeCloseTo(0.85 * 24, 5);
    expect(zc(make(fuel(() => 90, () => 1)), 0, 0)).toBeCloseTo(0.85 * 60, 5);
    expect(zc(make(fuel(() => NaN, () => 1)), 0, 0)).toBe(0);
    expect(zc(make(fuel(() => 24, () => NaN)), 0, 0)).toBe(0);
    expect(zc(make(fuel(() => -3, () => 1)), 0, 0)).toBe(0);
  });

  it('climbs smoothly across the edge of a stand: bilinear, a ramp of one cell, no step', () => {
    const edge = make(fuel((i) => (i >= 10 ? 24 : 0), () => 1));
    const x0 = grid.x0 + 9 * 30; // the centre of the last cell without canopy
    const samples = Array.from({ length: 31 }, (_, k) => zc(edge, x0 + k, 0));
    expect(samples[0]).toBeCloseTo(0, 6);
    expect(samples[30]).toBeCloseTo(0.85 * 24, 5);
    let steepest = 0;
    for (let k = 1; k < samples.length; k++) steepest = Math.max(steepest, Math.abs(samples[k]! - samples[k - 1]!));
    expect(steepest, 'metres a metre along the flow').toBeCloseTo((0.85 * 24) / 30, 5);
    expect(samples[15]).toBeCloseTo(0.85 * 12, 5);
  });

  it('holds the edge value beyond the grid, and ignores a canopy that does not fit its grid', () => {
    const ob = make(fuel(() => 24, () => 1));
    expect(zc(ob, 1e6, -1e6)).toBeCloseTo(0.85 * 24, 5);
    const bad = fuel(() => 24, () => 1);
    (bad as { canopyHeight: Float32Array }).canopyHeight = new Float32Array(10);
    expect(make(bad).hasCanopy).toBe(false);
    expect(make({ grid: { ...grid, nx: 1 }, canopyHeight: new Float32Array(400), canopyCover: new Float32Array(400) } as unknown as FuelMap).hasCanopy).toBe(false);
  });
});

describe('which trees count as crowns', () => {
  /** A top view from above (a model cell of `cellPx` px): the picture's numbers as the builder hands them over. */
  function scene(cellPx: number, f?: FuelMap, r: DetailRelief = DETAIL_RELIEF): Obstacles {
    const cam = topDownCamera(133, cellPx, 0, 0, { near: 5 }, 0);
    const ob = new Obstacles();
    ob.configure(r, f);
    ob.view.set(cam.viewProj);
    ob.p[P_PXM1] = cam.pxPerMetre1;
    ob.p[P_WMIN] = 1.5 * cam.near;
    ob.p[P_MX] = 3;
    ob.p[P_MY] = 3;
    ob.p[P_ZBASE] = 1.5;
    ob.p[P_VEX] = 1;
    ob.p[P_MPPC] = cam.distance / cam.pxPerMetre1;
    ob.p[P_BX0] = ob.p[P_BY0] = -1e9;
    ob.p[P_BX1] = ob.p[P_BY1] = 1e9;
    return ob;
  }
  const trees = (list: readonly [number, number, number, number][], group = 0): CrownSet => {
    const n = list.length;
    const position = new Float32Array(3 * n);
    const size = new Float32Array(2 * n);
    list.forEach(([x, y, h, w], i) => {
      position.set([x, y, 0], 3 * i);
      size.set([h, w], 2 * i);
    });
    return { group, count: n, position, size };
  };
  const clockless = (): number => 0;
  const flat = (h: number, cover = 1): FuelMap => {
    const g = makeGridSpec(ORIGIN, 600, 30);
    const n = g.nx * g.ny;
    return { grid: g, canopyHeight: new Float32Array(n).fill(h), canopyCover: new Float32Array(n).fill(cover) } as unknown as FuelMap;
  };
  const chosen = (ob: Obstacles, ...sets: CrownSet[]): [number, number, number][] => {
    ob.beginScan(sets);
    expect(ob.scan(clockless, Infinity, 4096)).toBe(true);
    return Array.from({ length: ob.nCrowns }, (_, i) => [ob.cx[i]!, ob.cy[i]!, ob.cr[i]!]);
  };

  it('keeps a tree whose crown the stroke cuts, with the disc the ellipsoid shows there, and leaves the lower ones to be flown over', () => {
    // Canopy 24 m: the stroke is at 20.4 m. A tree of 30 m, 10 m wide is cut at (20.4 - 21) / 9 = -0.067 of its half height: nearly its full width.
    const ob = scene(1000, flat(24));
    const got = chosen(ob, trees([[0, 0, 30, 10], [8, 0, 20, 8], [-8, 0, 22.5, 8], [0, 8, 12, 6], [16, 0, 21.5, 8]]));
    // The 30 m tree and the 22.5 m one stand 1.5 m over the stroke; the 20 m and the 21.5 m ones do not (under the stroke, or short of the 1.5 m); the 12 m one is flown over.
    expect(got).toHaveLength(2);
    expect(got[0]).toEqual([0, 0, expect.closeTo(crownDiscRadius(30, 10, 20.4, 0.7, 0.3), 3)]);
    expect(got[0]![2]).toBeGreaterThan(4.9);
    expect(got[1]).toEqual([-8, 0, expect.closeTo(crownDiscRadius(22.5, 8, 20.4, 0.7, 0.3), 3)]);
    expect(got[1]![2]).toBeLessThan(0.8 * 4);
  });

  it('counts only trees (groups 0 to 6), not heath, understorey or grass', () => {
    const list: [number, number, number, number][] = [[0, 0, 30, 10]];
    for (const [group, want] of [[0, 1], [3, 1], [6, 1], [7, 0], [8, 0], [9, 0]] as const) expect(chosen(scene(1000, flat(24)), trees(list, group)), `group ${group}`).toHaveLength(want);
  });

  it('keeps no tree where the stroke is on the ground (no canopy, or open woodland): it passes under every crown', () => {
    const list: [number, number, number, number][] = [[0, 0, 30, 10], [5, 5, 18, 8]];
    expect(chosen(scene(1000), trees(list))).toHaveLength(0);
    expect(chosen(scene(1000, flat(24, 0)), trees(list))).toHaveLength(0);
  });

  it('keeps a crown only when its disc is at least 4 px across the radius on the screen, and only where it is on the screen', () => {
    // At 300 px a cell 1 m is 2.26 px; the disc of the 30 m tree is about 5 m: 11 px. Zoomed out to 40 px a cell it is 1.5 px: left out.
    expect(chosen(scene(300, flat(24)), trees([[0, 0, 30, 10]]))).toHaveLength(1);
    expect(chosen(scene(40, flat(24)), trees([[0, 0, 30, 10]]))).toHaveLength(0);
    // A top view of 1000 px a cell is 412 px = 55 m wide: a tree 500 m away is off it (even with a margin of 3 screens it is not).
    const ob = scene(1000, flat(24));
    ob.p[P_MX] = 1;
    ob.p[P_MY] = 1;
    expect(chosen(ob, trees([[500, 0, 30, 10], [3, 0, 30, 10]]))).toHaveLength(1);
  });

  it('passes over a tree outside the box of the seeds (grown by the builder) before it projects it', () => {
    const ob = scene(1000, flat(24));
    const list: [number, number, number, number][] = [[0, 0, 30, 10], [3, 3, 30, 10], [3000, 0, 30, 10], [0, -3000, 30, 10]];
    // Wide open: the two trees near the middle count (the far ones are off the screen as well: the screen test passes them over too).
    expect(chosen(ob, trees(list))).toHaveLength(2);
    // The same two with the box shrunk to a few metres: one is inside it.
    const small = scene(1000, flat(24));
    small.p[P_BX0] = -1;
    small.p[P_BX1] = 1;
    small.p[P_BY0] = -1;
    small.p[P_BY1] = 1;
    expect(chosen(small, trees(list))).toEqual([[0, 0, expect.any(Number)]]);
    // And a box that excludes everything leaves nothing, whatever the trees.
    small.p[P_BX0] = 100;
    small.p[P_BX1] = 200;
    expect(chosen(small, trees(list))).toHaveLength(0);
  });

  it('gates the crowns by the zoom: a 5 m crown must be at least 8 px across at the middle of the screen (a camera nearer than about 580 m)', () => {
    expect(scene(300, flat(24)).crownsWanted()).toBe(true); // 0.44 m a pixel
    expect(scene(150, flat(24)).crownsWanted(), '0.89 m a pixel: a 5 m crown is under 6 px').toBe(false);
    const wide = scene(300, flat(24));
    wide.p[P_MPPC] = 0.6;
    expect(wide.crownsWanted()).toBe(true);
    wide.p[P_MPPC] = 0.7;
    expect(wide.crownsWanted()).toBe(false);
    wide.p[P_MPPC] = 0;
    expect(wide.crownsWanted()).toBe(false);
  });

  it('never holds more than maxCrowns, counts what did not fit, and the same trees give the same crowns every time', () => {
    const n = 3000;
    const list: [number, number, number, number][] = Array.from({ length: n }, (_, i) => [(hash01(i, 1, 1) - 0.5) * 50, (hash01(i, 1, 2) - 0.5) * 50, 28 + hash01(i, 1, 3) * 6, 5 + hash01(i, 1, 4)]);
    const ob = scene(1000, flat(24));
    const a = chosen(ob, trees(list));
    expect(ob.nCrowns).toBeLessThanOrEqual(MAX_CROWNS_CAP);
    expect(ob.nCrowns).toBe(DETAIL_RELIEF.crowns.maxCrowns);
    expect(ob.overflow).toBeGreaterThan(0);
    const b = chosen(scene(1000, flat(24)), trees(list));
    expect(b).toEqual(a);
    const small = scene(1000, flat(24), relief((r) => (r.crowns.maxCrowns = 10)));
    expect(chosen(small, trees(list))).toHaveLength(10);
  });

  it('scans in slices that stop on the clock and resume, and finds the same crowns as one pass', () => {
    const n = 5000;
    const list: [number, number, number, number][] = Array.from({ length: n }, (_, i) => [(hash01(i, 2, 1) - 0.5) * 50, (hash01(i, 2, 2) - 0.5) * 50, 28 + hash01(i, 2, 3) * 6, 5 + hash01(i, 2, 4)]);
    const whole = chosen(scene(1000, flat(24)), trees(list));
    const ob = scene(1000, flat(24));
    ob.beginScan([trees(list)]);
    let t = 0;
    const clock = (): number => (t += 1);
    let slices = 0;
    while (!ob.scan(clock, t + 20, 64)) {
      slices++;
      expect(slices).toBeLessThan(1000);
    }
    expect(slices).toBeGreaterThan(2);
    expect(Array.from({ length: ob.nCrowns }, (_, i) => [ob.cx[i]!, ob.cy[i]!, ob.cr[i]!])).toEqual(whole);
  });

  it('is a function of the trees, not of their order in a set or of the other sets', () => {
    const list: [number, number, number, number][] = Array.from({ length: 400 }, (_, i) => [(hash01(i, 3, 1) - 0.5) * 50, (hash01(i, 3, 2) - 0.5) * 50, 28 + hash01(i, 3, 3) * 6, 5 + hash01(i, 3, 4)]);
    const key = (c: [number, number, number][]): string[] => c.map(([x, y, r]) => `${x.toFixed(3)},${y.toFixed(3)},${r.toFixed(3)}`).sort();
    const a = chosen(scene(1000, flat(24)), trees(list));
    const b = chosen(scene(1000, flat(24)), trees([...list].reverse()));
    expect(key(b)).toEqual(key(a));
    const split = chosen(scene(1000, flat(24)), trees(list.slice(0, 200)), trees(list.slice(200)));
    expect(key(split)).toEqual(key(a));
  });
});

describe('the proud crowns that become eddy sites', () => {
  /** Crowns of the given plan radii put in by a scan (trees 32 m high where `proud`, else 22.5 m, over a stroke at 20.4 m), the grid built. */
  const sceneWith = (crowns: [number, number, number][], proud: boolean[], keep = 0.5): Obstacles => {
    const g = makeGridSpec(ORIGIN, 600, 30);
    const n = g.nx * g.ny;
    const ob = new Obstacles();
    ob.configure(relief((r) => (r.eddies.keep = keep)), { grid: g, canopyHeight: new Float32Array(n).fill(24), canopyCover: new Float32Array(n).fill(1) } as unknown as FuelMap);
    ob.view.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    ob.p[P_WMIN] = -1e9;
    ob.p[P_MX] = 1e9;
    ob.p[P_MY] = 1e9;
    ob.p[P_ZBASE] = 1.5;
    ob.p[P_VEX] = 1;
    ob.p[P_PXM1] = 1000;
    ob.p[P_BX0] = ob.p[P_BY0] = -1e9;
    ob.p[P_BX1] = ob.p[P_BY1] = 1e9;
    const position = new Float32Array(3 * crowns.length);
    const size = new Float32Array(2 * crowns.length);
    crowns.forEach(([x, y, r], i) => {
      position.set([x, y, 0], 3 * i);
      size.set([proud[i] ? 32 : 22.5, 2 * r], 2 * i);
    });
    ob.beginScan([{ group: 0, count: crowns.length, position, size }]);
    expect(ob.scan(() => 0, Infinity, 4096)).toBe(true);
    ob.buildGrid();
    return ob;
  };
  const offered = (ob: Obstacles, room = 40): string[] => {
    const out = new Int16Array(40);
    const m = ob.proudCandidates(out, room);
    return Array.from(out.subarray(0, m), (i) => `${ob.cx[i]},${ob.cy[i]}`).sort();
  };

  it('offers a proud crown that stands free, and not one with a neighbour within 2.2 radii, and not one that is no taller than the stand needs (no wake)', () => {
    const ob = sceneWith(
      [
        [0, 0, 5], // proud and free
        [100, 0, 5], // proud, with a neighbour 8 m away (under 2.2 r)
        [108, 0, 5],
        [200, 0, 5], // a crown, but not proud (2.1 m over the stroke)
        [300, 0, 5], // proud and free
      ],
      [true, true, true, false, true],
      2, // every priority passes: only the rules are tested
    );
    expect(ob.nCrowns).toBe(5);
    expect(offered(ob)).toEqual(['0,0', '300,0']);
  });

  it('keeps a crown or drops it by its own place only: the same crown has its wake or has none whatever else is around', () => {
    const lone = sceneWith([[40, 40, 5]], [true]);
    const crowded = sceneWith([[40, 40, 5], [-400, 300, 5], [500, -200, 5], [-300, -300, 6]], [true, true, true, true]);
    expect(offered(lone).includes('40,40')).toBe(offered(crowded).includes('40,40'));
    // And about half of a set of free crowns win their priority.
    const many: [number, number, number][] = Array.from({ length: 80 }, (_, i) => [(i % 10) * 60 - 270, Math.floor(i / 10) * 60 - 240, 5]);
    const won = offered(sceneWith(many, many.map(() => true)), 80).length;
    expect(won).toBeGreaterThan(20);
    expect(won).toBeLessThan(60);
  });

  it('offers at most the room it is given, and those are among the ones it would offer with room to spare', () => {
    const crowns: [number, number, number][] = Array.from({ length: 60 }, (_, i) => [(i % 10) * 60 - 270, Math.floor(i / 10) * 60 - 150, 5]);
    const ob = sceneWith(crowns, crowns.map(() => true));
    const all = offered(ob);
    expect(all.length).toBeGreaterThan(5);
    const few = offered(ob, 3);
    expect(few.length).toBeLessThanOrEqual(3);
    expect(few.length).toBeGreaterThan(0);
    for (const k of few) expect(all).toContain(k);
    expect(offered(ob, 0)).toEqual([]);
  });
});
