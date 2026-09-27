/**
 * Headless validation of the coupled model (spec §15; brief: "ignite on the escarpment, run 3 h in both tiers"),
 * offline in Node with the production scenario builder and the bundled Katoomba demo site.
 *
 *  A. Katoomba, preset 'hot-nw-sw-change' (20 Dec, 14:00 AEDT start = 13:01 LMST; the SW change arrives at 15:00
 *     LMST, 2 h in), point ignition on the lower Megalong escarpment below the Narrow Neck cliffs (688 m, 23°,
 *     west-facing, NW wind upslope). 3 h in the fast and the standard tier. Checks: growth, plausible head ROS,
 *     faster upslope than downslope (stratified by wind alignment), downwind spotting, several insight kinds
 *     (upslope run, spotting, wind change), a coherent "Why here?", checkpoint → rewind → re-run bitwise
 *     determinism, and the §13 performance (wall-clock per simulated hour + per-module breakdown, logged).
 *  B. Black Summer replay 'gospers-2019-12-19' (fast tier, 3 h from 10:00 LMST): drought state (V19), spread,
 *     spotting, high FFDI.
 *  C. Calm night preset 'calm-night-katabatic' (15 Mar): fast tier 20:00 → 03:00 with a fire (night slowdown,
 *     katabatic flow on slopes, calm valley floor, night cards); standard tier 01:00 → 03:00 (3-D katabatics).
 *
 * Runtime ≈ 2–3 min on one x86 core. Set FIRESIM_SKIP_SLOW=1 to skip.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { SpreadDriver, type Insight, type QualityTier, type ScenarioData, type SimSnapshot } from '../core/types';
import { angleDiffDeg, azimuthToUnit } from '../core/units';
import { weatherAt } from '../scenario';
import { SPREAD_PARAMS } from '../fire/spread';
import { Simulation, type SimPerf } from './simulation';
import { snapshotHash } from './testing/hash';
import { cellOf, cellXY, demoScenario, pointIgnition, withIgnitions } from './testing/scenarios';

const SKIP = typeof process !== 'undefined' && process.env['FIRESIM_SKIP_SLOW'] === '1';
const d = SKIP ? describe.skip : describe;
const log = (s: string): void => {
  process.stderr.write(`[sim validation] ${s}\n`);
};

interface RunResult {
  sim: Simulation;
  scenario: ScenarioData;
  snaps: Map<number, SimSnapshot>;
  insights: Insight[];
  wallS: number;
  spinS: number;
  initS: number;
  perf: SimPerf;
}

async function run(scenario: ScenarioData, tier: QualityTier, until: number): Promise<RunResult> {
  const snaps = new Map<number, SimSnapshot>();
  const insights: Insight[] = [];
  const c0 = performance.now();
  const sim = new Simulation(scenario, { tier, hooks: { snapshot: (s) => (snaps.set(s.time, s), insights.push(...s.insights)) } });
  const initS = (performance.now() - c0) / 1000;
  const c1 = performance.now();
  sim.spinUp();
  const spinS = (performance.now() - c1) / 1000;
  const c2 = performance.now();
  sim.advance(until);
  const wallS = (performance.now() - c2) / 1000;
  return { sim, scenario, snaps, insights, wallS, spinS, initS, perf: sim.perf() };
}

function perfTable(label: string, r: RunResult): void {
  const hours = r.perf.simSeconds / 3600;
  const mods = Object.entries(r.perf.modules).sort((a, b) => b[1] - a[1]);
  const rows = mods.map(([k, v]) => `${k.padEnd(14)} ${(v / 1000).toFixed(2).padStart(7)} s  ${((v / 1000 / hours)).toFixed(2).padStart(6)} s/h  ${((100 * v) / r.perf.wallMs).toFixed(1).padStart(5)} %`);
  log(
    `${label}: tier ${r.sim.tier}, init ${r.initS.toFixed(2)} s (${Object.entries(r.perf.init).map(([k, v]) => `${k} ${(v / 1000).toFixed(2)}`).join(', ')}), ` +
      `3-D spin-up ${r.spinS.toFixed(2)} s, run ${r.wallS.toFixed(1)} s for ${hours.toFixed(2)} h = ${(r.wallS / hours).toFixed(2)} s per simulated hour ` +
      `(${r.perf.steps} steps, ${((r.perf.wallMs / r.perf.steps) || 0).toFixed(1)} ms/step), checkpoints ${(r.sim.checkpointBytes() / 1e6).toFixed(1)} MB\n  ` +
      rows.join('\n  '),
  );
}

/** Upslope vs downslope ROS of burnt cells, stratified by the alignment of the spread with the wind. */
function slopeContrast(r: RunResult, snap: SimSnapshot): { bins: { a: number; up: number; down: number; nUp: number; nDown: number }[]; pooled: number } {
  const t = r.scenario.terrain;
  const f = snap.fire;
  const n = f.arrivalTime.length;
  const binsUp: number[][] = [[], [], [], []];
  const binsDown: number[][] = [[], [], [], []];
  for (let k = 0; k < n; k++) {
    const ta = f.arrivalTime[k]!;
    if (!(ta <= snap.time) || ta < 600 || f.driver[k] === SpreadDriver.Spotting) continue;
    const dir = f.spreadDir[k]!;
    if (!Number.isFinite(dir)) continue;
    const [ux, uy] = azimuthToUnit(dir);
    const th = (Math.atan(t.dzdx[k]! * ux + t.dzdy[k]! * uy) * 180) / Math.PI;
    const w = weatherAt(r.scenario.weather, r.scenario.startTime + ta * 1000);
    const a = Math.cos((angleDiffDeg(dir, w.windDir10 + 180) * Math.PI) / 180);
    const b = Math.min(3, Math.floor((a + 1) * 2));
    if (th > 10) binsUp[b]!.push(f.ros[k]!);
    else if (th < -10) binsDown[b]!.push(f.ros[k]!);
  }
  const med = (v: number[]): number => {
    if (!v.length) return NaN;
    const s = [...v].sort((x, y) => x - y);
    return s[s.length >> 1]!;
  };
  const bins = binsUp.map((u, i) => ({ a: -0.75 + 0.5 * i, up: med(u), down: med(binsDown[i]!), nUp: u.length, nDown: binsDown[i]!.length }));
  const pooled = med(binsUp.flat()) / med(binsDown.flat());
  return { bins, pooled };
}

