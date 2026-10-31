# Simulation validity

A topic that has **not started**. **Question:** how can we verify that the simulation is valid, perhaps against a precomputed high-quality
simulation, and what other checks are there?

**Status:** a stretch goal in no release ([plan](../../docs/plans/air-slice-wind-detail-honest-speed.md) section 15d, decision D31).
**Recorded only: nothing has been run or built. A first desk search (web search results only; the papers were not read) was done on 2026-10-31 and is in *Desk research* below.** This page keeps the question, what the repository already has, and the ideas
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

## Desk research (2026-10-31): published practice and further proposals

The owner asked what else could be done to check validity and reliability, and asked for research. **What follows is a first desk search
(web search results, standard mode; the full papers were NOT read, so every figure is as the search summary gave it and needs checking
against the paper before anyone relies on it). Nothing was run or built.** Part A is what the literature says, with links. Part B is what I
propose because of it; those are my inferences, not findings.

### A. What the published literature says

| Topic | What I found | Source |
|---|---|---|
| Scores for a simulated fire against an observed one | Overlap scores (Sørensen-Dice, Jaccard and about a dozen relatives; the choice changes how over-burn and under-burn are weighted; Dice and Jaccard rank models alike); arrival-time agreement and shape agreement that account for how the fire moved between observations; Procrustes-based indices for orientation, size and shape of a perimeter; vector measures along the spread direction. No single score captures the error. Duff et al. (2018) scored PHOENIX by summed Area Difference Indices. | [CSIRO, representation and evaluation of propagation simulations](https://www.publish.csiro.au/WF/fulltext/WF12202); [distance metrics for perimeters (2016)](https://escholarship.org/uc/item/0nz4z9mf); [BNHCRC Procrustes indices](https://bnhcrc.com.au/node/579); [Duff et al. 2018](https://www.mdpi.com/1999-4907/9/4/189) |
| How good operational simulators are | An AFAC-commissioned evaluation compared Australis, Phoenix, Prometheus and Spark on 10 Australian historical fires and found no simulator clearly superior; each had strengths and weaknesses, and some were more sensitive to particular inputs. Duff et al.: two PHOENIX versions on nine wildfires, the newer slightly ahead but not significantly, worse on three of nine fires. AUSTRALIS validation: lower accuracy in extreme fire danger and a tendency to under-predict head rate of spread. | [CSIRO 2024 evaluation](https://www.publish.csiro.au/wf/Fulltext/WF23028); [Duff et al. 2018](https://www.mdpi.com/1999-4907/9/4/189); [UWA, techniques for evaluating wildfire simulators](https://research-repository.uwa.edu.au/en/publications/techniques-for-evaluating-wildfire-simulators-via-the-simulation-/) |
| What error is normal | A review of 49 evaluation datasets (1,278 paired observations) found mean absolute percentage errors from 20 % to 310 %, similar across fuel types, and proposed a +-35 % interval as a standard for model adequacy (Cruz and Alexander 2013, as quoted in the search result). The Cheney grassland models are listed at about 21 % MAPE on 120 field fires. A forest model built on Vesta data showed 35 to 46 % MAPE on its own development data and 81 to 84 % on an independent wildfire set. | [grass model comparison table and Annaburroo](https://research.csiro.au/pyropage/wp-content/uploads/sites/17/2024/08/CSIRO-Pyropage-Issue-39-Annaburroo-Grassland-Fire-Experiment-Data.pdf); [Vesta literature](https://publish.csiro.au/wf/Fulltext/WF21068); [10 % wind rule evaluation](https://www.iawfonline.org/article/evaluating-the-10-wind-speed-rule-of-thumb-for-estimating-a-wildfires-forward-spread-rate/) |
| Open data that exist | **Annaburroo 1986 grassland fires** (over a hundred experiments; Gould, Cruz and Sullivan 2024; dataset DOI 10.25919/ycd3-w209; Creative Commons Attribution per the CSIRO page, version not checked). **Project Vesta**: 116 experimental fires in dry eucalypt forest; I did not find the raw rate-of-spread tables or their licence. **NSW Fire History** (RFS) and the NPWS fire history on SEED: licences read inconsistently (Creative Commons on one page, 'not specified' on another); I could not confirm that the Gospers Mountain 2019 perimeter is in them. The **National Historical Bushfire Boundaries** compilation: licence not found. NSW **FESM 2019-20** (fire extent and severity mapping) exists on data.gov.au. | [Annaburroo data paper](https://publish.csiro.au/wf/WF23100); [NSW Fire History](https://data.nsw.gov.au/data/dataset/fa2fe6c7-2530-4b5a-87dc-5afdb290141a); [NPWS fire history on SEED](https://datasets.seed.nsw.gov.au/dataset/fire-history-wildfires-and-prescribed-burns-1e8b6/metaexport/iso19115_html); [Vesta book](https://www.publishing.csiro.au/book/9780643065345) |
| Weather inputs matter | PHOENIX on the 2009 Kilmore fire: coarser weather inputs (30-minute steps, 1,200 m spacing) matched the fire's progress better than very fine data. Sensitivity studies found considerable sensitivity to input weather. A WRF-Fire study of the Camp Fire found rate-of-spread and direction discrepancies that improved with a finer atmospheric grid over complex terrain. | [Kilmore weather-input and sensitivity studies](https://bnhcrc.com.au/node/471); [CSIRO 2024 evaluation](https://www.publish.csiro.au/wf/Fulltext/WF23028) |
| Spotting | Lab validation of firebrand transport models exists (a firebrand generator giving controlled, repeatable sets of burning and non-burning particles; Manzello lab data are cited). Theory tends to give a few hundred metres of maximum spotting distance while field observation exceeds a kilometre. Rare long-distance spotting is studied as a tail-of-the-distribution problem. | [firebrand transport model validation](https://vu-9.eprints-hosting.org/43615/3/Burning_firebrand_IJWF_revised2_NoHighlight.pdf); [rare events in spotting](https://ar5iv.arxiv.org/html/2205.02838); [Koo et al. (USFS)](https://fs.usda.gov/rm/pubs_other/rmrs_2012_koo_e001.pdf) |
| Open-source peers | ELMFIRE (Eulerian level-set model, Rothermel surface spread, Eclipse Public License 2.0, documentation at elmfire.io, used operationally in the US). I found no dedicated validation report or standard benchmark suite for ELMFIRE or FARSITE. FARSITE was able to reconstruct spread rate and size of fires when spotting was minimal, and failed to give realistic perimeters when spotting drove the spread (a Santa Barbara study); its accuracy depended heavily on fuel-model choice (a New England poster). | [Berkeley Fire Lab software page](https://firelab.berkeley.edu/software); [Santa Barbara FARSITE study (Fire, 2020)](https://doaj.org/article/5e3d0458ede84cd0b876de427e9fd669) |
| Testing without an oracle | Metamorphic testing (checking how the output must change when the input changes, not what it must equal) is the main approach in the literature for scientific and simulation software with no test oracle; examples include ocean software (relations from the periodicity of tides found a real defect) and PDE solvers (solutions that improve with grid or step refinement). It gives partial checks, not proof of correctness. I found no work applying it to wildfire spread simulators. | [Testing Ocean Software with Metamorphic Testing](https://arxiv.org/abs/2206.05457v1); [Kanewala and Bieman, automatic detection of metamorphic relations](https://mountainscholar.org/handle/10217/166910) |

### B. What I propose, beyond ideas 1 to 9 above (my inferences)

1. **Set pass marks from published error, not from perfection.** Operational simulators are 20 to 80 % off on average and no simulator is clearly best. Use the
   published figures as a yardstick (for example the +-35 % adequacy interval, and about 21 % for grass spread models on the Annaburroo-type data)
   and write the marks before any run. For a training app the claim to test is *relative* behaviour; absolute error is secondary.
2. **Grass-fire rate-of-spread test on open data.** The Annaburroo data are open, large and well documented, and the grass models have a known
   error (about 21 % MAPE). Run FireSim's grass fuel on the experiments' recorded wind, moisture and fuel and score the rate of spread. It is the
   cheapest external comparison with real fire behaviour, needs no perimeter data and no network at run time. The forest equivalent (Project Vesta)
   needs its data tables found first.
3. **A hold-out discipline for any tuning.** If a constant is ever tuned (the coupling factor, the ember generation rate and the acceleration constant
   are flagged as uncalibrated), tune on one set of cases and score on cases never used for tuning. The published example went from 35 to 46 % error
   on development data to 81 to 84 % on independent wildfires. Record in the claims register which constants were tuned and on what.
4. **Score hindcasts with a fixed metric set chosen in advance:** an overlap score at each observation time (Sørensen-Dice and the area ratio),
   arrival-time error, and one shape measure; report all, because no single score is enough. Use the Gospers Mountain preset first (check the perimeter
   source and licence), then fires that crossed the other bundled sites.
5. **Extreme-conditions bias check.** AUSTRALIS under-predicted head rate of spread at extreme danger, and the README already says real fires on steep slopes
   and in extreme weather are often faster. Quantify FireSim's bias at the top of the weather range against the experiments and hindcasts, and show
   it in *How sure are we?* instead of leaving it as a sentence.
6. **Spotting tail test.** The current check is a factor of 2 on Mk5 distances. Add the shape of the distance distribution: how often embers
   land beyond one kilometre under strong wind and a tall plume, compared with the field observation that spotting beyond a kilometre happens and
   with the lab-scale firebrand transport benchmarks for the single-ember flight. Spotting-driven fires are the hardest case for every model
   (FARSITE failed there), so expect and state wider error.
7. **Input-uncertainty ensembles with the published design:** perturb wind, moisture, ignition place and weather time resolution, and report the
   spread of burnt area and arrival time. The Kilmore result (coarser weather inputs matched better) means the *time resolution of the weather input*
   is itself a parameter to vary. It also gives a teachable output: a range, not one line.
8. **Metamorphic relations specific to this model** (the fire-specific ones are new work; I found no precedent): grid and step refinement converge
   (the convergence ladder, already idea 4); rotating terrain, wind and ignition rotates the result; a uniform wind rise never reduces the burnt
   area at a fixed time; adding a firebreak never raises it; doubling the time step with half the steps agrees within a tolerance; a
   wind change at time t leaves everything before t unchanged (the Wind direction feature already has this one as a test). Run them over randomised
   terrains with a property-based testing library, in the slow suite.
9. **Peer comparison on simple cases only, and say what it is.** ELMFIRE (open source, EPL-2.0) or FARSITE on flat ground, uniform slope and steady wind,
   after mapping fuels by hand. I found no published benchmark suite for them and little published validation of ELMFIRE itself, so agreement is
   consistency with another Rothermel-lineage model, not accuracy.
10. **Reliability, not validity: reproducibility across engines.** The simulation is deterministic (V18) on one machine. The ECMAScript specification lets
    an engine approximate Math functions such as exp, pow and sin, so a phone's WebView and the Node test machine may not agree bit for bit
    (general knowledge, not from the search). Run the same scenario in Node, in a desktop browser worker and on a phone, compare snapshot hashes and
    summary numbers, and if they differ find out how far: the golden scenarios (idea 3) then need tolerances, not exact hashes, if they are to be
    checked on a phone.
11. **Reliability: stress and fuzz tests.** Random terrains, weather and ignitions, including extremes (calm, gale, 0 and 100 % moisture, a tiny and a
    huge domain), checking for NaN, negative areas, runaway growth, a burnt cell that un-burns, and run time.
12. **Tier agreement over real terrain with a fire.** Nothing measures how far Fast, Standard and High differ with a fire on real terrain (only the 1 to 4 %
    wind-scale check on flat ground). Compare arrival-time rasters and perimeters across tiers on the bundled sites; the same experiment as idea 4.
13. **A structured face-validity review.** A written protocol for the expert review (idea 9): five to ten fire behaviour analysts, a fixed list of cases
    (note 10), the same questions for each ("is the head where you expect, is the speed plausible, what would mislead a trainee"), findings kept in
    this folder and turned into claims-register entries. It is the one check that tests the teaching, not the numbers.
14. **Make the evidence visible in the app.** A per-release *validation card* generated from the checks (which of V1 to V22 pass, golden-scenario
    summary changes since the last release, the convergence figures, the Annaburroo error once it exists, the known bias) and shown in *How sure are we?*,
    so a learner sees how far each number can be trusted, as plan rule 4 asks.

### C. What I could not establish

- Whether Project Vesta's raw data and the Gospers Mountain perimeter are available, and under what licence.
- Whether any standard benchmark suite exists for ELMFIRE or FARSITE (I found none).
- The exact figures above: they are from search summaries, not from the papers.
- Which of these checks the simulation would pass. None was run.

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

- 2026-10-31: desk research: published evaluation practice, open datasets, peer simulators and 14 further proposals, recorded in *Desk research*
  above. Search summaries only; nothing run.
- 2026-10-31: the owner confirmed this stays a stretch goal and is **not for implementation yet**, and asked whether an external comparison with
  another simulation or other data is possible. The answer is recorded in *External comparison: what is possible* above. Nothing was run.
