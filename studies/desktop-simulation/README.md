# Desktop simulation

A topic with **one measurement study so far** and nothing built. **Question:** can there be a desktop version that runs more detailed simulations than a phone can?

**Status:** a stretch goal in no release ([plan](../../docs/plans/air-slice-wind-detail-honest-speed.md) section 15e, decision D32).
**Recorded with a low-detail desk note (2026-10-31). The first measurement step (cost against detail, headless in Node) was run on 2026-11-07 and is in the section
*Measured: how cost grows with detail (Node, 2026-11)* below; nothing has been built.** The desk note comes from reading the repository
and from a few web searches (search summaries only; the pages were not read in full, so figures are indicative). One study: [01-cost-vs-detail](01-cost-vs-detail/README.md).

## Why it matters

- A phone sets how detailed the simulation can be: 30 m fire cells (200 x 200 at Katoomba 6 km), a 10 m grid for the view and the air, the fast
  tier or the 3-D air (one phone measured 41 ms a 3-D step), and a history budget that thins keyframes.
- A computer could run finer cells (20 m, 10 m), smaller steps, more embers, the richest 3-D air, bigger domains, longer runs, and many runs at once.
- It is where the references of the other stretch goals would be made: the reference run and convergence ladder of
  [simulation-validity](../simulation-validity/README.md) (idea 4) and the experiment of
  [adaptive-simulation-quality](../adaptive-simulation-quality/README.md) (question 2) are the same experiment as the first step here.

## What the repository has today

- The simulation is TypeScript in a Web Worker, and the same `Simulation` runs headless in Node (the validation suite and benchmarks do), so the
  code is not tied to the phone. The app runs in a desktop browser and as a PWA, and the controls have a mouse mapping.
