/**
 * Every InsightKind fires in at least one crafted situation and not in a neutral one (task requirement; spec §10.2).
 * Situations are built with the SimStateView test double (testing/simState.ts).
 */
import { describe, expect, it } from 'vitest';
import { BurnState, FuelType, type Insight, type InsightKind, type SpotFire } from '../core/types';
import { windToUV } from '../core/units';
import { InsightEngine, type InsightEngineOptions } from './engine';
import { INSIGHT_KINDS, INSIGHT_RULES } from './registry';
import { DOCTRINE, GENERAL_SUBS } from './text';
import { TestWorld, type WorldOptions } from './testing/simState';

const tan = (d: number): number => Math.tan((d * Math.PI) / 180);

/** Kinds (and general sub-notes) that fired anywhere in this file, checked by the coverage test at the end. */
const FIRED = new Set<string>();

/** Run the engine for `cycles` detector cycles (60 s apart) starting at sim time t0, applying `each` first. */
function run(w: TestWorld, cycles = 3, opts: InsightEngineOptions = {}, each?: (c: number) => void, t0 = 60): { all: Insight[]; eng: InsightEngine } {
  const eng = new InsightEngine(w.terrain, w.derived, w.fuel, w.features, { startTime: w.startMs, ...opts });
  const all: Insight[] = [];
  for (let c = 0; c < cycles; c++) {
    w.setTime(t0 + 60 * c);
    each?.(c);
    all.push(...eng.update(w.view));
  }
  for (const i of all) FIRED.add(i.kind === 'general' ? (i.key ?? 'general') : i.kind);
  return { all, eng };
}
const kinds = (xs: Insight[]): InsightKind[] => xs.map((i) => i.kind);
const of = (xs: Insight[], k: InsightKind): Insight[] => xs.filter((i) => i.kind === k);

/** The neutral situation: flat forest, mild spring morning, small quiet fire. */
function neutral(o: WorldOptions = {}): TestWorld {
  const w = new TestWorld(o);
  w.igniteDisc(0, 0, 150);
  return w;
}

describe('neutral situation', () => {
  it('raises no card of any kind over 10 cycles', () => {
    const w = neutral();
    const { all } = run(w, 10);
    expect(all).toEqual([]);
  });
});

