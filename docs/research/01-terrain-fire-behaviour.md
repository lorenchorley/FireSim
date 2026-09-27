# 01 — Terrain Effects on Fire Behaviour (mountainous NSW)

FireSim research series, document 01. Topic: how slope, landform and aspect change fire behaviour, what the evidence says quantitatively, and how to model and explain it in a phone-based coupled fire–atmosphere simulator.

---

## 0. Provenance and verification tags (read first)

**Research environment.** The research sandbox blocked outbound fetches to most publisher, agency and university hosts (CSIRO, ConnectSci/CSIRO Publishing, USDA FS, AFAC, NSW RFS, arXiv, Wikipedia, ResearchGate). I could not open the primary PDFs directly. The content below comes from three places:

1. search-engine abstracts and extracts of the primary papers and reports (about 60 targeted searches);
2. public open-source code that implements the operational equations. I read it on GitHub and cite the repository and file. This is how the Vesta Mk 2, kataburn, Rothermel and FBP formulas were cross-checked;
3. established literature knowledge. Anything from this category is tagged, so it can be checked against the primary document before it is hard-coded.

Every quantitative statement carries one of these tags:

| Tag | Meaning |
|---|---|
| **[S]** | Confirmed this session from source-derived text: an abstract, an official summary, or an open-source implementation that cites the equation number. |
| **[K]** | A standard literature value from domain knowledge that I could not re-verify this session. **Check it against the cited primary source before relying on it.** |
| **[H]** | A FireSim heuristic or design choice. No primary source gives this number. It is tunable and must be shown to users as an assumption. |

No numbers were invented. Where the literature disagrees, the range is given.

---

## 1. Executive summary: what matters most for FireSim

