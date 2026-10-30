/** Stub (0.6.0 C0): the D-engine lane writes the body. The pure builder of the detailed streaks of the most detailed wind level; for now every build finishes with no lines. */
import { GLYPH_CAPS, type DetailBuilder, type DetailInput, type DetailOutput, type GlyphTier } from './glyphTypes';

/** A builder with room for the caps of the picture tier, made once; `out` is written in place by every build. */
export function createDetailBuilder(tier: GlyphTier): DetailBuilder {
  const n = GLYPH_CAPS[tier].segments;
  const out: DetailOutput = {
    a: new Float32Array(3 * n),
    b: new Float32Array(3 * n),
    c: new Float32Array(4 * n),
    d: new Float32Array(4 * n),
    e: new Float32Array(4 * n),
    lines: 0,
    segments: 0,
    dropped: 0,
    calm: 0,
    steep: 0,
  };
  return {
    begin(_input: DetailInput): void {
      out.lines = out.segments = out.dropped = out.calm = out.steep = 0;
    },
    step(_budgetMs: number): boolean {
      return true;
    },
    busy: false,
    out,
    cancel(): void {},
  };
}
