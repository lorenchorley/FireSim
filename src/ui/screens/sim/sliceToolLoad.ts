/**
 * The one real import of the side-view panel (plan D10): the panel, its drawing, `flow2d`, `probe`, `niceTicks` and `slice.css` load as
 * one dynamic chunk, requested only when the Air slices tool opens (sliceTool.ts), never at start-up. Kept alone in this file so the
 * line is easy to find (the panel is written by another lane) and so the tool's model and shell can be tested with a fake loader.
 */
import type { SlicePanelLoader } from './sliceTypes';

export const loadSlicePanel: SlicePanelLoader = () => import('./slicePanel');
