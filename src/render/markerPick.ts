/**
 * Which map icon a tap is on (workstream I, §9e). Pure screen-pixel geometry with no three.js and no DOM, so the hit rules
 * are tested in node: the view projects every icon it drew to the screen, this module decides which one the finger meant.
 *
 * An icon is a hit when the tap is within `max(half its size, 22)` px of the centre of its picture (a 44 px target; the
 * icons are 22 to 40 px), a home within 14 px. The nearest centre wins; an exact tie goes to the higher rank (you, ignition,
 * spot fire, insight, home). The result also says how many more icons were hit, so the panel can say they are stacked.
 * A pin stands on its anchor (the shader draws it from its bottom centre up), so its centre is half its height above it.
 */
import type { MapMarker } from './api';

/** The smallest radius (px) around an icon's centre that counts as a tap on it. */
export const MIN_HIT_PX = 22;
/** Homes are small and many: a tight radius, so a tap meant for the ground in a town is not kept taken by houses. */
export const HOME_HIT_PX = 14;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** What an icon stands for, before a tap has counted the icons around it (`others` is the pick's answer). */
export type MarkerSource = DistributiveOmit<MapMarker, 'others'>;

/** One icon on the screen: what it is, where its picture is centred (px from the view's top left), its half size and its rank. */
export interface PickCandidate {
  marker: MarkerSource;
  sx: number;
  sy: number;
  halfPx: number;
  rank: number;
}

/** Tie-break order: you, then an ignition, a spot fire, an insight, a home (lower wins). */
export function markerRank(marker: MarkerSource): number {
  switch (marker.kind) {
    case 'you':
      return 0;
    case 'ignition':
      return marker.ignition.origin === 'spot' ? 2 : 1; // a marked spot fire is drawn (and ranked) as a spot fire
    case 'spot':
      return 2;
    case 'insight':
      return 3;
    case 'home':
      return 4;
  }
}

/** The centre of an icon's picture given where it is anchored on screen: a pin's picture stands half its height above its tip. */
export function iconCentre(ax: number, ay: number, sizePx: number, pin: boolean): [number, number] {
  return [ax, pin ? ay - sizePx / 2 : ay];
}

/** A candidate for an icon anchored at (ax, ay) on screen. */
export function iconCandidate(marker: MarkerSource, ax: number, ay: number, sizePx: number, pin: boolean): PickCandidate {
  const [sx, sy] = iconCentre(ax, ay, sizePx, pin);
  return { marker, sx, sy, halfPx: sizePx / 2, rank: markerRank(marker) };
}

/** How far from its centre a tap still counts as on the icon. */
export function hitRadius(c: Pick<PickCandidate, 'marker' | 'halfPx'>): number {
  return c.marker.kind === 'home' ? HOME_HIT_PX : Math.max(c.halfPx, MIN_HIT_PX);
}

/**
 * The icon a tap at (tx, ty) is on, with `others` = how many more icons were also hit, or null. Nearest centre wins, an
 * exact tie goes to the lower rank, and a further tie to the earlier candidate.
 */
export function pickMarkerAt(tx: number, ty: number, candidates: readonly PickCandidate[]): MapMarker | null {
  let best: PickCandidate | null = null;
  let bestD = Infinity;
  let hits = 0;
  for (const c of candidates) {
    const d = Math.hypot(c.sx - tx, c.sy - ty);
    if (!(d <= hitRadius(c))) continue;
    hits++;
    if (!best || d < bestD || (d === bestD && c.rank < best.rank)) {
      best = c;
      bestD = d;
    }
  }
  return best ? ({ ...best.marker, others: hits - 1 } as MapMarker) : null;
}

/**
 * A world point to screen pixels (from the view's top left) through a combined projection x view matrix (column-major, as
 * three.js stores it), not clipped to the screen: an icon half off the edge can still be tapped. Null for a point behind the
 * camera (the icon shader draws nothing there either).
 */
export function projectPoint(viewProj: ArrayLike<number>, x: number, y: number, z: number, widthPx: number, heightPx: number): [number, number] | null {
  const e = viewProj;
  const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
  if (!(w > 0)) return null;
  const nx = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w;
  const ny = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w;
  return [((nx + 1) / 2) * widthPx, ((1 - ny) / 2) * heightPx];
}

/**
 * Candidates for the homes within reach of a tap. Nothing when the Homes layer is off; a home hidden behind terrain
 * (`hidden`) or behind the camera (`project` gives null) is skipped. `homes` is [x0, y0, x1, y1, …] in local metres;
 * `project` gives screen px; only homes within the home radius of the tap are looked at further, so a town of thousands is cheap.
 */
export function homeCandidates(
  homes: Float32Array,
  layerOn: boolean,
  tx: number,
  ty: number,
  project: (x: number, y: number) => readonly [number, number] | null,
  hidden: (x: number, y: number) => boolean,
): PickCandidate[] {
  const out: PickCandidate[] = [];
  if (!layerOn) return out;
  for (let i = 0; i + 1 < homes.length; i += 2) {
    const x = homes[i]!;
    const y = homes[i + 1]!;
    const s = project(x, y);
    if (!s || Math.hypot(s[0] - tx, s[1] - ty) > HOME_HIT_PX) continue;
    if (hidden(x, y)) continue;
    const marker: MarkerSource = { kind: 'home', x, y };
    out.push({ marker, sx: s[0], sy: s[1], halfPx: HOME_HIT_PX, rank: markerRank(marker) });
  }
  return out;
}
