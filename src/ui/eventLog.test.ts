/** The recent-events ring and the long-task counter (the entry chunk's part of the debug statistics' event log). */
import { describe, expect, it } from 'vitest';
import { EventLog, LongTasks, watchLongTasks } from './eventLog';

/** A log on a clock the test moves. */
function fakeLog(): { log: EventLog; tick(ms: number): void } {
  let t = 1_000_000;
  return { log: new EventLog(40, () => t), tick: (ms) => void (t += ms) };
}

describe('EventLog', () => {
  it('keeps the last 40 events, oldest first, each with its wall clock and run clock', () => {
    const { log, tick } = fakeLog();
    for (let i = 0; i < 45; i++) {
      log.add('run', `event ${i}`, i * 60);
      tick(1000);
    }
    const list = log.list();
    expect(list).toHaveLength(40);
    expect(list[0]!.text).toBe('event 5');
    expect(list[39]!.text).toBe('event 44');
    expect(list[39]).toEqual({ wallMs: 1_000_000 + 44 * 1000, runS: 44 * 60, kind: 'run', text: 'event 44' });
  });

  it('begin() forgets the last run and notes when the new one started', () => {
    const { log, tick } = fakeLog();
    expect(log.runStartMs).toBeNull();
    log.add('run', 'old');
    tick(5000);
    log.begin();
    expect(log.list()).toHaveLength(0);
    expect(log.runStartMs).toBe(1_005_000);
  });
});

describe('LongTasks', () => {
  it('counts the tasks that started in the last minute, their total and the longest', () => {
    const lt = new LongTasks();
    lt.add(10_000, 80);
    lt.add(50_000, 120);
    lt.add(70_000, 60);
    expect(lt.recent(100_000)).toEqual({ count: 2, totalMs: 180, maxMs: 120 });
    expect(lt.recent(100_000, 10_000)).toEqual({ count: 0, totalMs: 0, maxMs: 0 });
    expect(new LongTasks().recent(5)).toEqual({ count: 0, totalMs: 0, maxMs: 0 });
  });

  it('the ring holds the last 128: a busier stretch keeps the newest', () => {
    const lt = new LongTasks();
    for (let i = 0; i < 200; i++) lt.add(i * 100, 50 + (i % 2));
    const r = lt.recent(20_000, 1e9);
    expect(r.count).toBe(128);
    expect(r.maxMs).toBe(51);
  });

  it('a browser without the observer, or one that refuses the entry type, leaves "supported" false', () => {
    const g = globalThis as { PerformanceObserver?: unknown };
    const keep = g.PerformanceObserver;
    try {
      const lt = new LongTasks();
      delete g.PerformanceObserver;
      watchLongTasks(lt);
      expect(lt.supported).toBe(false);
      g.PerformanceObserver = class {
        observe(): void {
          throw new TypeError('longtask is not a supported entry type');
        }
      };
      watchLongTasks(lt);
      expect(lt.supported).toBe(false);
    } finally {
      g.PerformanceObserver = keep;
    }
  });

  it('with the observer: entries are collected, and starting twice does not observe twice', () => {
    const g = globalThis as { PerformanceObserver?: unknown };
    const keep = g.PerformanceObserver;
    try {
      const made: { cb: (l: { getEntries(): { startTime: number; duration: number }[] }) => void; type?: string }[] = [];
      g.PerformanceObserver = class {
        constructor(cb: (typeof made)[number]['cb']) {
          made.push({ cb });
        }
        observe(o: { type: string }): void {
          made[made.length - 1]!.type = o.type;
        }
      };
      const lt = new LongTasks();
      watchLongTasks(lt);
      watchLongTasks(lt);
      expect(made).toHaveLength(1);
      expect([lt.supported, made[0]!.type]).toEqual([true, 'longtask']);
      made[0]!.cb({ getEntries: () => [{ startTime: 1000, duration: 90 }] });
      expect(lt.recent(2000)).toEqual({ count: 1, totalMs: 90, maxMs: 90 });
    } finally {
      g.PerformanceObserver = keep;
    }
  });
});
