# 05 — Fuel accumulation, fire history and vegetation in the NSW mountains

Scope: how much fuel is on the ground, in the shrubs and on the trees at a given place today; how that depends on vegetation type, time since fire, fire severity and fire frequency; where the data for NSW comes from; and how FireSim should turn it into per-cell fuel state and plain-language explanations.

---

## 0. Provenance and verification tags (read first)

**Research environment.** The sandbox egress proxy blocked the NSW Government hosts (`mapprod3.environment.nsw.gov.au`, `datasets.seed.nsw.gov.au`, `data.nsw.gov.au`). It also blocked CSIRO Publishing, ScienceDirect, Wiley, MDPI, the Victorian FFM site, UOW Research Online and Wikipedia. The shared web-search budget ran out after two searches. Evidence therefore comes from:

1. Search-engine extracts of the SEED dataset page and of Thomas et al. (2014).
2. Open-source code and data on GitHub that implement or consume the operational systems:
   - **NSW RFS PyroXL** (Geoffysicist/PyroXL). It embeds the **AFDRS national fuel look-up table (LUT)** and the **NSW fuel LUT v4.02** as worksheets. I downloaded the workbook `PyroXL_Operational_20250206.xlsm` and parsed every row.
   - Code that queries the NPWS Fire History and SVTM ArcGIS services (bolat-t/spatial-analytics, resuly/property-scores, mwhewins/ecoTools, TheKillerKangaroo/BushfireBurnout, gangerang/bushwalkers-topos, ben-gy/au-bushfires).
3. Full text of Cirulis et al. (2019/2020) and Penman et al. (2014), found as cleaned markdown on GitHub.
4. An NSW RFS Bush Fire Risk Management Plan (Lake George BFMC, 2018) that reproduces the NSW fire-interval thresholds table, found as OCR markdown on GitHub.
5. Established literature knowledge. This is tagged, so it can be checked before it is hard-coded.

| Tag | Meaning |
|---|---|
| **[S]** | Confirmed this session from source-derived text, operational data or an implementation. |
| **[K]** | Standard literature value or finding from domain knowledge, not re-verified this session. **Check the primary source before relying on it.** |
| **[H]** | FireSim design heuristic. No primary source gives this number; it must be tunable and shown as an assumption. |

No numbers were invented. Operational LUT values are reproduced as found. Different LUT versions disagree, and that is flagged where it matters.

### 0.1 Adversarial fact-check (second pass, 2026-09-27)

A second agent tried to refute every number, equation, URL and field name in this document. The same egress limits applied: NSW Government, CSIRO Publishing, Elsevier, Wiley, MDPI, DOI resolvers, OpenAlex/Crossref and Europe PMC were all blocked, and the session's web-search budget was already used up. So no journal PDF could be opened. Primary papers are still **[K]**. Everything below was re-derived **independently**:

- The PyroXL repository was re-cloned. `PyroXL_Operational_20250206.xlsm` was re-parsed with openpyxl (sheets `AFDRS Fuel LUT`, 470 rows, and `NSW_Fuel_v402_LUT`, 263 rows). Every VBA module (`AFDRS_forest.bas`, `AFDRS_General.bas`, `AFDRS_heath.bas`, `Vesta2.bas`, `ROS_heath_raw.bas`) was read, along with the workbook `Changelog`.
- Two more implementations were read for cross-checking: `Geoffysicist/PyroPy_2` (`spread_model_vesta2.py`) and the independent C# port in `bran-jnw/wuinity` (`…/AFDRS/FuelModels/Forest.cs`).
- NPWS service usage was checked in four codebases: bolat-t/spatial-analytics (README and ingest code), resuly/property-scores, uprez-net/propure-main (a full field list) and Zen-TM/logjam (licence and attribution string).
- SVTM usage was checked in mwhewins/ecoTools, TheKillerKangaroo/BushfireBurnout, gangerang/bushwalkers-topos, hcec-org-au/b2h and Zen-TM/logjam (the 5 m raster and its VAT).
- FESM class codes were checked in raei-2748/AUSSEF, which cites the FESM v3 factsheet, and in cardat.
- NVIS v7 details were checked in Ecosystem-Indicators-Workflows and lgruen/izzy-map.
- The text itself was re-read in: the Lake George BFMC BFRMP OCR (Table 3.3), the Cirulis et al. full text, and the Mt Jerrabomberra Bushfire Management Plan (2017) OCR.

**Corrections made in this pass** (each is also tagged in place):
1. **FHS in the pipeline (§5.1).** The operational tools take hazard scores from the LUT `FHS_*` maxima on the Olson curve, not from converting loads through `fl_to_fhs`. The PyroXL changelog of 2024-10-11 says so. The difference matters. For Sydney montane DSF, a near-surface load of 1.9 t/ha converts to FHS_ns = 1, but the LUT gives 2.9.
2. **Vesta Mk2 transcription (§3.4) was incomplete.** Added: dry-forest FA in Mk2 is logistic in DF, not DF/10; the Mk2 moisture function; understorey height h_u; phase-3 ROS; the P3 logit; the phase-weighting rule; the slope function; and the note that Mk2 "FL_s" means surface + near-surface.
3. **Wet-forest FA coefficient conflict resolved in favour of −0.0175.** Three implementations use it (PyroXL `AFDRS_forest.bas`, PyroPy_2, wuinity `Forest.cs`). Only `Vesta2.bas` has −0.175, and that value makes availability *fall* as KBDI rises. Still not checked against Cruz et al. (2022).
4. **Legacy FFDI label (§6).** FFDI ≥ 50 was "Severe" under the old NSW system, not "Extreme"; old Extreme was 75–99, and the Mt Jerrabomberra plan table confirms it. FBI ≥ 50 = Extreme under AFDRS [K].
5. **NPWS coverage (§1, §4.1).** Seasons actually run from **1902–03** to **2026–27** (bolat-t ingest, September 2026). The "1920–2025" range came from a stale SEED metadata extract. `FireType` has no coded-value domain; its codes live in the renderer. Five more fields are now listed.
6. **"Current treatment rates are well below 5 %"** refers to Cirulis et al.'s ACT and Tasmanian landscapes, not Sydney (§1).
7. **SVTM `vegClass` → LUT join.** It is a direct name match only for the DSF, WSF, grassy-woodland, subalpine and alpine herbfield/fjaeldmark classes. Rainforest (7 Keith classes), grassland and wetland classes also need mapping, as well as heath. Downgraded from [S] to [K].
8. **FESM codes.** 0 = unburnt, 1 = reserved (unused), 2 = low, 3 = moderate, 4 = high, 5 = extreme, 255 = NoData, per the FESM v3 factsheet as cited by a secondary source.
9. **NVIS v7** has 33 MVGs and 85 MVS, not "~31–33 / ~80–85".
10. **Unit trap in PyroXL.** `intensity()` and `Intensity_forest()` say ROS is in km/h, but the code divides by 3600 to get m/s, so it actually expects **m/h**. Also, the Mk1 moisture function jumps from 0.21 to 0.05 at FMC = 20 %.
11. **Spotting.** The Vesta spotting-distance formula takes the **surface** hazard score and ROS as inputs, **not bark hazard**, and wraps the result in `abs()`. The claim that bark drives spotting is physical and literature-based (Ellis 2011), but the operational distance formula does not encode it.
12. **Heath rows.** The heath model uses `WF_Heath` = 0.67, not the `WRF_For` value shown in Table 3.2.
13. Added **version disagreements in fuel heights.** The AFDRS national rows use H_el 1.3 m and H_ns 25 cm, where NSW v4.02 has 2 m and 20 cm. That changes flame height by e^{0.64·0.7} ≈ 1.6×.
14. Added mountain-specific content: the montane ash forest fuel-availability result, post-fire canopy opening letting in wind, the missing slope/aspect term (C2) in wet-forest FA, LiDAR fuel mapping, the drought-and-weather muting of gully refugia, and new insight cards F15–F18.
15. **Heath k in v4.02.** Rows 42–45 have `Fk_total` = 0, which gives zero heath load at every age if used as written. Take k from `Fk_s` or from AFDRS `Fk_total` (§3.2).
16. **Mt Jerrabomberra.** The 2009 and 2010 sites with Extreme and Very High elevated hazard were most likely *prescribed*-burn sites (§2.3). That strengthens the "hazard reduction can raise shrub hazard" lesson.
17. **"Load doesn't matter, structure does"** is a Vesta Mk1 simplification. Mk2 puts surface load back in (§2.1).
18. **Minor fixes:** the NSW `FL_b` upper bound is 5.0 (swamp forests), not 4.5; the Mk1 moisture reference is 7% FMC; Penman 2014a "19%" is a *reduction*; the BFRMP is a 2018 *draft*; and the attribution to Kenny et al. 2004 is [K].

---

## 1. Executive summary: what matters most for FireSim

1. **Fuel is layered, and each layer drives a different part of fire behaviour.** The Overall Fuel Hazard Assessment Guide (OFHG; Hines et al. 2010) defines five layers (the guide is cited by Cirulis et al. and used by the Mt Jerrabomberra plan; the PDF itself is UNVERIFIED because the host was blocked): surface litter, near-surface, elevated shrubs, bark and canopy. The layers do different jobs:
   - Surface and near-surface hazard drive **rate of spread** (Vesta/AFDRS forest model) (verified: PyroXL `ROS_forest`).
   - **Elevated fuel height drives flame height exponentially**: FH ∝ e^{0.64·H_el} [S].
   - **Bark drives spotting** physically [K: Ellis 2011]. The operational Vesta spotting-distance formula, however, takes surface FHS and ROS as inputs, not bark (verified: PyroXL `Spotting_forest`). FireSim's ember model must add bark explicitly (see doc 06).
   - Layers are added to fireline intensity as flames reach them: elevated fuel once flames exceed 1 m, half the canopy once flames exceed 0.66 × canopy height (verified: PyroXL `AFDRS_forest.bas` `Intensity_forest`, re-read 2026-09-27).
2. **Accumulation follows Olson (1963)** [S]: `X(t) = X_ss·(1 − e^{−k·t})`. There is one curve per layer and per fuel type. Operational NSW/AFDRS parameters exist for every Keith vegetation class (heath, rainforest, grassland and wetland classes are lumped) and are reproduced here (§3.1–§3.3). Surface litter reaches 95% of steady state in about 4 years (rainforest, k = 0.75/yr) to about 18–20 years (Sydney montane and tableland dry sclerophyll, k = 0.15–0.17/yr). Bark recovers slowest (k = 0.1/yr, about 30 years to 95%) [S].
3. **Recently burnt ground is not a fixed fuel reduction.** After high-severity fire, shrubby and seeder-dominated communities often regrow a dense near-surface and elevated layer within about 3–15 years. The ACT's post-2019–20 LUT fuel types ("2020_…") encode this [S]:
   - near-surface steady state ×4 and elevated ×2–3;
   - faster accumulation (k 0.4–0.5/yr);
   - *slower* surface-litter accumulation (k_s 0.10 vs 0.15, and 0.2 vs 0.3), consistent with less litterfall from a killed or scorched canopy;
   - near-zero bark recovery (k 0.02/yr);
   - a more open canopy (lower wind reduction factor).

   (verified: AFDRS LUT rows 1105/1106 and 1109/1110 re-parsed from `PyroXL_Operational_20250206.xlsm`)

   This is the most important nuance for 2026: much of the Blue Mountains, Wollemi, Budawangs and Kosciuszko burnt in 2019–20. The NSW total was about 5.5 Mha [S].
4. **Treatment benefits are real but short-lived and weather-limited** [S/K]. Prescribed-burn effects on unplanned fire lasted about 6 years in SW WA (Boer et al. 2009) [K]. In Sydney, treatment of 7–10% of the landscape is needed to halve risk to people and property (Bradstock et al. 2012, as reported by Cirulis et al.) [S]. In the ACT and Tasmanian study landscapes of Cirulis et al., current treatment rates are "well below 5%" [S]. (verified: Cirulis et al. full text, Discussion; corrected 2026-09-27, as the earlier text wrongly attached the <5% figure to Sydney) Under extreme weather the effect of fuel age on severity shrinks (Bradstock et al. 2010; Price & Bradstock 2012) [K]. A San Diego simulation study found the same pattern (Penman et al. 2014b) [S].
5. **Fire frequency changes the vegetation and hence the fuel.** NSW minimum and maximum tolerable fire intervals by Keith formation are verified (§3.5; Lake George BFRMP Table 3.3, re-read 2026-09-27):
   - Rainforest and Alpine complex: fire should be avoided.
   - Wet sclerophyll forest, shrubby: 25–60 yr.
   - Dry sclerophyll forest, shrubby: 7–30 yr.
   - Heath: 7–30 yr.

   Fires closer together than the minimum eliminate obligate seeders ("interval squeeze", e.g. alpine ash) and can switch forest to shrubland or grassland [K].
6. **Vegetation follows topography in the mountains, so fuel follows topography too** [K]:
   - Blue Mountains: sandstone ridge and plateau heath and dry sclerophyll forest, gully and gorge wet sclerophyll forest and rainforest, basalt-cap rainforest.
   - Snowy Mountains: montane ash forests, then subalpine snow gum woodland with frost-hollow grasslands, then alpine herbfield and heath.

   Wet gullies act as barriers only while fuel is unavailable. The AFDRS wet-forest availability function makes this quantitative: rainforest fuel availability is about 0.03 at KBDI 50 and about 0.9 at KBDI 150 (Drought Factor 10) (verified: recomputed from PyroXL `fuel_availability_forest`). **Montane wet sclerophyll (alpine ash, mountain gum; WRF 3.5) gets almost no such protection.** Its FA is ≈ 0.95 at DF 10 even at KBDI 25, so in the model it dries like dry forest. Only the rainforest and escarpment/tableland WSF types with WRF 4.5–5 act as drought-dependent barriers.
7. **Data exists and is queryable**:
   - **NPWS Fire History** ArcGIS service, layer 0, CC BY 4.0. It covers seasons from 1902–03 to the current season, 2026–27 as of September 2026. It is reportedly updated monthly (UNVERIFIED this pass). Its quirks are verified [S; range corrected 2026-09-27 from an independent full-table ingest].
   - **SVTM** PCT vector layer with `PCTID`, `PCTName`, `vegClass`, `vegForm` [S].
   - **FESM** severity classes [S].
   - **National Historical Bushfire Boundaries**, CC BY 4.0 [S].
   - **NVIS v7.0** (Nov 2024; 33 MVGs / 85 MVS; 100 m; CC BY 4.0) [S].
   - **SVTM as a statewide 5 m GeoTIFF**: `SVTM_NSW_Extant_PCT_vC2_0_M2_2_5m.tif`, about 2.3 GB, 1,687 PCTs, with a `.vat.dbf` carrying `vegForm` and related fields. This is the best source for pre-baking offline packs [S: used by Zen-TM/logjam and Zen-TM/vegform_classifier].

   The link from SVTM `vegClass` (Keith class) to NSW fuel type is a direct name match to the NSW v4.02 LUT for the dry and wet sclerophyll, grassy woodland, subalpine woodland and alpine herbfield/fjaeldmark classes. **Heath, rainforest, grassland and wetland classes need an explicit mapping**, because the LUT lumps them [K by comparing LUT names with Keith 2004 class names; corrected 2026-09-27].
