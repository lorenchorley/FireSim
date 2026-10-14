/**
 * Picture quality, the view's side: what Auto guesses from the phone (cores and memory, with the boundaries and the missing
 * values), and what a tier sets and how it was chosen (`QualityInfo`, which the statistics screen shows). The tiers' numbers
 * are the table of plan section 9c.2; the UI keeps tree sway off by default on 'low' (layersPrefs.ts), and so does the fact here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layerDefaults } from '../ui/screens/sim/layersPrefs';
import { deviceFacts, guessQuality as guessFromModule } from './qualityGuess';
import { describeQuality, guessQuality, type RenderQuality } from './SceneView';
import { CANOPY_BUDGETS } from './vegetationLayer';

describe('guessQuality (what Auto picks from the phone)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is exported by SceneView.ts and is the same function the Settings screen reads', () => {
    expect(guessQuality).toBe(guessFromModule);
  });

  it('High needs 8 or more cores and 6 GB or more, both', () => {
    expect(guessQuality({ hardwareConcurrency: 8, deviceMemory: 6 })).toBe('high');
    expect(guessQuality({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe('high');
    expect(guessQuality({ hardwareConcurrency: 12, deviceMemory: 8 })).toBe('high');
    expect(guessQuality({ hardwareConcurrency: 7, deviceMemory: 8 })).toBe('medium');
    expect(guessQuality({ hardwareConcurrency: 8, deviceMemory: 4 })).toBe('medium');
    expect(guessQuality({ hardwareConcurrency: 8, deviceMemory: 5.9 })).toBe('medium');
  });

  it('Low is 4 or fewer cores, or 3 GB or less, either', () => {
    expect(guessQuality({ hardwareConcurrency: 4, deviceMemory: 3 })).toBe('low');
    expect(guessQuality({ hardwareConcurrency: 4, deviceMemory: 8 })).toBe('low');
    expect(guessQuality({ hardwareConcurrency: 8, deviceMemory: 3 })).toBe('low');
    expect(guessQuality({ hardwareConcurrency: 2, deviceMemory: 2 })).toBe('low');
    expect(guessQuality({ hardwareConcurrency: 5, deviceMemory: 4 })).toBe('medium');
    expect(guessQuality({ hardwareConcurrency: 6, deviceMemory: 4 })).toBe('medium');
    expect(guessQuality({ hardwareConcurrency: 6, deviceMemory: 3.5 })).toBe('medium');
  });

  it('a missing value counts as 4 cores and 4 GB, which gives Low', () => {
    expect(guessQuality({})).toBe('low');
    expect(guessQuality({ hardwareConcurrency: 8 })).toBe('medium'); // 4 GB: not Low by memory, not High
    expect(guessQuality({ hardwareConcurrency: 6 })).toBe('medium');
    expect(guessQuality({ deviceMemory: 8 })).toBe('low'); // 4 cores
    expect(guessQuality({ hardwareConcurrency: Number.NaN, deviceMemory: 8 })).toBe('low');
  });

  it("reads the page's own navigator when none is given", () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 8 });
    expect(guessQuality()).toBe('high');
    expect(deviceFacts()).toEqual({ cores: 8, memoryGb: 8 });
    vi.stubGlobal('navigator', { hardwareConcurrency: 6, deviceMemory: 4 });
    expect(guessQuality()).toBe('medium');
    vi.stubGlobal('navigator', undefined);
    expect(guessQuality()).toBe('low');
    expect(deviceFacts()).toEqual({ cores: null, memoryGb: null });
  });
});

describe('deviceFacts', () => {
  it('passes the numbers on and says null for what the browser does not report', () => {
    expect(deviceFacts({ hardwareConcurrency: 4, deviceMemory: 3 })).toEqual({ cores: 4, memoryGb: 3 });
    expect(deviceFacts({})).toEqual({ cores: null, memoryGb: null });
    expect(deviceFacts({ hardwareConcurrency: 0, deviceMemory: -1 })).toEqual({ cores: null, memoryGb: null });
    expect(deviceFacts({ deviceMemory: 0.5 })).toEqual({ cores: null, memoryGb: 0.5 });
  });
});

describe('describeQuality (QualityInfo)', () => {
  const phone = { cores: 4, memoryGb: 3 };

  it('sets, per tier, the values of the plan table (9c.2)', () => {
    const rows: Record<RenderQuality, { terrainSamples: number; treeBudget: number; canopyTriangles: number; pixelRatioCap: number; flameSites: number; smokePuffs: number; treeSwayDefault: boolean }> = {
      low: { terrainSamples: 224, treeBudget: 16000, canopyTriangles: 100000, pixelRatioCap: 1.25, flameSites: 2500, smokePuffs: 800, treeSwayDefault: false },
      medium: { terrainSamples: 320, treeBudget: 32000, canopyTriangles: 170000, pixelRatioCap: 1.75, flameSites: 5000, smokePuffs: 1500, treeSwayDefault: true },
      high: { terrainSamples: 400, treeBudget: 48000, canopyTriangles: 250000, pixelRatioCap: 2, flameSites: 5000, smokePuffs: 1500, treeSwayDefault: true },
    };
    for (const tier of ['low', 'medium', 'high'] as const) {
      expect(describeQuality({ quality: tier }, phone, 'medium')).toMatchObject({ tier, ...rows[tier] });
      expect(describeQuality({ quality: tier }, phone, 'medium').canopyTriangles).toBe(CANOPY_BUDGETS[tier].triangles);
    }
  });

  it('an option wins over the guess and says so; without one the guess is the tier', () => {
    const set = describeQuality({ quality: 'high' }, phone, 'low');
    expect(set).toMatchObject({ tier: 'high', source: 'option', guess: 'low', cores: 4, memoryGb: 3 });
    const guessed = describeQuality({}, phone, 'low');
    expect(guessed).toMatchObject({ tier: 'low', source: 'guess', guess: 'low', cores: 4, memoryGb: 3 });
    expect(describeQuality({}, { cores: null, memoryGb: null }, 'low')).toMatchObject({ tier: 'low', source: 'guess', cores: null, memoryGb: null });
  });

  it('shows the overrides that are in force (tests and screenshots only), not the table', () => {
    const i = describeQuality({ quality: 'high', meshResolution: 128, vegetationBudget: 1000, maxDpr: 1 }, phone, 'low');
    expect(i).toMatchObject({ tier: 'high', terrainSamples: 128, treeBudget: 1000, pixelRatioCap: 1 });
  });

  it('tree sway defaults off on Low exactly where the Layers defaults turn it off', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const info = describeQuality({ quality: tier }, phone, tier);
      expect(layerDefaults({ performance: 'auto', renderQuality: tier, hasImagery: false }).windSway, tier).toBe(info.treeSwayDefault);
    }
  });
});
