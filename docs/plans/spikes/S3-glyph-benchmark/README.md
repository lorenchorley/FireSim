# Spike S3: what a glyph rebuild costs

Plan: `docs/plans/air-slice-wind-detail-honest-speed.md`, sections 7.2, 9.3, 9.4, 9.8 and 11, the M0 entry, and the risk row "Glyph cost on a phone is unmeasured". Done 2026-10-13 against HEAD `bb2585a`. One harness, `tests/spikes/glyphBench.spike.test.ts` (1917 lines, gated by `FIRESIM_SPIKE`, no app file changed). The raw output of the run these numbers come from is `results.txt`; "section 06" and so on are its test numbers.

## Question

Workstream E (0.5.0) draws wind arrows and flow lines by tracing short streamlines through the wind field. The plan estimates one rebuild at "<= 8 ms p95 on a phone (<= 32 ms at 4x CPU throttle)", with glyph caps of 600 / 1200 / 2000 by picture-quality tier and at most 12 segments per glyph (9.3, 9.8). That was an estimate. S3 builds the generator in a node benchmark, times 2000 glyphs x 10 segments through the plan's sampler and the other caps, and asks: is 8 ms believable, which sampling design should E use, which cap fits per tier, and what must be staged across frames.

## Verdict

**The 8 ms estimate is not believable for direct sampling at 1200 and 2000 glyphs. It holds for 600 glyphs. A raster design fits every cap.**

- **The plan's own case does not fit.** 2000 glyphs x 10 segments through the plan's sampler (`v2`) took a median of 8.00 ms on this machine and a p95 of 11.2 ms. On the phone estimate (this machine x 2.35) that is **18.8 ms median, 26.3 ms p95**, 2.3 and 3.3 times the 8 ms. Even the fastest single rebuild, 6.88 ms, is 16.1 ms on the phone estimate. Hand-inlining the sampler (`v2p`) saves 15 % and does not change the class (15.9 ms median, 19.1 ms p95).
- **Why.** A rebuild makes two sampler calls per segment (the RK2 start and midpoint): 40,000 calls at about 155 to 170 ns each. The sampler is 86 % of the rebuild; seeding, tracing arithmetic and output together are 14 %. The plan's "well under 1 ms" for 1300 to 2600 samples is right (2600 x 143 ns = 0.37 ms). A rebuild asks for 15 times as many.
- **Where direct sampling fits** (phone p95 within 8 ms, hand-inlined sampler): 600 x 6, 600 x 10 and 1200 x 6. 600 x 12 is at the line (8.2 ms). 1200 x 10 is also at the line (its fastest rebuild is 8.4 ms), and 1200 x 12, 2000 x 6, 2000 x 10 and 2000 x 12 are over.
- **A raster fits every cell.** Tracing through a 2-D raster of (u, v) at the model's column spacing (`r1`, filled once per new snapshot or height change) takes 2.46 ms median and 3.09 ms p95 at 2000 x 10: **5.8 ms median and 7.3 ms p95 on the phone estimate**, with margin (p95 within 5.3 ms) up to 1200 x 12. Building the raster costs 0.28 to 0.54 ms here.
- **A portrait phone needs fewer glyphs than the caps.** The plan's own L3 lattice (about 36 px) puts 276 glyphs inside a 412 x 868 screen and 621 inside the box with a 25 % margin (section 01, arithmetic). So the cap that decides a phone in portrait is about 600, where even direct sampling fits. The 1200 and 2000 caps matter for tablets, landscape, denser lattices and the High tier.
- **The throttle check is too loose.** 32 ms at 4x CPU throttle is 8 ms on this machine, which is 18.8 ms on the phone estimate: 1.70 times looser than the 8 ms phone budget. A throttle of 2.35x, not 4x, matches the one phone data point.
- **The estimate rests on one phone data point** (factor 2.35, from a different kind of code). That uncertainty is larger than any other in this note (Limits).

## Method