8. **Design consequence.** Fuel state is a **per-scenario pre-computation** (milliseconds per cell), not a per-timestep cost. It must be pre-packaged for offline use: mountain sites often have no mobile data. It must also be user-editable through hazard ratings, which the app converts to loads.

---

## 2. Mechanisms, explained physically

### 2.1 Fuel layers and what each one does

The OFHG (Hines et al. 2010, 4th ed.) [S citation] is the NSW/Victorian field standard. Its layers, in PyroXL/AFDRS usage [S]:

| Layer | What it is | Main effect | Model variables |
|---|---|---|---|
| Surface | Litter (leaves, twigs < 6 mm, bark flakes) on the ground | Carries the flaming front; sets the base spread rate | `FL_s` (t/ha), `FHS_s` (0–4) |
| Near-surface | Grasses, low shrubs, suspended litter, typically < ~0.5 m [K] | Aeration and depth of the front; strongly affects ROS | `FL_ns`, `FHS_ns`, `H_ns` (cm) |
| Elevated | Shrubs and juvenile trees, typically to ~2–3 m (the council plan example says 2–3 m) [S/K] | Flame height, ladder to canopy, residence time | `FL_el`, `FHS_el`, `H_el` (m) |
| Bark | Loose bark on trunks and branches | Firebrand supply (spotting); vertical ladder ("wicks") | `FL_b`, bark hazard |
| Canopy (overstorey) | Crowns | Crown fire and intensity once involved | `FL_o`, `H_o` (m) |

Layer definitions: (UNVERIFIED against the OFHG PDF, which was blocked. The elevated "typically 2–3 m" is verified from the Mt Jerrabomberra Bushfire Management Plan (2017), which uses the OFHG method; the near-surface "< ~0.5 m" is [K].)

The fine-fuel definition used in NSW asset-protection guidance is "any dead or living vegetation < 6 mm diameter". The rule of thumb is **4 t/ha ≈ a 1 cm layer of leaf litter**. (verified: *Final South Jerrabomberra Bushfire Study*, QPRC, quoting the APZ standard: "4 t/ha is equivalent to a 1 cm thick layer of leaf litter and fine fuel means any dead or living vegetation of less than 6 mm in diameter".) That implies a litter bulk density of about 40 kg/m³ (0.4 kg/m² over 0.01 m), a useful default for converting user-entered litter depth to load [H]. Real eucalypt litter beds vary with compaction, so the depth-to-load conversion should be shown as approximate.

**Why the layers matter differently.** Project Vesta showed that forest spread rate depends on the *hazard scores and structure* of the surface and near-surface layers, not on total fuel load (Gould et al. 2007; McCaw et al. 2012) [K]. The AFDRS Mk1-form implementation makes this explicit: ROS uses `FHS_s` and `FHS_ns·H_ns` (§3.4) (verified: PyroXL `ROS_forest`). Note that **Vesta Mk2** (Cruz et al. 2021/2022) puts surface fine-fuel load back in explicitly, as (FL_s/10)^0.8 in phase 1 (§3.4) (verified: PyroXL `Vesta2.bas`). "Load doesn't matter, structure does" is therefore a Mk1-era simplification; both structure and load matter. Intensity then adds layers progressively as flames grow [S]:

```
fuel_load = FL_s(capped at 10 t/ha) + FL_ns
if flame_height > 1 m:            fuel_load += FL_el
if flame_height > 0.66 × H_o:     fuel_load += 0.5 × FL_o
(all loads first multiplied by fuel availability)
```

(verified: PyroXL `AFDRS_forest.bas` `Intensity_forest`, re-read 2026-09-27. The FA multiplication happens *before* the 10 t/ha surface cap. Primary AFDRS technical documentation was UNVERIFIED: not accessible.)

This gives an honest mechanical story for beginners: **"the fire got much hotter because the flames reached the shrubs, then the crowns."**

### 2.2 Why fuel accumulates the way it does (Olson model)

Litter mass X on the forest floor changes as

```
dX/dt = L − k·X
```

- L = litterfall input (t ha⁻¹ yr⁻¹).
- k = fractional decomposition rate (yr⁻¹).

After a fire leaves residue X₀, the solution is

```
X(t) = X_ss·(1 − e^{−k t}) + X₀·e^{−k t},    X_ss = L / k
```

(Olson 1963, *Ecology* 44: 322–331) [S citation]

The operational form assumes complete consumption (X₀ = 0) [S]:

```
X(t) = X_ss · (1 − e^{−k·t})
```

(verified: PyroXL `AFDRS_General.bas` `fuel_amount`: `Round(fuel_param_max * (1 - exp(-1 * tsf * k)), 1)`. Cirulis et al. confirm that PHOENIX also uses "a negative exponential growth function" per vegetation type (Watson 2011). Olson 1963 itself: UNVERIFIED, PDF blocked; the equation is standard.)

Derived quantities (verified: exact algebra of the Olson solution; −ln 0.05 = 2.996, −ln 0.5 = 0.693):

| Quantity | Formula | Notes |
|---|---|---|
| Time to fraction p of steady state | t_p = −ln(1 − p)/k | t₅₀ = 0.693/k; t₉₅ = 3.0/k |
| Equivalent fuel age for an observed load X | t_eq = −ln(1 − X/X_ss)/k | Valid for X < X_ss; use it when the user edits a load |
| Implied net litter input | L = k·X_ss | Physical sanity check (t ha⁻¹ yr⁻¹) |

**Physical interpretation for mountains** [K; the Thomas et al. result is S]:
- k is high where decomposition is fast: warm, moist gullies and rainforest (k = 0.75/yr). There litter never builds a deep bed, but canopy litterfall is high (L ≈ 6 t/ha/yr).
- On dry, nutrient-poor sandstone ridges decomposition is slow (k ≈ 0.17/yr). Litter keeps accumulating for about 18 years, to about 14.5 t/ha.
- Across SE Australian eucalypt forests, steady-state surface fine fuel falls with mean annual temperature. Rainfall has opposite effects by productivity: it raises steady state in low-productivity dry sclerophyll forest and grassy woodland, and lowers it in high-productivity wet sclerophyll forest and rainforest (Thomas et al. 2014) [S from abstract].
- Olson fits surface litter well. **Its suitability for elevated and bark fuels is "largly [sic] untested"** (Cirulis et al. 2019, citing Duff et al. 2012 and Dalgleish et al. 2015). (verified: Cirulis et al. full text, limitations paragraph. The same paragraph notes that PHOENIX reset fuel to its lowest value in every burn block, whereas real mild-weather burns leave a mosaic, citing Penman et al. 2007, Loschiavo et al. 2017 and McCarthy et al. 2017.)
- Thomas et al. (2014) climate result: UNVERIFIED this pass; it rests only on an abstract seen through a search extract.

### 2.3 Layer-by-layer recovery after fire, and the post-fire shrub pulse

Recovery rates in the NSW LUT for the mountain forest and woodland rows, with t₉₅ = 3/k (verified: re-parsed. Heath differs: tall heath k_s is 0.07, giving t₉₅ ≈ 43 yr, and short heath is 0.6):
- **Surface** recovers fastest (k 0.15–0.75/yr; t₉₅ ≈ 4–20 yr).
- **Near-surface** in NSW v4.02 shares the surface k.
- **Elevated** k 0.15–0.3/yr (t₉₅ 10–20 yr).
- **Bark** k 0.1/yr (t₉₅ ≈ 30 yr).

The single monotonic curve hides an important mountain behaviour:
- **Resprouters** (most eucalypts, many shrubs) recover canopy and understorey from epicormic buds and lignotubers.
- **Obligate seeders and fire-cued recruiters** germinate en masse after fire [K]. Examples: many *Acacia*, peas, *Banksia ericifolia*, alpine ash *E. delegatensis*, and in the Blue Mountains *E. oreades*. *Kunzea ericoides* (Burgan) belongs here too, though its strict seeder status is uncertain; it recruits prolifically after fire and after grazing is relaxed. They form **dense, even-aged thickets** that raise near-surface and elevated hazard for years before self-thinning [K].
  - NSW evidence [K, not re-verified]: Gordon et al. (2017) found *Acacia* shrub density and cover increased after *high-severity* wildfire, with direct implications for fuel hazard.
  - The CSIRO Australian Ecosystem Models Framework says that in sub-alpine resprouter eucalypt woodlands, "fire regulates the shrub-grass balance … with fire promoting rather than suppressing shrubs" (verified: CSIRO-enviro-informatics/ecosystems-models-framework `emf.jsonld`, "Eucalypt woodland" umbrella group).

A consultant assessment at Mt Jerrabomberra (southern tablelands, June 2017, Hines et al. 2010 method, 12 plots) observed this directly. Sites burnt in 2009 and 2010 recorded **Extreme and Very High** overall fuel hazard respectively, "due to the dominance of Burgan and Golden Wattle [*Acacia pycnantha*] in the elevated fuel layer". The plan records prescribed burns in 2009, 2010 and 2011, so these were most likely **prescribed-burn** sites. That makes the lesson sharper: a hazard-reduction burn can *raise* elevated hazard within about 7 years in shrub-seeder communities. (verified: *Bushfire Management Plan – Mount Jerrabomberra*, QPRC meeting attachment 11 Oct 2017, §4.2.2 and fuel-assessment text, OCR copy in nicolfamilyfarm/qprc-helper)

The ACT's AFDRS fuel types built after the 2019–20 fires quantify the effect. Compare, from the AFDRS LUT [S]:

| FTno | Type | FL_s / k_s | FL_ns / k_ns | FL_el / k_el | FL_b / k_b | WRF |
|---|---|---|---|---|---|---|
| 1105 | Tableland shrubby dry sclerophyll forest | 11 / 0.15 | 1 / 0.15 | 2.5 / 0.15 | 2.55 / 0.10 | 3 |
| 1106 | **2020_** Tableland shrubby DSF | 11 / 0.10 | **4 / 0.5** | **5 / 0.4** | 2.55 / **0.02** | **2** |
| 1109 | Subalpine woodlands | 9 / 0.3 | 1 / 0.3 | 1 / 0.2 | 1 / 0.10 | 2.5 |
| 1110 | **2020_** Subalpine woodlands | 9 / 0.2 | **4 / 0.5** | **3 / 0.5** | 1 / **0.02** | **1.5** |

(FL in t/ha, k in yr⁻¹, WRF = wind reduction factor. Verified: re-parsed from the `AFDRS Fuel LUT` sheet, 2026-09-27. Also unchanged between standard and "2020_" types: H_ns 18/18 cm and 25/25 cm; H_el 0.9/0.9 m and 1.3/1.3 m; FL_o 5.8/5.8 and 4.5/4.5 t/ha; FHS_s 2.8/2.8 and 2.6/2.6. The "2020_" types appear only in the AFDRS sheet, not in the NSW v4.02 sheet.)

Five years after fire in tableland shrubby DSF (1106 vs 1105; verified arithmetic), near-surface fuel is 3.7 t/ha in the post-fire type versus 0.5 t/ha in the standard type, and elevated fuel is 4.3 versus 1.3 t/ha. My reading of the "2020_" prefix as "post-2019–20 fire state" is an interpretation of the naming. The numbers themselves are [S].

The lower WRF encodes a physical effect: crown-killing fire opens the canopy, so more wind reaches the surface. In the AFDRS forest model the fuel-level wind is U = U10·3/WRF. Dropping WRF from 3 to 2 therefore raises the effective wind by **1.5×**, and from 2.5 to 1.5 by **1.67×**, at the same forecast wind. For a beginner this is a strong mountain lesson. On a ridge burnt in 2019–20, the regrowth is dense *and* the wind reaches it more easily than under an intact canopy. (Arithmetic from the verified PyroXL `ROS_forest` wind line.)

**Long-unburnt forests.** In several systems flammability peaks at intermediate time since fire and then declines as shrubs senesce and the canopy closes:
- Australian Alps (Zylstra 2018) [K].
- Mountain ash, where young regrowth burned more severely than older stands (Taylor, McCarthy & Lindenmayer 2014) [K].

FireSim should therefore **not** teach "older is always worse" for elevated fuel. That rule holds for surface litter up to steady state.

### 2.4 Bark hazard and species

Bark is the main source of firebrands:
- **Stringybarks** (fibrous, loosely attached bark) produce many, easily ignited, long-burning firebrands. Messmate stringybark's notoriety for intense short-to-medium-range spotting is explained by fuel-bed ignition potential and bark morphology (Ellis 2011) [K].
- **Ribbon and candle barks** shed long streamers that can loft and travel very far. Spotting of roughly 30 km+ was reported for the Kilmore East fire (Cruz et al. 2012) [K].
- **Smooth barks** contribute little.

The operational LUTs encode bark in `FL_b` and in a `Spotting` flag. The clearest contrast is in the South Australian LUT types [S]:

| FTno | Type | FL_b (t/ha) | k_b | WRF | Spotting flag |
|---|---|---|---|---|---|
| 5018 | Stringybark eucalypt over shrub | 5.0 | 0.14 | 4 | 1 |
| 5021 | Platy-bark eucalypt over shrub | 4.1 | 0.3 | 3 | 0 |
| 5019 | Smooth-bark eucalypt over shrub | 3.0 | 0.2 | 3 | 0 |

(verified: AFDRS LUT rows 5018/5019/5021 re-parsed. FHS_s also differs: 4.0 stringybark, 3.57 smooth, 3.41 platy. The NSW-sheet copy of 5018 gives FL_el 6, not 3.)

In the NSW v4.02 forest types, `FL_b` ranges from 0.6 (Sydney sand flats DSF) through 3.4 (South East DSF) and 4.5 (Northern escarpment WSF) to 5.0 (Swamp forests) t/ha. Most mountain forest types carry `Spotting = 1`; exceptions are Rainforests, Western slopes DSF and Sydney sand flats DSF (0). (verified: NSW v4.02 sheet re-parsed; the upper bound was corrected from 4.5 to 5.0.)

**Model caveat (verified: PyroXL `Spotting_forest`).** The Vesta spotting-distance equation in §3.4 has no bark term. Its inputs are ROS, U10 and FHS_s, and `Spotting` in the LUT is only a 0/1 flag. So the bark-type effects in this section are **FireSim's own addition** from the literature (Ellis 2011) and must go into the ember model (doc 06). They cannot be read off the AFDRS equations.

Species guide for defaults (UNVERIFIED: botanical bark classes from domain knowledge [K]; the stringybark, ribbon and smooth contrast is consistent with the SA LUT types above. The Mt Jerrabomberra survey found the greatest fuel loads in plots with Red Stringybark (*E. macrorhyncha*) and Burgan, with hazard varying with the density of stringybark and ribbon-shedding trees (verified: plan text, fuel-assessment section)):

| Bark group | Mountain species | Default bark hazard |
|---|---|---|
| Stringybarks | *E. macrorhyncha*, *E. eugenioides*, *E. agglomerata*, *E. globoidea*, *E. obliqua*, *E. caliginosa*, *E. laevopinea*, *E. blaxlandii* | Very High–Extreme |
| Ribbon/candle barks | *E. viminalis*, *E. rubida*, *E. dalrympleana* | Extreme for long range |
| Peppermints | *E. piperita*, *E. radiata*, *E. dives* | High |
| Ironbarks | *E. crebra*, *E. sideroxylon* | Low–Moderate |
| Smooth-barked gums | *E. rossii*, *E. sclerophylla*, *E. mannifera*, *E. pauciflora* (mostly), *Angophora costata*, *Corymbia maculata* | Low |
| "Ash" species | *E. sieberi*, *E. oreades*, *E. delegatensis* | Rough lower trunk, smooth upper; streamers in some |

