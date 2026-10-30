import { describe, expect, it } from 'vitest';
import type { WindDirectionEdit, WindEdit } from '../../../core/types';
import { windDirectionTime } from '../../../scenario/windDirection';
import {
  BACK_TO_FORECAST_HINT,
  BACK_TO_FORECAST_LABEL,
  DIAL_LABEL,
  READINGS_NOTE,
  READINGS_TITLE,
  WHEN_OPTIONS,
  WIND_HINT,
  applyAnnouncement,
  applyLabel,
  backToForecastAnnouncement,
  defaultClock,
  dialSize,
  dialStart,
  holdsDirection,
  nextClockTime,
  problemText,
  readingPlace,
  removeAnnouncement,
  removeReadingAnnouncement,
  resolveWhen,
  reviewingText,
  windClock,
  windList,
  windReadingEdits,
  windReadings,
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
  it('has a one-line plan for the bar over Apply: where the turn starts and ends, nothing when there is no valid time', () => {
    // On a small portrait phone the body scrolls and the long sentence is under the fold: this line sits over the button instead.
    expect(windView({ when: now, viewTime: V, env: ENV, dir: 225, directionAt: dirAt }).plan).toBe('Starts turning at 14:41, done by 14:56.');
    expect(windView({ when: { choice: '10', clock: '' }, viewTime: V, env: ENV, dir: 180, directionAt: dirAt }).plan).toBe('Starts turning at 14:51, done by 15:06.');
    expect(windView({ when: at(''), viewTime: V, env: ENV, dir: 225, directionAt: dirAt }).plan).toBe('');
    expect(windView({ when: now, viewTime: D - 5, env: ENV, dir: 225, directionAt: dirAt }).plan).toBe('');
    expect(windView({ when: now, viewTime: V, env: { ...ENV, durationS: 30 * 3600 }, dir: 225, directionAt: dirAt }).plan).toBe('Starts turning at Sat 14:41, done by Sat 14:56.');
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
  it('puts a preset that starts after the last minute under the choices, with Apply off', () => {
    const v = windView({ when: { choice: '60', clock: '' }, viewTime: 3 * 3600 + 30 * MIN, env: ENV, dir: 225, directionAt: dirAt });
    expect(v.canApply).toBe(false);
    expect(v.message).toBe('The scenario ends before that time.');
    expect(v.lines).toEqual(['Before the change: from W (270°).']);
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
    expect(applyLabel(0, false)).toBe('Turn wind to N');
    expect(applyLabel(315, true)).toBe('Hold wind from NW');
  });
  it('turns for a dial that has been moved: the label, the status and the plan are the turn\'s', () => {
    const v = windView({ when: now, viewTime: V, env: ENV, dir: 225, directionAt: dirAt });
    expect(v.holds).toBe(false);
    expect(v.label).toBe('Turn wind to SW');
  });
  it('holds for a dial left on the wind: "Hold wind from NW", and the status says it holds and what that does to the forecast', () => {
    // The dial opens on the wind to the nearest 5 degrees (dialStart): the wind is 318 degrees, the dial 320.
    const near = (t: number): number => (t < 50 * MIN ? 318 : 270);
    const v = windView({ when: now, viewTime: V, env: ENV, dir: dialStart(318), directionAt: near });
    expect(dialStart(318)).toBe(320);
    expect(v.holds).toBe(true);
    expect(v.canApply).toBe(true);
    expect(v.label).toBe('Hold wind from NW');
    expect(v.lines).toEqual(['Before the change: from NW (318°).', "Holds NW (320°) from 14:41. The forecast's later wind changes no longer apply."]);
    expect(v.plan).toBe('Holds NW (320°) from 14:41.');
  });
  it('holds exactly when the dial is within half a dial step of the direction in force at the start, not before it', () => {
    expect(holdsDirection(315, 315)).toBe(true);
    expect(holdsDirection(315, 317.5)).toBe(true);
    expect(holdsDirection(315, 312.5)).toBe(true);
    expect(holdsDirection(315, 317.6)).toBe(false);
    expect(holdsDirection(315, 310)).toBe(false);
    // Across north.
    expect(holdsDirection(0, 358)).toBe(true);
    expect(holdsDirection(355, 2)).toBe(false);
    // The direction in force at the START of the change is what counts: the wind is NW now and W when this one starts.
    const early = windView({ when: now, viewTime: V, env: ENV, dir: 315, directionAt: dirAt });
    expect(early.holds).toBe(true);
    const later = windView({ when: { choice: '30', clock: '' }, viewTime: V, env: ENV, dir: 315, directionAt: dirAt });
    expect(later.holds).toBe(false);
    expect(later.label).toBe('Turn wind to NW');
    expect(later.lines[0]).toBe('Before the change: from W (270°).');
  });
  it('a hold in a scenario of more than 20 h names the day, like a turn', () => {
    const v = windView({ when: now, viewTime: V, env: { ...ENV, durationS: 30 * 3600 }, dir: 315, directionAt: dirAt });
    expect(v.plan).toBe('Holds NW (315°) from Sat 14:41.');
  });
  it('keeps the label of the wind now while the time is not valid, so it does not change its words when the time is put right', () => {
    const v = windView({ when: at(''), viewTime: V, env: ENV, dir: 315, directionAt: dirAt });
    expect(v.canApply).toBe(false);
    expect(v.label).toBe('Hold wind from NW');
    expect(v.plan).toBe('');
    const late = windView({ when: now, viewTime: D - 5, env: ENV, dir: 225, directionAt: dirAt });
    expect(late.label).toBe('Turn wind to SW');
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

describe('the local wind readings', () => {
  // The middle of the map is at (4000, 3000) m; a reading of the belt kit: 1000 m radius, from E (84 degrees).
  const centre = { x: 4000, y: 3000 };
  const env: WindEnv = { ...ENV, centre };
  const reading = (over: Partial<WindEdit> = {}): WindEdit => ({ kind: 'wind', id: 'belt-kit-1', x: 4000, y: 3000, radius: 1000, speed: 5, dir: 84, time: 0, ...over });

  it('says where it is, which way it comes from, how far it reaches and where it came from', () => {
    expect(windReadings([reading()], 0, env).map((i) => i.text)).toEqual(['Wind reading near the middle: from E, within 1 km (from the belt kit)']);
  });
  it('names a reading that is away from the middle by distance and compass point (x east, y north)', () => {
    expect(readingPlace(reading({ x: 4000, y: 5100 }), centre)).toBe('2.1 km N of the middle');
    expect(readingPlace(reading({ x: 6000, y: 3000 }), centre)).toBe('2 km E of the middle');
    expect(readingPlace(reading({ x: 3000, y: 2000 }), centre)).toBe('1.4 km SW of the middle');
    expect(readingPlace(reading({ x: 4000, y: 2000 }), centre)).toBe('1 km S of the middle');
    expect(readingPlace(reading({ x: 4200, y: 3100 }), centre)).toBe('near the middle');
    expect(windReadings([reading({ x: 3000, y: 2000, radius: 500 })], 0, env)[0]!.text).toBe('Wind reading 1.4 km SW of the middle: from E, within 500 m (from the belt kit)');
  });
  it('does not say where without the middle of the map, and does not claim the belt kit for a reading that is not from it', () => {
    expect(windReadings([reading({ id: 'wind-7' })], 0, ENV).map((i) => i.text)).toEqual(['Wind reading on the map: from E, within 1 km']);
  });
  it('says when a reading starts only while it has not started', () => {
    expect(windReadings([reading({ time: 40 * MIN })], 30 * MIN, env)[0]!.text).toBe('Wind reading near the middle: from E, within 1 km, starts 14:40 (from the belt kit)');
    expect(windReadings([reading({ time: 40 * MIN })], 40 * MIN, env)[0]!.text).toBe('Wind reading near the middle: from E, within 1 km (from the belt kit)');
    expect(windReadings([reading({ time: 0 })], 0, env)[0]!.text).not.toContain('starts');
  });
  it('labels each Remove button with the reading it removes, and keeps the id, in list order', () => {
    const items = windReadings([reading({ id: 'belt-kit-1' }), reading({ id: 'belt-kit-2', x: 6000, y: 3000, dir: 270 })], 0, env);
    expect(items.map((i) => i.id)).toEqual(['belt-kit-1', 'belt-kit-2']);
    expect(items[0]!.removeLabel).toBe('Remove the wind reading near the middle, from E');
    expect(items[1]!.removeLabel).toBe('Remove the wind reading 2 km E of the middle, from W');
  });
  it('is empty with no readings', () => {
    expect(windReadings([], 0, env)).toEqual([]);
  });
  it('picks the readings (kind wind) out of the session edits, in list order, and nothing else', () => {
    const a = reading({ id: 'a' });
    const b = reading({ id: 'b' });
    const fuel = { kind: 'fuel' as const, id: 'f', shape: { kind: 'circle' as const, x: 0, y: 0, radius: 100 }, surfaceHazardDelta: 1 };
    const out = windReadingEdits([{ edit: a }, { edit: fuel }, { edit: edit('w', 225, 600) }, { edit: b }]);
    expect(out).toEqual([a, b]);
    expect(out[0]).toBe(a);
    expect(windReadingEdits([])).toEqual([]);
  });
  it('has the words of the section: a title, and a note that a reading keeps its own direction', () => {
    expect(READINGS_TITLE).toBe('Wind readings');
    expect(READINGS_NOTE).toBe('A reading keeps its own direction when you turn the wind.');
    expect(removeReadingAnnouncement).toBe('Wind reading removed.');
  });
});

describe('the announcements', () => {
  it('say what was set and when it is done', () => {
    expect(applyAnnouncement({ dir: 225, time: 40 * MIN }, ENV)).toBe('Wind direction change set. The wind turns to come from SW, starting at 14:40 and done by 14:55.');
  });
  it('say a hold in its own words: the wind is held, nothing turns', () => {
    expect(applyAnnouncement({ dir: 315, time: 40 * MIN }, ENV, true)).toBe('Wind direction change set. The wind is held from NW, starting at 14:40.');
    expect(applyAnnouncement({ dir: 315, time: 40 * MIN }, ENV, false)).toBe('Wind direction change set. The wind turns to come from NW, starting at 14:40 and done by 14:55.');
  });
  it('say a removal, and the re-run only when the simulation had computed past the change', () => {
    expect(removeAnnouncement({ time: 40 * MIN }, 50 * MIN, ENV)).toBe('Wind change removed. The simulation re-runs from 14:40 without it.');
    expect(removeAnnouncement({ time: 40 * MIN }, 40 * MIN, ENV)).toBe('Wind change removed.');
    expect(removeAnnouncement({ time: 40 * MIN }, 10 * MIN, ENV)).toBe('Wind change removed.');
  });
});

describe('Back to the forecast (0.7.0)', () => {
  it('has its words: the label, and a sentence that says it takes away every change as if never made and that the run is computed again from the first', () => {
    expect(BACK_TO_FORECAST_LABEL).toBe('Back to the forecast');
    expect(BACK_TO_FORECAST_HINT).toBe('Back to the forecast takes away every wind change you made, as if you had never made them. The simulation is computed again from the first one.');
    for (const w of [BACK_TO_FORECAST_LABEL, BACK_TO_FORECAST_HINT]) expect(w).not.toMatch(/—|–/); // no dashes: the repo's voice
  });
  it('announces how many changes came away: two, one', () => {
    expect(backToForecastAnnouncement(2, 40 * MIN, 30 * MIN, ENV)).toBe('Back to the forecast. 2 wind changes removed.');
    expect(backToForecastAnnouncement(1, 40 * MIN, 30 * MIN, ENV)).toBe('Back to the forecast. 1 wind change removed.');
  });
  it('says the simulation re-runs from the first start only when it had computed past it', () => {
    expect(backToForecastAnnouncement(2, 40 * MIN, 50 * MIN, ENV)).toBe('Back to the forecast. 2 wind changes removed. The simulation re-runs from 14:40 without them.');
    expect(backToForecastAnnouncement(1, 40 * MIN, 50 * MIN, ENV)).toBe('Back to the forecast. 1 wind change removed. The simulation re-runs from 14:40 without it.');
    expect(backToForecastAnnouncement(2, 40 * MIN, 40 * MIN, ENV)).toBe('Back to the forecast. 2 wind changes removed.'); // the head is at the start: nothing is computed again
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
    expect(dialSize(700)).toBe(148);
    // A small portrait phone (360 x 640) also shows the plan line over Apply: the dial gives that line its room.
    expect(dialSize(699)).toBe(140);
    expect(dialSize(640)).toBe(140);
    expect(dialSize(560)).toBe(140);
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
