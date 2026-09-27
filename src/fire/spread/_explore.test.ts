import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { cellAt } from '../../core/grid';
import { FuelType, SpreadDriver } from '../../core/types';
import { makeScenario, runScenario, syntheticTerrain, uniformFuel } from './testing';
const L: string[] = [];
const DEG = Math.PI / 180;
it('vls spec activation', () => {
  const H = 250;
  const ridge = (x: number): number => 400 + Math.max(0, x < 0 ? H + x * Math.tan(15 * DEG) : H - x * Math.tan(28 * DEG));
  for (const [recentS, contact] of [[0, false], [0, true], [1800, false], [1800, true]] as const) {
    const terrain = syntheticTerrain(2400, 30, ridge);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), {
      windKmh: 40, windFromDeg: 270, moisturePct: 6, droughtFactor: 10, mountainPhenomena: true, uRidge: 'crest',
    }, {}, { vls: { recentS, activateOnContact: contact } });
    s.model.ignite({ id: 'l', kind: 'line', points: [[-800, -300], [-800, 300]], time: 0, origin: 'observed' });
    let everActive = 0; let firstAct = -1;
    runScenario(s, 3600, { dtA: 12, leeBlend: true, onStep: (t) => { let a = 0; const va = s.model.aux().vlsActive; for (let k = 0; k < va.length; k++) a += va[k]!; if (a > 0 && firstAct < 0) firstAct = t; everActive = Math.max(everActive, a); } });
    const f = s.model.field; let lv = 0; let lee = 0;
    const g = terrain.grid;
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const x = g.x0 + i * 30; const k = j * g.nx + i; if (x > 0 && x < 160 && f.arrivalTime[k]! < Infinity) { lee++; if (f.driver[k] === SpreadDriver.LateralVorticity) lv++; } }
    // crest crossing time
    const tc = f.arrivalTime[cellAt(g, 0, 0)]!;
    L.push(`recentS ${recentS} contact ${contact}: max active cells ${everActive}, first active t ${firstAct}, crest crossed ${tc.toFixed(0)}, lee burnt ${lee}, LV ${lv}`);
  }
  writeFileSync('/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/explore.txt', L.join('\n'));
});
