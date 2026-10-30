/**
 * What the glyph engine may depend on, and what may depend on it (plan 9.3 and the bundle budget of stage E1). The engine is pure: no Three.js,
 * no DOM, no `Math.random`, nothing of the simulation, the fire or the atmosphere model's internals, none of the render layers.
 * And the code of the first screen (src/ui, the layer catalogue) must not import it: it lives in the render chunk, which loads
 * when the simulation screen builds the view, and one stray import would pull it into the entry. Only `glyphTypes.ts` (types and
 * constants) and the words file are for the UI.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..', '..');
const WIND = join(SRC, 'render', 'wind');
const ENGINE = ['flowGlyphs.ts', 'glyphLod.ts', 'glyphPose.ts', 'glyphField.ts', 'detailStreaks.ts'].map((f) => join(WIND, f));

const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The modules a TypeScript file imports at run time (type-only imports are erased and not followed). */
function importsOf(file: string, withTypes = false): string[] {
  const text = strip(readFileSync(file, 'utf8'));
  const found = new Set<string>();
  const from = withTypes ? /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g : /\b(?:import|export)\b(?!\s+type\b)[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g;
  for (const re of [from, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (let m = re.exec(text); m; m = re.exec(text)) found.add(m[1]!);
  }
  return [...found];
}

function resolveModule(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [`${base}.ts`, base, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** Every file reachable from `entry` through relative imports, and the packages named on the way. */
function closure(entry: string): { files: string[]; packages: Map<string, string> } {
  const seen = new Set<string>([entry]);
  const packages = new Map<string, string>();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop()!;
    for (const spec of importsOf(f)) {
      if (spec.startsWith('.')) {
        const r = resolveModule(f, spec);
        if (r && !seen.has(r)) {
          seen.add(r);
          queue.push(r);
        }
      } else if (!packages.has(spec)) packages.set(spec, f);
    }
  }
  return { files: [...seen].map((f) => relative(SRC, f)), packages };
}

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourcesUnder(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('the engine is pure', () => {
  it('the walk finds the palette and the core types the engine does use (so an empty answer cannot pass)', () => {
    const { files } = closure(join(WIND, 'flowGlyphs.ts'));
    expect(files).toContain(join('render', 'palette.ts'));
    expect(files).toContain(join('render', 'wind', 'glyphTypes.ts'));
  });

  it('the detailed streaks builder reaches the glyph builder and the types, and nothing that draws', () => {
    const { files } = closure(join(WIND, 'detailStreaks.ts'));
    expect(files).toContain(join('render', 'wind', 'flowGlyphs.ts'));
    expect(files).toContain(join('render', 'wind', 'glyphTypes.ts'));
    expect(files.filter((f) => /detailBatch|windGlyphLayer|streaks\.ts$/.test(f))).toEqual([]);
  });

  it('no engine file reaches Three.js, the simulation, the fire, the atmosphere model, the UI, the data code or a render layer', () => {
    for (const entry of ENGINE) {
      const { files, packages } = closure(entry);
      const name = relative(SRC, entry);
      expect([...packages.keys()].filter((p) => p === 'three' || p.startsWith('three/')), `${name}: packages`).toEqual([]);
      const banned = files.filter((f) => /^(sim|fire|atmosphere|ui|data|scenario|app)[\\/]/.test(f) || /render[\\/](\w+Layer|SceneView|cameraRig|textures|terrainLayer|streaks|windLayer|dev)\.ts$/.test(f));
      expect(banned, `${name}: reachable files`).toEqual([]);
    }
  });

  it('the sampler is used as a type only (no run-time import of the air model code)', () => {
    for (const entry of ENGINE) expect(importsOf(entry).filter((s) => /atmosphereSampler|atmosphere[\\/]/.test(s)), relative(SRC, entry)).toEqual([]);
  });

  it('no engine file touches the DOM or draws a random number', () => {
    for (const file of [...ENGINE, join(WIND, 'glyphTypes.ts')]) {
      const text = strip(readFileSync(file, 'utf8'));
      expect(text, relative(SRC, file)).not.toMatch(/\b(document|window|navigator|HTMLElement|HTMLCanvasElement|requestAnimationFrame|localStorage|sessionStorage|OffscreenCanvas|Image)\b/);
      expect(text, relative(SRC, file)).not.toMatch(/Math\s*\.\s*random\s*\(/);
    }
  });

  it('the walk does see three where it is imported (streaks.ts)', () => {
    expect([...closure(join(SRC, 'render', 'streaks.ts')).packages.keys()]).toContain('three');
  });
});

describe('the first screen stays out of the engine', () => {
  const FORBIDDEN = /(^|[\\/])(flowGlyphs|glyphField|glyphLod|glyphPose|glyphOracle\.testing|windGlyphLayer|detailStreaks|detailStreaks\.testing|detailBatch)$/;
  const entryFiles = [...sourcesUnder(join(SRC, 'ui')), join(SRC, 'render', 'layerCatalog.ts')];

  it('finds the files it checks', () => {
    expect(entryFiles.length).toBeGreaterThan(50);
    expect(entryFiles).toContain(join(SRC, 'ui', 'screens', 'sim', 'layersPanel.ts'));
  });

  it('nothing in src/ui or the layer catalogue imports flowGlyphs, glyphField, glyphLod, glyphPose, windGlyphLayer, detailStreaks or detailBatch (types included)', () => {
    const offenders: string[] = [];
    for (const f of entryFiles) {
      for (const spec of importsOf(f, true)) if (FORBIDDEN.test(spec.replace(/\.ts$/, ''))) offenders.push(`${relative(SRC, f)} imports ${spec}`);
    }
    expect(offenders).toEqual([]);
  });
});
