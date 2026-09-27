# 06 — Embers, firebrands and spotting: physics and a Lagrangian ember model

Scope: firebrand types in NSW eucalypt forests; how they are generated, lofted, carried, burn out and ignite
new fires; how spot fires grow and merge; how mountain terrain changes all of this; and a cheap but
physically honest parameterisation for `src/embers/` (a Lagrangian particle model in the coupled 3-D wind
field, running in a Web Worker on a phone).

> **Provenance legend (read first).** This review was written with severe tool limits. Every full-text
> fetch (CSIRO Publishing, MDPI, frames.gov, fs.usda.gov, arXiv, OSTI, Semantic Scholar, UOW, Wikipedia)
> was blocked by the network egress proxy, and the shared web-search budget ran out after seven
> searches. Every claim is therefore tagged:
>
> * **[V]** verified in this session from the source's own abstract or index record, via search extract.
> * **[S01]/[S02]** reported with a source in sibling FireSim reviews `01-terrain-fire-behaviour.md` or
>   `02-mountain-meteorology.md`. I did not re-verify these.
> * **[P]** primary literature recalled from prior reading. I believe the citation is correct, but I did
>   **not** re-check the exact number or wording this session. **Check it against the original before
>   hard-coding it.**
> * **[D]** derived in this document from stated physics. The working is shown.
> * **[A]** a FireSim engineering assumption or default, not a literature value. It must be exposed as a
>   tunable parameter.
>
> I have not invented any number. Where a value is unknown I say so. Section 6 lists what must be read
> from the originals before release.

> **Adversarial fact-check pass (2026-09-27).** A second reviewer tried to refute every equation, constant
> and threshold. Web search was exhausted and WebFetch was blocked for every publisher domain tried
> (CSIRO Publishing, Crossref, OpenAlex, archive.org, nature.com), so the checks were made against
> **independent machine-readable transcriptions**. Each check is tagged inline as
> **(verified: …)** or **(UNVERIFIED — reason)**. The sources used were:
> * the USFS Missoula Fire Lab **BehavePlus `behave` C++ library** (`ignite.cpp`, `spot.cpp`,
>   `CrownFirebrandProcessor.cpp`);
> * the **FARSITE** spotting source (`fsxwspot.cpp`, an Albini 1979 implementation);
> * **ELMFIRE** (`elmfire_spotting.f90`) for the Sardoy lognormal constants;
> * the Canadian **cffdrs** R package for FBP acceleration;
> * the **AFDRS Research Prototype** (Matthews et al. 2019) and the **AFDRS Fire Behaviour Index Technical
>   Guide** (v1.0, 2022), both read as full text;
> * the NSW RFS-derived **PyroXL** VBA and **FireBehaviourCalcsR** code;
> * the EarthSciML Sofiev (2012) implementation;
> * the **WRF-Fire firebrand-spotting module** (NCAR);
> * the full text of the Manzello et al. (2020) review.
>
> A code match confirms the transcription of a formula. It does not confirm that the primary paper's
> fit is right. **Main corrections**:
> 1. The Albini-law bark lifetime was 2× too short. The mis-statement "wood law gives 2–7× too short"
>    is corrected to "Albini matches Hall's simple cylinders and under-predicts convoluted strips about 3×".
> 2. Added the verified AFDRS/Vesta maximum-spotting-distance equation. It was previously listed as
>    "not retrievable".
> 3. Added the verified Albini/BehavePlus flat-terrain and mountain-terrain spotting equations.
> 4. The State Mine fire "firebrand transport" quote belongs to the **Aberfeldy** fire (Vic, 2013), as doc
>    02 already corrected.
> 5. Kilmore East 33 km spotting is now verified. So are the ≈ 1000 kW/m ember-production onset and the
>    AFDRS bark-FHS ≥ 3 long-range flag.
> 6. The Manzello et al. glowing-brand result was mis-stated (see §2.7).
> 7. Minor numeric fixes: a Schroeder table cell, the Briggs night-inversion case, and the cost range.

---

## 1. Executive summary: what matters most for FireSim

1. **In eucalypt forest, spotting is a primary spread mechanism.** It is how a fire crosses gorges,
   rivers, roads, containment lines and the slow downslope and valley-bottom phases in mountain
   country. The spotting chain has three stages: firebrand *generation*, *transport* and *ignition*
   of the receiving fuel (Koo et al. 2010) [V]. FireSim adds two more: *spot-fire growth* and
   *coalescence*.
2. **Bark is the ember factory, and bark type sets the range.**
   * Stringybark (for example messmate, *E. obliqua*) sheds large numbers of loose fibrous flakes.
     They burn in flight, often with internal smouldering, and sometimes re-flame. This fits the
     species' reputation for intense spotting at distances of several kilometres (Ellis 2013) [V].
   * Ribbon/candle bark (for example ribbon gum, *E. viminalis*) forms curled hollow strips. They fall
     at about 5.2–5.8 m/s. The most convoluted strips have a mean burnout time of 429 s, and the
     longest times are commensurate with spotting beyond 20 km in a 60 km/h transport wind (Hall et
     al. 2015) [V]. Few embers, very long range.
3. **Fuel age matters through bark hazard.** In Project Vesta, firebrand density and spotting distance
   increased with time since fire. Reducing the bark hazard score from 3 to 2 by prescribed burning cut
   firebrand density about threefold (Gould et al. 2007) [V]. The fire-history layer must therefore
   drive bark hazard, and bark hazard must drive ember generation.
4. **Maximum spotting distance is set by a race between flight time and burnout time.** In steady wind,
   an ember falling at terminal velocity v_t from height z travels X ≈ Ū·z/v_t, where Ū is the mean
   wind over the fall. It stays alive only for a burnout time τ_b, so X_max ≈ Ū·τ_b, and only if the
   plume can loft it to z* ≈ v_t·τ_b [D].
   * For a ribbon-bark strip (v_t ≈ 5.8 m/s, τ_b ≈ 1200 s) that means lofting to about 7 km and
     travelling about 20 km [D]. This is consistent with Hall et al. [V]. The 1200 s is a *derived
     tail* value: 20 km ÷ 16.7 m/s. It is not a measured mean.
   * **Operational cross-check (verified: AFDRS FBI Technical Guide 2022 eq. 3.51; PyroXL and
     FireBehaviourCalcsR code).** AFDRS computes a forest "maximum spotting distance" from ROS, U10
     and surface fuel hazard score, using a fit to the Vesta spotting model (§3.6, eq. 18a). It gives
     about 1.6 km at ROS 1000 m/h and about 3.5 km at 2000 m/h (U10 = 40 km/h, FHS_s = 3.5).
     Black Saturday's Kilmore East fire spotted up to **33 km** (verified: Matthews et al. 2019
     AFDRS Research Prototype §9.3, citing Cruz et al. 2012).
   * Long-range spotting therefore needs **both** a deep, strong convection column (very intense fire,
     unstable air, pyroCu/pyroCb) **and** strong winds aloft.
5. **The plume, not the surface wind, does the lofting.**
   * The line-fire buoyancy flux F_L = gI/(ρc_pT) sets the plume's velocity scale, w ~ F_L^{1/3} [P].
   * Byram's convective number N_c = 2F_L/(U−R)³ [P] separates two regimes:
     * *plume-dominated* fires (N_c > 10): embers go high but fall around the fire, including onto the
       flanks;
     * *wind-driven* fires (N_c < 2): embers are carried low and far in a narrow downwind cone
       (thresholds from Morvan & Frangieh 2018) [P]. (Verified in doc 02 §2.6 "as commonly cited":
       the < 2 / > 10 bands. UNVERIFIED against the paper's own text: the bands come from idealised
       grassland CFD, not eucalypt forest.)
   * Winds aloft often differ in direction from surface winds, so spot fires can land off the
     surface-wind axis [D].
6. **Landing is not ignition. Fuel moisture decides.**
   * Ellis (2015) tested dry-eucalypt litter at 4–21 % moisture content and 0–2 m/s air speed [V]:
     * *flaming* firebrands: ignition probability depended on litter moisture and on whether there was
       any wind;
     * *glowing* firebrands: ignition probability depended on moisture and on wind speed.
   * At night, in gullies and on shaded south-east slopes, embers still land but mostly fail.
   * On dry, sunlit north-west slopes and in thermal belts they succeed.
7. **Distributions are heavy-tailed and often multimodal.**
   * Storey et al. (2020) analysed 251 wildfires in more than 8000 line-scan images from south-east
     Australia (2002–2018) [V]:
     * spotting distance and spot-fire number were fairly well correlated;
     * some fires produced few spots but very long ones;
     * long-distance spotting was mostly associated with multi-modal distributions;
     * so exponential-shaped spotting kernels could *underestimate* long-distance spotting [V].
   * A Lagrangian model with a resolved plume can produce these tails naturally. A fixed kernel cannot.
8. **Mountains amplify spotting in specific, teachable ways:**
   * ridge-top release height ("height advantage");
   * lee-slope separation eddies that trap embers and drive spot fires back *upslope*;
   * vorticity-driven lateral spread (VLS, "fire channelling"), which casts dense embers downwind and
     makes "deep flaming" (Sharples et al. 2012 [P]; Hilton, Garg & Sharples 2019 [S02]);
   * a steep slope inside the source fire, which raises maximum spotting distance and the chance of
     spots beyond 500 m (Storey et al. 2020, IJWF) [S01];
   * embers from a fire below landing upslope and running uphill;
   * rolling debris starting fires *below* the main fire;
   * night inversions that cap the plume, and thermal belts that stay receptive.
9. **Mass spotting makes firestorm-like deep flaming.**
   * Many short-range spots coalesce into wide zones of simultaneous flaming.
   * Spot-to-front junctions accelerate strongly, especially on slopes [S01].
   * The combined heat strengthens the plume, which lofts more embers: a positive feedback that
     FireSim's coupled atmosphere can show.
10. **Recommended FireSim design:**
    * **Transport:** a stratified, weighted ("super-particle") Lagrangian model of five ember classes
      in the resolved 3-D wind. It adds a sub-grid near-source plume updraft, an Ornstein–Uhlenbeck
      turbulence model enhanced inside the plume, class-specific empirical burnout, and pressure-level
      winds above the model top. Burnout is *not* Albini's wood law: with its fall-speed coupling done
      correctly, that law matches Hall's simple cylinders (about 127 s against 122 s measured) but
      under-predicts flat plates about 2× and convoluted strips about 3× [D; law verified: FARSITE
      source].
    * **Emission:** near zero below about 1000 kW/m ("very little ember production and spot fire
      activity at less than 1,000 kW/m", Gould et al. 2007a; verified: quoted in Matthews et al. 2019
      AFDRS-RP readiness table). Long-range potential is flagged where bark FHS ≥ 3 (verified: AFDRS-RP
      §4.4.1).
    * **Landing:** a moisture-, state- and wind-dependent ignition probability, an exclusion zone just
      ahead of the front (short-range spotting is already inside Vesta ROS), an ignition delay, an
      acceleration ramp, and full *provenance* on every spot fire so the app can say *why* it
      happened.
    * **Cost:** about 4000 active super-particles cost about 4–9 s per 6 h scenario (§4.7), or up to
      about 15 s with worst-case overheads [D estimate]. (Corrected: an earlier line said 5–15 s,
      which did not match §4.7.)

---

## 2. Mechanisms, with emphasis on NSW mountain forests

### 2.1 The spotting chain

**Generation.** Bark, leaves, twigs, capsules and cones ignite in the flame zone. Pieces detach under
aerodynamic drag, from fibre failure as they burn, or when branches break.

**Lofting.**
* A piece rises only where the upward air speed exceeds its terminal velocity.
* In the near-fire plume, updrafts of 5–30 m/s are plausible for intense fires (scaling in §3.3) [D].
  This is enough to carry bark flakes and strips (v_t ≈ 3–6 m/s) hundreds to thousands of metres up.
* Albini's spotting models are built on exactly this criterion: the firebrand is lofted to the height
  where the plume velocity falls to its terminal velocity, then descends through the wind profile
  (Albini 1979, 1983) [P].

**Transport.**
* Once the plume stops carrying it, the ember falls at roughly v_t relative to the air.
* It moves with the local wind, including turbulence and any flow separation or valley channelling.
* It keeps burning, losing mass (so v_t falls) and passing from flaming to glowing.

