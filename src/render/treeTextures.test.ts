import { describe, expect, it } from 'vitest';
import { IMPOSTOR_SLOTS, IMP_H, IMP_W, LEAF_TILES, TILE, impostorAtlas, leafAtlas, resetTextureCache, textureBytes } from './treeTextures';

const coverage = (d: Uint8Array): number => {
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]! >= 128) n++;
  return n / (d.length / 4);
};

describe('procedural canopy textures', () => {
  it('are deterministic and cached', () => {
    const a = leafAtlas();
    expect(leafAtlas()).toBe(a);
    const copy = Uint8Array.from(a.mips[0]!.data);
    resetTextureCache();
    const b = leafAtlas();
    expect(b).not.toBe(a);
    expect(Array.from(b.mips[0]!.data.subarray(0, 4000))).toEqual(Array.from(copy.subarray(0, 4000)));
    expect(Array.from(b.mips[0]!.data)).toEqual(Array.from(copy));
  });

  it('have the atlas sizes, full mip chains and stay tiny (no APK growth, < 1.5 MB of memory)', () => {
    const l = leafAtlas();
    const im = impostorAtlas();
    expect([l.width, l.height]).toEqual([LEAF_TILES * TILE, TILE]);
    expect([im.width, im.height]).toEqual([IMPOSTOR_SLOTS * IMP_W, IMP_H]);
    for (const t of [l, im]) {
      expect(t.mips[0]!.data.length).toBe(t.width * t.height * 4);
      expect(t.mips.at(-1)!.width).toBe(1);
      expect(t.mips.at(-1)!.height).toBe(1);
      for (let i = 1; i < t.mips.length; i++) expect(t.mips[i]!.width).toBe(Math.max(1, t.mips[i - 1]!.width >> 1));
    }
    expect(textureBytes()).toBeLessThan(1.5e6);
  });

  it('paint foliage with holes: every leaf tile is partly, not fully, opaque, and impostors have transparent margins', () => {
    const l = leafAtlas();
    for (let t = 0; t < LEAF_TILES; t++) {
      let opaque = 0;
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) if (l.mips[0]!.data[(y * l.width + t * TILE + x) * 4 + 3]! >= 128) opaque++;
      const f = opaque / (TILE * TILE);
      expect(f).toBeGreaterThan(0.08);
      expect(f).toBeLessThan(0.85);
    }
    const im = impostorAtlas();
    for (let s = 0; s < IMPOSTOR_SLOTS; s++) {
      // The outermost columns of a slot are empty (no bleeding into the neighbour slot).
      for (let y = 0; y < IMP_H; y++) {
        expect(im.mips[0]!.data[(y * im.width + s * IMP_W) * 4 + 3]).toBe(0);
        expect(im.mips[0]!.data[(y * im.width + s * IMP_W + IMP_W - 1) * 4 + 3]).toBe(0);
      }
    }
  });

  it('keep the proportion of opaque texels through the mip chain (foliage does not thin out with distance)', () => {
    const l = leafAtlas();
    const c0 = coverage(l.mips[0]!.data);
    for (let i = 1; i <= 4; i++) expect(Math.abs(coverage(l.mips[i]!.data) - c0)).toBeLessThan(0.06);
  });
});
