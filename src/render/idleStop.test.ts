/**
 * The idle clock (idleStop.ts): idle after a limit without a poke, woken by the next poke, never idle for a limit of 0 or Infinity or a clock that goes
 * backwards; and the option that sets the limit.
 */
import { describe, expect, it } from 'vitest';
import { IDLE_STOP_MS, IdleClock, idleStopLimit } from './idleStop';

describe('IdleClock', () => {
  it('is idle once the limit has passed since the last poke, and not a millisecond before', () => {
    const c = new IdleClock(60_000);
    c.poke(1_000);
    expect(c.idle(1_000)).toBe(false);
    expect(c.idle(1_000 + 60_000 - 1)).toBe(false);
    expect(c.idle(1_000 + 60_000)).toBe(true);
    expect(c.idle(1_000 + 600_000)).toBe(true);
  });

  it('a poke at now - limit + 1 is not idle, at now - limit is', () => {
    const now = 500_000;
    const a = new IdleClock(60_000);
    a.poke(now - 60_000 + 1);
    expect(a.idle(now)).toBe(false);
    const b = new IdleClock(60_000);
    b.poke(now - 60_000);
    expect(b.idle(now)).toBe(true);
  });

  it('activity inside the limit never says it woke anything', () => {
    const c = new IdleClock(10_000);
    expect(c.poke(0)).toBe(false);
    expect(c.poke(5_000)).toBe(false);
    expect(c.poke(14_999)).toBe(false); // 9 999 ms after the last one
    expect(c.poke(24_998)).toBe(false);
  });

  it('says true for the poke that woke a stopped view, false for the ones after it', () => {
    const c = new IdleClock(10_000);
    c.poke(0);
    expect(c.idle(10_000)).toBe(true);
    expect(c.poke(12_000)).toBe(true);
    expect(c.idle(12_000)).toBe(false);
    expect(c.poke(12_100)).toBe(false);
    expect(c.idle(12_000 + 9_999)).toBe(false);
    expect(c.idle(12_100 + 10_000)).toBe(true);
  });

  it('counts from the first look when nothing has poked yet (a view that was built and left alone still stops)', () => {
    const c = new IdleClock(10_000);
    expect(c.idle(100_000)).toBe(false); // the first look starts the count
    expect(c.idle(100_000 + 9_999)).toBe(false);
    expect(c.idle(100_000 + 10_000)).toBe(true);
  });

  it('a limit of 0, Infinity, a negative number or NaN is never', () => {
    for (const limit of [0, Infinity, -5, NaN]) {
      const c = new IdleClock(limit);
      c.poke(0);
      expect(c.idle(1e12), `limit ${limit}`).toBe(false);
      expect(c.poke(2e12), `limit ${limit}`).toBe(false);
    }
  });

  it('a clock that goes backwards is never idle', () => {
    const c = new IdleClock(10_000);
    c.poke(50_000);
    expect(c.idle(40_000)).toBe(false);
    expect(c.idle(0)).toBe(false);
    // and a poke at the earlier time starts the count there
    c.poke(0);
    expect(c.idle(9_999)).toBe(false);
    expect(c.idle(10_000)).toBe(true);
  });

  it('setLimit takes effect at once, from the last poke', () => {
    const c = new IdleClock(60_000);
    c.poke(0);
    expect(c.idle(20_000)).toBe(false);
    c.setLimit(10_000);
    expect(c.idle(20_000)).toBe(true);
    c.setLimit(0);
    expect(c.idle(20_000)).toBe(false);
  });
});

describe('idleStopLimit', () => {
  it('takes a number of ms, 0 and Infinity as they are', () => {
    expect(idleStopLimit(3000)).toBe(3000);
    expect(idleStopLimit(0)).toBe(0);
    expect(idleStopLimit(Infinity)).toBe(Infinity);
    expect(idleStopLimit(1500.5)).toBe(1500.5);
  });

  it('takes a numeric string (a query value)', () => {
    expect(idleStopLimit('3000')).toBe(3000);
    expect(idleStopLimit(' 250 ')).toBe(250);
    expect(idleStopLimit('0')).toBe(0);
  });

  it('anything else is the minute: absent, negative, NaN, text, empty, other types', () => {
    expect(IDLE_STOP_MS).toBe(60_000);
    for (const raw of [undefined, null, -1, -Infinity, NaN, 'soon', '', '  ', 'NaN', '-3', {}, [], true, () => 5]) {
      expect(idleStopLimit(raw), String(raw)).toBe(IDLE_STOP_MS);
    }
  });
});
