import { describe, expect, it } from 'vitest';
import { CUSTOM_MAX, CUSTOM_MIN, customFieldValue, niceSpeed, parseCustomSpeed, SLIDER_STEPS, SPEED_MAX, SPEED_MIN, SPEED_PRESETS, sliderToSpeed, speedToSlider } from './speedModel';

describe('logarithmic speed slider', () => {
  it('spans 0.25× to 3600×', () => {
    expect(sliderToSpeed(0)).toBe(SPEED_MIN);
    expect(sliderToSpeed(SLIDER_STEPS)).toBe(SPEED_MAX);
    expect(speedToSlider(SPEED_MIN)).toBe(0);
    expect(speedToSlider(SPEED_MAX)).toBe(SLIDER_STEPS);
    expect(speedToSlider(Infinity)).toBe(SLIDER_STEPS);
    expect(speedToSlider(0.01)).toBe(0);
  });
  it('is monotonic and puts 1× and 60× where a log scale says', () => {
    let prev = 0;
    for (let p = 0; p <= SLIDER_STEPS; p += 10) {
      const v = sliderToSpeed(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // log(1/0.25)/log(3600/0.25) = 0.1445, log(240)/log(14400) = 0.5717
    expect(speedToSlider(1)).toBeCloseTo(144.5, -1);
    expect(speedToSlider(60)).toBeCloseTo(571.7, -1);
  });
  it('round-trips every preset', () => {
    for (const sp of SPEED_PRESETS) expect(sliderToSpeed(speedToSlider(sp))).toBe(sp);
  });
  it('rounds in-between values to readable numbers', () => {
    for (let p = 0; p <= SLIDER_STEPS; p += 7) {
      const v = sliderToSpeed(p);
      expect(niceSpeed(v)).toBe(v);
    }
    expect(niceSpeed(0.263)).toBe(0.25);
    expect(niceSpeed(3.14159)).toBe(3.1);
    expect(niceSpeed(37.4)).toBe(37);
    expect(niceSpeed(437)).toBe(440);
    expect(niceSpeed(2149)).toBe(2100);
  });
});

describe('custom speed', () => {
  it('reads × or min/s and limits the range', () => {
    expect(parseCustomSpeed(45, 'x')).toBe(45);
    expect(parseCustomSpeed(2, 'minps')).toBe(120);
    expect(parseCustomSpeed(0.01, 'x')).toBe(CUSTOM_MIN);
    expect(parseCustomSpeed(1e9, 'x')).toBe(CUSTOM_MAX);
    expect(parseCustomSpeed(0, 'x')).toBeNull();
    expect(parseCustomSpeed(-3, 'x')).toBeNull();
    expect(parseCustomSpeed(Number.NaN, 'minps')).toBeNull();
  });
  it('shows a speed in the chosen unit without trailing zeros', () => {
    expect(customFieldValue(90, 'x')).toBe('90');
    expect(customFieldValue(90, 'minps')).toBe('1.5');
    expect(customFieldValue(0.25, 'x')).toBe('0.25');
    expect(customFieldValue(Infinity, 'x')).toBe('');
  });
});