/** 90th percentile of the arrival ROS (km/h) of cells whose spread was within ±30° of the wind-to direction. */
function headRosP90(r: RunResult, snap: SimSnapshot): { p90: number; p50: number; n: number } {
  const f = snap.fire;
  const v: number[] = [];
  for (let k = 0; k < f.arrivalTime.length; k++) {
    const ta = f.arrivalTime[k]!;
    if (!(ta <= snap.time) || ta < 1200 || f.driver[k] === SpreadDriver.Spotting) continue;
    const w = weatherAt(r.scenario.weather, r.scenario.startTime + ta * 1000);
    if (Math.abs(angleDiffDeg(f.spreadDir[k]!, w.windDir10 + 180)) <= 30) v.push(3.6 * f.ros[k]!);
  }
  v.sort((a, b) => a - b);
  return { p90: v[Math.floor(0.9 * (v.length - 1))] ?? NaN, p50: v[v.length >> 1] ?? NaN, n: v.length };
}

const IGN_X = -2170;
const IGN_Y = 900;
const HOURS = 3;

for (const tier of ['fast', 'standard'] as const) {
  d(`A. Katoomba escarpment, hot NW wind ahead of the SW change, ${HOURS} h, ${tier} tier`, () => {
    let r: RunResult;
    beforeAll(async () => {
      const base = await demoScenario({ startCivil: [2025, 12, 20, 14], duration: HOURS * 3600 });
      const scenario = withIgnitions(base, [pointIgnition('escarpment', IGN_X, IGN_Y, 0, 60)]);
      r = await run(scenario, tier, HOURS * 3600);
      perfTable(`Katoomba ${tier}`, r);
    }, 600000);

    it('ignites on the escarpment in dry forest and the fire grows every hour to a large fire', () => {
      const k = cellOf(r.scenario.terrain, IGN_X, IGN_Y);
      expect(r.scenario.terrain.slopeDeg[k]).toBeGreaterThan(15);
      expect(r.scenario.fuel.type[k]).toBe(4);
      const a = [3600, 7200, 10800].map((t) => r.snaps.get(t)!.stats.burntAreaHa);
      log(`${tier}: burnt area ${a.map((x) => x.toFixed(0)).join(' → ')} ha; perimeter ${r.snaps.get(10800)!.stats.perimeterKm.toFixed(1)} km`);
      expect(a[0]!).toBeGreaterThan(5);
      expect(a[1]!).toBeGreaterThan(a[0]!);
      expect(a[2]!).toBeGreaterThan(a[1]!);
      expect(a[2]!).toBeGreaterThan(100);
      const st = r.snaps.get(10800)!.stats;
      expect(st.ffdi).toBeGreaterThan(40); // an Extreme-ish afternoon
      expect(['High', 'Extreme', 'Catastrophic']).toContain(st.fireDangerRating);
    });

    it('head ROS is plausible for the conditions (km/h range of an extreme forest day; level-set cap never exceeded)', () => {
      const cap = SPREAD_PARAMS.levelSet.rosMaxMs;
      for (const s of r.snaps.values()) expect(s.stats.headRos).toBeLessThanOrEqual(cap + 1e-6);
      const h = headRosP90(r, r.snaps.get(10800)!);
      const heads = [...r.snaps.values()].map((s) => 3.6 * s.stats.headRos);
      log(`${tier}: head-aligned arrival ROS p50 ${h.p50.toFixed(2)} km/h, p90 ${h.p90.toFixed(2)} km/h (n ${h.n}); stats.headRos range ${Math.min(...heads).toFixed(1)}–${Math.max(...heads).toFixed(1)} km/h`);
      expect(h.n).toBeGreaterThan(50);
      expect(h.p50).toBeGreaterThan(0.3);
      expect(h.p90).toBeGreaterThan(1);
      expect(h.p90).toBeLessThan(3.6 * cap + 1e-6);
    });

    it('spreads faster upslope than downslope (stratified by wind alignment)', () => {
      const c = slopeContrast(r, r.snaps.get(10800)!);
      log(`${tier}: upslope/downslope median ROS (m/s) by wind alignment ${c.bins.map((b) => `a≈${b.a}: ${b.up.toFixed(3)}(${b.nUp}) / ${b.down.toFixed(3)}(${b.nDown})`).join('; ')}; pooled ratio ${c.pooled.toFixed(2)}`);
      const usable = c.bins.filter((b) => b.nUp >= 30 && b.nDown >= 30);
      expect(usable.length).toBeGreaterThanOrEqual(2);
      for (const b of usable) expect(b.up).toBeGreaterThan(b.down);
      expect(c.pooled).toBeGreaterThan(1.5);
    });

    it('produces spot fires downwind of their sources, with embers in flight', () => {
      const last = r.snaps.get(10800)!;
      const spots = last.spotFires;
      const maxEmbers = Math.max(...[...r.snaps.values()].map((s) => s.stats.activeEmbers));
      let downwind = 0;
      let withSource = 0;
      for (const s of spots) {
        if (s.sourceX === undefined || s.sourceY === undefined) continue;
        withSource++;
        const w = weatherAt(r.scenario.weather, r.scenario.startTime + s.time * 1000);
        const [ux, uy] = azimuthToUnit(w.windDir10 + 180);
        if ((s.x - s.sourceX) * ux + (s.y - s.sourceY) * uy > 0) downwind++;
      }
      const travel = spots.map((s) => s.travel).sort((a, b) => a - b);
      log(`${tier}: ${spots.length} spot fires (${downwind}/${withSource} downwind of their source), travel median ${travel[travel.length >> 1]?.toFixed(0)} m, max ${travel[travel.length - 1]?.toFixed(0)} m; max active embers ${maxEmbers}; embers left the domain ${last.stats.embersLeftDomain}`);
      expect(maxEmbers).toBeGreaterThan(100);
      expect(spots.length).toBeGreaterThanOrEqual(3);
      expect(downwind / Math.max(1, withSource)).toBeGreaterThanOrEqual(0.7);
      expect(travel[travel.length - 1]!).toBeGreaterThan(300);
    });

    it('generates insights of several kinds, including an upslope run, spotting and the wind change', () => {
      const kinds = new Map<string, number>();
      for (const i of r.insights) kinds.set(i.kind, (kinds.get(i.kind) ?? 0) + 1);
      const forecastKinds = r.sim.forecastInsights.map((i) => i.kind);
      log(`${tier}: insights ${[...kinds].map(([k, n]) => `${k}×${n}`).join(', ')}; forecast ${forecastKinds.join(', ')}`);
      expect(kinds.size).toBeGreaterThanOrEqual(6);
      expect(kinds.has('upslope-run')).toBe(true);
      expect(kinds.has('spotting') || kinds.has('spot-fire') || kinds.has('mass-spotting')).toBe(true);
      expect(kinds.has('wind-change') || forecastKinds.includes('wind-change')).toBe(true);
      for (const i of r.insights) {
        expect(i.title.length).toBeGreaterThan(0);
        expect(i.time).toBeGreaterThanOrEqual(0);
        expect(i.time).toBeLessThanOrEqual(HOURS * 3600);
      }
    });

    it('explainAt gives a coherent narrative for a burnt escarpment cell and a cell ahead of the fire', () => {
      const t = r.scenario.terrain;
      const f = r.snaps.get(10800)!.fire;
      // A burnt cell on the escarpment above the ignition (steepest burnt cell within 400 m).
      let best = -1;
      for (let k = 0; k < f.arrivalTime.length; k++) {
        if (!(f.arrivalTime[k]! < Infinity)) continue;
        const [x, y] = cellXY(t, k);
        if (Math.hypot(x - IGN_X, y - IGN_Y) > 400) continue;
        if (best < 0 || t.slopeDeg[k]! > t.slopeDeg[best]!) best = k;
      }
      expect(best).toBeGreaterThanOrEqual(0);
      const [bx, by] = cellXY(t, best);
      const ex = r.sim.explain(bx, by);
      log(`${tier}: explain (${bx}, ${by}) slope ${ex.slopeDeg.toFixed(0)}°, arrival ${(ex.arrivalTime / 60).toFixed(0)} min, ROS ${(ex.ros * 3.6).toFixed(2)} km/h, driver ${SpreadDriver[ex.driver]}:\n    ${ex.narrative.join('\n    ')}`);
      expect(Number.isFinite(ex.arrivalTime)).toBe(true);
      expect(ex.ros).toBeGreaterThan(0);
      expect(ex.driver).not.toBe(SpreadDriver.None);
      expect(ex.narrative.length).toBeGreaterThanOrEqual(3);
      expect(ex.narrative.join(' ')).toMatch(/slope|wind|litter/i);
      expect(ex.deadFuelMoisture).toBeGreaterThan(2);
      expect(ex.deadFuelMoisture).toBeLessThan(15);
      // Unburnt plateau cell downwind: an evaluation of the cell under the current conditions.
      const ahead = r.sim.explain(3000, -3500);
      expect(Number.isFinite(ahead.ros)).toBe(true);
      expect(ahead.narrative.length).toBeGreaterThanOrEqual(1);
    });

    it('checkpoint → rewind → re-run is bitwise deterministic (§12.5, V18)', () => {
      const first = new Map(r.snaps);
      const again = new Map<number, SimSnapshot>();
      const sim = r.sim;
      (sim as unknown as { hooks: { snapshot: (s: SimSnapshot) => void } }).hooks.snapshot = (s) => again.set(s.time, s);
      const target = HOURS * 3600 - 2400; // 1.33 h before the end → restores the checkpoint 30 min before that
      const cp = sim.rewind(target);
      expect(cp).toBeLessThanOrEqual(target);
      expect(cp).toBeLessThan(target);
      sim.advance(HOURS * 3600);
      const times = [...again.keys()];
      expect(times[0]).toBeGreaterThan(target);
      for (const t of times) {
        const skip = t === times[0] ? ['stats.msPerSimMinute', 'insights'] : ['stats.msPerSimMinute'];
        expect(snapshotHash(again.get(t)!, skip), `t=${t}`).toBe(snapshotHash(first.get(t)!, skip));
      }
    });

    it('meets the §13 performance budget within the CI tolerance (logged: s per simulated hour)', () => {
      const perHour = r.wallS / (r.perf.simSeconds / 3600);
      // V20 gates on x86 (Katoomba 9 km, 4 h): fast ≤ 15 s, standard ≤ 40 s → 3.75 / 10 s per hour. This fire is far
      // larger than the gate scenario (hundreds of ha, thousands of embers); the assertion allows 3× for that and for
      // shared CI machines.
      const gate = tier === 'fast' ? 3.75 : 10;
      log(`${tier}: ${perHour.toFixed(2)} s per simulated hour (V20 gate ${gate} s/h)`);
      expect(perHour).toBeLessThan(3 * gate);
      expect(r.initS).toBeLessThan(10);
    });
  });
}

