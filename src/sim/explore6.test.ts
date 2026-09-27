import { it } from 'vitest';
import { demoScenario } from './testing/scenarios';
import { weatherAt } from '../scenario/weather';
import { stableNightInputAt, rainBefore, hoursSinceSunrise, seriesWeatherAt } from '../fuel/moisture';
import { solarPosition } from '../terrain';
it('bench', async () => {
  const s = await demoScenario({ startCivil: [2025, 12, 20, 13] });
  const se = s.weather; const t0 = s.startTime;
  const N = 2000;
  const bench = (name: string, f: (t: number) => unknown) => { const a = performance.now(); for (let i = 0; i < N; i++) f(t0 + i * 10000); process.stderr.write(`${name}: ${((performance.now() - a) / N * 1000).toFixed(1)} µs\n`); };
  bench('weatherAt', (t) => weatherAt(se, t));
  bench('seriesWeatherAt', (t) => seriesWeatherAt(se, t));
  bench('solarPosition', (t) => solarPosition(t, -33.7, 150.3));
  bench('hoursSinceSunrise', (t) => hoursSinceSunrise(t, -33.7, 150.3));
  bench('rainBefore', (t) => rainBefore(se, t, 24));
  bench('stableNightInputAt', (t) => stableNightInputAt(se, t, 0));
}, 60000);
