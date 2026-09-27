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

---

## 1. Executive summary: what matters most for FireSim

1. **Fuel is layered, and each layer drives a different part of fire behaviour.** The Overall Fuel Hazard Assessment Guide (OFHG; Hines et al. 2010) [S] defines five layers: surface litter, near-surface, elevated shrubs, bark and canopy. The layers do different jobs:
   - Surface and near-surface hazard drive **rate of spread** (Vesta/AFDRS forest model) [S].
   - **Elevated fuel height drives flame height exponentially**: FH ∝ e^{0.64·H_el} [S].
   - **Bark drives spotting** physically [K: Ellis 2011]. The operational Vesta spotting-distance formula, however, takes surface FHS and ROS as inputs, not bark (verified: PyroXL `Spotting_forest`). FireSim's ember model must add bark explicitly (see doc 06).
   - Layers are added to fireline intensity as flames reach them: elevated fuel once flames exceed 1 m, half the canopy once flames exceed 0.66 × canopy height (verified: PyroXL `AFDRS_forest.bas` `Intensity_forest`, re-read 2026-09-27).
2. **Accumulation follows Olson (1963)** [S]: `X(t) = X_ss·(1 − e^{−k·t})`. There is one curve per layer and per fuel type. Operational NSW/AFDRS parameters exist for every Keith vegetation class and are reproduced here (Tables 3–5). Surface litter reaches 95% of steady state in about 4 years (rainforest, k = 0.75/yr) to about 18–20 years (Sydney montane and tableland dry sclerophyll, k = 0.15–0.17/yr). Bark recovers slowest (k = 0.1/yr, about 30 years to 95%) [S].
3. **Recently burnt ground is not a fixed fuel reduction.** After high-severity fire, shrubby and seeder-dominated communities often regrow a dense near-surface and elevated layer within about 3–15 years. The ACT's post-2019–20 LUT fuel types ("2020_…") encode this [S]:
   - near-surface steady state ×4 and elevated ×2–3;
   - faster accumulation (k 0.4–0.5/yr);
   - *slower* surface-litter accumulation (k_s 0.10 vs 0.15, and 0.2 vs 0.3), consistent with less litterfall from a killed or scorched canopy;
   - near-zero bark recovery (k 0.02/yr);
   - a more open canopy (lower wind reduction factor).

   (verified: AFDRS LUT rows 1105/1106 and 1109/1110 re-parsed from `PyroXL_Operational_20250206.xlsm`)

   This is the most important nuance for 2026: much of the Blue Mountains, Wollemi, Budawangs and Kosciuszko burnt in 2019–20. The NSW total was about 5.5 Mha [S].
4. **Treatment benefits are real but short-lived and weather-limited** [S/K]. Prescribed-burn effects on unplanned fire lasted about 6 years in SW WA (Boer et al. 2009) [K]. In Sydney, treatment of 7–10% of the landscape is needed to halve risk to people and property (Bradstock et al. 2012, as reported by Cirulis et al.) [S]. In the ACT and Tasmanian study landscapes of Cirulis et al., current treatment rates are "well below 5%" [S]. (verified: Cirulis et al. full text, Discussion; corrected 2026-09-27, as the earlier text wrongly attached the <5% figure to Sydney) Under extreme weather the effect of fuel age on severity shrinks (Bradstock et al. 2010; Price & Bradstock 2012) [K]. A San Diego simulation study found the same pattern (Penman et al. 2014b) [S].
5. **Fire frequency changes the vegetation and hence the fuel.** NSW minimum and maximum tolerable fire intervals by Keith formation are verified (Table 6) [S]:
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
   - **NPWS Fire History** ArcGIS service, layer 0, CC BY 4.0. It covers seasons from 1902–03 to the current season, 2026–27 as of September 2026, and is updated monthly. Its quirks are verified [S; range corrected 2026-09-27 from an independent full-table ingest].
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

**Why the layers matter differently.** Project Vesta showed that forest spread rate depends on the *hazard scores and structure* of the surface and near-surface layers, not on total fuel load (Gould et al. 2007; McCaw et al. 2012) [K]. The AFDRS implementation makes this explicit. ROS uses `FHS_s` and `FHS_ns·H_ns` (§3.4) [S]. Intensity then adds layers progressively as flames grow [S]:

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

