/**
 * Hand-made slices for the side-view panel's tests (plan §8.8: the draw functions run against a stub context, the pure
 * helpers on literal data). Not used by the app.
 */
import { SLICE_FIELD_IDS, type SliceCells, type SliceData, type SliceFieldId, type SliceKind, type SliceUpdate, type SliceFieldStatus } from '../../../render/slice/types';

export interface FakeSliceOptions {
  columns?: number;
  rows?: number;
  length?: number;
  kind?: SliceKind;
  cells?: boolean;
  airTime?: number | null;
  shownTime?: number;
}

/** A 3 km line due east from (1000, 1000); the ground rises from 400 m to 520 m; wind 8 m/s along the line with a little up and down. */
export function fakeSlice(o: FakeSliceOptions = {}): SliceData {
  const columns = o.columns ?? 24;
  const rows = o.rows ?? 16;
  const length = o.length ?? 3000;
  const zMin = 350;
  const zMax = 2500;
  const kind = o.kind ?? 'prognostic';
  const values = {} as Record<SliceFieldId, Float32Array>;
  for (const f of SLICE_FIELD_IDS) values[f] = new Float32Array(columns * rows);
  const valid = new Uint8Array(columns * rows);
  const ground = new Float32Array(columns);
  const modelGround = new Float32Array(columns);
  for (let c = 0; c < columns; c++) {
    ground[c] = 400 + (120 * c) / (columns - 1) + (c % 5 === 0 ? 15 : 0);
    modelGround[c] = 400 + (120 * c) / (columns - 1);
  }
  for (let r = 0; r < rows; r++) {
    const z = zMin + (r * (zMax - zMin)) / (rows - 1);
    for (let c = 0; c < columns; c++) {
      const k = r * columns + c;
      valid[k] = z > modelGround[c]! ? 1 : 0;
      values.speed[k] = 4 + (8 * r) / (rows - 1);
      values.along[k] = values.speed[k]!;
      values.across[k] = ((c % 7) - 3) * 0.5;
      values.up[k] = Math.sin((c / columns) * Math.PI * 2) * 1.5;
      values.theta[k] = ((r % 5) - 2) * 0.8;
      values.smoke[k] = c < columns / 2 ? 0 : 0.4;
    }
  }
  return {
    seq: 1,
    kind,
    line: { a: [1000, 1000], b: [1000 + length, 1000], dir: [1, 0], length },
    columns,
    rows,
    zMin,
    zMax,
    topAsl: 3000,
    values,
    valid,
    ground,
    modelGround,
    has: { wind: true, theta: kind === 'prognostic', smoke: kind === 'prognostic' },
    cellSizeM: 133.3,
    cells: o.cells ? fakeCells(length) : null,
    airTime: o.airTime === undefined ? 3600 : o.airTime,
    shownTime: o.shownTime ?? 3600,
  };
}

/** Six model columns along the line, five levels each; their heights follow a rising ground. */
export function fakeCells(length: number): SliceCells {
  const count = 6;
  const levels = 5;
  const edges = new Float32Array(count + 1);
  for (let i = 0; i <= count; i++) edges[i] = (length * i) / count;
  const zEdges = new Float32Array(count * (levels + 1));
  const values = {} as Record<SliceFieldId, Float32Array>;
  for (const f of SLICE_FIELD_IDS) values[f] = new Float32Array(count * levels);
  for (let c = 0; c < count; c++) {
    const g = 400 + c * 20;
    for (let l = 0; l <= levels; l++) zEdges[c * (levels + 1) + l] = g + l * l * 40 + l * 100;
    for (let l = 0; l < levels; l++) for (const f of SLICE_FIELD_IDS) values[f][c * levels + l] = (l + 1) * 2 + c * 0.1;
  }
  return { count, edges, column: Int32Array.from({ length: count }, (_, i) => 10 + i), levels, zEdges, values };
}

const OPEN: SliceFieldStatus = { ok: true };

/** An update the way the scene publishes it, around a slice. `fields` defaults to every chip open. */
export function fakeUpdate(data: SliceData | null, fields: Partial<Record<SliceFieldId, SliceFieldStatus>> = {}): SliceUpdate {
  const all = {} as Record<SliceFieldId, SliceFieldStatus>;
  for (const f of SLICE_FIELD_IDS) all[f] = fields[f] ?? OPEN;
  return {
    resolved: { line: data ? data.line : null, source: 'preset', preset: 'along', issue: null, notes: [], minLengthM: 300 },
    data,
    presets: { along: { ok: true }, across: { ok: true }, slope: { ok: true }, me: { ok: true } },
    field: 'speed',
    fields: all,
  };
}
