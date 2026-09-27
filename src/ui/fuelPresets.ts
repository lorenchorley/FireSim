/**
 * Fuel-brush presets: plain-language fuel observations ("more leaf litter here", "this is a road") mapped to
 * {@link FuelEdit} changes of the OFHAG hazard scores (0–4) used by the Vesta Mk2 dry-forest model.
 */
import { FuelType, type BrushShape, type FuelEdit } from '../core/types';
import type { Pt } from './brushGeometry';
import { strokeToPolygon } from './brushGeometry';

export interface FuelPreset {
  id: string;
  label: string;
  description: string;
  /** Brush preview colour. */
  colour: string;
  changes: Omit<FuelEdit, 'kind' | 'id' | 'shape'>;
}

export const FUEL_PRESETS: FuelPreset[] = [
  {
    id: 'litter',
    label: 'More leaf litter',
    description: 'Deep bark and leaf litter on the ground (+1 surface hazard).',
    colour: '#b7791f',
    changes: { surfaceHazardDelta: 1 },
  },
  {
    id: 'shrubs',
    label: 'Denser understorey',
    description: 'Thick shrubs and saplings that carry flame up into the trees.',
    colour: '#2f9e44',
    changes: { elevatedHazardDelta: 1.5, nearSurfaceHazardDelta: 0.5, elevatedHeight: 2.5 },
  },
  {
    id: 'stringybark',
    label: 'Stringybark',
    description: 'Fibrous bark — the main source of long-range embers (+2 bark hazard).',
    colour: '#c2410c',
    changes: { barkHazardDelta: 2 },
  },
  {
    id: 'less',
    label: 'Less fuel (burnt / HR)',
    description: 'Recently burnt or hazard-reduced ground: little litter, few shrubs.',
    colour: '#868e96',
    changes: { setTimeSinceFire: 1, surfaceHazardDelta: -2, nearSurfaceHazardDelta: -1.5, elevatedHazardDelta: -2 },
  },
  {
    id: 'nofuel',
    label: 'Road / track / rock',
    description: 'No fuel: fire trail, road, rock shelf or cleared break.',
    colour: '#495057',
    changes: { setType: FuelType.NonFuel },
  },
  {
    id: 'wetter',
    label: 'Wetter (gully / seepage)',
    description: 'Damp ground the model missed: +8 points of litter moisture.',
    colour: '#1c7ed6',
    changes: { moistureDelta: 8 },
  },
];

export const presetById = (id: string): FuelPreset => FUEL_PRESETS.find((p) => p.id === id) ?? FUEL_PRESETS[0]!;

/** The fuel edit for a brush tap (circle) or painted stroke (union of discs → one polygon). */
export function fuelEditFor(presetId: string, stroke: readonly Pt[], radius: number, id: string): FuelEdit {
  const p = presetById(presetId);
  const shape: BrushShape = stroke.length <= 1 ? { kind: 'circle', x: stroke[0]![0], y: stroke[0]![1], radius } : { kind: 'polygon', points: strokeToPolygon(stroke, radius) };
  return { kind: 'fuel', id, shape, ...p.changes };
}
