/** Formatters of the transport controls: playback speed labels and hints, the clock with seconds, step labels. */
import { describe, expect, it } from 'vitest';
import { formatClock, formatElapsedShort, formatPlaybackSpeed, formatSpeedHint, formatSpeedMultiple, formatSpeedRate, formatStepLabel } from './format';

// Saturday 27 Sep 2026 14:35:07 in Sydney (AEST, UTC+10 until the first Sunday of October).
const t0 = Date.UTC(2026, 8, 27, 4, 35, 7);

describe('formatPlaybackSpeed', () => {
  it('keeps the classic labels', () => {
    expect(formatPlaybackSpeed(1)).toBe('1×');
    expect(formatPlaybackSpeed(60)).toBe('60×');
    expect(formatPlaybackSpeed(600)).toBe('600×');
    expect(formatPlaybackSpeed(Infinity)).toBe('Max');
  });
  it('shows slow motion and fractional speeds', () => {
    expect(formatPlaybackSpeed(0.25)).toBe('0.25×');
    expect(formatPlaybackSpeed(0.5)).toBe('0.5×');
    expect(formatPlaybackSpeed(1.5)).toBe('1.5×');
    expect(formatPlaybackSpeed(2.5)).toBe('2.5×');
  });
  it('switches to minutes and hours per second when that is shorter', () => {
    expect(formatPlaybackSpeed(1200)).toBe('1200×');
    expect(formatPlaybackSpeed(1800)).toBe('30 min/s');
    expect(formatPlaybackSpeed(3600)).toBe('1 h/s');
    expect(formatPlaybackSpeed(7200)).toBe('2 h/s');
    expect(formatPlaybackSpeed(5400)).toBe('90 min/s');
    expect(formatPlaybackSpeed(2001)).toBe('2001×');
  });
});

describe('formatSpeedMultiple', () => {
  it('always writes a multiple, for the preset buttons', () => {
    expect([0.25, 1, 60, 1800, 3600].map(formatSpeedMultiple)).toEqual(['0.25×', '1×', '60×', '1800×', '3600×']);
    expect(formatSpeedMultiple(Infinity)).toBe('Max');
  });
});

describe('formatSpeedHint / formatSpeedRate', () => {
  it('describes a speed in words', () => {
    expect(formatSpeedHint(1)).toBe('Real time: 1 s of fire per second');
    expect(formatSpeedHint(0.25)).toBe('Slow motion: 1 s of fire takes 4 s');
    expect(formatSpeedHint(10)).toBe('10 s of fire per second');
    expect(formatSpeedHint(60)).toBe('1 min of fire per second');
    expect(formatSpeedHint(120)).toBe('2 min of fire per second');
    expect(formatSpeedHint(90)).toBe('1.5 min of fire per second');
    expect(formatSpeedHint(3600)).toBe('1 h of fire per second');
    expect(formatSpeedHint(Infinity)).toBe('As fast as the phone can compute');
  });
  it('gives a short rate for the preset buttons', () => {
    expect(formatSpeedRate(0.5)).toBe('slow');
    expect(formatSpeedRate(1)).toBe('real time');
    expect(formatSpeedRate(30)).toBe('30 s/s');
    expect(formatSpeedRate(60)).toBe('1 min/s');
    expect(formatSpeedRate(600)).toBe('10 min/s');
    expect(formatSpeedRate(3600)).toBe('1 h/s');
    expect(formatSpeedRate(Infinity)).toBe('As fast as possible');
  });
});

describe('clock and elapsed with seconds', () => {
  it('formats HH:MM by default and HH:MM:SS on request', () => {
    expect(formatClock(t0, 'Australia/Sydney')).toBe('14:35');
    expect(formatClock(t0, 'Australia/Sydney', true)).toBe('14:35:07');
    expect(formatClock(Date.UTC(2026, 8, 27, 14, 5, 9), 'Australia/Sydney', true)).toBe('00:05:09');
    expect(formatClock(Number.NaN, 'Australia/Sydney', true)).toBe('–');
  });
  it('formats elapsed time as h:mm or h:mm:ss', () => {
    expect(formatElapsedShort(9300)).toBe('+2:35');
    expect(formatElapsedShort(9307, true)).toBe('+2:35:07');
    expect(formatElapsedShort(-65, true)).toBe('−0:01:05');
    expect(formatElapsedShort(45, true)).toBe('+0:00:45');
  });
});

describe('formatStepLabel', () => {
  it('labels the picture intervals', () => {
    expect(['10', '30', '60', '120', '300', '600', '3600'].map((s) => formatStepLabel(Number(s)))).toEqual(['10 s', '30 s', '1 min', '2 min', '5 min', '10 min', '1 h']);
    expect(formatStepLabel(90)).toBe('1 min 30 s');
    expect(formatStepLabel(0)).toBe('–');
  });
});
