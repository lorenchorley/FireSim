/**
 * The scene's half of the time-lapse recorder (0.4.1, plan 8.6): it is fed every snapshot the session receives (`SimSession.onSnapshot`,
 * through `SceneViewApi.sliceRecording`), samples the pinned line of the Air slice on the same lattice the live slice uses
 * (`sampleSlice`), and hands the sample to the `SliceRecorder`. It is also the reader the slice updater asks first
 * (`SliceInputs.recording`). Only a hand-placed line is recorded: a live preset or the Layers chord moves with the wind, the fire or
 * the compass, so its status says it is off and why.
 *
 * It reads a snapshot and never writes one, and nothing in the simulation reads it. A failure (a sampler that throws) stops the
 * recording for that line, says so in the status and is swallowed: `record` is called from the session's `onSnapshot`, which must never
 * fail because a side view could not be recorded, and nothing is logged (the e2e console guard counts every console message).
 */
import { sliceRecorderBudgetBytes } from '../../core/sliceRecording';
import { AtmosphereSampler, type SectionLine } from '../atmosphereSampler';
import { sectionFromEndpoints } from './sectionLine';
import { sampleSlice } from './sliceField';
import { SliceRecorder, sliceLineKey } from './sliceRecorder';
import type { ResolvedSlice, SliceData, SliceKind, SliceLineState, SliceRecordingApi, SliceRecordingReader, SliceRecordingStatus, SliceTerrain } from './types';

/** What the scene gives the recorder: the line state, whether the slice is on, the 10 m ground, the room it may use. */
export interface SliceTimeLapseHost {
  /** The line part of the layer state (`layers.crossSection`). */
  line(): SliceLineState;
  /** Whether the section is switched on; a slice that is off records nothing. */
  enabled(): boolean;
  /** The 10 m ground the slice reads (as received, never the sharpened drawing). */
  terrain(): SliceTerrain | null;
  /** The budget until the session says how much room the history has (`setHistoryBudget`). */
  budgetBytes: number;
  /** The person's Clear recording changed what the panel says: ask for a fresh slice (the scene does). */
  changed?(): void;
}

/** The api the session uses, the reader the updater uses, and what only the scene calls. */
export interface SliceTimeLapse extends SliceRecordingApi, SliceRecordingReader {
  /** The line of a computed slice: a change is applied at once, even while paused (the next snapshot may be minutes away). */
  follow(resolved: ResolvedSlice): void;
  /** Forget everything, line included, without a word: the slice was switched off or the scenario changed. */
  reset(): void;
}

export function createSliceTimeLapse(host: SliceTimeLapseHost): SliceTimeLapse {
  const rec = new SliceRecorder({ budgetBytes: host.budgetBytes });
  /** The slice every sample is made in, refilled each time (a sample is packed, then it is free to reuse). */
  let scratch: SliceData | null = null;
  /** The key of the line now (null: none), and whether sampling it failed, with the key it failed on (another line tries again). */
  let lastKey: string | null = null;
  let failed = false;
  let failedKey: string | null = null;

  function apply(key: string | null, offFor: 'preset' | 'chord' | null): void {
    if (failed && key !== failedKey) failed = false;
    lastKey = key;
    rec.setLine(key, offFor);
  }

  return {
    record(snap) {
      try {
        const t = snap.time;
        if (!host.enabled()) {
          failed = false;
          scratch = null;
          rec.reset();
          return;
        }
        const atm = snap.atmosphere;
        const grid = atm?.grid ?? snap.fire?.grid;
        let line: SectionLine | null = null;
        let offFor: 'preset' | 'chord' | null = null;
        const state = host.line();
        if (state.preset) offFor = 'preset';
        else if (state.a && state.b && grid) line = sectionFromEndpoints(state.a, state.b, grid).line;
        else if (!(state.a && state.b)) offFor = 'chord';
        apply(line ? sliceLineKey(line) : null, offFor);
        // Time order first, as the history does it: a snapshot at t drops every sample at or after t, wanted or not.
        const wanted = rec.arrive(t);
        if (!wanted || !line || failed || !atm || atm.baseM === undefined) return;
        const terrain = host.terrain();
        if (!terrain) return;
        const sampler = new AtmosphereSampler(atm, atm.baseM, snap.stats?.weather ?? null);
        const d = sampleSlice(sampler, terrain, { line, shownTime: t }, scratch);
        if (!d) return; // the air holds no 3-D wind yet (the fast tier before it publishes)
        scratch = d;
        rec.store(d, t);
      } catch {
        failed = true;
        failedKey = lastKey;
        rec.clear(null);
      }
    },
    truncateAfter(t) {
      rec.truncateAfter(t);
    },
    clear() {
      const had = rec.count > 0 || failed;
      failed = false;
      rec.clear('cleared');
      if (had) host.changed?.();
    },
    status(): SliceRecordingStatus {
      const s = rec.status();
      return failed ? { ...s, state: 'failed' } : s;
    },
    setHistoryBudget(historyBytes) {
      rec.setBudget(sliceRecorderBudgetBytes(historyBytes));
    },
    read(line: SectionLine, shownTime: number, kind: SliceKind, pictureAirTime: number | null, out: SliceData | null): SliceData | null {
      return failed ? null : rec.read(line, shownTime, kind, pictureAirTime, out);
    },
    follow(resolved) {
      if (resolved.source === 'preset') apply(null, 'preset');
      else if (resolved.source === 'centre') apply(null, 'chord');
      else apply(resolved.line ? sliceLineKey(resolved.line) : null, null);
    },
    reset() {
      failed = false;
      lastKey = null;
      scratch = null; // the slice the samples are made in is let go with the recording
      rec.reset();
    },
  };
}
