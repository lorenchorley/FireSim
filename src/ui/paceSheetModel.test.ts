/** The sentences of the slow-run sheet (paceSheetModel.ts): each scenario, the rounding, the reasons logic, the voice rules, no NaN. */
import { describe, expect, it } from 'vitest';
import type { EnginePerfInfo, PerfModuleId, PerfModuleShare } from '../core/simTypes';
import type { PaceInfo } from './paceTypes';
import { earlierSpeed, fireEvery, PACE_ANNOUNCEMENT, PACE_BUTTON_LABEL, type PaceSheetEngine, type PaceSheetInput, paceSheet, percents, playAtSpeed, speedWord } from './paceSheetModel';

const pace = (o: Partial<PaceInfo> = {}): PaceInfo => ({
  level: 'waiting',
  wanted: 60,
  achieved: 38,
  waitingShare: 0.4,
  capacity: 38,
  duty: 0.97,
  aheadS: 60,
  bufferS: 1,
  sinceMs: 0,
  ...o,
});

/** Module shares by id (the rest zero); `share10` is the window the sheet reads. */
function modules(shares: Partial<Record<PerfModuleId, number>>, key: 'share10' | 'share' = 'share10'): PerfModuleShare[] {
  const ids: PerfModuleId[] = ['air', 'fire', 'coupling', 'embers', 'moisture', 'detectors', 'picture', 'checkpoints', 'other'];
  return ids.map((id) => ({ id, ms: 5, share: key === 'share' ? (shares[id] ?? 0) : 0.2, share10: key === 'share10' ? (shares[id] ?? 0) : null }));
}

function perf(o: { modules?: PerfModuleShare[]; history?: (number | null)[] } = {}): EnginePerfInfo {
  return {
    speed: { s10: 38, s60: 40, mean: 45, best10: 60, worst10: 30 },
    history: o.history ?? [],
    step: { nowS: 10, minS: 3, meanS: 8, maxS: 12, medianMs: 40, p95Ms: 60, maxMs: 90, over100: 0, over250: 0 },
    duty: { s10: 0.97, s60: 0.9 },
    modules: o.modules ?? [],
    quality: { limitedBy: null, maxWindH: null, maxWindV: null, projectionCorrections: null, spinUpWallS: null, fireSubSteps: null, burningCells: null },
    embers: null,
    reruns: { rewinds: 0, recomputedS: 0, tierSwitches: 0, restores: 0 },
    events: [],
  };
}

const PLAN_SHARES = { air: 0.52, fire: 0.15, coupling: 0.06, embers: 0.12, moisture: 0.05, detectors: 0.04, picture: 0.03, checkpoints: 0.02, other: 0.01 };
const standard = (p?: EnginePerfInfo): PaceSheetEngine => ({ tier: 'standard', perf: p ?? perf({ modules: modules(PLAN_SHARES) }) });
const input = (o: Partial<PaceSheetInput> = {}): PaceSheetInput => ({ pace: pace(), engine: standard(), remainingS: 6 * 3600, ...o });

describe('the words on the button', () => {
  it('has the accessible name and the announcement the plan asks for', () => {
    expect(PACE_BUTTON_LABEL).toBe('Simulation is running slower than your playback speed. Show details.');
    expect(PACE_ANNOUNCEMENT).toBe('Simulation is running slower than your playback speed.');
  });
});

