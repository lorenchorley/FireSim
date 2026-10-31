# Simulation validity

A topic that has **not started**. **Question:** how can we verify that the simulation is valid, perhaps against a precomputed high-quality
simulation, and what other checks are there?

**Status:** a stretch goal in no release ([plan](../../docs/plans/air-slice-wind-detail-honest-speed.md) section 15d, decision D31).
**Recorded only: nothing has been researched, run or built.** This page keeps the question, what the repository already has, and the ideas
that came up, so that a study can start from here when you decide. There is no study folder yet. The ideas come from general knowledge and
from reading the repository. Dataset and tool names are from memory, and their availability, access and licences have not been checked.

## Why it matters

- The app teaches how fire behaves in mountains. A learner who is shown a number (a rate of spread, a spotting distance, a wind speed near the
  front) takes it as true. Plan ground rule 4 says labels must be honest, and honest labels need evidence of how far each number can be trusted.
- The repository's own checks (below) show that the code does what its specification says. They do not show how close a result is to a real
  fire, or to what the model itself would give with more detail.
- Results will keep changing (decision D23: cliffs change the numbers near rock bands; D30 would change the detail). Without a record of how
  good the answer was, nobody can say whether a change made it better or worse.

## Three questions, three kinds of reference

"Is it valid?" is three questions, and a precomputed reference simulation answers only one of them.

| Question | Usual name | Compare with | What that cannot tell |
|---|---|---|---|
| **Is the code right?** Does it solve its own equations as written? | code verification | known answers: published formulas, analytic cases, properties that must hold | whether the equations are right |
| **Is the answer converged?** Does it change with a finer grid, a smaller step, more embers, a richer tier? | solution verification | **the same model run with more detail, once, offline** (the idea in the question) | whether the model is right: errors both runs share cancel out |
| **Is the model right?** Does it match the real world, for what the app is used for? | validation | measurements, recorded fires, another model, experienced people | which part is wrong: the inputs (weather, fuel, ignition) often matter more than the model |

## What the repository has today

- **V1 to V22** (spec section 15 in [`docs/research/00-synthesis.md`](../../docs/research/00-synthesis.md); tests in `src/sim/validation/`, run
  headless in Node through `Simulation`). Known answers and behaviours: the slope factor (up/flat 4.0 at 20 degrees), wind and slope together,
  ridge crests, night slowdown, katabatic and anabatic flow, moisture patterns, spotting distance within a factor of 2 of the Mk5 distances,
  lee-slope lateral spread, wind change, recent burns, junctions, plume regimes, level-set shape, determinism and rewind, wind scale, and
  performance. Several run in more than one tier against the same pass marks. So the code is checked against its specification and published
  rules of thumb.
- **A long headless run** (`src/sim/validation.test.ts`): 3 hours on the bundled Katoomba site in two tiers, a 2019 Black Summer replay
  preset (`gospers-2019-12-19`), and a calm night. It checks plausibility: growth, a plausible head rate of spread, upslope faster than
  downslope, spotting downwind, determinism after a rewind.
- **What none of these does:** compare a result with a recorded fire's perimeter, with another model, or with a finer run of itself. V19 checks
  the replay preset's inputs (drought state, the active fire kept out of the fuel reset) and that the fire runs. V21 checks the wind scale over
  flat ground, and the app's own summary says the 3-D wind is within about 1 % on average and up to about 4 % in single cells. I found no
  measurement of how far the tiers differ over real terrain with a fire.
- **What the app already says** (the *How this simulation works* screen, section *How sure are we?*; `src/ui/modelInfo.ts`): heads on slopes
  steeper than the validated range are flagged "not validated"; the evidence tags of the specification (verified, literature, derived,
  heuristic, unverified); the open issues of spec section 16 that change numbers on screen; and a validation summary with three known gaps.
  A claims register (below) would extend this section, not start from nothing.
- **Known gaps already in the research notes:** the coupling factor and wind height have no published calibration (note 07: it needs sensitivity
  studies against ACCESS-Fire or WRF-SFIRE hindcasts, and names the Sir Ivan fire); the ember generation rate is uncalibrated and shown as a
  relative likelihood (note 06); the acceleration constant is uncalibrated for eucalypt forest and steep slopes (note 03); some coefficients come
  from one code lineage (spec section 16).
- **Cases and datasets the notes already name:** note 10 section 5 lists fire cases "the app should be able to recreate" and recommends
  analogue terrain, not the real site, for replays of fatal incidents, out of respect for the families; note 02 names Askervein Hill as the
  classic dataset for flow over a hill; note 01 says slope winds and the thermal belt should be checked against Bureau of Meteorology station
  or research data, which note 08 calls the ground truth but awkward to get.

