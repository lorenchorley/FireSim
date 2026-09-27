import { describe, expect, it } from 'vitest';
import { cellAt, sampleBilinear } from '../core/grid';
import { Landform, type Terrain } from '../core/types';
import { angleDiffDeg, DEG, RAD } from '../core/units';
import { buildTerrain, terrainDerived } from './analysis';
import {
  airMass,
  castShadows,
  clearSkyGhiHaurwitz,
  clearSkyIrradiance,
  cloudAttenuation,
  dailyInsolation,
  erbsDecomposition,
  insolation,
  skyViewFactor,
  solarPosition,
  sunTimes,
} from './solar';
import { ewGorge, ewRidge, mesa, plane, randomHills, testGrid } from './testing/synthetic';
import { demoAvailable, loadDemoDem } from './testing/demoDem';

const SYDNEY = { lat: -33.8688, lon: 151.2093 };
const MIN = 60000;
const build = (g: ReturnType<typeof testGrid>, z: Float32Array): Terrain => buildTerrain(g, z, 'synthetic');

/**
 * Independent reference: Astronomical Almanac low-precision solar coordinates (right ascension + Greenwich mean
 * sidereal time, ≈ 0.01° for 1950–2050) — a different formulation from NOAA's equation-of-time approach.
 */
function almanac(timeMs: number, lat: number, lon: number): { el: number; az: number } {
  const n = timeMs / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const decl = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  const ha = (gmst + lon) * DEG - ra;
  const phi = lat * DEG;
  const cz = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const az = Math.atan2(-Math.sin(ha) * Math.cos(decl), Math.sin(decl) * Math.cos(phi) - Math.cos(decl) * Math.cos(ha) * Math.sin(phi)) * RAD;
  return { el: 90 - Math.acos(cz) * RAD, az: (az + 360) % 360 };
}

describe('solarPosition (NOAA)', () => {
  it('Sydney, summer solstice 2025: 12:00 AEDT sun high in the north-east, noon elevation 79.6° due north', () => {
    const p = solarPosition(Date.parse('2025-12-21T01:00:00Z'), SYDNEY.lat, SYDNEY.lon);
    // Solar noon in Sydney is ≈ 12:53 AEDT, so at 12:00 the sun is ≈ 13° of hour angle east of the meridian.
    expect(p.elevation).toBeGreaterThan(74);
    expect(p.elevation).toBeLessThan(80);
    expect(p.azimuth).toBeGreaterThan(0);
    expect(p.azimuth).toBeLessThan(90); // northern (north-east) half of the sky
    expect(p.declination).toBeCloseTo(-23.44, 1);
    const st = sunTimes(Date.parse('2025-12-21T01:00:00Z'), SYDNEY.lat, SYDNEY.lon);
    const noon = solarPosition(st.solarNoon, SYDNEY.lat, SYDNEY.lon);
    expect(noon.elevation).toBeCloseTo(90 - (33.8688 - 23.437) + 0.003, 1); // 79.57° (+ tiny refraction)
    expect(Math.abs(angleDiffDeg(noon.azimuth, 0))).toBeLessThan(0.5);
    expect(st.noonElevation).toBeCloseTo(noon.elevation, 6);
  });

  it('Sydney, winter solstice 2025: noon elevation ≈ 32.7°, sun due north', () => {
    const st = sunTimes(Date.parse('2025-06-21T02:00:00Z'), SYDNEY.lat, SYDNEY.lon);
    const p = solarPosition(st.solarNoon, SYDNEY.lat, SYDNEY.lon);
    expect(p.elevation).toBeGreaterThan(32.4);
    expect(p.elevation).toBeLessThan(33.1);
    expect(Math.abs(angleDiffDeg(p.azimuth, 0))).toBeLessThan(0.5);
    expect(p.declination).toBeCloseTo(23.44, 1);
  });

  it('morning sun is in the east, afternoon sun in the west, night is below the horizon', () => {
    const am = solarPosition(Date.parse('2025-03-20T21:00:00Z'), SYDNEY.lat, SYDNEY.lon); // 08:00 AEDT
    const pm = solarPosition(Date.parse('2025-03-20T06:00:00Z'), SYDNEY.lat, SYDNEY.lon); // 17:00 AEDT
    const night = solarPosition(Date.parse('2025-03-20T14:00:00Z'), SYDNEY.lat, SYDNEY.lon); // 01:00 AEDT
    expect(am.azimuth).toBeGreaterThan(60);
    expect(am.azimuth).toBeLessThan(120);
    expect(pm.azimuth).toBeGreaterThan(240);
    expect(pm.azimuth).toBeLessThan(300);
    expect(night.elevation).toBeLessThan(-30);
  });

  it('equation of time and declination extremes', () => {
    expect(solarPosition(Date.parse('2025-11-03T00:00:00Z'), 0, 0).equationOfTime).toBeCloseTo(16.45, 0);
    expect(solarPosition(Date.parse('2025-02-11T12:00:00Z'), 0, 0).equationOfTime).toBeCloseTo(-14.2, 0);
    expect(Math.abs(solarPosition(Date.parse('2025-03-20T09:01:00Z'), 0, 0).declination)).toBeLessThan(0.02); // March equinox 09:01 UTC
  });

  it('agrees with the Astronomical Almanac algorithm to within 0.05°', () => {
    let s = 12345;
    const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let n = 0; n < 300; n++) {
      const t = Date.UTC(2020, 0, 1) + rnd() * 10 * 365 * 86400000;
      const lat = -38 + rnd() * 10;
      const lon = 141 + rnd() * 13;
      const a = solarPosition(t, lat, lon);
      const b = almanac(t, lat, lon);
      expect(Math.abs(a.trueElevation - b.el)).toBeLessThan(0.05);
      if (b.el < 85) expect(Math.abs(angleDiffDeg(a.azimuth, b.az))).toBeLessThan(0.1 / Math.cos(b.el * DEG));
    }
  });
});

