import { describe, expect, it } from 'vitest';
import type { WindDirectionEdit } from '../../../core/types';
import { windDirectionTime } from '../../../scenario/windDirection';
import {
  DIAL_LABEL,
  WHEN_OPTIONS,
  WIND_HINT,
  applyAnnouncement,
  applyLabel,
  defaultClock,
  dialSize,
  dialStart,
  nextClockTime,
  problemText,
  removeAnnouncement,
  resolveWhen,
  reviewingText,
  windClock,
  windList,
  windView,
  type WhenState,
  type WindEnv,
} from './windPanelModel';

const TZ = 'Australia/Sydney';
// 2026-10-10 14:00 Sydney (AEDT, UTC+11), a Saturday; four hours long.
const START = Date.UTC(2026, 9, 10, 3, 0, 0);
const D = 4 * 3600;
const ENV: WindEnv = { startMs: START, tz: TZ, durationS: D };
const MIN = 60;
/** 14:40:20: the view time of most cases (a "Now" change starts at 14:41). */
const V = 40 * MIN + 20;

const now: WhenState = { choice: 'now', clock: '' };
const at = (clock: string): WhenState => ({ choice: 'at', clock });
const edit = (id: string, dir: number, time: number): WindDirectionEdit => ({ kind: 'windDirection', id, dir, time });

describe('the clock', () => {
  it('shows the time of day in the scenario zone, and the day too only in a scenario of more than 20 h', () => {
    expect(windClock(ENV, 0)).toBe('14:00');
    expect(windClock(ENV, 41 * MIN)).toBe('14:41');
    const long: WindEnv = { ...ENV, durationS: 30 * 3600 };
    expect(windClock(long, 0)).toBe('Sat 14:00');
    expect(windClock(long, 11 * 3600)).toBe('Sun 01:00');
  });
});

describe('When: the presets', () => {
  it('has the five choices in the words of the panel', () => {
    expect(WHEN_OPTIONS.map((o) => o.label)).toEqual(['Now', 'In 10 min', 'In 30 min', 'In 1 h', 'At a time']);
    expect(WHEN_OPTIONS.map((o) => o.value)).toEqual(['now', '10', '30', '60', 'at']);
  });
  it('starts a change at a whole minute: the view time raised, then the preset added', () => {
    expect(resolveWhen(now, V, ENV)).toEqual({ ok: true, time: 41 * MIN });
    expect(resolveWhen(now, 41 * MIN, ENV)).toEqual({ ok: true, time: 41 * MIN });
    expect(resolveWhen({ choice: '10', clock: '' }, V, ENV)).toEqual({ ok: true, time: 51 * MIN });
    expect(resolveWhen({ choice: '30', clock: '' }, V, ENV)).toEqual({ ok: true, time: 71 * MIN });
    expect(resolveWhen({ choice: '60', clock: '' }, V, ENV)).toEqual({ ok: true, time: 101 * MIN });
  });
  it('agrees with the time the session gives (the one windDirectionTime both use)', () => {
    for (const v of [0, 1, 59.9, 60, 600.5, 3599, 13000]) {
      const r = resolveWhen({ choice: '10', clock: '' }, v, ENV);
      expect(r).toEqual({ ok: true, time: windDirectionTime(v + 600, D) });
    }
  });
  it('says "late" when the scenario ends within a minute, and "outside" for a preset that starts after the last minute', () => {
    const lastMinute = D - 60; // the last time a change can start
    expect(resolveWhen(now, lastMinute, ENV)).toEqual({ ok: true, time: lastMinute });
    expect(resolveWhen(now, lastMinute + 10, ENV)).toEqual({ ok: false, problem: 'late' });
    expect(resolveWhen(now, D, ENV)).toEqual({ ok: false, problem: 'late' });
    expect(resolveWhen({ choice: '10', clock: '' }, lastMinute, ENV)).toEqual({ ok: false, problem: 'outside' });
    expect(resolveWhen({ choice: '10', clock: '' }, lastMinute - 600, ENV)).toEqual({ ok: true, time: lastMinute });
    expect(resolveWhen({ choice: '10', clock: '' }, lastMinute + 10, ENV)).toEqual({ ok: false, problem: 'late' });
    expect(resolveWhen({ choice: '60', clock: '' }, 3 * 3600, ENV)).toEqual({ ok: false, problem: 'outside' });
  });
});