**Data from the real engine.** A real `Atmosphere` (`src/atmosphere/atmosphere.ts`), built the way `atmosphere/perf.test.ts` builds it: the bundled 10 m Katoomba DEM cropped and block-averaged to a 30 m fire grid, a 10 m/s wind from 300 degrees at 13:00 local on 15 Oct 2025, surface heating on, 1200 s of model time (the engine's own spin-up is 900 s). Four cases cover the real tier dimensions (section 01):

| Case | Columns | Cell | Levels | Top H' | Relief |
|---|---|---|---|---|---|
| standard 6 km | 45 x 45 | 133 m | 20 | 3000 m | 576 m |
| standard 12 km | 45 x 45 | 267 m | 20 | 3000 m | 739 m |
| high 6 km | 60 x 60 | 100 m | 24 | 3000 m | 578 m |
| high 12 km | 60 x 60 | 200 m | 24 | 3000 m | 738 m |

The fast tier builds its field on the standard grid, so its future diagnosed field has the shape of the standard rows; it was not built separately. The bundled DEM stops at 9 km, so the 12 km cases use it mirror-padded (benchmark only). The render DEM is the same DEM decimated to 400 x 400 with the app's `decimateGrid` and `HeightField`.

**Samplers.**
- `v1`: today's `AtmosphereSampler.wind` on the flat view (u, v, w).
- `v2`: plan 7.2 as written: per column of the four-column stencil `zeta = (zAsl - baseM - h0) / J` with `J = 1 - h0 / topM`, clamp, binary search, linear interpolation, bilinear blend; plan API `wind(x, y, zAsl, out)`.
- `v2p`: the same arithmetic hand-inlined into one method that takes and returns no double (positions go through a scratch `Float64Array`), u and v only.
- `r1`, `r2`: a raster of (u, v) at 100 m above the render DEM at the model's column spacing, or half of it, filled with `v2p`; the tracer does bilinear lookups on it.
- Check (section 02): `v2` agrees with the engine's own `sample()` to 0.00000 m/s at 6000 random points per case, and `v2p` agrees with `v2` to 0.000000 m/s. `v1` differs from the engine by 0.2 to 1.8 m/s at 50 to 100 m above ground, because the flat view holds zeros below the terrain.

**Glyph tracer (plan 9.3).** Seeds on a world lattice with power-of-two spacing, jittered by the integer hash of `render/fields.ts` (no `Math.random`), culled to a view box and thinned by selection sampling to exactly the cap. Length in pixels `clamp(4 x speed, 8, 56)` times the metres per pixel at the seed. RK2 midpoint, arc-length parameterised; a dot under 0.3 m/s; stop at the domain edge; a near-plane test per vertex; output in the `StreakBatch` layout in preallocated `Float32Array`s (colour from a 64-entry table), including the halo copy. Checks on analytic fields (section 03): uniform wind gives straight glyphs (deviation 0.000002 m); solid-body rotation recovers the radius to 0.0001 % (plan: 1 %); calm gives dots; a seed at the edge stops; two runs give identical bytes.

**One rebuild** is seeds, tracing and output for every glyph in one view box: a phone in portrait (412 x 868 px), top-down camera, the box 25 % larger than the screen on every side, one model cell 40 px wide, glyphs 100 m above the render DEM unless stated; 16 different view boxes are cycled. Not included: the GPU upload, drawing, the LOD planner, the 250 ms cross-fade and the visible-region maths.

**Timing.** The variants of a table are timed round-robin in one block (one rebuild of each in turn, the starting variant rotating), warmed up for 40 rounds and then until every tracer is at the TurboFan tier, then 100 timed rounds (300 for 2000 x 10). Tables give min, median and p95 (nearest rank). Every tracer copy is compiled from unique source text so V8 cannot share type feedback between copies. Each block records the load average, the other processes' CPU, the hypervisor's steal time and this process's CPU over wall time, and labels itself `quiet` or `LOADED`.

**Extrapolation.** One data point: the 3-D air step takes 17.5 ms on this machine and 41.1 ms on the user's phone, a factor of 2.35. The harness times the air step again in the same run (section 12): 16.8 ms at the start and 16.6 ms at the end, which would be 2.45 to 2.48.

## Conditions of the run

This is the **quiet re-run**. Before it, three full runs ran on a machine shared with other agents' browsers and test runs (1-minute load average 9 to 12 on 4 vCPUs, other processes using about 2.8 cores, hypervisor steal about 15 %). This run started at load average 0.88 with nothing else running: 43 timed blocks, 3 of them flagged LOADED (other processes above half a core), median other-process CPU 3 % of a core, median steal 3.8 %. The three loaded runs gave the same minimum and median to within a few percent (2000 x 10, `v2p`: fastest / median 5.77 / 6.69 ms loaded against 5.83 / 6.77 ms quiet) and a p95 up to 50 % higher (12.06 ms against 8.12 ms), so none of the conclusions moved; only the "undecided" cells of the loaded runs were decided. Those runs are not kept.

## Numbers

All times in ms. "Phone" is this machine x 2.35.

### The plan's own case: 2000 glyphs x 10 segments (sections 06 and 12)

| Variant | Here: fastest / median / p95 | Phone: fastest / median / p95 | Against 8 ms on the phone | Against 32 ms at 4x throttle |
|---|---:|---:|---|---|
| `v1` today's sampler (u, v, w) | 6.12 / 7.20 / 9.80 | 14.4 / 16.9 / 23.0 | over (needs 1.8x) | undecided |
| `v2` plan 7.2 as written | 6.88 / 8.00 / 11.22 | 16.1 / 18.8 / 26.3 | over (needs 2.0x) | undecided |
| `v2p` hand-inlined | 5.83 / 6.77 / 8.12 | 13.7 / 15.9 / 19.1 | over (needs 1.7x) | undecided |
| `r1` raster at the model grid (trace only) | 2.15 / 2.46 / 3.09 | 5.1 / 5.8 / 7.3 | fits | fits |

"Over (needs Nx)": even the fastest rebuild on the phone estimate exceeds 8 ms, and N is the speed-up needed. "Fits": the p95 on the phone estimate is within 8 ms ("fits with margin": within 5.3 ms, which is 8 / 1.5, my choice of margin).

### All caps and segment counts: phone p95 estimate and class (section 12)

| Glyphs x segments | `v2` plan | `v2p` hand-inlined | `r1` raster |
|---|---|---|---|
| 600 x 6 | 4.5 fits with margin | 7.4 fits | 1.3 fits with margin |
| 600 x 10 | 6.6 fits | 6.1 fits | 2.3 fits with margin |
| 600 x 12 | 9.4 undecided | 8.2 undecided | 2.6 fits with margin |
| 1200 x 6 | 9.0 undecided | 7.5 fits | 2.7 fits with margin |
| 1200 x 10 | 13.7 over (1.2x) | 12.4 over (1.0x, at the line) | 4.2 fits with margin |
| 1200 x 12 | 15.5 over (1.5x) | 12.4 over (1.2x) | 4.4 fits with margin |
| 2000 x 6 | 15.4 over (1.2x) | 14.9 over (1.1x) | 7.4 fits |
| 2000 x 10 | 26.3 over (2.0x) | 19.1 over (1.7x) | 7.3 fits |
| 2000 x 12 | 24.4 over (2.4x) | 22.3 over (2.0x) | 7.3 fits |

Raw milliseconds for every cell (min / median / p95 here) are in section 06 of `results.txt`. The `v2p` 600 x 6 p95 is one outlier rebuild (3.14 ms against a median of 1.29); its median on the phone estimate is 3.0 ms. Glyphs that fit 8 ms on the phone by linear scaling of the 2000-glyph p95, at 10 segments: `v1` 695, `v2` 607, `v2p` 839, `r1` 2201 (section 12).

### Where the time goes: `v2`, 2000 x 10 (section 07)

| Part | Median ms | Share |
|---|---:|---:|
| seeds (lattice, hash, thinning, metres per pixel) | 0.088 | 1 % |
| tracing arithmetic (RK2, normalising, edge test) | 0.235 | 3 % |
| sampler calls (40,000, including the DEM lookup) | 6.699 | 86 % |
| output (DEM lift, vertex write, colour table, near plane, halo copy) | 0.761 | 10 % |
| total | 7.783 | 100 % |

With the raster the sampler share falls to 68 % of 2.36 ms. Colouring each segment with `sampleRamp` plus `srgbToLinear`, as `WindLayer` does per streak, instead of a 64-entry table adds 4.4 ms (+56 %).

### Allocation (sections 05 and 11)

| Variant | Bytes per rebuild | Bytes per call | Minor GCs in 300 rebuilds |
|---|---:|---:|---:|
| `v1` today | 7,020,800 | 175.5 | 127 |
| `v2` plan API | 1,920,000 | 48.0 | 35 |
| `v2p` hand-inlined | 0 | 0 | 0 |
| `r1` raster | 0 | 0 | 0 |

The plan's API (`wind(x, y, zAsl, out)` with double arguments and a boxed result) allocates 48 bytes per call, because V8 does not inline it. A detector variant that allocates one array per sample shows 32 bytes per call, so the method sees allocation. The plan's "still pure and garbage-free" for sampler v2 (7.2) does not hold as written for the glyph engine.

### Raster cost and accuracy (section 09)

| Case | Raster | Texels | Build median / p95 | Trace median | Build + trace | Direct `v2p` median |
|---|---|---:|---:|---:|---:|---:|
| standard 6 km | 1x (model grid) | 2025 | 0.28 / 0.31 | 2.36 | 2.64 | 6.54 |
| standard 6 km | 2x finer | 7921 | 1.03 / 1.10 | 2.36 | 3.39 | 6.54 |
| high 6 km | 1x | 3600 | 0.50 / 0.61 | 2.47 | 2.97 | 6.68 |
| high 6 km | 2x finer | 14161 | 1.85 / 2.26 | 2.44 | 4.28 | 6.68 |

Accuracy is the distance between the end point of each glyph traced through the raster and through the direct sampler (same seeds and rules, 32,000 glyphs, 2000 x 10 in 16 view boxes), in screen pixels at the seed. Standard 6 km, 100 m above ground, one model cell 60 px wide:

| Raster | Mean | p95 | p99 | Glyphs over 3 px |
|---|---:|---:|---:|---:|
| 1x | 0.47 px (1.2 % of the glyph length) | 1.92 px | 4.55 px | 2.3 % |
| 2x | 0.21 px | 0.82 px | 2.40 px | 0.7 % |

At the 12 km views, where one model cell is 267 m or 200 m, the 1x raster is looser (standard 12 km at 100 m: mean 0.75 px, 4.8 % over 3 px) and the 2x raster restores it (0.34 px, 0.8 %). At 300 m above ground the mean error is under 0.1 px.

### Staging, cold start, throttle (sections 00 and 08)

- **Slices.** The harness cuts a rebuild into slices that stop when the time budget is spent, reading the clock every 32 glyphs. At the 8 ms phone budget (3.41 ms here), `v2p` at 2000 x 10 takes a median of 2 slices per rebuild (up to 5); the slice p95 is 3.56 ms against the 3.41 budget; the sliced total (6.76 ms) equals the unsliced one (6.88 ms), so slicing costs nothing measurable. The raster at 2000 x 10 fits in one slice (median 2.33 ms against 3.41). The first slice includes the seeds.
- **Cold start.** The first rebuild of a fresh tracer takes 25.9 ms (`v2p`, 3.7 times the steady 7.0 ms) or 16.6 ms (`r1`, 7 times) in this V8, then settles within about five rebuilds.

## Recommendation

**Sampling design for workstream E.** Trace the glyphs through a 2-D raster of (u, v) at the chosen height, at the model's column spacing (`r1`), filled with the hand-inlined sampler once per new snapshot and once per height change, not per camera move. Use the 2x raster where one model cell is wider than about 60 px (the 12 km views). Keep sampler v2 of plan 7.2 for everything else (the slice panel, particles): it is exact against the engine. Direct sampling with the hand-inlined sampler is the fallback and the test oracle (it is what the raster accuracy is measured against).

**Caps by tier**, on the phone estimate, raster design: 600 x 12, 1200 x 12 and 2000 x 10 fit (2000 x 12 also fits, p95 7.3 ms). With direct sampling only 600 x 10 and 1200 x 6 fit at all (p95 6.1 and 7.5 ms), and 600 x 12 and 1200 x 10 are at the line.

**Staging.**
- Cut the rebuild into slices that stop when the time budget is spent: 8 ms on the phone, about 3.4 ms on this machine, 8 ms here at 4x throttle. Read the clock every 32 glyphs. The first slices of a fresh tracer overshoot (the longest was 5.0 ms against a 3.41 ms budget, section 00), so read it more often (every 8 glyphs) for the first few rebuilds [guess, not measured].
- Warm the tracer when the layer is created (a throw-away rebuild of a few dozen glyphs).
- Build into a second buffer and swap on the last slice, so a half-built rebuild is never drawn, and count the 250 ms spacing of 9.4 from the swap.
- Build the raster in its own slice before the first trace slice of a new snapshot.

**Rules for the implementation** (each measured above):
1. Do not pass or return doubles through functions V8 will not inline. Use a scratch `Float64Array` for positions, or inline the loop. Test that a steady-state rebuild allocates under 1 kB (the harness shows the shape of it).
2. Colour from a table by speed (64 entries), not `sampleRamp` plus `srgbToLinear` per segment.
3. Seed by selection sampling on the world lattice (exact counts, the same seeds after a pan) and cull to the view box before sampling.
4. Check the glyph budget by glyph count, not by tier name.

**Plan edits this suggests** (made in the plan with this commit):
- 7.2: "still pure and garbage-free" and "[est: well under 1 ms]" replaced by the measured figures.
- 9.3 "Field access": the raster at the chosen height, filled by sampler v2, is the primary field source; direct sampling is the fallback and the oracle.
- 9.8 "Rebuild": a per-slice budget, "<= 8 ms p95 per slice on the phone, a whole rebuild in 1 to 3 slices", with the throttle corrected (the 32 ms figure is 1.70 times too lenient).
- Section 14, the risk row: now measured on a desktop; the remaining risk is the phone factor.

**Next check.** Run one rebuild of this tracer on the phone (a dev route that times 100 rebuilds and prints min, median and p95) before the caps are frozen. It replaces the one data point behind the factor 2.35.

## Limits

- **One phone data point.** The factor 2.35 comes from the 3-D air step (17.5 ms here, 41.1 ms on the phone), which is stencil and multigrid code with sequential memory access. The glyph code is branchy and reads four columns at random, so its phone ratio can differ either way (a guess: between 1.5 and 3.5). The raster (about 16 to 110 kB, texels x 2 floats) may suffer less from a small phone cache than the direct sampler (0.5 to 1 MB of wind arrays plus the 0.64 MB DEM), so its factor may be the smaller one. Break-even factors are the "needs Nx" figures: direct sampling at 2000 x 10 fits only if the phone is far faster than the data point says.
- **One V8.** Node 22 runs V8 12.4. A phone WebView has other inlining and tier-up thresholds; the cold-start figures and the 48 bytes per call are for this V8.
- **Field realism.** The wind is a real engine field after a 20-minute spin-up with no fire. Fire-coupled fields have more structure, but the cost per sampler call does not depend on the values; the glyph paths do (calm cells become dots and cost less). The fast tier's diagnosed field is represented by the standard-tier field, which has the same shape and is smoother.
- **Tracer simplifications.** Top-down camera only (an orbit view changes the metres per pixel of each seed, not the work per glyph). No arrowheads, no LOD planner, no cross-fade, no ray-based visible region. Straight arrows (L1, L2) are not measured; their cost is a fraction of a segmented glyph (a guess).
- **Not measured.** The GPU side (`StreakBatch.commit` and drawing 2 x 24,000 instanced quads), the first load and compile of the lazy chunk, a phone's own garbage collector, and what the rebuild adds to a frame that already takes about 22 ms (plan 9.8).
- **Statistics.** p95 of 100 rebuilds is the 5th largest value, a noisy statistic; the 2000 x 10 block uses 300. "Glyphs that fit" scales the 2000-glyph p95 linearly (a guess: it errs by under 10 %). One quiet run.
- **Accuracy is relative.** The raster is compared with the direct sampler, which is itself a bilinear blend of 100 to 267 m columns. Neither is the true flow. The raster holds one height; a height change rebuilds it.

## How to reproduce

```
cat /proc/loadavg        # the first number should be under 1
FIRESIM_SPIKE=1 FIRESIM_SPIKE_OUT=docs/plans/spikes/S3-glyph-benchmark/results.txt nice -n 10 npx vitest run tests/spikes/glyphBench.spike.test.ts
```

About 3.5 minutes on this machine (five real engines are built first, 5 to 10 s each). Without `FIRESIM_SPIKE` the whole file is skipped, so `npm test` never runs it. `FIRESIM_SPIKE_JSON=<file>` also writes the numbers as JSON; `FIRESIM_SPIKE_QUICK=1` is a 2-minute smoke run whose numbers are not for use. The last lines of the output say how many blocks were LOADED; with none, every figure can be read as a quiet figure. Type check: `npx tsc --noEmit -p .`.

## Files

`README.md` (this note), `results.txt` (the raw output of the quiet run), and `tests/spikes/glyphBench.spike.test.ts` (the harness: sampler v2 prototype, glyph tracer, raster alternative, all measurements).
