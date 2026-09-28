import { it } from 'vitest';
import { Landform } from '../../core/types';
import { demoScenario } from '../testing/scenarios';
import { log, runSim } from './harness';

const mean = (x: number[]): number => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
it('diag V8', async () => {
  const s = await demoScenario({ preset: 'mild-spring-hr', startCivil: [2025, 10, 15, 15], duration: 3600 });
  const r = runSim({ ...s, options: { ...s.options, embers: false } }, { tier: 'fast', until: 600, every: 600 });
  const sim = r.sim as any;
  const mo = sim.moisture;
  const c = mo.cells;
  const t = s.terrain;
  const groups: Record<string, number[]> = { gully: [], nnw: [] };
  for (let k = 0; k < t.elevation.length; k++) {
    const a = t.aspectDeg[k]!;
    if (t.landform[k] === Landform.Gully && a >= 135 && a <= 225) groups.gully!.push(k);
    if (t.slopeDeg[k]! > 10 && (a >= 292.5 || a <= 22.5)) groups.nnw!.push(k);
  }
  for (const [name, ks] of Object.entries(groups)) {
    const f = (fn: (k: number) => number) => mean(ks.map(fn)).toFixed(2);
    const fams: Record<string, number> = {};
    for (const k of ks) { const fm = mo.familyAt(k); fams[fm] = (fams[fm] ?? 0) + 1; }
    log([name, ks.length, 'M', f((k) => mo.field[k]), 'MA', f((k) => mo.afdrs[k]), 'A', f((k) => mo.anomaly[k]), 'gully', f((k) => c.gully[k]),
      'mLag', f((k) => c.mLag[k]), 'Tf', f((k) => mo.fuelTemp[k]), 'Ta', f((k) => mo.airT[k]), 'RH', f((k) => mo.airRH[k]), 'cover', f((k) => c.cover[k]), 'lai', f((k) => c.lai[k]),
      'cRef', f((k) => c.cRef[k]), 'u10', f((k) => sim.u10[k]), 'uF', f((k) => sim.u10[k] * c.uFac[k]), 'wrf', f((k) => c.wrf[k]), 'slope', f((k) => t.slopeDeg[k]!), 'z', f((k) => t.elevation[k]!),
      'offset', f((k) => c.offset[k]), 'rMem/dew', f((k) => { const b = mo.breakdown(k); return b.rainMemory + b.dew; }), 'lag', f((k) => mo.breakdown(k).lag), JSON.stringify(fams)].join(' '));
  }
}, 300000);
