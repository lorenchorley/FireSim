import { describe, expect, it } from 'vitest';
import { tzOffsetHours } from '../../format';
import {
  BIG_STEP_S,
  clockShowsSeconds,
  clockToSimTime,
  cardMarks,
  dragMove,
  dragStart,
  edgeLabels,
  fineFactor,
  keyboardTarget,
  nearestCardTime,
  offsetSeconds,
  parseTimeOfDay,
  pxToTime,
  repeatStepS,
  seekPercent,
  seekReached,
  snapFor,
  snapTime,
  tickPlan,
  timeTicks,
  timeToFraction,
  timeToPx,
} from './timelineModel';

const D = 43200; // 12 h
const TZ = 'Australia/Sydney';
// 2026-10-10 11:20 Sydney (AEDT, UTC+11)
const START = Date.UTC(2026, 9, 10, 0, 20, 0);

describe('pixel ⇄ time', () => {
  it('maps the whole track onto the whole scenario', () => {
    expect(pxToTime(16, 16, 300, D)).toBe(0);
    expect(pxToTime(316, 16, 300, D)).toBe(D);
    expect(pxToTime(166, 16, 300, D)).toBe(D / 2);
  });
  it('clamps a pointer outside the track', () => {
    expect(pxToTime(-50, 16, 300, D)).toBe(0);
    expect(pxToTime(999, 16, 300, D)).toBe(D);
    expect(pxToTime(10, 16, 0, D)).toBe(0);
  });
  it('is invertible', () => {
    for (const t of [0, 1, 600, 21600, D]) expect(pxToTime(timeToPx(t, 300, D) + 16, 16, 300, D)).toBeCloseTo(t, 6);
    expect(timeToFraction(D / 4, D)).toBe(0.25);
    expect(timeToFraction(-5, D)).toBe(0);
    expect(timeToFraction(5, 0)).toBe(0);
  });
});

describe('snapping', () => {
  it('rounds to the grid and keeps the end reachable', () => {
    expect(snapTime(3629, 60, D)).toBe(3600);
    expect(snapTime(3631, 60, D)).toBe(3660);
    expect(snapTime(D - 20, 60, D)).toBe(D);
    expect(snapTime(-5, 60, D)).toBe(0);
    expect(snapTime(1234.5, 0, D)).toBe(1234.5);
    expect(snapTime(D - 20, 60, D + 10)).toBe(D + 10); // a duration that is not a multiple of the grid
  });
  it('snaps to the display step but never coarser than a minute, and finer under fine control', () => {
    expect(snapFor(10)).toBe(10);
    expect(snapFor(60)).toBe(60);
    expect(snapFor(600)).toBe(60);
    expect(snapFor(60, 0.25)).toBe(10);
    expect(snapFor(10, 0.25)).toBe(10);
    expect(snapFor(5, 0.5)).toBe(5);
  });
});

describe('dragging with fine control', () => {
  const W = 300;
  it('a tap puts the thumb under the finger', () => {
    const st = dragStart(166, 16, W, D, 60);
    expect(st.t).toBe(D / 2);
    expect(st.factor).toBe(1);
  });
  it('follows the finger along the track', () => {
    let st = dragStart(16, 16, W, D, 60);
    st = dragMove(st, 166, 0, W, D, 60);
    expect(st.t).toBe(D / 2);
    st = dragMove(st, 316, 5, W, D, 60);
    expect(st.t).toBe(D);
    st = dragMove(st, 900, 5, W, D, 60);
    expect(st.t).toBe(D);
  });
  it('moves slower the further the finger is from the track, without the thumb jumping', () => {
    expect([0, 43, 44, 89, 90, 149, 150, 400].map(fineFactor)).toEqual([1, 1, 0.5, 0.5, 0.25, 0.25, 0.1, 0.1]);
    let st = dragStart(166, 16, W, D, 60); // 6 h
    st = dragMove(st, 166, 100, W, D, 60); // finger up: factor 0.25, thumb stays
    expect(st.factor).toBe(0.25);
    expect(st.t).toBe(D / 2);
    st = dragMove(st, 176, 100, W, D, 60); // 10 px = 1440 s at full speed, a quarter of that
    expect(st.t).toBe(D / 2 + 360);
    st = dragMove(st, 176, 0, W, D, 60); // back on the track: full speed from here
    expect(st.factor).toBe(1);
    expect(st.t).toBe(D / 2 + 360);
    st = dragMove(st, 186, 0, W, D, 60);
    expect(st.t).toBe(D / 2 + 360 + 1440);
  });
});

