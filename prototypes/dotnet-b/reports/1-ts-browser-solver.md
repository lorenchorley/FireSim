# 1-ts-browser-solver: the whole TypeScript solver in a browser worker (card T1.5 d)

Stage `1-ts-browser-solver`, builder T1.5 part (d). Numbers: `1-ts-browser-solver.json` (schema `RESULTS-SCHEMA.md`, `indicative: true`; the JSON also holds every run, every load reading, and for each comparison the table per horizon). Parts (a) to (c) of T1.5 wait for T1.4b and are not in this report.

**Conditions of every number.** The shared container: Intel Xeon 2.10 GHz, 4 vCPUs, Linux 6.18, one thread used. Node 22.22.0 (V8 12.4.254.21-node.33) against **Chromium 153.0.8010.12 (V8 15.3.76.4)**, Playwright's pre-installed build, headless, `chromium.launch()` with no options, the solver in a module Web Worker. Both arms run the same unminified Vite bundle of the app's own code (`src/` is not edited), single thread, commit `3158855` plus this card's files. 2026-11-16. Timed runs ran under `flock /tmp/firesim-heavy.lock` (the lock was held by another builder's timing run for part of the wait, so the runs were serial). **Load average (1-minute) at the start and end of each of the 24 timed runs: 0.91 to 1.31 (max 1.31, none above 1.5); `uptime` before 0.91, 1.08, 1.37 (18:39:43), after 1.28, 1.17, 1.37 (18:40:55).** The load includes the run's own process (about 1.0). Container numbers are indicative.

## 1. Speed: simulated seconds per wall second, 1,800 s of fire, seed 13

A B B A (order N C C N N C: three runs each, one process per run, Node = `ts-export/run.mjs export`, C = `harness/run-solver-browser.mjs`, both `--keep 1800`). Speed = 1,800 / ((spin-up + advance) / 1000), the figure of `1-profile.md`; the per-snapshot encode and hash is inside the timed advance in both arms, as in `export.ts`.

| scenario | Node 22 (V8 12.4): median (min to max) | Chromium 153 (V8 15.3): median (min to max) | Chromium / Node |
|---|---|---|---|
| `katoomba6-fast` (6 km, fast, 200x200 @ 30 m) | **1,058** (1,041 to 1,068) | **1,108** (1,101 to 1,128) | **1.048** (ranges do not overlap) |
| `katoomba3-standard` (3 km, 3-D air, 900 s spin-up, 100x100 @ 30 m) | **363** (360 to 381) | **365** (355 to 365) | **1.006** (ranges overlap: equal) |

Wall time of spin-up plus advance, medians: fast 1,701 ms (Node), 1,624 ms (Chromium); standard 4,944 ms (Node: spin-up 993 + advance 3,951), 4,958 ms (Chromium: 1,010 + 3,948). Scenario build in the worker: 561 ms (fast), 439 ms (standard); the `Simulation` constructor 1,217 and 543 ms (Node 1,321 and 807). The Node figures agree with `1-profile.md` (fast 1,792 ms step loop, standard 3,813 + 1,009 ms). Chromium's share of the encode and hash work inside the advance: 193 to 214 ms (fast), 78 to 80 ms (standard); without it, 1,258 to 1,287 (fast) and 361 to 371 (standard) sim s per wall s (the Node exporter does not time its hash, so there is no Node figure to set against these). **The browser is not slower than Node: the whole solver in a Chromium worker runs at Node's speed (standard) or 5 % faster (fast).** This is the reference speed of the TypeScript on a desktop browser; a phone's WebView number is T5.1's. `performance.memory` is not defined in a worker in this Chromium (`memory.available: false` in every `meta.json`), so no heap figure was recorded.

All three Chromium runs of a scenario gave the same last hash (determinism within the arm), as did the three Node runs.

## 2. Equality with Node: the engine floor at 900 s (first measurement)

Same scenario, seed 11 (the default of `scenarios.ts`), every snapshot (16, 0 to 900 s), `katoomba3-fast` and `katoomba3-standard`. Compared with `harness/compare-fixtures.mjs` (section 4). **Chromium's V8 is 15.3.76.4; Node's is 12.4: Chromium forwards `Math` to LLVM libc (plan 10.2), Node 22 does not.** The two runs differ on the maths, and the measurement shows where it matters and where it does not.