describe('sunTimes', () => {
  // Published values (Geoscience Australia / timeanddate) for Sydney.
  it('Sydney 21 Dec 2025: sunrise 05:41, solar noon 12:53, sunset 20:05 AEDT (±3 min)', () => {
    const st = sunTimes(Date.parse('2025-12-21T01:00:00Z'), SYDNEY.lat, SYDNEY.lon);
    expect(Math.abs(st.sunrise - Date.parse('2025-12-20T18:41:00Z'))).toBeLessThan(3 * MIN);
    expect(Math.abs(st.solarNoon - Date.parse('2025-12-21T01:53:00Z'))).toBeLessThan(2 * MIN);
    expect(Math.abs(st.sunset - Date.parse('2025-12-21T09:05:00Z'))).toBeLessThan(3 * MIN);
    expect(st.dayLengthHours).toBeCloseTo(14.4, 1);
  });

  it('Sydney 21 Jun 2025: sunrise 07:00, sunset 16:54 AEST (±3 min)', () => {
    const st = sunTimes(Date.parse('2025-06-21T02:00:00Z'), SYDNEY.lat, SYDNEY.lon);
    expect(Math.abs(st.sunrise - Date.parse('2025-06-20T21:00:00Z'))).toBeLessThan(3 * MIN);
    expect(Math.abs(st.sunset - Date.parse('2025-06-21T06:54:00Z'))).toBeLessThan(3 * MIN);
    expect(st.dayLengthHours).toBeCloseTo(9.9, 1);
  });

  it('sun elevation at the returned sunrise is ≈ −0.833° geometric (upper limb on the horizon)', () => {
    const st = sunTimes(Date.parse('2025-09-01T02:00:00Z'), -36.5, 148.3);
    expect(solarPosition(st.sunrise, -36.5, 148.3).trueElevation).toBeCloseTo(-0.833, 1);
    expect(solarPosition(st.sunset, -36.5, 148.3).trueElevation).toBeCloseTo(-0.833, 1);
  });

  it('polar day and night', () => {
    expect(sunTimes(Date.parse('2025-06-21T12:00:00Z'), 80, 0).dayLengthHours).toBe(24);
    expect(sunTimes(Date.parse('2025-06-21T12:00:00Z'), -80, 0).dayLengthHours).toBe(0);
  });
});

