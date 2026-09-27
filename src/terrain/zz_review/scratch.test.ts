import { it } from 'vitest';
import { buildTerrain, reliefStats, windShelter } from '../analysis';
import { insolation, castShadows, skyViewFactor } from '../solar';
import { loadDemoDem } from '../testing/demoDem';
import { Landform } from '../../core/types';
import { multiHillshade } from '../hillshade';
it('res', () => {
  for (const cs of [10, 20, 30, 60, 90]) {
    const { grid, elevation } = loadDemoDem('katoomba', { lat: -33.715, lon: 150.285 }, 6000, cs);
    let t0 = performance.now();
    const t = buildTerrain(grid, elevation, 'k');
    const tb = performance.now() - t0;
    t0 = performance.now(); skyViewFactor(t); const tsvf = performance.now() - t0;
    t0 = performance.now(); castShadows(t, 40, 20); const tsh = performance.now() - t0;
    t0 = performance.now(); insolation(t, Date.parse('2025-06-21T03:00:00Z')); const tin = performance.now() - t0;
    t0 = performance.now(); windShelter(t, 300, 300); const tws = performance.now() - t0;
    t0 = performance.now(); reliefStats(t); const trs = performance.now() - t0;
    t0 = performance.now(); multiHillshade(t); const ths = performance.now() - t0;
    const r = reliefStats(t);
    console.log(cs, grid.nx, `build ${tb.toFixed(0)} svf ${tsvf.toFixed(0)} shadow ${tsh.toFixed(1)} insol ${tin.toFixed(1)} ws ${tws.toFixed(0)} rs ${trs.toFixed(0)} hs ${ths.toFixed(0)}`);
    console.log('   ', r.landformFractions.map((f, i) => `${Landform[i]}:${(f * 100).toFixed(1)}`).join(' '), 'maxSlope', r.maxSlopeDeg.toFixed(0));
  }
});
