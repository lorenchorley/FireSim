/**
 * The words of the Air slice time-lapse recording (0.4.1, plan 8.6), pure: how far back the recording reaches and how close its
 * pictures are, said the same way by the side-view panel's status line and the statistics row. `clock` turns a simulation time
 * into "11:25" (the panel and the screen give it the scenario's clock), so this file knows nothing of time zones.
 */
import type { RecordingDrop, SliceRecordingStatus } from '../render/slice/types';

/** "every picture", or how far apart the kept pictures are, said as "about" because thinning keeps between one and two of its gaps. */
export function spacingWords(spacingS: number): string {
  if (!(spacingS > 0) || !Number.isFinite(spacingS)) return 'every picture';
  if (spacingS < 90) return `about every ${Math.max(5, Math.round(spacingS / 5) * 5)} s`;
  if (spacingS < 5400) return `about every ${Math.round(spacingS / 60)} min`;
  return `about every ${Math.round(spacingS / 3600)} h`;
}

type Span = Pick<SliceRecordingStatus, 'from' | 'to' | 'spacingS'>;

/** "11:30 to 12:40, every picture"; just "11:30" while the pictures kept all fall in one minute. Null with nothing recorded. */
export function spanWords(st: Span, clock: (t: number) => string): string | null {
  if (st.from === null || !Number.isFinite(st.from)) return null;
  const from = clock(st.from);
  const to = st.to !== null && Number.isFinite(st.to) ? clock(st.to) : from;
  return to === from ? from : `${from} to ${to}, ${spacingWords(st.spacingS)}`;
}

/** What dropped the recording before this one, as the status line says it. */
export const DROP_WORDS: Record<RecordingDrop, string> = {
  line: 'The line changed, so the old recording was dropped.',
  cleared: 'Recording cleared.',
  model: 'The air model changed, so the earlier recording was dropped.',
};

/** Why a line that is shown is not recorded: a live preset follows the wind and the fire, and the Layers chord moves with its own controls. */
export const NOT_RECORDED_WORDS = {
  preset: 'This preset follows the wind and the fire, so it is not recorded. Press Keep this line to record it.',
  chord: 'The Layers line is not recorded. Place a line with Set start (A) and Set end (B) to record it.',
} as const;

export const RECORDING_WAITING_WORDS = 'Recording starts with the next picture.';
export const RECORDING_FAILED_WORDS = 'Recording stopped. The slice is not affected.';
export const RECORDING_EARLIER_WORDS = "This time is earlier, so it uses the history's saved air, which can be older.";
export const RECORDING_NO_CELLS_WORDS = "The recording does not keep the model's own cells, so the smooth picture is shown.";

/**
 * The status line under the side view: what the recording holds and what it means for the picture shown, or null when there is
 * nothing to say (no line is being recorded and none is shown as a preset or the Layers chord). `shownTime` is the picture's time.
 *   recording        "Recorded from 11:30 to 12:40, about every 2 min."; the shown time before the first picture adds why the air can be older
 *   after a drop     the reason first, then "Recording again from 12:45" (with the same span once it has grown)
 *   waiting          "Recording starts with the next picture."
 */
export function recordingText(st: SliceRecordingStatus | null | undefined, shownTime: number | null, clock: (t: number) => string): string | null {
  if (!st) return null;
  if (st.state === 'failed') return RECORDING_FAILED_WORDS;
  if (st.state === 'off') return st.offFor ? NOT_RECORDED_WORDS[st.offFor] : null;
  const why = st.dropped ? `${DROP_WORDS[st.dropped]} ` : '';
  const span = st.count > 0 ? spanWords(st, clock) : null;
  if (st.state === 'waiting' || span === null) return `${why}${RECORDING_WAITING_WORDS}`;
  const head = st.dropped ? 'Recording again from' : 'Recorded from';
  const earlier = shownTime !== null && st.from !== null && shownTime < st.from;
  // Before the first picture only the start is worth saying: the rest of the span is not what the person is looking at.
  return earlier ? `${why}${head} ${clock(st.from!)}. ${RECORDING_EARLIER_WORDS}` : `${why}${head} ${span}.`;
}
