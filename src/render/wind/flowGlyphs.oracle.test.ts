/**
 * The raster design against its oracle (spike S3, plan 9.3): the flow lines the builder traces through a raster of the wind at a
 * height end where direct tracing through the 3-D air (`AtmosphereSampler.windP` at every step) ends, to within a pixel at the
 * model's column spacing and half a pixel at half of it (S3 measured 0.47 and 0.21 px on a real Katoomba field for a model cell
 * of 60 px). The field here is analytic but has what makes the two differ: wind that changes with height above the ground and
 * with position, over relief and 10 m ground detail that the model's columns do not hold. Its ground detail and turning with height
 * are set so that the error at the model's spacing is about S3's (0.45 to 0.55 px), so the limits are as tight as the spike found
 * them and not far above a field that is easy.
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../../core/grid';
import { AtmosphereSampler } from '../atmosphereSampler';
import { HeightField } from '../heightfield';
import { makeAirView } from '../slice/testing';
import { createGlyphBuilder, type GlyphOutputDetail } from './flowGlyphs';
import { HeightRaster, surfaceRaster } from './glyphField';
import { buildAll, clipW, DirectOracle, glyphsOf, groundOf, makeScenario, ORIGIN, segmentLength, topDownCamera, type Glyph } from './glyphOracle.testing';
import type { FlowRaster } from './glyphTypes';

const CELL = 133;
const GRID = makeGridSpec(ORIGIN, 45 * CELL, CELL);
const BASE = 500;
const MODEL_GROUND = (x: number, y: number): number => BASE + 230 + 160 * Math.sin(x / 1100) * Math.cos(y / 900) + 120 * Math.sin(x / 250 + y / 310);
// The 10 m ground: the model's, with the detail the columns cannot hold.
const GROUND = groundOf({ nx: 150, ny: 150, cellSize: 40, x0: GRID.x0, y0: GRID.y0, origin: ORIGIN }, (x, y) => MODEL_GROUND(x, y) + 70 * Math.sin(x / 150 + y / 190) + 50 * Math.cos(x / 230 - y / 120) + 40 * Math.sin(x / 95 - y / 85));
const HF = new HeightField(GROUND.grid, GROUND.elevation);

/** A boundary-layer-like wind: a log profile in the height above the model's ground, speed-ups over the relief, a turn with height and position. */
function speed(x: number, y: number, z: number): number {
  const agl = Math.max(0, z - (MODEL_GROUND(x, y) - 25));
  return 3.5 + 2.4 * Math.log(1 + agl / 20) + 1.6 * Math.sin(x / 900) * Math.cos(y / 700);
}
function bearing(x: number, y: number, z: number): number {
  const agl = Math.max(0, z - (MODEL_GROUND(x, y) - 25));
  return 0.3 * Math.sin(x / 1500) + 0.2 * Math.cos(y / 1100) + 0.0015 * agl;
}
const view = (() => {
  const v = makeAirView({
    grid: GRID,
    baseM: BASE,
    topM: 3000,
    groundAt: (x, y) => MODEL_GROUND(x, y) - 25,
    u: (x, y, z) => speed(x, y, z) * Math.cos(bearing(x, y, z)),
    v: (x, y, z) => speed(x, y, z) * Math.sin(bearing(x, y, z)),
    w: () => 0,
  });
  for (let c = 0; c < v.surfaceU.length; c++) {
    const x = GRID.x0 + (c % GRID.nx) * GRID.cellSize;
    const y = GRID.y0 + Math.floor(c / GRID.nx) * GRID.cellSize;
    v.surfaceU[c] = 5 * Math.cos(bearing(x, y, 0)) + 1.5 * Math.sin(x / 700);
    v.surfaceV[c] = 5 * Math.sin(bearing(x, y, 0)) + 1.2 * Math.cos(y / 600);
  }
  return v;
})();
const SAMPLER = new AtmosphereSampler(view, BASE, null);
const DOM = { x0: GRID.x0, y0: GRID.y0, x1: GRID.x0 + (GRID.nx - 1) * CELL, y1: GRID.y0 + (GRID.ny - 1) * CELL };
// Twelve views: the L3 lattice is never denser than 36 px (a power of two of metres, 57 px here), so a view holds about a quarter of the glyphs it did.
const CENTRES: [number, number][] = [[0, 0], [-1500, 900], [1400, -1100], [-900, -1700], [1700, 1500], [300, 1900], [-1900, -300], [1000, 200], [-300, -1000], [900, 1300], [-1300, 1800], [1900, -1700]];