Derived quantities:

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

Recovery rates in the NSW LUT [S], with t₉₅ = 3/k:
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

Five years after fire, near-surface fuel is 3.7 t/ha in the post-fire type versus 0.5 t/ha in the standard type, and elevated fuel is 4.3 versus 1.3 t/ha. My reading of the "2020_" prefix as "post-2019–20 fire state" is an interpretation of the naming. The numbers themselves are [S].

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

Species guide for defaults [K]:

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

**How long the benefit lasts** [K unless noted]:
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

Short intervals remove species that must reach reproductive maturity before the next fire. Long absences allow senescence of shrubs and fire-dependent species. NSW operationalises this as **fire interval thresholds by Keith formation** (Table 6, verified from an NSW RFS BFRMP; derived from Kenny et al. 2004) [S].

Mechanisms and NSW mountain examples [K]:
- **Heath obligate seeders** (e.g. *Banksia ericifolia*) need a fire-free juvenile period of several years. Repeated fires at short intervals shift heath towards resprouters and sedges (Bradstock, Tozer & Keith 1997).
- **Alpine ash (*E. delegatensis*)** is killed by severe fire and regenerates from seed. It needs roughly two decades to produce seed. Repeated fires (2003, 2006–07 in Victoria, 2019–20) caused regeneration failure and conversion of forest to shrubland or grassland (Bowman et al. 2014; Fairman, Nitschke & Bennett 2016).
- **Blue Mountains ash (*E. oreades*)** has similar seeder biology.
- **Snow gum** woodland is top-killed by high-severity fire and resprouts from lignotubers. Post-fire shrub regrowth can raise flammability, and warming may strengthen the shrub–fire feedback (Camac et al. 2017). Long-unburnt snow gum stands can be less flammable (Zylstra 2013, 2018).
- **Alpine grazing does not reduce blazing** (Williams et al. 2006).
- Large fires are part of the historical Alpine fire regime, with long recovery times (Williams et al. 2008).

The fuel consequence is that **frequent fire can raise elevated-fuel hazard for decades**, the opposite of the intended hazard reduction. It can also convert forest to grassland: faster spread, lower intensity and a different fuel model.

### 2.7 Vegetation classification and how NSW maps vegetation to fuel

- **Keith (2004)**, *Ocean Shores to Desert Dunes*, classifies NSW vegetation into formations, sub-formations and **vegetation classes** [K]. There are 12 formations: rainforests, wet sclerophyll forests, grassy woodlands, grasslands, dry sclerophyll forests, heathlands, alpine complex, freshwater wetlands, forested wetlands, saline wetlands, semi-arid woodlands and arid shrublands. The formation list matches Table 6 [S].
- **SVTM** (State Vegetation Type Map) maps **Plant Community Types (PCTs)** statewide. It carries `PCTID`, `PCTName`, `vegClass` and `vegForm` attributes [S], with display layers derived from 5 m mapping [S].
- **NSW RFS fuel LUT v4.02** is keyed by the Keith vegetation class name (FTno 1–76, e.g. 30 = "Sydney montane dry sclerophyll forests"). It maps each class to an AFDRS fuel type (Forest, Wet_forest, Woodland, Heath, Grass, …) and to a fire behaviour model (Vesta forest, heath, grass, …) [S]. **The join from SVTM `vegClass` to the NSW LUT is a case-insensitive name match** [S by inspection]. The exception is heath: the LUT has only "Tall heath", "Short heath" and "Montane & Alpine heath", so Keith heath classes need a mapping (§4.2) [H].
- **AFDRS national LUT** NSW types (FTno 2xxx) are coarser, at formation or sub-formation level. Examples: 2105 Tableland shrubby DSF, 2114 Hinterland shrubby DSF, 2152 Shrubby WSF, 2154 Montane grassy WSF, 2109 Subalpine woodlands, 2603 Montane & Alpine heath, 2751 Alpine herbfields [S]. The first digit of FTno_State is the state: 1 ACT, 2 NSW, 3 Vic, 4 Qld, 5 SA, 6 WA, 7 Tas, 8 NT [S by inspection of names].
- **Australian Fuel Classification** (Cruz et al. 2018, *Fire* 1(1): 13; Hollis et al. 2015) is the hierarchical scheme behind AFDRS fuel types [K].
- **Version disagreement matters** [S]. For "Subalpine woodlands", FL_s is 15 t/ha in the NSW v4.02 row but 9 t/ha in the ACT row. For "Tableland shrubby DSF", FL_s is 19 t/ha in the NSW 2105 row but 11 t/ha in the ACT 1105 row. These are expert-set values, not measurements. Treat them as ±30–50% uncertain [H].

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

