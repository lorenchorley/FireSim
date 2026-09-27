# 02 — Mountain meteorology relevant to fire behaviour (NSW ranges)

Status: research note for the FireSim simulator and its "why" explanations.
Scope: thermally driven mountain winds, inversions and thermal belts, terrain-modified synoptic flow (speed-up, separation, channelling, mountain waves, foehn), vorticity-driven lateral spread (VLS), pyroconvection (C-Haines, PFT), and NSW synoptic fire-weather patterns.
Region: Blue Mountains, Wollemi, Kanangra-Boyd, Budawangs, Snowy Mountains/Kosciuszko, Brindabellas, Barrington Tops, New England tablelands and the Great Escarpment, Warrumbungles.

## 0. Provenance and confidence tags

During this research session, WebSearch worked but the sandbox blocked direct PDF and web-page fetches (every publisher, CSIRO, BoM, MSSANZ and Copernicus host). So the values here come from three kinds of source:
(a) search-engine extracts of the primary papers;
(b) abstracts;
(c) standard textbook physics that can be derived or checked independently.

Each quantitative item carries a tag:

- **[V]**: seen in an extract or abstract of the cited primary source during this research.
- **[L]**: established literature value or equation from the cited source that could not be re-read in full here. Check it against the PDF before hard-coding it as a constant.
- **[D]**: derived here from first principles (the working is shown).
- **[H]**: heuristic or engineering choice made for FireSim. It is not a published threshold, so make it user-tunable.

**Adversarial fact-check pass (2026-09-27).** A second reviewer re-checked every equation, coefficient, threshold and case-study number against primary-source abstracts, publisher pages and search-engine extracts of the original papers. Direct PDF fetching was again blocked by the sandbox egress proxy, so "verified" below means the number was seen in an abstract or extract of the cited source, or re-derived. Tags added in this pass:

- **(verified: source)**: number or equation confirmed against the named source.
- **(UNVERIFIED: reason)**: could not be confirmed; treat as a placeholder.
- **(CORRECTED: …)**: the earlier text was wrong and has been fixed here.

Main corrections in this pass:
1. The overnight mountain-wave quotes had been attributed to the State Mine fire. They belong to the **Aberfeldy fire (Victoria, January 2013)**.
2. Stull's width-based Froude number had been conflated with the height-based Fr = U/(N·h).
3. The 0.4–5 km/h oscillating VLS rates, and the "no VLS at 2.5 m/s" result, come from Sharples, Simpson & Evans (2013, MODSIM), not Simpson et al. (2016).
4. Several findings were added: the coupled-model VLS wind threshold of about 5 m/s (Sharples et al. 2015 BNHCRC report); the WRF-Fire resolution result that VLS is not resolved at 90 m and needs ≤ 30 m (Simpson et al. 2014); the first landscape-scale VLS observations (Airport Fire, California, 2024; *Fire* 2026); Di Virgilio et al. (2019) C-Haines/FFDI pyroCb thresholds; the AS/NZS 1170.2 separation provision; canopy-enhanced separation (Ross & Vosper 2005); Australian high-country drying events (Sharples, Mills & McRae 2012); and NSW Hunter Valley channelling (Webb & Park 2023).

---

## 1. Executive summary: what matters most for FireSim

1. **In mountains, weather is not a smooth field.** Sharples (2009) argues that rugged terrain produces "complex dynamics and emergent properties that are discontinuous in nature". The "fire weather continuum" assumed in fire-danger practice is therefore of reduced validity in hilly country [V] (UNVERIFIED in the fact-check: the quote was not re-seen; the abstract confirms the paper reviews how mountain effects "might contribute to fire potential and fire behaviour"). Two consequences follow:
   - FireSim must never just interpolate one station's weather across ridges.
   - FireSim needs separate terrain-aware sub-models for wind, temperature and humidity.
2. **Vorticity-driven lateral spread (VLS, "fire channelling") is the single most important mountain-specific dynamic behaviour for NSW crews.**
   - *Conditions*: a lee slope steeper than about 20–25°, with its aspect within about 30–40° of the direction the wind is blowing towards, and ridge-level winds above about 20 km/h [V] (Sharples & Hilton 2020, summarising Sharples et al. 2012 and Simpson et al. 2013, 2016) (verified: Sharples & Hilton 2020 text; Sharples Ginninderry report).
     - Coupled fire–atmosphere simulations put the wind threshold at about **5 m/s (18 km/h)**. Below that the flow "does not possess enough momentum to separate from the surface in the lee of the ridge line" (verified: Sharples et al. 2015, BNHCRC Report 2015.018).
     - The terrain-filter fit to the Canberra 2003 events gave a slope threshold σ ≈ 25° and an aspect-discrepancy threshold δ ≈ 40° (verified: same report). The slope threshold depends on DEM resolution: another application of the same filter used σ = 10.5° (verified: Sharples & Hilton 2020).
   - *What happens*: the fire runs sideways along the lee slope just below the ridge.
     - Modelled rates: up to 3.6 km/h in LES, pulsing between 0.4 and 5 km/h in WRF-SFire (verified: Simpson et al. 2013; Sharples, Simpson & Evans 2013).
     - Observed rates: the first landscape-scale time series (Airport Fire, California, 2024) gave a mean lateral spread of 1.9 km/h, about 4 km/h around plume touch-down and brief peaks of 20 km/h (verified: *Fire* 9(2):79, 2026).
     - It casts embers downwind, which produces "deep flaming" [V]. It has been linked to pyroCb development, for example in the Grose Valley in November 2006 (verified: McRae, Sharples & Fromm 2015).
   - *Consequence*: WRF-Fire does not reproduce VLS at 90 m grid spacing and needs about 30 m or finer (verified: Simpson et al. 2014). It therefore cannot be resolved on our 100–200 m atmosphere grid and must be parameterised.
3. **Diurnal wind reversals** (upslope/up-valley by day, downslope/down-valley by night) change the fire's direction without any synoptic change.
   - *Typical speeds*: upslope 3–8 mph (1.3–3.6 m/s), downslope 2–5 mph (0.9–2.2 m/s), valley winds peaking at 10–15 mph (4.5–6.7 m/s) in larger valleys.
   - *Timing*: valley winds lag slope winds by 1–3 h [V] (NWCG PMS 437) (verified: NWCG PMS 437 and PMS 425-1 ch. 7). These are US (Rocky Mountain) handbook values. No NSW-specific climatology of slope-wind speeds was found (UNVERIFIED for NSW).
4. **Nights are not safe everywhere.**
   - The **thermal belt** (roughly the middle third of the slope, where the top of the valley inversion meets the slope) has the highest night temperatures, the lowest RH and the lowest fuel moisture. Fires there can stay active all night [V] (Schroeder & Buck 1970).
   - Ridges and elevated firegrounds above the inversion can be hit by overnight **mountain-wave downslope winds**. The documented Australian case is the **Aberfeldy fire (Victoria, 17 January 2013)**. Modelling "showed clear evidence that mountain waves and strong downslope winds developed overnight", and the elevated fireground sat in warm, dry air above the nocturnal inversion, which limited fuel-moisture recovery (verified: BNHCRC 2017; Kepert et al. 2016, Hazard Note 24).
   - In NSW, mountain waves were also identified as a factor in the **State Mine fire (Blue Mountains, 17 October 2013)**. That day the fire grew from 1,036 ha to 12,436 ha in about 10 h, and ACCESS modelling at about 440 m showed "a band of strong winds extended downwards towards the surface" near the fire (verified: BNHCRC 2017; BoM blog).
   - (CORRECTED: an earlier draft described the State Mine growth as overnight and attributed the Aberfeldy quotes to it.)
5. **Morning inversion break-up is when the fire "wakes up".** In deep valleys it "begins at sunrise and is generally completed in 3½–5 h, unless the valley is snow covered or the ground is wet" (verified: Whiteman 1982 abstract; Colorado valleys). At that moment ridge-top winds and dry air mix down to the fire.
6. **Foehn / isentropic drawdown in the lee of the Great Dividing Range (GDR).**
   - *What*: under W–NW flow, air from above ridge-top is drawn down the eastern side, causing abrupt warming and drying [V] (Sharples et al. 2010).
   - *How common*: foehn-driven fires made up about half of the major events of 2019–20 [V] (McRae, AJEM 2023, as reported by UNSW) (verified: AIDR AJEM page and UNSW release). In McRae's trial, early-season misses north of Sydney were "largely due to underestimation of the role of the foehn effect" (verified: AJEM 2023).
7. **Wind changes turn flanks into head fires.** On Black Saturday the change between 17:30 and 18:30 turned the roughly 55 km long eastern flank of the Kilmore East fire into a head fire. Spot fires landed up to 33 km ahead (verified: Cruz et al. 2012 abstract). In NSW this is the pre-frontal NW followed by a SW/S change or a coastal southerly buster.
8. **Atmospheric instability.** The Continuous Haines index (C-Haines) and the Pyrocumulonimbus Firepower Threshold (PFT) are cheap indices we can compute from 850/700 hPa data and a sounding. They tell the trainee when the plume may "take over" (pyroCb, erratic winds, long-range spotting).
9. **Ridges accelerate wind.**
   - Fractional speed-up ≈ B·H/L, with B ≈ 2 for 2-D ridges [L] (Jackson & Hunt 1975; Taylor & Lee 1984) (UNVERIFIED: the B and A coefficients could not be read in the original *Climatol. Bull.* paper; they are consistent with the ASCE 7 K_zt height-decay constants 3 / 2.5 / 4 derived from the same guidelines).
   - Mountaintop winds were often twice those on the surrounding plain at Big Southern Butte, a cinder cone about 5 km across with 800 m relief (verified: Butler et al. 2015).
   - Lee slopes steeper than about 20° separate, giving reversed, gusty, direction-variable near-surface flow [V/L] (Wood 1995; Sharples et al. 2012). A forest canopy enhances separation (verified: Ross & Vosper 2005). The Australian wind code switches to a separation-zone multiplier once the upwind average slope H/(2L_u) exceeds 0.45, about 24° (AS/NZS 1170.2; UNVERIFIED against the 2021 edition).
10. **Recommended architecture.** A cheap layered model, not an LES:
    - a mass-consistent terrain wind;
    - parameterised slope/valley flows driven by computed insolation or cooling;
    - a 1-D inversion/mixed-layer column per valley;
    - a lee-separation mask and a VLS rule-based module;
    - pyrogenic-potential fire indraft (Hilton et al. 2018);
    - optionally, a coarse semi-Lagrangian Boussinesq layer for the plume.

    This fits a < 1–2 min budget for a 6 h scenario.

---

## 2. Mechanisms (physics, with mountain and NSW emphasis)

### 2.1 Why mountains break flat-land intuition (Sharples 2009)

Sharples (2009, IJWF 18:737–754, DOI 10.1071/WF08041) (verified: CSIRO Publishing / ConnectSci listing) reviews these topics [V]:
- temperature and RH changes with elevation and exposure (aspect);
- diurnal mountain wind systems (along-slope, along-valley, cross-valley, mountain–plain);
- inversions and thermal belts;
- the interaction of upper winds with rugged terrain.

The key message [V]: these processes "can lead to otherwise unexpected fire behaviour and escalation in fire size and severity that could endanger firefighting crews and compromise suppression activities" (quote UNVERIFIED in the fact-check pass; the abstract seen says the paper aims "to promote understanding… of how mountain meteorological effects might contribute to fire potential and fire behaviour").

Flat-land models assume one wind vector modified only by fuel and slope. In NSW gorge country (the Blue Mountains sandstone plateau cut by deep gorges; the Great Escarpment gorges of New England; the Snowy/Brindabella ranges) the wind at a point can be:
- thermally driven, and opposite in sign between day and night;
- channelled along a valley regardless of the ridge-top direction;
- reversed in a lee eddy;
- accelerated over a crest or through a saddle;
- pulled down from aloft by mountain waves or foehn;
- locally dominated by the fire's own indraft and vorticity.

### 2.2 Elevation, aspect and humidity

**Daytime mixed layer** (well mixed, afternoon). Potential temperature and water-vapour mixing ratio are roughly constant with height:

- Temperature lapse rate Γ_d = g/c_p ≈ 9.8 K km⁻¹ [D].
- Dew-point lapse ≈ 1.8 K km⁻¹ at constant mixing ratio [L] (standard; e.g. Stull 1988).
- So the dew-point depression shrinks by about 8 K km⁻¹. **RH rises with height inside the mixed layer**, reaching 100 % at the lifting condensation level. The LCL height is approximately z_LCL ≈ 125 m × (T − T_d) [L] (Espy approximation).

  (verified: standard results; the dry adiabatic lapse follows from g = 9.81 m s⁻² and c_p = 1004 J kg⁻¹ K⁻¹. The dew-point lapse of about 1.7–1.8 K km⁻¹ and the Espy factor of 122–125 m K⁻¹ are textbook values.)

  Implication: in the afternoon, valley floors and lower slopes are hotter and drier than ridge tops. But ridge tops are windier (see §2.5).

  *High-country drying events (NSW/ACT/Vic alps).* Sharples, Mills & McRae (2012, AMOJ 62) compared dew-point anomalies between lowland and high-country stations. They documented **extreme drying events in the Australian high country**, where dry air aloft reaches the elevated terrain and humidity there drops far below lowland values (verified: title and approach from abstract; UNVERIFIED: event magnitudes not extracted). Badlan et al. (2012, AMOJ 62:143–156) modelled two Gippsland drying events in the lee of the GDR with 1.5 km WRF (verified: abstract):
  - 29 December 2001: a transition from blocked to unblocked flow, with cross-mountain flow bringing warmer, drier air;
  - 29 May 2007: enhanced downslope flow.

  So the "RH rises with height" rule of the mixed layer can be **inverted** on ridges when dry air aloft is tapped.

**Night / stable conditions.** Radiative cooling makes an inversion in which T increases with height while T_d is roughly constant or decreasing, so **RH falls sharply with height**:
- valley floors approach saturation;
- mid-slopes and ridges stay warm and dry.

Saturation vapour pressure (Bolton 1980) [L]:

```
e_s(T) = 6.112 · exp(17.67·T / (T + 243.5))      [hPa], T in °C, valid ≈ −30…+35 °C
RH     = 100 · e_s(T_d) / e_s(T)                  [%]
```
(verified: Bolton 1980 constants 6.112 hPa, 17.67, 243.5 °C. Bolton quotes accuracy of about 0.1 % over −30 to +35 °C.)

