/**
 * Wind direction (0.6.0): `windDirection.ts` (contract D-CONTRACT-060-wind, sections 2 and 7.1): the small helpers and the
 * series transform (`planSwings`, `windDirectionAt`, `applyWindDirection`) on a flat 270 degree, 10 m/s forecast.
 */
import { describe, expect, it } from 'vitest';
import type { FuelEdit, ScenarioEdit, WeatherHour, WeatherSeries, WindDirectionEdit, WindEdit } from '../core/types';
import { angleDiffDeg } from '../core/units';
import { weatherAt } from './weather';
import {
  applyWindDirection,
  forecastSwingNotice,
  forecastSwingsKept,
  planSwings,
  turnDirection,
  turnFraction,
  windChangePhase,
  windDirectionAt,
  windDirectionEdits,
  windDirectionTime,
  windOverrideFrom,
  WIND_TURN_S,
  WIND_TURN_STEP_DEG,
} from './windDirection';

const change = (id: string, dir: number, time: number): WindDirectionEdit => ({ kind: 'windDirection', id, dir, time });

describe('windDirectionTime', () => {
  it('rounds up to a whole minute', () => {
    expect(windDirectionTime(0.1, 3600)).toBe(60);
    expect(windDirectionTime(60, 3600)).toBe(60);
    expect(windDirectionTime(61, 3600)).toBe(120);
  });
  it('is at most the last whole minute at or before the end minus a minute', () => {
    expect(windDirectionTime(3599, 3600)).toBe(3540);
    expect(windDirectionTime(3540, 3600)).toBe(3540);
    expect(windDirectionTime(3600, 3630)).toBe(3540);
  });
  it('gives 0 for NaN, a negative time, or a scenario that ends within a minute', () => {
    expect(windDirectionTime(NaN, 3600)).toBe(0);
    expect(windDirectionTime(-5, 3600)).toBe(0);
    expect(windDirectionTime(0, 3600)).toBe(0);
    expect(windDirectionTime(100, 30)).toBe(0);
  });
});

describe('turnFraction and turnDirection', () => {
  it('turnFraction is 0 before the change, 0.5 half way and 1 when done', () => {
    expect(turnFraction(-1)).toBe(0);
    expect(turnFraction(0)).toBe(0);
    expect(turnFraction(WIND_TURN_S / 2)).toBeCloseTo(0.5, 12);
    expect(turnFraction(WIND_TURN_S)).toBe(1);
    expect(turnFraction(WIND_TURN_S * 4)).toBe(1);
  });
  it('turnDirection goes the short way round and a half turn goes clockwise', () => {
    expect(turnDirection(270, 180, 0.5)).toBeCloseTo(225, 9);
    expect(turnDirection(350, 10, 0.5)).toBeCloseTo(0, 9);
    expect(turnDirection(0, 180, 0.5)).toBeCloseTo(90, 9);
    expect(turnDirection(180, 0, 0.5)).toBeCloseTo(270, 9);
    expect(turnDirection(270, 180, 0)).toBeCloseTo(270, 9);
    expect(turnDirection(270, 180, 1)).toBeCloseTo(180, 9);
  });
});

describe('windChangePhase', () => {
  const e = { time: 600 };
  it('is scheduled before the time, turning for 15 minutes from it, and done after', () => {
    expect(windChangePhase(e, 0)).toBe('scheduled');
    expect(windChangePhase(e, 599.9)).toBe('scheduled');
    expect(windChangePhase(e, 600)).toBe('turning');
    expect(windChangePhase(e, 600 + WIND_TURN_S - 0.1)).toBe('turning');
    expect(windChangePhase(e, 600 + WIND_TURN_S)).toBe('done');
    expect(windChangePhase(e, 36000)).toBe('done');
  });
  it('is scheduled again when the view goes back before the time', () => {
    expect(windChangePhase(e, 1800)).toBe('done');
    expect(windChangePhase(e, 540)).toBe('scheduled');
  });
  it('takes a whole edit as well as a bare time', () => {
    expect(windChangePhase(change('a', 90, 0), 0)).toBe('turning');
    expect(windChangePhase(change('a', 90, 0), WIND_TURN_S)).toBe('done');
  });
});