/** Distances (px) between the tip of every glyph of the builder and the tip of the same glyph traced directly. */
function tipErrors(raster: FlowRaster, oracle: DirectOracle, cellPx: number): number[] {
  const errs: number[] = [];
  for (const [cx, cy] of CENTRES) {
    const cam = topDownCamera(CELL, cellPx, cx, cy, {}, 700);
    const sc = makeScenario({ raster, groundRaster: GROUND, cellPx, camera: cam, planCellM: CELL });
    const b = createGlyphBuilder('high');
    buildAll(b, sc.input);
    const out = b.out as GlyphOutputDetail;
    for (const g of glyphsOf(out) as Glyph[]) {
      if (g.dot || g.shaft < 2) continue;
      const ds = segmentLength(out, g.seg);
      const direct = oracle.trace(g.seed[0], g.seed[1], ds, g.shaft);
      if (direct.made !== g.shaft) continue; // stopped early by a calm or the edge in one of the two
      const mpp = clipW(cam.viewProj, g.seed[0], HF.heightAt(g.seed[0], g.seed[1]), -g.seed[1]) / cam.pxPerMetre1;
      errs.push(Math.hypot(direct.x - g.tip[0], direct.y - g.tip[1]) / mpp);
    }
  }
  return errs;
}
const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length;
const quantile = (a: number[], q: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil(q * a.length) - 1)]!;
const log = (s: string): void => {
  process.stderr.write(`[glyph oracle] ${s}\n`);
};

describe('raster against direct tracing (a model cell of 60 px, L3)', () => {
  for (const h of [100, 300]) {
    it(`${h} m above the ground: mean end-point error under 1 px at the model's spacing and under 0.5 px at half of it`, () => {
      const oracle = new DirectOracle(SAMPLER, GROUND, h, DOM);
      const r1 = new HeightRaster().fill(SAMPLER, GROUND, h, 1);
      const e1 = tipErrors(r1, oracle, 60);
      const r2 = new HeightRaster().fill(SAMPLER, GROUND, h, 2);
      const e2 = tipErrors(r2, oracle, 60);
      log(`h ${h} m: 1x ${e1.length} glyphs, mean ${mean(e1).toFixed(3)} px, p95 ${quantile(e1, 0.95).toFixed(2)} px, over 3 px ${((100 * e1.filter((e) => e > 3).length) / e1.length).toFixed(1)} %; 2x mean ${mean(e2).toFixed(3)} px, p95 ${quantile(e2, 0.95).toFixed(2)} px, over 3 px ${((100 * e2.filter((e) => e > 3).length) / e2.length).toFixed(1)} %`);
      expect(e1.length).toBeGreaterThan(1500);
      expect(mean(e1)).toBeLessThanOrEqual(1);
      expect(mean(e2)).toBeLessThanOrEqual(0.5);
      expect(mean(e2)).toBeLessThan(mean(e1)); // the finer raster is the better one
      expect(quantile(e2, 0.99)).toBeLessThan(quantile(e1, 0.99));
    });
  }

  it('the field is a demanding one: the raster at the same spacing as the model is off by a fifth of a pixel or more (S3: 0.47)', () => {
    const oracle = new DirectOracle(SAMPLER, GROUND, 100, DOM);
    const e1 = tipErrors(new HeightRaster().fill(SAMPLER, GROUND, 100, 1), oracle, 60);
    expect(mean(e1)).toBeGreaterThan(0.2);
  });
});

describe("'fire': the model's 10 m wind needs no raster of its own", () => {
  it('flow lines traced through surfaceU/V end where tracing through sampler.surfaceWind ends (mean under 0.01 px)', () => {
    const oracle = new DirectOracle(SAMPLER, GROUND, 'surface', DOM);
    const e = tipErrors(surfaceRaster(view)!, oracle, 60);
    log(`surface: ${e.length} glyphs, mean ${mean(e).toExponential(2)} px, max ${Math.max(...e).toExponential(2)} px`);
    expect(e.length).toBeGreaterThan(1500);
    expect(mean(e)).toBeLessThan(0.01);
    expect(Math.max(...e)).toBeLessThan(0.1);
  });
});
