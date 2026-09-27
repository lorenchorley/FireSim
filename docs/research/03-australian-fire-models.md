# 03 — Australian operational fire behaviour models (Vesta Mk 2, McArthur Mk 5, CSIRO grassland, shrubland, AFDRS)

FireSim research series, document 03. Topic: the empirical Australian models that give FireSim its rate of spread (ROS), intensity, flame height, spotting and fire-danger outputs. Every equation is given in code-ready form, with units, the source, and how reliable the transcription is. The emphasis is on the NSW ranges: Blue Mountains, Kanangra-Boyd, Wollemi, Budawangs, Barrington Tops, New England, Warrumbungles and Kosciuszko.

Companion documents: `01-terrain-fire-behaviour.md` covers slope, landform and eruptive fire, and `02-mountain-meteorology.md` covers winds, thermal belts and moisture. This document does not repeat them. It covers the fuel/weather → ROS machinery they plug into.

---

## 0. Provenance and verification tags (read first)

**Environment.** The web search budget was exhausted before this task started, and the sandbox blocked CSIRO, CSIRO Publishing, DOI resolvers, AFAC, RFS and Wikipedia. GitHub was reachable. So were two primary AFDRS documents mirrored in an NSW RFS analyst's public repository, and I read both:

- **FBI-TG**: Matthews, S. (2022) *Fire Behaviour Index Technical Guide*, v1.0, 23 June 2022, AFDRS. I read all 34 pages. It is the official description of the AFDRS models at launch.
- **AFDRS-RP**: Matthews, S., Fox-Hughes, P., Grootemaat, S., Hollis, J.J., Kenny, B.J., Sauvage, S. (2019) *Australian Fire Danger Rating System: Research Prototype*, NSW RFS, 384 pp. I read chapters 2–4 and 10 and the parameter appendices.

I cross-checked equations against open-source implementations:

- **PyroXL**: `Geoffysicist/PyroXL`, the NSW RFS fire behaviour analyst's VBA implementation of AFDRS and Vesta Mk 2. Its README says it was tested against the Python reference scripts.
- **PyroPy / PyroPy2**: `Geoffysicist/PyroPy` `spreadmodels.py` and `Geoffysicist/PyroPy_2` `spread_model_vesta2.py`, which cite Cruz et al. (2021) equation numbers.
- **FBCR**: `sadassimov/FireBehaviourCalcsR`, an R port of Tolhurst's *Advanced Fire Behaviour Prediction Standard Workbook*, which NSW RFS distributes. It includes the NSW fuel-type accumulation table and the Wind Reduction Factor Guide.
- **Spark-lib**: formulas from the CSIRO Spark model library, as transcribed in `bran-jnw/wuinity` (`SpreadModelAFDRS.cs`) and `implex001/ARSandbox` (`UCheneyFireSimComponent.cpp`).
- **KBDI-note**: Arndt (2018), the technical note in `subond/kbdi-ffdi`.
- **cffdrs**: `cffdrs/cffdrs_py`, for the FBP acceleration and length-to-breadth forms.

I could not read the Vesta Mk 2 user guide (Cruz et al. 2021) or the IJWF paper (Cruz et al. 2022) directly. The Mk 2 equations below come from code transcriptions. **Fact-check correction:** these transcriptions are *not* independent. PyroXL, PyroPy and PyroPy_2 all have the same GitHub author (Geoffysicist, NSW RFS). A third copy, `brodywickham/bushfire-toolkit` (2026), says it was "transcribed verbatim from the reference AFDRS spreadsheet", so it is derived from the same source. That makes the Mk 2 coefficients single-source. They carry the [S-code] tag and are listed as a verification item.

| Tag | Meaning |
|---|---|
| **[S-doc]** | Read this session in the primary or official document named. |
| **[S-code]** | Read this session in open-source code that cites the source equation. Check it against the primary before release. |
| **[K]** | Standard literature knowledge I could not re-verify this session. Check it before hard-coding. |
| **[H]** | FireSim design heuristic. It is tunable and must be shown to users as an assumption. |

I invented no numbers. Where two sources disagree, both are shown. I also ran every formula in Python and in TypeScript (Node 22) and compared the outputs (Appendix A).

### 0.1 Adversarial fact-check (second pass, 2026-09-27)

A second reviewer tried to refute every equation, coefficient, threshold and unit in this document. The environment was still restricted: the WebSearch budget was exhausted, and CSIRO, CSIRO Publishing, doi.org, AFAC, BoM, RFS, ResearchGate, Zenodo, archive.org and Semantic Scholar all returned an egress block. Only GitHub, PyPI and npm were reachable. The checks therefore covered:

- the FBI-TG v1.0 PDF, all 34 pages, re-extracted independently and read in full;
- the AFDRS-RP 2019 PDF: Tables 2.4, 2.5, 3.7, 4.3 and 4.7.2, §2.7, §3.2–3.3, §4.4–4.5, §8.7 and §10.1, grepped and read in context;
- the Arndt (2018) KBDI/FFDI note;
- the source code of PyroXL (`AFDRS_forest/grass/heath/mallee.bas`, `Vesta2.bas`, `Mk5.bas`, README change log), PyroPy_2, FireBehaviourCalcsR, wuinity `SpreadModelAFDRS.cs`, ARSandbox `UCheneyFireSimComponent.cpp`, cffdrs_py, and a newly found 2026 PWA, `brodywickham/bushfire-toolkit`;
- every worked example and test vector, recomputed by hand or in Python.

Each equation block now carries **(verified: …)** or **(UNVERIFIED — …)**. The corrections are listed here. The inline text marks each one "Fact-check".

1. **Mk 2 provenance.** The code sources share one author, so the coefficients are single-source (§0, §3.5).
2. **Wet-forest misattribution.** The AFDRS-RP live-trial finding, that wet sclerophyll forest on ridges and upper slopes is under-predicted, was obtained with the *2019 prototype* wet-forest function `FA = 1.135/(1 + e^(2(9 − DF)))` (AFDRS-RP eq 3.2). It was not obtained with the later C1(KBDI, WRF) function (FBI-TG eq 3.2–3.3). The finding still supports the mountain point, but it is not evidence about C1 (§1, §2.4, §4.4).
3. **Eaten-out grass below 5 km/h.** FBI-TG eq 3.11 and PyroXL use `0.054 + 0.209U`, the grazed coefficients. This makes ROS *halve* discontinuously at 5 km/h, from 1.10 to 0.55 km/h at the moisture and curing factors. The CSIRO Spark transcription (ARSandbox) uses `0.027 + 0.1045U`, which is continuous and exactly half of grazed. FireSim now defaults to the continuous form (§3.7, §4.6).
4. **Operational heath model changed in 2024.** The PyroXL change log (2024-02-15) says heath and spinifex were "updated in line with AFDRS changes". The "refitted logistic form" is therefore the current AFDRS heath model. The FBI-TG v1.0 (Anderson 2015 + damping) form is superseded operationally (§3.8).
5. **Mallee moisture disagreement resolved by provenance.** The same change log says the mallee moisture was "updated … in line with Cruz 2015". PyroXL's `4.74 + 0.108RH …` is the newer form (§3.2).
6. **Vesta 2012 near-surface height.** The FBI-TG changed the *default* H_ns from 25 to 20 cm. The hard cap `min(H_ns, 20)` is a PyroXL implementation choice (§3.4).
7. **Bark loads in the OFHAG table.** They were indexed by bark FHS but printed on the rating rows, which is off by one. They are now given per rating (§3.12).
8. **Pine active-crown ROS.** `W_stand` is the **wind speed at stand height** (km/h, FBI-TG eq 3.82), not a stand fuel load (§3.9).
9. **PyroXL Mk 2 P3 gate bug.** PyroXL compares `ros2 < 0.3` with a "km/h" docstring, but its `ros2_Vesta2` returns m/h, so the 300 m/h gate is never applied there. PyroPy2 applies `< 300 m/h`. The effect is negligible, because g3 is strongly negative whenever R2 < 300 m/h (§3.5).
10. **Mk 2 mixing weights** sum to `1 + P3(1 − P2)` in the coded form. This is noted, with the conditional alternative (§3.5).
11. **Upslope coefficient.** FBI-TG eq 3.5 prints `e^(0.0687θ)`, while Noble-derived code uses `e^(0.069θ)`. Both are ≈ 2^(θ/10) = e^(0.0693θ). The difference is below 1% at 10° and about 2% at 30°, so it is immaterial but now documented.
12. **Wilson (1988) breach coefficients.** Three of the four AFDRS-RP statements reproduce the doc's coefficient assignment exactly. The fourth, "88%/98% in the absence of trees", is reproduced by the *trees* coefficient. It is most likely an AFDRS-RP labelling slip (§3.13).
13. **Added:** §2.9 and §3.14 on mountain terrain versus the operational models; cards 18–23 in §5.
14. **Safety wording:** card 12 ("that is your window") was reworded. The acceleration constant is Canadian and uncalibrated for eucalypt forest or steep slopes.

---

## 1. Executive summary: what matters most for FireSim

1. **Four families cover almost all NSW mountain fuels.** Dry and wet eucalypt forest use **Vesta**. Heath and upland swamp shrubland use **Anderson et al. (2015)**. Grassland, alpine herbfield and grassy woodland use the **CSIRO grassland model**, with a canopy wind factor for woodland. Pine plantations near Oberon, Tumut and Batlow use the **AFDRS pine model**. The AFDRS assigns each state fuel type to one of eight models [S-doc FBI-TG §4].
2. **Vesta Mk 2 (Cruz et al. 2021/2022) is a three-phase model.** Phase 1 is a surface fire and uses the sub-canopy wind `u = U10/WRF`. Phase 2 is a surface fire with the understorey involved. Phase 3 is a crown fire and uses the full open wind `U10`. Logistic probabilities P2 and P3 give the transitions, so it explains *why* a fire jumps from about 0.5 km/h to about 3–7 km/h [S-code]. This is the single best "why" engine available to FireSim. (UNVERIFIED against the primary text. The coefficients are single-source NSW RFS analyst code; see §0 and §3.5.)
3. **The AFDRS forest model at launch was the original Vesta (Cheney et al. 2012).** Its fuel inputs are hazard scores. It uses `Umod = U10·3/WRF`, `φM = 18.35·MC^−1.495` and a linear fuel availability of `0.1·DF` [S-doc FBI-TG §3.3.5]. Mk 2 instead uses fuel loads, a polynomial moisture function and a logistic availability function. FireSim should implement Mk 2 as primary and the 2012 form for comparison.
4. **The empirical models assume a quasi-steady head fire on flat ground.** The AFDRS includes no slope effect and no build-up phase [S-doc FBI-TG §3.2.2–3.2.3]. FireSim must add both: slope via `2^(θ/10)` upslope and kataburn downslope (see doc 01), and acceleration via `R(t) = R_eq(1 − e^(−αt))`. (verified: FBI-TG §3.2.2–3.2.3. FBI-TG eq 3.5 writes the upslope factor as `e^(0.0687θ)`, which is within 2% of `2^(θ/10)` up to 30°.)
5. **Fuel moisture enters twice.** The dead fine fuel moisture MC comes from T, RH and period of day (Matthews et al. 2010). The drought factor DF, or KBDI, sets how much fuel is available. In Mk 2, halving DF from 10 to 5 halves every phase rate: FA goes from 0.998 to 0.504 [S-code]. Total ROS falls by more than half, because FME also enters the P2 and P3 logistics. Wet forests need KBDI above about 120–150 mm before fuel becomes available when WRF = 5 [S-doc/code]. This is why gullies and south faces stay unburnt while ridges burn. **Fact-check:** the field evidence that wet sclerophyll forest *on ridges and upper slopes* burns when the wet-forest modifier says it cannot came from the 2019 prototype function, `1.135/(1 + e^(2(9 − DF)))`, not from C1. The mountain lesson is the same, but it has not been tested against C1 [S-doc AFDRS-RP eq 3.2, §10.1].
6. **The wind reduction factor (WRF) is the mountain wildcard.** Tolhurst's guide gives WRF ≈ 1 for herbfield, 1.2 for grassland, 1.5 for heath, 3 for open eucalypt forest, 3.5 for shrubby forest, 4–6 for wet forest and 5–9 for rainforest [S-code FBCR]. A fire leaving forest onto a grassy ridge or into heath feels 2–3× more wind at flame height. Fire-front ROS can jump 3–10×.
7. **Fire shape.** The Spark library gives the length-to-breadth ratio LB(U10). For forest: 1 below 5 km/h, `0.9286·e^(0.0505U)` for 5–25 km/h, and `0.1143U + 0.4143` above 25 km/h. For grass it is `1.1·U^0.464` [S-code Spark-lib]. Back and flank rates follow from ellipse geometry. At LB = 3.8 the back rate is 1.8% of the head and the flank rate is 13%.
8. **Intensity** is `I = 18 600·w·r`, with w in kg/m² and r in m/s. The fuel involved depends on phase and flame height: elevated fuel is added above 1 m of flame, and half the canopy above 0.66 of canopy height [S-doc/code]. The **FBI** is a piecewise-linear map of intensity (forest, grass, shrub) with rating thresholds 12, 24, 50 and 100 [S-doc FBI-TG §2].
9. **Spotting.** The Vesta/AFDRS spotting fit gives the maximum spotting distance from ROS, U10 and surface FHS (50 m if ROS < 150 m/h). McArthur's is `S = R(4.17 − 0.033W) − 0.36` km. Bark FHS ≥ 3, meaning stringybark or ribbon bark, is the AFDRS flag for long-range spotting potential [S-doc AFDRS-RP §4.4.1].
10. **Fuel build-up after fire** follows Olson curves, `w(t) = w_ss(1 − e^(−kt))`. The NSW fuel table gives per-Keith-class parameters. For example, Sydney montane dry sclerophyll forest has surface w_ss = 14.7 t/ha and k = 0.17 /yr, and New England/Northern tableland dry sclerophyll forest has 19 t/ha and k = 0.15 /yr [S-code FBCR]. Back burns and prescribed burns reset t, which is how FireSim shows "why this block burns slower".