## Ideas, roughly cheapest first

| # | Idea | Tells us | Cannot tell | Needs |
|---|---|---|---|---|
| 1 | **Properties that must hold** (metamorphic checks): rotate terrain and wind and the result rotates; more wind never slows the head; more moisture never speeds it; a firebreak never raises the burnt area; a symmetric setup gives a symmetric result | bugs the current scenarios miss, with no reference at all | whether the formulas are right | little; extends V1 to V22 |
| 2 | **A claims register:** every number or behaviour the app shows (rate of spread, spotting distance, wind near the fire, "rock stops creeping fire"), with its source, the check run on it, the known error and what it was checked against | where the evidence is thin; the honest label for rule 4 | n/a | a desk exercise first |
| 3 | **Golden scenarios:** a small fixed set whose summaries are stored and compared at each release | that a change in results (D23) is measured and explained, not discovered; a regression guard | truth | determinism (V18) makes it cheap |
| 4 | **The reference run, and a convergence ladder:** the same code at settings no phone can afford (10 m fire cells, small steps, the most embers, the richest 3-D air), run once on a desktop and stored as small summaries (arrival-time raster, perimeters at set times, head rate of spread, ember landing percentiles, wind maps); the phone tiers and the 30 and 20 m cells scored against it per scenario | numerical error; how much the Fast tier loses against Detailed; where extra detail pays (D30) | whether the model is right | the harness already runs headless; hours per run; summaries small enough to commit |
| 5 | **Sensitivity and ensembles:** many runs with plausible input errors (wind speed and direction, moisture, ignition place) | how much each output moves; which outputs are robust; whether a real outcome falls inside the spread | truth | many runs, so it follows idea 4's scripted headless runs |
| 6 | **Wind and weather data:** hill-flow field campaigns (note 02 names Askervein Hill) for the diagnostic and the 3-D wind; Bureau of Meteorology station data for wind, temperature, humidity and moisture patterns | wind over terrain, slope winds, the thermal belt | fire spread | data access; stations are sparse in the ranges |
| 7 | **Other models on the same inputs:** coupled fire-atmosphere models (WRF-SFIRE and ACCESS-Fire, note 07) and operational spread tools (FARSITE, ELMFIRE, Phoenix RapidFire and Spark are the ones I know of) | differences in model form, mostly on the air and plume side where no formula exists | truth: they are unvalidated for these cases too | expert setup, licences, mapping our fuel classes to theirs |
| 8 | **Measured fire experiments** (published grass, shrub and forest burns, which are also the sources of the spread formulas) and **hindcasts of recorded fires**, scored by overlap of burnt area, area ratio and arrival-time error | the formulas in a controlled setting; the whole chain (weather, fuel, spread, spotting) on real terrain | which part is wrong: in a hindcast the inputs usually swamp the model error, so it needs idea 5 | perimeter and weather data; which recorded fires crossed the bundled sites is unchecked |
| 9 | **Expert review:** experienced fire behaviour analysts and instructors watch replays of the note 10 cases and say what is wrong or misleading | whether it teaches the right lesson; plausibility | numbers | people's time |

## External comparison: what is possible (the owner asked, 2026-10-31)

The owner asked whether the simulation can be compared with another simulation or checked some other external way. The answer is yes,
and it is recorded here with the stretch goal. **Nothing below has been researched, run or built.** Tool and dataset names are from memory;
their availability, access and licences are unchecked. Ideas 6 to 9 in the table above are the short form of this section.

**Compare with another simulation**
- **Open-source spread models.** ELMFIRE and FARSITE/FlamMap are free and run on an ordinary computer. They use US Rothermel-type fuel models,
  while FireSim is calibrated to Australian rules (the repository refers to the McArthur Mk5 spotting distances). So compare simple cases where
  models should roughly agree (flat ground, a uniform slope, a steady wind) after mapping fuels by hand. That would catch large discrepancies,
  not small ones.
- **Australian operational tools.** Phoenix RapidFire and CSIRO's Spark are the natural peers. As far as I know they are licensed to agencies
  or researchers, so access is the question.
- **Coupled fire-atmosphere models.** WRF-SFIRE and ACCESS-Fire are the useful comparison for the plume and the wind, where no simple formula
  exists. They need serious computing, so this is a research-collaboration job and not a script.

