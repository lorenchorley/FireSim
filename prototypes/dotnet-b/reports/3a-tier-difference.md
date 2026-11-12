# 3a: how different the TypeScript results are from each other (the yardstick for "close enough")

Stage 3a, agent P3a. Scenario: Katoomba demo site, 3 km, civil start 2025-12-20 12:00, one 310 m ignition line at t=0, seed 11 unless
stated, final arrival rasters at 1800 s (and at 900 s). Every number is from the TypeScript solver, Node v22.22.0, one shared 4-core container
(`indicative` for timing; the results themselves are deterministic, see `3a-reference.md`). Data: `3a-results.json` (`study.rows`),
produced by `ts-export/run.mjs study`; definitions in the header of `ts-export/study.mjs`.

## Definitions

For two final arrival rasters A (the reference) and B:
- **differ %** = cells burnt in exactly one of the two, as a percentage of the ever-burning cells (burnt in at least one);
- **area %** = (burnt area of B minus burnt area of A) / burnt area of A, signed;
- **median, p95** of |arrival(B) minus arrival(A)| in seconds over the cells burnt in both (p95 by nearest rank).

`high` is the high tier as the builder makes it: 20 m fire cells (150x150), not 30 m. A 30 m raster and a 20 m raster are compared on the 30 m grid
with nearest-neighbour sampling, which by itself adds a perimeter difference (the pair `high30` against `high`, grids only: 8 % differ with no embers, 4.6 % area).
So I also ran **`high30`**: the high tier's engine options (100 m air, 24 levels, first level 25 m, 4000 embers) on the standard 30 m fire grid. Pairs with
`high30` isolate the air model; pairs with `high` are "as shipped". `no embers` = the same runs with the option `embers=false`.

## 1. Tier against tier (seed 11, 1800 s)

| A | B | ever-burning cells | differ % | area % (B vs A) | median abs dt (s) | p95 abs dt (s) |
|---|---|---|---|---|---|---|
| fast | standard | 946 | 34.1 | +49.1 | 203.5 | 454.1 |
| fast | high (20 m, resampled) | 761 | 19.5 | +18.5 | 218.5 | 463.9 |
| standard | high (20 m, resampled) | 969 | 26.3 | -20.5 | 21.1 | 352.8 |
| fast | high30 | 1062 | 41.8 | +66.7 | 206.9 | 513.1 |
| standard | high30 | 1291 | 45.9 | +11.8 | 12.0 | 175.1 |
| **no embers** fast | standard | 744 | 16.1 | +17.1 | 202.1 | 454.1 |
| no embers fast | high (20 m, resampled) | 745 | 17.7 | +16.2 | 218.5 | 463.9 |
| no embers standard | high (20 m, resampled) | 767 | 8.9 | -0.8 | 21.1 | 290.6 |
| no embers fast | high30 | 712 | 13.2 | +11.1 | 205.2 | 414.2 |
| no embers standard | high30 | 744 | 6.7 | -5.2 | 11.5 | 141.7 |

At 900 s: fast against standard 24.0 % differ, +31.5 % area, median 68.5 s, p95 251 s (the same with no embers: no spot fire has started by 900 s);
standard against high30 no embers 4.1 % differ, -1.0 % area, median 5.5 s, p95 46 s.

Reading: the **fast tier is the odd one out**. It diagnoses the 3-D wind; the standard and high tiers integrate it (900 s spin-up). The fire arrives about 200 s earlier or later
in the median cell and burns 11 to 49 % more area. The two 3-D tiers agree with each other much better (median 12 to 21 s, area within 5 % with no embers), and what is left
between them at 1800 s is mostly the ember (spotting) noise below.

## 2. The model's own noise: seed against seed (same tier, same everything else)