describe('When: At a time', () => {
  it('reads an empty or malformed field as "badClock"', () => {
    for (const c of ['', 'abc', '25:00', '14:61', '14']) expect(resolveWhen(at(c), V, ENV)).toEqual({ ok: false, problem: 'badClock' });
  });
  it('takes a clock time at or after the "Now" start', () => {
    expect(resolveWhen(at('14:41'), V, ENV)).toEqual({ ok: true, time: 41 * MIN });
    expect(resolveWhen(at('14:51'), V, ENV)).toEqual({ ok: true, time: 51 * MIN });
    expect(resolveWhen(at('17:59'), V, ENV)).toEqual({ ok: true, time: D - 60 });
  });
  it('rounds a time with seconds up to a whole minute', () => {
    expect(resolveWhen(at('14:50:30'), V, ENV)).toEqual({ ok: true, time: 51 * MIN });
  });
  it('says "past" for a time that came before the "Now" start, and "notInScenario" for one that never comes', () => {
    expect(resolveWhen(at('14:40'), V, ENV)).toEqual({ ok: false, problem: 'past' });
    expect(resolveWhen(at('14:00'), V, ENV)).toEqual({ ok: false, problem: 'past' });
    expect(resolveWhen(at('13:59'), V, ENV)).toEqual({ ok: false, problem: 'notInScenario' });
    expect(resolveWhen(at('23:00'), V, ENV)).toEqual({ ok: false, problem: 'notInScenario' });
    expect(resolveWhen(at('18:01'), V, ENV)).toEqual({ ok: false, problem: 'notInScenario' });
  });
  it('says "outside" for the last minute and the end, which cannot take a change', () => {
    expect(resolveWhen(at('18:00'), V, ENV)).toEqual({ ok: false, problem: 'outside' });
    expect(resolveWhen(at('17:59:30'), V, ENV)).toEqual({ ok: false, problem: 'outside' });
  });
  it('says "late" before it reads the field when no minute is left', () => {
    expect(resolveWhen(at('garbage'), D - 10, ENV)).toEqual({ ok: false, problem: 'late' });
  });
  it('in a scenario of more than a day, takes the next time the clock reads that, not the nearest', () => {
    const long: WindEnv = { ...ENV, durationS: 30 * 3600 };
    // Viewing 19:00 on Saturday (5 h in): 14:30 came at 30 min, so the next one is on Sunday (24.5 h).
    expect(resolveWhen(at('14:30'), 5 * 3600, long)).toEqual({ ok: true, time: 24.5 * 3600 });
    expect(resolveWhen(at('21:00'), 5 * 3600, long)).toEqual({ ok: true, time: 7 * 3600 });
    expect(resolveWhen(at('09:00'), 5 * 3600, long)).toEqual({ ok: true, time: 19 * 3600 });
  });
  it('reads the clock in the scenario zone across a daylight-saving change, whatever the device zone is', () => {
    // Sydney moves to daylight saving at 02:00 on 2026-10-04. Start 22:00 on the 3rd (AEST, UTC+10), 8 h long.
    const env: WindEnv = { startMs: Date.UTC(2026, 9, 3, 12, 0, 0), tz: TZ, durationS: 8 * 3600 };
    expect(windClock(env, 0)).toBe('22:00');
    expect(windClock(env, 5 * 3600)).toBe('04:00'); // five real hours later is 04:00 AEDT
    expect(resolveWhen(at('04:00'), 0, env)).toEqual({ ok: true, time: 5 * 3600 });
    expect(nextClockTime(4 * 3600, env.startMs, TZ, env.durationS, 0)).toBe(5 * 3600);
  });
});