describe('windDirectionEdits', () => {
  const fuel: FuelEdit = { kind: 'fuel', id: 'f', shape: { kind: 'circle', x: 0, y: 0, radius: 100 }, surfaceHazardDelta: 1 };
  const local: WindEdit = { kind: 'wind', id: 'w', x: 0, y: 0, radius: 500, speed: 5, dir: 90, time: 0 };

  it('is empty for an empty list and for a list without a Wind direction change', () => {
    expect(windDirectionEdits([])).toEqual([]);
    expect(windDirectionEdits([{ edit: fuel }, { edit: local }])).toEqual([]);
  });
  it('keeps only the Wind direction changes, as the same objects', () => {
    const a = change('a', 180, 600);
    const list: { edit: ScenarioEdit }[] = [{ edit: fuel }, { edit: a }, { edit: local }];
    const out = windDirectionEdits(list);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(a);
  });
  it('sorts by time and keeps the list order for equal times', () => {
    const a = change('a', 10, 900);
    const b = change('b', 20, 300);
    const c = change('c', 30, 900);
    const d = change('d', 40, 300);
    const out = windDirectionEdits([{ edit: a }, { edit: b }, { edit: c }, { edit: d }]);
    expect(out.map((x) => x.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('does not reorder or change the list it is given', () => {
    const list = [{ edit: change('a', 10, 900) }, { edit: change('b', 20, 300) }];
    windDirectionEdits(list);
    expect(list.map((x) => x.edit.id)).toEqual(['a', 'b']);
  });
});

describe('windOverrideFrom and forecastSwingsKept', () => {
  const t0 = Date.UTC(2025, 11, 20, 2);
  // Forecast wind changes at 1 h, 2 h and 3 h after the start (unix ms), as the detectors report them.
  const swings = [1, 2, 3].map((h) => ({ time: t0 + h * 3.6e6, name: `h${h}` }));

  it('windOverrideFrom is null for no change and the earliest start otherwise, whatever the list order', () => {
    expect(windOverrideFrom([])).toBeNull();
    expect(windOverrideFrom([change('a', 90, 7200), change('b', 180, 3600), change('c', 0, 5400)])).toBe(3600);
  });
  it('windOverrideFrom leaves out a change whose time or direction is not a number, as the series transform does', () => {
    expect(windOverrideFrom([change('a', 90, NaN)])).toBeNull();
    expect(windOverrideFrom([change('a', NaN, 600), change('b', 90, 1200)])).toBe(1200);
  });
  it('with no change every forecast swing is kept, as the same array', () => {
    expect(forecastSwingsKept(swings, t0, [])).toBe(swings);
  });
  it('a change replaces the swings from its start on and keeps the ones before it', () => {
    expect(forecastSwingsKept(swings, t0, [change('a', 90, 0)]).map((s) => s.name)).toEqual([]);
    expect(forecastSwingsKept(swings, t0, [change('a', 90, 3600 + 1800)]).map((s) => s.name)).toEqual(['h1']);
    expect(forecastSwingsKept(swings, t0, [change('a', 90, 3 * 3600 + 60)]).map((s) => s.name)).toEqual(['h1', 'h2', 'h3']);
  });
  it('a swing that happens at the very start of a change is replaced by it', () => {
    expect(forecastSwingsKept(swings, t0, [change('a', 90, 7200)]).map((s) => s.name)).toEqual(['h1']);
  });
  it('the first change decides, a later one does not bring a replaced swing back', () => {
    const edits = [change('late', 270, 3 * 3600), change('early', 90, 1800)];
    expect(forecastSwingsKept(swings, t0, edits)).toEqual([]);
  });
  it('forecastSwingNotice: the next swing as before with no change; with a change that replaces it, no swing and one line to say so', () => {
    const now = t0 + 1800 * 1000; // 30 minutes in: the swings at 1 h, 2 h and 3 h are ahead
    const none = forecastSwingNotice(swings, t0, [], now);
    expect(none.next).toBe(swings[0]);
    expect(none.replaced).toBe(false);
    const replaced = forecastSwingNotice(swings, t0, [change('a', 90, 600)], now);
    expect(replaced).toEqual({ next: null, replaced: true });
    // A change after the first swing leaves it as the next one; the later ones are the replaced ones.
    const keeps = forecastSwingNotice(swings, t0, [change('a', 90, 5400)], now);
    expect(keeps.next).toBe(swings[0]);
    expect(keeps.replaced).toBe(false);
    // Past the last swing the card shows nothing, with or without a change: there is nothing to say was replaced.
    const past = t0 + 4 * 3.6e6;
    expect(forecastSwingNotice(swings, t0, [change('a', 90, 600)], past)).toEqual({ next: null, replaced: false });
    expect(forecastSwingNotice(swings, t0, [], past)).toEqual({ next: null, replaced: false });
    // Viewing a time between the swings: the one ahead is replaced, the one behind is not mentioned.
    expect(forecastSwingNotice(swings, t0, [change('a', 90, 7200)], t0 + 2.5 * 3.6e6)).toEqual({ next: null, replaced: true });
    // No swings in the forecast at all.
    expect(forecastSwingNotice([], t0, [change('a', 90, 600)], now)).toEqual({ next: null, replaced: false });
  });
  it('agrees with the series transform: the direction after a replaced swing is the plan, before a kept one it is the forecast', () => {
    const series = flat(270, 10, {});
    // A forecast that swings from 270 to 180 between 1 h and 2 h after the start.
    const swung: WeatherSeries = { ...series, hours: series.hours.map((h) => (h.time >= START + 2 * 3.6e6 ? { ...h, windDir10: 180 } : h)) };
    const turned = applyWindDirection(swung, START, [change('a', 90, 1800)]);
    expect(weatherAt(turned, START + 3 * 3.6e6).windDir10).toBeCloseTo(90, 6);
    expect(weatherAt(swung, START + 3 * 3.6e6).windDir10).toBeCloseTo(180, 6);
    expect(windOverrideFrom([change('a', 90, 1800)])).toBe(1800);
  });
});

// ── the series transform ──

const START = Date.UTC(2025, 11, 20, 2);
const T = 600; // the change time of most tests (s from the start)
const at = (t: number): number => START + t * 1000;

/** Hourly stamps from 72 h before the start to 24 h after, as `syntheticScenario` makes them (speed in m/s). */
function flat(dir = 270, speed = 10, extra: Partial<WeatherHour> = {}): WeatherSeries {
  const hours: WeatherHour[] = [];
  for (let h = -72; h <= 24; h++) hours.push({ time: START + h * 3.6e6, temperature: 32, relativeHumidity: 20, windSpeed10: speed, windDir10: dir, cloudCover: 0, precipitation: 0, ...extra });
  return { kind: 'manual', source: 'synthetic', location: { lat: -33.7, lon: 150.3 }, timezone: 'Australia/Sydney', hours, kbdi: 100, droughtFactor: 9 };
}

describe('windDirectionAt', () => {
  const series = flat();
  const one = [change('a', 180, T)];
  const dirAt = (dt: number): number | null => windDirectionAt(series, START, one, at(T + dt));

  it('is null before the change, the forecast direction at its time and the new one when the turn is done', () => {
    expect(dirAt(-60)).toBeNull();
    expect(dirAt(0)).toBeCloseTo(270, 9);
    expect(dirAt(WIND_TURN_S)).toBe(180);
    expect(dirAt(3 * 3600)).toBe(180);
  });
  it('eases through the turn (smoothstep over 900 s, the short way round)', () => {
    const want: [number, number][] = [[150, 263.3333], [300, 246.6667], [450, 225], [600, 203.3333], [750, 186.6667]];
    for (const [dt, d] of want) expect(dirAt(dt), `T+${dt}`).toBeCloseTo(d, 3);
  });
  it('is null for no change at all', () => {
    expect(windDirectionAt(series, START, [], at(T))).toBeNull();
  });
  it('turns from the forecast direction of that moment when the forecast itself is turning', () => {
    const turning = flat();
    turning.hours = turning.hours.map((h) => (h.time > START ? { ...h, windDir10: 0 } : h)); // 270 at the start, 0 an hour on
    const mid = windDirectionAt(turning, START, [change('a', 90, 1800)], at(1800))!;
    expect(mid).toBeCloseTo(315, 6); // half way from 270 to 0 along the short arc
  });
  it('leaves out a change whose time or direction is not a number', () => {
    expect(windDirectionAt(series, START, [change('a', NaN, T), change('b', 90, NaN)], at(3600))).toBeNull();
    expect(applyWindDirection(series, START, [change('a', NaN, T)])).toBe(series);
  });
});

describe('applyWindDirection', () => {
  const series = flat();
  const one = [change('a', 180, T)];
  const deg = (wx: WeatherSeries, dt: number): number => weatherAt(wx, at(T + dt)).windDir10;

  it('returns the very same series for no change (so every existing result stays bitwise)', () => {
    expect(applyWindDirection(series, START, [])).toBe(series);
  });
  it('does not touch its input and gives the same answer twice', () => {
    const frozen = flat();
    for (const h of frozen.hours) Object.freeze(h);
    Object.freeze(frozen.hours);
    Object.freeze(frozen);
    const before = JSON.stringify(frozen);
    const a = applyWindDirection(frozen, START, one);
    const b = applyWindDirection(frozen, START, one);
    expect(JSON.stringify(frozen)).toBe(before);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).not.toBe(frozen);
  });
  it('keeps the stamps before the change as the same objects and adds stamps for the turn only', () => {
    const wx = applyWindDirection(series, START, one);
    for (const h of series.hours) if (h.time < at(T)) expect(wx.hours.find((x) => x.time === h.time)).toBe(h);
    expect(wx.hours.length).toBe(series.hours.length + 10); // 90 degrees: ceil(1.5 * 90 / 15) = 9 segments, 10 stamps
    expect(wx.hours.map((h) => h.time)).toEqual([...wx.hours.map((h) => h.time)].sort((a, b) => a - b));
    expect(wx.location).toBe(series.location);
    expect(wx.kbdi).toBe(series.kbdi);
  });
  it('adds more stamps for a bigger turn: 0 degrees adds 2, 30 adds 4, 180 adds 19', () => {
    expect(applyWindDirection(series, START, [change('a', 270, T)]).hours.length).toBe(series.hours.length + 2);
    expect(applyWindDirection(series, START, [change('a', 240, T)]).hours.length).toBe(series.hours.length + 4);
    expect(applyWindDirection(series, START, [change('a', 90, T)]).hours.length).toBe(series.hours.length + 19);
  });
  it('reads as the plan: unchanged to T, eased through 15 minutes, then held for ever', () => {
    const wx = applyWindDirection(series, START, one);
    const want: [number, number][] = [[-60, 270], [0, 270], [150, 262.78], [300, 246.67], [450, 225], [600, 203.33], [750, 187.22], [900, 180], [3600, 180]];
    for (const [dt, d] of want) expect(deg(wx, dt), `T+${dt}`).toBeCloseTo(d, 1);
  });
  it('follows the ideal curve to within a degree at 5 s steps, and the speed stays within 1 percent (exact at stamps)', () => {
    const wx = applyWindDirection(series, START, one);
    let worst = 0;
    let slowest = 99;
    for (let dt = -300; dt <= 1200; dt += 5) {
      const ideal = windDirectionAt(series, START, one, at(T + dt));
      const w = weatherAt(wx, at(T + dt));
      if (ideal !== null) worst = Math.max(worst, Math.abs(angleDiffDeg(w.windDir10, ideal)));
      slowest = Math.min(slowest, w.windSpeed10);
    }
    expect(worst).toBeLessThan(1);
    expect(slowest).toBeGreaterThan(9.9);
    for (const h of wx.hours) expect(h.windSpeed10).toBe(10);
  });
  it('keeps every pair of neighbouring stamps within the step after easing, for arcs from 5 to 180 degrees', () => {
    for (const arc of [5, 10, 30, 45, 90, 135, 179, 180]) {
      const wx = applyWindDirection(series, START, [change('a', 270 - arc, T)]);
      for (let i = 1; i < wx.hours.length; i++) {
        const turned = Math.abs(angleDiffDeg(wx.hours[i]!.windDir10, wx.hours[i - 1]!.windDir10));
        expect(turned, `arc ${arc} pair ${i}`).toBeLessThanOrEqual(WIND_TURN_STEP_DEG + 1e-6);
      }
    }
  });
  it('turns the whole column by the same angle and leaves the speeds alone', () => {
    const col = flat(270, 10, {
      windProfile: [{ heightAGL: 80, speed: 12, dir: 280 }],
      pressureLevels: [{ hPa: 850, height: 1500, temperature: 10, relativeHumidity: 40, windSpeed: 15, windDir: 300 }],
    });
    const wx = applyWindDirection(col, START, one);
    const done = wx.hours.find((h) => h.time === at(T + WIND_TURN_S))!;
    expect(done.windDir10).toBe(180);
    expect(done.windProfile![0]!.dir).toBeCloseTo(190, 9);
    expect(done.pressureLevels![0]!.windDir).toBeCloseTo(210, 9);
    expect(done.windProfile![0]!.speed).toBe(12);
    expect(done.pressureLevels![0]!.windSpeed).toBe(15);
    const mid = wx.hours.find((h) => h.time === at(T + 400))!;
    expect(mid.windDir10).toBeCloseTo(232.47, 1);
    expect(mid.windProfile![0]!.dir).toBeCloseTo(242.47, 1);
    // later stamps all hold the new direction and keep the forecast's veer with height
    const last = wx.hours[wx.hours.length - 1]!;
    expect(last.windDir10).toBe(180);
    expect(last.windProfile![0]!.dir).toBeCloseTo(190, 9);
    // the stamps before the change keep their profile untouched
    expect(wx.hours[0]!.windProfile).toBe(col.hours[0]!.windProfile);
  });
  it('replaces the forecast turn that comes after the change: the direction holds', () => {
    const veer = flat();
    veer.hours = veer.hours.map((h) => (h.time >= at(7200) ? { ...h, windDir10: 0 } : h)); // the forecast swings to 0 at +2 h
    expect(weatherAt(veer, at(10800)).windDir10).toBeCloseTo(0, 6);
    expect(deg(applyWindDirection(veer, START, one), 3 * 3600 - T)).toBeCloseTo(180, 6);
  });
  it('takes the other fields of the stamps it adds from the forecast', () => {
    const cool = flat(270, 10, { windGust10: 15 });
    cool.hours = cool.hours.map((h, i) => ({ ...h, temperature: 20 + i * 0.01 }));
    const wx = applyWindDirection(cool, START, one);
    const w = weatherAt(wx, at(T + 300));
    const f = weatherAt(cool, at(T + 300));
    expect(w.temperature).toBeCloseTo(f.temperature, 9);
    expect(w.windGust10).toBeCloseTo(15, 9);
  });
  it('is the same with the changes in any order of the list', () => {
    const a = change('a', 180, 600);
    const b = change('b', 90, 900);
    expect(JSON.stringify(applyWindDirection(series, START, [b, a]))).toBe(JSON.stringify(applyWindDirection(series, START, [a, b])));
  });
});

describe('several changes', () => {
  const series = flat();
  const two = [change('a', 180, 600), change('b', 90, 900)];

  it('a later change cuts a swing that is still turning and starts from the value reached', () => {
    const wx = applyWindDirection(series, START, two);
    const want: [number, number][] = [[600, 270], [750, 262.78], [900, 246.67], [1050, 234.78], [1500, 130.62], [1800, 90]];
    for (const [t, d] of want) expect(weatherAt(wx, at(t)).windDir10, `t=${t}`).toBeCloseTo(d, 1);
    expect(wx.hours.length).toBe(series.hours.length + 26);
    const swings = planSwings(series, START, two);
    expect(swings).toHaveLength(2);
    expect(swings[1]!.from).toBeCloseTo(246.6667, 3); // the first swing's value at 900 s
    expect(windDirectionAt(series, START, two, at(1050))!).toBeCloseTo(235.06, 1); // the ideal curve; the stamps follow it to a degree
  });
  it('a change after the first turn is done starts from the held direction', () => {
    const list = [change('a', 180, 600), change('b', 0, 3000)];
    expect(planSwings(series, START, list)[1]!.from).toBe(180);
    expect(windDirectionAt(series, START, list, at(3900))).toBe(0);
  });
  it('equal times: the later one in the list wins', () => {
    const wx = applyWindDirection(series, START, [change('a', 180, 600), change('b', 90, 600)]);
    expect(weatherAt(wx, at(5000)).windDir10).toBeCloseTo(90, 9);
    expect(applyWindDirection(series, START, [change('b', 90, 600), change('a', 180, 600)]).hours.at(-1)!.windDir10).toBe(180);
  });
  it('goes the short way across north, and a half turn goes clockwise', () => {
    const wx = applyWindDirection(flat(350), START, [change('a', 10, T)]);
    expect(weatherAt(wx, at(T + 450)).windDir10).toBeCloseTo(0, 1);
    expect(weatherAt(wx, at(T + 900)).windDir10).toBeCloseTo(10, 6);
    const half = applyWindDirection(flat(0), START, [change('a', 180, T)]);
    expect(weatherAt(half, at(T + 450)).windDir10).toBeCloseTo(90, 1);
  });
  it('works on a series with a single stamp', () => {
    const single: WeatherSeries = { ...series, hours: [{ ...series.hours[0]!, time: START }] };
    const wx = applyWindDirection(single, START, [change('a', 180, 0)]);
    expect(wx.hours.length).toBe(10); // the stamp at the change time is the one it has: 9 are added
    expect(wx.hours[0]!.windDir10).toBe(270);
    expect(wx.hours.at(-1)!.windDir10).toBe(180);
    expect(windDirectionAt(single, START, [change('a', 180, 0)], at(450))!).toBeCloseTo(225, 6);
  });
  it('returns the series itself when it has no stamps', () => {
    const empty: WeatherSeries = { ...series, hours: [] };
    expect(applyWindDirection(empty, START, [change('a', 180, 0)])).toBe(empty);
  });
});
