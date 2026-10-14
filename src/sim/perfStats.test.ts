/**
 * The engine's always-on timing statistics (sim/perfStats.ts) with a fake clock: the speed windows (10 s, 60 s, run mean,
 * best and worst 10 s, the 20-sample history), step statistics over the last 128 steps, worker duty, the module mapping
 * and shares, step quality, re-run counters, events with increasing `seq`, no NaN anywhere, and the size limits
 * (under 2 KB serialised, under 16 KB retained).
 */
import { describe, expect, it } from 'vitest';
import type { EnginePerfInfo } from '../core/types';
import { AIR_LIMIT, lapModuleIndex, MAX_PERF_EVENTS, PERF_LAP_MODULE, PERF_MODULE_IDS, PerfStats } from './perfStats';

/** No field is undefined or NaN (null means "not measured yet"), like engineInfo.test.ts. */
function expectClean(v: unknown, path = 'perf'): void {
  if (v === null) return;
  if (typeof v === 'number') {
    expect(Number.isFinite(v), path).toBe(true);
    expect(Object.is(v, -0), `${path} is -0`).toBe(false);
    return;
  }
  expect(v, path).not.toBeUndefined();
  if (typeof v === 'object') for (const [k, x] of Object.entries(v as object)) expectClean(x, `${path}.${k}`);
}

const report = (s: PerfStats, nowMs: number, stepStartMs = NaN): EnginePerfInfo => s.report({ nowMs, stepStartMs, spinUpWallS: 0, burningCells: 0 });
const mod = (p: EnginePerfInfo, id: string) => p.modules.find((m) => m.id === id)!;

/** A run of `n` steps of `wallMs` busy time each, `gapMs` apart (idle), each advancing `dtS`; returns the wall time after the last. */
function run(s: PerfStats, from: number, n: number, wallMs: number, dtS: number, gapMs = 0): number {
  let t = from;
  for (let i = 0; i < n; i++) {
    s.endStep(t, t + wallMs, dtS, 0);
    t += wallMs + gapMs;
  }
  return t;
}

describe('a fresh instance', () => {
  it('reports null for what is not measured yet, zero counters and no NaN', () => {
    const p = report(new PerfStats(() => 0), 0);
    expectClean(p);
    expect(p.speed).toEqual({ s10: null, s60: null, mean: null, best10: null, worst10: null });
    expect(p.history).toEqual([]);
    expect(p.duty).toEqual({ s10: null, s60: null });
    expect(p.step).toEqual({ nowS: null, minS: null, meanS: null, maxS: null, medianMs: null, p95Ms: null, maxMs: null, over100: 0, over250: 0 });
    expect(p.modules.map((m) => m.id)).toEqual([...PERF_MODULE_IDS]);
    for (const m of p.modules) expect(m).toMatchObject({ ms: null, share: null, share10: null });
    expect(p.quality).toMatchObject({ limitedBy: null, maxWindH: null, maxWindV: null, projectionCorrections: null, fireSubSteps: null });
    expect(p.reruns).toEqual({ rewinds: 0, recomputedS: 0, tierSwitches: 0, restores: 0 });
    expect(p.events).toEqual([]);
  });

  it('a frozen clock (every step takes 0 ms) gives no division by zero', () => {
    const s = new PerfStats(() => 0);
    run(s, 5000, 40, 0, 10);
    const p = report(s, 5000);
    expectClean(p);
    expect(p.speed.mean).toBeNull();
    expect(p.duty.s10).toBeNull();
    expect(p.step.medianMs).toBe(0);
    for (const m of p.modules) expect(m.share).toBeNull();
  });
});