**First diverging snapshot, by hash: 0 s, for both scenarios (0 of 16 hashes equal).** The cause is not the simulation. It is one number in the scenario that the browser built, before the first step: `stats.weather.pressureLevels[2].dewPoint` is -23.035788410013478 in Node and -23.03578841001348 in Chromium (one ulp: the preset weather's dew point goes through `Math.log`), and `scenario.weather.hours[16].temperature` and `.relativeHumidity` (hours the 900 s run never reaches) differ in the last digit as well (104 and 105 scalars in `init.bin`, **0 typed arrays**: terrain, fuel, canopy, fire history are bit-identical). `snapshotHash` hashes every scalar, so the hash moves at t = 0.

**To separate the scenario builder's maths from the solver's**, the runner also takes `--init-from DIR` (the solver runs on the Node fixture's `init.bin`, decoded by the app's codec). With Node's scenario, **15 of 16 hashes are equal for both scenarios, and the one that differs is 540 s: `stats.ffdi` 38.69670772993864 (Node) against 38.69670772993863 (Chromium), the last digit of a displayed index** (a `stats` scalar computed from weather values; the arrays show that it did not move the simulation). Every other number of the 540 s snapshot is equal.

**Typed arrays at 900 s (and at every one of the 16 snapshots):** 25 arrays are compared per snapshot (fire: arrival time, burn state, ROS, intensity, flame height, spread direction, driver, phase; moisture; air: surface wind, u, v, w, theta anomaly, smoke where the tier has them; embers; layers; fireWind): **0 of 25 differ, 0 differing cells in each, in both scenarios and both variants.** The arrival-time difference raster: 0 cells with a different arrival, max 0 s, RMS 0 s; burnt-cell disagreement 0 (295 and 388 burnt cells; burnt area difference 0 %). The divergence therefore does not grow within 900 s: there is none to grow. (As soon as a double-precision difference reaches a `Float32Array` store it is mostly rounded away: this is the likely reason, not tested.)

**Longer, to see whether it appears (seed 11, snapshots every 300 s, not asked for; `1-ts-browser-solver.json`, `equality`):**

| scenario, to 3,600 s | hashes equal | first array that differs | at 3,600 s |
|---|---|---|---|
| `katoomba3-fast` | 0 of 61 (the dew point, as above) | none (12 snapshots) | 0 of 25 arrays differ |
| `katoomba6-fast` | 52 of 61 (differing: 540, 1560, 1680, 1920, 2280, 2640, 3300, 3420, 3600; at 3300 and 3600, which have snapshot files, the one scalar is `stats.ffdi`) | none (12 snapshots) | 0 of 25 |
| `katoomba3-standard` (all 61 snapshots) | 0 of 61 | **2,880 s** (9 of 25 arrays, 15 at 2,940 s) | 17 of 25 arrays differ; **49 arrival cells differ** (first 2 at 3,060 s, then 3, 7, 8, 9, 15, 21, 33, 41, 49: **growing**); max arrival difference 0.0083 s, RMS 0.0004 s; burnt cells 1,564 in both, disagreement 0; air `u`, `v`, `w` differ by up to 7e-5 m/s (8,000 to 17,000 of 18,000 cells), `fire.intensity` by up to 6.5 kW/m in 179 cells, `moisture` by 5e-7 |

In the standard tier the 3-D air is the first to move (a last-bit difference, rounded to float32), the fire follows 3 minutes later; the divergence grows but at 3,600 s is still milliseconds in arrival time: none of the bars of 10.3 (30 s median, 60 s at the 95th percentile, 1 to 2.5 % of cells) is touched (worst fraction of a bar: 0). Whether it grows to bar size over 4 h is T3.1c's measurement. The seed 13, 1,800 s runs of section 1 agree: `katoomba6-fast` has 28 of 31 hashes equal and 0 of 25 arrays differing at 1,800 s; `katoomba3-standard` 0 arrays differing (the dew point only).

## 3. What this says for the plan

- The engine floor measured here (Node 22 against Chromium 153, scenario built in each, one seed) is **zero in every fire, moisture and air array for 900 s on both scenarios measured at 900 s and for 3,600 s on the fast tier; on the standard tier it starts at 2,880 s and reaches 49 cells of 1,564 at milliseconds by 3,600 s.** The bars of 10.3 are not near it so far; the 4 h horizons (T3.1c) decide.
- The scenario the browser builds already differs from the Node one in the last bit of some weather scalars (`Math.log` and friends in the weather preset). A C# port compared against the Node fixtures, whose `init.bin` it reads, does not see this; the app in a browser does.
- Hashes are the wrong instrument for the floor: one scalar moves them at t = 0. `compare-fixtures.mjs` reports arrays and scalars separately.

## 4. The tools (all under `prototypes/dotnet-b/harness/`)

| file | what |
|---|---|
| `solver-worker.entry.ts` | the worker: scenario name, seed, `to`, `keep`, interval in; builds the scenario (`ts-export/scenario-build.ts`), runs `new Simulation(...)` / `snapshot()` / `spinUp()` / `advance(runTo)` / `emitRunEnd()` as `export.ts`, encodes every snapshot with the codec and hashes it with `snapshotHash`; posts hashes, `arrival.f32` (transferred), `init.bin`, the kept snapshot frames, timings (scenario build, construct, spin-up, advance, encode and hash share), sim s per wall s, `performance.memory` if it exists |
| `vite.solver.config.ts`, `build-solver.sh` | one ES module worker (the app's own worker format), dynamic imports inlined, unminified, es2022; output `fixtures/.build-solver-browser/solver.worker.js` (2.0 MB; the app's own simulation worker is also emitted to `assets/` because `src/sim/client.ts` references it: never loaded) |
| `solver-page.html` | the page: starts the worker and POSTs each result file to the runner (nothing large goes through the DevTools protocol) |
| `run-solver-browser.mjs` | `NAME --out DIR [--seed N] [--to S] [--dir NAME] [--keep all|none|last|T,T,..] [--interval S] [--init-from DIR] [--rebuild]`: serves the page, the bundle and `public/` on 127.0.0.1, runs Chromium, writes `init.bin`, `ignitions.json`, `snap-<t>.bin`, `hashes.json`, `arrival.f32`, `meta.json` (the keys of `export.ts`'s, plus `engine` with the browser and V8 versions, `load`, `memory`, unrounded `timingMs`). Any scenario of `scenarios.ts`, the `-4h` ones too |
| `solver-abba.mjs` | the A B B A session of section 1 (`flock ... node solver-abba.mjs --out DIR --json OUT.json`) |
| `compare-fixtures.mjs` | `REF_DIR TEST_DIR [--json OUT] [--horizons T,..]`: two fixture folders in, JSON table out (below) |
| `make-solver-report.mjs` | assembles `1-ts-browser-solver.json` from the session and comparison files |
| `../ts-export/scenario-build.ts` (new) | `ignitionOf` and the scenario construction, **moved out of `export.ts`** (which now imports it) so that both arms build the same scenario from one source |

**`compare-fixtures.mjs` computes**, from files both folders have: per snapshot hash equality and the first diverging time; the two `init.bin` messages (typed arrays and scalars, wall-clock fields excluded); for every snapshot file in both, each typed array's count of differing cells, largest and RMS difference, and the scalar leaves that differ with both values; at each horizon the metrics of plan 10.3 from `fire.arrivalTime`: cells burnt in each, burnt in either, burnt in one only (and as % of ever-burning), burnt-area difference %, cells with a different arrival time over cells burnt in both, max, RMS, median and 95th percentile of the absolute difference, and the worst fraction of the applicable bar (embers on or off read from `meta.options.embers`); the same on `arrival.f32`; the first snapshot with a differing array and whether the count grows. **Not computed** (`notComputed` in the JSON): the embers-on bar "mean burnt area over 30 seeds within 12 %" (needs 30 seeds per engine); the C# against C# bit-identity bar; first-divergence across seeds (one pair gives one time); bars for fields other than arrival time and burnt status (rate of spread, intensity, moisture, air have no bar in 10.3; their differences are in the table as counts and sizes). "Ever-burning" is taken as burnt in either run; the reference (percent base) is the first folder.

## 5. The runner on a `-4h` scenario, 300 s of simulated time

`run-solver-browser.mjs katoomba6-fast-4h --to 300 --keep 300` and `ts-export/run.mjs export katoomba6-fast-4h --to 300 --keep 300`: both fixtures pass `ts-export/run.mjs verify` (decoded with the app's codec; hashes and `arrival.f32` agree); `inspect.mjs` reads the browser's `snap-300.bin`; Chromium 0.43 s (705 sim s per wall s), 152 burnt cells in both; hashes 2 of 2 equal to Node's (snapshots at 0 and 300 s); 24 `init.bin` scalars differ (weather, as above), 0 of 25 arrays. The 4 h runs themselves are T3.1c's (about 13 s of Node time for the 6 km fast one).

## 6. Reproduce

```
npm ci                                  # or a node_modules link in the repository root
FIX=<scratchpad>/fixtures
node prototypes/dotnet-b/ts-export/run.mjs export katoomba3-fast --out $FIX --to 900 --dir k3f-node
node prototypes/dotnet-b/harness/run-solver-browser.mjs katoomba3-fast --out $FIX --to 900 --dir k3f-chromium
node prototypes/dotnet-b/harness/run-solver-browser.mjs katoomba3-fast --out $FIX --to 900 --dir k3f-chromium-nodeinit --init-from $FIX/k3f-node
node prototypes/dotnet-b/harness/compare-fixtures.mjs $FIX/k3f-node $FIX/k3f-chromium --json cmp.json
flock /tmp/firesim-heavy.lock node prototypes/dotnet-b/harness/solver-abba.mjs --out $FIX/timing --json session.json
```

## 7. Not done, caveats

- No phone, no WebView, no multi-thread browser run; Chromium only (one version: 153, headless). Firefox and Safari engines are not measured.
- Three runs per cell; the fast-tier ratio 1.048 has non-overlapping ranges but only three runs each on a shared container: treat it as "Chromium is at least not slower".
- `performance.memory` is absent in workers: no heap figures.
- The equality check used seed 11 (the scenario default); the timing runs seed 13 (their hashes also compared, section 2). One seed per scenario: the engine floor is a lower bound until T3.1c runs the horizons and seeds.
- Disk: when this card started `/` had 7.0 GB free (below the 8 GB rule, from other builders' scratch); this card's fixtures were under 400 MB and were removed at the end.
