/** Stub (0.6.0 C0): the D-ui lane writes the rules. The state of the Wind detail chip, from the wind layer's own statistics (pure, entry chunk). */
import type { AirKind } from '../../../core/airView';
import type { WindGlyphStats } from '../../../render/api';
import type { WindHeight } from '../../../render/wind/glyphTypes';

export type DetailKind = 'none' | 'arrows' | 'curves' | 'detailed' | 'overview' | 'volume';
export type DetailLimit = 'budget' | 'zoom' | 'cells' | 'estimated' | 'still';
export interface WindDetailInput {
  glyphsOn: boolean;
  streaks: 'off' | 'surface' | 'volume';
  viewMode: 'orbit' | 'top' | 'ground';
  stats: WindGlyphStats | null;
  air: AirKind;
  height: WindHeight;
}
export interface WindDetailState {
  visible: boolean;
  level: 0 | 1 | 2 | 3 | 4;
  kind: DetailKind;
  limits: DetailLimit[];
  key: string;
}

export function windDetailState(_i: WindDetailInput): WindDetailState {
  return { visible: false, level: 0, kind: 'none', limits: [], key: 'hidden' };
}

/** The chip's accessible name for a level (the visible text is always "Wind detail"). */
export function chipLabel(level: number): string {
  return level >= 1 ? `Wind detail: level ${level} of 4. Open the explanation.` : 'Wind detail: not drawn yet. Open the explanation.';
}
