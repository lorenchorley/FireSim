# T3.1a: the 4 h scenarios and the noise wrapper

Everything here is TypeScript in `prototypes/dotnet-b/ts-export/` (`scenarios.ts`, `noise.ts`, `pow-lowering-plugin.mjs`, `run.mjs`, `export.ts`, `verify.ts`, `noise-check/`).
Nothing under `src/` was touched. Conditions of every number: one container, Intel Xeon 2.10 GHz, 4 shared cores (one thread used), Node 22.22.0 (V8 12.4.254.21),
glibc 2.39, one run each unless said. Wall times are **indicative**: the heavy lock was shared with other builders, and the load average was 1 to 2.5 while these ran.

## 1. Scenarios

All five: preset `hot-nw-sw-change`, seed 11, civil start **2025-12-20 14:00** (Sydney, AEDT), `duration` 14,400 s, `runTo` 14,400 s, snapshots every **300 s**
(49 pictures: t = 0, 300, ... 14,400; 900, 1,800, 3,600, 7,200 and 14,400 s are all among them). Tier options as the builder makes them (30 m fire cells).

| name | site | extent | tier (air cell, levels, ember cap) | fire grid | ignition | wall time, run to 1,800 s | wall time, full 4 h (spin-up + advance; process total) | burnt at 4 h |
|---|---|---|---|---|---|---|---|---|
| `katoomba6-fast-4h` | Katoomba | 6 km | fast (133 m, 20, 2000) | 200 x 200 @ 30 m | line (-570,-450) to (-350,-230), 310 m, t = 0 | 1.5 s (3.7 s) | **13.4 s** (15.4 s) | 16,859 cells, 1,517 ha |
| `katoomba3-standard-4h` | Katoomba | 3 km | standard, 3-D air (100 m, 20, 4000) | 100 x 100 @ 30 m | the same line | 5.8 s (7.1 s) | **26.7 s** (27.8 s) | 7,132 cells, 642 ha |
| `warrumbungles6-fast-4h` | Warrumbungles | 6 km | fast (133 m, 20, 2000) | 200 x 200 @ 30 m | point (-1500, 1000), radius 60 m, t = 0 | 1.3 s (3.4 s) | **12.3 s** (14.7 s) | 31,898 cells, 2,871 ha |
| `katoomba6-fast-4h-noembers` | Katoomba | 6 km | fast, `embers = false` | 200 x 200 @ 30 m | the line | 1.1 s (3.4 s) | 8.0 s (10.3 s) | 2,781 cells, 250 ha |
| `katoomba3-standard-4h-noembers` | Katoomba | 3 km | standard, `embers = false` | 100 x 100 @ 30 m | the line | 4.8 s (6.2 s) | 23.1 s (24.4 s) | 2,342 cells, 211 ha |

Wall times come from `meta.json` (`timingMs.spinUpPlusAdvance` and `processTotal`) of the 1,800 s runs and of one full `export long` run. The brief's figure of "about 21 s of wall time per simulated hour at 6 km fast" is the Standard 3-D tier's in 15e (20.8 s per hour at 30 m);
15e's fast 6 km figure is 5.3 s per hour. Here 4 h on 6 km fast took 13 s (3.4 s per hour) and standard 3 km 27 s (6.7 s per hour). No 4 h scenario is slow.
Fixture size with every snapshot kept: 117 MB (6 km), 42 MB (standard 3 km).

All five exported in full and `verify` decoded every file of all of them with the app's codec (hashes and `arrival.f32` agree: `ok` for 5 of 5, plus the two determinism fixtures).

### Choices that the card left open

- **Start at 14:00, not 12:00.** The preset's south-westerly change is at 15:00 local mean solar time. From 12:00 (the start of the 3a scenarios, the preset's canonical start) it arrives at about 4 h, the last minutes of the window.
  From 14:00 (the start of V20 in `src/sim/validation/system.test.ts` and of the 15e measurement) it arrives about 2 h in. Measured in the snapshots' `stats.weather`: wind from 310 degrees until about 5,400 s, 291 degrees at 6,600 s, 267 at 7,200, 244 at 7,800, 230 from 9,000 s on (Katoomba 6 km; the Warrumbungles are 5 to 10 minutes later). The 4 h window therefore holds the whole change, which is the point of T3.1b's horizons. Katoomba's line ignition is the same one as in the 3a scenarios.
