# 3a: the TypeScript reference (fixtures, formats, determinism)

Stage 3a, agent P3a, option B prototype. Machine: the shared 4-core container (Intel Xeon @ 2.10 GHz, Linux 6.18), Node v22.22.0, one process per scenario, the heavy-work lock held for every run.
Timings are `indicative`. Numbers: `3a-results.json`. The tier and seed difference study (the yardstick for "close enough"): `3a-tier-difference.md`. The formats, byte for byte: `ts-export/README.md`.

## What was exported

Fixtures are in `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/dotnet-fixtures/<name>/` (not in git). Each folder has `init.bin`, `snap-0.bin` and `snap-60.bin` to `snap-<runTo>.bin`, `hashes.json`, `meta.json`, `arrival.f32`, `ignitions.json`.

The seven scenarios (seed 11, civil start 2025-12-20 12:00 except where noted, one 310 m line (-570,-450) to (-350,-230) at t=0, a picture every 60 s):

| fixture | tier | fire grid | run to | pictures | burnt cells (ha) | init.bin (bytes) | snap-60.bin (bytes) | folder size |
|---|---|---|---|---|---|---|---|---|
| `katoomba3-fast` | fast | 100x100 @ 30 m | 1800 s | 31 (0 to 1800) | 630 (56.7) | 1,776,432 | 680,064 | 23 MB |
| `katoomba6-fast` | fast | 200x200 @ 30 m | 1800 s | 31 | 546 (49.1) | 6,804,984 | 2,283,808 | 75 MB |
| `katoomba3-standard` | standard | 100x100 @ 30 m | 1800 s | 31 | 939 (84.5) | 1,776,392 | 831,264 | 27 MB |
| `katoomba3-high` | high | 150x150 @ **20 m** | 1800 s | 31 | 1680 (67.2) | 3,400,920 | 1,441,464 | 47 MB |
| `katoomba3-point` (point (-800,300) r 60, civil start 14:00) | fast | 100x100 @ 30 m | 900 s | 16 | 112 (10.1) | 1,783,432 | 677,832 | 13 MB |
| `katoomba3-high30` (extra: high options on the 30 m grid) | high | 100x100 @ 30 m | 1800 s | 31 | 1050 (94.5) | 1,776,384 | 903,576 | 29 MB |
| `anchor-080-katoomba6-point` (extra: regression anchor) | fast | 200x200 @ 30 m | 900 s | 16 | 255 (23.0) | 6,811,960 | 2,281,648 | 42 MB |

**`high` was not capped**: it runs in about 8 s (see timings). But note the builder gives the high tier 20 m fire cells up to 6 km (`builtFireCell`), so `katoomba3-high` has a different grid
from the other tiers (150x150, not 100x100). A C# reader must take the grid from the file (`meta.fireGrid`, and the grid inside every message), not assume 30 m. That is also why `katoomba3-high30` exists.
Snapshot sizes vary by a percent or two from picture to picture (spot fires, insights); the 3-D tiers carry `thetaAnomaly` and `smoke` arrays the fast tier leaves empty.

Extras for the study (all in the same folder, same layout): seeds 12 to 16 of `katoomba3-fast` (`-seed12` ...), seeds 12 to 14 of `katoomba3-standard` and `katoomba3-high30`, seed 12 of `katoomba3-high`,
`*-noembers` variants (`katoomba3-fast-noembers` [-seed12, -seed13], `katoomba3-standard-noembers` [-seed12], `katoomba3-high-noembers`, `katoomba3-high30-noembers` [-seed12]),
`*-pert<eps>` variants (inputs multiplied by 1 + eps), and `determinism-a`, `determinism-b`. 41 fixture folders in all.

## The regression anchor

`anchor-080-katoomba6-point` is the scenario of `src/sim/desktopDetail.determinism.test.ts` (Katoomba 6 km, fast, seed 11, point (-2170,900) r 60, start 14:00, to 900 s), whose 15 hashes were taken from the 0.8.0 source.
The exporter's 15 hashes equal them exactly (`meta.json` field `expectedHashCheck.equal` is true), so the exporter drives the solver the way the app does: same calls, same inputs. It caught a real mistake on the way: the bundle does not sit
beside `src/`, so the app's asset loader looked for `public/` in the wrong place and the builder quietly built synthetic terrain (different hashes). The exporter now points the loader at `<repo>/public` and refuses to run without the demo bundle.
The anchor also shows that taking the t0 snapshot (`snapshot()`, as `SimHost.init` does) before `spinUp()` does not change any later hash.