describe('nextClockTime', () => {
  it('is the first time from `fromS` on, and null when none is left in the scenario', () => {
    expect(nextClockTime(14 * 3600 + 30 * 60, START, TZ, D, 0)).toBe(30 * MIN);
    expect(nextClockTime(14 * 3600 + 30 * 60, START, TZ, D, 30 * MIN)).toBe(30 * MIN);
    expect(nextClockTime(14 * 3600 + 30 * 60, START, TZ, D, 30 * MIN + 1)).toBeNull();
    expect(nextClockTime(3 * 3600, START, TZ, D, 0)).toBeNull();
  });
});

describe('the time field', () => {
  it('opens with the "Now" start plus 10 minutes, kept inside the scenario', () => {
    expect(defaultClock(V, ENV)).toBe('14:51');
    expect(defaultClock(0, ENV)).toBe('14:10');
    expect(defaultClock(D - 300, ENV)).toBe('17:59');
  });
  it('is always a time the field accepts (hh:mm), also in a long scenario', () => {
    expect(defaultClock(V, { ...ENV, durationS: 30 * 3600 })).toBe('14:51');
  });
});

describe('the words for what cannot be done', () => {
  it('has the sentences of the panel', () => {
    expect(problemText('badClock', 'at', V, ENV)).toBe('Enter a time such as 14:35.');
    expect(problemText('notInScenario', 'at', V, ENV)).toBe('That time is not in this scenario (14:00 to 18:00).');
    expect(problemText('past', 'at', V, ENV)).toBe('That time has passed. Choose a time after 14:41.');
    expect(problemText('outside', '60', V, ENV)).toBe('The scenario ends before that time.');
    expect(problemText('late', 'now', V, ENV)).toBe('There is no time left in this scenario for a wind change.');
  });
  it('names the last time that can be chosen when a typed time is in the last minute', () => {
    expect(problemText('outside', 'at', V, ENV)).toBe('The last time you can choose is 17:59.');
  });
  it('shows the day in the range of a scenario of more than 20 h', () => {
    expect(problemText('notInScenario', 'at', 0, { ...ENV, durationS: 30 * 3600 })).toBe('That time is not in this scenario (Sat 14:00 to Sun 20:00).');
  });
});

describe('the status lines and Apply', () => {
  const dirAt = (t: number): number => (t < 50 * MIN ? 315 : 270);
  it('says what the wind is before the change and where the turn starts and ends', () => {
    const v = windView({ when: now, viewTime: V, env: ENV, dir: 225, directionAt: dirAt });
    expect(v.canApply).toBe(true);
    expect(v.message).toBe('');
    expect(v.lines).toEqual(['Before the change: from NW (315°).', 'Starts turning at 14:41 and reaches SW (225°) by 14:56.']);
  });
  it('reads "before" at the change time, so an earlier change counts', () => {
    const v = windView({ when: { choice: '10', clock: '' }, viewTime: V, env: ENV, dir: 180, directionAt: dirAt });
    expect(v.lines).toEqual(['Before the change: from W (270°).', 'Starts turning at 14:51 and reaches S (180°) by 15:06.']);
  });
  it('puts a problem with the field under the field and keeps the first line', () => {
    const v = windView({ when: at(''), viewTime: V, env: ENV, dir: 225, directionAt: dirAt });
    expect(v.canApply).toBe(false);
    expect(v.message).toBe('Enter a time such as 14:35.');
    expect(v.lines).toEqual(['Before the change: from NW (315°).']);
    const p = windView({ when: at('14:20'), viewTime: V, env: ENV, dir: 225, directionAt: dirAt });
    expect(p.message).toBe('That time has passed. Choose a time after 14:41.');
    expect(p.canApply).toBe(false);
  });
  it('puts "no time left" in the status, with Apply off', () => {
    const v = windView({ when: now, viewTime: D - 5, env: ENV, dir: 225, directionAt: dirAt });
    expect(v.canApply).toBe(false);
    expect(v.message).toBe('');
    expect(v.lines).toEqual(['There is no time left in this scenario for a wind change.']);
  });
  it('words the button after the dial', () => {
    expect(applyLabel(225)).toBe('Turn wind to SW');
    expect(applyLabel(0)).toBe('Turn wind to N');
  });
  it('words the note for a person who is viewing an earlier time', () => {
    expect(reviewingText(10 * MIN, ENV)).toBe('You are viewing 14:10. Applying re-runs the simulation from then.');
  });
});

