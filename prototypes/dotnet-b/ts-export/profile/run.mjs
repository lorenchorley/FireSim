#!/usr/bin/env node
/**
 * Stage 1 profile runner (T1.1). From the repository root:
 *   node prototypes/dotnet-b/ts-export/profile/run.mjs build   --out BUILD_DIR [--count]      (--count: the build for the counting runs, with `**` rewritten to a counted call)
 *   node prototypes/dotnet-b/ts-export/profile/run.mjs time    NAME --build BUILD_DIR --prof PROF_DIR [--tag T] [--seed 13] [--to 1800] [--duration S] [--interval 100]   one process under `node --cpu-prof`
 *   node prototypes/dotnet-b/ts-export/profile/run.mjs plain   NAME --build BUILD_DIR [...]                                                      one process, no profiler (the app's own module timers)
 *   node prototypes/dotnet-b/ts-export/profile/run.mjs count   NAME --build BUILD_DIR [...]                                                      one process with the Math counters
 * Every command prints the harness's JSON line. Use `flock /tmp/firesim-heavy.lock` outside. Builds a preserveModules bundle with the repository's Vite.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..');
const opt = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const cmd = process.argv[2];
/**
 * Count build only (`--count`): the `**` operator is not `Math.pow`, so it cannot be seen by wrapping Math. This plugin rewrites every `a ** b` of the
 * solver's TypeScript to `globalThis.__fsStarStar(a, b)` (same value: it calls the same `**`), which counts the calls ('**2' when the exponent is 2).
 * It parses with the repository's TypeScript and edits the text of src/ in memory only; src/ on disk is untouched.
 */
async function starStarPlugin() {
  const ts = (await import('typescript')).default;
  return {
    name: 'fs-count-starstar',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts') || !id.includes('/src/') || id.endsWith('.test.ts')) return null;
      const sf = ts.createSourceFile(id, code, ts.ScriptTarget.ES2022, true);
      const isPow = (n) => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken;
      let found = false;
      // Text of node n with every `**` inside it (and n itself) replaced by the counting call; children are rewritten first, outermost last.
      const render = (n, from = n.getStart(sf)) => {
        if (isPow(n)) {
          found = true;
          return `globalThis.__fsStarStar((${render(n.left)}), (${render(n.right)}))`;
        }
        const kids = [];
        const collect = (c) => {
          if (isPow(c)) kids.push(c);
          else ts.forEachChild(c, collect);
        };
        ts.forEachChild(n, collect);
        let out = '';
        let pos = from;
        for (const c of kids) {
          out += code.slice(pos, c.getStart(sf)) + render(c);
          pos = c.getEnd();
        }
        return out + code.slice(pos, n.getEnd());
      };
      const rewrite = (root) => render(root, 0);
      const out = rewrite(sf);
      return found ? { code: out, map: null } : null;
    },
  };
}

if (cmd === 'build') {
  const out = resolve(opt('out'));
  const { build } = await import('vite');
  const plugins = process.argv.includes('--count') ? [await starStarPlugin()] : [];
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({
    root,
    configFile: false,
    publicDir: false,
    plugins,
    logLevel: 'warn',
    build: {
      ssr: true,
      outDir: out,
      emptyOutDir: true,
      target: 'node22',
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: { profile: 'prototypes/dotnet-b/ts-export/profile/profile.ts' },
        output: { format: 'es', entryFileNames: '[name].mjs', preserveModules: true, preserveModulesRoot: root },
      },
    },
  });
} else {
  const name = process.argv[3];
  const b = resolve(opt('build'));
  const extra = ['seed', 'to', 'duration'].flatMap((k) => (opt(k) !== undefined ? [`--${k}`, opt(k)] : []));
  const env = { ...process.env, FS_REPO_ROOT: root };
  const args = ['--max-old-space-size=4096'];
  const tag = opt('tag') ?? `${name}-${cmd}`;
  if (cmd === 'time') {
    mkdirSync(resolve(opt('prof')), { recursive: true });
    args.push('--cpu-prof', '--cpu-prof-dir', resolve(opt('prof')), '--cpu-prof-name', `${tag}.cpuprofile`, '--cpu-prof-interval', opt('interval') ?? '100');
  }
  if (cmd === 'count') env.FS_COUNT = '1';
  const entry = join(b, 'profile.mjs');
  // Load average at the start (inside the heavy-work lock when started under flock): above 3.5, wait up to 3 minutes for it to fall, then run and say so.
  const maxLoad = Number(opt('max-load') ?? 3.5);
  const sh = (c) => spawnSync(c, { shell: true, encoding: 'utf8' }).stdout.trim();
  const load = () => readFileSync('/proc/loadavg', 'utf8').trim().split(' ').slice(0, 3).map(Number);
  let waited = 0;
  while (load()[0] > maxLoad && waited < 180) {
    spawnSync('sleep', ['10']);
    waited += 10;
  }
  // The busiest processes before and after, so that a run disturbed by someone else's unlocked work can be seen (and repeated).
  const top = () => sh('ps -eo pcpu,pid,etime,args --sort=-pcpu --no-headers | head -5 | cut -c1-140');
  const before = { uptime: sh('uptime'), loadavg: load(), waitedS: waited, highLoadAtStart: load()[0] > maxLoad, topProcesses: top() };
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [...args, entry, name, ...extra], { stdio: ['ignore', 'pipe', 'inherit'], cwd: root, encoding: 'utf8', env, maxBuffer: 1 << 28 });
  const after = { uptime: sh('uptime'), loadavg: load(), topProcesses: top() };
  if (r.status !== 0) {
    process.stdout.write(r.stdout ?? '');
    process.exit(r.status ?? 1);
  }
  const out = JSON.parse((r.stdout ?? '').trim().split('\n').pop());
  out.envelope = { tag, cmd, startedAt: new Date(t0).toISOString(), wallProcessMs: Date.now() - t0, before, after, cpuProfile: cmd === 'time' ? join(resolve(opt('prof')), `${tag}.cpuprofile`) : undefined };
  process.stdout.write(JSON.stringify(out) + '\n');
}
