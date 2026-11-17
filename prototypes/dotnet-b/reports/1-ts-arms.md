# Stage 1, T1.5 (a) to (c): the TypeScript arms of the T1.4 kernels

Indicative container numbers (4 shared vCPUs, Intel Xeon @ 2.10 GHz, Ubuntu 24.04, Node 22.22.0 / V8 12.4.254.21-node.33, Chromium 153.0.8010.12 / V8 15.3.76.4 headless via Playwright,
cross-origin isolated page). Results file: `1-ts-arms.json` (schema `RESULTS-SCHEMA.md`, stage `1-ts-arms`, `runtime` is `v8-node` or `v8-chromium`). Sources: `Fs.Bench/ts/arms/` (README there),
`harness/vite.arms.config.ts`, `harness/run-arms-browser.mjs`, `harness/engine-sin-check.mjs`. Code commit measured: `0a42956` (later commits change only the report generator, a cap on a printed list and this report).
Part (d) of the card (the whole TypeScript solver in the browser) is T1.5d's, merged earlier, and is not repeated.

## 1. Answer

**The best TypeScript opponents exist, they give the unmodified TypeScript's bits, and they are much closer to C# than one TypeScript thread is.**

1. **Bits (done when).** On Node 22, the app's unmodified kernels in one worker and the pool forms on 1, 2, 4 and 8 workers, each with the app's thresholds and with the chunked paths forced, reproduce **every golden hash of T1.4**:
   0 mismatches in 8,100 hash checks (10 runs of each of the 4 fixtures: 23 cases and 91 hashes on the 3 km grid, 25 and 97 on the 6 km grid, 311 hashes in each fast-tier window), and one digest of everything computed
   across all arms and worker counts. The check can fail: a mutation of the wavefront's tile order (run once, on a scratch copy of the bundle) is caught at 4 workers (8 mismatches) and, as it must be, not at 1.
   **In Chromium 153 the standard tier (air) and the level set equal the Node-22 hashes too, but the pyrogenic solve does not: 10 of its 311 hashes per window differ, for the app's own unmodified `PyrogenicPotential` as well.** The cause is
   `Math.sin`: the solver builds its sine tables with it, and Chromium's V8 15.3 gives a different last bit for 324 of the 10,000 table entries (1 ulp) and 4 of the 100 eigenvalue factors (`harness/engine-sin-check.mjs`), so the tables
   (`sx`, `lamX`, `sy`, `lamY`) and the double-precision `psi`, `gx`, `gy` differ. The float32 outputs the rest of the simulator reads, `up` and `vp`, are equal in every variant (the float32 store rounds the difference away, the same effect as T1.4b's
   mutation findings). **Inside Chromium the pool forms equal the app's own kernels on every hash, on 1, 2, 4 and 8 workers** (one digest for all 10 Chromium runs of a problem). So a Chromium arm cannot reproduce Node's pyrogenic hashes and nothing here can make it; it reproduces Chromium's own. This is
   the "engine floor" of plan 10.3, measured in a kernel, and a warning for T1.6b: C# (fdlibm port = Node 22) against Chromium's TypeScript will differ in `psi` for this reason alone.