---

## 2. Mechanisms, and what they mean in the NSW ranges

### 2.1 What an Australian empirical model is
Vesta, McArthur and the CSIRO grassland model are statistical fits of observed head-fire ROS to a handful of predictors: 10 m open wind, a moisture surrogate and fuel descriptors. The data come from experimental fires and documented wildfires. They predict the **quasi-steady** head fire of a free-burning front that is wide enough to reach its potential [S-doc FBI-TG §3.2.2]. The fitted data already contain the average fire–atmosphere feedback of a quasi-steady front, such as indraft, plume tilt and convective preheating. So two cautions apply [H]:

- Feed them the **ambient** open wind: the terrain-modified wind without the fire, not the fire-accelerated local wind. Otherwise the feedback is counted twice.
- They know nothing about terrain channelling, lee-slope eddies, vorticity-driven lateral spread or eruptive fire. The coupled atmosphere and the mountain-phenomena modules supply those (docs 01 and 02).

The AFDRS-RP found that McArthur Mk 5, which was built mostly on small experimental fires, rated initial-attack fires reasonably well. Vesta-based AFDRS over-predicted fires still in their build-up phase. For the 34 forest fires with initial-attack success, its *rating category* was over-predicted in 50% of cases, against 18% for the old FFDI system. Its Peirce skill score was nonetheless higher, 0.33 against 0.14 (verified: AFDRS-RP §8.7, Table 8.18). The teaching point is that a new fire, or a new spot fire, is slower than the model's "potential". It accelerates towards that potential.

### 2.2 Wind at the flame, not at 10 m
All models take the 10 m **open** wind U10, the value a weather station in a clearing would record. The canopy slows the wind that surface and understorey flames feel. Vesta Mk 2 phases 1–2 use `u = U10/WRF`. AFDRS Vesta 2012 uses `U10·3/WRF`, which means Vesta was implicitly fitted at WRF ≈ 3 [S-doc FBI-TG eq 3.46]. In the shrubland model the 10 m → 2 m factor is 0.667 in open heath and 0.35 under woodland [S-doc]. For grass under trees, ROS is multiplied by 1.0 in the open, 0.5 in 5–7 m woodland and 0.3 in 10–15 m open forest [S-doc FBI-TG Table 3.4]. **Phase 3 (crown) fire in Mk 2 uses the full U10** [S-code]: once the fire is in the crowns it feels the above-canopy wind.

In the mountains this matters in three ways [H, using [S] WRF values]:
- Ridge-top winds often exceed the valley weather-station wind. Exposed ridges also tend to carry lower, more open vegetation (heath, shrubby woodland) with low WRF.
- Where the forest edge meets heath or grass on the Blue Mountains plateau or the Kosciuszko high plains, ROS rises sharply because the effective wind and the model family both change.
- Wet sclerophyll and rainforest in sheltered gullies have WRF 4.5–9 **and** low fuel availability. They form natural "brakes", until drought removes the availability limit.

### 2.3 Fuel structure: litter, near-surface, elevated, bark, canopy
The Vesta framework describes eucalypt forest in strata [S-doc FBI-TG §3.3.5; K for layer definitions]:
- **Surface**: litter of leaves, twigs and bark on the ground.
- **Near-surface**: grasses, low shrubs and suspended or collapsed litter. Height is roughly tens of cm.
- **Elevated**: shrubs and understorey. Height is roughly 1–5 m.
- **Bark**: loose stringy or ribbon bark is the main firebrand source.
- **Canopy.**

Flames grow from the litter up. When they reach the elevated layer, **phase 2**, fuel consumption and ROS jump. When the canopy becomes involved, the fire is in **phase 3**, a crown fire. For intensity, the AFDRS adds canopy fuel once flames exceed about 0.66 of canopy height [S-code]. In Mk 2 phase 2 is more likely with more wind under the canopy, drier fuel and more surface fuel. Phase 3 is more likely with stronger open wind and drier fuel [S-code]. Steep slopes tilt flames towards the upslope fuel, which helps vertical transition in practice [K]. Mk 2 represents slope only as a ROS multiplier.

### 2.4 Moisture and fuel availability
- **Dead fine fuel moisture (MC, %)** responds within hours to T and RH. It also depends on insolation, so the models separate a *sunny afternoon* period, *other daylight* and *night* [S-doc]. A north-westerly afternoon on a sunny ridge gives the lowest MC. Night-time RH recovery is weaker on the thermal belt, which doc 02 covers.
- **Fuel availability** is the proportion of the fuel profile dry enough to burn. It is a slow drought variable: DF 0–10, from KBDI or SDI plus recent rain. In McArthur it is folded into FFDI. The AFDRS dry-forest implementation scales fuel scores and loads by `0.1·DF` [S-doc]. Mk 2 uses a logistic function of DF, so the fire does not "switch on" until DF is about 5–6 [S-code]. Wet forest applies a stand-structure factor C1(KBDI, WRF) to DF (FBI-TG 2022). The AFDRS-RP live trial (2017–18) used an earlier wet-forest curve, `FA_WF = 1.135/(1 + e^(2(9 − DF)))`, which reaches 0.5 only at DF ≈ 8.9 [S-doc AFDRS-RP eq 3.2]. That trial found that a drought-factor modifier "appeared to work best for rainforest and wet sclerophyll forest within gullies" and led to "**under prediction for wet sclerophyll forest on ridges and upper slopes**" [S-doc AFDRS-RP §10.1.3]. In the Little Losy fire (Stewarts Brook, Upper Hunter, 29 Nov 2017, DF 6.8), the fire "only burnt along the ridges and downslope on north-west aspects within the wet sclerophyll forest, while self-extinguishing along the rainforest boundary" [S-doc AFDRS-RP obs. 40]. **Fact-check:** an earlier version of this paragraph attributed the finding to C1, which is wrong. Whether C1 fixes the ridge problem is untested. C1 still has no topographic term (the C2 term is TODO in all code). The mountain rule is that aspect and topographic position change fuel availability, not just MC. (verified: AFDRS-RP pp. 93, 244, 248.)

### 2.5 Slope
Slope is applied as a multiplier on flat-ground ROS: `2^(θ/10)` upslope (McArthur), the kataburn form downslope (Sullivan et al. 2014) [S-doc FBI-TG eq 3.5–3.6; S-code Vesta2.bas]. The AFDRS itself does not apply slope [S-doc FBI-TG §3.2.3]. Doc 01 covers validity above 20°, directional application and eruptive fire. (verified: FBI-TG eq 3.5 `ROS·e^(0.0687θ)` citing Noble et al. 1980. Eq 3.6 is `ROS·2^(−θ/10)/(2·2^(−θ/10) − 1)` for θ < 0. PyroXL/FBCR/Mk 5 code use `e^(0.069θ)`, and the Vesta2 code uses `2^(θ/10)`, docstring "Cruz 2021 eqn 13". All three agree within 2% for θ ≤ 30°.) The FBI-TG explicitly says that "there are no accepted models" for how much steep topography should raise fire danger. It names lee-slope lateral spread (Simpson et al. 2014, 2016) and mass spotting as terrain processes that "place fire fighters at risk" (Lahaye et al. 2018) [S-doc FBI-TG §3.2.3]. See §2.9.

### 2.6 Shape, flanks, backs, acceleration and wind changes
A wind-driven fire grows as an approximate ellipse. LB grows with wind. The flank rate is the head rate divided by about 2·LB, and the back rate is much slower again. When the wind changes, the long flank becomes a head fire that is many times wider. The FBI-TG notes this has "been associated with some of the most significant fire events in Australia" [S-doc FBI-TG §3.1.2]. A point ignition, including a spot fire, starts slowly and accelerates. The FBP form reaches 68% of steady ROS at 10 min and 90% at 20 min when α = 0.115 min⁻¹ [S-code cffdrs; K for Australian applicability].

### 2.7 Spotting and bark
Dry eucalypt forests with stringybark or ribbon bark (bark FHS ≥ 3) have long-range spotting potential [S-doc AFDRS-RP]. The NSW table rates many montane and tableland forests "Extreme/Very High" bark hazard with long spotting distance, for example Northern tableland DSF, South East DSF and the escarpment wet forests [S-code FBCR]. Below about 1000 kW/m there is very little ember production [S-doc AFDRS-RP, quoting Gould et al. 2007a].

### 2.8 Fire history and fuel build-up
After a wildfire, prescribed burn or back burn, each fuel layer re-accumulates along an Olson curve. Litter reaches most of its steady state in 10–15 years for k ≈ 0.2–0.3, and bark more slowly (k ≈ 0.1) [S-doc/code]. The AFDRS assumes a 25-year time since fire when there is no record, "as most vegetation types reach steady state fuel limits by 25 years (e.g. Watson 2012)" (verified: AFDRS-RP §4.5.1).

### 2.9 What the operational models do *not* know about mountains (added in fact-check)
All the models in §3 are point models. Each was fitted on flat or gently sloping ground, with the wind from a single station. In the NSW ranges, their inputs must be built per cell from terrain, and several dominant mountain processes lie wholly outside them. Tags: [S-doc] where the FBI-TG or AFDRS-RP says it, [K] for literature knowledge, [H] for FireSim design.

- **No wind–slope interaction.** Vesta, Mk 2 and McArthur multiply a wind function by an independent slope factor. When wind and slope are aligned in a steep, narrow gully, observed spread can greatly exceed this product (eruptive or "blow-up" behaviour; doc 01) [K]. FireSim must hand θ_n > ~20° to the terrain module and not extrapolate `2^(θ/10)` [H]. The CSIRO Spark example clamps slope at ±20° [S-code].
- **Wind input is one number.** The models take a single 10 m open wind. On ridges, flow speeds up. In lee valleys it can reverse or separate, which drives vorticity-driven lateral spread on lee slopes. At night, drainage (katabatic) winds flow downslope [K; doc 02]. The FBI-TG names lee-slope lateral spread and mass spotting as terrain processes it does *not* model [S-doc]. FireSim should feed each cell the terrain-modified ambient wind, not the valley station wind [H].
- **Moisture is keyed to insolation, and insolation is keyed to aspect.** The Matthews et al. (2010) periods separate *sunny afternoon* from *overcast/other daylight* because solar heating of the litter lowers MC below what air RH implies [S-doc FBI-TG eq 3.48–3.49; K]. In steep terrain, a north- or west-facing slope under afternoon sun is a "sunny afternoon" cell, while a south-facing slope or a shaded gully at the same moment behaves more like the "overcast" period. Applying the period per cell from computed insolation is a FireSim extension [H], not part of the published model. With T = 30 °C and RH = 20%, the two periods give 4.7% and 5.6%. With RH = 40% they give 7.2% and 9.0% (computed).
- **Fuel availability depends on topographic position.** See §2.4: ridges and north-west aspects in wet sclerophyll forest burnt while gullies and rainforest did not [S-doc AFDRS-RP].
- **Canopy shelter (WRF) varies with landform.** Exposed ridges and plateau rims often carry lower, more open vegetation (heath, woodland), so their WRF is lower and their near-flame wind stronger [H, from the Tolhurst WRF classes].
- **Spotting distance is a flat-ground fit.** An ember lofted from a ridge-top fire can land far below its release height across a valley, so the effective transport can exceed the Vesta/McArthur flat-ground distance [H; doc 06].
- **The build-up phase is missing.** The AFDRS assumes quasi-steady fires [S-doc FBI-TG §3.2.2]. A new spot fire on a steep upslope with aligned wind can reach high ROS much faster than a spot fire on flat ground. The FBP acceleration constant used in §3.10 knows nothing about slope [H].