d('B. Black Summer replay: Gospers Mountain 2019-12-19 (fast tier, 3 h)', () => {
  let r: RunResult;
  beforeAll(async () => {
    const base = await demoScenario({ site: 'gospers', replay: 'gospers-2019-12-19', duration: 3 * 3600 });
    // First dry-forest cell west of the centre.
    let x = -2000;
    for (let q = 0; q < 60; q++, x += 30) if (base.fuel.type[cellOf(base.terrain, x, 0)] === 4) break;
    r = await run(withIgnitions(base, [pointIgnition('gospers', x, 0, 0, 60)]), 'fast', 3 * 3600);
    perfTable('Gospers replay fast', r);
  }, 600000);

  it('uses the replay drought state (V19: KBDI 125 ± 3, DF 10) and flags the synthetic upper air', () => {
    expect(r.sim.kbdi).toBeGreaterThan(122);
    expect(r.sim.kbdi).toBeLessThan(128);
    expect(r.sim.droughtFactor).toBeCloseTo(10, 0);
    expect(r.scenario.weather.upperAirSource).toBe('synthetic');
    expect((r.scenario.weather.warnings ?? []).join(' ')).toMatch(/upper-air|synthetic/i);
  });

  it('spreads, spots and runs hot under the replay weather', () => {
    const s = [...r.snaps.values()];
    const last = r.snaps.get(10800)!;
    log(`gospers: area ${s.filter((x) => x.time % 3600 === 0).map((x) => x.stats.burntAreaHa.toFixed(0)).join(' → ')} ha, spots ${last.stats.spotFires}, FFDI ${last.stats.ffdi.toFixed(0)}, ${last.stats.fireDangerRating}, T ${last.stats.weather.temperature.toFixed(0)} °C RH ${last.stats.weather.relativeHumidity.toFixed(0)} %, M ${last.stats.deadFuelMoistureMean.toFixed(1)} %; insights ${[...new Set(r.insights.map((i) => i.kind))].join(', ')}`);
    expect(last.stats.burntAreaHa).toBeGreaterThan(50);
    expect(last.stats.burntAreaHa).toBeGreaterThan(r.snaps.get(3600)!.stats.burntAreaHa * 2);
    expect(last.stats.spotFires).toBeGreaterThan(0);
    expect(last.stats.ffdi).toBeGreaterThan(30);
    expect(last.stats.weather.temperature).toBeGreaterThan(35);
    expect(last.stats.deadFuelMoistureMean).toBeLessThan(7);
    expect(new Set(r.insights.map((i) => i.kind)).size).toBeGreaterThanOrEqual(4);
  });
});

