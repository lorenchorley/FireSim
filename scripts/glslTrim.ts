/**
 * Build-only trim of the shader text in the 3-D view's chunk (vite.config.ts uses it, `apply: 'build'`: the dev server and
 * vitest keep the real files). It keeps every line number, so a source map still points at the source.
 *
 * `stubUnusedThreeShaders` leaves out the text of three's built-in materials (lit, physical, toon, ...): the app draws with
 * `ShaderMaterial` only (its own shaders, `src/render/*.ts`), and three.module.js carries all 142 of its chunks (about 150 kB of
 * GLSL, 25 kB gzip) because the renderer's `ShaderChunk` table cannot be tree-shaken. A chunk that is left out becomes a one-line
 * `#error`, so a shader that asked for it fails to compile with a message instead of drawing without that code.
 *
 * tests/build/glslTrim.test.ts fences it (what is kept, that the app's own `#include`s are kept, that three's file still has the
 * shape it reads) and builds a small entry with the app's config.
 */
import type { Plugin } from 'vite';

/**
 * three's shader chunks the app's own shaders `#include` (`src/render/*.ts`); the closure of their own `#include`s is kept too.
 * The renderer's two direct uses (`tonemapping_pars_fragment`, `colorspace_pars_fragment`) are found in three's text itself.
 */
export const KEPT_SHADER_CHUNKS = ['colorspace_fragment'] as const;

/**
 * Built-in materials that need no lights, kept whole in case a Mesh, Points, Sprite or Line is ever made without a
 * ShaderMaterial (their default is a MeshBasic, Points, Sprite or LineBasic material). Names are the prefixes of
 * `ShaderChunk` keys (`meshbasic_vert`, `meshbasic_frag`, ...). A lit material is never kept: the scene has no lights.
 */
export const KEPT_BUILT_IN_SHADERS = ['meshbasic', 'points', 'sprite', 'linedashed'] as const;

/** What a left-out chunk says when a shader still asks for it (an `#error` stops the compile, with this text in the log). */
export const LEFT_OUT_SHADER_TEXT = '#error firesim: this three.js shader chunk is left out of the build (scripts/glslTrim.ts)';

const THREE_MODULE = /[\\/]node_modules[\\/]three[\\/]build[\\/]three\.module\.js$/;

/** The `ShaderChunk` table's key to the variable that holds the chunk's text, and where each of those variables is assigned. */
interface ThreeShaderTable {
  keyToVariable: Map<string, string>;
  /** `var name = "...";` lines before the table: name, start and end offsets of the literal (quotes included), and its text. */
  literals: Map<string, { start: number; end: number; text: string }>;
}

function readThreeShaderTable(code: string): ThreeShaderTable | null {
  const open = code.indexOf('\nconst ShaderChunk = {');
  const close = open < 0 ? -1 : code.indexOf('\n};', open);
  if (close < 0) return null;
  const keyToVariable = new Map<string, string>();
  for (const m of code.slice(open, close).matchAll(/^\t([\w$]+): ([\w$]+),?$/gm)) keyToVariable.set(m[1]!, m[2]!);
  const literals = new Map<string, { start: number; end: number; text: string }>();
  for (const m of code.slice(0, open).matchAll(/^(?:var|const) ([\w$]+) = ("(?:[^"\\\n]|\\.)*");$/gm)) {
    const start = m.index + m[0].indexOf('"');
    literals.set(m[1]!, { start, end: start + m[2]!.length, text: m[2]!.slice(1, -1) });
  }
  return keyToVariable.size > 100 && literals.size > 100 ? { keyToVariable, literals } : null;
}

/** The chunks to keep: the renderer's own direct uses, `extra`, and everything the kept chunks `#include`, to any depth. */
export function keptThreeChunks(code: string, extra: readonly string[]): Set<string> | null {
  const table = readThreeShaderTable(code);
  if (!table) return null;
  const direct = [...code.matchAll(/ShaderChunk\[ '([\w]+)' \]/g)].map((m) => m[1]!);
  const roots = new Set<string>([...direct, ...extra]);
  for (const prefix of KEPT_BUILT_IN_SHADERS) for (const key of table.keyToVariable.keys()) if (key === `${prefix}_vert` || key === `${prefix}_frag`) roots.add(key);
  const kept = new Set<string>();
  const queue = [...roots];
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    if (kept.has(key)) continue;
    kept.add(key);
    const text = table.literals.get(table.keyToVariable.get(key) ?? '')?.text ?? '';
    for (const m of text.matchAll(/#include <([\w]+)>/g)) queue.push(m[1]!);
  }
  return kept;
}

/**
 * three.module.js with the text of every shader chunk outside `keptThreeChunks` replaced by `LEFT_OUT_SHADER_TEXT`, or null when
 * the file no longer has the shape this reads (a three update): the build then ships three whole and the test fails.
 */
export function stubUnusedThreeShaders(code: string, extra: readonly string[] = KEPT_SHADER_CHUNKS): string | null {
  const table = readThreeShaderTable(code);
  const kept = keptThreeChunks(code, extra);
  if (!table || !kept) return null;
  const left = new Set<{ start: number; end: number }>();
  for (const [key, variable] of table.keyToVariable) {
    const literal = table.literals.get(variable);
    if (literal && !kept.has(key)) left.add(literal);
  }
  const ordered = [...left].sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const { start, end } of ordered) {
    out += code.slice(at, start) + JSON.stringify(LEFT_OUT_SHADER_TEXT);
    at = end;
  }
  return out + code.slice(at);
}

export function trimGlsl(): Plugin[] {
  return [
    {
      name: 'firesim-stub-unused-three-shaders',
      apply: 'build',
      enforce: 'pre',
      transform(code, id) {
        if (!THREE_MODULE.test(id)) return null;
        const out = stubUnusedThreeShaders(code);
        return out === null ? null : { code: out, map: null }; // no line moves, so there is no map to make
      },
    },
  ];
}