- **Warrumbungles ignition: point (-1500, 1000) m from the site centre, radius 60 m, at t = 0.** It is the ignition of the 15e desktop measurement (`studies/desktop-simulation/01-cost-vs-detail/README.md`, "Warrumbungles: the same preset and start, ignition at (-1500, 1000) m, 6 km"; `scripts/make-specs.mjs` has `WAR`). Section 15e of `air-slice-wind-detail-honest-speed.md` gives that run's results (2 h, 1,811 ha at 30 m, 6 km) but not the coordinates; they are in the study folder. Same preset, same 14:00 start, so the 4 h run extends that measurement. It burns 2,871 ha in 4 h, 80 % of the 6 km domain's 3,600 ha (Katoomba 6 km: 1,517 ha, 42 %), so the Warrumbungles fire also feels the domain edge late in the run.
- **Snapshot cadence 300 s.** `snapshotInterval` is a scenario option (`SimOptions.snapshotInterval`, 1 to 3600 s), set from `ScenarioDef.snapshotInterval` and not tied to the 60 s of the 3a scenarios. 300 s keeps 900, 1,800, 3,600, 7,200 and 14,400 s on the grid, keeps a 6 km fixture at 117 MB (60 s would be 580 MB), and resolves a first divergence to 5 min. Changing it does not change the solver's state: `katoomba3-fast` re-exported with `--interval 300` (to 900 s) has the same `arrival.f32` as the 60 s run, and at 300, 600 and 900 s every typed array of the snapshot (fire, moisture, air, embers) equals the 60 s run's bit for bit. **But the snapshot hashes of a 300 s cadence are not those of a 60 s cadence**: `insights` (the events since the previous picture) and the `layers.landing` raster differ with the cadence, and the wall-clock `stats.msPerSimMinute` and `engine` record differ as always. So hashes compare only between runs with the same interval; the 4 h scenarios all use 300 s, and 3a's 60 s hashes are not comparable with them.
- **One thing worth knowing for the gate:** at 4 h the 3 km standard fire covers 71 % of the domain (7,132 of 10,000 cells), so the 3 km domain edge is felt in the last hour. The plan names this scenario, so it is as asked.
- Embers matter for these line ignitions: 1,517 ha with embers and 250 ha without (6 km fast), 642 and 211 ha (standard). The no-embers variants are therefore a different fire, not a small adjustment.

### New exporter options (all optional; without them nothing changes)

`export long` (the five scenarios); `--noise SEED`, `--noise-scale F`; `--keep all|none|last|T,T,...` (which `snap-T.bin` files to write; `hashes.json`, `arrival.f32` and `meta.snapshotsWritten` are complete either way: for T3.1b's 60 runs
the five horizon files per run are about 18 MB (fast 6 km, with the 6.8 MB `init.bin`) or 6 MB (standard) instead of 117 or 42 MB); `--interval S`; `determinism [NAME] ...` (below); the env var `FS_BUILD_DIR` (a separate build folder so a short check does not rebuild under a run that holds the lock; it must be inside the repository so that `node_modules` resolves).

**Without `--noise` the exporter behaves as before.** `katoomba3-fast`, seed 11, `--to 900`, exported with the new code: its 16 hashes (t = 0 to 900) equal those of the existing 3a fixture (`dotnet-fixtures/katoomba3-fast/hashes.json`), 0 differing. The build is also unchanged (the noise build, with its `**` lowering, goes to its own folder `.build-ts-export-noise`).
Also: the noise build with `--noise-scale 0` (wrapper installed, `**` lowered, never moving a result) reproduces those 16 hashes, so the wrapper and the lowering are transparent.

## 2. The noise wrapper (`--noise SEED`)

**What it stands in for.** The C# solver will call the .NET runtime's maths, which agrees with V8 12.4's `Math` to the last bit on most inputs but not all. The wrapper replaces the transcendental functions of `Math`, for one run, by functions that return V8's value or, on a fraction of calls, a neighbouring double.

**What is implemented, exactly** (`noise.ts`):

1. **Functions:** `exp log pow sin cos tan atan atan2 acos asin sinh cbrt log2 log10 hypot`. Never `sqrt`, `abs`, `floor`, `ceil`, `round`, `min`, `max`, `fround`, `imul`, `sign` or arithmetic. `Math.hypot` is wrapped for 2 and 3 arguments (a grep of `src/` finds about 345 two-argument and 17 three-argument call sites, and some one-argument forms that the wrapper also passes through).
   `x ** y` is the same function as `Math.pow` in V8 but a replaced `Math.pow` cannot intercept the operator, and 65 sites in 27 files of the app's own code use it (`plume.ts`, `grid.ts`, `profile.ts`, `solar.ts`, `fuelPhysics.ts` and others; many with a literal exponent 2). The noise build therefore passes the code through `pow-lowering-plugin.mjs`, which rewrites `a ** b` as `Math.pow(a, b)` (a textual rewrite of the two operands with the repository's TypeScript parser; node_modules untouched; `**=` is not used by the app and would stop the build). The noise-free build does not load the plugin.