`X(t) = X_ss(1 − e^{−kt}) + X₀e^{−kt}` (Olson 1963) [S]. The same curve is applied to **fuel hazard scores** in PyroXL (`FHS_s(t) = FHS_s,max·(1 − e^{−k_s t})`) [S].

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
| 42 | Tall heath | Heath | 22.2 | 0.07 | 43 | 1.7 | 13 | 0.15 | 0 | 0 | – | 4* | – | 2 | – |
| 43 | Short heath | Heath | total 11.8, k 0.6 | | 5 | | 6 | 0.6 | | | | 1.5* | | 1.5 | – |
| 44 | Montane & Alpine heath | Heath | total 12.6, k 0.1 | | 30 | | 6 | 0.25 | | | | 1* | | 1.5 | – |
| 45 | Alpine fjaeldmarks | Heath | total 2.6, k 0.15 | | 20 | | | | | | | 0.25* | | 1 | – |
| 46 | Alpine herbfields | Low_wetland (grass model) | total 5.8, k 0.2 | | 15 | | | | | | | | | 1 | – |
| 56 | Freshwater wetlands | Low_wetland | total 2.6, k 0.7 | | 4.3 | | | | | | | | | 1.2 | – |
| 58 | Native grasslands | Grass | total 5.1, k 0.9 | | 3.3 | | | | | | | | | 1.2 | – |

\*Heath H_el and total-load k are taken from the equivalent AFDRS NSW rows 2601–2604, 2751 and 2752. In the v4.02 rows 42–46, `Fk_total` = 0 and the heath k is carried in `Fk_s`.

**Notes** [S]:
- The heath model in PyroXL uses `FL_total` with `Fk_total`.
- Several `Hk_ns` entries in the NSW sheet look corrupted (e.g. 3.3, 12.3, 21.3) and **must not be used**.
- Heath FL_total values are *total* fine fuel.

**Implied net litter input L = k·X_ss** [S arithmetic]: Rainforests 6.0; escarpment WSF 5.9; Montane WSF 4.8; Subalpine woodland 4.5; Sydney montane DSF 2.5; Southern tableland DSF 2.9 t ha⁻¹ yr⁻¹. These are within the broad range reported for eucalypt litterfall (Birk & Simpson 1980; Walker 1981) [K].

**Worked example (Sydney montane DSF, surface)**: X(2) = 4.2, X(5) = 8.3, X(10) = 11.9, X(20) = 14.0 t/ha [S arithmetic]. A 2019–20 burn surveyed in late 2026 (t ≈ 6.8 yr) is at about 69% of steady state.

### 3.3 Load ↔ Vesta fuel hazard score (FHS)

From PyroXL `fl_to_fhs` [S]. FHS 1 = Low, 2 = Moderate, 3 = High, 3.5 = Very High, 4 = Extreme [K for the label mapping].

| Layer | FHS 1 | FHS 2 | FHS 3 | FHS 3.5 | FHS 4 |
|---|---|---|---|---|---|
| Surface (t/ha) | ≤ 4 | ≤ 9 | ≤ 13 | ≤ 18 | > 18 |
| Near-surface | ≤ 2 | ≤ 3 | ≤ 4 | ≤ 6 | > 6 |
| Elevated | ≤ 1 | ≤ 2 | ≤ 3 | ≤ 5 | > 5 |
| Bark (FHS 0/1/2/3/4) | 0 | ≤ 1 | ≤ 2 | ≤ 5 | > 5 |

