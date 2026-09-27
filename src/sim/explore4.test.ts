import { it } from 'vitest';
import { demoScenario, withIgnitions, pointIgnition } from './testing/scenarios';
import { Simulation } from './simulation';
import { SIM_PARAMS } from './params';
it('night', async () => {
  const tier = (process.env.TIER as 'fast') ?? 'fast';
  const H = Number(process.env.HOURS ?? 8);
  const base = await demoScenario({ preset: 'calm-night-katabatic', startCivil: [2025, 3, 15, Number(process.env.START ?? 20)], duration: H * 3600 });
  const s = withIgnitions(base, [pointIgnition('a', -2600, 900, 0, 60)]);
  const t0 = performance.now();
  const kinds = new Map<string, number>();
  const sim = new Simulation(s, { tier, hooks: { snapshot: (sn) => { sn.insights.forEach(i => kinds.set(i.kind + '@' + (i.time/3600).toFixed(1), 1)); if (sn.time % 3600 !== 0) return; const st = sn.stats; process.stderr.write(`t=${sn.time/3600}h area=${st.burntAreaHa.toFixed(1)} head=${(st.headRos*3600).toFixed(0)} m/h I=${st.maxIntensity.toFixed(0)} M=${st.deadFuelMoistureMean.toFixed(1)} U=${(st.weather.windSpeed10*3.6).toFixed(1)} T=${st.weather.temperature.toFixed(1)} ${st.fireDangerRating} ins=${sn.insights.map(i=>i.kind).join(',')}\n`); } } });
  process.stderr.write(`start ${new Date(s.startTime).toISOString()} night ${JSON.stringify((sim as any).night)}\n`);
  sim.advance(H * 3600);
  process.stderr.write(`wall ${(performance.now()-t0).toFixed(0)} ms kinds ${[...kinds.keys()].join(' ')} forecast ${sim.forecastInsights.map(i=>i.kind).join(',')}\n`);
  // katabatic check
  const v = sim.stateView(); const t = s.terrain; const n = t.elevation.length;
  let nSlope = 0, nDown = 0, spd = 0, nValley = 0, valleyFast = 0, vsum = 0;
  for (let k = 0; k < n; k++) {
    const u = v.windBgU[k]!, w = v.windBgV[k]!; const sp = Math.hypot(u, w);
    if (t.slopeDeg[k]! > 10 && Number.isFinite(t.aspectDeg[k]!)) {
      nSlope++; const ax = Math.sin(t.aspectDeg[k]! * Math.PI / 180), ay = Math.cos(t.aspectDeg[k]! * Math.PI / 180);
      const c = sp > 0 ? (u * ax + w * ay) / sp : 0; if (c > 0.5 && sp >= 0.5 && sp <= 3) nDown++; spd += sp;
    }
    if (v.derived.heightAboveValley[k]! < 20 && t.slopeDeg[k]! < 5) { nValley++; vsum += sp; if (sp >= 2) valleyFast++; }
  }
  process.stderr.write(`slopes>10°: ${nSlope}, downslope 0.5-3 m/s: ${(100*nDown/nSlope).toFixed(1)}%, mean speed ${(spd/nSlope).toFixed(2)}; valley cells ${nValley} mean ${(vsum/Math.max(1,nValley)).toFixed(2)} m/s, ≥2 m/s: ${valleyFast}\n`);
  process.stderr.write(`night ${JSON.stringify((sim as any).night)} perf ${JSON.stringify(sim.perf().modules, (k,x)=>typeof x==='number'?Math.round(x):x)}\n`);
}, 900000);