**Compare with real-world data**
- **Published experiments:** grass fires (the Cheney experiments) and Project Vesta's dry-forest burns, which are also where the spread
  formulas come from. Compare rate of spread under set conditions.
- **Recorded fires:** hindcasts such as Black Saturday or the 2019-20 NSW fires, scored by burnt-area overlap and arrival-time error. The app
  already has a Gospers Mountain replay preset. Inputs (weather, fuel, ignition) usually matter more than the model, so one run says little;
  it needs many runs with plausible input errors (idea 5).
- **Weather data:** Bureau of Meteorology station records for wind and moisture (awkward to get), and the hill-flow field campaigns
  (Askervein Hill) as the benchmark for the terrain-wind solver.
- **Expert review:** experienced fire behaviour analysts watch replays and say what is wrong or misleading. For a training app, "does it
  teach the right lesson?" is a validity question.

**No outside data needed**
- **Convergence check:** run the same model at finer detail, once, offline, to measure numerical error, including how much the Fast tier loses
  against Detailed (nothing in the repository measures that today).
- **Properties that must hold:** more wind never slows the head, a firebreak never raises the burnt area, rotating the terrain and wind rotates
  the result.

**Two limits.** Agreement between models of one lineage is not accuracy. Fire results are compared as statistics over several runs, not as one
trajectory.

**The cheapest first step, when the owner decides to start:** a desk study that picks the first two or three comparisons, checks which datasets
and tools are really available and licensed, and fixes the pass marks before any run (open questions 1, 5, 6 and 7 below).

## Pitfalls to design against

- **Agreement is not accuracy.** A reference from the same code shares its formulas, and models of one lineage agree with each other (as in
  [the cliff study](../cliff-from-photo/01-single-photo-depth/README.md)). A reference run measures numerical error only.
- **Inputs dominate.** In a hindcast, errors in weather, fuel and ignition time usually exceed the model's own error, so a hindcast with one
  set of inputs says little.
- **Chaos and chance.** Fire models amplify small differences and embers are random draws. Compare statistics over several runs (percentiles,
  overlap), never one trajectory or one landing.
- **Decide the pass marks first.** For each claim, write the tolerance and the cases before running a comparison, tied to what the app teaches.
  For training, relative behaviour (upslope runs faster, the wind-change flank becomes the head, embers cross a gully) matters more than an
  exact perimeter.
- **Choose cases with care.** Note 10 recommends analogue terrain for fatal incidents. Which recorded fires crossed the bundled sites, and
  what perimeter data exist, has not been checked.
- **The repository is public.** Record the source and licence of every dataset, perimeter or station series, and follow the rules in
  [`../README.md`](../README.md): small, pinned, and honest about what is measured and what is guessed.

## Open questions

Suggested order; none is started.

1. **The claims register and the pass marks (a desk exercise).** List every number and behaviour the app shows, with its source and the check
   that exists (V1 to V22, or none), and write the pass mark for each before any comparison. It changes nothing in the app and shows where the
   evidence is thin.
2. **Can the reference run be made?** The validation harness already runs `Simulation` headless in Node. Find the finest settings the code
   accepts, how long a demo scenario takes at them, and how much of a result has to be stored to compare against later.
3. **How far do the tiers and resolutions differ?** Fast, Standard and High; 30, 20 and 10 m cells; step sizes; ember counts, on one bundled
   scenario. It shares its experiment with question 2 of [adaptive-simulation-quality](../adaptive-simulation-quality/README.md), so do it once.
4. **Properties that must hold.** Write the list, mark which of V1 to V22 already cover each, and add the rest.
5. **Which recorded fires and weather data exist for the demo sites?** Perimeters, hotspot and burn-scar products and station data, with their
   licences and accuracy; whether a hindcast is feasible and which case comes first (the Gospers Mountain replay preset already exists).
6. **Which independent model can be run on a demo scenario?** Effort, licence, and how fuel classes map across.
7. **Which terrain-wind and station datasets can score the diagnostic and 3-D wind?**
8. **Who reviews, and how?** Which analysts or instructors, which cases, what format, and where the findings are kept.
9. **What would the app say?** How findings reach the screen as honest labels (plan rule 4), for example a "how far to trust this" line per
   number in *How sure are we?*.

## Log

No studies yet. Rules for adding one are in [`../README.md`](../README.md).

- 2026-10-31: the owner confirmed this stays a stretch goal and is **not for implementation yet**, and asked whether an external comparison with
  another simulation or other data is possible. The answer is recorded in *External comparison: what is possible* above. Nothing was run.