describe('irradiance models', () => {
  it('clear sky: plausible magnitudes, monotonic in elevation, more at altitude and in clean air', () => {
    const hi = clearSkyIrradiance(90, 0, 3);
    expect(hi.ghi).toBeGreaterThan(1000);
    expect(hi.ghi).toBeLessThan(1120);
    expect(hi.dni).toBeGreaterThan(850);
    expect(hi.dni).toBeLessThan(1000);
    expect(hi.dhi).toBeGreaterThan(60);
    let prev = Infinity;
    for (const el of [80, 60, 40, 20, 10, 5, 2]) {
      const c = clearSkyIrradiance(el, 800, 3);
      expect(c.ghi).toBeLessThan(prev);
      prev = c.ghi;
      expect(c.dni * Math.sin(el * DEG) + c.dhi).toBeCloseTo(c.ghi, 6);
      expect(c.dhi).toBeGreaterThanOrEqual(0);
    }
    expect(clearSkyIrradiance(30, 1500).ghi).toBeGreaterThan(clearSkyIrradiance(30, 0).ghi);
    expect(clearSkyIrradiance(30, 0, 2).dni).toBeGreaterThan(clearSkyIrradiance(30, 0, 6).dni);
    expect(clearSkyIrradiance(-1).ghi).toBe(0);
    // Haurwitz within ~10 % of Ineichen at high sun.
    expect(Math.abs(clearSkyGhiHaurwitz(60) / clearSkyIrradiance(60).ghi - 1)).toBeLessThan(0.1);
  });

  it('air mass: 1 at zenith, ≈ 2 at 30°, ≈ 38 at the horizon', () => {
    expect(airMass(90)).toBeCloseTo(1, 3);
    expect(airMass(30)).toBeCloseTo(2, 1);
    expect(airMass(0.001)).toBeGreaterThan(35);
    expect(airMass(-1)).toBe(Infinity);
  });

  it('Erbs decomposition conserves GHI and is mostly diffuse under overcast', () => {
    const clear = erbsDecomposition(900, 60);
    expect(clear.dhi / clear.ghi).toBeLessThan(0.25);
    expect(clear.dni * Math.sin(60 * DEG) + clear.dhi).toBeCloseTo(900, 6);
    const overcast = erbsDecomposition(150, 60);
    expect(overcast.dhi / overcast.ghi).toBeGreaterThan(0.95);
    expect(erbsDecomposition(100, -2).dni).toBe(0);
  });

  it('cloud attenuation (Kasten & Czeplak)', () => {
    expect(cloudAttenuation(0)).toBe(1);
    expect(cloudAttenuation(100)).toBeCloseTo(0.25, 6);
    expect(cloudAttenuation(50)).toBeGreaterThan(0.9);
  });
});

describe('sky-view factor', () => {
  it('flat open ground ≈ 1; an unobstructed plane ≈ (1 + cos S)/2', () => {
    const g = testGrid(3000, 30);
    expect(skyViewFactor(build(g, plane(g, 0, 0)))[cellAt(g, 0, 0)]).toBeCloseTo(1, 3);
    for (const S of [10, 25, 40]) {
      const t = build(g, plane(g, Math.tan(S * DEG) * 0.6, Math.tan(S * DEG) * 0.8));
      const v = skyViewFactor(t)[cellAt(g, 0, 0)]!;
      expect(Math.abs(v - (1 + Math.cos(S * DEG)) / 2)).toBeLessThan(0.02);
    }
  });

  it('a deep gorge floor sees much less sky than the plateau', () => {
    const g = testGrid(4000, 20);
    const t = build(g, ewGorge(g, 400, 150));
    const v = skyViewFactor(t);
    // Analytic: the walls subtend tan h = 1.203 across the gorge (h = 50.3°) and 0 along it, so for a level floor
    // V = mean over φ of cos²h(φ) = 1/√(1 + 1.203²) = 0.639.
    expect(v[cellAt(g, 0, 0)]).toBeCloseTo(0.639, 1);
    expect(Math.abs(v[cellAt(g, 0, 0)]! - 0.639)).toBeLessThan(0.03);
    expect(v[cellAt(g, 0, 1800)]).toBeGreaterThan(0.97);
    expect(skyViewFactor(t)).toBe(v); // cached
  });
});

