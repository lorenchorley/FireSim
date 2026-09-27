# 04 — Dead fine fuel (leaf-litter) moisture, drought and fuel availability

Status: research note for the FireSim moisture module and its "why" explanations.

Scope:
- dead fine fuel moisture content (FMC) of eucalypt litter, near-surface and elevated dead fuel;
- the operational Australian equations (McArthur Mk5, Vesta / AFDRS);
- process and time-lag models (Matthews 2006 / Koba, Nelson 2000, Van Wagner, WRF-SFIRE), equilibrium moisture content (EMC), rain, dew and night recovery;
- solar radiation, slope aspect, topographic shading and canopy;
- drought indices (KBDI, Mount SDI, Griffiths and McArthur drought factor) and fuel availability;
- psychrometry for belt-weather-kit readings;
- live fuel moisture;
- moisture thresholds for spread, spotting ignition and extinction.

Region: NSW ranges (Blue Mountains, Wollemi, Kanangra-Boyd, Budawangs, Snowy Mountains/Kosciuszko, Brindabellas, Barrington Tops, New England, Warrumbungles).

Companion notes: `01-terrain-fire-behaviour.md` (slope and landform physics, Vesta Mk 2 appendix) and `02-mountain-meteorology.md` (inversions, thermal belts, foehn).

---

## 0. Provenance and confidence tags (read first)

**Research environment.**
- Early in this task the session's shared WebSearch budget ran out.
- The egress proxy blocked every WebFetch host tried: CSIRO Publishing/ConnectSci, research.csiro.au, BoM, Natural Hazards Research Australia, Springer, NCBI, arXiv, ResearchGate, eScholarship, USDA FS, Wikipedia and AFDRS mirrors.
- As a result, **I could not open any primary PDF**.
- The searches that did run confirmed that key sources exist and gave their bibliographic details: Matthews 2014 review; Matthews 2006 model description; Matthews, Gould & McCaw 2010; Matthews et al. 2007; Matthews & McCaw 2006; the AFDRS Fire Behaviour Index Technical Guide; Resco de Dios et al. 2015; the 2024 seven-day below-canopy forecasting system; the 2024 ignition-threshold paper; the Yebra BNHCRC DFMC mapping report.
- Companion note 01 had already confirmed several items from search extracts and open-source code, and they are reused here with that tag: the Vesta/AFDRS FMC equations, the Vesta Mk 2 moisture function and fuel availability, and the Nyman 2015 and Slijepcevic 2018 aspect results.

Every quantitative item is therefore tagged:

| Tag | Meaning |
|---|---|
| **[S]** | Confirmed this session, or in companion note 01, from a source-derived extract, abstract or open-source implementation. |
| **[K]** | A literature equation or value from domain knowledge of the cited primary source that was **not** re-read this session. **Verify against the PDF before hard-coding as "validated".** Coefficients are given exactly as I know them. |
| **[D]** | Derived here: unit conversion, internal-consistency check or numerical evaluation (a Python script was run for every table). |
| **[H]** | A FireSim heuristic or design choice, not a published value. Make it tunable and show it as an assumption. |

No number was invented. Where I am unsure of a published value, I say so and give the source to check.

---

## 1. Executive summary: what matters most for FireSim

1. **Dead fine fuel moisture is the most sensitive weather-driven input to forest spread rate in the dry range.**
   - Vesta Mk 1 moisture function: φ_M = 18.35·M^−1.495 [K]. Going from 7 % to 5 % multiplies ROS by 1.65; going from 7 % to 12 % multiplies it by 0.45 [D].
   - Vesta Mk 2 (as coded in PyroXL) is flatter: φ_M = 1 at ≤ 4.1 %, 0.78 at 7 %, 0.37 at 12 %, and 0 above 24 % [S, D].
   - A 10-point RH error changes FMC by about 1.2–2 points (Vesta slopes 0.124–0.198 %/%RH) [D]. RH is therefore the forcing to get right.
2. **Operational baseline.** Use the Vesta/AFDRS dry-forest equations [S], with M in % and RH in %:
   - Peak (Oct–Mar, 12–17 h): M = 2.76 + 0.124·RH − 0.0187·T
   - Night (≤ 06 h or ≥ 19 h): M = 3.08 + 0.198·RH − 0.0483·T
   - Other daytime: M = 3.60 + 0.169·RH − 0.045·T
   - These are empirical flat-ground, under-canopy, dry-forest relations. They have **no terrain term, no rain term and no memory**.
3. **Mountains need a physically based layer on top.** FMC responds to *fuel-level* temperature and humidity:
   - sun on the slope heats the litter above air temperature, which lowers the humidity in contact with the fuel and so its equilibrium moisture;
   - shade, canopy, horizon, cold-air pools and dew do the opposite.
   - Recommended core: an EMC plus exponential time-lag model per cell (Van Wagner EMC at fuel temperature, two litter layers, rain and dew stores) forced by terrain-resolved radiation, calibrated to reproduce Vesta on flat ground [H].
4. **Aspect effect: measured values** [S]:
   - Slijepcevic et al. (2018): about 3 FMC points on average in dry forest, about 11 in moist forest.
   - Nyman et al. (2015): north-aspect litter peaked at 43.7 °C against 29.8 °C on the south aspect on a 38.9 °C day. North-aspect litter was below fibre saturation on 128 days, south-aspect litter on 49.
5. **Aspect effect: geometry** [D]. At 33.7° S (Katoomba):
   - On 30° slopes on 15 October, afternoon (13–16 h solar) clear-sky beam radiation is 1.29× flat on a NW slope and 0.45× on a SE slope.
   - At the winter solstice a 30° south-facing slope gets 4 % of flat beam radiation all day. Slopes steeper than about 33° get **no direct sun at all** at noon.
   - The aspect contrast is therefore largest in winter, spring and autumn (the prescribed-burning and early-season wildfire periods) and smallest in midsummer, when the south-facing slope still gets 0.82–0.87 of the flat daily beam.
6. **Night recovery is terrain-dependent.**
   - Valley floors under an inversion approach saturation, with dew and fog.
   - The mid-slope **thermal belt** and ridges above the inversion stay warm and dry, so fire keeps burning there overnight.
   - Night Vesta at RH 80 %, 12 °C gives 18.3 %. A "poor recovery" night at RH 40 %, 25 °C gives 9.8 % [D].
7. **Rain.** 1 mm of throughfall holds 1 kg m⁻² of water. On 1 kg m⁻² (10 t ha⁻¹) of litter that is +100 FMC points if absorbed [D]. So a few millimetres through the canopy take litter far above extinction.
   - Recovery then takes hours (exposed, sunny) to days (shaded gully).
   - This is exactly what the drought factor's rain term encodes: with P = 20 mm yesterday, Griffiths DF ≈ 1.3 at KBDI 50; it recovers to ≈ 7.9 after 7 days [D].
8. **Drought (KBDI/SDI → DF → fuel availability) controls how much of the litter bed, bark, logs and wet gully fuel is available.**
   - Vesta Mk 2 availability: FA = 1.008/(1 + 104.9·e^(−0.9306·DF)) [S]. FA = 0.50 at DF 5, 0.87 at DF 7, ≈ 1 at DF ≥ 9 [D].
   - In severe drought the normal "wet gully / south slope as barrier" effect collapses (2019–20).
9. **Spotting.** Ember ignition probability rises steeply as litter dries.
   - The US Schroeder/BEHAVE P_ig gives about 53 % at 6 % and 30 °C, 21 % at 12 %, and 5 % at 20 % [K, D].
   - Use it as a placeholder, flagged, until Australian firebrand-litter data (Ellis 2015; Plucinski & Anderson 2008) are transcribed.
10. **Extinction.** Useful values:
    - Vesta Mk 2 moisture function goes to 0 at 24 % [S];
    - CSIRO grass moisture function goes to 0 at 20 % (wind < 10 km/h) or 24 % (wind ≥ 10 km/h) [K, D];
    - US litter fuel models have Mx = 25–30 % [K].
    - Treat 20–25 % as marginal and > 25 % as no sustained spread in litter [H].
11. **Belt weather kit.** Wet/dry bulb readings must be converted with station pressure from elevation. At 2,000 m (795 hPa) the same readings give RH about 4–5 points higher than at sea level [D].
12. **Forecasting.** Run the cell model forward over hourly forecast T, RH, rain, shortwave and cloud after at least a 3–7 day spin-up, so recent rain and dew are remembered [H].
    - Expect about ±2 points of FMC skill in dry weather and much worse around rain and dew [K; Matthews 2014 review].

---

## 2. Physical mechanisms

### 2.1 What "fuel moisture" is

**Definition.**
- FMC (%) = 100 × (wet mass − oven-dry mass) / oven-dry mass. It can exceed 100 %.
- Australian practice oven-dries at about 100–105 °C for 24 h. Matthews examined the effect of drying temperature on measured FMC [K].

**Bound water vs free water.**
- Below the **fibre saturation point** (FSP, about 30–35 %) water is bound in the cell walls. It exchanges as vapour with the air and follows sorption isotherms (EMC).
- Nyman et al. (2015) used 0.35 kg/kg as FSP [S].
- Above FSP, liquid water fills cell lumens and the pores between particles. It comes from rain, dew or fog drip and dries at a rate limited by evaporation, not diffusion.

**Time lag τ.**
- τ is the e-folding time for the moisture difference to decay under constant conditions: M − E = (M₀ − E)·e^(−t/τ). After one τ, 63.2 % of the difference has gone (Byram 1963; Fosberg 1970) [K].
- US size classes (NFDRS, Deeming et al. 1977; Fosberg & Deeming 1971) [K]:

  | Class | Diameter |
  |---|---|
  | 1-h | < 6.4 mm |
  | 10-h | 6.4–25 mm |
  | 100-h | 25–76 mm |
  | 1000-h | 76–203 mm |

- Individual eucalypt leaves (about 0.2–0.5 mm thick) respond in well under an hour. A **litter bed** responds more slowly because vapour must diffuse through the packed bed and the lower layers are coupled to the soil (Nelson & Hiers 2008; Catchpole et al. 2001) [K].
- **Surface vs profile.**
  - The top 1–2 cm of litter drives surface-fire spread. It is sometimes called surface or "available" litter.
  - The lower profile and duff govern consumption, residence time and smouldering.