describe('computing speed', () => {
  it('is simulated seconds per busy second: idle time does not lower it', () => {
    const s = new PerfStats();
    // 30 s of wall time: 500 ms of computing and 500 ms of waiting per second, 50 simulated s per step: 100x while busy.
    const end = run(s, 1000, 30, 500, 50, 500);
    const p = report(s, end);
    expect(p.speed.s10).toBe(100);
    expect(p.speed.s60).toBe(100);
    expect(p.speed.mean).toBe(100);
    // Half the time busy: the duty says so (the first step started at 1000 ms, so the 10 s window is whole).
    expect(p.duty.s10).toBeGreaterThan(0.47);
    expect(p.duty.s10).toBeLessThan(0.56);
    expect(p.duty.s60).toBeGreaterThan(0.47);
    expect(p.duty.s60).toBeLessThan(0.56);
  });

  it('s10 follows the last 10 s, s60 the last 60 s, mean the whole tier', () => {
    const s = new PerfStats();
    let t = run(s, 0, 60, 500, 50, 500); // 60 s at 100x (50 s per 0.5 s of computing)
    t = run(s, t, 60, 500, 10, 500); // 60 s at 20x
    const p = report(s, t);
    expect(p.speed.s10).toBe(20);
    expect(p.speed.s60).toBe(20);
    expect(p.speed.mean).toBe(60);
    // Half way through the slow minute the 60 s window holds both kinds.
    const r = new PerfStats();
    const u = run(r, 0, 60, 500, 50, 500);
    const q = report(r, run(r, u, 30, 500, 10, 500));
    expect(q.speed.s10).toBe(20);
    expect(q.speed.s60).toBeCloseTo(59.3, 0); // bins 31 to 90: 29 s at 100x and 30 s at 20x
    expect(q.speed.mean).toBeCloseTo(73.3, 0);
  });

  it('is null before 100 ms of computing and after a long idle spell, while the run mean stays', () => {
    const early = new PerfStats();
    early.endStep(1000, 1050, 10, 10);
    expect(report(early, 1100).speed).toMatchObject({ s10: null, s60: null, mean: null });
    const s = new PerfStats();
    const end = run(s, 2000, 20, 200, 20); // 4 s of computing at 100x, back to back
    const flat = report(s, end);
    expect(flat.speed.s10).toBe(100);
    expect(flat.duty.s10).toBeGreaterThan(0.95);
    // 40 s idle: nothing in the last 10 s, the last 60 s still hold the work.
    const idle = report(s, end + 40_000);
    expect(idle.speed.s10).toBeNull();
    expect(idle.speed.s60).toBe(100);
    expect(idle.speed.mean).toBe(100);
    expect(idle.duty.s10).toBe(0);
    expect(idle.duty.s60).toBeLessThan(0.15);
  });

  it('best and worst 10 s windows are tumbling windows of 10 s of computing', () => {
    const s = new PerfStats();
    expect(report(s, 0).speed.best10).toBeNull();
    let t = run(s, 0, 20, 500, 100); // 10 s of computing at 200x: one window closes
    expect(report(s, t).speed).toMatchObject({ best10: 200, worst10: 200 });
    t = run(s, t, 20, 500, 10); // 20x
    t = run(s, t, 20, 500, 400); // 800x
    t = run(s, t, 19, 500, 1); // not yet a window
    const p = report(s, t);
    expect(p.speed.best10).toBe(800);
    expect(p.speed.worst10).toBe(20);
  });

  it('keeps one history sample per 30 s of computing, 20 at most, oldest first', () => {
    const s = new PerfStats();
    let t = 0;
    expect(report(s, t).history).toEqual([]);
    // Sample k (1-based) runs at 10 k x: 30 steps of 1 s each, 10 k simulated seconds per step.
    for (let k = 1; k <= 7; k++) t = run(s, t, 30, 1000, 10 * k);
    expect(report(s, t).history).toEqual([10, 20, 30, 40, 50, 60, 70]);
    for (let k = 8; k <= 25; k++) t = run(s, t, 30, 1000, 10 * k);
    const h = report(s, t).history;
    expect(h).toHaveLength(20);
    expect(h[0]).toBe(60); // samples 1 to 5 were pushed out
    expect(h[19]).toBe(250);
    expect(h).toEqual(Array.from({ length: 20 }, (_, i) => 10 * (i + 6)));
  });
});

describe('step statistics', () => {
  it('outer step now / min / mean / max, and the median, 95th percentile and maximum of the last 128 steps', () => {
    const s = new PerfStats();
    const walls: number[] = [];
    let t = 0;
    for (let i = 0; i < 300; i++) {
      const w = (i * 37) % 200 + 5; // 5 .. 204 ms in a scrambled order
      walls.push(w);
      s.endStep(t, t + w, i % 3 === 0 ? 12 : 6, 0);
      t += w;
    }
    const p = report(s, t);
    expect(p.step).toMatchObject({ nowS: 6, minS: 6, maxS: 12, meanS: 8 });
    const last = walls.slice(-128).sort((a, b) => a - b);
    expect(p.step.medianMs).toBe((last[63]! + last[64]!) / 2);
    expect(p.step.p95Ms).toBe(last[Math.ceil(0.95 * 128) - 1]);
    expect(p.step.maxMs).toBe(last[127]);
    // The counts are for the whole tier, not the ring.
    expect(p.step.over100).toBe(walls.filter((w) => w > 100).length);
    expect(p.step.over250).toBe(0);
  });

  it('counts steps over 100 ms and over 250 ms, and a short ring has a median of its own', () => {
    const s = new PerfStats();
    s.endStep(0, 50, 10, 0);
    s.endStep(50, 150, 10, 0); // exactly 100: not over
    s.endStep(150, 400, 10, 0); // 250: over 100, not over 250
    s.endStep(400, 701, 10, 0); // 301: both
    const p = report(s, 701);
    expect(p.step).toMatchObject({ over100: 2, over250: 1, medianMs: 175, maxMs: 301 });
  });
});

