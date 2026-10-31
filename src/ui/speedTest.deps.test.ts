/**
 * The speed test never reads or feeds a result (0.7.0, item C; plan 4, rules 1 and 2): it is a number for a person to read on the debug statistics screen and
 * nothing else. A dependency fence, both ways:
 *   - only the statistics screen, its pure content and the test's own files may import any speedTest* module: not the simulation, the atmosphere, the fire, the
 *     embers, the explain engine, the scenario, the session, the pace tracker, the tier choice (Auto) or any other file (a stray import would also pull the
 *     kernels into the entry chunk);
 *   - the test's own files import nothing of the app: no simulation, session, scenario, render or settings code (so it cannot read a run, and the worker stays tiny).
 * Type-only imports count as imports: the fence is about knowing the other side exists.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');
const posix = (p: string): string => p.split('\\').join('/');

/** The module specifiers a source file names: static imports and exports, side-effect imports and dynamic imports, comments left out. */
function specifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found = new Set<string>();
  for (const re of [/\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, /new URL\(\s*['"]([^'"]+)['"]/g]) {
    for (let m = re.exec(text); m; m = re.exec(text)) found.add(m[1]!);
  }
  return [...found];
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const ALL = sources(SRC).map((f) => ({ file: posix(relative(SRC, f)), abs: f }));
const isTest = (f: string): boolean => /\.test\.tsx?$/.test(f) || /\.testing\.tsx?$/.test(f);
const OWN = ['ui/speedTest.ts', 'ui/speedTest.worker.ts', 'ui/speedTestKernels.ts', 'ui/speedTestModel.ts'];
/** The only files that may name a speedTest* module, besides the tests of the test itself. */
const ALLOWED_IMPORTERS = new Set([...OWN, 'ui/debugStats.ts', 'ui/screens/debugStats.ts']);
const names = (spec: string): boolean => /(^|\/)speedTest[\w.]*$/.test(spec);

describe('who may import the speed test', () => {
  it('the walk sees the source tree and the files that do use it (so an empty answer cannot pass)', () => {
    expect(ALL.length).toBeGreaterThan(300);
    const users = ALL.filter((f) => !isTest(f.file) && specifiers(f.abs).some(names)).map((f) => f.file);
    expect(users).toContain('ui/screens/debugStats.ts');
    expect(users).toContain('ui/debugStats.ts');
    expect(users).toContain('ui/speedTest.ts');
  });

  it('nothing outside the statistics screen, its content and the test itself imports a speedTest module', () => {
    const strays = ALL.filter((f) => !isTest(f.file) && !ALLOWED_IMPORTERS.has(f.file) && specifiers(f.abs).some(names)).map((f) => `${f.file} imports ${specifiers(f.abs).filter(names).join(', ')}`);
    expect(strays).toEqual([]);
  });

  it('in particular nothing under sim, atmosphere, fire, embers, explain, scenario or core, and not the session, the pace tracker or the settings', () => {
    const fenced = /^(sim|atmosphere|fire|embers|explain|scenario|core)\//;
    const fencedFiles = ['ui/session.ts', 'ui/paceModel.ts', 'ui/paceTypes.ts', 'ui/paceSheetModel.ts', 'ui/settings.ts', 'ui/mockSim.ts', 'ui/app.ts'];
    const sees = ALL.filter((f) => (fenced.test(f.file) || fencedFiles.includes(f.file)) && specifiers(f.abs).some(names)).map((f) => f.file);
    expect(sees).toEqual([]);
    expect(ALL.filter((f) => fenced.test(f.file)).length, 'the fenced folders are there to be searched').toBeGreaterThan(50);
    for (const f of fencedFiles) expect(ALL.map((a) => a.file), f).toContain(f);
  });

  it('the app never builds the worker for anything else: only speedTest.ts names speedTest.worker', () => {
    const users = ALL.filter((f) => specifiers(f.abs).some((s) => /speedTest\.worker/.test(s))).map((f) => f.file);
    expect(users.filter((f) => !isTest(f))).toEqual(['ui/speedTest.ts']);
  });
});

describe('what the speed test may import', () => {
  it('its own files import only each other: nothing of the simulation, the session, the scenario, the render code or the settings', () => {
    for (const f of OWN) {
      const abs = ALL.find((a) => a.file === f)?.abs;
      expect(abs, `${f} exists`).toBeTruthy();
      for (const spec of specifiers(abs!)) expect(spec.startsWith('./speedTest'), `${f} imports ${spec}`).toBe(true);
    }
  });

  it('the worker imports only the kernels (it is a tiny file of its own)', () => {
    expect(specifiers(join(SRC, 'ui', 'speedTest.worker.ts'))).toEqual(['./speedTestKernels']);
  });

  it('the kernels and the model read nothing but their arguments: no clock, no random, no storage, no DOM', () => {
    for (const f of ['ui/speedTestKernels.ts', 'ui/speedTestModel.ts']) {
      const text = readFileSync(join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(text, f).not.toMatch(/Math\.random|Date\.now|performance\.now|localStorage|sessionStorage|document\.|window\.|navigator\./);
    }
  });
});