- It is deterministic (V18): the same scenario and seed give the same result.
- It runs on one thread. README figures, one desktop core: the fast tier about 900 s of fire per second, the 3-D tier about 220.
- Measured on 2026-11-07 (section *Measured* below): nine times the cells (10 m against 30 m) cost 8.9 times the time (12 times with embers off), the low end of the first guess of
  one to two orders of magnitude, because the outer step does not shrink with the cell (only the fire's level-set sub-steps do, by 3 times). 10 m is the finest cell the code
  reaches: the bundled terrain is a 10 m grid and the builder needs a fire cell that is a whole multiple of it.
- `public/replays/` holds files for the bundled replay presets; whether a precomputed result could be stored and played back in that form is
  unchecked.

## Options, roughly cheapest first (none tried)

| # | Option | For | Against |
|---|---|---|---|
| 1 | The same web app in a desktop browser with a "Desktop" detail setting | cheapest; no install; one code base | still one thread: the limit is one core |
| 2 | A desktop shell around the same app: **Electron** (ships Chromium and Node) or **Tauri** (OS web view, Rust back end) | Electron: consistent rendering, Node worker threads, file access. Tauri: small installers (a few MB against roughly 80 to 150 MB) and less memory; a Rust back end could host a native solver | Electron is large; Tauri's rendering can differ between systems, which matters for a WebGL-heavy app. Figures are from blogs. Licences unchecked |
| 3 | Several workers sharing memory (SharedArrayBuffer needs a cross-origin-isolated page) or Node worker threads | uses all cores; keeps TypeScript | determinism: parallel sums can change the last bits; the grid and the air must be split by region |
| 4 | WebAssembly with threads and SIMD for the hot loops, the 3-D air first | big speed-ups for the stencil | shared-memory support is uneven by browser; needs a single-thread fallback; SIMD support not established by my search |
| 5 | GPU compute (WebGPU) | natural for the 3-D air stencil, maybe the fire front; reported broadly available on desktop Chrome and Safari 26, weaker on Firefox for Linux | the largest rewrite; float32 results are not guaranteed identical across GPUs |
| 6 | A native solver (Rust or C++) behind a desktop shell or as a batch tool | fastest | most effort; two code bases can drift, so it needs golden scenarios and a cross-engine comparison (validity idea 19) |
| 7 | Remote compute (a server runs the big simulation) | no local limit | needs a network, conflicts with the offline rule; not recommended |

**An idea that may cost less than a full desktop app:** the desktop (or a batch tool) makes a detailed run and exports it, and the phone only plays
the results back. Playback needs no solver, so the phone no longer sets the detail. What a result file would hold, and how large it is, is unchecked.

## Questions to settle before any build

1. **Who is it for?** Instructors preparing scenarios, analysts, or the developers' reference runs. That decides live view versus batch plus a result file.
2. **Which detail matters?** Finer cells, longer runs, a larger domain, richer air, or many runs; each costs differently.
3. **Honesty.** Results change with detail (D23), so the app must say which detail a result came from and not present a phone result and a desktop
   result as the same thing (plan rule 4).
4. **One code base or two?** The cheaper options keep one; a native solver does not.
5. **How do the phone and the desktop exchange scenarios and results?**

## First steps if it is investigated (not now)

1. Measure time and memory against cell size, step size, ember count and tier on the bundled sites, headless in Node (shared with the two other topics). **Done 2026-11-07:** see *Measured* below.
2. Pick the user and the output (live, or batch plus a result file).
3. A small spike of option 2 or 3 and a measured speed-up over one core.
4. Choose between WebAssembly, WebGPU and native only on those numbers.

## Measured: how cost grows with detail (Node, 2026-11)

First step 1 of the list above, run on 2026-11-07. It is study [01-cost-vs-detail](01-cost-vs-detail/README.md) (method, scripts, raw data, how to re-run;
the full tables are in `01-cost-vs-detail/results/tables.md`, every row in `data/rows.csv`). Nothing in `src/` was changed: the scripts import it as it is.
It is also the experiment that [adaptive-simulation-quality](../adaptive-simulation-quality/README.md) (question 2) and
[simulation-validity](../simulation-validity/README.md) (idea 4) want, and the summaries they need are saved (section *Saved for adaptive quality and validity*).

**What was run.** 55 rows, each in its own Node process running the real `Simulation` (the code the worker runs) headless, on the bundled terrain, vegetation and
fire history through the production scenario builder, offline. One thread, one machine: a 4-core virtual machine (Intel Xeon at 2.1 GHz, 16 GB, Node 22.22)
shared with other jobs. One fixed scenario per site, so rows differ only in the knob named in the first columns:
- **Katoomba**, 6 km (and 9 km): the "hot NW wind ahead of a SW change" preset from 14:00 on 20 December 2025 (the V20 scenario), a point ignition of 60 m radius at
  (-2170, 900) m, seed 1. The south-westerly change comes about 2 h into the run. **Window 4 h**, except where the table says 2 h.
- **Warrumbungles**, 6 km (grass woodland, a second site): the same preset and start, ignition at (-1500, 1000) m, window 2 h.
- Embers on with the tier's default cap (2000 fast, 4000 for the 3-D tiers) unless the row says otherwise; display step 60 s as in the app, so a snapshot is built
  every simulated minute (the copy to the main thread is not in the time).

Wall time is the clock around `advance` only. "Sim s per wall s" is simulated seconds per wall second. The cost per hour grows as the fire grows (Katoomba 30 m: 3.4, 4.6, 6.6
and 6.6 s in hours 1 to 4; 10 m: 25, 40, 62 and 60 s), so compare rows with the same window. Peak RSS is the OS high-water mark of the whole process and includes about 340 MB
of Node, Vite and the loaded code.

| varied | row | site, extent | fire cell | air tier | ember cap | window | fire cells | wall s per sim hour | sim s per wall s | outer steps per hour | fire sub-steps per hour | peak RSS MB | one snapshot MB | burnt ha at the end |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fire cell, 6 km | L30 | katoomba 6 km | 30 m | fast | 2000 | 4 h | 40,000 | 5.3 | 679 | 360 | 1775 | 526.1 | 2.28 | 2483 |
|  | L20 | katoomba 6 km | 20 m | fast | 2000 | 4 h | 90,000 | 11.7 | 308 | 360 | 2814 | 643.9 | 4.43 | 2964 |
|  | L15 | katoomba 6 km | 15 m (5 m DEM grid) | fast | 2000 | 4 h | 160,000 | 17.7 | 203 | 360 | 3513 | 799.4 | 7.45 | 2716 |
|  | L10 | katoomba 6 km | 10 m | fast | 2000 | 4 h | 360,000 | 47.0 | 77 | 360 | 5271 | 1234.5 | 16.04 | 2738 |
| fire cell, 6 km, embers off | LN30 | katoomba 6 km | 30 m | fast | off | 4 h | 40,000 | 3.1 | 1146 | 360 | 1765 | 500.5 | 2.27 | 1002 |
|  | LN20 | katoomba 6 km | 20 m | fast | off | 4 h | 90,000 | 8.4 | 428 | 360 | 2814 | 632 | 4.42 | 1881 |
|  | LN15 | katoomba 6 km | 15 m (5 m DEM grid) | fast | off | 4 h | 160,000 | 14.1 | 255 | 360 | 3513 | 774.3 | 7.43 | 1860 |
|  | LN10 | katoomba 6 km | 10 m | fast | off | 4 h | 360,000 | 37.8 | 95 | 360 | 5272 | 1158.6 | 16.03 | 1520 |
| fire cell, 9 km | X30 | katoomba 9 km | 30 m | fast | 2000 | 4 h | 90,000 | 8.1 | 446 | 360 | 1768 | 637 | 4.48 | 4083 |
|  | X20 | katoomba 9 km | 20 m | fast | 2000 | 4 h | 202,500 | 20.3 | 177 | 360 | 2819 | 859 | 9.32 | 5251 |
|  | X10 | katoomba 9 km | 10 m | fast | 2000 | 2 h | 810,000 | 64.9 | 55 | 360 | 5247 | 1931.5 | 38.70 | 977 |
| fire cell, other site | W30 | warrumbungles 6 km | 30 m | fast | 2000 | 2 h | 40,000 | 4.2 | 851 | 360 | 1256 | 473.9 | 2.45 | 1811 |
|  | W20 | warrumbungles 6 km | 20 m | fast | 2000 | 2 h | 90,000 | 8.5 | 422 | 360 | 1868 | 586 | 4.80 | 1822 |
|  | W10 | warrumbungles 6 km | 10 m | fast | 2000 | 2 h | 360,000 | 31.9 | 113 | 360 | 3470 | 1117.9 | 17.49 | 1851 |
| air tier, no fire | AA-fast | katoomba 6 km | 30 m | fast, no fire | 2000 | 2 h | 40,000 | 1.2 | 3103 | 360 | 0 | 469.7 | 2.27 | 0 |
|  | AA-std | katoomba 6 km | 30 m | standard, no fire | 4000 | 2 h | 40,000 | 10.1 | 355 | 357 | 0 | 495.3 | 2.59 | 0 |
|  | AA-high | katoomba 6 km | 30 m | high, no fire | 4000 | 2 h | 40,000 | 29.8 | 121 | 420 | 0 | 532.1 | 3.53 | 0 |
| air tier, with fire | A-std30 | katoomba 6 km | 30 m | standard | 4000 | 4 h | 40,000 | 20.8 | 173 | 437 | 1927 | 554.1 | 2.62 | 3005 |
|  | A-high30 | katoomba 6 km | 30 m | high | 4000 | 4 h | 40,000 | 48.2 | 75 | 581 | 2020 | 600.4 | 3.55 | 2839 |
|  | X-std30 | katoomba 9 km | 30 m | standard | 4000 | 4 h | 90,000 | 20.9 | 172 | 365 | 1828 | 669.7 | 4.83 | 4596 |
|  | W-std30 | warrumbungles 6 km | 30 m | standard | 4000 | 2 h | 40,000 | 22.5 | 160 | 435 | 1259 | 501.3 | 2.80 | 2005 |
| 3-D air with finer cells | A-std20 | katoomba 6 km | 20 m | standard | 4000 | 4 h | 90,000 | 27.5 | 131 | 443 | 2856 | 667.6 | 4.76 | 3056 |
|  | A-high20 | katoomba 6 km | 20 m | high | 4000 | 4 h | 90,000 | 53.2 | 68 | 572 | 2647 | 702.5 | 5.71 | 2890 |
|  | A-std10 | katoomba 6 km | 10 m | standard | 4000 | 2 h | 360,000 | 57.7 | 62 | 444 | 5269 | 1183.8 | 17.85 | 1380 |
|  | A-high10 | katoomba 6 km | 10 m | high | 4000 | 2 h | 360,000 | 87.1 | 41 | 603 | 5307 | 1223.3 | 18.77 | 1191 |
| embers | E-off | katoomba 6 km | 30 m | fast | off | 4 h | 40,000 | 3.6 | 1010 | 360 | 1765 | 502.3 | 2.27 | 1002 |
|  | E-8000 | katoomba 6 km | 30 m | fast | 8000 | 4 h | 40,000 | 5.8 | 616 | 360 | 1765 | 521.9 | 2.31 | 2032 |
|  | E-32000 | katoomba 6 km | 30 m | fast | 32000 | 4 h | 40,000 | 8.5 | 422 | 360 | 1773 | 546.7 | 2.29 | 2933 |
| solver step | T-step5 | katoomba 6 km | 30 m | fast | 2000 | 4 h | 40,000 | 6.7 | 537 | 720 | 2119 | 528.4 | 2.28 | 2874 |
|  | T-step2 | katoomba 6 km | 30 m | fast | 2000 | 4 h | 40,000 | 10.8 | 333 | 1800 | 1800 | 538.3 | 2.28 | 2838 |
| solver step, embers off | NT-step5 | katoomba 6 km | 30 m | fast | off | 4 h | 40,000 | 5.2 | 692 | 720 | 2119 | 496.2 | 2.27 | 1001 |
|  | NT-step2 | katoomba 6 km | 30 m | fast | off | 4 h | 40,000 | 6.8 | 532 | 1800 | 1800 | 495.2 | 2.27 | 1001 |
| display step | N-nosnap | katoomba 6 km | 30 m | fast | 2000 | 4 h | 40,000 | 4.8 | 753 | 360 | 1775 | 527.3 | 2.28 | 2483 |
|  | N-display10 | katoomba 6 km | 30 m | fast | 2000 | 4 h | 40,000 | 6.1 | 587 | 360 | 1775 | 526.9 | 2.28 | 2483 |

**Fire cells: how the growth fits.** Over the 30, 20, 15 and 10 m rows at Katoomba 6 km, wall time per simulated hour follows the number of cells to the power
**0.98** (R^2 0.99; 0.99 over 30, 20 and 10 m alone). A 10 m run has **9 times the cells** of a 30 m run (360 000 against 40 000 at 6 km; 810 000 at 9 km), the **same 360 outer steps an hour**
(the fast tier's step is fixed at 10 s whatever the cell), **2.97 times the level-set sub-steps** (5271 against 1775 an hour) and **8.9 times the time**
(47.0 against 5.3 s per simulated hour; 12 times with embers off). Peak RSS rises from 526 to 1235 MB; one snapshot from 2.3 to 16.0 MB. Other fits against cells:
sub-steps 0.49 (that is, proportional to 1 over the cell size), one snapshot 0.89, peak RSS above the baseline 0.71; the typed arrays the simulation holds (`memoryReport`) are about
88 MB plus 1.6 kB a cell (the line through 30 m and 10 m at 6 km predicts 1.40 GB for 10 m at 9 km; measured 1.34 GB).

**The step.** The outer step (fire, air and embers together) is 10 s in the fast tier (`maxStableDt`), at most 12 s in the 3-D tiers (the air's own stability bound, which was tighter with the fire than without: 437 against 357 steps an hour in Standard), and is cut at every 60 s mark and display-step mark; `maxStepS` and the display step can only make it smaller. The fire then takes level-set sub-steps inside it:
`Δt = 0.9 / max over the band of R((|nx| + 0.4)/Δx + (|ny| + 0.4)/Δy)` (`levelSet.ts`; the band is 8 cells wide, the prepared cells 4). In this scenario the largest band speed is at the 6 m/s cap
(`rosMaxMs`), which gives 0.068 Δx seconds: 2.0 s at 30 m (the engine reports 2.03 s), 0.68 s at 10 m. That is 4.9 sub-steps per outer step at 30 m and 14.6 at 10 m, and it is exactly what was counted
(1775 and 5271 an hour). Warrumbungles needs fewer (1256 at 30 m, a mean sub-step of 2.9 s: its fastest band cell is below the cap on average). The cell size sets the sub-step; the step limit changes it only when it falls below that bound (5 s: 2119 an hour; 2 s: 1800, one sub-step per outer step).
The rates of the cells next to the front are computed once per outer step, not per sub-step. Measured effect of the step limit (30 m, embers on): 5 s costs 1.27 times the wall time (720 outer steps an hour), 2 s costs 2.04 times (1800), and 1.7 and 2.2 times with embers off; **with embers off the burnt area
is the same to 0.1 % at 10, 5 and 2 s** (1002, 1001 and 1001 ha; 98 to 99 % of the 60 m blocks agree; arrival times differ by under a minute at the median), so the 10 s step is already converged for the front
in this scenario and a smaller one only costs time. A snapshot every simulated minute costs about 10 % of a fast 30 m run (no snapshot receiver: 4.8 against 5.3 s an hour); every 10 s costs 16 % more.

**Embers.** Cap 2000, 8000 and 32 000 (the code accepts them) cost 1.00, 1.10 and 1.61 times the time (the ember phase: 0.68, 1.73 and 3.83 s an hour); embers off 0.67 times. The burnt area at 4 h moved far more than the
cost: **1002 ha off, 2483 ha at 2000, 2032 ha at 8000, 2933 ha at 32 000** (3, 27, 19 and 35 spot fires). A cap changes the number of weighted super-particles and the random draws, so each row is one chance
outcome: a single run cannot say which way the result converges with more embers; that needs several seeds (validity idea 5).

**Air tiers.** The fast tier has no time-stepped air: its air work is a diagnostic wind solve per weather stamp (0.25 to 0.4 s an hour; air alone 1.2 s an hour, 3100 times real time). A Standard step
(45 x 45 x 20 cells of 133 m) took 21.8 ms with no fire and 29 ms with it, and a High step (60 x 60 x 24 cells of 100 m) 63 to 66 ms. The plan quotes 41 ms for one phone; if that is the same quantity, this core is about 1.4 times
faster than that one reading. The 3-D tiers also take 357 to 603 outer steps an hour (the air's step shrinks with the fire) and a spin-up before t0 of 2 s (Standard) or 6 to 8 s (High). Together with the fire
at 30 m: Standard 20.8 s per simulated hour (173 times real time; hour 1 alone took 17.8 s, 202 times, close to the README's "about 220"), High 48.2 s (75 times). The fast tier's hour 1 took 3.4 s (1050 times; the README says about 900). With 10 m cells on top: Standard 57.7 s, High 87.1 s
(41 times real time) over 2 h. The 3-D tiers add almost nothing to memory (peak RSS 554 and 600 MB against 526 MB at 30 m).

**Where the time goes (phases).** The laps below are the ones the simulation keeps itself (`sim.perf()`), summed over the whole 4 h; they add up to the wall time to within 0.15 %.

| phase (lap of `Simulation.stepOnce`) | fast, 30 m (L30) | fast, 10 m (L10) | Standard, 30 m (A-std30) | High, 30 m (A-high30) |
|---|---|---|---|---|
| atmosphere: the 3-D air step | 0.2 % | 0.3 % | 61.5 % | 80.0 % |
| stamps: the hourly wind solve (fast tier) or ambient update | 4.8 % | 0.8 % | 1.7 % | 1.5 % |
| surfaceWind: the air wind onto the fire grid | 2.3 % | 2.0 % | 7.1 % | 4.0 % |
| fireHeat: the fire heat into the air (fast tier: the pyrogenic solve) | 8.4 % | 21.0 % | 0.5 % | 0.3 % |
| firePrepare: rates of the cells next to the front | 15.5 % | 6.5 % | 6.3 % | 3.3 % |
| fireStep: the level-set sub-steps | 37.7 % | 54.0 % | 11.7 % | 5.1 % |
| fireMasks: crest, lee, zones (every 60 s) | 3.0 % | 2.7 % | 0.8 % | 0.3 % |
| fireMinute: junctions, debris (every 60 s) | 2.2 % | 2.0 % | 0.7 % | 0.3 % |
| embers: emission and flight | 12.8 % | 3.0 % | 5.9 % | 3.3 % |
| solarMoisture: sun and fuel moisture (every 600 s) | 1.8 % | 1.5 % | 0.7 % | 0.4 % |
| snapshot: building the picture (every 60 s) | 4.5 % | 3.5 % | 1.2 % | 0.7 % |
| explain: the insight cards (every 60 s) | 5.0 % | 2.1 % | 1.4 % | 0.5 % |
| diagnostics (every 60 s) | 0.7 % | 0.1 % | 0.1 % | 0.1 % |
| checkpoint (every 1800 s) | 0.6 % | 0.4 % | 0.2 % | 0.1 % |
| weatherNight | 0.4 % | 0.1 % | 0.2 % | 0.1 % |
| records | 0.1 % | 0.0 % | 0.0 % | 0.0 % |
| wall seconds per simulated hour | 5.3 | 47.0 | 20.8 | 48.2 |

At 30 m the fast tier has no dominant phase: the fire (prepare, level-set, masks and minute tasks) is 58 %, embers 13 %, the coupling 11 %, pictures and checkpoints 5 %, the air 5 %. At 10 m the fire is 65 % and
the coupling 23 %. A V8 CPU profile of the loop (`results/profile-*.json`) puts names on it: in the fast tier at 30 m the level-set `evaluate` and `reinit` are 14 % and 12 % of the CPU time, cell rates (`computeCell`) 6.5 %,
the pyrogenic solve 6 % and the ember flight 3 %; **at 10 m the pyrogenic solve is 22 % and `reinit` 22 %**, and the pyrogenic solve is the one phase that grows faster than the cells (cells to the power 1.40; the level-set step 1.13;
the cell rates 0.57; embers 0.33). In a Standard run the three air-solver files (the pressure projection `relax`, `gradient` and `divergence` in `solver.ts`; advection and diffusion in `dynamics.ts`; `atmosphere.ts`) are 69 %
of the CPU time: regular stencils over the whole air grid.

What a parallel split could win, by Amdahl's law (an **upper bound** worked out from the shares above: perfect scaling of the named share, no cost for threads or for moving data; nothing was built or timed):

| row | what is made parallel | its share of the time | on 4 cores | on 8 cores | with no cost at all |
|---|---|---|---|---|---|
| fast, 30 m | the fire (prepare, level-set, masks) | 58 % | 1.78x | 2.05x | 2.4x |
| fast, 30 m | air, fire and the coupling between them | 74 % | 2.25x | 2.85x | 3.9x |
| fast, 30 m | all of these and the embers | 87 % | 2.87x | 4.18x | 7.6x |
| fast, 10 m | the fire (prepare, level-set, masks) | 65 % | 1.96x | 2.33x | 2.9x |
| fast, 10 m | air, fire and the coupling between them | 89 % | 3.03x | 4.58x | 9.4x |
| Standard, 30 m | the air (3-D step) | 63 % | 1.90x | 2.23x | 2.7x |
| Standard, 30 m | air, fire and the coupling between them | 90 % | 3.09x | 4.75x | 10.2x |
| High, 30 m | the air (3-D step) | 81 % | 2.57x | 3.48x | 5.4x |
| High, 30 m | air, fire and the coupling between them | 95 % | 3.46x | 5.86x | 19.2x |

**Determinism.** The simulation gives a **byte-identical** result for the same seed: all 240 snapshots of a 4 h fast run (and all 120 of a 2 h Standard run) hashed the same in two separate processes, and the fast run
hashed the same with the run split in 60 s instead of 300 s chunks. A different seed differs from the first snapshot on (the control). This is the V18 method on one machine, one Node build, one CPU: it does **not** show that
another engine, CPU, or a threaded split gives the same bytes (validity idea 19); parallel sums are where it would break.

| comparison | snapshots compared | identical | first difference | final hashes | burnt ha |
|---|---|---|---|---|---|
| fastSameSeedTwoProcesses (D-fast-a vs D-fast-b) | 240 | 240 | none | 988016189 / 988016189 | 2482.83 / 2482.83 |
| fastOtherChunking (D-fast-a vs D-fast-chunk60) | 240 | 240 | none | 988016189 / 988016189 | 2482.83 / 2482.83 |
| fastOtherSeed (D-fast-a vs D-fast-seed2) | 240 | 0 | 60 s | 988016189 / 2483471968 | 2482.83 / 2882.34 |
| standardSameSeedTwoProcesses (D-std-a vs D-std-b) | 120 | 120 | none | 3370674856 / 3370674856 | 1006.38 / 1006.38 |

**Memory.** The V8 heap holds 59 to 68 MB after a gc in every row (about 63 MB); the typed arrays live outside it, so memory is the ArrayBuffers: 152 MB at 30 m, 658 MB at 10 m (6 km), 1320 MB at 10 m (9 km).

| row | fire cells | peak RSS (about 340 MB of it is Node and the loaded code) | typed arrays the simulation holds | checkpoints held | one snapshot | one keyframe |
|---|---|---|---|---|---|---|
| fast, 30 m, 6 km | 40,000 | 526.1 MB | 153 MB | 9 (85 MB) | 2.3 MB | 1.4 MB |
| fast, 20 m, 6 km | 90,000 | 643.9 MB | 212 MB | 3 (73 MB) | 4.4 MB | 2.4 MB |
| fast, 10 m, 6 km | 360,000 | 1234.5 MB | 670 MB | 2 (154 MB) | 16.0 MB | 7.8 MB |
| fast, 30 m, 9 km | 90,000 | 637 MB | 221 MB | 4 (81 MB) | 4.5 MB | 2.4 MB |
| fast, 10 m, 9 km (2 h) | 810,000 | 1931.5 MB | 1340 MB | 2 (207 MB) | 38.7 MB | 20.0 MB |
| Standard, 30 m, 6 km | 40,000 | 554.1 MB | 164 MB | 6 (79 MB) | 2.6 MB | 1.7 MB |
| High, 30 m, 6 km | 40,000 | 600.4 MB | 189 MB | 5 (77 MB) | 3.6 MB | 2.6 MB |
| High, 10 m, 6 km (2 h) | 360,000 | 1223.3 MB | 684 MB | 2 (116 MB) | 18.8 MB | 10.5 MB |

| history of the app after 4 h at a 60 s display step | bytes kept | steps kept | keyframes kept (of 48) | times older history was thinned |
|---|---|---|---|---|
| fast, 30 m | 63 MB | 240 | 48 | 0 |
| Standard, 30 m | 95 MB | 240 | 48 | 0 |
| fast, 20 m | 115 MB | 240 | 48 | 0 |
| fast, 10 m | 117 MB | 240 | 12 | 5 |

The app keeps its history in `SnapshotStore` under a budget; the rows above used the store's own default of 150 MiB. The app's `defaultSnapshotBudget` is 6 % of the reported device memory, between 48 and 160 MiB, and a desktop Chrome reports at most 8 GB,
so a desktop browser gets 160 MiB too. Four hours at 30 m fit (63 MB fast, 95 MB Standard) and at 20 m (115 MB); **at 10 m the budget is reached after about 1 to 1.5 h and the history is thinned five times in 4 h** (12 of 48 keyframes remain).
The worker's checkpoint ring is capped at 80 MB (`checkpointMaxBytes`) and one checkpoint is about 77 MB at 10 m, so it keeps only the newest besides t0 (at 30 m it keeps eight, four hours): a rewind to a time before that checkpoint re-runs from t0.

**Run-to-run spread (the machine's noise).** The cheapest row and the most expensive fast row, three runs each in three separate processes; the load average is the 1-minute figure at the start and end of each row:

| row | wall s per sim hour (3 runs) | mean | standard deviation | range | peak RSS MB (3 runs) | load1 start/end | CPU time over wall time |
|---|---|---|---|---|---|---|---|
| L30 | 5.30, 5.19, 5.48 | 5.32 | 0.15 (2.7 %) | 5.4 % | 526.1, 522.4, 522.8 | 0.9/1.01, 2.71/2.23, 2.13/2.26 | 1.10, 1.12, 1.11 |
| L10 | 47.01, 46.19, 47.39 | 46.86 | 0.61 (1.3 %) | 2.6 % | 1234.5, 1211.4, 1236.5 | 1.46/1.13, 1.34/1.07, 2.6/1.12 | 0.98, 1.01, 1.00 |

So the machine adds about 3 % (range 5 %) to a cheap row and about 1 % (range 3 %) to a long one. A 3-D row can move more when other jobs run: `D-std-a` took 25.0 s an hour at a load average of 2.4 to 3.7 and `D-std-b` 20.8 s (both with
hashing inside the loop); two Standard rows with the same set-up and a quiet machine gave 20.8 and 20.6 s (`A-std30`, `H-std30`). Treat differences under 10 % between rows as noise.

### Saved for adaptive quality and validity

`01-cost-vs-detail/data/convergence.json.gz` (258 kB) and `convergence-diff.json` hold, for the cell-size ladders (30, 20, 15 and 10 m at Katoomba 6 km, 30, 20 and 10 m at Warrumbungles, each with embers on and with embers off) and the solver-step rows:
burnt area and the length of the burnt contour every 10 min, the app's own perimeter and head rate of spread, the head rate every minute, an arrival-time raster on a common 60 m grid (the burnt share and the mean arrival time of each block), and the
differences between rows (area ratio, perimeter ratio, agreement of burnt blocks, arrival-time error percentiles). **This is the numerical-convergence part only: the same model at finer cells, not validation.** What it shows:

- **Katoomba, embers off.** Until the wind change the rows agree (burnt ha at 2 h: 543, 619, 648 and 619 for 30, 20, 15 and 10 m). After the south-westerly change turns the flank into the head they split (at 4 h: 1002, 1881, 1860 and 1520 ha).
  The rows are **not converged between 30 m and 20 m** (area +88 %; of the 60 m blocks burnt in either row, only 54 % were burnt in both), 20 and 15 m agree (area ratio 0.99, Jaccard 0.96; their DEM grids differ), and 10 m sits 19 % below them (Jaccard 0.77 to 0.79):
  the sequence is not monotone, so 10 m is not "the converged answer".
- **Warrumbungles, embers off** (wind-driven run, no change in the window): converged. Area ratio 0.999 to 1.022, 97 % of the blocks burnt in either row burnt in both, and an absolute arrival-time error of at most 5.2 min at the median and 11 min at the 90th percentile between any two of 30, 20 and 10 m. The contour length is not converged: it grows 1.13 times from 30 to 20 m and 1.39 times from 30 to 10 m, because finer cells resolve more of the edge.
- **With embers** (one realisation per row): Katoomba burnt ha at 4 h 2483, 2964, 2716 and 2738 (30, 20, 15, 10 m); the ember draws move the result by tens of per cent (see Embers), so a ladder with embers needs several seeds.

*Katoomba 6 km, embers off, 30 to 10 m:*

| row | cell | burnt ha at 1 h, 2 h, 3 h, 4 h | perimeter km at the same times (contour of the 0/1 mask) | mean head rate of spread m/s, per hour | max band rate m/s, per hour (mean) |
|---|---|---|---|---|---|
| LN30 | 30 m | 156 / 543 / 918 / 1002 | 7.5 / 14.0 / 21.7 / 21.4 | 2.96 / 3.87 / 3.34 / 0.64 | 2.56 / 3.71 / 3.39 / 0.54 |
| LN20 | 20 m | 213 / 619 / 1664 / 1881 | 10.9 / 21.6 / 36.8 / 36.5 | 3.37 / 3.60 / 4.93 / 2.56 | 3.20 / 4.07 / 4.67 / 2.17 |
| LN15 | 15 m | 212 / 648 / 1625 / 1860 | 11.5 / 21.8 / 38.2 / 38.2 | 3.12 / 4.27 / 4.56 / 3.10 | 3.48 / 4.33 / 4.82 / 2.99 |
| LN10 | 10 m | 197 / 619 / 1157 / 1520 | 9.0 / 17.5 / 34.1 / 36.7 | 3.41 / 4.51 / 4.53 / 2.81 | 3.79 / 4.52 / 5.02 / 3.13 |

| pair (A, B) | burnt area B / A at the end | perimeter B / A | Jaccard of burnt 60 m blocks | arrival time B minus A, minutes: median (5th to 95th percentile) | abs arrival error minutes: median, 90th percentile |
|---|---|---|---|---|---|
| LN30 to LN20 | 1.878 | 1.70 | 0.536 | -4.6 (-28.3 to 0.4) | 4.7, 17.1 |
| LN30 to LN15 | 1.857 | 1.79 | 0.543 | -4.9 (-34.0 to 1.0) | 5.2, 22.2 |
| LN30 to LN10 | 1.517 | 1.72 | 0.666 | -4.6 (-38.6 to 2.1) | 4.8, 25.7 |
| LN20 to LN15 | 0.989 | 1.05 | 0.962 | 0.8 (-8.9 to 13.1) | 1.9, 10.6 |
| LN20 to LN10 | 0.808 | 1.01 | 0.771 | 1.9 (-13.3 to 67.0) | 4.2, 50.4 |
| LN15 to LN10 | 0.817 | 0.96 | 0.794 | 1.3 (-6.9 to 64.3) | 2.8, 46.6 |

*Warrumbungles 6 km, embers off, 30 to 10 m:*

| pair (A, B) | burnt area B / A at the end | perimeter B / A | Jaccard of burnt 60 m blocks | arrival time B minus A, minutes: median (5th to 95th percentile) | abs arrival error minutes: median, 90th percentile |
|---|---|---|---|---|---|
| WN30 to WN20 | 0.999 | 1.13 | 0.975 | 0.5 (-4.3 to 3.1) | 1.4, 3.8 |
| WN30 to WN10 | 1.021 | 1.39 | 0.970 | 3.5 (-6.8 to 11.4) | 5.2, 10.8 |
| WN20 to WN10 | 1.022 | 1.23 | 0.968 | 3.3 (-7.3 to 9.7) | 4.6, 9.2 |

*Katoomba 6 km, 30 m cells, embers off: the solver step at 10 s (automatic), 5 s and 2 s (here "to" names the rows compared; `LN30` is the 10 s row):*

| pair (A, B) | burnt area B / A at the end | perimeter B / A | Jaccard of burnt 60 m blocks | arrival time B minus A, minutes: median (5th to 95th percentile) | abs arrival error minutes: median, 90th percentile |
|---|---|---|---|---|---|
| LN30 to NT-step5 | 0.999 | 1.00 | 0.982 | -0.1 (-9.7 to 4.0) | 1.0, 6.7 |
| LN30 to NT-step2 | 0.999 | 1.00 | 0.991 | -0.6 (-4.9 to 5.3) | 2.5, 5.0 |
| NT-step5 to NT-step2 | 1.000 | 0.99 | 0.982 | -0.3 (-4.5 to 8.7) | 2.6, 6.8 |

(B minus A in the arrival-time column: negative means B, the finer or smaller-step row, arrives earlier. Jaccard = blocks burnt in both rows over blocks burnt in either.)

### What this says for the options

1. **A single thread already runs 10 m on a desktop; finer cells alone do not need more cores, they need memory.** The fast tier at 10 m took 3 min for 4 h at 6 km (77 times real time) and 65 s an hour at 9 km (810 000 cells, 55 times).
   The richest combination measured, High air with 10 m cells, ran 41 times real time over 2 h (174 s); a 4 h run would take about 6 to 8 min (estimated: the fast 10 m run took 1.4 times more per hour over 4 h than over its first 2 h). So the batch reference run for adaptive quality and validity is cheap on one core.
   The costs that bite are the history budget (thinned at 10 m), the checkpoint ring (one entry), a snapshot of 16 to 39 MB, and the 1.2 to 1.9 GB of peak RSS; a live view at 10 m, option 1, would need larger budgets than the app allows a desktop today.
2. **Which option fits depends on the tier, and the phase shares say where.** For the 3-D tiers the air is 63 % (Standard) to 82 % (High) of the time and its kernels are regular stencils: that is the case for threads over regions, WebAssembly SIMD or WebGPU (options 3 to 5). Splitting the air alone
   is worth at most 1.9 times (Standard) and 2.6 times (High) on 4 cores, and 2.7 and 5.4 times however fast the air gets, because everything else stays (37 % of the time in Standard, 18 % in High). For the fast tier at 30 m or 10 m there is no single hot spot: the level-set front and the pyrogenic solve are irregular narrow-band
   and whole-grid work, and splitting the fire alone is worth at most 1.8 times (30 m) and 2.0 times (10 m) on 4 cores; it takes splitting the fire, the coupling and the embers together to reach about 2.9 times on 4 cores. Whatever the option, a split has to keep the bytes identical.
3. **Memory and the history set the shape of a desktop result.** A playback file of the history is large at 10 m: one keyframe is 7.8 MB and the app keeps one every 300 s (estimate: about 380 MB for 4 h before compression, which was not measured). The fire itself is cheap to keep, because the fire at any earlier time is rebuilt from the newest arrival times.
4. **Determinism holds today, on one machine, and must be re-checked for any split.** Byte-identical over two processes and two chunkings; what it does not cover is another engine or CPU, or threads.

### Measured and estimated

- **Measured** (one machine, one thread, this code at commit `4dc5882`, one random realisation per row): every number in the tables above; the noise of two rows (three runs each); the hash comparisons; the phase laps and three CPU profiles; the history sizes.
- **Estimated or worked out, not measured:** the Amdahl bounds (arithmetic on the lap shares); the 4 h cost of the two 10 m 3-D rows (2 h measured); the 380 MB playback estimate; anything for cells finer than 10 m. For 5 m cells at 6 km (1.44 million cells) the fits suggest about 2.7 GB of RSS and,
  at cells to the power 1 or more, 3 to 6 min per simulated hour; the bundled terrain is 10 m, so those cells would hold interpolated data.
- **Not done:** no phone, no browser, no other CPU or engine, no thread or WebAssembly or WebGPU build (so no speed-up is claimed), no validation against any real fire, no site other than Katoomba and Warrumbungles, no weather other than the one preset, and no scenario where the 3-D air runs on a 9 km extent with 10 m cells.
- **Caveats.** The 15 m rows need a 5 m DEM grid (10 m is the finest cell the builder reaches as it is: it requires a whole multiple of the 10 m DEM, and 15 m is not one), so the 15 m burnt areas are not strictly the same experiment. The scenario's head rate sits at the 6 m/s cap for part of the run, which fixes the sub-step at its smallest;
  a calmer day takes fewer sub-steps. Late hours at 6 km are bounded by the domain edge. Timings on a shared machine move by about 3 % (cheap rows) and sometimes more for the 3-D rows.

## Sources (search summaries only)

- [Tauri and Electron compared (OpenReplay)](https://blog.openreplay.com/comparing-electron-tauri-desktop-applications/)
- [Tauri 2 and Electron (noqta)](https://noqta.tn/en/blog/tauri-2-desktop-apps-rust-web-technologies-2026)
- [WebGPU compute in the browser, 2026 (CodeRcops)](https://blog.codercops.com/blog/webgpu-browser-gpu-compute-2026)
- [WebGPU browser support](https://abratabia.com/webgpu/browser-support.php)
- [WebAssembly threads (web.dev)](https://web.dev/articles/webassembly-threads?authuser=0)
- [Enabling SharedArrayBuffer with COOP and COEP](https://app.cinevva.com/tutorials/coop-coep-sharedarraybuffer.html)

## Log

| Study | Question | Status |
|---|---|---|
| [01-cost-vs-detail](01-cost-vs-detail/README.md) | How do wall time and memory of the simulation grow with the fire cell size, the step, the ember count and the air tier, where does the time go, and is a run byte-identical? | done 2026-11-07, 55 rows, headless Node, one 4-core machine; the run summaries for adaptive quality and validity are saved |

Rules for adding a study are in [`../README.md`](../README.md).

- 2026-10-31: the owner asked for a desktop version that can run more detailed simulations as a new stretch goal, to be researched in low
  detail and saved in the docs. This page and plan section 15e are that note. Nothing was run.
- 2026-11-07: study 01 (cost against detail) was run on the owner's go-ahead: 55 rows headless in Node on Katoomba (6 and 9 km) and Warrumbungles, fire cells of 30, 20, 15 (5 m terrain grid) and 10 m,
  embers, solver step, display step and the three air tiers, with phase shares, CPU profiles, memory, history sizes, run-to-run noise and a determinism check. Nothing in `src/` was changed. The cell-size ladders also saved the
  convergence summaries that adaptive quality and validity want (numerical convergence only, not validation).