describe('keyboard', () => {
  it('steps by the display step, or 10 min with Shift / Page keys', () => {
    expect(keyboardTarget('ArrowRight', false, 1000, 60, D)).toBe(1060);
    expect(keyboardTarget('ArrowUp', false, 1000, 60, D)).toBe(1060);
    expect(keyboardTarget('ArrowLeft', false, 1000, 30, D)).toBe(970);
    expect(keyboardTarget('ArrowDown', false, 1000, 30, D)).toBe(970);
    expect(keyboardTarget('ArrowRight', true, 1000, 60, D)).toBe(1000 + BIG_STEP_S);
    expect(keyboardTarget('ArrowLeft', true, 1000, 60, D)).toBe(400);
    expect(keyboardTarget('PageUp', false, 1000, 60, D)).toBe(1600);
    expect(keyboardTarget('PageDown', false, 1000, 60, D)).toBe(400);
  });
  it('goes to the ends with Home / End and clamps', () => {
    expect(keyboardTarget('Home', false, 1000, 60, D)).toBe(0);
    expect(keyboardTarget('End', false, 1000, 60, D)).toBe(D);
    expect(keyboardTarget('ArrowLeft', false, 30, 60, D)).toBe(0);
    expect(keyboardTarget('PageUp', false, D - 5, 60, D)).toBe(D);
  });
  it('ignores other keys', () => {
    expect(keyboardTarget('a', false, 1000, 60, D)).toBeNull();
    expect(keyboardTarget('Tab', true, 1000, 60, D)).toBeNull();
  });
  it('speeds up a held step button', () => {
    expect([0, 7, 8, 19, 20, 100].map((n) => repeatStepS(60, n))).toEqual([60, 60, 300, 300, 1200, 1200]);
    expect(repeatStepS(600, 50)).toBe(3600);
  });
});

describe('adaptive ticks', () => {
  it('labels the sparser the narrower the track', () => {
    expect(tickPlan(D, 300).labelS).toBe(10800); // 12 h over 300 px: 3 h apart is 75 px
    expect(tickPlan(D, 900).labelS).toBe(3600);
    expect(tickPlan(D, 2000).labelS).toBe(1800);
    expect(tickPlan(3600, 300).labelS).toBe(900);
    expect(tickPlan(86400 * 3, 200).labelS).toBe(86400);
  });
  it('keeps the labels at least minLabelPx apart', () => {
    for (const [dur, w] of [[D, 220], [7200, 260], [21600, 320], [86400, 240]] as const) {
      const plan = tickPlan(dur, w, 56);
      expect((plan.labelS / dur) * w).toBeGreaterThanOrEqual(56);
    }
  });
  it('adds unlabelled ticks between labels only when they are at least 6 px apart', () => {
    expect(tickPlan(D, 900).minorS).toBe(1800); // labels hourly, minor half-hourly (37 px apart)
    expect(tickPlan(D, 300).minorS).toBe(3600); // 7200 does not divide the 3 h label spacing
    expect(tickPlan(60, 300).minorS).toBeNull();
  });
  it('places ticks on the local clock, not on elapsed time', () => {
    const off = offsetSeconds(tzOffsetHours(START, TZ));
    expect(off).toBe(11 * 3600);
    const { ticks, plan } = timeTicks({ startMs: START, durationS: D, utcOffsetS: off, widthPx: 900 });
    expect(plan.labelS).toBe(3600);
    // starts 11:20 → the first half-hour mark 11:30 is 10 min in, the first hour 12:00 is 40 min in
    expect(ticks[0]).toEqual({ t: 600, major: false });
    const majors = ticks.filter((t) => t.major).map((t) => t.t);
    expect(majors[0]).toBe(2400);
    expect(majors[1]).toBe(2400 + 3600);
    expect(majors.length).toBe(12); // 12:00 … 23:00
    expect(ticks.at(-1)!.t).toBeLessThanOrEqual(D);
  });
  it('labels the start and the end when no other label is near', () => {
    expect(edgeLabels([40, 200], 300)).toEqual({ start: false, end: true });
    expect(edgeLabels([100, 250], 300)).toEqual({ start: true, end: false });
    expect(edgeLabels([100, 200], 300)).toEqual({ start: true, end: true });
  });
});

describe('card marks', () => {
  it('keeps one mark per few pixels, the most severe', () => {
    const cards = [
      { time: 100, severity: 'watch' },
      { time: 130, severity: 'danger' }, // same 5 px bucket as the first on a 300 px / 12 h track
      { time: 20000, severity: 'watch' },
      { time: 20100, severity: 'info' },
    ];
    const marks = cardMarks(cards, D, 300);
    expect(marks.map((m) => m.severity)).toEqual(['danger', 'watch']);
    expect(marks[0]!.frac).toBeCloseTo(100 / D, 9);
    expect(marks).toHaveLength(2);
  });
  it('shows every card when the track is wide', () => {
    const cards = [600, 1200, 1800].map((time) => ({ time, severity: 'watch' }));
    expect(cardMarks(cards, D, 3000)).toHaveLength(3);
    expect(cardMarks([], D, 300)).toEqual([]);
  });
});

