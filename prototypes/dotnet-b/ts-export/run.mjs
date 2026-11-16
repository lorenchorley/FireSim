#!/usr/bin/env node
/**
 * One-command runner of the fixture exporter (stage 3a). The solver is TypeScript with extension-less imports, which Node cannot load by
 * itself, so this builds ts-export/export.ts with the repository's own bundler (Vite, SSR build, the way desktop/build.mjs does) into
 * prototypes/dotnet-b/fixtures/.build-ts-export (git ignores `fixtures/`), then runs it with Node, one process per scenario.
 *
 *   node prototypes/dotnet-b/ts-export/run.mjs export all  --out FIXTURES_DIR        every named scenario, one after another
 *   node prototypes/dotnet-b/ts-export/run.mjs export long --out FIXTURES_DIR        the five 4 h scenarios (stage 3, T3.1a), one after another
 *   node prototypes/dotnet-b/ts-export/run.mjs export NAME --out FIXTURES_DIR [--seed N] [--to S] [--dir NAME] [--perturb EPS] [--noise SEED] [--noise-scale F] [--keep T,T,..] [--interval S]
 *   node prototypes/dotnet-b/ts-export/run.mjs determinism [NAME] --out FIXTURES_DIR [--to S] [--seed N] [--noise SEED] [--clean]
 *                                                                                    NAME (default katoomba3-fast) twice in separate processes, every snapshot hash and arrival.f32 compared
 *
 * --noise SEED installs per-call libm-sized noise on the transcendental Math functions for the run (noise.ts; the build then also lowers `**` to
 * Math.pow, pow-lowering-plugin.mjs, and goes to a separate build folder). Without it nothing is installed and the build is as it always was.
 * --keep T,T,..: write snap-T.bin only for these simulated times (hashes and arrival.f32 are always complete): for runs that are many.
 * --interval S: override the scenario's snapshot cadence.
 * --probes (after the scenario name): the probe build of card T3.4 (probes/): the same run with the recorders on, output in <fixture>/probes/; determinism NAME --probes shows the probes change nothing.
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
const noisy = process.argv.includes('--noise');
// --probes: the T3.4 probe build (probes/plugin.mjs wraps the boundary functions, FS_PROBES=1 starts the recorders); observation only, see probes/install.ts.
const probing = process.argv.includes('--probes');
// FS_BUILD_DIR: another build folder, so that two runs of this script at once (one under the heavy lock, one a short check) do not rebuild under each other.
const buildDir = process.env.FS_BUILD_DIR ?? join(root, 'prototypes', 'dotnet-b', 'fixtures', noisy ? '.build-ts-export-noise' : probing ? '.build-ts-export-probes' : '.build-ts-export');
const LONG = ['katoomba6-fast-4h', 'katoomba3-standard-4h', 'warrumbungles6-fast-4h', 'katoomba6-fast-4h-noembers', 'katoomba3-standard-4h-noembers'];
const ALL = ['katoomba3-fast', 'katoomba6-fast', 'katoomba3-standard', 'katoomba3-high', 'katoomba3-high30', 'katoomba3-point', 'anchor-080-katoomba6-point', 'katoomba3-fast-noembers', 'katoomba3-standard-noembers', 'katoomba3-high-noembers', 'katoomba3-high30-noembers'];

function opt(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function build() {
  const { build: viteBuild } = await import('vite');
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  const plugins = [];
  if (noisy) {
    const { powLowering } = await import('./pow-lowering-plugin.mjs');
    const p = powLowering();
    plugins.push(p);
    process.on('exit', () => console.error(`noise build: ${p.stats.sites} '**' sites in ${p.stats.files} files lowered to Math.pow`));
  }
  if (probing) {
    const { probeWrap } = await import('./probes/plugin.mjs');
    const p = probeWrap(root);
    plugins.push(p);
    process.on('exit', () => console.error(`probe build: ${p.stats.wrapped} functions wrapped in ${p.stats.files} files${p.stats.missing.length ? `; NOT FOUND: ${p.stats.missing.join(' ')}` : ''}`));
  }
  await viteBuild({
    root,
    configFile: false,
    plugins,
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
  const r = spawnSync(process.execPath, ['--max-old-space-size=4096', join(buildDir, 'export.mjs'), name, '--out', out, ...extra], { stdio: ['ignore', 'pipe', 'inherit'], cwd: root, encoding: 'utf8', env: { ...process.env, FS_REPO_ROOT: root, ...(noisy ? { FS_POW_LOWERED: '1' } : {}), ...(probing ? { FS_PROBES: '1' } : {}) } });
  process.stdout.write(r.stdout ?? '');
  if (r.status !== 0) console.error(`export ${name} ${extra.join(' ')} exited with ${r.status}`);
  return r.status ?? 1;
}

const cmd = process.argv[2];
if (cmd === 'list') {
  console.log(ALL.join('\n') + '\n' + LONG.join('\n'));
} else if (cmd === 'export') {
  const what = process.argv[3];
  if (!opt('out') || !what) {
    console.error('usage: run.mjs export (all|NAME) --out FIXTURES_DIR [--seed N] [--to S] [--dir NAME]');
    process.exit(2);
  }
  await build();
  const extra = ['seed', 'to', 'dir', 'perturb', 'noise', 'noise-scale', 'keep', 'interval'].flatMap((k) => (opt(k) !== undefined ? [`--${k}`, opt(k)] : []));
  let bad = 0;
  const group = what === 'all' ? ALL : what === 'long' ? LONG : [what];
  // A group is exported with each scenario's own seed and folder name; the other options (--to, --noise, --keep, ...) apply to every member of `long`.
  const groupExtra = what === 'long' ? ['to', 'noise', 'noise-scale', 'keep', 'interval'].flatMap((k) => (opt(k) !== undefined ? [`--${k}`, opt(k)] : [])) : [];
  for (const n of group) bad += exportOne(n, group.length > 1 ? groupExtra : extra) === 0 ? 0 : 1;
  process.exit(bad ? 1 : 0);
} else if (cmd === 'determinism') {
  // NAME (default katoomba3-fast) exported twice, each in its own process, into <out>/determinism-a and -b (katoomba3-fast) or
  // <out>/determinism-NAME-a and -b; every snapshot hash and the arrival raster are compared. Exit 1 if anything differs.
  const out = opt('out');
  if (!out) {
    console.error('usage: run.mjs determinism [NAME] --out FIXTURES_DIR [--to S] [--seed N] [--noise SEED] [--clean]');
    process.exit(2);
  }
  const rest = process.argv.slice(3).filter((a, i, v) => !a.startsWith('--') && !(v[i - 1] ?? '').startsWith('--'));
  const name = rest[0] ?? 'katoomba3-fast';
  await build();
  const base = name === 'katoomba3-fast' ? 'determinism' : `determinism-${name}`;
  const runs = [`${base}-a`, `${base}-b`];
  const extra = ['seed', 'to', 'noise', 'noise-scale', 'interval'].flatMap((k) => (opt(k) !== undefined ? [`--${k}`, opt(k)] : []));
  // Snapshot files are not needed to compare hashes; keep only the last one (verify checks it) so that a 4 h run does not write its whole record twice.
  for (const d of runs) if (exportOne(name, ['--dir', d, '--keep', 'last', ...extra]) !== 0) process.exit(1);
  const [a, b] = runs.map((d) => JSON.parse(readFileSync(join(out, d, 'hashes.json'), 'utf8')));
  const keys = Object.keys(a);
  const diff = keys.filter((k) => a[k] !== b[k]);
  const arrivalSame = Buffer.compare(readFileSync(join(out, runs[0], 'arrival.f32')), readFileSync(join(out, runs[1], 'arrival.f32'))) === 0;
  const same = keys.length === Object.keys(b).length && diff.length === 0 && arrivalSame;
  const last = keys.map(Number).sort((x, y) => x - y).at(-1);
  console.log(JSON.stringify({ scenario: name, noise: opt('noise'), snapshots: keys.length, lastS: last, differing: diff, arrivalIdentical: arrivalSame, identical: same }));
  if (process.argv.includes('--clean')) for (const d of runs) rmSync(join(out, d), { recursive: true, force: true });
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
