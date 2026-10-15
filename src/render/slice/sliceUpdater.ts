/**
 * The one computation of a slice that both the 3-D curtain and the side-view panel read (pure; plan 8.4 and 8.6). It resolves
 * the line, samples the air into the same `SliceData` object every time (so its arrays are reused), and throttles: a line,
 * field or layer edit is computed at once, a new snapshot at most every `SLICE_UPDATE_MIN_MS` (250 ms). It owns no timer; the
 * scene calls `poll` from its frame loop, and the clock is an argument, so a test runs it with a fake one.
 */
import { resolveSlice, slicePresetStatus } from './sectionLine';
import { sampleSlice } from './sliceField';
import { SLICE_PRESET_IDS, SLICE_UPDATE_MIN_MS, type SliceComputed, type SliceData, type SliceInputs, type SlicePresetId, type SlicePresetStatus, type SliceUpdater } from './types';

export function createSliceUpdater(opts?: { minIntervalMs?: number }): SliceUpdater {
  const minIntervalMs = opts?.minIntervalMs ?? SLICE_UPDATE_MIN_MS;
  let latest: SliceComputed | null = null;
  let pending: SliceInputs | null = null;
  /** The data the next computation refills; kept while the line is briefly unusable, dropped by `invalidate`. */
  let held: SliceData | null = null;
  let lastMs = -Infinity;
  let seq = 0;

  function compute(inputs: SliceInputs, nowMs: number): SliceComputed {
    pending = null;
    lastMs = nowMs;
    const resolved = resolveSlice(inputs.line, inputs.ctx);
    let data: SliceData | null = null;
    if (resolved.line) {
      data = sampleSlice(inputs.sampler, inputs.terrain, { line: resolved.line, shownTime: inputs.shownTime }, held);
      if (data) {
        held = data;
        data.seq = ++seq; // one count across the lifetime of the updater, even when the lattice changes size
      }
    }
    const presets = {} as Record<SlicePresetId, SlicePresetStatus>;
    for (const id of SLICE_PRESET_IDS) presets[id] = slicePresetStatus(id, inputs.ctx);
    latest = { resolved, data, presets };
    return latest;
  }

  const due = (nowMs: number): boolean => nowMs - lastMs >= minIntervalMs || nowMs < lastMs;

  return {
    request(inputs, nowMs, immediate = false) {
      if (immediate || due(nowMs)) return compute(inputs, nowMs);
      pending = inputs;
      return null;
    },
    poll(nowMs) {
      return pending && due(nowMs) ? compute(pending, nowMs) : null;
    },
    invalidate() {
      latest = null;
      pending = null;
      held = null;
      lastMs = -Infinity;
    },
    get latest() {
      return latest;
    },
  };
}