2. **Stream:** a separate instance of the `Rng` of `src/core/rng.ts` (mulberry32), seeded `imul(seed, 0x9e3779b1) xor 0x6a09e667` so that noise seed 12 is not the sequence of a solver stream seeded 12. It shares no state with the solver's generators. One draw per call.
3. **Rate and size:** if the draw is at least the function's rate, the exact V8 result is returned. Otherwise the result moves in magnitude by k ulp of its own size, up or down with equal probability (a second draw), and k is 1 for every function whose largest measured difference is 1 ulp; `cbrt` moves 1, 2 or 3 ulp, and `sinh`, `log10` and `hypot` 1 or 2 ulp, in the proportions measured.
4. **The rates are measured, not invented:** V8 12.4.254.21 (Node 22.22.0) against glibc 2.39 (python3 ctypes on `libm.so.6`), 200,000 inputs per function, same generator and ranges as the N-O verifier's run (`ts-export/noise-check/`, `node run.mjs measure DIR`). The functions N-O measured agree with its numbers (exp 9.62 %, log 0.87 %, sin 3.30 %, cos 3.33 %, cbrt 47.6 % up to 3 ulp, sqrt 0; pow 9.85 % against its 9.83 %, atan2 17.7 % against its 18.0 %: a different input draw). The six it did not measure (the verifier assumed hypot 30 %, asin and acos 5 %) are new: asin 6.02 %, acos 7.65 %, sinh 0.10 %, log2 0.28 %, log10 1.24 %, hypot 35.5 %.

   | function | exp | log | pow | sin | cos | tan | atan | atan2 | acos | asin | sinh | cbrt | log2 | log10 | hypot |
   |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
   | mismatch rate, % | 9.62 | 0.87 | 9.85 | 3.30 | 3.33 | 3.86 | 1.45 | 17.68 | 7.65 | 6.02 | 0.10 | 47.71 | 0.28 | 1.24 | 35.52 |
   | ulp sizes (count of 200,000) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1: 199, 2: 11 | 1: 85,851, 2: 9,521, 3: 56 | 1 | 1: 2,286, 2: 193 | 1: 70,638, 2: 399 |

   `hypot` with three arguments uses the two-argument rate (glibc has no three-argument form to compare with). The rates are for uniform random inputs, not for the solver's own arguments (N-O note).
5. **Exact cases are left alone** because every libm returns them exactly (the draw is made first, so this changes which calls move, not the stream): a result that is 0, NaN or infinite; a zero argument of a one-argument function; `log2`, `log10`, `cbrt` and `hypot` results that are whole numbers; `asin`, `acos` of 0 or +-1; `pow` with exponent 0, 1, 2, -1 or 0.5, base 0 or 1, or two whole numbers with a non-negative exponent; `atan2` with a zero argument or equal magnitudes; `hypot` with a zero argument. In a 1,800 s run (`katoomba3-fast`, seed 13, noise 1) this skipped 13,254 of 361,981 selected calls; `hypot` is the most affected (11,367 skips, because a zero component is common).
6. **When it is on:** from the solver's construction to the end of the run (`new Simulation`, `snapshot()`, `spinUp()`, `advance()`, `emitRunEnd()`). The scenario is **built without noise**, so the decoded `init` of a noisy fixture equals the noise-free fixture's in every field except the wall-clock provenance ones (`datasetSummary.builtAt`, `buildDurationMs`, `datasets[].vintage.retrievedAt`, `datasets[].sizes.durationMs`; checked field by field with the codec on `katoomba6-fast-4h` against its noise 1 export, so the bytes differ, as between any two exports), and a C# reader starts from the same data. The t = 0 snapshot (after construction, so already inside the noise) differs from the clean run's in its hash (the constructor's own maths; which field was not investigated).
7. **Deterministic:** the solver's call order is fixed, so the same (scenario, solver seed, noise seed) gives the same bits in every process (see section 3). `meta.json` gets `noise: { seed, scale, calls, nudged, exactSkipped, powLowered }` per function.

**Checks** (`node ts-export/noise-check/run.mjs selftest`, 300,000 calls per function): measured rate within sampling error of the table for all 15 (for example exp 9.55 % against 9.62 %, hypot 35.41 % against 35.52 %, cbrt 47.63 %); ulp sizes in the table's proportions; the same seed gives the same pattern, another seed another; `restore()` puts every original back; no exact case (exp(0), cos(0), pow(7,2), pow(2,10), hypot(3,4), cbrt(27), log10(1000), ...) moved in 100,000 rounds.
In a 1,800 s `katoomba3-fast` run the wrapper saw 3.8 million calls (exp 1.67 M, cos 0.49 M, atan 0.47 M, log 0.28 M, sin 0.22 M, hypot 0.16 M, cbrt 0.16 M, atan2 0.12 M, acos 0.10 M, pow 0.09 M) and moved 349,000 of them; exp moved 160,642 of 1,671,869 (9.6 %).

