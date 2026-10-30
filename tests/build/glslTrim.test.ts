/**
 * scripts/glslTrim.ts (used by vite.config.ts in builds only) leaves out three's built-in material shaders that the app never
 * draws with. This fences what it does:
 *  - every `#include` of the app's own shaders is a chunk that is kept, and the app draws with ShaderMaterial and no light only,
 *  - three's file still has the shape the stub reads (a three update that moves it fails here, not silently),
 *  - a build with the app's own vite.config.ts has the stub in it, and what the renderer and the app's shaders need is whole.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { build, type Rolldown } from 'vite';
import { KEPT_BUILT_IN_SHADERS, KEPT_SHADER_CHUNKS, LEFT_OUT_SHADER_TEXT, keptThreeChunks, stubUnusedThreeShaders } from '../../scripts/glslTrim';
import type * as ThreeEntry from './threeEntry';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const THREE_FILE = path.join(ROOT, 'node_modules/three/build/three.module.js');

/** Every .ts file under src that the app ships: no tests, and none of the dev pages (their own HTML, never built). */
function appSources(dir = path.join(ROOT, 'src')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return appSources(file);
    return /\.ts$/.test(name) && !/\.(test|testing)\.ts$/.test(name) && !/[\\/]src[\\/]render[\\/](dev\w*|legendGallery)\.ts$/.test(file) && !/styleguide/.test(file) ? [file] : [];
  });
}