describe('worker duty', () => {
  it('a worker that is flat out reads 1, the step under way included', () => {
    const s = new PerfStats();
    const end = run(s, 0, 60, 200, 10); // 12 s of back-to-back steps
    expect(report(s, end + 150, end).duty).toEqual({ s10: 1, s60: 1 });
  });

  it('is the share of wall time spent computing, counts the step under way, and falls when the worker waits', () => {
    const s = new PerfStats();
    const t = run(s, 0, 40, 100, 10, 400); // 20 % duty for 20 s
    const p = report(s, t);
    expect(p.duty.s10).toBeGreaterThan(0.17);
    expect(p.duty.s10).toBeLessThan(0.23);
    expect(report(s, t + 5000).duty.s10).toBeLessThan(0.12);
    // A report made 150 ms into a step that has not finished: that time is computing too.
    const half = new PerfStats();
    const u = run(half, 0, 30, 200, 10, 300);
    expect(report(half, u + 150, u).duty.s10!).toBeGreaterThan(report(half, u + 150).duty.s10!);
  });
});

describe('where the time goes', () => {
  it('maps the laps of a step onto modules, adds what no lap covers to "other" and the shares sum to 1', () => {
    const s = new PerfStats();
    for (let i = 0; i < 4; i++) {
      s.addLap('atmosphere', 60);
      s.addLap('fireStep', 12);
      s.addLap('firePrepare', 8);
      s.addLap('surfaceWind', 6);
      s.addLap('fireHeat', 4);
      s.addLap('records', 2);
      s.addLap('mystery lap', 3);
      s.endStep(i * 200, i * 200 + 100, 10, 0); // 95 ms in laps, 5 ms in no lap
    }
    const p = report(s, 800);
    expect(mod(p, 'air')).toMatchObject({ ms: 60, share: 0.6, share10: 0.6 });
    expect(mod(p, 'fire')).toMatchObject({ ms: 20, share: 0.2, share10: 0.2 });
    expect(mod(p, 'coupling')).toMatchObject({ ms: 10, share: 0.1, share10: 0.1 });
    expect(mod(p, 'other')).toMatchObject({ ms: 10, share: 0.1 }); // records 2 + unknown 3 + uncovered 5
    expect(mod(p, 'embers').ms).toBe(0);
    expect(p.modules.reduce((a, m) => a + m.share!, 0)).toBeCloseTo(1, 9);
    expectClean(p);
  });

  it('the last 10 s share differs from the share since the tier started when the work changed', () => {
    const s = new PerfStats();
    let t = 0;
    for (let i = 0; i < 30; i++) {
      s.addLap('atmosphere', 100);
      s.endStep(t, t + 100, 10, 0);
      t += 1000;
    }
    for (let i = 0; i < 10; i++) {
      s.addLap('embers', 100);
      s.endStep(t, t + 100, 10, 0);
      t += 1000;
    }
    const p = report(s, t);
    expect(mod(p, 'air').share).toBe(0.75);
    expect(mod(p, 'embers').share).toBe(0.25);
    expect(mod(p, 'air').share10).toBe(0);
    expect(mod(p, 'embers').share10).toBe(1);
  });

  it('every lap of Simulation.stepOnce has a module, and the nested airAt lap is not one of them', () => {
    // The names stepOnce passes to lap(): see simulation.ts. 'airAt' is added to perfMods by fireWinds and never lapped.
    const laps = ['records', 'stamps', 'weatherNight', 'solarMoisture', 'fireMasks', 'surfaceWind', 'firePrepare', 'fireStep', 'fireHeat', 'atmosphere', 'embers', 'fireMinute', 'diagnostics', 'explain', 'snapshot', 'checkpoint'];
    for (const l of laps) expect(Object.keys(PERF_LAP_MODULE), l).toContain(l);
    expect(Object.keys(PERF_LAP_MODULE)).not.toContain('airAt');
    expect(PERF_MODULE_IDS[lapModuleIndex('atmosphere')]).toBe('air');
    expect(PERF_MODULE_IDS[lapModuleIndex('surfaceWind')]).toBe('coupling');
    expect(PERF_MODULE_IDS[lapModuleIndex('diagnostics')]).toBe('detectors');
    expect(PERF_MODULE_IDS[lapModuleIndex('snapshot')]).toBe('picture');
    expect(PERF_MODULE_IDS[lapModuleIndex('checkpoint')]).toBe('checkpoints');
    expect(PERF_MODULE_IDS[lapModuleIndex('solarMoisture')]).toBe('moisture');
    expect(PERF_MODULE_IDS[lapModuleIndex('no such lap')]).toBe('other');
  });
});