| tier | at s | pairs | differ % min / median / max | abs area % min / median / max | median abs dt (s) min / median / max | p95 abs dt (s) min / median / max |
|---|---|---|---|---|---|---|
| fast, 6 seeds (11 to 16) | 1800 | 15 | 20.5 / 34.4 / 49.7 | 3.6 / 23.8 / 68.6 | 0.0 / 5.7 / 47.4 | 0.4 / 146.5 / 615.7 |
| standard, 4 seeds | 1800 | 6 | 15.5 / 35.9 / 40.7 | 4.3 / 31.8 / 55.5 | 0.1 / 0.9 / 9.6 | 219.1 / 355.5 / 470.8 |
| high30, 4 seeds | 1800 | 6 | 24.7 / 30.8 / 49.2 | 8.7 / 30.3 / 48.8 | 0.0 / 0.8 / 8.3 | 40.0 / 71.2 / 731.7 |
| high (20 m), 2 seeds | 1800 | 1 | 3.6 | 1.5 | 1.7 | 64.2 |
| **fast, no embers**, 3 seeds | 1800 | 3 | 0.0 / 1.1 / 1.1 | 0.0 / 1.1 / 1.1 | 0.0 | 0.0 |
| **standard, no embers**, 2 seeds | 1800 | 1 | 1.9 | 1.6 | 0.0 | 18.1 |
| high30, no embers, 2 seeds | 1800 | 1 | 0.0 | 0.0 | 0.0 | 0.0 |
| fast, 6 seeds | 900 | 15 | 2.6 / 17.8 / 26.0 | 1.8 / 8.9 / 24.1 | 0.0 / 0.4 / 11.9 | 0.0 / 25.2 / 90.6 |
| standard, 4 seeds | 900 | 6 | 2.3 / 6.1 / 15.5 | 1.8 / 4.1 / 14.2 | 0.0 | 0.0 / 0.3 / 0.8 |
| any tier, no embers | 900 | 1 to 3 | 0.0 | 0.0 | 0.0 | 0.0 |

The pair the brief names (seed 11 against 12):

| tier | at s | differ % | area % (12 vs 11) | median abs dt (s) | p95 abs dt (s) |
|---|---|---|---|---|---|
| fast | 1800 | 24.4 | +29.4 | 0.0 | 65.7 |
| standard | 1800 | 40.7 | +55.5 | 0.8 | 405.6 |
| high30 | 1800 | 24.7 | -8.7 | 1.5 | 118.8 |
| high (20 m) | 1800 | 3.6 | -1.5 | 1.7 | 64.2 |
| fast | 900 | 6.1 | +6.4 | 0.0 | 0.0 |
| standard | 900 | 12.4 | +14.2 | 0.0 | 0.3 |

Burnt area per seed (ha), mean, sd, coefficient of variation:

| tier | at s | per seed | mean | sd | cv % |
|---|---|---|---|---|---|
| fast | 1800 | 56.7 73.3 95.6 88.1 92.2 70.2 | 79.3 | 15.1 | 19.0 |
| standard | 1800 | 84.5 131.4 89.6 125.8 | 107.8 | 24.2 | 22.4 |
| high30 | 1800 | 94.5 86.3 123.1 63.0 | 91.7 | 24.8 | 27.1 |
| fast no embers | 1800 | 56.7 56.1 56.1 | 56.3 | 0.4 | 0.6 |
| standard no embers | 1800 | 66.4 67.5 | 67.0 | 0.8 | 1.1 |
| fast | 900 | 26.6 28.3 30.8 30.2 32.9 27.3 | 29.3 | 2.4 | 8.2 |

**The seed noise is the embers.** With embers on, two seeds disagree on 20 to 50 % of the ever-burning cells at 1800 s, because a spot fire that lights ahead of the front, or does not, changes
the burnt area by tens of percent; the fire at seed 11 (the one the brief fixes) happens to start no spot fire that matters, so its burnt area equals the no-embers run
(56.7 ha) and is the low end of the seed range (56.7 to 95.6 ha). With embers off the seed changes almost nothing: 0 to 1.9 % differ, 0 to 1.6 % area, median 0 s, p95 up to 18 s.

## 3. What a change in the last bits does

To find out whether V8-against-.NET last-bit differences (exp, pow, sin) can move the result, I multiplied the 10 m wind speed and the temperature of every weather hour by (1 + eps) and re-ran
(`export --perturb EPS`; 1e-15 is about 4.5 ulp of a double):

| scenario | eps | cells whose arrival changed | max abs change (s) | differ % |
|---|---|---|---|---|
| fast, standard, high (no embers), fast and standard (embers on), seeds 11 to 14, 1800 s | 1e-15 | 0 in every case | 0 | 0 |
| fast, no embers | 1e-12 | 0 | 0 | 0 |
| fast, seed 13 (many spot fires) | 1e-9 | 81 | 0.0006 | 0 |
| fast, seed 14 | 1e-9 | 84 | 0.0012 | 0 |