**Aspect and insolation.** In the Southern Hemisphere, N- and NW-facing slopes receive the most afternoon energy. They are warmest and driest, and they drive the strongest anabatic flow. E-facing slopes heat first in the morning; W-facing slopes heat last and reverse to downslope flow latest. The incidence angle on a slope of inclination α and aspect β, for a sun at zenith angle Z and azimuth φ_s, is [L] (Iqbal 1983):

```
cos(i) = cos(α)·cos(Z) + sin(α)·sin(Z)·cos(φ_s − β)     (cell is sunlit if cos i > 0 and not topographically shaded)
```
(verified: standard sloping-surface geometry; φ_s and β must use the same azimuth convention, e.g. both clockwise from true north.)

South-facing (polar-facing) slopes in NSW get the least insolation, especially in winter and spring. They are the coolest and moistest, with the wettest fuels and the weakest anabatic flow. North-facing slopes are the reverse. This matters for the fuel note and for the "why" text.

FireSim should compute cos(i) and cast shadows (horizon angle) per cell each simulated 10–15 min. This drives:
- the timing and strength of slope winds;
- the fuel-moisture response (see the fuel-moisture research note).

### 2.3 Diurnal thermally driven winds

**Slope winds (anabatic by day, katabatic by night).** Heated slopes warm the adjacent air, which then rises along the slope.

Typical values (NWCG PMS 437, from Schroeder & Buck 1970):
- Upslope 3–8 mph (≈ 1.3–3.6 m/s) [V].
- Downslope 2–5 mph (≈ 0.9–2.2 m/s) [V]. Downslope flow is very shallow, may not show up in the 20-ft (6 m) wind, and is laminar because it is stable [V].
- Upslope winds deepen from the lower to the upper slope [V].

Timing:
- Upslope flow starts within minutes of sunlight reaching the slope [V].
- Reversal begins soon after the slope goes into afternoon shadow [V].
- Downslope flow persists until shortly after sunrise [V].

(verified: NWCG PMS 437 "Estimating winds" and Schroeder & Buck 1970 ch. 7: upslope "generally range from 3–8 mph"; downslope "very shallow and of a slower speed… generally 2–5 mph"; "downslope winds begin as soon as slopes go into shadow". Note that 1 mph = 0.447 m/s = 1.609 km/h.)

*Idealised steady slope-flow profile (Prandtl 1942).* This is useful as a parameterisation shape [D, standard result; see Zardi & Whiteman 2013]. Coordinates: n is normal to the slope, u is along-slope (positive upslope), α is the slope angle, γ = dθ/dz is the background stratification (K m⁻¹), K and K_h are eddy viscosity and diffusivity, and C is the surface potential-temperature anomaly (K, positive for a heated slope).

```
θ'(n) = C · e^(−n/l) · cos(n/l)
u(n)  = C · sqrt(g·K_h / (θ0·γ·K)) · e^(−n/l) · sin(n/l)  =  (g·C / (θ0·N·√Pr)) · e^(−n/l)·sin(n/l)
l     = [ 4·K·K_h·θ0 / (g·γ·sin²α) ]^(1/4)                N² = (g/θ0)·γ ,  Pr = K/K_h
u_max ≈ 0.32 · g·C/(θ0·N·√Pr)   at  n = π·l/4
```

- Worked example [D]: a night-time katabatic case with C = −5 K, θ0 = 300 K, N = 0.02 s⁻¹, Pr = 1, K = 0.5 m² s⁻¹ and α = 20° gives:
  - |u_max| ≈ 2.6 m/s;
  - l ≈ 12 m;
  - a jet maximum about 10 m above the slope.

  This is consistent with the observed shallow drainage winds of 1–3 m/s.
- Caveats [H]:
  - Prandtl's u_max does not depend on slope angle. Real slope flows also depend on slope length, the upstream fetch and synoptic interference.
  - Treat Prandtl as a shape function and cap speeds using the NWCG ranges above.
  - Daytime convective anabatic flows are less well described by this model.
- (verified: re-derived. Prandtl's solution gives θ' = C e^(−n/l) cos(n/l) and u = C·√(g/(θ0·γ·Pr))·e^(−n/l) sin(n/l); the maximum of e^(−x) sin x is 0.3224 at x = π/4. The worked example reproduces 2.63 m/s, l = 12.1 m and a jet at 9.5 m.)
- *Operational alternative* (verified: Forthofer, Shannon & Butler 2009): WindNinja's diurnal slope-flow add-on computes the slope wind from four inputs, then adds it vectorially to the mass-consistent ambient wind:
  - surface sensible heat flux;
  - distance to the ridge top or valley bottom;
  - slope steepness;
  - surface and entrainment drag coefficients.

  This is a good template for FireSim layer D (§4.1), because slope length and fetch are explicit inputs.

**Valley winds (up-valley by day, down-valley by night).** These are driven by the along-valley pressure gradient that forms because a valley heats or cools faster than the plain.

- *Valley volume effect*: the topographic amplification factor TAF = (A/V)_valley / (A/V)_plain [V] (Wagner 1938; Steinacker 1984; AMS Glossary). The same energy input heats a smaller air volume in the valley, so a V-shaped gorge amplifies heating and cooling more than a broad valley.
- *Timing*: valley winds lag slope winds by 1–3 h and peak at 10–15 mph (4.5–6.7 m/s) [V] (NWCG PMS 437) (verified: PMS 425-1 ch. 7 says "upvalley wind speeds in larger valleys are ordinarily from 10 to 15 mph". The up-valley wind "does not start until the whole mass of air within the valley becomes warmed, usually in middle or late forenoon". It peaks in early afternoon and continues into the evening). The up-valley to down-valley transition happens in the early night, gradually, depending on valley size [V] (Schroeder & Buck 1970). Down-valley winds are usually somewhat weaker and shallower than up-valley winds, "but there are exceptions in which the downvalley wind may be quite strong" [V].

**The daily cycle.** Defant's classical phase sequence is summarised in Zardi & Whiteman (2013) [L]:

| Phase | Slope wind | Valley wind | Fire implication |
|---|---|---|---|
| Sunrise → +0.5 h | Upslope begins on sunlit (E-facing) slopes | Down-valley persists | Fires on sunlit slopes start to lean and run upslope; valley smoke still pooled |
| Mid-morning | Upslope everywhere sunlit | Transition; inversion eroding | "Fire wakes up" at inversion break-up (§2.4) |
| Midday–afternoon | Strong upslope | Up-valley at maximum | Upslope + up-valley runs; gully/chimney runs on sunlit, wind-aligned slopes |
| Late afternoon | Reversal on shaded (E/SE) slopes first | Up-valley weakening | Fire can stall or back on the east side while still running on NW slopes |
| Evening | Downslope | Transition to down-valley | Fire backs downslope; smoke drains into valleys |
| Night | Downslope (shallow) | Down-valley | Valley fires quiet; thermal-belt and ridge fires active |

**Interaction with synoptic winds.** Thermally driven winds dominate on clear days with weak synoptic flow. When ridge-top winds are strong they are overridden. There is no single published threshold. FireSim should blend them [H], for example with a weight that fades out as the ridge-level wind rises from about 3 to 8 m/s. That is a tunable engineering choice, not a literature value.

### 2.4 Night inversions, cold-air pools, thermal belts and the morning "wake-up"

- **Cold-air pooling.** Cold, dense air drains downslope and pools in valleys and frost hollows (common on the NSW tablelands on clear, calm nights). This puts a warm "lid" on the valley. Consequences:
  - valley-floor RH approaches 100 %;
  - fire activity below the inversion is suppressed;
  - smoke is trapped, reducing visibility and grounding aircraft [V] (general literature; Utah "fire inversions" work).
  - Smoke shading can itself strengthen the inversion, a positive feedback over multiple days [L] (Kochanski et al. 2019) (verified: Kochanski et al. 2019, JGR 124:9099–9116. Smoke reduced surface insolation and warmed the air aloft, "increased inversion-like conditions" trapped smoke in mountain valleys next to active fires).
- **Thermal belt.** "An area of mountainous slope (characteristically the middle third), where the top of the radiation inversion intersects the slope." It has "higher night time temperatures, lower relative humidities, and lower fuel moistures" than other slope positions, and fires "can remain active throughout the night" [V] (NWCG glossary / Schroeder & Buck 1970). Sharples (2009) discusses thermal-belt formation as an Australian bushfire-risk factor [V].
  - (verified: NWCG PMS 205 glossary gives "characteristically the middle third" and "the least variation in diurnal temperatures… highest average temperatures and… lowest relative humidity". Schroeder & Buck 1970 ch. 2: "higher night time temperatures, lower relative humidities, and lower fuel moistures"; fires in the belt "can remain quite active during the night". The belt is most evident in clear weather with light wind.)
  - For NSW valleys, published local thermal-belt heights were not found; treat the inversion depth as an input [H].
- **Ridges above the inversion.** They sit in the free-atmosphere flow: often windy (the nocturnal low-level jet), with little RH recovery. Two examples:
  - At the **Aberfeldy fire (Victoria, January 2013)**, the fireground was high on the southern slopes of the Great Divide overlooking the Latrobe Valley. Being "elevated in the warm, dry air above the nocturnal inversion would have limited overnight recovery of the fuel moisture", and mountain waves with strong downslope winds developed overnight (verified: BNHCRC 2017 news item; Kepert et al. 2016 Hazard Note 24). (CORRECTED: an earlier draft attributed this quote to the State Mine fire.)
  - Night-time fire activity is increasing globally as nights become hotter and drier, measured by vapour-pressure-deficit thresholds [V] (Balch et al. 2022) (verified: *Nature* 602:442–448 abstract. Low night-time VPD is the "night-time barrier", and it is weakening).
- **Inversion break-up.** Whiteman (1982) described three patterns from tethered-balloon soundings in deep Colorado valleys [V]:
  1. upward growth of the convective boundary layer (CBL) with the inversion top stationary (wide valleys and basins);
  2. descent of the inversion top;
  3. a combination of both.

  Break-up "begins at sunrise and is generally completed in 3½–5 h, unless the valley is snow covered or the ground is wet" (verified: Whiteman 1982 abstract, 21 case studies). The abstract also notes that warming of the inversion layer is consistent with subsidence heating. Breakup is faster in shallow or narrow valleys with strong sunshine, and slower in wide, deep, snow- or shade-affected basins [L]. Assigning pattern 1 specifically to wide valleys is UNVERIFIED (not in the abstract).

  *NSW application*: a wet valley floor after rain slows break-up, because more of the energy goes into evaporation. So the day after rain the fire may "wake up" later.

  *Why it matters for fire*: once the stable layer is destroyed, the valley atmosphere couples to the ridge-top flow. Surface winds jump in speed and turn toward the upper-wind direction, and dry air mixes down. This is the physical basis of "the fire wakes up mid-morning".

  *Bulk model* [L] (Whiteman et al. 2004; Whiteman & McKee 1982). The heat deficit of the pool is

  ```
  H_def = c_p · ∫₀^h ρ(z) · [θ(h) − θ(z)] dz          [J m⁻²]
  ```

  Break-up happens when the accumulated sensible heat delivered to the valley atmosphere, ∫ TAF · Q_H(t) dt (Q_H in W m⁻²), reaches H_def. Taking all of the surface sensible heat as delivered to the valley air (f ≈ 1) is a simplification [H].

  (verified form: the heat-deficit integral is the standard cold-pool metric. Using TAF to convert sidewall flux into flux per unit horizontal area is a FireSim approximation [D/H]. Whiteman & McKee (1982) also remove energy by subsidence and export by up-slope flows, and those terms are omitted here.)
- **Mixed-layer growth** (encroachment model, used for flat or broad terrain and after break-up) [L] (Tennekes 1973; Stull 1988):

  ```
  h(t)² = h0² + 2·(1+2β)·∫ (Q_H/(ρ c_p)) dt / γ           β ≈ 0.2 (entrainment), γ = dθ/dz above h
  ```

  (verified form: zero-order jump model dh/dt = (1+2β)·(w'θ')_s/(γ·h), integrated at constant γ. Tennekes (1973) gives an entrainment ratio β ≈ 0.2, with a reported range of about 0.1–0.3 without mechanical turbulence.)

  A deep afternoon mixed layer (> 2–3 km) with strong winds aloft mixes gusts and dry air down to the surface. Abrupt surface drying is associated with deep mixed layers and only weakly stable entrainment layers, which allow mid-tropospheric dry air to mix to the surface [V] (Mills 2008a, b) (verified: as summarised in the Ayat et al. 2025 and Sharples et al. 2016 literature reviews).

### 2.5 Synoptic flow over terrain

**Blocking vs flow-over (Froude number)** [L] (Durran 1990; Whiteman 2000):

