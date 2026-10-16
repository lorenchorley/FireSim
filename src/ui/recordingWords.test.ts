/**
 * The words of the time-lapse recording (recordingWords.ts): how close the kept pictures are, the span, and the status sentences, which the
 * side-view panel and the statistics row share. The panel's own sentences are pinned one by one in slicePanelModel.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { SliceRecordingStatus } from '../render/slice/types';
import { DROP_WORDS, NOT_RECORDED_WORDS, RECORDING_EARLIER_WORDS, RECORDING_FAILED_WORDS, RECORDING_NO_CELLS_WORDS, RECORDING_WAITING_WORDS, recordingText, spacingWords, spanWords } from './recordingWords';

const clock = (t: number): string => {
  const m = 11 * 60 + 20 + Math.floor(t / 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const status = (o: Partial<SliceRecordingStatus> = {}): SliceRecordingStatus => ({ state: 'recording', offFor: null, count: 5, from: 600, to: 4800, spacingS: 0, bytes: 1e6, budgetBytes: 6e6, dropped: null, ...o });

describe('spacingWords', () => {
  it('every picture while nothing was thinned', () => {
    expect(spacingWords(0)).toBe('every picture');
    expect(spacingWords(-1)).toBe('every picture');
    expect(spacingWords(NaN)).toBe('every picture');
  });

  it('about every so many seconds under 90 s, in steps of 5', () => {
    expect(spacingWords(20)).toBe('about every 20 s');
    expect(spacingWords(42)).toBe('about every 40 s');
    expect(spacingWords(60)).toBe('about every 60 s');
    expect(spacingWords(89)).toBe('about every 90 s');
    expect(spacingWords(1)).toBe('about every 5 s');
  });

  it('about every so many minutes from 90 s, and hours past an hour and a half', () => {
    expect(spacingWords(90)).toBe('about every 2 min');
    expect(spacingWords(120)).toBe('about every 2 min');
    expect(spacingWords(240)).toBe('about every 4 min');
    expect(spacingWords(5399)).toBe('about every 90 min');
    expect(spacingWords(5400)).toBe('about every 2 h');
    expect(spacingWords(10800)).toBe('about every 3 h');
  });
});

describe('spanWords', () => {
  it('from the first picture to the newest, and how close they are', () => {
    expect(spanWords({ from: 600, to: 4800, spacingS: 0 }, clock)).toBe('11:30 to 12:40, every picture');
    expect(spanWords({ from: 600, to: 4800, spacingS: 120 }, clock)).toBe('11:30 to 12:40, about every 2 min');
  });

  it('only the start while all the pictures fall in one minute, and nothing before the first picture', () => {
    expect(spanWords({ from: 600, to: 630, spacingS: 0 }, clock)).toBe('11:30');
    expect(spanWords({ from: 600, to: null, spacingS: 0 }, clock)).toBe('11:30');
    expect(spanWords({ from: null, to: null, spacingS: 0 }, clock)).toBeNull();
    expect(spanWords({ from: NaN, to: null, spacingS: 0 }, clock)).toBeNull();
  });
});

describe('recordingText', () => {
  it('uses the same words for each reason a recording was dropped, and names them', () => {
    expect(Object.keys(DROP_WORDS).sort()).toEqual(['cleared', 'line', 'model']);
  });

  it('is built from the pinned sentences and nothing else', () => {
    expect(recordingText(status({ state: 'waiting', count: 0, from: null, to: null }), 0, clock)).toBe(RECORDING_WAITING_WORDS);
    expect(recordingText(status({ state: 'failed' }), 0, clock)).toBe(RECORDING_FAILED_WORDS);
    expect(recordingText(status({ state: 'off', offFor: 'preset' }), 0, clock)).toBe(NOT_RECORDED_WORDS.preset);
    expect(recordingText(status({ state: 'off', offFor: 'chord' }), 0, clock)).toBe(NOT_RECORDED_WORDS.chord);
    expect(recordingText(status(), 100, clock)).toBe(`Recorded from 11:30. ${RECORDING_EARLIER_WORDS}`);
    expect(recordingText(status({ dropped: 'cleared' }), 700, clock)).toBe(`${DROP_WORDS.cleared} Recording again from 11:30 to 12:40, every picture.`);
  });

  it('a recording that says it holds pictures but has no start is still "waiting", never "from null"', () => {
    expect(recordingText(status({ from: null, to: null }), 0, clock)).toBe(RECORDING_WAITING_WORDS);
    expect(recordingText(status({ count: 0 }), 0, clock)).toBe(RECORDING_WAITING_WORDS);
  });

  it('has no em dash or en dash in any of its fixed words', () => {
    const fixed = [...Object.values(DROP_WORDS), ...Object.values(NOT_RECORDED_WORDS), RECORDING_WAITING_WORDS, RECORDING_FAILED_WORDS, RECORDING_EARLIER_WORDS, RECORDING_NO_CELLS_WORDS];
    for (const w of fixed) expect(w).not.toMatch(/[\u2013\u2014]/);
  });
});