For the inverse (user picks a hazard rating), use the class midpoint. For example, surface "High" → 11 t/ha [H].

### 3.4 Where fuel enters the spread and intensity equations

These equations are transcribed from PyroXL. Verify against the primary sources: Gould et al. 2007; Cruz et al. 2021/2022; Anderson et al. 2015.

**AFDRS forest (dry and wet), Vesta Mk1 form** [S]:

```
U  = U10 · 3 / WAF                           (km/h; WAF 3–5)
R0 = 30 + 1.5308 · (U − 5)^0.8576 · FHS_s^0.9301 · (FHS_ns · H_ns)^0.6366 · 1.03    if U > 5
R0 = 30                                      otherwise
R  = R0 · Mf(FMC)                            (m/h)
```

- FHS_s and FHS_ns are first multiplied by fuel availability FA.
- H_ns is in cm, capped at 20.
- Mf = 18.35·FMC^−1.495 for 4 < FMC ≤ 20%. Mf = 2.31 for FMC ≤ 4%, and 0.05 for FMC > 20%.

**Flame height** [S]: `FH = 0.0193 · R^0.723 · e^{0.64·H_el} · 1.07` (m; R in m/h, H_el in m).

The elevated factor e^{0.64 H_el} is 1.9 at 1 m, 3.6 at 2 m, 6.8 at 3 m and 12.9 at 4 m. This is the quantitative reason post-fire thickets matter.

**Byram intensity** [S]: `I = 18600 · w · R` (kW/m; w in kg/m², R in m/s). w follows the layered accumulation of §2.1.

**Vesta Mk2** (Cruz et al. 2021, as transcribed) [S]. Surface fuel load enters explicitly:
- `R1 = 1000·(0.03 + 0.05024·(u−1)^0.92628·(FL_s/10)^0.79928)·φ·SF` for u > 2 (m/h), with u = U10/WAF.
- `R2 = 1000·0.19591·u^0.8257·(FL_s/10)^0.4672·h_u^0.495·φ·SF`.
- Phase-2 transition probability logit `−23.9315 + 1.7033u + 12.0822φ + 0.95236·FL_s`, with P2 = 0 if FL_s < 1 t/ha.
- φ = Mf·FA.

**Fuel availability FA** [S]:
- Dry forest: FA = DF/10.
- Wet forest (PyroXL `AFDRS_forest.bas`):

```
C1 = clamp01( 0.1·[ (0.0046·WAF² − 0.0079·WAF − 0.0175)·KBDI + (−0.9167·WAF² + 1.5833·WAF + 13.5) ] )
FA = min( 1.008 / (1 + 104.9·exp(−0.9306·C1·DF)),  DF/10 )
```

The `Vesta2.bas` module in the same repository writes −0.175 instead of −0.0175. With −0.175, wet forest becomes unavailable for KBDI > ~18, which is physically implausible, so it is probably a typo. **Verify against the AFDRS technical guide.**

Computed wet-forest FA at DF 10 [S arithmetic]:

| WAF (type) | KBDI 25 | 50 | 100 | 150 | 200 |
|---|---|---|---|---|---|
| 3.5 (montane WSF) | 0.95 | 0.97 | 0.98 | 0.99 | 1.00 |
| 4.5 (escarpment and tableland WSF) | 0.14 | 0.30 | 0.74 | 0.95 | 1.00 |
| 5.0 (rainforest) | 0.01 | 0.03 | 0.35 | 0.89 | 1.00 |

At DF 6, the WAF 4.5 row is 0.05 / 0.09 / 0.22 / 0.47 / 0.60.

**Heath (Anderson et al. 2015)** [S]:
- Spread depends on 2 m wind (U10·WAF_heath), elevated fuel height and FMC.
- Intensity uses the Olson-accumulated heath total load: `I = 18600·(FL/10)·(R/3600)`.

**Vesta spotting distance** [S, transcribed]:
- If R < 150 m/h: 50 m.
- Otherwise: `|176.969·atan(FHS_s)·(R/U10^0.25)^0.5 + 1568800·FHS_s^−1·(R/U10^0.25)^−1.5 − 3015.09|` (m).