describe('waiting', () => {
  it('says what was asked for, what the phone computes and how often playback waits (the example of the plan)', () => {
    const v = paceSheet(input());
    expect(v.state).toBe('waiting');
    expect(v.title).toBe('Running slower than playback');
    expect(v.lead).toBe('You asked for 60× (1 minute of fire every second). This phone is computing about 38× right now, so playback waits for the simulation about 4 seconds in every 10.');
  });

  it('answers "does it change the result?" with a plain no', () => {
    const v = paceSheet(input());
    expect(v.result).toEqual({ question: 'Does it change the result?', answer: 'No. The same choices give the same fire at any speed. It only takes longer to appear.' });
  });

  it('rounds the speeds to values people read, and uses the singular and the "all the time" forms', () => {
    expect(paceSheet(input({ pace: pace({ capacity: 37.6 }) })).lead).toContain('about 38×');
    expect(paceSheet(input({ pace: pace({ wanted: 3600, capacity: 1234 }) })).lead).toContain('about 1200×');
    expect(paceSheet(input({ pace: pace({ capacity: 0.26, wanted: 1 }) })).lead).toContain('about 0.25×');
    expect(paceSheet(input({ pace: pace({ waitingShare: 0.1 }) })).lead).toContain('about 1 second in every 10');
    expect(paceSheet(input({ pace: pace({ waitingShare: 0.96 }) })).lead).toContain('waits for the simulation almost all the time.');
    expect(paceSheet(input({ pace: pace({ waitingShare: 0.03 }) })).lead).toContain('waits for the simulation now and then.');
  });

  it('says what the speed asked for means in fire time', () => {
    expect(fireEvery(1)).toBe('real time');
    expect(fireEvery(0.5)).toBe('1 second of fire takes about 2 seconds');
    expect(fireEvery(30)).toBe('30 seconds of fire every second');
    expect(fireEvery(60)).toBe('1 minute of fire every second');
    expect(fireEvery(90)).toBe('1.5 minutes of fire every second');
    expect(fireEvery(600)).toBe('10 minutes of fire every second');
    expect(fireEvery(3600)).toBe('1 hour of fire every second');
    expect(fireEvery(7200)).toBe('2 hours of fire every second');
    expect(fireEvery(0)).toBe('');
    expect(speedWord(60)).toBe('60×');
  });

  it('leaves out what the phone computes when it is not known', () => {
    const v = paceSheet(input({ pace: pace({ capacity: null }) }));
    expect(v.lead).toBe('You asked for 60× (1 minute of fire every second). Playback waits for the simulation about 4 seconds in every 10.');
  });
});

describe('behind', () => {
  it('says what is computed, what was asked for and how much is already ahead (the wording of the plan)', () => {
    const v = paceSheet(input({ pace: pace({ level: 'behind', waitingShare: 0, aheadS: 60 }) }));
    expect(v.state).toBe('behind');
    expect(v.lead).toBe('Computing about 38×; you asked for 60×. About 1 minute of fire is already computed; after that, playback will wait.');
  });
  it('says seconds, minutes and hours of lead in whole words', () => {
    const lead = (aheadS: number): string => paceSheet(input({ pace: pace({ level: 'behind', aheadS }) })).lead;
    expect(lead(20)).toContain('About 20 seconds of fire is already computed');
    expect(lead(300)).toContain('About 5 minutes of fire is already computed');
    expect(lead(1800)).toContain('About 30 minutes of fire is already computed');
    expect(lead(7200)).toContain('About 2 hours of fire is already computed');
    expect(lead(3)).toBe('Computing about 38×; you asked for 60×. Playback is about to wait for the simulation.');
  });
});

describe('keeping up again (the sheet was open when the engine caught up)', () => {
  it('says so, with no actions, reasons or end time', () => {
    for (const p of [null, pace({ level: 'ok', capacity: 90, waitingShare: 0 })]) {
      const v = paceSheet(input({ pace: p }));
      expect(v.state).toBe('ok');
      expect(v.title).toBe('Keeping up with playback');
      expect(v.actions).toBeNull();
      expect(v.reasons).toEqual([]);
      expect(v.end).toBeNull();
    }
    expect(paceSheet(input({ pace: null })).lead).toBe('The simulation is keeping up now.');
    expect(paceSheet(input({ pace: pace({ level: 'ok', capacity: 90 }) })).lead).toBe('The simulation is keeping up now. You asked for 60×; this phone is computing about 90× right now.');
  });
  it('treats a reading that does not say what was asked for as no reading', () => {
    expect(paceSheet(input({ pace: pace({ wanted: Number.NaN }) })).state).toBe('ok');
    expect(paceSheet(input({ pace: pace({ wanted: Infinity }) })).state).toBe('ok');
  });
});

