/**
 * Mountain hooks (spec §9.4, P1): lee eddy on separated lee slopes, VLS crest-height launch, ridgeDrop and the source
 * location class in the provenance; §9.7 "lee-eddy ridge (25° lee slope, 10 m/s): lee-slope landing fraction > no-eddy
 * run".
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { GridSpec } from '../core/grid';
import type { Terrain } from '../core/types';
import { EmberModel, type EmberLandingEvent, type EmberModelOptions } from './EmberModel';
import { burningAt, constTurb, emptyAux, grid, planarFire, planarLanding, terrainFrom, uniformFuel, uniformWind, type PlanarFront } from './testing';

const H = 300; // ridge height (m)
const LEE = H / Math.tan((25 * Math.PI) / 180); // 643 m lee slope (east of the crest)
const WINDWARD = H / Math.tan((15 * Math.PI) / 180); // 1120 m windward slope (west of the crest)

/** N–S ridge with its crest at x = 0: 15° windward (west) slope, 25° lee (east) slope, 500 m valley floors. */
const ridgeZ = (x: number): number => (x < -WINDWARD || x > LEE ? 500 : x <= 0 ? 500 + H * (1 + x / WINDWARD) : 500 + H * (1 - x / LEE));

interface RidgeRun {
  events: EmberLandingEvent[];
  model: EmberModel;
  g: GridSpec;
  terrain: Terrain;
}

function ridgeRun(o: { mountain: boolean; front: PlanarFront; seconds: number; vls?: boolean; loft?: EmberModelOptions['loft'] }): RidgeRun {
  const g = grid(8000, 30);
  const terrain = terrainFrom(g, (x) => ridgeZ(x));
  const fuel = uniformFuel(g);
  const fire = planarFire(g, o.front);
  const n = g.nx * g.ny;
  const aux = emptyAux(n);
  const sep = new Float32Array(n);
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const x = g.x0 + i * g.cellSize;
      if (x > 30 && x < LEE - 30) sep[j * g.nx + i] = 1;
    }
  if (o.vls) aux.vlsActive.set(sep.map((s) => (s > 0 ? 1 : 0)));
  const events: EmberLandingEvent[] = [];
  const model = new EmberModel(terrain, fuel, { maxEmbers: 3000, tier: 'fast', loft: o.loft, onLanding: (e) => events.push(e) }, new Rng(11));
  model.setEnvironment({ sep, uRidge: new Float32Array(n).fill(10), relief: new Float32Array(n).fill(H), mountainPhenomena: o.mountain, airDensity: 1.1 });
  const wind = uniformWind(10, 0); // 10 m/s from the west (the resolved flow knows nothing of the eddy)
  const turb = constTurb(1200, 1, 0.6);
  let now = 0;
  const landing = planarLanding(g, fire, o.front, () => now, { moisture: 5 });
  for (let t = 0; t < o.seconds; t += 10) {
    now = t;
    model.emit(fire, fuel, burningAt(fire, t, 10, 200), 10, t, aux);
    now = t + 10;
    model.step(10, wind, turb, landing, () => undefined);
  }
  return { events, model, g, terrain };
}

/** Windward-slope fire approaching the crest (x from −900 m to ≈ −120 m in 30 min). */
const windwardFront: PlanarFront = { x0: -900, y0: 0, dirDeg: 90, ros: 0.43, intensity: 10000, flameHeight: 15, halfLength: 1000 };

describe('lee eddy (§9.4)', () => {
  const on = ridgeRun({ mountain: true, front: windwardFront, seconds: 1800 });
  const off = ridgeRun({ mountain: false, front: windwardFront, seconds: 1800 });
  const leeFraction = (r: RidgeRun): number => {
    let lee = 0;
    let all = 0;
    for (const e of r.events) {
      if (e.x > 0 && e.x < LEE) lee += e.weight;
      all += e.weight;
    }
    return lee / all;
  };

  it('25° lee slope, 10 m/s: lee-slope landing fraction exceeds the no-eddy run', () => {
    const fOn = leeFraction(on);
    const fOff = leeFraction(off);
    // (measured: 11 % with the eddy, 0.5 % without: the 10 m/s flow carries brands over the 643 m slope)
    expect(fOff).toBeGreaterThan(0.001);
    expect(fOn).toBeGreaterThan(2 * fOff);
    // brands caught in the eddy are flagged; none without mountain hooks
    expect(on.events.some((e) => e.leeEddy && e.x > 0 && e.x < LEE)).toBe(true);
    expect(off.events.some((e) => e.leeEddy)).toBe(false);
  });

  it('eddy landings on the lee slope drift back upslope (towards the crest) relative to the no-eddy run', () => {
    const meanLeeX = (r: RidgeRun): number => {
      let sx = 0;
      let sw = 0;
      for (const e of r.events)
        if (e.x > 0 && e.x < LEE) {
          sx += e.x * e.weight;
          sw += e.weight;
        }
      return sx / sw;
    };
    expect(meanLeeX(on)).toBeLessThan(meanLeeX(off));
  });

  it('provenance: windward sources, ridgeDrop = z_launch − z_land (valley landings below the launch)', () => {
    const src = on.events.filter((e) => e.sourceCell >= 0);
    expect(src.every((e) => e.sourceClass === 'windward' || e.sourceClass === 'ridge')).toBe(true);
    expect(src.filter((e) => e.sourceClass === 'windward').length).toBeGreaterThan(0.5 * src.length);
    const valley = on.events.filter((e) => e.x > LEE + 100);
    expect(valley.length).toBeGreaterThan(0);
    for (const e of valley) {
      const sx = on.g.x0 + (e.sourceCell % on.g.nx) * on.g.cellSize;
      // launch ≥ source ground; landing at 500 m
      expect(e.ridgeDrop).toBeGreaterThanOrEqual(ridgeZ(sx) - 500 - 25);
    }
  });
});

describe('VLS injection: launch at crest height (§9.2, §9.4)', () => {
  it('E1–E4 from active VLS cells on the lee slope start at the upwind crest height; E5 does not', () => {
    // a fire burning on the lee slope (x 150 → 450 m), VLS active there, no loft (launch heights only)
    const front: PlanarFront = { x0: 150, y0: 0, dirDeg: 90, ros: 0.5, intensity: 8000, flameHeight: 12, halfLength: 800 };
    const r = ridgeRun({ mountain: true, front, seconds: 600, vls: true, loft: 'none' });
    const byClass = (c: string): EmberLandingEvent[] => r.events.filter((e) => e.emberClass === c);
    for (const c of ['flake', 'twig']) {
      const ev = byClass(c);
      expect(ev.length).toBeGreaterThan(10);
      for (const e of ev) {
        const sx = r.g.x0 + (e.sourceCell % r.g.nx) * r.g.cellSize;
        // crest (800 m) above the source ground: launch AGL ≈ 800 − z(source) (> 100 m on this slope)
        expect(e.maxHeightAGL).toBeGreaterThan(0.8 * (500 + H - ridgeZ(sx)));
      }
    }
    for (const e of byClass('heavy')) expect(e.maxHeightAGL).toBeLessThan(5);
    // lee-slope sources are classed leeward (aspect east, wind to the east)
    expect(r.events.filter((e) => e.sourceClass === 'leeward').length).toBeGreaterThan(0.8 * r.events.length);
  });
});
