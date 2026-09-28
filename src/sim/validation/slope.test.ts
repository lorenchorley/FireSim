/**
 * Coupled-model validation on synthetic slopes (spec §15 V1–V5, V11), headless through `Simulation` (fast tier unless
 * stated; mountainPhenomena on; embers off). What the app must teach here:
 *  V1  calm fire runs uphill ×2^(θ/10) faster than on flat ground and backs downhill at SF(−θ) = s/(2s − 1) ≥ 0.5 of
 *      it (kataburn), with the default coupling as well as without it;
 *  V2  wind and slope aligned multiply: R = R_w·2^(θ/10);
 *  V3  cross-slope wind: the head goes between wind-to and upslope (vector sum), no multiplication;
 *  V4  the run slows at the ridge crest and the lee side does not burn "uphill" (driver change), ridge-crest card;
 *  V5  night slows the head (moisture), downhill backing continues (≥ 0.5 × flat), night-slowdown card;
 *  V11 a steep V-gully runs ≥ 1.8 × faster than the open slope (chimney), eruptive + gully cards, "indicative".
 * ROS are measured from the arrival-time gradient along an axis (independent of the model's own ROS bookkeeping);
 * reference rates come from the Mk2 kernel at the fire's local 10 m wind.
 */
import { describe, expect, it } from 'vitest';
import { SpreadDriver } from '../../core/types';
import { WEATHER_PRESETS } from '../../scenario/presets';
import { lmstToUtc } from '../../scenario/time';
import { angleDiffDeg } from '../../core/units';
import { cellAt } from '../../core/grid';
import {
  DEG, ORIGIN, SLOW, extentAlong, kernelAt, kindsOf, line, localWindKmh, log, median, point, rosAlong, runSim, sampleField, synth, type RunResult,
} from './harness';

/** Slope factor of the spec (§7.3): 2^(θ/10) uphill, s/(2s − 1) with s = 2^(−θ/10) downhill. */
const SF = (th: number): number => (th >= 0 ? Math.min(16, 2 ** (th / 10)) : ((s) => s / (2 * s - 1))(2 ** (-th / 10)));

describe('V1 upslope vs downslope (calm, M 8 % hook, DF 10, surface heating off, Δx 10 m, 6 h, point ignition)', () => {
  const run = (slope: number, coupling: number): RunResult => {
    const tan = Math.tan(slope * DEG);
    const s = synth({ extent: 1600, cellSize: 10, elevation: (x) => 500 + tan * x, windKmh: 0, droughtFactor: 10, duration: 6 * 3600, ignitions: [point(-300, 0, 0, 12)], options: { coupling } });
    return runSim(s, { until: 6 * 3600, moisturePct: 8, heating: false, every: 1800 });
  };
  const ros = (r: RunResult, az: number, d0: number, d1: number): number => rosAlong(r.scenario.terrain.grid, r.sim.stateView().fire.arrivalTime, -300, 0, az, d0, d1) * 3600;

  for (const coupling of [0, 1]) {
    it(`coupling ${coupling}: up/flat = 2^(θ/10) ± 5 % and down/flat = SF(−θ) ± 5 % (≥ 0.5) at θ = 10° and 20°`, () => {
      const flat = run(0, coupling);
      // Flat calm fire: isotropic; windows inside the 6 h reach (the spec's 100–300 m is not reached at ~21 m/h).
      const rFlat = ros(flat, 90, 30, 100);
      expect(Math.abs(ros(flat, 270, 30, 100) / rFlat - 1)).toBeLessThan(0.03);
      for (const [th, up0, up1] of [[20, 100, 300], [10, 50, 200]] as const) {
        const r = run(th, coupling);
        const up = ros(r, 90, up0, up1) / rFlat;
        const down = ros(r, 270, 20, 60) / rFlat;
        log(`V1 c${coupling} θ ${th}°: flat ${rFlat.toFixed(1)} m/h, up/flat ${up.toFixed(3)} (${SF(th).toFixed(3)}), down/flat ${down.toFixed(3)} (${SF(-th).toFixed(3)}), area ${r.sim.stats().burntAreaHa.toFixed(1)} ha`);
        expect(Math.abs(up / SF(th) - 1)).toBeLessThan(0.05);
        expect(Math.abs(down / SF(-th) - 1)).toBeLessThan(0.05);
        expect(down).toBeGreaterThanOrEqual(0.5);
      }
    }, 120000);
  }
});