describe('the list of changes', () => {
  const list = [edit('a', 225, 40 * MIN), edit('b', 90, 70 * MIN)];
  it('says where each one is: not started, turning, done', () => {
    expect(windList(list, 30 * MIN, ENV).map((i) => i.text)).toEqual(['Wind from SW · starts 14:40 (in 10 min)', 'Wind from E · starts 15:10 (in 40 min)']);
    expect(windList(list, 45 * MIN, ENV).map((i) => i.text)).toEqual(['Wind from SW · turning, done by 14:55', 'Wind from E · starts 15:10 (in 25 min)']);
    expect(windList(list, 56 * MIN, ENV).map((i) => i.text)).toEqual(['Wind from SW · done at 14:55', 'Wind from E · starts 15:10 (in 14 min)']);
    expect(windList(list, 2 * 3600, ENV).map((i) => i.text)).toEqual(['Wind from SW · done at 14:55', 'Wind from E · done at 15:25']);
  });
  it('goes back to "starts" when the view moves back before the change', () => {
    expect(windList([list[0]!], 2 * 3600, ENV)[0]!.text).toContain('done at');
    expect(windList([list[0]!], 0, ENV)[0]!.text).toBe('Wind from SW · starts 14:40 (in 40 min)');
  });
  it('says "now" for a change that starts within a minute', () => {
    expect(windList([list[0]!], 40 * MIN - 20, ENV)[0]!.text).toBe('Wind from SW · starts 14:40 (now)');
  });
  it('labels each Remove button with the change it removes, and keeps the id', () => {
    const items = windList(list, 0, ENV);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(items[0]!.removeLabel).toBe('Remove the wind change to SW at 14:40');
    expect(items[1]!.removeLabel).toBe('Remove the wind change to E at 15:10');
  });
  it('is empty with no changes', () => {
    expect(windList([], 0, ENV)).toEqual([]);
  });
});

describe('the announcements', () => {
  it('say what was set and when it is done', () => {
    expect(applyAnnouncement({ dir: 225, time: 40 * MIN }, ENV)).toBe('Wind direction change set. The wind turns to come from SW, starting at 14:40 and done by 14:55.');
  });
  it('say a removal, and the re-run only when the simulation had computed past the change', () => {
    expect(removeAnnouncement({ time: 40 * MIN }, 50 * MIN, ENV)).toBe('Wind change removed. The simulation re-runs from 14:40 without it.');
    expect(removeAnnouncement({ time: 40 * MIN }, 40 * MIN, ENV)).toBe('Wind change removed.');
    expect(removeAnnouncement({ time: 40 * MIN }, 10 * MIN, ENV)).toBe('Wind change removed.');
  });
});

describe('the dial', () => {
  it('starts at the direction now, to the nearest 5 degrees, and stays inside [0, 360)', () => {
    expect(dialStart(227.4)).toBe(225);
    expect(dialStart(227.6)).toBe(230);
    expect(dialStart(358)).toBe(0);
    expect(dialStart(359.9)).toBe(0);
    expect(dialStart(2.4)).toBe(0);
    expect(dialStart(0)).toBe(0);
  });
  it('gives way on a short window', () => {
    expect(dialSize(915)).toBe(184);
    expect(dialSize(800)).toBe(184);
    expect(dialSize(799)).toBe(148);
    expect(dialSize(640)).toBe(148);
    expect(dialSize(560)).toBe(148);
    expect(dialSize(559)).toBe(120);
    expect(dialSize(390)).toBe(120);
  });
});

describe('the fixed words', () => {
  it('are the ones the contract names', () => {
    expect(WIND_HINT).toBe("Choose where the wind comes from. It turns over 15 minutes and then holds that direction, so the forecast's later wind changes no longer apply. Wind speed stays as forecast.");
    expect(DIAL_LABEL).toBe('Wind comes from. Drag the arrow, or use the arrow keys.');
  });
});