2. **Where a threaded form cannot be bit-equal:** none found. None of the seven kernels has a reduction whose order depends on the chunking: the only reduction, `evaluate`'s CFL maximum, is a maximum of non-NaN doubles combined in chunk order, and every other output element is written by one chunk.
3. **Speed (Node, the best TypeScript arm per kernel against C#, table 'Best TypeScript arm against C#' below).** One TypeScript thread loses to C# by 1.1 to 2.1 times (scalar) on these kernels. The best TypeScript arm is the pool on 4 workers for 13 of 18 kernel cases (on 2 workers for 2, the app's own kernels in one worker for 3: relax at 3 km, reinit at 900 s, evaluate stage 1 at 4 h), and it **beats the C# *scalar* form on 12 of the 18**
   (gradient 0.55 to 0.61 of C# scalar's time, advect 0.39 to 0.53, evaluate stage 2 at 4 h 0.77, the pyrogenic solve 0.74 and 0.92), because C#'s scalar form is one thread. Against the **best C# form (four threads and `Vector128`)** the best TypeScript arm
   takes 0.66 to 3.18 times as long (median about 1.2); the kernels where C# keeps a clear lead are `relax` (1.7 and 1.9; threads do not help it in either language), the pyrogenic solve (1.76 and 3.18: `Vector128` is worth 1.5 to 2 times there and TypeScript has nothing like it),
   `evaluate` stage 1 (1.50 and 1.83: its serial, band-ordered speed pass limits every threaded form) and `reinit` at 900 s (1.69).
4. **Projected whole step (arithmetic on T1.1's shares, as T1.4a and T1.4b did; kernels only): C# best forms over the best TypeScript arm is 1.06x (standard tier), 1.04x (fast tier, 30-minute shares) and 1.09x (fast tier, 4-hour shares)**, against Gate 1's bars of 1.5x and 1.2x and
   Amdahl ceilings of 1.53x, 1.17x and 1.49x. The earlier readings against one TypeScript thread (1.21x, 1.10x, 1.23x with C#'s best forms) shrink because the TypeScript can use the same cores. Gate 1 stays `not run` (it is defined on the whole step, T6.4 and T6.6),
   but nothing in the kernels argues for a speed case over the best TypeScript arm.
5. **Browser worker against Node worker (A B B A, table 'Browser worker against Node worker' below):** the same kernels in a Chromium Web Worker run **0.96 to 1.22 times** Node's time (median 1.12): `advect` is 2 to 4 % faster, the gradient and the float32 divergence 1 to 4 % slower, `evaluate` 4 to 12 % slower, and `relax` (+21 %), the Float64 divergence (+17 %),
   `reinit` (+14 to 19 %) and the pyrogenic solve (+14 %) are 14 to 22 % slower. T1.5d's finding "the whole solver runs as fast in Chromium as in Node" (1.006x and 1.048x) holds for the whole step but **not kernel by kernel**: Gate 1W's TypeScript denominator should be taken per engine (this report's Chromium numbers), not from Node's.
6. **Threads in the browser work:** with the isolated page (COOP `same-origin`, COEP `require-corp`) 4 Chromium workers reach the same curve as 4 Node workers (table 'Chromium thread curve' below; within about 25 % of Node's, faster in a few cells), so "several workers when `crossOriginIsolated`" is a real TypeScript option wherever the host can isolate the page. Gate 1W compares with one worker, the arm the app has today.

Caveats that bear on every number: container with 4 shared vCPUs; the 1-minute load average at the start of a timed process was 1.0 to 3.5 (median 2.0; the multi-worker runs add to it themselves; other builders' unlocked work is not excluded); the two- and four-worker rows are **bimodal between runs** (see the min to max in the tables:
for example advect on 2 workers 1.04 to 1.59 ms), so their medians of three are indicative at best; the C# numbers are from earlier runs on the same container (T1.4a, T1.4b), not run together with these; kernels only, not the step; one Node version, one Chromium version.

## 2. What was built (all TypeScript; nothing in `src/` is touched)

| arm | what runs | files |
|---|---|---|
| (a) one worker | the app's UNMODIFIED kernels (`EllipticSolver.relax/gradient/divergence` through `EllipticSolver.prototype`, `dynamics.advect`, `LevelSetCore.evaluate/reinit`, `PyrogenicPotential.solve`, imported from `src/`), data resident in a `worker_threads` worker, timing inside the worker | `air-app.ts`, `fast-app.ts`, `worker-core.ts`, `worker-node.ts`, `node-main.ts` |
| (b) pool | **range forms of the kernels (the app's loop text cut to row, plane or band ranges) on the same chunks as the C# `Parallel.For` forms**: relax 2-row chunks with a barrier per colour pass and a serial rule under 8,192 cells; gradient and divergence one plane per chunk in two phases; advect 16 output rows; evaluate 256 band cells with a serial, band-ordered pass that calls the lazy speed hook first (so the draws keep their order) and the CFL maximum combined in chunk order; reinit 8-row chunks and a blocked 32 x 32 tile wavefront from 16,384 box cells with the count, prefix sum and fill of the band rebuild; the pyrogenic solve in six phases of 4-row chunks. 1, 2, 4, 8 workers over one `SharedArrayBuffer`, an `Atomics` counter barrier per region, dynamic chunk claiming (`Atomics.add`), the calling worker takes part, workers spawned once per run | `pool.ts`, `air-pool.ts`, `fast-pool.ts`, `air-pool-be.ts`, `fast-pool-be.ts` |
| (c) browser | arm (a) in one Web Worker and arm (b) on 1, 2, 4, 8 Web Workers in Chromium; one Vite bundle per role (`arms-worker.js`, `arms-page.js`), a local server that sends COOP and COEP, `crossOriginIsolated` checked true | `page-main.ts`, `worker-browser.ts`, `harness/vite.arms.config.ts`, `harness/run-arms-browser.mjs` |
| all | SHA-256 without `node:crypto` (`sha.ts`, same scheme as the C# tests: first 128 bits, NaN canonicalised, -0 kept), the fixture reader, the replay of every golden case (the recipes of `air/capture.ts` and `fast/lib.ts`, copied browser-safe and generalised by a factory so that the app's classes and the pool forms are replayed by one code), the timing loop, the drivers | `sha.ts`, `fixture.ts`, `air-cases.ts`, `fast-frames.ts`, `measure.ts`, `orchestrate.ts`, `run-arms.sh`, `measure.sh`, `make-report.mjs` |

Design points that matter for the numbers. (1) **Verify and time are separate processes** and fresh worker sets: a replay feeds NaN, -0 and Float64 distance arrays to the loops and would shape the timed code's type feedback. (2) A fresh process per fixture, three rounds, medians: as T1.4's TypeScript timing.
(3) One sample = one operation in Node, as T1.4 (1,000 samples, 600 on the 6 km grid, 1.5 s warm-up); in Chromium a sample is a batch of at least 2 ms (the clock of a worker has 0.1 ms resolution, 5 us isolated), and the Node side of the A B B A uses the same batching.
(4) The pool at 1 worker is the range form without helpers (no barrier): it differs from arm (a) by the split lazy-speed pass of `evaluate` and by working on `SharedArrayBuffer` views.
(5) Spin-waiting: a waiting thread spins `--spin` microseconds (default 200) and then sleeps in `Atomics.wait`; **with more workers than cores the default is 0**, because spinning threads on oversubscribed cores starve the working ones (the 'Spin-wait sensitivity' table below).
(6) Oversight corrected on the way: a start-up race (a helper that entered its loop after the driver's first region never joined it, so the first kernel of some timed runs hung until the pool's 60 s guard) was found in the first campaign, fixed by taking the generation at set-up, and **the whole campaign was rerun**; 75 consecutive starts at 2, 4 and 8 workers
afterwards did not hang, and the second campaign had no failed run.

Allocation: the pool forms allocate nothing per call (all arrays are in the arena; the closures are made once); the app's own kernels allocate as they always did (`gradient` returns its scratch arrays, no per-call allocation).

## 3. Method

Three rounds of: [Node: arm (a), pool 1, 2, 4, 8 on each of 4 fixtures] [A B B A: Node worker, Chromium worker, Chromium worker, Node worker, per fixture, the app kernels] [Chromium: pool 1, 2, 4, 8 per fixture], then one spin study; each step under its own `flock /tmp/firesim-heavy.lock` (holds of 5 to 7 minutes;
`conditions.log` in the JSON has the load average before and after each). One run = one fresh process; a table cell is the median of the runs' medians with the min to max of those (3 runs; 6 for the A B B A cells). Fixtures were regenerated for this card into a scratch folder with `air/regen.sh` and `fast/regen.sh`
(the golden files came out byte for byte as committed). `reinit` is shown net of `restore` (the copy that puts the frame back before each call), each arm subtracting its own restore (the pool's restore into `SharedArrayBuffer` views is slower: 0.014 against 0.008 ms), as T1.4b did.

Fixtures: **3 km** `katoomba3-standard` at 900 s, 30 x 30 x 20 (the app's grid; one operation of `relax` = the six relax calls of one V(2,2) from their recorded inputs, `advect` = the four calls of one step); **6 km** high tier, 60 x 60 x 24 (the larger size T1.4a used);
**fast tier** `katoomba6-fast-4h`, 200 x 200 fire cells, at 900 s (band 1,606, reinit box 103 x 91: the chunked evaluate and row phases run, the sweeps stay serial) and at 14,100 s (band 9,690, box 151 x 200: the wavefront runs).


# Tables (generated by `make-report.mjs`)

## Hash equality

One row = every verify run of one engine and problem: the app kernels in one worker and the pool on 1, 2, 4, 8 workers, each with the default thresholds and with the chunked paths forced (10 runs). The digest is a hash of every hash the run computed; "digests" counts how many different ones the 10 runs gave.

| engine | problem | runs | cases per run | hash checks per run | mismatches against the golden (Node 22) hashes, all runs | digests |
|---|---|---:|---:|---:|---:|---:|
| v8-chromium | air:k3std | 10 | 23 | 91 | 0 | 1 |
| v8-chromium | air:k6high | 10 | 25 | 97 | 0 | 1 |
| v8-chromium | fast:k6f-900 | 10 | 10 | 311 | 100 | 1 |
| v8-chromium | fast:k6f-late | 10 | 10 | 311 | 100 | 1 |
| v8-node | air:k3std | 10 | 23 | 91 | 0 | 1 |
| v8-node | air:k6high | 10 | 25 | 97 | 0 | 1 |
| v8-node | fast:k6f-900 | 10 | 10 | 311 | 0 | 1 |
| v8-node | fast:k6f-late | 10 | 10 | 311 | 0 | 1 |


## katoomba3-standard 3 km, 30x30x20 (the app grid): median ms per operation, Node 22 (V8 12.4), single operations; median of the run medians (min to max)

| kernel | app kernels, one worker (a) | pool 1 worker | pool 2 | pool 4 | pool 8 | best Node arm |
|---|---:|---:|---:|---:|---:|---|
| relax | 1.3577 (1.3539 to 1.3652) | 1.5388 (1.5318 to 1.5870) | 2.1517 (1.5389 to 2.1661) | 1.9582 (1.2745 to 1.9667) | 2.2763 (2.1051 to 2.3340) | app 1.3577 |
| gradient | 0.2454 (0.2454 to 0.2463) | 0.2210 (0.2188 to 0.2217) | 0.1358 (0.1324 to 0.2322) | 0.0961 (0.0954 to 0.0965) | 0.3435 (0.3006 to 0.3439) | pool4 0.0961 |
| divergenceF32 | 0.2623 (0.2616 to 0.2639) | 0.2679 (0.2657 to 0.2716) | 0.1439 (0.1424 to 0.2750) | 0.1124 (0.1114 to 0.1125) | 0.3495 (0.3024 to 0.3596) | pool4 0.1124 |
| divergenceF64 | 0.2878 (0.2847 to 0.2910) | 0.2925 (0.2919 to 0.2933) | 0.1550 (0.1525 to 0.2860) | 0.1573 (0.0830 to 0.1578) | 0.3504 (0.3295 to 0.3559) | pool2 0.1550 |
| advect | 1.8677 (1.8615 to 1.8776) | 1.9799 (1.9700 to 1.9983) | 1.0538 (1.0361 to 1.5879) | 0.6448 (0.6388 to 0.7846) | 1.1533 (1.0731 to 1.3805) | pool4 0.6448 |

## 6 km high tier, 60x60x24: median ms per operation, Node 22 (V8 12.4), single operations; median of the run medians (min to max)

| kernel | app kernels, one worker (a) | pool 1 worker | pool 2 | pool 4 | pool 8 | best Node arm |
|---|---:|---:|---:|---:|---:|---|
| relax | 5.9000 (5.7944 to 5.9372) | 6.4418 (6.3360 to 6.4925) | 7.1289 (6.5102 to 7.2166) | 5.3606 (4.3923 to 5.3827) | 6.2626 (5.8303 to 6.5563) | pool4 5.3606 |
| gradient | 1.2152 (1.2143 to 1.2281) | 1.0952 (1.0877 to 1.1021) | 1.0631 (0.6195 to 1.0835) | 0.5224 (0.4201 to 0.5607) | 0.7879 (0.6648 to 0.8027) | pool4 0.5224 |
| divergenceF32 | 1.3024 (1.2852 to 1.3046) | 1.3008 (1.2911 to 1.3262) | 0.6998 (0.6833 to 1.3306) | 0.4939 (0.4847 to 0.6915) | 0.7024 (0.6161 to 0.7049) | pool4 0.4939 |
| divergenceF64 | 1.4263 (1.4257 to 1.4300) | 1.4274 (1.4245 to 1.4574) | 1.3964 (0.7484 to 1.4202) | 0.7498 (0.5568 to 0.7555) | 0.8158 (0.7102 to 0.9055) | pool4 0.7498 |
| advect | 9.0683 (8.8146 to 9.1844) | 9.6200 (9.4755 to 9.7136) | 7.6171 (4.7175 to 7.6961) | 3.8935 (2.9833 to 3.9050) | 4.2800 (3.4913 to 4.2960) | pool4 3.8935 |

## katoomba6-fast-4h at 900 s (band 1,606): median ms per operation, Node 22 (V8 12.4), single operations; median of the run medians (min to max)

| kernel | app kernels, one worker (a) | pool 1 worker | pool 2 | pool 4 | pool 8 | best Node arm |
|---|---:|---:|---:|---:|---:|---|
| evalStage1 | 0.0308 (0.0306 to 0.0316) | 0.0395 (0.0390 to 0.0398) | 0.0296 (0.0293 to 0.0446) | 0.0316 (0.0244 to 0.0325) | 0.1428 (0.1243 to 0.1492) | pool2 0.0296 |
| evalStage2 | 0.0226 (0.0226 to 0.0236) | 0.0246 (0.0238 to 0.0247) | 0.0225 (0.0132 to 0.0226) | 0.0161 (0.0102 to 0.0163) | 0.1247 (0.1043 to 0.1291) | pool4 0.0161 |
| reinit (with the restore) | 0.7934 (0.7846 to 0.8363) | 0.8507 (0.8442 to 0.8830) | 0.8342 (0.8248 to 1.4373) | 1.3864 (0.8303 to 1.4061) | 1.3094 (1.2731 to 1.3202) | app 0.7852 net |
| pyro | 4.3544 (4.3393 to 4.3562) | 4.1536 (4.1431 to 4.1538) | 3.9263 (2.9378 to 3.9273) | 1.6005 (1.5926 to 2.1559) | 2.4383 (2.0648 to 2.6465) | pool4 1.6005 |
| restore alone (subtracted from reinit above in the "best" column) | 0.0083 | 0.0144 | 0.0144 | 0.0144 | 0.0144 | |

## katoomba6-fast-4h at 14,100 s (band 9,690): median ms per operation, Node 22 (V8 12.4), single operations; median of the run medians (min to max)

| kernel | app kernels, one worker (a) | pool 1 worker | pool 2 | pool 4 | pool 8 | best Node arm |
|---|---:|---:|---:|---:|---:|---|
| evalStage1 | 0.1774 (0.1738 to 0.1775) | 0.2352 (0.2344 to 0.2356) | 0.2547 (0.1612 to 0.2551) | 0.1846 (0.1654 to 0.1855) | 0.3047 (0.2594 to 0.3140) | app 0.1774 |
| evalStage2 | 0.1313 (0.1308 to 0.1336) | 0.1345 (0.1341 to 0.1369) | 0.0729 (0.0713 to 0.1191) | 0.0482 (0.0386 to 0.0623) | 0.1745 (0.1541 to 0.1795) | pool4 0.0482 |
| reinit (with the restore) | 3.3990 (3.3824 to 3.4529) | 3.5048 (3.4450 to 3.5209) | 3.4248 (2.6101 to 3.4370) | 2.3967 (1.8533 to 2.4283) | 10.4976 (10.1178 to 10.5989) | pool4 2.3809 net |
| pyro | 6.3127 (6.3008 to 6.4304) | 5.8409 (5.8354 to 5.9060) | 5.6861 (3.7736 to 5.7074) | 3.0892 (2.2891 to 3.1132) | 3.5356 (3.5157 to 3.5553) | pool4 3.0892 |
| restore alone (subtracted from reinit above in the "best" column) | 0.0091 | 0.0158 | 0.0158 | 0.0158 | 0.0158 | |

## TypeScript thread curve (Node, pool on the C# chunks): speed-up over the pool with 1 worker, and over the app kernels in one worker (above 1 = faster)

| problem | kernel | 2 workers | 4 workers | 8 workers (no spinning: 4 cores) | 4 workers over the app kernels |
|---|---|---:|---:|---:|---:|
| air:k3std | relax | 0.72 | 0.79 | 0.68 | 0.69 |
| air:k3std | gradient | 1.63 | 2.30 | 0.64 | 2.55 |
| air:k3std | divergenceF32 | 1.86 | 2.38 | 0.77 | 2.33 |
| air:k3std | divergenceF64 | 1.89 | 1.86 | 0.83 | 1.83 |
| air:k3std | advect | 1.88 | 3.07 | 1.72 | 2.90 |
| air:k6high | relax | 0.90 | 1.20 | 1.03 | 1.10 |
| air:k6high | gradient | 1.03 | 2.10 | 1.39 | 2.33 |
| air:k6high | divergenceF32 | 1.86 | 2.63 | 1.85 | 2.64 |
| air:k6high | divergenceF64 | 1.02 | 1.90 | 1.75 | 1.90 |
| air:k6high | advect | 1.26 | 2.47 | 2.25 | 2.33 |
| fast:k6f-900 | evalStage1 | 1.33 | 1.25 | 0.28 | 0.97 |
| fast:k6f-900 | evalStage2 | 1.09 | 1.53 | 0.20 | 1.40 |
| fast:k6f-900 | reinit | 1.02 | 0.61 | 0.65 | 0.57 |
| fast:k6f-900 | pyro | 1.06 | 2.60 | 1.70 | 2.72 |
| fast:k6f-late | evalStage1 | 0.92 | 1.27 | 0.77 | 0.96 |
| fast:k6f-late | evalStage2 | 1.85 | 2.79 | 0.77 | 2.72 |
| fast:k6f-late | reinit | 1.02 | 1.47 | 0.33 | 1.42 |
| fast:k6f-late | pyro | 1.03 | 1.89 | 1.65 | 2.04 |

## Browser worker against Node worker (the app kernels, one worker, batched samples of at least 2 ms, A B B A: Node, Chromium, Chromium, Node, three rounds)

| problem | kernel | Node ms (median of 6 runs; min to max) | Chromium ms (6 runs) | Chromium over Node |
|---|---|---:|---:|---:|
| air:k3std | relax | 1.3609 (1.3481 to 1.3912) | 1.6500 (1.6375 to 1.6950) | 1.212 |
| air:k3std | gradient | 0.2498 (0.2461 to 0.2543) | 0.2609 (0.2588 to 0.2650) | 1.044 |
| air:k3std | divergenceF32 | 0.2644 (0.2634 to 0.2669) | 0.2750 (0.2725 to 0.2794) | 1.040 |
| air:k3std | divergenceF64 | 0.2914 (0.2854 to 0.3011) | 0.3408 (0.3333 to 0.3450) | 1.169 |
| air:k3std | advect | 1.8885 (1.8636 to 1.9203) | 1.8487 (1.8350 to 1.8600) | 0.979 |
| air:k6high | relax | 5.7571 (5.7418 to 5.9022) | 7.0300 (6.9500 to 7.1800) | 1.221 |
| air:k6high | gradient | 1.2324 (1.2203 to 1.2788) | 1.2487 (1.2300 to 1.2575) | 1.013 |
| air:k6high | divergenceF32 | 1.2990 (1.2815 to 1.3384) | 1.3363 (1.3150 to 1.3425) | 1.029 |
| air:k6high | divergenceF64 | 1.4242 (1.3984 to 1.4366) | 1.6713 (1.6500 to 1.6925) | 1.173 |
| air:k6high | advect | 9.0571 (8.7977 to 9.1441) | 8.7025 (8.6300 to 8.7950) | 0.961 |
| fast:k6f-900 | evalStage1 | 0.0328 (0.0321 to 0.0333) | 0.0367 (0.0363 to 0.0371) | 1.119 |
| fast:k6f-900 | evalStage2 | 0.0234 (0.0232 to 0.0242) | 0.0254 (0.0249 to 0.0258) | 1.086 |
| fast:k6f-900 | reinit | 0.8103 (0.7925 to 0.8343) | 0.9637 (0.9350 to 1.1150) | 1.192 |
| fast:k6f-900 | pyro | 4.3734 (4.3417 to 4.6002) | 4.9675 (4.9400 to 5.0150) | 1.136 |
| fast:k6f-late | evalStage1 | 0.1809 (0.1755 to 0.1955) | 0.2029 (0.2010 to 0.2050) | 1.122 |
| fast:k6f-late | evalStage2 | 0.1355 (0.1338 to 0.1359) | 0.1414 (0.1397 to 0.1482) | 1.043 |
| fast:k6f-late | reinit | 3.3910 (3.3625 to 3.4605) | 3.8750 (3.7900 to 3.9400) | 1.143 |
| fast:k6f-late | pyro | 6.3452 (6.3209 to 7.0062) | 7.2225 (7.1850 to 7.2700) | 1.138 |

Chromium over Node, all 18 kernel cells: median 1.120, min 0.961, max 1.221.

## Chromium thread curve (cross-origin isolated page, pool on the C# chunks, batched samples): median ms per operation

| problem | kernel | Chromium app kernels, 1 worker (from the A B B A) | pool 1 | pool 2 | pool 4 | pool 8 | pool 4 in Node (single operations) |
|---|---|---:|---:|---:|---:|---:|---:|
| air:k3std | relax | 1.6500 | 1.7950 (1.7925 to 1.8250) | 2.5750 (2.5700 to 2.5800) | 2.2750 (2.1075 to 2.2900) | 2.3250 (2.2150 to 2.7900) | 1.9582 |
| air:k3std | gradient | 0.2609 | 0.2261 (0.2244 to 0.2295) | 0.1303 (0.1275 to 0.2311) | 0.1032 (0.0804 to 0.1269) | 0.2857 (0.2857 to 0.2893) | 0.0961 |
| air:k3std | divergenceF32 | 0.2750 | 0.2886 (0.2864 to 0.2917) | 0.1788 (0.1529 to 0.2929) | 0.1550 (0.1229 to 0.1615) | 0.3019 (0.3014 to 0.3025) | 0.1124 |
| air:k3std | divergenceF64 | 0.3408 | 0.3383 (0.3383 to 0.3500) | 0.3542 (0.1823 to 0.3575) | 0.1455 (0.1407 to 0.1827) | 0.2857 (0.2844 to 0.3392) | 0.1573 |
| air:k3std | advect | 1.8487 | 1.8925 (1.8850 to 1.8925) | 1.0350 (0.9733 to 1.4933) | 0.6125 (0.6100 to 0.7900) | 1.1250 (1.0975 to 1.1450) | 0.6448 |
| air:k6high | relax | 7.0300 | 7.5900 (7.4600 to 7.9000) | 8.4100 (8.3450 to 8.4500) | 5.3850 (5.1700 to 6.2100) | 6.6250 (6.5850 to 6.7250) | 5.3606 |
| air:k6high | gradient | 1.2487 | 1.0950 (1.0875 to 1.0975) | 1.0975 (0.6100 to 1.1125) | 0.5020 (0.4150 to 0.5920) | 0.7750 (0.6488 to 0.7867) | 0.5224 |
| air:k6high | divergenceF32 | 1.3363 | 1.3725 (1.3625 to 1.4175) | 0.8200 (0.7150 to 1.3650) | 0.5000 (0.4950 to 0.7317) | 0.8000 (0.7550 to 0.8567) | 0.4939 |
| air:k6high | divergenceF64 | 1.6713 | 1.6675 (1.6475 to 1.6900) | 1.7000 (1.6925 to 1.7750) | 0.7262 (0.5975 to 0.9017) | 0.9125 (0.8800 to 1.0550) | 0.7498 |
| air:k6high | advect | 8.7025 | 8.9200 (8.8750 to 9.2800) | 7.1800 (4.6100 to 7.3250) | 2.8650 (2.8550 to 3.6150) | 4.0300 (3.9750 to 4.1100) | 3.8935 |
| fast:k6f-900 | evalStage1 | 0.0367 | 0.0422 (0.0420 to 0.0426) | 0.0499 (0.0495 to 0.0501) | 0.0263 (0.0256 to 0.0405) | 0.1118 (0.1087 to 0.1125) | 0.0316 |
| fast:k6f-900 | evalStage2 | 0.0254 | 0.0254 (0.0253 to 0.0256) | 0.0162 (0.0139 to 0.0236) | 0.0109 (0.0108 to 0.0161) | 0.0890 (0.0800 to 0.0893) | 0.0161 |
| fast:k6f-900 | reinit | 0.9637 | 1.0500 (1.0400 to 1.1075) | 1.7025 (0.9900 to 1.7150) | 1.6675 (1.6300 to 1.6825) | 1.5325 (1.4700 to 1.5350) | 1.3864 |
| fast:k6f-900 | pyro | 4.9675 | 3.9450 (3.9450 to 3.9750) | 2.3250 (2.1100 to 3.7750) | 2.0400 (1.4875 to 2.0725) | 2.3800 (2.1100 to 2.4800) | 1.6005 |
| fast:k6f-late | evalStage1 | 0.2029 | 0.2344 (0.2300 to 0.2367) | 0.1606 (0.1596 to 0.1637) | 0.1905 (0.1683 to 0.1923) | 0.2631 (0.2394 to 0.2681) | 0.1846 |
| fast:k6f-late | evalStage2 | 0.1414 | 0.1290 (0.1284 to 0.1306) | 0.1194 (0.0738 to 0.1200) | 0.0642 (0.0463 to 0.0652) | 0.1446 (0.1439 to 0.1496) | 0.0482 |
| fast:k6f-late | reinit | 3.8750 | 4.0600 (3.9750 to 4.1000) | 2.7800 (2.6300 to 4.0400) | 2.8400 (2.4350 to 2.8450) | 7.9750 (7.8950 to 7.9750) | 2.3967 |
| fast:k6f-late | pyro | 7.2225 | 5.6450 (5.6400 to 5.6650) | 5.5150 (5.4950 to 5.5250) | 2.4750 (2.1300 to 3.0100) | 3.2000 (3.0150 to 3.2500) | 3.0892 |

## Best TypeScript arm against C# (TypeScript median over C# median; above 1 = C# faster)

C# numbers: BenchmarkDotNet default job, one process per case, from reports/1-air-kernels.json and 1-fast-kernels.json (EARLIER runs on the same container, not run together with these); reinit net of the restore on both sides. Best Node arm = the fastest of the app kernels in one worker and the pool on 1, 2, 4, 8 workers.

| problem | kernel | best Node arm | TS ms | vs C# scalar | vs C# Vector128 | vs C# Parallel x4 | vs C# Parallel x4 + Vector128 | vs best C# form | app kernels in one worker vs C# scalar |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| air:k3std | relax | app | 1.3577 | 1.45 | 1.72 | 1.48 | 1.52 | 1.72 | 1.45 |
| air:k3std | gradient | pool4 | 0.0961 | 0.55 | 0.62 | 0.59 | 0.66 | 0.66 | 1.41 |
| air:k3std | divergenceF32 | pool4 | 0.1124 | 0.65 | 0.84 | 0.92 | 1.12 | 1.12 | 1.51 |
| air:k3std | divergenceF64 | pool2 | 0.1550 | 0.98 | 1.11 | 1.00 | 1.19 | 1.19 | 1.83 |
| air:k3std | advect | pool4 | 0.6448 | 0.39 | 0.44 | 0.71 | 0.87 | 0.87 | 1.14 |
| air:k6high | relax | pool4 | 5.3606 | 1.35 | 1.65 | 1.82 | 1.90 | 1.90 | 1.48 |
| air:k6high | gradient | pool4 | 0.5224 | 0.61 | 0.67 | 1.04 | 1.08 | 1.08 | 1.42 |
| air:k6high | divergenceF32 | pool4 | 0.4939 | 0.60 | 0.80 | 0.97 | 1.19 | 1.19 | 1.57 |
| air:k6high | divergenceF64 | pool4 | 0.7498 | 0.93 | 1.01 | 1.08 | 1.41 | 1.41 | 1.78 |
| air:k6high | advect | pool4 | 3.8935 | 0.53 | 0.61 | 1.10 | 1.23 | 1.23 | 1.24 |
| fast:k6f-900 | evalStage1 | pool2 | 0.0296 | 1.50 | 1.01 | 0.99 | 0.86 | 1.50 | 1.56 |
| fast:k6f-900 | evalStage2 | pool4 | 0.0161 | 1.16 | 0.83 | 1.22 | 0.91 | 1.22 | 1.63 |
| fast:k6f-900 | reinit | app | 0.7852 | 1.50 | 1.69 | 1.17 | 1.17 | 1.69 | 1.50 |
| fast:k6f-900 | pyro | pool4 | 1.6005 | 0.74 | 1.15 | 1.11 | 1.76 | 1.76 | 2.01 |
| fast:k6f-late | evalStage1 | app | 0.1774 | 1.83 | 1.10 | 1.33 | 1.19 | 1.83 | 1.83 |
| fast:k6f-late | evalStage2 | pool4 | 0.0482 | 0.77 | 0.50 | 1.08 | 0.74 | 1.08 | 2.10 |
| fast:k6f-late | reinit | pool4 | 2.3809 | 0.94 | 1.01 | 1.02 | 1.10 | 1.10 | 1.34 |
| fast:k6f-late | pyro | pool4 | 3.0892 | 0.92 | 1.92 | 1.62 | 3.18 | 3.18 | 1.89 |

The same, for Gate 1W: the best Chromium arm (the app kernels in one worker, or the pool) in place of the Node arm.

| problem | kernel | best Chromium arm | TS ms | vs best C# form (native) |
|---|---|---|---:|---:|
| air:k3std | relax | app | 1.6500 | 2.10 |
| air:k3std | gradient | pool4 | 0.1032 | 0.71 |
| air:k3std | divergenceF32 | pool4 | 0.1550 | 1.54 |
| air:k3std | divergenceF64 | pool4 | 0.1455 | 1.11 |
| air:k3std | advect | pool4 | 0.6125 | 0.83 |
| air:k6high | relax | pool4 | 5.3850 | 1.91 |
| air:k6high | gradient | pool4 | 0.5020 | 1.04 |
| air:k6high | divergenceF32 | pool4 | 0.5000 | 1.21 |
| air:k6high | divergenceF64 | pool4 | 0.7262 | 1.36 |
| air:k6high | advect | pool4 | 2.8650 | 0.91 |
| fast:k6f-900 | evalStage1 | pool4 | 0.0263 | 1.33 |
| fast:k6f-900 | evalStage2 | pool4 | 0.0109 | 0.82 |
| fast:k6f-900 | reinit | app | 0.9552 | 2.05 |
| fast:k6f-900 | pyro | pool4 | 2.0400 | 2.25 |
| fast:k6f-late | evalStage1 | pool2 | 0.1606 | 1.66 |
| fast:k6f-late | evalStage2 | pool4 | 0.0642 | 1.44 |
| fast:k6f-late | reinit | pool2 | 2.7478 | 1.27 |
| fast:k6f-late | pyro | pool4 | 2.4750 | 2.55 |

## Projected whole-step effect of the kernels (arithmetic on T1.1's shares; every other phase of the step taken as no faster in every arm)

A kernel's time is taken as a fraction of its time in the app kernels in one worker (this run). New step = 1 - sum of shares + sum of share x fraction. "C# best forms" = the fastest of the four C# forms per kernel (earlier BenchmarkDotNet runs); "best TypeScript" = the fastest Node arm per kernel (app kernels in one worker, or the pool on 1, 2, 4, 8 workers).

| tier | C# scalar over TypeScript one worker | C# best forms over TypeScript one worker | best TypeScript over TypeScript one worker | **C# best forms over best TypeScript** | Gate 1 bar (over the best TypeScript arm) | the kernels' Amdahl ceiling |
|---|---:|---:|---:|---:|---:|---:|
| standard tier (katoomba3-standard, 30x30x20) | 1.100x | 1.210x | 1.139x | **1.062x** | 1.5x | 1.534x |
| fast tier, 30-minute shares, 900 s frame | 1.067x | 1.099x | 1.061x | **1.036x** | 1.2x | 1.167x |
| fast tier, 4-hour shares, 14,100 s frame | 1.156x | 1.231x | 1.128x | **1.091x** | 1.2x | 1.490x |

## Spin-wait sensitivity (pool, Node, medians of one run each, ms per operation)

| problem | workers | spin us | relax | gradient | advect | evalStage2 | reinit | pyro |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| air:k3std | 2 | 0 | 1.7840 | 0.2482 | 1.6550 | - | - | - |
| fast:k6f-late | 2 | 0 | - | - | - | 0.0807 | 4.5351 | 5.7158 |
| air:k3std | 2 | 20 | 2.1416 | 0.2246 | 1.0059 | - | - | - |
| fast:k6f-late | 2 | 20 | - | - | - | 0.0726 | 3.4463 | 5.7450 |
| air:k3std | 2 | 200 | 2.1620 | 0.2235 | 1.5970 | - | - | - |
| fast:k6f-late | 2 | 200 | - | - | - | 0.0712 | 2.3307 | 3.1465 |
| air:k3std | 2 | 2000 | 2.1862 | 0.2267 | 1.6062 | - | - | - |
| fast:k6f-late | 2 | 2000 | - | - | - | 0.1170 | 3.4304 | 5.7156 |
| air:k3std | 4 | 0 | 1.7606 | 0.2003 | 1.0107 | - | - | - |
| fast:k6f-late | 4 | 0 | - | - | - | 0.0883 | 5.5114 | 3.2867 |
| air:k3std | 4 | 20 | 1.2531 | 0.0978 | 0.5229 | - | - | - |
| fast:k6f-late | 4 | 20 | - | - | - | 0.0461 | 2.4138 | 3.0987 |
| air:k3std | 4 | 200 | 1.2103 | 0.1243 | 0.6640 | - | - | - |
| fast:k6f-late | 4 | 200 | - | - | - | 0.0455 | 2.4552 | 2.2813 |
| air:k3std | 4 | 2000 | 1.6529 | 0.0976 | 0.6440 | - | - | - |
| fast:k6f-late | 4 | 2000 | - | - | - | 0.0461 | 2.3961 | 2.2577 |
| fast:k6f-late | 8 | 0 | - | - | - | 0.1851 | - | 3.6182 |
| fast:k6f-late | 8 | 200 | - | - | - | 7.9987 | - | 47.9989 |

Processes: 254 run files; 1-minute load average at the start of a timed process: min 1.02, median 2.02, max 3.45.


## Reading the tables

* **Thread curve (Node).** Relax does not scale in TypeScript either (0.7 to 0.8 of one worker's speed on 2 and 4 workers at the app grid; 1.2 at 6 km): a pass is 45 microseconds of work, the same overhead-bound shape T1.4a found for `Parallel.For`. Everything else scales to about 1.9 on 2 workers (1.0 in the slow mode) and 1.9 to 3.1 on 4 workers; **8 workers on 4 cores are slower than 4** in every cell (the pool does not spin there: with spinning
  the barrier of an 8-worker region took 8 ms, see the spin table), as they must be. `evaluate` stage 1 gains at most 1.3 times from threads (its speed-request pass is serial), `reinit` at 900 s gains nothing and is 0.6 times as fast on 4 workers (its sweeps are serial below 16,384 cells, the chunked row phases only add fork cost) and at 4 h gains 1.5 times from the wavefront.
* **Bimodality.** Many 2- and 4-worker cells have two modes between runs (min to max in the tables): the fast one is about the per-thread work divided by the workers, the slow one is about the one-worker time. The cause was not isolated (untested guesses: the container's 4 vCPUs are shared, load average 1 to 3.5 during the runs, and two threads can land on one vCPU). The tables give the median of three runs and the range; a campaign on a quiet machine (the phone, round 1) is the real test.
* **Chromium pool.** The pool in a cross-origin isolated page reaches the same shape as in Node (evaluate stage 2 at 4 h 0.064 against 0.048 ms; pyrogenic solve 2.5 against 3.1 ms; relax 2.3 against 2.0 ms). The A B B A shows Chromium's single-worker kernels 12 % slower than Node's on median, which carries over to its pool.
* **Spin.** At 4 workers spinning 20 to 2,000 microseconds is 1.1 to 2.3 times faster than not spinning (one run each, noisy); at 8 workers on 4 cores 200 microseconds of spin made an `evaluate` stage 2 take 8.0 ms and a pyrogenic solve 48 ms, against 0.19 and 3.6 ms without spinning. A browser or a phone with more workers than big cores must not spin.

## Findings for the plan and the next cards

1. **Plan 10.2/10.3 (engine floor) shows up in a kernel, and T1.5's done-when cannot hold for the pyrogenic solve in Chromium** (item 1 of the answer). T1.6b and T1.7 must hash C# against Node's golden and compare Chromium's TypeScript only with Chromium's own hashes (the `digest` in the JSON), or `psi` will "differ". The float32 outputs `up` and `vp` are equal.
2. **Gate 1's "best TypeScript arm (one worker, or several where shared memory exists)" is a real, strong opponent**: the pool on 4 workers beats one TypeScript thread by about 1.8 to 3 times on gradient, divergence, advect, evaluate stage 2 (at 4 h) and the pyrogenic solve, and the best C# form over the best TypeScript arm is 1.04x to 1.09x over the kernels' shares of a step (section above): T1.4a and T1.4b's "1.20x and 1.22x against one thread" are the wrong denominators for Gate 1.
3. **Gate 1W's denominator is per engine**: Chromium's kernels are 12 % slower than Node's on median (up to 22 % for `relax`), so using T1.5d's whole-solver equality (Chromium = Node) to stand for the kernel baseline would hide 12 % of the 25 % allowed. Use the Chromium columns of this report (`abba-chromium-app`), or T1.6b's own A B B A.
4. **`Atomics.wait` pools must not spin when workers outnumber cores** (above): any browser build with threads (`WasmEnableThreads`, T1.6b's experimental arm) shares this hazard.
5. The pool's startup race (a late helper missing the first region) is a general hazard of "spawn once, then serve" designs; the fix is to start from the generation at set-up. Recorded here because T1.6b's threaded Mono arm will have the same shape.
6. **The orchestrator's worktree for this card was created from the 0.8.0 release commit, which has no `prototypes/dotnet-b/`**; the builder merged `develop` into its own branch first (a merge commit on the builder branch, nothing on `develop`).

## Not run

The phone and Android WebView (round 1); Firefox and Safari; Chromium with the page *not* isolated for the pool (it cannot run without `SharedArrayBuffer`; the runner has `--isolation off` for the one-worker arm, which was not timed); whole-step timing of the pool forms (kernels only); the C# numbers were not re-measured (earlier runs on this container: `1-air-kernels.json`, `1-fast-kernels.json`); 16 workers; spin tuning beyond one noisy study; a
quiet-machine run (the container was shared throughout).

## Reproduce

See `Fs.Bench/ts/arms/README.md`. In short: `air/regen.sh` and `fast/regen.sh` into `$S/air` and `$S/fast`; `run-arms.sh build`; `flock /tmp/firesim-heavy.lock bash run-arms.sh verify $S $S/res`; `measure.sh $S $S/res` (one lock per step); `make-report.mjs $S/res reports/1-ts-arms.json COMMIT $S/res/conditions.log`
(its `tables.md` is the source of the tables above). `harness/engine-sin-check.mjs` reproduces the `Math.sin` difference. Skills used: none of the dotnet skills (the card is TypeScript).