describe('V2 wind aligned with the slope (10°, U10 30 km/h upslope, heating off, 1 km line)', () => {
  for (const coupling of [0, 1]) {
    it(`coupling ${coupling}: head ROS 200–600 m from the line = Mk2 R_w(U10 at the fire) × 2.0 ± 5 %; flat = R_w(30) ± 5 %`, () => {
      const res: Record<string, { ros: number; rw: number; u: number }> = {};
      for (const [name, slope] of [['flat', 0], ['slope', 10]] as const) {
        const tan = Math.tan(slope * DEG);
        const s = synth({ extent: 3000, elevation: (x) => 500 + tan * x, windKmh: 30, windFromDeg: 270, duration: 3600, ignitions: [line([[-400, -500], [-400, 500]])], options: { coupling } });
        const r = runSim(s, { until: 3600, moisturePct: 8, heating: false, every: 900 });
        const g = s.terrain.grid;
        const ros = rosAlong(g, r.sim.stateView().fire.arrivalTime, -400, 0, 90, 200, 600) * 3600;
        const u = localWindKmh(r, -200, 200, 0);
        res[name] = { ros, u, rw: kernelAt(r, cellAt(g, 0, 0), u, 8).rw };
      }
      const f = res['flat']!;
      const sl = res['slope']!;
      log(`V2 c${coupling}: flat ROS ${f.ros.toFixed(0)} m/h vs R_w ${f.rw.toFixed(0)} (U ${f.u.toFixed(1)} km/h); slope ROS ${sl.ros.toFixed(0)} vs 2·R_w(U ${sl.u.toFixed(1)}) ${(2 * sl.rw).toFixed(0)} → ${(sl.ros / (2 * sl.rw)).toFixed(3)}; slope/flat ${(sl.ros / f.ros).toFixed(3)}`);
      expect(Math.abs(f.u / 30 - 1)).toBeLessThan(0.01);
      expect(Math.abs(f.ros / f.rw - 1)).toBeLessThan(0.05);
      expect(Math.abs(sl.ros / (2 * sl.rw) - 1)).toBeLessThan(0.05);
      // The mass-consistent background slows the wind low on a planar ramp and speeds it up near the top (terrain
      // effect, documented): in the measurement window it stays within 10 % of the forecast.
      expect(Math.abs(sl.u / 30 - 1)).toBeLessThan(0.1);
    }, 120000);
  }
});

describe('V3 cross-slope wind (20° slope rising east, 25 km/h from the south, heating off)', () => {
  it('head direction = vector sum of wind and slope (±5°); head ROS ≤ flat R_w × 1.2', () => {
    const tan = Math.tan(20 * DEG);
    for (const coupling of [0, 1]) {
      const s = synth({ extent: 3000, elevation: (x) => 500 + tan * x, windKmh: 25, windFromDeg: 180, duration: 3600, ignitions: [point(-300, -600, 0, 30)], options: { coupling } });
      const r = runSim(s, { until: 3600, moisturePct: 8, heating: false, every: 900 });
      const g = s.terrain.grid;
      const tArr = r.sim.stateView().fire.arrivalTime;
      let best = -Infinity;
      let az = 0;
      for (let a = -60; a <= 120; a += 0.5) {
        const e = extentAlong(g, tArr, 3600, -300, -600, a);
        if (e > best) [best, az] = [e, a];
      }
      const u = localWindKmh(r, -300, -300, -300);
      const K = kernelAt(r, cellAt(g, -300, -300), u, 8);
      const pred = Math.atan2((SF(20) - 1) * K.r0, K.rw - K.r0) / DEG;
      const ros = rosAlong(g, tArr, -300, -600, az, 300, 900) * 3600;
      log(`V3 c${coupling}: head ${az.toFixed(1)}° vs vector sum ${pred.toFixed(1)}° (R0 ${K.r0.toFixed(1)}, R_w ${K.rw.toFixed(0)} m/h at ${u.toFixed(1)} km/h); ROS ${ros.toFixed(0)} = ${(ros / K.rw).toFixed(3)} × R_w`);
      expect(Math.abs(angleDiffDeg(az, pred))).toBeLessThanOrEqual(5);
      expect(ros).toBeLessThanOrEqual(1.2 * K.rw);
    }
  }, 120000);
});

