/**
 * Coupled-model validation of spread behaviour on flat synthetic ground (spec §15 V12, V13, V14, V16 and the brief's
 * fuel items), headless through `Simulation` (fast tier unless stated, mountainPhenomena on, embers off):
 *  V12 a wind change turns the NE flank into the head (dead-man zone), with the wind-change card well before;
 *  V13 a 2-yr-old prescribed burn (p 0.6) slows the head (ROS ≤ 0.5×, I ≤ 0.4× at 10 km/h), recent-burn card;
 *  V14 two line fires at 30° close at ≥ 0.9·R/sin 15°; junction card;
 *  V16 level-set stability in the coupled loop: a calm flat fire is a circle, a wind-driven one a smooth ellipse;
 *  fuel: the fire stops at a non-fuel break and at a fresh burn scar, and more litter (hazard edit) runs faster.
 */
import { describe, expect, it } from 'vitest';
import { LocalProjection } from '../../core/geo';
import { cellAt } from '../../core/grid';
import { angleDiffDeg } from '../../core/units';
import { FuelType, SpreadDriver } from '../../core/types';
import { buildFuelMap } from '../../fuel/fuelMap';
import { parseFireHistory, rasteriseFireHistory } from '../../fuel/history';
import { WEATHER_PRESETS } from '../../scenario/presets';
import { lmstToUtc } from '../../scenario/time';
import { terrainDerived } from '../../terrain';
import { DEG, ORIGIN, burntCount, extentAlong, kernelAt, kindsOf, line, log, median, point, rosAlong, runSim, sampleField, synth, type RunResult } from './harness';

describe('V12 wind change (hot-nw-sw-change 20 Dec, flat forest, ignition 11:00 LMST)', () => {
  const start = lmstToUtc('2025-12-20', 11, ORIGIN.lon);
  const weather = WEATHER_PRESETS['hot-nw-sw-change'].build(start, 6, { location: ORIGIN, sourceElevation: 500 });
  const tc = (lmstToUtc('2025-12-20', 15, ORIGIN.lon) - start) / 1000;
  const newTo = 50; // post-change wind from 230°

  it('after 15:00 the NE flank runs as the head within 30 min; wind-change card ≥ 60 min before with the flank length ±20 %', () => {
    const s = synth({ extent: 12000, start, duration: 6 * 3600, weather, ignitions: [point(-2000, 2000, 0, 45)] });
    const heads = new Map<number, { dir: number; ros: number }>();
    const flankAt = new Map<number, number>();
    const r = runSim(s, {
      until: tc + 3600,
      every: 300,
      onTick: (sim, t) => {
        const st = sim.stats();
        heads.set(t, { dir: st.headDir, ros: st.headRos });
        // Independent exposed-flank length: perimeter cells whose outward normal (Sobel on the burnt indicator) is
        // within 45° of the new windTo, × Δx × 1.122 (mean staircase length per cell over orientations).
        const f = sim.stateView().fire;
        const g = s.terrain.grid;
        const b = (i: number, j: number): number => (f.arrivalTime[j * g.nx + i]! <= t ? 1 : 0);
        let n = 0;
        for (let j = 1; j < g.ny - 1; j++) {
          for (let i = 1; i < g.nx - 1; i++) {
            if (!b(i, j) || (b(i - 1, j) && b(i + 1, j) && b(i, j - 1) && b(i, j + 1))) continue;
            const gx = b(i + 1, j + 1) + 2 * b(i + 1, j) + b(i + 1, j - 1) - b(i - 1, j + 1) - 2 * b(i - 1, j) - b(i - 1, j - 1);
            const gy = b(i + 1, j + 1) + 2 * b(i, j + 1) + b(i - 1, j + 1) - b(i + 1, j - 1) - 2 * b(i, j - 1) - b(i - 1, j - 1);
            if (gx === 0 && gy === 0) continue;
            const az = (Math.atan2(-gx, -gy) / DEG + 360) % 360; // outward = −∇(burnt)
            if (Math.abs(angleDiffDeg(az, newTo)) <= 45) n++;
          }
        }
        flankAt.set(t, n * g.cellSize * 1.122);
      },
    });
    const pre = heads.get(tc - 1800)!;
    const post = heads.get(tc + 1800)!;
    const f = r.sim.stateView().fire;
    const ne: number[] = [];
    for (let k = 0; k < f.arrivalTime.length; k++) {
      const ta = f.arrivalTime[k]!;
      if (ta > tc + 600 && ta < tc + 2400 && Math.abs(angleDiffDeg(f.spreadDir[k]!, newTo)) < 30) ne.push(f.ros[k]!);
    }
    const cards = r.insights.filter((i) => i.kind === 'wind-change');
    const early = cards.find((c) => c.time <= tc - 3600);
    const cardKm = early ? Number(/(\d+(?:\.\d+)?) km flank/.exec(early.body)?.[1]) : NaN;
    const tCard = early ? Math.round(early.time / 300) * 300 : NaN;
    const measuredKm = (flankAt.get(tCard) ?? NaN) / 1000;
    log(`V12: head 30 min before ${pre.dir.toFixed(0)}° ${(pre.ros * 3.6).toFixed(1)} km/h; 30 min after ${post.dir.toFixed(0)}° ${(post.ros * 3.6).toFixed(1)} km/h; NE-moving cells after the change median ${(median(ne) * 3.6).toFixed(2)} km/h (n ${ne.length}); card at ${early ? ((early.time - tc) / 60).toFixed(0) : '—'} min: ${cardKm} km vs measured ${measuredKm.toFixed(2)} km; cards ${[...kindsOf(r.insights)].join(', ')}`);
    expect(Math.abs(angleDiffDeg(post.dir, newTo))).toBeLessThanOrEqual(45);
    expect(median(ne)).toBeGreaterThanOrEqual(0.8 * pre.ros);
    expect(early).toBeDefined();
    expect(Math.abs(cardKm / measuredKm - 1)).toBeLessThanOrEqual(0.2);
    expect(kindsOf(r.insights).has('dead-man-zone')).toBe(true);
  }, 300000);
});