**Burnout.**
* Flaming (volatile combustion) usually ends first. Glowing char oxidation continues.
* Fibrous stringybark can smoulder internally and re-flame (Ellis 2013) [V].
* Long-range embers therefore usually arrive *glowing*, and glowing embers are poorer igniters.

**Landing and ignition.**
* Receptive fuel is mainly the dead fine surface litter, cured grass, dead elevated fuel and bark
  crevices.
* Ignition depends on fuel moisture, the ember's state and mass, local wind at the fuel bed, fuel-bed
  bulk density and continuity (Ellis 2015 [V]; Ganteaume et al. 2009 [P]; Plucinski & Anderson 2008
  [P]; Manzello et al. 2006 [P]).

**Spot-fire growth.** A new spot starts as a point ignition. It accelerates over tens of minutes towards
a quasi-steady rate of spread (§3.9).

**Coalescence.** Neighbouring spots and the main front merge. Junctions accelerate, and deep flaming
zones form (Finney & McAllister 2011 [P]; Thomas et al. 2017 [P]; Storey et al. 2021 [S01]).

### 2.2 Firebrand types in NSW eucalypt landscapes

The species lists below are indicative. Assign defaults by NSW SVTM vegetation class and let users
override them.

| Class | Typical sources in NSW mountains | Physical form | Behaviour | Evidence |
|---|---|---|---|---|
| **E1 Stringybark flake / fibrous wad** | Messmate *E. obliqua* (tablelands, Barrington, New England); stringybarks (*E. eugenioides*, *E. macrorhyncha*, *E. globoidea*, *E. caliginosa*, *E. laevopinea*, *E. blaxlandii*); peppermints and boxes (smaller, sub-fibrous) | Loosely attached, weathered flakes. Wind-tunnel samples weighed 0.4–8.3 g | Very numerous. Burns in flight with internal combustion. Re-flaming seen during the glowing phase (18 samples). Short to medium range, several km at most | Ellis 2013 [V]; Ellis 2011 bark-fuelbed ignition [P] |
| **E2 Ribbon / candle bark strip** | Ribbon/manna gum *E. viminalis*, candlebark *E. rubida*, mountain gum *E. dalrympleana* (Snowy, Kanangra-Boyd, tablelands); Blue Mountains ash *E. oreades*; alpine ash *E. delegatensis* (upper-trunk ribbons). Snow gum *E. pauciflora* is mostly smooth-barked and sheds small strips, so treat it as minor (doc 05 rates it "Low") | Long curled strips: flat plates, simple cylinders, internally convoluted cylinders | v_t 5.4 / 5.2 / 5.8 m/s and mean burnout 251 / 122 / 429 s for the three forms. The longest burnouts imply more than 20 km at 60 km/h | Hall et al. 2015 [V] |
| **E3 Leaf** | Crown fire in any eucalypt; scorched crowns | Thin plate, about 0.3–0.5 mm thick | Low v_t, about 1.5–2 m/s by calculation [D]. Burns out fast. Short range, but huge numbers in crown fires | Physics only; no eucalypt leaf flight data retrieved |
| **E4 Twig / fine branch** | Elevated and near-surface shrubs, crown fine fuel | Cylinder, 3–10 mm | v_t about 4–7 m/s [D]. Lifetime about 1.5–3 min: Albini law τ ≈ 24·v_t0 s, eq. 7 corrected [D; law verified: FARSITE source]. Short to medium range | Tarifa et al. 1965 [P]; Manzello et al. 2007 [P]; Tohidi et al. 2015 [P] |
| **E5 Heavy / compact** | Gumnut capsules, *Banksia* and *Allocasuarina* cones, bark chunks, grass-tree spikes, logs | Compact, dense | High v_t, rarely lofted far. Long smouldering life. **Rolls downslope** on steep ground | Qualitative; rolling-debris heuristic in doc 01 §4.6 [S01] |

Bark type also controls *ease of bark ignition*. Ellis (2011) explained messmate's notoriety by the
high ignition potential of its bark as a fuel bed together with its morphology [P].

Smooth-barked gums (for example scribbly gums, *Angophora*, many "gums") and ironbarks produce few bark
firebrands. Their contribution is mostly leaves and twigs from crown involvement [A, consistent with the
bark-hazard scoring philosophy of Hines et al. 2010 [P]].

### 2.3 Generation: what controls how many embers

**Bark hazard and time since fire.**
* Project Vesta found that fuel characteristics and wind speed correlated with firebrand density and
  spotting distance, and that both increased with time since fire. A bark hazard reduction from score 3
  to score 2 reduced firebrand density about threefold [V].
* Bark hazard is scored 0–4 in the Vesta hazard-score system. The Victorian Overall Fuel Hazard Guide
  uses Low to Extreme bark hazard classes, with fibrous and ribbon barks at the top (Hines et al. 2010)
  [P].

**Fire intensity and flame height.**
* Bark on trunks is engaged only when flames reach it. Hanging ribbons in the crown are engaged by
  crown or near-crown flames.
* The production rate should scale with the rate at which bark and fine fuel are *consumed* per metre
  of front. That rate is proportional to Byram intensity I = H·w·R. The fraction that is *lofted*
  grows with plume strength, and the model handles that explicitly (§4.3) [A, physically motivated].
* No primary Australian source was found that gives firebrands per metre of front per second as a
  function of I. **This is the single largest quantitative gap** (§6).
* **Onset threshold (verified: Matthews et al. 2019, AFDRS Research Prototype readiness-level table,
  quoting Gould et al. 2007a).**
  * The 500–2000 kW/m band is "where ember production and spotting commences".
  * There is "very little ember production and spot fire activity at less than 1,000 kW/m".
  * The same report records that unsupported retardant drops in **stringybark** forest were
    ineffective at holding a fire above **2000 kW/m** "due to heavy spotting across the drop zone".
    With ground crews following up within an hour the limit was about 3000 kW/m (Loane & Gould 1986,
    J. Gould pers. comm. 2019, as quoted there).
  * This is a strong teaching point, and a calibration anchor for the emission onset in §4.2.
* **Operational long-range flag (verified: AFDRS-RP §4.4.1).** "Potential for long range spotting was
  recorded as a yes/no value based on bark FHS, where FHS ≥ 3 = 1 (yes) and FHS < 3 = 0 (no)".
  * The NSW RFS fuel table (via doc 03, [S03]) gives a bark-hazard rating and a spotting-distance class
    for each NSW vegetation class.
  * Mountain examples: Sydney montane DSF "Very High / Long"; Northern tableland DSF "Extreme / Long";
    Central gorge DSF "Extreme / Long"; Montane wet sclerophyll "Very High / Long"; Subalpine woodland
    "High / Long".
  * Bark load re-accumulates slowly: Olson k_b ≈ 0.1 yr⁻¹, about 30 years to 95 % (doc 05, [S05]).
    This is the link between fire history and ember supply.

**Residence.** Trunk bark keeps burning and shedding for minutes after the front passes, so emission
must come from the whole flaming zone, not only the front line [A].

### 2.4 Lofting: plumes, the convective number and pyroconvection

**Two regimes.** The competition between plume buoyancy and wind decides the geometry:
* *Plume-dominated* (N_c ≳ 10, weak wind): an upright column lofts embers high. They fall back near
  the fire, spreading in all directions and onto flanks, and sometimes behind control lines.
* *Wind-driven* (N_c ≲ 2): a bent-over plume keeps embers low. They are carried far downwind in a
  narrow ellipse.
* Thresholds after Morvan & Frangieh 2018 [P].

**Where the extremes come from.** The most dangerous combination is a very intense fire whose column
still reaches several km (unstable atmosphere, pyroCu/pyroCb) together with strong winds aloft. That is
the regime of 20–35 km spotting [D from §3.5, consistent with Hall et al. 2015 [V]].

**Pyroconvection.**
* When the plume reaches its condensation level, released latent heat boosts the updraft. Plume tops
  can then reach the upper troposphere.
* Peterson et al. (2021) documented 38 pyroCb events in the Black Summer "super outbreak", concentrated
  on 29–31 December 2019 and 4 January 2020 [S02]. (Corrected wording to match doc 02, which verified
  this against *npj Clim. Atmos. Sci.* 4:38.)
* Radar studies of US fires show plume-coupled long-range spotting: embers detrain from the column
  aloft, so the plume's own dynamics, not just the ambient wind, controlled where spot fires started
  (Lareau et al. 2025, Dixie Fire; Lareau et al. 2026, Camp Fire) [V titles; findings recalled, P].

**Night.** Stable air or a valley inversion caps plume rise (Briggs stable-rise law, §3.3), so spotting
distances shrink. Ridge tops above the inversion, and the thermal belt, stay windy, dry and receptive
[S02].

### 2.5 Horizontal transport: wind, turbulence and inertia

**Inertia can be ignored.** An ember's aerodynamic response time is τ_p = v_t/g ≈ 0.3–0.6 s, so it
matches the air velocity within a few metres [D]. On 100–200 m atmosphere cells, a kinematic model
(velocity = air velocity + turbulent fluctuation − v_t·ẑ) is adequate [D].

**Turbulence spreads embers in two ways:**
* it widens the cross-wind spread of landings;
* strong turbulent updrafts in the plume loft some embers higher than the mean plume would, which
  lengthens the tail.

Thurston et al. (2017) showed with LES of a bushfire plume that turbulent plume dynamics contribute
substantially to long-range spotting, compared with a smooth mean plume [P: the qualitative conclusion
is recalled; magnitudes not re-checked]. Bhutia et al. (2010) found that a steady plume model and a
coupled fire–atmosphere LES predicted substantially different firebrand landing patterns [P]. Kaur et
al. (2016) coupled a turbulent-diffusion and lognormal fire-spotting parameterisation into a front
simulator [V existence].

**Heavy particles lose correlation faster.** A falling ember leaves an eddy faster than a gas particle
would (the "crossing-trajectories" effect, Csanady 1963) [P]. Its effective Lagrangian timescale is
therefore shorter.

**Rod-like and plate-like brands tumble and can generate lift.** Wind-tunnel work on rod-like model
firebrands (Tohidi & Kaye 2017a,b) [P] shows orientation-dependent drag and lift. A constant-C_d
model is a simplification that tends to under-predict the far tail slightly [P/A].

**Wind aloft ≠ surface wind.**
* Embers lofted to 1–3 km travel in winds that are usually stronger than the 10 m wind and often veered
  or backed relative to it.
* On NSW fire days, north-westerlies aloft ahead of a front are common while surface winds are
  channelled along valleys [S02].
* Spot fires can therefore appear *off* the surface-wind axis [D].

### 2.6 Burnout: flaming vs glowing lifetime

* Tarifa et al. (1965) measured flight paths and lifetimes of burning wood particles in a vertical wind
  tunnel. Mass loss and terminal velocity both decline during flight [P].
* Albini adopted a Tarifa-type burning law for cylindrical wood brands: ρ_s·D decreases at a rate
  proportional to air density and relative velocity (§3.2) [P].
* **Eucalypt bark does not follow the wood law.**
  * Messmate flakes showed long burnout times from internal combustion, and re-flaming during the
    glowing phase (Ellis 2013) [V].
  * Ribbon-gum strips had mean burnouts of 122–429 s depending on morphology, with the convoluted
    strips longest (Hall et al. 2015) [V].
  * Albini's law applied to Hall's strips gives about 127–141 s (§3.2) [D]. (Corrected: an earlier
    draft held the fall speed constant and got 63–71 s, which is 2× too short.) That matches the
    simple cylinders (122 s), but under-predicts flat plates (251 s) about 2× and convoluted strips
    (429 s) about 3×.
  * **Use measured bark lifetimes, not the wood law.**
* **Teaching point:** a stringybark ember that lands glowing can re-flame, and so can a long-range
  ribbon strip [V, Ellis 2013 for flakes].

### 2.7 Ignition on landing

**Ellis (2015)** [V] ran dry-eucalypt litter at 4–21 % moisture content and air speeds of 0, 1 and
2 m/s:
* *Flaming* firebrands: ignition probability was insensitive to most fuel and airflow variables. It
  depended on moisture and on wind presence (wind or no wind).
* *Glowing* firebrands: ignition probability depended on moisture and on wind speed.
* The fitted models "confirm the dominating influence of fuel moisture".
* The logistic coefficients were not retrievable here (§6).

