/**
 * The words of the time-lapse recording (recordingWords.ts): how close the kept pictures are, the span, and the status sentences, which the
 * side-view panel and the statistics row share. The panel's own sentences are pinned one by one in slicePanelModel.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { SliceRecordingStatus } from '../render/slice/types';
import { DROP_WORDS, NOT_RECORDED_WORDS, RECORDING_AHEAD_WORDS, RECORDING_EARLIER_WORDS, RECORDING_FAILED_WORDS, RECORDING_NO_CELLS_WORDS, RECORDING_WAITING_WORDS, recordingText, spacingWords, spanWords } from './recordingWords';

const clock = (t: number): string => {
  const m = 11 * 60 + 20 + Math.floor(t / 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const status = (o: Partial<SliceRecordingStatus> = {}): SliceRecordingStatus => ({ state: 'recording', offFor: null, count: 5, from: 600, to: 4800, spacingS: 0, bytes: 1e6, budgetBytes: 6e6, dropped: null, ...o });

describe('spacingWords', () => {
  it('every picture kept while nothing was thinned', () => {
    expect(spacingWords(0)).toBe('every picture kept');
    expect(spacingWords(-1)).toBe('every picture kept');
    expect(spacingWords(NaN)).toBe('every picture kept');
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
  it('from the first picture to the newest, and in brackets how close they are, so neither reads as a fragment', () => {
    expect(spanWords({ from: 600, to: 4800, spacingS: 0 }, clock)).toBe('11:30 to 12:40 (every picture kept)');
    expect(spanWords({ from: 600, to: 4800, spacingS: 120 }, clock)).toBe('11:30 to 12:40 (about every 2 min)');
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
    expect(recordingText(status(), 100, clock)).toBe(`Recorded from 11:30, ${RECORDING_AHEAD_WORDS}. ${RECORDING_EARLIER_WORDS}`);
    expect(recordingText(status({ dropped: 'line' }), 700, clock)).toBe(`${DROP_WORDS.line} Recording again from 11:30 to 12:40 (every picture kept).`);
  });

  it('says where the recording starts and why, in one pinned sentence, when the time shown is before it (the worker had run ahead)', () => {
    expect(recordingText(status(), 100, clock)).toBe(
      "Recorded from 11:30, as far ahead as the simulation had run. This time is earlier, so it uses the history's saved air, which can be older.",
    );
    // the picture exactly at the first picture, or after it, is inside the recording: nothing about an earlier time
    expect(recordingText(status(), 600, clock)).toBe('Recorded from 11:30 to 12:40 (every picture kept).');
    expect(recordingText(status({ spacingS: 120 }), 700, clock)).toBe('Recorded from 11:30 to 12:40 (about every 2 min).');
  });

  it('waits "when the simulation next runs", not "with the next picture" (a paused view has no next picture)', () => {
    expect(RECORDING_WAITING_WORDS).toBe('Recording starts when the simulation next runs.');
    expect(recordingText(status({ state: 'waiting', count: 0, from: null, to: null, dropped: 'cleared' }), 0, clock)).toBe('Recording cleared. Recording starts when the simulation next runs.');
  });

  it('"Recording cleared." goes once the recording holds a picture again; the reasons that explain a late start stay', () => {
    // restarted and holding a picture: the span says it all, the person knows they cleared it
    expect(recordingText(status({ dropped: 'cleared', count: 1, to: 600 }), 700, clock)).toBe('Recorded from 11:30.');
    expect(recordingText(status({ dropped: 'cleared' }), 700, clock)).toBe('Recorded from 11:30 to 12:40 (every picture kept).');
    expect(recordingText(status({ dropped: 'cleared' }), 100, clock)).toBe(`Recorded from 11:30, ${RECORDING_AHEAD_WORDS}. ${RECORDING_EARLIER_WORDS}`);
    // not yet restarted: still said, with what comes next
    expect(recordingText(status({ state: 'waiting', count: 0, from: null, to: null, dropped: 'cleared' }), 0, clock)).toMatch(/^Recording cleared\. /);
    expect(recordingText(status({ dropped: 'cleared', from: null, to: null }), 0, clock)).toMatch(/^Recording cleared\. /);
    // a line or model change says why the recording is short, for as long as it is this recording
    expect(recordingText(status({ dropped: 'line' }), 700, clock)).toMatch(/^The line changed, so the old recording was dropped\. Recording again from 11:30 /);
    expect(recordingText(status({ dropped: 'model' }), 700, clock)).toMatch(/^The air model changed, so the earlier recording was dropped\. Recording again from 11:30 /);
  });

  it('a recording that says it holds pictures but has no start is still "waiting", never "from null"', () => {
    expect(recordingText(status({ from: null, to: null }), 0, clock)).toBe(RECORDING_WAITING_WORDS);
    expect(recordingText(status({ count: 0 }), 0, clock)).toBe(RECORDING_WAITING_WORDS);
  });

  it('has no em dash or en dash in any of its fixed words', () => {
    const fixed = [...Object.values(DROP_WORDS), ...Object.values(NOT_RECORDED_WORDS), RECORDING_WAITING_WORDS, RECORDING_AHEAD_WORDS, RECORDING_FAILED_WORDS, RECORDING_EARLIER_WORDS, RECORDING_NO_CELLS_WORDS];
    for (const w of fixed) expect(w).not.toMatch(/[\u2013\u2014]/);
  });
});
