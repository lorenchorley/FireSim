# T3.1b and T3.1c: the noise floor and the engine floor

What the agreement bars of plan section 10.3 can and cannot tell apart, measured on the TypeScript itself. Two floors, each against the **noise-free TypeScript in Node 22** (the reference engine of 10.3):

- **Noise floor (T3.1b):** the same TypeScript in Node 22 with libm-sized noise on every transcendental `Math` function (T3.1a's wrapper, `reports/3-scenarios.md` section 2): 10 draws per cell, one 4 h run per draw, read at 900 s, 1,800 s, 1 h, 2 h and 4 h. This stands in for "an independent port whose maths differs in the last bit".
- **Engine floor (T3.1c):** the same TypeScript, no noise, in Chromium 153 (V8 15.3) against Node 22 (V8 12.4): the difference today's desktop host and today's browsers already have.

The JSON is `3-floors.json` (stage `3-floors`, schema `RESULTS-SCHEMA.md`, with the full per-draw tables). Tables are at the end of this file.

## 1. Answers

1. **Fast tier: the bars sit far above the floor** up to 2 h, and at the edge at 4 h. 35 noise draws (30 Katoomba 6 km, 5 Warrumbungles 6 km): **33 are bit-identical to the reference in burnt status and arrival time at 4 h**, so at 900 s, 1,800 s, 1 h and 2 h every metric is exactly 0 in all 35. Two draws diverge late: Katoomba seed 12 draw 6 from 7,684 s (4 h: 1.33 % of ever-burning cells differ, area +1.25 %, median 0 s, 95th percentile 21 s: **above the 1 % cells bar**, below the 2 % area bar) and Warrumbungles draw 5 from 8,995 s (0.02 % of cells). Chromium against Node: **the arrival raster is bit-identical at every horizon in all four fast cells** (0 cells, 0 s), although the weather scalars differ in the last bit and many snapshot hashes differ.
2. **Standard tier, embers on (the case the plan builds Gate 3 on): the bars of 10.3 sit inside the floor from 1,800 s on, and at 900 s they are at the floor.** 30 draws (3 seeds x 10): above the 1 % cells bar in 1 of 30 draws at 900 s (1.49 %), 4 at 1,800 s, 11 at 1 h, 20 at 2 h, **23 of 30 at 4 h** (mean 5.0 %, median 5.3 %, 90th percentile 9.7 %, maximum 10.4 % of ever-burning cells; area difference mean 4.1 %, maximum 10.2 %; median arrival difference mean 73 s, maximum 896 s against the 30 s bar). A correct independent port, whose maths differ from V8's in the last bit, will fail the bars at 1 h or later most of the time. Only 7 of 30 draws are bit-identical at 4 h.
3. **T3.1a's one draw (5.8 % at 4 h) is a real floor, not an outlier.** It reproduces exactly here (katoomba3-standard-4h, solver seed 11, noise seed 1: 5.78 % of cells, area -5.34 %, median 25.8 s, 95th percentile 669 s). It is a typical draw of the 30: the 4 h median of the 30 is 5.3 %.
4. **The sensitivity is the embers.** With embers off (`katoomba3-standard-4h-noembers`, seed 13, 5 draws) every cell, area and median metric stays inside the embers-off bars (2.5 %, 2.5 %, 30 s) at every horizon: 4 h cells at most 0.90 %, area at most 0.65 %, median at most 1.9 s. Only the embers-off **95th percentile bar (60 s) is inside the floor at 4 h** (mean 116 s, maximum 182 s; 4 of 5 draws above it; at 2 h at most 20 s). The embers-off fast tier shows no difference at all (5 of 5 draws bit-identical). That contrast is the evidence; the mechanism (a spot fire that ignites in one run and not the other) was not traced here.
5. **Engine floor, standard tier: Chromium already differs from Node by as much as the bars from 2 h.** Cells differ 0 % at 900 s and 1,800 s (raster differences at most 2.4 s), 0 to 0.61 % at 1 h, **1.05, 1.18 and 1.40 % at 2 h (above the 1 % bar in all three seeds; area 0.06 to 1.07 %, under its 2 % bar)**, and 8.5, 0.7 and 7.1 % at 4 h (area -7.7, -0.03, -3.7 %; median arrival difference 14.5, 10.6 and 70.1 s: seed 14 is above the 30 s bar). First arrival difference at 665 to 748 s; first above the 1 % cells bar at 3,900 to 7,200 s. At 4 h the engine difference (0.7 to 8.5 %) is the size of the noise draws (0 to 10.4 %); at 2 h it is lower than the mean noise draw (1.0 to 1.4 % against 4.2 %). **The two arms (Chromium building its own scenario, and Chromium on Node's `init.bin`) give identical rasters at every horizon in all four cells**: the last-bit differences in the weather scalars that T1.5 (d) found change no bar metric; the engine's arithmetic does.
6. **A plan 10.3 bar is not a clean test of the port on the standard tier beyond 900 s.** This is the consequence for Gate 3; section 3 gives proposed bars, for the owner.

## 2. Conditions

| | |
|---|---|
| Machine | one container, Intel Xeon 2.10 GHz, 4 shared cores (one used per run), Linux 6.18.44, other builders on the same lock; **indicative** wall times |
| Reference and noise runs | Node v22.22.0 (V8 12.4.254.21), `ts-export` (T3.1a), exporter commit fd9eb43 (the earlier builder's tree); noise build with `**` lowered to `Math.pow`; noise seed of draw k is k, in every cell |
| Engine runs | Chromium 153.0.8010.12 (V8 15.3.76.4), headless, `chromium.launch()` with no options, Playwright's pre-installed build; the T1.5 (d) worker bundle (`harness/run-solver-browser.mjs`); one worker thread; not cross-origin isolated |
| Scenarios | `katoomba6-fast-4h` (6 km, fast, 200 x 200 @ 30 m, line ignition), `katoomba3-standard-4h` (3 km, standard, 100 x 100 @ 30 m), `warrumbungles6-fast-4h` (6 km, fast, point ignition); all embers on, preset `hot-nw-sw-change`, start 14:00, 14,400 s, snapshots every 300 s |
| Seeds and draws | solver seeds 12, 13, 14, 10 noise draws each (60 runs); `warrumbungles6-fast-4h` seed 13, 5 draws; **all 10 draws kept, none dropped** (T3.1a projected 25 to 30 minutes; it took 34). Chromium: 2 arms x 7 cells = 14 runs |
| Extras outside the card's matrix | T3.1a's draw (`katoomba3-standard-4h`, seed 11, noise seed 1); the two `-noembers` scenarios at seed 13 with 5 draws each; Chromium not run on them |
| Wall time under the heavy lock | matrix 86 jobs, 2,034 s (7 references 147 s, 14 Chromium runs 307 s, 65 noise runs 1,579 s: Katoomba fast 17 to 21 s, standard 30 to 33 s, Warrumbungles 15 to 17 s each); the extras 14 jobs, 307 s; checks about 3 minutes. About 42 minutes of the 4 h cap. Every hold of the lock was at most 756 s (chunks of floors-run.mjs with `--budget 780`, the lock released for 20 s between chunks) |
| Disk | scratch under 160 MB: each run's folder is deleted once its `arrival.f32`, `hashes.json` and `meta.json` are in the store (the five horizon snapshot files are kept only for the references and the Chromium arms, for the array comparison) |

**Who ran what.** The matrix of the card (86 jobs: all references, both Chromium arms, 65 noise draws) was run by the earlier builder, under the heavy lock, before the owner stopped it; the patch's README says no run was made, which was out of date (the run folders and `store/ledger.jsonl` were in the scratchpad). This builder did not take that on trust: `bars.mjs` was reviewed against 10.3 and its 8 tests run (section 5); three noise draws (fast seed 12 draw 6, standard seed 14 draw 10, standard seed 12 draw 5) and one reference (standard seed 13) were **re-run from scratch on today's tree and their `arrival.f32` are byte-identical to the store's**; the T3.1a draw, the `-noembers` extras and the sanity check of section 5 were run here.

## 3. What this means for Gate 3, and bars proposed to the owner

Plan 10.3 says "the bars stay where they are unless a floor comes near them". The floor is at or above them for the standard tier with embers on. Section 10.3 is **not** changed by this card; the owner decides. What the data supports:

| Case | Does a 10.3 bar sit inside the floor? | Proposal |
|---|---|---|
| **Fast tier, embers on or off** | No up to 2 h (floor exactly 0 in 35 of 35 draws and in Chromium). At 4 h the 1 % cells bar is touched by 1 of 35 draws (1.33 %), area 1.25 % is under its bar | Keep all bars. At 4 h allow **1.5 %** of cells (the 1 % bar would flag a correct port in about 3 % of draws); keep area 2 %, median 30 s |
| **Standard tier, embers off** | Cells, area and median: no (floor at most 0.9 %, 0.65 %, 1.9 s against 2.5 %, 2.5 %, 30 s; one seed, 5 draws, thin). **The 95th percentile bar (60 s): yes at 4 h** (floor mean 116 s, maximum 182 s) | Keep cells 2.5 %, area 2.5 %, median 30 s at all horizons; keep p95 60 s to 2 h (floor at most 20 s); at 4 h use **200 s** |
| **Standard tier, embers on, 900 s** | At the bar: 1 draw of 30 above 1 % (1.49 %); area 1.52 % under 2 %; median 0 s | Keep area 2 % and median 30 s; allow **1.5 %** of cells |
| **Standard tier, embers on, 1,800 s to 4 h** | **Yes.** The floor is 1 to 40 times the bar (cells: pooled 90th percentile 1.5, 26, 15 and 9.7 % at 1,800 s, 1 h, 2 h, 4 h; maximum 42, 43, 28, 10 %; one draw at 1,800 s and several at 1 h change the area by 40 to 76 % because a spot fire ignites in one run and not in the other). No fixed per-run bar that a correct port passes would still test the port cell by cell | Do not use per-run bars here. Use the ensemble instrument the plan already has for "a different random stream": the mean burnt area over N seeds. The noise floor gives its scale: the signed area difference of one draw at 4 h has mean -2.1 % and standard deviation 5.1 % (n = 30), so the mean over 30 seeds would have a standard deviation of about 1 %; the plan's 12 % is far wider than that, and **4 % at 4 h and 6 % at 2 h** (n = 30; 2 h: sd 9.2 %) are within what this data supports. At 1 h the single-draw sd is 18 % (skewed by one seed), so 1 h needs more seeds or none. Also report, not as a bar, the C# run's per-run metrics beside the noise draws' distribution (the tables below) |
| **Chromium against Node** (the engine floor), for the record | Standard tier embers on: yes from 2 h (cells 1.05 to 1.40 % against 1 %; at 4 h 0.7 to 8.5 %). Fast tier: no (zero) | If Gate 3 asks "is the C# as close to Node as Chromium is", the bars above are the right size on the standard tier; on the fast tier they are not (Chromium is bit-identical there, so a C# that matches only as well as the noise draws do is a good result and one that differs by 1 % is not) |

Two further consequences. (a) **The fast tier is the tier on which Gate 3 can be decided cell by cell**: its floor is zero, so any burnt-status difference of a C# port at or before 2 h is the port's. (b) **The floor is the embers**: plan 10.3's "embers on, generator and draw order ported exactly" row is the hard one; with embers off the standard tier passes its bars at 4 h except the 95th percentile.

## 4. What was not run, and why

- Chromium arms for the `-noembers` scenarios and for the standard tier's other seeds: not asked; the matrix has seeds 12 to 14 for the two Katoomba scenarios and seed 13 for Warrumbungles.
- Embers-off cells with more than seed 13 and 5 draws: not asked; the embers-off numbers are indicative (1 seed).
- Other engines than V8: Firefox (SpiderMonkey) and Safari (JavaScriptCore) were not run (no such browser here); its `Math` is not V8's and could differ more than Chromium's does. No phone was used: Android's WebView is Chromium, but not the version 153 used here.
- Other noise models: this noise is per call and uniform in the measured rates (`reports/3-scenarios.md` section 2 lists what it does not model: a real libm gives the same wrong answer for the same argument every time). Real .NET `Math` differs from V8 at rates not measured here.
- Hashes cannot compare noisy runs (the t = 0 snapshot differs), so first divergence is read from the arrival raster: a divergence that never reaches the arrival time (for example an air-field difference of 1e-8 that changes no ignition) is invisible to it. The array-level comparison exists only for Chromium (`compare.json` per run) and for one noisy fast draw (section 5).
- The tier "high" and the 3 km fast scenario: not part of T3.1.

## 5. Checks of the instruments

- **`bars.mjs` reviewed against 10.3** (the earlier builder's work, treated as unreviewed): `disagreePct` = cells burnt at H in exactly one run, per cent of cells burnt in either (ever-burning); `areaDiffPct` = |burnt candidate / burnt reference - 1|; median and 95th percentile of |arrival difference| over cells burnt in both (linear-interpolated quantiles); the burnt test is 0 <= arrival <= H, so a 4 h raster read at H is the run to H. Nothing was wrong; no edit. The 8 tests pass (`node --test prototypes/dotnet-b/ts-export/bars.test.mjs`). 10.3 says "of cells" for the embers-on row and "of ever-burning cells" for the embers-off row; ever-burning is used for both (the larger percentage, so the stricter reading).
- **"Nested run = one run per horizon"** (the premise of reading five horizons from one 4 h raster) was checked: `katoomba3-standard-4h` seed 13 run to 3,600 s and to 7,200 s separately against the 4 h run read at those times: 0 cells differ, and all 13 and 25 snapshot hashes are equal.
- **Cross-check against `harness/compare-fixtures.mjs`** (an independent implementation, on the snapshot arrays): the cell and area figures are the same at every horizon (for example standard seed 12 at 2 h 1.047 % and 0.865 %, at 4 h 8.460 % and 7.664 %). Its 95th percentile uses the nearest lower rank, `bars.mjs` interpolates: 561.7 s against 557.8 s on the same pair at 2 h. No bar uses the 95th percentile with embers on.
- **The noise is active on the fast tier** (it looked like a no-op: 33 of 35 draws identical): a fast draw (seed 13, noise seed 1) made 62.1 million wrapped calls and moved 5.2 million of them (exp 2.6 M, cbrt 0.87 M, atan2 0.51 M); its snapshot arrays equal the reference's at 900 s, 1,800 s, 3,600 s and 14,400 s, but at 7,200 s three air arrays differ (`atmosphere.u` 1 element, `v` 29, `w` 85, of 40,500, by about 1e-8): the noise reaches the air field, and the float32 stores and the diagnostic wind keep it away from the fire. The standard tier: 138.9 million calls, 2.7 million moved. So the fast tier's zero is the fire's robustness to last-bit noise in these scenarios, not a wrapper that does nothing; **it is a property of these scenarios** (two sites, one preset).
- **Chromium on the fast tier**: on Katoomba the typed arrays are equal at every horizon except 7,200 s, where one array differs (`atmosphere.w`; in seed 13 2 of 40,500 elements, by 1.5e-8); on Warrumbungles one array differs at 900 s and none later. The hashes differ at 23 to 49 of 49 snapshots, through scalar leaves (weather and stats values), not through the fire.
- **T1.5 (d)'s statement that 0 of 25 typed arrays differ to 900 s** holds for its scenarios (`katoomba3-standard` seed 11 from 12:00, 60 s snapshots). On the 4 h scenarios (start 14:00) the standard tier's arrays already differ at 900 s: 15 or 16 of 25, in both arms, with 6 to 11 arrival cells differing by at most 6.1e-5 s and the air fields by at most 4e-6; the first arrival difference is at 665 to 748 s.

## 6. How to repeat

```
source prototypes/dotnet-b/env.sh                      # node is the system Node 22; the SDK is not needed
export WORK=<scratch>/T3.1bc                           # the store (11 MB) and the reference folders (about 100 MB)
FS_BUILD_DIR=$PWD/prototypes/dotnet-b/fixtures/.build-floors-clean node prototypes/dotnet-b/ts-export/run.mjs export katoomba6-fast-4h --out $WORK/pre --to 900 --keep last   # makes the clean build
FS_BUILD_DIR=$PWD/prototypes/dotnet-b/fixtures/.build-floors-noise node prototypes/dotnet-b/ts-export/run.mjs export katoomba6-fast-4h --out $WORK/pre --to 900 --keep last --noise 1   # the noise build
bash prototypes/dotnet-b/ts-export/floors-loop.sh ref,chrome,chromeinit,noise --glimpse --noembers     # resumable, takes the heavy lock per chunk
node prototypes/dotnet-b/ts-export/floors.mjs --store $WORK/store --json out.json --md out.tables.md   # the tables below
```

`node_modules` must exist (a link to the main checkout's works). The pieces: `ts-export/bars.mjs` (metrics and bars), `floors-run.mjs` (the runner), `floors-loop.sh` (the loop), `floors.mjs` (tables and JSON), `harness/run-solver-browser.mjs` and `harness/compare-fixtures.mjs` (the Chromium arms).

# Tables

Generated by `ts-export/floors.mjs` from the store. Percentages of cells are of the cells burnt in either run (ever-burning); "area difference" is the absolute difference of burnt area as a percentage of the reference's; "worst fraction of a bar" is the largest metric-to-bar ratio at that horizon (1 = at the bar). The seed 11 rows are T3.1a's draw and are not pooled.

Bars (embers on): cells 1 %, area 2 %, median 30 s (embers off: 2.5 %, 2.5 %, 30 s, p95 60 s).

### katoomba3-standard-4h (standard, Katoomba 3 km)

Bars used (plan 10.3, embers on): cells 1 %, area 2 %, median 30 s.

Noise floor, per seed (mean / min / max over draws), by horizon.

| seed | horizon | draws | cells differ, % of ever-burning | area difference, % (signed mean) | median arrival diff, s | 95th pct, s | worst fraction of a bar | draws at or above a bar |
|---|---|---|---|---|---|---|---|---|
| 11 | 900 s | 1 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 1 |
| 11 | 1,800 s | 1 | 0.05 / 0.05 / 0.05 | 0.05 / 0.05 / 0.05 (0.05) | 0.0 / 0.0 / 0.0 | 0.2 / 0.2 / 0.2 | 0.05 / 0.05 | 0 of 1 |
| 11 | 1 h | 1 | 0.44 / 0.44 / 0.44 | 0.20 / 0.20 / 0.20 (-0.20) | 0.0 / 0.0 / 0.0 | 19.5 / 19.5 / 19.5 | 0.44 / 0.44 | 0 of 1 |
| 11 | 2 h | 1 | 0.77 / 0.77 / 0.77 | 0.32 / 0.32 / 0.32 (0.32) | 0.1 / 0.1 / 0.1 | 129.2 / 129.2 / 129.2 | 0.77 / 0.77 | 0 of 1 |
| 11 | 4 h | 1 | 5.78 / 5.78 / 5.78 | 5.34 / 5.34 / 5.34 (-5.34) | 25.8 / 25.8 / 25.8 | 668.6 / 668.6 / 668.6 | 5.78 / 5.78 | 1 of 1 |
| 12 | 900 s | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 12 | 1,800 s | 10 | 0.04 / 0.00 / 0.14 | 0.03 / 0.00 / 0.14 (0.03) | 0.0 / 0.0 / 0.0 | 0.6 / 0.0 / 3.0 | 0.04 / 0.14 | 0 of 10 |
| 12 | 1 h | 10 | 3.74 / 0.00 / 17.63 | 4.33 / 0.00 / 21.18 (4.33) | 0.0 / 0.0 / 0.0 | 11.3 / 0.0 / 23.1 | 3.74 / 17.63 | 2 of 10 |
| 12 | 2 h | 10 | 3.68 / 0.00 / 6.67 | 3.40 / 0.00 / 6.06 (-1.10) | 0.1 / 0.0 / 0.6 | 675.2 / 0.0 / 2787.9 | 3.68 / 6.67 | 6 of 10 |
| 12 | 4 h | 10 | 4.87 / 0.00 / 10.37 | 4.28 / 0.00 / 10.21 (-4.28) | 22.2 / 0.0 / 48.5 | 1033.8 / 0.0 / 2507.4 | 4.87 / 10.37 | 7 of 10 |
| 13 | 900 s | 10 | 0.28 / 0.00 / 0.93 | 0.28 / 0.00 / 0.94 (0.28) | 0.0 / 0.0 / 0.0 | 0.3 / 0.0 / 1.1 | 0.28 / 0.93 | 0 of 10 |
| 13 | 1,800 s | 10 | 0.55 / 0.00 / 1.54 | 0.21 / 0.00 / 0.63 (-0.19) | 0.5 / 0.0 / 1.6 | 18.9 / 0.0 / 50.0 | 0.55 / 1.54 | 3 of 10 |
| 13 | 1 h | 10 | 1.57 / 0.00 / 8.90 | 1.33 / 0.00 / 8.75 (0.42) | 1.1 / 0.0 / 3.8 | 68.4 / 0.0 / 179.2 | 1.57 / 8.90 | 5 of 10 |
| 13 | 2 h | 10 | 1.02 / 0.00 / 2.07 | 0.54 / 0.00 / 1.93 (0.54) | 4.8 / 0.0 / 13.2 | 311.9 / 0.0 / 1762.8 | 1.02 / 2.07 | 7 of 10 |
| 13 | 4 h | 10 | 3.64 / 0.00 / 9.65 | 3.01 / 0.00 / 9.48 (3.01) | 17.5 / 0.0 / 37.1 | 467.5 / 0.0 / 1534.4 | 3.64 / 9.65 | 7 of 10 |
| 14 | 900 s | 10 | 0.15 / 0.00 / 1.49 | 0.15 / 0.00 / 1.52 (0.15) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.15 / 1.49 | 1 of 10 |
| 14 | 1,800 s | 10 | 4.21 / 0.00 / 41.91 | 4.04 / 0.00 / 40.12 (4.04) | 0.0 / 0.0 / 0.0 | 3.1 / 0.0 / 30.9 | 4.21 / 41.91 | 1 of 10 |
| 14 | 1 h | 10 | 13.06 / 0.00 / 43.27 | 19.43 / 0.00 / 75.63 (19.26) | 0.5 / 0.0 / 4.6 | 206.3 / 0.0 / 1747.2 | 13.06 / 43.27 | 4 of 10 |
| 14 | 2 h | 10 | 7.96 / 0.00 / 28.28 | 9.57 / 0.00 / 38.72 (9.19) | 35.8 / 0.0 / 330.3 | 1427.6 / 0.0 / 3922.5 | 7.96 / 28.28 | 7 of 10 |
| 14 | 4 h | 10 | 6.54 / 0.00 / 9.94 | 4.96 / 0.00 / 9.48 (-4.96) | 179.1 / 0.0 / 895.8 | 1771.3 / 0.0 / 4704.9 | 8.86 / 29.86 | 9 of 10 |

Pooled over the seeds of the matrix (all draws): each bar's metric as mean / median / 90th percentile / max, and the number of draws above that bar.

| horizon | draws | cells differ, % of ever-burning | area difference, % | median arrival diff, s | 95th pct, s | draws above the bar: cells / area / median | draws with any difference |
|---|---|---|---|---|---|---|---|
| 900 s | 30 | 0.14 / 0.00 / 0.93 / 1.49 | 0.14 / 0.00 / 0.94 / 1.52 | 0.0 / 0.0 / 0.0 / 0.0 | 0.1 / 0.0 / 0.1 / 1.1 | 1 / 0 / 0 of 30 | 18 of 30 |
| 1,800 s | 30 | 1.60 / 0.00 / 1.54 / 41.91 | 1.42 / 0.00 / 0.63 / 40.12 | 0.2 / 0.0 / 0.2 / 1.6 | 7.6 / 0.0 / 35.9 / 50.0 | 4 / 1 / 0 of 30 | 20 of 30 |
| 1 h | 30 | 6.13 / 0.52 / 26.21 / 43.27 | 8.36 / 0.19 / 35.51 / 75.63 | 0.5 / 0.0 / 3.7 / 4.6 | 95.3 / 1.5 / 172.1 / 1747.2 | 11 / 7 / 0 of 30 | 20 of 30 |
| 2 h | 30 | 4.22 / 1.38 / 15.44 / 28.28 | 4.50 / 0.66 / 17.71 / 38.72 | 13.6 / 0.0 / 13.2 / 330.3 | 804.9 / 228.4 / 3024.5 / 3922.5 | 20 / 10 / 1 of 30 | 23 of 30 |
| 4 h | 30 | 5.01 / 5.26 / 9.71 / 10.37 | 4.08 / 3.49 / 8.95 / 10.21 | 72.9 / 28.1 / 166.2 / 895.8 | 1090.9 / 765.1 / 2613.9 / 4704.9 | 23 / 19 / 15 of 30 | 23 of 30 |

First divergence of the noise draws, seconds into the fire. `any` = the first moment any cell's arrival time differs at all (even by a float32 step); `snapshot` = the next 300 s snapshot; `first above a bar` = the first 300 s grid time at which a metric is above its bar, median over the draws that get there (a draw that never does is not counted; `draws that ever go above` says how many).

| seed | draws | bit-identical to the reference | any: min / median / max | snapshot: min / median / max | draws that ever go above: cells / area / median | first above a bar: cells / area / median (median over those draws) |
|---|---|---|---|---|---|---|
| 11 (T3.1a draw) | 1 | 0 | 5 / 5 / 5 | 300 / 300 / 300 | 1 / 1 / 0 | 8100 / 8400 / none |
| 12 | 10 | 3 | 5 / 6 / 4981 | 300 / 300 / 5100 | 7 / 7 / 5 | 4500 / 6300 / 11700 |
| 13 | 10 | 3 | 5 / 6 / 929 | 300 / 300 / 1200 | 7 / 7 / 3 | 3000 / 8700 / 11100 |
| 14 | 10 | 1 | 5 / 285 / 6787 | 300 / 300 / 6900 | 9 / 9 / 7 | 3900 / 3900 / 8400 |

Engine floor: Chromium 153 against Node 22, no noise. Two arms: `own` = the browser builds its own scenario; `init` = the browser solver runs on Node's init.bin. Where both arms give the same numbers they are one row (`own = init`).


First divergence of Chromium from Node (own arm; seconds into the fire): the first moment any arrival time differs, and the first 300 s grid time above each bar (none = never, up to 4 h).

| seed | any difference | snapshot | first above: cells / area / median |
|---|---|---|---|
| 12 | 725 | 900 | 5400 / 5400 / none |
| 13 | 748 | 900 | 7200 / none / none |
| 14 | 665 | 900 | 3900 / 3900 / 9900 |

The two arms, by horizon:

| seed | arm | horizon | cells differ, % | area diff, % (signed) | median s | 95th pct s | max s | worst fraction of a bar |
|---|---|---|---|---|---|---|---|---|
| 12 | own = init | 900 s | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 12 | own = init | 1,800 s | 0.000 | 0.000 (0.000) | 0.000 | 0.001 | 0.043 | 0.0000 |
| 12 | own = init | 1 h | 0.000 | 0.000 (0.000) | 0.000 | 0.010 | 24.822 | 0.0000 |
| 12 | own = init | 2 h | 1.047 | 0.865 (0.865) | 0.000 | 557.770 | 2086.547 | 1.0473 |
| 12 | own = init | 4 h | 8.460 | 7.664 (-7.664) | 14.459 | 807.354 | 3423.021 | 8.4598 |
| 13 | own = init | 900 s | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 13 | own = init | 1,800 s | 0.000 | 0.000 (0.000) | 0.000 | 0.001 | 0.021 | 0.0000 |
| 13 | own = init | 1 h | 0.176 | 0.000 (0.000) | 0.000 | 0.552 | 81.851 | 0.1758 |
| 13 | own = init | 2 h | 1.181 | 0.059 (0.059) | 0.000 | 91.730 | 783.575 | 1.1806 |
| 13 | own = init | 4 h | 0.672 | 0.031 (-0.031) | 10.615 | 335.019 | 3546.658 | 0.6718 |
| 14 | own = init | 900 s | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 14 | own = init | 1,800 s | 0.000 | 0.000 (0.000) | 0.000 | 0.002 | 2.405 | 0.0000 |
| 14 | own = init | 1 h | 0.614 | 0.461 (-0.461) | 0.000 | 1.873 | 83.166 | 0.6144 |
| 14 | own = init | 2 h | 1.405 | 1.066 (-1.066) | 0.062 | 225.848 | 965.753 | 1.4049 |
| 14 | own = init | 4 h | 7.088 | 3.664 (-3.664) | 70.126 | 1415.887 | 5012.685 | 7.0885 |

### katoomba3-standard-4h-noembers (standard, Katoomba 3 km, embers off)

Bars used (plan 10.3, embers off): cells 2.5 %, area 2.5 %, median 30 s, 95th percentile 60 s.

Noise floor, per seed (mean / min / max over draws), by horizon.

| seed | horizon | draws | cells differ, % of ever-burning | area difference, % (signed mean) | median arrival diff, s | 95th pct, s | worst fraction of a bar | draws at or above a bar |
|---|---|---|---|---|---|---|---|---|
| 13 | 900 s | 5 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 5 |
| 13 | 1,800 s | 5 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.1 | 0.00 / 0.00 | 0 of 5 |
| 13 | 1 h | 5 | 0.16 / 0.00 / 0.34 | 0.16 / 0.00 / 0.34 (0.16) | 0.0 / 0.0 / 0.0 | 0.1 / 0.0 / 0.3 | 0.06 / 0.14 | 0 of 5 |
| 13 | 2 h | 5 | 0.16 / 0.00 / 0.26 | 0.12 / 0.00 / 0.26 (0.12) | 0.0 / 0.0 / 0.0 | 11.4 / 0.0 / 20.0 | 0.19 / 0.33 | 0 of 5 |
| 13 | 4 h | 5 | 0.58 / 0.00 / 0.90 | 0.32 / 0.00 / 0.65 (0.25) | 1.1 / 0.0 / 1.9 | 115.9 / 0.0 / 182.2 | 1.93 / 3.04 | 4 of 5 |

Pooled over the seeds of the matrix (all draws): each bar's metric as mean / median / 90th percentile / max, and the number of draws above that bar.

| horizon | draws | cells differ, % of ever-burning | area difference, % | median arrival diff, s | 95th pct, s | draws above the bar: cells / area / median / 95th pct | draws with any difference |
|---|---|---|---|---|---|---|---|
| 900 s | 5 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 / 0 of 5 | 3 of 5 |
| 1,800 s | 5 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.1 | 0 / 0 / 0 / 0 of 5 | 4 of 5 |
| 1 h | 5 | 0.16 / 0.11 / 0.34 / 0.34 | 0.16 / 0.11 / 0.34 / 0.34 | 0.0 / 0.0 / 0.0 / 0.0 | 0.1 / 0.1 / 0.2 / 0.3 | 0 / 0 / 0 / 0 of 5 | 4 of 5 |
| 2 h | 5 | 0.16 / 0.17 / 0.26 / 0.26 | 0.12 / 0.09 / 0.26 / 0.26 | 0.0 / 0.0 / 0.0 / 0.0 | 11.4 / 16.1 / 19.9 / 20.0 | 0 / 0 / 0 / 0 of 5 | 4 of 5 |
| 4 h | 5 | 0.58 / 0.65 / 0.84 / 0.90 | 0.32 / 0.39 / 0.55 / 0.65 | 1.1 / 1.6 / 1.8 / 1.9 | 115.9 / 123.0 / 177.6 / 182.2 | 0 / 0 / 0 / 4 of 5 | 4 of 5 |

First divergence of the noise draws, seconds into the fire. `any` = the first moment any cell's arrival time differs at all (even by a float32 step); `snapshot` = the next 300 s snapshot; `first above a bar` = the first 300 s grid time at which a metric is above its bar, median over the draws that get there (a draw that never does is not counted; `draws that ever go above` says how many).

| seed | draws | bit-identical to the reference | any: min / median / max | snapshot: min / median / max | draws that ever go above: cells / area / median | first above a bar: cells / area / median (median over those draws) |
|---|---|---|---|---|---|---|
| 13 | 5 | 1 | 5 / 5 / 1195 | 300 / 300 / 1200 | 0 / 0 / 0 | none / none / none |

### katoomba6-fast-4h (fast, Katoomba 6 km)

Bars used (plan 10.3, embers on): cells 1 %, area 2 %, median 30 s.

Noise floor, per seed (mean / min / max over draws), by horizon.

| seed | horizon | draws | cells differ, % of ever-burning | area difference, % (signed mean) | median arrival diff, s | 95th pct, s | worst fraction of a bar | draws at or above a bar |
|---|---|---|---|---|---|---|---|---|
| 12 | 900 s | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 12 | 1,800 s | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 12 | 1 h | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 12 | 2 h | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 12 | 4 h | 10 | 0.13 / 0.00 / 1.33 | 0.13 / 0.00 / 1.25 (0.13) | 0.0 / 0.0 / 0.0 | 2.1 / 0.0 / 20.9 | 0.13 / 1.33 | 1 of 10 |
| 13 | 900 s | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 13 | 1,800 s | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 13 | 1 h | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 13 | 2 h | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 13 | 4 h | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 14 | 900 s | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 14 | 1,800 s | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 14 | 1 h | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 14 | 2 h | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |
| 14 | 4 h | 10 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 10 |

Pooled over the seeds of the matrix (all draws): each bar's metric as mean / median / 90th percentile / max, and the number of draws above that bar.

| horizon | draws | cells differ, % of ever-burning | area difference, % | median arrival diff, s | 95th pct, s | draws above the bar: cells / area / median | draws with any difference |
|---|---|---|---|---|---|---|---|
| 900 s | 30 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 of 30 | 0 of 30 |
| 1,800 s | 30 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 of 30 | 0 of 30 |
| 1 h | 30 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 of 30 | 0 of 30 |
| 2 h | 30 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 of 30 | 0 of 30 |
| 4 h | 30 | 0.04 / 0.00 / 0.00 / 1.33 | 0.04 / 0.00 / 0.00 / 1.25 | 0.0 / 0.0 / 0.0 / 0.0 | 0.7 / 0.0 / 0.0 / 20.9 | 1 / 0 / 0 of 30 | 1 of 30 |

First divergence of the noise draws, seconds into the fire. `any` = the first moment any cell's arrival time differs at all (even by a float32 step); `snapshot` = the next 300 s snapshot; `first above a bar` = the first 300 s grid time at which a metric is above its bar, median over the draws that get there (a draw that never does is not counted; `draws that ever go above` says how many).

| seed | draws | bit-identical to the reference | any: min / median / max | snapshot: min / median / max | draws that ever go above: cells / area / median | first above a bar: cells / area / median (median over those draws) |
|---|---|---|---|---|---|---|
| 12 | 10 | 9 | 7684 / 7684 / 7684 | 7800 / 7800 / 7800 | 1 / 0 / 0 | 14100 / none / none |
| 13 | 10 | 10 | none | none | 0 / 0 / 0 | none / none / none |
| 14 | 10 | 10 | none | none | 0 / 0 / 0 | none / none / none |

Engine floor: Chromium 153 against Node 22, no noise. Two arms: `own` = the browser builds its own scenario; `init` = the browser solver runs on Node's init.bin. Where both arms give the same numbers they are one row (`own = init`).


First divergence of Chromium from Node (own arm; seconds into the fire): the first moment any arrival time differs, and the first 300 s grid time above each bar (none = never, up to 4 h).

| seed | any difference | snapshot | first above: cells / area / median |
|---|---|---|---|
| 12 | none (bit-identical raster) | none | none / none / none |
| 13 | none (bit-identical raster) | none | none / none / none |
| 14 | none (bit-identical raster) | none | none / none / none |

The two arms, by horizon:

| seed | arm | horizon | cells differ, % | area diff, % (signed) | median s | 95th pct s | max s | worst fraction of a bar |
|---|---|---|---|---|---|---|---|---|
| 12 | own = init | 900 s | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 12 | own = init | 1,800 s | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 12 | own = init | 1 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 12 | own = init | 2 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 12 | own = init | 4 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 13 | own = init | 900 s | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 13 | own = init | 1,800 s | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 13 | own = init | 1 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 13 | own = init | 2 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 13 | own = init | 4 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 14 | own = init | 900 s | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 14 | own = init | 1,800 s | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 14 | own = init | 1 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 14 | own = init | 2 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 14 | own = init | 4 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |

### katoomba6-fast-4h-noembers (fast, Katoomba 6 km, embers off)

Bars used (plan 10.3, embers off): cells 2.5 %, area 2.5 %, median 30 s, 95th percentile 60 s.

Noise floor, per seed (mean / min / max over draws), by horizon.

| seed | horizon | draws | cells differ, % of ever-burning | area difference, % (signed mean) | median arrival diff, s | 95th pct, s | worst fraction of a bar | draws at or above a bar |
|---|---|---|---|---|---|---|---|---|
| 13 | 900 s | 5 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 5 |
| 13 | 1,800 s | 5 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 5 |
| 13 | 1 h | 5 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 5 |
| 13 | 2 h | 5 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 5 |
| 13 | 4 h | 5 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 5 |

Pooled over the seeds of the matrix (all draws): each bar's metric as mean / median / 90th percentile / max, and the number of draws above that bar.

| horizon | draws | cells differ, % of ever-burning | area difference, % | median arrival diff, s | 95th pct, s | draws above the bar: cells / area / median / 95th pct | draws with any difference |
|---|---|---|---|---|---|---|---|
| 900 s | 5 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 / 0 of 5 | 0 of 5 |
| 1,800 s | 5 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 / 0 of 5 | 0 of 5 |
| 1 h | 5 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 / 0 of 5 | 0 of 5 |
| 2 h | 5 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 / 0 of 5 | 0 of 5 |
| 4 h | 5 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 / 0 of 5 | 0 of 5 |

First divergence of the noise draws, seconds into the fire. `any` = the first moment any cell's arrival time differs at all (even by a float32 step); `snapshot` = the next 300 s snapshot; `first above a bar` = the first 300 s grid time at which a metric is above its bar, median over the draws that get there (a draw that never does is not counted; `draws that ever go above` says how many).

| seed | draws | bit-identical to the reference | any: min / median / max | snapshot: min / median / max | draws that ever go above: cells / area / median | first above a bar: cells / area / median (median over those draws) |
|---|---|---|---|---|---|---|
| 13 | 5 | 5 | none | none | 0 / 0 / 0 | none / none / none |

### warrumbungles6-fast-4h (fast, Warrumbungles 6 km)

Bars used (plan 10.3, embers on): cells 1 %, area 2 %, median 30 s.

Noise floor, per seed (mean / min / max over draws), by horizon.

| seed | horizon | draws | cells differ, % of ever-burning | area difference, % (signed mean) | median arrival diff, s | 95th pct, s | worst fraction of a bar | draws at or above a bar |
|---|---|---|---|---|---|---|---|---|
| 13 | 900 s | 5 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 5 |
| 13 | 1,800 s | 5 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 5 |
| 13 | 1 h | 5 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 5 |
| 13 | 2 h | 5 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 (0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.00 | 0 of 5 |
| 13 | 4 h | 5 | 0.00 / 0.00 / 0.02 | 0.00 / 0.00 / 0.01 (-0.00) | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.00 / 0.02 | 0 of 5 |

Pooled over the seeds of the matrix (all draws): each bar's metric as mean / median / 90th percentile / max, and the number of draws above that bar.

| horizon | draws | cells differ, % of ever-burning | area difference, % | median arrival diff, s | 95th pct, s | draws above the bar: cells / area / median | draws with any difference |
|---|---|---|---|---|---|---|---|
| 900 s | 5 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 of 5 | 0 of 5 |
| 1,800 s | 5 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 of 5 | 0 of 5 |
| 1 h | 5 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 of 5 | 0 of 5 |
| 2 h | 5 | 0.00 / 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 of 5 | 0 of 5 |
| 4 h | 5 | 0.00 / 0.00 / 0.01 / 0.02 | 0.00 / 0.00 / 0.01 / 0.01 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 / 0.0 | 0 / 0 / 0 of 5 | 1 of 5 |

First divergence of the noise draws, seconds into the fire. `any` = the first moment any cell's arrival time differs at all (even by a float32 step); `snapshot` = the next 300 s snapshot; `first above a bar` = the first 300 s grid time at which a metric is above its bar, median over the draws that get there (a draw that never does is not counted; `draws that ever go above` says how many).

| seed | draws | bit-identical to the reference | any: min / median / max | snapshot: min / median / max | draws that ever go above: cells / area / median | first above a bar: cells / area / median (median over those draws) |
|---|---|---|---|---|---|---|
| 13 | 5 | 4 | 8995 / 8995 / 8995 | 9000 / 9000 / 9000 | 0 / 0 / 0 | none / none / none |

Engine floor: Chromium 153 against Node 22, no noise. Two arms: `own` = the browser builds its own scenario; `init` = the browser solver runs on Node's init.bin. Where both arms give the same numbers they are one row (`own = init`).


First divergence of Chromium from Node (own arm; seconds into the fire): the first moment any arrival time differs, and the first 300 s grid time above each bar (none = never, up to 4 h).

| seed | any difference | snapshot | first above: cells / area / median |
|---|---|---|---|
| 13 | none (bit-identical raster) | none | none / none / none |

The two arms, by horizon:

| seed | arm | horizon | cells differ, % | area diff, % (signed) | median s | 95th pct s | max s | worst fraction of a bar |
|---|---|---|---|---|---|---|---|---|
| 13 | own = init | 900 s | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 13 | own = init | 1,800 s | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 13 | own = init | 1 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 13 | own = init | 2 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
| 13 | own = init | 4 h | 0.000 | 0.000 (0.000) | 0.000 | 0.000 | 0.000 | 0.0000 |