Two different Froude numbers are used in the literature, and they must not be mixed up (CORRECTED: the earlier draft quoted Stull's width-based criterion as if it applied to the height-based Fr).

```
(a) Height-based (blocking / flow-over / hydraulic regime):
    Fr_h = U / (N · h)      h = ridge height above the upstream valley/plain [m]
                            U = cross-ridge wind [m s⁻¹],  N = sqrt((g/θ)·dθ/dz) [s⁻¹]
                            (typical N: 0.01 s⁻¹ in a weakly stable layer, 0.02+ s⁻¹ in inversions)
    The inverse, Nh/U, is the "non-dimensional mountain height" (Smith 1989).

(b) Width-based (wave resonance; Stull, Practical Meteorology ch. 17):
    Fr_w = λ / (2·W)        λ = 2π·U / N   (natural wavelength), W = hill width [m]
                           → Fr_w = π·U / (N·W)
```

Interpreting (a):
- Fr_h ≫ 1: air flows over ridges (typical daytime, well mixed).
- Fr_h ≪ 1: stable low-level air is blocked and flows around or along ranges. This is typical at night and during coastal southerly surges trapped against the GDR.
- Fr_h of order 1 (Nh/U ≈ 1): nonlinear regime with wave breaking, lee hydraulic jumps and severe downslope winds. In idealised 2-D simulations, Lin & Wang (1996) reported a significant lee jump and a severe downslope windstorm for Fr_h ≈ 0.6–1.12 (verified: search extract of Lin & Wang 1996, as cited in a later windstorm study; exact bounds depend on ridge shape).

Interpreting (b):
- Fr_w ≈ 1: "for moderate stabilities where the natural wavelength is nearly equal to twice the hill width… the air resonates with the terrain, causing very intense waves". Stull links these to downslope wind storms (verified: Stull, *Practical Meteorology* §17.7).
- Fr_w ≪ 1 (strong stability or weak wind): only small waves.

For a Blue Mountains escarpment (h ≈ 600 m, U = 12 m/s, N = 0.015 s⁻¹): Fr_h = 12/(0.015·600) ≈ 1.3, and λ = 2π·12/0.015 ≈ 5 km [D]. A 2–3 km wide escarpment-and-gorge feature is then near width-resonance (Fr_w ≈ 0.8–1.3). This is an illustration, not a forecast rule.

**Speed-up over ridges and hills.** For low hills, linear theory predicts the fractional speed-up at the crest [L]:

```
Jackson & Hunt (1975): inner-layer depth l from  (l/L)·ln(l/z0) = 2κ²   (κ = 0.4; L = half-length at half-height; later variants use ln²)
Taylor & Lee (1984) guideline:  ΔS_max = B · H/L ;  ΔS(z) = ΔS_max · exp(−A·z/L)
   2-D ridge: B = 2.0, A = 3 ;  3-D hill: B = 1.6, A = 4 ;  2-D escarpment: B = 0.8, A = 2.5
   ΔS = (U_crest(z) − U_upstream(z)) / U_upstream(z)
```
Tags for this block:
- Jackson–Hunt inner-layer relation: (verified: JH75 validity conditions are stated in terms of 2κ²/ln(δ/z0), and the form l/L·ln(l/z0) = 2κ² is the standard statement of the JH75 inner layer. The ln² variant belongs to later refinements, Hunt, Leibovich & Richards 1988 and others; that attribution is UNVERIFIED).
- Taylor & Lee coefficients: (UNVERIFIED: B = 2.0/1.6/0.8 and A = 3/4/2.5 could not be read in Taylor & Lee 1984. The height-decay constants match the ASCE 7 K_zt γ values of 3, 4 and 2.5 for ridge, hill and escarpment, which derive from the same guideline.)
- JH75 predicts the maximum speed-up at about one tenth of the inner-layer depth (verified: review extract).

Validity:
- The formulas hold for gentle slopes. They overpredict once flow separates (H/L ≳ 0.3–0.5).
- Engineering codes cap the effect for steep features. The Australian wind code uses a hill-shape multiplier, Mh = 1 + [H/(3.5(z + L1))]·[1 − |x|/L2] [V] (AS/NZS 1170.2, eq. 4.4(2)) (verified: equation text).
  - L_u is the horizontal distance from the crest to half-height on the upwind side.
  - L1 = max(0.36 L_u, 0.4 H); L2 = 4 L1 upwind of the crest (UNVERIFIED: L1/L2 definitions quoted from memory of the 2011 edition).
  - For steep features, H/(2L_u) > 0.45, the code switches to a separation-zone value Mh = 1 + 0.71·(1 − |x|/L2) (UNVERIFIED against the 2021 edition).
- Askervein Hill (116 m) is the classic validation dataset [V] (Taylor & Teunissen 1987).
- On a larger, steep, isolated mountain (Big Southern Butte, about 800 m relief), "mountaintop winds were often twice as high as wind speeds measured on the surrounding plain" [V] (Butler et al. 2015).

*Fire relevance*: a fire running up a windward slope meets its strongest winds at the crest. That is where the embers get lofted into the lee.

**Lee-slope flow separation and eddies.** "For a neutral, turbulent flow, separation will generally occur when the lee-slope exceeds a critical value of approximately 20°" [V] (Sharples et al. 2012, citing Wood 1995).
- Wood (1995) found the critical slope for separation decreases with increasing surface roughness [V]. Forests are rough, so separation over forested NSW ridges should be expected at or below about 20° [L].
  - (verified: Wood 1995 abstract. The critical slope Θ_crit is the lowest slope giving zero surface stress, and his analytic expression depends on inner- and middle-layer heights and on roughness. The direction "rougher → lower Θ_crit" is from secondary summaries.)
  - (verified: Ross & Vosper 2005, QJRMS 131:1841–1862. Canopy simulations "show enhanced flow separation in the presence of a canopy".)
- Under separation, a recirculating eddy forms on the lee slope. Near the ground, the wind blows up the lee slope, *against* the synoptic wind, and is gusty and direction-variable.
- In the ACT/Brindabella region, joint wind speed/direction distributions identified "thermally-driven winds, lee-slope eddies and dynamic channelling" as the dominant wind–terrain states [V] (Sharples, McRae & Weber 2010).
- Reattachment typically occurs a few hill-heights downstream. One wind-tunnel case gave 6.4 H, with longer bubbles for rough hills and smaller ones behind 3-D hills (UNVERIFIED: the primary wind-tunnel paper is not identified. Use the value only as an order of magnitude for the lee-eddy mask length, about 3–7 H.)
- *Fire relevance*:
  - a fire on a lee slope may *back up* toward the ridge instead of running downwind;
  - embers from the ridge are recirculated;
  - the lee eddy is the ambient vorticity source for VLS (§2.6).

**Valley channelling.** Whiteman & Doran (1993) identified four mechanisms linking ridge-top winds to valley winds [V]:
1. thermal forcing;
2. downward momentum transport (winds aloft follow through);
3. forced channelling (the wind aligns with the valley axis in the direction of the along-axis component of the upper wind);
4. pressure-driven channelling (the wind blows along the axis from high to low pressure).

Mechanism 4 can produce valley winds nearly *opposite* to the ridge-top wind. "The valley wind direction depends strongly on the component of the synoptic-scale pressure gradient … superimposed along the valley's axis" [V].
- (verified: Whiteman & Doran 1993, JAM 32:1669–1682. The data were from the Tennessee Valley, where pressure-driven channelling was most common at night and in stable conditions.)
- *NSW evidence* (verified: Webb & Park 2023, JSHESS 73:194–211): a 10-year climatology (2010–2020) of AWS, sounding and ERA5 data in the **Hunter Valley** identified the dominant channelling types there. Pressure-driven channelling blows from high to low pressure along the axis. Forced channelling follows the geostrophic wind, through downward momentum transport, and is aligned by the valley walls. The valley is known for strong winter westerlies and hot, dry summer north-westerlies, and its elevated fire danger is linked to this channelling.
- *Gaps and saddles*: flow is concentrated through low points in ridgelines (mass continuity: U₂ ≈ U₁·A₁/A₂ [D]), so saddles are preferential paths for fire and embers.

**Mountain waves, trapped lee waves and downslope windstorms** [L] (Scorer 1949; Durran 1990):

```
Scorer parameter:   l²(z) = N²/U² − (1/U)·d²U/dz²
Trapped lee waves when l² decreases strongly with height (e.g. stable layer near ridge-top under weaker stability/stronger wind aloft);
two-layer criterion: l_lower² − l_upper² > π²/(4·H_lower²)
Trapped-wave horizontal wavelengths ≈ 5–35 km [V, EUMeTrain]
```
Tags for this block:
- Scorer parameter and two-layer criterion: (verified: Scorer 1949 as restated in later papers. Trapping needs l₁² > k² > l₂² and l₁² − l₂² > π²/(4h²), with h the depth of the lower layer.)
- Wavelengths: (verified: EUMeTrain says "5–35 km", trapped in a layer of high static stability and moderate wind, usually in the lowest 1–5 km). Trapping is favoured "when wind speed above the mountain increases sharply with height and when stability decreases in the layer just above the mountain top".

Australian evidence (BoM/BNHCRC ACCESS case studies at about 440 m grid spacing; Kepert et al. 2016, Hazard Note 24). Mountain waves were identified as a factor in three fires, which "suggests that the impact of mountain waves on fire is a reasonably common problem" (verified):
- **State Mine fire, Blue Mountains, NSW, 17 October 2013.** The fire grew from 1,036 to 12,436 ha in about 10 h. Modelling showed that "a band of strong winds extended downwards towards the surface in the vicinity of the fire" (verified: BNHCRC 2017; BoM blog).
- **Aberfeldy fire, Victoria, 17 January 2013 (night).** The fireground was high on the southern slopes of the Great Divide. Modelling "showed clear evidence that mountain waves and strong downslope winds developed overnight". These "would have directly increased the fire intensity and spread, as well as contributed to firebrand transport" (verified: BNHCRC 2017).
- **Margaret River fire, WA, 2011.** The ingredients were "nocturnal cooling, reasonably strong synoptic flow, gentle upwind slope and steeper downwind" (verified: BNHCRC 2017 / Hazard Note 24).
  - The BoM summary adds that "in contrast to the State Mine fire, strong near-surface atmospheric stability due to a nocturnal temperature inversion" was crucial to wave development in another of the cases.
  - So mountain-wave wind can occur **both** with a night-time surface inversion (probably Margaret River and/or Aberfeldy) **and** without a strong surface inversion (State Mine, per the BoM contrast). Do not gate the FireSim mountain-wave flag on night-time alone.
  - (UNVERIFIED: the extract does not name which case the stability statement refers to.)
  - This recipe is directly usable as a FireSim detection rule (card 13).
- (CORRECTED: the earlier draft attributed the Aberfeldy "overnight" quotes to the State Mine fire.)

NSW evidence (continued):
- **Tathra (Reedy Swamp fire), 18 March 2018.** Simulations at 100 m and 400 m found [V] (Wilke, Kepert & Tory 2022, WAF 37:581–600) (verified: abstract):
  - horizontal convective rolls interacting with terrain, producing strong ascent and descent, accelerated ember lofting and likely lee-slope fire behaviour;
  - trapped lee waves hypothesised to have contributed to the strong winds;
  - the abstract also cites "complex interactions between mountain waves, organised convection and the passage of a frontal system";
  - Bega (14 km NW of Tathra): maximum temperature 38.6 °C, NW gust of 76 km/h at 13:37 (verified: AIDR Knowledge Hub / Wikipedia summary of the event; not from the paper itself);
  - the fire's spread slowed late in the afternoon when a southerly change arrived.

*Fire relevance*: wave-induced downslope winds can arrive at night, in the lee, when crews expect calm. Their existence and amplitude are "sensitive to the atmospheric temperature structure and vertical variation of the wind" [V], so they are hard to forecast.

**Foehn / isentropic drawdown in the lee of the GDR.** Sharples et al. (2010, JAMC 49:1067–1095) confirmed "the existence of a foehn effect over parts of southeastern Australia" [V]:
- It is "primarily due to the partial orographic blocking of relatively moist low-level air and the subsidence of drier upper-level air in the lee of the mountains".
- It is mechanically driven isentropic drawdown during pre-frontal NW–W gradient winds [V].
- Seasonality: autumn, winter and spring, when westerly/north-westerly flows cross the ranges [V] (Sharples & Ma 2026) (verified: UNSW "Ask an Expert", 27 January 2026). A field cue from the same article: cloud on the windward side of the range with clear skies on the lee side is "a good indicator of Foehn winds". This makes a useful observation prompt for the app.
- Scale: foehn-driven fires accounted for about half of the major 2019–20 events [V] (McRae 2023, via UNSW) (verified).
- (verified: Sharples et al. 2010 abstract for the mechanism quotes above. UNVERIFIED: foehn frequency and typical ΔT/ΔRH statistics from that paper were not extracted.)

*Worked example* [D]: dry air at θ = 312 K with mixing ratio r = 2 g kg⁻¹ (typical of about 700 hPa on a hot day) is drawn down to 980 hPa.
- T = θ·(p/1000)^0.286 ≈ 310.2 K ≈ 37 °C;
- vapour pressure e = r·p/(0.622 + r) ≈ 3.1 hPa, so T_d ≈ −9 °C;
- **RH ≈ 5 %.**

(verified: re-computed. T = 312 × 0.98^0.286 = 310.2 K; e = 0.002 × 980/0.624 = 3.14 hPa; T_d = −8.9 °C; e_s(37 °C) = 62.9 hPa; RH = 5.0 %. For context, θ = 312 K at 700 hPa means T700 ≈ 8.6 °C, which is plausible on a hot pre-frontal day.)

This is why foehn afternoons in the lee (for example the Monaro, the Bega and Shoalhaven lee slopes, and the Sydney basin under westerlies) produce extreme dead-fuel dryness within hours.

**Dry slots and abrupt surface drying.**
- Mills (2008a, b) describes abrupt surface drying events in southern Australian forests. They are linked to dry convective mixing of mid-tropospheric dry air into deep mixed layers [V].
- For 29 December 2019 to 2 January 2020, 2.2 km Unified Model runs show near-surface dry air that originated in the upper atmosphere over the Indian and Southern Oceans. It circulated around an anticyclone, descended "as a dry slot onto a deep mixed layer" and reached the surface "rapidly … through convective rolls", producing FFDI > 100. The dry region formed ahead of a strong front (verified: Ayat, Lane, Wales, Reeder & Huang 2025, JGR 130(6) e2024JD041706, abstract).
- Mills (2005, AMM 54:265–290) analysed the sub-synoptic meteorology of the January 2003 extreme days (verified: citation).

**Turbulence, gustiness and direction variability.** In complex terrain the wind direction at lee and valley sites is multi-modal, not a Gaussian scatter around the synoptic direction [V] (Sharples et al. 2010 EMS; Sharples et al. MODSIM 2009, "An empirical probabilistic study of wind direction over complex terrain") (verified in substance: Sharples, McRae & Weber 2010 EMS 25:1099–1120 use joint speed–direction distributions to identify multiple wind–terrain states; the MODSIM 2009 title is UNVERIFIED). FireSim should represent this as a probability distribution, not as one arrow [H].

### 2.6 Fire–terrain–atmosphere coupling (dynamic fire behaviour)

**Vorticity-driven lateral spread (VLS) / fire channelling.**

- **Definition**: "a wildland fire spreads rapidly across a steep leeward slope in a direction approximately transverse to the background winds". It is often accompanied by "a downwind extension of the active flaming region and intense pyro-convection" [V] (Simpson et al. 2014).
- **Discovery**: first noted by McRae (2004) in multispectral line-scan data from the 2003 Canberra fires [V]. The upwind edge of the lateral-spread region is "constrained by a major break in topographic slope, such as a mountain ridge line". The active flaming zone commonly extends "hundreds of meters downwind … most likely due to enhanced spotting" [V].
- **Mechanism** [V] (Simpson et al. 2013 LES; 2014 WRF-Fire):
  1. Flow separation over the steep lee slope creates ambient horizontal vorticity (the lee eddy's rotation axis runs along the ridge).
  2. The fire's rising plume tilts and stretches this into strong vertical vorticity.
  3. That vertical vorticity carries the fire laterally along the slope, just below the ridge.
- **Criteria** [V] (Sharples & Hilton 2020, synthesising Sharples et al. 2012 and Simpson et al. 2016):
  - "a leeward slope angle in excess of about 20–25°";
  - "a leeward aspect that aligns to within 30–40° of the wind direction";
  - "wind speeds in excess of about 20 km h⁻¹".

  Sharples et al. (2012) used a terrain filter of steep plus lee-facing cells and showed that it "consistently identified" the parts of the 2003 landscape where channelling was observed [V].
  - (verified: Sharples & Hilton 2020 and the Sharples Ginninderry report for the three criteria.)
  - The terrain filter has two parameters: a slope threshold σ, applied to the first-order terrain gradient, and an aspect-discrepancy threshold δ, the difference between aspect and wind direction.
  - For the Canberra 2003 events σ ≈ 25° and δ ≈ 40° (verified: Sharples et al. 2015, BNHCRC Report 2015.018).
  - Sharples & Hilton (2020) applied the filter elsewhere with θ_w = 125°, σ = 10.5° and δ = 40° (verified). The thresholds are applied "depending on the spatial resolution under consideration", so **σ must be recalibrated to the DEM resolution FireSim uses**.
- **Interdependence** [V]: Simpson et al. (2016, GRL 43:1744–1751) found lateral spread "highly sensitive" to background wind speed, to wind direction relative to aspect and to lee-slope steepness. The idealised thresholds agreed broadly with the empirical Canberra thresholds, and they present "a theory to explain these thresholds and their apparent interdependency". Rapid lateral spread occurs only in a relatively narrow band of the lee slope near the top of the hill (verified: secondary summary).
  - Wind threshold (verified: Sharples, Simpson & Evans 2013, MODSIM pp. 263–269; Sharples et al. 2015 report):
    - with a reference wind of 2.5 m/s there was "no lateral fire spread beyond that expected from only the background wind and slope effects";
    - the coupled-model threshold is about 5 m/s (18 km/h), "in general agreement with the value of 20 km h⁻¹ suggested by Sharples et al. (2012)".
  - The transition from quasi-steady to dynamic spread "can be quite abrupt, requiring only minimal changes in wind speed and direction [or slope] for onset" (verified: same sources).
  - (CORRECTED: the wind set U₀ = 2.5, 5, 7.5, 10, 15 m/s and the 35° idealised slope had been attributed to Simpson et al. 2016. The 2.5 m/s null result is from the 2013 MODSIM study. The exact wind set and slope of each study are UNVERIFIED.)
  - Steeper slopes appear to lower the wind threshold. The exact threshold pairs could not be read in full here [L]. FireSim therefore uses a smooth joint score, not hard cut-offs (§4.5).
- **Rates**:
  - In LES, spread was first "upslope … to the mountain ridge line at an average rate of 2.0 km h⁻¹, followed by predominantly lateral spread close to the ridge line at a maximum rate of 3.6 km h⁻¹" [V] (Simpson et al. 2013) (verified: IJWF 22:599–614 abstract).
  - For the two highest reference-wind cases in the WRF-SFire runs of Sharples, Simpson & Evans (2013), the lateral rate of spread "oscillated between 0.4 km h⁻¹ and 5 km h⁻¹". The oscillations were quasi-periodic, with peaks about **10–15 min apart** (verified: MODSIM 2013 / AMS 10th Fire & Forest Met. Symposium abstract). (CORRECTED: previously attributed to the 2016 GRL paper.) The lateral spread pulses; it is not steady.
  - *Coupling matters*: at high resolution, switching on fire-to-atmosphere coupling increased the upslope rate of spread by up to 2.7× and the lateral rate by up to **9.5×** (verified: Simpson et al. 2014 abstract). An uncoupled model with ambient wind alone will badly under-predict VLS.
  - *First landscape-scale observations* (verified: "Observations of Vorticity-Driven Lateral Spread in a Wildfire", *Fire* 9(2):79, February 2026). HPWREN cameras on Santiago Peak, California, recorded the 2024 Airport Fire spreading by VLS on two consecutive days:
    - overall lateral ROS averaged **1.9 km/h**;
    - it rose to about 4 km/h around plume touch-down events, with peaks of 20 km/h;
    - the effective downwind spread of the whole fire envelope was 45 km/h, through dense spot fires downwind of the ridge line.
    - This is outside NSW but is the best field calibration available. Authors not confirmed here.
- **Embers / "deep flaming"** [V] (Hilton, Garg & Sharples 2019): as the fire spreads laterally it "casts off" embers downwind, producing large areal flaming zones ("deep flaming").
  - Their Lagrangian firebrand extension to the Spark VLS model reproduced this (verified: MODSIM2019 pp. 761–767, doi:10.36334/modsim.2019.H7.hilton2).
  - The NSW example is the Yankees Gap fire (Bega Valley, 15 September 2018). A small fire ignited at 13:20, burned back against the wind, then spread laterally across the wind to the SW, consistent with VLS, and "spilled out" downwind as a mass of spot fires (verified: figure caption in Hilton et al. 2019). The fire eventually burned about 20,000 ha (verified: ABC coronial-inquiry report).
- **Escalation**: in the Grose Valley (Blue Mountains, November 2006), line-scan showed that "deep flaming in numerous locations was primarily caused by the lateral spread associated with fire channelling", linked to pyroCb formation [V] (McRae, Sharples & Fromm 2015).
- **Resolution warning** [V]: whether WRF-Fire resolves VLS is sensitive to horizontal and vertical grid spacing, tested between 25 and 90 m, and to fire–atmosphere coupling (Simpson et al. 2014). "VLS is not modelled for a horizontal and vertical grid spacing of 90 m", and about **30 m or finer is optimal** (verified: Simpson et al. 2014 abstract). **Our 100–200 m atmosphere grid cannot produce VLS explicitly**, so we parameterise it (§4.5).
- **Cheap models exist** [V]: Sharples & Hilton (2020) reproduced VLS in a 2-D level-set model (Spark) using "near-field" pyrogenic-potential techniques. These models are much cheaper than coupled LES, which can take days on supercomputers, while pyrogenic potential runs in seconds (Hilton et al. 2018).
  - (verified: Hilton et al. 2018, EMS 107:12–24. The pyrogenic-potential model is "orders of magnitude faster than a full CFD model". It reproduces parabolic head-fire shapes, attraction between nearby fires and closure of V-shaped fires. "Days on supercomputers" is UNVERIFIED wording.)

**Eruptive (blow-up) fire in canyons and gullies.** Covered in detail in the fire-behaviour note. The meteorological point: in steep drainage lines, the fire-induced flow attaches to the slope and the flame lies down on the fuel. Laboratory and simulation work reports attachment for slopes of roughly 20–35° depending on trench geometry [V/L] (Viegas & Simeoni 2011; Dold & Zinoviev 2009; trench-fire studies).
- (verified: Dold & Zinoviev 2009, CTM 13:763–793. Attachment versus separation of the flow is what distinguishes eruptive from steady spread. The eruption is controlled mainly by burnout time and the Byram number. In one cited experiment the flow changed between a 25° and a 30° incline.)
- (UNVERIFIED: a single universal attachment angle; it depends on geometry.) Spread then accelerates with no change in ambient wind: the "chimney effect".

**Pyroconvection and pyrocumulonimbus (pyroCb).**

Events in and near NSW:
- **Canberra, 18 January 2003**:
  - pyroCb "eruptions" with stratospheric smoke injection;
  - suppressed precipitation, black hail and an F2 tornado;
  - at least 500 buildings destroyed and 4 lives lost [V] (Fromm et al. 2006) (verified: GRL 33:L05815 abstract. The pyroCb lifetime was about 3 h).
  - It was the first confirmed Australian pyro-tornadogenesis, "not a fire whirl" [V] (McRae et al. 2013) (verified: abstract).
    - The tornado was at least F2 intensity, moved at over 30 km/h and had a basal diameter of nearly 0.5 km at Chapman.
- **Black Summer 2019–20**:
  - Peterson et al. (2021) documented **38 pyroCb pulses** in the "super outbreak" of 29–31 December 2019 and 4 January 2020 (verified: *npj Clim. Atmos. Sci.* 4:38).
    - Radar echo tops showed that 20 of the 38 (53 %) reached the lower stratosphere.
    - (CORRECTED: the date range is not continuous to 4 January.)
  - Season totals of more than 50 have been reported in secondary sources (UNVERIFIED: no primary count confirmed).
- **Black Saturday (Victoria, 2009)**, the analogue for lightning: pyroCbs reached about 15 km, generated hundreds of lightning strokes and could ignite new fires downwind [V] (Dowdy et al. 2017) (verified: JGR 122:7342–7354 abstract).
  - Six fire complexes produced three distinct pyroCbs.
  - The first pyroCb lightning came about 5 h after ignition of the largest complex.

Climatology of pyroCb days (southeast mainland, 1991–2020) [V] (Wilson, Sharples & Evans 2025):
- hot, relatively dry, very unstable and moderately windy near-surface and low-level conditions;
- steep mid-level lapse rates and significant diurnal mid-level moisture advection;
- the majority of recorded events in the last 20 years.
- (verified: Wilson, Sharples & Evans 2025, *Sci. Rep.* 15:38538 abstract. The conditions are "at least conditionally favourable for high-based thunderstorm development".)

**C-Haines** (Mills & McCaw 2010, CAWCR Tech. Rep. 20) [V for form and cap; L for exact coefficients as reproduced in secondary sources]:

```
DD850 = T850 − Td850 ;  if DD850 > 30 then DD850 = 30            [°C]
CA = 0.5·(T850 − T700) − 2                                        (stability term)
CB = 0.3333·DD850 − 1 ;  if CB > 5 then CB = 5 + (CB − 5)/2        (moisture term; upper bound CB = 7)
CH = CA + CB
```

- (verified: component structure, "a stability component based on the 850–700 hPa temperature difference (CA) and a dryness component based on the 850 hPa dew point depression (CB)", with two conditional caps on CB. UNVERIFIED: the numeric constants −2, 0.3333, −1, 30 and 5 + (CB − 5)/2 could not be read in the CAWCR PDF. They match the widely used operational formulation. Cross-check against CTR_020 before hard-coding.)
- *Range*: typically 0–13, and values above 13 are possible.
  - The upper limit follows from the caps: DD850 ≤ 30 gives CB ≤ 7, so CH exceeds 13 only when T850 − T700 > 16 K.
- *Percentiles*: the 95th percentile is about 7–10, depending on location in southeast Australia [V].
  - (verified: Tasmanian work uses CH = 9 as the local 95th percentile. Other regions are UNVERIFIED. Use a location-specific climatology from reanalysis if possible.)
- *PyroCb cases*: CH of about 10–11 has been associated with pyroCb development [V].
  - (verified: Di Virgilio et al. 2019, GRL 46:8517 ff. used two joint threshold sets for pyroCb-conducive days: **CH ≥ 8 with FFDI ≥ 25**, and the stricter **CH ≥ 10 with FFDI ≥ 50**. Conditions conducive to pyroCb are described as "extreme C-Haines conditions (10–13.7)" with very high to catastrophic FFDI over forested, rugged landscapes.)
  - CH alone is not sufficient. Always pair it with surface fire danger and an active large fire.
- *Worked example* [D]: T850 = 20 °C, T700 = 6 °C, Td850 = −5 °C.
  - CA = 0.5·14 − 2 = 5;
  - CB = 25/3 − 1 = 7.33, which the cap reduces to 6.17;
  - **CH = 11.2**, which is extreme.
- *Caveat for alpine NSW* [H]: at Kosciuszko-plateau elevations (1,500–2,200 m) the 850 hPa level is near or below ground, and NWP 850 hPa values are extrapolated. Flag CH as less meaningful above about 1,200 m and show the moisture and stability terms separately.

**Pyrocumulonimbus Firepower Threshold (PFT)** [V for structure and units; L for exact constant] (Tory & Kepert 2021, WAF 36:439–456). PFT is the minimum fire heat flux into the plume base needed for pyroCb, computed from the atmosphere alone:

```
PFT ≈ 0.3 · z_fc² · U_ML · Δθ_fc          [GW]  with z_fc in km (height of plume free-convection level above ground),
                                               U_ML in m s⁻¹ (mean mixed-layer wind), Δθ_fc in K (θ excess needed at z_fc)
```

The 0.3 comes from constants with ρ₀ = 0.755 kg m⁻³ [V]. Stronger wind means more firepower is required, because the wind bends and dilutes the plume [V]. For example, z_fc = 3 km, U = 10 m/s and Δθ = 1 K give about 27 GW [D].

Tags for PFT:
- (verified: Tory & Kepert 2021 abstract. The PFT uses Briggs plume-rise equations to convert Δθ, z_fc and the mean mixed-layer wind U into "the minimum heat flux entering the base of the plume". It is "proportional to the product of U, Δθ, and the square of z_fc". The simplified PFT₁ takes z_fc in km, U in m/s and Δθ in K, and gives GW.)
- (UNVERIFIED: the leading constant 0.3. It is consistent with ρ₀ ≈ p_fc/(R_d·θ_fc) ≈ 0.76 kg m⁻³ at about 700 hPa, and with a Briggs-type prefactor π·c_p·ρ₀·[β/(1+αβ)]² × 10⁶ m² km⁻² ≈ 0.3 GW for β ≈ 0.4. Confirm it against the paper, or better, implement the full expression, which uses p_fc and θ_fc, as in the open-source `metfor::pft` Rust function.)

Compare with the simulated convective heat release P ≈ Σ(I·Δs) over the active front [D], where I is Byram intensity (W/m) and Δs is front length. The fraction of P that is convective, and so enters the plume, is uncertain [H].

**Byram convection number** (plume-dominated vs wind-driven) [V for form and thresholds] (Byram 1959; Nelson 1993; Morvan & Frangieh 2018):

```
Nc = 2·g·I / (ρ·c_p·T_a·(U − R)³)     I in W m⁻¹, U wind and R spread rate in m s⁻¹, T_a in K
Nc > 10 → plume-dominated;  Nc < 2 → wind-driven
```

Worked examples [D], assuming ρ = 1.1 kg m⁻³, c_p = 1005 J kg⁻¹ K⁻¹ and T_a = 300 K:
- I = 20 MW m⁻¹, U = 5 m/s, R = 0.5 m/s gives Nc ≈ 13 (plume-dominated). With ρ = 1.2 it is ≈ 12.
- The same fire at U = 15 m/s gives Nc ≈ 0.4 (wind-driven).
- For 2 < Nc < 10 the regime is mixed or transitional.

Tags for Nc:
- (verified: the formula and the < 2 / > 10 bands as commonly cited; Morvan & Frangieh 2018 relate Nc to the ratio R/U_w.)
- U in Nc is the wind at mid-flame or 10 m height, depending on the author (UNVERIFIED which). FireSim should use the 10 m open wind and label Nc as indicative.

### 2.7 NSW synoptic fire-weather patterns

1. **Pre-frontal hot NW–W winds.** A high in the Tasman and an approaching cold front or pre-frontal trough draw hot, dry continental air toward the coast [V] (BoM Fire Weather Knowledge Centre; January 1994 fires).
   - Winds are strongest and driest just ahead of the change.
   - Crossing the GDR adds foehn and drawdown drying on the eastern side (§2.5).
   - This is the classic "Red October / Black Summer" day for the Blue Mountains and the south and mid-north coast hinterland.
2. **SW (or S) wind change / cold front.** "The worst fire days on record have happened when cold fronts have moved over active bushfires… hot, gusty north-east to north-west winds turning to cooler south-westerly winds… causing long fire-fronts to expand rapidly" [V] (BoM) (verified: BoM Fire Weather Knowledge Centre, "How weather affects fires"; "in southern Australia", with the change typically in the afternoon or evening).
   - Kilmore East: the change between 17:30 and 18:30 turned the roughly 55 km eastern flank into a head fire [V] (Cruz et al. 2012) (verified: abstract. The fire burned about 100,000 ha in under 12 h; spot fires reached up to 33 km ahead).
   - The new head-fire width equals the flank length at the time of the change [D].
   - In mountains the change is distorted: channelled up some valleys, delayed or blocked by ranges, and arriving first on ridges [H].
3. **Southerly buster** (NSW coast and escarpment). It is a coastally trapped disturbance: cool air is trapped against the GDR, and the front distorts into an "S" shape [V] (BoM).
   - *Definition*: southerly gusts > 54 km/h with a temperature fall ≥ 5 °C in 3 h. Falls of 10–15 °C in under an hour are common and up to 20 °C within minutes can occur [V].
     - (verified: BoM "The big bust" blog, "southerly winds gusting in excess of 29 knots (54 km/h) and a 3-hour temperature drop of at least 5 °C"; the strongest have gusted past 60 kn.)
     - (UNVERIFIED: the 20 °C figure appears only in media summaries.)
     - Busters occur mostly between October and February.
   - *Travel*: typically about 530 km from Cape Howe to the Nowra–Newcastle section in 12–15 h. It peaks between Nowra and Newcastle [V] (verified: BoM blog). That is a mean speed of about 35–45 km/h, so the app can estimate arrival time along the coast [D].
   - *Depth*: generally < 1 km [V] (Colquhoun et al. 1985; BoM) (verified: EUMeTrain / BoM conceptual model of shallow cold fronts. The depth is "generally less than 1 km and is below the average height of the Great Dividing Range"; a typical buster is 30–100 km wide).
     - Coastal fires turn north and escarpment fires can be driven upslope.
     - Tableland fires may be unaffected, because the surge is shallow and blocked.
     - Colquhoun et al. (1985) analysed 17 busters from 1972–78. Most developed ahead of Southern Ocean fronts rather than being those fronts (verified: MWR 113:2090–2107 abstract).
4. **Spring westerlies** (September–November) after cold fronts. These are dry, gusty downslope flows over the escarpment toward the coast. Mountain-wave events are possible, as at the State Mine fire on 17 October 2013 [V] and at Tathra (March 2018, late summer), where W–NW flow crossed the escarpment [V].
5. **Dry lightning and pyroCb days.** Instability plus mid-level moisture (§2.6). For example, Dunns Road was ignited by lightning on 27 December 2019 [V] (verified: coronial evidence puts the strike at about 23:50 on 27 December 2019 on the Ellerslie Range east of Tarcutta; many sources give 28 December).

---

## 3. Quantitative reference card (for the physics engine)

| Quantity | Equation / value | Units | Range / validity | Source [tag] |
|---|---|---|---|---|
| Dry adiabatic lapse | Γ_d = g/c_p = 9.8 | K km⁻¹ | unsaturated | textbook [D] |
| Dew-point lapse, mixed layer | ≈ 1.8 | K km⁻¹ | constant mixing ratio | Stull 1988 [L] |
| LCL height | ≈ 125·(T − T_d) | m | rule of thumb | Espy [L] |
| Saturation vapour pressure | 6.112·exp(17.67T/(T+243.5)) | hPa | −30…35 °C | Bolton 1980 [L] |
| Brunt–Väisälä | N² = (g/θ)·dθ/dz | s⁻² | N ≈ 0.01–0.02 | textbook [D] |
| Froude number (height) | Fr_h = U/(N·h) | – | ≪1 blocked; ~0.6–1.1 lee jump / windstorm (2-D idealised) | Durran 1990; Lin & Wang 1996 [L] |
| Froude number (width, Stull) | Fr_w = λ/(2W), λ = 2πU/N | – | ≈1 wave resonance | Stull ch. 17 (verified) |
| Scorer parameter | l² = N²/U² − U''/U | m⁻² | trapped waves if l² ↓ with z; λ ≈ 5–35 km | Scorer 1949 (verified) |
| Upslope wind | 1.3–3.6 (3–8 mph) | m s⁻¹ | clear, weak synoptic | NWCG PMS 437 (verified; US values) |
| Downslope wind | 0.9–2.2 (2–5 mph) | m s⁻¹ | shallow, laminar | NWCG PMS 437 (verified; US values) |
| Valley wind peak | 4.5–6.7 (10–15 mph) | m s⁻¹ | larger valleys; lags slope winds 1–3 h | NWCG PMS 425-1/437 (verified; US values) |
| Prandtl slope-flow profile | §2.3 | – | shape function | Prandtl 1942 [D] |
| Topographic amplification | TAF = (A/V)_valley/(A/V)_plain | – | ≥1 | Steinacker 1984 [V] |
| Inversion break-up | 3.5–5 h after sunrise | h | deep Colorado valleys; longer if snow or wet ground | Whiteman 1982 (verified) |
| Heat deficit | c_p∫ρ(θ_h − θ)dz | J m⁻² | bulk | Whiteman et al. 2004 [L] |
| Mixed-layer growth | h² = h0² + 2(1+2β)∫w'θ'dt/γ | m² | β ≈ 0.2 | Tennekes 1973 [L] |
| Hill speed-up | ΔS = B·H/L, B = 2/1.6/0.8 | – | H/L ≲ 0.3–0.5 | Taylor & Lee 1984 (UNVERIFIED coefficients) |
| Height decay of speed-up | exp(−A·z/L), A = 3/4/2.5 | – | ridge/hill/escarpment | Taylor & Lee 1984; matches ASCE 7 γ [L] |
| Separation slope | ≈ 20° (lower if rough or forested) | ° | neutral flow | Wood 1995; Sharples 2012; Ross & Vosper 2005 (verified) |
| AS/NZS separation switch | H/(2L_u) > 0.45 (≈ 24° mean upwind slope) | – | engineering code | AS/NZS 1170.2 (UNVERIFIED for 2021 edition) |
| VLS slope | > 20–25° (Canberra fit σ ≈ 25°; DEM-dependent) | ° | lee-facing | Sharples & Hilton 2020; Sharples et al. 2015 (verified) |
| VLS aspect tolerance | within 30–40° of wind direction (δ ≈ 40°) | ° | aspect ≈ downwind | Sharples & Hilton 2020; Sharples et al. 2015 (verified) |
| VLS wind | > ~20 km h⁻¹ empirical; ≈ 5 m s⁻¹ (18 km h⁻¹) in coupled sims; none at 2.5 m s⁻¹ | km h⁻¹ | ridge-level / reference wind | Sharples 2012; Sharples, Simpson & Evans 2013; Sharples et al. 2015 (verified) |
| VLS lateral ROS | 3.6 max (LES); 0.4–5 oscillating, ~10–15 min period (WRF-SFire); 1.9 mean, 4 near touch-down, 20 peak (observed) | km h⁻¹ | idealised / Airport Fire 2024 | Simpson 2013; Sharples 2013; *Fire* 2026 (verified) |
| WRF-Fire resolution for VLS | not resolved at 90 m; ≤ 30 m optimal | m | coupled model | Simpson et al. 2014 (verified) |
| C-Haines | CA + CB (§2.6) | – | 0–13+; 95th pct ≈ 7–10 (Tas ≈ 9) | Mills & McCaw 2010 [V/L] |
| PyroCb-conducive days | CH ≥ 8 & FFDI ≥ 25; stricter CH ≥ 10 & FFDI ≥ 50 | – | SE Australia | Di Virgilio et al. 2019 (verified) |
| PFT | 0.3·z_fc²·U·Δθ_fc | GW | – | Tory & Kepert 2021 (form verified; constant UNVERIFIED) |
| Byram Nc | 2gI/(ρc_pT(U−R)³) | – | >10 plume; <2 wind; 2–10 mixed | Byram 1959; Nelson 1993; Morvan & Frangieh 2018 (verified) |
| Southerly buster | gust >54 km h⁻¹, ΔT ≥ 5 °C/3 h | – | depth <1 km; ~530 km in 12–15 h | BoM / Colquhoun 1985 (verified) |
| Long-distance spotting (SE Aus.) | most < 5 km; occasional to 14 km | km | 338 line-scan obs., 2002–2018 | Storey et al. 2020 (verified) |
| Mountain-wave recipe | nocturnal cooling + reasonably strong synoptic flow + gentle upwind slope + steeper lee slope | – | qualitative | Kepert et al. 2016 / BNHCRC 2017 (verified) |

---

## 4. Implementation recommendations

### 4.1 Architecture: a layered "diagnostic-plus" atmosphere, not a full LES

Cost of a full compressible or anelastic LES at our resolution:
- The atmosphere grid is 10 km / 100 m × 10 km / 100 m × 30 levels ≈ 3×10⁵ cells.
- Explicit advection with plume updrafts of about 10 m/s and near-surface Δz ≈ 20–30 m needs Δt ≈ 2–3 s. A 6 h scenario is then about 10⁴ steps, or about 3×10⁹ cell-updates at hundreds of flops each.
- That is 10¹¹–10¹² flops, several minutes to tens of minutes in a phone Web Worker [D].
- Even then, 100 m cannot resolve VLS (§2.6).

**Recommended stack.** Each layer is cheap and each produces its own "why" diagnostics.

| Layer | What | Grid | Update cadence | Est. cost/update [D] |
|---|---|---|---|---|
| A. Background column | Vertical profiles of T, T_d, U, V (surface–3 km) from forecast, reanalysis, observations or belt-weather-kit; time-interpolated | 1-D, 30 levels | hourly forcing, interpolated | negligible |
| B. Valley-column thermodynamics | 1-D inversion / mixed-layer model per valley (heat deficit, encroachment growth with TAF), driven by computed insolation and night cooling; gives inversion depth, thermal-belt band and break-up time | 1 column per catchment (~5–20) | every 10 min sim-time | negligible |
| C. Terrain wind (mass-consistent) | WindNinja-style variational adjustment of layer-A wind to terrain (minimum change subject to ∇·u = 0), with stability-dependent vertical/horizontal weighting (stable → flow around; neutral → flow over) | 150 m × 20–25 levels (≈ 67×67×25 ≈ 1.1×10⁵ cells) | on forcing change, wind change or user edit; ~every 15–30 min sim | multigrid or ~100 SOR sweeps ≈ 10⁷–10⁸ flops (< 1 s) |
| D. Thermal slope/valley flows | Add parameterised slope flow (Prandtl shape, speed capped to NWCG ranges, sign from cos i / shade / night) and valley flow (along-axis, lagged 1–3 h, amplitude ∝ TAF), blended out as ridge wind rises | fire grid near surface + lowest atmos. levels | every 10–15 min sim | cheap |
| E. Lee separation & speed-up corrections | Separation mask (lee-facing, slope > ~20°, wind above threshold) with reversed, attenuated, high-variance near-surface wind; Taylor–Lee crest speed-up for gentle features, capped at H/L = 0.5 | fire grid (10–30 m) | with C | cheap |
| F. Fire-induced flow | Pyrogenic potential (Hilton et al. 2018): solve a 2-D Poisson equation for an indraft potential with the fire's heat release as source; add to the near-surface wind for spread. Optional 3-D plume layer (G) | 2-D fire grid or coarsened ×4 | each fire step (~30–60 s sim) or every N steps | 2-D multigrid, ~10⁶–10⁷ flops |
| G. (Optional) coarse 3-D Boussinesq | Semi-Lagrangian advection (unconditionally stable, Δt ≈ 15–30 s), buoyancy from fire heat, pressure projection by multigrid; gives plume tilt, indraft, hot/cold air motion and inversion erosion for visualisation | 200 m × 20 levels (50×50×20 = 5×10⁴) | Δt 20 s → ~1,100 steps / 6 h | ≈ 3×10¹⁰ flops total → ~10–30 s |
| H. VLS module | Rule and score-based trigger (§4.5); when active, apply a lateral spread vector along the lee slope below the ridge plus enhanced downwind ember release | fire grid | each fire step | cheap |
| I. Indices | C-Haines, PFT (needs a sounding), Byram Nc, Froude number, Scorer parameter, mixing height | column | hourly | negligible |

Implementation notes:
- Use Float32Array fields in a dedicated Web Worker.
- Use WASM SIMD for the multigrid and semi-Lagrangian kernels if available.
- Use SharedArrayBuffer only if the Capacitor webview supports cross-origin isolation. Otherwise transfer ArrayBuffers.
- Emit the 3-D wind field progressively, so the user sees results "as data comes in".

### 4.2 Wind: details and simplifications

1. **Background wind.** Take the ridge-level forecast wind (for example 850 hPa, or model levels 500–1,500 m AGL) as the "free" wind. Use the surface forecast only to set the near-surface stability class.
2. **Stability switch.** Compute the height-based Fr_h = U/(N·h) from the column (N from layer B, h = local relief, U = cross-ridge component). Do not use Stull's width-based Fr_w here (§2.5).
   - If Fr_h < 0.5, weight horizontal adjustment strongly: the flow goes around and is channelled.
   - If Fr_h > 1.5, allow vertical adjustment: the flow goes over.
   - These two cut-offs are [H].
   - Raise a **mountain-wave / downslope-wind flag** on lee slopes, and add a downslope acceleration term, when all of the following hold. This is simplified and flagged as uncertain in the UI.
     - 0.6 ≲ Fr_h ≲ 1.2, the band where 2-D idealised runs give lee jumps and windstorms (Lin & Wang 1996 [L]).
     - The Scorer parameter decreases strongly with height (two-layer test §2.5), **or** there is a surface-based nocturnal inversion under reasonably strong cross-ridge flow.
     - The terrain matches the Margaret River recipe: gentle upwind slope, steeper lee slope (Kepert et al. 2016, verified qualitatively).
   - Also compute Fr_w = πU/(N·W) for the ridge width W, and raise the flag's confidence when Fr_w ≈ 0.7–1.3 [H].
3. **Channelling.** In valleys deeper than about 150 m (from DEM relief within 1 km) [H], project the wind onto the valley axis.
   - Magnitude: use the along-axis component of the ridge wind (forced channelling), or the along-axis pressure-gradient direction (pressure-driven channelling) when stable.
   - The pressure-gradient direction comes from the forecast MSLP gradient. This lets the app show counter-current valley winds.
4. **Lee eddy.** Where the lee separation mask is true:
   - set the near-surface wind to −(0.2…0.5)·U_ridge along the slope-normal projection (reversed, upslope) [H];
   - raise the direction variance, and show this as a wind "rose" instead of one arrow;
   - reduce the effective wind factor in the spread model;
   - limit the mask to about 3–7 H downwind of the crest, where H is ridge height above the lee valley floor. This is an order-of-magnitude reattachment length (UNVERIFIED, §2.5).
5. **Consequences of the simplifications:**
   - no explicit mountain-wave amplitude, rotor timing or hydraulic jumps;
   - speed-up is overpredicted on steep crests unless capped;
   - lee eddies are binary-ish;
   - fire–atmosphere feedback on the large-scale wind is missing unless layer G runs.

   The UI must label these outputs as "tendencies", not forecasts.

### 4.3 Temperature, humidity and fuel-moisture coupling

- Each fire-grid cell takes T and RH from its elevation in the column model:
  - by day, mixed-layer lapse rates (T −9.8 K/km, T_d −1.8 K/km);
  - at night, inversion profiles from layer B.
- Above the inversion top, use the free-atmosphere profile; below it, use the cold-pool profile.
- The thermal belt is the band [z_inv_top − Δ, z_inv_top + Δ] with Δ ≈ 50–100 m [H]. Show it as a translucent band on the 3-D terrain at night.
- Apply insolation (cos i, shade) to the dead-fuel-moisture model (see the fuel-moisture note). North- and west-facing sunlit cells dry fastest in the afternoon.
- Foehn/drawdown mode: when W–NW flow above about 15 m/s at ridge level [H] crosses a ridge line upwind of the domain and the site is on the lee (east) side, give the user a toggle to "draw down" the 700–850 hPa θ and mixing ratio to the surface (§2.5 example). Show the resulting T, RH and FFDI jump.

### 4.4 Time handling

- Recompute sun position, cos i and horizon shading every 10–15 simulated minutes.
- Inversion break-up time comes from layer B. At break-up, ramp the near-surface wind from the valley value to the adjusted ridge wind over about 30–60 min [H], and fire an insight card.
- Wind changes: take the forecast timing, or let the user drag a "change line" across the map with arrival time and new direction and speed. Apply a 15–30 min transition with elevated gustiness [H].

### 4.5 VLS module (parameterisation)

For each fire-grid cell c, compute:

```
lee(c)   = cos(aspect(c) − dir_to(U_ridge))              (1 = perfectly lee-facing; wind "dir_to" = direction wind blows towards)
S_slope  = smoothstep(18°, 28°, slope_250m(c))            slope from DEM smoothed to ~100–250 m (see Open Questions)
S_aspect = smoothstep(cos 45°, cos 25°, lee(c))           ≈ within 30–40° tolerance
S_wind   = smoothstep(4 m/s, 7 m/s, |U_ridge|)            ≈ 5 m/s (18 km/h) coupled-model threshold, ~20 km/h empirical; nothing at 2.5 m/s
S_ridge  = 1 if a ridge crest (break of slope) lies within ~300 m upwind, else 0     [H]
S_fuel   = smoothstep(12 %, 8 %, dead fine fuel moisture) [H]
VLS(c)   = S_slope · S_aspect · S_wind · S_ridge · S_fuel
```

The thresholds come from §2.6 [V]. The smoothing widths, ridge distance and fuel factor are [H].
- (CORRECTED: the S_wind upper edge was lowered from 8 to 7 m/s so that the score is about 0.5 at the ≈5 m/s coupled-model threshold. The edges remain [H].)
- The S_slope edges of 18–28° assume a DEM of about 25–30 m. Sharples's own terrain filter needed σ = 10.5° in one application versus σ ≈ 25° for Canberra, so **recalibrate S_slope for the DEM actually used**. One way: compute the terrain filter on the 2003 Canberra and 2006 Grose Valley DEMs and match the published VLS-prone areas.

When a burning cell has VLS > 0.5 [H]:
- add a lateral spread vector along the slope contour, in both directions, just below the crest, at 0.4–5 km/h scaled by VLS. The time-mean should be about 2 km/h, near the observed 1.9 km/h, with short peaks to about 4–5 km/h (verified range: Simpson 2013; Sharples, Simpson & Evans 2013; Airport Fire observations 2026);
- pulse it with a quasi-period of about 10–15 min (verified: Sharples, Simpson & Evans 2013), for example R_lat(t) = R̄·[1 + 0.8·sin(2πt/T)] with T drawn from 10–15 min. The waveform is [H];
- restrict it to the upper band of the lee slope, roughly the top third below the crest. The idealised runs confine rapid lateral spread to "a relatively narrow portion of the leeward slope near the top" (verified qualitatively: Simpson et al. 2016). The one-third figure is [H];
- boost ember release into the lee eddy and downwind (deep flaming) [V qualitatively; H quantitatively];
- raise the "pyroconvection escalation" score (McRae et al. 2015) [V qualitatively].

Before the fire gets there, show pre-computed VLS-prone terrain as an overlay: "these slopes can channel fire sideways if the fire reaches them in this wind".

### 4.6 User-editable inputs (meteorology)

| Input | Default source | Why editable |
|---|---|---|
| Ridge-top wind speed and direction (and gusts) | Forecast / observations | Crews can see ridge-top smoke drift and tree movement |
| Valley / site wind (belt-weather-kit) | Forecast | Nudges layer C as a weighted observation |
| Local wind arrows ("the wind here goes up this gully") | none | Mass-consistent solver treats them as observations |
| T, RH at site (kit) | Forecast | Re-anchors the column; the lapse model spreads it by elevation |
| Inversion present / depth / smoke pooled in valley | Column model | Crews can see smoke layers |
| Cloud cover (insolation) | Forecast | Controls slope-flow strength and fuel drying |
| Wind change: time, new direction, strength | Forecast | Key training scenario |
| Foehn / drawdown toggle | Auto flag | Lets the instructor demonstrate lee drying |
| Stability: C-Haines override, mixing height | NWP / sounding | Teaching pyroconvection |
| "Plume behaviour" observation (vertical column vs bent over) | Nc estimate | Switches plume-dominated / wind-driven explanations |
| Separation / VLS sensitivity sliders | Defaults in §4.5 | Instructor demonstration; uncertainty |
| "Cloud banked on the far side of the range, clear here" | none | Foehn cue (Sharples & Ma 2026); raises the foehn flag and confidence in lee drying |
| "Rain in the last 24 h / valley floor wet" | Observations | Delays inversion break-up (Whiteman 1982) and slows the fuel-drying ramp |
| DEM resolution / VLS slope-threshold calibration | Auto from DEM | σ is resolution-dependent (Sharples et al. 2015; Sharples & Hilton 2020) |
| "Strong gusts coming down the lee slope at night" | none | Observation that triggers the mountain-wave mode when the diagnostic misses it |

### 4.7 Validation and replay scenarios (NSW-centred)

- Canberra / Brindabellas, 18 January 2003 (VLS, pyroCb, pyro-tornado).
- Grose Valley, November 2006 (VLS leading to pyroCb).
- State Mine fire, 17 October 2013 (mountain-wave band of strong winds descending to the surface; 1,036 → 12,436 ha in about 10 h).
- Aberfeldy fire (Victoria), 17 January 2013. This is outside NSW but is the reference case for **overnight** mountain-wave downslope winds on an elevated fireground above the inversion.
- Tathra, March 2018 (rolls, lee waves, escarpment).
- Yankees Gap, September 2018 (VLS with spotting).
- Black Summer, 29 December 2019 to 4 January 2020: Badja Forest Road and Dunns Road (pyroCb outbreak, dry slot, foehn).

Use these to check qualitative behaviour: direction of lateral runs, timing of overnight escalation, and pyroCb flags. Do not expect exact perimeters.

---

## 5. Explaining it to a beginner firefighter: insight cards and detection criteria

The wording is plain on purpose. The thresholds are the ones the engine checks. Tags: [V] = literature-backed threshold; [H] = FireSim default, tunable.

| # | Card title | Detection criteria | Card text ("why") |
|---|---|---|---|
| 1 | **Fire can run sideways along this lee slope (VLS)** | VLS score > 0.5 (§4.5): lee slope > 20–25°, aspect within 30–40° of downwind, ridge wind > ~18–20 km/h (≈ 5 m/s) (verified: Sharples & Hilton 2020; Sharples et al. 2015); fire within ~300 m of crest [H] | "Wind pouring over this ridge breaks away from the steep downwind slope and rolls into a big invisible eddy. When fire gets into that eddy, its rising heat spins it up into a vertical whirl that drags the fire *sideways* along the slope, across the wind, typically about 2 km/h but surging to 4–5 km/h in pulses every 10–15 minutes, while throwing embers far downwind. Don't assume the flanks are safe here: a flank can become a head fire without any wind change." |
| 2 | **The wind on this slope blows the 'wrong' way** | Separation mask true: lee-facing, slope > ~20°, ridge wind > ~20–25 km/h [V/H] | "Behind a steep ridge the main wind lifts off the slope. Underneath, the air circulates back *up* the slope, gusty and changing direction. A fire here may creep uphill toward the ridge against the main wind, and embers from the ridge can land anywhere on this face." |
| 3 | **Fire is racing upslope with the morning sun** | Cell sunlit (cos i > 0.3), solar elevation > 10°, ridge wind < ~15 km/h [H]; slope > 10° | "The sun has heated this slope, and warm air is flowing up it (about 5–13 km/h). Fire here gets an extra push uphill on top of the slope effect." |
| 4 | **Evening: the wind is turning downhill** | Slope in shadow or sun < 5°, cloud < 3/8, ridge wind < ~10–15 km/h [H] | "This slope is in shadow and cooling. Cool air now drains *down* the slope and valley (3–8 km/h). The fire's upslope run should slow and it may back downhill. Smoke will sink into the valley." |
| 5 | **Valley wind: this valley has its own wind** | Valley relief > ~150 m, valley-axis wind differs > 45° from ridge wind [H] | "Valleys steer the wind along their length, whatever the wind is doing above the ridges. In the afternoon it blows up the valley, at night down it. Sometimes it even blows opposite to the wind on the tops." |
| 6 | **Thermal belt: fire stays active on the mid-slope tonight** | Night, inversion diagnosed; cell within the thermal-belt band [V concept; H band width] | "At night cold air pools in the valley bottom like water. Just above that cold pool, around the middle of the slope, it stays warmer and drier all night, so the fuel doesn't recover and fire keeps burning while the valley floor goes quiet." |
| 7 | **Ridges don't sleep** | Night; ridge cells above inversion top; ridge wind > 15 km/h [H] (concept verified: Aberfeldy 2013 case, BNHCRC 2017) | "Up here you're above the night-time cold layer. The wind keeps blowing and the air stays dry, so the fuel doesn't soak up moisture overnight and fire on the tops can stay active all night." |
| 8 | **The fire is about to wake up** | Column model: heat deficit about to be exceeded, or mixed-layer top reaching ridge height; typically 2–5 h after sunrise (verified: 3.5–5 h in deep Colorado valleys, Whiteman 1982; later if the valley floor is wet or snow-covered) | "The morning cold layer that has been holding the fire down is about to break. When it goes, the stronger, drier winds from above reach the fire within minutes. Expect a jump in speed and a change in direction." |
| 9 | **Stronger wind on the crest** | Crest cell; H/L > 0.05; computed speed-up > 25 % [H] | "Wind squeezes over the top of the hill and speeds up (here about +X %). A fire reaching this ridge will suddenly get much stronger wind and throw embers over the other side." |
| 10 | **Saddle / gap: wind and fire funnel through here** | Saddle cell on ridge and cross-ridge wind > 10 km/h [H] | "The ridge is lower here, so wind (and fire) push through the gap faster than over the higher parts." |
| 11 | **Gully / chimney run** | Drainage line with slope > 20°, fire at base, upslope aligned with wind within ±45° [H; see fire-behaviour note] | "This steep gully acts like a chimney. The fire's own heat draws air up it, and the flames lie down onto the fuel ahead. It can accelerate suddenly even though the wind hasn't changed." |
| 12 | **Hot dry wind coming down off the range (foehn)** | W–NW flow at 850–700 hPa > ~15 m/s crossing the GDR; site on lee side; forecast or observed T rise and RH fall [V mechanism; H thresholds] | "Air from high above the ranges is being dragged down this side. It heats up as it sinks (about 1 °C per 100 m) and was already dry, so humidity can crash to single figures within hours." |
| 13 | **Mountain waves: sudden strong gusts in the lee (often at night)** | Fr_h ≈ 0.6–1.2 and/or Scorer parameter decreasing with height, **or** nocturnal surface inversion + reasonably strong cross-ridge wind + gentle upwind slope and steeper lee slope (Margaret River recipe); most likely at night [L/H; recipe verified: Kepert et al. 2016] | "Air flowing over the range is bouncing like water over a rock. On this side it can come crashing down the slope as strong, gusty wind, even at night when you'd expect calm. This happened at the Aberfeldy fire in Victoria in 2013. At the State Mine fire in the Blue Mountains, a band of strong wind came down to the fire in the same way." |
| 14 | **Wind change: this flank will become the head fire** | Wind change forecast or set within scenario; new direction rotates > 45° | "When the wind swings to the south-west, this whole flank, about X km long, turns into the front of the fire. A wide front moves fast and is hard to stop. Plan now for where it will run." |
| 15 | **Southerly buster** | Coastal or escarpment domain; buster forecast | "A shallow wall of cold air is racing up the coast. Winds can swing to the south and gust over 50 km/h within minutes. Fires on the coast side will turn north. Tableland fires may not feel it." |
| 16 | **The fire is making its own weather** | Byram Nc > 10 [V] | "The fire's heat is now stronger than the wind. The smoke goes straight up, and winds near the fire are pulled *toward* it from all sides and can change quickly. Normal wind-based predictions become unreliable." |
| 17 | **Thunderstorm from the fire possible (pyroCb)** | C-Haines ≥ 10 with FFDI ≥ 50 (strict) or C-Haines ≥ 8 with FFDI ≥ 25 (watch) (verified: Di Virgilio et al. 2019); or CH above local 95th percentile ≈ 7–10; and simulated firepower > PFT [form verified; constant UNVERIFIED]; or VLS active on a large front | "The air above is unstable and dry. A big enough fire can build its own thunderstorm: violent gusts, downdrafts, lightning and embers carried many kilometres. Watch the smoke column for a white cap forming." |
| 18 | **Sudden drying expected** | Forecast dew point drop ≥ 5 °C within 3 h and mixed layer > 2.5 km [H]; or dry slot in forecast | "Very dry air from higher up is being mixed down to the ground. Humidity can fall sharply within an hour, and fire activity jumps." |
| 19 | **Smoke trapped in the valley** | Night or morning inversion; valley cell below inversion top | "Cold air under a warm lid is trapping smoke here. The fire looks quiet, but it hasn't gone out. It will pick up once the sun breaks the lid." |
| 20 | **Embers landing far ahead** | Spotting model: spot > 500 m ahead; steep terrain + strong wind (verified drivers: Storey et al. 2020, source fire area is the top predictor, then strong wind, dense forest, steep slope) | "Embers are landing well ahead of the front. In south-east Australia most spot fires land within 5 km, but some go more than 10 km, especially from big fires in steep, forested country with strong winds. On Black Saturday spot fires started up to 33 km ahead." |
| 21 | **Cloud on the far side, clear skies here: foehn sign** | Site on lee side of GDR; forecast W–NW cross-range flow; user reports or satellite shows cloud banked on the windward (western) ranges and clear sky in the lee (cue verified: Sharples & Ma 2026) | "See the cloud piled up on the other side of the range while it's clear here? The moisture is being left behind over there, and the air coming down this side is dry and warming as it sinks. Expect lower humidity and more active fire than the forecast for the lowlands suggests." |
| 22 | **High country drying tonight** | Night; elevated cells (e.g. > 1,000 m) where column dew point aloft is much lower than the lowland dew point, and a stable layer is absent or eroding under cross-range flow [H; phenomenon verified: Sharples, Mills & McRae 2012; Badlan et al. 2012] | "On these high ridges dry air from aloft is reaching the ground. Humidity up here can be far lower than in the valleys, even at night, so the fuel keeps drying when you'd expect it to recover." |
| 23 | **Wet ground: slow wake-up** | Rain in previous 24 h or dew/wet valley floor; valley inversion diagnosed at dawn [verified qualitatively: Whiteman 1982, "unless… the ground is wet"] | "The valley floor is wet, so the sun's energy is going into drying it out instead of heating the air. The cold layer will take longer to break this morning. The fire may stay quiet longer, then pick up quickly once it does break." |
| 24 | **Southerly buster: arrival estimate** | Coastal/escarpment domain; buster observed at a station to the south at time t₀ and distance d | "The southerly change is moving up the coast at roughly 35–45 km/h (about 530 km from Cape Howe to Newcastle in 12–15 hours). At that speed it will reach here around [t₀ + d/40 km/h]. Get ready for the wind to swing south and for the fire's northern flank to become the head fire." (speed verified: BoM; arrival formula [D]) |

Card logic rules:
- Show at most 2–3 cards at a time, ranked by "danger × novelty".
- Always attach the numbers that triggered the card: slope, aspect offset, wind speed, time since sunrise.
- Offer a "show me" camera fly-to on the 3-D terrain.

---

## 6. Open questions and uncertainties

1. **VLS threshold interdependence.** The exact joint wind–slope–aspect thresholds from Simpson et al. (2016) and Sharples et al. (2013) could not be read in full in this session. The smooth score in §4.5 is a placeholder calibrated to the published "~20–25°, 30–40°, ~20 km/h" summary.
   - *Partly resolved in the fact-check*: the coupled-model wind threshold is about 5 m/s; Canberra gave σ ≈ 25°, δ ≈ 40° (Sharples et al. 2015). The slope–wind trade-off curve is still unknown.
2. **DEM resolution vs slope thresholds.** Slope magnitude depends on the DEM grid: 5 m LiDAR shows much steeper slopes than a 30 m SRTM-derived DEM, which is steeper again than 100–250 m smoothing. The DEM resolution used to derive the Canberra thresholds needs to be confirmed from Sharples et al. (2012) before calibrating S_slope.
   - *Fact-check*: the same terrain filter used σ = 10.5° in Sharples & Hilton (2020) versus σ ≈ 25° for Canberra. That confirms strong resolution dependence, but the DEM spacing behind each value is still UNVERIFIED.
3. **Wind-speed reference height** for VLS (10 m open, ridge-top, or model level) is ambiguous in secondary summaries. Confirm it from the original papers. The WRF studies use a "reference" or background wind at an unspecified height (UNVERIFIED).
4. **Taylor–Lee and Jackson–Hunt coefficients** (B, A and the ln vs ln² form) should be checked against the original papers. They are known to overpredict on steep, forested NSW terrain. The fact-check could not access Taylor & Lee (1984). The A values are consistent with ASCE 7.
5. **Thermal-belt height and inversion depth for NSW valleys**: no local climatology was found. Consider NSW RFS/BoM AWS pairs (valley vs ridge) or a literature search for Australian cold-pool studies.
6. **Foehn statistics** (frequency, typical ΔT/ΔRH, affected districts) from Sharples et al. (2010) were not extracted.
7. **C-Haines at high elevation** (Snowy Mountains): no validated alternative was found.
8. **PFT inputs** (z_fc, Δθ_fc) need a sounding algorithm (Tory & Kepert 2021). The convective fraction of fire heat release is uncertain.
9. **Mountain waves** cannot be predicted reliably by our diagnostic model. We can only flag favourable conditions.
10. **Synoptic-thermal blending threshold** (§2.3) is an engineering choice, not a published value.
11. **C-Haines constants.** The structure and caps are confirmed, but the exact numbers (−2, 1/3, −1, 30, 5 + (CB − 5)/2) were not re-read from CAWCR CTR_020 because the PDF host was blocked. Unit-test against a published worked example before release.
12. **PFT leading constant 0.3.** Unconfirmed. Prefer implementing the full Tory & Kepert expression, with p_fc and θ_fc, over the 0.3 shortcut.
13. **Mountain-wave NSW climatology.** Only case studies exist (State Mine; plus Aberfeldy in Victoria and Margaret River in WA). There are no frequency statistics for the Blue Mountains or the south-coast escarpment.
14. **AS/NZS 1170.2 (2021)** hill-shape provisions (L1, L2, the 0.45 separation switch, 0.71) were quoted from the 2011 edition. Check them against the current edition.
15. **Nocturnal high-country drying** (Sharples, Mills & McRae 2012): the event magnitudes (ΔT_d, RH) and station list were not extracted. They are needed to calibrate card 22.
16. **Slope-wind magnitudes** are US handbook values (NWCG). No Australian eucalypt-forest measurements of anabatic/katabatic speeds were found. Tall open forest canopies may shelter or decouple the near-surface flow.

---

## 7. References

- Ayat, H., Lane, T.P., Wales, S., Reeder, M.J., Huang, Y. (2025) Rapid surface drying during the Black Summer bushfires in Australia: insights from high-resolution simulations. *J. Geophys. Res. Atmos.* 130(6):e2024JD041706. https://doi.org/10.1029/2024JD041706 (verified)
- Badlan, R.L., Lane, T.P., Mills, G.A., Caine, S. (2012) Mesoscale modelling of two 'drying events': governing processes and implications for fire danger. *Aust. Meteorol. Oceanogr. J.* 62:143–156. https://connectsci.au/es/article/62/3/143/264524 (verified)
- Balch, J.K. et al. (2022) Warming weakens the night-time barrier to global fire. *Nature* 602:442–448. https://www.nature.com/articles/s41586-021-04325-1
- Bolton, D. (1980) The computation of equivalent potential temperature. *Mon. Wea. Rev.* 108:1046–1053.
- Bureau of Meteorology. Fire Weather Knowledge Centre: How weather affects fires. https://www.bom.gov.au/resources/learn-and-explore/fire-weather-knowledge-centre/how-weather-affects-fires
- Bureau of Meteorology (2018) The big bust: southerly busters explained. https://media.bom.gov.au/social/blog/18/the-big-bustsoutherly-busters-explained/
- Bureau of Meteorology. Research: how mountain waves can escalate bushfires. https://media.bom.gov.au/social/blog/1311/research-how-mountain-waves-can-escalate-bushfires/
- Bushfire & Natural Hazards CRC (2017) Mountain waves and extreme fire behaviour. https://www.bnhcrc.com.au/news/2017/mountain-waves-and-extreme-fire-behaviour (verified; covers the State Mine, Aberfeldy and Margaret River cases)
- Butler, B.W. et al. (2015) High-resolution observations of the near-surface wind field over an isolated mountain and in a steep river canyon. *Atmos. Chem. Phys.* 15:3785–3801. https://acp.copernicus.org/articles/15/3785/2015/
- Byram, G.M. (1959) Combustion of forest fuels. In Davis, K.P. (ed.) *Forest Fire: Control and Use*. McGraw-Hill.
- Colquhoun, J.R., Shepherd, D.J., Coulman, C.E., Smith, R.K., McInnes, K. (1985) The southerly burster of south eastern Australia: an orographically forced cold front. *Mon. Wea. Rev.* 113:2090–2107.
- Cruz, M.G. et al. (2012) Anatomy of a catastrophic wildfire: the Black Saturday Kilmore East fire in Victoria, Australia. *For. Ecol. Manage.* 284:269–285. https://www.sciencedirect.com/science/article/abs/pii/S0378112712001223
- Di Virgilio, G. et al. (2019) Climate change increases the potential for extreme wildfires. *Geophys. Res. Lett.* 46:8517–8526. https://doi.org/10.1029/2019GL083699 (verified; pyroCb thresholds CH ≥ 8 & FFDI ≥ 25; CH ≥ 10 & FFDI ≥ 50; end page UNVERIFIED)
- Dold, J.W., Zinoviev, A. (2009) Fire eruption through intensity and spread rate interaction mediated by flow attachment. *Combust. Theory Model.* 13:763–793.
- Dowdy, A.J., Pepler, A. (2018) Pyroconvection risk in Australia: climatological changes in atmospheric stability and surface fire weather conditions. *Geophys. Res. Lett.* https://doi.org/10.1002/2017GL076654
- Dowdy, A.J., Fromm, M.D., McCarthy, N. (2017) Pyrocumulonimbus lightning and fire ignition on Black Saturday in southeast Australia. *J. Geophys. Res. Atmos.* 122:7342–7354. https://doi.org/10.1002/2017JD026577
- Durran, D.R. (1990) Mountain waves and downslope winds. *Meteorol. Monogr.* 23(45):59–81. AMS.
- EUMeTrain. Physical background of lee waves. https://resources.eumetrain.org/data/4/452/print_4.htm
- Forthofer, J.M., Shannon, K., Butler, B.W. (2009) Simulating diurnally driven slope winds with WindNinja. AMS conference paper 4.4 (venue/year details UNVERIFIED). https://www.fs.usda.gov/rm/pubs_journals/2009/rmrs_2009_forthofer_j001.pdf (verified: title, authors, model inputs)
- Forthofer, J.M., Butler, B.W., Wagenbrenner, N.S. (2014) A comparison of three approaches for simulating fine-scale surface winds in support of wildland fire management. Part I. *Int. J. Wildland Fire* 23:969–981. [L]
- Fromm, M. et al. (2006) Violent pyro-convective storm devastates Australia's capital and pollutes the stratosphere. *Geophys. Res. Lett.* 33:L05815. https://doi.org/10.1029/2005GL025161
- Haines, D.A. (1988) A lower atmosphere severity index for wildland fires. *Natl. Wea. Dig.* 13:23–27.
- Hilton, J.E., Sullivan, A.L., Swedosh, W., Sharples, J., Thomas, C. (2018) Incorporating convective feedback in wildfire simulations using pyrogenic potential. *Environ. Model. Softw.* 107:12–24. https://www.sciencedirect.com/science/article/abs/pii/S1364815217309593
- Hilton, J.E., Garg, N., Sharples, J.J. (2019) Incorporating firebrands and spot fires into vorticity-driven wildfire behaviour models. MODSIM2019, pp. 761–767. https://doi.org/10.36334/modsim.2019.H7.hilton2 ; PDF: https://mssanz.org.au/modsim2019/H7/hilton2.pdf (verified)
- Hilton, J.E., Garg, N. (2021) Rapid wind–terrain correction for wildfire simulations. *Int. J. Wildland Fire* 30:410–427. https://www.publish.csiro.au/wf/WF20062
- Iqbal, M. (1983) *An Introduction to Solar Radiation*. Academic Press.
- Jackson, P.S., Hunt, J.C.R. (1975) Turbulent wind flow over a low hill. *Q. J. R. Meteorol. Soc.* 101:929–955. https://doi.org/10.1002/qj.49710143015
- Kepert, J., Tory, K., Thurston, W., Ching, S., Fawcett, R., Yeo, C. (2016) Fire escalation by downslope winds. BNHCRC *Hazard Note* 24. https://www.bnhcrc.com.au/hazardnotes/24 (verified citation)
- Kochanski, A.K., Mallia, D.V., Fearon, M.G., Mandel, J., Souri, A.H., Brown, T.J. (2019) Modeling wildfire smoke feedback mechanisms using a coupled fire-atmosphere model with a radiatively active aerosol scheme. *J. Geophys. Res. Atmos.* 124(16):9099–9116. https://doi.org/10.1029/2019JD030558 (verified)
- Lin, Y.-L., Wang, T.-A. (1996) Flow regimes and transient dynamics of two-dimensional stratified flow over an isolated mountain ridge. *J. Atmos. Sci.* 53:139–158. (UNVERIFIED: citation details from memory; the Fr 0.6–1.12 windstorm range comes from a search extract of a later study)
- McRae, R.H.D., Sharples, J.J., Wilkes, S.R., Walker, A. (2013) An Australian pyro-tornadogenesis event. *Nat. Hazards* 65:1801–1811. https://doi.org/10.1007/s11069-012-0443-7
- McRae, R.H.D., Sharples, J.J., Fromm, M. (2015) Linking local wildfire dynamics to pyroCb development. *Nat. Hazards Earth Syst. Sci.* 15:417–428. https://nhess.copernicus.org/articles/15/417/2015/
- McRae, R.H.D. (2023) Operational prediction of extreme bushfires. *Aust. J. Emerg. Manage.* (October 2023). https://knowledge.aidr.org.au/resources/ajem-october-2023-operational-prediction-of-extreme-bushfires/ ; UNSW summary: https://www.unsw.edu.au/news/2023/10/world-first-warning-system-can-help-predict-extreme-bushfires
- Mills, G.A. (2005) On the sub-synoptic scale meteorology of two extreme fire weather days during the eastern Australian fires of January 2003. *Aust. Meteorol. Mag.* 54:265–290.
- Mills, G.A. (2008a, b) Abrupt surface drying and fire weather. Part 1: overview and case study of the South Australian fires of 11 January 2005; Part 2: a preliminary synoptic climatology in the forested areas of southern Australia. *Aust. Meteorol. Mag.* 57:299–309; 57:311–328. (verified)
- Mills, G.A., McCaw, W.L. (2010) Atmospheric stability environments and fire weather in Australia – extending the Haines Index. CAWCR Technical Report No. 20. https://www.cawcr.gov.au/technical-reports/CTR_020.pdf
- Morvan, D., Frangieh, N. (2018) Wildland fires behaviour: wind effect versus Byram's convective number and consequences upon the regime of propagation. *Int. J. Wildland Fire* 27:636–641.
- Nelson, R.M. Jr (1993) Byram's derivation of the energy criterion for forest and wildland fires. *Int. J. Wildland Fire* 3:131–138. See also USDA FS Res. Note INT-415: https://archive.org/stream/byramsenergycrit415nels/byramsenergycrit415nels_djvu.txt
- NWCG. Fire Behavior Field Reference Guide PMS 437: Estimating winds for fire behavior. https://www.nwcg.gov/publications/pms437/weather/estimating-winds-for-fire-behavior
- NWCG. Glossary: thermal belt. https://www.nwcg.gov/publications/pms205/nwcg-glossary-of-wildland-fire-pms-205/thermal-belt-5
- Peterson, D.A. et al. (2021) Australia's Black Summer pyrocumulonimbus super outbreak reveals potential for increasingly extreme stratospheric smoke events. *npj Clim. Atmos. Sci.* 4:38. https://www.nature.com/articles/s41612-021-00192-9
- Prandtl, L. (1942) *Führer durch die Strömungslehre*. Vieweg.
- Schroeder, M.J., Buck, C.C. (1970) *Fire Weather*. USDA Agriculture Handbook 360 (NWCG PMS 425-1). https://www.nwcg.gov/publications/pms425-1/7-convective-winds
- Scorer, R.S. (1949) Theory of waves in the lee of mountains. *Q. J. R. Meteorol. Soc.* 75:41–56.
- Sharples, J.J. (2009) An overview of mountain meteorological effects relevant to fire behaviour and bushfire risk. *Int. J. Wildland Fire* 18:737–754. https://doi.org/10.1071/WF08041 (DOI verified) ; https://publish.csiro.au/wf/wf08041
- Sharples, J.J., Mills, G.A., McRae, R.H.D., Weber, R.O. (2010) Foehn-like winds and elevated fire danger conditions in southeastern Australia. *J. Appl. Meteorol. Climatol.* 49:1067–1095. https://doi.org/10.1175/2010JAMC2219.1
- Sharples, J.J., McRae, R.H.D., Weber, R.O. (2010) Wind characteristics over complex terrain with implications for bushfire risk management. *Environ. Model. Softw.* 25:1099–1120. https://doi.org/10.1016/j.envsoft.2010.03.016
- Sharples, J.J. et al. (2011) Lateral bushfire propagation driven by the interaction of wind, terrain and fire. MODSIM2011. https://mssanz.org.au/modsim2011/A2/sharples.pdf
- Sharples, J.J., McRae, R.H.D., Wilkes, S.R. (2012) Wind–terrain effects on the propagation of wildfires in rugged terrain: fire channelling. *Int. J. Wildland Fire* 21:282–296. https://www.publish.csiro.au/wf/WF10055
- Sharples, J.J., Simpson, C.C., Evans, J.P. (2013) Examination of wind speed thresholds for vorticity-driven lateral fire spread. MODSIM2013, 263–269. https://www.mssanz.org.au/modsim2013/A3/sharples3.pdf (verified: no VLS at 2.5 m/s; 0.4–5 km/h oscillating lateral ROS, about 10–15 min period)
- Sharples, J.J. et al. (2015) Threshold behaviour in dynamic fire propagation. BNHCRC Report No. 2015.018. https://www.naturalhazards.com.au/crc-collection/downloads/sharples.pdf (verified: VLS wind threshold ≈ 5 m/s; σ ≈ 25°, δ ≈ 40° for Canberra 2003)
- Sharples, J.J., Mills, G.A., McRae, R.H.D. (2012) Extreme drying events in the Australian high-country and their implications for bushfire risk management. *Aust. Meteorol. Oceanogr. J.* 62:157–169 (end page UNVERIFIED). http://www.bom.gov.au/jshess/docs/2012/sharples.pdf ; doi:10.22499/2.6203.004
- Sharples, J.J., Kiss, A.E. et al. (2015) Pyrogenic vorticity from windward and lee slope fires. MODSIM2015. https://www.mssanz.org.au/modsim2015/A4/sharples.pdf
- Sharples, J.J. et al. (2016) Natural hazards in Australia: extreme bushfire. *Climatic Change* 139:85–99. https://doi.org/10.1007/s10584-016-1811-1
- Sharples, J.J., Hilton, J.E. (2020) Modeling vorticity-driven wildfire behavior using near-field techniques. *Front. Mech. Eng.* 5:69. https://doi.org/10.3389/fmech.2019.00069
- Sharples, J.J., Ma, W. (2026) Ask an Expert: How foehn winds exacerbate dangerous bushfires. UNSW. https://www.unsw.edu.au/news/2026/01/ask-an-expert--how-foehn-winds-exacerbate-dangerous-bushfires
- Simpson, C.C., Sharples, J.J., Evans, J.P., McCabe, M.F. (2013) Large eddy simulation of atypical wildland fire spread on leeward slopes. *Int. J. Wildland Fire* 22:599–614. https://www.publish.csiro.au/wf/wf12072
- Simpson, C.C., Sharples, J.J., Evans, J.P. (2014) Resolving vorticity-driven lateral fire spread using the WRF-Fire coupled atmosphere–fire numerical model. *Nat. Hazards Earth Syst. Sci.* 14:2359–2371. https://nhess.copernicus.org/articles/14/2359/2014/
- Simpson, C.C., Sharples, J.J., Evans, J.P. (2016) Sensitivity of atypical lateral fire spread to wind and slope. *Geophys. Res. Lett.* 43:1744–1751. https://doi.org/10.1002/2015GL067343 (verified)
- Standards Australia (2021) AS/NZS 1170.2 Structural design actions – Wind actions (topographic multiplier M_h).
- Steinacker, R. (1984) Area-height distribution of a valley and its relation to the valley wind. *Contrib. Atmos. Phys.* 57:64–71. [L]
- Storey, M.A., Price, O.F., Sharples, J.J., Bradstock, R.A. (2020) Drivers of long-distance spotting during wildfires in south-eastern Australia. *Int. J. Wildland Fire* 29:459–472. https://doi.org/10.1071/WF19124
- Storey, M.A. et al. (2020) Analysis of variation in distance, number, and distribution of spotting in southeast Australian wildfires. *Fire* 3(2):10. https://doi.org/10.3390/fire3020010
- Stull, R.B. (1988) *An Introduction to Boundary Layer Meteorology*. Kluwer. Also Stull, *Practical Meteorology*, ch. 17 (Mountain waves): https://geo.libretexts.org/Bookshelves/Meteorology_and_Climate_Science/Practical_Meteorology_(Stull)/17:_Regional_Winds/17.7:_Mountain_Waves
- Taylor, P.A., Lee, R.J. (1984) Simple guidelines for estimating wind speed variations due to small-scale topographic features. *Climatol. Bull.* 18(2):3–32.
- Taylor, P.A., Teunissen, H.W. (1987) The Askervein Hill project: overview and background data. *Boundary-Layer Meteorol.* 39:15–39. https://link.springer.com/article/10.1007/BF00121863
- Tennekes, H. (1973) A model for the dynamics of the inversion above a convective boundary layer. *J. Atmos. Sci.* 30:558–567.
- Tory, K.J., Kepert, J.D. (2021) Pyrocumulonimbus Firepower Threshold: assessing the atmospheric potential for pyroCb. *Weather Forecast.* 36:439–456. https://journals.ametsoc.org/view/journals/wefo/36/2/WAF-D-20-0027.1.xml
- Viegas, D.X., Simeoni, A. (2011) Eruptive behaviour of forest fires. *Fire Technol.* 47:303–320.
- Wagenbrenner, N.S. et al. (2016) Downscaling surface wind predictions from numerical weather prediction models in complex terrain with WindNinja. *Atmos. Chem. Phys.* 16:5229–5241. https://acp.copernicus.org/articles/16/5229/2016/
- Whiteman, C.D. (1982) Breakup of temperature inversions in deep mountain valleys: Part I. Observations. *J. Appl. Meteorol.* 21:270–289. https://journals.ametsoc.org/view/journals/apme/21/3/1520-0450_1982_021_0270_botiid_2_0_co_2.xml
- Whiteman, C.D., McKee, T.B. (1982) Breakup of temperature inversions in deep mountain valleys: Part II. Thermodynamic model. *J. Appl. Meteorol.* 21:290–302.
- Whiteman, C.D., Doran, J.C. (1993) The relationship between overlying synoptic-scale flows and winds within a valley. *J. Appl. Meteorol.* 32:1669–1682. https://journals.ametsoc.org/view/journals/apme/32/11/1520-0450_1993_032_1669_trboss_2_0_co_2.xml
- Whiteman, C.D. (2000) *Mountain Meteorology: Fundamentals and Applications*. Oxford University Press.
- Whiteman, C.D. et al. (2004) Minimum temperatures, diurnal temperature ranges, and temperature inversions in limestone sinkholes of different sizes and shapes. *J. Appl. Meteorol.* 43:1224–1236. http://www.met.sjsu.edu/~clements/papers/whitemanetal2004.pdf
- Webb, C., Park, J. (2023) Channelling flows in the Hunter Valley. *J. South. Hemisph. Earth Syst. Sci.* 73:194–211. https://www.publish.csiro.au/es/fulltext/ES22021 (verified)
- Wilke, D.J., Kepert, J.D., Tory, K.J. (2022) The meteorology of the Tathra bushfire. *Weather Forecast.* 37(5):581–600. https://journals.ametsoc.org/view/journals/wefo/37/5/WAF-D-21-0084.1.xml (verified)
- Wilson, C.S., Sharples, J.J., Evans, J.P. (2025) Atmospheric profiles associated with pyrocumulonimbus in southeast Australia. *Sci. Rep.* 15:38538. https://www.nature.com/articles/s41598-025-22530-0 (verified)
- Wood, N. (1995) The onset of separation in neutral, turbulent flow over hills. *Boundary-Layer Meteorol.* 76:137–164. https://link.springer.com/article/10.1007/BF00710894 (verified)
- [Authors not confirmed here] (2026) Observations of vorticity-driven lateral spread in a wildfire. *Fire* 9(2):79. https://www.mdpi.com/2571-6255/9/2/79 (verified: Airport Fire 2024, lateral ROS mean 1.9 km/h, about 4 km/h near plume touch-down, peaks of 20 km/h)
- Ross, A.N., Vosper, S.B. (2005) Neutral turbulent flow over forested hills. *Q. J. R. Meteorol. Soc.* 131:1841–1862. https://doi.org/10.1256/qj.04.129 (verified)
- Stull, R. *Practical Meteorology*, §17.4 open-channel hydraulics and §17.7 mountain waves (width-based Froude number). https://geo.libretexts.org/Bookshelves/Meteorology_and_Climate_Science/Practical_Meteorology_(Stull)/17:_Regional_Winds/17.7:_Mountain_Waves (verified)
- Zardi, D., Whiteman, C.D. (2013) Diurnal mountain wind systems. In Chow, De Wekker, Snyder (eds) *Mountain Weather Research and Forecasting*. Springer, 35–119. https://link.springer.com/chapter/10.1007/978-94-007-4098-3_2
