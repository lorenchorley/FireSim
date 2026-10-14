/** What fills the recent-events ring during a run (runEvents.ts): slow-run episodes from the pace levels, the engine's events, the background / foreground pair, the first thinning of the history. */
import { afterEach, describe, expect, it } from 'vitest';
import type { SimSnapshot } from '../core/types';
import { EventLog } from './eventLog';
import type { PaceInfo, PaceLevel } from './paceTypes';
import { PaceWatch, waited, watchRun } from './runEvents';
import type { SessionState, SimSession } from './session';
import { Store } from './store';

const pace = (level: PaceLevel, o: Partial<PaceInfo> = {}): PaceInfo => ({ level, wanted: 60, achieved: 40, waitingShare: 0, capacity: 38, duty: 0.95, aheadS: 0, bufferS: 0, sinceMs: 0, ...o });

/** A log on a clock the test moves. */
function fakeLog(): { log: EventLog; tick(ms: number): void } {
  let t = 1_000_000;
  return { log: new EventLog(40, () => t), tick: (ms) => void (t += ms) };
}

describe('waited', () => {
  it('seconds, minutes and hours in words, never negative or NaN', () => {
    expect([0, 4_400, 59_600, 130_000, 3_660_000, -5000].map(waited)).toEqual(['0 s', '4 s', '1 min 0 s', '2 min 10 s', '1 h 1 min', '0 s']);
  });
});

describe('PaceWatch: slow-run episodes', () => {
  it('says nothing while the pace is ok or unknown', () => {
    const { log } = fakeLog();
    const w = new PaceWatch(log);
    w.observe(null, 0);
    w.observe(pace('ok'), 60);
    expect(log.list()).toHaveLength(0);
  });

  it('behind, then waiting, then back: one event per change, with the duration and the slowest ratio at the end', () => {
    const { log, tick } = fakeLog();
    const w = new PaceWatch(log);
    w.observe(pace('behind', { achieved: 54, capacity: 50 }), 600);
    w.observe(pace('behind', { achieved: 50, capacity: 48 }), 660); // same level: no event
    tick(20_000);
    w.observe(pace('waiting', { achieved: 24, capacity: 44 }), 700);
    w.observe(pace('waiting', { achieved: 30, capacity: 44 }), 720);
    tick(100_000);
    w.observe(pace('ok', { achieved: 60, capacity: 90 }), 900);
    w.observe(pace('ok'), 960);
    expect(log.list().map((e) => [e.kind, e.runS, e.text])).toEqual([
      ['slow', 600, 'The simulation is falling behind: computing about 50x, asked for 60x.'],
      ['slow', 700, 'Playback is now waiting for the simulation.'],
      ['slow', 900, 'Back at the speed asked for after 2 min 0 s. Slowest: about 40 % of the speed asked for.'],
    ]);
  });

  it('an episode that starts as waiting says so; a pause that ends it is not called "back at speed"', () => {
    const { log, tick } = fakeLog();
    const w = new PaceWatch(log);
    w.observe(pace('waiting', { achieved: 20, capacity: 30 }), 100);
    tick(8000);
    w.observe(null, 130); // paused: no judgement
    const [a, b] = log.list();
    expect(a!.text).toBe('Playback is waiting for the simulation: computing about 30x, asked for 60x.');
    expect(b!.text).toBe('The slow spell ended after 8 s (playback was paused, jumped or changed speed). Slowest: about 33 % of the speed asked for.');
  });

  it('a second episode starts afresh: its slowest ratio does not carry over; unknown speeds are not printed as numbers', () => {
    const { log } = fakeLog();
    const w = new PaceWatch(log);
    w.observe(pace('behind', { achieved: 6, capacity: 6 }), 0);
    w.observe(pace('ok'), 10);
    w.observe(pace('behind', { achieved: null, capacity: null }), 20);
    w.observe(pace('ok'), 30);
    const texts = log.list().map((e) => e.text);
    expect(texts[1]).toContain('Slowest: about 10 % ');
    expect(texts[2]).toBe('The simulation is falling behind: computing slower, asked for 60x.');
    expect(texts[3]).not.toContain('Slowest');
    for (const t of texts) expect(t).not.toMatch(/undefined|NaN|null|Infinity/);
  });
});