describe('terrain cards', () => {
  it('upslope-run: info on 15°, watch on 25° (with "at least" and the steep note), none on flat', () => {
    for (const [deg, sev] of [
      [15, 'info'],
      [25, 'watch'],
    ] as const) {
      const w = new TestWorld({ elevation: (_x, y) => 600 + tan(deg) * y });
      w.igniteLine(-600, -500, 600, -500, 0, { ros: 0.1 });
      const up = of(run(w).all, 'upslope-run');
      expect(up.length).toBeGreaterThan(0);
      expect(up[0]!.severity).toBe(sev);
      expect(up[0]!.body).toContain(`${deg}° slope`);
      if (deg > 20) expect(up[0]!.body).toContain('steeper than the tested range');
      expect(up[0]!.body).toContain(deg === 15 ? '×2.8' : '×5.7');
      expect(up[0]!.key).toMatch(/^upslope-run:\d+:\d+$/);
    }
    const flat = new TestWorld();
    flat.igniteLine(-600, -500, 600, -500, 0, { ros: 0.1 });
    expect(kinds(run(flat).all)).not.toContain('upslope-run');
  });

  it('downslope-backing: kataburn percentage; S43 near a narrow gully floor; S10 strong downslope wind', () => {
    const w = new TestWorld({ elevation: (_x, y) => 600 + tan(15) * y });
    w.setWind(2, 90);
    w.igniteLine(-600, 500, 600, 500, 180, { ros: 0.005 });
    const b = of(run(w).all, 'downslope-backing');
    expect(b[0]?.severity).toBe('info');
    expect(b[0]!.body).toContain('about 61 % of its flat-ground speed');

    // S43: V valley floor at y = −1000 (20° walls), fire backing down to it from the north.
    const v = new TestWorld({ elevation: (_x, y) => 600 + tan(20) * Math.abs(y + 1000) });
    v.setWind(2, 90);
    v.cells((_k, _x, y) => Math.abs(y + 1000) <= 15).forEach((k) => (v.features.narrowValley[k] = 1));
    v.igniteLine(-600, -950, 600, -950, 180, { ros: 0.005, behind: 200 });
    const s43 = of(run(v).all, 'downslope-backing');
    expect(s43[0]?.severity).toBe('watch');
    expect(s43[0]!.body).toContain('running up the other side');

    // S10: 30 km/h from the north blowing down a south-facing 15° slope, dry litter.
    const d = new TestWorld({ elevation: (_x, y) => 600 + tan(15) * y, moisture: 6 });
    d.setWind(30 / 3.6, 0);
    d.igniteDisc(0, 0, 200);
    const s10 = of(run(d).all, 'downslope-backing');
    expect(s10[0]?.severity).toBe('watch');
    expect(s10[0]!.title).toBe('Strong wind can push fire downhill');
  });

  /** A 25° slope rising north with a 40 m deep gully along x = 0. */
  function gullyWorld(): { w: TestWorld; gully: number[]; base: number } {
    const w = new TestWorld({ elevation: (x, y) => 600 + tan(25) * y - 45 * Math.exp((-x * x) / (2 * 50 * 50)) });
    const gully = w.cells((_k, x, y) => Math.abs(x) < 1 && y >= -600 && y <= 400);
    const base = w.cell(0, -600);
    for (const k of gully) {
      w.features.drainage[k] = 1;
      w.features.trench[k] = 0.8;
      w.features.gullyAxis[k] = 0;
      w.features.gullyBase[k] = base;
    }
    return { w, gully, base };
  }

  it('gully-chimney: watch with up-gully wind and fire at the base; danger with A·E ≥ 0.5; none with down-gully wind', () => {
    const { w } = gullyWorld();
    w.setWind(15 / 3.6, 180);
    w.igniteDisc(0, -640, 90);
    const g = of(run(w).all, 'gully-chimney');
    expect(g[0]?.severity).toBe('watch');
    expect(g[0]!.body).toContain('chimney');

    const d = gullyWorld();
    d.w.setWind(15 / 3.6, 180);
    for (const k of d.gully) d.w.view.aux.attach[k] = 0.7;
    d.w.igniteDisc(0, -640, 90);
    expect(of(run(d.w).all, 'gully-chimney')[0]?.severity).toBe('danger');

    const n = gullyWorld();
    n.w.setWind(15 / 3.6, 0);
    n.w.igniteDisc(0, -640, 90);
    expect(kinds(run(n.w).all)).not.toContain('gully-chimney');
  });

  it('eruptive-slope: 30° chute with trench → watch, danger with A·E and G; open slope (T = 0) → none', () => {
    const mk = (trench: number, ae: number): Insight[] => {
      const w = new TestWorld({ elevation: (_x, y) => 600 + tan(30) * y });
      w.setWind(2, 90);
      w.forEach((k, x) => {
        if (Math.abs(x) <= 200) {
          w.features.trench[k] = trench;
          w.view.aux.attach[k] = ae;
        }
      });
      w.igniteLine(-150, -500, 150, -500, 0, { ros: 0.2 });
      return run(w).all;
    };
    const e = of(mk(1, 0), 'eruptive-slope');
    expect(e[0]?.severity).toBe('watch');
    expect(e[0]!.body).toContain('Eruptive regime: model indicative only.');
    expect(of(mk(1, 0.8), 'eruptive-slope')[0]?.severity).toBe('danger');
    expect(kinds(mk(0, 0))).not.toContain('eruptive-slope');
  });

  it('ridge-crest: cross-ridge wind ≥ 15 km/h with the front within 150 m of the crest; not in light wind', () => {
    const mk = (kmh: number): Insight[] => {
      const w = new TestWorld({ elevation: (_x, y) => 400 + 300 * Math.exp((-y * y) / (2 * 500 * 500)) });
      w.setWind(kmh / 3.6, 180);
      w.igniteLine(-500, -140, 500, -140, 0, { ros: 0.05 });
      return run(w).all;
    };
    const r = of(mk(20), 'ridge-crest');
    expect(r[0]?.severity).toBe('watch');
    expect(r[0]!.body).toContain('about 20 km/h on the ridge');
    expect(kinds(mk(8))).not.toContain('ridge-crest');
  });

  it('lee-slope-eddy: s_sep ≥ 0.5 ahead of the front → info, on burning cells → watch', () => {
    const w = neutral();
    w.forEach((k, x, y) => {
      if (x > 250 && x < 450 && Math.abs(y) < 150) w.view.aux.sep[k] = 0.7;
    });
    const a = of(run(w).all, 'lee-slope-eddy');
    expect(a[0]?.severity).toBe('info');
    expect(a[0]!.confidence).toBe('sub-grid');
    expect(a[0]!.body).toContain("The model can't see this precisely.");
    const b = neutral();
    b.forEach((k, x, y) => {
      if (Math.hypot(x, y) < 160 && Math.hypot(x, y) > 80) b.view.aux.sep[k] = 0.7;
    });
    expect(of(run(b).all, 'lee-slope-eddy')[0]?.severity).toBe('watch');
  });

  it('vorticity-lateral-spread: active zone → danger; VLS terrain downwind of the head → watch pre-warning', () => {
    const w = neutral();
    w.forEach((k, x, y) => {
      if (Math.hypot(x, y) < 160) {
        w.view.aux.vls[k] = 0.85;
        w.view.aux.vlsActive[k] = 1;
      }
    });
    const a = of(run(w).all, 'vorticity-lateral-spread');
    expect(a[0]?.severity).toBe('danger');
    expect(a[0]!.body).toMatch(/about \d(\.\d)? km\/h in 10–15 min surges/);
    const p = neutral();
    p.setWind(25 / 3.6, 270);
    p.forEach((k, x, y) => {
      if (x > 500 && x < 800 && Math.abs(y) < 200) p.view.aux.vls[k] = 0.7;
    });
    const pre = of(run(p).all, 'vorticity-lateral-spread');
    expect(pre[0]?.severity).toBe('watch');
    expect(pre[0]!.title).toContain('Lee slope ahead');
  });

  it('saddle-channelling: saddle within 1 km ahead of the head with ≥ 15 km/h; none when the fire runs away from it', () => {
    const mk = (spreadTo: number, yLine: number): Insight[] => {
      const w = new TestWorld({ elevation: (x, y) => 400 + 300 * Math.exp((-y * y) / (2 * 400 * 400)) * (0.6 + 0.4 * (x * x / 1e6) * Math.exp(1 - (x * x) / 1e6)) });
      w.setWind(20 / 3.6, 180);
      w.cells((_k, x, y) => Math.abs(x) <= 30 && Math.abs(y) <= 30).forEach((k) => (w.features.saddle[k] = 1));
      w.igniteLine(-300, yLine, 300, yLine, spreadTo, { ros: 0.1 });
      return run(w).all;
    };
    const s = of(mk(0, -700), 'saddle-channelling');
    expect(s[0]?.severity).toBe('watch');
    expect(s[0]!.body).toContain('saddle');
    expect(kinds(mk(180, -700))).not.toContain('saddle-channelling');
  });

  it('valley-channelling: valley-floor wind ≥ 45° off the ridge-top wind near the fire', () => {
    const w = new TestWorld({ elevation: (x) => 500 + 0.0003 * x * x });
    w.setWind(5, 270); // ridge-top (background) wind from the west
    const [u, v] = windToUV(3, 0); // floor wind from the north
    w.forEach((k, x) => {
      if (Math.abs(x) < 250) {
        w.view.windU[k] = u;
        w.view.windV[k] = v;
      }
    });
    w.igniteDisc(600, 0, 120);
    const c = of(run(w).all, 'valley-channelling');
    expect(c[0]?.severity).toBe('info');
    expect(c[0]!.body).toContain('valley-floor wind is from the north');
    expect(c[0]!.body).toContain('ridge-top wind is from the west');
    const n = new TestWorld({ elevation: (x) => 500 + 0.0003 * x * x });
    n.setWind(5, 270);
    n.igniteDisc(600, 0, 120);
    expect(kinds(run(n).all)).not.toContain('valley-channelling');
  });

  it('ridge-speed-up (P1): fast-tier analytic speed-up on a crest within 1 km of the front; standard tier from the field', () => {
    const w = new TestWorld({ elevation: (_x, y) => 400 + 300 * Math.exp((-y * y) / (2 * 500 * 500)) });
    w.setWind(15 / 3.6, 180);
    w.igniteLine(-500, -800, 500, -800, 0, { ros: 0.05 });
    const a = of(run(w).all, 'ridge-speed-up');
    expect(a[0]?.severity).toBe('info');
    expect(a[0]!.body).toMatch(/about \+\d+ %/);
    const s = new TestWorld({ elevation: (_x, y) => 400 + 300 * Math.exp((-y * y) / (2 * 500 * 500)) });
    s.view.tier = 'standard';
    s.setWind(15 / 3.6, 180);
    // Background speed-up: ×1.4 near the crest.
    const [u, v] = windToUV(1.4 * (15 / 3.6), 180);
    s.forEach((k, _x, y) => {
      if (Math.abs(y) < 200) {
        s.view.windBgU[k] = u;
        s.view.windBgV[k] = v;
      }
    });
    s.igniteLine(-500, -800, 500, -800, 0, { ros: 0.05 });
    const b = of(run(s).all, 'ridge-speed-up');
    expect(b[0]?.body).toContain('+40 %');
    const flat = new TestWorld();
    flat.view.tier = 'standard';
    flat.igniteDisc(0, 0, 150);
    expect(kinds(run(flat).all)).not.toContain('ridge-speed-up');
  });
});