**Other work:**
* **Manzello and co-workers (2006 and later).** (Corrected, verified: Manzello et al. 2020 PECS review
  §5.3, which summarises the work.)
  * They dropped flaming or glowing brands on pine straw, hardwood mulch and cut grass, at two fuel
    moisture contents and two wind speeds.
  * *Glowing* brands: "it is unlikely for glowing firebrands to ignite the fuels tested even when they
    were very dry".
  * *Flaming* brands ignited the finer fuels at 11 % moisture. They never ignited hardwood mulch, and
    ignited cut grass about half the time.
  * The earlier wording, "glowing brands failed in still air and needed airflow", was a recollection and
    overstated the role of airflow for single glowing brands.
* **Ember piles and wind** (verified: Manzello et al. 2020 review, summarising Hakes et al. 2019).
  * Piles of glowing cylindrical brands heat the surface below far more than single brands. Peak
    heating rose with pile mass, then plateaued.
  * In still air the peak heat flux was about 10 kW/m². With a 1.84 m/s wind it exceeded 25 kW/m²,
    but the brands burnt out faster.
  * Hayashi's bamboo-leaf tests (same review): 1 cm glowing cubes hardly ignited 4.3 %-moisture leaves
    without wind, but did with 1 m/s wind.
  * Urban et al. (same review; sawdust smoulder, not eucalypt litter): brands < 4 mm could not start a
    smoulder even below 1 % moisture. Brands > 9.5 mm could, up to about 40 % moisture, but rarely.
  * **Consequences for FireSim:**
    * glowing brands need wind and/or accumulation;
    * **mass spotting ignites where single embers would not**, so treating landings as independent
      (1 − e^{−Wp}) under-states pile synergy;
    * brand size matters.
* Ganteaume et al. (2009, 2011) characterised Mediterranean firebrands (including *Eucalyptus globulus*
  bark) and fuel-bed receptivity. Flaming brands and fine, dry, low-density beds had the highest
  ignition frequencies [P].
* Plucinski & Anderson (2008) found moisture content the dominant control of point ignition in shrubland
  litter [P].
* Ellis (2011) showed that messmate bark *on the tree* is itself a receptive fuel bed. Embers lodging in
  stringybark can ignite trunks and create new ember sources [P].

**Receptivity varies with fuel type and fire history:**
* recently burnt areas have little litter;
* rainforest and riparian gully fuels are moist;
* rock, sandstone pavement and roads are non-fuel.

### 2.8 Spot-fire growth, mass spotting and coalescence

**Growth from a point.**
* A spot fire begins as a point. Its spread rate rises towards the quasi-steady rate of a wide head fire.
* The Canadian FBP System models this as R(t) = R_eq(1 − e^{−αt}) with α = 0.115 min⁻¹ for point
  ignitions (Forestry Canada 1992). That gives 50 % of R_eq after 6 min and 90 % after 20 min [D].
  (Verified: cffdrs R package `distance_at_time.r`, FCFDG 1992 eqs. 70–72, t in minutes. α = 0.115
  applies to the open fuel types C1, O1a/b, S1–S3 and D1. For closed-canopy types,
  α = 0.115 − 18.8·CFB^{2.5}·e^{−8·CFB}, which is lower when crowning occurs.)
* An equivalent eucalypt-litter laboratory study exists ("Initial growth of fires in eucalypt litter,
  from ignition to steady-state rate of spread", c. 2021) [V existence], but its parameters were not
  retrieved.

**Mass spotting.**
* Under extreme conditions eucalypt forest fires shower the area ahead with many short-range spots.
  These coalesce into a deep flaming zone that burns at once rather than as a thin front.
* The Black Saturday Kilmore East fire (Cruz et al. 2012) is the Australian reference case.
  * It showed "profuse short range spotting, rates of fire spread up to 9.1 km/h and average fireline
    intensities up to 88,000 kW/m".
  * "Strong winds aloft and the development of a strong convection plume led to the transport of
    firebrands over considerable distances causing the ignition of spotfires up to 33 km ahead of the
    main fire front".
  * A wind change then turned the roughly 55 km eastern flank into a head fire, feeding a pyroCb.
  * (Verified: Matthews et al. 2019, AFDRS Research Prototype §9.3, citing Cruz et al. 2012. That
    report's case table records observed spotting "up to 40,000–41,000 m" for 14:00–16:00, which
    conflicts with its text. Use the peer-reviewed 33 km.)
* Hilton, Garg & Sharples (2019) reproduced VLS-driven deep flaming with Lagrangian firebrands in the
  Spark framework [S02].

**Junctions.**
* When a spot fire meets the main front at a narrow angle, the junction accelerates. On slopes the
  simulations show only acceleration (doc 01 §2) [S01].
* In laboratory hill experiments, a hill alone slowed combined ROS by up to 5×, and one or two spot
  fires restored it to flat-bed levels (Storey et al. 2021, PLOS ONE) [S01].

**Positive feedback.** More spots mean more heat, a stronger plume, more lofting and more spots. The
coupled atmosphere represents this if spot-fire heat feeds `atmosphere.addFireHeat`.

### 2.9 How mountain terrain changes spotting

These are the key "why" items for trainees.

1. **Release-height advantage.**
   * An ember released over a ridge crest that then falls into a valley has extra fall height Δh.
   * Extra range ≈ Ū·Δh/v_t. For 400 m of relief, v_t = 5 m/s and Ū = 12 m/s that is about +1 km [D].
   * Albini's model has explicit ridge/valley terms and a spotting-source position (ridge top,
     mid-slope windward or leeward, valley bottom) for this reason. (Verified: BehavePlus `spot.cpp`
     `spotDistanceMountainTerrain`, with the equation in §3.4.) In that correction, a ridge-top source
     *gains* distance, a valley-bottom source *loses* distance, and the effect grows with
     ridge-to-valley relief.
2. **Ridge-top wind speed-up.** The wind is fastest at the crest, where a fire that has run up the
   windward slope is most intense, so ember lofting and ejection into the lee peak there [S01, S02].
3. **Lee-slope separation eddy.**
   * The flow separates on lee slopes steeper than about 15–20°, with crest winds above about
     15 km/h. Near-surface flow on the lee face then runs *upslope*, back towards the ridge, at about
     0.2–0.4 × the crest wind [S01: doc 01 §4 diagnostic; the magnitude is heuristic].
   * The stronger **VLS/fire-channelling** trigger quoted for the 2003 Canberra fires needs more:
     lee slopes of about 20–25°+, aspect within about 30–40° of the downwind direction, and winds
     above about 20–30 km/h [S01]. Keep the two thresholds separate.
   * Embers that drop into this zone are held near the lee slope and recirculated. Spot fires they
     start run **up** the lee slope, and laterally, not downwind.
   * This is counter-intuitive and dangerous for crews positioned "safely" behind a ridge.
4. **VLS / fire channelling.**
   * A fire on such a lee slope can spread laterally at high speed, bounded by the ridge line. The
     active flaming zone extends hundreds of metres downwind, "most likely due to enhanced spotting"
     [S02, McRae line-scan observations].
   * The combination drove deep flaming and pyroCb in the 2003 Canberra fires and in the Grose Valley in
     November 2006 (McRae, Sharples & Fromm 2015) [S02].
5. **Slope inside the source fire.** Storey et al. (2020, IJWF) found that source-fire area was the
   strongest predictor of maximum spot distance. A steep slope within the source fire also increased
   maximum spotting distance and the probability of spots beyond 500 m [S01].
6. **Upslope spotting and convergence.**
   * When wind and slope align, embers from a fire low on a slope land upslope ahead of it.
   * The spots run uphill fast and converge with the main run. This creates junction zones and a sudden
     "whole slope alight" event.
   * A gully (chimney) funnels both the plume and embers.
7. **Rolling and sliding firebrands.** On steep slopes, burning cones, bark chunks and logs roll down.
   They start fires *below* the main fire, which then run uphill towards it (doc 01 §4.6 heuristic)
   [S01].
8. **Gorges and cliffs are not barriers.** Blue Mountains gorges are a few hundred metres wide, well
   inside common ember ranges. Cliffs are ember-launch points, and embers are held over deep valleys
   longer [D]. The 2019 Mt Wilson backburn spotting into the Grose Valley is a recent example [S01].
9. **Valley channelling and saddles.** Low-level embers follow valley axes and are funnelled through
   saddles [S02].
10. **Inversions, thermal belts and mountain waves.**
    * Night inversions cap plumes (shorter spotting) and raise valley-floor moisture (spots fail).
    * Thermal belts and ridges above the inversion remain receptive.
    * Overnight mountain waves and downslope winds can drive firebrand transport.
      * At the **Aberfeldy fire (Victoria, 17 January 2013)**, overnight mountain waves and strong
        downslope winds "would have directly increased the fire intensity and spread, as well as
        contributed to firebrand transport" [S02, verified there: BNHCRC 2017].
      * (CORRECTED: an earlier draft attributed this quote to the State Mine fire, repeating an error
        doc 02 has since fixed.)
      * In NSW, at the **State Mine fire (Blue Mountains, 17 October 2013)**, a *daytime* mountain-wave
        band of strong winds reached down towards the surface near the fire as it grew from about
        1,000 ha to 12,400 ha in about 10 h [S02].
    * Morning inversion break-up is when spotting "wakes up" [S02].
11. **Aspect-driven moisture.** North- and west-facing slopes are drier in the afternoon, so landing
    embers succeed there more often. The moisture module supplies this per cell.
12. **Night drainage flows move low embers downhill.** Weakly lofted embers released after sunset
    travel in the cold-air drainage (katabatic) layer. That layer is often only tens of metres deep
    and flows down gullies towards the valley floor [D from doc 02 drainage-flow physics].
    * They usually land on damp valley-floor fuel and fail.
    * But they explain why spots can appear *downhill and down-valley* of a quiet night fire, against
      the gradient wind. Resolve this through the atmosphere's near-surface levels.
13. **Smouldering holdovers.** Glowing brands that land in logs, stumps, stringybark crevices or deep
    litter can smoulder for hours. They flare when the morning inversion breaks and the relative
    humidity falls [A/P: consistent with the smoulder-to-flame transition discussed in Manzello et al.
    2020 §5.3; no Australian holdover-duration data retrieved]. Teach "patrol the spot-fire zone at
    first light".
14. **Fire whirls and pyro-tornadoes loft embers.** Strong circulation raises vertical velocities and
    can increase both fragmentation and lofting (verified qualitatively: Manzello et al. 2020 §4,
    citing Muraszew et al.).
    * Lee-slope and gully fires in rugged terrain favour whirls.
    * The first confirmed Australian pyro-tornado formed over the ranges west of Canberra on
      18 January 2003 [S01].
    * FireSim cannot resolve whirls at 100–200 m. Treat a diagnosed intense lee-slope/VLS burning
      cell as having extra lofting (§4.5 item 2).

### 2.10 Case evidence and scale of the problem

* **Historical Australian extremes.** Spotting of about 29–30 km has been reported in Victorian
  eucalypt forests (McArthur; Cheney & Bary 1969; cited in reviews such as Koo et al. 2010).
  (UNVERIFIED: recalled attribution; the exact figure and fire were not re-checked.)
  Black Saturday 2009 (Kilmore East) produced spot fires up to 33 km ahead of the main front
  (verified: AFDRS-RP 2019 §9.3, citing Cruz et al. 2012).
* **Operational spotting descriptors by old FDR category** (verified: AEMC National Bushfire Warnings
  Taskforce 2009 table, reproduced in AFDRS-RP 2019 Table 2.4; "Bushfire" = forest). These are
  public-messaging bands, not model output. They are useful as a sanity check on FireSim's P95
  ranges:

  | FFDI category | Forest ROS | Spotting | Intensity (kW/m) |
  |---|---|---|---|
  | Low–Moderate (0–11) | 0.1–0.5 km/h | < 1 km | 100–3,000 |
  | High (12–24) | 0.5–1 km/h | > 1 km | 4,000–10,000 |
  | Very High (25–49) | 1–2 km/h | > 2 km | 10,000–20,000 |
  | Severe (50–74) | 2–3 km/h | > 4 km | 20,000–40,000 |
  | Extreme (75–99) | 3–6 km/h | > 6 km | 30,000–60,000 |
  | Catastrophic (100+) | 10+ km/h | 8–20 km | 50,000+ |
  The CSIRO science news article "Spotting the danger of long-distance firebrands" (2017) summarises
  the ribbon-bark findings [V existence].