---

## 3. Quantitative models (code-ready)

**Conventions:** U10 in km/h (10 m open wind); T in °C; RH in %; MC in % oven-dry weight; loads in t/ha (1 t/ha = 0.1 kg/m²); ROS in m/h unless stated; heights in m. The exception is Vesta 2012's near-surface height H_ns, which is in **cm**. FireSim's `FireBehaviourInput` uses m/s wind and m heights, so convert: `U10_kmh = 3.6·windSpeed10`, `H_ns_cm = 100·nearSurfaceHeight`, and `ros_ms = ros_mh/3600`.

### 3.1 Common relationships
- **Byram intensity** `I = H·w·r`. I is in kW/m, H = 18 600 kJ/kg (AFDRS default), w is fuel consumed in kg/m², r is in m/s [S-doc FBI-TG eq 3.18]. With w in t/ha and R in m/h this becomes `I ≈ 0.5167·w·R`. Example: 10 t/ha at 1000 m/h gives 5167 kW/m. Buttongrass uses H = 19 900 [S-doc]. The FBI-TG itself flags H for grass as possibly too high (footnote 2). (verified: FBI-TG eq 3.18, 3.42 and footnotes 2, 3, 5, 6. The FBI-TG marks the 18 600 value "needs further investigation" for spinifex, forest and heath. The 0.5167 conversion was re-derived: 18 600 × 0.1 / 3600.)
- **Byram flame length** `L = 0.0775·I^0.46` (m, kW/m) [K; the same form, 0.07755·I^0.46, is used as flame height in the AFDRS pine model, S-doc eq 3.93].
- **Olson accumulation** `w(t) = w_ss·(1 − e^(−k·t))`, t in years since fire. The AFDRS applies it to loads, FHS and near-surface height [S-doc AFDRS-RP eq 4.1]. A variant with a post-fire residual `c` (Morrison et al. 1996) is noted but was not implemented in the AFDRS [S-doc]. (verified: FBI-TG eq 3.52–3.56, AFDRS-RP §4.4. Byram flame length is UNVERIFIED against Byram 1959 but is the standard form. The 0.07755 coefficient is verified in FBI-TG eq 3.93.)

### 3.2 Dead fine fuel moisture models
| Model | Equation (MC %) | Use | Tag |
|---|---|---|---|
| Forest, Matthews et al. 2010, period 1: sunny afternoon, Oct–Mar, 12:00–17:00 | `MC = 2.76 + 0.124RH − 0.0187T` | Vesta, Vesta Mk 2, AFDRS forest | [S-doc FBI-TG 3.48; S-code] |
| Period 2: other daylight / overcast | `MC = 3.60 + 0.169RH − 0.0450T` | " | [S-doc 3.49] |
| Period 3: night (code: hour ≤ 06 or ≥ 19) | `MC = 3.08 + 0.198RH − 0.0483T` | " | [S-doc 3.50; S-code] |
| McArthur Mk 5 forest meter | `MC = 5.658 + 0.04651RH + 3.151e−4·RH³/T − 0.184·T^0.77` | Mk 5 display only | [S-code PyroXL; K Viney 1991] |
| Grass, McArthur 1966 | `MC = 9.58 − 0.205T + 0.138RH` (AFDRS floors it at 5%) | CSIRO grass, woodland | [S-doc 3.13; S-code] |
| Shrubland (Cruz et al. 2015a; M-S 1999) | `MC1 = 4.37 + 0.161RH − 0.1(T−25) − 0.027RH·Δ`; `MC2 = 67.128(1 − e^(−3.132·rain48))·e^(−0.0858·h)`; MC = MC1 + MC2 | Heath | [S-doc 3.75–3.77] |
| Mallee-heath | `MC1 = 4.79 + 0.173RH − 0.1(T−25) − Δ·0.027RH` (FBI-TG). PyroXL instead codes `4.74 + 0.108RH − 0.1(T−25) − Δ(1.68 + 0.028RH)` | Not a NSW-mountain fuel | [S-doc vs S-code: disagree] |

Δ = 1 on sunny days 12:00–17:00, Oct–Mar, or where solar radiation > 500 W/m². The AFDRS sets Δ = 1 when RH ≤ 60% [S-doc]. rain48 is rain or dewfall in the last 48 h (mm), and h is hours since it stopped [S-doc]. The rain term (Marsden-Smedley et al. 1999) responds over 1–2 days. The AFDRS borrowed it for heath and mallee because those fuels become flammable quickly after rain [S-doc FBI-TG §3.2.1.2].

Example, T = 30 °C and RH = 20%: forest period 1 gives 4.7%, Mk 5 gives 4.1%, shrub with Δ = 1 gives 6.6%.

Verification status of this block:
- **Forest periods 1–3, grass, shrub and the rain term:** verified against FBI-TG eq 3.13, 3.48–3.50, 3.60–3.62 and 3.75–3.77. The grass 5% floor and the forest period hours (night = hour ≤ 6 or ≥ 19; afternoon = 12–17 inclusive; Oct–Mar; no "sunny afternoon" for wet forest) are PyroXL implementation details [S-code].
- **Mk 5 meter fit:** UNVERIFIED against the primary. It matches PyroXL and bushfire-toolkit code; the Viney (1991) attribution is [K].
- **Mallee-heath disagreement, resolved by provenance.** The PyroXL README change log (2024-02-15) records "updated mallee moisture function in line with Cruz 2015". So `4.74 + 0.108RH − 0.1(T − 25) − Δ(1.68 + 0.028RH)` is the newer form, taken from Cruz et al. (2015a) and adopted in PyroXL in 2024. The FBI-TG v1.0 (2022) form, `4.79 + 0.173RH …`, is the older one. The primary is still unread.
- **A third forest-moisture variant exists.** FireBehaviourCalcsR (the Tolhurst workbook port) uses Tolhurst's non-linear fits to the Project Vesta field-guide tables M1–M3 instead of Matthews et al. (2010). Its period definitions also differ: "summer" is Nov–Feb, the afternoon is 13:00–17:00, and night is before 06:00 or from 20:00 [S-code]. For the same period, the Tolhurst fits agree with Matthews to within about 0.35 %-points over T 15–35 °C and RH 10–80% (computed). The *period boundaries* matter more. At T 30 °C and RH 20%, an October afternoon at 12:30 is period 1 (4.7%) under FBI-TG rules but "daytime" (5.7%) under FBCR rules. FireSim should use the Matthews/FBI-TG forms.

### 3.3 Drought: KBDI and drought factor
- **KBDI**, metric form: daily ET (mm) = `1e−3·(203.2 − KBDI_{t−1})·(0.968·e^(0.0875·Tmax + 1.5552) − 8.30) / (1 + 10.88·e^(−0.001736·P_annual))`. KBDI is 0–203.2 mm. Rain enters as effective rain: the net of 5 mm (5.08 mm in Keetch & Byram), subtracted once per rain event [S-doc KBDI-note]. Example: KBDI 50, Tmax 30 °C, P_annual 1000 mm gives 2.9 mm/day.
- **Drought factor, Noble et al. (1980):** `DF = 0.191·(I + 104)·(N + 1)^1.5 / (3.52·(N + 1)^1.5 + R − 1)`, capped at 10. I = KBDI (mm), N = days since rain, R = rain amount (mm) [S-code FBCR; K].
- **Drought factor, Griffiths (1999)** with the Finkele et al. (2006) limit, as used by BoM: `DF = 10.5·(1 − e^(−(SMD+30)/40))·(41x² + x)/(40x² + x + 1)`, capped at 10. Here `x = N^1.3/(N^1.3 + P − 2)` for P > 2 (N = 0.8 on the day of rain), and x = 1 if P ≤ 2. Take the minimum over rain events in the last 20 days. Then `x = min(x, x_lim)`, with `x_lim = 1/(1 + 0.1135·SMD)` for SMD < 20 and `75/(270.525 − 1.267·SMD)` otherwise [S-doc KBDI-note]. NSW uses KBDI as the SMD [K; AFDRS code comments say "KBDI except SDI in Tas", S-code].
- (verified: the KBDI metric ET, the 5/5.08 mm effective-rain rule, the Griffiths DF, x, the 0.8 same-day N, the 20-day minimum rule and the Finkele x_lim were all re-read in the Arndt (2018) note, pp. 2–3. The note also specifies that for consecutive rain days, P is the event total and N counts from the day of the largest daily fall. Noble DF: UNVERIFIED against Noble et al. (1980), but identical in FBCR `drought.R`. All worked examples were recomputed and match.)

### 3.4 Vesta, original (Cheney et al. 2012), as used in the AFDRS "forest" model [S-doc FBI-TG §3.3.5; S-code PyroXL]
```
Umod = U10 · 3 / WRF                           (WRF 1.5–6; dry forest default 3, wet 5)
FHSs' = FHSs·FA ;  FHSns' = FHSns·FA           (FA = 0.1·DF dry; wet: see 3.5)
Hns  = min(Hns_cm, 20)                          (FBI-TG: *default* changed 25 → 20 cm; the cap is PyroXL's)
R0 = 30                                                   if Umod ≤ 5
R0 = 30 + 1.5308·(Umod − 5)^0.8576 · FHSs'^0.9301 · (FHSns'·Hns)^0.6366 · 1.03
ROS = R0 · φM(MC)        φM = 2.31 (MC ≤ 4); 18.35·MC^−1.495 (4 < MC ≤ 20); 0 (MC > 20; code uses 0.05)
```
- (verified: FBI-TG eq 3.1, 3.45–3.47 and 3.59, and AFDRS-RP eq 3.44–3.48 and Box 3.1, all re-read. **Fact-check:** the FBI-TG says only that the *default* H_ns "was changed from 25 cm to 20cm" because of over-prediction in forests with high near-surface heights. PyroXL `ROS_forest` goes further and caps any input at `Min(h_ns, 20)`. Treat the cap as optional [S-code] and keep the 20 cm default. The φM limits 2.31/0 were "estimated from Cruz et al (2021)" [S-doc]. PyroXL uses 0.05 above 20% [S-code]. The Cheney et al. 2012 paper itself was not read.)
- φM equals 1 at MC = 7%. The model is normalised to 7% moisture, and 18.35 = 1/0.0545 [S-code FBCR].
- Below 5 km/h the ROS is set to 30 m/h × φM because spread is "erratic in speed and direction" [S-doc].
- **FHR version (Box 3.1).** `ROS = 30 + 2.3117·(U10 − 5)^0.8364·e^(βs + βns)·1.02`, with βs = 0, 1.5608, 2.1412, 2.0548, 2.3251 and βns = 0.4694, 0.7070, 1.2772, 1.7492, 1.2446 for Low → Extreme. The AFDRS rejected it as non-monotonic (βs falls from H to VH, βns from VH to E) [S-doc AFDRS-RP]. (verified: AFDRS-RP Box 3.1 and Table 3.7, p. 105.)
- **Older Gould et al. (2007/2008) form:** `30 + 3.102·(U−5)^0.904·exp(0.279FHSs + 0.611FHSns + 0.013Hns)` [S-code PyroPy, FBCR]. (UNVERIFIED against Gould et al. 2007. It is identical in two code bases. FBCR pairs it with `MC^−1.495/0.0545` and `e^(0.069θ)`. FBCR computes the flank by substituting an effective wind of `0.2·U10 + 1`, and 0 if `0.2·U10 + 4 < 5`, which is a workbook heuristic [S-code].)
- **Flame height:** `FH = 0.0193·ROS^0.723·e^(0.64·H_el)·1.07` (m; ROS m/h; H_el in m). ROS = 1000 m/h with H_el = 1.5 m gives 7.96 m [S-doc eq 3.59].
- **Maximum spotting distance** (m; fit to the Vesta spotting model, Gould et al. 2007): 50 m if ROS < 150 m/h, otherwise `|176.969·atan(FHSs)·(ROS/U10^0.25)^0.5 + 1568800·FHSs^−1·(ROS/U10^0.25)^−1.5 − 3015.09|` [S-doc eq 3.51]. With U10 = 40 and FHSs = 3.5: ROS 500 → 370 m, 1000 → 1.6 km, 2000 → 3.5 km, 4000 → 6.1 km. The function jumps at 150 m/h and has a shallow minimum just above it. Clamp it and treat it as an envelope [H]. (verified: FBI-TG eq 3.51, from "K. Tolhurst pers. comm.", which is a fit to the Vesta spotting model. It is identical in PyroXL `Spotting_forest` and FBCR. The 1000 m/h case was recomputed as 1603 m.)
- **Fuel for intensity:** surface (capped at **10 t/ha**, "burning across then down into the fuel bed") plus near-surface, all multiplied by FA. Add elevated fuel (and bark, per the FBI-TG text) when FH > 1 m. Add 50% of canopy when FH exceeds the overstorey height. The PyroXL code uses 0.66·H_o and omits bark [S-doc eq 3.52–3.58; S-code]. **Fuel-load defaults at steady state (generic):** FL_s 14, FL_ns 3.5, FL_el 4, FL_b 5, FL_o 6 (8 for wet forest) t/ha. k: s 0.3, ns 0.2, el 0.2, b 0.1, o 0.3 (wet 0.35/0.2/0.15/0.1/0.35) /yr. FHS_s 3.5, FHS_ns 3.0, H_ns 25 cm, H_el 1.5 m. WRF 3 (dry), 5 (wet) [S-doc AFDRS-RP Table 4.7.2]. Where near-surface FHS is missing, the AFDRS used `FHSns = 0.857·FHSs` [S-doc]. (verified: FBI-TG eq 3.52–3.58, AFDRS-RP Table 4.7.2 "Generic fuel parameters" (Forest and Wet forest rows, including Hk_ns = 0.3), and AFDRS-RP §4.4.2 for 0.857. PyroXL `Intensity_forest` multiplies *every* layer by FA, then caps the surface layer at 10 t/ha, and uses a 1 m flame threshold for elevated fuel and 0.66·H_o for the canopy [S-code].)
- **Wet-forest FA in the AFDRS path (2022):** `FA = min(1.008/(1 + 104.9·e^(−0.9306·C1·DF)), 0.1·DF)`. The `min` is PyroXL's, with the comment "shouldn't get higher ros for wet when WAF is low" (verified: FBI-TG eq 3.2–3.3; S-code `AFDRS_forest.bas`). The FBI-TG gives W ∈ [3, 5] as C1's domain, so do not use C1 outside WRF 3–5 without flagging it.

