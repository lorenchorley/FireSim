import { it } from 'vitest';
import { demoScenario, withIgnitions, pointIgnition, cellOf } from './testing/scenarios';
import { Simulation } from './simulation';
it('gospers', async () => {
  const base = await demoScenario({ site: 'gospers', replay: 'gospers-2019-12-19', duration: 3 * 3600 });
  const t = base.terrain; const g = t.grid;
  process.stderr.write(`start ${new Date(base.startTime).toISOString()} dur ${base.duration} kbdi ${base.weather.kbdi} df ${base.weather.droughtFactor} upper ${base.weather.upperAirSource} warnings ${JSON.stringify(base.weather.warnings)}\n`);
  // find a burnable cell near the centre-west
  let ign: [number, number] = [-2000, 0];
  for (let r = 0; r < 60; r++) { const k = cellOf(t, -2000 + r * 30, 0); if (base.fuel.type[k]! >= 2 && base.fuel.type[k] !== 7) { ign = [-2000 + r * 30, 0]; break; } }
  const s = withIgnitions(base, [pointIgnition('g', ign[0], ign[1], 0, 60)]);
  const kinds = new Set<string>();
  const t0 = performance.now();
  const sim = new Simulation(s, { tier: 'fast', hooks: { snapshot: (sn) => { sn.insights.forEach(i => kinds.add(i.kind)); if (sn.time % 1800 === 0) { const st = sn.stats; process.stderr.write(`t=${sn.time/3600}h area=${st.burntAreaHa.toFixed(0)} head=${(st.headRos*3.6).toFixed(1)}km/h dir=${st.headDir.toFixed(0)} I=${(st.maxIntensity/1000).toFixed(0)}MW/m spots=${st.spotFires} M=${st.deadFuelMoistureMean.toFixed(1)} ffdi=${st.ffdi.toFixed(0)} ${st.fireDangerRating} T=${st.weather.temperature.toFixed(0)} RH=${st.weather.relativeHumidity.toFixed(0)} wind=${(st.weather.windSpeed10*3.6).toFixed(0)}@${st.weather.windDir10.toFixed(0)}\n`); } } } });
  process.stderr.write(`ign ${ign} fuel ${s.fuel.type[cellOf(t, ign[0], ign[1])]} forecast ${sim.forecastInsights.map(i=>i.kind).join(',')}\n`);
  sim.advance(3 * 3600);
  process.stderr.write(`wall ${((performance.now()-t0)/1000).toFixed(1)} s kinds ${[...kinds].join(',')}\n`);
}, 900000);