**What it does not model.** A real libm is a function of its input: the same argument always gives the same neighbour, in every call. This noise is per call, so two calls with the same argument can differ, and an argument that a real libm gets "wrong" is not wrong on every call. It is closest to "a different libm whose rounding differs at the measured rate", a little noisier in that respect, and it is exact on the argument patterns listed in 5. It also does not touch Node's own code (the codec, the hash), `Math.fround`, or the order of floating-point additions.
The measured mismatch is V8 12.4 against glibc; a phone's bionic, .NET's own runtime and a Chrome 150+ (llvm-libc, per N-O N-2) differ from V8 12.4 by other amounts. These are the "libm-sized" rates that N-O and the plan name, not those of one particular C# runtime.

**Cost.** Clean against noise, run to 1,800 s: katoomba6-fast-4h 1.5 s against 2.5 s; katoomba3-standard-4h 4.9 s against 5.3 s. Full 4 h with noise seed 1: katoomba6-fast-4h 14.9 s (13.4 s clean), katoomba3-standard-4h 27.6 s (26.7 s), warrumbungles6-fast-4h 14.0 s (12.3 s).
So T3.1b's matrix (30 fast runs at about 15 s, 30 standard at about 28 s, plus about 2 s of start-up each, plus 5 runs of the Warrumbungles) is about 25 to 30 minutes of wall time on this machine, about a ninth of the 4 h cap, and 10 draws per cell fit with a large margin (use `--keep 900,1800,3600,7200,14400`: 60 runs x 18 or 6 MB is about 0.7 GB; without it about 4.8 GB).

**One draw, not a floor (a glimpse, not T3.1b).** Noise seed 1 on the three scenarios, final arrival raster at 4 h against the clean run: `katoomba6-fast-4h` and `warrumbungles6-fast-4h` bit-identical in burnt status and arrival time (0 cells differ); `katoomba3-standard-4h` 5.8 % of ever-burning cells differ in burnt status (6,751 burnt against 7,132, area -5.3 %), median arrival difference 25.8 s, 95th percentile 669 s, maximum 3,580 s. That is outside the plan's 2.5 % (embers off) and 1 % (embers on) bars for one noise draw on the standard tier. It is one draw and noise that is per call (see above), so it is not a measured floor; T3.1b's 10 draws per seed will say how general it is. It is the thing to look at first: if the 3-D tier is this sensitive to last-bit maths at 4 h, the standard-tier bars at 2 h and 4 h cannot be met by any independent port, and the plan's section 10.3 text ("the bars stay where they are unless a floor comes near them") applies at once.

## 3. Determinism (`node run.mjs determinism [NAME] --out DIR [--to S] [--seed N] [--noise SEED] [--clean]`)

NAME (default `katoomba3-fast`, so the old command line works) is exported twice, each in its own process (a fresh Node process, its own `Simulation`), into `DIR/determinism-a` and `-b` (`katoomba3-fast`) or `DIR/determinism-NAME-a` and `-b`.
Every snapshot hash of the two is compared and so is `arrival.f32` byte for byte (the old version compared hashes only); exit 1 if anything differs. Only the last snapshot file is written (`--keep last`), which `verify` still checks.

| run | snapshots compared | result |
|---|---|---|
| `katoomba6-fast-4h`, to 1,800 s | 7 | identical (hashes and arrival) |
| `katoomba3-standard-4h`, to 1,800 s | 7 | identical |
| `warrumbungles6-fast-4h`, to 1,800 s | 7 | identical |
| `katoomba6-fast-4h-noembers`, to 1,800 s | 7 | identical |
| `katoomba3-standard-4h-noembers`, to 1,800 s | 7 | identical |
| **`katoomba6-fast-4h`, full 4 h** | **49** | **identical**; and equal to the hashes of the separate full export of the same scenario (49 of 49) |
| `katoomba3-standard-4h`, to 300 s (smoke test of NAME) | 2 | identical |
| `katoomba6-fast-4h`, to 1,800 s, **with `--noise 3`** | 7 | identical: a noisy run repeats |

Logs: scratchpad `T3.1a/determinism-1800.log`, `determinism-4h.log`.

## 4. For T3.1b and T3.2

- Use `export NAME --noise SEED --keep 900,1800,3600,7200,14400 --seed S --out DIR`; the fixture folder is `NAME[-seedS]-noiseSEED` (or whatever `--dir` says).
- Hashes are not usable to find the first divergence of a noisy run (the t = 0 snapshot already differs, from the constructor's moisture and fuel set-up); compare arrival rasters or the snapshot arrays.
- The decoded `init` of a noisy fixture equals the clean one (provenance timestamps aside): the C# side needs one `init.bin` per scenario and seed.
- Compare hashes only between runs of the same snapshot interval (see section 1).