Bark recovers slowly after fire: the LUT uses k_b = 0.1/yr, and 0.02/yr in the ACT post-2020 types [S]. Charred bark also sheds differently. Fire can reduce bark hazard for decades. The flip side is that a long-unburnt stringybark stand is a standing ember supply.

### 2.5 Prescribed burning, hazard reduction and back-burning

**What a low-intensity prescribed burn does** [K, qualitative]:
- It consumes most of the surface litter and much of the near-surface.
- It scorches or partly consumes elevated fuel.
- It chars bark.
- It rarely affects the canopy.

Scorched leaves can drop soon after the burn and partially re-supply the litter. **Burns are patchy**: coverage within the mapped block is often well under 100% (Penman et al. 2007, *FEM* 252: 24–32, "Patchiness of prescribed burns in dry sclerophyll eucalypt forests in south-eastern Australia") [S citation; values K].

The **mapped burn polygon is therefore an upper bound on treated area**. PHOENIX-based studies reset all fuel inside the block to its minimum, and Cirulis et al. list this explicitly as a limitation [S].

**How long the benefit lasts** (UNVERIFIED: none of these papers was accessible; figures [K] unless noted; the citation details match the Cirulis et al. reference list where they overlap):
- In SW WA, prescribed-fire effects on unplanned fire incidence and extent lasted about **6 years** (Boer et al. 2009, *FEM* 259: 132–142).
- In the Sydney sandstone region, the probability of fire spreading into recently burnt fuel was reduced only for a few years (Price & Bradstock 2010, *IJWF* 19: 35–45). Treat the exact duration as needing verification.
- In the 2009 Victorian fires, previous burns reduced crown fire and severity mainly when recent, with much weaker effects under extreme weather (Price & Bradstock 2012, *J. Environ. Manage.* 113: 146–157).

**Landscape leverage** (area of unplanned fire avoided per area treated) is low and varies strongly across south-eastern Australia (Price et al. 2015a, *J. Biogeogr.* 42: 2234–2245) [S citation; magnitudes K]. Verified quantitative anchors [S]:
- Sydney: treatment rates of **7–10% per year** were needed to halve risk to people and property (Bradstock et al. 2012).
- Sydney: 10% treatment concentrated in the WUI halved the risk of high-intensity fire reaching houses; the same rate applied as landscape burns gave only a **19% reduction** (Penman et al. 2014a, as reported by Cirulis et al.).
- ACT (mountain-edge case study): prescribed-burning rates of 1–10% cut expected area burnt by **12–54%**; Tasmania **2–19%**. A 50% risk reduction was "generally not possible". The exceptions were ACT area burnt (54%) and road damage (53%) at 10% treatment; Tasmanian house loss came close (49%). Easing fire weather by one FFDI category usually cut area burnt more than raising treatment from 0 to 10%. Weather "had a consistently greater effect than prescribed burning" (Cirulis et al. 2019/2020).
- In the same study, more burning increased the area burnt below minimum tolerable fire interval (Cirulis et al. 2019/2020).

(verified: all bullets in this list re-read in the Cirulis et al. full text, Results and Discussion, 2026-09-27. The Bradstock et al. 2012 and Penman et al. 2014a numbers are as *reported by* Cirulis et al.; the original papers are UNVERIFIED.)

**Back-burns** are suppression fires lit ahead of a wildfire. Physically they reset fuel exactly like any fire, at whatever intensity they reach. In the NPWS dataset only two fire types exist (Wildfire, Prescribed Burn) [S]. Back-burnt ground is most likely included within the final wildfire perimeter, but this is **not verified**. FireSim should let the user mark "back-burnt" areas manually.

### 2.6 Fire frequency and interval effects

Short intervals remove species that must reach reproductive maturity before the next fire. Long absences allow senescence of shrubs and fire-dependent species. NSW operationalises this as **fire interval thresholds by Keith formation** (§3.5; verified 2026-09-27 from the Lake George BFRMP draft, 2018, Table 3.3. The derivation from Kenny et al. 2004 is [K].)

Mechanisms and NSW mountain examples (UNVERIFIED: papers inaccessible [K]; Cirulis et al. (verified) show that more treatment raises the area burnt below minimum TFI, but they do not measure the resulting vegetation change):
- **Heath obligate seeders** (e.g. *Banksia ericifolia*) need a fire-free juvenile period of several years. Repeated fires at short intervals shift heath towards resprouters and sedges (Bradstock, Tozer & Keith 1997).
- **Alpine ash (*E. delegatensis*)** is killed by severe fire and regenerates from seed. It needs roughly two decades to produce seed. Repeated fires (2003, 2006–07 in Victoria, 2019–20) caused regeneration failure and conversion of forest to shrubland or grassland (Bowman et al. 2014; Fairman, Nitschke & Bennett 2016).
- **Blue Mountains ash (*E. oreades*)** has similar seeder biology.
- **Snow gum** woodland is top-killed by high-severity fire and resprouts from lignotubers. Post-fire shrub regrowth can raise flammability, and warming may strengthen the shrub–fire feedback (Camac et al. 2017). Long-unburnt snow gum stands can be less flammable (Zylstra 2013, 2018).
- **Alpine grazing does not reduce blazing** (Williams et al. 2006).
- Large fires are part of the historical Alpine fire regime, with long recovery times (Williams et al. 2008).

The fuel consequence is that **frequent fire can raise elevated-fuel hazard for decades**, the opposite of the intended hazard reduction. It can also convert forest to grassland: faster spread, lower intensity and a different fuel model.

### 2.7 Vegetation classification and how NSW maps vegetation to fuel

- **Keith (2004)**, *Ocean Shores to Desert Dunes*, classifies NSW vegetation into formations, sub-formations and **vegetation classes** [K]. There are 12 formations: rainforests, wet sclerophyll forests, grassy woodlands, grasslands, dry sclerophyll forests, heathlands, alpine complex, freshwater wetlands, forested wetlands, saline wetlands, semi-arid woodlands and arid shrublands. The formation list matches the §3.5 thresholds table and the 16 SVTM `vegForm` formation and sub-formation labels (verified: Zen-TM/logjam `SVTM_FORMATION_MU`).
- **SVTM** (State Vegetation Type Map) maps **Plant Community Types (PCTs)** statewide. It carries `PCTID`, `PCTName`, `vegClass` and `vegForm` attributes, with display layers derived from 5 m mapping. Version C2.0 M2.2 is distributed as a 5 m GeoTIFF with 1,687 distinct PCTs.
  - `vegForm` values are formation or sub-formation names that match the fire-threshold table (§3.5) almost one to one: "Rainforests", "Wet Sclerophyll Forests (Grassy sub-formation)", "Wet Sclerophyll Forests (Shrubby sub-formation)", "Dry Sclerophyll Forests (Shrub/grass sub-formation)", "Dry Sclerophyll Forests (Shrubby sub-formation)", "Grassy Woodlands", "Grasslands", "Heathlands", "Forested Wetlands", "Freshwater Wetlands", "Saline Wetlands", "Semi-arid Woodlands (Grassy/Shrubby sub-formation)", "Arid Shrublands (Acacia/Chenopod sub-formation)", "Alpine Complex" and "Not classified".
  - (verified: field names in mwhewins/ecoTools `main.R` and TheKillerKangaroo/BushfireBurnout; `vegForm` value list and raster details in Zen-TM/logjam `topo/build_svtm_formation.py`)
- **NSW RFS fuel LUT v4.02** is keyed by the Keith vegetation class name (FTno 1–76, e.g. 30 = "Sydney montane dry sclerophyll forests"). It maps each class to an AFDRS fuel type (Forest, Wet_forest, Woodland, Heath, Grass, …) and to a fire behaviour model (column `FBM`: Forest, Heath, Grass, Woodland, Mallee, Pine, Spinifex, …) (verified: NSW v4.02 sheet re-parsed).
  - **The join from SVTM `vegClass` to the NSW LUT is a case-insensitive name match for most forest and woodland classes** [K: comparison of LUT names with Keith 2004 class names; the full SVTM `vegClass` list was not retrieved].
  - It is **not** a direct match for several groups, which need a mapping (§4.2) [H]:
    - heath: the LUT has only "Tall heath", "Short heath" and "Montane & Alpine heath";
    - rainforest: Keith has 7 classes, the LUT has "Rainforests";
    - grasslands (e.g. Temperate Montane Grasslands) → "Native Grasslands";
    - freshwater wetlands (e.g. Montane Bogs and Fens) → "Freshwater wetlands";
    - forested wetlands → "Swamp forests" / "Floodplain forests".
- **AFDRS national LUT** NSW types (FTno 2xxx) are coarser, at formation or sub-formation level. Examples: 2105 Tableland shrubby DSF, 2114 Hinterland shrubby DSF, 2152 Shrubby WSF, 2154 Montane grassy WSF, 2109 Subalpine woodlands, 2603 Montane & Alpine heath, 2751 Alpine herbfields (verified: re-parsed). The first digit of FTno_State is the state: 1 ACT, 2 NSW, 3 Vic, 4 Qld, 5 SA, 6 WA, 7 Tas, 8 NT. (Verified by inspection of the names in each block: 6xxx = "Jarrah North East", 7xxx = "Buttongrass …", 8xxx = "Lancewood" and "gamba", 4xxx = Queensland regional-ecosystem style names. Row counts: 13 ACT, 45 NSW, 68, 121, 69, 58, 46 and 49.)
- **Australian Fuel Classification** (Cruz et al. 2018, *Fire* 1(1): 13; Hollis et al. 2015) is the hierarchical scheme behind AFDRS fuel types [K].
- **Version disagreement matters** (verified: both sheets re-parsed).
  - For "Subalpine woodlands", FL_s is 15 t/ha in the NSW v4.02 row but 9 t/ha in the ACT row (AFDRS sheet, 1109).
  - For "Tableland shrubby DSF", FL_s is 19 t/ha in the NSW 2105 row but 11 t/ha in the ACT 1105 row. The NSW sheet's own copy of 1105 carries 19.
  - **Fuel heights also differ.** AFDRS national NSW rows (2xxx) mostly use H_el = 1.3 m and H_ns = 25 cm. The matching NSW v4.02 Keith rows mostly use H_el = 2 m and H_ns = 20 cm (e.g. 2114 vs 24; 2151 vs 1; 2154 vs 10).
    - Through FH ∝ e^{0.64·H_el}, the difference changes predicted flame height by e^{0.64×0.7} ≈ **1.57×**.
    - H_ns > 20 cm is capped in ROS, so the H_ns difference matters less.

  These are expert-set values, not measurements. Treat them as ±30–50% uncertain [H], and let the user choose "LUT version" in developer settings.

### 2.8 Where vegetation (and therefore fuel) sits in mountain terrain

**Blue Mountains, Wollemi, Kanangra-Boyd and Budawangs (sandstone plateaux)** [K; Keith & Benson 1988; Keith 2004]:

| Landform | Vegetation (Keith class → NSW FTno) | Fuel character |
|---|---|---|
| Exposed plateau tops, cliff edges, shallow sandstone | Sydney montane heaths (→ heath types 42/43), mallee-heath | Continuous elevated fuel 1–3 m; fast, intense runs; recovers in about 5–15 yr |
| Plateau and ridge forest | Sydney montane DSF (30), Sydney hinterland DSF (24): *E. sieberi*, *E. piperita*, *E. sclerophylla*, *C. gummifera* | Heavy litter (X_ss 14.5 t/ha, k 0.17), elevated 4.9 t/ha, bark 2.7 t/ha |
| Poorly drained headwaters | Upland ("hanging") swamps, montane bogs and fens (→ freshwater wetlands 56) | Low load when wet; burns in drought; peat fires |
| Cliff-base talus, sheltered slopes | Tall moist forest (*E. deanei*, *E. oreades*): escarpment WSF (4/5) | High litter (17 t/ha) but moist; WRF 4.5 |
| Deep gorges and gullies | Warm temperate rainforest (coachwood, sassafras) → Rainforests (1) | Low surface load (8 t/ha), fast decay, WRF 5; barrier until drought |
| Basalt caps (Mt Wilson, Mt Tomah) | Cool/warm temperate rainforest, tall WSF | As above |
| Western escarpment valleys (shale/granite) | Grassy woodland and forest (38) | Grass-dominated; fast, low intensity |

**Snowy Mountains, Kosciuszko and Monaro** [K; Costin 1954; Williams et al. 2008]:

| Elevation band (approx.) | Vegetation → FTno | Fuel character |
|---|---|---|
| ~700–1100 m, tablelands | Southern tableland DSF (32), grassy woodland (38), stringybark/peppermint | X_ss 19 t/ha, k 0.15 (NSW row) |
| ~1000–1500 m, montane | Alpine ash, mountain gum, candlebark: Montane WSF (10), Southern tableland WSF (9) | Surface 24 t/ha, k 0.2; ribbon bark; obligate-seeder regrowth thickets after fire |
| ~1500–1850 m, subalpine | Snow gum woodland (39) with shrubby understorey; frost-hollow grassland (inverted treeline) | Surface 15 t/ha (NSW) or 9 (ACT); shrub pulse after fire |
| > ~1850 m, alpine | Alpine herbfields (46), heaths (44), fjaeldmark (45), bogs | Grass or heath models; "fire should be avoided" |

**Barrington Tops** [K]: basalt plateau (~1400–1580 m) with snow gum woodland, frost-hollow grassland and bogs. Escarpments carry Antarctic beech cool temperate rainforest and tall WSF.

**New England** [K]: New England DSF (17) and Northern tableland DSF (31) with New England stringybark; grassy woodlands (37); gorges with dry rainforest and gorge DSF.

**Warrumbungles** [K]: western slopes DSF (33) and grassy woodlands (40) with *Callitris*.

**Why this matters physically.** In mountains the fuel pattern and the fire-driving pattern are co-located:
- Ridges and north/west aspects carry the driest and most continuous fuels (heath, shrubby DSF) exactly where wind, sun and slope drive the fire hardest.
- Gullies carry wet forest that is moist and wind-sheltered until drought makes it available.

Fire-severity studies in the Sydney–Blue Mountains region found crown fire concentrated on ridges and upper slopes. Weather dominated over fuel age (Bradstock et al. 2010, *Landscape Ecol.* 25: 607–619), and severity varied by vegetation type (Hammill & Bradstock 2006, *IJWF* 15: 213–226) [K]. For 2019–20, drought and weather, not prior management, explained most of the extent and severity (Bowman et al. 2021; Collins et al. 2021) [K].

**Topographic refugia fail under severe weather** [K, not re-verified; Collins, Bennett, Leonard & Penman 2019, *Glob. Change Biol.* 25: 3829–3843]. In SE Australian forests, sheltered gullies, lower slopes and long-unburnt patches that normally escape high severity lost most of that protection under severe fire weather and drought. This is the empirical counterpart of the wet-forest FA curve in §3.4, and it is the core of insight card F9.

**Mountain-specific gap in the fuel-availability model** (verified: `Vesta2.bas` and PyroPy_2 both contain `C2 = 0 'TODO: implement slope/aspect effect'`). The Vesta Mk2 wet-forest availability has a slope and aspect term, **C2**, that neither public implementation fills in. The coefficients are UNVERIFIED because Cruz et al. 2021/2022 was not accessible. Until it is sourced, FireSim should carry aspect effects through the dead-fuel-moisture model (doc 04). It should *not* invent a C2.

