import { it } from 'vitest';
import { Rng } from '../core/rng';
import { EmberModel, type EmberLandingEvent } from './EmberModel';
import { burningAt, constTurb, emptyAux, flatTerrain, grid, planarFire, planarLanding, powerLawWind, uniformFuel, weightedQuantile } from './testing';

function run(u10kmh: number, rosMh: number, intensity: number, fh: number, tier: 'fast' | 'standard', flags?: number, zp?: number, plumeW?: number) {
  const g = grid(20000, 30);
  const terrain = flatTerrain(g);
  const fuel = uniformFuel(g, flags !== undefined ? { flags } : {});
  const front = { x0: -8000, y0: 0, dirDeg: 90, ros: rosMh / 3600, intensity, flameHeight: fh, halfLength: 1000 };
  const fire = planarFire(g, front);
  const aux = emptyAux(g.nx * g.ny);
  let now = 0;
  const events: EmberLandingEvent[] = [];
  const m = new EmberModel(terrain, fuel, { maxEmbers: 4000, tier, onLanding: (e) => events.push(e) }, new Rng(7));
  const u10 = u10kmh / 3.6;
  const base = powerLawWind(u10, 270);
  if (zp) m.setEnvironment({ plumeTopAGL: zp });
  const wind = plumeW ? (x: number, y: number, z: number, out: Float32Array) => {
    base(x, y, z, out);
    const xf = front.x0 + front.ros * now + (out[0]! / plumeW) * z;
    const d = Math.abs(x - xf);
    out[2] = d < 300 && Math.abs(y) < 1100 && z < 2500 ? plumeW * (1 - d / 300) * (1 - z / 2500) : 0;
  } : base;
  const turb = constTurb(1500, 2, 0.8);
  const landing = planarLanding(g, fire, front, () => now, { moisture: 5, fuelTempC: 35 });
  let spots = 0;
  const dt = 10;
  const T = 3600;
  const t0 = performance.now();
  for (let t = 0; t < T; t += dt) {
    now = t;
    m.emit(fire, fuel, burningAt(fire, t, dt, 200), dt, t, aux);
    now = t + dt;
    m.step(dt, wind, turb, landing, () => spots++);
  }
  const ms = performance.now() - t0;
  const cap = events.filter((e) => e.p >= 0.05);
  const q = (arr: EmberLandingEvent[], qq: number) => weightedQuantile(arr.map((e) => e.travel), arr.map((e) => e.weight), qq);
  const st = m.stats();
  const byClass: Record<string, string> = {};
  for (const c of ['flake', 'ribbon', 'leaf', 'twig', 'heavy']) {
    const a = cap.filter((e) => e.emberClass === c);
    if (a.length) byClass[c] = `n${a.length} P50 ${q(a, 0.5).toFixed(0)} P95 ${q(a, 0.95).toFixed(0)} P99 ${q(a, 0.99).toFixed(0)}`;
  }
  console.log(`U10 ${u10kmh} ROS ${rosMh} I ${intensity} ${tier}: landings ${events.length} capable ${cap.length} P50 ${q(cap, 0.5).toFixed(0)} P95 ${q(cap, 0.95).toFixed(0)} P99 ${q(cap, 0.99).toFixed(0)} spots ${spots} (per km/h ${(spots / 2).toFixed(1)}) zp ${st.plumeTopAGL.toFixed(0)} active ${st.active} W ${st.classWeights.map((w) => w.toExponential(1))} ms ${ms.toFixed(0)}`);
  console.log(byClass);
}

it('explore', () => {
  // FFDI 25 / 50 / 100 (W 15 Mk5): R = 0.0012·FFDI·15 km/h, I = 0.5167·15·R(m/h)
  run(37.1, 1290, 10000, 16, 'fast');
  run(50, 4000, 40000, 30, 'fast', 4, 4000);
  run(50, 4000, 40000, 30, 'fast', 4 | 8, 4000);
  run(37.1, 900, 0.5167 * 15 * 900, 13.3, 'standard');
  run(37.1, 900, 0.5167 * 15 * 900, 13.3, 'standard', 4, undefined, 12);
}, 600000);