### 3.5 Vesta Mk 2 (Cruz et al. 2021 user's guide; Cruz et al. 2022, IJWF 31:81–95) [S-code PyroXL `Vesta2.bas` and PyroPy2 `spread_model_vesta2.py`, same author; primary not read]
(UNVERIFIED — primary not accessible. Every coefficient below appears identically in PyroXL `Vesta2.bas`, PyroPy_2 `spread_model_vesta2.py` and `brodywickham/bushfire-toolkit`. All three trace to one NSW RFS analyst, so this is one source, not three. The code docstrings give the Cruz 2021 equation numbers: eq 1 H_u, 8 FME, 9–10 P2, 11–12 P3, 13 slope, 14a/b R1, 15 R2, 16 R3, 17 overall. These equation numbers are also unverified.)
```
Inputs: U10 (km/h), MC (%), DF, FL (surface + near-surface fine fuel load, t/ha),
        H_u (understorey height, m), WRF (3–5), θ (deg)
H_u  = −0.1 + 0.06·FHS_el + 0.48·H_el                    ("Cruz 2021 eq 1")
φM   = 1 (MC ≤ 4.1); 0 (MC > 24); else 0.9082 + 0.1206M − 0.03106M² + 0.001853M³ − 0.00003467M⁴
FA   = 1.008 / (1 + 104.9·exp(−0.9306·DF_eff))           DF_eff = DF (dry) or C1·DF (wet)
C1   = clamp(0.1·[(0.0046W² − 0.0079W − 0.0175)·KBDI + (−0.9167W² + 1.5833W + 13.5)], 0, 1)   W = WRF
FME  = φM·FA ;   SF = 2^(θ/10) (θ>0), 2^(−θ/10)/(2·2^(−θ/10) − 1) (θ<0)
u    = U10/WRF
R1 = 1000·[0.03 + 0.05024·(u − 1)^0.92628·(FL/10)^0.79928]·FME·SF     (u > 2; else 1000·0.03·FME·SF)
R2 = 1000·0.19591·u^0.8257·(FL/10)^0.4672·H_u^0.495·FME·SF
R3 = 1000·0.05235·U10^1.19128·FME·SF                     (PyroPy2 omits SF in phase 3)
P2 = 0 if FL < 1, else 1/(1 + exp(−(−23.9315 + 1.7033u + 12.0822·FME + 0.95236·FL)))
P3 = 0 if R2 < 300 m/h, else 1/(1 + exp(−(−32.3074 + 0.2951·U10 + 26.8734·FME)))
ROS = R1(1 − P2) + R2·P2                                  if P2 < 0.5
ROS = R1(1 − P2) + R2·P2·(1 − P3) + R3·P3                 otherwise (as coded)
```
Notes and uncertainties:
- The **phase-3 mixing** differs between implementations. PyroXL and PyroPy2 use the form above. The older PyroPy uses `[R1(1−P2) + R2·P2]·(1−P3) + R3·P3`. The two agree whenever P2 ≈ 1, which is always the case when P3 > 0 in the test cases (Appendix A). Check against the guide and expose a switch [S-code, H].
  - **Fact-check:** in the coded form the three weights sum to `(1 − P2) + P2(1 − P3) + P3 = 1 + P3(1 − P2)`. That exceeds 1 whenever 0.5 ≤ P2 < 1 and P3 > 0, so the overshoot is at most `(1 − P2)·P3·R3 ≤ 0.5·R3`.
  - A normalised alternative treats P3 as conditional on phase 2: `R1(1 − P2) + P2·[(1 − P3)·R2 + P3·R3]`.
  - In practice P2 > 0.99 whenever P3 is non-negligible. For example, with WRF 3, FL 5, MC 6% and U10 30, g2 = 8.4. So the choice changes ROS by < 1% except in wet forest (WRF ≥ 5) at low FL.
  - Note also that the `P2 < 0.5` branch discards R3 entirely, even if P3 is high. This can happen with WRF 5 and FL ≤ 5 at U10 ≈ 30 km/h.
  - Default to the coded form, for parity with NSW RFS tools, and offer the normalised form as a switch [H].
- **P3 gate units (fact-check).** PyroPy2 zeroes P3 when `R2 < 300` m/h. PyroXL `prob_phase3` tests `ros2 < 0.3`, and its docstring says km/h. But PyroXL's `ros2_Vesta2` returns m/h (×1000), so in PyroXL the gate is effectively never applied. The difference is immaterial: R2 < 300 m/h implies low wind or high moisture, where g3 < −10 and P3 < 10⁻⁴ (computed for FME ≤ 0.87 and U10 ≤ 25). Use 300 m/h.
- The **wet-forest C1** constant: the FBI-TG prints "= 0.0175" (a typo), PyroPy2 and the PyroXL forest code use −0.0175, and `Vesta2.bas` has −0.175. **Use −0.0175** [S-doc/code]. PyroXL also caps wet-forest FA at 0.1·DF. At WRF = 5 and DF = 10: KBDI 50 → FA 0.03, KBDI 100 → 0.35, KBDI 150 → 0.89, KBDI 200 → 1.0. At WRF = 6 fuel needs KBDI > ~140. At WRF ≤ 3, C1 = 1 [computed].
- **What φM and FA do** (computed): φM is 1.00, 0.87, 0.69, 0.51, 0.37, 0.23 and 0.17 at MC 4, 6, 8, 10, 12, 15 and 20%. FA is 0.14, 0.29, 0.50, 0.72, 0.87, 0.95 and 1.00 at DF 3, 4, 5, 6, 7, 8 and 10. Mk 2 is far **less** sensitive to very dry fuel than Vesta 2012: 4% vs 7% moisture is ×1.28 in Mk 2 against ×2.31 in 2012.
- **Transition thresholds**, solving g = 0 (computed; WRF = 3):

| MC / DF | FME | U10 for P3 = 0.5 (km/h) | U10 for P2 = 0.5 at FL 5 / 10 / 15 t/ha |
|---|---|---|---|
| 4% / 10 | 1.00 | 19 | 12.5 / 4 / 0 |
| 6% / 10 | 0.87 | 30 | 15 / 7 / 0 |
| 8% / 10 | 0.69 | 47 | 19 / 11 / 2 |
| 10% / 10 | 0.51 | 63 | 23 / 14 / 6 |
| 6% / 6 | 0.63 | 52 | 20 / 12 / 4 |

P3 also needs R2 ≥ 300 m/h. So long-unburnt forest (FL ≥ 15) is almost always phase 2. Recently burnt forest (FL ≈ 5) needs about 15–20 km/h. **This is exactly the "why" of hazard reduction.**
- Implementations have slightly different exponents (0.82569 and 0.46722 in PyroPy vs 0.8257 and 0.4672). The difference is negligible.

### 3.6 McArthur Mk 5 Forest Fire Danger Meter (Noble, Bary & Gill 1980) [S-code PyroXL, FBCR, HowToNotDie; K primary]
```
FFDI = 2·exp(−0.450 + 0.987·ln(DF) − 0.0345·RH + 0.0338·T + 0.0234·U10)
R    = 0.0012·FFDI·W            (km/h, flat; W = fine fuel load t/ha)
R_θ  = R·exp(0.069·θ)           (θ ≥ 0)
Z    = 13·R + 0.24·W − 2        (flame height, m; R flat, km/h)
S    = R·(4.17 − 0.033·W) − 0.36  (spotting distance, km; ≥ 0)
```
- **Available fuel.** FFDI already contains DF, so W is the total fine fuel. The workbook's intensity uses `516.7·W·(DF/10)·R`, with R in km/h [S-code FBCR].
- **Flank rate.** The workbook computes it as Mk 5 ROS with U10 = 0 [S-code FBCR]. That gives flank/head = e^(−0.0234U), which is 0.50 at 30 km/h, far above ellipse theory. Show it as "conservative flank".
- **Wind reduction.** FBCR/PyroPy apply `U10·3/WRF` inside FFDI for non-standard forests [S-code].
- **Example.** T 35 °C, RH 15%, U10 40 km/h, DF 10 gives FFDI 61. With 15 t/ha that is 1.1 km/h, Z 16 m and S 3.7 km.
- **Old NSW ratings** (FFDI): Low–Moderate 0–11, High 12–24, Very High 25–49, Severe 50–74, Extreme 75–99, Catastrophic 100+ [S-doc AFDRS-RP Table 2.4]. The NSW RFS (2014) forest guide, based on 20 t/ha, ties FDI to flame height and attack method: FDI 12–25 is 1.5–3 m flames and 500–2000 kW/m, where "parallel attack" is recommended. FDI 25–50 is 3–10 m flames and "indirect attack" [S-doc AFDRS-RP Table 2.5].
- **Known bias.** Project Vesta found that McArthur under-predicts developed summer wildfire ROS by a factor of about 2–3 [K]. It suits small and early fires (§2.1).