---

## 3. Quantitative reference

### 3.1 Olson accumulation (per layer, per fuel type)

| Symbol | Meaning | Units | Range |
|---|---|---|---|
| X(t) | Fuel load of a layer at time since fire t | t ha⁻¹ (÷10 → kg m⁻²) | 0 – X_ss |
| X_ss | Steady-state (maximum) load | t ha⁻¹ | Surface 5–24; ns 0–7.6; el 0–13; bark 0–5 (NSW LUT) [S] |
| k | Accumulation constant | yr⁻¹ | 0.07–1.0 (NSW LUT) [S] |
| t | Time since fire (TSF) | yr | ≥ 0 |
| X₀ | Residue after fire | t ha⁻¹ | 0 (operational default) |

`X(t) = X_ss(1 − e^{−kt}) + X₀e^{−kt}` (Olson 1963).

The same curve is applied to **fuel hazard scores** in PyroXL: `FHS_s(t) = FHS_s,max·(1 − e^{−k_s t})` and `FHS_ns(t) = FHS_ns,max·(1 − e^{−k_ns t})`, using the LUT `FHS_s` and `FHS_ns` columns. Heights (H_ns, H_el, H_o) and WRF are taken from the LUT **unchanged with time since fire**. The LUT's `Hk_ns` column, which looks like an intended k for near-surface height, is not used.

(verified: `update_from_LUT_Forest` in `AFDRS_forest.bas`, and the workbook Changelog of 2024-10-11: "Surface and near surface hazard scored now calculated directly from Lut and time since fire".) Ranges verified from the re-parsed NSW v4.02 sheet. The surface range 5–24 applies to forest and woodland rows; heath and grass rows carry their load in `FL_total`.

### 3.2 NSW fuel LUT v4.02: mountain vegetation classes [S]

Steady-state loads in t/ha, k in yr⁻¹, t₉₅ = 3/k (years to 95% of surface steady state), heights H_ns in cm and H_el, H_o in m. Near-surface k equals surface k in v4.02.

| FTno | Keith class (NSW v4.02 "Fuel name") | AFDRS type | FL_s | k_s | t₉₅ | FL_ns | FL_el | k_el | FL_b | FL_o | H_ns | H_el | H_o | WRF | Spot |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Rainforests | Wet_forest | 8 | 0.75 | 4.0 | 1 | 1 | 0.30 | 1 | 8 | 20 | 2 | 40 | 5 | 0 |
| 4 | Northern escarpment WSF | Wet_forest | 17 | 0.35 | 8.6 | 2 | 3 | 0.15 | 4.5 | 6.9 | 20 | 2 | 60 | 4.5 | 1 |
| 5 | Southern escarpment WSF | Wet_forest | 17 | 0.35 | 8.6 | 2 | 3 | 0.15 | 4.0 | 6.9 | 20 | 2 | 60 | 4.5 | 1 |
| 8 | Northern tableland WSF | Wet_forest | 18 | 0.35 | 8.6 | 0 | 2 | 0.15 | 3.43 | 6.8 | 20 | 2 | 40 | 4.5 | 1 |
| 9 | Southern tableland WSF | Wet_forest | 18 | 0.35 | 8.6 | 0 | 2 | 0.15 | 2.0 | 6.8 | 20 | 2 | 35 | 3.5 | 1 |
| 10 | Montane WSF | Wet_forest | 24 | 0.20 | 15 | 0 | 2 | 0.15 | 2.6 | 8 | 20 | 2 | 35 | 3.5 | 1 |
| 16 | Central gorge DSF | Forest | 11 | 0.30 | 10 | 1 | 2 | 0.20 | 3.0 | 4.5 | 20 | 2 | 25 | 3 | 1 |
| 17 | New England DSF | Forest | 11 | 0.30 | 10 | 1 | 2 | 0.20 | 2.43 | 4.5 | 20 | 2 | 25 | 3 | 1 |
| 24 | Sydney hinterland DSF | Forest | 14.5 | 0.17 | 17.6 | 1.9 | 4.9 | 0.20 | 2.62 | 3.5 | 20 | 2 | 25 | 3.5 | 1 |
| 27 | South East DSF | Forest | 10 | 0.19 | 15.8 | 2 | 5 | 0.19 | 3.4 | 2.7 | 32 | 1.7 | 30 | 3.5 | 1 |
| 29 | Northern escarpment DSF | Forest | 14.5 | 0.17 | 17.6 | 1.9 | 4.9 | 0.20 | 3.25 | 3.5 | 20 | 2 | 20 | 3.5 | 1 |
| 30 | **Sydney montane DSF** (Blue Mtns) | Forest | 14.5 | 0.17 | 17.6 | 1.9 | 4.9 | 0.20 | 2.67 | 3.5 | 20 | 2 | 25 | 3.5 | 1 |
| 31 | Northern tableland DSF | Forest | 19 | 0.15 | 20 | 1 | 2.5 | 0.15 | 3.2 | 5.8 | 20 | 2 | 20 | 3 | 1 |
| 32 | Southern tableland DSF | Forest | 19 | 0.15 | 20 | 1 | 2.5 | 0.15 | 2.55 | 5.8 | 18 | 0.9 | 20 | 3 | 1 |
| 33 | Western slopes DSF (Warrumbungles) | Forest | 12 | 0.16 | 18.7 | 0.5 | 2.5 | 0.15 | 0.86 | 2.7 | 20 | 2 | 25 | 3 | 0 |
| 37 | New England grassy woodlands | Woodland | 8 | 0.40 | 7.5 | 2 | 0.5 | 0.20 | 3.3 | 4.5 | 20 | 2 | 25 | 2.5 | 1 |
| 38 | Southern tableland grassy woodlands | Woodland | 8 | 0.40 | 7.5 | 2 | 0.5 | 0.20 | 2.11 | 4.5 | 20 | 2 | 30 | 2.5 | 1 |
| 39 | **Subalpine woodlands** (snow gum) | Forest | 15 | 0.30 | 10 | 1 | 2 | 0.20 | 1.0 | 6.8 | 20 | 2 | 15 | 2.5 | 1 |
| 42 | Tall heath | Heath | 22.2 (total 36.9, k 0.07*) | 0.07 | 43 | 1.7 | 13 | 0.15 | 0 | 0 | – | 4* | – | 2 | – |
| 43 | Short heath | Heath | total 11.8, k 0.6 | | 5 | | 6 | 0.6 | | | | 1.5* | | 1.5 | – |
| 44 | Montane & Alpine heath | Heath | total 12.6, k 0.1 | | 30 | | 6 | 0.25 | | | | 1* | | 1.5 | – |
| 45 | Alpine fjaeldmarks | Heath | total 2.6, k 0.15 | | 20 | | | | | | | 0.25* | | 1 | – |
| 46 | Alpine herbfields | Low_wetland (grass model) | total 5.8, k 0.2 | | 15 | | | | | | | | | 1 | – |
| 56 | Freshwater wetlands | Low_wetland | total 2.6, k 0.7 | | 4.3 | | | | | | | | | 1.2 | – |
| 58 | Native grasslands | Grass | total 5.1, k 0.9 | | 3.3 | | | | | | | | | 1.2 | – |

\*Heath H_el and total-load k are taken from the equivalent AFDRS NSW rows 2601–2604, 2751 and 2752. In the v4.02 rows 42–46, `Fk_total` = 0 and the heath k is carried in `Fk_s`.

**Table verification** (verified: every cell in the rows above re-parsed from `NSW_Fuel_v402_LUT` in `PyroXL_Operational_20250206.xlsm` on 2026-09-27 and matched; FHS_s/FHS_ns/FHS_el maxima for the forest rows are listed in §3.3).

**Notes** (verified):
- The heath model in PyroXL uses `FL_total` with `Fk_total`, via `update_from_LUT_Heath`.
  - Because v4.02 rows 42–45 have `Fk_total = 0`, running PyroXL in "NSWv402" mode would give `fuel_amount(FL_total, tsf, 0) = 0`, i.e. **zero heath load at every age**. This is a data-entry gap in the NSW sheet.
  - FireSim must take heath k from `Fk_s` (v4.02) or `Fk_total` (AFDRS 2601–2604).
- **The heath spread model uses `WF_Heath` = 0.67, not the `WRF` column shown above.** U2 = U10 × 0.67 for open heath. The raw Anderson form uses 0.35 under a woodland overstorey. `WRF_For` in heath rows is only used if a forest model is run on them.
- 14 `Hk_ns` entries in the NSW sheet are corrupted (3.3, 6.3, 12.3, 13.3, 16.3, 18.3, 21.3, 25.3, 26.3, 36.3, 38.3, 39.3, 40.3, 42.3). They sit in the copied national rows 1105, 1109, 1152, 1153, 1162, 1200, 1303, 1350, 1360, 1752, 1810, 1820, 1900 and 1950, and look like an Excel auto-fill artefact. All other rows carry 0.3. **Do not use `Hk_ns`.**
- Heath FL_total values are *total* fine fuel.

**Implied net litter input L = k·X_ss** (verified arithmetic from re-parsed LUT values): Rainforests 6.0; escarpment WSF 5.9; Montane WSF 4.8; Subalpine woodland 4.5; Sydney montane DSF 2.5; Southern tableland DSF 2.9 t ha⁻¹ yr⁻¹. These are within the broad range reported for eucalypt litterfall (Birk & Simpson 1980; Walker 1981) [K].

**Worked example (Sydney montane DSF, surface)**: X(2) = 4.2, X(5) = 8.3, X(10) = 11.9, X(20) = 14.0 t/ha (verified arithmetic: 14.5·(1−e^{−0.17t})). A 2019–20 burn surveyed in late 2026 (t ≈ 6.8 yr) is at about 69% of steady state.

### 3.3 Load ↔ Vesta fuel hazard score (FHS)

From PyroXL `fl_to_fhs` [S]. FHS 1 = Low, 2 = Moderate, 3 = High, 3.5 = Very High, 4 = Extreme [K for the label mapping].

| Layer | FHS 1 | FHS 2 | FHS 3 | FHS 3.5 | FHS 4 |
|---|---|---|---|---|---|
| Surface (t/ha) | ≤ 4 | ≤ 9 | ≤ 13 | ≤ 18 | > 18 |
| Near-surface | ≤ 2 | ≤ 3 | ≤ 4 | ≤ 6 | > 6 |
| Elevated | ≤ 1 | ≤ 2 | ≤ 3 | ≤ 5 | > 5 |
| Bark (FHS 0/1/2/3/4) | 0 | ≤ 1 | ≤ 2 | ≤ 5 | > 5 |

(verified: `fl_to_fhs` in `AFDRS_General.bas` re-read. The class boundaries are inclusive upper bounds. For bark the columns mean FHS 0/1/2/3/4, not 1/2/3/3.5/4.)

For the inverse (user picks a hazard rating), use the class midpoint. For example, surface "High" → 11 t/ha [H].

**Do not use `fl_to_fhs` to drive the spread model from LUT loads** (verified: correction 2026-09-27). The operational workflow takes FHS from the LUT maxima on the Olson curve (§3.1), and the two routes disagree strongly for near-surface fuel. Steady-state FHS maxima in NSW v4.02 (FHS_s / FHS_ns / FHS_el):

| FTno | Type | FHS_s | FHS_ns | FHS_el | FHS_ns from `fl_to_fhs(FL_ns)` |
|---|---|---|---|---|---|
| 1 | Rainforests | 2.8 | 2.4 | 2.6 | 1 (FL_ns 1) |
| 4 / 5 | Escarpment WSF | 3.7 | 3.0 | 3.1 | 1 (FL_ns 2) |
| 10 | Montane WSF | 4.0 | 3.0 | 2.8 | 1 (FL_ns 0) |
| 24 / 30 | Sydney hinterland / montane DSF | 3.4 | 2.9 | 3.3 | 1 (FL_ns 1.9) |
| 31 | Northern tableland DSF | 3.6 | 3.0 | 3.0 | 1 |
| 32 | Southern tableland DSF | 2.8 | 2.8 | 2.0 | 1 |
| 39 | Subalpine woodlands | 3.3 | 2.8 | 2.8 | 1 |
| 37 / 38 | Tableland grassy woodlands | 3.0 | 2.6 | 2.2 | 1 |

In the Vesta Mk1 ROS the term is (FHS_ns·H_ns)^0.6366. Using FHS_ns = 1 instead of 2.9 would under-predict ROS by (2.9)^0.6366 ≈ **1.97×**. Use `fl_to_fhs` only to convert a *user-entered load* into a score. When the user enters an OFHG rating directly, use the rating.

### 3.4 Where fuel enters the spread and intensity equations