describe('watchRun', () => {
  const doc = { hidden: false, listeners: new Map<string, () => void>() };
  const original = (globalThis as { document?: unknown }).document;
  afterEach(() => {
    (globalThis as { document?: unknown }).document = original;
    doc.hidden = false;
    doc.listeners.clear();
  });

  function setup(): { log: EventLog; tick(ms: number): void; state: Store<SessionState>; snaps: { spacing: number; displayStep: number }; stop(): void } {
    (globalThis as { document?: unknown }).document = {
      get hidden() {
        return doc.hidden;
      },
      addEventListener: (type: string, fn: () => void) => doc.listeners.set(type, fn),
      removeEventListener: (type: string) => doc.listeners.delete(type),
    };
    const { log, tick } = fakeLog();
    const state = new Store({ pace: null, snapshot: null, viewTime: 0 } as unknown as SessionState);
    const snaps = { spacing: 60, displayStep: 60 };
    const stop = watchRun({ state, snapshots: snaps } as unknown as Pick<SimSession, 'state' | 'snapshots'>, log);
    return { log, tick, state, snaps, stop };
  }
  const withEvents = (events: { seq: number; kind: string; simS: number; wallMs: number; text: string }[]): SimSnapshot => ({ engine: { perf: { events } } }) as unknown as SimSnapshot;

  it('starts the log with the run, and records the engine events once each (the UI drops a seq it has seen)', () => {
    const { log, state } = setup();
    expect(log.list().map((e) => e.text)).toEqual(['Run started.']);
    const tier = { seq: 1, kind: 'tier', simS: 0, wallMs: 5_000, text: 'Detailed 3-D air chosen: about 41 ms per air step.' };
    state.set({ snapshot: withEvents([tier]) });
    state.set({ snapshot: withEvents([tier, { seq: 2, kind: 'long-steps', simS: 600, wallMs: 9_000, text: '3 steps took over 250 ms.' }]) });
    state.set({ snapshot: withEvents([]) });
    state.set({ snapshot: withEvents([tier]) });
    expect(log.list().slice(1).map((e) => [e.kind, e.runS, e.wallMs, e.text])).toEqual([
      ['tier', 0, 5_000, 'Detailed 3-D air chosen: about 41 ms per air step.'],
      ['long-steps', 600, 9_000, '3 steps took over 250 ms.'],
    ]);
  });

  it('events of a new engine instance, whose seq starts again at 1, are recorded too', () => {
    const { log, state } = setup();
    const first = { seq: 1, kind: 'tier', simS: 0, wallMs: 5_000, text: 'Detailed 3-D air chosen: about 41 ms per air step.' };
    const again = { seq: 1, kind: 'tier', simS: 0, wallMs: 90_000, text: 'Fast surface-wind model chosen.' };
    state.set({ snapshot: withEvents([first]) });
    state.set({ snapshot: withEvents([again]) });
    state.set({ snapshot: withEvents([first, again]) });
    expect(log.list().slice(1).map((e) => e.text)).toEqual([first.text, again.text]);
  });

  it('a snapshot with no engine info (the demo engine) or no perf block adds nothing', () => {
    const { log, state } = setup();
    state.set({ snapshot: {} as unknown as SimSnapshot });
    state.set({ snapshot: { engine: {} } as unknown as SimSnapshot });
    expect(log.list()).toHaveLength(1);
  });

  it('records the pace episode through the session state', () => {
    const { log, state, tick } = setup();
    state.set({ pace: pace('waiting'), viewTime: 300 });
    tick(10_000);
    state.set({ pace: pace('ok'), viewTime: 420 });
    expect(log.list().map((e) => e.kind)).toEqual(['run', 'slow', 'slow']);
    expect(log.list()[2]!.runS).toBe(420);
  });

  it('notes the first thinning of the history once, with the new spacing', () => {
    const { log, state, snaps } = setup();
    state.set({ snapshot: withEvents([]) });
    snaps.spacing = 75; // under 1.5 x the display step
    state.set({ snapshot: withEvents([]) });
    expect(log.list()).toHaveLength(1);
    snaps.spacing = 130;
    state.set({ snapshot: withEvents([]), viewTime: 1800 });
    snaps.spacing = 300;
    state.set({ snapshot: withEvents([]) });
    const thin = log.list().filter((e) => e.kind === 'history');
    expect(thin).toHaveLength(1);
    expect(thin[0]!.text).toBe('The history memory is full: older pictures are now about 130 s apart.');
  });

  it('records the app going to the background and coming back, with how long it was away; stopping unhooks everything', () => {
    const { log, state, tick, stop } = setup();
    doc.hidden = true;
    doc.listeners.get('visibilitychange')!();
    tick(125_000);
    doc.hidden = false;
    doc.listeners.get('visibilitychange')!();
    expect(log.list().slice(1).map((e) => e.text)).toEqual(['The app went to the background.', 'The app came back after 2 min 5 s in the background.']);
    stop();
    expect(doc.listeners.size).toBe(0);
    state.set({ pace: pace('waiting') });
    expect(log.list()).toHaveLength(3);
  });
});