describe('V13 recent burn (flat DSF, 2-yr-old prescribed burn p 0.6 downwind; U10 10 km/h, M 8 %, DF 8)', () => {
  const t0 = Date.UTC(2026, 11, 20, 3);
  const proj = new LocalProjection(ORIGIN);
  const ll = (x: number, y: number): [number, number] => {
    const p = proj.toLatLon(x, y);
    return [p.lon, p.lat];
  };
  // NPWS convention: 13:00Z = local midnight of the next date → a 2024-12-19/20 burn, 2 yr before t0.
  const recs = parseFireHistory({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { FireType: 2, FireName: 'HR', FireYear: 202425, Label: '2024-25 Prescribed Burn', StartDate: Date.UTC(2024, 11, 18, 13), EndDate: Date.UTC(2024, 11, 19, 13) },
      geometry: { type: 'Polygon', coordinates: [[ll(0, -600), ll(1200, -600), ll(1200, 600), ll(0, 600), ll(0, -600)]] },
    }],
  });
  const run = (windKmh: number): RunResult => {
    let compact: ReturnType<typeof rasteriseFireHistory>['compact'] | undefined;
    const s = synth({
      extent: 4000, start: t0, windKmh, windFromDeg: 270, droughtFactor: 8, kbdi: 60, duration: 6 * 3600,
      fuel: (terrain) => {
        const hist = rasteriseFireHistory(terrain.grid, recs, t0);
        compact = hist.compact;
        return buildFuelMap({ terrain, derived: terrainDerived(terrain), classId: new Uint8Array(terrain.grid.nx * terrain.grid.ny).fill(13), history: hist, t0, droughtFactor: 8, kbdi: 60, month: 12 });
      },
      ignitions: [line([[-400, -1500], [-400, 1500]])],
    });
    return runSim({ ...s, fuelHistory: compact! }, { until: 6 * 3600, moisturePct: 8, every: 1800 });
  };
  const ratios = (r: RunResult): { ros: number; I: number } => {
    const g = r.scenario.terrain.grid;
    const f = r.sim.stateView().fire;
    const box = (y0: number, y1: number): { ros: number; I: number } => {
      const ros: number[] = [];
      const I: number[] = [];
      for (let x = 90; x <= 400; x += 30) {
        for (let y = y0; y <= y1; y += 30) {
          const k = cellAt(g, x, y);
          if (f.arrivalTime[k]! < Infinity) {
            ros.push(f.ros[k]!);
            I.push(f.intensity[k]!);
          }
        }
      }
      return { ros: median(ros), I: median(I) };
    };
    const a = box(-300, 300);
    const b = box(900, 1300);
    return { ros: a.ros / b.ros, I: a.I / b.I };
  };

  it('10 km/h: ROS inside/outside ≤ 0.5 and I inside/outside ≤ 0.4 (expected 0.25 / 0.20); recent-burn card', () => {
    const r = run(10);
    const q = ratios(r);
    log(`V13 10 km/h: ROS ratio ${q.ros.toFixed(2)}, I ratio ${q.I.toFixed(2)}`);
    expect(q.ros).toBeLessThanOrEqual(0.5);
    expect(q.I).toBeLessThanOrEqual(0.4);
    expect(kindsOf(r.insights).has('recent-burn')).toBe(true);
  }, 120000);

  it('20 km/h: the slowing shrinks (ROS ratio ≈ 0.72, the card\'s extreme-day caveat)', () => {
    const q = ratios(run(20));
    log(`V13 20 km/h: ROS ratio ${q.ros.toFixed(2)}, I ratio ${q.I.toFixed(2)}`);
    expect(q.ros).toBeGreaterThan(0.5);
    expect(q.ros).toBeLessThan(0.9);
  }, 120000);
});

