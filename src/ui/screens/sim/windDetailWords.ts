/** Stub (0.6.0 C0): the D-ui lane writes the words. The title and lines of the Wind detail sheet (pure; loaded with the sheet on the first tap). */
import type { WindHeight } from '../../../render/wind/glyphTypes';
import type { WindDetailState } from './windDetailState';

export function windDetailWords(_s: WindDetailState, _o: { heightLabel: string; height: WindHeight; cellM: number | null }): { title: string; lines: string[] } {
  return { title: 'Wind detail', lines: [] };
}
