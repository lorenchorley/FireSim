/**
 * Which colouring of an air slice (the chips: Speed, Along, Up/down, Across, Temp, Smoke) the air can give, and the words
 * that say why not (pure; workstream D of docs/plans/air-slice-wind-detail-honest-speed.md, §7.4 and §8.1).
 *
 * The 3-D atmosphere (kind 'prognostic') holds wind, temperature and smoke. The fast tier's air (kind 'diagnosed') is the
 * forecast wind fitted to the terrain and nothing else: no plume, no temperature, no smoke. So the three wind chips and
 * the three wind-derived ones work everywhere there is a 3-D wind, and Temp and Smoke need the 3-D atmosphere. The scene
 * (SceneView), the Layers panel, the map legend and the Air slices panel all ask here, so they never say different things.
 */
import { airHas, airKind, type AirField, type AirKind } from '../core/airView';
import type { AtmosphereView } from '../core/types';
import { SLICE_FIELDS, type SliceFieldId, type SliceFieldStatus, type SliceHas, type SliceKind } from './slice/types';

/** The kind of air and which 3-D fields it really holds (what `AtmosphereSampler` says as `kind` and `hasWind` / `hasTheta` / `hasSmoke`). */
export interface SliceAir {
  kind: AirKind;
  has: SliceHas;
}

/** The air of a snapshot's atmosphere view (null before the first picture). */
export function sliceAirOf(view: Pick<AtmosphereView, 'grid' | 'nz' | 'kind' | 'u' | 'v' | 'w' | 'thetaAnomaly' | 'smoke'> | null | undefined): SliceAir {
  return { kind: airKind(view), has: { wind: airHas(view, 'wind'), theta: airHas(view, 'theta'), smoke: airHas(view, 'smoke') } };
}

/** The slice kind of an air that has a 3-D wind, else null (nothing to slice). */
export function sliceKindOf(air: SliceAir): SliceKind | null {
  return air.has.wind && (air.kind === 'prognostic' || air.kind === 'diagnosed') ? air.kind : null;
}

/**
 * What whoever writes `centre` or `azimuth` of `LayerState.crossSection` must write with them (render/slice/types.ts
 * `SliceLineState`): the line then goes back to "the chord through the centre along the azimuth", so a hand-placed line or
 * a preset from before does not hide the change. (A spread in `SceneView.setLayers` keeps an explicit `undefined`.)
 */
export const LINE_BY_CENTRE = { a: undefined, b: undefined, preset: null } as const;

// ─────────────────────────────────────────────────────────────────────────────
// Words (plain, sentence case, no em dashes; "the fast model" and "the 3-D atmosphere" are the names the app already uses)
// ─────────────────────────────────────────────────────────────────────────────

/** The label of the button that switches a run to the 3-D atmosphere (the same words as the Layers panel's and the Air slices panel's). */
export const USE_3D_LABEL = 'Use the 3-D atmosphere';

/** Why a chip is off when the picture holds no 3-D wind at all (before the first picture of the air). */
export const NO_AIR_REASON = 'There is no 3-D wind in the picture yet.';

/** The Layers panel's info line while the section shows the fast model's air (instead of the old "need the 3-D atmosphere" warning). */
export const DIAGNOSED_SECTION_NOTE = 'This section shows the diagnosed wind (terrain effects only). Use the 3-D atmosphere to see the plume, temperature and smoke.';

/** The Layers panel's line for the wind streaks "Through the plume" on the fast model. */
export const DIAGNOSED_STREAKS_NOTE = 'These streaks follow the fast model’s diagnosed wind (terrain effects only), so there is no plume. Use the 3-D atmosphere to see it.';

/** Said while the switch to the 3-D atmosphere is under way (the same words as before, for the section). */
export const SWITCHING_NOTE = 'Re-computing with the 3-D atmosphere from the last checkpoint… press Play to continue.';
export const SWITCHING_ANNOUNCEMENT = 'Switching to the 3-D atmosphere. The simulation re-computes from the last checkpoint.';

// (Indexed by the field the chip needs; the wind entry is never reached because the wind is checked first.)
const NEEDS_3D_REASON: Record<AirField, string> = {
  wind: NO_AIR_REASON,
  theta: 'Temperature needs the 3-D atmosphere. The fast model only fits the wind to the terrain.',
  smoke: 'Smoke needs the 3-D atmosphere. The fast model does not simulate smoke.',
};
const MISSING_REASON: Record<AirField, string> = {
  wind: NO_AIR_REASON,
  theta: 'This picture has no temperature.',
  smoke: 'This picture has no smoke.',
};

/** Whether each chip can be used on this air, and if not, the reason in plain words (and `action: 'use-3d'` where the switch to the 3-D atmosphere helps). */
export function sliceFieldStatuses(air: SliceAir): Record<SliceFieldId, SliceFieldStatus> {
  const out = {} as Record<SliceFieldId, SliceFieldStatus>;
  for (const f of SLICE_FIELDS) {
    if (!air.has.wind) out[f.id] = { ok: false, reason: NO_AIR_REASON }; // no 3-D wind: nothing can be sliced
    else if (air.has[f.needs]) out[f.id] = { ok: true };
    else if (air.kind === 'diagnosed') out[f.id] = { ok: false, reason: NEEDS_3D_REASON[f.needs], action: 'use-3d' };
    else out[f.id] = { ok: false, reason: MISSING_REASON[f.needs] };
  }
  return out;
}

/**
 * The field the section is coloured by (`SliceUpdate.field`): the one chosen (`LayerState.crossSection.field`) when this air
 * can give it, else wind speed; with none chosen, the original curtain's colouring: temperature where the air has it, else speed.
 */
export function effectiveSliceField(chosen: SliceFieldId | undefined, statuses: Record<SliceFieldId, SliceFieldStatus>): SliceFieldId {
  if (chosen === undefined) return statuses.theta.ok ? 'theta' : 'speed';
  return statuses[chosen].ok ? chosen : 'speed';
}

/**
 * What the legend of the section shows (and what the curtain is coloured by): the effective chip and the kind of air, or null
 * while the picture holds no 3-D wind (then the section is not drawn, and the original temperature legend stands).
 */
export function sectionColouring(air: SliceAir, chosen: SliceFieldId | undefined): { field: SliceFieldId; kind: SliceKind } | null {
  const kind = sliceKindOf(air);
  return kind ? { field: effectiveSliceField(chosen, sliceFieldStatuses(air)), kind } : null;
}
