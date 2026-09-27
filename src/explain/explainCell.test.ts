/**
 * "Why here?" (spec §10.4): arrival values for burnt cells, `evaluateCell` for unburnt ones; narrative ≤ 5 lines
 * with the top three factors ranked by s_i = |ln f_i| / Σ|ln f_j|, the §10.4 templates, the steep note, the validity
 * line and the wind decomposition. Includes the spec's example target sentence.
 */
import { describe, expect, it } from 'vitest';
import { BurnState, FireHistoryKind, FuelType, SpreadDriver } from '../core/types';
import { InsightEngine } from './engine';
import { explainCell, factorShares, localFuelSummary, moistureReason } from './explainCell';
import { STEEP_NOTE } from './text';
import { TestWorld } from './testing/simState';

const tan = (d: number): number => Math.tan((d * Math.PI) / 180);

describe('factorShares', () => {
  it('s_i = |ln f_i| / Σ|ln f_j| over wind, slope, moisture, fuel, terrain; sorted', () => {
    const sh = factorShares({ base: 0.004, wind: 4, slope: 2, moisture: 0.5, fuel: 1, terrain: 1 });
    const L = Math.log(4) + Math.log(2) + Math.log(2);
    expect(sh.map((s) => s.key)).toEqual(['wind', 'slope', 'moisture', 'fuel', 'terrain']);
    expect(sh[0]!.share).toBeCloseTo(Math.log(4) / L, 12);
    expect(sh[1]!.share).toBeCloseTo(Math.log(2) / L, 12);
    expect(sh[2]!.share).toBeCloseTo(Math.log(2) / L, 12);
    expect(sh[3]!.share).toBe(0);
    const zero = factorShares({ base: 0, wind: 1, slope: 1, moisture: 1, fuel: 1, terrain: 1 });
    expect(zero.every((s) => s.share === 0)).toBe(true);
    // Non-finite / non-positive factors contribute nothing (no NaN).
    const bad = factorShares({ base: 0, wind: NaN, slope: 0, moisture: 2, fuel: 1, terrain: 1 });
    expect(bad[0]!.key).toBe('moisture');
    expect(bad[0]!.share).toBe(1);
  });
});

