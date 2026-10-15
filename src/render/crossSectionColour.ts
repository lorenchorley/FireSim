/**
 * The colours of the 3-D curtain (layers.crossSection) from the sampled slice (pure; the Three.js part is crossSectionLayer.ts).
 *
 * The curtain's texture is the slice's own lattice, one texel per lattice point (row 0 the lowest), coloured with the
 * same `sliceFieldScale` as the side-view panel and the legends, so the three always match. Cells outside the model (below
 * its ground, above its top) are transparent. Where the 3-D atmosphere has smoke, the other chips are greyed by it a little,
 * as the curtain always did; the diagnosed wind has none, so nothing is greyed there.
 */
import { sampleRamp, sliceFieldScale, type Rgb } from './palette';
import type { SliceData, SliceFieldId } from './slice/types';

/** Opacity of a cell at the neutral colour of its chip, and the extra that a strong value adds (so the section reads as a solid slice, not a haze). */
export const CURTAIN_ALPHA_BASE = 0.58;
export const CURTAIN_ALPHA_STRONG = 0.4;

/** The size of a value (in its chip's units) that counts as strong: the cell is then fully opaque. Temperature keeps the 1.5 K the curtain always used. */
const STRONG_AT: Record<SliceFieldId, number> = { speed: 8, along: 6, across: 6, up: 1, theta: 1.5, smoke: 0.2 };

/** Grey that smoke mixes into the colours, and the most it can take away from them. */
const SMOKE_GREY = 0.45;
const SMOKE_MAX_SHARE = 0.3;

/** Opacity (0 to 1) of a valid cell: more opaque the stronger the value, and where smoke thickens the cell. */
export function curtainAlpha(field: SliceFieldId, value: number, smokeShare = 0): number {
  const s = Math.min(1, Math.abs(value) / STRONG_AT[field]);
  return CURTAIN_ALPHA_BASE + CURTAIN_ALPHA_STRONG * Math.max(s, smokeShare);
}

/**
 * Colour a slice into `out` (RGBA8, `columns · rows · 4` bytes, row 0 lowest, the layout of a DataTexture). A cell outside the
 * model is fully transparent and carries the colour of the nearest cell above or below it in its column, so the filtering
 * between texels does not pull black into the edge of the air.
 */
export function colourSlice(data: Pick<SliceData, 'columns' | 'rows' | 'values' | 'valid' | 'has'>, field: SliceFieldId, out: Uint8Array): void {
  const { columns: M, rows: N, valid } = data;
  const v = data.values[field];
  const scale = sliceFieldScale(field);
  const c: Rgb = [0, 0, 0];
  // Smoke greys the other chips, relative to the thickest smoke in the slice (as the curtain always did).
  const smoke = data.values.smoke;
  let smokeMax = 0;
  const greyed = field !== 'smoke' && data.has.smoke;
  if (greyed) for (let k = 0; k < M * N; k++) if (valid[k] && smoke[k]! > smokeMax) smokeMax = smoke[k]!;
  const norm = smokeMax > 0 ? 1 / (smokeMax * 0.6) : 0;
  for (let k = 0; k < M * N; k++) {
    if (!valid[k]) continue;
    sampleRamp(scale.ramp, v[k]!, c);
    const sm = greyed ? Math.min(1, smoke[k]! * norm) * SMOKE_MAX_SHARE : 0;
    out[k * 4] = Math.round((c[0] * (1 - sm) + SMOKE_GREY * sm) * 255);
    out[k * 4 + 1] = Math.round((c[1] * (1 - sm) + SMOKE_GREY * sm) * 255);
    out[k * 4 + 2] = Math.round((c[2] * (1 - sm) + SMOKE_GREY * sm) * 255);
    out[k * 4 + 3] = Math.round(curtainAlpha(field, v[k]!, sm) * 255);
  }
  // Cells outside the model: transparent, with the colour of the nearest valid cell of the column.
  const neutral = sampleRamp(scale.ramp, scale.diverging ? 0 : scale.lo, c);
  for (let m = 0; m < M; m++) {
    let first = -1;
    let last = -1;
    for (let r = 0; r < N; r++) {
      if (!valid[r * M + m]) continue;
      if (first < 0) first = r;
      last = r;
    }
    for (let r = 0; r < N; r++) {
      const k = r * M + m;
      if (valid[k]) continue;
      // Below the first valid cell take it; above the last, take it; a hole in between takes the cell below.
      let src = -1;
      if (first < 0) src = -1;
      else if (r < first) src = first;
      else if (r > last) src = last;
      else {
        src = r - 1;
        while (src > first && !valid[src * M + m]) src--;
      }
      if (src >= 0) {
        const s = (src * M + m) * 4;
        out[k * 4] = out[s]!;
        out[k * 4 + 1] = out[s + 1]!;
        out[k * 4 + 2] = out[s + 2]!;
      } else {
        out[k * 4] = Math.round(neutral[0] * 255);
        out[k * 4 + 1] = Math.round(neutral[1] * 255);
        out[k * 4 + 2] = Math.round(neutral[2] * 255);
      }
      out[k * 4 + 3] = 0;
    }
  }
}