describe('where the time goes', () => {
  it('groups the modules into four rows that add up to 100 % (fire spread includes the coupling)', () => {
    const v = paceSheet(input());
    expect(v.time!.title).toBe('Where the time goes (last 10 s)');
    expect(v.time!.rows.map((r) => [r.label, r.text])).toEqual([
      ['3-D air flow', '52 %'],
      ['Fire spread', '21 %'],
      ['Embers', '12 %'],
      ['Everything else', '15 %'],
    ]);
    expect(v.time!.rows.reduce((a, r) => a + r.percent, 0)).toBe(100);
  });
  it('names the air row for the fast tier "Surface wind"', () => {
    const v = paceSheet(input({ engine: { tier: 'fast', perf: perf({ modules: modules(PLAN_SHARES) }) } }));
    expect(v.time!.rows[0]!.label).toBe('Surface wind');
  });
  it('reads the whole time since the tier started when the last 10 s are empty, and says so', () => {
    const v = paceSheet(input({ engine: standard(perf({ modules: modules(PLAN_SHARES, 'share') })) }));
    expect(v.time!.title).toBe('Where the time goes (this run so far)');
    expect(v.time!.rows[0]!.text).toBe('52 %');
  });
  it('is left out when nothing has been measured', () => {
    expect(paceSheet(input({ engine: null })).time).toBeNull();
    expect(paceSheet(input({ engine: { tier: 'standard' } })).time).toBeNull();
    expect(paceSheet(input({ engine: standard(perf({ modules: [] })) })).time).toBeNull();
    const empty = modules({}).map((m) => ({ ...m, share: null, share10: null }));
    expect(paceSheet(input({ engine: standard(perf({ modules: empty })) })).time).toBeNull();
    expect(paceSheet(input({ engine: standard(perf({ modules: empty.map((m) => ({ ...m, share: 0, share10: 0 })) })) })).time).toBeNull();
  });
  it('rounds so that the rows add up to 100 whatever the shares are', () => {
    expect(percents([1 / 3, 1 / 3, 1 / 3])).toEqual([34, 33, 33]);
    expect(percents([0.5, 0.25, 0.125, 0.125])).toEqual([50, 25, 13, 12]);
    expect(percents([0, 0, 0])).toEqual([0, 0, 0]);
    expect(percents([Number.NaN, -1, 2])).toEqual([0, 0, 100]);
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const xs = [rnd(), rnd(), rnd(), rnd()];
      expect(percents(xs).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });
  it('ignores null and non-finite shares', () => {
    const mods = modules({ air: 0.5, fire: 0.5 });
    mods[3] = { id: 'embers', ms: null, share: null, share10: Number.NaN };
    const v = paceSheet(input({ engine: standard(perf({ modules: mods })) }));
    expect(v.time!.rows.map((r) => r.percent)).toEqual([50, 50, 0, 0]);
  });
});

describe('likely reasons (each only when the numbers support it)', () => {
  const reasons = (o: Partial<PaceSheetInput> & { shares?: Partial<Record<PerfModuleId, number>>; history?: (number | null)[]; tier?: 'fast' | 'standard' | 'high' } = {}): string[] =>
    paceSheet(input({ engine: { tier: o.tier ?? 'standard', perf: perf({ modules: modules(o.shares ?? PLAN_SHARES), history: o.history ?? [] }) }, ...(o.pace ? { pace: o.pace } : {}) })).reasons;

  it('the air flow is the heaviest part: over 40 % of the busy time in a 3-D tier', () => {
    expect(reasons()).toEqual(['The 3-D air flow is the heaviest part. The fast model skips it and is usually about three times faster, with less detail.']);
    expect(reasons({ tier: 'high' })).toHaveLength(1);
  });
  it('does not blame the air flow at 40 % or under, or in the fast tier', () => {
    expect(reasons({ shares: { air: 0.4, fire: 0.6 } })).toEqual(['A big fire takes longer to compute; this eases as it burns out.']);
    expect(reasons({ tier: 'fast' })).toEqual([]);
  });
  it('says "a big share" when the air is over 40 % but something else is bigger', () => {
    const r = reasons({ shares: { air: 0.45, fire: 0.5, embers: 0.05 } });
    expect(r[0]).toBe('The 3-D air flow takes a big share of the time. The fast model skips it and is usually about three times faster, with less detail.');
    expect(r[1]).toBe('A big fire takes longer to compute; this eases as it burns out.');
  });
  it('a big fire: the fire and its coupling together over 40 %', () => {
    expect(reasons({ shares: { air: 0.2, fire: 0.25, coupling: 0.2, other: 0.35 } })).toEqual(['A big fire takes longer to compute; this eases as it burns out.']);
  });
  it('many embers: over 25 % of the busy time', () => {
    expect(reasons({ shares: { air: 0.2, fire: 0.2, embers: 0.26, other: 0.34 } })).toEqual(['Many embers are in the air, and each one takes time to follow. This eases when fewer are flying.']);
    expect(reasons({ shares: { air: 0.2, fire: 0.2, embers: 0.25, other: 0.35 } })).toEqual([]);
  });
  it('slower than earlier: under 75 % of the median of the first four history samples, said as "may"', () => {
    const history = [55, 56, 54, 55, 50, 45, 40, 38];
    const r = reasons({ shares: { other: 1 }, history });
    expect(r).toEqual(['Slower than before (about 55× earlier in this run). The phone may be warm or in battery saver.']);
    // 41.25 is 75 % of 55: at or above it, nothing.
    expect(reasons({ shares: { other: 1 }, history, pace: pace({ capacity: 42 }) })).toEqual([]);
    expect(reasons({ shares: { other: 1 }, history, pace: pace({ capacity: 41 }) })).toHaveLength(1);
  });
  it('slower than earlier needs four measured samples (nulls do not count) and a known speed now', () => {
    expect(reasons({ shares: { other: 1 }, history: [55, 56, 54] })).toEqual([]);
    expect(reasons({ shares: { other: 1 }, history: [null, 55, null, 56, 54, 55] })).toHaveLength(1);
    expect(reasons({ shares: { other: 1 }, history: [55, 56, 54, 55], pace: pace({ capacity: null }) })).toEqual([]);
    expect(earlierSpeed([null, 10, 20, 30, 40, 1000])).toBe(25);
    expect(earlierSpeed(undefined)).toBeNull();
  });
  it('lists the reasons in the order of the plan, and is empty when none applies', () => {
    const r = reasons({ shares: { air: 0.45, fire: 0.1, coupling: 0.31, embers: 0.14 }, history: [55, 55, 55, 55] });
    expect(r).toHaveLength(3);
    expect(r[0]).toMatch(/^The 3-D air flow/);
    expect(r[1]).toMatch(/^Slower than before/);
    expect(r[2]).toMatch(/^A big fire/);
    expect(reasons({ shares: { air: 0.3, fire: 0.3, embers: 0.1, other: 0.3 } })).toEqual([]);
  });
});

describe('what you can do', () => {
  it('Play at N: the nearest preset at or below what the phone achieves', () => {
    const v = paceSheet(input());
    expect(v.actions!.playAt).toEqual({ speed: 30, label: 'Play at 30×' });
    expect(playAtSpeed({ wanted: 60, achieved: 38.5, capacity: 38 })).toBe(30);
    expect(playAtSpeed({ wanted: 3600, achieved: 700, capacity: 650 })).toBe(600);
    expect(playAtSpeed({ wanted: 600, achieved: 1800, capacity: 1900 })).toBe(300);
    expect(playAtSpeed({ wanted: 60, achieved: 10, capacity: 38 })).toBe(10);
    expect(playAtSpeed({ wanted: 60, achieved: 29.99, capacity: 38 })).toBe(10);
  });
  it('uses the speed the worker computes at when the clock has not been timed yet, and the lower of the two otherwise', () => {
    expect(playAtSpeed({ wanted: 60, achieved: null, capacity: 38 })).toBe(30);
    expect(playAtSpeed({ wanted: 60, achieved: 38, capacity: null })).toBe(30);
    expect(playAtSpeed({ wanted: 60, achieved: 59, capacity: 12 })).toBe(10);
  });
  it('is always below the speed asked for, and offered only when there is a preset to offer', () => {
    expect(playAtSpeed({ wanted: 60, achieved: 60, capacity: 60 })).toBe(30);
    expect(playAtSpeed({ wanted: 45, achieved: 44, capacity: 44 })).toBe(30);
    expect(playAtSpeed({ wanted: 60, achieved: null, capacity: null })).toBeNull();
    expect(playAtSpeed({ wanted: 1, achieved: 0.1, capacity: 0.1 })).toBeNull();
    expect(playAtSpeed({ wanted: 60, achieved: Number.NaN, capacity: 0 })).toBeNull();
    expect(paceSheet(input({ pace: pace({ achieved: null, capacity: null }) })).actions!.playAt).toBeNull();
  });
  it('offers the fast model from here (with what it costs) unless it is already the fast model, the demo engine or unknown', () => {
    expect(paceSheet(input()).actions!.fast).toEqual({ label: 'Use the fast model from here', note: 'The fire from this moment on comes out a little different.' });
    expect(paceSheet(input({ engine: { tier: 'high', perf: perf() } })).actions!.fast).not.toBeNull();
    expect(paceSheet(input({ engine: { tier: 'fast', perf: perf() } })).actions!.fast).toBeNull();
    expect(paceSheet(input({ engine: { tier: 'standard', mock: true } })).actions!.fast).toBeNull();
    expect(paceSheet(input({ engine: null })).actions!.fast).toBeNull();
  });
  it('says that pausing does not let the simulation catch up (it stops too)', () => {
    expect(paceSheet(input()).actions!.pausing).toBe('Pausing stops the simulation too. Playing slower is what lets it keep up.');
  });
});

describe('the end of the run', () => {
  it('compares the time at this pace with the time at the speed asked for (the example of the plan)', () => {
    const v = paceSheet(input({ remainingS: 6 * 3600 }));
    expect(v.end).toBe('At this pace the end of the run is about 9 minutes away (6 at your speed).');
  });
  it('puts the unit in when they differ, and uses hours in halves', () => {
    expect(paceSheet(input({ pace: pace({ wanted: 60, capacity: 3.5 }), remainingS: 6 * 3600 })).end).toBe('At this pace the end of the run is about 1.5 hours away (6 minutes at your speed).');
    expect(paceSheet(input({ pace: pace({ wanted: 1.5, capacity: 0.5 }), remainingS: 6 * 3600 })).end).toBe('At this pace the end of the run is about 12 hours away (4 at your speed).');
  });
  it('is left out when it is under a minute away, when both come to the same, or when nothing is known', () => {
    expect(paceSheet(input({ remainingS: 30 })).end).toBeNull();
    expect(paceSheet(input({ remainingS: 600 })).end).toBeNull(); // 16 s at this pace: not worth saying
    expect(paceSheet(input({ pace: pace({ wanted: 60, capacity: 59.9 }), remainingS: 6 * 3600 })).end).toBeNull();
    expect(paceSheet(input({ pace: pace({ capacity: 90 }) })).end).toBeNull();
    expect(paceSheet(input({ pace: pace({ capacity: null, achieved: null }) })).end).toBeNull();
    expect(paceSheet(input({ remainingS: Number.NaN })).end).toBeNull();
    expect(paceSheet(input({ pace: pace({ level: 'ok' }) })).end).toBeNull();
  });
  it('falls back to the speed the clock achieved when the worker speed is not known', () => {
    expect(paceSheet(input({ pace: pace({ capacity: null, achieved: 38 }) })).end).toBe('At this pace the end of the run is about 9 minutes away (6 at your speed).');
  });
});

describe('the voice and the numbers', () => {
  /** Every string of a view, flattened. */
  const strings = (v: ReturnType<typeof paceSheet>): string[] => [
    v.title,
    v.lead,
    v.result.question,
    v.result.answer,
    ...(v.time ? [v.time.title, ...v.time.rows.flatMap((r) => [r.label, r.text])] : []),
    ...v.reasons,
    ...(v.actions ? [v.actions.pausing, ...(v.actions.playAt ? [v.actions.playAt.label] : []), ...(v.actions.fast ? [v.actions.fast.label, v.actions.fast.note] : [])] : []),
    ...(v.end ? [v.end] : []),
    v.link,
    v.footnote,
  ];
  const scenarios: PaceSheetInput[] = [];
  for (const level of ['behind', 'waiting', 'ok'] as const) {
    for (const wanted of [0.25, 1, 30, 60, 90, 600, 3600, 86400]) {
      for (const capacity of [null, 0.2, 38, 90, 5000]) {
        for (const tier of ['fast', 'standard', 'high'] as const) {
          scenarios.push({
            pace: pace({ level, wanted, capacity, achieved: capacity === null ? null : capacity * 0.9, waitingShare: level === 'waiting' ? 0.37 : 0, aheadS: level === 'behind' ? 400 : 3 }),
            engine: { tier, perf: perf({ modules: modules(PLAN_SHARES), history: [55, 56, 54, 55] }) },
            remainingS: 6 * 3600,
          });
        }
      }
    }
  }
  scenarios.push({ pace: null, engine: null, remainingS: 0 });

  it('follows the voice rules: plain words, sentence case, no em dashes, whole sentences', () => {
    for (const sc of scenarios) {
      for (const text of strings(paceSheet(sc))) {
        expect(text, text).not.toMatch(/[—–]/);
        expect(text, text).not.toMatch(/!/);
        expect(text, text).not.toMatch(/ {2}|^ | $/);
        expect(text, text).toMatch(/^[A-Z0-9]/);
        // Sentence case: only the first word of a sentence starts with a capital.
        for (const sentence of text.split(/(?<=[.?]) /)) expect(sentence.replace(/^\S+ ?/, ''), text).not.toMatch(/(^| )[A-Z][a-z]/);
      }
    }
  });

  it('never prints NaN, Infinity, undefined or null, whatever the numbers are', () => {
    const odd = [Number.NaN, Infinity, -Infinity, -1, 0, 1e-12, 1e12];
    for (const sc of [...scenarios, ...odd.flatMap((x) => [{ ...input(), pace: pace({ capacity: x, achieved: x, waitingShare: x, aheadS: x, bufferS: x }), remainingS: x }, { ...input(), pace: pace({ level: 'behind', capacity: x, aheadS: x }), remainingS: x }])]) {
      for (const text of strings(paceSheet(sc))) expect(text, text).not.toMatch(/NaN|Infinity|undefined|null|\[object/);
    }
  });

  it('says "about" before every measured speed', () => {
    for (const sc of scenarios) {
      const v = paceSheet(sc);
      if (v.state === 'waiting' && sc.pace && sc.pace.capacity !== null) expect(v.lead).toMatch(/computing about \d/);
      if (v.state === 'behind' && sc.pace && sc.pace.capacity !== null) expect(v.lead).toMatch(/^Computing about \d/);
    }
  });
});