describe('step quality', () => {
  it('shares of air steps by what limited them, the wind maxima, projection corrections and fire sub-steps', () => {
    const s = new PerfStats();
    let t = 0;
    const limits = [AIR_LIMIT.cflH, AIR_LIMIT.cflH, AIR_LIMIT.cflV, AIR_LIMIT.cap];
    for (let i = 0; i < 4; i++) {
      s.noteAirStep(limits[i]!, 8 + i, 0.5 * (i + 1), 1 + (i % 2));
      s.noteFireSubSteps(i === 3 ? 0 : 4);
      s.endStep(t, t + 100, 10, 0);
      t += 100;
    }
    const q = report(s, t).quality;
    expect(q.limitedBy).toEqual({ cflH: 0.5, cflV: 0.25, cap: 0.25, user: 0 });
    expect(q.maxWindH).toBe(11);
    expect(q.maxWindV).toBe(2);
    expect(q.projectionCorrections).toBe(1.5);
    expect(q.fireSubSteps).toBe(3);
    const withSpin = s.report({ nowMs: t, stepStartMs: NaN, spinUpWallS: 3.456, burningCells: 1234.4 }).quality;
    expect(withSpin).toMatchObject({ spinUpWallS: 3.46, burningCells: 1234 });
  });
});

describe('the tier and the run', () => {
  it('a new tier starts the speed, step and module statistics again and keeps the run counters and the event sequence', () => {
    const s = new PerfStats(() => 1000);
    run(s, 0, 100, 200, 10);
    s.noteAirStep(AIR_LIMIT.cflH, 9, 1, 2);
    s.noteRewind();
    s.noteRestore();
    s.noteTierSwitch();
    s.noteRecomputed(120.4);
    s.event('tier', 5, 'first');
    s.startTier();
    const p = report(s, 40_000);
    expect(p.speed).toEqual({ s10: null, s60: null, mean: null, best10: null, worst10: null });
    expect(p.history).toEqual([]);
    expect(p.step.medianMs).toBeNull();
    expect(p.step.over100).toBe(0);
    expect(p.quality.limitedBy).toBeNull();
    expect(mod(p, 'air').share).toBeNull();
    expect(p.reruns).toEqual({ rewinds: 1, recomputedS: 120, tierSwitches: 1, restores: 1 });
    expect(p.events.map((e) => e.seq)).toEqual([1]); // the event queued before the restart is still delivered
    s.event('tier', 6, 'second');
    expect(report(s, 40_000).events.map((e) => e.seq)).toEqual([2]);
  });
});

describe('events', () => {
  it('are drained once, with a seq that keeps increasing, at most eight at a time (the oldest are dropped)', () => {
    let wall = 1_700_000_000_000;
    const s = new PerfStats(() => (wall += 1000));
    for (let i = 1; i <= 3; i++) s.event('rewind', i * 10, `event ${i}`);
    const a = report(s, 0).events;
    expect(a.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(a[0]).toEqual({ seq: 1, kind: 'rewind', simS: 10, wallMs: 1_700_000_001_000, text: 'event 1' });
    expect(report(s, 0).events).toEqual([]);
    for (let i = 4; i <= 15; i++) s.event('tier', i, `event ${i}`);
    const b = report(s, 0).events;
    expect(b).toHaveLength(MAX_PERF_EVENTS);
    expect(b.map((e) => e.seq)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    s.event('restore', Number.NaN, 'x'.repeat(500));
    const c = report(s, 0).events[0]!;
    expect(c.seq).toBe(16);
    expect(c.simS).toBe(0);
    expect(c.text.length).toBeLessThanOrEqual(120);
  });

  it('five steps over 250 ms close together make one long-steps event; a later burst makes another', () => {
    const s = new PerfStats(() => 0);
    let t = 0;
    for (let i = 0; i < 4; i++) {
      s.endStep(t, t + 300, 10, 100);
      t += 400;
    }
    expect(report(s, t).events).toEqual([]);
    s.endStep(t, t + 450, 10, 500);
    t += 500;
    s.endStep(t, t + 300, 10, 510); // the same burst: no second event
    t += 400;
    const e = report(s, t).events;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: 'long-steps', simS: 500 });
    expect(e[0]!.text).toMatch(/5 steps.*250 ms.*450 ms/);
    t += 30_000;
    for (let i = 0; i < 5; i++) {
      s.endStep(t, t + 260, 10, 900);
      t += 300;
    }
    expect(report(s, t).events).toHaveLength(1);
    expect(s.report({ nowMs: t, stepStartMs: NaN, spinUpWallS: 0, burningCells: 0 }).step.over250).toBe(11);
  });
});

