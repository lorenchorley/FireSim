/**
 * The map's attribution line (like the one at the bottom of Google Maps): the credits of the data sets that are drawn
 * on screen right now, read from the scenario's data-set inventory (core/datasets.ts), never typed in. Pure and
 * unit-tested; simScreen.ts puts the text in a small button that opens the Data sets screen.
 */
import { creditLines, imageryCredit, type DatasetId, type DatasetRecord } from '../../../core/datasets';
import type { LayerState, OverlayKind } from '../../../render/layers';

export type CreditLayers = Pick<LayerState, 'overlay' | 'imagery' | 'vegetation' | 'roads' | 'fireTrails' | 'homes' | 'zones' | 'placeNames' | 'soloHeat'>;

/** The data sets behind each heat map (the fire results and the app's own estimates carry no outside credit). */
const OVERLAY_DATA: Partial<Record<OverlayKind, readonly DatasetId[]>> = {
  elevation: ['terrain'],
  slope: ['terrain'],
  aspect: ['terrain'],
  landform: ['terrain'],
  insolation: ['terrain'],
  canopyHeight: ['canopy-height'],
  canopyCover: ['canopy-height'],
  fuelType: ['vegetation-svtm'],
  fuelLoad: ['vegetation-svtm'],
  elevatedHazard: ['vegetation-svtm'],
  elevatedHeight: ['vegetation-svtm'],
  surfaceHazard: ['vegetation-svtm'],
  nearSurfaceHazard: ['vegetation-svtm'],
  barkHazard: ['vegetation-svtm'],
  grassCuring: ['vegetation-svtm'],
  timeSinceFire: ['fire-history'],
  fireHistoryKind: ['fire-history'],
  homeDensity: ['homes'],
  roadAccess: ['roads', 'fire-trails'],
};

export interface MapCredit {
  /** One line: the credits joined with " · " ('' when nothing on screen needs a credit). */
  text: string;
  /** The separate credits, in the order shown (imagery first: it is what the eye sees). */
  parts: string[];
  /** The data sets credited. */
  ids: DatasetId[];
}

/**
 * Credits for what is visible: the aerial photo (with its capture date, from `imageryCredit`), the ground shape, the 3-D
 * trees, the places layers that are switched on and the data behind the heat map. A heat map shown "on its own"
 * (soloHeat) hides the photo and the trees, so they are not credited then.
 */
export function mapCredits(
  datasets: readonly DatasetRecord[] | undefined,
  layers: CreditLayers,
  o: {
    hasImagery: boolean;
    hasContext: boolean;
    /** The photo's own credit (SceneImagery.attribution), used when the inventory has no used imagery record. */
    imageryAttribution?: string;
  },
): MapCredit {
  const solo = layers.soloHeat && layers.overlay !== 'none';
  const parts: string[] = [];
  const ids: DatasetId[] = [];
  const add = (text: string, id: DatasetId): void => {
    if (!text) return;
    if (!ids.includes(id)) ids.push(id);
    if (!parts.includes(text)) parts.push(text);
  };
  if (layers.imagery && o.hasImagery && !solo) {
    const photo = imageryCredit(datasets);
    add(photo || (o.imageryAttribution ? `Aerial photo ${o.imageryAttribution}` : ''), 'imagery');
  }
  if (!datasets?.length) return { text: parts.join(' · '), parts, ids };
  const want: DatasetId[] = [];
  if (o.hasContext) {
    if (layers.roads) want.push('roads');
    if (layers.fireTrails) want.push('fire-trails');
    if (layers.homes) want.push('homes');
    if (layers.zones) want.push('zones');
    if (layers.placeNames) want.push('place-names');
  }
  for (const id of OVERLAY_DATA[layers.overlay] ?? []) if (!want.includes(id)) want.push(id);
  if (layers.vegetation && !solo) want.push('vegetation-svtm', 'canopy-height');
  want.push('terrain'); // the 3-D ground is always drawn
  for (const id of want) for (const line of creditLines(datasets, [id])) add(line, id);
  return { text: parts.join(' · '), parts, ids };
}
