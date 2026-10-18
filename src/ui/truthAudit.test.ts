/**
 * Truth audit of what the Data sets screen and the model card SAY (reviewer 3): the static statements that a record or a card
 * makes about the data and the model are checked against the code or the data they describe, so they cannot drift again.
 *   - an empirical rate is never called physics the model computes;
 *   - the fuel-hazard scales quoted next to the numbers are the scales of the fuel module;
 *   - no user-visible text calls the NSW elevation model LiDAR (the service says "derived from stereo imagery");
 *   - the README does not describe the terrain as LiDAR;
 *   - the wind arrows and flow lines: the first Wind height chip is "10 m", nothing calls it "Ground", and no text says the arrows wear the
 *     Wind speed map's colours (they wear the Wind streaks' ramp: the two are different ramps, 0 to 90 km/h and 0 to 60 km/h).
 * (The terrain record's 30 m / interpolated wording is checked against a real build in scenario/datasets.test.ts.)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HAZARD_CLASS_BOUNDS, legendFor, windGlyphLegend } from '../render/legends';
import { ratingFromFhs } from '../fuel/hazard';
import { LAYER_CATALOG } from '../render/layerCatalog';
import { GLOSSARY, HELP_STEPS } from './content';
import { CONFIDENCE_LABELS } from './screens/sim/insightCard';
import { WIND_HEIGHT_CHIPS } from './screens/sim/glyphWords';

const root = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

describe('wording that must not claim more than the model does', () => {
  it('the "Physics" badge of an insight card does not say the model computes it directly: spread rates are fitted formulas', () => {
    const p = CONFIDENCE_LABELS.physics;
    expect(p.label).not.toMatch(/^physics$/i);
    expect(p.about).not.toMatch(/computes? (it )?directly/i);
    expect(p.about).toMatch(/fitted formulas or estimates/);
  });

  it('the fuel-hazard scales quoted by the data-set statistics are the fuel module’s scales', () => {
    const stats = read('src/scenario/datasetStats.ts');
    // Litter, near-surface and shrub: 1 low, 2 moderate, 3 high, 3.5 very high, 4 extreme; bark: 0 low ... 4 extreme.
    expect([1, 2, 3, 3.5, 4].map((v) => ratingFromFhs('surface', v))).toEqual(['Low', 'Moderate', 'High', 'Very High', 'Extreme']);
    expect([0, 1, 2, 3, 4].map((v) => ratingFromFhs('bark', v))).toEqual(['Low', 'Moderate', 'High', 'Very High', 'Extreme']);
    expect(stats).toContain('1 low, 2 moderate, 3 high, 3.5 very high, 4 extreme');
    expect(stats).toContain('Bark has its own scale: 0 low, 1 moderate, 2 high, 3 very high, 4 extreme');
    expect(stats).not.toContain('1 low, 2 moderate, 3 high, 4 very high');
    // The legend's class bounds are the nearest-rating bounds of the same scores.
    expect(HAZARD_CLASS_BOUNDS.fuel).toEqual([0, 0.5, 1.5, 2.5, 3.25, 3.75]);
  });

  it('the peak FFDI is the highest hourly value, not the value at the hottest, driest and windiest hour', () => {
    const stats = read('src/scenario/datasetStats.ts');
    expect(stats).not.toContain('hottest, driest, windiest hour');
    expect(stats).toContain('in the hour of the run when it was highest');
  });

  it('no layer, record or card text calls the NSW 5 m elevation model LiDAR', () => {
    for (const l of LAYER_CATALOG) for (const t of [l.what, l.why, l.source(), l.resolution()]) expect(t, l.id).not.toMatch(/LiDAR/);
    for (const f of ['src/ui/modelInfo.ts', 'src/scenario/datasetRecords.ts', 'src/scenario/datasetRecordsPlaces.ts']) {
      const lines = read(f).split('\n').filter((l) => /LiDAR/i.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
      for (const l of lines) expect(l, `${f}: ${l.trim()}`).toMatch(/not LiDAR|airborne LiDAR|info\.lidar|origin === 'lidar'|hi\.origin|lidar:/i);
    }
    const readme = read('README.md');
    expect(readme).not.toMatch(/10 m LiDAR model/);
  });

  it('the wind arrows and flow lines: the first Wind height chip is "10 m" and is not called Ground; their colours are the Wind streaks\' ramp and no text says they are the Wind speed map\'s', () => {
    expect(WIND_HEIGHT_CHIPS[0]).toEqual({ value: 'fire', label: '10 m' });
    for (const t of [...GLOSSARY.map((g) => `${g.term}\n${g.body}`), ...HELP_STEPS.map((x) => x.text)]) if (/Wind height|Arrows and flow lines/.test(t)) expect(t).not.toMatch(/\bGround\b/);
    // Two ramps: the arrows' (the streaks' pale-to-violet, to 90 km/h) and the Wind speed map's (cool to warm, to 60 km/h).
    const arrows = windGlyphLegend('near the ground').entries.map((e) => e.colour);
    const map = legendFor('windSpeed')?.entries.map((e) => e.colour) ?? [];
    expect(arrows).not.toEqual(map);
    for (const f of ['README.md', 'docs/ARCHITECTURE.md', 'docs/DESIGN.md']) expect(read(f), f).not.toMatch(/colours? of the Wind speed map|same colours? as the Wind speed map|same ramp as the Wind speed map/i);
  });
});