* **Black Summer 2019–20.**
  * The pyroCb super-outbreak [S02] and multiple NSW fires spotted across major rivers, highways and
    containment lines. Spot distances were not quantified in sources I could retrieve.
  * Note that Storey et al. (2020, *Fire*) covers **2002–2018**, so it predates Black Summer [V].
* **Line-scan statistics.** See Storey et al. 2020 (*Fire*) [V] in §1, item 7, and Storey et al. 2020
  (*IJWF*) [S01] in §2.9, item 5.
* **Northern Rockies 2017.** Page et al. (2019) analysed observed spotting distances and compared them
  with Albini-type predictions [V title]. The results were not retrieved.

---

## 3. Quantitative relations

Units are SI unless stated. ρ_a is air density (kg m⁻³), g = 9.81 m s⁻², c_p ≈ 1005 J kg⁻¹ K⁻¹, and T_a
is ambient temperature (K).

### 3.1 Aerodynamics

**(1) Terminal velocity (Newton drag regime)** [standard physics] (verified: force balance; the
table below was recomputed in this pass and all seven rows match)

```
v_t = sqrt( 2 m g / (ρ_a C_d A_p) )            [m/s]
```

* m: mass (kg).
* A_p: projected area normal to the fall (m²).
* C_d: drag coefficient (dimensionless).
* Valid for Re = ρ_a v_t L/μ ≈ 10³–10⁵, with μ ≈ 1.8×10⁻⁵ Pa s. Ember sizes of mm to cm at a few m/s
  give Re ≈ 10³–10⁴ [D].

**(2) Thin plate falling flat** (thickness δ, solid density ρ_s):

```
v_t = sqrt( 2 ρ_s δ g / (ρ_a C_d) )
```

**(3) Cylinder falling broadside** (diameter D), the form used by Albini with C_d ≈ 1.2:

```
v_t = sqrt( π ρ_s D g / (2 C_d ρ_a) )
```

(Verified: FARSITE `fsxwspot.cpp` implements Albini's `voo = sqrt(1910.087·D/0.18)` in ft/s, with
D in ft. The source comment reads "g = 32 ft/s², particle density 19 lb/ft³, drag coef 1.2". Here
1910.087 = π·32·19, and 0.18 = 2·1.2·ρ_a with ρ_a ≈ 0.075 lb/ft³ ≈ 1.2 kg/m³. So Albini's wood brand
has ρ_s ≈ 304 kg/m³ and C_d = 1.2. For comparison, the WRF-Fire spotting module uses spheres, with
v_t = sqrt(4ρ_s D g/(3ρ_a C_d)), C_d = 0.45, wood 513 kg/m³ and char 299 kg/m³ (verified: WRF
`module_firebrand_spotting.F`).)

Evaluated with ρ_a = 1.1 and C_d = 1.2 [D]:

| Case | ρ_s (kg/m³) | Size | v_t (m/s) |
|---|---|---|---|
| Leaf plate | 500 | δ 0.3 mm | 1.5 |
| Leaf plate | 700 | δ 0.4 mm | 2.0 |
| Bark flake | 300 | δ 2 mm | 3.0 |
| Bark flake | 300 | δ 4 mm | 4.2 |
| Twig | 400 | D 3 mm | 3.7 |
| Twig | 400 | D 5 mm | 4.8 |
| Twig | 400 | D 10 mm | 6.8 |

The densities are illustrative; charred-bark densities were not retrieved. **Measured values:**
ribbon-bark strips fall at 5.2–5.8 m/s [V]. Calibrate class defaults to measurements where they exist.

**(4) Response time and kinematic approximation** [D]

```
τ_p ≈ v_t / g ≈ 0.3–0.6 s
```

The relaxation length v_t·τ_p is about 1–4 m, far smaller than the grid, so use ember velocity = air
velocity − v_t·ẑ.

**(5) Tachikawa number** (Tachikawa 1983, flat-plate debris flight) [P] (the definition is standard.
UNVERIFIED against the paper; the algebraic reduction was checked)

```
K = ρ_a U² A / (2 m g) = U² / (C_d v_t²)        [D, using (1)]
```

When K ≫ 1 the brand is essentially wind-borne.

**(6) Altitude.** v_t ∝ ρ_a^{−1/2}. With ISA densities (1.225, 1.112 and 1.007 kg/m³), v_t is about
5 % higher at 1000 m and about 10 % higher at 2000 m (Kosciuszko) than at sea level [D] (verified:
arithmetic). Use the local ρ_a from the atmosphere. On a 40 °C day at 1000 m, ρ_a ≈ 1.0 kg/m³, so
temperature matters as much as altitude.

### 3.2 Burning in flight

**(7) Tarifa/Albini wood burning law** (Albini 1979, after Tarifa et al. 1965) [P: verify the exact form
and constant in INT-GTR-56]

```
d(ρ_s D)/dt = − K ρ_a v_r ,    K ≈ 0.0064 (dimensionless),  v_r ≈ v_t (relative air speed)
lifetime τ ≈ (ρ_s D)_0 / (K ρ_a v_r)
```

Two consequences: slow-falling brands burn more slowly, and brands burn more slowly in thin air.

**Check against eucalypt bark** [D]:
* For a strip at v_t = 5.2–5.8 m/s, eq. (1) gives m/(D·L) ≈ 2.0–2.5 kg/m². The equivalent ρ_s·D is
  ≈ 2.5–3.1 kg/m².
* Eq. (7) then gives τ ≈ 63–71 s.
* Hall et al. measured *mean* burnouts of 122–429 s [V].
* **The wood law under-predicts bark lifetime by about 2–7×**, so FireSim uses empirical lifetimes per
  class.

**(8) FireSim mass loss and fall speed** [A, D]

```
m(t)/m0 = max(0, 1 − t/τ_b)
v_t(t)  = v_t0 · (m/m0)^n ,  n = 1/2 plates (area constant),  n = 1/4 cylinders (D shrinking, L constant)
state   = flaming if t < τ_f, else glowing
```

Stringybark (E1) re-flames with hazard rate λ_rf per second [A]. Ellis 2013 observed re-flaming in 18
samples [V]; the total sample count and rate were not retrieved. v_t must never drop below
0.3·v_t0 [A], which stops unphysical floating before burnout.

### 3.3 Plume strength, lofting and plume height

**(9) Line-fire buoyancy flux** [P, standard plume theory]

```
F_L = g I / (ρ_a c_p T_a)        [m³ s⁻³],   I = Byram fireline intensity (W/m)
```

Byram's I includes radiated heat. The convective share is smaller, but the fraction is uncertain [P].

**(10) Byram convective number** (Byram 1959; units clarified by Nelson 1993) [P]

```
N_c = 2 g I / (ρ_a c_p T_a (U − R)³) = 2 F_L / (U − R)³
```

* U: wind speed (m/s). The reference height is not standardised: use the 10 m open wind and state it.
* R: ROS (m/s).
* Regimes: N_c < 2 wind-driven, N_c > 10 plume-dominated (Morvan & Frangieh 2018) [P].

Worked values [D] (ρ_a = 1.1, T_a = 303 K, R ≪ U):

| I (kW/m) | F_L (m³/s³) | F_L^{1/3} (m/s) | N_c, U = 3 m/s | N_c, U = 5 m/s | N_c, U = 10 m/s |
|---|---|---|---|---|---|
| 1,000 | 29 | 3.1 | 2.2 | 0.5 | 0.06 |
| 3,000 | 88 | 4.4 | 6.5 | 1.4 | 0.18 |
| 10,000 | 293 | 6.6 | 22 | 4.7 | 0.6 |
| 20,000 | 586 | 8.4 | 43 | 9.4 | 1.2 |
| 50,000 | 1,464 | 11.4 | 108 | 23 | 2.9 |

Identity [D]: (N_c/2)^{1/3} = F_L^{1/3}/(U − R). N_c ≈ 10 therefore means the plume velocity scale is
about 1.7× the wind speed.

**(11) Line-plume velocity scale** [P, similarity theory]

```
w_c ≈ C_w F_L^{1/3}
```

C_w is of order 1–2. It depends on the entrainment coefficient, is uncertain, and should be calibrated
against the resolved atmosphere. A 1000 kW/m fire barely lofts 5 m/s brands. A 20,000 kW/m fire lofts
them readily [D].

**(12) Point/area-source plume rise** (Briggs 1975) [P]

```
F  = g Q / (π ρ_a c_p T_a)                 [m⁴ s⁻³],  Q = heat release (W)
Δh = 1.6 F^{1/3} x^{2/3} / U               neutral, bent-over, transitional rise at distance x
Δh = 2.6 (F / (U N²))^{1/3}                stable, windy (final rise)
Δh = 5.0 F^{1/4} N^{−3/4}                  stable, calm (final rise)
N  = sqrt( (g/θ) dθ/dz )                   Brunt–Väisälä frequency (s⁻¹)
```

Worked example [D]: a 1 km front at 10 MW/m (Q = 10 GW) gives F ≈ 9.3×10⁴ m⁴/s³.

| Conditions | Final rise |
|---|---|
| Stable, N = 0.01 s⁻¹, U = 10 m/s | about 1.2 km |
| Weakly stable, N = 0.005 s⁻¹, U = 10 m/s | about 1.9 km |
| Night inversion, N = 0.02 s⁻¹ | about 0.74 km |
| Q = 50 GW, N = 0.005 s⁻¹, U = 10 m/s | about 3.2 km |

These are dry-plume numbers. PyroCu/pyroCb (latent heat) exceed them.

**(13) Satellite-calibrated injection height** (Sofiev et al. 2012) [P: constants recalled, verify]

```
H_p = α H_abl + β (FRP / P_f0)^γ · exp(−δ N_FT² / N_0²)
α = 0.24, β = 170 m, γ = 0.35, δ = 0.6, P_f0 = 10⁶ W, N_0² = 2.5×10⁻⁴ s⁻²
```

FRP is fire radiative power (W), only a fraction of the total heat release. Use this only as a
cross-check on resolved plume tops.

**(14) Lofting criterion** (Albini 1979/1983 concept) [P]

An ember rises while w_air(z) > v_t(t). It is released to fall where w_air = v_t or at plume top. Low-v_t
embers are lofted highest.

### 3.4 Albini's spotting model: structure for reuse

Albini (1979, INT-GTR-56) [V existence] predicts maximum spot distance from torching trees. Extensions
cover burning piles (Albini 1981) and wind-driven surface fires via line thermals (Albini 1983a,b) [P].

Its structure:
1. The source (tree species, DBH, number torching, or fireline intensity) sets flame height and
   duration.
2. These set the maximum firebrand lofting height z_F.
3. A cylindrical brand burns by eq. (7) and falls at eq. (3).
4. Transport uses a log wind profile above the canopy, typically cited as
   ```
   u(z) = u_H · ln((z − 0.64H)/(0.13H)) / ln(0.36/0.13)      [P]
   ```
   where H is canopy height and u_H the wind at canopy top.
5. The maximum distance belongs to the brand that just burns out as it lands.
6. A terrain correction uses ridge-to-valley elevation difference, ridge-to-valley horizontal distance
   and the source's position on the slope [P, these are BehavePlus spotting inputs].

For FireSim, reuse the *structure* but not the calibrations. Albini's calibrations were built for North
American conifers and wood brands [A].

### 3.5 Flight-time and burnout bounds

These give cheap, honest sanity checks and explanations.

**(15) Steady horizontal wind, constant v_t** [D]

```
X = (1/v_t) ∫_{z_land}^{z_L} U(z) dz = Ū · (z_L − z_land)/v_t
```

Ū is the mean wind through the fall layer. The terrain drop bonus is ΔX = Ū·Δh/v_t.

**(16) Burnout-limited maximum** [D]

```
z* = v_t τ_b ;   X_max ≈ Ū τ_b   (if the plume lofts the brand to ≥ z*)
```

Worked cases [D]:

| Ember | v_t (m/s) | τ_b (s) | z* | Ū (m/s) | X_max |
|---|---|---|---|---|---|
| Stringybark flake | 5 [A] | 120 [A] | 600 m | 12 | 1.4 km |
| Convoluted ribbon strip, mean | 5.8 [V] | 429 [V] | 2.5 km | 15 | 6.4 km |
| Ribbon strip, long-life tail | 5.8 | 1200 [D, from Hall's > 20 km at 60 km/h] | 7 km | 16.7 | 20 km |
| Leaf | 2 [D] | 30 [A] | 60 m | 12 | 0.36 km |

The 7 km loft needed for the tail case explains why 20–30 km spotting is tied to pyroconvective
columns.

### 3.6 Empirical Australian spotting-distance relations

**(17) McArthur Forest Fire Danger Meter Mk5 as equations** (Noble, Bary & Gill 1980) [P: the form is
well known; verify coefficients]

```
R = 0.0012 · FFDI · W                 R = ROS on flat ground (km/h), W = fine fuel load (t/ha)
S = R · (4.17 − 0.033 W) − 0.36       S = spotting distance (km)
R_θ = R · exp(0.069 θ)                slope correction, θ in degrees (upslope +)
```

Worked values (flat ground) [D]:

| FFDI | W (t/ha) | R (km/h) | S (km) |
|---|---|---|---|
| 25 | 15 | 0.45 | 1.3 |
| 50 | 15 | 0.9 | 3.0 |
| 100 | 15 | 1.8 | 6.3 |
| 100 | 25 | 3.0 | 9.7 |
| 150 | 20 | 3.6 | 12.3 |

This is a regression fit to a meter calibrated on 1960s Australian fires, not physics. S becomes
negative at low R. Use it only as an order-of-magnitude check on the Lagrangian model's P95–max landing
distance.

**(18) Project Vesta (Gould et al. 2007)**
* Bark hazard 3 → 2 gives about a third of the firebrand density [V].
* Fuel characteristics and wind correlate with firebrand density and spotting distance, both of which
  increase with time since fire [V].
* The Vesta field guide also gives a maximum-spotting-distance model. **Its equation was not
  retrievable in this session and must be transcribed from the source** before use.

### 3.7 Landing-distance distributions

**(19) Lognormal kernel** (Sardoy et al. 2008; used in Kaur et al. 2016) [P]

```
f(ℓ) = 1 / (sqrt(2π) σ ℓ) · exp( −(ln ℓ − μ)² / (2σ²) )
```

Sardoy's regressions for μ and σ as functions of I (MW/m) and U (m/s), with separate branches for
plume- and wind-dominated Froude numbers, are reproduced in Kaur et al. (2016). As recalled:
* wind-driven branch: μ = 1.32 I^{0.26} U^{0.11} − 0.02 and σ = 4.95 I^{−0.01} U^{−0.02} − 3.48;
* plume-driven branch: μ = 1.47 I^{0.54} U^{−0.55} + 1.14 and σ = 0.86 I^{−0.21} U^{0.44} + 0.19.

**Low confidence.** These constants are recalled, not re-checked. They were derived for idealised disk
brands from line fires, not eucalypt bark, and are **not** used in FireSim defaults.

**Evidence against a single kernel.** Observed south-east Australian distributions are often
**multimodal**, and exponential-shaped kernels can under-estimate long-range spotting (Storey et al.
2020) [V]. Martin & Hillen (2016) derive spotting kernels by combining lofting-height and transport
distributions [P]. This supports FireSim's choice to *simulate* rather than prescribe the kernel.

### 3.8 Turbulence for unresolved eddies

**(20) Ornstein–Uhlenbeck (Langevin) velocity fluctuation**, exact discrete update, one per component
[standard]:

```
u'_{n+1} = u'_n · e^{−Δt/T} + σ · sqrt(1 − e^{−2Δt/T}) · ξ ,   ξ ~ N(0,1)
```

**(21) Boundary-layer turbulence** [P, standard parameterisations]:

```
Neutral surface layer (Panofsky & Dutton 1984):  σ_u ≈ 2.4 u*,  σ_v ≈ 1.9 u*,  σ_w ≈ 1.25 u*
Convective BL (Lenschow et al. 1980):            σ_w² / w*² = 1.8 (z/z_i)^{2/3} (1 − 0.8 z/z_i)²
                                                 σ_u ≈ σ_v ≈ 0.6 w*   [P, Hanna 1982]
w* = ( g z_i H_s / (ρ_a c_p θ) )^{1/3}           Deardorff convective velocity; H_s = sensible heat flux (W/m²)
T_L ≈ 0.15 z_i / σ  (CBL, Hanna 1982)           T_L,w ≈ 0.5 z / σ_w (near-neutral surface layer) [P]
```

* Inside the plume, use σ_w = α_p·w_plume with α_p ≈ 0.25 [A]. Laboratory plumes show centreline
  turbulence intensities of order 0.2–0.35 [P].
* *Crossing trajectories* (Csanady 1963) [P]: T_eff = T_L / sqrt(1 + (β v_t/σ)²), with β of order 1.
* *Well-mixed drift* (Thomson 1987) [P]: add the ½·∂σ_w²/∂z drift term. Without it, particles
  accumulate spuriously where turbulence is weak. The error is small for heavy, falling brands, but the
  term is cheap.

### 3.9 Ignition probability on landing

**(22) Schroeder (1969) / Rothermel (1983) "probability of ignition"** [P]. This is the standard US
fine-dead-fuel ignition index, used in BehavePlus spotting practice. It is an American index; use it
only as a documented fallback.

```
Q_ig = 144.5 − 0.266 T_f − 0.00058 T_f² − T_f M + 18.54 (1 − e^{−15.1 M}) + 640 M     [cal/g]
X    = (400 − Q_ig) / 10
P_ig = 0.000048 · X^{4.3} / 50        (clip to [0,1]; 0 if X ≤ 0)
```

* T_f: fuel temperature (°C), which is higher than air temperature in sunlit litter.
* M: dead fine fuel moisture as a *fraction*.

Computed values [D]:

| T_f | M 3 % | 5 % | 7 % | 10 % | 12 % | 15 % | 18 % | 20 % | 25 % |
|---|---|---|---|---|---|---|---|---|---|
| 20 °C | 0.77 | 0.57 | 0.42 | 0.27 | 0.19 | 0.11 | 0.06 | 0.04 | 0.01 |
| 30 °C | 0.81 | 0.61 | 0.46 | 0.29 | 0.21 | 0.13 | 0.07 | 0.05 | 0.01 |
| 40 °C | 0.86 | 0.65 | 0.49 | 0.32 | 0.24 | 0.15 | 0.09 | 0.06 | 0.02 |

**(23) Eucalypt-specific form (target: Ellis 2015)** [V structure; coefficients not retrieved]

```
flaming:  logit P = a_f + b_f·M + c_f·[wind > 0]
glowing:  logit P = a_g + b_g·M + c_g·u_s                  (M in %, u_s = air speed at the bed, 0–2 m/s)
```

Replace the fallback with these once the coefficients are transcribed.

### 3.10 Spot-fire acceleration

**(24) FBP point-ignition acceleration** (Forestry Canada Fire Danger Group 1992; McAlpine & Wakimoto
1991) [P]

```
R(t) = R_eq (1 − e^{−α t}),   α = 0.115 min⁻¹
```

t₅₀ = 6 min, t₉₀ = 20 min, t₉₅ = 26 min [D]. It was fitted for Canadian fuels, so applying it to
eucalypt litter is an assumption [A]. Replace it with the eucalypt-litter growth study once retrieved.

---

## 4. Implementation recommendations (`src/embers/`)

### 4.1 Overall design

* **Particles.** A weighted, stratified Lagrangian super-particle model inside the existing `EmberModel`
  contract. The budget is `maxEmbers` ≤ 4000 active.
* **Weights.** Each particle carries a weight W (the number of real firebrands it represents), a class,
  and its own v_t0, τ_f and τ_b.
* **Provenance.** Each particle carries source cell, emission time, maximum height and state history.
* **Wind.** Particles use the resolved 3-D wind `sample(x, y, zAGL)`, plus a sub-grid plume term, plus
  OU turbulence.
* **Landing.** Landings go to the fuel/moisture callback. They become spot fires through
  `onIgnite` → `fire.igniteAt` after a delay.
* **Ignition function.** The rolling-debris heuristic of doc 01 §4.6 reuses the same
  `ignitionProbability()` [S01].

**Class defaults** (all [A] unless tagged; expose all of them in a developer panel):

| Class | Share of particle budget | v_t0 (m/s) | τ_f flaming (s) | τ_b total (s) | Launch height | Notes |
|---|---|---|---|---|---|---|
| E1 stringybark flake | 35 % | lognormal, median 4.5, range 3–6 | lognormal, median 30 | lognormal, median 150, tail to ≥ 600 (internal combustion [V]) | U(0.3, 1.0) × min(flame ht, loose-bark ht) | λ_rf re-flame 0.005 s⁻¹ [A] |
| E2 ribbon strip | 30 % when ribbon species present, else 0 | U(5.2, 5.8) [V] | median 60 | mixture over 3 morphologies with means 251 / 122 / 429 s [V], plus a long tail to about 1500 s [A, consistent with > 20 km [V]] | crown base to canopy top when flame reaches crown, or I > 10 MW/m | long-range carrier |
| E3 leaf | 15 % when crown involved | 1.5–2.5 [D] | 10 | 25 | canopy | burns out < 1 km |
| E4 twig | 15 % | 4–7 [D] | 20 | 60 [D, eq. 7] | 0.5–1 × flame height | |
| E5 heavy | 5 % | 8–12 | 60 | 600 | ground | rarely lofted; hand-off to rolling-debris module |

### 4.2 Emission

**Real firebrand production** per burning fire cell k (flaming zone, not only the front) [A]:

```
ṅ_k = E0 · B(BH_k) · (I_k / 1000 kW/m) · e_k · Δx        [firebrands/s from that cell]
B(BH) = 3^(BH − 2)                  anchored to Vesta's ×3 per score between 2 and 3 [V]; extrapolation [A]
e_k  = clamp((L_f − 1 m)/(h_bark − 1 m), 0, 1)   bark engagement; h_bark = loose-bark height (default 8 m [A])
```

* I_k is spread over the flaming residence time. E0 is a calibration constant (§4.9).
* Crown involvement adds leaves and twigs in proportion to crown fraction burnt.
* Split ṅ_k into classes by the cell's bark type.

**Super-particle sampling.**
* Each atmosphere step, draw N_c particles per class, with Poisson(ṅ_class·dt / W_class).
* Choose W_class so that the class's expected steady-state population matches its budget share:
  pop ≈ emission rate × mean flight life.
* Recompute W_class adaptively every 5 min of simulated time.

**Importance sampling for the tail.** Within E1 and E2, sample τ_b from a distribution with a thicker
tail than nature's, and multiply W by the likelihood ratio. This resolves 5–20 km events with a few
hundred particles without biasing expected ignition counts [A, standard Monte Carlo].

### 4.3 Launch and lofting (hybrid plume)

**Why a hybrid.** A 150 m atmosphere cell smears the narrow near-source plume, so the resolved w
near the ground is too weak. A 30 m-deep flaming zone with a 20 m/s core becomes a few m/s at 150 m
resolution [D].

**Sub-grid correction** [A]:

```
w_sg(x, z) = C_w F_L^{1/3} · exp(−(z − z_0)/z_d) · φ(x)        added to the resolved w
z_d = 1.5 Δz_atm (≈ 150–300 m)
φ(x) = 1 over burning cells, decaying linearly to 0 one atmosphere cell downwind along the plume tilt
       (tan θ_tilt = U / (C_w F_L^{1/3}))
C_w = 1.5 (calibrate so that resolved + sub-grid plume top matches Briggs, eq. 12, within ±30 %
      for the reference test in §4.9)
```

* Particles start at z_0 (class launch height) with velocity = local air velocity.
* In-plume turbulence (σ_w = 0.25·w_plume) lets some particles overshoot. Thurston-type LES shows this
  matters for the tail [P].

**Above the atmosphere top (~3 km).**
* Use ambient winds interpolated from pressure-level NWP (Open-Meteo 850/700/500 hPa, about 1.5, 3
  and 5.5 km) with w = 0.
* If the diagnosed plume top from the atmosphere or eq. (12)/(13) exceeds the model top (pyroCu/Cb
  flag, doc 02 PFT/C-Haines), continue w_sg aloft up to that plume top so that long-range carriers can
  be represented [A].

**Cheap fallback** when the atmosphere is disabled or the device is slow:
* sample loft height z_L = z_p·U(0,1)^{1/2} [A], capped where C_w F_L^{1/3} ≤ v_t;
* then fall through the 1-D ambient wind profile using eq. (15).

### 4.4 Transport integration

Per particle, per ember step Δt_e:

```
Δt_e = clamp(0.4 · min(Δz_local/|w_rel|, Δx_atm/|u_h|), 0.5 s, 5 s)
(u, v, w) = atmosphere.sample(x, y, zAGL)          // trilinear
w += w_sg(x, z)
(u', v', w') ← OU update, eq. (20), with σ, T_eff from eq. (21) (plume-enhanced inside φ > 0)
x += (u + u')Δt_e ;  y += (v + v')Δt_e ;  z += (w + w' − v_t(t))Δt_e
age += Δt_e ;  update m, v_t, state (eq. 8)
if age ≥ τ_b                                       → die (burnt out)
if z ≤ z_ground(x, y)                              → land (§4.6)
if outside domain                                  → analytic continuation (below)
```

* Freeze the wind field during each atmosphere step (5–20 s); interpolating in time costs memory.
* Sample the ground elevation bilinearly from the terrain.

**Domain exit.**
* Continue analytically with the ambient profile: remaining flight time t = min(z/v_t,
  τ_b − age), and distance += Ū·t.
* Keep a histogram of beyond-edge landing distances weighted by W·P_ign(ambient moisture). This drives
  the "embers could start fires up to X km beyond the model area" card.
* Increment `leftDomain`.

### 4.5 Mountain-specific hooks

These are ember-specific; the fire-spread versions are in doc 01.

1. **Lee-eddy near-surface override.**
   * On lee-separated cells (doc 01 fuzzy VLS score V > 0.5, or diagnosed separation), the resolved
     150 m wind will not reproduce the thin reversed layer.
   * Below z_sep = 0.3 × local relief (ridge-to-valley) [A], blend the horizontal wind towards
     −0.3 × U_crest along the fall line (upslope) [A: magnitude uncertain].
   * Embers falling into the eddy are then drawn back towards the slope and ridge.
2. **VLS ember injection.** When V > 0.5 and the cell burns above about 4000 kW/m [S01], multiply E1–E4
   emission by 2–3 [A]. Launch at the ridge-top height, where the separated shear layer carries them
   downwind. This follows Hilton et al.'s finding that lateral spread "casts off" embers causing deep
   flaming [S02].
3. **Ridge release.** Nothing special is needed. Explicit terrain collision gives the release-height
   advantage automatically. Record Δh for the explanation.
4. **Thermal belt and inversion.** Ignition uses per-cell moisture from the moisture module (thermal-belt
   logic, doc 01 §4.4 item 6 [S01]). Plume capping comes from the resolved stratification.
5. **Cross-valley preheating** lowers M at receiving cells (doc 01 §4.7 [S01]), which raises P_ign
   automatically.

### 4.6 Landing, ignition, delay and growth

**Landing callback.** It returns moisture M (%), fuel type, burnable status, and (to be added) surface
fuel hazard, curing and fuel temperature.

**Ignition probability** [A composite; target Ellis 2015 [V]]:

```
P_M      = Schroeder/Rothermel P_ig(M, T_f), eq. (22)          // until Ellis coefficients are transcribed
S_state  = 1.0 (flaming) ;  glowing: 0.5 · clamp(u_s / 2 m/s, 0, 1)   // u_s = bed-level wind
u_s      = f_c · U10 ,  f_c = 0.1 (closed forest) … 0.4 (open/grass) [A]
R_fuel   = dry-forest litter 1.0 ; grass × curing ; heath 0.7 ; wet forest 0.5 ; rainforest/riparian 0.2 ;
           non-fuel 0 ; × min(1, SFH/2) for sparse litter [A]
p        = P_M · S_state · R_fuel · (m/m0)^{0.25}   // small remnants ignite less [A]
P_spot   = 1 − exp(−W·p)                              // super-particle of weight W
```

**Exclusion zone (avoid double counting).**
* Vesta- and McArthur-type ROS already include short-range spotting in the observed spread [P/A].
* Do not spawn spot fires within d_ex = max(2 Δx_fire, R_local × 3 min) of the active front on its
  downwind side. Count such landings as "short-range spotting".
* Landings on burnt cells are ignored. Unburnt islands inside the perimeter *can* ignite.

**Delay** [A]: τ_d is U(5, 30) s for flaming landings and U(60, 600) s for glowing ones (smoulder to
flame).

**Growth.** Ignite with the eq. (24) acceleration ramp applied to the local ROS. Seed the spot with a
radius of about 1 fire cell.

**Heat.** Spot heat enters `addFireHeat` so plumes and coalescence feedback emerge. Junction
acceleration comes from doc 01 §4.5.

**Provenance record** per spot fire, for the explanation engine:

```ts
interface SpotProvenance { sourceCell: number; emberClass: 'flake'|'ribbon'|'leaf'|'twig'|'heavy';
  emitTime: number; maxHeightAGL: number; flightTime: number; distance: number; meanWindAloft: [number, number];
  landingState: 'flaming'|'glowing'|'reflamed'; landingMoisture: number; pIgnite: number;
  landingSlope: number; landingAspect: number; leeEddy: boolean; ridgeDrop: number; convectiveNumber: number }
```

### 4.7 Performance budget

**Cost per particle step** [D estimate]:
* trilinear sample, 3 components: about 25 reads;
* 3 Gaussian draws (a Ziggurat or table is recommended);
* terrain bilinear, burnout and state updates.

That is about 150–300 ns in a JIT-compiled typed-array loop on a mid-range phone.

**Scenario total.** At 4000 active particles and a mean Δt_e of about 3 s, a 6 h scenario is about
7200 steps × 4000 ≈ 2.9×10⁷ particle-steps, or about 4–9 s. Early in a scenario, or with low-intensity
fires, the active count is much lower.

**Implementation.**
* Store particles as a structure of arrays (`Float32Array` x, y, z, u', v', w', age, v_t0, τ_b, τ_f, W;
  `Uint8Array` class and state; `Int32Array` source cell).
* Compact the arrays on death.
* Accumulate two overlay rasters on the fire grid: *landing density* (Σ W per m²) and *expected
  ignitions* (Σ W·p). They cost O(1) per landing.

The embers stay within about 10 % of the 1–2 minute overall budget.

### 4.8 Simplifications and their consequences

| Simplification | Consequence | Mitigation |
|---|---|---|
| Kinematic (no inertia) | Negligible at grid scale | none needed |
| Constant C_d, no lift or tumbling | Slightly short far tail [P] | turbulence and importance sampling; calibration |
| Sub-grid plume hack | Loft heights sensitive to C_w | calibrate against Briggs; user "observed column height" input |
| Empirical lifetimes (few data) | Uncertain E1 tail | ranges from Ellis 2013 and Hall 2015; sensitivity slider |
| Wind frozen per atmosphere step | Misses gusts < 10 s | OU turbulence |
| No canopy interception | Over-predicts ground landings slightly | R_fuel can absorb it |
| Schroeder P_ig not eucalypt-specific | Moisture sensitivity may be off | replace with Ellis 2015 coefficients |
| Beyond-domain spots not simulated | Cannot show far spot growth | explicit card + histogram |
| Generation rate uncalibrated (E0) | Absolute spot counts uncertain | calibrate (§4.9); present as *relative* likelihood |

### 4.9 Calibration and validation tests (Vitest)

1. **Aerodynamics.** v_t from eqs. (2) and (3) matches the table in §3.1. The ribbon class returns
   5.2–5.8 m/s [V].
2. **Flight bound.** In a uniform 16.7 m/s wind with no plume, releasing E2 at z* = v_t·τ_b lands at
   Ū·τ_b ± 5 % (for example 1200 s → 20 km) [D, V].
3. **Plume.** A 1 km × 10 MW/m line fire in N = 0.01 s⁻¹ and U = 10 m/s has a resolved + sub-grid
   plume top of about 1.2 km ± 30 % (eq. 12) [D].
4. **Bark hazard.** Raising BH from 2 to 3 triples landing density, all else equal [V].
5. **McArthur order of magnitude.** For FFDI 50, W = 15 t/ha, flat terrain and dry litter, the
   P95–P99 spot distance lies within a factor of about 2 of S ≈ 3 km (eq. 17) [A tolerance].
6. **Moisture.** Raising M from 6 % to 18 % (night) cuts successful spots by about 5–10× (eq. 22
   table) while landings stay similar.
7. **Multimodality.** With a ribbon-bark source and a deep plume, the landing histogram shows a
   secondary far mode or tail. It must not be forced exponential [V, Storey 2020].
8. **Lee eddy.** On a synthetic 2-D ridge with a 25° lee slope and 10 m/s crest wind, the lee-slope
   landing fraction exceeds that of the no-eddy run.
9. **Determinism.** A fixed seed gives identical spot sequences, which checkpoint/rewind requires.

**E0 calibration.**
* Choose E0 so that spot-fire counts per km of head fire per hour, under a reference "severe day",
  match line-scan statistics. The target numbers must be extracted from Storey et al. 2020 [§6].
* Until then, present spot counts as relative ("many / some / few").

### 4.10 What users should be able to edit

* **Bark type and bark hazard** per brush: stringybark, ribbon/candle, box/peppermint, ironbark, smooth,
  and "recently burnt – low bark".
* **Litter moisture override**, for example "litter is crunchy dry" or "damp after rain". A **fuel
  receptivity** multiplier, for example "deep dry litter" or "green pick".
* **Wind aloft**, from observed smoke-column lean or drift direction. **Observed column height**, for
  example "pyroCu cap at about 5 km", which sets the plume-top override.
* **Observed spot fire**: the user marks a spot, and the app back-computes which ember classes could
  reach it (eq. 15/16) and shows the explanation.
* **Observed maximum spot distance** for calibration: scale C_w and the tail weights until the modelled
  P95 matches.
* **Ember class toggles** and an **ember density slider**, labelled uncertain.

---

## 5. Explaining it to a beginner firefighter

**General rules.**
* Each card fires from model state, at most once per 10 simulated minutes per phenomenon per area.
* Cards should cite the provenance record ("this ember came from…").
* Thresholds marked [A] are FireSim defaults. Those marked [S01] follow doc 01.

| # | Card title | Detection criteria | Card text (plain language) |
|---|---|---|---|
| 1 | **Spot fire — here's why** | Any spot fire spawned (rate-limited, the most distant one first) | "A spot fire just started **{d} m ahead**. A {flaming/glowing} {stringybark flake / ribbon of bark} from {place} was lifted about **{h} m** by the fire's smoke column, drifted **{t} min** in **{U} km/h** winds aloft, and landed on litter at **{M} %** moisture (ignition chance about {p} %)." |
| 2 | **Embers arrive before the flames** | Landing density within 0–500 m downwind of the head exceeds 20 real embers per 100 m² per 10 min [A], or ≥ 3 spots within 500 m | "Embers are landing well **ahead of the flames**. Most start small fires that the main front soon swallows, but they mean the fire grows faster than the flame front alone suggests. **Your escape route can be cut off from ahead.**" |
| 3 | **Stringybark = ember factory** | ≥ 40 % of emitted embers from cells with BH ≥ 3 stringybark | "This forest has loose, stringy bark. It peels off in flakes that **burn while flying** and can **re-ignite** when they land. That is why fires in stringybark throw so many spot fires." |
| 4 | **Ribbon bark = long-range embers** | E2 particles lofted above 1 km, or E2 landings beyond 3 km | "Long ribbons of bark (candlebark, ribbon gum, mountain gum) roll into tubes that fall slowly and **burn for 2–7 minutes on average, some much longer**. Carried high in the smoke column, they can start fires **tens of km** away (20 km+ has been measured possible)." |
| 5 | **Tall column → long spotting** | Plume top ≥ 3 km, or pyroCu/pyroCb flag, with wind at the plume mid-height ≥ 30 km/h | "The smoke column is **{h} km** tall. Embers only travel far if the fire lifts them high **and** strong winds aloft carry them. Both are happening now, so expect spot fires **several km** downwind, even across valleys and roads." |
| 6 | **Plume-dominated fire: spots in all directions** | N_c > 10 and I > 3000 kW/m | "The fire's own heat is now **stronger than the wind** (upright column). Embers go up and come down all around the fire, **including on the flanks and behind control lines**. Wind changes near the column are erratic." |
| 7 | **Wind-driven fire: a narrow ember stream** | N_c < 2 and U10 ≥ 30 km/h | "Strong wind is **laying the smoke column over**. Embers stay low and are blown **far downwind in a narrow band**, so spot fires line up ahead of the head fire." |
| 8 | **Spots off the wind line** | Direction difference between 10 m wind and mean ember-transport wind ≥ 30° | "Embers are travelling in the winds **up high**, which blow from **{dir aloft}**, not the {dir surface} you feel on the ground. Spot fires may appear **to the side** of where you'd expect." |
| 9 | **Height advantage: fire on the ridge** | Source cell on a ridge (TPI class) and landing ≥ 150 m below the source | "This fire is on high ground. Embers dropping into the valley below fall **{Δh} m further** and so travel about **{ΔX} km further** before landing." |
| 10 | **Embers trapped behind the ridge** | Landing on a lee cell: θ ≥ 20°, aspect within ±40° of downwind, crest wind ≥ 20–25 km/h [S01] | "Behind this ridge the wind **rolls over and flows back uphill** near the ground. Embers that drop here start fires that **run up towards the ridge and sideways**, not away from it. Behind the ridge is not automatically safe." |
| 11 | **Lee-slope sideways run throws embers** | VLS score V ≥ 0.5 with burning cells [S01] | "The fire is **running sideways** along this steep slope just below the ridge and **casting embers far downwind**. This can turn a line of fire into a huge area of flame, as in the 2003 Canberra and 2006 Grose Valley fires." |
| 12 | **Mass spotting → deep flaming** | ≥ 5 spot fires within any 1 km² within 15 min, or spot fire area ≥ 30 % of new burnt area in 15 min [A] | "Many spot fires are **joining up**. Instead of a thin line, a **whole area is burning at once**. This makes huge heat, a stronger smoke column and even more embers. This is how fires become firestorms." |
| 13 | **Spot fire meets main fire** | Spot perimeter within 150 m of the main front, included angle ≤ 45° [S01] | "A spot fire and the main fire are **closing at a narrow angle**. Where they meet, the fire can surge **several times faster**, especially on a slope. **Stay out of the 'V'.**" |
| 14 | **Spot fire below you will run uphill** | Spot fire downslope of the main front or of the user, slope ≥ 10° | "This spot fire is **below** the main fire. Fire runs **uphill fast**, so it will race up to meet the main fire. Crews on the slope between them are in danger." |
| 15 | **Rolling embers** | Burning cells with θ ≥ 25–30° and heavy-fuel attribute; rolling item stops in fuel [S01] | "On slopes this steep, burning cones, bark and logs **roll downhill** and start new fires **below** the main fire, which then run back up." |
| 16 | **Gorges and roads don't stop embers** | Ember landings beyond a non-fuel strip (river, road, cliff, gorge) narrower than the current P90 ember distance | "This {gorge / road / river} is **{w} m** wide, but embers are flying **{d90} m**. It will not stop the fire by itself." |
| 17 | **Moist fuel is stopping spot fires** | ≥ 50 landings in 15 min with mean p < 0.1 and M ≥ 15 % | "Embers are still landing, but the litter is **damp ({M} %)**, so few catch. That is why the fire is quieter tonight. Watch for **dry pockets** (ridges, the warm band mid-slope, sunny north-west faces) and for the morning when the litter dries." |
| 18 | **Dry slopes catch embers** | Spot success rate on N/NW/W aspects ≥ 2× that on S/SE aspects over 30 min | "Spot fires are catching mostly on **sun-dried north- and west-facing slopes**, where the litter is driest. Shaded south-east slopes stay damp longer." |
| 19 | **Glowing embers need wind** | ≥ 70 % of landings glowing and bed wind < 0.5 m/s, with low success | "Most embers arriving here have **stopped flaming** and are just glowing. Glowing embers need a breeze to fan them into flame, so a **wind gust can suddenly start several spot fires**." |
| 20 | **Old fuel, more embers** | Source cells with time since fire ≥ 10 yr and BH ≥ 3, vs a nearby recently burnt area with BH ≤ 2 | "This bush hasn't burnt for **{n} years** and the bark has built up. Burning off bark hazard (from 'high' to 'moderate') cuts embers by about **three times** (Project Vesta). Look how few embers come from the {year} burn area." |
| 21 | **Spot fire now: small but growing** | Every new spot fire | "New spot fires start slowly and speed up. After about **6 minutes** they reach about half their full speed, and about **90 % after 20 minutes** (rule of thumb). The time to act on a spot fire is **now**." |
| 22 | **Night inversion caps the column** | Resolved plume top ≤ inversion height, and N ≥ 0.02 s⁻¹ in the valley | "Cold air trapped in the valley is **capping the smoke column**, so embers aren't lifted far tonight. When the inversion **breaks in the morning** the column will grow and spotting will jump." |
| 23 | **Embers leaving the map** | `leftDomain` beyond-edge histogram P50 ≥ 1 km | "Some embers are flying **beyond the modelled area**. They could start fires up to **{X} km** away that this simulation cannot show." |
| 24 | **Embers landing behind you** | Landings with P_spot ≥ 0.05 between the user location and the nearest safety area, or behind a marked control line | "Embers are landing **behind your position / across the control line**. Check your escape route and safety area." |

"Why" statements to reuse across cards:
* "Embers only go far if they are lifted high, stay alight long, and meet strong wind."
* "Where embers land matters less than *what* they land on: dry, fine litter catches, damp litter
  doesn't."
* "Hills change everything: from a ridge top embers fall further, and behind a ridge the wind can turn
  back uphill."

---

## 6. Open questions and uncertainties (to resolve before release)

1. **Ellis 2015 logistic coefficients** for flaming and glowing ignition vs M and wind (IJWF 24:225–235).
   These should replace the US Schroeder P_ig fallback.
2. **Firebrand generation rate** (real brands per m of front per s) vs I and bark hazard for eucalypts.
   No value was found. E0 is uncalibrated. Candidates:
   * Project Vesta firebrand-density data (Gould et al. 2007);
   * Storey et al. 2020 line-scan spot counts;
   * the 2025 IJWF paper "Long distance spotting potential of messmate stringybark" (WF25091) [V
     existence];
   * "Messmate stringybark: bark ignitability and burning sustainability in relation to fragment
     dimensions, hazard score and time since fire" [V existence];
   * the Frontiers 2021 study of firebrands from different burning tree species [V existence].
3. **Vesta maximum-spotting-distance equation** (Gould et al. 2007 field guide). It must be transcribed.
4. **Messmate flake terminal velocities and burnout times** (Ellis 2013 full text). Also the flake data
   in the Ellis 2000 PhD thesis and Ellis 2010 (jarrah/karri flakes).
5. **Albini's burning constant K and the exact eq. (7) form**. Also Albini's wind-profile and terrain
   terms (INT-GTR-56; Chase 1981 pocket-calculator equations).
6. **Lee-eddy reversed-flow magnitude** and depth for ember purposes. The −0.3·U_crest blend is a
   placeholder.
7. **Byram N_c reference wind height** and the convective vs total I fraction. The 2/10 thresholds are
   from idealised CFD.
8. **Eucalypt spot-fire acceleration.** FBP α = 0.115 min⁻¹ is Canadian. Check the eucalypt-litter
   growth study.
9. **Kilmore East spotting distances** (Cruz et al. 2012) and **Black Summer NSW spotting statistics**.
   These were not retrieved, and "about 33 km" is recalled, not verified.
10. **Sardoy/Kaur lognormal constants** (§3.7). Recalled with low confidence; not used by default.
11. **Plume turbulence intensity α_p** and C_w for the sub-grid plume.
12. All [P] items: verify against the originals. This session had no full-text access (egress proxy).

---

## 7. References

Tags as in the legend. URLs are the canonical landing pages found or known; many are paywalled.

**Eucalypt bark firebrands and ignition**
- Ellis PFM (2013) Firebrand characteristics of the stringy bark of messmate (*Eucalyptus obliqua*) investigated using non-tethered samples. *International Journal of Wildland Fire* 22(5), 642–651. doi:10.1071/WF12141. https://www.publish.csiro.au/wf/wf12141 [V]
- Hall J, Ellis PF, Cary GJ, Bishop G, Sullivan AL (2015) Long-distance spotting potential of bark strips of a ribbon gum (*Eucalyptus viminalis*). *IJWF* 24(8), 1109–1117. doi:10.1071/WF15031. https://publish.csiro.au/wf/wf15031 ; https://researchportalplus.anu.edu.au/en/publications/long-distance-spotting-potential-of-bark-strips-of-a-ribbon-gum-e/ [V]
- Ellis PFM (2015) The likelihood of ignition of dry-eucalypt forest litter by firebrands. *IJWF* 24(2), 225–235. doi:10.1071/WF14048. https://www.publish.csiro.au/wf/wf14048 [V]
- Ellis PFM (2011) Fuelbed ignition potential and bark morphology explain the notoriety of the eucalypt messmate 'stringybark' for intense spotting. *IJWF* 20(7), 897–907. doi:10.1071/WF10052. https://www.publish.csiro.au/wf/WF10052 [V existence; P details]
- Ellis PFM (2010) The effect of the aerodynamic behaviour of flakes of jarrah and karri bark on their potential as firebrands. *Journal of the Royal Society of Western Australia* 93, 21–27. https://www.researchgate.net/publication/281381329 [V existence]
- Ellis PFM (2000) The aerodynamic and combustion characteristics of eucalypt bark – a firebrand study. PhD thesis, Australian National University. [P]
- (2025) Long distance spotting potential of messmate stringybark. *IJWF* 34(12), WF25091. https://connectsci.au/wf/article-split/34/12/WF25091/266084/Long-distance-spotting-potential-of-messmate [V existence]
- Messmate stringybark: bark ignitability and burning sustainability in relation to fragment dimensions, hazard score and time since fire. https://www.researchgate.net/publication/320301566 [V existence]
- CSIRO (2017) Spotting the danger of long-distance firebrands. https://www.csiro.au/en/news/all/articles/2017/february/firespotting [V existence]
- Predicting ignitability from firebrands in mature wet eucalypt forests (2022) *Forest Ecology and Management*. https://www.sciencedirect.com/science/article/abs/pii/S0378112722003097 [V existence]
- Moisture thresholds for ignition vary between types of eucalypt forests across an aridity gradient (2024) *Landscape Ecology*. https://link.springer.com/article/10.1007/s10980-024-01864-6 [V existence]
- Forest fuel bed ignitability under marginal fire weather conditions in Eucalyptus forests. *IJWF* WF18070. https://www.publish.csiro.au/wf/WF18070 [V existence]
- Initial growth of fires in eucalypt litter, from ignition to steady-state rate of spread: laboratory studies. https://www.researchgate.net/publication/356859727 [V existence]
- Ignition dynamics of moist fuel beds under combined firebrand pile and radiative heat exposure (2025) *IJWF* 34(11), WF25165. https://connectsci.au/wf/article/34/11/WF25165/265541 [V existence]
- CSIRO PyroPage Issue 2: Predicting spotfire ignition in dry eucalypt litter. https://research.csiro.au/pyropage/wp-content/uploads/sites/17/2015/08/CSIRO-PyroPage-Issue-2-Spotfires.pdf [V existence]

**Australian fire behaviour, fuel hazard and case studies**
- Gould JS, McCaw WL, Cheney NP, Ellis PF, Knight IK, Sullivan AL (2007) *Project Vesta: Fire in Dry Eucalypt Forest: fuel structure, fuel dynamics and fire behaviour*. Ensis-CSIRO / Dept Environment and Conservation WA. https://www.publish.csiro.au/book/5993/ [V findings quoted]
- Gould JS, McCaw WL, Cheney NP, Ellis PF, Matthews S (2007) *Field Guide: Fuel assessment and fire behaviour prediction in dry eucalypt forest*. https://www.publish.csiro.au/book/5991/ [V existence]
- Cheney NP, Gould JS, McCaw WL, Anderson WR (2012) Predicting fire behaviour in dry eucalypt forest in southern Australia. *Forest Ecology and Management* 280, 120–131. [P]
- Cruz MG et al. (2021) *The Vesta Mk 2 rate of fire spread model: a user's guide*. CSIRO. https://research.csiro.au/vestamk2/wp-content/uploads/sites/443/2021/12/Vesta-Mk-2-users-guide-2021_a.pdf [V existence]
- Noble IR, Bary GAV, Gill AM (1980) McArthur's fire-danger meters expressed as equations. *Australian Journal of Ecology* 5, 201–203. [P]
- McArthur AG (1967) *Fire behaviour in eucalypt forests*. Forestry and Timber Bureau Leaflet 107. [P]
- Hines F, Tolhurst KG, Wilson AAG, McCarthy GJ (2010) *Overall fuel hazard assessment guide*, 4th edn. Vic DSE Research Report 82. [P]
- Cruz MG, Sullivan AL, Gould JS, Sims NC, Bannister AJ, Hollis JJ, Hurley RJ (2012) Anatomy of a catastrophic wildfire: the Black Saturday Kilmore East fire in Victoria, Australia. *Forest Ecology and Management* 284, 269–285. [P]
- Storey MA, Price OF, Bradstock RA, Sharples JJ (2020) Analysis of variation in distance, number, and distribution of spotting in southeast Australian wildfires. *Fire* 3(2), 10. doi:10.3390/fire3020010. https://ro.uow.edu.au/smhpapers1/1534 [V]
- Storey MA, Price OF, Sharples JJ, Bradstock RA (2020) Drivers of long-distance spotting during wildfires in south-eastern Australia. *IJWF* 29(6), 459–472. https://publish.csiro.au/wf/fulltext/wf19124 [S01]
- Storey MA, Price OF, Almeida M, Ribeiro C, Bradstock RA, Sharples JJ (2021) Experiments on the influence of spot fire and topography interaction on fire rate of spread. *PLOS ONE* 16(1), e0245132. [S01]
- Tolhurst K, Shields B, Chong D (2008) Phoenix: development and application of a bushfire risk management tool. *Australian Journal of Emergency Management* 23(4), 47–54. [P]
- Peterson DA et al. (2021) Australia's Black Summer pyrocumulonimbus super outbreak reveals potential for increasingly extreme stratospheric smoke events. *npj Climate and Atmospheric Science* 4, 38. https://www.nature.com/articles/s41612-021-00192-9 [V existence; S02 for count]

**Mountain effects on spread and spotting**
- Sharples JJ (2009) An overview of mountain meteorological effects relevant to fire behaviour and bushfire risk. *IJWF* 18(7), 737–754. [P]
- Sharples JJ, McRae RHD, Wilkes SR (2012) Wind–terrain effects on the propagation of wildfires in rugged terrain: fire channelling. *IJWF* 21(3), 282–296. [P]
- Simpson CC, Sharples JJ, Evans JP, McCabe MF (2013) Large eddy simulation of atypical wildland fire spread on leeward slopes. *IJWF* 22(5), 599–614. [P]
- McRae RHD, Sharples JJ, Fromm M (2015) Linking local wildfire dynamics to pyroCb development. *Natural Hazards and Earth System Sciences* 15, 417–428. [P; S02]
- Hilton JE, Garg N, Sharples JJ (2019) Incorporating firebrands and spot fires into vorticity-driven wildfire behaviour models. *MODSIM 2019*. https://www.naturalhazards.com.au/crc-collection/downloads/conf_paper_hilton_etal_modsim2019_1.pdf [S01/S02]
- Hilton JE, Sullivan AL, Swedosh W, Sharples J, Thomas C (2018) Incorporating convective feedback in wildfire simulations using pyrogenic potential. *Environmental Modelling & Software* 107, 12–24. [P; S01]
- Thomas CM, Sharples JJ, Evans JP (2017) Modelling the dynamic behaviour of junction fires with a coupled atmosphere–fire model. *IJWF* 26(4), 331–344. [P]
- Finney MA, McAllister SS (2011) A review of fire interactions and mass fires. *Journal of Combustion* 2011, 548328. [P]

**Firebrand physics and spotting models**
- Koo E, Pagni PJ, Weise DR, Woycheese JP (2010) Firebrands and spotting ignition in large-scale fires. *IJWF* 19(7), 818–843. doi:10.1071/WF07119. https://research.fs.usda.gov/treesearch/38384 [V]
- Albini FA (1979) *Spot fire distance from burning trees – a predictive model*. USDA Forest Service Gen. Tech. Rep. INT-56. https://www.frames.gov/catalog/8153 ; https://archive.org/details/CAT79721328 [V existence; P equations]
- Albini FA (1981) *Spot fire distance from isolated sources – extensions of a predictive model*. USDA FS Res. Note INT-309. https://www.frames.gov/catalog/8157 [V existence]
- Albini FA (1983a) Transport of firebrands by line thermals. *Combustion Science and Technology* 32, 277–288. [P]
- Albini FA (1983b) *Potential spotting distance from wind-driven surface fires*. USDA FS Res. Pap. INT-309. [P]
- Chase CH (1981) *Spot fire distance equations for pocket calculators*. USDA FS Res. Note INT-310. [P]
- Tarifa CS, del Notario PP, Moreno FG (1965) On the flight paths and lifetimes of burning particles of wood. *Proceedings of the Combustion Institute* 10, 1021–1037. [P]
- Sardoy N, Consalvi JL, Porterie B, Fernandez-Pello AC (2007) Modeling transport and combustion of firebrands from burning trees. *Combustion and Flame* 150, 151–169. [P]
- Sardoy N, Consalvi JL, Kaiss A, Fernandez-Pello AC, Porterie B (2008) Numerical study of ground-level distribution of firebrands generated by line fires. *Combustion and Flame* 154, 478–488. [P]
- Koo E, Linn RR, Pagni PJ, Edminster CB (2012) Modelling firebrand transport in wildfires using HIGRAD/FIRETEC. *IJWF* 21(4), 396–417. [P]
- Bhutia S, Jenkins MA, Sun R (2010) Comparison of firebrand propagation prediction by a plume model and a coupled-fire/atmosphere large-eddy simulator. *Journal of Advances in Modeling Earth Systems* 2, 4. [P]
- Thurston W, Kepert JD, Tory KJ, Fawcett RJB (2017) The contribution of turbulent plume dynamics to long-range spotting. *IJWF* 26(4), 317–330. [P]
- Martin J, Hillen T (2016) The spotting distribution of wildfires. *Applied Sciences* 6(6), 177. [P]
- Kaur I, Mentrelli A, Bosseur F, Filippi JB, Pagnini G (2016) Turbulence and fire-spotting effects into wild-land fire simulators. *Communications in Nonlinear Science and Numerical Simulation* 39, 300–320. https://arxiv.org/abs/1601.06272 [V existence; P constants]
- Tohidi A, Kaye N, Bridges W (2015) Statistical description of firebrand size and shape distribution from coniferous trees for use in Metropolis Monte Carlo simulations of firebrand flight distance. *Fire Safety Journal* 77, 21–35. [P]
- Tohidi A, Kaye NB (2017a) Aerodynamic characterization of rod-like debris with application to firebrand transport. *Journal of Wind Engineering and Industrial Aerodynamics* 168, 297–311. [P]
- Tohidi A, Kaye NB (2017b) Comprehensive wind tunnel experiments of lofting and downwind transport of non-combusting rod-like model firebrands during firebrand shower scenarios. *Fire Safety Journal* 90, 95–111. [P]
- Himoto K, Tanaka T (2005) Transport of disk-shaped firebrands in a turbulent boundary layer. *Fire Safety Science* 8, 433–444. [P]
- Tachikawa M (1983) Trajectories of flat plates in uniform flow with application to wind-generated missiles. *Journal of Wind Engineering and Industrial Aerodynamics* 14, 443–453. [P]
- Manzello SL, Cleary TG, Shields JR, Yang JC (2006) Ignition of mulch and grasses by firebrands in wildland–urban interface fires. *IJWF* 15, 427–431. [P]
- Manzello SL, Maranghides A, Mell WE (2007) Firebrand generation from burning vegetation. *IJWF* 16, 458–462. [P]
- Manzello SL, Suzuki S, Gollner MJ, Fernandez-Pello AC (2020) Role of firebrand combustion in large outdoor fire spread. *Progress in Energy and Combustion Science* 76, 100801. [P]
- Ganteaume A et al. (2009) Spot fires: fuel bed flammability and capability of firebrands to ignite fuel beds. *IJWF* 18, 951–969. [P]
- Ganteaume A et al. (2011) Laboratory characterization of firebrands involved in spot fires. *Annals of Forest Science* 68, 531–541. [P]
- Plucinski MP, Anderson WR (2008) Laboratory determination of factors influencing successful point ignition in the litter layer of shrubland vegetation. *IJWF* 17, 628–637. [P]
- Characterization of Firebrands Released From Different Burning Tree Species (2021) *Frontiers in Mechanical Engineering*. doi:10.3389/fmech.2021.651135. https://www.frontiersin.org/journals/mechanical-engineering/articles/10.3389/fmech.2021.651135/full [V existence]
- Wadhwani R et al. (2022) A review of firebrand studies on generation and transport. *Fire Safety Journal* 134, 103674. [P]
- Page WG, Wagenbrenner NS, Butler BW, Blunck DL (2019) An analysis of spotting distances during the 2017 fire season in the Northern Rockies, USA. *Canadian Journal of Forest Research* 49(3). https://cdnsciencepub.com/doi/abs/10.1139/cjfr-2018-0094 [V existence]
- Lareau NP et al. (2025) Plume dynamics drive extreme long-range spotting during California's Dixie Fire. *JGR Atmospheres*. doi:10.1029/2024JD043167 [V existence]
- Lareau NP et al. (2026) Plume-coupled long-range spotting drove the explosive spread of the 2018 Camp Fire. *JGR Atmospheres*. doi:10.1029/2025JD045798 [V existence]

**Plumes, convective number, turbulence, ignition index, acceleration**
- Byram GM (1959) Combustion of forest fuels. In Davis KP (ed.) *Forest Fire: Control and Use*. McGraw-Hill, 61–89. [P]
- Nelson RM Jr (1993) *Byram's energy criterion for wildland fires: units and equations*. USDA FS Res. Note INT-415. [P]
- Morvan D, Frangieh N (2018) Wildland fires behaviour: wind effect versus Byram's convective number and consequences upon the regime of propagation. *IJWF* 27(9), 636–641. [P]
- Briggs GA (1975) Plume rise predictions. In *Lectures on Air Pollution and Environmental Impact Analyses*, AMS, 59–111. [P]
- Sofiev M, Ermakova T, Vankevich R (2012) Evaluation of the smoke-injection height from wild-land fires using remote-sensing data. *Atmospheric Chemistry and Physics* 12, 1995–2006. [P]
- Csanady GT (1963) Turbulent diffusion of heavy particles in the atmosphere. *Journal of the Atmospheric Sciences* 20, 201–208. [P]
- Thomson DJ (1987) Criteria for the selection of stochastic models of particle trajectories in turbulent flows. *Journal of Fluid Mechanics* 180, 529–556. [P]
- Hanna SR (1982) Applications in air pollution modeling. In Nieuwstadt FTM, van Dop H (eds) *Atmospheric Turbulence and Air Pollution Modelling*. Reidel, 275–310. [P]
- Lenschow DH, Wyngaard JC, Pennell WT (1980) Mean-field and second-moment budgets in a baroclinic, convective boundary layer. *Journal of the Atmospheric Sciences* 37, 1313–1326. [P]
- Panofsky HA, Dutton JA (1984) *Atmospheric Turbulence*. Wiley. [P]
- Rothermel RC (1983) *How to predict the spread and intensity of forest and range fires*. USDA FS Gen. Tech. Rep. INT-143 (Schroeder 1969 ignition probability). [P]
- Forestry Canada Fire Danger Group (1992) *Development and structure of the Canadian Forest Fire Behavior Prediction System*. Information Report ST-X-3. [P]
- McAlpine RS, Wakimoto RH (1991) The acceleration of fire from point source to equilibrium spread. *Forest Science* 37, 1314–1337. [P]