describe('size', () => {
  /** A statistics object after a long busy run, everything filled in, with the largest events the engine writes. */
  function worstCase(): [PerfStats, EnginePerfInfo] {
    const s = new PerfStats(() => 1_760_000_000_123);
    let t = 123_456_789;
    for (let i = 0; i < 7000; i++) {
      s.addLap('atmosphere', 41.123456 + (i % 7));
      s.addLap('fireStep', 7.31);
      s.addLap('surfaceWind', 3.3);
      s.addLap('embers', 2.2);
      s.addLap('solarMoisture', 1.1);
      s.addLap('diagnostics', 0.9);
      s.addLap('snapshot', 4.4);
      s.addLap('checkpoint', 0.7);
      s.noteAirStep(i % 4, 31.37 + i / 1000, 7.77, 2 + (i % 3) / 3);
      s.noteFireSubSteps(i % 5);
      s.endStep(t, t + 61.73 + (i % 9) * 11.1, 11.43, i * 11.43);
      t += 1000 + ((i * 7) % 300);
    }
    // The longest line the engine writes is about 90 characters; the cap on any text is 120.
    for (let i = 0; i < 12; i++) s.event('restore', 123456 + i, 'Rewound to 12 h 40 min: restored the checkpoint at 12 h 30 min and ran forward again.'.padEnd(i % 2 ? 90 : 120, '.'));
    return [s, s.report({ nowMs: t, stepStartMs: t - 30, spinUpWallS: 12.34, burningCells: 123456 })];
  }

  it('the serialised block stays under 2 KB with every other field filled in and as many events as fit', () => {
    const [, p] = worstCase();
    expectClean(p);
    expect(p.history).toHaveLength(20);
    expect(p.events.length).toBeGreaterThanOrEqual(3);
    const bytes = JSON.stringify(p).length;
    process.stderr.write(`[perf stats] serialised block, worst case: ${bytes} bytes with ${p.events.length} events (${JSON.stringify({ ...p, events: [] }).length} without)\n`);
    expect(bytes).toBeLessThan(2048);
    expect(structuredClone(p)).toEqual(p);
  });

  it('events that do not fit one snapshot wait for the next, in order, and none is lost (up to the queue of eight)', () => {
    const [s, first] = worstCase();
    const second = s.report({ nowMs: 1, stepStartMs: NaN, spinUpWallS: 0, burningCells: 0 }).events;
    const third = s.report({ nowMs: 1, stepStartMs: NaN, spinUpWallS: 0, burningCells: 0 }).events;
    const seqs = [...first.events, ...second, ...third].map((e) => e.seq);
    expect(seqs).toEqual([5, 6, 7, 8, 9, 10, 11, 12]); // 12 were queued, the newest 8 were kept
    expect(first.events.length).toBeLessThan(8);
    for (const part of [first.events, second, third]) expect(JSON.stringify(part).length).toBeLessThan(900);
  });

  it('a typical report (a few short events) is far smaller', () => {
    const s = new PerfStats();
    run(s, 0, 50, 100, 10);
    s.event('tier', 0, 'Auto kept the detailed 3-D air: about 41 ms per air step.');
    expect(JSON.stringify(report(s, 5000)).length).toBeLessThan(1400);
  });

  it('holds under 16 KB', () => {
    const s = new PerfStats();
    expect(s.retainedBytes()).toBeLessThan(16 * 1024);
    process.stderr.write(`[perf stats] retained: ${s.retainedBytes()} bytes\n`);
  });
});
