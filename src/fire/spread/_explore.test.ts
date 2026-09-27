import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { cellAt } from '../../core/grid';
import { FuelType } from '../../core/types';
import { HEAT_YIELD_KJ_PER_KG } from '../../core/physics';
import { makeScenario, runScenario, syntheticTerrain, uniformFuel } from './testing';
const L: string[] = [];
const DEG = Math.PI / 180;
it('orientation', () => {
  for (const from of [270, 225, 247.5]) {
    const terrain = syntheticTerrain(2400, 30, () => 500);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 25, windFromDeg: from, moisturePct: 8, droughtFactor: 10 });
    const to = (from + 180) % 360;
    const ux = Math.sin(to * DEG), uy = Math.cos(to * DEG);
    s.model.ignite({ id: 'p', kind: 'point', points: [[-700 * ux, -700 * uy]], time: 0, origin: 'observed' });
    let heatInt = 0;
    runScenario(s, 5400, { dtA: 12, onStep: () => { const h = s.model.heatRelease(); let q = 0; for (let k = 0; k < h.length; k++) q += h[k]!; heatInt += q * 12; } });
    const g = terrain.grid;
    // head distance along the wind axis at T
    const T = 5400; let dmax = 0; let area = 0; let wsum = 0;
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i; if (!(s.model.field.arrivalTime[k]! <= T)) continue;
      area++; wsum += s.model.fuelConsumed(k);
      const x = g.x0 + i * 30 + 700 * ux, y = g.y0 + j * 30 + 700 * uy;
      dmax = Math.max(dmax, x * ux + y * uy);
    }
    const expHeat = HEAT_YIELD_KJ_PER_KG * wsum / 10;
    L.push(`from ${from}: head dist ${dmax.toFixed(0)} m, area ${(area * 900 / 1e4).toFixed(1)} ha, heat ratio ${(heatInt / expHeat).toFixed(4)}`);
  }
  writeFileSync('/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/explore.txt', L.join('\n'));
});
