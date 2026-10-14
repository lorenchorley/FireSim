/**
 * The terrain layer with and without the cliff drawing (plan 9d.3.2, 9d.3.3, 9d.3.5), without a WebGL context (the layer only builds
 * Three.js objects, textures and shader source until it is drawn): which gradient lights the ground, where the slope that picks rock or the
 * photo comes from, the rock mask texture, the tier's shader defines, and that the old path (no 10 m terrain) is untouched.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildCliffDrawing, cliffDefines, ROCK_DETAIL_PLAIN, type DetailTier } from './cliffDrawing';
import { gridTransform } from './coords';
import { lightTerrain } from './fields';
import { TerrainLayer } from './terrainLayer';
import { flatGrid, terrainOf } from './testing/cliffs';

const TAN = (deg: number): number => Math.tan((deg * Math.PI) / 180);
const FACE_RUN = 150 / TAN(70);
const g = flatGrid(180, 60);
const z = terrainOf(g, (i) => {
  const x = i * 10;
  return x <= 700 ? 600 : x <= 700 + FACE_RUN ? 600 - (x - 700) * TAN(70) : 450 - (x - 700 - FACE_RUN) * TAN(30);
});

const v = (value: unknown): THREE.IUniform => ({ value });
function shared(): Record<string, THREE.IUniform> {
  return {
    uVex: v(1),
    uClock: v(0),
    uSunDir: v(new THREE.Vector3(0.3, 0.8, -0.4).normalize()),
    uSunColour: v(new THREE.Color(1, 0.95, 0.88)),
    uSunI: v(2.6),
    uSkyAmb: v(new THREE.Color(0.5, 0.6, 0.8)),
    uGroundAmb: v(new THREE.Color(0.3, 0.26, 0.2)),
    uAmbI: v(0.65),
    uNight: v(0),
    uMapNight: v(0),
    uShadowGain: v(1),
    uExposure: v(1),
    uFogColour: v(new THREE.Color(0.7, 0.78, 0.88)),
    uFogDensity: v(1 / 45000),
  };
}

const cover = { grid: g, canopyCover: new Float32Array(g.nx * g.ny) };
const drawing = (tier: DetailTier) => buildCliffDrawing({ hi: { grid: g, elevation: z }, fuel: cover, meshN: 90, tier, source: 'test' });

/** A layer the way SceneView builds it with a 10 m terrain, and one the way it builds it without. */
function withCliff(tier: DetailTier): { layer: TerrainLayer; cd: ReturnType<typeof drawing> } {
  const cd = drawing(tier);
  const fire = lightTerrain({ grid: { ...g, nx: 60, ny: 20, cellSize: 30 }, elevation: new Float32Array(60 * 20).fill(500), ratio: 1 }, 'test'); // a 30 m fire-grid terrain
  const layer = new TerrainLayer(cd.mesh, fire, shared(), 4, { gradient: cd.gradient, meshSlope: cd.meshSlope, mask: cd.mask, detail: tier });
  return { layer, cd };
}
function withoutCliff(): { layer: TerrainLayer; fire: ReturnType<typeof lightTerrain> } {
  const rg = { grid: { ...g, nx: 90, ny: 30, cellSize: 20 }, elevation: new Float32Array(90 * 30).fill(500), ratio: 2 };
  const fire = lightTerrain({ grid: { ...g, nx: 60, ny: 20, cellSize: 30 }, elevation: new Float32Array(60 * 20).fill(500), ratio: 1 }, 'test');
  return { layer: new TerrainLayer(rg, fire, shared(), 4), fire };
}

/** What the GLSL preprocessor leaves of `src` for these defines (#ifdef, #ifndef, #else and #endif, nested; the only directives the shaders use). */
function preprocess(src: string, defines: Record<string, unknown>): string {
  const out: string[] = [];
  const stack: { on: boolean; taken: boolean; parent: boolean }[] = [];
  const live = (): boolean => stack.every((f) => f.on);
  for (const line of src.split('\n')) {
    const t = line.trim();
    const m = /^#(ifdef|ifndef)\s+(\w+)/.exec(t);
    if (m) {
      const on = (m[2]! in defines) === (m[1] === 'ifdef');
      stack.push({ on, taken: on, parent: live() });
    } else if (t === '#else') {
      const f = stack[stack.length - 1]!;
      f.on = !f.taken;
    } else if (t === '#endif') stack.pop();
    else if (live()) out.push(line);
  }
  return out.join('\n');
}

const samplers = (src: string): string[] => [...src.matchAll(/uniform\s+sampler2D\s+(u[A-Za-z0-9]+)/g)].map((m) => m[1]!);