## Commands

```
FIX=/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/dotnet-fixtures
flock /tmp/firesim-heavy.lock node prototypes/dotnet-b/ts-export/run.mjs export all --out $FIX     # the seven above plus the no-embers variants (about 1 minute)
flock /tmp/firesim-heavy.lock node prototypes/dotnet-b/ts-export/run.mjs export katoomba3-fast --seed 13 --out $FIX
node prototypes/dotnet-b/ts-export/run.mjs determinism --out $FIX
node prototypes/dotnet-b/ts-export/run.mjs verify --out $FIX
node prototypes/dotnet-b/ts-export/run.mjs study --out $FIX --json study.json
node prototypes/dotnet-b/ts-export/results.mjs --out $FIX --study study.json --to prototypes/dotnet-b/reports/3a-results.json
```
`node_modules` must exist in the repository root (in this worktree it is a link to the main checkout's). See `ts-export/README.md`.

## Timing and sizes per scenario (one run each, ms, wall clock)

| fixture | scenario build | Simulation construct (moisture spin-up) | 3-D spin-up | advance to run-to | spin-up + advance | whole process |
|---|---|---|---|---|---|---|
| `katoomba3-fast` | 514 | 734 | 0 | 1050 | 1050 | 2388 |
| `katoomba6-fast` | 614 | 1431 | 0 | 1771 | 1771 | 3967 |
| `katoomba3-standard` | 516 | 837 | 1013 | 3928 | 4941 | 6380 |
| `katoomba3-high` | 548 | 1053 | 1518 | 6460 | 7978 | 9687 |
| `katoomba3-high30` | 478 | 904 | 1596 | 5949 | 7545 | 9004 |
| `katoomba3-point` (900 s) | 448 | 717 | 0 | 624 | 624 | 1887 |
| `anchor-080-katoomba6-point` (900 s) | 708 | 1472 | 0 | 974 | 974 | 3342 |

`katoomba3-fast` was run three times in separate processes (the export and the two determinism runs): spin-up + advance 1050, 1099 and 1206 ms (median 1099). Apart from that nothing was repeated; the other rows are single runs on a machine shared with other agents.
For stage 1: the whole fast-tier 30-minute fire at 3 km is about one second of TypeScript here (1800 s of fire in about 1 s), so a kernel benchmark must loop many steps for a stable reading.

## Determinism check

`katoomba3-fast` was run in three separate Node processes (the export, `determinism-a`, `determinism-b`; the second and third started by `run.mjs determinism`). **All 31 snapshot hashes (t = 0, 60, ... 1800) are identical in all three, and `arrival.f32` of the first and the second is byte-identical.**
(`hashes.json` of the three compares equal with `cmp`.) `init.bin` is not byte-identical between exports: 48 bytes differ, all wall-clock fields of `datasetSummary` (`builtAt`, `buildDurationMs`); the solver's inputs are the same.
Also: `run.mjs verify` decodes every file of all 41 folders with the app's own codec and recomputes `snapshotHash` of each decoded snapshot: every hash equals `hashes.json`, every `arrival.f32` equals the last snapshot's raster (+Infinity as -1).
Additionally, perturbing the weather inputs by 1e-15 relative (about 4.5 ulp) changed no float32 arrival value in any of 8 runs (study section 3 of `3a-tier-difference.md`).

## What was not done
- The C# side: nothing is ported or read in 3a.
- Standard and high at 6 km (not asked for; the high tier would be coarsened to 30 m beyond 6 km anyway).
- The 30-seed TypeScript ensembles the proposed embers-on bar would use (6 seeds fast, 4 standard and high30, 2 high were run).
- No run on a quiet machine or a phone; no repeat count above 3 (and only for one scenario).
- The exporter's git commit (`meta.json.gitCommit`) is the HEAD before the exporter was committed (`9bfcf24`); the solver sources it ran are that commit's, and the exporter files were uncommitted then.

## Decisions taken
- Snapshot 0 (as the host posts it at init) is exported as `snap-0.bin`; the brief said "every 60 s": the 60 to 1800 files are those, 0 is extra.
- `arrival.f32` is the final raster at the run's last time (1800 s, or 900 s for the point scenario), -1 for unburnt, as asked.
- Extra scenarios (`katoomba3-high30`, the no-embers and perturbation variants, the anchor, seeds 12 to 16) were added because the yardstick needed them (see `3a-tier-difference.md`).