d('C. Calm night with katabatic drainage (15 Mar)', () => {
  let fast: RunResult;
  let std: RunResult;
  beforeAll(async () => {
    const night = await demoScenario({ preset: 'calm-night-katabatic', startCivil: [2025, 3, 15, 20], duration: 7 * 3600 });
    fast = await run(withIgnitions(night, [pointIgnition('night', IGN_X, IGN_Y, 0, 60)]), 'fast', 7 * 3600);
    perfTable('calm night fast', fast);
    const late = await demoScenario({ preset: 'calm-night-katabatic', startCivil: [2025, 3, 16, 1], duration: 2 * 3600 });
    std = await run(late, 'standard', 2 * 3600);
    perfTable('calm night standard (no fire)', std);
  }, 900000);

  /** Share of slopes > 10° whose background 10 m wind points downslope (within 60°) at 0.5–3 m/s; valley-floor speed. */
  function katabatic(r: RunResult): { share: number; valleyMean: number; valleyMax: number } {
    const v = r.sim.stateView();
    const t = r.scenario.terrain;
    let n = 0;
    let down = 0;
    let vs = 0;
    let vn = 0;
    let vmax = 0;
    for (let k = 0; k < t.elevation.length; k++) {
      const u = v.windBgU[k]!;
      const w = v.windBgV[k]!;
      const sp = Math.hypot(u, w);
      if (t.slopeDeg[k]! > 10 && Number.isFinite(t.aspectDeg[k]!)) {
        n++;
        const [ax, ay] = azimuthToUnit(t.aspectDeg[k]!);
        if (sp >= 0.5 && sp <= 3 && (u * ax + w * ay) / sp >= 0.5) down++;
      }
      if (v.derived.heightAboveValley[k]! < 20 && t.slopeDeg[k]! < 5) {
        vn++;
        vs += sp;
        vmax = Math.max(vmax, sp);
      }
    }
    return { share: down / n, valleyMean: vs / Math.max(1, vn), valleyMax: vmax };
  }

  it('fast tier: the fire slows through the night as the fuel wets up', () => {
    const at = (h: number): SimSnapshot => fast.snaps.get(h * 3600)!;
    const early = Math.max(...[1, 2, 3, 4, 5, 6].map((m) => fast.snaps.get(m * 300)!.stats.maxIntensity));
    const late = Math.max(...[1, 2, 3, 4, 5, 6].map((m) => fast.snaps.get(6 * 3600 + m * 300)!.stats.maxIntensity));
    log(`night fast: area ${[1, 3, 5, 7].map((h) => at(h).stats.burntAreaHa.toFixed(1)).join(' → ')} ha; max I first hour ${early.toFixed(0)} kW/m, last hour ${late.toFixed(0)} kW/m; M ${at(1).stats.deadFuelMoistureMean.toFixed(1)} → ${at(7).stats.deadFuelMoistureMean.toFixed(1)} %`);
    expect(at(7).stats.deadFuelMoistureMean).toBeGreaterThan(at(1).stats.deadFuelMoistureMean + 3);
    expect(late).toBeLessThan(0.5 * early);
    const growthEarly = at(2).stats.burntAreaHa - at(1).stats.burntAreaHa;
    const growthLate = at(7).stats.burntAreaHa - at(6).stats.burntAreaHa;
    expect(growthLate).toBeLessThan(growthEarly);
    const ratings = new Set([...fast.snaps.values()].map((s) => s.stats.fireDangerRating));
    expect(ratings.has('Catastrophic') || ratings.has('Extreme')).toBe(false);
  });

  it('fast tier: katabatic drainage on the slopes, calm valley floor, night cards (V6 fast part)', () => {
    const k = katabatic(fast);
    const kinds = new Set(fast.insights.map((i) => i.kind));
    log(`night fast 03:00: ${(100 * k.share).toFixed(0)} % of slopes > 10° drain downslope at 0.5–3 m/s; valley floor mean ${k.valleyMean.toFixed(2)} m/s (max ${k.valleyMax.toFixed(2)}); cards ${[...kinds].join(', ')}; stable-night Δθ ${fast.sim.stateView().night.dTheta.toFixed(2)} K`);
    expect(k.share).toBeGreaterThanOrEqual(0.6);
    expect(k.valleyMean).toBeLessThan(2);
    expect(kinds.has('katabatic-wind') || kinds.has('thermal-belt')).toBe(true);
    expect(fast.sim.stateView().night.dTheta).toBeGreaterThan(3);
  });

  it('standard tier: 3-D katabatic flows by 03:00 (V6)', () => {
    const k = katabatic(std);
    const kinds = new Set(std.insights.map((i) => i.kind));
    log(`night standard 03:00: ${(100 * k.share).toFixed(0)} % of slopes > 10° drain downslope at 0.5–3 m/s; valley floor mean ${k.valleyMean.toFixed(2)} m/s; spun up ${std.sim.stateView().atmosDiag.spunUp}; cards ${[...kinds].join(', ')}`);
    expect(std.sim.tier).toBe('standard');
    expect(k.share).toBeGreaterThanOrEqual(0.6);
    expect(k.valleyMean).toBeLessThan(2);
    expect(kinds.has('katabatic-wind')).toBe(true);
  });
});
