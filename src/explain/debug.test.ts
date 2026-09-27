import { it } from 'vitest';
import { InsightEngine } from './engine';
import { TestWorld } from './testing/simState';
import { standaloneContext } from './context';
import { INSIGHT_RULES } from './registry';
it('debug', () => {
  const w = new TestWorld({ elevation: (_x, y) => 400 + 300 * Math.exp((-y * y) / (2 * 500 * 500)) });
  w.setWind(20 / 3.6, 180);
  w.igniteLine(-500, -140, 500, -140, 0, { ros: 0.05 });
  const ctx = standaloneContext(w.view);
  const k = ctx.front[5]!;
  const r = ctx.statics.ridgeNearest[k]!;
  console.log('nFront', ctx.nFront, 'd', ctx.statics.ridgeDist[k], 'r y', w.y(r), 'bg', ctx.bgSpeed(r), 'to', ctx.bgTo(r), 'cn', ctx.statics.crestNormal(r, ctx.bgTo(r)));
  console.log(INSIGHT_RULES['ridge-crest'].detect(w.view, ctx));
  void InsightEngine;
});
