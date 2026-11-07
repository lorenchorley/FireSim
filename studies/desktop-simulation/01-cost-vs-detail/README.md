# Study 01: cost against detail (headless Node)

**Question.** How do wall time and memory of the simulation grow with the fire cell size, the solver step, the ember count and the air tier, on
the bundled demo sites, and which phase of a step takes the time? Does the same seed give a byte-identical result? It is first step 1 of
[the topic page](../README.md) and the experiment that
[adaptive-simulation-quality](../../adaptive-simulation-quality/README.md) (question 2) and [simulation-validity](../../simulation-validity/README.md)
(idea 4) also want, so the run summaries they need are saved here.

**Status.** Done on 2026-11-07, 55 rows, none failed, none stopped by the wall-time guard. The findings, the main table and the caveats are in the
topic page, section *Measured: how cost grows with detail (Node, 2026-11)*. This page is the method, the files and how to re-run.

**Source and licence.** No external input. The terrain, vegetation, canopy and fire history are the files bundled in `public/demo/` (their sources and
licences are in `public/demo/provenance.json`, they are not copied here). What is committed is output of the simulation (timings, sizes, hashes,
coarse burnt-area rasters), made with the repository's own code at commit `4dc5882`. No third-party pictures.

## Method

- **Runner.** `scripts/launch.mjs` starts the repository's own Vite in server mode and loads `scripts/row.ts` with `ssrLoadModule`, so `src/` is
  imported exactly as it is (no new dependency, nothing under `src/` changed or importing from here). One row is one Node process
  (`--expose-gc`), so memory is not shared between rows. `scripts/run-batch.mjs` runs a list of rows one after the other, each under
  `flock /tmp/firesim-heavy.lock`, and writes one JSON file per row.
- **Scenario.** `demoScenario` of `src/sim/testing/scenarios.ts` (the production scenario builder with the bundled data, offline), preset
  `hot-nw-sw-change` from 14:00 (Sydney time) on 20 December 2025, which is the V20 scenario of `src/sim/validation/system.test.ts`. The preset's
  south-westerly change is at 15:00 local solar time, which is 2 h into the run. Katoomba: a point ignition of 60 m radius at (-2170, 900) m, 6 km
  or 9 km extent, 4 h window (the rows that ran 2 h say so). Warrumbungles: the same preset and start, ignition at (-1500, 1000) m, 6 km, 2 h.
  Seed 1. Embers on with the tier's default cap (2000 fast, 4000 for the 3-D tiers) unless the row says otherwise. The same ignition, weather and
  seed are used in every row of a site, so rows differ only in the knob named by the row id (`scripts/make-specs.mjs` lists all of them).