describe('fire and ember cards', () => {
  const spot = (id: number, x: number, y: number, time: number, distance: number, extra: Partial<SpotFire> = {}): SpotFire => ({ id, x, y, time, distance, travel: distance + 100, ...extra });

  it('spotting: ignitable landings ≥ 500 m ahead; bark variant; none without', () => {
    const w = neutral();
    w.view.emberStats.maxIgnitableDistance10min = 1200;
    const s = of(run(w).all, 'spotting');
    expect(s[0]?.severity).toBe('watch');
    expect(s[0]!.body).toContain('1.2 km ahead');
    const b = neutral({ moisture: 6 });
    b.setWind(35 / 3.6, 270);
    b.fuel.barkHazard.fill(3.5);
    expect(of(run(b).all, 'spotting')[0]?.body).toContain('Stringybark');
  });

  it('spot-fire: info at 600 m, watch at ≥ 1 km, with provenance text; nothing for a spot next to the front', () => {
    const w = neutral();
    const { all } = run(w, 3, {}, (c) => {
      if (c === 1) w.view.spotFires.push(spot(1, 900, 0, 100, 600, { flightTime: 40, maxHeightAGL: 120, landingMoisture: 7, emberClass: 'ribbon', sourceX: 150, sourceY: 0 }));
      if (c === 2) w.view.spotFires.push(spot(2, 0, 1600, 160, 1400));
    });
    const s = of(all, 'spot-fire');
    expect(s.map((i) => i.severity)).toEqual(['info', 'watch']);
    expect(s[0]!.body).toContain('An ember from a burning ribbon of bark');
    expect(s[0]!.body).toContain('(40 s, up to 120 m high) and landed on 7 % litter');
    const n = neutral();
    const r = run(n, 3, {}, (c) => c === 1 && n.view.spotFires.push(spot(1, 180, 0, 100, 40)));
    expect(kinds(r.all)).not.toContain('spot-fire');
  });

  it('mass-spotting: ≥ 10 spot ignitions within 30 min within 2 km → danger', () => {
    const w = neutral();
    for (let a = 0; a < 12; a++) w.view.spotFires.push(spot(a + 1, 800 + 50 * a, 300, 30 + a, 500));
    const m = of(run(w).all, 'mass-spotting');
    expect(m[0]?.severity).toBe('danger');
    const n = neutral();
    for (let a = 0; a < 6; a++) n.view.spotFires.push(spot(a + 1, 800 + 50 * a, 300, 30 + a, 500));
    expect(kinds(run(n).all)).not.toContain('mass-spotting');
  });

  it('junction-zone: two lines closing at 30° → danger with ×3.9; parallel fronts far apart → none', () => {
    const w = new TestWorld();
    // Vertex at (0, −600); line A along azimuth 15°, line B along 345°, both spreading into the pocket.
    const L = 900;
    const ax = L * Math.sin((15 * Math.PI) / 180);
    const ay = L * Math.cos((15 * Math.PI) / 180);
    w.igniteLine(0, -600, ax, -600 + ay, 285, { behind: 90 });
    w.igniteLine(0, -600, -ax, -600 + ay, 75, { behind: 90 });
    const j = of(run(w).all, 'junction-zone');
    expect(j[0]?.severity).toBe('danger');
    expect(j[0]!.body).toMatch(/×(3\.\d|4\.\d)/);
    const n = new TestWorld();
    n.igniteLine(-1500, -1000, -1500, 1000, 270);
    n.igniteLine(1500, -1000, 1500, 1000, 90);
    expect(kinds(run(n).all)).not.toContain('junction-zone');
  });

  it('plume-dominated: N_c ≥ 10 over ≥ 200 m of head for 5 cycles; not before', () => {
    const w = new TestWorld();
    w.igniteDisc(0, 0, 400);
    for (let k = 0; k < w.N; k++) if (w.view.aux.direction[k]! >= 0.8) w.view.aux.nc[k] = 15;
    expect(kinds(run(w, 4).all)).not.toContain('plume-dominated');
    const p = of(run(w, 6).all, 'plume-dominated');
    expect(p[0]?.severity).toBe('watch');
  });

  it('fire-induced-wind (P1): |U_fireInd| ≥ 1.5 m/s on ≥ 30 % of the front for 5 cycles; not with coupling 0', () => {
    const w = neutral();
    w.view.fireIndU.fill(2.5);
    expect(of(run(w, 6).all, 'fire-induced-wind')[0]?.severity).toBe('watch');
    w.view.coupling = 0;
    expect(kinds(run(w, 6).all)).not.toContain('fire-induced-wind');
  });

  it('crown-fire: I ≥ 10 000 kW/m on the front → danger; FH > 0.66·H_o,eff with I ≥ 4000 → danger', () => {
    const w = new TestWorld();
    w.igniteDisc(0, 0, 150, { intensity: 12000, flameHeight: 20 });
    const c = of(run(w).all, 'crown-fire');
    expect(c[0]?.severity).toBe('danger');
    expect(c[0]!.body).toContain('12000 kW/m');
    const g = new TestWorld();
    g.igniteDisc(0, 0, 150, { intensity: 5000, flameHeight: 15 });
    expect(of(run(g).all, 'crown-fire')[0]?.severity).toBe('danger');
  });

  it('heavy-fuel: fire in FHS_s ≥ 3.5 fuel; watch when FH ≥ 10 m; refuge distance in the safety line', () => {
    const w = new TestWorld();
    w.fuel.surfaceHazard.fill(3.8);
    w.igniteDisc(0, 0, 150, { flameHeight: 12 });
    const h = of(run(w).all, 'heavy-fuel');
    expect(h[0]?.severity).toBe('watch');
    expect(h[0]!.safety).toContain('about 48 m');
  });

  it('recent-burn: head within 500 m of a 2-year-old burn', () => {
    const w = neutral();
    w.fuel.timeSinceFire.fill(NaN);
    w.forEach((k, x, y) => {
      if (x > 400 && x < 900 && Math.abs(y) < 300) {
        w.fuel.timeSinceFire[k] = 2;
        w.fuel.surfaceLoad[k] = 6;
      }
    });
    const r = of(run(w).all, 'recent-burn');
    expect(r[0]?.severity).toBe('info');
    expect(r[0]!.body).toContain('It burned 2 years ago');
  });

  it('fuel-break-breached: a break cell reached between cycles; spot across a non-fuel strip', () => {
    const w = neutral();
    w.fuel.breakWidth = new Float32Array(w.N);
    const brk = w.cells((_k, x, y) => Math.abs(x - 300) <= 15 && Math.abs(y) < 300);
    for (const k of brk) w.fuel.breakWidth[k] = 5;
    const { all } = run(w, 3, {}, (c) => {
      if (c === 1) {
        for (const k of brk) {
          w.view.fire.arrivalTime[k] = 100;
          w.view.fire.burnState[k] = BurnState.Burning;
          w.view.fire.intensity[k] = 3000;
        }
      }
    });
    const b = of(all, 'fuel-break-breached');
    expect(b[0]?.severity).toBe('watch');
    expect(b[0]!.body).toMatch(/A 5 m break at 3000 kW\/m has about a \d+ % chance/);

    const s = neutral();
    s.cells((_k, x) => Math.abs(x - 500) <= 20).forEach((k) => {
      s.fuel.type[k] = FuelType.NonFuel;
      s.view.fire.burnState[k] = BurnState.NonFlammable;
    });
    const r = run(s, 3, {}, (c) => c === 1 && s.view.spotFires.push({ id: 1, x: 800, y: 0, time: 100, distance: 650, travel: 650, sourceX: 150, sourceY: 0 }));
    expect(of(r.all, 'fuel-break-breached')[0]?.body).toContain('An ember flew across');
  });

  it('rolling-debris (P1): a burning item launched in the last 10 min that stopped below the front', () => {
    const w = new TestWorld({ elevation: (_x, y) => 600 + tan(28) * y });
    w.igniteDisc(0, 400, 150);
    w.view.aux.debris = [{ path: Float32Array.from([0, 300, 0, 200, 0, 50]), t: 30 }];
    const d = of(run(w).all, 'rolling-debris');
    expect(d[0]?.severity).toBe('watch');
    expect(d[0]!.body).toContain('rolling down this 28° slope');
  });
});