1. **Slope is the most important terrain variable, and its effect is exponential.** The Australian operational rule (McArthur) says head-fire rate of spread (ROS) doubles for every 10° of upslope: `SF = 2^(θ/10) ≈ exp(0.069 θ)` [S]. A 20° slope gives ×4 and a 30° slope gives ×8. Vesta Mk 2, the current Australian dry-eucalypt forest model, uses this rule for upslope spread [S].
2. **Downslope spread is slowed much less than upslope spread is accelerated.** The CSIRO kataburn correction (Sullivan et al. 2014) is `SF(−θ) = SF(θ) / (2·SF(θ) − 1)`. It never falls below 0.5 of the flat-ground ROS [S]. The symmetric `exp(−0.069θ)` form under-predicts backing spread, giving ×0.25 at −20° where kataburn gives ×0.57. Use kataburn.
3. **Above about 20–25° the physics changes regime.** Flames and hot gases *attach* to the slope, and convective heating ahead of the front becomes dominant [S]. The critical attachment angle is about 24° on open inclines and in trenches (King's Cross), and about 27.5° for a trench with 20° side walls in pine litter [S]. Every operational model is empirical and becomes unreliable above about 20°: a 2026 comparison against 184 lab fires found all models under-predict ROS at slopes above 20° [S]. **FireSim must flag this regime as "beyond the validated model" rather than silently extrapolate.**
4. **Confined terrain (gullies, chutes, chimneys, canyons, saddles) produces eruptive, accelerating behaviour even under constant weather.** The mechanism is a feedback loop: the fire induces flow, the flow speeds the fire, and the fire strengthens the flow (Viegas 2005, 2006; Dold & Zinoviev 2009) [S]. This is the Mann Gulch (1949) and South Canyon (1994) failure mode. In the US, 76% of burnover fatalities from 1990 to 2017 happened in mountainous terrain, typically with crews working upslope or up-canyon of a fire that made a sudden upslope run [S].
5. **Lee slopes behind ridges can produce vorticity-driven lateral spread (VLS, "fire channelling").** Under strong winds a fire on a steep lee slope runs *sideways* across the slope, roughly transverse to the wind, and throws dense spotting downwind. This was first documented in the 2003 Canberra/Alpine fires [S]. Reported trigger ranges: lee slope above about 15–25°, aspect within about 30–40° of the direction the wind blows toward, and wind above about 20–30 km/h [S]. Resolving VLS explicitly needs atmospheric grid spacing of 80 m or less (30 m or less is best) with two-way coupling [S]. FireSim's 100–200 m atmosphere cannot resolve it, so it must be parameterised.
6. **Junction ("jump") fires on slopes are among the most dangerous configurations.** When two fronts, or a spot fire and the main front, meet at a small angle, the junction point accelerates very rapidly. The effect is stronger on slopes, and on steep slopes simulations show only acceleration, with no slowing phase [S].
7. **Terrain changes how spot fires matter.** Lab work shows a hill can slow a fire's combined ROS by up to 5×, but one or two spot fires restore it to flat-ground levels [S]. Field data from south-east Australia show that a steep slope inside the source fire increases maximum spotting distance and the chance of spotting beyond 500 m [S].
8. **Aspect controls fuel dryness.** In south-east Australia, polar-facing (south) and equatorial-facing (north) slopes differ in litter moisture. The aspect effect averages about 3% in dry forest and up to about 11% in moist forest [S]. On a 38.9 °C day, north-aspect litter peaked at 43.7 °C against 29.8 °C on the south aspect [S]. North- and west-facing slopes in the afternoon are the dry, hot, fast slopes.
9. **Topographic position controls severity.** Under extreme weather, ridges in long-unburnt fuel are where crown fire is most likely. Valleys consistently burn less severely because of wind shelter and moister fuels [S]. At night, a *thermal belt* on the mid-slopes (the driest conditions are often 100–200 m above the valley floor) keeps fires active while valley floors and ridge tops quieten [S].
10. **Standards and danger ratings assume gentle terrain.** The AFDRS includes no topographic effect [S]. AS 3959 Method 1 is not valid for effective slopes steeper than 20° downslope [S]. The app should make the gap between "rated danger" and "danger on this slope" explicit to trainees.

---

## 2. Physical mechanisms

### 2.1 Why fire runs uphill

A spreading front advances when the fuel ahead reaches ignition. On a slope three things change.

1. **Geometry and radiation.** Buoyant flames stay near vertical while the ground tilts up toward them, so the flame sits closer to the unburnt fuel and has a larger view factor onto it. Between 0° and 20°, radiative preheating dominates the slope effect in lab beds [S] (Dupuy & Maréchal 2011).
2. **Convection and attachment.** As the slope steepens, fresh air can no longer be entrained from the downslope side of the plume. The plume bends onto the surface (the Coandă effect) and hot gas flows *along* the fuel bed ahead of the front. At 20°, convective heating was already about one third of the net heat flux within 10 cm of the fire line [S]. At 30° the flow pattern reverses: forward flow from the burning zone heats the fuel ahead, whereas at 20° or less a reverse, cooling inflow is seen [S] (Li et al. 2021; Morandini et al. 2018).
3. **Induced upslope wind.** Buoyancy-driven flow runs up the slope and adds to any ambient upslope (anabatic) wind. Because this induced flow grows with fire intensity, feedback appears (see §2.3).

The front's shape also changes. With increasing slope the fireline goes from a U-shape to a V-shape, with fire vortices on both flanks [S] (Silvani et al. 2012). Wider fronts spread faster on slopes: flame length and ROS rise with both slope and fuel-bed width [S] (Li et al. 2021), and fire width strongly modifies the slope effect under light winds, especially on steep slopes [S] (Pimont et al. 2012, FIRETEC). **Implication:** a narrow test fire on a slope underestimates what a wide front on the same slope will do.

### 2.2 Quantitative slope functions

Notation: θ is the slope angle in degrees (positive upslope in the direction of spread), R₀ is the flat-ground ROS, R_θ is the ROS on the slope, and SF = R_θ/R₀.

**(a) McArthur rule of thumb / Noble et al. (1980)** [S]

```
R_θ = R₀ · exp(0.069 θ)                         (Noble, Bary & Gill 1980)
SF(θ) = 2^(θ/10)                                (McArthur 1962/1967 rule; Vesta Mk 2 upslope)
```

- Units: θ in degrees. SF is dimensionless.
- Since ln2/10 = 0.0693, the two forms are the same to three significant figures.
- The McArthur Mk 5 forest ROS equation in Noble et al. (1980) is `R = 0.0012 · FFDI · W` in km/h, with W the fuel load in t/ha, multiplied by `exp(0.069 θ)` [S] (code transcription: fiRetools `forest_behav.R`).
- Validity: the presumed valid domain is −40° ≤ θ ≤ +40°, but Cheney (1981) suggested the relation may not hold beyond 30° because steep slopes usually carry fuel discontinuities (rock, cliff) that impede spread [S] (Cruz, Sullivan & Alexander 2014 review).

**(b) Downslope: kataburn (Sullivan, Sharples, Matthews & Plucinski 2014)** [S]

Premise: a large fire crossing undulating terrain behaves, on average, as if on flat ground. The time gained going up a slope is repaid going down it. For the "linear" interpretation, with equal along-slope distances up and down:

```
2/R₀ = 1/R₊ + 1/R₋   ⇒   SF(−θ) = SF(θ) / (2·SF(θ) − 1)
```

- With McArthur's SF, SF(−θ) → 0.5 as θ → 90°. A downslope fire is never predicted slower than half the flat-ground rate [S].
- The paper also gives a "planar" variant, and it can be built on any upslope correction (Australian, US and Canadian versions were tested). Kataburn matched experimental downslope data better than the existing operational downslope function [S]. I could not retrieve the planar formula, so use the linear form, which is also the one implemented in open-source AFDRS/Spark-style code [S] (wuinity `SpreadModelAFDRS.cs`; PyroXL `Vesta2.bas`).
- Supporting lab evidence: across −47° to +31° with woody fuels, the *minimum* ROS occurred at about −16°, not at the steepest downslope. The lower bound is a backing fire burning downslope, and the upper bound is spread up a vertical fuel array [S] (Butler, Anderson & Catchpole 2007).

**(c) Vesta Mk 2 slope function (Cruz et al. 2021, user's guide eq. 13)** [S, via code]

```
SF = 2^(θ/10)                            for θ > 0
SF = 2^(−θ/10) / (2·2^(−θ/10) − 1)       for θ < 0      (kataburn)
SF = 1                                   for θ = 0
R = R_flat(U10, WAF, fuel, M, DF) · SF
```

This is transcribed from PyroXL (`src/vba_scripts/Vesta2.bas`, function `sf_Vesta2`, which cites "Cruz 2021 eqn 13"). The slope factor multiplies the phase ROS directly. See Appendix A for the full Vesta Mk 2 set as transcribed, with caveats.

**(d) Rothermel (1972) slope factor (US; BehavePlus/FARSITE)** [S]

```
R = I_R · ξ · (1 + φ_w + φ_s) / (ρ_b · ε · Q_ig)
φ_s = 5.275 · β^(−0.3) · (tan θ)²
```

- β is the packing ratio (dimensionless) and θ is the slope angle. Confirmed in `emxsys/behave` `Rothermel.js` (Rothermel 1972 eqs 51 and 78).
- It was calibrated on excelsior beds at 14.0°, 26.6° and 36.9°, so its valid range is 0–37° [S].
- **Additive** with wind. At high wind speeds slope therefore matters *relatively* less than in the multiplicative McArthur/Vesta form. Sharples (2008) reviews scalar and vector wind–slope combinations [S].

**(e) Canadian FBP (Van Wagner 1977; Forestry Canada 1992; Wotton et al. 2009)** [S]

```
SF = exp(3.533 · (GS/100)^1.2),   GS = percent ground slope = 100·tan θ
GS > 70 %  ⇒ use GS = 70 % (SF = 10.0)
```

Rationale for the cap, quoting Van Wagner: above this limit "flames would tend to bathe the slope directly, and fire behaviour would become very intense and unstable" [S]. In other words, the attachment regime.

**Table 1. Slope factor comparison** (computed from the equations above; Rothermel shown as (1+φ_s) with no wind)

| θ (°) | % slope | McArthur 2^(θ/10) | Kataburn at −θ | exp(−0.069θ) at −θ | Rothermel β=0.01 | Rothermel β=0.03 | FBP |
|---|---|---|---|---|---|---|---|
| 5 | 8.7 | 1.41 | 0.77 | 0.71 | 1.16 | 1.12 | 1.21 |
| 10 | 17.6 | 2.00 | 0.67 | 0.50 | 1.65 | 1.47 | 1.55 |
| 15 | 26.8 | 2.83 | 0.61 | 0.36 | 2.51 | 2.08 | 2.07 |
| 20 | 36.4 | 4.00 | 0.57 | 0.25 | 3.78 | 3.00 | 2.86 |
| 25 | 46.6 | 5.66 | 0.55 | 0.18 | 5.57 | 4.28 | 4.11 |
| 30 | 57.7 | 8.00 | 0.53 | 0.13 | 8.00 | 6.03 | 6.22 |
| 35 | 70.0 | 11.3 | 0.52 | 0.09 | 11.3 | 8.41 | 10.0 (cap) |
| 40 | 83.9 | 16.0 | 0.52 | 0.06 | 15.8 | 11.6 | 10.0 (cap) |

Reading the table:

- Up to 20° the models agree to within about ±30%.
- Beyond 20° they diverge, and empirical evidence says they all tend to *under*-predict. In the 2026 Fire Safety Journal comparison, multiplier-type slope corrections did best up to about 20°, and above 20° all models lost accuracy with significant under-prediction. The authors attribute this to slope-driven flow (upslope winds, increased heating) [S].
- **Directional slope.** For spread in azimuth ψ on terrain with slope θ and upslope azimuth ψ_up:

  ```
  θ_d(ψ) = atan( tan θ · cos(ψ − ψ_up) )
  ```

  This is standard geometry [K], and it is what AFDRS/Spark-style implementations use (dot product of upslope and spread vectors) [S].

**(f) Wind–slope combination**

Australian models apply SF multiplicatively to the head-fire ROS computed from wind (Vesta, McArthur). US models add the slope factor to the wind factor and resolve direction by vector addition, giving an "effective wind speed" and an elliptical shape from it (Rothermel; Finney/FARSITE). Sharples (2008) reviewed both families and showed that scalar methods ignore the directionality of wind and slope [S]. The recommended approach for FireSim is in §4.2.

### 2.3 Flame attachment, the trench effect, and eruptive ("blow-up") fire

- **King's Cross, 1987.** A small fire on a wooden escalator in a 30° trench erupted into a flashover of the ticket hall and killed 31 people. Research traced this to the *trench effect*: in an inclined trench the flame and plume attach to the floor and spread very fast [K]. Sharples, Gill & Dold (2010) brought this to wildfire science and proposed trench-induced attachment as a trigger for eruptive bushfires [S]. Wu, Xing & Atkinson (2000) found a critical inclination of 24°, above which plume attachment length rises sharply [S]. Other studies report critical angles of 24–27° [S].
- **Trench in pine litter** (Xie et al. 2017). The critical conditions for eruptive spread were a central slope α = 27.5° with a lateral side-wall slope δ = 20°. ROS increases with both α and δ, and flame attachment causes a rapid transition from a steady, slow phase to a fast phase [S]. *This two-angle criterion (along-gully slope and side-wall slope) maps directly onto DEM-derivable quantities* (§4.3).
- **Burnover analysis** (Lahaye et al. 2018, Southern California). Slopes steeper than about 45% (about 24°) are most prone to flame attachment. The most dangerous firefighter locations were steep, south-west-facing slopes in canyons with shrub fuel [S]. In the southern hemisphere the sun-exposed analogue is north- to north-west-facing. That mapping is my inference [H].
- **Feedback theory.**
  - Dold & Zinoviev (2009) built a model in which the rate of feedback from intensity into spread rate sets a threshold between stable and eruptive spread, with flow attachment on confined slopes as the key mediator [S].
  - Viegas (2005) proposed a positive dynamic feedback between ROS and the fire-induced flow velocity, which produces accelerating ("eruptive") spread under constant ambient conditions. The model was calibrated on canyon lab fires and reproduced two fatal US accidents and one Portuguese accident [S]. Its structure uses a non-dimensional ROS R′ = R/R₀ with parameters a₁, b₁ (from wind-tunnel ROS–wind response) and a₂, b₂ (from eruptive canyon tests) [S]. I did not retrieve the exact closed form; treat it as a template.
  - Viegas (2006) found light, porous fuels far more prone to eruption than heavy, compact fuels [S]. **In NSW terms, fine elevated fuels, heath and shrub understorey are the eruption-prone fuel beds.**
  - Viegas et al. (2025) extend this to *oscillating* head-fire ROS: large-amplitude acceleration and deceleration caused by fire–environment interaction, with separate lab and field parameter sets [S]. Real fires on steep slopes do not settle at a steady ROS.

### 2.4 Landform-specific behaviour

**Gullies, chutes, chimneys and draws.** These combine slope with lateral confinement, which is the trench configuration. Convected gases and wind take the path of least resistance, so chutes, saddles and narrow canyons act like stove-pipe chimneys, even without ambient wind [S] (NWCG S-190). Expect sudden acceleration when a fire burning up a broad slope enters a gully, and expect the gully head to receive intense flame and ember attack. In the Blue Mountains, ridge-top townships have bushland gullies running up between streets, which puts gully heads at the edge of houses. The 2013 Linksview Road fire destroyed 193 houses in Winmalee and Yellow Rock [S]. The gully-head exposure is my synthesis rather than a coronial finding [H].

**Saddles.** Upper winds preferentially flow through the lowest points of a range, and saddles sit at the heads of canyons. Running fires are drawn to saddles, and fire intensity is higher in a saddle than anywhere else along the ridge top [S] (NWCG S-190). Saddles are where fires most readily cross ridges.

**Ridges and crests.**
- *Approaching the crest:* the fire accelerates up the windward slope, and ridge-top winds are faster. Linear theory for low hills gives a fractional speed-up at the crest of about ΔS ≈ 2H/L. H is the hill height and L the half-length at half-height [S (Taylor et al. 1987 recommendation, via review abstract); the coefficient depends on shape: 2-D ridge versus 3-D hill versus escarpment, K].
- *At the crest:* the slope reverses, so the head fire slows. Lab work shows the front *widens laterally* at the ridgeline and enters the lee face as a much wider front, driven by the horizontal separation vortex [S] (Raposo et al. 2015).
- *Lee side:* if the lee slope is steep enough, the flow separates and a recirculating eddy forms, with near-surface wind blowing *upslope* on the lee face. Critical separation slopes are about 15° for rough 2-D ridges and about 20° for axisymmetric hills, lower for rougher (forested) surfaces [S] (Wood 1995 and later studies).
- *VLS / fire channelling:* a lee-slope fire interacting with the separation vortex spreads laterally as a "turbulent finger of flame" along the top of the lee slope. It is bounded upwind by the ridge line and produces intense downwind spotting and deep flaming zones [S] (Sharples, McRae & Wilkes 2012). Published trigger ranges differ, so FireSim should use a fuzzy score:

| Criterion | Values reported | Source |
|---|---|---|
| Lee-slope angle | above about 25°; above about 20°; above 15° in later mapping | Sharples et al. 2012 [S]; summaries [S] |
| Aspect vs wind-to direction | within about 30°–40° | [S] |
| Wind speed | above about 20 km/h (5.5 m/s); about 25–30 km/h | [S] |
| Modelling resolution | 90 m fails; 80 m or less needed; 30 m or less optimal; needs two-way coupling | Simpson et al. 2014 [S] |
| Effect of coupling | upslope ROS up to ×2.7 and lateral ROS up to ×9.5 when fire→atmosphere coupling is on | Simpson et al. 2014 [S] |

In idealised WRF-Fire runs, VLS is highly sensitive to wind speed, wind direction relative to aspect and lee-slope steepness, in broad agreement with the 2003 Canberra empirical thresholds [S] (Simpson et al. 2016). Laboratory and theoretical work attributes the lateral spread to pyrogenic vorticity generated by wind–terrain–fire interaction [S] (Sharples et al. 2015).

**Backing downslope and rolling debris.**
- Backing fires spread slowly but steadily downslope: kataburn gives at least 0.5 R₀.
- Rolling burning material (logs, bark, cones, stumps) can start fires *below* the main fire and below crews building line. This is an NWCG "Watch Out" situation ("on a hillside where rolling material can ignite fuel below") [S]. Fires downslope of the main front then run *uphill* to meet it, creating a junction zone.
- I found no validated quantitative model of rolling-debris ignition. §4.6 gives a clearly labelled heuristic.

**Junction ("jump") fires.**
- Two straight fronts meeting at angle θ₀ produce a very rapid advance of their intersection point, with intense radiation and convection in the closing gap. The intersection ROS peaks right after merging and then decays as the angle opens [S] (Viegas et al. 2012).
- Pure geometry (Huygens, constant normal ROS R) already gives a vertex speed of R / sin(θ₀/2) [K]. At 20° that is ×5.8 and at 40° ×2.9. The convective feedback adds to this.
- Lab experiments on slopes of 0–40° with junction angles of 20–45° show junction ROS and heat release rising faster than either front, and the effect grows with slope [S] (Raposo et al. 2018).
- Field-scale WRF-Fire simulations found the maximum scaled ROS increases with slope, and on higher slopes only acceleration was observed, with no deceleration phase [S] (Thomas, Sharples & Evans 2017).
- Non-symmetric junctions on slopes (motivated by Pedrógão Grande, 2017) are strongly convection-controlled at high slope angles [S] (Raposo et al. 2023). A 2026 scaling law unifies junction ROS surplus across lab and field scales [S].

**Spot fire–terrain interaction.** In 30 lab experiments on a 3 × 4 m bed with a model hill, the hill alone slowed combined ROS by up to 5×. Igniting one or two spot fires restored it to flat-bed levels, and the strongest effect came where spot fires merged with the head fire [S] (Storey et al. 2021). Spotting therefore lets a fire "jump" the slow downslope and valley-crossing phases. Across 338 line-scan observations in south-east Australia (2002–2018), the source-fire area was the strongest predictor of maximum spot distance. A steep slope within the source fire also increased maximum spotting distance and the probability of spot fires beyond 500 m [S] (Storey et al. 2020).

**Cross-valley preheating and spotting.** In narrow valleys a fire on one side irradiates the opposite slope. That dries and preheats its fuel and makes it very receptive to embers, so cross-canyon spotting and area ignition become likely. Wide valleys are much less susceptible except in strong winds [S] (NWCG S-190). A simple estimate for an infinitely wide vertical flame sheet of height H, at horizontal distance d from a receiver facing it:

```
F ≈ ½ · H / √(H² + d²)          (view factor, infinite-strip approximation) [K]
q ≈ τ · E_f · F                  E_f ≈ ε σ T_f⁴ ≈ 0.95·5.67e-8·1090⁴ ≈ 76 kW/m² [K]
```

The flame temperature of 1090 K and emissivity of 0.95 are the AS 3959 Method 2 values, which should be verified. τ is the atmospheric transmissivity, between 0.7 and 1.0. Worked examples: H = 20 m at d = 100 m gives F ≈ 0.10 and q ≈ 7 kW/m²; at d = 300 m, q ≈ 2.5 kW/m².

**Narrow canyons.** Canyons concentrate every effect above: slope on both walls, a channelled valley wind, a chimney at the head, and cross-canyon radiation. Viegas & Pita (2004) coined "eruptive" from lab canyon fires, whose ROS kept rising with time [S]. A 2025 IJWF study mapped the critical canyon geometry for eruptive transition [S].

**Fire shape (length-to-breadth).**
- Flat ground, conifer forest, 10 m open wind W in km/h: `L/B = 1.0 + 0.00120 · W^2.154`, with L/B = 1 at zero wind and about 6.5 at 50 km/h, the upper limit of application [S] (Alexander 1985).
- US midflame wind U in mph: `L/W = 0.936 e^(0.2566U) + 0.461 e^(−0.1548U) − 0.397` [S, via code] (Anderson 1983).
- Spark-style grassland (U₁₀ in km/h): `LBR = 1.1 · U₁₀^0.464` for U₁₀ ≥ 5 km/h, otherwise 1 [S, via code].
- On slopes, fires elongate upslope even with no wind. Viegas (2004) showed that wind and slope must be vectored, and introduced multiple "standard spread directions" [S]. Using the combined wind + slope effective wind to set L:B (the Finney approach) is a reasonable proxy [K].

**Aspect (NSW, southern hemisphere).**
- North, north-west and west aspects receive the most afternoon radiation. Their litter is hotter and drier, and they carry drier forest types.
- South and south-east aspects and gullies are moister. Rainforest in south-east Australia is largely confined to gullies and south-facing slopes, where fuels are usually too wet to carry fire [S].
- Quantitatively [S]:
  - Nyman et al. (2015): north-aspect litter moisture ranged 0.07–1.30 kg/kg against 0.11–1.83 kg/kg on south aspects. Litter was below fibre saturation (0.35 kg/kg) on 128 days on north aspects versus 49 days on south aspects. Peak litter temperature was 43.7 °C (north) versus 29.8 °C (south) on a 38.9 °C day.
  - Slijepcevic et al. (2018): the aspect effect on fine fuel moisture averaged about 3% in dry forest and about 11% in moist forest, the latter partly a vegetation-cover effect.
- These differences decide whether fuel is *available* at all. Aspect-driven moisture patterns affect landscape fuel connectivity more than sub-daily fluctuations at a point [S].

**Topographic position and time of day.**
- Under non-extreme weather, fire severity is patchy and set by topographic position, slope and fuel. Under extreme weather, weather dominates, and crown fire is likeliest on ridges in fuel unburnt for more than 10 years. Valleys burn less severely throughout [S] (Bradstock et al. 2010).
- *Thermal belt:* at night, cold air drains and pools in valleys under an inversion. The layer where the inversion top meets the slope is the warmest and driest, so fuels there stay available and fires keep burning actively through the night [S].
- *Diurnal winds:* upslope (anabatic) and up-valley winds by day, downslope (katabatic) and down-valley winds by night. Typical speeds are a few m/s [K] (Whiteman 2000; Sharples 2009 review [S for scope]). Expect morning "wake-up" as upslope flow sets in on sunlit slopes, and evening transitions when upslope runs stall and backing fires start down drainages.

---

## 3. Case studies (terrain lessons)

| Event | Key facts | Terrain lesson |
|---|---|---|
| **Mann Gulch, Montana, 1949** | 16 men overrun and 13 killed. The fire crossed the gulch and ran up slopes of up to 76% (about 37°). Rothermel (1993) reconstructed the race; reported spread peaks were several hundred ft/min [S; exact peak rate to verify in INT-GTR-299] | Crews upslope of a fire on steep grassy terrain cannot outrun an upslope blow-up. |
| **South Canyon (Storm King), Colorado, 1994** | 14 killed. The fire moved up the drainage at about 3 ft/s (about 3.3 km/h). Upslope runs in live Gambel oak reached **6–9 ft/s (about 6.6–9.9 km/h)** [S] (Butler et al. 1998) | Steep slope plus strong cross-slope wind produced a 2–3× jump from along-drainage to upslope spread, and turned a slow surface fire into a crown fire. |
| **Bucklands Crossing, NZ, 1998** | 8 firefighters burned over during a backburn. Steep slopes, flammable shrub and foehn winds; the likely cause was a blow-up through previously underburnt shrub [S] (Pearce 2007) | Backburn plus steep slope plus turbulent wind means reburn blow-ups. |
| **1994 NSW eastern seaboard fires** | 4 deaths, about 225 homes lost, about 800,000 ha. Sydney, Blue Mountains and Central Coast affected; Como–Jannali worst (91 homes) [S] | Suburban edges set in dissected sandstone gullies. |
| **2001–02 "Black Christmas"** | From 24 Dec 2001, more than 100 fires. 121 homes destroyed statewide, mostly in the lower Blue Mountains and west of Royal NP; about 23 days [S] | Repeated exposure of the same ridge-top/gully interface. |
| **2003 Canberra / Alpine fires** | Dry lightning on 8 Jan (McIntyres Hut, Bendora, Stockyard Spur, Gingera). On 18 Jan: 4 deaths and more than 500 homes lost. First confirmed Australian pyro-tornado, at least F2, which formed in the McIntyres Hut plume near Mt Coree [S] (McRae et al. 2013). Rapid lateral spread across steep lee slopes led to the discovery of fire channelling/VLS [S] | **Lee-slope lateral spread and deep flaming**, and violent coupled pyroconvection over ranges. |
| **2013 Blue Mountains** | State Mine fire: started 16 Oct by an ADF demolition exercise at Marrangaroo. About 55,000 ha and a perimeter of about 190 km, threatening Mt Wilson, Mt Tomah and Bilpin [S]. Linksview Road fire, 17 Oct: power-line ignition; 193 houses destroyed and about 100 damaged in Winmalee and Yellow Rock. Winds gusted 70–100 km/h [S] | Strong westerlies over plateau–gully terrain. Ridge-top suburbs exposed to gully-head fire runs and embers [H interpretation]. |
| **2019–20 Gospers Mountain** | Lightning on 26 Oct 2019 in Wollemi NP. About 512,600 ha, the largest single-ignition forest fire in Australian records [S]. The country is "fractured by creeks, chasms and vertiginous escarpments" and largely inaccessible. Average spread was about 700 m/day, but one day's run was 12 km [S] | Dissected terrain makes direct attack impossible and forces indirect/backburn strategies on terrain-bounded lines. |
| **Mt Wilson backburn → Grose Valley fire** | Lit 14 Dec 2019. Humidity fell and the wind swung easterly to south-westerly at about midday; embers crossed Mt Wilson Rd into the Grose Valley. Homes lost at Mt Wilson, Mt Tomah, Berambing and Bilpin (22 homes and 30 outbuildings attributed to the Grose Valley fire). NSW Coroner findings of 27 Mar 2024 attributed the fire to the backburn [S] | Backburns on ridgelines above deep valleys: a wind change plus spotting into a steep valley gives an uncontrollable upslope and up-valley fire. |
| **Green Wattle Creek** | Lightning. 278,405 ha affecting Warragamba–Buxton–Balmoral. On 19 Dec 2019 volunteers Geoffrey Keaton and Andrew O'Dwyer were killed when a tree fell on their truck near Buxton [S] | Hazards on steep, fire-weakened roadside terrain; secondary impacts. |
| **Currowan** | Lightning, 26 Nov 2019 (Currowan SF). 499,621 ha over 74 days including the Budawangs and Clyde Mountain. PyroCb over Batemans Bay on 31 Dec [S] | Escarpment country feeding coastal plains; pyroconvection. |
| **Dunns Road** | Lightning, 28 Dec 2019 near Adelong. 333,940 ha. Burned from Batlow into Kosciuszko NP on 3–4 Jan 2020 and merged into a megafire of about 600,000 ha [S] | Steep plantation/forest valleys, catastrophic-day runs across ranges. |
| **US burnover fatalities, 1990–2017** | 41 incidents, 96 deaths. **76% in mountainous terrain**, typically with crews upslope or up-canyon when the fire made a sudden upslope run [S] (RMRS-P-78) | The core training message. |
| **US entrapments, 1981–2017** | 166 entrapments involving 1,202 people and 117 fatalities. Four archetypes, one of which is *high fire danger with steep slopes*. Entrapments also occur at low danger and on flat ground [S] (Page et al. 2019) | Terrain is a multiplier, not a precondition. |

---

## 4. Implementation recommendations for FireSim

Target: a fire grid of 10–30 m, an atmosphere of 100–200 m × 20–30 levels, a domain 3–10 km square, run in a Web Worker on a phone, with a 2–6 h scenario finishing in under 1–2 minutes.

### 4.1 Terrain ingestion and pre-processing (run once per scenario)

1. **DEM.** Prefer LiDAR-derived 1–5 m NSW DEMs (NSW Spatial Services / ELVIS portal). Fall back to Copernicus GLO-30 (about 30 m) [K for coverage; verify availability and tile service]. Resample to a **5–10 m analysis grid** even when the fire grid is 20–30 m. Slopes computed at 30 m badly underestimate Blue Mountains escarpments and narrow gullies [H].
2. **Derivatives** on the analysis grid, then aggregated to fire cells:
   - Slope θ and aspect by the Horn (1981) 3×3 method [K].
   - Keep per fire cell: the mean θ, the 90th-percentile θ, and the *cliff fraction* (share of sub-cells with θ > 60°) [H].
   - Cliff-dominated cells become non-fuel barriers for surface spread, but stay sources of ember launch and rolling debris and do not block radiation.
3. **Landform indices:**
   - Topographic Position Index `TPI_r = z − mean(z within radius r)` at r ≈ 150 m (gully/spur scale) and r ≈ 1–2 km (valley/ridge scale). Classify ridge, upper slope, mid-slope, lower slope, valley and flat by ±1 SD thresholds (Weiss 2001 scheme) [K].
   - Plan (contour) curvature κ_p, where negative means convergent or gully, and profile curvature.
   - D8 flow accumulation A, to find drainage lines.
   - **Gully confinement / "trench" metrics** [H]: for each cell on a drainage line, find the side-wall slopes δ_L and δ_R within ±150 m perpendicular to the fall line, and the gully depth h_g (the minimum rise to the side crests). Trench score:

     ```
     T = clamp((min(δ_L,δ_R) − 10°)/10°, 0, 1) · clamp((h_g − 10 m)/20 m, 0, 1)
     ```

     This maps to Xie et al.'s α (along-gully slope) and δ (side-wall slope).
   - **Saddle detection:** morphometric "pass" class from a quadratic fit, a local maximum across the ridge and a minimum along it (Wood 1996 morphometric classes) [K].
4. **Wind-dependent terrain fields**, recomputed when the ambient wind direction changes by more than 20°:
   - lee-exposure (`Δ = |aspect − wind_to|`);
   - upwind ridge height and distance;
   - Jackson–Hunt-type speed-up factor;
   - VLS score (§4.4).
5. **Solar exposure** per cell per 30–60 min: incidence angle from the sun position with slope/aspect and cast shadows (horizon angles precomputed in 16–32 azimuth sectors). This feeds the aspect-dependent fuel moisture in §4.8.

Cost: 10 km at 5 m is 4 M cells. Slope, aspect, curvature and TPI (via summed-area tables) are O(N) at roughly 100–300 ms in typed arrays. Horizon angles in 16 sectors take about 1–2 s once [H estimate]. Cache everything in IndexedDB per site.

### 4.2 Slope in the spread model (per front element, per step)

1. **Directional slope** along the local outward normal n̂ of the front: `tan θ_d = ∇z · n̂`, which is exact for a level-set.
2. **Slope factor:**

   ```ts
   function slopeFactor(thetaDeg: number): number {
     if (thetaDeg >= 0) return Math.pow(2, thetaDeg / 10);     // McArthur / Vesta Mk2
     const s = Math.pow(2, -thetaDeg / 10);
     return s / (2 * s - 1);                                    // kataburn (linear)
   }
   ```

   - Evaluate with the *uncapped* θ_d, but set a **"validated" flag** false when θ_d > 20° or θ_d < −30°. This drives UI warnings.
   - Hard-cap SF at 16 (θ = 40°) for numerical safety [H].
3. **Combining with wind** (recommended hybrid) [H, following Sharples 2008 guidance on vector treatment]:
   - Compute the wind-driven head ROS R_w (Vesta Mk 2 phases) and the ellipse L:B from the 10 m wind.
   - Build a **slope vector** of magnitude `(SF(θ) − 1)·R₀,flat`, pointing upslope, and a **wind vector** of magnitude `R_w − R₀,flat` along the local surface wind. R₀,flat is the no-wind, no-slope ROS (Vesta phase 1 at U = 0).
   - The head direction is the direction of the vector sum. For the head magnitude, use the Australian multiplicative form `R_head = R_w · SF(θ_d,head)` when wind and upslope are within 45° of each other. Otherwise use `R₀,flat + |vector sum|`. Blend linearly between 30° and 60° of misalignment.
   - This preserves Vesta behaviour when wind and slope are aligned (the calibration case) and avoids multiplying a cross-slope wind ROS by a full upslope factor.
   - Derive the ellipse L:B from an *effective wind*: the wind speed that would give R_head on flat ground, found by inverting the Vesta wind function.
4. **Backing and flank:** use the ellipse for directional ROS, then multiply each direction by `SF(θ_d(ψ))/SF(θ_d,head)` so backing fronts going downhill get kataburn and flank fronts on cross-slopes get their own directional slope.
5. **Surface wind** comes from the atmosphere model (§4.4). Use the 10 m open-equivalent for Vesta, with the Vesta WAF of 3–5 [S] for sub-canopy reduction. Allow per-cell WAF edits.

### 4.3 Steep-slope / attachment / eruptive regime (dynamic ROS) [H — explicitly heuristic]

There is no validated field-scale predictive model, so implement a transparent, bounded dynamic amplifier that teaches the mechanism and is clearly marked "indicative".

```
Attachment potential (0..1):
 A = S(θ_d; θc=22°, w=6°) · max(T, 0.4) · Walign
   S(x; c, w) = 1 / (1 + exp(−(x − c)/w·4))                 [logistic around 20–27° lab range]
   T          = trench score (§4.1); open slopes still get 0.4
   Walign     = 1 if the surface wind is within 60° of upslope or U < 10 km/h; 0.5 if opposing and strong

Dynamic ROS for each front segment:
 dR/dt = (R_target − R) / τ(R_target > R ? τ_acc : τ_dec)
 R_target = R_static · (1 + (G_max − 1) · A · E)
 dE/dt    = (A − E)/τ_e                                        [E = "engagement": builds while the fire stays on attaching terrain]
 Defaults: G_max = 2.5 (range 1.5–4), τ_e = 3 min (1–10), τ_acc = 60 s, τ_dec = 120 s
```

- **Why these values:** above 20° all empirical models under-predict [S], so a moderate G_max is defensible. Trench experiments show a step transition [S], so use a logistic around 22° and a trench factor. Field eruptions develop over minutes (South Canyon, Mann Gulch) [S], which sets τ_e. Viegas et al. (2025) show deceleration phases too [S], hence τ_dec.
- **Hard cap:** limit R to 15 km/h in forest [H]. For reference, South Canyon's upslope runs reached about 10 km/h in shrub [S].
- The UI must show "eruptive regime: model indicative only" whenever A·E > 0.3.
- If the phone budget allows, let the 3-D atmosphere's resolved upslope indraft feed back into R_w in place of part of G_max, to avoid double counting. At 100–200 m it will capture only a fraction of the near-surface attachment flow.

### 4.4 Terrain–atmosphere interaction at 100–200 m

What a 100–200 m, 20–30 level atmosphere **can** resolve:
- valley and ridge channelling at km scale;
- the broad plume and indraft;
- diurnal slope and valley circulations, if surface heating is included;
- inversions and cold pools in larger valleys;
- partial ridge speed-up.

What it **cannot** resolve, according to Simpson et al. (2014) [S]:
- VLS, which needs 80 m or less;
- gully-scale flow attachment;
- small lee eddies behind 50–150 m spurs.

Parameterise these on the fire grid:

1. **Ridge speed-up:** `U_ridge = U_upwind · (1 + ΔS)` with `ΔS = min(2H/L, 1.0)` for resolvable-but-smoothed ridges [S for 2H/L on low hills; cap H]. Apply only where the atmosphere's own speed-up is lower. That can be diagnosed by comparing the atmosphere's crest/upwind ratio with the analytic value.
2. **Lee separation diagnostic** [H]: if the lee slope exceeds 18° (range 15–20° [S]) and the crest wind is above 15 km/h, set a recirculation zone on the lee slope extending from the crest to the break of slope, or at most 5 ridge heights. Its near-surface wind is directed *upslope* at 0.2–0.4 × the crest wind [H, uncertain]. Low-intensity fires on lee slopes then back *toward* the ridge, which is realistic but counter-intuitive and makes a good teaching point.
3. **VLS trigger score** [H using S ranges]:

   ```
   V = S(θ_lee; 20°, 5°) · S(40° − Δ; 0, 10°) · S(U_crest; 25 km/h, 5 km/h) · I_active
   ```

   Δ = |aspect − wind_to|. I_active = 1 if the lee cell is burning at an intensity above about 4,000 kW/m² [H].

   Where V > 0.5, apply lateral spread along the ridge-parallel direction at 3–10 × the local flank ROS [H, anchored on Simpson 2014's lateral factor of up to 9.5 [S]]. Inject a dense ember source downwind (hand-off to the ember module).

   Better but more costly: the **near-field vorticity approach** of Sharples & Hilton (2020), which reproduces VLS patterns in a 2-D spread model [S].
4. **Fire-induced indraft at fire-grid scale: pyrogenic potential** (Hilton et al. 2018) [S]:

   ```
   ∇²ψ = α · I(x)       (Poisson equation; the forcing is proportional to local fire intensity)
   u_p = ∇ψ              (near-surface inflow velocity added to the ambient wind in the spread model)
   ```

   Hilton et al. show this reproduces parabolic head shapes, attraction between nearby fires, and the closing of V-shaped (junction) fires, "orders of magnitude faster than CFD" [S]. Solve with multigrid on the fire grid (for example 512²) every 30–60 s of model time, at roughly 5–20 ms per solve in JS or WASM [H estimate]. α must be calibrated (Hilton et al. give values; not retrieved). This is the cheapest credible mechanism for junction acceleration and spot fire coalescence.
5. **Diurnal slope winds:** if the atmosphere has a surface energy balance, they emerge. If not, add a diagnostic anabatic component of 1–3 m/s upslope on sunlit slopes from mid-morning to late afternoon, and a katabatic 0.5–2 m/s downslope component after sunset [K ranges, Whiteman 2000; verify].
6. **Thermal belt:** diagnose from the model temperature profile. Where a valley inversion exists, cells within ±50 m of the inversion-top elevation get T = T_max(profile) and RH from it, which drives the night-time FMC used by the fuel module [S phenomenon; H implementation].

### 4.5 Junctions and spot fire coalescence

- Detect junctions geometrically: two front segments (from different fires or a spot fire) closer than 3 cells, with an included angle θ₀ < 60°.
- Pyrogenic potential (§4.4) produces the acceleration naturally. If it is disabled, apply a vertex boost of `min(1/sin(θ₀/2), 6)` [K geometry], decaying over about 5 min [H], multiplied by SF(θ_d) on slopes. This reflects the stronger junction effect on slopes [S].
- Always raise the "junction zone" insight card.

### 4.6 Rolling debris (heuristic) [H]

- Source: burning cells with θ > 25° and a heavy-fuel attribute (bark or log load, user-editable).
- Launch rate: `λ = λ₀ · S(θ; 30°, 4°) · f_heavy` per cell-minute, with λ₀ ≈ 0.02 [H].
- Transport: move each item down the fall line (D8 path) until the local slope falls below 15°, or it is stopped by a random obstruction. The stopping probability per 10 m is `p = 0.05 + 0.3·understorey_density` [H].
- Ignition at the stop point: probability `P_ign = f(FMC)`, shared with the ember module's litter-ignition function.
- Show trajectories as thin downhill streaks. The educational value is large and the physics claim is modest.

### 4.7 Cross-valley radiant preheating [K physics, H thresholds]

- For each burning cell with flame height H_f (from the fuel module), cast rays at 8–16 azimuths across the DEM up to 400 m, with line of sight from the flame mid-height.
- Accumulate the incident flux q with the strip view factor of §2.4, times a cos-incidence term for the receiving slope.
- Effects on receiving cells:
  - reduce dead FMC by `ΔM = k · ∫q dt`, with k chosen so that 10 kW/m² for 5 min removes about 2 percentage points [H];
  - raise ember ignition probability accordingly;
  - trigger direct ignition only if q > 20 kW/m² for more than 60 s [H; flux thresholds for fine fuels need a primary source].
- Cost: sampling at most 2,000 active cells × 16 rays × 40 steps ≈ 1.3 M ops per update, every 60 s. Negligible.

### 4.8 Aspect, topography and fuel moisture/availability

- Dead fine FMC per cell uses the fuel module's model (for example Vesta Mk 2 / Gould et al. FMC equations, Appendix A), plus a **radiation-driven aspect correction**: `ΔM_aspect = −c · (I_cell − I_flat)/I_flat` [H].
- Calibrate c so that fully shaded south aspects in dry forest average about +3 percentage points against north aspects at mid-afternoon, which matches Slijepcevic et al.'s ~3% dry-forest average [S]. Allow up to about +8–11 in moist forest and gully cells [S].
- Litter temperature on exposed north aspects can exceed air temperature by about 5 °C or more (Nyman: 43.7 °C at an air temperature of 38.9 °C) [S]. Use it in the moisture model's fuel temperature.
- Fuel type and load by topographic position: default gully and valley cells with κ_p < 0 and A large to moist forest (higher load, higher moisture, lower availability until drought). Default ridges and N/NW upper slopes to dry sclerophyll or heath [H, consistent with S observations]. The user can override.
- Fuel age: time since fire from NSW fire history (wildfire plus prescribed burn) mapping feeds the fuel module's accumulation curves. The crown fire likelihood on ridges rises with fuel age above 10 years (Bradstock et al. 2010) [S].

### 4.9 Performance budget (indicative) [H]

| Component | Grid | Step | 6 h cost estimate |
|---|---|---|---|
| Level-set narrow band (spread) | 500² at 20 m (10 km) | CFL: Δt ≤ 0.5Δx/R_max; for 3 m/s, Δt ≈ 3 s (adaptive, usually 5–20 s) | about 2–5 k steps × 20–50 k band cells ≈ 1–2.5 × 10⁸ cell-updates ≈ 5–15 s JS |
| Terrain lookups | precomputed | per update | O(1) per cell |
| Pyrogenic potential | 256–512² multigrid | 60 s | 360 solves × 10 ms ≈ 4 s |
| Atmosphere | 67×67×25 at 150 m | 5–10 s acoustic-filtered | 20–40 s (shared with the atmosphere doc budget) |
| Radiant, rolling, VLS diagnostics | sparse | 60 s | < 2 s |

Keep all terrain fields in `Float32Array`/`Uint8Array` and use SharedArrayBuffer between workers where available. Run spread at 20–30 m by default, and switch to 10 m in a 2–3 km window around the user.

### 4.10 Simplifications and their consequences

| Simplification | Consequence | Mitigation |
|---|---|---|
| Empirical SF beyond 20° | Likely under-prediction on steep slopes [S] | Attachment amplifier (§4.3) plus a "beyond validation" flag |
| VLS not resolved at 150 m [S] | Would miss lateral lee-slope runs and deep flaming | Rule-based score plus vorticity or pyrogenic parameterisation |
| Slope aggregated to 20–30 m cells | Smoothed gullies and cliffs | 5 m analysis grid, P90 slope, cliff masks |
| Rolling debris and radiant thresholds heuristic | Timing and probability of ignition below or across uncertain | Present as "possible", with probability shading |
| Kataburn assumes large fires on undulating terrain [S] | Small fires on long uniform downslopes may back slower | Acceptable for teaching; note in card |

### 4.11 Inputs the user should be able to edit on site

- **Terrain overrides:**
  - paint "this gully is steeper or more enclosed" (a trench score multiplier);
  - mark rock or cliff (non-fuel) and roads or tracks (fuel breaks);
  - mark a "saddle".
- **Local wind:** point overrides of direction and speed ("wind here is funnelling up the gully"), which the model blends with a radius of about 200 m. Also a lee-eddy on/off toggle.
- **Fuel:**
  - surface litter load or hazard;
  - near-surface and elevated fuel height and cover (Vesta H_u);
  - bark hazard (for embers and rolling debris);
  - "recently burnt" polygons with years since fire or backburn date;
  - moisture offset for this slope (felt dry or damp).
- **Fire:**
  - mark fire edges and spot fires;
  - "fire has jumped here";
  - mark a backburn line and its ignition time.
- **Model switches:** attachment amplifier (off / default / high), pyrogenic potential on/off, VLS on/off, and G_max slider (1.5–4) in "explore" mode.

---

## 5. Explaining it to a beginner firefighter

Principles for the cards:
- Trigger on *terrain ahead of the active front*: look ahead 10–30 min of predicted travel, or 300–1,000 m.
- Show at most 2 cards at a time, ranked by danger.
- Every card has a short **"Why"** and a **"Watch for"**.
- Numbers in cards are rounded and hedged ("about", "can").

**Table 2. Insight cards with detection criteria** (θ_d is the directional slope in the spread direction; Δ_wu is the angle between wind-to direction and upslope; U is wind speed in km/h; FMC is dead fine fuel moisture)

| # | Card title | Detection (all must hold unless noted) | Card text (plain language) |
|---|---|---|---|
| 1 | **Fire will speed up uphill** | Front heading into θ_d ≥ 8° for ≥ 100 m | "This slope is about {θ}°. Fire roughly **doubles its speed every 10° uphill**, so here it could move about {SF}× faster than on flat ground. **Why:** flames lean onto the slope and preheat the fuel above, and hot air rushes uphill ahead of the flames. **Watch for:** flames leaning uphill, smoke sweeping up the slope." |
| 2 | **Wind and slope are working together** | θ_d ≥ 8° and Δ_wu ≤ 45° and U ≥ 15 | "Wind is blowing **up** this slope. The two effects stack, and this is the fastest, most dangerous direction the fire can travel. **Why:** wind tilts flames further onto the unburnt fuel that the slope already brings closer." |
| 3 | **Steep slope: flames may 'stick' to the ground** | θ_d ≥ 22° (P90 slope) along ≥ 60 m, fire below | "Above about 20–25°, flames and hot gases can **attach** to the slope and race up it. Our model is **less certain here**, and real fires usually go faster than predicted. **Why:** air can't get in under the flames from below, so the plume hugs the slope. **Watch for:** flames lying flat along the ground uphill, sudden roaring." |
| 4 | **Gully / chimney ahead** | Trench score T ≥ 0.5 and gully axis slope ≥ 15° and fire within 300 m of gully base or entering it | "This gully can act like a **chimney**. Fire entering it can **accelerate suddenly even if the weather doesn't change**. **Why:** the gully walls funnel heat and indrafted air upward, and the faster the fire goes the more air it pulls, which is a runaway loop. Never be in or above a gully with fire below." |
| 5 | **Eruptive behaviour now** | Model A·E > 0.3 and dR/dt > 0 sustained ≥ 2 min | "The fire is **accelerating on its own**. This is how 'blow-ups' start: it happened at Mann Gulch (1949) and South Canyon (1994), where crews upslope were overrun. **Why:** the fire's own wind is feeding it." |
| 6 | **You are upslope of the fire** | User GPS above (Δz > 20 m) and within 1 km upslope of an active front, θ ≥ 10° between them | "You are **above** the fire. Uphill fire can outrun you: walking uphill at 20° is only about 1.4 km/h on good ground, slower in bush. Most US firefighter burnover deaths happened on slopes to crews working upslope of a fire. Check your escape route **now**." (Tobler walking estimate [K]; 76% statistic [S]) |
| 7 | **Saddle ahead** | Front within 500 m of a detected saddle on the ridge it is climbing | "Fire and wind are **drawn to saddles**. Expect the most intense fire on this ridge in the saddle, and expect the fire to cross the ridge here first. **Why:** wind squeezes through the lowest gap and the saddle is the top of the gullies feeding it." |
| 8 | **Ridge top: faster wind, then a change** | Front within 200 m of a ridge crest (TPI class = ridge) | "Wind is stronger on the ridge top (can be about 1.5–2× the valley wind), so embers fly further from here. Once over the top, the fire usually slows **but** can throw embers far down the other side." |
| 9 | **Lee slope sideways run (fire channelling)** | VLS score V ≥ 0.5 (lee θ ≥ ~20°, Δ ≤ 40°, U_crest ≥ ~25) | "Strong wind is blowing over this ridge onto a steep slope. Fires here can **run sideways along the slope** and dump embers far downwind, creating huge areas of flame. **Why:** the wind rolls over into a spinning eddy behind the ridge that the fire gets caught in. Seen in the 2003 Canberra fires." |
| 10 | **Backing downhill: slow, not stopped** | Front with θ_d ≤ −8° | "Going downhill the fire slows, but usually **not below about half** its flat-ground speed. **Watch for:** burning logs and bark **rolling down** and starting fires below you." |
| 11 | **Rolling debris risk below** | Burning cells with θ ≥ 25° upslope of unburnt fuel or the user | "Burning material can **roll down** from here and start new fires **below**, and a fire below will run **uphill** at you. Don't work directly below fire on steep ground." |
| 12 | **Junction zone: two fires meeting** | Two fronts within 150 m, included angle ≤ 45°, or a spot fire downslope of the main front | "Two fire edges are closing at a narrow angle. The point where they meet can move **several times faster** than either fire, and faster again on slopes. **Why:** the gap between them traps heat and pulls in air. Stay out of the 'V' between fires." |
| 13 | **Spot fire below will run uphill** | Spot fire ignited downslope of the main front, θ between ≥ 10° | "This spot fire is **below** the main fire, so it will run **uphill** to meet it and the two can merge violently. Spot fires are how fire 'skips' the slow downhill and valley sections." |
| 14 | **Across-valley preheating** | Active flame with line of sight to the opposite slope within 300 m, modelled q ≥ 3 kW/m² | "The fire is **heating the other side of this narrow valley**. Fuel there is drying out, and a single ember can start a fire that runs straight up that slope." |
| 15 | **Sunny slope = dry fuel** | Aspect N–W (315°–045° via N, or 270°–360°) and 12:00–18:00 local, clear sky, and modelled FMC ≥ 2 points lower than adjacent S/SE slopes | "This slope faces the afternoon sun. Its leaf litter is **drier and hotter**, by a few percentage points of moisture or more, than shady slopes nearby. Expect faster, hotter fire here than on the shaded side." |
| 16 | **Shady gully = wetter, but not safe** | Aspect S–SE or gully (κ_p < 0), FMC ≥ 12% | "Moist gullies and shady slopes often slow a fire, and may even stop it in mild weather. **But** in drought or extreme wind they burn too, and a gully that stops a fire today may not tomorrow." |
| 17 | **Night: the thermal belt** | 20:00–08:00, inversion diagnosed, front at the belt elevation ±50 m | "At night cold air sinks into the valley. The **mid-slope** band stays warmest and driest, so fire keeps burning actively here while the valley floor and ridge top quieten." |
| 18 | **Morning wake-up / evening switch** | Within 1.5 h after sunrise on sunlit slopes, or sunset ±1 h | "Morning: as the sun heats this slope, air starts flowing **uphill** and the fire will pick up. Evening: upslope winds die and cool air drains **downhill**, and the fire may creep down the gullies overnight." |
| 19 | **Model outside tested range** | Any front cell with θ_d > 20° or < −30°, or the eruptive or VLS regimes active | "Heads up: on terrain this steep, real fire behaviour is **less predictable** than any model. Treat these predictions as the **low end**." |
| 20 | **Danger rating doesn't include slope** | Always available; auto-show once per session when the fire is on slopes ≥ 15° | "The Fire Danger Rating assumes flat ground. **On this slope the same weather can produce fire {SF}× faster** than the rating implies." |

Card copy guidance:
- Give the mechanism in one sentence.
- Always give an observable cue.
- Tie to a well-known incident only when the analogy is exact.
- Never claim precision beyond the tags in this document.

---

## 6. Open questions and uncertainties

1. **Vesta Mk 2 slope function limits.** The PyroXL implementation matches Cruz et al. (2021, eq. 13), but the user's guide's stated validity range (for example ±20° or ±30°) was not retrievable. **Verify in the user's guide.**
2. **Kataburn planar variant formula.** Not retrieved; only the linear form was verified via code.
3. **Viegas eruptive model closed form and parameters** (a₁, a₂, b₁, b₂ per fuel type; the 2025 oscillation model). The structure is known but the numbers were not retrieved. FireSim uses a heuristic instead.
4. **VLS thresholds** vary between sources (lee slope 15–25°, aspect window 30–40°, wind 20–30 km/h). Use a fuzzy score. Calibrating against RFS line scans would be ideal.
5. **Flame-attachment criterion at field scale with wind and cross-wind.** Lab critical angles (24–27.5°) come from still-air or trench tests. The interaction with ambient wind and fire width is not captured by any operational model [S: Pimont 2012 shows strong width effects].
6. **Rolling-debris and cross-valley radiant ignition thresholds.** No primary quantitative model found. The heuristics in §4.6–4.7 need expert review.
7. **Diurnal slope-wind speeds and thermal-belt magnitude in NSW ranges** ([K] ranges). Should be validated against BoM/AWS or research data, for example the "Modelling the thermal belt in an Australian bushfire context" work.
8. **Mann Gulch spread rates.** Reported values (several hundred ft/min) need checking in Rothermel (1993) before use in any card.
9. **AS 3959 flame temperature and emissivity** (1090 K, 0.95) are [K]; verify against AS 3959:2018 Method 2.
10. **Numerical coupling risk.** Pyrogenic potential and the resolved 3-D atmosphere might double-count indraft. A partitioning rule is needed, for example subtracting the atmosphere's resolved convergence at the fire-grid scale.

---

## 7. References

Primary and official sources are listed first, then open-source implementations used for equation cross-checks.

**Slope functions and operational models**
- Noble IR, Bary GAV, Gill AM (1980) McArthur's fire-danger meters expressed as equations. *Australian Journal of Ecology* 5, 201–203. https://doi.org/10.1111/j.1442-9993.1980.tb01243.x
- Sullivan AL, Sharples JJ, Matthews S, Plucinski MP (2014) A downslope fire spread correction factor based on landscape-scale fire behaviour. *Environmental Modelling & Software* 62, 153–163. https://www.sciencedirect.com/science/article/abs/pii/S1364815214002485 ; CSIRO PyroPage summary: https://research.csiro.au/pyropage/wp-content/uploads/sites/17/2016/03/CSIRO-PyroPage-Issue-1r2-Kataburn.pdf
- Cruz MG, et al. (2021) *The Vesta Mk 2 rate of fire spread model: a user's guide.* CSIRO, Canberra. https://research.csiro.au/vestamk2/wp-content/uploads/sites/443/2021/12/Vesta-Mk-2-users-guide-2021_a.pdf ; model page https://research.csiro.au/vestamk2/
- CSIRO Spark model library, "Slope effects". https://research.csiro.au/spark/resources/model-library/slope-effects/
- Cruz MG, Sullivan AL, Alexander ME (2014) Fire behaviour knowledge in Australia (review; slope function domain and Cheney 1981 caveat). https://www.frames.gov/documents/catalog/cruz_sullivan_alexander_2014.pdf
- Rothermel RC (1972) A mathematical model for predicting fire spread in wildland fuels. USDA FS Res. Pap. INT-115. See also Andrews PL (2018) The Rothermel surface fire spread model and associated developments. RMRS-GTR-371. https://www.fs.usda.gov/rm/pubs_series/rmrs/gtr/rmrs_gtr371.pdf
- Wotton BM, Alexander ME, Taylor SW (2009) Updates and revisions to the 1992 Canadian Forest Fire Behavior Prediction System. Info. Rep. GLC-X-10. https://publications.gc.ca/collections/collection_2010/nrcan/Fo123-2-10-2009-eng.pdf
- Sharples JJ (2008) Review of formal methodologies for wind–slope correction of wildfire rate of spread. *IJWF* 17, 179–193. https://doi.org/10.1071/WF06156
- Butler BW, Anderson WR, Catchpole EA (2007) Influence of slope on fire spread rate. USDA FS Proc. RMRS-P-46CD, 75–82. https://www.fs.usda.gov/rm/pubs/rmrs_p046/rmrs_p046_075_082.pdf
- Comparative assessment of wildland fire rate of spread models: Influence of terrain slope (2026). *Fire Safety Journal*. https://www.sciencedirect.com/science/article/pii/S0379711226001426
- AFAC. AFDRS Fire Behaviour Index and Model Guides (AFDRS does not include topographic effects). https://www.afac.com.au/public-resources/afdrs--fire-behaviour-index-and-model-guides
- Alexander ME (1985) Estimating the length-to-breadth ratio of elliptical forest fire patterns. *Proc. 8th Conf. Fire and Forest Meteorology*. https://www.frames.gov/catalog/10926
- Anderson HE (1983) Predicting wind-driven wild land fire size and shape. USDA FS Res. Pap. INT-305. [K]

**Slope physics, attachment and eruption**
- Dupuy JL, Maréchal J (2011) Slope effect on laboratory fire spread: contribution of radiation and convection to fuel bed preheating. *IJWF* 20, 289–307. https://doi.org/10.1071/WF09076
- Morandini F, Silvani X, Dupuy JL, Susset A (2018) Fire spread across a sloping fuel bed: flame dynamics and heat transfers. *Combustion and Flame* 190, 158–170. https://www.sciencedirect.com/science/article/abs/pii/S0010218017304649
- Silvani X, Morandini F, Dupuy JL (2012) Effects of slope on fire spread observed through video images and multiple-point thermal measurements. *Experimental Thermal and Fluid Science* 41, 99–111. https://www.sciencedirect.com/science/article/abs/pii/S089417771200088X
- Li H, Liu N, Xie X, et al. (2021) Effect of fuel bed width on upslope fire spread: an experimental study. *Fire Technology* 57, 1063–1076. https://doi.org/10.1007/s10694-020-01031-8
- Pimont F, Dupuy JL, Linn RR (2012) Coupled slope and wind effects on fire spread with influences of fire size: a numerical study using FIRETEC. *IJWF* 21, 828–842. https://doi.org/10.1071/WF11122
- Wu Y, Xing HJ, Atkinson G (2000) Interaction of fire plume with inclined surface. *Fire Safety Journal* 35, 391–403.
- Sharples JJ, Gill AM, Dold JW (2010) The trench effect and eruptive wildfires: lessons from the King's Cross Underground disaster. *Proc. AFAC/Bushfire CRC Conference*. https://www.frames.gov/catalog/11631
- Xie X, et al. (2017) Upslope fire spread over a pine needle fuel bed in a trench associated with eruptive fire. *Proceedings of the Combustion Institute* 36. https://www.sciencedirect.com/science/article/abs/pii/S1540748916303492
- Dold JW, Zinoviev A (2009) Fire eruption through intensity and spread rate interaction mediated by flow attachment. *Combustion Theory and Modelling* 13, 763–793. https://doi.org/10.1080/13647830902977570
- Viegas DX (2005) A mathematical model for forest fires blowup. *Combustion Science and Technology* 177(1). https://doi.org/10.1080/00102200590883624
- Viegas DX (2006) Parametric study of an eruptive fire behaviour model. *IJWF* 15, 169–177. https://www.publish.csiro.au/wf/wf05050
- Viegas DX, Pita LP (2004) Fire spread in canyons. *IJWF* 13, 253–274. https://www.frames.gov/catalog/11610
- Viegas DX, Simeoni A (2011) Eruptive behaviour of forest fires. *Fire Technology* 47 [K pages]. https://link.springer.com/article/10.1007/s10694-010-0193-6
- Viegas DX, Ribeiro C, Ribeiro LM, Almeida M, Rodrigues T, Barbosa TF (2025) Analytical model to predict the self-induced acceleration and deceleration of a head fire. *IJWF* 34, WF24166. https://doi.org/10.1071/WF24166
- Experimental study on the evolution of canyon fire spread behavior under different terrains and the critical conditions for eruptive fire (2025). *IJWF* 34, WF24134. https://connectsci.au/wf/article/34/10/WF24134/233558/
- Viegas DX (2004) Slope and wind effects on fire propagation. *IJWF* 13, 143–156. https://doi.org/10.1071/WF03046

**Ridges, lee slopes, VLS, mountain meteorology**
- Sharples JJ, McRae RHD, Wilkes SR (2012) Wind–terrain effects on the propagation of wildfires in rugged terrain: fire channelling. *IJWF* 21, 282–296. https://connectsci.au/wf/article-abstract/21/3/282/23332/
- Simpson CC, Sharples JJ, Evans JP, McCabe MF (2014) Resolving vorticity-driven lateral fire spread using the WRF-Fire coupled atmosphere–fire numerical model. *NHESS* 14, 2359–2371. https://nhess.copernicus.org/articles/14/2359/2014/
- Simpson CC, Sharples JJ, Evans JP (2016) Sensitivity of atypical lateral fire spread to wind and slope. *GRL* 43, 1744–1751. https://doi.org/10.1002/2015GL067343
- Sharples JJ, Simpson CC, Evans JP (2013) Examination of wind speed thresholds for vorticity-driven lateral fire spread. *MODSIM 2013*. https://www.mssanz.org.au/modsim2013/A3/sharples3.pdf
- Sharples JJ, Kiss AE, Raposo J, Viegas DX, Simpson CC (2015) Pyrogenic vorticity from windward and lee slope fires. *MODSIM 2015*. https://www.mssanz.org.au/modsim2015/A4/sharples.pdf
- Raposo JR, Viegas DX, Sharples JJ, et al. (2015) Experimental analysis of fire spread across a two-dimensional ridge under wind conditions. *IJWF* 24, 1008–1022. https://doi.org/10.1071/WF14150
- Abouali A, Viegas DX, Raposo JR (2021) Analysis of the wind flow and fire spread dynamics over a sloped–ridgeline hill. *Combustion and Flame* 234, 111724. https://www.sciencedirect.com/science/article/pii/S0010218021004673
- Sharples JJ (2009) An overview of mountain meteorological effects relevant to fire behaviour and bushfire risk. *IJWF* 18, 737–754. https://connectsci.au/wf/article-abstract/18/7/737/23161/
- Sharples JJ, Cary GJ, Fox-Hughes P, et al. (2016) Natural hazards in Australia: extreme bushfire. *Climatic Change* 139, 85–99.
- Sharples JJ, Hilton JE (2020) Modeling vorticity-driven wildfire behavior using near-field techniques. *Frontiers in Mechanical Engineering* 5:69. https://doi.org/10.3389/fmech.2019.00069
- Hilton JE, Sullivan AL, Swedosh W, Sharples J, Thomas C (2018) Incorporating convective feedback in wildfire simulations using pyrogenic potential. *Environmental Modelling & Software* 107, 12–24. https://www.sciencedirect.com/science/article/abs/pii/S1364815217309593
- Hilton JE, Garg N, Sharples JJ (2019) Incorporating firebrands and spot fires into vorticity-driven wildfire behaviour models. *MODSIM 2019*. https://www.naturalhazards.com.au/crc-collection/downloads/conf_paper_hilton_etal_modsim2019_1.pdf
- Wood N (1995) The onset of separation in neutral, turbulent flow over hills. *Boundary-Layer Meteorology*. https://link.springer.com/article/10.1007/BF00710894 ; see also Finnigan et al. (2020) Boundary-layer flow over complex topography. *BLM* 177, 247–313. https://www2.mmm.ucar.edu/people/patton/documents/finnigan_et_al.BLM.2020.pdf
- Jackson PS, Hunt JCR (1975) Turbulent wind flow over a low hill. *QJRMS* 101, 929–955 [K]; Taylor PA, Mason PJ, Bradley EF (1987) Boundary-layer flow over low hills. *BLM* 39. https://link.springer.com/article/10.1007/BF00121870
- Whiteman CD (2000) *Mountain Meteorology: Fundamentals and Applications.* Oxford University Press [K].
- McRae RHD, Sharples JJ, et al. (2013) An Australian pyro-tornadogenesis event. *Natural Hazards* 65, 1801–1811. https://link.springer.com/article/10.1007/s11069-012-0443-7

**Junctions and spotting**
- Viegas DX, et al. (2012) Study of the jump fire produced by the interaction of two oblique fire fronts. Part 1. *IJWF* 21, 843–856. https://www.publish.csiro.au/wf/WF10155
- Raposo JR, Viegas DX, et al. (2018) Analysis of the physical processes associated with junction fires at laboratory and field scales. *IJWF* 27, 52–68. https://www.publish.csiro.au/wf/wf16173
- Thomas CM, Sharples JJ, Evans JP (2017) Modelling the dynamic behaviour of junction fires with a coupled atmosphere–fire model. *IJWF* 26, 331–344. https://publish.csiro.au/wf/wf16079
- Raposo JR, et al. (2023) Slope effect on junction fire with two non-symmetric fire fronts. *IJWF* 32, 328–335. https://www.publish.csiro.au/wf/fulltext/WF22152
- A unified scaling law for bushfire junctions (2026). *Fire Safety Journal* (IAFSS 2026). https://www.sciencedirect.com/science/article/pii/S0379711226001219
- Storey MA, Price OF, Almeida M, Ribeiro C, Bradstock RA, Sharples JJ (2021) Experiments on the influence of spot fire and topography interaction on fire rate of spread. *PLOS ONE* 16(1), e0245132. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0245132
- Storey MA, et al. (2020) Drivers of long-distance spotting during wildfires in south-eastern Australia. *IJWF* 29. https://publish.csiro.au/wf/fulltext/wf19124
- Storey MA, Price OF, Bradstock RA, Sharples JJ (2020) Analysis of variation in distance, number, and distribution of spotting in southeast Australian wildfires. *Fire* 3(2). https://ro.uow.edu.au/articles/journal_contribution/Analysis_of_variation_in_distance_number_and_distribution_of_spotting_in_southeast_Australian_wildfires/27772887
- Filkov A, Duff T, Penman T (2020) Frequency of dynamic fire behaviours in Australian forest environments. *Fire* 3(1), 1. https://mdpi.com/2571-6255/3/1/1/htm

**Aspect, fuel moisture and topographic position**
- Nyman P, et al. (2015) Quantifying the effects of topographic aspect on water content and temperature in fine surface fuel. *IJWF* 24, 1129–1142. https://www.publish.csiro.au/wf/wf14195
- Slijepcevic A, Anderson WR, Matthews S, Anderson DH (2018) An analysis of the effect of aspect and vegetation type on fine fuel moisture content in eucalypt forest. *IJWF* 27, 190–202. https://www.publish.csiro.au/WF/WF17049
- Bradstock RA, Hammill KA, Collins L, Price O (2010) Effects of weather, fuel and terrain on fire severity in topographically diverse landscapes of south-eastern Australia. *Landscape Ecology* 25, 607–619. https://link.springer.com/article/10.1007/s10980-009-9443-8
- Gould JS, McCaw WL, Cheney NP, Ellis PF, Matthews S (2007/2008) *Field Guide: Fire in Dry Eucalypt Forest.* CSIRO/Ensis. https://www.publish.csiro.au/book/5991/
- Modelling the thermal belt in an Australian bushfire context (conference paper). https://www.researchgate.net/publication/290081520_Modelling_the_thermal_belt_in_an_Australian_bushfire_context

**Firefighter safety and case studies**
- Rothermel RC (1993) Mann Gulch fire: a race that couldn't be won. USDA FS GTR INT-299. https://www.nrfirescience.org/sites/default/files/2023-07/int_gtr299.pdf
- Butler BW, Bartlette RA, Bradshaw LS, Cohen JD, Andrews PL, Putnam T, Mangan RJ (1998) Fire behavior associated with the 1994 South Canyon Fire on Storm King Mountain, Colorado. RMRS-RP-9. https://www.fs.usda.gov/rm/pubs/rmrs_rp009/
- Pearce HG (2007) Bucklands Crossing firefighter burnover: a case study of fire behaviour and firefighter safety implications. RMRS-P-46CD, 229–239. https://www.fs.usda.gov/rm/pubs/rmrs_p046/rmrs_p046_229_239.pdf
- Lahaye S, Sharples J, et al. (2018) Fuel and topographic influences on wildland firefighter burnover fatalities in Southern California. *IJWF* 27. https://doi.org/10.1071/WF17147
- Page WG, et al. (2019) A review of US wildland firefighter entrapments: trends, important environmental factors and research needs. *IJWF* 28. https://dx.doi.org/10.1071/WF19022 ; and A classification of US wildland firefighter entrapments based on coincident fuels, weather, and topography. *Fire* 2(4), 52. https://www.mdpi.com/2571-6255/2/4/52
- USDA FS (2020) Wildland firefighter burnover fatalities on prescribed fires and wildfires in the United States, 1990 to 2017. RMRS-P-78, 177–181. https://www.fs.usda.gov/rm/pubs_series/rmrs/proc/rmrs_p078/rmrs_p078_177_181.pdf
- Cheney NP, Gould JS, McCaw L (2001) The dead-man zone: a neglected area of firefighter safety. *Australian Forestry* 64, 45–50. https://www.tandfonline.com/doi/abs/10.1080/00049158.2001.10676160
- Page WG, Butler BW (2017) An empirically based approach to defining wildland firefighter safety and survival zone separation distances. *IJWF* 26, 655–667. https://dx.doi.org/10.1071/WF16213 ; Butler BW (2014) Wildland firefighter safety zones: a review of past science and summary of future needs. https://www.fs.usda.gov/rm/pubs_other/rmrs_2014_butler_b001.pdf
- NWCG S-190 Unit 4 Topography; NWCG 6MFS "On a hillside where rolling material can ignite fuel below". https://training.nwcg.gov/dl/s190/ILT/s-190-ig04.pdf ; https://www.nwcg.gov/6mfs/operational-engagement/on-a-hillside-where-rolling-material-can-ignite-fuel-below
- Sharples JJ (2017) Risk implications of dynamic fire propagation: a case study of the Ginninderry region. https://ginninderry.com/wp-content/uploads/2021/08/Sharples_GinninderryPreliminaryReport.pdf
- AIDR Knowledge Hub: Bushfire – Blue Mountains 2013. https://knowledge.aidr.org.au/resources/bushfire-blue-mountains-2013/ ; Bushfire – Black Christmas 2001. https://knowledge.aidr.org.au/resources/bushfire-black-christmas-2001/
- NSW Coroner (2019) Inquiry into the State Mine Fire (Marrangaroo). https://coroners.nsw.gov.au/documents/findings/2019/Marrangaroo%20Fire%20Findings%20and%20Glossary.pdf
- Blue Mountains Gazette (2024) Bushfire caused by RFS backburn, coroner finds. https://www.bluemountainsgazette.com.au/story/8581107/bushfire-caused-by-rfs-backburn-coroner-finds/ ; ABC (2023) RFS defends Gospers Mountain back-burn decision. https://www.abc.net.au/news/2023-05-16/black-summer-gospers-mountain-bushfire-inquest-hearing/102345780
- Wildfire Today: The story of Australia's million-hectare fire (Gospers Mountain). https://wildfiretoday.com/the-story-of-australias-million-hectare-fire/
- ABC (2022) Coronial inquiry: Buxton firefighter deaths. https://www.abc.net.au/news/2022-05-11/nsw-bushfire-coronial-inquiry-buxton-firefighter-deaths/101055288
- Australia State of the Environment 2021: Currowan fire. https://soe.dcceew.gov.au/extreme-events/environment/bushfires-and-wildfires
- Canberra Times: Dunns Road fire lightning ignition. https://www.canberratimes.com.au/story/7437917/no-way-they-could-prepare-lightning-strike-triggered-megafire/
- National Museum of Australia: Canberra bushfires 2003. https://www.nma.gov.au/defining-moments/resources/canberra-bushfires
- Dictionary of Sydney: Eastern seaboard bushfires 1994. https://dictionaryofsydney.org/entry/eastern_seaboard_bushfires_1994

**Standards**
- Standards Australia AS 3959:2018 Construction of buildings in bushfire-prone areas (Method 1 invalid for effective slope > 20° downslope; Method 2 limits). Background: https://research.csiro.au/bushfire/assessing-bushfire-hazards/hazard-identification/slope/

**Open-source implementations used for equation cross-checks**
- PyroXL, `src/vba_scripts/Vesta2.bas` (Vesta Mk 2, Cruz 2021 eqs 8–17, including slope eq. 13). https://github.com/Geoffysicist/PyroXL
- WUINITY/PREACT, `SpreadModelAFDRS.cs` (McArthur and kataburn slope; FBP slope; grass LBR). https://github.com/bran-jnw/wuinity
- emxsys/behave, `src/Rothermel.js` (Rothermel φ_s = 5.275 β^−0.3 tan²θ). https://github.com/emxsys/behave
- fiRetools, `R/forest_behav.R` (McArthur Mk 5 forest ROS with exp(0.069θ)). https://github.com/ozjimbob/fiRetools

---

## Appendix A. Vesta Mk 2 equations as transcribed from PyroXL (verify before use) [S via code; primary text not retrieved]

These come from `Geoffysicist/PyroXL/src/vba_scripts/Vesta2.bas`, whose comments cite Cruz et al. (2021) equation numbers. The fuel/weather research document should confirm them against the user's guide.

- **Fine dead fuel moisture** (%; T in °C, RH in %):
  - Oct–Mar, 12:00–17:00, "dry" submodel: `M = 2.76 + 0.124·RH − 0.0187·T`
  - Night (hour ≤ 06 or ≥ 19): `M = 3.08 + 0.198·RH − 0.0483·T`
  - Otherwise: `M = 3.60 + 0.169·RH − 0.045·T`
- **Moisture function:**
  - `φ_M = 1` for M ≤ 4.1
  - `φ_M = 0` for M > 24
  - otherwise `φ_M = 0.9082 + 0.1206M − 0.03106M² + 0.001853M³ − 0.00003467M⁴`
- **Fuel availability** (DF = drought factor; wet-forest submodel adds a DI/WAF term with a slope/aspect term that is not implemented in the code): `FA = 1.008 / (1 + 104.9·exp(−0.9306·DF))`. Fuel moisture effect: `FME = φ_M · FA`.
- **Phase transitions** (U₁₀ in km/h; u = U₁₀/WAF with WAF 3–5; FL_s = surface fuel load in t/ha):
  - `P2 = 1/(1+e^(−g₂))`, with `g₂ = −23.9315 + 1.7033u + 12.0822·FME + 0.95236·FL_s`; P2 = 0 if FL_s < 1.
  - `P3 = 1/(1+e^(−g₃))`, with `g₃ = −32.3074 + 0.2951·U₁₀ + 26.8734·FME`; P3 = 0 if R₂ < 0.3 km/h.
- **Phase ROS** (km/h; ×1000 for m/h; each multiplied by FME·SF):
  - `R₁ = 0.03 + 0.05024·(u − 1)^0.92628·(FL_s/10)^0.79928` for u > 2, else 0.03
  - `R₂ = 0.19591·u^0.8257·(FL_s/10)^0.4672·H_u^0.495` (H_u = understorey height, m)
  - `R₃ = 0.05235·U₁₀^1.19128`
- **Combined:**
  - if P2 < 0.5: `R = R₁(1 − P2) + R₂·P2`
  - else: `R = R₁(1 − P2) + R₂·P2·(1 − P3) + R₃·P3`
  - This is transcribed as coded. Confirm whether the primary text uses P2·P3 on the R₃ term.
- **Slope:** SF as in §2.2(c).