- **Knobs and how each was reached without changing `src/`.**
  - Fire cell: 30 m is the default; 20 m is the High-detail cell and the builder allows it only up to 6 km (`builtFireCell`,
    `src/scenario/params.ts`). For 10 m, and for 20 m at 9 km, `launch.mjs` patches two constants of `params.ts` in memory while Vite loads it
    (`highDetailCellM` to the row's cell, `highDetailMaxExtentM` to 12 000 m). 10 m is the finest that exists: the bundled DEM is a 10 m grid
    (resampled from 5 m post spacing), and `blockFactor` in `src/scenario/terrain.ts` throws unless the fire cell is a whole multiple of the DEM
    cell. **15 m is therefore not reachable as is.** The 15 m rows (`L15`, `LN15`) also patch `hiResCellM` to 5, so the builder resamples the
    bundled 10 m terrain onto a 5 m grid and block-averages 3 x 3: their cells, the sub-cell slope statistics and the terrain of the air are from a
    different grid than the other rows, and the rows are labelled "5 m DEM grid". Nothing finer than 10 m was tried (it would be interpolated
    data).
  - Solver step: `SimOptions.maxStepS` (5 s and 2 s against the automatic 10 s of the fast tier).
  - Display step: `SimOptions.snapshotInterval` (10 s against 60 s), and a run with no snapshot receiver at all.
  - Embers: `SimOptions.maxEmbers` (2000 default, 8000, 32 000; the code accepts them, no hard cap was met) and embers off.
  - Air tier: `Simulation` option `tier`. The builder turns the High tier into 20 m cells, so the High-tier air at 30 m cells is built as a
    Standard scenario with the High air options set by hand (60 x 60 x 24 cells of 100 m, as `resolveOptions` does for High); `A-high20` and
    `A-high10` are built as High. Air alone = a run with no ignition.
- **Timing.** `performance.now()` around `sim.advance(...)` only (chunks of 300 s of simulated time, which never changes a result), plus
  `new Simulation`, `spinUp` and one final `snapshot()` timed separately. The scenario build is not timed. Memory samples, hashes and
  summaries are taken between the chunks and are not in the times. The per-phase times are the laps the simulation keeps itself
  (`sim.perf().modules`, the `PerfStats` laps of `Simulation.stepOnce`); `airAt` is a lap nested inside `surfaceWind` and is left out of totals,
  as `src/sim/perfStats.ts` does. The sum of the laps is within 60 ms (0.15 %) of the wall time of every row.
- **Snapshots.** Rows with `hook: 'last'` give the simulation a receiver that keeps only the stats, so the real `makeSnapshot` cost (every 60 s of
  simulated time, as in the app) is in the times, and the copy to the main thread is not. The app also coalesces snapshots to about 25 a second;
  here none are skipped.
- **Memory.** `process.memoryUsage()` and `process.resourceUsage().maxRSS` (the OS high-water mark of the whole process) and, after a forced
  gc, the V8 heap and ArrayBuffers; `Simulation.memoryReport()` (typed arrays the simulation holds, by part); `typedArrayFootprint` of one
  snapshot. The RSS baseline of an empty row (Node, Vite and the loaded modules) is about 340 MB and is in every peak. The history rows
  (`H-*`) push the snapshots between the chunks into the app's own `SnapshotStore` (`src/ui/snapshotStore.ts`, its class default of 150 MiB) and read
  what it keeps.
- **Phases and profile.** Laps as above. Three V8 CPU profiles of the advance loop (inspector, 1 ms sampling; `P-fast30`, `P-fast10`, `P-std30`),
  summarised by file and by function in `results/profile-*.json` (the raw `.cpuprofile` files are large and not kept). The profiler slows a row
  (`P-fast30` took 5.5 s per simulated hour against 5.3 for `L30`), so profiled rows are not timing rows.
- **Determinism.** The V18 method: `snapshotHash` of `src/sim/testing/hash.ts` (FNV-1a over the bytes of every typed array and the JSON of the rest,
  `engine` and the wall-clock stat left out) of every 60 s snapshot, compared between rows.
- **Convergence summaries.** From the final arrival-time raster of a row (arrival times never change once set): burnt area and the length of the
  0.5 contour of the burnt mask (marching squares) every 600 s, the app's own `perimeterKm` and head rate of spread at the same times, the
  head rate every 60 s, and a coarse raster on a common 60 m grid (each fine cell belongs to the block of its centre; per block the burnt share and
  the mean arrival time). `scripts/analyze.mjs` compares every pair of rows on that grid.

## Reproduce

From the repository root, on a machine with the repository's `node_modules`:

```
node studies/desktop-simulation/01-cost-vs-detail/scripts/make-specs.mjs > specs.json
setsid nohup node studies/desktop-simulation/01-cost-vs-detail/scripts/run-batch.mjs specs.json OUT_DIR OUT_DIR/log.txt &   # about 1 hour of one core
node studies/desktop-simulation/01-cost-vs-detail/scripts/analyze.mjs OUT_DIR studies/desktop-simulation/01-cost-vs-detail
node studies/desktop-simulation/01-cost-vs-detail/scripts/make-tables.mjs studies/desktop-simulation/01-cost-vs-detail > results/tables.md
node studies/desktop-simulation/01-cost-vs-detail/scripts/profile-summary.mjs OUT_DIR/P-fast30.cpuprofile > results/profile-P-fast30.json
```

Without the lock (`flock`) use `node --expose-gc scripts/launch.mjs row.spec.json row.json` for one row. Rows run in the order of `specs.json`; a row whose
output file exists is skipped, so an interrupted batch can be started again.

## Files

| Path | What |
|---|---|
| `scripts/launch.mjs`, `scripts/row.ts`, `scripts/run-batch.mjs` | one row in its own process; the row itself; the batch |
| `scripts/make-specs.mjs`, `scripts/specs.json` | the row matrix (55 rows) |
| `scripts/analyze.mjs`, `scripts/make-tables.mjs`, `scripts/profile-summary.mjs`, `scripts/peek.mjs` | analysis, markdown tables, profile summary, one line per row |
| `data/rows.csv` | one line per row: the numbers of the tables and more (steps, memory, hashes, load average, CPU time over wall time) |
| `data/rows.json.gz` | every row in full: timings per phase, memory samples every 300 s, stats every 600 s, snapshot sizes by part, memory report, engine info, hashes |
| `data/convergence.json.gz` | the summaries saved for adaptive quality and validity: per row areas, perimeters, head rates and the coarse 60 m rasters (burnt share and mean arrival time, base64 packed, decoding is in the file's `note`) for the cell-size ladders (embers on and off, Katoomba and Warrumbungles) and the solver-step rows |
| `data/convergence-diff.json` | the same without the rasters, plus the pairwise differences: area ratio, perimeter ratio, agreement of burnt 60 m blocks, arrival-time error percentiles |
| `results/tables.md`, `results/rows-table.md`, `results/tables.json` | the tables of the topic page, one line per row, all derived numbers |
| `results/profile-P-fast30.json`, `results/profile-P-fast10.json`, `results/profile-P-std30.json` | CPU profile summaries |
| `requirements.txt` | Node and Vite versions |

## Limits

- One machine: a 4 vCPU virtual machine (Intel Xeon at 2.1 GHz, 16 GB, Linux 6.18, Node 22.22.0), shared with other jobs. The 1-minute load average at
  the start of a row was 0.8 to 4.3. Other jobs ran on the other cores at times (builds, type checks, a browser), which shows as noise in memory
  bandwidth and caches more than as lost time (the CPU time of the process over its wall time was 0.97 to 1.08 for 3-D rows). No phone, no other
  CPU, no other engine, no browser was measured. One thread: the simulation runs on the main thread; the fast rows show 1.0 to 1.4 for CPU time
  over wall time, which is V8's compiler and garbage collector threads, not the simulation.
- One scenario per site: a hot, windy day, a wind change two hours in, and a fire that grows to 2000 to 3000 ha of the 3600 ha of the 6 km domain
  in 4 h, so late hours are bounded by the domain edge. The head rate of spread sits at the 6 m/s cap of `SPREAD_PARAMS.levelSet.rosMaxMs` for part of
  the run, which fixes the level-set sub-step at its smallest; a calmer day takes fewer sub-steps. Costs per hour move with the fire's size
  (`results/tables.md`, last table).
- One random realisation per row. The simulation is deterministic, but a change of the ember cap, the cell size or the step changes the random draws,
  so differences between rows that include embers mix numerics and chance. The rows without embers (`LN*`, `NT-*`, `WN*`) separate them.
- The 15 m rows use a different DEM grid (above). The 15 m figures belong in the ladder for cost, but their burnt areas are not strictly the same experiment.
- The numbers are those of this code on this day (commit `4dc5882`); the cost of a phase changes whenever the code does.