### 3.5 NSW fire interval thresholds by formation [S]

Source: Lake George BFMC Bush Fire Risk Management Plan (NSW RFS, 2018), Table 3.3, which follows Kenny et al. (2004). The minimum SFAZ/LMZ table (RFS 2006) matches.

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
- **Content**: final fire boundaries for every year with data. Subtype field `FireType`: **1 = Wildfire, 2 = Prescribed Burn** [S].
  - Polygons are mutually exclusive within each year and often extend outside NPWS estate.
  - RFS and Forestry Corporation data are sometimes imported [S from the SEED description].
  - Coverage 1920-01-01 to 2025-04-30 at last listing; updated monthly; **CC BY 4.0** [S].
- **Fields** [S]: `OBJECTID, FireType, FireName, FireNo, FireYear, Label, StartDate, EndDate, Intensity, AreaHa, NPWSBranch, NPWSArea`.
- **Quirks** (measured by bolat-t/spatial-analytics on 38,092 polygons) [S]:
  - `FireYear` is a **6-digit financial year**: `201920` = the 2019–20 season. One row has the 4-digit value `2004`. Decode with `fy ≥ 10000 ? floor(fy/100) : fy`.
  - `StartDate` is null on 40% of rows and `EndDate` on 53%. They are ArcGIS epoch milliseconds.
  - `Intensity` uses 9999 as a null sentinel. Its codes are undocumented.
  - 22,810 wildfire rows (30.8 Mha cumulative) and 15,282 prescribed-burn rows (3.7 Mha).
  - 0.87% of geometries are invalid.
  - Native spatial reference is GDA94 (EPSG:4283).
  - `maxRecordCount` is 1000, but large polygons trigger HTTP 500. 500 features can be 10.7 MB. Page by `OBJECTID`, not offset, and halve the page size on failure.
- **Label**: a free-text display label. Its exact format was not verified.
- **Envelope query, WGS84 in and out, GeoJSON** (parameter set verified in use: `geometryType=esriGeometryEnvelope`, `inSR/outSR=4326`, `f=geojson`) [S]:

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
- **WMS**: `https://mapprod3.environment.nsw.gov.au/arcgis/services/VIS/SVTM_NSW_Extant_PCT/MapServer/WMSServer`. It has four display layers with scale ranges [S]: 0 = PCT labels (z ≥ 15), 1 = PCT (z 13–14), 2 = vegetation class (z 10–12), 3 = formation (z ≤ 9). WMS returns colours, not codes, so **do not decode classes from WMS**.
- Query exactly as in §4.1, with `outFields=PCTID,PCTName,vegClass,vegForm`. The polygons are dense, so always generalise.
- Licence not verified; likely CC BY 4.0 like other SEED data [K].
- **Join to fuel** [S by inspection]: `lower(vegClass)` = `lower("Fuel name")` in NSW LUT v4.02, which gives FTno 1–76. Heath classes need a mapping [H]:
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

One redistribution (ALA) describes a 0 (unburnt) to 5 (extreme) code scale [S]. Confirm the exact code table in the FESM metadata before decoding. It is on SEED as `fire-extent-and-severity-mapping-fesm`. Method: Gibson et al. (2020), *Remote Sens. Environ.* 240: 111702 [K]. Use it to set the post-fire state (§5.3).

### 4.4 National alternatives

- **Historical Bushfire Boundaries v2.0** (Digital Atlas of Australia / Geoscience Australia; CC BY 4.0) [S]:
  - `https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/Bushfire_Boundaries_Historic_Dec_view/FeatureServer/0`: 311,984 polygons, 1899 to Oct 2023, no NT.
  - Continuation: `…/Historical_Bushfire_Extents_2020%E2%80%9325_View/FeatureServer/3` (July 2020 to June 2025; note the en dash in the name).
  - Live: `…/Near_Real_Time_Bushfire_Boundaries_view/FeatureServer/3` (~3-hourly). This could pre-fill "where the fire is".
  - Fields: `fire_id, fire_name, ignition_date, fire_type, ignition_cause, area_ha, perim_km, state, agency`.
  - Multipart fires repeat the parent `area_ha` on every part. De-duplicate before summing. The historic and 2020–25 layers overlap from 2020 to 2023; cut over at 1 July 2020.
