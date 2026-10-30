/**
 * Wind direction (0.6.0): the pure helpers of `windDirection.ts` (contract D-CONTRACT-060-wind, sections 2 and 7.1).
 * The series transform (`applyWindDirection`, `windDirectionAt`) is tested next to its real code by the W-core lane.
 */
import { describe, expect, it } from 'vitest';
import type { FuelEdit, ScenarioEdit, WindDirectionEdit, WindEdit } from '../core/types';
import { turnDirection, turnFraction, windChangePhase, windDirectionEdits, windDirectionTime, WIND_TURN_S } from './windDirection';

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
