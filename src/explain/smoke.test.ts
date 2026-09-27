import { describe, it, expect } from 'vitest';
import { InsightEngine } from './engine';
import { TestWorld } from './testing/simState';

describe('smoke', () => {
  it('neutral runs', () => {
    const w = new TestWorld();
    w.igniteDisc(0, 0, 150);
    const eng = new InsightEngine(w.terrain, w.derived, w.fuel, w.features, { startTime: w.startMs });
    const out = [];
    for (let c = 0; c < 5; c++) {
      w.setTime(c * 60);
      out.push(...eng.update(w.view));
    }
    console.log(out.map((i) => `${i.kind} ${i.severity} ${i.key}`));
    console.log('ms', eng.lastUpdateMs);
    expect(out.length).toBeGreaterThanOrEqual(0);
  });
});