(The snapshot hashes change at every time in every perturbed run, so the perturbation reached the solver; the float32 arrival rasters did not move.) The front arrival is well conditioned: a
relative input change of a billionth moves an arrival by about a millisecond, and no ember decision flipped. **A numerical difference of a few ulps is not the risk. A different
random stream, or a different order or number of random draws, is.**

## 4. Proposed "close enough" bars for the C# port

The plan's proposed bars: at most 1 % of ever-burning cells differ, burnt area within 2 %, median arrival difference within 30 s, none worse than the tier-to-tier difference.

**Verdicts from the measurements**
- "None worse than the tier-to-tier difference" is easy to meet and not demanding: the fast tier against a 3-D tier is 13 to 42 % differ, area 11 to 67 %, median 202 to 219 s, and standard against high is 7 to 46 % differ, area 1 to 21 %, median 11 to 21 s. Keep it as an outer ceiling only. **The port must also
  compare the same tier**: the C# fast tier against the TypeScript standard tier would miss every bar by construction (median 200 s).
- **1 % differ and 2 % area are unrealistic with embers on and a different random stream**: the model's own seed-to-seed floor is 20 to 50 % differ and 4 to 69 % area at 1800 s (fast), and 2.6 to 26 % differ at 900 s.
  The median bar of 30 s is also broken by the seed floor in the fast tier (median 45 to 47 s for every pair that includes seed 13).
- 1 % is slightly *below* the embers-off seed floor (1.1 % fast, 1.9 % standard) if the C# stream differs even in the turbulence draws.
- All of the plan's bars are realistic, and in fact generous, for a port that reproduces the random draws exactly (same generator, same order and number of draws): the last-bit sensitivity is 0 %.

**Proposed bars** (same tier, same seed, same scenario, arrival rasters at 1800 s; also check 900 s)

| bar | embers off, any random stream | embers on, identical random stream (faithful port) | embers on, different random stream |
|---|---|---|---|
| differ % of ever-burning cells | at most 2.5 (floor 1.9; the plan's 1 is tighter than the floor) | at most 1 (the plan's bar; expected about 0) | not a per-seed bar |
| burnt area difference | within 2.5 % (floor 1.6) | within 2 % (the plan's bar) | the mean over 30 seeds within 12 % of the TypeScript mean over the same 30 seeds (cv is 19 to 27 % per run, so the difference of two 30-seed means has a standard error of about 6 %; 12 % is two of them) |
| median abs arrival difference | at most 30 s (floor 0 s) | at most 30 s (the plan's bar; expected about 0) | not a per-seed bar |
| p95 abs arrival difference | at most 60 s (floor 18 s) | at most 60 s | not a per-seed bar |
| ceiling | no worse than the same-tier seed floor above; far below the 16 % / 17 % / 202 s of tier against tier | same | same |

The 30-seed ensemble is cheap in the TypeScript (about 1.3 s a fast-tier run here, 5 s standard); it was **not** run in 3a (6 seeds fast, 4 seeds standard and high30 were). Two things the next stage should decide: whether
the C# slice ports the TypeScript random generator and draw order exactly (then the middle column is the bar, and the C# can be held to it per seed), or not (then only the embers-off column and the ensemble
bar are fair). Seed 11 on this scenario starts no effective spot fire in the first 1800 s, so a per-seed check of the embers on seed 11 alone proves nothing about the ember code: use seed 13 (95.6 ha, many spots) or seed 12.

## Caveats
- One scenario, one site, one start time, 630 to 1700 burnt cells (a 3 km window, 30 min of fire): percentages of the ever-burning cells are noisy, and the perimeter is a large part of a small burnt area.
- The high-tier seed floor rests on one pair of seeds (3.6 % differ); do not read it as "high is calmer".
- 900 s differences are smaller than 1800 s ones because less spotting has happened.
- `high` against `fast` or `standard` includes the nearest-neighbour resampling of 20 m onto 30 m (8 % differ, 4.6 % area on its own); the `high30` pairs do not.
