/**
 * What a run with a finer Desktop detail asks of the page (0.9.0, D35), from its scenario: the history budget it is given (no growth on a phone's page,
 * more on a desktop-class one) and whether this device can take the run over by itself when the desktop is gone. A run with the standard detail asks for
 * nothing: its session options are empty, so the session is the one 0.8.0 made.
 */
import { describe, expect, it } from 'vitest';
import type { ScenarioData } from '../core/types';
import { syntheticScenario } from '../sim/testing/scenarios';
import { DESKTOP_HISTORY_BUDGET } from './desktopDetail';
import { continueRefusal, sessionOptions } from './desktopDetailRun';
import { defaultSnapshotBudget } from './session';

const PIXEL = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', userAgentData: { mobile: true }, deviceMemory: 8 };
const LAPTOP = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36', userAgentData: { mobile: false }, deviceMemory: 8 };
const OLD_PHONE = { userAgent: 'Mozilla/5.0 (Linux; Android 9; SM-A105F) AppleWebKit/537.36 Chrome/110 Mobile Safari/537.36', userAgentData: { mobile: true }, deviceMemory: 1 };

/** A scenario that carries a level (the run's own grid, ember cap and record are all that the page reads here). */
function leveled(level: 'finer' | 'finest' | null, extent = 6000): ScenarioData {
  const base = syntheticScenario({ extent: 3000, duration: 4 * 3600 });
  const cell = level === 'finest' ? 10 : level === 'finer' ? 20 : 30;
  return { ...base, extent, options: { ...base.options, fireCellSize: cell, maxEmbers: level ? 8000 : 2000, tier: 'auto', ...(level ? { desktopDetail: level } : {}) } };
}

describe('the history budget of a run', () => {
  it('the standard detail asks for nothing: no options at all, on any page', () => {
    for (const nav of [PIXEL, LAPTOP, OLD_PHONE, undefined]) expect(sessionOptions(leveled(null), nav)).toEqual({});
  });

  it('a phone viewing a finer run gets exactly the budget it gets today, whatever its memory (no growth on a phone)', () => {
    for (const level of ['finer', 'finest'] as const) {
      expect(sessionOptions(leveled(level), PIXEL)).toEqual({ maxBytes: defaultSnapshotBudget(8) });
      expect(sessionOptions(leveled(level), OLD_PHONE)).toEqual({ maxBytes: defaultSnapshotBudget(1) });
    }
  });

  it('a desktop-class page gets 384 MiB, once, at a finer level', () => {
    expect(sessionOptions(leveled('finest'), LAPTOP)).toEqual({ maxBytes: DESKTOP_HISTORY_BUDGET });
    expect(DESKTOP_HISTORY_BUDGET).toBeGreaterThan(defaultSnapshotBudget(8));
    expect(DESKTOP_HISTORY_BUDGET).toBe(384 * 1024 * 1024);
  });
});

describe('"Continue on this device": can this device run the grid by itself?', () => {
  it('nothing is refused for the standard detail', () => {
    expect(continueRefusal(leveled(null, 9000), OLD_PHONE)).toBeNull();
    expect(continueRefusal(leveled(null, 9000), PIXEL)).toBeNull();
  });

  it('a phone of 4 GB cannot take over a 10 m run over 9 km (about 1.9 GB against the third of its memory an app can use), and is told in a sentence, with the standard detail offered', () => {
    const r = continueRefusal(leveled('finest', 9000), { ...PIXEL, deviceMemory: 4 })!;
    expect(r).not.toBeNull();
    expect(r.short).toMatch(/^This device cannot run the 10.m grid of this run\.$/);
    expect(r.sentence).toMatch(/needs about 1\.9.GB of memory, it reports about 4 GB/);
    expect(r.action).toBe('Set up at the standard detail');
    // A phone that reports 8 GB can (a third of it is 2.7 GB): the rule follows what the device says.
    expect(continueRefusal(leveled('finest', 9000), PIXEL)).toBeNull();
  });

  it('a laptop can take over what a phone cannot (the same scenario)', () => {
    expect(continueRefusal(leveled('finest', 6000), LAPTOP)).toBeNull();
    expect(continueRefusal(leveled('finest', 6000), OLD_PHONE)).not.toBeNull();
  });

  it('20 m over 6 km is a grid a phone of 4 GB or more can run by itself', () => {
    expect(continueRefusal(leveled('finer', 6000), { ...PIXEL, deviceMemory: 4 })).toBeNull();
  });
});