describe('V4 slowing at a ridge crest (symmetric 25° ridge, 300 m, U10 20 km/h across it, line at the windward base)', () => {
  const H = 300;
  const tan = Math.tan(25 * DEG);
  const run = (mountainPhenomena: boolean): RunResult => {
    const s = synth({ extent: 4000, elevation: (x) => 500 + Math.max(0, H - tan * Math.abs(x)), windKmh: 20, windFromDeg: 270, duration: 3 * 3600, ignitions: [line([[-750, -600], [-750, 600]])], options: { mountainPhenomena } });
    return runSim(s, { until: 3 * 3600, every: 1800 });
  };
  const drivers = (r: RunResult, x0: number, x1: number): Map<SpreadDriver, number> => {
    const g = r.scenario.terrain.grid;
    const f = r.sim.stateView().fire;
    const m = new Map<SpreadDriver, number>();
    for (let x = x0; x <= x1; x += 30) {
      for (let y = -300; y <= 300; y += 30) {
        const k = cellAt(g, x, y);
        if (f.arrivalTime[k]! < Infinity) m.set(f.driver[k] as SpreadDriver, (m.get(f.driver[k] as SpreadDriver) ?? 0) + 1);
      }
    }
    return m;
  };
  const share = (m: Map<SpreadDriver, number>, ds: SpreadDriver[]): number => {
    const tot = [...m.values()].reduce((a, b) => a + b, 0);
    return ds.reduce((a, d) => a + (m.get(d) ?? 0), 0) / Math.max(1, tot);
  };
  const fmt = (m: Map<SpreadDriver, number>): string => [...m].map(([d, n]) => `${SpreadDriver[d]} ${n}`).join(', ');

  it('ROS drops ≥ 60 % within 2 cells after the crest; Slope/WindAndSlope windward; ridge-crest card', () => {
    const r = run(true);
    const g = r.scenario.terrain.grid;
    const f = r.sim.stateView().fire;
    const at = (x: number): number => median([-150, -60, 0, 60, 150].map((y) => f.ros[cellAt(g, x, y)]!));
    const before = at(-30);
    const after = Math.min(at(30), at(60));
    const ww = drivers(r, -450, -60);
    const lee = drivers(r, 60, 400);
    log(`V4 on: ROS before crest ${(before * 3.6).toFixed(2)} km/h, 1–2 cells after ${(after * 3.6).toFixed(2)} (−${(100 * (1 - after / before)).toFixed(0)} %); windward ${fmt(ww)}; lee ${fmt(lee)}; cards ${[...kindsOf(r.insights)].join(', ')}`);
    expect(after).toBeLessThanOrEqual(0.4 * before);
    expect(share(ww, [SpreadDriver.Slope, SpreadDriver.WindAndSlope])).toBeGreaterThanOrEqual(0.8);
    // With mountain phenomena on, this geometry (25° lee, U_ridge ≈ 6–9 m/s after the crest speed-up) is inside the
    // spec's own VLS window (VLS ≈ 0.78): the lee side burns laterally (LateralVorticity) or backs — never "uphill".
    expect(share(lee, [SpreadDriver.Slope, SpreadDriver.WindAndSlope])).toBeLessThanOrEqual(0.1);
    expect(kindsOf(r.insights).has('ridge-crest')).toBe(true);
  }, 120000);

  it('mountainPhenomena off: the lee-side driver is Backing/Wind (spec V4 driver change)', () => {
    const r = run(false);
    const lee = drivers(r, 60, 400);
    log(`V4 off: lee ${fmt(lee)}`);
    expect(share(lee, [SpreadDriver.Backing, SpreadDriver.Wind])).toBeGreaterThanOrEqual(0.8);
    expect(kindsOf(r.insights).has('ridge-crest')).toBe(true);
  }, 120000);
});