describe('weather and diurnal cards', () => {
  it('wind-change (+ exposed flank) and dead-man-zone (P1) with a DMZ layer', () => {
    const w = neutral({ windSpeed: 30 / 3.6, windDir: 315 });
    // Change at t0 + 45 min to 225° 40 km/h.
    const tc = w.startMs + 45 * 60e3;
    for (const h of w.view.series.hours) {
      if (h.time >= tc) {
        h.windDir10 = 225;
        h.windSpeed10 = 40 / 3.6;
      }
    }
    const { all, eng } = run(w, 3);
    const c = of(all, 'wind-change');
    expect(c[0]?.severity).toBe('danger');
    expect(c[0]!.key).toBe('wind-change:domain');
    expect(c[0]!.body).toMatch(/When the wind swings to the south-west at about .*, this \d\.\d km flank becomes the front/);
    const d = of(all, 'dead-man-zone');
    expect(d[0]?.severity).toBe('danger');
    expect(eng.layers().dmz).toBeInstanceOf(Float32Array);
    expect(Math.max(...eng.layers().dmz!)).toBeGreaterThan(0.5);
    // No change in the series → neither card.
    const n = neutral({ windSpeed: 30 / 3.6, windDir: 315 });
    const r = run(n, 3);
    expect(kinds(r.all)).not.toContain('wind-change');
    expect(kinds(r.all)).not.toContain('dead-man-zone');
  });

  it('V12: the wind-change card comes ≥ 60 min before the change with the exposed flank length within 20 %', () => {
    const r0 = 1000;
    const w = new TestWorld({ windSpeed: 30 / 3.6, windDir: 315 });
    w.igniteDisc(0, 0, r0);
    const tc = w.startMs + 150 * 60e3; // 2.5 h ahead
    for (const h of w.view.series.hours) {
      if (h.time >= tc) {
        h.windDir10 = 225;
        h.windSpeed10 = 40 / 3.6;
      }
    }
    const c = of(run(w, 2).all, 'wind-change')[0]!;
    expect(c).toBeDefined();
    expect(c.time).toBeLessThanOrEqual((tc - w.startMs) / 1000 - 3600);
    // Outward normals within 45° of the new windTo (45°): a quarter of the circle, (π/2)·r.
    const L = Number(c.factors.find((f) => f.label === 'Exposed flank')!.value.replace(/[^0-9.]/g, '')) * 1000;
    expect(Math.abs(L - (Math.PI / 2) * r0) / ((Math.PI / 2) * r0)).toBeLessThan(0.2);
    // Placed on that flank (north-east side).
    expect(c.x).toBeGreaterThan(0);
    expect(c.y).toBeGreaterThan(0);
  });

  it('pyroconvection-risk: danger for C-Haines 11 & FFDI ≥ 50, watch for C-Haines 9 & FFDI 30; nothing with synthetic upper air', () => {
    const mk = (ch: number, t: number, rh: number, kmh: number, src: 'model' | 'synthetic'): Insight[] => {
      const w = neutral({ temperature: t, rh, windSpeed: kmh / 3.6, droughtFactor: 10 });
      w.view.atmosDiag.upperAirSource = src;
      w.view.atmosDiag.cHaines = ch;
      return of(run(w).all, 'pyroconvection-risk');
    };
    expect(mk(11, 38, 10, 45, 'model')[0]?.severity).toBe('danger');
    expect(mk(9, 30, 25, 25, 'model')[0]?.severity).toBe('watch');
    expect(mk(11, 38, 10, 45, 'synthetic')).toEqual([]);
  });

  it('anabatic-wind: sunlit slope with ≥ 1 m/s upslope thermal wind by day near the fire', () => {
    const w = new TestWorld({ elevation: (_x, y) => 600 - tan(15) * y }); // north-facing, rising to the south
    w.setWind(0.5, 90);
    const [u, v] = windToUV(2.0, 0); // extra 2 m/s towards the south (upslope)
    w.view.windU.fill(u + w.view.windBgU[0]!);
    w.view.windV.fill(v + w.view.windBgV[0]!);
    w.view.surfaceHeatFlux.fill(300);
    w.igniteDisc(0, 0, 150);
    const a = of(run(w).all, 'anabatic-wind');
    expect(a[0]?.severity).toBe('info');
    expect(a[0]!.body).toContain('about 7 km/h');
    const n = new TestWorld({ elevation: (_x, y) => 600 - tan(15) * y });
    n.igniteDisc(0, 0, 150);
    expect(kinds(run(n).all)).not.toContain('anabatic-wind');
  });

  it('katabatic-wind: night gate ≥ 0.5 on slopes ≥ 5° near the fire; S17 wind flip near sunset', () => {
    const w = new TestWorld({ elevation: (_x, y) => 600 + tan(10) * y, startMs: Date.UTC(2025, 9, 15, 12, 0, 0) });
    w.setWind(1.5, 0); // drainage from the north, down the south-facing slope
    w.view.night.gate = 0.9;
    w.igniteDisc(0, 0, 150);
    const k = of(run(w).all, 'katabatic-wind');
    expect(k[0]?.severity).toBe('info');
    expect(k[0]!.body).toContain('Cool air now drains down the slope');
    // S17: 2 h before sunset (≈ 07:55 UTC on 15 Oct at Katoomba) the wind was upslope, at sunset downslope.
    const s = new TestWorld({ elevation: (_x, y) => 600 + tan(10) * y, startMs: Date.UTC(2025, 9, 15, 6, 0, 0) });
    s.setWind(2, 180);
    s.igniteDisc(0, 0, 150);
    const r = run(s, 125, {}, (c) => {
      if (c === 110) s.setWind(2, 0);
    });
    const f = of(r.all, 'katabatic-wind');
    expect(f.some((i) => i.body.includes('has turned about 180°'))).toBe(true);
  });

  it('thermal-belt: burning cells in the belt band at night with a ≥ 3 K cold pool; ridges-don\'t-sleep variant', () => {
    const w = new TestWorld({ elevation: (_x, y) => 400 + 0.2 * Math.max(0, y + 2000), startMs: Date.UTC(2025, 9, 15, 14, 0, 0) });
    w.view.night.dTheta = 4;
    w.view.night.hInv = 150;
    // Burn around hav ≈ 150 m: y = −2000 + 750 = −1250.
    w.igniteDisc(0, -1250, 150);
    const t = of(run(w).all, 'thermal-belt');
    expect(t[0]?.severity).toBe('info');
    expect(t[0]!.body).toContain('stays warmer and drier all night');
    const n = new TestWorld({ elevation: (_x, y) => 400 + 0.2 * Math.max(0, y + 2000), startMs: Date.UTC(2025, 9, 15, 14, 0, 0) });
    n.view.night.dTheta = 1;
    n.igniteDisc(0, -1250, 150);
    expect(kinds(run(n).all)).not.toContain('thermal-belt');
    // Ridge variant.
    const r = new TestWorld({ elevation: (_x, y) => 400 + 400 * Math.exp((-y * y) / (2 * 600 * 600)), startMs: Date.UTC(2025, 9, 15, 14, 0, 0) });
    r.view.night.dTheta = 4;
    r.setWind(20 / 3.6, 270);
    r.igniteDisc(0, 0, 150);
    expect(of(run(r).all, 'thermal-belt').some((i) => i.title === "Ridges don't sleep")).toBe(true);
  });

  it('inversion-break: about to break (watch), breaking now, smoke trapped at night (info), wet-ground note', () => {
    const w = neutral();
    const now = w.startMs + 60e3;
    Object.assign(w.view.night, { dTheta: 4, tSunrise: now - 3 * 3.6e6, tBreak: now + 30 * 60e3, dThetaAtSunrise: 5 });
    w.view.series.hours.forEach((h) => (h.precipitation = h.time > now - 12 * 3.6e6 && h.time <= now ? 0.5 : 0));
    const a = of(run(w).all, 'inversion-break');
    expect(a[0]?.severity).toBe('watch');
    expect(a[0]!.body).toContain('about to break');
    expect(a[0]!.body).toContain('later than usual');
    // Breaking now.
    const b = neutral();
    Object.assign(b.view.night, { dTheta: 4, tSunrise: b.startMs - 3 * 3.6e6, tBreak: b.startMs + 30 * 60e3 });
    const rb = run(b, 6, {}, (c) => {
      if (c >= 1) b.view.night.dTheta = 0.5;
    });
    expect(of(rb.all, 'inversion-break').length).toBeGreaterThan(0);
    // Smoke trapped at night.
    const s = new TestWorld({ startMs: Date.UTC(2025, 9, 15, 14, 0, 0) });
    s.igniteDisc(0, 0, 150);
    Object.assign(s.view.night, { dTheta: 4, hInv: 150 });
    const sm = of(run(s).all, 'inversion-break');
    expect(sm[0]?.severity).toBe('info');
    expect(sm[0]!.title).toBe('Smoke trapped in the valley');
  });

  it('aspect-dry-fuel: fire crossing onto a drier north-facing slope; S38 forces aligned → watch', () => {
    const w = new TestWorld({ elevation: (_x, y) => 400 + 300 * Math.exp((-y * y) / (2 * 600 * 600)) });
    w.forEach((k) => {
      const a = w.terrain.aspectDeg[k]!;
      w.view.moisture[k] = a < 60 || a > 300 ? 6 : 9.5;
    });
    w.igniteLine(-600, 450, 600, 450, 0, { ros: 0.05 });
    const d = of(run(w).all, 'aspect-dry-fuel');
    expect(d[0]?.severity).toBe('info');
    expect(d[0]!.body).toMatch(/north(-west|-east)?-facing slope faces the sun; its litter is about 3\.5 points drier/);
    // S38 at 15:00 LMST: wind, slope and sun all with the head on a NW-facing... use a north-facing slope rising south.
    const s = new TestWorld({ elevation: (_x, y) => 600 - tan(20) * y, startMs: Date.UTC(2025, 9, 15, 4, 0, 0) });
    s.setWind(25 / 3.6, 0);
    s.igniteLine(-600, 400, 600, 400, 180, { ros: 0.1 });
    // Drier ahead than behind.
    s.forEach((k, _x, y) => (s.view.moisture[k] = y < 400 ? 6 : 9));
    const f = of(run(s).all, 'aspect-dry-fuel');
    expect(f.some((i) => i.title === 'Forces aligned' && i.severity === 'watch')).toBe(true);
  });

  it('moist-gully: wet gully near the fire (info); drought variant (watch)', () => {
    const mk = (kbdi: number, fa: number): Insight[] => {
      const w = neutral({ kbdi });
      w.forEach((k, x) => {
        if (x > 250 && x < 400) {
          w.fuel.type[k] = FuelType.WetForest;
          w.features.drainage[k] = 1;
          w.view.moisture[k] = 16;
          w.view.availability[k] = fa;
        }
      });
      return of(run(w).all, 'moist-gully');
    };
    const m = mk(50, 0.3);
    expect(m[0]?.severity).toBe('info');
    expect(m[0]!.body).toContain('16 %');
    const d = mk(170, 0.95);
    expect(d[0]?.severity).toBe('watch');
    expect(d[0]!.title).toBe('The gullies have dried out');
  });

  it('high-drought: DF ≥ 9 once per local day', () => {
    const w = neutral({ droughtFactor: 9.5, kbdi: 120 });
    const h = of(run(w, 5).all, 'high-drought');
    expect(h.length).toBe(1);
    expect(h[0]!.severity).toBe('watch');
    expect(h[0]!.body).toContain('Drought factor 9.5');
  });

  it('night-slowdown: head ROS ≤ 50 % of the day maximum with M up ≥ 3 points since sunset', () => {
    const w = neutral();
    const { all } = run(w, 5, {}, (c) => {
      const v = w.view;
      if (c === 0) {
        v.sunElevation = 20;
        v.fire.ros.fill(0.2);
        v.night.tSunrise = w.startMs - 5 * 3.6e6;
      } else {
        v.sunElevation = -5;
        v.fire.ros.fill(0.05);
        v.moisture.fill(c === 1 ? 10 : 14);
      }
    });
    const n = of(all, 'night-slowdown');
    expect(n[0]?.severity).toBe('info');
    expect(n[0]!.body).toContain('litter 14 %');
  });

  it('afternoon-peak near the forecast hour of minimum M_A (once per day); S13 hot-dry-windy variant', () => {
    // 15 Oct, 14:00 LMST ≈ 03:59 UTC; the series' temperature peaks at 14:00.
    const start = Date.UTC(2025, 9, 15, 3, 55, 0);
    const w = neutral({ startMs: start });
    for (const h of w.view.series.hours) {
      const l = ((h.time / 3.6e6 + 150.3 / 15) % 24 + 24) % 24;
      h.temperature = 20 + 10 * Math.cos(((l - 14) / 24) * 2 * Math.PI);
      h.relativeHumidity = 50 - 20 * Math.cos(((l - 14) / 24) * 2 * Math.PI);
    }
    const a = of(run(w, 5).all, 'afternoon-peak');
    expect(a.length).toBe(1);
    expect(a[0]!.body).toContain('Litter is driest and the air hottest');
    const s = neutral({ temperature: 36, rh: 12, windSpeed: 40 / 3.6, windDir: 300 });
    const b = of(run(s).all, 'afternoon-peak');
    expect(b[0]?.severity).toBe('watch');
    expect(b[0]!.title).toBe('Hot, dry and windy');
  });
});

