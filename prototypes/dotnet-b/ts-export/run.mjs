#!/usr/bin/env node
/**
 * One-command runner of the fixture exporter (stage 3a). The solver is TypeScript with extension-less imports, which Node cannot load by
 * itself, so this builds ts-export/export.ts with the repository's own bundler (Vite, SSR build, the way desktop/build.mjs does) into
 * prototypes/dotnet-b/fixtures/.build-ts-export (git ignores `fixtures/`), then runs it with Node, one process per scenario.
 *
 *   node prototypes/dotnet-b/ts-export/run.mjs export all  --out FIXTURES_DIR        every named scenario, one after another
 *   node prototypes/dotnet-b/ts-export/run.mjs export NAME --out FIXTURES_DIR [--seed N] [--to S] [--dir NAME] [--perturb EPS]
 *   node prototypes/dotnet-b/ts-export/run.mjs determinism --out FIXTURES_DIR        katoomba3-fast twice in separate processes, hashes compared
 *   node prototypes/dotnet-b/ts-export/run.mjs verify      --out FIXTURES_DIR [NAME ...]   decode every file with the app's codec, check hashes and arrival.f32
 *   node prototypes/dotnet-b/ts-export/run.mjs study       --out FIXTURES_DIR        tier and seed difference study (needs the fixtures below)
 *   node prototypes/dotnet-b/ts-export/run.mjs list                                  the scenario names
 *
 * `node_modules` must exist in the repository root (npm ci), or be linked there.
 * The `all` set is: katoomba3-fast katoomba6-fast katoomba3-standard katoomba3-high katoomba3-high30 katoomba3-point anchor-080-katoomba6-point katoomba3-fast-noembers katoomba3-standard-noembers katoomba3-high-noembers katoomba3-high30-noembers.
 * The study also reads katoomba3-fast-seed12 and katoomba3-standard-seed12 (`export katoomba3-fast --seed 12`, `export katoomba3-standard --seed 12`).
 * Heavy: run it under `flock /tmp/firesim-heavy.lock` when other work shares the machine.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const buildDir = join(root, 'prototypes', 'dotnet-b', 'fixtures', '.build-ts-export');
const ALL = ['katoomba3-fast', 'katoomba6-fast', 'katoomba3-standard', 'katoomba3-high', 'katoomba3-high30', 'katoomba3-point', 'anchor-080-katoomba6-point', 'katoomba3-fast-noembers', 'katoomba3-standard-noembers', 'katoomba3-high-noembers', 'katoomba3-high30-noembers'];

function opt(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function build() {
  const { build: viteBuild } = await import('vite');
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  await viteBuild({
    root,
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      ssr: true,
      outDir: buildDir,
      emptyOutDir: true,
      target: 'node22',
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: { input: { export: 'prototypes/dotnet-b/ts-export/export.ts', verify: 'prototypes/dotnet-b/ts-export/verify.ts' }, output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' } },
    },
  });
}

function exportOne(name, extra = []) {
  const out = opt('out');
  const r = spawnSync(process.execPath, ['--max-old-space-size=4096', join(buildDir, 'export.mjs'), name, '--out', out, ...extra], { stdio: ['ignore', 'pipe', 'inherit'], cwd: root, encoding: 'utf8', env: { ...process.env, FS_REPO_ROOT: root } });
  process.stdout.write(r.stdout ?? '');
  if (r.status !== 0) console.error(`export ${name} ${extra.join(' ')} exited with ${r.status}`);
  return r.status ?? 1;
}

const cmd = process.argv[2];
if (cmd === 'list') {
  console.log(ALL.join('\n'));
} else if (cmd === 'export') {
  const what = process.argv[3];
  if (!opt('out') || !what) {
    console.error('usage: run.mjs export (all|NAME) --out FIXTURES_DIR [--seed N] [--to S] [--dir NAME]');
    process.exit(2);
  }
  await build();
  const extra = ['seed', 'to', 'dir', 'perturb'].flatMap((k) => (opt(k) !== undefined ? [`--${k}`, opt(k)] : []));
  let bad = 0;
  for (const n of what === 'all' ? ALL : [what]) bad += exportOne(n, what === 'all' ? [] : extra) === 0 ? 0 : 1;
  process.exit(bad ? 1 : 0);
} else if (cmd === 'determinism') {
  const out = opt('out');
  if (!out) {
    console.error('usage: run.mjs determinism --out FIXTURES_DIR');
    process.exit(2);
  }
  await build();
  const runs = ['determinism-a', 'determinism-b'];
  for (const d of runs) if (exportOne('katoomba3-fast', ['--dir', d]) !== 0) process.exit(1);
  const [a, b] = runs.map((d) => JSON.parse(readFileSync(join(out, d, 'hashes.json'), 'utf8')));
  const keys = Object.keys(a);
  const diff = keys.filter((k) => a[k] !== b[k]);
  const same = keys.length === Object.keys(b).length && diff.length === 0;
  console.log(JSON.stringify({ snapshots: keys.length, differing: diff, identical: same }));
  process.exit(same ? 0 : 1);
} else if (cmd === 'verify') {
  // decode every file of the fixtures with the app's codec and check hashes.json and arrival.f32 against them
  const out = opt('out');
  if (!out) {
    console.error('usage: run.mjs verify --out FIXTURES_DIR [NAME ...]');
    process.exit(2);
  }
  await build();
  const names = process.argv.slice(3).filter((a, i, v) => !a.startsWith('--') && v[i - 1] !== '--out');
  const r = spawnSync(process.execPath, ['--max-old-space-size=4096', join(buildDir, 'verify.mjs'), out, ...names], { stdio: 'inherit', cwd: root });
  process.exit(r.status ?? 1);
} else if (cmd === 'study') {
  const r = spawnSync(process.execPath, [join(here, 'study.mjs'), ...process.argv.slice(3)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
} else {
  console.error('commands: list | export (all|NAME) --out DIR | determinism --out DIR | verify --out DIR | study --out DIR');
  process.exit(2);
}