describe('V14 junction (two line fires at a 30° included angle, calm, heath, M 8 %, Δx 10 m)', () => {
  const L = 500;
  const sx = L * Math.sin(15 * DEG);
  const sy = L * Math.cos(15 * DEG);
  for (const [tier, coupling] of [['fast', 0], ['fast', 1], ['standard', 1]] as const) {
    it(`${tier}, coupling ${coupling}: vertex closing speed ≥ 0.9·R/sin 15°; junction card`, () => {
      const s = synth({ extent: 1400, cellSize: 10, windKmh: 0, duration: 3600, fuelType: FuelType.Heath, ignitions: [line([[-sx, sy - 300], [0, -300]], 0, 'a'), line([[0, -300], [sx, sy - 300]], 0, 'b')], options: { coupling } });
      const r = runSim(s, { tier, until: 2400, moisturePct: 8, heating: false, every: 600 });
      const g = s.terrain.grid;
      const f = r.sim.stateView().fire;
      const R = kernelAt(r, cellAt(g, 0, 0), 0, 8).rw;
      const close = (150 / (sampleField(g, f.arrivalTime, 0, -50) - sampleField(g, f.arrivalTime, 0, -200))) * 3600;
      let nJ = 0;
      for (let k = 0; k < f.driver.length; k++) if (f.driver[k] === SpreadDriver.Junction) nJ++;
      log(`V14 ${tier} c${coupling}: closing ${close.toFixed(0)} m/h vs 0.9·R/sin15° ${((0.9 * R) / Math.sin(15 * DEG)).toFixed(0)} (R ${R.toFixed(0)} m/h); Junction drivers ${nJ}`);
      expect(close).toBeGreaterThanOrEqual((0.9 * R) / Math.sin(15 * DEG));
      expect(kindsOf(r.insights).has('junction-zone')).toBe(true);
      // The junction boost (§7.10) runs only with the pyrogenic potential off (coupling 0, or the 3-D tiers).
      if (tier === 'fast' && coupling === 1) expect(nJ).toBe(0);
      else expect(nJ).toBeGreaterThan(3);
    }, 180000);
  }
});

describe('V16 level-set stability in the coupled loop (flat, M 8 %, heating off)', () => {
  it('calm point fire: a circle (8 radii within 4 %, area within 6 % of πr̄²)', () => {
    const s = synth({ extent: 1200, cellSize: 10, windKmh: 0, duration: 4 * 3600, ignitions: [point(0, 0, 0, 12)] });
    const r = runSim(s, { until: 4 * 3600, moisturePct: 8, heating: false, every: 3600 });
    const g = s.terrain.grid;
    const tA = r.sim.stateView().fire.arrivalTime;
    const radii = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => extentAlong(g, tA, 4 * 3600, 0, 0, a));
    const rm = radii.reduce((a, b) => a + b, 0) / radii.length;
    const area = burntCount(tA, 4 * 3600) * g.cellSize * g.cellSize;
    log(`V16 circle: radii ${radii.map((x) => x.toFixed(0)).join(', ')} m; area/πr̄² ${(area / (Math.PI * rm * rm)).toFixed(3)}`);
    for (const x of radii) expect(Math.abs(x / rm - 1)).toBeLessThan(0.04);
    expect(Math.abs(area / (Math.PI * rm * rm) - 1)).toBeLessThan(0.06);
  }, 120000);

  it('wind-driven point fire (20 km/h): head/back/flank rates match the kernel ellipse; no oscillation in arrival times', () => {
    const s = synth({ extent: 4000, windKmh: 20, windFromDeg: 270, duration: 2 * 3600, ignitions: [point(-1200, 0, 0, 30)] });
    const r = runSim(s, { until: 1.5 * 3600, moisturePct: 8, heating: false, every: 1800 });
    const g = s.terrain.grid;
    const tA = r.sim.stateView().fire.arrivalTime;
    const head = rosAlong(g, tA, -1200, 0, 90, 500, 950) * 3600;
    const K = kernelAt(r, cellAt(g, 0, 0), 20, 8);
    // Strictly increasing arrival times along the head axis up to the 1.5 h reach (no level-set oscillation), and a
    // constant step once built up (steady head: successive 30 m increments within 5 % of each other).
    let mono = true;
    let prev = -Infinity;
    const steps: number[] = [];
    for (let d = 60; d <= 950; d += 30) {
      const t = sampleField(g, tA, -1200 + d, 0);
      if (!(t > prev)) mono = false;
      if (d >= 500) steps.push(t - prev);
      prev = t;
    }
    const sm = steps.reduce((a, b) => a + b, 0) / steps.length;
    expect(Math.max(...steps.map((x) => Math.abs(x / sm - 1)))).toBeLessThan(0.05);
    log(`V16 ellipse: head ${head.toFixed(0)} m/h vs R_w ${K.rw.toFixed(0)}; monotone ${mono}`);
    expect(Math.abs(head / K.rw - 1)).toBeLessThan(0.05);
    expect(mono).toBe(true);
  }, 120000);
});