describe('cast shadows', () => {
  it('a 100 m mesa casts a shadow of length H / tan(e) away from the sun', () => {
    const g = testGrid(3000, 10);
    const t = build(g, mesa(g, 300, 100));
    const e = 20;
    const L = 100 / Math.tan(e * DEG); // 275 m
    for (const az of [0, 30, 135, 250]) {
      const sh = castShadows(t, az, e);
      const ax = Math.sin((az + 180) * DEG);
      const ay = Math.cos((az + 180) * DEG);
      // Distance from the centre to the block edge along the anti-sun ray.
      const edge = 150 / Math.max(Math.abs(ax), Math.abs(ay));
      const at = (d: number): number => sh[cellAt(g, ax * (edge + d), ay * (edge + d))]!;
      expect(at(20)).toBe(1);
      expect(at(L - 40)).toBe(1);
      expect(at(L + 40)).toBe(0);
      // Nothing is shadowed on the sunward side.
      expect(sh[cellAt(g, -ax * (edge + 50), -ay * (edge + 50))]).toBe(0);
    }
  });

  it('matches brute-force ray marching on random hills', () => {
    const g = testGrid(4000, 40);
    const t = build(g, randomHills(g, 11, 40, 300));
    for (const [az, el] of [
      [20, 12],
      [95, 25],
      [300, 8],
      [200, 35],
    ] as const) {
      const sh = castShadows(t, az, el);
      const ux = Math.sin(az * DEG);
      const uy = Math.cos(az * DEG);
      const tanE = Math.tan(el * DEG);
      let agree = 0;
      let total = 0;
      for (let j = 0; j < g.ny; j += 2) {
        for (let i = 0; i < g.nx; i += 2) {
          const x = g.x0 + i * g.cellSize;
          const y = g.y0 + j * g.cellSize;
          const z0 = t.elevation[j * g.nx + i]!;
          let shadow = 0;
          for (let d = g.cellSize / 2; ; d += g.cellSize / 4) {
            const px = x + ux * d;
            const py = y + uy * d;
            if (px < g.x0 || py < g.y0 || px > -g.x0 || py > -g.y0) break;
            if (sampleBilinear(g, t.elevation, px, py) > z0 + d * tanE) {
              shadow = 1;
              break;
            }
          }
          total++;
          if ((sh[j * g.nx + i]! >= 0.5 ? 1 : 0) === shadow) agree++;
        }
      }
      expect(agree / total).toBeGreaterThan(0.97);
    }
  });

  it('no cast shadows on a uniform plane, even on steep side-slopes at low sun', () => {
    // Without the sub-cell line correction the half-cell zig-zag of digital lines shades stripes of such slopes.
    const g = testGrid(3000, 30);
    const t = build(g, plane(g, Math.tan(35 * DEG), 0)); // rises to the east, faces west
    for (const az of [10, 170, 200, 350, 290]) {
      // Along these azimuths the plane rises towards the sun more gently than the 10° sun ray (tan 35°·sin 10° = 0.12 < 0.18).
      const sh = castShadows(t, az, 10);
      expect(Math.max(...sh)).toBe(0);
    }
    // …but when the slope rises towards the sun faster than the sun ray, the whole plane is (correctly) in shade.
    expect(Math.min(...castShadows(t, 80, 10).subarray(g.nx * 5, g.nx * 6 - 5))).toBe(1);
  });

  it('caches per sun position', () => {
    const g = testGrid(2000, 20);
    const t = build(g, randomHills(g, 2));
    expect(castShadows(t, 123.456, 21.2)).toBe(castShadows(t, 123.456, 21.2));
    expect(castShadows(t, 10, -3).every((v) => v === 1)).toBe(true);
  });
});