describe('TerrainLayer with the cliff drawing', () => {
  const { layer, cd } = withCliff('high');
  const u = layer.uniforms;

  it('lights from the sharpened 10 m gradient: the normal texture is on the 10 m grid, not the fire grid', () => {
    const tex = u.uGrad!.value as THREE.DataTexture;
    expect([tex.image.width, tex.image.height]).toEqual([g.nx, g.ny]);
    expect((u.uGradXf!.value as THREE.Vector4).toArray()).toEqual(gridTransform(g));
    expect(tex.format).toBe(THREE.RGFormat);
    expect(tex.type).toBe(THREE.HalfFloatType);
  });

  it("takes the slope that picks banded rock or the photo from the mesh's own gradient, per vertex (spike S5)", () => {
    const attr = layer.mesh.geometry.getAttribute('aSlope') as THREE.BufferAttribute;
    expect(attr.count).toBe(cd.mesh.grid.nx * cd.mesh.grid.ny);
    expect(attr.array).toBe(cd.meshSlope);
    const m = layer.material;
    expect(m.vertexShader).toMatch(/attribute float aSlope/);
    expect(m.fragmentShader).toMatch(/slope = vSlope;/);
  });

  it('the rock mask is a linear RGBA8 texture on the 10 m grid with its own transform', () => {
    const tex = u.uRock!.value as THREE.DataTexture;
    expect([tex.image.width, tex.image.height]).toEqual([g.nx, g.ny]);
    expect(tex.format).toBe(THREE.RGBAFormat);
    expect(tex.type).toBe(THREE.UnsignedByteType);
    expect(tex.colorSpace).not.toBe(THREE.SRGBColorSpace); // masks are data
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    expect(tex.image.data).toBe(cd.mask.rgba);
    expect((u.uRockXf!.value as THREE.Vector4).toArray()).toEqual(gridTransform(cd.mask.grid));
    expect(u.uRockPlain!.value).toBe(ROCK_DETAIL_PLAIN);
  });

  it('says its detail tier and how long the textures took to fill', () => {
    expect(layer.rockDetail).toBe('high');
    expect(layer.cliffTextureMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(layer.cliffTextureMs)).toBe(true);
  });

  it('adds exactly one sampler (11 of the 16 fragment units), and keeps the night lighting line', () => {
    const names = samplers(layer.material.fragmentShader);
    expect(names).toContain('uRock');
    expect(new Set(names).size).toBe(11);
    expect(layer.material.fragmentShader).toContain('float shadow = shade.b * uShadowGain;');
  });

  it.each(['high', 'medium', 'low'] as const)('the %s tier compiles the effects it draws and no others', (tier) => {
    const l = withCliff(tier).layer;
    expect(l.rockDetail).toBe(tier);
    expect(l.material.defines).toEqual(cliffDefines(tier));
    // after the preprocessor: the joints' crack noise only at High, the overhang's shade only at High, the pavement not at Low
    const frag = preprocess(l.material.fragmentShader, l.material.defines ?? {});
    expect(frag.includes('rkNoise(vec2(p.x / 3.2 + 11.7, 3.7))'), 'joints').toBe(tier === 'high');
    expect(frag.includes('ao *= 1.0 - 0.5 * under'), 'overhang').toBe(tier === 'high');
    expect(frag.includes('rkNoise(p / 6.0 + 5.3)'), 'pavement').toBe(tier !== 'low');
    for (const always of ['rkShelf(ph7 - i7)', 'rkFace(p, tw, 13.0, 31.0, vZ / 90.0)', 'rkNoise(p / 1.3)']) expect(frag, always).toContain(always); // ledges, stains, scree
    expect(frag).toContain('slope = vSlope;');
    expect(new Set(samplers(frag)).size).toBe(11);
    l.dispose();
  });

  it('disposes the textures it made', () => {
    const l = withCliff('low').layer;
    const rock = l.uniforms.uRock!.value as THREE.Texture;
    let disposed = 0;
    rock.addEventListener('dispose', () => disposed++);
    l.dispose();
    expect(disposed).toBe(1);
  });
});

describe('TerrainLayer without a 10 m terrain (the mock, synthetic ground)', () => {
  const { layer, fire } = withoutCliff();

  it('runs the old path: the fire grid lights the ground, there is no rock mask and no mesh slope', () => {
    const tex = layer.uniforms.uGrad!.value as THREE.DataTexture;
    expect([tex.image.width, tex.image.height]).toEqual([60, 20]);
    expect((layer.uniforms.uGradXf!.value as THREE.Vector4).toArray()).toEqual(gridTransform(fire.grid));
    expect(layer.uniforms.uRock).toBeUndefined();
    expect(layer.mesh.geometry.getAttribute('aSlope')).toBeUndefined();
    expect(layer.rockDetail).toBe('off');
    expect(layer.cliffTextureMs).toBe(0);
  });

  it('compiles none of the cliff code: no defines, ten samplers, the old slope and photo switch', () => {
    expect(layer.material.defines).toEqual({});
    const frag = preprocess(layer.material.fragmentShader, layer.material.defines ?? {});
    expect(new Set(samplers(frag)).size).toBe(10);
    for (const gone of ['uRock', 'rockDetail', 'vSlope', 'ROCK_LIT', 'rk.r']) expect(frag, gone).not.toContain(gone);
    expect(frag).toContain('float slope = length(grad);');
    expect(frag).toContain('float shadow = shade.b * uShadowGain;');
    expect(preprocess(layer.material.vertexShader, {})).not.toContain('aSlope');
  });
});