**Hysteresis.** Adsorption (wetting) EMC is lower than desorption (drying) EMC by roughly 1.5–2 points. Van Wagner's E_d and E_w in §3.4 differ by this band [D].

### 2.2 Vapour exchange: why temperature and humidity *at the fuel* matter

The fuel equilibrates with the vapour pressure e of the air in contact with it, relative to the saturation vapour pressure *at the fuel's own temperature*, e_s(T_f). So the relative humidity the fuel "feels" is:

`RH_f = 100 · e / e_s(T_f)`.

- **Sunlit litter** is warmer than the air, so RH_f < RH_air and the fuel dries below the air-based EMC. Example [D]: air 25 °C and 30 % RH (e = 9.5 hPa). With litter at 35 °C, RH_f = 16.9 % and Van Wagner E_d falls from 8.8 % to 4.3 %.
- **Radiatively cooled litter at night** (clear, calm) goes the other way: RH_f > RH_air. If T_f < T_dew, dew condenses as liquid water.

This single mechanism explains all of the following:
- sunny afternoon slopes are driest;
- the Vesta "peak" equation predicts lower M than the "day" equation at the same air T and RH;
- south slopes and gullies are wetter;
- open heath dries more than litter under forest;
- dew forms first on exposed fuel.

Byram & Jemison (1943) established the solar-radiation/fuel-temperature/fuel-moisture link experimentally [K].

### 2.3 Liquid water: rain, dew, fog and drying stages

1. **Canopy interception** stores the first ~0.5–2 mm of rain in eucalypt forest [K, range only; verify for NSW forest types]. Keetch & Byram's 5 mm (0.2 in) and Griffiths' 2 mm thresholds encode the same idea at daily scale [K].
2. **Throughfall into litter.**
   - 1 mm of water is 1 kg m⁻². Litter loads of 5–20 t ha⁻¹ are 0.5–2 kg m⁻² [D].
   - So 1–2 mm reaching the surface layer (top ~0.2–0.4 kg m⁻²) can push it to 100 %+.
   - Litter water-holding capacity is of order 150–300 % [K, order of magnitude; Matthews 2006 parameterises it].
3. **Stage-1 drying** (above FSP) is evaporation-limited, so the rate is set by radiation, VPD and wind at the litter surface. Examples [D]:
   - Removing 1.2 mm from a saturated 1 kg m⁻² layer at 0.2 mm h⁻¹ potential evaporation (sunny, exposed) takes about 6 h.
   - Under dense canopy in a gully at 0.03 mm h⁻¹ it takes about 40 h.
4. **Stage-2 drying** (below FSP) is diffusion/time-lag-limited towards the EMC.
5. **Dew.**
   - Net long-wave loss on clear calm nights (~50–60 W m⁻²) bounds condensation at about 0.09 mm h⁻¹, or about 0.9 mm over 10 h [D, using λ = 2.45 MJ kg⁻¹]. Typical dew is less (0.1–0.3 mm) [K, order of magnitude].
   - On a 0.3 kg m⁻² surface layer, 0.2 mm is +67 points [D]. This is an upper bound: under a eucalypt canopy the litter barely cools below air temperature, so dew mostly forms on the canopy and on open grass or heath.
   - Morning dew-wet fuel dries fast once sunlit (stage-1).
6. **Fog/cloud immersion** (Barrington Tops, escarpment, Kosciuszko) adds fog drip. There is no quantitative parameterisation for NSW; treat it as a user toggle [H].

### 2.4 Soil coupling, drought and fuel availability

- The base of the litter bed, duff, bark on stems, logs and live foliage are coupled to soil water.
- In drought:
  - the whole profile dries;
  - fuel that is normally too moist becomes available, including lower litter, gully and wet-forest fuels, and rainforest margins;
  - consumption, intensity, flame residence and ember production rise.
- Drought indices (KBDI, Mount SDI) are soil-water-deficit bookkeeping. The drought factor (DF, 0–10) combines the deficit with recent rain into a fuel-availability multiplier.
- A 2020 study at five Australian sites (Agricultural and Forest Meteorology) examined how soil moisture influences simulated surface and sub-surface litter moisture [S, title only]. Its premise is that sub-surface litter needs a soil boundary condition.

### 2.5 Mountain terrain effects on fuel moisture (the core of this note)

1. **Slope aspect and radiation load** (§3.7 tables).
   - In the southern hemisphere, north- and west-facing slopes receive the most radiation. West and NW slopes are hit hardest in the afternoon, which coincides with peak air temperature and VPD. **NW-facing slopes at 14:00–16:00 (AEST) are the driest places in the landscape on a sunny day** [D + S].
   - South and SE slopes are driest in the morning, if at all.
   - The contrast is geometric and strongly seasonal, and it grows with slope steepness.
   - In NSW midwinter (noon solar elevation 30–36°), steep south slopes are in self-shadow.
2. **Aspect-driven vegetation and soil feedback.**
   - South and SE aspects and gullies carry wetter vegetation (wet sclerophyll, rainforest pockets, ferny understorey). Their denser canopy transmits less radiation, and their deeper soils store more water.
   - This is why Slijepcevic et al. found about 11 points of aspect effect in moist forest against about 3 in dry forest [S].
   - The fuel type map carries part of this. Moisture must still be computed per cell.
3. **Topographic shading (horizon).**
   - Deep sandstone gorges (Grose, Jamison, Kanangra, Wollemi canyons) with 100–300 m cliffs receive direct sun for only a few hours, especially in winter.
   - Compute horizon angles from the DEM. Self-shading from slope alone is not enough [H].
4. **Elevation.**
   - By day in a mixed boundary layer, temperature falls with height (6.5–9.8 K km⁻¹) and the dew point falls about 1.8 K km⁻¹ [K; companion note 02]. RH therefore rises with height, and FMC rises about 0.5–1 point per 300 m [D, from the Vesta slopes].
   - Alpine and subalpine Kosciuszko is cooler and moister, with snow cover into spring, but its fuels burn in drought years (2003, 2019–20) [K].
5. **Night inversions, cold-air pools and the thermal belt** [S, companion note 02].
   - Cold moist air drains into valleys: RH near 100 %, dew and fog, so fuel recovers well.
   - The mid-slope thermal belt stays warm and dry.
   - Ridges above the inversion sit in dry free-atmosphere air, often windy, with little recovery.
   - The State Mine fire (Oct 2013) is a documented example of limited overnight recovery on an elevated fireground [S, companion note 02].