describe('V11 chimney (V-gully: 30° axial slope, 25° walls, 60 m deep; calm afternoon, M 8 %, Δx 10 m)', () => {
  const t30 = Math.tan(30 * DEG);
  const t25 = Math.tan(25 * DEG);
  const wall = 60 / t25;
  // Gully along x = −300 (up-gully north); open 30° slope elsewhere; one ignition in each.
  const zf = (x: number, y: number): number => 500 + t30 * y + (Math.abs(x + 300) < wall ? t25 * Math.abs(x + 300) - 60 : 0);
  for (const coupling of [0, 1]) {
    it(`coupling ${coupling}: gully head ROS ≥ 1.8 × open 30° slope after τ_e; eruptive + gully cards; "indicative"`, () => {
      const s = synth({ extent: 1600, cellSize: 10, elevation: zf, windKmh: 0, duration: 3 * 3600, ignitions: [point(-300, -600, 0, 20, 'g'), point(400, -600, 0, 20, 'o')], options: { coupling } });
      const r = runSim(s, { until: 2.5 * 3600, moisturePct: 8, every: 1800 });
      const g = s.terrain.grid;
      const f = r.sim.stateView().fire;
      const t = (x: number, y: number): number => sampleField(g, f.arrivalTime, x, y);
      const gully = (200 / (t(-300, -300) - t(-300, -500))) * 3600;
      const open = (200 / (t(400, -300) - t(400, -500))) * 3600;
      const ex = r.sim.explain(-300, -350);
      const kinds = kindsOf(r.insights);
      log(`V11 c${coupling}: gully ${gully.toFixed(0)} m/h, open ${open.toFixed(0)} m/h, ratio ${(gully / open).toFixed(2)}; driver ${SpreadDriver[f.driver[cellAt(g, -300, -350)]!]}; cards ${[...kinds].join(', ')}\n  why: ${ex.narrative.join(' / ')}`);
      expect(gully / open).toBeGreaterThanOrEqual(1.8);
      expect(kinds.has('eruptive-slope')).toBe(true);
      expect(kinds.has('gully-chimney')).toBe(true);
      expect(f.driver[cellAt(g, -300, -350)]).toBe(SpreadDriver.Eruptive);
      expect(ex.narrative.join(' ')).toMatch(/indicative/);
    }, 120000);
  }
});

describe.skipIf(!SLOW)('V5 backing at night (V1 slope, hot-nw day then its night, ignition 13:00 LMST) [SLOW]', () => {
  it('head ROS at 02:00 ≤ 35 % of 14:30; night-slowdown card; downhill ROS at night ≥ 0.5 × flat', () => {
    const start = lmstToUtc('2025-12-20', 13, ORIGIN.lon);
    const base = WEATHER_PRESETS['hot-nw-sw-change'].build(start, 14, { location: ORIGIN, sourceElevation: 500 });
    // "V1 slope": calm (the preset's temperature, humidity and cloud; no wind) so the night slowdown is the fuel's.
    const weather = { ...base, hours: base.hours.map((h) => ({ ...h, windSpeed10: 0, windGust10: 0 })) };
    const tan = Math.tan(20 * DEG);
    const runs = (['slope', 'flat'] as const).map((name) => {
      const heads = new Map<number, number>();
      const s = synth({ extent: 3000, cellSize: 10, start, duration: 14 * 3600, weather, elevation: name === 'slope' ? (x) => 500 + tan * x : () => 500, ignitions: [point(-600, 0, 0, 20)] });
      const r = runSim(s, { until: 13 * 3600, every: 1800, onTick: (sim, t) => heads.set(t, sim.stats().headRos) });
      return { r, heads };
    });
    const [slope, flat] = runs as [(typeof runs)[0], (typeof runs)[0]];
    const h1430 = slope.heads.get(1.5 * 3600)!;
    const h0200 = slope.heads.get(13 * 3600)!;
    // Night downhill spread on the slope vs the flat fire over 19:30–22:00 LMST (cells arriving then; later the
    // downhill front has reached the west edge of the domain, pushed by the katabatic flow).
    const window = (r: RunResult, dirOk: (d: number) => boolean): number => {
      const f = r.sim.stateView().fire;
      const v: number[] = [];
      for (let k = 0; k < f.arrivalTime.length; k++) {
        const ta = f.arrivalTime[k]!;
        if (ta >= 6.5 * 3600 && ta <= 9 * 3600 && dirOk(f.spreadDir[k]!) && f.driver[k] !== SpreadDriver.Spotting) v.push(f.ros[k]!);
      }
      return median(v) * 3600;
    };
    const down = window(slope.r, (d) => Math.abs(angleDiffDeg(d, 270)) <= 45);
    const flatNight = window(flat.r, () => true);
    const kinds = kindsOf(slope.r.insights);
    log(`V5: head 14:30 ${(h1430 * 3600).toFixed(0)} m/h, 02:00 ${(h0200 * 3600).toFixed(0)} m/h (${((100 * h0200) / h1430).toFixed(0)} %); night downhill ${down.toFixed(0)} m/h vs flat ${flatNight.toFixed(0)} m/h; cards ${[...kinds].join(', ')}`);
    expect(h0200).toBeLessThanOrEqual(0.35 * h1430);
    expect(kinds.has('night-slowdown')).toBe(true);
    expect(down).toBeGreaterThanOrEqual(0.5 * flatNight);
  }, 600000);
});