- **NVIS v7.0** (DCCEEW; CC BY 4.0; 100 m rasters, GDA2020 Albers) [S]:
  - Major Vegetation Groups (~31–33 classes) and Subgroups (~80–85).
  - REST: `https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer` (also `NVIS_ext_mvs`, and `NVIS_pre_*` for pre-1750).
  - Too coarse for 10–30 m cells. Use it only as a fallback outside SVTM coverage.
- **AFDRS national fuel type map**: an AFAC/state product whose parameters appear in the LUT above [S]. **Public raster availability not verified.** The NSW state fuel map (v4.02) is similarly unverified for public download.
- **NSW RFS planned hazard-reduction burns**: a community scrape exists (fields `location, lga, size, startDate, endDate, leadAgency`) [S]. It lists *planned* burns only. Do not treat it as burnt area.

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
4. **Fuel state.** For each layer L ∈ {s, ns, el, b, o}: `X_L = X_ss,L·(1 − e^{−k_L·tsf}) + X₀,L·e^{−k_L·tsf}`. Heights H_ns, H_el and H_o come from the LUT; H_el is held constant by default. FHS values come from §3.3.
5. **Derived per-cell properties** passed to the spread model:
   - FHS_s, FHS_ns, H_ns, H_el, FL layers, WAF (`WRF_For`), wet/dry submodel (from AFDRS type), spotting flag, bark class;
   - for heath: `FL_total(t)` and `WF_Heath`;
   - for grass: load and curing (curing belongs to another document).
6. **Cache** everything in IndexedDB, keyed by AOI and data version.

**Cost** [H estimate]:
- A 10 km AOI at 20 m is 250,000 cells. Five layers × float32 is about 5 MB. The Olson evaluation takes well under 50 ms on a phone.
- Rasterising a few hundred polygons takes under 1 s.
- Network payload dominates (MBs). Hence the offline packs.
- Fuel does not change within a 2–6 h scenario, so it adds nothing to the per-timestep budget. Only consumption (burnt, or partially burnt by a low-intensity flank) changes during the run.

**Offline region packs** [H]:
- Pre-bake FTno and a TSF/severity raster for the mountain regions at 20–30 m as tiled Cloud-Optimised GeoTIFF or PMTiles.
- A 50 × 50 km tile at 25 m is 4 M cells: about 8 MB raw uint16, compressing well because classes are patchy.
- Re-bake monthly to track the NPWS update cycle.
- This is essential for Kanangra-Boyd, Wollemi, Kosciuszko and similar areas without coverage.

### 5.2 Fire-type-specific resets (X₀) and post-fire states

Primary data on consumption fractions by layer and severity could not be retrieved. The defaults below are **[H]** placeholders and are editable.

- **Wildfire with FESM high or extreme, or unknown severity**: X₀ = 0 for all layers (the operational convention) [S convention]. If the vegetation is shrubby DSF, heath, subalpine woodland or montane WSF, **switch to the post-fire parameter set**. Use the ACT "2020_" pattern as the template: ns and el steady state ×(2–4), k_ns and k_el 0.4–0.5, k_b 0.02, WRF − 1. Apply it while tsf < 15 yr [H], then revert.
- **Wildfire with FESM low or moderate**, or a **prescribed burn**: model patchiness with coverage fraction `p` (user-editable; placeholder 0.6 [H]). Effective state = p·(reset state) + (1−p)·(pre-fire state).
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

### 5.4 Inputs the user should be able to edit on site

1. **Vegetation/fuel type** (paint brush over cells), including "heath", "rainforest gully" and "grass".
2. **Time since fire**, or **"burnt N years ago"** per polygon, plus fire type and severity.
3. **Layer hazard ratings** as OFHG words (Low … Extreme) for surface, near-surface, elevated and bark. These are converted to loads with §3.3 and back to an equivalent fuel age with t_eq.
4. **Litter depth** in mm (converted at ~0.4 t/ha per mm [S rule of thumb]).
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
- FFDI/FBI thresholds: "Extreme" is FBI ≥ 50 (AFDRS) [K] or FFDI ≥ 50.