describe('insolation', () => {
  const winterNoon = Date.parse('2025-06-21T02:00:00Z'); // ≈ 12:00 AEST
  it('flat open ground receives the GHI', () => {
    const g = testGrid(2000, 20);
    const t = build(g, plane(g, 0, 0));
    const r = insolation(t, winterNoon);
    const k = cellAt(g, 0, 0);
    expect(r.total[k]).toBeCloseTo(r.ghi, 0);
    expect(r.shaded[k]).toBe(0);
    expect(r.sunElevation).toBeGreaterThan(32);
    expect(r.ghi).toBeGreaterThan(400);
    expect(r.ghi).toBeLessThan(700);
    // Measured GHI overrides the clear-sky model; cloud reduces it.
    expect(insolation(t, winterNoon, { ghi: 300 }).total[k]).toBeCloseTo(300, 0);
    expect(insolation(t, winterNoon, { cloudCover: 100 }).ghi).toBeLessThan(0.3 * r.ghi);
  });

  it('southern hemisphere winter: north-facing slopes get far more sun than south-facing ones', () => {
    const g = testGrid(6000, 30);
    const t = build(g, ewRidge(g, 300, 500)); // north flank faces north (aspect 0), south flank faces south
    const north = cellAt(g, 0, 500);
    const south = cellAt(g, 0, -500);
    expect(Math.abs(angleDiffDeg(t.aspectDeg[north]!, 0))).toBeLessThan(1);
    expect(Math.abs(angleDiffDeg(t.aspectDeg[south]!, 180))).toBeLessThan(1);
    const noon = insolation(t, winterNoon);
    expect(noon.total[north]!).toBeGreaterThan(1.5 * noon.total[south]!);
    const winter = dailyInsolation(t, winterNoon);
    const summer = dailyInsolation(t, Date.parse('2025-12-21T02:00:00Z'));
    const winterRatio = winter.energy[north]! / winter.energy[south]!;
    const summerRatio = summer.energy[north]! / summer.energy[south]!;
    expect(winterRatio).toBeGreaterThan(2);
    // In mid-summer at 34° S the noon sun is 10° from the zenith and rises / sets in the south-east / south-west,
    // so 20° north- and south-facing slopes receive about the same daily energy.
    expect(summerRatio).toBeLessThan(winterRatio / 1.5);
    expect(summerRatio).toBeGreaterThan(0.85);
    expect(summerRatio).toBeLessThan(1.25);
    // Winter daily energy on the north face is a few MJ/m² more than flat ground; the south face far less.
    const flatWinter = winter.energy[cellAt(g, 0, 2900)]!;
    expect(winter.energy[north]!).toBeGreaterThan(flatWinter);
    expect(winter.energy[south]!).toBeLessThan(0.6 * flatWinter);
    expect(flatWinter).toBeGreaterThan(8); // ≈ 10–12 MJ/m² clear-sky mid-winter at 34° S
    expect(flatWinter).toBeLessThan(15);
    expect(winter.sunHours[north]!).toBeGreaterThan(winter.sunHours[south]!);
  });

  it('a deep gorge floor is shaded at low sun while the plateau is lit', () => {
    const g = testGrid(4000, 20);
    const t = build(g, ewGorge(g, 400, 150));
    const floor = cellAt(g, 0, 0);
    const plateau = cellAt(g, 0, 1800);
    // Winter noon: sun due north at 32.7° — the north wall (≈ 53° to its rim from the floor) blocks it.
    const r = insolation(t, winterNoon);
    expect(r.shaded[floor]).toBe(1);
    expect(r.direct[floor]).toBe(0);
    expect(r.shaded[plateau]).toBe(0);
    expect(r.total[floor]!).toBeLessThan(0.35 * r.total[plateau]!);
    // Summer noon: sun at ≈ 80° reaches the floor.
    const s = insolation(t, Date.parse('2025-12-21T02:00:00Z'));
    expect(s.shaded[floor]).toBe(0);
    expect(s.direct[floor]).toBeGreaterThan(500);
  });

  it('slopes facing away from a low sun are self-shaded', () => {
    const g = testGrid(2000, 20);
    const t = build(g, plane(g, 0, -Math.tan(40 * DEG))); // faces north... rises south
    const r = insolation(t, winterNoon); // sun from the north at 32.7°: faces the sun
    expect(r.shaded[cellAt(g, 0, 0)]).toBe(0);
    const t2 = build(g, plane(g, 0, Math.tan(40 * DEG))); // faces south, steeper than the sun elevation
    const r2 = insolation(t2, winterNoon);
    expect(r2.shaded[cellAt(g, 0, 0)]).toBe(1);
    expect(r2.direct[cellAt(g, 0, 0)]).toBe(0);
    expect(r2.total[cellAt(g, 0, 0)]).toBeGreaterThan(0); // still diffuse light
  });

  it('night: nothing', () => {
    const g = testGrid(2000, 20);
    const r = insolation(build(g, randomHills(g)), Date.parse('2025-06-21T14:00:00Z'));
    expect(r.sunElevation).toBeLessThan(0);
    expect(r.total.every((v) => v === 0)).toBe(true);
    expect(r.shaded.every((v) => v === 1)).toBe(true);
  });

  it('200×200 grid: first call (incl. sky-view factor) < 150 ms, repeat calls much faster', () => {
    const g = testGrid(6000, 30);
    const t = build(g, randomHills(g, 5, 60, 300));
    // Warm up the JIT on a different terrain object so the timed call still computes SVF and shadows.
    insolation(build(g, randomHills(g, 6)), winterNoon);
    const t0 = performance.now();
    insolation(t, winterNoon);
    const first = performance.now() - t0;
    expect(first).toBeLessThan(150);
    const t1 = performance.now();
    for (let h = 0; h < 10; h++) insolation(t, winterNoon + h * 1200000);
    expect((performance.now() - t1) / 10).toBeLessThan(40);
  });
});