describe('fuel: breaks, burn scars and litter edits (flat DSF, 20 km/h westerly, M 8 %)', () => {
  it('the front stops at a 60 m non-fuel break (embers off) and runs on without it', () => {
    const mk = (withBreak: boolean): RunResult => {
      const s = synth({ extent: 3000, windKmh: 20, duration: 3 * 3600, fuelOverride: withBreak ? (x) => (x > 0 && x <= 60 ? FuelType.NonFuel : null) : undefined, ignitions: [line([[-900, -600], [-900, 600]])] });
      return runSim(s, { until: 3 * 3600, moisturePct: 8, every: 1800 });
    };
    const withB = mk(true);
    const without = mk(false);
    const g = withB.scenario.terrain.grid;
    const beyond = (r: RunResult): number => burntCount(r.sim.stateView().fire.arrivalTime, 3 * 3600, (k) => g.x0 + (k % g.nx) * g.cellSize > 90);
    log(`break: burnt beyond the break ${beyond(withB)} cells (without the break ${beyond(without)})`);
    expect(beyond(withB)).toBe(0);
    expect(beyond(without)).toBeGreaterThan(1000);
  }, 120000);

  it('a fresh burn scar (setTimeSinceFire 0) stops or nearly stops the head; +1 surface hazard runs faster', () => {
    const base = synth({ extent: 3000, windKmh: 20, duration: 3 * 3600, ignitions: [line([[-900, -1200], [-900, 1200]])] });
    const scar = { kind: 'fuel' as const, id: 'scar', shape: { kind: 'polygon' as const, points: [[0, -1300], [600, -1300], [600, 0], [0, 0]] as [number, number][] }, setTimeSinceFire: 0 };
    const litter = { kind: 'fuel' as const, id: 'litter', shape: { kind: 'polygon' as const, points: [[0, 0], [600, 0], [600, 1300], [0, 1300]] as [number, number][] }, surfaceHazardDelta: 1 };
    const r = runSim({ ...base, edits: [scar, litter] }, { until: 3 * 3600, moisturePct: 8, every: 1800 });
    const ref = runSim(base, { until: 3 * 3600, moisturePct: 8, every: 1800 });
    const g = base.terrain.grid;
    const tE = r.sim.stateView().fire.arrivalTime;
    const tR = ref.sim.stateView().fire.arrivalTime;
    const rosScar = rosAlong(g, tE, 0, -600, 90, 60, 540) * 3600;
    const rosLitter = rosAlong(g, tE, 0, 600, 90, 60, 540) * 3600;
    const rosRef = rosAlong(g, tR, 0, 600, 90, 60, 540) * 3600;
    const reachScar = extentAlong(g, tE, 3 * 3600, 0, -600, 90, (k) => Math.abs(g.y0 + Math.floor(k / g.nx) * g.cellSize + 600) < 100);
    log(`fuel: scar ROS ${Number.isFinite(rosScar) ? rosScar.toFixed(0) : 'n/a'} m/h (reach ${reachScar.toFixed(0)} m into it), +1 litter ${rosLitter.toFixed(0)} m/h vs unedited ${rosRef.toFixed(0)} m/h`);
    expect(!Number.isFinite(rosScar) || rosScar <= 0.1 * rosRef).toBe(true);
    expect(rosLitter).toBeGreaterThan(1.1 * rosRef);
  }, 180000);
});