Show at most two fuel cards at once and rank them after the terrain cards of doc 01. Every card carries a "Watch for" cue.

| # | Card | Detection | Text |
|---|---|---|---|
| F1 | **Recently burnt: fire should slow** | Front will enter cells with tsf ≤ 3 and rel_s ≤ 0.6, forest or heath type | "This area burnt about {tsf} years ago. The leaf litter is only about {rel_s·100}% of what it will grow to. **Why:** fire needs fine fuel to carry it; less litter means lower flames and slower spread. **Watch for:** grass and regrowth that can still carry fire, and embers landing beyond the burnt area." |
| F2 | **Old burn won't stop it today** | tsf ≤ 5 and (FBI ≥ 50 or FFDI ≥ 50 or U10 ≥ 40 with RH ≤ 15%) | "The old burn helps less on a day like this. Research on big NSW and Victorian fires found that weather mattered more than how long ago an area was burnt. **Why:** in strong wind, embers fly over the burnt patch and sparse fuel still burns." |
| F3 | **Fuel has built up fully** | tsf ≥ t₉₅(surface), forest type | "This bush hasn't burnt for {tsf}+ years, so the litter has reached its maximum (about {X_ss} t/ha, roughly {X_ss/4} cm deep). Extra years don't add much more. Now **dryness and wind** decide how it burns." |
| F4 | **Regrowth thicket: taller flames** | lastSeverity ≥ high (or wildfire, unknown severity) and 3 ≤ tsf ≤ 15 and formation ∈ {DSF shrubby, heath, subalpine, montane WSF}, or H_el ≥ 1.5 m, or FHS_el ≥ 3.5 | "After the last big fire, shrubs and wattles came back **thick**. Dense shrubs {H_el} m tall can make flames about {e^{0.64·H_el}}× taller than in open forest with the same wind. **Why:** shrubs lift the fire off the ground and feed it more air. Recently burnt doesn't always mean safe." |
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

---

## 7. Open questions and uncertainties

1. **Primary fuel curves.** Watson (2011, Part 1 forests and grassy woodlands; Report to NSW RFS, UOW) and the heathland review (Gordon, UOW) could not be opened. The LUT values are presumed to derive partly from them (Cirulis et al.) but are not verified against them. The LUT copy in PyroXL may lag the current RFS production LUT.
2. **LUT version conflicts**: ACT versus NSW rows (subalpine FL_s 9 vs 15; tableland shrubby DSF 11 vs 19); 5018 FL_el is 3 in the national LUT and 6 in the NSW copy; `Hk_ns` entries look corrupted.
3. **Wet-forest FA coefficient**: −0.0175 vs −0.175. Check against the AFDRS technical documentation.
4. **Post-fire state**: does "2020_" mean post-2019–20 wildfire? How long should it persist, and is it valid in NSW mountain classes other than the two ACT types?
5. **Consumption by layer and severity; prescribed-burn patchiness p**: no values retrieved (Penman et al. 2007 has data).
6. **Treatment longevity numbers** for NSW mountains (Price & Bradstock 2010/2012): exact durations need checking. Leverage magnitudes (Price et al. 2015a) need checking.
7. **NPWS service**: whether back-burns are included in wildfire polygons; the `Label` format; `Intensity` codes; CORS; whether `maxAllowableOffset` behaves well on this server.
8. **SVTM**: licence; the full REST layer list (only layer 3 confirmed as vector PCTs); payload sizes for dense 5 m-derived polygons.
9. **Heath class mapping** (Keith heath classes → LUT heath types) needs RFS confirmation.
10. **Public availability of the NSW/AFDRS fuel type rasters.** If available, they would replace the SVTM→LUT join.

---

## 8. References