These equations are transcribed from PyroXL, which was re-read line by line on 2026-09-27. They were cross-checked where possible against PyroPy_2 (the same author, NSW RFS) and against wuinity `Forest.cs` (an independent C# port). **None has been checked against the primary papers**, which were inaccessible: Cheney et al. 2012 and Gould et al. 2007 (Vesta Mk1), Cruz et al. 2021/2022 (Mk2), Anderson et al. 2015 (heath) and the AFDRS technical guide / Hollis et al. 2024. Treat them as "operational-implementation verified, primary UNVERIFIED".

**AFDRS forest (dry and wet), Vesta Mk1 form** (verified: PyroXL `ROS_forest`, `Mf_forest`; wuinity `Forest.cs` has the same structure; primary source Cheney et al. 2012 UNVERIFIED):

```
U  = U10 · 3 / WAF                           (km/h; WAF 2.5–5 in LUT forest rows; Vesta reference WAF = 3)
R0 = 30 + 1.5308 · (U − 5)^0.8576 · FHS_s^0.9301 · (FHS_ns · H_ns)^0.6366 · 1.03    if U > 5
R0 = 30                                      otherwise
R  = R0 · Mf(FMC)                            (m/h)
```

- U10 is the 10 m open wind in km/h. WAF (= WRF) is dimensionless; LUT values run 2.5–5 for forest types.
- FHS_s and FHS_ns are first multiplied by fuel availability FA. FHS values are 0–4.
- H_ns is in cm, capped at 20.
- Mf = 18.35·FMC^−1.495 for 4 < FMC ≤ 20%. Mf = 2.31 for FMC ≤ 4%, and 0.05 for FMC > 20%. FMC is dead fine fuel moisture in %.
  - Mf(7%) = 1.00, so R0 is the ROS at 7% FMC; the code comment says "calculate ROS for 7% moisture".
  - **There is a discontinuity at 20%.** The power law gives Mf(20) = 0.21, but values above 20% jump to 0.05. FireSim should smooth this, e.g. with a linear taper from 0.21 at 20% to 0.05 at 24% [H], so the fire does not "switch off" abruptly in the app.
- The Mk1 ROS has **no explicit fuel-load term.** Fuel enters only through hazard scores and near-surface height, which is Vesta's central finding. Slope is applied separately; see doc 01.

**Flame height** (verified: PyroXL `Flame_height_forest`; primary UNVERIFIED): `FH = 0.0193 · R^0.723 · e^{0.64·H_el} · 1.07` (m; R in m/h, H_el in m).

The elevated factor e^{0.64 H_el} is 1.9 at 1 m, 3.6 at 2 m, 6.8 at 3 m and 12.9 at 4 m (verified arithmetic). This is the quantitative reason post-fire thickets matter.

**Byram intensity** (verified: PyroXL `intensity`): `I = 18600 · w · R` (kW/m; w in kg/m², R in m/s; 18,600 kJ/kg is the heat yield). w follows the layered accumulation of §2.1.

**Unit trap:** the PyroXL docstrings for `intensity()` and `Intensity_forest()` say ROS is in km/h, but the code does `ROS = ROS / 3600 'm/s`, so it really expects **m/h**. In FireSim, keep ROS internally in m/s and convert once.

**Vesta Mk2** (Cruz et al. 2021 user guide, eq. numbers as cited in code; journal version Cruz et al. 2022). (verified: PyroXL `Vesta2.bas` and PyroPy_2 `spread_model_vesta2.py` agree; primary UNVERIFIED.) Surface fuel load enters explicitly. Wind and moisture:
- `u = U10 / WAF` (km/h).
- Moisture function `Mf = 0.9082 + 0.1206·M − 0.03106·M² + 0.001853·M³ − 0.00003467·M⁴` for 4.1 < M ≤ 24%. Mf = 1 for M ≤ 4.1 and 0 for M > 24.
- `φ = Mf·FA`.

Fuel availability in Mk2 is **logistic in DF for dry forest too**, not DF/10: `FA = 1.008 / (1 + 104.9·exp(−0.9306·DF))`. This gives 0.14 at DF 3, 0.50 at DF 5, 0.87 at DF 7 and 1.00 at DF 10. For wet forest, PyroPy_2 replaces DF with `DF_eff = clip(DF·max(C1raw, 0)/10, 0, 10)`. Here C1raw is the bracketed term of the AFDRS C1 below, *before* its 0.1 factor. This equals C1·DF in the AFDRS form, except that AFDRS clamps C1 ≤ 1 while PyroPy_2 clips DF_eff ≤ 10.

Rate of spread by phase (m/h):
- `R1 = 1000·(0.03 + 0.05024·(u−1)^0.92628·(FL_s/10)^0.79928)·φ·SF` for u > 2; `R1 = 1000·0.03·φ·SF` otherwise.
- `R2 = 1000·0.19591·u^0.8257·(FL_s/10)^0.4672·h_u^0.495·φ·SF`.
- `R3 = 1000·0.05235·U10^1.19128·φ`. This uses open U10, not u, and PyroPy_2 applies no slope factor to phase 3.

Understorey height: `h_u = −0.1 + 0.06·FHS_el + 0.48·H_el` (m; "Cruz 2021 eq 1", PyroPy_2).

Phase probabilities and weighting:
- Phase-2 logit `g2 = −23.9315 + 1.7033·u + 12.0822·φ + 0.95236·FL_s`, P2 = 1/(1+e^{−g2}); P2 = 0 if FL_s < 1 t/ha.
- Phase-3 logit `g3 = −32.3074 + 0.2951·U10 + 26.8734·φ`; P3 = 0 if R2 < 300 m/h.
- Weighting: if P2 < 0.5, `R = R1(1−P2) + R2·P2`. Otherwise `R = R1(1−P2) + R2·P2(1−P3) + R3·P3`.

Slope factor: `SF = 2^{θ/10}` for upslope θ > 0 (degrees). For downslope θ < 0, `SF = 2^{−θ/10} / (2·2^{−θ/10} − 1)`. This is the McArthur doubling-per-10° rule, with the Sullivan et al. (2014) downslope refinement as cited in code. It gives 0.67 at −10° and 0.57 at −20°, tending to 0.5.

**Definition trap:** in PyroPy_2 the Mk2 argument `fuel_load_surface` is documented as "**surface + near-surface** fuel load t/ha". So Mk2 FL_s = FL_s + FL_ns of the LUT, not FL_s alone. UNVERIFIED against Cruz et al.; confirm before use.

**Fuel availability FA** (verified: implementations as named):
- Dry forest, AFDRS Mk1 form: FA = DF/10 (PyroXL `fuel_availability_forest`).
- Dry forest, Mk2 form: logistic, as above.
- Wet forest, AFDRS form (PyroXL `AFDRS_forest.bas`; identical in wuinity `Forest.cs`; PyroPy_2 uses the same C1 inside the logistic):

```
C1 = clamp01( 0.1·[ (0.0046·WAF² − 0.0079·WAF − 0.0175)·KBDI + (−0.9167·WAF² + 1.5833·WAF + 13.5) ] )
FA = min( 1.008 / (1 + 104.9·exp(−0.9306·C1·DF)),  DF/10 )
```

The `Vesta2.bas` module in the same repository writes −0.175 instead of −0.0175. With −0.175 the KBDI coefficient turns **negative** (−0.117 per KBDI unit at WAF 4.5), so wet forest becomes unavailable for KBDI > ~18 and gets *less* available as drought deepens. That is physically backwards. Three implementations (PyroXL `AFDRS_forest.bas`, PyroPy_2, wuinity) use −0.0175, so **−0.0175 is adopted** (verified: cross-implementation, 2026-09-27; primary Cruz et al. 2022 / AFDRS guide still UNVERIFIED).

Units: KBDI in mm (0–200); DF 0–10; WAF dimensionless (3–5). The code clamps C1 to [0, 1]. The final `min(…, DF/10)` stops wet forest ever exceeding dry-forest availability ("shouldn't get higher ros for wet when WAF is low").

Computed wet-forest FA at DF 10 (verified: recomputed independently, 2026-09-27):

| WAF (type) | KBDI 25 | 50 | 100 | 150 | 200 |
|---|---|---|---|---|---|
| 3.5 (montane WSF) | 0.95 | 0.97 | 0.98 | 0.99 | 1.00 |
| 4.5 (escarpment and tableland WSF) | 0.14 | 0.30 | 0.74 | 0.95 | 1.00 |
| 5.0 (rainforest) | 0.01 | 0.03 | 0.35 | 0.89 | 1.00 |

At DF 6, the WAF 4.5 row is 0.05 / 0.09 / 0.22 / 0.47 / 0.60. At DF 8: the WAF 5 row is 0.03 / 0.19 / 0.67 / 0.80 at KBDI 50 / 100 / 150 / 200, and the WAF 4.5 row is 0.17 / 0.47 / 0.80 / 0.80 at the same KBDI values (verified arithmetic).

**Reading the table for mountains.** WAF 3.5 (Montane WSF: alpine ash and mountain gum; Southern tableland WSF) sits on the DF/10 ceiling at almost any KBDI. In the operational model, these tall montane forests are *not* moisture-protected the way rainforest gullies are. This matches the 2003, 2006–07 and 2019–20 alpine-ash fire history, in which repeated crown fires hit these forests [K].

**Heath (AFDRS form, after Anderson et al. 2015)** (verified: PyroXL `AFDRS_heath.bas`; primary UNVERIFIED):
- `U2 = U10 · WF_Heath` (km/h; WF_Heath = 0.67 in all NSW heath rows).
- Spread index (go/no-go probability): `SI = logistic(2.5790 + 0.17561·U2 + 0.75245·H_el + 0.14917·H_el·U2 − 0.43073·MC)`, with MC in %.
- `ROS = SI · exp(3.34696 + 0.58866·√U2 − 0.78855·ln(m/(1−m)) + 0.41499·ln(H_el))` (m/h), where m = MC/100. The code comment gives the range 0–6000 m/h.
- Raw Anderson et al. (2015) power law, kept in `ROS_heath_raw`: `R = 5.6715·(wrf·U10)^0.912·H_el^0.227·exp(−0.0762·MC)·60` (m/h). Here wrf = 0.667 for open heath and 0.35 under a woodland overstorey, and MC is capped to [4, 20] with Mf = 0.05 above 20%.
- Heath moisture (Cruz et al. 2010 mallee-heath, plus the Marsden-Smedley rain term): `MC = 4.37 + 0.161·RH − 0.1·(T − 25) − [0.027·RH if RH ≤ 60] + 67.128·(1 − e^{−3.132·rain48h})·e^{−0.0858·hours_since_rain}`.
- Intensity uses the Olson-accumulated heath total load: `I = 18600·(FL/10)·(R/3600)`.
- Flame height, borrowed from the mallee-heath model of Cruz et al. 2013: `FH = e^{−4.142}·I^0.633` (m; I in kW/m).

**Vesta spotting distance** (verified: PyroXL `Spotting_forest`; primary Gould et al. 2007 UNVERIFIED):
- If R < 150 m/h: 50 m.
- Otherwise: `|176.969·atan(FHS_s)·(R/U10^0.25)^0.5 + 1568800·FHS_s^−1·(R/U10^0.25)^−1.5 − 3015.09|` (m). R is in m/h, U10 in km/h, and FHS_s is the **surface** hazard score.
- Caveats:
  - The `abs()` hides negative raw values at low R/U^0.25. For example, R = 150 m/h, U10 = 10 km/h and FHS_s = 3.5 give a raw value of about −336 m, reported as +336 m.
  - Near that threshold, cap the result at the 50 m floor instead of trusting `abs()` [H].
  - Sanity check: R = 1000 m/h, U10 = 40, FHS_s = 3.5 gives ≈ 1.6 km.
  - Bark hazard is **not** an input; see §2.4.

### 3.5 NSW fire interval thresholds by formation [S]

Source: Lake George BFMC *Bush Fire Risk Management Plan*, **draft for public exhibition** (PDF dated 23 March 2018; comments closed 7 May 2018), §3.4, Table 3.3 "Fire Thresholds for Vegetation Categories". (verified: every value and note re-read in the OCR copy, 2026-09-27.)

- The attribution to Kenny et al. (2004) is [K]. The BFRMP text does not cite it.
- The "2006 SFAZ table gives minimum 7" note for freshwater wetlands is UNVERIFIED this pass.
- Rows not shown are all outside FireSim's mountain scope: Saline wetlands and Arid chenopod shrublands ("fire should be avoided"); Semi-arid woodlands grassy 6/9/no max and shrubby 10/15/no max; Arid acacia 10/15/no max.
- Full notes, verbatim in substance:
  - Grassy woodland: "Occasional intervals greater than 15 years may be desirable."
  - Grassland: "Occasional intervals greater than 7 years should be included in coastal areas".
  - Freshwater wetlands: "Occasional intervals greater than 30 years may be desirable."
  - Forested wetlands: "Some intervals greater than 20 years may be desirable."
- **Mapping to SVTM:** the formation names match SVTM `vegForm` values one to one (§2.7), so TFI lookup needs no hand mapping.

| Formation | Min (SFAZ) | Min (LMZ) | Max | Note |
|---|---|---|---|---|
| Rainforest | – | – | – | Fire should be avoided |
| Alpine complex | – | – | – | Fire should be avoided |
| Wet sclerophyll forest, shrubby | 25 | 30 | 60 | Avoid crown fire at the lower end of the range |
| Wet sclerophyll forest, grassy | 10 | 15 | 50 | Avoid crown fire at the lower end of the range |
| Grassy woodland | 5 | 8 | 40 | Minimum 10 yr in southern tablelands |
| Grassland | 2 | 3 | 10 | – |
| Dry sclerophyll forest, shrub/grass | 5 | 8 | 50 | Occasional intervals > 25 yr desirable |
| Dry sclerophyll forest, shrubby | 7 | 10 | 30 | Occasional intervals > 25 yr desirable |
| Heathlands | 7 | 10 | 30 | Occasional intervals > 20 yr desirable |
| Freshwater wetlands | 6 | 10 | 35 | The 2006 SFAZ table gives minimum 7 |
| Forested wetlands | 7 | 10 | 35 | – |

(SFAZ = strategic fire advantage zone; LMZ = land management zone)

---

## 4. Data sources and access (verified details)

### 4.1 NPWS Fire History – Wildfires and Prescribed Burns

- **Service**: `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/NPWS_Fire_History/MapServer/0` [S; used by several independent codebases].
- **Content**: final fire boundaries for every year with data. `FireType` is a **coded integer with no coded-value domain on the field**; the codes live in the layer's renderer: **1 = Wildfire, 2 = Prescribed Burn**. (verified: bolat-t/spatial-analytics README and `config.py`; corrected from "subtype field".)
  - Polygons are mutually exclusive within each year and often extend outside NPWS estate.
  - RFS and Forestry Corporation data are sometimes imported (UNVERIFIED this pass: SEED page blocked; from an earlier search extract).
  - **Coverage.** The seasons decoded from a full-table ingest run from **1902–03** to **2026–27** (bolat-t/spatial-analytics web map range 1902–2026, repository committed 15 Sep 2026). An earlier SEED metadata extract said 1920-01-01 to 2025-04-30, which is stale.
  - Updated monthly (UNVERIFIED this pass).
  - **Licence CC BY 4.0**, with required attribution "© State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2010" (verified: Zen-TM/logjam `build_fire_history.py` and `topo/README.md`).
- **Fields**:
  - Core, used by an ingest (verified: bolat-t `ingest_fire.py` `FIELDS`): `OBJECTID, FireType, FireName, FireNo, FireYear, Label, StartDate, EndDate, Intensity, AreaHa, NPWSBranch, NPWSArea`.
  - Additional fields exist on the layer (verified: field list in uprez-net/propure-main `apps/web/lib/map/layers.ts`): `PerimeterM`, `OFHObjMet`, `ObjNotMet`, `VerDate`, `Shape.STArea()`, `Shape.STLength()`.
  - `OFHObjMet` / `ObjNotMet` look like "Overall Fuel Hazard objective met / objective not met" flags for prescribed burns. Their meaning and codes are UNVERIFIED. If they are populated, they are the only in-dataset hint of **how well a hazard-reduction burn actually worked**, and could inform the patchiness p (§5.2).
- **Quirks** (verified: measured by bolat-t/spatial-analytics on 38,092 polygons; README re-read 2026-09-27):
  - `FireYear` is a **6-digit financial year**: `201920` = the 2019–20 season, `190203` = 1902–03. One row ("Tamban Forest fire") has the 4-digit value `2004` and a null `StartDate`. Decode with `fy ≥ 10000 ? floor(fy/100) : fy`. Never compare `FireYear` to a calendar year directly: `FireYear > 2019` matches almost every row.
  - `StartDate` is null on 15,341 rows (40%) and `EndDate` on 20,018 (53%). They are ArcGIS epoch milliseconds.
  - `Intensity` uses 9999 as a null sentinel. Its codes are undocumented. Pages where it is all-null come back typed as double, pages of real codes as int.
  - 22,810 wildfire rows (30.8 Mha cumulative) and 15,282 prescribed-burn rows (3.7 Mha).
  - 332 of 38,092 geometries (0.87%) are invalid. Repair them before rasterising; reprojection can re-invalidate repaired rings.
  - Native spatial reference is GDA94 (EPSG:4283). PROJ treats EPSG:4283 as lat/lon axis order, but the data are lon/lat, so use `always_xy`. The GDA94–WGS84 offset is ~1.8 m, negligible at 10–30 m cells.
  - `maxRecordCount` is 1000, but large polygons trigger HTTP 500. 500 features can be 10.7 MB. Page by `OBJECTID`, not offset, and halve the page size on failure.
  - **ArcGIS returns failed queries as HTTP 200 with an `error` object**, so check the body, not just the status.
- **Label**: a free-text display label. Its exact format was not verified.
- **Envelope query, WGS84 in and out, GeoJSON.**
  - Verified in use by two separate codebases: resuly/property-scores uses `geometryType=esriGeometryEnvelope`, `inSR=4326`, `outSR=4326`, `spatialRel=esriSpatialRelIntersects` and `where=FireType = 1`, with `f=json`; bolat-t uses `f=geojson`, `orderByFields=OBJECTID ASC`, `resultRecordCount` and `where=OBJECTID>{n}`.
  - The *combination* below has not been run, because the host was blocked.

```
GET …/Fire/NPWS_Fire_History/MapServer/0/query
  ?where=1%3D1
  &geometry=150.20,-33.80,150.40,-33.60          (xmin,ymin,xmax,ymax; lon,lat)
  &geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects
  &outFields=OBJECTID,FireType,FireName,FireYear,Label,StartDate,EndDate,AreaHa
  &returnGeometry=true&outSR=4326
  &maxAllowableOffset=0.0001&geometryPrecision=5  (≈10 m generalisation; keeps payload small)
  &orderByFields=OBJECTID&resultRecordCount=200
  &f=geojson
```

  Paging: repeat with `where=OBJECTID>{last}`. Attribute-only pre-count: `returnCountOnly=true&f=json`.

  `maxAllowableOffset` and `geometryPrecision` are standard ArcGIS REST query parameters [K]. I did not test them against this server.

  **CORS headers could not be tested.** In Capacitor, use the native HTTP plugin so browser CORS does not apply [H].

### 4.2 SVTM (State Vegetation Type Map) – PCTs, Keith class and formation

- **REST**: `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer`. **Layer 3 is the vector PCT feature layer**: two independent tools use it as a feature layer and label it "vector PCTs" [S].
- **Fields used in practice** [S]:
  - `PCTID` and `PCTName`;
  - `vegClass`: the Keith class, e.g. "Sydney Montane Dry Sclerophyll Forests";
  - `vegForm`: the Keith formation/sub-formation.
- **WMS**: `https://mapprod3.environment.nsw.gov.au/arcgis/services/VIS/SVTM_NSW_Extant_PCT/MapServer/WMSServer`. It has four display layers with Leaflet zoom ranges: 0 = PCT labels (z 15–21), 1 = PCT (z 13–14), 2 = vegetation class (z 10–12), 3 = formation (z ≤ 9). (verified: gangerang/bushwalkers-topos `index.html`.) WMS returns colours, not codes, so **do not decode classes from WMS**.
- **Layer-index trap.** WMS layer 3 (the formation display) is *not* REST layer 3 (vector PCT features); the two numberings are independent. Another client uses REST `showLayers [0,1,2,3,4]`, so the REST MapServer has at least five layers (verified: hcec-org-au/b2h `layers.jsonl`). Read `…/MapServer?f=json` at build time rather than hard-coding layer ids.
- Query exactly as in §4.1, with `outFields=PCTID,PCTName,vegClass,vegForm`. The polygons are dense, so always generalise.
- **Raster alternative for offline packs (recommended).** Statewide 5 m GeoTIFF `SVTM_NSW_Extant_PCT_vC2_0_M2_2_5m.tif`, about 2.3 GB, uint16 PCT codes, with a `.vat.dbf` attribute table that includes `vegForm`. (verified: Zen-TM/logjam `build_svtm_formation.py` and Zen-TM/vegform_classifier.)
  - An older release, C1.1.M1.1 (Dec 2022), is on SEED as dataset `95437fbd-2ef7-44df-8579-d7a64402d42d` (verified: ces-unsw-edu-au/cesdata).
  - Resample to the fire grid by **mode**, as ozjimbob/FireTools2R does (verified). Mode keeps a narrow gully rainforest strip only if it is wider than about half a cell, so at 30 m cells FireSim should keep a "minority class present" flag for wet gullies [H].
- **Licence**: CC BY 4.0 is used by at least one downstream app, with the credit string "© State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2020 — State Vegetation Type Map (CC BY 4.0)". That app itself marks it "to confirm via SEED portal". UNVERIFIED at source.
- **Join to fuel** [K; corrected from "S by inspection"]: `lower(vegClass)` = `lower("Fuel name")` in NSW LUT v4.02, which gives FTno 1–76 for most forest and woodland classes. Heath, rainforest, grassland and wetland classes need a mapping [H]:
  - Sydney montane heaths → 43 Short heath;
  - Northern/Southern montane heaths and alpine heaths → 44 Montane & Alpine heath;
  - coastal and wallum heaths → 42 Tall heath;
  - montane/alpine bogs and fens → 56 Freshwater wetlands;
  - temperate montane grasslands → 58 Native grasslands;
  - all rainforest classes → 1.

  Validate this mapping with NSW RFS.

### 4.3 Fire severity (FESM)

NSW DPE/RFS **Fire Extent and Severity Mapping** is a Sentinel-2 machine-learning product. Classes [S]:
- unburnt;
- **low**: burnt understorey, unburnt canopy;
- **moderate**: partial canopy scorch;
- **high**: complete canopy scorch, partial canopy consumption;
- **extreme**: full canopy consumption.

(verified: class wording in cardat/cardat.github.com `nsw_government_seed.html`, which quotes the SEED description.)

**Raster codes**:

| Code | Class |
|---|---|
| 0 | unburnt |
| 1 | reserved; no class-1 pixels found in a global audit |
| 2 | low |
| 3 | moderate |
| 4 | high |
| 5 | extreme |
| 255 | NoData; never relabel as unburnt |

(verified via a secondary source: raei-2748/AUSSEF `METHODS_AND_LIMITATIONS.md`, citing FESM v3 factsheet p. 2, Dec 2020: `https://datasets.seed.nsw.gov.au/dataset/eeaf2006-db96-4218-a124-43b19cd15765/resource/43c71151-d790-423a-8436-457036c470cb/download/fireextentandseveritymapping_fesmv3_factsheet_december2020.docx.pdf`. The factsheet itself was UNVERIFIED because the host was blocked.)

Code 0 inside a mapped extent is "unburnt within the fire footprint", not "outside the fire". FESM is on SEED as `fire-extent-and-severity-mapping-fesm`. Method: Gibson et al. (2020), *Remote Sens. Environ.* 240: 111702 [K]. Use it to set the post-fire state (§5.2).

### 4.4 National alternatives

- **Historical Bushfire Boundaries v2.0** (Digital Atlas of Australia / Geoscience Australia; CC BY 4.0) (verified: ben-gy/au-bushfires `pipeline/collect.mjs`, `src/live.ts`, `plan.md`):
  - `https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/Bushfire_Boundaries_Historic_Dec_view/FeatureServer/0`: 311,984 polygons, 1899-12-30 to 2023-10-15, 7 jurisdictions, no NT.
  - Continuation: `…/Historical_Bushfire_Extents_2020%E2%80%9325_View/FeatureServer/3` ("Other States", 43,778 records, 2020-07-01 to 2025-06-30; note the en dash in the name). Layer 0 of the same service is NT only.
  - Live: `…/Near_Real_Time_Bushfire_Boundaries_view/FeatureServer/3` (~3-hourly). This could pre-fill "where the fire is".
  - Fields: `fire_id, fire_name, ignition_date, fire_type, ignition_cause, area_ha, perim_km, state, agency`.
  - Multipart fires repeat the parent `area_ha` on every part. De-duplicate before summing. The historic and 2020–25 layers overlap from 2020 to 2023; cut over at 1 July 2020.
- **NVIS v7.0** (DCCEEW, released Nov 2024; CC BY 4.0; 100 m rasters) (verified: Ecosystem-Indicators-Workflows `AUS-NVIS-v7-State-files.ipynb`; lgruen/izzy-map; AGRF/MicrobialLandScape. The raster CRS is UNVERIFIED):
  - **33 Major Vegetation Groups (MVG) and 85 Major Vegetation Subgroups (MVS)**, corrected from "~31–33 / ~80–85".
  - Download items on ArcGIS Online: extant `5e70b5afc36a4c458a2cceb313eb3889`; pre-1750 `d82f6eab808542ee9d9a0ea09ea36567`.
  - REST: `https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer` (also `NVIS_ext_mvs`, and `NVIS_pre_*` for pre-1750).
  - Too coarse for 10–30 m cells. Use it only as a fallback outside SVTM coverage.
- **AFDRS national fuel type map**: an AFAC/state product whose parameters appear in the LUT above [S]. **Public raster availability not verified.** The NSW state fuel map (v4.02) is similarly unverified for public download.
- **NSW RFS planned hazard-reduction burns**: a community scrape exists (fields `location, lga, size, startDate, endDate, leadAgency`) (UNVERIFIED this pass). It lists *planned* burns only. Do not treat it as burnt area.
- **Airborne LiDAR (NSW / ELVIS)** for fuel *structure* [K; not re-verified]. LiDAR point clouds can map near-surface and elevated fuel cover and height over large areas of NSW forest (Price & Gordon 2016). They can also map post-fire recovery patterns after mixed-severity fire (Gordon, Price & Tasker 2017).
  - ELVIS LiDAR and DEM products are CC BY 4.0 (verified: Zen-TM/logjam licence table).
  - They are the only public route to **measured** elevated-fuel height at 10–30 m, instead of class-average H_el. They also support the "better than a drape map" goal: a LiDAR-derived shrub-height layer can be draped *and* extruded in the 3D view.
  - Caveat: LiDAR capture dates pre-date recent fires, so flag cells whose last fire is after the capture date. logjam does exactly this with its `fire_stale` mask.

---

## 5. Implementation recommendations

### 5.1 Pipeline (runs once per scenario, in a Web Worker)

1. **Area of interest.** Take a 3–10 km square around the GPS fix and expand it by 2 km for fire history, because large polygons matter.
2. **Vegetation.** Query SVTM layer 3 with generalisation (`maxAllowableOffset` ≈ half the fire-cell size in degrees). Rasterise to the fire grid (10–30 m) with a scanline polygon fill, storing FTno (uint16).
   - Fallback 1: offline region pack.
   - Fallback 2: NVIS MVG → coarse FTno mapping, flagged "low-confidence vegetation".
3. **Fire history.** Query NPWS Fire History (and FESM where available) and rasterise in *chronological order*. Per cell keep:
   - `tsf` (float32, years to the scenario date, using `EndDate`, else `StartDate`, else decoded season with 1 January of the second year) [H];
   - `lastType` (wildfire or prescribed);
   - `lastSeverity` (FESM class or unknown);
   - `nFires_TFImin`: the number of fires within the formation's minimum interval before the last fire;
   - `nFires_30y`.

   Cells with no record get `tsf = max(t₉₅ across layers)`, i.e. steady state, and are flagged "no recorded fire (may be older than records)".
4. **Fuel state.** For each layer L ∈ {s, ns, el, b, o}: `X_L = X_ss,L·(1 − e^{−k_L·tsf}) + X₀,L·e^{−k_L·tsf}`.
   - Heights H_ns, H_el and H_o come from the LUT; H_el is held constant by default.
   - **FHS values: `FHS_s(t) = FHS_s,max·(1 − e^{−k_s·tsf})` and `FHS_ns(t) = FHS_ns,max·(1 − e^{−k_ns·tsf})`, using the LUT `FHS_*` maxima (§3.1).** This is the operational method (verified: PyroXL changelog 2024-10-11; corrected 2026-09-27; the earlier text said "from §3.3").
   - Use `fl_to_fhs` (§3.3) only when the user edits a load directly.
   - For heath: `FL_total(t)` with k from `Fk_s` (v4.02) or `Fk_total` (AFDRS). **Never** use the v4.02 `Fk_total` = 0.
5. **Derived per-cell properties** passed to the spread model:
   - FHS_s, FHS_ns, H_ns, H_el, FL layers, WAF (`WRF_For`), wet/dry submodel (from the AFDRS type), spotting flag, bark class;
   - for heath: `FL_total(t)` and `WF_Heath` (0.67);
   - for grass: load and curing (curing belongs to another document);
   - **post-fire flags**: `postFire` (bool) and `wrfDelta`, so the ROS model can apply the open-canopy wind increase (§2.3).
6. **Cache** everything in IndexedDB, keyed by AOI and data version.

**Cost** [H estimate]:
- A 10 km AOI at 20 m is 250,000 cells. Five layers × float32 is about 5 MB. The Olson evaluation takes well under 50 ms on a phone.
- Rasterising a few hundred polygons takes under 1 s.
- Network payload dominates (MBs). Hence the offline packs.
- Fuel does not change within a 2–6 h scenario, so it adds nothing to the per-timestep budget. Only consumption (burnt, or partially burnt by a low-intensity flank) changes during the run.
- **Fuel availability does change with the scenario's drought inputs.** Precompute FA per cell once per scenario from (DF, KBDI, WAF, submodel) with the §3.4 formula. It is a scalar per cell, so the cost is negligible. Recompute only if the user edits DF or KBDI mid-run.
- Per-timestep ROS, FH and I evaluations are closed-form (§3.4). With about 250 k cells and only the burning-front cells (typically < 5%) evaluated per step, this is far inside the 1–2 min budget for 2–6 h scenarios [H].

**Offline region packs** [H]:
- Pre-bake FTno and a TSF/severity raster for the mountain regions at 20–30 m as tiled Cloud-Optimised GeoTIFF or PMTiles.
- A 50 × 50 km tile at 25 m is 4 M cells: about 8 MB raw uint16, compressing well because classes are patchy.
- Re-bake monthly to track the NPWS update cycle.
- This is essential for Kanangra-Boyd, Wollemi, Kosciuszko and similar areas without coverage.

### 5.2 Fire-type-specific resets (X₀) and post-fire states

Primary data on consumption fractions by layer and severity could not be retrieved. The defaults below are **[H]** placeholders and are editable.

- **Wildfire with FESM high or extreme, or unknown severity**: X₀ = 0 for all layers, the operational convention (verified: PyroXL `fuel_amount` has no residue term, and Cirulis et al. state PHOENIX resets burn blocks to the lowest value).
  - If the vegetation is shrubby DSF, heath, subalpine woodland or montane WSF, **switch to the post-fire parameter set**.
  - Use the ACT "2020_" pattern as the template (verified values, §2.3): ns steady state ×4, el ×2–3, k_ns and k_el 0.4–0.5, k_s reduced by about a third (0.15 → 0.10, 0.3 → 0.2), k_b 0.02, WRF − 1.
  - Apply it while tsf < 15 yr [H], then revert. The persistence period is a FireSim assumption; no source gives it.
- **Wildfire with FESM low or moderate**, or a **prescribed burn**: model patchiness with coverage fraction `p` (user-editable; placeholder 0.6 [H]; UNVERIFIED because Penman et al. 2007 values were not retrieved). Effective state = p·(reset state) + (1−p)·(pre-fire state). If the NPWS `OFHObjMet` field turns out to be populated and meaningful, use it to raise or lower p per burn.
  - **Shrub-seeder exception** (verified case: the Mt Jerrabomberra 2009 and 2010 burns, §2.3): in DSF with *Kunzea* or *Acacia* understorey, even a prescribed burn can trigger the post-fire elevated-fuel pulse. Offer the user a "regrowth thicket here" toggle rather than applying it automatically.
  - Within the burnt fraction use X₀ = 0 for surface and near-surface.
  - Elevated and bark are partially retained: X₀,el = 0.5·X_pre and X₀,b = 0.5·X_pre [H].
  - Pre-fire state comes from the previous record.
- **Back-burn** (user-drawn): treat as wildfire of user-chosen severity.
- **Interval squeeze**: if `nFires_TFImin ≥ 1` in obligate-seeder formations (montane WSF with alpine ash, *E. oreades* stands, heath), flag an ecological state change. Optionally switch FTno to a grassier or shrubbier type chosen by the user.

  Do **not** auto-convert: the evidence is qualitative [K].

### 5.3 Simplifications and their consequences

| Simplification | Consequence | Mitigation |
|---|---|---|
| Olson monotonic curves for el/b | Misses the post-fire thicket peak and long-unburnt decline | Post-fire parameter switch (§5.2); user hazard edit |
| Class-level steady states | Real loads vary ±50% within a class (council survey: 5–34+ t/ha within one DSF community) [S] | Show ranges; let the user calibrate from what they see |
| Mapped burn polygon = burnt | Overstates treatment; can falsely teach "the burn will stop it" | Patchiness p; card "burn map ≠ every square metre burnt" |
| No moisture–fuel-type coupling here | Gully wet forest behaves like dry forest | Always use AFDRS wet/dry submodel and FA (§3.4); aspect moisture in doc 01/02 |
| TSF from season when dates are null | Up to ±1 yr TSF error; small effect except in young fuels | Flag when `StartDate` is null and tsf < 3 yr |
| No fire record = steady state | Correct for litter; wrong for areas burnt before records or burnt privately | Flag; allow override |
| Mode-resampling SVTM to 20–30 m | Narrow gully rainforest or wet forest strips (< ~½ cell wide) vanish, so gully "barriers" are lost | Keep a minority-class flag per cell; or sample SVTM along the DEM drainage network at 5 m [H] |
| Class-average H_el (no LiDAR) | Flame-height factor e^{0.64·H_el} is wrong by up to ~1.6× between LUT versions alone | Offer the H_el slider (§5.4); use LiDAR-derived shrub height where available (§4.4) |
| Mk1 Mf discontinuity at 20% FMC | ROS drops abruptly by 4× as fuel crosses 20% (e.g. into a moist gully) | Smooth the taper (§3.4) and explain it as "fuel too wet to carry fire" |

### 5.4 Inputs the user should be able to edit on site

1. **Vegetation/fuel type** (paint brush over cells), including "heath", "rainforest gully" and "grass".
2. **Time since fire**, or **"burnt N years ago"** per polygon, plus fire type and severity.
3. **Layer hazard ratings** as OFHG words (Low … Extreme) for surface, near-surface, elevated and bark. These are converted to loads with §3.3 and back to an equivalent fuel age with t_eq.
4. **Litter depth** in mm (converted at ~0.4 t/ha per mm; verified rule of thumb: 4 t/ha ≈ 1 cm, NSW APZ standard as quoted in the QPRC South Jerrabomberra Bushfire Study).
5. **Elevated fuel height** (m), with slider presets: "knee", "waist", "head", "above head".
6. **Bark type** (smooth / fibrous / stringy / ribbon) → bark class and spotting flag.
7. **Prescribed-burn patchiness** p, and "back-burnt here" polygons.
8. **Drought state** (KBDI or DF) for the wet-forest availability explanation.

---

## 6. Explaining it to a beginner firefighter: insight cards and detection criteria

Conventions:
- tsf in years.
- rel_L = X_L/X_ss,L (fraction of steady state).
- FHS scores as in §3.3.
- U10 in km/h; FMC is dead fine fuel moisture in %.
- FFDI/FBI thresholds: "Extreme" is FBI 50–99 under AFDRS (Moderate 12–23, High 24–49, Catastrophic ≥ 100) [K].
  - Under the **legacy** NSW FFDI scale, 50–74 was "Severe" and 75–99 "Extreme" (verified: FDR table in the Mt Jerrabomberra Bushfire Management Plan 2017: "EXTREME 75-99").
  - FireSim uses FBI ≥ 50 **or FFDI ≥ 50** as a "severe-or-worse weather" trigger and labels it by the AFDRS name. This corrects the earlier text, which called FFDI ≥ 50 "Extreme".
- **All detection thresholds in the table below are [H] FireSim heuristics**, except where they reuse a verified quantity (FA, H_el factor, TFI).

Show at most two fuel cards at once and rank them after the terrain cards of doc 01. Every card carries a "Watch for" cue.

| # | Card | Detection | Text |
|---|---|---|---|
| F1 | **Recently burnt: fire should slow** | Front will enter cells with tsf ≤ 3 and rel_s ≤ 0.6, forest or heath type | "This area burnt about {tsf} years ago. The leaf litter is only about {rel_s·100}% of what it will grow to. **Why:** fire needs fine fuel to carry it; less litter means lower flames and slower spread. **Watch for:** grass and regrowth that can still carry fire, and embers landing beyond the burnt area." |
| F2 | **Old burn won't stop it today** | tsf ≤ 5 and (FBI ≥ 50 or FFDI ≥ 50 or U10 ≥ 40 with RH ≤ 15%) | "The old burn helps less on a day like this. Research on big NSW and Victorian fires found that weather mattered more than how long ago an area was burnt. **Why:** in strong wind, embers fly over the burnt patch and sparse fuel still burns." |
| F3 | **Fuel has built up fully** | tsf ≥ t₉₅(surface), forest type | "This bush hasn't burnt for {tsf}+ years, so the litter has reached its maximum (about {X_ss} t/ha, roughly {X_ss/4} cm deep). Extra years don't add much more. Now **dryness and wind** decide how it burns." |
| F4 | **Regrowth thicket: taller flames** | lastSeverity ≥ high (or wildfire, unknown severity) and 3 ≤ tsf ≤ 15 and formation ∈ {DSF shrubby, heath, subalpine, montane WSF}, or H_el ≥ 1.5 m, or FHS_el ≥ 3.5 | "After the last big fire, shrubs and wattles came back **thick**. Dense shrubs {H_el} m tall can make flames about {e^{0.64·H_el}}× taller than in open forest spreading at the same speed. **Why:** shrubs lift the fire off the ground and feed it more air. Recently burnt doesn't always mean safe." |
| F5 | **Fire has climbed into the shrubs / crowns** | Predicted FH > 1 m (shrubs join), or FH > 0.66·H_o (crowns join) | "The flames are now tall enough to reach the {shrubs/tree crowns}. That adds {ΔFL} t/ha of fuel to the fire front, so intensity roughly jumps {×} here. **Why:** each fuel layer only joins the fire when the flames reach it." |
| F6 | **Stringybark: ember factory** | Bark class stringy or FHS_b ≥ 3, or LUT Spotting = 1 with FL_b ≥ 3, and U10 ≥ 20 | "These are stringybark trees. Their loose, fibrous bark catches easily and breaks off burning, so **expect lots of spot fires downwind**, often hundreds of metres ahead. **Watch for:** glowing bark drifting in the smoke." |
| F7 | **Ribbon bark: long-distance embers** | User or botanical flag ribbon bark (candlebark, manna gum, mountain gum), montane WSF or tableland WSF, strong plume or U10 ≥ 30 | "Ribbon-barked gums shed long streamers. Lifted in a strong smoke column, they can carry fire **kilometres** ahead. In the 2009 Kilmore East fire, spot fires were reported tens of kilometres ahead." |
| F8 | **Wet gully: barrier today** | Front entering Rainforest or WSF cells with FA ≤ 0.2 | "This gully is wet forest. Right now its fuel is too damp to burn well, so the fire will probably slow or stop at its edge. **Why:** shade, shelter from wind and moist soil keep the litter wet." |
| F9 | **Wet gully will burn (drought)** | Same cells with FA ≥ 0.6 (e.g. KBDI ≥ ~120–150 and DF ≥ 8) | "In this drought the gully's fuel has dried out: about {FA·100}% is available to burn. Gullies that usually stop fires can **carry them**, as happened widely in 2019–20. **Why:** long dry spells dry out even shaded, sheltered fuel." |
| F10 | **Heath: fast and fierce, then over** | Heath FTno and U10 ≥ 15 and FMC ≤ 10 | "This is heath: shrubs 1–3 m tall with little shade. Fire can run **very fast** here, with flames above the shrubs, but burns out quickly behind the front. **Watch for:** sudden fast runs on exposed plateau tops and cliff edges." |
| F11 | **Burn map ≠ every square metre burnt** | Cell inside a prescribed-burn polygon with tsf ≤ 5 | "This block was hazard-reduced {tsf} years ago, but prescribed burns are patchy. Some patches inside may never have burnt and still carry fuel. **Why:** mild-weather burns go out in damp spots and gullies." |
| F12 | **Burnt too often: the bush has changed** | nFires_TFImin ≥ 1 in the cell's formation, esp. montane WSF, heath or *E. oreades* | "This area has burnt {n} times within {TFImin} years. Some plants here only regrow from seed and need years to mature, so repeated fires can turn forest into **scrub or grass**. That changes how future fires behave: faster in grass, or thicker shrubs." |
| F13 | **Snow gum and alpine country** | FTno ∈ {39, 44, 45, 46} | "Above about 1,500 m, snow gum woodland and alpine heath burn rarely but recover slowly; managers aim to keep fire out of alpine areas. After fire, shrubs can come back thick, and frost-hollow grasslands in the valleys can carry fast grass fires." |
| F14 | **Data confidence** | Vegetation from NVIS fallback, or `StartDate` null with tsf < 3, or user edits active | "Fuel here is estimated from {source}. Real fuel can be half or double this. Check what you see and adjust it in the fuel editor." |
| F15 | **Tall mountain ash forest is not a wet-gully barrier** | FTno ∈ {9, 10} (WRF 3.5) and DF ≥ 7 and FA ≥ 0.6 | "This is tall montane forest (alpine ash or mountain gum). It looks wet and green, but its litter dries almost like dry forest, so today about {FA·100}% of it can burn. **Why:** its canopy is more open than rainforest, letting in sun and wind. Deep litter, up to about {X_ss} t/ha, plus ribbon bark means intense fire and long-range embers. **Watch for:** crown fire on the steep upper slopes." |
| F16 | **Burnt canopy lets the wind in** | lastSeverity ≥ high and tsf < 15 and forest type (post-fire set active, wrfDelta ≥ 1) | "The last fire killed or thinned the tree crowns here, so the wind at ground level is about {(WRF/(WRF−1))}× stronger than under a full canopy, on top of thick regrowth. **Why:** tree crowns normally slow the wind before it reaches the fuel. **Watch for:** faster runs through regrowth on ridges and upper slopes." |
| F17 | **Hazard-reduced, but the shrubs came back thicker** | Prescribed-burn polygon with 3 ≤ tsf ≤ 10, DSF formation, and user flag "wattle/burgan thicket" or FHS_el ≥ 3.5 | "This block was burnt to reduce fuel {tsf} years ago, but wattles and burgan sprang back dense. Near Queanbeyan, sites burnt this way were rated **Very High to Extreme** fuel hazard 7–8 years later. **Why:** fire triggers mass germination of some shrubs, and the thicket feeds tall flames." |
| F18 | **The fire is entering ground it has already burnt, or a back-burn** | Front reaches cells with tsf < 0.1 (burnt this scenario, or a user-drawn back-burn) | "There is almost no fine fuel left here, so the flame front will stop. **Watch for:** embers carrying fire past it, and unburnt islands or tree crowns inside that can still flare up." |

---

## 7. Open questions and uncertainties

1. **Primary fuel curves.** Watson (2011, Part 1 forests and grassy woodlands; Report to NSW RFS, UOW) and the heathland review (Gordon, UOW) could not be opened. The LUT values are presumed to derive partly from them (Cirulis et al.) but are not verified against them. The LUT copy in PyroXL may lag the current RFS production LUT.
2. **LUT version conflicts** (verified present, 2026-09-27): ACT versus NSW rows (subalpine FL_s 9 vs 15; tableland shrubby DSF 11 vs 19); 5018 FL_el is 3 in the national LUT and 6 in the NSW copy; 14 `Hk_ns` entries are corrupted; **fuel heights** differ (AFDRS 2xxx H_el 1.3 m vs NSW v4.02 2 m, so flame height differs ≈ 1.6×); v4.02 heath rows have `Fk_total` = 0.
3. **Wet-forest FA coefficient**: −0.0175 is now adopted, because three implementations agree and −0.175 is physically backwards. It is still to be confirmed against Cruz et al. 2022 or the AFDRS technical guide. The **slope/aspect term C2** of the Mk2 wet-forest availability is unimplemented everywhere public; its coefficients are unknown.
3a. **Vesta Mk2 details** needing primary confirmation: whether Mk2 "FL_s" is surface + near-surface; the h_u equation; whether phase 3 uses open U10 and ignores slope; the downslope SF form.
3b. **Spotting distance.** Should the Vesta formula use surface FHS (as coded) or bark hazard? Check Gould et al. 2007. Also, how should the `abs()` artefact at low R be handled?
4. **Post-fire state**: does "2020_" mean post-2019–20 wildfire? How long should it persist, and is it valid in NSW mountain classes other than the two ACT types?
5. **Consumption by layer and severity; prescribed-burn patchiness p**: no values retrieved (Penman et al. 2007 has data).
6. **Treatment longevity numbers** for NSW mountains (Price & Bradstock 2010/2012): exact durations need checking. Leverage magnitudes (Price et al. 2015a) need checking.
7. **NPWS service**: whether back-burns are included in wildfire polygons; the `Label` format; `Intensity` codes; the meaning and codes of `OFHObjMet`, `ObjNotMet` and `VerDate`; CORS; whether `maxAllowableOffset` behaves well on this server; whether an envelope query with `f=geojson` and `inSR/outSR=4326` together has ever been run (each part has been run separately).
8. **SVTM**: licence (CC BY 4.0 is assumed downstream but unconfirmed at source); the full REST layer list (at least layers 0–4 exist; only layer 3 confirmed as vector PCTs); payload sizes for dense 5 m-derived polygons. The raster route (5 m GeoTIFF + VAT) avoids the payload problem for offline packs.
8a. **FESM code table**: confirm 0 / 1 (reserved) / 2–5 / 255 from the FESM v3 factsheet itself.
9. **Heath class mapping** (Keith heath classes → LUT heath types) needs RFS confirmation.
10. **Public availability of the NSW/AFDRS fuel type rasters.** If available, they would replace the SVTM→LUT join.

---

## 8. References

Primary and operational sources. [S] = content confirmed this session; [K] = cited from knowledge, verify. None of the journal papers could be opened in either pass; bibliographic details are [K] unless marked.

Added in the 2026-09-27 fact-check pass:
- Cheney NP, Gould JS, McCaw WL, Anderson WR (2012) Predicting fire behaviour in dry eucalypt forest in southern Australia. *For. Ecol. Manage.* 280: 120–131. The primary source of the Vesta Mk1 ROS form in §3.4. [K]
- Collins L, Bennett AF, Leonard SWJ, Penman TD (2019) Wildfire refugia in forests: severe fire weather and drought mute the influence of topography and fuel age. *Glob. Change Biol.* 25: 3829–3843. [K]
- Cruz MG, Gould JS, Alexander ME, Sullivan AL, McCaw WL, Matthews S (2015) *A Guide to Rate of Fire Spread Models for Australian Vegetation.* CSIRO Land & Water and AFAC, Canberra/Melbourne. [K]
- Cruz MG, Cheney NP, Gould JS, McCaw WL, Kilinc M, Sullivan AL (2022) An empirical-based model for predicting the forward spread rate of wildfires in eucalypt forests. *IJWF* 31: 81–95. https://doi.org/10.1071/WF21068 [K]
- Gordon CE, Price OF, Tasker EM, Denham AJ (2017) Acacia shrubs respond positively to high severity wildfire: implications for conservation and fuel hazard management. *Sci. Total Environ.* 575: 858–868. [K]
- Gordon CE, Price OF, Tasker EM (2017) Mapping and exploring variation in post-fire vegetation recovery following mixed severity wildfire using airborne LiDAR. *Ecol. Appl.* 27: 1618–1632. [K]
- Hollis JJ, Matthews S, Fox-Hughes P, Grootemaat S, Heemstra S, Kenny BJ, Sauvage S (2024) Introduction to the Australian Fire Danger Rating System. *IJWF* 33: WF23140. [K]
- Price OF, Gordon CE (2016) The potential for LiDAR technology to map fire fuel hazard over large areas of Australian forest. *J. Environ. Manage.* 181: 663–673. [K]
- Queanbeyan-Palerang Regional Council (2017) *Bushfire Management Plan – Mount Jerrabomberra* (council meeting attachment, 11 Oct 2017, item 4.3) and *Final South Jerrabomberra Bushfire Study*. OCR copies in https://github.com/nicolfamilyfarm/qprc-helper [S: post-burn Burgan/Golden Wattle hazard, 5–34+ t/ha range, FDR table, 4 t/ha ≈ 1 cm rule]
- NSW DPE (2020) *Fire Extent and Severity Mapping (FESM) v3 factsheet*, December 2020. SEED resource URL in §4.3. [codes S via secondary: raei-2748/AUSSEF]
- Geoffysicist (Geoff Goldrick, NSW RFS, per the workbook Changelog), **PyroPy_2**, `pyropy2/spread_model_vesta2.py`. https://github.com/Geoffysicist/PyroPy_2 [S]
- bran-jnw/**wuinity**, `PREACT/…/SpreadModels/AFDRS/FuelModels/Forest.cs`: an independent C# port of the AFDRS forest model. https://github.com/bran-jnw/wuinity [S: wet-forest FA coefficient −0.0175]
- CSIRO Australian Ecosystem Models Framework (`CSIRO-enviro-informatics/ecosystems-models-framework`, `rdf/emf.jsonld`), "Eucalypt woodland" umbrella group definition. [S: fire promotes shrubs in sub-alpine resprouter woodland]

- Anderson WR, Cruz MG, Fernandes PM, McCaw L, Vega JA, Bradstock RA, et al. (2015) A generic, empirical-based model for predicting rate of fire spread in shrublands. *IJWF* 24: 443–460. [S cit.]
- Birk EM, Simpson RW (1980) Steady state and the continuous input model of litter accumulation and decomposition in Australian eucalypt forests. *Ecology* 61: 481–485. [K]
- Boer MM, Sadler RJ, Wittkuhn RS, McCaw L, Grierson PF (2009) Long-term impacts of prescribed burning on regional extent and incidence of wildfires – evidence from 50 years of active fire management in SW Australian forests. *For. Ecol. Manage.* 259: 132–142. [S cit.]
- Bowman DMJS, Murphy BP, Neyland DLJ, Williamson GJ, Prior LD (2014) Abrupt fire regime change may cause landscape-wide loss of mature obligate seeder forests. *Glob. Change Biol.* 20: 1008–1015. [K]
- Bowman DMJS, Williamson GJ, Gibson RK, Bradstock RA, Keenan RJ (2021) The severity and extent of the Australia 2019–20 *Eucalyptus* forest fires are not the legacy of forest management. *Nat. Ecol. Evol.* 5: 1003–1010. [K]
- Bradstock RA, Tozer MG, Keith DA (1997) Effects of high frequency fire on floristic composition and abundance in a fire-prone heathland near Sydney. *Aust. J. Bot.* 45: 641–655. [K]
- Bradstock RA, Hammill KA, Collins L, Price O (2010) Effects of weather, fuel and terrain on fire severity in topographically diverse landscapes of south-eastern Australia. *Landscape Ecol.* 25: 607–619. [K]
- Bradstock RA, Cary GJ, Davies I, Lindenmayer DB, Price OF, Williams RJ (2012) Wildfires, fuel treatment and risk mitigation in Australian eucalypt forests: insights from landscape-scale simulation. *J. Environ. Manage.* 105: 66–75. https://doi.org/10.1016/j.jenvman.2012.03.050 [S]
- Camac JS, Williams RJ, Wahren C-H, Hoffmann AA, Vesk PA (2017) Climatic warming strengthens a positive feedback between alpine shrubs and fire. *Glob. Change Biol.* 23: 3249–3258. [K]
- Cirulis B, Clarke H, Boer M, Penman T, Price O, Bradstock R (2019/2020) Quantification of inter-regional differences in risk mitigation from prescribed burning across multiple management values. *IJWF* 29: 414–426 (online first 2019). [S text; volume/pages K]
- Collins L, Bradstock RA, Clarke H, Clarke MF, Nolan RH, Penman TD (2021) The 2019/2020 mega-fires exposed Australian ecosystems to an unprecedented extent of high-severity fire. *Environ. Res. Lett.* 16: 044029. [K]
- Costin AB (1954) *A Study of the Ecosystems of the Monaro Region of New South Wales*. NSW Government Printer. [K]
- Cruz MG, Sullivan AL, Gould JS, Sims NC, Bannister AJ, Hollis JJ, Hurley RJ (2012) Anatomy of a catastrophic wildfire: the Black Saturday Kilmore East fire in Victoria, Australia. *For. Ecol. Manage.* 284: 269–285. [K]
- Cruz MG, Gould JS, Hollis JJ, McCaw WL (2018) A hierarchical classification of wildland fire fuels for Australian vegetation types. *Fire* 1(1): 13. https://doi.org/10.3390/fire1010013 [K]
- Cruz MG, et al. (2021) Vesta Mk 2 rate of spread model for dry eucalypt forests (CSIRO report); journal version Cruz et al. (2022) *IJWF* 31: 81–95. [K; equations S via PyroXL]
- Dalgleish SA, van Etten EJB, Stock WD, Knuckey C (2015) Fuel dynamics and vegetation recovery after fire in a semiarid Australian shrubland. *IJWF* 24: 613–623. [S cit.]
- Duff TJ, Bell TL, York A (2012/2013) Predicting continuous variation in forest fuel load using biophysical models: a case study in south-eastern Australia. *IJWF* 22: 318–332 (online 2012) [pages K]. [S cit.]
- Ellis PFM (2011) Fuelbed ignition potential and bark morphology explain the notoriety of the eucalypt messmate 'stringybark' for intense spotting. *IJWF* 20: 897–907. [K]
- Fairman TA, Nitschke CR, Bennett LT (2016) Too much, too soon? A review of the effects of increasing wildfire frequency on tree mortality and regeneration in temperate eucalypt forests. *IJWF* 25: 831–848. [K]
- Gibson R, Danaher T, Hehir W, Collins L (2020) A remote sensing approach to mapping fire severity in south-eastern Australia using Sentinel 2 and random forest. *Remote Sens. Environ.* 240: 111702. [K]
- Gould JS, McCaw WL, Cheney NP, Ellis PF, Knight IK, Sullivan AL (2007) *Project Vesta – Fire in Dry Eucalypt Forest: fuel structure, fuel dynamics and fire behaviour*. Ensis-CSIRO / DEC WA. [K; equations S via PyroXL]
- Hammill KA, Bradstock RA (2006) Remote sensing of fire severity in the Blue Mountains: influence of vegetation type and inferring fire intensity. *IJWF* 15: 213–226. [K]
- Hines F, Tolhurst KG, Wilson AAG, McCarthy GJ (2010) *Overall Fuel Hazard Assessment Guide*, 4th ed. Fire and Adaptive Management Report 82, DSE Victoria. https://www.ffm.vic.gov.au/__data/assets/pdf_file/0005/21110/Report-82-overall-fuel-assess-guide-4th-ed.pdf [S cit.]
- Keith DA (2004) *Ocean Shores to Desert Dunes: the Native Vegetation of New South Wales and the ACT*. DEC NSW, Hurstville. [K]
- Keith DA, Benson DH (1988) The natural vegetation of the Katoomba 1:100 000 map sheet. *Cunninghamia* 2: 107–143. [K]
- Kenny B, Sutherland E, Tasker E, Bradstock R (2004) *Guidelines for Ecologically Sustainable Fire Management*. NSW NPWS. [K; thresholds S via BFRMP]
- Lake George Bush Fire Management Committee (2018) *Bush Fire Risk Management Plan* — draft for public exhibition, March 2018 (NSW RFS), Table 3.3 Fire thresholds. OCR copy: https://github.com/nicolfamilyfarm/qprc-helper (yourvoice/markdown/…Lake-George-Bush-Fire-Risk-Management-Plan.md) [S]
- McCaw WL, Gould JS, Cheney NP, Ellis PFM, Anderson WR (2012) Changes in behaviour of fire in dry eucalypt forest as fuel increases with age. *For. Ecol. Manage.* 271: 170–181. [K]
- NSW DPE/DCCEEW. NPWS Fire History – Wildfires and Prescribed Burns (SEED). https://datasets.seed.nsw.gov.au/dataset/fire-history-wildfires-and-prescribed-burns-1e8b6; service https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/NPWS_Fire_History/MapServer/0 [S]
- NSW DPE. State Vegetation Type Map (SVTM) Extant PCT. https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer [S]
- NSW DPE/RFS. Fire Extent and Severity Mapping (FESM). https://datasets.seed.nsw.gov.au/dataset/fire-extent-and-severity-mapping-fesm [S]
- Geoffysicist (Geoff Goldrick, NSW RFS Predictive Services, per the workbook Changelog; README asks users to acknowledge the author and NSW RFS; GPL-3.0), **PyroXL** (AFDRS models, AFDRS fuel LUT, NSW fuel LUT v4.02), workbook `PyroXL_Operational_20250206.xlsm` and `src/vba_scripts/*.bas`. https://github.com/Geoffysicist/PyroXL [S]
- Olson JS (1963) Energy storage and the balance of producers and decomposers in ecological systems. *Ecology* 44: 322–331. https://doi.org/10.2307/1932179 [S cit.; DOI K]
- Penman TD, Kavanagh RP, Binns DL, Melick DR (2007) Patchiness of prescribed burns in dry sclerophyll eucalypt forests in south-eastern Australia. *For. Ecol. Manage.* 252: 24–32. [S cit.]
- Penman TD, Bradstock RA, Price OF (2014a) Reducing wildfire risk to urban developments: simulation of cost-effective fuel treatment solutions in south eastern Australia. *Environ. Model. Softw.* 52: 166–175. [S cit. and finding via Cirulis]
- Penman TD, Collins L, Syphard AD, Keeley JE, Bradstock RA (2014b) Influence of fuels, weather and the built environment on the exposure of property to wildfire. *PLoS ONE* 9: e111414. [S]
- Price OF, Bradstock RA (2010) The effect of fuel age on the spread of fire in sclerophyll forest in the Sydney region of Australia. *IJWF* 19: 35–45. [K]
- Price OF, Bradstock RA (2012) The efficacy of fuel treatment in mitigating property loss during wildfires: insights from analysis of the severity of the catastrophic fires in 2009 in Victoria, Australia. *J. Environ. Manage.* 113: 146–157. [S cit.]
- Price OF, Penman TD, Bradstock RA, Boer MM, Clarke H (2015a) Biogeographical variation in the potential effectiveness of prescribed fire in south-eastern Australia. *J. Biogeogr.* 42: 2234–2245. https://doi.org/10.1111/jbi.12579 [S cit.]
- Price OF, Pausas JG, Govender N, Flannigan M, Fernandes PM, Brooks ML, Bird RB (2015b) Global patterns in fire leverage: the response of annual area burnt to previous fire. *IJWF* 24: 297–306. https://doi.org/10.1071/WF14034 [S cit.]
- Taylor C, McCarthy MA, Lindenmayer DB (2014) Nonlinear effects of stand age on fire severity. *Conserv. Lett.* 7: 355–370. [K]
- Thomas PB, Watson PJ, Bradstock RA, Penman TD, Price OF (2014) Modelling surface fine fuel dynamics across climate gradients in eucalypt forests of south-eastern Australia. *Ecography* 37: 827–837. https://doi.org/10.1111/ecog.00445 [S abstract]
- Walker J (1981) Fuel dynamics in Australian vegetation. In *Fire and the Australian Biota* (eds Gill AM, Groves RH, Noble IR), pp. 101–127. Australian Academy of Science. [K]
- Watson PJ (2011) *Fuel load dynamics in NSW vegetation. Part 1: forests and grassy woodlands*. Report to NSW RFS, Centre for Environmental Risk Management of Bushfires, University of Wollongong. [S cit.; content not accessed]
- Williams RJ, Wahren C-H, Bradstock RA, Muller WJ (2006) Does alpine grazing reduce blazing? A landscape test of a widely-held hypothesis. *Austral Ecol.* 31: 925–936. [K]
- Williams RJ, Wahren C-H, Tolsma AD, et al. (2008) Large fires in Australian alpine landscapes: their part in the historical fire regime and their impacts on alpine biodiversity. *IJWF* 17: 793–808. [K]
- Zylstra P (2013) The historical influence of fire on the flammability of subalpine snowgum forest and woodland. *Vic. Nat.* 130: 232–239. [K]
- Zylstra PJ (2018) Flammability dynamics in the Australian Alps. *Austral Ecol.* 43: 578–591. [K]

Data and code consulted (GitHub):
- bolat-t/spatial-analytics: NPWS fields, quirks, paging, season range 1902–2026 (re-read 2026-09-27).
- resuly/property-scores: envelope query (`f=json`) and a Black Summer canary test.
- uprez-net/propure-main: full NPWS field list, including `PerimeterM`, `OFHObjMet`, `ObjNotMet`, `VerDate`.
- Zen-TM/logjam: SVTM 5 m raster + VAT, `vegForm` list, NPWS and SVTM licence and attribution strings, ELVIS LiDAR, fire-staleness mask.
- mwhewins/ecoTools: SVTM fields.
- TheKillerKangaroo/BushfireBurnout: SVTM layer 3 used as a feature layer with `vegClass`, BFPL.
- hcec-org-au/b2h: SVTM REST `showLayers [0,1,2,3,4]`.
- gangerang/bushwalkers-topos: SVTM WMS layers and zoom ranges; national near-real-time layer.
- ozjimbob/FireTools2R: mode resampling of the SVTM 5 m raster.
- ben-gy/au-bushfires: national historical boundaries.
- dcceew-bdr/eiatest-catalogue, Ecosystem-Indicators-Workflows/ecosystems-maps-australia and lgruen/izzy-map: NVIS v7 (33 MVG / 85 MVS, CC BY 4.0).
- cardat/cardat.github.com: FESM class definitions; raei-2748/AUSSEF: FESM raster codes.
- ces-unsw-edu-au/cesdata: SVTM SEED dataset id and release C1.1.M1.1.
- nicolfamilyfarm/qprc-helper: RFS BFRMP thresholds, APZ fuel rule, OFHG field survey.