describe('general notes', () => {
  it('steep: ≥ 10 % of the front on slopes over 20°', () => {
    const w = new TestWorld({ elevation: (_x, y) => 600 + tan(25) * y });
    w.igniteDisc(0, 0, 200);
    expect(of(run(w).all, 'general').some((i) => i.key === 'general:steep:domain')).toBe(true);
  });
  it('embers-exit: > 5 % of burning embers leave the map', () => {
    const w = neutral();
    w.view.emberStats.beyondEdgeHistogram[2] = 10;
    w.view.emberStats.landings10min = 50;
    const g = of(run(w).all, 'general').find((i) => i.key === 'general:embers-exit:domain');
    expect(g?.body).toContain('up to about 3 km');
  });
  it('wind-driven: head wind ≥ 20 km/h and N_c ≤ 2', () => {
    const w = neutral({ windSpeed: 25 / 3.6 });
    expect(of(run(w).all, 'general').some((i) => i.key === 'general:wind-driven:domain')).toBe(true);
  });
  it('light-wind: head U10 < 5 km/h on vesta2 cells for ≥ 10 min (persistence 10)', () => {
    const w = neutral({ windSpeed: 3 / 3.6 });
    expect(of(run(w, 9).all, 'general').some((i) => i.key === 'general:light-wind:domain')).toBe(false);
    expect(of(run(w, 11).all, 'general').some((i) => i.key === 'general:light-wind:domain')).toBe(true);
  });
  it('narrow-gully: burning drainage cell narrower than 2Δx_a on ≥ 25°', () => {
    const w = new TestWorld({ elevation: (x, y) => 600 + tan(10) * y + 120 * (1 - Math.exp((-x * x) / (2 * 60 * 60))) });
    const axis = w.cells((_k, x, y) => Math.abs(x) <= 1 && Math.abs(y) < 600);
    for (const k of axis) {
      w.features.drainage[k] = 1;
      w.features.gullyAxis[k] = 0;
    }
    // Side walls are steep; make the axis cells report ≥ 25° slope too (as a 10 m DEM would).
    for (const k of axis) w.terrain.slopeDeg[k] = 30;
    w.igniteDisc(0, 0, 100);
    const g = of(run(w).all, 'general').find((i) => i.key === 'general:narrow-gully:domain');
    expect(g?.confidence).toBe('sub-grid');
  });
  it('mountain-wave (P1): cross-ridge wind with Fr_h in [0.6, 1.2] and steeper lee slopes', () => {
    // Asymmetric E–W ridge: gentle south (windward) side, steep north (lee) side; wind from the south.
    const w = new TestWorld({ elevation: (_x, y) => 400 + 350 * Math.exp((-y * y) / (2 * (y < 0 ? 900 : 350) ** 2)) });
    w.setWind(12 / 3.6, 180);
    w.view.atmosDiag.frH = 0.9;
    w.view.atmosDiag.upperAirSource = 'model';
    w.igniteDisc(0, -1500, 120);
    const g = of(run(w).all, 'general').find((i) => i.key === 'general:mountain-wave:domain');
    expect(g?.title).toBe('Strong gusts possible on lee slopes');
    const n = new TestWorld({ elevation: (_x, y) => 400 + 350 * Math.exp((-y * y) / (2 * (y < 0 ? 900 : 350) ** 2)) });
    n.setWind(12 / 3.6, 180);
    n.igniteDisc(0, -1500, 120);
    expect(of(run(n).all, 'general').some((i) => i.key === 'general:mountain-wave:domain')).toBe(false);
  });
  it('foehn (P1): 850 hPa north-westerly ≥ 15 m/s at a lee-of-divide site (Katoomba)', () => {
    const w = neutral();
    w.view.weather.pressureLevels = [
      { hPa: 850, height: 1500, temperature: 20, relativeHumidity: 20, windSpeed: 20, windDir: 290 },
      { hPa: 700, height: 3100, temperature: 6, relativeHumidity: 20, windSpeed: 25, windDir: 285 },
    ];
    expect(of(run(w).all, 'general').some((i) => i.key === 'general:foehn:domain')).toBe(true);
  });
});