describe('explainAt', () => {
  /** 28° slope rising to the north, a burnt head cell at (0, 0) spreading north, gully axis up the slope. */
  function exampleWorld(): { w: TestWorld; k: number } {
    const w = new TestWorld({ elevation: (_x, y) => 600 + tan(28) * y });
    w.setWind(25 / 3.6, 180);
    const k = w.cell(0, 0);
    const f = w.view.fire;
    f.burnState[k] = BurnState.Burning;
    f.arrivalTime[k] = 0;
    f.spreadDir[k] = 0;
    f.ros[k] = 0.5;
    f.intensity[k] = 9000;
    f.flameHeight[k] = 9;
    f.driver[k] = SpreadDriver.WindAndSlope;
    w.view.aux.direction[k] = 1;
    w.view.fireIndV[k] = 7 / 3.6;
    w.view.moisture[k] = 6;
    w.view.moistureAfdrs[k] = 7;
    w.features.gullyAxis[k] = 0;
    w.factors = { base: 15.43 / 3600, wind: 5, slope: 7.0, moisture: 1.8, fuel: 1, terrain: 1, build: 1, fireWindShare: 0.28, direction: 1 };
    w.setTime(600);
    return { w, k };
  }

  it('reproduces the spec §10.4 example target on a burnt 28° gully cell', () => {
    const { w } = exampleWorld();
    const e = explainCell(0, 0, w.view, { startMs: w.startMs });
    expect(e.narrative[0]).toBe(
      'Running uphill here because: slope 28° upslope (about ×7.0), wind 25 km/h aligned with the gully (7 km/h drawn in by the fire), and dry litter (6 %). ' +
        STEEP_NOTE,
    );
    expect(e.narrative.length).toBe(5);
    expect(e.narrative[1]).toBe('Slope: 28° uphill along the spread → about ×7.0 (doubles every 10° uphill).');
    expect(e.narrative[2]).toBe('Wind: 25 km/h from the south → ×5.0; about 7 km/h of it is air drawn in by the fire.');
    expect(e.narrative[3]).toMatch(/^Litter moisture 6 % \(7 % by the AFDRS equations; .+\) → ×1\.8\.$/);
    // Validity (θ > 20°) and the wind decomposition line.
    expect(e.narrative[4]).toMatch(/^Model check: outside the tested range here \(slope over 20°\)/);
    expect(e.narrative[4]).toMatch(/Wind here: ambient 25 \+ 0 terrain \+ 0 slope flow \+ 7 fire km\/h\.$/);
    // CellExplanation fields from the arrival values.
    expect(e).toMatchObject({ x: 0, y: 0, ros: 0.5, intensity: 9000, flameHeight: 9, driver: SpreadDriver.WindAndSlope, deadFuelMoisture: 6, arrivalTime: 0 });
    expect(e.slopeDeg).toBeCloseTo(28, 0);
    expect(e.windSpeed10 * 3.6).toBeCloseTo(25, 4);
    expect(e.windDir10).toBeCloseTo(180, 4);
    expect(e.factors.slope).toBe(7);
  });

  it('unburnt cell: uses evaluateCell (the fire module), "If the fire reaches here …"', () => {
    const w = new TestWorld();
    w.setWind(20 / 3.6, 270);
    w.factors = { base: 15.43 / 3600, wind: 6, slope: 1, moisture: 1.3, fuel: 0.4, terrain: 1, build: 1, fireWindShare: 0, direction: 1 };
    w.evaluation = { ros: 0.05, intensity: 1500, flameHeight: 3, driver: SpreadDriver.Wind, validated: true };
    const e = explainCell(300, 300, w.view, { startMs: w.startMs });
    expect(e.ros).toBe(0.05);
    expect(e.intensity).toBe(1500);
    expect(e.arrivalTime).toBe(Infinity);
    expect(e.narrative[0]).toMatch(/^If the fire reaches here it would spread about 180 m\/h because: wind 20 km\/h, light fuel \(about ×0\.4\), and litter at 12 %\.$/);
    expect(e.narrative[e.narrative.length - 1]).toMatch(/^Model check: inside the tested range\./);
    expect(e.narrative.length).toBeLessThanOrEqual(5);
    expect(e.narrative.some((l) => l.startsWith('Dry forest'))).toBe(true); // fuel line from the fuel summary
  });

  it('flank / back position and downhill slope wording; terrain line flagged "model indicative"', () => {
    const w = new TestWorld({ elevation: (_x, y) => 600 + tan(15) * y });
    const k = w.cell(0, 0);
    const f = w.view.fire;
    f.burnState[k] = BurnState.Burning;
    f.arrivalTime[k] = 0;
    f.spreadDir[k] = 180; // downhill
    f.ros[k] = 0.003;
    f.driver[k] = SpreadDriver.Backing;
    w.view.aux.direction[k] = 0.1;
    w.view.aux.attach[k] = 0.6;
    w.factors = { base: 15.43 / 3600, wind: 1.2, slope: 0.6, moisture: 1, fuel: 1, terrain: 1.8, build: 1, direction: 0.1 };
    const e = explainCell(0, 0, w.view, { startMs: w.startMs });
    expect(e.narrative[0]).toMatch(/^Backing slowly here because: .*slope 15° downslope/);
    expect(e.narrative.some((l) => l.includes('eruptive regime') && l.includes('(model indicative)'))).toBe(true);
    expect(e.narrative.some((l) => l.startsWith('Slope: 15° downhill along the spread'))).toBe(true);
  });

  it('non-fuel cell: explains that nothing can carry the fire; engine.explainAt delegates', () => {
    const w = new TestWorld();
    const k = w.cell(0, 0);
    w.fuel.type[k] = FuelType.NonFuel;
    w.view.fire.burnState[k] = BurnState.NonFlammable;
    const eng = new InsightEngine(w.terrain, w.derived, w.fuel, w.features, { startTime: w.startMs });
    const e = eng.explainAt(0, 0, w.view);
    expect(e.narrative[0]).toMatch(/nothing here can carry the fire/);
    expect(e.narrative.length).toBe(2);
    // Points outside the grid clamp to the edge cell.
    const edge = eng.explainAt(1e6, -1e6, w.view);
    expect(edge.x).toBe(w.grid.x0 + (w.grid.nx - 1) * w.grid.cellSize);
    expect(edge.y).toBe(w.grid.y0);
    const bad = eng.explainAt(NaN, Infinity, w.view);
    expect(bad.x).toBe(w.grid.x0);
    expect(bad.y).toBe(w.grid.y0 + (w.grid.ny - 1) * w.grid.cellSize);
  });

  it('fuel summary and moisture reasons (user edit, rain, sunlit / shaded aspect)', () => {
    const w = new TestWorld({ elevation: (x) => 600 + tan(20) * x });
    const k = w.cell(0, 0);
    w.fuel.timeSinceFire[k] = 2;
    w.fuel.lastFireKind[k] = FireHistoryKind.PrescribedBurn;
    expect(localFuelSummary(w.fuel, k)).toMatch(/^Dry forest.* · prescribed burn 2 yr ago · litter .* t\/ha \(\d+ % of max\)/);
    const now = w.startMs + 3600e3;
    w.setTime(3600); // 11:00, sun up
    w.view.moistureAnomaly[k] = 1.5; // wetter than AFDRS: the west-facing slope in the morning shade
    expect(moistureReason(w.view, k, now)).toBe('shaded west-facing slope');
    w.view.moistureAnomaly[k] = -2;
    expect(moistureReason(w.view, k, now)).toBe('sunlit west-facing slope');
    const h = w.view.series.hours.find((x) => x.time <= now && x.time > now - 6 * 3.6e6)!;
    h.precipitation = 3;
    expect(moistureReason(w.view, k, now)).toMatch(/^rain \d h ago$/);
    w.fuel.moistureOffset = new Float32Array(w.N);
    w.fuel.moistureOffset[k] = 4;
    expect(moistureReason(w.view, k, now)).toBe('user edit (+4 points)');
  });

  it('with the moisture module breakdown, the largest term (pp) is the reason; the engine passes it through', () => {
    const w = new TestWorld({ elevation: (x) => 600 + tan(20) * x });
    const k = w.cell(0, 0);
    w.setTime(3600);
    const now = w.startMs + 3600e3;
    const parts = { anomaly: -2.5, rainMemory: 1, hoursSinceRainEff: 20, dew: 0, offset: 0 };
    expect(moistureReason(w.view, k, now, parts)).toBe('sunlit west-facing slope');
    expect(moistureReason(w.view, k, now, { ...parts, rainMemory: 4 })).toBe('rain 20 h ago');
    expect(moistureReason(w.view, k, now, { ...parts, offset: -3 })).toBe('user edit (-3 points)');
    expect(moistureReason(w.view, k, now, { anomaly: 0.1, rainMemory: 0, hoursSinceRainEff: 0, dew: 0, offset: 0 })).toBe("today's weather");
    w.factors = { base: 15.43 / 3600, wind: 1.5, slope: 1, moisture: 2.5, fuel: 1, terrain: 1, build: 1, direction: 1 };
    const eng = new InsightEngine(w.terrain, w.derived, w.fuel, w.features, { startTime: w.startMs, moistureBreakdown: () => ({ ...parts, dew: 6 }) });
    const e = eng.explainAt(0, 0, w.view);
    expect(e.narrative.some((l) => /^Litter moisture 12 % \(12 % by the AFDRS equations; dew\) → ×2\.5\.$/.test(l))).toBe(true);
  });
});