/** The templates tagged `/* glsl *\/` as they are written (none of these has a backtick in it). */
const glslTemplates = (code: string): string[] => [...code.matchAll(/\/\* glsl \*\/\s*`([^`]*)`/g)].map((m) => m[1]!);

const shaderFiles = appSources().filter((f) => glslTemplates(readFileSync(f, 'utf8')).length > 0);
const threeText = readFileSync(THREE_FILE, 'utf8');

describe('what the app asks of three.js', () => {
  it('draws with ShaderMaterial only: no other material, no light, no shadow', () => {
    const used = appSources().flatMap((f) => {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      return [...code.matchAll(/\b(?:Mesh(?:Standard|Physical|Phong|Lambert|Toon|Matcap|Normal|Depth|Distance)Material|ShadowMaterial|(?:Ambient|Directional|Point|Spot|Hemisphere|RectArea)Light|(?:Light|Directional|Spot|Point)LightShadow)\b/g)].map((m) => `${m[0]} in ${path.relative(ROOT, f)}`);
    });
    expect(used, 'scripts/glslTrim.ts leaves the text of these built-in shaders out: keep them, or do not use them').toEqual([]);
  });

  it('only `#include`s three chunks that the build keeps (add the chunk to KEPT_SHADER_CHUNKS in scripts/glslTrim.ts)', () => {
    const kept = keptThreeChunks(threeText, KEPT_SHADER_CHUNKS);
    expect(kept).not.toBeNull();
    const included = new Set(shaderFiles.flatMap((f) => glslTemplates(readFileSync(f, 'utf8')).flatMap((glsl) => [...glsl.matchAll(/#include <(\w+)>/g)].map((m) => m[1]!))));
    expect(included.size).toBeGreaterThan(0);
    for (const chunk of included) expect(kept!.has(chunk), chunk).toBe(true);
  });
});

describe('stubUnusedThreeShaders on the installed three.js', () => {
  const stubbed = stubUnusedThreeShaders(threeText);
  const kept = keptThreeChunks(threeText, KEPT_SHADER_CHUNKS);

  it('still reads the file (null means three moved its ShaderChunk table or its chunks)', () => {
    expect(stubbed).not.toBeNull();
    expect(kept).not.toBeNull();
  });

  it('keeps every line in place and takes at least 100 kB out', () => {
    expect(stubbed!.split('\n').length).toBe(threeText.split('\n').length);
    expect(threeText.length - stubbed!.length).toBeGreaterThan(100 * 1024);
  });

  it('keeps what the renderer reaches for by name, what the app includes, and the built-ins that need no light', () => {
    for (const chunk of ['tonemapping_pars_fragment', 'colorspace_pars_fragment', 'colorspace_fragment', 'common', 'fog_fragment']) expect(kept!.has(chunk), chunk).toBe(true);
    for (const prefix of KEPT_BUILT_IN_SHADERS) for (const stage of ['vert', 'frag']) expect(kept!.has(`${prefix}_${stage}`), `${prefix}_${stage}`).toBe(true);
  });

  it('leaves out what only a lit or physically based material reads', () => {
    for (const chunk of ['meshphysical_frag', 'meshphong_frag', 'meshlambert_frag', 'meshtoon_frag', 'meshmatcap_frag', 'lights_physical_pars_fragment', 'transmission_pars_fragment', 'iridescence_pars_fragment', 'shadowmap_pars_fragment', 'cube_uv_reflection_fragment'])
      expect(kept!.has(chunk), chunk).toBe(false);
    expect(stubbed).toContain(LEFT_OUT_SHADER_TEXT);
    expect(stubbed).not.toContain('PhysicalMaterial material;');
  });
});

describe('the build with the app config', () => {
  let built: typeof ThreeEntry;
  let code = '';

  beforeAll(async () => {
    const result = (await build({
      root: ROOT,
      configFile: path.join(ROOT, 'vite.config.ts'),
      mode: 'capacitor',
      logLevel: 'silent',
      build: {
        write: false,
        sourcemap: false,
        copyPublicDir: false,
        lib: { entry: path.join(ROOT, 'tests/build/threeEntry.ts'), formats: ['es'], fileName: 'three' },
        rolldownOptions: { output: { codeSplitting: false } },
      },
    })) as Rolldown.RolldownOutput | Rolldown.RolldownOutput[];
    const chunk = (Array.isArray(result) ? result[0]! : result).output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('no chunk built');
    code = chunk.code;
    built = (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)) as typeof ThreeEntry;
  }, 60000);

  it('has the stub where the lit shaders were, and the renderer still has its own parts', () => {
    expect(code).toContain(LEFT_OUT_SHADER_TEXT);
    expect(code).not.toContain('PhysicalMaterial material;');
    expect(code).not.toContain('uniform sampler2D dfgLUT;');
    expect(built.ShaderChunk.lights_physical_pars_fragment).toBe(LEFT_OUT_SHADER_TEXT);
    expect(built.ShaderLib.physical.fragmentShader).toBe(LEFT_OUT_SHADER_TEXT);
  });

  it('keeps whole every chunk that the app and the renderer use, and the unlit built-ins', () => {
    for (const chunk of ['colorspace_fragment', 'colorspace_pars_fragment', 'tonemapping_pars_fragment', 'common', 'fog_fragment']) {
      const text = (built.ShaderChunk as Record<string, string>)[chunk]!;
      expect(text.length, chunk).toBeGreaterThan(0);
      expect(text, chunk).not.toContain(LEFT_OUT_SHADER_TEXT);
    }
    for (const material of [built.ShaderLib.basic, built.ShaderLib.points, built.ShaderLib.sprite, built.ShaderLib.dashed]) {
      expect(material.vertexShader).not.toContain(LEFT_OUT_SHADER_TEXT);
      expect(material.fragmentShader).not.toContain(LEFT_OUT_SHADER_TEXT);
    }
  });

  it('resolves every `#include` of a kept chunk to text that was not left out', () => {
    const chunks = built.ShaderChunk as Record<string, string>;
    const resolve = (text: string, seen = new Set<string>()): string =>
      text.replace(/#include <(\w+)>/g, (_m, name: string) => {
        expect(chunks[name], `${name} exists`).toBeDefined();
        if (seen.has(name)) return '';
        return resolve(chunks[name]!, new Set(seen).add(name));
      });
    for (const material of [built.ShaderLib.basic, built.ShaderLib.points, built.ShaderLib.sprite, built.ShaderLib.dashed]) {
      expect(resolve(material.vertexShader)).not.toContain(LEFT_OUT_SHADER_TEXT);
      expect(resolve(material.fragmentShader)).not.toContain(LEFT_OUT_SHADER_TEXT);
    }
    expect(resolve('#include <colorspace_fragment>')).not.toContain(LEFT_OUT_SHADER_TEXT);
  });
});
