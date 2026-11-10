/**
 * The Desktop detail choice (0.9.0, D35), the few lines the first screen needs of it: what the person chose for this page load, which finer
 * level (if any) a run built now would have, and the request with that level applied. Everything else of the setting (the words, the memory
 * rules, the Setup row, the label on the run) is in lazy chunks (src/ui/desktopDetail.ts and the files beside it), loaded only on a page a desktop
 * host serves.
 *
 * Rule 1 and 2 of plan section 4: the choice is the person's, made on Setup, for this page load only (like the Engine choice; nothing is stored);
 * a level applies only while the engine chosen is the desktop, so a run on this device is built exactly as 0.8.0 built it; and a run keeps the level
 * it was built with (`SimOptions.desktopDetail`): changing the choice afterwards touches no run.
 */
import type { DesktopDetailLevel, SimOptions } from '../core/types';
import type { ScenarioRequest } from '../scenario/request';
import { SCENARIO_PARAMS } from '../scenario/params';
import { SIM_PARAMS } from '../sim/params';
import { desktopSlot } from './desktopSlot';
import { Store } from './store';

/** The choice on Setup: the standard detail (nothing changes) or one of the desktop's finer levels. */
export type DetailChoice = 'standard' | DesktopDetailLevel;

/** `level` is what the row shows; `touched` goes up when the engine choice changes, so the area card redraws its cells. */
export const detailChoice = new Store<{ level: DetailChoice; touched: number }>({ level: 'standard', touched: 0 });

/** The level a scenario's (or a request's) options were made with: null for the standard detail. A value that is not a level is the standard detail. */
export function levelOf(options: Pick<SimOptions, 'desktopDetail'> | undefined): DesktopDetailLevel | null {
  const d = options?.desktopDetail;
  return d === 'finer' || d === 'finest' ? d : null;
}

/**
 * The finer level a run built now would have: the one chosen, and only while the engine chosen is the desktop (a page without a host, or with
 * This device chosen, has none). Read at the moment of the build, so a link that ended since cannot leave a level behind.
 */
export function chosenDetail(): DesktopDetailLevel | null {
  const c = detailChoice.get().level;
  return c !== 'standard' && desktopSlot.get().host?.state.get().engine === 'desktop' ? c : null;
}

/**
 * The request with the level applied: its cell, its ember cap and the record of it. A new object (the request given is not changed); the air tier,
 * the display step, the solver step and everything else stay as the person's settings made them. `null` gives the request back as it is.
 */
export function applyDetail(req: ScenarioRequest, level: DesktopDetailLevel | null): ScenarioRequest {
  if (!level) return req;
  return { ...req, options: { ...req.options, fireCellSize: SCENARIO_PARAMS.desktopDetailCellM[level], maxEmbers: SIM_PARAMS.desktopDetailMaxEmbers[level], desktopDetail: level } };
}

/**
 * Set by the Setup row while it is on screen: the sentence that refuses the chosen level for an area (km), or null. Setup's validation asks it, so
 * Build is refused next to the other things that are wrong with the form, before anything is built.
 */
export const detailGate: { refusal: ((extentKm: number) => string | null) | null } = { refusal: null };

/** Why the chosen level cannot be built for this area on this page, or null. */
export const chosenDetailRefusal = (extentKm: number): string | null => (chosenDetail() && detailGate.refusal ? detailGate.refusal(extentKm) : null);