### 3.7 CSIRO grassland model (Cheney, Gould & Catchpole 1998; curing Cruz et al. 2015c) [S-doc FBI-TG §3.3.1; S-code]
```
Natural (load ≥ 6 t/ha):  R = 0.054 + 0.269·U10 (U10 < 5);  1.4 + 0.838·(U10 − 5)^0.844 (U10 ≥ 5)   km/h
Grazed  (3–6 t/ha):       R = 0.054 + 0.209·U10;             1.1 + 0.715·(U10 − 5)^0.844
Eaten-out (< 3 t/ha):     R = 0.054 + 0.209·U10;             0.55 + 0.357·(U10 − 5)^0.844
ROS = 1000·R·φM·φC·WAF                                                     (m/h)
φM = exp(−0.108·MC) (MC < 12);  0.684 − 0.0342·MC (MC ≥ 12, U10 ≤ 10);  0.547 − 0.0228·MC (MC ≥ 12, U10 > 10)
      (floor 0.001; stated application range MC 2–24%; FBI-TG misprints 0.228)
φC = 1.036 / (1 + 103.989·exp(−0.0996·(C − 20)))      (C = curing %; fires spread from ~20% curing)
```
- **Curing effect** (computed). φC is 0.01 at 20% curing, 0.17 at 50%, 0.60 at 70%, 0.82 at 80%, 0.94 at 90% and 1.00 at 100%. The superseded Cheney et al. (1998) curing function, `1.12/(1 + 59.2·e^(−0.124(C−50)))` [K], assumed no spread below about 50%.
- **WAF** for grass under trees is 1.0 open, 0.5 for woodland (< 30% overstorey) and 0.3 for > 30% [S-doc]. The AFDRS maps other fuel types onto grass states: rural → grazed; urban, woody horticulture, low wetland and chenopod → eaten-out [S-doc FBI-TG §4].
- **Flame height** (M. Plucinski, pers. comm.): `2.66·(ROS/3600)^0.295` (natural) or `1.12·(ROS/3600)^0.295` (grazed/eaten-out). ROS is in m/h, so the bracket is ROS in m/s. The FBI-TG prints the bracket as (ROS/1000)/3.6, and PyroXL codes ROS/3600, so they agree. PyroXL's comment says "km/h", which is misleading. Example: 8 km/h gives 3.4 m [S-doc eq 3.19–3.20; S-code].
- **Intensity.** The AFDRS clamps grass load to 1–6 t/ha [S-code].
- **Grassland FDI, for comparison.** Mk 3: `F = 3.35·W·exp(−0.0897·M + 0.0403·U)` for M < 18.8%, and `F = 0.299·W·exp(−1.686 + 0.0403·U)·(30 − M)` for 18.8 ≤ M < 30. The second form is written this way because it makes the two branches continuous at 18.8% (0.6204 both sides). PyroXL codes `exp(−1.686·M …)`, which is a bug. The Mk 3 moisture is `M = (97.7 + 4.06RH)/(T + 6) − 0.00854RH + 3000/C − 30`, and ROS = 0.13·F km/h [K]. Mk 4 (Purton 1982): `GFDI = exp(−1.523 + 1.027·ln Q − 0.009432·(100 − C)^1.536 + 0.02764·T − 0.2205·√RH + 0.6422·√U)` [S-code firebehavioR/FBCR].
- **Example.** U10 30 km/h, MC 5%, 100% curing, natural grass gives 8.2 km/h. That is 3–6× faster than the forest cases at the same wind, which is why a forest-to-grass transition on a tableland is dramatic.

### 3.8 Shrubland/heath (Anderson et al. 2015), AFDRS form [S-doc FBI-TG §3.3.7]
```
ROS = 5.6715·(WRF·U10)^0.9102·H_el^0.227·exp(−0.0762·MC)·60        (m/h; WRF 0.667 open, 0.35 under woodland)
ROS_adj = ROS / (1 + exp(−(16.57 + 1.188·U10 − 2.705·MC)))             (spread-likelihood damping, Cruz et al. 2010)
Intensity: w = FL_total(t) by Olson (generic FL 20 t/ha, k 0.2; H_el 1.3 m);  FH = e^−4.142·I^0.633
```
- The damping factor is below 0.5 when MC > (16.57 + 1.188·U10)/2.705. That is MC > 10.5% at 10 km/h and > 14.9% at 20 km/h.
- **Exponents disagree between sources:** 0.912 in PyroXL raw, 0.91 and 0.22 in the workbook. PyroXL's current operational heath code uses a **different, refitted logistic form**, whose source I could not identify [S-code]. Use the FBI-TG form and flag it.
- **Example.** U10 30 km/h, H_el 1.3 m, MC 6% gives 3.5 km/h.

### 3.9 Other AFDRS models, in brief
- **Pine** (Cruz, pers. comm.; simplified Cruz et al. 2008) [S-doc FBI-TG §3.3.8]. Relevant to Oberon, Bago and Tumut.
  - Litter moisture `m = 4.3426 + 0.1188RH − 0.0211T`.
  - Foliar moisture `150 − 5·DF`.
  - Crown initiation `I_crit = (0.01·CBH·(460 + 25·FMC))^1.5`. Van Wagner's original coefficient is 25.9 [K].
  - Active crown ROS `661.26·W_stand^0.8966·ρ_canopy^0.1901·e^(−0.1714·m)`.
  - Calculated as an ensemble of six stand stages. For example, the mature stage has a 14 m canopy base height and 0.15 kg/m³ bulk density.
- **Mallee-heath** (Cruz et al. 2013): go/no-go and crown-probability logistics. Not a NSW-mountain fuel. Overstorey-cover coefficients disagree between sources (−0.030442 / −0.304 / −0.30442).
- **Buttongrass** (Marsden-Smedley & Catchpole 1995): `ROS = 0.678·(U10/1.2)^1.312·e^(−0.0243MC)·(1 − e^(−0.116·TSF))·60`. It uses a bulk live+dead MC and is Tasmanian only. **Spinifex**: not applicable.