describe.skipIf(!demoAvailable('grose'))('real terrain: Grose Valley in winter', () => {
  it('valley floors and gullies are shaded more and receive less energy than ridges', () => {
    const { grid, elevation } = loadDemoDem('grose', { lat: -33.62, lon: 150.33 }, 6000, 30);
    const t = buildTerrain(grid, elevation, 'demo');
    const r = insolation(t, Date.parse('2025-06-21T23:30:00Z')); // 09:30 AEST, low morning sun
    const day = dailyInsolation(t, Date.parse('2025-06-21T02:00:00Z'), { stepMinutes: 60 });
    const d = terrainDerived(t);
    const stat = (pred: (k: number) => boolean): { shaded: number; energy: number } => {
      let s = 0;
      let e = 0;
      let c = 0;
      for (let k = 0; k < t.landform.length; k++) {
        if (!pred(k)) continue;
        s += r.shaded[k]!;
        e += day.energy[k]!;
        c++;
      }
      return { shaded: s / c, energy: e / c };
    };
    const low = stat((k) => (t.landform[k] === Landform.ValleyFloor || t.landform[k] === Landform.Gully) && d.relPos[k]! < 0.25);
    const ridge = stat((k) => t.landform[k] === Landform.Ridge || t.landform[k] === Landform.Peak);
    expect(low.shaded).toBeGreaterThan(ridge.shaded);
    expect(low.energy).toBeLessThan(ridge.energy);
    // Aspect: north-facing slopes collect more winter energy than south-facing ones.
    const facing = (a0: number) => stat((k) => t.slopeDeg[k]! > 10 && Math.abs(angleDiffDeg(t.aspectDeg[k]!, a0)) < 45);
    expect(facing(0).energy).toBeGreaterThan(1.3 * facing(180).energy);
  });
});