Primary and operational sources. [S] = content confirmed this session; [K] = cited from knowledge, verify.

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
- Duff TJ, Bell TL, York A (2012/2013) Predicting continuous variation in forest fuel load using biophysical models: a case study in south-eastern Australia. *IJWF*. [S cit.]
- Ellis PFM (2011) Fuelbed ignition potential and bark morphology explain the notoriety of the eucalypt messmate 'stringybark' for intense spotting. *IJWF* 20: 897–907. [K]
- Fairman TA, Nitschke CR, Bennett LT (2016) Too much, too soon? A review of the effects of increasing wildfire frequency on tree mortality and regeneration in temperate eucalypt forests. *IJWF* 25: 831–848. [K]
- Gibson R, Danaher T, Hehir W, Collins L (2020) A remote sensing approach to mapping fire severity in south-eastern Australia using Sentinel 2 and random forest. *Remote Sens. Environ.* 240: 111702. [K]
- Gould JS, McCaw WL, Cheney NP, Ellis PF, Knight IK, Sullivan AL (2007) *Project Vesta – Fire in Dry Eucalypt Forest: fuel structure, fuel dynamics and fire behaviour*. Ensis-CSIRO / DEC WA. [K; equations S via PyroXL]
- Hammill KA, Bradstock RA (2006) Remote sensing of fire severity in the Blue Mountains: influence of vegetation type and inferring fire intensity. *IJWF* 15: 213–226. [K]
- Hines F, Tolhurst KG, Wilson AAG, McCarthy GJ (2010) *Overall Fuel Hazard Assessment Guide*, 4th ed. Fire and Adaptive Management Report 82, DSE Victoria. https://www.ffm.vic.gov.au/__data/assets/pdf_file/0005/21110/Report-82-overall-fuel-assess-guide-4th-ed.pdf [S cit.]
- Keith DA (2004) *Ocean Shores to Desert Dunes: the Native Vegetation of New South Wales and the ACT*. DEC NSW, Hurstville. [K]
- Keith DA, Benson DH (1988) The natural vegetation of the Katoomba 1:100 000 map sheet. *Cunninghamia* 2: 107–143. [K]
- Kenny B, Sutherland E, Tasker E, Bradstock R (2004) *Guidelines for Ecologically Sustainable Fire Management*. NSW NPWS. [K; thresholds S via BFRMP]
- Lake George Bush Fire Management Committee (2018) *Bush Fire Risk Management Plan* (NSW RFS), Table 3.3 Fire thresholds. OCR copy: https://github.com/nicolfamilyfarm/qprc-helper (yourvoice/markdown/…Lake-George-Bush-Fire-Risk-Management-Plan.md) [S]
- McCaw WL, Gould JS, Cheney NP, Ellis PFM, Anderson WR (2012) Changes in behaviour of fire in dry eucalypt forest as fuel increases with age. *For. Ecol. Manage.* 271: 170–181. [K]
- NSW DPE/DCCEEW. NPWS Fire History – Wildfires and Prescribed Burns (SEED). https://datasets.seed.nsw.gov.au/dataset/fire-history-wildfires-and-prescribed-burns-1e8b6; service https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/NPWS_Fire_History/MapServer/0 [S]
- NSW DPE. State Vegetation Type Map (SVTM) Extant PCT. https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer [S]
- NSW DPE/RFS. Fire Extent and Severity Mapping (FESM). https://datasets.seed.nsw.gov.au/dataset/fire-extent-and-severity-mapping-fesm [S]
- Geoffysicist (GitHub user; README asks users to acknowledge the author and NSW RFS), **PyroXL** (AFDRS models, AFDRS fuel LUT, NSW fuel LUT v4.02), workbook `PyroXL_Operational_20250206.xlsm` and `src/vba_scripts/*.bas`. https://github.com/Geoffysicist/PyroXL [S]
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
- bolat-t/spatial-analytics: NPWS fields, quirks, paging.
- resuly/property-scores: envelope query.
- mwhewins/ecoTools: SVTM fields.
- TheKillerKangaroo/BushfireBurnout: SVTM layer 3, BFPL.
- gangerang/bushwalkers-topos: SVTM WMS layers; national near-real-time layer.
- ben-gy/au-bushfires: national historical boundaries.
- dcceew-bdr/eiatest-catalogue and lgruen/izzy-map: NVIS.
- cardat/cardat.github.com: FESM class definitions.
- nicolfamilyfarm/qprc-helper: RFS BFRMP thresholds, APZ fuel rule, OFHG field survey.