describe('fast-forward bar', () => {
  it('reports the reached time and percentage', () => {
    expect(seekReached(1000, 3000, 0.25)).toBe(1500);
    expect(seekReached(1000, 3000, 2)).toBe(3000);
    expect(seekReached(1000, 3000, -1)).toBe(1000);
    expect(seekPercent(0.456)).toBe(46);
    expect(seekPercent(1.4)).toBe(100);
  });
});

describe('typed clock times', () => {
  it('parses hh:mm and hh:mm:ss', () => {
    expect(parseTimeOfDay('14:35')).toBe(14 * 3600 + 35 * 60);
    expect(parseTimeOfDay('14:35:07')).toBe(14 * 3600 + 35 * 60 + 7);
    expect(parseTimeOfDay('7:05')).toBe(7 * 3600 + 300);
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('12:60')).toBeNull();
    expect(parseTimeOfDay('noon')).toBeNull();
    expect(parseTimeOfDay('')).toBeNull();
  });
  it('turns a wall-clock time into simulation time', () => {
    // scenario 11:20 → 23:20 local
    expect(clockToSimTime(12 * 3600, START, TZ, D)).toBe(2400);
    expect(clockToSimTime(11 * 3600 + 20 * 60, START, TZ, D)).toBe(0);
    expect(clockToSimTime(23 * 3600 + 20 * 60, START, TZ, D)).toBe(D);
    expect(clockToSimTime(12 * 3600 + 30, START, TZ, D)).toBe(2430);
  });
  it('is null outside the scenario', () => {
    expect(clockToSimTime(10 * 3600, START, TZ, D)).toBeNull(); // before the start, next day is after the end
    expect(clockToSimTime(23 * 3600 + 30 * 60, START, TZ, D)).toBeNull();
  });
  it('finds the time after midnight in a scenario that crosses it', () => {
    const long = 24 * 3600; // 11:20 → 11:20 next day
    expect(clockToSimTime(1 * 3600, START, TZ, long)).toBe(13 * 3600 + 40 * 60); // 01:00 next day
  });
  it('picks the occurrence nearest the view time when the scenario shows a time of day twice', () => {
    const two = 40 * 3600; // 11:20 → 03:20 the day after next
    const a = clockToSimTime(12 * 3600, START, TZ, two, 0);
    const b = clockToSimTime(12 * 3600, START, TZ, two, 30 * 3600);
    expect(a).toBe(2400);
    expect(b).toBe(2400 + 86400);
  });
});

describe('previous / next card', () => {
  const cards = [
    { time: 600, severity: 'watch' },
    { time: 1200, severity: 'info' },
    { time: 1800, severity: 'danger' },
    { time: 3000, severity: 'watch' },
  ];
  it('finds the nearest card on each side and ignores info cards', () => {
    expect(nearestCardTime(cards, 2000, -1)).toBe(1800);
    expect(nearestCardTime(cards, 2000, 1)).toBe(3000);
    expect(nearestCardTime(cards, 1000, -1)).toBe(600);
    expect(nearestCardTime(cards, 1000, 1)).toBe(1800);
  });
  it('excludes the card the view is on', () => {
    expect(nearestCardTime(cards, 1800, -1)).toBe(600);
    expect(nearestCardTime(cards, 1800, 1)).toBe(3000);
    expect(nearestCardTime(cards, 1800.5, -1)).toBe(600);
  });
  it('is null at the ends', () => {
    expect(nearestCardTime(cards, 500, -1)).toBeNull();
    expect(nearestCardTime(cards, 3000, 1)).toBeNull();
    expect(nearestCardTime([], 100, 1)).toBeNull();
  });
});

describe('clock format', () => {
  it('shows seconds for fine display steps or slow playback', () => {
    expect(clockShowsSeconds(60, 60)).toBe(false);
    expect(clockShowsSeconds(60, 31)).toBe(false);
    expect(clockShowsSeconds(60, 30)).toBe(true);
    expect(clockShowsSeconds(60, 1)).toBe(true);
    expect(clockShowsSeconds(30, 600)).toBe(true);
    expect(clockShowsSeconds(10, Infinity)).toBe(true);
    expect(clockShowsSeconds(120, Infinity)).toBe(false);
  });
});
