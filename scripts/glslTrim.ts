/**
 * Build-only trims of the shader text in the 3-D view's chunk (vite.config.ts uses them, `apply: 'build'`: the dev server and
 * vitest keep the real files). Both keep every line number, so a shader error or a source map still points at the source.
 *
 *  - `stubUnusedThreeShaders` leaves out the text of three's built-in materials (lit, physical, toon, ...): the app draws with
 *    `ShaderMaterial` only (its own shaders, `src/render/*.ts`), and three.module.js carries all 142 of its chunks (about 150 kB of
 *    GLSL, 25 kB gzip) because the renderer's `ShaderChunk` table cannot be tree-shaken. A chunk that is left out becomes a one-line
 *    `#error`, so a shader that asked for it fails to compile with a message instead of drawing without that code.
 *  - `minifyGlslTemplates` takes the comments and the indentation out of our own shaders (the templates tagged `/* glsl *\/`),
 *    which is what three's own build does to its chunks.
 *
 * tests/build/glslTrim.test.ts fences both (what is kept, that no shader token changes, that the app's own `#include`s are
 * kept) and builds a small entry with the app's config.
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
const SHADER_SOURCE = /[\\/]src[\\/]render[\\/].*\.ts$/;

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

/**
 * GLSL without its comments (a block comment is a space, as the language defines it), its indentation, its trailing spaces or its
 * runs of spaces. Every newline stays, so no line moves; a preprocessor line keeps its own line.
 */
export function minifyGlsl(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; ) {
    if (text.startsWith('//', i)) {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return text;
      out += ' ' + '\n'.repeat(text.slice(i, end).split('\n').length - 1);
      i = end + 2;
    } else out += text[i++];
  }
  return out
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n');
}

const MARKER = '/* glsl */';
const HOLE = '';

/** A template literal that starts at `open` (a backtick): its text with each `${...}` as HOLE, those expressions, and where it ends. */
function readTemplate(code: string, open: number): { text: string; holes: string[]; close: number } | null {
  let text = '';
  const holes: string[] = [];
  for (let i = open + 1; i < code.length; i++) {
    const c = code[i]!;
    if (c === '`') return { text, holes, close: i };
    if (c === '\\' || c === HOLE) return null; // an escape would mean something else once the text is cut about
    if (c === '$' && code[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      for (; j < code.length && depth > 0; j++) {
        const d = code[j]!;
        if (d === '{') depth++;
        else if (d === '}') depth--;
        else if (d === '`' || d === "'" || d === '"') return null; // a nested string: leave this shader as it is
      }
      if (depth > 0) return null;
      holes.push(code.slice(i, j));
      text += HOLE;
      i = j - 1;
    } else text += c;
  }
  return null;
}

/** `code` with every template literal tagged `/* glsl *\/` minified, or null when there is none to change. */
export function minifyGlslTemplates(code: string): string | null {
  let out = '';
  let at = 0;
  for (let m = code.indexOf(MARKER); m >= 0; m = code.indexOf(MARKER, at)) {
    let open = m + MARKER.length;
    while (code[open] === ' ' || code[open] === '\t') open++;
    const template = code[open] === '`' ? readTemplate(code, open) : null;
    if (!template) {
      out += code.slice(at, m + MARKER.length);
      at = m + MARKER.length;
      continue;
    }
    const parts = minifyGlsl(template.text).split(HOLE);
    // A hole inside a comment went with the comment: keep the shader as written rather than run without that expression.
    const text = parts.length === template.holes.length + 1 ? parts.map((part, k) => part + (template.holes[k] ?? '')).join('') : null;
    out += code.slice(at, open + 1) + (text ?? code.slice(open + 1, template.close));
    at = template.close;
  }
  return at === 0 ? null : out + code.slice(at);
}

export function trimGlsl(): Plugin[] {
  return [
    {
      name: 'firesim-minify-glsl',
      apply: 'build',
      enforce: 'pre',
      transform(code, id) {
        if (!SHADER_SOURCE.test(id) || !code.includes(MARKER)) return null;
        const out = minifyGlslTemplates(code);
        return out === null || out === code ? null : { code: out, map: null }; // no line moves, so the map stays right
      },
    },
    {
      name: 'firesim-stub-unused-three-shaders',
      apply: 'build',
      enforce: 'pre',
      transform(code, id) {
        if (!THREE_MODULE.test(id)) return null;
        const out = stubUnusedThreeShaders(code);
        return out === null ? null : { code: out, map: null };
      },
    },
  ];
}