6. **Wind exposure.**
   - Exposed ridges have higher near-surface wind, which speeds drying (the time-lag model's wind term) but also limits radiative heating of the fuel.
   - Sheltered gullies have calm air, high humidity from evapotranspiration, little solar input and low evaporation.
7. **Foehn / lee-side drying.** W–NW flow crossing the Great Dividing Range can bring abrupt warming and RH drops on eastern (lee) slopes, for example the Blue Mountains escarpment and the Snowy eastern fall [S, companion note 02; Sharples et al. 2010]. FMC then follows within the litter time lag of about 1–3 h.
8. **Drought collapses the moisture gradients.** With DF about 10 and KBDI far above normal, gullies and south slopes dry to within a few points of ridges. In 2019–20 fire burnt extensively into normally fire-resistant wet forest and rainforest in NSW (Nolan et al. 2020) [K].

### 2.6 Live fuel moisture (LFMC)

- Eucalypt foliage and heath shrubs typically hold about 70–150 % live moisture [K; Caccamo et al. 2012 (Sydney Basin MODIS LFMC); Pippen 2008].
- LFMC matters most for:
  - heath and shrubland, where dead and live fine fuel are mixed and ignite together;
  - elevated fuel and crown involvement.
- Nolan et al. (2016, GRL) found abrupt increases in fire area in SE Australian forests when dead and live moisture crossed thresholds [K].
  - I recall a DFMC threshold of about 10–13 % and an LFMC threshold of about 100–140 %. **Verify the exact values in the paper.**
- AFDRS forest and heath models do not take LFMC as an input [K]. FireSim should treat it as an editable modifier on elevated/crown involvement and heath flammability, not on litter spread [H].

---

## 3. Quantitative models (equations, units, validity, sources)

**Notation** (used in §3 unless stated):

| Symbol | Meaning | Units |
|---|---|---|
| T | air temperature at 1.2–2 m | °C |
| RH or H | relative humidity | % |
| M | dead fine FMC | % oven-dry weight |
| U₁₀ | 10 m open wind | km/h |
| DF | drought factor | 0–10 |
| I | soil moisture deficit (KBDI or SDI) | mm |

### 3.1 McArthur Mk5 (Noble, Bary & Gill 1980)

**Forest Fire Danger Index** [K]:
`FFDI = 2·exp(−0.450 + 0.987·ln DF − 0.0345·H + 0.0338·T + 0.0234·U₁₀)`
- Check value [D]: T = 30, H = 20, U₁₀ = 30, DF = 10 gives FFDI 34.5.
- The companion Mk5 forest ROS on flat ground is R = 0.0012·FFDI·w (km/h, w fuel load in t/ha) [K].

**Mk5 forest-meter fine fuel moisture** (regression reproducing the meter's moisture scale; Viney 1991, used in later comparisons) [K; verify coefficient 0.1854]:
`M = 5.658 + 0.04651·H + 0.0003151·H³/T − 0.1854·T^0.77`
- Behaves reasonably for H ≤ ~70 %. The cubic term blows up at high RH (27.7 % at 12 °C / 90 %) [D], so do not use it for night or wet conditions.

**McArthur drought factor** (original Mk5 form, Noble et al. 1980) [K]:
`DF = 0.191·(I + 104)·(N + 1)^1.5 / [3.52·(N + 1)^1.5 + P − 1]`, capped at 10.
- N = days since rain; P = rain amount (mm); I = KBDI (mm).

**Grass** (McArthur 1966; CSIRO grassland model, Cheney, Gould & Catchpole 1998) [K]:
- Grass moisture: `M = (97.7 + 4.06·H)/(T + 6.0) − 0.00854·H`
- Moisture function φ_M:
  - M < 12 %: φ_M = e^(−0.108·M)
  - M ≥ 12 % and U₁₀ < 10 km/h: φ_M = 0.684 − 0.0342·M, which reaches zero at M = 20.0 % [D]
  - M ≥ 12 % and U₁₀ ≥ 10 km/h: φ_M = 0.547 − 0.0228·M, which reaches zero at M = 24.0 % [D]
- The grass MC equation is widely reported as the AFDRS grassland dead-FMC equation [K; verify in the AFDRS FBI Technical Guide].

### 3.2 Vesta / AFDRS dry eucalypt forest (Gould et al. 2007; Cheney et al. 2012; Cruz et al. 2021/2022)

**Fine dead surface-fuel moisture** (%) [S: equations and period logic as coded in PyroXL `Vesta2.bas`, companion note 01, citing Cruz et al. 2021; originally Gould et al. 2007]:

| Period | Equation |
|---|---|
| Peak: Oct–Mar, 12:00–17:00, sunny ("dry" submodel) | M = 2.76 + 0.124·RH − 0.0187·T |
| Night: hour ≤ 06 or ≥ 19 | M = 3.08 + 0.198·RH − 0.0483·T |
| Other daytime | M = 3.60 + 0.169·RH − 0.045·T |

Caveats:
- **Period boundaries.** The Field Guide defines the periods in words (afternoon of sunny days, day, night). The printed guide may use sunrise/sunset or "09:00–20:00". Confirm, and confirm whether the times are standard time; NSW daylight saving (AEDT) runs Oct–Apr [K].
- **Domain.** Fitted to dry eucalypt forest litter data, largely from south-west WA (Project Vesta) [K]. Valid for "surface litter under canopy on flat or gentle ground". It has no rain, dew or terrain terms.

Reference values [D]:

| T (°C), RH (%) | Peak | Day | Night | Mk5 regression |
|---|---|---|---|---|
| 15, 80 | 12.4 | 16.5 | 18.2 | 18.6 |
| 20, 60 | 9.8 | 12.8 | 14.0 | 10.0 |
| 25, 40 | 7.3 | 9.2 | 9.8 | 6.1 |
| 30, 30 | 5.9 | 7.3 | 7.6 | 4.8 |
| 30, 20 | 4.7 | 5.6 | 5.6 | 4.1 |
| 35, 15 | 4.0 | 4.6 | 4.4 | 3.5 |
| 40, 10 | 3.3 | 3.5 | 3.1 | 3.0 |
| 42, 6 | 2.7 | 2.7 | 2.2 | 2.6 |

Sensitivities [D]:
- ∂M/∂RH = 0.124–0.198 %/%.
- ∂M/∂T = −0.019 to −0.048 %/°C.

**Moisture functions.**
- **Vesta Mk 1** (Gould et al. 2007; Cheney et al. 2012) [K]: `φ_M = 18.35·M^−1.495`. It equals 1 at M ≈ 7 %.
- **Vesta Mk 2** (as coded) [S]:
  - `φ_M = 0.9082 + 0.1206M − 0.03106M² + 0.001853M³ − 0.00003467M⁴`
  - φ_M = 1 for M ≤ 4.1 and φ_M = 0 for M > 24.
  - The polynomial is continuous at both ends: 0.998 at 4.1 and 0.025 at 24 [D].

| M (%) | 4 | 5 | 6 | 7 | 8 | 10 | 12 | 16 | 20 | 24 |
|---|---|---|---|---|---|---|---|---|---|---|
| Mk 1 φ_M | 2.31 | 1.66 | 1.26 | 1.00 | 0.82 | 0.59 | 0.45 | 0.29 | 0.21 | 0.16 |
| Mk 2 φ_M | 1.00 | 0.95 | 0.87 | 0.78 | 0.69 | 0.51 | 0.37 | 0.20 | 0.17 | 0.03 |

**Fuel availability** (Vesta Mk 2 / AFDRS) [S]:
`FA = 1.008/(1 + 104.9·exp(−0.9306·DF))`
- Values [D]: DF 3 → 0.14; 5 → 0.50; 7 → 0.87; 8 → 0.95; 10 → 1.00.
- Fuel moisture effect: FME = φ_M·FA [S].
- The wet-forest submodel adds a drought-index and slope/aspect term. It was not implemented in the code reviewed [S]. **Get it from the AFDRS FBI Technical Guide.** It is directly relevant to NSW south-slope and gully wet sclerophyll.

**Heath / shrubland dead FMC** (AFDRS uses a shrubland-specific equation from the mallee-heath work of Cruz et al. 2010 and Anderson et al. 2015).

I recall the form `M = 4.37 + 0.161·RH − 0.1·(T − 25) − Δ·0.027·RH`, with Δ = 1 on sunny afternoons (12–17 h, Oct–Mar) and 0 otherwise.

**[K, low confidence — do not ship without checking the AFDRS FBI Technical Guide.]** Until checked, use Vesta for sandstone heath with a flagged note [H].

### 3.3 Simple indices

**Sharples et al. (2009) Fuel Moisture Index** [K]:
`FMI = 10 − 0.25·(T − H)`
- It tracks FMC (%) roughly. Examples [D]: 30 °C / 20 % → 7.5; 40 °C / 8 % → 2.0.
- It is the basis of the "temperature higher than humidity" crossover rule of thumb (FMI < 10 when T > H) [D].

**VPD model** (Resco de Dios et al. 2015, semi-mechanistic fine-litter model) [S, existence]:
- Form: `M = a + b·exp(−c·D)`, with D = vapour pressure deficit (kPa).
- The regional calibration I recall (Nolan et al. 2016, Remote Sensing of Environment) is a = 6.79, b = 27.43, c = 1.05, for daily-mean D [K, moderate confidence].
- Values [D]: D = 1 kPa → 16.4 %; 2 → 10.2 %; 3 → 8.0 %.
- Useful as a cross-check and as the basis for gridded daily DFMC in NSW research [K].

### 3.4 Equilibrium moisture content (EMC)

**Simard (1968)** (as used in US NFDRS; Cohen & Deeming 1985) [K]. T_F is in °F.

| RH range | EMC |
|---|---|
| RH < 10 % | 0.03229 + 0.281073·RH − 0.000578·RH·T_F |
| 10 ≤ RH < 50 % | 2.22749 + 0.160107·RH − 0.01478·T_F |
| RH ≥ 50 % | 21.0606 + 0.005565·RH² − 0.00035·RH·T_F − 0.483199·RH |

**Van Wagner (1987) FFMC** (desorption E_d, adsorption E_w; H %, T °C) [K]:
- `E_d = 0.942·H^0.679 + 11·e^((H−100)/10) + 0.18·(21.1 − T)·(1 − e^(−0.115·H))`
- `E_w = 0.618·H^0.753 + 10·e^((H−100)/10) + 0.18·(21.1 − T)·(1 − e^(−0.115·H))`
- Cross-check [D]: WRF-SFIRE writes the exponential term as 0.000499·e^(0.1H). Since 11·e^(−10) = 0.000499, the two forms agree. WRF-SFIRE's 0.924 leading coefficient appears to be a transposition of Van Wagner's 0.942.

**Comparison with Vesta** [D]:
- At air conditions, Van Wagner E_d is close to the Vesta night and day equations at moderate RH: 30 °C / 30 % gives E_d 7.9 against night 7.6.
- It is lower in extreme dryness: 40 °C / 10 % gives E_d 2.2 against Vesta 3.1–3.5. Vesta was fitted to field litter that rarely falls below about 2.5–3 %.
- Litter heated 3–8 °C above air reproduces the Vesta peak equation from E_d at moderate conditions. This matches the measured north-aspect excess of about 5 °C [S]. **This is the calibration anchor for FireSim's fuel-temperature model.**

**Nelson (1984) Gibbs-energy isotherm** (used inside Nelson 2000 and Matthews 2006) [K]:
- `ΔG = −(R·T_K / W)·ln(H/100)`, with R = 8.314 J mol⁻¹ K⁻¹ and W = 0.018 kg mol⁻¹.
- `EMC = α − β·ln(ΔG)`, with fuel-specific α and β.
- Eucalypt-litter α and β are in Matthews (2006); **not transcribed here**.

**Floor.** Use M_min = 2 % [H]. Van Wagner E_d at fuel temperature can fall below 1 %, which is not seen in field litter.

### 3.5 Time-lag dynamics

**Exact exponential update** (unconditionally stable; use this in the Worker) [K/D]:
```
if M > E_d:      E = E_d        // drying
else if M < E_w: E = E_w        // wetting
else:            no vapour exchange (inside the hysteresis band)
M(t+Δt) = E + (M(t) − E)·exp(−Δt/τ)
```

**Van Wagner drying rate, hourly FFMC form** (Van Wagner 1977; the hourly factor is 0.0579 against 0.581 in the daily FFMC) [K]:
- `k₀ = 0.424·[1 − (H/100)^1.7] + 0.0694·√W·[1 − (H/100)^8]`, with W = wind (km/h).
- `k_d = k₀ · 0.0579·e^(0.0365·T)` (log₁₀ units h⁻¹), so τ = 1/(k_d·ln 10).
- Example [D]: H 30 %, W 10 km/h, T 30 °C gives τ ≈ 4.3 h for the FFMC reference layer (about 1.2 cm deep, 0.25 kg m⁻²).
- Wetting uses the same form with (100 − H) in place of H.

**WRF-SFIRE fuel-moisture model** (Mandel et al. 2014; Vejmelka et al. 2016) [K; values to verify]:
- Classes: 1-h, 10-h and 100-h fuels, each with dM/dt = (E − M)/τ and Van Wagner & Pickett EMCs.
- Rain: if r > r₀, then `dM/dt = (S − M)/T_r · (1 − e^(−(r − r₀)/r_s))`, with:
  - S = 250 % (saturation);
  - T_r = 14 h;
  - r₀ = 0.05 mm h⁻¹;
  - r_s = 8 mm h⁻¹.
- A data-assimilation version exists: arXiv 1309.0159 and 1406.4480 [S, titles].

**Daily FFMC rain** (Van Wagner 1987) [K]:
- For rainfall r₀ > 0.5 mm, r_f = r₀ − 0.5.
- `m ← m + 42.5·r_f·e^(−100/(251 − m))·(1 − e^(−6.93/r_f))`
- If m > 150, add `0.0015·(m − 150)²·r_f^0.5`.
- Cap m at 250.

**Suggested eucalypt litter time lags for FireSim** [H; bracketed by K ranges]:

| Layer | Drying τ (reference) | Wetting τ |
|---|---|---|
| Surface litter (top 1–2 cm) | 1.5 h | 2 h |
| Litter profile | 12 h | 12 h |
| 10-h class (twigs, bark, near-surface dead) | 10 h | 10 h |

- Scale τ with the Van Wagner k₀ dependence on H, W and T (normalised to 1 at 30 °C / 30 % / 5 km/h).
- Evidence for the ranges:
  - Catchpole et al. (2001) and Viney & Catchpole (1991) estimated eucalypt litter response times from field data at the order of hours [K; transcribe the values].
  - Nelson & Hiers (2008) showed litter-bed timelag increases with depth and bulk density [K].

### 3.6 Process-based models

**Nelson (2000)** [S existence; content K]:
- 1-D radial coupled heat and moisture diffusion in a cylindrical stick (the NFDRS 10-h ponderosa pine dowel).
- Surface boundary conditions: sensible heat, radiation (solar and long-wave) and vapour exchange via the Gibbs isotherm.
- Rain: an absorption term with a maximum surface moisture.
- Adapted to 1-h, 100-h and 1000-h fuels by Carlson et al. (2007). It underlies NFDRS-2016 dead fuel moisture. Van der Kamp et al. (2017) generalised it to other stick sizes [S existence].

**Matthews (2006) process-based fine-fuel model** [S description]:
- "Coupled one-dimensional energy and water balance equations through a litter layer, with boundary conditions at the atmosphere above and the soil below". Calibrated with litter samples from two Australian locations.
- Tested in two forest types by Matthews et al. (2007, Canadian Journal of Forest Research 37, 23–35) [S title].
- Processes: radiation below the canopy, sensible and latent heat, vapour diffusion through the bed, rain interception and drainage, condensation (dew) and soil exchange.
- **Koba** (Matthews & McCaw 2006, "A next-generation fuel moisture model for fire behaviour prediction") is its simplified operational derivative [S title].

**Comparative performance.**
- Matthews, Gould & McCaw (2010) compared simple models, including McArthur, Vesta and time-lag types, for eucalypt litter [S title].
- Slijepcevic et al. (2013, 2015) tested existing hourly and daily models in eucalypt forest [K].
- In general, process and time-lag models beat the static regressions after rain and at night. Static regressions are adequate on dry afternoons, with errors of about 1–3 points [K; Matthews 2014 review].
- The 2024 seven-day below-canopy forecasting system (Agricultural and Forest Meteorology) is the closest analogue to FireSim's forecast mode [S title; methods not read].

### 3.7 Radiation, slope, aspect, shading and fuel temperature

**Solar geometry** [K, standard]:
- Declination δ = 23.44°·sin(360°·(284 + n)/365), with n = day of year.
- Hour angle ω = 15°·(t_solar − 12).
- Solar time: t_solar = t_AEST + (λ − 150°)/15 + EoT/60, where EoT is the equation of time in minutes. In AEDT, subtract 1 h first.
- In the Blue Mountains (λ ≈ 150.3° E) solar noon is about 12:00 AEST, which is about 13:00 AEDT.
- Sun unit vector (east, north, up), latitude φ negative in NSW:
  - s_E = −cos δ·sin ω
  - s_N = cos φ·sin δ − sin φ·cos δ·cos ω
  - s_U = sin φ·sin δ + cos φ·cos δ·cos ω
- Surface normal for slope β and aspect a (downhill azimuth): n = (sin β·sin a, sin β·cos a, cos β).
- `cos i = max(0, s·n)`. The beam is blocked if solar elevation < horizon angle(sun azimuth).

**Clear-sky beam irradiance** (for tables and fallbacks) [K]:
- DNI = 1353·0.7^(AM^0.678) (Meinel & Meinel 1976).
- Air mass AM = 1/[sin h + 0.50572·(h + 6.07995°)^−1.6364] (Kasten & Young 1989).

**Cloud and beam/diffuse split** (when only GHI or cloud cover is known) [K]:
- Kasten & Czeplak (1980): G = G_clear·(1 − 0.75·N^3.4), with N = cloud fraction.
- Erbs et al. (1982) diffuse fraction k_d from clearness index k_t:

  | k_t range | k_d |
  |---|---|
  | k_t ≤ 0.22 | 1 − 0.09·k_t |
  | 0.22 < k_t ≤ 0.80 | 0.9511 − 0.1604·k_t + 4.388·k_t² − 16.638·k_t³ + 12.336·k_t⁴ |
  | k_t > 0.80 | 0.165 |

**Diffuse on a slope** (isotropic sky) [K]: D_s = D_h·SVF, with SVF ≈ (1 + cos β)/2 without horizon obstruction; compute it from horizon angles in gorges.

**Canopy transmittance** [K form, H values]:
- Beam: τ_b = (1 − c) + c·exp(−G·Ω·LAI/cos Z).
- Diffuse: τ_d ≈ (1 − c) + c·exp(−0.8·LAI).
- c = canopy cover fraction (FuelMap.canopyCover).
- Defaults: G·Ω ≈ 0.4 for pendulous eucalypt foliage; LAI about 1–1.5 in dry sclerophyll, 2–3.5 in wet sclerophyll, 3–5 in rainforest [H — calibrate].

**Computed clear-sky beam ratios at 33.7° S** [D]. Each cell is slope-to-flat, shown as daily / afternoon (13–16 h solar). Self-shading only, no horizon.

30° slope:

| Date | N | NE | E | SE | S | SW | W | NW |
|---|---|---|---|---|---|---|---|---|
| 21 Dec | 0.87/0.91 | 0.89/0.67 | 0.90/0.54 | 0.87/0.61 | 0.87/0.82 | 0.87/1.07 | 0.90/1.19 | 0.89/1.12 |
| 15 Oct | 1.06/1.07 | 1.02/0.74 | 0.90/0.48 | 0.75/0.45 | 0.67/0.66 | 0.75/1.00 | 0.90/1.25 | 1.02/1.29 |
| Equinox | 1.20/1.20 | 1.11/0.79 | 0.91/0.43 | 0.66/0.32 | 0.53/0.53 | 0.66/0.94 | 0.91/1.30 | 1.11/1.41 |
| 21 Jun | 1.79/1.81 | 1.52/1.07 | 0.93/0.31 | 0.34/0.02 | 0.04/0.02 | 0.34/0.66 | 0.93/1.53 | 1.52/2.00 |

Other checks:
- **15° slope:** in June the ratio is N 1.44 against S 0.50; in December all aspects are about 0.97 daily.
- **Thredbo (36.4° S), 30° slope, June:** N 1.89, S 0.00.
- **Noon solar elevation on 21 June:** Armidale 36.1°, Barrington 34.6°, Katoomba 32.9°, Thredbo 30.2°. A south slope steeper than this gets no direct beam at noon.
- **Hours of direct sun on 21 June at Katoomba:** 7.2 h on a 20° south-facing slope, 3.8 h at 30°, and 0 h at 35°.

**Fuel temperature** (linearised surface energy balance) [K physics, H coefficients]:
```
(1 − α_f)·S_f + ε·(L↓ − σT_a⁴) = (h_c + 4εσT_a³)·(T_f − T_a) + G + λE
```
- α_f ≈ 0.1–0.2 (litter albedo) and ε ≈ 0.95 [K].
- L↓ from Brutsaert (1975): ε_a = 1.24·(e/T_K)^(1/7), with e in hPa [K].
- Convective coefficient h_c from the McAdams plate correlation: h_c ≈ 5.7 + 3.8·u (W m⁻² K⁻¹, u in m s⁻¹ at litter height) [K].

Because conduction into the bed and evaporative cooling are hard to parameterise, FireSim should use a calibrated reduced form [H]:
```
ΔT_f = a_s·S_f/(1 + b_u·u_f) + ΔT_LW
```
- S_f is fuel-level shortwave (after terrain, horizon and canopy), in W m⁻².
- Starting values: a_s = 0.02 K m² W⁻¹ and b_u = 0.5 s m⁻¹.
- u_f = litter-level wind, about 0.1–0.3 × U₁₀ under canopy.
- ΔT_LW = −(0.5–3) K at night: −3 K in the open under clear, calm skies; −0.5 K under canopy; 0 K when overcast.
- **Calibration targets:**
  1. The Vesta peak equation is reproduced on flat ground under typical dry-forest canopy (about 3–8 K excess, §3.4) [D].
  2. North-aspect litter is about +5 K above air on a hot day [S].
  3. The dry-forest north/south difference averages about 3 points [S].

**Illustrative result** of this reduced model [D with H coefficients]:
- Case: 15 Oct afternoon, 30° slopes, dry-forest canopy (τ_b = 0.45), air 25 °C / 30 %.
- Resulting EMC: NW 5.1 %, flat 5.8 %, S 6.6 %, SE 7.1 %. **NW–SE difference: 2.0 points**, consistent with the Slijepcevic 3-point average.
- Winter afternoon (15 °C / 45 %): 9.0 % (NW) against 13.0 % (SE), 4 points.
- Open heath, same winter case: 4.9 % against 12.4 %, 7.5 points.
- These show *direction and seasonality*; calibrate before quoting absolute numbers.

### 3.8 Dew and night-time recovery

- Dew point from e: T_d = 243.12·ln(e/6.112)/(17.62 − ln(e/6.112)), with e in hPa [K; WMO Magnus].
- **Dew condition:** T_f < T_d. Deposition rate [H]: q_dew = min(0.09, 0.02·(T_d − T_f)) mm h⁻¹.
  - Add 100·q_dew·Δt/w_s to the surface-layer liquid store, where w_s is the oven-dry surface-layer mass in kg m⁻² (default 0.3).
  - Cap the surface layer at 60 % [H].
- **Night-recovery reference** (Vesta night) [D]:

  | Conditions | M (%) |
  |---|---|
  | RH 90 %, 12 °C | 20.3 |
  | RH 80 %, 12 °C | 18.3 |
  | RH 60 %, 20 °C | 14.0 |
  | RH 40 %, 25 °C (poor recovery) | 9.8 |
  | RH 20 %, 30 °C (foehn or thermal-belt night) | 5.6 |

- **Terrain modulation at night** comes from the atmosphere module's near-surface T and RH, or a template (companion note 02):
  - valley and cold-pool cells (TPI < −20 m): cooler and moister;
  - thermal-belt band: warmer and drier;
  - ridges: free-atmosphere RH.

### 3.9 Drought indices and drought factor

**KBDI** (Keetch & Byram 1968) [K]:
`dQ = (800 − Q)·(0.968·e^(0.0486·T_F) − 8.30)·dτ / (1 + 10.88·e^(−0.0441·R_in)) × 10⁻³`
- Q in hundredths of an inch (0–800); T_F = daily maximum temperature (°F); R_in = mean annual rainfall (inches); dτ = 1 day.

**Metric KBDI** (used by BoM; Crane 1982; Finkele et al. 2006) [D: derived by exact unit conversion; K: attribution]:
`dK = (203.2 − K)·(0.968·exp(0.0875·T + 1.5552) − 8.30) / (1 + 10.88·exp(−0.001736·R)) × 10⁻³`
- K in mm (0–203.2); T = daily maximum (°C); R = mean annual rainfall (mm).
- The conversion checks: 0.0486·(1.8T + 32) = 0.08748T + 1.5552, and 0.0441/25.4 = 0.001736 [D].
- The evapotranspiration term is ≤ 0 below T = 6.8 °C; set dK = 0 there [D].
- **Rain:**
  - Daily net rain reduces K mm-for-mm after the first 5 mm (0.2 in) of a rain spell is removed.
  - For consecutive rain days the 5 mm is removed once per spell [K].
  - K = max(0, K − net rain).

Daily increment dK (mm/day) for R = 1000 mm [D]:

| K (mm) | 20 °C | 25 °C | 30 °C | 35 °C | 40 °C |
|---|---|---|---|---|---|
| 0 | 1.26 | 2.27 | 3.83 | 6.25 | 10.0 |
| 50 | 0.95 | 1.71 | 2.89 | 4.71 | 7.54 |
| 100 | 0.64 | 1.15 | 1.95 | 3.17 | 5.08 |
| 150 | 0.33 | 0.59 | 1.00 | 1.64 | 2.62 |

Wetter climates dry faster in KBDI, via the denominator. For R = 1400 mm (escarpment) at K = 100 and 30 °C, dK = 2.90 mm/day [D].

**Mount's Soil Dryness Index** (Mount 1972) [K; structure only]:
`SDI_t = SDI_{t−1} + E_t − (P_t − I_t)`
- E_t = evapotranspiration from tabulated values keyed to daily maximum temperature and month.
- I_t = vegetation-class-dependent interception.
- Used operationally mainly in Tasmania; KBDI is used in NSW [K].
- **Coefficient tables not transcribed.** Take them from Mount (1972) or Finkele et al. (2006). For NSW, implement KBDI only [H].

**Griffiths (1999) drought factor** (as implemented nationally by Finkele et al. 2006) [K; one internal check D]:

Rain-recency function x:

| Condition | x |
|---|---|
| P ≤ 2 | 1 |
| N ≥ 1 and P > 2 | N^1.3 / (N^1.3 + P − 2) |
| N = 0 and P > 2 | 0.8^1.3 / (0.8^1.3 + P − 2) |

Limit on x:

| Condition | x_lim |
|---|---|
| I < 20 | 1/(1 + 0.1135·I) |
| I ≥ 20 | 75/(270.525 − 1.267·I) |

- Then x = min(x, x_lim), and `DF = 10.5·[1 − e^(−(I + 30)/40)]·(41x² + x)/(40x² + x + 1)`, capped at 10.
- Variables:
  - I = KBDI (mm).
  - P = total (mm) of a "rain event": consecutive days each with more than 2 mm, within the last 20 days.
  - N = days since that event (0 = within the last 24 h, 9 am to 9 am).
  - With several events, evaluate each and take the one giving the most limiting (smallest) x [K; verify the event-selection rule].
- Internal check [D]: the two x_lim branches meet at I = 20 (0.30581 vs 0.30589). This supports the transcription.

Griffiths DF values [D]. Columns are (N days since the event, P mm):

| I (mm) | no rain in 20 d | (1, 20) | (3, 20) | (7, 20) | (14, 20) | (0, 50) | (3, 50) | (10, 50) |
|---|---|---|---|---|---|---|---|---|
| 0 | 5.5 | 0.8 | 3.5 | 5.0 | 5.4 | 0.1 | 1.4 | 4.5 |
| 25 | 6.5 | 1.1 | 4.9 | 6.5 | 6.5 | 0.2 | 2.0 | 6.3 |
| 50 | 7.9 | 1.3 | 5.7 | 7.9 | 7.9 | 0.2 | 2.3 | 7.3 |
| 100 | 9.5 | 1.4 | 6.4 | 9.1 | 9.5 | 0.2 | 2.6 | 8.1 |
| 150 | 10 | 1.5 | 6.5 | 9.3 | 10 | 0.3 | 2.7 | 8.4 |

**Interpretation for the app.** DF is the operational expression of "how much of the fuel bed is dry enough to burn". Use DF → FA (Vesta Mk 2) to scale:
- available surface and profile load;
- bark and near-surface availability;
- the damping of topographic moisture offsets in drought (§4.2 step 9).

### 3.10 Psychrometry (belt weather kit) and dew point

Formulas (WMO-No. 8, CIMO Guide, Annex 4.B) [K]:
- Saturation vapour pressure over water: `e_w(t) = 6.112·exp(17.62·t/(243.12 + t))` hPa, for −45 to 60 °C.
- Enhancement factor: `f(p) = 1.0016 + 3.15×10⁻⁶·p − 0.074/p`.
- Ventilated psychrometer: `e = f·e_w(T_w) − A·p·(T − T_w)`, with A = 6.53×10⁻⁴·(1 + 0.000944·T_w) K⁻¹. This A is for Assmann-type ventilation; a properly whirled sling psychrometer is similar.
- An ice-covered wet bulb uses e_i and A = 5.75×10⁻⁴.
- RH = 100·e/(f·e_w(T)).
- T_d from §3.8.
- Station pressure from elevation, if not measured: `p = 1013.25·(1 − 2.25577×10⁻⁵·z)^5.25588` hPa [K; ISA]. This gives 899 hPa at 1,000 m and 795 hPa at 2,000 m [D].

Examples (RH %) [D]:

| T / T_w (°C) | 0 m | 1,000 m | 2,000 m |
|---|---|---|---|
| 25 / 15 | 32.7 | 35.1 | 37.3 |
| 30 / 18 | 29.7 | 31.8 | 33.7 |
| 35 / 19 | 19.9 | 22.1 | 24.1 |

A 0.5 °C wet-bulb reading error changes RH by about 3 points at 25 °C [D]. Whirl for at least 1–2 min, in shade, with a clean wick wetted with distilled water [K, standard practice].

### 3.11 Moisture thresholds

| Threshold | Value | Status |
|---|---|---|
| Vesta Mk 2 φ_M → 0 (forest litter extinction in the model) | 24 % | [S] |
| CSIRO grass φ_M → 0 | 20 % (U₁₀ < 10) / 24 % (U₁₀ ≥ 10) | [K, D] |
| US fuel model Mx (Anderson 1982) | FM8 closed timber litter 30 %; FM9 hardwood litter 25 %; FM10 25 %; FM1 grass 12 %; FM4 chaparral 20 % | [K] |
| Litter below fibre saturation, "can burn" (Nyman 2015 usage) | < 35 % (0.35 kg/kg) | [S] |
| Operational "fuel available" threshold used in Victorian studies | ~16 % | [K, verify source] |
| Low-intensity prescribed-burn window, dry eucalypt litter | roughly 10–20 % | [K; Tolhurst & Cheney 1999; verify] |
| Abrupt increase in SE-Australian forest fire area | DFMC ~10–13 %, LFMC ~100–140 % | [K; Nolan et al. 2016 GRL — verify] |
| Ember (firebrand) ignition of eucalypt litter | Strongly moisture-dependent; flaming brands ignite over a wider range than glowing brands | [K qualitative; Ellis 2015; Plucinski & Anderson 2008 — transcribe numbers] |
| Ignition moisture thresholds differ between eucalypt forest types along an aridity gradient | See paper | [S title; Landscape Ecology 2024] |

**Probability of ignition** (Schroeder 1969, as in BEHAVE/BehavePlus) [K; placeholder for embers]:
- `Q_ig = 144.51 − 0.266·T_f − 0.00058·T_f² − T_f·m + 18.54·(1 − e^(−15.1·m)) + 640·m`, in cal g⁻¹, with T_f fuel temperature (°C) and m = M/100.
- `X = (400 − Q_ig)/10` and `P_ig = 0.000048·X^4.3/50`, clamped to 0–1.

Values [D] (P_ig %):

| T_f | 2 % | 4 % | 6 % | 8 % | 10 % | 12 % | 15 % | 20 % | 25 % |
|---|---|---|---|---|---|---|---|---|---|
| 30 °C | 93 | 70 | 53 | 40 | 29 | 21 | 13 | 5 | 1 |
| 40 °C | 99 | 75 | 57 | 43 | 32 | 24 | 15 | 6 | 2 |

This is a US-derived function for a "standard firebrand". Replace or rescale it once Ellis (2015) eucalypt data are transcribed [H].

---

## 4. Implementation recommendations

### 4.1 Module contract

`MoistureModel` runs inside the simulation Worker. For every fire-grid cell and time step it keeps state:

| State | Meaning |
|---|---|
| `mSurf` | surface litter, 0–2 cm |
| `mProf` | litter profile |
| `m10h` | twigs, bark and near-surface dead fuel |
| `liqSurf` | liquid store on the surface layer (mm) |
| `tFuel` | fuel temperature |
| `canopyStore` | canopy interception store (mm) |

It exposes:
- `deadFuelMoisture` (to `FireBehaviourInput.deadFuelMoisture`; currently `mSurf`, optionally load-weighted with `mProf`);
- `availability` (FA from DF, with local drought damping);
- `pIgnition` (to the ember module);
- per-cell **attribution terms** for the insight engine.

It consumes: `WeatherSeries` (hourly T, RH, T_d, wind, cloud, shortwave, precipitation, surface pressure, plus daily history for KBDI), `Terrain` (slope, aspect, TPI, landform), `FuelMap` (type, canopy cover and height, loads) and user `FuelEdit.moistureDelta`.

### 4.2 Algorithm (per step Δt; 60 min in spin-up, 10–15 min in the fire run)

1. **Forcing interpolation.** Interpolate linearly in time between hourly records. Accumulate rain as a rate.
2. **Downscale T and RH to the cell.**
   - Prefer the atmosphere module's lowest-level T and q once it is spun up.
   - Otherwise:
     - T_cell = T_src − Γ·(z − z_src), with Γ = 6.5 K km⁻¹ by day [H].
     - T_d,cell = T_d,src − 1.8·(z − z_src)/1000 [K].
     - At night (sun below horizon, U₁₀ < 4 m/s, cloud < 50 %), apply the cold-pool and thermal-belt template from note 02 [H].
     - Recompute RH_cell.
   - Apply user wind and moisture edits.
3. **Radiation per cell.**
   - Split GHI into beam and diffuse (Erbs).
   - Compute cos i from pre-computed normals.
   - Mask by the horizon from a precomputed 16-azimuth horizon table.
   - Diffuse × SVF, then canopy τ_b and τ_d, giving S_f.
4. **Fuel temperature.** Apply ΔT_f from §3.7, with the night long-wave term.
5. **Fuel-surface humidity.** RH_f = 100·e/e_s(T_f), then E_d and E_w from Van Wagner at (RH_f, T_f).
6. **Rain.**
   - The canopy store fills to S_c = 0.5 + 1.0·c mm [H], where c = canopy cover.
   - Throughfall wets `liqSurf`, and the excess wets `mProf`.
   - Convert with 100·P/w_s.
   - The canopy store evaporates at the potential rate.
7. **Liquid store drying (stage 1).**
   - `liqSurf` evaporates at E_p (Penman with r_a = 100–300 s m⁻¹ at litter level [H]).
   - While `liqSurf` > 0, mSurf = max(FSP, …).
8. **Vapour exchange (stage 2).**
   - Exact exponential update of mSurf towards E with τ_surf, scaled by the Van Wagner k₀ dependence.
   - Same for mProf (τ_prof) and m10h.
   - mProf also relaxes towards a soil-coupled value M_soil(KBDI) [H]: e.g. 30 % at KBDI 0, falling to the surface value at KBDI ≥ 150.
9. **Drought damping of terrain offsets.** Blend the terrain-driven deviations towards the flat-open value with weight w = smoothstep(8, 10, DF) × 0.5 [H]. This represents the "gullies have dried out" regime. It is a heuristic; report it as such.
10. **User edits.** Add `moistureDelta` (percentage points), then clamp M to [2, 250] %.
11. **Outputs.**
    - φ_M (Mk 2 by default, Mk 1 selectable).
    - FA from DF.
    - P_ig at (T_f, mSurf).
    - Attribution: on demand for a tapped cell, re-run the point model with each factor switched off in turn (flat, no canopy, no horizon, no rain history, no night template). Cheap, and it gives exact "why" deltas.
12. **Calibration hook.** At start-up, run a flat, open-canopy-typical reference column over the same forcing and compare with Vesta. If the dry-afternoon bias is more than 1.5 points, adjust a_s within bounds and log it [H].

**Spin-up.**
- ≥ 72 h minimum, 168 h preferred, of hourly history before scenario start (Open-Meteo `past_days`, or the archive for historical scenarios).
- KBDI needs months of daily rain and T_max:
  - fetch 12–24 months of daily data and start from 0 after the wettest month; or
  - accept a user- or agency-supplied KBDI/DF (BoM and NSW RFS publish DF in fire weather forecasts) [H].

### 4.3 Performance budget

| Grid | Cells | Cost per step | Spin-up (168 steps) | 6-h run (36 steps at 10 min) |
|---|---|---|---|---|
| 30 m over 10 km | 111 k | ~10 ms | ~2 s (under 1 s on a 90 m moisture grid) | ~0.4 s |

Figures are [H], assuming 100 ns per cell-step for about 250 flops with 3 `exp` calls on Float32Arrays in V8.

- **10 m fire grid:** compute moisture on a 30 m moisture grid and bilinearly sample. Apply user edits at fire-grid resolution. Radiation and aspect vary little below 30 m, because the DEM is 30 m (SRTM/5 m LiDAR) [H].
- **Horizon angles:** 16 azimuths by sweep (Dozier & Frew-style), O(N·16), about 1–2 s once per terrain, then cached [K algorithm; H cost].
- **Memory:** 8 Float32 fields × 111 k cells ≈ 3.6 MB.
- **Update scope:** only update unburnt cells. Cells inside the fire perimeter are done.

### 4.4 Simplifications and their consequences

| Simplification | Consequence |
|---|---|
| Vesta used only as calibration and fallback, not per-cell truth | Absolute FMC on flat ground may differ from AFDRS by about 1 point. Show "AFDRS-equivalent" alongside. |
| Reduced fuel-temperature model | Aspect contrasts are right in sign and season but uncertain in magnitude (±50 %). Calibrate to the Slijepcevic and Nyman values. |
| No explicit litter-bed vapour diffusion (two lumped layers) | Rain and dew recovery timing is ±50 %. Profile moisture after long rain is uncertain. |
| KBDI only (no SDI), no soil-moisture data assimilation | Drought state is only as good as the rainfall history. Allow a user-entered DF. |
| Night template when the atmosphere is not spun up | Thermal-belt position ±100 m. |
| P_ig from US data | Spotting in eucalypt litter may be over- or under-estimated. Tag it in the UI. |
| No LFMC dynamics | Heath and crown involvement uses a user-set LFMC class. |

### 4.5 User-editable inputs (on site)

- **Weather now:**
  - T and RH directly, or dry and wet bulb (the elevation-aware conversion is automatic);
  - wind, cloud (0–8 octas), "fuel in sun / in shade";
  - "dew or frost on fuel this morning" (yes/no);
  - "fog / cloud on the ridge".
- **Rain:**
  - mm in the last 24, 48 and 72 h;
  - date of the last rain above 2 mm;
  - "KBDI" or "Drought Factor" from the fire weather forecast.
- **Measured fuel moisture** at a point, from a moisture meter or oven-dry sample. It overrides the model locally and spreads to similar cells (same landform/aspect class, within 300 m) with a Gaussian weight. It persists with the model's time evolution as an offset decaying over 6 h [H].
- **Painted moisture offsets** (`FuelEdit.moistureDelta`): "wet gully", "dry ridge", "recently rained here".
- **Canopy density** (open / medium / dense) and "burnt canopy (scorched)": post-fire opening means more radiation and drier fuel.
- **LFMC class:** normal / stressed / severe drought.
- **Advanced:** extinction moisture (default 24 %), time-lag multipliers, fuel-temperature coefficient a_s, moisture-function choice (Mk 1 or Mk 2).

### 4.6 Tests (vitest), from the tables above

- Vesta table values to ±0.01.
- Mk 2 φ_M continuity at 4.1 and 24.
- FA(DF = 5) = 0.504.
- KBDI dK(K = 100, T = 30, R = 1000) = 1.95 mm.
- DF(I = 50, N = 7, P = 20) = 7.9.
- x_lim continuity at I = 20.
- Psychrometer (25/15 °C, 898.7 hPa) gives RH 35.1 %.
- Katoomba 21 June noon elevation = 32.9°.
- A 35° south slope gets 0 h of direct sun on 21 June.
- The exponential update is stable at Δt = 3 h.

---

## 5. Explaining it to a beginner firefighter

**Card format:** short headline, then one or two sentences of "why", then the number the app computed ("litter here ≈ 6 %, 2.5 points drier than the shaded slope opposite").

**Detection runs on:**
- per-cell values sampled along the predicted fire path (next 2 h) and at the user's tapped location;
- each card's attribution terms (§4.2 step 11).

Thresholds are [H] unless tagged.

| # | Card | Detection criteria | Text |
|---|---|---|---|
| 1 | **The sunny slope is the dry slope** | Sun elevation > 15°; cell slope ≥ 10°; cos i ≥ 1.15 × flat; attribution Δ_sun ≤ −1.5 points; GHI ≥ 400 W m⁻² | "This slope faces the afternoon sun. The leaf litter is about {ΔT} °C hotter than the air, which dries it to {M} %, {Δ} points drier than the shady side. Fire that reaches this slope will speed up, and embers landing here catch more easily." |
| 2 | **Shady side: damper, for now** | Aspect 112–248° (SE–SW) or horizon-shaded; slope ≥ 15°; M ≥ M_flat + 2; DF < 9 | "This slope hardly sees the sun at this time of year. Its litter stays {Δ} points wetter, so fire usually slows here. That buys time, but it is not a guarantee: wind and a big fire can still push it through." |
| 3 | **Drought has dried the gully** | DF ≥ 9, or KBDI ≥ 120 mm [H]; cell in gully / wet forest / S aspect; M ≤ 10 % | "Normally this gully is damp and stops fires. After weeks without real rain (drought factor {DF}), even here the litter is {M} % and the deeper fuel and logs are dry. Expect fire to run up the gully, not stop at it." |
| 4 | **Peak burning period** | Local 12:00–17:00 AEST (13:00–18:00 AEDT) on a sunny day in Oct–Mar, and M is within 0.5 of the day's minimum [S period] | "This is the driest part of the day. The litter reached its lowest moisture ({M} %) and will only start to recover after about {time}." |
| 5 | **Valleys recover, slopes don't** | Night; U₁₀ < 4 m s⁻¹; cloud < 50 %; valley M − thermal-belt M ≥ 4 points | "At night cold, damp air drains into the valley and the litter there soaks up moisture ({M_valley} %). Halfway up the slope it stays warmer and drier ({M_belt} %), so fire there can keep burning all night." |
| 6 | **Poor overnight recovery** | Overnight max RH < 60 % [H], or overnight max M < 10 % | "The air never got humid last night, so the fuel didn't recover. The fire will pick up early this morning instead of lying down." |
| 7 | **Dry wind coming down the range** | Wind from 225–340° ≥ 25 km/h; cell on the east (lee) side of the main ridge; RH falls ≥ 10 points in 3 h, or RH < 20 % [H; phenomenon S note 02] | "The westerly is sinking down this side of the range, warming up and drying out. Humidity is dropping fast and the litter follows within an hour or two." |
| 8 | **Dew this morning** | Pre-dawn T_f < T_d; U₁₀ < 2 m s⁻¹; cloud < 30 % | "Dew has wetted the fine fuels. They'll dry within 1–3 hours of the sun reaching them: east-facing slopes first, west and south slopes last." |
| 9 | **Recent rain** | Rain ≥ 2 mm in the last 72 h | "{P} mm fell {N} days ago. The top litter is {M} %, but the drought factor is {DF}. Surface fuel dries in hours on sunny slopes and in days in shady gullies." |
| 10 | **Small shower, big drought** | P < 5 mm and KBDI ≥ 100 | "That shower only wet the surface. The deeper litter, bark and logs are still dry, and the surface will be dry again by this afternoon." |
| 11 | **Embers will start new fires here** | P_ig ≥ 50 % (M ≲ 6–7 %) in the downwind ember zone | "The litter ahead of the fire is so dry ({M} %) that about {P} in 10 embers landing here could start a spot fire. Watch behind you and downwind." |
| 12 | **Too damp to carry** | M ≥ 20 % (litter), or φ_M ≤ 0.2 | "The litter here is {M} %. At this moisture fire struggles to spread through litter unless wind or slope drive it, or a hot fire comes in from drier ground." |
| 13 | **Small moisture change, big speed change** | \|ΔM\| ≥ 2 points along the path and φ_M ratio ≥ 1.3 | "Litter drying from {M1} % to {M2} % makes the fire spread about {ratio}× faster. In very dry fuel every point of moisture matters." |
| 14 | **Heavy fuels are available** | DF ≥ 8 and FA ≥ 0.95 | "Dry soil means logs, bark and the bottom of the litter bed will burn too. The fire will be hotter, throw more embers and take longer to put out." |
| 15 | **Temperature above humidity** | T (°C) ≥ RH (%), i.e. Sharples FMI ≤ 10 [K rule of thumb, D link] | "It is hotter (°C) than it is humid (%). That's a quick field sign that fine fuel is very dry, and fire will be active." |
| 16 | **Your reading differs from the forecast** | Belt-kit RH differs from forecast RH by ≥ 10 points, or T by ≥ 3 °C | "Your belt-kit reading says {RH_obs} %, not {RH_fc} %. That changes litter moisture by about {Δ} points, so FireSim is using your reading here." |
| 17 | **Higher is damper, except at night** | Day: M_ridge − M_valley > +1; night: reversed | "In the day, air is cooler higher up, so the ridge litter is slightly damper. At night that flips: the valley fills with damp air and the ridges stay dry." |

**The "why" line for a tapped cell** is composed from the attribution terms, largest first. For example:

> "6.1 % because: 31 °C / 18 % air gives 7.0 % on flat shaded ground; −1.8 NW-facing slope in afternoon sun; +0.4 light canopy shade; +0.5 cooler at this height; DF 9 means the whole bed is dry (availability 98 %)."

---

## 6. Open questions and uncertainties

1. **AFDRS FBI Technical Guide details to transcribe:**
   - exact period definitions for dry forest (clock times, DST, "sunny");
   - the wet-forest FMC/availability adjustment, which is critical for NSW gullies;
   - the shrubland/heath FMC equation (my recollection is low-confidence);
   - the grassland FMC equation choice.
2. **Aspect magnitudes for NSW.** The measured values (3 and 11 points) are Victorian. No NSW-specific (Blue Mountains sandstone) aspect FMC dataset was found this session. Matthews' Koba-class models and the Yebra/BNHCRC mapping may contain NSW validation.
3. **Eucalypt litter time lags.** Transcribe from Catchpole et al. (2001), Matthews (2006) and Slijepcevic et al. (2013). The FireSim defaults (1.5 h / 12 h) are heuristic.
4. **Ember ignition vs moisture.** Transcribe from Ellis (2015) and Plucinski & Anderson (2008), and the 2024 Landscape Ecology aridity-gradient thresholds. The US P_ig is a placeholder.
5. **Mk5 moisture regression coefficient** (0.1854 vs 0.184) and its original source (Viney 1991 vs Sirakoff 1985).
6. **Nolan et al. (2016) DFMC/LFMC thresholds.** My stated ranges are from memory.
7. **Resco de Dios / Nolan VPD model coefficients** (6.79, 27.43, 1.05): verify, including whether they apply to daily-mean or daily-minimum VPD.
8. **Canopy radiation parameters** for NSW eucalypt forest types (LAI, clumping, G). Nyman et al. (2018) evaluated below-canopy radiation models in SE Australia [K].
9. **Fog drip and cloud immersion** at Barrington Tops, the escarpment and Kosciuszko: no parameterisation found.
10. **Post-fire and back-burn microclimate.** A scorched or open canopy raises litter radiation for years. Only qualitative evidence is known here (e.g. Cawson et al. 2017 on Mountain Ash fire histories [K]).
11. **KBDI initialisation** without a long rainfall record, and the event-selection rule in Griffiths DF.

---

## 7. References

Tag in brackets = verification status of the bibliographic record this session. DOIs and URLs on [K] entries were written from domain knowledge and have not been resolved this session; check them before publishing.

**Operational Australian models, drought and fire danger**
- AFAC / NSW RFS / BoM (2022–23). *Australian Fire Danger Rating System — Fire Behaviour Index Technical Guide.* [S existence] (mirror found: https://fire-edup.com.au/wp-content/uploads/2023/12/fire-behaviour-index-technical-guide-1.pdf)
- Matthews S, Fox-Hughes P, Grootemaat S, Hollis JJ, Kenny BJ, Sauvage S (2019). *Australian Fire Danger Rating System: Research Prototype.* CSIRO Land and Water. [K]
- Gould JS, McCaw WL, Cheney NP, Ellis PF, Knight IK, Sullivan AL (2007). *Project Vesta: Fire in Dry Eucalypt Forest: fuel structure, fuel dynamics and fire behaviour.* Ensis–CSIRO / DEC WA. [S] https://www.researchgate.net/publication/331070845
- Gould JS, McCaw WL, Cheney NP, Ellis PF, Matthews S (2007). *Field Guide: Fuel assessment and fire behaviour prediction in dry eucalypt forest.* Ensis–CSIRO / DEC WA. [S] https://www.publish.csiro.au/book/5991/
- Cheney NP, Gould JS, McCaw WL, Anderson WR (2012). Predicting fire behaviour in dry eucalypt forest in southern Australia. *Forest Ecology and Management* 280, 120–131. doi:10.1016/j.foreco.2012.06.012 [K]
- Cruz MG, Cheney NP, Gould JS, McCaw WL, Kilinc M, Sullivan AL (2022). An empirical-based model for predicting the forward spread rate of wildfires in eucalypt forests. *IJWF* 31, 81–95. doi:10.1071/WF21068 [K]. Code transcription: PyroXL `Vesta2.bas` (see note 01) [S].
- McArthur AG (1966). *Weather and grassland fire behaviour.* Forestry and Timber Bureau Leaflet 100. [K]
- McArthur AG (1967). *Fire behaviour in eucalypt forests.* Forestry and Timber Bureau Leaflet 107. [K]
- Noble IR, Bary GAV, Gill AM (1980). McArthur's fire-danger meters expressed as equations. *Australian Journal of Ecology* 5, 201–203. doi:10.1111/j.1442-9993.1980.tb01243.x [K]
- Cheney NP, Gould JS, Catchpole WR (1998). Prediction of fire spread in grasslands. *IJWF* 8, 1–13. doi:10.1071/WF9980001 [K]
- Keetch JJ, Byram GM (1968). *A drought index for forest fire control.* USDA FS Research Paper SE-38. [K] (URL not verified: https://www.srs.fs.usda.gov/pubs/rp/rp_se038.pdf)
- Crane WJB (1982). Computing grassland and forest fire behaviour, relative humidity and drought index by pocket calculator. *Australian Forestry* 45, 89–97. [K]
- Mount AB (1972). *The derivation and testing of a soil dryness index using run-off data.* Tasmanian Forestry Commission Bulletin 4. [K]
- Griffiths D (1999). Improved formula for the drought factor in McArthur's Forest Fire Danger Meter. *Australian Forestry* 62, 202–206. doi:10.1080/00049158.1999.10674783 [K]
- Finkele K, Mills GA, Beard G, Jones DA (2006). National gridded drought factors and comparison of two soil moisture deficit formulations used in prediction of Forest Fire Danger Index in Australia. *Australian Meteorological Magazine* 55, 183–197. Also BMRC Research Report 119: http://www.bom.gov.au/bmrc/pubs/researchreports/RR119.pdf [K]
- Sharples JJ, McRae RHD, Weber RO, Gill AM (2009). A simple index for assessing fuel moisture content. *Environmental Modelling & Software* 24, 637–646. doi:10.1016/j.envsoft.2008.10.012 [K]
- Tolhurst KG, Cheney NP (1999). *Synopsis of the knowledge used in prescribed burning in Victoria.* DNRE Victoria. [K]
- Anderson WR, Cruz MG, Fernandes PM, et al. (2015). A generic, empirical-based model for predicting rate of fire spread in shrublands. *IJWF* 24, 443–460. doi:10.1071/WF14130 [K]
- Cruz MG, Matthews S, Gould J, Ellis P, Henderson M, Knight I, Watters J (2010). *Fire dynamics in mallee-heath.* Bushfire CRC / CSIRO report. [K]

**Fuel moisture science (Australia)**
- Matthews S (2014). Dead fuel moisture research: 1991–2012. *IJWF* 23, 78–92. doi:10.1071/WF13005 [S] https://dx.doi.org/10.1071/WF13005
- Matthews S (2006). A process-based model of fine fuel moisture. *IJWF* 15, 155–168. doi:10.1071/WF05063 [S description]
- Matthews S, McCaw WL, Neal JE, Smith RH (2007). Testing a process-based fine fuel moisture model in two forest types. *Canadian Journal of Forest Research* 37, 23–35. [S title] https://www.researchgate.net/publication/237866601
- Matthews S, McCaw WL (2006). A next-generation fuel moisture model for fire behaviour prediction. *Forest Ecology and Management* 234S, S91. [S title] https://www.researchgate.net/publication/248428239
- Matthews S, Gould J, McCaw L (2010). Simple models for predicting dead fuel moisture in eucalyptus forests. *IJWF* 19, 459–467. doi:10.1071/WF09005 [S title] https://www.semanticscholar.org/paper/ad3f5aa424fa54b368315beea0974199334e751f
- Matthews S (2009). A comparison of fire danger rating systems for use in forests. *Australian Meteorological and Oceanographic Journal* 58, 41–48. [K]
- Viney NR (1991). A review of fine fuel moisture modelling. *IJWF* 1, 215–234. doi:10.1071/WF9910215 [K]
- Viney NR, Catchpole EA (1991). Estimating fuel moisture response times from field observations. *IJWF* 1, 211–214. [K]
- Catchpole EA, Catchpole WR, Viney NR, McCaw WL, Marsden-Smedley JB (2001). Estimating fuel response time and predicting fuel moisture content from field data. *IJWF* 10, 215–222. [K]
- Slijepcevic A, Anderson WR, Matthews S (2013). Testing existing models for predicting hourly variation in fine fuel moisture in eucalypt forests. *Forest Ecology and Management* 306, 202–215. [K]
- Slijepcevic A, Anderson WR, Matthews S, Anderson DH (2015). Evaluating models to predict daily fine fuel moisture content in eucalypt forest. *Forest Ecology and Management* 335, 261–269. [K]
- Slijepcevic A, Anderson WR, Matthews S, Anderson DH (2018). An analysis of the effect of aspect and vegetation type on fine fuel moisture content in eucalypt forest. *IJWF* 27, 190–202. [S via note 01] https://www.publish.csiro.au/WF/WF17049
- Nyman P, Metzen D, Noske PJ, Lane PNJ, Sheridan GJ (2015). Quantifying the effects of topographic aspect on water content and temperature in fine surface fuel. *IJWF* 24, 1129–1142. [S via note 01] https://www.publish.csiro.au/wf/wf14195
- Nyman P, Baillie CC, Duff TJ, Sheridan GJ (2018). Eco-hydrological controls on microclimate and surface fuel evaporation in complex terrain. *Agricultural and Forest Meteorology* 252, 49–61. [K]
- Resco de Dios V, Fellows AW, Nolan RH, Boer MM, Bradstock RA, Domingo F, Goulden ML (2015). A semi-mechanistic model for predicting the moisture content of fine litter. *Agricultural and Forest Meteorology* 203, 64–73. [S existence] https://escholarship.org/content/qt2kv469rj/qt2kv469rj.pdf
- Nolan RH, Resco de Dios V, Boer MM, Caccamo G, Goulden ML, Bradstock RA (2016). Predicting dead fine fuel moisture at regional scales using vapour pressure deficit from MODIS and gridded weather data. *Remote Sensing of Environment* 174, 100–108. [K]
- Nolan RH, Boer MM, Resco de Dios V, Caccamo G, Bradstock RA (2016). Large-scale, dynamic transformations in fuel moisture drive wildfire activity across southeastern Australia. *Geophysical Research Letters* 43, 4229–4238. [K]
- Nolan RH, Boer MM, Collins L, Resco de Dios V, Clarke H, Jenkins M, Kenny B, Bradstock RA (2020). Causes and consequences of eastern Australia's 2019–20 season of mega-fires. *Global Change Biology* 26, 1039–1041. [K]
- Caccamo G, Chisholm LA, Bradstock RA, Puotinen ML, Pippen BG (2012). Monitoring live fuel moisture content of heathland, shrubland and sclerophyll forest in south-eastern Australia using MODIS data. *IJWF* 21, 257–269. [K]
- Plucinski MP, Anderson WR (2008). Laboratory determination of factors influencing successful point ignition in the litter layer of shrubland vegetation. *IJWF* 17, 628–637. [K]
- Ellis PFM (2015). The likelihood of ignition of dry-eucalypt forest litter by firebrands. *IJWF* 24, 225–235. [K]
- (2024) Moisture thresholds for ignition vary between types of eucalypt forests across an aridity gradient. *Landscape Ecology.* doi:10.1007/s10980-024-01864-6 [S title; authors not verified]
- (2024) Forecasting dead fuel moisture content below forest canopies – A seven-day forecasting system. *Agricultural and Forest Meteorology.* https://www.sciencedirect.com/science/article/pii/S0168192324003307 [S title; authors not verified]
- (2020/21) The influence of soil moisture on surface and sub-surface litter fuel moisture simulation at five Australian sites. *Agricultural and Forest Meteorology.* https://www.sciencedirect.com/science/article/abs/pii/S0168192320303841 [S title; authors not verified]
- Yebra M, et al. *Mapping surface fine fuel moisture content.* BNHCRC final report. https://www.naturalhazards.com.au/sites/default/files/2022-08/BSF07_bnhcrc_final-report-DFMC-%20Yebra%20_FINAL.pdf [S existence]
- Cawson JG, Duff TJ, Tolhurst KG, Baillie CC, Penman TD (2017). Fuel moisture in Mountain Ash forests with contrasting fire histories. *Forest Ecology and Management* 400, 568–577. [K]
- Hines F, Tolhurst KG, Wilson AAG, McCarthy GJ (2010). *Overall fuel hazard assessment guide*, 4th edn. DSE Victoria. [K]

**Fuel moisture science (international, physics, EMC)**
- Byram GM, Jemison GM (1943). Solar radiation and forest fuel moisture. *Journal of Agricultural Research* 67, 149–176. [K]
- Byram GM (1963). *An analysis of the drying process in forest fuel material.* USDA FS Southern Forest Fire Laboratory (unpublished report). [K]
- Fosberg MA, Deeming JE (1971). *Derivation of the 1- and 10-hour timelag fuel moisture calculations for fire-danger rating.* USDA FS Research Note RM-207. [K]
- Deeming JE, Burgan RE, Cohen JD (1977). *The National Fire-Danger Rating System — 1978.* USDA FS GTR INT-39. [K]
- Cohen JD, Deeming JE (1985). *The National Fire-Danger Rating System: basic equations.* USDA FS GTR PSW-82. [K]
- Simard AJ (1968). *The moisture content of forest fuels — I.* Canadian Dept. Forestry & Rural Development, Forest Fire Research Institute, Information Report FF-X-14. [K]
- Van Wagner CE (1977). *A method of computing fine fuel moisture content throughout the diurnal cycle.* Canadian Forestry Service Information Report PS-X-69. [K]
- Van Wagner CE (1987). *Development and structure of the Canadian Forest Fire Weather Index System.* Forestry Technical Report 35. [K] (URL not verified: https://cfs.nrcan.gc.ca/pubwarehouse/pdfs/19927.pdf)
- Van Wagner CE, Pickett TL (1985). *Equations and FORTRAN program for the Canadian Forest Fire Weather Index System.* Forestry Technical Report 33. [K]
- Nelson RM Jr (1984). A method for describing equilibrium moisture content of forest fuels. *Canadian Journal of Forest Research* 14, 597–600. [K]
- Nelson RM Jr (2000). Prediction of diurnal change in 10-h fuel stick moisture content. *Canadian Journal of Forest Research* 30, 1071–1087. [S title]
- Carlson JD, Bradshaw LS, Nelson RM, Bensch RR, Jabrzemski R (2007). Application of the Nelson model to four timelag fuel classes using Oklahoma field observations. *IJWF* 16, 204–216. [K]
- van der Kamp DW, Moore RD, McKendry IG (2017). A model for simulating the moisture content of standardized fuel sticks of various sizes. *Agricultural and Forest Meteorology* 236, 123–134. [S title]
- Nelson RM, Hiers JK (2008). The influence of fuelbed properties on moisture drying rates and timelags of longleaf pine litter. *Canadian Journal of Forest Research* 38, 2394–2404. [K]
- Anderson HE (1990). Moisture diffusivity and response time in fine forest fuels. *Canadian Journal of Forest Research* 20, 315–325. [K]
- Anderson HE (1982). *Aids to determining fuel models for estimating fire behavior.* USDA FS GTR INT-122. [K]
- Rothermel RC (1983). *How to predict the spread and intensity of forest and range fires.* USDA FS GTR INT-143 (fine dead fuel moisture tables and P_ig). [K]
- Schroeder MJ (1969). *Ignition probability.* USDA FS Office Report 2106-1. [K]
- Mandel J, Amram S, Beezley JD, et al. (2014). Recent advances and applications of WRF–SFIRE. *Natural Hazards and Earth System Sciences* 14, 2829–2845. [K]
- Vejmelka M, Kochanski AK, Mandel J (2016). Data assimilation of dead fuel moisture observations from remote automated weather stations. *IJWF* 25, 558–568. [K] (preprints arXiv:1309.0159, arXiv:1406.4480 [S titles])
- Hayes GL (1941). *Influence of altitude and aspect on daily variations in factors of forest-fire danger.* USDA Circular 591. [K]

**Meteorology, radiation and psychrometry**
- WMO (2018, updated 2021). *Guide to Instruments and Methods of Observation* (WMO-No. 8), Vol. I, Annex 4.B. [K] (URL not verified: https://library.wmo.int/idurl/4/41650)
- Kasten F, Young AT (1989). Revised optical air mass tables and approximation formula. *Applied Optics* 28, 4735–4738. [K]
- Meinel AB, Meinel MP (1976). *Applied Solar Energy.* Addison-Wesley. [K]
- Kasten F, Czeplak G (1980). Solar and terrestrial radiation dependent on the amount and type of cloud. *Solar Energy* 24, 177–189. [K]
- Erbs DG, Klein SA, Duffie JA (1982). Estimation of the diffuse radiation fraction for hourly, daily and monthly-average global radiation. *Solar Energy* 28, 293–302. [K]
- Brutsaert W (1975). On a derivable formula for long-wave radiation from clear skies. *Water Resources Research* 11, 742–744. [K]
- Dozier J, Frew J (1990). Rapid calculation of terrain parameters for radiation modeling from digital elevation data. *IEEE Transactions on Geoscience and Remote Sensing* 28, 963–969. [K]
- Sharples JJ (2009). An overview of mountain meteorological effects relevant to fire behaviour and bushfire risk. *IJWF* 18, 737–754. [K; see note 02]
- Sharples JJ, Mills GA, McRae RHD, Weber RO (2010). Foehn-like winds and elevated fire danger conditions in southeastern Australia. *Journal of Applied Meteorology and Climatology* 49, 1067–1095. [K; see note 02]
- Whiteman CD (2000). *Mountain Meteorology: Fundamentals and Applications.* Oxford University Press. [K]

*Numerical tables in this note were produced by scripts that implement the equations exactly as written above (scratchpad `calc.py`, `solar.py`, `calib.py`, `aspect.py`). Re-run them as unit tests once the coefficients have been verified against the primary sources.*