describe('coverage', () => {
  it('every InsightKind (and every general sub-note) fired in a crafted situation above', () => {
    expect(INSIGHT_KINDS.length).toBe(34);
    const missing = INSIGHT_KINDS.filter((k) => k !== 'general' && !FIRED.has(k));
    expect(missing).toEqual([]);
    const subs = GENERAL_SUBS.filter((sub) => !FIRED.has(`general:${sub}:domain`));
    expect(subs).toEqual([]);
  });
  it('every rule is registered with its spec priority, persistence and cool-down', () => {
    for (const k of INSIGHT_KINDS) {
      const r = INSIGHT_RULES[k];
      expect(r.kind).toBe(k);
      expect(r.cooldown).toBeGreaterThan(0);
      expect(r.persistence).toBeGreaterThanOrEqual(1);
    }
    const p1: InsightKind[] = ['vorticity-lateral-spread', 'ridge-speed-up', 'dead-man-zone', 'fire-induced-wind', 'rolling-debris'];
    for (const k of INSIGHT_KINDS) expect(INSIGHT_RULES[k].priority).toBe(p1.includes(k) ? 'P1' : 'P0');
    expect(INSIGHT_RULES['plume-dominated'].persistence).toBe(5);
    expect(INSIGHT_RULES['fire-induced-wind'].persistence).toBe(5);
    expect(INSIGHT_RULES['spot-fire'].cooldown).toBe(600);
    expect(INSIGHT_RULES['upslope-run'].persistence).toBe(2);
    expect(INSIGHT_RULES['upslope-run'].cooldown).toBe(900);
  });
  it('insights carry the doctrine line and a key', () => {
    const w = new TestWorld({ elevation: (_x, y) => 600 + tan(25) * y });
    w.igniteLine(-600, -500, 600, -500, 0, { ros: 0.1 });
    for (const i of run(w).all) {
      expect(i.safety!.endsWith(DOCTRINE)).toBe(true);
      expect(i.key).toBeTruthy();
      expect(i.factors.length).toBeGreaterThan(0);
    }
  });
});