### 3.10 Fire shape, flank, back and acceleration
- **LB, eucalypt forest and mallee-heath:** 1 (U10 < 5); `0.9286·e^(0.0505·U10)` (5–25); `0.1143·U10 + 0.4143` (≥ 25) [S-code Spark-lib]. Values: 1.2 at 5, 1.54 at 10, 2.55 at 20, 3.84 at 30, 4.99 at 40, 7.3 at 60 km/h.
- **LB, grass, heath, buttongrass and spinifex:** 1 (U10 < 5); `1.1·U10^0.464` [S-code Spark-lib]. This is the same form as the FBP O1 grass type, after Wotton et al. 2009 [S-code cffdrs]. It has a jump at 5 km/h (1 → 2.3). Smooth it for animation [H].
- **Alternative LB (Alexander 1985):** `LB = 1 + 0.0012·U10^2.154` [S-code PyFireStation; K]. It is lower at moderate winds (1.76 at 20 km/h).
- **Head:back ratio:** `HB = (LB + √(LB²−1))/(LB − √(LB²−1))`. Back = head/HB. Flank = (head + back)/(2·LB) [K, standard ellipse geometry; the same algebra as Spark's cb and cf].
- **Speed along an outward normal** at angle ψ from the wind (Spark form) [S-code ARSandbox]:
  - `cc = √(1 − LB⁻²)`, `cb = (1 − cc)/(1 + cc)`, `cf = (1 + cb)/(2·LB)`
  - `f = (1 + cb)/2`, `g = (1 − cb)/2`, `h = cf`
  - `R(ψ) = R_head·[g·cosψ + √(h² + (f² − h²)·cos²ψ)]`
  - This returns 1 at the head, cf at the flank and cb at the back.
- **Acceleration** (FBP Eq 70/72; McAlpine & Wakimoto 1991): `R(t) = R_eq·(1 − e^(−α·t))`, with α = 0.115 min⁻¹ for point ignitions. For crowning conifer types FBP uses `α = 0.115 − 18.8·CFB^2.5·e^(−8·CFB)`. LB develops in time as `LB(t) = (LB_eq − 1)(1 − e^(−αt)) + 1` [S-code cffdrs]. The cffdrs code labels t "hours" while the α value is per minute (FCFDG 1992). **Use minutes** [K]. No accepted Australian build-up model exists "except in very mild conditions (Sullivan et al. 2013)" [S-doc FBI-TG §3.2.2]. Cheney & Gould (1995) showed that grass head-fire ROS depends on head-fire width [K].

### 3.11 AFDRS Fire Behaviour Index and ratings [S-doc FBI-TG §2]
The FBI scales linearly between breakpoints (FBI 0, 6, 12, 24, 50, 100) and is anchored at FBI 200 by 90 000 kW/m (the Kilmore East fire). It is **floored to an integer**.

| Model (metric) | 0→6 | 6→12 | 12→24 | 24→50 | 50→100 | 100+ |
|---|---|---|---|---|---|---|
| Forest and pine (I, kW/m) | 0–100 | 100–750 | 750–4000 | 4000–10 000 | 10 000–30 000 | > 30 000 |
| Grassland (I) | 0–50 | 50–2000 | 2000–9000 | 9000–17 500 | 17 500–25 000 | > 25 000 |
| Shrubland (I) | 0–50 | 50–500 | 500–4000 | 4000–20 000 | 20 000–40 000 | > 40 000 |
| Savanna/woodland (I) | 0–100 | 100–4000 | 4000–17 500 (12→50) | — | 17 500–25 000 | > 25 000 |
| Buttongrass (ROS, m/h) | 0–30 | 30–480 | 480–2040 | 2040–4200 | 4200–8400 | > 8400 (16.8 km/h → 200) |

**Ratings:** 0–11 No rating, 12–23 Moderate, 24–49 High, 50–99 Extreme, 100+ Catastrophic.

PyroXL codes older grass breakpoints (100 and 3000 instead of 50 and 2000). **Use the FBI-TG values.**

What the forest breakpoints mean [S-doc AFDRS-RP]:
- 100 kW/m: roughly self-sustaining.
- 750 kW/m: upper limit for prescribed burning.
- 4000 kW/m: the widely agreed limit for offensive suppression.
- 10 000 kW/m: aerial resources cannot hold the fire, and long-distance spotting increases.
- 30 000 kW/m: community-loss consequences.

**Wind-change and C-Haines "red flags"** sit outside the FBI: Huang–Mills wind-change index > 40, or C-Haines > the 95th percentile [S-doc].

**AFDRS fuel types relevant to the NSW ranges** [S-doc FBI-TG §4], with the FireSim mapping [H]:

| FireSim `FuelType` | AFDRS type → model | Notes |
|---|---|---|
| DryForestShrubby, DryForestGrassy | Forest → Vesta | Forests with a *continuous grassy* understorey go to Woodland (grass × 0.5/0.3) |
| WetForest, Rainforest | Wet forest → Vesta + C1(KBDI, WRF) | Rainforest WRF 5–9 |
| Heath | Heath / Wet heath (upland swamps) → shrubland | WRF 0.67 (0.35 under woodland) |
| AlpineHeathGrass | Heath (montane/alpine heath); Grass (herbfield); Low wetland → eaten-out grass | Bogs and fens are availability-limited |
| SnowGumWoodland, GrassyWoodland | Woodland → grass × WAF | Use Forest if the understorey is shrubby [H] |
| Grassland | Grass/Pasture → CSIRO grass (state from load) | |
| PinePlantation | Pine | |
| Urban | Urban → eaten-out grass; Rural → grazed | |

### 3.12 Fuel hazard assessment (OFHAG) → Vesta scores → loads
The *Overall Fuel Hazard Assessment Guide*, 4th edition (Hines, Tolhurst, Wilson & McCarthy 2010), rates the surface, near-surface, elevated and bark layers Low, Moderate, High, Very High or Extreme. It uses visual keys (cover, height/depth, dead fraction, bark type) and combines them into an Overall Fuel Hazard [K]. Standard conversions:

| Rating | FHS (surface/near-surface/elevated) | FHS (bark) | Surface t/ha | Near-surface t/ha | Elevated t/ha | Bark t/ha |
|---|---|---|---|---|---|---|
| Low | 1 | 0 | 4 | 1 | 1 | 1 (FHS 1) |
| Moderate | 2 | 1 | 8 | 2 | 2 | 2 (FHS 2) |
| High | 3 | 2 | 12 | 3 | 3 | 5 (FHS 3) |
| Very High | 3.5 | 3 | 14 | 3.5 | 4 | 6 (FHS 3.5) |
| Extreme | 4 | 4 | 20 | 4 | 6 | 7 (FHS 4) |

FHR → FHS comes from AFDRS-RP Table 4.3 [S-doc]. The FHS → load columns come from the Tolhurst workbook [S-code FBCR]. The inverse used by PyroXL (load → FHS) has boundaries of ≤ 4, 9, 13, 18 t/ha for surface; ≤ 2, 3, 4, 6 for near-surface; ≤ 1, 2, 3, 5 for elevated; and bark ≤ 0, 1, 2, 5 → 0–4 [S-code].

**NSW fuel accumulation** (Watson 2012 via the NSW RFS parameter table; r = steady-state load in t/ha, k in /yr, c = residual, WRF, bark hazard / spotting distance) [S-code FBCR `nsw_fuel_types.csv`]. The exact role of c (initial vs additive) is not stated. Assume `w = c + (r − c)(1 − e^(−kt))` and verify [K/H].

| Keith class (examples) | surface r / k / c | elevated r / k | WRF | Spotting |
|---|---|---|---|---|
| Sydney montane DSF (Blue Mtns) | 14.7 / 0.17 / 1.7 | 4.2 / 0.2 | 3.5 | Very High / Long |
| Northern tableland DSF (New England) | 19 / 0.15 / 1 | 2.2 / 0.15 | 3 | Extreme / Long |
| Southern tableland DSF | 19 / 0.15 / 1 | 2.2 / 0.15 | 3 | High / Long |
| Central / Northern gorge DSF (Wollemi, Kanangra) | 11 / 0.3 / 1 | 1.9 / 0.2 | 3 | Extreme |
| Southern escarpment WSF (Budawangs) | 18 / 0.35 / 1 | 2.9 / 0.15 | 4.5 | Extreme / Long |
| Montane WSF (Barrington) | 23 / 0.2 / 1 | 1.9 / 0.15 | 3.5 | Very High / Long |
| Subalpine woodlands (Kosciuszko) | 14 / 0.3 / 2 | 1.9 / 0.2 | 2.5 | High / Long |
| New England grassy woodlands | 9 / 0.4 / 1 | 0.4 / 0.2 | 2.5 | Extreme / Long |
| Rainforests | 9 / 0.75 / 0 | 0.9 / 0.3 | 5 | Low / Short |
| Montane & alpine heath | 5.1 / 0.1 / 1.5 | 5.9 / 0.25 | 1.5 | n/a |

**Wind reduction factor guide** (Tolhurst) [S-code FBCR]:

| Vegetation | WRF |
|---|---|
| Herbfield | 1 |
| Grassland, sedgeland | 1.2 |
| Heath, mallee woodland | 1.5 |
| Tall shrubland (> 1.5 m) | 2 |
| Eucalypt woodland (> 6 m) | 2.5 |
| Open eucalypt forest (standard McArthur) | 3 |
| Shrubby open forest | 3.5 |
| Damp forest with shrubs | 4–5 |
| Wet eucalypt forest, mature plantation | 4–6 |
| Rainforest | 5–9 |

### 3.13 Suppression thresholds and firebreaks
- **Firebreak breach probability** (Wilson 1988 logistic, as coded in PyroXL): `P = z/(1 + z)`, `z = exp(1.36 + 0.00036·I − b·W)`. W is break width in m. b = 0.99 with no trees nearby and 0.38 with trees, since trees supply embers [S-code]. Examples, no trees: 2000 kW/m and 3 m gives 29%. With trees: 5000 kW/m and 3 m gives 88%, and 10 000 kW/m gives 98% [computed]. The AFDRS-RP quotes 29% for the first case, matching this. It attributes the 88% and 98% to "absence of trees", which matches the *trees* coefficient here. The coefficient assignment is therefore uncertain.
- **Suppression.** Direct/offensive attack limit ~4000 kW/m. Less than 1000 kW/m gives little ember production [S-doc AFDRS-RP].

---

## 4. Implementation recommendations

### 4.1 Architecture of the point model inside the fire solver
1. **Static per-cell precompute** (on scenario build or after an edit): model family, WRF, the Olson-adjusted loads/FHS/heights from time since fire, H_u, bark flag, LB family and the FBI table. Store as typed arrays alongside `FuelMap`.
2. **Slow dynamic fields**, updated every 10–15 simulated minutes, or on weather change or cell edit: MC per cell, FA (DF, KBDI), φM, φC and FME.
   - MC uses the local T/RH from the atmosphere's lowest level, the period (sunny afternoon/day/night) and the aspect/shade corrections from the moisture module.
   - Then add `FuelEdit.moistureDelta`.
3. **Fast path, per level-set step and only in the narrow band near the front:**
   - U10 is the *ambient* open-equivalent wind. Take it from the atmosphere run with no fire heat, or from the coupled wind minus the fire-induced perturbation. Low-pass filter it to at least 1–2 cell widths [H].
   - Head ROS: evaluate the family model.
   - Directional factor: the ellipse normal-speed `ellipseFraction(LB, cos ψ)`.
   - Slope: multiply by the kataburn/McArthur SF evaluated on the **slope component along the normal**, `θ_n = atan(tan θ·cos(φ_n − φ_upslope))`. Clamp at the model limit and hand steep cases to doc 01's eruptive module.
   - Acceleration: multiply by `accelFraction(age)`. `age` is the time since the local front segment was ignited: a point ignition, a spot landing, or re-ignition after crossing a break. Segments inherit the maximum age of their neighbours as they merge [H].
   - Floor at the no-wind backing rate `R0·SF(θ_n)`, where R0 = 30·FME m/h for Mk 2 phase 1 [H].
4. **Outputs per burning cell:**
   - Intensity from Byram with phase-dependent fuel [H mapping of the AFDRS flame-height rule onto Mk 2 phases]. Phase 1: min(10, FL_s)+FL_ns. Phase 2: add FL_el and bark. Phase 3: add 0.5·FL_o. All multiplied by FA.
   - Flame height from the Vesta FH equation (or the family equivalent).
   - Vesta spotting envelope. The ember module uses it to cap and calibrate the landing-distance distribution [H].
   - FBI and rating.
   - The `SpreadFactors` decomposition: base = R at U = 5 km/h and MC 7%; wind; moisture = φM·FA; fuel; slope; terrain.

### 4.2 Wind double counting (important)
Vesta and grass models were fitted with station winds, so their fitted response already contains the head-fire's own indraft. If FireSim feeds them the coupled model's near-fire wind, it will count fire-induced wind twice at the head. It will also reverse ROS at flanks and backs where indraft opposes spread [H, reasoning from §2.1]. Recommended practice:
- (a) Compute ROS from the **ambient + terrain** wind.
- (b) Use the fire-induced circulation only for features the empirical models lack: junction zones, flank-to-head conversion from plume-driven wind shifts, ember lofting, VLS/lee-slope processes, and km-scale plume-driven changes. Give it a documented weight.
- (c) Expose a "coupling strength" developer setting for sensitivity demonstrations.

### 4.3 Numerics and performance budget
- **CFL.** Δt ≤ 0.5·Δx/R_max. With Δx = 20 m and R = 10 km/h (2.8 m/s), Δt ≤ 3.6 s. Use adaptive Δt with a 2–30 s range.
- **Cost.** A 6 h run at 5 s average is about 4300 steps. A narrow band of about 5000 cells at around 60 flops per model call is about 1.3 × 10⁹ simple operations. That fits in about 5–15 s of JS on a mid-range phone [H estimate]. The atmosphere dominates the budget.
- **Avoid `Math.pow` in the inner loop.** Precompute `FL^0.79928`, `FL^0.4672`, `H_u^0.495` and `(FHSns·Hns)^0.6366` per cell. Tabulate φM(MC) at 0.1% steps and FA(DF) at 0.05 steps.
- **Phase probabilities.** Default to deterministic expected ROS. Offer an **ensemble mode** (4–8 members) that samples phase per cell with P2/P3 and U10 gustiness (±20% [H]) to show spread uncertainty. This is a strong teaching tool.
- **Units.** Keep everything in the model functions in the published units (km/h, m/h, t/ha, cm where applicable). Convert only at the solver boundary. Unit-test against Appendix A.

### 4.4 Simplifications and their consequences
| Simplification | Consequence |
|---|---|
| Quasi-steady models plus FBP-style acceleration | Build-up is roughly represented. α is not calibrated for eucalypt forest [K/H]. |
| Slope as a multiplier, capped (doc 01) | Misses eruptive and attached-flame regimes unless the terrain module adds them. |
| Olson curves for FHS and heights | The AFDRS notes this is "potentially beyond its scope" [S-doc]. Understorey recovery after fire can be faster or slower. |
| Wet-forest C1 ignores aspect (C2 not implemented in any code) | Ridges in wet forest are under-predicted [S-doc]. Add an aspect/position term [H]. |
| Single MC per cell per 15 min | Misses minute-scale RH swings. Acceptable. |
| Deterministic Mk 2 mixing | Smooths the patchy crown runs seen in reality. Use the ensemble mode. |

### 4.5 Inputs the user must be able to edit (with ranges)
- **Fuel, per brush:**
  - model family / fuel type;
  - surface, near-surface, elevated and bark ratings, as OFHAG words or FHS 0–4, auto-converted to loads;
  - loads directly: surface + near-surface 0–30 t/ha, elevated 0–10;
  - near-surface height 0–50 cm and elevated height 0–5 m;
  - canopy height and cover, which drive WRF 1–9;
  - years since fire, or "burnt in hazard reduction / back burn on <date>";
  - grass curing 20–100%, grass state (natural/grazed/eaten-out);
  - moisture offset ±10 %-points ("wet gully", "dry ridge").
- **Weather:** observed U10 and direction, T and RH (belt-weather kit), DF (0–10) or KBDI (0–200), recent rain (mm) and hours since.
- **Model choice (training mode):** Vesta Mk 2 / Vesta 2012 / McArthur Mk 5 side-by-side; α acceleration (0.05–0.2 min⁻¹); Mk 2 mixing variant.
- **Firebreaks/trails:** width in m and trees nearby yes/no, for the breach probability.
- **Observations:** "fire has spotted here" (a new ignition, age 0) and "flank is running" (a local wind edit).

### 4.6 TypeScript reference implementation (tested; see Appendix A)
```ts
// Units: U10 km/h (10 m OPEN wind); T °C; RH %; MC %; loads t/ha; ROS m/h; heights m (Vesta 2012 Hns in cm).
export const HEAT_YIELD_KJ_PER_KG = 18600;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const logistic = (g: number) => 1 / (1 + Math.exp(-g));

export function slopeFactor(thetaDeg: number): number {            // McArthur up / kataburn down
  if (thetaDeg > 0) return Math.pow(2, thetaDeg / 10);
  if (thetaDeg < 0) { const s = Math.pow(2, -thetaDeg / 10); return s / (2 * s - 1); }
  return 1;
}
export type ForestMcPeriod = 'sunnyAfternoon' | 'day' | 'night';
export function forestMcPeriod(month: number, hour: number, sunny = true, wetForest = false): ForestMcPeriod {
  const peak = month >= 10 || month <= 3;
  if (peak && hour >= 12 && hour <= 17 && sunny && !wetForest) return 'sunnyAfternoon';
  return hour <= 6 || hour >= 19 ? 'night' : 'day';
}
export function mcForest(T: number, RH: number, p: ForestMcPeriod): number {   // Matthews et al. 2010
  if (p === 'sunnyAfternoon') return 2.76 + 0.124 * RH - 0.0187 * T;
  if (p === 'night') return 3.08 + 0.198 * RH - 0.0483 * T;
  return 3.60 + 0.169 * RH - 0.045 * T;
}
export const mcGrass = (T: number, RH: number) => Math.max(5, 9.58 - 0.205 * T + 0.138 * RH);
export function mcShrub(T: number, RH: number, sunnyAfternoon: boolean, rain48hMm = 0, hoursSinceRain = 48) {
  const mc1 = 4.37 + 0.161 * RH - 0.1 * (T - 25) - 0.027 * RH * (sunnyAfternoon ? 1 : 0);
  return mc1 + 67.128 * (1 - Math.exp(-3.132 * rain48hMm)) * Math.exp(-0.0858 * hoursSinceRain);
}
export const dfNoble = (kbdi: number, N: number, R: number) =>
  Math.min(10, (0.191 * (kbdi + 104) * (N + 1) ** 1.5) / (3.52 * (N + 1) ** 1.5 + R - 1));
export function dfGriffiths(smd: number, events: { daysAgo: number; mm: number }[]): number {
  let x = 1;
  for (const e of events) if (e.mm > 2) { const n = e.daysAgo >= 1 ? e.daysAgo : 0.8; x = Math.min(x, n ** 1.3 / (n ** 1.3 + e.mm - 2)); }
  x = Math.min(x, smd < 20 ? 1 / (1 + 0.1135 * smd) : 75 / (270.525 - 1.267 * smd));
  return clamp(10.5 * (1 - Math.exp(-(smd + 30) / 40)) * (41 * x * x + x) / (40 * x * x + x + 1), 0, 10);
}
export const kbdiET = (kbdiPrev: number, tmax: number, annualRainMm: number) =>
  (1e-3 * (203.2 - kbdiPrev) * (0.968 * Math.exp(0.0875 * tmax + 1.5552) - 8.30)) / (1 + 10.88 * Math.exp(-0.001736 * annualRainMm));

export const ffdi = (T: number, RH: number, U10: number, DF: number) =>
  2 * Math.exp(-0.45 + 0.987 * Math.log(DF) - 0.0345 * RH + 0.0338 * T + 0.0234 * U10);
export function mk5(F: number, W: number, thetaDeg = 0) {
  const R = 0.0012 * F * W;                                         // km/h flat
  return { rosMh: 1000 * R * Math.exp(0.069 * thetaDeg), flameHeightM: 13 * R + 0.24 * W - 2,
           spotKm: Math.max(0, R * (4.17 - 0.033 * W) - 0.36) };
}
export const phiM_vesta2012 = (mc: number) => (mc <= 4 ? 2.31 : mc > 20 ? 0 : 18.35 * mc ** -1.495);
export function rosVesta2012(U10: number, fhsS: number, fhsNs: number, hNsCm: number, mc: number, fuelAvail = 1, wrf = 3) {
  const U = (U10 * 3) / wrf, s = fhsS * fuelAvail, ns = fhsNs * fuelAvail, h = Math.min(hNsCm, 20);
  const r0 = U > 5 ? 30 + 1.5308 * (U - 5) ** 0.8576 * s ** 0.9301 * (ns * h) ** 0.6366 * 1.03 : 30;
  return r0 * phiM_vesta2012(mc);
}
export const phiM_mk2 = (m: number) => (m <= 4.1 ? 1 : m > 24 ? 0
  : 0.9082 + 0.1206 * m - 0.03106 * m ** 2 + 0.001853 * m ** 3 - 0.00003467 * m ** 4);
export const fuelAvailMk2 = (df: number) => 1.008 / (1 + 104.9 * Math.exp(-0.9306 * df));
export const wetForestC1 = (kbdi: number, W: number) =>
  clamp(0.1 * ((0.0046 * W * W - 0.0079 * W - 0.0175) * kbdi + (-0.9167 * W * W + 1.5833 * W + 13.5)), 0, 1);
export const understoreyHeight = (fhsEl: number, hElM: number) => -0.1 + 0.06 * fhsEl + 0.48 * hElM;
export function vestaMk2(U10: number, mc: number, df: number, flSurf: number, hU: number,
                         wrf = 3, thetaDeg = 0, kbdi?: number, wet = false) {
  const fme = phiM_mk2(mc) * fuelAvailMk2(wet && kbdi !== undefined ? df * wetForestC1(kbdi, wrf) : df);
  const sf = slopeFactor(thetaDeg), u = U10 / wrf;
  const r1 = 1000 * (u > 2 ? 0.03 + 0.05024 * (u - 1) ** 0.92628 * (flSurf / 10) ** 0.79928 : 0.03) * fme * sf;
  const r2 = 1000 * 0.19591 * u ** 0.8257 * (flSurf / 10) ** 0.4672 * Math.max(hU, 0) ** 0.495 * fme * sf;
  const r3 = 1000 * 0.05235 * U10 ** 1.19128 * fme * sf;
  const p2 = flSurf < 1 ? 0 : logistic(-23.9315 + 1.7033 * u + 12.0822 * fme + 0.95236 * flSurf);
  const p3 = r2 < 300 ? 0 : logistic(-32.3074 + 0.2951 * U10 + 26.8734 * fme);
  const ros = p2 < 0.5 ? r1 * (1 - p2) + r2 * p2 : r1 * (1 - p2) + r2 * p2 * (1 - p3) + r3 * p3;
  return { fme, r1, r2, r3, p2, p3, ros, phase: (p2 < 0.5 ? 1 : p3 < 0.5 ? 2 : 3) as 1 | 2 | 3 };
}
export type GrassState = 'natural' | 'grazed' | 'eatenOut';
export const phiM_grass = (mc: number, U10: number) =>
  Math.max(0.001, mc < 12 ? Math.exp(-0.108 * mc) : U10 <= 10 ? 0.684 - 0.0342 * mc : 0.547 - 0.0228 * mc);
export const phiCuring = (c: number) => 1.036 / (1 + 103.989 * Math.exp(-0.0996 * (c - 20)));
export function rosGrass(U10: number, mc: number, curing: number, state: GrassState, waf = 1) {
  const r = state === 'natural' ? (U10 < 5 ? 0.054 + 0.269 * U10 : 1.4 + 0.838 * (U10 - 5) ** 0.844)
          : state === 'grazed'  ? (U10 < 5 ? 0.054 + 0.209 * U10 : 1.1 + 0.715 * (U10 - 5) ** 0.844)
          :                       (U10 < 5 ? 0.054 + 0.209 * U10 : 0.55 + 0.357 * (U10 - 5) ** 0.844);
  return 1000 * r * phiM_grass(mc, U10) * phiCuring(curing) * waf;
}
export function rosShrub(U10: number, hEl: number, mc: number, wrf10to2 = 0.667) {
  const ros = 5.6715 * (wrf10to2 * U10) ** 0.9102 * hEl ** 0.227 * Math.exp(-0.0762 * mc) * 60;
  return ros * logistic(16.57 + 1.188 * U10 - 2.705 * mc);
}
export const byram = (rosMh: number, wTha: number, H = HEAT_YIELD_KJ_PER_KG) => H * (wTha / 10) * (rosMh / 3600);
export const flameHeightVesta = (rosMh: number, hElM: number) => 0.0193 * rosMh ** 0.723 * Math.exp(0.64 * hElM) * 1.07;
export const flameHeightShrub = (I: number) => Math.exp(-4.142) * I ** 0.633;
export function spotVesta(rosMh: number, U10: number, fhsS: number) {
  if (rosMh < 150) return 50;
  const x = rosMh / U10 ** 0.25;
  return Math.abs(176.969 * Math.atan(fhsS) * x ** 0.5 + 1568800 / fhsS * x ** -1.5 - 3015.09);
}
export const olson = (limit: number, k: number, tsfYears: number, c = 0) => c + (limit - c) * (1 - Math.exp(-k * tsfYears));
export const lbForest = (U: number) => (U < 5 ? 1 : U < 25 ? 0.9286 * Math.exp(0.0505 * U) : 0.1143 * U + 0.4143);
export const lbGrass = (U: number) => (U < 5 ? 1 : 1.1 * U ** 0.464);
export function ellipseFraction(lb: number, cosW: number) {        // normal speed / head ROS
  const cc = Math.sqrt(Math.max(0, 1 - 1 / (lb * lb))), cb = (1 - cc) / (1 + cc), h = (0.5 * (1 + cb)) / lb;
  const f = 0.5 * (1 + cb), g = 0.5 * (1 - cb);
  return g * cosW + Math.sqrt(h * h + (f * f - h * h) * cosW * cosW);
}
export const accelFraction = (tMin: number, alphaPerMin = 0.115) => 1 - Math.exp(-alphaPerMin * tMin);
const FBI_B = [0, 6, 12, 24, 50, 100];
export const FBI_TABLES = { forest: [0, 100, 750, 4000, 10000, 30000], grass: [0, 50, 2000, 9000, 17500, 25000],
                            shrubland: [0, 50, 500, 4000, 20000, 40000] } as const;
export function fbi(metric: number, t: readonly number[], top = 90000) {
  const n = t.length - 1;
  if (metric >= t[n]) return Math.floor(100 + (100 * (metric - t[n])) / (top - t[n]));
  for (let i = 1; i <= n; i++) if (metric < t[i])
    return Math.floor(FBI_B[i - 1] + ((FBI_B[i] - FBI_B[i - 1]) * (metric - t[i - 1])) / (t[i] - t[i - 1]));
  return 0;
}
export const rating = (F: number) => F >= 100 ? 'Catastrophic' : F >= 50 ? 'Extreme' : F >= 24 ? 'High' : F >= 12 ? 'Moderate' : 'No rating';
export function breachProbability(I: number, widthM: number, treesNearby: boolean) {
  const z = Math.exp(1.36 + 0.00036 * I - (treesNearby ? 0.38 : 0.99) * widthM);
  return z / (1 + z);
}
```

---

## 5. Explaining it to a beginner firefighter

These insight cards are triggered by detectors on the model state at the fire front, or at a cell the user taps. Each card shows its measured trigger values, such as "U10 = 32 km/h, MC = 5%", so the "why" is concrete. The thresholds come from §3. Values marked [H] are tunable.

| # | Card (short text) | Detection criteria |
|---|---|---|
| 1 | **"The shrubs have caught — fire has stepped up."** The fire is now burning the understorey as well as the litter, so flames are taller and it runs 2–4× faster. Why: enough wind under the trees, dry fuel, and a lot of litter. | Mk 2: P2 crosses 0.5 (upward) or R2/R1 > 2 at a front cell. Show u = U10/WRF, MC and FL. |
| 2 | **"Crown fire likely."** Flames can reach the treetops. Up there the fire feels the full wind, not the sheltered wind below the canopy. Expect 3–7 km/h and heavy spotting. | Mk 2: P3 > 0.5 and R2 ≥ 300 m/h. Rough rule: U10 above ~30 km/h when MC ≈ 6% and DF ≈ 10 (§3.5 table). |
| 3 | **"This block was burnt N years ago — it's slower here."** Less litter means the fire struggles to step up into the shrubs. | Cell time since fire < 7 yr **and** Olson surface load < 60% of steady state **and** the neighbouring long-unburnt cells are in phase 2 while this one is phase 1. |
| 4 | **"Fuel is bone dry."** At this humidity the fine litter is about X% moisture. Below 5–6% it ignites from almost any ember. | MC ≤ 6% (Vesta period model). A stronger card at MC ≤ 4%. |
| 5 | **"The drought has made the whole fuel bed available."** After weeks without rain, even the deeper litter and logs burn. | DF ≥ 8 (FA ≥ 0.95). The reverse card, "only the top litter will burn", at DF ≤ 5 (FA ≤ 0.5). |
| 6 | **"The wet gully is holding — for now."** Tall wet forest and rainforest keep their fuel damp until a long drought. | Fuel type is wet forest or rainforest with FA < 0.3 (KBDI below about 100 at WRF 5). The warning version: KBDI > 150, so FA > 0.9, meaning "the wet forest can burn today". |
| 7 | **"It's leaving the trees — expect it to speed up."** In open heath or grass the wind hits the flames 2–3× harder than under forest. | The front enters a cell whose WRF is ≤ 1.5 from one with WRF ≥ 3, or the model family changes from forest to grass/heath, with a predicted ROS ratio > 2. |
| 8 | **"Running uphill: speed doubles every 10°."** | θ_n ≥ 10° along the head direction. Show 2^(θ/10). A stronger card at ≥ 20° links to the doc 01 eruptive warning. |
| 9 | **"Backing downhill: slow but it keeps going."** Downhill it is still about half to two-thirds of the flat speed. It does not stop. | A back or flank segment with θ_n ≤ −10°. Kataburn factor 0.57–0.67. |
| 10 | **"The flank will become the head."** When the wind swings, this long side of the fire turns into a front many times wider. | The forecast or observed wind direction changes by ≥ 45° within 3 h with U10 ≥ 15 km/h [H]. Highlight the flank segments whose normals align with the new wind. |
| 11 | **"Ember storm: spot fires up to D km ahead."** Stringybark and ribbon bark shed burning strips that the wind carries. | Vesta spotting distance > 500 m, or bark FHS ≥ 3 with I > 1000 kW/m. |
| 12 | **"New spot fire: it will take 20–30 minutes to get up to speed — that is your window."** | A spot or point ignition whose age is < 30 min. Show accelFraction. |
| 13 | **"Too hot for direct attack."** Above ~4000 kW/m (flames roughly 3–6 m in forest) crews cannot work the head. | Head intensity ≥ 4000 kW/m. A card at ≥ 10 000 kW/m: "aircraft cannot hold it". |
| 14 | **"Green grass is slowing it."** Grass that is only half cured barely carries fire. | Grass or woodland cell with curing < 60% (φC < 0.35). The reverse card at > 85% curing. |
| 15 | **"This track probably won't hold."** | A track or break of width W on the predicted path with breach probability > 50% (§3.13). |
| 16 | **"Overnight the fuel dampens and the fire slows"**, or does not, on the thermal belt. | Period switches to night and MC rises by > 3 %-points. Contrast with doc 02's thermal-belt cells. |
| 17 | **"Today's rating: FBI X (High/Extreme…)"** — explained by the fuel type driving it. | FBI from §3.11 on the dominant fuel type near the user. |

Keep every card to one or two sentences, one number, and a link to "show me" (overlay the causal field: slope, WRF, MC, time since fire). Always add: "FireSim is a training aid, not an operational prediction."

---

## 6. Open questions and uncertainties

1. **Vesta Mk 2 primary text not read.** All Mk 2 coefficients are code transcriptions from two agreeing sources. Check against Cruz et al. (2021/2022):
   - the phase-3 mixing formula;
   - whether SF applies to phase 3;
   - that the FL input is surface + near-surface load;
   - the H_u equation;
   - validity ranges;
   - the wet-forest C2 slope/aspect term, which is not implemented anywhere.
2. **The shrubland model** has three variants: the FBI-TG Anderson form, the workbook exponents, and the refitted logistic form in PyroXL. The source of the operational refit is unknown.
3. **AFDRS grass FBI breakpoints** differ between FBI-TG (50/2000) and PyroXL (100/3000). This document uses FBI-TG v1.0 (2022). Later AFDRS versions may differ.
4. **Wilson (1988) breach coefficients**: the assignment of trees vs no trees is ambiguous between PyroXL and the AFDRS-RP text.
5. **Acceleration.** There is no Australian model. The FBP α = 0.115 min⁻¹ is a placeholder, and the time unit is ambiguous in cffdrs.
6. **OFHAG 4th edition** keys and indicative loads could not be read. The conversions shown come from the AFDRS and the Tolhurst workbook.
7. **NSW fuel table parameter `c`**: its meaning (post-fire residual vs additive) needs confirming against Watson (2012).
8. **Heat yield.** 18 600 kJ/kg is flagged in the FBI-TG as needing investigation for grass, shrub and forest.
9. **Slope above ~20–25°** is outside the empirical data. The CSIRO Spark example clamps at ±20° [S-code]. Doc 01 covers this.
10. **Wind double-counting in coupled use** (§4.2) is a design judgement. It should be tested against documented fire runs, for example the 2019–20 Blue Mountains fire progressions.

---

## 7. References

Primary and official documents (read this session unless marked [K]):
- Matthews, S. (2022) *Fire Behaviour Index Technical Guide*, v1.0. AFDRS. Copy read: https://github.com/Geoffysicist/PyroXL/blob/main/docs/fire-behaviour-index-technical-guide.pdf
- Matthews, S., Fox-Hughes, P., Grootemaat, S., Hollis, J.J., Kenny, B.J., Sauvage, S. (2019) *Australian Fire Danger Rating System: Research Prototype*. NSW RFS, Lidcombe. Copy read: https://github.com/Geoffysicist/PyroXL/blob/main/docs/afdrs_research_prototype_report_2019.pdf
- Arndt, J. (2018) *Calculating McArthur's FFDI and the KBDI* (technical note). https://github.com/subond/kbdi-ffdi/blob/master/ffdi_kbdi_technical_report.pdf

Model papers (equations cross-checked via the above and the code; bibliographic details [K]):
- Cruz, M.G., Cheney, N.P., Gould, J.S., McCaw, W.L., Kilinc, M., Sullivan, A.L. (2022) An empirical-based model for predicting the forward spread rate of wildfires in eucalypt forests. *IJWF* 31(1), 81–95. https://doi.org/10.1071/WF21068
- Cruz, M.G., Cheney, N.P., Gould, J.S., McCaw, W.L., Kilinc, M., Sullivan, A.L. (2021) *Vesta Mk 2 rate of fire spread model: a user's guide*. CSIRO Land and Water, Canberra. [K]
- Cheney, N.P., Gould, J.S., McCaw, W.L., Anderson, W.R. (2012) Predicting fire behaviour in dry eucalypt forest in southern Australia. *Forest Ecology and Management* 280, 120–131. https://doi.org/10.1016/j.foreco.2012.06.012
- Gould, J.S., McCaw, W.L., Cheney, N.P., Ellis, P.F., Knight, I.K., Sullivan, A.L. (2007) *Project Vesta: Fire in dry eucalypt forest: fuel structure, fuel dynamics and fire behaviour*. Ensis-CSIRO and DEC WA.
- Matthews, S., Gould, J., McCaw, L. (2010) Simple models for predicting dead fuel moisture in eucalyptus forests. *IJWF* 19(4), 459–467. https://doi.org/10.1071/WF09005
- Noble, I.R., Bary, G.A.V., Gill, A.M. (1980) McArthur's fire-danger meters expressed as equations. *Australian Journal of Ecology* 5, 201–203. https://doi.org/10.1111/j.1442-9993.1980.tb01243.x
- McArthur, A.G. (1966) *Weather and grassland fire behaviour*. Leaflet 100; (1967) *Fire behaviour in eucalypt forests*. Leaflet 107. Forestry and Timber Bureau, Canberra.
- Cheney, N.P., Gould, J.S., Catchpole, W.R. (1998) Prediction of fire spread in grasslands. *IJWF* 8(1), 1–13. https://doi.org/10.1071/WF9980001
- Cruz, M.G., Gould, J.S., Kidnie, S., Bessell, R., Nichols, D., Slijepcevic, A. (2015c) Effects of curing on grassfires II. *IJWF* 24(6), 838–848. https://doi.org/10.1071/WF14146
- Cheney, N.P., Sullivan, A. (2008) *Grassfires: fuel, weather and fire behaviour*, 2nd ed. CSIRO Publishing.
- Cheney, N.P., Gould, J.S. (1995) Fire growth in grassland fuels. *IJWF* 5(4), 237–247. https://doi.org/10.1071/WF9950237
- Anderson, W.R., Cruz, M.G., Fernandes, P.M., McCaw, L., Vega, J.A., Bradstock, R.A., et al. (2015) A generic, empirical-based model for predicting rate of fire spread in shrublands. *IJWF* 24(4), 443–460. https://doi.org/10.1071/WF14130
- Cruz, M.G., McCaw, W.L., Anderson, W.R., Gould, J.S. (2013) Fire behaviour modelling in semi-arid mallee-heath shrublands of southern Australia. *Environmental Modelling & Software* 40, 21–34. https://doi.org/10.1016/j.envsoft.2012.07.003
- Cruz, M.G., Gould, J.S., Alexander, M.E., Sullivan, A.L., McCaw, W.L., Matthews, S. (2015a) Empirical-based models for predicting head-fire rate of spread in Australian fuel types. *Australian Forestry* 78(3), 118–158. https://doi.org/10.1080/00049158.2015.1055063; and (2015b) *A Guide to Rate of Fire Spread Models for Australian Vegetation*. CSIRO & AFAC.
- Marsden-Smedley, J.B., Catchpole, W.R. (1995) Fire behaviour modelling in Tasmanian buttongrass moorlands II. *IJWF* 5(4), 215–228. https://doi.org/10.1071/WF9950215
- Marsden-Smedley, J.B., Rudman, T., Catchpole, W.R., Pyrke, A. (1999) Buttongrass moorland fire-behaviour prediction and management. *Tasforests* 11, 87–107.
- Sullivan, A.L., Sharples, J.J., Matthews, S., Plucinski, M.P. (2014) A downslope fire spread correction factor based on landscape-scale fire behaviour. *Environmental Modelling & Software* 62, 153–163. https://doi.org/10.1016/j.envsoft.2014.08.024
- Byram, G.M. (1959) Combustion of forest fuels. In Davis, K.P. (ed.) *Forest Fire: Control and Use*. McGraw-Hill, 61–89.
- Alexander, M.E. (1985) Estimating the length-to-breadth ratio of elliptical forest fire patterns. *Proc. 8th Conf. Fire and Forest Meteorology*, 287–304.
- Forestry Canada Fire Danger Group (1992) *Development and structure of the Canadian Forest Fire Behavior Prediction System*. ST-X-3.
- McAlpine, R.S., Wakimoto, R.H. (1991) The acceleration of fire from point source to equilibrium spread. *Forest Science* 37(5), 1314–1337.
- Keetch, J.J., Byram, G.M. (1968) *A drought index for forest fire control*. USDA FS Res. Pap. SE-38.
- Griffiths, D. (1999) Improved formula for the drought factor in McArthur's forest fire danger meter. *Australian Forestry* 62(2), 202–206.
- Finkele, K., Mills, G.A., Beard, G., Jones, D.A. (2006) National gridded drought factors… *Australian Meteorological Magazine* 55, 183–197.
- Purton, C.M. (1982) *Equations for the McArthur Mark 4 Grassland Fire Danger Meter*. BoM Meteorological Note 147.
- Hines, F., Tolhurst, K.G., Wilson, A.A.G., McCarthy, G.J. (2010) *Overall Fuel Hazard Assessment Guide*, 4th ed. Fire and Adaptive Management Report 82, DSE Victoria.
- Olson, J.S. (1963) Energy storage and the balance of producers and decomposers in ecological systems. *Ecology* 44, 322–331.
- Watson, P. (2012) *Fuel load dynamics in NSW vegetation. Part 1: forests and grassy woodlands*. Centre for Environmental Risk Management of Bushfires, University of Wollongong. [K]
- Wilson, A.A.G. (1988) Width of firebreak that is necessary to stop grass fires: some field experiments. *Canadian Journal of Forest Research* 18(6), 682–687. https://doi.org/10.1139/x88-104
- Sullivan, A.L., Cruz, M.G., Ellis, P.F.M., et al. (2013) *Fire development, transitions and suppression: final report*. CSIRO EP1312986.
- Hollis, J.J., Matthews, S., Fox-Hughes, P., et al. (2024) Introduction to the Australian Fire Danger Rating System. *IJWF* 33, WF23140. https://doi.org/10.1071/WF23140 [K]
- Tolhurst, K.G. (2007–2016) *Advanced Fire Behaviour Prediction Standard Workbook* (incl. Wind Reduction Factor Guide). University of Melbourne / NSW RFS.

Code read this session:
- PyroXL (VBA): https://github.com/Geoffysicist/PyroXL/tree/main/src/vba_scripts (`Vesta2.bas`, `AFDRS_forest.bas`, `AFDRS_grass.bas`, `AFDRS_heath.bas`, `AFDRS_General.bas`, `Mk5.bas`, `PyroXL_helpers.bas`)
- PyroPy2: https://github.com/Geoffysicist/PyroPy_2/blob/main/pyropy2/spread_model_vesta2.py; PyroPy: https://github.com/Geoffysicist/PyroPy/blob/main/src/pyropy/spreadmodels.py
- FireBehaviourCalcsR: https://github.com/sadassimov/FireBehaviourCalcsR (R/*.R, data-raw/nsw_fuel_types.csv, data-raw/build_data.R)
- CSIRO Spark model-library formulas via https://github.com/bran-jnw/wuinity (`SpreadModelAFDRS.cs`) and https://github.com/implex001/ARSandbox (`UCheneyFireSimComponent.cpp`)
- cffdrs_py: https://github.com/cffdrs/cffdrs_py (`rate_of_spread_at_time.py`, `length_to_breadth*.py`)
- firebehavioR (Mk 4 GFDI): https://github.com/EcoFire/firebehavioR/blob/master/R/fireIndex_function.R

---

## Appendix A. Test vectors (Python and TypeScript agree to the digits shown)

Defaults: WRF = 3, θ = 0.

| Case | Result |
|---|---|
| Vesta Mk 2: U10 30, MC 6, DF 10, FL 15, H_u 1.5 | R1 487, R2 1681, R3 2612 m/h; P2 1.000, P3 0.466; ROS 2114 m/h; phase 2 |
| Vesta Mk 2: U10 10, MC 8, DF 8, FL 15, H_u 1.0 | ROS 415 m/h; P2 0.981 |
| Vesta Mk 2: U10 40, MC 5, DF 10, FL 15, H_u 1.5 | ROS 3987 m/h; P3 0.992 |
| Vesta Mk 2 wet: U10 30, MC 8, DF 10, FL 18, H_u 1.5, WRF 5, KBDI 100 | C1 0.43; ROS 330 m/h |
| Vesta 2012: U10 30, FHS 3.5/3, H_ns 20 cm, MC 6, FA 1 | 1402 m/h |
| FFDI: T 35, RH 15, U 40, DF 10 | 61.4; Mk 5 at W 15: 1105 m/h, Z 16.0 m, S 3.70 km |
| Grass natural: U 10, MC 8, C 90 | 1854 m/h |
| Grass natural: U 30, MC 5, C 100 | 8205 m/h |
| Shrub: U 10, H 1.3, MC 10 | 761 m/h (adj 0.802) |
| Shrub: U 30, H 1.3, MC 6 | 3496 m/h |
| LB | forest(30) 3.84; grass(30) 5.33; ellipse at LB 3.84: flank 0.132, back 0.0176 |
| Byram | 1000 m/h × 10 t/ha = 5167 kW/m |
| FH Vesta | 1000 m/h, H_el 1.5 m: 7.96 m |
| Spot Vesta | 1000 m/h, U 40, FHSs 3.5: 1603 m |
| FBI | forest: 5000 kW/m → 28 (High); 15 000 kW/m → 62 (Extreme); 40 000 kW/m → 116 |
| DF | Noble (KBDI 100, N 2, R 20) = 5.43; Griffiths (SMD 100, 20 mm 2 days ago) = 4.24; Griffiths (SMD 100, no rain) = 9.5 |
| Moisture at T 30, RH 20 | forest period 1: 4.68%; Mk 5: 4.15%; shrub Δ = 1: 6.55% |
| Acceleration (α 0.115) | 10 / 20 / 30 min → 0.68 / 0.90 / 0.97 |
